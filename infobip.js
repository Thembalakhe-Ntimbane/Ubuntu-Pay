/**
 * infobip.js — QuikPay Infobip SMS + Voice Notification Module
 *
 * 5 recipients, each with their own API key, from/to numbers and language.
 * Call: await notifyBeneficiary(beneficiaryId, amount)
 */

const BASE_URL = "api.infobip.com";

// ── Recipient registry ─────────────────────────────────────────────────────
// Each entry is keyed by the beneficiaryId used in server.js BENEFICIARIES.
// Language choices: "en" | "zu" | "xh" | "af" | "nso"
const RECIPIENTS = {
  // Nomsa Dlamini — existing key already in the original Python script
  "4501015800080": {
    name:     "Nomsa",
    to:       "27848346826",
    from:     "3851557798",
    apiKey:   "ddeb6accfb4d561fe8db05674be2a2f5-e204a621-e8d1-4fa2-ac10-672710844e03",
    language: "zu",   // isiZulu
  },

  // Thandi Mokoena
  "5203024200081": {
    name:     "Thandi",
    to:       "27719654387",
    from:     "38515507799",
    apiKey:   "e43e37e32f66c5de6e0fd6fea050877d-d7e89f1d-4f88-4b32-8f5a-be0636f45cb7",
    language: "nso",  // SePedi
  },

  // Gladys Sithole
  "4809034100082": {
    name:     "Gladys",
    to:       "27826787482",
    from:     "38515507799",
    apiKey:   "a57d5cffc2ebbe7eedb773435c931d1d-5b131abb-b625-40ca-83be-c0af882debd0",
    language: "xh",   // isiXhosa
  },

  // Rose Khumalo
  "5112023300083": {
    name:     "Rose",
    to:       "27660826868",
    from:     "447491163443",
    apiKey:   "8ca5f9e84d2a5dc1704e5e784b7dcf8d-2b534425-c761-4cc3-8477-3f05aa92eb5e",
    language: "en",   // English
  },

  // Maria van Wyk — uses the original key/number from the Python script
  "4703012100084": {
    name:     "Maria",
    to:       "27000000000",   // replace with Maria's actual number when known
    from:     "38515507799",
    apiKey:   "0396c849d55f92f4ef5f164ea662790f-ba6b7b07-6cf0-48ce-8a43-ec16b18c9832",
    language: "af",   // Afrikaans
  },
};

