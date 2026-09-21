'use strict';

const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, equipBestTool, pickaxeTier, pickaxeDurability, countOf, shakeLoose } = require('./skills');
const { MINEABLE, TOOL_TIERS } = require('./plan');
const { houseBlueprint, verifyHouse } = require('./objectives');
const { deliver } = require('./delivery');
const { reservedForConstruction, portalSiteClear, selectPortalSite, portalSupports } = require('./build-sites');
const { updateDigCapabilities } = require('./movement');
const { resourceTunnelStep } = require('./tunneling');
const { maintainVitals, checkAir, needsAir, chooseFood, digWithAirGuard } = require('./vitals');
const { decideTree, announceFallback, firstOption } = require('./decisions');
const { Survival } = require('./survival');
const { checkThreats, safeFromHostiles, immediateThreat } = require('./danger');
const { resourceSources, nearestRemaining, decisionFingerprint, setAsideSource, rememberSource, committedSource } = require('./decision-options');
const { reviewDesign } = require('./design-review');
const { narrate } = require('./narration');
const { planCatalog, sourceBlocks } = require('./knowledge');
const { takeCreativeItem } = require('./creative');
const { surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete, handDiggableExit } = require('./surface');
const { bootstrapPickaxe } = require('./tool-recovery');
const { foodSupply } = require('./foraging');
const { observeRecipeAlternatives, knownResourceLocations, knownResourceNames, rememberResources, isSurfaceResource } = require('./resource-observation');
const { designBuilding, validateSchematic, selectSchematicSite, canClearSchematicBlock, schematicScaffolding, LIMITS, SECONDS_PER_BLOCK } = require('./designer');
const { designWithJev } = require('./build-templates');
const { dryMiningPositions, foliageMiningCandidate, approachDryMining, miningMovement, reachableLocalMine } = require('./mining-access');
const { dryPassable, supportCell } = require('./terrain');
const { RecoveryAdviser } = require('./recovery-adviser');
const { descendPillar } = require('./pillar-recovery');
const { gameStep, watchGameProgress, dimension, nextGameStage } = require('./game-progress');
const { carriedEquipment } = require('./mob-policy');
const { huntObserved, prepareMobHunt, prepareCombatGear } = require('./mob-hunt');
const { findStronghold } = require('./stronghold');
const { enterEnd } = require('./end-portal');
const { fightEndStep } = require('./end-combat');
const { exitEnd } = require('./end-exit');
const { prepareEndSupplies } = require('./end-supplies');
const { collectWater } = require('./water');
const { makeObsidian } = require('./obsidian');
const { tidyInventory } = require('./inventory-tidy');
const { homeStep, homeChores } = require('./home-base');
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
const { fuelPlanks, CARRIED_FUELS, isFuel, fuelUnits } = require('./fuel');
const { opportunisticMining } = require('./opportunistic-mining');
const { collectNearbyDrops } = require('./drop-collection');
const { friendlyProblem, recoveryHint, completion } = require('./speech');
const { boatTravelStep } = require('./boats');
const { dimension: dimensionName } = require('./game-progress');
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

// The pickaxe that goes down must have enough left to come back up.
const SPARE_PICKAXE_DURABILITY = 24;
const EXPEDITION_LOGS = 8;
const WOOD = /_log$|_planks$|^stick$/;
const woodCarried = bot => bot.inventory.items().filter(i => WOOD.test(i.name)).reduce((n, i) => n + i.count, 0);
const logsCarried = bot => bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
// A pickaxe about to break with no wood in the pockets is a bot sealed in its
// own shaft: the exit needs a tool and the tool needs sticks. The dream run
// went down with three pickaxes at six or seven durability and no wood.
// Wood is the universal spare underground: sticks for the next pickaxe and
// fuel for the next smelt. Going down without any is what wore the iron
// pickaxe to nothing on a climb for gravel and left the bot digging out by
// hand; the durability and fuel checks above only caught it some of the time.
const descentSuppliesLow = bot => woodCarried(bot) < 2;

async function prepareExpeditionStep(bot, task, goal, save) {
  goal.preparingExpedition = true;
  // The reserve is the survival layer's to gather; once its search has been
  // set aside as fruitless, the prep goes on with what is carried rather
  // than waiting on a hunt nobody is making.
  const reservePaused = goal.survival?.foodStockPausedUntil > Date.now();
  if (bot.game.difficulty && bot.game.difficulty !== 'peaceful' && foodSupply(bot) < 12 && !reservePaused) {
    goal.step = { action: 'prepare_expedition_food', carriedFoodPoints: foodSupply(bot), requiredFoodPoints: 12 };
    save(); return false;
  }
  if (pickaxeTier(bot) < 2) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return false; }
  if (pickaxeDurability(bot) < SPARE_PICKAXE_DURABILITY) { await acquireStep(bot, task, 'stone_pickaxe', countOf(bot, 'stone_pickaxe') + 1, goal, save); return false; }
  // Eight logs: sticks for two tools and fuel for a dozen smelts once the
  // coal is gone. Four sent the bot up for one log after every other rung.
  if (logsCarried(bot) < EXPEDITION_LOGS) {
    // The trees that were seen here, not oak by name.
    const species = (bot._catalogObservation?.nearby || []).find(name => /_log$/.test(name)) || 'oak_log';
    await acquireStep(bot, task, species, countOf(bot, species) + EXPEDITION_LOGS - logsCarried(bot), goal, save); return false;
  }
  if (!countOf(bot, 'crafting_table')) { await acquireStep(bot, task, 'crafting_table', 1, goal, save); return false; }
  goal.expeditionReady = true; delete goal.preparingExpedition;
  goal.step = { action: 'prepared_expedition', minimumPickaxeTier: 2, supplies: { logs: EXPEDITION_LOGS, crafting_table: 1 }, pickaxeDurability: pickaxeDurability(bot), foodPoints: foodSupply(bot) };
  save(); return true;
}

async function waitFor(task, predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate()) return; await sleep(100); }
  throw new Error('Timed out waiting for world/inventory update');
}

// Digging the block underfoot is a one-block drop when the block beneath it
// is solid and harmless: the way a player takes an ore they are standing on
// in a shaft with no side to step to. Anything deeper or molten is not.
function safeDropBelow(bot, p) {
  const under = bot.blockAt(p.offset(0, -1, 0));
  return under?.boundingBox === 'block' && !['lava', 'magma_block', 'cactus', 'fire'].includes(under.name) &&
    !['sand', 'gravel'].includes(under.name);
}

