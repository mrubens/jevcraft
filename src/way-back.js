'use strict';
// Back the way it came (note 793). Of the 66 Overworld deaths on fresh
// trials from 2026-09-30T08:40Z to the Jev-down at 2026-10-01T04:57:47Z
// (`node scripts/fatal-spans.js`), 47 had an encounter_stance question in
// their last minute whose retreat said "No way found yet" or "No way out":
// the scout before the question (survival.js scoutRetreat) tries footing
// spots further from every mob, each a fresh pathfinder search of up to
// 150 ms, in 300 ms (two of twelve), and the cells the bot had just walked
// on were never one of them. In 33 of those 47 deaths, at 83 of the 179
// such questions, the bot's own last three minutes of footing led back,
// passing no mob, to a cell six blocks or more off and four or more
// further from every mob than where it stood; the bot stood and was told
// only the ways that stand (a shield guard, a pillar, cover, a pocket),
// each priced past its health, and held one until it died.
//
// Here: (1) the cells the bot has stood on in the last TRAIL_MS, in every
// dimension, loops cut (a cell stood on again cuts the way back to it), kept
// off the saved record; (2) the way back along them from where it stands:
// cell by cell from the newest, a step at most WALK_GAP blocks to the side,
// no step up of more than one (a drop come down is not walked back up), no
// fall of more than FALL_MOST, each cell passing every mob about by as much
// as the retreat's own route must (survival.js wayAway: within min(4, its
// distance now less one) is past it), to the first cell MIN_BLOCKS or more
// off that is GAIN or more further from every mob than here and still
// standable; (3) said as the retreat's way, and walked along those cells.
// It is a fact of the place (cells walked, mobs where they are now), not a
// threshold: the retreat's own gain and route rule, on footing the bot has
// already stood on.
const TRAIL_MS = 180000;
const TRAIL_MOST = 600;
const GAIN = 4, MIN_BLOCKS = 6;
const WALK_GAP = 2.5, FALL_MOST = 3, COARSE_GAP = 7;
// A run's leg along the way: this many cells, walked by the pathfinder.
const LEG_CELLS = 4;

const r1 = n => Math.round(n * 10) / 10;
// How near the way may come to a mob `d` blocks off now: the retreat's own
// route rule (survival.js wayAway: within min(4, d less one) is running
// through it), and never nearer than it is now to one already within a
// block and a half (the zombie at arm's length is not walked through).
const passing = d => Math.min(4, Math.max(d - 1, Math.min(d, 1.5)));
const feetOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y + 1e-4), z: Math.floor(p.z) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const centre = c => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 });

// A cell stood on, added: the same cell as the last adds nothing; one stood
// on earlier cuts the trail back to it (the loop walked since is not the
// way); a jump of more than WALK_GAP from the last (a respawn, a teleport,
// a portal) starts it over. Cells older than TRAIL_MS go.
function noteCell(trail, c, at = Date.now()) {
  const cells = trail.cells ||= [];
  const last = cells.at(-1);
  if (last && last.x === c.x && last.y === c.y && last.z === c.z) { last.at = at; return false; }
  if (last && (Math.hypot(last.x - c.x, last.z - c.z) > 8 || Math.abs(last.y - c.y) > 8)) cells.length = 0;
  const i = cells.findIndex(k => k.x === c.x && k.y === c.y && k.z === c.z);
  if (i >= 0) { cells.length = i + 1; cells[i].at = at; return true; }
  cells.push({ x: c.x, y: c.y, z: c.z, at });
  while (cells.length && (at - cells[0].at > TRAIL_MS || cells.length > TRAIL_MOST)) cells.shift();
  return true;
}

