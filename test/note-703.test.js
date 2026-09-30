'use strict';
// Note 703: an angry group, a crouch that holds, a fetch that is held, and
// clocks from a save.
// (1) 25592 (mid-242-dc-fortress-25) died at 00:09:50Z: box_here was chosen
// with calm zombified piglins 2.9 to 6.4 blocks off, the box's builder swung
// at what was in reach, and three of them took it from 20 to none; no
// option had named them.
// (2) Its rise_on_block was chosen three times in three seconds on fire and
// the body never left y 81.
// (3) 25589's upkeep fetch_stems was cut by a preemption and never taken up;
// its keep_searching said "1146 minutes searching" 20 minutes in.
// (4) 25588 crouched on magma five times and was hurt after each; its
// crafting table "did not open" four times, crouched with a shield.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const anger = require('../src/anger');
const danger = require('../src/danger');
const registry = require('minecraft-data')('1.21.8');

const FLAGS = registry.entitiesByName.zombified_piglin.metadataKeys.indexOf('mob_flags');

// Open air over a floor of netherrack under y 65; `blocks` maps 'x,y,z' to
// a block name above it.
function world(blocks = {}) {
  const at = f => blocks[`${f.x},${f.y},${f.z}`] || (f.y < 65 ? 'netherrack' : 'air');
  const blockAt = p => { const f = p.floored(); const name = at(f); const solid = !/^(air|lava|fire)$/.test(name);
    return { position: f, name, boundingBox: solid ? 'block' : 'empty', diggable: solid, shapes: solid ? [[0, 0, 0, 1, 1, 1]] : [] }; };
  const raycast = (from, dir, length) => { for (let t = 0; t <= length; t += 0.05) { const p = from.plus(dir.scaled(t)); if (blockAt(p).boundingBox === 'block') return { position: p.floored(), intersect: p }; } return null; };
  return { blockAt, raycast };
}
function zp(id, x, z, { aggressive = false } = {}) {
  const metadata = {}; if (aggressive) metadata[FLAGS] = 0x04;
  return { id, name: 'zombified_piglin', type: 'hostile', position: new Vec3(x, 65, z), height: 1.95, width: 0.6, isValid: true, metadata };
}
function stubBot({ entities = {}, blocks = {}, items = [] } = {}) {
  const w = world(blocks);
  const client = new EventEmitter();
  const bot = Object.assign(new EventEmitter(), {
    registry, _client: client, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, time: { timeOfDay: 6000 },
    entity: { id: 1, position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: {} },
    entities, blockAt: w.blockAt, world: { raycast: w.raycast },
    inventory: { slots: { 45: { name: 'shield' } }, items: () => items },
    controlState: {}, pathfinder: { isMoving: () => false, setGoal() {} },
    setControlState(k, on) { this.controlState[k] = on; }, getControlState(k) { return !!this.controlState[k]; },
    clearControlStates() { this.controlState = {}; },
  });
  return { bot, client };
}

test('the bot\'s hit on a zombified piglin angers it and its group within 35 blocks, for as long as the game does', () => {
  const struck = zp(10, 2.5, 0.5), near = zp(11, 20.5, 0.5), far = zp(12, 60.5, 0.5);
  const { bot } = stubBot({ entities: { 10: struck, 11: near, 12: far } });
  const now = Date.now();
  assert.equal(anger.angry(bot, struck, now), false);
  assert.equal(danger.provoked(bot, struck), false);
  // The server's word: entity 10 hurt, its source the bot (ids sent + 1).
  anger.heard(bot, { entityId: 10, sourceCauseId: 2, sourceDirectId: 2 }, now);
  assert.match(anger.angerOf(bot, struck, now).why, /the bot struck it/);
  assert.match(anger.angerOf(bot, near, now).why, /struck one of its group .* 18 blocks from it/);
  assert.equal(anger.angry(bot, far, now), false);
  assert.equal(danger.provoked(bot, near), true);
  // A threat now, named for what it is.
  assert.ok(danger.threats(bot, 24).some(t => t.entity === near));
  // The anger ends.
  assert.equal(anger.angry(bot, near, now + 41000), false);
  // Another's hit on it is not the bot's.
  const { bot: other } = stubBot({ entities: { 10: zp(10, 2.5, 0.5) } });
  anger.heard(other, { entityId: 10, sourceCauseId: 51, sourceDirectId: 51 }, now);
  assert.equal(anger.angry(other, other.entities[10], now), false);
});

