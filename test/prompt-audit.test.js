'use strict';
// What Jev is told, read for what is false where it is asked (note 677):
// src/decisions/prompt-audit.js, scripts/audit-prompts.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const pa = require('../src/decisions/prompt-audit');
const { decide, withRealTime, stateFor, question } = require('../src/decisions');

// The case the user found live: sealed in a Nether pocket at hunger 16
// with nothing to eat, pocket_next told of the sun and an eleven-minute
// night, its state saying daylight: 'day'.
const netherPocket = {
  id: 'pocket_next', dimension: 'the_nether',
  instructions: { task: 'The bot is sealed in a small pocket. Choose what to do next.', guidance: 'Use the time of day, health, food, armour and the mobs about. Mobs spawn in the dark; zombies and skeletons in the open burn once the sun is up, creepers, spiders and cave mobs do not. A night in one is about eleven minutes from dusk; health comes back while hunger is eighteen or more.' },
  state: { timeOfDay: 6000, night: false, daylight: 'day', health: 14, food: 16, healing: { healthComesBack: 'no: hunger 16, under eighteen; every point lost stays lost until the bot eats to eighteen', daylight: 'no day or night here: its mobs neither burn nor stop' } },
  tree: { stay: { description: 'Stay in the pocket, though nothing is watching it, not healing: 14 health and hunger 16. No daylight comes outside the Overworld, so a stay here ends only when the bot opens the pocket.' }, go_for_food: { description: 'Open the pocket and go for food.' } },
};

test('the Overworld\'s words and the day\'s fields are found in a question asked in the Nether', () => {
  const found = pa.audit(netherPocket);
  const rules = found.map(f => `${f.rule}:${f.term}`);
  // The day's fields...
  for (const k of ['timeOfDay', 'night', 'daylight']) assert(rules.includes(`day-field:${k}`), `${k} flagged: ${rules}`);
  // ...and the guidance's sun, dusk and dark.
  assert(found.some(f => f.rule === 'overworld-guidance' && f.term === 'the sun'));
  assert(found.some(f => f.rule === 'overworld-guidance' && /night|dawn or dusk/.test(f.term)));
  assert(found.some(f => f.rule === 'overworld-guidance' && f.term === 'spawning by the dark'));
  // What says there is no day here is the truth, and is not flagged: the
  // option's "No daylight comes outside the Overworld", healing's daylight.
  assert(!found.some(f => /option stay/.test(f.at)), JSON.stringify(found.filter(f => /option stay/.test(f.at))));
  assert(!found.some(f => f.at === 'state.healing.daylight'));
  // The same words on the Overworld are the truth there.
  assert.deepEqual(pa.audit({ ...netherPocket, dimension: 'overworld' }).filter(f => f.class === 'overworld'), []);
  // And a question whose dimension is not known is not judged by it.
  assert.deepEqual(pa.audit({ ...netherPocket, dimension: null }).filter(f => f.class === 'overworld'), []);
});

test('a question at odds with itself is found: day by its state and a wait for the dawn, no healing and "healing from"', () => {
  const day = pa.audit({ id: 'x', dimension: 'overworld', instructions: {}, state: { night: false }, tree: { stay: { description: 'Stay in the pocket until daylight, about 9 real minutes.' }, leave: { description: 'Leave.' } } });
  assert(day.some(f => f.rule === 'day-yet-waits-for-dawn'));
  const heal = pa.audit({ id: 'x', dimension: 'the_nether', instructions: {}, state: { healing: { healthComesBack: 'no: hunger 12, under eighteen' } }, tree: { stay: { description: 'Stay in the pocket, healing from 9 health.' }, leave: { description: 'Leave.' } } });
  assert(heal.some(f => f.rule === 'no-healing-yet-healing'));
  // A Nether claim with no place named, on the Overworld.
  const claim = pa.audit({ id: 'x', dimension: 'overworld', instructions: { guidance: 'No day comes here: a wait ends only when the bot ends it.' }, state: {}, tree: {} });
  assert(claim.some(f => f.rule === 'nether-claim-on-the-overworld'));
});

