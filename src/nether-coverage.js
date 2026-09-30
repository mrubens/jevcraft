'use strict';
// What the search has seen of the Nether, and where it has stood, the way
// a player keeps a rough map in mind: ground looked over at the heights
// fortresses stand at, and ground walked. The search's legs were ninety-six
// blocks from a compass and nothing kept what had been seen, so a leg into
// air already looked across was offered on the same terms as one into
// space never seen (the design review of 2026-09-27, note 572).
//
// Kept in columns of 4 by 4 blocks, sixteen to a chunk: each chunk a
// sixteen-bit mask of its columns (goal.fortressSearch.coverage, saved with
// the goal, per dimension). Seen is a line from the eyes reaching into the
// column through open air between y 48 and 79, never through a wall or
// lava; lines are sampled, a few each tick, not every block. Stood is a
// column the bot's feet were in.
const { Vec3 } = require('vec3');

const CELL = 4;
// Where fortresses stand: corridors and bridges mostly between y 48 and 75.
const BAND_LOW = 48, BAND_HIGH = 80;
// Bricks are seen within 128 blocks (the search's own look).
const RANGE = 128;
// A full look, and the lines drawn a tick while the search runs.
const RAYS = 192, RAYS_A_TICK = 6;
// Lines leave the eyes this far above and below level at most: what lies
// far off at fortress heights is seen near level.
const PITCH = 0.6;
// A leg's length (mob-hunt.js FORTRESS_LEG).
const LEG = 96;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const dimOf = bot => String(bot.game?.dimension || 'nether').replace(/^minecraft:/, '').replace(/^the_/, '');
function coverageOf(state, dim) {
  const all = state.coverage ||= {};
  const c = all[dim] ||= {};
  c.seen ||= {}; c.stood ||= {};
  return c;
}
const chunkKey = (cx, cz) => `${cx >> 2},${cz >> 2}`;
const bitOf = (cx, cz) => 1 << ((cx & 3) + 4 * (cz & 3));
function mark(set, x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), k = chunkKey(cx, cz);
  set[k] = (set[k] || 0) | bitOf(cx, cz);
}
function has(set, cx, cz) { return !!((set[chunkKey(cx, cz)] || 0) & bitOf(cx, cz)); }

// What a cell holds, cheaply: the world's state id where the bot has one
// (a line crosses hundreds of cells), blockAt otherwise. Null where the
// chunk is not loaded.
function reader(bot) {
  const w = bot.world, reg = bot.registry;
  if (typeof w?.getColumnAt === 'function' && reg?.blocksByStateId) {
    const p = new Vec3(0, 0, 0), q = new Vec3(0, 0, 0);
    return (x, y, z) => {
      const col = w.getColumnAt(p.set(x, y, z));
      if (!col) return null;
      return reg.blocksByStateId[col.getBlockStateId(q.set(x & 15, y, z & 15))] || null;
    };
  }
  if (typeof bot.blockAt !== 'function') return null;
  return (x, y, z) => bot.blockAt(new Vec3(x, y, z));
}
const liquidName = n => /lava|water/.test(n || '');

// One line from the eyes, cell by cell (Amanatides and Woo): each column it
// passes through open air at fortress heights is seen, and the face it
// stops on is seen too.
function trace(read, eye, dir, seen) {
  const c = [Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)], o = [eye.x, eye.y, eye.z], d = [dir.x, dir.y, dir.z];
  const step = d.map(Math.sign);
  const next = d.map((v, i) => step[i] ? ((step[i] > 0 ? c[i] + 1 : c[i]) - o[i]) / v : Infinity);
  const delta = d.map(v => v ? Math.abs(1 / v) : Infinity);
  for (let n = 0; n < RANGE * 3; n++) {
    const i = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    if (next[i] > RANGE) return;
    c[i] += step[i]; next[i] += delta[i];
    if (c[1] < 0 || c[1] > 255) return;
    const b = read(c[0], c[1], c[2]);
    if (!b) return;
    if (c[1] >= BAND_LOW && c[1] < BAND_HIGH) mark(seen, c[0], c[2]);
    if (b.boundingBox === 'block' || liquidName(b.name)) return;
  }
}

