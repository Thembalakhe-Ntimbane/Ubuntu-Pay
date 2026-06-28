import {
  createAuthenticatedClient,
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
} from '@interledger/open-payments';
import { createInterface } from 'node:readline/promises';

const CONFIG = {
  gov: {
    walletAddress: 'https://ilp.interledger-test.dev/sassa-gov',
    keyId: 'eda49bf0-9e00-4b5c-a281-bb3b45727e0e',
    privateKeyPath: './SASSA.key',
  },
  escrow: {
    walletAddress: 'https://ilp.interledger-test.dev/ubuntupay-escrow',
    keyId: '24cee55b-5474-490b-885d-aef7bbc01da7',
    privateKeyPath: './ESCROW.key',
  },
  agent: {
    walletAddress: 'https://ilp.interledger-test.dev/spaza-shop',
    keyId: 'e9cf0b99-f73a-4553-bf53-e85fff2383f5',
    privateKeyPath: './SPAZA.key',
  },
  grantAmount: '2400',
  assetCode: 'ZAR',
  assetScale: 2,
  beneficiary: {
    name: 'Mama Dlamini',
    idNumber: '4501015009087',
    phone: '+27731234567',
  },
};

function toUrl(address: string): string {
  return address.startsWith('$') ? `https://${address.slice(1)}` : address;
}

function getAccessToken(grant: any, label: string): string {
  if (isPendingGrant(grant) || !isFinalizedGrantWithAccessToken(grant)) {
    throw new Error(`Expected finalized ${label} grant with access token`);
  }
  return grant.access_token.value;
}

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(message);
  rl.close();
}

