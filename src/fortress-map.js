'use strict';
// A fortress as the bot has seen it, the way a player keeps it in mind:
// the floors it has seen (nether brick with room to stand, seen through
// open air, never through a wall), which of them it has walked, and where
// a seen floor runs on into space not yet seen (a corridor going on past a
// corner, a doorway, a stair). mid-242-aa-fortress-1 spent eleven minutes
// in its fortress setting out for bricks picked from everything within 128
// blocks, walls and floors behind walls among them: two of five reached a
// pass, the rest "No path" and staircases dug through the walls, and it
// left without having seen a blaze (note 557). The map is kept on the
// search (goal.fortressSearch.map) across passes.
const { Vec3 } = require('vec3');

const FLOORS = ['nether_bricks', 'nether_brick_stairs', 'nether_brick_slab'];
// How far the look reaches, and how many lines it draws a look.
const LOOK = 48, RAYS = 4096, EDGE_RAYS = 1200, LOOK_EVERY_MS = 1000;
// Walked: floor within this of where the bot stood (corridors are three
// to five wide).
const VISIT = 2;
// A way on that could not be walked is passed over this long.
const FAILED_MS = 5 * 60000;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const ALL = 15;
const keyOf = (x, y, z) => `${x},${y},${z}`;
const parse = k => k.split(',').map(Number);
const liquid = b => /lava|water/.test(b?.name || '');
const open = b => !!b && b.boundingBox === 'empty' && !liquid(b);
const solid = b => !!b && b.boundingBox !== 'empty';

function mapOf(state) {
  const map = state.map ||= {};
  map.cells ||= {}; map.failed ||= {}; map.spawners ||= []; map.chests ||= [];
  return map;
}
function floorAt(bot, p) {
  const b = bot.blockAt(p);
  return !!b && FLOORS.includes(b.name) && open(bot.blockAt(p.offset(0, 1, 0))) && open(bot.blockAt(p.offset(0, 2, 0)));
}
function sees(bot, eye, point) {
  const { lineClear } = require('./danger');
  return lineClear(bot, eye, point);
}
function addCell(bot, map, p) {
  map.cells[keyOf(p.x, p.y, p.z)] = [0, ALL, bot.blockAt(p)?.name === 'nether_brick_stairs' ? 1 : 0];
}

// Whether what lies beside a seen floor, one way, is known: a floor seen
// there (a step up or down included), a wall at the feet's height (seen
// with the floor beside it), or, looked at through open air, a gap, lava or
// ground that is not the fortress's. `budget` counts the lines drawn.
function sideKnown(bot, map, eye, x, y, z, d, budget) {
  const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
  for (const dy of [0, 1, -1]) if (map.cells[keyOf(nx, y + dy, nz)]) return true;
  for (const dy of [0, 1, -1]) {
    const p = new Vec3(nx, y + dy, nz);
    if (!floorAt(bot, p)) continue;
    if (!budget()) return false;
    if (sees(bot, eye, p.offset(0.5, 1.05, 0.5))) { addCell(bot, map, p); return true; }
    return false;
  }
  const feet = bot.blockAt(new Vec3(nx, y + 1, nz));
  if (solid(feet)) return true;
  // Lava on the floor, or the floor's edge over open air: what lies past it
  // is seen from its edge, so the edge stays a way on until it is walked.
  // mid-242-aa-fortress-1's corridor ran on west past a lava fall onto its
  // floor, seen only from the landing beside it (note 557).
  const below = bot.blockAt(new Vec3(nx, y, nz));
  if (liquid(feet) || !below || open(below) || liquid(below)) return false;
  if (!budget()) return false;
  return sees(bot, eye, new Vec3(nx + 0.5, y + 1.05, nz + 0.5));
}

