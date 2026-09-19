'use strict';

const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, equipBestTool, pickaxeTier, countOf } = require('./skills');
const { MINEABLE } = require('./plan');
const { houseBlueprint, verifyHouse } = require('./objectives');
const { deliver } = require('./delivery');
const { reservedForConstruction, portalSiteClear, selectPortalSite, portalSupports } = require('./build-sites');
const { updateDigCapabilities } = require('./movement');
const { resourceTunnelStep } = require('./tunneling');
const { maintainVitals, checkAir, needsAir, chooseFood, digWithAirGuard } = require('./vitals');
const { decideTree } = require('./decisions');
const { Survival } = require('./survival');
const { checkThreats, safeFromHostiles } = require('./danger');
const { planCatalog, sourceBlocks } = require('./knowledge');
const { takeCreativeItem } = require('./creative');
const { surfaceObserver, surfaceMovement, returnToSurface, beginSurfaceAscent, surfaceReturnComplete } = require('./surface');
const { bootstrapPickaxe } = require('./tool-recovery');
const { foodSupply } = require('./foraging');
const { observeRecipeAlternatives, knownResourceLocations, knownResourceNames, rememberResources, isSurfaceResource } = require('./resource-observation');
const { designBuilding, validateSchematic, selectSchematicSite, canClearSchematicBlock, schematicScaffolding } = require('./designer');
const { designWithJev } = require('./build-templates');
const { dryMiningPositions, approachDryMining, miningMovement } = require('./mining-access');
const { dryPassable, supportCell } = require('./terrain');
const { RecoveryAdviser } = require('./recovery-adviser');
const { descendPillar } = require('./pillar-recovery');
const { gameStep, watchGameProgress, dimension } = require('./game-progress');
const { carriedEquipment } = require('./mob-policy');
const { huntObserved, prepareMobHunt, prepareCombatGear } = require('./mob-hunt');
const { findStronghold } = require('./stronghold');
const { enterEnd } = require('./end-portal');
const { fightEndStep } = require('./end-combat');
const { exitEnd } = require('./end-exit');
const { prepareEndSupplies } = require('./end-supplies');
const { collectWater } = require('./water');
const { discoverStep, explorationTarget } = require('./discovery');
const { bundleStep } = require('./item-bundle');
const { batchPlan, remainingOutputs } = require('./batch-plan');
const { visitPlace } = require('./memory');
const { selectBundleBatch, batchOutputs } = require('./bundle-batch');
const { remainingBuildBatch, materialCounts, createBuildBatch } = require('./build-batch');
const { matchesBuildBlock, placementGoal, buildCellComplete, buildFootprint, blockOwnership } = require('./build-blocks');
const { isDoor, doorPairMatches } = require('./doors');
const interactableBlocks = new Set(require('mineflayer-pathfinder/lib/interactable.json'));
const { chooseConstructionWork, approachConstruction } = require('./construction-access');
const { approachWorkstation, reachableWorkstation } = require('./workstation-access');
const { fuelPlanks, ITEMS_PER_PLANK } = require('./fuel');
const { opportunisticMining } = require('./opportunistic-mining');
const { friendlyProblem, completion } = require('./speech');
const { boatTravelStep } = require('./boats');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);
const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];

class Blocked extends Error { constructor(message) { super(message); this.name = 'Blocked'; } }

function inventory(bot) {
  return bot.inventory.items().reduce((o, i) => { o[i.name] = (o[i.name] || 0) + i.count; return o; }, {});
}

function planningInventory(bot) {
  const stock = inventory(bot);
  for (const item of bot.inventory.items()) {
    const durability = bot.registry.itemsByName[item.name]?.maxDurability;
    if (item.name.endsWith('_pickaxe') && durability && durability - (item.durabilityUsed || 0) < 8) stock[item.name] -= item.count;
  }
  return stock;
}

async function withUsableWorkstations(bot, task, stock, requested = []) {
  const available = { ...stock };
  if (bot.game?.gameMode === 'creative') return available;
  // World stations satisfy reusable recipe dependencies, not requested carried
  // outputs. Merely seeing a sealed station must not suppress making our own.
  for (const name of ['crafting_table', 'furnace']) {
    task.check();
    if (available[name] || requested.includes(name)) continue;
    const candidates = find(bot, [name], 32, 8);
    if (candidates.length && await reachableWorkstation(bot, task, name, candidates)) available[name] = 1;
  }
  return available;
}

async function prepareExpeditionStep(bot, task, goal, save) {
  goal.preparingExpedition = true;
  if (bot.game.difficulty && bot.game.difficulty !== 'peaceful' && foodSupply(bot) < 12) {
    goal.step = { action: 'prepare_expedition_food', carriedFoodPoints: foodSupply(bot), requiredFoodPoints: 12 };
    save(); return false;
  }
  if (pickaxeTier(bot) < 2) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return false; }
  if (countOf(bot, 'oak_log') < 4) { await acquireStep(bot, task, 'oak_log', 4, goal, save); return false; }
  if (!countOf(bot, 'crafting_table')) { await acquireStep(bot, task, 'crafting_table', 1, goal, save); return false; }
  goal.expeditionReady = true; delete goal.preparingExpedition;
  goal.step = { action: 'prepared_expedition', minimumPickaxeTier: 2, supplies: { oak_log: 4, crafting_table: 1 }, foodPoints: foodSupply(bot) };
  save(); return true;
}

async function waitFor(task, predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate()) return; await sleep(100); }
  throw new Error('Timed out waiting for world/inventory update');
}

async function stepOff(bot, task, p) {
  const feet = bot.entity.position.floored();
  if (feet.x !== p.x || feet.z !== p.z || Math.abs(feet.y - p.y) > 1) return;
  const exits = faces.slice(1, 5).flatMap(d => [0, 1, -1].map(dy => feet.plus(d).offset(0, dy, 0)));
  const exit = exits.find(q => air(bot.blockAt(q)) && air(bot.blockAt(q.offset(0, 1, 0))) &&
    bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block');
  if (!exit) throw new Error('No solid adjacent footing to move out of the work position');
  await navigate(bot, task, new goals.GoalBlock(exit.x, exit.y, exit.z));
}

async function dig(bot, task, p, { done, requiredTool, enchantment, requireDrops = true, minimumToolDurability = 8 } = {}) {
  task.check(); checkAir(bot);
  if (done?.()) return;
  let block = bot.blockAt(p);
  if (air(block)) return;
  if (!block?.diggable) throw new Error(`Cannot dig ${block?.name || 'unloaded block'}`);
  if (p.equals(supportCell(bot.entity.position))) await stepOff(bot, task, p);
  if (!bot.canDigBlock(block)) {
    await navigate(bot, task, new goals.GoalGetToBlock(p.x, p.y, p.z), { stopWhen: done });
  }
  task.check();
  if (done?.()) return;
  // A route to a ground block may end on top of it. Recheck after travel as
  // well as before it; move aside before replacing a foundation cell.
  if (p.equals(supportCell(bot.entity.position))) await stepOff(bot, task, p);
  block = bot.blockAt(p);
  if (p.equals(supportCell(bot.entity.position))) throw new Error('Refusing to dig directly beneath feet');
  if (requiredTool || enchantment) {
    const remaining = item => (bot.registry.itemsByName[item.name]?.maxDurability || Infinity) - (item.durabilityUsed || 0);
    const tool = bot.inventory.items().filter(item => (!requiredTool || item.name === requiredTool) && remaining(item) >= minimumToolDurability &&
      (!enchantment || item.enchants?.some(e => e.name === enchantment))).sort((a, b) => remaining(b) - remaining(a))[0];
    if (!tool) throw new Blocked(`Need ${enchantment || ''} ${requiredTool || 'tool'} to collect ${block.name}`);
    await bot.equip(tool, 'hand');
  } else await equipBestTool(bot, block);
  if (requireDrops && bot.game?.gameMode !== 'creative' && block.harvestTools && !block.harvestTools[bot.heldItem?.type]) throw new Error(`Missing harvest tool for ${block.name}`);
  await digWithAirGuard(bot, task, block);
  await waitFor(task, () => bot.blockAt(p)?.type !== block.type);
}

async function syncPlacementInventory(bot, task) {
  if (!bot._syncWindow) return;
  // Block confirmation can arrive before the last item leaves its slot. Ask
  // for the authoritative window before choosing the next material/stack.
  let finished = false, failure;
  bot._syncWindow(bot.inventory).then(() => { finished = true; }, err => { failure = err; finished = true; });
  await waitFor(task, () => finished, 4000);
  task.check();
  if (failure) throw failure;
}

async function place(bot, task, p, material, { face, properties } = {}) {
  task.check();
  const cell = { ...p, material, properties };
  if (buildCellComplete(bot, cell)) return;
  if (isDoor(material) && !air(bot.blockAt(p.offset(0, 1, 0)))) throw new Error(`A door needs room for its top half at ${p}`);
  if (!air(bot.blockAt(p)) && !['water', 'short_grass', 'tall_grass', 'fern', 'snow'].includes(bot.blockAt(p)?.name)) {
    throw new Error(`Placement obstructed by ${bot.blockAt(p)?.name} at ${p}`);
  }
  await stepOff(bot, task, p);
  const eye = bot.entity.position.offset(0, 1.62, 0);
  if (!face && eye.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.5) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 4));
  const item = bot.inventory.items().find(i => i.name === material);
  if (!item) throw new Blocked(`Need more ${material}`);
  await bot.equip(item, 'hand');
  if (properties) {
    face = placementGoal(bot, p, cell).getFaceAndRef(bot.entity.position.offset(0, 1.62, 0));
    if (!face) throw new Error(`Cannot reach the requested ${material} orientation at ${p}`);
  }
  let placementError = 'no adjacent solid anchor';
  for (const f of face ? [face.face] : faces) {
    const ref = bot.blockAt(p.plus(f));
    if (ref?.boundingBox !== 'block') continue;
    task.check();
    const wasSneaking = bot.getControlState?.('sneak') || false;
    const sneak = interactableBlocks.has(ref.name) && !wasSneaking;
    try {
      if (sneak) { bot.setControlState('sneak', true); await bot.waitForTicks(1); task.check(); }
      if (face?.to) await bot._placeBlockWithOptions(ref, f.scaled(-1), { delta: face.to.minus(ref.position), swingArm: 'right' });
      else await bot.placeBlock(ref, f.scaled(-1));
      await waitFor(task, () => buildCellComplete(bot, cell) ||
        (material.endsWith('_concrete_powder') && bot.blockAt(p)?.name === material.replace('_powder', '')));
      if (bot.game.gameMode !== 'creative') await syncPlacementInventory(bot, task);
      return;
    } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; placementError = err.message; }
    finally { if (sneak) bot.setControlState('sneak', wasSneaking); }
  }
  throw new Error(`Cannot place ${material} at ${p}: ${placementError}`);
}

function find(bot, names, distance = 48, count = 32) {
  const ids = names.map(n => bot.registry.blocksByName[n]?.id).filter(n => n !== undefined);
  return ids.length ? bot.findBlocks({ matching: ids, maxDistance: distance, count }) : [];
}