// ── Message templates (SMS + voice) per language ──────────────────────────
const TEMPLATES = {
  en: {
    sms:  (name, amount) =>
      `Hi ${name}! Your SASSA grant of R${amount.toFixed(2)} is ready to collect. ` +
      `Visit your nearest spaza shop with your ID to get your money. Stay safe!`,
    call: (name, amount) =>
      `Hello ${name}. This is QuikPay. ` +
      `Your SASSA grant of R${amount.toFixed(2)} is now available. ` +
      `Please visit your nearest spaza shop with your ID to collect your money. Goodbye.`,
  },
  zu: {
    sms:  (name, amount) =>
      `Sawubona ${name}! Imali yakho ye-SASSA ka-R${amount.toFixed(2)} ilungele ukuthathwa. ` +
      `Hamba esitolo esiseduzane nawe nge-ID yakho ukuze uthole imali yakho.`,
    call: (name, amount) =>
      `Sawubona ${name}. Lena i-QuikPay. ` +
      `Imali yakho ye-SASSA ka-R${amount.toFixed(2)} ikulindile. ` +
      `Hamba esitolo esiseduzane nawe nge-ID yakho ukuze uthole imali yakho. Ngiyabonga.`,
  },
  xh: {
    sms:  (name, amount) =>
      `Molo ${name}! Imali yakho ye-SASSA ye-R${amount.toFixed(2)} ilungele ukuziwa. ` +
      `Yiya kwivenkile ekufuphi nawe ne-ID yakho ukuze ufumane imali yakho.`,
    call: (name, amount) =>
      `Molo ${name}. Esi yi-QuikPay. ` +
      `Imali yakho ye-SASSA ye-R${amount.toFixed(2)} ilungele. ` +
      `Yiya kwivenkile ekufuphi nawe ne-ID yakho ukuze ufumane imali yakho. Enkosi.`,
  },
  af: {
    sms:  (name, amount) =>
      `Hallo ${name}! Jou SASSA-toelae van R${amount.toFixed(2)} is gereed om te afhaal. ` +
      `Besoek jou naaste spaza-winkel met jou ID om jou geld te kry.`,
    call: (name, amount) =>
      `Goeiedag ${name}. Dit is QuikPay. ` +
      `Jou SASSA-toelae van R${amount.toFixed(2)} is nou beskikbaar. ` +
      `Besoek jou naaste spaza-winkel met jou ID om jou geld te kry. Totsiens.`,
  },
  nso: {
    sms:  (name, amount) =>
      `Dumela ${name}! Madi ya gago ya SASSA ya R${amount.toFixed(2)} a letile go amogelwa. ` +
      `Etela lebenkele le le gaufi le wena le ID ya gago go hwetsa madi ya gago.`,
    call: (name, amount) =>
      `Dumela ${name}. Ke QuikPay. ` +
      `Madi ya gago ya SASSA ya R${amount.toFixed(2)} e a letile. ` +
      `Etela lebenkele le le gaufi le wena le ID ya gago go hwetsa madi ya gago. Ke a leboga.`,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function makeHeaders(apiKey) {
  return {
    Authorization: `App ${apiKey}`,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };
}

async function sendSMS(recipient, amount) {
  const { name, to, from, apiKey, language } = recipient;
  const tmpl = TEMPLATES[language] || TEMPLATES.en;
  const text  = tmpl.sms(name, amount);

  console.log(`[Infobip SMS] → ${to} | ${language} | ${text}`);

  const res = await fetch(`https://${BASE_URL}/sms/2/text/advanced`, {
    method:  "POST",
    headers: makeHeaders(apiKey),
    body: JSON.stringify({
      messages: [{ from: "QuikPay", destinations: [{ to }], text }],
    }),
  });

  const data = await res.json();
  if (res.ok) {
    const msg = data.messages?.[0];
    console.log(`[Infobip SMS] ✅ id=${msg?.messageId} status=${msg?.status?.name}`);
  } else {
    console.error(`[Infobip SMS] ❌ ${res.status}:`, JSON.stringify(data));
  }
}

async function makeVoiceCall(recipient, amount) {
  const { name, to, from, apiKey, language } = recipient;
  const tmpl  = TEMPLATES[language] || TEMPLATES.en;
  const script = tmpl.call(name, amount);
  const toClean = to.replace("+", "");

  console.log(`[Infobip TTS] → ${toClean} | ${language} | ${script}`);

  const res = await fetch(`https://${BASE_URL}/tts/3/advanced`, {
    method:  "POST",
    headers: makeHeaders(apiKey),
    body: JSON.stringify({
      messages: [{
        destinations: [{ to: toClean }],
        from,
        language: "en",               // Infobip TTS engine — keep "en" for all
        text:     script,
        voice:    { name: "Joanna", gender: "female" },
      }],
    }),
  });

  const data = await res.json();
  if (res.ok) {
    const msg = data.messages?.[0];
    console.log(`[Infobip TTS] ✅ id=${msg?.messageId} status=${msg?.status?.name}`);
  } else {
    console.error(`[Infobip TTS] ❌ ${res.status}:`, JSON.stringify(data));
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Send SMS + voice call to a beneficiary after their grant is paid.
 * Fires-and-forgets (non-blocking) — errors are logged, not thrown.
 *
 * @param {string} beneficiaryId  — e.g. "4501015800080"
 * @param {number} amount         — e.g. 350
 */
export async function notifyBeneficiary(beneficiaryId, amount) {
  const recipient = RECIPIENTS[beneficiaryId];
  if (!recipient) {
    console.warn(`[Infobip] No recipient config for beneficiaryId=${beneficiaryId}`);
    return;
  }

  // Run SMS and voice call in parallel; errors are caught individually
  await Promise.allSettled([
    sendSMS(recipient, amount).catch(err =>
      console.error("[Infobip SMS error]", err.message)),
    makeVoiceCall(recipient, amount).catch(err =>
      console.error("[Infobip TTS error]", err.message)),
  ]);
}
