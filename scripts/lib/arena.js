'use strict';
// The combat arena: drills, the console commands that stage them, and the
// scoring that turns a handful of noisy runs into one comparable row.
//
// Seven deaths in the fortress on the night of 2026-09-21 were all combat,
// and each lesson cost a ten-minute restock. A drill costs a minute. The
// arena is carved in the Nether of the fixture server so the blocks, the
// mobs and the gear are the ones that actually killed the bot.

// Two shapes. A room, because a spawner room is open and mobs come from
// every side; a corridor, because a fortress walkway is three wide and a
// wither skeleton meets the bot head on.
const ARENAS = Object.freeze({
  room: {
    shell: [1996, 72, 1996, 2024, 90, 2024],
    hollow: [2001, 77, 2001, 2019, 85, 2019],
    // In the middle, nine blocks from any wall: nothing to dig into.
    open: [2010.5, 77, 2010.5],
    // Three from the west wall: a bunker is one step away.
    wall: [2003.5, 77, 2010.5],
  },
  corridor: {
    shell: [2036, 72, 1996, 2064, 84, 2010],
    hollow: [2041, 77, 2002, 2059, 79, 2004],
    open: [2042.5, 77, 2003.5],
    wall: [2042.5, 77, 2003.5],
  },
  // The live run's actual problem: a spawner room under a fortress roof,
  // with the bot on top of it. Blazes below, two blocks of rock between,
  // and no way round. Jev watched this for an hour and took nothing home.
  tower: {
    shell: [1900, 70, 1900, 1930, 94, 1930],
    hollow: [1905, 84, 1905, 1925, 90, 1925],
    chamber: [1905, 77, 1905, 1925, 81, 1925],
    open: [1915.5, 84, 1915.5],
    wall: [1907.5, 84, 1915.5],
  },
  // A Nether ledge over the lava sea: the day audit of 2026-09-23 lost the
  // bot twice to a hoglin's toss from two and three blocks off an edge, once
  // eleven blocks down and once into lava. The ledge is nine wide, its edge
  // at x 1955 and twelve blocks above the lava; the bot stands three blocks
  // from the edge with the hoglins coming from behind.
  ledge: {
    shell: [1942, 58, 1998, 1968, 90, 2022],
    hollow: [1947, 62, 2003, 1963, 85, 2017],
    fills: [[[1947, 62, 2003, 1955, 76, 2017], 'netherrack'], [[1956, 62, 2003, 1963, 64, 2017], 'lava']],
    open: [1952.5, 77, 2010.5],
    wall: [1952.5, 77, 2010.5],
  },
  // Somewhere to wait while an arena is rebuilt. Filling a shell around the
  // bot would bury it for as long as the next command takes.
  // A fortress walkway where the blaze-stage trials died: seven wide, of
  // nether brick, along a netherrack cliff on its north side and open to a
  // lava sea nine blocks down on its south, with a blaze spawner at its east
  // end. The bot stands twenty-four blocks from the spawner, its blazes
  // hovering about it (mid-208-k-fortress-4, 2026-09-28: take_cover twice,
  // burned from 10.6 to none by blazes twenty to twenty-five off).
  fortress: {
    shell: [1802, 57, 1802, 1844, 88, 1822],
    hollow: [1806, 61, 1806, 1840, 84, 1818],
    fills: [[[1806, 61, 1806, 1840, 62, 1818], 'lava'], [[1806, 70, 1806, 1840, 70, 1812], 'nether_bricks']],
    blocks: [[[1836, 71, 1809], 'spawner{SpawnData:{entity:{id:"minecraft:blaze"}}}']],
    open: [1812.5, 71, 1809.5],
    wall: [1812.5, 71, 1806.5],
  },
  // A pit in a cavern floor, one wide and two deep, the bot in it and
  // blazes hovering over the cavern: a hole open above is a hole they
  // shoot into (the stands in holes of notes 548 and 557).
  pit: {
    shell: [1700, 66, 1700, 1730, 96, 1730],
    hollow: [1705, 75, 1705, 1725, 92, 1725],
    fills: [[[1705, 75, 1705, 1725, 76, 1725], 'netherrack'], [[1715, 75, 1715, 1715, 76, 1715], 'air']],
    open: [1715.5, 75, 1715.5],
    wall: [1715.5, 75, 1715.5],
  },
  // A warped-forest cavern in the Nether, open well over head, the bot in a
  // corner of its netherrack walls (rock at its east and north, as at
  // mid-242-ah-fortress-1's death, 2026-09-28 11:43: a wither skeleton
  // came at it across the cavern floor from twelve blocks).
  cave_corner: {
    shell: [1600, 58, 1600, 1630, 80, 1630],
    hollow: [1605, 64, 1605, 1625, 73, 1625],
    fills: [[[1605, 63, 1605, 1625, 63, 1625], 'warped_nylium']],
    open: [1625.5, 64, 1605.5],
    wall: [1625.5, 64, 1605.5],
  },
  holding: {
    shell: [2096, 72, 2096, 2108, 84, 2108],
    hollow: [2101, 77, 2101, 2103, 79, 2103],
    open: [2102.5, 77, 2102.5],
    wall: [2102.5, 77, 2102.5],
  },
});
const HOLDING = [2102.5, 77, 2102.5];

