'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf, surveyRoute } = require('./skills');
const { dryMiningPositions, miningReach, dryStanding } = require('./mining-access');
const { immediateThreat, safeFromHostiles } = require('./danger');
const { reservedForConstruction } = require('./build-sites');
const { supportCell } = require('./terrain');

const LIMITS = Object.freeze({ radius: 6, routeSteps: 10, durationMs: 12000, primarySteps: 3 });
const pos = p => new Vec3(p.x, p.y, p.z);

// What the bot is short of, said to Jev with the ore. Every smelt on the
// ladder burns something, and underground the something is the planks that
// the next pickaxe needs. The dream run walked past coal ore with no fuel in
// the pockets while Jev, asked about "surplus" and told nothing of the
// shortage, chose to continue. Now it is asked whenever a short ore is in
// reach, with the shortage in the option; without Jev the ore is taken.
const FUEL_UNITS_WANTED = 8;
const fuelCarried = bot => bot.inventory.items().reduce((n, i) => n + (i.name === 'coal' || i.name === 'charcoal' ? i.count : i.name === 'coal_block' ? i.count * 9 : 0), 0);
// Gold in the Nether is pearls: nine ingots a pearl bartered with piglins
// (see bartering.js), so nether gold ore within reach is taken while the
// pearls are short, like coal while the fuel is.
const PEARLS_WANTED = 16;
const GOLD_BLOCKS = /^(nether_gold_ore|gilded_blackstone|gold_block|gold_ore|deepslate_gold_ore)$/;
const piglinsWithin = (bot, p, r) => Object.values(bot.entities || {}).some(e => /^piglin/.test(e.name || '') && e.isValid !== false && e.position && e.position.distanceTo(p) <= r);
// And diamonds, always, and iron while short: the bot walked a shaft past a
// diamond because the question is asked every third step, and the answer
// was never in doubt. Iron is every tool, armour piece and bucket.
const IRON_WANTED = 32;
const ironShort = bot => countOf(bot, 'raw_iron') + countOf(bot, 'iron_ingot') < IRON_WANTED;
// Lapis too, while fewer than sixteen are carried: it is what an enchant
// costs, and the End is fought better in enchanted gear (a watcher,
// 2026-09-24).
const LAPIS_WANTED = 16;
const lapisShort = bot => countOf(bot, 'lapis_lazuli') < LAPIS_WANTED;
const shortage = (bot, candidate) => {
  if (candidate.resource === 'coal' && fuelCarried(bot) < FUEL_UNITS_WANTED) return `short of fuel: ${fuelCarried(bot)} smelts carried, ${FUEL_UNITS_WANTED} wanted, and without it the next smelt burns the planks a pickaxe needs`;
  if (candidate.resource === 'gold_nugget' && /nether/.test(String(bot.game?.dimension || '')) && countOf(bot, 'ender_pearl') < PEARLS_WANTED) return `short of pearls: ${countOf(bot, 'ender_pearl')} of ${PEARLS_WANTED}; a block of nether gold ore gives 2 to 6 nuggets (about 4, about 0.44 of an ingot), and nine gold ingots barter a pearl from piglins, so about 1/20 of a pearl a block`;
  if (candidate.resource === 'diamond' && countOf(bot, 'diamond') < 64) return 'diamonds: the best tools and armour, and rare';
  if (candidate.resource === 'raw_iron' && ironShort(bot)) return `short of iron: ${countOf(bot, 'raw_iron') + countOf(bot, 'iron_ingot')} of ${IRON_WANTED}; every tool, armour piece, shield and bucket`;
  if (candidate.resource === 'lapis_lazuli' && lapisShort(bot)) return `short of lapis: ${countOf(bot, 'lapis_lazuli')} of ${LAPIS_WANTED}; enchanting costs it`;
  return null;
};
const neededByRule = (bot, candidate) => !!shortage(bot, candidate);
// The health and food at which a detour is taken without asking.
const VITALS = Object.freeze({ health: 16, food: 14 });
const vitalsFit = bot => !(bot.health < VITALS.health) && !(bot.food < VITALS.food);

