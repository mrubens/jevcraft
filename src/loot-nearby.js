'use strict';
// The drops lying in view, offered to Jev with what they are, how far and the seconds to them (note 2296). Only the
// blaze and bunker fights took their kills' drops; full-9 (2026-10-27 15:5xZ) killed a spider and walked on past its
// string, the user watching: 'Jev just walked right by some string from killing a spider and didn't pick it up. These
// are the parts that feel robotic/suboptimal', then 'why not ask jev? It's fast. In general I don't like the hardcoded
// rules'. No list of what is worth it and no distance under which it is taken unasked: Jev weighs each.
const SCAN = 16, WALK = 4.3;

// The stacks lying within the loaded scan, nearest first. -> [{ name, count, distance }]
function lyingNear(bot, { radius = SCAN } = {}) {
  const here = bot.entity?.position;
  if (!here) return [];
  return Object.values(bot.entities || {}).map(e => {
    let it = null; try { it = e?.position && e.isValid !== false ? e.getDroppedItem?.() : null; } catch (_) { it = null; }
    return it && e.position.distanceTo(here) <= radius ? { name: it.name, count: it.count || 1, distance: Math.round(e.position.distanceTo(here) * 10) / 10, at: e.position } : null;
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
}

// The option for the upkeep question, or null with nothing lying in view.
function lootOption(bot) {
  const lying = lyingNear(bot);
  if (!lying.length) return null;
  const words = n => n.replaceAll('_', ' ');
  const byName = new Map();
  for (const l of lying) { const k = byName.get(l.name); if (k) { k.count += l.count; k.far = Math.max(k.far, l.distance); } else byName.set(l.name, { name: l.name, count: l.count, near: l.distance, far: l.distance }); }
  const list = [...byName.values()].slice(0, 10).map(k => `${k.count} ${words(k.name)} ${k.near === k.far ? `${k.near}` : `${k.near} to ${k.far}`} blocks off`).join('; ');
  const farthest = Math.max(...lying.slice(0, 10).map(l => l.distance));
  const seconds = Math.max(2, Math.round(farthest * 2 / WALK + lying.length * 0.3));
  let mobs = [];
  try { mobs = (require('./danger').hostileEntities(bot, SCAN) || []).map(e => `a ${words(e.name)} ${Math.round(e.position.distanceTo(bot.entity.position))} blocks off`).slice(0, 4); } catch (_) { mobs = []; }
  return {
    description: `Pick up what is lying here: ${list}. About ${seconds} seconds there and back. ${mobs.length ? `Hostile about: ${mobs.join(', ')}.` : 'Nothing hostile in view.'}`,
    run: async (b, t) => {
      const { collectNearbyDrops } = require('./drop-collection');
      const took = [];
      for (const name of byName.keys()) {
        t?.check?.();
        try { if (await collectNearbyDrops(b, t, name, { radius: SCAN, timeoutMs: 6000 })) took.push(name); }
        catch (err) { if (['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
      }
      console.log(`[loot] picked up ${took.length ? took.map(words).join(', ') : 'nothing'} of what lay in view`);
      return took.length > 0;
    },
  };
}

module.exports = { lootOption, lyingNear };