// What the fortress-stage trials carry to the blazes (mid-208-k-fortress-4:
// an iron sword, a shield, iron armour, an iron pickaxe, a few blocks),
// for the drills built from their deaths. The KIT's diamond sword is kept
// for the older drills, so their columns stay comparable.
const FORTRESS_KIT = Object.freeze({
  armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' },
  offhand: 'shield',
  items: [['iron_sword', 1], ['iron_pickaxe', 1], ['cobblestone', 32], ['netherrack', 16], ['cooked_beef', 8]],
});
// What mid-242-ah-fortress-1 carried when a wither skeleton killed it: full
// iron, an iron sword and a shield, a stone axe and no pickaxe, netherrack
// and dirt to build with, mutton.
const CAVE_KIT = Object.freeze({
  armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' },
  offhand: 'shield',
  items: [['iron_sword', 1], ['stone_axe', 1], ['netherrack', 53], ['dirt', 6], ['mutton', 8]],
});
const kitOf = d => (d.loadout === 'fortress' ? FORTRESS_KIT : d.loadout === 'cave' ? CAVE_KIT : KIT);

// The fortress loadout: the iron set with golden boots for the piglin
// truce, a diamond sword, a shield, blocks to wall with and food to heal on.
const KIT = Object.freeze({
  armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots' },
  offhand: 'shield',
  items: [['diamond_sword', 1], ['diamond_pickaxe', 1], ['netherrack', 64], ['cooked_beef', 8]],
});