// `names`: the blocks looked for, ores by default. `vitals`: whether health
// under 16 or food under 14 takes every candidate away; the look in passing
// says the vitals to Jev instead (note 653).
function opportunityCandidates(bot, goal, primary, { radius = LIMITS.radius, names = null, vitals = true } = {}) {
  if (!bot.registry?.blocksArray || !bot.findBlocks || (vitals && !vitalsFit(bot)) || bot.game?.gameMode === 'creative' || !dryStanding(bot, bot.entity.position) || immediateThreat(bot)) return [];
  const ores = bot.registry.blocksArray.filter(block => names ? names.includes(block.name) : /_ore$|^ancient_debris$/.test(block.name));
  const candidates = bot.findBlocks({ matching: ores.map(block => block.id), maxDistance: radius, count: 16,
    useExtraInfo: block => (!bot.canSeeBlock || bot.canSeeBlock(block)) && !reservedForConstruction(goal, block.position) &&
      !block.position.equals(supportCell(bot.entity.position)) && safeFromHostiles(bot, block.position),
  });
  return candidates.flatMap(position => {
    const block = bot.blockAt(position);
    if (!block?.diggable || !safeFromHostiles(bot, position)) return [];
    const definition = bot.registry.blocksByName[block.name];
    const resource = definition?.drops?.map(drop => bot.registry.items[typeof drop === 'number' ? drop : drop.drop]?.name).find(Boolean);
    if (!resource || resource === primary.drops || countOf(bot, resource) >= (resource === 'coal' || resource === 'raw_iron' ? 64 : resource === 'gold_nugget' ? 256 : 32)) return [];
    // Piglins turn on a player who breaks gold near them, gold armour or
    // not: the same sixteen blocks the bastion gold keeps (bartering.js).
    if (GOLD_BLOCKS.test(block.name) && piglinsWithin(bot, position, 16)) return [];
    if (goal.opportunistic?.skipped?.[`${position}`] > Date.now() - 120000) return [];
    const tools = bot.inventory.items().filter(item => (!block.harvestTools || block.harvestTools[item.type]) &&
      (bot.registry.itemsByName[item.name]?.maxDurability || 0) - (item.durabilityUsed || 0) >= 16);
    if (block.harvestTools && !tools.length) return [];
    const room = bot.inventory.emptySlotCount?.() > 1 || bot.inventory.items().some(item => item.name === resource && item.count <= (item.stackSize || 64) - 8);
    if (!room) return [];
    const standing = dryMiningPositions(bot, position).filter(p => p.distanceTo(bot.entity.position) <= radius);
    if (!standing.length) return [];
    return [{ position, block: block.name, resource, tool: tools[0]?.name, standing, carried: countOf(bot, resource) }];
  }).slice(0, 5);
}

// The candidates a walk reaches on foot: a route of at most `steps` that
// digs nothing, lays nothing and stays inside `allowed`, from one of the
// first three standing cells.
async function routed(bot, task, movement, candidates, allowed, steps) {
  const choices = [];
  for (const candidate of candidates) {
    task.check();
    for (const standing of candidate.standing.slice(0, 3)) {
      const destination = new goals.GoalBlock(standing.x, standing.y, standing.z);
      const route = await surveyRoute(bot, task, movement, destination, 200);
      if (route.status !== 'success' || (route.path || []).length > steps || (route.path || []).some(p => !allowed(p) || p.toBreak?.length || p.toPlace?.length)) continue;
      choices.push({ ...candidate, standing, routeSteps: (route.path || []).length }); break;
    }
  }
  return choices;
}

