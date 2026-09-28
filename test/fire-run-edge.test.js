'use strict';
// Note 610: mid-243-af-nether-3-fortress-4 (25587, 14:45:19): alight in a
// fire at (-127.6, 71, -195.7) on a netherrack slope above a thirty-block
// drop to the cavern floor, nothing about; out_of_fire was chosen (0.65),
// "5 steps to a cell two blocks from any flame, about 0.9 seconds at a
// sprint", and by 14:45:23 the body had gone five blocks west, past the
// route's last cell and off the ledge at y 69, and hit the floor at y 41
// from 14.8. The saved region, read after the death (test/fixtures).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { groundOf, registry } = require('./fixtures/saved-ground');

const SLOPE = require('./fixtures/fire-slope-mid-243-af.json');
function slopeBot(at) {
  const blockAt = groundOf(SLOPE);
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health: 14.8, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {}, metadata: [1] }, entities: {},
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

test('an upright held-key step is refused toward a fall onto ground that costs half the health, as toward lava (motion.js, note 610)', () => {
  const { burningAhead } = require('../src/motion');
  // On the ledge at (-131, 69, -198), the drop west of it: open to the cavern floor at y 40.
  const bot = slopeBot(new Vec3(-130.5, 69, -197.5));
  bot.entity.yaw = Math.PI / 2; // facing west (-x)
  const hit = burningAhead(bot, ['forward'], { deep: true });
  assert.equal(hit?.name, 'deadly_fall', JSON.stringify(hit));
  assert.equal(burningAhead(bot, ['forward']), null, 'crouched: the edge holds the body');
});

test('the run out of fire keeps off every cell by a fall that kills, the route\'s and any it is carried to: the body stays on the slope (mid-243-af-nether-3-fortress-4)', { timeout: 20000 }, async () => {
  const vitals = require('../src/vitals');
  const { fallBeside } = require('../src/movement');
  const bot = slopeBot(new Vec3(-127.627, 71, -195.723));
  bot._inFireAt = Date.now();
  const route = vitals.fireRoute(bot);
  assert.ok(route?.length, 'a way out');
  for (const c of route) assert.equal(fallBeside(bot, c), null, `${c} is by a fall`);
  // What turned the recorded run west past its cells is not in the frames;
  // here the heading is turned west halfway, as a swing or a knock turns it.
  const lookAt = bot.lookAt; let looks = 0;
  bot.lookAt = async p => { await lookAt(p); if (++looks >= 4) bot.entity.yaw = Math.PI / 2; };
  bot.look = async () => {}; // the turn is not turned back
  const run = physics(bot);
  try { await vitals.outOfFire(bot, new Task('fire'), () => {}, route); }
  catch (_) { /* stopped */ }
  finally { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 50)); clearInterval(run.timer); }
  assert.ok(run.lowest > 60, `fell to y ${run.lowest.toFixed(1)}, at ${bot.entity.position}`);
});
