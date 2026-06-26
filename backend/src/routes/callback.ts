import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { transactions, paymentRequests, postUnlocks } from '../db/schema';
import { getClientForWallet, isFinalizedGrant } from '../lib/openPayments';
import { notificationForCompletedPayment, notifyBeneficiary } from '../lib/notify';
import { config } from '../config';

export const callbackRouter = Router();

callbackRouter.get('/', async (req, res) => {
  const { interact_ref, transactionId, result } = req.query as Record<string, string>;

  if (!transactionId) {
    return res.status(400).send('Missing transactionId in callback query');
  }

  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId));

  if (!tx || tx.status !== 'AWAITING_GRANT') {
    return res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}&reason=invalid_state`);
  }

  const [unlock] = await db
    .select({ postId: postUnlocks.postId })
    .from(postUnlocks)
    .where(and(eq(postUnlocks.transactionId, transactionId), eq(postUnlocks.status, 'PENDING')));
  const postSuffix = unlock ? `&post=${unlock.postId}` : '';

  if (!interact_ref || result === 'grant_rejected') {
    await db
      .update(transactions)
      .set({
        status:       'FAILED',
        errorMessage: result === 'grant_rejected'
          ? 'Payment declined — you cancelled the authorisation at your wallet.'
          : 'Authorisation did not complete. Please try the payment again.',
        updatedAt:    new Date(),
      })
      .where(eq(transactions.id, transactionId));

    return res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}${postSuffix}`);
  }

  try {
    const client = await getClientForWallet(tx.senderWalletAddress);

    const finalizedGrant = await client.grant.continue(
      {
        url:         tx.grantContinueUri!,
        accessToken: tx.grantContinueToken!,
      },
      { interact_ref }
    );

    if (!isFinalizedGrant(finalizedGrant)) {
      throw new Error('Grant continuation did not return an access token. Consent may have been denied or expired.');
    }

    const sendingWallet = await client.walletAddress.get({ url: tx.senderWalletAddress });

    const outgoingPayment = await client.outgoingPayment.create(
      {
        url:         sendingWallet.resourceServer,
        accessToken: finalizedGrant.access_token.value,
      },
      {
        walletAddress: sendingWallet.id,
        quoteId:       tx.quoteUrl!,
        metadata:      {
          description: tx.beneficiaryName
            ? `Ubuntu Pay — ${tx.beneficiaryName}`
            : 'Ubuntu Pay payment',
        },
      }
    );

    await db
      .update(transactions)
      .set({
        status:             'COMPLETED',
        outgoingPaymentUrl: outgoingPayment.id,
        updatedAt:          new Date(),
      })
      .where(eq(transactions.id, transactionId));

    await db
      .update(paymentRequests)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(and(
        eq(paymentRequests.transactionId, transactionId),
        eq(paymentRequests.status, 'PENDING'),
      ));

    await db
      .update(postUnlocks)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(and(
        eq(postUnlocks.transactionId, transactionId),
        eq(postUnlocks.status, 'PENDING'),
      ));

    const sms = notificationForCompletedPayment({
      senderWallet:        tx.senderWalletAddress,
      receiverWallet:      tx.receiverWalletAddress,
      receiveAmount:       tx.receiveAmount ?? tx.debitAmount ?? '0',
      beneficiaryName:     tx.beneficiaryName,
      beneficiaryPhone:    tx.beneficiaryPhone,
      beneficiaryLanguage: tx.beneficiaryLanguage,
    });
    if (sms) void notifyBeneficiary(sms);

    res.redirect(`${config.frontendUrl}?status=completed&id=${transactionId}${postSuffix}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[callback] Payment failed:', message);

    await db
      .update(transactions)
      .set({
        status:       'FAILED',
        errorMessage: message,
        updatedAt:    new Date(),
      })
      .where(eq(transactions.id, transactionId));

    res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}${postSuffix}`);
  }
});