// The detour itself: to the standing cell, the dig, the drop, and back to
// where the walk or step was, inside the twelve-second budget, under a step
// of its own that gives the step before it back.
async function runDetour(bot, task, goal, save, candidate, { start, allowed, navigate, dig, walk = {} }) {
  const state = goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} };
  const deadline = Date.now() + LIMITS.durationMs;
  const bounded = { get cancelled() { return task.cancelled; }, check() { task.check(); if (Date.now() >= deadline) { const error = new Error('Short mining detour budget exhausted'); error.name = 'DetourBudget'; throw error; } } };
  const before = countOf(bot, candidate.resource), originalStep = goal.step;
  state.active = { block: candidate.block, resource: candidate.resource, start: { x: start.x, y: start.y, z: start.z }, position: { x: candidate.position.x, y: candidate.position.y, z: candidate.position.z }, deadline, ...(candidate.passing ? { passing: true } : {}) };
  goal.step = { action: 'collect_nearby_resource', ...state.active }; save();
  try {
    const p = candidate.standing;
    if (!miningReach(bot, bot.entity.position, candidate.position)) await navigate(bot, bounded, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 4000, stallMs: 2000, ...walk });
    bounded.check();
    await dig(bot, bounded, candidate.position, { requiredTool: candidate.tool, minimumToolDurability: 16 });
    await new Promise(resolve => setTimeout(resolve, 350)); bounded.check();
    const drop = Object.values(bot.entities || {}).find(e => e.getDroppedItem?.()?.name === candidate.resource && e.position.distanceTo(candidate.position) < 3);
    if (drop && allowed(drop.position)) await navigate(bot, bounded, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), { timeoutMs: 3000, stallMs: 1500, ...walk });
    await new Promise(resolve => setTimeout(resolve, 350)); bounded.check();
    if (Date.now() < deadline && bot.entity.position.distanceTo(start) > 1) await navigate(bot, bounded,
      new goals.GoalBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)), { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500, ...walk });
    state.history.push({ ...state.active, pickedUp: Math.max(0, countOf(bot, candidate.resource) - before), finishedAt: new Date().toISOString() });
    state.history = state.history.slice(-24);
  } finally { state.skipped[`${candidate.position}`] = Date.now(); delete state.active; goal.step = originalStep; save(); }
}

async function opportunisticMining(bot, task, goal, save, primary, { navigate, dig, radius = LIMITS.radius, only = null }, client = task.opportunityClient) {
  if (goal.kind === 'find') return false;
  const state = goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} };
  const all = opportunityCandidates(bot, goal, primary, { radius }).filter(c => !only || only(c));
  const needed = all.filter(c => neededByRule(bot, c));
  // Asked every third step, and at once when a short ore is in reach.
  const asking = !!client && (++state.primarySteps % LIMITS.primarySteps === 0 || needed.length > 0);
  const candidates = asking ? all : needed;
  if (!candidates.length) return false;
  const start = bot.entity.position.clone();
  const movement = bot.pathfinder.movements, previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks,
    allow1by1towers: movement.allow1by1towers, allowedPosition: movement.allowedPosition };
  const allowed = p => pos(p).distanceTo(start) <= radius && (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allow1by1towers: false, allowedPosition: allowed });
  try {
    const choices = await routed(bot, task, movement, candidates, allowed, LIMITS.routeSteps);
    if (!choices.length) return false;
    const firstShort = choices.findIndex(c => neededByRule(bot, c));
    const response = !asking ? { answers: { opportunity: { choice: `ore_${Math.max(0, firstShort)}`, rule: 'no Jev: a short ore is taken' } } } : await require('./decisions').ask(client, { state: { request: goal.request, primary, health: bot.health, food: bot.food, inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
      limits: LIMITS, candidates: choices.map(({ standing, ...c }) => ({ ...c, distance: c.position.distanceTo(start) })) },
    questions: { opportunity: ['opportunistic_ore', { options: Object.fromEntries(choices.map((c, i) => [`ore_${i}`, `${c.block}: yields ${c.resource}; already carrying ${c.carried}; ${c.routeSteps} walking steps away.${shortage(bot, c) ? ` ${shortage(bot, c)[0].toUpperCase()}${shortage(bot, c).slice(1)}.` : ''}`])) }] },
    signal: AbortSignal.timeout(5000) });
    task.check();
    const selected = response.answers?.opportunity?.choice;
    state.lastDecision = { at: new Date().toISOString(), answer: response.answers?.opportunity, usage: response.usage };
    if (selected === 'continue') { save(); return false; }
    const index = /^ore_(\d+)$/.exec(selected || '')?.[1], candidate = index !== undefined && choices[Number(index)];
    if (!candidate) throw new Error('Invalid opportunistic mining choice');
    if (bot.blockAt(candidate.position)?.name !== candidate.block || !opportunityCandidates(bot, goal, primary).some(c => c.position.equals(candidate.position))) return false;
    await runDetour(bot, task, goal, save, candidate, { start, allowed, navigate, dig });
    return true;
  } catch (error) {
    task.check();
    if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(error.name)) throw error;
    // A failed optional detour must not fail or replace the main objective.
    state.lastError = error.message; save(); return false;
  } finally { Object.assign(movement, previous); }
}

