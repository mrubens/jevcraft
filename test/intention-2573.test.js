'use strict';
// Note 2573: a portal plan's way that failed since it was chosen ends the intention, so the plan asked again offers every way.
const test = require('node:test');
const assert = require('node:assert');

test('a portal_plan intention ends when its way fails after it was chosen, and holds before', () => {
  const { holding } = require('../src/intention');
  const now = Date.now();
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const goal = { intention: { q: 'portal_plan', choice: 'beside_sight', path: 'beside_sight', trip: true, target: { x: 40, y: 64, z: 0 }, at: now - 60000, dimension: 'overworld', diamondPickaxe: false },
    portalPlanFailures: [{ key: 'beside_sight', why: 'an older failure', at: now - 120000 }] };
  assert.ok(holding(bot, goal, now), 'a failure from before it was chosen does not end it');
  goal.portalPlanFailures.push({ key: 'beside_sight', why: 'a stall on detour: No path to the goal!', at: now - 1000 });
  assert.equal(holding(bot, goal, now), null);
  assert.match(goal.intentionEnded.why, /^failed: a stall on detour: No path to the goal!/);
});
