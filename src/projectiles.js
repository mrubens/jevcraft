'use strict';
const { Vec3 } = require('vec3');
const { countOf } = require('./skills');
const { dryStanding } = require('./mining-access');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Vanilla 26.1 BowItem / AbstractArrow: full draw speed 3, then each tick
// position += velocity, velocity *= float(0.99), velocity.y -= 0.05.
const DRAG = Math.fround(.99), GRAVITY = .05, SPEED = 3;
function sentAimMatches(rotation, solution) {
  if (!rotation || !Number.isFinite(rotation.yaw) || !Number.isFinite(rotation.pitch)) return false;
  const yaw = Math.PI - rotation.yaw * Math.PI / 180, pitch = -rotation.pitch * Math.PI / 180;
  // Upstream look quantizes mouse movement to .15 degrees. Allow that
  // rounding while rejecting incomplete yaw or pitch interpolation.
  const tolerance = .2 * Math.PI / 180, difference = yaw - solution.yaw;
  return Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) < tolerance && Math.abs(pitch - solution.pitch) < tolerance;
}
function arrowPosition(origin, velocity, ticks) {
  const sum = (1 - DRAG ** ticks) / (1 - DRAG);
  return origin.plus(velocity.scaled(sum)).offset(0, -GRAVITY * (ticks - sum) / (1 - DRAG), 0);
}

function bowSolution(origin, target, targetVelocity = new Vec3(0, 0, 0)) {
  const required = ticks => {
    const sum = (1 - DRAG ** ticks) / (1 - DRAG);
    const aim = target.plus(targetVelocity.scaled(ticks));
    return aim.minus(origin).offset(0, GRAVITY * (ticks - sum) / (1 - DRAG), 0).scaled(1 / sum);
  };
  let previous = .25;
  for (let ticks = .5; ticks <= 100; ticks += .25) {
    if (required(ticks).norm() <= SPEED) {
      let low = previous, high = ticks;
      for (let n = 0; n < 20; n++) { const middle = (low + high) / 2; if (required(middle).norm() > SPEED) low = middle; else high = middle; }
      const duration = (low + high) / 2, velocity = required(duration);
      return { velocity, ticks: duration, yaw: Math.atan2(-velocity.x, -velocity.z), pitch: Math.asin(Math.max(-1, Math.min(1, velocity.y / SPEED))),
        target: target.plus(targetVelocity.scaled(duration)) };
    }
    previous = ticks;
  }
  return null;
}

function clearShot(bot, origin, solution, target) {
  let previous = origin;
  for (let ticks = .5; ticks < solution.ticks + .5; ticks += .5) {
    const point = arrowPosition(origin, solution.velocity, Math.min(ticks, solution.ticks));
    if (!bot.blockAt(point)) return false;
    const segment = point.minus(previous), length = segment.norm();
    if (length && bot.world.raycast(previous, segment.scaled(1 / length), length)) return false;
    // Do not shoot through a nearby player or an unrelated living mob.
    for (const entity of Object.values(bot.entities)) {
      if (entity === target || entity === bot.entity || entity.isValid === false || !entity.position ||
        !(entity.type === 'player' || bot.registry.entitiesByName[entity.name]?.metadataKeys?.includes('health'))) continue;
      const center = entity.position.offset(0, (entity.height || 1.8) / 2, 0);
      const fraction = Math.max(0, Math.min(1, center.minus(previous).dot(segment) / (length * length || 1)));
      const nearest = previous.plus(segment.scaled(fraction));
      if (Math.abs(nearest.y - center.y) < (entity.height || 1.8) / 2 + .3 &&
        Math.hypot(nearest.x - center.x, nearest.z - center.z) < (entity.width || .6) / 2 + .3) return false;
    }
    previous = point;
  }
  return true;
}

function aimAtEntity(bot, target, velocity = new Vec3(0, 0, 0), position = bot.entity.position) {
  const origin = position.offset(0, 1.52, 0);
  // Sample the actual target volume. In particular, a cage is not assumed to
  // be transparent; only trajectories whose block-shape raycasts are clear
  // are offered for execution.
  // Favor the center: vanilla bow spread makes a barely exposed edge much
  // less reliable, especially at long range. Edge samples still permit cages.
  const offsets = target.name === 'end_crystal' ? [1, 1.5, .5, 1.7, .3].flatMap(y =>
    [0, -.5, .5, -.85, .85].flatMap(x => [0, -.5, .5, -.85, .85].map(z => [x, y, z]))) :
    [[0, target.name === 'ender_dragon' ? 1.5 : (target.height || 1.8) / 2, 0]];
  for (const offset of offsets) {
    const solution = bowSolution(origin, target.position.offset(...offset), velocity);
    if (solution && clearShot(bot, origin, solution, target)) return { ...solution, origin };
  }
  return null;
}

