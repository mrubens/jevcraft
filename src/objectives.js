'use strict';

const fs = require('fs');
const path = require('path');
const { choice, noul } = require('./typesafe');
const { Vec3 } = require('vec3');
const { chatNames, parseAddress } = require('./chat-address');
const { resolveItem } = require('./catalog');

const TYPES = {
  operator_command: 'Ask for a Minecraft command effect: change time, weather, difficulty, or player game mode (Creative, Survival, Adventure, Spectator); teleport; summon; change rules, effects, enchantments, experience, scores, permissions, or other server command settings. "Put me in Creative" changes game mode. Polite action questions are requests. Never use commands merely as a means to build, craft, collect, or follow. Stop this bot task is stop. Informational questions, quotes and negated commands are other.',
  house: 'Build a simple small house or shelter, optionally naming its primary material, with no custom architecture.',
  build: 'Design and build a custom structure: a mansion, castle, tower, bridge, statue, detailed house, or a building with specified rooms, floors, shape or style. This calls the building designer. Inventory items such as beds and chests are craft.',
  obtain: 'Get, gather, collect, bring or give a Minecraft item or block, of any kind.',
  craft: 'Make or craft an inventory item such as a tool, chest, stairs, planks, or other recipe output.',
  come: 'Come here, approach a player, or meet the speaker once.',
  follow: 'Follow a player continuously, stay with them, or accompany them.',
  nether: 'Find or create a working route to the Nether.',
  win: 'Beat Minecraft or win the game through survival progression, defeating the Ender Dragon and returning alive. This is a gameplay objective, not permission to use commands. Questions about how to win and requests not to fight are other.',
  stop: 'Stop or cancel the current task.',
  status: 'Ask what this bot is doing now, how its current task is going, or whether it has finished. Report the bot current activity or progress.',
  resume: 'Continue or retry the saved task.',
  other: 'Conversation, explanations, general questions about Minecraft, negated instructions, or unsupported requests. Do not execute a task merely mentioned as a topic. Requests for the bot current activity/progress are status; requests to perform a supported action use that action.',
};

const INTERACTIONS = {
  request: { meaning: 'An instruction for this Minecraft bot to act, control its task, or report its current activity. Imperative verbs address the bot, even without please. Long-term goals are actions too. Polite action questions are instructions.',
    examples: ['win the game', 'collect some wood', 'could you build me a house?', 'what are you doing now?'] },
  discussion: { meaning: 'An explanation, general fact, hypothetical discussion, quoted statement, or negation, without asking this bot to execute that action.',
    examples: ['how can I win the game?', 'explain how crafting works', 'do not build that house', 'what does Alex mean by collect wood?'] },
};

// Candidate extraction is exact code; Jev selects which mentioned quantity
// applies to the requested output. Never offer unrelated batch sizes.
function quantityCandidates(request) {
  const values = new Set();
  const units = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const names = [...units, ...Object.keys(tens), 'hundred', 'thousand'];
  const pattern = new RegExp(`\\b(?:\\d+|(?:${names.join('|')})(?:[ -]+(?:and[ -]+)?(?:${names.join('|')}))*)\\b`, 'gi');
  for (const match of request.matchAll(pattern)) {
    let n = 0;
    if (/^\d+$/.test(match[0])) n = Number(match[0]);
    else for (const word of match[0].toLowerCase().split(/[ -]+/)) {
      if (word === 'hundred') n = (n || 1) * 100;
      else if (word === 'thousand') n = (n || 1) * 1000;
      else if (word !== 'and') n += tens[word] ?? units.indexOf(word);
    }
    values.add(n);
    if (/^\s+stacks?\b/i.test(request.slice(match.index + match[0].length))) values.add(n * 64);
  }
  if (/\bstack\b/i.test(request)) values.add(/\bhalf\s+(?:a\s+)?stack\b/i.test(request) ? 32 : 64);
  if (/\b(?:a|an|single)\b/i.test(request)) values.add(1);
  return [...values].filter(n => Number.isInteger(n) && n > 0 && n <= 1024).map(String);
}

