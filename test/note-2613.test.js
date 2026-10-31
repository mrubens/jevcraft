'use strict';
// Note 2613: a heading the motion helper refuses (lava ahead that the run's own two-cell look did not see) is not
// taken again that run, and with every heading refused the run ends at once, why left on the bot. full-227 (25589,
// 2026-10-30 23:58Z), at the lava sea's edge, had 'run by heading: lava at (-49, 31, -56) ahead; not walked into' 229
// times in 25 seconds over four runs chosen in turn, and was in the lava.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { sprintByHeading } = require('../src/survival');

// Flat stone at y 63; the motion helper is stood in for: it refuses every move as lava ahead (its look at the body's
// columns sees what the run's own two-cell look along the heading does not), as it did for full-227 229 times.
function runner() {
  const keys = {};
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, velocity: new Vec3(0, 0, 0), onGround: true, width: 0.6, height: 1.8 }, clearControlStates: () => { for (const k of Object.keys(keys)) delete keys[k]; },
    setControlState: (k, v) => { keys[k] = v; }, game: { dimension: 'the_nether' },
    blockAt: p => { const c = p.floored(); const ground = c.y < 64; return { position: c, name: ground ? 'stone' : 'air', boundingBox: ground ? 'block' : 'empty' }; },
    lookAt: async at => { const d = at.minus(bot.entity.position); bot.entity.yaw = Math.atan2(-d.x, -d.z); } };
  return { bot, keys };
}

test('every heading refused by the motion helper: the run ends at once and says why, instead of spinning for its seconds', async () => {
  const motion = require('../src/motion');
  const real = motion.move;
  let calls = 0;
  motion.move = async (bot, task, { label }) => { calls++; bot._moveRefused = { label, name: 'lava', x: -1, y: 63, z: 0, at: Date.now() }; return false; };
  try {
    const { bot } = runner();
    const mobs = [{ position: new Vec3(4.5, 64, 0.5) }];
    const t0 = Date.now();
    const ran = await sprintByHeading(bot, new Task('t'), mobs, 12, 3000);
    const took = Date.now() - t0;
    assert.ok(took < 600, `the run took ${took} ms: it should end once every heading is refused`);
    assert.equal(ran, 0);
    assert.equal(calls, 5, 'each of the five headings tried once');
    assert.equal(bot._runBlocked?.says, 'the run by heading was stopped: lava at (-1, 63, 0) ahead, 5 headings refused');
  } finally { motion.move = real; }
});
