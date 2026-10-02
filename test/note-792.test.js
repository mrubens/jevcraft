'use strict';
// Note 792: the run out of fire stood in the flames. Of the Nether's lava
// and fire deaths from 2026-09-30T06Z to 10-01T04:57Z, five of those by fire
// had the run out of fire on and the body not moving while it burned in a
// flame; of every run of a second or more in the window, 48 of 70 never
// moved half a block. Three things undid it: the held-key move refused the
// flame on the route its own search had chosen through one (motion.js read
// only the cells the body's box stood in to call it an escape), the
// shield's hold let none of the run's keys down (shot-reflex.js), and the
// hurt watchdog stopped it, keys and all, at the second burn (survival.js).
// The ground is two trials' saves, read after the deaths.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { groundOf, registry } = require('./fixtures/saved-ground');

const TUNNEL = require('./fixtures/fire-tunnel-25588.json');
const BRICKS = require('./fixtures/fire-bricks-25581.json');

// A body alight on saved ground, its keys read by the game's physics.
function alightBot(fixture, at, { yaw = 0, health = 16 } = {}) {
  const blockAt = groundOf(fixture);
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw, pitch: 0, effects: {}, attributes: {}, metadata: [1] }, entities: {},
    jumpTicks: 0, jumpQueued: false,
    inventory: { items: () => [], slots: {} },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt,
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (y, p) => { bot.entity.yaw = y; bot.entity.pitch = p; };
  bot._inFireAt = Date.now();
  return bot;
}
// The physics twenty times a second; `letGoMs`: every so often the keys let
// go by something else, as each burn's hurt let them go in the records.
function physics(bot, { letGoMs = 0 } = {}) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const world = { getBlock: p => bot.blockAt(p) };
  const ph = Physics(registry, world); fixPlayerDimensions(ph);
  const run = { ticks: 0, letGo: 0 };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    ph.simulatePlayer(s, world); s.apply(bot);
    if (letGoMs && ++run.ticks % Math.round(letGoMs / 50) === 0) { bot.clearControlStates(); run.letGo++; }
  }, 50);
  return run;
}
const clear = bot => { const saved = bot._inFireAt; bot._inFireAt = 0; try { return !require('../src/motion').bodyBurning(bot) && !require('../src/vitals').inFire(bot); } finally { bot._inFireAt = saved; } };
async function runOut(bot, opts = {}) {
  const vitals = require('../src/vitals');
  const route = vitals.fireRoute(bot);
  const run = physics(bot, opts);
  const log = console.log; console.log = () => {};
  try { await vitals.outOfFire(bot, new Task('fire'), () => {}, route); } catch (_) { /* stopped */ }
  finally { await new Promise(r => setTimeout(r, 100)); clearInterval(run.timer); console.log = log; }
  return { route, out: clear(bot), run };
}

// 25588 (mid-242-xa-fortress-1) at 10:26:14.9Z on 09-30: in the two-cell
// pocket of its tunnel at (-100.7, 77, 151.3), alight from a blaze's
// fireball, a flame over the pocket's mouth at (-101, 78, 152). The run's
// route goes up through that flame; the log has "out_of_fire: fire at
// (-101, 78, 152) ahead; not walked into" fifteen times, and it burned
// there from 16.2 to none in seventeen seconds.
const TUNNEL_AT = new Vec3(-100.7, 77, 151.3);

test('the tunnel\'s run out of fire: the route goes through the flame over the pocket, and the run takes it out (25588, 10:26Z)', { timeout: 20000 }, async () => {
  const vitals = require('../src/vitals'), motion = require('../src/motion');
  const bot = alightBot(TUNNEL, TUNNEL_AT);
  assert.equal(clear(bot), false, 'in the flames at the start');
  const route = vitals.fireRoute(bot);
  assert.ok(route?.length, 'a way out');
  assert.ok(route.some(c => bot.blockAt(c)?.name === 'fire'), 'through a flame: the pocket is ringed');
  // The old rule: the body alight beside the flame, not in its cell, reads
  // the flame ahead as a cell to refuse.
  const first = route[0].offset(0.5, 0, 0.5);
  bot.entity.yaw = Math.atan2(-(first.x - TUNNEL_AT.x), -(first.z - TUNNEL_AT.z));
  assert.equal(motion.bodyBurning(bot), null, 'no flame in the box\'s own cells');
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true })?.name, 'fire', 'the old rule refuses the route\'s first step');
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true, flames: false }), null, 'a run out of fire is not refused its flames');
  bot.entity.yaw = 0;
  const r = await runOut(bot);
  assert.ok(r.out, `out of the flames, at ${bot.entity.position}`);
  assert.ok(bot.entity.position.y >= 77.9, 'up out of the pocket');
});

