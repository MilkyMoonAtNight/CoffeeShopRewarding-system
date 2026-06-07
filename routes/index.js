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
  let raw = await Pastry.find({ available: true }).sort({ category: 1, order: 1 }).catch(() => []);

  const STATIC = [
    { name:'Pizza Croissant',           description:'Tomato, cheese and herbs baked into a flaky croissant', price:52, category:'croissant', isSpecial:false, image:null },
    { name:'Biltong Croissant',         description:'South African biltong folded into buttery pastry',      price:55, category:'croissant', isSpecial:false, image:null },
    { name:'White Chocolate Croissant', description:'White chocolate melted through golden layers',          price:48, category:'croissant', isSpecial:false, image:null },
    { name:'Chocolate Croissant',       description:'Dark chocolate tucked inside a classic croissant',      price:46, category:'croissant', isSpecial:false, image:null },
    { name:'Cheese Croissant',          description:'Melted cheese baked inside a flaky shell',              price:44, category:'croissant', isSpecial:false, image:null },
    { name:'Biscoff Croissant',         description:'Speculoos spread and Biscoff crumble inside and out',   price:58, category:'croissant', isSpecial:true,  image:null },
    { name:'Oreo Croissant',            description:'Oreo cream filling with crushed cookie topping',        price:56, category:'croissant', isSpecial:true,  image:null },
    { name:'Specialty Croissant',       description:'Ask your barista for today special',                    price:60, category:'croissant', isSpecial:true,  image:null },
    { name:'Oreo Donut',                description:'Glazed ring topped with Oreo crumble',                 price:38, category:'donut',     isSpecial:false, image:null },
    { name:'White Chocolate Donut',     description:'White chocolate ganache glazed donut',                  price:36, category:'donut',     isSpecial:false, image:null },
    { name:'Chocolate Donut',           description:'Classic chocolate glazed ring donut',                   price:34, category:'donut',     isSpecial:false, image:null },
    { name:'Specialty Donut',           description:'Ask your barista for today special',                    price:42, category:'donut',     isSpecial:true,  image:null },
    { name:'Choc Chip Cookie',          description:'Chunky chocolate chips in a soft baked cookie',        price:28, category:'cookie',    isSpecial:false, image:null },
    { name:'Double Choc Cookie',        description:'Chocolate dough, chocolate chips, pure bliss',         price:30, category:'cookie',    isSpecial:false, image:null },
    { name:'Oreo Cookie',               description:'Oreo pieces baked into a soft cookie',                 price:30, category:'cookie',    isSpecial:false, image:null },
    { name:'White Choc Cookie',         description:'White chocolate chips in a golden cookie',             price:28, category:'cookie',    isSpecial:false, image:null },
    { name:'Smarties and Nutella Cookie', description:'Nutella swirl with Smarties pressed on top',         price:35, category:'cookie',    isSpecial:true,  image:null },
    { name:'Chicken Mayo Rye',          description:'Creamy chicken mayo on toasted rye bread',             price:65, category:'sandwich',  isSpecial:false, image:null },
    { name:'Chicken Mayo Sourdough',    description:'Chicken mayo on house sourdough',                     price:68, category:'sandwich',  isSpecial:false, image:null },
    { name:'Chicken Mayo Wholewheat',   description:'Chicken mayo on wholewheat bread',                    price:62, category:'sandwich',  isSpecial:false, image:null },
    { name:'Chicken Mayo Honey Oat',    description:'Chicken mayo on honey oat wholewheat',                price:64, category:'sandwich',  isSpecial:false, image:null },
    { name:'Feta Quiche',               description:'Creamy feta filling in a buttery pastry shell',        price:58, category:'quiche',    isSpecial:false, image:null },
    { name:'Ham and Mushroom Quiche',   description:'Smoky ham and sauteed mushrooms in egg custard',       price:62, category:'quiche',    isSpecial:false, image:null },
    { name:'Signature Carrot Cake',     description:'Award-competing carrot cake with cream cheese icing',  price:75, category:'cake',      isSpecial:true,  image:null },
    { name:'Chocolate Cake',            description:'Rich layered chocolate cake with ganache',              price:70, category:'cake',      isSpecial:false, image:null },
    { name:'Coffee Cake',               description:'Espresso-soaked sponge with mocha buttercream',        price:70, category:'cake',      isSpecial:false, image:null },
    { name:'Oreo Cake',                 description:'Oreo crumb layers with cookies and cream frosting',    price:72, category:'cake',      isSpecial:false, image:null },
    { name:'Biscoff Cake',              description:'Speculoos sponge with Biscoff spread buttercream',     price:75, category:'cake',      isSpecial:true,  image:null },
    { name:'Caramel Cake',              description:'Salted caramel layers with caramel drip',              price:72, category:'cake',      isSpecial:false, image:null },
  ];

  let pastries = raw.length > 0
    ? raw.map(p => ({ ...p.toObject(), image: p.image ? (p.image.startsWith('/') ? p.image : '/images/pastries/' + p.image) : null }))
    : STATIC;

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

  // Static fallback when DB is empty
  if (!allDrinks.length) {
    allDrinks = [
      { _id: 'flat-white',    name: 'Flat White',      category: 'hot',  subcategory: 'espresso',  prices: { regular: 35, large: 45 }, isSpecial: false, image: null, flavours: [] },
      { _id: 'cappuccino',    name: 'Cappuccino',       category: 'hot',  subcategory: 'espresso',  prices: { regular: 35, large: 45 }, isSpecial: false, image: null, flavours: [] },
      { _id: 'vanilla-latte', name: 'Vanilla Latte',    category: 'hot',  subcategory: 'specialty', prices: { regular: 40, large: 50 }, isSpecial: false, image: null, flavours: [] },
      { _id: 'iced-latte',    name: 'Iced Latte',       category: 'cold', subcategory: 'iced',      prices: { regular: 45, large: 55 }, isSpecial: false, image: null, flavours: [] },
      { _id: 'freezo',        name: 'Freezo',           category: 'cold', subcategory: 'freezo',    prices: { regular: 50, large: 60 }, isSpecial: false, image: null, flavours: [] },
      { _id: 'frozen-yogurt', name: 'Frozen Yogurt',    category: 'cold', subcategory: 'frozen',    prices: { regular: 55, large: 65 }, isSpecial: false, image: null, flavours: [] },
    ];
  }

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
  const events = await Event.find({ date: { $gte: new Date() } }).sort({ date: 1 }).catch(() => []);
  res.render('pages/events', { title: 'Events & Calendar — Con Leche', events });
});

module.exports = router;
