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
// A thrown snowball or egg (ThrowableProjectile, note 1342): thrown at 1.5,
// gravity 0.03 a tick, the same drag. Any projectile breaks an end crystal.
const ARROW = { drag: DRAG, gravity: GRAVITY, speed: SPEED }, THROWN = { drag: DRAG, gravity: .03, speed: 1.5 };
const THROWABLE = ['snowball', 'egg', 'brown_egg', 'blue_egg'];
function sentAimMatches(rotation, solution) {
  if (!rotation || !Number.isFinite(rotation.yaw) || !Number.isFinite(rotation.pitch)) return false;
  const yaw = Math.PI - rotation.yaw * Math.PI / 180, pitch = -rotation.pitch * Math.PI / 180;
  // Upstream look quantizes mouse movement to .15 degrees. Allow that
  // rounding while rejecting incomplete yaw or pitch interpolation.
  const tolerance = .2 * Math.PI / 180, difference = yaw - solution.yaw;
  return Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) < tolerance && Math.abs(pitch - solution.pitch) < tolerance;
}
function arrowPosition(origin, velocity, ticks, { drag = DRAG, gravity = GRAVITY } = ARROW) {
  const sum = (1 - drag ** ticks) / (1 - drag);
  return origin.plus(velocity.scaled(sum)).offset(0, -gravity * (ticks - sum) / (1 - drag), 0);
}

function bowSolution(origin, target, targetVelocity = new Vec3(0, 0, 0), physics = ARROW) {
  const { drag: DRAG, gravity: GRAVITY, speed: SPEED } = physics;
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
      return { velocity, ticks: duration, physics, yaw: Math.atan2(-velocity.x, -velocity.z), pitch: Math.asin(Math.max(-1, Math.min(1, velocity.y / SPEED))),
        target: target.plus(targetVelocity.scaled(duration)) };
    }
    previous = ticks;
  }
  return null;
}

