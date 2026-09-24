'use strict';
const { move } = require('./motion');
const { attemptsFor, setAside, isSetAside, watch, unwatch } = require('./progress');
const { DAY } = require('./day');
const { STALL_MS, watchStalls, unwatchStalls, checkStall, takeStall, recordStill } = require('./stillness');

const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, equipBestTool, pickaxeTier, pickaxeDurability, countOf, shakeLoose } = require('./skills');
const { MINEABLE, TOOL_TIERS } = require('./plan');
const { houseBlueprint, verifyHouse } = require('./objectives');
const { deliver } = require('./delivery');
const { reservedForConstruction, portalSiteClear, selectPortalSite, portalSupports } = require('./build-sites');
const { updateDigCapabilities } = require('./movement');
const { resourceTunnelStep, tunnelStep, staircaseResting, safeExcavation } = require('./tunneling');
const { maintainVitals, checkAir, needsAir, chooseFood, digWithAirGuard, safeFood } = require('./vitals');
const { decide, question } = require('./decisions');
const { Survival, inWater, lavaExit, shelterNeeded } = require('./survival');
const { checkThreats, safeFromHostiles, immediateThreat } = require('./danger');
const { resourceSources, nearestRemaining, decisionFingerprint, setAsideSource, rememberSource, committedSource } = require('./decision-options');
const { reviewDesign } = require('./design-review');
const { narrate } = require('./narration');
const { planCatalog, sourceBlocks } = require('./knowledge');
const { takeCreativeItem, clearCreativeInventory } = require('./creative');
const { surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete, handDiggableExit } = require('./surface');
const { bootstrapPickaxe } = require('./tool-recovery');
const { foodSupply } = require('./foraging');
const { observeRecipeAlternatives, knownResourceLocations, knownResourceNames, rememberResources, isSurfaceResource } = require('./resource-observation');
const { designBuilding, designerAvailable, validateSchematic, selectSchematicSite, canClearSchematicBlock, schematicScaffolding, LIMITS, SECONDS_PER_BLOCK } = require('./designer');
const { designWithJev } = require('./build-templates');
const { dryMiningPositions, foliageMiningCandidate, approachDryMining, miningMovement, reachableLocalMine, dryStanding, miningReach } = require('./mining-access');
const { dryPassable, supportCell, swimmableWater } = require('./terrain');
const { RecoveryAdviser } = require('./recovery-adviser');
const { noticeLandmarks, unexploredArea, explorationSummary, summaryText, exploreStep } = require('./exploration');
const { lootNearby, lootStep, unlootedLandmarks } = require('./looting');
const { enchantReady, enchantStep, enchantable } = require('./enchanting');
const { tradeWorthwhile, tradeStep } = require('./trading');
const { strategyStep } = require('./strategy');
const { openChest } = require('./chest-delivery');
const { barterStep, gatherBastionGold } = require('./bartering');
const { descendPillar, pillarUp, pillarSite } = require('./pillar-recovery');
const { gameStep, watchGameProgress, dimension, nextGameStage, DEFERRABLE, RUNG_WAIT_MS } = require('./game-progress');
const { carriedEquipment } = require('./mob-policy');
const { huntObserved, prepareMobHunt, prepareCombatGear } = require('./mob-hunt');
const { findStronghold } = require('./stronghold');
const { enterEnd } = require('./end-portal');
const { fightEndStep } = require('./end-combat');
const { exitEnd } = require('./end-exit');
const { prepareEndSupplies } = require('./end-supplies');
const { collectWater } = require('./water');
const { makeObsidian } = require('./obsidian');
const { tidyInventory, roomFor, makeRoom, crowded } = require('./inventory-tidy');
const { homeStep, homeChores , gatherWool, woolCarried } = require('./home-base');
const { stashValuables, restockFromStash, NETHER_FOOD_POINTS } = require('./home-stash');
const { noticeVillage, takeVillageBed } = require('./villages');
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
const { opportunisticPickups } = require('./opportunistic-pickups');
const { reachShore } = require('./shore');
const { collectNearbyDrops } = require('./drop-collection');
const { friendlyProblem, recoveryHint, completion } = require('./speech');
const { boatTravelStep } = require('./boats');
const { dimension: dimensionName } = require('./game-progress');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pos = p => new Vec3(p.x, p.y, p.z);
const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);
const faces = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];

// A TypeError is a bug, not the world: it goes to the log with where it
// happened, once per message, and the goal carries the top frame so the
// flight recorder has it. The missing search origin threw for an hour as
// "Cannot read properties of undefined (reading 'x')" and nothing said where.
const reportedBugs = new Set();
function noteError(goal, err) {
  goal.lastError = err.message;
  const frames = String(err.stack || '').split('\n').filter(line => /\/src\//.test(line)).map(line => line.trim().replace(/^at /, '').replace(/\(?\/.*\/src\//, '(src/'));
  // Where a failure came from, past the shared primitives: "navigation
  // ended" five times over said nothing about which walk it was.
  goal.lastErrorFrom = frames.filter(f => !/src\/(skills|motion)\.js/.test(f)).slice(0, 2).join(' < ') || undefined;
  if (!(err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError)) { delete goal.lastErrorAt; return; }
  goal.lastErrorAt = frames.slice(0, 3).join(' < ');
  if (!reportedBugs.has(err.message)) { reportedBugs.add(err.message); console.error('[bug]', err.stack); }
}

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

// A pickaxe wears out in the shaft, not at the crafting table. The stone
// pickaxe on the ninth climb had seventy-seven uses when the iron tunnel
// began, the shield rung had just spent the planks, and the bot dug out
// by hand at seven seconds a block. The tool is checked every step, and
// the spare is made while the sticks and cobblestone are still in the
// pockets, whatever the current step is doing.
const remainingUses = (bot, item) => (bot.registry?.itemsByName?.[item.name]?.maxDurability || Infinity) - (item.durabilityUsed || 0);
const sparePickaxeMaterials = bot => countOf(bot, 'cobblestone') >= 3 &&
  (countOf(bot, 'stick') >= 2 || bot.inventory.items().some(i => /_planks$/.test(i.name) && i.count >= 2) || logsCarried(bot) >= 1);
// What a stalled step leaves behind that would send it straight back to
// where it stalled: the current shaft, search and surface return, the
// mining sites' work positions, the hunt's marks, a fortress face.
function looseEnds(goal, now = Date.now()) {
  // The search is turned, not dropped (answerStall): dropped, a search for
  // wood across a desert began again from its first heading at every stall
  // and zig-zagged (trial 17, 2026-09-24).
  delete goal.tunnel; delete goal.surfaceReturn;
  if (goal.miningSites) for (const site of Object.values(goal.miningSites)) { delete site.workPosition; site.rejoinBlockedUntil = now + 600000; }
  if (goal.mobHunt) { attemptsFor(goal).clearAction('hunt_target'); delete goal.mobHunt.stalking; }
  if (goal.fortressSearch) {
    delete goal.fortressSearch.target;
    const found = goal.fortressSearch.found;
    if (found) { (goal.fortressSearch.shunned ||= []).push({ x: found.x, z: found.z, until: now + 600000 }); delete goal.fortressSearch.found; }
  }
  goal.lastStallAt = now;
}

// A stall (stillness.js) is answered by Jev, whatever stalled: the same
// thing done differently, the rung left for later, or something else useful
// from here for a while (breakStillness), with how many times it has stalled
// as a fact. Without Jev, in that order by strikes. A survival action that
// stalled is refused by the survival layer for ten minutes
// (Survival.report), which falls through to its next answer; nothing more
// is needed here.
const thingOf = key => key.replace(/^\w+:/, '').replace(/^rung:/, '').replace(/:/g, ' ').replaceAll('_', ' ');
async function answerStall(bot, task, goal, save, stall, { client, survival, onStep = () => {}, idle = false, now = Date.now() } = {}) {
  const stats = survival?.state || goal.survival || goal;
  const thing = thingOf(stall.key);
  if (stall.layer === 'survival') {
    recordStill(stats, stall.key, STALL_MS, { now, detour: 'refused' }); save();
    if (stall.strikes === 1) bot.chat?.(`${thing[0].toUpperCase()}${thing.slice(1)} isn't getting me anywhere. Something else, then.`);
    return;
  }
  looseEnds(goal, now);
  const answers = {};
  const mine = [goal.step, goal.lastStruggleStep].find(step => step?.action === 'mine' && step.block);
  if (!idle) answers.differently = { description: mine
    ? `Keep at the ${thing} another way: leave this patch of ${String(mine.block).replaceAll('_', ' ')} for one further off.`
    : `Keep at the ${thing} another way: step eight blocks off to fresh ground and come at it again from there; the search turns to a heading not tried, and the shaft or site it was using is dropped.`,
  run: async () => {
    // A search is turned, not dropped: an empty search re-derives its
    // heading from the resource's name, which pointed the bot straight back
    // along the route it had turned away from.
    goal.search = turnSearch(goal.search);
    // After failures, first out of whatever it is wedged in.
    if (stall.error) await shakeLoose(bot, task, Date.now() + 25000, { guard: () => checkThreats(bot) });
    // A mine moves on from this patch of the resource and says so;
    // anything else says it once here.
    if (mine) {
      const step = goal.step; goal.step = mine;
      try { await moveOnFromResource(bot, task, goal, save); }
      finally { if (goal.step === mine) goal.step = step; }
    } else {
      bot.chat?.(`I'm getting nowhere with the ${thing}. Trying another way.`);
      // Another way starts from somewhere else: the same spot is the same
      // attempt. Trial 24 answered a stalled plot by turning a search it
      // was not using, and stood by the same cell until the audit failed it.
      const turn = goal.survival || goal;
      const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; turn.detourHeading = heading;
      const angle = heading * Math.PI / 4, here = bot.entity.position.floored();
      const target = here.offset(Math.round(Math.cos(angle) * 8), 0, Math.round(Math.sin(angle) * 8));
      try { await navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, 2), { timeoutMs: 15000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
  } };
  const rung = goal.rungTime?.phase;
  if (rung && DEFERRABLE.has(rung)) answers.set_aside_rung = { description: `Leave the ${rung.replaceAll('_', ' ')} for thirty minutes and go on with the next thing the game needs; it comes back afterwards.`,
    run: async () => {
      setAside(goal, 'rung', rung, `stalled ${stall.strikes} times in ten minutes`, RUNG_WAIT_MS); delete goal.rungTime;
      bot.chat?.(`I keep getting stuck on the ${rung.replaceAll('_', ' ')}. I'll come back to it.`);
    } };
  const stalled = { what: thing, strikes: stall.strikes, ...(stall.error ? { failure: stall.error } : {}), ...(rung && goal.rungTime?.ms ? { minutesOnRung: Math.round(goal.rungTime.ms / 60000) } : {}) };
  await breakStillness(bot, task, goal, save, { client, survival, onStep, reason: stall.key, now, answers, stalled });
}

const spareDue = bot => {
  if (bot.game?.gameMode === 'creative') return false;
  const pickaxes = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name));
  return pickaxes.length > 0 && pickaxes.every(i => remainingUses(bot, i) < SPARE_PICKAXE_DURABILITY) && sparePickaxeMaterials(bot);
};
async function maintainPickaxe(bot, task, goal, save) {
  if (!spareDue(bot)) return false;
  if (!(goal.spareAnnouncedAt > Date.now() - 10 * 60 * 1000)) { goal.spareAnnouncedAt = Date.now(); bot.chat('My pickaxe is nearly done. Making a spare before it goes.'); }
  await acquireStep(bot, task, 'stone_pickaxe', countOf(bot, 'stone_pickaxe') + 1, goal, save);
  return true;
}

// Sixteen building blocks carried, made up when short, the way the spare
// pickaxe is: cobblestone with a pickaxe, dirt without, netherrack in the
// Nether. Never in water or at night on the surface, and a gather that
// fails rests ten minutes.
const WOOD_RESERVE = 3;
const woodUnits = bot => bot.inventory.items().reduce((n, i) => n + (/_log$|_stem$/.test(i.name) ? i.count : /_planks$/.test(i.name) ? i.count / 4 : i.name === 'stick' ? i.count / 8 : 0), 0);
const reserveWeather = bot => bot.game?.gameMode !== 'creative' && !bot.entity?.isInWater && !(bot.game?.dimension === 'overworld' && shelterNeeded(bot));
// Wood too, three logs' worth: the sticks for a pickaxe and a table. Worn
// pickaxes and no wood had the bot climbing out of its night mine by hand,
// a block every twenty-three seconds for four minutes.
const woodDue = (bot, goal) => reserveWeather(bot) && woodUnits(bot) < WOOD_RESERVE && /overworld/.test(String(bot.game?.dimension || 'overworld')) && !isSetAside(goal, 'block_reserve', 'wood');
const blocksDue = (bot, goal) => { const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy'); return reserveWeather(bot) && blockStock(bot) < BLOCK_RESERVE && !isSetAside(goal, 'block_reserve', 'gather'); };
async function gatherWood(bot, task, goal, save) {
  const have = woodUnits(bot);
  const species = (bot._catalogObservation?.nearby || []).find(name => /_log$/.test(name)) || 'oak_log';
  goal.step = { action: 'wood_reserve', item: species, have }; save();
  try { await acquireStep(bot, task, species, countOf(bot, species) + Math.ceil(WOOD_RESERVE + 1 - have), goal, save); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'block_reserve', 'wood', err, 600000); }
  return true;
}
async function gatherBlocks(bot, task, goal, save) {
  const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy');
  const have = blockStock(bot);
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const item = nether ? 'netherrack' : pickaxeTier(bot) >= 1 ? 'cobblestone' : 'dirt';
  goal.step = { action: 'block_reserve', item, have }; save();
  try { await acquireStep(bot, task, item, countOf(bot, item) + (BLOCK_RESERVE - have), goal, save); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'block_reserve', 'gather', err, 600000); }
  return true;
}
// Without Jev, the reserves in the old order: wood, then blocks.
async function maintainBlocks(bot, task, goal, save) {
  if (woodDue(bot, goal)) return gatherWood(bot, task, goal, save);
  if (blocksDue(bot, goal)) return gatherBlocks(bot, task, goal, save);
  return false;
}

// Upkeep: a spare pickaxe before the one in hand wears out, and the wood and
// blocks a night or a climb needs. Whether now is the time is Jev's: it is
// asked when one falls short, with what is carried, and "carry on" holds
// for five minutes. Without Jev, the old order: pickaxe, wood, blocks.
const UPKEEP_HOLD_MS = 5 * 60 * 1000;
async function upkeepStep(bot, task, goal, save, client, onStep = () => {}) {
  const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy');
  const options = {};
  const worn = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `${i.name.replaceAll('_', ' ')} (${remainingUses(bot, i)} uses left)`);
  if (spareDue(bot)) options.spare_pickaxe = { description: `Make a stone pickaxe now, a spare: the pickaxes carried are nearly worn out (${worn.join(', ')}), and one that breaks deep in a mine leaves the bot digging out by hand at seven seconds a block.`, run: () => maintainPickaxe(bot, task, goal, save) };
  if (goal.kind === 'win' && woodDue(bot, goal)) options.wood_reserve = { description: `Cut a few logs now: ${Math.floor(woodUnits(bot) * 10) / 10} logs' worth of wood carried, and ${WOOD_RESERVE} make the sticks for a pickaxe and a crafting table wherever the bot is.`, run: () => gatherWood(bot, task, goal, save) };
  if (goal.kind === 'win' && blocksDue(bot, goal)) options.block_reserve = { description: `Gather building blocks now: ${blockStock(bot)} carried, and ${BLOCK_RESERVE} seal a pocket for the night or tower out of a hole.`, run: () => gatherBlocks(bot, task, goal, save) };
  const due = Object.keys(options);
  if (!due.length) return false;
  const keys = due.sort().join(',');
  if (goal.upkeepHold?.keys === keys && goal.upkeepHold.until > Date.now()) return false;
  if (!client) return options[due.includes('spare_pickaxe') ? 'spare_pickaxe' : due.includes('wood_reserve') ? 'wood_reserve' : due[0]].run();
  options.carry_on = { description: `Carry on with ${goal.step?.action ? `the ${String(goal.step.item || goal.step.block || goal.step.action).replaceAll('_', ' ')}` : 'the work'} and see to this later; asked again in five minutes.`,
    run: async () => { goal.upkeepHold = { keys, until: Date.now() + UPKEEP_HOLD_MS }; save(); } };
  const step = goal.step;
  let chosen = null;
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, run: async () => { chosen = k; await o.run(); } }]));
  try { await decideAction(bot, task, goal, save, client, onStep, tree, { situation: 'Something the bot keeps in its pockets is running short. Choose whether to see to it now or carry on with the work.' }, 'upkeep'); }
  finally { if (chosen === 'carry_on') goal.step = step; }
  return chosen !== null && chosen !== 'carry_on';
}

