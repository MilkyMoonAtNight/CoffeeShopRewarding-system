const mongoose = require('mongoose');

// One document per shift. The lifecycle is:
//   clock_in → (lunch_out → lunch_in)? → clock_out
// totalMinutes / lunchMinutes are computed and frozen at clock-out.
const timeClockSchema = new mongoose.Schema({
  adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  adminName: { type: String, default: '' },
  clockIn:   { type: Date, required: true },
  lunchOut:  { type: Date, default: null },
  lunchIn:   { type: Date, default: null },
  clockOut:  { type: Date, default: null },
  lunchMinutes: { type: Number, default: 0 },
  totalMinutes: { type: Number, default: 0 },   // worked time = (out - in) - lunch
  method:    { type: String, enum: ['code', 'nfc'], default: 'code' },
  createdAt: { type: Date, default: Date.now }
});

timeClockSchema.index({ adminId: 1, clockIn: -1 });

// Current state of this shift
timeClockSchema.methods.state = function () {
  if (this.clockOut) return 'done';
  if (this.lunchOut && !this.lunchIn) return 'on_lunch';
  return 'working';
};

module.exports = mongoose.model('TimeClock', timeClockSchema);
