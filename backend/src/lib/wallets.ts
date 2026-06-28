import { normaliseWalletAddress } from './openPayments';

export interface WalletCredentials {
  walletAddress: string;
  keyId: string;
  privateKeyPath: string;
}

/** Single demo wallet — all roles share spaza-shop so one key pair is enough. */
export const DEMO_WALLET = '$ilp.interledger-test.dev/spaza-shop' as const;

/** Role-specific aliases (same address) — used by notify + frontend parity. */
export const DEMO_WALLET_URLS = {
  sassa:  DEMO_WALLET,
  escrow: DEMO_WALLET,
  spaza:  DEMO_WALLET,
} as const;

export function walletKey(url: string): string {
  return normaliseWalletAddress(url).replace(/\/$/, '').toLowerCase();
}

export function findWalletCredentials(
  url: string,
  registry: WalletCredentials[]
): WalletCredentials {
  const key = walletKey(url);
  const found = registry.find(w => walletKey(w.walletAddress) === key);
  if (!found) {
    throw new Error(
      `No Open Payments credentials for wallet ${url}. ` +
      `Set SPAZA_WALLET / SPAZA_KEY_ID / SPAZA_KEY_PATH in backend/.env ` +
      `(demo uses $ilp.interledger-test.dev/spaza-shop for all roles).`
    );
  }
  return found;
}
