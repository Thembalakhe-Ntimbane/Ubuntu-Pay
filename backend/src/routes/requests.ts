import { Router } from 'express';
import crypto from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { paymentRequests, transactions, users } from '../db/schema';
import { getClient } from '../lib/openPayments';
import { createQuoteTransaction } from '../lib/quoteFlow';
import { requireAuth } from '../middleware/requireAuth';

export const requestsRouter = Router();

const MAX_NOTE_LENGTH = 280;

// Errors thrown with a status are surfaced as-is by the errorHandler middleware
function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}

// Fields every list/detail response exposes (note: never the other party's email)
const requestFields = {
  id:          paymentRequests.id,
  paymentType: paymentRequests.paymentType,
  amount:      paymentRequests.amount,
  assetCode:   paymentRequests.assetCode,
  assetScale:  paymentRequests.assetScale,
  note:        paymentRequests.note,
  status:      paymentRequests.status,
  createdAt:   paymentRequests.createdAt,
  counterpartId:     users.id,
  counterpartName:   users.displayName,
  counterpartAvatar: users.avatar,
  counterpartWallet: users.walletAddress,
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/requests
//
// Create an ask: the current user (requester) asks `payerId` to send money.
// No Open Payments resources are created here — quotes and incoming payments
// expire, and an ask can sit for days. We only validate both wallets and
// capture the currency the amount is denominated in:
//   FIXED_SEND    → the payer's wallet currency ("you send exactly X")
//   FIXED_RECEIVE → the requester's wallet currency ("I receive exactly X")
// ─────────────────────────────────────────────────────────────────────────────
requestsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const { payerId, paymentType, amount, note } = req.body as {
      payerId?:     string;
      paymentType?: 'FIXED_SEND' | 'FIXED_RECEIVE';
      amount?:      string;
      note?:        string;
    };

    if (!payerId || !paymentType || !amount) {
      return res.status(400).json({ error: 'Missing required fields: payerId, paymentType, amount' });
    }
    if (!['FIXED_SEND', 'FIXED_RECEIVE'].includes(paymentType)) {
      return res.status(400).json({ error: 'paymentType must be FIXED_SEND or FIXED_RECEIVE' });
    }
    if (!/^[1-9]\d*$/.test(amount)) {
      return res.status(400).json({ error: 'amount must be a positive integer in the smallest asset unit' });
    }
    if (payerId === req.user!.id) {
      return res.status(400).json({ error: 'You cannot request money from yourself' });
    }
    if (note && note.length > MAX_NOTE_LENGTH) {
      return res.status(400).json({ error: `Note is too long (max ${MAX_NOTE_LENGTH} characters)` });
    }

    const [requester] = await db.select().from(users).where(eq(users.id, req.user!.id));
    const [payer]     = await db.select().from(users).where(eq(users.id, payerId));

    if (!payer)                    return res.status(404).json({ error: 'Payer not found' });
    if (!requester?.walletAddress) return res.status(400).json({ error: 'Set your wallet address in your profile before requesting money' });
    if (!payer.walletAddress)      return res.status(400).json({ error: 'That user has no wallet address yet' });

    // Resolve the denominating wallet so the stored currency is authoritative
    const client = await getClient();
    const denominatingWallet = await client.walletAddress.get({
      url: paymentType === 'FIXED_SEND' ? payer.walletAddress : requester.walletAddress,
    });

    const id  = crypto.randomUUID();
    const now = new Date();

    await db.insert(paymentRequests).values({
      id,
      requesterId: req.user!.id,
      payerId,
      paymentType,
      amount,
      assetCode:   denominatingWallet.assetCode,
      assetScale:  denominatingWallet.assetScale,
      note:        note?.trim() || null,
      status:      'PENDING',
      createdAt:   now,
      updatedAt:   now,
    });

    res.status(201).json({ id, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/requests
//
// Both directions for the current user:
//   incoming — asks addressed to me (I would pay), counterpart = the requester
//   outgoing — asks I created (I get paid), counterpart = the payer
// ─────────────────────────────────────────────────────────────────────────────
requestsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;

    const incoming = await db
      .select(requestFields)
      .from(paymentRequests)
      .innerJoin(users, eq(users.id, paymentRequests.requesterId))
      .where(eq(paymentRequests.payerId, me))
      .orderBy(desc(paymentRequests.createdAt))
      .limit(20)
      .all();

    const outgoing = await db
      .select(requestFields)
      .from(paymentRequests)
      .innerJoin(users, eq(users.id, paymentRequests.payerId))
      .where(eq(paymentRequests.requesterId, me))
      .orderBy(desc(paymentRequests.createdAt))
      .limit(20)
      .all();

    res.json({ incoming, outgoing });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/requests/:id/fulfill
//
// The payer accepts an ask. Runs the shared quote flow with sender = payer
// (the current user) and receiver = the requester, then links the resulting
// transaction to the ask. The response is the same QuoteResponse shape as
// POST /api/remit/quote, so the frontend continues into the normal
// consent → callback pipeline. /api/callback marks the ask COMPLETED when the
// outgoing payment succeeds; on failure the ask stays PENDING for a retry.
// ─────────────────────────────────────────────────────────────────────────────
requestsRouter.post('/:id/fulfill', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;

    const [ask] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, req.params.id));
    // 404 for both missing and foreign asks, so ids can't be probed
    if (!ask || ask.payerId !== me) return res.status(404).json({ error: 'Request not found' });
    if (ask.status !== 'PENDING')   return res.status(409).json({ error: `Request is ${ask.status}` });

    // A previous fulfilment that reached the consent step may still complete —
    // block a second live payment. PENDING (expired quote) or FAILED is retryable.
    if (ask.transactionId) {
      const [linkedTx] = await db.select().from(transactions).where(eq(transactions.id, ask.transactionId));
      if (linkedTx?.status === 'AWAITING_GRANT') {
        return res.status(409).json({ error: 'A payment for this request is already awaiting your consent' });
      }
    }

    const [requester] = await db.select().from(users).where(eq(users.id, ask.requesterId));
    const [payer]     = await db.select().from(users).where(eq(users.id, me));

    if (!requester?.walletAddress) return res.status(409).json({ error: 'The requester no longer has a wallet address' });
    if (!payer?.walletAddress)     return res.status(400).json({ error: 'Set your wallet address in your profile before paying' });

    const result = await createQuoteTransaction({
      senderWalletAddress:   payer.walletAddress,
      receiverWalletAddress: requester.walletAddress,
      amount:                ask.amount,
      paymentType:           ask.paymentType as 'FIXED_SEND' | 'FIXED_RECEIVE',
      userId:                me,
      // The ask amount is denominated in a specific currency. If that wallet's
      // currency changed since the ask was made, the number would silently mean
      // something else — abort before any Open Payments resource is created.
      validateWallets: (sendingWallet, receivingWallet) => {
        const wallet = ask.paymentType === 'FIXED_SEND' ? sendingWallet : receivingWallet;
        if (wallet.assetCode !== ask.assetCode || wallet.assetScale !== ask.assetScale) {
          throw httpError(409, `Wallet currency changed (${ask.assetCode} → ${wallet.assetCode}). Ask for a new request.`);
        }
      },
    });

    // Conditional update guards against a concurrent fulfill/cancel
    const updated = await db
      .update(paymentRequests)
      .set({ transactionId: result.transactionId, updatedAt: new Date() })
      .where(and(
        eq(paymentRequests.id, ask.id),
        eq(paymentRequests.payerId, me),
        eq(paymentRequests.status, 'PENDING'),
      ));
    if (updated.rowsAffected === 0) {
      return res.status(409).json({ error: 'Request changed while creating the quote — reload and try again' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/requests/:id/decline  (payer)
// POST /api/requests/:id/cancel   (requester)
//
// Single conditional UPDATE so concurrent transitions can't clobber each other;
// 0 rows affected means the ask was missing, foreign, or no longer PENDING.
// ─────────────────────────────────────────────────────────────────────────────
requestsRouter.post('/:id/decline', requireAuth, async (req, res, next) => {
  try {
    const updated = await db
      .update(paymentRequests)
      .set({ status: 'DECLINED', updatedAt: new Date() })
      .where(and(
        eq(paymentRequests.id, req.params.id),
        eq(paymentRequests.payerId, req.user!.id),
        eq(paymentRequests.status, 'PENDING'),
      ));
    if (updated.rowsAffected === 0) {
      return res.status(409).json({ error: 'Request not found or no longer pending' });
    }
    res.json({ status: 'DECLINED' });
  } catch (err) {
    next(err);
  }
});

requestsRouter.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const updated = await db
      .update(paymentRequests)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(and(
        eq(paymentRequests.id, req.params.id),
        eq(paymentRequests.requesterId, req.user!.id),
        eq(paymentRequests.status, 'PENDING'),
      ));
    if (updated.rowsAffected === 0) {
      return res.status(409).json({ error: 'Request not found or no longer pending' });
    }
    res.json({ status: 'CANCELLED' });
  } catch (err) {
    next(err);
  }
});