test('the same run with the flames refused, as walked before: it never leaves the pocket (25588)', { timeout: 20000 }, async () => {
  const motion = require('../src/motion');
  const bot = alightBot(TUNNEL, TUNNEL_AT);
  const move = motion.move;
  motion.move = (b, t, o) => move(b, t, { ...o, throughFlames: false });
  try {
    const r = await runOut(bot);
    assert.equal(r.out, false, `still in the flames at ${bot.entity.position}`);
  } finally { motion.move = move; }
});

test('the keys let go each half second, as each burn hurt let them go: the run presses them again and is out (25588)', { timeout: 20000 }, async () => {
  const bot = alightBot(TUNNEL, TUNNEL_AT);
  const r = await runOut(bot, { letGoMs: 500 });
  assert.ok(r.run.letGo >= 2, 'let go mid-run');
  assert.ok(r.out, `out at ${bot.entity.position}`);
});

// 25581 (mid-235-ad) at 03:16:31Z on 10-01: on the fortress bricks at
// (381.5, 60, -137.2) at a blaze spawner, flames in the cells about it, the
// shield up to the blazes; six runs out of fire, none moved, nine seconds
// in the flames from 13.5 to none.
test('the fortress bricks\' run with the keys let go each half second: out of the flames in about a second (25581, 03:16Z)', { timeout: 20000 }, async () => {
  const bot = alightBot(BRICKS, new Vec3(381.5, 60, -137.2), { health: 11.2 });
  assert.equal(clear(bot), false, 'in the flames at the start');
  const t0 = Date.now();
  const r = await runOut(bot, { letGoMs: 500 });
  assert.ok(r.route?.length, 'a way out');
  assert.ok(r.out, `out at ${bot.entity.position}`);
  assert.ok(Date.now() - t0 < 4000, 'within a few seconds');
});

test('the held-key move: a key let go by something else is pressed again; flames ahead are still refused other moves, and lava every move', async () => {
  const motion = require('../src/motion');
  const bot = alightBot(TUNNEL, TUNNEL_AT);
  const let_go = setInterval(() => bot.clearControlStates(), 60);
  const seen = [];
  const log = console.log; console.log = m => seen.push(m);
  try {
    await motion.move(bot, new Task('t'), { label: 'probe', keys: ['jump'], sneak: false, why: 'test', maxMs: 300, tick: 25 });
  } finally { clearInterval(let_go); console.log = log; }
  assert.ok(seen.some(m => /probe: jump let go mid-move by something else; pressed again/.test(m)), seen.join('\n'));
  // Facing the flame over the pocket, the body alight beside it: another
  // move is refused it; one marked as a run out of fire is not.
  bot.entity.yaw = Math.atan2(-(-100.5 - TUNNEL_AT.x), -(152.5 - TUNNEL_AT.z));
  bot.entity.position = new Vec3(-100.7, 78, 151.3);
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true })?.name, 'fire');
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true, flames: false }), null);
  // Lava ahead is refused a run out of fire too.
  const lava = Object.assign(Object.create(Object.getPrototypeOf(bot.blockAt(TUNNEL_AT))), bot.blockAt(TUNNEL_AT));
  const blockAt = bot.blockAt;
  bot.blockAt = p => (Math.floor(p.x) === -101 && Math.floor(p.y) === 78 && Math.floor(p.z) === 152) ? { ...lava, name: 'lava', boundingBox: 'empty', position: p } : blockAt(p);
  assert.equal(motion.burningAhead(bot, ['forward'], { deep: true, flames: false })?.name, 'lava');
});