async function explore(bot, task, goal, save, resource, { surfaceOnly = isSurfaceResource(resource), frontier = surfaceOnly } = {}) {
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceStep(bot, task, goal, save);
    return;
  }
  const surface = surfaceOnly ? surfaceMovement(bot) : null;
  try {
    goal.search ||= {};
    const search = goal.search[resource] ||= { attempts: 0, origin: { ...bot.entity.position.floored() } };
    const stalledSurface = search.walksWithoutProgress >= 3;
    if (search.attempts >= 128) throw new Blocked(`Could not find reachable ${resource} after 128 exploration steps without collecting it`);
    search.attempts++;
    search.leg ||= 0;
    const angle = (search.leg % 8) * Math.PI / 4;
    const radius = 24 * (1 + Math.floor(search.leg / 8));
    let target = pos(search.origin).offset(Math.round(Math.cos(angle) * radius), 0, Math.round(Math.sin(angle) * radius));
    if (frontier) target = explorationTarget(search, resource, bot.entity.position);
    const resourceNames = [...new Set([...Object.entries(MINEABLE).filter(([name, data]) => name === resource || data.drops === resource).map(([name]) => name),
      ...(bot.registry.blocksByName[resource] ? [resource] : []), ...sourceBlocks(bot.registry, resource)])];
    const observed = [...new Map([...find(bot, resourceNames, 128, 8), ...knownResourceLocations(bot, goal, resourceNames)]
      .map(p => [`${p}`, p])).values()].filter(p => !reservedForConstruction(goal, p) && safeFromHostiles(bot, p) &&
      !(goal.unreachable?.[`${p}`] > Date.now() - 120000) && (!surface || !bot.blockAt(p) || surface.isSurface(p)))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    if (observed.length) {
      target = observed[0];
      search.observedTarget = { ...target };
    }
    if (surfaceOnly && await boatTravelStep(bot, task, goal, save, target, { acquireStep })) return;
    // When a known resource is well below us, circling the same mountain does
    // not get closer. Approach through a dry, supported staircase. Stay above
    // a water-covered deposit rather than tunnelling into the water itself.
    // Continue until the deposit is within vertical mining reach. Stopping
    // eight blocks above it stranded the bot in a closed deep-cave staircase.
    if (!surfaceOnly && observed.length && search.attempts > 3 && target.y < bot.entity.position.y - 3 && pickaxeTier(bot) >= 1) {
      let surface = target.clone();
      for (let y = target.y + 1; y <= target.y + 16; y++) {
        const b = bot.blockAt(new Vec3(target.x, y, target.z));
        if (b?.name === 'water') surface.y = y + 2;
      }
      await resourceTunnelStep(bot, task, goal, save, surface, resource, { dig, navigate });
      return;
    }
    save();
    // Keep the same waypoint until reached. Rotating on every short walk made
    // the bot circle the mountain forever instead of reaching the wider ring.
    const landIds = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'moss_block', 'stone', 'deepslate', 'tuff',
      'granite', 'diorite', 'andesite', 'cobblestone', 'cobbled_deepslate', 'sand', 'red_sand', 'gravel', 'sandstone',
      'red_sandstone', 'netherrack', 'basalt', 'blackstone', 'end_stone', 'obsidian', 'clay', 'snow_block']
      .map(n => bot.registry.blocksByName[n]?.id).filter(n => n !== undefined);
    // Filter surface blocks before truncating results. Taking the nearest 512
    // solids first filled the list with underground stone and hid every shore.
    const land = bot.findBlocks({ matching: landIds, maxDistance: 48, count: 256,
      useExtraInfo: b => b.position.distanceTo(bot.entity.position) > 8 &&
        dryPassable(bot.blockAt(b.position.offset(0, 1, 0))) && dryPassable(bot.blockAt(b.position.offset(0, 2, 0))) &&
        (!surface || surface.isSurface(b.position.offset(0, 1, 0))),
    }).map(p => p.offset(0, 1, 0))
      .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
    search.visited ||= {};
    const key = p => `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)},${Math.floor(p.z / 8)}`;
    const distance = p => observed.length ? p.distanceTo(target) : Math.hypot(p.x - target.x, p.z - target.z);
    if (search.progressLeg !== search.leg) {
      search.progressLeg = search.leg; search.bestDistance = distance(bot.entity.position); search.walksWithoutProgress = 0;
    }
    land.sort((a, b) => distance(a) + (search.visited[key(a)] || 0) * 24 -
      distance(b) - (search.visited[key(b)] || 0) * 24);
    let destination;
    const checked = new Set();
    for (const candidate of land) {
      if (checked.has(key(candidate))) continue;
      checked.add(key(candidate));
      if (checked.size > 16) break;
      const targetGoal = new goals.GoalBlock(candidate.x, candidate.y, candidate.z);
      const route = bot.pathfinder.getPathTo ? await surveyRoute(bot, task, bot.pathfinder.movements, targetGoal, 500) : { status: 'success' };
      if (route.status === 'success' && (!surface || (route.path || []).every(p => surface.allowed(p)))) { destination = candidate; break; }
      search.visited[key(candidate)] = (search.visited[key(candidate)] || 0) + 1;
    }
    if (surface && (!destination || stalledSurface) && beginSurfaceAscent(bot, goal, land)) {
      save(); surface.restore();
      await surfaceStep(bot, task, goal, save);
      return;
    }
    if (!destination) {
      // A long route can fail from a tree perch even when a short safe step
      // down is available. Survey that local exit before declaring no route;
      // the normal >8-block exploration filter deliberately omits these cells.
      const nearby = bot.findBlocks({ matching: landIds, maxDistance: 8, count: 64,
        useExtraInfo: b => b.position.offset(0, 1, 0).distanceTo(bot.entity.position) > 1 &&
          dryPassable(bot.blockAt(b.position.offset(0, 1, 0))) && dryPassable(bot.blockAt(b.position.offset(0, 2, 0))) &&
          (!surface || surface.isSurface(b.position.offset(0, 1, 0))),
      }).map(p => p.offset(0, 1, 0)).sort((a, b) =>
        (search.visited[key(a)] || 0) * 24 + a.distanceTo(bot.entity.position) -
        (search.visited[key(b)] || 0) * 24 - b.distanceTo(bot.entity.position));
      for (const candidate of nearby.slice(0, 8)) {
        const route = bot.pathfinder.getPathTo ? await surveyRoute(bot, task, bot.pathfinder.movements,
          new goals.GoalBlock(candidate.x, candidate.y, candidate.z), 500) : { status: 'success' };
        if (route.status === 'success' && (!surface || (route.path || []).every(p => surface.allowed(p)))) {
          destination = candidate; break;
        }
      }
    }
    if (!destination && await descendPillar(bot, task, goal, save)) return;
    if (!destination) { search.leg++; save(); throw new Error(`No reachable surveyed ground while searching for ${resource}`); }
    search.visited[key(destination)] = (search.visited[key(destination)] || 0) + 1;
    save();
    try {
      await navigate(bot, task, new goals.GoalBlock(destination.x, destination.y, destination.z), surface ? { timeoutMs: 20000, stallMs: 5000 } : {});
      search.failedLegs = 0;
      const remaining = distance(bot.entity.position);
      if (remaining < search.bestDistance - 2) { search.bestDistance = remaining; search.walksWithoutProgress = 0; }
      else search.walksWithoutProgress++;
      // A geometric waypoint can lie in a lake or behind impassable terrain.
      // Reaching other ground is not progress toward it. Move on after three
      // successful walks that fail to approach, preserving the global budget.
      if (remaining < 6 || (!observed.length && search.walksWithoutProgress >= 3)) search.leg++;
    } catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
      if ((search.failedLegs = (search.failedLegs || 0) + 1) >= 2) { search.leg++; search.failedLegs = 0; }
      throw new Error(`Searching for ${resource}: ${err.message}`);
    }
  } finally { surface?.restore(); }
}

async function miningCandidates(bot, task, step, goal) {
  const names = step.sources || Object.entries(MINEABLE).filter(([, info]) => info.drops === step.drops).map(([name]) => name);
  if (step.drops === 'flint') names.push('gravel');
  const ids = names.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  const options = { matching: ids, maxDistance: 48, count: 32,
    useExtraInfo: b => faces.some(f => {
      const neighbor = bot.blockAt(b.position.plus(f));
      return air(neighbor) || neighbor?.name === 'water';
    }) && (!step.properties || Object.entries(step.properties).every(([key, value]) => String(b.getProperties()[key]) === String(value))) &&
      (step.minimumY === undefined || b.position.y >= step.minimumY) && !reservedForConstruction(goal, b.position) &&
      (step.drops !== 'dirt' || (b.position.y >= bot.entity.position.floored().y - 1 && air(bot.blockAt(b.position.offset(0, 1, 0))))) &&
      dryMiningPositions(bot, b.position, 1).length > 0,
  };
  const candidates = bot.findBlocksAsync
    ? await bot.findBlocksAsync(options, () => { task.check(); checkAir(bot); }) : bot.findBlocks(options);
  task.check(); checkAir(bot);
  rememberResources(bot, goal, candidates);
  return candidates.filter(p => {
    const k = `${p}`;
    return safeFromHostiles(bot, p) && (!goal.unreachable?.[k] || Date.now() - goal.unreachable[k] > 120000);
  });
}

async function mine(bot, task, step, goal, save, selected) {
  const surfaceOnly = isSurfaceResource(step.block);
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceStep(bot, task, goal, save); return;
  }
  const surface = surfaceOnly ? surfaceMovement(bot) : null;
  try {
    const before = countOf(bot, step.drops);
    await mineAtSource(bot, task, step, goal, save, selected);
    if (countOf(bot, step.drops) > before) await opportunisticMining(bot, task, goal, save, step, { navigate, dig });
  }
  finally { surface?.restore(); }
}

async function surfaceStep(bot, task, goal, save) {
  await returnToSurface(bot, task, goal, save, { dig, navigate, prepareTool: async () => {
    if (pickaxeTier(bot) >= 1) return true;
    if (await bootstrapPickaxe(bot, task, goal, save, { mine: mineAtSource })) return false;
    const plan = catalogPlan(bot, 'stone_pickaxe', 1, planningInventory(bot), goal);
    const step = plan[0];
    if (!step) return true;
    // Craft from carried wood/stone. Recursing into surface log gathering here
    // would ask the same recovery to provide its own missing prerequisites.
    if (step.action === 'mine' && isSurfaceResource(step.block)) throw new Blocked(`Cannot excavate a surface exit: need wood for a replacement pickaxe; no usable pickaxe or carried ingredients`);
    await executeAcquisition(bot, task, step, goal, save);
    return false;
  } });
}

