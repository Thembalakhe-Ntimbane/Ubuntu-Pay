import type { ErrorRequestHandler } from 'express';

const WALLET_HINT =
  'Check SPAZA_WALLET, SPAZA_KEY_ID, and SPAZA_KEY_PATH in backend/.env. ' +
  'Demo uses $ilp.interledger-test.dev/spaza-shop for all roles — set that in your profile too.';

function friendlyMessage(status: number, message: string): string {
  const lower = message.toLowerCase();

  if (
    status === 403 ||
    lower.includes('forbidden') ||
    lower.includes('no open payments credentials')
  ) {
    return `Wallet access denied — ${WALLET_HINT} Original: ${message}`;
  }

  if (lower.includes('could not load private key') || lower.includes('begin public key')) {
    return (
      `Invalid wallet private key — backend/SPAZA.key must be your PRIVATE key file ` +
      `(starts with "-----BEGIN PRIVATE KEY-----"), not the public key. ` +
      `Download it from https://wallet.interledger-test.dev/spaza-shop → Keys. Original: ${message}`
    );
  }

  return message;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = (err as any).status ?? (err as any).statusCode ?? 500;
  const raw: string = err instanceof Error ? err.message : 'Internal server error';
  console.error('[error]', err);
  res.status(status).json({ error: friendlyMessage(status, raw) });
};
