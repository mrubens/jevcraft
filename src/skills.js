'use strict';
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
  if (!bot.pathfinder.getPathFromTo) return bot.pathfinder.getPathTo(movements, goal, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  let last;
  for (const { result } of bot.pathfinder.getPathFromTo(movements, bot.entity.position, goal,
    { timeout: timeoutMs, tickTimeout: Math.min(20, timeoutMs) })) {
    task.check(); checkAir(bot); last = result;
    if (result.status !== 'partial') return result;
    if (Date.now() >= deadline) return { ...result, status: 'timeout' };
    await sleep(0); // Let physics, new mob observations and cancellation run.
  }
  return last || { status: 'noPath', path: [] };
}

class NavigationCorrectionLoop extends Error {
  constructor() { super('Repeated server movement corrections at the same position'); }
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
    return below.some(b => b && b.boundingBox === 'block');
  };
  const step = async (dx, dz) => {
    await bot.lookAt?.(cell.offset(dx + 0.5, 1.62, dz + 0.5), true);
    bot.setControlState?.('jump', true); bot.setControlState?.('forward', true);
    const end = Date.now() + settleMs;
    while (Date.now() < end) { await sleep(50); task.check(); guard?.(); if (moved()) break; }
    bot.clearControlStates?.();
    return moved();
  };
  let stage = 0;
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  try {
    const order = DIRECTIONS.map(d => ({ d, r: random() })).sort((a, b) => a.r - b.r).map(({ d }) => d);
    // Stage 1: soft blocks on the body, then a jump and a step each way.
    stage = 1;
    for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, 0], [0, 2, 0]]) { const b = at(dx, dy, dz); if (softOrLeaves(b) && breakable(bot, b)) await dig(b); }
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

function goalGuardPlugin(bot) {
  const setGoal = bot.pathfinder?.setGoal;
  if (!setGoal) { console.log('[bug] goal guard: no pathfinder to guard; load it after the pathfinder'); return; }
  bot.pathfinder.setGoal = (goal, dynamic) => setGoal.call(bot.pathfinder, wholeGoal(goal), dynamic);
}

async function navigate(bot, task, goal, { timeoutMs = 90000, stallMs = 15000, stopWhen, sprint = false } = {}) {
  task.check();
  if (require('./flight').canFly(bot)) return require('./flight').flyNavigate(bot, task, goal, { timeoutMs, stallMs, stopWhen });
  // A stopped trip can leave our empty boat underfoot. Clear only that owned
  // boat before player physics attempts to walk through its solid hull.
  if (bot._ownedBoats?.size && !bot.vehicle) await require('./boats').clearOwnedBoatAtFeet(bot, task);
  const movements = bot.pathfinder?.movements, sprinting = sprint && (bot.food ?? 20) > SPRINT_FOOD && !!movements;
  const walked = sprinting ? movements.allowSprinting : undefined;
  if (sprinting) movements.allowSprinting = true;
  const deadline = Date.now() + timeoutMs;
  try {
    for (let attempt = 0; ; attempt++) {
      task.check(); checkAir(bot);
      if (stopWhen?.()) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('navigation timed out');
      try { return await navigateAttempt(bot, task, goal, { timeoutMs: remaining, stallMs, stopWhen }); }
      catch (err) {
        if (!(err instanceof NavigationCorrectionLoop || err instanceof NavigationStall) || attempt > 0 ||
          !await recoverNavigation(bot, task, deadline, stopWhen)) throw err;
      }
    }
  } finally { if (sprinting) movements.allowSprinting = walked; }
}

async function navigateAttempt(bot, task, goal, { timeoutMs, stallMs, stopWhen }) {
  task.check(); checkAir(bot);
  if (stopWhen?.()) return;
  const doorUse = require('./doors').guardNavigationDoors(bot, task, goal);
  let timer;
  let acquired = false;
  let corrections = [];
  let latestRoute;
  const observedRoute = route => {
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
  const watchdog = new Promise((resolve, reject) => {
    const started = Date.now();
    let lastProgress = started;
    let previous = bot.entity.position.clone();
    const visited = new Set([`${previous.floored()}`]);
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
      if (bot.entity.position.distanceTo(previous) >= 1) {
        previous = bot.entity.position.clone();
        const cell = `${previous.floored()}`;
        if (!visited.has(cell)) { visited.add(cell); lastProgress = Date.now(); }
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
        }
        bot.pathfinder.setGoal(null);
        reject(task.cancelled ? new Cancelled(task.label) : Date.now() - started >= timeoutMs
          ? new Error('navigation timed out') : new NavigationStall());
        return;
      }
      if (corrections.length >= 4 && Date.now() - corrections.at(-1).at < 500) {
        reject(new NavigationCorrectionLoop());
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
      if (!latestRoute?.path?.length && latestRoute?.status !== 'success') throw Object.assign(new Error(`No route from here to the destination (${latestRoute?.status || 'no search'})`), { name: 'NoRoute' });
      throw new Error('Navigation ended before reaching the destination');
    }
  } catch (err) {
    bot.pathfinder.setGoal(null);
    task.check();
    throw err;
  } finally {
    doorUse.restore();
    clearInterval(timer);
    bot.removeListener?.('forcedMove', corrected);
    bot.removeListener?.('path_update', observedRoute);
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
    const better = !best ? true
      : needsTool ? (TOOL_TIER(item) < TOOL_TIER(best) || (TOOL_TIER(item) === TOOL_TIER(best) && remaining(item) > remaining(best)))
        : (time < bestTime || (time === bestTime && (TOOL_TIER(item) < TOOL_TIER(best) || (TOOL_TIER(item) === TOOL_TIER(best) && remaining(item) > remaining(best)))));
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

module.exports = { wholeGoal, goalGuardPlugin, pickaxeDurability,
  Task,
  Cancelled,
  navigate,
  shakeLoose,
  surveyRoute,
  equipBestTool,
  cheapestTool,
  pickaxeTier,
  countOf,
};
