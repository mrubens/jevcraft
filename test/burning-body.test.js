'use strict';
// Note 595: mid-244-bb (25581), burned to death at 06:09:22 in a cave at y 12
// to 20, out of a lava pool at 12.3 health with a water bucket carried. The
// bucket was not offered at 12.3 (the body falling into the dry cell by the
// lava) nor at 4.3 (in the air over a step, its box's edge on the stone):
// the pour looked only at the cell under the body's middle. Burning out was
// then the one way, held fifteen seconds or four health, and meanwhile
// survival_priority chose to walk for food, the fire in none of its facts.
// Jev, asked at 8.3 and 0.3, let it burn: the bucket said "about a second",
// burning out "about 8.3 health, all the health the bot has".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const body = require('../src/body');
const vitals = require('../src/vitals');
const arbiter = require('../src/arbiter');

// The ground as the region file saved after the death has it ('#' stone,
// 'L' lava, '.' air), layers from the bottom up, rows by z, columns by x.
// The step the bot walked up at 06:09:17: x 132 to 140, y 12 to 18, z 97 to 103.
const STEP = { origin: [132, 12, 97], layers: [
  ['#######..', '#######..', '#######..', '#######..', '#####....', '####..###', '#########'],
  ['######...', '######...', '#####....', '#####....', '####.....', '#########', '#########'],
  ['#####....', '####.....', '####.....', '####.....', '###..####', '#########', '#########'],
  ['####.....', '####.....', '###......', '###....##', '#########', '#########', '#########'],
  ['###......', '###......', '##......#', '##...####', '#########', '#########', '#########'],
  ['##.......', '##.......', '##.......', '#....####', '#########', '#########', '#########'],
  ['#.......#', '#.......#', '#.......#', '......###', '.########', '#########', '#########']] };
// The lava pool's edge at 06:09:09: x 155 to 163, y 10 to 15, z 92 to 98.
// The dry cell the way out went to, (159, 12, 95), and the cell over it,
// were open then (body_way's to_dry_ground named it); the saved world has
// lava run into both since.
const POOL = { origin: [155, 10, 92], open: ['159,12,95', '159,13,95'], layers: [
  ['....L....', '#######..', '#########', '#########', '#########', '#########', '#########'],
  ['....L....', '....L...#', '.#####..#', '#########', '#########', '#########', '#########'],
  ['.......##', '....L.###', '....L####', '....L####', '#########', '#########', '#########'],
  ['.....####', '....#####', '...######', '....LL###', '.########', '#########', '#########'],
  ['...######', '..#######', '.########', '####.LL##', '#########', '#########', '#########'],
  ['..#######', '#########', '#####.###', '#####.LL#', '#########', '#########', '#########']] };

function ground(fix) {
  const [ox, oy, oz] = fix.origin;
  return p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), at = new Vec3(x, y, z);
    let ch = fix.layers[y - oy]?.[z - oz]?.[x - ox];
    if ((fix.open || []).includes(`${x},${y},${z}`)) ch = '.';
    if (ch === undefined) ch = y - oy >= fix.layers.length ? '.' : '#';
    return ch === '#' ? { position: at, name: 'stone', boundingBox: 'block' } : ch === 'L' ? { position: at, name: 'lava', boundingBox: 'empty' } : { position: at, name: 'cave_air', boundingBox: 'empty' };
  };
}
function alightBot(fix, at, { health, fireLeft, items = [{ name: 'water_bucket', count: 1 }] } = {}) {
  return { health, food: 16, oxygenLevel: 20, entities: {}, game: { dimension: 'overworld' }, _alightUntil: Date.now() + fireLeft * 1000,
    entity: { position: at, width: 0.6, height: 1.8, metadata: [1], onGround: false },
    inventory: { items: () => items, slots: {} }, blockAt: ground(fix) };
}

test('the bucket is offered over the step the bot walked up at 06:09:17, its box\'s edge on the stone and the cell under its middle open', () => {
  const bot = alightBot(STEP, new Vec3(136.05, 15.59, 100.44), { health: 4.32, fireLeft: 6.6 });
  assert.equal(bot.blockAt(new Vec3(136, 14, 100)).name, 'cave_air', 'the cell under the middle is open, as the old pour read it');
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.deepEqual(Object.keys(ways), ['douse_bucket', 'burn_out'], 'the bucket first, the old rule\'s way');
  assert.deepEqual(vitals.pourFloor(bot), { cell: new Vec3(135, 15, 100), floor: new Vec3(135, 14, 100) }, 'poured onto the stone the box rests on');
});

test('the bucket is offered falling into the dry cell by the lava at 06:09:09, where burning out was the one way', () => {
  const bot = alightBot(POOL, new Vec3(159.69, 13.08, 95.43), { health: 12.32, fireLeft: 14.7 });
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.ok(ways.douse_bucket, `offered: ${Object.keys(ways)}`);
  assert.deepEqual(vitals.pourFloor(bot), { cell: new Vec3(159, 12, 95), floor: new Vec3(159, 11, 95) }, 'into the dry cell the body is dropping into');
});

