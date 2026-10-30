'use strict';
// Note 2198: a body alight was refused nothing by the held-key move: lava
// and a fall that kills ahead were set aside with the flames. full-5
// (25595, 2026-10-26 11:02Z), 16.7 health, alight from a blaze's fireball,
// ran out of the fire at a sprint up three steps and on off the ledge at
// (-163, 71, 140) into the lava sea 35 below; out of the lava at 4 health,
// still alight, it burned to death. The run's own guard (vitals.js outOfFire)
// stopped it a cell late, already in the air.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const motion = require('../src/motion');

// A netherrack rim at y 64 for x <= 0, fire in the bot's own cell, and east of
// it nothing down to the lava sea at y 30.
function rimBot() {
  const blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const mk = (name, box) => ({ name, boundingBox: box, position: new Vec3(x, y, z), diggable: true });
    if (y <= 30) return mk('lava', 'empty');
    if (x <= 0 && y === 64) return mk('netherrack', 'block');
    if (x === 0 && z === 0 && y === 65) return mk('fire', 'empty');
    return mk('air', 'empty');
  };
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    version: '26.1', health: 16.7, food: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: -Math.PI / 2, pitch: 0 }, entities: {},
    inventory: { items: () => [], slots: {} },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt, look: async (y, p) => { bot.entity.yaw = y; bot.entity.pitch = p; },
  });
  bot._inFireAt = Date.now();
  return bot;
}

test('a body alight, facing the ledge over the lava sea: the sprint out of the fire is refused the fall, as any move is (25595, 11:02Z)', async () => {
  const bot = rimBot();
  assert.ok(motion.bodyBurning(bot), 'the bot stands in a flame');
  // East of the rim the body's columns have no floor: the fall under them ends in lava.
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true, flames: false })?.name, 'lava');
  const seen = []; const log = console.log; console.log = m => seen.push(m);
  let ok;
  try { ok = await motion.move(bot, new Task('t'), { label: 'out_of_fire', keys: ['forward', 'sprint'], sneak: false, why: 'running out of fire', maxMs: 300, tick: 25, throughFlames: true }); } finally { console.log = log; }
  assert.equal(ok, false);
  assert.ok(seen.some(m => /out_of_fire: lava at \(1, 30, 0\) ahead; not walked into/.test(m)), seen.join('\n'));
  assert.ok(!bot.controlState.forward && !bot.controlState.sprint, 'the keys given back');
});

test('the same body with the rim going on east: the flames on the way are no refusal to it', async () => {
  const bot = rimBot();
  const blockAt = bot.blockAt;
  bot.blockAt = p => { const b = blockAt(p); if (Math.floor(p.y) === 64 && Math.floor(p.x) > 0) return { ...b, name: 'netherrack', boundingBox: 'block' }; if (Math.floor(p.y) === 65 && Math.floor(p.x) === 1 && Math.floor(p.z) === 0) return { ...b, name: 'fire', boundingBox: 'empty' }; return b; };
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true, flames: true })?.name, 'fire', 'a flame in the cell ahead');
  const ok = await motion.move(bot, new Task('t'), { label: 'out_of_fire', keys: ['forward', 'sprint'], sneak: false, why: 'running out of fire', maxMs: 120, tick: 25, throughFlames: true });
  assert.equal(ok, false, 'the move ran to its time, the flame no refusal');
  assert.equal(bot._moveRefused, undefined);
});

// Note 2600: a body in lava with a fire in another of its cells read as not in lava, and its way out (lava cells) was
// refused: full-207 (25588, 2026-10-30 18:38Z) 'out_of_lava: lava at (47, 84, 91) ahead; not walked into', burned to death.
test('a body standing in lava with a flame in one of its cells is left its way out through the lava (note 2600)', async () => {
  const bot = rimBot();
  // The lava pool at y 65 round the bot, the bot's feet in it at (0, 65, 0) beside a fire in the column it straddles.
  bot.entity.position = new Vec3(0.95, 65.1, 0.5);
  bot.blockAt = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const mk = (name, box) => ({ name, boundingBox: box, position: new Vec3(x, y, z), diggable: true });
    if (y <= 64) return mk('netherrack', 'block');
    if (y === 65 && x === 0 && z === 0) return mk('fire', 'empty');
    if (y === 65) return mk('lava', 'empty');
    return mk('air', 'empty');
  };
  assert.equal(motion.bodyBurning(bot)?.name, 'fire', 'the first burning cell met is the fire');
  const ok = await motion.move(bot, new (require('../src/skills').Task)('t'), { label: 'out_of_lava', keys: ['forward'], sneak: false, why: 'out of the lava', maxMs: 120, tick: 25 });
  assert.equal(ok, false, 'the move ran to its time');
  assert.equal(bot._moveRefused, undefined, 'not refused for the lava ahead');
});
