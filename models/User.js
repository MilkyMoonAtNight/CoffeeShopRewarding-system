const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── REWARD SCHEMA ────────────────────────────────────────────────
const rewardSchema = new mongoose.Schema({
  drinkNumber: Number,          // which drink number triggered this
  type: {
    type: String,
    enum: ['free_drink', 'voucher', 'special', 'merch', 'store_voucher']
  },
  description: String,
  expiresAt: Date,              // set for vouchers only (7 days), null for free drinks / merch
  claimed: { type: Boolean, default: false },
  claimedAt: Date,
  claimedBy: String,            // admin who confirmed the claim at the counter
  redeemed: { type: Boolean, default: false },   // voucher/reward actually used
  redeemedAt: Date,
  redeemedBy: String,
  claimCode: String,            // 4-digit code generated when customer taps Claim
  claimCodeGeneratedAt: Date
});

const scanHistorySchema = new mongoose.Schema({
  scannedAt: { type: Date, default: Date.now },
  drinkName: { type: String, default: 'Coffee' }
});

const userSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String, required: true },
  qrCode:     { type: String, unique: true },
  birthday:   { type: Date, default: null },   // collected at signup for birthday treats 🎂
  totalDrinks:{ type: Number, default: 0 },
  lastVisit:  Date,
  scanHistory: [scanHistorySchema],
  rewards:    [rewardSchema],
  tier:       { type: String, enum: ['Kitten', 'Cat', 'Tom Cat', 'Panther'], default: 'Kitten' },
  resetToken:      { type: String, default: null },
  resetTokenExpiry:{ type: Date, default: null },
  createdAt:  { type: Date, default: Date.now },

  // ── Cash / pay-in-store trust tracking ──
  // Starts at 100. Goes down when a cash order is marked no-show, up when one is
  // collected. If it drops below the threshold, the app stops offering "pay in store"
  // and requires online payment instead.
  trustIndex:        { type: Number, default: 100 },
  cashOrdersPlaced:  { type: Number, default: 0 },
  cashOrdersHonored: { type: Number, default: 0 },
  cashNoShows:       { type: Number, default: 0 },

  pastOrders: [{
    ref:          String,
    items:        mongoose.Schema.Types.Mixed,
    total:        Number,
    pickupMethod: String,
    notes:        String,
    paymentMethod:{ type: String, default: 'online' },   // 'online' | 'cash'
    paymentStatus:{ type: String, default: 'pending' },  // pending | paid | no_show | refunded
    status:       { type: String, default: 'pending' },
    placedAt:     { type: Date, default: Date.now }
  }]
});

// ── RANDOM VOUCHER POOL ──────────────────────────────────────────
const VOUCHER_POOL = [
  { description: '10% off pastries of the day',               type: 'voucher' },
  { description: '10% off cold drinks (Freezo, Iced Latte, Matcha)', type: 'voucher' },
  { description: '10% off hot drinks',                        type: 'voucher' },
  { description: '15% off a Cake & Cappuccino',               type: 'voucher' },
];

function randomVoucher() {
  return VOUCHER_POOL[Math.floor(Math.random() * VOUCHER_POOL.length)];
}

// ── MILESTONE LOGIC ──────────────────────────────────────────────
// Rules (checked in order of priority for a given drink number):
//   Every 10th drink      → free drink (9 lives — every 10th is free), never latte of the month
//   Every 25th drink      → free Latte of the Month
//   Every 50th drink      → free Cake & Cappuccino special
//   Every 100th drink     → branded cap
//   Every 150th drink     → branded cup
//   Every 200th drink     → free shirt
//   Every 300th drink     → R500 in-store voucher
//   Every 500th drink     → R1000 in-store voucher
//   Every 5th drink (excl. 10th, 25th, 50th, 100th, 150th, 200th, 300th, 500th) → random voucher

function getMilestoneForDrink(n) {
  // Big milestones take full priority
  if (n === 500) return { type: 'store_voucher', description: 'R1000 in-store voucher — redeemable on anything', expires: false };
  if (n === 300) return { type: 'store_voucher', description: 'R500 in-store voucher — redeemable on anything', expires: false };
  if (n === 200) return { type: 'merch',         description: 'Free Con Leche shirt — your size, your pick', expires: false };
  if (n === 150) return { type: 'merch',         description: 'Free Con Leche branded cup', expires: false };
  if (n === 100) return { type: 'merch',         description: 'Free Con Leche branded cap — your colour', expires: false };
  if (n === 50)  return { type: 'special',       description: 'Free Cake & Cappuccino on us 🎂', expires: false };
  if (n === 25)  return { type: 'special',       description: 'Free Latte of the Month ✨', expires: false };
  if (n % 10 === 0) return { type: 'free_drink', description: 'Free drink on us — 9 lives, 10th is yours ☕ (excludes Latte of the Month)', expires: false };
  if (n % 5 === 0)  return { ...randomVoucher(), expires: true };
  return null;
}

