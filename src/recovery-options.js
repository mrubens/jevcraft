'use strict';
const { setAside } = require('./progress');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { surveyRoute, countOf } = require('./skills');
const { dryStanding, miningMovement } = require('./mining-access');
const { safeFromHostiles, threats } = require('./danger');
const { recipeSourceGroups } = require('./resource-observation');
const { surfaceReturnComplete } = require('./surface');
const shelter = require('./shelter');
const { pillarDescent, descendPillar } = require('./pillar-recovery');
const { standsInLava, atOf } = require('./terrain');
const pos = p => new Vec3(p.x, p.y, p.z);
const stock = bot => Object.fromEntries(bot.inventory.items().map(i => [i.name, countOf(bot, i.name)]));

// The LLM sees only executable choices built from current observations. It
// cannot supply coordinates, item names, quantities, commands or new handlers.
async function recoveryOptions(bot, task, goal, actions) {
  const options = [], inventory = stock(bot), usable = actions.planningInventory(bot), origin = bot.entity.position.floored();
  const add = (description, action) => options.push({ id: `option_${options.length + 1}`, description, ...action });
  const descent = pillarDescent(bot, goal);
  if (descent) add('Remove the exposed pillar block beneath me and descend exactly one block onto the observed solid landing. Recheck safety before digging.',
    { kind: 'descend_pillar', descent });
  const plans = [];
  const requested = goal.item || (goal.kind === 'concrete' ? 'purple_concrete' : goal.kind === 'nether' ? 'obsidian' : null);
  for (const item of new Set([requested, goal.step?.item, goal.step?.drops].filter(n => bot.registry.itemsByName[n]))) {
    try { plans.push(...actions.catalogPlan(bot, item, Math.min(goal.count || 1, 32), inventory, goal)); } catch (_) { /* Unsupported recipes are not executable choices. */ }
  }
  const alternatives = recipeSourceGroups(bot.registry, plans);
  // The blocks a player would fetch here: dirt and cobblestone in the
  // Overworld, but neither exists to find in the Nether (25591 was sent
  // looking for both, "no stone seen within 128 blocks" and the same for
  // cobblestone and dirt, while it stood on netherrack; note 729).
  // Netherrack is what the Nether has instead, and blackstone or basalt
  // stand in the same place where the local ground is one of those.
  const inNether = /nether/.test(String(bot.game?.dimension || ''));
  const netherBuildingBlock = ['netherrack', 'blackstone', 'basalt'].find(n => bot.blockAt(origin)?.name === n || bot.blockAt(origin.offset(0, -1, 0))?.name === n) || 'netherrack';
  const supplies = inNether ? new Map([[netherBuildingBlock, 12], ['crafting_table', 1]]) : new Map([['dirt', 12], ['cobblestone', 12], ['crafting_table', 1]]);
  if (!bot.inventory.items().some(i => i.name.endsWith('_pickaxe') &&
    (bot.registry.itemsByName[i.name]?.maxDurability || 0) - (i.durabilityUsed || 0) >= 16)) supplies.set('stone_pickaxe', 1);
  for (const group of Object.values(alternatives)) for (const name of group) {
    if (!bot.registry.itemsByName[name] || !bot.registry.blocksByName[name] || supplies.size >= 20) continue;
    const found = bot.findBlocks({ matching: bot.registry.blocksByName[name]?.id, maxDistance: 32, count: 1 });
    if (found.length || inventory[name]) supplies.set(name, Math.min(8, Math.max(1, goal.count || 1)));
  }
  for (const [item, count] of supplies) {
    if ((usable[item] || 0) >= count) continue;
    try {
      const plan = actions.catalogPlan(bot, item, count, usable, goal);
      if (!plan.length || plan.length > 16) continue;
      add(`Obtain a total of ${count} ${item} through survival recipes; current inventory ${inventory[item] || 0}.`,
        { kind: 'acquire', item, count, dependencies: plan.slice(0, 8) });
    } catch (_) {}
  }
  if (bot.game.dimension === 'overworld' && !surfaceReturnComplete(bot, goal)) {
    // How far up, and how long (the decision audit, 2026-09-25): the
    // midgame trials spent 84 of 220 minutes climbing out.
    const { climbToSurface, climbMinutes, climbStraightMinutes } = require('./surface');
    const up = climbToSurface(bot, bot.entity.position);
    const pick = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
    const straight = up > 0 ? `, or about ${climbStraightMinutes(up, { pickaxe: pick })} straight up where the column overhead is open` : '';
    const climb = up == null ? ' How far up the sky is is not known from here.' : up > 0 ? ` About ${up} blocks up to open sky: roughly ${pick ? `${climbMinutes(up)} minutes by staircase with a pickaxe` : `${Math.round(up / 2)} minutes by hand, with no pickaxe`}${straight}.` : '';
    add(`Return toward the observed surface using inspected routes or an explicit staircase; pause the current worksite.${climb}`, { kind: 'surface' });
  }
  // The option that changes the situation when every footing nearby has
  // already been tried: stop working this deposit and go find another.
  if (goal.step?.action === 'mine' && goal.step.block) {
    const nearby = bot.findBlocks({ matching: (goal.step.sources || [goal.step.block]).map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined), maxDistance: 16, count: 64 }).length;
    add(`Set aside the ${nearby} ${String(goal.step.block).replaceAll('_', ' ')} blocks within 16 blocks, which keep failing, and walk to find ${String(goal.step.drops || goal.step.block).replaceAll('_', ' ')} somewhere else.`,
      { kind: 'explore', block: goal.step.block, sources: goal.step.sources, resource: goal.step.drops || goal.step.block });
  }

  // Repositioning is surveyed without breaking or placing anything. A route
  // is evidence for an option, not a guarantee: recheck before execution.
  const policy = miningMovement(bot), movement = bot.pathfinder.movements;
  const previous = { scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { scafoldingBlocks: [], allow1by1towers: false });
  try {
    const ids = (inNether ? ['netherrack', 'blackstone', 'basalt', 'soul_sand', 'soul_soil'] : ['stone', 'dirt', 'grass_block', 'cobblestone', 'sand', 'gravel', 'deepslate']).map(n => bot.registry.blocksByName[n]?.id).filter(n => n !== undefined);
    const candidates = bot.findBlocks({ matching: ids, maxDistance: 12, count: 96,
      useExtraInfo: b => dryStanding(bot, b.position.offset(0, 1, 0)) })
      // No footing where the body stands in lava (terrain.js standsInLava,
      // note 580): a relocation is a step like any other (note 600).
      .map(p => p.offset(0, 1, 0)).filter(p => p.distanceTo(origin) >= 2 && safeFromHostiles(bot, p) && !standsInLava(atOf(bot), p));
    const areas = new Set();
    let checked = 0, selected = 0;
    for (const p of candidates) {
      const area = `${Math.floor(p.x / 3)},${p.y},${Math.floor(p.z / 3)}`;
      if (areas.has(area)) continue;
      areas.add(area);
      if (++checked > 16 || selected >= 6) break;
      const route = await surveyRoute(bot, task, movement, new goals.GoalBlock(p.x, p.y, p.z), 150);
      if (route.status !== 'success' || route.path.some(n => !policy.allowed(n) || n.toBreak?.length || n.toPlace?.length)) continue;
      // Which footing, and whether it is somewhere already tried: the
      // relocations all read the same, and Jev could not tell one from
      // another (the decision audit, 2026-09-25).
      const dy = p.y - origin.y, before = (bot._trail || []).filter(t => Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) <= 1.5).length;
      const where = ` It is at ${p.x}, ${p.y}, ${p.z}, ${Math.round(p.distanceTo(origin))} blocks away${dy ? `, ${Math.abs(dy)} block${Math.abs(dy) === 1 ? '' : 's'} ${dy > 0 ? 'up' : 'down'}` : ''}${before ? `; the bot stood there ${before === 1 ? 'once' : `${before} times`} in the last few minutes` : ''}.`;
      add(`Move to this observed dry footing, then retry the original work from a different approach.${where}`, { kind: 'relocate', position: { ...p } }); selected++;
      if ((goal.survival?.shelters?.length || /shelter|refuge/.test(goal.survivalAction?.action || '')) &&
        /shelter|refuge|navigation|path/i.test(goal.lastError || '') && shelter.safeSite(bot, p, goal)) {
        add(`Use this reachable supported site for the next shelter attempt; preserve existing structures.${where}`, { kind: 'shelter', position: { ...p } });
      }
    }
  } finally { policy.restore(); Object.assign(movement, previous); }
  const terrain = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 2; dy++) {
    const p = origin.offset(dx, dy, dz), b = bot.blockAt(p);
    terrain.push({ position: { ...p }, block: b?.name || 'unloaded' });
  }
  return { options, context: {
    request: goal.request, objective: { kind: goal.kind, item: goal.item, count: goal.count }, step: goal.step,
    failure: goal.lastError, survivalAction: goal.survivalAction, dimension: bot.game.dimension,
    gameMode: bot.game.gameMode, timeOfDay: bot.time?.timeOfDay, position: { ...bot.entity.position },
    health: bot.health, food: bot.food, oxygen: bot.oxygenLevel, inventory,
    tools: bot.inventory.items().filter(i => bot.registry.itemsByName[i.name]?.maxDurability).map(i => ({ name: i.name,
      remaining: bot.registry.itemsByName[i.name].maxDurability - (i.durabilityUsed || 0) })),
    threats: threats(bot).map(t => ({ name: t.entity.name, distance: t.distance, visible: t.visible })),
    terrain, recipeAlternatives: alternatives, recentSteps: (goal.history || []).slice(-6),
    recentFailures: (goal.recoveryAdvice?.failures || []).slice(-6),
    previousAdvice: (goal.recoveryAdvice?.history || []).slice(-3).map(h => ({ diagnosis: h.diagnosis, steps: h.steps, outcome: h.outcome })),
    failedNavigation: bot._lastNavigationFailure, shelters: goal.survival?.shelters,
  } };
}

