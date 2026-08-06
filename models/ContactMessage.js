const mongoose = require('mongoose');

// An anonymous message left via the home-page contact panel. No email/phone is
// ever captured — even a logged-in visitor stays anonymous.
const contactMessageSchema = new mongoose.Schema({
  username:  { type: String, default: 'Anonymous', trim: true },
  subject:   { type: String, required: true, trim: true },
  details:   { type: String, required: true, trim: true },
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
