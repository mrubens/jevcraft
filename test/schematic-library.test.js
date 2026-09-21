'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { library, chooseSchematic, PARTS } = require('../src/schematic-library');
const { generatedEntries } = require('../src/schematic-generators');
const { validateSchematic } = require('../src/designer');
const { villageCandidates } = require('../src/dream');

test('every design on the shelf validates, and the shelf covers every village part', () => {
  const shelf = library(registry);
  assert(shelf.length >= 40, `${shelf.length} designs`);
  for (const entry of generatedEntries()) assert.doesNotThrow(() => validateSchematic(entry.source, registry), entry.id);
  for (const part of PARTS) assert(shelf.some(e => e.part === part), `a ${part} is on the shelf`);
  const ids = shelf.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert(shelf.every(e => e.summary.blocks > 0 && e.summary.size && e.summary.materials));
  const available = [...new Set(shelf.map(e => e.part))];
  assert(Object.keys(villageCandidates([], { available })).includes('chapel'), 'the village can ask for what the shelf holds');
});

test('Jev chooses a design from the shelf for a part; one candidate needs no question; an unlisted answer is refused', async () => {
  const shelf = library(registry);
  const cottages = shelf.filter(e => e.part === 'cottage');
  assert(cottages.length > 1);
  let asked;
  const client = { systemOne: async ({ questions, state }) => { asked = { questions, state }; return { answers: { design: { choice: cottages[1].id, confidence: 0.7 } } }; } };
  const chosen = await chooseSchematic(client, { part: 'cottage', entries: shelf, structures: [{ name: 'Birch Cottage', request: 'build a cottage', size: [11, 10, 9], distance: 6 }] });
  assert.equal(chosen.entry.id, cottages[1].id);
  assert.equal(Object.keys(asked.questions.design.criteria).length, cottages.length);
  assert.equal(asked.state.standing[0].name, 'Birch Cottage');
  const single = shelf.filter(e => e.part === 'cottage').slice(0, 1);
  const alone = await chooseSchematic({ systemOne: async () => assert.fail('one option needs no question') }, { part: 'cottage', entries: single });
  assert.equal(alone.entry.id, single[0].id);
  await assert.rejects(chooseSchematic({ systemOne: async () => ({ answers: { design: { choice: 'castle-of-dreams' } } }) }, { part: 'cottage', entries: shelf }), /not on the shelf/);
  assert.equal(await chooseSchematic(client, { part: 'castle', entries: shelf }), null);
});
