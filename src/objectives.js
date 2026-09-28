'use strict';

const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');
const { buildCellComplete } = require('./build-blocks');
const { chatNames, parseAddress } = require('./chat-address');
const { resolveItem, itemCandidates, itemChoices } = require('./catalog');
const { resolveItemBundle } = require('./item-bundle');
const { resolveDiscovery } = require('./discovery');
const { resolveMemory } = require('./memory-routing');
const { woodChoices, requestedPreferences, preferenceContext } = require('./preferences');

// The questions, their bars and the request types are defined in
// decisions/intake.js; CONFIDENCE is kept as a view of those bars.
const { TYPES, INTERACTIONS, COSTLY, UNGATED, BARS } = require('./decisions/intake');
const { ask, question } = require('./decisions');
const CONFIDENCE = { ...BARS, item: question('intake_item').gate.threshold };
const PHRASES = {
  memory: 'remember or recall something', dream: 'change my dream', operator_command: 'run a server command', house: 'build a small house',
  build: 'design and build something', obtain: 'go and get an item', craft: 'craft an item', find: 'find something in the world',
  come: 'come to you', follow: 'follow you', nether: 'find a way to the Nether', win: 'set out to beat the game',
  stop: 'stop', status: 'report what I am doing', resume: 'resume the saved task', other: 'just talk',
};
const phrase = kind => PHRASES[kind] || String(kind).replaceAll('_', ' ');

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
  const registry = context.registry || require('minecraft-data')('26.1');
  const woods = woodChoices(registry);
  const memory = context.memory && { ...preferenceContext(context.memory), places: context.memory.places || [] };
  // Everything below is one request. The item, wood-note and discovery
  // questions are speculative: they cost nothing to answer alongside the
  // routing questions and save a round trip each when their branch is taken.
  // A plain "get me a pumpkin" used to be six requests in a row.
  const candidates = itemCandidates(registry, address.text, { limit: 24 });
  const candidateChoices = candidates.length ? itemChoices(candidates) : null;
  const started = performance.now();
  const response = await ask(client, { kind: 'request',
    state: { request, request_body: address.text, speaker: from, bot_name: username, bot_names: chatNames(username), explicitly_addressed: address.explicit,
      availablePlayers: context.players || [from], memory },
    questions: {
      item: candidateChoices && ['intake_item', { candidates: candidateChoices }],
      noted_wood: memory?.notes?.length && ['noted_wood', { woods }],
      discovery_category: ['discovery_category'],
      urgency: ['intake_urgency'],
      // Only worth asking when the name is missing: with it, the answer was
      // never read, and a missing answer still failed the whole request.
      addressed: !address.explicit && ['intake_addressed'],
      wood_choice: ['intake_wood_choice', { woods }],
      memory_statement: ['intake_memory_statement'],
      interaction: ['intake_interaction'],
      objective: ['intake_objective'],
      quantity: ['intake_quantity', { numbers }],
      outputs: ['intake_outputs'],
      delivery: ['intake_delivery'],
      target: ['intake_target', { from, players: context.players || [] }],
      material: ['intake_material'],
    },
  });
  const a = response.answers;
  if (!a || !Object.hasOwn(TYPES, a.objective?.choice) || !Object.hasOwn(INTERACTIONS, a.interaction?.choice) || (!address.explicit && !Number.isFinite(a.addressed?.noul))) {
    throw new Error('Invalid Jev interpretation response');
  }
  if (!address.explicit && a.addressed.noul < question('intake_addressed').gate.threshold) return null;
  // The memory classifier separately distinguishes a personal statement from
  // quoted, hypothetical or negated instructions. Such statements are useful
  // even when the broad action/discussion classifier calls them discussion.
  // Asking about the dream or a memory is a question to the bot, not a
  // discussion about one, however it is phrased.
  const kind = a.objective.choice === 'memory' || (a.interaction.choice === 'discussion' && a.memory_statement?.noul >= question('intake_memory_statement').gate.threshold)
    ? 'memory' : a.objective.choice === 'dream' ? 'dream' : a.interaction.choice === 'request' ? a.objective.choice : 'other';
  const spec = { kind, request, from, interpretation: a, usage: response.usage, latencyMs: Math.round(performance.now() - started) };
  // Kept as a plain number on the goal so decision state can carry it
  // without dragging the whole interpretation along.
  if (Number.isFinite(a.urgency?.score)) spec.urgency = { score: Number(a.urgency.score.toFixed(2)), confidence: a.urgency.confidence,
    level: a.urgency.score >= 1.5 ? 'pressed' : a.urgency.score >= 0.5 ? 'ordinary' : 'relaxed' };
  const clarify = (message, clarification) => ({ ...spec, kind: 'clarify', message, clarification });
  // A confident wrong answer starts ten minutes of the wrong work. An unsure
  // one is worth a sentence to the player.
  const confidence = a.objective.confidence;
  if (!UNGATED.has(kind) && Number.isFinite(confidence) && confidence < (COSTLY.has(kind) ? CONFIDENCE.costly : CONFIDENCE.act)) {
    const runnerUp = Object.entries(a.objective.probabilities || {}).filter(([key]) => key !== kind && Object.hasOwn(TYPES, key)).sort(([, x], [, y]) => y - x)[0]?.[0];
    return clarify(runnerUp ? `I'm not sure whether you want me to ${phrase(kind)} or ${phrase(runnerUp)}. Could you say it another way?`
      : `I'm not sure what you want me to do. Could you say it another way?`,
    { reason: 'uncertain_objective', question: 'objective', confidence, threshold: COSTLY.has(kind) ? CONFIDENCE.costly : CONFIDENCE.act, options: [kind, runnerUp].filter(Boolean) });
  }
  // Whether anything should happen at all is a judgment too. A bare
  // majority for "request" beside a sure "build" started an afternoon's
  // work on what may have been talk about building. The costly kinds need
  // the same surer answer on this question as on the objective.
  const asked = a.interaction.confidence;
  if (kind === a.objective.choice && !UNGATED.has(kind) && COSTLY.has(kind) && Number.isFinite(asked) && asked < CONFIDENCE.costly) {
    return clarify(`Do you want me to ${phrase(kind)} now, or were we just talking about it?`,
      { reason: 'uncertain_interaction', question: 'interaction', confidence: asked, threshold: CONFIDENCE.costly, options: [kind] });
  }
  const preferences = requestedPreferences(kind, a.wood_choice, woods);
  if (preferences.length) spec.implicitPreferences = preferences;
  if (kind === 'memory') return resolveMemory(client, spec, username, context);
  if (kind === 'dream') return require('./dream').resolveDream(client, spec);
  const noted = a.noted_wood && (a.noted_wood.choice === 'none' || Object.hasOwn(woods, a.noted_wood.choice)) ? a.noted_wood : undefined;
  if (['come', 'follow'].includes(kind)) {
    const target = a.target?.choice;
    if (![from, ...(context.players || [])].includes(target)) throw new Error('Unknown movement target');
    spec.target = target;
  }
  if (kind === 'build' && context.continueBuilds) {
    // Code offers only structures that actually stand nearby; Jev decides
    // whether this request continues one, and where a new one should go.
    const continuation = await context.continueBuilds(request, context.builds || []);
    spec.buildContinuation = { mode: continuation.mode, target: continuation.target?.id, name: continuation.target?.name,
      placement: continuation.placement, judgments: continuation.judgments };
    // Finishing and repairing reuse the saved plan; extending designs something
    // new and places it against the structure it is extending.
    if (['finish', 'repair'].includes(continuation.mode)) spec.continueBuild = { id: continuation.target.id, mode: continuation.mode };
    if (continuation.mode === 'edit') spec.buildId = continuation.target.id;
    // Attach beside the structure, never on top of its own origin: the origin
    // is the min corner, so centring a new footprint there buries it inside the
    // building it is meant to adjoin. The entrance is outside by construction.
    const beside = target => ({ ...(target.entrance || target.origin) });
    if (continuation.placement === 'beside_target' && continuation.target) spec.buildAnchor = beside(continuation.target);
    else if (continuation.mode === 'edit') spec.buildAnchor = beside(continuation.target);
  }
  if (kind === 'build' && !spec.buildAnchor && spec.buildContinuation?.placement === 'here' && context.speakerPosition) {
    spec.buildAnchor = { ...context.speakerPosition };
  }
  if (kind === 'find') {
    const category = ['biome', 'entity', 'block', 'none'].includes(a.discovery_category?.choice) ? a.discovery_category : undefined;
    const resolution = await resolveDiscovery(client, registry, request, { category });
    if (!resolution.target) return clarify('Which Minecraft biome, creature, or block should I look for?', { reason: 'no_discovery_target' });
    spec.discoveryTarget = resolution.target; spec.discoveryResolution = resolution;
  }
  if (['obtain', 'craft'].includes(kind) && a.outputs?.choice === 'multiple') {
    const resolution = await resolveItemBundle(client, registry, request, numbers, { inventory: context.inventory || {}, memory: context.memory });
    if (!resolution.items.length) return clarify('I could not resolve the whole item list. Please name the items or armor material so I can keep every part of your request.', { reason: 'incomplete_bundle' });
    return { ...spec, kind: 'bundle', tasks: resolution.items.map(item => ({ ...item, from, status: 'pending' })), itemResolution: resolution };
  }
  if (['obtain', 'craft'].includes(kind) || (kind === 'house' && (a.material?.choice === 'other' || context.memory?.notes?.length || context.memory?.preferences?.length))) {
    // A confident pick from the word-overlap candidates settles the item in
    // the request's own round trip. Anything less walks the full catalog.
    const picked = kind !== 'house' && candidateChoices && a.item;
    const direct = picked && picked.choice !== 'none' && Object.hasOwn(candidateChoices, picked.choice) && picked.confidence >= CONFIDENCE.item;
    const resolution = direct
      ? { item: picked.choice, path: ['request_candidates', picked.choice], direct: true, latencyMs: 0,
        judgments: [{ path: [], options: candidateChoices, answer: picked, usage: null, direct: true }] }
      : await resolveItem(client, registry, request, { blocksOnly: kind === 'house', noted,
        context: { inventory: context.inventory || {}, nearbyBlocks: context.nearbyBlocks || [], memory: context.memory, ...(kind === 'house' && { purpose: 'Primary structural material for a house. A preferred wood species means its planks, not its log or a decorative item.' }) } });
    spec.itemResolution = resolution;
    if (resolution.ambiguous) {
      const [first, second] = resolution.ambiguous.map(name => name.replaceAll('_', ' '));
      return clarify(`Did you mean ${first} or ${second}?`, { reason: 'ambiguous_item', options: resolution.ambiguous });
    }
    if (!resolution.item) return clarify('I could not match the requested item. Use its Minecraft item name so I can work out the recipe.', { reason: 'no_item' });
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
    // A value that loops back on itself is dropped and said, not thrown: a
    // throw here ended the process with the bot in lava (note 569's route
    // kept on a cell that its own route held, 2026-09-28).
    let text;
    try { text = JSON.stringify(goal, null, 2); } catch (err) {
      const seen = new WeakSet(), dropped = [];
      text = JSON.stringify(goal, function (key, value) {
        if (value && typeof value === 'object') {
          if (seen.has(value)) { dropped.push(key); return undefined; }
          seen.add(value);
        }
        return value;
      }, 2);
      console.error('[bug] saved goal had a value that loops back on itself; dropped:', dropped.slice(0, 5).join(', '));
    }
    fs.writeFileSync(`${this.file}.tmp`, text);
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

module.exports = { interpret, quantityCandidates, GoalStore, houseBlueprint, verifyHouse, CONFIDENCE, TYPES };
