const mongoose = require('mongoose');

// A customer review shown on the home page, managed from /admin/reviews.
const reviewSchema = new mongoose.Schema({
  stars:    { type: Number, default: 5, min: 1, max: 5 },
  person:   { type: String, required: true, trim: true },
  details:  { type: String, required: true, trim: true },
  platform: { type: String, default: 'Google', trim: true }, // Google / Facebook / …
  order:    { type: Number, default: 0 },
  active:   { type: Boolean, default: true },
  createdAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('Review', reviewSchema);
