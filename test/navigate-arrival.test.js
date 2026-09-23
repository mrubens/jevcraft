'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { Task, navigate } = require('../src/skills');

// On farmland (a block less a sixteenth) the feet floor into the farmland;
// arrival is judged from the cell the bot stands in, one above.
test('standing on farmland counts as standing on top of it when a walk is judged arrived', async () => {
  const bot = Object.assign(new EventEmitter(), { game: { gameMode: 'survival', dimension: 'overworld' }, entity: { position: new Vec3(0.5, 62.9375, 0.5), onGround: true },
    oxygenLevel: 20, entities: {}, inventory: { items: () => [] },
    blockAt: p => { const f = p.floored(); return { position: f, name: f.y === 62 ? 'farmland' : f.y < 62 ? 'dirt' : 'air', boundingBox: f.y <= 62 ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, goto: async () => {}, setGoal() {} }, clearControlStates() {} });
  await navigate(bot, new Task('plant'), new goals.GoalNear(0, 63, 2, 2), { timeoutMs: 3000 });
});
