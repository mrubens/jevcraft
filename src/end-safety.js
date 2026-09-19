'use strict';
const { Vec3 } = require('vec3');
const { dryStanding } = require('./mining-access');
const { fallDanger, recoverFall } = require('./fall-recovery');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    for (let d = .5; d <= 8; d += .5) {
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
    const dragon = dragonThreat(bot);
    if (!dragon) return false;
    const route = dodgeRoutes(bot, dragon, allowed)[0];
    if (!route) throw Object.assign(new Error('No observed level ground to evade the approaching dragon'), { name: 'Blocked' });
    const start = bot.entity.position.clone();
    // use normal movement packets, never position edits
    await bot.look(Math.atan2(-route.direction.x, -route.direction.z), 0, true); check();
    goal.step = { action: 'evade_dragon', from: { ...start }, destination: { ...route.destination } }; save();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && bot.entity.position.distanceTo(start) < route.distance - .7) {
      check();
      if (fallDanger(bot)) { await recoverFall(bot, task, goal, save); break; }
      const next = bot.entity.position.plus(route.direction.scaled(.8));
      if (allowed && !allowed(next) || ![-.3, .3].every(x => [-.3, .3].every(z => dryStanding(bot, next.offset(x, 0, z))))) break;
      bot.setControlState('forward', true); bot.setControlState('sprint', true);
      await sleep(25);
    }
    check();
    const evidence = { at: Date.now(), from: { ...start }, to: { ...bot.entity.position }, dragonId: dragon.id };
    goal.endCombat.lastEvasion = evidence; save(); bot.emit('end_combat', { evasion: evidence });
    return true;
  } finally { bot.clearControlStates(); }
}
module.exports = { dragonThreat, endEmergency, checkEndEmergency, dodgeRoutes, evadeDragon };