// In passing (note 653): a walk in the Nether looks for gold as it goes
// (skills.js navigate, `passing`), mines it and walks on. The audit of 94
// flight records on 2026-09-29 found 462 gold blocks open to the air within
// eight blocks of the paths walked, 145 of them within four, and 55 taken:
// the look ran only on the fortress sweep's own walks, stopped the walk
// (which the sweep then booked as a walk that came no nearer), and saw
// nothing past four blocks or any gilded blackstone.
//
// Within four blocks, while pearls are short and health and food are at
// the rule's 16 and 14, nether gold ore and gold blocks are taken as a rule.
// Everything else in reach (to eight blocks, gilded blackstone, gold within
// four while health or food is low) is Jev's, priced in nuggets, the
// fraction of a pearl it barters and the seconds of the detour.
const PASSING_RADIUS = 4, PASSING_REACH = 8, PASSING_STEPS = 16, PASSING_ASK_MS = 15000;
const WALK_SPEED = 4.3;
// Nuggets a block gives, without Fortune: nether gold ore 2 to 6; gilded
// blackstone the block itself nine times in ten, 2 to 5 nuggets the tenth;
// a block of gold nine ingots. Nine nuggets an ingot, nine ingots a pearl
// (bartering.js, measured on this server).
const GOLD_WORTH = Object.freeze({
  nether_gold_ore: { nuggets: 4, says: '2 to 6 gold nuggets, about 4' },
  gold_block: { nuggets: 81, says: 'a block of gold, nine ingots' },
  gilded_blackstone: { nuggets: 0.35, says: 'a 1 in 10 chance of 2 to 5 gold nuggets (about 0.35 nuggets a block on average), otherwise the block itself, which barters nothing' },
});
const RULE_GOLD = ['nether_gold_ore', 'gold_block'];
const NUGGETS_A_PEARL = 81;
const shortOfPearls = bot => !!bot.inventory?.items && /nether/.test(String(bot.game?.dimension || '')) && countOf(bot, 'ender_pearl') < PEARLS_WANTED;
// Diamonds, iron and lapis the same way, on any walk in any dimension,
// within four blocks and by the rule only.
const DIAMOND_ORES = ['diamond_ore', 'deepslate_diamond_ore'];
const passingKinds = bot => [...(shortOfPearls(bot) ? Object.keys(GOLD_WORTH) : []), ...(countOf(bot, 'diamond') < 64 ? DIAMOND_ORES : []),
  ...(ironShort(bot) ? ['iron_ore', 'deepslate_iron_ore'] : []), ...(lapisShort(bot) ? ['lapis_ore', 'deepslate_lapis_ore'] : [])];
const passingWanted = (bot, c) => GOLD_WORTH[c.block] ? shortOfPearls(bot) : ['diamond', 'raw_iron', 'lapis_lazuli'].includes(c.resource) && neededByRule(bot, c);
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const lavaBeside = (bot, p) => FACES.some(([x, y, z]) => /lava/.test(bot.blockAt(p.offset(x, y, z))?.name || ''));
const goldCarried = bot => countOf(bot, 'gold_ingot') + countOf(bot, 'gold_nugget') / 9 + countOf(bot, 'gold_block') * 9;
const round = (n, d = 1) => Math.round(n * d) / d;
const ingotSays = nuggets => nuggets >= 9 ? `${round(nuggets / 9, 10)} ingot${nuggets === 9 ? '' : 's'}` : `about ${round(nuggets / 9, 100)} of an ingot`;
const pearlSays = nuggets => nuggets / NUGGETS_A_PEARL >= 0.95 ? `about ${round(nuggets / NUGGETS_A_PEARL, 10)} pearl${round(nuggets / NUGGETS_A_PEARL, 10) === 1 ? '' : 's'}` : `about 1/${Math.round(NUGGETS_A_PEARL / nuggets)} of a pearl`;
const canAsk = (bot, now = Date.now()) => now - (bot._passingAskedAt || 0) >= PASSING_ASK_MS;

