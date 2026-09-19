'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { dryStanding, miningReach, dryMiningPositions, approachDryMining } = require('../src/mining-access');

function fixture() {
  const changed = new Map(), target = new Vec3(8, 64, 0);
  changed.set(`${target}`, 'stone');
  const bot = { game: { gameMode: 'survival', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    blockAt: p => {
      const name = changed.get(`${p}`) || (p.y < 64 ? 'stone' : 'air');
      return { name, position: p, boundingBox: name === 'stone' ? 'block' : 'empty' };
    }, canDigBlock: b => b.position.distanceTo(bot.entity.position) < 4.5,
    pathfinder: { movements: { canDig: true, allowedPosition: p => p.x >= 0 } },
  };
  return { bot, changed, target };
}

test('mining access requires dry supported feet, reach and sight rather than a neighboring water cell', () => {
  const { bot, changed, target } = fixture();
  assert(dryMiningPositions(bot, target).length);
  assert(!dryMiningPositions(bot, target).some(p => p.offset(0, -1, 0).equals(target)));
  changed.set('(0, 64, 0)', 'water'); assert(!dryStanding(bot, bot.entity.position));
  bot.blockAt = p => ({ name: p.equals(target) || p.y < 60 ? 'stone' : p.y < 75 ? 'water' : 'air', position: p,
    boundingBox: p.equals(target) || p.y < 60 ? 'block' : 'empty' });
  assert.equal(dryMiningPositions(bot, target).length, 0, 'Deep submerged stone has no dry mining stance');
  bot.world = { raycast: () => ({ position: new Vec3(1, 64, 0), intersect: new Vec3(1, 65, 0.5) }) };
  assert(!miningReach(bot, new Vec3(0.5, 64, 0.5), new Vec3(3, 64, 0)), 'Cannot mine through an intervening wall');
});

test('mining approach rejects a diving path even if the destination is dry and restores its movement policy', async () => {
  const { bot, changed, target } = fixture(), before = { ...bot.pathfinder.movements };
  changed.set('(2, 64, 0)', 'water'); changed.set('(2, 65, 0)', 'water');
  bot.pathfinder.getPathFromTo = function * (movement) {
    assert.equal(movement.canDig, false);
    assert(!movement.allowedPosition(new Vec3(2, 64, 0)));
    assert(!movement.allowedPosition(new Vec3(-1, 64, 0)));
    yield { result: { status: 'success', path: [new Vec3(2, 64, 0)] } };
  };
  await assert.rejects(approachDryMining(bot, new Task('mine'), target, { navigate: async () => assert.fail('Must not dive') }), /No reachable dry/);
  assert.deepEqual(bot.pathfinder.movements, before);
});

test('mining can approach through shallow water with breathable headroom and finish on dry ground', async () => {
  const { bot, changed, target } = fixture(), before = { ...bot.pathfinder.movements };
  changed.set('(2, 64, 0)', 'water');
  bot.pathfinder.getPathFromTo = function * (movement) {
    assert(movement.allowedPosition(new Vec3(2, 64, 0)));
    yield { result: { status: 'success', path: [new Vec3(2, 64, 0)] } };
  };
  await approachDryMining(bot, new Task('mine'), target, { navigate: async (_bot, _task, destination) => {
    bot.entity.position = new Vec3(destination.x + 0.5, destination.y, destination.z + 0.5);
  } });
  assert(dryStanding(bot, bot.entity.position)); assert(miningReach(bot, bot.entity.position, target));
  assert.deepEqual(bot.pathfinder.movements, before);
});

test('cancelled mining approach restores the inherited restrictions before execution', async () => {
  const { bot, target } = fixture(), before = { ...bot.pathfinder.movements }, task = new Task('mine');
  task.cancel();
  await assert.rejects(approachDryMining(bot, task, target, { navigate: async () => assert.fail('Cancelled') }), { name: 'Cancelled' });
  assert.deepEqual(bot.pathfinder.movements, before);
});
