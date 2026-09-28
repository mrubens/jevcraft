'use strict';
const DEATH_WORDS = /^(was |were |died|drowned|fell|burned|went up in flames|tried to swim|blew up|hit the ground|starved|suffocated|froze|withered|walked into|experienced kinetic|discovered the floor)/;

const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('./movement');
const { interpret, GoalStore } = require('./objectives');
const { designerAvailable } = require('./designer');
const { WorldKnowledge } = require('./world-knowledge');
const { DAY } = require('./day');
const { setAside, isSetAside, attemptsFor } = require('./progress');
const { planCatalog } = require('./knowledge');
const { runGoal, runIdle, createSurvival } = require('./work');
const { Task } = require('./skills');
const { parseAddress, chatNames, clarificationReply, CLARIFY_MS } = require('./chat-address');
const { compatibilityPlugin } = require('./compatibility');
const { requestedCommand, createCommandAccess } = require('./commands');
const { classifyCommand } = require('./command-classifier');
const { recordDeath, observeAliveInventory } = require('./recovery');
const { statusMessage } = require('./status');
const { bundleSummary } = require('./item-bundle');
const { friendlyProblem, intakeProblem, recoveryHint, quietRepeats, thinking } = require('./speech');
const { withRequestSignal } = require('./typesafe');
const { suspendPrevious, resumeSaved, waitingCleared } = require('./suspended-tasks');
const { CompanionMemory, position } = require('./memory');
const { BuildRegistry, resolveBuildContinuation } = require('./builds');
const { nextDreamRequest, shouldLaunchDream, DREAMS, FAILED_LAUNCH_MS } = require('./dream');
const { immediateThreat } = require('./danger');
const { Ledger, withRun, appendSummary } = require('./ledger');

// The planner's verdict on a request, before any work starts: an error
// when no survival method exists for something asked for, otherwise null.
// Only that verdict: a plan that fails for want of a tool or a place is
// work, and runGoal finds its way round those.
function unworkable(bot, spec) {
  if (bot.game?.gameMode !== 'survival' || !['obtain', 'craft', 'bundle'].includes(spec.kind)) return null;
  const wanted = spec.kind === 'bundle' ? (spec.tasks || []).map(t => [t.item, t.count]) : [[spec.item, spec.count]];
  const stock = {};
  for (const item of bot.inventory.items()) stock[item.name] = (stock[item.name] || 0) + item.count;
  for (const [item, count] of wanted) {
    if (!item) continue;
    try { planCatalog(bot.registry, item, count || 1, stock); }
    catch (err) { if (err.name === 'PlanError' && /No supported survival acquisition/.test(err.message)) return err; }
  }
  return null;
}

