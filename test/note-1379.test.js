'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');

test('the night mine offers stopping to wait for dawn, said with the hunger it keeps; chosen, the mine ends and a pocket is sealed (note 1379)', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const registry = require('minecraft-data')('26.1');
  const ores = { '3,39,0': 'copper_ore' };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 40, 0.5) },
    health: 8, food: 5, time: { timeOfDay: 20600 },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 0 }, { name: 'raw_copper', count: 27 }], emptySlotCount: () => 10, slots: [] },
    findBlocks: ({ matching }) => Object.keys(ores).filter(k => [].concat(matching).includes(registry.blocksByName[ores[k]].id)).map(k => new Vec3(...k.split(',').map(Number))),
    blockAt: p => ({ name: ores[`${p.x},${p.y},${p.z}`] || 'stone', boundingBox: 'block', position: p }) });
  const survival = new Survival(bot, {}, {});
  survival.client = { systemOne: async () => ({}) };
  let tree;
  survival.decide = async (task, goal, save, q) => { tree = q.tree; return { path: ['seal_and_wait'], stale: false }; };
  const r = await survival.nightTarget(new Task('night'), {}, () => {}, new Vec3(0, 40, 0));
  assert.match(tree.seal_and_wait.description, /^Stop the mine and seal a pocket here to wait for dawn, about 2 real minutes off: standing still spends no hunger \(hunger 5 stays 5; each block dug spends it\), and the pickaxe's uses are kept\. Health 8 does not come back meanwhile/);
  assert.deepEqual(r, { seal: true });
});
