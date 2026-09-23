'use strict';
// Terrain drills: the places that killed or stalled the bot on the live run,
// staged in a minute. The combat arena made fights measurable; these do the
// same for ground. Each one names what happened live, builds it with console
// commands on the isolated arena server, runs the real code against it, and
// says whether the bot got through without dying, falling or pacing.
//
// Coordinates are far from the combat arenas. Every build clears its box
// first, so a drill leaves nothing the next run inherits.
const { Vec3 } = require('vec3');

const at = (dimension, command) => `execute in minecraft:${dimension} run ${command}`;

// A place captured from the live world (a spectator probe's block dump) and
// rebuilt at an offset: the box filled with stone, then each row's runs of
// air and water laid with one fill each. Every water cell is laid as a
// source (left as air, the flowing part drained and the pool was dry); every
// solid block is stone, since what matters is where the rock is.
function capturedBuild(file, to) {
  const cap = require(file), { origin, size, cells } = cap;
  const dx = to[0] - origin.x, dy = to[1] - origin.y, dz = to[2] - origin.z;
  const kind = name => /^water/.test(name) ? 'water' : /air$|^air|torch|_carpet|snow$/.test(name) ? 'air' : 'stone';
  const x1 = origin.x + dx, y1 = origin.y + dy, z1 = origin.z + dz;
  const lines = [`forceload add ${x1 - 8} ${z1 - 8} ${x1 + size.x + 8} ${z1 + size.z + 8}`,
    `fill ${x1 - 2} ${y1 - 2} ${z1 - 2} ${x1 + size.x + 1} ${y1 + size.y + 1} ${z1 + size.z + 1} minecraft:stone`];
  for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) {
    let run = null;
    const flush = end => { if (run && run.k !== 'stone') lines.push(`fill ${x1 + run.from} ${y1 + y} ${z1 + z} ${x1 + end} ${y1 + y} ${z1 + z} minecraft:${run.k}`); };
    for (let x = 0; x < size.x; x++) {
      const k = kind(cells[(y * size.z + z) * size.x + x]);
      if (run && run.k === k) continue;
      flush(x - 1); run = { k, from: x };
    }
    flush(size.x - 1);
  }
  const jev = cap.jev;
  return { lines, start: [jev.x + dx, jev.y + dy, jev.z + dz] };
}
const CAVE = capturedBuild('./flooded-cave.json', [3400, 40, 3400]);

