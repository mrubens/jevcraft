'use strict';

const { TOOL_TIERS } = require('./plan');
const { checkAir, needsAir, NeedsAir } = require('./vitals');

/** Best pickaxe tier carried: 0 bare hands, 1 wooden, 2 stone, 3 iron, ... */
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

/** Move somewhere, aborting cleanly if the task is cancelled mid-path. */
async function navigate(bot, task, goal, { timeoutMs = 90000, stallMs = 15000, stopWhen } = {}) {
  task.check();
  if (require('./flight').canFly(bot)) return require('./flight').flyNavigate(bot, task, goal, { timeoutMs, stallMs, stopWhen });
  // A stopped trip can leave our empty boat underfoot. Clear only that owned
  // boat before player physics attempts to walk through its solid hull.
  if (bot._ownedBoats?.size && !bot.vehicle) await require('./boats').clearOwnedBoatAtFeet(bot, task);
  const deadline = Date.now() + timeoutMs;
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
    if (!acquired && goal.isEnd && !goal.isEnd(bot.entity.position.floored())) {
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
async function equipBestTool(bot, block) {
  let best = null;
  let bestTime = block.digTime(null, false, false, false, [], {});
  const remaining = item => (bot.registry?.itemsByName?.[item.name]?.maxDurability || Infinity) - (item.durabilityUsed || 0);
  for (const item of bot.inventory.items()) {
    const time = block.digTime(item.type, false, false, false, [], {});
    if (time < bestTime || (best && time === bestTime && remaining(item) > remaining(best))) {
      bestTime = time;
      best = item;
    }
  }
  if (best && (!bot.heldItem || bot.heldItem.type !== best.type || bot.heldItem.slot !== best.slot)) {
    await bot.equip(best, 'hand');
  }
}

module.exports = {
  Task,
  Cancelled,
  navigate,
  surveyRoute,
  equipBestTool,
  pickaxeTier,
  countOf,
};
