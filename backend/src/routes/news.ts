import { Router } from 'express';
import crypto from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { posts, postUnlocks, transactions, users } from '../db/schema';
import { getClient, normaliseWalletAddress, isFinalizedGrant } from '../lib/openPayments';
import { createQuoteTransaction } from '../lib/quoteFlow';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';

export const newsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// News — a Web Monetization demo. The reader is the payer; the app's configured
// wallet (OP_WALLET_ADDRESS) is the "monetization receiver" — the journalist's
// payout. Each post has a free excerpt and a paywalled body.
//
// Two ways to pay, both ending in a COMPLETED `postUnlocks` row that grants the
// body:
//   • PRIMARY — Web Monetization (POST /wm-unlock). The reader's browser streams
//     micropayments via <link rel="monetization">; we verify the incoming payment
//     and record the unlock. No grant/consent runs here.
//   • FALLBACK — one-off Open Payments (POST /unlock), for browsers with no
//     monetization provider. It returns a QuoteResponse the frontend feeds into
//     the normal consent flow; /api/callback marks the unlock COMPLETED.
// ─────────────────────────────────────────────────────────────────────────────

// The receiver wallet's currency rarely changes, so resolve it once per process.
let _receiver: { assetCode: string; assetScale: number } | null = null;
async function getReceiverInfo(): Promise<{ assetCode: string; assetScale: number }> {
  if (_receiver) return _receiver;
  const client = await getClient();
  const wallet = await client.walletAddress.get({ url: normaliseWalletAddress(config.defaultWallet) });
  _receiver = { assetCode: wallet.assetCode, assetScale: wallet.assetScale };
  return _receiver;
}

// Convert a MAJOR-unit price (e.g. "0.10") into the smallest asset unit for the
// receiver wallet's scale (e.g. 10 at scale 2). Returns null if the price is not
// a positive number.
function toSmallestUnit(price: string, assetScale: number): string | null {
  const major = Number(price);
  if (!Number.isFinite(major) || major <= 0) return null;
  return Math.round(major * 10 ** assetScale).toString();
}

