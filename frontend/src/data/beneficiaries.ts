/** Demo: one wallet for gov, escrow, and agent — matches backend SPAZA credentials. */
export const DEMO_WALLET = 'https://ilp.interledger-test.dev/spaza-shop' as const;

export const WALLETS = {
  gov:    DEMO_WALLET,
  escrow: DEMO_WALLET,
  agent:  DEMO_WALLET,
} as const;

export const AGENT_SHOP_NAME = "Joe's Spaza";

export type BeneficiaryLanguage = 'zu' | 'xh' | 'st' | 'en';

export interface BeneficiaryGrant {
  id: string;
  name: string;
  idNumber: string;
  phone: string;
  language: BeneficiaryLanguage;
  amount: number;
  assetCode: string;
  assetScale: number;
  status: 'PENDING' | 'COLLECTED';
}

export const TEST_PHONE = '+27660826868';

export const PENDING_GRANTS: BeneficiaryGrant[] = [
  {
    id: '1',
    name: 'Mama Dlamini',
    idNumber: '4501015009087',
    phone: TEST_PHONE,
    language: 'zu',
    amount: 240000,
    assetCode: 'ZAR',
    assetScale: 2,
    status: 'PENDING',
  },
  {
    id: '2',
    name: 'Gogo Nkosi',
    idNumber: '3807204800083',
    phone: TEST_PHONE,
    language: 'xh',
    amount: 240000,
    assetCode: 'ZAR',
    assetScale: 2,
    status: 'PENDING',
  },
  {
    id: '3',
    name: 'Ouma Botha',
    idNumber: '4203154900081',
    phone: TEST_PHONE,
    language: 'st',
    amount: 240000,
    assetCode: 'ZAR',
    assetScale: 2,
    status: 'PENDING',
  },
];
