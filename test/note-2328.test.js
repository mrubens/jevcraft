'use strict';
// Iron past the rule's four blocks is offered to Jev, said by what is carried and what the plan wants (note 2328).
const test = require('node:test');
const assert = require('node:assert/strict');

test('an iron ore 6 blocks off the walk is said with the iron carried, the detour, and the surplus it makes', () => {
  const { passingOreSays } = require('../src/opportunistic-mining');
  const bot = { inventory: { items: () => [{ name: 'raw_iron', count: 5 }, { name: 'iron_ingot', count: 3 }] }, entity: { position: { x: 0, y: 64, z: 0 } }, blockAt: () => null };
  const says = passingOreSays(bot, { block: 'iron_ore', distance: 6.2, routeSteps: 7 }, { kind: 'win' });
  assert.match(says, /^iron ore 6 blocks from the walk, 7 walking steps: a detour of about \d+ s there and back with the dig, then the same walk goes on\. It drops one raw iron; 8 carried/);
  assert.match(passingOreSays(bot, { block: 'deepslate_diamond_ore', distance: 7, routeSteps: 9 }, {}), /It drops one diamond \(three make a diamond pickaxe, which mines obsidian\); 0 carried\.$/);
});
