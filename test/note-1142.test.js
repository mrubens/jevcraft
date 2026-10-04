'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const stash = require('../src/rod-stash');
const { pearlsNow } = require('../src/mob-hunt');

const botOf = pearls => ({ health: 20, food: 19, game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(-94, 66, 17) }, entities: {},
  inventory: { items: () => pearls ? [{ name: 'ender_pearl', count: pearls }] : [], slots: [] } });
const goalOf = () => ({ kind: 'win', gameProgress: { milestones: {} }, mobHunt: { item: 'ender_pearl', entity: 'enderman', targetCount: 13 } });
const task = { check() {} };

test('pearls carried in the Nether are asked of on their own, once for each count: a chest here, or on with them (note 1142)', async () => {
  const keepOption = stash.keepOption;
  let kept = 0, asked = [];
  stash.keepOption = () => ({ description: 'Keep the 2 ender pearls safe from a death first: set a chest down 1.1 blocks off.', run: async () => { kept++; return true; } });
  try {
    const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: asked.length === 1 ? 'carry_on' : 'keep_here' } } }; } };
    const goal = goalOf();
    assert.equal(await pearlsNow(botOf(2), task, goal, () => {}, {}, client), 'carry');
    assert.match(JSON.stringify(asked[0].carry_on), /Hunt on with the 2 ender pearls in the pack: nothing is put down, and every pearl carried is lost with a death here/);
    assert.match(JSON.stringify(asked[0].carry_on), /16 deaths with pearls in the pack lost 47 of them/);
    assert.match(JSON.stringify(asked[0].carry_on), /11 still needed/);
    assert.equal(await pearlsNow(botOf(2), task, goal, () => {}, {}, client), null, 'not asked again at the same count');
    assert.equal(await pearlsNow(botOf(3), task, goal, () => {}, {}, client), 'kept', 'asked again at another pearl');
    assert.equal(kept, 1);
    assert.equal(await pearlsNow(botOf(0), task, goalOf(), () => {}, {}, client), null, 'none carried: not asked');
  } finally { stash.keepOption = keepOption; }
});

test('with no chest to put down or in reach, it is not asked', async () => {
  const keepOption = stash.keepOption;
  stash.keepOption = () => null;
  try { assert.equal(await pearlsNow(botOf(4), task, goalOf(), () => {}, {}, { systemOne: async () => { throw new Error('not asked'); } }), null); }
  finally { stash.keepOption = keepOption; }
});