const TERRAIN = Object.freeze([
  {
    name: 'village_trade',
    why: 'Trading, new: a fletcher, a cleric and a coal buyer with fixed offers. Passing is an ender pearl bought, with emeralds from what was spare.',
    dimension: 'overworld', seconds: 120,
    start: [3700.5, 65, 3700.5],
    kit: [['stick', 40], ['coal', 64], ['emerald', 3], ['cooked_beef', 8]],
    build: [
      'forceload add 3690 3690 3715 3715',
      'fill 3693 64 3693 3710 64 3710 minecraft:grass_block',
      'fill 3693 65 3693 3710 72 3710 minecraft:air',
      'kill @e[type=minecraft:villager,x=3690,y=60,z=3690,dx=25,dy=15,dz=25]',
      'summon minecraft:villager 3704.5 65 3700.5 {NoAI:1b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:fletcher",level:2,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:stick",count:32},sell:{id:"minecraft:emerald",count:1},maxUses:16},{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:arrow",count:16},maxUses:12}]}}',
      'summon minecraft:villager 3700.5 65 3705.5 {NoAI:1b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:cleric",level:4,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:emerald",count:5},sell:{id:"minecraft:ender_pearl",count:1},maxUses:12}]}}',
      'summon minecraft:villager 3696.5 65 3700.5 {NoAI:1b,PersistenceRequired:1b,VillagerData:{profession:"minecraft:armorer",level:1,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:coal",count:15},sell:{id:"minecraft:emerald",count:1},maxUses:16}]}}',
    ],
    village: [3700, 65, 3700],
  },
  {
    name: 'enchant_table',
    why: 'Enchanting, new: a table beside the bot, a diamond sword, lapis and ten levels. Passing is a sword that comes back enchanted.',
    dimension: 'overworld', seconds: 60,
    start: [3600.5, 65, 3600.5],
    kit: [['diamond_sword', 1], ['lapis_lazuli', 16], ['iron_chestplate', 1]],
    build: [
      'forceload add 3590 3590 3610 3610',
      'fill 3595 64 3595 3605 64 3605 minecraft:stone',
      'fill 3595 65 3595 3605 70 3605 minecraft:air',
      'setblock 3602 65 3600 minecraft:enchanting_table',
    ],
    xpLevels: 10,
  },
  {
    name: 'mineshaft_cart',
    why: 'A mineshaft\'s chest rides in a minecart: an entity, not a block. The first landmark the run found and did nothing with.',
    dimension: 'overworld', seconds: 60,
    start: [3500.5, 41, 3500.5],
    kit: [['iron_pickaxe', 1], ['cooked_beef', 8]],
    build: [
      'forceload add 3490 3490 3520 3520',
      'fill 3495 38 3495 3512 46 3505 minecraft:stone',
      'fill 3499 41 3500 3510 42 3501 minecraft:air',
      'fill 3499 40 3500 3510 40 3501 minecraft:oak_planks',
      'fill 3500 41 3500 3510 41 3500 minecraft:rail',
      'setblock 3503 42 3501 minecraft:cobweb',
      'kill @e[type=minecraft:chest_minecart,x=3490,y=35,z=3490,dx=30,dy=15,dz=30]',
      'summon minecraft:chest_minecart 3506.5 41 3500.5 {Items:[{Slot:0b,id:"minecraft:bread",count:3},{Slot:1b,id:"minecraft:iron_ingot",count:4},{Slot:2b,id:"minecraft:rail",count:9}]}',
    ],
    shaft: [3503, 41, 3501],
  },
  {
    name: 'flooded_cave',
    why: 'The replay run, 2026-09-23: an hour swimming in a flooded cave sixteen blocks under the base, dry air three blocks east behind a stone wall, the shore search offering a swim to a landing it never reached. Captured from the live world and rebuilt.',
    dimension: 'overworld', seconds: 120, bulk: true,
    // Water breathing: the live pool had air pockets its rebuild does not,
    // and the question here is the way out, not the air.
    effects: ['water_breathing'],
    start: CAVE.start,
    kit: [['diamond_pickaxe', 1], ['cooked_beef', 8], ['cobblestone', 32]],
    build: CAVE.lines,
  },
  {
    name: 'flooded_ore',
    why: 'Death twelve and the hour of pacing: the night mine chose a copper in the wall of a flooded cave, could never reach it, and drowned there.',
    dimension: 'overworld', seconds: 90, night: true,
    start: [3015.5, 66, 3015.5],
    kit: [['iron_pickaxe', 1], ['cooked_beef', 8], ['cobblestone', 32]],
    build: [
      'forceload add 2990 2990 3040 3040',
      'fill 3000 40 3000 3030 70 3030 minecraft:stone',
      // The pocket the night begins in.
      'fill 3015 66 3015 3015 67 3015 minecraft:air',
      // A flooded cave, with a copper in its wall: the nearer ore.
      'fill 3021 54 3012 3027 62 3018 minecraft:water',
      'setblock 3020 58 3015 minecraft:copper_ore',
      // A dry iron, farther off in solid rock.
      'setblock 3008 58 3015 minecraft:iron_ore',
    ],
    wet: [3020, 58, 3015], dry: [3008, 58, 3015],
  },
  {
    name: 'bridge_over_drop',
    why: 'Death eleven: the bridge stood upright at the end of its span while it placed, and went over.',
    dimension: 'overworld', seconds: 60, edge: true,
    start: [3101.5, 101, 3001.5],
    kit: [['netherrack', 64]],
    build: [
      'forceload add 3090 2990 3130 3010',
      'fill 3095 95 2995 3125 110 3007 minecraft:air',
      'fill 3100 100 3000 3102 100 3002 minecraft:stone',
      'fill 3114 100 3000 3116 100 3002 minecraft:stone',
    ],
    target: [3114, 100, 3001],
  },
  {
    name: 'bridge_under_fire',
    why: 'The same span with a blaze that can see it: no span is laid in the open under fire.',
    dimension: 'overworld', seconds: 30, edge: true,
    start: [3101.5, 101, 3021.5],
    kit: [['netherrack', 64]],
    build: [
      'forceload add 3090 3010 3130 3030',
      'fill 3095 95 3015 3125 110 3027 minecraft:air',
      'fill 3100 100 3020 3102 100 3022 minecraft:stone',
      'fill 3114 100 3020 3116 100 3022 minecraft:stone',
      // It watches and does nothing else: the drill is about the bridge.
      'summon minecraft:blaze 3115.5 103 3021.5 {NoAI:1b,PersistenceRequired:1b,Tags:["terrain"]}',
    ],
    target: [3114, 100, 3021],
  },
  {
    name: 'portal_platform',
    why: 'Death ten: holding forward for eight seconds, the bot walked through its portal and off the platform beyond it.',
    dimension: 'the_nether', seconds: 45, edge: true,
    start: [3000.5, 101, 2996.5],
    kit: [],
    build: [
      'forceload add 2988 2988 3012 3012',
      'fill 2990 60 2990 3010 110 3010 minecraft:air',
      // A platform that ends one block past the portal, over a forty-block drop.
      'fill 2997 100 2994 3004 100 3001 minecraft:netherrack',
      'fill 2999 100 3000 3002 104 3000 minecraft:obsidian',
      'fill 3000 101 3000 3001 103 3000 minecraft:nether_portal[axis=x]',
    ],
    portal: [3000, 101, 3000],
  },
  {
    name: 'chest_lid',
    why: 'A night pocket at the base left netherrack on the stash chest, and every fetch of the food inside failed.',
    dimension: 'overworld', seconds: 40,
    start: [3202.5, 61, 3005.5],
    kit: [],
    build: [
      'forceload add 3195 2995 3215 3015',
      'fill 3196 60 2996 3214 66 3014 minecraft:air',
      'fill 3196 60 2996 3214 60 3014 minecraft:stone',
      'setblock 3205 61 3005 minecraft:chest{Items:[{Slot:0b,id:"minecraft:cooked_beef",count:8}]}',
      'setblock 3205 62 3005 minecraft:netherrack',
    ],
    chest: [3205, 61, 3005], home: [3205, 60, 3003],
  },
  {
    name: 'ledge_fight',
    why: 'Death sixteen: a wither skeleton came at the bot on the ledge by its portal, and one hit put it over the edge, thirty blocks down.',
    dimension: 'the_nether', seconds: 60, edge: true,
    start: [3055.5, 101, 3050.5],
    kit: [['diamond_sword', 1], ['cooked_beef', 8], ['netherrack', 32]],
    armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots', offhand: 'shield' },
    build: [
      'forceload add 3040 3040 3070 3070',
      'kill @e[tag=terrain]',
      // Under the 32768-block limit of one fill: over it, the fill does nothing
      // and the bot is placed inside solid netherrack.
      'fill 3040 80 3040 3070 110 3070 minecraft:air',
      // A ledge three wide over a forty-block drop, the bot on its edge row.
      'fill 3048 100 3050 3062 100 3052 minecraft:netherrack',
      'summon minecraft:wither_skeleton 3059.5 101 3052.5 {PersistenceRequired:1b,Tags:["terrain"],HandItems:[{id:"minecraft:stone_sword",count:1},{}]}',
    ],
    mob: 'wither_skeleton',
  },
  {
    name: 'ledge_shot',
    why: 'Death seventeen: on a ledge in the Nether, a skeleton shot from thirteen blocks, the bot dug in where it stood, on the edge row, and went over thirty blocks.',
    dimension: 'the_nether', seconds: 45, edge: true,
    start: [3055.5, 101, 3080.5],
    kit: [['diamond_sword', 1], ['cooked_beef', 8], ['netherrack', 32]],
    armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots', offhand: 'shield' },
    build: [
      'forceload add 3040 3070 3070 3100',
      'kill @e[tag=terrain]',
      'fill 3040 80 3070 3070 110 3100 minecraft:air',
      // The bot on the edge row of a ledge; the drop behind it, away from the shooter.
      'fill 3048 100 3080 3062 100 3084 minecraft:netherrack',
      // Across a gap, a skeleton on its own island, thirteen blocks off.
      'fill 3053 100 3092 3057 100 3095 minecraft:netherrack',
      'summon minecraft:skeleton 3055.5 101 3093.5 {PersistenceRequired:1b,Tags:["terrain"],HandItems:[{id:"minecraft:bow",count:1},{}]}',
    ],
    mob: 'skeleton', survive: true,
  },
  {
    name: 'barter',
    why: 'Pearls from piglins: forty ingots thrown, the pearls picked up, and no fight with the piglins over it.',
    dimension: 'the_nether', seconds: 150,
    start: [3300.5, 100, 3300.5],
    kit: [['gold_ingot', 40], ['golden_boots', 1], ['diamond_sword', 1], ['cooked_beef', 8]],
    armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' },
    build: [
      'forceload add 3290 3290 3310 3310',
      'kill @e[tag=terrain]',
      'kill @e[type=!player,x=3290,y=95,z=3290,dx=20,dy=15,dz=20]',
      'fill 3290 99 3290 3310 106 3310 minecraft:air',
      'fill 3294 99 3294 3306 99 3306 minecraft:netherrack',
      'fill 3294 100 3294 3306 104 3294 minecraft:glass', 'fill 3294 100 3306 3306 104 3306 minecraft:glass',
      'fill 3294 100 3294 3294 104 3306 minecraft:glass', 'fill 3306 100 3294 3306 104 3306 minecraft:glass',
      'fill 3294 105 3294 3306 105 3306 minecraft:glass',
      'summon minecraft:piglin 3297 100 3297 {PersistenceRequired:1b,IsImmuneToZombification:1b,Tags:["terrain"]}',
      'summon minecraft:piglin 3303 100 3297 {PersistenceRequired:1b,IsImmuneToZombification:1b,Tags:["terrain"]}',
      'summon minecraft:piglin 3300 100 3303 {PersistenceRequired:1b,IsImmuneToZombification:1b,Tags:["terrain"]}',
    ],
  },
]);