function clearShot(bot, origin, solution, target) {
  let previous = origin;
  for (let ticks = .5; ticks < solution.ticks + .5; ticks += .5) {
    const point = arrowPosition(origin, solution.velocity, Math.min(ticks, solution.ticks), solution.physics || ARROW);
    const cell = bot.blockAt(point);
    if (!cell) return false;
    // A crystal's cage of iron bars stops a throw (note 1343): the arena's
    // drill of 2026-10-06 (02:45 to 02:50Z) threw fifteen snowballs at a
    // caged crystal, each line solved clear through the bars, and none
    // reached it. Arrows are left as they were: the rehearsals of
    // 2026-10-04 took all ten crystals by the bow, the caged among them.
    if (cell.name === 'iron_bars' && solution.physics === THROWN) return false;
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

function aimAtEntity(bot, target, velocity = new Vec3(0, 0, 0), position = bot.entity.position, physics = ARROW) {
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
    const solution = bowSolution(origin, target.position.offset(...offset), velocity, physics);
    if (solution && clearShot(bot, origin, solution, target)) return { ...solution, origin };
  }
  return null;
}

// The default threat rule stops a shot when any hostile is in view, which
// suits the End; survival shooting at a skeleton passes its own rule, since
// the skeleton is the point.
async function shootBow(bot, task, target, { guard = () => {}, threatCheck = checkThreats, velocity = new Vec3(0, 0, 0), chargeMs = 1200, confirmationMs = 2000, standing = dryStanding, holdMs = 0 } = {}) {
  const dimension = bot.game.dimension, start = bot.entity.position.clone();
  const motion = () => typeof velocity === 'function' ? velocity() : velocity;
  const check = () => {
    task.check(); checkAir(bot); threatCheck(bot); guard();
    if (bot.game.gameMode !== 'survival' || bot.game.dimension !== dimension || bot.health <= 0 ||
      bot.entities[target.id] !== target || target.isValid === false || bot.entity.position.distanceTo(start) > .3 || !standing(bot, bot.entity.position)) {
      throw new Error('Bow shot interrupted by a changed target, dimension or firing position');
    }
  };
  check();
  const bow = bot.inventory.items().find(i => i.name === 'bow' && (i.durabilityUsed || 0) < bot.registry.itemsByName.bow.maxDurability - 1);
  if (!bow || countOf(bot, 'arrow') < 1) throw new Error('A usable bow and carried arrows are required');
  // Never with a chicken or a pig near the line (protected-animals.js).
  const { isProtected, nearShot, ProtectedAnimal } = require('./protected-animals');
  if (isProtected(target)) throw new ProtectedAnimal(`Never a ${target.name}: the shot was not taken`);
  const inLine = nearShot(bot, target);
  if (inLine.length) throw new ProtectedAnimal(`A ${inLine[0].name} is near the line of the shot: not taken`);
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
    // Neither forced look nor the ordinary yaw-only completion promise
    // proves that the intended pitch was sent. Wait for the actual movement
    // packet to carry both angles, then solve again: the target can move
    // during the turn. All refinements share one bounded aiming deadline.
    // `holdMs`: the bow stays drawn that long for a line that has closed to
    // open again (a flying target passing behind a pillar), where without
    // it the draw is dropped at the first look with no line. The dragon
    // rehearsal of 2026-10-04 (00:08 to 00:13Z) dropped ten of its
    // seventeen draws so, "Arrow trajectory became obstructed before
    // release", the dragon circling the pillars (note 1136).
    const holdUntil = Date.now() + holdMs, aimDeadline = holdUntil + 2000;
    let solution, aimAdjustments = 0;
    while (Date.now() < aimDeadline) {
      check();
      let fresh = null, motionError = null;
      try { fresh = aimAtEntity(bot, target, motion()); } catch (err) { if (Date.now() >= holdUntil) throw err; motionError = err; }
      if (!fresh && Date.now() < holdUntil) { await sleep(50); continue; }
      if (!fresh) throw motionError || new Error('Arrow trajectory became obstructed before release');
      if (sentAimMatches(bot.lastSentRotation, fresh)) { solution = fresh; break; }
      let aimed = false, aimError;
      aimAdjustments++;
      bot.look(fresh.yaw, fresh.pitch, false).then(() => { aimed = true; }, err => { aimError = err; aimed = true; });
      while ((!aimed || !sentAimMatches(bot.lastSentRotation, fresh)) && !aimError && Date.now() < aimDeadline) { check(); await sleep(25); }
      check(); if (aimError) throw aimError;
    }
    if (!solution) throw new Error('Bow yaw and pitch did not settle on the current target before their deadline');
    const before = countOf(bot, 'arrow'), sentRotation = { ...bot.lastSentRotation };
    const targetAtRelease = { position: { ...target.position }, at: Date.now(), aimAdjustments };
    released = true; bot.deactivateItem(); drawing = false;
    const deadline = Date.now() + confirmationMs, expected = bow.enchants?.some(e => e.name === 'infinity') ? 0 : 1;
    while (Date.now() < deadline) {
      task.check(); guard();
      if (bot.game.dimension !== dimension || bot.health <= 0) throw new Error('Bow confirmation interrupted by dimension change or death');
      if (ambiguous) throw new Error('Ambiguous arrow launch observation');
      if (arrow && before - countOf(bot, 'arrow') === expected) return {
        at: Date.now(), targetId: target.id, target: target.name, arrowId: arrow.id, consumed: expected,
        origin: { ...solution.origin }, aim: { ...solution.target }, ticks: solution.ticks, velocity: { ...arrow.velocity },
        sentRotation, intendedVelocity: { ...solution.velocity }, targetAtRelease,
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

// A snowball or egg thrown at a target along a clear observed line (note
// 1342): looked along until the sent rotation carries the angles, then used
// once; confirmed by one fewer carried and the projectile's entity seen.
async function throwAt(bot, task, target, { guard = () => {}, item = null, confirmationMs = 2000 } = {}) {
  const held = item || THROWABLE.find(n => countOf(bot, n) > 0);
  const stack = held && bot.inventory.items().find(i => i.name === held);
  if (!stack) throw new Error('Nothing to throw is carried');
  const check = () => { task.check(); guard(); if (bot.health <= 0 || bot.entities[target.id] !== target || target.isValid === false) throw new Error('Throw interrupted by a changed target'); };
  check();
  let solution = aimAtEntity(bot, target, new Vec3(0, 0, 0), bot.entity.position, THROWN);
  if (!solution) throw new Error('No clear observed throw to this target');
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates(); await bot.equip(stack, 'hand'); check();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    check();
    solution = aimAtEntity(bot, target, new Vec3(0, 0, 0), bot.entity.position, THROWN);
    if (!solution) throw new Error('The throw\'s line closed before release');
    if (sentAimMatches(bot.lastSentRotation, solution)) break;
    await bot.look(solution.yaw, solution.pitch, false); await sleep(60);
  }
  if (!sentAimMatches(bot.lastSentRotation, solution)) throw new Error('The throw\'s yaw and pitch did not settle before their deadline');
  const before = countOf(bot, held), start = bot.entity.position.clone();
  let thrown = null;
  const onSpawn = e => { if (/snowball|egg/.test(e.name || '') && e.position.distanceTo(start.offset(0, 1.52, 0)) <= 3) thrown = e; };
  bot.on('entitySpawn', onSpawn);
  try {
    bot.activateItem();
    const until = Date.now() + confirmationMs;
    while (Date.now() < until) { task.check(); if (before - countOf(bot, held) >= 1 && thrown) return { at: Date.now(), targetId: target.id, target: target.name, item: held, ticks: solution.ticks, origin: { ...solution.origin }, aim: { ...solution.target } }; await sleep(50); }
    throw new Error('The throw lacks a matching projectile and one fewer carried');
  } finally { bot.removeListener('entitySpawn', onSpawn); bot.deactivateItem(); }
}
module.exports = { throwAt, THROWN, THROWABLE, ARROW, arrowPosition, bowSolution, clearShot, aimAtEntity, shootBow, sentAimMatches };
