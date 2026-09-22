'use strict';
const { move } = require('./motion');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute, navigate } = require('./skills');
const { dryStanding } = require('./mining-access');
const { fallDanger, recoverFall } = require('./fall-recovery');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cloudRadius(bot, entity) {
  const index = bot.registry.entitiesByName.area_effect_cloud.metadataKeys.indexOf('radius');
  return Math.max(1, Number(entity.metadata?.[index]) || 3) + 2;
}
function hazardDistance(point, entity) {
  if (entity.name !== 'area_effect_cloud') return point.distanceTo(entity.position);
  if (Math.abs(point.y - entity.position.y) > 3) return Infinity;
  return Math.hypot(point.x - entity.position.x, point.z - entity.position.z);
}
function breathThreat(bot) {
  const entities = Object.values(bot.entities).filter(e => e.isValid !== false);
  return entities.find(e => e.name === 'area_effect_cloud' && hazardDistance(bot.entity.position, e) <= cloudRadius(bot, e)) ||
    entities.find(e => e.name === 'dragon_fireball' && e.position.distanceTo(bot.entity.position) < 18);
}

function dragonThreat(bot) {
  const p = bot.entity.position;
  return Object.values(bot.entities).find(e => {
    if (e.name !== 'ender_dragon' || e.isValid === false) return false;
    const phase = e.metadata?.[bot.registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')];
    // Sitting dragons expose their head for melee. Flying bodies/wings and
    // the explicit charging phase need an immediate movement response.
    if ([5, 6, 7, 9].includes(phase)) return false;
    const height = e.position.y - p.y, distance = Math.hypot(e.position.x - p.x, e.position.z - p.z);
    return phase === 8 && distance < 72 && height > -12 && height < 32 ||
      distance < 18 && height > -6 && height < 14;
  });
}
function endEmergency(bot) {
  if (fallDanger(bot)) return 'dangerous_fall';
  const breath = breathThreat(bot);
  if (breath) return breath.name === 'area_effect_cloud' ? 'dragon_breath_cloud' : 'incoming_dragon_fireball';
  if (dragonThreat(bot)) return 'dragon_charge_or_contact';
  return null;
}
function checkEndEmergency(bot) {
  const reason = endEmergency(bot);
  if (reason) throw Object.assign(new Error(reason), { name: 'EndEmergency' });
}

// A short level corridor is checked across the player's footprint. Running
// sideways can evade a charge; jumping blindly near an island edge cannot.
function dodgeRoutes(bot, dragon, allowed = () => true) {
  const start = bot.entity.position.clone(), toward = dragon.position.minus(start); toward.y = 0;
  const line = toward.norm() > .01 ? toward.unit() : new Vec3(0, 0, 1);
  const directions = [new Vec3(-line.z, 0, line.x), new Vec3(line.z, 0, -line.x), line.scaled(-1)];
  const routes = [];
  for (const direction of directions) {
    let distance = 0;
    // Include the executor's .8-block lookahead; half-block samples can miss
    // a narrow diagonal corner crossed by the player's bounding box.
    for (let sample = 1; sample <= 40; sample++) {
      const d = sample * .2;
      const center = start.plus(direction.scaled(d));
      if (!allowed(center) || ![-.3, .3].every(x => [-.3, .3].every(z => {
        const p = center.offset(x, 0, z);
        return dryStanding(bot, p) && Math.abs(p.y - Math.round(p.y)) < .12;
      }))) break;
      distance = d;
    }
    if (distance >= 2) routes.push({ direction, distance, destination: start.plus(direction.scaled(distance)) });
  }
  return routes;
}

async function evadeOverTerrain(bot, task, goal, save, dragon, { allowed = () => true, walk = navigate } = {}) {
  const start = bot.entity.position.clone(), dimension = bot.game.dimension, toward = dragon.position.minus(start); toward.y = 0;
  const check = () => {
    task.check();
    if (bot.game.dimension !== dimension || bot.health <= 0 || bot.isAlive === false) throw new Error('Terrain evasion interrupted by death or dimension change');
  };
  check();
  const bearing = Math.atan2(toward.z, toward.x), candidates = [];
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI * .75, -Math.PI * .75, Math.PI * .25, -Math.PI * .25]) {
    const direction = new Vec3(Math.cos(bearing + angle), 0, Math.sin(bearing + angle));
    for (const distance of [4, 6]) for (const dy of [0, -1, 1, -2, 2]) {
      const p = start.plus(direction.scaled(distance)).floored().offset(.5, dy, .5);
      if (allowed(p) && dryStanding(bot, p)) { candidates.push(p); break; }
    }
  }
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allowSprinting: movement.allowSprinting, maxDropDown: movement.maxDropDown,
    allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks };
  Object.assign(movement, { canDig: false, allowSprinting: true, maxDropDown: 1, allow1by1towers: false, scafoldingBlocks: [] });
  try {
    for (const p of candidates.slice(0, 8)) {
      check();
      if (fallDanger(bot)) return await recoverFall(bot, task, goal, save);
      if (bot.entity.onGround === false || bot.entity.position.distanceTo(start) > .75) return false;
      const destination = new goals.GoalBlock(Math.floor(p.x), p.y, Math.floor(p.z));
      const route = await surveyRoute(bot, task, movement, destination, 100);
      check();
      if (bot.entity.onGround === false || bot.entity.position.distanceTo(start) > .75) return false;
      if (route.status !== 'success' || route.path.some(n => n.toBreak?.length || n.toPlace?.length ||
        !allowed(new Vec3(n.x + .5, n.y, n.z + .5)))) continue;
      goal.step = { action: 'evade_dragon_over_terrain', from: { ...start }, destination: { ...p } }; save();
      try {
        await walk(bot, task, destination, { timeoutMs: 3000, stallMs: 1000, stopWhen: () => fallDanger(bot) });
      } catch (err) {
        check();
        if (!fallDanger(bot)) {
          goal.endCombat.lastEvasionInterrupted = { at: Date.now(), reason: err.message }; save(); return false;
        }
      }
      check();
      if (fallDanger(bot)) await recoverFall(bot, task, goal, save);
      const evidence = { at: Date.now(), from: { ...start }, to: { ...bot.entity.position }, hazard: { id: dragon.id, name: dragon.name }, terrainRoute: true };
      goal.endCombat.lastEvasion = evidence; save(); bot.emit('end_combat', { evasion: evidence }); return true;
    }
    throw Object.assign(new Error('No surveyed walking escape from the dragon on loaded terrain'), { name: 'Blocked' });
  } finally { bot.pathfinder.setGoal(null); bot.clearControlStates(); Object.assign(movement, previous); }
}

