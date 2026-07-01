// WhatsApp messaging via Twilio — requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_WHATSAPP_FROM, and BUSINESS_WHATSAPP_NUMBER in .env.
// If any of those are missing the helpers degrade silently and callers fall back to email.

const STATUS_MSG = {
  preparing: (ref) => `☕ Your Con Leche order *${ref}* is being made — won't be long!`,
  ready:     (ref) => `🐾 Your order *${ref}* is READY! Come collect from the truck.`,
  done:      (ref) => `✓ Order *${ref}* collected — thanks for visiting Con Leche! See you next time 🐾`,
};

function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  try {
    return require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch {
    return null;
  }
}

// Normalise a phone number to E.164 digits only (e.g. "082 123 4567" → "27821234567")
function normalisePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  // South African local → international
  if (digits.startsWith('0') && digits.length === 10) digits = '27' + digits.slice(1);
  return digits || null;
}

// Build the wa.me deep-link that opens on the customer's phone (no API needed)
function buildWaMeUrl(orderRef) {
  const biz = normalisePhone(process.env.BUSINESS_WHATSAPP_NUMBER);
  if (!biz) return null;
  const text = encodeURIComponent(
    `Hello! I would like to know the status of my order *${orderRef}* 🐾`
  );
  return `https://wa.me/${biz}?text=${text}`;
}

// Send a raw WhatsApp message via Twilio. Throws on failure so callers can fallback.
async function sendWhatsAppMessage(toRaw, body) {
  const client = getTwilioClient();
  if (!client) throw new Error('Twilio not configured');

  const to   = normalisePhone(toRaw);
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  if (!to || !from) throw new Error('WhatsApp phone numbers not configured');

  await client.messages.create({
    from: from.startsWith('whatsapp:') ? from : `whatsapp:+${from}`,
    to:   `whatsapp:+${to}`,
    body,
  });
}

// Send an order status update via WhatsApp.
// Returns true on success, false on failure (so caller can email instead).
async function notifyCustomerWhatsApp(order, whatsappPhone, newStatus) {
  const msgFn = STATUS_MSG[newStatus];
  if (!msgFn) return false; // no message defined for this status
  try {
    await sendWhatsAppMessage(whatsappPhone, msgFn(order.ref));
    return true;
  } catch (err) {
    console.error('WhatsApp send failed:', err.message);
    return false;
  }
}

module.exports = { buildWaMeUrl, notifyCustomerWhatsApp, normalisePhone };