async function mineAtSource(bot, task, step, goal, save, selected) {
  const candidates = selected ? [selected] : await miningCandidates(bot, task, step, goal);
  if (!candidates.length) {
    if (step.depth !== null && step.depth !== undefined) {
      const names = step.sources || Object.entries(MINEABLE).filter(([, info]) => info.drops === step.drops).map(([name]) => name);
      const ore = find(bot, names, 64, 16).find(p => safeFromHostiles(bot, p));
      const target = ore || bot.entity.position.floored().offset(24, step.depth - bot.entity.position.floored().y, 0);
      await resourceTunnelStep(bot, task, goal, save, target, step.block, { dig, navigate });
    } else await explore(bot, task, goal, save, step.block);
    return;
  }
  for (const p of candidates.slice(0, 8)) {
    task.check(); checkAir(bot);
    const before = countOf(bot, step.drops);
    let access;
    try {
      await approachDryMining(bot, task, p, { navigate });
      access = miningMovement(bot);
      await dig(bot, task, p, { done: () => countOf(bot, step.drops) > before, requiredTool: step.tool, enchantment: step.enchantment,
        minimumToolDurability: step.minimumToolDurability });
      await sleep(650);
      if (countOf(bot, step.drops) > before) return;
      const drop = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === step.drops)
        .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      if (drop) {
        const d = drop.position.floored();
        try { await navigate(bot, task, new goals.GoalNear(d.x, d.y, d.z, 1)); } catch (e) { task.check(); if (e.name === 'NeedsAir') throw e; }
        await sleep(650);
      }
      if (countOf(bot, step.drops) > before) return;
    } catch (e) {
      task.check();
      if (['NeedsAir', 'NeedsSafety'].includes(e.name)) {
        goal.unreachable ||= {}; goal.unreachable[`${p}`] = Date.now(); save(); throw e;
      }
      goal.lastMiningError = e.message;
    } finally {
      access?.restore();
      const collected = countOf(bot, step.drops) - before, search = goal.search?.[step.block];
      if (collected > 0 && search) {
        // This budget bounds fruitless searching, not the lifetime of a
        // resource request. Finding part of a deposit earns another search
        // from that location if the remaining quantity lies elsewhere.
        Object.assign(search, { attempts: 0, leg: 0, origin: { ...bot.entity.position.floored() }, failedLegs: 0,
          lastPickup: { item: step.drops, count: collected, at: new Date().toISOString() } });
        delete search.progressLeg; delete search.observedTarget;
        save();
      }
    }
    if (countOf(bot, step.drops) > before) return;
    goal.unreachable ||= {};
    goal.unreachable[`${p}`] = Date.now();
  }
  save();
  if (selected) throw new Error(goal.lastMiningError || `No ${step.drops} collected at ${selected}`);
  await explore(bot, task, goal, save, step.block);
}

async function workstation(bot, task, name) {
  // Use a carried table nearby instead of spending ingredients/scaffolding
  // walking back to a distant bench. Existing nearby player tables may still
  // be reused, but only tables placed by this session are collected afterward.
  const candidates = find(bot, [name], name === 'crafting_table' && countOf(bot, name) ? 4 : 32, 8);
  const existing = await approachWorkstation(bot, task, name, candidates);
  if (existing) return existing;
  if (!countOf(bot, name)) throw new Blocked(`I can't reach a ${name.replaceAll('_', ' ')}. I need one I can use.`);
  let p;
  const o = bot.entity.position.floored();
  for (const dy of [0, -1, 1, -2, 2]) for (let dx = -2; dx <= 2 && !p; dx++) for (let dz = -2; dz <= 2 && !p; dz++) {
    if (!dx && !dz) continue;
    const q = o.offset(dx, dy, dz);
    if (air(bot.blockAt(q)) && bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block') {
      await place(bot, task, q, name); p = q;
      bot._ownedWorkstations ||= new Set(); bot._ownedWorkstations.add(`${name}:${q}`);
    }
  }
  if (!p) throw new Error(`No place for ${name}`);
  const placed = await approachWorkstation(bot, task, name, [p]);
  if (!placed) throw new Blocked(`I can't reach the ${name.replaceAll('_', ' ')} I placed`);
  return placed;
}

async function craft(bot, task, step, goal) {
  await settleCraftInventory(bot, task);
  const table = step.needs_table ? await workstation(bot, task, 'crafting_table') : null;
  const id = bot.registry.itemsByName[step.item]?.id;
  const recipe = step.recipe ? new (require('prismarine-recipe')(bot.registry).Recipe)({ result: { id, count: step.recipe.count },
    ...(step.recipe.shape ? { inShape: step.recipe.shape.map(row => row.map(name => name ? bot.registry.itemsByName[name].id : null)) } :
      { ingredients: step.recipe.ingredients.map(name => bot.registry.itemsByName[name].id) }) }) : bot.recipesFor(id, null, step.count, table)[0];
  if (!recipe) throw new Error(`No usable recipe for ${step.count} ${step.item}`);
  const before = countOf(bot, step.item);
  task.check();
  // Reconcile the cursor/grid between recipes while keeping a shared batch at
  // the same bench. Server-confirmed output, not planned amounts, is progress.
  const batches = Math.min(Math.ceil(step.count / recipe.result.count),
    Math.max(1, Math.floor((bot.registry.itemsByName[step.item].stackSize || 64) / recipe.result.count)));
  for (let n = 0; n < batches; n++) {
    task.check();
    try { await bot.craft(recipe, 1, table); }
    finally { task.check(); await settleCraftInventory(bot, task); }
    await waitFor(task, () => countOf(bot, step.item) >= before + recipe.result.count * (n + 1));
  }
  if (table && !goal?.holdWorkstation && (goal?.expeditionReady || goal?.preparingExpedition) && bot._ownedWorkstations?.has(`crafting_table:${table.position}`)) {
    const count = countOf(bot, 'crafting_table');
    await dig(bot, task, table.position);
    await navigate(bot, task, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 1));
    await waitFor(task, () => countOf(bot, 'crafting_table') > count);
    bot._ownedWorkstations.delete(`crafting_table:${table.position}`);
  }
}

async function settleCraftInventory(bot, task) {
  task.check();
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  if (bot.inventory.selectedItem) {
    await bot.putSelectedItemRange(bot.inventory.inventoryStart, bot.inventory.inventoryEnd, bot.inventory);
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  }
  for (let slot = 1; slot <= 4; slot++) {
    task.check();
    if (bot.inventory.slots?.[slot]) await bot.putAway(slot);
  }
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  task.check();
}

class SmeltingSuppliesNeeded extends Error {
  constructor(item, count) { super(`The saved furnace batch needs ${count} ${item}`); this.item = item; this.count = count; }
}

async function smelt(bot, task, step, goal, save = () => {}) {
  task.check();
  const pending = goal?.smelting;
  const fuelItem = pending?.fuelItem || step.fuelItem || 'oak_planks';
  if (!fuelPlanks.includes(fuelItem)) throw new Blocked(`I can't use ${fuelItem.replaceAll('_', ' ')} as furnace fuel`);
  if (pending && (pending.item !== step.item || pending.from !== step.from)) throw new Blocked('Finish the saved furnace batch before starting a different one');
  if (pending && countOf(bot, step.item) >= pending.targetInventory) { delete goal.smelting; save(); return; }
  let block;
  if (pending) {
    const p = pos(pending.position);
    // Return to the recorded area before deciding that an unloaded furnace
    // disappeared. Once observed, the same visible-face checks apply.
    if (!bot.blockAt(p)) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3));
    if (bot.blockAt(p)?.name !== 'furnace') throw new Blocked('The furnace holding our saved batch is missing');
    // Never switch furnaces while the saved ingredients/output belong to this one.
    block = await approachWorkstation(bot, task, 'furnace', [p]);
    if (!block) throw new Blocked("I can't reach the furnace holding our saved batch");
  } else block = await workstation(bot, task, 'furnace');
  const before = countOf(bot, step.item);
  const needed = Math.min(pending ? pending.targetInventory - before : step.count, 64);
  if (goal && !pending) {
    goal.smelting = { item: step.item, from: step.from, fuelItem, position: { ...block.position }, targetInventory: before + needed, count: needed };
    save();
  }
  const furnace = await bot.openFurnace(block);
  // While a container is open Mineflayer updates that window's player slots;
  // bot.inventory can still contain the pre-transfer counts until it closes.
  const carried = name => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart)
    ? furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(i => i?.name === name).reduce((n, i) => n + i.count, 0)
    : countOf(bot, name);
  let taken = 0, supplies;
  const collect = async () => {
    const output = furnace.outputItem();
    if (!output) return;
    if (output.name !== step.item) throw new Error('Furnace contains a different output');
    const amount = output.count;
    await furnace.takeOutput();
    taken += amount;
  };
  try {
    await collect();
    if (taken < needed) {
      const existing = furnace.inputItem();
      if (existing && existing.name !== step.from) throw new Error('Furnace contains another input');
      const amount = needed - taken;
      const missingInput = Math.max(0, amount - (existing?.count || 0));
      if (missingInput > carried(step.from)) throw new SmeltingSuppliesNeeded(step.from, missingInput);
      if (missingInput) await furnace.putInput(bot.registry.itemsByName[step.from].id, null, missingInput);
      const fuel = async () => {
        task.check();
        const input = furnace.inputItem(), current = furnace.fuelItem();
        // A consumed plank is now burn time, not missing stock to replace.
        // Wait for both the fuel stack and active burn to empty before adding
        // more, so this batch cannot swallow the next recipe's fuel reserve.
        const burning = () => furnace.fuelSeconds > 0 || furnace.fuel > 0;
        if (!input || current || burning()) return;
        if (furnace.fuel === null) { await sleep(100); task.check(); if (furnace.fuelItem() || burning()) return; }
        const wanted = Math.ceil(Math.min(input.count, needed - taken) / ITEMS_PER_PLANK);
        const extra = Math.min(wanted, carried(fuelItem));
        if (extra) await furnace.putFuel(bot.registry.itemsByName[fuelItem].id, null, extra);
        else if (!current && !burning()) throw new SmeltingSuppliesNeeded(fuelItem, wanted);
      };
      await fuel();
      const deadline = Date.now() + amount * 12000 + 10000;
      while (taken < needed) {
        task.check();
        if (Date.now() > deadline) throw new Error(`Smelting ${step.item} timed out`);
        await collect();
        if (taken < needed) await fuel();
        if (taken < needed) await sleep(250);
      }
    }
  } catch (error) {
    if (!(error instanceof SmeltingSuppliesNeeded)) throw error;
    supplies = error;
  } finally {
    try { if (bot._syncWindow) await bot._syncWindow(furnace); }
    finally { furnace.close(); }
  }
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  if (supplies) {
    if (!goal?.smelting) throw new Blocked(supplies.message);
    // Close the furnace before finding supplies, retaining its location and
    // output target. A separate saved subtask avoids recursively resuming the
    // same hungry furnace or replanning ore already cooking inside it.
    const work = goal.smelting.supplyWork ||= { kind: 'obtain', request: goal.request, from: goal.from };
    goal.smelting.missingSupply = { item: supplies.item, count: supplies.count };
    const checkpoint = () => { goal.step = { action: 'refuel_furnace', detail: work.step, item: supplies.item }; save(); };
    checkpoint();
    await acquireStep(bot, task, supplies.item, supplies.count, work, checkpoint);
    return;
  }
  await waitFor(task, () => countOf(bot, step.item) >= before + needed);
  if (goal) { delete goal.smelting; save(); }
}

