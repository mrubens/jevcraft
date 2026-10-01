'use strict';
const { move } = require('./motion');
const { attemptsFor, setAside, isSetAside, watch, unwatch } = require('./progress');
const { DAY } = require('./day');
const { relocationsTried, relocationSays, noteRelocation } = require('./route-aside');
const { STALL_MS, GROUND, watchStalls, unwatchStalls, checkStall, takeStall, recordStill } = require('./stillness');

const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, equipBestTool, pickaxeTier, pickaxeDurability, countOf, shakeLoose, openWindow, closeStrayWindow } = require('./skills');
const { MINEABLE, TOOL_TIERS } = require('./plan');
const { houseBlueprint, verifyHouse } = require('./objectives');
const { deliver } = require('./delivery');
const { reservedForConstruction, portalSiteClear, selectPortalSite, portalSiteDig, portalSupports } = require('./build-sites');
const { updateDigCapabilities } = require('./movement');
const { resourceTunnelStep, tunnelStep, staircaseResting, safeExcavation } = require('./tunneling');
const { maintainVitals, checkAir, needsAir, chooseFood, digWithAirGuard, safeFood } = require('./vitals');
const { decide, question } = require('./decisions');
const { Survival, inWater, lavaExit, shelterNeeded, mobSourceAbout } = require('./survival');
const { checkThreats, safeFromHostiles, immediateThreat } = require('./danger');
const { resourceSources, nearestRemaining, decisionFingerprint, setAsideSource, rememberSource, committedSource } = require('./decision-options');
const { reviewDesign } = require('./design-review');
const { narrate } = require('./narration');
const { planCatalog, sourceBlocks, elsewhereOf } = require('./knowledge');
const { takeCreativeItem, clearCreativeInventory } = require('./creative');
const { surfaceObserver, surfaceMovement, descendCanopy, returnToSurface, beginSurfaceAscent, surfaceReturnComplete, handDiggableExit, tripCost } = require('./surface');
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
const { strategyStep, rungTakes, pickaxeLeft } = require('./strategy');
const { openChest } = require('./chest-delivery');
const { barterStep, gatherBastionGold } = require('./bartering');
const { descendPillar, pillarUp, pillarSite } = require('./pillar-recovery');
const { gameStep, watchGameProgress, dimension, nextGameStage, DEFERRABLE, RUNG_WAIT_MS, agoSays, asideStands } = require('./game-progress');
const { carriedEquipment } = require('./mob-policy');
const { huntObserved, prepareMobHunt, prepareCombatGear } = require('./mob-hunt');
const { findStronghold } = require('./stronghold');
const { enterEnd } = require('./end-portal');
const { fightEndStep } = require('./end-combat');
const { exitEnd } = require('./end-exit');
const { prepareEndSupplies } = require('./end-supplies');
const { collectWater, waterKnown, holdsWater } = require('./water');
const { makeObsidian, collectLava } = require('./obsidian');
const { castFrame, castLacksWater, leaveNoWater, castSays, plannedWalls, lavaTrip, fetchTrip, fetchSays, tripsCost, castTrips, duration } = require('./portal-cast');
const { tidyInventory, roomFor, makeRoom, crowded } = require('./inventory-tidy');
const { homeStep, homeChores , gatherWool, woolCarried } = require('./home-base');
const { stashValuables, restockFromStash } = require('./home-stash');
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
  // When, for a question asked again after its answer ended this way
  // (decisions/repeats.js, note 560).
  // With the answer then being carried out, so a failure is said on the
  // answer it ended and not on one given before it (tried.js ownFailure).
  const by = require('./tried').answerNow(goal);
  goal.lastFailure = { why: String(err.message).slice(0, 200), at: Date.now(), ...(by ? { by } : {}) };
  const frames = String(err.stack || '').split('\n').filter(line => /\/src\//.test(line)).map(line => line.trim().replace(/^at /, '').replace(/\(?\/.*\/src\//, '(src/'));
  // Where a failure came from, past the shared primitives: "navigation
  // ended" five times over said nothing about which walk it was.
  goal.lastErrorFrom = frames.filter(f => !/src\/(skills|motion)\.js/.test(f)).slice(0, 2).join(' < ') || undefined;
  if (!(err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError)) { delete goal.lastErrorAt; return; }
  goal.lastErrorAt = frames.slice(0, 3).join(' < ');
  if (!reportedBugs.has(err.message)) { reportedBugs.add(err.message); console.error('[bug]', err.stack); }
}

class Blocked extends Error { constructor(message) { super(message); this.name = 'Blocked'; } }
// A block on the building site the bot did not put there is someone's, and
// only a player can say it may go. Waiting on the player, not retried: the
// Creative bot tried an oak slab in its chicken house 5,630 times over a day
// and a half, saying so every seventy-five seconds (2026-09-25). The block
// is watched, and the build goes on by itself once it is gone.
function siteChanged(bot, p) {
  const name = bot.blockAt(p)?.name;
  return Object.assign(new Blocked(`The building site changed at ${p}; preserving the unexpected ${name}. Clear it or request a new build`),
    { needsPlayer: true, waitOn: { x: p.x, y: p.y, z: p.z, name, dimension: String(bot.game?.dimension || 'overworld') } });
}

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

// The pickaxe that goes down must have enough left to come back up, and
// eight logs go with it (crossing-kit.js, where the Nether's kit is said).
const { SPARE_PICKAXE_DURABILITY, EXPEDITION_LOGS, logsCarried, kitItems, valuablesAt, NETHER_HUNGER_AN_HOUR } = require('./crossing-kit');
const WOOD = /_log$|_planks$|^stick$/;
const woodCarried = bot => bot.inventory.items().filter(i => WOOD.test(i.name)).reduce((n, i) => n + i.count, 0);
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
  // The search is turned, not dropped: dropped, a search for wood across a
  // desert began again from its first heading at every stall and zig-zagged
  // (trial 17, 2026-09-24). Turned whatever the stall's answer: only
  // "another way" turned it, and first-days-217, its wood search spent,
  // was sent to look around by Jev each time and came back to a search
  // that failed at once, thirty-two times (2026-09-26).
  goal.search = turnSearch(goal.search);
  delete goal.tunnel; delete goal.surfaceReturn;
  if (goal.miningSites) for (const site of Object.values(goal.miningSites)) { delete site.workPosition; site.rejoinBlockedUntil = now + 600000; }
  if (goal.mobHunt) { attemptsFor(goal).clearAction('hunt_target'); delete goal.mobHunt.stalking; }
  if (goal.fortressSearch) {
    delete goal.fortressSearch.target;
    const fs = goal.fortressSearch, found = fs.found;
    // A fortress known by its extent (mob-hunt.js fortressAnchor) is one
    // place: the stall is the way that stalled, kept on its approach, not
    // sixteen blocks of it set aside for the next pass to take the nearest
    // brick past them as a fortress found anew (25588, note 706).
    // Nor set aside where no approach to it was under way yet (a wait to heal
    // before the visit, a walk to its blazes): a stall is a failure said on
    // the next asking, never a leave (fortress-hold.js, note 721). The stall
    // began the approach's record of this fortress instead.
    if (found) {
      const same = fs.approach?.found && require('./mob-hunt').sameFortress(fs, fs.approach.found, found);
      const a = same ? fs.approach : (fs.approach = { found: { x: found.x, y: found.y, z: found.z }, failed: [] });
      a.failed = [...(a.failed || []), { choice: a.choice || 'the approach', why: 'the step stalled on the way in (no measurable progress)', at: now }].slice(-8);
      delete a.choice; delete a.until;
    }
  }
  goal.lastStallAt = now;
}

// A stall (stillness.js) is answered by Jev, whatever stalled: the same
// thing done differently, the rung left for later, or something else useful
// from here for a while (breakStillness), with how many times it has stalled
// as a fact. A survival action that
// stalled is refused by the survival layer for ten minutes
// (Survival.report), which falls through to its next answer; nothing more
// is needed here.
const walksFailed = (...errors) => /navigation timed out|without reaching new ground|No route|noPath|No path to the goal|No reachable surveyed ground|Took to long to decide path|The walk is not begun/i.test(errors.filter(Boolean).join(' '));
// A key with no thing named in it ("rung:none") is the work in hand: said
// "Keep at the none" to 25591 on its islet (critic 11:36Z item 1, note 751).
const thingOf = key => { const t = key.replace(/^\w+:/, '').replace(/^rung:/, '').replace(/:/g, ' ').replaceAll('_', ' ').trim(); return !t || /^none\b/.test(t) ? 'work in hand' : t; };
// The rung's own question (note 571): its budget ran ten minutes with no
// new best (tried.js watchRung), or a way below had nothing left to try and
// escalated to it. Asked as the stall's question is, with the rung's best,
// what has been tried, keeping at it, and the rung set aside for any rung.
const isRungStall = stall => !!stall.rung || stall.escalated?.to === 'rung_progress';
// How often the rung's question is put off when cut off before it is asked
// (runGoal), before it is let go as any stall is.
const RUNG_PUT_OFF = 20;
// A stall answered (`answer`, inCatch's result: true when a turn-taking
// error cut it off), or, the rung's question cut off before it went out,
// put off (stillness.js deferStall) for a later pass. -> answered
async function answerOrPutOff(bot, stall, answer) {
  const cut = await answer() === true;
  if (!(cut && isRungStall(stall) && !stall.asked && (stall.deferred || 0) < RUNG_PUT_OFF)) return true;
  require('./stillness').deferStall(bot, stall);
  console.log(`[rung] its question put off, cut off before it was asked: ${String(stall.rung?.says || stall.escalated?.says || stall.key).slice(0, 160)}`);
  return false;
}
// What is above the stall's question when the rung's question will not be
// asked: nothing, and why. Escalated there anyway, the stall came back to
// its own question at once with the same ways resting, and escalated again:
// 52,000 times in the idle loop on 25586, and twenty-odd passes a second
// on 25587 with the errand set aside (note 609). Undefined: the rung's
// question is above it and is asked.
function stallAbove(goal, { idle = false, now = Date.now() } = {}) {
  if (idle) return { parent: null, says: 'Between player requests: no rung is being worked on, so nothing above this question is asked; every way here stays on offer with its rest said.' };
  const rung = goal.rungTime?.phase;
  if (rung && isSetAside(goal, 'rung', rung, now)) return { parent: null, says: `The ${rung.replaceAll('_', ' ')} is set aside, and a rung set aside is not brought to its own question while it waits: nothing above this question is asked; every way here stays on offer with its rest said.` };
  return undefined;
}
// The way straight at a failed walk's goal, as the stall's answer, or null
// (note 785): the goal about level (three blocks) and within 64 across,
// the crossing's survey coming nearer, not resting from here.
function straightToward(bot, task, goal, save, walk, now = Date.now()) {
  try {
    const nt = require('./nether-travel'), fp = require('./failed-places');
    const g = walk.goal, here = bot.entity?.position;
    if (!g || !here || !Number.isFinite(g.y) || Math.abs(g.y - here.y) > 3 || Math.hypot(g.x - here.x, g.z - here.z) > 64 || typeof bot.blockAt !== 'function') return null;
    const target = new Vec3(Math.floor(g.x), Math.floor(g.y), Math.floor(g.z));
    if (nt.crossingResting(bot, goal, target)) return null;
    const survey = require('./bridging').surveyCrossing(bot, target, { cells: nt.CROSS_STRETCH });
    if (!survey.cells || survey.gain < 1) return null;
    const what = `where the last walk was going, (${target.x}, ${target.y}, ${target.z})`;
    const failed = `The walk there from about here failed ${Math.max(1, Math.round((now - walk.at) / 1000))} seconds ago: ${fp.KIND_SAYS[walk.kind] || walk.kind}${Number.isFinite(walk.blocks) ? `, ${Math.round(walk.blocks)} blocks walked` : ''}${Number.isFinite(walk.left) ? `, ending ${Math.round(walk.left)} blocks from it` : ''}.`;
    return { target: { x: target.x, y: target.y, z: target.z }, description: `${failed} ${nt.crossingSays(survey, `${what}, ${Math.round(Math.hypot(target.x - here.x, target.z - here.z))} blocks off`)}`,
      run: async () => { await nt.crossToward(bot, task, goal, save, target, { what, anywhere: true }); } };
  } catch (_) { return null; }
}
async function answerStall(bot, task, goal, save, stall, { client, survival, onStep = () => {}, idle = false, now = Date.now(), failed = null, chose = {}, recoveryAdviser = null } = {}) {
  const stats = survival?.state || goal.survival || goal;
  // A stall of the stall's own answer (a detour, persist, work free) is the
  // stall of the work it answered, named as that (note 763b): 25595
  // (mid-243-ap, 21:14Z) was offered "Keep at the detour until rest ends
  // another way", a question about its own detour.
  const own = /^(detour|persist|shake loose|work free)\b/.test(thingOf(stall.key));
  const thing = own ? thingOf(goal.step?.from || (goal.rungTime?.phase ? `rung:${goal.rungTime.phase}` : 'none')) : thingOf(stall.key);
  const tried = require('./tried');
  // A rung set aside is not brought to its own question while it waits
  // (tried.js rungOf): the stall's question is asked instead (note 600).
  const rungAside = !!goal.rungTime?.phase && isSetAside(goal, 'rung', goal.rungTime.phase, now);
  const rungQuestion = isRungStall(stall) && !idle && !rungAside;
  // The stall's question escalates to the rung's only where the rung's is
  // asked: not between requests, and not for a rung set aside (note 609).
  const above = rungQuestion ? undefined : stallAbove(goal, { idle, now });
  // Stuck in the terrain (in water, or under cover on the way up): worked
  // free one move at a time, Jev choosing each (unstuck.js). Trials 32 and
  // 33 each stalled here in a trap the escape routines had no answer for.
  // No reachable ground at all is walks failing too: mid-230-a, perched
  // at y 71 by a spruce, was asked a heading every three seconds and chose
  // south each time, and every one found no ground to walk to; working free
  // was never on offer (2026-09-26).
  // The last walk off that found no route is a walk failing too: on 25600
  // "the walk off got 0 of 8 blocks ... (No route from here to ...)" was
  // said at every asking from a ledge of its own stairs, and working free
  // was never offered (note 588).
  const wayOff = (goal.survival || goal).wayOffShort;
  // And the walks' own record (failed-places.js, note 785): a walk from about
  // here whose route failed in the last two minutes, whatever the step's
  // failure said.
  const failedWalk = require('./failed-places').lastFailedWalk(bot, { now });
  const walksFailing = walksFailed(stall.error, goal.lastError, wayOff && now - wayOff.at < DETOUR_MEMORY_MS ? wayOff.error : null) || !!failedWalk;
  const terrain = client && bot.game?.gameMode === 'survival' && require('./unstuck').aimFor(bot, { walksFailing });
  if (stall.layer === 'survival') {
    recordStill(stats, stall.key, STALL_MS, { now, detour: terrain ? 'work_free' : 'refused' }); save();
    // Not begun again unasked where a spell ended on a minute of moves that
    // gained nothing (note 684): that went up to the question above.
    const rests = terrain && require('./unstuck').spellRests(goal, bot.entity.position.floored(), now);
    if (terrain && !rests) { await inCatch(task, goal, () => require('./unstuck').workFree(bot, task, goal, save, { client, dig })); return; }
    if (stall.strikes === 1) bot.chat?.(`${thing[0].toUpperCase()}${thing.slice(1)} isn't getting me anywhere. Something else, then.`);
    return;
  }
  // In the Nether, the answers that meet it, read before the loose ends
  // are dropped (the leg's target among them): nether-travel.js.
  const nether = require('./nether-travel').netherAnswers(bot, task, goal, save, { survival, actions: { navigate, portalHere, returnOverworld: returnFromNether, acquire: acquireStep, acquireStep, client, dig,
      mineAt: (b, t, g, sv, p, block, drops) => mine(b, t, { action: 'mine', block, sources: [block], drops, count: 1 }, g, sv, p),
      mineOne: (p, block) => mine(bot, task, { action: 'mine', block, sources: [block], drops: block, count: 1 }, goal, save, p) } });
  // What the stall drops whatever the answer, said on the answers that
  // read as carrying on (note 677): "as it is going" had been said with the
  // found fortress already set aside ten minutes and the shaft dropped.
  const droppedSays = (() => {
    const d = [];
    const fs = goal.fortressSearch;
    if (fs?.found && fs.fortressAt && fs.approach?.found && require('./mob-hunt').sameFortress(fs, fs.approach.found, fs.found)) d.push('the way in that stalled is kept as failed on the fortress\'s approach');
    else if (fs?.found) d.push('the fortress found is set aside ten minutes');
    else if (goal.fortressSearch?.target) d.push('the search\'s target is dropped');
    if (goal.tunnel) d.push('the shaft it was digging is dropped');
    if (goal.surfaceReturn) d.push('the climb out is dropped');
    if (goal.miningSites && Object.values(goal.miningSites).some(s => s.workPosition)) d.push('the mining sites are not rejoined for ten minutes');
    if (goal.mobHunt?.stalking) d.push('the hunt\'s mark is dropped');
    if (goal.search) d.push('the search turns to a heading not tried');
    return d.length ? ` Whatever is answered, the stall has already set aside what sent it back here: ${d.join(', ')}.` : '';
  })();
  looseEnds(goal, now);
  const answers = {};
  // A patch of a resource is the stalled work's own only when the stall is
  // that mine's: at the rung's stall, a mine the upkeep was on (wood for
  // sticks, say) is not the rung's work. 25589 (mid-243-kd, 15:24:11Z) was
  // offered "leave this patch of oak log" for its portal rung, the lava
  // fetch stalled (note 753c).
  const mine = [goal.step, goal.lastStruggleStep].find(step => step?.action === 'mine' && step.block && !(/^rung:/.test(String(stall.key || '')) && !String(stall.key).includes(step.block)));
  // Kept with the world's survival state, as the heading is.
  const turn = goal.survival || goal;
  // The last "another way" that reached no fresh ground, said: mid-230-s's
  // walk eight blocks off moved two, its failure was swallowed, and the new
  // shaft began from the same spot (note 485).
  const short = turn.wayOffShort && now - turn.wayOffShort.at < DETOUR_MEMORY_MS ? turn.wayOffShort : null;
  const shortSays = short && `the last time, the walk off got ${short.moved} of ${short.aimed} blocks from (${short.from.x}, ${short.from.y}, ${short.from.z}), no fresh ground${short.error ? ` (${short.error})` : ''}`;
  // Another way, from ground eight blocks off, only while a way not in the
  // ledger is left from here: when every way tried for this work lately was
  // tied to its own target, a step off leaves none of them behind, and the
  // planner derives the same way again (25592: other_way 4,423 times, each
  // hold answered "differently", note 571). Said, when left out.
  // The ledger keys its entries by the work (stillness.js actionOf), which
  // on the game's ladder is the rung; a failed step's stall is keyed by the
  // step. Read by the step's key, the rung's question said "nothing tried
  // lately is in the ledger" beside "every way ... has been tried" (note 583).
  const work = stall.work || stall.key;
  const bound = tried.placeBound(goal, { work, now });
  const differentlyOpen = !bound.any || bound.byPlace > 0;
  const noDifferently = !differentlyOpen ? `another way from ground eight blocks off is not offered: every way tried for the ${thing} lately (${bound.byTarget}) was toward its own target and rests from anywhere near here, so a step off leaves none of them behind` : null;
  if (!idle && differentlyOpen) answers.differently = { description: mine
    ? `Keep at the ${thing} another way: leave this patch of ${String(mine.block).replaceAll('_', ' ')} for one further off.${moveOnHistorySays(goal, mine.drops || mine.block)}`
    : `Keep at the ${thing} another way: step eight blocks off to fresh ground and come at it again from there; the search turns to a heading not tried, and the shaft or site it was using is dropped.${shortSays ? ` Chosen before: ${shortSays}.` : ''}`,
  run: async () => {
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
      const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; turn.detourHeading = heading;
      const angle = heading * Math.PI / 4, here = bot.entity.position.floored(), start = bot.entity.position.clone();
      const target = here.offset(Math.round(Math.cos(angle) * 8), 0, Math.round(Math.sin(angle) * 8));
      let failed = null;
      try { await navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, 2), { timeoutMs: 15000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; failed = err; }
      // How far it got, kept for the next question: fresh ground is the
      // stall rule's own measure (stillness.js GROUND).
      const moved = bot.entity.position.distanceTo(start);
      if (moved > GROUND.radius) delete turn.wayOffShort;
      else {
        turn.wayOffShort = { at: Date.now(), from: { x: here.x, y: here.y, z: here.z }, aimed: 8, moved: Math.round(moved), ...(failed ? { error: String(failed.message || failed).slice(0, 120) } : {}) };
        save();
      }
    }
  } };
  // The lava pool chosen is not what "another way" drops (note 767e): the
  // step off is to come at it again, the pool kept. 25593 (2026-10-01
  // 03:14:54Z) answered rung_progress "differently" beside its pool 17
  // blocks off, and the fetch then set off for one 410 blocks away.
  const lavaKept = goal.lavaFetch?.lava && /^(pool|dig)$/.test(goal.lavaFetch.way) ? goal.lavaFetch.lava : goal.lavaChosen?.at;
  if (answers.differently && lavaKept && !mine) answers.differently.description += ` The lava chosen at (${lavaKept.x}, ${lavaKept.y}, ${lavaKept.z}) is kept: the fresh ground is another way to it, not to other lava.`;
  // The block the mine step digs, carried, for a drop that is not the block
  // itself (note 749e): 25590 circled a pit for flint from 18:08 to 18:23Z,
  // 829 blocks walked within 13 blocks, "I can't get at the gravel here"
  // twice, carrying 8 gravel the whole time. A player puts one down and digs
  // it. Offered with its odds where they are known.
  const ownBlock = mine && mine.drops && mine.drops !== mine.block && bot.registry?.blocksByName?.[mine.block] ? countOf(bot, mine.block) : 0;
  if (ownBlock) {
    const odds = DROP_ODDS[mine.block]?.[mine.drops];
    const want = Math.max(1, (mine.count || 1) - countOf(bot, mine.drops));
    answers.dig_own = { description: `Put down the ${ownBlock} ${String(mine.block).replaceAll('_', ' ')} carried, one at a time beside the bot, and dig each for its ${String(mine.drops).replaceAll('_', ' ')}: no walk and no search, ${want} wanted.${odds ? ` Each dug gives ${String(mine.drops).replaceAll('_', ' ')} about one time in ${Math.round(1 / odds)}: with ${ownBlock}, about ${Math.round((1 - (1 - odds) ** ownBlock) * 100)} in 100 that one comes; a failed one gives the ${String(mine.block).replaceAll('_', ' ')} back to put down again.` : ''}`,
      run: async () => { await digOwn(bot, task, mine, want); } };
  }
  const walled = terrain ? (() => { try { const u = require('./unstuck'); return u.walledSays(u.liveView(bot), bot.entity.position.floored()); } catch (_) { return null; } })() : null;
  // A way straight up through rock overhead, when there is one (note 635):
  // the stall's answer is a choice of local moves, and on a span over the lava
  // sea none of the single blocks led anywhere.
  const rising = terrain ? (() => { try { const u = require('./unstuck'); return u.risePlan(u.liveView(bot), bot.entity.position.floored()); } catch (_) { return null; } })() : null;
  const risingSays = rising?.move ? ` One of its moves is a rise straight up through the rock over the head, ${rising.move.rise} blocks to open space at y ${rising.move.top}, about ${rising.move.seconds} seconds, with the blocks it lays taken from the pack and then the rock dug on the way.` : '';
  const spellSays = terrain ? (() => { try { const r = require('./unstuck').spellRests(goal, bot.entity.position.floored()); return r ? ` The last: ${r}.` : ''; } catch (_) { return ''; } })() : '';
  // At the cage with the rods in hand (cage-hold.js, note 700): the fight
  // there is the plan. Working free is said as leading away from it, and a
  // slit opened toward the cage and a stay to fight are offered beside it.
  const cage = !idle ? require('./cage-hold').cageFight(bot, goal) : null;
  if (terrain) answers.work_free = { description: `Work free of the terrain one move at a time, choosing each move (walk, climb, dig, place a block, pillar, swim): ${terrain.aim}${terrain.says ? ` (${terrain.says})` : ''}.${walled ? ` It is ${walled}.` : ''}${cage ? require('./cage-hold').workFreeSays(cage) : ''}${risingSays}${spellSays}`,
    run: () => require('./unstuck').workFree(bot, task, goal, save, { client, dig, aim: terrain }) };
  // Where the walks fail from here, the way that changes the bot's height is
  // its own answer, priced, not a move inside working free: 25589's
  // work_free said the rise to y 96 (22 seconds) in passing, and Jev chose
  // walk_off, relocations of two blocks and hunts whose walks found no way
  // for nine minutes on one ledge (note 775).
  if (rising?.move && walksFailing && !idle) answers.rise_through = { description: `${rising.move.does} The walks from here have found no route${stall.error ? ` (${String(stall.error).slice(0, 160)})` : ''}; this changes the height the work is come at from, and the work is taken up again from the top.`,
    run: async () => {
      const u = require('./unstuck');
      await u.perform(bot, task, rising.move, { dig });
      if (Math.floor(bot.entity.position.y) < rising.move.top) throw new Error(`The rise stopped at y ${Math.floor(bot.entity.position.y)}, short of y ${rising.move.top}`);
    } };
  if (cage) Object.assign(answers, require('./cage-hold').stallAnswers(bot, task, goal, save, cage, { dig, now, navigate }));
  // Straight at where the failed walk was going, at this height, where its
  // route failed (no route, the search out of time, a stall, ended short)
  // and the place is about level: the crossing's own survey and price, in
  // any dimension (note 785). The Nether's own (netherAnswers, the leg's or
  // the portal's target) comes first. 25593's walk to its lava 27 blocks
  // off at its own height failed on the pathfinder's search time, and
  // nothing ever came at it another way.
  if (!idle && failedWalk && !nether.cross_toward) {
    const straight = straightToward(bot, task, goal, save, failedWalk, now);
    if (straight) answers.cross_toward = straight;
  }
  const rung = goal.rungTime?.phase;
  // What the rung is for and what half an hour without it costs (the
  // decision audit, 2026-09-25).
  const { RUNG_WHY, WITHOUT } = require('./strategy');
  const piece = /^iron_(helmet|chestplate|leggings|boots)$/.test(rung || '') ? 'iron_armour' : rung;
  const rungWhy = rung ? RUNG_WHY[rung] || RUNG_WHY[piece] : null;
  // Asked as the rung's question, any rung may be set aside: one the game
  // cannot be beaten without says so, and the ladder takes up what it can
  // do meanwhile (the rods' own question is leave_nether).
  const needed = rung && !DEFERRABLE.has(rung) ? ' The game cannot be beaten without it: for those thirty minutes the ladder goes on with whatever else it can do, and the rung comes back first after.' : '';
  // How much the rung has had, and what the ladder goes on with instead,
  // from here: on 25583 the rods were set aside thirty seconds into a trial
  // at a fortress, told nothing of either, for pearls from a warped forest
  // whose walk came to nothing at once and then spun (note 583).
  // Brought here by a failure below rather than its ten minutes (an
  // escalation): said, with how far into them.
  const byEscalation = rungQuestion && !stall.rung;
  const worked = rung && rungQuestion ? tried.workedOn(goal, { work, here: bot.entity.position, now, escalated: byEscalation }) : null;
  const nextRung = rung && rungQuestion ? await nextRungSays(bot, task, goal, rung, now) : null;
  const instead = nextRung?.text || null;
  // Nothing else the ladder could go on with (every other rung already
  // resting, or none left): the option's own promise, "go on with the next
  // thing", cannot be kept. 25581 (mid-243-if) chose set_aside_rung twice in
  // three minutes with only the reach nether not resting, and came straight
  // back each time, "I set it aside 7 seconds ago" then "1 second ago",
  // 167 minutes without a milestone (critic 08:17Z, note 736).
  const nothingElseToRunWith = nextRung?.nothingElse === true;
  // Every way below resting until a time (an escalation, decisions/index.js
  // escalateFrom): when the first comes off rest.
  const restUntil = stall.until > now ? stall.until : 0;
  // A rung comes to its question by a failure below only once the work's
  // own questions have nothing left to try from here (escalate, never
  // re-ask, note 571); brought here with ways still untried below (a plan
  // passed over for not being asked), it is not set aside: the question
  // below is asked next with its ways, and that is said. On 25590 the rods
  // were set aside 3.2 minutes into a trial from a fortress save with
  // fortress_leg's legs, floors, heights and restock never tried, and waited
  // thirty minutes (note 605). Its ten minutes running out still offers it.
  const untriedBelow = byEscalation && worked?.openBelow?.length ? worked.openBelow : null;
  const untriedSays = untriedBelow ? untriedBelow.map(o => `${o.q.replaceAll('_', ' ')} (${o.keys.map(k => k.replaceAll('_', ' ')).join(', ')})`).join('; ') : '';
  const setAsideNotOffered = untriedBelow ? `setting the ${rung.replaceAll('_', ' ')} aside is not offered: it was brought here by a failure below, and ways below it have not been tried from here: ${untriedSays}`
    : nothingElseToRunWith ? `setting the ${rung.replaceAll('_', ' ')} aside is not offered: every other rung is already resting, so there is nothing else for the ladder to go on with; it would come straight back` : null;
  // Not offered for the rods while the bot is at a live spawner that still
  // owes them (cage-hold.js cageFight): the game is handing them over right
  // there, so leaving them for thirty minutes is not a real choice (25589,
  // critic 05:44Z, 06:04Z: `set_aside_rung` taken while standing at the
  // cage with blazes about, note 725).
  const atLiveSpawnerForRods = rung === 'obtain_blaze_rods' && cage;
  if (rung && !rungAside && (DEFERRABLE.has(rung) || rungQuestion) && !setAsideNotOffered && !atLiveSpawnerForRods) answers.set_aside_rung = { description: `Leave the ${rung.replaceAll('_', ' ')} for thirty minutes and go on with the next thing the game needs; it comes back afterwards.${rungWhy ? ` It is for this: ${rungWhy}.` : ''}${WITHOUT[piece] ? ` For those thirty minutes, ${WITHOUT[piece]}.` : ''}${needed}${worked ? ` Worked on this rung ${worked.says}.` : ''}${instead ? ` ${instead}` : ''}`,
    run: async () => {
      setAside(goal, 'rung', rung, `Jev set it aside at the rung's question${worked ? `, worked on ${worked.says}` : `, stalled ${stall.strikes} times`}`.slice(0, 300), RUNG_WAIT_MS); delete goal.rungTime;
      // What it was set aside for, from where, and until when that stands:
      // the ways below resting from here, or the ledger's own rest for an
      // answer (tried.js REST_MS). Taking it up again reads this (note 600).
      const at = bot.entity.position;
      goal.rungAside = { phase: rung, at: now, where: { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }, until: restUntil || now + tried.REST_MS,
        why: String(stall.escalated?.says || stall.rung?.says || stall.error || `stalled ${stall.strikes} times`).slice(0, 300) };
      bot.chat?.(`I keep getting stuck on the ${rung.replaceAll('_', ' ')}. I'll come back to it.`);
    } };
  // A rung set aside earlier is offered back whenever the work in hand
  // stalls, said with why and when it was left, what its rest has left,
  // where its work is and what the ledger holds of it: whether to cut its
  // rest short is Jev's. On 25600 the rods were set aside for the pearls,
  // the pearls stalled for ten minutes with the fortress 66 blocks off, and
  // no question offered the rods again (note 588).
  const takeBack = !idle && goal.kind === 'win' ? require('./game-progress').takeBackRungs(bot, goal, now) : [];
  const takeUpNotOffered = [];
  for (const back of takeBack) {
    const words = v => String(v || '').replaceAll('_', ' ');
    // Not taken up again while what it was set aside for still stands from
    // here: on 25583 the rods were set aside at 11:33:56 and taken up at
    // 11:33:57, told "set aside 1 minutes ago", and the same resting ways
    // brought the rung's question back in the same second (note 600). Said.
    const standing = asideStands(bot, goal, back.phase, now);
    if (standing) { takeUpNotOffered.push(standing); continue; }
    const clock = goal.rungClocks?.[back.phase];
    const place = takeBackPlace(bot, goal, back.phase, now);
    const survey = place?.target ? await surveySays(bot, task, place.target) : '';
    const lately = tried.summary(goal, { work: `step:rung:${back.phase}`, now });
    const aside = goal.rungAside?.phase === back.phase ? goal.rungAside : null;
    const from = aside?.where ? ` from (${aside.where.x}, ${aside.where.y}, ${aside.where.z}), ${Math.round(Math.hypot(aside.where.x + 0.5 - bot.entity.position.x, aside.where.z + 0.5 - bot.entity.position.z))} blocks from here` : '';
    answers[`take_up_${back.phase}`] = { takeBack: back.phase, description: `Take up the ${words(back.phase)} again now, its rest cut short: set aside ${agoSays(now - back.at)} ago${from} (${back.why})${aside?.why ? `, for this: ${aside.why}` : ''}; it would come back on its own in ${Math.max(1, Math.ceil((back.until - now) / 60000))} minutes.${rung ? ` The ${words(rung)} in hand waits meanwhile.` : ''}${clock?.activeMs ? ` Worked on it ${Math.max(1, Math.round(clock.activeMs / 60000))} minutes in all so far.` : ''}${place ? ` ${place.says}` : ''}${survey}${lately ? ` Tried for it lately: ${lately.slice(0, 3).join('; ')}.` : ''}`,
      run: async () => {
        require('./game-progress').takeBackRung(goal, back.phase); save();
        bot.chat?.(`Back to the ${words(back.phase)}.`);
      } };
  }
  // Every way to the pearls from here, while they are the rung in hand
  // (pearl-routes.js): the ladder's one route stalling was answered only
  // with ways to keep at that route.
  let pearlsNotOffered = null;
  if (!idle && rung === 'obtain_ender_pearls') {
    const routes = require('./pearl-routes').pearlRoutes(bot, goal, { now, save, actions: { navigate } });
    for (const [key, option] of Object.entries(routes.options)) {
      const survey = option.surveyTo ? await surveySays(bot, task, option.surveyTo) : '';
      answers[key] = { description: `${option.description}${survey}`, ...(option.target ? { target: option.target } : {}), run: () => option.run(task) };
    }
    if (routes.notOffered.length) pearlsNotOffered = routes.notOffered;
  }
  // Every way to it resting until a time: other work until then, as one
  // choice that holds, with the minutes said. mid-226-f kept its resting
  // portal way and answered the rest met again with "differently" forty-two
  // times, each an eight-block walk of seconds, until the rest ended; the
  // loop auditor counted the same failure four times over (note 490).
  if (restUntil) {
    const minutes = Math.max(1, Math.ceil((restUntil - now) / 60000));
    // The ways below resting from here (an escalation): they rest by place,
    // and the rung stays the one in hand. The rung's question offered only
    // keeping at it, another way or thirty minutes set aside (note 600).
    const below = stall.escalated && !stall.flip ? String(stall.escalated.from || 'the question below').replaceAll('_', ' ') : null;
    // What the hold has on offer from here, said before it is chosen: with
    // nothing, the answer is the bot standing idle until the rest ends, and
    // said as that. On 25598 (mid-242-bb-nether-1-fortress-9) "other work
    // ... chosen here a piece at a time" was chosen twelve times in half an
    // hour in the Nether, where the hold had nothing to offer, and each was
    // 45 seconds of standing (note 675).
    const work = await restWork(bot, task, goal, save, { survival, now });
    const idleWait = !work.length;
    const mins = `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const offerSays = restWorkSays(bot, work, { until: restUntil, now });
    // What upkeep has on offer is a real way beside the wait, offered here
    // as its own answer: asked with the gather only inside the hold, the
    // 25598 question was answered none good six times in six; with the
    // gather beside it, eight in eight took it (note 675).
    for (const w of work.filter(w => UPKEEP_WORK.includes(w.key))) answers[w.key] = { description: `${w.description} The ${thing} is taken up again after it; the rest runs on meanwhile.`, run: w.run };
    answers.until_rest_ends = { description: idleWait
      ? `Wait here for the ${mins} until ${below ? `the first of the ${below}'s ways comes off its rest here` : 'its rest ends'}. ${offerSays} The ${thing} stays the work in hand and is taken up again then; waiting does not end the rest sooner${below ? ', and ground eight blocks off (another way) leaves these rests behind' : ''}.`
      : below
      ? `Other work for the ${mins} until the first of the ${below}'s ways comes off its rest here, chosen a piece at a time; the ${thing} stays the work in hand and is taken up again when that rest ends. ${offerSays} Ground eight blocks off (another way) leaves these rests behind; waiting here does not end them sooner.`
      : `Leave the ${thing} for the ${mins} until its rest ends and do other work meanwhile, chosen a piece at a time; the ${thing} is taken up again when the rest ends, and the rest met again before then goes back to that work, not to this question. ${offerSays} Nothing done here ends the rest sooner.`,
      // What it waits for (waits.js, note 698): idle, for a rest whose cause
      // standing still does not change, it waits for nothing and is not
      // offered (decide), said in the facts.
      waits: require('./waits').restEnds(bot, { what: below ? `the ${below}'s ways' rest here` : `the ${thing}'s rest`, until: restUntil, cause: stall.escalated?.says || stall.error || stall.rung?.says || '', idle: idleWait, now }),
      run: async () => {
        goal.restHeld = { until: restUntil, reason: stall.key, at: now, ...(idleWait ? { idle: true } : {}) }; save();
        await holdForRest(bot, task, goal, save, { client, survival, onStep, reason: stall.key, until: restUntil, why: stall.error || stall.escalated?.says, above, idle: idleWait });
      } };
    // The other answers' walks meet the same rest, said: a rest until a
    // time wherever the bot is (WaysResting), not the ways below by place.
    // A pair's rest holds within reach of where it traded (note 699):
    // fresh ground leaves it, and the two may go on there.
    if (stall.flip) {
      const pair = require('./flip-pairs').pairSays(stall.flip);
      answers.until_rest_ends.description = idleWait
        ? `Wait here for the ${mins} until the ${pair} come off their rest here. ${offerSays} The ${thing} stays the work in hand and is taken up again then.`
        : `Other work for the ${mins} until the ${pair} come off their rest here, chosen a piece at a time; the ${thing} stays the work in hand and is taken up again then. ${offerSays}`;
    }
    else if (answers.differently && !below) answers.differently.description += ` The way rests ${minutes} more minute${minutes === 1 ? '' : 's'} whatever is done: come at it again from fresh ground, it meets the same rest until then.`;
  }
  Object.assign(answers, nether);
  // The failed step again as it was: only this answer puts it back in hand
  // (persist), and not while it rests from here in the ledger.
  let againRests = null;
  // Two steps resting together from here (note 699): neither as it was.
  const pairHere = stall.flip ? require('./flip-pairs').resting(goal, stall.flip.pair, bot.entity.position, now) : null;
  if (failed?.action && !idle && stall.routeAside) againRests = `the ${String(failed.action).replaceAll('_', ' ')} step as it was: ${require('./route-aside').asideSays(stall.routeAside, now)}.`;
  else if (failed?.action && !idle && pairHere?.pair.includes(failed.action)) againRests = `the ${String(failed.action).replaceAll('_', ' ')} step as it was: it and the ${pairHere.pair.filter(n => n !== failed.action).map(n => n.replaceAll('_', ' ')).join(' and ')} rest together from here.`;
  else if (failed?.action && !idle) {
    const here = bot.entity.position, target = stepTarget(failed);
    const list = tried.about(goal, { q: 'step', method: failed.action, target, here, now });
    const until = tried.restsUntil(list, now);
    const said = tried.triedSays(list, { here, now, toward: !!target });
    if (until) againRests = `the ${String(failed.action).replaceAll('_', ' ')} step as it was: ${said} It rests ${Math.max(1, Math.ceil((until - now) / 60000))} more minutes from here.`;
    else answers.again = { description: `Try the ${String(failed.action).replaceAll('_', ' ')} step again as it was${failed.item || failed.block ? ` (${String(failed.item || failed.block).replaceAll('_', ' ')})` : ''}, from here.${said ? ` ${said}` : ''}`,
      run: async () => { chose.again = true; } };
  }
  // The recovery moves the code checks from here (recovery-options.js),
  // among these answers: they were a second question asked on the same
  // failures (recovery_action), and now one question answers a failure.
  if (stall.error && client && !idle && !rungQuestion) {
    let observed = null;
    const adviser = recoveryAdviser || createRecoveryAdviser(bot, client);
    try { observed = await adviser.observe(bot, task, goal, adviser.actions); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    // Each move keyed by what it is, and a move to a place by the number the
    // place was given when first offered (keys.js, note 749), not by its
    // place in the adviser's list.
    const K = require('./decisions/keys');
    // A move to footing a few blocks off, when the work fails the same way
    // after each such move from about here, is said as tried, and listed
    // after the rest: 25589's recover_relocate_1, 2 and 3 each moved two to
    // four blocks and the work's walk to a place 657 blocks off failed again
    // as before, the bot back on the same cell (note 775).
    const relocated = relocationsTried(goal, bot.entity.position, stall.error, now);
    const later = {};
    for (const option of (observed?.options || []).slice(0, 6)) {
      const what = `recover_${K.name([option.kind, option.item].filter(Boolean).join('_'))}`;
      const triedSays = option.kind === 'relocate' ? relocationSays(relocated, option, bot.entity.position, stall.error, now) : '';
      (triedSays ? later : answers)[option.position ? `${what}_${K.id(goal, what, option.position, { base: 1 })}` : what] = { ...(option.position ? { target: { x: option.position.x, y: option.position.y, z: option.position.z } } : {}), description: `${require('./recovery-adviser').describeOption(option)} A bounded move the code checked from here; the work is taken up again after it.${triedSays}`,
        run: async () => {
          if (option.kind === 'relocate') noteRelocation(goal, bot.entity.position, option.position, stall.error);
          adviser.adopt(goal, save, option, observed.context);
        } };
    }
    Object.assign(answers, later);
  }
  // Keeping at the rung, with what has been tried said: its budget starts
  // again, and the ways resting from here stay resting.
  const triedSaid = tried.summary(goal, { work, now });
  // With every way below resting from here, keeping at it here meets those
  // rests at the next pass, and this question comes again: said.
  const keepMeets = restUntil && stall.escalated && !stall.flip ? ` Every way the ${String(stall.escalated.from || 'question below').replaceAll('_', ' ')} had from here rests ${agoSays(restUntil - now)} more: kept at from here now, the next pass meets the same rests and this question comes again.` : '';
  // With ways untried below, keeping at it sends the work back to that
  // question, owed (tried.sendBack): the fortress search ends its walk and
  // asks its leg's question with them.
  const sendsBack = untriedBelow ? ` The ${untriedBelow.map(o => o.q.replaceAll('_', ' ')).join(' and the ')} question${untriedBelow.length === 1 ? ' is' : 's are'} asked next, with the ways not yet tried from here: ${untriedSays}.` : '';
  // Kept at from here, the work's next step is one of the two resting
  // together, and they trade again at once (note 699): not offered while
  // they rest, unless it sends the work back to a question below with ways
  // not tried, which is a way other than the two.
  const keepNotOffered = rungQuestion && pairHere && !untriedBelow
    ? `keeping at the ${thing} from here is not offered: its steps here are the ${require('./flip-pairs').pairSays(pairHere)}, which rest together ${agoSays(pairHere.until - now)} more`
    : null;
  if (rungQuestion && !keepNotOffered) answers.keep_at_it = { description: `Keep at the ${thing}, with the ways not yet tried or resting from here; the next ten minutes are measured again.${droppedSays}${sendsBack}${keepMeets}${triedSaid ? ` Tried lately: ${triedSaid.slice(0, 4).join('; ')}.` : ' Nothing tried lately is in the ledger.'}`,
    run: async () => {
      if (goal.tried?.rung) goal.tried.rung.idleMs = 0;
      for (const o of untriedBelow || []) tried.sendBack(goal, o.q, `the rung's question sent the work back here: ${stall.escalated?.says || 'a failure below'}`, now);
      save();
    } };
  // At the cage, keeping at it and the stay say what the stay there has come
  // to (cage-yield.js, note 702).
  if (cage) { try { require('./cage-yield').annotate(bot, goal, answers, now); } catch (_) { /* no record */ } }
  // What it is stuck on, named: a step for another dimension (note 476).
  const blocker = stall.blocker || require('./stillness').actionOf(goal, now).blocker;
  // A staircase set aside for want of ground gained is the failure, with
  // the landing and what blocked every step from it, while it rests: the
  // stall itself said only strikes (mid-230-s, note 485).
  const stairs = goal.staircaseStalled && now - goal.staircaseStalled.at < require('./tunneling').STAIRCASE_REST_MS ? goal.staircaseStalled : null;
  const failure = stall.error || (stairs && `the staircase is set aside: ${stairs.why}`);
  const castWait = castWaterWait(bot, goal);
  const stalled = { what: thing, strikes: stall.strikes, ...(failure ? { failure } : {}), ...(shortSays ? { lastWayOff: shortSays } : {}), ...(blocker ? { blocker } : {}), ...(rung && goal.rungTime?.activeMs ? { minutesOnRung: Math.round(goal.rungTime.activeMs / 60000) } : {}),
    ...(stall.rung?.says ? { rung: stall.rung.says } : {}), ...(triedSaid ? { tried: triedSaid } : {}), ...(stall.escalated?.says && !stall.flip ? { whatFailedBelow: stall.escalated.says } : {}),
    ...(stall.flip?.says ? { flipPair: stall.flip.says } : {}), ...(keepNotOffered ? { keepAtItNotOffered: keepNotOffered } : {}),
    ...(noDifferently ? { notOffered: noDifferently } : {}), ...(againRests ? { resting: againRests } : {}),
    ...(worked ? { workedOnRung: worked.says } : {}), ...(instead ? { setAsideGoesOnWith: instead } : {}), ...(stall.escalated?.passed?.length ? { passedOver: stall.escalated.passed } : {}),
    ...(pearlsNotOffered ? { pearlRoutesNotOffered: pearlsNotOffered } : {}), ...(takeUpNotOffered.length ? { takeUpNotOffered } : {}), ...(setAsideNotOffered ? { setAsideNotOffered } : {}),
    ...(castWait ? { lacking: castWait } : {}) };
  // Hurt where health does not come back, said on the options that leave it
  // out (healing.js noHealSays, note 639).
  try { require('./healing').withNoHealSays(bot, goal, answers); } catch (_) { /* no body */ }
  // Where the walks fail from here, the ways that change the bot's height
  // or line are named first, with their prices (note 775): the rise through
  // the rock, the crossing straight at the target, the floor below, the
  // pillar to a floor overhead. Relocations said as tried come last.
  {
    const first = walksFailing ? ['rise_through', 'cross_toward', 'floor_toward', 'pillar_up'].filter(k => answers[k]) : [];
    const last = Object.keys(answers).filter(k => /^recover_relocate/.test(k) && /Tried: /.test(answers[k].description || ''));
    if (first.length || last.length) {
      const ordered = {};
      for (const k of first) ordered[k] = answers[k];
      for (const [k, v] of Object.entries(answers)) if (!first.includes(k) && !last.includes(k)) ordered[k] = v;
      for (const k of last) ordered[k] = answers[k];
      for (const k of Object.keys(answers)) delete answers[k];
      Object.assign(answers, ordered);
    }
  }
  // Reached: the question goes out (a rung's question cut off before here
  // is put off to a later pass, runGoal).
  stall.asked = true;
  await breakStillness(bot, task, goal, save, { client, survival, onStep, reason: stall.key, now, answers, stalled, id: rungQuestion ? 'rung_progress' : 'stillness_detour', above });
}
// What the ladder goes on with if the rung is set aside, and what it costs
// from here, read from a copy of the goal with the rung left: the next
// rung, where its work is (a warped forest known, how far, and how the last
// walk there ended), and what the ledger holds of it from here.
// Returns null when this cannot be worked out from here (not a win goal, or
// the probe failed); otherwise { nothingElse: true } when leaving the rung
// aside would not change what the ladder does (every other rung is already
// resting, so the next stage computed is this same rung, or none at all), or
// { text } with what it would go on with instead.
async function nextRungSays(bot, task, goal, rung, now = Date.now()) {
  if (goal.kind !== 'win') return null;
  let next = null;
  try { const probe = JSON.parse(JSON.stringify(goal)); setAside(probe, 'rung', rung, 'left for now', RUNG_WAIT_MS); next = nextGameStage(bot, probe); }
  catch (_) { return null; }
  if (!next?.phase || next.phase === rung) return { nothingElse: true };
  const words = v => String(v || '').replaceAll('_', ' ');
  const here = bot.entity.position;
  const parts = [`Set aside, the ladder goes on with ${words(next.phase)}${next.action && next.action !== next.phase ? ` (${words(next.action)}${next.item ? `, ${next.count || ''} ${words(next.item)}`.replace(/ +/g, ' ') : ''})` : next.item ? ` (${next.count || ''} ${words(next.item)})`.replace(/ +/g, ' ') : ''}`];
  // A place the next rung's work goes to first: a landmark it walks to.
  const LANDMARK_OF = { warped_pearls: 'warped_forest', bastion_gold: 'bastion_remnant' };
  const kind = LANDMARK_OF[next.action];
  if (kind) {
    const exploration = require('./exploration');
    let known = [];
    try { known = exploration.knownLandmarks(bot, goal, kind, 512); } catch (_) { known = []; }
    if (!known.length) parts.push(`no ${words(kind)} is known: its work begins with a search for one`);
    else {
      const k = known[0], l = k.landmark, dy = Number.isFinite(l.y) ? Math.round(l.y - here.y) : null;
      const trip = `${l.kind}:${l.x},${l.z}`;
      const aside = isSetAside(goal, 'landmark_trip', trip, now);
      const why = aside ? attemptsFor(goal).why('landmark_trip', trip) : null;
      const w = l.lastWalk, walked = w ? `the last walk there (from (${w.from.x}, ${w.from.y}, ${w.from.z})) began ${w.began} blocks off and ended ${w.ended}${w.why ? `: ${w.why}` : ''}` : null;
      // Whether a way there is found from here: the pathfinder's own look,
      // half a second of it, said as it came out.
      let survey = null;
      if (!aside && bot.pathfinder?.movements && (bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) {
        try {
          const r = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNear(l.x, Number.isFinite(l.y) ? l.y : Math.round(here.y), l.z, 12), 500);
          survey = r?.status === 'success' ? `a route survey from here found a way there${r.lava?.beside ? ` (${r.lava.beside} of its cells with lava round them, ${r.lava.touching} with it a block to a side, walked crouched)` : ''}` : r?.status === 'noPath' ? 'a route survey from here found no way there' : 'a half-second route survey from here did not finish (far, or a long way round)';
        } catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
      }
      parts.push(`the nearest ${words(kind)} known is ${Math.round(k.distance)} blocks off${dy ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''} at (${l.x}, ${l.z})` +
        `${aside ? `, and the walk there is set aside: ${why || 'it came no nearer'}` : walked ? `; ${walked}` : '; no walk there has been tried'}${survey ? `; ${survey}` : ''}`);
      if (known.every(o => isSetAside(goal, 'landmark_trip', `${o.landmark.kind}:${o.landmark.x},${o.landmark.z}`, now))) parts.push(`with the walk to ${known.length === 1 ? 'it' : `each of the ${known.length} known`} set aside, its work begins with a search for another`);
    }
  }
  const lately = require('./tried').summary(goal, { work: `step:rung:${next.phase}`, now });
  if (lately) parts.push(`tried for it lately: ${lately.slice(0, 3).join('; ')}`);
  return { text: `${parts.join('; ')}.` };
}
// Where a rung taken back would go first, from here: the rods' fortress,
// how far, and whether the search has left it for now.
const RUNG_PLACE = { obtain_blaze_rods: 'nether_fortress' };
function takeBackPlace(bot, goal, phase, now = Date.now()) {
  const kind = RUNG_PLACE[phase];
  if (!kind) return null;
  let known = [];
  try { known = require('./exploration').knownLandmarks(bot, goal, kind, 1024); } catch (_) { known = []; }
  const words = String(kind).replaceAll('_', ' ');
  if (!known.length) return { says: `No ${words} is known: its work begins with a search for one.` };
  const k = known[0], l = k.landmark, here = bot.entity.position, dy = Number.isFinite(l.y) ? Math.round(l.y - here.y) : 0;
  const shunned = (goal.fortressSearch?.shunned || []).find(s => Math.hypot(s.x - l.x, s.z - l.z) < 32 && s.until > now);
  // The place kept is the first brick seen, a footing as often as a floor:
  // 25585 was told its fortress was "3 blocks off and 2 down", the bricks of
  // a pier, with its floors 26 up (note 692). The nearest floor mapped is
  // said beside it.
  let floor = null;
  const approached = goal.fortressSearch?.approach?.found;
  for (const key of [...Object.keys(goal.fortressSearch?.map?.cells || {}), ...(approached ? [`${approached.x},${approached.y},${approached.z}`] : [])]) {
    const [x, y, z] = key.split(',').map(Number);
    const d = Math.hypot(x + 0.5 - here.x, z + 0.5 - here.z);
    if (Math.hypot(x - l.x, z - l.z) <= 128 && (!floor || d < floor.d)) floor = { d, up: y + 1 - Math.floor(here.y) };
  }
  const floorSays = floor && Math.abs(floor.up) >= 2 ? `; that is a brick of it, and its nearest floor seen is ${Math.round(floor.d)} block${Math.round(floor.d) === 1 ? '' : 's'} off and ${Math.abs(floor.up)} ${floor.up > 0 ? 'up' : 'down'}` : '';
  return { target: { x: l.x, y: Number.isFinite(l.y) ? l.y : Math.round(here.y), z: l.z },
    says: `The nearest ${words} known is ${k.distance} blocks off${dy ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''} at (${l.x}, ${l.z})${floorSays}${shunned ? `; the search left it for ${Math.max(1, Math.ceil((shunned.until - now) / 60000))} more minutes` : ''}.` };
}
// Whether a way to a place is found from here: the pathfinder's own look,
// half a second of it, said as it came out (as nextRungSays does). On 25600
// every walk from the ledge of its own stairs had found no route, and a
// route offered without that was a route said as a walk.
async function surveySays(bot, task, t) {
  if (!t || !bot.pathfinder?.movements || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return '';
  try {
    const r = await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNear(t.x, t.y, t.z, 3), 500);
    return r?.status === 'success' ? ` A route survey from here found a way there.${r.lava?.beside ? ` ${require('./movement').lavaAlongSays(r.lava, bot)}` : ''}` : r?.status === 'noPath' ? ' A route survey from here found no way there.' : ' A half-second route survey from here did not finish (far, or a long way round).';
  } catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; return ''; }
}
// Where a step was going, for the ledger (tried.js): its target, its
// destination, the cell it worked; none, and the step is about its place.
function stepTarget(step) {
  const P = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : null;
  return P(step?.target) || P(step?.destination) || P(step?.to) || P(step?.cell) || P(step?.portal) || null;
}

// A spare is on offer when every pickaxe is nearly worn, or when the uses
// carried fall short of the step in hand and the way home after it
// (pickaxe-budget.js), with the makings in the pockets. Short was not
// said: mid-231-r went down 42 blocks of staircase with 226 uses and no
// wood, some 350 digs of step and climb, and the last pickaxe broke on
// the way up (notes 538, 543).
const spareDue = (bot, budget = null) => {
  if (bot.game?.gameMode === 'creative') return false;
  const pickaxes = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name));
  return pickaxes.length > 0 && (pickaxes.every(i => remainingUses(bot, i) < SPARE_PICKAXE_DURABILITY) || !!budget?.short) && sparePickaxeMaterials(bot);
};
// No pickaxe carried, out of Creative.
const pickaxeNeeded = bot => bot.game?.gameMode !== 'creative' && !bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
// What going on with no pickaxe costs, and the one the pockets make.
// `made` is the fortress search's own (mob-hunt.js pickaxeFirst, note 654):
// the best whose head is carried, and what from.
function makePickaxeSays(bot, made) {
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const uses = bot.registry?.itemsByName?.[made.item]?.maxDurability;
  return `Make ${made.name} now from what is carried (${made.from}), a few seconds at a crafting table: ${uses ? `${uses} uses` : 'a pickaxe'}. No pickaxe is carried: ${nether ? 'rock dug by hand takes about two seconds a block for netherrack and six to seven and a half for basalt and blackstone, and drops nothing' : `dirt and gravel dig by hand in about a second and drop, but ${require('./hand-dig').handPaceSays(bot, { climb: false })}`}${nether ? ', so no block comes back to lay over a gap or lava, and every leg, staircase, tunnel or crossing through rock is dug by hand' : ', and ore and stone need a pickaxe to drop at all'}.`;
}
// The pickaxe made from the pockets, one craft at a time (acquireStep
// takes one step a call), until one is carried.
async function makePickaxe(bot, task, goal, save, item) {
  for (let n = 0; n < 8 && pickaxeNeeded(bot); n++) { task.check(); await acquireStep(bot, task, item, countOf(bot, item) + 1, goal, save); }
  if (pickaxeNeeded(bot)) throw new Error(`The ${item.replaceAll('_', ' ')} was not made from what is carried`);
  return true;
}
// When a spare was last made, and how many since: said with the next
// spare_pickaxe offer, not left for the pickaxe count alone to explain
// (note 746: 25594 crafted a stone pickaxe six times in 31 minutes, each
// one worn straight back down re-mining the same ball of ground; without
// this, the option only ever said what was carried right then, never how
// often that had already happened).
const PICKAXE_CRAFT_MEMORY_MS = 40 * 60000;
// What became of the last spare, and the one kept whole (note 779).
function spareHistory(bot, goal) {
  let says = '';
  try { says = require('./pickaxe-roles').spareSays(bot, goal); } catch (_) { says = ''; }
  return says ? ` ${says}` : '';
}
function pickaxeCraftHistorySays(goal) {
  const list = (goal.pickaxeCraftHistory || []).filter(e => Date.now() - e.at < PICKAXE_CRAFT_MEMORY_MS);
  if (!list.length) return '';
  const minutes = Math.max(0, Math.round((Date.now() - list.at(-1).at) / 60000));
  return ` Made ${list.length} spare${list.length === 1 ? '' : 's'} in the last ${Math.round(PICKAXE_CRAFT_MEMORY_MS / 60000)} minutes, the last ${minutes < 1 ? 'under a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`} ago.`;
}
async function maintainPickaxe(bot, task, goal, save, budget = null) {
  if (!spareDue(bot, budget)) return false;
  if (!(goal.spareAnnouncedAt > Date.now() - 10 * 60 * 1000)) { goal.spareAnnouncedAt = Date.now(); bot.chat('My pickaxe is nearly done. Making a spare before it goes.'); }
  await acquireStep(bot, task, 'stone_pickaxe', countOf(bot, 'stone_pickaxe') + 1, goal, save);
  goal.pickaxeCraftHistory = [...(goal.pickaxeCraftHistory || []).filter(e => Date.now() - e.at < PICKAXE_CRAFT_MEMORY_MS), { at: Date.now(), kind: 'stone_pickaxe' }].slice(-10);
  save();
  return true;
}

// Sixteen building blocks carried, made up when short, the way the spare
// pickaxe is: cobblestone with a pickaxe, dirt without, netherrack in the
// Nether. Never in water or at night on the surface, and a gather that
// fails rests ten minutes.
// Six: three pickaxes and a table. With three, the midgame trials wore
// through their pickaxes deep in the mine and spent eighty-four of two
// hundred and twenty minutes climbing to the surface for wood, some of it
// by hand (2026-09-25).
const WOOD_RESERVE = 6;
// What having no wood deep underground has cost in the record (note 754,
// scripts/infeasible-options.js, 2026-09-29 00Z to 2026-09-30 12:50Z): spells
// of a minute or more in the Overworld under y 16 with no pickaxe and no log,
// plank or stick carried, until either was carried again. Said with
// wood_reserve underground: it kept losing to carry_on on 25589 and 25592,
// and each bot ended deep with no wood.
const NO_WOOD_DEEP = { from: '2026-09-29', spells: 7, minutes: 120, median: 17.5, longest: 28, afterCarryOn: 4 };
const noWoodDeepSays = () => ` In the record since ${NO_WOOD_DEEP.from}, a bot was under y 16 with no pickaxe and no wood ${NO_WOOD_DEEP.spells} times: a median ${NO_WOOD_DEEP.median} minutes each before it carried either again (the longest ${NO_WOOD_DEEP.longest}, ${NO_WOOD_DEEP.minutes} bot-minutes in all), ${NO_WOOD_DEEP.afterCarryOn} of them within half an hour of carry on chosen over this.`;
const inNetherNow = bot => /nether/.test(String(bot.game?.dimension || ''));
const woodUnits = bot => bot.inventory.items().reduce((n, i) => n + (/_log$|_stem$|_hyphae$|_wood$/.test(i.name) ? i.count : /_planks$/.test(i.name) ? i.count / 4 : i.name === 'stick' ? i.count / 8 : 0), 0);
const reserveWeather = bot => bot.game?.gameMode !== 'creative' && !bot.entity?.isInWater && !(bot.game?.dimension === 'overworld' && shelterNeeded(bot));
// Wood too, three logs' worth: the sticks for a pickaxe and a table. Worn
// pickaxes and no wood had the bot climbing out of its night mine by hand,
// a block every twenty-three seconds for four minutes.
const woodDue = (bot, goal) => reserveWeather(bot) && woodUnits(bot) < WOOD_RESERVE && /overworld/.test(String(bot.game?.dimension || 'overworld')) && !isSetAside(goal, 'block_reserve', 'wood');
const blocksDue = (bot, goal) => { const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy'); return reserveWeather(bot) && blockStock(bot) < BLOCK_RESERVE && !isSetAside(goal, 'block_reserve', 'gather'); };
// Wood chosen at upkeep is the climb for it chosen, said there with the
// depth and the pickaxes: not asked again as a surface trip (note 543).
const LOG_NEED = /\blog\b|wood/, UPKEEP_WOOD_MS = 15 * 60 * 1000;
async function gatherWood(bot, task, goal, save) {
  const have = woodUnits(bot);
  const species = (bot._catalogObservation?.nearby || []).find(name => /_log$/.test(name)) || 'oak_log';
  goal.step = { action: 'wood_reserve', item: species, have };
  goal.surfaceTrip = { need: 'wood', pick: 'climb', asked: true, by: 'upkeep', at: new Date().toISOString() }; save();
  // Round after round until the reserve is met or a round gains nothing: one
  // call to acquireStep is one log (or a craft along the way), not the whole
  // reserve, and a single call left upkeep re-asked after each with the wood
  // carried barely moved. 25581 (mid-243-if) asked upkeep 18 times in three
  // minutes, wood_reserve and spare_pickaxe repeating while the reach nether
  // rung's own portal distance grew (critic 08:17Z, note 736): the shape
  // gatherBlocks had before note 423, now fixed here the same way.
  try {
    for (let round = 0; round < WOOD_RESERVE + 1 && woodUnits(bot) < WOOD_RESERVE; round++) {
      const before = woodUnits(bot);
      await acquireStep(bot, task, species, countOf(bot, species) + Math.ceil(WOOD_RESERVE + 1 - woodUnits(bot)), goal, save);
      if (woodUnits(bot) <= before) break;
    }
  }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'block_reserve', 'wood', err, 600000); }
  finally {
    const gained = woodUnits(bot) - have;
    const tries = (goal.woodRounds || []).filter(r => Date.now() - r.at < 600000);
    goal.woodRounds = [...tries, { at: Date.now(), gained }].slice(-6);
    if (gained <= 0 && tries.filter(r => r.gained <= 0).length >= 1) setAside(goal, 'block_reserve', 'wood', 'wood sought twice in ten minutes and none gained', 600000);
    save();
  }
  return true;
}
async function gatherBlocks(bot, task, goal, save, { acquire = acquireStep } = {}) {
  const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy');
  const have = blockStock(bot);
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const item = nether ? 'netherrack' : pickaxeTier(bot) >= 1 ? 'cobblestone' : 'dirt';
  goal.step = { action: 'block_reserve', item, have }; save();
  // Round after round until the reserve is met or a round gains nothing: a
  // mining round ends after one block of stone or netherrack, and each end
  // was a new upkeep question, sixteen for a reserve of sixteen (the Fable
  // advice on note 423).
  try {
    try {
      for (let round = 0; round < BLOCK_RESERVE && blockStock(bot) < BLOCK_RESERVE; round++) {
        const before = blockStock(bot);
        await acquire(bot, task, item, countOf(bot, item) + (BLOCK_RESERVE - blockStock(bot)), goal, save);
        if (blockStock(bot) <= before) break;
      }
    }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'block_reserve', 'gather', err, 600000); }
  }
  // A round that gained nothing is a failure too, said on the option next
  // time and resting it after two: mid-202-l chose "mine netherrack" sixteen
  // times in seven minutes over the lava sea, each round a ten-second walk
  // that dug nothing, and with no blocks never made its way back to its
  // portal (note 423). A round a threat broke off is a round too, with what
  // it gained: mid-227-r's blaze knocked every round off the bridge before
  // the count, none was kept, and upkeep asked again every eight seconds
  // until a fireball threw it into the drop (2026-09-27).
  finally {
    const gained = blockStock(bot) - have;
    const tries = (goal.blockRounds || []).filter(r => Date.now() - r.at < 600000);
    goal.blockRounds = [...tries, { at: Date.now(), gained }].slice(-6);
    if (gained <= 0 && tries.filter(r => r.gained <= 0).length >= 1) setAside(goal, 'block_reserve', 'gather', `${item.replaceAll('_', ' ')} sought twice in ten minutes and none gained`, 600000);
    save();
  }
  return true;
}
// The last rounds of gathering blocks, said on the option.
function blockRoundsSay(goal) {
  const rounds = (goal.blockRounds || []).filter(r => Date.now() - r.at < 600000);
  if (!rounds.length) return '';
  const got = rounds.reduce((n, r) => n + Math.max(0, r.gained), 0);
  return ` Chosen ${rounds.length === 1 ? 'once' : `${rounds.length} times`} in the last ten minutes, and ${got ? `${got} gained` : 'none gained'}.`;
}
// Where the block the gather would go for is, from here: its distance,
// the climb, and the open drop under the straight line to it. mid-227-r,
// on a one-wide bridge over a forty-four block drop with two blocks left,
// was told netherrack "is all around and comes out in a moment"; the
// nearest it could dig were thirty blocks off across the void and fifteen
// up, and a blaze's fireball threw it off on the way (2026-09-27).
async function blockSourceSaid(bot, task, goal, item) {
  if (typeof bot.findBlocks !== 'function' && typeof bot.findBlocksAsync !== 'function') return '';
  let found = [];
  try { found = await miningCandidates(bot, task, { block: item, drops: item, sources: [item] }, goal); }
  catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return ''; }
  const what = item.replaceAll('_', ' '), here = bot.entity.position, feet = here.floored();
  const p = found.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  if (!p) return ` No ${what} with an open face is within 48 blocks of here that the gather could dig from: it would go looking.`;
  // A column is open drop where nothing stands within three blocks under
  // the bot's own level, a fall that hurts.
  const dx = p.x - feet.x, dz = p.z - feet.z, n = Math.max(Math.abs(dx), Math.abs(dz));
  let open = 0, deepest = 0;
  for (let i = 1; i < n; i++) {
    const x = Math.round(feet.x + dx * i / n), z = Math.round(feet.z + dz * i / n);
    let drop = 0;
    while (drop < 48 && bot.blockAt(new Vec3(x, feet.y - 1 - drop, z))?.boundingBox !== 'block') drop++;
    if (drop >= 3) { open++; deepest = Math.max(deepest, drop); }
  }
  const rise = p.y - feet.y;
  return ` The nearest ${what} the gather would go for is ${Math.round(p.distanceTo(here))} blocks off${rise >= 2 ? ` and ${rise} up` : rise <= -2 ? ` and ${-rise} down` : ''}` +
    (open ? `, across ${open} blocks of open drop on the straight line to it (${deepest >= 48 ? 'more than 48' : deepest} deep).` : ', with footing on the straight line to it.');
}
// Upkeep: a spare pickaxe before the one in hand wears out, and the wood and
// blocks a night or a climb needs. Whether now is the time is Jev's: it is
// asked when one falls short, with what is carried, and "carry on" holds
// for five minutes.
const UPKEEP_HOLD_MS = 5 * 60 * 1000;
// The base's bed is offered to take along within a short walk; food before
// dark within the last few minutes of day.
const NEAR_BED = 64, FOOD_BEFORE_DUSK_S = 180;
async function upkeepStep(bot, task, goal, save, client, onStep = () => {}) {
  const { options, budget } = await upkeepOffers(bot, task, goal, save);
  const due = Object.keys(options);
  if (!due.length) return false;
  // Falling short of the step and the way home is asked anew, whatever
  // was carried on from before.
  const keys = due.sort().join(',') + (budget?.short ? ':short' : '');
  if (goal.upkeepHold?.keys === keys && goal.upkeepHold.until > Date.now()) return false;
  // The route to the stems surveyed only for a question asked.
  if (options.fetch_stems?.describe) options.fetch_stems.description = await options.fetch_stems.describe();
  // With no pickaxe, what going on leaves the bot unable to do for the
  // hold's five minutes, and that the hold ends at the first way that fails
  // for want of one; and how the last carry-on ended, where it did so
  // (note 687).
  const bs = require('./block-stock');
  const noPick = pickaxeNeeded(bot) && (options.make_pickaxe || options.fetch_stems);
  // With a pickaxe carried in the Nether and a spare or its wood on offer,
  // the wear the carry-on goes on with (note 687).
  const wearNow = !noPick && inNetherNow(bot) && goal.kind === 'win' && (options.spare_pickaxe || options.fetch_stems) ? require('./pickaxe-budget').wearSays(bot, goal) : '';
  const ended = goal.upkeepHoldEnded && Date.now() - goal.upkeepHoldEnded.at < 15 * 60000 ? goal.upkeepHoldEnded : null;
  // At the fight by a spawner with a sword carried, the rods in hand need the
  // sword, not a pickaxe: said on the ways to one, and they are not put
  // first (cage-hold.js, note 700). 25591 was sent for stems 396 blocks off
  // from beside a live cage with a stone sword.
  const atCage = noPick ? require('./cage-hold').swordNotPickaxe(bot, goal) : null;
  if (atCage && options.fetch_stems) options.fetch_stems.description = `${options.fetch_stems.description.replace(require('./nether-wood').LATER, '')} ${atCage.leaves}`;
  if (atCage && options.make_pickaxe) options.make_pickaxe.description += ` ${atCage.makes}`;
  // Away from a known fortress with the rods wanted, anywhere: the distance
  // to it now and from where the stems are, and the health and hunger the
  // walk goes with (fortress-away.js, note 702; note 700 said it only at a
  // live spawner). 25590 left its fortress 52 blocks off at 14 health and
  // hunger 10 with nothing to eat for stems 140 blocks from it.
  const away = !atCage && options.fetch_stems ? require('./fortress-away').awaySays(bot, goal, options.fetch_stems.place?.at, { owed: true }) : null;
  if (away) options.fetch_stems.description = `${options.fetch_stems.description.replace(require('./nether-wood').LATER, '')} ${away}`;
  options.carry_on = { description: `${atCage ? atCage.carryOn : `Carry on with ${goal.step?.action ? `the ${String(goal.step.item || goal.step.block || goal.step.action).replaceAll('_', ' ')}` : 'the work'} and see to this later;`} asked again in five minutes, or sooner if what is due here changes${noPick ? ' or a way chosen fails for want of a pickaxe' : ''}.${budget?.short ? ` The pickaxes carried then run ${budget.need - budget.usesLeft} digs short of the step in hand and the way home, the rest dug by hand.` : ''}${noPick ? `${bs.aheadByHandSays(bot, goal)}${bs.goingOnSays(bot, UPKEEP_HOLD_MS / 60000)}` : wearNow ? ` The pickaxes: ${wearNow}.` : ''}${ended ? ` The last carry-on ended early: ${ended.method} failed for want of a pickaxe (${ended.why}).` : ''}`,
    run: async () => { goal.upkeepHold = { keys, until: Date.now() + UPKEEP_HOLD_MS, ...(noPick ? { noPickaxe: true, since: Date.now() } : {}) }; delete goal.upkeepHoldEnded; save(); } };
  // The lead short: carry_on says what going on without one costs.
  const ways = ['make_pickaxe', 'fetch_stems'].filter(k => options[k]);
  const lead = atCage ? atCage.lead : noPick ? `No pickaxe is carried: ${ways.join(' or ')} gets one first.` : null;
  // Carrying on is first at the cage.
  if (atCage) { const first = { carry_on: options.carry_on, ...options }; for (const k of Object.keys(options)) delete options[k]; Object.assign(options, first); }
  const step = goal.step;
  let chosen = null;
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, run: async () => { chosen = k; await o.run(); } }]));
  try { await decideAction(bot, task, goal, save, client, onStep, tree, { situation: `${lead ? `${lead} ` : ''}${due.every(k => ['fetch_batch', 'leave_batch'].includes(k)) ? 'A batch left cooking in a furnace far off is done. Choose whether to go back for it, leave it for good, or carry on with the work.' : 'Something the bot keeps in its pockets is running short. Choose whether to see to it now or carry on with the work.'}` }, 'upkeep'); }
  finally { if (chosen === 'carry_on') goal.step = step; }
  // A pickaxe made is done: the work it was made for is the step again. Left
  // as the craft, the next asking offered "carry on with the wooden pickaxe"
  // a second after it was made, and read as the make never finished (25585,
  // 19:18:26; note 682).
  if (chosen === 'make_pickaxe' && !pickaxeNeeded(bot) && step) { goal.step = step; save(); }
  return chosen !== null && chosen !== 'carry_on';
}
// What upkeep has on offer from here, each with what it does and its run:
// asked at upkeep, and offered as work while a rest is waited out
// (holdForRest, note 675), where "carry on" had held it five minutes.
async function upkeepOffers(bot, task, goal, save) {
  const { blockStock, BLOCK_RESERVE } = require('./inventory-tidy');
  const options = {};
  const worn = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `${i.name.replaceAll('_', ' ')} (${remainingUses(bot, i)} uses left)`);
  // The uses carried against the step in hand and the way home after it,
  // looked at every pass; the wood known is looked for only when asking.
  let budget = null;
  if (goal.kind === 'win' && worn.length && bot.game?.gameMode !== 'creative') { try { budget = require('./pickaxe-budget').pickaxeBudget(bot, goal, { look: false }); } catch (_) { budget = null; } }
  let saying = null;
  const said = () => { if (saying === null) { try { saying = ` ${require('./pickaxe-budget').pickaxeBudget(bot, goal).says}`; } catch (_) { saying = ` The pickaxes carried: ${worn.join(', ')}.`; } } return saying; };
  // None carried at all, and one to be made from the pockets as they are:
  // a spare was offered only beside a pickaxe carried, and 25581 and 25592
  // searched the Nether for their fortresses with none, the makings of an
  // iron or a wooden one in their pockets, digging rock by hand at six
  // seconds a block that dropped nothing (note 655).
  const pick = pickaxeNeeded(bot) ? require('./mob-hunt').pickaxeFirst(bot) : null;
  const makeable = pick && !pick.carried && !pick.none && pick.item ? pick : null;
  if (makeable && reserveWeather(bot)) options.make_pickaxe = { description: `${makePickaxeSays(bot, makeable)}${craftRoomSays(bot)}`, run: () => makePickaxe(bot, task, goal, save, makeable.item) };
  // Wood in the Nether is its forests' stems: the planks' worth wanted for
  // the pickaxe to make now and a spare after it, against what is carried,
  // the nearest stems known and the way there. 25583 stood with thirty
  // ingots, no pickaxe and no wood, warped stems eleven blocks off, and
  // nothing offered them (nether-wood.js, note 658).
  if (inNetherNow(bot) && reserveWeather(bot) && (goal.kind === 'win' || pickaxeNeeded(bot))) {
    const nw = require('./nether-wood');
    const fetch = await nw.fetchStemsOffer(bot, task, goal);
    if (fetch) options.fetch_stems = { description: fetch.description, describe: fetch.describe, place: fetch.place, run: async () => {
      const done = await nw.fetchStems(bot, task, goal, save, { acquireStep });
      if (done.unmade) throw new Error(done.unmade);
    } };
    // Wood the one input missing, and a portal to go back by: the trip home
    // for it (iron, stone and trees there), priced beside the stems with the
    // walk back's record. 25595 (critic-20260930T1328Z item 1) stood in the
    // Nether with no pickaxe, 78 raw iron and no wood, offered only
    // fetch_stems (the one forest known 120 blocks off, no route) and
    // carry_on, its portal known (note 754).
    const mh = require('./mob-hunt');
    const pick = pickaxeNeeded(bot) ? mh.pickaxeFirst(bot) : null;
    if (pick?.none && goal.kind === 'win') {
      let homeBy = null, start = null;
      try { homeBy = mh.portalBack(bot, goal, bot.entity.position); start = homeBy ? mh.portalTripStart(bot, goal, homeBy) : null; } catch (_) { homeBy = null; }
      if (homeBy && start?.ok) options.return_for_wood = { description: mh.returnForKitSays(bot, homeBy, { goal }), run: () => returnFromNether(bot, task, goal, save) };
      // Stems known nearer than the portal: the fetch is named first, and
      // each says the two distances. 25584 (mid-244-gg, 17:12Z on 2026-09-30)
      // had warped stems 127 blocks west and its portal 429 off, chose
      // return_for_wood four times and then carry_on (note 751b).
      const stemAt = options.fetch_stems?.place?.at, here = bot.entity.position;
      if (stemAt && options.return_for_wood && homeBy?.portal) {
        const toStems = Math.round(stemAt.distanceTo(here)), toPortal = Math.round(Math.hypot(homeBy.portal.x - here.x, homeBy.portal.z - here.z));
        if (toStems < toPortal) {
          const f = options.fetch_stems, r = options.return_for_wood;
          delete options.fetch_stems; delete options.return_for_wood;
          const rest = { ...options };
          for (const k of Object.keys(options)) delete options[k];
          Object.assign(options, { fetch_stems: f, return_for_wood: r }, rest);
          const note = ` The stems known are ${toStems} blocks off, the portal ${toPortal}.`;
          r.description += note;
          const describe = f.describe;
          f.description += note;
          if (describe) f.describe = async () => `${await describe()}${note}`;
        }
      }
    }
  }
  // The wear sampled every pass, and in the Nether a spare offered beside
  // the one pickaxe carried while the pockets make one, said with the wear:
  // the Nether bots wore their last pickaxe through on the fortress search
  // with no spare ever offered (spareDue wants cobblestone), and every way
  // through rock and every block after was gone (note 687).
  const wear = require('./pickaxe-budget');
  if (worn.length && goal.kind === 'win') wear.wearOf(bot, goal);
  const netherSpare = inNetherNow(bot) && goal.kind === 'win' && bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).reduce((n, i) => n + i.count, 0) === 1 && reserveWeather(bot) && !spareDue(bot, budget) ? require('./mob-hunt').bestMakeable(bot) : null;
  if (netherSpare && !netherSpare.none) options.spare_pickaxe = { get description() { return `Make ${netherSpare.name} now as a spare, from what is carried (${netherSpare.from}), ${netherSpare.smelted ? 'about half a minute with the smelting' : 'a few seconds'} at a crafting table: ${wear.wearSays(bot, goal)}. In the Nether rock is dug and blocks come back only with a pickaxe: when the last one breaks, every leg, staircase and crossing through rock is dug by hand, dropping nothing, and no block comes back to span or pillar with.${pickaxeCraftHistorySays(goal)}${spareHistory(bot, goal)}`; },
    run: async () => { const unmade = await require('./mob-hunt').makePickaxe(bot, task, goal, save, { acquireStep }, netherSpare); if (unmade) throw new Error(`The spare was not made: ${unmade}`);
      goal.pickaxeCraftHistory = [...(goal.pickaxeCraftHistory || []).filter(e => Date.now() - e.at < PICKAXE_CRAFT_MEMORY_MS), { at: Date.now(), kind: netherSpare.item || 'pickaxe' }].slice(-10); save(); } };
  else if (spareDue(bot, budget)) options.spare_pickaxe = { get description() { return `Make a stone pickaxe now, a spare${budget?.short ? '' : `: the pickaxes carried are nearly worn out (${worn.join(', ')})`}, and one that breaks deep in a mine leaves the bot digging out by hand: ${require('./hand-dig').handPaceSays(bot)}.${budget ? said() : ''}${pickaxeCraftHistorySays(goal)}${spareHistory(bot, goal)}${craftRoomSays(bot)}`; }, run: () => maintainPickaxe(bot, task, goal, save, budget) };
  // Where the bot is decides what running short costs: at the trees it is a
  // minute's cutting; in the mine it is the climb out, and back.
  // The depth is to open sky over the column (surface.js), not to the
  // first grass or dirt, which a cave floor above or a sand desert got
  // wrong; and the trees are looked for, not assumed (the decision audit,
  // 2026-09-25).
  const depthOf = () => { if (!bot.entity?.position || typeof bot.blockAt !== 'function') return 0; try { return require('./surface').climbToSurface(bot, bot.entity.position) ?? 0; } catch (_) { return 0; } };
  const where = () => {
    const depth = depthOf();
    // With the pickaxes' uses said against the step and the way home, the
    // by-hand rates are in that; said alone, they led (note 543).
    if (depth >= 8) return ` The bot is about ${depth} blocks under the surface: choosing this now means that climb now (roughly ${require('./surface').climbMinutes(depth)} minutes with a pickaxe), and back down${budget ? '.' : `; with no wood when a pickaxe wears out down here, the climb is by hand: ${require('./hand-dig').handPaceSays(bot)} where the column overhead is open, about ${require('./hand-dig').handPace(bot).minutesUp(depth)} minutes by stairs from here.`}`;
    let treeNear = null;
    try { treeNear = typeof bot.findBlocks === 'function' ? find(bot, bot.registry.blocksArray.filter(b => /_log$|_stem$/.test(b.name)).map(b => b.name), 48, 1)[0] : null; } catch (_) { treeNear = null; }
    return treeNear ? ` A tree is ${Math.round(treeNear.distanceTo(bot.entity.position))} blocks away.` : ' No tree is in view from here.';
  };
  if (goal.kind === 'win' && woodDue(bot, goal)) options.wood_reserve = { get description() {
    // Underground this is a climb for wood, said as one; with the heads for
    // new pickaxes carried, only the sticks are missing (note 543).
    const heads = [['iron ingots', countOf(bot, 'iron_ingot')], ['cobblestone', countOf(bot, 'cobblestone') + countOf(bot, 'cobbled_deepslate')]].filter(([, n]) => n >= 3).map(([k, n]) => `${n} ${k}`);
    const up = depthOf() >= 8;
    return `${up ? `Go up for wood now${budget?.ahead ? ', before the step in hand' : ''}` : 'Cut a few logs now'}: ${Math.floor(woodUnits(bot) * 10) / 10} logs' worth of wood carried, and ${WOOD_RESERVE} make the sticks for three pickaxes and a crafting table wherever the bot is${heads.length ? ` (${heads.join(' and ')} carried for the heads)` : ''}.${where()}${budget ? said() : ` The pickaxes carried: ${worn.join(', ') || 'none'}.`}${up ? noWoodDeepSays() : ''}`; }, run: () => gatherWood(bot, task, goal, save) };
  // In the Nether the blocks are the crossings: mid-235-k, at its fortress
  // with none carried, was offered them three times as "seal a pocket for
  // the night", carried on, and every leg of its search stopped at the
  // first gap until the loop watch ended the trial (2026-09-27).
  const inNether = /nether/.test(String(bot.game?.dimension || ''));
  // In the Nether with no pickaxe and none to be made, netherrack dug by
  // hand drops nothing: the reserve cannot be gathered, so it is not offered
  // (25584 was offered it so, 17:04 to 17:16Z on 2026-09-30, note 751b).
  if (goal.kind === 'win' && blocksDue(bot, goal) && !(inNether && pickaxeNeeded(bot) && !makeable)) {
    const source = inNether ? await blockSourceSaid(bot, task, goal, 'netherrack') : '';
    options.block_reserve = { description: (inNether
      ? `Mine netherrack for building blocks now: ${blockStock(bot)} carried. Here every crossing over lava or a gap is laid a block a step, and a crossing with none stops at the first gap; a block of netherrack comes out in a moment with any pickaxe once the bot is at it${pickaxeNeeded(bot) ? `, and ${makeable ? 'none is carried: it is made first from what is carried' : 'none is carried and none can be made from what is carried: dug by hand, netherrack drops nothing'}` : ''}.${source} ${BLOCK_RESERVE} also seal a pocket or tower out of a hole.`
      : `Gather building blocks now: ${blockStock(bot)} carried, and ${BLOCK_RESERVE} seal a pocket for the night or tower out of a hole.`) + blockRoundsSay(goal), run: () => gatherBlocks(bot, task, goal, save) };
  }
  // Two things a night asks for, seen to before it comes (the user,
  // 2026-09-26): the base's bed taken along while it is near, and food
  // enough to heal on. The evening's deaths were out at night, too hungry
  // to heal (hunger under eighteen) with nothing to eat, among crowds.
  if (goal.kind === 'win' && /overworld/.test(String(bot.game?.dimension || ''))) {
    const hb = require('./home-base'), home = hb.homeOf(bot, goal);
    const standing = home?.bed ? hb.bedStatus(bot, home) : null;
    if (home?.bed?.claimedAt && standing?.placed && !standing.carried && !hb.bedCarried(bot) && !home.bed.carriedAt) {
      const foot = hb.layout(home).bed.foot, far = Math.round(new Vec3(foot.x, foot.y, foot.z).distanceTo(bot.entity.position));
      if (far <= NEAR_BED) options.take_bed = { description: `Take the base's bed along now, ${far} blocks away, before going on: then a night on the Overworld passes in seconds wherever it comes, instead of about eleven real minutes in a pocket or a night mine. Sleep is refused with a monster within about eight blocks of the bed, and in the Nether or the End a bed set down explodes. The spawn point goes wherever the bot last slept, and a death drops the bed with everything else.${tripTime(bot, far)}`,
        run: async () => { for (let i = 0; i < 4; i++) if (await hb.takeHomeBed(bot, task, goal, save, { navigate, dig, collectNearbyDrops })) return; } };
    }
    const { foodSupply } = require('./foraging'), { KIT_FOOD_POINTS } = require('./home-stash');
    const carried = foodSupply(bot), t = bot.time?.timeOfDay ?? 0, toDusk = Math.round(Math.max(0, DAY.DUSK - t) / 20);
    // Not where the survival layer would leave it to the ladder's food rung
    // (the crossing's reserve, the hunger met: note 771): chosen there, it
    // changed nothing (note 765: food_reserve 37 of 64 no-ops).
    const fe = require('./food-errand');
    if (carried < KIT_FOOD_POINTS && t < DAY.DUSK && toDusk <= FOOD_BEFORE_DUSK_S && !goal.stockFood && !(fe.reserveOnly(bot, carried) && fe.crossingReserve(goal))) options.food_reserve = { description: `Find food before dusk: ${carried} food points carried, hunger ${bot.food}, dusk (when the bot stops work for the evening; the dark comes about two minutes after) in about ${toDusk} seconds; chosen, the food is looked for as survival's need when it next has the turn. Health comes back only while hunger is eighteen or more; a night's fights at lower hunger are fought without healing.${foodReservePrice(bot, carried)}`,
      run: async () => { goal.stockFood = true; save(); } };
  }
  // A batch left cooking whose time is up, the bot away from its furnace:
  // the walk back is Jev's, priced, or the batch is left for good (note
  // 775). Taken back unasked, it was a walk of 207 to 657 blocks that found
  // no route, retried at every step.
  const lb = leftBatch(bot, goal);
  if (lb) {
    const w = leftBatchSays(bot, lb);
    if (!lb.noRoute) options.fetch_batch = { description: `Go back for the batch ${lb.left.away ? "in a furnace" : "left cooking"}: ${w.what} in the furnace at ${w.at}, ${lb.distance} blocks off, ${lb.left.away ? 'begun' : 'left'} ${w.ago} minute${w.ago === 1 ? '' : 's'} ago${lb.left.away ? ' and walked away from' : ''}; ${w.carried} ${String(lb.batch.item).replaceAll('_', ' ')} carried besides.${w.rungs} The walk there is ${w.walk}, and the work in hand waits meanwhile.${w.tried}`,
      run: async () => { delete lb.batch.left; save(); await smelt(bot, task, { item: lb.batch.item, from: lb.batch.from, fuelItem: lb.batch.fuelItem, count: lb.batch.count }, goal, save); } };
    options.leave_batch = { description: `Leave the batch where it is for good: ${w.what} in the furnace at ${w.at}, ${lb.distance} blocks off. It is not offered again; it is taken out only if the work brings the bot within ${LEFT_NEAR} blocks of the furnace, and the ${String(lb.batch.item).replaceAll('_', ' ')} wanted is made again from what is carried or gathered.${w.tried}`,
      run: async () => { lb.left.forgone = Date.now(); save(); } };
  }
  return { options, budget };
}

// Work within a sculk sensor's hearing or beside a shrieker that calls a
// warden: carry on, carry on crouched, or take the work out of its reach.
// mid-230-n ran from a creeper into the deep dark and made its obsidian at
// the lava there, digging and placing four blocks over a shrieker, and the
// warden it called killed it (notes 412, 414). Asked once per patch of
// sculk; the answer holds five minutes, the patch left thirty.
const SCULK_HOLD_MS = 5 * 60000;
async function sculkStep(bot, task, goal, save, client, onStep = () => {}) {
  if (!/overworld/.test(String(bot.game?.dimension || ''))) return false;
  const sculk = require('./sculk');
  const about = sculk.sculkAbout(bot);
  if (!about || !(about.withinHearing || (about.nearestShrieker !== null && about.nearestShrieker <= sculk.ZONE_REACH))) return false;
  const here = bot.entity.position.floored();
  const holds = (goal.sculkHolds || []).filter(h => h.until > Date.now());
  if (holds.some(h => Math.hypot(h.x - here.x, h.y - here.y, h.z - here.z) <= sculk.ZONE_REACH)) return false;
  const doing = goal.step?.action ? String(goal.step.item || goal.step.block || goal.step.action).replaceAll('_', ' ') : 'the work';
  const hold = extra => { goal.sculkHolds = [...holds, { x: here.x, y: here.y, z: here.z, until: Date.now() + SCULK_HOLD_MS, ...extra }]; save(); };
  // The nearest standing place out of every sensor's hearing and past the
  // shriekers' patch, for the way out.
  const heard = sculk.hearing(bot, 32), passable = require('./terrain').dryPassable;
  const ids = ['stone', 'deepslate', 'tuff', 'dirt', 'grass_block', 'cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'calcite', 'sculk']
    .map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  const quietAt = typeof bot.findBlocks === 'function' ? bot.findBlocks({ matching: ids, maxDistance: 32, count: 400,
    useExtraInfo: b => !/sculk_/.test(b.name) && passable(bot.blockAt(b.position.offset(0, 1, 0))) && passable(bot.blockAt(b.position.offset(0, 2, 0))) })
    .map(p => p.offset(0, 1, 0)).filter(p => !heard(p) && p.distanceTo(here) >= sculk.SENSOR_HEARS)
    .sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0] : null;
  const options = {
    carry_on: { description: `Carry on with ${doing} here as now.`, run: async () => hold() },
    work_crouched: { description: `Carry on with ${doing} here, walking crouched: a crouched step sets off no sensor, at about a third of walking speed. Digging, placing, eating and landing still do.`,
      run: async () => { bot._quietUntil = Date.now() + SCULK_HOLD_MS; hold({ crouched: true }); } },
  };
  if (quietAt) options.move_away = { description: `Take the work out of the sculk's reach: walk to a place ${Math.round(quietAt.distanceTo(here))} blocks off, out of every sensor's hearing, and pass over the lava and places remembered within ${sculk.ZONE_REACH} blocks of here for thirty minutes; ${doing} goes on from there, elsewhere.`,
    run: async () => {
      goal.quietZones = [...(goal.quietZones || []).filter(z => z.until > Date.now()), { x: here.x, y: here.y, z: here.z, until: Date.now() + sculk.ZONE_REST_MS }];
      hold(); bot._quietUntil = Date.now() + 60000;
      try { await navigate(bot, task, new goals.GoalBlock(quietAt.x, quietAt.y, quietAt.z), { timeoutMs: 30000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      finally { bot._quietUntil = 0; }
    } };
  let chosen = null;
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description + ' ' + about.says, run: async () => { chosen = k; await o.run(); } }]));
  const step = goal.step;
  try { await decideAction(bot, task, goal, save, client, onStep, tree, { situation: 'The work is within reach of sculk. Choose whether to carry on here as now, carry on crouched, or take the work out of its reach.', sculk: about.says }, 'sculk_work'); }
  finally { if (chosen !== 'move_away') goal.step = step; }
  return chosen === 'move_away';
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
  // Without a `what`, the caller: a bare timeout at crafting cost trials
  // 43, 46 and 48 nine seconds a time, and nothing said which wait it was.
  if (!detail) { const at = (new Error().stack || '').split('\n')[2]?.trim().replace(/^at /, '').replace(/\(.*\/(src\/[^)]+)\)/, '($1)'); if (at) detail = ` (in ${at})`; }
  throw new Error(`Timed out waiting for world/inventory update${detail}`);
}
const awaitedItem = (bot, item, want, context) => () => `${item.replaceAll('_', ' ')} after ${context} (have ${countOf(bot, item)} of ${want}, ${bot.inventory.emptySlotCount?.() ?? '?'} free slots${bot.inventory.selectedItem ? `, cursor ${bot.inventory.selectedItem.name}` : ''})`;

// Digging the block underfoot is a one-block drop when the block beneath it
// is solid and harmless: the way a player takes an ore they are standing on
// in a shaft with no side to step to. Anything deeper or molten is not.
function safeDropBelow(bot, p) {
  const under = bot.blockAt(p.offset(0, -1, 0));
  // Lava beside the cell dropped into runs into it with the bot standing
  // there: the drop was checked below and never beside.
  const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => /^(lava|fire|soul_fire)$/.test(bot.blockAt(p.offset(x, 0, z))?.name || ''));
  return under?.boundingBox === 'block' && !['lava', 'cactus', 'fire'].includes(under.name) && !require('./terrain').hotFloor(under) &&
    !['sand', 'gravel'].includes(under.name) && !beside;
}

// A floor block beside the feet with open air under it is a pit once it is
// dug, and the next step goes into it: trial 4 took a coal ore out of the
// floor it was standing by, the cave below it was ten blocks deep and
// floored with dripstone, and the fall killed it (2026-09-24). A player
// does not open a hole they have not looked into; the ore is left.
// Lava beside a block (level with it or above) runs into the gap and on,
// three blocks in the Overworld, more in the Nether: dug within its run of
// the bot, it reaches the bot before any answer. mid-207-f dug a block at
// y -55 beside a lava source a block from its feet; the lava was on it in a
// second and a half and it burned from twenty to none (2026-09-27). A hard
// rule, for the body's safety; what else to dig is the step's choice.
function opensLava(bot, p) {
  const lava = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => /^(lava|flowing_lava)$/.test(bot.blockAt(p.offset(x, y, z))?.name || ''));
  if (!lava) return false;
  const feet = bot.entity.position.floored(), run = String(bot.game?.dimension || '').includes('nether') ? 7 : 3;
  return Math.max(Math.abs(p.x - feet.x), Math.abs(p.z - feet.z)) <= run && p.y >= feet.y - 1 && p.y <= feet.y + 2;
}

function opensPit(bot, p) {
  const here = bot.entity.position, feetY = Math.floor(here.y);
  if (p.y >= feetY || p.y < feetY - 2) return false;
  if (Math.hypot(p.x + 0.5 - here.x, p.z + 0.5 - here.z) > 2.5) return false;
  const under = bot.blockAt(p.offset(0, -1, 0)), deeper = bot.blockAt(p.offset(0, -2, 0));
  if (!under || under.boundingBox === 'block' || (deeper && deeper.boundingBox === 'block')) return false;
  // A pit is refused by what the fall does, not by its depth: a drop of
  // four onto a cave floor costs a health, and mid-208-j's staircase to
  // its lava rested on "a fall of 4" again and again (note 519). Lava
  // below, an unloaded column, or a fall of half the health or more is.
  for (let dy = 1; dy <= 32; dy++) {
    const b = bot.blockAt(p.offset(0, -dy, 0));
    if (!b) return true;
    if (/lava/.test(b.name)) return true;
    if (/water/.test(b.name)) return false;
    if (b.boundingBox === 'block') { const fall = feetY - (p.y - dy + 1); return Math.max(0, fall - 3) >= (bot.health ?? 20) / 2; }
  }
  return true;
}

// The block underfoot is dug from beside it, as a player does: a night
// mine took a vein straight down under its own feet, one block and one drop
// at a time (mid-87-a, 2026-09-25), and the user watching called it dicey.
// Only a dig that looked down the column first (a shaft pocket, Jev's own
// "dig down") drops into it.
async function stepOff(bot, task, p, { dropInto = false } = {}) {
  const feet = bot.entity.position.floored();
  if (feet.x !== p.x || feet.z !== p.z || Math.abs(feet.y - p.y) > 1) return;
  if (p.y === feet.y - 1 && dropInto && safeDropBelow(bot, p)) return;
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

// `openPit`: the gap is looked into and answered by the caller, a floor
// laid in it before any step (tunneling.js floorStair) or its depth said
// and chosen (the cave way, portalStep). Only a hole nobody has looked into
// is refused.
async function dig(bot, task, p, { done, requiredTool, enchantment, requireDrops = true, minimumToolDurability = 8, plug = true, dropInto = false, openPit = false } = {}) {
  task.check(); checkAir(bot);
  if (done?.()) return;
  let block = bot.blockAt(p);
  if (air(block)) return;
  if (!block?.diggable) throw new Error(`Cannot dig ${block?.name || 'unloaded block'}`);
  if (p.equals(supportCell(bot.entity.position))) await stepOff(bot, task, p, { dropInto });
  if (!bot.canDigBlock(block)) {
    await navigate(bot, task, new goals.GoalGetToBlock(p.x, p.y, p.z), { stopWhen: done });
  }
  task.check();
  if (done?.()) return;
  // A route to a ground block may end on top of it. Recheck after travel as
  // well as before it; move aside before replacing a foundation cell.
  if (p.equals(supportCell(bot.entity.position))) await stepOff(bot, task, p, { dropInto });
  block = bot.blockAt(p);
  if (p.equals(supportCell(bot.entity.position)) && !(dropInto && safeDropBelow(bot, p))) throw new Error('Refusing to dig directly beneath feet');
  if (!openPit && opensPit(bot, p)) throw new Error('Refusing to open a drop beside the feet');
  if (opensLava(bot, p)) throw new Error('Refusing to open lava beside the bot');
  if (requiredTool || enchantment) {
    const remaining = item => (bot.registry.itemsByName[item.name]?.maxDurability || Infinity) - (item.durabilityUsed || 0);
    const tool = bot.inventory.items().filter(item => (!requiredTool || item.name === requiredTool) && remaining(item) >= minimumToolDurability &&
      (!enchantment || item.enchants?.some(e => e.name === enchantment))).sort((a, b) => remaining(b) - remaining(a))[0];
    if (!tool) throw new Blocked(`Need ${enchantment || ''} ${requiredTool || 'tool'} to collect ${block.name}`);
    await bot.equip(tool, 'hand');
  } else await equipBestTool(bot, block);
  if (requireDrops && bot.game?.gameMode !== 'creative' && block.harvestTools && !block.harvestTools[bot.heldItem?.type]) throw new Error(`Missing harvest tool for ${block.name}`);
  // Water or lava beside the block, and the bot on dry ground: if it runs
  // into the gap, whether to put a block back is Jev's (leakResponse).
  const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/;
  const leaks = plug && !bot.entity?.isInWater && [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => LIQUID.test(bot.blockAt(p.offset(x, y, z))?.name || ''));
  await digWithAirGuard(bot, task, block);
  await waitFor(task, () => bot.blockAt(p)?.type !== block.type);
  if (leaks) await leakResponse(bot, task, p, LIQUID);
}

// Liquid ran into a cell the bot dug: plug it with a carried block, or carry
// on. Jev's choice, asked once the liquid is seen in the gap.
async function leakResponse(bot, task, p, LIQUID, { placer = place } = {}) {
  const { buildingMaterials } = require('./shelter');
  for (const ms of [300, 700]) {
    await sleep(ms);
    const liquid = bot.blockAt(p)?.name || '';
    if (!LIQUID.test(liquid)) continue;
    const material = require('./shelter').buildingItem(bot);
    if (!material) return false;
    const client = task.opportunityClient;
    if (client) {
      const kind = /lava/.test(liquid) ? 'lava' : 'water';
      const carried = bot.inventory.items().filter(i => buildingMaterials.has(i.name)).reduce((n, i) => n + i.count, 0);
      // Where the liquid is from the bot, and what it is doing to it now
      // (the decision audit, 2026-09-25): water over the head drowns, lava
      // at the feet burns.
      const feet = bot.entity.position.floored(), dy = p.y - feet.y, off = Math.round(p.distanceTo(feet.offset(0, 1, 0)) * 10) / 10;
      const where = dy >= 2 ? 'above the head' : dy === 1 ? 'at head height' : dy === 0 ? 'at the feet' : 'below the feet';
      const burning = !!(bot.entity?.metadata?.[0] & 1);
      const tree = {
        plug: { description: `Put a ${material.name.replaceAll('_', ' ')} back in the gap and stop the ${kind} (${carried} building blocks carried).${kind === 'lava' ? ' Lava sets the bot alight and burns what it touches.' : ' Water that keeps running floods the tunnel and pushes the bot about.'}` },
        carry_on: { description: `Leave the ${kind} running and carry on digging. It is ${where}, ${off} block${off === 1 ? '' : 's'} off${kind === 'lava' ? (burning ? '; the bot is on fire now' : '') : dy >= 1 ? ': water at head height takes the air' : ''}.` },
      };
      try {
        const decision = await require('./decisions').decide('dug_into_liquid', { client, bot, task, tree, state: { liquid: kind, position: { x: p.x, y: p.y, z: p.z }, inWater: !!bot.entity?.isInWater, health: bot.health,
          liquidIs: { where, blocksOff: off }, ...(kind === 'lava' ? { onFire: burning } : { breathSecondsLeft: Math.round((bot.oxygenLevel ?? 20) * 0.75) }) } });
        // Held through an outage (note 707): looked at again and asked fresh.
        if (decision.stale) continue;
        if (decision.path.at(-1) === 'carry_on') return false;
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    return plugLeak(bot, task, p, LIQUID, { placer });
  }
  return false;
}

// A block back into a dug cell that liquid has run into (the plug option).
// Five ticks is how long water takes to flow one block; lava is slower, so
// the look is twice.
async function plugLeak(bot, task, p, LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/, { placer = place } = {}) {
  const { buildingMaterials } = require('./shelter');
  for (const ms of [300, 700]) {
    await sleep(ms);
    if (!LIQUID.test(bot.blockAt(p)?.name || '')) continue;
    const material = require('./shelter').buildingItem(bot)?.name;
    if (!material) return false;
    try { await placer(bot, task, p, material); console.log(`[leak] plugged the gap at ${p} with ${material}`); return true; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return false; }
  }
  return false;
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

// Whether the body, backed out of p along the line away from its centre
// until clear, stands on a floor under some part of its 0.6 width.
function backingOutLands(bot, p) {
  // A flying worker hovers where it stops; open air is its floor.
  if (require('./flight').canFly(bot)) return true;
  const pos = bot.entity.position, dx = pos.x - (p.x + 0.5), dz = pos.z - (p.z + 0.5), len = Math.hypot(dx, dz) || 1;
  const x = pos.x + dx / len * 0.6, z = pos.z + dz / len * 0.6, y = Math.floor(pos.y);
  const { dropAt } = require('./terrain');
  return [[-0.29, -0.29], [-0.29, 0.29], [0.29, -0.29], [0.29, 0.29]].some(([ox, oz]) => {
    const c = new Vec3(Math.floor(x + ox), y, Math.floor(z + oz));
    if (bot.blockAt(c)?.boundingBox === 'block' || (c.x === p.x && c.z === p.z)) return false;
    return !dropAt(bot, c);
  });
}

async function nudgeClear(bot, task, p) {
  if (!hitboxIntrudes(bot, p) || typeof bot.setControlState !== 'function') return;
  // Face the cell and step backward until the body is clear of it.
  await move(bot, task, { label: 'step_back', keys: ['back'], sneak: true, look: p.offset(0.5, 1, 0.5), maxMs: 700, tick: 50,
    until: () => !hitboxIntrudes(bot, p) });
}

// What a placed block replaces, as the game does: cover on the ground.
// And fire: a flame's cell is replaceable in the game (26.1.2 Blocks: fire
// and soul fire are registered replaceable), so a block put there puts it
// out. mid-243-ad-nether-3's cover against a ghast went in the line through
// a flame its first fireball had lit, and was refused "Placement obstructed
// by fire" twelve times in two and a half seconds, the bot open on its span
// over the lava sea until the next fireball (note 582).
const FLAMES = new Set(['fire', 'soul_fire']);
// Not the firefly bush: the game does not replace it with a placed block
// (it is broken first, as a flower is, knockedAway): 25595 (17:39 to 17:53Z)
// was refused its crafting table at (48, 63, 140) eight times, "the block is
// still firefly_bush" (note 761).
const GROUND_COVER = new Set(['water', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'leaf_litter', 'dead_bush', 'seagrass', 'vine', 'short_dry_grass', 'tall_dry_grass', 'bush', ...FLAMES]);
// A cell a workstation can go in: open or only covered, over a full block.
// In snowy plains every cell at the feet is a snow layer over grass, and
// trial 40 found "no place for crafting_table" forty times in a minute.
// And in sight from the eyes: sealed in a night pocket, trial 68 put its
// table in an open cell two blocks off on the far side of the pocket's
// wall, and "I can't reach the crafting table I placed" every three
// seconds for two minutes.
const openForStation = (bot, q) => {
  const at = bot.blockAt(q);
  if (!(air(at) || (GROUND_COVER.has(at?.name) && at.name !== 'water' && !FLAMES.has(at.name)))) return false;
  const under = bot.blockAt(q.offset(0, -1, 0));
  if (!(under?.boundingBox === 'block' && under.name !== 'snow')) return false;
  if (typeof bot.world?.raycast !== 'function') return true;
  const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0), centre = q.offset(0.5, 0.5, 0.5);
  const dir = centre.minus(eye), d = dir.norm();
  if (d < 0.5) return true;
  const hit = bot.world.raycast(eye, dir.scaled(1 / d), d);
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= d - 0.6;
};

// A cell a workstation is put in now (note 761): open for it, with no part
// of the bot's own body in it at all, and not refused there lately. The game
// puts no block where any body is, its own included, by the least sliver:
// 25595 (mid-243-ke, 17:09Z, the Nether at 418, 43, 27) stood 0.008 of a
// block into the cell beside its feet, under the 0.02 hitboxIntrudes lets
// pass, and was refused its crafting table there eleven times, "the block
// is still air", the same cell picked each time; 25598 (06:54Z) 0.01 into
// its cell fifteen times, 25593 0.018, 25595 at 09:28Z 0.015.
const STATION_CELL_REST_MS = 10 * 60000;
const stationKey = q => `${q.x},${q.y},${q.z}`;
function stationCellOk(bot, goal, q) {
  return openForStation(bot, q) && !hitboxIntrudes(bot, q, 0) && !(goal && isSetAside(goal, 'station_cell', stationKey(q)));
}
// A cell the game refused a workstation in rests, said, and the next is tried.
function restStationCell(goal, q, name, err) {
  if (goal) setAside(goal, 'station_cell', stationKey(q), `the ${String(name).replaceAll('_', ' ')} was refused there: ${err?.message || err}`, STATION_CELL_REST_MS);
}
const STATION_FATAL = new Set(['NeedsAir', 'NeedsSafety', 'Cancelled', 'Blocked']);

const CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'sweet_berry_bush', 'torchflower_crop', 'pitcher_crop', 'nether_wart']);
function knockedAway(bot, block) {
  // Fire by its name, not "fire" anywhere in it: the firefly bush read as a
  // flame and was never knocked away (note 761).
  if (!block || block.boundingBox !== 'empty' || CROPS.has(block.name) || /water|lava|^(soul_)?fire$|portal/.test(block.name)) return false;
  return (block.hardness ?? bot.registry?.blocksByName?.[block.name]?.hardness) === 0;
}

// A body in the cell: the game will not put a block where a mob or a
// player stands. first-days-221's pen gate "did not go where it was placed"
// two hundred and ninety-one times with a trader llama standing in its
// cell, and nothing said so (2026-09-26).
// Whether an entity's body reaches into the block cell at p.
function bodyIn(e, p) {
  if (!e?.position) return false;
  const half = (e.width || 0.6) / 2, h = e.height || 1.8;
  return e.position.x + half > p.x && e.position.x - half < p.x + 1 && e.position.z + half > p.z && e.position.z - half < p.z + 1 && e.position.y + h > p.y && e.position.y < p.y + 1;
}
function occupant(bot, p) {
  // A spectator has no body in the game.
  const spectator = e => e.type === 'player' && bot.players?.[e.username]?.gamemode === 3;
  return Object.values(bot.entities || {}).find(e => e !== bot.entity && e.position && e.isValid !== false && !spectator(e) && !/^(item|experience_orb|arrow|spectral_arrow|trident)$/.test(e.name || '') &&
    e.type !== 'orb' && e.type !== 'projectile' && bodyIn(e, p)) || null;
}
const occupiedSays = (e, p) => `a ${(e.username || e.name || 'mob').replaceAll('_', ' ')} stands in the cell at ${p}, and the game puts no block where a body is`;
// A failure a body caused, said and marked as such: a mob in a cell is a
// passing obstruction, not a fault of the place (buildPortalFrame counts a
// site's failures without them, note 527).
const bodyError = (message, e, p) => Object.assign(new Error(message), { body: { name: e.username || e.name || 'mob', at: { x: p.x, y: p.y, z: p.z } } });

// Mineflayer yaw for looking toward each horizontal facing (0 is north, -z).
const PLACEMENT_YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };
async function place(bot, task, p, material, { face, properties, stay = false } = {}) {
  // Breath first, as every dig checks it: mid-205-b walled a pocket in
  // under water for nine seconds, placing block after block, and nothing
  // looked at its air until two of twenty were left (2026-09-26).
  task.check(); checkAir(bot);
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
  // A flower or anything else that breaks at a touch and stops nothing
  // comes out first, as a player punches it: a dandelion on a fence cell
  // of first-days-212's pen was "placement obstructed" seven times until
  // the audit called the loop (2026-09-26). Not a crop.
  const there = bot.blockAt(p);
  if (!air(there) && !GROUND_COVER.has(there?.name) && knockedAway(bot, there) && typeof bot.dig === 'function') {
    try { await bot.dig(there, true); } catch (_) { task.check(); }
  }
  if (!air(bot.blockAt(p)) && !GROUND_COVER.has(bot.blockAt(p)?.name)) {
    throw new Error(`Placement obstructed by ${bot.blockAt(p)?.name} at ${p}`);
  }
  const body = occupant(bot, p);
  if (body) throw bodyError(`Placement obstructed: ${occupiedSays(body, p)}`, body, p);
  // Backing out of the cell must end on something: the step back is blind,
  // and at a rim it is the fall. mid-241-w's take_cover put its wall in the
  // cell under its own feet, crossed a tenth of a block, backed out of it
  // and fell eighteen blocks, 17.2 to 3.2 (note 493). Physics, whoever
  // places: where no floor lies under the body backed out, it is refused
  // with the drop said, as the ledge rule above refuses for its callers.
  const feetHere = bot.entity.position.floored();
  // (Standing in the cell itself is stepOff's, which looks for a floor.)
  if (hitboxIntrudes(bot, p) && !(feetHere.x === p.x && feetHere.z === p.z) && !backingOutLands(bot, p)) throw new Error(`Placing at ${p} would move me off this ledge: no floor where the body backs out to`);
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
  // A body that stepped into the cell after it was looked at: the server
  // refuses the block and says only that the cell is still air. mid-230-u's
  // stand cell took a zombie between the look and the click (note 527).
  const late = occupant(bot, p);
  if (late) throw bodyError(`Cannot place ${material} at ${p}: ${placementError}; ${occupiedSays(late, p)}`, late, p);
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
const { descentTargets } = require('./tunneling');
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

async function explore(bot, task, goal, save, resource, { surfaceOnly = isSurfaceResource(resource), frontier = surfaceOnly, forItem = null } = {}) {
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceTrip(bot, task, goal, save, LOG.test(resource) ? 'wood (any log)' : resource.replaceAll('_', ' '));
    return;
  }
  // In the Nether, the Nether's search: what is known and the ways to it,
  // the wood within reach, the portal back, legs, or going without, put to
  // Jev (nether-gather.js). The walking search below surveys ground within
  // forty-eight blocks, and from a span over the lava sea found none, over
  // and over for twelve minutes (mid-242-af-nether-2-fortress-3, note 608).
  if (!surfaceOnly && require('./nether-gather').gathers(bot, resource)) {
    await require('./nether-gather').netherGather(bot, task, goal, save, resource, { navigate, returnOverworld: returnFromNether, forItem,
      mineAt: (p, block) => mine(bot, task, { action: 'mine', block, sources: [block], drops: block, count: 1 }, goal, save, p) });
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
    if (frontier) {
      // A new heading is Jev's: each way with the biomes that way, water,
      // trees seen, and how often this search went that way. Trial 35's
      // search for wood turned at every third walk that met water and
      // circled a desert coast for eight minutes.
      const state = search.frontier, held = state?.target;
      const needs = !state || !held || Math.hypot(bot.entity.position.x - held.x, bot.entity.position.z - held.z) < 24 || search.walksWithoutProgress >= 3;
      const client = task.opportunityClient;
      if (needs && client && typeof bot.blockAt === 'function') {
        const { biomeRay, headingFacts, surfaceRay, HEADINGS } = require('./exploration');
        const legs = state?.legsByHeading || {};
        const tree = Object.fromEntries(HEADINGS.map((h, i) => [`heading_${h.replace('-', '_')}`, { description: `Head ${h}: ${headingFacts(biomeRay(bot, i), surfaceRay(bot, i))}.${legs[i] ? ` Already searched ${h} ${legs[i] === 1 ? 'once' : `${legs[i]} times`} in this search, and found none that way.` : ''}` }]));
        try {
          const decision = await decide('search_heading', { client, bot, task, goal, save, tree,
            state: { resource: LOG.test(resource) ? 'wood (any log)' : resource.replaceAll('_', ' '), biome: require('./exploration').biomeView(bot)?.biome, searchLegs: search.attempts,
              legsThatWay: Object.fromEntries(Object.entries(legs).map(([i, n]) => [HEADINGS[i], n])) } });
          if (!decision.stale) (search.frontier ||= { heading: 0, legs: 0 }).chosen = HEADINGS.indexOf(decision.path.at(-1).slice(8).replace('_', '-'));
        } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      target = explorationTarget(search, resource, bot.entity.position);
    }
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
      // The ore already chosen is kept while it is still there to be had:
      // the nearest changes with every step, and trial 52 turned between two
      // iron ores east and west of it at each call, paced four blocks of
      // shore for a minute, and the staircase, its target always new, never
      // counted itself stuck.
      const kept = search.observedTarget && observed.find(p => p.x === search.observedTarget.x && p.y === search.observedTarget.y && p.z === search.observedTarget.z);
      target = kept || observed[0];
      search.observedTarget = { ...target };
    }
    // Walks that got nowhere on the chosen heading, water across it: swim.
    if (frontier && !observed.length && (search.walksWithoutProgress || 0) >= 2 && search.frontier?.heading != null) {
      try { if (await require('./exploration').swimAcross(bot, task, goal, save, search.frontier.heading)) { search.walksWithoutProgress = 0; search.progressLeg = null; save(); return; } }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
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
      // Planks the world put there, not the bot's own (note 754e).
      !(/_planks$/.test(b.name) && (() => { try { return !!require('./own-blocks').laidAt(bot, b.position, goal); } catch (_) { return true; } })()) &&
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
// somewhere else. Everything of that block within thirty-two blocks is set
// aside for twenty minutes (not sixteen blocks for two: 25594 dug and laid
// about 1874 blocks each, all inside a 19-block ball, because the ore just
// left behind was back in view well before the next "differently" - the
// walk that "looks somewhere else" never actually left the ball it had
// already dug, note 746) and the ordinary exploration walks toward the
// next known or unknown source. A rule rather than a judgment: there is no
// request that is better served by a sixth attempt at the same tree.
const MOVE_ON_MEMORY_MS = 30 * 60000;
// What this same move-on has come to lately, said with the next one: how
// many times this resource's patch was left for another in the last half
// hour, and what was gained meanwhile (0 if nothing was, which is the fact
// itself: leaving the patch got nothing new note 746 asks be said, not
// hidden behind "I'll look somewhere else").
function moveOnHistorySays(goal, resource) {
  const list = (goal.moveOnHistory?.[resource] || []).filter(e => Date.now() - e.at < MOVE_ON_MEMORY_MS);
  if (!list.length) return '';
  const gained = list.reduce((n, e) => n + Math.max(0, e.gained || 0), 0);
  return ` Left for another spot ${list.length} time${list.length === 1 ? '' : 's'} in the last 30 minutes, ${gained} gained meanwhile.`;
}
async function moveOnFromResource(bot, task, goal, save) {
  const step = goal.step;
  if (step?.action !== 'mine' || !step.block) return false;
  const resource = step.drops || step.block;
  const nearby = find(bot, step.sources || [step.block], 32, 128);
  for (const p of nearby) setAside(goal, 'reach', p, 'set aside with the rest of this area', 1200000);
  // The marker shows in the step log during the walk and is taken down
  // after it: left in place, the work loop had no step to run and spun on it
  // for eighty-four seconds (trial 23).
  const marker = { action: 'move_on', resource, setAside: nearby.length };
  goal.step = marker; save();
  // What this patch actually yielded, kept so the next "differently" can
  // say it (note 746): a snapshot each time this resource is left, gained
  // read off the one before it.
  const history = goal.moveOnHistory ||= {};
  const list = (history[resource] || []).filter(e => Date.now() - e.at < MOVE_ON_MEMORY_MS);
  const now = countOf(bot, resource);
  const gained = list.length ? now - list.at(-1).count : 0;
  history[resource] = [...list, { at: Date.now(), count: now, gained }].slice(-10); save();
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
// And either of the Nether's stems for the other: the Nether's search walks
// to whichever forest is known (nether-gather.js, note 608).
const NETHER_STEM = /^(crimson|warped)_stem$/;
// The kind of wood the fetch last went for is kept while trees of it are
// within 32 blocks (note 749e): 25598 said "8 oak logs" at 18:37:58Z, "8
// acacia logs" at 18:38:26, "4 oak logs" at 18:41:51 and "4 acacia logs" at
// 18:43:01, the plan naming oak and the step in view turning it to acacia
// and back as the one or the other came within reach. Any kind serves the
// recipe; the one being walked to is the target.
const LOG_KIND_MS = 5 * 60000;
const swapTo = (step, name) => name === step.block ? step : { ...step, block: name, sources: [name], drops: name, produces: { [name]: step.count || 1 }, insteadOf: step.block };
function logInView(bot, step) {
  const family = LOG.test(step.block || '') ? LOG : NETHER_STEM.test(step.block || '') ? NETHER_STEM : null;
  if (!family || typeof bot.findBlocks !== 'function') return step;
  const kept = bot._logKind && Date.now() - bot._logKind.at < LOG_KIND_MS && family.test(bot._logKind.name) ? bot._logKind.name : null;
  if (kept && find(bot, [kept], 32, 1).length) { bot._logKind = { name: kept, at: Date.now() }; return swapTo(step, kept); }
  if (find(bot, [step.block], 32, 1).length) { bot._logKind = { name: step.block, at: Date.now() }; return step; }
  const names = Object.keys(bot.registry?.blocksByName || {}).filter(n => family.test(n) && n !== step.block);
  const other = find(bot, names, 32, 1)[0];
  const name = other && bot.blockAt(other)?.name;
  if (!name) return step;
  bot._logKind = { name, at: Date.now() };
  return swapTo(step, name);
}

// More of a source than the step asked for: the rest of a trunk (up to
// eight logs), of a vein (up to a stack of thirty-two), or two dozen stone
// from a face at hand. The dream run walked to a fresh tree for every
// smelt's fuel and climbed a hill fourteen times for one iron at a time; a
// source already reached is a few seconds' work.
async function moreOfSource(bot, task, goal, save, step, source, cap) {
  const client = task.opportunityClient;
  const what = String(step.drops || step.block).replaceAll('_', ' ');
  const tree = {
    take_more: { description: `Keep taking the ${String(source.block).replaceAll('_', ' ')} within reach until ${cap} ${what} are carried (${countOf(bot, step.drops)} now): a few seconds a block while it is at hand, where coming back later is a walk.` },
    enough: { description: `Stop at what the step asked for (${step.count || 1} ${what}) and go on.` },
  };
  try {
    const decision = await decide('gather_more', { client, bot, task, goal, save, tree, context: {},
      state: { step: { action: step.action, item: step.drops || step.block, asked: step.count || 1 }, carried: countOf(bot, step.drops), cap, request: goal.request, rung: goal.rungTime?.phase || null,
        // What staying at the source risks (the decision audit, 2026-09-25).
        timeOfDay: bot.time?.timeOfDay, threats: (() => { try { return require('./danger').threats(bot, 16).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })); } catch (_) { return []; } })(), riskNow: (() => { try { return require('./risk').riskNow(bot); } catch (_) { return null; } })(),
        ...(source.blocks?.[0] ? require('./decision-options').sourceSurroundings(bot, source.blocks[0]) : {}) } });
    // Held through an outage (note 707): asked fresh.
    if (decision.stale) return moreOfSource(bot, task, goal, save, step, source, cap);
    return decision.path.at(-1) !== 'enough';
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return true; }
}

async function mine(bot, task, step, goal, save, selected) {
  // Not for a request that named its wood (a spruce build wants spruce).
  if (goal?.kind === 'win' || !goal?.item) step = logInView(bot, step);
  if (step.insteadOf && goal) { goal.step = step; save(); }
  const surfaceOnly = isSurfaceResource(step.block);
  if (surfaceOnly && !surfaceReturnComplete(bot, goal)) {
    await surfaceTrip(bot, task, goal, save, `${step.count || 1} ${String(step.block).replaceAll('_', ' ')}`); return;
  }
  // Mining with no slot for the drop digs ore for the ground to keep.
  if (step.drops && bot.game?.gameMode !== 'creative' && !roomFor(bot, step.drops)) {
    if (!await makeRoom(bot, task, step.drops, { goal, keep: new Set([goal.item, step.item].filter(Boolean)), purpose: `the step in hand (${step.count || ''} ${step.drops.replaceAll('_', ' ')}${goal.gameProgress?.phase ? ` for the ${goal.gameProgress.phase.replaceAll('_', ' ')} step` : ''})` })) throw new Error(`No room in my pockets for ${step.drops.replaceAll('_', ' ')}`);
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
    // Wood down here (a mineshaft's planks, a log in a cave) is fetched only
    // as climb_out's wood_first, priced beside the climbs by hand (note 754e).
    if (!step || (step.action === 'mine' && (isSurfaceResource(step.block) || /_log$|_planks$|_stem$/.test(step.block || '')))) {
      // Said as it is (note 768c): 25593 said "no wood for one" at 03:40:31Z
      // with the trial chambers' oak planks 52 blocks off, known.
      if (!goal.surfaceReturn?.byHand) {
        goal.surfaceReturn ||= {}; goal.surfaceReturn.byHand = true; save();
        let wood = null;
        try { wood = require('./pickaxe-budget').nearestWood(bot, goal); } catch (_) { wood = null; }
        bot.chat?.(wood ? `No pickaxe worth the name. The nearest wood is ${wood.distance} blocks off; making one from it is weighed against digging out by hand.` : "No pickaxe worth the name and no wood seen for one, so I'm digging out by hand.");
      }
      return true;
    }
    await executeAcquisition(bot, task, step, goal, save);
    return false;
  }, woodFirst: async (chosen = null) => {
    // The pickaxe the climb's answer named (wood_first or pickaxe_first,
    // note 768c), a step at a time, until one more is carried or ten steps
    // have gone: with a pickaxe carried, the stone for a stone head is dug.
    const stone = ['cobblestone', 'cobbled_deepslate', 'blackstone'].reduce((n, k) => n + countOf(bot, k), 0) >= 3 || pickaxeTier(bot) >= 1;
    const item = chosen || (stone ? 'stone_pickaxe' : 'wooden_pickaxe');
    const had = countOf(bot, item);
    goal.step = { action: 'pickaxe_before_climb', item }; save();
    for (let i = 0; i < 10 && countOf(bot, item) <= had; i++) { task.check(); if (await acquireStep(bot, task, item, had + 1, goal, save)) break; }
    if (countOf(bot, item) <= had) throw new Error(`No ${item.replaceAll('_', ' ')} made before the climb`);
  } });
}

// A climb to open sky for the work is a trip, and Jev's to make: said with
// what it is for, what it costs up and back, and the ladder's next step to
// go on with down here instead. It had been a rule: a log, a flower or a
// surface search wanted underground climbed at once. mid-229-q, at y -12
// for one log for the table of a spare iron pickaxe (the one carried at 49
// uses), climbed 74 blocks in 97 minutes, both pickaxes worn out on the
// first three minutes of stairs and the rest by hand, made the pickaxe in
// twenty seconds at the top and was back down within twenty minutes; the
// climbs were 100 of its 180 minutes, none of them asked (note 511).
const SITE_BY_LAVA = 12;
const SITE_NEAR_LAVA = 32;
const siteByLava = (siteDig, lava) => !lava || !siteDig?.origin || Math.hypot(siteDig.origin.x - lava.x, siteDig.origin.y - lava.y, siteDig.origin.z - lava.z) <= SITE_BY_LAVA;
async function surfaceTrip(bot, task, goal, save, need, { siteDig = null, lava = null, cast = null } = {}) {
  const held = goal.surfaceTrip;
  // Chosen, the climb holds to the top: not asked again at each stair. Only
  // a climb Jev chose holds: one made because nothing else was on offer
  // then is looked at again, and asked once there is (note 543). Wood
  // chosen at upkeep is that climb chosen (gatherWood).
  const woodChosen = held?.by === 'upkeep' && LOG_NEED.test(need) && Date.now() - Date.parse(held.at) < UPKEEP_WOOD_MS;
  if (held?.pick === 'climb' && held.asked && ((held.need === need && goal.surfaceReturn) || woodChosen)) return surfaceStep(bot, task, goal, save);
  const words = s => String(s || '').replaceAll('_', ' ');
  const cost = tripCost(bot, goal);
  // The ladder's step, when it is the work's turn: a climb survival wants
  // (its shelter's blocks, a table to cook at) is not the rung's to leave.
  const ruling = bot._arbiter?.ruling?.winner;
  const phase = !ruling || ruling === 'work' ? goal.rungTime?.phase || goal.gameProgress?.phase || null : null;
  // Its own figure carried as `quote`, read against what the climb takes
  // (quote-record.js, note 768).
  const tree = { climb: { description: `Climb to open sky for ${need}${phase ? ` (for the ${words(phase)})` : ''}: ${cost?.says || 'the column overhead is not all loaded, so the height is not known yet.'}`, ...(cost?.quote ? { quote: cost.quote } : {}) } };
  const client = task.opportunityClient;
  let next = null;
  const also = [];
  // What the pickaxes carried cover, looked at only when there is a choice.
  let budget;
  const budgetOf = () => { if (budget === undefined) { try { budget = require('./pickaxe-budget').pickaxeBudget(bot, goal); } catch (_) { budget = null; } } return budget; };
  if (phase && client) {
    const { nextGameStage, RUNG_WAIT_MS } = require('./game-progress');
    // What the ladder hands on with the step left, read from a copy. A rung
    // after it that wants the same climb is left with it: mid-220-h's stone
    // pickaxe rung, its iron pickaxe at 12 uses and one plank carried, would
    // have been left "for the iron pickaxe", whose sticks want the same log
    // (note 543). One whose first gathering is below (ore to mine) is work
    // down here, whatever it wants from the surface after.
    let probe = null;
    const wantsClimb = (probe, rung) => {
      if (!rung?.item || !/^acquire/.test(rung.action || '')) return false;
      try { const first = catalogPlan(bot, rung.item, rung.count || 1, planningInventory(bot), probe).find(s => s.action === 'mine'); return !!first && isSurfaceResource(first.block); }
      catch (_) { return false; }
    };
    try {
      probe = JSON.parse(JSON.stringify(goal)); setAside(probe, 'rung', phase, 'left for now', RUNG_WAIT_MS); next = nextGameStage(bot, probe);
      for (let i = 0; i < 12 && next?.phase && next.phase !== phase && wantsClimb(probe, next); i++) {
        also.push(next.phase); setAside(probe, 'rung', next.phase, 'left for now', RUNG_WAIT_MS); next = nextGameStage(bot, probe);
      }
    }
    catch (_) { next = null; }
    if (next?.phase && next.phase !== phase && !also.includes(next.phase) && !wantsClimb(probe, next)) {
      const named = [phase, ...also].map(p => `the ${words(p)}`), left = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
      tree.stay_below = { description: `Stay down here: leave ${left}${also.length ? ` (${also.length === 1 ? 'it wants' : 'they want'} the same climb)` : ''} for thirty minutes and go on with ${words(next.phase)}${next.item ? ` (${next.count || ''} ${words(next.item)})` : ''}. It comes back after, and this climb with it unless the work has gone up by then.${budgetOf() ? ` Down here meanwhile: ${budget.says}` : ''}` };
    }
  }
  // Ore in view first, with the uses the climb does not need: the move a
  // player makes with a worn pickaxe and no wood, when every rung after
  // wants the same climb and staying below has nothing to go on with
  // (note 543). Asked again after each, the uses said as they fall.
  let oreFirst = null;
  if (phase && client && cost && pickaxeTier(bot) >= 1 && typeof bot.findBlocks === 'function') {
    try {
      const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
      oreFirst = find(bot, USEFUL_ORES, 16, 8).map(p => ({ p, name: bot.blockAt(p)?.name }))
        .find(o => {
          const tools = bot.blockAt(o.p)?.harvestTools;
          return o.name && !SIDES.some(([x, y, z]) => /lava/.test(bot.blockAt(o.p.offset(x, y, z))?.name || '')) && (!tools || bot.inventory.items().some(i => tools[i.type]));
        }) || null;
    } catch (_) { oreFirst = null; }
    const spare = cost.state.pickaxeUsesLeft - cost.digs;
    if (oreFirst && spare > 0) tree.mine_first = { description: `Dig the ${words(oreFirst.name)} ${Math.round(oreFirst.p.distanceTo(bot.entity.position))} blocks off first, then climb: the pickaxes have ${cost.state.pickaxeUsesLeft} uses and the climb's way (${words(cost.way)}) digs about ${cost.digs}, so ${spare} are spare for ore down here; asked again after it.${budgetOf() ? ` ${budget.says}` : ''}` };
    else oreFirst = null;
  }
  // A portal site is a room dug out of the rock as well as ground up top:
  // said beside the climb with its blocks, and what the climb does to a
  // cast beside the lava chosen (note 531).
  if (lava && cost) {
    const above = bot.entity.position.floored().y + cost.up - lava.y;
    tree.climb.description += ` The frame then goes down up there, about ${above} blocks above the lava chosen to cast beside (y ${lava.y}): each bucket of the cast a trip down to it and back up.`;
    // A frame already begun is progress by the rung's measure, its obsidian
    // standing (note 722): picking a fresh site up top leaves it, and that
    // is said as what it costs, not left for Jev to find out later. 25590
    // climbed for a new site with six of ten standing twenty blocks away,
    // and ended with a fourth site, none cast, thirty blocks from the lava.
    if (goal.portalFrame && !goal.portalFrame.ruin) {
      const placedNow = goal.portalFrame.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length;
      if (placedNow) {
        const o = goal.portalFrame.origin, away = Math.round(bot.entity.position.distanceTo(pos(o)));
        const leaves = ` The frame already begun at (${o.x}, ${o.y}, ${o.z}), ${placedNow} of ten standing${away ? `, ${away} blocks from here` : ''}, is left as it stands if a new site is picked up top instead of coming back to it: its obsidian comes out only with a diamond pickaxe (${diamondPickaxeCarried(bot) ? 'one carried' : 'none carried'}).`;
        tree.climb.description += leaves;
        if (tree.mine_first) tree.mine_first.description += leaves;
      }
    }
  }
  // The frame's site is at the lava when the plan is to cast beside it
  // (note 763): 25588 said "I'll cast the portal down by the lava", then took
  // dig_site at (62, 13, 128), 65 blocks from its nearest lava, every bucket
  // a trip. A dug site farther than the cast's own reach of that lava (the
  // twelve blocks it walks to the lava within) is not offered.
  if (siteDig && client && pickaxeTier(bot) >= 1 && siteByLava(siteDig, lava)) {
    const o = siteDig.origin, n = siteDig.cells.length;
    const off = Math.round(bot.entity.position.floored().distanceTo(o));
    tree.dig_site = { description: `Dig a site for the frame out of the rock here instead: the frame's cells and a walkway either side of it, four across and five high, ${n ? `${n} blocks to dig (${siteDig.kinds.join(', ')}), about ${Math.max(5, Math.round(n * 1.5))} seconds and ${n} pickaxe uses` : 'already open'}, at ${o.x}, ${o.y}, ${o.z} ${off <= 4 ? 'where the bot stands' : `${off} blocks from where the bot stands`}; the floor under it is solid and no water, lava or falling block is beside it. The frame goes down there${lava ? `, ${Math.round(Math.hypot(lava.x - o.x, lava.y - o.y, lava.z - o.z))} blocks from the lava chosen` : ''}.${castSiteSays(o, cast)}` };
  }
  // The climb's site is not known until the top; its bucket trips are at
  // least the height back down to the lava, said beside the dug site's
  // (note 753b: 25589 took the climb at 0.76 against dig_site at 0.20, told
  // the climb was fifteen seconds and nothing of the ten trips after).
  if (cast?.lava && cost) {
    const top = bot.entity.position.floored().offset(0, cost.up, 0);
    tree.climb.description += castSiteSays(top, cast, { atLeast: true }) + ' The site itself is looked for up there, within 24 blocks of where the climb comes out, and walked on from if none is.';
    // The plan it came down for, said where the climb would undo it
    // (25598, 13:22:24-13:24:25Z: "I'll cast the portal down by the lava,
    // so each bucket is a short trip", then this climb).
    if (lava) tree.climb.description += ' Casting beside the lava was chosen so each bucket is a short trip; a frame up there gives that up.';
  }
  // For water: what water is known from here, so a climb for it is weighed
  // against water nearer (25584, mid-244-fd, 13:22:08Z: a climb of 62 blocks
  // for water said nothing of any water about, note 753b).
  if (/^water$/.test(need)) {
    try {
      const known = require('./water').waterKnown(bot);
      tree.climb.description += ` Water known from here: ${known.says}${known.kind === 'source' ? '; no dry place beside it to fill from was reached by a route searched from here, nor was the bucket filled wading into it where it is shallow' : ''}.`;
    } catch (_) { /* said without it */ }
  }
  // What is still owed up there and down here, and the climb at the bot's
  // own measured pace (note 763): mid-237-bc climbed 86 blocks for sheep
  // with the diamonds it was mining and the portal's lava still owed below.
  const levelFacts = require('./levels').levelsSays(bot, goal, { going: 'up' });
  if (levelFacts) for (const k of ['climb', 'stay_below']) if (tree[k]) tree[k].description += levelFacts;
  let pick = 'climb', asked = false;
  if (tree.stay_below || tree.dig_site || tree.mine_first) {
    const decision = await require('./decisions').decide('surface_trip', { client, bot, task, goal, save, tree,
      state: { need, step: phase ? words(phase) : null, ...(cost ? { blocksToOpenSky: cost.up, quickerWayOut: cost.way, minutesUp: Math.round(cost.seconds / 60), pickaxes: cost.state.pickaxes, pickaxeUsesLeft: cost.state.pickaxeUsesLeft } : {}),
        ...(budgetOf() ? { pickaxeBudget: budget.says } : {}),
        ...(tree.stay_below ? { goOnWith: `${words(next.phase)}${next.item ? `: ${next.count || ''} ${words(next.item)}` : ''}` } : {}),
        ...(tree.dig_site ? { siteToDig: { at: { ...siteDig.origin }, blocks: siteDig.cells.length } } : {}) } });
    if (decision.stale) return;
    pick = decision.path.at(-1); asked = true;
  }
  if (pick === 'mine_first') {
    goal.surfaceTrip = { need, pick, asked, ...(phase ? { phase } : {}), at: new Date().toISOString() };
    goal.step = { action: 'mine_first', block: oreFirst.name, target: { x: oreFirst.p.x, y: oreFirst.p.y, z: oreFirst.p.z }, need }; save();
    await dig(bot, task, oreFirst.p, {});
    return;
  }
  if (pick === 'dig_site') {
    goal.surfaceTrip = { need, pick, ...(phase ? { phase } : {}), at: new Date().toISOString() };
    goal.portalSiteDug = { ...siteDig.origin };
    goal.step = { action: 'dig_portal_site', origin: { ...siteDig.origin }, blocks: siteDig.cells.length }; save();
    const cellOrder = [...siteDig.cells].sort((a, b) => b.y - a.y || a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    try { for (const c of cellOrder) { task.check(); await dig(bot, task, c, { requireDrops: false }); } }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      // Left as a site that failed: not dug at again, and said when asked next.
      (goal.portalSitesLeft ||= []).push({ ...siteDig.origin }); delete goal.portalSiteDug; save();
      throw new Error(`Digging a portal site at ${siteDig.origin.x}, ${siteDig.origin.y}, ${siteDig.origin.z}: ${err.message}`);
    }
    return;
  }
  goal.surfaceTrip = { need, pick, ...(asked ? { asked } : {}), ...(phase ? { phase } : {}), ...(cost ? { up: cost.up } : {}), ...(lava ? { lava: { x: lava.x, y: lava.y, z: lava.z } } : {}), at: new Date().toISOString() };
  if (pick === 'stay_below') {
    const { RUNG_WAIT_MS } = require('./game-progress');
    for (const p of [phase, ...also]) setAside(goal, 'rung', p, `Jev chose to stay below rather than climb${cost ? ` ${cost.up} blocks` : ''} for ${need}`, RUNG_WAIT_MS);
    delete goal.rungTime;
    goal.step = { action: 'stay_below', phase, need }; save();
    bot.chat?.(`I'll leave the ${[phase, ...also].map(words).join(' and the ')} for now rather than climb all the way up for ${need}.`);
    return;
  }
  save();
  await surfaceStep(bot, task, goal, save);
}

async function mineAtSource(bot, task, step, goal, save, selected) {
  const candidates = selected ? [selected] : await miningCandidates(bot, task, step, goal);
  if (!candidates.length) {
    // Not dug for where it is not: iron is not in the Nether. mid-242-f's
    // armour, fetched in the Nether, set a staircase down toward the iron's
    // depth, y 16, under the lava sea, and it broke into a cave over the
    // lava and fell in (2026-09-27). Said, so the step is set aside or the
    // way back taken, not dug for.
    const home = require('./knowledge').dimensionOfBlock(step.block || '');
    const here = String(bot.game?.dimension || 'overworld').replace('minecraft:', '').replace('the_', '');
    if (home && home !== here) throw Object.assign(new Error(`No ${String(step.block).replaceAll('_', ' ')} in the ${here}: it is only found in the ${home}`), { name: 'WrongDimension', block: step.block, dimension: home });
    if (step.depth !== null && step.depth !== undefined) {
      const names = step.sources || Object.entries(MINEABLE).filter(([, info]) => info.drops === step.drops).map(([name]) => name);
      // The ore already tunnelled toward is kept while it is there and not
      // set aside; the nearest changes with every step down, and trial 54
      // turned between iron ores all round it for two minutes.
      const found = find(bot, names, 64, 16).filter(p => safeFromHostiles(bot, p) && !isSetAside(goal, 'reach', p));
      const held = goal.tunnelOre && found.find(p => p.x === goal.tunnelOre.x && p.y === goal.tunnelOre.y && p.z === goal.tunnelOre.z);
      const ore = held || found[0];
      if (ore) goal.tunnelOre = { x: ore.x, y: ore.y, z: ore.z }; else delete goal.tunnelOre;
      // With no ore in view, down toward the depth along a heading whose
      // staircase is not resting. Always east, a resting staircase threw at
      // once, was set aside, and the same east target came straight back:
      // mid-110-l's diamond step returned 927 times in four minutes
      // (2026-09-26).
      let target = ore;
      if (!target) {
        const { staircaseResting } = require('./tunneling');
        const feet = bot.entity.position.floored();
        // Eight headings, near and far, not four: mid-205-j had its four
        // resting at once and threw "every way down is set aside" fifteen
        // passes running until the loop watch ended the trial (2026-09-27).
        target = descentTargets(feet, step.depth).find(t => !staircaseResting(goal, t) && !isSetAside(goal, 'reach', t));
        if (!target) throw new Error(`Every way down toward the ${String(step.block).replaceAll('_', ' ')} from here is set aside for now`);
      }
      await tunnelOrSetAside(bot, task, goal, save, target, step.block, ore);
    } else await explore(bot, task, goal, save, step.block, { forItem: step.forItem || null });
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
  await explore(bot, task, goal, save, step.block, { forItem: step.forItem || null });
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
  let p, refused = null, tries = 0;
  const o = bot.entity.position.floored();
  // Up to three cells in one go: one the game refuses rests (note 761), and
  // the next is tried rather than the same one again at the next pass.
  for (const dy of [0, -1, 1, -2, 2]) for (let dx = -2; dx <= 2 && !p && tries < 3; dx++) for (let dz = -2; dz <= 2 && !p && tries < 3; dz++) {
    if (!dx && !dz) continue;
    const q = o.offset(dx, dy, dz);
    if (!stationCellOk(bot, goal, q)) continue;
    tries++;
    try { await place(bot, task, q, name); }
    catch (err) {
      task.check(); if (STATION_FATAL.has(err.name) || err instanceof Blocked) throw err;
      restStationCell(goal, q, name, err); refused = err;
      console.log(`[station] ${name} refused at ${q}: ${err.message}; the cell rests ${STATION_CELL_REST_MS / 60000} minutes`);
      continue;
    }
    p = q;
    rememberWorkstation(bot, goal, name, q);
  }
  if (!p && refused) throw refused;
  // Walled in (the bottom of a one-block shaft): a notch is cut in the wall
  // at foot or head height and the station goes in it, as a player would.
  // The wall of a saved shelter the bot stands in too: the station fills
  // the notch, so the shell stays whole, and mid-87-b asked for a place
  // for its table two hundred times from inside one (2026-09-25).
  // Trial 4 looked for an open cell six times over at the foot of its own
  // shaft, which had none (2026-09-24).
  if (!p) {
    const notch = [0, 1].flatMap(dy => faces.slice(1, 5).map(d => o.plus(d).offset(0, dy, 0))).find(q => {
      const b = bot.blockAt(q);
      return b?.boundingBox === 'block' && b.diggable && !reservedForConstruction(goal || {}, q, { from: o }) && bot.blockAt(q.offset(0, -1, 0))?.boundingBox === 'block' &&
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
  // A craft that made nothing twice in ten minutes rests, said (note 690).
  const { noteCraftFailure, noteCraftMade, craftRest, forRoom, clearCraftFailures } = require('./craft-failures');
  // A craft that made nothing for want of a free slot is not a craft that
  // fails: the room is asked for, every time, before its rest is said
  // (note 754). 25597 (mid-241-ba, 12:12 to 12:19Z) was told "Crafting oak
  // planks made nothing twice ... 0 free slots" thirty-six times running and
  // "My pockets are full" to attempt 70, and the drop question was never
  // asked: the rest was thrown before the room was looked at.
  const rest = craftRest(bot, step.item);
  if (rest && forRoom(bot, step.item) && !craftSlotFree(bot)) {
    await makeRoom(bot, task, step.item, { goal, keep: new Set(Object.keys(step.consumes || {})), room: () => craftSlotFree(bot),
      purpose: `the craft in hand (${step.item.replaceAll('_', ' ')}), which made nothing for want of a free slot` });
    task.check();
    if (!craftSlotFree(bot)) throw new Blocked(`No free slot for crafting ${step.item.replaceAll('_', ' ')}; the inventory is full and nothing was dropped for it`);
    clearCraftFailures(bot, step.item);
  } else if (rest && forRoom(bot, step.item)) clearCraftFailures(bot, step.item);
  else if (rest) throw new Blocked(rest.says);
  // No other window open: while one is, the server takes no click in the
  // pockets' grid and says nothing (25588's furnace, opened by a block
  // placed against it, note 690).
  const stray = closeStrayWindow(bot);
  if (stray) console.log(`[craft] closed a ${stray} window left open before crafting ${step.item}`);
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
  // Each batch's whole output, before its click: made room for as Jev
  // chooses, and said as a fact when it cannot be, never left to the
  // library, which tosses or asserts (mid-241-v, note 496). An ingredient
  // stack the craft uses up frees its slot, and that slot is room: the four
  // sticks from mid-241-v's last two planks cost it its flint and steel.
  const made = recipe.result.count, what = `${made} ${step.item.replaceAll('_', ' ')}`;
  // A free slot, always: the click takes the output to the cursor and puts
  // it back, and with none free the server confirmed nothing, whatever stack
  // it could have merged into or ingredient slot it would have emptied: of
  // 3,638 "timed out ... after crafting" in the flight records, 3,566 had 0
  // free slots, and all 2,648 since 2026-09-30T06Z (note 754).
  const fits = () => craftSlotFree(bot) && roomFor(bot, step.item, made);
  // Loose items on the floor within reach are picked up into the room just
  // made, once their pickup delay is up (note 771): 25594 (01:26:39 and
  // :48Z, 2026-10-01) threw its dirt for the planks' slot, picked up five
  // diorite lying there, and the craft timed out twice "0 free slots"; of
  // the 17 craft timeouts in the records from 23:00Z, all had none free.
  // With loose items about, the room is looked at again after the delay,
  // made again for what came in (said), up to three times.
  const looseNear = () => Object.values(bot.entities || {}).some(e => e?.name === 'item' && e.isValid !== false && e.position && bot.entity?.position && e.position.distanceTo(bot.entity.position) <= 4);
  const refilled = [];
  const roomForOutput = async () => {
    for (let i = 0; i < 3; i++) {
      if (fits() && !(i && looseNear())) return;
      if (!fits()) {
        const had = new Set(bot.inventory.items().map(it => it.name));
        await makeRoom(bot, task, step.item, { count: made, goal, keep: new Set(Object.keys(step.consumes || {})), away: table?.position, room: fits,
          purpose: `the craft in hand (${what})${refilled.length ? `; the room made before was filled again by ${[...new Set(refilled)].join(', ')} picked up off the floor` : ''}` });
        task.check();
        if (!fits()) break;
        if (!looseNear()) return;
        // The pickup delay of what lies about (two seconds), then looked at again.
        await sleep(2500); task.check();
        for (const it of bot.inventory.items()) if (!had.has(it.name)) refilled.push(it.name.replaceAll('_', ' '));
      }
    }
    if (!fits()) throw new Blocked(`No free slot for the ${what}; the inventory is full${refilled.length ? ` (the room made was filled again by ${[...new Set(refilled)].join(', ')} picked up off the floor)` : ''}`);
  };
  const before = countOf(bot, step.item);
  task.check();
  // Reconcile the cursor/grid between recipes while keeping a shared batch at
  // the same bench. Server-confirmed output, not planned amounts, is progress.
  const batches = Math.min(Math.ceil(step.count / recipe.result.count),
    Math.max(1, Math.floor((bot.registry.itemsByName[step.item].stackSize || 64) / recipe.result.count)));
  for (let n = 0; n < batches; n++) {
    task.check();
    const done = () => countOf(bot, step.item) >= before + recipe.result.count * (n + 1);
    await roomForOutput();
    try { await openWindow(bot, task, () => bot.craft(recipe, 1, table), { block: table, what: 'the crafting table', timeoutMs: 10000 }); }
    finally { task.check(); await settleCraftInventory(bot, task); }
    // A craft whose ingredients were left on the cursor made nothing (both
    // runs, every ten minutes or so: "cursor oak_planks"). Settled, it is
    // clicked once more here rather than failing the whole step.
    try { await waitFor(task, done, 4000); }
    catch (err) {
      task.check();
      // A first try that timed out with no free slot for the output
      // (a guess that an ingredient stack would empty its slot
      // did not hold, or the room checked before the batch has since gone)
      // will time out the same way again: made room first, or fail at once
      // with that reason, rather than waiting out the same timeout twice
      // (note 735; 25595's stone pickaxe timed out "after crafting... 0
      // free slots" and was retried once more, unchanged).
      if (!fits()) {
        await makeRoom(bot, task, step.item, { count: made, goal, keep: new Set(Object.keys(step.consumes || {})), away: table?.position, room: fits,
          purpose: `the craft in hand (${what}), after a first try timed out with no free slot for it` });
        task.check();
        if (!fits()) { noteCraftFailure(bot, step.item, `no free slot for the output (${bot.inventory.emptySlotCount?.() ?? '?'} free slots)`); throw new Blocked(`No free slot for the ${what}; the inventory is full`); }
      }
      const open = closeStrayWindow(bot);
      try { await openWindow(bot, task, () => bot.craft(recipe, 1, table), { block: table, what: 'the crafting table', timeoutMs: 10000 }); }
      finally { task.check(); await settleCraftInventory(bot, task); }
      try { await waitFor(task, done, 4000, awaitedItem(bot, step.item, before + recipe.result.count * (n + 1), `crafting${table ? ' at a table' : ''}, twice${open ? `, a ${open} window found open between` : ''}`)); }
      catch (failed) { task.check(); noteCraftFailure(bot, step.item, failed.message.replace(/^Timed out waiting for world\/inventory update: /, 'no output: ')); throw failed; }
    }
  }
  noteCraftMade(bot, step.item);
  // A pickaxe made beside another sound one is the spare, kept whole
  // (note 779).
  if (/_pickaxe$/.test(step.item)) { try { require('./pickaxe-roles').noteMade(bot, goal, step.item, goal?.gameProgress?.phase || null); } catch (_) { /* the craft is made either way */ } }
  // Its own table comes back into the pack when it is the only one: trials
  // 47 and 51 left theirs where they were used, wore out the last pickaxe
  // underground, and with forty-four iron ingots could make nothing, with
  // no table and no wood for one.
  if (table && !goal?.holdWorkstation && (goal?.expeditionReady || goal?.preparingExpedition || !countOf(bot, 'crafting_table')) && bot._ownedWorkstations?.has(`crafting_table:${table.position}`)) {
    const count = countOf(bot, 'crafting_table');
    // Best effort: the craft is made whether or not the table comes back.
    try {
      await dig(bot, task, table.position);
      await navigate(bot, task, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 1));
      await waitFor(task, () => countOf(bot, 'crafting_table') > count, 4000, () => 'the crafting table picked back up');
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
    forgetWorkstation(bot, goal, `crafting_table:${table.position}`);
  }
}

// A reserve found before dusk, priced where it is for the reserve alone
// (note 771): 25589 chose it at 23:51:00Z, 2026-09-30, 30 blocks under
// rock at hunger 18, and the errand that followed asked obtain_food 20
// times in three minutes with the herds 40 blocks up out of reach.
function foodReservePrice(bot, carried) {
  const errands = require('./food-errand');
  if (!errands.reserveOnly(bot, carried)) return '';
  let underground = false;
  try { underground = require('./levels').depthHere(bot) > 0; } catch (_) { underground = false; }
  const where = errands.whereSays(bot);
  return ` The trip is for the reserve alone: hunger ${bot.food}, ${(bot.food ?? 20) >= errands.HEALS_AT ? 'where health comes back' : 'met by eating what is carried'}.${underground ? ' Underground the dark is the same at any hour; the animals are at the surface.' : ''}${where ? ` ${where}` : ''} ${errands.reserveRecordSays({ underground, night: false })}`;
}

// A free slot in the pockets for a craft's click (note 754).
const craftSlotFree = bot => (bot.inventory.emptySlotCount?.() ?? 1) > 0;
// Said on an offer that crafts, with the pockets full (note 754b): the craft
// asks what to drop before its click.
const craftRoomSays = bot => craftSlotFree(bot) ? '' : ' The pockets are full (no free slot): a craft takes one, so what to drop for it is asked first.';
async function settleCraftInventory(bot, task) {
  task.check();
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  // What is on the cursor goes back only where there is room for all of
  // it. Put back with no slot named and none free, the library clicked slot
  // undefined: mid-241-v's four sticks stayed on the cursor with the pockets
  // full, and every craft after began with that click and failed "invalid
  // operation", ten times over (note 496). Room is Jev's to make; without
  // it, that is said.
  const held = bot.inventory.selectedItem;
  if (held) {
    const room = () => !bot.inventory.selectedItem || roomFor(bot, held.name, held.count);
    if (!room()) await makeRoom(bot, task, held.name, { count: held.count, room, purpose: 'the craft just made' });
    task.check();
    if (!room()) throw new Blocked(`No free slot for the ${held.count} ${held.name.replaceAll('_', ' ')} on the cursor; the inventory is full`);
    if (bot.inventory.selectedItem) await bot.putSelectedItemRange(bot.inventory.inventoryStart, bot.inventory.inventoryEnd, bot.inventory, null);
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  }
  // With the pockets full an item left in the grid has nowhere to go and
  // stays there, out of the item list: mid-83-k's logs and tables went into
  // the grid one by one and it crafted seventeen tables from logs it could
  // no longer see, until the audit called the loop (2026-09-26). Room first.
  for (let slot = 1; slot <= 4; slot++) {
    task.check();
    const item = bot.inventory.slots?.[slot];
    if (!item) continue;
    if (!roomFor(bot, item.name)) { try { await makeRoom(bot, task, item.name); } catch (err) { task.check(); } }
    // Put away with no room, the library throws it on the ground
    // (putSelectedItemRange's tossLeftover): left in the grid it is still
    // carried, and read so (pickaxe-roles.js carriedItems, note 779).
    if (!roomFor(bot, item.name)) { console.log(`[craft] ${item.count} ${item.name} left in the crafting grid: no room in the pockets`); continue; }
    await bot.putAway(slot);
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
  // Left to cook while the work went on (whileCooking's leave_cooking): not
  // finished first until it is done and the bot is back within 16 blocks of
  // its furnace, or LEAVE_BATCH_MS have passed.
  // Its time up with the bot more than 16 blocks from the furnace, it is not
  // walked back to unasked: upkeep offers the walk, priced (fetch_batch), or
  // leaving it for good (leave_batch). 25589 left 3 raw iron at its portal
  // in the Nether, and twenty minutes on, 657 blocks off, every step began
  // with the walk back, "No route" 398 times in nine minutes; 25592, 25595
  // and 25581 the same, 207 to 533 blocks off (note 775).
  // A batch not left but walked away from (a survival errand, a trip for
  // food) is the same once the bot is more than 64 blocks off: 25592 had
  // cooked mutton in a furnace at (101, 43, 100), climbed out for food, and
  // 207 blocks off its next acquire began with the walk back, 287 times in
  // seven minutes (note 775).
  if (goal.smelting && !goal.smelting.left && goal.smelting.position && bot.entity?.position && (!goal.smelting.dimension || goal.smelting.dimension === here)) {
    const p = goal.smelting.position, at = bot.entity.position;
    if (Math.hypot(at.x - p.x - 0.5, at.y - p.y, at.z - p.z - 0.5) > AWAY_FROM_BATCH) { const now = Date.now(); goal.smelting.left = { at: now, doneAt: now, lapsed: now, away: true }; save(); }
  }
  const left = goal.smelting?.left;
  if (left) {
    const now = Date.now(), p = goal.smelting.position, at = bot.entity?.position;
    const near = p && at ? Math.hypot(at.x - p.x - 0.5, at.y - p.y, at.z - p.z - 0.5) <= 16 : false;
    const lapsed = !!left.lapsed || now - left.at >= LEAVE_BATCH_MS;
    // Its way found wanting from about here lately: not taken again from
    // here (note 775b), however near the furnace is.
    const unreached = left.noRoute && now - left.noRoute.at < BATCH_NO_ROUTE_MS && at && Math.hypot(left.noRoute.from.x - at.x, left.noRoute.from.y - at.y, left.noRoute.from.z - at.z) <= LEFT_NEAR;
    if (unreached || (!(near && now >= left.doneAt) && !(near && lapsed))) {
      if (lapsed && !left.lapsed) { left.lapsed = now; save(); }
      return null;
    }
    delete goal.smelting.left; save();
  }
  return goal.smelting || null;
}
const LEAVE_BATCH_MS = 20 * 60000, LEFT_NEAR = 16, AWAY_FROM_BATCH = 64, BATCH_NO_ROUTE_MS = 10 * 60000;
// A portal frame being cast (portal_method's cast, a frame kept): the job in
// hand outranks a batch in a furnace (note 775b).
const castUnderWay = goal => !!(goal?.portalFrame?.cast && goal.portalMethod?.kind === 'cast');
// The batch in a furnace taken out at the head of a step, as it comes: true
// when that was the pass's work. Not while a portal frame is being cast, and
// a batch whose furnace cannot be walked to or reached from here is left
// where it is, said, and the step goes on: 25598 (mid-241-bq, 03:56:18Z on
// 2026-10-01) said "Lava in, water on top: I'm casting the portal frame",
// and in the same second its next step began with the batch of 3 raw iron
// in a furnace 11 blocks off and 7 up through rock; "I can't reach the
// furnace holding our saved batch", then "stayed out of reach; starting the
// batch again", a climb to daylight, a new furnace and the 3 iron again, the
// portal 1 block from done and then 26 (note 775b).
async function takeOutBatch(bot, task, goal, save = () => {}) {
  if (castUnderWay(goal)) return false;
  const batch = localBatch(bot, goal, save);
  if (!batch) return false;
  try { await smelt(bot, task, batch, goal, save); }
  catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    if (!(err?.name === 'NoRoute' || /furnace holding our saved batch/.test(String(err?.message)))) throw err;
    if (goal.smelting === batch && !batch.left) leaveUnreached(bot, goal, batch, String(err.message).slice(0, 160), save);
    console.log(`[batch] left in its furnace at (${batch.position?.x}, ${batch.position?.y}, ${batch.position?.z}): ${String(err.message).slice(0, 120)}; the step goes on`);
    return false;
  }
  return true;
}
function leaveUnreached(bot, goal, batch, why, save = () => {}, now = Date.now()) {
  const f = bot.entity.position.floored();
  delete batch.unreachable;
  batch.left = { at: now, doneAt: now, lapsed: now, away: true, noRoute: { at: now, from: { x: f.x, y: f.y, z: f.z }, why } };
  save();
}
// The batch left cooking whose time is up, with the bot away from its
// furnace in this dimension: offered at upkeep (note 775). Not while the walk
// there found no route from within 16 blocks of here in the last ten
// minutes (said on the leaving instead), nor once left for good.
function leftBatch(bot, goal, now = Date.now()) {
  const b = goal?.smelting, left = b?.left;
  if (!left || left.forgone || !b.position || (b.dimension && b.dimension !== dimension(bot))) return null;
  // Not run inside a portal cast (note 775b): offered once the frame is done.
  if (castUnderWay(goal)) return null;
  const at = bot.entity?.position;
  if (!at || !(left.lapsed || now - left.at >= LEAVE_BATCH_MS)) return null;
  const d = Math.hypot(at.x - b.position.x - 0.5, at.y - b.position.y, at.z - b.position.z - 0.5);
  const noRoute = left.noRoute && now - left.noRoute.at < BATCH_NO_ROUTE_MS && Math.hypot(left.noRoute.from.x - at.x, left.noRoute.from.y - at.y, left.noRoute.from.z - at.z) <= LEFT_NEAR ? left.noRoute : null;
  // Near it, only where its furnace could not be reached from here (note
  // 775b): leave_batch is offered then, fetch_batch is not.
  if (d <= LEFT_NEAR && !noRoute) return null;
  return { batch: b, left, distance: Math.round(d), noRoute };
}
// The walk to the batch's furnace found no route: the batch is left where
// it is, its time up, with where that was found and why (note 775).
function batchNoRoute(bot, goal, pending, err, save = () => {}, now = Date.now()) {
  if (err?.name !== 'NoRoute' || !pending || goal?.smelting !== pending) return false;
  const f = bot.entity.position.floored();
  pending.left = { at: now, doneAt: now, lapsed: now, noRoute: { at: now, from: { x: f.x, y: f.y, z: f.z }, why: String(err.message).slice(0, 160) } };
  save();
  return true;
}
function leftBatchSays(bot, lb, now = Date.now()) {
  const { batch: b, left, distance, noRoute } = lb;
  const what = `${b.count} ${String(b.from || 'items').replaceAll('_', ' ')} (to ${String(b.item).replaceAll('_', ' ')})`;
  const ago = Math.max(1, Math.round((now - (left.away ? (b.startedAt || left.at) : left.at)) / 60000));
  const carried = countOf(bot, b.item);
  const rungs = b.forRungs?.length ? ` It was sized for ${b.forRungs.map(r => r.replaceAll('_', ' ')).join(', ')}.` : '';
  const nether = /nether/.test(String(b.dimension || dimension(bot)));
  const { NETHER_TRIPS } = require('./game-progress');
  const walk = nether
    ? `about ${Math.max(1, Math.round(distance / NETHER_TRIPS.fast))} to ${Math.max(1, Math.round(distance / NETHER_TRIPS.slow))} minutes each way at the Nether's walks (${NETHER_TRIPS.slow} to ${NETHER_TRIPS.fast} blocks a minute, stops counted)`
    : `about ${Math.max(1, Math.round(distance / 4.3))} seconds each way at a walk if the way is open`;
  const tried = noRoute ? ` The walk there found no route from about here ${Math.max(1, Math.round((now - noRoute.at) / 1000))} seconds ago (${noRoute.why}).` : left.noRoute ? ` The walk there found no route ${Math.max(1, Math.round((now - left.noRoute.at) / 60000))} minutes ago from (${left.noRoute.from.x}, ${left.noRoute.from.y}, ${left.noRoute.from.z}) (${left.noRoute.why}).` : '';
  return { what, ago, carried, rungs, walk, tried, at: `(${b.position.x}, ${b.position.y}, ${b.position.z})` };
}

// Not copper (see survival.js NIGHT_ORES).
const WAIT_ORES = ['coal_ore', 'iron_ore', 'gold_ore', 'lapis_ore', 'redstone_ore', 'diamond_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_lapis_ore', 'deepslate_redstone_ore', 'deepslate_diamond_ore'];
// While a batch cooks: dig what is in arm's reach, walk to an ore or a tree
// nearby, dig the stone around, or stand by the furnace. Asked once a batch
// of Jev; null (nothing to weigh, or held through an outage) stands by the
// furnace, as smelt does.
async function whileCooking(bot, task, goal, save, { cooking, oreInReach, walkTarget, what, count, spent = [], leave = null, walks = null, sides = null, own = null, item = null, workOnOffer = null, ownWhy = null }) {
  // From one item up: trial 46 stood by its furnace for a one-ingot batch,
  // crafted, and stood again for a two-ingot one, seventy-five seconds on
  // one spot, each batch under the twenty seconds this once needed.
  const client = task.opportunityClient;
  if (cooking < 8000) return null;
  const seconds = Math.round(cooking / 1000);
  const tree = {};
  // Every way of spending the wait but standing digs, and each block dug is
  // a pickaxe use: said with what the pickaxes carried have left against
  // the way home, and whether another can be made (pickaxe-budget.js).
  // mid-243-ga, 72 blocks under open sky with its only pickaxe at 171 uses
  // and no wood for another, walked to ore after ore while 64 raw iron
  // cooked and wore it out in three minutes; the climb out was then by
  // hand, 60 blocks of stone at 7.5 seconds each (note 671).
  let budget = null;
  if (goal?.kind === 'win' && bot.game?.gameMode !== 'creative' && bot.inventory.items().some(i => /_pickaxe$/.test(i.name))) {
    try { budget = require('./pickaxe-budget').pickaxeBudget(bot, goal); } catch (_) { budget = null; }
  }
  const wear = budget ? ` Each block dug, ore or the rock on the way to it, wears the pickaxe a use. ${budget.says}${walks ? ` ${walks}` : ''}` : '';
  const near = oreInReach();
  if (near) tree.dig_in_reach = { description: `Dig the ${String(bot.blockAt(near)?.name || 'ore').replaceAll('_', ' ')} within arm's reach of the furnace, and any more there.${wear}` };
  // A walk only where there and back fits in the cooking, at a walk.
  const far = walkTarget(), fits = far && far.distanceTo(bot.entity.position) * 2 / 4.3 * 1000 + 4000 <= cooking ? far : null;
  if (fits) tree.mine_nearby = { description: `Walk to the ${String(bot.blockAt(fits)?.name || 'block').replaceAll('_', ' ')} ${Math.round(fits.distanceTo(bot.entity.position))} blocks off and dig it and the next nearest, back before the batch is done; the walks dig their way through rock where no way is open.${wear}` };
  if (countOf(bot, 'cobblestone') < 128) tree.dig_stone = { description: `Dig the stone around the furnace (${countOf(bot, 'cobblestone')} cobblestone carried): tools, a furnace and walls want it.${wear}` };
  // The side furnaces cook at the same time, said with the batch (note 771:
  // 25584, 25591 and 25597 at 23:38Z were told "the 8 raw iron" with 16
  // more in two furnaces beside and the step's 24 not said).
  const besides = sides ? ` (${sides.count} more in ${sides.furnaces} furnace${sides.furnaces === 1 ? '' : 's'} beside, cooking at the same time)` : '';
  const forRungs = own?.rungsWant && own.forRungs?.length ? ` The batch is sized to what the rungs still open want (${own.forRungs.map(r => r.replaceAll('_', ' ')).join(', ')}): ${own.rungsWant} more ${String(item || 'of it').replaceAll('_', ' ')} than carried.` : '';
  tree.wait_here = { description: `Stand by the furnace for the ${seconds} seconds the ${count} ${what} take${besides}. The furnace cooks on its own whether or not the bot stands by it; standing gains nothing meanwhile${budget ? ', and wears no pickaxe' : ''}.${forRungs}`, waits: require('./waits').timer(`the furnace to finish the ${count} ${what}`, cooking) };
  // A batch saved earlier, finished first by whatever work came next: the
  // work in hand need not wait for it. A player leaves the furnace to cook
  // and comes back for it (the user, 2026-09-29: mid-243-ga's climb for the
  // wood Jev chose waited on 64 raw iron, ten minutes, note 671).
  // The batch's own work left to cook too (note 771): of 1,583 while_cooking
  // asks from 2026-09-30 06:00Z, Jev answered none good 360 times, 184 of
  // them at 0.5 or more, and none of those had leave_cooking on offer; 692
  // waits stood by the furnace 30,050 seconds in all. Priced: the seconds
  // spent on other work instead of standing, against the walk back.
  let ownState = ownWhy && !leave ? `not offered: ${ownWhy}` : null;
  if (own && !leave) {
    let work = workOnOffer || [];
    if (!workOnOffer) { try { work = await restWork(bot, task, goal, save); } catch (err) { task.check(); work = []; } }
    const until = Date.now() + cooking;
    if (work.length) tree.leave_cooking = { description: `Leave the ${count} ${what} cooking${besides} and work from here meanwhile, the smelt step held off until it is done in about ${seconds} seconds: ${restWorkSays(bot, work, { until })} Then back to the furnace at (${own.at.x}, ${own.at.y}, ${own.at.z}) for the output: the walk back from where the work ends is about a second for every 4 blocks (16 blocks off, about 4 seconds), against the ${seconds} seconds of standing by it it saves. A piece of work still under way when the batch is done is ended there.${forRungs}` };
    else ownState = `not offered: ${restWorkSays(bot, work, { until })}`;
  }
  if (leave) tree.leave_cooking = { description: `Leave the ${count} ${what} cooking and go on with ${leave.work} now: the furnace cooks on its own, and the batch is taken out when the work next brings the bot within 16 blocks of the furnace once it is done (in about ${Math.max(1, Math.round(cooking / 60000))} minute${cooking >= 90000 ? 's' : ''}), or after ${Math.round(LEAVE_BATCH_MS / 60000)} minutes once the bot is within ${LEFT_NEAR} blocks of it; farther off then, the walk back is offered at upkeep with its distance (fetch_batch), never taken unasked. ${leave.carried}` };
  // Each of them keeps the bot at or near the furnace for the batch, among
  // the mobs about (note 628).
  const among = require('./risk').standingAmong(bot, seconds, { what: 'at or near the furnace' });
  if (among) for (const node of Object.values(tree)) node.description += ` ${among.says} The work is stopped when one of them comes within eight blocks in sight or lands a hit.`;
  for (const key of spent) delete tree[key];
  if (Object.keys(tree).length < 2) return null;
  try {
    const decision = await decide('while_cooking', { client, bot, task, goal, save, tree, state: { cooking: `${count} ${what}`, seconds, inventoryFreeSlots: bot.inventory.emptySlotCount?.() ?? null, timeOfDay: bot.time?.timeOfDay,
      ...(budget ? { pickaxeBudget: budget.says } : {}), ...(walks ? { walksSoFar: walks } : {}), ...(leave ? { workInHand: leave.work } : {}), ...(ownState ? { leaveCooking: ownState } : {}), ...(sides ? { sideFurnaces: `${sides.count} more in ${sides.furnaces} beside` } : {}),
      threats: (() => { try { return require('./danger').threats(bot, 16).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })); } catch (_) { return []; } })(), riskNow: (() => { try { return require('./risk').riskNow(bot); } catch (_) { return null; } })() } });
    if (decision.stale) return null;
    return decision.path.at(-1);
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return null; }
}

// More furnaces for a big batch, as a player does: twenty-four raw iron is
// four minutes in one furnace and eighty seconds in three. Trial 85 put all
// twenty-four in one at minute 43 and had its armour too late. Up to two
// furnaces beside the one in use, each loaded with a share and its fuel and
// left to cook, recorded on the goal so a restart still collects them; the
// main furnace takes the rest as before.
async function loadSideFurnaces(bot, task, goal, save, main, { item, from, fuelItem, total }) {
  if (!goal || total < 16 || bot.game?.gameMode === 'creative') return 0;
  const furnaces = Math.min(3, Math.floor(total / 8)), extra = furnaces - 1;
  if (extra < 1) return 0;
  const fuel = [fuelItem, ...CARRIED_FUELS].find(n => isFuel(n) && countOf(bot, n) >= fuelUnits(n, total));
  if (!fuel) return 0;
  const share = Math.floor(total / furnaces);
  const stone = countOf(bot, 'cobblestone') + countOf(bot, 'cobbled_deepslate') + countOf(bot, 'blackstone');
  if (countOf(bot, 'furnace') < extra && stone < 8 * (extra - countOf(bot, 'furnace'))) return 0;
  const step = goal.step;
  try {
    if (countOf(bot, 'furnace') < extra) await acquireStep(bot, task, 'furnace', extra, goal, save);
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return 0; }
  finally { goal.step = step; }
  let loaded = 0;
  const o = bot.entity.position.floored(), taken = [main.position];
  for (let n = 0; n < extra && countOf(bot, 'furnace') > 0 && countOf(bot, from) >= share; n++) {
    let cell = null;
    for (const dy of [0, 1, -1]) for (let dx = -2; dx <= 2 && !cell; dx++) for (let dz = -2; dz <= 2 && !cell; dz++) {
      const q = o.offset(dx, dy, dz);
      if ((dx || dz) && !taken.some(t => t.equals(q)) && stationCellOk(bot, goal, q)) cell = q;
    }
    if (!cell) break;
    try {
      try { await place(bot, task, cell, 'furnace'); }
      catch (err) { task.check(); if (!STATION_FATAL.has(err.name)) restStationCell(goal, cell, 'furnace', err); throw err; }
      rememberWorkstation(bot, goal, 'furnace', cell); taken.push(cell);
      const block = bot.blockAt(cell);
      const furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
      try {
        await furnace.putInput(bot.registry.itemsByName[from].id, null, share);
        await furnace.putFuel(bot.registry.itemsByName[fuel].id, null, fuelUnits(fuel, share));
      } finally { furnace.close(); }
      if (bot._syncWindow) await bot._syncWindow(bot.inventory);
      (goal.smeltingSides ||= []).push({ position: { x: cell.x, y: cell.y, z: cell.z }, dimension: dimension(bot), item, from, count: share, at: Date.now() });
      loaded += share; save();
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; break; }
  }
  return loaded;
}

// The side furnaces' output, taken when the main batch is done (they cook
// alongside it, so are done too), and the furnaces taken back up.
async function collectSideFurnaces(bot, task, goal, save, item) {
  const sides = (goal?.smeltingSides || []).filter(s => s.item === item && s.dimension === dimension(bot));
  for (const side of sides) {
    task.check();
    const p = pos(side.position);
    const forget = () => { goal.smeltingSides = (goal.smeltingSides || []).filter(s => s !== side); save(); };
    if (bot.blockAt(p) && bot.blockAt(p).name !== 'furnace') { forget(); continue; }
    try { await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      // Out of reach three times: left where it is, not gone back for on
      // every smelt. mid-87-e's two were sixty blocks under its pocket.
      side.unreachable = (side.unreachable || 0) + 1; save();
      if (side.unreachable >= 3) forget();
      continue;
    }
    const block = bot.blockAt(p);
    if (block?.name !== 'furnace') { forget(); continue; }
    // A free slot for the output before the window opens (note 754b).
    if ((bot.inventory.emptySlotCount?.() ?? 1) <= 0) await require('./inventory-tidy').makeRoom(bot, task, item, { away: p, room: () => (bot.inventory.emptySlotCount?.() ?? 1) > 0, purpose: `the ${item.replaceAll('_', ' ')} in the furnace beside the batch` });
    if ((bot.inventory.emptySlotCount?.() ?? 1) <= 0) continue;
    const furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
    let empty = false;
    try {
      const deadline = Math.max(Date.now() + 5000, side.at + side.count * 10000 + 15000);
      while (Date.now() < deadline && furnace.inputItem() && (furnace.outputItem()?.count || 0) < side.count) { task.check(); checkAir(bot); await sleep(500); }
      if (furnace.outputItem()) await furnace.takeOutput();
      empty = !furnace.inputItem() && !furnace.outputItem();
    } finally {
      try { if (bot._syncWindow) await bot._syncWindow(furnace); } finally { furnace.close(); }
    }
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    // Empty now: taken back up for the next time.
    if (empty) {
      try { await dig(bot, task, p); forgetWorkstation(bot, goal, `furnace:${p}`); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    forget();
  }
}

// What the rungs still open on the ladder want of a smelt's output, beyond
// what is carried (note 771): the iron of the pickaxes, the buckets, the
// shield and the armour; the gold of the golden boots. The plan's smelt is
// one rung's own (three ingots for a pickaxe or a bucket), and of 566 iron
// smelts in the flight records from 2026-09-30 06:00Z, 310 were three
// ingots, each with its own wait at the furnace, while raw iron for the
// next was carried.
const SMELT_FOR = { iron_ingot: () => require('./levels').IRON_FOR, gold_ingot: () => ({ golden_boots: 4, golden_helmet: 5, golden_chestplate: 8, golden_leggings: 7 }) };
function ladderSmeltWants(bot, goal, item) {
  const table = SMELT_FOR[item]?.();
  if (!table || goal?.kind !== 'win') return { wants: 0, rungs: [] };
  let rungs = [];
  try { rungs = require('./game-progress').rungsOpenAhead(bot, goal); } catch (_) { rungs = []; }
  const wanting = rungs.map(r => ({ phase: r.phase, n: (r.items || (r.item ? [r.item] : [])).reduce((n, i) => n + (table[i] || 0) * (r.items ? 1 : Math.max(1, (r.count || 1) - countOf(bot, i))), 0) })).filter(r => r.n > 0);
  const total = wanting.reduce((n, r) => n + r.n, 0);
  return { wants: Math.max(0, total - countOf(bot, item)), rungs: wanting };
}
// A new batch's size: the step's own count, or what the open rungs want of
// the output when that is more, up to the raw input carried, the fuel
// carried (coal and the like; the plan's planks cover only its own count)
// and a stack.
function smeltBatch(bot, goal, step, needed, carriedInput, plannedFuel) {
  const { itemsPerFuel } = require('./fuel');
  const { wants, rungs } = ladderSmeltWants(bot, goal, step.item);
  if (wants <= needed || carriedInput <= needed) return { count: needed, wants, rungs };
  const burns = CARRIED_FUELS.reduce((n, f) => n + Math.floor(countOf(bot, f) * itemsPerFuel(f)), 0) + (CARRIED_FUELS.includes(plannedFuel) ? 0 : needed);
  const count = Math.max(needed, Math.min(wants, carriedInput, burns, 64));
  return { count, wants, rungs, fuelFor: burns };
}

async function smelt(bot, task, step, goal, save = () => {}) {
  task.check();
  // Side furnaces from a batch that was cut short are emptied first; the
  // plan is made again from what that brings.
  // Side furnaces out of reach do not hold up a new batch: collected, the
  // plan is made again from what they brought; not, the smelt goes on here.
  // mid-87-e went back for two sixty blocks below its pocket, failed to get
  // there and smelted nothing, 579 times in a minute and a half (2026-09-26).
  const sidesFor = () => (goal?.smeltingSides || []).filter(s => s.item === step.item && s.dimension === dimension(bot)).length;
  if (!goal?.smelting && sidesFor()) {
    const before = sidesFor(), had = countOf(bot, step.item);
    await collectSideFurnaces(bot, task, goal, save, step.item);
    if (sidesFor() < before || countOf(bot, step.item) > had) return;
  }
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
    // The walk there finding no route leaves the batch where it is, said,
    // and the work goes on: the next step began with the same walk, and 25589
    // tried it 398 times in nine minutes 657 blocks off (note 775). Upkeep
    // offers it again (fetch_batch) from elsewhere.
    if (!bot.blockAt(p)) {
      try { await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3)); }
      catch (err) {
        task.check();
        batchNoRoute(bot, goal, pending, err, save);
        throw err;
      }
    }
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
    // Not given up with what is in it (note 771b: 19 "stayed out of reach;
    // starting the batch again" from 02:16Z, the raw input in the furnace
    // lost to the new batch): left where it is, its way said found wanting
    // from here, and asked about at upkeep (fetch_batch, leave_batch, note 775).
    if (!block && (pending.unreachable = (pending.unreachable || 0) + 1) >= 2) {
      const f = bot.entity.position.floored(), now = Date.now();
      delete pending.unreachable;
      pending.left = { at: now, doneAt: now, lapsed: now, away: true, noRoute: { at: now, from: { x: f.x, y: f.y, z: f.z }, why: 'the furnace stayed out of reach from here, twice' } }; save();
      throw new Blocked('The furnace holding our saved batch stayed out of reach; the batch is left there, asked about at upkeep');
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
  let needed = Math.min(pending ? pending.targetInventory - before : (carriedInput > 0 ? Math.min(step.count, carriedInput) : step.count), 64);
  // Sized to what the rungs still open want of it, up to the input and the
  // fuel carried (note 771), said with the batch.
  const batch = pending ? null : smeltBatch(bot, goal, step, needed, carriedInput, plannedFuel);
  if (batch && batch.count > needed) {
    console.log(`[smelt] ${step.from} batch ${needed} -> ${batch.count}: the open rungs want ${batch.wants} more ${step.item} (${batch.rungs.map(r => `${r.phase} ${r.n}`).join(', ')}), ${carriedInput} carried`);
    needed = batch.count;
  }
  let sideLoaded = 0;
  if (!pending && carriedInput >= needed) { sideLoaded = await loadSideFurnaces(bot, task, goal, save, block, { item: step.item, from: step.from, fuelItem: plannedFuel, total: needed }); needed -= sideLoaded; }
  if (goal && !pending) {
    // A batch left cooking elsewhere is let go, said: the new one takes its
    // place in the record (note 775).
    if (goal.smelting?.left && goal.smelting !== pending) goal.lostSmelting = { ...goal.smelting, at: new Date().toISOString(), why: 'left cooking in its furnace; a new batch begun at another' };
    goal.smelting = { item: step.item, from: step.from, fuelItem: plannedFuel, position: { ...block.position }, dimension: dimension(bot), targetInventory: before + needed, count: needed, startedAt: Date.now(), ...(sideLoaded ? { sides: sideLoaded } : {}), ...(batch?.wants ? { rungsWant: batch.wants, forRungs: batch.rungs.map(r => r.phase) } : {}) };
    save();
  }
  const sidesNow = (goal?.smeltingSides || []).filter(sd => sd.item === step.item && sd.dimension === dimension(bot));
  const sides = sidesNow.length ? { furnaces: sidesNow.length, count: sidesNow.reduce((n, sd) => n + (sd.count || 0), 0) } : null;
  // The same for the furnace's output, before the window opens: a free slot,
  // not a partial stack of the output to merge into, which the take does not
  // honor (note 754b), nor room for another batch's output left in the
  // furnace. 25592 carried a part stack of cooked mutton, so no room was
  // made, and the take of the iron left in the furnace failed (note 754c).
  const keepForSmelt = new Set([step.from, plannedFuel]);
  const slotFree = () => (bot.inventory.emptySlotCount?.() ?? 1) > 0;
  if (!slotFree()) await makeRoom(bot, task, step.item, { keep: keepForSmelt, away: block.position, room: slotFree, purpose: `the ${step.item.replaceAll('_', ' ')} to come out of the furnace` });
  let furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
  // While a container is open Mineflayer updates that window's player slots;
  // bot.inventory can still contain the pre-transfer counts until it closes.
  const carried = name => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart)
    ? furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(i => i?.name === name).reduce((n, i) => n + i.count, 0)
    : countOf(bot, name);
  let taken = 0, supplies, emptyBatch = false, left = false;
  // Room is checked again at the moment of taking: the slot made before the
  // window opened was filled by dirt from the furnace's own footing, then by
  // ore dug while waiting, and the ingots sat in the furnace until the wait
  // timed out ("have 0 of 4, 0 free slots", three times in a day audit).
  const free = () => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart)
    ? furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(i => !i).length
    : (bot.inventory.emptySlotCount?.() ?? 1);
  // A free slot, always, as for a craft (note 754): the output is taken to
  // the cursor and put back, and with none free the server confirmed
  // nothing whatever partial stack it could have merged into. Every one of
  // the 49 "timed out ... after smelting" in the flight records had 0 free
  // slots (note 754b; 25594 at 15:17-15:25Z).
  const roomInWindow = () => free() > 0;
  // Another batch's output is taken out first: it is the bot's own ingots
  // or food from an earlier smelt, and refusing the furnace over it held the
  // dream run at one furnace for half an hour ("Furnace contains a
  // different output", a hundred and sixty-six times).
  // Room for what waits in the furnace, asked of Jev (the drop question),
  // the window shut meanwhile and opened again after: every take of an
  // output goes this way, the batch's own and another's (note 754c).
  // Takes that came to nothing: the output left in the furnace (the server
  // found no slot), or thrown on the ground (mineflayer's putAway throws
  // what the cursor holds when the window has no slot for it: a furnace's
  // output is a result slot). Every one of the 21 "timed out ... after
  // smelting" since 2026-09-30T12Z but one had 0 free slots at the wait;
  // the take had been counted as the output's count whatever arrived, and
  // the ingots were in the furnace or on the floor (note 766).
  let refused = 0, thrown = 0;
  const refills = [];
  const roomFirst = async name => {
    try { if (bot._syncWindow) await bot._syncWindow(furnace); } catch (_) { /* best effort */ }
    furnace.close();
    try { if (bot._syncWindow) await bot._syncWindow(bot.inventory); } catch (_) { /* best effort */ }
    // Said when the room made before was filled again: what was thrown for
    // it lies at the feet and is picked up again beside the furnace (25590,
    // 19:00:21Z: the dirt thrown, a stone pickaxe off the floor in its slot).
    const again = refills.length ? ` The room made before was filled again before the take (${[...new Set(refills)].join(', ')} picked up off the floor beside the furnace), ${refused} time${refused === 1 ? '' : 's'}.` : '';
    await makeRoom(bot, task, name, { keep: keepForSmelt, away: block.position, room: () => (bot.inventory.emptySlotCount?.() ?? 1) > 0, purpose: `the ${name.replaceAll('_', ' ')} waiting in the furnace.${again}` });
    const afterDrop = new Set(bot.inventory.items().map(i => i.name));
    furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
    if (!roomInWindow()) for (const k of kinds().keys()) if (!afterDrop.has(k)) refills.push(k.replaceAll('_', ' '));
  };
  const windowSlots = () => Array.isArray(furnace.slots) && Number.isInteger(furnace.inventoryStart);
  const kinds = () => windowSlots() ? new Map(furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(Boolean).map(i => [i.name, 0])) : new Map();
  // The take, and what came of it read from the window as the server has
  // it (the window synced after the click: the click is applied to
  // mineflayer's own copy at once, whatever the server makes of it). The
  // count that came into the pockets, 0 where nothing did.
  const takeFrom = async name => {
    const was = furnace.outputItem()?.count || 0, had = carried(name), before = kinds();
    await furnace.takeOutput();
    if (!windowSlots()) return was;
    try { if (bot._syncWindow) await bot._syncWindow(furnace); } catch (err) { task.check(); }
    const got = Math.max(0, carried(name) - had);
    if (got) return got;
    const left = furnace.outputItem();
    if (left?.name === name && left.count >= was) {
      refused++;
      // What filled the slot: a kind carried now that was not before.
      for (const k of kinds().keys()) if (!before.has(k)) refills.push(k.replaceAll('_', ' '));
      return 0;
    }
    thrown += Math.max(0, was - (left?.name === name ? left.count : 0));
    return -1;
  };
  const noSlot = name => new Blocked(`The ${name.replaceAll('_', ' ')} would not come out of the furnace: no free slot at the take, ${refused} time${refused === 1 ? '' : 's'}${refills.length ? ` (the room made was filled again by ${[...new Set(refills)].join(', ')} picked up off the floor)` : ''}`);
  // Another batch's output: taken with room made for it first. 25592
  // (mid-237-be, 16:54:21Z, after 754b) cooked mutton at a furnace holding
  // another batch with the pockets full, and the cook ended "Furnace
  // contains a different output and there is no room to take it" with no
  // question asked, five times between survival_priority's answers.
  const clearOther = async () => {
    let other = furnace.outputItem();
    if (!other || other.name === step.item) return;
    if (!roomInWindow()) {
      await roomFirst(other.name);
      other = furnace.outputItem();
      if (!other || other.name === step.item) return;
      if (!roomInWindow()) throw new Blocked(`The furnace holds ${other.count} ${other.name.replaceAll('_', ' ')} from another batch and the pockets are full: nothing was dropped for it`);
    }
    if (!await takeFrom(other.name) && furnace.outputItem()?.name === other.name) throw noSlot(other.name);
  };
  // The room is read again after it is made and the window opened again,
  // and the take counts what came into the pockets. Three takes that
  // found no slot end the step, said, not a wait for what is not coming.
  const collect = async () => {
    await clearOther();
    for (;;) {
      const output = furnace.outputItem();
      if (!output) return;
      if (output.name !== step.item) throw new Error('Furnace contains a different output');
      if (!roomInWindow()) {
        if (refused >= 3) throw noSlot(step.item);
        refused++;
        await roomFirst(step.item);
        continue;
      }
      const got = await takeFrom(step.item);
      // Thrown on the ground: counted for the batch (it is out of the
      // furnace) and picked up after the window shuts.
      if (got < 0) { taken += output.count; return; }
      if (got > 0) { taken += got; return; }
      if (refused >= 3) throw noSlot(step.item);
      await roomFirst(step.item);
    }
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
      let deadline = Date.now() + amount * 12000 + 10000;
      // Ten seconds an item is time the bot stood beside the furnace (the
      // day audit's minute and a half): an ore within arm's reach is dug
      // meanwhile, from where it stands, the furnace shut and opened again.
      // Each way of spending the wait has its own budget, so a walk that
      // used its turns does not use up the stone's too.
      const done = { dig_in_reach: 0, mine_nearby: 0, dig_stone: 0 };
      // Only what the tools carried take a drop from: an ore dug by hand
      // gives nothing. mid-243-ga, its pickaxe worn out, walked on to lapis
      // and iron for five minutes digging stone by hand (note 671).
      const harvestable = p => { const b = bot.blockAt(p); return !b?.harvestTools || bot.inventory.items().some(i => b.harvestTools[i.type]); };
      const oreInReach = () => find(bot, WAIT_ORES, 5, 12).find(p => miningReach(bot, bot.entity.position, p) && bot.canDigBlock?.(bot.blockAt(p)) && harvestable(p) &&
        !isSetAside(goal || {}, 'reach', p) && safeFromHostiles(bot, p));
      // Further off, walked to and back while a long batch cooks: an ore
      // within sixteen, else a log while fewer than sixteen are carried.
      // Twenty raw iron at the base is two hundred seconds, and the dream
      // run stood by its furnace for four minutes of them with nothing in
      // arm's reach (the user: "he's not doing anything").
      const LOGS = Object.keys(bot.registry.blocksByName).filter(n => /_log$/.test(n) && !/stripped/.test(n));
      // Further still while more than a minute of it is left: whether the
      // walk there and back fits is weighed where it is offered.
      const walkTarget = () => {
        const ok = p => !isSetAside(goal || {}, 'reach', p) && safeFromHostiles(bot, p) && harvestable(p);
        const ore = find(bot, WAIT_ORES, cooking() >= 60000 ? 32 : 16, 16).find(ok);
        if (ore) return ore;
        const logs = bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
        return logs < 16 ? find(bot, LOGS, 16, 16).filter(p => p.y <= bot.entity.position.y + 3).find(ok) : null;
      };
      const cooking = () => (needed - taken) * 10000;
      // What to do while it cooks is Jev's, asked once a batch.
      // A choice that has run out (no more ore in walking distance, its
      // turns used) is asked again among what is left, not stood out: trial
      // 55 walked to eleven ores for a twenty-four-iron batch, then stood by
      // the furnace ninety seconds with stone all round it.
      // A saved batch finished first by other work may be left to cook
      // while that work goes on; not when the work in hand is this batch's.
      const inHand = goal?.step;
      const ownWork = !inHand || inHand.action === 'smelt' || [inHand.item, inHand.from].some(n => n && (n === step.item || n === step.from));
      const leave = pending && goal && !ownWork ? {
        work: `the ${String(inHand.action).replace(/_/g, ' ')}${inHand.item ? ` (${String(inHand.item).replace(/_/g, ' ')})` : ''}`,
        carried: `${countOf(bot, step.item)} ${String(step.item).replace(/_/g, ' ')}${countOf(bot, step.item) === 1 ? '' : 's'} carried now, besides the batch.`,
      } : null;
      // The digs of the walks so far this batch, in pickaxe uses: said when
      // asked again after a walk.
      const usesNow = () => bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).reduce((n, i) => n + Math.max(0, remainingUses(bot, i)), 0);
      const walked = { trips: 0, uses: 0 };
      const walks = () => walked.trips ? `The walks so far this batch: ${walked.trips} out and back, ${walked.uses} pickaxe uses worn.` : null;
      // The batch's own work may be left to cook too (note 771): the step is
      // held off while it cooks, other work done from here meanwhile, and
      // the bot comes back for it when it is done. Offered at every asking
      // while it is still of use (note 771b: 25584, in the Nether 03:11:34 to
      // 03:14:21Z, was asked again with only dig_stone and wait_here, none
      // good 0.74, and stood 180 seconds): not when the last leaving of this
      // batch found no work to do and came straight back, and not inside
      // another batch's hold (25590 at 03:14:25Z: the hold's earn_xp smelted
      // copper and left that batch too, three batches in eighteen seconds).
      let leaveCameBackEmpty = false;
      const ownNow = () => !leave && goal?.smelting && !leaveCameBackEmpty && !(bot._cookHold?.until > Date.now()) ? { at: block.position, rungsWant: goal.smelting.rungsWant || 0, forRungs: goal.smelting.forRungs || [] } : null;
      const ask = spent => whileCooking(bot, task, goal, save, { cooking: cooking(), oreInReach, walkTarget, what: String(step.from || step.item).replace(/_/g, ' '), count: needed - taken, spent: spent.filter(k => k !== 'leave_cooking'), leave, walks: walks(), sides, own: ownNow(), item: step.item, ...(leaveCameBackEmpty ? { ownWhy: 'left once this batch already, and the work on offer then ran out at once' } : {}) });
      let plan = await ask([]);
      const spent = [];
      const allow = key => !plan || plan === key;
      while (taken < needed) {
        if (plan === 'leave_cooking' && !leave) {
          // Its own batch: held off while it cooks, the work on offer from
          // here done meanwhile (holdForRest, as a rest's other work is),
          // and back to the furnace for it when it is done.
          const until = Date.now() + cooking(), what = String(step.from || step.item).replace(/_/g, ' '), step0 = goal.step, leftAt = Date.now();
          furnace.close();
          bot.chat?.(`Leaving the ${needed - taken} ${what} to cook, about ${Math.max(1, Math.round(cooking() / 1000))} seconds; working nearby meanwhile and coming back for them.`);
          let worked = true;
          bot._cookHold = { until, item: step.item };
          try {
            worked = await holdForRest(bot, task, goal, save, { client: task.opportunityClient, survival: null, reason: `smelt:${step.item}`, until, why: `${needed - taken} ${what} cooking in the furnace at (${block.position.x}, ${block.position.y}, ${block.position.z}), taken out when done`, idle: false });
          } finally { goal.step = step0; delete bot._cookHold; save(); }
          if (worked === false && Date.now() - leftAt < 10000) leaveCameBackEmpty = true;
          let back = null;
          try { back = await approachWorkstation(bot, task, 'furnace', [block.position]); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; back = null; }
          // No way back from where the work led: the batch is left where it
          // is, asked about at upkeep (fetch_batch or leave_batch, note 775),
          // not thrown as a failure the next step walks into again (25590,
          // 25592, 25598, 25585 and 25588 from 02:16Z: "I can't get back to
          // the furnace holding the raw iron", then "stayed out of reach;
          // starting the batch again", the iron in it given up).
          if (!back) {
            const f = bot.entity.position.floored(), now = Date.now();
            goal.smelting.left = { at: now, doneAt: until, lapsed: now, away: true, noRoute: { at: now, from: { x: f.x, y: f.y, z: f.z }, why: 'no way back to it from where the work meanwhile led' } }; save();
            bot.chat?.(`I can't get back to the furnace with the ${what} from here; I'll leave it there for now.`);
            left = true; break;
          }
          furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
          deadline = Math.max(deadline, Date.now() + (needed - taken) * 12000 + 20000);
          spent.push('leave_cooking');
          plan = cooking() >= 8000 ? await ask(spent) : null;
          continue;
        }
        if (plan === 'leave_cooking') {
          goal.smelting.left = { at: Date.now(), doneAt: Date.now() + cooking() }; save();
          bot.chat?.(`Leaving the ${needed - taken} ${String(step.from || step.item).replace(/_/g, ' ')} to cook and getting on; I'll take them out when I'm back by the furnace.`);
          left = true; break;
        }
        task.check(); checkAir(bot);
        if (Date.now() > deadline) throw new Error(`Smelting ${step.item} timed out`);
        await collect();
        if (taken < needed) await fuel();
        // Only with a slot to spare: the dug ore takes one, the ingots another.
        const spare = taken < needed && Date.now() < deadline - 15000 && (needed - taken) >= 2 && free() >= 2;
        const ore = spare && allow('dig_in_reach') && done.dig_in_reach < 6 && oreInReach();
        if (ore) {
          done.dig_in_reach++;
          furnace.close();
          try { await dig(bot, task, ore, { requireDrops: false }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', ore, err.message, 120000); }
          furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
          continue;
        }
        // No count on the walks: each trip is back before the batch is done,
        // and a budget of twenty-four digs sent trial 67 back to its furnace
        // with ore still about and ninety-seven seconds of iron to wait for.
        let far = spare && allow('mine_nearby') && cooking() >= 30000 && walkTarget();
        if (far) {
          furnace.close();
          // Out once, and on from one block to the next nearest while the
          // batch has time left, then back once: back to the furnace after
          // every block read as the bot going round in circles (the user,
          // 2026-09-24).
          const back = Date.now() + cooking() - 10000, usesBefore = usesNow();
          // Said, since the furnace cannot be seen: a bot walking off from
          // one looked lost (the user, 2026-09-24).
          const cookingWhat = String(step.from || step.item).replace(/_/g, ' ');
          bot.chat?.(`${needed - taken} ${cookingWhat} in the furnace, about ${Math.max(1, Math.round(cooking() / 60000))} minute${cooking() >= 90000 ? 's' : ''}. Mining the ${String(bot.blockAt(far)?.name || 'ore').replace(/_/g, ' ')} nearby meanwhile.`);
          // The pockets' own count while the window is shut: the furnace
          // window's copy of them is stale once closed, and the walk went on
          // digging into full pockets (note 771: 25591 at 01:27:08Z, 2026-10-01,
          // "no free slot at the take, 3 times" ten seconds after a walk
          // begun with three free).
          const pocketsFree = () => bot.inventory.emptySlotCount?.() ?? 1;
          for (let n = 0; far && n < 12 && Date.now() < back && pocketsFree() >= 2; n++, far = walkTarget()) {
            done.mine_nearby++;
            if (goal) { goal.step = { ...goal.step, whileCooking: { block: bot.blockAt(far)?.name, at: { x: far.x, y: far.y, z: far.z }, n } }; save(); }
            try {
              await navigate(bot, task, new goals.GoalGetToBlock(far.x, far.y, far.z), { timeoutMs: 15000, stallMs: 5000 });
              await dig(bot, task, far, { requireDrops: false });
            } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', far, err.message, 300000); }
          }
          try { await navigate(bot, task, new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3), { timeoutMs: 20000, stallMs: 6000 }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          // Asked again after a walk that wore the pickaxes, the uses said
          // as they fall (the plan was asked once a batch, and mid-243-ga's
          // walks went on to the last use, note 671).
          walked.trips++; walked.uses += Math.max(0, usesBefore - usesNow());
          if (plan === 'mine_nearby' && usesBefore > usesNow() && taken < needed) plan = (await ask(spent)) ?? plan;
          furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
          continue;
        }
        // Nothing to walk to, or none of it reachable: the stone in arm's
        // reach, at the feet or above and never the furnace's own footing,
        // while the stack is short. Cooking time is not standing time: trial
        // 12 stood eighty seconds by thirty-two copper, the coal it named
        // out of reach (2026-09-24).
        const feet = bot.entity.position.floored();
        const rock = spare && allow('dig_stone') && done.dig_stone < 40 && countOf(bot, 'cobblestone') < 128 &&
          find(bot, ['stone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff'], 5, 24)
            .filter(q => q.y >= feet.y && !q.equals(block.position.offset(0, -1, 0)) && bot.canDigBlock?.(bot.blockAt(q)) && harvestable(q) && !isSetAside(goal || {}, 'reach', q))[0];
        if (rock) {
          done.dig_stone++;
          furnace.close();
          try { await dig(bot, task, rock, { requireDrops: false }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (goal) setAside(goal, 'reach', rock, err.message, 120000); }
          furnace = await openWindow(bot, task, () => bot.openFurnace(block), { block, what: 'the furnace' });
          continue;
        }
        if (plan && plan !== 'wait_here' && cooking() >= 8000) { spent.push(plan); plan = await ask(spent); continue; }
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
  if (left) return;
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
  // What a take threw on the ground lies at the feet: picked up, with room
  // (note 766).
  if (thrown && countOf(bot, step.item) < before + needed && (bot.inventory.emptySlotCount?.() ?? 1) > 0) {
    try { await collectNearbyDrops(bot, task, step.item, { origin: bot.entity.position.clone(), radius: 5, timeoutMs: 5000, waitForSpawnMs: 500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  await waitFor(task, () => countOf(bot, step.item) >= before + needed, 4000, () => `${awaitedItem(bot, step.item, before + needed, 'smelting')()}${thrown ? `, ${thrown} thrown on the ground by a take with no slot` : ''}`);
  if (goal) { delete goal.smelting; save(); }
  await collectSideFurnaces(bot, task, goal, save, step.item);
  // A furnace the bot placed goes with it when it is travelling, like a
  // crafting table does. Leaving one behind at every camp cost the dream run
  // a cobblestone trip for each meal it cooked.
  if (block && !goal?.holdWorkstation && (goal?.expeditionReady || goal?.preparingExpedition || goal?.dream) && bot._ownedWorkstations?.has(`furnace:${block.position}`)) {
    const count = countOf(bot, 'furnace');
    // Taken back if it can be; a furnace whose drop is out of reach is not
    // worth the smelt that is done. mid-79-e's pick-up found no route, the
    // finished smelt threw for it, and was tried again, a loop at minute 4
    // (2026-09-26).
    try {
      await dig(bot, task, block.position);
      await navigate(bot, task, new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1), { timeoutMs: 8000, stallMs: 3000 });
      await waitFor(task, () => countOf(bot, 'furnace') > count);
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    finally { forgetWorkstation(bot, goal, `furnace:${block.position}`); }
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
    const ids = bot.registry.blocksArray.filter(b => /(_log|_wood|_ore|_planks)$|^(stone|sand|gravel|dirt|poppy|cornflower)$/.test(b.name)).map(b => b.id);
    // Planks only where the world put them, not the bot's own (a house, a
    // pocket's lid) nor a build's (note 754e).
    const ownPlank = b => /_planks$/.test(b.name) && (() => { try { return !!require('./own-blocks').laidAt(bot, b.position, goal) || reservedForConstruction(goal || {}, b.position); } catch (_) { return true; } })();
    const positions = bot.findBlocks({ matching: ids, maxDistance: 32, count: 48,
      useExtraInfo: b => faces.some(f => air(bot.blockAt(b.position.plus(f)))) && !ownPlank(b) });
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
  if (await takeOutBatch(bot, task, goal, save)) return false;
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

async function acquireStep(bot, task, item, count, goal, save, { minimumMiningY, reserved = {}, elsewhere } = {}) {
  task.check(); checkAir(bot);
  if (await takeOutBatch(bot, task, goal, save)) return false;
  const inv = planningInventory(bot);
  for (const [name, amount] of Object.entries(reserved)) inv[name] = Math.max(0, (inv[name] || 0) - amount);
  if ((inv[item] || 0) >= count) return true;
  const available = await withUsableWorkstations(bot, task, inv, [item]);
  const plan = catalogPlan(bot, item, count, available, goal);
  // A plan that mines what is found only in another dimension is the
  // caller's to answer, before any of it is begun here (game-progress.js
  // elsewhereStep, note 476).
  const away = elsewhere && elsewhereOf(plan, bot.game?.dimension, [{ item, count }]);
  if (away) return elsewhere(away);
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
  // What a mine step's block is for, said where its search asks (nether-
  // gather.js without); kept off the step as saved and compared.
  if (step.action === 'mine' && item !== step.drops) Object.defineProperty(step, 'forItem', { value: item, enumerable: false, configurable: true });
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
  else if (step.action === 'fill_bucket' && step.item === 'lava_bucket') await collectLava(bot, task, step, goal, save, { navigate, dig, resourceTunnelStep });
  else if (step.action === 'fill_bucket') await collectWater(bot, task, goal, save, { navigate, explore });
  else if (step.action === 'make_obsidian') await makeObsidian(bot, task, step, goal, save, { navigate, dig, approachDryMining, collectNearbyDrops, resourceTunnelStep, acquireStep });
  else if (step.action === 'hunt_mob') await prepareMobHunt(bot, task, step, goal, save, { acquireStep, explore, enterNether: netherStep, navigate, dig, returnOverworld: returnFromNether,
    // One block dug from where the bot stands and its drop picked up: the
    // fortress search's restock chooses which (bridging.js gatherSpanBlocks).
    mineAt: (b, t, g, sv, p, block, drops) => mine(b, t, { action: 'mine', block, sources: [block], drops, count: 1 }, g, sv, p),
    // The fortress sweep keeps no worksite: the rejoin walked the bot back
    // to the ledge it had just left, every other tick.
    // 'approach' is a shaft dug at a mob rather than past one, so the
    // hostile-avoidance that a travelling shaft needs is off for it.
    tunnel: (b, t, g, sv, target, resource) => ['fortress', 'approach'].includes(resource)
      // The fortress sweep's tunnel is the sweep's phase, as obsidian's is:
      // named 'tunnel' in turn with 'find_fortress', mid-87-j's leg was
      // called a flip at minute 59 (2026-09-26).
      ? tunnelStep(b, t, g, sv, target, { dig, navigate, approach: resource === 'approach', strict: resource === 'approach', within: resource === 'fortress' && g.step?.action === 'find_fortress' ? g.step : null })
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
  return {
    playerRequest: goal.request, retainedGoal: goal.kind,
    playerUrgency: goal.urgency?.level,
    inventory: planningInventory(bot), health: bot.health, food: bot.food, oxygen: bot.oxygenLevel,
    survivalFacts: { healthMaximum: 20, hungerMaximum: 20, hungerNeedsAttention: bot.food <= 16,
      injured: bot.health < 20, hungerAllowsNaturalHealing: bot.food >= 18, safeFoodCarried: !!chooseFood(bot) },
    dimension: bot.game.dimension, position: { ...bot.entity.position.floored() },
    // The day where there is one (note 677): 'day' was sent in the Nether.
    ...(/overworld/.test(String(bot.game?.dimension || 'overworld')) ? { daylight: bot.time?.timeOfDay < DAY.DARK ? 'day' : bot.time?.timeOfDay < DAY.DAWN ? 'night' : 'dawn' } : {}),
    ...(require('./exploration').biomeView(bot) || {}),
    ...(bot.game?.gameMode === 'survival' ? { riskNow: require('./risk').riskNow(bot), deathWouldCost: require('./risk').deathCost(bot, goal) } : {}),
    recentPositions: require('./stillness').recentPositions(bot),
    // The danger list's own mobs, seen or not (the decision audit): a list
    // of its own here left out every Nether mob, and the work in a fortress
    // read "no threats".
    nearbyThreats: (() => { try { return require('./danger').threats(bot, 24).map(t => ({ id: t.entity.id, name: t.entity.name, distance: Math.round(t.distance), visible: t.visible, shoots: require('./combat').shooter(t.entity) })); } catch (_) { return []; } })(),
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
// How long a detour's record is kept for the stall it answered.
const DETOUR_MEMORY_MS = 30 * 60000;

async function decideAction(bot, task, goal, save, client, onStep, tree, context = {}, id = 'resource_source', { above } = {}) {
  const observation = decisionObservation(bot, goal);
  const state = { ...observation, ...context };
  // On the reach nether with a frame begun, the portal's state is said with
  // every work question (note 763): 25584 (mid-244-ak, 20:30-20:34Z) smelted,
  // fetched planks and looted a minecart between six passes of its cast's
  // wall clearing, its frame ten of ten cast thirteen blocks off.
  if ((goal.rungTime?.phase || goal.gameProgress?.phase) === 'reach_nether' && goal.portalFrame && !goal.portalFrame.ruin && dimension(bot) === 'overworld' && !state.portal) {
    try { state.portal = require('./portal-state').portalFact(bot, goal).says; } catch (_) { /* said without it */ }
  }
  const fingerprint = () => decisionFingerprint(bot, { inventory: planningInventory, immediateThreat, needsAir });
  const initial = fingerprint();
  const decision = await decide(id, { client, bot, task, goal, save, tree, state, context: state, isFresh: () => fingerprint() === initial, above });
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
  if (changed) throw siteChanged(bot, pos(changed));
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
  if (await takeOutBatch(bot, task, goal, save)) return false;
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
    throw siteChanged(bot, pos(p));
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
  if (await takeOutBatch(bot, task, goal, save)) return false;
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
    // What the place round each source is (a spawner in reach, a dungeon or
    // mineshaft remembered, the mobs met there lately): mid-220-g went back
    // to the same gravel by a dungeon it knew for eighteen minutes, told
    // only the block and its distance (note 476).
    for (const source of resourceSources(bot, reachable, { failures: attemptsFor(goal).of('option'), resting: p => isSetAside(goal, 'reach', p) })) {
      const place = mobSourceAbout(bot, goal, { at: source.blocks[0], of: 'it' });
      actions[source.key] = { description: { ...source.description, ...(place ? { aboutThePlace: place.says.trim() } : {}), resource: step.drops, requiredTool: step.tool },
        valid: () => !!nearestRemaining(bot, source), run: () => workSource(bot, task, step, goal, save, source) };
    }
  }
  if (!Object.keys(actions).length) actions[step.action === 'mine' ? 'find_resource' : 'execute_recipe'] = {
    description: { action: step.action, dependency: step, rationale: 'Required by the shared recipe graph for the retained player request' },
    run: () => executeAcquisition(bot, task, step, goal, save),
  };
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

// The blocks the cast's walls are made of are any ordinary full block
// (build-sites.js portalSupportBlocks): the shortfall is made up in what the
// ground where the bot stands gives, not in the kind carried most. Topped up
// in the kind carried most, 25598 (mid-241-db, 2026-09-30 17:55-17:57:10Z),
// just up at y 37 from y -15, went back down to y 7 for "4 cobbled
// deepslate", then up again for food (note 753e). Deepslate lies below
// y 0; above it, stone gives cobblestone.
function supportMaterialHere(bot) {
  const y = bot.entity?.position?.y ?? 64;
  return /nether/.test(String(bot.game?.dimension || '')) ? 'netherrack' : y < 0 ? 'cobbled_deepslate' : 'cobblestone';
}
async function preparePortalSupports(bot, task, goal, save, needed) {
  const carried = portalSupports(bot);
  if (carried.count >= needed) return true;
  const material = supportMaterialHere(bot);
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
async function enterPortal(bot, task, portal, arrived, { walk = navigate } = {}) {
  // Standing in the portal it just came through, the bot must step out
  // first: a player is not sent back until it has left the sheet.
  // Out of either face of the sheet: the one behind can be fire. mid-218-m-
  // nether-3's step back went into the soul fire before its Nether-side
  // portal, the other face clear (note 502); the move will not walk into
  // fire (motion.js), and the sheet is left the other way.
  if (inPortal(bot) && !arrived()) {
    const refused = [];
    for (const key of ['back', 'forward']) {
      const since = Date.now();
      if (await move(bot, task, { label: 'leave_portal', keys: [key], sneak: true, maxMs: 1200, tick: 50, until: () => !inPortal(bot) })) break;
      if (bot._moveRefused?.label === 'leave_portal' && bot._moveRefused.at >= since) refused.push(bot._moveRefused);
    }
    if (inPortal(bot) && refused.length === 2) {
      throw new Error(`Both faces of the portal the bot stands in step into fire or lava (${refused.map(r => `${r.name.replace('_', ' ')} at ${r.x}, ${r.y}, ${r.z}`).join('; ')}); not walked into`);
    }
  }
  // The last cells up to the frame may be taken beside lava: a portal is
  // where it is, and the step in is crouched (below). The way there keeps
  // off the lava's edge as every walk does (movement.js, note 516).
  const atFrame = c => Math.abs(c.x - portal.x) <= 2 && Math.abs(c.y - portal.y) <= 2 && Math.abs(c.z - portal.z) <= 2;
  // At the frame already, and the pathfinder finding no route to the sheet
  // because every cell round the arrival's platform is beside a drop it
  // refuses: the step in below is crouched (a sneaking player does not walk
  // off an edge) and one block long, so it is taken. On 2026-09-28 four
  // arrivals in the Nether (25583, 25588, 25593, 25595) chose the trip back
  // for food from the portal they stood beside; each ended "No route from
  // here to (x, y, z) (partial): the way passes along a drop that would
  // kill", one block from the sheet, and the trip was never made (note 643).
  try { await walk(bot, task, new goals.GoalNear(portal.x, portal.y, portal.z, 1), { timeoutMs: 20000, besideLava: atFrame }); }
  catch (err) {
    task.check();
    if (err?.name !== 'NoRoute' || !atFrame(bot.entity.position.floored())) throw err;
  }
  if (arrived()) return;
  bot.pathfinder.setGoal(null);
  if (!inPortal(bot)) {
    // Crouched, it cannot step down: a portal a block below the bot's feet
    // is walked into upright, the one step checked to land in the sheet.
    const below = portal.y < Math.floor(bot.entity.position.y);
    // From water the step in is a swimmer's climb out, forward and jump,
    // upright: crouched, a swimmer sinks. mid-242-ab's portal had water
    // before its face (its cast's own, note 567); the walk ended afloat at
    // the sheet, the crouched step sank it to the bottom of the hole in
    // front, and the step failed there every two seconds for half an hour.
    // Afloat is in the water too, bobbing with the feet a moment above it.
    const wet = p => /^water$|^bubble_column$/.test(bot.blockAt(p)?.name || '');
    const feet = bot.entity.position.floored();
    const swimming = bot.entity.isInWater === true || wet(feet) || (!bot.entity.onGround && wet(feet.offset(0, -1, 0)));
    await move(bot, task, { label: 'enter_portal', keys: swimming ? ['forward', 'jump'] : ['forward'], sneak: !below && !swimming,
      why: swimming ? 'a climb out of the water into the portal: crouched, a swimmer sinks' : below ? 'a step down into the portal' : undefined,
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
  // One Jev chose to pass over for a portal made here (portal_way) is not
  // made for while that holds.
  // In the Overworld a portal past 600 blocks is not walked to (one is made
  // nearer). In the Nether a known portal is the only way home, however
  // far: 25597 (mid-242-gf) was offered the return to one 937 blocks off,
  // the distance said, chose it, and was answered "No loaded return portal
  // observed" (note 685).
  const known = (goal.portals || []).filter(p => p.dimension === where && (where === 'nether' || Math.hypot(p.x - here.x, p.z - here.z) <= 600) && !isSetAside(goal, 'portal_passed', { x: p.x, y: p.y, z: p.z }))
    .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z));
  // None seen here since the crossing: where the game put the one the bot
  // came through, from its Overworld side (note 607). The portal is seen
  // and remembered on the way, and walked into from there.
  if (!known.length && where === 'nether') { const came = require('./game-progress').cameThrough(goal, here); if (came) known.push(came); }
  if (!known.length) return false;
  // With blaze rods carried, the portal the way in began at, where it is one
  // remembered: its way back is known (note 762). 25588 (11:50Z) made for a
  // portal 114 blocks off with its way in beginning at another.
  let p = known[0];
  if (where === 'nether' && require('./walk-out').rodsCarried(bot)) {
    const start = require('./walk-out').backTrail(require('./walk-out').wayInOf(bot, goal), here)?.start;
    const came = start && known.find(q => Math.hypot(q.x - start.x, q.y - start.y, q.z - start.z) <= 6);
    if (came) p = came;
  }
  // At the place worked out and still none in view: it is not there.
  if (p.estimated && Math.hypot(p.x - here.x, p.z - here.z) <= 8) return false;
  goal.step = { action: 'return_to_portal', portal: { x: p.x, y: p.y, z: p.z } }; save();
  // Close enough to route: walk. Otherwise, or when the walk gives out, dig
  // a staircase toward it the way an ore is reached; a portal at y=-11 is
  // not on any surface route. What each way ended in is kept, for the
  // question when none gets there (portalWay).
  let distance = here.distanceTo(pos(p));
  let walk;
  // With blaze rods carried in the Nether, back the way it came in first:
  // cells stood on alive and its own spans, not a fresh route over the lava
  // sea (walk-out.js, note 762). Stopped, it rests two minutes and the ways
  // on are asked with what it came to.
  const walkOut = require('./walk-out'), rods = where === 'nether' ? walkOut.rodsCarried(bot) : 0;
  if (rods && !isSetAside(goal, 'way_in', pos(p))) {
    const went = await walkOut.walkBack(bot, task, goal, p, navigate);
    if (went.tried && !went.ok) { setAside(goal, 'way_in', pos(p), `the way back along it stopped: ${went.why}`, 120000); save(); walk = `back the way it came in: ${went.walked} cells walked, then ${went.why}`; }
    if (went.tried) distance = bot.entity.position.distanceTo(pos(p));
  }
  // The way in stopped: the ways on are Jev's, with what it came to.
  if (walk) return portalWay(bot, task, goal, save, p, where, { walk });
  if (distance <= 48) {
    try { await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 60000, stallMs: 8000, passing: where === 'nether' }); return true; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; walk = `the walk there failed (${String(err.message || err).slice(0, 80)})`; }
  } else if (!isSetAside(goal, 'portal_leg', pos(p))) {
    if (await portalLeg(bot, task, goal, p)) return true;
    setAside(goal, 'portal_leg', pos(p), 'a walk toward it made no ground', 120000); save();
    walk = 'legs of thirty-two blocks on foot toward it made no ground';
  } else walk = 'legs of thirty-two blocks on foot toward it made no ground, and rest two minutes';
  // In the Nether, no ground on foot: straight at it at this height, through
  // the netherrack or over the lava on blocks laid ahead, as far as the
  // cells ahead show (nether-travel.js). mid-211-c's legs on foot and its
  // staircase both failed 250 blocks from its portal, and nothing else was
  // tried (note 241, 2026-09-26). The height is made up where it stands
  // below the portal, by the pillar (tunnelToward).
  // Not with rods carried: a span of its own over the lava sea is a fresh
  // route over lava, and a fall or a push off it loses every rod; offered
  // with that said (portal_way dig_across, note 762).
  if (where === 'nether' && rods) walk = `${walk}; the crossing straight at it over open air or lava is not begun unasked while rods are carried`;
  else if (where === 'nether') {
    const { crossToward } = require('./nether-travel');
    portalApproach(goal, p, bot.entity.position);
    const crossed = await crossToward(bot, task, goal, save, pos(p), { what: 'the portal back', beat: approachBest(goal, p) });
    if (crossed.tried && portalApproach(goal, p, bot.entity.position)) return true;
    if (crossed.tried) walk += '; a crossing straight toward it at this height came no nearer';
    else if (crossed.madeAlready) walk += `; ${crossed.madeAlready}`;
  }
  // Farther off, a leg of the way on foot first: ninety-six blocks from
  // the portal the staircase was the only thing tried, and it went up and
  // down one fortress corridor for eighty-eight rounds.
  // Across water, the boat: mid-229-k walked the shore of a lake eighty
  // blocks across for twenty minutes with an oak boat in its pack, the walk
  // and the staircase both failing at the water (note 419). Jev's to
  // choose, with the swim it saves (boats.js chooseBoat).
  if (where === 'overworld') {
    if (await boatTravelStep(bot, task, goal, save, pos(p), { acquireStep })) return true;
  }
  // Neither the walk, the boat nor the staircase gets there: what next is
  // Jev's, not the same ways again. mid-202-o-nether-3, 374 blocks from its
  // Overworld portal with water between, threw "No way back" at every pass
  // and the run ended with a lava pool known and a bucket carried (note
  // 495).
  return stairsOrWay(bot, task, goal, save, p, where, walk);
}

// The staircase toward a portal (tunnelToward, a pillar first below it), or
// once it rests or stalls, the way Jev's (portalWay). A rest met is not the
// staircase planned again: mid-208-k-nether-3, its portal in view 37 blocks
// across and 38 up from its own span over the lava sea, went into the
// staircase every few seconds for a minute, each met at once by the rest
// ("no safe step ... (no floor 6)"), the stall asked seven times and only
// "differently" and a crossing offered (note 556).
async function stairsOrWay(bot, task, goal, save, p, where, walk) {
  const { restingWay } = require('./tunneling');
  if (restingWay(goal, pos(p), bot.entity.position)) return portalWay(bot, task, goal, save, p, where, { walk });
  // In the Nether, a staircase that first wants a pickaxe from wood not
  // carried is a gathering's search away from the portal: the ways toward
  // the portal itself are asked beside it (portal_way's dig_across and
  // pickaxe_first). 25598 (mid-241-cc, 16:52:37Z on 2026-09-30), at 0.8
  // health with no food and its portal 50 blocks due north on ground, found
  // no route on foot and was sent for stems: nether_gather leg_west, "part of
  // go back", took it 32 blocks away from the portal (note 751b).
  // Chosen, the pickaxe is got for ten minutes without asking again.
  if (where === 'nether' && stairPickaxeWanted(bot, goal, pos(p))?.gather && !(goal.portalPickaxeChosen?.at > Date.now() - PORTAL_PICKAXE_HOLD_MS)) return portalWay(bot, task, goal, save, p, where, { walk, pickaxeWanted: stairPickaxeWanted(bot, goal, pos(p)) });
  try { await tunnelToward(bot, task, goal, save, pos(p), `portal_${where}`); }
  catch (err) { task.check(); if (err.name !== 'StaircaseStalled') throw err; return portalWay(bot, task, goal, save, p, where, { walk }); }
  return true;
}

// What lies on the straight line toward `to`, as far as the ground is
// loaded (ninety-six blocks at most): the top block every two blocks, said
// as water, lava, ground or a drop past what is seen.
function lineSays(bot, to, max = 96) {
  const here = bot.entity?.position, d = here && Math.hypot(to.x - here.x, to.z - here.z);
  if (!d || d < 4 || typeof bot.blockAt !== 'function') return null;
  const n = { water: 0, lava: 0, ground: 0, drop: 0 }, span = Math.min(max, d), y0 = Math.floor(here.y);
  let loaded = 0;
  for (let s = 2; s <= span; s += 2) {
    const x = Math.floor(here.x + (to.x - here.x) * s / d), z = Math.floor(here.z + (to.z - here.z) * s / d);
    let top = null, seen = false;
    for (let y = y0 + 12; y >= y0 - 24; y--) {
      const b = bot.blockAt(new Vec3(x, y, z));
      if (!b) break;
      seen = true;
      if (/water|lava|kelp|seagrass/.test(b.name) || b.boundingBox === 'block') { top = b; break; }
    }
    if (!seen) break;
    loaded = s;
    n[!top ? 'drop' : /lava/.test(top.name) ? 'lava' : /water|kelp|seagrass/.test(top.name) ? 'water' : 'ground'] += 2;
  }
  if (!loaded) return `The ground toward it is not loaded from here.`;
  const parts = [n.water && `${n.water} over water`, n.lava && `${n.lava} over lava`, n.ground && `${n.ground} on ground`, n.drop && `${n.drop} over a drop of more than twenty-four`].filter(Boolean);
  return `On the straight line toward it, of the ${loaded} blocks loaded: ${parts.join(', ')}${loaded < Math.floor(span) - 1 ? `; past ${loaded} blocks the ground is not loaded` : ''}.`;
}

// A leg of thirty-two blocks on foot square to the heading, left or right:
// round the water or the drop the straight way meets.
async function sideLeg(bot, task, p, side) {
  const here = bot.entity.position, dx = p.x - here.x, dz = p.z - here.z, d = Math.hypot(dx, dz) || 1;
  // With x east and z south, left of a heading (hx, hz) is (hz, -hx).
  const [ux, uz] = side === 'left' ? [dz / d, -dx / d] : [-dz / d, dx / d];
  try { await navigate(bot, task, new goals.GoalNearXZ(here.x + ux * 32, here.z + uz * 32, 4), { timeoutMs: 30000, stallMs: 8000, sprint: true }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return { ok: false, why: String(err.message || err).slice(0, 120) }; }
  return { ok: true };
}

// The boat's last word on this water: failed and resting, or the walk
// chosen over it here.
function boatSays(goal) {
  const state = goal.boatTravel;
  if (!state) return null;
  if (isSetAside(goal, 'boat', 'crossing')) return `the boat was tried and failed (${state.lastError || attemptsFor(goal).why('boat', 'crossing') || 'not known'}), and rests`;
  if (state.declinedUntil > Date.now()) return 'the boat was offered for the water here and the walk chosen';
  return null;
}

// Every way to a remembered portal has failed from here: the walk, the
// boat, the staircase. What next is Jev's (portal_way), with what each
// ended in and what lies on the line between; asked once for each rest
// from each place (as a frame out of reach is, note 482), and met again,
// every way resting is said (WaysResting), not a pass repeated.
async function portalWay(bot, task, goal, save, p, where, { walk, pickaxeWanted = null, client = task.opportunityClient } = {}) {
  const { staircaseWhy, staircaseUntil, landingKey, WaysResting } = require('./tunneling');
  const target = pos(p), here = bot.entity.position, now = Date.now();
  const distance = Math.round(Math.hypot(p.x - here.x, p.z - here.z));
  const fromRest = attemptsFor(goal).entries[require('./progress').keyOf('staircase_from', landingKey(here.floored(), target))];
  const until = Math.max(staircaseUntil(goal, target), fromRest?.until > now ? fromRest.until : 0);
  const minutes = until ? Math.max(1, Math.ceil((until - now) / 60000)) : 0;
  const boat = where === 'overworld' ? boatSays(goal) : null;
  const between = lineSays(bot, target);
  // Why it rests as its rest said it, by the target's area or from here.
  const stairsWhy = require('./tunneling').restingWay(goal, target, here, now)?.why || staircaseWhy(goal, target);
  const rise = Math.round(p.y - here.y), height = Math.abs(rise) > 2 ? ` across and ${Math.abs(rise)} ${rise < 0 ? 'below' : 'above'}` : ' off';
  const says = `The ${where} portal at (${p.x}, ${p.y}, ${p.z}) is ${distance} blocks${height} and cannot be reached from here: ${walk || 'the walk made no ground'}${boat ? `; ${boat}` : ''}; and the staircase toward it is set aside (${stairsWhy})${minutes ? `, taken up again in ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}.${between ? ` ${between}` : ''}`;
  // The place asked from is its height too: a pillar up is somewhere else.
  const key = `${p.x},${p.y},${p.z}`, from = `${Math.floor(here.x / 8)},${Math.floor(here.y / 8)},${Math.floor(here.z / 8)}`;
  // Met again from the same place in the same rest: "other work" chosen is
  // every way resting, said; a way chosen that ended back here is said with
  // the question asked again.
  const held = goal.portalWay, again = held && held.key === key && held.until === until && held.from === from ? held : null;
  if (again?.pick === 'wait_rest') throw new WaysResting(`${says} The way was asked from here with this, and other work chosen until then.`, until);
  // The ways tried from here in this rest that came to nothing (moved under
  // four blocks and came no nearer): not offered again from here, said.
  // mid-244-ad-nether-1 was asked this ninety-five times in ten minutes on
  // its span, around_right and around_left in turn, each leg back within a
  // third of a second having moved nothing; "chosen from here before" went
  // on the last one only, so the other looked fresh, and the answers and
  // facts changing each time, note 560's same-answer rule never saw a run
  // (note 568).
  const tried = Object.fromEntries(Object.entries(again?.tried || {}).filter(([, t]) => now - t.at < PORTAL_WAY_TRIED_MS));
  const tree = {};
  const lighter = countOf(bot, 'flint_and_steel') + countOf(bot, 'fire_charge') > 0;
  if (where === 'overworld') {
    let lava = null; try { lava = nearestLava(bot, goal); } catch (_) { /* nothing loaded to look in */ }
    const nx = Math.round(here.x / 8), nz = Math.round(here.z / 8);
    const netherSide = (goal.portals || []).filter(q => q.dimension === 'nether').sort((a, b) => Math.hypot(a.x - nx, a.z - nz) - Math.hypot(b.x - nx, b.z - nz))[0];
    tree.portal_here = { description: `Make a portal here instead and pass this one over for half an hour; how it is made is asked next: a frame from ten obsidian (${countOf(bot, 'obsidian')} carried), or one cast from lava and water (${countOf(bot, 'bucket') + countOf(bot, 'lava_bucket')} bucket${countOf(bot, 'bucket') + countOf(bot, 'lava_bucket') === 1 ? '' : 's'} and ${countOf(bot, 'water_bucket') ? 'a water bucket' : 'no water bucket'} carried; ${lava ? `the nearest lava ${lava.distance} blocks off, ${lava.how}` : 'no lava known'}). ${lighter ? 'A lighter is carried.' : 'No flint and steel or fire charge is carried: one is made first.'} It comes out in the Nether near ${nx}, ${nz}${netherSide ? `, ${Math.round(Math.hypot(netherSide.x - nx, netherSide.z - nz))} blocks from the Nether portal remembered` : ''}.` };
  } else if (countOf(bot, 'obsidian') >= 10 && lighter && portalSupports(bot).count >= 3 && !isSetAside(goal, 'portal_here', 'nether')) {
    tree.portal_here = { description: require('./nether-travel').portalHereSays(bot, goal) };
  }
  const climb = climbSays(bot, target);
  if (climb) tree.climb_here = { description: climb.says };
  for (const side of ['left', 'right']) tree[`around_${side}`] = { description: `Go round: a leg of thirty-two blocks on foot to the ${side} of the heading to the portal, the pathfinder bridging and climbing where it can, and the way asked again from where it ends.` };
  if (boat) tree.boat_again = { description: `Take the boat again over the water toward it, though ${boat}: the crossing is surveyed from here and the boat made or taken from the pack.` };
  // Down to the floor and along it toward the portal, where the ground
  // below is walkable and a way down is found (note 568).
  const nt = require('./nether-travel');
  const down = where === 'nether' ? nt.floorWay(bot) : null, floor = down && nt.floorToward(bot, down, target);
  if (floor && floor.floor >= nt.FLOOR_WALKABLE) tree.floor_way = { description: nt.floorTowardSays(down, floor, { what: 'the portal', target }) };
  // Straight at it with blocks mined first, where the crossing at this
  // height stops for want of them: mid-242-aa-nether-1-fortress-3, 145
  // blocks from its portal with one block carried, was offered the legs
  // round and waiting, none good 0.38 (note 580).
  const short = where === 'nether' ? blocksShortSays(bot, goal, target) : null;
  if (short) tree.blocks_then_cross = { description: short.says };
  // Straight at it now, rock dug by hand where there is no pickaxe, and the
  // pickaxe for the staircase got first: toward the portal, and away from it
  // for wood, side by side (note 751b).
  let across = null;
  if (where === 'nether' && !nt.crossingResting(bot, goal, target)) {
    try { across = require('./bridging').surveyCrossing(bot, target, { cells: nt.CROSS_STRETCH }); } catch (_) { across = null; }
    // Not where its stretch ends no nearer than the bot has already come
    // (crossToward's own beat, note 629).
    const best = approachBest(goal, p);
    if (across?.cells && across.gain >= 1 && !(Number.isFinite(best) && Math.hypot(target.x - across.end.x, target.z - across.end.z) >= best - 1)) tree.dig_across = { description: `Straight at the portal now at this height, ${pickaxeTier(bot) < 1 ? 'the rock in the way dug by hand (no pickaxe carried)' : 'the rock in the way dug with the pickaxe carried'} and a block laid over open air, ${across.cells} cells of the way; then the way on asked again from where it ends. ${nt.crossingSays(across, 'the portal')}` };
  }
  if (pickaxeWanted) {
    let fetch = null;
    try { fetch = await require('./nether-wood').fetchStemsOffer(bot, task, goal); } catch (_) { fetch = null; }
    const wood = fetch ? await fetch.describe() : 'No stem is known and none is on offer to fetch: the wood is looked for by the gathering\'s legs.';
    tree.pickaxe_first = { description: `Get ${pickaxeWanted.item.replaceAll('_', ' ')} first for the staircase to the portal, from wood not carried, then the staircase: the gathering goes where the wood is, not toward the portal. ${wood}` };
  }
  // With blaze rods carried (note 762): back the way it came in, where a way
  // is kept from near here. Every other way is fresh ground, said with what
  // a fall or lava on it costs.
  const walkOut = require('./walk-out'), rods = where === 'nether' ? walkOut.rodsCarried(bot) : 0;
  if (rods) {
    const way = walkOut.backTrail(walkOut.wayInOf(bot, goal), here, p);
    if (way?.cells.length > 1 && !isSetAside(goal, 'way_in', target)) tree.the_way_in = { description: walkOut.wayBackSays(bot, way, walkOut.wayFacts(bot, way)) };
    const fresh = ` Fresh ground, not the way the bot came in: with ${rods} blaze rod${rods === 1 ? '' : 's'} carried, a fall or lava on it loses ${rods === 1 ? 'it' : 'every one'}.`;
    for (const k of ['climb_here', 'around_left', 'around_right', 'floor_way', 'blocks_then_cross', 'dig_across']) if (tree[k]) tree[k].description += fresh;
  }
  if (until) tree.wait_rest = { description: `Other work until the staircase's rest ends in ${minutes} minute${minutes === 1 ? '' : 's'}, then the way to the portal again from wherever the bot is; the work is asked then.`,
    // Not idle: the work is asked then (the stall's until_rest_ends says whether any is on offer, note 698).
    waits: require('./waits').restEnds(bot, { what: 'the staircase\'s rest', until, cause: stairsWhy, idle: false, now }) };
  const triedSays = Object.entries(tried).map(([k, t]) => `${k.replaceAll('_', ' ')}: ended ${t.moved} block${t.moved === 1 ? '' : 's'} from here and no nearer, ${Math.max(1, Math.round((now - t.at) / 1000))} seconds ago${t.why ? ` (${t.why})` : ''}`);
  for (const k of Object.keys(tried)) delete tree[k];
  if (again && tree[again.pick]) tree[again.pick].description += ' Chosen from here before in this rest, and the bot is back here.';
  // Every way from here tried and come to nothing: said, and the way rests
  // (the stall's question answers it), not asked again.
  if (!Object.keys(tree).length) throw new WaysResting(`${says} Every way offered from here was tried in this rest and came to nothing: ${triedSays.join('; ')}.`, Math.max(until, now + PORTAL_WAY_TRIED_MS));
  const decision = await decide('portal_way', { client, bot, task, goal, save, tree, target: p,
    state: { portal: { x: p.x, y: p.y, z: p.z, dimension: where }, distance, ...(Math.round(p.y - here.y) >= 3 ? { portalAbove: Math.round(p.y - here.y) } : {}), walk, staircase: stairsWhy, ...(minutes ? { minutesLeft: minutes } : {}), ...(boat ? { boat } : {}), ...(between ? { between } : {}), ...(where === 'nether' && / over lava/.test(between || '') ? { aTouchOfLava: require('./terrain').lavaTouchSays(bot) } : {}), ...(again ? { chosenFromHereBefore: again.pick } : {}), ...(triedSays.length ? { triedFromHereToNothing: triedSays } : {}), ...(rods ? { rodsOnTheWalk: walkOut.rodsSays(bot) } : {}), health: bot.health, food: bot.food } });
  if (decision.stale) return true;
  const pick = decision.path.at(-1);
  goal.portalWay = { key, until, from, pick, at: now, tried }; save();
  // What the way chosen came to, kept for the next asking from here.
  const start = bot.entity.position.clone(), startOff = Math.hypot(p.x - start.x, p.z - start.z);
  const cameTo = why => {
    const at = bot.entity.position, moved = Math.round(Math.hypot(at.x - start.x, at.y - start.y, at.z - start.z));
    if (moved >= 4 || startOff - Math.hypot(p.x - at.x, p.z - at.z) >= 1) return;
    goal.portalWay.tried = { ...goal.portalWay.tried, [pick]: { at: Date.now(), moved, ...(why ? { why: String(why).slice(0, 120) } : {}) } }; save();
  };
  if (pick === 'wait_rest') throw new WaysResting(`${says} Jev chose other work until then.`, until);
  if (pick === 'portal_here' && where === 'overworld') { setAside(goal, 'portal_passed', { x: p.x, y: p.y, z: p.z }, 'Jev chose a portal made here, this one out of reach', 30 * 60000); save(); return false; }
  if (pick === 'portal_here') {
    try { for (let i = 0; i < 4; i++) { task.check(); if (await portalHere(bot, task, goal, save)) return true; } }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'portal_here', 'nether', err, 600000); save(); }
    return true;
  }
  if (pick === 'boat_again') { attemptsFor(goal).clear('boat', 'crossing'); delete goal.boatTravel.declinedArea; delete goal.boatTravel.declinedUntil; save(); return true; }
  if (pick === 'climb_here') {
    const site = climb.site;
    if (site.distanceTo(bot.entity.position.floored()) >= 1) {
      try { await navigate(bot, task, new goals.GoalBlock(site.x, site.y, site.z), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (site.distanceTo(bot.entity.position.floored()) < 1.5) await pillarUp(bot, task, target.y, { dig });
    cameTo(site.distanceTo(bot.entity.position.floored()) >= 1.5 ? 'the walk to the column did not get there' : null);
    return true;
  }
  if (pick === 'blocks_then_cross') {
    await gatherBlocks(bot, task, goal, save);
    const crossed = await nt.crossToward(bot, task, goal, save, target, { what: 'the portal back' });
    cameTo(crossed.tried ? goal.lastCrossError : 'no crossing to make after the gather');
    return true;
  }
  if (pick === 'dig_across') {
    const crossed = await nt.crossToward(bot, task, goal, save, target, { what: 'the portal back' });
    cameTo(crossed.tried ? goal.lastCrossError : crossed.madeAlready || 'no crossing to make');
    return true;
  }
  if (pick === 'pickaxe_first') {
    goal.portalPickaxeChosen = { at: now }; save();
    await pickaxeForStair(bot, task, goal, save, target, `portal_${where}`, pickaxeWanted.item);
    return true;
  }
  if (pick === 'the_way_in') {
    attemptsFor(goal).clear('way_in', target);
    const went = await walkOut.walkBack(bot, task, goal, p, navigate);
    if (went.tried && !went.ok) { setAside(goal, 'way_in', target, `the way back along it stopped: ${went.why}`, 120000); save(); }
    cameTo(went.ok ? null : went.why || 'no way kept from here');
    return true;
  }
  if (pick === 'floor_way') {
    const went = await nt.walkFloorToward(bot, task, goal, save, target, down, navigate);
    // Down and nearer is ground made, whatever the four-block measure says.
    if (!went.lower && !went.nearer) cameTo(went.why);
    return true;
  }
  const leg = await sideLeg(bot, task, p, pick === 'around_left' ? 'left' : 'right');
  cameTo(leg.why);
  return true;
}
// How long pickaxe_first, chosen, is carried out before the ways are asked again.
const PORTAL_PICKAXE_HOLD_MS = 10 * 60000;
// How long a way from a place that came to nothing is left out from there.
const PORTAL_WAY_TRIED_MS = 5 * 60000;

// The crossing straight at `target` at this height, as far as a stretch
// goes, when the blocks carried stop it short and more can be mined here:
// what it needs, what is carried, and the crossing with the reserve mined.
// Null where it would not stop for blocks, rests from here, or cannot be
// mined for (no pickaxe, the gather resting).
function blocksShortSays(bot, goal, target) {
  const nt = require('./nether-travel'), bridging = require('./bridging');
  const { BLOCK_RESERVE } = require('./inventory-tidy');
  if (typeof bot.blockAt !== 'function' || pickaxeTier(bot) < 1 || isSetAside(goal, 'block_reserve', 'gather') || nt.crossingResting(bot, goal, target)) return null;
  const carried = bridging.blocksCarried(bot);
  let all = null, mined = null;
  try {
    all = bridging.surveyCrossing(bot, target, { cells: nt.CROSS_STRETCH, blocks: 999 });
    mined = bridging.surveyCrossing(bot, target, { cells: nt.CROSS_STRETCH, blocks: Math.max(carried, BLOCK_RESERVE) });
  } catch (_) { return null; }
  if (!all.cells || all.gain < 1 || all.bridge <= carried || mined.gain < 1) return null;
  return { says: `Mine netherrack for blocks first (${carried} carried; the crossing straight at the portal lays ${all.bridge} in its next ${all.cells} blocks), up to ${Math.max(carried, BLOCK_RESERVE)}, a moment a block with the pickaxe from the rock at hand; then the crossing with them. ${nt.crossingSays(mined, 'the portal')}` };
}

// Up to a portal overhead and far across, by a pillar where the bot stands:
// jump and lay a block under the feet, from a column with no lava or water
// in or beside it, the portal's height made up here and the way across
// asked from the top. The staircase steps on ground and digs rock; from a
// span over the lava sea it has neither (mid-208-k-nether-3, "no floor 6",
// note 556). Within sixteen across the pillar is the staircase's own first
// try (tunnelToward). Null where no column or no block to lay.
function climbSays(bot, target) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const here = bot.entity.position, up = Math.round(target.y - Math.floor(here.y));
  if (up < 3) return null;
  const { SCAFFOLD } = require('./pillar-recovery');
  const scaffold = bot.inventory?.items?.().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) || 0;
  if (!scaffold) return null;
  let site = null; try { site = pillarSite(bot, target.y, null, { radius: 5 }); } catch (_) { /* nothing loaded to look in */ }
  if (!site) return null;
  const rise = Math.round(target.y - site.y), walk = Math.round(site.offset(0.5, 0, 0.5).distanceTo(here));
  const across = Math.round(Math.hypot(target.x - site.x, target.z - site.z));
  const edge = require('./terrain').dropNear(bot, site, 1);
  const fall = rise + (edge?.fallBlocks || 0);
  const push = edge?.into === 'lava' ? `a fall of ${fall} blocks into lava` : `a fall of up to ${fall} blocks, about ${Math.max(0, fall - 3)} health`;
  return { site, says: `Pillar straight up ${rise} blocks to the portal's height (jump and lay a block under the feet, ${scaffold} carried that can be laid${scaffold < rise ? `: they run out ${scaffold} up` : `, ${scaffold - rise} left after`}), from ${walk ? `a column ${walk} blocks from here` : 'where the bot stands'}, with no lava or water in or beside it; the portal is then ${across} blocks across at that height, and the way on is asked again from the top (a crossing at that height lays a block for each cell of open air). On top a push is ${push}.` };
}

// Thirty-two blocks of the way by the pathfinder, which bridges and climbs
// where a staircase can only dig. A leg that worked is a new nearest
// approach to the portal, as for every walk: legs that each went some way
// and came back never came nearer (note 252's landmark walks, 2026-09-26).
async function portalLeg(bot, task, goal, p) {
  const here = bot.entity.position, flat = at => Math.hypot(p.x - at.x, p.z - at.z), before = flat(here);
  portalApproach(goal, p, here);
  const step = Math.min(32, before - 8) / before;
  const leg = { x: here.x + (p.x - here.x) * step, z: here.z + (p.z - here.z) * step };
  // Not a leg down a cave under the portal: it ends no farther from the
  // portal's height than it began (exploration.js legGoal, note 753).
  try { await navigate(bot, task, require('./exploration').legGoal(leg.x, leg.z, 4, p.y, here.y), { timeoutMs: 30000, stallMs: 8000, sprint: true }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  return portalApproach(goal, p, bot.entity.position);
}
// The nearest the bot has come to a portal it is making for, kept per
// portal; whether `at` is a new nearest by more than a block.
// The nearest yet, as portalApproach keeps it (undefined before a first look).
function approachBest(goal, p) {
  return goal.portalApproach?.[`${p.x},${p.y},${p.z}`]?.best;
}
function portalApproach(goal, p, at) {
  const key = `${p.x},${p.y},${p.z}`;
  const all = goal.portalApproach ||= {};
  for (const k of Object.keys(all)) if (k !== key) delete all[k];
  const record = all[key] ||= {};
  return require('./nether-travel').nearer(record, Math.hypot(p.x - at.x, p.z - at.z));
}

// A portal of its own where the bot stands in the Nether, when the way back
// to the one it came through is lost: the frame, from carried obsidian, lit
// with a carried lighter (nether-travel.js portal_here). mid-211-c was 250
// blocks from its portal with no way back, and never offered it (note 241).
const cornerlessFrame = o => [
  ...[1, 2].flatMap(x => [o.offset(x, 0, 0), o.offset(x, 4, 0)]),
  ...[1, 2, 3].flatMap(y => [o.offset(0, y, 0), o.offset(3, y, 0)]),
].sort((a, b) => a.y - b.y).map(p => ({ ...p }));
async function portalHere(bot, task, goal, save) {
  if (!goal.netherPortalFrame) {
    const site = selectPortalSite(bot);
    if (!site) throw new Blocked('No clear, level ground for a portal frame within reach');
    const o = pos(site);
    goal.netherPortalFrame = { origin: { ...o }, blocks: cornerlessFrame(o) }; save();
  }
  goal.step = { action: 'portal_here', origin: { ...goal.netherPortalFrame.origin } }; save();
  if (!await buildPortalFrame(bot, task, goal, save, goal.netherPortalFrame)) return false;
  delete goal.netherPortalFrame; save();
  return true;
}

// The pickaxe a staircase toward `target` wants first, or null: none carried,
// and the stair not short enough to dig by hand (tunnelToward). `gather` is
// whether it must be got from outside the pockets (wood gathered), which in
// the Nether is the gathering's own search.
function stairPickaxeWanted(bot, goal, target) {
  if (pickaxeTier(bot) >= 1 || bot.game?.gameMode === 'creative') return null;
  const tunneling = require('./tunneling');
  let made = null; try { const p = require('./mob-hunt').pickaxeFirst(bot); made = p.none ? null : p.item; } catch (_) { made = null; }
  if (!made && Math.hypot(target.x - bot.entity.position.x, target.z - bot.entity.position.z) <= tunneling.STAIR_ACROSS && tunneling.stairFromHere(bot, goal, target)?.gains) return null;
  return { item: made || 'stone_pickaxe', gather: !made };
}
async function pickaxeForStair(bot, task, goal, save, target, key, item) {
  const before = bot._wantedFor;
  bot._wantedFor = { item, what: /^portal_/.test(key) ? 'the stair to the portal' : `the stair to the ${String(key).replaceAll('_', ' ')}`, target: { x: target.x, y: target.y, z: target.z } };
  const have = bot.inventory.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
  try { await acquireStep(bot, task, item, have + 1, goal, save); } finally { bot._wantedFor = before; }
}

// A staircase needs a pickaxe; the planner offers no stone stair without
// one. The bot stood by its broken pickaxe with eight logs and a stack of
// cobblestone, so make the tool first.
async function tunnelToward(bot, task, goal, save, target, key) {
  // No pickaxe: the stair digs its rock by hand (the game's times, no
  // drops: netherrack 2 seconds a block, basalt 6.25), and the pickaxe
  // is made only where no step from here gains without one. 25591 stood 10
  // blocks above its portal in netherrack and went for wood for a pickaxe
  // it did not need, the trip back never made (note 678). A short stair,
  // the target within STAIR_ACROSS blocks as the pillar's is: farther, the
  // pickaxe first (a stair of a hundred and fifty blocks by hand is twenty
  // minutes' digging; with a wooden pickaxe, three). Getting that pickaxe
  // means gathering wood, and with none carried that is the Nether's own
  // gathering, a search of its own that can run long or fail outright
  // (noPath): worth it for a stair that long, not for one a couple of
  // dozen blocks by hand would finish in under a minute. 25583 (mid-242-mh,
  // note 716) had its chosen return_for_blocks turned into a stem hunt this
  // way, its portal only 22 blocks off, twelve times in twenty-five
  // minutes, and never took a step toward it; STAIR_ACROSS (tunneling.js)
  // was widened past that to cover it. What the pickaxe is wanted for is
  // kept while it is got (wantedFor), so a question asked on the way does
  // not offer the very trip that wants it.
  const tunneling = require('./tunneling');
  // A pickaxe the pockets make is made first, a few seconds, and the rock
  // then drops and is dug in a fraction of the time (note 705: every rock
  // now digs by hand, slowly, so the stair by hand is not a reason to skip it).
  const wanted = stairPickaxeWanted(bot, goal, target);
  if (wanted) { await pickaxeForStair(bot, task, goal, save, target, key, wanted.item); return; }
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

// How the portal comes to be: one plan, Jev's to choose (portal_plan,
// src/portal-plan.js, note 782). Each option is a whole route: where the
// frame stands (the frame begun, a frame here, one beside the lava, or a new
// site), the lava it is cast from (a pool known, the lava in sight, the lava
// layer) and how it is got there (walked, or a staircase dug), the buckets
// (carried, or more made first where that shortens the route), and the
// water; priced end to end at the record's paces, with the pickaxe's digging
// and each route's failures said. A frame of obsidian and the ruined
// portals remembered are routes too. Held once chosen, and asked again only
// when a named fact changes (portal-plan.js planDue): the route failed, lava
// found nearer, the frame lost obsidian, buckets lost, a death, or its own
// stated minutes worked through. Before it the way was portal_method,
// re-asked every twenty working minutes and at seven kinds of trouble, with
// lava_way, the stall's portal detours and the fetch's own pick of lava
// beside it (note 782: 895 portal asks and 432 plan changes on 172 portal
// rungs, 199 of them the fetch's own).
// The lava known from a place, for the plan's facts: pools remembered and
// not spent, and lava in sight about here.
function lavaKnownFrom(bot, goal, from, sources = lavaSources(bot)) {
  const here = new Vec3(from.x, from.y, from.z), dim = String(bot.game?.dimension || 'overworld');
  const { poolSpent } = require('./obsidian');
  const pools = (goal.landmarks || []).filter(l => l.kind === 'lava_pool' && l.dimension === dim && !poolSpent(l))
    .map(l => ({ at: { x: l.x, y: l.y ?? here.y, z: l.z }, how: 'pool' }));
  const seen = (sources.scoopable.length ? sources.scoopable : sources.surface).map(p => ({ at: { x: p.x, y: p.y, z: p.z }, how: 'in sight' }));
  // Lava in sight within sixteen blocks of a pool known is that pool's.
  const own = seen.filter(s => !pools.some(p => Math.hypot(p.at.x - s.at.x, p.at.z - s.at.z) <= 16));
  return [...pools, ...own].map(l => ({ ...l, distance: Math.round(Math.hypot(l.at.x - here.x, l.at.y - here.y, l.at.z - here.z)) }));
}
// The plan's lava, its distance from a place now: a pool's or the lava in
// sight's own block; the lava layer's depth below it.
function planLavaDistance(m, from) {
  if (!m?.lava) return null;
  if (m.lava.way === 'deep') return Math.max(0, Math.round(from.y - require('./obsidian').LAVA_DEPTH));
  return m.lava.at ? Math.round(Math.hypot(m.lava.at.x - from.x, m.lava.at.y - from.y, m.lava.at.z - from.z)) : null;
}
// The named facts read now (portal-plan.js planDue), from the frame begun
// or, none begun, where the bot stands.
function planDueNow(bot, goal, sources = lavaSources(bot)) {
  const PP = require('./portal-plan');
  const frame = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
  const from = frame ? frame.origin : bot.entity.position;
  const facts = goal.portalMethod?.facts;
  // Lava more than sixteen blocks from every lava the plan knew of.
  const lavaNow = facts ? lavaKnownFrom(bot, goal, from, sources).filter(l => !(facts.lavaKnown || []).some(k => Math.hypot(k.x - l.at.x, k.z - l.at.z) <= 16 && Math.abs(k.y - l.at.y) <= 16)) : [];
  return PP.planDue(bot, goal, { lavaNow, standing: frame ? PP.standingOf(bot, frame) : null, planDistance: planLavaDistance(goal.portalMethod, from) });
}
// The frame that cannot be got back to, as the fact every way is weighed
// with: where, how far, and what each way ended in.
function frameFailedSays(f) {
  const minutes = Math.max(1, Math.ceil((f.until - Date.now()) / 60000));
  return ` The frame at (${f.at.x}, ${f.at.y}, ${f.at.z}) is ${f.distance} blocks off and cannot be got back to: the walk there failed (${f.walk})${f.legs ? `, ${f.legs}` : ''}, and the staircase toward it is set aside (${f.stairs}), taken up again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
// A site failure's kind: its words before the first colon, the places and
// counts taken out ("Nowhere to stand to pour into the frame slot", "The
// water went somewhere other than"), what a hold at a failure is read
// against (note 767).
const failureKind = why => String(why || '').split(':')[0].replace(/\s*\(-?\d+, -?\d+, -?\d+\)/g, '').replace(/\s+at$/, '').replace(/\d+/g, 'N').trim();
// The frame failing where it stands, as the fact every way is weighed with:
// what is cast, the failures since the last block went in and why, and the
// ones a mob in the way caused, which are not the site's (note 527).
function siteFailedSays(frame, placed) {
  const f = frame.siteFailed || { n: 0, whys: {} };
  const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
  const whys = Object.entries(f.whys || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, n]) => `"${why}" ${times(n)}`).join(', ');
  const body = frame.bodyFailures?.n ? ` Not counted: ${frame.bodyFailures.n} more where a mob stood in the cells the cast works in (the last a ${String(frame.bodyFailures.name).replaceAll('_', ' ')} at (${frame.bodyFailures.at.x}, ${frame.bodyFailures.at.y}, ${frame.bodyFailures.at.z})); a mob moves on or is fought, and the cell is free again.` : '';
  return ` The frame at (${frame.origin.x}, ${frame.origin.y}, ${frame.origin.z}), ${placed} of ten cast, has failed at its site ${times(f.n)} since the last block went in: ${whys || 'reasons not kept'}.${body}`;
}
const diamondPickaxeCarried = bot => bot.inventory.items().some(i => /^(diamond|netherite)_pickaxe$/.test(i.name));
// A ruin's key is the number it was given when first offered (keys.js, note
// 749), not its place in the list of ruins remembered.
const ruinKey = (goal, k) => `ruin_${require('./decisions/keys').id(goal, 'ruin', k.landmark, { near: 8 })}`;
const ruinOf = (key, ruins, goal) => ruins.find(k => ruinKey(goal, k) === key) || null;
// A ruined portal as an option, with what finishing it takes. The missing
// blocks are obsidian too, said as such: mid-218-a chose a ruin with three
// of ten standing, told they were "placed like any block", and spent its
// three hours making the seven from lava with a diamond pickaxe it had to
// make first (2026-09-26).
function ruinSays(k, { obsidian, diamonds, diamondPickaxe }) {
  const seen = Number.isFinite(k.landmark.obsidian) ? k.landmark.obsidian : null;
  const missing = seen === null ? null : Math.max(0, 10 - seen);
  const short = missing === null ? null : Math.max(0, missing - obsidian);
  const need = missing === null ? `the missing blocks are obsidian (${obsidian} carried)`
    : `${missing} of the frame's ten are missing and are obsidian, placed like any block: ${obsidian} carried${short ? `, ${short} short; those are made by pouring water on lava and mined with a diamond pickaxe (${diamondPickaxe ? 'one carried' : `none carried; three diamonds make one, ${diamonds} carried`}), unless the ruin's chest holds them` : ', enough'}`;
  return `Finish the ruined portal ${k.distance} blocks away and light it: its frame is part standing (${seen ?? 'some'} obsidian seen there when it was found); ${need}. Crying obsidian or obsidian where the frame or its inside must be clear needs a diamond pickaxe to take out. Its chest often holds obsidian, flint and steel or a fire charge. About ${Math.round(k.distance / 4.3)} seconds' walk.`;
}
// A frame of its own from ten obsidian: the diamond route, said as the
// steps it is. It had said "about ten seconds a block once at a lava pool"
// and "three diamonds make one", and nothing of where diamonds lie.
// With the lava known, the trip it takes, beside the cast's: the obsidian
// is made at the lava and carried to the frame all at once, where the cast
// fetches a bucket a block. mid-244-v stood at its lava with three diamonds,
// its frame 122 blocks up, and was offered this with no trip or time said;
// it took 0.03 against the cast's hundred minutes of bucket trips (note 470).
function buildSays({ obsidian, diamonds, diamondPickaxe, need = 10, trip = null, atLava = false, frameBegun = false, castTrips = null }) {
  const where = frameBegun ? 'the frame' : 'a frame here';
  const oneWay = trip && Math.round(trip.distance / 4.3) + trip.climb;
  const making = duration(Math.max(60, need * 10));
  const carry = !trip || !need ? '' : trip.distance <= 16 ? ` The nearest known lava is ${trip.distance} blocks from ${where}: the obsidian is made beside it, about ${making} for the ${need} wanted, and put in the frame with no trip.`
    : ` Made at the nearest known lava, ${trip.distance} blocks from ${where}, the ${need} obsidian wanted are about ${making} of pouring and mining there, all carried to the frame at once: ${atLava ? `the bot is beside that lava now, so one way to ${where}, about ${duration(oneWay)}${trip.climb ? ` with a staircase of about ${duration(trip.climb)}` : ''}` : `one trip, ${fetchSays(trip)}`}.${castTrips ? ` The cast fetches a bucket a block: ${castTrips} trip${castTrips === 1 ? '' : 's'} of the same, about ${tripsCost(trip, castTrips)}.` : ''}`;
  return `Build a portal frame of its own: ten obsidian (${obsidian} carried), lit with flint and steel. Obsidian is where water has met a lava source, at a lava pool or poured there, and is mined with a diamond pickaxe only (${diamondPickaxe ? 'one carried' : `none carried: three diamonds make one, ${diamonds} carried, and diamond ore is mined with an iron pickaxe or better`}), about ten seconds a block.${carry}`;
}
// What every way is weighed with, said with each of them alike: only the
// cast was told where the lava was, and only the ruins how far they lay.
// The portal's cast waiting for a bucket of water, said where the ladder is
// asked about the work standing still (the stall's question, the rung's, the
// detours' travel): the state said nothing of what the rung lacked, and a
// river seventy-two blocks off was offered as "walk to the river and carry
// on" and chosen 0.02 (mid-243-bd, note 630). Null unless the cast is what
// the rung is on and its next block cannot be poured for want of water.
function castWaterWait(bot, goal) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  if ((goal.rungTime?.phase || goal.gameProgress?.phase) !== 'reach_nether') return null;
  const frame = goal.portalFrame;
  const casting = frame ? !!frame.cast : goal.portalMethod?.kind === 'cast';
  if (!casting || countOf(bot, 'obsidian') || countOf(bot, 'water_bucket')) return null;
  if (frame && (frame.castWater || frame.castWaterLeft?.length || frame.blocks.every(p => bot.blockAt(pos(p))?.name === 'obsidian'))) return null;
  const buckets = countOf(bot, 'bucket'), lava = countOf(bot, 'lava_bucket');
  return `The portal frame is being cast from lava and water, and its next block cannot be poured: no water bucket is carried (${buckets ? `${buckets} empty bucket${buckets === 1 ? '' : 's'} carried, filled at any water` : 'no empty bucket either: one is three iron ingots'}; ${lava} of lava carried). Water: ${waterKnown(bot).says}.`;
}
function portalFacts(bot, goal, ruins, lava = nearestLava(bot, goal)) {
  const depth = require('./strategy').oreFacts(bot, goal, [{ action: 'mine', item: 'diamond_ore' }]).trim();
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Every way but a finished ruin pours water on lava, and none is carried
  // more often than not by the time it is asked: where water is known is said
  // (note 630: a river seventy-two blocks off was in the state and never in
  // the way's words).
  const water = countOf(bot, 'water_bucket') ? '' : ` Water, for a bucket of it: ${waterKnown(bot).says}.`;
  return ` Known for every way: ${lava ? `the nearest known lava is ${lava.distance} blocks away (${lava.how}), about ${(s => s < 90 ? `${s} seconds'` : `${Math.round(s / 60)} minutes'`)(require('./levels').walkSeconds(lava.distance))} walk at the bot's measured pace` : 'no lava is known nearby'}.${water} ${depth} Diamond ore needs an iron pickaxe or better (${pickaxeTier(bot) >= 3 ? 'one carried' : 'none carried'}); a diamond pickaxe is three diamonds (${diamondPickaxeCarried(bot) ? 'one carried' : `${countOf(bot, 'diamond')} diamonds carried`}). ` +
    `Carried: ${countOf(bot, 'obsidian')} obsidian, ${plural(countOf(bot, 'bucket'), 'empty bucket')}, ${countOf(bot, 'water_bucket')} of water and ${countOf(bot, 'lava_bucket')} of lava, ${countOf(bot, 'iron_ingot')} iron ingots (three make a bucket). ` +
    // Each lava bucket takes a slot of its own, where empty ones stack:
    // mid-244-v filled nine with every slot full and kept one (note 470).
    (Number.isInteger(bot.inventory.emptySlotCount?.()) ? `${plural(bot.inventory.emptySlotCount(), 'inventory slot')} free: each lava bucket takes a slot of its own, where empty buckets stack, and room is made before filling. ` : '') +
    `${ruins.length ? `Ruined portals remembered: ${ruins.map(k => `${k.distance} blocks away`).join(', ')}.` : 'No ruined portal is remembered within 512 blocks.'}`;
}
// The way held, asked again: how long it has had and what that made.
function methodSoFar(bot, goal, method, ruin) {
  const from = method.from || {};
  const placed = goal.portalFrame ? goal.portalFrame.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length : 0;
  const madePick = from.diamondPickaxe === false && diamondPickaxeCarried(bot);
  const walk = ruin && Number.isFinite(from.distance) ? `, the ruin ${from.distance} blocks away then and ${ruin.distance} now` : '';
  // The pace so far, said beside the estimate: mid-207-i's frame was said
  // to be eleven minutes of trips from done after sixty-one minutes had
  // made three blocks, and it was kept each time (2026-09-27).
  const minutes = Math.round((method.activeMs || 0) / 60000);
  const gained = Math.max(0, placed - (from.placed || 0)) + Math.max(0, countOf(bot, 'obsidian') - (from.obsidian || 0));
  const left = Math.max(0, 10 - placed - countOf(bot, 'obsidian'));
  const went = Object.entries(method.byStep || {}).filter(([, ms]) => ms >= 60000).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, ms]) => `${k} ${Math.round(ms / 60000)}`).join(', ');
  const pace = minutes < 10 || ruin || !left ? '' : (went ? ` Its minutes went to: ${went}.` : '') + (gained
    ? ` At the pace so far, ${gained} obsidian in ${minutes} minutes (about ${Math.round(minutes / gained)} a block), the ${left} still to come would take about ${Math.round(minutes / gained * left)} minutes more.`
    : ` No obsidian has come of it in ${minutes} minutes.`);
  return ` This is the way chosen, worked on for ${minutes} minutes so far. Since it was chosen: obsidian carried ${from.obsidian ?? 0} to ${countOf(bot, 'obsidian')}, ${goal.portalFrame ? `${placed} of the frame's ten standing` : 'no frame begun'}, diamonds carried ${from.diamonds ?? 0} to ${countOf(bot, 'diamond')}${madePick ? ', a diamond pickaxe made' : ''}${walk}.${pace} Kept, it is asked again when a named fact changes or its stated ${method.minutes ? `${method.minutes} ` : ''}minutes are worked through.`;
}

// The plan's routes, built and priced (portal_plan, note 782). Each cast
// route is a frame site and a lava: the site the frame begun (or, none
// begun, near where the bot stands: `here`), beside the lava, or a new site
// near here with the frame begun left (`new_site`, offered when the frame
// fails at its site or cannot be got back to); the lava a pool known (the
// two whose route here is shortest, and the plan's own), the lava in sight
// about the frame, or the lava layer below.
function planRoutes(bot, goal, { method, frame, placed, sources, here, ingots, raw }) {
  const PP = require('./portal-plan'), L = require('./levels');
  const { LAVA_DEPTH, wayCosts, poolSpent, lavaRecord } = require('./obsidian');
  const T = require('./tunneling');
  const dim = String(bot.game?.dimension || 'overworld');
  const frameAt = frame ? pos(frame.origin) : here.floored();
  const d3 = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  const walkTo = (a, b) => { const dy = b.y - a.y; return L.walkSeconds(Math.hypot(b.x - a.x, b.z - a.z)) + (Math.abs(dy) > 8 ? (dy > 0 ? L.upSeconds(Math.abs(dy)) : L.downSeconds(Math.abs(dy))) : 0); };
  const buckets = countOf(bot, 'bucket'), lavaBuckets = countOf(bot, 'lava_bucket'), obsidian = countOf(bot, 'obsidian');
  const owedHere = castTrips({ obsidian, standing: placed, buckets, lavaBuckets }), owedNew = castTrips({ obsidian, standing: 0, buckets, lavaBuckets });
  // The lava: pools remembered, not spent and their way into them not
  // resting (those are said in the state with their records); the lava in
  // sight that is not a pool's; the lava layer by the first heading down
  // open from here.
  const allPools = (goal.landmarks || []).filter(l => l.kind === 'lava_pool' && l.dimension === dim && l.y !== undefined);
  const ids = require('./decisions/keys').ids(goal, 'lava_pool', allPools.map(l => ({ x: l.x, y: l.y, z: l.z })), { near: 8 });
  const keyOf = l => `pool_${ids[allPools.indexOf(l)]}`;
  const open = l => !poolSpent(l) && !T.lavaResting(goal, new Vec3(l.x, l.y, l.z));
  const walkFailed = l => isSetAside(goal, 'landmark_trip', `lava_pool:${l.x},${l.z}`) || !!l.lastWalk?.timedOut;
  // The plan's own pool stays on offer while its way rests, its rest said
  // in its record, so that it can be kept (note 488).
  const heldPool = l => method?.lava?.way === 'pool' && method.lava.at && PP.sameLava(method.lava.at, l);
  const lavas = allPools.filter(l => open(l) || (heldPool(l) && !poolSpent(l))).filter(l => d3(frameAt, l) <= 512 || heldPool(l)).map(l => ({ key: keyOf(l), kind: 'pool', at: new Vec3(l.x, l.y, l.z), l, how: walkFailed(l) ? 'dig' : 'walk' }));
  const served = sources.scoopable.length ? sources.scoopable : sources.surface;
  const seen = served.filter(p => !allPools.some(l => Math.hypot(l.x - p.x, l.z - p.z) <= 16)).sort((a, b) => a.distanceTo(frameAt) - b.distanceTo(frameAt))[0];
  if (seen) lavas.push({ key: 'sight', kind: 'sight', at: seen.clone(), how: 'walk' });
  const headings = T.descentTargets(here.floored(), LAVA_DEPTH);
  const headingResting = p => T.staircaseResting(goal, p) || isSetAside(goal, 'staircase_from', T.landingKey(here.floored(), p));
  const deep = headings.find(p => !headingResting(p)), deepResting = headings.filter(headingResting).length;
  // The lava layer from the frame begun: the same heading, under the frame.
  const h0 = here.floored();
  if (deep) lavas.push({ key: 'deep', kind: 'deep', at: deep.clone(), how: 'dig', fromFrame: new Vec3(frameAt.x + deep.x - h0.x, deep.y, frameAt.z + deep.z - h0.z) });
  const heldAt = method?.lava?.at ? method.lava.at : null;
  const isHeld = v => method?.lava && (method.lava.way === 'deep' ? v.kind === 'deep' : v.kind !== 'deep' && heldAt && PP.sameLava(heldAt, v.at));
  // A route's lava, priced from a frame site: getting the first lava there
  // and each trip after.
  const fromSite = (v, site, atFrame = false) => {
    const at = v.kind === 'deep' && atFrame ? v.fromFrame : v.at;
    if (v.how === 'dig') { const c = wayCosts(site, at, site); return { first: c.there, trip: c.trip, digs: c.digs }; }
    const t = fetchTrip(site, { at, distance: d3(site, at) }, isHeld(v) && method?.kind === 'cast' && !method.near ? method : null);
    return { first: 0, trip: t.seconds, digs: 0, measured: t.made ? t : null };
  };
  const reachLava = v => v.how === 'dig' ? { seconds: wayCosts(here, v.at, null).there, digs: wayCosts(here, v.at, null).digs } : { seconds: walkTo(here, v.at), digs: 0 };
  const routes = {};
  const add = (key, site, v, price, extra = {}) => { routes[key] = { key, site, lava: v, price, ...extra }; };
  for (const v of lavas) {
    // Here: the frame begun, or a frame near where the bot stands.
    const s = fromSite(v, frameAt, !!frame);
    const toFrame = frame && here.distanceTo(frameAt) > 16 ? walkTo(here, frameAt) : 0;
    add(`here_${v.key}`, 'here', v, PP.priceCast({ reach: toFrame + s.first, trip: s.trip, cast: owedHere.cast, toFetch: owedHere.toFetch, carriers: owedHere.carriers, ingots, raw }), { digs: s.digs, measured: s.measured });
    // Beside the lava: a frame cast within a few blocks of it.
    if (d3(frameAt, v.at) > 16 || (v.kind === 'deep' && frameAt.y - LAVA_DEPTH > 16) || method?.key === `beside_${v.key}`) {
      const r = reachLava(v);
      add(`beside_${v.key}`, 'beside', v, PP.priceCast({ reach: r.seconds, trip: PP.CAST_RECORD.scoopSeconds + L.walkSeconds(2 * PP.BESIDE_BLOCKS), cast: owedNew.cast, toFetch: owedNew.toFetch, carriers: owedNew.carriers, ingots, raw }), { digs: r.digs });
    }
    // A new site near here, the frame begun left: where it fails at its
    // site or cannot be got back to.
    if (frame && (method?.siteFailed || method?.frameFailed)) {
      const n = fromSite(v, here.floored());
      add(`new_site_${v.key}`, 'new_site', v, PP.priceCast({ reach: n.first, trip: n.trip, cast: owedNew.cast, toFetch: owedNew.toFetch, carriers: owedNew.carriers, ingots, raw }), { digs: n.digs });
    }
  }
  // Two pools a site, the shortest routes, beside the plan's own lava, the
  // lava in sight and the lava layer: a frame cast beside each pool known
  // within 512 blocks is not a route worth the asking.
  const bySite = {};
  for (const r of Object.values(routes)) (bySite[r.site] ||= []).push(r);
  const keep = new Set();
  for (const list of Object.values(bySite)) {
    list.filter(r => r.lava.kind !== 'pool' || isHeld(r.lava)).forEach(r => keep.add(r.key));
    list.filter(r => r.lava.kind === 'pool' && !isHeld(r.lava)).sort((a, b) => (a.price.seconds ?? Infinity) - (b.price.seconds ?? Infinity)).slice(0, 2).forEach(r => keep.add(r.key));
  }
  for (const k of Object.keys(routes)) if (!keep.has(k)) delete routes[k];
  // What is known of each lava that a route cannot go to: spent, or the way
  // into it resting, with their records (note 767b: a pool is a fact).
  const notOffered = allPools.filter(l => !lavas.some(v => v.l === l) && !open(l)).map(l => ({ l, d: d3(frameAt, l) })).filter(x => x.d <= 256).sort((a, b) => a.d - b.d).slice(0, 4)
    .map(({ l, d }) => `(${l.x}, ${l.y}, ${l.z}), ${d} blocks ${frame ? 'from the frame' : 'off'}:${lavaRecord(goal, l, here).replace(/^ Its record:/, '')}`);
  return { routes, notOffered, deepResting, headings: headings.length, frameAt, owedHere, owedNew };
}
// A cast route in words: the site, the lava and how it is got there, the
// buckets, the water, the price end to end, the digging and the risk, and
// its record.
function routeSays(bot, goal, r, { frame, placed, frameAt, here, diamondPickaxe, water, deepResting, headings, newSiteSays = '' }) {
  const PP = require('./portal-plan');
  const { lavaRecord, LAVA_DEPTH } = require('./obsidian');
  const v = r.lava, at = v.at, o = frame?.origin;
  const dy = Math.round(at.y - here.y), height = dy <= -4 ? `, ${-dy} blocks below here` : dy >= 4 ? `, ${dy} blocks above here` : '';
  const fromFrame = Math.round(Math.hypot(at.x - frameAt.x, at.y - frameAt.y, at.z - frameAt.z));
  const outOnly = `its obsidian out only with a diamond pickaxe (${diamondPickaxe ? 'one carried' : 'none carried'})`;
  const site = r.site === 'here' ? (frame ? `The frame begun at (${o.x}, ${o.y}, ${o.z}), ${placed} of ten cast, finished where it stands` : 'A frame cast near where the bot stands')
    : r.site === 'beside' ? `A frame cast beside the lava, within a few blocks of it${frame ? `; the frame begun at (${o.x}, ${o.y}, ${o.z}), ${placed} of ten cast, left as it stands${placed ? `, ${outOnly}` : ''}` : ''}. The portal is then down there, and the way back from the Nether comes out beside it`
    : `A new frame at another site near here; the frame begun at (${o.x}, ${o.y}, ${o.z}), ${placed} of ten cast, left as it stands${placed ? `, ${outOnly}, and the ${placed} cast there are ${placed} lava buckets again here` : ''}`;
  const lava = v.kind === 'deep' ? `the lava layer below (the deep lava lakes lie from about y ${LAVA_DEPTH + 2} down, anywhere), by a staircase dug down to y ${at.y}${r.site === 'beside' ? '' : ' and each trip back up it'}`
    : `${v.kind === 'pool' ? 'the lava pool known' : 'the lava in sight'} at (${at.x}, ${at.y}, ${at.z}), ${Math.round(here.distanceTo(at))} blocks off${height}${frame && r.site === 'here' ? `, ${fromFrame} blocks from the frame` : ''}, ${v.how === 'dig' ? 'by a staircase dug to it (its walk did not get there)' : 'walked to'}`;
  const p = r.price;
  const smelt = p.make ? Math.max(0, 3 * p.make - countOf(bot, 'iron_ingot')) : 0;
  const bucketsSay = p.noBucket ? 'none carried and no iron for one' : `${p.buckets - p.make} carried${p.make ? `, ${p.make} more made first from the iron carried (three ingots each${smelt ? `, ${smelt} of the ${countOf(bot, 'raw_iron')} raw iron carried smelted first in a furnace, ${countOf(bot, 'furnace') ? 'one carried' : 'none carried: eight cobblestone make one'}` : ''})` : ''}`;
  const digs = r.digs ? `about ${r.digs} blocks dug with the pickaxe` : 'nothing dug on the way, as far as the walk goes';
  const risk = v.kind === 'deep' ? `the staircase ends at the lava layer, where lava lakes lie open${deepResting ? `; ${deepResting} of the ${headings} headings down from about here are set aside already` : ''}`
    : dy <= -20 ? `the lava ${-dy} blocks down, in the rock` : 'lava at about this height';
  const measured = r.measured ? ` The trips for lava made so far took about ${duration(r.measured.seconds)} each in working time.` : '';
  const record = v.kind === 'pool' ? lavaRecord(goal, v.l, here) : '';
  const failed = PP.failuresSays(goal, { lava: v.kind === 'deep' ? { deep: true } : { x: at.x, y: at.y, z: at.z } });
  const leaving = r.site === 'new_site' ? newSiteSays : '';
  return `${site}; cast from ${lava}. Buckets: ${bucketsSay}. Water: ${water}. ${PP.priceSays(p, { tripWhat: r.site === 'beside' ? 'a scoop and a few blocks\' walk' : 'there and back' })}${measured} Pickaxe: ${digs}. Risk: ${risk}.${record}${failed || (record ? '' : ' No failures known for this route.')}${leaving}`;
}

async function portalMethod(bot, task, goal, save, client = task.opportunityClient) {
  const { fitRuin, adopt } = require('./ruined-portal');
  const { knownLandmarks } = require('./exploration');
  const PP = require('./portal-plan');
  const diamondPickaxe = diamondPickaxeCarried(bot);
  const method = goal.portalMethod;
  const sources = lavaSources(bot);
  const due = planDueNow(bot, goal, sources);
  // Asked for another reason than a site failure, an answer held at one is
  // not what is asked about (note 767). Nor is one given to another frame.
  if (due && method && (!method.siteFailed || !method.siteAnswer)) { require('./decisions/commit').end(bot, 'portal_plan', 'asked again for another reason'); delete method.siteAnswer; }
  if (!due && (method?.kind === 'build' || method?.kind === 'cast')) return true;
  if (!due && method?.kind === 'ruin') {
    if (goal.portalFrame) return true;
    const r = new Vec3(method.at.x, method.at.y ?? bot.entity.position.y, method.at.z);
    if (!bot.blockAt(r) || bot.entity.position.distanceTo(r) > 12) {
      goal.step = { action: 'to_ruined_portal', at: { ...method.at }, distance: Math.round(bot.entity.position.distanceTo(r)) }; save();
      try { await navigate(bot, task, new goals.GoalNear(r.x, r.y, r.z, 6), { timeoutMs: 120000, stallMs: 8000, sprint: true }); }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
        await tunnelToward(bot, task, goal, save, r, 'ruined_portal');
      }
      return false;
    }
    const fit = fitRuin(bot, r, { diamondPickaxe });
    const mark = (goal.landmarks || []).find(l => l.kind === 'ruined_portal' && l.x === method.at.x && l.z === method.at.z);
    if (!fit) { if (mark) mark.noFrame = true; PP.planFailed(goal, `the ruined portal at (${method.at.x}, ${method.at.z}) will not take a frame`); delete goal.portalMethod; save(); return false; }
    goal.portalFrame = adopt(fit); save();
    return true;
  }
  const ruins = knownLandmarks(bot, goal, 'ruined_portal', 512).filter(k => !k.landmark.noFrame).slice(0, 3);
  // The ruin held stays on offer to be kept, however many lie nearer.
  if (method?.kind === 'ruin' && !ruins.some(k => k.landmark.x === method.at.x && k.landmark.z === method.at.z)) {
    const held = knownLandmarks(bot, goal, 'ruined_portal', 4096).find(k => k.landmark.x === method.at.x && k.landmark.z === method.at.z);
    if (held) ruins.push(held);
  }
  const diamonds = countOf(bot, 'diamond'), obsidian = countOf(bot, 'obsidian');
  const here = bot.entity.position;
  const frame = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
  const placed = frame ? frame.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length : 0;
  // The frame that cannot be got back to, and the frame failing at its
  // site: facts every route is weighed with (notes 481, 527).
  const frameFailed = method?.frameFailed && frame ? method.frameFailed : null;
  const siteFailed = method?.siteFailed && frame ? frame : null;
  const lava = nearestLava(bot, goal, sources);
  const ingots = countOf(bot, 'iron_ingot'), raw = countOf(bot, 'raw_iron');
  const water = countOf(bot, 'water_bucket') ? 'one water bucket carried' : `none carried; ${waterKnown(bot).says}`;
  const built = planRoutes(bot, goal, { method, frame, placed, sources, here, ingots, raw });
  const { routes, frameAt } = built;
  // The route held: its key, or a way held from before the plan.
  const current = method?.key && (routes[method.key] || /^(build_new|ruin_\d+)$/.test(method.key)) ? method.key
    : method?.kind === 'build' ? 'build_new' : method?.kind === 'ruin' ? (k => k ? ruinKey(goal, k) : null)(ruins.find(k => k.landmark.x === method.at.x && k.landmark.z === method.at.z)) : null;
  // What leaving the frame costs against retrying it, said on each new
  // site (note 742): the blocks cast, the lava found by the frame, and
  // whether what failed there reads as the site itself.
  let newSiteSays = '';
  if (siteFailed) {
    const fails = siteFailed.siteFailed || { n: 0, whys: {} };
    const [topWhy, topN] = Object.entries(fails.whys || {}).sort((a, b) => b[1] - a[1])[0] || [];
    const transient = /navigation|nowhere to stand|stand to pour/i.test(topWhy || '');
    const byFrame = nearestLava(bot, goal, sources, frameAt);
    newSiteSays = ` Against retrying: ${placed} of ten already cast here${byFrame?.at ? `, its lava already found ${byFrame.distance} blocks off` : ', no lava yet found here either'}.${topWhy ? ` What failed here ${fails.n <= 1 ? 'once' : `${fails.n} times`} was "${topWhy}"${topN > 1 && topN < fails.n ? `, ${topN} of them` : ''}${transient ? ': not the site itself, and a new site meets the same kind of failure no less often' : ''}.` : ''}`;
  }
  const says = { frame, placed, frameAt, here, diamondPickaxe, water, deepResting: built.deepResting, headings: built.headings, newSiteSays };
  const tree = {};
  // The repairs at a frame failing at its site, first: the route held goes
  // on at this frame, the slot it failed at cleared into or poured into
  // from another stand (note 767).
  if (siteFailed) {
    const fails = siteFailed.siteFailed || { n: 0, whys: {} };
    const slotAt = fails.slot && method?.kind !== 'build' ? new Vec3(fails.slot.x, fails.slot.y, fails.slot.z) : null;
    if (slotAt && bot.blockAt(slotAt) && bot.blockAt(slotAt).name !== 'obsidian') {
      const pc = require('./portal-cast'), w = pc.view(bot);
      const where = `(${slotAt.x}, ${slotAt.y}, ${slotAt.z})`;
      const blockers = pc.blockersFor(bot, siteFailed, slotAt, w).slice(0, 4);
      if (blockers.length) tree.clear_blocker = { description: `Repair this site and keep the route: dig out what blocks the line into the frame slot at ${where} from the open cells beside it, ${blockers.map(b => `the ${String(b.name).replaceAll('_', ' ')} at (${b.at.x}, ${b.at.y}, ${b.at.z})`).join(', ')}, then look for a stand again and go on casting here, the ${placed} of ten cast kept. About ${blockers.length * 2} seconds of digging.` };
      const tried = (siteFailed.standsTried?.[`${slotAt.x},${slotAt.y},${slotAt.z}`] || []).map(pos);
      if (tried.length) {
        const pass = [...pc.slotPass(siteFailed, slotAt), ...tried];
        const ways = pc.standWays(bot, siteFailed, slotAt, w, { pass, missed: pc.slotMissed(siteFailed, slotAt) });
        if (ways.stands || ways.make || ways.cut) tree.other_stand = { description: `Repair this site and keep the route: pour into the frame slot at ${where} from another stand than the ${tried.length} tried there (${tried.map(c => `(${c.x}, ${c.y}, ${c.z})`).join(', ')}), those passed over for this slot: with them passed, ${ways.says}. The ${placed} of ten cast kept.` };
      }
    }
  }
  // The cast routes, cheapest first; those whose lava's record says it
  // failed after the ones that go on (note 767f).
  const failing = r => r.lava.kind === 'pool' ? !!require('./obsidian').lavaRecord(goal, r.lava.l, here) || PP.failuresFor(goal, { lava: r.lava.at }).length > 0 : PP.failuresFor(goal, { lava: r.lava.kind === 'deep' ? { deep: true } : r.lava.at }).length > 0;
  const ordered = Object.values(routes).sort((a, b) => (failing(a) - failing(b)) || ((a.price.seconds ?? Infinity) - (b.price.seconds ?? Infinity)));
  for (const r of ordered) tree[r.key] = { description: routeSays(bot, goal, r, says), ...(r.site === 'beside' ? { target: { x: r.lava.at.x, y: r.lava.at.y, z: r.lava.at.z } } : {}) };
  // A frame of its own from obsidian: the diamond route, as the steps it is
  // (note 470), with the trip to the nearest lava where the obsidian is made.
  const trip = fetchTrip(frameAt, frame ? nearestLava(bot, goal, sources, frameAt) || lava : lava, null);
  tree.build_new = { description: buildSays({ obsidian, diamonds, diamondPickaxe, need: Math.max(0, 10 - placed - obsidian), trip, atLava: !!lava && lava.distance <= 16, frameBegun: !!frame, castTrips: castTrips({ obsidian, standing: placed, buckets: countOf(bot, 'bucket'), lavaBuckets: countOf(bot, 'lava_bucket') }).trips }) + PP.failuresSays(goal, { key: 'build_new' }) };
  // Where the walk to a ruin gives out, the staircase toward it: said
  // while it rests (tunneling.js restingSays, note 500).
  const { restingSays } = require('./tunneling');
  ruins.forEach(k => {
    const rest = restingSays(goal, new Vec3(k.landmark.x, k.landmark.y ?? here.y, k.landmark.z), here);
    tree[ruinKey(goal, k)] = { target: { x: k.landmark.x, y: k.landmark.y ?? Math.round(here.y), z: k.landmark.z }, description: ruinSays(k, { obsidian, diamonds, diamondPickaxe }) + (rest ? ` Where the walk gives out, ${rest}.` : '') + PP.failuresSays(goal, { key: ruinKey(goal, k) }) };
  });
  // The lava held over a cave its staircase stopped at: down into it, the
  // route held going on from its floor (note 490).
  const heldRest = method?.near ? nearRest(goal, method.near, here) : null;
  const cave = heldRest ? heldCave(bot, goal, method.near) : null;
  if (cave) {
    const health = Math.round(bot.health ?? 20), damage = cave.into === 'water' ? 0 : Math.max(0, cave.fall - 3);
    const level = cave.standY - method.near.y;
    tree.into_cave = { description: `Keep the route and go down into the cave its staircase met: the stair at (${cave.at.x}, ${cave.at.y}, ${cave.at.z}) is dug open and the bot drops ${cave.fall} blocks to ${cave.into === 'water' ? 'water' : `its floor at y ${cave.floorY}`}, ${damage ? `about ${damage} of the ${health} health lost in the fall` : 'a fall that does no harm'}. Standing there it is ${level > 0 ? `${level} blocks above the lava's level` : level < 0 ? `${-level} blocks below the lava's level` : "level with the lava"}, ${Math.round(Math.hypot(cave.at.x - method.near.x, cave.at.z - method.near.z))} blocks from it across; the staircase toward the lava goes on from the cave floor, its rest lifted.` };
  }
  // The route held, asked again: why, what it has made, and what keeping
  // it means; a frame failing or out of reach said on every route.
  if (current && tree[current]) tree[current].description = `This is the route held.${methodSoFar(bot, goal, method, current.startsWith('ruin_') ? ruinOf(current, ruins, goal) : null)} ` + tree[current].description;
  if (siteFailed) {
    const holdSite = { until: { seconds: 180, throughFailures: true, also: ['a block goes in', 'a failure of another kind comes'] } };
    for (const k of [current, 'clear_blocker', 'other_stand', ...Object.keys(tree).filter(k => /^here_/.test(k))]) if (k && tree[k]) tree[k].commit = holdSite;
  }
  // Kept, the walk to the lava held goes on by staircase until the
  // staircase is set aside (note 505); kept with its staircase resting, every
  // way to it rests until then (note 488).
  if (current && tree[current] && method?.nearFailed) tree[current].description += ` Kept, the walk goes on by staircase until the staircase gains on it or is set aside.`;
  if (current && tree[current] && heldRest) tree[current].description += ` Kept, its staircase rests (${heldRest.why}) for ${heldRest.minutes} minute${heldRest.minutes === 1 ? '' : 's'}: every way to it is said as resting until then, and the minutes go to other work.`;
  if (current && tree[current] && frameFailed) {
    const minutes = Math.max(1, Math.ceil((frameFailed.until - Date.now()) / 60000));
    tree[current].description += ` Kept, the frame is made for again: the walk is tried again${frameFailed.legs ? ' and the legs when their rest ends' : ''}, and the staircase in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  const askedBecause = due && due.kind !== 'none' ? due.why : null;
  const decision = await decide('portal_plan', { client, bot, task, goal, save, tree,
    context: { current, oldOrder: ordered[0]?.key || 'build_new', leaveSite: !!siteFailed && (siteFailed.siteFailures || 0) >= 10 },
    state: { dimension: String(bot.game?.dimension || ''), obsidian, diamonds, diamondPickaxe, flintAndSteel: countOf(bot, 'flint_and_steel'), fireCharges: countOf(bot, 'fire_charge'),
      buckets: countOf(bot, 'bucket'), waterBuckets: countOf(bot, 'water_bucket'), lavaBuckets: countOf(bot, 'lava_bucket'), ironIngots: ingots, rawIron: raw,
      ...(askedBecause ? { askedAgainBecause: askedBecause } : {}),
      ...(current ? { routeHeld: current, minutesOnRoute: Math.round((method.activeMs || 0) / 60000), minutesStated: method.minutes ?? null } : {}),
      ...(frame ? { frame: `(${frame.origin.x}, ${frame.origin.y}, ${frame.origin.z}), ${placed} of ten cast` } : { frame: 'none begun' }),
      ...(frameFailed ? { frameOutOfReach: frameFailedSays(frameFailed).trim() } : {}),
      ...(siteFailed ? { siteFailure: siteFailedSays(siteFailed, placed).trim() } : {}),
      ...(method?.flipped ? { flipped: `${method.flipped.pair.join(' and ')}: ${method.flipped.why}. ${method.flipped.fact || ''}`.trim() } : {}),
      ...(built.notOffered.length ? { lavaNotOffered: built.notOffered.join(' ') } : {}),
      knownForEveryRoute: portalFacts(bot, goal, ruins, lava).trim(),
      pickaxes: require('./levels').pickSays(bot).trim(),
      paces: `Walks at ${require('./levels').walkPaceSays()}; climbs ${require('./levels').LEVEL_RECORD.upSecondsABlock} seconds a block risen; a staircase about three seconds a stair; the cast about ${PP.CAST_RECORD.secondsABlock} seconds a block and a scoop about ${PP.CAST_RECORD.scoopSeconds} seconds (${PP.CAST_RECORD.window}).`,
      holds: 'The route chosen is held and the work follows it; it is asked again only when the route fails, lava is found nearer than its lava, the frame loses obsidian, buckets are lost, a death comes, or its own stated minutes are worked through.',
      // What is owed at the surface and at depth, weighed with a cast down
      // by the lava or up top (note 763).
      ...((() => { const s = require('./levels').levelsSays(bot, goal).trim(); return s ? { byLevel: s } : {}; })()),
      riskNow: require('./risk').riskNow(bot) } });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  const now = Date.now();
  // A frame kept or repaired at its site's failure: what its hold is read
  // against (buildPortalFrame, commit.js; note 767).
  const siteKept = ['clear_blocker', 'other_stand'].includes(pick) || pick === current || /^here_/.test(pick);
  if (method?.siteFailed && goal.portalFrame?.siteFailed && siteKept) {
    const f = goal.portalFrame.siteFailed;
    method.siteAnswer = { cast: f.cast, kind: f.kind || failureKind(Object.keys(f.whys || {})[0] || ''), at: now, pick };
  }
  const restate = r => { if (!method) return;
    // The route's lava as it is offered now (the lava in sight moves with
    // the bot): the plan holds that.
    if (r?.lava && method.kind === 'cast') { const v = r.lava; method.lava = { way: v.kind, ...(v.kind === 'deep' ? {} : { at: { x: v.at.x, y: v.at.y, z: v.at.z } }) }; if (r.site === 'beside' && v.kind !== 'pool') method.near = { x: v.at.x, y: v.at.y, z: v.at.z }; }
    method.facts = PP.planFacts(bot, goal, { lavaKnown: [...(method.facts?.lavaKnown || []), ...lavaKnownFrom(bot, goal, frameAt, sources).map(l => l.at)], lavaDistance: planLavaDistance(method, frameAt), frameAt });
    method.minutes = Math.round((method.activeMs || 0) / 60000 + (r?.price?.seconds || 0) / 60); delete method.routeFailed; };
  // A repair: the route held goes on at this frame, the slot it failed at
  // cleared into or stood at from elsewhere.
  if ((pick === 'clear_blocker' || pick === 'other_stand') && goal.portalFrame?.siteFailed?.slot) {
    const f = goal.portalFrame, slot = f.siteFailed.slot, k = `${slot.x},${slot.y},${slot.z}`;
    if (pick === 'clear_blocker') {
      const cells = require('./portal-cast').blockersFor(bot, f, pos(slot)).slice(0, 4).map(b => ({ x: b.at.x, y: b.at.y, z: b.at.z }));
      f.repair = { kind: 'clear', slot: { ...slot }, cells };
      bot.chat?.(`Clearing the way into the frame slot at (${slot.x}, ${slot.y}, ${slot.z}) and going on here.`);
    } else {
      const pass = ((f.passStands ||= {})[k] ||= []);
      for (const c of f.standsTried?.[k] || []) if (!pass.some(q => q.x === c.x && q.y === c.y && q.z === c.z)) pass.push({ ...c });
      delete f.standsMade?.[k];
      bot.chat?.(`Pouring into the frame slot at (${slot.x}, ${slot.y}, ${slot.z}) from another side and going on here.`);
    }
    delete method.siteFailed; method.reasked = (method.reasked || 0) + 1; restate(routes[current]); save();
    return true;
  }
  const nearWalked = method?.nearFailed;
  if (method?.flipped) delete method.flipped;
  if (method?.nearFailed || method?.frameFailed || method?.siteFailed) { delete method.nearFailed; delete method.frameFailed; delete method.siteFailed; }
  // Kept: the plan goes on, its facts read afresh and its minutes stated
  // again from here.
  if (current && pick === current) {
    method.reasked = (method.reasked || 0) + 1;
    restate(routes[current]);
    // Kept with its staircase resting: every way to it rests until then, a
    // fact for persist to answer, not a pass to repeat (note 488).
    if (heldRest) { method.nearAsked = heldRest.until; save(); throw nearResting(method.near, heldRest); }
    if (method.near && nearWalked) { method.nearByStairs = true; method.nearKept = true; }
    save(); return goal.portalFrame ? true : method.kind !== 'ruin' || portalMethod(bot, task, goal, save, client);
  }
  // Down into the cave: the route held, gone on from its floor (intoCave).
  if (pick === 'into_cave') {
    method.intoCave = { ...cave }; method.reasked = (method.reasked || 0) + 1; delete method.nearAsked; restate(routes[current]);
    save(); return false;
  }
  const r = routes[pick];
  const ruin = pick.startsWith('ruin_') ? ruinOf(pick, ruins, goal) : null;
  const v = r?.lava;
  const next = pick === 'build_new' ? { kind: 'build' } : ruin ? { kind: 'ruin', at: { x: ruin.landmark.x, y: ruin.landmark.y, z: ruin.landmark.z } }
    : { kind: 'cast', lava: { way: v.kind, ...(v.kind === 'deep' ? {} : { at: { x: v.at.x, y: v.at.y, z: v.at.z } }) }, ...(r.site === 'beside' ? { near: { x: v.at.x, y: v.at.y, z: v.at.z } } : {}) };
  // A frame begun goes on the new route where the route keeps it: its
  // obsidian stays in its slots and the rest is cast or placed. A route
  // beside the lava, at a new site or to a ruin leaves it where it stands.
  const f = goal.portalFrame;
  if (f && !f.ruin && r && r.site !== 'here') (goal.portalSitesLeft ||= []).push({ ...f.origin, why: r.site === 'beside' ? 'a frame cast beside the lava chosen' : f.siteFailure || 'a new site chosen', at: now });
  if (f && (f.ruin || next.kind === 'ruin' || (r && r.site !== 'here'))) delete goal.portalFrame;
  else if (f && next.kind === 'cast') { f.cast = true; f.axis ||= 'x'; f.castTemp ||= []; }
  else if (f && next.kind === 'build') delete f.cast;
  // The lava the fetch went for before is the plan's now, or none.
  if (goal.lavaFetch && !(next.lava?.at && goal.lavaFetch.lava && PP.sameLava(goal.lavaFetch.lava, next.lava.at)) && !(next.lava?.way === 'deep' && goal.lavaFetch.way === 'deep')) delete goal.lavaFetch;
  delete goal.lavaChosen; delete goal.lavaPick;
  goal.portalMethod = { ...next, key: pick, chosenAt: now, minutes: r?.price?.seconds ? Math.round(r.price.seconds / 60) : null, activeMs: 0, reasked: 0,
    from: { obsidian, diamonds, diamondPickaxe, placed: goal.portalFrame ? placed : 0, ...(ruin ? { distance: ruin.distance } : {}) },
    ...(goal.portalFrame && method?.siteAnswer ? { siteAnswer: method.siteAnswer } : {}) };
  goal.portalMethod.facts = PP.planFacts(bot, goal, { lavaKnown: lavaKnownFrom(bot, goal, frameAt, sources).map(l => l.at), lavaDistance: planLavaDistance(goal.portalMethod, goal.portalFrame ? pos(goal.portalFrame.origin) : here), frameAt: goal.portalFrame?.origin || null });
  // The buckets the route takes, made first.
  if (r?.price?.make > 0) {
    const carriers = countOf(bot, 'bucket') + countOf(bot, 'lava_bucket');
    goal.portalBuckets = { target: carriers + r.price.make, before: carriers, at: now };
  }
  bot.chat?.(planChat(goal.portalMethod, r, ruin));
  save();
  if (goal.portalBuckets && r?.price?.make > 0) return false;
  return next.kind !== 'ruin' || (goal.portalFrame ? true : portalMethod(bot, task, goal, save, client));
}
// The plan chosen, said once: where the frame goes and where its lava
// comes from, and what that was priced at.
function planChat(m, r, ruin) {
  if (m.kind === 'build') return 'Portal plan: a frame of obsidian.';
  if (m.kind === 'ruin') return `Portal plan: finishing the ruined portal ${ruin?.distance ?? '?'} blocks away.`;
  const lava = m.lava.way === 'deep' ? 'the lava layer' : `the lava at (${m.lava.at.x}, ${m.lava.at.y}, ${m.lava.at.z})`;
  const site = r.site === 'beside' ? `beside ${lava}` : `${r.site === 'new_site' ? 'at a new site near here' : 'here'}, its lava from ${lava}`;
  return `Portal plan: a frame cast ${site}${r.price.make ? `, ${r.price.make} more bucket${r.price.make === 1 ? '' : 's'} made first` : ''}${m.minutes ? `, about ${m.minutes} minutes` : ''}.`;
}

// The rest on the way to a lava: the staircase dug toward it (portalStep
// tunnels to the lava's own block) or the one into it (lavaResting, as
// nearestLava drops it by), by the target's area or, from where the bot
// stands, by the landing and heading (tunneling.js restingWay, note 500):
// tunnelStep meets either at once. Read by the area alone, a rest by the
// landing was not seen, the way kept as open, and the walk met the rest
// and asked again (mid-214-g, note 505). Null when neither rests.
function nearRest(goal, near, from = null) {
  const { restingWay, lavaWay } = require('./tunneling');
  const at = new Vec3(near.x, near.y, near.z);
  for (const t of [at, lavaWay(at)]) { const rest = restingWay(goal, t, from); if (rest) return rest; }
  return null;
}
// The cave the staircase to the held lava stopped over (tunneling.js
// caveUnder), while its stall stands: offered to go down into when what is
// under it is ground or water, and the fall one a body takes, as the
// staircase's own drops are judged (no more than half the health).
function heldCave(bot, goal, near) {
  const { STAIRCASE_REST_MS, lavaWay } = require('./tunneling');
  const stall = goal.staircaseStalled, cave = stall?.cave;
  if (!cave || !(Date.now() - stall.at < STAIRCASE_REST_MS)) return null;
  const at = new Vec3(near.x, near.y, near.z), t = new Vec3(cave.target.x, cave.target.y, cave.target.z);
  if (![at, lavaWay(at)].some(p => p.distanceTo(t) < 2)) return null;
  if (!['ground', 'water'].includes(cave.into)) return null;
  const damage = cave.into === 'water' ? 0 : Math.max(0, cave.fall - 3);
  return damage < (bot.health ?? 20) / 2 ? cave : null;
}
// Jev's way down into the cave under the stair: to the landing the stairs
// stopped on, the stair column dug open, and the drop taken to the cave's
// floor; the staircase's rest then lifted, the way going on from down
// there. Tried once: a failure is the loop's and asked about with the way.
async function intoCave(bot, task, goal, save, cave) {
  const { liftStaircaseRest, lavaWay } = require('./tunneling');
  const method = goal.portalMethod;
  delete method.intoCave; save();
  const stair = new Vec3(cave.at.x, cave.at.y, cave.at.z), landing = new Vec3(cave.landing.x, cave.landing.y, cave.landing.z);
  goal.step = { action: 'into_cave', stair: { ...cave.at }, floorY: cave.floorY, fall: cave.fall }; save();
  if (bot.entity.position.floored().distanceTo(landing) > 1) await navigate(bot, task, new goals.GoalBlock(landing.x, landing.y, landing.z), { timeoutMs: 60000, stallMs: 8000 });
  for (let y = Math.max(landing.y + 1, stair.y); y >= stair.y; y--) {
    const c = new Vec3(stair.x, y, stair.z);
    if (!air(bot.blockAt(c))) await dig(bot, task, c, { requireDrops: false, openPit: true });
  }
  const movements = bot.pathfinder.movements, before = movements.maxDropDown;
  movements.maxDropDown = Math.max(before ?? 4, cave.fall + 1);
  try { await navigate(bot, task, new goals.GoalBlock(stair.x, cave.standY, stair.z), { timeoutMs: 20000, stallMs: 5000 }); }
  finally { movements.maxDropDown = before; }
  const near = method.near && new Vec3(method.near.x, method.near.y, method.near.z);
  if (near) { liftStaircaseRest(goal, near); liftStaircaseRest(goal, lavaWay(near)); }
  delete goal.staircaseStalled; delete method.nearAsked; delete method.nearTries; delete method.nearKept; save();
}
const nearResting = (near, rest) => new (require('./tunneling').WaysResting)(`The lava chosen for the portal, at (${near.x}, ${near.y}, ${near.z}): ${rest.what} is set aside (${rest.why}), taken up again in ${rest.minutes} minute${rest.minutes === 1 ? '' : 's'}. The way to the portal was asked with this and kept.`, rest.until);

// The nearest lava the bot knows of, for the cast option's trips: a pool
// loaded about it, or one remembered (exploration.js), not one spent.
// In sight, the sources a bucket can still take before the rest: lava in
// sight that no scooping spot reaches fills no bucket (note 553).
// From `from` (the frame, note 767b) when given: the lava nearest it, its
// distance from it, in three dimensions as everywhere. Read from the bot,
// 25581's frame at (50, 31, -230) was said to have "its nearest known lava
// 302 blocks from it", the pool nearest the bot, with a pool 22 blocks from
// the frame known (2026-10-01 00:42:23Z).
function nearestLava(bot, goal, sources = lavaSources(bot), from = null) {
  const here = from ? new Vec3(from.x, from.y, from.z) : bot.entity.position;
  const loaded = (sources.scoopable.length ? sources.scoopable : sources.surface).map(p => ({ distance: Math.round(p.distanceTo(here)), how: 'in sight about here', at: { x: p.x, y: p.y, z: p.z } }));
  // The pools the lava fetch would use (obsidian.js collectLava): not one
  // whose staircase rests. mid-211-g was told of lava seven blocks off
  // forty minutes into its cast while every bucket went to a staircase
  // toward the deep lava instead, that pool's way resting (2026-09-27).
  // By the way into it (tunneling.js lavaResting), not its own block.
  const { lavaResting } = require('./tunneling');
  const known = require('./exploration').knownLandmarks(bot, goal, 'lava_pool').filter(k => !require('./obsidian').poolSpent(k.landmark) && !lavaResting(goal, new Vec3(k.landmark.x, k.landmark.y ?? 0, k.landmark.z)))
    .map(k => ({ distance: from ? Math.round(Math.hypot(k.landmark.x - here.x, (k.landmark.y ?? here.y) - here.y, k.landmark.z - here.z)) : k.distance, how: 'a lava pool remembered', at: { x: k.landmark.x, y: k.landmark.y, z: k.landmark.z } }));
  return [...loaded, ...known].sort((a, b) => a.distance - b.distance)[0] || null;
}
// The lava sources loaded about the bot, and those of them a bucket can
// still take (obsidian.js scoopable).
function lavaSources(bot) {
  const { poolSurface, scoopable } = require('./obsidian');
  const surface = poolSurface(bot);
  return { surface, scoopable: scoopable(bot, surface) };
}
// The lava chosen to cast beside, seen with no source left about it that a
// bucket takes: each bucket taken from a pool's edge leaves flowing lava,
// and the cast's own water turns what it reaches. mid-242-aa's held option
// said that lava was seven blocks off and "a trip for lava is a few
// seconds" while every bucket came from a pool forty blocks off and
// eighteen up, about four minutes a trip (note 553). Not known while its
// block is unloaded or beyond where the sources are looked for (48 blocks,
// poolSurface), less the pool's own reach.
const GONE_WITHIN = 8;
function lavaGone(bot, near, sources = lavaSources(bot)) {
  const at = new Vec3(near.x, near.y, near.z);
  // Its own block still a source (under a roof, say, where the staircase
  // goes to it) is not gone.
  const block = bot.blockAt(at);
  if (!block || require('./obsidian').sourceLava(block) || bot.entity.position.distanceTo(at) > 48 - GONE_WITHIN) return false;
  const served = sources.scoopable.length ? sources.scoopable : sources.surface;
  return !served.some(p => p.distanceTo(at) <= GONE_WITHIN);
}

// The crossing: the kit said and Jev's to top up (crossingKitReady), then
// a lit portal, a known one, or one made. With Jev's client from whichever
// task asks: from the ladder's own step the task had none, and the food
// question was skipped there (mid-230-e, 2026-09-26).
// Working time counted while a pass runs, ten seconds at a time and saved:
// counted only at its end, a pass minutes long (a walk to lava two hundred
// blocks off) that a restart cut short counted nothing, and mid-242-d's
// cast, three hours from its lava, was never asked about again (2026-09-27).
const TICK_MS = 10000;
async function timed(save, add, fn) {
  let last = Date.now();
  const credit = () => { const now = Date.now(); add(now - last); last = now; };
  const timer = setInterval(() => { credit(); save(); }, TICK_MS);
  timer.unref?.();
  try { return await fn(); }
  finally { clearInterval(timer); credit(); }
}
async function netherStep(bot, task, goal, save, client = task.opportunityClient) {
  if (String(bot.game.dimension).includes('nether')) return true;
  // Working time at the crossing, a pass at a time: the kit's answer holds
  // for ten minutes of it, not of nights sat out between passes.
  return timed(save, ms => { if (goal.crossingKit) goal.crossingKit.workedMs = (goal.crossingKit.workedMs || 0) + ms; }, () => crossing(bot, task, goal, save, client));
}
async function crossing(bot, task, goal, save, client) {
  if (!await crossingKitReady(bot, task, goal, save, client)) return false;
  const portal = lowestPortalBlock(bot);
  if (portal) {
    goal.portal = { ...portal }; rememberPortal(goal, save, portal, 'overworld'); save();
    // A cast frame lit with its water still standing (a scoop that failed,
    // a restart between the pour and the scoop) has it taken back first: it
    // runs down past the portal's face and floods the way in (note 567).
    const frame = goal.portalFrame;
    if (frame && (frame.castWater || frame.castWaterLeft?.length) && pos(frame.origin).distanceTo(pos(portal)) <= 6) {
      await leaveNoWater(bot, task, frame, save, { navigate, place });
    }
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
  // The portal's own work is timed for the way it is made (portalMethod):
  // the time its passes take.
  const method = goal.portalMethod;
  // And by what the pass was on, for the way's pace to say where its
  // minutes went: mid-235-l was told "2 obsidian in 40 minutes, about 20 a
  // block", its minutes mostly climbs and a pickaxe made (note 426).
  return timed(save, ms => {
    if (!method || goal.portalMethod !== method) return;
    method.activeMs = (method.activeMs || 0) + ms;
    const on = String(goal.step?.action === 'cast_portal' ? `cast: ${goal.step.phase || 'cast'}` : goal.step?.action || 'other').replaceAll('_', ' ');
    (method.byStep ||= {})[on] = (method.byStep[on] || 0) + ms;
  }, () => portalStep(bot, task, goal, save, client));
}
// The lava a cast's site is weighed by and the trips still owed to it:
// the lava chosen to cast beside, or the nearest known; the trips as the
// cast counts them (portal-cast.js castTrips), a bucket a block, a trip
// carrying one per bucket held. Null when not casting or no lava is known.
function castSiteCost(bot, goal, near, casting) {
  if (!casting) return null;
  // The plan's lava where it names one (note 782), else the nearest known.
  const planned = goal.portalMethod?.lava?.at || (goal.portalMethod?.lava?.way === 'deep' && bot.entity?.position ? { x: Math.floor(bot.entity.position.x), y: require('./obsidian').LAVA_DEPTH, z: Math.floor(bot.entity.position.z) } : null);
  const lava = near || planned || nearestLava(bot, goal)?.at;
  if (!lava) return null;
  const standing = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length : 0;
  const t = castTrips({ obsidian: countOf(bot, 'obsidian'), standing, buckets: countOf(bot, 'bucket'), lavaBuckets: countOf(bot, 'lava_bucket') });
  return { lava: { x: lava.x, y: lava.y, z: lava.z }, trips: Math.max(1, t.trips), toFetch: t.toFetch, carriers: t.carriers };
}
// A site's bucket trips in words: how many, each how long from there, and
// all of them together (note 753b).
function castSiteSays(site, cast, { atLeast = false } = {}) {
  if (!cast?.lava || !site) return '';
  const trip = require('./build-sites').bucketTrip(site, cast.lava);
  const each = trip.seconds < 120 ? `${trip.seconds} seconds` : `${Math.round(trip.seconds / 60)} minutes`;
  const all = cast.trips * trip.seconds, total = all < 120 ? `${all} seconds` : `${Math.round(all / 60)} minutes`;
  return ` The cast still owes ${cast.toFetch} lava bucket${cast.toFetch === 1 ? '' : 's'} (${cast.carriers} bucket${cast.carriers === 1 ? '' : 's'} carried): ${cast.trips} trip${cast.trips === 1 ? '' : 's'} from a frame here to the lava at (${cast.lava.x}, ${cast.lava.y}, ${cast.lava.z}) and back, ${trip.distance} blocks off${trip.rise > 8 ? ` and ${trip.rise} ${trip.below > 0 ? 'down' : 'up'}` : ''}, ${atLeast ? 'at least ' : ''}about ${each} a trip, ${atLeast ? 'at least ' : ''}${total} in all.`;
}

async function portalStep(bot, task, goal, save, client) {
  // Buckets Jev chose to make for the cast, before anything else of it.
  const buckets = goal.portalBuckets;
  if (buckets) {
    const carriers = countOf(bot, 'bucket') + countOf(bot, 'lava_bucket');
    // Made, or no iron left for more: the plan goes on with them (note 782).
    if (carriers >= buckets.target || countOf(bot, 'iron_ingot') < 3) { delete goal.portalBuckets; save(); }
    else {
      goal.step = { action: 'buckets_for_portal', carried: carriers, target: buckets.target }; save();
      try { await acquireStep(bot, task, 'bucket', countOf(bot, 'bucket') + buckets.target - carriers, goal, save); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; delete goal.portalBuckets; save(); }
      return false;
    }
  }
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
      ![...(goal.portalFrame.supports || []), ...(goal.portalFrame.castTemp || [])].some(p => bot.blockAt(pos(p))?.name === p.material) &&
      !portalSiteClear(bot, goal.portalFrame.origin)) { delete goal.portalFrame; save(); }
  // The portal plan, asked when none is held or a named fact has changed
  // (note 782).
  if ((!goal.portalFrame || planDueNow(bot, goal)) && !await portalMethod(bot, task, goal, save, client)) return false;
  if (!goal.portalFrame) {
    // Cast in place (portal-cast.js), the obsidian is made in its slots.
    const casting = goal.portalMethod?.kind === 'cast';
    if (!await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
    if (!casting && !await acquireStep(bot, task, 'obsidian', 10, goal, save)) return false;
    // Gather scaffolding before choosing the building site, so we never mine
    // its foundations to obtain temporary supports. A cast frame's are its
    // lava's walls.
    if (!await preparePortalSupports(bot, task, goal, save, casting ? plannedWalls() : 3)) return false;
    // Cast beside the lava, as Jev chose: the walk there first, and the
    // site picked about where the bot then stands.
    const near = casting && goal.portalMethod.near;
    if (near && goal.portalMethod.intoCave) { await intoCave(bot, task, goal, save, goal.portalMethod.intoCave); return false; }
    // A climb chosen for the frame's site holds to the top, not undone by
    // the walk back to the lava each pass: mid-220-h went six stairs up and
    // back down to the lava for thirteen minutes (note 531). And at the top
    // the site is looked for up there, as the climb said ("the frame then
    // goes down up there"), not the lava walked back down to first: mid-243-a
    // climbed five blocks to open sky, was then seventeen from its lava, dug
    // the stairs back down to eleven, found no site and was asked again,
    // eight climbs in three minutes, until the staircase was set aside for
    // pacing its own cells (note 537). Held for the lava it was chosen with,
    // until a frame is set out.
    const siteClimb = near && goal.surfaceTrip?.pick === 'climb' && /^a portal site/.test(goal.surfaceTrip.need || '') &&
      (!goal.surfaceTrip.lava || ['x', 'y', 'z'].every(k => goal.surfaceTrip.lava[k] === near[k]));
    if (siteClimb && !surfaceReturnComplete(bot, goal)) { await surfaceStep(bot, task, goal, save); return false; }
    if (near && !siteClimb && bot.entity.position.distanceTo(new Vec3(near.x, near.y, near.z)) > 12) {
      const at = new Vec3(near.x, near.y, near.z);
      // Three walks that come no nearer and the lava is not walked to:
      // mid-243-f walked at a pool fourteen blocks off for minutes, up and
      // down a hillside above it, until the flip watch ended the trial
      // (2026-09-27). The lava was then dropped and the frame cast where the
      // bot stood. Not now: that overturned Jev's choice unasked, and
      // mid-244-v, pulled back up by survival on each walk down, had its
      // frame cast 122 blocks above the lava it chose (note 470). The
      // question is asked again with the walks said: how many, how near,
      // and what ended each (survival's step since, or the walk's error).
      // Asked with this very rest said, and kept: every way to it rests
      // until then, not a walk counted and asked about again (note 488).
      // A rest by the landing is met from where the bot stands (nearRest).
      const rest = goal.portalMethod.nearByStairs && nearRest(goal, near, bot.entity.position);
      if (rest && goal.portalMethod.nearAsked === rest.until) throw nearResting(near, rest);
      const d = bot.entity.position.distanceTo(at), tries = goal.portalMethod.nearTries ||= { best: Infinity, stale: 0, walks: 0, stops: {} };
      if (tries.lastAt) {
        const s = goal.survivalAction, since = s?.at && Date.parse(s.at) > tries.lastAt;
        const by = since ? `survival: ${String(s.action || 'a survival step').replaceAll('_', ' ')}` : tries.error || 'the walk ended short';
        tries.stops[by] = (tries.stops[by] || 0) + 1; delete tries.error;
      }
      const failed = () => {
        const stopped = Object.entries(tries.stops).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
        goal.portalMethod.nearFailed = { walks: tries.walks, best: Math.round(Math.min(tries.best, d)), now: Math.round(d), stopped };
        delete goal.portalMethod.nearTries; save();
        return false;
      };
      // A rest not yet asked with is asked with now, not walked into: the
      // staircase meets it at once, and three such walks were three
      // passes and a question in a second and a half (mid-214-g, note 505).
      if (rest) return failed();
      if (d < tries.best - 1) { tries.best = d; tries.stale = 0; }
      // Kept with the walks failed: the staircase's own rounds judge it,
      // and its set-aside is the rest above (portalMethod, note 505).
      else if (++tries.stale >= 3 && !(goal.portalMethod.nearKept && goal.portalMethod.nearByStairs)) return failed();
      tries.walks++; tries.lastAt = Date.now();
      // Once the walk has failed, the staircase goes on without a walk tried
      // first each pass: mid-211-i gained a block a pass down its stairs,
      // five seconds of failed walk between, and the flip watch took the
      // turn between them for a loop (2026-09-27).
      // The stall that ended the stairs is what ended the walk: said only
      // from the walk's own failure, mid-214-f's twenty-six stalls read
      // "the walk ended short" (note 488).
      const stairs = async () => {
        try { await tunnelToward(bot, task, goal, save, at, 'lava_for_portal'); }
        catch (err) { if (err.name === 'StaircaseStalled') { tries.error = `the staircase set aside: ${err.why}`.slice(0, 80); save(); } throw err; }
      };
      if (goal.portalMethod.nearByStairs) {
        goal.step = { action: 'tunnel', target: { ...near }, toward: 'lava_for_portal', distance: Math.round(d) }; save();
        await stairs();
        return false;
      }
      goal.step = { action: 'to_lava_for_portal', at: { ...near }, distance: Math.round(d) }; save();
      try { await navigate(bot, task, new goals.GoalNear(at.x, at.y, at.z, 6), { timeoutMs: 120000, stallMs: 8000, sprint: true }); }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
        tries.error = String(err.message || err).slice(0, 80);
        goal.portalMethod.nearByStairs = true; save();
        await stairs();
      }
      // A walk that got there is not a walk that failed: the count starts
      // afresh (note 767f). 25597 (mid-236-af, 04:10-04:11Z) walked to its
      // pool, left it for a site and a climb, walked back, and was told "8
      // walks toward it came no nearer than 12 blocks" of walks that each
      // arrived.
      if (bot.entity.position.distanceTo(at) <= 12) { delete goal.portalMethod.nearTries; delete goal.portalMethod.nearByStairs; save(); }
      return false;
    }
    const avoid = (goal.portalSitesLeft || []).map(pos);
    // A site dug out of the rock is the one to use once dug (note 531).
    const dug = goal.portalSiteDug && !avoid.some(q => q.distanceTo(pos(goal.portalSiteDug)) < 6) && portalSiteClear(bot, goal.portalSiteDug) ? pos(goal.portalSiteDug) : null;
    // A cast's site is weighed with the bucket trips it makes: the lava it
    // casts from, and the trips still owed (note 753b).
    const cast = castSiteCost(bot, goal, casting ? near : null, casting);
    // For a cast beside the lava Jev chose, a site more than 32 blocks from
    // that lava is not its site (note 767c): 25589 (2026-10-01 01:14:09-
    // 01:14:41Z) climbed from beside its lava at (363, 66, 230) for a
    // site, a search heading took it on, and the frame went down at (413,
    // 76, 283), 60 blocks off; every bucket after was a two-minute trip.
    // Out of its reach, the climb's hold is let go and the next pass walks
    // back to the lava (the walk above), where a site is dug or asked for.
    let site = dug || selectPortalSite(bot, { avoid, cast });
    const lavaOff = p => near ? Math.hypot(p.x - near.x, p.y - near.y, p.z - near.z) : 0;
    if (site && !dug && lavaOff(site) > SITE_NEAR_LAVA) site = null;
    if (!site && near && lavaOff(bot.entity.position) > SITE_NEAR_LAVA) {
      if (/^a portal site/.test(goal.surfaceTrip?.need || '')) { delete goal.surfaceTrip; save(); }
      goal.step = { action: 'to_lava_for_portal', at: { ...near }, distance: Math.round(lavaOff(bot.entity.position)), siteFar: true }; save();
      try { await navigate(bot, task, new goals.GoalNear(near.x, near.y, near.z, 8), { timeoutMs: 90000, stallMs: 8000, sprint: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      return false;
    }
    if (!site) {
      if (surfaceObserver(bot)(bot.entity.position)) await explore(bot, task, goal, save, 'portal site', { surfaceOnly: true });
      else await surfaceTrip(bot, task, goal, save, 'a portal site (none level and dry down here)', { siteDig: portalSiteDig(bot, { avoid, radius: 6, cast }), lava: casting ? near : null, cast });
      return false;
    }
    delete goal.portalSiteDug;
    // The site found, the climb for it is done with.
    if (/^a portal site/.test(goal.surfaceTrip?.need || '')) delete goal.surfaceTrip;
    const o = pos(site);
    // Minimal frame: two bottom/top blocks, three on each side, no corners.
    goal.portalFrame = { origin: { ...o }, blocks: cornerlessFrame(o), ...(casting ? { axis: 'x', cast: true, castTemp: [] } : {}) };
    save();
  }
  await buildPortalFrame(bot, task, goal, save, goal.portalFrame);
  return false;
}

// A frame raised and lit, from its obsidian and a lighter: the Overworld's
// portal, or one built where the bot stands in the Nether (nether-travel.js,
// when the way back to the one it came through is lost).
// The cells inside a frame that keep the portal from filling: the portal
// takes only air and fire.
function portalInteriorBlockers(bot, cells) {
  return cells.interior.filter(p => { const b = bot.blockAt(p); return b && !air(b) && !['fire', 'soul_fire', 'nether_portal'].includes(b.name); });
}

const SITE_REACH = 12;
// The body a failure at the frame's site is owed to: one the placement
// named, or, for a failure to stand, place or pour, a mob in the cells the
// cast works in at its slot (portal-cast.js workCells). Null otherwise.
function siteBody(bot, frame, goal, err) {
  if (err?.body) return err.body;
  if (!/Nowhere to stand|Cannot place|Placement obstructed|No line into|No place to pour water|would move me off/.test(String(err?.message || ''))) return null;
  const { castOrder, workCells } = require('./portal-cast');
  const slot = goal.step?.action === 'cast_portal' && goal.step.slot ? pos(goal.step.slot) : castOrder(frame).find(p => bot.blockAt(p)?.name !== 'obsidian');
  if (!slot) return null;
  for (const c of workCells(frame, slot)) {
    const e = occupant(bot, c);
    if (e) return { name: e.username || e.name || 'mob', at: { x: c.x, y: c.y, z: c.z } };
  }
  return null;
}
async function buildPortalFrame(bot, task, goal, save, frame) {
  const { frameCells, across } = require('./ruined-portal');
  const axis = frame.axis || 'x', cells = frameCells(frame.origin, axis);
  const missing = frame.blocks.filter(p => bot.blockAt(pos(p))?.name !== 'obsidian');
  // What stands, as last seen: said from hundreds of blocks off, where the
  // frame's cells are not loaded (crossingKitReady, note 527).
  if (frame.blocks.every(p => bot.blockAt(pos(p)))) frame.placedSeen = frame.blocks.length - missing.length;
  // A frame that fails at its site again and again, no obsidian in it yet,
  // is the site's fault: mid-227-e's cast frame went down at y 28 in a cave
  // by the lava, "nowhere to stand to pour" and then "no route" every pass,
  // and mid-218-b's corner support had nothing solid beside it to place
  // against, 126 times; the stall watch ended both (2026-09-27). After
  // three, with no obsidian in the frame, the site is left for another.
  try {
    // A ruin's frame: what stands in its empty slots and inside it comes out
    // first (a diamond pickaxe for obsidian where it should not be).
    if (frame.ruin) {
      for (const p of [...frame.blocks.map(pos), ...(frame.interior || []).map(pos)]) {
        const b = bot.blockAt(p);
        const inSlot = frame.blocks.some(q => pos(q).equals(p));
        if (!b || air(b) || (inSlot && b.name === 'obsidian') || /^(short_grass|tall_grass|fern|large_fern|dead_bush|vine|snow|fire|soul_fire)$/.test(b.name)) continue;
        goal.step = { action: 'clear_ruined_portal', at: { ...p }, block: b.name }; save();
        await dig(bot, task, p, { requireDrops: false });
      }
    }
    if (!await (async () => {
      if (missing.length && frame.cast) {
        // Far from the frame with no walk there (it lies below, and a walk
        // does not dig down): the staircase to it. mid-241-e came up for
        // food thirteen blocks over its frame and "no path" came back
        // thirty-nine times (2026-09-27).
        // Only with something to cast (a lava bucket or obsidian): fetching
        // lava is the cast's own business, and walked back to the frame at
        // every pass, mid-244-h's staircase to the deep lava was undone four
        // steps down, again and again (2026-09-27, a slip in note 318).
        const origin = pos(frame.origin);
        // The cast asks for water first at every slot, and the trip for it is
        // made from where the bot is: walked back to the frame each pass, the
        // search for water was undone each pass, and mid-243-bd, with nine
        // buckets of lava and none of water, stayed within twenty blocks of
        // its frame for an hour looking for a river seventy-two off (note 630).
        if (bot.entity.position.distanceTo(origin) > 8 && castLacksWater(bot, frame)) {
          goal.step = { action: 'fill_bucket', item: 'water_bucket', count: 1, consumes: { bucket: 1 }, produces: { water_bucket: 1 } }; save();
          await acquireStep(bot, task, 'water_bucket', 1, goal, save);
          return false;
        }
        if (bot.entity.position.distanceTo(origin) > 8 && (countOf(bot, 'lava_bucket') || countOf(bot, 'obsidian'))) {
          // Stairs begun toward the frame go on without the walk tried first
          // each pass (as the lava's, note 603): five seconds of failed walk
          // between every stair read as two steps trading the turn, and each
          // stall's detour took the bot off the shaft it was climbing
          // (mid-243-bd, 19:31Z).
          const stairs = frame.stairs && Date.now() - frame.stairs.at < 30000 && bot.entity.position.distanceTo(origin) < frame.stairs.distance - 0.5 ? frame.stairs : null;
          try {
            if (stairs) throw Object.assign(new Error(stairs.walk), { heldStairs: true });
            await navigate(bot, task, new goals.GoalNear(origin.x, origin.y, origin.z, 3), { timeoutMs: 60000, stallMs: 8000 });
          }
          catch (err) {
            task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
            goal.step = { action: 'return_to_frame', frame: { ...frame.origin } }; save();
            // Far off, legs of the way on foot first, as to a portal
            // (walkToKnownPortal): the pathfinder bridges and climbs where
            // the staircase only digs.
            const distance = Math.round(bot.entity.position.distanceTo(origin));
            let legs = null;
            if (distance > 48 && !err.heldStairs) {
              if (!isSetAside(goal, 'portal_leg', origin)) {
                if (await portalLeg(bot, task, goal, origin)) return false;
                setAside(goal, 'portal_leg', origin, 'a walk toward it made no ground', 120000); save();
              }
              legs = 'legs of thirty-two blocks on foot made no ground';
            } else if (distance > 48) legs = 'legs of thirty-two blocks on foot made no ground';
            // Neither the walk nor the staircase gets there, and the way is
            // asked again with that said, as for the lava (note 473): not
            // tried again unasked. mid-215-h, 137 blocks from its frame with
            // lava in hand, walked, had the staircase set aside, and did
            // both again every pass (note 481).
            const held = goal.portalFrame === frame && goal.portalMethod;
            frame.stairs = { at: Date.now(), distance: bot.entity.position.distanceTo(origin), walk: String(err.message || err).slice(0, 80) }; save();
            try { await tunnelToward(bot, task, goal, save, origin, 'portal_frame'); }
            catch (e) {
              task.check(); if (!held || e.name !== 'StaircaseStalled') throw e;
              delete frame.stairs;
              const { staircaseWhy, staircaseUntil, WaysResting } = require('./tunneling');
              const failed = { at: { ...frame.origin }, distance, walk: String(err.message || err).slice(0, 80), legs, stairs: staircaseWhy(goal, origin), until: staircaseUntil(goal, origin) };
              // Asked already for this very rest, and kept: every way to it
              // rests, a fact to answer (persist), not a pass to repeat.
              if (held.frameAsked && held.frameAsked === failed.until) throw new WaysResting(frameFailedSays(failed) + ' The way to the portal was asked with this and kept.', failed.until);
              held.frameFailed = failed; held.frameAsked = failed.until; save();
            }
            return false;
          }
        }
        if (!await castFrame(bot, task, goal, save, { navigate, place, dig, acquireStep })) return false;
      } else if (missing.length) {
        if (!await acquireStep(bot, task, 'obsidian', missing.length, goal, save)) return false;
        // A frame begun as a cast and finished by hand: a temporary block left
        // in a slot comes out before the obsidian goes in.
        for (const t of [...(frame.castTemp || [])]) {
          const p = pos(t);
          if (!missing.some(q => pos(q).equals(p)) || air(bot.blockAt(p))) continue;
          goal.step = { action: 'clear_cast_walls', at: { ...t }, block: bot.blockAt(p)?.name }; save();
          await dig(bot, task, p, { requireDrops: false });
          frame.castTemp = frame.castTemp.filter(q => !pos(q).equals(p)); save();
        }
        // The cornerless frame still needs temporary placement anchors. The top
        // beam cannot be placed in midair: build its left corner after the column.
        const o = pos(frame.origin);
        const scaffold = [cells.corners[0], cells.corners[1], cells.corners[2]];
        const neededSupports = scaffold.filter(p => air(bot.blockAt(p))).length;
        if (!await preparePortalSupports(bot, task, goal, save, neededSupports)) return false;
        const stand = o.minus(across(axis));
        if (frame.ruin) await navigate(bot, task, new goals.GoalNear(o.x, o.y, o.z, 3));
        else await navigate(bot, task, new goals.GoalBlock(stand.x, stand.y, stand.z));
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
      return true;
    })()) return false;
    frame.siteFailures = 0;
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name) || err instanceof Blocked) throw err;
    // A fetch the cast makes (the water bucket, lava, blocks for its walls)
    // is the trip's, wherever it fails (portal-cast.js, note 767): 33 of
    // the 167 failures counted at the site since 15:24Z on 2026-09-30 were
    // "Water source is outside visible interaction reach", and 11 "No
    // existing route to the saved mining worksite" (blocks for the walls).
    if (err?.castTrip) throw err;
    // Only a failure at the site is the site's: one on the way to the lava
    // is the trip's. mid-207-e left twelve sites in three hours, seven of
    // them for "refusing to open a drop" in the tunnel down to the lava,
    // far from each frame, and never got its portal made (2026-09-27).
    if (bot.entity.position.distanceTo(pos(frame.origin)) > SITE_REACH) throw err;
    // Nor a walk that found no route to a slot from below or above the
    // frame's rows: that is the way back from the lava, not the site.
    // 25593 (mid-237-ag, 13:48:39Z) stood six blocks under its slot at
    // (99, 19, 60), fresh from the lava 73 blocks down, "No route from here
    // to (99, 19, 60)", and that third failure left the site (note 753b).
    if (/^No route from here/.test(String(err.message)) && (bot.entity.position.y < frame.origin.y - 2 || bot.entity.position.y > frame.origin.y + 6)) throw err;
    // A mob in the cells the cast works in is a passing obstruction, not a
    // fault of the site: mid-230-u's zombie stood in a stand cell, the
    // server refused the stand's block and "nowhere to stand to pour"
    // followed, and that took the tenth site failure; the frame with four
    // of ten cast was left for a new one fifty blocks off (note 527). Said,
    // not counted.
    const body = siteBody(bot, frame, goal, err);
    if (body) {
      frame.bodyFailures = { n: (frame.bodyFailures?.n || 0) + 1, name: body.name, at: body.at, why: String(err.message).slice(0, 160) }; save();
      throw err;
    }
    frame.siteFailures = (frame.siteFailures || 0) + 1; frame.siteFailure = err.message;
    // Swallowed here, the pass ends at once: said to the next question
    // (decisions/repeats.js). mid-242-ab's "Nowhere to stand" 3,463 times.
    const by = require('./tried').answerNow(goal);
    goal.lastFailure = { why: String(err.message).slice(0, 200), at: Date.now(), ...(by ? { by } : {}) };
    const castIn = frame.blocks.filter(q => bot.blockAt(pos(q))?.name === 'obsidian').length;
    // The failures since the last block went in, each said with its reason.
    if (!frame.siteFailed || frame.siteFailed.cast !== castIn) frame.siteFailed = { cast: castIn, n: 0, whys: {} };
    const why = String(err.message).slice(0, 160);
    frame.siteFailed.n++; frame.siteFailed.whys[why] = (frame.siteFailed.whys[why] || 0) + 1;
    // The slot it failed at and the kind of failure, for the ways to repair
    // it that portal_plan offers and for the answer's hold (note 767).
    if (goal.step?.action === 'cast_portal' && goal.step.slot) frame.siteFailed.slot = { ...goal.step.slot };
    frame.siteFailed.kind = failureKind(why);
    save();
    if (!frame.ruin && goal.portalFrame === frame && frame.siteFailures >= 3 && !castIn) {
      (goal.portalSitesLeft ||= []).push({ ...frame.origin, why: err.message, at: Date.now() });
      delete goal.portalFrame; save();
      bot.chat?.('This spot will not take the portal. Finding another.');
      return false;
    }
    // With obsidian in it, leaving the frame is Jev's: the way to a portal
    // is asked at once, the failures here said with what is cast and what a
    // new frame would cost (portalMethod, new_site). A counter left it after
    // ten; mid-243-h's part-cast frame failed ninety-five times at one slot,
    // and mid-230-u's four cast were left for all ten again (note 527).
    // Kept or repaired at a failure, the answer is a commitment (note 764's
    // commit.js, note 767): the question asked again at the next failure
    // returns it unasked until a block goes in, a failure of another kind
    // comes, or its three minutes pass. 25595 (mid-243-ap, 2026-09-30
    // 21:14:51-21:15:10Z) was asked three times in 23 seconds on one slot's
    // failures and left six of ten cast at the third; the old hold counted
    // three failures, and they came three in nine seconds.
    // While it holds the question is not put again at all: asked, each
    // failure settled the kept answer in the ledger as come to nothing, and
    // at the second the ledger rested it from here, so 25595's third asking
    // offered only build_new and new_site, and new_site was taken.
    const answered = goal.portalMethod?.siteAnswer;
    const C = require('./decisions/commit'), held = answered && C.holding(bot, 'portal_plan');
    if (held && !frame.ruin && goal.portalFrame === frame && castIn) {
      const ends = answered.cast !== castIn ? `a block went in since (${castIn} of ten cast, from ${answered.cast})`
        : answered.kind !== frame.siteFailed.kind ? `a failure of another kind came ("${why.slice(0, 80)}")`
        : C.endedBy(held, C.factsOf(bot, goal), {});
      if (!ends) {
        answered.held = (answered.held || 0) + 1;
        console.log(`[commit] portal_plan: ${String(answered.pick).replaceAll('_', ' ')} held at the frame's failure ${frame.siteFailed.n} (${answered.held} since it was chosen): ${why}`);
        return false;
      }
      C.end(bot, 'portal_plan', ends);
    }
    if (!frame.ruin && goal.portalFrame === frame && castIn && goal.portalMethod) {
      goal.portalMethod.siteFailed = true; save();
      return false;
    }
    // No way held (a record from before ways were held): the code's default.
    if (!frame.ruin && goal.portalFrame === frame && frame.siteFailures >= 10) {
      (goal.portalSitesLeft ||= []).push({ ...frame.origin, why: err.message, at: Date.now() });
      delete goal.portalFrame; save();
      bot.chat?.('This spot will not take the portal. Finding another.');
      return false;
    }
    // A ruin's frame, after ten: it cannot be moved, so the ruin is marked as
    // no frame to finish and the way to a portal is asked again without it.
    // mid-218-f's ruin had a corner with nothing beside it to place its
    // support against, and failed there 125 times until the loop watch
    // ended the trial (2026-09-27).
    if (frame.ruin && goal.portalFrame === frame && frame.siteFailures >= 10) {
      const mark = (goal.landmarks || []).find(l => l.kind === 'ruined_portal' && Math.hypot(l.x - frame.origin.x, l.z - frame.origin.z) <= 16);
      if (mark) { mark.noFrame = true; mark.why = err.message; }
      (goal.portalSitesLeft ||= []).push({ ...frame.origin, why: err.message, at: Date.now() });
      delete goal.portalFrame; delete goal.portalMethod; save();
      bot.chat?.('This ruined portal will not take a frame. Finding another way.');
      return false;
    }
    throw err;
  }
  // A cast frame's temporary walls inside it and at its corners come out
  // before lighting: the portal fills only an empty inside. The rest stand.
  // A frame cast in part and finished by hand has them too.
  if (frame.cast || frame.castTemp?.length) {
    const inside = [...cells.interior, ...cells.corners];
    for (const t of [...(frame.castTemp || [])]) {
      const p = pos(t);
      if (!inside.some(q => q.equals(p))) continue;
      if (!air(bot.blockAt(p))) {
        goal.step = { action: 'clear_cast_walls', at: { ...t }, block: bot.blockAt(p)?.name }; save();
        await dig(bot, task, p, { requireDrops: false });
      }
      frame.castTemp = frame.castTemp.filter(q => !pos(q).equals(p)); save();
    }
  }
  // Anything else inside comes out too: the portal fills only when every
  // inside cell is empty. mid-211-j's cast frame had a cobblestone in it
  // that was not among the recorded walls (a stand or a scaffold), and the
  // flint and steel lit fire beside it and nothing more, a hundred and
  // twenty-five times, until the loop watch ended the trial (2026-09-27).
  for (const p of portalInteriorBlockers(bot, cells)) {
    goal.step = { action: 'clear_portal_inside', at: { x: p.x, y: p.y, z: p.z }, block: bot.blockAt(p)?.name }; save();
    await dig(bot, task, p, { requireDrops: false });
  }
  // A fire charge lights a portal as flint and steel does, and a ruin's
  // chest often holds one.
  const lighter = countOf(bot, 'flint_and_steel') ? 'flint_and_steel' : countOf(bot, 'fire_charge') ? 'fire_charge' : null;
  if (!lighter && !await acquireStep(bot, task, 'flint_and_steel', 1, goal, save)) return false;
  const bottom = cells.blocks.find(p => p.y === frame.origin.y);
  await navigate(bot, task, new goals.GoalNear(bottom.x, bottom.y, bottom.z, 2));
  await bot.equip(bot.inventory.items().find(i => i.name === (lighter || 'flint_and_steel')), 'hand');
  task.check();
  await bot.activateBlock(bot.blockAt(bottom), new Vec3(0, 1, 0));
  // Lit and no portal: said as that, the fire left burning in the frame
  // (walked round by the pathfinder and the held-key moves; note 502).
  await waitFor(task, () => bot.blockAt(bottom.offset(0, 1, 0))?.name === 'nether_portal', 4000, () => {
    const left = bot.blockAt(bottom.offset(0, 1, 0))?.name;
    return /fire/.test(left || '') ? `the frame at (${bottom.x}, ${bottom.y + 1}, ${bottom.z}) lit to ${left.replace('_', ' ')} and no portal: the frame is not whole or its inside not empty; the fire burns there` : `no portal in the frame at (${bottom.x}, ${bottom.y + 1}, ${bottom.z}) after lighting (${left || 'nothing'} there)`;
  });
  // The cast's walls in the doorway, before and behind the opening, come out
  // once it is lit: they boxed mid-242-m's portal in (2026-09-27).
  const doorway = cells.interior.flatMap(q => [1, -1].map(d => q.plus(across(axis).scaled(d))));
  for (const t of [...(frame.castTemp || [])]) {
    const p = pos(t);
    if (!doorway.some(q => q.equals(p))) continue;
    if (!air(bot.blockAt(p))) { try { await dig(bot, task, p, { requireDrops: false }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; } }
    frame.castTemp = frame.castTemp.filter(q => !pos(q).equals(p)); save();
  }
  return true;
}

function createSurvival(bot, options) {
  // planFor: what making an item from the pockets would take, for the
  // pocket's "work here" option (smelting and crafting only).
  const planFor = (b, item, count, goal) => catalogPlan(b, item, count, planningInventory(b), goal);
  // stashTrip: the valuables into the home's stash chest, for the night
  // hunt's "stash first" option.
  const stashTrip = (b, t, g, sv) => stashValuables(b, t, g, sv, homeActions());
  // cacheHere: the valuables into a chest put down on the spot, when home's
  // chest is out of reach.
  const cacheHere = (b, t, g, sv, reason) => require('./field-cache').cacheValuables(b, t, g, sv, homeActions(), { reason });
  return new Survival(bot, { acquireStep, dig, place, navigate, explore, returnOverworld: returnFromNether, surfaceStep, planFor, stashTrip, cacheHere, tunnel: tunnelToward }, options);
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
  // In view but more than sixteen blocks off, with blaze rods carried: back
  // the way it came in first, as for a portal remembered (note 762).
  const walkOut = require('./walk-out'), rods = walkOut.rodsCarried(bot);
  if (rods && bot.entity.position.distanceTo(pos(portal)) > 16 && !isSetAside(goal, 'way_in', pos(portal))) {
    const went = await walkOut.walkBack(bot, task, goal, portal, navigate);
    if (went.tried && !went.ok) { setAside(goal, 'way_in', pos(portal), `the way back along it stopped: ${went.why}`, 120000); save(); }
  }
  try { await enterPortal(bot, task, portal, () => dimension(bot) === 'overworld'); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    // In view is no nearer than remembered: the ways on are the same, the
    // crossing at this height, then the staircase or the way asked. Here
    // the staircase alone was tried, and its rest thrown to the stall
    // question every pass (note 556).
    const walk = `the walk into it failed (${String(err.message || err).slice(0, 80)})`;
    // Not unasked with rods carried: offered (portal_way dig_across).
    if (rods) return void await stairsOrWay(bot, task, goal, save, portal, 'nether', `${walk}; the crossing straight at it over open air or lava is not begun unasked while rods are carried`);
    const { crossToward } = require('./nether-travel');
    portalApproach(goal, portal, bot.entity.position);
    const crossed = await crossToward(bot, task, goal, save, pos(portal), { what: 'the portal back', beat: approachBest(goal, portal) });
    if (crossed.tried && portalApproach(goal, portal, bot.entity.position)) return;
    await stairsOrWay(bot, task, goal, save, portal, 'nether', crossed.tried ? `${walk}; a crossing straight toward it at this height came no nearer` : crossed.madeAlready ? `${walk}; ${crossed.madeAlready}` : walk);
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
// The legs walked on each heading are kept through the turn: dropped at every
// stall, the asking after it said "legsThatWay" empty and began again at one
// leg, twelve times in mid-243-bd's forty-one askings for water (note 630).
// A ring search (no frontier heading) is turned too, to its next leg from
// the same origin. It used to be dropped, so the next search began again
// from here on its first leg, the same walk that had just failed: the hunt
// for endermen stood four minutes in one cell doing exactly that.
const turnSearch = search => Object.fromEntries(Object.entries(search || {})
  .filter(([, entry]) => Number.isInteger(entry?.frontier?.heading) || entry?.origin)
  .map(([resource, entry]) => [resource, Number.isInteger(entry.frontier?.heading)
    ? { attempts: 0, frontier: { heading: (entry.frontier.heading + 1) % 8, legs: 0, ...(entry.frontier.legsByHeading ? { legsByHeading: entry.frontier.legsByHeading } : {}) } }
    : { attempts: 0, origin: entry.origin, leg: (entry.leg || 0) + 1 }]));
// Failing again and again is getting nowhere. It is written in the ledger
// (tried.js) as the step's way from here, and answered once, one way, up
// the chain (note 571): the question whose answer this step was carrying
// out is asked again with the failure said and that answer marked come to
// nothing (step, then way, plan, rung); with no such question, the stall's
// question is asked with the failure (answerStall: another way, a recovery
// move, the rung left, other work, or the step again). The failed step is
// not put back in hand unless Jev chose to try it again: put back each time,
// the same step failed the same way from the same cell (25592, note 571).
async function persist(bot, task, goal, save, err, onStep, { client, survival, recoveryAdviser } = {}) {
  goal.struggles = (goal.struggles || 0) + 1;
  goal.lastStruggle = { at: new Date().toISOString(), error: err.message, from: goal.lastErrorFrom };
  // A route that found no way three times from about here is set aside with
  // its reason (route-aside.js, note 775): not retried silently, and the
  // stall's question is asked with it said.
  const routeAside = require('./route-aside');
  const route = bot.entity?.position ? routeAside.noteFailure(goal, err, bot.entity.position) : null;
  // Said once for a problem, never as a counter: 25589 said "I'll keep
  // trying (attempt 5 ... 130)" over nine minutes in one spot (note 775).
  const problemKey = route?.target ? `route:${route.target.x},${route.target.z}` : String(err.message).slice(0, 60);
  if (route?.newly) bot.chat?.(routeAside.chatSays(route.aside));
  else if (goal.struggles === 1 || goal.struggleSaid !== problemKey) {
    bot.chat?.(`${friendlyProblem(err, { known: (goal.fortressSearch?.found && goal.fortressSearch.fortressAt) || goal.fortressSearch?.found || null })} I'll keep trying.`);
  }
  goal.struggleSaid = problemKey;
  const failed = goal.lastStruggleStep || goal.step;
  const key = `step:${failed?.block || failed?.item || failed?.action || 'none'}`;
  const tried = require('./tried');
  const work = require('./stillness').actionOf(goal).key;
  // What was found out about the failure, where the failure has it said
  // (the server's corrections, note 632).
  const said = `${String(err.message)}${err.facts ? ` (${err.facts})` : ''}`;
  tried.record(bot, goal, { q: 'step', method: failed?.action || 'none', target: stepTarget(failed), outcome: 'blocked', why: said });
  // What is retried and where it was going, named: mid-202-o-nether-2's
  // persist ran from attempt 1 to 12 on "No route from here to the
  // destination", neither said (note 500).
  goal.step = { action: 'persist', attempt: goal.struggles, problem: err.message, ...(err.facts ? { facts: err.facts } : {}), ...(failed?.action ? { retrying: failed.action } : {}), ...(err.destination ? { destination: err.destination } : {}) }; save(); onStep(goal);
  // Every way resting until a time (WaysResting): when that is, for the
  // stall's question to offer other work until then; and once Jev has
  // chosen that, the same rest met again goes back to that work, not to the
  // question (note 490).
  const until = err.name === 'WaysResting' && err.until > Date.now() ? err.until : 0;
  const held = until && goal.restHeld?.until === until ? goal.restHeld : null;
  // The answer this step was carrying out: asked again, not the step. Not
  // where the step's route is set aside from here: going up to the question
  // that held its answer and asked nothing, the step ran again at once, four
  // times a second (25589, note 775); the stall's question is asked instead.
  const owner = !until && !route?.aside && tried.owner(goal, { work, skip: new Set(['stillness_detour', 'rung_progress']) });
  const what = `the ${String(failed?.action || 'step').replaceAll('_', ' ')} step failed${goal.struggles === 1 ? '' : ` ${goal.struggles} times running`}: ${String(err.message).slice(0, 160)}${err.facts ? ` (${err.facts})` : ''}`;
  const up = owner ? tried.escalate(goal, { from: 'step', to: owner.q, why: what, parentOf: require('./decisions').parentOf, here: bot.entity?.position }) : null;
  if (owner) tried.markBlocked(owner, what);
  const chose = {};
  try {
    if (up?.to && up.to !== 'rung_progress' && up.to !== 'stillness_detour') {
      console.log(`[escalate] step -> ${up.to.replaceAll('_', ' ')}: ${up.says}`);
      return;
    }
    const rungAsk = up?.to === 'rung_progress' ? { escalated: { from: owner.q, to: 'rung_progress', says: up.says, passed: up.passed } } : {};
    if (held) await holdForRest(bot, task, goal, save, { client, survival, onStep, reason: held.reason || key, until, why: err.message, above: stallAbove(goal), idle: held.idle === true });
    else await answerStall(bot, task, goal, save, { key, work, layer: 'work', strikes: goal.struggles, error: route?.aside ? `${err.message}; ${route.says}` : err.message, ...(route?.aside ? { routeAside: route.aside } : {}), ...(until ? { until } : {}), ...rungAsk }, { client, survival, onStep, failed, chose, recoveryAdviser });
  }
  finally {
    // Back in hand only when Jev chose to try it again, and not where it
    // cannot be done: a step for another dimension is left for the ladder
    // to plan again (note 433).
    const home = failed?.block ? require('./knowledge').dimensionOfBlock(failed.block) : null;
    const here = String(bot.game?.dimension || 'overworld').replace('minecraft:', '').replace('the_', '');
    if (goal.step?.action === 'persist') {
      if (chose.again && !(home && home !== here)) goal.step = failed;
      else { delete goal.step; delete goal.lastStruggleStep; }
    }
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
  // Blocks the binding limit of the ways on (block-stock.js blocksShortNow,
  // note 751d): the crossing's material is not thrown for room.
  const short = require('./block-stock').blocksShortNow(goal) ? ['netherrack', 'blackstone', 'basalt', 'cobblestone', 'cobbled_deepslate'] : [];
  return new Set([...short, goal.item, goal.step?.item, goal.step?.from, goal.step?.block, goal.step?.drops, goal.smelting?.from,
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
  if (!crowded(bot) || !tidyMoment(bot)) return;
  const heading = goal.step?.destination || goal.step?.target || goal.tunnel?.target;
  // What the ladder's next rung takes is kept too, as the room question
  // keeps it (note 780): a budget or a no-rung cap never drops it.
  const tidy = require('./inventory-tidy');
  const wanted = [...wantedItems(goal), ...tidy.rungNeeds(bot, goal)];
  const ctx = tidy.tidyContext(bot, goal);
  const dropped = await tidyInventory(bot, task, { away: heading && Number.isFinite(heading.x) ? heading : null, keep: new Set(wanted), ctx });
  if (dropped.length) {
    // Tunnelling refills the stone every few minutes; say so now and then,
    // not at every stack.
    const quiet = goal.tidied && Date.now() - Date.parse(goal.tidied.at) < 600000;
    goal.tidied = { at: new Date().toISOString(), dropped };
    if (!quiet) bot.chat?.(`My pockets are full, so I'm leaving ${dropped.map(d => `${d.count} ${d.name.replaceAll('_', ' ')}${d.why ? ` (${d.why})` : ''}`).join(', ')} here.`);
  }
}

// A safe moment to tidy (note 780): standing, out of water and lava, with no
// threat in sight within eight blocks. A toss faces away and throws; mid-fall
// or mid-fight that is time the body's own answers want.
function tidyMoment(bot) {
  const e = bot.entity;
  if (!e) return true;
  if (e.onGround === false || e.isInWater || e.isInLava) return false;
  try { return !require('./danger').threats(bot, 8).some(t => t.visible); } catch (_) { return true; }
}


// An escalation to a question a step asks (a way's, a plan's): the step's
// own pass asks it, with the failure below said (tried.js escalationsFor).
// The stall's question and the rung's are asked by answerStall.
const escalatedToStep = stall => !!stall?.escalated?.to && !['rung_progress', 'stillness_detour'].includes(stall.escalated.to);

// A handler that runs inside the loop's catch must not throw past it: an
// exception there leaves runGoal, and the session marks the request blocked
// with "say resume". Moving on from a resource ended the dream run that way
// when its exploration step found no dry route. A failed handler is a
// failed step, and the loop's own persistence deals with it.
// The loop's own check, where a caught error is being handled: a watchdog's
// signal held for the survival layer (air, a threat) or a stall is the
// loop's to answer on its next turn, not a reason to leave the loop. Thrown
// from the check in the catch, trial 32's held threat signal ended the goal
// as "stuck" at 01:19, and the bot stood still until the trial was over.
// A cancellation still ends it.
function loopCheck(task) {
  try { task.check(); return null; }
  catch (err) { if (['NeedsAir', 'NeedsSafety', 'Stalled'].includes(err.name)) return err; throw err; }
}

async function inCatch(task, goal, fn) {
  try { return await fn(); }
  catch (err) {
    // A stall raised meanwhile is the loop's to answer, next tick.
    if (err.name === 'Stalled') return true;
    if (loopCheck(task)) return true;
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
  // What a craft leaves for the next pickaxe (the decision audit, from
  // mid-87-a): sticks spent on a sword are sticks a pickaxe cannot have.
  const leaves = outputs => { try { return pickaxeLeft(bot, require('./strategy').planSpends(catalogPlan(bot, outputs, null, stock, goal) || [])); } catch (_) { return ''; } };
  if (missing.length) options.stone_tools = { description: `Make ${missing.map(t => t.replaceAll('_', ' ')).join(', ')}: faster digging and a real weapon, from cobblestone and sticks.${leaves(missing.map(item => ({ item, count: 1 })))}`, item: missing[0], count: 1 };
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
      options.explore = { description: `Explore: walk to the nearest unexplored area (${target.fromHere} blocks away) and see what is there. Known so far: ${summaryText(known)}. Villages mean beds, food and trades; a ruined portal or a surface lava pool means obsidian; dungeons, mineshafts and temples mean chests.${tripTime(bot, target.fromHere)}`,
        walkBlocks: target.fromHere, run: (b, t, g, sv) => exploreStep(b, t, g, sv, { navigate, home, noticeVillage }) };
    }
  }
  const sides = sideTrips(bot, goal);
  if (sides.loot) options.loot = sides.loot;
  if (sides.trade) options.trade = sides.trade;
  for (const key of ['deep_dark', 'trial_chambers', 'fetch_cache', 'tame_wolf', 'breed_sheep', 'breed_chickens']) if (sides[key]) options[key] = sides[key];
  for (const key of Object.keys(sides).filter(k => k.startsWith('travel_'))) options[key] = sides[key];
  if (sides.cache_valuables) options.cache_valuables = sides.cache_valuables;
  // Experience for enchanting: the ingots taken out of a furnace give it,
  // and the raw ore is carried and stashed by the stack. Only while there is
  // gear to enchant and the level is under thirty, so it is never ground for
  // its own sake.
  // Not copper (note 771b): its ingots are nothing the run makes (the
  // tidy drops them first), and 25590 smelted 13 at 03:14:25Z, 2026-10-01,
  // inside another batch's hold. And no smelt for experience while a batch
  // of the bot's own cooks and it was left to do other work: it took the
  // furnaces the batch was in.
  const RAW_ORE = { raw_iron: 'iron_ingot', raw_gold: 'gold_ingot' };
  const rawOre = Object.keys(RAW_ORE).map(name => [name, countOf(bot, name)]).filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1])[0];
  if (rawOre && !(bot._cookHold?.until > Date.now()) && (bot.experience?.level ?? 0) < 30 && enchantable(bot).length) options.earn_xp = { description: `Earn experience for enchanting: smelt ${Math.min(rawOre[1], 32)} of the ${rawOre[1]} ${rawOre[0].replaceAll('_', ' ')} carried (level ${bot.experience?.level ?? 0} now; each level is a better enchant). The ingots are useful too.`,
    item: RAW_ORE[rawOre[0]], count: countOf(bot, RAW_ORE[rawOre[0]]) + Math.min(rawOre[1], 32) };
  if (sides.enchant) options.enchant = sides.enchant;
  if (stock.coal > 0 && (stock.torch || 0) < 8) options.torches = { description: `Craft torches from the ${stock.coal} coal being carried; light keeps mobs from spawning at home.${leaves([{ item: 'torch', count: 4 }])}`, item: 'torch', count: 4 };
  // The standing dream. With nothing asked and nothing urgent, the next
  // rung of the beat-the-game ladder is on offer; it is a long walk from a
  // stone pickaxe to a dragon, and this is how the walk gets taken. Only
  // when that is the dream: a dream is something a player gives Jev, and
  // without one the ladder was still offered every idle minute.
  if (bot.game.gameMode === 'survival' && goal.dream === 'beat_the_game') {
    const stage = nextGameStage(bot, goal);
    if (stage.phase !== 'complete') options.long_game = { description: `Work toward beating the game. The next stage is ${stage.phase.replaceAll('_', ' ')}${stage.item ? ` (${stage.count} ${stage.item.replaceAll('_', ' ')})` : ''}; it may mean a long trip and a real fight, so choose it with supplies, tools and daylight in hand.`, phase: stage.phase, stage };
  }
  // Each craft said with what its chain lacks from the pockets, and no walk
  // offered from a cell no walk leaves (option-feasibility.js, note 754).
  return require('./option-feasibility').screenOffers(bot, goal, options, { withheld: sides.withheld });
}

// The trips worth making from wherever the bot is, each already checked
// feasible: shared by idle work and the strategy on the way to the dragon.
// Swimming on purpose: headed somewhere more than sixteen blocks off in the
// last twenty seconds, the head above water and the air full. The shore
// rule leaves such a swim alone; trial 94 swam for the sheep on the next
// island and was pulled back to the shore it left, three times in ninety
// seconds, the rule taking the nearest dry ground each time the walk paused.
function crossingWater(bot, now = Date.now()) {
  const h = bot._heading, p = bot.entity?.position;
  if (!h || !p || now - h.at > 20000 || Math.hypot(h.x - p.x, h.z - p.z) <= 16) return false;
  if ((bot.oxygenLevel ?? 20) < 20) return false;
  try { return !require('./vitals').headSubmerged(bot); } catch (_) { return false; }
}

// A trip's walk against the daylight left, said with it (the decision
// audit, 2026-09-25): the loot, trade, explore and cache trips said how far
// and nothing of whether the day would last.
// Blocks of rock and ground between the bot and open sky (surface.js), or 0.
function underSky(bot) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return 0;
  try { return require('./surface').climbToSurface(bot, bot.entity.position) ?? 0; } catch (_) { return 0; }
}
function tripTime(bot, blocks) {
  if (!Number.isFinite(blocks)) return '';
  const there = Math.round(blocks * 2 / 4.3), t = bot.time?.timeOfDay ?? 0;
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return ` About ${there} seconds there and back at a walk.`;
  // Underground the sky's clock is not the trip's: 25589, 105 blocks under
  // open sky with no pickaxe, was told "326 seconds of daylight left" with a
  // walk to a river on the surface (note 754). The climb to the sky is said
  // instead, at the pace the pockets give.
  const up = underSky(bot);
  if (up >= 8) {
    const pick = bot.inventory?.items?.().some(i => /_pickaxe$/.test(i.name));
    const climb = pick ? `about ${require('./surface').climbMinutes(up)} minutes by staircase with a pickaxe` : `about ${require('./hand-dig').handPace(bot).minutesUp(up)} minutes by staircase by hand (${require('./hand-dig').handPaceSays(bot)})`;
    return ` About ${there} seconds there and back at a walk where the way is open; the bot is about ${up} blocks under open sky, and a way that leads up there climbs that first: ${climb}.`;
  }
  // At night the trip is in the dark from the first step, and says so.
  if (t >= DAY.DUSK && t < DAY.DAWN) return ` About ${there} seconds there and back at a walk, all of it in the dark: it is night, and mobs spawn about the bot for about ${Math.round((DAY.DAWN - t) / 1200)} real minutes more.`;
  const light = Math.max(0, Math.round((DAY.DUSK - t) / 20));
  return ` About ${there} seconds there and back at a walk; ${light} seconds of daylight left${there > light ? ': it would end after dusk' : ''}.`;
}

// What waits at a place now: the mobs within sixteen blocks of it, seen or
// heard, and what fighting them all costs with what is carried and worn.
// first-days-225 went to loot a dungeon told only that its spawner keeps
// making mobs, with four zombies and a skeleton about it, no armour, and
// died among them in eight seconds (2026-09-26).
function waitingThere(bot, at) {
  try {
    const { threats } = require('./danger'), { shooter, defenseWeapon } = require('./combat'), { fightEstimate } = require('./combat-estimate');
    const there = threats(bot, 64).filter(t => t.entity.position && t.entity.position.distanceTo(at) <= 16);
    if (!there.length) return ' Within sixteen blocks of it now: nothing hostile known.';
    const kinds = Object.entries(there.reduce((n, t) => ({ ...n, [t.entity.name]: (n[t.entity.name] || 0) + 1 }), {})).map(([k, n]) => `${n} ${k.replaceAll('_', ' ')}${n > 1 ? 's' : ''}`);
    const fight = fightEstimate({ threats: there.slice(0, 8).map(t => ({ name: t.entity.name, distance: t.entity.position.distanceTo(at), shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: true })),
      armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health ?? 20, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
    return ` Within sixteen blocks of it now: ${kinds.join(', ')}; fighting them all there is about ${fight.damageTaken} damage from ${Math.round(bot.health ?? 20)} health${fight.healthAfter <= 0 ? ' (more than the bot has)' : ''}.`;
  } catch (_) { return ''; }
}

// What the ladder's next step takes of the ore, against the batch: 25585
// (mid-239-ba, 12:32Z) fired a furnace for 56 iron ingots, three and a half
// minutes of waiting, with the next rung needing 3 and a lava pool known
// (note 754).
function smeltNeedSays(bot, goal, raw) {
  if (goal?.kind !== 'win') return '';
  try {
    const stage = require('./game-progress').nextGameStage(bot, goal);
    if (!stage || stage.phase === 'complete') return '';
    const plan = stage.item ? catalogPlan(bot, stage.item, stage.count || 1, planningInventory(bot), goal) || [] : [];
    const spends = require('./strategy').planSpends(plan);
    const need = (spends.raw_iron || 0) + (spends.raw_gold || 0);
    const name = String(stage.phase).replaceAll('_', ' ');
    if (!need) return ` The ladder's next step (${name}) smelts none of it: the whole batch, about ${Math.round(raw * 10 / 6) / 10} minutes at one furnace, is stock for later.`;
    return ` The ladder's next step (${name}) smelts ${need} of it: about ${need * 10} seconds for just those; the rest of the batch is stock for later.`;
  } catch (_) { return ''; }
}
function sideTrips(bot, goal, client) {
  const trips = {};
  // Looting: the nearest remembered ruined portal, dungeon or temple whose
  // chests have not been opened.
  const unlooted = unlootedLandmarks(bot, goal)[0];
  // Underground, a dungeon's spawner and a mineshaft's cave spiders are
  // said (the decision audit).
  const below = unlooted && ['dungeon', 'mineshaft'].includes(unlooted.landmark.kind) ? ` It is underground at y ${Math.round(unlooted.landmark.y ?? bot.entity.position.y)}${unlooted.landmark.kind === 'dungeon' ? ', and its spawner keeps making mobs until it is broken or lit' : ', and a cave spider spawner is common in one'}.` : '';
  if (unlooted) trips.loot = { description: `Loot: walk ${unlooted.distance} blocks to the ${unlooted.landmark.kind.replaceAll('_', ' ')} and open its chests. Ruined portals hold gold, obsidian and flint and steel; dungeons and temples iron, gold, bread and now and then diamonds; a mineshaft's chests ride in minecarts, with rails, iron, gold and bread, and its cobwebs are string.${below}${waitingThere(bot, new Vec3(unlooted.landmark.x, unlooted.landmark.y ?? bot.entity.position.y, unlooted.landmark.z))}${tripTime(bot, unlooted.distance)}`,
    says: `I'll loot the ${unlooted.landmark.kind.replaceAll('_', ' ')} ${unlooted.distance} blocks away`, walkBlocks: unlooted.distance,
    run: (b, t, g, sv) => lootStep(b, t, g, sv, lootActions()) };
  // The base's bed taken along, with what it buys and what it moves: the
  // user's call (2026-09-26), after the scoreboard put nights at over a
  // third of the time before the Nether.
  const hb = require('./home-base'), home = hb.homeOf(bot, goal);
  // Only a bed that stands there, or one out of sight to say otherwise:
  // mid-244-b was offered its base's bed with none there, chose it, and
  // found nothing five times over (2026-09-26).
  const standing = home?.bed ? hb.bedStatus(bot, home) : null;
  if (home?.bed?.claimedAt && standing && (standing.placed || !standing.loaded) && !hb.bedCarried(bot) && !home.bed.carriedAt && /overworld/.test(String(bot.game?.dimension || ''))) {
    const foot = hb.layout(home).bed.foot, far = Math.round(new Vec3(foot.x, foot.y, foot.z).distanceTo(bot.entity.position));
    trips.take_home_bed = { description: `Take the base's bed along: walk ${far} blocks to it, pick it up and carry it. Then a night on the Overworld passes in seconds wherever it comes: put down in a nook or on open ground, slept in, picked back up. Sleep is refused with a monster within about eight blocks of the bed, and in the Nether or the End a bed set down explodes. The spawn point is wherever the bot last slept: a death sends it there, not to the base, and a death drops the bed with everything else.${tripTime(bot, far)}`,
      says: 'I\'ll take my bed along', walkBlocks: far,
      run: async (b, t, g, sv) => { for (let i = 0; i < 4; i++) if (await hb.takeHomeBed(b, t, g, sv, { navigate, dig, collectNearbyDrops })) return; } };
  }
  // Trading: a village remembered and something to sell or spend (trading.js).
  if (tradeWorthwhile(bot, goal)) {
    const village = require('./villages').knownVillages(bot, goal, 256)[0];
    trips.trade = { description: `Trade at the remembered village${village ? ` ${village.distance} blocks away` : ''}: read the villagers' offers, sell spare coal, sticks, wheat and the like for emeralds, and buy what the run needs (ender pearls, arrows, a bow, better armour or tools, food).${tripTime(bot, village?.distance)}`,
      says: 'I\'ll go trade at the village', walkBlocks: village?.distance,
      run: (b, t, g, sv) => tradeStep(b, t, g, sv, { navigate, decide, client: client || t.opportunityClient }) };
  }
  // The raw ore carried, smelted all at once: mid-87-a carried eighty-four
  // raw iron and a hundred and sixty coal for over an hour, smelted three
  // at a time for whatever the next rung asked, and had no ingots each time
  // a pickaxe broke underground (the decision audit, 2026-09-25). Offered
  // with what it takes and gives; any time of day, a furnace being shelter
  // enough for the minutes it takes.
  const rawIron = countOf(bot, 'raw_iron'), rawGold = countOf(bot, 'raw_gold'), raw = rawIron + rawGold;
  // Not while a batch of the bot's own cooks and it was left to do other
  // work meanwhile (note 771b: 25590's hold took a second and a third batch).
  const smeltFuel = raw >= 8 && !(bot._cookHold?.until > Date.now()) ? CARRIED_FUELS.find(n => isFuel(n) && countOf(bot, n) >= fuelUnits(n, raw)) : null;
  if (smeltFuel) {
    const furnaces = raw >= 16 ? Math.min(3, Math.floor(raw / 8)) : 1;
    const minutes = Math.round(raw * 10 / furnaces / 6) / 10;
    const uses = i => (bot.registry?.itemsByName?.[i.name]?.maxDurability ?? 0) - (i.durabilityUsed || 0);
    const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `the ${i.name.replaceAll('_', ' ')} (${uses(i)} uses left)`);
    const list = [rawIron && `${rawIron} raw iron`, rawGold && `${rawGold} raw gold`].filter(Boolean).join(' and ');
    trips.smelt_stock = { description: `Smelt the raw ore carried into ingots now: ${list}, with the ${smeltFuel.replaceAll('_', ' ')} carried, at the nearest furnace${furnaces > 1 ? ` and ${furnaces - 1} more set beside it` : ''}: about ${minutes} minutes at ten seconds an item${furnaces > 1 ? ` shared across ${furnaces} furnaces` : ''}. Iron ingots are three a pickaxe, one a shield, three a bucket, twenty-four a set of armour; gold is four for golden boots. Raw ore and ingots drop alike on a death. Now: ${countOf(bot, 'iron_ingot')} iron ingots in hand; pickaxes carried: ${picks.join(', ') || 'none'}.${smeltNeedSays(bot, goal, raw)}`,
      says: "I'll smelt the ore I'm carrying", anyTime: true,
      run: async (b, t, g, sv) => {
        if (countOf(b, 'raw_iron')) await acquireStep(b, t, 'iron_ingot', countOf(b, 'iron_ingot') + countOf(b, 'raw_iron'), g, sv);
        if (countOf(b, 'raw_gold')) await acquireStep(b, t, 'gold_ingot', countOf(b, 'gold_ingot') + countOf(b, 'raw_gold'), g, sv);
      } };
  }
  // Enchanting: a table carried, in view or remembered, lapis in hand, five
  // levels or more, and gear still plain (enchanting.js).
  // The bold trips underground, packed light (deep-dark.js, trip-kit.js):
  // an ancient city in the deep dark, and the trial chambers' vaults.
  const expeditions = require('./deep-dark');
  const tripActions = { dig, navigate, place, acquireStep, tunnel: tunnelStep,
    loot: (b2, t2, g2, sv2) => lootNearby(b2, t2, g2, sv2, lootActions()),
    notice: (b2, g2, sv2) => noticeLandmarks(b2, g2, sv2, { force: true }) };
  for (const [kind, says] of [['deep_dark', "I'll go looking for an ancient city in the deep dark"], ['trial_chambers', "I'll go looking for trial chambers"]]) {
    if (expeditions.expeditionReady(bot, goal, kind)) trips[kind] = { description: expeditions.describe(goal, kind, bot), says,
      run: (b, t, g, sv) => expeditions.expeditionTrip(b, t, g, sv, tripActions, kind) };
  }
  // The surface, walked for what it has: villages, temples, portals.
  if (/overworld/.test(String(bot.game?.dimension || ''))) {
    const home = goal.survival?.home?.origin;
    const target = unexploredArea(bot, goal, { home });
    if (target) trips.explore = { description: `Explore: walk to the nearest unexplored area (${target.fromHere} blocks away) and see what is there. Known so far: ${summaryText(explorationSummary(goal))}. Villages mean beds, food and trades; temples, shipwrecks and ruined portals mean chests.${tripTime(bot, target.fromHere)}`,
      says: "I'll go exploring", walkBlocks: target.fromHere, run: (b, t, g, sv) => exploreStep(b, t, g, sv, { navigate, home, noticeVillage }) };
  }
  // Another biome in view, with what it holds (biomes.js): the ground
  // underfoot decides what a step can find, and a desert has no sheep.
  // Underground, a biome is under the bot's feet as much as over it, and a
  // walk "to" it can arrive in the cave beneath (note 749d): 25597 answered
  // travel_river, travel_savanna and the like from 14:55 to 15:03Z about 36
  // blocks under open sky, said "In the river now" by the biome at its feet,
  // and was offered the next biome at once. There the climb is the first leg,
  // said with its cost, and arriving is being on the ground of it.
  const { surfaceObserver, climbToSurface, climbMinutes } = require('./surface');
  const onSurface = b2 => { try { return !/overworld/.test(String(b2.game?.dimension || '')) || surfaceObserver(b2)(b2.entity.position); } catch (_) { return true; } };
  const underfoot = !onSurface(bot);
  let up = null; try { if (underfoot) up = climbToSurface(bot, bot.entity.position); } catch (_) { up = null; }
  const climbSays = underfoot ? ` Underground here (${up != null ? `about ${up} blocks up to open sky, roughly ${climbMinutes(up)} minutes to climb` : 'how far up is not known'}): the climb to the surface is the first leg, and the walk is on the surface after it.` : '';
  for (const b of require('./exploration').biomeTrips(bot)) {
    trips[`travel_${b.biome}`] = { description: `Travel: walk to ${b.says} and carry on from there.${climbSays}${tripTime(bot, b.distance)}`,
      says: `I'll head to the ${b.biome.replaceAll('_', ' ')} to the ${b.direction}`, walkBlocks: b.distance,
      run: async (b2, t, g, sv) => {
        if (!onSurface(b2)) {
          b2.chat?.(`Climbing out first, for the ${b.biome.replaceAll('_', ' ')}.`);
          await surfaceTrip(b2, t, g || goal, sv || (() => {}), `the ${b.biome.replaceAll('_', ' ')}`);
          if (!onSurface(b2)) return;
        }
        await navigate(b2, t, new goals.GoalNearXZ(b.x, b.z, 8), { timeoutMs: Math.max(60000, b.distance * 500), stallMs: 8000, sprint: true });
        if (!onSurface(b2)) throw new Error(`The walk to the ${b.biome.replaceAll('_', ' ')} ended under it, not on it`);
        b2.chat?.(`In the ${b.biome.replaceAll('_', ' ')} now.`);
      } };
  }
  // Copper armour before the iron, where nothing is worn yet (2026's copper
  // age): the copper a cave shows makes a set of ten armour points, a zombie's
  // three down to two, for the half hour before the iron armour. Most of the
  // deaths before the iron were with nothing on (trials 65, 70, 90). Offered,
  // not ruled: what it takes is said, and the iron armour replaces it when
  // made (mob-policy.js wears the best carried).
  const wornAny = [5, 6, 7, 8].some(slot => bot.inventory.slots?.[slot]);
  const carriedArmour = bot.inventory.items().some(i => /_(helmet|chestplate|leggings|boots)$/.test(i.name));
  const pick = bot.inventory.items().find(i => /^(stone|copper|iron|diamond|netherite)_pickaxe$/.test(i.name));
  if (/overworld/.test(String(bot.game?.dimension || '')) && !wornAny && !carriedArmour && pick) {
    const pieces = ['copper_helmet', 'copper_chestplate', 'copper_leggings', 'copper_boots'];
    const ingots = countOf(bot, 'copper_ingot'), raw = countOf(bot, 'raw_copper');
    const seen = find(bot, ['copper_ore', 'deepslate_copper_ore'], 32, 1)[0];
    trips.copper_armour = { description: `Copper armour first: a helmet, chestplate, leggings and boots, twenty-four copper ingots (${ingots} carried, ${raw} raw copper)${seen ? `, copper ore in view ${Math.round(seen.distanceTo(bot.entity.position))} blocks off` : ', no copper ore in view'}; copper ore gives two to five raw copper a block. Worn, ten armour points: a zombie's hit of three comes down to two, a skeleton's arrow of four to under three, until the iron armour (fifteen points) replaces it. Nothing is worn now.`,
      says: "I'll make copper armour first", run: async (b, t, g, sv) => { await acquireSetStep(b, t, pieces.filter(item => !countOf(b, item)), g, sv); await require('./mob-policy').wearBestArmour(b); } };
  }
  // A chest here for the valuables, before whatever comes next: home's
  // chest out of reach, and a death would drop them (field-cache.js).
  const cache = require('./field-cache').cacheOffer(bot, goal);
  if (cache) trips.cache_valuables = { description: `Put ${cache.chest} down here and leave the valuables in it (${cache.what}): home's chest is out of reach, and a death on what comes next would drop them. They are taken back passing by.${pickaxeLeft(bot, cache.spends)}`,
    says: "I'll leave my valuables in a chest here", run: (b, t, g, sv) => require('./field-cache').cacheValuables(b, t, g, sv, homeActions(), { reason: 'what comes next' }) };
  // Animals: a wolf tamed with bones, sheep and chickens bred in the field
  // (wolves.js, breeding.js).
  const wolves = require('./wolves'), breeding = require('./breeding');
  if (wolves.tameReady(bot, goal)) trips.tame_wolf = { description: wolves.tameSays(bot, goal, { walk: blocks => tripTime(bot, Math.round(blocks)) }),
    says: "I'll tame that wolf", run: (b, t, g, sv) => wolves.tameWolf(b, t, g, sv, { navigate }) };
  // What a bred animal is worth, in the game's terms: a calf or a lamb is
  // grown in twenty real minutes; a grown cow is one to three beef (eight
  // hunger a steak once cooked), a sheep one to two mutton (six cooked) and
  // a wool.
  if (breeding.breedReady(bot, goal, 'cow')) trips.breed_cows_here = { description: `Breed two of the ${breeding.adults(bot, 'cow').length} cows in view with two of the ${countOf(bot, 'wheat')} wheat carried: the calf is grown in about twenty real minutes, and a grown cow is one to three beef, eight hunger a steak once cooked, and leather. Food carried now: ${require('./foraging').foodSupply(bot)} points.`,
    says: "I'll breed these cows", run: (b, t, g, sv) => breeding.breedNearby(b, t, g, sv, 'cow', { navigate }) };
  if (breeding.breedReady(bot, goal, 'sheep')) trips.breed_sheep = { description: 'Breed the two sheep in view with two wheat: the lamb is grown in about twenty real minutes, a wool a shearing (three from killing) for the next bed, and one to two mutton, six hunger a piece cooked.',
    says: "I'll breed these sheep", run: (b, t, g, sv) => breeding.breedNearby(b, t, g, sv, 'sheep', { navigate }) };
  // Never beside a food search: chickens are never hurt, so breeding them
  // is never for food, and offered while the Nether food kit is short or
  // being worked (goal.stockFood) it reads as a food answer that is not
  // one (mid-242-tf, note 728). Held back there; offered any other time.
  const seekingNetherFood = !!goal.stockFood || (goal.kind === 'win' && /overworld/.test(String(bot.game?.dimension || 'overworld')) &&
    (() => { try { return foodSupply(bot) < require('./crossing-kit').netherStay(bot, goal).points; } catch (_) { return false; } })());
  if (breeding.breedReady(bot, goal, 'chicken') && !seekingNetherFood) trips.breed_chickens = { description: 'Breed the two chickens in view with two seeds: more chickens near here are feathers for arrows.',
    says: "I'll breed these chickens", run: (b, t, g, sv) => breeding.breedNearby(b, t, g, sv, 'chicken', { navigate }) };
  // A cache from an earlier trip, far enough off that passing will not
  // bring it back: fetch it.
  const cached = require('./field-cache').nearCache(bot, goal, 512);
  if (cached && cached.distance > 48) trips.fetch_cache = { description: `Walk ${Math.round(cached.distance)} blocks back to the chest left before an earlier trip and take its things back (${Object.entries(cached.cache.contents).filter(([, n]) => n > 0).slice(0, 5).map(([k, n]) => `${n} ${k.replaceAll('_', ' ')}`).join(', ')}).${tripTime(bot, Math.round(cached.distance))}`,
    says: "I'll fetch my things from the chest I left", walkBlocks: Math.round(cached.distance), run: (b, t, g, sv) => require('./field-cache').emptyCache(b, t, g, sv, homeActions(), cached.cache) };
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
    trips.enchanting_table = { description: `Make an enchanting table: the two diamonds carried, four obsidian and a book from leather and paper, then enchant the ${enchantable(bot)[0].item.name.replaceAll('_', ' ')} with the ${bot.experience?.level} levels and ${countOf(bot, 'lapis_lazuli')} lapis carried.${
      // What the table takes from the pockets as they are, as a rung says
      // it (the decision audit, 2026-09-25): the book alone is a cow hunt
      // and three sugar cane.
      rungTakes(bot, goal, { item: 'enchanting_table', count: 1 }, (b, item, count, g) => catalogPlan(b, item, count, planningInventory(b), g))}`,
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
  // No walk offered from a cell no walk leaves (note 754).
  return require('./option-feasibility').screenOffers(bot, goal, trips);
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
// The work that can be done from here while a stall or a rest is waited
// out: the night mine, the Overworld's day work, ore a carried tool takes,
// a look around by day, and, while a rest is held, what upkeep has on
// offer (blocks, stems, a pickaxe). With `preview` nothing is run or kept:
// what the hold would offer, said on the question that chooses it (note
// 675). `resting` leaves out a detour resting.
const UPKEEP_WORK = ['make_pickaxe', 'fetch_stems', 'spare_pickaxe', 'wood_reserve', 'block_reserve'];
// The portal rung's own work, as detours (detourWork): in the Overworld
// while the ladder is on reach_nether, with no lit portal about. A frame
// begun more than sixteen blocks off: back to it. Otherwise the nearest
// known lava pool (not spent, its way not resting, within 128 blocks), to
// cast beside or fetch the cast's buckets from. Each said with its distance,
// the height and the time, and what it is for.
function portalJobs(bot, goal, { routeKinds = noneGoodTopped(bot) } = {}) {
  try {
    if (dimension(bot) !== 'overworld' || !bot.entity?.position) return [];
    if ((goal.rungTime?.phase || goal.gameProgress?.phase) !== 'reach_nether') return [];
    if (typeof bot.findBlocks === 'function' && lowestPortalBlock(bot)) return [];
    const here = bot.entity.position, jobs = [];
    const walkSays = at => { const d = Math.round(here.distanceTo(at)), dy = Math.round(at.y - here.y), s = Math.round(d / 4.3 + (Math.abs(dy) > 8 ? Math.abs(dy) * 3 : 0));
      return `${d} blocks off${dy <= -4 ? `, ${-dy} down` : dy >= 4 ? `, ${dy} up` : ''}, about ${s < 120 ? `${Math.max(5, s)} seconds` : `${Math.round(s / 60)} minutes`}`; };
    const frame = goal.portalFrame && !goal.portalFrame.ruin ? goal.portalFrame : null;
    if (frame) {
      const o = pos(frame.origin);
      // Not while the cast rests at its frame (note 763): "the cast goes on
      // there" was a walk out and back to a step resting, nine times on
      // 25583 (mid-242-ai, 19:40-19:49Z).
      const castRests = () => {
        if (require('./flip-pairs').restingWith(goal, 'cast_portal', o)) return true;
        try { const tried = require('./tried'); return !!tried.restsUntil(tried.about(goal, { q: 'step', method: 'cast_portal', here: o, now: Date.now() }), Date.now()); } catch (_) { return false; }
      };
      if (here.distanceTo(o) > 16 && !castRests()) {
        const placed = frame.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length;
        jobs.push({ key: 'to_portal_frame', target: { x: o.x, y: o.y, z: o.z }, description: `The portal's own work: go back to the portal frame begun at (${o.x}, ${o.y}, ${o.z}), ${walkSays(o)}${frame.placedSeen !== undefined || placed ? `, ${placed || frame.placedSeen || 0} of ten standing` : ''}; the cast goes on there.`,
          run: (t, save) => navigate(bot, t, new goals.GoalNear(o.x, o.y, o.z, 3), { timeoutMs: 120000, stallMs: 8000, sprint: true }) });
      }
    }
    const { lavaResting } = require('./tunneling');
    const { lavaRecord } = require('./obsidian');
    const open = k => !require('./obsidian').poolSpent(k.landmark) && !lavaResting(goal, new Vec3(k.landmark.x, k.landmark.y ?? here.y, k.landmark.z));
    const known = require('./exploration').knownLandmarks(bot, goal, 'lava_pool', 256);
    const pools = known.filter(open).filter(k => k.distance > 12);
    // The portal plan held, asked again with this stall said as its route's
    // failure (note 782): the route is the plan's to change, priced against
    // the others, not a detour to another pool taken here. Before the plan,
    // to_known_lava, to_other_lava, dig_to_lava and cast_at_pool each went to
    // other lava from the stall: 244 stall answers chose a portal route on
    // 172 portal rungs (2026-09-30T17:00Z to 2026-10-01T04:58Z).
    const m = goal.portalMethod;
    if (m?.facts && !m.routeFailed) {
      const route = m.kind === 'build' ? 'a frame of obsidian' : m.kind === 'ruin' ? 'a ruined portal finished' : `a frame cast ${m.near ? 'beside its lava' : 'here'}, its lava ${m.lava?.way === 'deep' ? 'from the lava layer' : m.lava?.at ? `at (${m.lava.at.x}, ${m.lava.at.y}, ${m.lava.at.z})` : 'the nearest'}`;
      const step = String(goal.step?.action || 'the work').replaceAll('_', ' ');
      const failed = goal.lastFailure && Date.now() - goal.lastFailure.at < 120000 ? goal.lastFailure.why : null;
      jobs.push({ key: 'replan_portal', description: `The portal's own plan: ask it again, this stall on ${step}${failed ? ` ("${failed.slice(0, 120)}")` : ''} said as its route's failure. The route held: ${route}, ${Math.round((m.activeMs || 0) / 60000)} of its stated ${m.minutes ?? '?'} minutes worked. Each route is then priced afresh, this one with the stall in its record.`,
        run: async (t, save) => { require('./portal-plan').planFailed(goal, `a stall on ${step}${failed ? `: ${failed.slice(0, 120)}` : ''}`); save(); } });
    }
    // None good on top at the last stall question here: a different kind of
    // route, each with its target's record (the reviewer's rule of the
    // check-in of 23:39Z on 2026-09-30, problem 1: seven of nine loop
    // verdicts since 20:00Z were the lava fetch and the portal, and Jev
    // answered none_good at 0.58-0.70 at these stalls; note 767): another
    // pool, the frame cast down beside a pool, or a search for lava on the
    // surface.
    if (routeKinds) {
      const spent = known.filter(k => require('./obsidian').poolSpent(k.landmark)).length, resting = known.filter(k => !require('./obsidian').poolSpent(k.landmark) && !open(k)).length;
      // Each pool known named, with its record (note 767e).
      const named = known.slice(0, 3).map(k => `(${k.landmark.x}, ${k.landmark.y ?? '?'}, ${k.landmark.z}), ${k.distance} blocks off${lavaRecord(goal, k.landmark, here).replace(/^ Its record:/, ':') || ''}`).join('; ');
      jobs.push({ key: 'search_lava', description: `Another route for the portal's lava: search the surface for another lava pool, walking to ground not yet explored. ${known.length ? `${known.length} pool${known.length === 1 ? '' : 's'} known within 256 blocks: ${spent} found spent, ${resting} whose way rests, ${pools.length} open: ${named}` : 'No lava pool known within 256 blocks'}; pools lie on the surface in most places, and any found is then asked about.`,
        run: async (t, save) => { await explore(bot, t, goal, save, 'lava pool', { surfaceOnly: true }); } });
    }
    return jobs;
  } catch (_) { return []; }
}
// None good on top at the last stall question asked in the last ten
// minutes (the stall's and the rung's): the stall's answers lack a real
// route (note 767).
function noneGoodTopped(bot, now = Date.now()) {
  return ['stillness_detour', 'rung_progress'].some(id => { const s = bot?._spells?.[id]; return !!s && s.tops?.at(-1) === true && now - s.last < 600000; });
}

async function detourWork(bot, task, goal, save, { survival = null, bounded = task, scratch = null, holding = false, preview = false, resting = () => false } = {}) {
  scratch ||= { kind: 'survive', request: 'Something useful meanwhile', survival: goal.survival, portals: goal.portals, villages: goal.villages, blueprint: goal.blueprint };
  // The goal the detour serves, for what its questions read of the ladder
  // (note 749e); not saved or recorded with the scratch goal.
  if (!Object.hasOwn(scratch, 'mainGoal')) Object.defineProperty(scratch, 'mainGoal', { value: goal, enumerable: false });
  const out = [];
  const add = (key, description, run, target = null) => { if (!resting(key) && !out.some(w => w.key === key)) out.push({ key, description, run, ...(target ? { target } : {}) }); };
  const overworld = dimension(bot) === 'overworld';
  const dark = overworld && bot.time?.timeOfDay >= DAY.DUSK;
  // The portal's own work first, while the rung is the portal's: the known
  // lava pool to cast from, or the frame begun. 25597 (mid-241-ba,
  // 2026-09-30 13:04:32Z) found a lava pool 30 blocks off just after
  // choosing the Nether first; the rung's step came to a rest, and the
  // detours offered explore, a river, earn_xp and fourteen others, none of
  // them that pool, so it explored, looked around and smelted for
  // experience (note 753b). Run on the player's goal: it is the rung's work.
  for (const job of portalJobs(bot, goal)) add(job.key, job.description, () => job.run(bounded, save), job.target);
  if (survival?.canNightMine?.(goal)) add('night_mine', 'Dig a mine from here for the night: toward ore in the rock, or down and along a branch. Rock around a tunnel is shelter.',
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
  // What is not offered for want of a way out of the cell, said with the
  // question (option-feasibility.js, note 754).
  const feasibility = require('./option-feasibility');
  let withheld = [];
  if (!dark && overworld) {
    const idle = idleOptions(bot, scratch);
    withheld = [...(idle.withheld?.keys || [])];
    for (const [key, option] of Object.entries(idle)) {
      if (key === 'long_game') continue;
      add(key, option.description, () => option.run ? option.run(bot, bounded, scratch, save, homeActions()) : acquireStep(bot, bounded, option.item, option.count, scratch, save));
    }
  }
  // Walled in with no pickaxe, a walk does not leave the cell: the look
  // round is not offered either.
  const walled = overworld ? feasibility.walledIn(bot) : null;
  const walkable = !walled || !!walled.pickaxe;
  if (!walkable) withheld.push('look_around');
  // Ore only where nothing flows beside it: in the Nether the quartz is in
  // the walls of the lava sea.
  // And only ore the bot carries a tool to harvest: dig() refuses it
  // otherwise ("Missing harvest tool"), the way offered comes to nothing and
  // rests five minutes. mid-243-bc, with no pickaxe, was offered the quartz
  // in the wall it stood by at every stall (note 624).
  const harvestable = p => { const b = bot.blockAt(p); return !b?.harvestTools || bot.inventory.items().some(i => b.harvestTools[i.type]); };
  const ore = find(bot, USEFUL_ORES, 16, 8).map(p => ({ p, name: bot.blockAt(p)?.name }))
    .filter(o => o.name && harvestable(o.p) && ![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([x, y, z]) => /lava/.test(bot.blockAt(o.p.offset(x, y, z))?.name || '')))[0];
  // Where the ore is and what is beside it, and what a walk meets (the
  // decision audit, 2026-09-25).
  const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  const oreDy = ore ? ore.p.y - bot.entity.position.floored().y : 0;
  const oreBeside = ore ? `${Math.abs(oreDy) >= 2 ? ` It is ${Math.abs(oreDy)} blocks ${oreDy > 0 ? 'up' : 'down'}.` : ''}${SIDES.some(([x, y, z]) => /^(air|cave_air)$/.test(bot.blockAt(ore.p.offset(x, y, z))?.name || '')) ? ' It is in the wall of an open space: reaching it opens onto whatever is in there.' : ''}${SIDES.some(([x, y, z]) => /water/.test(bot.blockAt(ore.p.offset(x, y, z))?.name || '')) ? ' Water is beside it.' : ''}` : '';
  const sky = bot.blockAt(bot.entity.position.floored())?.skyLight;
  const walkRisk = dark ? ' It is dusk or night: mobs spawn on open ground along the way.' : Number.isFinite(sky) && sky < 8 ? ' Underground: mobs spawn wherever it is dark along the way.' : '';
  if (ore) add('mine_nearby', `Dig the ${ore.name.replaceAll('_', ' ')} ${Math.round(ore.p.distanceTo(bot.entity.position))} blocks away.${oreBeside}`,
    () => dig(bot, bounded, ore.p, {}));
  // A walk to see what is there is an Overworld thing by day; in the Nether
  // twenty-four blocks in a straight line is a walk to the lava sea.
  if (!dark && overworld && walkable) {
    // Kept with the world's survival state, not written onto the player's goal.
    const turn = goal.survival || scratch;
    const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; if (!preview) turn.detourHeading = heading;
    const angle = heading * Math.PI / 4, here = bot.entity.position.floored();
    const target = here.offset(Math.round(Math.cos(angle) * 24), 0, Math.round(Math.sin(angle) * 24));
    add('look_around', `Walk about twenty-four blocks in a direction not tried lately and see what is there: animals, trees, ore in a cliff, a better way on.${walkRisk}`,
      () => navigate(bot, bounded, new goals.GoalNear(target.x, target.y, target.z, 4), { timeoutMs: 45000, stallMs: 8000 }));
  }
  // Nothing else on offer: a walk to new ground, dusk or not, rather than
  // standing where the work stalled. Trial 17, a desert at dusk with no wood
  // and so no tools, had no detour at all and stood a minute (2026-09-24).
  if (!out.length && overworld && walkable) {
    const turn = goal.survival || scratch;
    const heading = ((turn.detourHeading ?? Math.floor(Math.random() * 8)) + 3) % 8; if (!preview) turn.detourHeading = heading;
    const angle = heading * Math.PI / 4, here = bot.entity.position.floored();
    const target = here.offset(Math.round(Math.cos(angle) * 24), 0, Math.round(Math.sin(angle) * 24));
    add('look_around', `Walk about twenty-four blocks in a direction not tried lately: nothing else can be done from here.${walkRisk}`,
      () => navigate(bot, bounded, new goals.GoalNear(target.x, target.y, target.z, 4), { timeoutMs: 45000, stallMs: 8000 }));
  }
  // While a rest is held, what upkeep has on offer from here: in the Nether
  // the hold had nothing else, and 25598 (mid-242-bb-nether-1-fortress-9)
  // stood on a ledge with a pickaxe and no block while every leg of the
  // fortress search had ended "out of blocks (0 carried)", its upkeep
  // answered "carry on" and held five minutes (note 675).
  if (holding && goal.kind === 'win') {
    let offers = {};
    try { offers = (await upkeepOffers(bot, bounded, goal, save)).options; }
    catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; offers = {}; }
    for (const key of UPKEEP_WORK) {
      const o = offers[key];
      if (!o) continue;
      // Netherrack dug by hand drops nothing: with no pickaxe and none to
      // make now, a gather of it is no work (the pickaxe's own ways are).
      if (key === 'block_reserve' && inNetherNow(bot) && pickaxeNeeded(bot) && !offers.make_pickaxe) continue;
      const description = !preview && o.describe ? await o.describe() : o.description;
      add(key, description, o.run);
    }
  }
  if (withheld.length) out.withheld = feasibility.withheldSays(walled || feasibility.walledIn(bot), [...new Set(withheld)].map(key => ({ key })));
  return out;
}
async function breakStillness(bot, task, goal, save, { client, survival, onStep = () => {}, reason = 'step:none', now = Date.now(), answers = {}, stalled = null, until = 0, holding = null, id = 'stillness_detour', above = undefined } = {}) {
  const ms = STALL_MS;
  // Held until a rest ends (holdForRest), the work has that long.
  const deadline = until > now ? until : now + DETOUR_MS;
  const bounded = Object.create(task);
  // A detour answers to threats like any work: one that shows ends it and
  // hands the tick to the survival layer.
  // And to air: a detour to smelt for experience walked into water and
  // stood waiting on its furnace while the air ran out (trial 26).
  bounded.check = () => { task.check(); checkThreats(bot); checkAir(bot); if (Date.now() >= deadline) throw Object.assign(new Error('The detour has had its time'), { name: 'DetourBudget' }); };
  // Its own goal. Run on the player's, a cook cut off at three minutes left
  // a saved furnace batch that the request then had to finish, and search
  // and source state leaked the same way. It shares the world's knowledge
  // and the survival state, and nothing else.
  const scratch = { kind: 'survive', request: `Something useful while ${reason.replace(/^\w+:/, '').replaceAll('_', ' ')} is stuck`, survival: goal.survival,
    portals: goal.portals, villages: goal.villages, blueprint: goal.blueprint };
  const attempts = attemptsFor(goal);
  const tree = {};
  const offer = (key, description, run, target = null, waits = null) => {
    if (attempts.resting('detour', key, now)) return;
    tree[key] = { description, ...(target ? { target } : {}), ...(waits ? { waits } : {}), run: async () => {
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
  // The work on offer from here (restWork), each run bounded as above; the
  // portal's own work (portalJobs) named first, ahead of the stalled work's
  // own answers (note 753b).
  const work = await detourWork(bot, task, goal, save, { survival, bounded, scratch, holding: !!holding, resting: key => attempts.resting('detour', key, now) });
  const PORTAL_JOB = /^(to_portal_frame|replan_portal|search_lava)$/;
  // Each with where it goes, where it says: the ledger and the walks' record
  // read an option by its target (failed-places.js, note 785).
  for (const w of work.filter(w => PORTAL_JOB.test(w.key))) offer(w.key, w.description, w.run, w.target);
  for (const [key, answer] of Object.entries(answers)) offer(key, answer.description, answer.run, answer.target, answer.waits);
  for (const w of work.filter(w => !PORTAL_JOB.test(w.key))) offer(w.key, w.description, w.run, w.target);
  // A walk to water is what the portal frame's cast is waiting for when it
  // has none: said on the travel to a biome that has some (the walk is built
  // from the scratch goal, which does not know the rung; note 630).
  // With the empty bucket carried or not: "an empty one fills at any water"
  // was said to 25584 with none carried, the iron for one three blocks off
  // (note 755).
  if (castWaterWait(bot, goal)) {
    const { biomeFacts } = require('./biomes');
    const buckets = countOf(bot, 'bucket');
    const bucketSays = buckets ? `${buckets} empty bucket${buckets === 1 ? '' : 's'} carried, filled at any water` : `no empty bucket is carried either: the water there comes back only in one, three iron ingots (${countOf(bot, 'iron_ingot')} carried, ${countOf(bot, 'raw_iron')} raw iron)`;
    for (const [key, node] of Object.entries(tree)) {
      if (/^travel_/.test(key) && holdsWater({ biome: key.slice(7), has: biomeFacts(key.slice(7)) })) node.description += ` It has water, which is what the portal frame's cast is waiting for: no water bucket is carried; ${bucketSays}.`;
    }
  }
  // The job in hand, and how far each walk off ends from it (job-in-hand.js,
  // note 755): the frame begun and the step's own need, said once on the
  // question, and on each way that walks away.
  const job = (() => {
    try {
      const here = bot.entity?.position;
      const pending = goal.kind === 'win' ? framePending(bot, goal) : null;
      return require('./job-in-hand').jobInHand({ step: goal.step, here,
        frame: pending ? { at: pending.at, placed: pending.placed, cast: !!pending.frame.cast } : null,
        carried: { lava: countOf(bot, 'lava_bucket'), water: countOf(bot, 'water_bucket') },
        find: names => find(bot, names, 32, 1)[0] || null });
    } catch (_) { return null; }
  })();
  if (job) {
    const { awaySays } = require('./job-in-hand');
    const ends = Object.fromEntries(require('./exploration').biomeTrips(bot).map(b => [`travel_${b.biome}`, { x: b.x, z: b.z }]));
    for (const [key, node] of Object.entries(tree)) {
      if (ends[key]) node.description += awaySays(job, ends[key], bot.entity.position);
      else if (/^(look_around|explore|deep_dark|trial_chambers|night_mine)$/.test(key)) node.description += ` Leaves the job in hand: ${job.short}.`;
    }
  }
  // The rung's measure has not moved, no pickaxe is carried, and the ways
  // tried under it lately came to nothing for want of one: the question
  // leads with getting one, the ways to it first (note 687).
  let pickaxeLeads = null;
  // Not at the fight by a spawner with a sword carried: the rods need the
  // sword there, not a pickaxe (cage-hold.js, note 700).
  if (id === 'rung_progress' && goal.kind === 'win' && pickaxeNeeded(bot) && !require('./cage-hold').swordNotPickaxe(bot, goal)) {
    const bs = require('./block-stock');
    const wanted = (goal.tried?.entries || []).filter(e => e.outcome === 'blocked' && now - (e.settledAt || e.at) < 10 * 60000 && bs.WANTS_PICKAXE.test(e.why || ''));
    if (wanted.length) {
      if (!tree.make_pickaxe && !tree.fetch_stems) {
        let offers = {};
        try { offers = (await upkeepOffers(bot, bounded, goal, save)).options; }
        catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; offers = {}; }
        for (const key of ['make_pickaxe', 'fetch_stems']) if (offers[key]) offer(key, offers[key].describe ? await offers[key].describe() : offers[key].description, offers[key].run);
      }
      const ways = ['make_pickaxe', 'fetch_stems'].filter(k => tree[k]);
      const failedFor = [...new Set(wanted.map(e => `${String(e.method).replaceAll('_', ' ')}: ${String(e.why).split('; ')[0].slice(0, 100)}`))].slice(-3);
      pickaxeLeads = bs.pickaxeLead(bot, ways, failedFor, { closedSays: 'tried lately and came to nothing for want of one' });
      if (pickaxeLeads) { const first = bs.pickaxeFirstOrder(tree); for (const k of Object.keys(tree)) delete tree[k]; Object.assign(tree, first); }
    }
  }
  const options = Object.keys(tree);
  const stats = survival?.state || goal.survival || goal;
  // Work while a rest runs out is not the work standing still.
  if (!holding) recordStill(stats, reason, ms, { now, detour: options.join(',') || 'none' });
  console.log(`[still] ${holding ? `holding ${reason} until its rest ends` : `${Math.round(ms / 1000)}s on ${reason}`}; detours: ${options.join(', ') || 'none'}`);
  save();
  if (!options.length) return false;
  const step = goal.step;
  const what = reason.replace(/^\w+:/, '').replace(/^rung:/, '').replaceAll('_', ' ');
  const flipSays = stalled?.flipPair ? `${stalled.flipPair[0].toUpperCase()}${stalled.flipPair.slice(1)}` : null;
  const context = { situation: flipSays
    ? `${flipSays} Choose a way other than those two: ${id === 'rung_progress' ? 'another way to the rung, other work until their rest ends, or the rung set aside for now' : 'another way from fresh ground, something useful from here for a few minutes, or the work left for later'}.`
    : id === 'rung_progress'
    ? `${pickaxeLeads ? `${pickaxeLeads} ` : ''}${stalled?.rung ? `${stalled.rung[0].toUpperCase()}${stalled.rung.slice(1)}.` : stalled?.whatFailedBelow ? `The ${what} could not go on below this question: ${stalled.whatFailedBelow.replace(/\.$/, '')}.${stalled.workedOnRung ? ` Worked on this rung ${stalled.workedOnRung}.` : ''}` : `The ${what} is brought to the rung's question.`}${stalled?.setAsideNotOffered ? ' Choose: keep at it with the ways left below, or change the plan; setting the rung aside is not offered here, and why is said.' : ' Choose: keep at it with the ways left, change the plan, or set the rung aside for now.'}`
    : holding
    ? `The ${what} rests ${holding.minutes} more minute${holding.minutes === 1 ? '' : 's'}${holding.why ? ` (${holding.why})` : ''}, and Jev chose other work until then. Choose the work for now; it has until the rest ends.`
    : stalled?.failure
    ? `${what} keeps failing (${stalled.failure}), round ${stalled.strikes} of failures. Choose: keep at it another way, leave it for later, or something useful from here for a few minutes.`
    : stalled
    ? `${Math.round(ms / 1000)} seconds on ${what} without getting anywhere, ${stalled.strikes === 1 ? 'the first time' : `${stalled.strikes} times in ten minutes`}. Choose: keep at it another way, leave it for later, or something useful from here for a few minutes.`
    : `Standing still for ${Math.round(ms / 1000)} seconds on ${what}. Choose something useful to do from here for a few minutes; the stalled work gets its turn again afterwards.`,
  ...(stalled ? { stalled } : {}), ...(job ? { jobInHand: job.says } : {}) };
  // What was left out for want of a way from here (note 754).
  if (work.withheld) context.situation += ` ${work.withheld}`;
  // What each detour came to the last times this work stood still: chosen,
  // and still again after. mid-220-b, on a beach at sea level taken for
  // underground, chose "another way" sixteen times over, told each time
  // only what it would do (2026-09-26).
  const log = (stats.detourLog ||= {});
  const tried = (log[reason] || []).filter(e => now - e.at < DETOUR_MEMORY_MS);
  for (const key of options) {
    const n = tried.filter(e => e.choice === key).length;
    if (n) tree[key].description += ` Chosen for this same stall ${n} time${n === 1 ? '' : 's'} in the last ${Math.round(DETOUR_MEMORY_MS / 60000)} minutes, and the work stood still again after each${n >= 2 ? `: listed after the ways not tried for it` : ''}.`;
    const run = tree[key].run;
    tree[key].run = (...args) => { log[reason] = [...tried, { choice: key, at: now }].slice(-20); return run(...args); };
  }
  // The ways chosen for this stall and come to nothing come after the ways
  // not yet tried (note 749e): 25590's stillness_detour offered mine_nearby
  // and differently first, chosen for the same stall up to six times, while
  // the work stood still after each. By how often, the fewest first, the
  // order as built among equals.
  {
    const count = key => tried.filter(e => e.choice === key).length;
    const order = options.map((k, i) => [k, i]).sort((a, b) => (Math.min(count(a[0]), 2) - Math.min(count(b[0]), 2)) || (a[1] - b[1])).map(([k]) => k);
    const copy = Object.fromEntries(order.map(k => [k, tree[k]]));
    for (const k of Object.keys(tree)) delete tree[k];
    Object.assign(tree, copy);
  }
  // The food plan Jev chose, said on the stall's question and on each
  // answer here that is not a way to food (note 784; the health that does
  // not come back is note 639's, said on them already): 25598 (mid-242-sf,
  // 2026-09-30 05:43:21Z) at 7 health with nothing to eat, its
  // return_for_food chosen 21 seconds before, answered rung_progress
  // keep_at_it three times, told nothing of the trip, and sealed in again;
  // a blaze took it to 1.7 at 05:44:03.
  {
    const fp = require('./food-plan'), held = fp.heldFood(stats, now);
    if (held) {
      context.foodPlan = `The food plan stands: ${fp.says(held, now)}.`;
      for (const [k, node] of Object.entries(tree)) if (!/^(restock_food|return_for_food|go_for_food|hoglin_\w+|cook_food|eat\w*)$/.test(k) && typeof node.description === 'string') node.description += ` ${context.foodPlan}`;
    }
  }
  try {
    // Through decide: the ledger reads and records every answer to it, the
    // one way included.
    await decideAction(bot, task, goal, save, client, onStep, tree, context, id, { above });
  } finally { goal.step = step; save(); }
  return true;
}

// The chance a block dug gives a drop other than itself, where the game fixes
// it (gravel: flint one time in ten, and the gravel otherwise).
const DROP_ODDS = { gravel: { flint: 0.1 } };
// Put the block down beside the bot and dig it, until the drop wanted is
// carried or no block is left (dig_own, note 749e). A block that gives
// itself back is put down again.
async function digOwn(bot, task, step, want) {
  const target = countOf(bot, step.drops) + want;
  for (let tries = 0; tries < 64 && countOf(bot, step.drops) < target && countOf(bot, step.block) > 0; tries++) {
    task.check();
    const feet = bot.entity.position.floored();
    const cell = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => feet.offset(dx, 0, dz))
      .find(c => bot.blockAt(c)?.boundingBox === 'empty' && !/water|lava/.test(bot.blockAt(c)?.name || '') && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block');
    if (!cell) throw new Error(`No open cell with a floor beside the bot to put the ${String(step.block).replaceAll('_', ' ')} down`);
    await place(bot, task, cell, step.block);
    await dig(bot, task, cell, { requireDrops: false });
    await new Promise(r => setTimeout(r, 400));
    const drop = Object.values(bot.entities || {}).find(e => e.getDroppedItem?.() && e.position.distanceTo(cell) < 2.5);
    if (drop) { try { await navigate(bot, task, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5), { timeoutMs: 3000, stallMs: 1500 }); } catch (_) { task.check(); } }
  }
  if (countOf(bot, step.drops) < target) throw new Error(`Dug the ${String(step.block).replaceAll('_', ' ')} carried and got no ${String(step.drops).replaceAll('_', ' ')}`);
}

// Other work until a rest ends, Jev's choice at the stall (answerStall's
// until_rest_ends): detour after detour, each given the minutes left and
// each picked by Jev, and the work that rested taken up again at the end.
// With nothing on offer, or a detour over at once, the rest is waited out a
// few seconds at a time rather than the rest met again and asked about.
// With nothing on offer, the wait is said, once, with what it waits for and
// until when, and kept on the step: on 25586 and 25587 the hold slept five
// seconds at a time, "detours: none", with the step saying only "detour"
// (note 609).
function restWaitSays(reason, until, why, now = Date.now()) {
  const what = String(reason || 'the work').replace(/^\w+:/, '').replace(/^rung:/, '').replaceAll('_', ' ');
  return `the ${what}'s rest to end, ${Math.max(1, Math.round((until - now) / 1000))} seconds more (at ${new Date(until).toISOString().slice(11, 19)}Z)${why ? `, set for: ${String(why).slice(0, 160)}` : ''}; nothing else is on offer from here meanwhile`;
}
// What a hold for a rest would have on offer from here (detourWork, as the
// hold builds it), read before the question that chooses the hold: the
// option says the work, or that choosing it is standing idle (note 675).
async function restWork(bot, task, goal, save, { survival = null, now = Date.now() } = {}) {
  const attempts = attemptsFor(goal);
  try { return await detourWork(bot, task, goal, save, { survival, holding: true, preview: true, resting: key => attempts.resting('detour', key, now) }); }
  catch (err) { if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return []; }
}
// The first clause of an option's words, for a list of what is on offer.
const clauseOf = d => { const c = String(d || '').split(/(?<=\.)\s/)[0].replace(/\.$/, ''); return c.length > 110 ? `${c.slice(0, 107)}...` : c; };
// Why nothing is on offer, from what the catalog reads: where the bot is,
// the blocks and the pickaxe carried.
function idleWhy(bot) {
  const { blockStock } = require('./inventory-tidy');
  const where = dimension(bot) === 'overworld' ? (bot.time?.timeOfDay >= DAY.DUSK ? 'night in the Overworld' : 'the Overworld') : 'the Nether, where the day work of the Overworld is not on offer';
  const pick = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
  return `${where}; no ore within 16 blocks that a carried tool takes; ${blockStock(bot)} building blocks and ${pick ? 'a pickaxe' : 'no pickaxe'} carried`;
}
// The hold's offer in words: the work on offer, or the idle wait and its
// minutes.
function restWorkSays(bot, work, { until, now = Date.now() } = {}) {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  const left = work.withheld ? ` ${work.withheld}` : '';
  if (work.length) return `Work on offer meanwhile from here: ${work.map(w => clauseOf(w.description)).join('; ')}.${left}`;
  return `Nothing else is on offer from here meanwhile (${idleWhy(bot)})${left ? `;${left.replace(/\.$/, '')}` : ''}: chosen, this is standing here idle about ${minutes} minute${minutes === 1 ? '' : 's'}, until about ${new Date(until).toISOString().slice(11, 16)}Z.`;
}
// `idle`: the hold was chosen said as standing idle. Chosen as other work
// and the work on offer run out, the hold ends and the question above is
// asked again with that said, not a silent wait in the work's name.
async function holdForRest(bot, task, goal, save, { client, survival, onStep = () => {}, reason, until, why = null, above = undefined, idle = true }) {
  let waitSaid = false;
  try {
    while (Date.now() < until) {
      task.check();
      const started = Date.now(), minutes = Math.max(1, Math.ceil((until - started) / 60000));
      // `none`: nothing was on offer (a detour tried and failed is not that).
      let worked = false, none = false;
      try { worked = await breakStillness(bot, task, goal, save, { client, survival, onStep, reason, now: started, until, holding: { minutes, why }, above }); none = !worked; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err; }
      if (none && !idle) {
        console.log(`[wait] the work on offer while ${String(reason).replace(/^\w+:/, '').replaceAll('_', ' ')} rests has run out; the question above is asked again`);
        if (goal.restHeld?.until === until) { delete goal.restHeld; save(); }
        return false;
      }
      if (!worked && !waitSaid) {
        waitSaid = true;
        const says = restWaitSays(reason, until, why);
        console.log(`[wait] waiting for ${says}`);
        goal.step = { ...(goal.step?.action === 'detour' ? goal.step : { action: 'detour', choice: 'until_rest_ends', from: reason }), waitingFor: says }; save(); onStep(goal);
      }
      // Waited a quarter second at a time with the task's check between: a
      // five-second sleep met a preemption only at its end, and the arbiter's
      // watch stopping the hold for a crossbow piglin or a ghast by the drop
      // came too late for the shot (note 586).
      if (!worked || Date.now() - started < 5000) for (const end = Date.now() + Math.max(0, Math.min(5000, until - Date.now())); Date.now() < end;) { await sleep(Math.min(250, end - Date.now())); task.check(); }
    }
  } finally { if (goal.restHeld?.until === until && Date.now() >= until) { delete goal.restHeld; save(); } }
  return true;
}

// What the home base needs from the executor: travel, placing, digging,
// the planner for anything craftable, and a search for sheep or cows.
const homeActions = () => ({ acquireStep, navigate, place, dig, explore, tunnel: tunnelToward });

// The kit for the crossing (crossing-kit.js): each item carried against
// what the code would take and why, and crossing now or topping up a named
// item first is Jev's. These were six gates in a row, none said: forty food
// points (asked, but gathered by default and let go by a twenty-minute
// rule), sixteen health waited for, a hundred and twenty-eight blocks, a
// spare pickaxe, eight logs and a table, and the valuables walked home from
// up to a hundred and twenty-eight blocks (the decision review,
// 2026-09-26). Two steaks had been the whole larder for the first Nether
// trip, and after a death the blaze hunt walked back through the portal
// with three pieces of food and fought at four health: those are why the
// facts are said, here at the crossing however it is reached.
// The answer holds: asked again when what is on offer changes (an item
// topped up or newly short, the valuables left) or after ten working
// minutes on one answer. A top-up says the working minutes it has had at
// this crossing and what they brought.
const KIT_HOLD_MS = 10 * 60000;
// The old walk's time on one item (the tests' stand-in's order, note 707).
const KIT_FALLBACK_MS = 20 * 60000;
// The food, the blocks and the spare pickaxe are rungs of the ladder now,
// before the portal (crossing-kit.js kitRungs, note 673); this question
// keeps the rest.
const KIT_ORDER = ['stash_valuables', 'top_up_health', 'top_up_gold', 'top_up_wood', 'cache_valuables'];
const TOP_UP = {
  health: 'Wait here and heal first, to sixteen.',
  wood: 'Gather wood first: logs up to eight, and a crafting table.',
  // Said, not "undefined": mid-242-l was offered its gold as "undefined Gold:
  // no piece carried", crossed without it, and was shot by a piglin
  // (2026-09-27).
  gold: 'Make golden boots first and wear them: four gold ingots, smelted from raw gold or gold ore.',
};
// The portal not yet lit, which a top-up leaves where it stands or the
// crossing goes on with: the frame begun, what stands in it (as last seen
// when it is out of sight), how far it is, and its lava. mid-230-u chose
// food over crossing (0.38 against 0.35), told nothing of the frame with
// four of ten cast, and the hunt took it four hundred blocks off by boat,
// most of an hour before the cast went on (note 527).
function framePending(bot, goal) {
  const f = goal.portalFrame;
  if (!f?.origin || !Array.isArray(f.blocks) || lowestPortalBlock(bot)) return null;
  const at = pos(f.origin);
  const loaded = f.blocks.every(p => bot.blockAt(pos(p)));
  const placed = loaded ? f.blocks.filter(p => bot.blockAt(pos(p))?.name === 'obsidian').length : (Number.isFinite(f.placedSeen) ? f.placedSeen : null);
  const lava = nearestLava(bot, goal, undefined, f.origin), fromFrame = lava && lavaTrip(f.origin, lava);
  return { frame: f, at, distance: Math.round(bot.entity.position.distanceTo(at)), placed, lava: fromFrame ? fromFrame.distance : null };
}
// With how many blocks it is from done (note 755: 25588 left one 8 of ten
// cast for a food top-up at hunger 19, told the count but not that two
// blocks finished it).
const frameSays = pending => `the frame at (${pending.at.x}, ${pending.at.y}, ${pending.at.z}), ${pending.placed ?? 'some'} of ten ${pending.frame.cast ? 'cast' : 'placed'}${Number.isFinite(pending.placed) && pending.placed < 10 ? ` (${10 - pending.placed} block${10 - pending.placed === 1 ? '' : 's'} from done)` : ''}, ${pending.distance} blocks from here${pending.lava !== null ? `, its nearest known lava ${pending.lava} blocks from it` : ''}`;
// The food known, each with the trip for it: the walk there, the gathering,
// and the walk on to the frame (or back here), and about what it gives
// against what is short. Seconds are a walk at 4.3 blocks a second and about
// fifteen seconds an animal to reach and kill; a chest a few seconds, a
// plot's or a village's harvest and bread about a minute.
// Meat is counted as the kill leaves it, raw (healing RAW_MEAT_POINTS), with
// what cooking would make of it beside: mid-244-ah (note 594) was told a cow
// in view brought 32 of the 40 points short, and its kills counted three a
// beef.
function foodTrips(bot, goal, pending, short) {
  const { foodSources, MEAT_POINTS, RAW_MEAT_POINTS } = require('./healing');
  const back = pending ? pending.at : bot.entity.position;
  const named = s => String(s).replaceAll('_', ' ');
  // Food at the surface, the bot under cover: the climb first, and back
  // down after where the trip ends at this depth (note 763: mid-237-bc, 86
  // blocks down, was told "about 62 seconds in all" for sheep at the top of
  // a climb its own record puts at seven minutes).
  const levels = require('./levels');
  const depth = levels.depthHere(bot), here = bot.entity.position;
  const top = depth >= levels.UNDER ? here.y + depth : null;
  const leg = top === null ? null : levels.surfaceLeg(bot, { back: back.y < top - levels.UNDER });
  return foodSources(bot, goal).map(src => {
    const onward = src.at ? Math.round(Math.hypot(src.at.x - back.x, (src.at.y ?? back.y) - back.y, src.at.z - back.z)) : src.distance;
    const raw = src.animal ? RAW_MEAT_POINTS[src.animal] ?? 3 : 0, cooked = src.animal ? MEAT_POINTS[src.animal] || 6 : 0;
    const animals = raw ? Math.min(src.count || 1, Math.max(1, Math.ceil(short / raw))) : 0;
    const gives = raw ? Math.min(short, Math.round(animals * raw)) : Math.min(short, src.points || 0);
    const cookedGives = raw ? Math.min(short, animals * cooked) : 0;
    const gather = raw ? animals * 15 : src.kind === 'home_chest' ? 10 : 60;
    const there = Math.round(src.distance / 4.3), on = Math.round(onward / 4.3);
    const climb = leg && (src.at?.y === undefined || src.at.y >= top - levels.UNDER) ? leg : null;
    const seconds = there + gather + on + (climb ? climb.seconds : 0);
    const gatherSays = raw ? `about ${duration(gather)} for ${animals} ${named(src.animal)}${animals === 1 || src.animal === 'sheep' ? '' : 's'}`
      : src.kind === 'home_chest' ? 'the chest emptied' : `about ${duration(gather)} for the harvest and the bread`;
    const says = `${src.says}${pending ? `, ${onward} blocks from the frame` : ''}: about ${duration(seconds)} in all (${climb ? `${climb.says}, ` : ''}the walk there about ${duration(there)}, ${gatherSays}, and ${pending ? 'on to the frame' : 'back here'} about ${duration(on)}), for about ${gives} of the ${short} points short${raw ? ` as raw meat, about ${cookedGives} once cooked` : ''}`;
    return { ...src, onward, seconds, gives, cookedGives, says, ...(climb ? { climb } : {}) };
  });
}
// The raw food carried that cooking makes more of, with what it comes to and
// whether a furnace and fuel are carried to cook it here. mid-244-ah (note
// 594) carried 126 coal and two furnaces through forty minutes of hunting
// for the crossing's food, and its raw kills were counted and eaten at three
// a beef, where a steak is eight.
// The Nether's stems and planks do not burn (the jar's non_flammable_wood,
// fuel.js): a bot with crimson planks was told a furnace was fuelled (note 639).
const FUELS = /^(coal|charcoal|coal_block|(?!crimson_|warped_).*_log|(?!crimson_|warped_).*_planks|blaze_rod)$/;
function cookable(bot) {
  const foods = bot.registry?.foodsByName || {};
  const { safeFood } = require('./vitals');
  const items = Object.entries(RAW_FOOD).map(([raw, cooked]) => ({ raw, cooked, n: countOf(bot, raw) }))
    .filter(i => i.n > 0 && foods[i.cooked])
    .map(i => ({ ...i, now: safeFood(bot, { name: i.raw }) ? i.n * (foods[i.raw]?.foodPoints || 0) : 0, after: i.n * foods[i.cooked].foodPoints }))
    .filter(i => i.after > i.now);
  if (!items.length) return null;
  const furnace = ['furnace', 'smoker'].find(n => countOf(bot, n) > 0) || null;
  const stone = ['cobblestone', 'cobbled_deepslate', 'blackstone'].find(n => countOf(bot, n) >= 8) || null;
  const fuel = bot.inventory.items().find(i => FUELS.test(i.name))?.name || null;
  const n = items.reduce((s, i) => s + i.n, 0);
  return { items, n, now: items.reduce((s, i) => s + i.now, 0), after: items.reduce((s, i) => s + i.after, 0), furnace, stone, fuel,
    ready: !!fuel && !!(furnace || stone) };
}
// What a cook at a furnace put down here stands the bot through, and a wait
// to heal: the mobs about that get to it meanwhile (risk.js standingAmong),
// and for the cook, that the meat is in the furnace and not eaten. mid-242-ab-
// nether-3-fortress-6 (note 628) cooked seven mutton at 14.3 health, hunger
// 17, told "with no walk": two zombies were in sight at 10 and 20 blocks and
// nine shooters within 48, and it was at the furnace when the first arrived.
function cookStandsSays(bot, cook, secs) {
  const health = bot.health ?? 20, food = bot.food ?? 20;
  const among = require('./risk').standingAmong(bot, secs, { what: 'at the furnace' });
  const eaten = Math.min(20, food + cook.now);
  const unfed = health < 20 && food < 18 ? ` The meat is in the furnace, not eaten, while it cooks: health ${Math.round(health * 10) / 10} does not come back at hunger ${food} meanwhile; eaten raw now, the ${cook.now} points bring hunger to ${eaten}${eaten >= 18 ? ', where it does' : ''}.` : '';
  return `${unfed}${among ? ` ${among.says} The cook is stopped when one of them comes within eight blocks in sight or lands a hit, and the batch stays in the furnace to be collected.` : ''}`;
}
function healWaitSays(bot, item) {
  const health = bot.health ?? 20, food = bot.food ?? 20, heals = food >= 18;
  const secs = heals ? Math.max(4, Math.ceil((item.wants - health) * 4)) : 60;
  const among = require('./risk').standingAmong(bot, secs, { what: 'here' });
  return among ? ` ${heals ? `About ${secs} seconds, a point each four.` : `At hunger ${food} health does not come back, so this wait has no end of its own: a minute of it is counted.`} ${among.says}` : '';
}
// The known food whose trip, there and on to the frame, is shortest.
const foodNearFrame =(bot, goal, pending, short) => foodTrips(bot, goal, pending, short).filter(t => t.at && t.gives > 0).sort((a, b) => a.seconds - b.seconds)[0] || null;
// Where the plain food top-up goes (gatherNetherFood): the home chest, the
// plot, then a search outward with no bound, said with its trip where one
// is known and with the frame it leaves (note 527).
function foodTopUpSays(bot, goal, pending, item) {
  const short = Math.max(1, item.wants - item.carried);
  const trips = foodTrips(bot, goal, pending, short);
  const first = trips.find(t => t.kind === 'home_chest') || trips.find(t => t.kind === 'home_plot');
  const others = trips.filter(t => t !== first).slice(0, 3);
  // A real target, named, or said missing (note 728): a cow, sheep, rabbit
  // or mooshroom in view or remembered is the target; with none of those
  // known, the search says so plainly rather than promising an unbounded
  // walk (mid-242-tf walked laps for fifteen minutes on "no bound on how
  // far", never told there was nothing to walk toward).
  const route = first ? ` It goes to ${first.kind === 'home_chest' ? "home's chest" : 'the home plot'} first: ${first.says}.`
    : others.length ? ` With no home chest or plot of food to go to, the food known (nearest first; the search does not walk to what is out of view first): ${others.map(t => t.says).join('; ')}.`
    : ' With no home chest or plot of food to go to, and no cow, sheep, rabbit, mooshroom or fish known in view or remembered, no food target is known right now: the search walks outward a leg at a time, heading by heading, and names one as soon as it is seen.';
  const left = pending ? ` Meanwhile ${frameSays(pending)}, is left where it stands: nothing keeps the ${first ? 'trip' : 'search'} near it, and the ${pending.frame.cast ? 'cast' : 'frame'} is taken up again only when the bot has walked back to it.` : '';
  return route + left;
}
async function crossingKitReady(bot, task, goal, save, client = task.opportunityClient, now = Date.now()) {
  if (bot.game?.gameMode !== 'survival') return true;
  const items = kitItems(bot), valuables = valuablesAt(bot, goal);
  // The food, blocks and pickaxe were the ladder's to top up (kitRungs):
  // short here, they were set aside there, and are said, not asked again.
  const short = items.filter(i => i.short && !i.rung), left = items.filter(i => i.short && i.rung);
  // The cauldron for the Nether's fire is on offer, not short: it makes the
  // question worth asking when the bot could make the set now (note 634).
  const cauldron = items.find(i => i.key === 'cauldron' && i.offer);
  // A chest the wood carried makes now, to keep rods in (note 760): of 122
  // Nether entries none carried one.
  const chest = (() => { try { return require('./crossing-kit').kitRungs(bot, goal).some(r => r.phase === 'nether_chest'); } catch (_) { return false; } })() ? items.find(i => i.key === 'chest' && i.offer) : null;
  // No pickaxe at all is a gap at the crossing whatever the ladder's kit
  // step said (note 763b): the spare's rung set aside, the crossing asked
  // nothing, and 25589 (about 21:20Z) crossed into the Nether with no
  // pickaxe. Said on cross_now and offered as its own top-up.
  const noPickaxe = !bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
  // A kit item left to the ladder's step that is now empty is counted here,
  // and its step offered back (note 767c): 25589 (2026-10-01 01:19-01:25Z)
  // answered cross_now seven times while "food 6 of 80" became "0 of 80",
  // the food step set aside and never offered at the crossing.
  // Empty since the crossing last looked (some carried then, none now):
  // the step's own question was answered with some in hand.
  const seen = goal.kitSeen || {};
  const empty = left.filter(i => i.carried === 0 && /^(food|blocks)$/.test(i.key) && (seen[i.key] || 0) > 0);
  goal.kitSeen = Object.fromEntries(items.map(i => [i.key, i.carried]));
  if (!short.length && !valuables && !cauldron && !chest && !noPickaxe && !empty.length) { delete goal.preparingNether; return true; }
  // A record left from another crossing, untouched half an hour, starts afresh.
  if (goal.crossingKit && now - (goal.crossingKit.lastAt || 0) > 30 * 60000) delete goal.crossingKit;
  const kit = goal.crossingKit ||= { workedMs: 0, spent: {} };
  kit.lastAt = now;
  const soFar = (i, key = i.key) => {
    const s = kit.spent[key];
    return s?.ms >= 60000 ? ` ${Math.round(s.ms / 60000)} working minutes have gone to it at this crossing, from ${s.from} to ${i.carried}.` : ' Nothing has gone to it yet at this crossing.';
  };
  // No portal lit yet: going on is finishing the frame first, and a
  // top-up leaves it where it stands (note 527).
  const pending = framePending(bot, goal);
  const going = pending ? ` No portal is lit yet: going on is ${frameSays(pending)}, finished first, then the crossing.` : '';
  const leftSays = left.length ? ` Left from the ladder's kit steps: ${left.map(i => `${i.key} ${i.carried} of ${i.wants}`).join(', ')}.` : '';
  // cross_now weighed the food left as a bare "6 of 80" and never the
  // hunger the bot was crossing at: 25597 crossed at hunger 9 with 6 of 80
  // food points carried, went 36 blocks down, and fifty seconds later
  // win_strategy said "nether food first" and climbed back (note 747).
  // Said here against the hour the Nether spends about forty hunger, and
  // that health does not come back below hunger eighteen.
  const foodItem = items.find(i => i.key === 'food');
  const hungerNow = bot.food ?? 20;
  const hungerWeigh = foodItem ? ` Hunger ${hungerNow} now${hungerNow < 18 ? ', already below eighteen: health does not come back' : ''}; ${foodItem.carried} of ${foodItem.wants} food points carried for the stay, spent there at about ${NETHER_HUNGER_AN_HOUR} an hour.` : '';
  const tree = {
    cross_now: { description: `Cross with what is carried now${short.length ? `, short of what the code would take in ${short.map(i => i.key).join(', ')}` : ''}${valuables ? `, and with the valuables carried (${valuables.what})` : ''}.${going}${leftSays}${hungerWeigh} ${items.filter(i => !i.rung).map(i => i.says).join(' ')}` },
  };
  if (empty.some(i => i.key === 'food')) {
    const minutes = Math.max(0, Math.round((hungerNow - 17) / NETHER_HUNGER_AN_HOUR * 60));
    tree.cross_now.description += ` No food at all is carried: in the Nether hunger falls about ${NETHER_HUNGER_AN_HOUR} an hour with nothing to eat${hungerNow >= 18 ? `, and at hunger ${hungerNow} health stops coming back in about ${minutes} minute${minutes === 1 ? '' : 's'}` : ', and health is not coming back now'}.`;
  }
  for (const i of empty) tree[`take_up_${i.key}`] = { description: `Take up the ${i.key} for the Nether again first: it is empty now, 0 of ${i.wants} carried (${seen[i.key]} when the crossing last looked), and its step was set aside by the ladder; its rest is lifted and the ladder takes it up next.` };
  const pickMade = noPickaxe ? (countOf(bot, 'iron_ingot') >= 3 ? 'iron_pickaxe' : ['cobblestone', 'cobbled_deepslate', 'blackstone'].some(n => countOf(bot, n) >= 3) ? 'stone_pickaxe' : 'wooden_pickaxe') : null;
  if (noPickaxe) {
    let budget = null; try { budget = require('./pickaxe-budget').pickaxeBudget(bot, goal); } catch (_) { budget = null; }
    tree.cross_now.description += ` No pickaxe is carried: in the Nether nothing can be mined, netherrack for a bridge or a pillar included, and a pickaxe is made there only from wood and stone carried or the Nether's stems.`;
    tree.top_up_pickaxe = { description: `Make a pickaxe first (none carried): ${pickMade.replaceAll('_', ' ')}, from what is carried${budget?.says ? `. ${budget.says}` : ''}.` };
  }
  if (cauldron) tree.top_up_cauldron = { description: `Make the cauldron set for the Nether's fire first: ${countOf(bot, 'cauldron') ? '' : `craft a cauldron (7 of the ${countOf(bot, 'iron_ingot')} iron ingots carried, at a crafting table${countOf(bot, 'crafting_table') ? ' carried' : ' made first'})`}${!countOf(bot, 'cauldron') && !countOf(bot, 'water_bucket') ? ' and ' : ''}${countOf(bot, 'water_bucket') ? '' : 'fill a bucket with water (an empty bucket carried, water to be found)'}. ${cauldron.says}` };
  if (chest) tree.top_up_chest = { description: `Make a chest from the wood carried first and carry it in (8 planks${countOf(bot, 'crafting_table') ? ' at the crafting table carried' : ', and a crafting table of 4 more'}, a few seconds, one slot).${chest.says.replace(/^Chest: none carried\./, '')}` };
  for (const i of short) tree[`top_up_${i.key}`] = { description: `${TOP_UP[i.key]}${i.key === 'health' ? healWaitSays(bot, i) : ''} ${i.says}${soFar(i)}` };
  if (valuables?.how === 'stash') tree.stash_valuables = { description: `Walk ${valuables.far} blocks to the stash chest at home first and leave the valuables in it (${valuables.what}), about ${Math.round(valuables.far / 4.3)} seconds each way: a death in the Nether drops everything carried, often into lava.` };
  if (valuables?.how === 'cache') tree.cache_valuables = { description: `Put ${valuables.chest} down here first and leave the valuables in it (${valuables.what}): home's chest is out of reach, and a death in the Nether drops everything carried, often into lava. They are taken back passing by.${pickaxeLeft(bot, valuables.spends)}` };
  const keys = Object.keys(tree).sort().join(',');
  const held = kit.choice && kit.choice.keys === keys && kit.workedMs - kit.choice.at < KIT_HOLD_MS && tree[kit.choice.pick];
  let pick = held ? kit.choice.pick : null;
  if (!pick) {
    const worn = k => { const i = short.find(s => `top_up_${s.key}` === k); return i && kit.spent[i.key]?.ms >= KIT_FALLBACK_MS && i.carried > 0; };
    // The old order, for the tests' stand-in only (note 707).
    const oldOrder = KIT_ORDER.find(k => tree[k] && !worn(k)) || 'cross_now';
    const decision = await decide('crossing_kit', { client, bot, task, goal, save, tree, context: { oldOrder },
      state: { kit: Object.fromEntries(items.map(i => [i.key, `${i.carried} carried, the code would take ${i.wants}`])), health: bot.health, hunger: bot.food,
        minutesAtCrossing: Math.round(kit.workedMs / 60000), riskNow: require('./risk').riskNow(bot) } });
    if (decision.stale) return false;
    pick = decision.path.at(-1);
    kit.choice = { pick, keys, at: kit.workedMs }; save();
  }
  delete goal.preparingNether;
  if (pick === 'cross_now') return true;
  if (pick.startsWith('take_up_')) {
    const key = pick.slice(8), phase = `nether_${key}`;
    require('./progress').attemptsFor(goal).clear('rung', phase);
    // Optional before the Nether (note 776): taken up, it is chosen.
    require('./game-progress').optIn(goal, phase);
    if (key === 'food' && goal.kitFood?.choice?.pick === 'go_without') delete goal.kitFood.choice;
    delete kit.choice; save();
    bot.chat?.(`The ${key} for the Nether is empty: taking it up again first.`);
    return false;
  }
  const item = short.find(i => `top_up_${i.key}` === pick);
  const spent = item && (kit.spent[item.key] ||= { ms: 0, from: item.carried });
  const started = Date.now();
  try {
    if (pick === 'stash_valuables') await stashValuables(bot, task, goal, save, homeActions());
    else if (pick === 'cache_valuables') await require('./field-cache').cacheValuables(bot, task, goal, save, homeActions());
    else if (pick === 'top_up_pickaxe') {
      goal.step = { action: 'pickaxe_for_nether', item: pickMade }; save();
      await acquireStep(bot, task, pickMade, countOf(bot, pickMade) + 1, goal, save);
    }
    else if (pick === 'top_up_chest') {
      goal.step = { action: 'chest_for_nether' }; save();
      await acquireStep(bot, task, 'chest', 1, goal, save);
    }
    else if (pick === 'top_up_cauldron') {
      // The cauldron first, then the water for it; the next pass asks again with what is carried then.
      goal.step = { action: 'cauldron_for_nether', cauldron: countOf(bot, 'cauldron'), waterBucket: countOf(bot, 'water_bucket') }; save();
      if (!countOf(bot, 'cauldron')) await acquireStep(bot, task, 'cauldron', 1, goal, save);
      else await acquireStep(bot, task, 'water_bucket', 1, goal, save);
    }
    else if (item.key === 'health') {
      goal.step = { action: 'recover_before_nether', health: Math.round(bot.health), needed: item.wants, food: bot.food }; save();
      for (let i = 0; i < 10; i++) { task.check(); await sleep(100); }
    } else if (item.key === 'gold') {
      goal.step = { action: 'gold_for_nether', needed: 'golden_boots' }; save();
      await acquireStep(bot, task, 'golden_boots', countOf(bot, 'golden_boots') + 1, goal, save);
    } else if (item.key === 'wood') {
      goal.step = { action: 'wood_for_nether', logs: item.carried, needed: item.wants }; save();
      // The trees that were seen here, not oak by name.
      const species = (bot._catalogObservation?.nearby || []).find(name => /_log$/.test(name)) || 'oak_log';
      if (logsCarried(bot) < EXPEDITION_LOGS) await acquireStep(bot, task, species, countOf(bot, species) + EXPEDITION_LOGS - logsCarried(bot), goal, save);
      else await acquireStep(bot, task, 'crafting_table', 1, goal, save);
    }
  } finally { if (spent) { spent.ms += Date.now() - started; save(); } }
  return false;
}

// The crossing's food rung (crossing-kit.js kitRungs, note 673), once Jev
// has taken it: which way to the food is Jev's (kit_food), each way with its
// trip and its minutes, or going on without more. These were the crossing
// question's food top-ups; the question now comes before the portal, as a
// rung, and asks only how. Ten working minutes with no food point more set
// the rung aside half an hour (progress.js watch): it is not handed back
// before then (game-progress.js preparationRung), and the crossing goes on.
const KIT_FOOD_STALL_MS = 10 * 60000;
const KIT_FOOD_ORDER = ['top_up_cook', 'top_up_food_near', 'top_up_food'];
// The food dropped for room nearest by, still on the ground (items vanish
// five minutes after they fall), in this dimension and within 96 blocks:
// the walk back said with what it brings and the time it has left.
function droppedFoodNear(bot, goal, now = Date.now()) {
  const { DROP_LASTS_MS } = require('./inventory-tidy');
  const here = bot.entity?.position, dim = String(bot.game?.dimension || 'overworld');
  if (!here) return null;
  const list = (goal?.droppedFood || []).filter(d => now - d.at < DROP_LASTS_MS - 20000 && d.dimension === dim)
    .map(d => ({ d, distance: Math.round(Math.hypot(d.x + 0.5 - here.x, d.y - here.y, d.z + 0.5 - here.z)) })).filter(x => x.distance <= 96).sort((a, b) => a.distance - b.distance);
  const near = list[0];
  if (!near) return null;
  const { d, distance } = near, left = Math.round((DROP_LASTS_MS - (now - d.at)) / 1000), walk = Math.round(distance / 4.3);
  const room = (bot.inventory.emptySlotCount?.() ?? 1) > 0 ? '' : ' The pockets are full: picked up, it takes a slot, and what to drop for it is asked.';
  return { drop: d, says: `Walk back for the ${d.count} ${d.item.replaceAll('_', ' ')} dropped for room at (${d.x}, ${d.y}, ${d.z}) ${Math.max(1, Math.round((now - d.at) / 60000))} minute${now - d.at < 90000 ? '' : 's'} ago: ${d.points} food points, ${distance} blocks off, about ${walk} seconds at a walk; it vanishes about ${left} seconds from now, five minutes after it fell.${room}` };
}
async function kitFoodStep(bot, task, goal, save, stage = {}, client = task.opportunityClient, now = Date.now()) {
  const want = stage.wants || require('./crossing-kit').netherStay(bot, goal).points;
  const carried = foodSupply(bot);
  if (carried >= want) return true;
  // A stretch left over half an hour starts afresh, its stall clock too.
  if (!goal.kitFood || now - (goal.kitFood.lastAt || 0) > 30 * 60000) { goal.kitFood = { spent: {} }; unwatch(goal, 'rung', 'nether_food'); }
  const kit = goal.kitFood;
  kit.lastAt = now;
  if (watch(goal, 'rung', 'nether_food', carried, { better: 'higher', stallMs: KIT_FOOD_STALL_MS, restMs: RUNG_WAIT_MS,
    why: 'ten working minutes on the food for the Nether without a point more', now }).stalled) { delete goal.kitFood; delete goal.strategy; save(); return false; }
  const item = { key: 'food', carried, wants: want };
  const soFar = key => { const s = kit.spent[key]; return s?.ms >= 60000 ? ` ${Math.round(s.ms / 60000)} working minutes have gone to it, from ${s.from} to ${carried}.` : ' Nothing has gone to it yet.'; };
  const pending = framePending(bot, goal);
  // What carried alone covers, cooked or baked, so going on with it is a
  // real priced option and not just a number short of 80 (note 728: 25597
  // was told only "25 of 80" for fifteen minutes, never what the 25 and
  // what could be made of it were worth).
  const onHandMore = () => {
    const parts = [];
    const cook = cookable(bot);
    if (cook && cook.after > cook.now) parts.push(`cooking the ${cook.items.map(i => `${i.n} raw ${i.raw.replaceAll('_', ' ')}`).join(', ')} carried would add ${Math.round(cook.after - cook.now)} more (${Math.round(cook.after)} in all)`);
    const wheat = countOf(bot, 'wheat'), loaves = Math.floor(wheat / 3);
    if (loaves > 0) parts.push(`${wheat} wheat carried bakes ${loaves} bread, ${loaves * 5} points`);
    return parts.length ? ` ${parts.join('; ')}.` : '';
  };
  const tree = {
    go_without: { description: `Go on without more food for now: ${carried} of ${want} points carried.${onHandMore()} The food step is set aside half an hour and the ladder goes on, to the crossing if nothing else is left.` },
    // With the points carried and the hunger now: the top-up is for the
    // stay in the Nether, not a meal (note 755: 25588 at hunger 19).
    top_up_food: { description: `Gather food: the home chest, the farm plot if there is one, or hunting animals. ${carried} of ${want} points carried for the Nether; hunger ${bot.food} of 20 now${(bot.food ?? 0) >= 18 ? ', nothing to eat for' : ''}.${foodTopUpSays(bot, goal, pending, item)}${soFar('food')}` },
  };
  // The raw food carried, cooked here, counted against the want on every
  // food option (note 754d, as 754b did for the Nether's kit): 25581
  // (mid-243-mb, 17:52Z) was "56 of 80, 24 short" with 8 raw mutton, a
  // furnace's cobblestone and 135 coal (+32 cooked, 88 in all), and went for
  // a cow near the frame for five minutes.
  const cook = cookable(bot);
  const cookGain = cook?.ready ? Math.round(cook.after - cook.now) : 0;
  const cookCovers = cookGain ? ` Cooking the raw food carried here (top_up_cook) adds ${cookGain}: ${carried + cookGain} of ${want}${carried + cookGain >= want ? ', the want covered with nothing gathered' : `, ${want - carried - cookGain} short after it`}.` : '';
  tree.top_up_food.description += cookCovers;
  const nearFood = foodNearFrame(bot, goal, pending, want - carried);
  if (nearFood) tree.top_up_food_near = { description: pending
    ? `Gather food at the known food whose trip on to the frame is shortest, then back to the ${pending.frame.cast ? 'cast' : 'frame'}: ${nearFood.says}. Nothing farther is searched: when it is spent or gone, this is asked again with what is known then.${soFar('food_near')}${cookCovers}`
    : `Gather food at the known food nearest by the trip there and back, then come back here: ${nearFood.says}. Nothing farther is searched: when it is spent or gone, this is asked again with what is known then.${soFar('food_near')}${cookCovers}` };
  // The raw food carried, cooked here: the points it adds for the minutes at a furnace.
  if (cook?.ready) {
    const secs = cook.n * 10 + (cook.furnace ? 2 : 6);
    tree.top_up_cook = { description: `Cook the raw food carried first: ${cook.items.map(i => `${i.n} ${i.raw.replaceAll('_', ' ')}`).join(', ')}, ${cook.now} food points as carried, about ${cook.after} once cooked (a steak or a cooked porkchop is eight, cooked mutton six, raw beef three). ${cook.furnace ? `The ${cook.furnace} carried is` : `A furnace is made from eight of the ${cook.stone.replaceAll('_', ' ')} carried and`} put down here, fuelled with the ${cook.fuel.replaceAll('_', ' ')} carried: about ten seconds an item, about ${duration(secs)} in all, with no walk.${cookStandsSays(bot, cook, secs)}${soFar('food_cook')}${cookCovers}` };
  }
  // Food just dropped for room, lying where it fell (note 771b: 25589's 18
  // beef at 03:08:19Z, 2026-10-01; three minutes on its food rung said 8 of
  // 80 and went after one sheep, about 13 minutes and an 89-block climb,
  // the beef never offered).
  const fallen = droppedFoodNear(bot, goal, now);
  if (fallen) tree.pick_up_dropped = { description: fallen.says };
  const keys = Object.keys(tree).sort().join(',');
  let pick = kit.choice && kit.choice.keys === keys && now - kit.choice.at < KIT_HOLD_MS && tree[kit.choice.pick] ? kit.choice.pick : null;
  if (!pick) {
    // The old order, for the tests' stand-in only (note 707).
    const oldOrder = KIT_FOOD_ORDER.find(k => tree[k]) || 'go_without';
    const decision = await decide('kit_food', { client, bot, task, goal, save, tree, context: { oldOrder },
      state: { foodCarried: carried, foodWanted: want, health: bot.health, hunger: bot.food, foodBeforeTheNether: require('./food-facts').beforeSays(bot, goal), riskNow: require('./risk').riskNow(bot) } });
    if (decision.stale) return false;
    pick = decision.path.at(-1);
    kit.choice = { pick, keys, at: now }; save();
  }
  if (pick === 'go_without') {
    delete goal.foodTrip;
    setAside(goal, 'rung', 'nether_food', 'Jev chose the Nether first, without more food', RUNG_WAIT_MS);
    unwatch(goal, 'rung', 'nether_food'); delete goal.kitFood; delete goal.preparingNether; delete goal.strategy; save();
    return false;
  }
  if (pick === 'pick_up_dropped' && fallen) {
    delete kit.choice;
    goal.droppedFood = (goal.droppedFood || []).filter(d => d !== fallen.drop); save();
    goal.step = { action: 'pick_up_dropped_food', item: fallen.drop.item, at: { x: fallen.drop.x, y: fallen.drop.y, z: fallen.drop.z } }; save();
    const before = countOf(bot, fallen.drop.item);
    await navigate(bot, task, new goals.GoalNear(fallen.drop.x, fallen.drop.y, fallen.drop.z, 1), { timeoutMs: 60000, stallMs: 8000 });
    try { await collectNearbyDrops(bot, task, fallen.drop.item, { origin: bot.entity.position.clone(), radius: 4, timeoutMs: 5000, waitForSpawnMs: 500 }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (countOf(bot, fallen.drop.item) <= before) throw new Blocked(`The ${fallen.drop.count} ${fallen.drop.item.replaceAll('_', ' ')} dropped at (${fallen.drop.x}, ${fallen.drop.y}, ${fallen.drop.z}) were not there to pick up`);
    return false;
  }
  const key = pick === 'top_up_food_near' ? 'food_near' : pick === 'top_up_cook' ? 'food_cook' : 'food';
  const spent = kit.spent[key] ||= { ms: 0, from: carried };
  const started = Date.now();
  try {
    if (pick === 'top_up_cook') {
      // The most of one raw food first; the next pass cooks the next.
      const first = cook.items.sort((a, b) => b.n - a.n)[0];
      goal.step = { action: 'cook_for_nether', item: first.cooked, raw: first.n, foodPoints: carried, required: want }; save();
      await acquireStep(bot, task, first.cooked, countOf(bot, first.cooked) + first.n, goal, save);
    }
    else if (pick === 'top_up_food_near') await gatherNetherFood(bot, task, goal, save, now, { known: true, pending, short: want - carried });
    else await gatherNetherFood(bot, task, goal, save, now);
  } finally { spent.ms += Date.now() - started; save(); }
  return false;
}

// Food for the crossing, once Jev has chosen to gather it: the chest first,
// from wherever the bot is, then the plot, then the hunt. It never waits:
// it used to return having done nothing whenever the chest would not open
// and the animal search was resting, and the loop spun on it at twenty
// passes a second.
// A grown food animal in view within 32 blocks, hunted by the work itself
// (foraging.js hunt). The crossing's food used to leave an animal in view to
// the survival layer's stock hunt, and mid-244-ah's arbiter gave the turn to
// the work (turn_priority "work", 0.89) whose "hunt" only walked (note 594).
// One that could not be got to is kept as the survival layer keeps it
// (failedPrey), so the next pass takes another or goes on.
async function huntInView(bot, task, goal, save, kinds = null) {
  const foraging = require('./foraging'), { preyFailed } = require('./healing');
  const here = bot.entity.position;
  const target = Object.values(bot.entities || {}).filter(e => e?.position && e.isValid !== false && (!kinds || kinds.includes(e.name)) &&
    e.position.distanceTo(here) <= 32 && !preyFailed(goal, e) && foraging.preyFood(bot, e))
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
  if (!target) return false;
  goal.step = { ...goal.step, hunting: target.name, huntingAt: { x: Math.floor(target.position.x), y: Math.floor(target.position.y), z: Math.floor(target.position.z) } }; save();
  try { await foraging.hunt(bot, task, target, { navigate }, goal, save); }
  catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
    const state = goal.survival ||= {};
    state.failedPrey ||= {}; state.failedPrey[target.uuid || target.id] = Date.now(); save();
    console.log(`[food] hunting the ${target.name}: ${err.message}`);
  }
  return true;
}

async function gatherNetherFood(bot, task, goal, save, now = Date.now(), { known = false, pending = null, short = 0 } = {}) {
  const NETHER_FOOD = require('./crossing-kit').netherStay(bot).points;
  goal.preparingNether = true; goal.stockFood = true;
  // Jev chose the known food nearest the frame (or, with none begun, nearest
  // here): that one, and nothing farther. Gone or spent, the option goes
  // and the question comes back.
  if (known) {
    const src = foodNearFrame(bot, goal, pending, Math.max(1, short));
    if (!src) return;
    goal.step = { action: pending ? 'food_near_frame' : 'food_known', source: src.kind, at: src.at, distance: src.distance, ...(pending ? { fromFrame: src.onward } : {}), foodPoints: foodSupply(bot), required: NETHER_FOOD }; save();
    const home = require('./home-base').homeOf(bot, goal);
    if (src.kind === 'home_chest') await restockFromStash(bot, task, goal, save, home, homeActions(), []);
    else if (src.kind === 'home_plot') await require('./home-base').homeChores(bot, goal).harvest_and_bake?.run(bot, task, goal, save, homeActions());
    else if (src.kind === 'village') await require('./villages').eatFromVillage(bot, task, goal, save, src.village, homeActions());
    else if (src.kind === 'herd') await require('./sightings').walkToSighting(bot, task, goal, save, src.animal, src.sighting, navigate);
    else if (src.kind === 'in_view') await huntInView(bot, task, goal, save, [src.animal]);
    return;
  }
  const survivalState = goal.survival || {};
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
    return;
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
    return;
  }
  // Then the hunt. A search set aside as fruitless is taken up again:
  // gathering was chosen, and resting it was the stall.
  if (attempts.resting('food_search', 'stock', now)) { attempts.clear('food_search', 'stock'); unwatch(goal, 'food_search', 'stock'); }
  goal.step = { action: 'hunt_food_for_nether', foodPoints: foodSupply(bot), required: NETHER_FOOD }; save();
  // An animal in view is hunted; the search walks on only with none. It
  // searched for "animals", a name no block has, so it saw none and walked
  // past every cow (mid-244-ah, note 594).
  if (await huntInView(bot, task, goal, save)) return;
  await explore(bot, task, goal, save, 'animals', { surfaceOnly: true });
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
        strategy: (bot, task, goal, save, stage) => strategyStep(bot, task, goal, save, stage, { client: decisionClient, decide, sides: sideTrips(bot, goal, decisionClient),
          planFor: (b, item, count, g) => catalogPlan(b, item, count, planningInventory(b), g) }),
        acquireStep, acquireSetStep, return_overworld: returnFromNether, client: decisionClient,
        // The rods left in a chest in the Nether, taken out before the portal (rod-stash.js, note 704).
        stashActions: homeActions(),
        // Other work until a rung's rest ends, Jev's leave_nether wait_here:
        // the waiting stage's own work (note 605).
        hold_for_rest: (b, t, g, sv, { reason, until, why, idle }) => holdForRest(b, t, g, sv, { client: decisionClient, reason, until, why, idle }),
        // What that hold would have on offer from here, said on wait_here (note 675).
        rest_work: async (b, t, g, sv, { until }) => { const work = await restWork(b, t, g, sv, {}); return { idle: !work.length, says: restWorkSays(b, work, { until }) }; },
        planFor: (b, item, count, g) => catalogPlan(b, item, count, planningInventory(b), g),
        enter_nether: (bot, task, goal, save) => netherStep(bot, task, goal, save, decisionClient || task.opportunityClient),
        enter_end: (bot, task, goal, save) => enterEnd(bot, task, goal, save, { navigate }),
        fight_dragon: (bot, task, goal, save) => fightEndStep(bot, task, goal, save, { navigate, dig }, decisionClient),
        exit_end: (bot, task, goal, save) => exitEnd(bot, task, goal, save, { navigate }),
        prepare_combat: (bot, task, goal, save) => prepareCombatGear(bot, task, goal, save, { acquireStep }),
        barter: (bot, task, goal, save) => barterStep(bot, task, goal, save, { acquireStep, navigate }),
        bastion_gold: async (bot, task, goal, save) => {
          try { return await gatherBastionGold(bot, task, goal, save, { client: decisionClient, acquireStep, navigate, dig, place, approachDryMining, collectNearbyDrops,
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
        // The crossing's food rung: the way to it is Jev's (kitFoodStep, note 673).
        nether_food: (bot, task, goal, save, stage) => kitFoodStep(bot, task, goal, save, stage, decisionClient || task.opportunityClient),
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
            tunnel: (b2, t2, g2, sv2, target, opts = {}) => tunnelStep(b2, t2, g2, sv2, target, { dig, navigate, within: opts.within || null }) }, stage || goal.step),
        // Wolves sit before a crossing and stand again after (wolves.js).
        wolves: (bot, task, goal, save, sit) => require('./wolves').commandWolves(bot, task, goal, save, sit),
        // Back for a death's drops (corpse-run.js).
        corpse_run: (bot, task, goal, save) => require('./corpse-run').corpseRunStep(bot, task, goal, save, { move: navigate }),
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
  const arbiterLive = require('./arbiter').mode() === 'live';
  require('./arbiter').watch(bot);
  // Paced as runGoal's is: a stall answered at once, or an escalation
  // thrown and caught, went straight round again with no pause, 52,000
  // escalations in the idle loop of mid-242-ah-nether-1-fortress-1 (note 609).
  const spin = spinGuard();
  try {
  while (!until()) {
    await spin(goal);
    task.interruptCheck = undefined;
    // A stall is answered first, before anything can throw it again.
    const stall = takeStall(bot);
    if (stall && !escalatedToStep(stall)) { await inCatch(task, goal, () => answerStall(bot, task, goal, save, stall, { client: decisionClient, survival, onStep, idle: true })); failures = 0; save(); onStep(goal); continue; }
    // A preemption is the arbiter's to pick up, below.
    const held = loopCheck(task);
    if (held && !held.preempted) { await inCatch(task, goal, () => survival.step(task, goal, save, onStep)); save(); onStep(goal); continue; }
    updateDigCapabilities(bot);
    try {
      if ((bot.vehicle || bot._seatedIn != null) && await require('./boats').leaveStrandedVehicle(bot)) console.log('[work] sat in a boat between passes; got out');
      // Live, the arbiter rules first (it picks up a preemption before
      // anything checks the task again); the idle work below is the work's
      // turn, and the survival step runs there only when it claimed nothing.
      const turn = arbiterLive ? await liveTurn(bot, task, goal, goal, survival, save, { client: decisionClient, onStep, save, backstopFor: ['vitals'] }) : null;
      if (turn && turn.layer !== 'work') { if (!turn.acted) await sleep(250); }
      else {
        if (goal.recoveryAdvice?.active) {
          await maintainVitals(bot, task, () => {}, { client: task.opportunityClient, goal, save });
          if (await recoveryAdviser.step(task, goal, save)) { save(); onStep(goal); continue; }
        }
        await keepRoom(bot, task, goal);
        noticeVillage(bot, goal, save);
        noticeLandmarks(bot, goal, save);
        const acted = ((!turn || turn.unclaimed) && await survival.step(task, goal, save, onStep)) || await lootNearby(bot, task, goal, save, lootActions());
        if (!acted) await idleWork(bot, task, goal, save, decisionClient, onStep);
      }
      failures = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); narrate(bot, goal);
    } catch (err) {
      task.interruptCheck = undefined;
      if (err.name === 'Stalled' || bot._stalls?.stall) continue;
      if (loopCheck(task)) { noteError(goal, err); save(); onStep(goal); continue; }
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) failures++;
      noteError(goal, err); save(); onStep(goal);
      if (!['NeedsAir', 'NeedsSafety'].includes(err.name)) recoveryAdviser.recordFailure(goal, err);
      // Every way resting goes to Jev at once, as in runGoal's loop; three
      // failures go to persist, one mechanism, as there (note 571).
      if (err.name === 'WaysResting' || failures >= 3) { await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { client: decisionClient, survival, recoveryAdviser })); failures = 0; continue; }
    } finally { task.interruptCheck = undefined; }
    for (let n = 0; n < 10 && !bot._stalls?.stall; n++) { if (loopCheck(task)) break; await sleep(100); }
  }
  } finally { if (bot._stalls) bot._stalls.goalOf = null; task.stallCheck = undefined; require('./arbiter').unwatch(bot); }
  return { ok: true, goal };
}

// The request's claim on the turn (src/arbiter.js): its next step, and how
// it has been going. Always there while the request runs.
function workClaim(goal, bot = null) {
  if (!goal) return null;
  return { layer: 'work', action: goal.step?.action || 'step', urgency: 'routine', facts: { request: goal.request || goal.kind || null,
    ...(goal.step?.item || goal.step?.block ? { item: goal.step.item || goal.step.block } : {}), failures: goal.failures || 0, stalls: goal.stalls || 0,
    ...(goal.lastError ? { lastError: String(goal.lastError).slice(0, 160) } : {}), ...(goal.lastErrorAt ? { lastErrorAt: goal.lastErrorAt } : {}),
    // What the step is, in words, for turn_priority (mid-218-n, note 490).
    ...(goal.step?.action ? { doing: stepSays(goal.step, bot, goal) } : {}) } };
}
// An interrupted step resumed is said with what it has already got, not
// just its name and phase: a cast portal step resumed after a threat is
// said with the frame's own progress (how many of the ten are cast) and
// what is carried toward the next one (a lava or water bucket already in
// hand), so a "casting the portal frame" announcement right after an
// interruption reads as picking the cast back up, not starting it over.
// Without this, 25584 and 25591 (trial notes 738) went "Off to a lava pool
// with my buckets" every time a mob interrupted a cast in progress, and
// nothing said whether that was the frame's first bucket or its ninth.
function castProgressSays(step, goal, bot) {
  const frame = goal?.portalFrame;
  if (step.action !== 'cast_portal' || !frame || frame.ruin || !bot) return '';
  const cast = frame.blocks.filter(p => bot.blockAt?.(pos(p))?.name === 'obsidian').length;
  const carried = [];
  const lava = countOf(bot, 'lava_bucket'), water = countOf(bot, 'water_bucket');
  if (lava) carried.push(`${lava} lava bucket${lava === 1 ? '' : 's'}`);
  if (water) carried.push(`${water} water bucket${water === 1 ? '' : 's'}`);
  return `: ${cast} of ten cast, ${carried.length ? `${carried.join(' and ')} carried toward the next` : 'nothing carried toward the next'}`;
}
// A fortress already in reach is not "find fortress" as if none were
// known: 25592 sealed itself three blocks from the bricks while turn_priority
// kept saying "find fortress" with no word that one was right there (the
// critic of 08:17Z, note 734). find_fortress's own step carries `found`
// (the nearest brick) or `fortress` (the map's own anchor) once one is in
// view: said, with the distance, when the bot is not already on its floors
// (`walking` is set instead, and needs no restating here).
const stepFortressAt = step => step.action === 'find_fortress' && !step.walking ? (step.found || step.fortress) : null;
const stepSays = (step, bot = null, goal = null) => {
  const at = stepFortressAt(step);
  const near = at && bot?.entity?.position ? Math.round(Math.hypot(at.x - bot.entity.position.x, at.z - bot.entity.position.z)) : null;
  return `${String(step.action).replaceAll('_', ' ')}${step.item || step.block ? ` (${String(step.item || step.block).replaceAll('_', ' ')})` : ''}${step.phase ? `, ${String(step.phase).replaceAll('_', ' ')}` : ''}${at ? ` (a fortress in reach at (${Math.round(at.x)}, ${Math.round(at.y)}, ${Math.round(at.z)})${Number.isFinite(near) ? `, ${near} blocks off` : ''})` : ''}${castProgressSays(step, goal, bot)}`;
};

// The arbiter in shadow (src/arbiter.js): what it would give this pass to,
// from every layer's claim, beside what the layers below did. It acts on
// nothing, and a failure in it is logged once and passed over.
function shadowTurn(bot, goal, activeWork, survival) {
  return require('./arbiter').shadow(bot, () => [require('./survival').claim(bot, activeWork, survival), require('./vitals').claim(bot),
    require('./mob-hunt').claim(bot, activeWork), workClaim(goal, bot)]);
}
// The arbiter live (the default, src/arbiter.js): the turn goes to
// the claim it rules for, and each claim runs its layer's own step as the
// old loop ran it. The work's run only says it has the turn: the caller
// goes on to the work below. The hunt is staked first, whoever wins: the
// survival claim reads it (danger.js), as the old loop staked it first.
async function liveTurn(bot, task, goal, activeWork, survival, saveWork, { client, onStep, save, backstopFor }) {
  require('./mob-hunt').stakeHunt(bot, activeWork);
  let vitalsActed = false;
  const report = step => { vitalsActed = true; goal.survivalAction = { ...step, at: new Date().toISOString() }; save(); onStep(goal); };
  const runs = {
    survival: () => survival.step(task, activeWork, saveWork, () => onStep(goal)),
    // The meal by its own claim's test (vitals.js checkMeal, note 585); the
    // rest of the vitals by the work's.
    vitals: async claimed => {
      task.interruptCheck = bot.game.gameMode === 'creative' ? undefined : claimed?.action === 'eat' ? () => require('./vitals').checkMeal(bot) : () => checkThreats(bot);
      const ate = await maintainVitals(bot, task, report, { client, goal, save });
      return !!ate || vitalsActed;
    },
    hunt: () => huntObserved(bot, task, activeWork, saveWork, { navigate }, client),
    work: async () => true,
  };
  // A claim that throws is said once and counts as none: survival's step
  // then runs as the backstop, as it did before the arbiter.
  const read = f => { try { return f(); } catch (err) { if (!liveTurn.failed) { liveTurn.failed = true; console.log(`[arbiter] a claim failed (said once): ${err?.stack || err}`); } return null; } };
  const claims = [read(() => require('./survival').claim(bot, activeWork, survival)), read(() => require('./vitals').claim(bot)),
    read(() => require('./mob-hunt').claim(bot, activeWork)), workClaim(goal, bot)].map(c => c && { ...c, run: () => runs[c.layer](c) });
  return require('./arbiter').take(bot, claims, { task, goal, save, client, backstop: runs.survival, backstopFor });
}
// The layer an action reported during the survival step belongs to: the
// step runs the vitals' own meal and douse.
const reportedLayer = (before, after) => after?.at && after.at !== before && require('./vitals').ACTIONS.has(after.action) ? 'vitals' : null;

// The loop yields to the event loop every pass, and more than twenty passes
// a second is a spin: said with the step, and slowed. The line itself must
// never throw: JSON.stringify of a missing survival action is undefined, and
// its .slice threw out of runGoal, which parked the whole game "blocked";
// mid-242-ah-nether-1-fortress-1 and mid-243-af-nether-3-fortress-2 then
// stood in the idle loop for the rest of their trials (note 609).
const shown = (v, n) => String(JSON.stringify(v) ?? 'none').slice(0, n);
function spinGuard() {
  let passes = [];
  return async goal => {
    await new Promise(resolve => setImmediate(resolve));
    const now = Date.now(); passes = passes.filter(t => now - t < 1000); passes.push(now);
    if (passes.length > 20) {
      if (passes.length === 21 || passes.length % 200 === 0) console.log(`[loop] spinning: ${passes.length} passes in a second at ${shown(goal?.step, 200)} survival=${shown(goal?.survivalAction, 160)} error=${goal?.lastError || ''}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  };
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
  // Live, the arbiter gives the turn; in shadow the old order does and the
  // arbiter says where it would differ. The watch runs either way.
  const arbiterLive = require('./arbiter').mode() === 'live';
  require('./arbiter').watch(bot);
  try {
  // The loop yields to the event loop every pass and never spins: a step
  // that returns without waiting on anything real (a synchronous throw
  // swallowed by a handler) ran thousands of passes a second, the server
  // timed the player out and the process sat at 110% CPU four evenings
  // running. Every pass lets I/O run; more than twenty passes a second
  // is a spin, logged with the step so it can be found, and slowed.
  const spin = spinGuard();
  for (let n = 0; n < (goal.kind === 'follow' ? Infinity : goal.kind === 'build' ? Math.max(maxSteps, 30000) : maxSteps); n++) {
    await spin(goal);
    task.interruptCheck = undefined;
    // A stall (stillness.js) is answered first, before anything can throw
    // it again: the same thing differently, something else, or later.
    // An escalation to a plan's question (tried.js) is not answered here:
    // the step asks that question on this pass, with the failure below said.
    const stall = takeStall(bot);
    // The rung's question cut off before it was asked (a claim that outranks
    // the work was waiting, a threat, air): put off, and this pass goes on to
    // the turn it was cut off for; a later pass asks it (note 620).
    if (stall) {
      const answered = escalatedToStep(stall) || await answerOrPutOff(bot, stall, () => inCatch(task, goal, () => answerStall(bot, task, goal, save, stall, { client: decisionClient, survival, onStep, recoveryAdviser })));
      if (answered) {
        goal.failures = 0; goal.stalls = 0; save(); onStep(goal);
        if (!escalatedToStep(stall)) continue;
      }
    }
    // Progress against the goal (tried.js watchRung): ten minutes on the
    // rung without a new best raises the rung's question, kept by the
    // arbiter on the wall clock whoever holds the turn (note 599), and asked
    // of the work whatever the survival layer was doing at the time.
    if (require('./arbiter').rungWatch(bot, goal)) continue;
    // A signal the watchdogs hold for the survival layer: its turn now. A
    // preemption is the arbiter's to pick up, below.
    const held = loopCheck(task);
    if (held && !held.preempted) { await inCatch(task, goal, () => survival.step(task, goal, save, () => onStep(goal))); save(); onStep(goal); continue; }
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
    let turnShadow = null, layerNow = null, passError = null;
    try {
      let complete = false;
      const activeWork = goal.kind === 'bundle' ? goal.batchWork || goal.tasks.find(child => child.status !== 'complete') || goal : goal;
      const saveWork = () => { if (activeWork !== goal) { goal.step = { action: 'combined_request', item: activeWork.item, detail: activeWork.step }; goal.survivalAction = activeWork.survivalAction; } save(); };
      // A requested, equipped encounter can approach its selected mob. All
      // other survival work keeps the ordinary hostile-avoidance policy.
      const endTask = goal.kind === 'win' && dimension(bot) === 'end';
      // End combat owns the End's turn: no arbiter there, live or shadow.
      const ruled = arbiterLive && !endTask;
      let turn = null;
      if (ruled) {
        // The work's own backstop is below, after the recovery plan, as the
        // old order had it.
        turn = await liveTurn(bot, task, goal, activeWork, survival, saveWork, { client: decisionClient, onStep, save, backstopFor: ['vitals'] });
        if (turn.layer !== 'work') {
          if (turn.acted) { goal.stalls = 0; goal.failures = 0; delete goal.lastError; delete goal.lastErrorAt; }
          save(); onStep(goal);
          // Nothing done and the turn held: a breath, not a spin.
          if (!turn.acted) await sleep(250);
          continue;
        }
      }
      turnShadow = endTask || ruled ? null : shadowTurn(bot, goal, activeWork, survival); layerNow = 'hunt';
      if (!ruled) require('./turn').takeTurn(bot, 'hunt', 'observed');
      if (!endTask && !ruled && await huntObserved(bot, task, activeWork, saveWork, { navigate }, decisionClient)) {
        turnShadow?.gave('hunt');
        goal.failures = 0; goal.stalls = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); continue;
      }
      layerNow = 'work';
      if (goal.recoveryAdvice?.active) {
        await maintainVitals(bot, task, () => {}, { client: task.opportunityClient, goal, save });
        if (await recoveryAdviser.step(task, goal, save)) { turnShadow?.gave('work'); save(); onStep(goal); continue; }
      }
      // End combat owns eating and arena escape. Overworld nighttime shelter
      // choices are invalid in the End, where the dragon can destroy them.
      await keepRoom(bot, task, goal);
      const reportedBefore = activeWork.survivalAction?.at; layerNow = 'survival';
      // Live, the survival step runs here only when it claimed nothing
      // (arbiter.js take's backstop): what its claim cannot see yet.
      if (!endTask && (!ruled || turn.unclaimed) && await survival.step(task, activeWork, saveWork, () => onStep(goal))) {
        turnShadow?.gave(reportedLayer(reportedBefore, activeWork.survivalAction) || 'survival');
        goal.stalls = 0; goal.failures = 0; delete goal.lastError; delete goal.lastErrorAt; save(); onStep(goal); continue;
      }
      let vitalsActed = !!reportedLayer(reportedBefore, activeWork.survivalAction);
      task.interruptCheck = bot.game.gameMode === 'creative' || endTask ? undefined : () => checkThreats(bot);
      // Air and eating carried food are rules, not judgments: there is no
      // request that is better served by staying hungry with bread in hand.
      layerNow = 'vitals';
      if (!endTask && !ruled) {
        require('./turn').takeTurn(bot, 'vitals', 'maintain');
        await maintainVitals(bot, task, step => { vitalsActed = true; goal.survivalAction = { ...step, at: new Date().toISOString() }; save(); onStep(goal); }, { client: decisionClient, goal, save });
      }
      turnShadow?.gave(vitalsActed ? 'vitals' : 'work');
      require('./turn').takeTurn(bot, 'work', goal.step?.action || 'step');
      // Air is the body's, before any step: every step stops at the check
      // while the head is in a block or the breath is short, a craft at the
      // table or a wait on a window as a dig or a walk does. The work's
      // check was the threats alone, and only digs and walks looked at the
      // air (note 680).
      task.interruptCheck = bot.game.gameMode === 'creative' || endTask ? undefined : () => { checkAir(bot); checkThreats(bot); };
      if (!endTask && await upkeepStep(bot, task, goal, save, decisionClient, onStep)) { goal.stalls = 0; save(); onStep(goal); continue; }
      bot._goal = goal; bot._goalSave = save;
      if (!endTask && await sculkStep(bot, task, goal, save, decisionClient, onStep)) { goal.stalls = 0; save(); onStep(goal); continue; }
      // A structure's chest within reach is opened as a rule (looting.js).
      if (goal.kind === 'win' && !endTask && await inCatch(task, goal, () => lootNearby(bot, task, goal, save, lootActions()))) { goal.stalls = 0; save(); onStep(goal); continue; }
      // Work starts on dry ground. A crafting table placed from a pool under
      // the base failed and failed, the bot bobbing for air in between.
      const feetBlock = typeof bot.blockAt === 'function' ? bot.blockAt(bot.entity.position.floored()) : null;
      if (!endTask && feetBlock?.name && swimmableWater(feetBlock) && !crossingWater(bot)) {
        try { if (!dryStanding(bot, bot.entity.position) && await reachShore(bot, task, goal, save, { client: decisionClient, dig })) { goal.stalls = 0; save(); onStep(goal); continue; } }
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
      if (prepared && goal.kind === 'nether') complete = await netherStep(bot, task, goal, save, decisionClient || task.opportunityClient);
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
      // A wait the step holds by choice (by a spawner, health coming back:
      // stillness.js stepWait) is not a pass that changed nothing (note 681).
      goal.stalls = !unchanged || goal.kind === 'follow' ? 0 : (goal.stalls || 0) + (require('./stillness').stepWait(bot, goal) ? 0 : 1);
      // A struggle ends on progress against the goal (tried.js watchRung, a
      // new best on the rung), not on any movement: an eight-block walk off
      // and back set it to nothing, and "attempt 1" came round again and
      // again at the same failure (note 571).
      // A restock that changes nothing (the chest does not hold what its
      // record says, or the kit slot is already met another way) would be
      // planned again at once: the replay run restocked a furnace forty
      // times over. Its items rest for a quarter of an hour.
      if (goal.stalls > 30 && goal.step?.action === 'restock') for (const move of goal.step.items || []) setAside(goal, 'restock_item', move.item, 'no measurable progress', 900000);
      if (goal.stalls > 30) throw new Blocked(`No measurable progress on ${JSON.stringify(goal.step)}`);
    } catch (err) {
      task.interruptCheck = undefined;
      // Thrown before a layer said it had the turn: the one that was
      // running (not bot._turn, which the hunt marks before it looks).
      turnShadow?.gave(layerNow);
      // What ended the answers under way: a failure or a stall, not the
      // survival layer taking the turn (the answer is not over).
      if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name) && !err.stall?.escalated) passError = err.message;
      // Taken from the answers under way by the survival layer or a
      // cancellation: cut short, not tried and come to nothing (tried.js).
      else if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) require('./tried').cut(goal, `cut short: ${String(err.message || err.name).slice(0, 100)}`);
      if (err.name === 'Stalled' || bot._stalls?.stall) continue;
      if (loopCheck(task)) { noteError(goal, err); save(); onStep(goal); continue; }
      noteError(goal, err);
      if (err.name === 'DesignRepair') { save(); onStep(goal); continue; }
      // A mob that stopped the work ends the ruling that gave it the turn
      // (arbiter.js): the work runs after the arbiter hands it the turn,
      // outside its own catch, so note 504's rule never saw it; mid-236-k's
      // bucket fill was stopped by three skeletons for ten seconds, handed
      // back each pass, until health fell six (note 506).
      if (err.name === 'NeedsSafety') { const ruling = bot._arbiter?.ruling; if (ruling?.winner === 'work') ruling.stoppedBy = String(err.message || '').slice(0, 120); }
      if (err.name === 'NeedsAir' || err.name === 'NeedsSafety') { save(); onStep(goal); continue; }
      // A step for where the bot is not (iron ore in the Nether) is dropped,
      // with the stalled step it came back as, and the ladder plans again
      // for where it is: the stall's answer put mid-242-q's Overworld iron
      // step back in hand after the portal, and it was tried and failed
      // until the loop watch ended the trial (note 433).
      // Again and again (the ladder planning the same step here each pass),
      // the stage it came from is set aside ten minutes and the held choice
      // let go: mid-218-l, in the Nether, was asked for oak logs some
      // thirty-seven hundred times in ten minutes, standing still (note 458).
      if (err.name === 'WrongDimension') {
        const prev = goal.wrongDimension;
        const n = prev && Date.now() - prev.at < 60000 ? prev.n + 1 : 1;
        const phase = goal.rungTime?.phase || goal.gameProgress?.phase || null;
        // The step that met it is kept with the record: dropped from hand,
        // the stall question said "step:none" and named nothing
        // (mid-227-r-nether-1, note 476). The ladder reads the set-aside
        // below and puts the routes to Jev (game-progress.js asideStage).
        goal.wrongDimension = { n, at: Date.now(), error: err.message, phase, block: err.block, to: err.dimension,
          step: goal.step?.action === 'persist' ? goal.lastStruggleStep || null : goal.step || null, from: (err.stack || '').split('\n').slice(1, 6).map(l => l.trim()) };
        if (n >= 3) {
          if (phase) setAside(goal, 'rung', phase, err.message, 600000);
          delete goal.strategy;
          console.log(`[work] ${err.message}, ${n} times in a minute: ${phase ? `the ${phase} step set aside ten minutes` : 'nothing to set aside'}`);
        }
        delete goal.step; delete goal.lastStruggleStep; goal.failures = 0; save(); onStep(goal);
        await sleep(1000);
        continue;
      }
      // A partial craft/build can change inventory before its promise fails.
      // Replan that observed progress; only consecutive no-progress errors
      // exhaust retries.
      // Every way resting (tunneling.js WaysResting) is a fact to answer,
      // not a failure to retry: nothing tried again changes it before its
      // time. mid-229-m's lava step ran twenty-five times a second at a pool
      // whose every way rested, and persist put it back each time
      // (2026-09-27). Jev hears it at once, as the failure.
      if (err.name === 'WaysResting') {
        if (goal.step?.action !== 'persist') goal.lastStruggleStep = goal.step;
        await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { client: decisionClient, survival, recoveryAdviser }));
        continue;
      }
      goal.failures = before === JSON.stringify(inventory(bot)) && location.distanceTo(bot.entity.position) < 2 &&
        constructionBefore === constructionObservation(bot, goal) ? goal.failures + 1 : 0;
      recoveryAdviser.recordFailure(goal, err);
      // One mechanism answers a failure (note 571): persist, below, whose
      // question offers the recovery moves among its answers. The recovery
      // adviser had been asked first on the same failures, a second question
      // with its own limits and memory, and persist after it.
      // Parked, not retried: a request no survival route can serve, or a
      // state only the player can settle (items dropped for them whose
      // pickup nobody saw). The regex is the old list; `needsPlayer` is
      // how a new case says so without adding to it.
      if (err.name === 'Blocked' && (err.needsPlayer || IMPOSSIBLE.test(err.message))) {
        // Impossible is final and resume passes over it; waiting on the
        // player is not, and "Jev resume" takes it up again.
        goal.status = 'blocked'; if (!err.needsPlayer) goal.impossible = true;
        if (err.waitOn) goal.waitingOn = { ...err.waitOn, since: new Date().toISOString() };
        save();
        bot.chat(`${friendlyProblem(err)} I saved our progress. ${recoveryHint(err)}`);
        return { ok: false, reason: err.message, goal };
      }
      if (err.name === 'Blocked' || goal.failures >= 3) {
        // The step that failed, not the last retry: a step that throws
        // before it names itself leaves the retry's name on the goal.
        if (goal.step?.action !== 'persist') goal.lastStruggleStep = goal.step;
        await inCatch(task, goal, () => persist(bot, task, goal, save, err, onStep, { client: decisionClient, survival, recoveryAdviser }));
        continue;
      }
      await sleep(300);
    } finally {
      task.interruptCheck = undefined;
      // What came of the answers given this pass (tried.js): settled where
      // something came of them or the pass failed; one still under way (a
      // leg walked over many passes) stays open.
      require('./tried').settle(bot, goal, { passEnd: true, error: passError });
    }
    save(); onStep(goal);
  }
  goal.status = 'blocked'; goal.lastError = 'Action budget reached'; save();
  bot.chat('This is taking a while. I saved our progress. Say "Jev resume" to keep going.');
  return { ok: false, reason: goal.lastError, goal };
  } finally { stopObserving(); if (bot._stalls) bot._stalls.goalOf = null; task.stallCheck = undefined; require('./arbiter').unwatch(bot); }
}

// Placement in Creative consumes no inventory. Observe the actual construction
// blocks, including cleared obstructions, when deciding whether work progressed.
function constructionObservation(bot, goal) {
  const positions = [...(goal.blueprint?.blocks || []), ...(goal.blueprint?.empty || []), ...(goal.portalFrame?.blocks || [])];
  return JSON.stringify(positions.map(p => [p.x, p.y, p.z, bot.blockAt(pos(p))?.stateId ?? bot.blockAt(pos(p))?.name ?? null]));
}

module.exports = { wantedItems, keepRoom, tidyMoment, smeltBatch, ladderSmeltWants, foodReservePrice, siteByLava, foodTrips, supportMaterialHere, preparePortalSupports, portalJobs, castSiteCost, castSiteSays, NO_WOOD_DEEP, smeltNeedSays, takeBackPlace, detourWork, restWork, restWorkSays, upkeepOffers, kitFoodStep, foodNearFrame, cookable, FUELS, answerOrPutOff, opensPit, persist, returnFromNether, climbSays, holdForRest, liveTurn, workClaim, methodSoFar, gatherBlocks, sculkStep, opensLava, descentTargets, portalInteriorBlockers, nearestLava, lavaGone, mineAtSource, timed, portalHere, walkToKnownPortal, portalWay, lineSays, buildPortalFrame, ruinSays, portalMethod, portalStep, crossingKitReady, walksFailed, occupant, bodyIn, occupiedSays, waitingThere, settleCraftInventory, tripTime, WOOD_RESERVE, woodUnits, crossingWater, sideTrips, plugLeak, leakResponse, logInView, patrolChoice, upkeepStep, moreOfSource, whileCooking, workstation, noteError, localBatch, takeOutBatch, castUnderWay, leftBatch, batchNoRoute, LEAVE_BATCH_MS, smelt, turnSearch, searchFor, enterPortal, gameHandlers, breakStillness, reachableBlocks, hitboxIntrudes, terrainShortage, runGoal, runIdle, idleWork, idleOptions, createSurvival, acquireStep, inventory, planningInventory, catalogPlan, selectSite, explore, dig, place, waitFor, constructionObservation, Blocked, designedBuildStep, surfaceStep, surfaceTrip, answerStall, looseEnds, breakOut, tunnelToward, stairsOrWay, craft, gatherWood, moveOnFromResource, moveOnHistorySays, pickaxeCraftHistorySays, maintainPickaxe, MOVE_ON_MEMORY_MS, PICKAXE_CRAFT_MEMORY_MS, stationCellOk, droppedFoodNear, planDueNow, planRoutes, lavaKnownFrom, straightToward };
