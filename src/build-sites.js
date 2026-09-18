'use strict';
const { Vec3 } = require('vec3');
const air = block => block && ['air', 'cave_air', 'void_air'].includes(block.name);

function reservedForConstruction(goal, p) {
  const house = goal.blueprint?.origin;
  if (house && Math.abs(p.x - house.x) <= 3 && Math.abs(p.z - house.z) <= 4 && p.y >= house.y - 4) return true;
  const portal = goal.portalFrame?.origin;
  return Boolean(portal && p.x >= portal.x - 1 && p.x <= portal.x + 4 &&
    Math.abs(p.z - portal.z) <= 2 && p.y >= portal.y - 4);
}

function portalSiteClear(bot, origin) {
  const o = new Vec3(origin.x, origin.y, origin.z);
  // Check the entire frame and both walking approaches at one ground level.
  for (let x = 0; x < 4; x++) for (let z = -1; z <= 1; z++) {
    if (bot.blockAt(o.offset(x, -1, z))?.boundingBox !== 'block') return false;
    for (let y = 0; y < (z === 0 ? 5 : 2); y++) if (!air(bot.blockAt(o.offset(x, y, z)))) return false;
  }
  return true;
}

function selectPortalSite(bot) {
  const feet = bot.entity.position.floored();
  const ids = ['grass_block', 'dirt', 'stone', 'sand'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const surfaces = bot.findBlocks({ matching: ids, maxDistance: 24, count: 128,
    useExtraInfo: b => air(bot.blockAt(b.position.offset(0, 1, 0))) && air(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0)).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet));
  return surfaces.find(p => portalSiteClear(bot, p)) || null;
}

module.exports = { reservedForConstruction, portalSiteClear, selectPortalSite };
