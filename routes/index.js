const express = require('express');
const router = express.Router();
const Event  = require('../models/Event');
const Drink  = require('../models/Drink');
const Pastry = require('../models/Pastry');
const Special = require('../models/Special');
const { loadUpcomingEvents } = require('../utils/eventOccurrence');

router.get('/', async (req, res) => {
  const upcomingEvents = await loadUpcomingEvents(Event, { limit: 3 });

  const rawSpecials = await Special.find({ available: true })
    .sort({ order: 1, createdAt: -1 }).limit(6).catch(() => []);
  const specials = rawSpecials.map(s => ({
    ...s.toObject(),
    image: s.image ? (s.image.startsWith('/') ? s.image : '/images/specials/' + s.image) : null
  }));

  res.render('pages/home', {
    title: 'Con Leche — Cat-Friendly Specialty Coffee',
    upcomingEvents,
    specials
  });
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


  const ORDER  = ['croissant','donut','cookie','sandwich','quiche','cake','other'];
  const LABELS = { croissant:'Croissants', donut:'Donuts', cookie:'Cookies', sandwich:'Sandwiches', quiche:'Quiches', cake:'Cakes', other:'Other' };
  const ICONS  = { croissant:'🥐', donut:'🍩', cookie:'🍪', sandwich:'🥪', quiche:'🥧', cake:'🎂', other:'🍴' };

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
  let allDrinks = await Drink.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);

  // All drinks come from the database — managed in /admin/drinks

  // For each drink, check if a matching SVG/image icon exists in /images/drinks/
  // Priority: DB image > named file in /images/drinks/ > generated SVG cup
  const fs   = require('fs');
  const path = require('path');
  const drinksImgDir = path.join(__dirname, '..', 'public', 'images', 'drinks');

  function svgSlug(name) {
    return (name||'').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const resolvedDrinks = allDrinks.map(function(d) {
    if (d.image) return d; // DB image set — use it
    var slug = svgSlug(d.name || '');
    var candidates = [slug+'.svg', slug+'.png', slug+'.jpg', slug+'.webp'];
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(path.join(drinksImgDir, candidates[i]))) {
        var base = d.toObject ? d.toObject() : Object.assign({}, d);
        base.image = candidates[i];
        return base;
      }
    }
    return d; // no file — fall through to generated SVG
  });

  const hot  = resolvedDrinks.filter(d => d.category === 'hot');
  const cold = resolvedDrinks.filter(d => d.category === 'cold');
  res.render('pages/drinks', { title: 'Drinks — Con Leche', hot, cold });
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

  // Size objects
  d.sizes = [
    d.prices && d.prices.regular ? { label: 'Regular', ml: d.category === 'hot' ? '250ml' : '350ml', price: d.prices.regular } : null,
    d.prices && d.prices.large   ? { label: 'Large',   ml: d.category === 'hot' ? '350ml' : '500ml', price: d.prices.large   } : null,
  ].filter(Boolean);

  const info = FILLER[d.subcategory] || FILLER.other;
  const loggedIn = !!(req.session && req.session.userId);

  res.render('pages/drink-detail', { title: `${d.name} — Con Leche`, drink: d, info, loggedIn });
});

router.get('/events', async (req, res) => {
  const events = await loadUpcomingEvents(Event);
  res.render('pages/events', { title: 'Events & Calendar — Con Leche', events });
});

module.exports = router;