async function interpret(client, request, from, username, context = {}) {
  const address = parseAddress(request, username);
  const numbers = quantityCandidates(address.text);
  const response = await client.systemOne({
    state: { request, request_body: address.text, speaker: from, bot_name: username, bot_names: chatNames(username), explicitly_addressed: address.explicit,
      availablePlayers: context.players || [from] },
    questions: {
      addressed: noul('Is `request` directed at this bot asking it to act or report, rather than conversation with another player? All names in `bot_names` refer to this same bot. `explicitly_addressed` records a direct name prefix.'),
      interaction: choice('Classify the speaker intent in `request_body`, with the bot name prefix removed. The speaker is talking to a Minecraft bot. Is this an instruction to perform an action/report its current activity, or a discussion without an instruction to act? Judge intent, not feasibility or the topic.', INTERACTIONS),
      objective: choice('Categorize the requested outcome in `request` in the Minecraft game. Creative, Survival, Adventure and Spectator name game modes even when the word "mode" is omitted. Item requests belong to obtain or craft regardless of which particular Minecraft item is named. Choose obtain for collect/get/gather/fetch requests even when the item can be crafted; choose craft for explicit make/craft/create inventory items. Recipes and feasibility are checked after routing. A simple small house is house; custom structures and mansions are build; crafting an inventory item is craft. Coming once differs from continuously following. Changing the world or player with an explicitly requested command effect is operator_command.', TYPES),
      quantity: choice('Assuming an item request, select the quantity applying to the requested output. Candidates were extracted from this request. "A/an" or "a single" item means 1. Stacks contain 64 items. If no requested output quantity is stated, select unspecified; do not invent a batch size.',
        { ...Object.fromEntries(numbers.map(n => [n, `${n} items requested by a quantity in the message`])), unspecified: 'No stated output quantity; the application will use its default.' }),
      delivery: choice('Assuming an item request, identify the recipient stated in `request`. The speaker is the human and you/yourself refers to the bot. Select unspecified when the request only says to make, craft, get or collect an item without naming its recipient. Do not infer a recipient merely because a human issued the request.', {
        speaker: 'The human speaker: get me, bring me, give me, craft me, for me. Bring/deliver without another named recipient also means the speaker.',
        bot: 'The bot: for yourself, get yourself, for your own use, keep it.',
        unspecified: 'No recipient is stated: craft a chest, make eight stairs, collect eight blocks, get a pickaxe. The application will keep the items in the bot inventory.',
      }),
      target: choice('Assuming come or follow, which available player should the bot approach? "me" or no name means the speaker.', Object.fromEntries([...new Set([from, ...(context.players || [])])].map(name => [name, name === from ? `${name}: the speaker (me)` : name]))),
      material: choice('Assuming the request is a small house, which construction material does the player request? Use oak_planks for unspecified wood or no preference.', {
        oak_planks: 'Wooden oak planks; default house material.',
        cobblestone: 'Cobblestone.', dirt: 'Dirt.', other: 'Any other explicitly specified building material; resolve it from the full block catalog.',
      }),
    },
  });
  const a = response.answers;
  if (!a || !Object.hasOwn(TYPES, a.objective?.choice) || !Object.hasOwn(INTERACTIONS, a.interaction?.choice) || !Number.isFinite(a.addressed?.noul)) {
    throw new Error('Invalid Jev interpretation response');
  }
  if (!address.explicit && a.addressed.noul < 0.5) return null;
  const kind = a.interaction.choice === 'request' ? a.objective.choice : 'other';
  const spec = { kind, request, from, interpretation: a, usage: response.usage };
  if (['come', 'follow'].includes(kind)) {
    const target = a.target?.choice;
    if (![from, ...(context.players || [])].includes(target)) throw new Error('Unknown movement target');
    spec.target = target;
  }
  if (['obtain', 'craft'].includes(kind) || (kind === 'house' && a.material?.choice === 'other')) {
    const registry = context.registry || require('minecraft-data')('26.1');
    const resolution = await resolveItem(client, registry, request, { blocksOnly: kind === 'house',
      context: { inventory: context.inventory || {}, nearbyBlocks: context.nearbyBlocks || [] } });
    spec.itemResolution = resolution;
    if (!resolution.item) return { ...spec, kind: 'clarify', message: 'I could not match the requested item. Use its Minecraft item name so I can work out the recipe.' };
    if (kind === 'house') spec.material = resolution.item;
    else {
      if (![...numbers, 'unspecified'].includes(a.quantity?.choice)) throw new Error('Invalid item quantity');
      spec.item = resolution.item; spec.count = a.quantity.choice === 'unspecified' ? resolution.item.endsWith('_concrete') ? 32 : 1 : Number(a.quantity.choice);
      if (!['speaker', 'bot', 'unspecified'].includes(a.delivery?.choice)) throw new Error('Invalid item recipient');
      spec.deliver = a.delivery.choice === 'speaker';
    }
  } else if (kind === 'house') spec.material = a.material?.choice || 'oak_planks';
  return spec;
}

class GoalStore {
  constructor(file) { this.file = file; }
  read() {
    if (!fs.existsSync(this.file)) return null;
    const goal = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (goal.version !== 1) throw new Error('Unsupported saved goal version');
    return goal;
  }
  save(goal) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    goal.updatedAt = new Date().toISOString();
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(goal, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}

function houseBlueprint(origin, material = 'oak_planks') {
  const o = new Vec3(origin.x, origin.y, origin.z);
  const blocks = [];
  const empty = [];
  for (let y = -1; y <= 3; y++) {
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      const doorway = x === 0 && z === -2 && y >= 0 && y < 2;
      const pos = o.offset(x, y, z);
      if (y === -1 || y === 3 || (edge && !doorway)) blocks.push({ ...pos, material });
      else empty.push({ ...pos });
    }
  }
  return { origin: { ...o }, blocks, empty, entrance: { ...o.offset(0, 0, -3) } };
}

function verifyHouse(bot, blueprint) {
  if (!blueprint) return { ok: false, reason: 'No building site selected' };
  const missing = blueprint.blocks.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== p.material);
  const obstructed = blueprint.empty.filter(p => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return !b || !['air', 'cave_air', 'void_air'].includes(b.name);
  });
  return { ok: !missing.length && !obstructed.length, missing: missing.length, obstructed: obstructed.length };
}

module.exports = { interpret, quantityCandidates, GoalStore, houseBlueprint, verifyHouse };
