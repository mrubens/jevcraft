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
// Wool and the wart blocks too: full blocks that hold where they are put,
// as a wall, a floor under one or a block in a shooter's line. mid-242-bb-
// fortress-5 stood at the end of its span over the lava sea with nine wool
// and fourteen gravel, a ghast in sight, told "buildingBlocks: 0" and "too
// few blocks carried (14) to wall the 3 open sides (6, 3 of them floors
// ..., which gravel or sand does not make)", and offered no cover; the
// fireball pushed it off the span's end into the lava (note 619). They are
// put last (buildingItem): the wool is a bed's, and neither holds against a
// blast.
const LAST_MATERIALS = new Set([...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
  'brown', 'green', 'red', 'black'].map(c => `${c}_wool`), 'nether_wart_block', 'warped_wart_block']);
// The woods of the Nether: full blocks that do not burn (the oak family does,
// beside lava), laid in a span or a pillar when the rock is gone (note 635).
const NETHER_WOOD = ['warped_planks', 'crimson_planks', 'warped_stem', 'crimson_stem', 'warped_hyphae', 'crimson_hyphae',
  'stripped_warped_stem', 'stripped_crimson_stem', 'stripped_warped_hyphae', 'stripped_crimson_hyphae'];
const buildingMaterials = new Set(['dirt', 'cobblestone', 'cobbled_deepslate', ...plankMaterials, 'andesite', 'diorite', 'granite', 'stone',
  'netherrack', 'nether_bricks', 'blackstone', 'basalt', 'tuff', 'deepslate', 'end_stone', ...LAST_MATERIALS]);
// The stack a block is put from: one of `need` or more, the wool and the
// wart blocks only when nothing else is.
function buildingItem(bot, need = 1) {
  const items = bot.inventory.items().filter(i => buildingMaterials.has(i.name) && i.count >= need);
  return items.find(i => !LAST_MATERIALS.has(i.name)) || items[0] || null;
}
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
// A cell that holds a block the game never lets be dug or built over, and
// that is not a body of water or lava: a nether portal's sheet, an end portal
// or gateway, a light block. It cannot be dug out and nothing can be placed
// in it, so it is not a cell the bot can wall; it is left as it is, and not
// counted missing (mid-244-bg tried to dig a portal 128 times: "seal_shelter
// failed: Cannot dig nether_portal"; note 649). Bedrock, a barrier and an end
// portal frame are full blocks and already count as walls (solid). Water and
// lava are diggable in the game's data and are gaps to be filled.
const FLUIDS = new Set(['water', 'lava', 'bubble_column']);
const fixed = b => !!b && b.diggable === false && !FLUIDS.has(b.name) && !replaceable(b);
function missingShell(bot, shelter) {
  const floorY = shelter.kind !== 'house' ? position(shelter.origin).y - 1 : null;
  return enclosure(shelter).filter(p => { const b = bot.blockAt(p); return !(p.y === floorY ? floorSolid : solid)(b) && !fixed(b) && !enclosedAir(bot, p); });
}
function inside(bot, shelter) {
  if (shelter.dimension !== bot.game.dimension) return false;
  // The cell the body is in, by what it rests on (terrain.js feetCell): on
  // farmland or a path block the floored feet are that block's own cell,
  // and 25588 (18:14Z, note 755b), standing in its pocket at y 72.9 on
  // farmland, read as outside it: every pass walked "1 block" to it, placed
  // nothing and threw "Shelter verification failed", every five seconds
  // for nine minutes.
  const feet = require('./terrain').feetCell(bot), o = position(shelter.origin);
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
// A pocket shut but not whole: the bot at its cell, the cells a walker
// comes in by or strikes from (the four sides at the feet and the head, and
// the one over the head) closed, and every cell of the shell still open
// holding lava or water, which no block is placed into (work.js place).
// mid-242-jb (25591, 22:37Z on 2026-09-29) sealed against a skeleton at a
// fortress's edge, a lava cell at a corner of its shell: never sealed by the
// shell's count, pocket_next was never asked, and the bot stood eleven
// minutes walled in by its own netherrack, every plan question asked as if
// it stood in the open (note 697). -> the open cells, or null.
function closedIn(bot, shelter) {
  if (!shelter || shelter.kind === 'house' || !inside(bot, shelter)) return null;
  const o = position(shelter.origin);
  if (!floorSolid(bot.blockAt(o.offset(0, -1, 0))) || !replaceable(bot.blockAt(o)) || !replaceable(bot.blockAt(o.offset(0, 1, 0)))) return null;
  const walkers = [...directions.flatMap(d => [o.plus(d), o.plus(d).offset(0, 1, 0)]), o.offset(0, 2, 0)];
  if (!walkers.every(p => solid(bot.blockAt(p)) || fixed(bot.blockAt(p)))) return null;
  const open = missingShell(bot, shelter);
  if (!open.length || !open.every(p => /^(lava|water|bubble_column)$/.test(bot.blockAt(p)?.name || ''))) return null;
  return open.map(p => ({ x: p.x, y: p.y, z: p.z, name: bot.blockAt(p).name }));
}
function materialStock(bot) {
  return bot.inventory.items().filter(i => buildingMaterials.has(i.name)).reduce((total, i) => total + i.count, 0);
}
// The planks the logs and stems carried make in the hand (a two-by-two
// craft, no table): the most of one kind. mid-243-ad stood on its span
// under a ghast's fire told "too few blocks carried (3) to wall", with five
// oak logs in the pack, twenty planks (note 563; mid-235-q's four oak logs
// and three crimson stems, note 541).
function plankCraft(bot) {
  const stock = {};
  for (const item of bot.inventory.items()) stock[item.name] = (stock[item.name] || 0) + item.count;
  return plankCrafts(stock)[0] || null;
}
function plankCrafts(stock) {
  return plankMaterials.flatMap(item => recipes[item].flatMap(recipe => {
    if (recipe.shape || recipe.ingredients?.length !== 1) return [];
    const counts = recipe.ingredients[0].map(input => stock[input] || 0).filter(count => count > 0);
    const available = counts.length ? Math.min(...counts) * recipe.count : 0;
    return available > 0 ? [{ item, available }] : [];
  })).sort((a, b) => b.available - a.available);
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

module.exports = { wetBelow, foundation, shell, enclosure, safeSite, shelterSites, missingShell, inside, sealed, closedIn, materialStock, supplyTarget, plankCraft, exits, closures, buildingMaterials, buildingItem, LAST_MATERIALS, NETHER_WOOD, solid, replaceable, fixed };
