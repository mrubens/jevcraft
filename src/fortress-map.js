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
    // The bot's own bricks are not the fortress's floors (note 613).
    const own = require('./own-blocks').ownSet(bot, state);
    const found = (typeof bot.findBlocks === 'function' ? (bot.findBlocks({ matching: ids, maxDistance: LOOK, count: 4096 }) || []) : []).filter(p => !own.has(`${p.x},${p.y},${p.z}`));
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
  // Ground the bot stands on is a floor of the map, whatever it is: its
  // own blocks laid over lava or a gap join the floors either side, as the
  // way it walked. Unjoined, the far side stayed unwalked floors across a
  // gap it had crossed, offered again and crossed back (note 564).
  const under = new Vec3(Math.floor(here.x), Math.floor(here.y + 0.01) - (here.y % 1 > 0.01 ? 0 : 1), Math.floor(here.z));
  const k = keyOf(under.x, under.y, under.z);
  const b = bot.blockAt(under);
  if (!map.cells[k] && solid(b) && bot.entity.onGround !== false) map.cells[k] = FLOORS.includes(b.name) ? [t, ALL, b.name === 'nether_brick_stairs' ? 1 : 0] : [t, 0, 0];
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

// What came of the bot's time at each spawner the map holds (note 686):
// when it was last within sixteen of it (the spawner's reach), and the
// blazes killed, rods taken and seconds spent while it was, counted from the bot's own
// tallies between passes. A spawner seen broken is marked so. `kills` and
// `rods` are the bot's running counts now.
const SPAWNER_REACH = 16;
function noteSpawners(bot, map, { kills = 0, rods = 0, now = Date.now() } = {}) {
  const here = bot?.entity?.position;
  if (!here || !map?.spawners?.length) return;
  const was = map.tally || { kills, rods };
  const gained = { kills: Math.max(0, kills - was.kills), rods: Math.max(0, rods - was.rods) };
  // The time since the last pass, up to half a minute (a pass is a second
  // or a fight's length; a longer gap is the bot away or the bot stopped).
  const secs = was.at ? Math.min(30, Math.max(0, (now - was.at) / 1000)) : 0;
  map.tally = { kills, rods, at: now };
  for (const s of map.spawners) {
    const b = typeof bot.blockAt === 'function' ? bot.blockAt(new Vec3(s.x, s.y, s.z)) : null;
    if (b && b.name !== 'spawner') s.broken ||= now;
    if (Math.hypot(s.x + 0.5 - here.x, s.y + 0.5 - here.y, s.z + 0.5 - here.z) > SPAWNER_REACH) continue;
    s.lastThereAt = now; s.secondsThere = Math.round((s.secondsThere || 0) + secs);
    s.kills = (s.kills || 0) + gained.kills; s.rods = (s.rods || 0) + gained.rods;
  }
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

// The way across to floors not joined to here, along the ground as a
// player goes, not a straight line through the walls: floor walked, a
// corridor's floor under lava covered (a block laid into the lava at the
// feet takes its place, and the way goes on a block up, on the laid
// blocks), rock filling the way dug (natural rock only, with no lava or
// water behind it; the fortress's own bricks are walls), and open air with
// no floor spanned. Cheapest by the seconds each cell takes. mid-242-aa-
// fortress-2's corridor was cut off from both spawners by a lava fall onto
// its floor, and every way across said "lava in the way" (note 564).
// `lava: false` finds the way round the lava, if there is one.
const STEP_S = 0.3, LAY_S = 1.4;
// `groups`: a list of floor lists, one way found to each (one search).
function crossing(bot, planned, targets, options = {}) { return crossings(bot, planned, [targets], options)[0]; }
function crossings(bot, planned, groups, { lava = true, span = true, reach = 32, maxNodes = 12000, maxSeconds = 120 } = {}) {
  if (!planned?.dist || !groups?.length || typeof bot.blockAt !== 'function') return groups.map(() => null);
  const { NATURAL } = require('./bridging');
  const at = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
  const isLava = b => /lava/.test(b?.name || '');
  const clear = b => !!b && b.boundingBox === 'empty' && !liquid(b) && !/fire/.test(b.name);
  const rock = (b, p) => !!b && b.boundingBox === 'block' && b.diggable !== false && NATURAL.test(b.name) && require('./tunneling').safeExcavation(bot, p);
  const digS = b => {
    if (typeof b.digTime !== 'function') return 2;
    let tool = null; try { tool = require('./skills').cheapestTool(bot, b); } catch (_) { /* no inventory */ }
    return b.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000;
  };
  // A cell stood in at feet height `s`: what it takes to stand there.
  const cell = (x, s, z) => {
    const under = at(x, s - 1, z), feet = at(x, s, z), head = at(x, s + 1, z);
    if (!under || !feet || !head) return null;
    let kind = 'walk', cost = STEP_S, dig = 0, digSeconds = 0;
    if (isLava(under)) {
      // Lava lying on a floor, one deep: covered, it is walked on.
      if (!lava || !solid(at(x, s - 2, z)) || isLava(at(x, s - 2, z))) return null;
      kind = 'cover'; cost += LAY_S;
    } else if (!solid(under)) {
      if (!span || liquid(under)) return null;
      kind = 'span'; cost += LAY_S;
    }
    for (const [b, p] of [[feet, new Vec3(x, s, z)], [head, new Vec3(x, s + 1, z)]]) {
      if (clear(b)) continue;
      if (!rock(b, p)) return null;
      dig++; const t = digS(b); digSeconds += t; cost += t;
    }
    if (dig && kind === 'walk') kind = 'dig';
    return { kind, cost, dig, digSeconds };
  };
  const key = (x, s, z) => `${x},${s},${z}`, memo = new Map();
  const goal = new Map();
  groups.forEach((targets, i) => { for (const [x, y, z] of targets || []) { const k = key(x, y + 1, z); if (!goal.has(k)) goal.set(k, []); goal.get(k).push(i); } });
  const best = new Map(), prev = new Map(), info = new Map();
  const heap = [];
  const push = (k, c) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const origin = parse([...planned.dist.keys()][0]);
  for (const k of planned.dist.keys()) { const [x, y, z] = parse(k); const kk = key(x, y + 1, z); best.set(kk, 0); info.set(kk, { kind: 'walk', dig: 0, digSeconds: 0, joined: true }); push(kk, 0); }
  const found = groups.map(() => null);
  let left = groups.filter(g => g?.length).length, n = 0;
  while (heap.length && n++ < maxNodes) {
    const [c, k] = pop();
    if (c > best.get(k)) continue;
    if (goal.has(k)) {
      for (const i of goal.get(k)) if (!found[i]) { found[i] = k; left--; }
      if (!left) break;
    }
    if (c > maxSeconds) break;
    const [x, s, z] = parse(k);
    for (const [dx, dz] of DIRS) for (const ds of [0, 1, -1]) {
      const nx = x + dx, ns = s + ds, nz = z + dz;
      if (Math.abs(nx - origin[0]) > reach * 2 || Math.abs(nz - origin[2]) > reach * 2) continue;
      // A step up wants the head's room over where it is taken from; a span
      // is laid level.
      if (ds === 1 && !clear(at(x, s + 2, z))) continue;
      if (ds === -1 && !clear(at(nx, s + 1, nz))) continue;
      const nk = key(nx, ns, nz);
      const cl = info.get(nk)?.joined ? { kind: 'walk', cost: STEP_S, dig: 0, digSeconds: 0 } : memo.has(nk) ? memo.get(nk) : memo.set(nk, cell(nx, ns, nz)).get(nk);
      if (!cl || (cl.kind === 'span' && ds !== 0)) continue;
      const nc = c + cl.cost;
      if (best.has(nk) && best.get(nk) <= nc) continue;
      best.set(nk, nc); prev.set(nk, k); info.set(nk, cl); push(nk, nc);
    }
  }
  return found.map(k => k && wayOf(k));
  function wayOf(found) {
    const path = [];
    for (let k = found; k; k = prev.get(k)) { const i = info.get(k); path.unshift({ at: parse(k), kind: i.kind, dig: i.dig, digSeconds: i.digSeconds, joined: !!i.joined }); if (i.joined) break; }
    const [first, ...rest] = path;
    const count = kind => rest.filter(p => p.kind === kind).length;
    const lavaCells = rest.filter(p => p.kind === 'cover').map(p => new Vec3(p.at[0], p.at[1] - 1, p.at[2]));
    // Lava beside the way, at the feet or under them: what a misstep or a
    // push puts the bot in.
    const besideLava = rest.filter(p => DIRS.some(([dx, dz]) => [0, -1].some(dy => isLava(at(p.at[0] + dx, p.at[1] + dy, p.at[2] + dz))))).length;
    const sources = lavaCells.filter(p => lavaLevel(at(p.x, p.y, p.z)) === 0);
    return { from: first.at, to: path.at(-1).at, cells: rest.map(p => ({ x: p.at[0], y: p.at[1], z: p.at[2], kind: p.kind })), steps: rest.length,
      cover: count('cover'), span: count('span'), digCells: rest.filter(p => p.dig).length, digs: rest.reduce((a, p) => a + p.dig, 0),
      digSeconds: Math.round(rest.reduce((a, p) => a + p.digSeconds, 0) * 10) / 10, seconds: Math.round(best.get(found)), besideLava,
      lavaSources: sources.length, lavaCells: lavaCells.map(p => [p.x, p.y, p.z]), feed: lavaCells.length ? lavaFeed(bot, lavaCells) : null };
  }
}
// A lava block's level: 0 a source, 1 to 7 flowing, 8 and up falling.
function lavaLevel(b) {
  if (!/lava/.test(b?.name || '')) return null;
  const props = typeof b.getProperties === 'function' ? b.getProperties() : null;
  const level = props?.level ?? b.metadata;
  return Number.isFinite(Number(level)) ? Number(level) : null;
}
// Where lava lying on a floor comes from: the lava touching it followed
// sideways and up, within sixteen blocks; the highest cell reached,
// whether a source was among them, and whether any of it falls from above.
function lavaFeed(bot, cells) {
  const seen = new Set(cells.map(p => `${p}`)), queue = cells.slice();
  let top = cells[0], source = null, falls = false;
  for (let i = 0; i < queue.length && i < 400; i++) {
    const p = queue[i];
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      const q = p.offset(...d), k = `${q}`;
      if (seen.has(k) || Math.abs(q.x - cells[0].x) > 16 || Math.abs(q.z - cells[0].z) > 16 || q.y - cells[0].y > 16) continue;
      const b = bot.blockAt(q);
      if (!/lava/.test(b?.name || '')) continue;
      seen.add(k); queue.push(q);
      const level = lavaLevel(b);
      if (level === 0 && !source) source = q;
      if (d[1] === 1 || level >= 8) falls = true;
      if (q.y > top.y) top = q;
    }
  }
  return { cells: seen.size, top: [top.x, top.y, top.z], source: source && [source.x, source.y, source.z], falls };
}
// A crossing as said to Jev: what lies on it, cell by cell kinds counted.
function crossingSays(c) {
  const parts = [c.cover && `${c.cover} of lava lying on the floor, to cover (a block each, walked a block up)`, c.digCells && `${c.digCells} of rock filling the way, to dig (${c.digs} block${c.digs === 1 ? '' : 's'}, about ${c.digSeconds} seconds)`,
    c.span && `${c.span} of open air with no floor, to span`, `${c.steps - c.cover - c.digCells - c.span} of floor`].filter(Boolean);
  return `${c.steps} cells from (${c.from[0]}, ${c.from[1]}, ${c.from[2]}) to (${c.to[0]}, ${c.to[1]}, ${c.to[2]}): ${parts.join(', ')}`;
}