async function executeRecoveryOption(bot, task, goal, save, action, actions) {
  if (action.kind === 'descend_pillar') {
    if (!await descendPillar(bot, task, goal, save, action.descent)) throw new Error('The inspected pillar descent is no longer available');
    return true;
  }
  if (action.kind === 'acquire') return actions.acquireStep(bot, task, action.item, action.count, goal, save);
  if (action.kind === 'surface') { await actions.surfaceStep(bot, task, goal, save); return surfaceReturnComplete(bot, goal); }
  if (action.kind === 'explore') {
    const start = bot.entity.position.clone();
    for (const p of actions.find(bot, action.sources || [action.block], 16, 64)) setAside(goal, 'reach', p, 'recovery chose to look elsewhere', 120000);
    save();
    await actions.explore(bot, task, goal, save, action.block);
    // Done once the bot has actually left the failing area.
    return bot.entity.position.distanceTo(start) > 12;
  }
  if (!['relocate', 'shelter'].includes(action.kind)) throw new Error('Unknown recovery action');
  const p = pos(action.position);
  if (p.distanceTo(bot.entity.position) > 24 || !dryStanding(bot, p) || !safeFromHostiles(bot, p)) throw new Error('Recovery destination is no longer safe or nearby');
  if (action.kind === 'shelter' && !shelter.safeSite(bot, p, goal)) throw new Error('Recovery shelter site changed');
  const policy = miningMovement(bot), movement = bot.pathfinder.movements;
  const previous = { scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { scafoldingBlocks: [], allow1by1towers: false });
  try {
    const destination = new goals.GoalBlock(p.x, p.y, p.z);
    const route = await surveyRoute(bot, task, movement, destination, 300);
    if (route.status !== 'success' || route.path.some(n => !policy.allowed(n) || n.toBreak?.length || n.toPlace?.length)) throw new Error('Recovery route is no longer available');
    await actions.navigate(bot, task, destination, { timeoutMs: 12000, stallMs: 4000 });
    if (!dryStanding(bot, bot.entity.position) || bot.entity.position.distanceTo(p.offset(0.5, 0, 0.5)) > 1.2) throw new Error('Recovery arrival was not verified');
    if (action.kind === 'shelter') {
      if (!shelter.safeSite(bot, p, goal)) throw new Error('Recovery shelter site changed during travel');
      for (const old of goal.survival.shelters) if (old.dimension === bot.game.dimension) old.avoidUntil = Date.now() + 600000;
      goal.survival.shelters.push({ origin: { ...p }, dimension: bot.game.dimension, createdAt: new Date().toISOString() });
    }
    return true;
  } finally { policy.restore(); Object.assign(movement, previous); }
}
module.exports = { recoveryOptions, executeRecoveryOption };