async function stepOff(bot, task, p) {
  const feet = bot.entity.position.floored();
  if (feet.x !== p.x || feet.z !== p.z || Math.abs(feet.y - p.y) > 1) return;
  if (p.y === feet.y - 1 && safeDropBelow(bot, p)) return;
  // Stepping aside needs somewhere to stand, unless the bot is flying: high on
  // a tower every neighbouring cell is open air, which is a floor for a
  // hovering worker and a dead end for a walking one.
  const flying = require('./flight').canFly(bot);
  const exits = faces.slice(1, 5).flatMap(d => [0, 1, -1].map(dy => feet.plus(d).offset(0, dy, 0)));
  const exit = exits.find(q => air(bot.blockAt(q)) && air(bot.blockAt(q.offset(0, 1, 0))) &&
    (flying || bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block'));
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
  if (p.equals(supportCell(bot.entity.position)) && !safeDropBelow(bot, p)) throw new Error('Refusing to dig directly beneath feet');
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

// The bot's own body, 0.6 wide, can lean into the cell it wants to fill:
// standing at x=-506.81 it overlaps the cell at x=-508 by eleven
// centimetres, and the server refuses the block every time. Back out of
// the cell along the line away from it before placing.
function hitboxIntrudes(bot, p, margin = 0.02) {
  const b = bot.entity.position, half = 0.3, height = 1.8;
  return b.x + half > p.x + margin && b.x - half < p.x + 1 - margin &&
    b.z + half > p.z + margin && b.z - half < p.z + 1 - margin &&
    b.y + height > p.y + margin && b.y < p.y + 1 - margin;
}

async function nudgeClear(bot, task, p) {
  if (!hitboxIntrudes(bot, p) || typeof bot.setControlState !== 'function') return;
  // Face the cell and step backward until the body is clear of it.
  await bot.lookAt(p.offset(0.5, 1, 0.5), true);
  bot.setControlState('back', true);
  try {
    const deadline = Date.now() + 700;
    while (Date.now() < deadline && hitboxIntrudes(bot, p)) { task.check(); await sleep(50); }
  } finally { bot.setControlState('back', false); }
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
  await nudgeClear(bot, task, p);
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
    if (!destination && await descendCanopy(bot, task, goal, save)) return;
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
    useExtraInfo: b => (!step.properties || Object.entries(step.properties).every(([key, value]) => String(b.getProperties()[key]) === String(value))) &&
      (step.minimumY === undefined || b.position.y >= step.minimumY) && !reservedForConstruction(goal, b.position) &&
      (step.drops !== 'dirt' || (b.position.y >= bot.entity.position.floored().y - 1 && air(bot.blockAt(b.position.offset(0, 1, 0))))) &&
      // Opening a block with lava against it lets the lava in: the drop
      // burns and the bot walks into the cell to collect it. Diamonds beside
      // a lava lake are left for a pour of water first, not dug into.
      !faces.some(f => bot.blockAt(b.position.plus(f))?.name === 'lava') &&
      (foliageMiningCandidate(bot, b.position) || faces.some(f => {
        const neighbor = bot.blockAt(b.position.plus(f));
        return air(neighbor) || neighbor?.name === 'water';
      }) && dryMiningPositions(bot, b.position, 1).length > 0),
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

// Work the nearest block of a source Jev chose. A source that cannot be
// reached is set aside whole, so the next step looks at a different tree.
async function workSource(bot, task, step, goal, save, source) {
  const p = nearestRemaining(bot, source);
  if (!p) throw new Error(`The ${source.block} source is no longer there`);
  goal.step = step; rememberSource(goal, source, step); save();
  try {
    await mine(bot, task, step, goal, save, p);
    // Finish the tree. The planner asks for exactly the logs a step needs,
    // often one, and the dream run walked to a fresh tree for every smelt's
    // fuel. The rest of a trunk already reached is a few seconds' work.
    if (/_log$/.test(source.block) && bot.game?.gameMode !== 'creative') {
      for (let extra = 0; extra < 3 && countOf(bot, step.drops) < 8; extra++) {
        const next = nearestRemaining(bot, source);
        if (!next || next.distanceTo(bot.entity.position) > 6) break;
        task.check(); checkAir(bot);
        try { await mine(bot, task, step, goal, save, next); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; break; }
      }
    }
  }
  catch (err) {
    if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) { setAsideSource(goal, source); delete goal.workingSource; save(); }
    throw err;
  }
}

// Keep working the source Jev already chose. Recorded as a decision so the
// trail and the Observatory show the step, marked as needing no question.
async function continueSource(bot, task, step, goal, save, onStep) {
  const source = committedSource(bot, goal, step);
  if (!source) return false;
  goal.decisions ||= [];
  goal.decisions.push({ at: new Date().toISOString(), path: ['continue_source', source.key], latencyMs: 0, committed: true, judgments: [],
    options: { continue_source: { description: `Keep working the ${source.block} source chosen earlier; ${source.blocks.length} blocks remain within reach.`, children: { [source.key]: { description: source.description || { block: source.block } } } } } });
  goal.decisions = goal.decisions.slice(-40);
  save(); onStep?.(goal);
  await workSource(bot, task, step, goal, save, source);
  return true;
}

// When the same resource keeps failing where the bot stands, the answer is
// somewhere else. Everything of that block within sixteen blocks is set
// aside and the ordinary exploration walks toward the next known or unknown
// source. A rule rather than a judgment: there is no request that is better
// served by a sixth attempt at the same tree.
async function moveOnFromResource(bot, task, goal, save) {
  const step = goal.step;
  if (step?.action !== 'mine' || !step.block) return false;
  const nearby = find(bot, step.sources || [step.block], 16, 64);
  goal.unreachable ||= {};
  for (const p of nearby) goal.unreachable[`${p}`] = Date.now();
  goal.step = { action: 'move_on', resource: step.drops || step.block, setAside: nearby.length }; save();
  bot.chat?.(`I can't get at the ${String(step.block).replaceAll('_', ' ')} here. I'll look somewhere else.`);
  await explore(bot, task, goal, save, step.block);
  return true;
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
  // An exit is dug for the way out, not for the drops: a worn pickaxe is
  // used until it breaks and bare hands finish the climb. Slow beats sealed
  // in, and sealed in is where the dream run sat with three pickaxes at six
  // durability and no wood for a fourth.
  const exitDig = (b, t, p, options = {}) => dig(b, t, p, { ...options, requireDrops: false });
  await returnToSurface(bot, task, goal, save, { dig: exitDig, navigate, prepareTool: async () => {
    if (pickaxeTier(bot) >= 1) return true;
    // Gravel, dirt and sand overhead come away by hand; no tool to bootstrap.
    if (handDiggableExit(bot)) return true;
    if (await bootstrapPickaxe(bot, task, goal, save, { mine: mineAtSource })) return false;
    const plan = catalogPlan(bot, 'stone_pickaxe', 1, planningInventory(bot), goal);
    const step = plan[0];
    // Craft from carried wood/stone. When the missing ingredient is wood, which
    // only the surface has, climb with what is in hand rather than wait here.
    if (!step || (step.action === 'mine' && isSurfaceResource(step.block))) {
      if (!goal.surfaceReturn?.byHand) { goal.surfaceReturn ||= {}; goal.surfaceReturn.byHand = true; save(); bot.chat?.("No pickaxe worth the name and no wood for one, so I'm digging out by hand."); }
      return true;
    }
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
      await approachDryMining(bot, task, p, { navigate, dig });
      access = miningMovement(bot);
      await dig(bot, task, p, { done: () => countOf(bot, step.drops) > before, requiredTool: step.tool, enchantment: step.enchantment,
        minimumToolDurability: step.minimumToolDurability });
      access.restore(); access = undefined;
      if (await collectNearbyDrops(bot, task, step.drops, { before, origin: p, radius: 8, waitForSpawnMs: 1000, allowExcavation: true })) return;
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

// Which workstations this bot placed, so it can take them along later. Kept
// on the goal as well as in memory: a restart must not turn a furnace the
// bot placed a minute ago into somebody else's furnace.
function rememberWorkstation(bot, goal, name, p) {
  const key = `${name}:${p}`;
  (bot._ownedWorkstations ||= new Set()).add(key);
  if (goal) { goal.placedWorkstations = [...new Set([...(goal.placedWorkstations || []), key])].slice(-16); }
}
function forgetWorkstation(bot, goal, key) {
  bot._ownedWorkstations?.delete(key);
  if (goal?.placedWorkstations) goal.placedWorkstations = goal.placedWorkstations.filter(k => k !== key);
}
function recallWorkstations(bot, goal) {
  for (const key of goal?.placedWorkstations || []) (bot._ownedWorkstations ||= new Set()).add(key);
}

async function workstation(bot, task, name, goal) {
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
      rememberWorkstation(bot, goal, name, q);
    }
  }
  if (!p) throw new Error(`No place for ${name}`);
  const placed = await approachWorkstation(bot, task, name, [p]);
  if (!placed) throw new Blocked(`I can't reach the ${name.replaceAll('_', ' ')} I placed`);
  return placed;
}

async function craft(bot, task, step, goal) {
  // Diagnostic for the dream run: a seventh furnace was crafted with six in
  // the pockets, and no planner path reproduces it offline.
  if (['furnace', 'crafting_table'].includes(step.item) && countOf(bot, step.item) >= 2) console.error(`[diag] crafting ${step.item} with ${countOf(bot, step.item)} carried\n${new Error().stack}`);
  await settleCraftInventory(bot, task);
  const table = step.needs_table ? await workstation(bot, task, 'crafting_table', goal) : null;
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
    forgetWorkstation(bot, goal, `crafting_table:${table.position}`);
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
  const plannedFuel = pending?.fuelItem || step.fuelItem || 'oak_planks';
  if (!isFuel(plannedFuel)) throw new Blocked(`I can't use ${plannedFuel.replaceAll('_', ' ')} as furnace fuel`);
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
  } else block = await workstation(bot, task, 'furnace', goal);
  const before = countOf(bot, step.item);
  const needed = Math.min(pending ? pending.targetInventory - before : step.count, 64);
  if (goal && !pending) {
    goal.smelting = { item: step.item, from: step.from, fuelItem: plannedFuel, position: { ...block.position }, targetInventory: before + needed, count: needed };
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
        // The planned fuel first, then anything burnable in the pockets: a
        // batch saved before coal was found should not wait on planks.
        const items = Math.min(input.count, needed - taken);
        const fuelItem = [plannedFuel, ...CARRIED_FUELS, ...fuelPlanks].find(name => carried(name) > 0) || plannedFuel;
        const wanted = fuelUnits(fuelItem, items);
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
  // A furnace the bot placed goes with it when it is travelling, like a
  // crafting table does. Leaving one behind at every camp cost the dream run
  // a cobblestone trip for each meal it cooked.
  if (block && !goal?.holdWorkstation && (goal?.expeditionReady || goal?.preparingExpedition || goal?.dream) && bot._ownedWorkstations?.has(`furnace:${block.position}`)) {
    const count = countOf(bot, 'furnace');
    await dig(bot, task, block.position);
    await navigate(bot, task, new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
    await waitFor(task, () => countOf(bot, 'furnace') > count);
    forgetWorkstation(bot, goal, `furnace:${block.position}`);
  }
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
  // A Creative step is sized as the shortfall against `stock`, which has had
  // any delivery reservation taken out of it, so the step count is what to
  // take on top of what is carried.
  if (bot.game?.gameMode === 'creative') return outputs.filter(output => (stock[output.item] || 0) < output.count)
    .map(({ item, count }) => ({ action: 'creative_inventory', item, count: count - (stock[item] || 0), consumes: {}, produces: { [item]: count - (stock[item] || 0) } }));
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

// Several outputs planned as one: the batch planner merges their smelts
// and shares one fuel allowance, so a set of armour is one dig, one
// furnace batch and four crafts rather than four of everything.
async function acquireSetStep(bot, task, items, goal, save) {
  task.check(); checkAir(bot);
  if (goal.smelting) { await smelt(bot, task, goal.smelting, goal, save); return false; }
  const inv = planningInventory(bot);
  const outputs = items.map(item => ({ item, count: 1 })).filter(o => (inv[o.item] || 0) < o.count);
  if (!outputs.length) return true;
  const available = await withUsableWorkstations(bot, task, inv, outputs.map(o => o.item));
  const plan = catalogPlan(bot, outputs, undefined, available, goal);
  if (await prepareMiningTool(bot, task, goal, save, plan, available)) return false;
  if (await ensureDescentSupplies(bot, task, goal, save, plan)) return false;
  const step = plan[0];
  if (!step) throw new Error(`No progress step for ${outputs.map(o => o.item).join(', ')}`);
  await executeAcquisition(bot, task, step, goal, save);
  return false;
}

async function acquireStep(bot, task, item, count, goal, save, { minimumMiningY, reserved = {} } = {}) {
  task.check(); checkAir(bot);
  if (goal.smelting) { await smelt(bot, task, goal.smelting, goal, save); return false; }
  const inv = planningInventory(bot);
  for (const [name, amount] of Object.entries(reserved)) inv[name] = Math.max(0, (inv[name] || 0) - amount);
  if ((inv[item] || 0) >= count) return true;
  const available = await withUsableWorkstations(bot, task, inv, [item]);
  const plan = catalogPlan(bot, item, count, available, goal);
  if (await prepareMiningTool(bot, task, goal, save, plan, available, { requestedTool: item.endsWith('_pickaxe'), minimumMiningY })) return false;
  if (await ensureDescentSupplies(bot, task, goal, save, plan)) return false;
  const step = plan[0];
  if (!step) throw new Error(`No progress step for ${item}`);
  if (minimumMiningY !== undefined && step.action === 'mine') step.minimumY = minimumMiningY;
  await executeAcquisition(bot, task, step, goal, save);
  return false;
}

// Every descent passes through here, the dream's rungs included; the
// supply check in the plain request path never saw them, and the bot went
// down for diamonds with no wood, no coal and no food twice.
async function ensureDescentSupplies(bot, task, goal, save, plan) {
  if (bot.game?.gameMode === 'creative' || goal.expeditionPrepActive) return false;
  if (!(goal.preparingExpedition || descentSuppliesLow(bot))) return false;
  if (!plan.some(s => s.action === 'mine' && Number.isFinite(s.depth) && s.depth < bot.entity.position.y - 8)) return false;
  goal.preparingExpedition = true; delete goal.expeditionReady; goal.expeditionPrepActive = true; save();
  try { await prepareExpeditionStep(bot, task, goal, save); }
  finally { delete goal.expeditionPrepActive; }
  return true;
}

async function prepareMiningTool(bot, task, goal, save, plan, available, { requestedTool = false, minimumMiningY } = {}) {
  if (bot.game?.gameMode === 'creative' || pickaxeTier(bot) >= 1 ||
      !requestedTool && !plan.some(step => step.action === 'mine' && step.tool?.endsWith('_pickaxe'))) return false;
  return bootstrapPickaxe(bot, task, goal, save, { mine: mineAtSource, craft, available, minimumMiningY });
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
  else if (step.action === 'make_obsidian') await makeObsidian(bot, task, step, goal, save, { navigate, dig, approachDryMining, collectNearbyDrops, resourceTunnelStep, acquireStep });
  else if (step.action === 'hunt_mob') await prepareMobHunt(bot, task, step, goal, save, { acquireStep, explore, enterNether: netherStep });
  else throw new Error(`Unknown action ${step.action}`);
}

// A standing tree within a block of the footprint is a tree the bot will
// want to fell for planks while its site reservation excludes every
// approach to it. The first fresh trial ended exactly there. Level ground
// with no tree beside it is preferred; a treeless site is not required.
function treeBesideFootprint(bot, blueprint) {
  const { min, max } = blueprint.bounds;
  for (let x = min.x - 1; x <= max.x + 1; x++) for (let z = min.z - 1; z <= max.z + 1; z++) for (let y = min.y; y <= max.y + 2; y++) {
    if (/_log$/.test(bot.blockAt(new Vec3(x, y, z))?.name || '')) return true;
  }
  return false;
}

function selectSite(bot, material, { avoidTrees = true } = {}) {
  const site = findSite(bot, material, avoidTrees);
  return site || (avoidTrees ? findSite(bot, material, false) : null);
}

function findSite(bot, material, avoidTrees) {
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
      if (clear && !(avoidTrees && treeBesideFootprint(bot, blueprint))) return blueprint;
    }
  }
  return null;
}

async function buildHouseStep(bot, task, goal, save) {
  if (!goal.blueprint) {
    goal.blueprint = selectSite(bot, goal.material);
    if (goal.blueprint) bot.buildRegistry?.remember(goal, { dimension: dimensionName(bot) });
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
    playerUrgency: goal.urgency?.level,
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
    if (step?.action === 'mine' && await continueSource(bot, task, step, goal, save, onStep)) return false;
    if (step?.action === 'mine') {
      const reachable = [];
      for (const p of (await miningCandidates(bot, task, step, goal)).slice(0, 16)) {
        // Do not ask Jev to choose unsupported targets such as the trunk it
        // stands on or floating remnants with no currently feasible approach.
        if (p.equals(supportCell(bot.entity.position))) continue;
        if (!bot.canDigBlock(bot.blockAt(p))) {
          const route = bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalGetToBlock(p.x, p.y, p.z), 300);
          if (route.status !== 'success') continue;
        }
        reachable.push(p);
      }
      for (const source of resourceSources(bot, reachable, { failures: goal.decisionFailures, unreachable: goal.unreachable })) {
        actions[source.key] = leaf({ action: 'approach, dig and collect', ...source.description, resourceNeeded: step.drops },
          () => workSource(bot, task, step, goal, save, source), () => !!nearestRemaining(bot, source));
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
      const lowest = missing.filter(p => p.y === layer);
      const fresh = lowest.filter(p => !(goal.decisionFailures?.[`${air(bot.blockAt(pos(p))) ? 'place' : 'clear'}_${p.x}_${p.y}_${p.z}`]?.at > Date.now() - 120000));
      // Recent failures are a preference, not a veto: when every cell on the
      // layer failed once, they are all offered again rather than nothing.
      for (const p of (fresh.length ? fresh : lowest).slice(0, 4)) {
        const q = pos(p);
        const block = bot.blockAt(q);
        const empty = air(block);
        if ((!empty && !block?.diggable) || (empty && !faces.some(f => bot.blockAt(q.plus(f))?.boundingBox === 'block'))) continue;
        const key = `${empty ? 'place' : 'clear'}_${p.x}_${p.y}_${p.z}`;
        actions[key] = leaf(`${empty ? `Place ${p.material}` : `Clear ${block.name} for construction`} at ${q}; build the lowest unfinished layer first.`, async () => {
          goal.step = { action: empty ? 'place' : 'clear', position: { ...q }, material: p.material }; save();
          if (empty) await place(bot, task, q, p.material); else await dig(bot, task, q);
        }, () => bot.blockAt(q)?.name === block.name);
      }
      if (Object.keys(actions).length) subtasks.build = { description: 'Use carried materials to construct the foundation, walls, then roof.', children: actions };
    }
  }
  if (!Object.keys(subtasks).length) throw new Blocked('No feasible house action remains; inspect the saved construction failures');
  // Eating carried food when hungry is a rule, handled before this step ever
  // runs, not a choice offered here. Offering it made Jev weigh a two-second
  // meal against building at food 8, and it chose building often enough to
  // fail the decision eval. Jev decides what to build with and where to get
  // it; code decides when to eat.
  const tree = { build_house: { description: 'Continue the retained player request to build a house.', children: subtasks } };
  await decideAction(bot, task, goal, save, client, onStep, tree);
  return !!goal.blueprint && verifyHouse(bot, goal.blueprint).ok;
}

async function decideAction(bot, task, goal, save, client, onStep, tree, context = {}) {
  const observation = decisionObservation(bot, goal);
  const state = { ...observation, ...context };
  const fingerprint = () => decisionFingerprint(bot, { inventory: planningInventory, immediateThreat, needsAir });
  const initial = fingerprint();
  const controller = new AbortController();
  const watcher = setInterval(() => {
    try { task.check(); checkAir(bot); }
    catch (err) { controller.abort(err); }
  }, 100);
  let decision;
  try {
    decision = await decideTree(client, { state, tree, signal: controller.signal, isFresh: () => fingerprint() === initial, fallback: firstOption, kind: 'source' });
  } finally { clearInterval(watcher); }
  task.check(); checkAir(bot);
  announceFallback(bot, goal, decision);
  const record = { at: new Date().toISOString(), path: decision.path, latencyMs: decision.latencyMs,
    state, options: JSON.parse(JSON.stringify(tree)), usage: decision.usage, judgments: decision.judgments, asked: decision.asked,
    model: client.model, stale: decision.stale || (decision.action?.valid ? !decision.action.valid() : false), fallback: decision.fallback };
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

// How long a blueprint will take to place, for the builds big enough that a
// player deserves to hear it before Jev starts rather than an hour in.
function buildEffort(blueprint) {
  const blocks = (blueprint?.blocks || []).filter(cell => !cell.companion).length;
  if (blocks <= LIMITS.blocks / 4) return null;
  const minutes = Math.round(blocks * SECONDS_PER_BLOCK / 60);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const spoken = hours ? `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` and ${rest} minutes` : ''}` : `${minutes} minutes`;
  return { blocks, minutes, spoken };
}

async function executeDesignedBuildStep(bot, task, goal, save, client, onStep = () => {}) {
  if (goal.continueBuild && !goal.blueprint) {
    const entry = bot.buildRegistry?.find(goal.continueBuild.id);
    if (!entry?.blueprint) throw new Blocked('I cannot find that building in my notes any more. Ask me to build it again.');
    goal.buildId = entry.id;
    goal.design = entry.design || goal.design;
    goal.blueprint = structuredClone(entry.blueprint);
    goal.buildOwned = { ...bot.buildRegistry.ownership(bot, entry.bounds, dimensionName(bot), entry.id), ...goal.buildOwned };
    goal.step = { action: goal.continueBuild.mode === 'repair' ? 'repair_building' : 'finish_building', building: entry.name };
    save(); onStep(goal);
    bot.chat(goal.continueBuild.mode === 'repair' ? `I'll check ${entry.name} over and put back anything missing.`
      : `Picking ${entry.name} back up where I left it.`);
    return false;
  }
  if (!goal.design) {
    const mode = process.env.BUILD_DESIGNER || 'auto';
    if (!['auto', 'jev', 'openrouter'].includes(mode)) throw new Blocked('BUILD_DESIGNER must be auto, jev or openrouter');
    const fallback = mode === 'jev' || mode === 'auto' && !process.env.OPENROUTER_API_KEY;
    // Recheck saved geometry after a validator update, before paying for a
    // replacement or silently reducing the user's request to a house template.
    // A draft Jev rejected as not answering the request is valid geometry
    // too, so it must go back to the designer rather than through here.
    if (!fallback && goal.designDraft && goal.designReview?.accepted !== false) {
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
    } else {
      goal.designAttempts = (goal.designAttempts || 0) + 1;
      bot.chat('Let me draw up a plan for that. It takes me a minute.');
    }
    // An extension is designed against the building it joins, not in a vacuum:
    // the designer gets that building's own schematic so the new part can match
    // its materials, line up with its storeys and meet its wall.
    const joining = goal.buildContinuation?.mode === 'edit'
      ? bot.buildRegistry?.find(goal.buildContinuation.target) : null;
    const editing = joining?.design?.source ? { name: joining.name, size: joining.design.source.size,
      palette: joining.design.source.palette, regions: joining.design.source.regions,
      entrance: joining.design.source.entrance } : undefined;
    try { goal.design = fallback ? await designWithJev(bot, task, goal.request, client, goal.memoryContext) :
      await designBuilding(bot, task, goal.request, { previousDraft: goal.designDraft, feedback: goal.designError, memory: goal.memoryContext, editing }); }
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
    // Geometry has been validated; whether it is the thing that was asked for
    // has not. That is a judgment, and a cheap one next to building it.
    if (!fallback && client) {
      const review = await reviewDesign(client, { request: goal.request, design: goal.design, memory: goal.memoryContext, editing });
      task.check();
      goal.designReview = review;
      if (!review.accepted) {
        const summary = review.summary;
        goal.designError = `the design does not answer the request (Jev put the fit at ${Math.round(review.fits * 100)}%): it drew "${summary.name}", ${summary.size.width}x${summary.size.height}x${summary.size.depth} with ${summary.solidBlocks} blocks; redesign it to match the request in kind, scale and material`;
        goal.designDraft = goal.design.source; delete goal.design;
        (goal.designHistory ||= []).push({ at: new Date().toISOString(), attempt: goal.designAttempts, error: goal.designError, draft: goal.designDraft, review });
        goal.designHistory = goal.designHistory.slice(-4);
        save();
        const err = new Error(goal.designError);
        if (goal.designAttempts < 4) err.name = 'DesignRepair';
        throw err;
      }
    }
    delete goal.designDraft; delete goal.designError;
    save();
    const changing = goal.buildContinuation?.mode === 'edit' && goal.buildContinuation.name;
    bot.chat(changing ? `I've worked out how to change ${changing}. Starting on it now.`
      : `I've planned ${goal.design.source.name}! I'll find a good spot and start building.`);
    return false;
  }
  const schematic = validateSchematic(goal.design.source, bot.registry);
  if (!goal.blueprint) {
    // Anchor the site where the player asked for it, and treat Jev's own past
    // structures as ground to stand on and material to build into.
    const registry = bot.buildRegistry;
    const edited = goal.buildContinuation?.mode === 'edit' ? registry?.find(goal.buildContinuation.target) : null;
    // When the designer says where the old building sits in its new drawing,
    // the result goes over the real one: additions land against it, and
    // anything the drawing leaves out is cleared instead of left standing.
    const offset = edited && schematic.existingOffset;
    const at = offset ? { x: edited.origin.x - offset[0], y: edited.origin.y - offset[1], z: edited.origin.z - offset[2] } : undefined;
    // The design is the only party that saw the ground and the building
    // together, so its choice of spot is tried first. It is a suggestion, not
    // an instruction: a player's "here" still wins, and code searches on its
    // own if the ground does not turn out to hold the building.
    const owned = registry?.claimed(dimensionName(bot), edited ? undefined : goal.buildId);
    const here = bot.entity.position.floored();
    const proposed = !goal.buildAnchor && !at && schematic.site
      ? { x: here.x + schematic.site[0], y: here.y + schematic.site[1], z: here.z + schematic.site[2] } : null;
    goal.blueprint = selectSchematicSite(bot, schematic, { anchor: goal.buildAnchor, prefer: proposed, owned, at, baseY: proposed?.y });
    if (!goal.blueprint && proposed) goal.blueprint = selectSchematicSite(bot, schematic, { owned });
    // A dream's anchor is where the village would like the next part,
    // not where a player pointed. When nothing fits there, anywhere near will do.
    if (!goal.blueprint && goal.buildAnchor && goal.dream && !at) { delete goal.buildAnchor; goal.blueprint = selectSchematicSite(bot, schematic, { owned }); }
    if (!goal.blueprint) {
      // Wandering off to find ground elsewhere is the wrong answer to a spot
      // the player chose: they asked for it there, so say it will not work.
      if (edited) throw new Blocked(`I cannot fit that change onto ${edited.name} where it stands. Ask me again and I will plan it differently.`);
      if (goal.buildAnchor) throw new Blocked('I cannot fit that building where you asked. Clear some space there, or ask me to build it somewhere else.');
      goal.step = { action: 'find_build_site', dimensions: schematic.source.size }; save();
      await explore(bot, task, goal, save, 'supported building site', { surfaceOnly: true });
      return false;
    }
    // Past structures inside the new bounds are Jev's own work, not player
    // property: without this the site-changed guard rejects its own walls.
    if (registry) {
      goal.buildOwned = { ...registry.ownership(bot, goal.blueprint.bounds, dimensionName(bot), goal.buildId), ...goal.buildOwned };
      registry.remember(goal, { dimension: dimensionName(bot) });
    }
    save();
    const reworking = goal.buildContinuation?.mode === 'edit' && goal.buildContinuation.name;
    bot.chat(reworking ? `Reworking ${reworking} at ${pos(goal.blueprint.origin)}.`
      : `Building ${goal.design.source.name} near ${pos(goal.blueprint.origin)}.`);
    // Something castle-sized is hours of placing blocks by hand. Say so at
    // the start, while stopping it is still a cheap decision for the player.
    const effort = buildEffort(goal.blueprint);
    if (effort) bot.chat(`That is a big one: ${effort.blocks} blocks, so give me about ${effort.spoken}. Say "Jev stop" if that is too long.`);
    if (goal.blueprint.preserved?.length) {
      bot.chat(reworking
        ? `${goal.blueprint.preserved.length} blocks in the way there are not mine, so I'll work around them.`
        : `There are ${goal.blueprint.preserved.length} blocks already there. I'll build around them rather than take them down.`);
    }
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
    // Rock is dug from the face inward. A cell walled in on every side cannot
    // be seen, let alone reached, until its neighbours are gone, so leaving it
    // among the nearest candidates crowds out the ones that are actually open
    // and strands an excavation that was only ever going to work layer by layer.
    buried: !faces.some(f => air(bot.blockAt(pos(p).plus(f)))),
    priority: !missing.length ? -p.y * 1000 - pos(p).distanceTo(pos(blueprint.entrance)) : 0 }))
    .map(c => ({ ...c, priority: c.priority + (c.buried ? 1e6 : 0) }));
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

// Which fill material, if any, is short of the remaining cells. A truthiness
// check here once let a single cobblestone stand in for a whole layer, so the
// real shortage surfaced later as a misleading 'cannot reach' blocker. Creative
// placement consumes nothing, so there one block genuinely does cover the layer.
function terrainShortage(bot, toFill) {
  const needed = {};
  for (const p of toFill) needed[p.material] = (needed[p.material] || 0) + 1;
  const want = count => bot.game.gameMode === 'creative' ? 1 : Math.min(count, 64);
  const name = Object.keys(needed).find(item => countOf(bot, item) < want(needed[item]));
  return name ? { item: name, count: want(needed[name]) } : null;
}

async function prepareBuildTerrain(bot, task, goal, save) {
  task.check();
  const { blueprint } = goal, terrain = blueprint.terrain;
  const toClear = terrain.clear.filter(p => !air(bot.blockAt(pos(p))));
  const toFill = terrain.fill.filter(p => !matchesBuildBlock(bot.blockAt(pos(p)), p));
  for (const p of [...toClear, ...toFill]) if (!canClearSchematicBlock(blueprint, goal.buildOwned, bot.blockAt(pos(p))))
    throw new Blocked(`The building site changed at ${pos(p)}; preserving the unexpected ${bot.blockAt(pos(p))?.name}. Clear it or request a new build`);
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
    const short = terrainShortage(bot, toFill);
    if (short) { await acquireStep(bot, task, short.item, short.count, goal, save); return; }
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
  if (goal.pendingDelivery || goal.pendingChestDelivery || goal.deliveryMode === 'chest' || countOf(bot, goal.item) >= remaining) {
    if (!goal.deliver) return true;
    goal.step = { action: 'deliver', item: goal.item, count: remaining, recipient: goal.from }; save();
    return deliver(bot, task, goal, save);
  }
  const stock = await withUsableWorkstations(bot, task, planningInventory(bot), [goal.item]);
  const plan = catalogPlan(bot, goal.item, remaining, stock, goal);
  return executePlannedAcquisition(bot, task, goal, save, client, onStep, plan, { item: goal.item, count: remaining }, stock);
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
  await executePlannedAcquisition(bot, task, work, checkpoint, client, onStep, plan, { outputs }, stock);
  return false;
}

async function executePlannedAcquisition(bot, task, goal, save, client, onStep, plan, acquisition, available) {
  const first = plan[0];
  if (first?.action === 'mine') {
    if (await collectNearbyDrops(bot, task, first.drops, {
      allowExcavation: true,
      onTarget: target => { goal.step = { action: 'collect', ...target }; save(); },
    })) return false;
  }
  if (await prepareMiningTool(bot, task, goal, save, plan, available)) return false;
  // Catalog routing replaced the old named concrete workflow. Preserve its
  // tool/wood/table preparation for any request whose recipe needs a descent,
  // while leaving nearby surface pickups and Creative inventory immediate.
  if ((!goal.expeditionReady || descentSuppliesLow(bot)) && bot.game.gameMode !== 'creative') {
    const underground = plan.find(s => s.action === 'mine' && Number.isFinite(s.depth) && s.depth < bot.entity.position.y - 8);
    const withinReach = underground && !descentSuppliesLow(bot) && await reachableLocalMine(bot, task, await miningCandidates(bot, task, underground, goal));
    if (goal.preparingExpedition || (underground && !withinReach)) {
      goal.preparingExpedition = true; delete goal.expeditionReady; save();
      await prepareExpeditionStep(bot, task, goal, save);
      return false;
    }
  }
  const step = plan[0];
  if (!step) return false;
  if (step.action === 'mine' && await continueSource(bot, task, step, goal, save, onStep)) return false;
  const actions = {};
  if (step.action === 'mine') {
    const reachable = [];
    for (const p of (await miningCandidates(bot, task, step, goal)).slice(0, 12)) {
      if (p.equals(supportCell(bot.entity.position))) continue;
      if (!bot.canDigBlock(bot.blockAt(p)) && bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalGetToBlock(p.x, p.y, p.z), 200).status !== 'success') continue;
      reachable.push(p);
    }
    // Jev chooses between sources that differ; code picks the block inside one.
    for (const source of resourceSources(bot, reachable, { failures: goal.decisionFailures, unreachable: goal.unreachable })) {
      actions[source.key] = { description: { ...source.description, resource: step.drops, requiredTool: step.tool },
        valid: () => !!nearestRemaining(bot, source), run: () => workSource(bot, task, step, goal, save, source) };
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

// Walk into a portal block. The pathfinder will not always end a route
// inside one, so get beside it and step in with the controls until the
// dimension changes; the Nether-side return stalled a block short otherwise.
async function enterPortal(bot, task, portal, arrived) {
  await navigate(bot, task, new goals.GoalNear(portal.x, portal.y, portal.z, 1), { timeoutMs: 20000 });
  if (arrived()) return;
  bot.pathfinder.setGoal(null);
  await bot.lookAt(pos(portal).offset(0.5, 0.5, 0.5), true);
  bot.setControlState('forward', true);
  try { await waitFor(task, arrived, 8000); }
  finally { bot.setControlState('forward', false); }
}

// Portals the bot has used, per dimension. A food trip that wanders two
// hundred blocks must not end in a second portal built from scratch: the
// one already lit is a walk away.
function rememberPortal(goal, save, portal, where) {
  goal.portals ||= [];
  if (goal.portals.some(p => p.dimension === where && Math.hypot(p.x - portal.x, p.z - portal.z) < 4)) return;
  goal.portals.push({ x: portal.x, y: portal.y, z: portal.z, dimension: where }); save();
}
async function walkToKnownPortal(bot, task, goal, save, where) {
  const here = bot.entity.position;
  const known = (goal.portals || []).filter(p => p.dimension === where && Math.hypot(p.x - here.x, p.z - here.z) <= 600)
    .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z));
  if (!known.length) return false;
  const p = known[0];
  goal.step = { action: 'return_to_portal', portal: { x: p.x, y: p.y, z: p.z } }; save();
  // Close enough to route: walk. Otherwise, or when the walk gives out, dig
  // a staircase toward it the way an ore is reached; a portal at y=-11 is
  // not on any surface route.
  const distance = here.distanceTo(pos(p));
  if (distance <= 48) {
    try { await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 60000, stallMs: 8000 }); return true; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  await resourceTunnelStep(bot, task, goal, save, pos(p), `portal_${where}`, { dig, navigate });
  return true;
}

async function netherStep(bot, task, goal, save) {
  if (String(bot.game.dimension).includes('nether')) return true;
  // The portal is often underground and the Nether has no wood: the same
  // supplies a descent needs, checked before the walk rather than after a
  // stone pickaxe wears to five on the way.
  if (bot.game?.gameMode !== 'creative' && !goal.expeditionPrepActive && (goal.preparingExpedition || descentSuppliesLow(bot))) {
    goal.preparingExpedition = true; delete goal.expeditionReady; goal.expeditionPrepActive = true; save();
    try { await prepareExpeditionStep(bot, task, goal, save); }
    finally { delete goal.expeditionPrepActive; }
    return false;
  }
  const portal = find(bot, ['nether_portal'], 64, 1)[0];
  if (portal) {
    goal.portal = { ...portal }; rememberPortal(goal, save, portal, 'overworld'); save();
    await enterPortal(bot, task, portal, () => String(bot.game.dimension).includes('nether'));
    return true;
  }
  if (await walkToKnownPortal(bot, task, goal, save, 'overworld')) return false;
  // A frame whose blocks are not loaded is a portal somewhere else, not ten
  // missing obsidian: go and look at it before planning another.
  if (goal.portalFrame && goal.portalFrame.blocks.some(p => !bot.blockAt(pos(p)))) {
    const o = goal.portalFrame.origin;
    goal.step = { action: 'return_to_portal', portal: { ...o } }; save();
    await navigate(bot, task, new goals.GoalNear(o.x, o.y, o.z, 3), { timeoutMs: 60000, stallMs: 8000 });
    return false;
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
  return new Survival(bot, { acquireStep, dig, place, navigate, explore, returnOverworld: returnFromNether }, options);
}

async function returnFromNether(bot, task, goal, save) {
  if (dimension(bot) === 'overworld') return;
  const portal = find(bot, ['nether_portal'], 64, 1)[0];
  if (!portal) {
    if (await walkToKnownPortal(bot, task, goal, save, 'nether')) return;
    throw new Blocked('No loaded return portal observed in the Nether; saved progress retained');
  }
  rememberPortal(goal, save, portal, 'nether');
  goal.step = { action: 'return_overworld', portal: { ...portal } }; save();
  await enterPortal(bot, task, portal, () => dimension(bot) === 'overworld');
}

function protectConstruction(bot, goal) {
  const movements = bot.pathfinder.movements;
  movements.exclusionAreasBreak = (movements.exclusionAreasBreak || []).filter(rule => rule !== bot._constructionProtection);
  bot._constructionProtection = block => reservedForConstruction(goal, block.position) ? 100 : 0;
  movements.exclusionAreasBreak.push(bot._constructionProtection);
}

// Requests that no amount of trying can satisfy. They are explained once and
// parked, with the bot surviving meanwhile; everything else keeps going.
const IMPOSSIBLE = /No supported survival acquisition|does not spawn in Peaceful|must be auto, jev or openrouter|needs OPENROUTER_API_KEY|Unsupported mob source|Take me there, then say resume|Please request at most|spans too many catalog branches|Creative inventory is only available|could not produce a usable plan after four attempts|The Jev fallback supports/;

// The bot does not give up. When ordinary retries, Jev's recovery pick and
// moving on have all failed, it says so once, shakes itself loose, leaves
// the resource it was stuck on if there was one, waits a while (longer each
// time, up to a minute, so an impossible spot costs little per hour) and
// goes again with a clean slate. Only the player, the game, or a request
// that is impossible by definition ends a request.
async function persist(bot, task, goal, save, err, onStep, { backoffMs = 3000 } = {}) {
  goal.struggles = (goal.struggles || 0) + 1;
  goal.lastStruggle = { at: new Date().toISOString(), error: err.message };
  goal.search = {};
  if (goal.struggles === 1 || goal.struggles % 5 === 0) {
    bot.chat?.(`${friendlyProblem(err)} I'll keep trying${goal.struggles > 1 ? ` (attempt ${goal.struggles})` : ''}.`);
  }
  goal.step = { action: 'persist', attempt: goal.struggles, problem: err.message }; save(); onStep(goal);
  const survivalOnly = e => { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(e.name)) throw e; };
  try { await shakeLoose(bot, task, Date.now() + 25000, { guard: () => checkThreats(bot) }); } catch (e) { survivalOnly(e); }
  if (goal.lastStruggleStep?.action === 'mine' || goal.step?.action === 'mine') {
    try { await moveOnFromResource(bot, task, { ...goal, step: goal.lastStruggleStep || goal.step }, save); } catch (e) { survivalOnly(e); }
  }
  const pause = Math.min(60000, backoffMs * 2 ** Math.min(goal.struggles - 1, 5));
  const end = Date.now() + pause;
  // The pause watches for threats like any other wait: the sixth death was
  // a skeleton walking up during a sixty-second back-off. A threat ends the
  // pause with NeedsSafety, which the loop hands to the survival layer.
  while (Date.now() < end) { task.check(); checkAir(bot); checkThreats(bot); await sleep(100); }
  goal.failures = 0; goal.stalls = 0; delete goal.decisionFailures; delete goal.lastError; save(); onStep(goal);
}

function createRecoveryAdviser(bot, client) {
  return new RecoveryAdviser(bot, { acquireStep, catalogPlan, planningInventory, surfaceStep, navigate, explore, find }, { client });
}

// Full pockets stall quietly: ore mined and never picked up, a crafting
// grid spilling on the ground. Surplus stone goes before that happens.
async function keepRoom(bot, task, goal) {
  const heading = goal.step?.destination || goal.step?.target || goal.tunnel?.target;
  const dropped = await tidyInventory(bot, task, { away: heading && Number.isFinite(heading.x) ? heading : null });
  if (dropped.length) {
    // Tunnelling refills the stone every few minutes; say so now and then,
    // not at every stack.
    const quiet = goal.tidied && Date.now() - Date.parse(goal.tidied.at) < 600000;
    goal.tidied = { at: new Date().toISOString(), dropped };
    if (!quiet) bot.chat?.(`My pockets are full, so I'm leaving ${dropped.map(d => `${d.count} ${d.name.replaceAll('_', ' ')}`).join(', ')} here.`);
  }
}

async function tryRecovery(adviser, task, goal, save) {
  try { return await adviser.suggest(task, goal, save); }
  catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) return true;
    throw err;
  }
}

// A handler that runs inside the loop's catch must not throw past it: an
// exception there leaves runGoal, and the session marks the request blocked
// with "say resume". Moving on from a resource ended the dream run that way
// when its exploration step found no dry route. A failed handler is a
// failed step, and the loop's own persistence deals with it.
async function inCatch(task, goal, fn) {
  try { return await fn(); }
  catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) return true;
    goal.lastError = err.message;
    return false;
  }
}

// What to do with spare daylight. Between requests, with shelter and food
// already sufficient, the bot used to stand still until something changed.
// A companion with half an hour of light should be cooking the raw beef it
// is carrying, making stone tools, or stocking wood. Code lists what is
// feasible and useful right now; Jev picks, with resting always on offer so
// nothing is forced. Each choice runs one bounded step and is re-judged.
const RAW_FOOD = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', rabbit: 'cooked_rabbit' };
const STONE_TOOLS = ['stone_pickaxe', 'stone_axe', 'stone_sword'];
const toolTier = name => Math.max(0, TOOL_TIERS.indexOf(String(name).replace(/_(pickaxe|axe|sword|shovel)$/, '')) + 1);
function idleOptions(bot, goal) {
  const options = {}, stock = planningInventory(bot);
  const raw = Object.entries(RAW_FOOD).filter(([item]) => stock[item] > 0);
  if (raw.length) {
    const [item, cooked] = raw.sort((a, b) => stock[b[0]] - stock[a[0]])[0];
    options.cook_food = { description: `Cook the ${stock[item]} raw ${item.replaceAll('_', ' ')} being carried; cooked food restores far more hunger.`, item: cooked, count: stock[item] };
  }
  const carried = bot.inventory.items().map(i => i.name);
  const missing = STONE_TOOLS.filter(tool => !carried.some(name => name.endsWith(tool.slice(5)) && toolTier(name) >= 2));
  if (missing.length) options.stone_tools = { description: `Make ${missing.map(t => t.replaceAll('_', ' ')).join(', ')}: faster digging and a real weapon, from cobblestone and sticks.`, item: missing[0], count: 1 };
  const logs = Object.keys(stock).filter(n => n.endsWith('_log')).reduce((n, k) => n + stock[k], 0);
  if (logs < 16) {
    const nearby = find(bot, bot.registry.blocksArray.filter(b => /_log$/.test(b.name)).map(b => b.name), 32, 8);
    const species = nearby.length ? bot.blockAt(nearby[0])?.name : null;
    if (species) options.stock_wood = { description: `Stock up to 16 logs from the ${species.replaceAll('_', ' ')} trees nearby (${logs} carried); wood is needed for tools, fuel and repairs.`, item: species, count: 16 - logs };
  }
  // The base's chores, each one already checked feasible: a plot to tend,
  // wheat to bake, cows to lead in or breed.
  Object.assign(options, homeChores(bot, goal));
  if (stock.coal > 0 && (stock.torch || 0) < 8) options.torches = { description: `Craft torches from the ${stock.coal} coal being carried; light keeps mobs from spawning at home.`, item: 'torch', count: 4 };
  // The standing dream. With nothing asked and nothing urgent, the next
  // rung of the beat-the-game ladder is always on offer; it is a long walk
  // from a stone pickaxe to a dragon, and this is how the walk gets taken.
  if (bot.game.gameMode === 'survival') {
    const stage = nextGameStage(bot, goal);
    if (stage.phase !== 'complete') options.long_game = { description: `Work toward beating the game. The next stage is ${stage.phase.replaceAll('_', ' ')}${stage.item ? ` (${stage.count} ${stage.item.replaceAll('_', ' ')})` : ''}; it may mean a long trip and a real fight, so choose it with supplies, tools and daylight in hand.`, phase: stage.phase, stage };
  }
  return options;
}

async function idleWork(bot, task, goal, save, client, onStep = () => {}, { acquire = acquireStep, handlers, actions } = {}) {
  if (!client || bot.game.gameMode === 'creative') return false;
  if ((bot.health ?? 20) < 14 || (bot.food ?? 20) < 12 || immediateThreat(bot)) return false;
  if (bot.game.dimension === 'overworld' && bot.time?.timeOfDay >= 9500) return false;
  const options = idleOptions(bot, goal);
  if (!Object.keys(options).length) return false;
  const tree = { rest: { description: 'Wait here quietly. Right when supplies are sufficient, light is short, or the player is likely to ask for something soon.', run: async () => { for (let n = 0; n < 30; n++) { task.check(); await sleep(100); } } } };
  for (const [key, option] of Object.entries(options)) {
    tree[key] = { description: option.description, run: async () => {
      goal.step = { action: 'idle', choice: key, item: option.item, count: option.count, phase: option.phase }; save(); narrate(bot, goal);
      if (key === 'long_game') await gameStep(bot, task, goal, save, handlers || gameHandlers(bot, client));
      else if (option.run) await option.run(bot, task, goal, save, actions || homeActions());
      else await acquire(bot, task, option.item, option.count, goal, save);
    } };
  }
  const state = { situation: 'Between player requests, with shelter and food already sufficient. Choose how to spend spare daylight.',
    timeOfDay: bot.time?.timeOfDay, daylightTicksRemaining: Math.max(0, 9500 - (bot.time?.timeOfDay || 0)),
    health: bot.health, food: bot.food, foodReserve: foodSupply(bot), inventory: planningInventory(bot),
    retainedRequest: goal.retainedRequest || null, home: goal.survival?.home ? `A home base with a plot, a pen and a bed stands at ${goal.survival.home.origin.x}, ${goal.survival.home.origin.z}.` : goal.blueprint ? 'A house is built nearby.' : 'No house yet.' };
  await decideAction(bot, task, goal, save, client, onStep, tree, state);
  return true;
}


// What the home base needs from the executor: travel, placing, digging,
// the planner for anything craftable, and a search for sheep or cows.
const homeActions = () => ({ acquireStep, navigate, place, dig, explore });

// The executors the game-completion ladder can call, shared by the win
// objective and by idle dream between requests.
function gameHandlers(bot, decisionClient) {
  return {
        acquireStep, acquireSetStep, enter_nether: netherStep, return_overworld: returnFromNether,
        enter_end: (bot, task, goal, save) => enterEnd(bot, task, goal, save, { navigate }),
        fight_dragon: (bot, task, goal, save) => fightEndStep(bot, task, goal, save, { navigate }, decisionClient),
        exit_end: (bot, task, goal, save) => exitEnd(bot, task, goal, save, { navigate }),
        prepare_combat: (bot, task, goal, save) => prepareCombatGear(bot, task, goal, save, { acquireStep }),
        prepare_end: (bot, task, goal, save) => prepareEndSupplies(bot, task, goal, save, { acquireStep }),
        home: (bot, task, goal, save, stage) => homeStep(bot, task, goal, save, stage, homeActions()),
        find_stronghold: (bot, task, goal, save) => findStronghold(bot, task, goal, save, {
          navigate, explore, surfaceStep,
          tunnel: async (bot, task, goal, save, target, resource) => {
            if (pickaxeTier(bot) < 1) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return; }
            await resourceTunnelStep(bot, task, goal, save, target, resource, { dig, navigate });
          },
        }, decisionClient),
      
  };
}

