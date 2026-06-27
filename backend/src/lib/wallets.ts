import { normaliseWalletAddress } from './openPayments';

export interface WalletCredentials {
  walletAddress: string;
  keyId: string;
  privateKeyPath: string;
}

/** Ubuntu Pay demo wallets — credentials loaded from env in config.ts */
export const DEMO_WALLET_URLS = {
  sassa:  'https://ilp.interledger-test.dev/sassa-gov',
  escrow: 'https://ilp.interledger-test.dev/ubuntupay-escrow',
  spaza:  'https://ilp.interledger-test.dev/spaza-shop',
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
      `Configure SASSA_*, ESCROW_*, and SPAZA_* in backend/.env`
    );
  }
  return found;
}
