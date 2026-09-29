'use strict';
// Note 683: 25598 (mid-242-ee-fortress-18), 2026-09-29 18:57:07 to 09Z. A
// wither skeleton two blocks off, faced to within a degree; its blows took
// 20 to 13.3 to 6.6 to none, each printed "(shield up)". The first came 17
// ms after the reflex raised the shield; the second 236 ms after
// shield_guard was answered, the third 49 ms after it was answered again.
// The stance's entry lowered the shield (and the step before it), and a
// raised shield blocks only after a quarter second: each re-asking of the
// guard was a gap with no block, a blow in it landing whole.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival, keepShieldForStance, SHIELD_STANCES } = require('../src/survival');
const combat = require('../src/combat');

// As recorded at 18:57:08.5: the bot on nether brick at (-284.5, 65,
// -110.5), the skeleton at (-285.9, 65, -109.1), the bot in iron helmet and
// chestplate with an iron sword and a shield.
function guardBot({ skeletonAt = new Vec3(-285.9, 65, -109.1), health = 13.3, alight = false } = {}) {
  const skeleton = { id: 1269, name: 'wither_skeleton', type: 'hostile', position: skeletonAt, height: 2.4, width: 0.7, isValid: true, heldItem: { name: 'stone_sword' } };
  const shield = [];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 19, oxygenLevel: 20,
    entities: { 1269: skeleton }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(-284.5, 65, -110.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0), metadata: { 0: alight ? 1 : 0 } },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 19 }, { name: 'cooked_beef', count: 11 }], slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 45: { name: 'shield' } }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const f = p.floored(); const s = f.y < 65; return { position: f, name: s ? 'nether_bricks' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {},
    pathfinder: { movements: {}, setGoal() {} }, clearControlStates() {}, setControlState() {},
    activateItem(off) { if (off) shield.push('up'); }, deactivateItem() { shield.push('down'); } });
  const threat = () => ({ entity: skeleton, distance: skeleton.position.distanceTo(bot.entity.position), visible: true });
  return { bot, skeleton, threat, shield };
}

// The stance question as the step asks it, answered `choice`, the runs
// stood in for.
async function answer(survival, danger, choice) {
  const build = survival.stanceOptions.bind(survival);
  const ran = [];
  survival.stanceOptions = (...a) => { const o = build(...a); for (const [k, v] of Object.entries(o)) v.run = async () => { ran.push(k); return true; }; return o; };
  survival.decide = async () => ({ path: [choice] });
  survival.scoutRetreat = async () => {};
  try { await survival.stanceStep(new Task('x'), {}, () => {}, danger, false); } finally { survival.stanceOptions = build; }
  return ran;
}

test('shield_guard asked again with the skeleton at arm\'s length keeps the shield up through the question (the guard\'s swings, not the reflex\'s) and the answer; a stance that walks still lowers it (25598, 18:57:08.5, note 683)', async () => {
  const { bot, threat, shield } = guardBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  combat.raiseShield(bot);
  assert.deepEqual(shield, ['up']);
  const ran = await answer(survival, [threat()], 'shield_guard');
  assert.deepEqual(ran, ['shield_guard']);
  assert.ok(!shield.includes('down'), `the shield was lowered at the answer: ${shield.join(', ')}`);
  assert.equal(bot._shieldRaised, true);
  // The same asking answered with a stance that is not behind the shield:
  // lowered for its hands and its walk, as before.
  const other = guardBot();
  const s2 = new Survival(other.bot, { navigate: async () => {} }, { state: { shelters: [] } });
  combat.raiseShield(other.bot);
  const opts = Object.keys(s2.stanceOptions(new Task('x'), {}, () => {}, [other.threat()], false));
  const walks = opts.find(k => !SHIELD_STANCES.has(k) && !/^shoot_/.test(k));
  assert.ok(walks, `another stance offered: ${opts.join(', ')}`);
  await answer(s2, [other.threat()], walks);
  assert.ok(other.shield.includes('down'), `${walks} lowered it`);
});

test('the step keeps the shield up for a shield stance with a biter at arm\'s length, and only then (note 683)', () => {
  const g = guardBot();
  combat.raiseShield(g.bot);
  g.bot._stance = { choice: 'shield_guard' };
  assert.equal(keepShieldForStance(g.bot), true, 'the skeleton at 2 blocks, the guard standing');
  // No shield stance standing: the step lowers it as it did.
  g.bot._stance = { choice: 'retreat' };
  assert.equal(keepShieldForStance(g.bot), false);
  delete g.bot._stance;
  assert.equal(keepShieldForStance(g.bot), false);
  // The skeleton six blocks off: nothing at arm's length.
  const far = guardBot({ skeletonAt: new Vec3(-290.5, 65, -110.5) });
  combat.raiseShield(far.bot); far.bot._stance = { choice: 'shield_guard' };
  assert.equal(keepShieldForStance(far.bot), false);
  // Alight: the step's douse and walks come first.
  const hot = guardBot({ alight: true });
  combat.raiseShield(hot.bot); hot.bot._stance = { choice: 'shield_guard' };
  assert.equal(keepShieldForStance(hot.bot), false);
  // Not raised: nothing to keep.
  const down = guardBot(); down.bot._stance = { choice: 'shield_guard' };
  assert.equal(keepShieldForStance(down.bot), false);
});

test('shield_guard says a raised shield blocks only after a quarter second, and that it stays up while asked again (note 683)', () => {
  const { bot, threat } = guardBot();
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  const o = survival.stanceOptions(new Task('x'), {}, () => {}, [threat()], false);
  assert.ok(o.shield_guard);
  assert.match(o.shield_guard.description, /a raised shield blocks only after a quarter second, so a blow landing in that moment lands whole\. The shield stays up while this is asked again\./);
  assert.equal(combat.SHIELD_BLOCKS_AFTER_MS, 300);
});
