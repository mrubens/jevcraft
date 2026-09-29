'use strict';
// Fight-time discipline (note 696): the arena's runs from another kit are
// not a price, a stand at a wall counts the blazes that come into its line,
// the plan's questions wait while a fight is on, and a creeper through the
// rock does not claim the turn with a stance promised and never asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const arbiter = require('../src/arbiter');
const danger = require('../src/danger');
const { decide } = require('../src/decisions');

// A bot in the Nether whose every line is blocked a block out (rock all
// round), with the mobs given.
function walledBot({ mobs = [], health = 20, hurtBy = null } = {}) {
  const entities = {};
  mobs.forEach(([name, x], i) => { entities[i + 1] = { id: i + 1, name, type: 'hostile', position: new Vec3(x + 0.5, 70, 0.5), height: 1.8, width: 0.6, isValid: true }; });
  const said = [];
  return Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, said,
    entity: { position: new Vec3(0.5, 70, 0.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities,
    world: { raycast: (from, dir) => ({ position: from.plus(dir).floored(), intersect: from.plus(dir.scaled(0.9)) }) },
    inventory: { items: () => [], slots: [] }, chat(m) { said.push(m); }, blockAt: () => null,
    ...(hurtBy ? { _hurtBy: hurtBy } : {}),
  });
}

test('a blaze within six blocks round the rock, or one of a kind that hit the bot in the last ten seconds, is a fight on', () => {
  assert.match(danger.fightOn(walledBot({ mobs: [['blaze', 3]] })), /^a blaze 3 blocks off \(out of sight\)$/);
  assert.equal(danger.fightOn(walledBot({ mobs: [['blaze', 10]] })), null, 'ten blocks off through the rock: none');
  const now = Date.now();
  assert.match(danger.fightOn(walledBot({ mobs: [['blaze', 10]], hurtBy: { blaze: now - 7000 } }), now), /^a blaze hit the bot 7 seconds ago and one is 10 blocks off \(out of sight\)$/);
  assert.equal(danger.fightOn(walledBot({ mobs: [['blaze', 10]], hurtBy: { blaze: now - 12000 } }), now), null, 'twelve seconds ago: over');
  assert.equal(danger.fightOn(walledBot({ mobs: [], hurtBy: { blaze: now - 2000 } }), now), null, 'none of its kind about');
  // A stance Jev chose that still holds.
  const bot = walledBot();
  bot._stance = { choice: 'back_to_wall', at: now - 3000, health: 20, running: true };
  assert.match(danger.fightOn(bot, now), /^the back to wall stance chosen 3 seconds ago holds$/);
  bot._stance.choice = 'keep_working';
  assert.equal(danger.fightOn(bot, now), null, 'leaving the mobs be is no fight');
});

test('the wait ends when the fight does, and says it if not; the task\'s check stops it', async () => {
  const bot = walledBot({ mobs: [['blaze', 3]] });
  const still = await danger.waitOutFight(bot, { check() {} }, { ms: 60, every: 10 });
  assert.match(still.first, /blaze 3 blocks off/);
  assert.match(still.still, /blaze 3 blocks off/);
  const going = danger.waitOutFight(bot, { check() {} }, { ms: 2000, every: 10 });
  setTimeout(() => { delete bot.entities[1]; }, 30);
  const over = await going;
  assert.equal(over.still, null);
  assert(over.waitedMs < 1000);
  await assert.rejects(danger.waitOutFight(walledBot({ mobs: [['blaze', 3]] }), { check() { throw new Error('Threat nearby: blaze at 3 blocks'); } }, { ms: 2000, every: 10 }), /Threat nearby/);
});

