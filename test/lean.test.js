'use strict';
// The question as it goes out (src/decisions/lean.js, note 672).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lean = require('../src/decisions/lean');
const { decide } = require('../src/decisions');

test('the shared records go out in their own shape, less what they say twice or what is never read', () => {
  const healing = { health: 6.300000190734863, hunger: 15, healthComesBack: 'no: hunger 15, under eighteen', standingStill: 'standing still spends no hunger' };
  const riskNow = { level: 'high: the mobs about could kill the bot if they all came', fightingAllHere: { damageTaken: 25.7, healthAfter: -20.8 }, mobsSpawnAround: true };
  const state = lean.leanState({
    health: 6.300000190734863, healing, riskNow,
    runClock: { minutesPlayed: 80, reached: { 'nether entered': '24 minutes in' }, nowOn: 'obtain blaze rods', minutesBy: { a: 7, b: 24, c: 10, d: 6, e: 1 }, lastHalfHourBy: { a: 2, b: 1 } },
    deathWouldCost: { dropsWorn: ['iron helmet'], otherStacks: 24, walkBackBlocks: null, levelsLost: 12, note: 'Everything carried drops where the bot dies and vanishes five minutes later.' },
    recentPositions: { every: 'fifteen seconds', minutes: 1, furthestFromNowBlocks: 3, places: [{ secondsAgo: 60, x: 1, y: 60, z: 1, doing: 'pillar_hold' }, { secondsAgo: 45, x: 1, y: 60, z: 1, doing: 'pillar_hold' }, { secondsAgo: 30, x: 5, y: 60, z: 1, doing: 'fight' }] },
    whatFailedBelow: ['fortress leg: every way rests', 'fortress leg: every way rests', 'step: no path'],
    nothing: null,
  });
  assert.equal(state.health, 6.3);
  // Healing and the risk as they were built, their numbers to a tenth.
  assert.deepEqual(state.healing, { ...healing, health: 6.3 });
  assert.deepEqual(state.riskNow, riskNow);
  // The run clock whole: Jev turns on it more than on any other record.
  assert.deepEqual(state.runClock.minutesBy, { a: 7, b: 24, c: 10, d: 6, e: 1 });
  // What every death does is not said with each; nothing is not said.
  assert.deepEqual(state.deathWouldCost, { dropsWorn: ['iron helmet'], otherStacks: 24, levelsLost: 12 });
  // A place held is said once, with its looks.
  assert.deepEqual(state.recentPositions.places, [{ secondsAgo: 60, x: 1, y: 60, z: 1, doing: 'pillar_hold', looks: 2 }, { secondsAgo: 30, x: 5, y: 60, z: 1, doing: 'fight' }]);
  // The same words twice in a list are said once, with how often.
  assert.deepEqual(state.whatFailedBelow, ['fortress leg: every way rests (2 times)', 'step: no path']);
  assert.equal('nothing' in state, false);
  // A record of an unknown shape goes as it came.
  assert.deepEqual(lean.leanState({ runClock: 'said already' }), { runClock: 'said already' });
});

test('what followed each kind of answer in the past fights goes out as the rows for this situation; the record by health goes whole', () => {
  const played = 'In the trials, 415 fights with blazes: 19% ended in a death. Begun at the health this bot has, the row is 8 to 16 health: 82 fights, 24% died.';
  const answers = 'In this situation (a live blaze spawner within 16), what followed each kind of answer: a strike: 12 fights, 2 took a rod after it (17%), 6 died after it (50%); cover: 77 fights, 3%, 19%. How the rods came, of the 61 fights that ended with a rod: 56 had a strike in them. A spawner makes up to four at a time.';
  const state = lean.leanState({ playedRecord: played, playedAnswers: answers });
  assert.equal(state.playedRecord, played);
  // The rows for this situation, and what the rest says that is not a count.
  assert.equal(state.playedAnswers, 'In this situation (a live blaze spawner within 16), what followed each kind of answer: a strike: 12 fights, 2 took a rod after it (17%), 6 died after it (50%); cover: 77 fights, 3%, 19%. A spawner makes up to four at a time.');
});

test('every option\'s words go as they were built, the same sentence in each included (note 672)', () => {
  const walled = 'Walled here toward the push: a fireball that lands costs its 3.4 damage and a push into the wall, not the fall.';
  const criteria = { fight: `Fight here. ${walled}`, retreat: `Back off eight blocks. ${walled}`, take_cover: `Take cover. ${walled}`, none_good: 'None of these options are good.' };
  const req = { state: {}, questions: { branch_0: { type: 'choice', instructions: { task: 'Choose.', guidance: 'Weigh the mobs.' }, criteria } } };
  const sent = lean.leanRequest(req);
  assert.deepEqual(sent.questions.branch_0.criteria, criteria);
  assert.deepEqual(sent.questions.branch_0.instructions, req.questions.branch_0.instructions);
});

test('the request is sent lean by the client, and as built with JEV_LEAN=0; numbers go to a tenth', () => {
  const req = { state: { health: 19.599998474121094, estimate: { mobs: [{ distance: 7.863793732339518 }] } }, questions: { branch_0: { type: 'choice', instructions: { task: 'x' }, criteria: { a: { does: 'A', facts: { health: 4.800000190734863 } }, b: 'B' } } } };
  const sent = lean.leanRequest(req);
  assert.equal(sent.state.health, 19.6);
  assert.equal(sent.state.estimate.mobs[0].distance, 7.9);
  assert.equal(sent.questions.branch_0.criteria.a.facts.health, 4.8);
  const env = process.env.JEV_LEAN;
  process.env.JEV_LEAN = '0';
  try { assert.equal(lean.leanRequest(req), req); } finally { if (env === undefined) delete process.env.JEV_LEAN; else process.env.JEV_LEAN = env; }
});

// Every replay case, asked as it is asked, comes to no more than its
// question's ceiling as sent: a builder or a gloss grown past it fails here.
test('no recorded question comes to more than its ceiling as sent (note 672)', async () => {
  const cases = fs.readFileSync(path.join(__dirname, '..', 'evals', 'replays', 'cases.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const over = [];
  const log = console.log; console.log = () => {};
  try {
    for (const c of cases) {
      let sent = null;
      const client = { model: 'x', systemOne: async req => {
        sent = JSON.stringify(lean.leanRequest(req)).length;
        return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) };
      } };
      await decide(c.question, { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(c.tree)), state: c.state });
      assert.ok(sent, `${c.name} was asked`);
      if (sent > lean.ceilingOf(c.question)) over.push(`${c.name} (${c.question}): ${sent} characters, over ${lean.ceilingOf(c.question)}`);
    }
  } finally { console.log = log; }
  assert.deepEqual(over, []);
  // A question not named has the cap.
  assert.equal(lean.ceilingOf('a_new_question'), lean.CAP);
});
