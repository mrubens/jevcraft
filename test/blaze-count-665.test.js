'use strict';
// Note 665: the fight at a live blaze spawner with four or more blazes about (half of them ended in a death):
// what Jev is told at the entry (blazes in sight, how many have a line to the cell, the record by count with
// its N, the clock of the spawner's first four) and the one route the game allows to a smaller count, waiting
// past the despawn distance (wait_far_off), offered with its rule and with what no record shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const record = require('../src/blaze-record');
const script = require('../scripts/blaze-record');
const T = require('../src/blaze-tactics');
const stand = require('../src/blaze-stand');

function floorWorld({ spawner = new Vec3(0, 64, 0), solid = p => p.y <= 63 || p.z <= -5, at = new Vec3(0.5, 64, 9.5), health = 20, food = 20 } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => {
    const f = p.floored(), name = spawner && f.equals(spawner) ? 'spawner' : solid(f) ? 'nether_bricks' : 'air';
    const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f;
    return b;
  };
  const stock = [['iron_sword', 1], ['stone_pickaxe', 1], ['cobblestone', 24], ['cooked_beef', 6]];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food, entities: {},
    entity: { position: at.clone(), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} } });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), c = point || bot.entity.position, out = [];
    for (let x = -16; x <= 16; x++) for (let y = -4; y <= 4; y++) for (let z = -16; z <= 16; z++) {
      const p = c.floored().offset(x, y, z);
      if (p.distanceTo(c) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(c) - b.distanceTo(c)).slice(0, count);
  };
  return bot;
}
const blazeAt = (bot, id, x, y, z) => { const e = { id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: 0 } }; bot.entities[id] = e; return e; };
const near = bot => require('../src/danger').threats(bot, 24);
const spread = bot => { [[1, 1, 68, 1], [2, -2, 68, 2], [3, 2, 66, -2], [4, 0, 68, 3]].forEach(([id, x, y, z]) => blazeAt(bot, id, x, y, z)); };

test('the counts table: fights at a live spawner by the most blazes within sixteen, the rest by the same, four or more by the nearest the bot came, and the clock', () => {
  const f = (peak16, died, rod, o = {}) => ({ spawnerNear: true, spawnerMin: 6, peak16, died, rod, rods: rod ? 1 : 0, lost: 10, n24start: 2, toFour: peak16 >= 4 ? 30 : null, rodT: rod ? 15 : null, secs: 50, ...o });
  const list = [f(2, false, true), f(3, false, false), f(4, true, false), f(5, true, true), f(7, false, true, { spawnerMin: 13 }), f(1, false, false, { spawnerNear: false }), f(5, false, false, { spawnerNear: false })];
  const t = script.countsTable(list);
  assert.equal(t.atSpawner['to 3'].fights, 2);
  assert.equal(t.atSpawner['4'].died, 1);
  assert.equal(t.atSpawner['5 to 6'].rod, 1);
  assert.equal(t.atSpawner['7 and more'].fights, 1);
  assert.equal(t.noSpawner['0 to 1'].fights, 1);
  assert.equal(t.noSpawner['4 and more'].fights, 1);
  assert.equal(t.fourAtSpawnerByNearest['within 8'].fights, 2);
  assert.equal(t.fourAtSpawnerByNearest['13 to 16'].fights, 1);
  assert.equal(t.clock.beganWithOneToThreeInSight, 5);
  assert.equal(t.clock.reachedFour, 3);
  assert.equal(t.clock.secondsToFour.median, 30);
});

test('how far the bot moved in a fight stops at its death: the frames after it carry the respawn\'s position, blocks away', () => {
  const T0 = Date.parse('2026-09-28T10:00:00Z');
  const frame = (s, snapshot, extra = {}) => ({ at: T0 + s * 1000, kind: 'survival', snapshot: { dimension: 'the_nether', ...snapshot }, ...extra });
  const bz = [{ name: 'blaze', id: 1, d: 8, seen: true, at: { x: 8, y: 62, z: 0 } }];
  const frames = [frame(0, { health: 20, food: 20, position: { x: 0, y: 60, z: 0 }, mobs: bz }), frame(6, { health: 6, food: 20, position: { x: 3, y: 60, z: 0 }, mobs: bz }),
    frame(10, { health: 0, food: 20, position: { x: 3, y: 60, z: 0 }, mobs: bz }), frame(11, { health: 20, food: 20, position: { x: 200, y: 70, z: 200 } })];
  const [e] = script.fights(frames);
  assert.equal(e.died, true);
  assert.equal(script.describe(frames, e).moved, 3, 'the respawn 280 blocks off is not the fight\'s');
});

