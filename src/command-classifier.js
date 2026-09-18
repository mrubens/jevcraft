'use strict';
const { choice, noul } = require('./typesafe');
const { resolveItem } = require('./catalog');
const { quantityCandidates } = require('./objectives');

const meanings = {
  time: 'Change or query world time, daylight, day/night, or the passage of time.',
  weather: 'Change clear skies, rain, or thunderstorms.',
  teleport: 'Teleport a player/entity to another player/entity or coordinates.',
  gamemode: 'Change a player between Creative, Survival, Adventure, and Spectator.',
  difficulty: 'Change Peaceful, Easy, Normal, or Hard difficulty.',
  give: 'Use a command to grant inventory items to players.',
  summon: 'Spawn a new entity or mob.', effect: 'Apply or remove status effects.',
  gamerule: 'Change the server-defined gameplay rules.',
  kill: 'Kill explicitly requested target entities or players.',
  stop: 'Shut down the Minecraft server, not stop the bot task.',
  setblock: 'Set a single block at coordinates.', fill: 'Fill a bounded region with blocks.',
  clear: 'Remove specified items from player inventory.',
  op: 'Grant a player operator permissions.', deop: 'Remove player operator permissions.',
};
const label = node => node.extraNodeData?.name || 'root';
const kind = node => node.flags.command_node_type;
const singleLine = value => typeof value === 'string' && !/[\r\n\u0000]/.test(value);

class CommandClarification extends Error {
  constructor(message) { super(message); this.name = 'CommandClarification'; }
}

