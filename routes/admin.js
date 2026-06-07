const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');
const Admin   = require('../models/Admin');
const User    = require('../models/User');
const Event   = require('../models/Event');
const Drink   = require('../models/Drink');
const Pastry  = require('../models/Pastry');
const CheckIn = require('../models/CheckIn');

// ── Multer — image uploads ────────────────────────────────────────
function makeUploader(subfolder) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, '..', 'public', 'images', subfolder));
    },
    filename: (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
      const base = path.basename(file.originalname, path.extname(file.originalname))
                       .replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
      cb(null, `${base}-${Date.now()}${ext}`);
    }
  });
  return multer({ storage, limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only image files allowed'), false);
    }
  });
}
const drinkUpload  = makeUploader('drinks');
const pastryUpload = makeUploader('pastries');

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
router.get('/setup', async (req, res) => {
  try {
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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
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
  const { panel, qrCode, rewardId, claimCode } = req.body;
  let result = { panel };
  try {
    if (panel === 'record') {
      const user = await User.findOne({ qrCode });
      if (!user) {
        result = { panel, success: false, message: 'QR code not found — is the customer registered?' };
      } else {
        const qty = Math.min(20, Math.max(1, parseInt(req.body.quantity) || 1));
        let newReward = null;
        for (let i = 0; i < qty; i++) {
          const reward = user.recordDrink('Drink');
          if (reward) newReward = reward;
        }
        await user.save();
        result = { panel, success: true, user, newReward, qty };
      }
    } else if (panel === 'confirm') {
      const user = await User.findOne({ qrCode });
      if (!user) {
        result = { panel, success: false, message: 'Customer not found' };
      } else {
        const confirmed = user.confirmClaim(rewardId, claimCode);
        if (!confirmed.ok) {
          result = { panel, success: false, message: confirmed.reason };
        } else {
          await user.save();
          result = { panel, success: true, rewardDesc: confirmed.reward.description };
        }
      }
    }
  } catch (err) {
    result = { panel, success: false, message: err.message };
  }
  res.render('admin/scan', { title: 'Scan QR — Con Leche', admin: req.admin, result });
});

// Camera scan API
router.post('/scan-api', requireAdmin, async (req, res) => {
  try {
    const { qrCode } = req.body;
    const user = await User.findOne({ qrCode });
    if (!user) return res.json({ success: false, message: 'QR code not found' });
    const newReward = user.recordDrink('Drink');
    await user.save();
    res.json({ success: true, user: { name: user.name, totalDrinks: user.totalDrinks, tier: user.tier }, newReward });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ── EVENTS ────────────────────────────────────────────────────────
router.get('/events', ownerManager, async (req, res) => {
  const events = await Event.find().sort({ date: -1 });
  res.render('admin/events', { title: 'Events — Con Leche Admin', admin: req.admin, events, msg: req.query.msg || null });
});

router.post('/events/add', ownerManager, makeUploader('events').single('imageFile'), async (req, res) => {
  try {
    const { title, type, date, location, address, description, recurring, recurringDay } = req.body;
    const image = req.file ? req.file.filename : null;
    await new Event({ title, type, date: new Date(date), location, address, description, recurring: !!recurring, recurringDay, image }).save();
    res.redirect('/admin/events?msg=Event+added');
  } catch (err) { res.redirect('/admin/events?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/events/edit/:id', ownerManager, makeUploader('events').single('imageFile'), async (req, res) => {
  try {
    const { title, type, date, location, address, description, recurring, recurringDay } = req.body;
    const update = { title, type, date: new Date(date), location, address, description, recurring: !!recurring, recurringDay };
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

router.post('/pastries/add', ownerManager, pastryUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, description, price, image, order } = req.body;
    const imageFilename = req.file ? req.file.filename : (image || null);
    await new Pastry({ name, description, price: Number(price), image: imageFilename, order: order || 99, available: true }).save();
    res.redirect('/admin/pastries?msg=Pastry+added');
  } catch (err) { res.redirect('/admin/pastries?msg=Error:+' + encodeURIComponent(err.message)); }
});

router.post('/pastries/edit/:id', ownerManager, pastryUpload.single('imageFile'), async (req, res) => {
  try {
    const { name, description, price, image, available, order } = req.body;
    const imageFilename = req.file ? req.file.filename : (image || null);
    await Pastry.findByIdAndUpdate(req.params.id, {
      name, description, price: Number(price),
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
    const { name, email, password, role } = req.body;
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
