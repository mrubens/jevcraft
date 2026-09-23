'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { statusMessage } = require('../src/status');
const { completion, friendlyProblem } = require('../src/speech');
const bot = { health: 18, food: 16 };

test('chat explains a blocked request simply while preserving the detailed saved error', () => {
  const saved = { status: 'blocked', request: 'Jev get me one bedrock', lastError: 'No supported survival acquisition method for bedrock' };
  const before = JSON.stringify(saved);
  const text = statusMessage(bot, { idle: true, goal: { survivalAction: { action: 'cook_food' } } }, saved);
  assert.match(text, /don't know a way to get that in Survival/);
  assert.match(text, /cooking food/); assert.doesNotMatch(text, /acquisition|cook_food|Health 18/);
  assert.equal(JSON.stringify(saved), before);
});

test('active work is explained instead of showing an older request or raw decision paths', () => {
  const text = statusMessage(bot, { goal: { status: 'running', request: 'Jev come here', step: { action: 'come' }, decisions: [{ path: ['technical_node'] }] } },
    { status: 'blocked', request: 'old bedrock request' });
  assert.match(text, /coming to you/); assert.doesNotMatch(text, /bedrock|technical_node|running:/);
});

test('completion, cancellation and thinking have distinct simple messages', () => {
  assert.match(statusMessage(bot, null, { status: 'complete' }), /finished/);
  assert.match(statusMessage(bot, null, { status: 'cancelled' }), /stopped/);
  const text = statusMessage(bot, { goal: { status: 'running', recoveryAdvice: { active: true }, lastError: 'Fable diagnosis' } });
  assert.match(text, /need to think/); assert.doesNotMatch(text, /Fable/);
  assert.match(statusMessage(bot, null, null), /ready/);
});

test('combined progress tells the player how many things are done and what comes next', () => {
  const goal = { kind: 'bundle', status: 'running', tasks: [{ item: 'diamond_helmet', count: 1, status: 'complete' }, { item: 'white_bed', count: 1 }],
    step: { action: 'combined_request', detail: { action: 'craft', item: 'white_bed' } } };
  const text = statusMessage(bot, { goal });
  assert.match(text, /making white bed/); assert.match(text, /1 of 2 things done/); assert.doesNotMatch(text, /white_bed|combined_request/);
  assert.doesNotMatch(completion({ kind: 'obtain', item: 'diamond_helmet', count: 1, deliver: true }), /verified|inventory|pickup confirmed|_/);
  assert.doesNotMatch(friendlyProblem('TypeSafe 500 backend_error'), /TypeSafe|backend|500/);
});

test('a plan the world outgrew asks for a new build instead of an endless resume', () => {
  const { recoveryHint } = require('../src/speech');
  // Terrain prep, mid-build and per-placement all report this the same way.
  for (const detail of ['The building site changed at (-36, 67, 8); preserving the unexpected grass_block. Clear it or request a new build',
    'Building site changed at (2, 64, 0)']) {
    const saved = { status: 'blocked', request: 'Jev build a barn', lastError: detail };
    const text = statusMessage(bot, null, saved);
    assert.match(text, /no longer fits/);
    assert.match(text, /build it again/);
    assert.doesNotMatch(text, /Jev resume/, 'resume repeats the same failure forever');
    assert.doesNotMatch(text, /preserving|\(-?\d/, 'coordinates stay in the saved error');
  }
  // Anything retryable keeps the ordinary invitation to resume.
  const stuck = { status: 'blocked', request: 'Jev get me oak', lastError: 'No reachable surveyed ground while searching for oak_log' };
  assert.match(statusMessage(bot, null, stuck), /Jev resume/);
  assert.equal(recoveryHint(undefined), 'Say "Jev resume" to try again.');
});

test('a long think is an uneven fidget, not a metronome or a frozen bot', t => {
  const { thinking } = require('../src/speech');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const swings = [], looks = [];
  const bot = { swingArm: arm => swings.push(arm), look: (yaw, pitch) => looks.push([yaw, pitch]),
    entity: { yaw: 1, pitch: 0, position: new Vec3(0, 64, 0) } };
  const stop = thinking(bot, 1500);
  assert.deepEqual(swings, ['right'], 'the first swing is immediate, not an interval late');

  // Six beats at half the nominal interval: the arm rests on every third one,
  // so the rhythm reads as thought rather than as a stuck animation.
  for (let i = 0; i < 6; i++) t.mock.timers.tick(750);
  assert.equal(swings.length, 5, 'four of six beats swing, plus the opening one');
  assert(looks.length >= 5, 'and Jev glances about while it ponders');
  assert(new Set(looks.map(([yaw]) => yaw)).size > 1, 'the head moves rather than locking to one angle');

  stop();
  assert.deepEqual(looks.at(-1), [1, 0], 'a think hands back the direction it borrowed');
  const after = swings.length;
  t.mock.timers.tick(9000);
  assert.equal(swings.length, after, 'the emote ends with the work it was covering');
});

test('the thinking emote never becomes a reason for the work it covers to fail', t => {
  const { thinking } = require('../src/speech');
  t.mock.timers.enable({ apis: ['setInterval'] });
  assert.doesNotThrow(() => thinking({ swingArm: () => { throw new Error('socket closed'); } })());
  assert.doesNotThrow(() => thinking({})());
  assert.doesNotThrow(() => thinking(null)());
  // A bot that is walking keeps its head: the navigator is aiming it.
  const looks = [];
  const moving = { swingArm: () => {}, look: (...a) => looks.push(a),
    entity: { yaw: 0, pitch: 0, position: new Vec3(0, 64, 0) } };
  const stop = thinking(moving, 1500);
  for (let i = 0; i < 4; i++) { moving.entity.position = moving.entity.position.offset(1, 0, 0); t.mock.timers.tick(750); }
  stop();
  assert.equal(looks.filter(([yaw]) => yaw !== 0).length, 0, 'no glancing about while under way');
});

test('finishing a change to a standing building is not announced as a new one', () => {
  const { completion } = require('../src/speech');
  assert.equal(completion({ kind: 'build' }), 'The building is done! I checked it for missing blocks.');
  assert.equal(completion({ kind: 'build', buildContinuation: { mode: 'edit', name: 'Stone Watchtower' } }),
    'Stone Watchtower is changed, and I checked it over for missing blocks.');
  // Finishing or repairing really does end with a finished building.
  assert.equal(completion({ kind: 'build', buildContinuation: { mode: 'finish', name: 'Stone Watchtower' } }),
    'The building is done! I checked it for missing blocks.');
});

test('a request that fails at intake says why, and an outage is not a request to rephrase', () => {
  const { intakeProblem } = require('../src/speech');
  const clarify = Object.assign(new Error('I need a more specific target for that command.'), { name: 'CommandClarification' });
  assert.equal(intakeProblem(clarify), clarify.message);
  assert.match(intakeProblem(new Error('Please request at most 16 different items')), /at most 16/);
  assert.match(intakeProblem(Object.assign(new Error('503 Service Unavailable'), { name: 'TypeSafeError' })), /trouble thinking/);
  assert.match(intakeProblem(new Error('Jev selected an unavailable option')), /another way/);
});

test('an error that lists lapis lazuli is not an outage: "lapis" is not "API"', () => {
  const { friendlyProblem } = require('../src/speech');
  assert.doesNotMatch(friendlyProblem(new Error('No measurable progress on {"items":[{"item":"lapis_lazuli","count":64}]}')), /trouble thinking/);
  assert.match(friendlyProblem(new Error('TypeSafe request timed out')), /trouble thinking/);
});
