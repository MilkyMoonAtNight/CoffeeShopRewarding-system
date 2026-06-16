// Helpers for showing events — including daily/weekly recurring ones whose
// stored `date` may already be in the past.

// The next time a (possibly recurring) event happens, counting from now.
// Non-recurring events just return their stored date.
function nextOccurrence(ev) {
  const base = new Date(ev.date);
  const now = new Date();

  const type = ev.recurringType && ev.recurringType !== 'none'
    ? ev.recurringType
    : (ev.recurring ? 'weekly' : 'none');

  if (type === 'none') return base;

  // Candidate = today at the event's time of day
  const cand = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
    base.getHours(), base.getMinutes(), 0, 0);

  if (type === 'daily') {
    if (cand < now) cand.setDate(cand.getDate() + 1); // already passed today → tomorrow
    return cand;
  }

  // weekly — land on the same weekday as the original date
  const targetDow = base.getDay();
  let diff = (targetDow - cand.getDay() + 7) % 7;
  if (diff === 0 && cand < now) diff = 7;
  cand.setDate(cand.getDate() + diff);
  return cand;
}

// Load events that are either still upcoming OR recurring, roll recurring ones
// forward to their next occurrence, sort by that date, and optionally cap.
async function loadUpcomingEvents(Event, { limit } = {}) {
  const now = new Date();
  const raw = await Event.find({
    $or: [
      { date: { $gte: now } },
      { recurring: true },
      { recurringType: { $in: ['daily', 'weekly'] } },
    ],
  }).catch(() => []);

  const mapped = raw
    .map(e => {
      const o = typeof e.toObject === 'function' ? e.toObject() : { ...e };
      o.date = nextOccurrence(e);
      return o;
    })
    .sort((a, b) => a.date - b.date);

  return limit ? mapped.slice(0, limit) : mapped;
}

module.exports = { nextOccurrence, loadUpcomingEvents };