async function harden(bot, task, goal, save, item = 'purple_concrete') {
  const powder = `${item}_powder`;
  if (pickaxeTier(bot) < 1) throw new Error('Concrete needs a pickaxe');
  if (!goal.concreteStation) {
    const water = find(bot, ['water'], 48, 64);
    for (const w of water) {
      const bank = faces.slice(1, 5).map(f => w.plus(f)).find(p => {
        const at = bot.blockAt(p);
        return (air(at) || ['dirt', 'grass_block', 'sand', 'gravel'].includes(at?.name)) &&
          bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
      });
      if (bank) { goal.concreteStation = { ...bank }; save(); break; }
    }
  }
  if (!goal.concreteStation) { await explore(bot, task, goal, save, 'water bank for concrete'); return; }
  const p = pos(goal.concreteStation);
  if (bot.entity.position.distanceTo(p) > 4) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
  const existing = bot.blockAt(p);
  if (![item, powder].includes(existing?.name)) {
    if (!air(existing) && existing?.name !== 'water') await dig(bot, task, p);
    await place(bot, task, p, powder);
  }
  await waitFor(task, () => bot.blockAt(p)?.name === item);
  const before = countOf(bot, item);
  await dig(bot, task, p);
  await sleep(650);
  if (countOf(bot, item) <= before) {
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1));
    await waitFor(task, () => countOf(bot, item) > before);
  }
}

function catalogPlan(bot, item, count, stock, goal = {}) {
  const outputs = Array.isArray(item) ? item : [{ item, count }];
  if (bot.game?.gameMode === 'creative') return outputs.filter(output => (stock[output.item] || 0) < output.count)
    .map(({ item, count }) => ({ action: 'creative_inventory', item, count, consumes: {}, produces: { [item]: count - (stock[item] || 0) } }));
  if (!bot._catalogObservation || Date.now() - bot._catalogObservation.at > 5000 || bot.entity.position.distanceTo(pos(bot._catalogObservation.position)) > 8) {
    const ids = bot.registry.blocksArray.filter(b => /(_log|_wood|_ore)$|^(stone|sand|gravel|dirt|poppy|cornflower)$/.test(b.name)).map(b => b.id);
    const positions = bot.findBlocks({ matching: ids, maxDistance: 32, count: 48,
      useExtraInfo: b => faces.some(f => air(bot.blockAt(b.position.plus(f)))) });
    rememberResources(bot, goal, positions);
    const nearby = positions.map(p => bot.blockAt(p)?.name).filter(Boolean);
    bot._catalogObservation = { at: Date.now(), position: { ...bot.entity.position }, nearby };
  }
  const tools = bot.inventory.items().filter(i => i.maxDurability).map(i => {
    let enchantments = [];
    try { enchantments = i.enchants.map(e => e.name); } catch (_) {}
    return { name: i.name, enchantments };
  });
  const nearby = [...new Set([...bot._catalogObservation.nearby, ...knownResourceNames(bot, goal)])];
  const equipment = carriedEquipment(bot).map(item => item.name);
  const makePlan = nearby => Array.isArray(item) ? batchPlan(bot.registry, outputs, stock, { nearby, tools, equipment }).steps :
    planCatalog(bot.registry, item, count, stock, { nearby, tools, equipment });
  const plan = makePlan(nearby);
  const alternatives = observeRecipeAlternatives(bot, plan, goal);
  return alternatives.some(name => !nearby.includes(name))
    ? makePlan([...new Set([...nearby, ...alternatives])]) : plan;
}

async function acquireStep(bot, task, item, count, goal, save, { minimumMiningY } = {}) {
  task.check(); checkAir(bot);
  if (goal.smelting) { await smelt(bot, task, goal.smelting, goal, save); return false; }
  const inv = planningInventory(bot);
  if ((inv[item] || 0) >= count) return true;
  if (item.endsWith('_pickaxe') && pickaxeTier(bot) < 1 && await bootstrapPickaxe(bot, task, goal, save, { mine: mineAtSource })) return false;
  const available = await withUsableWorkstations(bot, task, inv, [item]);
  const step = catalogPlan(bot, item, count, available, goal)[0];
  if (!step) throw new Error(`No progress step for ${item}`);
  if (minimumMiningY !== undefined && step.action === 'mine') step.minimumY = minimumMiningY;
  await executeAcquisition(bot, task, step, goal, save);
  return false;
}

async function executeAcquisition(bot, task, step, goal, save) {
  goal.step = step;
  save();
  if (step.action === 'mine') await mine(bot, task, step, goal, save);
  else if (step.action === 'creative_inventory') await takeCreativeItem(bot, task, step.item, step.count);
  else if (step.action === 'craft') await craft(bot, task, step, goal);
  else if (step.action === 'smelt') await smelt(bot, task, step, goal, save);
  else if (step.action === 'harden') await harden(bot, task, goal, save, step.item);
  else if (step.action === 'fill_bucket') await collectWater(bot, task, goal, save, { navigate, explore });
  else if (step.action === 'hunt_mob') await prepareMobHunt(bot, task, step, goal, save, { acquireStep, explore, enterNether: netherStep });
  else throw new Error(`Unknown action ${step.action}`);
}

function selectSite(bot, material) {
  const o = bot.entity.position.floored();
  for (let radius = 0; radius <= 12; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const heights = [];
      for (let x = -2; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        let surface = null;
        for (let y = o.y + 3; y >= o.y - 3; y--) {
          const p = new Vec3(o.x + dx + x, y, o.z + dz + z);
          const ground = bot.blockAt(p.offset(0, -1, 0));
          const above = bot.blockAt(p);
          if (ground?.boundingBox === 'block' && !['ice', 'magma_block'].includes(ground.name) &&
              (air(above) || ['short_grass', 'tall_grass', 'fern', 'snow'].includes(above?.name))) { surface = y; break; }
        }
        heights.push(surface);
      }
      if (heights.some(y => y === null) || Math.max(...heights) - Math.min(...heights) > 1) continue;
      const origin = new Vec3(o.x + dx, Math.max(...heights), o.z + dz);
      const blueprint = houseBlueprint(origin, material);
      const clear = [...blueprint.blocks, ...blueprint.empty].filter(p => p.y >= origin.y).every(p => {
        const b = bot.blockAt(pos(p)); return air(b) || ['short_grass', 'tall_grass', 'fern', 'snow'].includes(b?.name);
      });
      if (clear) return blueprint;
    }
  }
  return null;
}

async function buildHouseStep(bot, task, goal, save) {
  if (!goal.blueprint) {
    goal.blueprint = selectSite(bot, goal.material);
    if (!goal.blueprint) { await explore(bot, task, goal, save, 'flat building site'); return false; }
    save();
  }
  const blueprint = goal.blueprint;
  if (!bot.blockAt(pos(blueprint.origin))) {
    const home = pos(blueprint.entrance);
    await navigate(bot, task, new goals.GoalNear(home.x, home.y, home.z, 2));
    return false;
  }
  const missing = blueprint.blocks.filter(p => !matchesBuildBlock(bot.blockAt(pos(p)), p));
  const required = bot.game.gameMode === 'creative' ? Math.min(1, missing.length) : missing.length;
  if (missing.length && countOf(bot, goal.material) < required) {
    await acquireStep(bot, task, goal.material, required, goal, save);
    return false;
  }
  goal.step = { action: 'build', remainingBlocks: missing.length, origin: blueprint.origin };
  save();
  const o = pos(blueprint.origin);
  if (bot.entity.position.distanceTo(o) > 4) await navigate(bot, task, new goals.GoalNear(o.x, o.y, o.z, 1));
  // Prevent pathfinding from dismantling the house while navigating around it.
  const movements = bot.pathfinder.movements;
  const previous = movements.canDig;
  movements.canDig = false;
  try {
    const obstruction = blueprint.empty.find(p => !air(bot.blockAt(pos(p))));
    if (obstruction) { await dig(bot, task, pos(obstruction)); return false; }
    // Floor/walls first; within a layer start where there is already an anchor.
    const ordered = missing.sort((a, b) => a.y - b.y ||
      Number(faces.some(f => bot.blockAt(pos(b).plus(f))?.boundingBox === 'block')) -
      Number(faces.some(f => bot.blockAt(pos(a).plus(f))?.boundingBox === 'block')));
    for (const p of ordered.slice(0, 8)) {
      const target = pos(p);
      if (!air(bot.blockAt(target))) {
        // Floor replacement: step off it before digging.
        const feet = bot.entity.position.floored();
        if (target.equals(feet.offset(0, -1, 0))) await navigate(bot, task, new goals.GoalBlock(o.x, o.y, o.z - 3));
        await dig(bot, task, target);
      }
      await place(bot, task, target, p.material);
      save();
    }
  } finally { movements.canDig = previous; }
  return verifyHouse(bot, blueprint).ok;
}

function decisionObservation(bot, goal) {
  const hostiles = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'spider', 'cave_spider', 'witch', 'pillager', 'phantom']);
  return {
    playerRequest: goal.request, retainedGoal: goal.kind,
    inventory: planningInventory(bot), health: bot.health, food: bot.food, oxygen: bot.oxygenLevel,
    survivalFacts: { healthMaximum: 20, hungerMaximum: 20, hungerNeedsAttention: bot.food <= 16,
      injured: bot.health < 20, hungerAllowsNaturalHealing: bot.food >= 18, safeFoodCarried: !!chooseFood(bot) },
    dimension: bot.game.dimension, position: { ...bot.entity.position.floored() },
    daylight: bot.time?.timeOfDay < 12000 ? 'day' : bot.time?.timeOfDay < 23000 ? 'night' : 'dawn',
    nearbyThreats: Object.values(bot.entities || {}).filter(e => hostiles.has(e.name) && e.position.distanceTo(bot.entity.position) < 24)
      .map(e => ({ id: e.id, name: e.name, distance: Math.round(e.position.distanceTo(bot.entity.position)) })),
    recentFailures: goal.decisionFailures || {},
  };
}