// The bot looks round: floors newly seen are added, the sides of those
// near it settled where it can see them, the floor round its feet walked,
// and a spawner, nether wart or a chest in sight noted.
function look(bot, state, { now = Date.now(), force = false } = {}) {
  const map = mapOf(state), here = bot.entity?.position;
  if (!here || typeof bot.blockAt !== 'function') return map;
  const moved = !map.lookedFrom || Math.hypot(map.lookedFrom.x - here.x, map.lookedFrom.y - here.y, map.lookedFrom.z - here.z) > 1.5;
  if (force || moved || !(now - (map.lookedAt || 0) < LOOK_EVERY_MS)) {
    map.lookedAt = now; map.lookedFrom = { x: here.x, y: here.y, z: here.z };
    const eye = here.offset(0, 1.62, 0);
    const ids = FLOORS.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
    const found = typeof bot.findBlocks === 'function' ? (bot.findBlocks({ matching: ids, maxDistance: LOOK, count: 4096 }) || []) : [];
    let rays = 0;
    for (const p of found.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))) {
      if (p.distanceTo(here) > LOOK || map.cells[keyOf(p.x, p.y, p.z)] || !floorAt(bot, p)) continue;
      if (rays++ >= RAYS) break;
      if (sees(bot, eye, p.offset(0.5, 1.05, 0.5))) addCell(bot, map, p);
    }
    let edges = 0;
    const budget = () => edges++ < EDGE_RAYS;
    const near = Object.entries(map.cells).filter(([, c]) => c[1]).map(([k, c]) => [parse(k), c])
      .filter(([[x, y, z]]) => Math.hypot(x + 0.5 - here.x, y + 1 - here.y, z + 0.5 - here.z) <= LOOK)
      .sort((a, b) => Math.hypot(a[0][0] - here.x, a[0][2] - here.z) - Math.hypot(b[0][0] - here.x, b[0][2] - here.z));
    for (const [[x, y, z], c] of near) for (let d = 0; d < 4; d++) {
      const bit = 1 << d;
      if ((c[1] & bit) && sideKnown(bot, map, eye, x, y, z, d, budget)) c[1] &= ~bit;
    }
    features(bot, map, eye, now);
  }
  visit(bot, map, now);
  return map;
}
function visit(bot, map, now) {
  const here = bot.entity.position, t = Math.round(now / 1000);
  // On a slab or a stair the feet are half a block up in the floor's cell.
  const dys = here.y % 1 > 0.01 ? [0, -1] : [-1, -2];
  for (let dx = -VISIT; dx <= VISIT; dx++) for (let dz = -VISIT; dz <= VISIT; dz++) for (const dy of dys) {
    const c = map.cells[keyOf(Math.floor(here.x) + dx, Math.floor(here.y + 0.01) + dy, Math.floor(here.z) + dz)];
    if (c) c[0] = t;
  }
}
// A spawner, nether wart and chests, each only as seen through open air.
function features(bot, map, eye, now) {
  const id = n => bot.registry?.blocksByName?.[n]?.id;
  const find = (n, count) => id(n) === undefined || typeof bot.findBlocks !== 'function' ? [] : (bot.findBlocks({ matching: id(n), maxDistance: LOOK, count }) || []);
  const visible = p => [[0.5, 0.5, 0.5], [0.5, 1.02, 0.5], [0.5, 0.5, -0.02], [0.5, 0.5, 1.02], [-0.02, 0.5, 0.5], [1.02, 0.5, 0.5]].some(([a, b, c]) => sees(bot, eye, p.offset(a, b, c)));
  for (const p of find('spawner', 4)) {
    if (bot.blockAt(p)?.name !== 'spawner' || !visible(p)) continue;
    const known = map.spawners.find(s => s.x === p.x && s.y === p.y && s.z === p.z);
    if (known) known.seenAt = now; else map.spawners.push({ x: p.x, y: p.y, z: p.z, seenAt: now });
  }
  if (!map.wart) { const w = find('nether_wart', 8).find(visible); if (w) map.wart = { x: w.x, y: w.y, z: w.z }; }
  for (const p of find('chest', 8)) if (!map.chests.some(c => c.x === p.x && c.y === p.y && c.z === p.z) && visible(p)) map.chests.push({ x: p.x, y: p.y, z: p.z });
}

