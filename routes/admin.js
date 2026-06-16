const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const fs      = require('fs');
const Admin   = require('../models/Admin');
const User    = require('../models/User');
const Event   = require('../models/Event');
const Drink   = require('../models/Drink');
const Pastry  = require('../models/Pastry');
const Special = require('../models/Special');
const CheckIn = require('../models/CheckIn');
const ActivityLog = require('../models/ActivityLog');
const TimeClock   = require('../models/TimeClock');
const PuzzleDay   = require('../models/PuzzleDay');
const PuzzleAttempt = require('../models/PuzzleAttempt');
const { pickWordForDay, xpForDifficulty } = require('../utils/puzzle');
const crypto      = require('crypto');
const { rateLimit, asString } = require('../utils/security');
const Notification = require('../models/Notification');

const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please wait and try again.' });

// ── Multer — image uploads ────────────────────────────────────────
function makeUploader(subfolder) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'public', 'images', subfolder);
      // Empty folders don't survive git/zip transfers — if the folder is
      // missing, multer fails with ENOENT and the photo silently never saves.
      // Creating it here makes uploads work on any machine.
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Whitelist the extension from a fixed set — never trust the raw value.
      const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      let ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) ext = '.jpg';
      const base = path.basename(file.originalname, path.extname(file.originalname))
                       .replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) || 'image';
      cb(null, `${base}-${Date.now()}${ext}`);
    }
  });
  return multer({ storage, limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      // Only raster images. SVG is intentionally rejected: an uploaded SVG is
      // served inline from /public and can carry <script>, giving stored XSS.
      // application/octet-stream is rejected too — it would let any file through.
      const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      const ALLOWED_EXT  = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const ext = path.extname(file.originalname).toLowerCase();
      // Require BOTH a valid image MIME type AND a valid extension.
      if (ALLOWED_MIME.includes(file.mimetype) && ALLOWED_EXT.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), false);
      }
    }
  });
}
// Customers' QR encodes "conleche:<token>" — strip the prefix and whitespace
// so a token pasted from Google Lens or typed by hand always matches.
function normalizeToken(raw) {
  let t = String(raw || '').trim();
  if (t.toLowerCase().startsWith('conleche:')) t = t.slice('conleche:'.length);
  return t.trim();
}

const drinkUpload  = makeUploader('drinks');
const pastryUpload = makeUploader('pastries');
const specialUpload = makeUploader('specials');

// ── MIDDLEWARE ────────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  const admin = await Admin.findById(req.session.adminId);
  if (!admin || !admin.active) return res.redirect('/admin/login');
  req.admin = admin;
  next();
}

async function requireRole(req, res, next, roles) {
  if (!req.session.adminId) return res.redirect('/admin/login');
  const admin = await Admin.findById(req.session.adminId);
  if (!admin || !admin.active) return res.redirect('/admin/login');
  if (!roles.includes(admin.role)) {
    return res.status(403).render('admin/error', {
      title: 'Access Denied',
      message: `This page requires: ${roles.join(' or ')}`
    });
  }
  req.admin = admin;
  next();
}

const ownerManager = (req, res, next) => requireRole(req, res, next, ['owner', 'manager']);
const ownerOnly    = (req, res, next) => requireRole(req, res, next, ['owner']);

// ── ONE-TIME SETUP ─────────────────────────────────────────────
// Creates the initial admin accounts only while none exist. If SETUP_KEY is
// configured, it must be supplied (?key=) so the endpoint can't be triggered
// by a stranger if the Admin collection is ever emptied. Change the seeded
// passwords immediately after first login.
router.get('/setup', async (req, res) => {
  try {
    if (process.env.SETUP_KEY && asString(req.query.key, 200) !== process.env.SETUP_KEY) {
      return res.status(403).send('Forbidden');
    }
    const count = await Admin.countDocuments();
    if (count > 0) return res.send('Setup already done.');
    await new Admin({ name: 'JuanMartin', email: 'juanmartin@conleche.co.za', password: 'admin', role: 'owner' }).save();
    await new Admin({ name: 'IwanGroen',  email: 'iwangroen@conleche.co.za',  password: 'admin', role: 'barista' }).save();
    await new Admin({ name: 'Manager',    email: 'manager@conleche.co.za',     password: 'admin', role: 'manager' }).save();
    res.send('<h2>✓ Done</h2><a href="/admin/login">Login →</a>');
  } catch (err) { res.send('Error: ' + err.message); }
});

// ── AUTH ──────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Staff Login — Con Leche', error: null });
});