async function houseDecisionStep(bot, task, goal, save, client, onStep) {
  if (goal.blueprint && !bot.blockAt(pos(goal.blueprint.origin))) {
    const home = pos(goal.blueprint.entrance);
    goal.step = { action: 'return_to_site', position: { ...home } }; save();
    await navigate(bot, task, new goals.GoalNear(home.x, home.y, home.z, 2));
    return false;
  }
  if (goal.blueprint && verifyHouse(bot, goal.blueprint).ok) return true;
  const subtasks = {};
  const leaf = (description, run, valid = () => true) => ({ description, run, valid });
  if (!goal.blueprint) {
    const site = selectSite(bot, goal.material);
    subtasks.choose_site = { description: 'Select and reserve a level house site before construction.', children: {
      [site ? 'reserve_site' : 'survey_ground']: site
        ? leaf(`Reserve the inspected building site at ${pos(site.origin)}.`, async () => { goal.blueprint = site; save(); })
        : leaf('Walk to another surveyed dry area to look for a level building site.', () => explore(bot, task, goal, save, 'flat building site')),
    } };
  }
  const missing = goal.blueprint ? goal.blueprint.blocks.filter(p => bot.blockAt(pos(p))?.name !== p.material) : houseBlueprint(bot.entity.position, goal.material).blocks;
  const stock = planningInventory(bot);
  const required = bot.game.gameMode === 'creative' ? Math.min(1, missing.length) : missing.length;
  if ((stock[goal.material] || 0) < required) {
    const inv = await withUsableWorkstations(bot, task, stock, [goal.material]);
    const step = catalogPlan(bot, goal.material, required, inv, goal)[0];
    const actions = {};
    if (step?.action === 'mine') {
      for (const p of (await miningCandidates(bot, task, step, goal)).slice(0, 16)) {
        if (Object.keys(actions).length >= 4) break;
        // Do not ask Jev to choose unsupported targets such as the trunk it
        // stands on or floating remnants with no currently feasible approach.
        if (p.equals(supportCell(bot.entity.position))) continue;
        if (!bot.canDigBlock(bot.blockAt(p))) {
          const route = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalGetToBlock(p.x, p.y, p.z), 300);
          if (route.status !== 'success') continue;
        }
        const name = bot.blockAt(p).name;
        const key = `gather_${p.x}_${p.y}_${p.z}`;
        actions[key] = leaf({ action: bot.canDigBlock(bot.blockAt(p)) ? 'dig and collect' : 'approach, dig and collect',
          block: name, position: { ...p }, distance: Math.round(p.distanceTo(bot.entity.position)),
          elevationChange: p.y - Math.floor(bot.entity.position.y), resourceNeeded: step.drops },
        async () => { goal.step = step; save(); await mine(bot, task, step, goal, save, p); },
        () => bot.blockAt(p)?.name === name);
      }
      if (!Object.keys(actions).length) actions.explore_resource = leaf(`Search for a reachable source of ${step.drops}.`, () => acquireStep(bot, task, goal.material, required, goal, save));
    } else {
      actions[step?.action || 'prepare_material'] = leaf(`Execute the next verified recipe dependency: ${JSON.stringify(step)}.`, () => acquireStep(bot, task, goal.material, required, goal, save));
    }
    subtasks.gather_materials = { description: `Obtain materials: ${stock[goal.material] || 0} ${goal.material} carried, ${missing.length} blocks remain to build.`, children: actions };
  }
  if (goal.blueprint) {
    const obstructed = goal.blueprint.empty.filter(p => !air(bot.blockAt(pos(p))));
    const clear = {};
    for (const p of obstructed.slice(0, 3)) {
      if (!bot.blockAt(pos(p))?.diggable) continue;
      clear[`clear_${p.x}_${p.y}_${p.z}`] = leaf(`Clear ${bot.blockAt(pos(p)).name} from the house interior at ${pos(p)}.`, () => dig(bot, task, pos(p)));
    }
    if (Object.keys(clear).length) subtasks.clear_interior = { description: 'Clear the interior and doorway so the house remains traversable.', children: clear };
    if ((stock[goal.material] || 0) > 0 && missing.length) {
      const layer = Math.min(...missing.map(p => p.y));
      const actions = {};
      for (const p of missing.filter(p => p.y === layer).slice(0, 4)) {
        const q = pos(p);
        const block = bot.blockAt(q);
        const empty = air(block);
        if ((!empty && !block?.diggable) || (empty && !faces.some(f => bot.blockAt(q.plus(f))?.boundingBox === 'block'))) continue;
        const key = `${empty ? 'place' : 'clear'}_${p.x}_${p.y}_${p.z}`;
        if (goal.decisionFailures?.[key]?.at > Date.now() - 120000) continue;
        actions[key] = leaf(`${empty ? `Place ${p.material}` : `Clear ${block.name} for construction`} at ${q}; build the lowest unfinished layer first.`, async () => {
          goal.step = { action: empty ? 'place' : 'clear', position: { ...q }, material: p.material }; save();
          if (empty) await place(bot, task, q, p.material); else await dig(bot, task, q);
        }, () => bot.blockAt(q)?.name === block.name);
      }
      if (Object.keys(actions).length) subtasks.build = { description: 'Use carried materials to construct the foundation, walls, then roof.', children: actions };
    }
  }
  if (!Object.keys(subtasks).length) throw new Blocked('No feasible house action remains; inspect the saved construction failures');
  const tree = { build_house: { description: 'Continue the retained player request to build a house.', children: subtasks } };
  if (chooseFood(bot) && (bot.food <= 16 || (bot.health <= 12 && bot.food < 20))) {
    tree.restore_food = { description: 'Pause house work to restore hunger and allow health regeneration.', children: {
      eat_carried_food: { description: 'Eat a safe food item already in inventory.', children: {
        eat: leaf('Eat and verify that hunger increased, retaining the house goal.', () => maintainVitals(bot, task, step => { goal.survivalAction = step; save(); })),
      } },
    } };
  }
  await decideAction(bot, task, goal, save, client, onStep, tree);
  return !!goal.blueprint && verifyHouse(bot, goal.blueprint).ok;
}

async function decideAction(bot, task, goal, save, client, onStep, tree, context = {}) {
  const observation = decisionObservation(bot, goal);
  const state = { ...observation, ...context };
  const fingerprint = JSON.stringify(observation);
  const controller = new AbortController();
  const watcher = setInterval(() => {
    try { task.check(); checkAir(bot); }
    catch (err) { controller.abort(err); }
  }, 100);
  let decision;
  try {
    decision = await decideTree(client, { state, tree, signal: controller.signal,
      isFresh: () => JSON.stringify(decisionObservation(bot, goal)) === fingerprint });
  } finally { clearInterval(watcher); }
  task.check(); checkAir(bot);
  const record = { at: new Date().toISOString(), path: decision.path, latencyMs: decision.latencyMs,
    state, options: JSON.parse(JSON.stringify(tree)), usage: decision.usage, judgments: decision.judgments,
    stale: decision.stale || (decision.action.valid ? !decision.action.valid() : false) };
  goal.decisions ||= []; goal.decisions.push(record); goal.decisions = goal.decisions.slice(-40);
  save(); onStep(goal);
  if (record.stale) return false;
  try { await decision.action.run(); }
  catch (err) {
    task.check(); if (err.name === 'NeedsAir') throw err;
    goal.decisionFailures ||= {};
    goal.decisionFailures[decision.path.at(-1)] = { at: Date.now(), reason: err.message };
    throw err;
  }
  return true;
}

async function designedBuildStep(bot, task, goal, save, client, onStep) {
  // Mineflayer emits this only for placements performed by this bot, including
  // pathfinder scaffolding. Persist ownership so resume can clear that access.
  const placed = (_old, block) => {
    if (!goal.blueprint) return;
    const p = block.position;
    goal.buildOwned ||= {};
    goal.buildOwned[`${p.x},${p.y},${p.z}`] = blockOwnership(block);
    save();
  };
  bot.on('blockPlaced', placed);
  try { return await executeDesignedBuildStep(bot, task, goal, save, client, onStep); }
  finally { bot.removeListener('blockPlaced', placed); }
}