const terrainDrill = name => TERRAIN.find(d => d.name === name);

function buildCommands(d) { return d.build.map(line => at(d.dimension, line)); }

function placeCommands(user, d) {
  const lines = [`clear ${user}`, `effect clear ${user}`,
    `effect give ${user} minecraft:instant_health 1 10 true`, `effect give ${user} minecraft:saturation 1 10 true`,
    `gamemode survival ${user}`];
  for (const [item, count] of d.kit) lines.push(`give ${user} minecraft:${item} ${count}`);
  for (const effect of d.effects || []) lines.push(`effect give ${user} minecraft:${effect} 600 0 true`);
  lines.push(`xp set ${user} ${d.xpLevels || 0} levels`);
  const slots = { head: 'armor.head', chest: 'armor.chest', legs: 'armor.legs', feet: 'armor.feet', offhand: 'weapon.offhand' };
  for (const [slot, item] of Object.entries(d.armor || {})) lines.push(`item replace entity ${user} ${slots[slot]} with minecraft:${item}`);
  lines.push(`time set ${d.night ? 18000 : 6000}`);
  lines.push(at(d.dimension, `tp ${user} ${d.start.join(' ')}`));
  return lines;
}

const vec = p => new Vec3(p[0], p[1], p[2]);

module.exports = { TERRAIN, terrainDrill, buildCommands, placeCommands, vec };
