'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { endDecisionState } = require('../src/decisions/end-state');
test('combat facts distinguish actual healing, arrow immunity and unresolved crystal evidence', () => {
  const context = { request: 'Win', health: 20, food: 20, arrows: 64, position: { x: 0, y: 64, z: 0 }, safe: true,
    dragon: { phase: 0, health: 175.5 }, crystals: [], combat: { noProgress: 4, shots: [], knownCrystals: {
      a: { status: 'destroyed' }, b: { status: 'absent_on_revisit' }, c: { status: 'unresolved', position: { x: 40, y: 100, z: 0 } },
    } } };
  const state = endDecisionState(context);
  assert.equal(state.survival.naturalRegenerationPossible, false);
  assert.equal(state.dragon.phaseName, 'circling'); assert.equal(state.dragon.arrowsDeflected, false);
  assert.deepEqual(state.crystalEvidence, { observed: 0, confirmedExplosions: 1, absentOnLoadedRevisit: 1 });
  assert.equal(state.unresolvedCrystalLocations.length, 1);
  context.dragon.phase = 5; context.health = 8;
  const injured = endDecisionState(context);
  assert.equal(injured.dragon.arrowsDeflected, true); assert.equal(injured.survival.needsHealing, true);
  assert.equal(injured.survival.naturalRegenerationPossible, true);
});