async function executeDesignedBuildStep(bot, task, goal, save, client, onStep = () => {}) {
  if (!goal.design) {
    const mode = process.env.BUILD_DESIGNER || 'auto';
    if (!['auto', 'jev', 'openrouter'].includes(mode)) throw new Blocked('BUILD_DESIGNER must be auto, jev or openrouter');
    const fallback = mode === 'jev' || mode === 'auto' && !process.env.OPENROUTER_API_KEY;
    // Recheck saved geometry after a validator update, before paying for a
    // replacement or silently reducing the user's request to a house template.
    if (!fallback && goal.designDraft) {
      try {
        goal.design = { ...validateSchematic(goal.designDraft, bot.registry), backend: 'validated-saved-draft', createdAt: new Date().toISOString() };
        delete goal.designDraft; delete goal.designError; delete goal.designFallbackReason; save(); return false;
      } catch (error) { goal.designError = error.message; }
    }
    if (!fallback && (goal.designAttempts || 0) >= 4) throw new Blocked(`Building designer could not produce a usable plan after four attempts: ${goal.designError || 'request failed'}`);
    goal.step = { action: 'design_building' }; save(); onStep(goal);
    if (fallback) {
      if (!client) throw new Blocked('The building fallback needs a configured Jev connection');
      goal.designFallbackReason = goal.designError || (mode === 'jev' ? 'Jev templates selected' : 'No OpenRouter designer key configured');
      bot.chat("I'm working out a simpler way to build it.");
    } else goal.designAttempts = (goal.designAttempts || 0) + 1;
    try { goal.design = fallback ? await designWithJev(bot, task, goal.request, client, goal.memoryContext) :
      await designBuilding(bot, task, goal.request, { previousDraft: goal.designDraft, feedback: goal.designError, memory: goal.memoryContext }); }
    catch (err) {
      if (!fallback && ['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) goal.designAttempts--;
      goal.designError = err.message;
      if (err.draft) goal.designDraft = err.draft;
      if (!['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) {
        (goal.designHistory ||= []).push({ at: new Date().toISOString(), attempt: goal.designAttempts, error: err.message, draft: err.draft });
        goal.designHistory = goal.designHistory.slice(-4);
        if (!fallback && err.draft && goal.designAttempts < 4) err.name = 'DesignRepair';
      }
      save(); throw err;
    }
    delete goal.designDraft; delete goal.designError;
    save();
    bot.chat(`I've planned ${goal.design.source.name}! I'll find a good spot and start building.`);
    return false;
  }
  const schematic = validateSchematic(goal.design.source, bot.registry);
  if (!goal.blueprint) {
    goal.blueprint = selectSchematicSite(bot, schematic);
    if (!goal.blueprint) {
      goal.step = { action: 'find_build_site', dimensions: schematic.source.size }; save();
      await explore(bot, task, goal, save, 'supported building site', { surfaceOnly: true });
      return false;
    }
    save();
    bot.chat(`Building ${goal.design.source.name} near ${pos(goal.blueprint.origin)}.`);
  }
  const blueprint = goal.blueprint;
  if (!bot.blockAt(pos(blueprint.origin))) {
    const p = pos(blueprint.entrance);
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2)); return false;
  }
  if (blueprint.terrain && !blueprint.terrain.prepared) {
    await prepareBuildTerrain(bot, task, goal, save); return false;
  }
  if (verifyHouse(bot, blueprint).ok && !schematicScaffolding(bot, goal).length) return true;
  const missing = blueprint.blocks.filter(p => !p.companion && !buildCellComplete(bot, p));
  const blockedParts = missing.flatMap(p => buildFootprint(p).slice(1).filter(part => !air(bot.blockAt(pos(part))) &&
    (!isDoor(bot.blockAt(pos(p))?.name) || !matchesBuildBlock(bot.blockAt(pos(part)), part))));
  const obstructions = [...new Map([...blueprint.empty.filter(p => !air(bot.blockAt(pos(p)))), ...blockedParts, ...schematicScaffolding(bot, goal)]
    .map(p => [`${p.x},${p.y},${p.z}`, p])).values()];
  const changed = [...missing.flatMap(buildFootprint), ...obstructions].find(p => {
    const block = bot.blockAt(pos(p));
    return block && !canClearSchematicBlock(blueprint, goal.buildOwned, block);
  });
  if (changed) throw new Blocked(`The building site changed at ${pos(changed)}; preserving the unexpected ${bot.blockAt(pos(changed)).name}. Clear it or request a new build`);
  // Recover our own wrongly oriented piece before gathering another copy.
  // This also repairs a door whose server-created upper half is missing.
  const repairs = missing.filter(p => bot.blockAt(pos(p))?.name === p.material)
    .map(p => ({ position: p, operation: 'dig', material: p.material, properties: p.properties }));
  if (repairs.length) {
    const repair = await chooseConstructionWork(bot, task, goal, repairs);
    if (repair) {
      goal.step = { action: 'build_schematic', operation: 'repair', position: { ...repair.position }, material: repair.material }; save(); onStep(goal);
      await executeConstructionWork(bot, task, goal, save, repair); return false;
    }
  }
  // Retain one working lot instead of independently reselecting a material on
  // every block. Recipe inputs shared by the lot are gathered together.
  if (!goal.buildBatch || !remainingBuildBatch(bot, goal.buildBatch).length) {
    delete goal.buildBatch;
    if (missing.length) {
      const stock = planningInventory(bot);
      goal.buildBatch = createBuildBatch(bot, missing, outputs => catalogPlan(bot, outputs, undefined, stock, goal), stock);
      save();
    }
  }
  const batch = goal.buildBatch;
  if (goal.smelting) { await smelt(bot, task, goal.smelting, goal, save); return false; }
  if (batch) {
    const cells = remainingBuildBatch(bot, batch), outputs = materialCounts(cells);
    if (bot.game.gameMode === 'creative') for (const output of outputs) output.count = 1;
    if (batch.phase === 'gather' || outputs.some(o => !countOf(bot, o.item))) {
      const stock = await withUsableWorkstations(bot, task, planningInventory(bot), outputs.map(o => o.item));
      const plan = catalogPlan(bot, outputs, undefined, stock, goal);
      if (plan.length) {
        goal.buildPhase = 'gather';
        goal.holdWorkstation = plan[0].action === 'craft' && plan[1]?.action === 'craft';
        await executePlannedAcquisition(bot, task, goal, save, client, onStep, plan, { outputs, purpose: 'materials for the next construction batch' });
        return false;
      }
      batch.phase = 'build'; goal.buildPhase = 'build'; save();
    }
  }
  if (!missing.length) goal.buildPhase = 'cleanup';
  const layer = Math.min(...missing.map(p => p.y));
  const availablePlacements = (batch ? remainingBuildBatch(bot, batch) : []).filter(p => countOf(bot, p.material) &&
    (air(bot.blockAt(pos(p))) || bot.blockAt(pos(p))?.diggable) &&
    (!isDoor(p.material) || !air(bot.blockAt(pos(p))) || air(bot.blockAt(pos(p).offset(0, 1, 0)))) &&
    faces.some(f => bot.blockAt(pos(p).plus(f))?.boundingBox === 'block'))
    .map(p => ({ position: p, operation: air(bot.blockAt(pos(p))) ? 'place' : 'dig', material: p.material, properties: p.properties }));
  const placements = availablePlacements.filter(p => p.position.y === layer);
  const clearing = obstructions.filter(p => {
    const block = bot.blockAt(pos(p));
    return block?.diggable && (!missing.length || !['dirt', 'cobblestone'].includes(block.name) || goal.buildOwned?.[`${p.x},${p.y},${p.z}`] !== (block.stateId ?? block.name));
  }).sort((a, b) => b.y - a.y).map(p => ({ position: p, operation: 'dig', cleanup: true,
    priority: !missing.length ? -p.y * 1000 - pos(p).distanceTo(pos(blueprint.entrance)) : 0 }));
  // Clear reachable space before trying a face hidden by vegetation/scaffolds.
  let work = await chooseConstructionWork(bot, task, goal, [...placements, ...clearing]);
  // Upside-down trim can depend on a beam above it. Prefer low layers, but
  // finish reachable supports elsewhere in this batch before declaring a
  // lower piece inaccessible. The work-face check still enforces its state.
  if (!work) work = await chooseConstructionWork(bot, task, goal, availablePlacements.filter(p => p.position.y !== layer));
  if (!work && missing.length && bot.game.gameMode !== 'creative' && countOf(bot, 'dirt') < 32) {
    await acquireStep(bot, task, 'dirt', 32, goal, save); return false;
  }
  if (!work && !missing.length && await descendPillar(bot, task, goal, save)) return false;
  let repairedAccess = false;
  if (!work && !missing.length && !(goal.cleanupAccessRepairs >= 1)) {
    // A resumed cleanup may already be stranded after removing an access
    // bridge. Permit one bounded repair, then remove the remote end first.
    // Ordinary cleanup itself never continually builds replacement scaffolds.
    goal.buildPhase = 'cleanup_access';
    work = await chooseConstructionWork(bot, task, goal, clearing);
    if (work) { goal.cleanupAccessRepairs = (goal.cleanupAccessRepairs || 0) + 1; repairedAccess = true; save(); }
    else goal.buildPhase = 'cleanup';
  }
  if (!work) throw new Blocked('I cannot reach the next part of the building yet; the design and progress are saved');
  const p = pos(work.position);
  goal.step = { action: work.cleanup ? 'clear_schematic' : 'build_schematic', operation: work.operation,
    position: { ...p }, material: work.material, properties: work.properties, remainingBlocks: missing.length }; save(); onStep(goal);
  try { await executeConstructionWork(bot, task, goal, save, work); }
  finally { if (repairedAccess) { goal.buildPhase = 'cleanup'; save(); } }
  return verifyHouse(bot, blueprint).ok && !schematicScaffolding(bot, goal).length;
}

async function executeConstructionWork(bot, task, goal, save, work) {
  const p = pos(work.position);
  if (work.operation === 'dig' && Object.keys(bot.blockAt(p)?.harvestTools || {}).length && pickaxeTier(bot) < 1 && bot.game.gameMode !== 'creative') {
    await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return;
  }
  const face = await approachConstruction(bot, task, goal, p, work.operation, work);
  const footprint = buildFootprint({ ...p, material: work.material, properties: work.properties });
  for (const part of footprint) if (!canClearSchematicBlock(goal.blueprint, goal.buildOwned, bot.blockAt(pos(part)))) throw new Blocked(`Building site changed at ${pos(part)}`);
  if (work.operation === 'dig') {
    // dig() first updates the local world optimistically. Keep ownership until
    // the server confirms air, otherwise a rejected dig looks like a player's
    // unexpected replacement after resume.
    let confirmed = false;
    const changed = packet => { if (packet.location?.x === p.x && packet.location.y === p.y && packet.location.z === p.z) confirmed = packet.type === 0; };
    bot._client.on('block_change', changed);
    try {
      await dig(bot, task, p, { requireDrops: false });
      await waitFor(task, () => confirmed && footprint.every(part => air(bot.blockAt(pos(part)))), 5000);
    } finally { bot._client.removeListener('block_change', changed); }
    for (const part of footprint) delete goal.buildOwned?.[`${part.x},${part.y},${part.z}`];
    // Retain the original name: grass and water can change state naturally.
  } else {
    let placed = false;
    const observe = (_old, block) => { if (block.position.equals(p)) placed = true; };
    bot.on('blockPlaced', observe);
    try { await place(bot, task, p, work.material, { face, properties: work.properties }); }
    finally {
      bot.removeListener('blockPlaced', observe);
      // A door's second block is created by the server, not a second placement.
      // Capture both acknowledgements even when stop arrives on blockPlaced.
      if (placed && footprint.length > 1) {
        const deadline = Date.now() + 250;
        while (!doorPairMatches(bot.blockAt(p), bot.blockAt(p.offset(0, 1, 0))) && Date.now() < deadline) await sleep(25);
        if (doorPairMatches(bot.blockAt(p), bot.blockAt(p.offset(0, 1, 0)))) {
          goal.buildOwned ||= {};
          for (const part of footprint) goal.buildOwned[`${part.x},${part.y},${part.z}`] = blockOwnership(bot.blockAt(pos(part)));
        }
        save();
      }
    }
  }
  save();
}

async function prepareBuildTerrain(bot, task, goal, save) {
  task.check();
  const { blueprint } = goal, terrain = blueprint.terrain;
  const toClear = terrain.clear.filter(p => !air(bot.blockAt(pos(p))));
  const toFill = terrain.fill.filter(p => !matchesBuildBlock(bot.blockAt(pos(p)), p));
  for (const p of [...toClear, ...toFill]) if (!canClearSchematicBlock(blueprint, goal.buildOwned, bot.blockAt(pos(p))))
    throw new Blocked(`The building site changed at ${pos(p)}; preserving the unexpected block`);
  if (!toClear.length && !toFill.length) {
    terrain.prepared = true; terrain.preparedAt = new Date().toISOString(); save(); return;
  }
  if (!terrain.announced) {
    bot.chat(terrain.kind === 'shore_foundation' ? "I'll fill in a firm base by the water, then build on top." : "I'll level the ground here, then start building.");
    terrain.announced = true; save();
  }
  const tops = new Map(), bottoms = new Map();
  for (const p of toClear) { const k = `${p.x},${p.z}`; if (!tops.has(k) || tops.get(k).y < p.y) tops.set(k, p); }
  for (const p of toFill) { const k = `${p.x},${p.z}`; if (!bottoms.has(k) || bottoms.get(k).y > p.y) bottoms.set(k, p); }
  // Interleave reachable filling with top-down cuts. Removing every high cell
  // first stranded the worker below the remaining land with no usable access.
  // Finish each whole foundation layer before raising any column: a completed
  // tall column can otherwise seal access to a neighboring deep trench.
  const fillLayer = Math.min(...toFill.map(p => p.y));
  const filling = [...bottoms.values()].filter(p => p.y === fillLayer && countOf(bot, p.material) &&
    faces.some(f => bot.blockAt(pos(p).plus(f))?.boundingBox === 'block'))
    .map(p => ({ position: p, material: p.material, properties: p.properties, operation: air(bot.blockAt(pos(p))) || bot.blockAt(pos(p)).name === 'water' ? 'place' : 'dig' }));
  const cutting = [...tops.values()].map(p => ({ position: p, operation: 'dig' }));
  const work = await chooseConstructionWork(bot, task, goal, [...filling, ...cutting]);
  if (!work) {
    const fill = toFill.find(p => !countOf(bot, p.material));
    if (fill) { await acquireStep(bot, task, fill.material, Math.min(bot.game.gameMode === 'creative' ? 1 : 64, toFill.filter(p => p.material === fill.material).length), goal, save); return; }
    if (countOf(bot, 'dirt') < 32) { await acquireStep(bot, task, 'dirt', 32, goal, save); return; }
    throw new Blocked('I need a safe way to reach the next part of the ground; our building plan is saved');
  }
  goal.step = { action: 'prepare_build_site', operation: work.operation === 'dig' ? 'level' : 'fill', position: { ...work.position }, remaining: toClear.length + toFill.length }; save();
  await executeConstructionWork(bot, task, goal, save, work);
}

async function obtainStep(bot, task, goal, save, client, onStep) {
  if (goal.smelting) { await smelt(bot, task, goal.smelting, goal, save); return false; }
  if ((goal.delivered || 0) >= goal.count) return true;
  const remaining = (goal.deliver ? Math.min(goal.count, goal.deliveryTarget ?? goal.count) : goal.count) - (goal.delivered || 0);
  if (goal.pendingDelivery || countOf(bot, goal.item) >= remaining) {
    if (!goal.deliver) return true;
    goal.step = { action: 'deliver', item: goal.item, count: remaining, recipient: goal.from }; save();
    return deliver(bot, task, goal, save);
  }
  const stock = await withUsableWorkstations(bot, task, planningInventory(bot), [goal.item]);
  const plan = catalogPlan(bot, goal.item, remaining, stock, goal);
  return executePlannedAcquisition(bot, task, goal, save, client, onStep, plan, { item: goal.item, count: remaining });
}

async function prepareBundleStep(bot, task, goal, save, client, onStep) {
  const work = goal.batchWork ||= { kind: 'obtain' };
  Object.assign(work, { request: goal.request, from: goal.from, requesterPosition: goal.requesterPosition,
    resourceMemory: goal.resourceMemory ||= {}, opportunistic: goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} } });
  if (work.smelting) { await smelt(bot, task, work.smelting, work, save); return false; }
  const stock = await withUsableWorkstations(bot, task, planningInventory(bot), remainingOutputs(goal).map(o => o.item));
  const batch = selectBundleBatch(bot.registry, goal, stock, outputs => catalogPlan(bot, outputs, undefined, stock, work));
  const outputs = batchOutputs(goal, batch);
  const plan = catalogPlan(bot, outputs, undefined, stock, work);
  goal.batch = { outputs, phase: plan.length ? ['mine', 'hunt_mob'].includes(plan[0].action) ? 'gather' : 'make' : 'deliver',
    materials: plan.filter(step => ['mine', 'hunt_mob'].includes(step.action)).map(step => ({ item: step.drops || step.item, count: step.count })),
    remainingSteps: plan.length };
  work.holdWorkstation = plan[0]?.action === 'craft' && plan[1]?.action === 'craft';
  if (!plan.length) { save(); return true; }
  goal.activeTask = null;
  work.item = plan[0].item || plan[0].drops;
  const checkpoint = () => {
    goal.step = { action: 'combined_request', phase: goal.batch.phase, outputs, detail: work.step };
    save();
  };
  await executePlannedAcquisition(bot, task, work, checkpoint, client, onStep, plan, { outputs });
  return false;
}

