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

const TERRAIN = Object.freeze([
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
]);

const terrainDrill = name => TERRAIN.find(d => d.name === name);

function buildCommands(d) { return d.build.map(line => at(d.dimension, line)); }

function placeCommands(user, d) {
  const lines = [`clear ${user}`, `effect clear ${user}`,
    `effect give ${user} minecraft:instant_health 1 10 true`, `effect give ${user} minecraft:saturation 1 10 true`,
    `gamemode survival ${user}`];
  for (const [item, count] of d.kit) lines.push(`give ${user} minecraft:${item} ${count}`);
  const slots = { head: 'armor.head', chest: 'armor.chest', legs: 'armor.legs', feet: 'armor.feet', offhand: 'weapon.offhand' };
  for (const [slot, item] of Object.entries(d.armor || {})) lines.push(`item replace entity ${user} ${slots[slot]} with minecraft:${item}`);
  lines.push(`time set ${d.night ? 18000 : 6000}`);
  lines.push(at(d.dimension, `tp ${user} ${d.start.join(' ')}`));
  return lines;
}

const vec = p => new Vec3(p[0], p[1], p[2]);

module.exports = { TERRAIN, terrainDrill, buildCommands, placeCommands, vec };
