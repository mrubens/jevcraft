'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { arrowPosition, bowSolution, aimAtEntity, shootBow, sentAimMatches } = require('../src/projectiles');
const { Task } = require('../src/skills');

test('bow trajectories match independently stepped vanilla drag and gravity, including upward and moving targets', () => {
  const origin = new Vec3(.5, 65.52, .5);
  for (const [target, motion] of [[new Vec3(30, 66, 0), new Vec3(0, 0, 0)], [new Vec3(40, 100, 10), new Vec3(0, 0, 0)],
    [new Vec3(40, 70, 10), new Vec3(.15, 0, -.1)]]) {
    const solution = bowSolution(origin, target, motion); assert(solution);
    assert(Math.abs(solution.velocity.norm() - 3) < 1e-5);
    let position = origin.clone(), velocity = solution.velocity.clone();
    for (let n = 0; n < Math.floor(solution.ticks); n++) { position = position.plus(velocity); velocity = velocity.scaled(Math.fround(.99)).offset(0, -.05, 0); }
    position = position.plus(velocity.scaled(solution.ticks % 1));
    assert(position.distanceTo(target.plus(motion.scaled(solution.ticks))) < .02);
    assert(arrowPosition(origin, solution.velocity, solution.ticks).distanceTo(solution.target) < 1e-6);
  }
  assert.equal(bowSolution(origin, new Vec3(1000, 200, 1000)), null);
});

function fixture() {
  const arrows = { name: 'arrow', count: 16 }, bow = { name: 'bow', count: 1, durabilityUsed: 0 };
  const target = { id: 8, name: 'end_crystal', width: 2, height: 2, position: new Vec3(24, 70, 0) };
  let draws = 0, releases = 0, abandoned = false;
  const bot = Object.assign(new EventEmitter(), { registry, health: 20, oxygenLevel: 20, quickBarSlot: 0,
    game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(.5, 64, .5) },
    entities: { 8: target }, inventory: { items: () => [bow, arrows] },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    world: { raycast: () => null }, pathfinder: { setGoal() {} }, clearControlStates() {},
    equip: async i => { bot.heldItem = i; }, look: async (yaw, pitch) => { bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI }; },
    activateItem: () => draws++, setQuickBarSlot: slot => { assert.notEqual(slot, bot.quickBarSlot); abandoned = true; bot.quickBarSlot = slot; },
    deactivateItem: () => {
      if (abandoned) return;
      releases++; arrows.count--;
      bot.emit('entitySpawn', { id: 9, name: 'arrow', position: bot.entity.position.offset(0, 1.52, 0), velocity: new Vec3(3, 0, 0) });
    },
  });
  return { bot, arrows, target, state: () => ({ draws, releases, abandoned }) };
}

test('shots reject unloaded space, obstructed arcs and bystanders before drawing', async () => {
  for (const reason of ['wall', 'unloaded', 'bystander']) {
    const { bot, target, state } = fixture();
    if (reason === 'wall') bot.world.raycast = () => ({ position: new Vec3(10, 68, 0) });
    if (reason === 'unloaded') { const original = bot.blockAt; bot.blockAt = p => p.x > 10 ? null : original(p); }
    if (reason === 'bystander') bot.entities[12] = { id: 12, type: 'player', width: 4, height: 10, position: new Vec3(10, 64, .5) };
    assert.equal(aimAtEntity(bot, target), null);
    await assert.rejects(shootBow(bot, new Task('shot'), target, { chargeMs: 0 }), /No clear/);
    assert.equal(state().draws, 0);
  }
});

test('an unobstructed crystal shot favors the center of its hitbox over a narrow edge', () => {
  const { bot, target } = fixture();
  assert.deepEqual(aimAtEntity(bot, target).target, target.position.offset(0, 1, 0));
});

test('a released bow needs a new arrow entity and matching inventory consumption', async () => {
  for (const mode of ['confirmed', 'no_arrow', 'no_consume']) {
    const { bot, target, arrows } = fixture();
    if (mode === 'no_arrow') bot.deactivateItem = () => { arrows.count--; };
    if (mode === 'no_consume') bot.deactivateItem = () => bot.emit('entitySpawn', { id: 9, name: 'arrow', position: bot.entity.position });
    const attempt = shootBow(bot, new Task('shot'), target, { chargeMs: 0, confirmationMs: 80 });
    if (mode === 'confirmed') { const result = await attempt; assert.equal(result.consumed, 1); assert.equal(result.arrowId, 9); }
    else await assert.rejects(attempt, /confirmation/);
    assert.equal(bot.listenerCount('entitySpawn'), 0);
  }
});

