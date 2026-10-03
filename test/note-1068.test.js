'use strict';
// Note 1068: the climb to the surface says the night up there: the minutes
// to dawn, the surface's record by night, and the bot as it comes out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nightUpSays } = require('../src/work');
const { DAY } = require('../src/day');

const bot = (timeOfDay, { items = [], worn = {}, dimension = 'overworld' } = {}) => ({ game: { dimension }, time: { timeOfDay },
  inventory: { items: () => items.map(name => ({ name, count: 1 })), slots: Object.fromEntries(Object.entries(worn).map(([k, name]) => [k, { name }])) } });

test('at night the climb says the minutes to dawn, the bot bare as it is, and the surface\'s record; the ways that stay below say the night is up there', () => {
  const n = nightUpSays(bot(DAY.DAWN - 6000));
  assert.match(n.climb, /It is night up there, about 5 real minutes to dawn: mobs spawn in the open until then, and the zombies and skeletons out at dawn burn in the sun\. The bot comes out with bare hands, nothing worn and no shield\./);
  assert.match(n.climb, /The record \(.*keeping on with the work .* at night.* deaths an hour/);
  assert.match(n.below, /Up there it is night for about 5 real minutes more; this keeps the bot under the rock meanwhile\./);
  const kitted = nightUpSays(bot(DAY.DAWN - 1200, { items: ['iron_sword', 'shield'], worn: { 5: 'iron_helmet', 6: 'iron_chestplate' } }));
  assert.match(kitted.climb, /about 1 real minute to dawn.*The bot comes out with iron sword, iron helmet, iron chestplate and a shield\./);
});

test('by day, or off the Overworld, nothing is added', () => {
  assert.equal(nightUpSays(bot(6000)), null);
  assert.equal(nightUpSays(bot(DAY.DAWN - 6000, { dimension: 'the_nether' })), null);
});

// The question itself, 20 blocks under the grass at night, nothing else on offer.
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
function under(timeOfDay) {
  const inv = [['stone_pickaxe', 1]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id, durabilityUsed: 0 }));
  return Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 20, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, said: [], time: { timeOfDay },
    entity: { position: new Vec3(16.5, 48, 60.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => inv, slots: [] }, chat(m) { this.said.push(m); },
    blockAt: p => ({ position: p, name: p.y > 68 ? 'air' : 'stone', boundingBox: p.y > 68 ? 'empty' : 'block' }) });
}

test('at night with only the climb on offer the question is asked, with the wait for dawn beside it; chosen, it holds while it is night', async () => {
  const { surfaceTrip } = require('../src/work');
  const bot = under(DAY.DAWN - 3600), goal = { kind: 'win', gameProgress: { phase: 'bed' } };
  let asked = 0, tree;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { asked++; tree = questions; return { answers: { branch_0: { choice: 'wait_for_dawn', confidence: 0.7 } } }; } } };
  await surfaceTrip(bot, task, goal, () => {}, 'wool');
  assert.equal(asked, 1);
  assert.match(tree.branch_0.criteria.wait_for_dawn, /Wait under the rock here for the dawn, about 3 real minutes, and make the climb for wool then, by day/);
  assert.match(tree.branch_0.criteria.climb, /It is night up there, about 3 real minutes to dawn/);
  assert.equal(goal.step.action, 'wait_for_dawn');
  assert.match(bot.said.join(' '), /I'll wait down here for morning before I climb up for wool/);
  // Held: the next pass waits and asks nothing.
  await surfaceTrip(bot, task, goal, () => {}, 'wool');
  assert.equal(asked, 1);
  // By day the wait has ended and the climb is its own again (asked or made as before).
  bot.time.timeOfDay = 1000;
  assert.equal(nightUpSays(bot), null);
});

test('with the dawn under a minute off the climb says so, and the wait is not offered', async () => {
  const n = nightUpSays(bot(DAY.DAWN - 300));
  assert.match(n.climb, /It is night up there, under a minute to dawn/);
  const { surfaceTrip } = require('../src/work');
  const b = under(DAY.DAWN - 300), goal = { kind: 'win', gameProgress: { phase: 'bed' } };
  let tree = null;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions }) => { tree = questions; return { answers: { branch_0: { choice: 'climb', confidence: 0.7 } } }; } } };
  await surfaceTrip(b, task, goal, () => {}, 'wool').catch(() => {});
  assert.equal(tree?.branch_0?.criteria?.wait_for_dawn, undefined);
});
