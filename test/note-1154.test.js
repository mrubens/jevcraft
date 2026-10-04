'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { fightEndStep } = require('../src/end-combat');
const bridging = require('../src/bridging');

// The entry platform (obsidian five square at y 48, x 98 to 102, z -2 to 2) with the island's end stone from x 70 down.
function platform() {
  const solidAt = f => (f.y === 48 && f.x >= 98 && f.x <= 102 && f.z >= -2 && f.z <= 2) ? 'obsidian' : (f.y <= 48 && f.y >= 30 && f.x <= 70 && Math.abs(f.z) <= 40) ? 'end_stone' : null;
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry,
    health: 20, food: 20, oxygenLevel: 20, isAlive: true, game: { gameMode: 'survival', dimension: 'the_end' },
    entity: { position: new Vec3(100.5, 49, .5), onGround: true }, entities: {},
    inventory: { items: () => [{ name: 'bow', count: 1 }, { name: 'arrow', count: 48 }, { name: 'cobblestone', count: 128 }], slots: [] },
    blockAt: p => { const n = solidAt(p.floored()); return { name: n || 'air', boundingBox: n ? 'block' : 'empty' }; },
    findBlocks: ({ matching }) => matching === registry.blocksByName.end_stone.id ? [new Vec3(70, 48, 0)] : [], world: { raycast: () => null }, clearControlStates() {},
    pathfinder: { movements: { blocksCantBreak: new Set([registry.blocksByName.end_stone.id]), scafoldingBlocks: [], canDig: false }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) },
  });
  return { bot, goal: { kind: 'win', request: 'Jev beat Minecraft', gameProgress: { milestones: {} } }, task: new Task('End') };
}

test('on the entry platform apart from the island, with no walk off it, a span toward the island is laid a stretch at a time before anything is chosen (notes 1154, 1160)', async () => {
  const { bot, goal, task } = platform();
  const dragon = { id: 20, name: 'ender_dragon', position: new Vec3(10, 90, .5), yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')] = 0;
  dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('health')] = 200;
  bot.entities[20] = dragon;
  const bridgeTo = bridging.bridgeTo; let call = null, said = null;
  bridging.bridgeTo = async (b, t, target, opts) => { call = { target, opts }; bot.entity.position = new Vec3(88.5, 49, .5); return 12; };
  try {
    const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'bridge_to_island' } } }; } };
    await fightEndStep(bot, task, goal, () => {}, { navigate: async () => {}, dig: async () => {} }, client);
  } finally { bridging.bridgeTo = bridgeTo; }
  // Not asked (note 1160): off the island with the void beside it and no walk off, the span is the body's safety.
  assert.equal(said, null);
  assert.deepEqual([call.target.x, call.target.y, call.target.z, call.opts.maxBlocks], [70, 49, 0, 12]);
  assert.equal(goal.step.action, 'end_bridge');
  assert.equal(goal.endCombat.bridged, 12);
  assert.equal(goal.endCombat.noProgress, 0);
});
