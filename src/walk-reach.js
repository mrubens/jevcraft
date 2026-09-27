'use strict';
// Which of the mobs about that walk have no way to the bot: mid-205-v stood
// on a one-wide column five blocks above a cave floor, three zombies, four
// creepers and a zombie villager held at four to five blocks below it for a
// minute, and a skeleton shot it from sixteen health to none. Every stance
// priced the walkers as at the bot in a second (take_cover "about 144
// damage"), and Jev answered "none of these" at each question (note 525).
//
// A zombie hits what its body, widened by about eight tenths of a block
// sideways and not at all up, touches: from the ground two below a
// player's feet it touches nothing. A creeper lights within three blocks.
// So a walker gets to the bot only by walking, stepping up a block or
// dropping onto ground from which it touches the bot. The ground that leads
// there is searched back from those cells (a mob drops any depth with a
// target, steps up one); a walker whose cell it never reaches, when the
// search closed inside its bounds, cannot get to the bot from where it is.
// Searched as a mob might go, not as it would: diagonals, water and gaps a
// short mob fits are all allowed, so an unsure answer is "it reaches".
const { Vec3 } = require('vec3');
const { shooter } = require('./mob-policy');

// Mobs that only walk, climb nothing, fly nowhere and jump no higher than a
// block. Spiders climb, endermen teleport, cubes and drowned swim or leap
// up, ghasts and phantoms fly: none of those is judged here.
const WALKERS = new Set(['zombie', 'husk', 'zombie_villager', 'zombified_piglin', 'piglin', 'piglin_brute', 'hoglin', 'zoglin',
  'creeper', 'vindicator', 'silverfish', 'endermite', 'polar_bear', 'wolf']);
// Its body's reach sideways from the bot's centre (half a width each and
// the eight tenths between), and how far below the bot's feet a walker's
// feet can be and still touch it (a zombie is 1.95 high; a slab or a path
// block lifts a floor half a block).
const SIDEWAYS = 1.6, BELOW = 2.5, ABOVE = 1, LIGHTS = 3.5;
const RADIUS = 12, DEPTH = 12, CAP = 5000;
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function walkersApart(bot, danger, { radius = RADIUS, cap = CAP } = {}) {
  const none = { ids: new Set(), mobs: [] };
  const walkers = danger.filter(t => t.entity?.position && WALKERS.has(t.entity.name) && !shooter(t.entity) && !t.entity.vehicle);
  if (!walkers.length || typeof bot.blockAt !== 'function') return none;
  const here = bot.entity.position, feet = here.floored();
  const key = c => `${c.x},${c.y},${c.z}`;
  const cache = new Map();
  let unknown = false;
  const block = c => { const k = key(c); if (!cache.has(k)) cache.set(k, bot.blockAt(c) || null); const b = cache.get(k); if (!b) unknown = true; return b; };
  const water = b => !!b && /water|bubble_column|kelp|seagrass/.test(b.name);
  const open = c => { const b = block(c); return !!b && b.boundingBox === 'empty' && !/lava/.test(b.name); };
  const standable = c => open(c) && (block(c.offset(0, -1, 0))?.boundingBox === 'block' || water(block(c)));
  const inside = c => Math.abs(c.x - feet.x) <= radius && Math.abs(c.z - feet.z) <= radius && Math.abs(c.y - feet.y) <= DEPTH;
  // Where a walker touches the bot, or a creeper lights beside it.
  const seen = new Set(), queue = [];
  const add = c => { const k = key(c); if (seen.has(k)) return; seen.add(k); queue.push(c); };
  const lo = Math.ceil(here.y - BELOW), reachX = Math.ceil(LIGHTS);
  for (let dx = -reachX; dx <= reachX; dx++) for (let dz = -reachX; dz <= reachX; dz++) for (let y = feet.y - reachX; y <= feet.y + reachX; y++) {
    const c = new Vec3(feet.x + dx, y, feet.z + dz);
    const touches = Math.abs(c.x + 0.5 - here.x) <= SIDEWAYS && Math.abs(c.z + 0.5 - here.z) <= SIDEWAYS && y >= lo && y <= here.y + ABOVE;
    const lights = Math.hypot(c.x + 0.5 - here.x, y - here.y, c.z + 0.5 - here.z) < LIGHTS;
    if ((touches || lights) && standable(c)) add(c);
  }
  // Back from there: the cells a mob could come from in one move.
  const cellsOf = t => { const p = t.entity.position.floored(); return [p, p.offset(0, 1, 0), p.offset(0, -1, 0)].filter(standable); };
  const pending = new Map(walkers.map(t => [t.entity.id, cellsOf(t).map(key)]));
  const found = () => [...pending.values()].every(cells => cells.some(k => seen.has(k)));
  for (let i = 0; i < queue.length; i++) {
    if (i >= cap || unknown) return none;
    if (i % 32 === 0 && found()) return none;
    const b = queue[i];
    for (const [dx, dz] of AROUND) {
      // Stepped up from a block lower, or walked or dropped from level and
      // above, falling down the column over b.
      const from = [b.offset(dx, -1, dz)];
      for (let dy = 0; dy <= DEPTH && open(b.offset(0, dy, 0)); dy++) from.push(b.offset(dx, dy, dz));
      for (const a of from) {
        if (seen.has(key(a)) || !standable(a)) continue;
        // Out of bounds nothing is said: done looking.
        if (!inside(a)) return none;
        add(a);
      }
    }
    // Swum up a water column.
    const under = b.offset(0, -1, 0);
    if (water(block(under)) && !seen.has(key(under))) add(under);
  }
  // A chunk not loaded: the walkers are not said to be kept off.
  if (unknown) return none;
  const mobs = walkers.filter(t => { const cells = pending.get(t.entity.id); return cells.length && !cells.some(k => seen.has(k)); });
  return { ids: new Set(mobs.map(t => t.entity.id)), mobs, radius };
}

// Said with every stance while it holds.
function apartSays(bot, apart) {
  if (!apart.mobs.length) return '';
  const names = [...new Set(apart.mobs.map(t => t.entity.name))];
  const list = names.map(n => { const k = apart.mobs.filter(t => t.entity.name === n).length; return k > 1 ? `${k} ${n.replaceAll('_', ' ')}s` : `the ${n.replaceAll('_', ' ')}`; });
  const who = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const drops = apart.mobs.map(t => bot.entity.position.y - t.entity.position.y);
  const lowest = Math.round(Math.min(...drops)), highest = Math.round(Math.max(...drops));
  const where = lowest >= 2 ? `, ${lowest === highest ? lowest : `${lowest} to ${highest}`} blocks below the bot's feet,` : '';
  return ` ${who[0].toUpperCase()}${who.slice(1)}${where} ${apart.mobs.length === 1 ? 'has' : 'have'} no way to the bot: no ground ${apart.mobs.length === 1 ? 'it' : 'they'} can walk, step up or drop along within ${apart.radius} blocks comes within a walker's reach of it${names.includes('creeper') ? ', or within three blocks, where a creeper lights' : ''}. ${apart.mobs.length === 1 ? 'It is' : 'They are'} left out of the figures here while that holds; a block placed or dug, or the bot moving, can open a way.`;
}

module.exports = { walkersApart, apartSays, WALKERS };