async function prepareExpeditionStep(bot, task, goal, save) {
  goal.preparingExpedition = true;
  // The reserve is the survival layer's to gather; once its search has been
  // set aside as fruitless, the prep goes on with what is carried rather
  // than waiting on a hunt nobody is making.
  const reservePaused = isSetAside(goal, 'food_search', 'stock');
  // Not for the game ladder: it stocks food at the Nether crossing itself
  // (food_reserve), and waiting here held trial 18's bot off every rung for
  // twenty minutes of a land with few animals (2026-09-24).
  if (goal.kind !== 'win' && bot.game.difficulty && bot.game.difficulty !== 'peaceful' && foodSupply(bot) < 12 && !reservePaused) {
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

// `what` says what was awaited, for the record: sixteen bare "timed out
// waiting for world/inventory update" in the first audited day said nothing
// about which item, how many were wanted, or how many had come.
async function waitFor(task, predicate, timeout = 4000, what = null) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate()) return; await sleep(100); }
  let detail = '';
  try { detail = what ? `: ${what()}` : ''; } catch (_) { /* best effort */ }
  throw new Error(`Timed out waiting for world/inventory update${detail}`);
}
const awaitedItem = (bot, item, want, context) => () => `${item.replaceAll('_', ' ')} after ${context} (have ${countOf(bot, item)} of ${want}, ${bot.inventory.emptySlotCount?.() ?? '?'} free slots${bot.inventory.selectedItem ? `, cursor ${bot.inventory.selectedItem.name}` : ''})`;

// Digging the block underfoot is a one-block drop when the block beneath it
// is solid and harmless: the way a player takes an ore they are standing on
// in a shaft with no side to step to. Anything deeper or molten is not.
function safeDropBelow(bot, p) {
  const under = bot.blockAt(p.offset(0, -1, 0));
  return under?.boundingBox === 'block' && !['lava', 'magma_block', 'cactus', 'fire'].includes(under.name) &&
    !['sand', 'gravel'].includes(under.name);
}

// A floor block beside the feet with open air under it is a pit once it is
// dug, and the next step goes into it: trial 4 took a coal ore out of the
// floor it was standing by, the cave below it was ten blocks deep and
// floored with dripstone, and the fall killed it (2026-09-24). A player
// does not open a hole they have not looked into; the ore is left.
function opensPit(bot, p) {
  const here = bot.entity.position, feetY = Math.floor(here.y);
  if (p.y >= feetY || p.y < feetY - 2) return false;
  if (Math.hypot(p.x + 0.5 - here.x, p.z + 0.5 - here.z) > 2.5) return false;
  const under = bot.blockAt(p.offset(0, -1, 0)), deeper = bot.blockAt(p.offset(0, -2, 0));
  return !!under && under.boundingBox !== 'block' && (!deeper || deeper.boundingBox !== 'block');
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
  if (opensPit(bot, p)) throw new Error('Refusing to open a drop beside the feet');
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
  await move(bot, task, { label: 'step_back', keys: ['back'], sneak: true, look: p.offset(0.5, 1, 0.5), maxMs: 700, tick: 50,
    until: () => !hitboxIntrudes(bot, p) });
}

// Mineflayer yaw for looking toward each horizontal facing (0 is north, -z).
const PLACEMENT_YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };
async function place(bot, task, p, material, { face, properties, stay = false } = {}) {
  task.check();
  const cell = { ...p, material, properties };
  if (buildCellComplete(bot, cell)) return;
  // Walling in on a ledge: a cell that needs the bot to step aside, back
  // off or walk closer is left, never moved for. Sealing on a Nether ledge
  // with a piglin about, the dream run stepped back off it into the lava
  // sea twenty blocks down (2026-09-23, the first death without the restore).
  if (stay) {
    const feet = bot.entity.position.floored();
    if (hitboxIntrudes(bot, p) || (feet.x === p.x && feet.z === p.z && Math.abs(feet.y - p.y) <= 1) ||
      bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.5) throw new Error(`Placing at ${p} would move me off this ledge`);
  }
  if (isDoor(material) && !air(bot.blockAt(p.offset(0, 1, 0)))) throw new Error(`A door needs room for its top half at ${p}`);
  // Ground cover is replaced by a placed block, the way the game does it:
  // leaf litter on the chest cell held up the whole base.
  if (!air(bot.blockAt(p)) && !['water', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'leaf_litter', 'dead_bush', 'seagrass', 'vine'].includes(bot.blockAt(p)?.name)) {
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
      // A stair or door takes its facing from the way the player looks, and
      // looking at the click point from a diagonal rounded a west stair to
      // south: the build then waited on a block that could never match. Face
      // the wanted direction exactly and click without turning again.
      const facingYaw = PLACEMENT_YAW[properties?.facing];
      if (facingYaw !== undefined) {
        const target = face?.to || ref.position.offset(0.5, 0.5, 0.5), eyes = bot.entity.position.offset(0, 1.62, 0);
        await bot.look(facingYaw, Math.atan2(target.y - eyes.y, Math.hypot(target.x - eyes.x, target.z - eyes.z)), true);
        // The turn reaches the server with the next movement packet, but the
        // click goes at once: a stair placed straight after walking took the
        // walking direction. Let the turn go out first.
        await bot.waitForTicks(2);
      }
      const look = facingYaw !== undefined ? { forceLook: 'ignore' } : {};
      if (face?.to) await bot._placeBlockWithOptions(ref, f.scaled(-1), { delta: face.to.minus(ref.position), swingArm: 'right', ...look });
      else if (facingYaw !== undefined) await bot._placeBlockWithOptions(ref, f.scaled(-1), { swingArm: 'right', ...look });
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

// A turned search (see persist) keeps only its heading, so the origin is
// filled in here whenever it is missing: without one, every search for food
// after a persist threw on it, and the persist that followed turned it again.
function searchFor(goal, resource, here) {
  goal.search ||= {};
  const search = goal.search[resource] ||= { attempts: 0 };
  search.origin ||= { x: here.x, y: here.y, z: here.z };
  return search;
}

// A staircase set aside takes its ore with it. The mining step chose the
// same ore again and again and never checked the set-aside list: the replay
// run persisted nineteen times at "the staircase toward (-625, 28, 308) is
// set aside". The ore, and what is within four blocks of it, rests twenty
// minutes, and the step returns for the next choice.
// Stairs are taken several at a time, not one between searches: trial 8
// dug one stair, searched every candidate again (seconds each time), chose
// another ore thirty blocks off, and dug the next stair, flipping between
// the two steps a dozen times a minute (2026-09-24). Six stairs, or until
// the target is close or a stair gets nowhere.
const STAIRS_AT_A_TIME = 6;
async function tunnelOrSetAside(bot, task, goal, save, target, resource, ore = null) {
  try {
    for (let i = 0; i < STAIRS_AT_A_TIME; i++) {
      const before = bot.entity.position.clone();
      // A later stair that fails ends the run for now; the next call meets
      // it afresh. Only the first stair's failure is this call's.
      try { await resourceTunnelStep(bot, task, goal, save, target, resource, { dig, navigate }); }
      catch (err) { if (i === 0 || ['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; break; }
      task.check();
      if (bot.entity.position.distanceTo(target) <= 4 || bot.entity.position.distanceTo(before) < 0.5) break;
    }
  }
  catch (err) {
    if (err.name !== 'StaircaseStalled') throw err;
    const at = ore || target;
    setAside(goal, 'reach', at, err.message, 1200000);
    const names = [bot.blockAt(at)?.name].filter(Boolean);
    if (names.length) for (const p of find(bot, names, 72, 32)) if (p.distanceTo(at) <= 4) setAside(goal, 'reach', p, 'beside a staircase set aside', 1200000);
    save();
  }
}

// Leaving where the bot stands is always allowed: walled in on every side
// (last night's pocket in the rock), a doorway two high is dug toward where
// it is going, and the search surveys from outside. Trial 16 sat seven
// minutes in its sealed pocket with an iron pickaxe, every search failing
// for want of walkable ground, rung after rung set aside (2026-09-24).
async function breakOut(bot, task, toward) {
  const feet = bot.entity.position.floored();
  const open = d => [0, 1].every(dy => dryPassable(bot.blockAt(feet.plus(d).offset(0, dy, 0))));
  const sides = faces.slice(1, 5);
  if (sides.some(open)) return false;
  const aim = toward ? new Vec3(toward.x - feet.x, 0, toward.z - feet.z) : new Vec3(1, 0, 0);
  const order = [...sides].sort((a, b) => b.dot(aim) - a.dot(aim));
  for (const d of order) {
    const cells = [0, 1].map(dy => feet.plus(d).offset(0, dy, 0));
    const floor = bot.blockAt(feet.plus(d).offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /lava|water/.test(floor.name)) continue;
    if (cells.some(c => !air(bot.blockAt(c)) && (!bot.blockAt(c)?.diggable || !safeExcavation(bot, c)))) continue;
    for (const c of cells) if (!air(bot.blockAt(c))) await dig(bot, task, c, { requireDrops: false });
    await navigate(bot, task, new goals.GoalBlock(cells[0].x, cells[0].y, cells[0].z), { timeoutMs: 5000, stallMs: 2500 });
    return true;
  }
  return false;
}

async function explore(bot, task, goal, save, resource, { surfaceOnly = isSurfaceResource(resource), frontier = surfaceOnly } = {}) {
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceStep(bot, task, goal, save);
    return;
  }
  const surface = surfaceOnly ? surfaceMovement(bot) : null;
  try {
    const search = searchFor(goal, resource, bot.entity.position.floored());
    const stalledSurface = search.walksWithoutProgress >= 3;
    if (search.attempts >= 128) throw new Blocked(`Could not find reachable ${resource} after 128 exploration steps without collecting it`);
    search.attempts++;
    search.leg ||= 0;
    const angle = (search.leg % 8) * Math.PI / 4;
    const radius = 24 * (1 + Math.floor(search.leg / 8));
    let target = pos(search.origin).offset(Math.round(Math.cos(angle) * radius), 0, Math.round(Math.sin(angle) * radius));
    if (frontier) target = explorationTarget(search, resource, bot.entity.position);
    // Any wood is wood: a search for oak walked a hundred and twenty-eight
    // legs past spruce and birch in trial 9 and reached dusk with no tools
    // (2026-09-24). The log step takes whatever wood is in view (logInView).
    const resourceNames = LOG.test(resource) ? Object.keys(bot.registry.blocksByName).filter(n => LOG.test(n))
      : [...new Set([...Object.entries(MINEABLE).filter(([name, data]) => name === resource || data.drops === resource).map(([name]) => name),
      ...(bot.registry.blocksByName[resource] ? [resource] : []), ...sourceBlocks(bot.registry, resource)])];
    const observed = [...new Map([...find(bot, resourceNames, 128, 8), ...knownResourceLocations(bot, goal, resourceNames)]
      .map(p => [`${p}`, p])).values()].filter(p => !reservedForConstruction(goal, p) && safeFromHostiles(bot, p) &&
      !isSetAside(goal, 'reach', p) && (!surface || !bot.blockAt(p) || surface.isSurface(p)))
      .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    // Cobwebs (string) hang in mineshafts: with none in view, a remembered
    // mineshaft is where to look, and the walk or the tunnel down to it is
    // what brings them into view.
    if (!observed.length && resourceNames.includes('cobweb') && !surfaceOnly) {
      const { knownLandmarks } = require('./exploration');
      const shaft = knownLandmarks(bot, goal, 'mineshaft', 256).map(k => k.landmark).find(l => !isSetAside(goal, 'reach', new Vec3(l.x, l.y, l.z)));
      if (shaft) observed.push(new Vec3(shaft.x, shaft.y, shaft.z));
    }
    if (observed.length) {
      target = observed[0];
      search.observedTarget = { ...target };
    }
    if (surfaceOnly && await boatTravelStep(bot, task, goal, save, target, { acquireStep })) return;
    // Nothing but sea and islets about: swim for the land remembered, or for
    // the resource itself when one is remembered across the water (the live
    // run's search kept "seeing" oak logs it could not reach from its bar).
    // Before the survey, which found the next islet a hop away and would
    // walk between them.
    if (surfaceOnly && await require('./shore').crossSea(bot, task, goal, save,
      { toward: observed.length ? { x: target.x, z: target.z, key: `${resource}:${target}`, biome: resource.replace(/_/g, ' ') } : null })) return;
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
      await tunnelOrSetAside(bot, task, goal, save, surface, resource, target);
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
    if (!destination && !surfaceOnly && await breakOut(bot, task, target)) return;
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
    return safeFromHostiles(bot, p) && !isSetAside(goal, 'reach', p);
  });
}

// Work the nearest block of a source Jev chose. A source that cannot be
// reached is set aside whole, so the next step looks at a different tree.
async function workSource(bot, task, step, goal, save, source) {
  const p = nearestRemaining(bot, source);
  if (!p) throw new Error(`The ${source.block} source is no longer there`);
  goal.step = step; rememberSource(goal, source, step); save();
  try {
    const before = countOf(bot, step.drops);
    await mine(bot, task, step, goal, save, p);
    // Finish the source. The planner asks for exactly what a step needs,
    // and the dream run walked to a fresh tree for every smelt's fuel; the
    // second run climbed a hill for one iron of a vein, went back to its
    // shaft, and climbed again fourteen times. The rest of a trunk or a
    // vein already reached is a few seconds' work: keep at it while blocks
    // remain within six and the step is still short (a trunk: up to eight logs).
    if (bot.game?.gameMode !== 'creative') {
      // An ore vein is taken whole, up to a stack: the step asked for two
      // iron and eleven stood in the wall, eight of them behind the three
      // in view when the source was chosen. The stash keeps the surplus.
      const ore = /_ore$/.test(source.block) || source.block === 'ancient_debris';
      // Stone is taken by the couple of dozen while the face is at hand: the
      // first trials remade their kit after a death three cobblestone at a
      // time, climbing to the surface for a log between each (2026-09-24),
      // when the pickaxe, sword, axe and furnace want two dozen between them.
      const rock = /^(cobblestone|cobbled_deepslate)$/.test(step.drops);
      const wanted = () => /_log$/.test(source.block) ? countOf(bot, step.drops) < 8 : ore ? countOf(bot, step.drops) < 32
        : rock ? countOf(bot, step.drops) < Math.max(24, before + (step.count || 1)) : countOf(bot, step.drops) < before + (step.count || 1);
      // Once the step has what it asked for, more of the same is Jev's call,
      // asked once for this source: the cap and what is carried are said.
      const cap = /_log$/.test(source.block) ? 8 : ore ? 32 : rock ? Math.max(24, before + (step.count || 1)) : before + (step.count || 1);
      let askedMore = false;
      for (let extra = 0; extra < 24 && wanted(); extra++) {
        if (!askedMore && countOf(bot, step.drops) >= before + (step.count || 1)) {
          askedMore = true;
          if (!await moreOfSource(bot, task, goal, save, step, source, cap)) break;
        }
        let next = nearestRemaining(bot, source);
        if ((!next || next.distanceTo(bot.entity.position) > 6) && ore) {
          const here = bot.entity.position;
          next = (await miningCandidates(bot, task, step, goal)).filter(p => p.distanceTo(here) <= 6).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0] || null;
        }
        // Rock is looked for within reach only. The full candidate search
        // over forty-eight blocks of stone, each block tried for an open face,
        // took minutes underground and was run again for every block: trial
        // 15's bot sat thirteen minutes at 93% of a core and lost its
        // connection (2026-09-24).
        if ((!next || next.distanceTo(bot.entity.position) > 6) && rock) {
          const here = bot.entity.position, feet = here.floored();
          next = find(bot, step.sources || [step.block], 6, 24)
            .filter(p => !p.equals(feet.offset(0, -1, 0)) && !reservedForConstruction(goal, p) && !isSetAside(goal, 'reach', p) &&
              faces.some(f => air(bot.blockAt(p.plus(f)))))
            .sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0] || null;
        }
        if (!next || next.distanceTo(bot.entity.position) > 6) break;
        task.check(); checkAir(bot);
        try { await mine(bot, task, step, goal, save, next); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; break; }
      }
    }
  }
  catch (err) {
    // A missing or worn-out tool is the bot's problem, not the vein's: the
    // tree or the ore is still there once a tool is in hand, and setting it
    // aside sent the bot looking for another after the pickaxe was made.
    const toolProblem = /Missing harvest tool|^Need .* to collect|Need .*tool|requires? a .*(pickaxe|axe|shovel|tool)|durability/i.test(err.message);
    if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name) && !toolProblem) { setAsideSource(goal, source); delete goal.workingSource; save(); }
    throw err;
  }
}