async function executePlannedAcquisition(bot, task, goal, save, client, onStep, plan, acquisition) {
  const first = plan[0];
  if (first?.action === 'mine') {
    const loose = Object.values(bot.entities || {}).filter(entity => entity.isValid !== false &&
      entity.getDroppedItem?.()?.name === first.drops && entity.position.distanceTo(bot.entity.position) <= 16 && safeFromHostiles(bot, entity.position))
      .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (loose) {
      const before = countOf(bot, first.drops), p = loose.position.floored();
      goal.step = { action: 'collect', item: first.drops, position: { ...p } }; save();
      await navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 10000, stallMs: 4000 });
      await waitFor(task, () => countOf(bot, first.drops) > before, 2500);
      return false;
    }
  }
  // Catalog routing replaced the old named concrete workflow. Preserve its
  // tool/wood/table preparation for any request whose recipe needs a descent,
  // while leaving nearby surface pickups and Creative inventory immediate.
  if (!goal.expeditionReady && bot.game.gameMode !== 'creative') {
    const underground = plan.find(s => s.action === 'mine' && Number.isFinite(s.depth) && s.depth < bot.entity.position.y - 8);
    const withinReach = underground && (await miningCandidates(bot, task, underground, goal)).some(p => bot.canDigBlock(bot.blockAt(p)));
    if (goal.preparingExpedition || (underground && !withinReach)) {
      goal.preparingExpedition = true; save();
      await prepareExpeditionStep(bot, task, goal, save);
      return false;
    }
  }
  const step = plan[0];
  if (!step) return false;
  const actions = {};
  if (step.action === 'mine') {
    for (const p of (await miningCandidates(bot, task, step, goal)).slice(0, 12)) {
      if (Object.keys(actions).length >= 4) break;
      if (p.equals(supportCell(bot.entity.position))) continue;
      if (!bot.canDigBlock(bot.blockAt(p)) && bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalGetToBlock(p.x, p.y, p.z), 200).status !== 'success') continue;
      const block = bot.blockAt(p).name;
      actions[`gather_${p.x}_${p.y}_${p.z}`] = { description: { block, position: { ...p },
        distance: Math.round(p.distanceTo(bot.entity.position)), resource: step.drops, requiredTool: step.tool },
      valid: () => bot.blockAt(p)?.name === block,
      run: async () => { goal.step = step; save(); await mine(bot, task, step, goal, save, p); } };
    }
  }
  if (!Object.keys(actions).length) actions[step.action === 'mine' ? 'find_resource' : 'execute_recipe'] = {
    description: { action: step.action, dependency: step, rationale: 'Required by the shared recipe graph for the retained player request' },
    run: () => executeAcquisition(bot, task, step, goal, save),
  };
  if (!client) { await Object.values(actions)[0].run(); return false; }
  await decideAction(bot, task, goal, save, client, onStep, {
    obtain_item: { description: 'Gather shared materials and make the requested outputs, preparing necessary tools first.', children: {
      [step.action]: { description: `Resolve the next ${step.action} dependency for ${step.item || step.drops}.`, children: actions },
    } },
  }, { acquisition: { ...acquisition, dependencies: plan.map(s => ({ action: s.action, item: s.item || s.drops, count: s.count, tool: s.tool })) } });
  return false;
}

async function movementStep(bot, task, goal, save) {
  let target = bot.players[goal.target || goal.from]?.entity;
  if (!target && goal.requesterPosition) {
    const p = goal.requesterPosition;
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3));
    target = bot.players[goal.target || goal.from]?.entity;
  }
  if (!target) throw new Blocked(`Cannot see ${goal.target || goal.from}. Come within view so I can find a route.`);
  goal.requesterPosition = { ...target.position };
  goal.step = { action: goal.kind, target: goal.target || goal.from, position: { ...target.position } }; save();
  const distance = bot.entity.position.distanceTo(target.position);
  if (distance <= 3) {
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    if (goal.kind === 'come') return true;
    for (let i = 0; i < 5; i++) { task.check(); await sleep(100); }
    return false;
  }
  const before = bot.entity.position.clone();
  if (await boatTravelStep(bot, task, goal, save, target.position, { acquireStep })) return false;
  try { await navigate(bot, task, new goals.GoalFollow(target, 2), { timeoutMs: goal.kind === 'follow' ? 5000 : 60000, stallMs: 5000 }); }
  catch (err) {
    task.check(); if (err.name === 'NeedsAir' || bot.entity.position.distanceTo(before) < 1) throw err;
  }
  return goal.kind === 'come' && target.position.distanceTo(bot.entity.position) <= 3;
}

async function preparePortalSupports(bot, task, goal, save, needed) {
  const carried = portalSupports(bot);
  if (carried.count >= needed) return true;
  const material = carried.material || 'cobblestone';
  await acquireStep(bot, task, material, countOf(bot, material) + needed - carried.count, goal, save);
  return false;
}

async function netherStep(bot, task, goal, save) {
  if (String(bot.game.dimension).includes('nether')) return true;
  const portal = find(bot, ['nether_portal'], 64, 1)[0];
  if (portal) {
    goal.portal = { ...portal }; save();
    await navigate(bot, task, new goals.GoalBlock(portal.x, portal.y, portal.z));
    await waitFor(task, () => String(bot.game.dimension).includes('nether'), 12000);
    return true;
  }
  // A frame with no placed blocks can be relocated when its original ground
  // was excavated. Once construction begins its coordinates stay fixed.
  if (goal.portalFrame && goal.portalFrame.blocks.every(p => bot.blockAt(pos(p)) && bot.blockAt(pos(p)).name !== 'obsidian') &&
      !(goal.portalFrame.supports || []).some(p => bot.blockAt(pos(p))?.name === p.material) &&
      !portalSiteClear(bot, goal.portalFrame.origin)) { delete goal.portalFrame; save(); }
  if (!goal.portalFrame) {
    if (!await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
    if (!await acquireStep(bot, task, 'obsidian', 10, goal, save)) return false;
    // Gather scaffolding before choosing the building site, so we never mine
    // its foundations to obtain temporary supports.
    if (!await preparePortalSupports(bot, task, goal, save, 3)) return false;
    const site = selectPortalSite(bot);
    if (!site) {
      if (surfaceObserver(bot)(bot.entity.position)) await explore(bot, task, goal, save, 'portal site', { surfaceOnly: true });
      else await surfaceStep(bot, task, goal, save);
      return false;
    }
    const o = pos(site);
    // Minimal frame: two bottom/top blocks, three on each side, no corners.
    goal.portalFrame = { origin: { ...o }, blocks: [
      ...[1, 2].flatMap(x => [o.offset(x, 0, 0), o.offset(x, 4, 0)]),
      ...[1, 2, 3].flatMap(y => [o.offset(0, y, 0), o.offset(3, y, 0)]),
    ].sort((a, b) => a.y - b.y).map(p => ({ ...p })) };
    save();
  }
  const frame = goal.portalFrame;
  const missing = frame.blocks.filter(p => bot.blockAt(pos(p))?.name !== 'obsidian');
  if (missing.length) {
    if (!await acquireStep(bot, task, 'obsidian', missing.length, goal, save)) return false;
    // The cornerless frame still needs temporary placement anchors. The top
    // beam cannot be placed in midair: build its left corner after the column.
    const o = pos(frame.origin);
    const scaffold = [o.offset(0, 0, 0), o.offset(3, 0, 0), o.offset(0, 4, 0)];
    const neededSupports = scaffold.filter(p => air(bot.blockAt(p))).length;
    if (!await preparePortalSupports(bot, task, goal, save, neededSupports)) return false;
    await navigate(bot, task, new goals.GoalBlock(o.x, o.y, o.z - 1));
    const anchor = async p => {
      const material = portalSupports(bot).material;
      if (!material) throw new Blocked('Portal supports were consumed during travel; need another ordinary stone block');
      frame.supports ||= [];
      frame.supports = frame.supports.filter(s => !pos(s).equals(p));
      frame.supports.push({ ...p, material }); save();
      await place(bot, task, p, material);
    };
    for (const p of scaffold.slice(0, 2)) if (air(bot.blockAt(p))) await anchor(p);
    for (const p of missing) {
      if (p.y === o.y + 4 && air(bot.blockAt(scaffold[2]))) await anchor(scaffold[2]);
      await place(bot, task, pos(p), 'obsidian');
    }
  }
  if (!await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
  const bottom = pos(frame.origin).offset(1, 0, 0);
  await navigate(bot, task, new goals.GoalNear(bottom.x, bottom.y, bottom.z, 2));
  await bot.equip(bot.inventory.items().find(i => i.name === 'flint_and_steel'), 'hand');
  task.check();
  await bot.activateBlock(bot.blockAt(bottom), new Vec3(0, 1, 0));
  await waitFor(task, () => bot.blockAt(bottom.offset(0, 1, 0))?.name === 'nether_portal');
  return false;
}

function createSurvival(bot, options) {
  return new Survival(bot, { acquireStep, dig, place, navigate, explore }, options);
}

async function returnFromNether(bot, task, goal, save) {
  if (dimension(bot) === 'overworld') return;
  const portal = find(bot, ['nether_portal'], 64, 1)[0];
  if (!portal) throw new Blocked('No loaded return portal observed in the Nether; saved progress retained');
  goal.step = { action: 'return_overworld', portal: { ...portal } }; save();
  await navigate(bot, task, new goals.GoalBlock(portal.x, portal.y, portal.z));
  await waitFor(task, () => dimension(bot) === 'overworld', 12000);
}

function protectConstruction(bot, goal) {
  const movements = bot.pathfinder.movements;
  movements.exclusionAreasBreak = (movements.exclusionAreasBreak || []).filter(rule => rule !== bot._constructionProtection);
  bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
  movements.exclusionAreasBreak.push(bot._constructionProtection);
}

function createRecoveryAdviser(bot) {
  return new RecoveryAdviser(bot, { acquireStep, catalogPlan, planningInventory, surfaceStep, navigate });
}

async function tryRecovery(adviser, task, goal, save) {
  try { return await adviser.suggest(task, goal, save); }
  catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) return true;
    throw err;
  }
}

