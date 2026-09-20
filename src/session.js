'use strict';

const path = require('path');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('./movement');
const { interpret, GoalStore } = require('./objectives');
const { runGoal, runIdle, createSurvival } = require('./work');
const { Task } = require('./skills');
const { parseAddress } = require('./chat-address');
const { compatibilityPlugin } = require('./compatibility');
const { requestedCommand, createCommandAccess } = require('./commands');
const { classifyCommand } = require('./command-classifier');
const { recordDeath, observeAliveInventory } = require('./recovery');
const { statusMessage } = require('./status');
const { bundleSummary } = require('./item-bundle');
const { friendlyProblem, recoveryHint } = require('./speech');
const { withRequestSignal } = require('./typesafe');
const { suspendPrevious, resumeSaved } = require('./suspended-tasks');
const { CompanionMemory, position } = require('./memory');

function createSession(config, client, { stateDirectory = path.join(__dirname, '..', '.bot-state'), harness } = {}) {
  let ended = false, spawned = false, resolveClosed;
  const connectedAt = Date.now();
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const bot = mineflayer.createBot({ ...config, respawn: false });
  bot.on('physicsTick', () => { if (!ended) observeAliveInventory(bot); });
  bot.on('handover', event => { if (!ended) console.log(JSON.stringify({ handover: event })); });
  for (const event of ['recovery_advice', 'recovery_result']) bot.on(event, data => {
    if (ended) return;
    const record = data.record || data;
    console.log(JSON.stringify({ [event]: { status: record.status, model: record.model, diagnosis: record.diagnosis,
      steps: record.steps, outcome: data.outcome || record.outcome, latencyMs: record.latencyMs, usage: record.usage } }));
  });
  bot.loadPlugin(compatibilityPlugin);
  bot.loadPlugin(pathfinder);
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
  const survivalStore = new GoalStore(path.join(stateDirectory, `${identity}-survival.json`));
  const idleStore = new GoalStore(path.join(stateDirectory, `${identity}-idle.json`));
  const memoryIdentity = process.env.MC_WORLD_ID ? `${identity}-${process.env.MC_WORLD_ID.replace(/[^a-zA-Z0-9_-]/g, '_')}` : identity;
  const memorySeed = store.read(), needsMemoryId = memorySeed && !memorySeed.memoryId;
  const memory = new CompanionMemory(path.join(stateDirectory, `${memoryIdentity}-memory.json`), {
    seedGoal: memorySeed, seedResources: { ...idleStore.read()?.resourceMemory, ...memorySeed?.resourceMemory },
  });
  if (needsMemoryId && memorySeed.memoryId) store.save(memorySeed);
  bot.companionMemory = memory;
  const survival = createSurvival(bot, { state: survivalStore.read() || store.read()?.survival, client });
  if (!survivalStore.read() && store.read()?.status === 'cancelled') survival.state.paused = true;
  const saveSurvival = () => { if (!ended) { survival.state.version = 1; survivalStore.save(survival.state); } };
  const saveGoal = goal => { if (!ended) { memory.recordGoal(goal, bot); store.save(goal); } };
  const workStore = { save: goal => { saveGoal(goal); saveSurvival(); } };
  let active = null;
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
    memory.bind(goal);
    goal.memoryContext = memory.context(goal.from);
    survival.state.paused = false; delete survival.state.idleBlocked; delete survival.state.deathBlocked; saveSurvival();
    const task = new Task(goal.kind, goal.request);
    const session = { task, goal };
    active = session;
    session.promise = runGoal(bot, task, goal, workStore, {
      decisionClient: client, survival,
      onStep: g => { console.log(JSON.stringify({ status: g.status, step: g.step, decision: g.decisions?.at(-1), position: bot.entity.position, error: g.lastError })); observation?.sample('step', undefined, g); },
    }).catch(err => {
      if (err.name !== 'Cancelled') {
        goal.status = 'blocked'; goal.lastError = err.message; saveGoal(goal);
        observation?.sample('error', { message: err.message }, goal);
        console.error(err); bot.chat(`${friendlyProblem(err)} ${recoveryHint(err)}`);
      }
    }).finally(() => { if (active === session) active = null; });
  }

  function launchIdle() {
    const retained = store.read();
    const goal = { ...(idleStore.read() || {}), version: 1, kind: 'survive', request: 'Stay alive and prepare supplies between player requests',
      retainedRequest: retained?.request, blueprint: retained?.blueprint, portalFrame: retained?.portalFrame, survival: survival.state };
    memory.bind(goal);
    const task = new Task('survival', goal.request);
    const session = { task, goal, idle: true };
    active = session;
    session.promise = runIdle(bot, task, goal, { save: g => { if (!ended) { idleStore.save(g); memory.flush(); } saveSurvival(); } }, {
      survival, decisionClient: client,
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
    if (revision !== generation || ended) return;
    if (active) { bot.chat('Already working on the saved task.'); return; }
    const current = store.read(), saved = resumeSaved(current, options);
    if (!saved || saved.status === 'complete') {
      survival.state.paused = false; delete survival.state.idleBlocked; delete survival.state.deathBlocked; saveSurvival();
      bot.chat("I'm back! I'll look after myself while I wait for your next task."); return;
    }
    if (saved.kind === 'build' && !saved.design) saved.designAttempts = 0;
    if (saved !== current) bot.chat(`Back to your earlier task: ${saved.request}.`);
    launch(saved);
  }
  observation = harness?.attach(bot, {
    server: `${config.host}:${config.port}`,
    getGoal: () => active?.goal || store.read() || {},
    controls: {
      stop: async () => { if (ended) throw new Error('Connection ended'); invalidateRequests(); await stop(); },
      resume: async options => {
        if (ended || !ready) throw new Error('The bot is not ready');
        const revision = generation; pendingRequests++;
        const operation = pending.then(() => resume(revision, options));
        pending = operation.catch(() => {}).finally(() => { pendingRequests--; });
        return operation;
      },
    },
  });

  const idleTimer = setInterval(() => {
    if (ready && !active && !pendingRequests && !survival.state.paused && !survival.state.idleBlocked) launchIdle();
  }, 500);

  bot._client.on('playerChat', data => {
    if (ended) return;
    const player = Object.values(bot.players).find(p => p.uuid === data.sender);
    if (!player || player.username === bot.username || typeof data.plainMessage !== 'string') return;
    const from = player.username, request = data.plainMessage;
    let literal;
    try { literal = requestedCommand(request, bot.username); }
    catch (err) { console.error(err); bot.chat('I could not use that command. Please check what you asked me to do.'); return; }
    const address = parseAddress(request, bot.username);
    // Acknowledgements from other bots must never start new work. New goals
    // require an explicit name; short controls remain convenient when unprefixed.
    if (!address.explicit && !/^(stop|cancel|resume|status)( please)?[.!?]?$/i.test(address.text)) return;
    // Stop has a synchronous fast path, even while a network request is pending.
    const normalized = address.text;
    if (/^(stop|cancel)( please)?[.!]?$/i.test(normalized)) {
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
    const revision = generation;
    const requestPosition = { speakerPosition: position(bot.players[from]?.entity?.position), botPosition: position(bot.entity?.position), dimension: bot.game.dimension };
    const requestClient = withRequestSignal(client, requestController.signal);
    pendingRequests++;
    pending = pending.then(async () => {
      if (revision !== generation || ended) return;
      const spec = literal ? { kind: 'operator_command' } : await interpret(requestClient, request, from, bot.username, {
        registry: bot.registry, players: Object.keys(bot.players),
        ...requestPosition, memory: memory.context(from),
        inventory: Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])),
      });
      if (!spec || revision !== generation) return;
      if (spec.kind === 'operator_command') {
        const allowed = (process.env.MC_COMMAND_USERS || '').split(',').map(name => name.trim().toLowerCase());
        if (!allowed.includes(from.toLowerCase())) { bot.chat(`${from} is not enabled for Jev's operator commands`); return; }
        const resolution = literal ? { command: literal } : await classifyCommand(requestClient, bot, request, from);
        if (revision !== generation) return;
        const command = commandAccess.accept(data, { resolvedCommand: resolution.command, interpretation: { routing: spec.interpretation, command: resolution.judgments } });
        if (!command) return;
        await stop('interrupted');
        if (revision !== generation) return;
        survival.state.paused = true; saveSurvival();
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
        bot.chat(memory.handle(spec));
        if (active?.goal.from === from) active.goal.memoryContext = memory.context(from);
        observation?.sample('memory', { operation: spec.memory.operation });
        return;
      }
      if (spec.kind === 'clarify') { bot.chat(spec.message); return; }
      if (spec.kind === 'stop') { invalidateRequests(); await stop(); bot.chat('Stopped.'); return; }
      if (spec.kind === 'resume') {
        await resume(revision); return;
      }
      await stop('replaced');
      if (revision !== generation || ended) return;
      const goal = { ...spec, version: 1, status: 'pending', createdAt: new Date().toISOString(),
        suspendedTasks: suspendPrevious(store.read()),
        requesterPosition: bot.players[from]?.entity ? { ...bot.players[from].entity.position } : null,
        initialInventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
      saveGoal(goal);
      bot.chat(spec.kind === 'build' ? "I'll make a plan, find a good spot, and build it for you." :
        spec.kind === 'bundle' ? `Working on the whole list: ${bundleSummary(spec)}.` :
        spec.kind === 'find' ? `I will look for ${spec.discoveryTarget.name.replaceAll('_', ' ')} and tell you where I find it.` :
        spec.kind === 'house' ? `Building a small ${spec.material} house with a floor, doorway and roof.` :
        ['obtain', 'craft'].includes(spec.kind) ? `I'll get ${spec.count} ${spec.item.replaceAll('_', ' ')}${spec.deliver ? ` for ${from}` : ''}.` :
        spec.kind === 'visit' ? `I'll head to ${spec.destination.label}.` :
        spec.kind === 'come' ? `Coming to ${spec.target}.` : spec.kind === 'follow' ? `Following ${spec.target}; say Jev stop to stop.` :
        spec.kind === 'win' ? "Let's beat the dragon! I'll gather supplies and take it one step at a time." :
        "I'll get a Nether portal working, then go through to check it.");
      launch(goal);
    }).catch(err => { console.error(err); if (!ended && revision === generation) bot.chat('I had trouble understanding that. Please try saying it another way.'); }).finally(() => { pendingRequests--; });
  });

  bot.once('spawn', async () => {
    try {
      spawned = true;
      configureMovements(bot);
      console.log(`[bot] spawned as ${bot.username} (${bot.version})`);
      await bot.waitForChunksToLoad();
      if (ended || !bot.isAlive) return;
      ready = true;
      console.log(JSON.stringify({ sessionReady: true, username: bot.username }));
      const saved = store.read();
      if (saved && ['running', 'recovering'].includes(saved.status) && !survival.state.paused) {
        bot.chat(survival.state.recovery?.status === 'pending' ? "I'm back! I'll look for my dropped items, then carry on." : "I'm back! I'll carry on where I left off.");
        launch(saved);
      } else if (survival.state.deathBlocked) bot.chat("I keep getting hurt there. I'll wait here. Say Jev resume when you're ready.");
      else bot.chat('Call me Jev: "Jev come here", "Jev follow me", "Jev craft a chest", or "Jev get me 8 birch stairs".');
    } catch (err) { console.error('[bot] spawn:', err); bot.quit('Could not initialize the world'); }
  });
  bot.on('death', () => {
    ready = false; invalidateRequests();
    // A dead player can rejoin before respawning. No work has started in this
    // connection, so request respawn directly without recording a second death.
    if (!spawned && survival.state.recovery?.status === 'pending') { bot.respawn(); return; }
    recordDeath(bot, survival.state);
    const saved = active && !active.idle ? active.goal : store.read();
    if (saved && ['pending', 'running', 'recovering'].includes(saved.status)) {
      saved.lastError = 'The bot died; recovering from observed inventory after respawn';
      saved.status = survival.state.deathBlocked ? 'blocked' : 'recovering';
      saveGoal(saved);
    }
    saveSurvival();
    console.log(JSON.stringify({ death: survival.state.recovery, blocked: survival.state.deathBlocked }));
    if (!spawned) { bot.respawn(); return; }
    // Reconnect to discard all old inventory/window promises before respawning.
    // They must not issue a late action against the new life's inventory.
    stop(survival.state.deathBlocked ? 'blocked' : 'recovering').catch(console.error);
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

module.exports = { createSession };
