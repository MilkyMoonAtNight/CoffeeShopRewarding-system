const mongoose = require('mongoose');

const pastrySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price:       { type: Number, required: true },
  image:       { type: String, default: null },
  category:    { type: String, enum: ['croissant','donut','cookie','sandwich','quiche','cake','other'], default: 'other' },
  isSpecial:   { type: Boolean, default: false },
  available:   { type: Boolean, default: true },
  order:       { type: Number, default: 99 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

pastrySchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('Pastry', pastrySchema);
