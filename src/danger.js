'use strict';

const hostileNames = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'creeper', 'spider',
  'cave_spider', 'witch', 'pillager', 'vindicator', 'ravager', 'phantom', 'blaze', 'wither_skeleton', 'hoglin', 'zoglin']);

function threats(bot, radius = 24) {
  const position = bot.entity.position;
  const daytime = bot.time?.timeOfDay < 12000 || bot.time?.timeOfDay >= 23000;
  return Object.values(bot.entities || {}).filter(entity => {
    if (!hostileNames.has(entity.name) || !entity.position || entity.isValid === false) return false;
    if (entity.name === 'spider' && daytime && !(bot._recentHurtAt > Date.now() - 10000)) return false;
    return entity.position.distanceTo(position) <= radius;
  }).map(entity => {
    const distance = entity.position.distanceTo(position);
    const eye = position.offset(0, 1.5, 0);
    const target = entity.position.offset(0, Math.min(entity.height || 1.6, 1.6), 0);
    const direction = target.minus(eye);
    const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
    return { entity, distance, visible: !hit || eye.distanceTo(hit.intersect || hit.position) >= eye.distanceTo(target) - 0.5 };
  }).sort((a, b) => a.distance - b.distance);
}

function immediateThreat(bot) {
  return threats(bot).find(t => t.visible && t.distance <= (['skeleton', 'stray', 'bogged', 'pillager', 'witch', 'blaze'].includes(t.entity.name) ? 16 : 8));
}

class NeedsSafety extends Error {
  constructor(threat) { super(`Threat nearby: ${threat.entity.name} at ${Math.round(threat.distance)} blocks`); this.name = 'NeedsSafety'; }
}

function checkThreats(bot) {
  const threat = immediateThreat(bot);
  if (threat) throw new NeedsSafety(threat);
}

module.exports = { threats, immediateThreat, checkThreats, NeedsSafety };
