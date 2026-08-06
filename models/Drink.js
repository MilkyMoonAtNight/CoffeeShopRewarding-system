const mongoose = require('mongoose');

const drinkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ['hot', 'cold'],
    required: true
  },
  subcategory: {
    type: String,
    enum: ['espresso', 'specialty', 'chocolate', 'tea', 'freezo', 'iced', 'frozen', 'other'],
    default: 'other'
  },
  prices: {
    regular: { type: Number, default: null },  // shown as "Sml" — null = size not available
    large:   { type: Number, default: null },  // "Lrg"
    grande:  { type: Number, default: null }   // "Grande" — prices soon
  },
  sizeLabels: {
    regular: { type: String, default: null },
    large:   { type: String, default: null },
    grande:  { type: String, default: null }
  },
  description: { type: String, default: '', trim: true }, // short one-liner shown on detail page
  flavours: [{ type: String, trim: true }],  // if drink has flavour variants
  image:     { type: String, default: null }, // filename in public/images/drinks/
  // Layered texture panel shown when no photo is set. Each layer is a texture
  // (referenced by slug) filling `pct`% of the cup, drawn bottom→top.
  layers: {
    type: [{
      textureSlug: { type: String, trim: true },
      pct:         { type: Number, default: 0, min: 0, max: 100 }
    }],
    default: []
  },
  available: { type: Boolean, default: true },
  isSpecial: { type: Boolean, default: false }, // e.g. latte of the month
  order: { type: Number, default: 0 },          // display order
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { suppressReservedKeysWarning: true });

drinkSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Drink', drinkSchema);
