'use strict';
// Note 693: "none of these is good" changes what is asked next. 25581 at
// 21:36Z on 2026-09-29: hunt_target none good 0.36 on top, then defer (0.32)
// taken with a blaze five blocks off at full health, sword and shield
// carried, and the same options asked again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');

function withNoneGood(t) {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-693-')), 'missing.jsonl');
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = log;
  t.after(() => {
    if (env.NONE === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env.NONE;
    if (env.LOG === undefined) delete process.env.JEV_MISSING_OPTIONS; else process.env.JEV_MISSING_OPTIONS = env.LOG;
  });
  return log;
}
const netherBot = () => ({ entity: { position: new Vec3(900.5, 41, 73.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 18, entities: {}, _stalls: { records: {}, marks: [] } });
const answers = (probabilities, seen = []) => ({ systemOne: async ({ state, questions }) => {
  seen.push({ state, criteria: questions.branch_0.criteria });
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return { answers: { branch_0: { choice, confidence: 0.5, probabilities } } };
} });

test('the least bad is said as such; asked again from here with nothing come of it, the same options are not asked: it is held and the question above is asked with the none good said', async t => {
  const log = withNoneGood(t);
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'obtain_blaze_rods' } };
  const tree = () => ({ hunt_2066: { description: 'Fight the blaze 5 blocks off.' }, back_to_wall: { description: 'Take it from footing with a wall behind.' }, defer: { description: 'Leave them for now.' } });
  const seen = [];
  const client = answers({ none_good: 0.36, defer: 0.32, hunt_2066: 0.22, back_to_wall: 0.1 }, seen);
  const d = await decide('hunt_target', { client, bot, goal, tree: tree(), state: { blazes: 1 } });
  assert.deepEqual(d.path, ['defer']);
  assert.equal(d.noneGood, true);
  const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
  assert.deepEqual(entry.tookInstead, ['defer'], 'recorded as a missing move');
  // Asked again with the same options from the same place, nothing come of the defer.
  await assert.rejects(decide('hunt_target', { client, bot, goal, tree: tree(), state: { blazes: 1 } }), err => err.name === 'Stalled');
  assert.equal(seen.length, 1, 'the same set is not asked a second time');
  const esc = bot._stalls.stall?.escalated;
  assert.equal(esc?.from, 'hunt_target'); assert.equal(esc?.to, 'rung_progress');
  assert.match(esc.says, /Jev said none of these options was good \(none good 0\.36\); defer was taken as the least bad, and nothing came of it/);
  // The least bad rests from here, said: the next asking of this question leaves it out.
  const held = goal.tried.entries.find(e => e.q === 'hunt_target' && e.method === 'defer' && e.held);
  assert.ok(held, 'defer held from here');
  const after = [];
  await decide('hunt_target', { client: answers({ hunt_2066: 0.6, back_to_wall: 0.2, defer: 0.2 }, after), bot, goal, tree: tree(), state: { blazes: 1 } });
  assert.deepEqual(Object.keys(after[0].criteria).filter(k => k !== 'none_good').sort(), ['back_to_wall', 'hunt_2066']);
});

test('with something come of the least bad the question is asked, told of it in its facts and on the option', async t => {
  withNoneGood(t);
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'obtain_blaze_rods' } };
  const tree = () => ({ hunt_2066: { description: 'Fight the blaze.' }, defer: { description: 'Leave them for now.' } });
  const seen = [];
  const client = answers({ none_good: 0.4, defer: 0.35, hunt_2066: 0.25 }, seen);
  await decide('hunt_target', { client, bot, goal, tree: tree(), state: {} });
  bot.health = 12; // a blow's worth and more lost since: a change
  await decide('hunt_target', { client, bot, goal, tree: tree(), state: {} });
  assert.equal(seen.length, 2);
  assert.match(seen[1].state.leastBadLast, /Jev said none of these options was good \(none good 0\.4\); defer was taken as the least bad, and since then: health 20 to 12/);
  const said = JSON.stringify(seen[1].criteria.defer);
  assert.match(said, /Taken as the least bad \d+ seconds? ago: Jev said none of these was good, and since then: health 20 to 12\./);
  assert.doesNotMatch(JSON.stringify(seen[1].criteria.hunt_2066), /least bad/);
});