// `defend` runs the survival layer, the code that answers a mob that came to
// the bot. `hunt` runs the mob hunt, the code that goes after one on purpose
// and has to come back with the drop.
const DRILLS = Object.freeze([
  { name: 'zombie_single', mode: 'defend', entity: 'zombie', count: 1, arena: 'corridor', stand: 'open',
    at: [[2047.5, 77, 2003.5]], seconds: 45, expect: { deaths: 0, cleared: true, damage: 6 },
    why: 'The baseline. A lone melee mob in a corridor must cost almost nothing.' },
  { name: 'wither_skeleton_single', mode: 'defend', entity: 'wither_skeleton', count: 1, arena: 'corridor', stand: 'open',
    at: [[2047.5, 77, 2003.5]], seconds: 45, expect: { deaths: 0, cleared: true, damage: 10 },
    why: 'Deaths two, four and seven. It hits from three blocks, further than a zombie.' },
  { name: 'wither_skeleton_pair', mode: 'defend', entity: 'wither_skeleton', count: 2, arena: 'corridor', stand: 'open',
    at: [[2047.5, 77, 2003.5], [2049.5, 77, 2003.5]], seconds: 60, expect: { deaths: 0, cleared: true, damage: 16 },
    why: 'Two in a corridor: the second arrives while the first is still swinging.' },
  { name: 'fortress_mix', mode: 'defend', entity: ['wither_skeleton', 'blaze', 'blaze'], count: 3, arena: 'room', stand: 'open',
    at: [[2012.5, 77, 2010.5], [2017.5, 80, 2010.5], [2017.5, 80, 2013.5]], seconds: 60, expect: { deaths: 0, damage: 16 },
    why: 'The dream run, 2026-09-24 00:07: a wither skeleton at arm\'s length and two blazes behind it; it sealed a pocket while the sword swung and went from 19 to none in five seconds.' },
  { name: 'cave_trio', mode: 'defend', entity: ['skeleton', 'zombie', 'zombie'], count: 3, arena: 'corridor', stand: 'open',
    at: [[2049.5, 77, 2003.5], [2046.5, 77, 2003.5], [2045.5, 77, 2003.5]], seconds: 60, expect: { deaths: 0, damage: 14 },
    why: 'Death nineteen. A skeleton and two zombies at three to five blocks in a mineshaft: it dug a bunker while they hit it, then ate twice at six health.' },
  { name: 'crowd_dusk', mode: 'defend', entity: ['zombie', 'zombie', 'spider', 'skeleton', 'skeleton', 'creeper'], count: 6, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2010.5], [2004.5, 77, 2012.5], [2015.5, 77, 2005.5], [2017.5, 77, 2015.5], [2003.5, 77, 2005.5], [2010.5, 77, 2018.5]],
    seconds: 60, expect: { deaths: 0, damage: 16 },
    why: 'The midgame crowds of 2026-09-26 (mid-83-d, mid-92-e, mid-110-k): zombies, a spider, skeletons and a creeper at once on open ground, six to nine blocks off. Each death went through several stances in a few seconds, none carried through.' },
  { name: 'hoglin_single', mode: 'defend', entity: 'hoglin', count: 1, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2010.5]], seconds: 45, expect: { deaths: 0, cleared: true, damage: 10 },
    why: 'Death six. A hoglin charges and knocks back.' },
  { name: 'hoglin_pair', mode: 'defend', entity: 'hoglin', count: 2, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2009.5], [2016.5, 77, 2011.5]], seconds: 60, expect: { deaths: 0, damage: 14 },
    why: 'The replay run, 2026-09-23: 20 health to none in nine seconds on open Nether ground, three to five a hit. Two is not a crowd, and was fought.' },
  { name: 'hoglin_bystanders', mode: 'defend', entity: ['hoglin', 'zombified_piglin', 'zombified_piglin'], count: 3, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2010.5], [2017.5, 77, 2011.5], [2017.5, 77, 2009.5]], seconds: 60, expect: { deaths: 0, damage: 14 },
    why: 'The replay run, 2026-09-23: killed by zombified piglins after fighting hoglins beside them. A sword sweep that touches one turns the group.' },
  { name: 'hoglin_herd', mode: 'defend', entity: 'hoglin', count: 4, arena: 'room', stand: 'wall',
    at: [[2014.5, 77, 2008.5], [2015.5, 77, 2010.5], [2014.5, 77, 2012.5], [2016.5, 77, 2010.5]],
    seconds: 75, expect: { deaths: 0, damage: 14 },
    why: 'The hilltop. Four at once must be sealed out, not charged; clearing them is a bonus.' },
  { name: 'creeper_follow', mode: 'defend', entity: 'creeper', count: 1, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2010.5]], seconds: 45, expect: { deaths: 0, damage: 8 },
    why: 'The live run, 2026-09-23: a creeper followed the bot for forty seconds while it ran and gathered dirt, and one blast took twelve health through iron.' },
  { name: 'creeper_pair', mode: 'defend', entity: 'creeper', count: 2, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2008.5], [2016.5, 77, 2012.5]], seconds: 60, expect: { deaths: 0, damage: 12 },
    why: 'Two creepers at once, the cave death of the third audited day.' },
  { name: 'hoglin_ledge', mode: 'defend', entity: 'hoglin', count: 1, arena: 'ledge', stand: 'open',
    at: [[1947.5, 77, 2010.5]], seconds: 45, expect: { deaths: 0, damage: 12 },
    why: 'The day audit, 2026-09-23: a hoglin\'s toss from three blocks off a Nether edge, eleven blocks down.' },
  { name: 'hoglin_ledge_pair', mode: 'defend', entity: 'hoglin', count: 2, arena: 'ledge', stand: 'open',
    at: [[1947.5, 77, 2008.5], [1947.5, 77, 2012.5]], seconds: 60, expect: { deaths: 0, damage: 16 },
    why: 'The day audit, 2026-09-23: hoglins on a ledge, a step toward firm ground, and a toss into the lava sea.' },
  { name: 'enderman_single', mode: 'hunt', entity: 'enderman', item: 'ender_pearl', count: 1, arena: 'room', stand: 'open',
    at: [[2016.5, 77, 2010.5]], seconds: 60, expect: { deaths: 0, cleared: true, damage: 12 },
    why: 'Death eighteen. Forty health and four a hit through iron, and it teleports: running is no answer, only the fight or a roof it cannot stand under.' },
  { name: 'blaze_single', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 1, arena: 'room', stand: 'open',
    at: [[2016.5, 80, 2010.5]], seconds: 60, expect: { deaths: 0, drops: 1, damage: 10 },
    why: 'One blaze, fought on purpose, and the rod has to end up in the pockets.' },
  { name: 'blaze_pair', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 2, arena: 'room', stand: 'open',
    at: [[2016.5, 80, 2010.5], [2016.5, 80, 2013.5]], seconds: 75, expect: { deaths: 0, drops: 1, damage: 14 },
    why: 'Two in view: the crowd rule must still allow a fight.' },
  // The same fight with the tool the dream run never carried. A blaze is
  // what a bow is for, and the ladder only reaches for one at night.
  { name: 'blaze_pair_bow', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 2, arena: 'room', stand: 'open',
    kit: [['bow', 1], ['arrow', 32]],
    at: [[2016.5, 80, 2010.5], [2016.5, 80, 2013.5]], seconds: 75, expect: { deaths: 0, drops: 1, damage: 14 },
    why: 'Two blazes, with a bow. What the bow is worth, in health and seconds.' },
  // The live fortress, reproduced: standing on the roof with the spawner
  // room underneath. Nothing is reachable by walking, and a hunt that can
  // only walk will watch them until the sun burns out.
  { name: 'blaze_spawner', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 4, arena: 'tower', stand: 'open',
    at: [[1915.5, 79, 1915.5], [1913.5, 79, 1915.5], [1917.5, 79, 1915.5], [1915.5, 79, 1913.5]],
    seconds: 90, expect: { deaths: 0, drops: 1 },
    why: 'The dream run\'s actual wall: blazes in a room below a roof the bot is standing on.' },
  { name: 'blaze_swarm_wall', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 4, arena: 'room', stand: 'wall',
    at: [[2009.5, 80, 2010.5], [2010.5, 80, 2008.5], [2010.5, 80, 2012.5], [2011.5, 80, 2010.5]],
    seconds: 90, expect: { deaths: 0, drops: 1 },
    why: 'Death five, with a wall three blocks away: this is the bunker fight.' },
  { name: 'blaze_swarm_open', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 4, arena: 'room', stand: 'open',
    at: [[2016.5, 80, 2010.5], [2016.5, 80, 2008.5], [2016.5, 80, 2012.5], [2017.5, 80, 2010.5]],
    seconds: 90, expect: { deaths: 0 },
    why: 'The same swarm in the open: the bot has to reach a wall before it can dig in.' },
  // From the fortress-stage deaths of 2026-09-27 and 28, with the trials'
  // kit, the game's own fire (a fireball that misses lights the ground) and
  // no nudge: a blaze that sees the bot keeps its distance and shoots, and
  // bringing it to three blocks measured a fight the trials never had.
  { name: 'blaze_fortress_spawner', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 3, arena: 'fortress', stand: 'open',
    loadout: 'fortress', fire: true, nudge: false,
    at: [[1835.5, 73, 1812.5], [1837.5, 74, 1807.5], [1833.5, 72.5, 1810.5]], seconds: 120, expect: { deaths: 0, drops: 1 },
    why: 'mid-208-k-fortress-4 and the fortress deaths of notes 548 and 557: blazes by their spawner twenty to twenty-five blocks off, the bot on the fortress floor with a lava sea over the edge.' },
  { name: 'blaze_wither_fortress', mode: 'hunt', entity: ['wither_skeleton', 'blaze', 'blaze'], prey: 'blaze', item: 'blaze_rod', count: 3, arena: 'fortress', stand: 'open',
    loadout: 'fortress', fire: true, nudge: false,
    at: [[1814.5, 71, 1808.5], [1822.5, 73, 1811.5], [1833.5, 72.5, 1810.5]], seconds: 120, expect: { deaths: 0, drops: 1 },
    why: 'mid-235-p-nether-4-fortress-4, 2026-09-28 04:34: a wither skeleton at 1.8 blocks and blazes eight to twenty-five off on a fortress floor; hit to 2.1, then withered to death while the questions went round.' },
  { name: 'wither_cave_corner', mode: 'defend', entity: 'wither_skeleton', count: 1, arena: 'cave_corner', stand: 'open',
    loadout: 'cave', nudge: false, health: 14.5, hungry: 8,
    at: [[1618.5, 64, 1614.5]], seconds: 60, expect: { deaths: 0, cleared: true, damage: 10 },
    why: 'mid-242-ah-fortress-1, 2026-09-28 11:43: a wither skeleton came across a warped cavern at the bot in a netherrack corner (14.5 health, hunger 16, full iron, iron sword, shield, no pickaxe); it ate, was struck, withered, and went from 10 to none in six seconds while none of these was answered.' },
  { name: 'wither_cave_pair', mode: 'defend', entity: 'wither_skeleton', count: 2, arena: 'cave_corner', stand: 'open',
    loadout: 'cave', nudge: false, health: 14.5, hungry: 8,
    at: [[1618.5, 64, 1614.5], [1614.5, 64, 1609.5]], seconds: 60, expect: { deaths: 0, cleared: true, damage: 12 },
    why: 'The same corner with a second wither skeleton, as a fortress has them (note 559: three at once): one alone was fought and killed five times in five.' },
  { name: 'blaze_pit_above', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 3, arena: 'pit', stand: 'open',
    loadout: 'fortress', fire: true, nudge: false,
    at: [[1719.5, 83, 1715.5], [1715.5, 84, 1710.5], [1711.5, 82, 1718.5]], seconds: 90, expect: { deaths: 0, drops: 1 },
    why: 'A stand in a hole the blazes shoot into (notes 548, 557): the bot two deep in a pit, three blazes hovering five to eight blocks over the cavern floor.' },
  { name: 'blaze_open_eight', mode: 'hunt', entity: 'blaze', item: 'blaze_rod', count: 1, arena: 'room', stand: 'open',
    loadout: 'fortress', fire: true, nudge: false,
    at: [[2018.5, 78, 2010.5]], seconds: 75, expect: { deaths: 0, drops: 1 },
    why: 'One blaze in the open at eight blocks, the bot\'s own level: the fight every blaze stage has to be able to win.' },
]);

