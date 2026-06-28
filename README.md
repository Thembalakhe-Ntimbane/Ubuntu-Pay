# Ubuntu Pay

> **SASSA grant disbursement on Interledger** — government disbursement, escrow holding, spaza-agent collection, and multilingual SMS notifications.

Ubuntu Pay demonstrates how South African social grants can reach unbanked beneficiaries through [Interledger Open Payments](https://openpayments.dev/): funds move from a government wallet into escrow, beneficiaries receive an SMS in their home language, and a local spaza agent releases the grant after ID verification.

---

## Built on OpenRemit

This project started from the **[OpenRemit](https://github.com/marclevin/OpenRemit)** template — a TypeScript monorepo for peer-to-peer Open Payments with JWT auth, quote/consent flows, and payment requests. We adapted that foundation for a **grant disbursement** use case: SASSA-style payouts, beneficiary queues, agent dashboards, and Africa's Talking notifications.

Thank you to the OpenRemit authors for the SDK patterns, shared quote flow, and clean architecture that made this demo possible.

---

## What it does

| Phase | Who | Action |
|-------|-----|--------|
| **1 — Disburse** | Government user | Search beneficiary by ID → send **R2,400** grant to escrow |
| **2 — Notify** | System | SMS preview (isiZulu, isiXhosa, Sesotho, or English) |
| **3 — Collect** | Spaza agent | Verify ID → release grant from escrow to agent wallet |

The full Open Payments pipeline runs end to end: wallet discovery → incoming payment → quote → interactive consent → outgoing payment.

---

## Demo wallet setup

For local development we use **one test wallet** for every role (government, escrow, and agent). That keeps setup simple — you only need one key pair on the Interledger test network.

| Role | Wallet address |
|------|----------------|
| Government · Escrow · Agent | `$ilp.interledger-test.dev/spaza-shop` |

Create the wallet at [wallet.interledger-test.dev](https://wallet.interledger-test.dev), generate a key pair, and configure `SPAZA_*` in `backend/.env` (see [Quick start](#quick-start)).

> In production you would use separate wallets for each role. The demo intentionally collapses them so you can run the full flow with a single account.

---

## Quick start

### Prerequisites

- **Node.js 20+**
- A test wallet at [wallet.interledger-test.dev](https://wallet.interledger-test.dev) with a **private** key uploaded (starts with `-----BEGIN PRIVATE KEY-----`)

### 1. Clone & install

```bash
git clone <your-repo-url> ubuntupay && cd ubuntupay
npm install
```

### 2. Configure wallet credentials

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

| Variable | Description |
|----------|-------------|
| `SPAZA_WALLET` | Wallet address (default: `https://ilp.interledger-test.dev/spaza-shop`) |
| `SPAZA_KEY_ID` | Key ID shown on the wallet after uploading your public key |
| `SPAZA_KEY_PATH` | Path to your **private** key file (default: `./SPAZA.key`) |
| `AGENT_SHOP_NAME` | Shop name in SMS copy (default: Joe's Spaza) |

Place your private key at `backend/SPAZA.key`. Never commit `*.key` files.

**Need a new key pair?**

```bash
npm run generate-key --workspace=backend
```

Upload `backend/SPAZA.public.pem` to your wallet, copy the assigned key ID into `SPAZA_KEY_ID`, and restart.

### 3. Initialise the database

```bash
npm run db:push
```

### 4. Start

```bash
npm run dev      # backend :3001 + frontend :5173
```

Open [http://localhost:5173](http://localhost:5173).

---

## Demo walkthrough

1. **Sign up / log in** as a government user.
2. **Profile** → set wallet to `$ilp.interledger-test.dev/spaza-shop`.
3. **Disburse** → search beneficiary ID `4501015009087` (Mama Dlamini) → **Disburse to Escrow** (**R2,400**).
4. **Authorise** at the Interledger test wallet when prompted.
5. **Status page** shows the completed transfer and an **SMS preview** (*"In production this fires via Africa's Talking API."*).
6. **Agent dashboard** → same profile wallet → verify the beneficiary ID → **Release Payment**.

### Beneficiary queue

Demo grants are defined in `frontend/src/data/beneficiaries.ts` — three grandmothers, **R2,400** each (amount `240000` in ZAR smallest units, scale 2).

### SMS (Africa's Talking)

When a disbursement completes, the backend calls `notificationForCompletedPayment()` and sends via [Africa's Talking](https://africastalking.com/) when `AT_*` env vars are set. Without credentials, SMS is logged to the console and shown on the status page. Messages support isiZulu, isiXhosa, Sesotho, and English.

---

## The Open Payments flow

```
  Frontend                 Backend                   Open Payments Network
  ──────────────────────   ──────────────────────── ────────────────────────
  1. Fill in form          POST /api/remit/quote
     (wallets + amount)    ├─ walletAddress.get()   ──► Resolve both wallets
                           ├─ grant.request()       ──► Incoming-payment grant
                           ├─ incomingPayment.create()► Create incoming payment
                           ├─ grant.request()       ──► Quote grant
                           └─ quote.create()        ──► Get quote & fee

  2. Review quote          POST /api/remit/consent
     → click Authorise     ├─ grant.request()       ──► Interactive outgoing grant
                           └─ returns interactUrl

  3. Browser redirected ──────────────────────────────► Auth server consent page
     to auth server                                      (user approves)

  4. Auth server       ──► GET /api/callback
     redirects back        ├─ grant.continue()      ──► Exchange interact_ref
                           ├─ outgoingPayment.create()► Execute payment
                           ├─ notifyBeneficiary()   ──► SMS via Africa's Talking
                           └─ redirect to frontend

  5. Status view polls     GET /api/remit/status/:id
     until COMPLETED       (includes smsPreview on disburse)
```

**Core remit routes**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/remit/quote` | Resolve wallets, create incoming payment + quote |
| `POST` | `/api/remit/consent` | Request interactive outgoing grant, return interact URL |
| `GET` | `/api/callback` | Continue grant, create outgoing payment, trigger SMS |
| `GET` | `/api/remit/status/:id` | Poll transaction state (+ SMS preview when complete) |
| `GET` | `/api/remit/history` | Current user's payment history |
| `GET` | `/api/remit/wallet-info?url=…` | Resolve a wallet's currency before quoting |

**Auth & users** (remit routes except `/status/:id` require a `Bearer` token)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/signup`, `/api/auth/login` | Issue a 7-day JWT |
| `GET` / `PATCH` | `/api/auth/me` | Read / update profile (name, email, password, wallet, avatar) |
| `GET` | `/api/users/search?q=…` | Find users by display name |
| `GET` | `/api/users/:id` | Public profile + shared transactions |

**Payment requests ("asks")**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/requests` | Ask another user to send money |
| `GET` | `/api/requests` | Incoming and outgoing asks |
| `POST` | `/api/requests/:id/fulfill` | Payer accepts → runs shared quote flow |
| `POST` | `/api/requests/:id/decline` / `cancel` | Decline or cancel an ask |

---

## Architecture

```
Ubuntu-Pay/
├── package.json               ← workspace root — `npm run dev` starts everything
│
├── backend/
│   ├── examples/
│   │   ├── p2p-open-payments-walkthrough.ts   ← standalone SDK reference
│   │   └── ubuntupay-disburse.ts              ← gov → escrow → agent script
│   ├── scripts/
│   │   └── generate-key.ts                    ← generate Ed25519 key pair for test wallet
│   └── src/
│       ├── index.ts           ← Express entry point
│       ├── config.ts          ← env vars + wallet credentials
│       ├── lib/
│       │   ├── openPayments.ts← authenticated SDK client per wallet
│       │   ├── quoteFlow.ts   ← shared resolve → incoming payment → quote
│       │   ├── wallets.ts     ← demo wallet URLs + credential lookup
│       │   ├── privateKey.ts  ← key file validation + path resolution
│       │   └── notify.ts      ← Africa's Talking SMS + voice
│       ├── db/
│       │   ├── schema.ts      ← users, transactions, payment_requests
│       │   └── index.ts       ← Drizzle + SQLite
│       ├── routes/
│       │   ├── remit.ts       ← quote / consent / status / history
│       │   ├── callback.ts    ← GNAP redirect handler
│       │   ├── auth.ts        ← signup / login / profile
│       │   ├── users.ts       ← search + public profiles
│       │   ├── requests.ts    ← payment requests
│       │   └── notify.ts      ← notification helpers
│       └── middleware/
│           ├── requireAuth.ts
│           └── errorHandler.ts
│
└── frontend/
    ├── index.html
    └── src/
        ├── main.ts            ← hash router (#/remit, #/agent, …)
        ├── api.ts             ← typed fetch wrappers
        ├── auth.ts            ← JWT in localStorage
        ├── data/
        │   └── beneficiaries.ts   ← demo grant queue (R2,400 × 3)
        └── views/
            ├── quoteView.ts       ← government disburse
            ├── agentView.ts       ← spaza agent release
            ├── consentView.ts     ← confirm + redirect to wallet
            ├── statusView.ts      ← poll result + SMS preview
            ├── profileView.ts     ← wallet address + profile
            └── …
```

**Stack:** TypeScript monorepo · Backend: Node.js, Express, Drizzle ORM, SQLite · Frontend: Vite, vanilla TypeScript · Payments: `@interledger/open-payments`

---

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend (:3001) + frontend (:5173) |
| `npm run build` | Build both packages |
| `npm run db:push` | Push schema changes to SQLite |
| `npm run generate-key --workspace=backend` | Generate a new Ed25519 key pair for the test wallet |

---

## SDK quick reference

The authenticated client signs every request with your wallet's private key:

```typescript
const client = await createAuthenticatedClient({
  walletAddressUrl,
  keyId,
  privateKey: './SPAZA.key', // file path — SDK reads the PEM
});

const wallet = await client.walletAddress.get({ url: walletAddressUrl });
// wallet.authServer      → grant.request()
// wallet.resourceServer  → incomingPayment / quote / outgoingPayment create()
// wallet.id              → walletAddress in create() bodies
```

For a full walkthrough without the web server, see `backend/examples/p2p-open-payments-walkthrough.ts`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not load private key` | `SPAZA.key` must be the **private** key (`-----BEGIN PRIVATE KEY-----`), not the public key |
| `Private key file not found` | Set `SPAZA_KEY_PATH=./SPAZA.key` and ensure the file lives in `backend/` |
| `Forbidden` / wallet access denied | Profile wallet must be `$ilp.interledger-test.dev/spaza-shop`; `SPAZA_KEY_ID` must match the key registered on that wallet |
| `No Open Payments credentials for wallet …` | All demo roles use the same wallet — check `SPAZA_*` in `backend/.env` |
| Grant continuation failed | Consent was denied, expired, or already used — start again from the quote step |
| Frontend can't reach backend | Check `VITE_BACKEND_URL` in `frontend/.env` (default: `http://localhost:3001`) |

---

## Extending the project

**Separate production wallets** — point `GOV_WALLET`, `ESCROW_WALLET`, and `SPAZA_WALLET` at different addresses in `backend/.env` and register credentials for each (see `backend/src/lib/wallets.ts`).

**Change grant amounts** — edit `amount` in `frontend/src/data/beneficiaries.ts` (ZAR scale 2: R2,400 → `240000`).

**Add recurring disbursements** — add an `interval` to outgoing grant limits in `POST /api/remit/consent`.

**Deploy** — set `BACKEND_URL` and `FRONTEND_URL` to public URLs so the GNAP callback is reachable; store key files via a secrets manager, not in the repo.

---

## License & attribution

Ubuntu Pay is a demo application built on the [OpenRemit](https://github.com/marclevin/OpenRemit) template. Interledger Open Payments is an open protocol — see [openpayments.dev](https://openpayments.dev/) for specification and SDK documentation.
