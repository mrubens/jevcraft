'use strict';
const { threats } = require('./danger');
const { checkAir } = require('./vitals');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function strikeTarget(bot) {
  const eye = bot.entity.position.offset(0, 1.62, 0);
  return threats(bot, 5).find(({ entity, visible }) => {
    if (!visible) return false;
    const halfWidth = (entity.width || 0.6) / 2;
    const closest = entity.position.clone();
    closest.x = Math.max(entity.position.x - halfWidth, Math.min(eye.x, entity.position.x + halfWidth));
    closest.z = Math.max(entity.position.z - halfWidth, Math.min(eye.z, entity.position.z + halfWidth));
    closest.y = Math.max(entity.position.y, Math.min(eye.y, entity.position.y + (entity.height || 1.8)));
    if (eye.distanceTo(closest) > 3) return false;
    const aim = entity.position.offset(0, (entity.height || 1.8) / 2, 0), direction = aim.minus(eye);
    const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
    return !hit || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.1;
  });
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
  bot.pathfinder.setGoal(null); bot.clearControlStates();
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
  goal.survivalAction = { action: 'defend', target: target.name, entityId: target.id,
    distance: Number(threat.distance.toFixed(2)), weapon: weapon?.name || 'bare hands', health: bot.health,
    at: new Date().toISOString() };
  save(); return true;
}

module.exports = { defenseWeapon, strikeTarget, defendNearby };