async function governmentToEscrow() {
  console.log('\n--- PHASE 1: Government → Ubuntu Pay Escrow ---');
  console.log(`Beneficiary: ${CONFIG.beneficiary.name} | ID: ${CONFIG.beneficiary.idNumber}`);
  console.log(`Amount: R${parseInt(CONFIG.grantAmount) / 100}`);

  const client = await createAuthenticatedClient({
    walletAddressUrl: toUrl(CONFIG.gov.walletAddress),
    keyId: CONFIG.gov.keyId,
    privateKey: CONFIG.gov.privateKeyPath,
  });

  console.log('\n[1/4] Discovering wallets...');
  const [govWallet, escrowWallet] = await Promise.all([
    client.walletAddress.get({ url: toUrl(CONFIG.gov.walletAddress) }),
    client.walletAddress.get({ url: toUrl(CONFIG.escrow.walletAddress) }),
  ]);
  console.log(`  Gov:    ${govWallet.id}`);
  console.log(`  Escrow: ${escrowWallet.id}`);

  console.log('\n[2/4] Creating incoming payment on escrow wallet...');
  const incomingGrant = await client.grant.request(
    { url: escrowWallet.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }] } }
  );
  const incomingToken = getAccessToken(incomingGrant, 'incoming-payment');

  const incomingPayment = await client.incomingPayment.create(
    { url: escrowWallet.resourceServer, accessToken: incomingToken },
    {
      walletAddress: escrowWallet.id,
      incomingAmount: {
        value: CONFIG.grantAmount,
        assetCode: CONFIG.assetCode,
        assetScale: CONFIG.assetScale,
      },
      metadata: {
        beneficiaryName: CONFIG.beneficiary.name,
        beneficiaryId: CONFIG.beneficiary.idNumber,
      },
    }
  );
  console.log(`  Incoming payment: ${incomingPayment.id}`);

  console.log('\n[3/4] Getting quote...');
  const quoteGrant = await client.grant.request(
    { url: govWallet.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } }
  );
  const quoteToken = getAccessToken(quoteGrant, 'quote');

  const quote = await client.quote.create(
    { url: govWallet.resourceServer, accessToken: quoteToken },
    {
      walletAddress: govWallet.id,
      receiver: incomingPayment.id,
      method: 'ilp',
    }
  );
  console.log(`  Send: ${quote.debitAmount.value} ${quote.debitAmount.assetCode}`);
  console.log(`  Receive: ${quote.receiveAmount.value} ${quote.receiveAmount.assetCode}`);

  console.log('\n[4/4] Requesting outgoing payment grant (requires approval)...');
  const outgoingGrant = await client.grant.request(
    { url: govWallet.authServer },
    {
      access_token: {
        access: [{
          type: 'outgoing-payment',
          actions: ['create', 'read'],
          identifier: govWallet.id,
          limits: {
            debitAmount: {
              value: quote.debitAmount.value,
              assetCode: quote.debitAmount.assetCode,
              assetScale: quote.debitAmount.assetScale,
            },
          },
        }],
      },
      interact: { start: ['redirect'] },
    }
  );

  if (!isPendingGrant(outgoingGrant) || !outgoingGrant.interact?.redirect) {
    throw new Error('Expected interactive grant with redirect');
  }

  console.log('\n  SASSA worker approval required.');
  console.log(`  Approve here: ${outgoingGrant.interact.redirect}\n`);
  await waitForEnter('  Press Enter after approving in browser...');

  const finalizedGrant = await client.grant.continue({
    url: outgoingGrant.continue.uri,
    accessToken: outgoingGrant.continue.access_token.value,
  });

  if (!isFinalizedGrantWithAccessToken(finalizedGrant)) {
    throw new Error('Grant not approved');
  }

  const outgoingPayment = await client.outgoingPayment.create(
    { url: govWallet.resourceServer, accessToken: finalizedGrant.access_token.value },
    {
      walletAddress: govWallet.id,
      quoteId: quote.id,
      metadata: {
        description: `SASSA grant disbursement - ${CONFIG.beneficiary.name}`,
        beneficiaryId: CONFIG.beneficiary.idNumber,
      },
    }
  );

  console.log(`\n  Payment ID: ${outgoingPayment.id}`);
  console.log(`  Status: ${outgoingPayment.failed ? 'FAILED' : 'SUCCESS'}`);
  console.log(`\n  SMS to ${CONFIG.beneficiary.phone}:`);
  console.log(`  "Mama Dlamini, uR${parseInt(CONFIG.grantAmount) / 100} ufike. Hamba ku-Joe's Spaza. Letha i-ID yakho."`);

  return { incomingPayment, quote, outgoingPayment };
}

