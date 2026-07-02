// Server-side 45-second WhatsApp→email fallback manager.
// Stores one pending timeout per userId. Cancelled when webhook confirms
// delivery or when a new OTP is issued for the same user.

var pending = new Map();

function schedule(userId, delayMs, fn) {
  cancel(userId);
  var key = String(userId);
  var handle = setTimeout(function () {
    pending.delete(key);
    fn();
  }, delayMs);
  pending.set(key, handle);
}

function cancel(userId) {
  var key = String(userId);
  if (pending.has(key)) {
    clearTimeout(pending.get(key));
    pending.delete(key);
  }
}

module.exports = { schedule: schedule, cancel: cancel };
