'use strict';
// Note 752i. 25597 (19:49:09 to 19:49:12Z): preempted for a creeper 6.5
// blocks off; it stepped out of sight at 4.6, nothing backed from it, the
// work was asked about again, and it came round to 1.7 and went off, 20 to
// none, a shield carried and never raised.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const danger = require('../src/danger');
const arbiter = require('../src/arbiter');

const T0 = Date.parse('2026-09-30T19:49:09Z');
function creeperBot({ wall = false } = {}) {
  const creeper = { id: 90, name: 'creeper', type: 'hostile', position: new Vec3(5.1, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 90: creeper }, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, eyeHeight: 1.62, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'shield', count: 1 }], slots: {}, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: (from, dir) => bot._wall && dir.x > 0 ? { position: new Vec3(3, 64, 0), intersect: from.offset(2.5, 0, 0) } : null },
    findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {} });
  bot._wall = wall;
  return { bot, creeper };
}

test('a creeper the alert was raised for stays the threat out of sight while within seven: the work does not resume beside it (25597 19:49:12Z, note 752i)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, creeper } = creeperBot();
  const r = arbiter.observeReflexes(bot).find(x => x.key === 'creeper');
  assert(r, 'the alert, in sight at 4.6');
  bot._wall = true;
  t.mock.timers.setTime(T0 + 2000);
  assert.equal(danger.immediateThreat(bot)?.entity, creeper, 'out of sight at 4.6, still the threat');
  assert.throws(() => danger.checkThreats(bot), /creeper/);
  assert(arbiter.observeReflexes(bot).some(x => x.key === 'creeper'), 'and still the alert');
  // Another, never alerted, out of sight at 4.6: as before, not the threat.
  const fresh = creeperBot({ wall: true });
  assert.equal(danger.immediateThreat(fresh.bot), undefined);
});

test('with a creeper within seven and a shield carried, shield_the_blast is offered with what a raised shield does to a blast (note 752i)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const { bot, creeper } = creeperBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, [{ entity: creeper, distance: creeper.position.distanceTo(bot.entity.position), visible: true }], false);
  assert(options.shield_the_blast, Object.keys(options).join(','));
  assert.match(options.shield_the_blast.description, /with the shield raised \(taken to the off hand first\) and hold it until it goes off or is gone: a blast from the side the shield faces does no damage once the shield has been up a quarter second/);
  require('../src/decisions').question('encounter_stance');
});

test('a skeleton "in sight" by the look a minute at 1.6 blocks with no shot coming at the bot stands off, said so; one shot seen and it does not (25592 20:08 to 20:17Z, note 752i)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const hitLog = require('../src/hit-log');
  const skeleton = { id: 95, name: 'skeleton', type: 'hostile', position: new Vec3(1.7, 63, 1.5), height: 1.99, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 20, oxygenLevel: 20,
    entities: { 95: skeleton }, time: { timeOfDay: 18000 }, entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, metadata: [0] }, inventory: { items: () => [], slots: [] }, registry: { entitiesByName: {} },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 63 ? 'stone' : 'air', boundingBox: p.y < 63 ? 'block' : 'empty', position: p }) });
  hitLog.install(bot);
  for (let s = 0; s <= 70; s += 5) { t.mock.timers.setTime(T0 + s * 1000); danger.threats(bot, 64); }
  const sk = danger.threats(bot, 64).find(x => x.entity === skeleton);
  assert(sk.visible);
  assert(danger.standsOff(bot, sk), 'stands off: no shot in a minute');
  assert.match(danger.reachSays(bot, sk), /in sight by the look for \d+ seconds and within its reach, yet no shot has come at the bot in that time/);
  assert.doesNotMatch(danger.reachSays(bot, sk), /it can shoot the bot from where it is/);
  bot.emit('shot', { name: 'arrow', landed: false });
  assert.equal(danger.standsOff(bot, sk), null, 'a shot came: its line is real');
});

test('a stay up on a top answered against mobs below holds, not asked again, while they are there (25583 20:35Z, note 752i)', async () => {
  const wayDown = require('../src/way-down');
  const zombie = { id: 97, name: 'zombie', type: 'hostile', position: new Vec3(3.5, 57, 0.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), onGround: true }, entities: { 97: zombie }, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 18000 }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 57 || (p.x === 0 && p.z === 0 && p.y < 64) ? 'stone' : 'air', boundingBox: p.y < 57 || (p.x === 0 && p.z === 0 && p.y < 64) ? 'block' : 'empty', position: p }), inventory: { items: () => [], slots: [] } };
  bot._wayDownStay = { until: Date.now() + 60000, below: [97] };
  await assert.rejects(wayDown.comeDownFirst(bot, { check() {} }, { x: 40, y: 57, z: 0 }, { client: {} }), e => e.name === 'NoRoute' && e.stayUp === true && /Staying up on the top as answered/.test(e.message));
  delete bot.entities[97];
  zombie.isValid = false;
  require('../src/decisions').question('way_down');
});

test('sealed under rock at night, the stay does not wait for daylight: it says the night up top changes nothing down here (25583 20:34Z, note 752i)', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const origin = new Vec3(206, -9, -65);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 12, food: 17,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 18000, age: 100000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'overworld', verifiedAt: new Date(Date.now() - 60000).toISOString() }] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.wait = async () => {};
  survival.decide = async (task, g, save, { id, tree: tr }) => { if (id === 'pocket_next') tree = tr; return { path: ['stay'], stale: false }; };
  await survival.step(new Task('x'), { kind: 'win', request: 'beat the game' }, () => {});
  assert(tree?.stay, 'pocket_next asked with stay');
  assert.match(tree.stay.description, /^Stay in the pocket: under rock here the night up top changes nothing/);
  assert.doesNotMatch(tree.stay.description, /until daylight/);
});
