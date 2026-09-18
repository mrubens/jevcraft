'use strict';
const { Vec3 } = require('vec3');
const { reservedForConstruction } = require('./build-sites');
const directions = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const replaceable = b => b && ['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'leaf_litter'].includes(b.name);
const solid = b => b?.boundingBox === 'block' && !['sand', 'gravel', 'magma_block', 'cactus', 'powder_snow', 'ice', 'packed_ice', 'blue_ice'].includes(b.name);
const position = p => new Vec3(p.x, p.y, p.z);
const buildingMaterials = new Set(['dirt', 'cobblestone', 'cobbled_deepslate', 'oak_planks', 'birch_planks', 'andesite', 'diorite', 'granite', 'stone']);

function shell(origin) {
  const o = position(origin);
  const blocks = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (x || z) for (let y = 0; y < 2; y++) blocks.push(o.offset(x, y, z));
    blocks.push(o.offset(x, 2, z));
  }
  return blocks;
}

function safeSite(bot, origin, goal) {
  const o = position(origin);
  if (reservedForConstruction(goal, o)) return false;
  if (!replaceable(bot.blockAt(o)) || !replaceable(bot.blockAt(o.offset(0, 1, 0)))) return false;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (!solid(bot.blockAt(o.offset(x, -1, z)))) return false;
  if (!exits(bot, { origin }).length) return false;
  return shell(o).every(p => {
    const b = bot.blockAt(p);
    return replaceable(b) || solid(b);
  });
}

function shelterSites(bot, goal, maxDistance = 12) {
  const ids = ['grass_block', 'dirt', 'stone', 'sand', 'gravel'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const spots = bot.findBlocks({ matching: ids, maxDistance, count: 128,
    useExtraInfo: b => replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0));
  spots.unshift(bot.entity.position.floored());
  return spots.filter(p => safeSite(bot, p, goal)).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

function missingShell(bot, shelter) { return shell(shelter.origin).filter(p => !solid(bot.blockAt(p))); }
function inside(bot, shelter) {
  return shelter.dimension === bot.game.dimension && bot.entity.position.floored().equals(position(shelter.origin));
}
function sealed(bot, shelter) {
  const o = position(shelter.origin);
  return !missingShell(bot, shelter).length && solid(bot.blockAt(o.offset(0, -1, 0))) &&
    replaceable(bot.blockAt(o)) && replaceable(bot.blockAt(o.offset(0, 1, 0)));
}
function materialStock(bot) {
  return bot.inventory.items().filter(i => buildingMaterials.has(i.name)).reduce((total, i) => total + i.count, 0);
}
function exits(bot, shelter) {
  const o = position(shelter.origin);
  return directions.map(d => ({ door: o.plus(d), outside: o.plus(d.scaled(2)) }))
    .filter(exit => replaceable(bot.blockAt(exit.outside)) && replaceable(bot.blockAt(exit.outside.offset(0, 1, 0))) && solid(bot.blockAt(exit.outside.offset(0, -1, 0))));
}

module.exports = { shell, safeSite, shelterSites, missingShell, inside, sealed, materialStock, exits, buildingMaterials, solid, replaceable };
