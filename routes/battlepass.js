const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Admin = require('../models/Admin');
const QRCode = require('qrcode');
const { getMilestoneForDrink } = require('../models/User');
const { asString } = require('../utils/security');
const { isPending } = require('../utils/scanState');
const ActivityLog = require('../models/ActivityLog');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Admin-only guard for the staff scan/claim JSON endpoints below.
// Previously these were completely unauthenticated — anyone could POST a qrCode
// and record drinks or confirm reward claims for any customer.
async function requireAdminApi(req, res, next) {
  try {
    if (!req.session.adminId) return res.status(401).json({ success: false, message: 'Unauthorised' });
    const admin = await Admin.findById(req.session.adminId);
    if (!admin || !admin.active) return res.status(401).json({ success: false, message: 'Unauthorised' });
    req.admin = admin;
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Auth error' });
  }
}

// ── UPDATE NAME ──────────────────────────────────────────────────
router.post('/update-name', requireAuth, async (req, res) => {
  try {
    const raw = asString(req.body.name || '', 80).trim();
    if (!raw || !/^[A-Za-z\s]+$/.test(raw))
      return res.json({ ok: false, error: 'Invalid name' });
    const name = raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    await User.findByIdAndUpdate(req.session.userId, { name });
    req.session.userName = name;
    res.json({ ok: true, name });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── BATTLEPASS DASHBOARD ─────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    // Clean expired vouchers (just mark them, keep for history)
    const now = new Date();

    const qrDataUrl = await QRCode.toDataURL(`conleche:${user.qrCode}`, {
      color: { dark: '#000000', light: '#ffffff' },
      width: 300, margin: 2, errorCorrectionLevel: 'H'
    });

    // Next 5 upcoming milestones for the progress track
    const upcomingMilestones = [];
    for (let n = user.totalDrinks + 1; n <= user.totalDrinks + 50; n++) {
      const m = getMilestoneForDrink(n);
      if (m) upcomingMilestones.push({ drinkNumber: n, ...m });
      if (upcomingMilestones.length >= 5) break;
    }

    const next = upcomingMilestones[0];
    const drinksToNext = next ? next.drinkNumber - user.totalDrinks : 0;
    const prevMilestone = upcomingMilestones.length > 0
      ? user.rewards.filter(r => r.drinkNumber < next?.drinkNumber).slice(-1)[0]?.drinkNumber || 0
      : 0;
    const progressPct = next
      ? Math.round(((user.totalDrinks - prevMilestone) / (next.drinkNumber - prevMilestone)) * 100)
      : 100;

    // Split inventory — free drinks/merch bank up until claimed; vouchers
    // are auto-collected, last 7 days, and disappear once redeemed.
    const activeVouchers   = user.rewards.filter(r => r.type === 'voucher' && !r.redeemed && (!r.expiresAt || r.expiresAt > now));
    const redeemedVouchers = user.rewards.filter(r => r.type === 'voucher' && r.redeemed);
    const expiredVouchers  = user.rewards.filter(r => r.type === 'voucher' && !r.redeemed && r.expiresAt && r.expiresAt <= now);
    const claimableItems   = user.rewards.filter(r => ['free_drink','special','merch','store_voucher'].includes(r.type) && !r.claimed);
    const claimedItems     = user.rewards.filter(r => ['free_drink','special','merch','store_voucher'].includes(r.type) && r.claimed);

    // Pre-render the claim QR for any reward whose 4-digit code is still live
    // (< 10 min old), so the QR persists across reloads — not just right after
    // the customer taps Claim.
    const claimQrs = {};
    for (const r of claimableItems) {
      if (r.claimCode && r.claimCodeGeneratedAt && (now - new Date(r.claimCodeGeneratedAt)) / 1000 / 60 < 10) {
        claimQrs[r._id] = await QRCode.toDataURL(`conleche-claim:${user.qrCode}:${r._id}`, {
          color: { dark: '#000000', light: '#ffffff' }, width: 240, margin: 2, errorCorrectionLevel: 'H'
        });
      }
    }

    // Stamp history — when, by whom, how many (newest first)
    const stampHistory = await ActivityLog.find({ userId: user._id, type: 'drinks_added' })
      .sort({ at: -1 }).limit(50).catch(() => []);

    res.render('pages/battlepass', {
      title: 'My Battlepass — Con Leche',
      user, qrDataUrl,
      upcomingMilestones, next, drinksToNext, progressPct,
      activeVouchers, redeemedVouchers, expiredVouchers, claimableItems, claimedItems,
      claimQrs,
      stampHistory,
      now
    });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// ── GENERATE CLAIM CODE + QR (customer taps Claim) ────────────────
// Returns BOTH a 4-digit code (the customer reads it out — proves they're
// present) and a QR encoding "conleche-claim:<token>:<rewardId>" (the barista
// scans it to auto-fill which reward + which customer, so no IDs are typed).
router.post('/claim/:rewardId', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const code = user.generateClaimCode(req.params.rewardId);
    if (!code) return res.json({ success: false, message: 'Already claimed or not found' });
    await user.save();
    const payload  = `conleche-claim:${user.qrCode}:${req.params.rewardId}`;
    const qrDataUrl = await QRCode.toDataURL(payload, {
      color: { dark: '#000000', light: '#ffffff' },
      width: 240, margin: 2, errorCorrectionLevel: 'H'
    });
    res.json({ success: true, code, qrDataUrl });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── ADMIN: CLAIM LOOKUP (barista scans the reward QR) ─────────────
// Given the scanned token + rewardId, report what the reward is and whether
// it's a real, still-claimable reward on this account. No state change — the
// actual redemption happens in /confirm-claim once the 4-digit code matches.
router.post('/claim-info', requireAdminApi, async (req, res) => {
  try {
    let token = asString(req.body.qrCode, 200).trim();
    if (token.toLowerCase().startsWith('conleche:')) token = token.slice('conleche:'.length).trim();
    const rewardId = asString(req.body.rewardId, 64);
    const user = await User.findOne({ qrCode: token });
    if (!user) return res.json({ success: false, valid: false, message: 'QR not on our system — customer not found' });
    const reward = user.rewards.id(rewardId);
    if (!reward) return res.json({ success: false, valid: false, message: 'Reward not found on this account' });

    let valid = true, reason = 'Valid — ask the customer for their 4-digit code';
    if (reward.redeemed)              { valid = false; reason = 'Already redeemed'; }
    else if (reward.type !== 'voucher' && reward.claimed) { valid = false; reason = 'Already claimed'; }

    res.json({
      success: true, valid, reason,
      customerName: user.name,
      reward: { description: reward.description, type: reward.type, drinkNumber: reward.drinkNumber }
    });
  } catch (err) {
    res.json({ success: false, valid: false, message: err.message });
  }
});

// ── CUSTOMER: REDEEM A VOUCHER (tap, confirm, show screen) ────────
router.post('/redeem-voucher/:rewardId', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const result = user.redeemVoucher(req.params.rewardId);
    if (!result.ok) return res.json({ success: false, message: result.reason });
    await user.save();
    await ActivityLog.create({
      type: 'voucher_redeemed', userId: user._id, userName: user.name,
      adminName: 'Self — shown at counter',
      rewardType: 'voucher', rewardDescription: result.reward.description
    }).catch(() => {});
    res.json({ success: true, redeemedAt: result.reward.redeemedAt, description: result.reward.description });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── UPDATE EMAIL PREFERENCES ──────────────────────────────────────
router.post('/preferences', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    user.emailPreferences = {
      specials: req.body.specials === 'on',
      events:   req.body.events   === 'on',
      birthday: req.body.birthday === 'on',
    };
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── CUSTOMER: LIVE STATUS POLL ────────────────────────────────────
// The battlepass page polls this every few seconds. It compares totalDrinks
// to detect newly-added stamps, and reads `pending` to show the
// "Barista is loading your drinks…" overlay while a barista is mid-scan.
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('totalDrinks tier rewards');
    if (!user) return res.status(401).json({ ok: false });
    const claimable = user.rewards.filter(r =>
      ['free_drink','special','merch','store_voucher'].includes(r.type) && !r.claimed).length;
    res.json({
      ok: true,
      totalDrinks: user.totalDrinks,
      tier: user.tier,
      claimable,
      pending: isPending(user._id),
    });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// ── ADMIN: SCAN & RECORD DRINK ────────────────────────────────────
router.post('/scan', requireAdminApi, async (req, res) => {
  try {
    let qrCode    = asString(req.body.qrCode, 200).trim();
    if (qrCode.toLowerCase().startsWith('conleche:')) qrCode = qrCode.slice('conleche:'.length).trim();
    const drinkName = asString(req.body.drinkName, 100) || 'Drink';
    if (!qrCode) return res.json({ success: false, message: 'QR code not found' });
    const user = await User.findOne({ qrCode });
    if (!user) return res.json({ success: false, message: 'QR code not found' });
    const qty = Math.min(20, Math.max(1, parseInt(req.body.quantity) || 1));
    const newRewards = [];
    for (let i = 0; i < qty; i++) {
      const reward = user.recordDrink(drinkName);
      if (reward) newRewards.push(reward);
    }
    await user.save();
    await ActivityLog.create({
      type: 'drinks_added', userId: user._id, userName: user.name,
      adminId: req.admin._id, adminName: req.admin.name,
      quantity: qty, totalAfter: user.totalDrinks
    }).catch(() => {});
    res.json({
      success: true, qty,
      user: { name: user.name, totalDrinks: user.totalDrinks, tier: user.tier },
      newReward: newRewards[newRewards.length - 1] || null,
      newRewards
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── ADMIN: CONFIRM CLAIM (barista enters 4-digit code) ────────────
router.post('/confirm-claim', requireAdminApi, async (req, res) => {
  try {
    let qrCode     = asString(req.body.qrCode, 200).trim();
    if (qrCode.toLowerCase().startsWith('conleche:')) qrCode = qrCode.slice('conleche:'.length).trim();
    const rewardId = asString(req.body.rewardId, 64);
    const code     = asString(req.body.code, 16);
    const user = await User.findOne({ qrCode });
    if (!user) return res.json({ success: false, message: 'User not found' });
    const result = user.confirmClaim(rewardId, code, req.admin.name);
    if (!result.ok) return res.json({ success: false, message: result.reason });
    await user.save();
    await ActivityLog.create({
      type: result.reward.type === 'voucher' ? 'voucher_redeemed' : 'reward_redeemed',
      userId: user._id, userName: user.name,
      adminId: req.admin._id, adminName: req.admin.name,
      rewardType: result.reward.type, rewardDescription: result.reward.description
    }).catch(() => {});
    res.json({ success: true, reward: result.reward });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
