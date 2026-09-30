'use strict';
const { Vec3 } = require('vec3');
const { move } = require('./motion');

const { TOOL_TIERS } = require('./plan');
const { checkAir, needsAir, NeedsAir, digWithAirGuard } = require('./vitals');

/** Best pickaxe tier carried: 0 bare hands, 1 wooden, 2 stone, 3 iron, ... */
// Durability left on the best pickaxe carried, for the question a careful
// player asks before going down: will this tool get me back out?
function pickaxeDurability(bot) {
  let best = 0;
  for (const item of bot.inventory.items()) {
    if (!/_pickaxe$/.test(item.name)) continue;
    const maximum = bot.registry?.itemsByName?.[item.name]?.maxDurability;
    best = Math.max(best, maximum ? maximum - (item.durabilityUsed || 0) : Infinity);
  }
  return best;
}

function pickaxeTier(bot) {
  let best = 0;
  for (const item of bot.inventory.items()) {
    const m = /^(\w+)_pickaxe$/.exec(item.name);
    const maximum = bot.registry?.itemsByName?.[item.name]?.maxDurability;
    if (m && (!maximum || maximum - (item.durabilityUsed || 0) >= 8)) best = Math.max(best, TOOL_TIERS.indexOf(m[1]) + 1);
  }
  return best;
}

/** How many of `item` the bot holds. */
function countOf(bot, item) {
  return bot.inventory.items().filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
}

// ---------------------------------------------------------------------------
// Task lifetime and travel: the primitives every other module builds on.
//
// No model is consulted in this file. Jev decides *which* work runs and with
// what arguments; from here on it is ordinary, inspectable game code, so a
// wrong judgment produces a wrong-but-safe action rather than unpredictable
// behaviour. Everything long-running checks `task.cancelled` between steps so
// "stop" always lands promptly.
//
// The verbs themselves (gathering, crafting, building, survival) live in
// work.js, survival.js and their neighbours, which own the recipe arithmetic
// and the verification against observed inventory and world state.
// ---------------------------------------------------------------------------

class Task {
  constructor(label, description) {
    this.label = label;
    this.description = description;
    this.cancelled = false;
    this.startedAt = Date.now();
  }
  describe() {
    return this.cancelled ? 'idle' : this.description;
  }
  cancel() {
    this.cancelled = true;
  }
  /** Throws if the task was cancelled, unwinding whatever skill is running. */
  check() {
    if (this.cancelled) throw new Cancelled(this.label);
    // A stall raised by the supervisor (stillness.js) unwinds the step like
    // a cancellation, until the loop has answered it.
    this.stallCheck?.();
    this.interruptCheck?.();
  }
}