const drill = name => DRILLS.find(d => d.name === name);

// The arena server's folder, .test-combat in the main checkout, which every
// worktree shares (scripts/trials/arena-start.sh makes it there). A
// worktree's .git is a file naming <main>/.git/worktrees/<name>.
function arenaDir() {
  const fs = require('fs'), path = require('path');
  const here = path.join(__dirname, '..', '..');
  try {
    const link = fs.readFileSync(path.join(here, '.git'), 'utf8').match(/^gitdir: (.+)$/m);
    if (link) return path.join(path.resolve(here, link[1].trim()), '..', '..', '..', '.test-combat');
  } catch (_) { /* a main checkout: .git is a folder */ }
  return path.join(here, '.test-combat');
}

// Gamerules first: the arena is only the mobs that were summoned, at noon,
// in fixed weather, with the shell safe from a creeper or a ghast.
function sessionSetup() {
  // 26.1 named the rules anew; the old camelCase names were refused
  // ("Incorrect argument for command") and every drill ran with mobs
  // spawning. Fire keeps the game's own ticking (fire_spread_radius_around
  // _player left at its default): at 0 no fire ever burns out, and a
  // fortress floor a blaze fight has lit stays lit and walled with fire,
  // which no trial's floor is.
  return ['difficulty normal', 'gamerule minecraft:spawn_mobs false', 'gamerule minecraft:advance_time false',
    'gamerule minecraft:advance_weather false', 'gamerule minecraft:mob_griefing false',
    'gamerule minecraft:keep_inventory true', 'gamerule minecraft:immediate_respawn true', 'time set noon'];
}

