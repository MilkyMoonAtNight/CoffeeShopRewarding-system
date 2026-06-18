const express = require('express');
const router  = express.Router();
const Drink   = require('../models/Drink');
const Pastry  = require('../models/Pastry');
const User    = require('../models/User');
const Admin   = require('../models/Admin');
const { notifyStaffNewOrder, notifyCustomerStatusUpdate } = require('../utils/mailer');
const { asString, cleanText } = require('../utils/security');

// Statuses an admin is allowed to set — prevents arbitrary/script values being
// stored on the order and later rendered in the dashboard / emailed out.
const ALLOWED_STATUSES = ['pending', 'preparing', 'ready', 'done', 'paid', 'cancelled'];

// ── Auth guard ────────────────────────────────────────────────────
function requireUser(req, res, next) {
  if (!req.session.userId) return res.redirect('/login?next=/order');
  next();
}

// ── Order page ────────────────────────────────────────────────────
router.get('/', requireUser, async (req, res) => {
  const allDrinks = await Drink.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);
  const hot  = allDrinks.filter(d => d.category === 'hot');
  const cold = allDrinks.filter(d => d.category === 'cold');

  let pastries = await Pastry.find({ available: true }).sort({ order: 1 }).catch(() => []);
  if (!pastries.length) {
    pastries = [
      { name: 'Butter Croissant',  description: 'Flaky, golden, layered to perfection',          price: 38, image: '/images/pastries/655847140_122106598179267672_2803138726600608537_n.jpg' },
      { name: 'Chocolate Pain',    description: 'Dark chocolate wrapped in buttery pastry',       price: 42, image: '/images/pastries/656193104_122106598269267672_5884950660951476565_n.jpg' },
      { name: 'Almond Croissant',  description: 'Twice-baked with frangipane & toasted almonds', price: 48, image: '/images/pastries/656498474_122106598353267672_4790678177011394174_n.jpg' },
      { name: 'Morning Bun',       description: 'Orange sugar-dusted swirled pastry',             price: 40, image: '/images/pastries/657364639_122106598305267672_3332752999638859901_n.jpg' },
      { name: 'Cinnamon Danish',   description: 'Cream cheese & cinnamon in a fluted shell',     price: 44, image: '/images/pastries/657891931_122106598221267672_8131615443921352503_n.jpg' },
    ];
  } else {
    pastries = pastries.map(p => ({
      ...p.toObject(),
      image: p.image ? (p.image.startsWith('/') ? p.image : `/images/pastries/${p.image}`) : null,
    }));
  }

  const user = await User.findById(req.session.userId).select('name').catch(() => null);
  res.render('pages/order', { title: 'Order — Con Leche', hot, cold, pastries, user });
});

// ── My orders ─────────────────────────────────────────────────────
router.get('/my-orders', requireUser, async (req, res) => {
  const user = await User.findById(req.session.userId).select('pastOrders').lean();
  const orders = (user && user.pastOrders)
    ? user.pastOrders.sort((a,b) => new Date(b.placedAt)-new Date(a.placedAt))
    : [];
  res.render('pages/my-orders', { title: 'My Orders — Con Leche', orders });
});

// ── My orders — live status poll (SSE) ───────────────────────────
// Client connects to this endpoint and gets pushed updates when status changes
router.get('/my-orders/stream', requireUser, async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Send current orders immediately
  const push = async () => {
    const user = await User.findById(req.session.userId).select('pastOrders').lean();
    const orders = (user && user.pastOrders)
      ? user.pastOrders.sort((a,b) => new Date(b.placedAt)-new Date(a.placedAt))
      : [];
    send({ orders });
  };

  await push();

  // Poll every 8 seconds and push if anything changed
  const interval = setInterval(push, 8000);
  req.on('close', () => clearInterval(interval));
});

// ── Confirm page ──────────────────────────────────────────────────
router.get('/confirm', requireUser, (req, res) => {
  res.render('pages/order-confirm', { title: 'Confirm Order — Con Leche' });
});

// ── Virtual slip (receipt) for a placed order ────────────────────
router.get('/slip/:ref', requireUser, async (req, res) => {
  const ref = asString(req.params.ref, 60);
  const user = await User.findById(req.session.userId).select('name email pastOrders').lean();
  const order = user && user.pastOrders
    ? user.pastOrders.find(o => o.ref === ref)
    : null;
  if (!order) return res.status(404).render('pages/order-slip', { title: 'Slip — Con Leche', order: null, customerName: user ? user.name : '' });
  res.render('pages/order-slip', {
    title: `Slip ${order.ref} — Con Leche`,
    order,
    customerName: order.name || (user ? user.name : ''),
  });
});