test('one with its arms up coming at the bot is hunting it; one with its arms up standing off is not', () => {
  const coming = zp(20, 10.5, 0.5, { aggressive: true }), idle = zp(21, 0.5, 12.5, { aggressive: true });
  const { bot } = stubBot({ entities: { 20: coming, 21: idle } });
  const t0 = Date.now();
  assert.equal(anger.angry(bot, coming, t0), false);
  anger.angry(bot, idle, t0);
  coming.position = new Vec3(7.5, 65, 0.5);
  assert.match(anger.angerOf(bot, coming, t0 + 1000).why, /arms are up and it is coming at the bot/);
  assert.equal(anger.angry(bot, idle, t0 + 1000), false);
  // At arm's length with its arms up, whatever it did before.
  const close = zp(22, 2.5, 0.5, { aggressive: true });
  bot.entities[22] = close;
  assert.match(anger.angerOf(bot, close, t0).why, /arms are up, 2 blocks off/);
});

test('what is said of an angry one is that it hunts the bot, not that it has no way; the calm ones near are said with what a swing costs', () => {
  const a = zp(30, 6.5, 0.5), calm = zp(31, 0.5, 3.5);
  const { bot } = stubBot({ entities: { 30: a, 31: calm } });
  anger.heard(bot, { entityId: 30, sourceCauseId: 2 }, Date.now());
  // The calm one is of the same group: angry too. A calm one far from the hit.
  const { bot: b2 } = stubBot({ entities: { 31: zp(31, 0.5, 3.5) } });
  const says = require('../src/arbiter').mobWouldSays({ entity: a, distance: 6, visible: false }, { noWay: true, bot });
  assert.match(says, /^angry \(the bot struck it .*\): it hunts the bot with its group, any way round, from up to 35 blocks/);
  assert.doesNotMatch(says, /has no way to the bot/);
  assert.match(anger.calmAbout(b2), /1 zombified piglin within 8 \(nearest 3\), not angry: a hit on one, a sword's sweep too, turns every one within 35 blocks on the bot/);
  assert.equal(anger.calmAbout(bot), null);
});

test('the box\'s swing takes a zombified piglin in reach only once it is angry', async () => {
  const tactics = require('../src/blaze-tactics');
  const calm = zp(40, 2, 0.5);
  const { bot } = stubBot({ entities: { 40: calm } });
  let swung = null;
  Object.assign(bot, { attack: e => { swung = e; }, lookAt: async () => {}, look: async () => {}, heldItem: { name: 'iron_sword' }, equip: async () => {}, deactivateItem() {} });
  bot._defenseAttackAt = 0;
  const task = { check() {}, cancelled: false };
  assert.equal(await tactics.strikeInReach(bot, task), false);
  assert.equal(swung, null);
  anger.heard(bot, { entityId: 40, sourceCauseId: 2 }, Date.now());
  assert.equal(await tactics.strikeInReach(bot, task), true);
  assert.equal(swung, calm);
});

test('the crouch on magma is taken up again when something lets it go, not under a walk, and let go off the magma', () => {
  const vitals = require('../src/vitals');
  const { bot } = stubBot({ blocks: { '0,64,0': 'magma_block' } });
  vitals.crouchOnHotFloor(bot);
  assert.equal(bot.controlState.sneak, true);
  // The next step's clearControlStates.
  bot.clearControlStates();
  bot.emit('physicsTick');
  assert.equal(bot.controlState.sneak, true);
  // A held-key walk upright is its own.
  bot.clearControlStates(); bot._controller = { name: 'walk' };
  bot.emit('physicsTick');
  assert.equal(!!bot.controlState.sneak, false);
  bot._controller = null;
  bot.emit('physicsTick');
  assert.equal(bot.controlState.sneak, true);
  // Off the magma: let go, and the hold ends.
  bot.entity.position = new Vec3(3.5, 65, 0.5);
  bot.emit('physicsTick');
  assert.equal(bot.controlState.sneak, false);
  assert.equal(bot._hotFloorCrouch, undefined);
});

test('a window opens to an upright click, and the crouch comes back once it is open', async () => {
  const { openWindow } = require('../src/skills');
  const { bot } = stubBot({ blocks: { '0,64,0': 'magma_block' } });
  bot.setControlState('sneak', true);
  const table = { position: new Vec3(1, 65, 0), name: 'crafting_table' };
  // The game: a crouched click with a shield in hand opens nothing.
  const open = () => new Promise((resolve, reject) => {
    if (bot.controlState.sneak) return setTimeout(() => reject(new Error('no window')), 30);
    setTimeout(() => { bot.emit('windowOpen', {}); resolve('window'); }, 20);
  });
  const task = { check() {}, cancelled: false };
  assert.equal(await openWindow(bot, task, open, { block: table, what: 'the crafting table', timeoutMs: 1000 }), 'window');
  assert.equal(bot.controlState.sneak, true);
  assert.equal(bot._uncrouchedFor, undefined);
});

test('rise_on_block is not offered where its climb stops before the first block, and a way that came to nothing is said to the next asking', async () => {
  const vitals = require('../src/vitals');
  const body = require('../src/body');
  const items = [{ name: 'netherrack', count: 20 }];
  const { bot } = stubBot({ blocks: { '0,64,0': 'magma_block' }, items });
  assert.ok(vitals.hotFloorWays(bot, { check() {} }).rise_on_block);
  const { bot: lava } = stubBot({ blocks: { '0,64,0': 'magma_block', '1,66,0': 'lava' }, items });
  assert.equal(vitals.hotFloorWays(lava, { check() {} }).rise_on_block, undefined);
  // A way whose run found why it did nothing: said as lastWay.
  const ways = { rise_on_block: { description: 'Rise.', run: async () => { bot._bodyWayWhy = 'no block went down: the body is where it was, y 81'; return false; } } };
  const decide = async () => ({ path: ['rise_on_block'] });
  await body.answer(bot, { check() {} }, 'fire', ways, { decide });
  let asked = null;
  await body.answer(bot, { check() {} }, 'fire', ways, { decide: async (id, ctx) => { asked = ctx.state; return { path: ['rise_on_block'] }; } });
  assert.match(asked.lastWay, /^rise on block was chosen .* no block went down: the body is where it was, y 81\.$/);
});

test('a fetch of stems chosen at upkeep is held: a fortress leg asked after it offers the fetch, not the legs', () => {
  const intention = require('../src/intention');
  const { bot } = stubBot();
  bot.chat = () => {};
  const goal = { kind: 'win' };
  const i = intention.after(bot, goal, 'upkeep', ['fetch_stems'], { chosen: true });
  assert.equal(i?.choice, 'fetch_stems');
  const tree = { leg_south: { description: 'x' }, go_to_blazes: { description: 'x', target: { x: 194, y: 60, z: 320 } }, fetch_stems: { description: 'x' }, none_good: { description: 'x' } };
  const g = intention.gate(bot, goal, 'fortress_leg', tree);
  assert.deepEqual(Object.keys(g.tree).sort(), ['fetch_stems', 'none_good']);
  assert.match(g.underWay, /^fetch stems \(upkeep\)/);
  // Taken there, the same errand goes on: not replaced.
  intention.after(bot, goal, 'fortress_leg', ['fetch_stems'], { chosen: true });
  assert.equal(goal.intention.q, 'upkeep');
  assert.equal(goal.intention.way, 'fortress_leg/fetch_stems');
});

test('a save taken up again moves the fortress search\'s clocks on by the time it lay saved', () => {
  const tried = require('../src/tried');
  const now = Date.now(), savedAt = now - 19 * 3600000;
  const goal = { fortressSearch: { since: savedAt - 5 * 60000, legs: 20, inFortressSince: savedAt - 60000, shunned: [{ x: 1, z: 2, until: savedAt + 600000, at: savedAt }], restMs: 300000 } };
  tried.resumed(goal, { savedAt, now });
  assert.equal(Math.round((now - goal.fortressSearch.since) / 60000), 5);
  assert.equal(goal.fortressSearch.inFortressSince, now - 60000);
  assert.equal(goal.fortressSearch.shunned[0].until, now + 600000);
  assert.equal(goal.fortressSearch.restMs, 300000);
  assert.equal(goal.fortressSearch.legs, 20);
});
