const mongoose = require('mongoose');

const pastrySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price:       { type: Number, required: true },
  image:       { type: String, default: null }, // filename from public/images/pastries/
  available:   { type: Boolean, default: true },
  order:       { type: Number, default: 99 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
}, { suppressReservedKeysWarning: true });

pastrySchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Pastry', pastrySchema);
