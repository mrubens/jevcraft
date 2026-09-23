'use strict';
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');
const { dryStanding } = require('./mining-access');
const { immediateThreat, safeFromHostiles } = require('./danger');
const { collectNearbyDrops, pickupPositions } = require('./drop-collection');
const { isolated, canBegin, huntObserved } = require('./mob-hunt');
const { SURPLUS, crowded } = require('./inventory-tidy');
const { isKeepsake, isKitMaterial } = require('./home-stash');

// The surface twin of the ore check: what lies on the ground and what
// walks past during a mine or tunnel step. A keepsake or a piece of the
// kit lying within eight blocks is a rule, picked up without a question,
// the way coal is with no fuel in the pockets: nothing is better served by
// walking past string. An animal is a judgment. A sheep in view with fewer
// than three wool carried, or a chicken with fewer than four feathers, is
// offered to Jev alongside continuing, once every third step, and the
// chase runs through the machinery the bed rung and the bow rung already
// use. Either way the detour is bounded and the main step resumes where
// it stood.
const LIMITS = Object.freeze({ dropRadius: 8, dropMs: 10000, animalRadius: 12, animalMs: 45000, primarySteps: 3 });
const RECENT_MS = 120000;
const plain = p => ({ x: p.x, y: p.y, z: p.z });
const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name);
const overworld = bot => /overworld$/.test(String(bot.game?.dimension || 'overworld'));
const baby = (bot, entity) => entity.metadata?.[(bot.registry?.entitiesByName?.[entity.name]?.metadataKeys || []).indexOf('baby')] === true;
const woolCarried = bot => require('./home-base').woolCarried(bot).total;

// The animals worth a short chase, and what makes them worth it.
const ANIMALS = Object.freeze({
  sheep: { label: 'wool', wanted: 3, carried: woolCarried, drops: name => /_wool$/.test(name) },
  chicken: { label: 'feathers', item: 'feather', wanted: 4, carried: bot => countOf(bot, 'feather'), drops: name => name === 'feather' },
});

const skippedRecently = (goal, key) => goal.opportunistic?.skipped?.[key] > Date.now() - RECENT_MS;

