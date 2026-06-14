const mongoose = require('mongoose');

// A notification is a message the admin schedules to go out to opted-in customers.
// category determines which emailPreferences flag gates it.
const notificationSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  body:        { type: String, required: true, trim: true },  // plain-text body shown in email
  category: {
    type: String,
    enum: ['specials', 'events'],   // 'birthday' emails are automatic, not manual
    required: true
  },
  // When to send. If repeating, this is the first send date.
  sendAt:      { type: Date, required: true },
  // Repeat cadence. null = one-shot.
  repeat: {
    type: String,
    enum: ['none', 'weekly', 'monthly'],
    default: 'none'
  },
  // Set once the job has fired for this sendAt date. Cleared and sendAt advanced for repeating.
  sentAt:      { type: Date, default: null },
  sentCount:   { type: Number, default: 0 },
  createdBy:   { type: String, default: 'Admin' },
  createdAt:   { type: Date, default: Date.now },
  active:      { type: Boolean, default: true }
});

module.exports = mongoose.model('Notification', notificationSchema);
