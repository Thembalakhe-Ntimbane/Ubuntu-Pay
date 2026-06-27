import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import path from "path";
import {
  createAuthenticatedClient,
  isFinalizedGrant,
} from "@interledger/open-payments";
import { notifyBeneficiary } from "./infobip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, "public")));

// ── Config ─────────────────────────────────────────────────────────────────
const PRIVATE_KEY_PATH = path.resolve(__dirname, "private.key");
const KEY_ID           = "eda49bf0-9e00-4b5c-a281-bb3b45727e0e";
const GOVT_WALLET      = "https://ilp.interledger-test.dev/sassa-gov";
const PORT             = 3000;
const CALLBACK_PORT    = 3999;

// ── Fake Database ──────────────────────────────────────────────────────────
const BENEFICIARIES = {
  "4501015800080": { name: "Nomsa Dlamini",    id: "4501015800080", age: 79, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
  "5203024200081": { name: "Thandi Mokoena",   id: "5203024200081", age: 72, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
  "4809034100082": { name: "Gladys Sithole",   id: "4809034100082", age: 76, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
  "5112023300083": { name: "Rose Khumalo",     id: "5112023300083", age: 67, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
  "4703012100084": { name: "Maria van Wyk",    id: "4703012100084", age: 81, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
  "5506021900085": { name: "Lindiwe Nkosi",    id: "5506021900085", age: 69, grant: 2400, claimed: false, claimedAt: null, claimedShop: null },
};

const SPAZA_SHOPS = {
  "shop-001": { id: "shop-001", name: "Mama Zola's Spaza",   area: "Khayelitsha, Cape Town", wallet: "https://ilp.interledger-test.dev/ubuntu", owner: "Zola Dube" },
  "shop-002": { id: "shop-002", name: "Uncle Ben's Store",   area: "Soweto, Johannesburg",   wallet: "https://ilp.interledger-test.dev/ubuntu", owner: "Ben Mokoena" },
  "shop-003": { id: "shop-003", name: "Auntie Grace's Shop", area: "Alexandra, Johannesburg", wallet: "https://ilp.interledger-test.dev/ubuntu", owner: "Grace Sithole" },
  "shop-004": { id: "shop-004", name: "Sipho's Corner",      area: "Mitchells Plain, CT",    wallet: "https://ilp.interledger-test.dev/ubuntu", owner: "Sipho Ndlovu" },
};

const transactions = [];

// ── Batch grant state ──────────────────────────────────────────────────────
let batchState = {
  status:      "idle",   // idle | pending | ready
  client:      null,
  sendingWallet: null,
  accessToken: null,
  redirectUrl: null,
  interactRef: null,
  continueUri: null,
  continueToken: null,
};

// ── ILP client factory ─────────────────────────────────────────────────────
async function getClient() {
  return await createAuthenticatedClient({
    walletAddressUrl: GOVT_WALLET,
    keyId:            KEY_ID,
    privateKey:       PRIVATE_KEY_PATH,
  });
}

// ── POST /api/setup — government pre-authorises batch payments ─────────────
app.post("/api/setup", async (req, res) => {
  try {
    const client        = await getClient();
    const sendingWallet = await client.walletAddress.get({ url: GOVT_WALLET });
    const nonce         = crypto.randomUUID();

    // Request a batch outgoing payment grant with a high spending limit
    const grant = await client.grant.request(
      { url: sendingWallet.authServer },
      {
        access_token: {
          access: [{
            type:       "outgoing-payment",
            actions:    ["read", "create"],
            limits: {
              debitAmount: {
                assetCode:  sendingWallet.assetCode,
                assetScale: sendingWallet.assetScale,
                value:      "500000", // large batch limit
              },
            },
            identifier: sendingWallet.id,
          }],
        },
        interact: {
          start:  ["redirect"],
          finish: { method: "redirect", uri: `http://localhost:${CALLBACK_PORT}/callback`, nonce },
        },
      }
    );

    batchState = {
      ...batchState,
      status:        "pending",
      client,
      sendingWallet,
      redirectUrl:   grant.interact.redirect,
      continueUri:   grant.continue.uri,
      continueToken: grant.continue.access_token.value,
      interactRef:   null,
    };

    res.json({ redirectUrl: grant.interact.redirect });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/setup/status ──────────────────────────────────────────────────
app.get("/api/setup/status", (req, res) => {
  res.json({ status: batchState.status });
});

// ── POST /api/setup/complete — finalise batch grant ───────────────────────
app.post("/api/setup/complete", async (req, res) => {
  if (batchState.status !== "approved") {
    return res.status(400).json({ error: "Grant not approved yet" });
  }
  try {
    const finalGrant = await batchState.client.grant.continue(
      { url: batchState.continueUri, accessToken: batchState.continueToken },
      { interact_ref: batchState.interactRef }
    );
    if (!isFinalizedGrant(finalGrant)) {
      return res.status(400).json({ error: "Grant not finalized" });
    }
    batchState.accessToken = finalGrant.access_token.value;
    batchState.status      = "ready";

    // ── Notify ALL beneficiaries that grants are now available ─────────────
    Object.values(BENEFICIARIES).forEach(b => {
      notifyBeneficiary(b.id, b.grant).catch(err =>
        console.error("[notify]", err.message)
      );
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Pending claims waiting for grant approval ──────────────────────────────
const pendingClaims = {};

// ── POST /api/claim — granny claims at spaza shop ─────────────────────────
app.post("/api/claim", async (req, res) => {
  const { beneficiaryId, shopId } = req.body;

  if (batchState.status !== "ready") {
    return res.status(400).json({ error: "System not ready — government must authorise first" });
  }

  const beneficiary = BENEFICIARIES[beneficiaryId];
  if (!beneficiary) return res.status(404).json({ error: "Beneficiary not found" });
  if (beneficiary.claimed) return res.status(400).json({ error: "Grant already claimed this month" });

  const shop = SPAZA_SHOPS[shopId];
  if (!shop) return res.status(404).json({ error: "Spaza shop not found" });

  try {
    const client        = await getClient();
    const sendingWallet = await client.walletAddress.get({ url: GOVT_WALLET });
    const receivingWallet = await client.walletAddress.get({ url: shop.wallet });

    // Incoming payment grant for the spaza shop
    const incomingGrant = await client.grant.request(
      { url: receivingWallet.authServer },
      { access_token: { access: [{ type: "incoming-payment", actions: ["read", "complete", "create"] }] } }
    );
    if (!isFinalizedGrant(incomingGrant)) throw new Error("Incoming grant failed");

    // Convert grant amount to asset units
    const value = String(Math.round(beneficiary.grant * Math.pow(10, receivingWallet.assetScale)));

    // Create incoming payment at spaza shop
    const incomingPayment = await client.incomingPayment.create(
      { url: receivingWallet.resourceServer, accessToken: incomingGrant.access_token.value },
      {
        walletAddress:  receivingWallet.id,
        incomingAmount: { assetCode: receivingWallet.assetCode, assetScale: receivingWallet.assetScale, value },
        metadata:       { description: `SASSA grant — ${beneficiary.name} — ${beneficiary.id}` },
      }
    );

    // Quote grant
    const quoteGrant = await client.grant.request(
      { url: sendingWallet.authServer },
      { access_token: { access: [{ type: "quote", actions: ["create", "read"] }] } }
    );
    if (!isFinalizedGrant(quoteGrant)) throw new Error("Quote grant failed");

    // Create quote
    const quote = await client.quote.create(
      { url: sendingWallet.resourceServer, accessToken: quoteGrant.access_token.value },
      { walletAddress: sendingWallet.id, receiver: incomingPayment.id, method: "ilp" }
    );

    // Request a fresh outgoing payment grant per claim (interactive)
    const claimId = crypto.randomUUID();
    const nonce   = crypto.randomUUID();

    const outgoingGrant = await client.grant.request(
      { url: sendingWallet.authServer },
      {
        access_token: {
          access: [{
            type:       "outgoing-payment",
            actions:    ["read", "create"],
            limits: {
              debitAmount: {
                assetCode:  quote.debitAmount.assetCode,
                assetScale: quote.debitAmount.assetScale,
                value:      quote.debitAmount.value,
              },
            },
            identifier: sendingWallet.id,
          }],
        },
        interact: {
          start:  ["redirect"],
          finish: { method: "redirect", uri: `http://localhost:${CALLBACK_PORT}/claim-callback`, nonce },
        },
      }
    );

    // Store pending claim
    pendingClaims[claimId] = {
      client, quote, sendingWallet, beneficiary, shop, beneficiaryId, shopId,
      receivingWallet,
      continueUri:   outgoingGrant.continue.uri,
      continueToken: outgoingGrant.continue.access_token.value,
      interactRef:   null,
      status:        "pending",
    };

    res.json({
      claimId,
      redirectUrl:   outgoingGrant.interact.redirect,
      debitAmount:   quote.debitAmount,
      receiveAmount: quote.receiveAmount,
      beneficiary,
      shop,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claim/complete — finalise after grant approval ───────────────
app.post("/api/claim/complete", async (req, res) => {
  const { claimId } = req.body;
  const claim = pendingClaims[claimId];
  if (!claim)                     return res.status(404).json({ error: "Claim not found" });
  if (claim.status === "pending") return res.status(400).json({ error: "Grant not approved yet" });

  try {
    const { client, quote, sendingWallet, beneficiary, shop, beneficiaryId, shopId, interactRef, continueUri, continueToken } = claim;

    const finalGrant = await client.grant.continue(
      { url: continueUri, accessToken: continueToken },
      { interact_ref: interactRef }
    );
    if (!isFinalizedGrant(finalGrant)) return res.status(400).json({ error: "Grant not finalized" });

    const outgoingPayment = await client.outgoingPayment.create(
      { url: sendingWallet.resourceServer, accessToken: finalGrant.access_token.value },
      {
        walletAddress: sendingWallet.id,
        quoteId:       quote.id,
        metadata:      { description: `SASSA grant — ${beneficiary.name}`, beneficiaryId, shopId },
      }
    );

    await new Promise(r => setTimeout(r, 2000));
    const final = await client.outgoingPayment.get({
      url: outgoingPayment.id, accessToken: finalGrant.access_token.value,
    });

    beneficiary.claimed     = true;
    beneficiary.claimedAt   = new Date().toISOString();
    beneficiary.claimedShop = shopId;

    const tx = {
      id:            crypto.randomUUID(),
      timestamp:     new Date().toISOString(),
      beneficiary:   beneficiary.name,
      beneficiaryId,
      shop:          shop.name,
      shopId,
      amount:        beneficiary.grant,
      assetCode:     claim.receivingWallet.assetCode,
      paymentId:     final.id,
      state:         final.state || "COMPLETED",
    };
    transactions.unshift(tx);
    delete pendingClaims[claimId];

    res.json({ success: true, transaction: tx, beneficiary, shop });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/claim/status/:claimId ─────────────────────────────────────────
app.get("/api/claim/status/:claimId", (req, res) => {
  const c = pendingClaims[req.params.claimId];
  res.json({ status: c ? c.status : "not_found" });
});

// ── GET /api/beneficiaries ─────────────────────────────────────────────────
app.get("/api/beneficiaries", (req, res) => {
  res.json(Object.values(BENEFICIARIES));
});

// ── GET /api/shops ─────────────────────────────────────────────────────────
app.get("/api/shops", (req, res) => {
  res.json(Object.values(SPAZA_SHOPS));
});

// ── GET /api/transactions ──────────────────────────────────────────────────
app.get("/api/transactions", (req, res) => {
  res.json(transactions);
});

// ── GET /api/stats ─────────────────────────────────────────────────────────
app.get("/api/stats", (req, res) => {
  const all     = Object.values(BENEFICIARIES);
  const claimed = all.filter(b => b.claimed);
  res.json({
    total:       all.length,
    claimed:     claimed.length,
    unclaimed:   all.length - claimed.length,
    totalPaid:   claimed.reduce((s, b) => s + b.grant, 0),
    totalBudget: all.reduce((s, b) => s + b.grant, 0),
    systemReady: batchState.status === "ready",
  });
});

// ── Callback server ────────────────────────────────────────────────────────
const cbApp = express();
cbApp.get("/callback", (req, res) => {
  const interactRef = req.query["interact_ref"];
  if (batchState.status === "pending") {
    batchState.interactRef = interactRef;
    batchState.status      = "approved";
  }
  res.send(`
    <html>
      <head><title>QuikPay — Approved</title></head>
      <body style="font-family:monospace;background:#0d1117;color:#3fb950;text-align:center;padding:4rem;margin:0">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h1 style="margin-bottom:8px">Government Grant Authorised!</h1>
        <p style="color:#8b949e">Return to QuikPay and click <strong style="color:#fff">Activate System</strong>.</p>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body>
    </html>
  `);
});

// Per-claim grant callback
cbApp.get("/claim-callback", (req, res) => {
  const interactRef = req.query["interact_ref"];
  const claim = Object.values(pendingClaims).find(c => c.status === "pending");
  if (claim) { claim.interactRef = interactRef; claim.status = "approved"; }
  res.send(`<html><body style="font-family:monospace;background:#0d1117;color:#3fb950;text-align:center;padding:4rem">
    <h1>✅ Payment Approved!</h1><p style="color:#8b949e">Return to QuikPay — payment is processing.</p>
    <script>setTimeout(()=>window.close(),2000)</script></body></html>`);
});
cbApp.listen(CALLBACK_PORT, () => console.log(`[callback] http://localhost:${CALLBACK_PORT}`));

app.listen(PORT, () => {
  console.log(`\n🚀 QuikPay running at http://localhost:${PORT}\n`);
});