function createSession(config, client, { stateDirectory = path.join(__dirname, '..', '.bot-state'), recorder,
  runLedger = path.join(stateDirectory, 'run-ledger.md') } = {}) {
  let ended = false, spawned = false, resolveClosed;
  const connectedAt = Date.now();
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const bot = mineflayer.createBot({ ...config, respawn: false });
  global.__jevBot = bot;
  // The damage types by index, from the registry the server sends before
  // login, for the flight record's damage frames (recorder/observer.js).
  bot._damageTypeNames = [];
  // Freezing, from the server's own word: powder snow has no collision
  // box, and a bot standing in it was not always seen to be (mid-202-f
  // froze to death at y 121 with the way out tried once, note 308).
  // Standing in fire, the same way (vitals.js inFire): mid-229-g burned from
  // eleven health to none in a fire a ghast's fireball lit (note 340).
  bot._client.on('damage_event', packet => {
    if (!bot.entity || packet.entityId !== bot.entity.id) return;
    const type = bot._damageTypeNames?.[packet.sourceTypeId];
    if (type === 'freeze') bot._freezingAt = Date.now();
    if (type === 'in_fire') bot._inFireAt = Date.now();
    // What each lights the bot for, the longer kept (combat-estimate
    // burnLeft): the fire on the bot is in every stance's figures (note 548).
    const lights = require('./combat-estimate').FIRE_SECONDS[type];
    if (lights) bot._alightUntil = Math.max(bot._alightUntil || 0, Date.now() + lights * 1000);
    // A warden's boom, counted for the pocket's question (survival.js
    // wardenSays): mid-230-n was boomed through its pocket's wall and asked
    // again told nothing of it (note 412).
    if (type === 'sonic_boom') (bot._sonicBooms ||= []).push(Date.now());
  });
  // When each of the bot's own effects came: mineflayer keeps the length the
  // server sent, and what is left of a poison or a wither is that less the
  // time since (combat-estimate effectLeft; note 542).
  bot.on('entityEffect', (entity, effect) => { if (entity === bot.entity && effect) effect.at = Date.now(); });
  // Each shriek of a sculk shrieker darkens the players about it: counted
  // as the warnings toward a warden (sculk.js).
  bot.on('entityEffect', (entity, effect) => {
    if (entity !== bot.entity || effect?.id !== bot.registry?.effectsByName?.darkness?.id) return;
    const shrieks = bot._shrieks ||= [];
    if (!shrieks.length || Date.now() - shrieks.at(-1) > 5000) shrieks.push(Date.now());
  });
  bot._client.on('registry_data', packet => { if (/damage_type/.test(String(packet?.id || '')) && Array.isArray(packet.entries)) packet.entries.forEach((e, i) => { bot._damageTypeNames[i] = String(e.key || e.id || '').replace('minecraft:', ''); }); });
  bot.on('physicsTick', () => { if (!ended) observeAliveInventory(bot); });
  bot.on('handover', event => { if (!ended) console.log(JSON.stringify({ handover: event })); });
  for (const event of ['recovery_advice', 'recovery_result']) bot.on(event, data => {
    if (ended) return;
    const record = data.record || data;
    console.log(JSON.stringify({ [event]: { status: record.status, source: record.source, model: record.model, diagnosis: record.diagnosis,
      jev: record.jev?.judgment, steps: record.steps, outcome: data.outcome || record.outcome, latencyMs: record.latencyMs, usage: record.usage } }));
  });
  bot.loadPlugin(compatibilityPlugin);
  bot.loadPlugin(pathfinder);
  // Every goal the pathfinder is given, by any route (goto calls setGoal),
  // is made whole first: one without isValid crashed the process four
  // times. A plugin, so it is injected after the pathfinder's: wrapped here
  // directly it found no pathfinder yet (plugins inject a tick later) and
  // wrapped nothing.
  bot.loadPlugin(require('./skills').goalGuardPlugin);
  bot.loadPlugin(require('./skills').digGuardPlugin);
  bot.loadPlugin(require('./gaze').gazePlugin);
  bot.loadPlugin(require('./riders').ridersPlugin);
  // A window click the window refuses ("invalid operation") is logged with
  // the click and the window, so the craft that made it can be named: it
  // failed crafts twenty and more times a trial in mid-215-c and mid-220-a
  // with no more said than that (2026-09-26).
  bot.once('inject_allowed', () => {
    const click = bot.clickWindow;
    if (typeof click !== 'function') return;
    bot.clickWindow = async (slot, mouseButton, mode, ...rest) => {
      try { return await click.call(bot, slot, mouseButton, mode, ...rest); }
      catch (err) {
        if (/invalid operation/.test(err?.message || '')) {
          const w = bot.currentWindow || bot.inventory;
          console.log(`[window] invalid click ${JSON.stringify({ slot, mouseButton, mode, window: w?.type, inventoryEnd: w?.inventoryEnd, selected: w?.selectedItem?.name ?? null })} ${String(err.stack || '').split('\n').slice(1, 6).map(l => l.trim()).join(' | ')}`);
        }
        throw err;
      }
    };
  });
  // Mineflayer injects its own chat plugin after createBot, which would
  // overwrite a wrapper installed now; the filter goes on once chat exists.
  bot.once('spawn', () => quietRepeats(bot));
  // A new build is taken at a quiet moment (quiet-restart.js).
  if (!process.env.JEV_NO_QUIET_RESTART) bot.once('spawn', () => require('./quiet-restart').watchRestartRequest(bot, path.join(stateDirectory, 'restart-requested'), { startedAt: connectedAt }));
  const identity = `${config.host}-${config.port}-${config.username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const commandLog = path.join(stateDirectory, `${identity}-commands.jsonl`);
  bot._client.on('declare_commands', tree => {
    if (ended) return;
    bot.commandTree = tree;
    fs.mkdirSync(path.dirname(commandLog), { recursive: true });
    fs.writeFileSync(path.join(stateDirectory, `${identity}-command-tree.json`), JSON.stringify(tree));
  });
  let commandAccess;
  bot.loadPlugin(() => { commandAccess = createCommandAccess(bot, {
    users: (process.env.MC_COMMAND_USERS || '').split(',').map(name => name.trim()).filter(Boolean),
    audit: event => { fs.mkdirSync(path.dirname(commandLog), { recursive: true }); fs.appendFileSync(commandLog, JSON.stringify(event) + '\n'); },
  }); });
  const store = new GoalStore(path.join(stateDirectory, `${identity}.json`));
  const memoryIdentity = process.env.MC_WORLD_ID ? `${identity}-${process.env.MC_WORLD_ID.replace(/[^a-zA-Z0-9_-]/g, '_')}` : identity;
  // The base, its bed and the shelters are places in one world. Kept per
  // server, a new world on the same port inherited them, and the bot walked
  // home at dusk to a bed that was never there.
  const survivalStore = new GoalStore(path.join(stateDirectory, `${memoryIdentity}-survival.json`));
  const idleStore = new GoalStore(path.join(stateDirectory, `${identity}-idle.json`));
  const memorySeed = store.read(), needsMemoryId = memorySeed && !memorySeed.memoryId;
  const memory = new CompanionMemory(path.join(stateDirectory, `${memoryIdentity}-memory.json`), {
    seedGoal: memorySeed, seedResources: { ...idleStore.read()?.resourceMemory, ...memorySeed?.resourceMemory },
  });
  if (needsMemoryId && memorySeed.memoryId) store.save(memorySeed);
  bot.companionMemory = memory;
  // Structures outlive the goal that built them, so this store is keyed to the
  // world rather than the request and is shared by every later build.
  const builds = new BuildRegistry(path.join(stateDirectory, `${memoryIdentity}-builds.json`));
  bot.buildRegistry = builds;
  // The dream: what the bot works toward when nobody has asked for
  // anything. Kept per world, beside the builds it produces.
  const dreamStore = new GoalStore(path.join(stateDirectory, `${memoryIdentity}-dream.json`));
  const saveDream = standing => { if (!ended) dreamStore.save({ version: 1, ...standing }); };
  // Portals, villages, the End portal and the run's progress: kept per
  // world and handed to every goal, not left on the goal that found them.
  // Seeded from the old per-server goal stores only where they can be this
  // world's: with a world id they may be another world's, and a new world
  // began with the old one's portals and game progress.
  const world = new WorldKnowledge(new GoalStore(path.join(stateDirectory, `${memoryIdentity}-world.json`)),
    { seedFrom: memoryIdentity === identity ? [store.read(), idleStore.read()] : [] });
  // The cost ledger: every Jev call charged to the request or dream it
  // served, kept per world, and summarized to run-ledger.md in the state directory when a run
  // ends. The client feeds it; the session only says which run is paying.
  const ledger = new Ledger(path.join(stateDirectory, `${memoryIdentity}-ledger.json`), {
    age: () => bot.time?.age, onClose: run => { if (runLedger) appendSummary(runLedger, run); } });
  client.ledger = ledger;
  // Whatever is active pays for the calls made on its behalf; with nothing
  // active, an idle bot that has a dream is still that dream's cost.
  const routed = withRun(client, () => active?.goal.ledgerRun ?? dreamStore.read()?.ledgerRun);
  const dreamName = key => `dream · ${DREAMS[key].title}`;
  // The dream's run in the ledger. A standing from before the ledger
  // existed gets one now, dated from when the dream was given.
  function dreamRun(standing) {
    if (!standing?.dream || standing.satisfiedAt || ended) return standing?.ledgerRun;
    const run = ledger.open({ id: standing.ledgerRun, kind: 'dream', name: dreamName(standing.dream), startedAt: standing.setAt });
    if (standing.ledgerRun !== run.id) { standing.ledgerRun = run.id; saveDream(standing); }
    return run.id;
  }
  dreamRun(dreamStore.read());
  const readyForDream = () => bot.game?.gameMode === 'creative' ||
    ((bot.game?.dimension !== 'minecraft:overworld' && bot.game?.dimension !== 'overworld' || (bot.time?.timeOfDay ?? 0) < DAY.DUSK) &&
      (bot.health ?? 20) >= 14 && (bot.food ?? 20) >= 12 && !immediateThreat(bot));
  let launchingDream = false;
  // The old goal's copy only where it can be this world's: with a world id
  // the goal store is still per server.
  const survival = createSurvival(bot, { state: survivalStore.read() || (memoryIdentity === identity ? store.read()?.survival : undefined), client: routed });
  if (!survivalStore.read() && store.read()?.status === 'cancelled') survival.state.paused = true;
  const saveSurvival = () => { if (!ended) { survival.state.version = 1; survivalStore.save(survival.state); } };
  const saveGoal = goal => { if (!ended) { memory.recordGoal(goal, bot); world.harvest(goal); store.save(goal); } };
  const workStore = { save: goal => { saveGoal(goal); saveSurvival(); } };
  let active = null;
  // A goal going again after a threat escaped its loop (launch's catch).
  let relaunching = false;
  let pending = Promise.resolve();
  let generation = 0;
  let requestController = new AbortController();
  function invalidateRequests() {
    generation++;
    requestController.abort(new Error('Player request interrupted'));
    requestController = new AbortController();
  }
  let ready = false;
  let pendingRequests = 0;
  let observation;

  async function stop(status = 'cancelled') {
    if (status === 'cancelled') { survival.state.paused = true; saveSurvival(); }
    if (!active) {
      if (status === 'cancelled') {
        const saved = store.read();
        if (saved && ['pending', 'running', 'recovering'].includes(saved.status)) { saved.status = 'cancelled'; saveGoal(saved); }
      }
      return;
    }
    active.task.cancel();
    if (!active.idle) { active.goal.status = status; workStore.save(active.goal); }
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    bot.stopDigging();
    bot.deactivateItem();
    await active.promise;
  }

  function launch(goal) {
    world.hydrate(goal);
    memory.bind(goal);
    goal.memoryContext = memory.context(goal.from);
    survival.state.paused = false; delete survival.state.idleBlocked; delete survival.state.deathBlocked; saveSurvival();
    // The goal's calls are charged to its run: the dream's when the dream
    // launched it, otherwise the request's own, picked back up by id.
    if (goal.dream) goal.ledgerRun = dreamRun(dreamStore.read()) ?? goal.ledgerRun;
    else goal.ledgerRun = ledger.open({ id: goal.ledgerRun, kind: 'request', name: goal.request, startedAt: goal.createdAt }).id;
    const task = new Task(goal.kind, goal.request);
    const session = { task, goal };
    active = session;
    session.promise = runGoal(bot, task, goal, workStore, {
      decisionClient: routed, survival,
      onStep: g => {
        console.log(JSON.stringify({ status: g.status, step: g.step, decision: g.decisions?.at(-1), position: bot.entity.position, error: g.lastError })); observation?.sample('step', undefined, g);
        // Every step change, not only the one a second the supervisor sees:
        // mid-110-f's staircase and retreat traded seven times in eight
        // seconds, between its looks, and the audit caught what it did not.
        try { if (bot.game?.gameMode !== 'creative') require('./stillness').flipWatch(bot, g); } catch (_) { /* a look missed */ }
      },
    }).catch(err => {
      // A threat or a breath that escaped the goal's own loop is the moment,
      // not the goal: the dream run was parked "blocked" on "Threat nearby:
      // something unseen at 0 blocks" and stood idle for sixteen hours
      // (2026-09-25). It goes again in a few seconds, from where it is.
      // Five in a minute is not a moment, and is parked as before.
      const recent = (goal.relaunches || []).filter(t => Date.now() - t < 60000);
      if (['NeedsSafety', 'NeedsAir'].includes(err.name) && recent.length < 5) {
        goal.relaunches = [...recent, Date.now()]; goal.lastError = err.message; saveGoal(goal);
        observation?.sample('error', { message: err.message, relaunch: true }, goal);
        session.relaunch = true;
        return;
      }
      if (err.name !== 'Cancelled') {
        goal.status = 'blocked'; goal.lastError = err.message; saveGoal(goal);
        observation?.sample('error', { message: err.message }, goal);
        console.error(err); bot.chat(`${friendlyProblem(err)} ${recoveryHint(err)}`);
      }
    }).finally(() => {
      if (active === session) active = null;
      if (session.relaunch) {
        relaunching = true;
        setTimeout(() => { relaunching = false; if (!ended && !active) launch(goal); }, 1500);
        return;
      }
      if (!goal.dream && ['complete', 'blocked'].includes(goal.status)) ledger.close(goal.ledgerRun, goal.status);
    });
  }

  // Hand the dream its next request, as if a player had typed it. Jev
  // chooses the milestone from what code enumerates; a failure to choose or
  // an unusable answer falls back to ordinary idling until the cool-down ends.
  async function launchDream(standing) {
    launchingDream = true;
    try {
      const structures = builds.describe(bot, bot.entity.position, bot.game.dimension);
      const runId = dreamRun(standing);
      const next = await nextDreamRequest(withRun(client, runId), standing, { structures, shelf: require('./schematic-library').library(bot.registry), designer: designerAvailable(bot) });
      if (ended || active) return;
      standing.lastAttemptAt = Date.now();
      if (!next || next.done) {
        standing.satisfiedAt = new Date().toISOString(); standing.lastScore = next?.villageScore; delete standing.ledgerRun; saveDream(standing);
        ledger.close(runId, 'satisfied');
        bot.chat(`I think my dream to ${DREAMS[standing.dream].title} is done for now. Tell me to chase it again if you want more.`);
        return;
      }
      attemptsFor(survival).clear('dream_launch', standing.dream); saveDream(standing);
      const goal = { ...next, ledgerRun: runId, version: 1, status: 'pending', createdAt: new Date().toISOString(), suspendedTasks: suspendPrevious(store.read()),
        requesterPosition: null, initialInventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
      saveGoal(goal);
      const firstRung = next.kind === 'win' ? require('./game-progress').nextGameStage(bot, goal).phase?.replaceAll('_', ' ') : null;
      bot.chat(`Nothing needs me, so I'm chasing my dream to ${DREAMS[standing.dream].title}${next.villageScore !== undefined && next.villageScore !== null ? ` (the village is ${Math.round(next.villageScore * 100 / 3)}% there)` : ''}${firstRung ? `. First: ${firstRung}.` : `: ${next.request}.`}`);
      launch(goal);
    } catch (err) {
      console.error('[dream]', err.message);
      standing.lastAttemptAt = Date.now(); saveDream(standing);
      setAside(survival, 'dream_launch', standing.dream, err, FAILED_LAUNCH_MS); saveSurvival();
    } finally { launchingDream = false; }
  }

  function launchIdle() {
    const retained = store.read();
    const standing = dreamStore.read();
    if (standing?.dream && !launchingDream && shouldLaunchDream(standing, retained, { ready: readyForDream(), resting: isSetAside(survival, 'dream_launch', standing.dream) })) { launchDream(standing); return; }
    const goal = { ...(idleStore.read() || {}), version: 1, kind: 'survive', request: 'Stay alive and prepare supplies between player requests',
      retainedRequest: retained?.request, blueprint: retained?.blueprint, survival: survival.state,
      // A dream set aside is not chased by the idle loop either.
      dream: standing?.dream && !standing.satisfiedAt && !standing.paused ? standing.dream : undefined,
      ledgerRun: standing?.dream && !standing.satisfiedAt && !standing.paused ? standing.ledgerRun : undefined };
    world.hydrate(goal);
    memory.bind(goal);
    const task = new Task('survival', goal.request);
    const session = { task, goal, idle: true };
    active = session;
    // The idle loop runs until something else should: a dream whose
    // next request can be launched ends it, and the next tick launches that.
    let checkedAt = 0, launchable = false;
    const until = () => {
      if (Date.now() - checkedAt < 3000) return launchable;
      checkedAt = Date.now();
      const current = dreamStore.read();
      launchable = !!current?.dream && shouldLaunchDream(current, store.read(), { ready: readyForDream(), resting: isSetAside(survival, 'dream_launch', current.dream) });
      return launchable;
    };
    session.promise = runIdle(bot, task, goal, { save: g => { if (!ended) { world.harvest(g); idleStore.save(g); memory.flush(); } saveSurvival(); } }, {
      survival, decisionClient: routed, until,
      onStep: g => { console.log(JSON.stringify({ idle: true, survivalAction: g.survivalAction, decision: g.decisions?.at(-1)?.path, health: bot.health, food: bot.food, position: bot.entity.position, error: g.lastError })); observation?.sample('step', undefined, g); },
    }).catch(err => {
      if (err.name !== 'Cancelled') {
        survival.state.idleBlocked = err.message; saveSurvival();
        observation?.sample('error', { message: err.message }, goal);
        console.error(err); bot.chat(friendlyProblem(err));
      }
    }).finally(() => { if (active === session) active = null; });
  }

  async function resume(revision = generation, options) {
    if (active?.idle) await stop('interrupted');
    // The dream is what the bot does with nobody's work waiting. A player's
    // stopped or replaced request under it comes first; the dream picks up
    // again, knowing what it knew, once that is done.
    if (active?.goal.dream && !options?.currentOnly) {
      const waiting = resumeSaved({ ...active.goal, status: 'replaced' });
      if (waiting && !waiting.dream) await stop('replaced');
    }
    if (revision !== generation || ended) return;
    if (active) { bot.chat('Already working on the saved task.'); return; }
    const current = store.read(), saved = resumeSaved(current, options);
    if (!saved || saved.status === 'complete') {
      survival.state.paused = false; delete survival.state.idleBlocked; delete survival.state.deathBlocked; saveSurvival();
      bot.chat("I'm back! I'll look after myself while I wait for your next task."); return;
    }
    delete saved.waitingOn;
    if (saved.kind === 'build' && !saved.design) saved.designAttempts = 0;
    if (saved !== current) bot.chat(`Back to your earlier task: ${saved.request}.`);
    launch(saved);
  }
  // The flight recording: what the bot sees and decides, for the audits.
  observation = recorder?.attach(bot, {
    server: `${config.host}:${config.port}`,
    getGoal: () => active?.goal || store.read() || {},
  });

  // One open question per player, answered within a minute and a half or
  // not at all.
  const clarifying = new Map();

  // A build parked on a block someone else put on its site is taken up
  // again by itself once that block is gone (siteChanged in work.js).
  let waitCheckedAt = 0;
  const idleTimer = setInterval(() => {
    const now = Date.now();
    if (ready && !pendingRequests && !launchingDream && (!active || active.idle) && now - waitCheckedAt > 5000) {
      waitCheckedAt = now;
      const saved = resumeSaved(store.read());
      if (waitingCleared(bot, saved)) {
        bot.chat(`The ${String(saved.waitingOn.name).replaceAll('_', ' ')} is gone. Back to building!`);
        resume().catch(err => console.error(err));
        return;
      }
    }
    if (ready && !active && !relaunching && !launchingDream && !pendingRequests && !survival.state.paused && !survival.state.idleBlocked) launchIdle();
  }, 500);

  bot._client.on('playerChat', data => {
    if (ended) return;
    const player = Object.values(bot.players).find(p => p.uuid === data.sender);
    if (!player || player.username === bot.username || typeof data.plainMessage !== 'string') return;
    const from = player.username;
    let request = data.plainMessage;
    let literal;
    try { literal = requestedCommand(request, bot.username); }
    catch (err) { console.error(err); bot.chat('I could not use that command. Please check what you asked me to do.'); return; }
    let address = parseAddress(request, bot.username);
    // Acknowledgements from other bots must never start new work. New goals
    // require an explicit name; short controls remain convenient when unprefixed.
    const me = String(bot.username || config.username || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const control = new RegExp(`^(stop|cancel|resume|status)(,? (now|please|${me}))*[.!?]?$`, 'i');
    // The answer to a question Jev just asked. "Did you mean short grass or
    // grass block?" got "grass block" back, with no name in front, and the
    // gate dropped it; "Jev grass block" started a new request that had lost
    // the count and the recipient. The reply is read together with the
    // request it answers.
    const known = text => { const name = text.toLowerCase().replace(/\s+/g, '_'); return !!(bot.registry?.itemsByName?.[name] || bot.registry?.blocksByName?.[name] || bot.registry?.entitiesByName?.[name]); };
    const answer = !literal && !control.test(address.text) && clarificationReply(clarifying.get(from), address, { known });
    // A new addressed message moves on from the question either way.
    if (answer || address.explicit) clarifying.delete(from);
    if (answer) {
      request = `${bot.username} ${answer}`;
      address = parseAddress(request, bot.username);
    }
    if (!address.explicit && !control.test(address.text)) return;
    // Stop has a synchronous fast path, even while a network request is pending.
    const normalized = address.text;
    const stopping = new RegExp(`^(stop|cancel)(,? (now|please|${me}))*[.!?]?$`, 'i').test(normalized);
    // "Stop!" between two players is not addressed to the bot. Unprefixed,
    // it counts from whoever gave the work in hand, or when nobody else is
    // here to be talking to; it froze the bot, self-care included, in the
    // middle of other people's conversations.
    const owner = (active?.goal || store.read())?.from;
    const company = Object.values(bot.players).filter(p => p.username !== bot.username && p.username !== from).length;
    // "Stop Jev", with the name last, is as addressed as "Jev stop".
    const named = chatNames(bot.username || config.username).some(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(address.text));
    if (stopping && !address.explicit && !named && owner !== from && company > 0) return;
    if (stopping) {
      invalidateRequests();
      stop().catch(console.error);
      bot.chat('Stopped. I saved our progress. Say "Jev resume" to keep going.');
      return;
    }
    if (!ready) { bot.chat('Still loading the world; please repeat the request in a moment. Stop is available now.'); return; }
    // A literal status request reads local state immediately, even while a
    // previous natural-language request is waiting for a model response.
    if (/^status( please)?[.!?]?$/i.test(normalized)) {
      bot.chat(statusMessage(bot, active, store.read())); return;
    }
    // Acknowledge instantly. Everything below can wait on the model, and a
    // motionless bot reads as "it did not hear me" rather than "it is thinking".
    bot.swingArm?.('right');
    const revision = generation;
    const requestPosition = { speakerPosition: position(bot.players[from]?.entity?.position), botPosition: position(bot.entity?.position), dimension: bot.game.dimension };
    // The request pays for its own understanding. One that turns out to
    // start no work folds that cost into the standing bucket instead.
    const run = ledger.open({ kind: 'request', name: request });
    const requestClient = withRun(withRequestSignal(client, requestController.signal), run.id);
    let launched = false;
    pendingRequests++;
    pending = pending.then(async () => {
      if (revision !== generation || ended) return;
      // A catalog or list walk is several calls: look like it is thinking,
      // not like it did not hear. Not over work in hand: the glance turns the
      // head, and a dig in progress needs it where it is.
      const stopThinking = literal || active ? () => {} : thinking(bot);
      const spec = literal ? { kind: 'operator_command' } : await interpret(requestClient, request, from, bot.username, {
        registry: bot.registry, players: Object.keys(bot.players),
        ...requestPosition, memory: { ...memory.context(from), found: require('./exploration').foundEntries(world.known) },
        builds: builds.describe(bot, bot.entity.position, bot.game.dimension),
        continueBuilds: (request, candidates) => resolveBuildContinuation(requestClient, request, candidates,
          { speaker: requestPosition.speakerPosition }),
        inventory: Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])),
      }).finally(stopThinking);
      // What Jev made of the request is the first thing worth seeing about
      // it, whether or not any work follows.
      if (spec && !literal) {
        observation?.sample(spec.kind === 'clarify' ? 'clarify' : 'request', { request, from, kind: spec.kind, message: spec.message,
          clarification: spec.clarification, interpretation: spec.interpretation, itemResolution: spec.itemResolution,
          discoveryResolution: spec.discoveryResolution, buildContinuation: spec.buildContinuation, usage: spec.usage, latencyMs: spec.latencyMs });
      }
      if (!spec || revision !== generation) return;
      if (spec.kind === 'operator_command') {
        const allowed = (process.env.MC_COMMAND_USERS || '').split(',').map(name => name.trim().toLowerCase());
        if (!allowed.includes(from.toLowerCase())) { bot.chat(`${from} is not enabled for Jev's operator commands`); return; }
        const resolution = literal ? { command: literal } : await classifyCommand(requestClient, bot, request, from);
        if (revision !== generation) return;
        const command = commandAccess.accept(data, { resolvedCommand: resolution.command, interpretation: { routing: spec.interpretation, command: resolution.judgments } });
        if (!command) return;
        // A command is an aside, not a change of plan. Setting the time or the
        // game mode used to abandon whatever Jev was building and leave it
        // waiting to be asked again, which is not what "also do this" means.
        // Anything the command does to the world - a teleport, a mode change -
        // the goal already copes with, because the world changes anyway.
        const feedback = [];
        const collect = (message, position, original, sender) => {
          if (position === 'system' && sender == null && feedback.length < 4) feedback.push(message);
        };
        bot.on('messagestr', collect);
        try {
          bot.chat(`Running your command once: ${command.command}`);
          command.dispatch();
          await new Promise(resolve => setTimeout(resolve, 1000));
        } finally { bot.removeListener('messagestr', collect); }
        for (const reply of feedback) bot.chat(`Command response: ${reply}`);
        return;
      }
      if (spec.kind === 'status') {
        bot.chat(statusMessage(bot, active, store.read()));
        return;
      }
      if (spec.kind === 'other') {
        bot.chat('Ask for items or a full set, a biome or creature to find, someone to follow, or a structure to build.');
        return;
      }
      if (spec.kind === 'memory') {
        bot.chat(memory.handle(spec, { world: world.known }));
        if (active?.goal.from === from) active.goal.memoryContext = memory.context(from);
        observation?.sample('memory', { operation: spec.memory.operation });
        return;
      }
      if (spec.kind === 'dream') {
        const standing = dreamStore.read() || {};
        const { operation, key } = spec.dream;
        const title = standing.dream ? DREAMS[standing.dream].title : null;
        if (operation === 'query') {
          bot.chat(!standing.dream ? "I don't have a dream yet. You could give me one: to beat the game, or to build a village."
            : standing.satisfiedAt ? `My dream was to ${title}, and I think it's done for now. Tell me to chase it again if you want more.`
            : standing.paused ? `My dream is to ${title}, but I'm keeping it aside until you tell me to chase it.`
            : `My dream is to ${title}. I chase it whenever nothing else needs me.`);
        } else if (operation === 'clear') {
          if (standing.ledgerRun) ledger.close(standing.ledgerRun, 'cleared');
          saveDream({ dream: null, clearedBy: from, clearedAt: new Date().toISOString() });
          if (active && !active.idle && active.goal.dream) await stop('cancelled');
          bot.chat('Okay, no dream for now. I\'ll just look after myself between requests.');
        } else if (operation === 'pause') {
          if (!standing.dream) bot.chat("I don't have a dream to set aside.");
          else {
            saveDream({ ...standing, paused: true, pausedBy: from, pausedAt: new Date().toISOString() });
            if (active && !active.idle && active.goal.dream) await stop('interrupted');
            bot.chat(`Okay, I'll set my dream aside for now. Say "chase your dream" when you want me back on it.`);
          }
        } else if (operation === 'resume') {
          if (!standing.dream) bot.chat("I don't have a dream yet. You could give me one: to beat the game, or to build a village.");
          else {
            // Chasing a satisfied dream again is a new run; picking up a paused one is not.
            saveDream({ ...standing, paused: false, satisfiedAt: undefined, resumedBy: from, resumedAt: new Date().toISOString(),
              ledgerRun: standing.satisfiedAt || !standing.ledgerRun ? ledger.open({ kind: 'dream', name: dreamName(standing.dream) }).id : standing.ledgerRun });
            // A stop paused the survival loop with everything else; taking the
            // dream up again takes that up too, or nothing would run it.
            survival.state.paused = false; saveSurvival();
            bot.chat(`Back to my dream: to ${title}.`);
            const saved = store.read();
            if (saved?.dream && ['interrupted', 'cancelled', 'blocked'].includes(saved.status) && !active) launch(saved);
          }
        } else {
          if (standing.ledgerRun && !standing.satisfiedAt) ledger.close(standing.ledgerRun, 'replaced');
          saveDream({ dream: key, setBy: from, setAt: new Date().toISOString(), ledgerRun: ledger.open({ kind: 'dream', name: dreamName(key) }).id });
          bot.chat(`Got it. My dream is to ${DREAMS[key].title}. I'll chase it whenever nothing else needs me.`);
        }
        observation?.sample('dream', { operation, key, standing: dreamStore.read() });
        return;
      }
      if (spec.kind === 'clarify') {
        const reason = spec.clarification?.reason;
        clarifying.set(from, { request: address.text, options: spec.clarification?.options, until: Date.now() + CLARIFY_MS,
          confirm: ['uncertain_interaction', 'dream_unsure'].includes(reason), which: ['no_item', 'no_discovery_target', 'ambiguous_item', 'incomplete_bundle'].includes(reason) });
        bot.chat(spec.message); return;
      }
      if (spec.kind === 'stop') { invalidateRequests(); await stop(); bot.chat('Stopped.'); return; }
      if (spec.kind === 'resume') {
        await resume(revision); return;
      }
      // In Creative with the generative designer, a plain house is drawn like
      // any other building rather than taken from the built-in catalog.
      if (spec.kind === 'house' && designerAvailable(bot)) spec.kind = 'build';
      // Work no survival route can do is refused here, before it replaces
      // work that can be done. "Get me bedrock" stopped a build, then was
      // parked as impossible, and the build had to be dug out with resume.
      const impossible = unworkable(bot, spec);
      if (impossible) { bot.chat(`${friendlyProblem(impossible)}${active && !active.idle ? " I'll carry on with what I was doing." : ''}`); return; }
      await stop('replaced');
      if (revision !== generation || ended) return;
      const goal = { ...spec, ledgerRun: run.id, version: 1, status: 'pending', createdAt: new Date().toISOString(),
        suspendedTasks: suspendPrevious(store.read()),
        requesterPosition: bot.players[from]?.entity ? { ...bot.players[from].entity.position } : null,
        initialInventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
      saveGoal(goal);
      const changing = spec.kind === 'build' && spec.buildContinuation?.name &&
        { edit: `I'll work out what to change about ${spec.buildContinuation.name}.`,
          finish: `I'll carry on with ${spec.buildContinuation.name}.`,
          repair: `I'll look ${spec.buildContinuation.name} over and put right what is missing.`,
        }[spec.buildContinuation.mode];
      bot.chat(changing ? changing :
        spec.kind === 'build' ? "I'll make a plan, find a good spot, and build it for you." :
        spec.kind === 'bundle' ? `Working on the whole list: ${bundleSummary(spec)}.` :
        spec.kind === 'find' ? `I will look for ${spec.discoveryTarget.name.replaceAll('_', ' ')} and tell you where I find it.` :
        spec.kind === 'house' ? `Building a small ${spec.material} house with a floor, doorway and roof.` :
        ['obtain', 'craft'].includes(spec.kind) ? `I'll get ${spec.count} ${spec.item.replaceAll('_', ' ')}${spec.deliver ? ` for ${from}` : ''}.` :
        spec.kind === 'visit' ? `I'll head to ${spec.destination.label}.` :
        spec.kind === 'come' ? `Coming to ${spec.target}.` : spec.kind === 'follow' ? `Following ${spec.target}; say Jev stop to stop.` :
        spec.kind === 'win' ? "Let's beat the dragon! I'll gather supplies and take it one step at a time." :
        "I'll get a Nether portal working, then go through to check it.");
      launch(goal); launched = true;
    }).catch(err => { console.error(err); if (!ended && revision === generation) bot.chat(intakeProblem(err)); }).finally(() => { if (!launched) ledger.fold(run.id); pendingRequests--; });
  });

  bot.once('spawn', async () => {
    try {
      spawned = true;
      configureMovements(bot);
      console.log(`[bot] spawned as ${bot.username} (${bot.version})`);
      // Put back in the boat it left in (boats.js leaveStrandedVehicle): the
      // seat comes a moment after the spawn, and no crossing is under way
      // this soon after joining.
      const joinedAt = Date.now();
      const seated = () => { if (Date.now() - joinedAt < 5000) require('./boats').leaveStrandedVehicle(bot).then(left => left && console.log('[bot] joined in a boat; got out'), err => console.log(`[bot] joined in a boat and could not get out: ${err.message}`)); };
      bot.once('mount', seated);
      if (bot.vehicle || bot._seatedIn != null) seated();
      // The seat can come by the raw packet alone (compatibility.js), with no mount event.
      bot._client.on('set_passengers', () => { if (bot._seatedIn != null && !bot.vehicle) seated(); });
      await bot.waitForChunksToLoad();
      if (ended || !bot.isAlive) return;
      ready = true;
      console.log(JSON.stringify({ sessionReady: true, username: bot.username }));
      const saved = store.read();
      if (saved && ['running', 'recovering'].includes(saved.status) && !survival.state.paused) {
        bot.chat(survival.state.recovery?.status === 'pending' ? "I'm back! I'll look for my dropped items, then carry on." : "I'm back! I'll carry on where I left off.");
        // What was tried, judged by its own clock: moved on by the time the
        // save lay unplayed (a restart, a trial begun from a stage's save).
        require('./tried').resumed(saved, { savedAt: Date.parse(saved.updatedAt) });
        launch(saved);
      } else bot.chat('Call me Jev: "Jev come here", "Jev follow me", "Jev craft a chest", or "Jev get me 8 birch stairs".');
    } catch (err) { console.error('[bot] spawn:', err); bot.quit('Could not initialize the world'); }
  });
  // The game's death message for this bot, kept for the death record: the
  // cause said in the game's words ("was shot by Skeleton").
  bot.on('messagestr', text => {
    const name = bot.username;
    if (name && typeof text === 'string' && text.startsWith(`${name} `) && DEATH_WORDS.test(text.slice(name.length + 1))) {
      bot._deathMessage = { text: text.slice(name.length + 1), at: Date.now() };
      const last = (survival.state.deaths || []).at(-1);
      if (last && !last.cause && Date.now() - Date.parse(last.at) < 5000) last.cause = bot._deathMessage.text;
    }
  });
  bot.on('death', () => {
    ready = false; invalidateRequests();
    // A dead player can rejoin before respawning. No work has started in this
    // connection, so request respawn directly without recording a second death.
    if (!spawned && survival.state.recovery?.status === 'pending') { bot.respawn(); return; }
    const saved = active && !active.idle ? active.goal : store.read();
    recordDeath(bot, survival.state);
    if (saved && ['pending', 'running', 'recovering'].includes(saved.status)) {
      saved.lastError = 'The bot died; recovering from observed inventory after respawn';
      saved.status = 'recovering';
      saveGoal(saved);
    }
    saveSurvival();
    console.log(JSON.stringify({ death: survival.state.recovery }));
    if (!spawned) { bot.respawn(); return; }
    // Reconnect to discard all old inventory/window promises before respawning.
    // They must not issue a late action against the new life's inventory.
    stop('recovering').catch(console.error);
    bot.quit('Respawning after death');
  });
  function close(reason) {
    if (ended) return;
    observation?.detach(String(reason || 'connection closed'));
    ready = false; clearInterval(idleTimer); invalidateRequests();
    if (active && !active.task.cancelled) stop('running').catch(console.error);
    // Fence late saves from this connection before a replacement reads state.
    ended = true;
    memory.flush();
    resolveClosed({ reason, spawned, uptimeMs: Date.now() - connectedAt });
  }
  bot.on('end', reason => close(reason));
  bot.on('kicked', reason => console.error('[bot] kicked:', reason));
  bot.on('error', err => console.error('[bot]', err.message));
  return { bot, closed, shutdown() { close('shutdown'); bot.quit('Shutting down'); } };
}

module.exports = { unworkable, createSession };
