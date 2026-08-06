const express = require('express');
const router = express.Router();
const Event  = require('../models/Event');
const Drink  = require('../models/Drink');
const Pastry = require('../models/Pastry');
const Special = require('../models/Special');
const Texture = require('../models/Texture');
const ContactMessage = require('../models/ContactMessage');
const Review = require('../models/Review');
const Ad = require('../models/Ad');
const { loadUpcomingEvents } = require('../utils/eventOccurrence');
const { sendContactMessageEmail } = require('../utils/mailer');

// Load every texture as a { slug: {...} } map for the drink-panel renderer.
async function loadTextureMap() {
  const list = await Texture.find().lean().catch(() => []);
  const map = {};
  list.forEach(t => {
    map[t.slug] = { baseColor: t.baseColor, dots: t.dots, dotColor: t.dotColor, dotDensity: t.dotDensity, name: t.name };
  });
  return map;
}
// An uploaded photo wins; legacy .svg filenames are treated as "no photo".
function hasPhoto(image) {
  return !!image && !String(image).toLowerCase().endsWith('.svg');
}

router.get('/', async (req, res) => {
  const upcomingEvents = await loadUpcomingEvents(Event, { limit: 3 });

  const rawSpecials = await Special.find({ available: true })
    .sort({ order: 1, createdAt: -1 }).limit(6).catch(() => []);
  const specials = rawSpecials.map(s => ({
    ...s.toObject(),
    image: s.image ? (s.image.startsWith('/') ? s.image : '/images/specials/' + s.image) : null
  }));

  const reviews = await Review.find({ active: true })
    .sort({ order: 1, createdAt: -1 }).catch(() => []);

  res.render('pages/home', {
    title: 'Con Leche — Cat-Friendly Specialty Coffee',
    upcomingEvents,
    specials,
    reviews
  });
});

// ── Contact form (home page) — anonymous Username / Subject / Details ──
router.post('/contact', async (req, res) => {
  // Honeypot — bots fill hidden fields; humans never see it.
  if (req.body.website) return res.json({ ok: true });

  const username = (req.body.username || '').trim().slice(0, 120) || 'Anonymous';
  const subject  = (req.body.subject  || '').trim();
  const details  = (req.body.details  || '').trim();

  if (!subject || !details) {
    return res.status(400).json({ ok: false, error: 'Please fill in a subject and some details.' });
  }
  if (subject.length > 200) {
    return res.status(400).json({ ok: false, error: 'That subject is a little too long — please shorten it.' });
  }
  if (details.length > 3000) {
    return res.status(400).json({ ok: false, error: 'That message is a little too long — please shorten it.' });
  }

  try {
    // Save first — the message is captured even if the email heads-up fails.
    await ContactMessage.create({ username, subject, details });
    sendContactMessageEmail({ username, subject, details })
      .catch(err => console.error('Contact email failed:', err.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('Contact message save failed:', err.message);
    res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please try again later.' });
  }
});

// ── 🤫 Not linked anywhere. If you found this, you know the way. ──
router.get('/the-bean-awakens', (req, res) => {
  res.render('pages/the-bean-awakens', { title: 'A Long Time Ago…' });
});

router.get('/about', (req, res) => {
  res.render('pages/about', { title: 'Our Story — Con Leche' });
});

router.get('/pastries', async (req, res) => {
  let raw = await Pastry.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);

  // All pastries come from the database — managed in /admin/pastries
  const pastries = raw.map(p => ({
    ...p.toObject(),
    image: p.image ? (p.image.startsWith('/') ? p.image : '/images/pastries/' + p.image) : null
  }));


  const ORDER  = ['croissant','danish','donut','cookie','sandwich','quiche','cake','other'];
  const LABELS = { croissant:'Croissants', danish:'Danishes', donut:'Donuts', cookie:'Cookies', sandwich:'Sandwiches', quiche:'Quiches', cake:'Cakes', other:'Other' };
  const ICONS  = { croissant:'🥐', danish:'🧁', donut:'🍩', cookie:'🍪', sandwich:'🥪', quiche:'🥧', cake:'🎂', other:'🍴' };

  const grouped = {};
  ORDER.forEach(cat => { grouped[cat] = []; });
  pastries.forEach(p => {
    const cat = p.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  });

  res.render('pages/pastries', { title: 'Pastries — Con Leche', grouped, LABELS, ICONS, ORDER });
});


router.get('/drinks', async (req, res) => {
  // All drinks come from the database — managed in /admin/drinks.
  // Priority: uploaded photo > layered texture panel > neutral panel.
  // Legacy .svg filenames are ignored (the panel replaces them).
  let allDrinks = await Drink.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);
  const textures = await loadTextureMap();

  const hot  = allDrinks.filter(d => d.category === 'hot');
  const cold = allDrinks.filter(d => d.category === 'cold');
  const adDoc = await Ad.findOne({ active: true }).sort({ updatedAt: -1 }).catch(() => null);
  const ad = adDoc ? { image: adDoc.image ? '/images/ads/' + adDoc.image : null, caption: adDoc.caption, link: adDoc.link } : null;
  res.render('pages/drinks', { title: 'Drinks — Con Leche', hot, cold, textures, ad });
});

