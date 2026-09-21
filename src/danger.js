'use strict';
const { handlers, readyEquipment, observedDead } = require('./mob-policy');

// The Nether's own mobs were missing: a magma cube killed the dream run in
// two seconds while the bot searched for blazes, and nothing fled or swung.
const hostileNames = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'creeper', 'spider',
  'cave_spider', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'phantom', 'blaze', 'wither_skeleton', 'hoglin', 'zoglin',
  'magma_cube', 'slime', 'ghast', 'piglin', 'piglin_brute', 'silverfish', 'endermite', 'warden', 'breeze']);
const ranged = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'witch', 'blaze', 'ghast', 'breeze']);

function combatTarget(bot, entity) {
  const encounter = bot._combatEncounter;
  return !!encounter && encounter.target === entity && Object.hasOwn(handlers, entity.name) &&
    bot.entities[entity.id] === entity && entity.isValid !== false && !encounter.task.cancelled &&
    encounter.dimension === bot.game?.dimension && encounter.expiresAt > Date.now() &&
    bot.health >= 12 && bot.food >= 12 && readyEquipment(bot, ['bow']);
}

function provokedEnderman(bot, entity) {
  if (entity.name !== 'enderman') return false;
  const key = bot.registry?.entitiesByName?.enderman?.metadataKeys?.indexOf('creepy');
  return bot._provokedMobs?.get(entity.id) === entity || (key >= 0 && !!entity.metadata?.[key]);
}

function hostileEntities(bot, radius = 24) {
  const position = bot.entity.position;
  const daytime = bot.time?.timeOfDay < 12000 || bot.time?.timeOfDay >= 23000;
  return Object.values(bot.entities || {}).filter(entity => {
    if ((!hostileNames.has(entity.name) && !provokedEnderman(bot, entity)) || !entity.position || entity.isValid === false || observedDead(bot, entity)) return false;
    if (entity.name === 'spider' && daytime && !(bot._recentHurtAt > Date.now() - 10000)) return false;
    return entity.position.distanceTo(position) <= radius;
  });
}

function threats(bot, radius = 24) {
  const position = bot.entity.position;
  return hostileEntities(bot, radius).map(entity => {
    const distance = entity.position.distanceTo(position);
    const eye = position.offset(0, 1.5, 0);
    const target = entity.position.offset(0, Math.min(entity.height || 1.6, 1.6), 0);
    const direction = target.minus(eye);
    const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
    return { entity, distance, visible: !hit || eye.distanceTo(hit.intersect || hit.position) >= eye.distanceTo(target) - 0.5 };
  }).sort((a, b) => a.distance - b.distance);
}

function immediateThreat(bot) {
  return threats(bot).find(t => !combatTarget(bot, t.entity) && t.visible && t.distance <= (ranged.has(t.entity.name) ? 16 : 8));
}

// Keep a route outside attack range plus a movement margin. If a mob already
// approached us, allow retreat without forcing a path to start outside the
// buffer. Cover is intentionally not an invitation to tunnel toward a mob.
// Whether a mob has a line of sight to the bot. One behind twenty blocks of
// rock cannot shoot, and underground there is always one somewhere: the
// dream run could not dig a staircase toward a skeleton in the next cave.
function seen(bot, entity) {
  const eye = bot.entity.position.offset(0, 1.5, 0);
  const target = entity.position.offset(0, Math.min(entity.height || 1.6, 1.6), 0);
  const direction = target.minus(eye);
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= eye.distanceTo(target) - 0.5;
}

function safeFromHostiles(bot, point, entities = hostileEntities(bot, 64)) {
  if (bot.game?.gameMode === 'creative' || bot.game?.difficulty === 'peaceful') return true;
  return entities.every(entity => {
    if (combatTarget(bot, entity)) return true;
    // Out of sight, a mob only matters when it is nearly at the wall.
    const radius = !seen(bot, entity) ? 6 : ranged.has(entity.name) ? 20 : 12;
    return entity.position.distanceTo(point) >= Math.min(radius, entity.position.distanceTo(bot.entity.position) - 0.25);
  });
}

class NeedsSafety extends Error {
  constructor(threat) { super(`Threat nearby: ${threat.entity.name} at ${Math.round(threat.distance)} blocks`); this.name = 'NeedsSafety'; }
}

function checkThreats(bot) {
  const threat = immediateThreat(bot);
  if (threat) throw new NeedsSafety(threat);
}

module.exports = { hostileEntities, threats, immediateThreat, checkThreats, safeFromHostiles, NeedsSafety, combatTarget, provokedEnderman };
