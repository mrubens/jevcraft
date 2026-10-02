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
    name: 'furnace_wait',
    why: 'The day audit: a minute and a half standing beside a working furnace. Eight raw iron to smelt with ore in reach of where the bot stands.',
    dimension: 'overworld', seconds: 150,
    start: [3900.5, 65, 3900.5],
    kit: [['raw_iron', 8], ['coal', 8], ['stone_pickaxe', 1], ['furnace', 1]],
    build: [
      'forceload add 3890 3890 3910 3910',
      'fill 3895 64 3895 3905 64 3905 minecraft:stone',
      'fill 3895 65 3895 3905 70 3905 minecraft:air',
      'setblock 3902 65 3900 minecraft:furnace',
      'setblock 3900 66 3902 minecraft:coal_ore', 'setblock 3898 65 3900 minecraft:iron_ore', 'setblock 3900 65 3898 minecraft:coal_ore',
    ],
  },
  {
    name: 'craft_cycle',
    why: 'The day audit: sixteen "timed out waiting for world/inventory update" in a day, crafting and smelting, with "invalid operation" retries. Crafting planks, sticks and stone pickaxes over and over, counting them.',
    dimension: 'overworld', seconds: 150,
    start: [3800.5, 65, 3800.5],
    kit: [['oak_log', 32], ['cobblestone', 64], ['crafting_table', 1]],
    build: [
      'forceload add 3790 3790 3810 3810',
      'fill 3795 64 3795 3805 64 3805 minecraft:stone',
      'fill 3795 65 3795 3805 70 3805 minecraft:air',
    ],
    rounds: 8,
  },
  {
    name: 'craft_full_pockets',
    why: 'The same, with the pockets full of junk the way the dream run carries them: the crafted pickaxe has nowhere to go.',
    dimension: 'overworld', seconds: 150,
    start: [3800.5, 65, 3800.5],
    kit: [['oak_log', 32], ['cobblestone', 64], ['crafting_table', 1],
      ...['dirt', 'gravel', 'andesite', 'diorite', 'granite', 'tuff', 'netherrack', 'soul_sand', 'nether_wart', 'nether_brick_fence', 'wheat_seeds', 'spruce_sapling',
        'oak_sapling', 'birch_sapling', 'bone', 'rotten_flesh', 'feather', 'egg', 'string', 'leather', 'flint', 'clay_ball', 'sand', 'cobbled_deepslate', 'deepslate',
        'calcite', 'dripstone_block', 'moss_block', 'glow_lichen', 'pointed_dripstone', 'kelp', 'sugar_cane', 'cactus'].map(name => [name, 1])],
    build: [
      'forceload add 3790 3790 3810 3810',
      'fill 3795 64 3795 3805 64 3805 minecraft:stone',
      'fill 3795 65 3795 3805 70 3805 minecraft:air',
    ],
    rounds: 4,
  },
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
    name: 'crack_jump',
    why: 'The user, 2026-09-23: the bot laid a little bridge over every one-block crack. A crack three deep is jumped; nothing is placed in it.',
    dimension: 'overworld', seconds: 40,
    start: [3101.5, 101, 3041.5],
    // Blocks to bridge with, so a pass means it chose the jump.
    kit: [['cobblestone', 16]],
    build: [
      'forceload add 3090 3030 3130 3050',
      'fill 3095 90 3036 3125 110 3046 minecraft:air',
      'fill 3100 100 3040 3112 100 3042 minecraft:stone',
      // The crack: one wide, the width of the path, floored three down.
      'fill 3106 97 3040 3106 100 3042 minecraft:air',
      'fill 3106 96 3040 3106 96 3042 minecraft:stone',
    ],
    crack: [3106, 100, 3041],
    target: [3111, 100, 3041],
  },
  {
    name: 'crack_over_lava',
    why: 'The same crack over lava: never jumped. Bridged, or not crossed, and never fallen into.',
    dimension: 'overworld', seconds: 40,
    start: [3101.5, 101, 3061.5],
    kit: [['cobblestone', 16]],
    build: [
      'forceload add 3090 3050 3130 3070',
      'fill 3095 90 3056 3125 110 3066 minecraft:air',
      'fill 3100 100 3060 3112 100 3062 minecraft:stone',
      'fill 3106 97 3060 3106 100 3062 minecraft:air',
      'fill 3106 96 3060 3106 96 3062 minecraft:lava',
      'fill 3105 95 3059 3107 95 3063 minecraft:stone',
    ],
    crack: [3106, 100, 3061],
    target: [3111, 100, 3061],
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
    name: 'stairs_down_to_bridge',
    why: '25585 (mid-227, 2026-10-01 17:11 to 21:34Z): its own bridge sixteen over a fortress bridge one wide over lava, no rock to dig down and a drop over lava refused; it left the fortress five times (note 839).',
    dimension: 'the_nether', seconds: 90,
    start: [4400.5, 77, 4402.5],
    kit: [['cobblestone', 64], ['iron_pickaxe', 1]],
    build: [
      'forceload add 4380 4370 4420 4420',
      // In thirds: one fill stops at 32768 blocks, and a refused clear left the
      // last run's stairs standing.
      'fill 4385 40 4375 4415 95 4388 minecraft:air',
      'fill 4385 40 4389 4415 95 4402 minecraft:air',
      'fill 4385 40 4403 4415 95 4415 minecraft:air',
      'fill 4385 40 4375 4415 42 4415 minecraft:lava',
      // The fortress bridge, one wide, sixteen under the ledge.
      'fill 4400 60 4378 4400 60 4398 minecraft:nether_bricks',
      // The bot's own bridge over open air.
      'fill 4399 76 4402 4401 76 4404 minecraft:cobblestone',
    ],
    target: [4400, 60, 4396],
  },
  {
    name: 'tunnel_home',
    why: '25592 (mid-220-ar, 2026-10-01 22:04Z): six rods carried, 255 blocks of solid netherrack between it and its portal, every walk and staircase failed and no tunnel was offered (note 860). Forty blocks of rock, ten down, a lava pocket in the line and a gap of open air.',
    dimension: 'the_nether', seconds: 150,
    start: [5200.5, 81, 5200.5],
    kit: [['cobblestone', 32], ['iron_pickaxe', 1]],
    build: [
      'forceload add 5190 5190 5260 5210',
      'fill 5195 60 5192 5225 90 5208 minecraft:netherrack',
      'fill 5226 60 5192 5250 90 5208 minecraft:netherrack',
      // The start's pocket.
      'fill 5199 81 5199 5201 83 5201 minecraft:air',
      // A lava pocket in the line, six along.
      'fill 5208 73 5199 5210 79 5201 minecraft:lava',
      // Open air across the line, four wide, over a floor far below.
      'fill 5222 62 5194 5225 88 5206 minecraft:air',
      // Where it ends: a room at the target.
      'fill 5238 71 5198 5242 74 5202 minecraft:air',
    ],
    target: [5240, 71, 5200],
  },
  {
    name: 'tunnel_to_pool',
    why: 'Note 914: in the Overworld, 37 blocks of stone and twelve down to a lava pool in a pocket of its own, gravel over the line, a water pocket beside it and a cave four wide across it: the tunnel gets within four of the lava without opening lava or water and with no damage.',
    dimension: 'overworld', seconds: 180,
    start: [5405.5, 60, 5400.5],
    kit: [['cobblestone', 16], ['iron_pickaxe', 1], ['bucket', 1]],
    build: [
      'forceload add 5395 5390 5460 5410',
      'fill 5398 30 5392 5428 75 5408 minecraft:stone',
      'fill 5429 30 5392 5458 75 5408 minecraft:stone',
      // The start's pocket.
      'fill 5404 60 5399 5406 62 5401 minecraft:air',
      // Gravel over the line, eight along.
      'fill 5412 57 5399 5414 62 5401 minecraft:gravel',
      // A water pocket beside the line.
      'fill 5418 52 5402 5420 56 5404 minecraft:water',
      // A cave across the line, four wide, its floor six below.
      'fill 5424 44 5394 5427 58 5406 minecraft:air',
      // The pool: lava in a pocket, three of air over it.
      'fill 5440 48 5398 5444 48 5402 minecraft:lava',
      'fill 5440 49 5398 5444 51 5402 minecraft:air',
    ],
    target: [5442, 48, 5400],
  },
  {
    name: 'tunnel_home_cavern',
    why: 'Note 867: the tunnel comes out of the rock into a cavern with its target twelve below on the far floor; it lays its floor across and steps down on laid blocks as it nears, not arriving level over the drop.',
    dimension: 'the_nether', seconds: 150,
    start: [5300.5, 81, 5200.5],
    kit: [['cobblestone', 64], ['iron_pickaxe', 1]],
    build: [
      'forceload add 5290 5190 5350 5210',
      'fill 5295 60 5192 5303 90 5208 minecraft:netherrack',
      'fill 5304 60 5192 5345 90 5208 minecraft:air',
      'fill 5304 60 5192 5345 68 5208 minecraft:netherrack',
      'fill 5299 81 5199 5301 83 5201 minecraft:air',
    ],
    target: [5334, 69, 5200],
  },
  {
    name: 'tunnel_home_over_cave',
    why: 'Note 916: the tunnel runs through rock over a cave, its target twelve below on the cave\'s floor; near it the step down on laid blocks is taken from inside the rock (the cell over the one stepped through dug too), and it comes down to the floor.',
    dimension: 'the_nether', seconds: 180,
    start: [5300.5, 81, 5200.5],
    kit: [['cobblestone', 64], ['iron_pickaxe', 1]],
    build: [
      'forceload add 5290 5190 5350 5210',
      'fill 5295 60 5192 5345 90 5208 minecraft:netherrack',
      'fill 5302 70 5192 5345 79 5208 minecraft:air',
      'fill 5299 81 5199 5301 83 5201 minecraft:air',
    ],
    target: [5334, 69, 5200],
  },
  {
    name: 'ghast_fireball',
    why: 'Note 917: a ghast 22 blocks off across open air and the bot on an island: each fireball struck back as it comes (ghast.js returnFireball). Five of the day\'s deaths were a ghast\'s fireball putting the bot off a span into the lava sea, and the strike had never been measured since it was timed by the fireball\'s flight.',
    dimension: 'the_nether', seconds: 75,
    start: [5600.5, 101, 5600.5],
    kit: [['iron_sword', 1], ['cobblestone', 32]],
    armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots', offhand: 'shield' },
    build: [
      'forceload add 5570 5570 5640 5640',
      'kill @e[tag=terrain]',
      'fill 5580 92 5580 5620 110 5620 minecraft:air',
      'fill 5580 92 5621 5620 110 5635 minecraft:air',
      'fill 5580 111 5580 5620 118 5635 minecraft:air',
      'fill 5594 100 5594 5606 100 5606 minecraft:cobblestone',
      'summon minecraft:ghast 5600.5 103 5622.5 {PersistenceRequired:1b,Tags:["terrain"]}',
    ],
    mob: 'ghast',
  },
  {
    name: 'ghast_fireball_reflex',
    why: 'Note 917: a ghast 22 blocks off across open air and the bot on an island: the bot stands with its shield and the shot reflex of the body alone (no stance, no question): the shield goes up to each fireball and it is struck as it comes into reach (shot-reflex.js strikeFireball). Five of the day\'s deaths were a ghast\'s fireball putting the bot off a span into the lava sea, and the strike had never been measured since it was timed by the fireball\'s flight.',
    dimension: 'the_nether', seconds: 75,
    start: [5600.5, 101, 5600.5],
    kit: [['iron_sword', 1], ['cobblestone', 32]],
    armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots', offhand: 'shield' },
    build: [
      'forceload add 5570 5570 5640 5640',
      'kill @e[tag=terrain]',
      'fill 5580 92 5580 5620 110 5620 minecraft:air',
      'fill 5580 92 5621 5620 110 5635 minecraft:air',
      'fill 5580 111 5580 5620 118 5635 minecraft:air',
      'fill 5594 100 5594 5606 100 5606 minecraft:cobblestone',
      'summon minecraft:ghast 5600.5 103 5622.5 {PersistenceRequired:1b,Tags:["terrain"]}',
    ],
    mob: 'ghast',
  },
  {
    name: 'tunnel_home_from_above',
    why: 'Note 920: the tunnel begins in rock twelve blocks straight over its target, one across (25592 over its portal): it comes down a stair turned on itself, dug through the rock and laid where the room under it opens, and ends in the room.',
    dimension: 'the_nether', seconds: 150,
    start: [5700.5, 84, 5700.5],
    kit: [['cobblestone', 64], ['iron_pickaxe', 1]],
    build: [
      'forceload add 5690 5690 5712 5712',
      'fill 5690 62 5690 5710 92 5710 minecraft:netherrack',
      'fill 5699 84 5699 5701 86 5701 minecraft:air',
      'fill 5697 71 5697 5705 75 5705 minecraft:air',
    ],
    target: [5701, 71, 5700],
  },
  {
    name: 'tunnel_home_from_span',
    why: 'Note 920: the tunnel begins on a block in open air ten over its target and three across (25595 on its own span over its portal): it comes down on laid steps and ends on the floor, no fall.',
    dimension: 'the_nether', seconds: 150,
    start: [5740.5, 82, 5700.5],
    kit: [['cobblestone', 64], ['iron_pickaxe', 1]],
    build: [
      'forceload add 5725 5690 5760 5712',
      'fill 5728 62 5690 5756 70 5710 minecraft:netherrack',
      'fill 5728 71 5690 5756 92 5710 minecraft:air',
      'fill 5728 81 5700 5740 81 5700 minecraft:cobblestone',
    ],
    target: [5743, 71, 5700],
  },
  {
    name: 'tunnel_to_pool_below',
    why: 'Note 922: in the Overworld, a lava pool in a pocket of its own eighteen blocks straight under the bot, two across, with a water pocket beside the way down: the tunnel comes down a stair turned on itself and stops on rock over the pool, no lava or water opened and none touched.',
    dimension: 'overworld', seconds: 180,
    start: [5500.5, 68, 5500.5],
    kit: [['cobblestone', 16], ['iron_pickaxe', 1], ['bucket', 1]],
    build: [
      'forceload add 5488 5488 5514 5514',
      'fill 5490 40 5490 5512 76 5512 minecraft:stone',
      'fill 5499 68 5499 5501 70 5501 minecraft:air',
      'fill 5496 58 5499 5497 61 5501 minecraft:water',
      'fill 5500 50 5498 5504 50 5502 minecraft:lava',
      'fill 5500 51 5498 5504 53 5502 minecraft:air',
    ],
    target: [5502, 50, 5500], yWithin: 3,
  },
  {
    name: 'tunnel_home_few_blocks',
    why: 'Note 915: the cavern drill with ten blocks and no pickaxe (25595 fell ten blocks onto its portal\'s floor with ten netherrack carried): the tunnel stops where its blocks run out, on its span, and does not go off it.',
    dimension: 'the_nether', seconds: 150,
    start: [5300.5, 81, 5200.5],
    kit: [['cobblestone', 10]],
    build: [
      'forceload add 5290 5190 5350 5210',
      'fill 5295 60 5192 5303 90 5208 minecraft:netherrack',
      'fill 5304 60 5192 5345 90 5208 minecraft:air',
      'fill 5304 60 5192 5345 68 5208 minecraft:netherrack',
      'fill 5299 81 5199 5301 83 5201 minecraft:air',
    ],
    target: [5334, 69, 5200],
  },
  {
    name: 'tunnel_home_no_blocks',
    why: 'Note 906: the tunnel begins six cells inside the rock with a pickaxe and no block in the pack, and comes out over a cavern with its target sixteen across and six below; the blocks its own digging dropped run out, and it goes back along its tunnel for more from the walls.',
    dimension: 'the_nether', seconds: 150,
    start: [5297.5, 81, 5200.5],
    kit: [['iron_pickaxe', 1]],
    build: [
      'forceload add 5290 5190 5350 5210',
      'fill 5295 60 5192 5303 90 5208 minecraft:netherrack',
      'fill 5304 60 5192 5345 90 5208 minecraft:air',
      'fill 5304 60 5192 5345 68 5208 minecraft:netherrack',
      'fill 5296 81 5200 5297 82 5200 minecraft:air',
    ],
    target: [5320, 69, 5200],
  },
  {
    name: 'rise_and_swim_lake',
    why: 'first-days-236: a cave under a lake, its stone roof under the water; the rise and swim (note 855) rose and then never swam (855c, 855d).',
    dimension: 'overworld', seconds: 60,
    start: [5000.5, 61, 5000.5],
    kit: [['cobblestone', 32], ['iron_pickaxe', 1]],
    build: [
      'forceload add 4990 4990 5010 5010',
      'fill 4994 58 4994 5006 86 5006 minecraft:stone',
      'fill 4994 81 4994 5006 86 5006 minecraft:air',
      'fill 4997 65 4997 5003 79 5003 minecraft:water',
      'fill 5000 61 5000 5000 63 5000 minecraft:air',
      'fill 4998 80 4998 5002 80 5002 minecraft:air',
    ],
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
