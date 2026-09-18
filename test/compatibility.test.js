'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixMiningMaterials } = require('../src/compatibility');

test('26.1 mining uses pickaxe speed while preserving harvest requirements', () => {
  const registry = require('prismarine-registry')('26.1');
  const Block = require('prismarine-block')(registry);
  const originalHarvest = { ...registry.blocksByName.obsidian.harvestTools };
  fixMiningMaterials(registry);
  const obsidian = Block.fromStateId(registry.blocksByName.obsidian.defaultState);
  const diamond = registry.itemsByName.diamond_pickaxe.id;
  const iron = registry.itemsByName.iron_pickaxe.id;
  assert.equal(obsidian.digTime(diamond, false, false, false), 9400);
  assert.equal(obsidian.canHarvest(diamond), true);
  assert.ok(!obsidian.canHarvest(iron));
  assert.deepEqual(obsidian.harvestTools, originalHarvest);
  assert.equal(registry.blocksByName.oak_log.material, 'mineable/axe');
});

test('difficulty accepts both numeric and 26.1 named protocol values', () => {
  const { EventEmitter } = require('node:events');
  const { compatibilityPlugin } = require('../src/compatibility');
  const bot = { _client: new EventEmitter(), game: {} };
  compatibilityPlugin(bot);
  bot._client.emit('difficulty', { difficulty: 'normal' });
  assert.equal(bot.game.difficulty, 'normal');
  bot._client.emit('difficulty', { difficulty: 0 });
  assert.equal(bot.game.difficulty, 'peaceful');
});

test('path smoothing and execution cannot corrupt an ongoing AStar search', () => {
  const AStar = require('mineflayer-pathfinder/lib/astar');
  const Move = require('mineflayer-pathfinder/lib/move');
  const { Vec3 } = require('vec3');
  require('../src/compatibility').fixPathfinderResults();
  const search = Object.create(AStar.prototype);
  Object.assign(search, { startTime: 0, closedDataSet: new Set(), openHeap: { size: () => 0 } });
  const move = new Move(1, 70, 2, 4, 1, [new Vec3(1, 70, 2)], [{ x: 1, y: 69, z: 2, returnPos: new Vec3(0, 70, 2) }]);
  const node = { data: move, g: 1, parent: { parent: null } };
  const first = search.makeResult('partial', node);
  first.path[0].y -= 10;
  first.path[0].toBreak.shift();
  first.path[0].toPlace[0].returnPos.x = 99;
  const second = search.makeResult('partial', node);
  assert.equal(second.path[0].y, 70);
  assert.equal(second.path[0].toBreak.length, 1);
  assert.equal(second.path[0].toPlace[0].returnPos.x, 0);
  assert.equal(move.y, 70);
});
