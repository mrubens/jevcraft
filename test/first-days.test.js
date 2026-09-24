'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { milestones } = require('../scripts/first-days');

test('the first-days milestones: iron tools, iron armour worn, a shield, a bed and a home', () => {
  const snapshot = { inventory: { iron_pickaxe: 1, diamond_sword: 1 }, equipment: { head: 'iron_helmet', torso: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots', offhand: 'shield' } };
  const state = { survival: { home: { bed: { claimedAt: 'x' }, stash: { position: { x: 0, y: 0, z: 0 } } } }, gameProgress: { phase: 'golden_boots' } };
  const m = milestones(snapshot, state);
  assert.equal(m.iron_pickaxe, true); assert.equal(m.iron_sword, true); assert.equal(m.shield, true); assert.equal(m.bed, true); assert.equal(m.home, true);
  assert.equal(m.iron_armour, false, 'golden boots are not iron armour');
  snapshot.inventory.iron_boots = 1;
  assert.equal(milestones(snapshot, state).iron_armour, false, 'carried and not worn: three pieces worn');
  snapshot.equipment.feet = 'iron_boots';
  assert.equal(milestones(snapshot, state).iron_armour, true);
  assert.equal(milestones({ inventory: {}, equipment: {} }, {}).home, false);
});
