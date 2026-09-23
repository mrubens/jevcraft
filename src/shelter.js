'use strict';
const { Vec3 } = require('vec3');
const { reservedForConstruction } = require('./build-sites');
const { recipes } = require('../data/vanilla-26.1.json');
const directions = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const replaceable = b => b && ['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'leaf_litter'].includes(b.name);
const solid = b => b?.boundingBox === 'block' && !['sand', 'gravel', 'magma_block', 'cactus', 'powder_snow', 'ice', 'packed_ice', 'blue_ice'].includes(b.name);
const position = p => new Vec3(p.x, p.y, p.z);
const plankMaterials = Object.keys(recipes).filter(name => name.endsWith('_planks'));
// Nether stone too: cornered by a hoglin with sixty netherrack in the
// pockets, the bot had "no blocks" to wall itself off with.
const buildingMaterials = new Set(['dirt', 'cobblestone', 'cobbled_deepslate', ...plankMaterials, 'andesite', 'diorite', 'granite', 'stone',
  'netherrack', 'nether_bricks', 'blackstone', 'basalt', 'tuff', 'deepslate', 'end_stone']);
const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);

function foundation(origin) {
  const o = position(origin), blocks = [];
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) blocks.push(o.offset(x, -1, z));
  return blocks;
}

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
  // Begin on real dry footing. Missing peripheral floor cells can be built
  // outward from that anchor; water, falling blocks and unloaded cells cannot.
  if (!solid(bot.blockAt(o.offset(0, -1, 0)))) return false;
  if (foundation(o).some(p => { const b = bot.blockAt(p); return !solid(b) && !air(b); })) return false;
  // A pocket in a one-wide staircase has no two-block exit and never will;
  // buried, the way out in the morning is dug, so the exit is not required.
  if (!exits(bot, { origin }).length && !buried(bot, o)) return false;
  return shell(o).every(p => {
    const b = bot.blockAt(p);
    return replaceable(b) || solid(b);
  });
}

// Anything solid between the site and the sky: a staircase, a cave, a
// shaft. Twelve blocks of headroom in a cave at y=14 is not the surface.
function buried(bot, o) {
  const top = (bot.game?.minY ?? -64) + (bot.game?.height ?? 384);
  for (let y = o.y + 1; y < top; y++) {
    const b = bot.blockAt(new Vec3(o.x, y, o.z));
    if (!b) return false;
    if (b.boundingBox === 'block' || ['water', 'lava'].includes(b.name)) return true;
  }
  return false;
}

