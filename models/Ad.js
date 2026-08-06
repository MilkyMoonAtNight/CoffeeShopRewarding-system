const mongoose = require('mongoose');

// A single speciality-drink advert banner shown above the footer on /drinks.
// Only one is used at a time (the most recently saved active one).
const adSchema = new mongoose.Schema({
  image:     { type: String, default: null },  // filename in public/images/ads/
  caption:   { type: String, default: '', trim: true },
  link:      { type: String, default: '', trim: true },
  active:    { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now }
});

const Ad = mongoose.model('Ad', adSchema);

// The one banner to show (newest active), or null.
Ad.current = function () {
  return Ad.findOne({ active: true }).sort({ updatedAt: -1 });
};

module.exports = Ad;