// The way back from `here` along `trail` past `mobs` ([{ name, x, y, z }]):
// { cells (newest first, ending at `end`), end, blocks, gain, secondsAgo,
// nearest: { name, blocks } } or null, with `why` on the null's object
// form when asked (`explain`). `standable(cell)` reads the world (true
// where it is not loaded or not asked); `lavaBeside(cell)` likewise.
// `coarse`: a trail sampled sparsely (the flight record's frames, about one
// a second, scripts/fatal-spans.js): a step up to COARSE_GAP to the side, a
// rise of a block a block along (the stair it came down), a fall no more
// than three or the blocks along, and the mob rule read along each step.
function find(trail, here, mobs, { now = Date.now(), gain = GAIN, minBlocks = MIN_BLOCKS, standable = () => true, lavaBeside = () => false, explain = false, coarse = false } = {}) {
  const cells = (trail?.cells || []).filter(c => now - c.at <= TRAIL_MS);
  const none = why => explain ? { none: true, why } : null;
  if (!here || cells.length < 2) return none('no trail');
  const about = (mobs || []).filter(m => Number.isFinite(m?.x));
  if (!about.length) return none('no mob');
  const nearestTo = p => Math.min(...about.map(m => dist(m, p)));
  const nowNearest = nearestTo(here);
  // From the newest cell within a step of where the bot stands.
  let k = cells.length - 1;
  while (k >= 0 && dist(centre(cells[k]), here) > WALK_GAP + 1) k--;
  if (k < 0) return none('the trail does not reach where the bot stands');
  const way = [];
  let prev = { x: here.x, y: Math.floor(here.y + 1e-4), z: here.z }, blocks = 0;
  for (let i = k; i >= 0; i--) {
    const c = cells[i], cc = centre(c);
    const side = Math.hypot(cc.x - prev.x, cc.z - prev.z), rise = c.y - Math.floor(prev.y);
    const gapMost = coarse ? COARSE_GAP : WALK_GAP, riseMost = coarse ? Math.max(1, Math.floor(side)) : 1, fallMost = coarse ? Math.max(FALL_MOST, Math.floor(side)) : FALL_MOST;
    if (way.length && (side > gapMost || rise > riseMost || -rise > fallMost)) return none(rise > riseMost ? 'the way came down a drop it cannot walk back up' : 'the trail is not a walk from there');
    // Straight up or down in one column: a pillar it stood up on (the
    // blocks are under it now) or a shaft it dug down (no stair to climb).
    if (side < 0.5 && rise !== 0) return none(rise > 0 ? 'the way came down a shaft it dug' : 'the way went up a pillar of its own');
    const steps = Math.max(1, Math.ceil(Math.hypot(cc.x - prev.x, cc.y - prev.y, cc.z - prev.z)));
    const along = Array.from({ length: steps }, (_, s) => ({ x: prev.x + (cc.x - prev.x) * (s + 1) / steps, y: prev.y + (cc.y - prev.y) * (s + 1) / steps, z: prev.z + (cc.z - prev.z) * (s + 1) / steps }));
    const past = about.find(m => along.some(p => dist(m, p) < passing(dist(m, here))));
    if (past) return none(`the way back passes the ${String(past.name).replaceAll('_', ' ')} ${r1(dist(past, here))} blocks off`);
    blocks += Math.hypot(cc.x - prev.x, cc.y - prev.y, cc.z - prev.z);
    way.push(c);
    prev = cc;
    const n = nearestTo(cc);
    if (dist(cc, here) >= minBlocks && n >= nowNearest + gain && !lavaBeside(c) && standable(c)) {
      const m = about.slice().sort((a, b) => dist(a, cc) - dist(b, cc))[0];
      return { cells: way, end: { x: c.x, y: c.y, z: c.z }, blocks: Math.round(blocks), gain: Math.round(n - nowNearest), secondsAgo: Math.max(1, Math.round((now - c.at) / 1000)), nearest: { name: m.name, blocks: Math.round(n) } };
    }
  }
  return none(`no cell of the last ${Math.round(TRAIL_MS / 60000)} minutes' footing is ${minBlocks} blocks off and ${gain} further from every mob`);
}

