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
    regular: { type: Number, default: null },  // null = size not available
    large:   { type: Number, default: null }
  },
  sizeLabels: {
    regular: { type: String, default: null },
    large:   { type: String, default: null }
  },
  flavours: [{ type: String, trim: true }],  // if drink has flavour variants
  image:     { type: String, default: null }, // filename in public/images/drinks/
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