test('the entry facts: the blazes in sight, those within sixteen, how many have a line to the cell, the spawner\'s rule and the rows by count with their N', () => {
  const bot = floorWorld(), cage = new Vec3(0, 64, 0);
  spread(bot);
  const f = record.entryFacts(bot, { about: near(bot).map(t => t.entity), cage });
  assert.equal(f.blazesInSightNow, 4);
  assert.equal(f.within16, 4);
  assert.equal(f.withALineToTheCell, 4, 'open floor, all four see the cell');
  assert.match(f.says, /^Blazes in sight now: 4; 4 within sixteen blocks, in sight or not, 4 of them with a line to the cell the bot stands in\. A live spawner is 9 blocks off; the bot has been within sixteen of it 0 seconds\./);
  assert.match(f.says, /three or fewer, 85 fights, 22% died, 53% brought a rod, 0\.9 rods a fight and 4 rods for each death/);
  assert.match(f.says, /four, 29 fights, 52% died/);
  assert.match(f.says, /five or six, 85 fights, 49% died/);
  assert.match(f.says, /seven or more, 130 fights, 30% died/);
  assert.match(f.says, /none or one, 144 fights, 13% died/);
  assert.match(f.says, /within 8 blocks 178 fights, 42% died.*9 to 12 blocks 47 fights, 34% died/);
  assert.match(f.says, /of the 163 fights at a spawner that began with one to three blazes in sight, 82 reached four or more within sixteen, a median 32 seconds after the start \(nine in ten within 65\)/);
  assert.match(f.says, /first rod came a median 16 seconds in.*a death at four or more came a median 58 seconds in/);
  assert.match(f.says, /not what entering with that many would do/);
  assert.match(f.says, /Another spawner, in this fortress or another, is the same rule: its first try is up to four blazes/);
  assert.match(f.says, /Ranged, carried now: no bow, 0 arrows, 0 snowballs\. A bow is three sticks and three string; string comes from spiders \(the Nether has none\) and, in the Nether, only from a piglin's barter/);
  assert.match(f.says, /8 of the 567 began with a bow and arrows carried \(2 died\) and 0 with snowballs/);
  // The count's own honesty: nothing is said of a row it does not hold.
  assert.doesNotMatch(f.says, /undefined|NaN/);
});

test('behind a wall a blaze without a line to the cell is not counted as seeing it, and with no spawner near the rule is said and the rows are the plainer ones', () => {
  const bot = floorWorld({ solid: p => p.y <= 63 || p.z <= -5 || (p.z === 6 && p.y <= 66) });
  blazeAt(bot, 1, 0, 65.5, 2); blazeAt(bot, 2, 3, 65.5, 4);
  const f = record.entryFacts(bot, { about: near(bot).map(t => t.entity), cage: null });
  assert.equal(f.withALineToTheCell, 0, 'a wall three high at z 6 between them and the bot at z 9.5');
  assert.equal(f.spawnerBlocksAway, null);
  assert.match(f.says, /^Blazes in sight now: 2; 2 within sixteen blocks, in sight or not, 0 of them with a line/);
  assert.match(f.says, /^.*The spawner's rule \(the server jar\): while a player is within sixteen blocks of a live blaze spawner it tries up to four blazes every ten to forty seconds until six are about, and none beyond sixteen\./);
  assert.match(f.says, /four or more about \(244 fights\), 39% died and 31% brought a rod/);
});

test('the stay within sixteen of a cage is counted from the first asking, and a gap of a minute begins another', () => {
  const bot = floorWorld(), cage = new Vec3(0, 64, 0), t0 = 1_000_000;
  assert.equal(record.stayWithin(bot, cage, t0), 0);
  assert.equal(record.stayWithin(bot, cage, t0 + 40000), 40);
  const f = record.entryFacts(bot, { cage, now: t0 + 41000 });
  assert.equal(f.secondsWithinSixteen, 41);
  assert.match(f.says, /within sixteen of it 41 seconds, past the median 32 seconds at which a fight there had four or more about/);
  assert.equal(record.stayWithin(bot, cage, t0 + 41000 + 61000), 0, 'a minute unseen and it is a new stay');
});

// A way out past 34 blocks of the cage: a fake route survey.
const route = (bot, { status = 'success', path, lava } = {}) => { bot.pathfinder.getPathTo = () => ({ status, path, ...(lava ? { lava } : {}) }); };
const walk = (fromZ, toZ) => { const p = []; for (let z = fromZ; z <= toZ; z++) p.push({ x: 0, y: 64, z }); return p; };

test('the way out is scouted with a route to any cell past 34 blocks of the cage, passing no blaze nearer than the nearest is now', async () => {
  const bot = floorWorld(), cage = new Vec3(0, 64, 0);
  spread(bot);
  route(bot, { path: walk(10, 50) });
  const blazes = Object.values(bot.entities), task = { check() {} };
  const found = await T.scoutFar(bot, task, blazes, cage, { now: 5000 });
  assert.ok(found.destination, found.none);
  assert.deepEqual(found.destination, { x: 0, y: 64, z: 50 });
  assert.equal(found.blocks, 41);
  assert.ok(found.radius >= 34 && found.radius <= 46, `radius ${found.radius}: 34 and the spread of the blazes about the cage`);
  assert.ok(found.nearestAlong >= found.nearestNow - 1.5);
  // The same cell within six seconds is not searched again.
  route(bot, { status: 'noPath', path: [] });
  assert.equal((await T.scoutFar(bot, task, blazes, cage, { now: 9000 })).destination.z, 50);
  // A route back through them is no way out.
  bot._farScout = null;
  route(bot, { path: walk(-30, -4) });
  const through = await T.scoutFar(bot, task, blazes, cage, { now: 20000 });
  assert.equal(through.destination, undefined);
  assert.match(through.none, /passes within .* blocks of a blaze, nearer than the/);
  // No route, or one too long, is said as such.
  bot._farScout = null; route(bot, { status: 'noPath', path: [] });
  assert.match((await T.scoutFar(bot, task, blazes, cage, { now: 30000 })).none, /no route was found/);
  bot._farScout = null; route(bot, { path: walk(10, 170) });
  assert.match((await T.scoutFar(bot, task, blazes, cage, { now: 40000 })).none, /161 blocks of walking/);
});

test('the despawn arithmetic: none in the first 30 seconds, about 78 in 100 gone at ninety seconds, 89 at two minutes', () => {
  assert.equal(T.farGone(20), 0);
  assert.equal(T.farGone(30), 0);
  assert.equal(T.farGone(90), 78);
  assert.equal(T.farGone(120), 89);
});

test('wait_far_off is offered at a live spawner with a way found, whatever the count, with the game\'s rule and what no record shows; and not without a way', async () => {
  const bot = floorWorld(), cage = new Vec3(0, 64, 0);
  blazeAt(bot, 1, 1, 68, 1);
  route(bot, { path: walk(10, 50) });
  await T.scoutFar(bot, { check() {} }, Object.values(bot.entities), cage);
  const one = stand.blazeStands(bot, near(bot)).wait_far_off;
  assert.ok(one, 'one blaze about, a live spawner, a way out: offered');
  assert.equal(one.kind, 'far');
  assert.match(one.description, /^Go out of their reach and let the room thin: walk 41 blocks/);
  assert.match(one.description, /a place \d+ blocks from the cage, the nearest blaze now [\d.]+ blocks off and none nearer than that along the way/);
  assert.match(one.description, /stay 120 seconds, eating what is carried \(health comes back at hunger 18 or more\)/);
  assert.match(one.description, /one in 800 each tick \(a mean of about 40 seconds each: about 78 in 100 gone at 90 seconds, 89 in 100 after 120 seconds here\), and at once beyond 128/);
  assert.match(one.description, /a blaze that follows in sight, or flies toward the bot, keeps its clock at nothing/);
  assert.match(one.description, /makes none while no player is within sixteen/);
  assert.match(one.description, /no bot has walked out and waited, so what is left of the room after 120 seconds is not counted/);
  assert.match(one.description, /first try is up to four blazes, ten to forty seconds after the bot is within sixteen of it again/);
  assert.match(one.description, /It kills no blaze itself\./);
  assert.ok(one.expects.seconds >= 120);
  // Four or more: still offered.
  spread(bot);
  assert.ok(stand.blazeStands(bot, near(bot)).wait_far_off, 'the same at four');
  // No way found, or found from another cell: not offered.
  bot._farScout = { ...bot._farScout, feet: '(99, 64, 99)' };
  assert.equal(stand.blazeStands(bot, near(bot)).wait_far_off, undefined);
  // No spawner within sixteen: nothing to wait out.
  const away = floorWorld({ spawner: null });
  blazeAt(away, 1, 1, 68, 1);
  away._farScout = { at: Date.now(), feet: `${require('../src/terrain').feetCell(away)}`, destination: { x: 0, y: 64, z: 50 }, blocks: 41, radius: 40, nearestNow: 8, nearestAlong: 8 };
  assert.equal(stand.blazeStands(away, near(away)).wait_far_off, undefined);
});

test('the option is a tactic the stance and the hunt run: kind far is among TACTICS and runTactic walks out and waits', async () => {
  assert.ok(stand.TACTICS.has('far'));
  const bot = floorWorld(), cage = new Vec3(0, 64, 0);
  blazeAt(bot, 1, 1, 68, 1);
  route(bot, { path: walk(10, 50) });
  const site = await T.scoutFar(bot, { check() {} }, Object.values(bot.entities), cage);
  const goals = [];
  bot.entity.position = new Vec3(0.5, 64, 9.5);
  const navigate = async (b, t, goal) => { goals.push(goal); b.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); };
  bot.lookAt = async () => {};
  const stats = {};
  bot.entities = {};
  await T.waitFarOff(bot, { check() {} }, {}, () => {}, site, { navigate, seconds: 0.2, stats });
  assert.equal(goals.length, 1, 'one walk out');
  assert.deepEqual([goals[0].x, goals[0].y, goals[0].z], [0, 64, 50]);
  assert.equal(stats.ended, 'time');
  assert.equal(typeof stats.seconds, 'number');
});

test('the fortress_visit question carries the count facts before any spawner is met', () => {
  const visit = require('../src/fortress-visit');
  const bot = floorWorld();
  bot.game.dimension = 'the_nether';
  const { state } = visit.facts(bot, { survival: {} }, { fortress: { distance: 40, height: 0 } });
  assert.match(state.blazeCounts, /^Blazes in sight now: 0/);
  assert.match(state.blazeCounts, /The spawner's rule \(the server jar\)/);
  assert.match(state.blazeCounts, /four or more about \(244 fights\), 39% died/);
});

// The recorded crossing (mid-243-ch, 25581, note 657): three blazes at the crossing, none a spawner's.
test('on the recorded crossing (mid-243-ch) the facts count three blazes in sight, those with a line to the cell, and no wait far off is offered where no spawner is within sixteen', () => {
  const { groundBot } = require('./fixtures/saved-ground');
  const CROSSING = require('./fixtures/crossing-blazes-mid-243-ch.json');
  const blazes = [[24104, -168.08, 58.78, 507.32], [24105, -166.21, 57, 501.3], [24103, -163.94, 57.61, 501.3]];
  const bot = groundBot(CROSSING, { at: new Vec3(-166.65, 57, 506.2), health: 20, dimension: 'the_nether', worn: ['iron_helmet', 'iron_chestplate'], held: 'iron_sword',
    items: [['iron_sword', 1], ['iron_pickaxe', 1], ['netherrack', 64]], mobs: blazes.map(([id, x, y, z]) => ({ id, name: 'blaze', at: new Vec3(x, y, z), height: 1.8, width: 0.6 })) });
  bot.inventory.slots[45] = { name: 'shield' };
  const f = record.entryFacts(bot, { about: Object.values(bot.entities).filter(e => e.name === 'blaze') });
  assert.equal(f.blazesInSightNow, 3);
  assert.equal(f.within16, 3);
  assert.ok(f.withALineToTheCell >= 1 && f.withALineToTheCell <= 3, `${f.withALineToTheCell} have a line`);
  assert.equal(f.spawnerBlocksAway, null);
  assert.match(f.says, /^Blazes in sight now: 3; 3 within sixteen blocks, in sight or not, \d of them with a line to the cell the bot stands in\. The spawner's rule/);
  bot._farScout = { at: Date.now(), feet: `${require('../src/terrain').feetCell(bot)}`, destination: { x: -166, y: 57, z: 530 }, blocks: 25, radius: 40, nearestNow: 5, nearestAlong: 5 };
  assert.equal(stand.blazeStands(bot, require('../src/danger').threats(bot, 24)).wait_far_off, undefined, 'a way found, but no live spawner within sixteen');
});
