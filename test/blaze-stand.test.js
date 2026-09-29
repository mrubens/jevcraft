'use strict';
// Blazes as the arena measured them (note 577): the volley read from the
// glow, the flames at the feet, the stands at the spawner's cage and the
// close-in with the sword, each offered with what the drills measured.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const stand = require('../src/blaze-stand');
const { threats } = require('../src/danger');

function brickWorld(solid, { lava = () => false, spawner = null, fire = () => false, items = ['iron_sword', 'iron_pickaxe', 'netherrack'], shield = true } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const cache = new Map();
  const blockAt = p => {
    const f = p.floored(), key = `${f}`;
    if (!cache.has(key)) {
      const name = spawner && f.equals(spawner) ? 'spawner' : lava(f) ? 'lava' : fire(f) ? 'fire' : solid(f) ? 'nether_bricks' : 'air';
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = f; cache.set(key, b);
    }
    return cache.get(key);
  };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [] }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => items.map(name => ({ name, type: registry.itemsByName[name].id, count: /pickaxe|sword/.test(name) ? 1 : 64, durabilityUsed: 0 })),
      slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) } },
    blockAt, world: { raycast: () => null }, pathfinder: { movements: {} } });
  bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), at = point || bot.entity.position, out = [];
    for (let x = -14; x <= 14; x++) for (let y = -3; y <= 3; y++) for (let z = -14; z <= 14; z++) {
      const p = at.floored().offset(x, y, z);
      if (p.distanceTo(at) <= maxDistance && ids.includes(blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(at) - b.distanceTo(at)).slice(0, count);
  };
  return bot;
}
const blazeAt = (id, x, y, z, glowing = false) => ({ id, name: 'blaze', type: 'hostile', position: new Vec3(x, y, z), height: 1.8, width: 0.6, isValid: true, metadata: { 16: glowing ? 1 : 0 } });

test('a blaze\'s volley is read from its glow: due from 2.4 seconds into it until a second after it ends, and not in its rest', () => {
  const bot = new EventEmitter();
  stand.volleyWatch(bot);
  const blaze = blazeAt(1, 5, 64, 0);
  const t0 = Date.now();
  blaze.metadata[16] = 1; bot.emit('entityUpdate', blaze);
  assert.equal(stand.charged(blaze), true);
  assert.equal(stand.volleyDue(bot, blaze, t0 + 1000), false, 'a second into the glow: the shots are two seconds off');
  assert.equal(stand.volleyDue(bot, blaze, t0 + 2500), true, 'the shots at 3.0, 3.3 and 3.6 are coming');
  assert(Math.abs(stand.volleyIn(bot, blaze, t0 + 1000) - 2) < 0.1);
  blaze.metadata[16] = 0; bot.emit('entityUpdate', blaze);
  const rest = blaze._restAt;
  assert.equal(stand.volleyDue(bot, blaze, rest + 500), true, 'the last shot still in the air');
  assert.equal(stand.volleyDue(bot, blaze, rest + 2000), false, 'resting');
  assert(Math.abs(stand.volleyIn(bot, blaze, rest + 2000) - 6) < 0.1, 'five of rest and three of glow before the next');
  // A glow first seen part way through is due at once.
  const late = blazeAt(2, 5, 64, 3, true);
  assert.equal(stand.volleyDue(bot, late), true);
});

test('the flames the bot\'s body stands in are found in every column its box touches, and put out with a punch', async () => {
  const fire = p => p.x === 1 && p.y === 64 && p.z === 0;
  const bot = brickWorld(p => p.y <= 63, { fire });
  bot.entity.position = new Vec3(0.9, 64, 0.5);
  assert.deepEqual(stand.flamesTouching(bot).map(b => `${b.position}`), ['(1, 64, 0)'], 'the box reaches over into the fire\'s column');
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  assert.deepEqual(stand.flamesTouching(bot), [], 'the middle of its own cell: clear');
  bot.entity.position = new Vec3(0.9, 64, 0.5);
  const punched = [];
  Object.assign(bot, { dig: async b => { punched.push(`${b.position}`); }, clearControlStates() {}, deactivateItem() {} });
  const { Task } = require('../src/skills');
  assert.equal(await stand.putOutFlames(bot, new Task('x')), true);
  assert.deepEqual(punched, ['(1, 64, 0)']);
});

// A fortress floor along a brick wall at z <= -1, the spawner four blocks
// out at (4, 64, 3), a blaze over the floor by it.
const floorByWall = p => p.y <= 63 || p.z <= -1;