// The seen floor the bot stands on, or the nearest within reach of it.
function standing(bot, map) {
  const here = bot.entity.position, fx = Math.floor(here.x), fy = Math.floor(here.y + 0.01) - 1, fz = Math.floor(here.z);
  for (const dy of [0, 1, -1]) if (map.cells[keyOf(fx, fy + dy, fz)]) return keyOf(fx, fy + dy, fz);
  let best = null, bestD = Infinity;
  for (const k of Object.keys(map.cells)) {
    const [x, y, z] = parse(k);
    if (Math.abs(y + 1 - here.y) > 1.5) continue;
    const d = Math.hypot(x + 0.5 - here.x, z + 0.5 - here.z);
    if (d <= 3 && d < bestD) { best = k; bestD = d; }
  }
  return best;
}
// Floors joined to `from` by floors seen, a step up or down at a time:
// each with its distance in steps.
function reach(map, from) {
  const dist = new Map([[from, 0]]), queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const [x, y, z] = parse(queue[i]), d = dist.get(queue[i]);
    for (const [dx, dz] of DIRS) for (const dy of [0, 1, -1]) {
      const k = keyOf(x + dx, y + dy, z + dz);
      if (!map.cells[k] || dist.has(k)) continue;
      dist.set(k, d + 1); queue.push(k);
    }
  }
  return dist;
}
const failedNow = (map, k, now) => map.failed[k] && now - map.failed[k].at < (map.failed[k].ms || FAILED_MS);

// What the map comes to from where the bot stands: the ways on it can walk
// to (nearest first by the floors), the unwalked floors seen that no floor
// joins to it (each group with the gap between), the floors walked, and the
// least lately walked floors to patrol.
function plan(bot, map, { now = Date.now() } = {}) {
  const from = standing(bot, map);
  const keys = Object.keys(map.cells), here = bot.entity.position;
  const walked = keys.filter(k => map.cells[k][0]).length;
  if (!from) return { from: null, seen: keys.length, walked, frontiers: [], groups: [], patrol: [] };
  const dist = reach(map, from);
  const frontier = k => map.cells[k][1] && !map.cells[k][0];
  const frontiers = [...dist.keys()].filter(k => frontier(k) && dist.get(k) >= 2 && !failedNow(map, k, now))
    .sort((a, b) => dist.get(a) - dist.get(b)).map(k => ({ key: k, at: parse(k), steps: dist.get(k) }));
  // Unwalked floors not joined: grouped by the floors joining them.
  const grouped = new Set(), groups = [];
  for (const k of keys) {
    if (dist.has(k) || grouped.has(k) || map.cells[k][0]) continue;
    const members = [...reach(map, k).keys()];
    members.forEach(m => grouped.add(m));
    const open = members.filter(frontier);
    if (!members.length) continue;
    const nearest = members.map(parse).sort((a, b) => Math.hypot(a[0] - here.x, a[2] - here.z) - Math.hypot(b[0] - here.x, b[2] - here.z))[0];
    const key = keyOf(...nearest);
    if (failedNow(map, key, now)) continue;
    groups.push({ key, at: nearest, cells: members.length, open: open.length, off: Math.round(Math.hypot(nearest[0] + 0.5 - here.x, nearest[2] + 0.5 - here.z)), dy: nearest[1] + 1 - Math.floor(here.y + 0.01) });
  }
  groups.sort((a, b) => a.off - b.off);
  const patrol = [...dist.keys()].filter(k => map.cells[k][0] && dist.get(k) >= 12 && !failedNow(map, k, now))
    .sort((a, b) => map.cells[a][0] - map.cells[b][0] || dist.get(b) - dist.get(a)).slice(0, 8).map(k => ({ key: k, at: parse(k), steps: dist.get(k) }));
  return { from, joined: dist.size, seen: keys.length, walked, frontiers, groups, patrol, dist };
}
// Floors seen join `p` to where the bot stands: the steps, or null.
function stepsTo(map, planned, p) {
  if (!planned?.dist) return null;
  let best = null;
  for (const [k, d] of planned.dist) {
    const [x, y, z] = parse(k);
    if (Math.hypot(x + 0.5 - p.x, y + 1 - p.y, z + 0.5 - p.z) <= 4 && (best === null || d < best)) best = d;
  }
  return best;
}
// What lies on the straight line between two floors at the feet's height:
// lava, open air with no floor, rock, or floor.
function gapSays(bot, a, b) {
  const counts = { lava: 0, air: 0, rock: 0 };
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[2] - a[2]));
  for (let i = 1; i < n; i++) {
    const x = Math.round(a[0] + (b[0] - a[0]) * i / n), z = Math.round(a[2] + (b[2] - a[2]) * i / n), y = a[1];
    const feet = bot.blockAt(new Vec3(x, y + 1, z)), floor = bot.blockAt(new Vec3(x, y, z));
    if (liquid(feet) || /lava/.test(floor?.name || '')) counts.lava++;
    else if (solid(feet)) counts.rock++;
    else if (!solid(floor)) counts.air++;
  }
  const parts = [counts.lava && `${counts.lava} of lava`, counts.air && `${counts.air} of open air with no floor`, counts.rock && `${counts.rock} of wall or rock`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'floor all the way, not seen joined';
}
// The nearest pair of a floor the bot can walk to and one of a group.
function gapTo(bot, planned, group, map) {
  if (!planned?.dist) return null;
  const members = [...reach(map, group.key).keys()].map(parse);
  let best = null;
  for (const k of planned.dist.keys()) {
    const a = parse(k);
    for (const b of members) {
      const d = Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]);
      if (!best || d < best.d) best = { d, a, b };
    }
  }
  return best && { across: Math.round(best.d), from: best.a, to: best.b, dy: best.b[1] - best.a[1], says: gapSays(bot, best.a, best.b) };
}

