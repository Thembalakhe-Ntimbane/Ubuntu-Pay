/*
 * ============================================================================
 *  Open Payments, end to end: a peer to peer ("P2P") walkthrough
 * ============================================================================
 *
 *  This single file walks through the EIGHT steps it takes for one person to
 *  pay another person using Open Payments. It is written to be READ first and
 *  run second. Every step has a plain language comment that explains what is
 *  happening and why.
 *
 *  The eight steps, in order:
 *
 *    1. Discovery    Look up both wallet addresses to learn where their
 *                    servers live and what currency they use.
 *    2. Grant        Ask the RECEIVER's auth server for permission to create
 *                    an incoming payment. (Non-interactive: no human needed.)
 *    3. Incoming     Create the incoming payment on the receiver's wallet.
 *    4. Grant        Ask the SENDER's auth server for permission to create a
 *                    quote. (Non-interactive: no human needed.)
 *    5. Quote        Create the quote on the sender's wallet. This tells us
 *                    the exact amounts and any fees before we commit.
 *    6. Grant        Ask the SENDER's auth server for permission to create an
 *                    OUTGOING payment. (Interactive: the sender must approve.)
 *    7. Interactive  The sender opens a link in their browser and approves the
 *                    payment at their own wallet. Nothing moves until they do.
 *    8. Outgoing     Once approved, create the outgoing payment.
 *             
 *
 *  ----------------------------------------------------------------------------
 *  IMPORTANT: WE ARE NOT MOVING REAL MONEY
 *  ----------------------------------------------------------------------------
 *  This walkthrough is meant to run against the Interledger TEST network
 *  (ilp.interledger-test.dev). The wallets there hold play money, so no real
 *  funds ever leave anyone's account. On top of that, step 8 (the only step
 *  that "moves" anything) cannot happen until the sender personally approves it
 *  in their browser at step 7. So nothing is sent silently, and nothing real
 *  is sent at all. You can read and run this safely to learn the flow.
 *
 *  ----------------------------------------------------------------------------
 *  Wallet addresses vs payment pointers
 *  ----------------------------------------------------------------------------
 *  People often share a wallet as a "payment pointer" that starts with a $:
 *
 *      $ilp.interledger-test.dev/alice
 *
 *  That is just a friendly shorthand. The real, machine readable wallet
 *  address is an https URL. You get it by replacing the leading $ with https://
 *
 *      $ilp.interledger-test.dev/alice   ->   https://ilp.interledger-test.dev/alice
 *
 *  Open Payments always works with the https URL. The helper below does that
 *  conversion for you, so you can paste either form into the config.
 *
 *  ----------------------------------------------------------------------------
 *  How to run it
 *  ----------------------------------------------------------------------------
 *    1. Create a test wallet and a key at https://wallet.interledger-test.dev
 *       (the test wallet lets you download a private key and shows its key id).
 *    2. Fill in the CONFIG block below: your sender wallet, key id, and the
 *       path to the private key file you downloaded.
 *    3. From the backend folder, run:  npx tsx examples/p2p-open-payments-walkthrough.ts
 *
 *  This file only depends on the @interledger/open-payments package, so you can
 *  copy it out of this project and it will still work on its own.
 * ============================================================================
 */

import { createInterface } from 'node:readline/promises';
import {
  createAuthenticatedClient,
  isPendingGrant,
  isFinalizedGrantWithAccessToken,
} from '@interledger/open-payments';
import type { Grant, PendingGrant } from '@interledger/open-payments';

// ============================================================================
//  CONFIG: everything you might want to change lives here, in one place.
//  These defaults point at the Interledger TEST network. Replace the key id
//  and key path with your own before running.
// ============================================================================

// The SENDER. This is also "you", the person running this script. The private
// key below must belong to this wallet, because every request we send is
// signed with that key to prove it is really us.
const SENDER_WALLET_ADDRESS = 'https://ilp.interledger-test.dev/alice';

