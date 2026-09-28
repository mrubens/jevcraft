'use strict';
const { move } = require('./motion');
// A blaze spawner keeps six in the air at once, and walking into that room
// burned the bot to a crisp twice. Players fight a spawner from a doorway:
// a one-wide tunnel dug into the rock, the shield up, and every blaze that
// comes round the corner is cut down within a sword's reach while the rest
// have no line of sight. Code digs the bunker, holds it and picks up the
// rods; the sword and shield rhythm is the ordinary defence.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { threats } = require('./danger');
const { defendNearby, raiseShield, lowerShield, defenseWeapon } = require('./combat');
const { countOf, equipBestTool } = require('./skills');
const { checkAir } = require('./vitals');

const SWARM = 3;
const DEPTH = 3;
const HOLD_MS = 120000;
const QUIET_MS = 20000;
// Fortress brick counts: the live run stood inside a fortress and reported
// "no rock to dig a bunker into", because the only rock around was the
// fortress itself.
const NATURAL = /^(netherrack|soul_sand|soul_soil|basalt|blackstone|nether_wart_block|warped_wart_block|crimson_nylium|warped_nylium|magma_block|nether_quartz_ore|nether_gold_ore|gravel|stone|dirt|deepslate|andesite|diorite|granite|tuff|nether_bricks|red_nether_bricks|nether_brick_stairs|nether_brick_slab)$/;
const solid = b => b?.boundingBox === 'block';
const passable = b => !b || b.boundingBox === 'empty';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

function blazes(bot, radius = 24) {
  return threats(bot, radius).filter(t => t.entity.name === 'blaze');
}
const swarm = (bot, radius = 24) => blazes(bot, radius).length >= SWARM;

// A cell of rock the bunker may open: no lava or water beside it or
// above it (tunneling.js safeExcavation, the rule every tunnel digs by).
// mid-244-ab dug its bunker's head cell under a lava fall in the Nether,
// the lava came down into the tunnel faster than a body swims in it, and
// the bot burned from twenty health in five seconds (note 569).
const safeToOpen = (bot, p) => require('./tunneling').safeExcavation(bot, p);
const liquidNear = (bot, p) => {
  for (const f of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = bot.blockAt(p.offset(...f));
    if (b && /^(lava|water)$/.test(b.name)) return { name: b.name, at: p.offset(...f) };
  }
  return null;
};

// Why a side's DEPTH cells will not do for the bunker, or null when they
// will: each at feet and head height natural rock on a solid floor, and
// none with lava or water behind it.
function sideRefused(bot, feet, side) {
  for (let d = 1; d <= DEPTH; d++) {
    const cell = feet.plus(side.scaled(d));
    for (const p of [cell, cell.offset(0, 1, 0)]) {
      const b = bot.blockAt(p);
      if (!solid(b) || !NATURAL.test(b.name) || !b.diggable) return { rock: false };
    }
    if (!solid(bot.blockAt(cell.offset(0, -1, 0)))) return { rock: false };
    for (const p of [cell, cell.offset(0, 1, 0)]) {
      if (!safeToOpen(bot, p)) return { rock: true, at: p, block: bot.blockAt(p).name, liquid: liquidNear(bot, p) || { name: 'lava or water', at: null } };
    }
  }
  return null;
}

const awayFirst = (feet, from) => {
  const away = SIDES.filter(s => !from || (s.x * (from.x - feet.x) + s.z * (from.z - feet.z)) <= 0);
  return [...away, ...SIDES.filter(s => !away.includes(s))];
};

// A side whose next DEPTH cells at feet and head height are natural rock
// on solid floor with nothing liquid behind them, facing away from the
// blazes: the bunker goes there.
function bunkerSide(bot, feet, from) {
  for (const side of awayFirst(feet, from)) if (!sideRefused(bot, feet, side)) return side;
  return null;
}

// The walls of rock beside `feet` left undug for the liquid behind them,
// said: "lava behind the netherrack at (-4, 40, 233)".
function liquidBehind(bot, feet, from) {
  const out = [];
  for (const side of awayFirst(feet, from)) {
    const r = sideRefused(bot, feet, side);
    if (r?.rock) out.push(`${r.liquid.name} behind the ${r.block.replaceAll('_', ' ')} at (${r.at.x}, ${r.at.y}, ${r.at.z})`);
  }
  return out;
}