router.post('/login', adminLoginLimiter, async (req, res) => {
  try {
    const email    = asString(req.body.email, 200).toLowerCase();
    const password = asString(req.body.password, 200);
    const admin = await Admin.findOne({ email, active: true });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.render('admin/login', { title: 'Staff Login', error: 'Invalid credentials' });
    }
    admin.lastLogin = new Date();
    await admin.save();
    req.session.adminId   = admin._id;
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    // If they came from NFC tap, send them back to check-in
    const token = req.session.checkinToken || req.query.checkin;
    if (token && req.query.checkin) {
      req.session.checkinToken = null;
      return res.redirect(`/admin/checkin?token=${process.env.NFC_TOKEN}`);
    }

    res.redirect('/admin/dashboard');
  } catch (err) {
    res.render('admin/login', { title: 'Staff Login', error: 'Something went wrong.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, async (req, res) => {
  const totalUsers  = await User.countDocuments();
  const scanResult  = await User.aggregate([{ $group: { _id: null, total: { $sum: '$totalDrinks' } } }]);
  const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5);
  const upcomingEvents = await Event.find({ date: { $gte: new Date() } }).sort({ date: 1 }).limit(4);
  res.render('admin/dashboard', {
    title: 'Dashboard — Con Leche Admin',
    admin: req.admin,
    tierInfo: req.admin.tierInfo ? req.admin.tierInfo() : null,
    myXp: req.admin.xp || 0,
    myPuzzles: req.admin.puzzlesCompleted || 0,
    stats: { totalUsers, totalScans: scanResult[0]?.total || 0 },
    recentUsers,
    upcomingEvents
  });
});

// ── QR SCAN ───────────────────────────────────────────────────────
router.get('/scan', requireAdmin, (req, res) => {
  res.render('admin/scan', { title: 'Scan QR — Con Leche', admin: req.admin, result: null });
});

router.post('/scan', requireAdmin, async (req, res) => {
  const panel     = asString(req.body.panel, 32);
  const qrCode    = asString(req.body.qrCode, 200);
  const rewardId  = asString(req.body.rewardId, 64);
  const claimCode = asString(req.body.claimCode, 16);
  let result = { panel };
  try {
    if (panel === 'record') {
      const user = await User.findOne({ qrCode: normalizeToken(qrCode) });
      if (!user) {
        result = { panel, success: false, message: 'QR code not found — is the customer registered?' };
      } else {
        const qty = Math.min(20, Math.max(1, parseInt(req.body.quantity) || 1));
        const newRewards = [];
        for (let i = 0; i < qty; i++) {
          const reward = user.recordDrink('Drink');
          if (reward) newRewards.push(reward);
        }
        await user.save();
        await ActivityLog.create({
          type: 'drinks_added', userId: user._id, userName: user.name,
          adminId: req.admin._id, adminName: req.admin.name,
          quantity: qty, totalAfter: user.totalDrinks
        }).catch(() => {});
        result = { panel, success: true, user, newReward: newRewards[newRewards.length - 1] || null, newRewards, qty };
      }
    } else if (panel === 'confirm') {
      const user = await User.findOne({ qrCode: normalizeToken(qrCode) });
      if (!user) {
        result = { panel, success: false, message: 'Customer not found' };
      } else {
        const confirmed = user.confirmClaim(rewardId, claimCode, req.admin.name);
        if (!confirmed.ok) {
          result = { panel, success: false, message: confirmed.reason };
        } else {
          await user.save();
          await ActivityLog.create({
            type: confirmed.reward.type === 'voucher' ? 'voucher_redeemed' : 'reward_redeemed',
            userId: user._id, userName: user.name,
            adminId: req.admin._id, adminName: req.admin.name,
            rewardType: confirmed.reward.type, rewardDescription: confirmed.reward.description
          }).catch(() => {});
          result = { panel, success: true, rewardDesc: confirmed.reward.description };
        }
      }
    }
  } catch (err) {
    result = { panel, success: false, message: err.message };
  }
  res.render('admin/scan', { title: 'Scan QR — Con Leche', admin: req.admin, result });
});

// Camera scan: step 1 — look the customer up WITHOUT recording anything,
// so the barista gets a popup to choose the quantity first.
router.post('/scan-lookup', requireAdmin, async (req, res) => {
  try {
    const token = normalizeToken(asString(req.body.qrCode, 200));
    const user = await User.findOne({ qrCode: token });
    if (!user) return res.json({ success: false, message: 'QR code not found — is the customer registered?' });
    res.json({ success: true, token, user: { name: user.name, totalDrinks: user.totalDrinks, tier: user.tier } });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Camera scan: step 2 — record the chosen quantity
router.post('/scan-api', requireAdmin, async (req, res) => {
  try {
    const token = normalizeToken(asString(req.body.qrCode, 200));
    const user = await User.findOne({ qrCode: token });
    if (!user) return res.json({ success: false, message: 'QR code not found' });
    const qty = Math.min(20, Math.max(1, parseInt(req.body.quantity) || 1));
    const newRewards = [];
    for (let i = 0; i < qty; i++) {
      const reward = user.recordDrink('Drink');
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
      newRewards
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});


// ═══════════════════ TIME CLOCK ═══════════════════
// Verification, either of:
//  1) Daily code (shown to owner/manager) + request must come from the store network
//  2) NFC tag in the store opens /admin/timeclock/nfc?key=… (its physical location IS the verification)

// 6-digit code that changes every day, derived from CLOCK_SECRET — nothing to store or rotate manually
function dailyClockCode() {
  const secret = process.env.CLOCK_SECRET || 'change-me-in-env';
  const day = new Date().toISOString().slice(0, 10);
  const h = crypto.createHmac('sha256', secret).update(day).digest('hex');
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, '0');
}

// Store-network check: STORE_NETWORK_IPS is a comma list of IPs or prefixes
// e.g. "196.21.45.10" (store's public IP) or "10.0.0." (LAN prefix when self-hosted).
// Unset ⇒ check is skipped (flagged on the page so you remember to set it).
function fromStoreNetwork(req) {
  const allow = (process.env.STORE_NETWORK_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length === 0) return { ok: true, enforced: false };
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const clean = ip.replace('::ffff:', '');
  return { ok: allow.some(a => clean === a || clean.startsWith(a)), enforced: true, ip: clean };
}

function startOfWeek(d = new Date()) {        // Monday 00:00 — weekly totals reset here
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

function shiftMinutes(s, now = new Date()) {  // worked minutes incl. live shifts
  const end = s.clockOut || now;
  let lunch = s.lunchMinutes || 0;
  if (s.lunchOut && !s.lunchIn && !s.clockOut) lunch = Math.round((now - s.lunchOut) / 60000);
  return Math.max(0, Math.round((end - s.clockIn) / 60000) - lunch);
}

router.get('/timeclock', requireAdmin, async (req, res) => {
  const now = new Date();
  const openShift = await TimeClock.findOne({ adminId: req.admin._id, clockOut: null }).sort({ clockIn: -1 });
  const myShifts  = await TimeClock.find({ adminId: req.admin._id, clockIn: { $gte: new Date(now - 14 * 864e5) } })
    .sort({ clockIn: -1 }).limit(30);

  const weekStart = startOfWeek(now);
  const myWeekShifts = await TimeClock.find({ adminId: req.admin._id, clockIn: { $gte: weekStart } });
  const myWeekMinutes = myWeekShifts.reduce((sum, s) => sum + shiftMinutes(s, now), 0);

  // Owner/manager extras: this week's per-person summary + today's code
  let staffWeek = null, todayCode = null;
  if (['owner', 'manager'].includes(req.admin.role)) {
    todayCode = dailyClockCode();
    const all = await TimeClock.find({ clockIn: { $gte: weekStart } });
    const admins = await Admin.find({ active: true }).select('name role weeklyTargetHours');
    staffWeek = admins.map(a => {
      const shifts = all.filter(s => String(s.adminId) === String(a._id));
      const mins   = shifts.reduce((sum, s) => sum + shiftMinutes(s, now), 0);
      const lunch  = shifts.reduce((sum, s) => sum + (s.lunchMinutes || 0), 0);
      const target = (a.weeklyTargetHours || 40) * 60;
      return {
        id: a._id, name: a.name, role: a.role,
        shifts: shifts.length, minutes: mins, lunchMinutes: lunch,
        targetHours: a.weeklyTargetHours || 40,
        leftMinutes: Math.max(0, target - mins),
        live: shifts.some(s => !s.clockOut)
      };
    });
  }

  const net = fromStoreNetwork(req);
  const nfcVerified = req.session.nfcVerifiedUntil && new Date(req.session.nfcVerifiedUntil) > now;

  res.render('admin/timeclock', {
    title: 'Time Clock — Con Leche Admin', admin: req.admin,
    openShift, myShifts, myWeekMinutes,
    staffWeek, todayCode,
    networkEnforced: net.enforced, nfcVerified,
    weekStart,
    msg: req.query.msg || null
  });
});

// NFC tag in the store points here (write the full URL incl. key onto the tag)
router.get('/timeclock/nfc', requireAdmin, (req, res) => {
  if (!process.env.NFC_TAG_KEY || req.query.key !== process.env.NFC_TAG_KEY) {
    return res.redirect('/admin/timeclock?msg=Error:+Invalid+NFC+tag');
  }
  req.session.nfcVerifiedUntil = new Date(Date.now() + 3 * 60 * 1000); // 3-minute window
  res.redirect('/admin/timeclock?msg=NFC+verified+—+you+can+clock+now');
});

router.post('/timeclock/action', requireAdmin, async (req, res) => {
  const action = String(req.body.action || '');
  const code   = String(req.body.code || '').trim();
  const now    = new Date();

  // ── verification ──
  const nfcOk = req.session.nfcVerifiedUntil && new Date(req.session.nfcVerifiedUntil) > now;
  let method = 'nfc';
  if (!nfcOk) {
    method = 'code';
    if (code !== dailyClockCode())
      return res.redirect('/admin/timeclock?msg=Error:+Wrong+code+—+ask+the+manager+for+today%27s+code');
    const net = fromStoreNetwork(req);
    if (!net.ok)
      return res.redirect('/admin/timeclock?msg=Error:+You+must+be+on+the+store+network+to+clock+with+a+code');
  }

  const openShift = await TimeClock.findOne({ adminId: req.admin._id, clockOut: null }).sort({ clockIn: -1 });

  try {
    if (action === 'clock_in') {
      if (openShift) throw new Error('You already have an open shift');
      await TimeClock.create({ adminId: req.admin._id, adminName: req.admin.name, clockIn: now, method });
      await Admin.findByIdAndUpdate(req.admin._id, { checkedIn: true });
      return res.redirect('/admin/timeclock?msg=Shift+started+—+have+a+good+one+☕');
    }
    if (!openShift) throw new Error('No open shift — clock in first');

    if (action === 'lunch_out') {
      if (openShift.lunchOut && !openShift.lunchIn) throw new Error('Already on lunch');
      if (openShift.lunchIn) throw new Error('Lunch already taken this shift');
      openShift.lunchOut = now;
      await openShift.save();
      return res.redirect('/admin/timeclock?msg=Lunch+started+—+enjoy+🥪');
    }
    if (action === 'lunch_in') {
      if (!openShift.lunchOut || openShift.lunchIn) throw new Error('You are not on lunch');
      openShift.lunchIn = now;
      openShift.lunchMinutes = Math.round((now - openShift.lunchOut) / 60000);
      await openShift.save();
      return res.redirect('/admin/timeclock?msg=Welcome+back+—+lunch+was+' + openShift.lunchMinutes + '+min');
    }
    if (action === 'clock_out') {
      if (openShift.lunchOut && !openShift.lunchIn) {
        openShift.lunchIn = now;
        openShift.lunchMinutes = Math.round((now - openShift.lunchOut) / 60000);
      }
      openShift.clockOut = now;
      openShift.totalMinutes = Math.max(0, Math.round((now - openShift.clockIn) / 60000) - (openShift.lunchMinutes || 0));
      await openShift.save();
      // Lifetime hours drive the tier system; XP = 1 per minute worked (checking in
      // is the biggest XP source, as intended)
      await Admin.findByIdAndUpdate(req.admin._id, {
        checkedIn: false,
        $inc: { totalMinutesWorked: openShift.totalMinutes, xp: openShift.totalMinutes }
      });
      const h = Math.floor(openShift.totalMinutes / 60), m = openShift.totalMinutes % 60;
      return res.redirect('/admin/timeclock?msg=Clocked+out+—+' + h + 'h+' + m + 'm+worked+today');
    }
    throw new Error('Unknown action');
  } catch (err) {
    return res.redirect('/admin/timeclock?msg=Error:+' + encodeURIComponent(err.message));
  }
});

// Owner: adjust someone's weekly target hours
router.post('/timeclock/target/:adminId', ownerOnly, async (req, res) => {
  const hours = Math.min(80, Math.max(0, parseInt(req.body.hours) || 40));
  await Admin.findByIdAndUpdate(req.params.adminId, { weeklyTargetHours: hours });
  res.redirect('/admin/timeclock?msg=Target+updated');
});


// ═══════════════════ DAILY PUZZLE + LEADERBOARD (all admin) ═══════════════════
function todayStr() { return new Date().toISOString().slice(0, 10); }

// Get or create today's puzzle word
async function getTodayPuzzle() {
  const date = todayStr();
  let pd = await PuzzleDay.findOne({ date });
  if (!pd) {
    const pick = await pickWordForDay(date, PuzzleDay);
    if (!pick) return null;
    pd = await PuzzleDay.create({
      date, word: pick.word, difficulty: pick.difficulty,
      hint: pick.hint, recycled: !!pick.recycled
    });
  }
  return pd;
}

// Compute Wordle-style tile colours for a guess vs answer
function scoreGuess(guess, answer) {
  guess = guess.toUpperCase(); answer = answer.toUpperCase();
  const res = Array(5).fill('absent');
  const counts = {};
  for (const ch of answer) counts[ch] = (counts[ch] || 0) + 1;
  for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) { res[i] = 'correct'; counts[guess[i]]--; }
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'correct') continue;
    if (counts[guess[i]] > 0) { res[i] = 'present'; counts[guess[i]]--; }
  }
  return res;
}

router.get('/puzzle', requireAdmin, async (req, res) => {
  const date = todayStr();
  const pd = await getTodayPuzzle();
  if (!pd) return res.render('admin/puzzle', { title: 'Daily Puzzle — Con Leche', admin: req.admin, noPool: true, attempt: null, board: [], leaderboard: [], rows: [], finished: false, solved: false, hint: '', answer: '', maxGuesses: 5, msg: null });

  let attempt = await PuzzleAttempt.findOne({ date, adminId: req.admin._id });
  if (!attempt) {
    attempt = await PuzzleAttempt.create({ date, adminId: req.admin._id, adminName: req.admin.name, guesses: [] });
  }

  const rows = attempt.guesses.map(g => ({ guess: g, score: scoreGuess(g, pd.word) }));

  // Leaderboard — puzzles completed (solved) all-time, then XP
  const leaderboard = await Admin.find({ active: true })
    .select('name role puzzlesCompleted xp totalMinutesWorked')
    .sort({ puzzlesCompleted: -1, xp: -1 }).limit(50).lean();

  res.render('admin/puzzle', {
    title: 'Daily Puzzle — Con Leche', admin: req.admin, noPool: false,
    attempt, rows,
    finished: attempt.finished, solved: attempt.solved,
    hint: (attempt.finished ? pd.hint : ''),
    answer: (attempt.finished && !attempt.solved ? pd.word : ''),
    difficulty: pd.difficulty,
    maxGuesses: 5,
    leaderboard,
    msg: req.query.msg || null
  });
});

router.post('/puzzle/guess', requireAdmin, async (req, res) => {
  try {
    const date = todayStr();
    const pd = await getTodayPuzzle();
    if (!pd) return res.json({ ok: false, message: 'No puzzle today' });

    let attempt = await PuzzleAttempt.findOne({ date, adminId: req.admin._id });
    if (!attempt) attempt = await PuzzleAttempt.create({ date, adminId: req.admin._id, adminName: req.admin.name, guesses: [] });
    if (attempt.finished) return res.json({ ok: false, message: 'Already finished today', finished: true });

    const guess = String(req.body.guess || '').trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(guess)) return res.json({ ok: false, message: 'Enter a 5-letter word' });

    attempt.guesses.push(guess);
    const score = scoreGuess(guess, pd.word);
    const solved = guess === pd.word;

    let xpAwarded = 0, tierUp = null;
    if (solved) {
      attempt.solved = true;
      attempt.finished = true;
      attempt.solvedAt = new Date();
      xpAwarded = xpForDifficulty(pd.difficulty);
      // Fewer guesses → small bonus
      if (attempt.guesses.length <= 2) xpAwarded += 10;
      else if (attempt.guesses.length <= 3) xpAwarded += 5;
      attempt.xpAwarded = xpAwarded;
      if (!pd.solvedBy.some(id => String(id) === String(req.admin._id))) {
        pd.solvedBy.push(req.admin._id);
        await pd.save();
      }
      const before = await Admin.findById(req.admin._id).select('xp');
      await Admin.findByIdAndUpdate(req.admin._id, { $inc: { xp: xpAwarded, puzzlesCompleted: 1 } });
    } else if (attempt.guesses.length >= 5) {
      attempt.finished = true;
    }
    await attempt.save();

    res.json({
      ok: true, score, solved,
      finished: attempt.finished,
      guessCount: attempt.guesses.length,
      xp: xpAwarded,
      hint: attempt.finished ? pd.hint : '',
      answer: (attempt.finished && !solved) ? pd.word : ''
    });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.get('/leaderboard', requireAdmin, async (req, res) => {
  const admins = await Admin.find({ active: true })
    .select('name role puzzlesCompleted xp totalMinutesWorked').lean();
  const board = admins.map(a => {
    const hrs = (a.totalMinutesWorked || 0) / 60;
    let tier = Admin.TIER_TABLE[0];
    for (const t of Admin.TIER_TABLE) if (hrs >= t.hours) tier = t;
    return { name: a.name, role: a.role, puzzles: a.puzzlesCompleted || 0, xp: a.xp || 0, tierName: tier.name, tier: tier.tier };
  }).sort((x, y) => y.puzzles - x.puzzles || y.xp - x.xp);
  res.render('admin/leaderboard', { title: 'Leaderboard — Con Leche', admin: req.admin, board, tierTable: Admin.TIER_TABLE, msg: null });
});

// ═══════════════════ INSIGHTS DASHBOARD (owner only) ═══════════════════
router.get('/insights', ownerOnly, async (req, res) => {
  const range = ['day', 'week', 'month', 'quarter'].includes(req.query.range) ? req.query.range : 'week';
  const now = new Date();

  // ── time window + bucket labels ──
  let since, buckets = [], keyOf, labelOf;
  if (range === 'day') {
    since = new Date(now); since.setHours(0, 0, 0, 0);
    for (let h = 0; h <= now.getHours(); h++) buckets.push(h);
    keyOf   = d => new Date(d).getHours();
    labelOf = h => String(h).padStart(2, '0') + ':00';
  } else {
    const days = range === 'week' ? 7 : range === 'month' ? 30 : 90;
    since = new Date(now - (days - 1) * 864e5); since.setHours(0, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 864e5);
      buckets.push(d.toISOString().slice(0, 10));
    }
    keyOf   = d => new Date(d).toISOString().slice(0, 10);
    labelOf = k => {
      const d = new Date(k);
      return range === 'quarter'
        ? d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
        : d.toLocaleDateString('en-ZA', { weekday: range === 'week' ? 'short' : undefined, day: 'numeric', month: 'short' });
    };
  }
  const series = () => Object.fromEntries(buckets.map(b => [b, 0]));

  // ── loyalty: stamps + redemptions from the activity log ──
  const logs = await ActivityLog.find({ at: { $gte: since } }).catch(() => []);
  const stamps = series(), redemptions = series();
  let totalStamps = 0, totalRedemptions = 0;
  logs.forEach(l => {
    const k = keyOf(l.at);
    if (!(k in stamps)) return;
    if (l.type === 'drinks_added') { stamps[k] += l.quantity || 0; totalStamps += l.quantity || 0; }
    else { redemptions[k] += 1; totalRedemptions += 1; }
  });

  // ── sales: orders live inside users.pastOrders ──
  const orderDocs = await User.aggregate([
    { $unwind: '$pastOrders' },
    { $match: { 'pastOrders.placedAt': { $gte: since } } },
    { $project: { _id: 0, total: '$pastOrders.total', items: '$pastOrders.items', placedAt: '$pastOrders.placedAt' } }
  ]).catch(() => []);

  const sales = series(), orderCounts = series();
  let totalSales = 0, totalOrders = 0;
  const productMap = {};
  orderDocs.forEach(o => {
    const k = keyOf(o.placedAt);
    if (k in sales) { sales[k] += o.total || 0; orderCounts[k] += 1; }
    totalSales += o.total || 0; totalOrders += 1;
    (Array.isArray(o.items) ? o.items : []).forEach(it => {
      const name = it && it.name ? String(it.name) : 'Unknown';
      if (!productMap[name]) productMap[name] = { qty: 0, revenue: 0 };
      productMap[name].qty += it.qty || 1;
      productMap[name].revenue += it.price || 0;
    });
  });

  // ── product detail + category split (matched against the menu collections) ──
  const [drinkNames, pastryNames] = await Promise.all([
    Drink.find().select('name').then(r => new Set(r.map(d => d.name))).catch(() => new Set()),
    Pastry.find().select('name').then(r => new Set(r.map(p => p.name))).catch(() => new Set())
  ]);
  const products = Object.entries(productMap)
    .map(([name, v]) => ({
      name, qty: v.qty, revenue: v.revenue,
      category: drinkNames.has(name) ? 'Drinks' : pastryNames.has(name) ? 'Pastries' : 'Other'
    }))
    .sort((a, b) => b.qty - a.qty);
  const categorySplit = { Drinks: 0, Pastries: 0, Other: 0 };
  products.forEach(p => { categorySplit[p.category] += p.revenue; });

  // ── staff hours (time clock) ──
  const shifts = await TimeClock.find({ clockIn: { $gte: since } }).catch(() => []);
  const staffHours = {};
  shifts.forEach(s => {
    const end = s.clockOut || now;
    let lunch = s.lunchMinutes || 0;
    if (s.lunchOut && !s.lunchIn && !s.clockOut) lunch = Math.round((now - s.lunchOut) / 60000);
    const mins = Math.max(0, Math.round((end - s.clockIn) / 60000) - lunch);
    staffHours[s.adminName || 'Staff'] = (staffHours[s.adminName || 'Staff'] || 0) + mins;
  });

  // ── signups ──
  const newUsers = await User.countDocuments({ createdAt: { $gte: since } }).catch(() => 0);

  res.render('admin/insights', {
    title: 'Insights — Con Leche Admin', admin: req.admin, range, msg: null,
    payload: {
      range,
      labels: buckets.map(labelOf),
      stamps: buckets.map(b => stamps[b]),
      redemptions: buckets.map(b => redemptions[b]),
      sales: buckets.map(b => Math.round(sales[b])),
      orders: buckets.map(b => orderCounts[b]),
      products: products.slice(0, 25),
      categorySplit,
      staffHours: Object.entries(staffHours).map(([name, mins]) => ({ name, hours: +(mins / 60).toFixed(1) }))
        .sort((a, b) => b.hours - a.hours),
      summary: {
        totalStamps, totalRedemptions, totalSales: Math.round(totalSales), totalOrders,
        avgOrder: totalOrders ? Math.round(totalSales / totalOrders) : 0,
        newUsers
      }
    }
  });
});

// ─── Activity history (owner/manager) ───
router.get('/history', ownerManager, async (req, res) => {
  const type = ['drinks_added', 'reward_redeemed', 'voucher_redeemed'].includes(req.query.type)
    ? req.query.type : null;
  const query = type ? { type } : {};
  const logs = await ActivityLog.find(query).sort({ at: -1 }).limit(200).catch(() => []);
  res.render('admin/history', {
    title: 'History — Con Leche Admin', admin: req.admin, logs, activeType: type, msg: null
  });
});

// ── EVENTS ────────────────────────────────────────────────────────
router.get('/events', ownerManager, async (req, res) => {
  const events = await Event.find().sort({ date: -1 });
  res.render('admin/events', { title: 'Events — Con Leche Admin', admin: req.admin, events, msg: req.query.msg || null });
});


// Resolve the event type: built-in option or a custom one typed by the admin
function resolveEventType(body) {
  let type = String(body.type || 'special').slice(0, 40);
  if (type === '__custom') {
    const custom = String(body.customType || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    type = custom || 'special';
  }
  return type;
}

router.post('/events/add', ownerManager, makeUploader('events').single('imageFile'), async (req, res) => {
  try {
    const { title, date, location, address, description, recurringType, recurringDay, contactName, contactPhone, socials } = req.body;
    const type = resolveEventType(req.body);
    const image = req.file ? req.file.filename : null;
    const recurring = recurringType && recurringType !== 'none';
    const phone = (contactPhone || '').replace(/\D/g, '');
    await new Event({ title, type, date: new Date(date), location, address, description, recurring, recurringType: recurringType || 'none', recurringDay, image, contactName, contactPhone: phone, socials }).save();
    res.redirect('/admin/events?msg=Event+added');
  } catch (err) { res.redirect('/admin/events?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/events/edit/:id', ownerManager, makeUploader('events').single('imageFile'), async (req, res) => {
  try {
    const { title, date, location, address, description, recurringType, recurringDay, contactName, contactPhone, socials } = req.body;
    const type = resolveEventType(req.body);
    const recurring = recurringType && recurringType !== 'none';
    const phone = (contactPhone || '').replace(/\D/g, '');
    const update = { title, type, date: new Date(date), location, address, description, recurring, recurringType: recurringType || 'none', recurringDay, contactName, contactPhone: phone, socials };
    if (req.file) update.image = req.file.filename;
    await Event.findByIdAndUpdate(req.params.id, update);
    res.redirect('/admin/events?msg=Event+updated');
  } catch (err) { res.redirect('/admin/events?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/events/delete/:id', ownerManager, async (req, res) => {
  await Event.findByIdAndDelete(req.params.id);
  res.redirect('/admin/events?msg=Event+deleted');
});

// ── DRINKS ────────────────────────────────────────────────────────
router.get('/drinks', ownerManager, async (req, res) => {
  const drinks = await Drink.find().sort({ category: 1, order: 1 });
  res.render('admin/drinks', { title: 'Drinks — Con Leche Admin', admin: req.admin, drinks, msg: req.query.msg || null });
});

router.post('/drinks/add', ownerManager, drinkUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, category, subcategory, priceRegular, priceLarge, sizeRegular, sizeLarge, flavours, isSpecial, order, image } = req.body;
    const flavourList = flavours ? flavours.split(',').map(f => f.trim()).filter(Boolean) : [];
    const imageFilename = req.file ? req.file.filename : (image || null);
    await new Drink({
      name, category, subcategory,
      prices: { regular: priceRegular || null, large: priceLarge || null },
      sizeLabels: { regular: sizeRegular || null, large: sizeLarge || null },
      flavours: flavourList, isSpecial: !!isSpecial, order: order || 99,
      image: imageFilename, available: true
    }).save();
    res.redirect('/admin/drinks?msg=Drink+added');
  } catch (err) { res.redirect('/admin/drinks?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/drinks/edit/:id', ownerManager, drinkUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, category, subcategory, priceRegular, priceLarge, sizeRegular, sizeLarge, flavours, isSpecial, available, order, image } = req.body;
    const flavourList = flavours ? flavours.split(',').map(f => f.trim()).filter(Boolean) : [];
    const imageFilename = req.file ? req.file.filename : (image || null);
    await Drink.findByIdAndUpdate(req.params.id, {
      name, category, subcategory,
      prices: { regular: priceRegular ? Number(priceRegular) : null, large: priceLarge ? Number(priceLarge) : null },
      sizeLabels: { regular: sizeRegular || null, large: sizeLarge || null },
      flavours: flavourList, isSpecial: !!isSpecial,
      ...(imageFilename && { image: imageFilename }),
      available: available !== 'false', order: Number(order) || 99, updatedAt: new Date()
    });
    res.redirect('/admin/drinks?msg=Drink+updated');
  } catch (err) { res.redirect('/admin/drinks?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/drinks/delete/:id', ownerManager, async (req, res) => {
  await Drink.findByIdAndDelete(req.params.id);
  res.redirect('/admin/drinks?msg=Drink+deleted');
});

router.post('/drinks/toggle/:id', ownerManager, async (req, res) => {
  const drink = await Drink.findById(req.params.id);
  if (drink) { drink.available = !drink.available; await drink.save(); }
  res.redirect('/admin/drinks?msg=Updated');
});

// ── PASTRIES ──────────────────────────────────────────────────────
router.get('/pastries', ownerManager, async (req, res) => {
  const pastries = await Pastry.find().sort({ order: 1 });
  res.render('admin/pastries', { title: 'Pastries — Con Leche Admin', admin: req.admin, pastries, msg: req.query.msg || null });
});

// ─── Specials (home-page promo cards) ───
router.get('/specials', ownerManager, async (req, res) => {
  const specials = await Special.find().sort({ order: 1, createdAt: -1 });
  res.render('admin/specials', { title: 'Specials — Con Leche Admin', admin: req.admin, specials, msg: req.query.msg || null });
});

router.post('/specials/add', ownerManager, specialUpload.single('imageFile'), async (req, res) => {
  try {
    const { title, description, price, order, category } = req.body;
    const imageFilename = req.file ? req.file.filename : null;
    await new Special({
      title, description,
      price: price ? Number(price) : null,
      category: category || 'general',
      image: imageFilename,
      order: order || 99,
      available: true
    }).save();
    res.redirect('/admin/specials?msg=Special+added');
  } catch (err) { res.redirect('/admin/specials?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/specials/edit/:id', ownerManager, specialUpload.single('imageFile'), async (req, res) => {
  try {
    const { title, description, price, order, available, category } = req.body;
    const update = {
      title, description,
      price: price ? Number(price) : null,
      ...(category && { category }),
      order: order || 99,
      available: available === 'true',
      updatedAt: new Date()
    };
    if (req.file) update.image = req.file.filename;
    await Special.findByIdAndUpdate(req.params.id, update, { runValidators: true });
    res.redirect('/admin/specials?msg=Special+updated');
  } catch (err) { res.redirect('/admin/specials?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/specials/delete/:id', ownerManager, async (req, res) => {
  await Special.findByIdAndDelete(req.params.id);
  res.redirect('/admin/specials?msg=Special+deleted');
});

router.post('/specials/toggle/:id', ownerManager, async (req, res) => {
  const special = await Special.findById(req.params.id);
  if (special) { special.available = !special.available; await special.save(); }
  res.redirect('/admin/specials?msg=Updated');
});

router.post('/pastries/add', ownerManager, pastryUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, description, price, image, order, category } = req.body;
    const imageFilename = req.file ? req.file.filename : (image || null);
    await new Pastry({ name, description, price: Number(price), category: category || 'other', image: imageFilename, order: order || 99, available: true }).save();
    res.redirect('/admin/pastries?msg=Pastry+added');
  } catch (err) { res.redirect('/admin/pastries?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/pastries/edit/:id', ownerManager, pastryUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, description, price, image, available, order, category } = req.body;
    const imageFilename = req.file ? req.file.filename : (image || null);
    await Pastry.findByIdAndUpdate(req.params.id, {
      name, description, price: Number(price),
      ...(category && { category }),
      ...(imageFilename && { image: imageFilename }),
      available: available !== 'false',
      order: Number(order) || 99,
      updatedAt: new Date()
    });
    res.redirect('/admin/pastries?msg=Pastry+updated');
  } catch (err) { res.redirect('/admin/pastries?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/pastries/delete/:id', ownerManager, async (req, res) => {
  await Pastry.findByIdAndDelete(req.params.id);
  res.redirect('/admin/pastries?msg=Pastry+deleted');
});

router.post('/pastries/toggle/:id', ownerManager, async (req, res) => {
  const pastry = await Pastry.findById(req.params.id);
  if (pastry) { pastry.available = !pastry.available; await pastry.save(); }
  res.redirect('/admin/pastries?msg=Updated');
});

// ── MEMBERS ───────────────────────────────────────────────────────
router.get('/users', ownerManager, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.render('admin/users', { title: 'Members — Con Leche Admin', admin: req.admin, users });
});

// ── Delete a member (owner + manager) ────────────────────────────
router.post('/users/delete/:id', ownerManager, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.redirect('/admin/users?msg=Member+deleted');
  } catch (err) {
    res.redirect('/admin/users?msg=Error:+' + encodeURIComponent(err.message));
  }
});

// ── Adjust stamps (barista and up) ───────────────────────────────
router.post('/users/stamps/:id', requireAdmin, async (req, res) => {
  try {
    const { delta, reason } = req.body;          // delta: +1 / -1 / custom number
    const change = parseInt(delta);
    if (isNaN(change)) return res.json({ ok: false, error: 'Invalid delta' });

    const user = await User.findById(req.params.id);
    if (!user) return res.json({ ok: false, error: 'User not found' });

    user.totalDrinks = Math.max(0, user.totalDrinks + change);
    await user.save();
    res.json({ ok: true, totalDrinks: user.totalDrinks });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── NFC CHECK-IN / CHECK-OUT ──────────────────────────────────────
router.get('/checkin', async (req, res) => {
  const { token } = req.query;

  if (token !== process.env.NFC_TOKEN) {
    return res.render('admin/checkin', {
      title: 'Check In — Con Leche',
      state: 'invalid', admin: null,
      message: 'Invalid check-in link. Use the NFC tag in the shop.'
    });
  }

  if (!req.session.adminId) {
    req.session.checkinToken = token;
    return res.redirect('/admin/login?checkin=1');
  }

  const admin = await Admin.findById(req.session.adminId);
  if (!admin || !admin.active) return res.redirect('/admin/login?checkin=1');

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const existing = await CheckIn.findOne({ adminId: admin._id, checkedInAt: { $gte: startOfDay } });

  // No check-in yet → check in
  if (!existing) {
    await new CheckIn({ adminId: admin._id, name: admin.name, role: admin.role, method: 'nfc' }).save();
    return res.render('admin/checkin', {
      title: 'Check In — Con Leche', state: 'success', admin,
      message: `Welcome in, ${admin.name}! Checked in at ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.`,
      action: 'checkin'
    });
  }

  // Checked in but not checked out → check out
  if (!existing.checkedOutAt) {
    existing.checkedOutAt = new Date();
    await existing.save();
    const mins = Math.round((existing.checkedOutAt - existing.checkedInAt) / 1000 / 60);
    const hrs  = Math.floor(mins / 60);
    const rem  = mins % 60;
    const duration = hrs > 0 ? `${hrs}h ${rem}m` : `${mins}m`;
    return res.render('admin/checkin', {
      title: 'Check Out — Con Leche', state: 'checkout', admin,
      message: `See you, ${admin.name}! Checked out at ${existing.checkedOutAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}. You were in for ${duration}.`,
      action: 'checkout'
    });
  }

  // Already both checked in and out today
  return res.render('admin/checkin', {
    title: 'Check In — Con Leche', state: 'already', admin,
    message: `You already checked in and out today.`,
    action: 'done'
  });
});

// ── PIN CHECK-IN (fallback for non-NFC phones) ────────────────────
router.get('/checkin-pin', requireAdmin, async (req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const myCheckIns = await CheckIn.find({
    adminId: req.admin._id,
    checkedInAt: { $gte: sevenDaysAgo }
  }).sort({ checkedInAt: -1 });

  res.render('admin/checkin-pin', {
    title: 'PIN Check In — Con Leche',
    admin: req.admin,
    error: null,
    success: null,
    myCheckIns
  });
});

router.post('/checkin-pin', requireAdmin, async (req, res) => {
  const admin = req.admin;
  const crypto = require('crypto');
  const today = new Date().toISOString().slice(0, 10);
  const dailyPin = crypto.createHash('md5')
    .update(today + (process.env.NFC_TOKEN || 'conleche'))
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  if (req.body.pin?.toUpperCase().trim() !== dailyPin) {
    const myCheckIns = await CheckIn.find({ adminId: admin._id, checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });
    return res.render('admin/checkin-pin', {
      title: 'PIN Check In — Con Leche',
      admin, error: "Wrong PIN — ask your manager for today's PIN.",
      success: null, myCheckIns, action: null
    });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const existing = await CheckIn.findOne({ adminId: admin._id, checkedInAt: { $gte: startOfDay } });
  const myCheckIns = await CheckIn.find({ adminId: admin._id, checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });

  // No check-in yet → check in
  if (!existing) {
    await new CheckIn({ adminId: admin._id, name: admin.name, role: admin.role, method: 'manual' }).save();
    const fresh = await CheckIn.find({ adminId: admin._id, checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });
    return res.render('admin/checkin-pin', {
      title: 'PIN Check In — Con Leche', admin, error: null,
      success: `Welcome in, ${admin.name}! Checked in at ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.`,
      myCheckIns: fresh, action: 'checkin'
    });
  }

  // Checked in, not out → check out
  if (!existing.checkedOutAt) {
    existing.checkedOutAt = new Date();
    await existing.save();
    const mins = Math.round((existing.checkedOutAt - existing.checkedInAt) / 1000 / 60);
    const hrs  = Math.floor(mins / 60);
    const rem  = mins % 60;
    const duration = hrs > 0 ? `${hrs}h ${rem}m` : `${mins}m`;
    const fresh = await CheckIn.find({ adminId: admin._id, checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });
    return res.render('admin/checkin-pin', {
      title: 'PIN Check Out — Con Leche', admin, error: null,
      success: `See you, ${admin.name}! Checked out at ${existing.checkedOutAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}. You were in for ${duration}.`,
      myCheckIns: fresh, action: 'checkout'
    });
  }

  // Both done
  const fresh = await CheckIn.find({ adminId: admin._id, checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });
  return res.render('admin/checkin-pin', {
    title: 'PIN Check In — Con Leche', admin, error: null,
    success: `You've already checked in and out today.`,
    myCheckIns: fresh, action: 'done'
  });
});

// ── STAFF ─────────────────────────────────────────────────────────
router.get('/staff', ownerOnly, async (req, res) => {
  const staff = await Admin.find().sort({ role: 1, name: 1 });

  // Today's check-ins
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayCheckIns = await CheckIn.find({ checkedInAt: { $gte: startOfDay } }).sort({ checkedInAt: -1 });

  // Last 7 days grouped by date
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const recentCheckIns = await CheckIn.find({ checkedInAt: { $gte: sevenDaysAgo } }).sort({ checkedInAt: -1 });

  // Group by date string
  const grouped = {};
  recentCheckIns.forEach(c => {
    const dateKey = c.checkedInAt.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(c);
  });

  // Generate daily PIN (changes every day based on date + secret)
  const crypto = require('crypto');
  const today = new Date().toISOString().slice(0, 10);
  const dailyPin = crypto.createHash('md5')
    .update(today + (process.env.NFC_TOKEN || 'conleche'))
    .digest('hex')
    .slice(0, 4)
    .toUpperCase();

  const nfcUrl = `${req.protocol}://${req.get('host')}/admin/checkin?token=${process.env.NFC_TOKEN}`;
  const pinUrl = `${req.protocol}://${req.get('host')}/admin/checkin-pin`;

  res.render('admin/staff', {
    title: 'Staff — Con Leche Admin',
    admin: req.admin,
    staff,
    todayCheckIns,
    grouped,
    nfcUrl,
    pinUrl,
    dailyPin,
    query: req.query
  });
});

router.post('/staff/add', ownerOnly, async (req, res) => {
  try {
    const name     = asString(req.body.name, 100);
    const email    = asString(req.body.email, 200).toLowerCase();
    const password = asString(req.body.password, 200);
    const role     = asString(req.body.role, 20);
    if (!name || !email || !password) return res.redirect('/admin/staff?error=All+fields+required');
    if (password.length < 8) return res.redirect('/admin/staff?error=Password+must+be+8%2B+characters');
    if (!['owner', 'manager', 'barista'].includes(role)) return res.redirect('/admin/staff?error=Invalid+role');
    const exists = await Admin.findOne({ email });
    if (exists) return res.redirect('/admin/staff?error=Email+already+exists');
    await new Admin({ name, email, password, role }).save();
    res.redirect('/admin/staff?success=Staff+member+added');
  } catch (err) { res.redirect('/admin/staff?error=' + encodeURIComponent(err.message)); }
});

router.post('/staff/toggle/:id', ownerOnly, async (req, res) => {
  const staff = await Admin.findById(req.params.id);
  if (staff && staff._id.toString() !== req.session.adminId.toString()) {
    staff.active = !staff.active;
    await staff.save();
  }
  res.redirect('/admin/staff');
});

// ── ONLINE ORDERS (all admin roles can access) ────────────────────
router.get('/orders', requireAdmin, (req, res) => {
  res.render('admin/orders', { title: 'Online Orders — Con Leche Admin', admin: req.admin });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────
router.get('/notifications', ownerManager, async (req, res) => {
  const notifications = await Notification.find().sort({ sendAt: -1 });
  const userCount = await User.countDocuments();
  res.render('admin/notifications', {
    title: 'Notifications — Con Leche Admin',
    admin: req.admin, notifications, userCount,
    msg: req.query.msg || null
  });
});

router.post('/notifications/create', ownerManager, async (req, res) => {
  try {
    const title    = asString(req.body.title, 200);
    const body     = asString(req.body.body, 2000);
    const category = asString(req.body.category, 20);
    const repeat   = asString(req.body.repeat, 20) || 'none';
    const sendAt   = new Date(asString(req.body.sendAt, 30));

    if (!title || !body || !category || isNaN(sendAt.getTime()))
      return res.redirect('/admin/notifications?msg=Missing+required+fields');
    if (!['specials','events'].includes(category))
      return res.redirect('/admin/notifications?msg=Invalid+category');
    if (!['none','weekly','monthly'].includes(repeat))
      return res.redirect('/admin/notifications?msg=Invalid+repeat');

    await Notification.create({
      title, body, category, repeat, sendAt,
      createdBy: req.admin.name
    });
    res.redirect('/admin/notifications?msg=Notification+scheduled');
  } catch (err) {
    res.redirect('/admin/notifications?msg=' + encodeURIComponent(err.message));
  }
});

router.post('/notifications/:id/edit', ownerManager, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.redirect('/admin/notifications?msg=Not+found');

    notif.title    = asString(req.body.title, 200) || notif.title;
    notif.body     = asString(req.body.body, 2000) || notif.body;
    notif.category = asString(req.body.category, 20) || notif.category;
    notif.repeat   = asString(req.body.repeat, 20)   || notif.repeat;
    const newSendAt = new Date(asString(req.body.sendAt, 30));
    if (!isNaN(newSendAt.getTime())) {
      notif.sendAt = newSendAt;
      notif.sentAt = null; // allow re-fire if rescheduled
    }
    await notif.save();
    res.redirect('/admin/notifications?msg=Notification+updated');
  } catch (err) {
    res.redirect('/admin/notifications?msg=' + encodeURIComponent(err.message));
  }
});

router.post('/notifications/:id/toggle', ownerManager, async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (notif) { notif.active = !notif.active; await notif.save(); }
  res.redirect('/admin/notifications?msg=Notification+updated');
});

router.post('/notifications/:id/delete', ownerOnly, async (req, res) => {
  await Notification.findByIdAndDelete(req.params.id);
  res.redirect('/admin/notifications?msg=Notification+deleted');
});

// ── CHECK IN / OUT toggle ─────────────────────────────────────────
router.post('/checkin', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);
    admin.checkedIn = !admin.checkedIn;
    await admin.save();
    res.json({ ok: true, checkedIn: admin.checkedIn });
  } catch (err) {
    res.json({ ok: false });
  }
});

module.exports = router;
