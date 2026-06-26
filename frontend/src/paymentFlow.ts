import { WALLETS } from './data/beneficiaries';

export type PaymentFlow = 'remit' | 'agent';

function isEscrow(url: string): boolean {
  return url.includes('ubuntupay-escrow') || url.replace(/\/$/, '') === WALLETS.escrow.replace(/\/$/, '');
}

/** Infer whether a transaction is a gov disburse or agent collection. */
export function inferPaymentFlow(tx: {
  senderWalletAddress:   string;
  receiverWalletAddress: string;
}): PaymentFlow {
  if (isEscrow(tx.receiverWalletAddress)) return 'remit';
  if (isEscrow(tx.senderWalletAddress))   return 'agent';
  return 'remit';
}

export function flowHomeHash(flow: PaymentFlow): string {
  return flow === 'agent' ? '#/agent' : '#/remit';
}

export function flowCompleteLabel(flow: PaymentFlow): string {
  return flow === 'agent' ? 'Back to agent dashboard' : 'New disbursement';
}