class Cancelled extends Error {
  constructor(label) {
    super(`task cancelled: ${label}`);
    this.name = 'Cancelled';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// getPathTo returns only the first 40 ms slice, even when a larger timeout is
// supplied. A partial result is an unfinished search, not proof of no route.
async function surveyRoute(bot, task, movements, goal, timeoutMs = 500) {
  task.check(); checkAir(bot);
  if (require('./flight').canFly(bot)) return require('./flight').surveyFlight(bot, task, goal, { timeoutMs });
  if (!bot.pathfinder.getPathFromTo) return withLava(bot, bot.pathfinder.getPathTo(movements, goal, timeoutMs));
  const deadline = Date.now() + timeoutMs;
  let last;
  for (const { result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal,
    { timeout: timeoutMs, tickTimeout: Math.min(20, timeoutMs) })) {
    task.check(); checkAir(bot); last = result;
    if (result.status !== 'partial') return withLava(bot, result);
    if (Date.now() >= deadline) return withLava(bot, { ...result, status: 'timeout' });
    await sleep(0); // Let physics, new mob observations and cancellation run.
  }
  return withLava(bot, last || { status: 'noPath', path: [] });
}
// A route surveyed in the Nether carries how many of its cells have lava
// round them and how many have it a block to a side (movement.js
// lavaAlong), for the question that offers the walk to say (note 660).
function withLava(bot, route) {
  if (!route?.path?.length || route.lava) return route;
  const lava = require('./movement').lavaAlong(bot, route.path);
  return lava ? Object.assign(route, { lava }) : route;
}

class NavigationCorrectionLoop extends Error {
  // Where, how many and over how long, for the recovery that asks the server
  // what is there (server-truth.js) and for the facts said after it.
  constructor({ position = null, count = null, seconds = null } = {}) {
    super('Repeated server movement corrections at the same position');
    Object.assign(this, { position, count, seconds });
  }
}
class NavigationStall extends Error {
  constructor() { super('navigation timed out without reaching new ground'); }
}

// A saved position can already overlap a wall by floating-point precision.
// Walk inward on the same inspected floor cell, or recenter in existing water.
// Never rewrite position/onGround, excavate an escape or extend the deadline.
async function recoverNavigation(bot, task, deadline, stopWhen) {
  const start = bot.entity.position.clone();
  const cell = start.floored();
  const floor = bot.blockAt?.(cell.offset(0, -1, 0));
  const fullFloor = floor?.shapes?.some(s => s.length === 6 && s.every((v, i) => v === [0, 0, 0, 1, 1, 1][i]));
  const swimming = bot.entity.isInWater && require('./terrain').swimmableWater(bot.blockAt?.(cell));
  const clear = p => { const b = bot.blockAt?.(p); return b && b.shapes?.length === 0 &&
    !['lava', 'fire', 'soul_fire', 'powder_snow', 'sweet_berry_bush', 'cobweb'].includes(b.name) && (swimming || b.name !== 'water'); };
  if (bot.entity.isInLava || (!swimming && (start.y - cell.y > 0.05 || !fullFloor ||
    ['magma_block', 'cactus'].includes(floor?.name) || bot.pathfinder.movements?.blocksToAvoid?.has(floor?.type))) ||
    !clear(cell) || !clear(cell.offset(0, 1, 0))) return false;
  const target = cell.offset(0.5, 0, 0.5);
  const distance = () => Math.hypot(bot.entity.position.x - target.x, bot.entity.position.z - target.z);
  const until = Math.min(deadline, Date.now() + 1500);
  bot.clearControlStates();
  try {
    while (Date.now() < until) {
      task.check(); checkAir(bot);
      if (stopWhen?.()) return true;
      const current = bot.entity.position, currentCell = current.floored();
      if (currentCell.x !== cell.x || currentCell.z !== cell.z ||
        (swimming ? current.y < start.y - 0.5 || current.y > start.y + 1 : currentCell.y !== cell.y)) return false;
      if (distance() <= 0.15 && (swimming || bot.entity.onGround)) return true;
      await bot.lookAt(target.offset(0, 1.62, 0), true);
      bot.setControlState('sneak', !swimming);
      bot.setControlState('jump', swimming && current.y < start.y - 0.05);
      bot.setControlState('forward', distance() > 0.1);
      await sleep(50);
    }
    return false;
  } finally {
    bot.clearControlStates();
    bot.emit?.('navigation_recovery', { from: start, position: { ...bot.entity.position }, onGround: bot.entity.onGround, swimming: !!swimming });
  }
}

// The last resort before a stall is declared: what a person does when a bot
// looks frozen. It escalates, cheapest and least destructive first, and stops
// the moment the position actually changes:
//   1. clear soft natural blocks pressing on the body, then jump and step in
//      each direction;
//   2. break any natural block at body height in a direction, stone included,
//      slow as that is by hand, and step through;
//   3. dig the block underfoot when there is solid ground a short drop below.
// What it never does: touch a block that belongs to a build (reserved for
// construction, or manufactured: planks, glass, doors, chests and the like),
// open a way toward lava, fire or a long fall, or dig into liquid. Giving up
// is not on the list; the caller decides that, and it should not either.
const SOFT = new Set(['short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'vine', 'snow', 'leaf_litter', 'seagrass', 'tall_seagrass',
  'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'gravel', 'sand', 'red_sand', 'clay', 'moss_block', 'moss_carpet', 'mud']);
const HAZARD = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'cactus', 'sweet_berry_bush', 'powder_snow']);
const LIQUID = new Set(['water', 'lava', 'bubble_column']);
const MANUFACTURED = /planks|brick|glass|concrete|wool|carpet|door|trapdoor|chest|barrel|furnace|smoker|crafting_table|_bed$|stairs|slab|fence|wall$|torch|lantern|sign|bookshelf|quartz|terracotta|shulker|anvil|hopper|rail|piston|redstone|observer|dispenser|dropper|cauldron|composter|loom|stonecutter|grindstone|smithing|bell|beacon|obsidian/;
const softOrLeaves = block => !!block && (SOFT.has(block.name) || /_leaves$/.test(block.name));
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function breakable(bot, block, { natural = false } = {}) {
  if (!block || block.boundingBox !== 'block' || LIQUID.has(block.name) || HAZARD.has(block.name)) return false;
  if (block.name === 'bedrock' || block.diggable === false || MANUFACTURED.test(block.name)) return false;
  if (bot._constructionProtection?.(block) > 0) return false;
  if (natural && !softOrLeaves(block) && !/^(stone|deepslate|cobblestone|andesite|diorite|granite|tuff|calcite|sandstone|red_sandstone|netherrack|basalt|blackstone|end_stone|ice|packed_ice|.*_ore|.*_log|.*_wood|mushroom_stem|.*_mushroom_block)$/.test(block.name)) return false;
  // Never open a wall onto liquid.
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const neighbour = bot.blockAt?.(block.position.offset(dx, dy, dz));
    if (neighbour && LIQUID.has(neighbour.name)) return false;
  }
  return bot.canDigBlock?.(block) !== false;
}

async function shakeLoose(bot, task, deadline, { random = Math.random, settleMs = 700, budgetMs = 25000, guard } = {}) {
  const start = bot.entity.position.clone(), cell = start.floored();
  const at = (dx, dy, dz) => bot.blockAt?.(cell.offset(dx, dy, dz));
  const moved = () => bot.entity.position.distanceTo(start) >= 1;
  const cleared = [];
  const until = Math.min(deadline, Date.now() + budgetMs);
  // A dig underwater takes five times as long and the fifth death was a
  // lake floor dug by hand with no air check inside the dig. Submerged,
  // there is nothing to dig: swim up. Otherwise every dig watches the air.
  const submerged = () => [at(0, 0, 0), at(0, 1, 0)].some(b => b && LIQUID.has(b.name));
  if (submerged()) {
    await move(bot, task, { label: 'swim_up', keys: ['jump'], sneak: false, maxMs: Math.max(0, until - Date.now()), tick: 100,
      guard: () => { checkAir(bot); guard?.(); }, until: () => !submerged() });
    return { stage: 'surface', cleared: [] };
  }
  const dig = async block => {
    task.check(); checkAir(bot); guard?.();
    if (submerged()) throw new NeedsAir();
    await digWithAirGuard(bot, task, block); cleared.push(block.name);
  };
  const safeToward = (dx, dz) => {
    const ahead = [at(dx, 0, dz), at(dx, 1, dz)], below = [at(dx, -1, dz), at(dx, -2, dz), at(dx, -3, dz), at(dx, -4, dz)];
    if ([...ahead, ...below].some(b => b && (HAZARD.has(b.name) || b.name === 'lava'))) return false;
    // Nor a step off onto ground where the body stands in lava: the lava
    // sea's soul sand shore, level with the sea (note 580).
    const floor = below.findIndex(b => b && b.boundingBox === 'block');
    if (floor < 0) return false;
    const { standsInLava } = require('./terrain');
    if (standsInLava(p => bot.blockAt?.(new Vec3(p.x, p.y, p.z)), cell.offset(dx, -floor, dz))) return false;
    return !(floor === 0 && runsIntoLava(dx, dz));
  };
  // Nor a step whose run past its cell falls into lava: the step is held
  // until the body has moved a block and goes on a little after. On 25600
  // (mid-243-af-fortress-2) the step south ran on off a ledge thirty-eight
  // blocks over the lava sea (note 600).
  const runsIntoLava = (dx, dz) => {
    const past = cell.offset(2 * dx, 0, 2 * dz);
    if (![past, past.offset(0, 1, 0)].every(c => bot.blockAt?.(c)?.boundingBox === 'empty')) return false;
    const { fallFrom, atOf } = require('./terrain');
    return fallFrom(atOf(bot), past.offset(0, -1, 0)).into === 'lava';
  };
  const step = async (dx, dz) => {
    // Through the held-key helper (motion.js): upright, it refuses a drop
    // into lava ahead at any depth, and it keeps to the two cells.
    const { within } = require('./motion');
    // Every wait watches the air: sand dug from over the head in a desert
    // fell into its place, and trial 9's bot suffocated here for twelve
    // seconds while the loop watched only for mobs (2026-09-24).
    try {
      await move(bot, task, { label: 'shake_loose_step', keys: ['forward', 'jump'], sneak: false, why: 'a blind step out of being wedged', look: cell.offset(dx + 0.5, 1.62, dz + 0.5),
        maxMs: settleMs, tick: 50, until: moved, guard: () => { checkAir(bot); guard?.(); within(bot, [cell, cell.offset(dx, 0, dz)], 'the blind step')(); } });
    } catch (err) { if (!/^Left the cells/.test(err.message)) throw err; }
    bot.clearControlStates?.();
    return moved();
  };
  let stage = 0;
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  try {
    const order = DIRECTIONS.map(d => ({ d, r: random() })).sort((a, b) => a.r - b.r).map(({ d }) => d);
    // Stage 1: soft blocks on the body, then a jump and a step each way.
    stage = 1;
    // Not a block with sand or gravel over it: the column comes down into
    // the hole, onto the head.
    const falls = (dx, dy, dz) => /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/.test(at(dx, dy + 1, dz)?.name || '');
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, 0], [0, 2, 0]]) { const b = at(dx, dy, dz); if (softOrLeaves(b) && breakable(bot, b) && !(dy >= 1 && falls(dx, dy, dz))) await dig(b); }
    for (const [dx, dz] of order) {
      if (Date.now() >= until) break;
      task.check(); checkAir(bot);
      if (!safeToward(dx, dz)) continue;
      for (const b of [at(dx, 0, dz), at(dx, 1, dz)]) if (softOrLeaves(b) && breakable(bot, b)) await dig(b);
      if (await step(dx, dz)) return true;
    }
    // Stage 2: any natural block at body height, stone included.
    stage = 2;
    for (const [dx, dz] of order) {
      if (Date.now() >= until) break;
      task.check(); checkAir(bot);
      if (!safeToward(dx, dz)) continue;
      const wall = [at(dx, 0, dz), at(dx, 1, dz)].filter(b => b?.boundingBox === 'block');
      if (!wall.length || !wall.every(b => breakable(bot, b, { natural: true }))) continue;
      for (const b of wall) await dig(b);
      if (await step(dx, dz)) return true;
    }
    // Stage 3: down, when there is solid ground a short drop below the floor.
    stage = 3;
    const floor = at(0, -1, 0);
    if (Date.now() < until && breakable(bot, floor, { natural: true })) {
      const under = [at(0, -2, 0), at(0, -3, 0), at(0, -4, 0)];
      if (!under.some(b => b && (HAZARD.has(b.name) || LIQUID.has(b.name))) && under.some(b => b?.boundingBox === 'block')) {
        await dig(floor);
        const end = Date.now() + 2000;
        while (Date.now() < end && !moved()) { await sleep(50); task.check(); }
        if (moved()) return true;
      }
    }
    return false;
  } finally {
    bot.clearControlStates?.();
    bot.emit?.('navigation_recovery', { mode: 'shake_loose', stage, from: start, position: { ...bot.entity.position }, cleared, moved: moved() });
  }
}

