const express = require('express');
const router  = express.Router();
const Drink   = require('../models/Drink');
const Pastry  = require('../models/Pastry');
const User    = require('../models/User');
const Admin   = require('../models/Admin');
const { notifyStaffNewOrder, notifyCustomerStatusUpdate } = require('../utils/mailer');

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

// ── Place order ───────────────────────────────────────────────────
router.post('/place', requireUser, async (req, res) => {
  try {
    const { name, phone, email, collection, notes, items, total } = req.body;
    if (!items || !items.length) return res.json({ ok: false, error: 'Cart is empty' });

    const ref   = 'CL-' + Date.now().toString(36).toUpperCase();
    const order = {
      ref, items, total: Number(total),
      pickupMethod: collection, notes,
      status: 'pending', placedAt: new Date(),
    };
    if (phone) order.phone = phone;
    if (email) order.email = email;

    // Save to user
    const user = await User.findByIdAndUpdate(req.session.userId, {
      $push: { pastOrders: { $each: [order], $position: 0 } }
    }, { new: false }).select('name email').lean();

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

// ── Update order status ───────────────────────────────────────────
router.post('/status/:userId/:ref', async (req, res) => {
  try {
    const { status } = req.body;
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

// ── Admin feed ────────────────────────────────────────────────────
router.get('/admin-feed', async (req, res) => {
  if (!req.session.adminId) return res.json({ ok: false });
  try {
    const users = await User.find({ 'pastOrders.0': { $exists: true } })
      .select('name email pastOrders').lean();
    const orders = [];
    users.forEach(u => {
      u.pastOrders.forEach(o => {
        orders.push({ ...o, userName: u.name, userEmail: u.email, userId: u._id });
      });
    });
    orders.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
    res.json({ ok: true, orders });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