test('poured over the step, the water goes onto the stone under the box\'s edge', async () => {
  const bot = alightBot(STEP, new Vec3(136.05, 15.59, 100.44), { health: 4.32, fireLeft: 6.6 });
  const items = [{ name: 'water_bucket', count: 1 }];
  bot.inventory = { items: () => items, slots: {} };
  const looks = [];
  Object.assign(bot, { equip: async item => { bot.held = item.name; }, lookAt: async p => { looks.push(p); },
    activateItem: () => { if (bot.held === 'water_bucket') { bot.entity.metadata[0] = 0; items[0] = { name: 'bucket', count: 1 }; } } });
  assert.equal(await vitals.douse(bot, new Task('burn')), true, 'the fire is out');
  assert.deepEqual(looks[0], new Vec3(135.5, 15, 100.5), 'the look at the top of the stone the box rests on');
});

test('burning out held as the one way ends when the bucket can be poured, and the fire is the body\'s question again', async () => {
  // In the air over open ground (no floor within two under the box): the bucket cannot be poured.
  const drop = { origin: [0, 60, 0], layers: [['#']] };
  const bot = alightBot(drop, new Vec3(0.5, 66.5, 0.5), { health: 12.32, fireLeft: 14.7 });
  bot.blockAt = p => p.y < 61 ? { position: p.floored(), name: 'stone', boundingBox: 'block' } : { position: p.floored(), name: 'air', boundingBox: 'empty' };
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.deepEqual(Object.keys(ways), ['burn_out']);
  const r = await body.answer(bot, new Task('t'), 'fire', ways, { client: { systemOne: () => assert.fail('one way is not asked') }, facts: { inFire: false }, log: () => {} });
  assert.equal(r.by, 'only');
  assert.ok(body.held(bot, 'fire'), 'held while it is the one way');
  assert.deepEqual(arbiter.observeReflexes(bot, []).map(x => x.key), [], 'and the reflex leaves it be');
  // Landed: the bucket pours now.
  bot.entity.position = new Vec3(0.5, 61, 0.5);
  bot._bodyHeld.lookedAt = 0;
  assert.equal(body.held(bot, 'fire'), null, 'a way not on offer then is on offer now: asked again');
  assert.deepEqual(arbiter.observeReflexes(bot, []).map(x => x.key), ['fire']);
});

test('the recorded 8.3 question prices each way by the burning it lets on, and the hold is asked again before the health is gone', async () => {
  // 06:09:13.5, on the floor of the cave at (147.6, 12, 98.3), 10.6 seconds of fire left.
  const bot = alightBot(STEP, new Vec3(147.61, 12, 98.33), { health: 8.32, fireLeft: 10.6 });
  bot.blockAt = p => p.y < 12 ? { position: p.floored(), name: 'stone', boundingBox: 'block' } : { position: p.floored(), name: 'cave_air', boundingBox: 'empty' };
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.match(ways.douse_bucket.description, /the fire is out as the water reaches the body, about half a second from now .* where burning on takes all 8\.3 health the bot has, its death in about 8\.3 seconds/);
  assert.match(ways.burn_out.description, /about 1[01] seconds of fire left at a health a second that armour does not stop is about 1[01] health, and the bot has 8\.3: it dies of the burning in about 8\.3 seconds, before the fire ends, unless something puts it out first\. Asked again at about 4\.3 health \(4 more\)/);
  assert.match(body.conditionSays(bot, 'fire', { inFire: false }), /all the health the bot has: it dies of the burning in about 8\.3 seconds/);
  // Chosen at 3.3, the hold ends at half what is left, not four more (which was the death).
  bot.health = 3.32;
  const low = vitals.fireWays(bot, new Task('t'));
  assert.match(low.burn_out.description, /Asked again at about 1\.7 health \(1\.7 more\)/);
  await body.answer(bot, new Task('t'), 'fire', low, { client: {}, decide: async () => ({ path: ['burn_out'] }), facts: { inFire: false } });
  assert.ok(body.held(bot, 'fire'));
  bot.health = 2.32;
  assert.ok(body.held(bot, 'fire'), 'one health on: still held');
  bot.health = 1.32;
  assert.equal(body.held(bot, 'fire'), null, 'asked again at 1.7, before the last health');
});

test('every other question asked while the body burns says the burning and the way left be', async () => {
  const { decide } = require('../src/decisions');
  const bot = alightBot(STEP, new Vec3(147.61, 12, 98.33), { health: 8.32, fireLeft: 10.6 });
  bot.blockAt = p => p.y < 12 ? { position: p.floored(), name: 'stone', boundingBox: 'block' } : { position: p.floored(), name: 'cave_air', boundingBox: 'empty' };
  bot._bodyHeld = { key: 'fire', choice: 'burn_out', by: 'only', at: Date.now(), until: Date.now() + 15000, health: 12.32, drop: 4, offered: ['burn_out'], lookedAt: Date.now() };
  let seen;
  const client = { systemOne: async ({ state }) => { seen = state; return { answers: { branch_0: { choice: 'obtain_food', confidence: 0.9 } } }; } };
  const tree = { obtain_food: { description: 'Obtain safe food.' }, wait_for_day_sealed: { description: 'Seal a pocket and wait.' } };
  await decide('survival_priority', { client, bot, goal: {}, tree, state: { health: 8.32 } });
  assert.match(seen.alight, /The bot is alight at 8\.3 health: about 10\.\d seconds of fire left, .* all the health the bot has: it dies of the burning in about 8\.3 seconds, before the fire ends, unless water puts it out first/);
  assert.match(seen.alight, /burning out was the only way there was at 12\.3 health; the way out is asked again at about 8\.3 health/);
  bot.entity.metadata[0] = 0;
  await decide('survival_priority', { client, bot, goal: {}, tree, state: { health: 8.32 } });
  assert.equal(seen.alight, undefined, 'not alight: nothing said');
});
