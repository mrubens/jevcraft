'use strict';
const { parseAddress } = require('./chat-address');

function requestedCommand(request, username) {
  if (/[\r\n\u0000]/.test(request)) throw new Error('Use one complete slash command on a single line');
  const address = parseAddress(request, username);
  if (!address.explicit) return null;
  const match = address.text.match(/^(?:(?:run|execute)(?: the)?(?: command)?\s+|command\s+)?(\/[\s\S]*)$/i);
  if (!match) return null;
  const command = match[1];
  if (/[\r\n\u0000]/.test(command) || !/^\/[a-z0-9_:]+(?:\s|$)/i.test(command) || command.length > 32767) {
    throw new Error('Use one complete slash command on a single line');
  }
  return command;
}

function createCommandAccess(bot, { users = [], audit = () => {} } = {}) {
  const allowed = new Set(users.map(name => name.toLowerCase()));
  const send = bot.chat.bind(bot);
  // Normal speech, including model-selected actions and saved task status,
  // cannot become a slash command through newlines or chat chunk boundaries.
  bot.chat = value => {
    const message = String(value);
    if (/(?:^|\n)\s*\//.test(message)) throw new Error('Commands require a fresh explicit player request');
    for (const line of message.split(/\r?\n/)) for (let i = 0; i < line.length; i += 200) {
      const chunk = line.slice(i, i + 200);
      send(chunk.startsWith('/') ? `Jev: ${chunk}` : chunk);
    }
  };
  return {
    // Only raw playerChat events reach this function. Formatted chat, tellraw,
    // model answers, saved goals, and command-block output cannot authorize it.
    accept(data, { resolvedCommand, interpretation } = {}) {
      if (typeof data.plainMessage !== 'string' || !data.sender) return null;
      const player = Object.values(bot.players).find(p => p.uuid === data.sender);
      if (!player || player.username === bot.username) return null;
      const literal = requestedCommand(data.plainMessage, bot.username);
      if (literal && resolvedCommand && literal !== resolvedCommand) throw new Error('Cannot change a literal command requested by the player');
      const command = literal || resolvedCommand;
      if (!command || !parseAddress(data.plainMessage, bot.username).explicit) return null;
      if (requestedCommand(`${bot.username} ${command}`, bot.username) !== command) throw new Error('Invalid resolved command');
      if (!allowed.has(player.username.toLowerCase())) throw new Error(`${player.username} is not enabled for Jev's operator commands`);
      const request = { from: player.username, senderUuid: data.sender, request: data.plainMessage, command, ...(interpretation ? { interpretation } : {}) };
      let used = false;
      return { ...request, dispatch() {
        if (used) throw new Error('This command request was already dispatched');
        used = true;
        audit({ ...request, event: 'dispatch', at: new Date().toISOString() });
        send(command);
      } };
    },
  };
}

module.exports = { requestedCommand, createCommandAccess };
