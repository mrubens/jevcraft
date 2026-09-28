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
  'creeper', 'vindicator', 'silverfish', 'endermite', 'polar_bear', 'wolf',
  // A wither skeleton only walks too, and stands 2.4 high: it touches the
  // bot from further below (BELOW is read from the tallest here). Left out,
  // one round a fortress corner was never judged, so never kept off either
  // (note 559).
  'wither_skeleton']);
// Its body's reach sideways from the bot's centre (half a width each and
// the eight tenths between), and how far below the bot's feet a walker's
// feet can be and still touch it (a zombie is 1.95 high; a slab or a path
// block lifts a floor half a block).
const SIDEWAYS = 1.6, BELOW = 2.5, ABOVE = 1, LIGHTS = 3.5;
const RADIUS = 12, DEPTH = 12, CAP = 5000;
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// `at`, where the bot would stand instead of where it stands: the firm
// ground a stance steps to, judged for the same walkers (note 566).
function walkersApart(bot, danger, { radius = RADIUS, cap = CAP, at = null } = {}) {
  const none = { ids: new Set(), mobs: [], round: [] };
  const walkers = danger.filter(t => t.entity?.position && WALKERS.has(t.entity.name) && !shooter(t.entity) && !t.entity.vehicle);
  if (!walkers.length || typeof bot.blockAt !== 'function') return none;
  const here = at || bot.entity.position, feet = here.floored();
  const key = c => `${c.x},${c.y},${c.z}`;
  const cache = new Map();
  let unknown = false, outside = false;
  const block = c => { const k = key(c); if (!cache.has(k)) cache.set(k, bot.blockAt(c) || null); const b = cache.get(k); if (!b) unknown = true; return b; };
  const water = b => !!b && /water|bubble_column|kelp|seagrass/.test(b.name);
  const open = c => { const b = block(c); return !!b && b.boundingBox === 'empty' && !/lava/.test(b.name); };
  const standable = c => open(c) && (block(c.offset(0, -1, 0))?.boundingBox === 'block' || water(block(c)));
  const inside = c => Math.abs(c.x - feet.x) <= radius && Math.abs(c.z - feet.z) <= radius && Math.abs(c.y - feet.y) <= DEPTH;
  // Where a walker touches the bot, or a creeper lights beside it.
  const seen = new Set(), queue = [];
  const add = c => { const k = key(c); if (seen.has(k)) return; seen.add(k); queue.push(c); };
  // A blow reaches as high as the mob stands (combat-estimate BODY_HEIGHT):
  // the tallest walker here sets how far below the feet it touches from.
  const { bodyHeight } = require('./combat-estimate');
  const below = Math.max(BELOW, ...walkers.map(t => bodyHeight(t.entity.name) + BELOW - bodyHeight('zombie')));
  const lo = Math.ceil(here.y - below), reachX = Math.ceil(LIGHTS);
  // A spear's blow reaches 2.25 past the mob's box sideways, not the eight
  // tenths of an arm (danger.js atItsReach, the 26.1.2 jar): one here
  // touches the bot from further off, and every walker is judged by the
  // longest reach among them, as the tallest sets how far below (unsure is
  // "it reaches"). mid-242-ae's spear piglin came up a two-block rise and
  // speared the bot from 1.3 blocks across and 1.6 below (note 586).
  const { holdsSpear, SPEAR_MOB_REACH } = require('./danger');
  const sideways = walkers.some(t => holdsSpear(t.entity)) ? Math.max(SIDEWAYS, 0.6 + SPEAR_MOB_REACH) : SIDEWAYS;
  for (let dx = -reachX; dx <= reachX; dx++) for (let dz = -reachX; dz <= reachX; dz++) for (let y = feet.y - reachX; y <= feet.y + reachX; y++) {
    const c = new Vec3(feet.x + dx, y, feet.z + dz);
    const touches = Math.abs(c.x + 0.5 - here.x) <= sideways && Math.abs(c.z + 0.5 - here.z) <= sideways && y >= lo && y <= here.y + ABOVE;
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
        // Out of bounds the search goes no further, and what it did not
        // reach inside them has no way there within them: any way goes
        // round, farther than the bounds. It gave up here and said nothing,
        // and mid-244-ad-nether-2's pillar on its own bridge, a sword
        // piglin on the slope six blocks off and two below, was priced as
        // at the bot in a second for minutes (note 560).
        if (!inside(a)) { outside = true; continue; }
        add(a);
      }
    }
    // Swum up a water column.
    const under = b.offset(0, -1, 0);
    if (water(block(under)) && !seen.has(key(under))) add(under);
  }
  // A chunk not loaded: the walkers are not said to be kept off.
  if (unknown) return none;
  const kept = walkers.filter(t => { const cells = pending.get(t.entity.id); return cells.length && !cells.some(k => seen.has(k)); });
  if (!outside) return { ids: new Set(kept.map(t => t.entity.id)), mobs: kept, radius, round: [] };
  // The search left its bounds: a walker inside them that it did not reach
  // has no way to the bot within them, and any way it has goes out past
  // them and back, said with the least walk that could be. It cannot get to
  // the bot on that walk before it is inside the bounds again on ground the
  // search reaches, so it is apart as the sure ones are (in ids, out of the
  // figures, not a threat) while that holds; the search is made again at
  // every look (note 566). A walker outside the bounds is not judged: the
  // search never came near it, and its way may be straight (a zombie
  // fourteen blocks off on open ground was said to have none).
  const cheb = p => Math.max(Math.abs(Math.floor(p.x) - feet.x), Math.abs(Math.floor(p.z) - feet.z));
  const within = kept.filter(t => inside(t.entity.position.floored()));
  const round = within.map(t => ({ t, atLeast: Math.max(0, radius + 1 - cheb(t.entity.position)) + Math.max(0, radius - Math.ceil(SIDEWAYS)) }));
  return { ids: new Set(within.map(t => t.entity.id)), mobs: [], radius, round };
}