test('cancelling a drawn bow switches slots before stopping use, so the cancellation does not shoot', async () => {
  const { bot, target, state } = fixture(), task = new Task('shot');
  const original = bot.activateItem;
  bot.activateItem = () => { original(); task.cancel(); };
  await assert.rejects(shootBow(bot, task, target), { name: 'Cancelled' });
  assert.deepEqual(state(), { draws: 1, releases: 0, abandoned: true });
  assert.equal(bot.listenerCount('entitySpawn'), 0);
});

test('release waits for the rotation packet; cancellation during rotation never fires', async () => {
  for (const cancel of [false, true]) {
    const { bot, target, state } = fixture(), task = new Task('rotation');
    let sent = false;
    bot.look = (yaw, pitch, force) => {
      assert.equal(force, false);
      return new Promise(resolve => setTimeout(() => {
        bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI };
        sent = true; if (cancel) task.cancel(); resolve();
      }, 60));
    };
    const release = bot.deactivateItem;
    bot.deactivateItem = () => { assert(sent); release(); };
    const shot = shootBow(bot, task, target, { chargeMs: 0 });
    if (cancel) { await assert.rejects(shot, { name: 'Cancelled' }); assert.equal(state().releases, 0); }
    else { await shot; assert.equal(state().releases, 1); }
  }
});

test('a yaw-complete look promise cannot release while the transmitted pitch is still interpolating', async () => {
  for (const cancel of [false, true]) {
    const { bot, target, state } = fixture(), task = new Task('pitch interpolation');
    let pitchSent = false, timer;
    bot.look = async (yaw, pitch) => {
      bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: 0 };
      timer = setTimeout(() => {
        assert.equal(state().releases, 0, 'Yaw completion must not release the arrow');
        if (cancel) task.cancel();
        else { bot.lastSentRotation.pitch = -pitch * 180 / Math.PI; pitchSent = true; }
      }, 75);
    };
    const release = bot.deactivateItem;
    bot.deactivateItem = () => { if (!state().abandoned) assert(pitchSent); release(); };
    try {
      const shot = shootBow(bot, task, target, { chargeMs: 0 });
      if (cancel) { await assert.rejects(shot, { name: 'Cancelled' }); assert.equal(state().releases, 0); }
      else { const result = await shot; assert.equal(state().releases, 1); assert(sentAimMatches(result.sentRotation, aimAtEntity(bot, target))); }
    } finally { clearTimeout(timer); }
  }
});

test('transmitted aim comparison handles circular yaw and sensitivity rounding without accepting a wrong pitch', () => {
  const solution = { yaw: -Math.PI / 2, pitch: Math.PI / 4 };
  assert(sentAimMatches({ yaw: -90, pitch: -45.075 }, solution));
  assert.equal(sentAimMatches({ yaw: -90, pitch: -9 }, solution), false);
  assert.equal(sentAimMatches({ yaw: -80, pitch: -45 }, solution), false);
  assert.equal(sentAimMatches(undefined, solution), false);
});

test('bow release rechecks the moving target and clear trajectory after the turn finishes', async () => {
  for (const change of ['target_moves', 'path_blocked']) {
    const { bot, target, state } = fixture();
    target.name = 'ender_dragon';
    let turns = 0;
    bot.look = (yaw, pitch) => new Promise(resolve => setTimeout(() => {
      bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI };
      if (++turns === 1) {
        if (change === 'target_moves') target.position = target.position.offset(0, 0, 8);
        else bot.world.raycast = () => ({ position: new Vec3(10, 68, 0) });
      }
      resolve();
    }, 50));
    const release = bot.deactivateItem;
    bot.deactivateItem = () => {
      if (!state().abandoned) {
        const fresh = aimAtEntity(bot, target);
        assert(fresh && sentAimMatches(bot.lastSentRotation, fresh), 'Release must use the target and path observed after turning');
      }
      release();
    };
    const attempt = shootBow(bot, new Task('moving aim'), target, { chargeMs: 0 });
    if (change === 'path_blocked') {
      await assert.rejects(attempt, /obstructed/);
      assert.equal(state().releases, 0);
      assert.equal(state().abandoned, true);
    } else {
      await attempt;
      assert(turns >= 2);
      assert.equal(state().releases, 1);
    }
  }
});

test('note 1343: a throw through iron bars is not a clear line; an arrow\'s is judged as before', () => {
  const { clearShot, bowSolution, THROWN } = require('../src/projectiles');
  const { Vec3 } = require('vec3');
  const origin = new Vec3(0.5, 65.5, 0.5), target = new Vec3(8.5, 70, 0.5);
  const bars = { blockAt: p => ({ name: Math.floor(p.x) === 6 ? 'iron_bars' : 'air' }), world: { raycast: () => null }, entities: {}, entity: {}, registry: { entitiesByName: {} } };
  assert.equal(clearShot(bars, origin, bowSolution(origin, target, undefined, THROWN), {}), false);
  assert.equal(clearShot(bars, origin, bowSolution(origin, target), {}), true);
});
