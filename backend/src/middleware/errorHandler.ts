import type { ErrorRequestHandler } from 'express';

const WALLET_HINT =
  'Check SASSA_*, ESCROW_*, and SPAZA_* keys in backend/.env. ' +
  'For disburse, your profile wallet must be $ilp.interledger-test.dev/sassa-gov.';

function friendlyMessage(status: number, message: string): string {
  const lower = message.toLowerCase();

  if (
    status === 403 ||
    lower.includes('forbidden') ||
    lower.includes('no open payments credentials')
  ) {
    return `Wallet access denied — ${WALLET_HINT} Original: ${message}`;
  }

  return message;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status: number = (err as any).status ?? (err as any).statusCode ?? 500;
  const raw: string = err instanceof Error ? err.message : 'Internal server error';
  console.error('[error]', err);
  res.status(status).json({ error: friendlyMessage(status, raw) });
};
