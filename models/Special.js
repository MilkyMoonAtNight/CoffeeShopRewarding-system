const mongoose = require('mongoose');

const specialSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price:       { type: Number, default: null },   // optional — some specials are "2-for-1" style
  category:    { type: String, default: 'general', trim: true },  // drink | pastry | combo | seasonal | general
  image:       { type: String, default: null },   // filename inside /public/images/specials/
  available:   { type: Boolean, default: true },
  order:       { type: Number, default: 99 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

specialSchema.pre('save', function(next) { this.updatedAt = new Date(); next(); });

module.exports = mongoose.model('Special', specialSchema);
