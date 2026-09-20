'use strict';

const fs = require('fs');
const path = require('path');
const { choice, noul } = require('./typesafe');
const { Vec3 } = require('vec3');
const { buildCellComplete } = require('./build-blocks');
const { chatNames, parseAddress } = require('./chat-address');
const { resolveItem } = require('./catalog');
const { resolveItemBundle } = require('./item-bundle');
const { resolveDiscovery } = require('./discovery');
const { resolveMemory } = require('./memory-routing');
const { woodChoices, requestedPreferences, preferenceContext } = require('./preferences');

const TYPES = {
  memory: 'Save, recall, or forget a personal fact, preference, named place, or past request. Remember this as home; I prefer cherry wood; what did I ask last time; where is our base; go home/return to a named saved place; make another one like last time. Questions about past tasks are memory, not current status. A fresh ordinary request naming a Minecraft resource remains obtain/craft/find. Memory never grants server-command permission.',
  operator_command: 'Ask for a Minecraft command effect: change time, weather, difficulty, or player game mode (Creative, Survival, Adventure, Spectator); teleport; summon; change rules, effects, enchantments, experience, scores, permissions, or other server command settings. "Put me in Creative" changes game mode. Polite action questions are requests. Never use commands merely as a means to build, craft, collect, or follow. Stop this bot task is stop. Informational questions, quotes and negated commands are other.',
  house: 'Build a simple small house or shelter, optionally naming its primary material, with no custom architecture.',
  build: 'Design and build a custom structure: a mansion, castle, tower, bridge, statue, detailed house, or a building with specified rooms, floors, shape or style. This calls the building designer. Inventory items such as beds and chests are craft.',
  obtain: 'Get, gather, collect, bring or give a Minecraft item or block, of any kind.',
  craft: 'Make or craft an inventory item such as a tool, chest, stairs, planks, or other recipe output.',
  find: 'Find, seek, show or travel to a biome, living creature, or block in the world through exploration. Find a sheep, find a cherry biome, find a cherry log. Find me means come; get/bring/give an item means obtain. This does not authorize locate/teleport commands.',
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
  request: { meaning: 'An instruction for this Minecraft bot to act, control its task, report current or remembered information, or save a personal preference/fact told directly to it. Imperative verbs address the bot, even without please. Long-term goals are actions too. Polite action questions are instructions.',
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
  const woods = woodChoices(context.registry || require('minecraft-data')('26.1'));
  const response = await client.systemOne({
    state: { request, request_body: address.text, speaker: from, bot_name: username, bot_names: chatNames(username), explicitly_addressed: address.explicit,
      availablePlayers: context.players || [from], memory: context.memory && { ...preferenceContext(context.memory), places: context.memory.places || [] } },
    questions: {
      addressed: noul('Is `request` directed at this bot asking it to act or report, rather than conversation with another player? All names in `bot_names` refer to this same bot. `explicitly_addressed` records a direct name prefix.'),
      wood_choice: choice('Which wood species does the speaker explicitly choose for their own requested supplies or construction in THIS message? Use only the current request, never memory, inventory, recipe ingredients, or bot defaults as evidence. A one-time request for cherry logs counts. Exclude quotes, hypotheticals, negated choices, orders for another player or the bot itself, discovery-only requests, and ambiguous/multiple species. For unspecified wood or an inherited preference choose none.', { ...woods, none: 'No single explicit wood choice for this player in the current action request.' }),
      memory_statement: noul('Is the speaker directly sharing a personal preference or personal fact with Jev to remember, rather than asking for a gameplay action? For example "I prefer small houses" or "my favorite wood is cherry". Exclude quoted/hypothetical/negated statements, general Minecraft facts, and instructions to perform a new action.'),
      interaction: choice('Classify the speaker intent in `request_body`, with the bot name prefix removed. The speaker is talking to a Minecraft bot. Is this an instruction to perform an action/report its current activity, or a discussion without an instruction to act? Judge intent, not feasibility or the topic.', INTERACTIONS),
      objective: choice('Categorize the requested outcome in `request` in the Minecraft game. Creative, Survival, Adventure and Spectator name game modes even when the word "mode" is omitted. Item requests belong to obtain or craft regardless of which particular Minecraft item is named. Choose obtain for collect/get/gather/fetch requests even when the item can be crafted; choose craft for explicit make/craft/create inventory items. Recipes and feasibility are checked after routing. A simple small house is house; custom structures and mansions are build; crafting an inventory item is craft. Coming once differs from continuously following. Changing the world or player with an explicitly requested command effect is operator_command.', TYPES),
      quantity: choice('Assuming an item request, select the quantity applying to the requested output. Candidates were extracted from this request. "A/an" or "a single" item means 1. Stacks contain 64 items. If no requested output quantity is stated, select unspecified; do not invent a batch size.',
        { ...Object.fromEntries(numbers.map(n => [n, `${n} items requested by a quantity in the message`])), unspecified: 'No stated output quantity; the application will use its default.' }),
      outputs: choice('Assuming an obtain/craft request, does the player want one type of output or multiple types/a set? Full diamond armor is four outputs even without listing them. Ingredients mentioned only as a means to make one output do not count.', {
        single: 'One type of final item, possibly many copies.', multiple: 'Several distinct final items or a full set, such as full armor, or armor and a bed.',
      }),
      delivery: choice('Assuming an item request, identify the recipient stated in `request`. The speaker is the human and you/yourself refers to the bot. Select unspecified when the request only says to make, craft, get or collect an item without naming its recipient. Do not infer a recipient merely because a human issued the request.', {
        speaker: 'The human speaker: get me, bring me, give me, craft me, for me. Bring/deliver without another named recipient also means the speaker.',
        bot: 'The bot: for yourself, get yourself, for your own use, keep it.',
        unspecified: 'No recipient is stated: craft a chest, make eight stairs, collect eight blocks, get a pickaxe. The application will keep the items in the bot inventory.',
      }),
      target: choice('Assuming come or follow, which available player should the bot approach? "me" or no name means the speaker.', Object.fromEntries([...new Set([from, ...(context.players || [])])].map(name => [name, name === from ? `${name}: the speaker (me)` : name]))),
      material: choice('Assuming the request is a small house, which primary construction material should be used? Current explicit materials take priority. When unspecified, use relevant explicit memory notes, then learned wood preferences in memory.preferences. Use oak_planks only if there is no relevant preference.', {
        oak_planks: 'Oak planks: explicitly requested, preferred, or the default when there is no relevant memory.',
        cobblestone: 'Cobblestone.', dirt: 'Dirt.', other: 'Another specified or remembered preferred building material (including cherry or other wood species); resolve it from the full catalog.',
      }),
    },
  });
  const a = response.answers;
  if (!a || !Object.hasOwn(TYPES, a.objective?.choice) || !Object.hasOwn(INTERACTIONS, a.interaction?.choice) || !Number.isFinite(a.addressed?.noul)) {
    throw new Error('Invalid Jev interpretation response');
  }
  if (!address.explicit && a.addressed.noul < 0.5) return null;
  // The memory classifier separately distinguishes a personal statement from
  // quoted, hypothetical or negated instructions. Such statements are useful
  // even when the broad action/discussion classifier calls them discussion.
  const kind = a.objective.choice === 'memory' || (a.interaction.choice === 'discussion' && a.memory_statement?.noul >= 0.75)
    ? 'memory' : a.interaction.choice === 'request' ? a.objective.choice : 'other';
  const spec = { kind, request, from, interpretation: a, usage: response.usage };
  const preferences = requestedPreferences(kind, a.wood_choice, woods);
  if (preferences.length) spec.implicitPreferences = preferences;
  if (kind === 'memory') return resolveMemory(client, spec, username, context);
  if (['come', 'follow'].includes(kind)) {
    const target = a.target?.choice;
    if (![from, ...(context.players || [])].includes(target)) throw new Error('Unknown movement target');
    spec.target = target;
  }
  if (kind === 'build' && context.continueBuilds) {
    // Code offers only structures that actually stand nearby; Jev decides
    // whether this request continues one, and where a new one should go.
    const continuation = await context.continueBuilds(request, context.builds || []);
    spec.buildContinuation = { mode: continuation.mode, target: continuation.target?.id, placement: continuation.placement, judgments: continuation.judgments };
    // Finishing and repairing reuse the saved plan; extending designs something
    // new and places it against the structure it is extending.
    if (['finish', 'repair'].includes(continuation.mode)) spec.continueBuild = { id: continuation.target.id, mode: continuation.mode };
    if (continuation.mode === 'extend') spec.buildId = continuation.target.id;
    // Attach beside the structure, never on top of its own origin: the origin
    // is the min corner, so centring a new footprint there buries it inside the
    // building it is meant to adjoin. The entrance is outside by construction.
    const beside = target => ({ ...(target.entrance || target.origin) });
    if (continuation.placement === 'beside_target' && continuation.target) spec.buildAnchor = beside(continuation.target);
    else if (continuation.mode === 'extend') spec.buildAnchor = beside(continuation.target);
  }
  if (kind === 'build' && !spec.buildAnchor && spec.buildContinuation?.placement === 'here' && context.speakerPosition) {
    spec.buildAnchor = { ...context.speakerPosition };
  }
  if (kind === 'find') {
    const resolution = await resolveDiscovery(client, context.registry || require('minecraft-data')('26.1'), request);
    if (!resolution.target) return { ...spec, kind: 'clarify', message: 'Which Minecraft biome, creature, or block should I look for?' };
    spec.discoveryTarget = resolution.target; spec.discoveryResolution = resolution;
  }
  if (['obtain', 'craft'].includes(kind) && a.outputs?.choice === 'multiple') {
    const resolution = await resolveItemBundle(client, context.registry || require('minecraft-data')('26.1'), request, numbers, { inventory: context.inventory || {}, memory: context.memory });
    if (!resolution.items.length) return { ...spec, kind: 'clarify', message: 'I could not resolve the whole item list. Please name the items or armor material so I can keep every part of your request.' };
    return { ...spec, kind: 'bundle', tasks: resolution.items.map(item => ({ ...item, from, status: 'pending' })), itemResolution: resolution };
  }
  if (['obtain', 'craft'].includes(kind) || (kind === 'house' && (a.material?.choice === 'other' || context.memory?.notes?.length || context.memory?.preferences?.length))) {
    const registry = context.registry || require('minecraft-data')('26.1');
    const resolution = await resolveItem(client, registry, request, { blocksOnly: kind === 'house',
      context: { inventory: context.inventory || {}, nearbyBlocks: context.nearbyBlocks || [], memory: context.memory, ...(kind === 'house' && { purpose: 'Primary structural material for a house. A preferred wood species means its planks, not its log or a decorative item.' }) } });
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
  const all = [...blocks, ...empty];
  const bounds = { min: { x: Math.min(...all.map(p => p.x)), y: Math.min(...all.map(p => p.y)), z: Math.min(...all.map(p => p.z)) },
    max: { x: Math.max(...all.map(p => p.x)), y: Math.max(...all.map(p => p.y)), z: Math.max(...all.map(p => p.z)) } };
  return { origin: { ...o }, blocks, empty, bounds, entrance: { ...o.offset(0, 0, -3) } };
}

function verifyHouse(bot, blueprint) {
  if (!blueprint) return { ok: false, reason: 'No building site selected' };
  const missing = blueprint.blocks.filter(p => !buildCellComplete(bot, p));
  const obstructed = blueprint.empty.filter(p => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return !b || !['air', 'cave_air', 'void_air'].includes(b.name);
  });
  return { ok: !missing.length && !obstructed.length, missing: missing.length, obstructed: obstructed.length };
}

module.exports = { interpret, quantityCandidates, GoalStore, houseBlueprint, verifyHouse };
