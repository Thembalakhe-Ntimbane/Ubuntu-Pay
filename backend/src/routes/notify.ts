import { Router } from 'express';
import { config } from '../config';
import {
  grantArrivedMessage,
  initiateVoiceCall,
  notifyBeneficiary,
  sendBeneficiarySms,
  sendBeneficiaryVoice,
} from '../lib/notify';
import { requireAuth } from '../middleware/requireAuth';

export const notifyRouter = Router();

/** Smoke-test SMS + voice to the configured test phone */
notifyRouter.post('/test', requireAuth, async (_req, res, next) => {
  try {
    const phone   = config.africasTalking.testPhone;
    const message = grantArrivedMessage('Test User', '2400', 'en', config.agentShopName);

    const smsLine = `[notify:test] → ${phone}: ${message}`;
    let smsSent   = false;
    let voice: Awaited<ReturnType<typeof initiateVoiceCall>> | null = null;

    if (config.africasTalking.enabled) {
      try {
        await sendBeneficiarySms({ to: phone, message, context: 'disburse', name: 'Test User' });
        smsSent = true;
      } catch (err) {
        console.error('[notify/test] SMS failed:', err);
      }
      voice = await sendBeneficiaryVoice(phone);
    } else {
      console.log(smsLine);
      console.log(`[notify:voice:test] → ${phone}`);
    }

    res.json({
      ok:           true,
      configured:   config.africasTalking.enabled,
      phone,
      smsSent,
      voice,
      consoleOnly:  !config.africasTalking.enabled,
      message:      config.africasTalking.enabled
        ? 'Test notification dispatched'
        : 'Africa\'s Talking not configured — check backend console for logged messages',
    });
  } catch (err) {
    next(err);
  }
});

/** Trigger the same SMS + voice flow used after a grant disbursement. */
notifyRouter.post('/disburse-preview', requireAuth, async (_req, res, next) => {
  try {
    const phone = config.africasTalking.testPhone;
    await notifyBeneficiary({
      to:      phone,
      name:    'Test Beneficiary',
      context: 'disburse',
      message: grantArrivedMessage('Test Beneficiary', '2400', 'en', config.agentShopName),
    });

    res.json({ ok: true, phone, configured: config.africasTalking.enabled });
  } catch (err) {
    next(err);
  }
});