test('by a spawner on an open floor, the cage is offered with rock at the back, and a hole in the wall beside it with the mouth toward it', () => {
  const bot = brickWorld(floorByWall, { spawner: new Vec3(4, 64, 3) });
  bot.entity.position = new Vec3(-4.5, 64, 2.5);
  const blaze = blazeAt(3, 5.5, 65, 4.5);
  bot.entities = { 3: blaze };
  const site = stand.spawnerSite(bot);
  assert(site, 'no ceiling, but a wall at the back');
  assert(bot.blockAt(site.cell.offset(0, 2, 0)).boundingBox === 'empty');
  const hole = stand.spawnerHoleSite(bot);
  assert(hole, 'a hole beside the cage');
  assert.equal(hole.hole.z, -1, 'dug into the wall');
  assert.deepEqual(hole.side, new Vec3(0, 0, -1), 'going away from the cage: the mouth faces it');
  assert(hole.off <= 4.5, `${hole.off} from the cage`);
  const options = stand.blazeStands(bot, threats(bot, 24), { hunted: true });
  assert(options.dig_in_at_spawner, Object.keys(options).join(','));
  assert.match(options.dig_in_at_spawner.description, /blocks from the blaze spawner's cage, dig a hole one wide and two high into it with the mouth toward the cage/);
  assert.match(options.dig_in_at_spawner.description, /every shot comes in through the mouth, from in front where the shield faces/);
  assert.match(options.fight_at_spawner.description, /with rock at its back/);
});

test('close_in is offered with a blaze over ground the sword reaches from, not over lava', () => {
  // A floor to x = 6, lava past it.
  const solid = p => p.y <= 63 && p.x <= 6;
  const lava = p => p.y === 63 && p.x > 6;
  const bot = brickWorld(solid, { lava });
  const over = blazeAt(3, 5.5, 64.5, 0.5);
  bot.entities = { 3: over };
  const options = stand.blazeStands(bot, threats(bot, 24), { dig: false, hunted: true });
  assert(options.close_in, Object.keys(options).join(','));
  assert.match(options.close_in.description, /^Go at them with the sword: walk in on the nearest blaze ground reaches \(5 blocks off/);
  assert.match(options.close_in.description, /a shield raised and facing it as the glow ends takes all three whole, the fire with them/);
  // Over the lava ten out: no ground within the sword's reach of it.
  bot.entities = { 4: blazeAt(4, 11.5, 64.5, 0.5) };
  assert(!stand.blazeStands(bot, threats(bot, 24), { dig: false }).close_in, 'over lava');
});

// mid-242-aa-fortress-5 at 15:16:45 (note 614): a stone sword, no armour,
// no shield, 20 health, one blaze 4.3 off in sight and four more ten to
// thirteen off behind the walls. Offered cover, holds, heal and retreat,
// never the charge a player makes: close_in asked for a shield.
function aaFight({ shield = false } = {}) {
  const bot = brickWorld(openFloor, { items: ['stone_sword', 'cobblestone'], shield });
  bot.inventory.slots = { ...(shield ? { 45: { name: 'shield' } } : {}) };
  const hidden = [blazeAt(11, -9.5, 65, 4.5), blazeAt(12, -10.5, 65, -3.5), blazeAt(13, 6.5, 66, 10.5), blazeAt(14, 12.5, 65, -4.5)];
  bot.entities = { 10: blazeAt(10, 4.8, 64.5, 0.5), ...Object.fromEntries(hidden.map(e => [e.id, e])) };
  // Walls between the bot and the four: no line reaches them.
  bot.world.raycast = (from, dir, len) => { const to = from.plus(dir.scaled(len)); return hidden.some(h => h.position.distanceTo(to) < 2.5 || h.position.distanceTo(from) < 2.5) ? { position: from.plus(dir).floored(), intersect: from.plus(dir) } : null; };
  return bot;
}
test('without a shield the blaze in reach is still charged, as close_in and as the nearest alone, priced with every fireball landing at its chance (mid-242-aa-fortress-5, note 614)', () => {
  const bot = aaFight();
  const danger = threats(bot, 24);
  assert.deepEqual(danger.filter(t => t.visible).map(t => t.entity.id), [10], 'the one in sight');
  const options = stand.blazeStands(bot, danger, { dig: false });
  const close = options.close_in, charge = options.charge_nearest;
  assert(close && charge, Object.keys(options).join(','));
  assert.match(close.description, /^Go at them with the sword: no shield carried: walk straight in on the nearest blaze ground reaches \(4\.3 blocks off/);
  assert.match(close.description, /No shield is carried: every fireball from those that see the bot lands at its chance by distance/);
  assert.doesNotMatch(close.description, /behind the shield|the lulls|with the shield down/);
  // The arena's runs, measured with another kit, are not said as this
  // bot's price: the kit is, and what the difference does (note 696).
  assert.match(close.description, /The arena measured this only with an iron sword, a shield and iron armour, not this bot's kit \(a stone sword, no armour, no shield\), so its runs are not this bot's price and are not said here: without a shield every fireball that lands is taken, where the arena's shield faced to each volley let about one in 30 through; a fireball's hit is about 5 through what this bot wears, 2\.5 through the arena's full iron\./);
  assert.doesNotMatch(close.description, /same kit|fight by fight|runs: \d+ killed/);
  // The nearest alone: one kill, then asked again.
  assert.equal(charge.cost.kills, 1);
  // Those behind the walls count for the charge only with a line to where
  // it strikes from; the close-in goes on toward them, and counts them all.
  assert.equal(charge.cost.into, 0);
  assert.equal(close.cost.into, 4);
  assert.match(charge.description, /Worked from this fight: 1 blaze sees the bot now \(4 more about out of sight with no line to where the sword strikes it from, not counted until they see it\)\./);
  assert.equal(charge.cost.deathAt, null);
  assert(charge.cost.damage < close.cost.damage, `the one: ${charge.cost.damage}, all of them: ${close.cost.damage}`);
  assert(charge.cost.damage < 20 && charge.cost.seconds < 10, JSON.stringify(charge.cost));
  assert.match(charge.description, /^Charge the nearest blaze alone: 4\.3 blocks off, over ground the bot can stand on within a sword's reach of it; no shield carried: walk straight in on it, strike it until it dies/);
  assert.match(charge.description, /About [\d.]+ damage over the [\d.]+ seconds to that one killed, from 20 health, [\d.]+ after\./);
  // With a shield the same walk waits out the volleys behind it, and says so.
  const shielded = stand.blazeStands(aaFight({ shield: true }), threats(aaFight({ shield: true }), 24), { dig: false });
  assert.match(shielded.close_in.description, /stop and face each volley behind the shield/);
  assert(shielded.charge_nearest.cost.firstWalk.wall > shielded.charge_nearest.cost.firstWalk.walk, 'with a shield the walk waits out the volleys');
  assert.equal(charge.cost.firstWalk.wall, charge.cost.firstWalk.walk, 'without one it goes straight on');
  // One blaze about: close_in is that charge; no second option for it.
  const lone = brickWorld(openFloor, { items: ['stone_sword'], shield: false });
  lone.inventory.slots = {};
  lone.entities = { 3: blazeAt(3, 5.5, 64.5, 0.5) };
  const one = stand.blazeStands(lone, threats(lone, 24), { dig: false });
  assert(one.close_in && !one.charge_nearest, Object.keys(one).join(','));
});

test('every blaze option says what it gains toward the rods the goal still needs: the charge its kill, a hold a kill only if one comes, the heal none (note 614)', () => {
  const bot = aaFight();
  bot.health = 15;
  bot.inventory.items = () => [{ name: 'stone_sword', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'cooked_mutton', count: 3 }];
  const goal = { mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 8 } };
  const need = stand.rodsNeeded(bot, goal);
  assert.equal(need, 8);
  const options = stand.blazeStands(bot, threats(bot, 24), { dig: false, need });
  for (const [k, o] of Object.entries(options)) assert.match(o.description, / Toward the rods: /, k);
  assert.match(options.charge_nearest.description, /Toward the rods: about 1 blaze killed in about [\d.]+ seconds, about 0\.5 rods on the average \(a blaze drops one about half the time\); 8 rods still needed\./);
  if (options.back_to_wall) assert.match(options.back_to_wall.description, /Toward the rods: a kill only if a blaze comes within the sword's reach; 8 rods still needed/);
  if (options.leave_and_heal) assert.match(options.leave_and_heal.description, /Toward the rods: none, no blaze killed; the blazes stay, and waiting does not send them away/);
  // No hunt for rods: nothing said.
  const none = stand.blazeStands(bot, threats(bot, 24), { dig: false, need: stand.rodsNeeded(bot, {}) });
  for (const o of Object.values(none)) assert.doesNotMatch(o.description, /Toward the rods/);
});

test('a stand says what the arena measured of it, every fight measured, the one like this fight first', () => {
  const bot = brickWorld(p => p.y <= 63);
  bot.entities = { 3: blazeAt(3, 5.5, 64.5, 0.5) };
  const before = stand.MEASURED.close;
  stand.MEASURED.close = { spawner: { runs: 3, kills: 2, rods: 1, damage: 30, deaths: 2 }, one: { runs: 3, kills: 3, rods: 2, damage: 2.5, deaths: 0 } };
  try {
    const o = stand.blazeStands(bot, threats(bot, 24), { dig: false }).close_in;
    assert.match(o.description, /The arena's runs of it with the same kit, fight by fight: against one blaze in the open eight blocks off, 3 runs: 3 killed, 2 rods carried away, about 2\.5 damage a run on the median, no deaths; against three blazes by a live spawner [^,]+, 3 runs: 2 killed, 1 rod carried away, about 30 damage a run on the median, 2 deaths\./);
    // The rows are said; the price is the sum of this fight (note 602), not a row's.
    assert.equal(o.expects.damage, o.cost.damage);
  } finally { if (before) stand.MEASURED.close = before; else delete stand.MEASURED.close; }
});

// The close-in's price, worked from the fight at hand (note 602). Three
// live deaths chose it on "about 21 damage a run, as measured" (three
// blazes twenty off): four blazes nine to eleven off by a live spawner at
// 14.1 health, alight; eight within one to seven at 13 and at 5.5.
const openFloor = p => p.y <= 63;
const alight = (bot, seconds) => { bot.entity.metadata[0] = 1; bot._alightUntil = Date.now() + seconds * 1000; };
test('close_in is priced by the fight at hand: four blazes nine to eleven off by a live spawner, alight at 14.1, runs the health out; one blaze at eight does not (note 602)', () => {
  // mid-243-ag-fortress-1 at 11:45:02, the four in sight where they were
  // from the bot, the spawner twelve off, seven seconds of fire left.
  const bot = brickWorld(openFloor, { spawner: new Vec3(12, 64, 1) });
  bot.health = 14.1; alight(bot, 7);
  bot.entities = { 577: blazeAt(577, 4.4, 63.9, 10), 839: blazeAt(839, 11.4, 64.5, 0.2), 578: blazeAt(578, 1.7, 67.6, 13.1), 782: blazeAt(782, 15, 65.5, 3.3) };
  const o = stand.blazeStands(bot, threats(bot, 24), { dig: false }).close_in;
  assert(o.cost.deathAt > 0 && o.cost.deathAt < 20, `health runs out: ${JSON.stringify(o.cost)}`);
  assert(o.expects.damage >= 14.1, `priced at the health or more, not the drill's 21 over 45 seconds: ${o.expects.damage} over ${o.expects.seconds}`);
  assert.equal(o.cost.seeing, 4);
  assert.equal(o.cost.covered, 4, 'spread over 86 degrees: the shield faced at their middle covers all four');
  assert.equal(o.cost.spawning, true);
  assert.match(o.description, /Worked from this fight: 4 blazes see the bot now, spread over 86 degrees round it\./);
  assert.match(o.description, /with 4 blazes at it the walk has the lulls, about 32 in 100 of the time: the 1\.7 seconds of walking to the nearest take about 5\.3\./);
  assert.match(o.description, /Each blaze in reach takes about 4 swings of the sword, about 3\.6 seconds with the shield down, while every one that sees the bot shoots as if it were down/);
  assert.match(o.description, /from 14\.1 health: the health runs out at about [\d.]+ seconds in, after about [01] of them killed/);
  assert.match(o.description, /The spawner within sixteen blocks puts in about one more every six seconds/);
  // One blaze at eight in the open: the arena's lone blaze, won for 2.1.
  const one = brickWorld(openFloor);
  one.entities = { 3: blazeAt(3, 8.5, 64.5, 0.5) };
  const lone = stand.blazeStands(one, threats(one, 24), { dig: false }).close_in;
  assert.equal(lone.cost.deathAt, null);
  assert.equal(lone.cost.kills, 1);
  assert(lone.expects.damage < 5, `${lone.expects.damage}`);
});

test('close_in with eight blazes about the bot within one to eight blocks runs the health out before the first is killed (mid-242-ah-nether-2-fortress-1, note 602)', () => {
  // 11:58:37, the bot fallen among them by the spawner: nine sword hits
  // landed in six seconds, none of the eight killed, 13 to none.
  const ring = brickWorld(openFloor, { spawner: new Vec3(1, 64, 2) });
  ring.health = 13;
  const at = [[0.9, 0.3, 36], [2.3, 0, 5], [2.6, 2.4, 134], [3.1, 1, 16], [3.1, 0, 14], [6.4, 2.5, 22], [6.7, 4.4, 24], [7.8, 0, 43]];
  ring.entities = Object.fromEntries(at.map(([d, dy, deg], i) => [i + 10, blazeAt(i + 10, 0.5 + d * Math.cos(deg * Math.PI / 180), 64 + dy, 0.5 + d * Math.sin(deg * Math.PI / 180))]));
  const o = stand.blazeStands(ring, threats(ring, 24), { dig: false }).close_in;
  assert.equal(o.cost.kills, 0);
  assert(o.cost.deathAt < o.cost.strikeSeconds, `dead in ${o.cost.deathAt} seconds, the first kill takes ${o.cost.strikeSeconds}`);
  assert(o.cost.covered < o.cost.seeing, 'spread over more than the shield covers');
  assert.match(o.description, /the other \d land as if it were down/);
  assert.match(o.description, /a blaze within two blocks swings for about 3\.1 once a second instead/);
  assert.match(o.description, /from 13 health: the health runs out at about [\d.]+ seconds in, after about 0 of them killed/);
});

test('the close-in that gets nowhere ends within a volley\'s cycle and says why; taken as a stance it fails with that (mid-243-ag-fortress-1, note 602)', async () => {
  // Stood 22 seconds on one cell behind the shield, never a step nor a
  // swing, burning from 14.1 to 7.1; chosen again, the same to 0.4.
  const bot = brickWorld(openFloor);
  Object.assign(bot, { equip: async () => {}, heldItem: { name: 'iron_sword' }, lookAt: async () => {}, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {}, dig: async () => {} });
  bot.inventory.slots[0] = null;
  bot.entities = { 577: blazeAt(577, 10.5, 64.5, 0.5) };
  const { Task } = require('../src/skills');
  // Under fourteen health the hunt's claim lapses: the walk toward a blaze
  // in sight was refused by every cell nearer it, "no route" (note 602).
  bot.health = 10;
  const { safeFromHostiles } = require('../src/danger');
  const nearer = new Vec3(6.5, 64, 0.5), walkable = [];
  assert.equal(safeFromHostiles(bot, nearer, [bot.entities[577]]), false, 'unclaimed: nearer a shooter in sight is refused');
  const noRoute = async () => { walkable.push(safeFromHostiles(bot, nearer, [bot.entities[577]])); throw Object.assign(new Error('no path'), { name: 'NoRoute' }); };
  const started = Date.now();
  const result = await stand.closeIn(bot, new Task('t'), {}, () => {}, { navigate: noRoute, seconds: 10, stallMs: 600 });
  assert(Date.now() - started < 3000, `ended at the stall, not the run's ten seconds: ${Date.now() - started} ms`);
  assert.match(result.stalled || '', /^\d+ seconds without a step nearer a blaze or a swing; the walk to one failed/);
  assert(walkable.length && walkable.every(Boolean), 'during the close-in the walk may near the blazes at 10 health');
  assert.equal(safeFromHostiles(bot, nearer, [bot.entities[577]]), false, 'and not after it');
  await assert.rejects(stand.takeStand(bot, new Task('t'), {}, () => {}, { kind: 'close', site: {} }, { navigate: noRoute, stallMs: 600 }).catch(err => { throw err; }),
    err => err.name === 'StanceFailed' && /the close-in got nowhere: \d+ seconds without a step nearer a blaze or a swing/.test(err.message));
});

test('break_spawner is priced as the close-in is, the walk to the cage and the digging first, and none come after (note 602)', () => {
  // The arena's drill of four nine to eleven off: once close_in said its
  // sum, break_spawner, still "about 34.1 damage a run, as measured" with
  // three blazes twenty off, was taken instead, twice to death.
  const bot = brickWorld(openFloor, { spawner: new Vec3(8, 64, 0) });
  bot.entities = { 1: blazeAt(1, 10.5, 66, 0.5), 2: blazeAt(2, 8.5, 68, 5.5), 3: blazeAt(3, 7.5, 65, -5.5), 4: blazeAt(4, -6.5, 66, 6.5) };
  const options = stand.blazeStands(bot, threats(bot, 24));
  const o = options.break_spawner;
  assert(o, Object.keys(options).join(','));
  assert.equal(o.expects.damage, o.cost.damage);
  assert.equal(o.cost.spawning, false, 'broken, it makes no more');
  assert(o.cost.phases[0].what === 'walk' && o.cost.phases[1].what === 'dig', JSON.stringify(o.cost.phases));
  assert.match(o.description, /Worked from this fight: 4 blazes see the bot now/);
  assert.match(o.description, /the digging is done with the shield down, (the others|each) shooting meanwhile[^.]*; after it no more come\./i);
  assert.doesNotMatch(o.description, /as measured\./);
});

test('break_spawner is priced at the cage with the blazes out of sight round it: mid-242-bc-fortress-2 read 7.8 damage from one blaze in sight and lost 12.6 in three seconds (note 623)', () => {
  // 25587, 17:56:27: one blaze in sight 4.3 off, five more out of sight
  // eight to ten off, hovering round the cage five blocks' walk away; the
  // bot at 13.3 in an iron helmet and chestplate with a shield. A wall of
  // brick at x 3 stands between the bot and the cage.
  const wall = p => p.y <= 63 || (p.x === 3 && p.z >= -2 && p.z <= 2 && p.y <= 66);
  const bot = brickWorld(wall, { spawner: new Vec3(8, 64, 0) });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } };
  bot.health = 13.3;
  // The rays stop at the wall (a step of a tenth along the line).
  bot.world.raycast = (from, u, length) => {
    for (let s = 0; s <= length; s += 0.1) { const p = from.plus(u.scaled(s)); if (wall(p.floored())) return { position: p.floored(), intersect: p }; }
    return null;
  };
  bot.entities = { 1: blazeAt(1, 1.5, 65, 4.8), 2: blazeAt(2, 9.5, 66, 1.5), 3: blazeAt(3, 9, 66, -1.5), 4: blazeAt(4, 10.5, 66, 0.5), 5: blazeAt(5, 8.5, 66, 2.5), 6: blazeAt(6, 7.5, 66, -2.5) };
  const danger = threats(bot, 24).filter(t => t.visible);
  assert.deepEqual(danger.map(t => t.entity.id), [1], 'the stance\'s list: the one in sight');
  const o = stand.blazeStands(bot, danger).break_spawner;
  assert(o, 'offered');
  assert(o.cost.into >= 5, `the five out of sight within sixteen counted: ${JSON.stringify(o.cost)}`);
  assert(o.cost.atCage && o.cost.atCage.within5 >= 3, `at the cage, three or more within five: ${JSON.stringify(o.cost.atCage)}`);
  assert(o.expects.damage >= 13.3 && o.cost.deathAt != null, `more than the bot has, as it was: ${o.expects.damage}, ${JSON.stringify(o.cost.phases)}`);
  assert.match(o.description, /Broken, it makes no more, ever: the 6 about now stay/);
  assert.match(o.description, /At the cell by the cage \d of them are within five blocks, the nearest [\d.]+ off/);
  assert.match(o.description, /It runs \d+ seconds, or until six health is gone, and is asked again then\./);
});

test('breaking the spawner ends once six health is gone, walk and dig counted, and does not go on to the close-in (note 623)', async () => {
  const bot = brickWorld(openFloor, { spawner: new Vec3(8, 64, 0) });
  bot.health = 14.3;
  bot.entities = { 1: blazeAt(1, 9.5, 66, 1.5) };
  const { Task } = require('../src/skills');
  let walks = 0;
  const navigate = async () => { walks++; bot.health -= 3.9; await new Promise(r => setTimeout(r, 20)); };
  Object.assign(bot, { clearControlStates() {}, deactivateItem() {}, activateItem() {}, lookAt: async () => {}, equip: async () => {}, dig: async () => {}, heldItem: null });
  const site = stand.breakSite(bot);
  const started = Date.now();
  const result = await stand.breakSpawner(bot, new Task('t'), {}, () => {}, site, { navigate, seconds: 10 });
  assert(Date.now() - started < 3000, `ended on the health, not the ten seconds: ${Date.now() - started} ms`);
  assert.equal(walks, 2, 'two fireballs: 7.8 gone, asked again');
  assert.equal(result.ended, 'health down');
  assert.equal(result.kills, 0);
});
