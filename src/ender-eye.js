'use strict';
const { Vec3 } = require('vec3');
const { countOf } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { dryStanding } = require('./mining-access');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const point = p => ({ x: p.x, y: p.y, z: p.z });
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function bearingFromSamples(samples) {
  if (samples.length < 3 || samples.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) return null;
  const origin = samples[0];
  const end = samples.reduce((farthest, p) => horizontal(p, origin) > horizontal(farthest, origin) ? p : farthest, origin);
  const distance = horizontal(end, origin), last = samples.at(-1);
  // An almost vertical downward throw still supplies a local excavation hint,
  // but cannot form a reliable horizontal ray for triangulation.
  if (distance < 2 && last.y >= origin.y - 3) return null;
  const direction = distance >= 2 ? { x: (end.x - origin.x) / distance, z: (end.z - origin.z) / distance } : null;
  if (direction && samples.some(p => Math.abs((p.x - origin.x) * direction.z - (p.z - origin.z) * direction.x) > .35)) return null;
  return { origin: point(origin), end: point(last), direction, horizontalTravel: distance,
    descending: last.y < origin.y - 3, samples: samples.map(point) };
}

function triangulate(bearings) {
  const rays = bearings.filter(b => b.direction).slice(-8);
  let best = null;
  for (let a = 0; a < rays.length; a++) for (let b = a + 1; b < rays.length; b++) {
    const first = rays[a], second = rays[b], u = first.direction, v = second.direction;
    if (horizontal(first.origin, second.origin) < 24) continue;
    const cross = u.x * v.z - u.z * v.x;
    if (Math.abs(cross) < .02) continue;
    const dx = second.origin.x - first.origin.x, dz = second.origin.z - first.origin.z;
    const t = (dx * v.z - dz * v.x) / cross, s = (dx * u.z - dz * u.x) / cross;
    if (t < 0 || s < 0 || t > 10000 || s > 10000) continue;
    const candidate = { x: first.origin.x + t * u.x, z: first.origin.z + t * u.z };
    // Different nearest strongholds or noisy rays must not create a confident
    // remote waypoint. Require consistency with every recent observation.
    const residual = Math.max(...rays.map(r => Math.abs((candidate.x - r.origin.x) * r.direction.z - (candidate.z - r.origin.z) * r.direction.x)));
    if (residual > 8) continue;
    const strength = Math.abs(cross) / (1 + residual);
    if (!best || strength > best.strength) best = { ...candidate, strength, residual, source: 'observed_eye_bearings' };
  }
  return best;
}

async function throwEye(bot, task, { reserve = 12, timeoutMs = 7000 } = {}) {
  task.check(); checkAir(bot); checkThreats(bot);
  if (String(bot.game.dimension).replace(/^minecraft:/, '') !== 'overworld' || bot.game.gameMode !== 'survival') throw new Error('Eye search requires Overworld Survival');
  if (countOf(bot, 'ender_eye') <= reserve) throw new Error(`Need a spare Eye of Ender beyond the ${reserve} reserved for portal frames`);
  if (!dryStanding(bot, bot.entity.position)) throw new Error('Need dry stable footing to observe an Eye of Ender');
  bot.pathfinder.setGoal(null); bot.clearControlStates();
  await bot.equip(bot.inventory.items().find(i => i.name === 'ender_eye'), 'hand');
  await bot.look(bot.entity.yaw || 0, Math.PI / 3, true);
  task.check(); checkAir(bot); checkThreats(bot);
  const origin = bot.entity.position.clone(), dimension = bot.game.dimension, before = countOf(bot, 'ender_eye');
  if (before <= reserve || bot.heldItem?.name !== 'ender_eye') throw new Error('Eye supply or equipped item changed before throwing');
  const old = new Set(Object.values(bot.entities));
  const samples = [], candidates = new Set();
  let target, gone = false;
  const record = entity => {
    if (entity !== target || !entity.position) return;
    const p = entity.position;
    if (!samples.length || new Vec3(samples.at(-1).x, samples.at(-1).y, samples.at(-1).z).distanceTo(p) > .05) samples.push(point(p));
  };
  const spawned = entity => {
    if (entity.name !== 'eye_of_ender' || old.has(entity) || entity.position.distanceTo(origin) > 3) return;
    candidates.add(entity);
    if (!target) { target = entity; record(entity); }
  };
  const removed = entity => { if (entity === target) { record(entity); gone = true; } };
  bot.on('entitySpawn', spawned); bot.on('entityMoved', record); bot.on('entityGone', removed);
  const started = Date.now();
  try {
    bot.activateItem();
    while (Date.now() - started < timeoutMs) {
      task.check(); checkAir(bot); checkThreats(bot);
      if (bot.game.dimension !== dimension || bot.entity.position.distanceTo(origin) > 1 || bot.health <= 0) throw new Error('Eye observation interrupted by a changed position or dimension');
      if (candidates.size > 1) throw new Error('Multiple nearby Eye entities make this throw ambiguous');
      if (target) record(target);
      if (gone && countOf(bot, 'ender_eye') < before) break;
      await sleep(50);
    }
    task.check();
    if (!target || !gone || countOf(bot, 'ender_eye') !== before - 1) throw new Error('Eye throw lacked an unambiguous entity flight and inventory confirmation');
    const bearing = bearingFromSamples(samples);
    if (!bearing) throw new Error('Observed Eye flight did not provide a reliable direction');
    return { ...bearing, at: new Date().toISOString(), entityId: target.id, dimension: 'overworld', consumed: 1 };
  } finally {
    bot.deactivateItem();
    bot.removeListener('entitySpawn', spawned); bot.removeListener('entityMoved', record); bot.removeListener('entityGone', removed);
  }
}

module.exports = { bearingFromSamples, triangulate, throwEye, horizontal };
