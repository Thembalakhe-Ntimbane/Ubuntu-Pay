import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAuthenticatedClient,
  isFinalizedGrant,
  OpenPaymentsClientError,
} from "@interledger/open-payments";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Config ─────────────────────────────────────────────────────────────────
const PRIVATE_KEY_PATH = "./private.key";
const KEY_ID           = "eda49bf0-9e00-4b5c-a281-bb3b45727e0e";
const SENDING_WALLET   = "https://ilp.interledger-test.dev/sassa-gov";
const RECEIVING_WALLET = "https://ilp.interledger-test.dev/ubuntu";
const PORT             = 3000;
const CALLBACK_PORT    = 3999;

// In-memory session store
const sessions = {};

// ── Step 1: Initiate payment — returns redirect URL for grant approval ──────
app.post("/api/initiate", async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  try {
    const client = await createAuthenticatedClient({
      walletAddressUrl: SENDING_WALLET,
      keyId:            KEY_ID,
      privateKey:       PRIVATE_KEY_PATH,
    });

    // Get wallet addresses
    const sendingWallet   = await client.walletAddress.get({ url: SENDING_WALLET });
    const receivingWallet = await client.walletAddress.get({ url: RECEIVING_WALLET });

    // Incoming payment grant
    const incomingGrant = await client.grant.request(
      { url: receivingWallet.authServer },
      {
        access_token: {
          access: [{ type: "incoming-payment", actions: ["read", "complete", "create"] }],
        },
      }
    );
    if (!isFinalizedGrant(incomingGrant)) throw new Error("Incoming grant not finalized");

    // Create incoming payment
    const incomingPayment = await client.incomingPayment.create(
      { url: receivingWallet.resourceServer, accessToken: incomingGrant.access_token.value },
      {
        walletAddress: receivingWallet.id,
        incomingAmount: {
          assetCode:  receivingWallet.assetCode,
          assetScale: receivingWallet.assetScale,
          value:      String(Math.round(amount * Math.pow(10, receivingWallet.assetScale))),
        },
        metadata: { description: "QuikPay micro-remittance" },
      }
    );

    // Quote grant
    const quoteGrant = await client.grant.request(
      { url: sendingWallet.authServer },
      { access_token: { access: [{ type: "quote", actions: ["create", "read"] }] } }
    );
    if (!isFinalizedGrant(quoteGrant)) throw new Error("Quote grant not finalized");

    // Create quote
    const quote = await client.quote.create(
      { url: sendingWallet.resourceServer, accessToken: quoteGrant.access_token.value },
      { walletAddress: sendingWallet.id, receiver: incomingPayment.id, method: "ilp" }
    );

    const nonce = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    // Request outgoing payment grant (interactive)
    const outgoingGrant = await client.grant.request(
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
            uri:     `http://localhost:${CALLBACK_PORT}/callback`,
            nonce,
          },
        },
      }
    );

    // Store session
    sessions[sessionId] = {
      client,
      quote,
      sendingWallet,
      outgoingGrant,
      interactRef: null,
      status: "pending_approval",
    };

    res.json({
      sessionId,
      redirectUrl:   outgoingGrant.interact.redirect,
      debitAmount:   quote.debitAmount,
      receiveAmount: quote.receiveAmount,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Callback server — receives interact_ref after user approves grant ───────
const callbackApp = express();
callbackApp.get("/callback", (req, res) => {
  const interactRef = req.query["interact_ref"];
  const hash        = req.query["hash"];

  // Find the pending session and store the interact ref
  const session = Object.values(sessions).find(s => s.status === "pending_approval");
  if (session) {
    session.interactRef = interactRef;
    session.status      = "approved";
  }

  res.send(`
    <html>
      <head><title>QuikPay — Approved</title></head>
      <body style="font-family:monospace;background:#0d1117;color:#3fb950;text-align:center;padding:4rem">
        <h1>✅ Payment Approved!</h1>
        <p style="color:#c9d1d9">Return to QuikPay and click <strong>Complete Payment</strong>.</p>
        <script>
          // Auto-close this tab after 2 seconds
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
    </html>
  `);
});
callbackApp.listen(CALLBACK_PORT, () => {
  console.log(`[callback] listening on http://localhost:${CALLBACK_PORT}`);
});

// ── Step 2: Complete payment after user approves ───────────────────────────
app.post("/api/complete", async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions[sessionId];

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status === "pending_approval") {
    return res.status(400).json({ error: "Grant not approved yet — please approve in the browser first" });
  }

  try {
    const { client, quote, sendingWallet, outgoingGrant, interactRef } = session;

    // Finalize grant
    const finalGrant = await client.grant.continue(
      {
        url:         outgoingGrant.continue.uri,
        accessToken: outgoingGrant.continue.access_token.value,
      },
      { interact_ref: interactRef }
    );

    if (!isFinalizedGrant(finalGrant)) {
      return res.status(400).json({ error: "Grant not finalized — did you approve it?" });
    }

    // Create outgoing payment — money moves here
    const outgoingPayment = await client.outgoingPayment.create(
      { url: sendingWallet.resourceServer, accessToken: finalGrant.access_token.value },
      {
        walletAddress: sendingWallet.id,
        quoteId:       quote.id,
        metadata:      { description: "QuikPay micro-remittance" },
      }
    );

    // Poll for final state
    await new Promise(r => setTimeout(r, 2000));
    const finalPayment = await client.outgoingPayment.get({
      url:         outgoingPayment.id,
      accessToken: finalGrant.access_token.value,
    });

    session.status = "complete";
    delete sessions[sessionId];

    res.json({
      success:      true,
      paymentId:    finalPayment.id,
      sentAmount:   finalPayment.sentAmount,
      receiveAmount: finalPayment.receiveAmount,
      state:        finalPayment.state,
      from:         SENDING_WALLET,
      to:           RECEIVING_WALLET,
    });

  } catch (err) {
    console.error(err);
    if (err instanceof OpenPaymentsClientError) {
      return res.status(400).json({ error: "Grant error — rerun the payment." });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Check session status ───────────────────────────────────────────────────
app.get("/api/status/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.json({ status: "not_found" });
  res.json({ status: session.status });
});

app.listen(PORT, () => {
  console.log(`\n🚀 QuikPay running at http://localhost:${PORT}\n`);
});