// ── TIER ─────────────────────────────────────────────────────────
userSchema.methods.updateTier = function () {
  if      (this.totalDrinks >= 150) this.tier = 'Panther';
  else if (this.totalDrinks >= 50)  this.tier = 'Tom Cat';
  else if (this.totalDrinks >= 15)  this.tier = 'Cat';
  else                               this.tier = 'Kitten';
};

// ── CHECK MILESTONE FOR CURRENT DRINK COUNT ──────────────────────
userSchema.methods.checkMilestone = function (scannedAt) {
  const n = this.totalDrinks;
  const milestone = getMilestoneForDrink(n);
  if (!milestone) return null;

  const alreadyHas = this.rewards.some(r => r.drinkNumber === n);
  if (alreadyHas) return null;

  const reward = {
    drinkNumber:  n,
    type:         milestone.type,
    description:  milestone.description,
    expiresAt:    milestone.expires ? new Date(scannedAt.getTime() + 7 * 24 * 60 * 60 * 1000) : null,
    claimed:      false
  };

  // Vouchers auto-collected (no manual claim needed)
  if (milestone.expires) {
    reward.claimed = true;
    reward.claimedAt = scannedAt;
  }

  this.rewards.push(reward);
  return reward;
};

// ── RECORD A DRINK ────────────────────────────────────────────────
userSchema.methods.recordDrink = function (drinkName = 'Coffee') {
  this.totalDrinks += 1;
  const now = new Date();
  this.scanHistory.push({ drinkName, scannedAt: now });
  this.lastVisit = now;
  this.updateTier();
  return this.checkMilestone(now);
};

// ── GENERATE CLAIM CODE (customer taps Claim on free drink/merch) ─
userSchema.methods.generateClaimCode = function (rewardId) {
  const reward = this.rewards.id(rewardId);
  if (!reward || reward.redeemed) return null;
  // Claimables must be unclaimed; vouchers are auto-claimed but redeemable until expiry
  if (reward.type !== 'voucher' && reward.claimed) return null;
  if (reward.type === 'voucher' && reward.expiresAt && reward.expiresAt <= new Date()) return null;
  const code = String(Math.floor(1000 + Math.random() * 9000));
  reward.claimCode = code;
  reward.claimCodeGeneratedAt = new Date();
  return code;
};

// ── CONFIRM CLAIM (barista enters code in admin) ──────────────────
userSchema.methods.confirmClaim = function (rewardId, code, adminName = null) {
  const reward = this.rewards.id(rewardId);
  if (!reward) return { ok: false, reason: 'Reward not found' };
  if (reward.redeemed) return { ok: false, reason: 'Already redeemed' };
  if (reward.type !== 'voucher' && reward.claimed) return { ok: false, reason: 'Already claimed' };
  if (!reward.claimCode || reward.claimCode !== code) return { ok: false, reason: 'Wrong code' };
  // Code expires after 10 minutes
  const age = (Date.now() - new Date(reward.claimCodeGeneratedAt).getTime()) / 1000 / 60;
  if (age > 10) return { ok: false, reason: 'Code expired — ask customer to generate a new one' };
  const now = new Date();
  reward.claimed = true;
  if (!reward.claimedAt) reward.claimedAt = now;
  if (adminName) reward.claimedBy = adminName;
  reward.redeemed = true;
  reward.redeemedAt = now;
  reward.redeemedBy = adminName || 'Staff';
  reward.claimCode = null;
  return { ok: true, reward };
};

// ── CUSTOMER SELF-REDEEMS A VOUCHER (shows screen at counter) ─────
userSchema.methods.redeemVoucher = function (rewardId) {
  const reward = this.rewards.id(rewardId);
  if (!reward) return { ok: false, reason: 'Voucher not found' };
  if (reward.type !== 'voucher') return { ok: false, reason: 'Not a voucher' };
  if (reward.redeemed) return { ok: false, reason: 'Already redeemed' };
  if (reward.expiresAt && reward.expiresAt <= new Date()) return { ok: false, reason: 'Voucher expired' };
  reward.redeemed = true;
  reward.redeemedAt = new Date();
  reward.redeemedBy = 'Self — shown at counter';
  return { ok: true, reward };
};

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('User', userSchema);
module.exports.getMilestoneForDrink = getMilestoneForDrink;
