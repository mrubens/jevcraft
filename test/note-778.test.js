'use strict';
// Note 778. Underground mob crowds (the reviewer's check-in 02:39Z problem
// 3): 25588 (mid-231-ab) died in shield_guard among zombies, told the
// guard's record against one; 25593 (mid-237-ap) held shield_guard against
// one zombie while four more closed within two blocks, asked again only at
// 11.3 health. And the critic's ~02:54Z item 4: 25581 (mid-235-ad) behind
// stone from a creeper 4 to 7 blocks off for two minutes, block_creeper
// answered eight times, its hold ending only on the creeper's moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');
const crowd = require('../src/crowd');

const T0 = Date.parse('2026-10-01T01:29:00Z');
// Zombies at the given (x, z) spots round a bot at (0.5, 64, 0.5).
function crowdBot(spots, { health = 20, armour = true } = {}) {
  const entities = {};
  spots.forEach(([x, z], i) => { entities[60 + i] = { id: 60 + i, name: 'zombie', type: 'hostile', position: new Vec3(x, 64, z), height: 1.95, width: 0.6, isValid: true }; });
  const slots = armour ? { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } : { 45: { name: 'shield' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 17, oxygenLevel: 20,
    entities, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 40 }], slots, emptySlotCount: () => 10 },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const danger = () => Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: true })).sort((a, b) => a.distance - b.distance);
  return { bot, danger, entities };
}

