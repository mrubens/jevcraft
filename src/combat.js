'use strict';
const { Vec3 } = require('vec3');
const { threats } = require('./danger');
const { checkAir } = require('./vitals');
const { durable, SHOOTERS, shooter } = require('./mob-policy');
const { countOf } = require('./skills');
const { bowSolution, aimAtEntity, shootBow } = require('./projectiles');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Mobs that shoot. A piglin counts only with a crossbow in hand; one with a
// sword is a melee mob and the charge rule's business.
const bowReady = bot => bot.inventory.items().some(i => i.name === 'bow' && durable(bot.registry, i)) && countOf(bot, 'arrow') > 0;

// Where to point the bow at a target this far off, moving this way: the
// vanilla arc solved from the eye. `drop` is how far the pitch rises above
// the straight line to cover gravity, `lead` how far ahead of the target the
// aim point sits to cover its motion. Pure: no bot, no world.
function aim(origin, target, velocity = new Vec3(0, 0, 0)) {
  const solution = bowSolution(origin, target, velocity);
  if (!solution) return null;
  const straight = target.minus(origin);
  const level = Math.atan2(straight.y, Math.hypot(straight.x, straight.z));
  return { yaw: solution.yaw, pitch: solution.pitch, ticks: solution.ticks, distance: straight.norm(),
    drop: solution.pitch - level, lead: solution.target.minus(target).norm(), aimPoint: solution.target };
}

// The shooters worth an arrow: in clear view, four to twenty blocks off,
// with a clear arc from where the bot stands, and a bow and arrows to hand.
function shotTargets(bot, danger, { minimum = 4, maximum = 20 } = {}) {
  if (!bowReady(bot)) return [];
  return danger.filter(t => shooter(t.entity) && t.visible && t.distance >= minimum && t.distance <= maximum && aimAtEntity(bot, t.entity));
}

// The shield goes up after a shot so the answer lands on it while the bot
// looks again, and comes down before anything that needs the hands: a swing,
// the next draw, a walk (a raised shield is sneaking speed).
function raiseShield(bot) {
  if (bot._shieldRaised || bot.inventory.slots?.[45]?.name !== 'shield') return false;
  bot.activateItem(true); bot._shieldRaised = true; return true;
}
function lowerShield(bot) {
  if (!bot._shieldRaised) return;
  bot.deactivateItem(); bot._shieldRaised = false;
}

// One arrow: bow in hand, aim with lead and drop, draw about a second,
// release, then cover behind the shield until the next observation.
async function shoot(bot, task, target, { guard, threatCheck, chargeMs = 1100, cover = true } = {}) {
  lowerShield(bot);
  try { return await shootBow(bot, task, target, { guard, threatCheck, chargeMs }); }
  finally { if (cover) raiseShield(bot); }
}

// Prefer carried combat equipment, then a mining tool, then bare hands. These
// are conservative equipment/cooldown policies, not predicted damage values.
function defenseWeapon(bot) {
  const classes = { sword: 500, axe: 450, trident: 480, pickaxe: 200, shovel: 180 };
  const materials = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'];
  const rank = item => {
    if (item.name === 'trident') return classes.trident;
    const parts = item.name.split('_'), kind = parts.at(-1);
    return classes[kind] ? classes[kind] + Math.max(0, materials.indexOf(parts[0])) * 20 : 0;
  };
  return bot.inventory.items().filter(item => rank(item) > 0).sort((a, b) => rank(b) - rank(a))[0];
}

function canStrike(bot, entity) {
  if (!entity?.position || entity.isValid === false) return false;
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const halfWidth = (entity.width || 0.6) / 2;
  const closest = entity.position.clone();
  closest.x = Math.max(entity.position.x - halfWidth, Math.min(eye.x, entity.position.x + halfWidth));
  closest.z = Math.max(entity.position.z - halfWidth, Math.min(eye.z, entity.position.z + halfWidth));
  closest.y = Math.max(entity.position.y, Math.min(eye.y, entity.position.y + (entity.height || 1.8)));
  if (eye.distanceTo(closest) > 3) return false;
  // A mob at arm's length is hittable whatever the ray says: on a staircase
  // the one a step up or down is hidden behind the stair edge from the eye
  // to its head, and it lands every hit while the bot waits for a clear
  // line. That is how the dream run died, in iron armour, without a swing.
  if (eye.distanceTo(closest) <= 2) return true;
  const aim = entity.position.offset(0, (entity.height || 1.8) / 2, 0), direction = aim.minus(eye);
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.1;
}

function strikeTarget(bot) {
  return threats(bot, 5).find(({ entity, visible, distance }) => (visible || distance <= 2) && canStrike(bot, entity));
}

// Immediate self-defense never chases a mob or chooses an unobserved target.
// One swing/cooldown slice returns to the survival controller so movement,
// health, air and new threats are observed again before the next action.
async function defendNearby(bot, task, goal, save) {
  task.check(); checkAir(bot);
  let threat = strikeTarget(bot);
  if (!threat) return false;
  const weapon = defenseWeapon(bot), kind = weapon?.name.split('_').at(-1);
  const cooldown = ({ sword: 700, axe: 1300, pickaxe: 950, shovel: 1200, trident: 1000 })[kind] || 300;
  const remaining = cooldown - (Date.now() - (bot._defenseAttackAt || 0));
  if (remaining > 0) {
    // Keep trying to retreat from a creeper between knockback attempts.
    if (threat.entity.name === 'creeper') return false;
    await sleep(Math.min(remaining, 100)); task.check(); checkAir(bot); return true;
  }
  bot.pathfinder.setGoal(null); bot.clearControlStates(); lowerShield(bot);
  if (weapon) await bot.equip(weapon, 'hand');
  else if (bot.heldItem) await bot.unequip('hand');
  task.check(); checkAir(bot);
  threat = strikeTarget(bot);
  if (!threat) return false;
  const target = threat.entity;
  await bot.lookAt(target.position.offset(0, (target.height || 1.8) / 2, 0), true);
  task.check(); checkAir(bot);
  if (bot.entities[target.id] !== target || target.isValid === false || strikeTarget(bot)?.entity !== target) return false;
  bot.attack(target); bot._defenseAttackAt = Date.now();
  // The shield comes up for the cooldown between swings: a wither skeleton
  // took twenty health in six seconds of unguarded swordplay. Not against
  // a creeper, which is struck and backed away from.
  if (target.name !== 'creeper' && bot.inventory.slots?.[45]?.name === 'shield') raiseShield(bot);
  goal.survivalAction = { action: 'defend', target: target.name, entityId: target.id,
    distance: Number(threat.distance.toFixed(2)), weapon: weapon?.name || 'bare hands', health: bot.health,
    at: new Date().toISOString() };
  save(); return true;
}

module.exports = { defenseWeapon, canStrike, strikeTarget, defendNearby, SHOOTERS, shooter, bowReady, aim, shotTargets, shoot, raiseShield, lowerShield };
