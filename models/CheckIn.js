const mongoose = require('mongoose');

const checkInSchema = new mongoose.Schema({
  adminId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  name:         { type: String, required: true },
  role:         { type: String, required: true },
  checkedInAt:  { type: Date, default: Date.now },
  checkedOutAt: { type: Date, default: null },
  method:       { type: String, enum: ['nfc', 'manual'], default: 'nfc' }
});

// Duration in minutes
checkInSchema.virtual('duration').get(function () {
  if (!this.checkedOutAt) return null;
  return Math.round((this.checkedOutAt - this.checkedInAt) / 1000 / 60);
});

module.exports = mongoose.model('CheckIn', checkInSchema);