const box = ([x1, y1, z1, x2, y2, z2], block) => `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${block}`;

// Every volume under the 32,768 blocks one `fill` may change: a shell
// over it is refused and the bot is put into whatever the Nether had there.
// A solid block of netherrack with the room cut out of it: whatever the
// Nether generated here, the arena is the same every time.
//
// The force-load comes first and is not optional. No player had ever stood
// in this corner of the Nether, so the first `fill` answered "that position
// is not loaded", the shell was never built, and the bot was teleported
// into solid rock and smothered in twelve seconds with a perfect score of
// nothing. A silent stage failure looks exactly like a combat failure.
function arenaBuild(name, { dimension = 'minecraft:the_nether' } = {}) {
  const arena = ARENAS[name];
  if (!arena) throw new Error(`Unknown arena ${name}`);
  const [x1, y1, z1, x2, y2, z2] = arena.shell;
  return [...[`forceload add ${x1 - 16} ${z1 - 16} ${x2 + 16} ${z2 + 16}`,
    box([x1, y1, z1, x2, y2, z2], 'netherrack'), box(arena.hollow, 'air'),
    // A second chamber below, sealed off, for the arenas that have one.
    ...(arena.chamber ? [box(arena.chamber, 'air')] : []),
    ...(arena.fills || []).map(([volume, block]) => box(volume, block)),
    ...(arena.blocks || []).map(([at, block]) => `setblock ${at.join(' ')} minecraft:${block}`)]
    .map(command => `execute in ${dimension} run ${command}`), sweep(name, { dimension })];
}