/** Move somewhere, aborting cleanly if the task is cancelled mid-path. */
// `sprint` is for long trips over open ground (exploring, a walk to a
// remembered place, home): a third faster, at about a hunger point every
// forty blocks, so only while hunger is above fourteen. Everything else
// walks: sprinting into a fight spoils the swing, and along a ledge it is
// a longer fall.
const SPRINT_FOOD = 14;
// The pathfinder calls isValid and hasChanged on its goal every tick, and a
// goal without them threw inside the physics tick and took the process down
// (the dream run, 2026-09-23 02:06, "stateGoal.isValid is not a function").
// A goal is made whole where it is handed to the pathfinder (session.js
// wraps setGoal) and the caller named, so the next one is found.
function wholeGoal(goal) {
  if (!goal || (typeof goal.isValid === 'function' && typeof goal.hasChanged === 'function' && typeof goal.isEnd === 'function')) return goal;
  console.log(`[bug] the pathfinder was given an incomplete goal ${JSON.stringify(goal).slice(0, 160)}\n${new Error().stack.split('\n').slice(2, 7).join('\n')}`);
  if (typeof goal.isEnd !== 'function' && [goal.x, goal.y, goal.z].every(Number.isFinite)) return new (require('mineflayer-pathfinder').goals.GoalBlock)(Math.floor(goal.x), Math.floor(goal.y), Math.floor(goal.z));
  // Not a destination at all (a motion spec was one): refused, so the walk
  // fails as an ordinary error instead of crashing the next physics tick.
  if (typeof goal.isEnd !== 'function' || typeof goal.heuristic !== 'function') throw new Error('Not a pathfinder goal');
  if (typeof goal.isValid !== 'function') goal.isValid = () => true;
  if (typeof goal.hasChanged !== 'function') goal.hasChanged = () => false;
  return goal;
}

// Every dig goes through one check (terrain.js digExposes): a block the
// bot stands on or beside is not dug where that opens the body to lava
// flowing in, a fall into lava, or a floor of gravel or sand dropped into
// it. Each dig had its own rules or none (the unstuck move, the mine, the
// bunker, the bridge, the pathfinder's own), and on 2026-09-28 four of the
// fortress cohort's eight deaths were the bot's own dig or step into lava
// (note 600). Refused, the dig throws and says why; the caller's failure
// path takes it from there.
function digGuardPlugin(bot) {
  const dig = bot.dig;
  if (typeof dig !== 'function' || dig._guarded) return;
  const guarded = function (block, ...rest) {
    const p = bot.entity?.position, cell = block?.position;
    let why = null;
    try { why = p && cell ? require('./terrain').digExposes(require('./terrain').atOf(bot), p, cell, { health: bot.health ?? 20 }) : null; } catch (_) { why = null; }
    if (why) {
      const err = Object.assign(new Error(`Not dug: the ${String(block.name || 'block').replaceAll('_', ' ')} at (${cell.x}, ${cell.y}, ${cell.z}): ${why}`), { name: 'DigRefused' });
      console.log(`[dig] ${err.message}`);
      try { bot.emit?.('dig_refused', { block: block.name, at: { x: cell.x, y: cell.y, z: cell.z }, why }); } catch (_) { /* the log has it */ }
      return Promise.reject(err);
    }
    return dig.call(this ?? bot, block, ...rest);
  };
  guarded._guarded = true;
  bot.dig = guarded;
}

function goalGuardPlugin(bot) {
  const setGoal = bot.pathfinder?.setGoal;
  if (!setGoal) { console.log('[bug] goal guard: no pathfinder to guard; load it after the pathfinder'); return; }
  // A block the pathfinder lays level with its floor is laid from where the
  // bot stands, not from the edge it backs out to first (its
  // LOSWhenPlacingBlocks, on by default). With that on, each such block
  // leaves the bot a place to return to (returningPos), and until it
  // stands there the pathfinder does nothing else: no route is searched
  // for any goal given after, and nothing clears it but getting there
  // (mineflayer-pathfinder 2.4.5, resetPath and setGoal leave it). A push,
  // a pillar or a block laid in that cell and the bot can never get
  // there: every walk after stands still pressing forward, for as long as
  // the process lives. mid-242-ah-nether-2-fortress-5 laid a block at
  // 17:32:16 and stood on the cell it was to return to; its out_of_sight
  // and four retreats in the next 45 seconds each stood three seconds
  // where they began, looking down at its feet, while a ghast's fireballs
  // took it from 20 health to none (note 621). The server takes a block
  // put against a face the bot does not see; the edge was for servers
  // that check.
  bot.pathfinder.LOSWhenPlacingBlocks = false;
  bot.pathfinder.setGoal = (goal, dynamic) => setGoal.call(bot.pathfinder, wholeGoal(goal), dynamic);
}

