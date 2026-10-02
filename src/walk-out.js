'use strict';
// The walk out with rods (note 762). Of 19 lives that carried four or more
// blaze rods in the Nether since 2026-09-29T23:00Z (scripts/rod-stage.js),
// six started back toward a portal and four of those died on the way: lava
// twice (25591 at 7 rods, 04:27:59Z, a shore cell a block over the lava sea
// walked beside it and gone into; 25588 at 5, 11:50:47Z, 35 blocks down off
// a ledge at full health), a fall (25598 at 6, 05:51:55Z, two drops of three
// at 1.7 health, a point each) and a blaze. Of 2255 cells the walks out
// stood on, 66 were within two blocks of the way the bot had come in; every
// death was off it, 10 to 47 blocks from the nearest cell it had stood on
// (scripts/walk-out.js). Nothing kept the way in: the pathfinder's route
// from wherever the bot stood, the legs round, the floor way down to the
// lava sea's level and the crossing straight over the sea were each a fresh
// route.
//
// Here: (1) the way in, kept while the bot is in the Nether: every cell it
// stands on from the portal, loops cut (a cell stood on again cuts the path
// back to it), so what is kept is a path from where it came in to where it
// stands (goal.wayIn, saved with the goal). (2) The way back along it
// (backTrail, walkBack), walked in legs by the pathfinder to cells on it.
// (3) The rods' own physical rules for the pathfinder (movement.js
// rodRefused): while rods are carried no drop of more than two (a drop of
// three cost a point in 25598's record twice), no cell with lava a block to
// a side at the feet or the head, and off the way in no cell with lava a
// block to a side at the floor and none beside a drop into lava or a fall
// that costs half the health; cells beside lava or a drop off the way in
// cost more by the rods carried (ROD_COST).
const { Vec3 } = require('vec3');

// Cells kept at most; past it the older half is thinned to every other cell
// (the legs walk between them).
const WAY_IN_MOST = 2000;
// A leg of the way back: this many cells of it, walked by the pathfinder.
const LEG_CELLS = 12;
// The way back is known from here when a cell of it is this near.
const WAY_NEAR = 8;
// No drop deeper than this while rods are carried: a drop of three cost a
// point each time in 25598's record (1.7 to 0.7 to dead, 05:51:54-55Z).
const ROD_DROP_MAX = 2;
// The cost a cell beside lava or a deadly drop adds off the way in, a rod.
const ROD_COST = 4;

const netherOf = bot => /nether/.test(String(bot?.game?.dimension || ''));
const keyOf = c => `${c.x},${c.y},${c.z}`;
// The feet's cell: on soul sand (its top at .875) the floored feet are the
// soul sand's own cell (note 580).
const feetOf = p => ({ x: Math.floor(p.x), y: Math.ceil(p.y - 1e-4), z: Math.floor(p.z) });

// Rods carried, the powder counted two to a rod (rod-stage.js's count).
function rodsCarried(bot) {
  let rods = 0, powder = 0;
  try { for (const i of bot.inventory?.items?.() || []) { if (i.name === 'blaze_rod') rods += i.count; else if (i.name === 'blaze_powder') powder += i.count; } } catch (_) { return 0; }
  return rods + Math.floor(powder / 2);
}

// The index of a way's cells, kept off the saved record.
function indexOf(trail) {
  if (trail._index) return trail._index;
  const index = new Map();
  (trail.cells || []).forEach((c, i) => index.set(`${c[0]},${c[1]},${c[2]}`, i));
  Object.defineProperty(trail, '_index', { value: index, enumerable: false, configurable: true, writable: true });
  return index;
}
// A cell stood on, added to the way: a cell on it already, or one a step
// from one on it, cuts the way back to it (the loop walked since is not the
// way), so the way stays a path.
function noteCell(trail, c, at = Date.now()) {
  const cells = trail.cells ||= [];
  const last = cells.at(-1);
  if (last && last[0] === c.x && last[1] === c.y && last[2] === c.z) return false;
  const index = indexOf(trail), k = keyOf(c);
  // The cell itself, or one a step from it (a block to a side or corner to
  // corner, a block up or down) stood on earlier than the last few: the way
  // back goes from there.
  let i = index.get(k);
  if (i === undefined) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const j = index.get(`${c.x + dx},${c.y + dy},${c.z + dz}`);
      if (j !== undefined && j < cells.length - 3 && (i === undefined || j < i)) i = j;
    }
    if (i !== undefined) {
      for (let j = i + 1; j < cells.length; j++) index.delete(`${cells[j][0]},${cells[j][1]},${cells[j][2]}`);
      cells.length = i + 1;
      cells.push([c.x, c.y, c.z]); index.set(k, cells.length - 1);
      trail.at = at;
      return true;
    }
  }
  if (i !== undefined) {
    for (let j = i + 1; j < cells.length; j++) index.delete(`${cells[j][0]},${cells[j][1]},${cells[j][2]}`);
    cells.length = i + 1;
    trail.at = at;
    return true;
  }
  cells.push([c.x, c.y, c.z]); index.set(k, cells.length - 1);
  trail.at = at;
  if (cells.length > WAY_IN_MOST) {
    const half = cells.length >> 1;
    trail.cells = [...cells.slice(0, half).filter((_, j) => j % 2 === 0 || j === 0), ...cells.slice(half)];
    delete trail._index;
  }
  return true;
}

