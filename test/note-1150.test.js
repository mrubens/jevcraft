'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { need } = require('../src/eye-need');

const bot = (eyes, powder = 1) => ({ inventory: { items: () => [{ name: 'ender_eye', count: eyes }, { name: 'blaze_powder', count: powder }] } });

test('the eye just thrown by the stronghold search, not yet picked up, is held: no pearl is short for it (note 1150)', () => {
  const goal = { kind: 'win', gameProgress: { milestones: {} }, strongholdSearch: { bearings: [{}], throws: 1, pendingPickup: { end: { x: 0, y: 70, z: 0 } } } };
  const thrown = need(bot(12), goal);
  assert.equal(thrown.pearlsLeft, 0);
  assert.equal(thrown.rodsLeft, 0);
  assert.equal(thrown.eyes, 13);
  // Picked up or lost, the pack is the count again.
  delete goal.strongholdSearch.pendingPickup;
  assert.equal(need(bot(13), goal).pearlsLeft, 0);
  assert.equal(need(bot(12), goal).pearlsLeft, 1, 'shattered: one more is wanted');
});

test('eyes of ender carried in the Nether are asked of with the pearls', async () => {
  const { Vec3 } = require('vec3');
  const stash = require('../src/rod-stash');
  const { pearlsNow } = require('../src/mob-hunt');
  const keepOption = stash.keepOption;
  stash.keepOption = () => ({ description: 'Keep the 12 eyes of ender safe from a death first.', run: async () => true });
  try {
    let said = null;
    const client = { systemOne: async ({ questions }) => { said = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'keep_here' } } }; } };
    const b = { health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(-21, 71, 18) }, entities: {}, inventory: { items: () => [{ name: 'ender_eye', count: 12 }, { name: 'blaze_powder', count: 1 }], slots: [] } };
    const goal = { kind: 'win', gameProgress: { milestones: {} }, mobHunt: { item: 'ender_pearl', entity: 'enderman', targetCount: 1 } };
    assert.equal(await pearlsNow(b, { check() {} }, goal, () => {}, {}, client), 'kept');
    assert.match(JSON.stringify(said.carry_on), /Hunt on with the 12 eyes of ender in the pack: nothing is put down, and every pearl and eye carried is lost with a death here/);
  } finally { stash.keepOption = keepOption; }
});