const LATTE_FLAVOURS      = ['Plain','Vanilla','Hazelnut','Chocolate','Cinnamon','American Fudge','Caramel','Popcorn'];
const FREEZO_FLAVOURS     = ['White Chocolate','Chai','Coffee','Chocolate','Salted Caramel'];
const FROZENYOG_FLAVOURS  = [...LATTE_FLAVOURS,'Strawberry','Cherry','Litchi','Creamsoda','Apple'];
const FILLER = {
  espresso: { cal:'~80 kcal',  protein:'1g', caff:'~150mg' },
  specialty:{ cal:'~180 kcal', protein:'5g', caff:'~95mg'  },
  chocolate:{ cal:'~240 kcal', protein:'7g', caff:'~30mg'  },
  tea:      { cal:'~20 kcal',  protein:'0g', caff:'~40mg'  },
  freezo:   { cal:'~310 kcal', protein:'4g', caff:'~60mg'  },
  iced:     { cal:'~140 kcal', protein:'5g', caff:'~95mg'  },
  frozen:   { cal:'~280 kcal', protein:'6g', caff:'~50mg'  },
  other:    { cal:'~120 kcal', protein:'4g', caff:'~80mg'  },
};

const STATIC_DRINKS = [
  { _id: 'flat-white',    name: 'Flat White',      category: 'hot',  subcategory: 'espresso',  prices: { regular: 35, large: 45 }, isSpecial: false, image: null, flavours: [] },
  { _id: 'cappuccino',    name: 'Cappuccino',       category: 'hot',  subcategory: 'espresso',  prices: { regular: 35, large: 45 }, isSpecial: false, image: null, flavours: [] },
  { _id: 'vanilla-latte', name: 'Vanilla Latte',    category: 'hot',  subcategory: 'specialty', prices: { regular: 40, large: 50 }, isSpecial: false, image: null, flavours: [] },
  { _id: 'iced-latte',    name: 'Iced Latte',       category: 'cold', subcategory: 'iced',      prices: { regular: 45, large: 55 }, isSpecial: false, image: null, flavours: [] },
  { _id: 'freezo',        name: 'Freezo',           category: 'cold', subcategory: 'freezo',    prices: { regular: 50, large: 60 }, isSpecial: false, image: null, flavours: [] },
  { _id: 'frozen-yogurt', name: 'Frozen Yogurt',    category: 'cold', subcategory: 'frozen',    prices: { regular: 55, large: 65 }, isSpecial: false, image: null, flavours: [] },
];

router.get('/drinks/:id', async (req, res) => {
  const param = decodeURIComponent(req.params.id);

  // Try by MongoDB _id first, then by exact name, then case-insensitive name
  let drinkDoc = null;
  if (param.match(/^[a-f\d]{24}$/i)) {
    drinkDoc = await Drink.findById(param).catch(() => null);
  }
  if (!drinkDoc) {
    drinkDoc = await Drink.findOne({ name: param }).catch(() => null);
  }
  if (!drinkDoc) {
    drinkDoc = await Drink.findOne({ name: new RegExp('^' + param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).catch(() => null);
  }

  // Static fallback — match by _id string or name
  if (!drinkDoc) {
    drinkDoc = STATIC_DRINKS.find(d => d._id === param || d.name.toLowerCase() === param.toLowerCase()) || null;
  }

  if (!drinkDoc) return res.redirect('/drinks');

  const d = drinkDoc.toObject ? drinkDoc.toObject() : { ...drinkDoc };
  const dn = d.name.toLowerCase();

  // Flavour list
  if (dn.includes('frozen yogurt') || dn.includes('froyo')) d.flavours = FROZENYOG_FLAVOURS;
  else if (dn.includes('freezo'))  d.flavours = FREEZO_FLAVOURS;
  else if (dn.includes('latte'))   d.flavours = LATTE_FLAVOURS;
  else if (!d.flavours || !d.flavours.length) d.flavours = [];

  // Size objects — Sml / Lrg / Grande (label from sizeLabels if set)
  const ml = (key, def) => (d.sizeLabels && d.sizeLabels[key]) ? d.sizeLabels[key] : def;
  d.sizes = [
    d.prices && d.prices.regular ? { label: 'Sml',    ml: ml('regular', d.category === 'hot' ? '250ml' : '350ml'), price: d.prices.regular } : null,
    d.prices && d.prices.large   ? { label: 'Lrg',    ml: ml('large',   d.category === 'hot' ? '350ml' : '500ml'), price: d.prices.large   } : null,
    d.prices && d.prices.grande  ? { label: 'Grande', ml: ml('grande',  d.category === 'hot' ? '450ml' : '650ml'), price: d.prices.grande  } : null,
  ].filter(Boolean);

  const info = FILLER[d.subcategory] || FILLER.other;
  const loggedIn = !!(req.session && req.session.userId);
  const textures = await loadTextureMap();

  res.render('pages/drink-detail', { title: `${d.name} — Con Leche`, drink: d, info, loggedIn, textures });
});

router.get('/events', async (req, res) => {
  const events = await loadUpcomingEvents(Event);
  res.render('pages/events', { title: 'Events & Calendar — Con Leche', events });
});

module.exports = router;