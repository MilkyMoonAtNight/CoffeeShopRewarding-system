// Twilio status webhook — called by Twilio when a WhatsApp message status changes.
// Set TWILIO_WHATSAPP_FROM and BASE_URL in .env; Twilio will POST to BASE_URL/webhooks/twilio-status.
//
// Twilio signature validation is recommended for production.
// See: https://www.twilio.com/docs/usage/webhooks/webhooks-security

var express  = require('express');
var router   = express.Router();
var User     = require('../models/User');
var otpFallback     = require('../utils/otpFallback');
var sendOtpUtil     = require('../utils/sendOtp');

// Twilio POSTs application/x-www-form-urlencoded — needs its own parser
router.post('/twilio-status', express.urlencoded({ extended: false }), async function (req, res) {
  res.sendStatus(200); // ack immediately to avoid Twilio retries

  var sid    = req.body.MessageSid    || req.body.SmsSid;
  var status = req.body.MessageStatus || req.body.SmsStatus;

  if (!sid || !status) return;

  try {
    var user = await User.findOne({ 'otp.messageId': sid }).select('_id otp').lean();
    if (!user) return;

    var userId = String(user._id);

    if (status === 'failed' || status === 'undelivered') {
      // Cancel the 45-second timeout and trigger email fallback immediately
      otpFallback.cancel(userId);
      await sendOtpUtil.triggerEmailFallback(userId);

    } else if (status === 'sent' || status === 'delivered') {
      // WhatsApp confirmed — cancel the fallback timeout, no email needed
      otpFallback.cancel(userId);
    }
    // 'queued' / 'accepted' / 'read' — do nothing, let timeout handle edge cases
  } catch (e) {
    console.error('Twilio webhook error:', e.message);
  }
});

module.exports = router;