async function classifyCommand(client, bot, request, speaker, { signal, tree = bot.commandTree } = {}) {
  if (!tree?.nodes?.length) throw new CommandClarification('The server command catalog is not available yet.');
  const nodes = tree.nodes;
  const tokens = [];
  const boundArguments = [];
  let intent = {};
  const judgments = [];
  const completions = new Map();
  const started = performance.now();
  const state = () => ({ request, speaker, botName: bot.username, executor: bot.username,
    commandSoFar: '/' + tokens.join(' '), players: Object.keys(bot.players),
    observedPlayerPositions: Object.fromEntries(Object.entries(bot.players).filter(([, p]) => p.entity?.position).map(([name, p]) => [name, { ...p.entity.position }])),
    inferredRoles: intent, boundArguments,
    guidance: 'The speaker is "me/I". The bot is "you/Jev" and executes the command. Command defaults generally affect the executor. Preserve exactly the requested targets and scope.' });
  async function choose(instructions, options) {
    signal?.throwIfAborted();
    if (!Object.keys(options).length) throw new CommandClarification('A required command argument is missing.');
    // All candidates remain reachable, even for large resource registries.
    if (Object.keys(options).length > 100) {
      const entries = Object.entries(options), groups = {};
      for (let i = 0; i < entries.length; i += 24) groups[`group_${i / 24}`] = entries.slice(i, i + 24);
      const group = await choose(`Choose the group containing the requested value. ${instructions}`,
        Object.fromEntries(Object.entries(groups).map(([key, entries]) => [key, entries.map(([, value]) => value).join('; ')])));
      return choose(instructions, Object.fromEntries(groups[group]));
    }
    const response = await client.systemOne({ state: state(), questions: {
      selection: choice(instructions, { ...options, none: 'No option faithfully matches the request; more detail is required.' }),
    }, signal });
    const selected = response.answers?.selection?.choice;
    judgments.push({ commandSoFar: [...tokens], instructions, options, answer: response.answers?.selection, usage: response.usage });
    if (selected === 'none') throw new CommandClarification('I need a more specific target or argument for that command.');
    if (!Object.hasOwn(options, selected)) throw new Error('Jev selected a value outside the server command catalog');
    return selected;
  }
  async function chooseValue(instructions, entries) {
    const values = [...new Map(entries.filter(([value]) => singleLine(value)).map(row => [row[0], row])).values()];
    if (!values.length) throw new CommandClarification(`Please specify ${instructions.toLowerCase()}.`);
    const key = await choose(instructions, Object.fromEntries(values.map(([value, description], i) => [`value_${i}`, description || value])));
    return values[Number(key.slice(6))][0];
  }
  async function suggestions() {
    const prefix = '/' + tokens.join(' ') + ' ';
    if (completions.has(prefix)) return completions.get(prefix);
    try {
      const result = (await bot.tabComplete(prefix, true, false, 2000))
        .map(row => typeof row === 'string' ? row : row.match).filter(singleLine);
      completions.set(prefix, result); return result;
    } catch (_) { return []; }
  }
  function numberValues(parser, properties) {
    const values = [...new Set([...quantityCandidates(request.replace(/-?\d+(?:\.\d+)?/g, '')), ...(request.match(/(?<![\w])-?\d+(?:\.\d+)?/g) || [])])];
    return values.filter(value => Number.isFinite(Number(value)) &&
      (!['brigadier:integer', 'brigadier:long'].includes(parser) || Number.isInteger(Number(value))) &&
      (properties?.min === undefined || Number(value) >= properties.min) && (properties?.max === undefined || Number(value) <= properties.max));
  }
  async function argument(node) {
    const { name, parser, properties } = node.extraNodeData;
    const purpose = `Select the ${name} argument (${parser}) for the player's request. Use the command prefix and argument role to preserve who acts on whom.`;
    if (['minecraft:entity', 'minecraft:game_profile', 'minecraft:score_holder'].includes(parser)) {
      if (['targets', 'target'].includes(name) && intent.subject) return intent.subject;
      if (name === 'destination' && intent.destination && intent.destination !== 'coordinates') return intent.destination;
      const values = Object.keys(bot.players).map(player => [player, `${player}${player === speaker ? ': the speaker (me)' : player === bot.username ? ': the bot (you), command executor' : ': another player'}`]);
      values.push(['@s', `${bot.username}: the bot executing this command, never the speaker unless they are the bot`]);
      for (const selector of request.match(/@[paresn](?:\[[^\]\r\n]*\])?/g) || []) values.push([selector, `Literal selector from the request: ${selector}`]);
      if (/\b(?:all|every) (?:players?|people|everyone)\b|\beveryone\b/i.test(request)) values.push(['@a', 'All players, only when explicitly requested']);
      return chooseValue(purpose, values);
    }
    if (['minecraft:item_stack', 'minecraft:block_state', 'minecraft:block_predicate', 'minecraft:item_predicate'].includes(parser)) {
      const resolved = await resolveItem(client, bot.registry, request, { blocksOnly: parser.includes('block'), context: { commandSoFar: tokens.join(' '), argument: name } });
      judgments.push({ argument: name, catalog: resolved });
      if (!resolved.item) throw new CommandClarification('Which Minecraft item or block should that command use?');
      return 'minecraft:' + resolved.item;
    }
    if (['minecraft:vec3', 'minecraft:block_pos', 'minecraft:vec2', 'minecraft:column_pos', 'minecraft:rotation'].includes(parser)) {
      const size = ['minecraft:vec3', 'minecraft:block_pos'].includes(parser) ? 3 : 2;
      const values = [];
      const component = '(?:[~^](?:-?\\d+(?:\\.\\d+)?)?|-?\\d+(?:\\.\\d+)?)';
      const pattern = new RegExp(`(?<![\\w])${component}(?:[ ,]+${component}){${size - 1}}(?![\\w])`, 'g');
      for (const match of request.matchAll(pattern)) values.push([match[0].replace(/,\s*/g, ' ').replace(/\s+/g, ' '), `Coordinates explicitly present: ${match[0]}`]);
      if (size === 3) {
        values.push(['~ ~ ~', 'The command executor/bot current position']);
        const p = bot.players[speaker]?.entity?.position;
        if (p) values.push([['x', 'y', 'z'].map(k => parser === 'minecraft:block_pos' ? Math.floor(p[k]) : Number(p[k].toFixed(2))).join(' '), `The speaker ${speaker}'s observed current position (here, at me)`]);
      }
      return chooseValue(purpose, values);
    }
    if (parser === 'brigadier:bool') return chooseValue(purpose, [['true', 'Enabled / on / true'], ['false', 'Disabled / off / false']]);
    if (/^brigadier:(integer|float|double|long)$/.test(parser)) return chooseValue(purpose, numberValues(parser, properties).map(n => [n, n]));
    if (parser === 'minecraft:time') {
      const values = numberValues(parser, properties).map(n => [n, `${n} game ticks`]);
      for (const match of request.matchAll(/\b(\d+(?:\.\d+)?)\s*(ticks?|seconds?|minutes?|days?|[tsd])\b/gi)) {
        const unit = match[2].toLowerCase();
        const suffix = unit.startsWith('d') ? 'd' : unit.startsWith('t') ? 't' : 's';
        const amount = Number(match[1]) * (unit.startsWith('m') ? 60 : 1);
        values.push([`${amount}${suffix}`, match[0]]);
      }
      return chooseValue(purpose, values);
    }
    const offered = await suggestions();
    if (offered.length) return chooseValue(purpose, offered.filter(value => !value.startsWith('@') || /@[paresn]/.test(request)).map(value => [value, value]));
    // Open-ended values are copied from source spans, never generated by Jev.
    const quoted = [...request.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => {
      try { return JSON.parse(match[0]); } catch (_) { return null; }
    }).filter(singleLine);
    if (['brigadier:string', 'minecraft:message', 'minecraft:component'].includes(parser)) {
      const value = await chooseValue(`Select the quoted text for ${name}`, quoted.map(text => [text, text]));
      return parser === 'minecraft:component' || (parser === 'brigadier:string' && properties === 'QUOTABLE_PHRASE') ? JSON.stringify(value) : value;
    }
    throw new CommandClarification(`Please provide the exact ${name} (${parser}) argument; I cannot infer it from the available catalog.`);
  }

  async function resolveRoles(root) {
    if (!['teleport', 'tp', 'gamemode', 'give', 'clear', 'effect', 'enchant', 'kill', 'spawnpoint'].includes(root)) return;
    const players = Object.fromEntries(Object.keys(bot.players).map(name => [name, name === speaker ? `${name}: the speaker; me or I` : name === bot.username ? `${name}: the bot; you, yourself, Jev; command executor` : name]));
    const response = await client.systemOne({ state: state(), questions: {
      subject: choice(`Assuming /${root}, who is the subject to move, change, affect, or give items to? Resolve the grammatical subject, not the destination. "Teleport yourself to me" means the bot is moved. "Teleport me to you" means the speaker is moved. An omitted target normally means the bot executor.`, players),
      ...(root === 'teleport' || root === 'tp' ? { destination: choice('Assuming teleport, what is the destination? "To me" is the speaker; "to you" is the bot. This is separate from who moves.', { ...players, coordinates: 'An explicitly requested coordinate position instead of a player' }) } : {}),
    }, signal });
    const subject = response.answers?.subject?.choice;
    if (!Object.hasOwn(players, subject)) throw new CommandClarification('Which player should that command affect?');
    intent.subject = subject;
    if (response.answers.destination) {
      const destination = response.answers.destination.choice;
      if (!Object.hasOwn(players, destination) && destination !== 'coordinates') throw new Error('Invalid teleport destination');
      intent.destination = destination;
    }
    judgments.push({ roles: response.answers, usage: response.usage });
  }

  try {
  let current = tree.rootIndex;
  for (let depth = 0; depth < 32; depth++) {
    signal?.throwIfAborted();
    let node = nodes[current];
    if (node.flags.has_redirect_node) { current = node.redirectNode; node = nodes[current]; }
    const options = {};
    for (const index of node.children) {
      const child = nodes[index], data = child.extraNodeData;
      if (tokens.length === 1 && ['teleport', 'tp'].includes(tokens[0]) && intent.subject !== bot.username && ['location', 'destination'].includes(data.name)) continue;
      if (kind(child) === 2 && /^(?:brigadier:(?:integer|float|double|long)|minecraft:time)$/.test(data.parser) && !numberValues(data.parser, data.properties).length) continue;
      const meaning = tokens[0] === 'weather' ? { clear: 'Stop rain and thunderstorms; sunny/clear weather', rain: 'Start rainfall', thunder: 'Start a thunderstorm' }[data.name] : meanings[data.name];
      options[`node_${index}`] = kind(child) === 1
        ? `${data.name}: ${meaning || 'server command/subcommand'}${child.children.length ? `; next fields: ${child.children.map(i => label(nodes[i])).slice(0, 12).join(', ')}` : ''}`
        : `Argument ${data.name} of type ${data.parser}${child.flags.has_command ? '; executable after this argument, with other arguments omitted' : ''}${child.children.length ? `; then ${child.children.map(i => label(nodes[i])).join(', ')}` : ''}`;
    }
    const needsExplicitTarget = tokens[0] === 'gamemode' && intent.subject && intent.subject !== bot.username && !boundArguments.some(a => a.name === 'target');
    if (node.flags.has_command && !needsExplicitTarget) options.finish = 'Finish this executable command: all explicitly requested arguments and targets are represented; omitted targets default to the bot executor.';
    if (Object.keys(options).length === 1 && options.finish) break;
    const selected = await choose('Choose the next command or argument branch that directly implements the user request. Do not invent extra steps. Only finish when requested targets are explicit or truly refer to the bot. For "teleport me to you", use targets=speaker, then destination=bot, not the short destination-only form.', options);
    if (selected === 'finish') break;
    current = Number(selected.slice(5));
    node = nodes[current];
    const value = kind(node) === 1 ? label(node) : await argument(node);
    tokens.push(value);
    if (kind(node) === 2) boundArguments.push({ name: label(node), value, parser: node.extraNodeData.parser });
    if (tokens.length === 1) await resolveRoles(value);
    if (depth === 31) throw new CommandClarification('That command is too deeply nested to resolve in one bounded request.');
  }
  const command = '/' + tokens.join(' ');
  if (!nodes[current].flags.has_command || !singleLine(command)) throw new Error('Classifier did not reach an executable command');
  const checked = await client.systemOne({ state: { ...state(), command }, questions: {
    faithful: noul('Does `command` implement the action that `request` asks for, with the correct targets, position, quantity and scope? Compare command semantics. Polite requests such as "can you stop the rain?" ask for action. The speaker is me/I; the bot is you/Jev and the command executor. @s and omitted player targets mean the bot. Use `observedPlayerPositions` to check location arguments. Answer no for negation, hypothetical examples, quoted instructions or purely informational questions.'),
  }, signal });
  judgments.push({ verification: checked.answers, usage: checked.usage });
  if (!(checked.answers?.faithful?.noul >= 0.75)) throw new CommandClarification('I could not resolve that command confidently. Please specify its action and target more clearly.');
  return { command, judgments, latencyMs: Math.round(performance.now() - started) };
  } catch (err) { err.command = '/' + tokens.join(' '); err.judgments = judgments; throw err; }
}

module.exports = { classifyCommand, CommandClarification };