// The way in the bot keeps: on the goal (saved), else on the bot.
function wayInOf(bot, goal = bot?._stalls?.goalOf?.()) {
  return goal?.wayIn || bot?._wayIn || null;
}
// Where the bot stands, noted: in the Nether on the ground; anywhere else the
// way is dropped (a way in is from the portal last come through).
function noteWayIn(bot, goal = bot?._stalls?.goalOf?.()) {
  const p = bot?.entity?.position;
  if (!p) return;
  const holder = goal && typeof goal === 'object' ? goal : bot;
  const field = holder === goal ? 'wayIn' : '_wayIn';
  if (!netherOf(bot)) { if (holder[field]) delete holder[field]; return; }
  if (!bot.entity.onGround) return;
  // Carried over from the bot's own keeping when a goal first holds it.
  if (holder === goal && !goal.wayIn && bot._wayIn) goal.wayIn = bot._wayIn;
  const trail = holder[field] ||= { cells: [], since: Date.now() };
  noteCell(trail, feetOf(p));
}
function wayInPlugin(bot) {
  if (bot._wayInWatched) return;
  bot._wayInWatched = true;
  let last = null;
  bot.on?.('move', () => {
    try {
      const p = bot.entity?.position;
      if (!p) return;
      const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)},${bot.entity.onGround}`;
      if (k === last) return;
      last = k;
      noteWayIn(bot);
    } catch (_) { /* a cell missed */ }
  });
}

// Whether a cell (the feet's) is on the way in: stood on before, or its
// floor a block the bot laid itself (its own span).
function onWayIn(bot, c, goal = bot?._stalls?.goalOf?.()) {
  const trail = wayInOf(bot, goal);
  if (trail?.cells?.length && indexOf(trail).has(keyOf(c))) return true;
  try { return !!require('./own-blocks').laidAt(bot, new Vec3(c.x, c.y - 1, c.z), goal); } catch (_) { return false; }
}

// The way back from `here` along the way in: its cells from the nearest to
// `here` back to where it began, how far off that nearest cell is, and
// whether it begins at `portal` (within six blocks). Null where no way is
// kept or none of it is within WAY_NEAR.
function backTrail(trail, here, portal = null) {
  const cells = trail?.cells;
  if (!cells?.length || !here) return null;
  let best = -1, bestD = Infinity;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i], d = Math.hypot(c[0] + 0.5 - here.x, (c[1] - here.y) * 2, c[2] + 0.5 - here.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (bestD > WAY_NEAR) return { cells: [], off: Math.round(bestD) };
  const way = cells.slice(0, best + 1).reverse().map(([x, y, z]) => ({ x, y, z }));
  const start = cells[0];
  return { cells: way, off: Math.round(bestD), reaches: !!portal && Math.hypot(start[0] - portal.x, start[1] - portal.y, start[2] - portal.z) <= 6, start: { x: start[0], y: start[1], z: start[2] } };
}

// The way back's cells beside lava or a drop into it, and the bot's own
// spans on it, read from the world where loaded.
function wayFacts(bot, way) {
  const out = { cells: way.cells.length, lava: 0, edge: 0, spans: 0, blocks: 0 };
  if (typeof bot.blockAt !== 'function') return out;
  const { lavaRound } = require('./movement');
  const nameAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name;
  let prev = null;
  for (const c of way.cells) {
    if (prev) out.blocks += Math.max(Math.abs(c.x - prev.x), Math.abs(c.z - prev.z));
    prev = c;
    try {
      if (lavaRound(nameAt, c).cells.length) out.lava++;
      const drop = require('./terrain').dropNear(bot, new Vec3(c.x, c.y, c.z), 1);
      if (drop && (drop.into === 'lava' || (drop.fallBlocks || 0) >= 4)) out.edge++;
      if (require('./own-blocks').laidAt(bot, new Vec3(c.x, c.y - 1, c.z))) out.spans++;
    } catch (_) { /* not loaded */ }
  }
  return out;
}

// What a death on the walk costs with the rods carried: said on the walk
// out's questions.
function rodsSays(bot) {
  const n = rodsCarried(bot);
  if (!n) return null;
  return `On the walk out with ${n} blaze rod${n === 1 ? '' : 's'}: a fall or a step into lava loses ${n === 1 ? 'it' : 'every one'} (a death drops them where the bot falls, and in lava they burn). ` +
    `While rods are carried the walk takes no drop of more than ${ROD_DROP_MAX}, no cell with lava beside the feet or the head, and off the way in no cell beside a drop into lava or at the lava's edge.`;
}
// The way back said, for portal_way's the_way_in.
// Where a way kept that does not reach the portal ends, against the portal
// (note 942). -> words, or '' where it reaches the portal.
function endSays(way, portal, here) {
  if (way?.reaches || !way?.start || !portal || !here) return '';
  const endOff = Math.round(Math.hypot(way.start.x - portal.x, way.start.z - portal.z)), nowOff = Math.round(Math.hypot(here.x - portal.x, here.z - portal.z));
  return endOff >= nowOff ? ` Where it ends is ${endOff} blocks from the portal, against ${nowOff} from here: the walk goes away from the portal, and the rest of the way home is asked from there.` : ` Where it ends is ${endOff} blocks from the portal, against ${nowOff} from here.`;
}
function wayBackSays(bot, way, facts) {
  const where = way.reaches ? 'to the portal it came in by' : `to where the way kept begins, (${way.start.x}, ${way.start.y}, ${way.start.z})`;
  return `Back the way it came in: ${facts.cells} cells it stood on before${facts.spans ? `, ${facts.spans} of them on its own laid blocks` : ''}, from the nearest, ${way.off} block${way.off === 1 ? '' : 's'} off, ${where}, about ${facts.blocks} blocks, walked by the pathfinder in legs of ${LEG_CELLS} cells along them. ` +
    `${facts.lava || facts.edge ? `${facts.lava} of them have lava round them and ${facts.edge} are beside a drop into lava or of four or more; walked before, crouched on the edges.` : 'None of them is beside lava or a drop.'}`;
}

// The way back walked: legs of LEG_CELLS cells, each to a cell on the way by
// the pathfinder (the rods' rules on, the way's own cells allowed at the
// edge). Returns { tried, ok, reached, why, walked }.
async function walkBack(bot, task, goal, portal, navigate) {
  const trail = wayInOf(bot, goal), here = bot.entity.position;
  const way = backTrail(trail, here, portal);
  if (!way?.cells.length) return { tried: false, off: way?.off ?? null };
  const { goals } = require('mineflayer-pathfinder');
  let i = 0, walked = 0;
  while (i < way.cells.length - 1) {
    task.check();
    const j = Math.min(way.cells.length - 1, i + LEG_CELLS), c = way.cells[j];
    try { await navigate(bot, task, new goals.GoalNear(c.x, c.y, c.z, 1), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      return { tried: true, ok: false, walked, at: way.cells[i], why: String(err.message || err).slice(0, 160) };
    }
    walked += j - i;
    // On from the way's cell nearest where the body stands (a leg may have
    // cut a corner of it).
    const at = bot.entity.position;
    let k = j, d = Infinity;
    for (let m = i; m < way.cells.length; m++) { const w = way.cells[m], e = Math.hypot(w.x - at.x, w.y - at.y, w.z - at.z); if (e < d) { d = e; k = m; } }
    i = Math.max(j, k);
  }
  return { tried: true, ok: true, walked, reached: way.reaches };
}

module.exports = { endSays, rodsCarried, noteCell, noteWayIn, wayInPlugin, wayInOf, onWayIn, backTrail, wayFacts, rodsSays, wayBackSays, walkBack, feetOf, ROD_DROP_MAX, ROD_COST, LEG_CELLS, WAY_NEAR, WAY_IN_MOST };
