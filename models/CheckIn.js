const mongoose = require('mongoose');

const checkInSchema = new mongoose.Schema({
  adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  name:      { type: String, required: true },
  role:      { type: String, required: true },
  checkedInAt: { type: Date, default: Date.now },
  method:    { type: String, enum: ['nfc', 'manual'], default: 'nfc' }
});

module.exports = mongoose.model('CheckIn', checkInSchema);