// Web Monetization verification (spec §1.4): read the incoming payment the
// reader's monetization provider streamed to, and return the amount the receiver
// actually got. Best-effort — returns null if it can't be read (e.g. the URL is
// foreign or the grant is refused), in which case the caller falls back to
// recording the unlock without an authoritative amount.
async function readReceivedAmount(
  incomingPaymentUrl: string,
): Promise<{ value: string; assetCode: string; assetScale: number } | null> {
  try {
    const client = await getClient();
    const wallet = await client.walletAddress.get({ url: normaliseWalletAddress(config.defaultWallet) });
    const grant = await client.grant.request(
      { url: wallet.authServer },
      { access_token: { access: [{ type: 'incoming-payment', actions: ['read', 'read-all'] }] } },
    );
    if (!isFinalizedGrant(grant)) return null;

    const ip = await client.incomingPayment.get({
      url:         incomingPaymentUrl,
      accessToken: grant.access_token.value,
    });
    const r = ip.receivedAmount;
    return r ? { value: r.value, assetCode: r.assetCode, assetScale: r.assetScale } : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/news/posts
//
// All posts (newest first) with a per-reader `unlocked` flag and the receiver
// currency for display. Never returns the paywalled body.
// ─────────────────────────────────────────────────────────────────────────────
newsRouter.get('/posts', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const receiver = await getReceiverInfo();

    const rows = await db
      .select({
        id:           posts.id,
        authorName:   posts.authorName,
        authorAvatar: posts.authorAvatar,
        title:        posts.title,
        excerpt:      posts.excerpt,
        category:     posts.category,
        price:        posts.price,
        streaming:    posts.streaming,
        freeToRead:   posts.freeToRead,
        streamLimit:  posts.streamLimit,
        createdAt:    posts.createdAt,
        unlockStatus: postUnlocks.status,
      })
      .from(posts)
      .leftJoin(
        postUnlocks,
        and(eq(postUnlocks.postId, posts.id), eq(postUnlocks.userId, me)),
      )
      .orderBy(desc(posts.createdAt))
      .all();

    res.json(
      rows.map((r) => ({
        id:              r.id,
        authorName:      r.authorName,
        authorAvatar:    r.authorAvatar,
        title:           r.title,
        excerpt:         r.excerpt,
        category:        r.category,
        price:           r.price,
        priceAssetCode:  receiver.assetCode,
        priceAssetScale: receiver.assetScale,
        receiverWallet:  config.defaultWallet,
        streaming:       !!r.streaming,
        freeToRead:      !!r.freeToRead,
        streamLimit:     r.streamLimit,
        unlocked:        r.unlockStatus === 'COMPLETED',
        createdAt:       r.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/news/posts/:id
//
// A single post. The body is included when the reader has a COMPLETED unlock or
// the post is free to read; when unlocked, a Web Monetization–style receipt is
// attached (amount sent + the incoming-payment URL at the receiver).
// ─────────────────────────────────────────────────────────────────────────────
newsRouter.get('/posts/:id', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const receiver = await getReceiverInfo();

    const [post] = await db.select().from(posts).where(eq(posts.id, req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [unlock] = await db
      .select()
      .from(postUnlocks)
      .where(and(eq(postUnlocks.postId, post.id), eq(postUnlocks.userId, me)));

    const unlocked = unlock?.status === 'COMPLETED';
    const bodyVisible = unlocked || post.freeToRead;

    // When unlocked, surface a MonetizationEvent-style receipt: amountSent (what
    // the reader paid) + the incoming-payment URL at the receiver. The fields come
    // from the streamed Web Monetization payment, or — for the fallback path — the
    // one-off Open Payments transaction.
    let receipt: {
      method:          'WEB_MONETIZATION' | 'OPEN_PAYMENTS';
      amountSent:      { value: string; assetCode: string; assetScale: number };
      incomingPayment: string | null;
    } | null = null;

    if (unlocked && unlock) {
      if (unlock.method === 'WEB_MONETIZATION') {
        receipt = {
          method:     'WEB_MONETIZATION',
          amountSent: {
            value:      unlock.wmAmountValue ?? '0',
            assetCode:  unlock.wmAssetCode ?? receiver.assetCode,
            assetScale: unlock.wmAssetScale ?? receiver.assetScale,
          },
          incomingPayment: unlock.wmIncomingPayment,
        };
      } else if (unlock.transactionId) {
        const [tx] = await db.select().from(transactions).where(eq(transactions.id, unlock.transactionId));
        if (tx) {
          receipt = {
            method:          'OPEN_PAYMENTS',
            amountSent:      { value: tx.debitAmount ?? '0', assetCode: tx.assetCode, assetScale: tx.assetScale },
            incomingPayment: tx.incomingPaymentUrl,
          };
        }
      }
    }

    res.json({
      id:              post.id,
      authorName:      post.authorName,
      authorAvatar:    post.authorAvatar,
      title:           post.title,
      excerpt:         post.excerpt,
      category:        post.category,
      price:           post.price,
      priceAssetCode:  receiver.assetCode,
      priceAssetScale: receiver.assetScale,
      receiverWallet:  config.defaultWallet,
      streaming:       !!post.streaming,
      freeToRead:      !!post.freeToRead,
      streamLimit:     post.streamLimit,
      unlocked,
      createdAt:       post.createdAt,
      body:            bodyVisible ? post.body : null,
      receipt,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/news/posts/:id/unlock
//
// Starts the one-off payment that unlocks a post. Mirrors POST
// /api/requests/:id/fulfill: sender = the reader, receiver = the app wallet
// (the journalist's payout), FIXED_RECEIVE so the journalist gets exactly the
// listed price. Returns the same QuoteResponse shape, so the frontend continues
// into the normal consent → callback pipeline.
// ─────────────────────────────────────────────────────────────────────────────
newsRouter.post('/posts/:id/unlock', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;

    const [post] = await db.select().from(posts).where(eq(posts.id, req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [reader] = await db.select().from(users).where(eq(users.id, me));
    if (!reader?.walletAddress) {
      return res.status(400).json({ error: 'Set your wallet address in your profile before unlocking articles' });
    }

    // One unlock row per (post, reader), reused across retries.
    const [existing] = await db
      .select()
      .from(postUnlocks)
      .where(and(eq(postUnlocks.postId, post.id), eq(postUnlocks.userId, me)));

    if (existing?.status === 'COMPLETED') {
      return res.status(409).json({ error: 'You have already unlocked this article' });
    }

    // A previous attempt that reached the consent step may still complete —
    // block a second live payment for the same post.
    if (existing?.transactionId) {
      const [linkedTx] = await db.select().from(transactions).where(eq(transactions.id, existing.transactionId));
      if (linkedTx?.status === 'AWAITING_GRANT') {
        return res.status(409).json({ error: 'A payment for this article is already awaiting your consent' });
      }
    }

    const receiver     = await getReceiverInfo();
    const smallestUnit = toSmallestUnit(post.price, receiver.assetScale);
    if (!smallestUnit) {
      return res.status(500).json({ error: 'This article has an invalid price' });
    }

    const result = await createQuoteTransaction({
      senderWalletAddress:   reader.walletAddress,
      receiverWalletAddress: config.defaultWallet,
      amount:                smallestUnit,
      paymentType:           'FIXED_RECEIVE', // the journalist receives exactly the listed price
      userId:                me,
    });

    const now = new Date();
    if (existing) {
      await db
        .update(postUnlocks)
        .set({ method: 'OPEN_PAYMENTS', transactionId: result.transactionId, status: 'PENDING', updatedAt: now })
        .where(eq(postUnlocks.id, existing.id));
    } else {
      await db.insert(postUnlocks).values({
        id:            crypto.randomUUID(),
        postId:        post.id,
        userId:        me,
        method:        'OPEN_PAYMENTS',
        transactionId: result.transactionId,
        status:        'PENDING',
        createdAt:     now,
        updatedAt:     now,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/news/posts/:id/wm-unlock
//
// The Web Monetization path (the primary one). The reader's browser has streamed
// micropayments to the newsroom's payment pointer via <link rel="monetization">
// and reports the incoming-payment URL from a MonetizationEvent. We best-effort
// verify the amount the receiver actually got (spec §1.4) for the receipt and
// record the unlock. There is deliberately no price floor: a normal article
// unlocks the moment monetization is active, then the browser keeps streaming
// until the price settles (each call refreshes the recorded amount). No Open
// Payments grant/consent runs here — the provider already did the paying.
//
// Body: { incomingPayment?: string, streamedValue?: string }  (both optional)
// ─────────────────────────────────────────────────────────────────────────────
newsRouter.post('/posts/:id/wm-unlock', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;
    const { incomingPayment, streamedValue } = req.body as { incomingPayment?: string; streamedValue?: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, req.params.id));
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const [existing] = await db
      .select()
      .from(postUnlocks)
      .where(and(eq(postUnlocks.postId, post.id), eq(postUnlocks.userId, me)));

    // A fallback Open Payments unlock already granted access — nothing to do.
    if (existing?.status === 'COMPLETED' && existing.method === 'OPEN_PAYMENTS') {
      return res.json({ unlocked: true, verified: false });
    }

    const receiver = await getReceiverInfo();

    // Verify what the receiver actually got, when we can read the incoming payment.
    // No price floor: a normal article unlocks the moment monetization is active,
    // then keeps streaming until the price settles — each call refreshes the amount.
    const received = incomingPayment ? await readReceivedAmount(incomingPayment) : null;

    // Record the amount for the receipt, in order of trust: the verified received
    // amount, else the client's streamed total, else the listed price.
    const streamedMinor = streamedValue ? toSmallestUnit(streamedValue, receiver.assetScale) : null;
    const amount = received ?? {
      value:      streamedMinor ?? toSmallestUnit(post.price, receiver.assetScale) ?? '0',
      assetCode:  receiver.assetCode,
      assetScale: receiver.assetScale,
    };

    const now = new Date();
    if (existing) {
      await db
        .update(postUnlocks)
        .set({
          method:            'WEB_MONETIZATION',
          status:            'COMPLETED',
          wmIncomingPayment: incomingPayment ?? null,
          wmAmountValue:     amount.value,
          wmAssetCode:       amount.assetCode,
          wmAssetScale:      amount.assetScale,
          updatedAt:         now,
        })
        .where(eq(postUnlocks.id, existing.id));
    } else {
      await db.insert(postUnlocks).values({
        id:                crypto.randomUUID(),
        postId:            post.id,
        userId:            me,
        method:            'WEB_MONETIZATION',
        status:            'COMPLETED',
        wmIncomingPayment: incomingPayment ?? null,
        wmAmountValue:     amount.value,
        wmAssetCode:       amount.assetCode,
        wmAssetScale:      amount.assetScale,
        createdAt:         now,
        updatedAt:         now,
      });
    }

    res.json({ unlocked: true, verified: !!received });
  } catch (err) {
    next(err);
  }
});
