'use strict';
// Note 969: 25597 (mid-242-pf-nether-1, 2026-10-03 02:58 to 03:20Z) held
// step:rods_waiting with "detours: none" for 22 minutes on one block.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');

test('a hold with nothing on offer offers the rungs set aside back, with the standing still said', async t => {
  t.mock.method(require('../src/game-progress'), 'takeBackRungs', () => [{ phase: 'bank_rods', why: 'Jev set it aside at the rung\'s question', at: Date.now() - 120000, until: Date.now() + 1200000 }]);
  const { breakStillness } = require('../src/work');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true }, time: { timeOfDay: 0 }, entities: {},
    inventory: { items: () => [{ name: 'blaze_rod', count: 2, type: registry.itemsByName.blaze_rod.id }, { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }, { name: 'stick', count: 4, type: registry.itemsByName.stick.id }, { name: 'netherrack', count: 64, type: registry.itemsByName.netherrack.id }], slots: [] },
    findBlocks: () => [], clearControlStates() {}, setControlState() {},
    blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {} };
  setAside(goal, 'rung', 'bank_rods', 'Jev set it aside at the rung\'s question', 1800000);
  const task = new Task('still'), lines = [];
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; task.cancel(); throw new Error('cancelled'); } };
  const log = console.log; console.log = (...a) => lines.push(a.join(' '));
  try { await breakStillness(bot, task, goal, () => {}, { client, reason: 'step:rods_waiting', holding: { minutes: 20, why: 'the rods set aside' } }); } catch (_) { /* cancelled */ } finally { console.log = log; }
  const offered = asked || Object.fromEntries((lines.find(l => l.startsWith('[still]'))?.match(/detours: (.*)$/)?.[1] || '').split(', ').map(k => [k, '']));
  assert.ok('take_up_bank_rods' in offered, `offered: ${Object.keys(offered)}`);
  if (asked) assert.match(asked.take_up_bank_rods, /Nothing else is on offer from here: otherwise the bot stands where it is until the rest ends, 20 more minutes\./);
});
