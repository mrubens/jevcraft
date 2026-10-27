'use strict';
// The stall's nearby ore says what it drops and what the work stalled wants of it (note 2311).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('gold ore beside a golden-boots stall is said as the boots\' gold', async () => {
  const { detourWork } = require('../src/work');
  const ORE = new Vec3(120, -54, 300);
  const gold = registry.blocksByName.deepslate_gold_ore;
  const pick = { name: 'diamond_pickaxe', count: 1, type: registry.itemsByName.diamond_pickaxe.id };
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(116.5, -50, 301.5), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => [pick], slots: [] }, findBlocks: ({ matching }) => ([].concat(matching).includes(gold.id) ? [ORE] : []),
    blockAt: p => p.equals(ORE) ? { position: p, name: 'deepslate_gold_ore', boundingBox: 'block', harvestTools: { [pick.type]: true } }
      : { position: p, name: p.y < -50 ? 'deepslate' : 'air', boundingBox: p.y < -50 ? 'block' : 'empty', skyLight: 0 },
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { version: 1, kind: 'beat', request: 'beat the game', survival: {}, rungTime: { phase: 'golden_boots' } };
  const ways = await detourWork(bot, { check() {}, cancelled: false }, goal, () => {}, { preview: true });
  const mine = ways.find(w => w.key === 'mine_nearby');
  assert.ok(mine, ways.map(w => w.key).join(', '));
  assert.match(mine.description, /It drops raw gold \(0 carried\)\. The work stalled is the golden boots, which is made of gold: four gold ingots for boots, a raw gold smelted to each\./);
});