// Open the adjacent cell toward `from` when something diggable stands in
// it. Live, the bot sat in a pocket it had dug beside a fortress corridor
// with a nether brick fence between it and the blazes, and every fifteen
// seconds it built more cover on its own side of the fence. A door, not a
// wall.
const DOORWAY = /nether_brick|fence|netherrack|blackstone|basalt/;
// `spare` is cover the bot itself raised, which a door must not dig out:
// both rules pick the same cell, one step toward the mob, so a wall went up,
// the blazes dropped out of sight, and fifteen seconds later the door rule
// dug it out and put them back in view.
async function openToward(bot, task, from, { spare = [] } = {}) {
  if (!from) return false;
  const here = bot.entity.position.floored();
  const dx = from.x - here.x, dz = from.z - here.z;
  const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
  const cell = here.plus(step);
  let opened = false;
  for (const p of [cell.offset(0, 1, 0), cell]) {
    const block = bot.blockAt(p);
    if (!block || passable(block) || !block.diggable || !DOORWAY.test(block.name) || spare.includes(`${p}`)) continue;
    task.check();
    await digCell(bot, task, p); opened = true;
  }
  return opened;
}

// One step to the side at the end of the tunnel. A straight shaft is a
// shooting gallery along its own axis: anything lined up with it can see
// all the way to the back, which is how the first bunker took fireballs at
// the far end and brought no rods home. Around a corner there is no line
// from outside at all, so a blaze that wants to see the bot has to come in
// and turn it, arriving inside a sword's reach.
function cornerCell(bot, inside, side) {
  const turns = SIDES.filter(s => s.x * side.x + s.z * side.z === 0);
  for (const turn of turns) {
    const cell = inside.plus(turn);
    const diggable = p => { const b = bot.blockAt(p); return solid(b) && NATURAL.test(b.name) && b.diggable && safeToOpen(bot, p); };
    if (diggable(cell) && diggable(cell.offset(0, 1, 0)) && solid(bot.blockAt(cell.offset(0, -1, 0)))) return cell;
  }
  return null;
}

async function digCell(bot, task, p) {
  const block = bot.blockAt(p);
  if (passable(block)) return;
  await equipBestTool(bot, block); task.check();
  await bot.dig(block, true);
}

async function stepTo(bot, task, cell) {
  const centre = cell.offset(0.5, 0, 0.5);
  return move(bot, task, { label: 'bunker_step', keys: ['forward'], sneak: false, why: 'into a cell just dug in rock: no edge, and a fight is on', look: centre.offset(0, 1.6, 0), maxMs: 2000, tick: 40,
    until: () => Math.hypot(bot.entity.position.x - centre.x, bot.entity.position.z - centre.z) < 0.35 });
}

// Dig DEPTH cells into the wall and stand at the far end facing out.
// The middle of a group, so the bunker is dug away from all of it rather
// than away from whichever one happens to be nearest.
function centroid(threats) {
  if (!threats.length) return null;
  return threats.reduce((total, t) => total.plus(t.entity.position), new Vec3(0, 0, 0)).scaled(1 / threats.length);
}

// The rock face to back into: a stand cell beside natural rock, as far from
// the threats as the search allows. In the middle of a room `bunkerSide`
// finds nothing adjacent, so the branch never fired and the herd drill
// stayed in the open and died.
function wallStands(bot, from, { distance = 16, count = 512 } = {}) {
  const ids = (bot.registry?.blocksArray || []).filter(b => NATURAL.test(b.name)).map(b => b.id);
  if (!ids.length) return [];
  const here = bot.entity.position, feet = here.floored();
  const stands = new Map();
  for (const p of bot.findBlocks({ matching: ids, maxDistance: distance, count })) {
    // A wall, not the floor. Every block in the room's floor is natural
    // rock and every one of them is nearer than the walls, so an unfiltered
    // search returned five hundred floor tiles and no wall: the bot stood
    // in the open being shot and reported that there was no rock to dig
    // into, in a room made of rock.
    if (p.y !== feet.y) continue;
    for (const side of SIDES) {
      const cell = p.plus(side);
      if (!passable(bot.blockAt(cell)) || !passable(bot.blockAt(cell.offset(0, 1, 0))) || !solid(bot.blockAt(cell.offset(0, -1, 0)))) continue;
      const key = `${cell}`;
      if (stands.has(key)) continue;
      // Facing into the rock, and the rock between the bot and the threats.
      const into = cell.minus(p);
      const away = from ? (cell.x - from.x) * into.x + (cell.z - from.z) * into.z : 1;
      stands.set(key, { cell, score: cell.distanceTo(here) + (away > 0 ? 0 : 8) });
    }
  }
  return [...stands.values()].sort((a, b) => a.score - b.score).map(s => s.cell);
}

