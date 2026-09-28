'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');

// mid-242-ah-nether-1-fortress-5 (25587), "fell from a high place" at
// 17:48:59Z on 2026-09-28, at 1.1 health for twenty minutes (note 622). The
// ground is the region as saved after the death: x -116 to -104, y 29 to
// 42, z -128 to -120. The one-wide netherrack ledge at y 37 runs along z
// -124 from x -111 to -106; under (-111, 37, -125) open air to the
// netherrack at y 31, six blocks. The restock's walk to a drop went
// crouched from (-110.23, 38, -123.70) toward the block it had dug at
// (-111, 37, -126) and stopped with the body at (-110.69, 38, -124.29),
// its box on the ledge by a hundredth; the next walk let the crouch go.
const LEDGE = require('./fixtures/ledge-fall-mid-242-ah.json');
function worldBot({ at, health = 1.1, cells = {} } = {}) {
  const cache = new Map();
  const nameAt = q => {
    const k = `${q.x},${q.y},${q.z}`;
    if (cells[k]) return cells[k];
    const [ox, oy, oz] = LEDGE.origin;
    const ch = LEDGE.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : LEDGE.palette[ch.charCodeAt(0) - 97];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (!cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) {
        const [base, level] = name.split(':');
        const def = registry.blocksByName[base];
        b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0);
        b.position = q;
      }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 14, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {} }, entities: {},
    inventory: { items: () => [], slots: {} },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt,
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  return bot;
}
function physics(bot) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const world = { getBlock: p => bot.blockAt(p) };
  const ph = Physics(registry, world); fixPlayerDimensions(ph);
  const run = { lowest: bot.entity.position.y };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    ph.simulatePlayer(s, world); s.apply(bot);
    run.lowest = Math.min(run.lowest, bot.entity.position.y);
  }, 50);
  return run;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// The pathfinder's first move off: every key let go, the crouch with them,
// and the body drifting a little on (a hundredth of a block south, the
// drift the frames show: z -124.29 to -124.30).
async function letGo(bot, ms = 600) {
  bot.clearControlStates();
  bot.entity.velocity.z = -0.02;
  await wait(ms);
}

test('the ledge as saved: open under the middle of where the body stopped, a fall of six onto netherrack; the ledge beside it', () => {
  const bot = worldBot({ at: new Vec3(-110.69, 38, -124.29) });
  assert.equal(bot.blockAt(new Vec3(-111, 37, -125)).name, 'air');
  assert.equal(bot.blockAt(new Vec3(-111, 37, -124)).name, 'netherrack');
  assert.equal(bot.blockAt(new Vec3(-111, 31, -125)).name, 'netherrack');
  const fall = require('../src/motion').fallUnder(bot);
  assert.equal(fall.into, 'ground');
  assert.equal(fall.n, 6, 'three damage: more than the 1.1 health');
  bot.health = 20;
  assert.equal(require('../src/motion').fallUnder(bot), null, 'at full health three damage is not half of it');
});

test('a crouched walk that ends hanging by the ledge over a fall that kills at 1.1 health is walked back onto its footing, and the crouch let go then does not drop it (note 622)', { timeout: 15000 }, async () => {
  const { move } = require('../src/motion');
  const bot = worldBot({ at: new Vec3(-110.69, 38, -123.70) });
  const run = physics(bot);
  try {
    await move(bot, new Task('m'), { label: 'walk_to_drop', keys: ['forward'], sneak: true, look: new Vec3(-110.69, 36.2, -125.5), maxMs: 2500, tick: 50 });
    await wait(300);
    const f = bot.entity.position.floored();
    assert.equal(bot.blockAt(f.offset(0, -1, 0)).name, 'netherrack', `its middle over the ledge: ${bot.entity.position}`);
    await letGo(bot);
  } finally { clearInterval(run.timer); }
  assert(run.lowest >= 38 - 1e-6, `never fell: lowest ${run.lowest}`);
});

test('the walk the pathfinder takes from a body hanging so steps it back onto the ledge first, crouched, and gives the crouch back as it was (note 622)', { timeout: 15000 }, async () => {
  const { footingFirst } = require('../src/motion');
  const bot = worldBot({ at: new Vec3(-110.69, 38, -124.29) });
  bot.controlState.sneak = true;
  const run = physics(bot);
  try {
    assert.equal(await footingFirst(bot), true);
    assert.equal(bot.controlState.sneak, true, 'the crouch as it was');
    const f = bot.entity.position.floored();
    assert.equal(bot.blockAt(f.offset(0, -1, 0)).name, 'netherrack', `its middle over the ledge: ${bot.entity.position}`);
    await letGo(bot);
  } finally { clearInterval(run.timer); }
  assert(run.lowest >= 38 - 1e-6, `never fell: lowest ${run.lowest}`);
});

test('at full health the same hang over a fall of six (three damage) is left alone, as the walks price it (note 545)', { timeout: 5000 }, async () => {
  const { footingFirst } = require('../src/motion');
  const bot = worldBot({ at: new Vec3(-110.69, 38, -124.29), health: 20 });
  assert.equal(await footingFirst(bot), false);
});
