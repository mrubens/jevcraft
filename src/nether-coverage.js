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
}

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
    if (!state || !(w.at > Date.now() - 60000) || dimOf(bot) !== 'nether') return;
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
function headingCoverage(state, dim, here, heading, { length = LEG, reveal = REVEAL, bot = null } = {}) {
  const [dx, dz] = heading;
  const cov = coverageOf(state, dim);
  const open = bot ? lineOpen(bot, here, heading, length) : null;
  // Open cells of the line up to each point, to ask whether any lies
  // within `reveal` of a column. The first blocks of the line see what the
  // bot sees from here, already looked at: only the open air past them
  // counts.
  const upTo = open && Array.from(open).reduce((acc, v, i) => { acc.push((acc[i - 1] || 0) + (i >= NEAR ? v : 0)); return acc; }, []);
  const inView = (along, across) => {
    if (!upTo) return true;
    const w = Math.sqrt(Math.max(0, reveal * reveal - across * across));
    const lo = Math.max(1, Math.ceil(along - w)), hi = Math.min(length, Math.floor(along + w));
    return hi >= lo && upTo[hi] - upTo[lo - 1] > 0;
  };
  const hx = Math.floor(here.x / CELL), hz = Math.floor(here.z / CELL), r = Math.ceil((length + reveal) / CELL);
  let cells = 0, unseen = 0, unseenInView = 0;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const x = (hx + i + 0.5) * CELL - here.x, z = (hz + j + 0.5) * CELL - here.z;
    const along = x * dx + z * dz, across = Math.abs(x * dz - z * dx);
    if (along < CELL * 2 || across > reveal || across > along) continue;
    if (along > length && Math.hypot(along - length, across) > reveal) continue;
    cells++;
    if (has(cov.seen, hx + i, hz + j)) continue;
    unseen++;
    if (inView(along, across)) unseenInView++;
  }
  let stood = 0, seenLine = 0;
  for (let n = 1; n <= length; n++) {
    const cx = Math.floor((here.x + dx * n) / CELL), cz = Math.floor((here.z + dz * n) / CELL);
    if (has(cov.stood, cx, cz)) stood++;
    if (has(cov.seen, cx, cz)) seenLine++;
  }
  return { cells, unseen, unseenInView: upTo ? unseenInView : null, openCells: upTo ? upTo[length] : null, stood, seenLine, length, reveal };
}
const chunks = cells => Math.round(cells / 16);
function headingSays(h, name) {
  if (!h.cells) return '';
  const all = chunks(h.cells), un = chunks(h.unseen);
  const share = h.unseen / h.cells;
  const ground = `of the ground within ${h.reveal} blocks of this leg's line ${name}, ahead and on past its end (about ${all} chunks), about ${un} chunk${un === 1 ? '' : 's'} ${un === 1 ? 'is' : 'are'} unseen at fortress heights (no line from the eyes has reached it through open air between y ${BAND_LOW} and ${BAND_HIGH - 1})`;
  const view = h.unseenInView === null || !h.unseen ? '' : h.unseenInView === h.unseen ? '' :
    !h.openCells ? `, and past its first ${NEAR} blocks the line is rock or lava at this height all the way, so none of it is seen from the leg itself` :
    `, about ${chunks(h.unseenInView)} of them within ${h.reveal} blocks of the ${h.openCells} blocks of the line past its first ${NEAR} in open air (from inside the rock nothing is seen)`;
  const walked = !h.stood ? '' : h.stood * 2 >= h.length ? ` The bot has stood on ${h.stood} of the ${h.length} blocks of this leg's own line before: it walks again ground already walked and looked at from, and what is unseen that way lies off to its sides and past its end.` :
    ` The bot has stood on ${h.stood} of the ${h.length} blocks of this leg's own line before.`;
  if (share <= 0.2) return ` Mostly seen: ${ground}, so this leg goes mostly over ground already looked over.${walked}`;
  return ` ${capital(ground)}${view}.${walked}`;
}
const capital = s => `${s[0].toUpperCase()}${s.slice(1)}`;

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

module.exports = { look, stand, watch, headingCoverage, headingSays, liesThatWay, stoodNear, coverageSays, coverageOf, dimOf, CELL, RAYS, LEG, REVEAL, BAND_LOW, BAND_HIGH };
