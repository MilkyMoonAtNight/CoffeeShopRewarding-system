// ── Transient "barista is serving this customer" state ────────────
// In-memory, single-instance (same model as the rate limiter). When a barista
// looks a customer up on the scan screen we flag that customer's id as pending,
// so their battlepass page can show a "Barista is loading your drinks…" overlay
// in real time (the page polls /battlepass/status). The flag auto-expires so a
// lookup that never completes can't leave the overlay stuck on.

const PENDING_TTL_MS = 30 * 1000;
const pending = new Map(); // userId(string) -> expiresAt(ms)

function markPending(userId) {
  if (!userId) return;
  pending.set(String(userId), Date.now() + PENDING_TTL_MS);
}

function clearPending(userId) {
  if (!userId) return;
  pending.delete(String(userId));
}

function isPending(userId) {
  if (!userId) return false;
  const exp = pending.get(String(userId));
  if (!exp) return false;
  if (exp <= Date.now()) { pending.delete(String(userId)); return false; }
  return true;
}

// Periodic cleanup so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of pending) if (exp <= now) pending.delete(k);
}, PENDING_TTL_MS).unref?.();

module.exports = { markPending, clearPending, isPending };
