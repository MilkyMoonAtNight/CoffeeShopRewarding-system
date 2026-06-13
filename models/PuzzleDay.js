const mongoose = require('mongoose');

// The active puzzle for a given date. One doc per day that has been opened.
// `word` is chosen from the pool of words not yet used (or recycled if a day
// went unsolved). solvedBy tracks who got it, so we know whether to recycle.
const puzzleDaySchema = new mongoose.Schema({
  date:       { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
  word:       { type: String, required: true },                            // upper-case answer
  difficulty: { type: String, enum: ['easy','medium','hard'], default: 'easy' },
  hint:       { type: String, default: '' },
  recycled:   { type: Boolean, default: false },  // true if this word came back from the pool
  solvedBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('PuzzleDay', puzzleDaySchema);