// The RECEIVER. The person getting paid. (You can also paste a $ pointer here,
// for example '$ilp.interledger-test.dev/bob'. The helper converts it.)
const RECEIVER_WALLET_ADDRESS = 'https://ilp.interledger-test.dev/bob';

// The id of the key registered on the SENDER's wallet. The test wallet shows
// this to you when you create the key. Replace the placeholder below.
const KEY_ID = 'REPLACE_WITH_YOUR_KEY_ID';
// Path to the private key file (.pem / .key) you downloaded for that key.
// The SDK reads the file itself, so this is a file path, not the key contents.
const PRIVATE_KEY_PATH = './private.key';

// How much to send. This number is in the SENDER currency's SMALLEST unit.
// For a USD wallet with two decimal places (assetScale 2), '100' means $1.00.
// We read the real currency and decimal places from the wallet at step 1, so
// you do not have to hard code them here.
const AMOUNT_TO_SEND = '100';

// ============================================================================
//  SMALL HELPERS
// ============================================================================

// Turn a "$pointer" into a real "https://" wallet address URL. If the value is
// already an https URL, it is returned unchanged, so this is always safe.
function toWalletAddressUrl(addressOrPointer: string): string {
  return addressOrPointer.startsWith('$')
    ? `https://${addressOrPointer.slice(1)}`
    : addressOrPointer;
}

// A grant request can come back in one of two shapes:
//   - "pending"   the auth server wants a human to interact first, or
//   - "finalized" the grant is ready and carries an access token we can use.
// For the NON-interactive grants (steps 2 and 4) we always expect a finalized
// grant with a token. This narrows the type and returns the token string, or
// throws a clear error if something unexpected came back.
function requireAccessToken(grant: PendingGrant | Grant, label: string): string {
  if (isPendingGrant(grant) || !isFinalizedGrantWithAccessToken(grant)) {
    throw new Error(`Expected a finalized ${label} grant with an access token.`);
  }
  return grant.access_token.value;
}

// Pause and wait for the person at the keyboard to press Enter. We use this at
// step 7 to give the sender time to approve the payment in their browser.
async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(message);
  rl.close();
}

// ============================================================================
//  THE WALKTHROUGH
// ============================================================================

