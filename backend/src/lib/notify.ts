import { config } from '../config';

import { DEMO_WALLET_URLS } from './wallets';

import { normaliseWalletAddress } from './openPayments';



export type NotifyLanguage = 'zu' | 'xh' | 'st' | 'en';



interface SmsPayload {

  to:       string;

  message:  string;

  context:  'disburse' | 'collected';

  name:     string;

}



export interface VoiceCallResult {

  phoneNumber: string;

  status:      string;

  sessionId:   string;

}



function formatZar(amountSmallest: string): string {

  const n = parseInt(amountSmallest, 10);

  if (Number.isNaN(n)) return amountSmallest;

  return (n / 100).toFixed(2);

}



export function grantArrivedMessage(

  name: string,

  amountSmallest: string,

  language: NotifyLanguage,

  shopName: string

): string {

  const amount = formatZar(amountSmallest);

  const first  = name.split(' ')[0];



  const messages: Record<NotifyLanguage, string> = {

    zu: `Sawubona ${first}, imali yakho ye-grant engu-R${amount} isifike. Iya ku-${shopName} — hamba uyithathe, uphathe i-ID yakho.`,

    xh: `Molo ${first}, imali yakho ye-grant yi-R${amount} ifikile. Yiya ku-${shopName} uyoyithatha, uzise i-ID yakho.`,

    st: `Lumela ${first}, chelete ya hao ya grant e R${amount} e fihlile. Eya ${shopName} ho e nka, nka ID ya hao.`,

    en: `Hi ${first}, your R${amount} grant has arrived. Collect it at ${shopName} — bring your ID.`,

  };



  return messages[language] ?? messages.en;

}



export function grantCollectedMessage(

  name: string,

  amountSmallest: string,

  language: NotifyLanguage,

  shopName: string

): string {

  const amount = formatZar(amountSmallest);

  const first  = name.split(' ')[0];



  const messages: Record<NotifyLanguage, string> = {

    zu: `${first}, u-R${amount} wakutholile ku-${shopName}. Siyabonga.`,

    xh: `${first}, u-R${amount} uyithabile ku-${shopName}. Enkosi.`,

    st: `${first}, u fumane R${amount} ho ${shopName}. Rea leboha.`,

    en: `${first}, your R${amount} was collected at ${shopName}. Thank you.`,

  };



  return messages[language] ?? messages.en;

}



async function sendViaAfricasTalking(to: string, message: string): Promise<void> {

  const { username, apiKey, senderId } = config.africasTalking;



  const body = new URLSearchParams({

    username,

    to:      to.replace(/\s/g, ''),

    message,

    from:    senderId,

  });


/** This part is yet to be configured, haven't gotten the API credentials as of yet */
  const res = await fetch('https://api.africastalking.com/version1/messaging', {

    method:  'POST',

    headers: {

      'apiKey':       apiKey,

      'Content-Type': 'application/x-www-form-urlencoded',

      'Accept':       'application/json',

    },

    body: body.toString(),

  });



  if (!res.ok) {

    const text = await res.text();

    throw new Error(`Africa's Talking SMS failed (${res.status}): ${text}`);

  }

}



/** Initiate an outbound voice call via Africa's Talking Voice API. */

export async function initiateVoiceCall(to: string | string[]): Promise<VoiceCallResult[]> {

  const { username, apiKey, voiceFrom } = config.africasTalking;

  if (!voiceFrom) {

    throw new Error('AT_VOICE_FROM is not configured');

  }



  const recipients = (Array.isArray(to) ? to : [to]).map(n => n.replace(/\s/g, ''));

  const body = new URLSearchParams({

    username,

    to:   JSON.stringify(recipients),

    from: voiceFrom.replace(/\s/g, ''),

  });



  const res = await fetch('https://voice.africastalking.com/call', {

    method:  'POST',

    headers: {

      'apiKey':       apiKey,

      'Content-Type': 'application/x-www-form-urlencoded',

      'Accept':       'application/json',

    },

    body: body.toString(),

  });



  const data = await res.json().catch(() => null) as {

    entries?: Array<{ phoneNumber: string; status: string; sessionId: string }>;

    errorMessage?: string;

  } | null;



  if (!res.ok) {

    throw new Error(`Africa's Talking Voice failed (${res.status}): ${JSON.stringify(data)}`);

  }



  if (data?.errorMessage && data.errorMessage !== 'None') {

    throw new Error(`Africa's Talking Voice error: ${data.errorMessage}`);

  }



  return (data?.entries ?? []).map(e => ({

    phoneNumber: e.phoneNumber,

    status:      e.status,

    sessionId:   e.sessionId,

  }));

}



export async function sendBeneficiarySms(payload: SmsPayload): Promise<void> {

  const line = `[notify:${payload.context}] → ${payload.to}: ${payload.message}`;



  if (!config.africasTalking.enabled) {

    console.log(line);

    return;

  }



  try {

    await sendViaAfricasTalking(payload.to, payload.message);

    console.log(`[notify] SMS sent to ${payload.to} (${payload.context})`);

  } catch (err) {

    console.error('[notify] SMS failed:', err instanceof Error ? err.message : err);

    console.log(line);

  }

}



export async function sendBeneficiaryVoice(to: string): Promise<VoiceCallResult[] | null> {

  const line = `[notify:voice] → ${to}`;



  if (!config.africasTalking.enabled || !config.africasTalking.voiceFrom) {

    console.log(line);

    return null;

  }



  try {

    const entries = await initiateVoiceCall(to);

    console.log(`[notify] Voice call queued to ${to}:`, entries);

    return entries;

  } catch (err) {

    console.error('[notify] Voice call failed:', err instanceof Error ? err.message : err);

    console.log(line);

    return null;

  }

}



/** SMS + voice notification for a completed grant payment. */

export async function notifyBeneficiary(payload: SmsPayload): Promise<void> {

  await sendBeneficiarySms(payload);

  await sendBeneficiaryVoice(payload.to);

}



export function notificationForCompletedPayment(input: {

  senderWallet:   string;

  receiverWallet: string;

  receiveAmount:  string;

  beneficiaryName?:    string | null;

  beneficiaryPhone?:   string | null;

  beneficiaryLanguage?: string | null;

}): SmsPayload | null {

  if (!input.beneficiaryPhone || !input.beneficiaryName) return null;



  const lang = (input.beneficiaryLanguage ?? 'zu') as NotifyLanguage;

  const shop = config.agentShopName;

  const sender = normaliseWalletAddress(input.senderWallet);

  const escrow = normaliseWalletAddress(DEMO_WALLET_URLS.escrow);



  if (sender === escrow) {

    return {

      to:      input.beneficiaryPhone,

      name:    input.beneficiaryName,

      context: 'collected',

      message: grantCollectedMessage(input.beneficiaryName, input.receiveAmount, lang, shop),

    };

  }



  if (normaliseWalletAddress(input.receiverWallet) === escrow) {

    return {

      to:      input.beneficiaryPhone,

      name:    input.beneficiaryName,

      context: 'disburse',

      message: grantArrivedMessage(input.beneficiaryName, input.receiveAmount, lang, shop),

    };

  }



  return null;

}