// The shield's hold: an answer of shield_up given before the run (not a
// charge's) held the body: no movement key went down. 25590 (mid-218-ab,
// 02:59:03Z on 10-01) took five in-fire hurts in 2.5 seconds, 18 to 8.7,
// the run on and the shield up to a ghast 22 blocks off.
test('a shield hold from an earlier answer leaves the run out of fire its keys and its look', async () => {
  const reflex = require('../src/shot-reflex');
  const registryBlaze = registry.entitiesByName.blaze.metadataKeys.indexOf('flags');
  const air = p => ({ position: p, name: 'air', boundingBox: 'empty' });
  const calls = { raised: 0, looked: 0 };
  const here = new Vec3(0.5, 65, 0.5);
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: new EventEmitter(), game: { dimension: 'the_nether' }, health: 18, time: { timeOfDay: 6000 },
    entity: { id: 1, position: here, yaw: 0, pitch: 0, onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities: { 775: { id: 775, name: 'blaze', type: 'hostile', position: new Vec3(0.5, 66, 8.5), height: 1.8, width: 0.6, isValid: true, metadata: { [registryBlaze]: 1 } } },
    inventory: { slots: { 45: { name: 'shield' } }, items: () => [] },
    world: { raycast: () => null },
    blockAt: p => p.y < 65 ? { position: p, name: 'netherrack', boundingBox: 'block' } : air(p),
    controlState: {}, pathfinder: { isBuilding: () => false, setGoal() {} },
    activateItem() { calls.raised++; }, deactivateItem() {},
    setControlState(k, on) { this.controlState[k] = on; }, clearControlStates() { this.controlState = {}; },
    look() { calls.looked++; return Promise.resolve(); }, lookAt() { return Promise.resolve(); }, attack() {},
  });
  const survival = { client: {}, decide: async () => ({ path: ['shield_up'] }) };
  const t0 = Date.now();
  reflex.tick(bot, survival, t0);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(reflex.answerFor(bot, 775, t0)?.choice, 'shield_up');
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2500);
  assert.ok(bot._shotHold && !bot._shotHold.free, 'held: the answer\'s hold');
  bot.setControlState('forward', true);
  assert.notEqual(bot.controlState.forward, true, 'no run under the hold: the walk is the hold\'s');
  // The run out of fire begins (vitals.js outOfFire marks it while it runs).
  bot._bodyWayRunning = { action: 'out_of_fire', at: t0 + 2600 };
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 2700);
  assert.equal(bot._shotHold?.free, true, 'the hold leaves the run its keys');
  bot.setControlState('forward', true);
  assert.equal(bot.controlState.forward, true, 'forward goes down');
  const looked = calls.looked; bot.look(1, 0);
  assert.equal(calls.looked, looked + 1, 'and its look');
  assert.ok(calls.raised >= 1, 'the shield still up to the blaze');
  // A held-key move under way (note 930): its keys too, the shield up beside it.
  delete bot._bodyWayRunning; bot.controlState = {};
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 6000);
  assert.ok(bot._shotHold && !bot._shotHold.free, 'held again with nothing running');
  bot._controller = { name: 'pillar_up', keys: ['jump'], since: t0 + 6000 };
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 6100);
  assert.equal(bot._shotHold?.free, true, 'the pillar\'s jump keeps its keys');
  bot.setControlState('jump', true);
  assert.equal(bot.controlState.jump, true);
  // A stance in force that walks off (note 935): its walk too, whatever the answer before it.
  delete bot._controller; bot.controlState = {};
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 9000);
  assert.ok(bot._shotHold && !bot._shotHold.free, 'held again with nothing running');
  bot._stance = { choice: 'leave_and_heal', at: Date.now(), ranAt: Date.now(), running: true, health: bot.health };
  bot._shotLookAt = 0; reflex.tick(bot, survival, t0 + 9100);
  assert.equal(bot._shotHold?.free, true, 'leave and heal walks with the shield up beside it');
  bot.setControlState('forward', true);
  assert.equal(bot.controlState.forward, true);
});

test('the hurt watchdog: two burns while the run out of fire runs do not stop it; with nothing running they do', () => {
  const { Survival } = require('../src/survival');
  const make = () => {
    let stopped = 0;
    const bot = Object.assign(new EventEmitter(), { entity: { id: 1, position: new Vec3(0, 64, 0) }, entities: {}, health: 14, game: { dimension: 'the_nether' }, time: { timeOfDay: 6000 },
      blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }),
      stopDigging: () => {}, pathfinder: { setGoal: () => { stopped++; } }, clearControlStates() {}, inventory: { items: () => [] } });
    new Survival(bot, {});
    bot._inFireAt = Date.now();
    return { bot, stopped: () => stopped };
  };
  const a = make();
  a.bot._bodyWayRunning = { action: 'out_of_fire', at: Date.now() };
  a.bot.emit('entityHurt', a.bot.entity, null); a.bot.emit('entityHurt', a.bot.entity, null);
  assert.equal(a.stopped(), 0, 'the run is the answer to the burns');
  assert.equal(a.bot._threatAbort, undefined);
  const b = make();
  b.bot._controller = { name: 'out_of_lava' };
  b.bot.emit('entityHurt', b.bot.entity, null); b.bot.emit('entityHurt', b.bot.entity, null);
  assert.equal(b.stopped(), 0, 'so is the way out of the lava');
  const c = make();
  c.bot.emit('entityHurt', c.bot.entity, null); c.bot.emit('entityHurt', c.bot.entity, null);
  assert.equal(c.stopped(), 1, 'in the flames with no way out running: stopped for the survival layer');
});