// Keep working the source Jev already chose. Recorded as a decision so the
// trail and the flight recording show the step, marked as needing no question.
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
  for (const p of nearby) setAside(goal, 'reach', p, 'set aside with the rest of this area', 120000);
  // The marker shows in the step log during the walk and is taken down
  // after it: left in place, the work loop had no step to run and spun on it
  // for eighty-four seconds (trial 23).
  const marker = { action: 'move_on', resource: step.drops || step.block, setAside: nearby.length };
  goal.step = marker; save();
  bot.chat?.(`I can't get at the ${String(step.block).replaceAll('_', ' ')} here. I'll look somewhere else.`);
  try { await explore(bot, task, goal, save, step.block); }
  finally { if (goal.step === marker) { goal.step = step; save(); } }
  return true;
}

// Any wood will do for a log step, when the species asked for is not in
// view and another is: the dream run circled a forest and an island full of
// oak and spruce looking for acacia (the user, 2026-09-24). Planks, sticks,
// tables and fuel take any wood, and the next step plans from the pockets.
const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
function logInView(bot, step) {
  if (!LOG.test(step.block || '') || typeof bot.findBlocks !== 'function') return step;
  if (find(bot, [step.block], 32, 1).length) return step;
  const names = Object.keys(bot.registry?.blocksByName || {}).filter(n => LOG.test(n) && n !== step.block);
  const other = find(bot, names, 32, 1)[0];
  const name = other && bot.blockAt(other)?.name;
  if (!name) return step;
  return { ...step, block: name, sources: [name], drops: name, produces: { [name]: step.count || 1 }, insteadOf: step.block };
}

// More of a source than the step asked for: the rest of a trunk (up to
// eight logs), of a vein (up to a stack of thirty-two), or two dozen stone
// from a face at hand. The dream run walked to a fresh tree for every
// smelt's fuel and climbed a hill fourteen times for one iron at a time; a
// source already reached is a few seconds' work. Without Jev, taken.
async function moreOfSource(bot, task, goal, save, step, source, cap) {
  const client = task.opportunityClient;
  if (!client) return true;
  const what = String(step.drops || step.block).replaceAll('_', ' ');
  const tree = {
    take_more: { description: `Keep taking the ${String(source.block).replaceAll('_', ' ')} within reach until ${cap} ${what} are carried (${countOf(bot, step.drops)} now): a few seconds a block while it is at hand, where coming back later is a walk.` },
    enough: { description: `Stop at what the step asked for (${step.count || 1} ${what}) and go on.` },
  };
  try {
    const decision = await decide('gather_more', { client, bot, task, goal, save, tree, context: {},
      state: { step: { action: step.action, item: step.drops || step.block, asked: step.count || 1 }, carried: countOf(bot, step.drops), cap, request: goal.request, rung: goal.rungTime?.phase || null } });
    return decision.stale || decision.path.at(-1) !== 'enough';
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return true; }
}