test('with no question above, a wait or keep-on taken as the least bad twice running with nothing changed is not taken so a third time: the best other is, and said', async t => {
  const log = withNoneGood(t);
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  // The shooter's warning: no question above it, and no ledger resting its answers.
  const tree = () => ({ shield_up: { description: 'Raise the shield.' }, behind_cover: { description: 'Behind the pillar.' }, keep_on: { description: 'Keep on.' } });
  const seen = [];
  const client = answers({ none_good: 0.45, keep_on: 0.3, behind_cover: 0.15, shield_up: 0.1 }, seen);
  const took = [];
  for (let i = 0; i < 3; i++) took.push((await decide('shot_answer', { client, bot, goal, tree: tree(), state: {} })).path.join('/'));
  assert.equal(seen.length, 3, 'asked each time: no question above it');
  assert.deepEqual(took, ['keep_on', 'keep_on', 'behind_cover']);
  assert.match(seen[2].state.leastBadLast, /keep on was taken as the least bad, 2 times running from here/);
  const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
  assert.equal(entry.passedOver, 'keep on had been taken as the least bad 2 times running with nothing changed (a wait or keep-on is taken so at most 2 times running); behind cover, the best other listed, was taken');
  assert.equal(goal.decisions.at(-1).passedOver, entry.passedOver);
  // Jev choosing a listed option ends it.
  await decide('shot_answer', { client: answers({ shield_up: 0.7, keep_on: 0.3 }), bot, goal, tree: tree(), state: {} });
  assert.equal(bot._leastBad.shot_answer, undefined);
});

test('with no question above and a ledger, the least bad that came to nothing twice rests from here as any way does, its none good said', async t => {
  withNoneGood(t);
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const tree = () => ({ fetch_stems: { description: 'Fetch stems.' }, spare_pickaxe: { description: 'Make a spare.' }, carry_on: { description: 'Carry on.' } });
  const seen = [];
  const client = answers({ none_good: 0.45, carry_on: 0.3, fetch_stems: 0.15, spare_pickaxe: 0.1 }, seen);
  const took = [];
  for (let i = 0; i < 3; i++) took.push((await decide('upkeep', { client, bot, goal, tree: tree(), state: {} })).path.join('/'));
  assert.deepEqual(took, ['carry_on', 'carry_on', 'fetch_stems']);
  assert.match(seen[1].state.leastBadLast, /carry on was taken as the least bad, and nothing came of it/);
  assert.match(seen[2].state.leastBadLast, /carry on was taken as the least bad, 2 times running from here/);
  assert.equal(seen[2].criteria.carry_on, undefined, 'resting from here');
});

test('the stance keeps its own rules (notes 659, 691); the least bad begins no intention', async t => {
  withNoneGood(t);
  const { decide } = require('../src/decisions');
  const bot = netherBot();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  await decide('encounter_stance', { client: answers({ none_good: 0.5, fight: 0.3, retreat: 0.2 }), bot, goal, tree: { fight: { description: 'a' }, retreat: { description: 'b' } }, state: {} });
  assert.equal(bot._leastBad?.encounter_stance, undefined);
  const d = await decide('nether_gather', { client: answers({ none_good: 0.47, leg_east: 0.3, without: 0.23 }), bot, goal, tree: { leg_east: { description: 'A leg east.' }, without: { description: 'Go on without.' } }, state: {} });
  assert.deepEqual(d.path, ['leg_east']);
  assert.equal(goal.intention, undefined, 'a leg taken as the least bad is not the bot\'s intention');
});
