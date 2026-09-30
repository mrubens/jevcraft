'use strict';
// Note 734 (critic-20260930T0755Z item 1): 25597 (mid-242-tf) chose leg
// after leg at 13.5 health and hunger 17 with nothing carried to eat, none
// of that said anywhere in the fortress_leg question (only the height
// fortresses stand at and the blocks carried). fortress_leg's state now
// carries a `fitness` fact, health and food carried in words (as
// hunt_target's fitnessSays already does), and under the fight floor (14
// health) the played record's row for fights begun this hurt (blaze-
// record.js rowSays), since the search is toward those fights.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

function world(position, open, { health = 20, food = 20, items = [] } = {}) {
  const at = p => {
    const q = p.floored ? p.floored() : p;
    const name = open(q) ? 'air' : 'netherrack';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 };
  };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health, food, entity: { position }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => items, slots: [] }, findBlocks: () => [], chat() {}, blockAt: at };
}

test('fortress_leg states health and food carried when either is short of full, and the played record\'s row under the fight floor (note 734)', async () => {
  const { chooseLeg } = require('../src/mob-hunt');
  const open = p => p.y >= 57 && p.y <= 75 && Math.abs(p.x) <= 300 && Math.abs(p.z) <= 300;
  const bot = world(new Vec3(0.5, 57, 0.5), open, { health: 13.5, food: 17, items: [] });
  const state = { legs: 2, origin: { x: 0, z: 0 } };
  const goal = { kind: 'win', fortressSearch: state };
  const asked = [];
  const client = { systemOne: async ({ state: s }) => { asked.push(s); return { answers: { branch_0: { choice: 'leg_north', confidence: 0.9 } } }; } };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  const facts = asked[0];
  assert.ok(facts.fitness, 'a fitness fact is said');
  assert.match(facts.fitness, /^Health 13\.5 \(under the 14 the code once required to start a fight\)/);
  assert.match(facts.fitness, /nothing is carried to eat: every point lost is gone for good/);
  // Under the fight floor: the played record's row for fights begun this
  // hurt (blaze-record.js rowSays), honestly labelled as fights, not legs.
  assert.match(facts.fitness, /at health 13\.5: .* fights begun there, \d+% died/);
});

test('fortress_leg says nothing extra at full health and hunger (no fitness fact)', async () => {
  const { chooseLeg } = require('../src/mob-hunt');
  const open = p => p.y >= 57 && p.y <= 75 && Math.abs(p.x) <= 300 && Math.abs(p.z) <= 300;
  const bot = world(new Vec3(0.5, 57, 0.5), open, { health: 20, food: 20, items: [] });
  const state = { legs: 2, origin: { x: 0, z: 0 } };
  const goal = { kind: 'win', fortressSearch: state };
  const asked = [];
  const client = { systemOne: async ({ state: s }) => { asked.push(s); return { answers: { branch_0: { choice: 'leg_north', confidence: 0.9 } } }; } };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  assert.equal(asked[0].fitness, undefined);
});