// The map as said to Jev: how much is walked, the ways on left, the rooms
// seen.
function mapSays(bot, map, planned, { now = Date.now() } = {}) {
  const here = bot.entity.position;
  const out = { floorsSeen: planned.seen, floorsWalked: planned.walked,
    joinedOnFoot: planned.from ? `${planned.joined} of the ${planned.seen} floors seen are joined to where the bot stands${planned.seen > planned.joined ? `; the other ${planned.seen - planned.joined} lie apart from it${planned.groups.length ? `, in ${planned.groups.length} part${planned.groups.length === 1 ? '' : 's'} with floors unwalked` : ''}` : ''}` : 'the bot stands on no floor it has seen' };
  out.waysOnFoot = planned.frontiers.length ? `${planned.frontiers.length} seen floor${planned.frontiers.length === 1 ? '' : 's'} running on into unseen space that the bot can walk to, the nearest ${planned.frontiers[0].steps} steps along the floors` : 'none: every floor joined to here that runs on into unseen space has been walked, or its walk failed';
  const off = s => `${Math.round(Math.hypot(s.x + 0.5 - here.x, s.y + 0.5 - here.y, s.z + 0.5 - here.z))} blocks off`;
  if (map.spawners.length) out.spawnersSeen = map.spawners.map(s => { const st = stepsTo(map, planned, s); return `(${s.x}, ${s.y}, ${s.z}), ${off(s)}, ${st === null ? 'no floor seen joins it to here' : `about ${st} steps along the floors`}${s.broken ? ', seen broken' : ''}`; });
  const stairs = Object.entries(map.cells).filter(([, c]) => c[2]);
  if (stairs.length) out.stairsSeen = `${stairs.length} nether brick stair${stairs.length === 1 ? '' : 's'} seen (a fortress's stairs lead up to its spawner rooms), ${stairs.filter(([, c]) => c[0]).length} walked`;
  if (map.wart) out.wartSeen = `nether wart at (${map.wart.x}, ${map.wart.y}, ${map.wart.z}), ${off(map.wart)}: the wart room`;
  if (map.chests.length) out.chestsSeen = map.chests.length;
  const failed = Object.entries(map.failed).filter(([, f]) => now - f.at < (f.ms || FAILED_MS)).slice(-3).map(([k, f]) => `(${k.replaceAll(',', ', ')}): ${f.why}`);
  if (failed.length) out.waysFailed = failed;
  return out;
}

module.exports = { look, plan, mapSays, mapOf, noteSpawners, SPAWNER_REACH, gapTo, crossing, crossings, crossingSays, lavaLevel, stepsTo, standing, reach, floorAt, keyOf, parse, FLOORS, FAILED_MS };
