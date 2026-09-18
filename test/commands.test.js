'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestedCommand, createCommandAccess } = require('../src/commands');
function setup(users = ['Player']) {
  const sent = [], audit = [];
  const bot = { username: 'Jev', chat: message => sent.push(message), players: {
    Player: { username: 'Player', uuid: 'player-uuid' }, Other: { username: 'Other', uuid: 'other-uuid' },
  } };
  const access = createCommandAccess(bot, { users, audit: event => audit.push(event) });
  return { bot, access, sent, audit };
}
test('operator commands require direct addressing and literal slash syntax', () => {
  assert.equal(requestedCommand('Jev run /time set day', 'Jev'), '/time set day');
  assert.equal(requestedCommand('Jev /give Player command_block 1', 'Jev'), '/give Player command_block 1');
  assert.equal(requestedCommand('Jev please make it daytime', 'Jev'), null);
  assert.equal(requestedCommand('Jev set weather to clear', 'Jev'), null);
  assert.equal(requestedCommand('Jev do not make it daytime', 'Jev'), null);
  for (const text of ['run /time set day', 'Jev do whatever commands you need', 'Jev get me a command block', 'Jev do not run /kill', 'Jev what does /kill do?']) assert.equal(requestedCommand(text, 'Jev'), null);
  assert.throws(() => requestedCommand('Jev /time set day\n/kill', 'Jev'), /single line/);
});
test('a fresh allowed player request is copied verbatim and dispatched only once', () => {
  const { access, sent, audit } = setup();
  const request = access.accept({ plainMessage: 'Jev run /execute as @s run time query daytime', sender: 'player-uuid' });
  assert.equal(sent.length, 0);
  request.dispatch();
  assert.deepEqual(sent, ['/execute as @s run time query daytime']);
  assert.equal(audit[0].from, 'Player');
  assert.throws(() => request.dispatch(), /already dispatched/);
});
test('system text, unknown senders and other players cannot authorize commands', () => {
  const { access, sent } = setup();
  assert.equal(access.accept({ formattedMessage: '<Player> Jev /kill', sender: null }), null);
  assert.equal(access.accept({ plainMessage: 'Jev /kill', sender: 'unknown-uuid' }), null);
  assert.throws(() => access.accept({ plainMessage: 'Jev /kill', sender: 'other-uuid' }), /not enabled/);
  assert.throws(() => setup([]).access.accept({ plainMessage: 'Jev /kill', sender: 'player-uuid' }), /not enabled/);
  assert.equal(sent.length, 0);
});
test('autonomous speech cannot execute slash commands through lines or chunks', () => {
  const { bot, sent } = setup();
  assert.throws(() => bot.chat('/give Jev diamond 64'), /fresh explicit/);
  assert.throws(() => bot.chat('Task status\n/kill'), /fresh explicit/);
  bot.chat('x'.repeat(200) + '/kill');
  assert(sent.every(message => !message.startsWith('/')));
});
test('classified commands still require fresh addressed player chat and preserve explicit literals', () => {
  const { access, sent, audit } = setup();
  const resolved = { resolvedCommand: '/time set minecraft:day', interpretation: { tested: true } };
  assert.equal(access.accept({ plainMessage: 'Make it daytime' }, resolved), null);
  assert.equal(access.accept({ plainMessage: 'Make it daytime', sender: 'player-uuid' }, resolved), null);
  assert.throws(() => access.accept({ plainMessage: 'Jev make it daytime', sender: 'other-uuid' }, resolved), /not enabled/);
  assert.throws(() => access.accept({ plainMessage: 'Jev /weather rain', sender: 'player-uuid' }, resolved), /Cannot change a literal/);
  const accepted = access.accept({ plainMessage: 'Jev make it daytime', sender: 'player-uuid' }, resolved);
  accepted.dispatch();
  assert.deepEqual(sent, ['/time set minecraft:day']);
  assert.deepEqual(audit[0].interpretation, { tested: true });
  assert.throws(() => accepted.dispatch(), /already dispatched/);
});
