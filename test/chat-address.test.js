'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAddress } = require('../src/chat-address');
const { interpret } = require('../src/objectives');

test('Jev addresses any bot identity with spaces, commas, or colons', () => {
  for (const request of ['Jev stop', 'jev, stop', ' JEV:stop ', 'Trial123 stop']) {
    assert.deepEqual(parseAddress(request, 'Trial123'), { explicit: true, text: 'stop' });
  }
  assert(!parseAddress('Jevon stop', 'JevBot').explicit);
  assert(!parseAddress('tell Jev to stop', 'JevBot').explicit);
  assert.deepEqual(parseAddress('JevBot build a house', 'JevBot'), { explicit: true, text: 'build a house' });
});

test('an explicit Jev prefix determines the addressee while Jev interprets the task', async () => {
  const client = { systemOne: async ({ state }) => {
    assert.deepEqual(state.bot_names, ['JevBot', 'Jev']);
    assert(state.explicitly_addressed);
    return { answers: { addressed: { noul: 0.1 }, objective: { choice: 'house' }, material: { choice: 'oak_planks' } } };
  } };
  const result = await interpret(client, 'Jev build a house', 'Player', 'JevBot');
  assert.equal(result.kind, 'house');
  assert.equal(result.material, 'oak_planks');
});