// The candidates a walk passes, each with its tier: `rule` is taken without
// asking, `offer` is Jev's. Kept from the rule as it was: dry standing, the
// hostile check, a tool, room, no piglin within 16 of gold; and now no lava
// against the block and no standing on the block being broken.
function passingCandidates(bot, goal) {
  const kinds = passingKinds(bot);
  if (!kinds.length) return [];
  const here = bot.entity.position;
  return opportunityCandidates(bot, goal || {}, { drops: null }, { radius: PASSING_REACH, names: kinds, vitals: false }).flatMap(c => {
    if (!passingWanted(bot, c) || lavaBeside(bot, c.position)) return [];
    const standing = c.standing.filter(s => !s.offset(0, -1, 0).equals(c.position));
    if (!standing.length) return [];
    const distance = here.distanceTo(c.position.offset(0.5, 0.5, 0.5)), gold = !!GOLD_WORTH[c.block];
    // Diamonds, iron and lapis are the rule's alone, as before.
    if (!gold && (distance > PASSING_RADIUS + 0.5 || !vitalsFit(bot))) return [];
    const rule = distance <= PASSING_RADIUS + 0.5 && vitalsFit(bot) && (!gold || RULE_GOLD.includes(c.block));
    return [{ ...c, standing, distance, tier: rule ? 'rule' : 'offer' }];
  });
}
// Whether the walk stops here: a candidate for the rule, or one for Jev
// when there is a Jev to ask and it was not asked in the last 15 s.
function goldInPassing(bot, goal, now = Date.now(), { client = false } = {}) {
  if (!bot.inventory?.items || goal?.kind === 'find' || now - (bot._goldLookAt || 0) < 500) return false;
  const kinds = passingKinds(bot);
  if (!kinds.length) return false;
  bot._goldLookAt = now;
  const ids = kinds.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
  if (!ids.length || !bot.findBlocks?.({ matching: ids, maxDistance: PASSING_REACH, count: 1 }).length) return false;
  return passingCandidates(bot, goal).some(c => c.tier === 'rule' || (!!client && canAsk(bot, now)));
}
function detourSeconds(bot, c) {
  let digMs = 1500;
  try {
    const tool = c.tool && bot.registry.itemsByName[c.tool];
    const t = bot.blockAt(c.position).digTime(tool ? tool.id : null, false, false, false, [], []);
    if (Number.isFinite(t)) digMs = t;
  } catch (_) { /* no block data here */ }
  return Math.max(1, Math.round(2 * c.routeSteps / WALK_SPEED + digMs / 1000 + 0.7));
}
function passingSays(bot, c) {
  const worth = GOLD_WORTH[c.block];
  const what = `${c.block.replace(/_/g, ' ')}: ${worth.says}, ${ingotSays(worth.nuggets)}, ${pearlSays(worth.nuggets)} at nine ingots a pearl`;
  const low = vitalsFit(bot) ? '' : ` Health ${round(bot.health ?? 20)} of 20 and food ${bot.food ?? 20} of 20: under the ${VITALS.health} health or ${VITALS.food} food at which gold this near is taken without asking.`;
  const seconds = detourSeconds(bot, c), blocks = Math.ceil(NUGGETS_A_PEARL / worth.nuggets);
  const perPearl = blocks <= 1 ? '' : ` At this rate a pearl is ${blocks} such blocks, about ${Math.round(blocks * seconds / 60) || 1} minute${Math.round(blocks * seconds / 60) > 1 ? 's' : ''} of detours like this one.`;
  return `${what}. ${round(c.distance)} blocks from the walk, ${c.routeSteps} walking steps; a detour of about ${seconds} s there and back with the dig, then the same walk goes on.${perPearl}${low}`;
}
// The look's detour. `client` null: the rule only.
async function mineInPassing(bot, task, goal, save, { navigate, dig }, client = null) {
  if (!navigate || !dig || !goal || goal.kind === 'find' || !bot.inventory?.items || !bot.pathfinder?.movements) return false;
  const found = passingCandidates(bot, goal);
  const rule = found.filter(c => c.tier === 'rule');
  const offer = client && canAsk(bot) ? found.filter(c => c.tier === 'offer') : [];
  const pool = rule.length ? rule : offer;
  if (!pool.length) return false;
  const state = goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} };
  const passed = list => {
    const now = Date.now();
    for (const [k, t] of Object.entries(state.skipped)) if (now - t > 600000) delete state.skipped[k];
    for (const c of list) state.skipped[`${c.position}`] = now;
    save();
  };
  const start = bot.entity.position.clone();
  const movement = bot.pathfinder.movements, previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks,
    allow1by1towers: movement.allow1by1towers, allowedPosition: movement.allowedPosition };
  const allowed = p => pos(p).distanceTo(start) <= PASSING_REACH + 1 && (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allow1by1towers: false, allowedPosition: allowed });
  try {
    const choices = await routed(bot, task, movement, pool, allowed, PASSING_STEPS);
    if (!choices.length) { state.lastError = `in passing: no walk of ${PASSING_STEPS} steps or fewer, digging and laying nothing, to ${pool.map(c => c.block).join(', ')}`; passed(pool); return false; }
    let candidate;
    if (rule.length) {
      candidate = choices[0];
      state.lastDecision = { at: new Date().toISOString(), answer: { choice: 'gold_0', rule: `in passing: ${candidate.block} within ${PASSING_RADIUS} blocks of the walk, taken while the pearls are short (or the ore is)` } };
    } else {
      bot._passingAskedAt = Date.now();
      const pearls = countOf(bot, 'ender_pearl');
      const response = await require('./decisions').ask(client, {
        state: { request: goal.request, walk: goal.step?.action, pearls, pearlsWanted: PEARLS_WANTED, goldCarriedIngots: round(goldCarried(bot), 10), health: bot.health, food: bot.food,
          takenWithoutAsking: `nether gold ore and gold blocks within ${PASSING_RADIUS} blocks while pearls are short and health is at least ${VITALS.health} and food at least ${VITALS.food}`,
          candidates: choices.map(c => ({ block: c.block, distance: round(c.distance), routeSteps: c.routeSteps, seconds: detourSeconds(bot, c) })) },
        questions: { passing: ['passing_gold', { pearls, options: Object.fromEntries(choices.map((c, i) => [`gold_${i}`, passingSays(bot, c)])) }] },
        signal: AbortSignal.timeout(5000) });
      task.check();
      const selected = response.answers?.passing?.choice;
      state.lastDecision = { at: new Date().toISOString(), question: 'passing_gold', answer: response.answers?.passing, usage: response.usage };
      const index = /^gold_(\d+)$/.exec(selected || '')?.[1];
      candidate = index !== undefined && choices[Number(index)];
      if (!candidate) { passed(choices); return false; }
    }
    if (bot.blockAt(candidate.position)?.name !== candidate.block) { passed([candidate]); return false; }
    await runDetour(bot, task, goal, save, { ...candidate, passing: true }, { start, allowed, navigate, dig, walk: { passing: false } });
    return true;
  } catch (error) {
    task.check();
    if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(error.name)) throw error;
    // A failed look must not fail the walk it was part of.
    state.lastError = `in passing: ${error.message}`; passed(pool); return false;
  } finally { Object.assign(movement, previous); }
}
async function mineGoldInPassing(bot, task, goal, save, { navigate, dig }) {
  return mineInPassing(bot, task, goal, save, { navigate, dig }, null);
}

module.exports = { goldInPassing, mineGoldInPassing, mineInPassing, passingCandidates, passingSays, valuableInPassing: goldInPassing, mineValuableInPassing: mineGoldInPassing,
  PASSING_RADIUS, PASSING_REACH, GOLD_WORTH, VITALS, piglinsWithin, LIMITS, opportunityCandidates, opportunisticMining, fuelCarried, FUEL_UNITS_WANTED };
