'use strict';
// Note 885: the pickaxe for the stair, wanting Overworld wood in the Nether,
// rests and the stair goes on by hand; the bank is not what failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function netherBot(items = []) {
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, oxygenLevel: 20, entities: {}, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 70, 0.5), height: 1.8, width: 0.6 }, inventory: { items: () => items, slots: [], emptySlotCount: () => 30 },
    blockAt: p => ({ name: p.y < 70 ? 'netherrack' : 'air', position: p.floored ? p.floored() : p, boundingBox: p.y < 70 ? 'block' : 'empty' }), findBlocks: () => [],
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, chat() {}, on() {}, off() {}, removeListener() {}, emit() {} };
}

test('25594: the stair\'s pickaxe rested (its making wanted oak logs in the Nether): not wanted while it rests, the stair by hand; wanted again after', () => {
  const { stairPickaxeWanted } = require('../src/work');
  const bot = netherBot([{ name: 'netherrack', count: 64 }]);
  const goal = { kind: 'win', survival: {}, gameProgress: { phase: 'bank_rods' }, rodBank: { at: Date.now(), rods: 4 } };
  const target = new Vec3(150, 70, 0);
  assert.ok(stairPickaxeWanted(bot, goal, target), 'a pickaxe is wanted for a stair that long');
  goal.stairPickaxeRest = { at: Date.now(), until: Date.now() + 600000, why: 'No oak log in the nether: it is only found in the overworld' };
  assert.equal(stairPickaxeWanted(bot, goal, target), null, 'by hand while the making rests');
  goal.stairPickaxeRest.until = Date.now() - 1;
  assert.ok(stairPickaxeWanted(bot, goal, target), 'wanted again when the rest is out');
});