async function shootBow(bot, task, target, { guard = () => {}, velocity = new Vec3(0, 0, 0), chargeMs = 1200, confirmationMs = 2000 } = {}) {
  const dimension = bot.game.dimension, start = bot.entity.position.clone();
  const motion = () => typeof velocity === 'function' ? velocity() : velocity;
  const check = () => {
    task.check(); checkAir(bot); checkThreats(bot); guard();
    if (bot.game.gameMode !== 'survival' || bot.game.dimension !== dimension || bot.health <= 0 ||
      bot.entities[target.id] !== target || target.isValid === false || bot.entity.position.distanceTo(start) > .3 || !dryStanding(bot, bot.entity.position)) {
      throw new Error('Bow shot interrupted by a changed target, dimension or firing position');
    }
  };
  check();
  const bow = bot.inventory.items().find(i => i.name === 'bow' && (i.durabilityUsed || 0) < bot.registry.itemsByName.bow.maxDurability - 1);
  if (!bow || countOf(bot, 'arrow') < 1) throw new Error('A usable bow and carried arrows are required');
  if (!aimAtEntity(bot, target, motion())) throw new Error('No clear observed arrow trajectory to this target');
  bot.pathfinder.setGoal(null); bot.clearControlStates(); await bot.equip(bow, 'hand'); check();
  let drawing = false, released = false, arrow, ambiguous = false;
  const onSpawn = entity => {
    if (!released || entity.name !== 'arrow' || entity.position.distanceTo(start.offset(0, 1.52, 0)) > 3) return;
    if (arrow && arrow !== entity) ambiguous = true;
    arrow = entity;
  };
  bot.on('entitySpawn', onSpawn);
  try {
    bot.activateItem(); drawing = true;
    const drawUntil = Date.now() + chargeMs;
    while (Date.now() < drawUntil) { check(); await sleep(50); }
    check();
    const solution = aimAtEntity(bot, target, motion());
    if (!solution) throw new Error('Arrow trajectory became obstructed while drawing');
    // Neither forced look nor the ordinary yaw-only completion promise
    // proves that the intended pitch was sent. Wait for the actual movement
    // packet to carry both angles before releasing the arrow.
    let aimed = false, aimError;
    bot.look(solution.yaw, solution.pitch, false).then(() => { aimed = true; }, err => { aimError = err; aimed = true; });
    const aimDeadline = Date.now() + 2000;
    while ((!aimed || !sentAimMatches(bot.lastSentRotation, solution)) && !aimError && Date.now() < aimDeadline) { check(); await sleep(25); }
    check(); if (aimError) throw aimError;
    if (!aimed || !sentAimMatches(bot.lastSentRotation, solution)) throw new Error('Bow yaw and pitch were not sent before their deadline');
    const before = countOf(bot, 'arrow'), sentRotation = { ...bot.lastSentRotation };
    released = true; bot.deactivateItem(); drawing = false;
    const deadline = Date.now() + confirmationMs, expected = bow.enchants?.some(e => e.name === 'infinity') ? 0 : 1;
    while (Date.now() < deadline) {
      task.check(); guard();
      if (bot.game.dimension !== dimension || bot.health <= 0) throw new Error('Bow confirmation interrupted by dimension change or death');
      if (ambiguous) throw new Error('Ambiguous arrow launch observation');
      if (arrow && before - countOf(bot, 'arrow') === expected) return {
        at: Date.now(), targetId: target.id, target: target.name, arrowId: arrow.id, consumed: expected,
        origin: { ...solution.origin }, aim: { ...solution.target }, ticks: solution.ticks, velocity: { ...arrow.velocity },
        sentRotation, intendedVelocity: { ...solution.velocity },
      };
      await sleep(50);
    }
    throw new Error('Bow release lacks matching arrow entity and inventory confirmation');
  } finally {
    if (drawing) {
      // Releasing a drawn bow would fire even on cancellation. Changing the
      // selected hotbar slot stops item use on the server without firing it.
      bot.setQuickBarSlot((bot.quickBarSlot + 1) % 9);
      bot.deactivateItem();
    }
    bot.removeListener('entitySpawn', onSpawn); bot.clearControlStates();
  }
}

module.exports = { arrowPosition, bowSolution, clearShot, aimAtEntity, shootBow, sentAimMatches };
