'use strict';
// Note 938: an unstuck move the body's own rule refused (lava ahead) is not
// offered again from about that spot in the spell.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { workFree } = require('../src/unstuck');
const { Task } = require('../src/skills');

test('a step refused for lava ahead from here is not offered again from the cell beside; with nothing left it escalates', async () => {
  // Stone all round, two open cells east and west of the feet, the rest solid.
  const open = new Set(['0,60,0', '0,61,0', '1,60,0', '1,61,0', '-1,60,0', '-1,61,0']);
  const bot = { game: { gameMode: 'survival', difficulty: 'normal', dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 60, 0.5), onGround: true }, entities: {},
    health: 20, food: 20, world: { raycast: () => null },
    blockAt: p => ({ name: open.has(`${p.x},${p.y},${p.z}`) ? 'air' : 'obsidian', boundingBox: open.has(`${p.x},${p.y},${p.z}`) ? 'empty' : 'block', position: p }),
    inventory: { items: () => [] }, chat() {} };
  const goal = { unstuck: { aim: 'off this spot', since: new Date().toISOString(), moves: [
    { move: 'step_east', from: '(1, 60, 0)', refused: { x: 1, y: 60, z: 0 }, reached: false, at: Date.now() - 2000, result: 'failed: refused: lava at (2, 59, 0) ahead, not walked into' },
    { move: 'step_west', from: '(0, 60, 0)', refused: { x: 0, y: 60, z: 0 }, reached: false, at: Date.now() - 1000, result: 'failed: refused: lava at (-2, 59, 0) ahead, not walked into' }], visits: {} } };
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(Object.keys(questions.branch_0.criteria)); return { answers: { branch_0: { choice: 'none_good', confidence: 0.9 } } }; } };
  const decisions = require('../src/decisions'), escalated = [];
  const orig = decisions.escalate; decisions.escalate = (b, g, q, says) => escalated.push(says);
  try { await workFree(bot, new Task('free'), goal, () => {}, { client, dig: async () => {}, aim: { goal: 'away', aim: 'off this spot', from: { x: 0, y: 60, z: 0 } }, maxMoves: 1 }); }
  catch (_) { /* a stall the escalation raises */ }
  finally { decisions.escalate = orig; }
  assert.ok(!asked.some(keys => keys.includes('step_east') || keys.includes('step_west')), JSON.stringify(asked));
  assert.deepEqual(asked, [], 'nothing left to ask: the moves refused here are all there were');
  assert.equal(escalated.length, 1);
  assert.match(escalated[0], /every move left here was refused by the body's own rule \(step east: refused: lava at \(2, 59, 0\) ahead, not walked into; step west: refused: lava at \(-2, 59, 0\) ahead/);
});
