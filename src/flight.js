'use strict';
const { Vec3 } = require('vec3');
const Heap = require('mineflayer-pathfinder/lib/heap');
const { damagingTerrain } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = p => `${p.x},${p.y},${p.z}`;
const center = p => p.offset(.5, .05, .5);
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Listen before login: Creative mode alone is not permission to override a
// server which has explicitly disabled flight. Never change the game mode.
function installFlight(bot) {
  if (bot._creativeFlight) return;
  const state = bot._creativeFlight = { allowed: false, active: false };
  const reset = () => { stopFlight(bot); state.allowed = false; };
  bot._client.on('abilities', packet => {
    state.allowed = !!(packet.flags & 4);
    if (!state.allowed) stopFlight(bot);
  });
  bot.on?.('physicsTick', () => {
    if (!state.active) return;
    if (!canFly(bot)) { stopFlight(bot); return; }
    // Mineflayer's normal physics has no Creative-flight simulation. Like
    // its Creative helper, suppress gravity and inertia while hovering.
    bot.entity.velocity.set(0, 0, 0);
  });
  bot.on?.('game', () => { if (bot.game?.gameMode !== 'creative') stopFlight(bot); });
  bot.on?.('death', reset); bot.on?.('end', reset);
  bot._client.on('respawn', reset);
}

function canFly(bot) {
  return bot.game?.gameMode === 'creative' && bot._creativeFlight?.allowed === true && !bot.vehicle;
}

function startFlight(bot) {
  if (!canFly(bot)) throw new Error('Creative flight is not available');
  const state = bot._creativeFlight;
  if (!state.active) {
    state.gravity = bot.physics.gravity;
    bot._client.write('abilities', { flags: 2 });
    state.active = true;
  }
  bot.physics.gravity = 0;
  bot.entity.velocity.set(0, 0, 0);
  bot.entity.onGround = false;
  bot.clearControlStates();
}

function stopFlight(bot) {
  const state = bot._creativeFlight;
  if (!state?.active) return;
  state.active = false;
  bot.physics.gravity = state.gravity;
  bot.entity?.velocity?.set(0, 0, 0);
  if (bot._client.state === 'play') bot._client.write('abilities', { flags: 0 });
}

// Conservative swept player body, including ceilings and partial-block shapes.
// Unknown chunks are obstacles. No ray-only shortcuts through corners/walls.
function clearFlightSegment(bot, from, to = from) {
  const half = (bot.physics?.playerHalfWidth || Math.fround(.6) / 2) + .005;
  const height = bot.physics?.playerHeight || Math.fround(1.8);
  const low = new Vec3(Math.min(from.x, to.x) - half, Math.min(from.y, to.y) + .001, Math.min(from.z, to.z) - half);
  const high = new Vec3(Math.max(from.x, to.x) + half, Math.max(from.y, to.y) + height, Math.max(from.z, to.z) + half);
  for (let x = Math.floor(low.x); x <= Math.floor(high.x); x++) for (let y = Math.floor(low.y); y <= Math.floor(high.y); y++) for (let z = Math.floor(low.z); z <= Math.floor(high.z); z++) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block || damagingTerrain.has(block.name) || block.name === 'cobweb') return false;
    const shapes = block.shapes || (block.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []);
    if (shapes.some(s => low.x < x + s[3] && high.x > x + s[0] && low.y < y + s[4] && high.y > y + s[1] && low.z < z + s[5] && high.z > z + s[2])) return false;
  }
  return true;
}