async function main(): Promise<void> {
  const senderUrl = toWalletAddressUrl(SENDER_WALLET_ADDRESS);
  const receiverUrl = toWalletAddressUrl(RECEIVER_WALLET_ADDRESS);

  // Create the client once. It holds our key and signs every request for us.
  // walletAddressUrl is OUR wallet (the sender), because the key belongs to it.
  const client = await createAuthenticatedClient({
    walletAddressUrl: senderUrl,
    keyId: KEY_ID,
    privateKey: PRIVATE_KEY_PATH, // a file path; the SDK reads the .pem itself
  });

  // --------------------------------------------------------------------------
  // STEP 1 of 8: DISCOVERY
  // --------------------------------------------------------------------------
  // Before we can do anything, we look up both wallet addresses. The public
  // wallet address tells us three useful things:
  //   - authServer:     where to ask for permission (grants)
  //   - resourceServer: where to create payments and quotes
  //   - assetCode / assetScale: the currency and how many decimal places it has
  // This step needs no permission and no human. It is just reading public info.
  console.log('Step 1: discovering both wallets...');
  const [sendingWallet, receivingWallet] = await Promise.all([
    client.walletAddress.get({ url: senderUrl }),
    client.walletAddress.get({ url: receiverUrl }),
  ]);
  console.log(`  sender pays in   ${sendingWallet.assetCode} (scale ${sendingWallet.assetScale})`);
  console.log(`  receiver gets in ${receivingWallet.assetCode} (scale ${receivingWallet.assetScale})`);

  // --------------------------------------------------------------------------
  // STEP 2 of 8: GRANT for the incoming payment (non-interactive)
  // --------------------------------------------------------------------------
  // To create an incoming payment on the RECEIVER's wallet we first need
  // permission from the RECEIVER's auth server. Creating an incoming payment is
  // harmless (it just says "money may arrive here"), so this grant is granted
  // automatically with no human involved.
  console.log('Step 2: getting permission to create an incoming payment...');
  const incomingGrant = await client.grant.request(
    { url: receivingWallet.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }] } },
  );
  const incomingToken = requireAccessToken(incomingGrant, 'incoming-payment');

  // --------------------------------------------------------------------------
  // STEP 3 of 8: INCOMING PAYMENT
  // --------------------------------------------------------------------------
  // Now we create the incoming payment on the receiver's wallet. Think of it as
  // an invoice or a "money may arrive here" marker that the sender will pay.
  //
  // This is where FIXED SEND and FIXED RECEIVE differ:
  //
  //   FIXED SEND (this example): the sender decides exactly how much to SEND.
  //   We do NOT set an incomingAmount here. We leave the incoming payment open
  //   ended, and the quote at step 5 works out how much actually arrives.
  console.log('Step 3: creating the incoming payment on the receiver...');
  const incomingPayment = await client.incomingPayment.create(
    { url: receivingWallet.resourceServer, accessToken: incomingToken },
    { walletAddress: receivingWallet.id },
  );

  //   FIXED RECEIVE (the other option, shown here but commented out): the
  //   sender decides exactly how much the receiver should GET. You would set
  //   incomingAmount on the incoming payment instead, like this:
  //
  // const incomingPayment = await client.incomingPayment.create(
  //   { url: receivingWallet.resourceServer, accessToken: incomingToken },
  //   {
  //     walletAddress: receivingWallet.id,
  //     incomingAmount: {
  //       value: AMOUNT_TO_SEND,                 // amount in the RECEIVER's currency
  //       assetCode: receivingWallet.assetCode,
  //       assetScale: receivingWallet.assetScale,
  //     },
  //   },
  // );

  console.log(`  incoming payment: ${incomingPayment.id}`);

  // --------------------------------------------------------------------------
  // STEP 4 of 8: GRANT for the quote (non-interactive)
  // --------------------------------------------------------------------------
  // A quote is created on the SENDER's wallet, so now we ask the SENDER's auth
  // server for permission to create one. Quoting only calculates amounts and
  // fees, it does not move money, so this grant is also automatic. No human.
  console.log('Step 4: getting permission to create a quote...');
  const quoteGrant = await client.grant.request(
    { url: sendingWallet.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } },
  );
  const quoteToken = requireAccessToken(quoteGrant, 'quote');

  // --------------------------------------------------------------------------
  // STEP 5 of 8: QUOTE
  // --------------------------------------------------------------------------
  // The quote points at the incoming payment we made at step 3 and works out
  // the firm numbers: how much the sender is debited and how much the receiver
  // is credited, including any currency conversion or fees. It is like getting
  // a price before you confirm a purchase.
  //
  //   FIXED SEND (this example): we set debitAmount, the exact amount to take
  //   from the sender. The quote tells us how much will arrive.
  console.log('Step 5: creating the quote...');
  const quote = await client.quote.create(
    { url: sendingWallet.resourceServer, accessToken: quoteToken },
    {
      walletAddress: sendingWallet.id,
      receiver: incomingPayment.id, // the full incoming payment URL from step 3
      method: 'ilp',
      debitAmount: {
        value: AMOUNT_TO_SEND,               // amount in the SENDER's currency
        assetCode: sendingWallet.assetCode,
        assetScale: sendingWallet.assetScale,
      },
    },
  );

  //   FIXED RECEIVE (the other option, commented out): you would OMIT
  //   debitAmount here. The incomingAmount you set at step 3 drives the quote
  //   instead, and the quote tells you how much the sender must pay:
  //
  // const quote = await client.quote.create(
  //   { url: sendingWallet.resourceServer, accessToken: quoteToken },
  //   {
  //     walletAddress: sendingWallet.id,
  //     receiver: incomingPayment.id,
  //     method: 'ilp',
  //   },
  // );

  console.log(`  sender pays  ${quote.debitAmount.value} (${quote.debitAmount.assetCode})`);
  console.log(`  receiver gets ${quote.receiveAmount.value} (${quote.receiveAmount.assetCode})`);

  // --------------------------------------------------------------------------
  // STEP 6 of 8: GRANT for the outgoing payment (INTERACTIVE)
  // --------------------------------------------------------------------------
  // This is the important one. Sending money needs the sender's explicit
  // consent, so this grant is INTERACTIVE: the auth server does not approve it
  // automatically. Instead it hands back a redirect link for the sender to open
  // in a browser and approve at their own wallet.
  //
  // We also set spending limits from the quote, so the sender is approving this
  // exact amount and nothing more.
  //
  // Note: we deliberately do NOT include an `interact.finish` redirect here.
  // That keeps this example a simple command line script with no web server.
  // After the sender approves, we continue the grant by polling (step 8). In a
  // real web app you would set interact.finish to a callback URL and continue
  // the grant using the `interact_ref` the auth server sends back to it.
  console.log('Step 6: getting permission to send (this one needs the sender to approve)...');
  const outgoingGrant = await client.grant.request(
    { url: sendingWallet.authServer },
    {
      access_token: {
        access: [
          {
            type: 'outgoing-payment',
            actions: ['create', 'read'],
            identifier: sendingWallet.id,
            limits: {
              debitAmount: {
                value: quote.debitAmount.value,
                assetCode: quote.debitAmount.assetCode,
                assetScale: quote.debitAmount.assetScale,
              },
            },
          },
        ],
      },
      interact: { start: ['redirect'] },
    },
  );

  // Because this grant is interactive, we expect a PENDING grant that carries a
  // redirect link. If we did not get one, we cannot continue.
  if (!isPendingGrant(outgoingGrant) || !outgoingGrant.interact?.redirect) {
    throw new Error('Expected an interactive outgoing-payment grant with a redirect link.');
  }

  // --------------------------------------------------------------------------
  // STEP 7 of 8: INTERACTIVE CONSENT
  // --------------------------------------------------------------------------
  // Hand the redirect link to the sender. They open it, see exactly what they
  // are approving, and click approve at their own wallet. Until they do, the
  // grant stays pending and no money can move. This is the human in the loop.
  console.log('\nStep 7: the sender must now approve the payment.');
  console.log('Open this link in a browser and approve:\n');
  console.log(`  ${outgoingGrant.interact.redirect}\n`);
  await waitForEnter('After approving in the browser, press Enter here to continue...');

  // --------------------------------------------------------------------------
  // STEP 8 of 8: OUTGOING PAYMENT
  // --------------------------------------------------------------------------
  // Now that the sender has approved, we "continue" the grant to exchange the
  // pending grant for a real access token, then create the outgoing payment
  // from the quote. THIS is the step where money actually moves (test money, on
  // the test network). We point at the quote from step 5 so the amounts are
  // exactly the ones the sender saw and approved.
  console.log('Step 8: finishing the grant and creating the outgoing payment...');
  const finalizedGrant = await client.grant.continue({
    url: outgoingGrant.continue.uri,
    accessToken: outgoingGrant.continue.access_token.value,
  });

  if (!isFinalizedGrantWithAccessToken(finalizedGrant)) {
    throw new Error('The grant was not approved (or has not been approved yet). Nothing was sent.');
  }

  const outgoingPayment = await client.outgoingPayment.create(
    { url: sendingWallet.resourceServer, accessToken: finalizedGrant.access_token.value },
    {
      walletAddress: sendingWallet.id,
      quoteId: quote.id, // the full quote URL from step 5
      metadata: { description: 'Open Payments walkthrough (test network)' },
    },
  );

  console.log(`\nDone. Outgoing payment created: ${outgoingPayment.id}`);
  console.log('Remember: this used test money on the Interledger test network. No real funds moved.');
}

// Run it, and print a friendly message if anything goes wrong.
main().catch((error) => {
  console.error('\nThe walkthrough stopped early:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
