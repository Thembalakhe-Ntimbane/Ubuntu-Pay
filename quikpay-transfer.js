/**
 * QuikPay — ILP Transfer Script
 *
 * Sends money from the SASSA wallet to the Ubuntu wallet
 * using the Interledger Open Payments protocol.
 *
 * SENDING:   $ilp.interledger-test.dev/sassa-gov
 * RECEIVING: $ilp.interledger-test.dev/ubuntu
 *
 * Run: node quikpay-transfer.js
 */

import {
  createAuthenticatedClient,
  isFinalizedGrant,
  OpenPaymentsClientError,
} from "@interledger/open-payments";
import readline from "readline/promises";
import express from "express";

// ── Config ─────────────────────────────────────────────────────────────────

const PRIVATE_KEY_PATH = "./private.key";
const KEY_ID           = "eda49bf0-9e00-4b5c-a281-bb3b45727e0e";

// Wallet addresses — must start with https://
const SENDING_WALLET   = "https://ilp.interledger-test.dev/sassa-gov";
const RECEIVING_WALLET = "https://ilp.interledger-test.dev/ubuntu";

// Amount to send (in the asset's smallest unit — e.g. cents for USD)
const SEND_AMOUNT = "1000"; // e.g. 1000 = 10.00 if scale is 2