async function surveyFlight(bot, task, goal, { timeoutMs = 600, maxNodes = 20000, radius = 96 } = {}) {
  task.check();
  if (!canFly(bot)) return { status: 'noPath', path: [] };
  goal.hasChanged?.();
  if (goal.isValid?.() === false) return { status: 'noPath', path: [] };
  const start = bot.entity.position.clone(), cell = start.floored(), first = center(cell);
  if (!clearFlightSegment(bot, start, first)) return { status: 'noPath', path: [] };
  const heap = new Heap(), costs = new Map(), deadline = Date.now() + timeoutMs;
  heap.push({ p: cell, g: 0, f: goal.heuristic(cell), parent: null }); costs.set(key(cell), 0);
  let visited = 0;
  while (!heap.isEmpty() && visited++ < maxNodes) {
    if (visited % 64 === 0) { await sleep(0); task.check(); if (!canFly(bot) || Date.now() >= deadline) return { status: 'timeout', path: [] }; }
    const node = heap.pop();
    if (node.g !== costs.get(key(node.p))) continue;
    if (goal.isEnd(node.p)) {
      const path = [];
      for (let cursor = node; cursor; cursor = cursor.parent) path.unshift(center(cursor.p));
      return { status: 'success', path };
    }
    for (const d of directions) {
      const p = node.p.offset(...d), g = node.g + 1;
      if (p.distanceTo(cell) > radius || g >= (costs.get(key(p)) ?? Infinity) || !clearFlightSegment(bot, center(node.p), center(p))) continue;
      costs.set(key(p), g); heap.push({ p, g, f: g + goal.heuristic(p), parent: node });
    }
  }
  return { status: 'noPath', path: [] };
}

async function flyNavigate(bot, task, goal, { timeoutMs = 90000, stallMs = 5000, stopWhen } = {}) {
  task.check();
  if (!canFly(bot)) throw new Error('Creative flight is not available');
  bot.pathfinder.setGoal(null); bot.clearControlStates();
  const deadline = Date.now() + timeoutMs;
  let corrections = 0, lastProgress = Date.now(), previous = bot.entity.position.clone();
  const corrected = () => { corrections++; };
  bot.on('forcedMove', corrected);
  try {
    while (Date.now() < deadline) {
      task.check();
      if (!canFly(bot)) throw new Error('Creative flight permission changed');
      if (stopWhen?.()) return;
      goal.hasChanged?.();
      if (goal.isValid?.() === false) throw new Error('Flight destination is no longer visible');
      if (goal.isEnd(bot.entity.position.floored()) && (!goal.reachable || goal.reachable(bot.entity.position))) return;
      const route = await surveyFlight(bot, task, goal, { timeoutMs: Math.min(1200, deadline - Date.now()) });
      if (route.status !== 'success') throw new Error('I cannot find a clear flight path there yet');
      startFlight(bot);
      bot.emit('flight_route', { path: route.path });
      const correctionAtStart = corrections;
      let replan = false;
      for (const point of route.path) {
        while (bot.entity.position.distanceTo(point) > .025) {
          task.check();
          if (!canFly(bot)) throw new Error('Creative flight permission changed');
          if (stopWhen?.()) return;
          if (Date.now() >= deadline) throw new Error('Flight navigation timed out');
          if (corrections >= 3) throw new Error('The server could not confirm my flight path');
          if (goal.isValid?.() === false) throw new Error('Flight destination is no longer visible');
          if (goal.hasChanged?.() || corrections !== correctionAtStart) { replan = true; break; }
          const current = bot.entity.position, delta = point.minus(current);
          const next = current.plus(delta.scaled(Math.min(.25 / delta.norm(), 1)));
          if (!clearFlightSegment(bot, current, next)) { replan = true; break; }
          if (current.distanceTo(previous) >= .5) { previous = current.clone(); lastProgress = Date.now(); }
          if (Date.now() - lastProgress > stallMs) throw new Error('Flight stopped making progress');
          if (Math.hypot(delta.x, delta.z) > .05) await bot.lookAt(point.offset(0, 1.62, 0), true);
          bot.entity.velocity.set(0, 0, 0);
          bot.entity.position = next;
          bot.entity.onGround = false;
          await sleep(50); // Normal Mineflayer movement packets, at 5 blocks/s.
        }
        if (replan) break;
      }
      // Give corrections a chance to arrive before declaring success.
      if (!replan) await sleep(100);
    }
    throw new Error('Flight navigation timed out');
  } finally {
    bot.removeListener('forcedMove', corrected); bot.clearControlStates();
    bot.emit('flight_route', { path: [] });
    bot.entity?.velocity?.set(0, 0, 0);
    // Stop means hover in place, not fall off the building. Mode changes and
    // server revocation restore normal gravity immediately via the listeners.
    if (!canFly(bot)) stopFlight(bot);
  }
}

module.exports = { installFlight, canFly, startFlight, stopFlight, clearFlightSegment, surveyFlight, flyNavigate };