// `onFoot`: the walk digs nothing and lays nothing (no tower, no bridge):
// along a fortress's corridors, not through its walls (mob-hunt.js, note
// 557). What it cannot walk to is said as no route.
//
// `passing`: the walk looks for gold (and diamonds, iron, lapis while short)
// as it goes, mines what it finds and walks on to the same goal (note 653,
// opportunistic-mining.js mineInPassing). The stop for it is not the walk's
// end: a walk that stopped for gold was booked by its caller as a walk that
// came no nearer, and the fortress patrol marked the floor it was going to
// as failed. The detour's time is added to the walk's.
// Where walks have stalled, remembered: a spot the walks stall at again and
// again is a bad step, and the next walk is routed round it where the ground
// allows (a cost on the cells about it, not a wall: with no other way, it is
// still walked). 25589 (mid-243-jg, 2026-09-30) stalled at the same climb,
// (22-23, 77-80, -3 to -4), on five round trips between its lava and its
// frame, 12:59:38 to 13:06:06Z, each stall the watchdog's eight seconds or
// more and a recovery (note 753b). Kept on the bot, by dimension; a spot is
// forgotten after STALL_SPOT_MS.
const SCOOPED_COST = 1000, STALL_SPOT_MS = 15 * 60000, STALL_SPOT_NEAR = 3, STALL_SPOT_TIMES = 2, STALL_SPOT_COST = 40;
function noteStallSpot(bot, position, now = Date.now()) {
  if (!position) return null;
  const dim = String(bot.game?.dimension || 'overworld'), cell = new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
  const spots = (bot._stallSpots ||= []).filter(s => now - s.last < STALL_SPOT_MS);
  let spot = spots.find(s => s.dim === dim && Math.hypot(s.x - cell.x, s.y - cell.y, s.z - cell.z) <= STALL_SPOT_NEAR);
  if (spot) { spot.n++; spot.last = now; }
  else { spot = { dim, x: cell.x, y: cell.y, z: cell.z, n: 1, first: now, last: now }; spots.push(spot); }
  bot._stallSpots = spots.slice(-32);
  if (spot.n === STALL_SPOT_TIMES) console.log(`[stall-spot] walks have stalled ${spot.n} times at (${spot.x}, ${spot.y}, ${spot.z}); the next walks go round it where they can`);
  return spot;
}
// The spots stalled at often enough to route round, in this dimension, not
// within four blocks of where the walk is going (the goal itself is not
// avoided).
function badSteps(bot, goal, now = Date.now()) {
  const dim = String(bot.game?.dimension || 'overworld'), there = goalPoint(goal);
  return (bot._stallSpots || []).filter(s => s.dim === dim && s.n >= STALL_SPOT_TIMES && now - s.last < STALL_SPOT_MS &&
    !(there && Math.hypot(s.x - there.x, s.y - there.y, s.z - there.z) <= 4));
}