// Close enough that walking there is cheaper than being shot on the way.
// Crossing nine blocks of open ground to reach a wall cost the arena's
// blaze pair forty-one health against twenty-six for simply fighting where
// it stood: a doorway is worth having, not worth travelling for.
const WALK_TO_WALL = 5;
function nearWall(bot, from, { within = WALK_TO_WALL, dug = null } = {}) {
  if (inBunker(bot, dug)) return true;
  if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  const here = bot.entity.position;
  return wallStands(bot, from, { distance: within + 2 }).some(cell => cell.distanceTo(here) <= within);
}

// How long the bunker would take to dig with the best tool carried, walk to
// the wall included: from where the bot stands, or the nearest wall stand.
// Rebuilding its kit after a death, the dream run dug one with a stone
// pickaxe for fifteen seconds under two skeletons' arrows and died at the
// doorway (2026-09-23 23:16).
function bunkerDigMs(bot, from, { dug = null } = {}) {
  if (inBunker(bot, dug)) return 0;
  let feet = bot.entity.position.floored(), side = bunkerSide(bot, feet, from), ms = 0;
  if (!side) {
    const stand = wallStands(bot, from, { distance: WALK_TO_WALL + 2 }).find(c => c.distanceTo(bot.entity.position) <= WALK_TO_WALL);
    if (!stand) return Infinity;
    feet = stand; side = bunkerSide(bot, feet, from);
    if (!side) return Infinity;
    ms += feet.distanceTo(bot.entity.position) * 250;
  }
  for (let d = 1; d <= DEPTH; d++) {
    const cell = feet.plus(side.scaled(d));
    for (const p of [cell, cell.offset(0, 1, 0)]) { const b = bot.blockAt(p); if (solid(b)) ms += blockDigMs(bot, b); }
  }
  return ms;
}

// The game's own time to dig a block with the best tool carried for it.
function blockDigMs(bot, b) {
  if (typeof b.digTime !== 'function') return 750;
  const tool = require('./skills').cheapestTool(bot, b);
  return b.digTime(tool ? tool.type : null, false, false, false, [], {});
}
// What it is dug with, said: "an iron pickaxe", or "by hand".
function digsWith(bot, b) {
  const tool = b && typeof b.digTime === 'function' ? require('./skills').cheapestTool(bot, b) : null;
  return tool ? `with the ${tool.name.replaceAll('_', ' ')}` : 'by hand';
}

// Out of a shooter's line: none of the points a standing player is hit at
// (head, middle, feet, as threats() looks at a mob) is in a straight line
// from its eye (the game's eye height, 0.85 of its height). `open`, blocks
// still to be dug, counted dug.
const BODY = [1.6, 0.9, 0.15];
const eyeOf = e => e.position.offset(0, (e.height || 1.8) * 0.85, 0);
function seenFrom(bot, shooters, cell, { open = null } = {}) {
  const { lineClear } = require('./danger');
  return shooters.filter(e => e.position && BODY.some(dy => lineClear(bot, eyeOf(e), cell.offset(0.5, dy, 0.5), { open })));
}
const inSight = (bot, shooters, cell, opts) => shooters.some(e => seenFrom(bot, [e], cell, opts).length);

// The nearest cell a walk reaches, within `steps` blocks of walking, that
// no shooter's line reaches: a corner of rock, a pillar, a side passage, the
// tunnel the bot came by. A player under arrows steps out of their line
// before anything else. A walk passes no cell beside a mob that bites.
const standable = (bot, c) => { const f = bot.blockAt(c), h = bot.blockAt(c.offset(0, 1, 0)), u = bot.blockAt(c.offset(0, -1, 0));
  return passable(f) && passable(h) && !/lava|water|fire/.test(`${f?.name} ${h?.name}`) && solid(u) && !/magma|campfire/.test(u.name || ''); };