// Lines drawn from where the bot stands: `rays` of them, spread round it
// and a little up and down, each look turned from the last so that looks
// from one place fill in between each other's lines.
function look(bot, state, { rays = RAYS } = {}) {
  const here = bot.entity?.position;
  if (!here) return null;
  const cov = coverageOf(state, dimOf(bot));
  stand(bot, state);
  const read = reader(bot);
  if (!read) return cov;
  const eye = new Vec3(here.x, here.y + 1.62, here.z);
  let k = cov.phase || 0;
  try {
    for (let n = 0; n < rays; n++, k++) {
      const yaw = k * GOLDEN, t = ((k * 0.7548776662) % 1) * 2 - 1, pitch = t * PITCH;
      const dir = new Vec3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      trace(read, eye, dir, cov.seen);
    }
  } catch (_) { /* a world that cannot be read is not seen */ }
  cov.phase = k % 1000003;
  return cov;
}
function stand(bot, state) {
  const here = bot.entity?.position;
  if (!here) return;
  mark(coverageOf(state, dimOf(bot)).stood, here.x, here.z);
  try { groundStood(bot, state); } catch (_) { /* nothing loaded to read */ }
}
// The rock the bot last stood on: ground a pickaxe digs for blocks, wider
// than a span (five of the eight cells round the one under the feet solid).
// A bot out on its own spans with none left to lay goes back to it, as a
// player walks back along the bridge. 25588 (mid-243-he, 22:13 to 22:22Z on
// 2026-09-29) stood on a basalt span at y 39 over the lava sea with an iron
// pickaxe and no block: it had come 60 blocks along a lower span and up a
// pillar of its own, and the restock's look back along the floor steps a
// block up or down at a time within 64 blocks, so the netherrack it came
// from, 70 blocks off and five down the pillar, was never seen (note 695).
const GROUND = /^(netherrack|basalt|smooth_basalt|blackstone|soul_soil|crimson_nylium|warped_nylium)$/;
function groundStood(bot, state) {
  if (typeof bot.blockAt !== 'function') return;
  const feet = bot.entity.position.floored(), key = `${feet.x},${feet.y},${feet.z}`;
  const g = state.lastGround ||= {}, dim = dimOf(bot);
  if (g[dim]?.key === key) return;
  const under = bot.blockAt(feet.offset(0, -1, 0));
  if (!under || !GROUND.test(under.name)) return;
  let wide = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (bot.blockAt(feet.offset(dx, -1, dz))?.boundingBox === 'block') wide++;
  if (wide < 5) return;
  g[dim] = { key, x: feet.x, y: feet.y, z: feet.z, name: under.name, at: Date.now() };
}
const lastGround = (state, bot) => state?.lastGround?.[dimOf(bot)] || null;

// While the fortress search runs in the Nether, a few lines a tick: a leg
// walked in one go is looked along its length, not only at its ends. The
// search's step says it is running (watch), and a search not stepped for a
// minute is not looked for.
function watch(bot, goal, now = Date.now()) {
  if (typeof bot.on !== 'function') return;
  const w = bot.__netherCoverage ||= { goal: null, at: 0 };
  w.goal = goal; w.at = now;
  if (w.installed) return;
  w.installed = true;
  bot.on('physicsTick', () => {
    const state = w.goal?.fortressSearch;
    if (!state || dimOf(bot) !== 'nether') return;
    // Ground walked is kept however long the step that walks it runs: a
    // crossing of ninety blocks outlasts the minute the looks are kept to.
    stand(bot, state);
    if (!(w.at > Date.now() - 60000)) return;
    look(bot, state, { rays: RAYS_A_TICK });
  });
}

