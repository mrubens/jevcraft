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

test('a reply to Jev\'s question is read with the request it answers, and only a reply that can only be an answer', () => {
  const { clarificationReply, parseAddress } = require('../src/chat-address');
  const asked = { request: 'get me 10 grass', options: ['short_grass', 'grass_block'], which: true, until: Date.now() + 60000 };
  const known = text => ['grass block', 'short grass', 'oak log'].includes(text.toLowerCase());
  assert.equal(clarificationReply(asked, parseAddress('grass block', 'Jev'), { known }), 'get me 10 grass (grass block)');
  assert.equal(clarificationReply(asked, parseAddress('Jev grass block.', 'Jev'), { known }), 'get me 10 grass (grass block)', 'addressed, naming an option');
  assert.equal(clarificationReply(asked, parseAddress('Jev build me a tower', 'Jev'), { known }), null, 'addressed and not an option is a new request');
  for (const talk of ['brb', 'lol no', 'ok', 'did you see that']) assert.equal(clarificationReply(asked, parseAddress(talk, 'Jev'), { known }), null, `"${talk}" is talk, not an answer`);
  assert.equal(clarificationReply({ ...asked, options: [] }, parseAddress('oak log', 'Jev'), { known }), 'get me 10 grass (oak log)', 'a thing named exactly, when the question was which');
  const confirm = { request: 'beat the game', confirm: true, until: Date.now() + 60000 };
  assert.equal(clarificationReply(confirm, parseAddress('yes', 'Jev')), 'beat the game (yes, now)');
  assert.equal(clarificationReply(confirm, parseAddress('lol', 'Jev')), null);
  assert.equal(clarificationReply({ ...asked, until: Date.now() - 1 }, parseAddress('grass block', 'Jev'), { known }), null, 'the question has closed');
});
