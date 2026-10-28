'use strict';
// An animal for food in view is offered as work meanwhile (note 2316).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('a pig in view while the Nether food is gathered is offered to hunt, said with the points', async () => {
  const { detourWork } = require('../src/work');
  const pig = { id: 9, name: 'pig', type: 'animal', position: new Vec3(110, 64, 300), isValid: true, metadata: [] };
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(100.5, 64, 300.5), onGround: true }, time: { timeOfDay: 15000 }, entities: { 9: pig },
    inventory: { items: () => [{ name: 'iron_sword', count: 1, type: registry.itemsByName.iron_sword.id }], slots: [] }, findBlocks: () => [],
    blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', skyLight: 15 }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {}, step: { action: 'hunt_food_for_nether', foodPoints: 20, required: 80 } };
  const ways = await detourWork(bot, { check() {}, cancelled: false }, goal, () => {}, { preview: true });
  const hunt = ways.find(w => w.key === 'hunt_in_view');
  assert.ok(hunt, ways.map(w => w.key).join(', '));
  assert.match(hunt.description, /^(?:This way: .*? health(?: \(more than the bot has\))?\. )?Hunt the pig 10 blocks off: its meat, killed with what is held\. The step is the Nether's food, \d+ of 80 points carried\.$/);
});
