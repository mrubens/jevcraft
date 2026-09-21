'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { defenseWeapon, strikeTarget, defendNearby } = require('../src/combat');

function fixture() {
  const spider = { id: 7, name: 'cave_spider', position: new Vec3(2, 64, 0.5), width: 0.7, height: 0.5, isValid: true };
  const items = [{ name: 'diamond_pickaxe', type: 1 }, { name: 'cobblestone', type: 2 }], attacks = [];
  const bot = { health: 20, oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 7: spider },
    world: { raycast: () => null }, inventory: { items: () => items }, pathfinder: { setGoal: () => {} },
    clearControlStates: () => {}, lookAt: async () => {},
    equip: async item => { bot.heldItem = item; }, unequip: async () => { bot.heldItem = null; },
    attack: target => attacks.push(target),
  };
  return { bot, spider, items, attacks };
}

test('immediate defense uses a carried tool against a visible hostile in reach without chasing', async () => {
  const { bot, spider, attacks } = fixture(), goal = {};
  assert.equal(defenseWeapon(bot).name, 'diamond_pickaxe');
  assert(await defendNearby(bot, new Task('defend'), goal, () => {}));
  assert.deepEqual(attacks, [spider]); assert.equal(bot.heldItem.name, 'diamond_pickaxe');
  assert.equal(goal.survivalAction.action, 'defend'); assert.equal(goal.survivalAction.target, 'cave_spider');
  assert.equal(bot.entity.position.x, 0.5);
});

test('defense never attacks players, passive animals, covered mobs or targets beyond reach', async () => {
  for (const situation of ['player', 'cow', 'covered', 'distant']) {
    const { bot, spider, attacks } = fixture();
    if (situation === 'covered') { bot.world.raycast = () => ({ intersect: new Vec3(1, 65, 0.5) }); spider.position.x = 2.8; }
    else if (situation === 'distant') spider.position.x = 8;
    else spider.name = situation;
    assert.equal(strikeTarget(bot), undefined);
    assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
    assert.equal(attacks.length, 0);
  }
});

test('cooldowns prevent attack spam and leave creeper retreat available', async () => {
  const { bot, spider, attacks } = fixture();
  bot._defenseAttackAt = Date.now();
  assert(await defendNearby(bot, new Task('defend'), {}, () => {}));
  assert.equal(attacks.length, 0);
  spider.name = 'creeper';
  assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
});

test('defense rechecks the target after equipping and honors cancellation', async () => {
  const { bot, spider, attacks } = fixture();
  bot.equip = async () => { delete bot.entities[spider.id]; };
  assert.equal(await defendNearby(bot, new Task('defend'), {}, () => {}), false);
  assert.equal(attacks.length, 0);
  const task = new Task('cancelled'); task.cancel();
  await assert.rejects(defendNearby(bot, task, {}, () => {}), { name: 'Cancelled' });
});

test('a mob at arm\'s length on a staircase is struck even when the stair edge hides its head', async () => {
  const { bot, spider, attacks } = fixture();
  spider.position = new Vec3(1.5, 65, 0.5);
  bot.world.raycast = () => ({ intersect: new Vec3(1, 66, 0.5) });
  assert.equal(strikeTarget(bot)?.entity, spider);
  assert(await defendNearby(bot, new Task('defend'), {}, () => {}));
  assert.deepEqual(attacks, [spider]);
});
