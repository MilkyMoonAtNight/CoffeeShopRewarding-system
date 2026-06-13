const mongoose = require('mongoose');

// One attempt doc per admin per day. Stores their guesses (max 5),
// whether they solved it, and the XP awarded.
const puzzleAttemptSchema = new mongoose.Schema({
  date:      { type: String, required: true, index: true },   // YYYY-MM-DD
  adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  adminName: { type: String, default: '' },
  guesses:   [{ type: String }],          // each a 5-letter upper-case guess
  solved:    { type: Boolean, default: false },
  finished:  { type: Boolean, default: false },  // solved OR used all 5 guesses
  xpAwarded: { type: Number, default: 0 },
  solvedAt:  { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

puzzleAttemptSchema.index({ date: 1, adminId: 1 }, { unique: true });

module.exports = mongoose.model('PuzzleAttempt', puzzleAttemptSchema);
