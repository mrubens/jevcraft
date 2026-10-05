'use strict';
// Note 1289: with no pickaxe, the dig to the End portal's ring by hand or a
// pickaxe made first is Jev's choice, not a precondition. 25597 (2026-10-05
// 07:23 to 07:55Z), twelve eyes in the pack sixty blocks from its ring, was
// sent for wood it had no route to for half an hour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

function bot() {
  return { entity: { position: new Vec3(1883.5, 64, -367.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 17,
    inventory: { items: () => [{ name: 'ender_eye', count: 12 }, { name: 'cobblestone', count: 37 }] }, entities: {}, time: { timeOfDay: 1000 } };
}

test('no pickaxe at the portal\'s dig: by hand and pickaxe first are asked, with the dig and the eyes said; by hand digs on; the answer holds here', async () => {
  const { portalPickaxeFirst } = require('../src/work');
  let asked = null, asks = 0;
  const client = { systemOne: async req => { asks++; asked = JSON.stringify(req); return { answers: { branch_0: { choice: 'by_hand', confidence: 0.8, probabilities: { by_hand: 0.8, pickaxe_first: 0.2 } } } }; } };
  const goal = { endPortal: { center: { x: 1878, y: 32, z: -294 } } };
  const b = bot();
  const first = await portalPickaxeFirst(b, { opportunityClient: client, check() {} }, goal, () => {}, new Vec3(1878, 33, -294));
  assert.equal(first, false, 'by hand: no pickaxe first');
  assert.match(asked, /Dig the way to the ring by hand: 74 blocks across and 31 down, about \d+ blocks dug/);
  assert.match(asked, /The 12 eyes go with the bot/);
  assert.match(asked, /Make a stone pickaxe first/);
  assert.equal(goal.portalDig.pick, 'by_hand');
  assert.equal(await portalPickaxeFirst(b, { opportunityClient: client, check() {} }, goal, () => {}, new Vec3(1878, 33, -294)), false);
  assert.equal(asks, 1, 'not asked again from here');
});
