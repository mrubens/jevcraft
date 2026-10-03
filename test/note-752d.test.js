'use strict';
// Note 752d. 25598 (15:00:36 to 15:00:41Z) fell 19.1 to 6.7 in nine blows
// with the shield up between two zombies, one behind; the stance said "2 hits
// in the last 20 seconds" and shield_guard was chosen at 0.96 at 7 health.
// 25585 (14:56:35Z) stood still through three preemptions and turn_priority
// with a creeper 3.5 blocks off, and the blast took 20 to 6.3. 25598
// (15:21:22Z) was asked shelter_method with a creeper 2.7 blocks off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const hitLog = require('../src/hit-log');

const T0 = Date.parse('2026-09-30T15:00:36Z');

function twoZombies() {
  const front = { id: 21, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, -0.5), height: 1.95, width: 0.6, isValid: true };
  const back = { id: 22, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 2.3), height: 1.95, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 19.1, food: 17, oxygenLevel: 20,
    entities: { 21: front, 22: back }, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 40 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  return { bot, front, back };
}

test('every fall of health is counted, not only the hits the server named a source for: nine falls with the shield up, two named (25598, note 752d)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, front, back } = twoZombies();
  hitLog.install(bot);
  bot._shieldRaised = true;
  const hp = [17.7, 16.3, 15, 13.6, 12.2, 10.8, 9.4, 8.1, 6.7];
  hp.forEach((h, i) => { t.mock.timers.setTime(T0 + i * 600); bot.health = h; bot.emit('health'); if (i === 2) hitLog.note(bot, back); if (i === 6) hitLog.note(bot, front); });
  const says = hitLog.says(bot, [front, back].map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })));
  assert.match(says, /Health fell 9 times in the last 20 seconds, 19\.1 to 6\.7 health, every one with the shield up; the server named the source of 2\./);
});

test('shield_guard between two zombies says the one outside the shield\'s cover, by name, and what it has landed; the pillar is among the ways out with its time (25598, note 752d)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, front, back } = twoZombies();
  [0, 1, 2].forEach(i => { t.mock.timers.setTime(T0 + i * 1000); bot.health = 19 - 2 * i; hitLog.note(bot, back); });
  t.mock.timers.setTime(T0 + 5000); bot.health = 7;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [front, back].map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })).sort((a, b) => a.distance - b.distance);
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  assert(options.shield_guard, Object.keys(options).join(','));
  assert.match(options.shield_guard.description, /Outside the shield's cover as it faces the zombie: the zombie 1\.8 blocks off, 180 degrees from the way the shield faces, which has landed 3 hits in the last 20 seconds; its blows land whole\./);
  if (options.pillar?.quick) assert.match(Object.values(options)[0].description, /two blocks up on placed blocks, about 1\.5 seconds, out of the reach of what walks/);
});

test('with a creeper within its alert, a question about anything but the fight and the turn is not asked: it comes back stale, the creeper first (25598 15:21:22Z, note 752d)', async () => {
  const { decide } = require('../src/decisions');
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(3.2, 64, 0.5), height: 1.7, metadata: [] };
  const bot = { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, health: 16, food: 18, oxygenLevel: 20, time: { timeOfDay: 18000 },
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, metadata: [0] }, entities: { 9: creeper }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    blockAt: p => p.y < 64 ? { name: 'stone', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  let sent = 0;
  const client = { model: 'x', systemOne: async req => { sent++; return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) }; } };
  const d = await decide('shelter_method', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree: { seal_here: { description: 'Seal here.' }, shaft_pocket: { description: 'A shaft pocket.' } }, state: {} });
  assert.equal(d.stale, true); assert(d.creeperFirst); assert.equal(sent, 0);
  // Gone past its alert: asked as ever.
  creeper.position = new Vec3(20.5, 64, 0.5);
  const d2 = await decide('shelter_method', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree: { seal_here: { description: 'Seal here.' }, shaft_pocket: { description: 'A shaft pocket.' } }, state: {} });
  assert.notEqual(d2.stale, true); assert.equal(sent, 1);
});

test('while turn_priority is out over a creeper\'s alert, the bot backs from it as the stance question does (25585 14:56:35Z, note 752d)', async () => {
  const arbiter = require('../src/arbiter');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 20, food: 20, oxygenLevel: 20, entities: {} };
  let backs = 0;
  bot._shotSurvival = { backFromCreeper: async (task, stop) => { backs++; await new Promise(r => setTimeout(r, 50)); return true; } };
  const decide = async () => { await new Promise(r => setTimeout(r, 300)); return { path: ['survival'] }; };
  const claims = [{ layer: 'survival', action: 'creeper_back_off', urgency: 'pressing', alert: 'creeper', facts: { creeper: 3.5, lightsAt: 3, fuse: 1.5, blocksASecond: 3 }, run: async () => true },
    { layer: 'work', action: 'gather_wool', urgency: 'routine', facts: {}, run: async () => true }];
  const out = await arbiter.arbitrate(bot, claims, { decide, mobs: [], state: {}, task: { check() {} }, run: false });
  assert.equal(out.winner.layer, 'survival');
  assert(backs >= 2, `backed ${backs} times`);
});

test('sealed in with the creeper out of sight, the pocket\'s own question is asked; in sight it is the creeper first as before (note 1075)', async () => {
  const { decide } = require('../src/decisions');
  const creeper = { id: 9, name: 'creeper', type: 'hostile', position: new Vec3(3.2, 64, 0.5), height: 1.7, metadata: [] };
  let hidden = true;
  const bot = { game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival' }, health: 16, food: 18, oxygenLevel: 20, time: { timeOfDay: 18000 },
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, metadata: [0] }, entities: { 9: creeper }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    // Out of the bot's sight (the look's ray stopped), with a way round to it still.
    blockAt: p => p.y < 64 ? { name: 'stone', boundingBox: 'block', position: p, shapes: [[0, 0, 0, 1, 1, 1]] } : { name: 'air', boundingBox: 'empty', position: p, shapes: [] },
    world: { raycast: (from, dir, len) => hidden ? { position: new Vec3(1, 65, 0), intersect: from.plus(dir) } : null } };
  let sent = 0;
  const client = { model: 'x', systemOne: async req => { sent++; return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) }; } };
  const tree = { stay: { description: 'Stay in the pocket.' }, tunnel_out: { description: 'Dig a passage out.' } };
  const d = await decide('pocket_next', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree, state: {} });
  assert.notEqual(d.stale, true); assert.equal(sent, 1);
  // Another question is still the creeper's first there.
  const other = await decide('shelter_method', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree: { seal_here: { description: 'Seal here.' }, shaft_pocket: { description: 'A shaft pocket.' } }, state: {} });
  assert.equal(other.stale, true, 'another question, the creeper hidden'); assert(other.creeperFirst);
  // The wall open, the creeper in sight: the pocket's question waits for it.
  hidden = false;
  // (A fresh creeper: the look's sight of one is kept a moment.)
  delete bot.entities[9]; bot.entities[10] = { ...creeper, id: 10 };
  await new Promise(r => setTimeout(r, 30));
  const seen = await decide('pocket_next', { client, bot, goal: { kind: 'win' }, task: { check() {} }, tree, state: {} });
  assert.equal(seen.stale, true, 'the pocket question, the creeper in sight'); assert(seen.creeperFirst);
});
