// Note 846: a walk that stops beside a deadly fall holds the crouch a moment
// as the keys are let go (25597, 2026-10-01 18:08:14.5Z, off a ledge fifty
// over lava as its walk ended on a partial route).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task, navigate } = require('../src/skills');
const { goals } = require('mineflayer-pathfinder');

function bot(edge) {
  const states = {};
  const b = { entity: { position: new Vec3(0.5, 76, 0.5), onGround: true }, health: 20, game: { dimension: 'overworld' },
    blockAt: p => { const f = p.floored(); const lava = f.y < 30; const solid = !lava && f.y < 76 && (!edge || f.x <= 0); return { position: f, name: lava ? 'lava' : solid ? 'netherrack' : 'air', boundingBox: solid ? 'block' : 'empty' }; },
    setControlState: (k, v) => { states[k] = v; }, clearControlStates: () => { for (const k of Object.keys(states)) states[k] = false; }, controlState: states,
    pathfinder: { goto: async () => {}, setGoal: () => {} } };
  return { b, states };
}

test('25597: a walk ended at a ledge over lava leaves the bot crouched; on flat ground it does not', async () => {
  const at = bot(true);
  await navigate(at.b, new Task('t', 't'), new goals.GoalBlock(10, 76, 0)).catch(() => {});
  assert.equal(at.states.sneak, true, 'crouched at the edge as the walk stops');
  const flat = bot(false);
  await navigate(flat.b, new Task('t', 't'), new goals.GoalBlock(10, 76, 0)).catch(() => {});
  assert.notEqual(flat.states.sneak, true);
});