// Dropped items within reach that the chest would keep or the kit would
// use, one candidate per item name, nearest first. What the surplus tidy
// would toss again is not picked up: the loop of dropping and fetching
// a stack of cobblestone is not opportunism.
// A few drops are never left for want of room: the bot's own staircase dug
// a diamond out and the pockets were too full to look, so it lay there.
const PRECIOUS = /^(diamond|emerald|ancient_debris|netherite_scrap|netherite_ingot|enchanted_golden_apple|trial_key|ominous_trial_key|heavy_core|echo_shard)$/;
function dropCandidates(bot, goal = {}) {
  if (!bot.entities || bot.game?.gameMode === 'creative' || !dryStanding(bot, bot.entity.position) || immediateThreat(bot)) return [];
  const full = crowded(bot);
  const here = bot.entity.position, out = [], seen = new Set();
  for (const entity of Object.values(bot.entities)) {
    const dropped = entity.getDroppedItem?.();
    const item = dropped?.name;
    if (!item || entity.isValid === false || !entity.position || seen.has(item)) continue;
    if (full && !PRECIOUS.test(item)) continue;
    if (entity.position.distanceTo(here) > LIMITS.dropRadius) continue;
    if (!(isKeepsake(item) || isKitMaterial(bot, item) || PRECIOUS.test(item))) continue;
    if (item in SURPLUS && countOf(bot, item) >= SURPLUS[item]) continue;
    if (skippedRecently(goal, `drop:${item}`)) continue;
    if (!safeFromHostiles(bot, entity.position) || !pickupPositions(bot, entity).length) continue;
    seen.add(item);
    out.push({ item, count: dropped.count || 1, position: entity.position.clone(), distance: entity.position.distanceTo(here), carried: countOf(bot, item) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// The nearest isolated adult of each animal whose drop is short, on the
// surface, with the bot fit for a passive chase.
function animalCandidates(bot, goal = {}) {
  if (!bot.entities || bot.game?.gameMode === 'creative' || !overworld(bot) || !canBegin(bot, { passive: true }) || immediateThreat(bot)) return [];
  const here = bot.entity.position, out = [];
  for (const [animal, rule] of Object.entries(ANIMALS)) {
    const carried = rule.carried(bot);
    if (carried >= rule.wanted) continue;
    const target = Object.values(bot.entities).filter(e => e.name === animal && e.isValid !== false && e.position && !baby(bot, e) &&
      e.position.distanceTo(here) <= LIMITS.animalRadius && !skippedRecently(goal, `mob:${e.uuid || e.id}`) &&
      isolated(bot, e, { passive: true }) && safeFromHostiles(bot, e.position))
      .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
    if (target) out.push({ animal, entity: target, label: rule.label, carried, wanted: rule.wanted, distance: target.position.distanceTo(here) });
  }
  return out;
}

// A task that also runs out: the wrapped task's cancellation and the
// interrupt check a hunt installs on it, plus a deadline of its own.
function boundedTask(task, deadline, message) {
  return { get cancelled() { return task.cancelled; }, interruptCheck: undefined, check() {
    task.check(); this.interruptCheck?.();
    if (Date.now() >= deadline) { const error = new Error(message); error.name = 'DetourBudget'; throw error; }
  } };
}

async function backToStart(bot, bounded, navigate, start, deadline) {
  if (Date.now() >= deadline || bot.entity.position.distanceTo(start) <= 1) return;
  try { await navigate(bot, bounded, new goals.GoalBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)), { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500 }); }
  catch (err) { if (fatal(err)) throw err; }
}

async function pickUpDrops(bot, task, goal, save, state, drops, { navigate, collect }) {
  const start = bot.entity.position.clone(), deadline = Date.now() + LIMITS.dropMs;
  const bounded = boundedTask(task, deadline, 'Short pickup detour budget exhausted');
  const originalStep = goal.step, picked = [];
  state.active = { kind: 'drops', items: drops.map(d => d.item), start: plain(start), deadline };
  state.lastDecision = { at: new Date().toISOString(), answer: { choice: 'drop_0', rule: 'keepsake' } };
  goal.step = { action: 'collect_nearby_resource', resource: drops[0].item, rule: 'keepsake', items: drops.map(d => ({ item: d.item, count: d.count })) }; save();
  try {
    for (const drop of drops) {
      if (Date.now() >= deadline) break;
      const before = countOf(bot, drop.item);
      try { await collect(bot, bounded, drop.item, { radius: LIMITS.dropRadius, origin: start, timeoutMs: Math.max(500, deadline - Date.now()), move: navigate }); }
      catch (err) { task.check(); if (fatal(err)) throw err; }
      const gained = countOf(bot, drop.item) - before;
      if (gained > 0) picked.push({ item: drop.item, count: gained }); else state.skipped[`drop:${drop.item}`] = Date.now();
    }
    await backToStart(bot, bounded, navigate, start, deadline);
    state.history.push({ kind: 'drops', rule: 'keepsake', pickedUp: picked, finishedAt: new Date().toISOString() });
    state.history = state.history.slice(-24);
  } finally { delete state.active; goal.step = originalStep; save(); }
  return picked.length > 0;
}

// A chicken goes through the mob hunt, which knows feathers; a sheep goes
// through the food chase, which knows sheep, and the wool is picked up
// beside the mutton the way the bed rung does it.
async function chase(bot, task, goal, save, state, candidate, { navigate, collect, hunt, observed }) {
  const start = bot.entity.position.clone(), deadline = Date.now() + LIMITS.animalMs;
  const bounded = boundedTask(task, deadline, 'Short chase budget exhausted');
  const rule = ANIMALS[candidate.animal], before = rule.carried(bot), originalStep = goal.step, where = candidate.entity.position.clone();
  state.active = { kind: 'animal', animal: candidate.animal, resource: rule.label, start: plain(start), position: plain(where), deadline };
  goal.step = { action: 'collect_nearby_resource', resource: rule.label, entity: candidate.animal, carried: before, wanted: rule.wanted }; save();
  try {
    if (rule.item) {
      const previous = goal.mobHunt;
      goal.mobHunt = { item: rule.item, entity: candidate.animal, targetCount: rule.wanted };
      try { await observed(bot, bounded, goal, save, { navigate }, null); }
      catch (err) { task.check(); if (fatal(err)) throw err; }
      finally { if (previous) goal.mobHunt = previous; else delete goal.mobHunt; }
    } else {
      try { await hunt(bot, bounded, candidate.entity, { navigate }, goal, save); }
      catch (err) { task.check(); if (fatal(err)) throw err; }
    }
    const lying = new Set(Object.values(bot.entities).filter(e => rule.drops(e.getDroppedItem?.()?.name || '') && e.position?.distanceTo(where) < 10).map(e => e.getDroppedItem().name));
    for (const item of lying) {
      if (Date.now() >= deadline) break;
      try { await collect(bot, bounded, item, { radius: 12, origin: where, timeoutMs: Math.max(500, Math.min(6500, deadline - Date.now())), move: navigate }); }
      catch (err) { task.check(); if (fatal(err)) throw err; }
    }
    const gained = rule.carried(bot) - before;
    if (gained <= 0) state.skipped[`mob:${candidate.entity.uuid || candidate.entity.id}`] = Date.now();
    await backToStart(bot, bounded, navigate, start, deadline);
    state.history.push({ kind: 'animal', animal: candidate.animal, resource: rule.label, pickedUp: Math.max(0, gained), finishedAt: new Date().toISOString() });
    state.history = state.history.slice(-24);
    return gained > 0;
  } finally { delete state.active; goal.step = originalStep; save(); }
}

async function opportunisticPickups(bot, task, goal, save, primary, actions, client = task.opportunityClient) {
  if (goal.kind === 'find' || goal.pendingDelivery) return false;
  const executors = { navigate: actions.navigate, collect: actions.collectDrops || collectNearbyDrops,
    hunt: actions.hunt || ((...args) => require('./foraging').hunt(...args)), observed: actions.huntObserved || huntObserved };
  const state = goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} };
  state.pickupSteps = (state.pickupSteps || 0) + 1;
  try {
    const drops = dropCandidates(bot, goal);
    // Room for the precious one first, junk thrown away from it.
    for (const d of drops.filter(d => PRECIOUS.test(d.item))) {
      const { roomFor, makeRoom } = require('./inventory-tidy');
      if (!roomFor(bot, d.item)) await makeRoom(bot, task, d.item, { away: d.position });
    }
    if (drops.length) return await pickUpDrops(bot, task, goal, save, state, drops, executors);
    const asking = state.pickupSteps % LIMITS.primarySteps === 0 && !!client;
    const animals = asking ? animalCandidates(bot, goal) : [];
    if (!animals.length) return false;
    const response = await require('./decisions').ask(client, { state: { request: goal.request, primary, inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
      limits: LIMITS, candidates: animals.map(({ entity, ...c }) => ({ ...c, position: plain(entity.position) })) },
    questions: { opportunity: ['opportunistic_animal', { options: Object.fromEntries(animals.map((c, i) => [`animal_${i}`, `${c.animal}: ${c.label}; carrying ${c.carried} of ${c.wanted} wanted; ${Math.round(c.distance)} blocks away.`])) }] },
    signal: AbortSignal.timeout(5000) });
    task.check();
    const selected = response.answers?.opportunity?.choice;
    state.lastDecision = { at: new Date().toISOString(), answer: response.answers?.opportunity, usage: response.usage };
    if (selected === 'continue') { for (const c of animals) state.skipped[`mob:${c.entity.uuid || c.entity.id}`] = Date.now(); save(); return false; }
    const index = /^animal_(\d+)$/.exec(selected || '')?.[1], candidate = index !== undefined && animals[Number(index)];
    if (!candidate) throw new Error('Invalid opportunistic pickup choice');
    if (!animalCandidates(bot, goal).some(c => c.entity === candidate.entity)) return false;
    return await chase(bot, task, goal, save, state, candidate, executors);
  } catch (error) {
    task.check();
    if (fatal(error)) throw error;
    // A failed optional detour must not fail or replace the main objective.
    state.lastError = error.message; save(); return false;
  }
}

module.exports = { PRECIOUS, LIMITS, ANIMALS, dropCandidates, animalCandidates, opportunisticPickups };
