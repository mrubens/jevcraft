'use strict';
// A block in a creeper's line. Read from the 26.1.2 server jar: a lit
// creeper's fuse burns on only while its target is within seven blocks and
// in its sight (SwellGoal.tick: Sensing.hasLineOfSight, one ray from the
// creeper's eyes to the target's eyes that any block with a collision shape
// stops, LivingEntity.hasLineOfSight with ClipContext.Block.COLLIDER); out of
// sight it burns back down a tick at a time (Creeper.tick, swell += -1, not
// reset), and it goes off when the swell reaches thirty. Its swell goal
// runs while it is lit or its target is within three blocks, and holds the
// move flag: within three it stands where it is, lit or not, and only past
// three does its melee goal walk it on (priority 4 under the swell's 2).
// So a block where that one ray crosses, between the bot's eyes and the
// creeper's, stops a blast that no weapon carried can (no sword kills a
// whole creeper inside its fuse, note 529), and a creeper within three of
// the bot with the ray blocked stands and does not light. mid-241-a was
// offered only stances that cost more than its health (note 534).
const { Vec3 } = require('vec3');

// Eye heights from the 26.1.2 jar (EntityType eyeHeight); any other mob's
// is the game's default, 0.85 of its height. A shooter fires only with its
// eyes on the bot's (a blaze or ghast's attack goal and a bow's alike ask
// hasLineOfSight), so the same ray is the one cover has to cut (note 541).
const EYE = { player: 1.62, creeper: 1.445, blaze: 1.53, ghast: 2.6, skeleton: 1.74, stray: 1.74, bogged: 1.74, wither_skeleton: 2.1, piglin: 1.79, pillager: 1.62, drowned: 1.74 };
const eyeOf = mob => EYE[mob?.name] ?? (mob?.height ?? 1.7) * 0.85;
// How far a block is placed from the eyes, as place() reaches without a walk.
const REACH = 4.5;

// The cells a straight segment passes through, in order from `a`, each with
// how far along the segment it enters and leaves (Amanatides and Woo).
function lineCells(a, b) {
  const d = b.minus(a), length = d.norm();
  if (!(length > 0)) return [{ cell: a.floored(), enter: 0, exit: 0 }];
  const dir = d.scaled(1 / length);
  const cell = a.floored();
  const step = ['x', 'y', 'z'].map(k => Math.sign(dir[k]));
  const next = ['x', 'y', 'z'].map((k, i) => {
    if (!step[i]) return Infinity;
    const edge = step[i] > 0 ? cell[k] + 1 : cell[k];
    return (edge - a[k]) / dir[k];
  });
  const delta = ['x', 'y', 'z'].map((k, i) => step[i] ? Math.abs(1 / dir[k]) : Infinity);
  const out = [];
  let t = 0;
  const c = [cell.x, cell.y, cell.z];
  for (let n = 0; n < 64; n++) {
    const i = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    const exit = Math.min(next[i], length);
    out.push({ cell: new Vec3(c[0], c[1], c[2]), enter: t, exit });
    if (next[i] >= length) break;
    t = next[i];
    c[i] += step[i];
    next[i] += delta[i];
  }
  return out;
}

// A body's box against a cell.
function bodyIn(e, p, { width = e?.width ?? 0.6, height = e?.height ?? 1.8 } = {}) {
  if (!e?.position) return false;
  const half = width / 2;
  return e.position.x + half > p.x && e.position.x - half < p.x + 1 && e.position.z + half > p.z && e.position.z - half < p.z + 1 && e.position.y + height > p.y && e.position.y < p.y + 1;
}
const stops = b => !!b && b.boundingBox === 'block';
const open = b => !!b && b.boundingBox === 'empty' && !/lava|water/.test(b.name || '');
const FACES = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

// The creeper's eyes to the bot's: the cells between them (neither body's),
// whether a block already stops the ray, and where a block could go.
// { eyes, cells: [{ cell, enter, exit, inside }], stoppedBy: { cell, name } | null }
function sightLine(bot, creeper) {
  const eye = bot.entity.position.offset(0, EYE.player, 0);
  const its = creeper.position.offset(0, eyeOf(creeper), 0);
  const self = { position: bot.entity.position, width: 0.6, height: 1.8 };
  const cells = lineCells(eye, its)
    .filter(c => !bodyIn(self, c.cell) && !bodyIn(creeper, c.cell, { width: creeper.width ?? 0.6, height: creeper.height ?? 1.7 }))
    .map(c => ({ ...c, inside: c.exit - c.enter }));
  const hit = cells.find(c => stops(bot.blockAt(c.cell)));
  return { eyes: eye.distanceTo(its), cells, stoppedBy: hit ? { cell: hit.cell, name: bot.blockAt(hit.cell).name } : null };
}