async function runIdle(bot, task, goal, store, { survival, decisionClient, recoveryAdviser, onStep = () => {}, until = () => false } = {}) {
  survival ||= createSurvival(bot, { state: goal.survival, client: decisionClient });
  goal.survival = survival.state;
  const save = () => store.save(goal);
  protectConstruction(bot, goal);
  recoveryAdviser ||= createRecoveryAdviser(bot);
  let failures = 0;
  while (!until()) {
    task.interruptCheck = undefined; task.check(); updateDigCapabilities(bot);
    try {
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task);
        if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
      }
      await survival.step(task, goal, save, onStep);
      failures = 0; delete goal.lastError; save(); onStep(goal);
    } catch (err) {
      task.interruptCheck = undefined; task.check();
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) failures++;
      goal.lastError = err.message; save(); onStep(goal);
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) recoveryAdviser.recordFailure(goal, err);
      if (failures >= 3 && await tryRecovery(recoveryAdviser, task, goal, save)) { failures = 0; continue; }
      if (failures >= 5) throw new Blocked(`Survival needs help: ${err.message}`);
    } finally { task.interruptCheck = undefined; }
    for (let n = 0; n < 10; n++) { task.check(); await sleep(100); }
  }
  return { ok: true, goal };
}

async function runGoal(bot, task, goal, store, { maxSteps = 2000, onStep = () => {}, decisionClient, survival, recoveryAdviser } = {}) {
  const save = () => store.save(goal);
  task.opportunityClient = decisionClient;
  if (goal.boatTravel?.placed?.uuid && goal.boatTravel.placed.dimension === bot.game.dimension) (bot._ownedBoats ||= new Set()).add(goal.boatTravel.placed.uuid);
  survival ||= createSurvival(bot, { state: goal.survival, client: decisionClient });
  goal.survival = survival.state;
  protectConstruction(bot, goal);
  recoveryAdviser ||= createRecoveryAdviser(bot);
  goal.status = 'running'; goal.failures = 0; goal.stalls = 0; save();
  const stopObserving = goal.kind === 'win' ? watchGameProgress(bot, goal, save) : () => {};
  try {
  for (let n = 0; n < (goal.kind === 'follow' ? Infinity : goal.kind === 'build' ? Math.max(maxSteps, 30000) : maxSteps); n++) {
    task.interruptCheck = undefined;
    task.check();
    updateDigCapabilities(bot);
    const before = JSON.stringify(inventory(bot));
    const constructionBefore = constructionObservation(bot, goal);
    const location = bot.entity.position.clone();
    try {
      let complete = false;
      const activeWork = goal.kind === 'bundle' ? goal.batchWork || goal.tasks.find(child => child.status !== 'complete') || goal : goal;
      const saveWork = () => { if (activeWork !== goal) { goal.step = { action: 'combined_request', item: activeWork.item, detail: activeWork.step }; goal.survivalAction = activeWork.survivalAction; } save(); };
      // A requested, equipped encounter can approach its selected mob. All
      // other survival work keeps the ordinary hostile-avoidance policy.
      const endTask = goal.kind === 'win' && dimension(bot) === 'end';
      if (!endTask && await huntObserved(bot, task, activeWork, saveWork, { navigate }, decisionClient)) {
        goal.failures = 0; goal.stalls = 0; delete goal.lastError; save(); onStep(goal); continue;
      }
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task);
        if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
      }
      // End combat owns eating and arena escape. Overworld nighttime shelter
      // choices are invalid in the End, where the dragon can destroy them.
      if (!endTask && await survival.step(task, activeWork, saveWork, () => onStep(goal))) {
        goal.stalls = 0; goal.failures = 0; delete goal.lastError; save(); onStep(goal); continue;
      }
      task.interruptCheck = bot.game.gameMode === 'creative' || endTask ? undefined : () => checkThreats(bot);
      // Immediate air/critical hunger responses stay in code. For house work,
      // Jev chooses ordinary eating interruptions alongside task progress.
      if (!endTask && (!decisionClient || goal.kind !== 'house' || needsAir(bot) || bot.food <= 6 || bot.health <= 6)) {
        await maintainVitals(bot, task, step => { goal.survivalAction = { ...step, at: new Date().toISOString() }; save(); onStep(goal); });
      }
      const needsSupplies = !goal.expeditionReady && (
        (goal.kind === 'concrete' && countOf(bot, 'purple_concrete') + (goal.delivered || 0) < goal.count && !goal.pendingDelivery) ||
        (['nether', 'win'].includes(goal.kind) && dimension(bot) === 'overworld' && !find(bot, ['nether_portal'], 64, 1).length && !goal.portalFrame));
      const prepared = !needsSupplies || await prepareExpeditionStep(bot, task, goal, save);
      if (prepared && goal.kind === 'house') complete = decisionClient ? await houseDecisionStep(bot, task, goal, save, decisionClient, onStep) : await buildHouseStep(bot, task, goal, save);
      if (goal.kind === 'build') complete = await designedBuildStep(bot, task, goal, save, decisionClient, onStep);
      if (['obtain', 'craft'].includes(goal.kind)) complete = await obtainStep(bot, task, goal, save, decisionClient, onStep);
      if (goal.kind === 'bundle') complete = await bundleStep(bot, task, goal, save,
        (child, checkpoint) => obtainStep(bot, task, child, checkpoint, decisionClient, () => onStep(goal)),
        { prepare: () => prepareBundleStep(bot, task, goal, save, decisionClient, () => onStep(goal)) });
      if (goal.kind === 'find') complete = await discoverStep(bot, task, goal, save, { navigate, explore,
        boatTravel: target => boatTravelStep(bot, task, goal, save, target, { acquireStep }) });
      if (['come', 'follow'].includes(goal.kind)) complete = await movementStep(bot, task, goal, save);
      if (goal.kind === 'visit') complete = await visitPlace(bot, task, goal, save, { navigate,
        boatTravel: target => boatTravelStep(bot, task, goal, save, target, { acquireStep }) });
      if (prepared && goal.kind === 'concrete') {
        if ((goal.delivered || 0) >= goal.count) complete = true;
        else if (goal.pendingDelivery || await acquireStep(bot, task, 'purple_concrete', goal.count - (goal.delivered || 0), goal, save)) {
          goal.step = { action: 'deliver', count: goal.count - (goal.delivered || 0), recipient: goal.from }; save();
          complete = await deliver(bot, task, goal, save);
        }
      }
      if (prepared && goal.kind === 'nether') complete = await netherStep(bot, task, goal, save);
      if (prepared && goal.kind === 'win') complete = await gameStep(bot, task, goal, save, {
        acquireStep, enter_nether: netherStep, return_overworld: returnFromNether,
        enter_end: (bot, task, goal, save) => enterEnd(bot, task, goal, save, { navigate }),
        fight_dragon: (bot, task, goal, save) => fightEndStep(bot, task, goal, save, { navigate }, decisionClient),
        exit_end: (bot, task, goal, save) => exitEnd(bot, task, goal, save, { navigate }),
        prepare_combat: (bot, task, goal, save) => prepareCombatGear(bot, task, goal, save, { acquireStep }),
        prepare_end: (bot, task, goal, save) => prepareEndSupplies(bot, task, goal, save, { acquireStep }),
        find_stronghold: (bot, task, goal, save) => findStronghold(bot, task, goal, save, {
          navigate, explore, surfaceStep,
          tunnel: async (bot, task, goal, save, target, resource) => {
            if (pickaxeTier(bot) < 1) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return; }
            await resourceTunnelStep(bot, task, goal, save, target, resource, { dig, navigate });
          },
        }, decisionClient),
      });
      task.check();
      goal.failures = 0;
      delete goal.lastError;
      goal.history ||= [];
      goal.history.push({ time: new Date().toISOString(), step: goal.step, inventory: inventory(bot), position: { ...bot.entity.position }, dimension: bot.game.dimension });
      goal.history = goal.history.slice(-40);
      if (complete) {
        if (goal.kind === 'house') survival.rememberHouse(goal.blueprint);
        goal.status = 'complete'; goal.completedAt = new Date().toISOString(); save();
        bot.chat(completion(goal));
        return { ok: true, goal };
      }
      const unchanged = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 1 &&
        constructionBefore === constructionObservation(bot, goal);
      goal.stalls = unchanged && goal.kind !== 'follow' ? (goal.stalls || 0) + 1 : 0;
      if (goal.stalls > 30) throw new Blocked(`No measurable progress on ${JSON.stringify(goal.step)}`);
    } catch (err) {
      task.interruptCheck = undefined;
      task.check();
      goal.lastError = err.message;
      if (err.name === 'DesignRepair') { save(); onStep(goal); continue; }
      if (err.name === 'NeedsAir' || err.name === 'NeedsSafety') { save(); onStep(goal); continue; }
      // A partial craft/build can change inventory before its promise fails.
      // Replan that observed progress; only consecutive no-progress errors
      // exhaust retries.
      goal.failures = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 2 &&
        constructionBefore === constructionObservation(bot, goal) ? goal.failures + 1 : 0;
      recoveryAdviser.recordFailure(goal, err);
      if ((err.name === 'Blocked' || goal.failures >= 3) && await tryRecovery(recoveryAdviser, task, goal, save)) {
        goal.failures = 0; goal.stalls = 0; save(); onStep(goal); continue;
      }
      if (err.name === 'Blocked' || goal.failures >= 5) {
        goal.status = 'blocked'; save();
        bot.chat(`${friendlyProblem(err)} I saved our progress. Say "Jev resume" to try again.`);
        return { ok: false, reason: err.message, goal };
      }
      await sleep(300);
    } finally { task.interruptCheck = undefined; }
    save(); onStep(goal);
  }
  goal.status = 'blocked'; goal.lastError = 'Action budget reached'; save();
  bot.chat('This is taking a while. I saved our progress. Say "Jev resume" to keep going.');
  return { ok: false, reason: goal.lastError, goal };
  } finally { stopObserving(); }
}

// Placement in Creative consumes no inventory. Observe the actual construction
// blocks, including cleared obstructions, when deciding whether work progressed.
function constructionObservation(bot, goal) {
  const positions = [...(goal.blueprint?.blocks || []), ...(goal.blueprint?.empty || []), ...(goal.portalFrame?.blocks || [])];
  return JSON.stringify(positions.map(p => [p.x, p.y, p.z, bot.blockAt(pos(p))?.stateId ?? bot.blockAt(pos(p))?.name ?? null]));
}

module.exports = { runGoal, runIdle, createSurvival, acquireStep, inventory, planningInventory, catalogPlan, selectSite, explore, smelt, dig, place, waitFor, constructionObservation, Blocked, designedBuildStep, surfaceStep };