async function navigate(bot, task, goal, { timeoutMs = 90000, stallMs = 15000, stopWhen, sprint = false, shore = false, besideLava, edgeTaken, onFoot = false, passing = false } = {}) {
  task.check();
  const look = passing && bot._goal && bot.pathfinder?.movements ? passingLook(bot, task) : null;
  if (look) return look.walk(timeoutMs, timeout => navigate(bot, task, goal, { timeoutMs: timeout, stallMs, stopWhen: () => stopWhen?.() || look.due(), sprint, shore, besideLava, edgeTaken, onFoot }), stopWhen);
  // Where the bot is going, kept for the shore rule (shore.js): out of the
  // water on the side it was heading for, not back where it went in.
  if (!shore && Number.isFinite(goal?.x) && Number.isFinite(goal?.z)) bot._heading = { x: goal.x, z: goal.z, at: Date.now() };
  if (require('./flight').canFly(bot)) return require('./flight').flyNavigate(bot, task, goal, { timeoutMs, stallMs, stopWhen });
  // A stopped trip can leave our empty boat underfoot. Clear only that owned
  // boat before player physics attempts to walk through its solid hull.
  if (bot._ownedBoats?.size && !bot.vehicle) await require('./boats').clearOwnedBoatAtFeet(bot, task);
  // Hanging by an edge over a fall that kills or costs half the health,
  // back onto the footing before the pathfinder lets the crouch go (note
  // 622, motion.js footingFirst).
  if (bot.pathfinder && require('./motion').fallUnder(bot)) await require('./motion').footingFirst(bot);
  const movements = bot.pathfinder?.movements, sprinting = sprint && (bot.food ?? 20) > SPRINT_FOOD && !!movements;
  const walked = sprinting ? movements.allowSprinting : undefined;
  if (sprinting) movements.allowSprinting = true;
  // The cells a walk has chosen to take beside lava in the Nether, by name
  // (movement.js besideLavaRefused, note 516); none otherwise.
  const optOut = besideLava && movements, lavaOptOut = optOut ? movements.besideLava : undefined;
  if (optOut) movements.besideLava = besideLava;
  // The cells beside a deadly edge an escape was offered along (movement.js
  // besideLavaRefused, note 610).
  const edgeOptOut = edgeTaken && movements, edgeWas = edgeOptOut ? movements.edgeTaken : undefined;
  if (edgeOptOut) movements.edgeTaken = edgeTaken;
  const foot = onFoot && movements ? { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, scafoldingBlocks: movements.scafoldingBlocks } : null;
  if (foot) Object.assign(movements, { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
  // Off a top the walk cannot step down from, the way down first: asked of
  // Jev and carried out (way-down.js, note 565). Still on one after, the
  // walk builds no tower: from a top a tower only climbs higher. A block
  // laid level is the fall rule's (overFall) and a span Jev's, as before.
  const wayDown = require('./way-down');
  if (movements && !stopWhen?.()) await wayDown.comeDownFirst(bot, task, goal);
  const perch = movements && !foot ? wayDown.livePerch(bot) : null;
  const stillUp = perch && !wayDown.goalOnTop(goal, perch) ? { allow1by1towers: movements.allow1by1towers } : null;
  if (stillUp) movements.allow1by1towers = false;
  // Round a bad step remembered (noteStallSpot): the cells within a block of
  // it cost more to step into.
  const bad = movements ? badSteps(bot, goal) : [];
  // And a lava source just scooped: the cell and those beside it at the
  // pool's level are not stepped into for twenty seconds, the flow comes
  // back into them. 25584 (mid-244-gc, 2026-09-30 15:21:15-17Z) filled a
  // bucket from (162, 19, 95), and the walk on stepped down into the pool
  // at (162, 18, 96): 20 health to 9.4 (note 753c).
  const scooped = (bot._scoopedLava || []).filter(e => Date.now() - e.at < 20000);
  if (movements && scooped.length) bad.push(...scooped.map(e => ({ x: e.x, y: e.y, z: e.z, lava: true })));
  const hadAreas = bad.length && Object.hasOwn(movements, 'exclusionAreasStep'), areasWere = bad.length ? movements.exclusionAreasStep : undefined;
  if (bad.length) movements.exclusionAreasStep = [...(areasWere || []), block => {
    const near = bad.filter(s => Math.abs(block.position.x - s.x) <= 1 && Math.abs(block.position.y - s.y) <= 1 && Math.abs(block.position.z - s.z) <= 1);
    return near.some(s => s.lava && block.position.y === s.y) ? SCOOPED_COST : near.some(s => !s.lava) ? STALL_SPOT_COST : 0;
  }];
  // The goal's height, for the climb rule (movement.js climbOverFall).
  const hadGoalY = !!movements && Object.hasOwn(movements, 'walkGoalY'), walkGoalY = hadGoalY ? movements.walkGoalY : undefined;
  if (movements) movements.walkGoalY = goalPoint(goal)?.y;
  const deadline = Date.now() + timeoutMs;
  try {
    let asked = 0;
    for (let attempt = 0; ; attempt++) {
      task.check(); checkAir(bot);
      if (stopWhen?.()) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('navigation timed out');
      try { return await navigateAttempt(bot, task, goal, { timeoutMs: remaining, stallMs, stopWhen }); }
      catch (err) {
        // The server keeps putting the body back: this client's view of the
        // blocks round it is wrong somewhere (a block it dug that the server
        // did not break, note 632). Ask the server what is there and walk
        // again with what it says; a body pressed against a wall (the
        // recovery below) is the case where it says nothing differs.
        if (err instanceof NavigationCorrectionLoop && bot.serverTruth && asked < 3) {
          asked++;
          bot.serverTruth.noteLoop({ position: err.position || bot.entity.position, count: err.count, seconds: err.seconds });
          const reply = await bot.serverTruth.resyncAround(task, { loop: err });
          if (reply.corrected.length) { attempt--; continue; }
          const rest = reply.asked ? `the server was asked about ${reply.asked} blocks round the body and its answers matched the view` : 'the server could not be asked what the blocks round the body are';
          err.facts = `${err.count} corrections in ${Math.max(1, Math.round(err.seconds || 0))} s; ${rest}`;
        }
        if (!(err instanceof NavigationCorrectionLoop || err instanceof NavigationStall) || attempt > 0 ||
          !await recoverNavigation(bot, task, deadline, stopWhen)) throw err;
      }
    }
  } finally {
    if (sprinting) movements.allowSprinting = walked;
    if (optOut) movements.besideLava = lavaOptOut;
    if (edgeOptOut) movements.edgeTaken = edgeWas;
    if (foot) Object.assign(movements, foot);
    if (stillUp) Object.assign(movements, stillUp);
    if (hadGoalY) movements.walkGoalY = walkGoalY;
    else if (movements) delete movements.walkGoalY;
    if (bad.length) { if (hadAreas) movements.exclusionAreasStep = areasWere; else delete movements.exclusionAreasStep; }
  }
}

// The look in passing around one walk: the walk runs with a stop for gold
// in reach; stopped for it (and not for the caller's own stop), the detour
// is taken and the walk runs again, its time given back the detour's
// seconds, up to eight detours.
const PASSING_DETOURS = 8;
function passingLook(bot, task) {
  const mining = require('./opportunistic-mining'), goal = bot._goal, save = bot._goalSave || (() => {});
  const client = task.opportunityClient || null;
  let stopped = false;
  return {
    // Once seen, the stop holds for the rest of that run: the look is
    // throttled, and a throttled look is not a look that found nothing.
    due: () => { if (!stopped && mining.goldInPassing(bot, goal, Date.now(), { client: !!client })) stopped = true; return stopped; },
    async walk(timeoutMs, run, callerStop) {
      let deadline = Date.now() + timeoutMs;
      for (let detours = 0; ; detours++) {
        stopped = false;
        const result = await run(Math.max(1, deadline - Date.now()));
        if (!stopped || callerStop?.() || detours >= PASSING_DETOURS) return result;
        const began = Date.now();
        await mining.mineInPassing(bot, task, goal, save, { navigate, dig: require('./work').dig }, client);
        task.check();
        deadline += Date.now() - began;
      }
    },
  };
}

// Where a goal is, when it has a place: a block or near-a-point goal, or
// the entity it follows.
function goalPoint(goal) {
  if (goal?.entity?.position) return goal.entity.position;
  if ([goal?.x, goal?.y, goal?.z].every(Number.isFinite)) return new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
  return null;
}

// Where a goal with no height is, on the ground.
function flatGoalPoint(goal) {
  if (goal?.entity || Number.isFinite(goal?.y) || !Number.isFinite(goal?.x) || !Number.isFinite(goal?.z)) return null;
  return { x: goal.x + 0.5, z: goal.z + 0.5 };
}

// No route to `goal`, said with where to and why, when the Nether's edge
// rule refused cells on the way: the stall question names it, and a
// crossing is Jev's to choose (note 516). Which of the lava rule's two facts
// refused it (movement.js besideLavaRefused, note 660): a touch that is
// death, or a push.
function noRoute(bot, goal, status) {
  const destination = goal && Number.isFinite(goal.x) && Number.isFinite(goal.z) ? { x: goal.x, ...(Number.isFinite(goal.y) ? { y: goal.y } : {}), z: goal.z } : null;
  const to = destination ? `(${destination.x}, ${Number.isFinite(destination.y) ? `${destination.y}, ` : ''}${destination.z})` : 'the destination';
  const refused = bot.pathfinder?.movements || {};
  const lavaFor = refused.lavaRefusedFor || {}, lavaWhy = [lavaFor.touch && 'where a touch of it is death at this health', lavaFor.push && 'in line with something that can push the bot'].filter(Boolean).join(', and ');
  const lava = refused.lavaRefusals > 0 ? `: the way passes beside lava${lavaWhy ? ` ${lavaWhy}` : ''}` : refused.edgeRefusals > 0 ? ': the way passes along a drop that would kill' : '';
  return Object.assign(new Error(`No route from here to ${to} (${status})${lava}`), { name: 'NoRoute', destination, besideLava: refused.lavaRefusals > 0 });
}

async function navigateAttempt(bot, task, goal, { timeoutMs, stallMs, stopWhen }) {
  task.check(); checkAir(bot);
  if (stopWhen?.()) return;
  const doorUse = require('./doors').guardNavigationDoors(bot, task, goal);
  let timer;
  let acquired = false;
  let corrections = [];
  let latestRoute;
  let routeLength = null, routeNodes = null;
  const observedRoute = route => {
    if (Array.isArray(route.path) && route.status !== 'noPath') { routeLength = route.path.length; routeNodes = route.path.map(p => ({ x: p.x, y: p.y, z: p.z })); }
    latestRoute = { status: route.status, path: (route.path || []).slice(0, 12).map(p => ({
      x: p.x, y: p.y, z: p.z, toBreak: p.toBreak, toPlace: p.toPlace,
    })) };
  };
  const corrected = () => {
    const now = Date.now(), p = bot.entity.position;
    corrections = corrections.filter(c => now - c.at < 2000 && p.distanceTo(c.position) < 0.25);
    corrections.push({ at: now, position: p.clone() });
  };
  bot.on?.('forcedMove', corrected);
  bot.on?.('path_update', observedRoute);
  for (const k of ['lavaRefusals', 'edgeRefusals']) if (bot.pathfinder?.movements?.[k]) bot.pathfinder.movements[k] = 0;
  if (bot.pathfinder?.movements?.lavaRefusedFor) bot.pathfinder.movements.lavaRefusedFor = {};
  // Crouched along a deadly edge in the Nether, as a player walks a ridge
  // over the lava: a crouching body cannot step off an edge. Not before a
  // step down the path means to take. mid-229-h walked a one-wide netherrack
  // ridge five blocks over a lava lake upright, slid off it with nothing
  // pushing, and burned from twenty to none (2026-09-27). Crouched too on a
  // cell with lava round it, which the walk takes at its cost (movement.js
  // besideLavaRefused, note 660): at the edge of a lava pool the crouch
  // holds the body on its floor, and beside lava at the feet it walks at a
  // third of the pace, drifting less off the middle of the cell.
  let edgeCrouch = false;
  const crouchOnEdge = () => {
    try {
      // Crouched too while Jev chose to work quietly by sculk: walking
      // crouched sets off no sensor (sculk.js, work.js sculkStep).
      const quiet = (bot._quietUntil || 0) > Date.now(), nether = /nether/.test(String(bot.game?.dimension || ''));
      if (!quiet && !nether && !edgeCrouch) return;
      if (!bot.entity?.onGround) return;
      // The cell over the block stood on: on soul sand (its top at .875)
      // the floored feet are the soul sand's own cell, and every drop was
      // measured a block too high (note 580).
      const at = bot.entity.position, feet = new Vec3(Math.floor(at.x), Math.ceil(at.y - 1e-4), Math.floor(at.z));
      let deadly = false, down = false;
      if (nether) {
        const drop = require('./terrain').dropNear(bot, feet, 1);
        deadly = !!drop && (drop.into === 'lava' || drop.damage >= (bot.health ?? 20) / 2) ||
          require('./movement').lavaRound((x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name, feet).cells.length > 0;
        const next = latestRoute?.path?.find(n => Math.hypot(n.x - feet.x - 0.5, n.z - feet.z - 0.5) > 0.4);
        down = next && next.y < feet.y;
      }
      const want = quiet || (deadly && !down);
      const held = !!bot.controlState?.sneak;
      if (want && !held) { bot.setControlState?.('sneak', true); edgeCrouch = true; }
      else if (!want && edgeCrouch && held) { bot.setControlState?.('sneak', false); edgeCrouch = false; }
    } catch (_) { /* no world here */ }
  };
  bot.on?.('physicsTick', crouchOnEdge);
  const watchdog = new Promise((resolve, reject) => {
    const started = Date.now();
    let lastProgress = started;
    let previous = bot.entity.position.clone();
    const visited = new Set([`${previous.floored()}`]);
    let bestRoute = null, bestNear = null;
    timer = setInterval(() => {
      try { task.check(); if (doorUse.error) throw doorUse.error; }
      catch (err) {
        reject(err); bot.pathfinder.setGoal(null); bot.stopDigging?.(); bot.clearControlStates?.(); return;
      }
      if (stopWhen?.()) {
        acquired = true;
        resolve();
        bot.pathfinder.setGoal(null); bot.stopDigging?.(); bot.clearControlStates?.();
        return;
      }
      if (needsAir(bot)) {
        reject(new NeedsAir());
        bot.pathfinder.setGoal(null);
        bot.stopDigging?.();
        bot.clearControlStates?.();
        return;
      }
      // Progress is getting nearer: a new shortest route left, or a new
      // nearest to a goal with a place. New cells alone were progress, and
      // first-days-206's retreat bounced up and down its own shaft for
      // fourteen seconds, every bounce a new cell, shot from 10.8 health to
      // 4.8 before the timeout (2026-09-26). New cells still count for a
      // goal with neither.
      // A goal with no height (GoalNearXZ, GoalXZ: the fortress search's
      // legs, the way to a landmark) is got nearer to along the ground.
      // Measured by neither, a walk toward one counted progress only when
      // the pathfinder searched again and found a shorter route, never as
      // the route was walked: mid-243-ch's legs walked straight at their
      // ends, 85 to 24 blocks off in 40 seconds, each eight seconds of it
      // called a stall, the walk stopped and begun again, and its detours
      // round a ravine broken off half-way until the leg was turned where
      // it stood (note 652).
      const there = goalPoint(goal), flat = !there ? flatGoalPoint(goal) : null;
      const near = there ? bot.entity.position.distanceTo(there) : flat ? Math.hypot(bot.entity.position.x - flat.x, bot.entity.position.z - flat.z) : null;
      // The route left: a route is walked a node at a time, and the nodes
      // behind the bot are ground gained, a detour's included.
      if (routeNodes?.length) {
        const at = bot.entity.position;
        for (let i = routeNodes.length - 1; i >= 0; i--) {
          const n = routeNodes[i];
          if (Math.hypot(n.x - at.x, n.z - at.z) <= 0.8 && Math.abs(n.y - at.y) <= 1.5) { routeLength = Math.min(routeLength ?? Infinity, routeNodes.length - 1 - i); break; }
        }
      }
      // Stood behind the shield for a shot on its way (shot-reflex.js): the
      // walk waits, and a wait there is not a stall (note 676).
      if (bot._shotHold) lastProgress = Date.now();
      if (routeLength !== null && (bestRoute === null || routeLength < bestRoute)) { bestRoute = routeLength; lastProgress = Date.now(); }
      if (near !== null && (bestNear === null || near <= bestNear - 1)) { bestNear = near; lastProgress = Date.now(); }
      if (bot.entity.position.distanceTo(previous) >= 1) {
        previous = bot.entity.position.clone();
        const cell = `${previous.floored()}`;
        if (!visited.has(cell)) { visited.add(cell); if (routeLength === null && near === null) lastProgress = Date.now(); }
      }
      if (task.cancelled || Date.now() - started > timeoutMs || Date.now() - lastProgress > stallMs) {
        if (!task.cancelled) {
          bot._lastNavigationFailure = { at: Date.now(), position: { ...bot.entity.position },
          goal: { type: goal.constructor?.name, x: goal.x, y: goal.y, z: goal.z, rangeSq: goal.rangeSq,
            target: goal.entity ? { name: goal.entity.username || goal.entity.name, position: { ...goal.entity.position } } : undefined },
          controls: Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(key => [key, bot.getControlState?.(key)])), inWater: bot.entity.isInWater, oxygen: bot.oxygenLevel,
          feet: bot.blockAt?.(bot.entity.position)?.name, head: bot.blockAt?.(bot.entity.position.offset(0, 1.62, 0))?.name,
          route: latestRoute };
          bot.emit?.('navigation_stall', bot._lastNavigationFailure);
          if (Date.now() - started < timeoutMs) noteStallSpot(bot, bot.entity.position);
        }
        bot.pathfinder.setGoal(null);
        reject(task.cancelled ? new Cancelled(task.label) : Date.now() - started >= timeoutMs
          ? new Error('navigation timed out') : new NavigationStall());
        return;
      }
      if (corrections.length >= 4 && Date.now() - corrections.at(-1).at < 500) {
        reject(new NavigationCorrectionLoop({ position: corrections.at(-1).position, count: corrections.length, seconds: (corrections.at(-1).at - corrections[0].at) / 1000 }));
        bot.pathfinder.setGoal(null); bot.stopDigging?.(); bot.clearControlStates?.();
      }
    }, 100);
  });
  try {
    await Promise.race([bot.pathfinder.goto(goal), watchdog]);
    task.check();
    // Pathfinder can report arrival while the bot is still almost a block
    // above its landing. Starting the next dig then can remove the next step
    // before landing and turn a staircase into one continuous damaging fall.
    const landingDeadline = Date.now() + 2500;
    if (bot.entity.onGround === false && !bot.entity.isInWater) bot.clearControlStates();
    while (bot.entity.onGround === false && !bot.entity.isInWater) {
      task.check();
      if (Date.now() >= landingDeadline) throw new Error('Navigation ended without safe footing');
      await sleep(50);
    }
    // Standing on farmland, a slab or soul sand the feet floor into the
    // block itself; the pathfinder's own cell is the one above it. Judged by
    // the floor alone, the dream run's walks on its own plot all "ended
    // short", a hundred and eight times in seven minutes.
    const feet = bot.entity.position.floored(), under = bot.blockAt?.(feet);
    const standing = bot.entity.position.y - feet.y > 0.001 && bot.entity.onGround !== false && under?.boundingBox === 'block' ? feet.offset(0, 1, 0) : feet;
    if (!acquired && goal.isEnd && !goal.isEnd(feet) && !goal.isEnd(standing)) {
      // Walks that keep ending short with gap jumps on: the jumps go off for
      // five minutes (movement.js). The live run jumped at the same gap and
      // fell back, twenty-three short walks in a row, on its way to a portal.
      const now = Date.now();
      bot._shortWalks = [...(bot._shortWalks || []).filter(t => now - t < 60000), now];
      if (bot._shortWalks.length >= 3 && bot.pathfinder?.movements?.allowGapJumps) { bot._gapJumpsOffUntil = now + 5 * 60000; bot._shortWalks = []; }
      // The pathfinder resolves its goto on an empty path, whatever the
      // search found: that is no route from here, not a walk cut short, and
      // the two want different answers (trial 3 persisted ten times on
      // "ended before reaching", sealed in its own pocket 16 blocks from home).
      if (!latestRoute?.path?.length && latestRoute?.status !== 'success') {
        // What stands round the feet, for the flight record: mid-207-d's
        // every walk came back "partial" beside its cast frame, and what
        // boxed it in could not be seen (note 304). Once in ten seconds.
        if (!(bot._noRouteSeenAt > now - 10000) && bot.entity?.position && bot.blockAt) {
          bot._noRouteSeenAt = now;
          const feet = bot.entity.position.floored(), around = [];
          for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
            const b = bot.blockAt(feet.offset(dx, dy, dz));
            if (b && b.boundingBox !== 'empty' || /water|lava/.test(b?.name || '')) around.push(`${dx},${dy},${dz}:${b.name}`);
          }
          bot.emit('no_route', { status: latestRoute?.status || 'no search', feet: { x: feet.x, y: feet.y, z: feet.z }, goal: goal && ['x', 'y', 'z'].every(k => Number.isFinite(goal[k])) ? { x: goal.x, y: goal.y, z: goal.z } : null, around });
        }
        // Where to, said and carried: mid-202-o-nether-2 persisted twelve
        // times on "No route from here to the destination" with none named,
        // a cell two blocks under its own pocket's floor (note 500).
        throw noRoute(bot, goal, latestRoute?.status || 'no search');
      }
      throw new Error('Navigation ended before reaching the destination');
    }
  } catch (err) {
    bot.pathfinder.setGoal(null);
    task.check();
    // The pathfinder's own "no path" (a search that found part of a way):
    // where the Nether's lava or edge rule refused cells on it, said as the
    // empty route's no-route is, with the rule's reason (note 660).
    const m = bot.pathfinder?.movements || {};
    if (err?.name === 'NoPath' && (m.lavaRefusals > 0 || m.edgeRefusals > 0)) throw noRoute(bot, goal, 'noPath');
    throw err;
  } finally {
    doorUse.restore();
    clearInterval(timer);
    bot.removeListener?.('forcedMove', corrected);
    bot.removeListener?.('path_update', observedRoute);
    bot.removeListener?.('physicsTick', crouchOnEdge);
    if (edgeCrouch) bot.setControlState?.('sneak', false);
  }
}

/** Equip whichever carried item mines this block fastest. */
// The cheapest tool that does the job, not the best one carried. The dream
// run wore its iron pickaxe out on two hundred cobblestone that a stone
// pickaxe digs perfectly well, then had to mine and smelt more iron to
// replace it. When the block needs a particular tier to drop anything, the
// lowest tier that harvests it is used; when any tool will do, speed still
// decides, with the lower tier winning ties.
const TOOL_TIER = item => { const m = /^(\w+?)_(pickaxe|axe|shovel|hoe|sword)$/.exec(item?.name || ''); return m ? TOOL_TIERS.indexOf(m[1]) + 1 : 0; };
function cheapestTool(bot, block) {
  let best = null;
  const handTime = block.digTime(null, false, false, false, [], {});
  let bestTime = handTime;
  const remaining = item => (bot.registry?.itemsByName?.[item.name]?.maxDurability || Infinity) - (item.durabilityUsed || 0);
  const needsTool = !!block.harvestTools;
  const harvests = item => !needsTool || (typeof block.canHarvest === 'function' ? block.canHarvest(item.type) : !!block.harvestTools[item.type]);
  for (const item of bot.inventory.items()) {
    const time = block.digTime(item.type, false, false, false, [], {});
    if (time >= handTime || !harvests(item)) continue;
    // Of two of a tier, the more worn is used up first, and the spare stays
    // whole: the fresher one was taken, so a worn pickaxe was never finished,
    // the ladder made another each time the one in hand wore down, and trial
    // 43 carried five iron pickaxes, fifteen ingots its armour went without.
    const better = !best ? true
      : needsTool ? (TOOL_TIER(item) < TOOL_TIER(best) || (TOOL_TIER(item) === TOOL_TIER(best) && remaining(item) < remaining(best)))
        : (time < bestTime || (time === bestTime && (TOOL_TIER(item) < TOOL_TIER(best) || (TOOL_TIER(item) === TOOL_TIER(best) && remaining(item) < remaining(best)))));
    if (better) { bestTime = time; best = item; }
  }
  return best;
}
async function equipBestTool(bot, block) {
  const best = cheapestTool(bot, block);
  if (best && (!bot.heldItem || bot.heldItem.type !== best.type || bot.heldItem.slot !== best.slot)) {
    await bot.equip(best, 'hand');
    return;
  }
  // Nothing digs this faster than a fist: a sword or tool still in hand from
  // the last fight is put away rather than worn down for nothing.
  const held = bot.heldItem;
  if (!best && held && bot.registry?.itemsByName?.[held.name]?.maxDurability && typeof bot.unequip === 'function') {
    try { await bot.unequip('hand'); } catch (_) { /* dug with it, then */ }
  }
}

// A window (a furnace, a chest, a crafting table) opened without leaving the
// step blind. Mineflayer clicks the block and waits for the server's window
// with no timeout of its own but twenty seconds, checking nothing: trial 30
// clicked a furnace seven blocks off and stood there, shot by a skeleton,
// for those twenty seconds, the watchdogs unable to reach it. The block must
// be in reach, the task is checked while the window comes, and a window
// that has not come in a few seconds is given up (and closed if it comes late).
const REACH = 4.9;
async function openWindow(bot, task, open, { block = null, what = 'the window', timeoutMs = 5000 } = {}) {
  task.check();
  if (block?.position && bot.entity?.position) {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0);
    if (eye.distanceTo(block.position.offset(0.5, 0.5, 0.5)) > REACH) throw new Error(`${what} is out of reach`);
  }
  let settled = false, value, failure, abandoned = false;
  // A crouched click on a block with anything in either hand uses the item,
  // not the block (the game's secondary use): no window comes. 25588 crouched
  // on magma with a shield in the off hand, and its crafting table "did not
  // open" four times in 33 seconds (note 703). Upright for the click, and
  // crouched again once the window is there or given up (the magma crouch's
  // hold waits for it: vitals.js crouchOnHotFloor).
  const crouched = !!(bot.getControlState ? bot.getControlState('sneak') : bot.controlState?.sneak);
  if (crouched && block && typeof bot.setControlState === 'function') {
    bot._uncrouchedFor = Date.now() + timeoutMs + 500;
    bot.setControlState('sneak', false);
    await sleep(60);
  }
  let recrouched = false;
  const recrouch = () => { if (recrouched || !crouched || !block || typeof bot.setControlState !== 'function') return; recrouched = true; bot.removeListener?.('windowOpen', recrouch); delete bot._uncrouchedFor; bot.setControlState('sneak', true); };
  // Crouched again as soon as the window is there: a click inside a window
  // is the same crouched or not.
  if (crouched && block) bot.once?.('windowOpen', recrouch);
  let pending;
  try { pending = open(); } catch (err) { recrouch(); throw err; }
  pending.then(v => { settled = true; value = v; if (abandoned && v && typeof bot.closeWindow === 'function') { try { bot.closeWindow(v); } catch (_) { /* gone */ } } },
    e => { settled = true; failure = e; });
  const end = Date.now() + timeoutMs;
  try {
    while (!settled) {
      task.check();
      if (Date.now() > end) throw new Error(`${what} did not open${crouched && block ? ' (clicked upright)' : ''}`);
      await sleep(50);
    }
  } catch (err) { abandoned = true; recrouch(); throw err; }
  recrouch();
  if (failure) throw failure;
  return value;
}