// The ground one heading's leg would look over: the columns within 128
// blocks of its line (bricks are seen that far through open air, and no
// farther), ahead of the bot and on past the leg's end, the ground round
// the bot itself left out as every heading's alike. How many there are, how
// many are unseen at fortress heights, and how many of those lie within 128
// of a stretch of the line in open air at the height the bot stands, since
// from inside the rock nothing is seen (with `bot`, the line is read); and
// of the line, how many blocks run over columns stood on.
const REVEAL = 128, NEAR = 8;
function lineOpen(bot, here, [dx, dz], length) {
  const read = reader(bot);
  const out = new Uint8Array(length + 1);
  if (!read) return null;
  const y = Math.floor(here.y), x0 = Math.floor(here.x), z0 = Math.floor(here.z);
  try {
    for (let n = 1; n <= length; n++) {
      const body = [read(x0 + dx * n, y, z0 + dz * n), read(x0 + dx * n, y + 1, z0 + dz * n)];
      if (body.some(b => !b)) break;
      out[n] = body.every(b => b.boundingBox === 'empty' && !liquidName(b.name)) ? 1 : 0;
    }
  } catch (_) { return null; }
  return out;
}
function headingCoverage(state, dim, here, heading, { length = LEG, reveal = REVEAL, bot = null, barren = null } = {}) {
  const [dx, dz] = heading;
  const cov = coverageOf(state, dim);
  const open = bot ? lineOpen(bot, here, heading, length) : null;
  // Whether a cell of the line has been stood on (within a block of it).
  const stoodAt = n => { const lx = here.x + dx * n, lz = here.z + dz * n; return [-1, 0, 1].some(o => has(cov.stood, Math.floor((lx + dz * o) / CELL), Math.floor((lz + dx * o) / CELL))); };
  // Open cells of the line up to each point, to ask whether any lies
  // within `reveal` of a column. The first blocks of the line see what the
  // bot sees from here, already looked at: only the open air past them
  // counts. Nor does open air already stood on: the looks from there were
  // taken as it was walked, and what they did not reach stays unseen from
  // there. 25593 (mid-242-xd, 11:12:33Z on 2026-09-30) was told of the leg
  // back over the 67 blocks it had just walked "about 82 of them lie beside
  // the 60 blocks of its line in open air", chose it, and saw 11 new columns
  // in fifteen minutes (note 751).
  const upTo = open && Array.from(open).reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + (i >= NEAR && v && !stoodAt(i) ? 1 : 0)); return acc; }, []);
  const openAll = open ? Array.from(open).reduce((n, v, i) => n + (i >= NEAR ? v : 0), 0) : null;
  const inView = (along, across) => {
    if (!upTo) return true;
    const w = Math.sqrt(Math.max(0, reveal * reveal - across * across));
    const lo = Math.max(1, Math.ceil(along - w)), hi = Math.min(length, Math.floor(along + w));
    return hi >= lo && upTo[hi] - upTo[lo - 1] > 0;
  };
  const hx = Math.floor(here.x / CELL), hz = Math.floor(here.z / CELL), r = Math.ceil((length + reveal) / CELL);
  // `barren` (x, z) says where no fortress begins (a region holding a
  // bastion: nether-regions.js); unseen ground there is counted apart.
  let cells = 0, unseen = 0, unseenInView = 0, barrenInView = 0;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const x = (hx + i + 0.5) * CELL - here.x, z = (hz + j + 0.5) * CELL - here.z;
    const along = x * dx + z * dz, across = Math.abs(x * dz - z * dx);
    if (along < CELL * 2 || across > reveal || across > along) continue;
    if (along > length && Math.hypot(along - length, across) > reveal) continue;
    cells++;
    if (has(cov.seen, hx + i, hz + j)) continue;
    unseen++;
    if (inView(along, across)) { unseenInView++; if (barren && barren((hx + i + 0.5) * CELL, (hz + j + 0.5) * CELL)) barrenInView++; }
  }
  // Stood on within a block to either side of the line: a span walked
  // runs a block off the line from its far end as often as not, and read
  // on the line alone mid-242-gb's own span of ninety blocks was "stood on
  // 6 of 96" from one end and 92 from the other (note 680).
  let stood = 0, seenLine = 0;
  for (let n = 1; n <= length; n++) {
    const lx = here.x + dx * n, lz = here.z + dz * n;
    const cx = Math.floor(lx / CELL), cz = Math.floor(lz / CELL);
    if ([-1, 0, 1].some(o => has(cov.stood, Math.floor((lx + dz * o) / CELL), Math.floor((lz + dx * o) / CELL)))) stood++;
    if (has(cov.seen, cx, cz)) seenLine++;
  }
  return { cells, unseen, unseenInView: upTo ? unseenInView : null, barrenInView, openCells: upTo ? upTo[length] : null, openAll, stood, seenLine, length, reveal };
}
const chunks = cells => Math.round(cells / 16);
// What a leg is for, said first and short: the new ground it looks over.
// Said after the cells and the blocks, a leg's value came last in 1,400
// characters, and 324 of 1,232 legs chosen from 12:00Z on 2026-09-29 went
// over ground more than half seen, 263 of them with a leg half unseen or
// more on offer (note 688). "Unseen ahead" is the ground within 128 blocks
// of the line, ahead and past its end, that no line from the eyes has
// reached at fortress heights (the guidance says what that is).
function headingSays(h, name) {
  if (!h.cells) return '';
  const all = chunks(h.cells), un = chunks(h.unseen);
  const pct = Math.round(h.unseen / h.cells * 100);
  // What it opens: the unseen ground in view from open air on its line not
  // stood on before (headingCoverage), in columns of 4 by 4 and chunks.
  const view = h.unseenInView === null || !h.unseen ? '' :
    !h.openCells && h.openAll ? `; it opens none of it: its ${h.openAll} blocks in open air have all been stood on, the looks from them taken as they were walked, and what they did not reach is behind walls from there` :
    !h.openCells ? `; past its first ${NEAR} blocks the line is rock or lava at this height, so none of it is seen from the leg itself` :
    `; it opens about ${h.unseenInView} new columns of 4 by 4 (${chunks(h.unseenInView)} chunks) to view from the ${h.openCells} blocks of its line in open air not stood on before${h.openAll > h.openCells ? ` (${h.openAll - h.openCells} more in open air were stood on already)` : ''}`;
  const barren = h.barrenInView && h.openCells ? ` Of what it opens, about ${h.barrenInView} columns lie in a region holding a bastion, where no fortress begins (one begun in a region beside can reach a little way in).` : '';
  const walked = !h.stood ? '' : h.stood * 2 >= h.length ? ` The bot has stood on ${h.stood} of its ${h.length} blocks before: it walks again ground already walked and looked from, and what is unseen that way lies off to its sides and past its end.` :
    ` The bot has stood on ${h.stood} of its ${h.length} blocks before.`;
  return ` Unseen ahead: about ${un} of ${all} chunks (${pct}%)${pct <= 20 ? ', mostly seen already' : ''}${view}.${barren}${walked}`;
}
// A leg back over the last one, said plainly: how far back that leg began
// and how much of this one goes over it. `from` is how far off the last
// leg began (null where it is not known).
function backSays(from, name, length = LEG) {
  if (!(from >= 8)) return ' This is back the way the last leg came.';
  return ` Back over the last leg's own line: that leg began ${from} blocks ${name} of here, and ${from >= length ? `all ${length} blocks of this one go` : `this one's first ${from} blocks go`} over the ground it just searched, already looked over from there.`;
}

