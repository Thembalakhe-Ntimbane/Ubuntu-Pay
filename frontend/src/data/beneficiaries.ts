export const WALLETS = {
  gov:    'https://ilp.interledger-test.dev/sassa-gov',
  escrow: 'https://ilp.interledger-test.dev/ubuntupay-escrow',
  agent:  'https://ilp.interledger-test.dev/spaza-shop',
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
    amount: 2090,
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
    amount: 2090,
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
    amount: 2090,
    assetCode: 'ZAR',
    assetScale: 2,
    status: 'PENDING',
  },
];