// Where the blocks go: the cell nearest the bot on the ray that takes a
// block from here (open, no body in it, within reach of the eyes, a face to
// place against), the ray a quarter block or more inside it so a small step
// does not open it again; and beside the bot at its feet or head, the other
// of those two with it, two high as cover from a shooter is (take_cover),
// against the creeper walking on round it. Placed from the bottom up, each
// on a solid face or the one before. The block that cuts the ray is counted
// by its place in that order.
// { cells: [Vec3], cuts: Vec3, cutAfter, stoppedBy } or { why }.
function blockPlan(bot, creeper, { reach = REACH } = {}) {
  const line = sightLine(bot, creeper);
  if (line.stoppedBy) return { stoppedBy: line.stoppedBy, cells: [], why: `the ${line.stoppedBy.name.replaceAll('_', ' ')} at ${line.stoppedBy.cell} is in its line already` };
  const eye = bot.entity.position.offset(0, EYE.player, 0), feet = bot.entity.position.floored();
  const others = Object.values(bot.entities || {}).filter(e => e !== bot.entity && e.position && e.isValid !== false && !/^(item|experience_orb|arrow|spectral_arrow|trident)$/.test(e.name || ''));
  const free = p => open(bot.blockAt(p)) && !others.some(e => bodyIn(e, p)) && !bodyIn({ position: bot.entity.position }, p);
  const inReach = p => eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= reach;
  const anchored = (p, planned = []) => FACES.some(([dx, dy, dz]) => { const q = p.offset(dx, dy, dz); return stops(bot.blockAt(q)) || planned.some(c => c.equals(q)); });
  const tries = line.cells.filter(c => free(c.cell) && inReach(c.cell));
  if (!tries.length) return { cells: [], why: line.cells.length ? 'no cell in its line within reach is open to a block' : 'no cell lies between the bot and it' };
  const pick = tries.find(c => c.inside >= 0.25) || tries[0];
  const cut = pick.cell;
  const beside = Math.abs(cut.x - feet.x) <= 1 && Math.abs(cut.z - feet.z) <= 1 && (cut.x !== feet.x || cut.z !== feet.z) && (cut.y === feet.y || cut.y === feet.y + 1);
  const partner = beside ? cut.offset(0, cut.y === feet.y ? 1 : -1, 0) : null;
  let cells = [cut];
  if (partner && free(partner) && inReach(partner)) cells = [cut, partner].sort((a, b) => a.y - b.y);
  // Over open air at an edge the lowest has no face to go on: the cell
  // under it first, where that one has one, as a player lays a block down
  // the side of a ledge to build up on (note 541).
  const low = cells.slice().sort((a, b) => a.y - b.y)[0], under = low.offset(0, -1, 0);
  if (!anchored(low) && free(under) && inReach(under) && anchored(under)) cells = [under, ...cells];
  cells.sort((a, b) => a.y - b.y);
  // Bottom up, each on a solid face or one already placed; a cell with
  // neither is dropped, and the ray's cell without one is no plan.
  const placed = [];
  for (const c of cells) if (anchored(c, placed)) placed.push(c);
  if (!placed.some(c => c.equals(cut))) return { cells: [], why: `no face to place against at ${cut}, the cell in its line` };
  return { cells: placed, cuts: cut, cutAfter: placed.findIndex(c => c.equals(cut)) + 1, inside: Math.round(pick.inside * 100) / 100, eyes: line.eyes };
}

// Said of the cell that cuts the line, from the bot: "beside the bot at head
// height", "over the bot's head", or so many blocks toward it.
function whereSays(bot, cell) {
  const feet = bot.entity.position.floored();
  const dy = cell.y - feet.y, side = Math.abs(cell.x - feet.x) <= 1 && Math.abs(cell.z - feet.z) <= 1;
  if (cell.x === feet.x && cell.z === feet.z) return dy >= 2 ? `over the bot's head${dy > 2 ? `, ${dy} above its feet` : ''}` : 'under the bot';
  if (side && dy === 1) return 'beside the bot at head height';
  if (side && dy === 0) return 'beside the bot at its feet';
  if (side) return `beside the bot, ${dy > 0 ? `${dy} above` : `${-dy} below`} its feet`;
  const d = Math.round(bot.entity.position.offset(0, EYE.player, 0).distanceTo(cell.offset(0.5, 0.5, 0.5)) * 10) / 10;
  return `${d} blocks from the bot's eyes toward it, ${dy >= 0 ? `${dy} above` : `${-dy} below`} its feet`;
}

