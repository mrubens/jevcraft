'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');

// One check for every dig near the body and one for every upright step
// (note 600): on 2026-09-28 four of the fortress cohort's eight deaths were
// the bot's own dig or step into the lava sea: an unstuck step south that
// slid off a ledge (25583), an unstuck climb onto gravel that had fallen
// (25592), the stall's blind step that ran on off a ledge (25600), and a
// restock that dug out the floor it stood on (25600).
function worldBot({ cells = {}, fixture = null, fill = () => null, at = new Vec3(0.5, 65, 0.5), health = 20 } = {}) {
  const cache = new Map();
  const nameAt = q => {
    const k = `${q.x},${q.y},${q.z}`;
    if (cells[k]) return cells[k];
    if (fixture) {
      const [ox, oy, oz] = fixture.origin;
      if (q.y - oy >= fixture.layers.length && q.x >= ox && q.z >= oz) return 'air';
      const ch = fixture.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
      if (ch !== undefined) return fixture.palette[ch.charCodeAt(0) - 97];
    }
    return fill(q);
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
  const controls = {}, dug = [];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {} }, entities: {},
    inventory: { items: () => [], slots: {} },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt, dug, dig: async block => { dug.push(block.position); },
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
  const run = { lavaTicks: 0, lowest: bot.entity.position.y };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    ph.simulatePlayer(s, world); s.apply(bot);
    run.lowest = Math.min(run.lowest, bot.entity.position.y);
    if (require('../src/terrain').bodyInLava(bot)) run.lavaTicks++;
  }, 50);
  return run;
}
const LEDGE = require('./fixtures/unstuck-lava-mid-242-af.json');

test('no dig takes out the floor the body stands on where the fall under it ends in the lava sea, whoever digs (the dig guard on bot.dig, note 600)', async () => {
  const { digGuardPlugin } = require('../src/skills');
  // On the ledge of 25583 at y 38: the netherrack under the body at
  // (-104, 37, 104), and under it open air six blocks to the sea.
  const bot = worldBot({ fixture: LEDGE, cells: { '-104,39,105': 'air' }, at: new Vec3(-103.5, 38, 104.5) });
  digGuardPlugin(bot);
  await assert.rejects(bot.dig(bot.blockAt(new Vec3(-104, 37, 104))), { name: 'DigRefused', message: /^Not dug: the netherrack at \(-104, 37, 104\): the floor under the body at \(-104, 37, 104\) dug out, it falls 6 blocks into lava/ });
  assert.deepEqual(bot.dug, [], 'the dig was not begun');
  // The netherrack beside, at the feet: nothing flows, nothing falls; dug.
  await bot.dig(bot.blockAt(new Vec3(-104, 38, 105)));
  assert.equal(bot.dug.length, 1);
});

test('no dig beside the body lets lava flow into its space, and a dig away from the body is left alone (note 600)', async () => {
  const { digGuardPlugin } = require('../src/skills');
  const bot = worldBot({ fill: q => q.y < 65 ? 'netherrack' : q.x === 2 && q.y === 65 ? 'lava' : q.x === 1 || q.x === -1 || q.z === 1 || q.z === -1 ? 'netherrack' : 'air' });
  digGuardPlugin(bot);
  await assert.rejects(bot.dig(bot.blockAt(new Vec3(1, 65, 0))), /Not dug: the netherrack at \(1, 65, 0\): lava beside \(1, 65, 0\) flows in, into the body's space/);
  await bot.dig(bot.blockAt(new Vec3(-1, 65, 0)));
  assert.equal(bot.dug.length, 1);
});

test('no dig beside the lowest of the gravel the body stands on, resting on the lava sea (the beach of note 592, note 600)', async () => {
  const { digGuardPlugin } = require('../src/skills');
  const bot = worldBot({ fixture: require('./fixtures/lava-gravel-mid-243-af.json'), at: new Vec3(-231.52, 33, 56.5) });
  digGuardPlugin(bot);
  await assert.rejects(bot.dig(bot.blockAt(new Vec3(-232, 32, 55))), /the gravel underfoot at \(-232, 32, 56\) rests on lava: a block laid or dug beside it drops it, and the body with it, into the lava/);
  assert.deepEqual(bot.dug, []);
});

test('an upright held-key step is refused over a drop into lava at any depth: the step south of 25583, pressed against the wall and sliding east, stops on the ledge (motion.js, note 600)', { timeout: 15000 }, async () => {
  const { move } = require('../src/motion');
  const bot = worldBot({ fixture: LEDGE, cells: { '-104,39,105': 'air' }, at: new Vec3(-103.69, 38, 104.62) });
  // The heading the recorded move was aimed on: looked at from the body mid-fall.
  bot.entity.position = new Vec3(-103.69, 39.41, 104.62); await bot.lookAt(new Vec3(-103.5, 39.6, 105.5)); bot.entity.position = new Vec3(-103.69, 38, 104.62);
  const yaw = bot.entity.yaw;
  bot.lookAt = async () => { bot.entity.yaw = yaw; };
  const run = physics(bot);
  let ended;
  try { ended = await move(bot, new Task('m'), { label: 'unstuck_step_south', keys: ['forward'], sneak: false, why: 'the recorded step', look: new Vec3(-103.5, 39.6, 105.5), maxMs: 2500, tick: 50 }); }
  finally { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 50)); clearInterval(run.timer); }
  assert.equal(ended, false, 'refused');
  assert.equal(bot._moveRefused?.name, 'lava');
  assert.equal(run.lavaTicks, 0, `never in the lava, lowest y ${run.lowest.toFixed(2)}`);
  assert(bot.entity.onGround && bot.entity.position.y >= 38 - 1e-6, `on the ledge: ${bot.entity.position}`);
});

