const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  type: { type: String, default: 'special', trim: true },
  date: { type: Date, required: true },
  endDate: Date,
  location: String,
  address: String,
  recurring: { type: Boolean, default: false },
  recurringType: { type: String, default: 'none' }, // 'none' | 'daily' | 'weekly'
  recurringDay: String,
  image: String,
  contactName: String,
  contactPhone: String,  // digits only, e.g. 27821234567
  socials: String,       // optional URL or handle
  createdAt: { type: Date, default: Date.now }
}, { suppressReservedKeysWarning: true });

module.exports = mongoose.model('Event', eventSchema);