// The search widened round where it began, a square spiral: each side goes
// clockwise (east, south, west, north) along a ring round the start, and
// the side north along the west turns out past the corner to the next ring,
// RING blocks farther out. Read from where the bot stands, not a counter:
// a side cut short is gone on from wherever the bot is. -> { heading (0
// east, 1 south, 2 west, 3 north), length, end: { x, z }, ring, from (the
// bot's distance from the start now), endFrom }.
const RING = 96;
function spiralSide(origin, here, { ring = RING, most = LEG * 2, least = 16 } = {}) {
  const dx = here.x - origin.x, dz = here.z - origin.z;
  const r = Math.max(Math.abs(dx), Math.abs(dz), ring / 2);
  let h = -dz >= Math.abs(dx) ? 0 : dx >= Math.abs(dz) ? 1 : dz >= Math.abs(dx) ? 2 : 3;
  const left = k => [r - dx, r - dz, r + dx, r + ring + dz][k];
  for (let n = 0; n < 4 && left(h) < least; n++) h = (h + 1) % 4;
  const length = Math.round(Math.max(least, Math.min(most, left(h))));
  const [sx, sz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][h];
  const end = { x: Math.round(here.x + sx * length), z: Math.round(here.z + sz * length) };
  return { heading: h, length, end, ring: Math.round(r), from: Math.round(Math.hypot(dx, dz)), endFrom: Math.round(Math.hypot(end.x - origin.x, end.z - origin.z)) };
}

// Whether a place lies one heading's way from here: within forty-five
// degrees of it.
function liesThatWay(here, p, [dx, dz]) {
  const x = p.x - here.x, z = p.z - here.z, d = Math.hypot(x, z);
  return d >= 1 && (x * dx + z * dz) / d >= Math.SQRT1_2;
}
// How near the bot has stood to a place: the nearest column stood on
// within `within`, or null.
function stoodNear(state, dim, p, within = 32) {
  const cov = coverageOf(state, dim);
  const r = Math.ceil(within / CELL), px = Math.floor(p.x / CELL), pz = Math.floor(p.z / CELL);
  let best = null;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (!has(cov.stood, px + i, pz + j)) continue;
    const d = Math.hypot((px + i + 0.5) * CELL - p.x, (pz + j + 0.5) * CELL - p.z);
    if (d <= within && (best === null || d < best)) best = d;
  }
  return best === null ? null : Math.round(best);
}
// All that has been seen and stood on, as the search's state says it.
function coverageSays(state, dim, here, radius = LEG) {
  const cov = coverageOf(state, dim);
  const count = set => Object.values(set).reduce((n, m) => { for (let b = m; b; b >>= 1) n += b & 1; return n; }, 0);
  const hx = Math.floor(here.x / CELL), hz = Math.floor(here.z / CELL), r = Math.ceil(radius / CELL);
  let cells = 0, seen = 0;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (Math.hypot((hx + i + 0.5) * CELL - here.x, (hz + j + 0.5) * CELL - here.z) > radius) continue;
    cells++; if (has(cov.seen, hx + i, hz + j)) seen++;
  }
  return `seen at fortress heights (y ${BAND_LOW} to ${BAND_HIGH - 1}) through open air: about ${chunks(count(cov.seen))} chunks' worth of ground in all, and of the ground within ${radius} blocks of here about ${chunks(seen)} of ${chunks(cells)} chunks; stood on: ${count(cov.stood)} columns of 4 by 4 blocks`;
}

module.exports = { look, stand, lastGround, groundStood, watch, headingCoverage, headingSays, backSays, spiralSide, liesThatWay, stoodNear, coverageSays, coverageOf, dimOf, CELL, RAYS, LEG, RING, REVEAL, BAND_LOW, BAND_HIGH };