async function evadeDragon(bot, task, goal, save, { allowed, timeoutMs = 1600 } = {}) {
  task.check();
  const dimension = bot.game.dimension;
  bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.stopDigging?.();
  const check = () => {
    task.check();
    if (bot.game.dimension !== dimension || bot.health <= 0 || bot.isAlive === false) throw new Error('Dragon evasion interrupted by death or dimension change');
  };
  try {
    // Even a small wing hit briefly lifts the feet off the ground. Surveying
    // that fractional Y as a standing level falsely reports a terrain trap.
    // Let ordinary physics land small hops; escalating launches immediately
    // hand over to the water recovery instead of waiting for impact.
    const landingDeadline = Date.now() + 2000;
    while (bot.entity.onGround === false) {
      check();
      if (fallDanger(bot)) return await recoverFall(bot, task, goal, save);
      if (Date.now() >= landingDeadline) {
        goal.step = { action: 'await_knockback_landing', position: { ...bot.entity.position } }; save(); return false;
      }
      await sleep(10);
    }
    const dragon = breathThreat(bot) || dragonThreat(bot);
    if (!dragon) return false;
    const route = dodgeRoutes(bot, dragon, allowed)[0];
    if (!route) return await evadeOverTerrain(bot, task, goal, save, dragon, { allowed });
    const start = bot.entity.position.clone();
    // use normal movement packets, never position edits
    await bot.look(Math.atan2(-route.direction.x, -route.direction.z), 0, true); check();
    goal.step = { action: 'evade_dragon', hazard: dragon.name, from: { ...start }, destination: { ...route.destination } }; save();
    // Each step ahead is checked before it is taken; the run stops at the
    // first cell that is not dry, allowed ground, or at any sign of a fall.
    const stepOk = () => { const next = bot.entity.position.plus(route.direction.scaled(.8));
      return !(allowed && !allowed(next)) && [-.3, .3].every(x => [-.3, .3].every(z => dryStanding(bot, next.offset(x, 0, z)))); };
    await move(bot, { check }, { label: 'evade_dragon', keys: ['forward', 'sprint'], sneak: false, why: 'sprinting from the dragon along a checked route',
      maxMs: timeoutMs, until: () => bot.entity.position.distanceTo(start) >= route.distance - .7 || fallDanger(bot) || !stepOk() });
    if (fallDanger(bot)) await recoverFall(bot, task, goal, save);
    check();
    if (bot.entity.position.distanceTo(start) < .2) {
      bot.clearControlStates();
      return await evadeOverTerrain(bot, task, goal, save, dragon, { allowed });
    }
    const evidence = { at: Date.now(), from: { ...start }, to: { ...bot.entity.position }, hazard: { id: dragon.id, name: dragon.name } };
    goal.endCombat.lastEvasion = evidence; save(); bot.emit('end_combat', { evasion: evidence });
    return true;
  } finally { bot.clearControlStates(); }
}
module.exports = { cloudRadius, hazardDistance, breathThreat, dragonThreat, endEmergency, checkEndEmergency, dodgeRoutes, evadeOverTerrain, evadeDragon };
