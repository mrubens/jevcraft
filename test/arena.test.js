'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ARENAS, DRILLS, KIT, drill, sessionSetup, arenaBuild, standingCell, sweep, resetCommands, spawnCommands, median, summarise, table } = require('../scripts/lib/arena');

test('the holding cell is outside every arena, so a rebuild cannot bury the bot', () => {
  const { HOLDING } = require('../scripts/lib/arena');
  for (const [name, arena] of Object.entries(ARENAS)) {
    if (name === 'holding') continue;
    const [x1, y1, z1, x2, y2, z2] = arena.shell;
    const outside = HOLDING[0] < x1 || HOLDING[0] > x2 || HOLDING[2] < z1 || HOLDING[2] > z2;
    assert(outside, `the holding cell is clear of ${name}`);
  }
  const [hx1, hy1, hz1, hx2, hy2, hz2] = ARENAS.holding.hollow;
  assert(HOLDING[0] > hx1 - 1 && HOLDING[0] < hx2 + 1 && HOLDING[1] >= hy1 && HOLDING[2] > hz1 - 1 && HOLDING[2] < hz2 + 1,
    'and it is inside its own carved cell');
});

test('every drill names a real arena, a stand inside it, and a spawn point for each mob', () => {
  assert(DRILLS.length >= 8);
  for (const d of DRILLS) {
    const arena = ARENAS[d.arena];
    assert(arena, `${d.name} names arena ${d.arena}`);
    const stand = arena[d.stand || 'open'];
    assert(stand, `${d.name} has a stand`);
    const within = ([x1, y1, z1, x2, y2, z2]) => ([x, y, z]) => x > x1 - 1 && x < x2 + 1 && y >= y1 && y <= y2 && z > z1 - 1 && z < z2 + 1;
    const inside = within(arena.hollow);
    // A tower arena has a second chamber below, which is the point of it.
    const anywhere = p => inside(p) || (arena.chamber && within(arena.chamber)(p));
    assert(inside(stand), `${d.name} stands inside its arena`);
    assert(d.at.length >= d.count, `${d.name} has a spawn point per mob`);
    for (const at of d.at.slice(0, d.count)) assert(anywhere(at), `${d.name} spawns ${at} inside its arena`);
    assert(['defend', 'hunt'].includes(d.mode));
    assert(d.mode !== 'hunt' || d.item, `${d.name} hunts for a named drop`);
    assert(d.why && d.seconds > 0 && d.expect);
  }
  assert.equal(new Set(DRILLS.map(d => d.name)).size, DRILLS.length, 'drill names are unique');
});

test('the shell is thick enough that a three-deep bunker cannot break out of the arena', () => {
  for (const [name, arena] of Object.entries(ARENAS)) {
    if (name === 'holding') continue;
    const [sx1, sy1, sz1, sx2, sy2, sz2] = arena.shell;
    const [hx1, hy1, hz1, hx2, hy2, hz2] = arena.hollow;
    const thickness = Math.min(hx1 - sx1, sx2 - hx2, hz1 - sz1, sz2 - hz2, hy1 - sy1, sy2 - hy2);
    assert(thickness >= 4, `${name} walls are ${thickness} thick`);
  }
});

test('a reset empties the pockets before it refills them, and lands the bot in the Nether', () => {
  const commands = resetCommands('ArenaX', drill('blaze_swarm_wall'));
  const text = commands.join('\n');
  assert(commands.indexOf('clear ArenaX') < commands.findIndex(c => c.includes('item replace')), 'clear comes before the kit');
  // The bot walls itself in when cornered and those walls outlive the drill.
  assert(commands[0].includes('tp ArenaX 2102.5 77 2102.5'), 'the bot waits outside while the arena is rebuilt');
  assert(commands.some(c => c.includes('fill 1996 72 1996')), 'the shell is restored');
  assert(commands.some(c => c.includes('minecraft:air')), 'and the room re-carved, undoing the bot\'s masonry');
  assert(commands.some(c => c.includes('kill @e[type=!minecraft:player')), 'then the arena is swept of everything alive');
  assert(text.includes('execute in minecraft:the_nether run tp ArenaX 2003.5 77 2010.5'));
  for (const item of Object.values(KIT.armor)) assert(text.includes(`with minecraft:${item}`), `${item} is worn`);
  assert(text.includes('weapon.offhand with minecraft:shield'));
  assert(text.includes('give ArenaX minecraft:netherrack 64'), 'blocks to wall with');
  assert(text.includes('instant_health') && text.includes('saturation'), 'full health and hunger');
});