// Where the bot stands for a drill, and the cells that have to be clear
// before a mob is summoned into the room with it.
function standingCell(d) {
  const stand = ARENAS[d.arena][d.stand || 'open'];
  return { x: Math.floor(stand[0]), y: stand[1], z: Math.floor(stand[2]) };
}

const place = ([x, y, z]) => `${x} ${y} ${z}`;

// Everything alive inside the arena that is not a player. Carving a room
// out of the Nether does not evict the Nether: the first baseline had the
// bot slain by a zombified piglin and an enderman that were standing in the
// volume when the walls went up, and every number in that table was noise.
function sweep(name, { dimension = 'minecraft:the_nether' } = {}) {
  const [x1, y1, z1, x2, y2, z2] = ARENAS[name].shell;
  return `execute in ${dimension} run kill @e[type=!minecraft:player,x=${x1},y=${y1},z=${z1},dx=${x2 - x1},dy=${y2 - y1},dz=${z2 - z1}]`;
}

// Between drills: the mobs and their drops go, the pockets are emptied and
// refilled from the kit, health and hunger are full, and the bot is back on
// its mark. Nothing carries over except what the code learned.
function resetCommands(user, d, { dimension = 'minecraft:the_nether' } = {}) {
  const arena = ARENAS[d.arena];
  const stand = arena[d.stand || 'open'];
  // The arena is rebuilt, not just swept. The bot walls itself in when it is
  // cornered, and those walls outlived the drill that built them: a later
  // run found the bot behind its own netherrack with no line of sight to the
  // mob, so nothing was a threat and nothing happened. Three drills scored
  // zero damage and zero swings and meant nothing at all.
  const kit = kitOf(d);
  // A blaze's fireball that misses lights where it lands only with mob
  // griefing on, as in every trial; the drills from the fortress deaths
  // want that fire, the others a shell no creeper can open.
  const commands = [`execute in ${dimension} run tp ${user} ${place(HOLDING)}`, `gamerule minecraft:mob_griefing ${d.fire ? 'true' : 'false'}`,
    ...arenaBuild(d.arena, { dimension }),
    `kill @e[type=minecraft:item]`, `clear ${user}`, `effect clear ${user}`,
    `execute in ${dimension} run tp ${user} ${place(stand)} ${d.arena === 'corridor' ? 0 : 90} 0`];
  for (const [slot, item] of Object.entries(kit.armor)) commands.push(`item replace entity ${user} armor.${slot} with minecraft:${item}`);
  commands.push(`item replace entity ${user} weapon.offhand with minecraft:${kit.offhand}`);
  for (const [item, n] of [...kit.items, ...(d.kit || [])]) commands.push(`give ${user} minecraft:${item} ${n}`);
  commands.push(`effect give ${user} minecraft:instant_health 1 20 true`, `effect give ${user} minecraft:saturation 1 20 true`);
  // Where the death began hungry: from full, the Hunger effect at this
  // strength wears the saturation away in about three seconds and then a
  // hunger point every two thirds of a second; arena.js clears it at
  // sixteen. The health is taken off after (healthCommand): with the
  // saturation left, the 14.5 staged was 18 by the first question.
  if (d.hungry) commands.push(`effect give ${user} minecraft:hunger ${d.hungry} 255 true`);
  return commands;
}

