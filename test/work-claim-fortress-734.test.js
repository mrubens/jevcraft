'use strict';
// Note 734 (critic-20260930T0817Z item 2, 25592): sealed three blocks from
// a fortress's bricks, turn_priority's work option went on saying "find
// fortress" as if none were known, while the survival option said the wait
// waited for nothing. workClaim's `doing` now names the fortress in reach
// (its coordinates and distance) when find_fortress's own step carries one
// (`found` or `fortress`), and says plain "find fortress" when it does not
// or the bot is already walking its floors (`walking`).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { workClaim } = require('../src/work');

const bot = at => ({ entity: { position: at } });

test('the work claim names the fortress in reach when find_fortress has one', () => {
  const goal = { request: 'beat the game', step: { action: 'find_fortress', found: { x: -174, y: 38, z: 148 }, legs: 5 } };
  const claim = workClaim(goal, bot(new Vec3(-174, 38, 151)));
  assert.match(claim.facts.doing, /^find fortress \(a fortress in reach at \(-174, 38, 148\), 3 blocks off\)/);
});

test('the work claim stays plain "find fortress" with none in reach, or once the bot is walking its floors', () => {
  const goal1 = { request: 'beat the game', step: { action: 'find_fortress', legs: 5 } };
  assert.equal(workClaim(goal1, bot(new Vec3(0, 60, 0))).facts.doing, 'find fortress');
  const goal2 = { request: 'beat the game', step: { action: 'find_fortress', found: { x: 10, y: 60, z: 10 }, walking: { x: 10, y: 60, z: 10 }, legs: 5 } };
  assert.equal(workClaim(goal2, bot(new Vec3(9, 60, 9))).facts.doing, 'find fortress');
});
