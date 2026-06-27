import 'dotenv/config';
import path from 'node:path';
import type { WalletCredentials } from './lib/wallets';
import { DEMO_WALLET_URLS } from './lib/wallets';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}\nCopy backend/.env.example → backend/.env and fill in your credentials.`);
  return val;
}

function walletFromEnv(prefix: string, defaultAddress: string): WalletCredentials {
  return {
    walletAddress: process.env[`${prefix}_WALLET`] ?? defaultAddress,
    keyId:         required(`${prefix}_KEY_ID`),
    privateKeyPath: path.resolve(
      process.cwd(),
      process.env[`${prefix}_KEY_PATH`] ?? `./${prefix}.key`
    ),
  };
}

function loadWallets(): WalletCredentials[] {
  return [
    walletFromEnv('GOV',  DEMO_WALLET_URLS.sassa),
    walletFromEnv('ESCROW', DEMO_WALLET_URLS.escrow),
    walletFromEnv('SPAZA',  DEMO_WALLET_URLS.spaza),
  ];
}

export const config = {
  port:        Number(process.env.PORT ?? 3001),
  backendUrl:  process.env.BACKEND_URL ?? 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  wallets: loadWallets(),

  db: {
    path: process.env.DB_PATH ?? './openremit.db',
  },

  jwtSecret: process.env.JWT_SECRET ?? 'changeme',

  africasTalking: {
    username: process.env.AT_USERNAME ?? '',
    apiKey:   process.env.AT_API_KEY ?? '',
    senderId: process.env.AT_SENDER_ID ?? 'UbuntuPay',
    /** Caller ID for voice calls — must be a number registered with Africa's Talking. */
    voiceFrom: process.env.AT_VOICE_FROM ?? '',
    /** Default test recipient for voice/SMS smoke tests. */
    testPhone: process.env.AT_TEST_PHONE ?? '+27660826868',
    enabled:  Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME),
  },

  agentShopName: process.env.AGENT_SHOP_NAME ?? "Joe's Spaza",

  /** App operator wallet (SASSA gov — used by legacy news routes). */
  get defaultWallet(): string {
    return this.wallets[0]?.walletAddress ?? DEMO_WALLET_URLS.sassa;
  },
};

if (config.jwtSecret === 'changeme') {
  console.warn('[config] JWT_SECRET is the default placeholder — set a long random value in backend/.env before deploying.');
}

if (!config.africasTalking.enabled) {
  console.warn('[config] Africa\'s Talking not configured — SMS/voice notifications will be logged to the console only.');
} else if (!config.africasTalking.voiceFrom) {
  console.warn('[config] AT_VOICE_FROM not set — voice calls will be skipped (SMS still works).');
}