// The health a drill begins at, taken off past the armour.
const healthCommand = (user, d) => (d.health ? `damage ${user} ${20 - d.health} minecraft:generic_kill` : null);

// Every mob is tagged and persistent: a blaze that wandered off would end
// the drill early and a despawn would look like a kill.
function spawnCommands(d, { dimension = 'minecraft:the_nether' } = {}) {
  // A mixed group names one kind per position.
  return d.at.slice(0, d.count).map((at, i) =>
    `execute in ${dimension} run summon minecraft:${Array.isArray(d.entity) ? d.entity[i] : d.entity} ${place(at)} {PersistenceRequired:1b,Tags:["arena"]}`);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) * 10 / 2) / 10;
}

// One row per drill. A death anywhere fails it; the damage and clear-time
// medians are what a rule change has to beat, not a single lucky run.
function summarise(d, runs) {
  const expect = d.expect || {};
  const deaths = runs.reduce((n, r) => n + (r.deaths || 0), 0);
  const cleared = runs.filter(r => r.cleared).length;
  const drops = runs.reduce((n, r) => n + (r.drops || 0), 0);
  const damage = median(runs.map(r => r.damageTaken));
  const seconds = median(runs.filter(r => r.cleared).map(r => Math.round(r.clearedMs / 100) / 10));
  const failures = [];
  if (deaths > (expect.deaths ?? 0)) failures.push(`${deaths} death${deaths === 1 ? '' : 's'}`);
  if (expect.cleared && cleared < runs.length) failures.push(`cleared ${cleared}/${runs.length}`);
  // A blaze drops a rod half the time it dies, so a rod per run was a bar
  // no fighting could clear. The expectation is a total across the set: it
  // asks whether the drop reaches the pockets at all, not whether the loot
  // table was kind.
  if (expect.drops !== undefined && drops < expect.drops) failures.push(`${drops} drops in ${runs.length} runs, wanted ${expect.drops}`);
  if (expect.damage !== undefined && damage !== null && damage > expect.damage) failures.push(`${damage} damage over ${expect.damage}`);
  const actions = [...new Set(runs.flatMap(r => r.actions || []))].sort();
  // What was chosen, over the set: the stands Jev took, and how often.
  const chose = {};
  for (const r of runs) for (const c of r.chose || []) if (c) chose[c] = (chose[c] || 0) + 1;
  return { drill: d.name, mode: d.mode, runs: runs.length, deaths, cleared, drops, damage, seconds,
    strikes: median(runs.map(r => r.strikes)), shieldRaises: median(runs.map(r => r.shieldRaises)),
    actions, chose, verdict: failures.length ? 'FAIL' : 'PASS', failures };
}

// A table, because the point of the arena is comparing today's column with
// yesterday's.
function table(rows) {
  const header = ['drill', 'runs', 'verdict', 'deaths', 'cleared', 'drops', 'dmg', 'secs', 'hits', 'shield', 'notes'];
  const body = rows.map(r => [r.drill, String(r.runs), r.verdict, String(r.deaths), `${r.cleared}/${r.runs}`,
    String(r.drops), r.damage === null ? '-' : String(r.damage), r.seconds === null ? '-' : String(r.seconds),
    r.strikes === null ? '-' : String(r.strikes), r.shieldRaises === null ? '-' : String(r.shieldRaises),
    r.failures.join('; ') || r.actions.slice(0, 4).join(' ')]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const line = row => `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  return [line(header), `|${widths.map(w => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}

module.exports = { ARENAS, DRILLS, KIT, FORTRESS_KIT, CAVE_KIT, kitOf, HOLDING, drill, arenaDir, sessionSetup, arenaBuild, standingCell, sweep, resetCommands, healthCommand, spawnCommands, median, summarise, table };
