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
// costs, and the End is fought better in enchanted gear (the user's
// daughter, 2026-09-24).
const LAPIS_WANTED = 16;
const lapisShort = bot => countOf(bot, 'lapis_lazuli') < LAPIS_WANTED;
const shortage = (bot, candidate) => {
  if (candidate.resource === 'coal' && fuelCarried(bot) < FUEL_UNITS_WANTED) return `short of fuel: ${fuelCarried(bot)} smelts carried, ${FUEL_UNITS_WANTED} wanted, and without it the next smelt burns the planks a pickaxe needs`;
  if (candidate.resource === 'gold_nugget' && /nether/.test(String(bot.game?.dimension || '')) && countOf(bot, 'ender_pearl') < PEARLS_WANTED) return `short of pearls: ${countOf(bot, 'ender_pearl')} of ${PEARLS_WANTED}; nine gold ingots barter a pearl from piglins`;
  if (candidate.resource === 'diamond' && countOf(bot, 'diamond') < 64) return 'diamonds: the best tools and armour, and rare';
  if (candidate.resource === 'raw_iron' && ironShort(bot)) return `short of iron: ${countOf(bot, 'raw_iron') + countOf(bot, 'iron_ingot')} of ${IRON_WANTED}; every tool, armour piece, shield and bucket`;
  if (candidate.resource === 'lapis_lazuli' && lapisShort(bot)) return `short of lapis: ${countOf(bot, 'lapis_lazuli')} of ${LAPIS_WANTED}; enchanting costs it`;
  return null;
};
const neededByRule = (bot, candidate) => !!shortage(bot, candidate);

function opportunityCandidates(bot, goal, primary, { radius = LIMITS.radius } = {}) {
  if (!bot.registry?.blocksArray || !bot.findBlocks || bot.health < 16 || bot.food < 14 || bot.game?.gameMode === 'creative' || !dryStanding(bot, bot.entity.position) || immediateThreat(bot)) return [];
  const ores = bot.registry.blocksArray.filter(block => /_ore$|^ancient_debris$/.test(block.name));
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
  const choices = [];
  try {
    for (const candidate of candidates) {
      task.check();
      for (const standing of candidate.standing.slice(0, 3)) {
        const destination = new goals.GoalBlock(standing.x, standing.y, standing.z);
        const route = await surveyRoute(bot, task, movement, destination, 200);
        if (route.status !== 'success' || (route.path || []).length > LIMITS.routeSteps || (route.path || []).some(p => !allowed(p) || p.toBreak?.length || p.toPlace?.length)) continue;
        choices.push({ ...candidate, standing, routeSteps: (route.path || []).length }); break;
      }
    }
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
    const deadline = Date.now() + LIMITS.durationMs;
    const bounded = { get cancelled() { return task.cancelled; }, check() { task.check(); if (Date.now() >= deadline) { const error = new Error('Short mining detour budget exhausted'); error.name = 'DetourBudget'; throw error; } } };
    const before = countOf(bot, candidate.resource), originalStep = goal.step;
    state.active = { block: candidate.block, resource: candidate.resource, start: { ...start }, position: { ...candidate.position }, deadline };
    goal.step = { action: 'collect_nearby_resource', ...state.active }; save();
    try {
      const p = candidate.standing;
      if (!miningReach(bot, bot.entity.position, candidate.position)) await navigate(bot, bounded, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 4000, stallMs: 2000 });
      bounded.check();
      await dig(bot, bounded, candidate.position, { requiredTool: candidate.tool, minimumToolDurability: 16 });
      await new Promise(resolve => setTimeout(resolve, 350)); bounded.check();
      const drop = Object.values(bot.entities).find(e => e.getDroppedItem?.()?.name === candidate.resource && e.position.distanceTo(candidate.position) < 3);
      if (drop && allowed(drop.position)) await navigate(bot, bounded, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1), { timeoutMs: 3000, stallMs: 1500 });
      await new Promise(resolve => setTimeout(resolve, 350)); bounded.check();
      if (Date.now() < deadline && bot.entity.position.distanceTo(start) > 1) await navigate(bot, bounded,
        new goals.GoalBlock(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)), { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500 });
      state.history.push({ ...state.active, pickedUp: Math.max(0, countOf(bot, candidate.resource) - before), finishedAt: new Date().toISOString() });
      state.history = state.history.slice(-24);
    } finally { state.skipped[`${candidate.position}`] = Date.now(); delete state.active; goal.step = originalStep; save(); }
    return true;
  } catch (error) {
    task.check();
    if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(error.name)) throw error;
    // A failed optional detour must not fail or replace the main objective.
    state.lastError = error.message; save(); return false;
  } finally { Object.assign(movement, previous); }
}

// Nether gold in passing: the walks of the blaze hunt and the fortress
// sweep, where the Nether's time goes, stop for gold within four blocks
// while the pearls are short, and go on. No mine or tunnel step is running
// there, so the rule above never saw it. The look is cheap and throttled.
const PASSING_RADIUS = 4;
const shortOfPearls = bot => !!bot.inventory?.items && /nether/.test(String(bot.game?.dimension || '')) && countOf(bot, 'ender_pearl') < PEARLS_WANTED;
// Diamonds the same way, on any walk in any dimension.
const DIAMOND_ORES = ['diamond_ore', 'deepslate_diamond_ore'];
const passingKinds = bot => [...(shortOfPearls(bot) ? ['nether_gold_ore'] : []), ...(countOf(bot, 'diamond') < 64 ? DIAMOND_ORES : []),
  ...(ironShort(bot) ? ['iron_ore', 'deepslate_iron_ore'] : []), ...(lapisShort(bot) ? ['lapis_ore', 'deepslate_lapis_ore'] : [])];
const passingResource = c => c.resource === 'diamond' || c.resource === 'raw_iron' || c.resource === 'lapis_lazuli' || (c.resource === 'gold_nugget' && /nether/.test(String(c.block || '')));
function goldInPassing(bot, goal, now = Date.now()) {
  if (!bot.inventory?.items || now - (bot._goldLookAt || 0) < 500) return false;
  const kinds = passingKinds(bot);
  if (!kinds.length) return false;
  bot._goldLookAt = now;
  const ids = kinds.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
  if (!ids.length || !bot.findBlocks?.({ matching: ids, maxDistance: PASSING_RADIUS, count: 1 }).length) return false;
  return opportunityCandidates(bot, goal, { drops: null }, { radius: PASSING_RADIUS }).some(c => passingResource(c) && neededByRule(bot, c));
}
async function mineGoldInPassing(bot, task, goal, save, { navigate, dig }) {
  if (!navigate || !dig || !bot.inventory?.items || !passingKinds(bot).length) return false;
  return opportunisticMining(bot, task, goal, save, { drops: null }, { navigate, dig, radius: PASSING_RADIUS, only: passingResource }, null);
}

module.exports = { goldInPassing, mineGoldInPassing, valuableInPassing: goldInPassing, mineValuableInPassing: mineGoldInPassing, PASSING_RADIUS, piglinsWithin, LIMITS, opportunityCandidates, opportunisticMining, fuelCarried, FUEL_UNITS_WANTED };
