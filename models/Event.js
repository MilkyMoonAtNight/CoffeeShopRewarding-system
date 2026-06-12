const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  type: { type: String, default: 'special', trim: true },  // free-form: built-in types plus custom ones from admin
  date: { type: Date, required: true },
  endDate: Date,
  location: String,
  address: String,
  recurring: { type: Boolean, default: false },
  recurringDay: String, // 'saturday', 'sunday' etc
  image: String,
  createdAt: { type: Date, default: Date.now }
}, { suppressReservedKeysWarning: true });

module.exports = mongoose.model('Event', eventSchema);
