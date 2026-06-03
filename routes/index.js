const express = require('express');
const router = express.Router();
const Event  = require('../models/Event');
const Drink  = require('../models/Drink');
const Pastry = require('../models/Pastry');

router.get('/', async (req, res) => {
  const upcomingEvents = await Event.find({ date: { $gte: new Date() } })
    .sort({ date: 1 }).limit(3).catch(() => []);
  res.render('pages/home', { title: 'Con Leche — Cat-Friendly Specialty Coffee', upcomingEvents });
});

router.get('/about', (req, res) => {
  res.render('pages/about', { title: 'Our Story — Con Leche' });
});

router.get('/pastries', async (req, res) => {
  let pastries = await Pastry.find({ available: true }).sort({ order: 1 }).catch(() => []);
  // fallback to static if DB empty
  if (pastries.length === 0) {
    pastries = [
      { name: 'Butter Croissant',  description: 'Flaky, golden, layered to perfection',          price: 38, image: '655847140_122106598179267672_2803138726600608537_n.jpg' },
      { name: 'Chocolate Pain',    description: 'Dark chocolate wrapped in buttery pastry',       price: 42, image: '656193104_122106598269267672_5884950660951476565_n.jpg' },
      { name: 'Almond Croissant',  description: 'Twice-baked with frangipane & toasted almonds', price: 48, image: '656498474_122106598353267672_4790678177011394174_n.jpg' },
      { name: 'Morning Bun',       description: 'Orange sugar-dusted swirled pastry',             price: 40, image: '657364639_122106598305267672_3332752999638859901_n.jpg' },
      { name: 'Cinnamon Danish',   description: 'Cream cheese & cinnamon in a fluted shell',     price: 44, image: '657891931_122106598221267672_8131615443921352503_n.jpg' },
    ];
    // normalise to same shape as DB docs
    pastries = pastries.map(p => ({ ...p, image: `/images/pastries/${p.image}` }));
  } else {
    pastries = pastries.map(p => ({
      ...p.toObject(),
      image: p.image ? (p.image.startsWith('/') ? p.image : `/images/pastries/${p.image}`) : null
    }));
  }
  res.render('pages/pastries', { title: 'Pastries — Con Leche', pastries });
});

router.get('/drinks', async (req, res) => {
  const allDrinks = await Drink.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);
  const hot  = allDrinks.filter(d => d.category === 'hot');
  const cold = allDrinks.filter(d => d.category === 'cold');
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

router.get('/drinks/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  let drink = await Drink.findOne({ name, available: true }).catch(() => null);

  // Fallback: case-insensitive search
  if (!drink) {
    drink = await Drink.findOne({ name: new RegExp(`^${name}$`, 'i'), available: true }).catch(() => null);
  }
  if (!drink) return res.redirect('/drinks');

  const d = drink.toObject();
  const dn = d.name.toLowerCase();

  // Build flavour list
  if (dn.includes('frozen yogurt') || dn.includes('froyo')) d.flavours = FROZENYOG_FLAVOURS;
  else if (dn.includes('freezo'))  d.flavours = FREEZO_FLAVOURS;
  else if (dn.includes('latte'))   d.flavours = LATTE_FLAVOURS;
  else if (!d.flavours || !d.flavours.length) d.flavours = [];

  // Build size objects
  d.sizes = [
    d.prices && d.prices.regular ? { label:'Regular', ml: d.category==='hot' ? '250ml' : '350ml', price: d.prices.regular } : null,
    d.prices && d.prices.large   ? { label:'Large',   ml: d.category==='hot' ? '350ml' : '500ml', price: d.prices.large   } : null,
  ].filter(Boolean);

  const info = FILLER[d.subcategory] || FILLER.other;
  const loggedIn = !!(req.session && req.session.userId);

  res.render('pages/drink-detail', { title: `${d.name} — Con Leche`, drink: d, info, loggedIn });
});

router.get('/events', async (req, res) => {
  const events = await Event.find({ date: { $gte: new Date() } }).sort({ date: 1 }).catch(() => []);
  res.render('pages/events', { title: 'Events & Calendar — Con Leche', events });
});

module.exports = router;
