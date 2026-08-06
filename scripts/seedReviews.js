// One-off: seed the current hard-coded home-page reviews into the DB so the
// admin starts with them. Only runs when the Review collection is empty.
// Run: node scripts/seedReviews.js
const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');

const seed = [
  { person: 'Andrew Kruger',      platform: 'Google',   stars: 5, details: "Been all over the world in coffee shops. This one gets a 5 out of 5 rating. Wonderful experience of coffee pastries atmosphere and friendly service" },
  { person: 'JJ Jacobs',          platform: 'Google',   stars: 5, details: "I love the coffee, they even have interesting flavours like Crème Brûlée. There are a lot of nice snacks as well from Quiches and Croissants to a variety of tasteful cookies. Worth a visit on the way to drop off / pick up the kids, as they are open from 6am to 6pm" },
  { person: 'Stuart Ross',        platform: 'Google',   stars: 5, details: "Our waiter was really on the ball. When we asked for our bill, he already had it split for everyone without us even having to ask." },
  { person: 'Mariette Thomas',    platform: 'Google',   stars: 5, details: "What a great place! Right by the high school — parents can get a good parking spot and have a coffee while they wait. Friendly staff, clean, feels like having a 'kuier' on your own 'stoep'. Will definitely recommend." },
  { person: 'Isa Giunta',         platform: 'Google',   stars: 5, details: "Came for the 6h30 Saturday run (ok, walk for me 😉). Stayed for the great coffee and welcoming atmosphere." },
  { person: 'Melt van der Spuy',  platform: 'Google',   stars: 5, details: "Very friendly, warm and welcoming! Sample croissant was lovely and we're definitely coming back for the croissant tasting." },
  { person: 'Tanita Hattingh',    platform: 'Facebook', stars: 5, details: "Super friendly staff. Just treated myself with a Chai Freezo and it's amazing… Well done guys… See you again ❤❤🥰 Such a cute little store." },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const count = await Review.countDocuments();
  if (count > 0) {
    console.log('Reviews already exist (' + count + ') — nothing seeded.');
  } else {
    await Review.insertMany(seed.map((r, i) => ({ ...r, order: i + 1 })));
    console.log('✓ Seeded ' + seed.length + ' reviews.');
  }
  await mongoose.disconnect();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