// Where a creeper out past three blocks goes once a block is in its line.
// Read from the 26.1.2 jar: its melee goal (MeleeAttackGoal, made with
// followingTargetEvenIfNotSeen false) keeps to the path it has while it
// does not see the bot, and a second after that path ends makes a new one
// to the bot's cell (canUse: createPath, a twenty-tick cooldown, no sight
// asked); the swell goal takes the move from it the tick the creeper comes
// within three blocks (feet to feet, distanceToSqr under 9), sight or not,
// and it stands there. So it walks round the block toward the bot and
// stops at the first point of its way within three: in sight there it
// lights with its whole fuse; out of sight it stands and does not. Out of
// its sight sixty ticks on end, it forgets the bot (TargetGoal, mustSee,
// unseenMemoryTicks 60) until it sees it again within sixteen. mid-243-aa's
// creeper walked round each block put in its line at three to four blocks,
// every second or two, and came in on the side left open (note 547).
// `planned` cells count as solid. { within, at, blocks, seconds, distance,
// sees } or { noWay: true }.
function creeperWalk(bot, creeper, { planned = [], radius = 3, limit = 16 } = {}) {
  const { blocksPerSecond } = require('./combat-estimate');
  const here = bot.entity.position, goal = here.floored();
  const solidAt = new Set(planned.map(p => `${p}`));
  const collides = p => solidAt.has(`${p}`) || stops(bot.blockAt(p));
  const clear = p => !collides(p) && !/lava/.test(bot.blockAt(p)?.name || '');
  const tall = Math.max(1, Math.ceil((creeper.height ?? 1.7) - 1e-6));
  const room = p => { for (let dy = 0; dy < tall; dy++) if (!clear(p.offset(0, dy, 0))) return false; return true; };
  const stand = p => room(p) && collides(p.offset(0, -1, 0));
  const eyeUp = eyeOf(creeper), botEye = here.offset(0, EYE.player, 0);
  const seesFrom = at => !lineCells(at.offset(0, eyeUp, 0), botEye).some(c => collides(c.cell));
  const speed = blocksPerSecond('creeper');
  const r1 = n => Math.round(n * 10) / 10;
  const now = creeper.position.distanceTo(here);
  if (now < radius) return { within: true, at: creeper.position, blocks: 0, seconds: 0, distance: r1(now), sees: seesFrom(creeper.position) };
  // A* to the bot's cell, the way the game's pathfinder goes (the same
  // steps as bunker.js lineRegained: no corner cut, up one, down three).
  const key = p => `${p.x},${p.y},${p.z}`;
  const h = p => Math.hypot(p.x - goal.x, p.y - goal.y, p.z - goal.z);
  const heap = [];
  const push = node => { heap.push(node); for (let i = heap.length - 1; i > 0;) { const j = (i - 1) >> 1; if (heap[j].f <= heap[i].f) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const start = creeper.position.floored();
  push({ p: start, g: 0, f: h(start) });
  const came = new Map([[key(start), null]]), best = new Map([[key(start), 0]]);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let reached = null, n = 0;
  while (heap.length && n++ < 3000) {
    const { p, g } = pop();
    if (g > (best.get(key(p)) ?? Infinity)) continue;
    if (p.equals(goal)) { reached = p; break; }
    for (const [dx, dz] of DIRS) {
      if (dx && dz && !(room(p.offset(dx, 0, 0)) && room(p.offset(0, 0, dz)))) continue;
      for (const dy of [0, 1, -1, -2, -3]) {
        const to = p.offset(dx, dy, dz);
        if (Math.abs(to.x - goal.x) > limit || Math.abs(to.z - goal.z) > limit || Math.abs(to.y - goal.y) > 6) break;
        if (dy > 0 && !clear(p.offset(0, tall, 0))) continue;
        if (dy < 0 && ![...Array(-dy).keys()].every(k => room(p.offset(dx, -k, dz)))) continue;
        if (!(to.equals(goal) ? room(to) : stand(to))) continue;
        const g2 = g + Math.hypot(dx, dz) + (dy > 0 ? 0.5 : 0), k = key(to);
        if (g2 < (best.get(k) ?? Infinity)) { best.set(k, g2); came.set(k, p); push({ p: to, g: g2, f: g2 + h(to) }); }
        break;
      }
    }
  }
  if (!reached) return { noWay: true };
  // Along its way, from where it stands through the middles of the cells,
  // to the first point within `radius` of the bot's feet.
  const path = [];
  for (let p = reached; p; p = came.get(key(p))) path.unshift(p);
  const points = [creeper.position, ...path.slice(1, -1).map(p => p.offset(0.5, 0, 0.5)), here];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = a.distanceTo(b);
    for (let s = 0; s <= len; s += 0.1) {
      const at = a.plus(b.minus(a).scaled(len ? s / len : 0));
      if (at.distanceTo(here) < radius) {
        const blocks = walked + s;
        return { within: false, at, blocks: r1(blocks), seconds: r1(blocks / speed), distance: r1(at.distanceTo(here)), sees: seesFrom(at) };
      }
    }
    walked += len;
  }
  return { noWay: true };
}

module.exports = { lineCells, sightLine, blockPlan, whereSays, creeperWalk, eyeOf, EYE, REACH };
