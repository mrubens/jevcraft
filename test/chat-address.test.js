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
    return { answers: { addressed: { noul: 0.1 }, interaction: { choice: 'request' }, objective: { choice: 'house' }, material: { choice: 'oak_planks' } } };
  } };
  const result = await interpret(client, 'Jev build a house', 'Player', 'JevBot');
  assert.equal(result.kind, 'house');
  assert.equal(result.material, 'oak_planks');
});

test('a direct name prefix does not turn an informational topic into an action', async () => {
  const client = { systemOne: async () => ({ answers: { addressed: { noul: 1 },
    interaction: { choice: 'discussion' }, objective: { choice: 'win' } } }) };
  const result = await interpret(client, 'Jev how do you beat Minecraft?', 'Player', 'JevBot');
  assert.equal(result.kind, 'other');
  assert.equal(result.interpretation.objective.choice, 'win', 'Retain the raw judgments for diagnosis');
});

test('a missing or unoffered interaction judgment never dispatches a gameplay action', async () => {
  for (const interaction of [undefined, { choice: 'unknown' }]) {
    const client = { systemOne: async () => ({ answers: { addressed: { noul: 1 },
      interaction, objective: { choice: 'win' } } }) };
    await assert.rejects(interpret(client, 'Jev beat Minecraft', 'Player', 'JevBot'), /Invalid Jev interpretation/);
  }
});

test('a reply to Jev\'s question is read with the request it answers', () => {
  const { clarificationReply, parseAddress } = require('../src/chat-address');
  const asked = { request: 'get me 10 grass', options: ['short_grass', 'grass_block'], until: Date.now() + 60000 };
  assert.equal(clarificationReply(asked, parseAddress('grass block', 'Jev')), 'get me 10 grass (grass block)');
  assert.equal(clarificationReply(asked, parseAddress('Jev grass block.', 'Jev')), 'get me 10 grass (grass block)', 'addressed, naming an option');
  assert.equal(clarificationReply(asked, parseAddress('Jev build me a tower', 'Jev')), null, 'addressed and not an option is a new request');
  assert.equal(clarificationReply(asked, parseAddress('did you see the sunset over the mountains earlier today', 'Jev')), null, 'long talk is not an answer');
  assert.equal(clarificationReply({ ...asked, until: Date.now() - 1 }, parseAddress('grass block', 'Jev')), null, 'the question has closed');
});
