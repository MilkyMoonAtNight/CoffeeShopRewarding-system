const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Admin = require('../models/Admin');
const QRCode = require('qrcode');
const { getMilestoneForDrink } = require('../models/User');
const { asString } = require('../utils/security');
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

    // Stamp history — when, by whom, how many (newest first)
    const stampHistory = await ActivityLog.find({ userId: user._id, type: 'drinks_added' })
      .sort({ at: -1 }).limit(50).catch(() => []);

    res.render('pages/battlepass', {
      title: 'My Battlepass — Con Leche',
      user, qrDataUrl,
      upcomingMilestones, next, drinksToNext, progressPct,
      activeVouchers, redeemedVouchers, expiredVouchers, claimableItems, claimedItems,
      stampHistory,
      now
    });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// ── GENERATE CLAIM CODE (customer taps Claim) ─────────────────────
router.post('/claim/:rewardId', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const code = user.generateClaimCode(req.params.rewardId);
    if (!code) return res.json({ success: false, message: 'Already claimed or not found' });
    await user.save();
    res.json({ success: true, code });
  } catch (err) {
    res.json({ success: false, message: err.message });
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
    const qrCode   = asString(req.body.qrCode, 200);
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