async function runIdle(bot, task, goal, store, { survival, decisionClient, recoveryAdviser, onStep = () => {}, until = () => false, backoffMs = 3000 } = {}) {
  survival ||= createSurvival(bot, { state: goal.survival, client: decisionClient });
  goal.survival = survival.state;
  const save = () => store.save(goal);
  protectConstruction(bot, goal);
  recallWorkstations(bot, goal);
  recoveryAdviser ||= createRecoveryAdviser(bot, decisionClient);
  let failures = 0;
  while (!until()) {
    task.interruptCheck = undefined; task.check(); updateDigCapabilities(bot);
    try {
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task);
        if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
      }
      await keepRoom(bot, task, goal);
      const acted = await survival.step(task, goal, save, onStep);
      if (!acted) await idleWork(bot, task, goal, save, decisionClient, onStep);
      failures = 0; delete goal.lastError; save(); onStep(goal); narrate(bot, goal);
    } catch (err) {
      task.interruptCheck = undefined; task.check();
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) failures++;
      goal.lastError = err.message; save(); onStep(goal);
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) recoveryAdviser.recordFailure(goal, err);
      if (failures >= 3 && await inCatch(task, goal, () => tryRecovery(recoveryAdviser, task, goal, save))) { failures = 0; continue; }
      // Survival never gives up either: shake loose, back off, go again.
      if (failures >= 5) { await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { backoffMs })); failures = 0; continue; }
    } finally { task.interruptCheck = undefined; }
    for (let n = 0; n < 10; n++) { task.check(); await sleep(100); }
  }
  return { ok: true, goal };
}

