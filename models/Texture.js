const mongoose = require('mongoose');

// A "texture" is a reusable drink-layer look: a base tint, optionally with a
// scatter of small dots (e.g. Milk = cream with grey dots). Drinks reference
// textures by slug, so recolouring a texture updates every drink automatically.
const textureSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  slug:       { type: String, required: true, unique: true, trim: true },
  baseColor:  { type: String, required: true, default: '#C4845C' }, // hex tint
  dots:       { type: Boolean, default: false },                    // overlay small dots
  dotColor:   { type: String, default: '#9a9a9a' },
  dotDensity: { type: Number, default: 5, min: 1, max: 10 },        // 1 sparse … 10 busy
  order:      { type: Number, default: 0 },
  createdAt:  { type: Date, default: Date.now }
});

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
textureSchema.statics.slugify = slugify;

const Texture = mongoose.model('Texture', textureSchema);

// Seed the four defaults Iwan asked for, only when the collection is empty.
async function ensureDefaultTextures() {
  const count = await Texture.countDocuments();
  if (count > 0) return;
  await Texture.create([
    { name: 'Espresso',   slug: 'espresso',   baseColor: '#3D1A0E', dots: false, order: 1 },
    { name: 'Water',      slug: 'water',      baseColor: '#3A78C4', dots: false, order: 2 },
    { name: 'Milk',       slug: 'milk',       baseColor: '#F3EBD8', dots: true, dotColor: '#9a9a9a', dotDensity: 4, order: 3 },
    { name: 'Milk Cream', slug: 'milk-cream', baseColor: '#F7EEC4', dots: false, order: 4 },
  ]);
}

module.exports = Texture;
module.exports.ensureDefaultTextures = ensureDefaultTextures;
