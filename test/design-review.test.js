'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewDesign, THRESHOLD } = require('../src/design-review');

const design = { source: { name: 'Modest Hut', description: 'A four by four hut', size: [4, 3, 4], entrance: [1, 1, 0], palette: ['oak_planks'] },
  blocks: new Array(40).fill({ material: 'oak_planks' }), materials: { oak_planks: 40 } };

test('the review asks one question over a summary of the design, never the full region list', async () => {
  let asked;
  const result = await reviewDesign({ systemOne: async ({ state, questions }) => {
    asked = { state, questions }; return { answers: { fits: { noul: 0.12 } }, usage: { input_tokens: 300 } };
  } }, { request: 'build a huge castle', design, memory: { notes: [] } });
  assert.equal(Object.keys(asked.questions).length, 1);
  assert.equal(asked.state.design.solidBlocks, 40);
  assert.equal(asked.state.design.regions, undefined);
  assert.equal(result.accepted, false); assert.equal(result.fits, 0.12); assert.equal(result.threshold, THRESHOLD);
});

test('an accepted design passes through, and a malformed answer fails closed', async () => {
  const accepted = await reviewDesign({ systemOne: async () => ({ answers: { fits: { noul: 0.93 } } }) }, { request: 'build a hut', design });
  assert.equal(accepted.accepted, true);
  await assert.rejects(reviewDesign({ systemOne: async () => ({ answers: {} }) }, { request: 'build a hut', design }), /Invalid design review/);
});