async function escrowToAgent() {
  console.log('\n--- PHASE 2: Ubuntu Pay Escrow → Spaza Shop Agent ---');
  console.log(`Releasing grant for: ${CONFIG.beneficiary.name}`);

  const client = await createAuthenticatedClient({
    walletAddressUrl: toUrl(CONFIG.escrow.walletAddress),
    keyId: CONFIG.escrow.keyId,
    privateKey: CONFIG.escrow.privateKeyPath,
  });

  console.log('\n[1/4] Discovering wallets...');
  const [escrowWallet, agentWallet] = await Promise.all([
    client.walletAddress.get({ url: toUrl(CONFIG.escrow.walletAddress) }),
    client.walletAddress.get({ url: toUrl(CONFIG.agent.walletAddress) }),
  ]);
  console.log(`  Escrow: ${escrowWallet.id}`);
  console.log(`  Agent:  ${agentWallet.id}`);

  console.log('\n[2/4] Creating incoming payment on agent wallet...');
  const incomingGrant = await client.grant.request(
    { url: agentWallet.authServer },
    { access_token: { access: [{ type: 'incoming-payment', actions: ['create', 'read', 'complete'] }] } }
  );
  const incomingToken = getAccessToken(incomingGrant, 'incoming-payment');

  const incomingPayment = await client.incomingPayment.create(
    { url: agentWallet.resourceServer, accessToken: incomingToken },
    {
      walletAddress: agentWallet.id,
      incomingAmount: {
        value: CONFIG.grantAmount,
        assetCode: CONFIG.assetCode,
        assetScale: CONFIG.assetScale,
      },
      metadata: {
        beneficiaryName: CONFIG.beneficiary.name,
        beneficiaryId: CONFIG.beneficiary.idNumber,
      },
    }
  );
  console.log(`  Incoming payment: ${incomingPayment.id}`);

  console.log('\n[3/4] Getting quote...');
  const quoteGrant = await client.grant.request(
    { url: escrowWallet.authServer },
    { access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] } }
  );
  const quoteToken = getAccessToken(quoteGrant, 'quote');

  const quote = await client.quote.create(
    { url: escrowWallet.resourceServer, accessToken: quoteToken },
    {
      walletAddress: escrowWallet.id,
      receiver: incomingPayment.id,
      method: 'ilp',
    }
  );
  console.log(`  Send: ${quote.debitAmount.value} ${quote.debitAmount.assetCode}`);
  console.log(`  Receive: ${quote.receiveAmount.value} ${quote.receiveAmount.assetCode}`);

  console.log('\n[4/4] Requesting outgoing payment grant (requires approval)...');
  const outgoingGrant = await client.grant.request(
    { url: escrowWallet.authServer },
    {
      access_token: {
        access: [{
          type: 'outgoing-payment',
          actions: ['create', 'read'],
          identifier: escrowWallet.id,
          limits: {
            debitAmount: {
              value: quote.debitAmount.value,
              assetCode: quote.debitAmount.assetCode,
              assetScale: quote.debitAmount.assetScale,
            },
          },
        }],
      },
      interact: { start: ['redirect'] },
    }
  );

  if (!isPendingGrant(outgoingGrant) || !outgoingGrant.interact?.redirect) {
    throw new Error('Expected interactive grant with redirect');
  }

  console.log('\n  Escrow release approval required.');
  console.log(`  Approve here: ${outgoingGrant.interact.redirect}\n`);
  await waitForEnter('  Press Enter after approving in browser...');

  const finalizedGrant = await client.grant.continue({
    url: outgoingGrant.continue.uri,
    accessToken: outgoingGrant.continue.access_token.value,
  });

  if (!isFinalizedGrantWithAccessToken(finalizedGrant)) {
    throw new Error('Grant not approved');
  }

  const outgoingPayment = await client.outgoingPayment.create(
    { url: escrowWallet.resourceServer, accessToken: finalizedGrant.access_token.value },
    {
      walletAddress: escrowWallet.id,
      quoteId: quote.id,
      metadata: {
        description: `Ubuntu Pay payout - ${CONFIG.beneficiary.name}`,
        beneficiaryId: CONFIG.beneficiary.idNumber,
        agentId: 'spaza-shop',
      },
    }
  );

  console.log(`\n  Payment ID: ${outgoingPayment.id}`);
  console.log(`  Status: ${outgoingPayment.failed ? 'FAILED' : 'SUCCESS'}`);
  console.log(`\n  Confirmation SMS to ${CONFIG.beneficiary.phone}:`);
  console.log(`  "Mama Dlamini, your R${parseInt(CONFIG.grantAmount) / 100} has been collected at Joe's Spaza."`);
  console.log(`  Agent received R${parseInt(CONFIG.grantAmount) / 100} + service fee`);

  return { incomingPayment, quote, outgoingPayment };
}

async function main() {
  console.log('\nUbuntu Pay - Grant Disbursement System');
  console.log('Powered by Open Payments\n');

  try {
    await governmentToEscrow();

    await waitForEnter('\nGrant is in escrow. Press Enter to release to agent...');

    await escrowToAgent();

    console.log('\n--- DISBURSEMENT COMPLETE ---');
    console.log(`Beneficiary: ${CONFIG.beneficiary.name}`);
    console.log('Queue time: 0 minutes');
    console.log('Distance traveled: nearest spaza shop');
    console.log('Bank account required: No');
    console.log('Smartphone required: No');

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();