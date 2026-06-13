require('dotenv').config();
const mongoose = require('mongoose');
const Admin  = require('./models/Admin');
const User   = require('./models/User');
const Event  = require('./models/Event');
const Drink  = require('./models/Drink');
const Pastry = require('./models/Pastry');

// ── LATTE FLAVOURS ───────────────────────────────────────────────
const latteFlavours = [
  'Plain', 'Vanilla', 'Hazelnut', 'Chocolate', 'Cinnamon',
  'American Fudge', 'Caramel', 'Popcorn'
];

const freezoFlavours = [
  'White Chocolate', 'Chai', 'Coffee', 'Chocolate', 'Salted Caramel'
];

const frozenYogurtFlavours = [
  // All latte flavours plus fruity
  'Plain', 'Vanilla', 'Hazelnut', 'Chocolate', 'Cinnamon',
  'American Fudge', 'Caramel', 'Popcorn',
  'Strawberry', 'Cherry', 'Litchi', 'Cream Soda', 'Apple'
];

// ── DRINKS DATA ──────────────────────────────────────────────────
// sizeLabels: hot → Regular 250ml / Large 350ml | cold → Regular 350ml / Large 500ml
const drinks = [
  // ── HOT ──────────────────────────────────────────
  {
    name: 'Americano', category: 'hot', subcategory: 'espresso',
    prices: { regular: 33, large: 38 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 1
  },
  {
    name: 'Cappuccino', category: 'hot', subcategory: 'espresso',
    prices: { regular: 36, large: 40 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 2
  },
  {
    name: 'Café Latte', category: 'hot', subcategory: 'espresso',
    prices: { regular: 35, large: 40 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 3
  },
  {
    name: 'Cortado', category: 'hot', subcategory: 'espresso',
    prices: { regular: 41, large: null },
    sizeLabels: { regular: '250ml', large: null },
    order: 4
  },
  {
    name: 'Flat White', category: 'hot', subcategory: 'espresso',
    prices: { regular: 39, large: 44 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 5
  },
  {
    name: 'Macchiato', category: 'hot', subcategory: 'espresso',
    prices: { regular: 36, large: null },
    sizeLabels: { regular: '250ml', large: null },
    order: 6
  },
  {
    name: 'Flavoured Latte', category: 'hot', subcategory: 'espresso',
    prices: { regular: 39, large: 44 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    flavours: latteFlavours,
    order: 7
  },
  {
    name: 'Hot Chocolate', category: 'hot', subcategory: 'chocolate',
    prices: { regular: 42, large: 49 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 8
  },
  {
    name: 'White Chocolate', category: 'hot', subcategory: 'chocolate',
    prices: { regular: 42, large: 49 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 9
  },
  {
    name: 'Chai Latte', category: 'hot', subcategory: 'tea',
    prices: { regular: 36, large: 45 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 10
  },
  {
    name: 'Matcha', category: 'hot', subcategory: 'tea',
    prices: { regular: null, large: 55 },
    sizeLabels: { regular: null, large: '350ml' },
    order: 11
  },
  {
    name: 'Red Cappuccino', category: 'hot', subcategory: 'specialty',
    prices: { regular: 40, large: 44 },
    sizeLabels: { regular: '250ml', large: '350ml' },
    order: 12
  },
  {
    name: 'Latte of the Month', category: 'hot', subcategory: 'specialty',
    prices: { regular: null, large: 65 },
    sizeLabels: { regular: null, large: '350ml' },
    isSpecial: true,
    order: 13
  },

  // ── COLD ─────────────────────────────────────────
  {
    name: 'Freezo', category: 'cold', subcategory: 'freezo',
    prices: { regular: 45, large: 50 },
    sizeLabels: { regular: '350ml', large: '500ml' },
    flavours: freezoFlavours,
    order: 1
  },
  {
    name: 'Iced Latte', category: 'cold', subcategory: 'iced',
    prices: { regular: 45, large: 50 },
    sizeLabels: { regular: '350ml', large: '500ml' },
    flavours: latteFlavours,
    order: 2
  },
  {
    name: 'Slushi', category: 'cold', subcategory: 'other',
    prices: { regular: null, large: 30 },
    sizeLabels: { regular: null, large: '500ml' },
    order: 3
  },
  {
    name: 'Matcha (Cold)', category: 'cold', subcategory: 'tea',
    prices: { regular: null, large: 60 },
    sizeLabels: { regular: null, large: '500ml' },
    order: 4
  },
  {
    name: 'Fizz Fizz', category: 'cold', subcategory: 'other',
    prices: { regular: null, large: 30 },
    sizeLabels: { regular: null, large: '500ml' },
    order: 5
  },
  {
    name: 'Frozen Yogurt', category: 'cold', subcategory: 'frozen',
    prices: { regular: null, large: 55 },
    sizeLabels: { regular: null, large: '500ml' },
    flavours: frozenYogurtFlavours,
    order: 6
  },
  {
    name: 'Frozen Yogurt Matcha', category: 'cold', subcategory: 'frozen',
    prices: { regular: null, large: 65 },
    sizeLabels: { regular: null, large: '500ml' },
    order: 7
  },
  {
    name: 'Latte of the Month (Cold)', category: 'cold', subcategory: 'specialty',
    prices: { regular: null, large: 65 },
    sizeLabels: { regular: null, large: '500ml' },
    isSpecial: true,
    order: 8
  },
];

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('MONGODB_URI not set in .env');

// ── ADMIN ACCOUNTS ──────────────────────────────────────────────
const admins = [
  {
    name: 'Owner',
    email: 'owner@conleche.co.za',
    password: 'ChangeMe123!',
    role: 'owner'
  },
  {
    name: 'Manager',
    email: 'manager@conleche.co.za',
    password: 'ChangeMe123!',
    role: 'manager'
  },
  {
    name: 'Barista One',
    email: 'barista@conleche.co.za',
    password: 'ChangeMe123!',
    role: 'barista'
  }
];

// ── SAMPLE EVENTS ────────────────────────────────────────────────
const now = new Date();
const days = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

const events = [
  {
    title: 'Saturday Run Club',
    type: 'run_club',
    date: days(4),
    location: 'Zoo Lake, Johannesburg',
    address: 'Zoo Lake, Parkview, Johannesburg',
    description: '7AM start — 5km social run through the park followed by coffee back at the truck. All paces welcome. Bring your battlepass for a bonus stamp!',
    recurring: true,
    recurringDay: 'saturday'
  },
  {
    title: 'Mobile Truck — Rosebank Sunday Market',
    type: 'truck_location',
    date: days(5),
    location: 'Rosebank Sunday Market',
    address: 'Bath Ave, Rosebank, Johannesburg',
    description: 'Find us at Rosebank Market from 8AM to 2PM. Full menu available — croissants sell out by 10.'
  },
  {
    title: 'Paint & Sip Evening',
    type: 'painting',
    date: days(9),
    location: 'Con Leche Studio, Melville',
    address: '7th Street, Melville, Johannesburg',
    description: 'A relaxed evening of guided painting with local artist Nandi Dlamini, paired with our signature drinks and a pastry board. Limited to 20 spots — DM us to book.'
  },
  {
    title: 'Mobile Truck — Neighbourgoods Market',
    type: 'truck_location',
    date: days(11),
    location: 'Neighbourgoods Market, Braamfontein',
    address: '73 Juta St, Braamfontein, Johannesburg',
    description: 'Saturday morning in Braamfontein. We\'ll be set up from 8AM–1PM. Come early for the almond croissants.'
  },
  {
    title: 'Saturday Run Club',
    type: 'run_club',
    date: days(11),
    location: 'Zoo Lake, Johannesburg',
    address: 'Zoo Lake, Parkview, Johannesburg',
    description: '7AM start — weekly social run. All welcome.',
    recurring: true,
    recurringDay: 'saturday'
  },
  {
    title: 'Pop-Up — Sandton City Atrium',
    type: 'pop_up',
    date: days(16),
    location: 'Sandton City, Sandton',
    address: 'Sandton City Shopping Centre, Sandton',
    description: 'We\'re popping up inside Sandton City for the weekend. Friday to Sunday, 9AM–5PM.'
  }
];

// ── SEED FUNCTION ────────────────────────────────────────────────
async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // Admins
    console.log('Seeding admins...');
    for (const data of admins) {
      const exists = await Admin.findOne({ email: data.email });
      if (exists) {
        console.log(`  ↳ Skipped (already exists): ${data.email}`);
        continue;
      }
      const admin = new Admin(data);
      await admin.save();
      console.log(`  ✓ Created [${data.role}]: ${data.email}`);
    }

    // Events
    console.log('\nSeeding events...');
    await Event.deleteMany({});
    const createdEvents = await Event.insertMany(events);
    console.log(`  ✓ Created ${createdEvents.length} events`);

    // Drinks
    console.log('\nSeeding drinks...');
    await Drink.deleteMany({});
    const createdDrinks = await Drink.insertMany(drinks);
    console.log(`  ✓ Created ${createdDrinks.length} drinks`);

    // Pastries
    console.log('\nSeeding pastries...');
    await Pastry.deleteMany({});
    const pastries = [
      { name: 'Butter Croissant',  description: 'Flaky, golden, layered to perfection',          price: 38, category: 'croissant', image: '655847140_122106598179267672_2803138726600608537_n.jpg', order: 1 },
      { name: 'Chocolate Pain',    description: 'Dark chocolate wrapped in buttery pastry',       price: 42, category: 'croissant', image: '656193104_122106598269267672_5884950660951476565_n.jpg', order: 2 },
      { name: 'Almond Croissant',  description: 'Twice-baked with frangipane & toasted almonds', price: 48, category: 'croissant', image: '656498474_122106598353267672_4790678177011394174_n.jpg', order: 3 },
      { name: 'Morning Bun',       description: 'Orange sugar-dusted swirled pastry',             price: 40, category: 'cake', image: '657364639_122106598305267672_3332752999638859901_n.jpg', order: 4 },
      { name: 'Cinnamon Danish',   description: 'Cream cheese & cinnamon in a fluted shell',     price: 44, category: 'cake', image: '657891931_122106598221267672_8131615443921352503_n.jpg', order: 5 },
    ];
    const createdPastries = await Pastry.insertMany(pastries);
    console.log(`  ✓ Created ${createdPastries.length} pastries`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Seed complete! Default credentials:');
    console.log('  Owner   → owner@conleche.co.za   / ChangeMe123!');
    console.log('  Manager → manager@conleche.co.za / ChangeMe123!');
    console.log('  Barista → barista@conleche.co.za / ChangeMe123!');
    console.log('\n⚠  Change all passwords after first login!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
