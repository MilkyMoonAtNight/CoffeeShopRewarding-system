// Shared OTP delivery helper.
//   1. Try WhatsApp with a Twilio statusCallback URL.
//   2. Schedule a 45-second server-side fallback in case the webhook never fires.
//   3. triggerEmailFallback() is also called directly by the webhook on 'failed' status.

var otpFallback      = require('./otpFallback');
var mailer           = require('./mailer');
var whatsapp         = require('./whatsapp');
var User             = require('../models/User');

var FALLBACK_DELAY_MS = 45 * 1000;

// Deliver OTP for a user. Updates otp.channel and otp.messageId on the user document.
async function sendOtpWhatsAppFirst(user, code, purpose) {
  purpose = purpose || 'register';
  var statusCallbackUrl = process.env.BASE_URL
    ? process.env.BASE_URL + '/webhooks/twilio-status'
    : null;

  var waPhone  = user.whatsappPhone;
  var sentWa   = false;
  var messageId = null;

  if (waPhone) {
    try {
      messageId = await whatsapp.sendWhatsAppMessage(
        waPhone,
        '🔐 Your Con Leche verification code is *' + code + '*. It expires in 10 minutes.',
        statusCallbackUrl
      );
      sentWa = true;
    } catch (e) {
      console.error('WhatsApp OTP send error:', e.message);
    }
  }

  if (sentWa && messageId) {
    await User.updateOne({ _id: user._id }, {
      $set: { 'otp.channel': 'whatsapp', 'otp.messageId': messageId }
    });
    // Schedule fallback in case webhook never confirms delivery
    var userId = String(user._id);
    otpFallback.schedule(userId, FALLBACK_DELAY_MS, function () {
      triggerEmailFallback(userId);
    });
  } else {
    // No WhatsApp number or send failed — go straight to email
    await mailer.sendOtpEmail(user.email, code, purpose);
    await User.updateOne({ _id: user._id }, {
      $set: { 'otp.channel': 'email', 'otp.messageId': null }
    });
  }
}

// Called by webhook (on 'failed'/'undelivered') and by the 45-second timeout.
async function triggerEmailFallback(userId) {
  try {
    var user = await User.findById(userId).lean();
    if (!user || !user.otp || !user.otp.code) return;
    // Don't send if already switched to email (idempotent)
    if (user.otp.channel === 'email') return;
    await mailer.sendOtpEmail(user.email, user.otp.code, 'register');
    await User.updateOne({ _id: userId }, {
      $set: { 'otp.channel': 'email', 'otp.messageId': null }
    });
  } catch (e) {
    console.error('OTP email fallback error:', e.message);
  }
}

module.exports = {
  sendOtpWhatsAppFirst: sendOtpWhatsAppFirst,
  triggerEmailFallback: triggerEmailFallback
};
