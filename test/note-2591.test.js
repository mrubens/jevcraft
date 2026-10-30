'use strict';
// Note 2591: a ghast's fireball struck back is the bot's, and a zombified piglin it hurts where it bursts turns its
// group on the bot (the game's rule). full-193 (25591, 2026-10-30 13:59:20Z) and full-168 (25588, 09:23Z) struck one
// back with the piglins about and were slain by the group within a minute. With zombified piglins about, shot_answer
// says so on shield_up and offers the shield with the fireball left unstruck; that answer leaves it unstruck.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const reflex = require('../src/shot-reflex');

function ghastWorld({ piglins = [] } = {}) {
  const ghast = { id: 11, name: 'ghast', type: 'hostile', position: new Vec3(40, 70, 0), height: 4, width: 4, isValid: true, metadata: {}, _shotWarn: { key: `11:${Date.now()}`, at: Date.now(), kind: 'ghast' } };
  const entities = { 11: ghast };
  piglins.forEach((d, i) => { entities[20 + i] = { id: 20 + i, name: 'zombified_piglin', position: new Vec3(0, 70, d), isValid: true, height: 1.95, width: 0.6 }; });
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0, 70, 0), height: 1.8 }, entities,
    inventory: { slots: { 45: { name: 'shield' }, 5: null, 6: null, 7: null, 8: null }, items: () => [] },
    health: 20, _survivalGoal: null, _goal: null,
  });
  return { bot, ghast };
}

test('with zombified piglins about, the strike back is said with their group, and the shield is offered with it unstruck', () => {
  const { bot, ghast } = ghastWorld({ piglins: [18, 30] });
  const tree = reflex.shotOptions(bot, [ghast]);
  assert.match(tree.shield_up.description, /a zombified piglin hurt by the bot turns on it with every one of its kind within about 35 blocks/);
  assert.match(tree.shield_up.description, /2 zombified piglins are within 48 blocks, the nearest 18 off/);
  assert.ok(tree.shield_no_strike, 'the shield without the strike');
  assert.equal(tree.shield_no_strike.noStrike, true);
  assert.match(tree.shield_no_strike.description, /leave the fireball unstruck: the shield takes its hurt and not its push/);
});

test('with none about, nothing is added', () => {
  const { bot, ghast } = ghastWorld();
  const tree = reflex.shotOptions(bot, [ghast]);
  assert.equal(tree.shield_no_strike, undefined);
  assert.doesNotMatch(tree.shield_up.description, /zombified piglin/);
});

test('the unstruck answer is held as the shield, and the fireball in the air is not struck under it', async () => {
  const { bot, ghast } = ghastWorld({ piglins: [18] });
  const survival = { client: {}, decide: async () => ({ path: ['shield_no_strike'] }) };
  reflex.ask(bot, survival, [ghast]);
  await new Promise(r => setTimeout(r, 20));
  const a = bot._shotAnswers.get(11);
  assert.equal(a.choice, 'shield_up');
  assert.equal(a.noStrike, true);
});