// Said on the retreat: the way, where it ends, and that it is footing the
// bot has stood on.
function says(way, { sprint = 5.6 } = {}) {
  if (!way?.end) return '';
  const secs = r1(way.blocks / sprint);
  return ` A way is found: back the way it came, ${way.blocks} blocks along ${way.cells.length} cells it stood on in the last ${way.secondsAgo} seconds, to (${way.end.x}, ${way.end.y}, ${way.end.z}), ${way.gain} blocks further from every mob about than here (the nearest, a ${String(way.nearest.name).replaceAll('_', ' ')}, ${way.nearest.blocks} blocks from it), passing none of them, about ${secs} seconds at a run.`;
}

// The bot's own trail: on the bot, off the saved record.
function trailOf(bot) { return bot?._wayBack || null; }
function noteBot(bot, now = Date.now()) {
  const p = bot?.entity?.position;
  if (!p || bot.entity.onGround === false) return;
  const trail = bot._wayBack ||= { cells: [] };
  if (trail.dimension !== undefined && trail.dimension !== String(bot.game?.dimension || '')) trail.cells = [];
  trail.dimension = String(bot.game?.dimension || '');
  noteCell(trail, feetOf(p), now);
}
function plugin(bot) {
  if (bot._wayBackWatched) return;
  bot._wayBackWatched = true;
  let last = null;
  bot.on?.('move', () => {
    try {
      const p = bot.entity?.position;
      if (!p) return;
      const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)},${bot.entity.onGround}`;
      if (k === last) return;
      last = k;
      noteBot(bot);
    } catch (_) { /* a cell missed */ }
  });
  bot.on?.('death', () => { if (bot._wayBack) bot._wayBack.cells = []; });
}

// The way back for the bot past `entities` (mobs with positions), the world
// read for the end's footing and lava beside each cell.
function findFor(bot, entities, opts = {}) {
  const here = bot?.entity?.position;
  if (!here) return null;
  const mobs = (entities || []).filter(e => e?.position).map(e => ({ name: e.name, x: e.position.x, y: e.position.y, z: e.position.z }));
  const { Vec3 } = require('vec3');
  const standable = c => {
    if (typeof bot.blockAt !== 'function') return true;
    const floor = bot.blockAt(new Vec3(c.x, c.y - 1, c.z)), feet = bot.blockAt(new Vec3(c.x, c.y, c.z)), head = bot.blockAt(new Vec3(c.x, c.y + 1, c.z));
    if (!floor || !feet || !head) return true;
    return floor.boundingBox === 'block' && feet.boundingBox === 'empty' && head.boundingBox === 'empty' && !/lava|fire/.test(feet.name);
  };
  const lavaBeside = c => {
    if (typeof bot.blockAt !== 'function') return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, -1]) if (bot.blockAt(new Vec3(c.x + dx, c.y + dy, c.z + dz))?.name === 'lava') return true;
    return false;
  };
  return find(trailOf(bot), here, mobs, { standable, lavaBeside, ...opts });
}

// The run along the way: legs of LEG_CELLS cells, each walked by the
// pathfinder to a cell of the way, so the run keeps to footing stood on.
// -> { ok, walked, why }
async function runBack(bot, task, way, navigate, { legTimeoutMs = 4000 } = {}) {
  const { goals } = require('mineflayer-pathfinder');
  let i = 0, walked = 0;
  while (i < way.cells.length - 1) {
    task?.check?.();
    const j = Math.min(way.cells.length - 1, i + LEG_CELLS), c = way.cells[j];
    try { await navigate(bot, task, new goals.GoalNear(c.x, c.y, c.z, j === way.cells.length - 1 ? 0 : 1), { timeoutMs: legTimeoutMs, stallMs: 1500 }); }
    catch (err) {
      task?.check?.();
      if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err;
      return { ok: false, walked, why: String(err?.message || err).slice(0, 160) };
    }
    walked += j - i;
    i = j;
  }
  return { ok: true, walked };
}

module.exports = { TRAIL_MS, TRAIL_MOST, GAIN, MIN_BLOCKS, WALK_GAP, FALL_MOST, COARSE_GAP, LEG_CELLS, noteCell, find, says, trailOf, noteBot, plugin, findFor, runBack, feetOf };
