'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { earlyStage, earlyChoices } = require('../src/early-stronghold');

const botWith = (eyes, at = new Vec3(400, 70, -300)) => ({ game: { dimension: 'overworld' }, entity: { position: at },
  inventory: { items: () => eyes ? [{ name: 'ender_eye', count: eyes }] : [] } });
const answering = (choice, said = []) => ({ systemOne: async ({ questions }) => { said.push(questions.branch_0.criteria); return { answers: { branch_0: { choice } } }; } });

test('with some eyes made, finding the stronghold now is Jev\'s, and chosen it is the ladder\'s stage (note 1411)', async () => {
  const goal = { gameProgress: { milestones: {} } }, said = [];
  const bot = botWith(3);
  assert.equal(earlyStage(bot, goal), null, 'nothing chosen yet');
  assert.equal(await earlyChoices(bot, new Task('t'), goal, () => {}, answering('locate_now', said)), true);
  assert.ok(said[0].locate_now && said[0].keep_making, Object.keys(said[0]).join(','));
  assert.match(said[0].locate_now, /none reached a frame/);
  assert.match(said[0].keep_making, /10 more of the 13/);
  assert.equal(goal.earlyStronghold.pick, 'locate_now');
  assert.deepEqual(earlyStage(bot, goal), { phase: 'find_stronghold', action: 'find_stronghold', early: true });
  // Not asked again while the choice stands, nor with fewer than two eyes, nor once the search is under way.
  assert.equal(await earlyChoices(bot, new Task('t'), goal, () => {}, answering('keep_making')), false);
  assert.equal(await earlyChoices(botWith(1), new Task('t'), { gameProgress: { milestones: {} } }, () => {}, answering('locate_now')), false);
  assert.equal(await earlyChoices(bot, new Task('t'), { gameProgress: { milestones: {} }, strongholdSearch: { bearings: [{}] } }, () => {}, answering('locate_now')), false);
  // With no eye left to throw and no place the bearings meet, the eyes are made first.
  assert.equal(earlyStage(botWith(0), goal), null);
});

test('keep_making is asked again when two more eyes are made', async () => {
  const goal = { gameProgress: { milestones: {} } };
  assert.equal(await earlyChoices(botWith(2), new Task('t'), goal, () => {}, answering('keep_making')), true);
  assert.equal(earlyStage(botWith(2), goal), null);
  assert.equal(await earlyChoices(botWith(3), new Task('t'), goal, () => {}, answering('locate_now')), false);
  assert.equal(await earlyChoices(botWith(4), new Task('t'), goal, () => {}, answering('locate_now')), true);
});

test('the portal found and unlit, the eyes carried into its frames is Jev\'s, a few at a time (note 1411)', async () => {
  const frames = Array.from({ length: 12 }, (_, i) => ({ position: { x: i, y: 30, z: 0 }, eye: i === 0 }));
  const goal = { gameProgress: { milestones: { stronghold_located: { center: { x: 1878, y: 32, z: -294 }, frames } } }, endPortal: { center: { x: 1878, y: 32, z: -294 }, frames, neededEyes: 11 } };
  const said = [], bot = botWith(4, new Vec3(1500, 64, -200));
  assert.equal(await earlyChoices(bot, new Task('t'), goal, () => {}, answering('fill_now', said)), true);
  assert.match(said[0].fill_now, /390 blocks off.*4 eyes carried.*11 are empty, 7 would be left/);
  assert.deepEqual(earlyStage(bot, goal), { phase: 'fill_end_portal', action: 'fill_end_portal_some', eyes: 4, need: 11 });
  // Put in, none carried: the ladder goes on.
  assert.equal(earlyStage(botWith(0), goal), null);
  // Lit, or enough to light it, is the way it always went.
  assert.equal(earlyStage(botWith(11), goal), null);
  assert.equal(earlyStage(bot, { ...goal, endPortal: { ...goal.endPortal, litAt: 1 } }), null);
});