test('mobs are summoned tagged and persistent so a despawn cannot look like a kill', () => {
  const spawn = spawnCommands(drill('wither_skeleton_pair'));
  assert.equal(spawn.length, 2);
  for (const line of spawn) {
    assert(line.startsWith('execute in minecraft:the_nether run summon minecraft:wither_skeleton'));
    assert(line.includes('PersistenceRequired:1b') && line.includes('Tags:["arena"]'));
  }
  assert.equal(spawnCommands(drill('hoglin_herd')).length, 4);
});

test('the session is staged with no natural spawns, a fixed noon and a shell no mob can break', () => {
  const setup = sessionSetup().join('\n');
  for (const rule of ['doMobSpawning false', 'doDaylightCycle false', 'mobGriefing false', 'difficulty normal', 'time set noon']) {
    assert(setup.includes(rule), rule);
  }
  const build = arenaBuild('room');
  assert.equal(build.length, 4);
  // A fill into unloaded chunks answers "that position is not loaded" and
  // builds nothing; the bot then spawns inside rock and smothers.
  assert(build[0].includes('forceload add'), 'the region is held in memory first');
  assert(build[1].includes('minecraft:netherrack'), 'then a solid block');
  assert(build[2].includes('minecraft:air'), 'then the room cut out of it');
  assert(build[3].includes('kill @e[type=!minecraft:player'), 'and then the Nether\'s own residents are evicted');
  for (const line of build) assert(line.startsWith('execute in minecraft:the_nether run'), 'every stage runs in the Nether');
  assert.throws(() => arenaBuild('nowhere'), /Unknown arena/);
});

test('a median ignores the missing numbers and averages an even pair', () => {
  assert.equal(median([4, 1, 9]), 4);
  assert.equal(median([2, 4]), 3);
  assert.equal(median([null, undefined, 7]), 7);
  assert.equal(median([]), null);
});

test('one death anywhere fails a drill, and the medians are what a rule change has to beat', () => {
  const d = drill('wither_skeleton_single');
  const clean = { deaths: 0, cleared: true, damageTaken: 6, clearedMs: 9000, strikes: 5, shieldRaises: 4, actions: ['fight'] };
  const good = summarise(d, [clean, { ...clean, damageTaken: 8 }, { ...clean, damageTaken: 4 }]);
  assert.equal(good.verdict, 'PASS');
  assert.equal(good.damage, 6); assert.equal(good.seconds, 9); assert.equal(good.deaths, 0);
  const died = summarise(d, [clean, { ...clean, deaths: 1, cleared: false, clearedMs: null }, clean]);
  assert.equal(died.verdict, 'FAIL');
  assert.deepEqual(died.failures, ['1 death', 'cleared 2/3']);
  const battered = summarise(d, [{ ...clean, damageTaken: 19 }, { ...clean, damageTaken: 18 }, { ...clean, damageTaken: 17 }]);
  assert.equal(battered.verdict, 'FAIL');
  assert.match(battered.failures[0], /18 damage over 10/);
});

test('a hunt drill fails when the drop never reaches the pockets, even with no deaths', () => {
  const d = drill('blaze_single');
  const empty = { deaths: 0, cleared: true, damageTaken: 2, clearedMs: 12000, drops: 0, actions: ['hunt_mob'] };
  assert.equal(summarise(d, [empty, empty]).verdict, 'FAIL');
  assert.match(summarise(d, [empty, empty]).failures.join(' '), /0 drops in 2 runs, wanted 1/);
  // A blaze drops a rod half the time, so the bar is a rod across the set,
  // not a rod every run.
  assert.equal(summarise(d, [empty, { ...empty, drops: 1 }]).verdict, 'PASS');
});

