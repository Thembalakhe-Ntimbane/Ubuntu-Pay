import { createAuthenticatedClient } from '@interledger/open-payments';
import * as fs from 'fs';

// ========================================================
// CONFIGURATION
// ========================================================
const CLIENT_WALLET = 'https://ilp.interledger-test.dev/sassa-gov';
const DESTINATION_WALLET = 'https://ilp.interledger-test.dev/ubuntu';
const KEY_ID = 'eda49bf0-9e00-4b5c-a281-bb3b45727e0e'; 
const PRIVATE_KEY = fs.readFileSync('private.key', 'utf8');

// Helper to fetch metadata without relying on SDK versions
async function getWalletMetadata(url) {
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error(`Could not fetch metadata from ${url}: ${response.statusText}`);
  return await response.json();
}

async function runTest() {
  console.log("--- Starting SASSA to Ubuntu Payment Flow ---");

  // 1. Resolve Wallet Metadata (Using native fetch - 100% reliable)
  console.log("Resolving wallet metadata via network fetch...");
  const sassa = await getWalletMetadata(CLIENT_WALLET);
  const ubuntu = await getWalletMetadata(DESTINATION_WALLET);
  console.log("✅ Wallets resolved.");

  // 2. Initialize Authenticated Client
  const client = await createAuthenticatedClient({
    walletAddressUrl: CLIENT_WALLET,
    privateKey: PRIVATE_KEY,
    keyId: KEY_ID
  });

  // 3. Request Grant from SASSA Auth Server
  console.log("Requesting payment grant...");
  const grant = await client.grant.request(
    { url: sassa.authServer }, 
    {
      access_token: {
        access: [{ type: 'incoming-payment', actions: ['create', 'read'] }]
      }
    }
  );
  console.log("✅ Grant received.");

  // 4. Create Incoming Payment on Ubuntu
  console.log("Creating incoming payment on Ubuntu...");
  const payment = await client.incomingPayment.create(
    {
      url: ubuntu.resourceServer,
      accessToken: grant.access_token.value
    },
    {
      walletAddress: ubuntu.id,
      incomingAmount: {
        value: '500', 
        assetCode: ubuntu.assetCode,
        assetScale: ubuntu.assetScale
      }
    }
  );

  console.log("\n🎉 SUCCESS! Payment created.");
  console.log("Payment ID:", payment.id);
  console.log("Payment Status:", payment.status);
}

// Execute the test
runTest().catch((err) => {
  console.error("\n❌ FAILED:");
  if (err.response) {
    console.error("Status:", err.response.status);
    console.error("Data:", JSON.stringify(err.response.data, null, 2));
  } else {
    console.error(err.message);
  }
});