async function mine(bot, task, step, goal, save, selected) {
  // Not for a request that named its wood (a spruce build wants spruce).
  if (goal?.kind === 'win' || !goal?.item) step = logInView(bot, step);
  if (step.insteadOf && goal) { goal.step = step; save(); }
  const surfaceOnly = isSurfaceResource(step.block);
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceStep(bot, task, goal, save); return;
  }
  // Mining with no slot for the drop digs ore for the ground to keep.
  if (step.drops && bot.game?.gameMode !== 'creative' && !roomFor(bot, step.drops)) {
    if (!await makeRoom(bot, task, step.drops, { keep: new Set([goal.item, step.item].filter(Boolean)) })) throw new Error(`No room in my pockets for ${step.drops.replaceAll('_', ' ')}`);
  }
  const surface = surfaceOnly ? surfaceMovement(bot) : null;
  try {
    const before = countOf(bot, step.drops);
    await mineAtSource(bot, task, step, goal, save, selected);
    if (countOf(bot, step.drops) > before) await opportunisticMining(bot, task, goal, save, step, { navigate, dig });
    // The pickup pass runs whether or not the dig's own collection worked:
    // that is exactly when a raw iron is lying a block away uncollected.
    await opportunisticPickups(bot, task, goal, save, step, { navigate });
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
      const ore = find(bot, names, 64, 16).find(p => safeFromHostiles(bot, p) && !isSetAside(goal, 'reach', p));
      const target = ore || bot.entity.position.floored().offset(24, step.depth - bot.entity.position.floored().y, 0);
      await tunnelOrSetAside(bot, task, goal, save, target, step.block, ore);
    } else await explore(bot, task, goal, save, step.block);
    return;
  }
  // Nearest first, and on through the vein: one block per call sent the
  // bot off to re-plan and walk after every ore. An ore is worked until the
  // step is met, or to a stack for ore, as long as the next block is close.
  const here0 = bot.entity.position.clone();
  candidates.sort((a, b) => a.distanceTo(here0) - b.distanceTo(here0));
  const ore = /_ore$/.test(step.block || '') || step.block === 'ancient_debris';
  const startCount = countOf(bot, step.drops);
  const satisfied = () => ore ? countOf(bot, step.drops) >= Math.max(startCount + (step.count || 1), 32) || countOf(bot, step.drops) >= 32 : countOf(bot, step.drops) >= startCount + (step.count || 1);
  // The pool is re-read as the vein opens up: the blocks behind the first
  // three are not in the list until the first three are gone. Ten blocks
  // from where the bot stands is the leash; three rescans the budget.
  // Three blocks in a row that could not be had from here: the next are
  // the same kind of problem, and trying them one by one stood trial 8's bot
  // still for half a minute at the foot of its stairs, a new coal target a
  // second (2026-09-24). Move instead.
  let mined = 0, rescans = 0, missed = 0, pool = candidates.slice(0, 24);
  while (true) {
    task.check(); checkAir(bot);
    if (mined && satisfied()) return;
    if (!mined && missed >= 3) break;
    let p = pool.shift();
    while (p && mined && p.distanceTo(bot.entity.position) > 10) p = pool.shift();
    if (!p) {
      if (!ore || !mined || rescans++ >= 3) break;
      const here = bot.entity.position.clone();
      pool = (await miningCandidates(bot, task, step, goal)).filter(q => q.distanceTo(here) <= 10).sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
      if (!pool.length) break;
      continue;
    }
    const before = countOf(bot, step.drops);
    let access;
    // Where the step is going, for the record: the day audit saw the mine
    // step walk twelve blocks up its own staircase and could not say toward
    // which block.
    if (goal?.step?.action === 'mine') { goal.step.target = { x: p.x, y: p.y, z: p.z }; goal.step.from = { ...bot.entity.position.floored() }; }
    try {
      await approachDryMining(bot, task, p, { navigate, dig });
      access = miningMovement(bot);
      await dig(bot, task, p, { done: () => countOf(bot, step.drops) > before, requiredTool: step.tool, enchantment: step.enchantment,
        minimumToolDurability: step.minimumToolDurability });
      access.restore(); access = undefined;
      if (await collectNearbyDrops(bot, task, step.drops, { before, origin: p, radius: 8, waitForSpawnMs: 1000, allowExcavation: true })) { mined++; if (!ore || satisfied()) return; continue; }
    } catch (e) {
      task.check();
      // Running out of air at a block says something about the block. A
      // zombie walking up says nothing about it, and set the block aside
      // for two minutes all the same.
      if (e.name === 'NeedsAir') { setAside(goal, 'reach', p, 'ran out of air there', 120000); save(); throw e; }
      if (e.name === 'NeedsSafety') throw e;
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
    setAside(goal, 'reach', p, goal.lastMiningError || 'dug nothing there', 120000);
    missed++;
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
  // Out of the water first. A furnace placed from a flooded pit at the base
  // could not be reached from where the bot floated, nor the table after
  // it: "I can't reach the furnace I placed", again and again.
  if (inWater(bot) && !bot.entity.isInLava) {
    const exit = lavaExit(bot);
    if (exit) { try { await navigate(bot, task, new goals.GoalBlock(exit.x, exit.y, exit.z), { timeoutMs: 8000, stallMs: 3000 }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; } }
  }
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
  // Walled in (the bottom of a one-block shaft): a notch is cut in the wall
  // at foot or head height and the station goes in it, as a player would.
  // Trial 4 looked for an open cell six times over at the foot of its own
  // shaft, which had none (2026-09-24).
  if (!p) {
    const notch = [0, 1].flatMap(dy => faces.slice(1, 5).map(d => o.plus(d).offset(0, dy, 0))).find(q => {
      const b = bot.blockAt(q);
      return b?.boundingBox === 'block' && b.diggable && !reservedForConstruction(goal, q) && bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block' &&
        !faces.some(f => /lava|water/.test(bot.blockAt(q.plus(f))?.name || ''));
    });
    if (notch) {
      await dig(bot, task, notch, { requireDrops: false });
      await place(bot, task, notch, name); p = notch;
      rememberWorkstation(bot, goal, name, notch);
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
  await settleCraftInventory(bot, task);
  const table = step.needs_table ? await workstation(bot, task, 'crafting_table', goal) : null;
  const id = bot.registry.itemsByName[step.item]?.id;
  const recipe = step.recipe ? new (require('prismarine-recipe')(bot.registry).Recipe)({ result: { id, count: step.recipe.count },
    ...(step.recipe.shape ? { inShape: step.recipe.shape.map(row => row.map(name => name ? bot.registry.itemsByName[name].id : null)) } :
      { ingredients: step.recipe.ingredients.map(name => bot.registry.itemsByName[name].id) }) }) : bot.recipesFor(id, null, step.count, table)[0];
  if (!recipe) throw new Error(`No usable recipe for ${step.count} ${step.item}`);
  // Room for what is made, junk first, the recipe's own ingredients kept:
  // with the pockets full the crafted item had nowhere to go, and the craft
  // drill made one pickaxe in 150 seconds against eight in nine (the day
  // audit's sixteen "timed out waiting for world/inventory update").
  if (!roomFor(bot, step.item)) await makeRoom(bot, task, step.item, { keep: new Set(Object.keys(step.consumes || {})), away: table?.position });
  const before = countOf(bot, step.item);
  task.check();
  // Reconcile the cursor/grid between recipes while keeping a shared batch at
  // the same bench. Server-confirmed output, not planned amounts, is progress.
  const batches = Math.min(Math.ceil(step.count / recipe.result.count),
    Math.max(1, Math.floor((bot.registry.itemsByName[step.item].stackSize || 64) / recipe.result.count)));
  for (let n = 0; n < batches; n++) {
    task.check();
    const made = () => countOf(bot, step.item) >= before + recipe.result.count * (n + 1);
    try { await bot.craft(recipe, 1, table); }
    finally { task.check(); await settleCraftInventory(bot, task); }
    // A craft whose ingredients were left on the cursor made nothing (both
    // runs, every ten minutes or so: "cursor oak_planks"). Settled, it is
    // clicked once more here rather than failing the whole step.
    try { await waitFor(task, made, 4000); }
    catch (err) {
      task.check();
      try { await bot.craft(recipe, 1, table); }
      finally { task.check(); await settleCraftInventory(bot, task); }
      await waitFor(task, made, 4000, awaitedItem(bot, step.item, before + recipe.result.count * (n + 1), `crafting${table ? ' at a table' : ''}, twice`));
    }
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

// A saved furnace batch belongs to the dimension its furnace is in. One in
// another dimension is parked and brought back when the bot is there again:
// throwing on it made every acquire step in the Nether fail, because each
// one finishes the saved batch first.
function localBatch(bot, goal, save = () => {}) {
  if (!goal) return null;
  const here = dimension(bot);
  if (goal.smelting?.dimension && goal.smelting.dimension !== here) {
    (goal.smeltingElsewhere ||= {})[goal.smelting.dimension] = goal.smelting; delete goal.smelting; save();
  }
  if (!goal.smelting && goal.smeltingElsewhere?.[here]) { goal.smelting = goal.smeltingElsewhere[here]; delete goal.smeltingElsewhere[here]; save(); }
  return goal.smelting || null;
}

// Not copper (see survival.js NIGHT_ORES).
const WAIT_ORES = ['coal_ore', 'iron_ore', 'gold_ore', 'lapis_ore', 'redstone_ore', 'diamond_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_lapis_ore', 'deepslate_redstone_ore', 'deepslate_diamond_ore'];
// While a batch cooks: dig what is in arm's reach, walk to an ore or a tree
// nearby, dig the stone around, or stand by the furnace. Asked once a batch
// of Jev; null (no Jev, or nothing to weigh) keeps the order in smelt.
async function whileCooking(bot, task, goal, save, { cooking, oreInReach, walkTarget, what, count }) {
  const client = task.opportunityClient;
  if (!client || cooking < 20000) return null;
  const seconds = Math.round(cooking / 1000);
  const tree = {};
  const near = oreInReach();
  if (near) tree.dig_in_reach = { description: `Dig the ${String(bot.blockAt(near)?.name || 'ore').replaceAll('_', ' ')} within arm's reach of the furnace, and any more there.` };
  const far = cooking >= 30000 && walkTarget();
  if (far) tree.mine_nearby = { description: `Walk to the ${String(bot.blockAt(far)?.name || 'block').replaceAll('_', ' ')} ${Math.round(far.distanceTo(bot.entity.position))} blocks off and dig it and the next nearest, back before the batch is done.` };
  if (countOf(bot, 'cobblestone') < 64) tree.dig_stone = { description: `Dig the stone around the furnace (${countOf(bot, 'cobblestone')} cobblestone carried): tools, a furnace and walls want it.` };
  tree.wait_here = { description: `Stand by the furnace for the ${seconds} seconds the ${count} ${what} take. The furnace cooks on its own whether or not the bot stands by it; standing gains nothing meanwhile.` };
  if (Object.keys(tree).length < 2) return null;
  try {
    const decision = await decide('while_cooking', { client, bot, task, goal, save, tree, state: { cooking: `${count} ${what}`, seconds, inventoryFreeSlots: bot.inventory.emptySlotCount?.() ?? null, timeOfDay: bot.time?.timeOfDay } });
    if (decision.stale || decision.fallback) return null;
    return decision.path.at(-1);
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return null; }
}

async function smelt(bot, task, step, goal, save = () => {}) {
  task.check();
  const pending = localBatch(bot, goal, save);
  const plannedFuel = pending?.fuelItem || step.fuelItem || 'oak_planks';
  if (!isFuel(plannedFuel)) throw new Blocked(`I can't use ${plannedFuel.replaceAll('_', ' ')} as furnace fuel`);
  // A different batch already in a furnace is finished first, not refused:
  // "finish the saved batch" as a Blocked error had no way to be resolved
  // but to retry into the same refusal.
  if (pending && (pending.item !== step.item || pending.from !== step.from)) {
    await smelt(bot, task, { item: pending.item, from: pending.from, fuelItem: pending.fuelItem, count: pending.count }, goal, save);
    return;
  }
  if (pending && countOf(bot, step.item) >= pending.targetInventory) { delete goal.smelting; save(); return; }
  let block;
  if (pending) {
    const p = pos(pending.position);
    // Return to the recorded area before deciding that an unloaded furnace
    // disappeared. Once observed, the same visible-face checks apply.
    if (!bot.blockAt(p)) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3));
    // Gone (a creeper, a player): the batch went with it. Retrying cannot
    // bring a furnace back, and with the record kept every later step
    // tried this one first and the bot shook itself loose every forty
    // seconds for good. Let the record go and plan the smelt again.
    if (bot.blockAt(p)?.name !== 'furnace') {
      goal.lostSmelting = { ...pending, at: new Date().toISOString() }; delete goal.smelting; save();
      throw new Error('The furnace holding our saved batch is gone; starting the batch again');
    }
    // Never switch furnaces while the saved ingredients/output belong to this one.
    block = await approachWorkstation(bot, task, 'furnace', [p]);
    // A furnace that stays out of reach costs the batch, not the run: the
    // dream run retried an unreachable one-beef batch for good.
    // Twice, like any failure (persist leaves a rung that failed twice):
    // at three, trial 10's bucket rung was left first and the batch kept.
    if (!block && (pending.unreachable = (pending.unreachable || 0) + 1) >= 2) {
      goal.lostSmelting = { ...pending, at: new Date().toISOString() }; delete goal.smelting; save();
      throw new Error('The furnace holding our saved batch stayed out of reach; starting the batch again');
    }
    if (!block) { save(); throw new Blocked("I can't reach the furnace holding our saved batch"); }
    delete pending.unreachable;
  } else block = await workstation(bot, task, 'furnace', goal);
  const before = countOf(bot, step.item);
  // A new batch is only as large as the raw input carried: a smelt of four
  // gold with one raw gold in hand left the batch in that furnace while the
  // bot dug for the rest, and the way back to it failed (the day audit's six
  // minutes on four ingots). The planner gathers the rest and smelts it as a
  // batch of its own, at whatever furnace is nearest then.
  const carriedInput = countOf(bot, step.from);
  const needed = Math.min(pending ? pending.targetInventory - before : (carriedInput > 0 ? Math.min(step.count, carriedInput) : step.count), 64);
  if (goal && !pending) {
    goal.smelting = { item: step.item, from: step.from, fuelItem: plannedFuel, position: { ...block.position }, dimension: dimension(bot), targetInventory: before + needed, count: needed };
    save();
  }
  // The same for the furnace's output, before the window opens.
  const keepForSmelt = new Set([step.from, plannedFuel]);
  if (!roomFor(bot, step.item)) await makeRoom(bot, task, step.item, { keep: keepForSmelt, away: block.position });
  let furnace = await bot.openFurnace(block);
  // While a container is open Mineflayer updates that window's player slots;
  // bot.inventory can still contain the pre-transfer counts until it closes.
  const carried = name => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart)
    ? furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(i => i?.name === name).reduce((n, i) => n + i.count, 0)
    : countOf(bot, name);
  let taken = 0, supplies, emptyBatch = false;
  // Room is checked again at the moment of taking: the slot made before the
  // window opened was filled by dirt from the furnace's own footing, then by
  // ore dug while waiting, and the ingots sat in the furnace until the wait
  // timed out ("have 0 of 4, 0 free slots", three times in a day audit).
  const free = () => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart)
    ? furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(i => !i).length
    : (bot.inventory.emptySlotCount?.() ?? 1);
  const roomInWindow = () => free() > 0 || (Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart) &&
    furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).some(i => i?.name === step.item && i.count < (i.stackSize || 64)));
  // Another batch's output is taken out first: it is the bot's own ingots
  // or food from an earlier smelt, and refusing the furnace over it held the
  // dream run at one furnace for half an hour ("Furnace contains a
  // different output", a hundred and sixty-six times).
  const clearOther = async () => {
    const other = furnace.outputItem();
    if (!other || other.name === step.item) return;
    if (!roomInWindow()) throw new Error('Furnace contains a different output and there is no room to take it');
    await furnace.takeOutput();
  };
  const collect = async () => {
    await clearOther();
    const output = furnace.outputItem();
    if (!output) return;
    if (output.name !== step.item) throw new Error('Furnace contains a different output');
    if (!roomInWindow()) {
      try { if (bot._syncWindow) await bot._syncWindow(furnace); } catch (_) { /* best effort */ }
      furnace.close();
      try { if (bot._syncWindow) await bot._syncWindow(bot.inventory); } catch (_) { /* best effort */ }
      await makeRoom(bot, task, step.item, { keep: keepForSmelt, away: block.position });
      furnace = await bot.openFurnace(block);
      if (!furnace.outputItem()) return;
    }
    const amount = output.count;
    await furnace.takeOutput();
    taken += amount;
  };
  try {
    await collect();
    if (taken < needed) {
      let existing = furnace.inputItem();
      // Another batch's input comes back out to the pockets the same way.
      if (existing && existing.name !== step.from && typeof furnace.takeInput === 'function' && roomInWindow()) { await furnace.takeInput(); existing = furnace.inputItem(); }
      if (existing && existing.name !== step.from) throw new Error('Furnace contains another input');
      const amount = needed - taken;
      const missingInput = Math.max(0, amount - (existing?.count || 0));
      // A saved batch with nothing in the furnace and nothing carried is
      // not a batch: finishing it meant getting the raw food all over again,
      // which the dream run tried for good ("no supported method for beef").
      if (missingInput > carried(step.from) && pending && !existing && !taken && !carried(step.from)) emptyBatch = true;
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
      // Ten seconds an item is time the bot stood beside the furnace (the
      // day audit's minute and a half): an ore within arm's reach is dug
      // meanwhile, from where it stands, the furnace shut and opened again.
      let waitDigs = 0;
      const oreInReach = () => find(bot, WAIT_ORES, 5, 12).find(p => miningReach(bot, bot.entity.position, p) && bot.canDigBlock?.(bot.blockAt(p)) &&
        !isSetAside(goal || {}, 'reach', p) && safeFromHostiles(bot, p));
      // Further off, walked to and back while a long batch cooks: an ore
      // within sixteen, else a log while fewer than sixteen are carried.
      // Twenty raw iron at the base is two hundred seconds, and the dream
      // run stood by its furnace for four minutes of them with nothing in
      // arm's reach (the user: "he's not doing anything").
      const LOGS = Object.keys(bot.registry.blocksByName).filter(n => /_log$/.test(n) && !/stripped/.test(n));
      const walkTarget = () => {
        const ok = p => !isSetAside(goal || {}, 'reach', p) && safeFromHostiles(bot, p);
        const ore = find(bot, WAIT_ORES, 16, 16).find(ok);
        if (ore) return ore;
        const logs = bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
        return logs < 16 ? find(bot, LOGS, 16, 16).filter(p => p.y <= bot.entity.position.y + 3).find(ok) : null;
      };
      const cooking = () => (needed - taken) * 10000;
      // What to do while it cooks is Jev's, asked once a batch; without Jev,
      // each in turn as below.
      const plan = await whileCooking(bot, task, goal, save, { cooking: cooking(), oreInReach, walkTarget, what: String(step.from || step.item).replace(/_/g, ' '), count: needed - taken });
      const allow = key => !plan || plan === key;
      while (taken < needed) {
        task.check();
        if (Date.now() > deadline) throw new Error(`Smelting ${step.item} timed out`);
        await collect();
        if (taken < needed) await fuel();
        // Only with a slot to spare: the dug ore takes one, the ingots another.
        const spare = taken < needed && Date.now() < deadline - 15000 && (needed - taken) >= 2 && free() >= 2;
        const ore = spare && allow('dig_in_reach') && waitDigs < 6 && oreInReach();
        if (ore) {
          waitDigs++;
          furnace.close();
          try { await dig(bot, task, ore, { requireDrops: false }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', ore, err.message, 120000); }
          furnace = await bot.openFurnace(block);
          continue;
        }
        let far = spare && allow('mine_nearby') && waitDigs < 12 && cooking() >= 30000 && walkTarget();
        if (far) {
          furnace.close();
          // Out once, and on from one block to the next nearest while the
          // batch has time left, then back once: back to the furnace after
          // every block read as the bot going round in circles (the user,
          // 2026-09-24).
          const back = Date.now() + cooking() - 10000;
          // Said, since the furnace cannot be seen: a bot walking off from
          // one looked lost (the user, 2026-09-24).
          const cookingWhat = String(step.from || step.item).replace(/_/g, ' ');
          bot.chat?.(`${needed - taken} ${cookingWhat} in the furnace, about ${Math.max(1, Math.round(cooking() / 60000))} minute${cooking() >= 90000 ? 's' : ''}. Mining the ${String(bot.blockAt(far)?.name || 'ore').replace(/_/g, ' ')} nearby meanwhile.`);
          for (let n = 0; far && n < 12 && Date.now() < back && free() >= 2; n++, far = walkTarget()) {
            waitDigs++;
            if (goal) { goal.step = { ...goal.step, whileCooking: { block: bot.blockAt(far)?.name, at: { x: far.x, y: far.y, z: far.z }, n } }; save(); }
            try {
              await navigate(bot, task, new goals.GoalGetToBlock(far.x, far.y, far.z), { timeoutMs: 15000, stallMs: 5000 });
              await dig(bot, task, far, { requireDrops: false });
            } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', far, err.message, 300000); }
          }
          try { await navigate(bot, task, new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3), { timeoutMs: 20000, stallMs: 6000 }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          furnace = await bot.openFurnace(block);
          continue;
        }
        // Nothing to walk to, or none of it reachable: the stone in arm's
        // reach, at the feet or above and never the furnace's own footing,
        // while the stack is short. Cooking time is not standing time: trial
        // 12 stood eighty seconds by thirty-two copper, the coal it named
        // out of reach (2026-09-24).
        const feet = bot.entity.position.floored();
        const rock = spare && allow('dig_stone') && waitDigs < 24 && countOf(bot, 'cobblestone') < 64 &&
          find(bot, ['stone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff'], 5, 24)
            .filter(q => q.y >= feet.y && !q.equals(block.position.offset(0, -1, 0)) && bot.canDigBlock?.(bot.blockAt(q)) && !isSetAside(goal || {}, 'reach', q))[0];
        if (rock) {
          waitDigs++;
          furnace.close();
          try { await dig(bot, task, rock, { requireDrops: false }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', rock, err.message, 120000); }
          furnace = await bot.openFurnace(block);
          continue;
        }
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
  if (emptyBatch) {
    goal.lostSmelting = { ...goal.smelting, at: new Date().toISOString(), reason: 'empty' }; delete goal.smelting; save();
    throw new Error('The saved batch has nothing left in the furnace; letting it go');
  }
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
  await waitFor(task, () => countOf(bot, step.item) >= before + needed, 4000, awaitedItem(bot, step.item, before + needed, 'smelting'));
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
  const dimension = bot.game?.dimension;
  const makePlan = nearby => Array.isArray(item) ? batchPlan(bot.registry, outputs, stock, { nearby, tools, equipment, dimension }).steps :
    planCatalog(bot.registry, item, count, stock, { nearby, tools, equipment, dimension });
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
  if (localBatch(bot, goal, save)) { await smelt(bot, task, goal.smelting, goal, save); return false; }
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
  if (localBatch(bot, goal, save)) { await smelt(bot, task, goal.smelting, goal, save); return false; }
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
  // An axe before the trees, when the pockets can make one without mining
  // anything: the logs came off with the diamond sword in hand, two of its
  // uses a log and no faster than a fist (the user, 2026-09-24).
  if (step.action === 'mine' && /_log$/.test(step.block || '') && (step.count || 1) >= 2 && item !== 'stone_axe' &&
      !bot.inventory.items().some(i => /_axe$/.test(i.name)) && bot.game?.gameMode !== 'creative' && !isSetAside(goal, 'axe', 'stone')) {
    let axePlan = null;
    try { axePlan = catalogPlan(bot, 'stone_axe', 1, available, goal); } catch (_) { axePlan = null; }
    if (axePlan?.length && axePlan.every(s => s.action === 'craft')) {
      try { await acquireStep(bot, task, 'stone_axe', 1, goal, save); return false; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'axe', 'stone', err.message, 600000); save(); }
    }
  }
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
  else if (step.action === 'creative_inventory') await takeCreativeItem(bot, task, step.item, step.count, { keep: wantedItems(goal) });
  else if (step.action === 'craft') await craft(bot, task, step, goal);
  else if (step.action === 'smelt') await smelt(bot, task, step, goal, save);
  else if (step.action === 'harden') await harden(bot, task, goal, save, step.item);
  else if (step.action === 'fill_bucket') await collectWater(bot, task, goal, save, { navigate, explore });
  else if (step.action === 'make_obsidian') await makeObsidian(bot, task, step, goal, save, { navigate, dig, approachDryMining, collectNearbyDrops, resourceTunnelStep, acquireStep });
  else if (step.action === 'hunt_mob') await prepareMobHunt(bot, task, step, goal, save, { acquireStep, explore, enterNether: netherStep, navigate, dig, returnOverworld: returnFromNether,
    // The fortress sweep keeps no worksite: the rejoin walked the bot back
    // to the ledge it had just left, every other tick.
    // 'approach' is a shaft dug at a mob rather than past one, so the
    // hostile-avoidance that a travelling shaft needs is off for it.
    tunnel: (b, t, g, sv, target, resource) => ['fortress', 'approach'].includes(resource)
      ? tunnelStep(b, t, g, sv, target, { dig, navigate, approach: resource === 'approach', strict: resource === 'approach' })
      : resourceTunnelStep(b, t, g, sv, target, resource, { dig, navigate }) });
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
    daylight: bot.time?.timeOfDay < DAY.DARK ? 'day' : bot.time?.timeOfDay < DAY.DAWN ? 'night' : 'dawn',
    nearbyThreats: Object.values(bot.entities || {}).filter(e => hostiles.has(e.name) && e.position.distanceTo(bot.entity.position) < 24)
      .map(e => ({ id: e.id, name: e.name, distance: Math.round(e.position.distanceTo(bot.entity.position)) })),
    recentFailures: attemptsFor(goal).of('option'),
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
      // Do not ask Jev to choose unsupported targets such as the trunk it
      // stands on or floating remnants with no currently feasible approach.
      const reachable = await reachableBlocks(bot, task, await miningCandidates(bot, task, step, goal), { limit: 16 });
      for (const source of resourceSources(bot, reachable, { failures: attemptsFor(goal).of('option'), resting: p => isSetAside(goal, 'reach', p) })) {
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
      const fresh = lowest.filter(p => !isSetAside(goal, 'option', `${air(bot.blockAt(pos(p))) ? 'place' : 'clear'}_${p.x}_${p.y}_${p.z}`));
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
  await decideAction(bot, task, goal, save, client, onStep, tree, {}, 'house_build_step');
  return !!goal.blueprint && verifyHouse(bot, goal.blueprint).ok;
}

// The work questions (decisions/work.js): which one is named by `id`.
async function decideAction(bot, task, goal, save, client, onStep, tree, context = {}, id = 'resource_source') {
  const observation = decisionObservation(bot, goal);
  const state = { ...observation, ...context };
  const fingerprint = () => decisionFingerprint(bot, { inventory: planningInventory, immediateThreat, needsAir });
  const initial = fingerprint();
  const decision = await decide(id, { client, bot, task, goal, save, tree, state, context: state, isFresh: () => fingerprint() === initial });
  onStep(goal);
  if (decision.stale) return false;
  try { await decision.action.run(); }
  catch (err) {
    task.check(); if (err.name === 'NeedsAir') throw err;
    setAside(goal, 'option', decision.path.at(-1), err, 120000);
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

// The candidate blocks a route reaches, for options Jev will be offered.
// The single-slice path search answered in forty milliseconds, so distant
// sources that could be reached came back "partial" and were left off. The
// search now runs in slices to its own time limit and a route must be
// found: accepting an unfinished search as well offered walled-off ore to
// Jev again. One budget for the survey, nearest first; a block not checked
// in it is left off. The two call sites had drifted apart (sixteen at 300
// ms, twelve at 200).
async function reachableBlocks(bot, task, candidates, { limit = 16, budgetMs = 3000, eachMs = 500 } = {}) {
  const reachable = [], deadline = Date.now() + budgetMs;
  for (const p of candidates.slice(0, limit)) {
    if (p.equals(supportCell(bot.entity.position))) continue;
    if (!bot.canDigBlock(bot.blockAt(p))) {
      if (Date.now() >= deadline) continue;
      const route = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalGetToBlock(p.x, p.y, p.z), Math.min(eachMs, deadline - Date.now()));
      if (route.status !== 'success') continue;
    }
    reachable.push(p);
  }
  return reachable;
}

async function executeDesignedBuildStep(bot, task, goal, save, client, onStep = () => {}) {
  if (goal.continueBuild && !goal.blueprint) {
    const entry = bot.buildRegistry?.find(goal.continueBuild.id);
    // Only the player can say what to do about a building the notes no
    // longer hold: parked, not retried every forty seconds for good.
    if (!entry?.blueprint) throw Object.assign(new Blocked('I cannot find that building in my notes any more. Ask me to build it again.'), { needsPlayer: true });
    goal.buildId = entry.id;
    goal.design = entry.design || goal.design;
    goal.blueprint = structuredClone(entry.blueprint);
    // Finishing owns nothing of the neighbours: their cells are theirs.
    goal.buildOwned = { ...goal.buildOwned };
    goal.step = { action: goal.continueBuild.mode === 'repair' ? 'repair_building' : 'finish_building', building: entry.name };
    save(); onStep(goal);
    bot.chat(goal.continueBuild.mode === 'repair' ? `I'll check ${entry.name} over and put back anything missing.`
      : `Picking ${entry.name} back up where I left it.`);
    return false;
  }
  if (!goal.design) {
    const mode = process.env.BUILD_DESIGNER || 'auto';
    if (!['auto', 'jev', 'openrouter'].includes(mode)) throw new Blocked('BUILD_DESIGNER must be auto, jev or openrouter');
    const fallback = !designerAvailable(bot, { mode });
    // A template cannot be drawn against an existing building, so an edit
    // without the custom designer came out as a separate building that then
    // took over the original's record. Say so and build it beside instead.
    if (fallback && goal.buildContinuation?.mode === 'edit') {
      const name = goal.buildContinuation.name || 'that building';
      goal.buildContinuation = { ...goal.buildContinuation, mode: 'fresh', placement: 'beside_target', editUnsupported: true };
      delete goal.buildId; save();
      bot.chat(`I can't change ${name} without the custom designer, so I'll build this beside it instead.`);
    }
    // Recheck saved geometry after a validator update, before paying for a
    // replacement or silently reducing the user's request to a house template.
    // A draft Jev rejected as not answering the request is valid geometry
    // too, so it must go back to the designer rather than through here.
    // A saved draft is validated again and then reviewed like any other. It
    // went straight in unreviewed whenever no review was on record, which is
    // exactly what an interrupted review left behind.
    let savedDraft = null;
    if (!fallback && goal.designDraft && goal.designReview?.accepted !== false) {
      try { savedDraft = { ...validateSchematic(goal.designDraft, bot.registry), backend: 'validated-saved-draft', createdAt: new Date().toISOString() }; delete goal.designFallbackReason; }
      catch (error) { goal.designError = error.message; }
    }
    if (!savedDraft && !fallback && (goal.designAttempts || 0) >= 4) throw new Blocked(`Building designer could not produce a usable plan after four attempts: ${goal.designError || 'request failed'}`);
    goal.step = { action: 'design_building' }; save(); onStep(goal);
    if (savedDraft) { /* reviewed below, no new drawing */ }
    else if (fallback) {
      if (!client) throw Object.assign(new Blocked('The building fallback needs a configured Jev connection'), { needsPlayer: true });
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
    // Held here until the review passes. On the goal straight away, a review
    // cut short (a stop, a mob, a dropped connection) left a design the next
    // step took as settled, and it was built unreviewed.
    let design = savedDraft;
    if (!design) try { design = fallback ? await designWithJev(bot, task, goal.request, client, goal.memoryContext) :
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
      // Kept as the draft while it is judged: a review cut short (a stop, a
      // mob) used to throw a paid design away, and cost an attempt too.
      delete goal.designReview; goal.designDraft = design.source; save();
      let review;
      try { review = await reviewDesign(client, { request: goal.request, design, memory: goal.memoryContext, editing }); }
      catch (err) { if (!savedDraft && ['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name)) goal.designAttempts--; save(); throw err; }
      task.check();
      goal.designReview = review;
      if (!review.accepted) {
        const summary = review.summary;
        goal.designError = `the design does not answer the request (Jev put the fit at ${Math.round(review.fits * 100)}%): it drew "${summary.name}", ${summary.size.width}x${summary.size.height}x${summary.size.depth} with ${summary.solidBlocks} blocks; redesign it to match the request in kind, scale and material`;
        goal.designDraft = design.source;
        (goal.designHistory ||= []).push({ at: new Date().toISOString(), attempt: goal.designAttempts, error: goal.designError, draft: goal.designDraft, review });
        goal.designHistory = goal.designHistory.slice(-4);
        save();
        const err = new Error(goal.designError);
        if (goal.designAttempts < 4) err.name = 'DesignRepair';
        throw err;
      }
    }
    goal.design = design;
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
    // Everything Jev built except the building being changed stays standing.
    const protect = registry?.claimed(dimensionName(bot), edited ? edited.id : goal.buildId);
    const here = bot.entity.position.floored();
    const proposed = !goal.buildAnchor && !at && schematic.site
      ? { x: here.x + schematic.site[0], y: here.y + schematic.site[1], z: here.z + schematic.site[2] } : null;
    goal.blueprint = selectSchematicSite(bot, schematic, { anchor: goal.buildAnchor, prefer: proposed, owned, protect, at, baseY: proposed?.y });
    if (!goal.blueprint && proposed) goal.blueprint = selectSchematicSite(bot, schematic, { owned, protect });
    // A dream's anchor is where the village would like the next part,
    // not where a player pointed. When nothing fits there, anywhere near will do.
    if (!goal.blueprint && goal.buildAnchor && goal.dream && !at) { delete goal.buildAnchor; goal.blueprint = selectSchematicSite(bot, schematic, { owned, protect }); }
    if (!goal.blueprint) {
      // Wandering off to find ground elsewhere is the wrong answer to a spot
      // the player chose: they asked for it there, so say it will not work.
      if (edited) throw new Blocked(`I cannot fit that change onto ${edited.name} where it stands. Ask me again and I will plan it differently.`);
      if (goal.buildAnchor) throw new Blocked('I cannot fit that building where you asked. Clear some space there, or ask me to build it somewhere else.');
      goal.step = { action: 'find_build_site', dimensions: schematic.source.size }; save();
      await explore(bot, task, goal, save, 'supported building site', { surfaceOnly: true });
      return false;
    }
    // The building being changed is Jev's own work, not player property:
    // without this the site-changed guard rejects its own walls. Only that
    // one: the neighbours are built around, and owned they were stripped as
    // scaffolding when the new part was finished.
    if (registry) {
      if (edited) goal.buildOwned = { ...registry.ownership(bot, goal.blueprint.bounds, dimensionName(bot), undefined, { only: edited.id }), ...goal.buildOwned };
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
  if (localBatch(bot, goal, save)) { await smelt(bot, task, goal.smelting, goal, save); return false; }
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
  // A working lot chosen before the order knew about support (or before the
  // world changed) can hold only cells with nothing to attach to. Choose the
  // lot again once before calling the building blocked.
  if (!work && batch && !goal.buildBatchRechosen) {
    delete goal.buildBatch; goal.buildBatchRechosen = true; save(); return false;
  }
  if (!work) throw new Blocked('I cannot reach the next part of the building yet; the design and progress are saved');
  delete goal.buildBatchRechosen;
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
  if (localBatch(bot, goal, save)) { await smelt(bot, task, goal.smelting, goal, save); return false; }
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
    const reachable = await reachableBlocks(bot, task, await miningCandidates(bot, task, step, goal), { limit: 16 });
    // Jev chooses between sources that differ; code picks the block inside one.
    for (const source of resourceSources(bot, reachable, { failures: attemptsFor(goal).of('option'), resting: p => isSetAside(goal, 'reach', p) })) {
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
  }, { acquisition: { ...acquisition, dependencies: plan.map(s => ({ action: s.action, item: s.item || s.drops, count: s.count, tool: s.tool })) } }, 'resource_source');
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
// The bottom block of the nearest portal: aimed at the top one, the bot
// pillared up beside the frame and stood with its head under the lintel,
// walking into obsidian.
function lowestPortalBlock(bot) {
  const blocks = find(bot, ['nether_portal'], 64, 32);
  if (!blocks.length) return null;
  const nearest = blocks[0];
  return blocks.filter(b => Math.hypot(b.x - nearest.x, b.z - nearest.z) <= 3).sort((a, b) => a.y - b.y)[0];
}
// A portal takes a player who stands in it for four seconds. This used to
// face the portal and hold forward for eight: at walking speed the bot
// crossed the one-block sheet in a fraction of a second and kept going,
// thirty blocks in a straight line, and death ten was the edge of the
// Nether portal's platform thirteen blocks past it. Step in sneaking (a
// sneaking player does not walk off an edge), stop the moment the feet are
// in the portal, and stand there.
const inPortal = bot => [0, 1].some(dy => bot.blockAt?.(bot.entity.position.offset(0, dy, 0).floored())?.name === 'nether_portal');
async function enterPortal(bot, task, portal, arrived) {
  // Standing in the portal it just came through, the bot must step out
  // first: a player is not sent back until it has left the sheet.
  if (inPortal(bot) && !arrived()) {
    await move(bot, task, { label: 'leave_portal', keys: ['back'], sneak: true, maxMs: 1200, tick: 50, until: () => !inPortal(bot) });
  }
  await navigate(bot, task, new goals.GoalNear(portal.x, portal.y, portal.z, 1), { timeoutMs: 20000 });
  if (arrived()) return;
  bot.pathfinder.setGoal(null);
  if (!inPortal(bot)) {
    // Crouched, it cannot step down: a portal a block below the bot's feet
    // is walked into upright, the one step checked to land in the sheet.
    const below = portal.y < Math.floor(bot.entity.position.y);
    await move(bot, task, { label: 'enter_portal', keys: ['forward'], sneak: !below, why: below ? 'a step down into the portal' : undefined,
      look: pos(portal).offset(0.5, 0.5, 0.5), maxMs: 4000, tick: 50, until: () => inPortal(bot) || arrived() });
  }
  if (arrived()) return;
  if (!inPortal(bot)) throw new Error('Could not step into the portal');
  // Standing in the sheet: the teleport comes after about four seconds.
  await waitFor(task, arrived, 10000);
}

// Any portal in sight is remembered on the side the bot is standing on.
// Only the Overworld end of the dream run's portal was ever recorded: the
// Nether end was noted only when the bot already stood beside it on the way
// out. Hurt and hungry 120 blocks away, it went to leave for food and did
// not know where the door was.
function noticePortal(bot, goal, save) {
  if (goal._portalCheckedAt > Date.now() - 5000) return;
  goal._portalCheckedAt = Date.now();
  if (typeof bot.findBlocks !== 'function') return;
  const where = dimension(bot);
  if (!['nether', 'overworld'].includes(where)) return;
  // An observer never breaks the loop it watches.
  try {
    const portal = find(bot, ['nether_portal'], 16, 1)[0];
    if (portal) rememberPortal(goal, save, portal, where);
  } catch (_) {}
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
  } else if (!isSetAside(goal, 'portal_leg', pos(p))) {
    if (await portalLeg(bot, task, p)) return true;
    setAside(goal, 'portal_leg', pos(p), 'a walk toward it made no ground', 120000); save();
  }
  // Farther off, a leg of the way on foot first: ninety-six blocks from
  // the portal the staircase was the only thing tried, and it went up and
  // down one fortress corridor for eighty-eight rounds.
  if (staircaseResting(goal, pos(p))) {
    const err = new Error(`No way back to the ${where} portal at ${p.x}, ${p.y}, ${p.z}: ${attemptsFor(goal).why('staircase', pos(p))}, and the walk made no ground`);
    err.name = 'Blocked'; throw err;
  }
  await tunnelToward(bot, task, goal, save, pos(p), `portal_${where}`);
  return true;
}

// Thirty-two blocks of the way by the pathfinder, which bridges and climbs
// where a staircase can only dig. Six blocks gained is a leg that worked.
async function portalLeg(bot, task, p) {
  const here = bot.entity.position, flat = at => Math.hypot(p.x - at.x, p.z - at.z), before = flat(here);
  const step = Math.min(32, before - 8) / before;
  const leg = { x: here.x + (p.x - here.x) * step, z: here.z + (p.z - here.z) * step };
  try { await navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 4), { timeoutMs: 30000, stallMs: 8000, sprint: true }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  return flat(bot.entity.position) < before - 6;
}

// A staircase needs a pickaxe; the planner offers no stone stair without
// one. The bot stood by its broken pickaxe with eight logs and a stack of
// cobblestone, so make the tool first.
async function tunnelToward(bot, task, goal, save, target, key) {
  if (pickaxeTier(bot) < 1 && bot.game?.gameMode !== 'creative') { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return; }
  // Straight overhead and out of the stairs' reach: up by a pillar first.
  // The pathfinder builds towers too, but a thirty-block one never came out
  // of its search in time, and the staircase went round a lava pool below
  // the portal ninety-eight times. Every way back to a portal ends here.
  const here = bot.entity.position;
  // Within sixteen sideways: the column is looked for near the portal,
  // anywhere in twelve of the bot. From ten blocks off the pillar was never
  // tried and the given-up staircase was refused a hundred times instead.
  if (target.y - here.y > 6 && Math.hypot(target.x - here.x, target.z - here.z) <= 16 && !isSetAside(goal, 'pillar', target)) {
    const site = pillarSite(bot, target.y, target, { radius: 12 });
    goal.step = { action: 'pillar_to_portal', portal: { x: target.x, y: target.y, z: target.z }, from: Math.round(here.y), site: site && { ...site } }; save();
    const before = here.y;
    if (site && site.distanceTo(bot.entity.position.floored()) >= 1) {
      try { await navigate(bot, task, new goals.GoalBlock(site.x, site.y, site.z), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (site && site.distanceTo(bot.entity.position.floored()) < 1.5) await pillarUp(bot, task, target.y, { dig });
    if (bot.entity.position.y - before >= 2) return;
    setAside(goal, 'pillar', target, 'the pillar toward the portal would not rise', 300000); save();
  }
  await resourceTunnelStep(bot, task, goal, save, target, key, { dig, navigate });
}

async function netherStep(bot, task, goal, save) {
  if (String(bot.game.dimension).includes('nether')) return true;
  // Fed and healed before the portal, however the crossing was reached.
  if (bot.game?.gameMode === 'survival' && bot.game.difficulty !== 'peaceful') {
    if (!await netherFoodReady(bot, task, goal, save)) return false;
    if ((bot.health ?? 20) < NETHER_HEALTH) {
      goal.step = { action: 'recover_before_nether', health: Math.round(bot.health), needed: NETHER_HEALTH, food: bot.food }; save();
      for (let i = 0; i < 10; i++) { task.check(); await sleep(100); }
      return false;
    }
  }
  // The portal is often underground and the Nether has no wood: the same
  // supplies a descent needs, checked before the walk rather than after a
  // stone pickaxe wears to five on the way.
  if (bot.game?.gameMode !== 'creative' && !goal.expeditionPrepActive && (goal.preparingExpedition || descentSuppliesLow(bot))) {
    goal.preparingExpedition = true; delete goal.expeditionReady; goal.expeditionPrepActive = true; save();
    try { await prepareExpeditionStep(bot, task, goal, save); }
    finally { delete goal.expeditionPrepActive; }
    return false;
  }
  const portal = lowestPortalBlock(bot);
  if (portal) {
    goal.portal = { ...portal }; rememberPortal(goal, save, portal, 'overworld'); save();
    // Loaded is not routable: forty-two blocks away through solid ground the
    // walk ended short forty-seven times. When it fails, dig toward it.
    try { await enterPortal(bot, task, portal, () => String(bot.game.dimension).includes('nether')); return true; }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      goal.step = { action: 'return_to_portal', portal: { ...portal } }; save();
      await tunnelToward(bot, task, goal, save, pos(portal), 'portal_overworld');
      return false;
    }
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
  return new Survival(bot, { acquireStep, dig, place, navigate, explore, returnOverworld: returnFromNether, surfaceStep }, options);
}

async function returnFromNether(bot, task, goal, save) {
  if (dimension(bot) === 'overworld') return;
  const portal = lowestPortalBlock(bot);
  if (!portal) {
    if (await walkToKnownPortal(bot, task, goal, save, 'nether')) return;
    throw new Blocked('No loaded return portal observed in the Nether; saved progress retained');
  }
  rememberPortal(goal, save, portal, 'nether');
  goal.step = { action: 'return_overworld', portal: { ...portal } }; save();
  try { await enterPortal(bot, task, portal, () => dimension(bot) === 'overworld'); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    await tunnelToward(bot, task, goal, save, pos(portal), 'portal_nether');
  }
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
// time, up to fifteen seconds, so an impossible spot costs little per hour) and
// goes again with a clean slate. Only the player, the game, or a request
// that is impossible by definition ends a request.
// A ring search (no frontier heading) is turned too, to its next leg from
// the same origin. It used to be dropped, so the next search began again
// from here on its first leg, the same walk that had just failed: the hunt
// for endermen stood four minutes in one cell doing exactly that.
const turnSearch = search => Object.fromEntries(Object.entries(search || {})
  .filter(([, entry]) => Number.isInteger(entry?.frontier?.heading) || entry?.origin)
  .map(([resource, entry]) => [resource, Number.isInteger(entry.frontier?.heading)
    ? { attempts: 0, frontier: { heading: (entry.frontier.heading + 1) % 8, legs: 0 } }
    : { attempts: 0, origin: entry.origin, leg: (entry.leg || 0) + 1 }]));
// Failing again and again is getting nowhere, and is answered the way a
// stall is (answerStall): Jev chooses another way, the rung for later, or a
// detour, with the failure and how many times it has come as facts.
async function persist(bot, task, goal, save, err, onStep, { client, survival } = {}) {
  goal.struggles = (goal.struggles || 0) + 1;
  goal.lastStruggle = { at: new Date().toISOString(), error: err.message, from: goal.lastErrorFrom };
  if (goal.struggles === 1 || goal.struggles % 5 === 0) {
    bot.chat?.(`${friendlyProblem(err)} I'll keep trying${goal.struggles > 1 ? ` (attempt ${goal.struggles})` : ''}.`);
  }
  const failed = goal.lastStruggleStep || goal.step;
  const key = `step:${failed?.block || failed?.item || failed?.action || 'none'}`;
  goal.step = { action: 'persist', attempt: goal.struggles, problem: err.message }; save(); onStep(goal);
  try { await answerStall(bot, task, goal, save, { key, layer: 'work', strikes: goal.struggles, error: err.message }, { client, survival, onStep }); }
  finally {
    if (goal.step?.action === 'persist') goal.step = failed;
    goal.failures = 0; goal.stalls = 0; attemptsFor(goal).clearAction('option'); delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal);
  }
}

function createRecoveryAdviser(bot, client) {
  return new RecoveryAdviser(bot, { acquireStep, catalogPlan, planningInventory, surfaceStep, navigate, explore, find }, { client });
}

// Full pockets stall quietly: ore mined and never picked up, a crafting
// grid spilling on the ground. Surplus stone goes before that happens.
// What the step makes, what it digs for, and what it will use: sand on
// its way to glass or concrete powder is an ingredient, not surplus.
function wantedItems(goal = {}) {
  return new Set([goal.item, goal.step?.item, goal.step?.from, goal.step?.block, goal.step?.drops, goal.smelting?.from,
    ...Object.keys(goal.step?.consumes || {}), ...Object.keys(goal.step?.requires || {}),
    ...(goal.tasks || []).map(t => t.item), ...(goal.blueprint?.blocks || []).map(b => b.material)].filter(Boolean));
}

async function keepRoom(bot, task, goal) {
  // In Creative nothing carried is scarce: clear what the work does not
  // need instead of dropping it in the players' world.
  if (bot.game?.gameMode === 'creative') {
    if (crowded(bot)) await clearCreativeInventory(bot, task, wantedItems(goal));
    return;
  }
  const heading = goal.step?.destination || goal.step?.target || goal.tunnel?.target;
  const wanted = [...wantedItems(goal)];
  const dropped = await tidyInventory(bot, task, { away: heading && Number.isFinite(heading.x) ? heading : null, keep: new Set(wanted) });
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
    // A stall raised meanwhile is the loop's to answer, next tick.
    if (err.name === 'Stalled') return true;
    try { task.check(); } catch (e) { if (e.name === 'Stalled') return true; throw e; }
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) return true;
    noteError(goal, err);
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
  // Exploring: the nearest unexplored area around home, and what is there.
  // Villages and ruined portals are worth knowing before they are needed.
  if (bot.game?.dimension === 'overworld' || /overworld/.test(String(bot.game?.dimension || ''))) {
    const home = goal.survival?.home?.origin;
    const target = unexploredArea(bot, goal, { home });
    if (target) {
      const known = explorationSummary(goal);
      options.explore = { description: `Explore: walk to the nearest unexplored area (${target.fromHere} blocks away) and see what is there. Known so far: ${summaryText(known)}. Villages mean beds, food and trades; a ruined portal or a surface lava pool means obsidian; dungeons, mineshafts and temples mean chests.`,
        run: (b, t, g, sv) => exploreStep(b, t, g, sv, { navigate, home, noticeVillage }) };
    }
  }
  const sides = sideTrips(bot, goal);
  if (sides.loot) options.loot = sides.loot;
  if (sides.trade) options.trade = sides.trade;
  for (const key of ['deep_dark', 'trial_chambers', 'fetch_cache', 'tame_wolf', 'breed_sheep', 'breed_chickens']) if (sides[key]) options[key] = sides[key];
  // Experience for enchanting: the ingots taken out of a furnace give it,
  // and the raw ore is carried and stashed by the stack. Only while there is
  // gear to enchant and the level is under thirty, so it is never ground for
  // its own sake.
  const RAW_ORE = { raw_iron: 'iron_ingot', raw_gold: 'gold_ingot', raw_copper: 'copper_ingot' };
  const rawOre = Object.keys(RAW_ORE).map(name => [name, countOf(bot, name)]).filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1])[0];
  if (rawOre && (bot.experience?.level ?? 0) < 30 && enchantable(bot).length) options.earn_xp = { description: `Earn experience for enchanting: smelt ${Math.min(rawOre[1], 32)} of the ${rawOre[1]} ${rawOre[0].replaceAll('_', ' ')} carried (level ${bot.experience?.level ?? 0} now; each level is a better enchant). The ingots are useful too.`,
    item: RAW_ORE[rawOre[0]], count: countOf(bot, RAW_ORE[rawOre[0]]) + Math.min(rawOre[1], 32) };
  if (sides.enchant) options.enchant = sides.enchant;
  if (stock.coal > 0 && (stock.torch || 0) < 8) options.torches = { description: `Craft torches from the ${stock.coal} coal being carried; light keeps mobs from spawning at home.`, item: 'torch', count: 4 };
  // The standing dream. With nothing asked and nothing urgent, the next
  // rung of the beat-the-game ladder is on offer; it is a long walk from a
  // stone pickaxe to a dragon, and this is how the walk gets taken. Only
  // when that is the dream: a dream is something a player gives Jev, and
  // without one the ladder was still offered every idle minute.
  if (bot.game.gameMode === 'survival' && goal.dream === 'beat_the_game') {
    const stage = nextGameStage(bot, goal);
    if (stage.phase !== 'complete') options.long_game = { description: `Work toward beating the game. The next stage is ${stage.phase.replaceAll('_', ' ')}${stage.item ? ` (${stage.count} ${stage.item.replaceAll('_', ' ')})` : ''}; it may mean a long trip and a real fight, so choose it with supplies, tools and daylight in hand.`, phase: stage.phase, stage };
  }
  return options;
}

// The trips worth making from wherever the bot is, each already checked
// feasible: shared by idle work and the strategy on the way to the dragon.
function sideTrips(bot, goal, client) {
  const trips = {};
  // Looting: the nearest remembered ruined portal, dungeon or temple whose
  // chests have not been opened.
  const unlooted = unlootedLandmarks(bot, goal)[0];
  if (unlooted) trips.loot = { description: `Loot: walk ${unlooted.distance} blocks to the ${unlooted.landmark.kind.replaceAll('_', ' ')} and open its chests. Ruined portals hold gold, obsidian and flint and steel; dungeons and temples iron, gold, bread and now and then diamonds; a mineshaft's chests ride in minecarts, with rails, iron, gold and bread, and its cobwebs are string.`,
    says: `I'll loot the ${unlooted.landmark.kind.replaceAll('_', ' ')} ${unlooted.distance} blocks away`, walkBlocks: unlooted.distance,
    run: (b, t, g, sv) => lootStep(b, t, g, sv, lootActions()) };
  // Trading: a village remembered and something to sell or spend (trading.js).
  if (tradeWorthwhile(bot, goal)) trips.trade = { description: 'Trade at the remembered village: read the villagers\' offers, sell spare coal, sticks, wheat and the like for emeralds, and buy what the run needs (ender pearls, arrows, a bow, better armour or tools, food).',
    says: 'I\'ll go trade at the village',
    run: (b, t, g, sv) => tradeStep(b, t, g, sv, { navigate, decide, client: client || t.opportunityClient }) };
  // Enchanting: a table carried, in view or remembered, lapis in hand, five
  // levels or more, and gear still plain (enchanting.js).
  // The bold trips underground, packed light (deep-dark.js, trip-kit.js):
  // an ancient city in the deep dark, and the trial chambers' vaults.
  const expeditions = require('./deep-dark');
  const tripActions = { dig, navigate, place, acquireStep, tunnel: tunnelStep,
    loot: (b2, t2, g2, sv2) => lootNearby(b2, t2, g2, sv2, lootActions()),
    notice: (b2, g2, sv2) => noticeLandmarks(b2, g2, sv2, { force: true }) };
  for (const [kind, says] of [['deep_dark', "I'll go looking for an ancient city in the deep dark"], ['trial_chambers', "I'll go looking for trial chambers"]]) {
    if (expeditions.expeditionReady(bot, goal, kind)) trips[kind] = { description: expeditions.describe(goal, kind), says,
      run: (b, t, g, sv) => expeditions.expeditionTrip(b, t, g, sv, tripActions, kind) };
  }
  // The surface, walked for what it has: villages, temples, portals.
  if (/overworld/.test(String(bot.game?.dimension || ''))) {
    const home = goal.survival?.home?.origin;
    const target = unexploredArea(bot, goal, { home });
    if (target) trips.explore = { description: `Explore: walk to the nearest unexplored area (${target.fromHere} blocks away) and see what is there. Known so far: ${summaryText(explorationSummary(goal))}. Villages mean beds, food and trades; temples, shipwrecks and ruined portals mean chests.`,
      says: "I'll go exploring", run: (b, t, g, sv) => exploreStep(b, t, g, sv, { navigate, home, noticeVillage }) };
  }
  // Animals: a wolf tamed with bones, sheep and chickens bred in the field
  // (wolves.js, breeding.js).
  const wolves = require('./wolves'), breeding = require('./breeding');
  if (wolves.tameReady(bot, goal)) trips.tame_wolf = { description: `Tame the wolf in view with the ${countOf(bot, 'bone')} bones carried (a third of bones tame, on average): a companion that fights skeletons and zombies beside the bot. It is told to sit before a Nether or End crossing.`,
    says: "I'll tame that wolf", run: (b, t, g, sv) => wolves.tameWolf(b, t, g, sv, { navigate }) };
  if (breeding.breedReady(bot, goal, 'sheep')) trips.breed_sheep = { description: 'Breed the two sheep in view with two wheat: more sheep near here are wool for the next bed.',
    says: "I'll breed these sheep", run: (b, t, g, sv) => breeding.breedNearby(b, t, g, sv, 'sheep', { navigate }) };
  if (breeding.breedReady(bot, goal, 'chicken')) trips.breed_chickens = { description: 'Breed the two chickens in view with two seeds: more chickens near here are feathers for arrows.',
    says: "I'll breed these chickens", run: (b, t, g, sv) => breeding.breedNearby(b, t, g, sv, 'chicken', { navigate }) };
  // A cache from an earlier trip, far enough off that passing will not
  // bring it back: fetch it.
  const cached = require('./field-cache').nearCache(bot, goal, 512);
  if (cached && cached.distance > 48) trips.fetch_cache = { description: `Walk ${Math.round(cached.distance)} blocks back to the chest left before an earlier trip and take its things back (${Object.entries(cached.cache.contents).filter(([, n]) => n > 0).slice(0, 5).map(([k, n]) => `${n} ${k.replaceAll('_', ' ')}`).join(', ')}).`,
    says: "I'll fetch my things from the chest I left", run: (b, t, g, sv) => require('./field-cache').emptyCache(b, t, g, sv, homeActions(), cached.cache) };
  // Wool for beds: one to sleep in and four for the dragon (shearing.js).
  const shearing = require('./shearing');
  if (shearing.shearReady(bot, goal)) trips.shear_sheep = { description: `Shear the sheep in view (${shearing.woollySheep(bot, goal, 24).length} with wool, ${shearing.woolTotal(bot)} wool carried): three wool a bed, beds to sleep in and to blow up in the End, and the sheep grow it back.`,
    says: "I'll shear these sheep", run: (b, t, g, sv) => shearing.shearSheep(b, t, g, sv, { navigate, acquireStep }) };
  // The table itself, as soon as there is something to spend it on: made
  // only in the last preparations before the End, it was never made at all
  // in two runs, and the lapis went to the chest (a watcher,
  // 2026-09-24: lapis is for enchanting).
  const { tableNear } = require('./enchanting');
  if (!tableNear(bot, goal) && countOf(bot, 'diamond') >= 2 && countOf(bot, 'lapis_lazuli') >= 3 && (bot.experience?.level ?? 0) >= 5 &&
      (countOf(bot, 'obsidian') >= 4 || countOf(bot, 'diamond_pickaxe') > 0) && enchantable(bot).length) {
    trips.enchanting_table = { description: `Make an enchanting table: the two diamonds carried, four obsidian and a book from leather and paper, then enchant the ${enchantable(bot)[0].item.name.replaceAll('_', ' ')} with the ${bot.experience?.level} levels and ${countOf(bot, 'lapis_lazuli')} lapis carried.`,
      says: "I'll make an enchanting table",
      run: async (b, t, g, sv) => {
        for (let i = 0; i < 60 && !countOf(b, 'enchanting_table'); i++) { t.check(); if (await acquireStep(b, t, 'enchanting_table', 1, g, sv)) break; }
        if (!countOf(b, 'enchanting_table')) throw new Error('The enchanting table is not made yet');
        if (enchantReady(b, g)) await enchantStep(b, t, g, sv, { workstation });
      } };
  }
  if (enchantReady(bot, goal)) trips.enchant = { description: `Enchant the ${enchantable(bot)[0].item.name.replaceAll('_', ' ')} at the enchanting table with ${bot.experience?.level} levels and the lapis carried: Sharpness, Protection or Power for the fights ahead.`,
    says: `I'll enchant my ${enchantable(bot)[0].item.name.replaceAll('_', ' ')}`,
    run: (b, t, g, sv) => enchantStep(b, t, g, sv, { workstation }) };
  return trips;
}

async function idleWork(bot, task, goal, save, client, onStep = () => {}, { acquire = acquireStep, handlers, actions } = {}) {
  if (!client || bot.game.gameMode === 'creative') return false;
  if ((bot.health ?? 20) < 14 || (bot.food ?? 20) < 12 || immediateThreat(bot)) return false;
  if (bot.game.dimension === 'overworld' && bot.time?.timeOfDay >= DAY.DUSK) return false;
  const options = idleOptions(bot, goal);
  if (!Object.keys(options).length) return false;
  // No "rest" option: waiting here quietly was the answer Jev could always
  // pick, and standing still is the one thing the bot should never do.
  const tree = {};
  for (const [key, option] of Object.entries(options)) {
    tree[key] = { description: option.description, run: async () => {
      goal.step = { action: 'idle', choice: key, item: option.item, count: option.count, phase: option.phase }; save(); narrate(bot, goal);
      if (key === 'long_game') await gameStep(bot, task, goal, save, handlers || gameHandlers(bot, client));
      else if (option.run) await option.run(bot, task, goal, save, actions || homeActions());
      else await acquire(bot, task, option.item, option.count, goal, save);
    } };
  }
  const state = { situation: 'Between player requests, with shelter and food already sufficient. Choose how to spend spare daylight.',
    timeOfDay: bot.time?.timeOfDay, daylightTicksRemaining: Math.max(0, DAY.DUSK - (bot.time?.timeOfDay || 0)),
    health: bot.health, food: bot.food, foodReserve: foodSupply(bot), inventory: planningInventory(bot),
    retainedRequest: goal.retainedRequest || null, home: goal.survival?.home ? `A home base with a plot, a pen${goal.survival.home.stash?.position ? ', a bed and a stash chest' : ' and a bed'} stands at ${goal.survival.home.origin.x}, ${goal.survival.home.origin.z}.` : goal.blueprint ? 'A house is built nearby.' : 'No house yet.' };
  await decideAction(bot, task, goal, save, client, onStep, tree, state, 'idle_work');
  return true;
}


// Something else useful from here, the second answer to a stall (see
// stillness.js): work that can be done from here, Jev's pick, bounded to
// three minutes, after which the stalled work gets its turn again. A
// detour that fails rests for five minutes.
const DETOUR_MS = 180000, DETOUR_REST_MS = 300000;
// Not copper (see survival.js NIGHT_ORES).
const USEFUL_ORES = ['coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore',
  'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris'];
async function breakStillness(bot, task, goal, save, { client, survival, onStep = () => {}, reason = 'step:none', now = Date.now(), answers = {}, stalled = null } = {}) {
  const ms = STALL_MS;
  const deadline = now + DETOUR_MS;
  const bounded = Object.create(task);
  // A detour answers to threats like any work: one that shows ends it and
  // hands the tick to the survival layer.
  bounded.check = () => { task.check(); checkThreats(bot); if (Date.now() >= deadline) throw Object.assign(new Error('The detour has had its time'), { name: 'DetourBudget' }); };
  // Its own goal. Run on the player's, a cook cut off at three minutes left
  // a saved furnace batch that the request then had to finish, and search
  // and source state leaked the same way. It shares the world's knowledge
  // and the survival state, and nothing else.
  const scratch = { kind: 'survive', request: `Something useful while ${reason.replace(/^\w+:/, '').replaceAll('_', ' ')} is stuck`, survival: goal.survival,
    portals: goal.portals, villages: goal.villages, blueprint: goal.blueprint };
  const attempts = attemptsFor(goal);
  const tree = {};
  const offer = (key, description, run) => {
    if (attempts.resting('detour', key, now)) return;
    tree[key] = { description, run: async () => {
      goal.step = { action: 'detour', choice: key, from: reason }; save(); narrate(bot, goal);
      try { await run(); }
      catch (err) {
        if (err.name === 'DetourBudget') return;
        task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
        attempts.fail('detour', key, err, { restMs: DETOUR_REST_MS }); throw err;
      }
    } };
  };
  // The stalled work's own answers (answerStall): done differently, or its
  // rung left for later. They run on the player's goal, not the scratch one.
  for (const [key, answer] of Object.entries(answers)) offer(key, answer.description, answer.run);
  const overworld = dimension(bot) === 'overworld';
  const dark = overworld && bot.time?.timeOfDay >= DAY.DUSK;
  if (survival?.canNightMine?.(goal)) offer('night_mine', 'Dig a mine from here for the night: toward ore in the rock, or down and along a branch. Rock around a tunnel is shelter.',
    // A step a pass, yielding between: a failed step returns at once, and
    // this loop without a pause spun the event loop until the bot, unable
    // to move or surface for air, drowned in its own mine.
    // A mine that goes nowhere is the stall rule's to end (stillness.js).
    async () => {
      while (await survival.nightMine(bounded, scratch, save)) {
        bounded.check();
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });
  if (!dark && overworld) for (const [key, option] of Object.entries(idleOptions(bot, scratch))) {
    if (key === 'long_game') continue;
    offer(key, option.description, () => option.run ? option.run(bot, bounded, scratch, save, homeActions()) : acquireStep(bot, bounded, option.item, option.count, scratch, save));
  }
  // Ore only where nothing flows beside it: in the Nether the quartz is in
  // the walls of the lava sea.
  const ore = find(bot, USEFUL_ORES, 16, 8).map(p => ({ p, name: bot.blockAt(p)?.name }))
    .filter(o => o.name && ![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([x, y, z]) => /lava/.test(bot.blockAt(o.p.offset(x, y, z))?.name || '')))[0];
  if (ore) offer('mine_nearby', `Dig the ${ore.name.replaceAll('_', ' ')} ${Math.round(ore.p.distanceTo(bot.entity.position))} blocks away.`,
    () => dig(bot, bounded, ore.p, {}));
  // A walk to see what is there is an Overworld thing by day; in the Nether
  // twenty-four blocks in a straight line is a walk to the lava sea.
  if (!dark && overworld) {
    // Kept with the world's survival state, not written onto the player's goal.
    const turn = goal.survival || scratch;
    const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; turn.detourHeading = heading;
    const angle = heading * Math.PI / 4, here = bot.entity.position.floored();
    const target = here.offset(Math.round(Math.cos(angle) * 24), 0, Math.round(Math.sin(angle) * 24));
    offer('look_around', 'Walk about twenty-four blocks in a direction not tried lately and see what is there: animals, trees, ore in a cliff, a better way on.',
      () => navigate(bot, bounded, new goals.GoalNear(target.x, target.y, target.z, 4), { timeoutMs: 45000, stallMs: 8000 }));
  }
  // Nothing else on offer: a walk to new ground, dusk or not, rather than
  // standing where the work stalled. Trial 17, a desert at dusk with no wood
  // and so no tools, had no detour at all and stood a minute (2026-09-24).
  if (!Object.keys(tree).some(key => !answers[key]) && overworld) {
    const turn = goal.survival || scratch;
    const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; turn.detourHeading = heading;
    const angle = heading * Math.PI / 4, here = bot.entity.position.floored();
    const target = here.offset(Math.round(Math.cos(angle) * 24), 0, Math.round(Math.sin(angle) * 24));
    offer('look_around', 'Walk about twenty-four blocks in a direction not tried lately: nothing else can be done from here.',
      () => navigate(bot, bounded, new goals.GoalNear(target.x, target.y, target.z, 4), { timeoutMs: 45000, stallMs: 8000 }));
  }
  const options = Object.keys(tree);
  const stats = survival?.state || goal.survival || goal;
  recordStill(stats, reason, ms, { now, detour: options.join(',') || 'none' });
  console.log(`[still] ${Math.round(ms / 1000)}s on ${reason}; detours: ${options.join(', ') || 'none'}`);
  save();
  if (!options.length) return false;
  const step = goal.step;
  const what = reason.replace(/^\w+:/, '').replace(/^rung:/, '').replaceAll('_', ' ');
  const context = { situation: stalled?.failure
    ? `${what} keeps failing (${stalled.failure}), round ${stalled.strikes} of failures. Choose: keep at it another way, leave it for later, or something useful from here for a few minutes.`
    : stalled
    ? `${Math.round(ms / 1000)} seconds on ${what} without getting anywhere, ${stalled.strikes === 1 ? 'the first time' : `${stalled.strikes} times in ten minutes`}. Choose: keep at it another way, leave it for later, or something useful from here for a few minutes.`
    : `Standing still for ${Math.round(ms / 1000)} seconds on ${what}. Choose something useful to do from here for a few minutes; the stalled work gets its turn again afterwards.`,
  ...(stalled ? { stalled } : {}) };
  try {
    if (options.length === 1) await tree[options[0]].run();
    else if (!client) await tree[question('stillness_detour').fallback(tree, [], context)].run();
    else await decideAction(bot, task, goal, save, client, onStep, tree, context, 'stillness_detour');
  } finally { goal.step = step; save(); }
  return true;
}

// What the home base needs from the executor: travel, placing, digging,
// the planner for anything craftable, and a search for sheep or cows.
const homeActions = () => ({ acquireStep, navigate, place, dig, explore });

// Two steaks was the whole larder for the first Nether trip. The survival
// layer's stock-driven search fills the reserve; a search it has set aside
// as fruitless lets the trip go with what there is. It is asked at the
// crossing itself as well as on the ladder: after a death the blaze hunt
// walked straight back through the portal with three pieces of food, fought
// at four health, and was knocked off the ledge.
const NETHER_HEALTH = 16;
async function netherFoodReady(bot, task, goal, save) {
  // The gate never waits. It takes food from the chest, harvests the
  // plot, or sends the survival layer hunting, and after twenty
  // working minutes of that it lets the crossing go with what there
  // is. It used to return having done nothing whenever the chest
  // would not open and the animal search was resting, and the loop
  // spun on it at twenty passes a second.
  const NETHER_FOOD = NETHER_FOOD_POINTS, now = Date.now();
  if (foodSupply(bot) >= NETHER_FOOD) { delete goal.preparingNether; unwatch(goal, 'food_gate', 'nether'); return true; }
  // The supervisor: twenty minutes with no more food carried lets the
  // crossing go with what there is, but not with nothing: with
  // nothing the hunt sends it straight home, a round trip for every
  // twenty minutes. Finding some food restarts the clock.
  const gate = watch(goal, 'food_gate', 'nether', foodSupply(bot), { better: 'higher', stallMs: 20 * 60000, restMs: 60000,
    why: 'twenty minutes without any more food', now });
  if (gate.stalled && foodSupply(bot) > 0) {
    bot.chat?.(`I've spent twenty minutes getting food together. Going with what I have (${foodSupply(bot)} points).`);
    delete goal.preparingNether; return true;
  }
  goal.preparingNether = true; goal.stockFood = true;
  const survivalState = goal.survival || {};
  // The chest first, from wherever the bot is.
  const stashFood = Object.entries(survivalState.home?.stash?.contents || {})
    .reduce((sum, [name, n]) => sum + (safeFood(bot, { name }) ? n * (bot.registry.foodsByName[name]?.foodPoints || 0) : 0), 0);
  const home = require('./home-base').homeOf(bot, goal);
  const attempts = attemptsFor(goal);
  if (stashFood > 0 && home?.stash?.position && !attempts.resting('fetch_food', 'stash', now)) {
    goal.step = { action: 'fetch_food_from_stash', foodPoints: foodSupply(bot), required: NETHER_FOOD, inChest: stashFood }; save();
    try { await restockFromStash(bot, task, goal, save, home, homeActions(), []); }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      attempts.fail('fetch_food', 'stash', err, { restMs: 120000 }); save();
    }
    return false;
  }
  // Then the plot: wheat into bread.
  const chore = require('./home-base').homeChores(bot, goal).harvest_and_bake;
  if (chore && !attempts.resting('chore', 'harvest_and_bake', now)) {
    goal.step = { action: 'harvest_for_nether', foodPoints: foodSupply(bot), required: NETHER_FOOD }; save();
    try { await chore.run(bot, task, goal, save, homeActions()); }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      attempts.fail('chore', 'harvest_and_bake', err, { restMs: 120000 }); save();
    }
    return false;
  }
  // Then the hunt. A search set aside as fruitless is taken up again:
  // the gate is the reason to look, and resting it was the stall.
  if (attempts.resting('food_search', 'stock', now)) { attempts.clear('food_search', 'stock'); unwatch(goal, 'food_search', 'stock'); }
  goal.step = { action: 'hunt_food_for_nether', foodPoints: foodSupply(bot), required: NETHER_FOOD, minutes: Math.round((now - (gate.record?.startedAt || now)) / 60000) }; save();
  await explore(bot, task, goal, save, 'animals', { surfaceOnly: true });
  return false;
}

// The executors the game-completion ladder can call, shared by the win
// objective and by idle dream between requests.
// What the pearl patrol does now: hunt an enderman in view, else a turn of
// an expedition or an exploring leg, else the hunt's own search.
function patrolChoice(bot, trips) {
  const seen = Object.values(bot.entities || {}).some(e => e.name === 'enderman' && e.isValid !== false && e.position?.distanceTo(bot.entity.position) <= 48);
  if (seen) return 'hunt';
  return ['deep_dark', 'trial_chambers', 'explore'].find(k => trips[k]) || 'search';
}

function gameHandlers(bot, decisionClient) {
  return {
        // Which open rung, or a side trip, next: Jev's choice (strategy.js).
        strategy: (bot, task, goal, save, stage) => strategyStep(bot, task, goal, save, stage, { client: decisionClient, decide, sides: sideTrips(bot, goal, decisionClient) }),
        acquireStep, acquireSetStep, enter_nether: netherStep, return_overworld: returnFromNether,
        enter_end: (bot, task, goal, save) => enterEnd(bot, task, goal, save, { navigate }),
        fight_dragon: (bot, task, goal, save) => fightEndStep(bot, task, goal, save, { navigate, dig }, decisionClient),
        exit_end: (bot, task, goal, save) => exitEnd(bot, task, goal, save, { navigate }),
        prepare_combat: (bot, task, goal, save) => prepareCombatGear(bot, task, goal, save, { acquireStep }),
        // Two steaks was the whole larder for the first Nether trip. The
        // survival layer's stock-driven search fills the reserve; a search
        // it has set aside as fruitless lets the trip go with what there is.
        food_reserve: (bot, task, goal, save) => netherFoodReady(bot, task, goal, save),
        barter: (bot, task, goal, save) => barterStep(bot, task, goal, save, { acquireStep, navigate }),
        bastion_gold: async (bot, task, goal, save) => {
          try { return await gatherBastionGold(bot, task, goal, save, { acquireStep, navigate, dig, place, approachDryMining, collectNearbyDrops,
            loot: (b2, t2, g2, sv2) => lootNearby(b2, t2, g2, sv2, lootActions()) }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'rung', 'bastion_gold', err, 1800000); save(); return false; }
        },
        // Pearls from a cleric: sell what is spare until the emeralds are
        // there, then buy. A trip that makes no trade sets the rung aside.
        trade: async (bot, task, goal, save) => {
          const made = await tradeStep(bot, task, goal, save, { navigate, decide, client: decisionClient });
          if (!made) { setAside(goal, 'rung', 'trade_pearls', 'no trade made', 1800000); save(); }
          return made;
        },
        prepare_end: (bot, task, goal, save) => prepareEndSupplies(bot, task, goal, save, { acquireStep, enchant: (b, t, g, sv) => enchantStep(b, t, g, sv, { workstation }) }),
        home: (bot, task, goal, save, stage) => homeStep(bot, task, goal, save, stage, homeActions()),
        // A bed from a remembered village: dug up, it drops itself.
        village_bed: (bot, task, goal, save, stage) => takeVillageBed(bot, task, goal, save, stage.village, homeActions()),
        gather_wool: async (bot, task, goal, save) => {
          // The supervisor: ten minutes with no new wool sets the search
          // aside for twenty, and the ladder goes on without a bed for now.
          if (watch(goal, 'bed_search', 'wool', woolCarried(bot).total, { better: 'higher', stallMs: 10 * 60 * 1000, restMs: 20 * 60 * 1000,
            why: 'ten minutes without finding a sheep' }).stalled) { save(); return; }
          await gatherWool(bot, task, goal, save, null, homeActions());
        },
        stash_valuables: (bot, task, goal, save) => stashValuables(bot, task, goal, save, homeActions()),
        // Endermen in view are hunted; with none, a turn of an expedition or
        // an exploring leg, and the endermen met on the way are taken.
        pearl_patrol: async (bot, task, goal, save) => {
          const stage = goal.step;
          const trips = sideTrips(bot, goal, decisionClient);
          const pick = patrolChoice(bot, trips);
          if (pick === 'hunt') { goal.step = { ...stage, patrol: 'hunt' }; save(); await acquireStep(bot, task, 'ender_pearl', countOf(bot, 'ender_pearl') + (stage.count || 1), goal, save); return; }
          if (pick !== 'search') {
            goal.step = { ...stage, patrol: pick }; save();
            if (goal.patrolSaid !== pick) { goal.patrolSaid = pick; bot.chat?.(`No endermen about. ${trips[pick].says || pick.replaceAll('_', ' ')} meanwhile, and take any enderman I meet.`); }
            try { await trips[pick].run(bot, task, goal, save); }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'strategy_side', pick, err, 10 * 60 * 1000); }
            return;
          }
          // Nothing else to do: the hunt's own search, as before.
          await acquireStep(bot, task, 'ender_pearl', countOf(bot, 'ender_pearl') + (stage.count || 1), goal, save);
        },
        // Pearls from the warped forest (warped-pearls.js).
        warped_pearls: (bot, task, goal, save, stage) => require('./warped-pearls').warpedPearls(bot, task, goal, save,
          { navigate, acquireStep, notice: (b2, g2, sv2) => noticeLandmarks(b2, g2, sv2, { force: true }),
            tunnel: (b2, t2, g2, sv2, target) => tunnelStep(b2, t2, g2, sv2, target, { dig, navigate }) }, stage || goal.step),
        // Wolves sit before a crossing and stand again after (wolves.js).
        wolves: (bot, task, goal, save, sit) => require('./wolves').commandWolves(bot, task, goal, save, sit),
        // Back for a death's drops (corpse-run.js).
        corpse_run: (bot, task, goal, save) => require('./corpse-run').corpseRunStep(bot, task, goal, save, { move: navigate }),
        // A chest on the spot when home is too far (field-cache.js).
        cache_valuables: (bot, task, goal, save) => require('./field-cache').cacheValuables(bot, task, goal, save, homeActions()),
        take_cache: async (bot, task, goal, save) => {
          const { nearCache, emptyCache } = require('./field-cache');
          const near = nearCache(bot, goal);
          return near ? emptyCache(bot, task, goal, save, homeActions(), near.cache) : false;
        },
        find_stronghold: (bot, task, goal, save) => findStronghold(bot, task, goal, save, {
          navigate, explore, surfaceStep,
          tunnel: async (bot, task, goal, save, target, resource) => {
            if (pickaxeTier(bot) < 1) { await acquireStep(bot, task, 'stone_pickaxe', 1, goal, save); return; }
            await resourceTunnelStep(bot, task, goal, save, target, resource, { dig, navigate });
          },
        }, decisionClient),
      
  };
}

const lootActions = () => ({ approach: approachWorkstation, open: openChest, navigate });

async function runIdle(bot, task, goal, store, { survival, decisionClient, recoveryAdviser, onStep = () => {}, until = () => false, backoffMs = 3000 } = {}) {
  survival ||= createSurvival(bot, { state: goal.survival, client: decisionClient });
  goal.survival = survival.state;
  const save = () => store.save(goal);
  protectConstruction(bot, goal);
  recallWorkstations(bot, goal);
  recoveryAdviser ||= createRecoveryAdviser(bot, decisionClient);
  let failures = 0;
  watchStalls(bot, () => goal); task.stallCheck = () => checkStall(bot);
  try {
  while (!until()) {
    task.interruptCheck = undefined;
    // A stall is answered first, before anything can throw it again.
    const stall = takeStall(bot);
    if (stall) { await inCatch(task, goal, () => answerStall(bot, task, goal, save, stall, { client: decisionClient, survival, onStep, idle: true })); failures = 0; save(); onStep(goal); continue; }
    task.check(); updateDigCapabilities(bot);
    try {
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task);
        if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
      }
      await keepRoom(bot, task, goal);
      noticeVillage(bot, goal, save);
      noticeLandmarks(bot, goal, save);
      const acted = await survival.step(task, goal, save, onStep) || await lootNearby(bot, task, goal, save, lootActions());
      if (!acted) await idleWork(bot, task, goal, save, decisionClient, onStep);
      failures = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); narrate(bot, goal);
    } catch (err) {
      task.interruptCheck = undefined;
      if (err.name === 'Stalled' || bot._stalls?.stall) continue;
      task.check();
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) failures++;
      noteError(goal, err); save(); onStep(goal);
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) recoveryAdviser.recordFailure(goal, err);
      if (failures >= 3 && await inCatch(task, goal, () => tryRecovery(recoveryAdviser, task, goal, save))) { failures = 0; continue; }
      // Survival never gives up either: shake loose, back off, go again.
      if (failures >= 5) { await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { client: decisionClient, survival })); failures = 0; continue; }
    } finally { task.interruptCheck = undefined; }
    for (let n = 0; n < 10 && !bot._stalls?.stall; n++) { task.check(); await sleep(100); }
  }
  } finally { if (bot._stalls) bot._stalls.goalOf = null; task.stallCheck = undefined; }
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
  watchStalls(bot, () => goal); task.stallCheck = () => checkStall(bot);
  try {
  // The loop yields to the event loop every pass and never spins: a step
  // that returns without waiting on anything real (a synchronous throw
  // swallowed by a handler) ran thousands of passes a second, the server
  // timed the player out and the process sat at 110% CPU four evenings
  // running. Every pass lets I/O run; more than twenty passes a second
  // is a spin, logged with the step so it can be found, and slowed.
  let passes = [];
  for (let n = 0; n < (goal.kind === 'follow' ? Infinity : goal.kind === 'build' ? Math.max(maxSteps, 30000) : maxSteps); n++) {
    await new Promise(resolve => setImmediate(resolve));
    const now = Date.now(); passes = passes.filter(t => now - t < 1000); passes.push(now);
    if (passes.length > 20) {
      if (passes.length === 21 || passes.length % 200 === 0) console.log(`[loop] spinning: ${passes.length} passes in a second at ${JSON.stringify(goal.step).slice(0, 200)} survival=${JSON.stringify(goal.survivalAction).slice(0, 160)} error=${goal.lastError || ''}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    task.interruptCheck = undefined;
    // A stall (stillness.js) is answered first, before anything can throw
    // it again: the same thing differently, something else, or later.
    const stall = takeStall(bot);
    if (stall) {
      await inCatch(task, goal, () => answerStall(bot, task, goal, save, stall, { client: decisionClient, survival, onStep }));
      goal.failures = 0; goal.stalls = 0; save(); onStep(goal); continue;
    }
    task.check();
    updateDigCapabilities(bot);
    // Every tick starts with the configured movement policy: leaked
    // restrictions from a step that threw are not carried into the next.
    if (bot._movementDefaults && bot.pathfinder?.movements) Object.assign(bot.pathfinder.movements, bot._movementDefaults, { scafoldingBlocks: [...bot._movementDefaults.scafoldingBlocks] });
    // Say what the last step started on. Here rather than at the loop's end,
    // because survival and continued work leave the loop body early.
    noticeVillage(bot, goal, save);
    noticeLandmarks(bot, goal, save);
    noticePortal(bot, goal, save);
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
        goal.failures = 0; goal.stalls = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); continue;
      }
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task);
        if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
      }
      // End combat owns eating and arena escape. Overworld nighttime shelter
      // choices are invalid in the End, where the dragon can destroy them.
      await keepRoom(bot, task, goal);
      if (!endTask && await survival.step(task, activeWork, saveWork, () => onStep(goal))) {
        goal.stalls = 0; goal.failures = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); continue;
      }
      task.interruptCheck = bot.game.gameMode === 'creative' || endTask ? undefined : () => checkThreats(bot);
      // Air and eating carried food are rules, not judgments: there is no
      // request that is better served by staying hungry with bread in hand.
      if (!endTask) {
        await maintainVitals(bot, task, step => { goal.survivalAction = { ...step, at: new Date().toISOString() }; save(); onStep(goal); });
      }
      if (!endTask && await upkeepStep(bot, task, goal, save, decisionClient, onStep)) { goal.stalls = 0; save(); onStep(goal); continue; }
      // A structure's chest within reach is opened as a rule (looting.js).
      if (goal.kind === 'win' && !endTask && await inCatch(task, goal, () => lootNearby(bot, task, goal, save, lootActions()))) { goal.stalls = 0; save(); onStep(goal); continue; }
      // Work starts on dry ground. A crafting table placed from a pool under
      // the base failed and failed, the bot bobbing for air in between.
      const feetBlock = typeof bot.blockAt === 'function' ? bot.blockAt(bot.entity.position.floored()) : null;
      if (!endTask && feetBlock?.name && swimmableWater(feetBlock)) {
        try { if (!dryStanding(bot, bot.entity.position) && await reachShore(bot, task, goal, save)) { goal.stalls = 0; save(); onStep(goal); continue; } }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
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
      delete goal.lastError; delete goal.lastErrorAt;
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
      // Progress ends a struggle: the persistence counter is for one stuck
      // stretch, not a lifetime tally read out in chat as "attempt 50".
      if (!unchanged && goal.struggles) { goal.struggles = 0; }
      // A restock that changes nothing (the chest does not hold what its
      // record says, or the kit slot is already met another way) would be
      // planned again at once: the replay run restocked a furnace forty
      // times over. Its items rest for a quarter of an hour.
      if (goal.stalls > 30 && goal.step?.action === 'restock') for (const move of goal.step.items || []) setAside(goal, 'restock_item', move.item, 'no measurable progress', 900000);
      if (goal.stalls > 30) throw new Blocked(`No measurable progress on ${JSON.stringify(goal.step)}`);
    } catch (err) {
      task.interruptCheck = undefined;
      if (err.name === 'Stalled' || bot._stalls?.stall) continue;
      task.check();
      noteError(goal, err);
      if (err.name === 'DesignRepair') { save(); onStep(goal); continue; }
      if (err.name === 'NeedsAir' || err.name === 'NeedsSafety') { save(); onStep(goal); continue; }
      // A partial craft/build can change inventory before its promise fails.
      // Replan that observed progress; only consecutive no-progress errors
      // exhaust retries.
      goal.failures = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 2 &&
        constructionBefore === constructionObservation(bot, goal) ? goal.failures + 1 : 0;
      recoveryAdviser.recordFailure(goal, err);
      // A state only the player can settle is parked before any recovery:
      // no recovery option changes whether a handover was picked up.
      const parked = err.name === 'Blocked' && (err.needsPlayer || IMPOSSIBLE.test(err.message));
      if (!parked && (err.name === 'Blocked' || goal.failures >= 3) && await inCatch(task, goal, () => tryRecovery(recoveryAdviser, task, goal, save))) {
        goal.failures = 0; goal.stalls = 0; save(); onStep(goal); continue;
      }
      // Parked, not retried: a request no survival route can serve, or a
      // state only the player can settle (items dropped for them whose
      // pickup nobody saw). The regex is the old list; `needsPlayer` is
      // how a new case says so without adding to it.
      if (err.name === 'Blocked' && (err.needsPlayer || IMPOSSIBLE.test(err.message))) {
        // Impossible is final and resume passes over it; waiting on the
        // player is not, and "Jev resume" takes it up again.
        goal.status = 'blocked'; if (!err.needsPlayer) goal.impossible = true; save();
        bot.chat(`${friendlyProblem(err)} I saved our progress. ${recoveryHint(err)}`);
        return { ok: false, reason: err.message, goal };
      }
      if (err.name === 'Blocked' || goal.failures >= 5) {
        // The step that failed, not the last retry: a step that throws
        // before it names itself leaves the retry's name on the goal.
        if (goal.step?.action !== 'persist') goal.lastStruggleStep = goal.step;
        await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { client: decisionClient, survival }));
        continue;
      }
      await sleep(300);
    } finally { task.interruptCheck = undefined; }
    save(); onStep(goal);
  }
  goal.status = 'blocked'; goal.lastError = 'Action budget reached'; save();
  bot.chat('This is taking a while. I saved our progress. Say "Jev resume" to keep going.');
  return { ok: false, reason: goal.lastError, goal };
  } finally { stopObserving(); if (bot._stalls) bot._stalls.goalOf = null; task.stallCheck = undefined; }
}

// Placement in Creative consumes no inventory. Observe the actual construction
// blocks, including cleared obstructions, when deciding whether work progressed.
function constructionObservation(bot, goal) {
  const positions = [...(goal.blueprint?.blocks || []), ...(goal.blueprint?.empty || []), ...(goal.portalFrame?.blocks || [])];
  return JSON.stringify(positions.map(p => [p.x, p.y, p.z, bot.blockAt(pos(p))?.stateId ?? bot.blockAt(pos(p))?.name ?? null]));
}

module.exports = { logInView, patrolChoice, maintainBlocks, upkeepStep, moreOfSource, whileCooking, workstation, noteError, localBatch, smelt, turnSearch, searchFor, enterPortal, gameHandlers, breakStillness, reachableBlocks, hitboxIntrudes, terrainShortage, runGoal, runIdle, idleWork, idleOptions, createSurvival, acquireStep, inventory, planningInventory, catalogPlan, selectSite, explore, smelt, dig, place, waitFor, constructionObservation, Blocked, designedBuildStep, surfaceStep, answerStall, looseEnds, breakOut };