test('a crouched move keeps the four-block look: a span over the lava sea is walked crouched to its edge (note 600)', () => {
  const { burningAhead } = require('../src/motion');
  // A one-wide span at y 64 over the sea at y 31, the body at its end facing on.
  const bot = worldBot({ fill: q => q.y <= 31 ? 'lava' : q.y === 64 && q.x === 0 && q.z <= 0 ? 'netherrack' : 'air', at: new Vec3(0.5, 65, 0.5) });
  bot.entity.yaw = Math.PI; // facing south (+z)
  assert.equal(burningAhead(bot, ['forward']), null, 'crouched: the edge holds the body');
  assert.equal(burningAhead(bot, ['forward'], { deep: true })?.name, 'lava', 'upright: off the end is the sea');
});

test('the stall\'s blind step does not step toward a ledge whose run past it falls into lava (skills.js shakeLoose, 25600, note 600)', async () => {
  const { shakeLoose } = require('../src/skills');
  // Standing at (0, 65, 0): stone walls north, east and west; south a floor
  // cell at (0, 64, 1), and past it open air to lava forty blocks down.
  const bot = worldBot({ fill: q => {
    if (q.y <= 24) return 'lava';
    if (q.z >= 2) return 'air';
    if (q.z === 1) return q.y === 64 ? 'netherrack' : q.y < 64 ? 'air' : q.x === 0 ? 'air' : 'netherrack';
    if (q.y <= 64) return 'netherrack';
    return q.x === 0 && q.z === 0 ? 'air' : 'bedrock';
  } });
  const looked = [];
  const lookAt = bot.lookAt;
  bot.lookAt = async p => { looked.push(p.clone()); return lookAt(p); };
  await shakeLoose(bot, new Task('shake'), Date.now() + 3000, { random: () => 0.5, settleMs: 100, budgetMs: 2000 });
  assert(!looked.some(p => p.z > 1), `no step south: ${looked.map(String).join(' ')}`);
});

test('a crouched walk that ends with the body hanging by an edge over the lava sea is walked back onto its footing before the crouch lets go (mid-242-ae-nether-2-fortress-3, note 600)', { timeout: 15000 }, async () => {
  const { move } = require('../src/motion');
  // The region its death snapshot saved at 11:57:37: x -108 to -98, y 29 to
  // 58, z 100 to 108; the netherrack at (-104, 55, 104) the last floor east,
  // under (-103, 55, 104) open air to the sea. The walk to a drop, crouched,
  // east from the middle of that netherrack, as walk_to_drop went.
  const bot = worldBot({ fixture: require('./fixtures/drop-edge-mid-242-ae.json'), at: new Vec3(-103.5, 56, 104.4) });
  const run = physics(bot);
  try {
    await move(bot, new Task('m'), { label: 'walk_to_drop', keys: ['forward'], sneak: true, look: new Vec3(-99.5, 56.2, 104.4), maxMs: 1500, tick: 50 });
    for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 50));
  } finally { clearInterval(run.timer); }
  assert(bot.entity.onGround && bot.entity.position.y >= 56 - 1e-6, `still on the netherrack: ${bot.entity.position}`);
  assert.equal(run.lavaTicks, 0);
  assert.equal(Math.floor(bot.entity.position.x), -104, `its middle back over the footing: ${bot.entity.position}`);
});