// A block that opens a window (or turns, rings, lights) when clicked
// standing up: placing against it clicks it instead.
const INTERACTABLE = new Set(require('mineflayer-pathfinder/lib/interactable.json'));
const opensOnClick = name => !!name && (INTERACTABLE.has(name) || /_(door|trapdoor|button|fence_gate|shulker_box|bed|sign|anvil)$|^(barrel|loom|cartography_table|grindstone|crafter|lectern|decorated_pot|chiseled_bookshelf)$/.test(name));

// A window left open that nothing is working in: a click on a furnace while
// placing a block opens it, and while it is open the server takes no click
// in the pockets' own window (its crafting grid among them) and says
// nothing (note 690). Closed, with what it was returned for the record.
function closeStrayWindow(bot) {
  const w = bot?.currentWindow;
  if (!w || w === bot.inventory) return null;
  try { bot.closeWindow(w); } catch (_) { /* gone */ }
  return String(w.type || 'a window').replace(/^minecraft:/, '').replace(/_/g, ' ');
}

module.exports = { SCOOPED_COST, noteStallSpot, badSteps, STALL_SPOT_COST, openWindow, opensOnClick, closeStrayWindow, wholeGoal, goalGuardPlugin, digGuardPlugin, pickaxeDurability,
  Task,
  Cancelled,
  navigate,
  passingLook,
  shakeLoose,
  surveyRoute,
  equipBestTool,
  cheapestTool,
  pickaxeTier,
  countOf,
};
