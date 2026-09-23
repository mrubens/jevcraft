'use strict';
// What the player asked for: the questions that turn a chat message into a
// request. Most go in one batch (objectives.js asks them together, the
// speculative ones alongside), then the catalog, bundle, memory and
// discovery walks ask their own. Each question is defined here with its
// text, stakes and the bar its answer must clear; the callers build the
// candidates, read the answers, and take their own clarifying path below
// a bar (gate.below 'caller').
const { choice, noul, score } = require('../typesafe');
const { define } = require('./index');

// How sure Jev has to be before the bot acts on what was asked. The bar is
// higher for the requests that cost hours or change the world: a misheard
// "come here" costs a few seconds, a misheard "build a castle" costs an
// afternoon. Answers that carry no confidence figure are not gated.
const COSTLY = new Set(['build', 'house', 'operator_command', 'win', 'nether']);
const UNGATED = new Set(['other', 'status', 'stop', 'resume', 'dream']);
const BARS = { act: 0.5, costly: 0.65 };

const TYPES = {
  dream: 'Give, ask about, pause, resume or take away the bot\'s DREAM, the long goal it chases when nothing else needs it: "your dream is to beat the game", "dream of building a village", "what is your dream", "chase your dream", "set your dream aside", "forget your dream". A one-off request to build one thing or get one item is not this.',
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

const request = spec => define({ area: 'intake', kind: 'request', ...spec });

// The routing pair: what is wanted, and whether anything should happen.
request({
  id: 'intake_objective', primitive: 'choice', stakes: 'high',
  gate: { threshold: BARS.costly, below: 'caller', why: 'unsure, the bot asks which of the two likeliest outcomes was meant; the bar is 0.65 for the costly kinds and 0.5 for the rest, and none for other, status, stop, resume and dream' },
  bars: BARS,
  build: () => choice('Categorize the requested outcome in `request` in the Minecraft game. Creative, Survival, Adventure and Spectator name game modes even when the word "mode" is omitted. Item requests belong to obtain or craft regardless of which particular Minecraft item is named. Choose obtain for collect/get/gather/fetch requests even when the item can be crafted; choose craft for explicit make/craft/create inventory items. Recipes and feasibility are checked after routing. A simple small house is house; custom structures and mansions are build; crafting an inventory item is craft. Coming once differs from continuously following. Changing the world or player with an explicitly requested command effect is operator_command.', TYPES),
});
request({
  id: 'intake_interaction', primitive: 'choice', stakes: 'high',
  gate: { threshold: BARS.costly, below: 'caller', why: 'for a costly kind, unsure whether it was an instruction or talk, the bot asks "now, or were we just talking?"' },
  build: () => choice('Classify the speaker intent in `request_body`, with the bot name prefix removed. The speaker is talking to a Minecraft bot. Is this an instruction to perform an action/report its current activity, or a discussion without an instruction to act? Judge intent, not feasibility or the topic.', INTERACTIONS),
});
request({
  id: 'intake_addressed', primitive: 'noul', stakes: 'medium',
  gate: { threshold: 0.5, below: 'caller', why: 'a message not clearly for this bot is left to the players it was for' },
  build: () => noul('Is `request` directed at this bot asking it to act or report, rather than conversation with another player? All names in `bot_names` refer to this same bot. `explicitly_addressed` records a direct name prefix.'),
});
request({
  id: 'intake_memory_statement', primitive: 'noul', stakes: 'medium',
  gate: { threshold: 0.75, below: 'caller', why: 'a discussion is saved as a memory only when Jev is sure it is a personal statement for Jev' },
  build: () => noul('Is the speaker directly sharing a personal preference or personal fact with Jev to remember, rather than asking for a gameplay action? For example "I prefer small houses" or "my favorite wood is cherry". Exclude quoted/hypothetical/negated statements, general Minecraft facts, and instructions to perform a new action.'),
});
// A Score, so the survival trade-offs later can weigh how much the player
// minds waiting. "Quick, before dark" and "whenever you get a chance" are
// the same objective with different tolerances.
request({
  id: 'intake_urgency', primitive: 'score', stakes: 'low',
  build: () => score('How much time pressure does the speaker put on this request, judging only the wording of `request_body`? Politeness is not urgency; a plain imperative is ordinary.', [
    'No time pressure, or explicitly relaxed: whenever you can, no rush, when you get a chance.',
    'Ordinary: a plain request with no timing words either way.',
    'Pressed: quickly, hurry, now, right away, before dark, as fast as you can, or a stated deadline.',
  ]),
});

// What the request is about: the item, how many, for whom, from what.
request({
  id: 'intake_item', primitive: 'choice', stakes: 'medium',
  gate: { threshold: 0.6, below: 'caller', why: 'unsure of the pick among the word-overlap candidates, the full catalog walk decides instead' },
  build: ({ candidates }) => choice({
    task: 'Assuming an obtain or craft request for ONE type of output, which listed catalog item is the requested output? These candidates were found by word overlap with the request and may include irrelevant items. Select the requested output, not a tool or ingredient needed to obtain it.',
    guidance: 'Match the requested species, color and item kind exactly. Current explicit choices override memory. For an unspecified wood variant, use relevant explicit memory notes first, then memory.preferences as a soft default, then oak. Bare grass means the grass plant unless grass block/turf is specified. Choose none if the requested item is not listed or the request names several outputs.',
  }, candidates),
});
request({
  id: 'intake_quantity', primitive: 'choice', stakes: 'medium',
  build: ({ numbers }) => choice('Assuming an item request, select the quantity applying to the requested output. Candidates were extracted from this request. "A/an" or "a single" item means 1. Stacks contain 64 items. If no requested output quantity is stated, select unspecified; do not invent a batch size.',
    { ...Object.fromEntries(numbers.map(n => [n, `${n} items requested by a quantity in the message`])), unspecified: 'No stated output quantity; the application will use its default.' }),
});
request({
  id: 'intake_outputs', primitive: 'choice', stakes: 'medium',
  build: () => choice('Assuming an obtain/craft request, does the player want one type of output or multiple types/a set? Full diamond armor is four outputs even without listing them. Ingredients mentioned only as a means to make one output do not count.', {
    single: 'One type of final item, possibly many copies.', multiple: 'Several distinct final items or a full set, such as full armor, or armor and a bed.',
  }),
});
request({
  id: 'intake_delivery', primitive: 'choice', stakes: 'low',
  build: () => choice('Assuming an item request, identify the recipient stated in `request`. The speaker is the human and you/yourself refers to the bot. Select unspecified when the request only says to make, craft, get or collect an item without naming its recipient. Do not infer a recipient merely because a human issued the request.', {
    speaker: 'The human speaker: get me, bring me, give me, craft me, for me. Bring/deliver without another named recipient also means the speaker.',
    bot: 'The bot: for yourself, get yourself, for your own use, keep it.',
    unspecified: 'No recipient is stated: craft a chest, make eight stairs, collect eight blocks, get a pickaxe. The application will keep the items in the bot inventory.',
  }),
});
request({
  id: 'intake_target', primitive: 'choice', stakes: 'low',
  build: ({ from, players = [] }) => choice('Assuming come or follow, which available player should the bot approach? "me" or no name means the speaker.',
    Object.fromEntries([...new Set([from, ...players])].map(name => [name, name === from ? `${name}: the speaker (me)` : name]))),
});
request({
  id: 'intake_material', primitive: 'choice', stakes: 'medium',
  build: () => choice('Assuming the request is a small house, which primary construction material should be used? Current explicit materials take priority. When unspecified, use relevant explicit memory notes, then learned wood preferences in memory.preferences. Use oak_planks only if there is no relevant preference.', {
    oak_planks: 'Oak planks: explicitly requested, preferred, or the default when there is no relevant memory.',
    cobblestone: 'Cobblestone.', dirt: 'Dirt.', other: 'Another specified or remembered preferred building material (including cherry or other wood species); resolve it from the full catalog.',
  }),
});

// Wood: chosen in this message, and preferred in the notes.
request({
  id: 'intake_wood_choice', primitive: 'choice', stakes: 'low',
  gate: { threshold: 0.7, below: 'caller', why: 'a wood species is learned as a preference only when the message clearly chose it' },
  build: ({ woods }) => choice('Which wood species does the speaker explicitly choose for their own requested supplies or construction in THIS message? Use only the current request, never memory, inventory, recipe ingredients, or bot defaults as evidence. A one-time request for cherry logs counts. Exclude quotes, hypotheticals, negated choices, orders for another player or the bot itself, discovery-only requests, and ambiguous/multiple species. For unspecified wood or an inherited preference choose none.', { ...woods, none: 'No single explicit wood choice for this player in the current action request.' }),
});
define({
  id: 'noted_wood', area: 'intake', kind: 'preferences', primitive: 'choice', stakes: 'low',
  gate: { threshold: 0.7, below: 'caller', why: 'an old wood preference is replaced by a note only when the note clearly states one' },
  build: ({ woods }) => choice('Which wood species do the personal notes in `memory.notes` (or `playerNotes`) explicitly prefer? Use the latest clear preference if notes conflict. Exclude quotes, hypotheticals and species the player dislikes. Choose none if the notes do not state a positive wood preference.',
    { ...woods, none: 'No explicit positive wood preference in these notes.' }),
});

// The catalog walk and the multi-item bundle.
// Below the bar at a leaf the pick is a question: "did you mean A or B?"
// when a runner-up is close, and always below the floor.
define({
  id: 'catalog_branch', area: 'item', kind: 'catalog', primitive: 'choice', stakes: 'medium',
  gate: { threshold: 0.5, below: 'caller', why: 'unsure at a leaf, the bot asks "did you mean A or B?" when a runner-up holds 0.25, and always below 0.35' },
  ambiguous: { confidence: 0.5, runnerUp: 0.25, floor: 0.35 },
  build: ({ blocksOnly, options }) => choice({ task: blocksOnly ? 'Select the next catalog branch containing the requested building material.' :
    'Select the next catalog branch containing the item the player wants obtained or crafted. Select the requested output, not a tool or ingredient needed to obtain it.',
  guidance: 'Each branch is generated from the actual Minecraft catalog. Match the requested species, color, and item kind. Current explicit choices override memory. For an unspecified wood variant, use relevant explicit memory notes first, then memory.preferences as a soft default; a remembered species applies to logs, planks, and wooden variants, not unrelated items. If there is no relevant wood preference, use oak as the ordinary unspecified wood default. Do not add outputs or infer a new player choice from a default. Bare grass means the grass plant unless grass block/turf is specified. Lexical suggestions are hints, not restrictions. Choose none only if none of these branches contains the requested item.' },
  { ...options, none: 'No branch contains the requested item or material.' }),
});
define({
  id: 'bundle_candidate', area: 'item', kind: 'bundle', primitive: 'noul', stakes: 'medium',
  gate: { threshold: 0.65, below: 'caller', why: 'a catalog branch is followed only when Jev is sure it holds a requested output' },
  build: ({ index }) => noul({
    task: `Does candidates.candidate_${index} contain at least one of the FINAL outputs the player requests? Select every requested output, including members of explicitly requested sets.`,
    rules: 'Full armor means helmet, chestplate, leggings and boots in the named material, not weapons or horse/wolf armor. Exclude ingredients, tools needed to obtain outputs, negated items, and optional suggestions. An unspecified variant means ONE ordinary default, not all variants: white for an uncolored bed/wool; for unspecified wooden objects use relevant explicit context.memory notes, then context.memory.preferences, then oak if neither applies. Honor current explicit colors/species over memory, and choose only one matching variant. A branch can contain a requested output even when its description only shows some examples.',
  }),
});
define({
  id: 'bundle_covered', area: 'item', kind: 'bundle', primitive: 'noul', stakes: 'medium',
  gate: { threshold: 0.65, below: 'caller', why: 'unsure the list is whole, the bot asks the player to name the items rather than drop one' },
  build: () => noul('Do selectedOutputs cover ALL final item outputs requested in request, including every piece of a requested set, with no extra unrequested outputs? Ingredients mentioned only as a means are not outputs. For an unspecified variant, one matching default counts as satisfying the requested item: use explicit context.memory notes, then learned context.memory.preferences for wood, otherwise ordinary white/oak defaults. A preferred cherry plank is still a plank, not an extra output. Past tasks in memory are not current requests and must not add outputs. Answer no if any output is missing or any unrelated item was added.'),
});
define({
  id: 'bundle_quantity', area: 'item', kind: 'bundle', primitive: 'choice', stakes: 'medium',
  build: ({ item, numbers }) => choice(`How many ${item} are requested in request? Apply numbers only to this output. A full set contains one of each member; two sets contain two of each. An unspecified amount is default.`,
    { ...Object.fromEntries(numbers.map(n => [n, `${n} of ${item}`])), default: 'No explicit amount: one item (or the ordinary concrete batch).' }),
});
define({
  id: 'bundle_recipient', area: 'item', kind: 'bundle', primitive: 'choice', stakes: 'low',
  build: ({ item }) => choice(`Who should receive ${item} in request? Use the recipient for the whole list unless the player gives this item a different recipient.`, {
    speaker: 'Give/bring/deliver to the speaker (me/for me); bring without another named recipient.',
    bot: 'Keep it, for yourself, or no recipient specified.',
  }),
});

// Finding something in the world.
define({
  id: 'discovery_category', area: 'intake', kind: 'discovery', primitive: 'choice', stakes: 'low',
  build: () => choice('Assuming the player wants to FIND something in the world, what kind of thing is it? A biome is an environment such as a cherry grove; a sheep is a living entity; a cherry log is a block. This locates things through exploration, without commands.', {
    biome: 'A biome or environment to visit.', entity: 'A living animal, creature or mob to find without attacking it.',
    block: 'A block or plant to locate, rather than collect.', none: 'No supported biome, living entity or block.',
  }),
});
define({
  id: 'discovery_target', area: 'travel', kind: 'discovery', primitive: 'choice', stakes: 'medium',
  build: ({ options }) => choice('Choose the catalog branch or exact target matching the requested biome or creature. Names and members come from this Minecraft version. Cherry biome means cherry_grove. Do not replace the requested species with a nearby alternative.', {
    ...options, none: 'No match in this catalog.',
  }),
});

// Memory: what the player wants done with it, and which entry.
define({
  id: 'memory_operation', area: 'memory', kind: 'memory', primitive: 'choice', stakes: 'medium',
  gate: { threshold: 0.75, below: 'caller', why: 'forgetting cannot be undone: an unsure "forget" is a question back ("say exactly what")' },
  build: () => choice('What memory interaction does the CURRENT speaker want? A personal preference or fact shared directly with Jev can be saved as a note. Quoted instructions, hypotheticals, explanations of memory, and requests not to remember are none.', {
    remember_place: 'Save or name a place at a stated coordinate or observed location: remember this as home, this is our base, mark where I am as the mine.',
    remember_note: 'Remember a fact or preference told by this player: remember I like cherry wood, I prefer small houses. No movement or other gameplay action.',
    recall: 'Report a remembered fact, place, or past task: where is home, what wood do I like, what did I ask last time, what do you remember? Do not travel.',
    forget: 'Explicitly remove saved memories: forget the old base, forget my wood preference, forget everything you remember about me.',
    visit: 'Walk or travel to a named saved place: go home, return to the mine, take me back to our base. Never teleport.',
    repeat: 'Explicitly do a past request AGAIN as a new task: make another one like last time, repeat my last request. Resume unfinished progress is not repeat.',
    none: 'No supported memory action, or a negated/hypothetical/quoted instruction. Do not change memory or start work.',
  }),
});
// The "which entry" questions. Each is asked over entries the code offers
// (verbatim spans, observed positions, saved entries), in groups of 24 when
// there are more: `grouped` asks for the group first.
const selection = (id, stakes, text, extra = {}) => define({ id, area: 'memory', kind: 'memory', primitive: 'choice', stakes, ...extra,
  build: ({ criteria, grouped, ...args }) => { const t = typeof text === 'function' ? text(args) : text; return choice(grouped ? `Choose the group containing the matching entry. ${t}` : t, criteria); } });
selection('memory_entry', 'high', ({ operation }) => `Select the saved entry matching the current ${operation} request. For last/previous choose the latest matching timestamp. Choose none if ambiguous or missing. Names may be paraphrased.`, {
  gate: { threshold: 0.75, below: 'caller', why: 'forget below 0.75 asks which memory; repeating a costly past request below 0.65 asks the player to ask directly' },
  bars: { forget: 0.75, repeat: 0.65 }, repeatCostly: COSTLY,
});
selection('memory_place_name', 'low', 'Choose the shortest complete place NAME in the message. Keep distinguishing words (red barn, north mine). Omit framing such as remember, this is, our, as, please and coordinates. Copy only the name.');
selection('memory_place_location', 'medium', 'Choose the location the player is explicitly naming. The offered positions are known observations. Here/this/this place means the speaking player location, not the bot location. "Remember this as ..." labels where the speaker stood. Prefer written coordinates when supplied. A place merely mentioned without coordinates or an indication of here/this/where I am is none.');
selection('memory_place_dimension', 'low', ({ current }) => `Which dimension do the written coordinates refer to? Default to the current dimension ${current} unless the message explicitly says another.`);
selection('memory_note_replaces', 'medium', 'Assuming this message saves a new note, which existing note does it clearly update or contradict? Select none for a separate fact or preference.');

module.exports = { TYPES, INTERACTIONS, COSTLY, UNGATED, BARS };