test('off the Overworld the day\'s fields go at any depth and the question says no day comes; on it, the day is said as before', () => {
  const sent = stateFor({ timeOfDay: 6000, night: false, daylight: 'day', survivalFacts: { nightStartsAt: 11500, dawnAt: 23000, difficulty: 'normal' }, healing: { daylight: 'no day or night here: its mobs neither burn nor stop' }, health: 14 }, 'minecraft:the_nether');
  assert.deepEqual(sent, { survivalFacts: { difficulty: 'normal' }, healing: { daylight: 'no day or night here: its mobs neither burn nor stop' }, health: 14, dimension: 'the_nether' });
  const overworld = { timeOfDay: 6000, night: false };
  assert.equal(stateFor(overworld, 'overworld'), overworld);
  const spec = question('pocket_next');
  const nether = withRealTime(spec, { dimension: 'the_nether' }, 'the_nether').guidance;
  assert.doesNotMatch(nether, /sun|eleven minutes|dusk|time of day|a Minecraft day/);
  assert.match(nether, /In the Nether, with hunger under eighteen and nothing to eat, health never comes back in a pocket however long it waits/);
  assert.match(nether, /In the Nether no day or night comes/);
  const home = withRealTime(spec, {}, 'overworld').guidance;
  assert.match(home, /zombies and skeletons in the open burn once the sun is up/);
  assert.match(home, /a Minecraft day is twenty real minutes/);
  // The question's own words go without the dimension's keys.
  assert.equal(withRealTime(spec, {}, 'overworld').overworld, undefined);
});

test('every question defined, as asked in the Nether, and every chat line said there, says nothing only the Overworld has', async () => {
  const { definedRecords, narrationRecords } = require('../scripts/audit-prompts');
  const found = [...definedRecords(), ...narrationRecords()].flatMap(r => pa.audit(r).map(f => ({ ...f, source: r.source })));
  assert.deepEqual(found.map(f => `${f.source} ${f.at}: ${f.clause}`), []);
  // The chat line the live critic heard in the Nether (note 677).
  const { linesFor } = require('../src/narration');
  assert(!linesFor('leave_shelter', { dimension: 'the_nether' }).some(l => /sun|morning/i.test(l)));
  assert.equal(linesFor('sleep', { dimension: 'the_nether' }), null);
});

test('every recorded question, rendered as it goes out, says nothing false where it was asked (the replay cases and the fixtures)', async () => {
  const { run } = require('../scripts/audit-prompts');
  const { findings, rendered } = await run();
  assert(rendered > 90);
  const sure = findings.filter(f => !f.weak);
  assert.deepEqual(sure.map(f => `${f.source} ${f.rule} ${f.at}: ${f.clause}`), []);
});

test('under the test runner a question built to say the sun rises in the Nether fails the test that built it', async () => {
  const bot = { game: { dimension: 'the_nether', gameMode: 'survival' }, entity: null, health: 20, food: 20 };
  const client = { model: 'x', systemOne: async req => ({ answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) }) };
  const tree = { stay: { description: 'Stay in the pocket until the sun is up.' }, leave: { description: 'Open the pocket and go back to work.' } };
  await assert.rejects(decide('pocket_next', { client, bot, goal: null, tree, state: { health: 20 } }), /tells Jev what is false where it is asked \(the_nether\)/);
  // An Overworld-only question asked off it fails too.
  await assert.rejects(decide('evening_chore', { client, bot, goal: null, tree: { stock_stash: { description: 'Put spares in the chest.' }, wait_for_bedtime: { description: 'Wait by the chest.' } }, state: {} }), /overworld-only-question-asked-off-it/);
});

test('a pocket left in the Nether, or at night, is not said as the morning (the live critic, note 677)', () => {
  const { narrate } = require('../src/narration');
  for (const [dimension, timeOfDay] of [['the_nether', 1000], ['overworld', 15000]]) {
    const said = [];
    const bot = { chat: l => said.push(l), game: { dimension }, time: { timeOfDay } };
    narrate(bot, { survivalAction: { action: 'leave_shelter', at: 'now' } }, { now: 10000 });
    assert.equal(said.length, 1);
    assert.doesNotMatch(said[0], /sun|morning/i, `${dimension} at ${timeOfDay}: ${said[0]}`);
  }
});
