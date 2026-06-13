const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['owner', 'manager', 'barista'],
    default: 'barista'
  },
  active: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt:   { type: Date, default: Date.now },
  checkedIn:  { type: Boolean, default: false },
  weeklyTargetHours: { type: Number, default: 40 },   // used by the time clock for "hours left"

  // ── Lifetime progression (drives the tier system) ──
  totalMinutesWorked: { type: Number, default: 0 },   // accumulates at every clock-out
  xp:                 { type: Number, default: 0 },    // earned from shifts + puzzles
  puzzlesCompleted:   { type: Number, default: 0 }
});

// ── Tier system (1–10) based on lifetime HOURS worked ──
// Intervals match the agreed table. Tier names in order.
const TIER_TABLE = [
  { tier: 1,  name: 'Green Bean',        hours: 0    },
  { tier: 2,  name: 'Daily Grinder',     hours: 48   },
  { tier: 3,  name: 'Milk Whisperer',    hours: 96   },
  { tier: 4,  name: 'Latte Artist',      hours: 192  },
  { tier: 5,  name: 'Roast Ranger',      hours: 336  },
  { tier: 6,  name: 'Customer Champion', hours: 528  },
  { tier: 7,  name: 'Espresso Engineer', hours: 816  },
  { tier: 8,  name: 'Master Barista',    hours: 1248 },
  { tier: 9,  name: 'Con Leche Legend',  hours: 1872 },
  { tier: 10, name: 'Coffee Deity',      hours: 2832 }
  // Note: the 4320h row in the screenshot is the cap/next-after-10; tier 10 is reached at 2832h.
];
adminSchema.statics.TIER_TABLE = TIER_TABLE;

adminSchema.methods.tierInfo = function () {
  const hrs = (this.totalMinutesWorked || 0) / 60;
  let current = TIER_TABLE[0];
  for (const t of TIER_TABLE) { if (hrs >= t.hours) current = t; }
  const next = TIER_TABLE.find(t => t.hours > hrs) || null;
  const span = next ? next.hours - current.hours : 1;
  const into = hrs - current.hours;
  return {
    tier: current.tier,
    name: current.name,
    hours: +hrs.toFixed(1),
    nextName: next ? next.name : null,
    nextHours: next ? next.hours : null,
    hoursToNext: next ? +(next.hours - hrs).toFixed(1) : 0,
    progressPct: next ? Math.min(100, Math.round((into / span) * 100)) : 100
  };
};

// Role permissions helper
adminSchema.methods.can = function (action) {
  const permissions = {
    owner:   ['scan', 'manage_menu', 'manage_events', 'manage_staff', 'view_stats', 'manage_users'],
    manager: ['scan', 'manage_menu', 'manage_events', 'view_stats'],
    barista: ['scan']
  };
  return permissions[this.role]?.includes(action) ?? false;
};

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('Admin', adminSchema);
