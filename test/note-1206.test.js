'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { sprintByHeading } = require('../src/survival');

// Flat stone at y 63; `hole(x, z)` is where there is no ground.
function runner(hole = () => false) {
  const keys = {};
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, clearControlStates: () => { for (const k of Object.keys(keys)) delete keys[k]; },
    setControlState: (k, v) => { keys[k] = v; },
    blockAt: p => { const c = p.floored(); const ground = c.y < 64 && !hole(c.x, c.z); return { position: c, name: ground ? 'stone' : 'air', boundingBox: ground ? 'block' : 'empty' }; },
    // A quarter second of sprinting: a block and a half the way it faces.
    lookAt: async at => { const d = at.minus(bot.entity.position); const len = Math.hypot(d.x, d.z) || 1; bot.entity.position = bot.entity.position.offset(d.x / len * 1.5, 0, d.z / len * 1.5); } };
  return { bot, keys };
}

test('the run with no way planned goes by heading, away from them at a sprint, until the gap is there (note 1206)', async () => {
  const { bot } = runner();
  const zombies = [{ position: new Vec3(3.5, 64, 0.5) }, { position: new Vec3(2.5, 64, 2.5) }];
  const ran = await sprintByHeading(bot, new Task('t'), zombies, 12, 3000);
  assert.ok(ran >= 8, `${ran} blocks`);
  assert.ok(zombies.every(z => Math.hypot(bot.entity.position.x - z.position.x, bot.entity.position.z - z.position.z) >= 12));
  assert.ok(bot.entity.position.x < -6, 'away from them, to the west');
});

test('where straight on has no ground it turns to a side that has, and with none on any side it does not go', async () => {
  // A pit straight west, three wide; the ground north-west and south-west holds.
  const pit = runner((x, z) => x <= -1 && Math.abs(z) <= 0);
  const mob = [{ position: new Vec3(4.5, 64, 0.5) }];
  const ran = await sprintByHeading(pit.bot, new Task('t'), mob, 10, 2000);
  assert.ok(ran >= 4, `${ran} blocks by the side`);
  assert.notEqual(Math.round(pit.bot.entity.position.z), 0, 'not into the pit');
  // On a one-block column, nowhere to go.
  const column = runner((x, z) => x !== 0 || z !== 0);
  assert.equal(await sprintByHeading(column.bot, new Task('t'), mob, 10, 1000), 0);
});