// `skip`: cells not to end on (a walk to them just failed), still walked through.
function coverWithin(bot, shooters, { steps = 8, avoid = [], skip = () => false } = {}) {
  const feet = bot.entity.position.floored();
  const near = c => avoid.some(e => e.position && Math.hypot(e.position.x - (c.x + 0.5), e.position.z - (c.z + 0.5)) < 1.5 && Math.abs(e.position.y - c.y) < 2);
  const seen = new Set([`${feet}`]);
  let ring = [feet];
  for (let n = 0; n <= steps && ring.length; n++) {
    const hidden = ring.filter(c => !skip(c) && !inSight(bot, shooters, c));
    if (hidden.length) return { cell: hidden.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0], steps: n };
    const next = [];
    for (const c of ring) for (const s of SIDES) for (const dy of [0, 1, -1]) {
      const to = c.plus(s).offset(0, dy, 0), key = `${to}`;
      if (seen.has(key)) continue;
      // A step up wants the head room over where it steps from.
      if (dy === 1 && !passable(bot.blockAt(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && !passable(bot.blockAt(c.plus(s).offset(0, 1, 0)))) continue;
      if (!standable(bot, to) || near(to)) continue;
      seen.add(key); next.push(to);
    }
    ring = next;
  }
  return null;
}

// A shooter out of its line walks on to one. The game's bow goal (26.1
// RangedBowAttackGoal) paths toward its target while it cannot see it, and
// keeps to that path when it gives the target up (the goal runs on while
// its navigation is not done, and stopping does not stop the walk); where
// the path first has a line, it looks and shoots, the bow drawn in twenty
// ticks. mid-242-y, told "about 1 damage" out of a skeleton's line three
// blocks off, was shot as it went; then it dug an L that the skeleton
// walked into, and was shot from the turn at arm's length (note 522).
// How fast: combat-estimate's blocksPerSecond, from the jar (a skeleton
// about 2.7 blocks a second, a pillager 5.3, where a player walks 4.3).
// A ghast drifts and does not follow a path; a blaze flies at it (below).
const { blocksPerSecond } = require('./combat-estimate');
const FLIERS = new Set(['blaze', 'breeze']);
const DRAW_SECONDS = 1;
// The seconds until `shooter` has a line to `cell` again by walking its way
// toward it, the draw included, and the blocks walked: null when it has
// none within `within` seconds of walking (or it does not follow a path).
// `open` counts cells still to be dug as dug; `cache` is shared between
// calls made of one moment.
function lineRegained(bot, shooter, cell, { open = null, within = 15, cache = new Map() } = {}) {
  if (!shooter?.position || shooter.name === 'ghast') return null;
  const speed = blocksPerSecond(shooter.name), flies = FLIERS.has(shooter.name);
  const height = shooter.height || 1.8, tall = Math.max(1, Math.ceil(height - 1e-6));
  const clear = p => { const k = `${p}`; if (open?.has(k)) return true; if (!cache.has(k)) { const b = bot.blockAt(p); cache.set(k, !!b && b.boundingBox === 'empty' && !/lava/.test(b.name)); } return cache.get(k); };
  const floor = p => !open?.has(`${p}`) && bot.blockAt(p)?.boundingBox === 'block';
  const room = p => { for (let dy = 0; dy < tall; dy++) if (!clear(p.offset(0, dy, 0))) return false; return true; };
  const stand = p => room(p) && (flies || floor(p.offset(0, -1, 0)));
  const sees = p => BODY.some(dy => require('./danger').lineClear(bot, p.offset(0.5, height * 0.85, 0.5), cell.offset(0.5, dy, 0.5), { open }));
  const start = shooter.position.floored(), goal = cell;
  const maxBlocks = Math.max(0, within - DRAW_SECONDS) * speed;
  // A* to the cell the bot stands in, the way the game's pathfinder goes;
  // then along it to the first cell with a line.
  const key = p => `${p.x},${p.y},${p.z}`;
  const h = p => Math.hypot(p.x - goal.x, p.y - goal.y, p.z - goal.z);
  // A binary heap on f.
  const heap = [];
  const push = node => { heap.push(node); for (let i = heap.length - 1; i > 0;) { const j = (i - 1) >> 1; if (heap[j].f <= heap[i].f) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  push({ p: start, g: 0, f: h(start) });
  const came = new Map([[key(start), null]]), best = new Map([[key(start), 0]]);
  const goalStands = stand(goal);
  let reached = null, n = 0;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length && n++ < 3000) {
    const { p, g } = pop();
    if (g > (best.get(key(p)) ?? Infinity)) continue;
    if (p.equals(goal) || (!goalStands && p.y === goal.y && Math.abs(p.x - goal.x) + Math.abs(p.z - goal.z) === 1)) { reached = p; break; }
    const next = [];
    for (const [dx, dz] of DIRS) {
      // A corner is not cut: both cells beside a diagonal step are open.
      if (dx && dz && !(room(p.offset(dx, 0, 0)) && room(p.offset(0, 0, dz)))) continue;
      for (const dy of flies ? [0, 1, -1] : [0, 1, -1, -2, -3]) {
        const to = p.offset(dx, dy, dz);
        if (dy > 0 && !clear(p.offset(0, tall, 0))) continue;
        if (dy < 0 && ![...Array(-dy).keys()].every(k => room(p.offset(dx, -k, dz)))) continue;
        if (stand(to)) { next.push([to, Math.hypot(dx, dz)]); break; }
      }
    }
    if (flies) for (const dy of [1, -1]) { const to = p.offset(0, dy, 0); if (room(to)) next.push([to, 1]); }
    for (const [to, step] of next) {
      const g2 = g + step, k = key(to);
      if (g2 > maxBlocks + 2 || g2 >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g2); came.set(k, p); push({ p: to, g: g2, f: g2 + h(to) });
    }
  }
  if (!reached) return null;
  const path = [];
  for (let p = reached; p; p = came.get(key(p))) path.unshift(p);
  let walked = 0;
  for (let i = 0; i < path.length; i++) {
    if (i) walked += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (walked > maxBlocks) return null;
    if (sees(path[i])) return { blocks: Math.round(walked * 10) / 10, seconds: Math.round((walked / speed + DRAW_SECONDS) * 10) / 10, at: path[i] };
  }
  return null;
}

// An L dug into the rock, in two and turned one, whose end no shooter's
// line reaches: the doorway a player digs under arrows. Anything that
// wants the bot comes to the mouth and round the turn, one at a time,
// within a sword's reach. From where the bot stands or a wall stand within
// a short walk; the seconds are the game's dig times with the tool carried.
function nookSite(bot, shooters, { within = WALK_TO_WALL } = {}) {
  const { safeExcavation } = require('./tunneling');
  const here = bot.entity.position, feet = here.floored();
  const from = shooters.length ? shooters.reduce((t, e) => t.plus(e.position), new Vec3(0, 0, 0)).scaled(1 / shooters.length) : null;
  const stands = [feet, ...wallStands(bot, from, { distance: within + 2 }).filter(c => c.distanceTo(here) <= within && !c.equals(feet))];
  const rock = p => { const b = bot.blockAt(p); return solid(b) && NATURAL.test(b.name) && b.diggable !== false && safeExcavation(bot, p); };
  let best = null;
  for (const stand of stands) {
    const walkMs = stand.equals(feet) ? 0 : stand.distanceTo(here) * 250;
    for (const side of SIDES) for (const turn of SIDES.filter(t => t.x * side.x + t.z * side.z === 0)) {
      const cells = [stand.plus(side), stand.plus(side.scaled(2)), stand.plus(side.scaled(2)).plus(turn)];
      if (!cells.every(c => rock(c) && rock(c.offset(0, 1, 0)) && solid(bot.blockAt(c.offset(0, -1, 0))))) continue;
      const end = cells[2];
      const open = new Set(cells.flatMap(c => [`${c}`, `${c.offset(0, 1, 0)}`]));
      if (inSight(bot, shooters, end, { open })) continue;
      const blocks = cells.flatMap(c => [bot.blockAt(c), bot.blockAt(c.offset(0, 1, 0))]);
      const ms = walkMs + blocks.reduce((n, b) => n + blockDigMs(bot, b), 0);
      if (!best || ms < best.ms) best = { stand, side, turn, cells, end, mouth: cells[0], watch: cells[1], blocks: blocks.length, digMs: ms - walkMs, walkMs, ms, with: digsWith(bot, blocks[0]) };
    }
  }
  return best;
}

// Dig the nook found and step round its turn.
async function digNook(bot, task, site, { navigate = null } = {}) {
  if (!bot.entity.position.floored().equals(site.stand)) {
    if (!navigate) return null;
    await navigate(bot, task, new goals.GoalBlock(site.stand.x, site.stand.y, site.stand.z), { timeoutMs: Math.max(4000, site.walkMs * 3), stallMs: 1500 });
    if (!bot.entity.position.floored().equals(site.stand)) return null;
  }
  for (const cell of site.cells) {
    task.check(); checkAir(bot);
    await digCell(bot, task, cell.offset(0, 1, 0)); await digCell(bot, task, cell);
    if (!await stepTo(bot, task, cell)) return null;
  }
  return site;
}

async function reachWall(bot, task, from, navigate) {
  if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  if (!navigate) return false;
  for (const cell of wallStands(bot, from).slice(0, 4)) {
    task.check();
    try { await navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; continue; }
    if (bunkerSide(bot, bot.entity.position.floored(), from)) return true;
  }
  return false;
}

// The cells a bunker dug (the tunnel and its turn), and whether the bot
// stands in one of them: a bunker is dug once. The held stance ran the dig
// again from wherever the last one ended, and mid-244-ab dug four of them
// end to end, twelve blocks into the rock in ten seconds, the last under a
// lava fall (note 569).
const DUG_MS = 5 * 60000;
function inBunker(bot, dug, now = Date.now()) {
  if (!dug?.cells?.length || now - (dug.at || 0) > DUG_MS) return false;
  if (dug.dimension && String(dug.dimension) !== String(bot.game?.dimension || '')) return false;
  const f = bot.entity.position.floored();
  return dug.cells.some(c => c.x === f.x && c.y === f.y && c.z === f.z);
}
const record = (bot, bunker, cells) => ({ ...bunker, cells: cells.map(c => ({ x: c.x, y: c.y, z: c.z })), at: Date.now(), dimension: String(bot.game?.dimension || '') });

async function digBunker(bot, task, goal, save, { from = null, navigate = null, dug = null } = {}) {
  // In the bunker already: back to its inside, facing the door, and no more
  // digging.
  if (inBunker(bot, dug)) {
    const inside = new Vec3(dug.inside.x, dug.inside.y, dug.inside.z), watch = new Vec3(dug.watch.x, dug.watch.y, dug.watch.z);
    if (!bot.entity.position.floored().equals(inside)) await stepTo(bot, task, inside);
    await bot.lookAt?.(watch.offset(0.5, 1.2, 0.5), true);
    return { ...dug, mouth: new Vec3(dug.mouth.x, dug.mouth.y, dug.mouth.z), inside, watch, held: true };
  }
  const centre = from || centroid(blazes(bot));
  await reachWall(bot, task, centre, navigate);
  const feet = bot.entity.position.floored();
  const side = bunkerSide(bot, feet, centre);
  if (!side) throw new Error('No rock to dig a bunker into here');
  goal.step = { action: 'dig_bunker', side: { x: side.x, z: side.z }, depth: DEPTH }; save();
  const cells = [feet];
  // Each cell looked at again as it is reached: what was seen from the
  // stand is what the dig finds only while nothing has flowed meanwhile.
  const unsafe = p => { const b = bot.blockAt(p); return !passable(b) && !safeToOpen(bot, p); };
  let reached = 0;
  for (let d = 1; d <= DEPTH; d++) {
    task.check(); checkAir(bot);
    const cell = feet.plus(side.scaled(d));
    const bad = [cell.offset(0, 1, 0), cell].find(unsafe);
    if (bad) {
      const liquid = liquidNear(bot, bad);
      if (reached) break;
      throw new Error(`${liquid ? liquid.name[0].toUpperCase() + liquid.name.slice(1) : 'Lava or water'} behind the rock at (${bad.x}, ${bad.y}, ${bad.z}): the bunker is not dug there`);
    }
    await digCell(bot, task, cell.offset(0, 1, 0)); await digCell(bot, task, cell);
    if (!await stepTo(bot, task, cell)) throw new Error('Could not step into the bunker');
    cells.push(cell); reached = d;
  }
  const mouth = feet.plus(side), end = feet.plus(side.scaled(reached));
  // The turn, when the rock allows one. Without it the bunker is a corridor
  // with the bot at one end and the shooters at the other.
  const corner = reached === DEPTH ? cornerCell(bot, end, side) : null;
  if (corner) {
    task.check(); checkAir(bot);
    await digCell(bot, task, corner.offset(0, 1, 0)); await digCell(bot, task, corner);
    if (await stepTo(bot, task, corner)) {
      goal.step = { action: 'dig_bunker', side: { x: side.x, z: side.z }, depth: DEPTH, turned: true }; save();
      return record(bot, { mouth, inside: corner, watch: end, side, turned: true }, [...cells, corner]);
    }
  }
  return record(bot, { mouth, inside: end, watch: mouth, side, turned: false }, cells);
}

// The steps a stand writes while it is dug, held and its rods picked up.
// Left standing after the stand ends, they said "hold bunker" for eleven
// minutes on mid-242-ab-nether-3 (note 585): the hold was stopped by a
// fireball ten seconds in, the pocket and the meal had the turn, and every
// question after read the stale hold as a wait the bot had chosen, so none
// of them was ever held as coming to nothing, and the work's option said
// "go on with the work: hold bunker".
const STAND_STEPS = new Set(['dig_bunker', 'hold_bunker', 'collect_rods', 'dig_in_and_fight']);
async function keepingStep(goal, save, run) {
  const before = goal.step;
  try { return await run(); }
  finally {
    if (goal.step !== before && STAND_STEPS.has(goal.step?.action)) {
      if (before && !STAND_STEPS.has(before.action)) goal.step = before; else delete goal.step;
      save?.();
    }
  }
}

// Hold the bunker: shield up, strike whatever comes within reach, until
// the rods are in hand, the blazes have gone quiet, or the hold runs out.
// `stats`, when given, is filled with what the hold met: its seconds, the
// most blazes in sight at once, the swings, the kills and why it ended.
// A hold is a wait for blazes to come to the sword; what came of each is
// said on the next stands offered from about here (blaze-stand.js
// holdsSays).
async function holdBunker(bot, task, goal, save, bunker, { item = 'blaze_rod', want = 1, stats = null } = {}) {
  const started = Date.now(); let lastSeen = Date.now(), kills = 0;
  const onDeath = entity => { if (entity?.name === 'blaze') kills++; };
  bot.on('entityDead', onDeath);
  const sword = defenseWeapon(bot);
  const met = stats || {};
  Object.assign(met, { seconds: 0, mostInSight: 0, swings: 0, kills: 0, ended: 'time' });
  try {
    if (sword && bot.heldItem?.name !== sword.name) await bot.equip(sword, 'hand');
    const watch = bunker.watch || bunker.mouth;
    await bot.lookAt(watch.offset(0.5, 1.2, 0.5), true);
    raiseShield(bot);
    while (Date.now() - started < HOLD_MS) {
      task.check(); checkAir(bot);
      if (countOf(bot, item) >= want) { met.ended = 'rod'; break; }
      if ((bot.health ?? 20) < 8) { met.ended = 'hurt'; throw new Error('Too hurt to hold the bunker'); }
      const near = blazes(bot, 20);
      if (near.length) lastSeen = Date.now();
      else if (Date.now() - lastSeen > QUIET_MS) { met.ended = 'quiet'; break; }
      met.mostInSight = Math.max(met.mostInSight, near.filter(t => t.visible).length);
      goal.step = { action: 'hold_bunker', blazes: near.length, kills, health: bot.health, held: Math.round((Date.now() - started) / 1000) }; save();
      const swung = await defendNearby(bot, task, goal, save);
      if (swung) met.swings++;
      if (!swung) {
        // Back in place and facing the door between swings.
        const p = bot.entity.position, c = bunker.inside.offset(0.5, 0, 0.5);
        if (Math.hypot(p.x - c.x, p.z - c.z) > 0.6) { lowerShield(bot); await stepTo(bot, task, bunker.inside); }
        await bot.lookAt((bunker.watch || bunker.mouth).offset(0.5, 1.2, 0.5), true);
        raiseShield(bot);
        await sleep(150);
      }
    }
  } catch (err) { if (met.ended === 'time') met.ended = err?.name === 'NeedsSafety' ? 'stopped for the survival layer' : String(err?.message || err).slice(0, 80); throw err; }
  finally { lowerShield(bot); bot.removeListener('entityDead', onDeath); met.seconds = Math.round((Date.now() - started) / 1000); met.kills = kills; }
  return kills;
}

// Rods that fell at the door are collected when no blaze has a line of
// sight; the walk out is short and the bunker is behind.
async function collectRods(bot, task, goal, save, bunker, actions, item = 'blaze_rod') {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    task.check();
    if (blazes(bot, 16).some(t => t.visible)) { await sleep(500); continue; }
    const drop = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(bunker.mouth) < 10)
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!drop) return;
    const before = countOf(bot, item), d = drop.position.floored();
    goal.step = { action: 'collect_rods', position: { x: d.x, y: d.y, z: d.z } }; save();
    try { await actions.navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 0.5), { timeoutMs: 6000, stallMs: 2500, stopWhen: () => countOf(bot, item) > before || bot.entities[drop.id] !== drop }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return; }
    await sleep(300);
    try { await actions.navigate(bot, task, new goals.GoalBlock(bunker.inside.x, bunker.inside.y, bunker.inside.z), { timeoutMs: 6000, stallMs: 2500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
}

// One bunker fight: dig, hold, collect. Returns the rods gained.
async function bunkerFight(bot, task, goal, save, actions, { item = 'blaze_rod', want = 1 } = {}) {
  return keepingStep(goal, save, async () => {
    const before = countOf(bot, item);
    const state = goal.mobHunt ||= {};
    const bunker = await digBunker(bot, task, goal, save, { navigate: actions.navigate });
    state.bunker = { mouth: { ...bunker.mouth }, inside: { ...bunker.inside }, at: Date.now() }; save();
    bot.chat?.('Too many blazes to face in the open. Digging in beside them and taking them at the door.');
    const stats = {};
    const kills = await holdBunker(bot, task, goal, save, bunker, { item, want, stats });
    await collectRods(bot, task, goal, save, bunker, actions, item);
    const gained = countOf(bot, item) - before;
    state.bunkerResults = [...(state.bunkerResults || []), { at: new Date().toISOString(), kills, gained, health: bot.health }].slice(-12);
    state.standResults = [...(state.standResults || []), { at: new Date().toISOString(), kind: 'bunker', place: { x: bunker.inside.x, y: bunker.inside.y, z: bunker.inside.z }, ...stats, kills, gained, health: bot.health }].slice(-12); save();
    return gained;
  });
}

// A wall where the bot stands, when there is no wall to walk to. Two blocks
// one step toward the shooters and the line is broken: the same doorway the
// bunker digs, built rather than found. The pair drill spent its health
// standing in the open waiting for health to come back, which it cannot do
// while the thing that took it is still looking.
const COVER = new Set(['netherrack', 'cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'andesite', 'diorite', 'granite', 'blackstone', 'basalt', 'nether_bricks']);
async function raiseCover(bot, task, from) {
  const material = bot.inventory.items().find(item => COVER.has(item.name));
  if (!material || !from) return false;
  const here = bot.entity.position.floored();
  const dx = from.x - here.x, dz = from.z - here.z;
  const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
  const cell = here.plus(step), floor = bot.blockAt(cell.offset(0, -1, 0));
  if (!solid(floor) || !passable(bot.blockAt(cell)) || !passable(bot.blockAt(cell.offset(0, 1, 0)))) return false;
  await bot.equip(material, 'hand');
  task.check();
  await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
  await bot.placeBlock(floor, new Vec3(0, 1, 0));
  const lower = bot.blockAt(cell);
  if (solid(lower)) {
    task.check();
    await bot.lookAt(cell.offset(0.5, 1.5, 0.5), true);
    await bot.placeBlock(lower, new Vec3(0, 1, 0));
  }
  // The cell raised, so the caller can keep its own door rule off it.
  return solid(bot.blockAt(cell)) ? cell : false;
}

module.exports = { keepingStep, STAND_STEPS, HOLD_MS, QUIET_MS, inBunker, liquidBehind, sideRefused, blockDigMs, digsWith, seenFrom, lineRegained, DRAW_SECONDS, coverWithin, nookSite, digNook, bunkerDigMs, bunkerFight, digBunker, holdBunker, collectRods, digCell, stepTo, standable, cornerCell, raiseCover, openToward, reachWall, wallStands, nearWall, swarm, blazes, bunkerSide, centroid, NATURAL, WALK_TO_WALL, SWARM };