// A walker said by what it carries: a piglin with a crossbow shoots (and is
// no walker here), one with a sword hits at arm's length only.
function heldSays(t) {
  const held = t.entity?.heldItem?.name;
  if (!held || !/piglin/.test(t.entity.name)) return '';
  // A spear is not an arm's length: it lands from about 2.8 blocks ahead
  // and 4 on the diagonal (danger.js atItsReach, note 586).
  return ` (holding ${held.replaceAll('_', ' ')}${held === 'crossbow' ? '' : /_spear$/.test(held) ? ', no crossbow: its spear lands from about 2.8 blocks straight ahead and 4 on the diagonal, and it runs in with it from up to ten blocks' : ', no crossbow: it hits at arm\'s length only'})`;
}

// Said with every stance while it holds.
function apartSays(bot, apart) {
  const round = roundSays(bot, apart);
  if (!apart.mobs.length) return round;
  const names = [...new Set(apart.mobs.map(t => t.entity.name))];
  const list = names.map(n => { const of = apart.mobs.filter(t => t.entity.name === n); return of.length > 1 ? `${of.length} ${n.replaceAll('_', ' ')}s` : `the ${n.replaceAll('_', ' ')}${heldSays(of[0])}`; });
  const who = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  const drops = apart.mobs.map(t => bot.entity.position.y - t.entity.position.y);
  const lowest = Math.round(Math.min(...drops)), highest = Math.round(Math.max(...drops));
  const where = lowest >= 2 ? `, ${lowest === highest ? lowest : `${lowest} to ${highest}`} blocks below the bot's feet,` : '';
  return ` ${who[0].toUpperCase()}${who.slice(1)}${where} ${apart.mobs.length === 1 ? 'has' : 'have'} no way to the bot: no ground ${apart.mobs.length === 1 ? 'it' : 'they'} can walk, step up or drop along within ${apart.radius} blocks comes within a walker's reach of it${names.includes('creeper') ? ', or within three blocks, where a creeper lights' : ''}. ${apart.mobs.length === 1 ? 'It is' : 'They are'} left out of the figures here while that holds; a block placed or dug, or the bot moving, can open a way.${round}`;
}
// The walkers whose only way, if any, goes round past the bounds.
function roundSays(bot, apart) {
  if (!apart.round?.length) return '';
  return apart.round.map(({ t, atLeast }) => {
    const d = Math.round(t.entity.position.distanceTo(bot.entity.position) * 10) / 10, below = Math.round(bot.entity.position.y - t.entity.position.y);
    return ` The ${t.entity.name.replaceAll('_', ' ')} ${d} blocks off${below >= 2 ? `, ${below} below the bot's feet,` : ''}${heldSays(t)} has no way to the bot within ${apart.radius} blocks of it: any way it has goes round, ${atLeast} blocks of walking or more, if there is one at all. It is left out of the figures here while that holds.`;
  }).join('');
}

module.exports = { walkersApart, apartSays, roundSays, heldSays, WALKERS };