// ── Place order ───────────────────────────────────────────────────
router.post('/place', requireUser, async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length === 0)
      return res.json({ ok: false, error: 'Cart is empty' });
    if (body.items.length > 50)
      return res.json({ ok: false, error: 'Too many items' });

    // Sanitise every free-text field so nothing executable reaches the admin
    // dashboard (which renders these via innerHTML) or the staff notification email.
    const items = body.items.map(raw => {
      const it = raw && typeof raw === 'object' ? raw : {};
      const price = Math.max(0, Number(it.price) || 0);
      return {
        name:     cleanText(it.name, 120) || 'Item',
        type:     cleanText(it.type, 30),
        category: cleanText(it.category, 30),
        size:     cleanText(it.size, 40),
        ml:       cleanText(it.ml, 20),
        flavour:  cleanText(it.flavour, 60),
        milk:     cleanText(it.milk, 40),
        sugar:    cleanText(it.sugar, 40),
        notes:    cleanText(it.notes, 300),
        image:    cleanText(it.image, 300),
        price,
      };
    });

    // Authoritative total is computed on the server from the (sanitised) line
    // items — the client-supplied `total` is ignored to stop price tampering.
    // NOTE: item.price still originates from the client. For full integrity the
    // unit price should be looked up from the Drink/Pastry collections here.
    const total = items.reduce((sum, it) => sum + it.price, 0);

    const collection = cleanText(body.collection, 40);
    const notes      = cleanText(body.notes, 500);
    const name       = cleanText(body.name, 100);
    const phone      = asString(body.phone, 30).replace(/[^\d+()\s-]/g, '');
    const email      = asString(body.email, 200).toLowerCase();
    const paymentMethod = body.paymentMethod === 'cash' ? 'cash' : 'online';

    // Trust gate: a customer whose trust index has dropped too low can't place
    // another unpaid cash order — they must pay online instead.
    const TRUST_MIN = 40;
    if (paymentMethod === 'cash') {
      const u = await User.findById(req.session.userId).select('trustIndex').lean();
      if (u && typeof u.trustIndex === 'number' && u.trustIndex < TRUST_MIN) {
        return res.json({ ok: false, error: 'trust_low',
          message: 'Pay-in-store is temporarily unavailable on your account due to past no-shows. Please pay online for this order.' });
      }
    }

    const ref   = 'CL-' + Date.now().toString(36).toUpperCase();
    const order = {
      ref, items, total,
      pickupMethod: collection, notes,
      paymentMethod,
      paymentStatus: paymentMethod === 'cash' ? 'pending' : 'pending',
      status: 'pending', placedAt: new Date(),
    };
    if (name)  order.name  = name;
    if (phone) order.phone = phone;
    if (email) order.email = email;

    // Save to user (and count cash orders for the trust profile)
    const userUpdate = { $push: { pastOrders: { $each: [order], $position: 0 } } };
    if (paymentMethod === 'cash') userUpdate.$inc = { cashOrdersPlaced: 1 };
    const user = await User.findByIdAndUpdate(req.session.userId, userUpdate,
      { new: false }).select('name email').lean();

    // Email all checked-in staff ─────────────────────────────────
    const checkedInStaff = await Admin.find({ checkedIn: true, active: true }).select('email').lean();
    const staffEmails    = checkedInStaff.map(s => s.email).filter(Boolean);

    const orderForEmail = {
      ...order,
      userName:  user ? user.name  : name,
      userEmail: user ? user.email : email,
    };

    if (staffEmails.length) {
      notifyStaffNewOrder(orderForEmail, staffEmails).catch(err =>
        console.error('Staff email error:', err.message)
      );
    }

    res.json({ ok: true, ref });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, error: 'Something went wrong' });
  }
});

// ── Update order status (admin only) ─────────────────────────────
router.post('/status/:userId/:ref', async (req, res) => {
  // Must be a logged-in admin to change order status
  if (!req.session.adminId) return res.json({ ok: false, error: 'Unauthorised' });
  try {
    const status = asString(req.body.status, 30);
    if (!ALLOWED_STATUSES.includes(status)) return res.json({ ok: false, error: 'Invalid status' });
    await User.updateOne(
      { _id: req.params.userId, 'pastOrders.ref': req.params.ref },
      { $set: { 'pastOrders.$.status': status } }
    );

    // Email the customer about the status update
    const user = await User.findOne(
      { _id: req.params.userId, 'pastOrders.ref': req.params.ref },
      { 'pastOrders.$': 1, email: 1 }
    ).lean();

    if (user) {
      const order       = user.pastOrders && user.pastOrders[0];
      const orderEmail  = (order && order.email) || user.email;
      if (orderEmail && order) {
        notifyCustomerStatusUpdate(order, orderEmail, status).catch(err =>
          console.error('Customer status email error:', err.message)
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── Settle a cash order: mark paid (collected) or no-show (admin only) ──
// Honoured cash orders nudge trust back up; no-shows drop it.
router.post('/settle/:userId/:ref', async (req, res) => {
  if (!req.session.adminId) return res.json({ ok: false, error: 'Unauthorised' });
  try {
    const outcome = asString(req.body.outcome, 20); // 'paid' | 'no_show'
    if (!['paid', 'no_show'].includes(outcome)) return res.json({ ok: false, error: 'Invalid outcome' });

    const setOps = { 'pastOrders.$.paymentStatus': outcome };
    if (outcome === 'paid') setOps['pastOrders.$.status'] = 'done';
    const incOps = outcome === 'paid'
      ? { trustIndex: 5,  cashOrdersHonored: 1 }
      : { trustIndex: -25, cashNoShows: 1 };

    await User.updateOne(
      { _id: req.params.userId, 'pastOrders.ref': req.params.ref },
      { $set: setOps, $inc: incOps }
    );
    // Clamp trust index to 0–100
    const u = await User.findById(req.params.userId).select('trustIndex').lean();
    if (u) {
      const clamped = Math.max(0, Math.min(100, u.trustIndex));
      if (clamped !== u.trustIndex) await User.updateOne({ _id: req.params.userId }, { $set: { trustIndex: clamped } });
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── Admin feed ────────────────────────────────────────────────────
router.get('/admin-feed', async (req, res) => {
  if (!req.session.adminId) return res.json({ ok: false });
  try {
    const users = await User.find({ 'pastOrders.0': { $exists: true } })
      .select('name email pastOrders trustIndex').lean();
    const orders = [];
    users.forEach(u => {
      u.pastOrders.forEach(o => {
        orders.push({ ...o, userName: u.name, userEmail: u.email, userId: u._id, trustIndex: u.trustIndex });
      });
    });
    orders.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
    res.json({ ok: true, orders });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