test('the shield covers the biters within its cover of the way it faces, by where they stand: priced and said so (25588 01:29:28Z, note 778)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  // Two zombies to the east, 10 degrees apart: both inside the cover.
  const front = crowdBot([[2.3, 0.5], [2.6, 0.9]]);
  const sf = new Survival(front.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const a = sf.stanceOptions(new Task('x'), {}, () => {}, front.danger(), false);
  assert(a.shield_guard, Object.keys(a).join(','));
  assert.match(a.shield_guard.description, /Another biter stands within four blocks and within 60 degrees of the way it faces: its blows go into the shield too/);
  assert.match(a.shield_guard.description, /Standing here: .*the zombie the shield faces and 1 more within its cover of that way blocked|its blows on the shield|their blows on the shield/);
  // One east, one west: the one behind lands, counted.
  const split = crowdBot([[2.3, 0.5], [-1.3, 0.5]]);
  const ss = new Survival(split.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const b = ss.stanceOptions(new Task('x'), {}, () => {}, split.danger(), false);
  assert(b.shield_guard);
  assert.doesNotMatch(b.shield_guard.description, /within 60 degrees of the way it faces: its blows go into the shield/);
  assert(b.shield_guard.expects.damage > a.shield_guard.expects.damage, `behind ${b.shield_guard.expects.damage} > in front ${a.shield_guard.expects.damage}`);
});

test('the clock sums each biter\'s blows a second, the shield taking only those within its cover', () => {
  const ce = require('../src/combat-estimate');
  const worn = ce.armourOf([]);
  const at = (x, z) => ({ entity: { name: 'zombie', position: new Vec3(x, 64, z) }, distance: Math.hypot(x - 0.5, z - 0.5) });
  const biters = [at(2, 0.5), at(2, 1), at(-1, 0.5), at(0.5, -1)];
  const here = new Vec3(0.5, 64, 0.5);
  const bare = crowd.clock({ biters, worn, health: 7.5 });
  const shielded = crowd.clock({ biters, worn, health: 7.5, facing: biters[0], here });
  assert.equal(bare.open.length, 4);
  assert.equal(shielded.covered.length, 2, 'the one faced and the one 18 degrees off it');
  assert.ok(Math.abs(shielded.rate - bare.rate / 2) < 1e-9);
  assert.ok(Math.abs(bare.seconds - 7.5 / bare.rate) < 1e-9);
});

test('with two or more within four, the guard\'s record against one is not said; the crowd\'s own record is, where six answers stand behind it (note 778)', t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const one = crowdBot([[2.3, 0.5]]);
  const s1 = new Survival(one.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const a = s1.stanceOptions(new Task('x'), {}, () => {}, one.danger(), false);
  assert.match(a.shield_guard.description, /The bot's own runs of this stance against a zombie/);
  assert.doesNotMatch(a.shield_guard.description, /This way's record with (two|three or more) mobs within 4 blocks/);
  const three = crowdBot([[2.3, 0.5], [-1.3, 0.5], [0.5, 2.6]], { armour: false });
  const s3 = new Survival(three.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const b = s3.stanceOptions(new Task('x'), {}, () => {}, three.danger(), false);
  assert.doesNotMatch(b.shield_guard.description, /The bot's own runs of this stance against a zombie/);
  assert.match(b.shield_guard.description, /This way's record with three or more mobs within 4 blocks \(the trials since 2026-09-30T12:00Z\): answered 10 times from a median 16\.5 health; in the ten seconds after, a median 4 health lost, 6 or more 2 times, 3 died\./);
  if (b.retreat) assert.match(b.retreat.description, /answered 6 times from a median 11\.3 health/);
  if (b.pillar) assert.doesNotMatch(b.pillar.description, /This way's record with/, 'too few answers');
  assert.equal(crowd.recordSays('fight', 1), '', 'one within four: nothing said');
  assert.match(crowd.recordSays('fight', 2), /answered 12 times/);
});

test('a held stance is asked again when a second mob closes within four, the crowd change named (25593 20:54:43Z, note 778)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, danger } = crowdBot([[2.3, 0.5], [-1.3, 0.5], [0.5, 2.6]]);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  // Chosen 8 seconds ago against the one zombie then within four, its kind
  // the same as the newcomers' (not news by kind, note 743).
  survival.state.stance = { choice: 'shield_guard', kinds: 'zombie', ids: [60, 61, 62], mobs: [{ name: 'zombie', distance: 1.8, visible: true }], at: T0 - 8000, ranAt: T0 - 100, health: 20,
    expects: { damage: 0.7, seconds: 15, oneHit: 1.4 }, crowd: { n: 1 }, start: { swingAt: 0, blocks: 0, carried: 0, food: 17, pos: { x: 0.5, y: 64, z: 0.5 } } };
  let asked = null, tree = null;
  survival.stanceOptions = () => ({ shield_guard: { description: 'Shield.', expects: { damage: 3, seconds: 15 }, run: async () => true }, fight: { description: 'Fight.', run: async () => true }, retreat: { description: 'Run.', run: async () => true } });
  survival.decide = async (task, goal, save, q) => { asked = q.state; tree = q.tree; return { path: ['fight'] }; };
  survival.scoutRetreat = async () => {};
  await survival.stanceStep(new Task('x'), {}, () => {}, danger(), false);
  assert(asked, 'asked again');
  assert.match(asked.previousStance.askedAgainFor, /^a crowd change: 3 mobs within 4 blocks now \(the zombie 1\.8 blocks off, the zombie 1\.8 blocks off, the zombie 2\.1 blocks off\), 1 when the shield guard was chosen 8 seconds ago$/);
  assert.match(asked.crowdWithinFour, /^3 mobs within 4 blocks: .*3 bite at arm's length now: about [\d.]+ health a second through the armour worn with no shield raised, at 20 health about \d+ seconds of it/);
  assert.match(tree.shield_guard.description, /Held now, chosen 8 seconds ago with 1 within 4 blocks: 3 are within 4 now/);
  // Chosen now against three: the same three are not news.
  assert.equal(survival.state.stance.crowd.n, 3);
});

test('the guard\'s own run stops when the crowd grows past what it was chosen against (note 778)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const { bot, entities } = crowdBot([[2.3, 0.5]]);
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.state.stance = { choice: 'shield_guard', at: T0, crowd: { n: 1 } };
  const stop = survival.crowdStop();
  assert.equal(stop(), false);
  entities[70] = { id: 70, name: 'zombie', type: 'hostile', position: new Vec3(-1.2, 64, 0.5), height: 1.95, width: 0.6, isValid: true };
  assert.equal(stop(), false, 'read four times a second');
  t.mock.timers.setTime(T0 + 300);
  assert.equal(stop(), true);
  assert.equal(stop.grown, '2 within 4 blocks, 1 when chosen');
});

test('a block held against a creeper that has not closed ends at twenty seconds with the standoff said, and the ways that end it say so (25581 mid-235-ad 02:48:56Z, critic ~02:54Z item 4)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const creeper = { id: 99, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 64, 0.5), height: 1.7, width: 0.6, isValid: true, metadata: [] };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entities: { 99: creeper }, time: { timeOfDay: 18000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, eyeHeight: 1.62, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    // A stone column two high at x 3 between them.
    blockAt: p => { const f = p.floored(); const s = f.y < 64 || (f.x === 3 && f.z === 0 && f.y <= 65); return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {}, activateItem() {}, deactivateItem() {} });
  const danger = () => [{ entity: creeper, distance: creeper.position.distanceTo(bot.entity.position), visible: false }];
  const survival = new Survival(bot, { navigate: async () => {}, place: async () => {} }, { state: { shelters: [] } });
  const first = survival.stanceOptions(new Task('x'), {}, () => {}, danger(), false);
  assert(first.block_creeper, Object.keys(first).join(','));
  assert.doesNotMatch(first.block_creeper.description, /A standoff:/, 'not yet');
  // Held behind the block since its line was cut.
  survival.state.stance = { choice: 'block_creeper', kinds: 'creeper', ids: [99], at: T0, health: 20, blockCreeper: { id: 99, creeperAt: creeper.position.clone(), distance: 5, at: T0 } };
  assert.equal(survival.blockCreeperHeld(survival.state.stance), null);
  // Asked about as the step goes, every few seconds.
  for (const dt of [5000, 10000, 15000]) { t.mock.timers.setTime(T0 + dt); survival.stanceOptions(new Task('x'), {}, () => {}, danger(), false); }
  t.mock.timers.setTime(T0 + 21000);
  const later = survival.stanceOptions(new Task('x'), {}, () => {}, danger(), false);
  assert.match(later.block_creeper.description, /A standoff: 21 seconds with this creeper 5 to 5 blocks off and the bot not hurt by it\. Behind the block it neither lights nor leaves, so staying ends nothing and the work waits\. It ends with the creeper dead, the fight: about \d+ swings?, [\d.]+ seconds, .*; or with the bot more than 16 blocks from it, past the range a creeper follows a player from: about 11 blocks more/);
  if (later.fight) assert.match(later.fight.description, /This ends the standoff with the creeper \(21 seconds with this creeper 5 to 5 blocks off and the bot not hurt by it\)\./);
  const why = survival.blockCreeperHeld(survival.state.stance);
  assert.match(why, /^a standoff: the creeper has not closed in 21 seconds behind the block \(21 seconds with this creeper 5 to 5 blocks off and the bot not hurt by it\); the block holds it off and ends nothing$/);
  // Chosen again: the next end comes when this hold has run as long as the
  // whole standoff had (21 seconds), the standoff then twice as long.
  survival.state.stance = { ...survival.state.stance, at: T0 + 21000, askAgain: undefined, blockCreeper: { id: 99, creeperAt: creeper.position.clone(), distance: 5, at: T0 + 21000 } };
  for (const dt of [27000, 33000, 39000]) { t.mock.timers.setTime(T0 + dt); survival.noteCreeperStandoff({ entity: creeper, distance: 5 }); }
  t.mock.timers.setTime(T0 + 41000);
  assert.equal(survival.blockCreeperHeld(survival.state.stance), null, 'not at 20 seconds more');
  t.mock.timers.setTime(T0 + 42000);
  assert.match(survival.blockCreeperHeld(survival.state.stance), /^a standoff: the creeper has not closed in 21 seconds behind the block \(42 seconds with this creeper/);
});