test('the scoreboard is a table with one aligned row per drill', () => {
  const rows = DRILLS.slice(0, 3).map(d => summarise(d, [{ deaths: 0, cleared: true, damageTaken: 3, clearedMs: 5000, drops: 1, actions: ['fight'] }]));
  const lines = table(rows).split('\n');
  assert.equal(lines.length, rows.length + 2, 'a header, a rule, and a row each');
  assert(lines[0].includes('drill') && lines[0].includes('verdict') && lines[0].includes('dmg'));
  assert(new Set(lines.map(l => l.length)).size === 1, 'every row is the same width');
  for (const row of rows) assert(table(rows).includes(row.drill));
});

test('the standing cell is the floored stand, so the arena can be checked block by block', () => {
  assert.deepEqual(standingCell(drill('blaze_swarm_wall')), { x: 2003, y: 77, z: 2010 });
  assert.deepEqual(standingCell(drill('zombie_single')), { x: 2042, y: 77, z: 2003 });
  for (const d of DRILLS) {
    const [x1, y1, z1, x2, y2, z2] = ARENAS[d.arena].hollow;
    const cell = standingCell(d);
    assert(cell.x >= x1 && cell.x <= x2 && cell.y >= y1 && cell.y <= y2 && cell.z >= z1 && cell.z <= z2, d.name);
  }
});

test('the sweep covers the whole shell and spares the players in it', () => {
  for (const [name, arena] of Object.entries(ARENAS)) {
    const [x1, y1, z1, x2, y2, z2] = arena.shell;
    const line = sweep(name);
    assert(line.startsWith('execute in minecraft:the_nether run kill @e[type=!minecraft:player'), name);
    assert(line.includes(`x=${x1},y=${y1},z=${z1}`), `${name} starts at its shell corner`);
    assert(line.includes(`dx=${x2 - x1},dy=${y2 - y1},dz=${z2 - z1}`), `${name} spans its whole shell`);
  }
});

test('a drill can add to the kit, so what a tool is worth can be measured', () => {
  const withBow = resetCommands('ArenaX', drill('blaze_pair_bow')).join('\n');
  assert(withBow.includes('give ArenaX minecraft:bow 1'));
  assert(withBow.includes('give ArenaX minecraft:arrow 32'));
  const without = resetCommands('ArenaX', drill('blaze_pair')).join('\n');
  assert(!without.includes('minecraft:bow'), 'the plain drill keeps the loadout the dream run actually carried');
  for (const text of [withBow, without]) assert(text.includes('give ArenaX minecraft:diamond_sword 1'), 'the standard kit is still given');
});

test('the tower arena puts the mobs in a sealed room under the floor the bot stands on', () => {
  const tower = ARENAS.tower;
  const spawner = drill('blaze_spawner');
  const [, roofTop] = [tower.chamber[4], tower.hollow[1]];
  assert(tower.chamber[4] < tower.hollow[1] - 1, 'the chamber ceiling is below the floor the bot stands on');
  assert.equal(spawner.arena, 'tower');
  for (const at of spawner.at) assert(at[1] < tower.hollow[1], 'every blaze starts below the bot');
  const build = arenaBuild('tower');
  assert.equal(build.length, 5, 'forceload, shell, upper room, lower chamber, sweep');
  assert(build[3].includes('minecraft:air') && build[3].includes('1905 77 1905'), 'the chamber is carved too');
});

test('every fill an arena makes is within the server\'s 32768-block limit', () => {
  const { arenaBuild } = require('../scripts/lib/arena');
  for (const name of Object.keys(ARENAS)) for (const line of arenaBuild(name)) {
    const m = / fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) /.exec(line);
    if (!m) continue;
    const [x1, y1, z1, x2, y2, z2] = m.slice(1).map(Number);
    const volume = (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1) * (Math.abs(z2 - z1) + 1);
    assert(volume <= 32768, `${name}: ${line} fills ${volume}`);
  }
});