function shelterSites(bot, goal, maxDistance = 12) {
  const ids = ['grass_block', 'dirt', 'stone', 'sand', 'gravel'].map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const spots = bot.findBlocks({ matching: ids, maxDistance, count: 128,
    useExtraInfo: b => replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
  }).map(p => p.offset(0, 1, 0));
  spots.unshift(bot.entity.position.floored());
  const here = bot.entity.position;
  const safe = spots.filter(p => safeSite(bot, p, goal)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
  // Ground a night mine can go down into: of the nearest dozen, those with
  // no water or lava in the rock below and around come first. The dream run
  // sealed in beside a flooded cave, every way down was refused, and the
  // night was waited out. Distance decides between equally dry sites.
  const wet = new Map(safe.slice(0, 12).map(p => [p, wetBelow(bot, p)]));
  return safe.sort((a, b) => ((wet.get(a) ?? 0) > 0) - ((wet.get(b) ?? 0) > 0) || a.distanceTo(here) - b.distanceTo(here));
}

// Liquid in a sparse sample of the rock under a site: four blocks round,
// eight down, every other block.
function wetBelow(bot, origin) {
  let n = 0;
  for (let dx = -4; dx <= 4; dx += 2) for (let dz = -4; dz <= 4; dz += 2) for (let dy = -1; dy >= -8; dy -= 2) {
    if (/water|lava/.test(bot.blockAt(origin.offset(dx, dy, dz))?.name || '')) n++;
  }
  return n;
}

function enclosure(shelter) {
  if (shelter.kind !== 'house') return [...foundation(shelter.origin), ...shell(shelter.origin)];
  const o = position(shelter.origin);
  return [...shelter.blueprint.blocks.map(position), o.offset(0, 0, -2), o.offset(0, 1, -2)];
}
// An air cell in the shell with solid blocks on all six sides is as shut as
// a placed block: nothing can reach it, and the builder will not fill it
// (a buried cell counts as complete there). Counting it as missing made
// one shelter fail verification forever after every reachable cell was in.
const enclosedAir = (bot, p) => replaceable(bot.blockAt(p)) &&
  [new Vec3(0, 1, 0), new Vec3(0, -1, 0), ...directions].every(d => bot.blockAt(p.plus(d))?.boundingBox === 'block');
// Sand or gravel under the shell is floor: it falls only into a hole, and
// nothing comes up through it. Counted missing, it could never be filled
// (the cell is full), and the live bot, walled in on a sand bar at sea,
// sealed the same pocket fourteen times a second.
const floorSolid = b => b?.boundingBox === 'block' && !['magma_block', 'cactus', 'powder_snow'].includes(b.name);
function missingShell(bot, shelter) {
  const floorY = shelter.kind !== 'house' ? position(shelter.origin).y - 1 : null;
  return enclosure(shelter).filter(p => !(p.y === floorY ? floorSolid : solid)(bot.blockAt(p)) && !enclosedAir(bot, p));
}
function inside(bot, shelter) {
  if (shelter.dimension !== bot.game.dimension) return false;
  const feet = bot.entity.position.floored(), o = position(shelter.origin);
  return shelter.kind === 'house' ? Math.abs(feet.x - o.x) <= 1 && Math.abs(feet.z - o.z) <= 1 && feet.y >= o.y && feet.y < o.y + 2 : feet.equals(o);
}
function sealed(bot, shelter) {
  const o = position(shelter.origin);
  if (shelter.kind === 'house') return !missingShell(bot, shelter).length && shelter.blueprint.empty
    .filter(p => !(p.x === o.x && p.z === o.z - 2))
    .every(p => replaceable(bot.blockAt(position(p))));
  return !missingShell(bot, shelter).length && floorSolid(bot.blockAt(o.offset(0, -1, 0))) &&
    replaceable(bot.blockAt(o)) && replaceable(bot.blockAt(o.offset(0, 1, 0)));
}
function materialStock(bot) {
  return bot.inventory.items().filter(i => buildingMaterials.has(i.name)).reduce((total, i) => total + i.count, 0);
}
function supplyTarget(bot, shortage) {
  const stock = {};
  for (const item of bot.inventory.items()) stock[item.name] = (stock[item.name] || 0) + item.count;
  // Prefer a single inventory craft over gathering. These recipes also cover
  // stripped wood, Nether stems and bamboo blocks, with their actual yields.
  // Cap the target at carried inputs so this step never goes hunting more wood.
  const crafts = plankMaterials.flatMap(item => recipes[item].flatMap(recipe => {
    if (recipe.shape || recipe.ingredients?.length !== 1) return [];
    // A catalog craft batch selects one ingredient variant for all crafts.
    // Mixed log/stripped-wood stacks cannot be summed into a single batch:
    // bound it by every carried variant the planner could select instead.
    const counts = recipe.ingredients[0].map(input => stock[input] || 0).filter(count => count > 0);
    const available = counts.length ? Math.min(...counts) * recipe.count : 0;
    return available > 0 ? [{ item, available }] : [];
  })).sort((a, b) => b.available - a.available);
  if (crafts.length) {
    const { item, available } = crafts[0];
    return { item, count: (stock[item] || 0) + Math.min(shortage, available) };
  }
  return { item: 'dirt', count: (stock.dirt || 0) + shortage };
}
function exits(bot, shelter) {
  const o = position(shelter.origin);
  return (shelter.kind === 'house' ? [{ door: o.offset(0, 0, -2), outside: o.offset(0, 0, -3) }] :
    directions.map(d => ({ door: o.plus(d), outside: o.plus(d.scaled(2)) })))
    .filter(exit => replaceable(bot.blockAt(exit.outside)) && replaceable(bot.blockAt(exit.outside.offset(0, 1, 0))) && solid(bot.blockAt(exit.outside.offset(0, -1, 0))))
    // A door is dug through, so it must be shell or rock, never the bed or
    // the chest the shell happened to lean on: the second run's base lost
    // both that way in one night.
    .filter(exit => shelter.kind === 'house' || [exit.door, exit.door.offset(0, 1, 0)].every(p => { const b = bot.blockAt(p); return replaceable(b) || buildingMaterials.has(b?.name); }));
}

// Side cells of a sealed pocket that the bot closed with its own blocks:
// the doors of a shelter that has no two-block exit. Nearest a passable
// cell beyond first, so the door opens back onto the staircase.
function closures(bot, shelter) {
  const o = position(shelter.origin);
  const doors = directions.map(d => o.plus(d))
    .filter(door => buildingMaterials.has(bot.blockAt(door)?.name) && buildingMaterials.has(bot.blockAt(door.offset(0, 1, 0))?.name))
    .sort((a, b) => beyond(bot, o, b) - beyond(bot, o, a));
  // Natural stone is a building material too; a door with nothing open
  // behind it is a wall. Only when no side opens onto anything is any wall
  // worth digging through.
  const onto = doors.filter(door => beyond(bot, o, door) > 0);
  return onto.length ? onto : doors;
}
function beyond(bot, o, door) {
  const d = door.minus(o);
  return [-1, 0, 1].filter(dy => replaceable(bot.blockAt(door.plus(d).offset(0, dy, 0)))).length;
}

module.exports = { wetBelow, foundation, shell, enclosure, safeSite, shelterSites, missingShell, inside, sealed, materialStock, supplyTarget, exits, closures, buildingMaterials, solid, replaceable };