test('upkeep waits while a fight is on, and is asked with it said when it does not end (25592, 22:22:09Z)', async () => {
  process.env.JEV_FIGHT_WAIT_MS = '80';
  try {
    const bot = walledBot({ mobs: [['blaze', 5]], health: 3 });
    const states = [];
    const client = { systemOne: async ({ state, questions }) => { states.push(state); return { answers: { branch_0: { choice: 'carry_on', confidence: 0.9, probabilities: { carry_on: 0.9 } } } }; } };
    const tree = { carry_on: { description: 'Carry on.' }, spare_pickaxe: { description: 'Make a spare pickaxe.' } };
    const t0 = Date.now();
    const d = await decide('upkeep', { client, bot, task: { check() {} }, goal: {}, save: () => {}, tree, state: { health: 3 } });
    assert(Date.now() - t0 >= 70, 'it waited');
    assert.deepEqual(d.path, ['carry_on']);
    assert.match(states[0].fightOn, /^a blaze 5 blocks off \(out of sight\): this question waited 0 seconds for the fight to end and is asked with it still on$/);
    // Stale after the wait, it is not asked.
    const again = await decide('upkeep', { client, bot, task: { check() {} }, goal: {}, save: () => {}, tree, state: {}, isFresh: () => false });
    assert.equal(again.stale, true);
    assert.equal(states.length, 1);
    // A question that is not about the plan is not held.
    bot.entities = {};
  } finally { delete process.env.JEV_FIGHT_WAIT_MS; }
});

test('a creeper out of sight past four, or with no way to the bot, is no alert, however it was seen before (25593, 22:20:20 to 22:22Z)', () => {
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {} };
  const mob = (distance, visible, id = 1) => ({ entity: { name: 'creeper', id }, distance, visible });
  const look = (mobs, noWay = []) => ({ inLava: () => false, burning: () => false, headInBlock: () => false, mobs: () => mobs, noWay: () => new Set(noWay) });
  const keys = (held, l) => arbiter.observeReflexes(bot, held, l).map(r => r.key);
  // Seen and within its line: an alert; the same one gone behind the rock at
  // six, held before: none now.
  assert.deepEqual(keys([], look([mob(6, true)])), ['creeper']);
  assert.deepEqual(keys(['creeper'], look([mob(6.5, false)])), []);
  assert.deepEqual(keys(['creeper'], look([mob(3.5, false)])), ['creeper'], 'within four unseen it comes round the corner');
  // In sight across a gap it has no way over: none.
  assert.deepEqual(keys([], look([mob(5, true)], [1])), []);
  assert.deepEqual(keys([], look([mob(3.5, false)], [1])), [], 'nor within four through the rock with no way');
});

test('the creeper\'s claim says the stance that holds goes on, and the stance asked next only when none holds', () => {
  const says = f => arbiter.claimSays({ layer: 'survival', action: 'creeper_back_off', facts: { creeper: 6, seen: true, lightsAt: 3, blocksASecond: 3, fuse: 1.5, ...f } });
  assert.match(says({}), /the stance is asked next\. The work waits\.$/);
  assert.match(says({ stance: { choice: 'block_creeper', secondsAgo: 2 } }), /; the block creeper chosen 2 seconds ago goes on\. The work waits\.$/);
});

test('a walker with no way to the bot is said as about, not as coming', () => {
  const t = { entity: { name: 'creeper' }, distance: 6, visible: false };
  assert.match(arbiter.mobWouldSays(t), /^once it sees the bot it comes at it/);
  assert.equal(arbiter.mobWouldSays(t, { noWay: true }), 'it has no way to the bot from where it is (none found through the ground between), and goes off only within about three blocks');
});

test('a stand with its back to a wall counts the blaze out of its line now that comes into it, as a hole\'s mouth does (25592, 22:21:56Z)', () => {
  const stand = require('../src/blaze-stand');
  // A blaze six below and four off: its line to the bot is cut by a ledge
  // (every ray that climbs or falls more than a third of a block a block is
  // blocked here); at the bot's own height the line is open. A blaze after
  // a target keeps its eyes about the target's (settlesInto).
  const bot = walledBot();
  bot.world = { raycast: (from, dir, length) => (Math.abs(dir.y) > 0.3 ? { position: from.plus(dir).floored(), intersect: from.plus(dir.scaled(0.5)) } : null) };
  bot.inventory = { items: () => [{ name: 'stone_sword', count: 1 }], slots: {} };
  const blaze = { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: 1.8, width: 0.6, isValid: true };
  bot.entities = { 9: blaze };
  const cell = new Vec3(0, 70, 0);
  const danger = [{ entity: blaze, distance: blaze.position.distanceTo(bot.entity.position), visible: false }];
  const wall = stand.standCost(bot, danger, { at: cell });
  assert.equal(wall.seeing, 0, 'it does not see the cell now');
  assert.equal(wall.settling, 1, 'it comes into its line');
  assert(wall.damage > 0, `priced at ${wall.damage}, not nothing`);
});
