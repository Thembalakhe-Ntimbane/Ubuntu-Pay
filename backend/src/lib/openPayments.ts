import {
  createAuthenticatedClient,
  isPendingGrant,
  isFinalizedGrantWithAccessToken,
} from '@interledger/open-payments';
import type { Grant, GrantContinuation, GrantWithAccessToken, PendingGrant } from '@interledger/open-payments';
import { config } from '../config';
import { findWalletCredentials, type WalletCredentials } from './wallets';

const _clients = new Map<string, Awaited<ReturnType<typeof createAuthenticatedClient>>>();

async function createClient(creds: WalletCredentials) {
  return createAuthenticatedClient({
    walletAddressUrl: creds.walletAddress,
    keyId:            creds.keyId,
    privateKey:       creds.privateKeyPath,
  });
}

export async function getClientForWallet(walletAddressUrl: string) {
  const creds = findWalletCredentials(walletAddressUrl, config.wallets);
  const cacheKey = creds.keyId;
  if (!_clients.has(cacheKey)) {
    _clients.set(cacheKey, await createClient(creds));
  }
  return _clients.get(cacheKey)!;
}

/** Default client — SASSA gov wallet (legacy callers). */
export async function getClient() {
  return getClientForWallet(config.wallets[0].walletAddress);
}

export function normaliseWalletAddress(addr: string): string {
  return addr.startsWith('$') ? `https://${addr.slice(1)}` : addr;
}

export function isFinalizedGrant(
  grant: PendingGrant | GrantContinuation | Grant
): grant is GrantWithAccessToken {
  return !isPendingGrant(grant) && isFinalizedGrantWithAccessToken(grant);
}