const CALLBACK_PORT = 3999;

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║    QuikPay — ILP Transfer                    ║");
  console.log("║    Interledger Open Payments Protocol        ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // ── Step 1: Create authenticated client ──────────────────────────────────
  console.log("Step 1: Creating authenticated ILP client...");
  const client = await createAuthenticatedClient({
    walletAddressUrl: SENDING_WALLET,
    keyId:            KEY_ID,
    privateKey:       PRIVATE_KEY_PATH,
  });
  console.log("✅ Client authenticated.\n");

  // ── Step 2: Get wallet addresses ─────────────────────────────────────────
  console.log("Step 2: Fetching wallet addresses...");
  const sendingWallet   = await client.walletAddress.get({ url: SENDING_WALLET });
  const receivingWallet = await client.walletAddress.get({ url: RECEIVING_WALLET });

  console.log(`✅ Sending wallet:   ${sendingWallet.id}`);
  console.log(`   Asset: ${sendingWallet.assetCode} (scale: ${sendingWallet.assetScale})`);
  console.log(`✅ Receiving wallet: ${receivingWallet.id}`);
  console.log(`   Asset: ${receivingWallet.assetCode} (scale: ${receivingWallet.assetScale})\n`);

  // ── Step 3: Get incoming payment grant ───────────────────────────────────
  console.log("Step 3: Requesting incoming payment grant on receiving wallet...");
  const incomingPaymentGrant = await client.grant.request(
    { url: receivingWallet.authServer },
    {
      access_token: {
        access: [
          { type: "incoming-payment", actions: ["read", "complete", "create"] },
        ],
      },
    }
  );

  if (!isFinalizedGrant(incomingPaymentGrant)) {
    throw new Error("Expected finalized incoming payment grant");
  }
  console.log("✅ Incoming payment grant received.\n");

  // ── Step 4: Create incoming payment ──────────────────────────────────────
  console.log("Step 4: Creating incoming payment on receiving wallet...");
  const incomingPayment = await client.incomingPayment.create(
    {
      url:         receivingWallet.resourceServer,
      accessToken: incomingPaymentGrant.access_token.value,
    },
    {
      walletAddress: receivingWallet.id,
      incomingAmount: {
        assetCode:  receivingWallet.assetCode,
        assetScale: receivingWallet.assetScale,
        value:      SEND_AMOUNT,
      },
      metadata: {
        description: "QuikPay — spaza shop micro-remittance",
        sender:      "sassa-gov",
        receiver:    "ubuntu",
      },
    }
  );

  console.log(`✅ Incoming payment created.`);
  console.log(`   ID:     ${incomingPayment.id}`);
  console.log(`   Amount: ${SEND_AMOUNT} ${receivingWallet.assetCode}\n`);

  // ── Step 5: Get quote grant ───────────────────────────────────────────────
  console.log("Step 5: Requesting quote grant on sending wallet...");
  const quoteGrant = await client.grant.request(
    { url: sendingWallet.authServer },
    {
      access_token: {
        access: [{ type: "quote", actions: ["create", "read"] }],
      },
    }
  );

  if (!isFinalizedGrant(quoteGrant)) {
    throw new Error("Expected finalized quote grant");
  }
  console.log("✅ Quote grant received.\n");

  // ── Step 6: Create quote ──────────────────────────────────────────────────
  console.log("Step 6: Creating quote (calculating fees and FX)...");
  const quote = await client.quote.create(
    {
      url:         sendingWallet.resourceServer,
      accessToken: quoteGrant.access_token.value,
    },
    {
      walletAddress: sendingWallet.id,
      receiver:      incomingPayment.id,
      method:        "ilp",
    }
  );

  console.log(`✅ Quote created.`);
  console.log(`   You send:     ${quote.debitAmount.value} ${quote.debitAmount.assetCode}`);
  console.log(`   They receive: ${quote.receiveAmount.value} ${quote.receiveAmount.assetCode}\n`);

  // ── Step 7: Request outgoing payment grant (interactive) ─────────────────
  console.log("Step 7: Requesting outgoing payment grant...");
  console.log("⚠️  This requires YOU to approve it in your browser.\n");

  const outgoingPaymentGrant = await client.grant.request(
    { url: sendingWallet.authServer },
    {
      access_token: {
        access: [
          {
            type:    "outgoing-payment",
            actions: ["read", "create"],
            limits: {
              debitAmount: {
                assetCode:  quote.debitAmount.assetCode,
                assetScale: quote.debitAmount.assetScale,
                value:      quote.debitAmount.value,
              },
            },
            identifier: sendingWallet.id,
          },
        ],
      },
      interact: {
        start: ["redirect"],
        finish: {
          method:  "redirect",
          uri:     `http://localhost:${CALLBACK_PORT}`,
          nonce:   crypto.randomUUID(),
        },
      },
    }
  );

  console.log("👉 Open this URL in your browser to approve the payment:\n");
  console.log(`   ${outgoingPaymentGrant.interact.redirect}\n`);

  // Wait for the redirect callback
  const interactRef = await getInteractRef(CALLBACK_PORT);

  // Ask user to confirm they approved
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
  await rl.question("Press Enter after approving the grant in the browser...");
  rl.close();

  // ── Step 8: Continue grant ────────────────────────────────────────────────
  console.log("\nStep 8: Finalising grant...");
  let finalGrant;

  try {
    finalGrant = await client.grant.continue(
      {
        url:         outgoingPaymentGrant.continue.uri,
        accessToken: outgoingPaymentGrant.continue.access_token.value,
      },
      { interact_ref: interactRef }
    );
  } catch (err) {
    if (err instanceof OpenPaymentsClientError) {
      console.error("❌ Grant not approved yet — re-run the script and approve the URL.");
      process.exit(1);
    }
    throw err;
  }

  if (!isFinalizedGrant(finalGrant)) {
    console.error("❌ Grant was not finalized. Did you approve it?");
    process.exit(1);
  }
  console.log("✅ Grant finalized.\n");

  // ── Step 9: Create outgoing payment — money moves now ────────────────────
  console.log("Step 9: Sending payment over ILP...");
  const outgoingPayment = await client.outgoingPayment.create(
    {
      url:         sendingWallet.resourceServer,
      accessToken: finalGrant.access_token.value,
    },
    {
      walletAddress: sendingWallet.id,
      quoteId:       quote.id,
      metadata: {
        description: "QuikPay — spaza shop micro-remittance",
      },
    }
  );

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  ✅ PAYMENT SENT SUCCESSFULLY                 ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\n   Payment ID:   ${outgoingPayment.id}`);
  console.log(`   Sent amount:  ${outgoingPayment.sentAmount?.value} ${outgoingPayment.sentAmount?.assetCode}`);
  console.log(`   State:        ${outgoingPayment.state}`);
  console.log(`\n   From: ${SENDING_WALLET}`);
  console.log(`   To:   ${RECEIVING_WALLET}\n`);

  process.exit(0);
})();




// ── Callback server — catches the redirect after grant approval ────────────

function getInteractRef(port) {
  return new Promise((resolve) => {
    const app = express();
    let server;

    app.get("/", (req, res) => {
      const interactRef = req.query["interact_ref"];
      res.send(`
        <html>
          <body style="font-family:monospace;padding:2rem;text-align:center;background:#0d1117;color:#3fb950">
            <h1>✅ QuikPay — Grant Approved!</h1>
            <p>Return to your terminal and press Enter to complete the payment.</p>
          </body>
        </html>
      `);
      server.close();
      resolve(interactRef);
    });

    server = app.listen(port, () => {
      console.log(`   Callback server listening on http://localhost:${port}`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${port} in use — run: lsof -ti:${port} | xargs kill -9`);
        process.exit(1);
      }
    });
  });
}