// One-off: give existing drinks a sensible texture stack so the panels aren't
// all neutral. Idempotent — skips any drink that already has layers.
// Run: node scripts/seedDrinkLayers.js
const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const mongoose = require('mongoose');
const Drink = require('../models/Drink');
const { ensureDefaultTextures } = require('../models/Texture');

// Layers run TOP → BOTTOM (top of the cup first). Slugs must match textures.
function layersFor(drink) {
  const n = (drink.name || '').toLowerCase();
  const sub = drink.subcategory || '';
  const cold = drink.category === 'cold';

  if (n.includes('americano'))                       return [{ textureSlug: 'water', pct: 72 }, { textureSlug: 'espresso', pct: 28 }];
  if (n.includes('red cappuccino'))                  return [{ textureSlug: 'milk-cream', pct: 12 }, { textureSlug: 'milk', pct: 45 }, { textureSlug: 'espresso', pct: 43 }];
  if (n.includes('cappuccino'))                      return [{ textureSlug: 'milk-cream', pct: 30 }, { textureSlug: 'milk', pct: 35 }, { textureSlug: 'espresso', pct: 35 }];
  if (n.includes('flat white'))                      return [{ textureSlug: 'milk-cream', pct: 10 }, { textureSlug: 'milk', pct: 60 }, { textureSlug: 'espresso', pct: 30 }];
  if (n.includes('cortado'))                         return [{ textureSlug: 'milk', pct: 50 }, { textureSlug: 'espresso', pct: 50 }];
  if (n.includes('macchiato'))                       return [{ textureSlug: 'milk', pct: 20 }, { textureSlug: 'espresso', pct: 80 }];
  if (n.includes('hot choc') || sub === 'chocolate') return [{ textureSlug: 'milk', pct: 30 }, { textureSlug: 'espresso', pct: 70 }];
  if (n.includes('matcha') || n.includes('chai') || sub === 'tea')
                                                     return [{ textureSlug: 'milk-cream', pct: 20 }, { textureSlug: 'milk', pct: 55 }, { textureSlug: 'water', pct: 25 }];
  if (n.includes('latte') && !cold)                  return [{ textureSlug: 'milk-cream', pct: 15 }, { textureSlug: 'milk', pct: 70 }, { textureSlug: 'espresso', pct: 15 }];
  if (sub === 'espresso' && !cold)                   return [{ textureSlug: 'milk-cream', pct: 8 }, { textureSlug: 'espresso', pct: 92 }];
  if (cold)                                          return [{ textureSlug: 'water', pct: 30 }, { textureSlug: 'milk', pct: 45 }, { textureSlug: 'espresso', pct: 25 }];
  return [{ textureSlug: 'milk-cream', pct: 15 }, { textureSlug: 'milk', pct: 60 }, { textureSlug: 'espresso', pct: 25 }];
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await ensureDefaultTextures();
  const drinks = await Drink.find();
  let updated = 0;
  for (const d of drinks) {
    if (d.layers && d.layers.length) continue; // already configured — leave it
    d.layers = layersFor(d);
    await d.save();
    updated++;
    console.log('  + ' + d.name + ' → ' + d.layers.map(l => l.textureSlug + ' ' + l.pct + '%').join(' / '));
  }
  console.log('\n✓ Assigned layers to ' + updated + ' drink(s); skipped ' + (drinks.length - updated) + ' already configured.');
  await mongoose.disconnect();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
