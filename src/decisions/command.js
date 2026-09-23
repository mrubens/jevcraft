'use strict';
// Server commands: the walk down the server's own command tree, the roles
// (who is moved, to where), and the final check that the command built is
// the one asked for. A wrong command changes the world or a player, so
// every step is gated: below its bar the bot asks for more detail instead
// of guessing, and nothing runs until the whole command passes the check.
const { choice, noul } = require('../typesafe');
const { define } = require('./index');

const command = spec => define({ area: 'command', kind: 'command', stakes: 'high', ...spec });
const NOT_SURE = { threshold: 0.5, below: 'caller', why: 'unsure of a step, the bot asks for the command again with more detail rather than guess' };
const withNone = options => ({ ...options, none: 'No option faithfully matches the request; more detail is required.' });

command({
  id: 'command_node', primitive: 'choice', gate: NOT_SURE,
  build: ({ options, grouped }) => choice(`${grouped ? 'Choose the group containing the requested value. ' : ''}Choose the next command or argument branch that directly implements the user request. Do not invent extra steps. Only finish when requested targets are explicit or truly refer to the bot. For "teleport me to you", use targets=speaker, then destination=bot, not the short destination-only form.`, withNone(options)),
});
command({
  id: 'command_argument', primitive: 'choice', gate: NOT_SURE,
  build: ({ purpose, options, grouped }) => choice(`${grouped ? 'Choose the group containing the requested value. ' : ''}${purpose}`, withNone(options)),
});
command({
  id: 'command_subject', primitive: 'choice', gate: NOT_SURE,
  build: ({ root, players }) => choice(`Assuming /${root}, who is the subject to move, change, affect, or give items to? Resolve the grammatical subject, not the destination. "Teleport yourself to me" means the bot is moved. "Teleport me to you" means the speaker is moved. An omitted target normally means the bot executor.`, players),
});
command({
  id: 'command_destination', primitive: 'choice', gate: NOT_SURE,
  build: ({ players }) => choice('Assuming teleport, what is the destination? "To me" is the speaker; "to you" is the bot. This is separate from who moves.', { ...players, coordinates: 'An explicitly requested coordinate position instead of a player' }),
});
command({
  id: 'command_faithful', primitive: 'noul',
  gate: { threshold: 0.75, below: 'caller', why: 'a built command is run only when Jev is sure it is the one asked for' },
  build: () => noul('Does `command` implement the action that `request` asks for, with the correct targets, position, quantity and scope? Compare command semantics. Polite requests such as "can you stop the rain?" ask for action. The speaker is me/I; the bot is you/Jev and the command executor. @s and omitted player targets mean the bot. Use `observedPlayerPositions` to check location arguments. Answer no for negation, hypothetical examples, quoted instructions or purely informational questions.'),
});