// The map as said to Jev: how much is walked, the ways on left, the rooms
// seen.
function mapSays(bot, map, planned, { now = Date.now() } = {}) {
  const here = bot.entity.position;
  const out = { floorsSeen: planned.seen, floorsWalked: planned.walked,
    joinedOnFoot: planned.from ? `${planned.joined} of the floors seen are joined to where the bot stands` : 'the bot stands on no floor it has seen' };
  out.waysOnFoot = planned.frontiers.length ? `${planned.frontiers.length} seen floor${planned.frontiers.length === 1 ? '' : 's'} running on into unseen space that the bot can walk to, the nearest ${planned.frontiers[0].steps} steps along the floors` : 'none: every floor joined to here that runs on into unseen space has been walked, or its walk failed';
  const off = s => `${Math.round(Math.hypot(s.x + 0.5 - here.x, s.y + 0.5 - here.y, s.z + 0.5 - here.z))} blocks off`;
  if (map.spawners.length) out.spawnersSeen = map.spawners.map(s => { const st = stepsTo(map, planned, s); return `(${s.x}, ${s.y}, ${s.z}), ${off(s)}, ${st === null ? 'no floor seen joins it to here' : `about ${st} steps along the floors`}`; });
  const stairs = Object.entries(map.cells).filter(([, c]) => c[2]);
  if (stairs.length) out.stairsSeen = `${stairs.length} nether brick stair${stairs.length === 1 ? '' : 's'} seen (a fortress's stairs lead up to its spawner rooms), ${stairs.filter(([, c]) => c[0]).length} walked`;
  if (map.wart) out.wartSeen = `nether wart at (${map.wart.x}, ${map.wart.y}, ${map.wart.z}), ${off(map.wart)}: the wart room`;
  if (map.chests.length) out.chestsSeen = map.chests.length;
  const failed = Object.entries(map.failed).filter(([, f]) => now - f.at < (f.ms || FAILED_MS)).slice(-3).map(([k, f]) => `(${k.replaceAll(',', ', ')}): ${f.why}`);
  if (failed.length) out.waysFailed = failed;
  return out;
}

module.exports = { look, plan, mapSays, mapOf, gapTo, stepsTo, standing, reach, floorAt, keyOf, parse, FLOORS, FAILED_MS };