async function runGoal(bot, task, goal, store, { maxSteps = Infinity, onStep = () => {}, decisionClient, survival, recoveryAdviser, backoffMs = 3000 } = {}) {
  const save = () => store.save(goal);
  task.opportunityClient = decisionClient;
  if (goal.boatTravel?.placed?.uuid && goal.boatTravel.placed.dimension === bot.game.dimension) (bot._ownedBoats ||= new Set()).add(goal.boatTravel.placed.uuid);
  survival ||= createSurvival(bot, { state: goal.survival, client: decisionClient });
  goal.survival = survival.state;
  protectConstruction(bot, goal);
  recallWorkstations(bot, goal);
  recoveryAdviser ||= createRecoveryAdviser(bot, decisionClient);
  goal.status = 'running'; goal.failures = 0; goal.stalls = 0; save();
  const stopObserving = goal.kind === 'win' ? watchGameProgress(bot, goal, save) : () => {};
  try {
  for (let n = 0; n < (goal.kind === 'follow' ? Infinity : goal.kind === 'build' ? Math.max(maxSteps, 30000) : maxSteps); n++) {
    task.interruptCheck = undefined;
    task.check();
    updateDigCapabilities(bot);
    // Say what the last step started on. Here rather than at the loop's end,
    // because survival and continued work leave the loop body early.
    narrate(bot, goal);
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
      await keepRoom(bot, task, goal);
      if (!endTask && await survival.step(task, activeWork, saveWork, () => onStep(goal))) {
        goal.stalls = 0; goal.failures = 0; delete goal.lastError; save(); onStep(goal); continue;
      }
      task.interruptCheck = bot.game.gameMode === 'creative' || endTask ? undefined : () => checkThreats(bot);
      // Air and eating carried food are rules, not judgments: there is no
      // request that is better served by staying hungry with bread in hand.
      if (!endTask) {
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
        else if (goal.pendingDelivery || goal.pendingChestDelivery || goal.deliveryMode === 'chest' || await acquireStep(bot, task, 'purple_concrete', goal.count - (goal.delivered || 0), goal, save)) {
          goal.step = { action: 'deliver', count: goal.count - (goal.delivered || 0), recipient: goal.from }; save();
          complete = await deliver(bot, task, goal, save);
        }
      }
      if (prepared && goal.kind === 'nether') complete = await netherStep(bot, task, goal, save);
      if (prepared && goal.kind === 'win') complete = await gameStep(bot, task, goal, save, gameHandlers(bot, decisionClient));
      task.check();
      goal.failures = 0;
      delete goal.lastError;
      goal.history ||= [];
      goal.history.push({ time: new Date().toISOString(), step: goal.step, inventory: inventory(bot), position: { ...bot.entity.position }, dimension: bot.game.dimension });
      goal.history = goal.history.slice(-40);
      if (complete) {
        if (goal.kind === 'house') survival.rememberHouse(goal.blueprint);
        bot.buildRegistry?.remember(goal, { dimension: dimension(bot), status: 'complete' });
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
      if ((err.name === 'Blocked' || goal.failures >= 3) && await inCatch(task, goal, () => tryRecovery(recoveryAdviser, task, goal, save))) {
        goal.failures = 0; goal.stalls = 0; save(); onStep(goal); continue;
      }
      // No adviser, or none that could help: a resource that keeps failing
      // here is abandoned for elsewhere before the failure budget runs out.
      if (goal.failures >= 3 && err.name !== 'Blocked' && await inCatch(task, goal, () => moveOnFromResource(bot, task, goal, save))) {
        goal.failures = 0; goal.stalls = 0; save(); onStep(goal); continue;
      }
      if (err.name === 'Blocked' && IMPOSSIBLE.test(err.message)) {
        goal.status = 'blocked'; save();
        bot.chat(`${friendlyProblem(err)} I saved our progress. ${recoveryHint(err)}`);
        return { ok: false, reason: err.message, goal };
      }
      if (err.name === 'Blocked' || goal.failures >= 5) {
        goal.lastStruggleStep = goal.step;
        await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { backoffMs }));
        continue;
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

module.exports = { hitboxIntrudes, terrainShortage, runGoal, runIdle, idleWork, idleOptions, createSurvival, acquireStep, inventory, planningInventory, catalogPlan, selectSite, explore, smelt, dig, place, waitFor, constructionObservation, Blocked, designedBuildStep, surfaceStep };
