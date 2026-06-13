const fs = require('fs');
const path = require('path');

// Loads and caches the word pool from data/puzzle-words.txt.
// Re-reads on each server start (cache persists for the process lifetime).
let POOL = null;

function loadPool() {
  if (POOL) return POOL;
  POOL = [];
  try {
    const file = path.join(__dirname, '..', 'data', 'puzzle-words.txt');
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [word, difficulty = 'easy', ...hintParts] = line.split(',');
      const w = (word || '').trim().toUpperCase();
      if (w.length !== 5 || !/^[A-Z]+$/.test(w)) continue;
      const diff = ['easy', 'medium', 'hard'].includes((difficulty || '').trim())
        ? difficulty.trim() : 'easy';
      POOL.push({ word: w, difficulty: diff, hint: hintParts.join(',').trim() });
    }
  } catch (err) {
    console.error('Could not load puzzle word pool:', err.message);
  }
  return POOL;
}

const XP_BY_DIFFICULTY = { easy: 15, medium: 30, hard: 50 };

function xpForDifficulty(d) {
  return XP_BY_DIFFICULTY[d] || 15;
}

// Pick a word for `dateStr` that hasn't been used yet. Words from days that
// went unsolved are eligible again (their PuzzleDay is marked recycled and we
// simply don't exclude them). Falls back to any word if every word is used.
async function pickWordForDay(dateStr, PuzzleDay) {
  const pool = loadPool();
  if (pool.length === 0) return null;

  // Words used on days that WERE solved are off the table.
  const solvedDays = await PuzzleDay.find({ 'solvedBy.0': { $exists: true } }).select('word').lean();
  const usedSolved = new Set(solvedDays.map(d => d.word));

  // Words currently assigned to an unsolved past day get recycled (reused).
  let candidates = pool.filter(p => !usedSolved.has(p.word));
  if (candidates.length === 0) candidates = pool; // everything solved — reuse all

  // Avoid repeating a word already assigned to another *open* day if possible
  const assignedToday = await PuzzleDay.find({ date: { $ne: dateStr } }).select('word').lean();
  const assignedSet = new Set(assignedToday.map(d => d.word));
  const fresh = candidates.filter(p => !assignedSet.has(p.word));
  const finalPool = fresh.length ? fresh : candidates;

  const choice = finalPool[Math.floor(Math.random() * finalPool.length)];
  const wasRecycled = assignedSet.has(choice.word);
  return { ...choice, recycled: wasRecycled };
}

module.exports = { loadPool, xpForDifficulty, pickWordForDay, XP_BY_DIFFICULTY };
