'use strict';

const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('./src/movement');
require('./src/env').loadEnv();
const { TypeSafe } = require('./src/typesafe');
const { interpret, GoalStore } = require('./src/objectives');
const { runGoal, runIdle, createSurvival } = require('./src/work');
const { Task } = require('./src/skills');
const { parseAddress } = require('./src/chat-address');
const { compatibilityPlugin } = require('./src/compatibility');

const config = {
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'JevBot', auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
};
const client = new TypeSafe();
const bot = mineflayer.createBot(config);
bot.loadPlugin(compatibilityPlugin);
bot.loadPlugin(pathfinder);
const identity = `${config.host}-${config.port}-${config.username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const store = new GoalStore(path.join(__dirname, '.bot-state', `${identity}.json`));
const survivalStore = new GoalStore(path.join(__dirname, '.bot-state', `${identity}-survival.json`));
const idleStore = new GoalStore(path.join(__dirname, '.bot-state', `${identity}-idle.json`));
const survival = createSurvival(bot, { state: survivalStore.read() || store.read()?.survival, client });
if (!survivalStore.read() && store.read()?.status === 'cancelled') survival.state.paused = true;
const saveSurvival = () => { survival.state.version = 1; survivalStore.save(survival.state); };
const workStore = { save: goal => { store.save(goal); saveSurvival(); } };
let active = null;
let pending = Promise.resolve();
let generation = 0;
let ready = false;
let pendingRequests = 0;

async function stop(status = 'cancelled') {
  if (status === 'cancelled') { survival.state.paused = true; saveSurvival(); }
  if (!active) return;
  active.task.cancel();
  if (!active.idle) { active.goal.status = status; workStore.save(active.goal); }
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  bot.stopDigging();
  bot.deactivateItem();
  await active.promise;
}

function launch(goal) {
  survival.state.paused = false; delete survival.state.idleBlocked; saveSurvival();
  const task = new Task(goal.kind, goal.request);
  const session = { task, goal };
  active = session;
  session.promise = runGoal(bot, task, goal, workStore, {
    decisionClient: client, survival,
    onStep: g => console.log(JSON.stringify({ status: g.status, step: g.step, decision: g.decisions?.at(-1), position: bot.entity.position, error: g.lastError })),
  }).catch(err => {
    if (err.name !== 'Cancelled') {
      goal.status = 'blocked'; goal.lastError = err.message; store.save(goal);
      console.error(err); bot.chat(`Blocked: ${err.message}`);
    }
  }).finally(() => { if (active === session) active = null; });
}

function launchIdle() {
  const retained = store.read();
  const goal = { ...(idleStore.read() || {}), version: 1, kind: 'survive', request: 'Stay alive and prepare supplies between player requests',
    retainedRequest: retained?.request, blueprint: retained?.blueprint, portalFrame: retained?.portalFrame, survival: survival.state };
  const task = new Task('survival', goal.request);
  const session = { task, goal, idle: true };
  active = session;
  session.promise = runIdle(bot, task, goal, { save: g => { idleStore.save(g); saveSurvival(); } }, {
    survival, decisionClient: client,
    onStep: g => console.log(JSON.stringify({ idle: true, survivalAction: g.survivalAction, decision: g.decisions?.at(-1)?.path, health: bot.health, food: bot.food, position: bot.entity.position, error: g.lastError })),
  }).catch(err => {
    if (err.name !== 'Cancelled') {
      survival.state.idleBlocked = err.message; saveSurvival();
      console.error(err); bot.chat(err.message);
    }
  }).finally(() => { if (active === session) active = null; });
}

const idleTimer = setInterval(() => {
  if (ready && !active && !pendingRequests && !survival.state.paused && !survival.state.idleBlocked) launchIdle();
}, 500);

bot.on('chat', (from, request) => {
  if (from === bot.username) return;
  const address = parseAddress(request, bot.username);
  // Acknowledgements from other bots must never start new work. New goals
  // require an explicit name; short controls remain convenient when unprefixed.
  if (!address.explicit && !/^(stop|cancel|resume|status)( please)?[.!?]?$/i.test(address.text)) return;
  // Stop has a synchronous fast path, even while a network request is pending.
  const normalized = address.text;
  if (/^(stop|cancel)( please)?[.!]?$/i.test(normalized)) {
    generation++;
    stop().catch(console.error);
    bot.chat('Stopped. Progress saved; say resume to continue.');
    return;
  }
  const revision = generation;
  pendingRequests++;
  pending = pending.then(async () => {
    const spec = await interpret(client, request, from, bot.username, {
      registry: bot.registry, players: Object.keys(bot.players),
      inventory: Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])),
    });
    if (!spec || revision !== generation) return;
    if (spec.kind === 'status') {
      const g = active?.goal || store.read();
      bot.chat(active?.idle ? `Between requests: ${g.lastError || g.survivalAction?.action || 'watching survival needs'}. Health ${bot.health}, food ${bot.food}.` :
        g ? `${g.status}: ${g.request}. ${g.lastError || g.decisions?.at(-1)?.path?.join(' > ') || JSON.stringify(g.step || {})}` : 'No saved task.');
      return;
    }
    if (spec.kind === 'other') {
      bot.chat('Tell me what item to obtain or craft, who to follow or come to, or what house material to use. I will check the dependencies.');
      return;
    }
    if (spec.kind === 'clarify') { bot.chat(spec.message); return; }
    if (spec.kind === 'stop') { generation++; await stop(); bot.chat('Stopped.'); return; }
    if (spec.kind === 'resume') {
      if (active?.idle) await stop('interrupted');
      if (active) { bot.chat('Already working on the saved task.'); return; }
      const saved = store.read();
      if (!saved || saved.status === 'complete') {
        survival.state.paused = false; delete survival.state.idleBlocked; saveSurvival();
        bot.chat('Resuming survival between requests.'); return;
      }
      launch(saved); return;
    }
    await stop('replaced');
    const goal = { ...spec, version: 1, status: 'pending', createdAt: new Date().toISOString(),
      requesterPosition: bot.players[from]?.entity ? { ...bot.players[from].entity.position } : null,
      initialInventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
    store.save(goal);
    bot.chat(spec.kind === 'house' ? `Building a small ${spec.material} house with a floor, doorway and roof.` :
      ['obtain', 'craft'].includes(spec.kind) ? `Working out the dependencies for ${spec.count} ${spec.item.replaceAll('_', ' ')}${spec.deliver ? ` for ${from}` : ''}.` :
      spec.kind === 'come' ? `Coming to ${spec.target}.` : spec.kind === 'follow' ? `Following ${spec.target}; say Jev stop to stop.` :
      'I will establish a portal route and enter the Nether to verify it.');
    launch(goal);
  }).catch(err => { console.error(err); bot.chat(`Could not process request: ${err.message}`); }).finally(() => { pendingRequests--; });
});

bot.once('spawn', async () => {
  configureMovements(bot);
  console.log(`[bot] spawned as ${bot.username} (${bot.version})`);
  await bot.waitForChunksToLoad();
  ready = true;
  const saved = store.read();
  if (saved && saved.status === 'running') { bot.chat('Resuming my saved task.'); launch(saved); }
  else bot.chat('Call me Jev: "Jev come here", "Jev follow me", "Jev craft a chest", or "Jev get me 8 birch stairs".');
});
bot.on('death', () => { ready = false; generation++; if (active) active.goal.lastError = 'The bot died'; stop('blocked').catch(console.error); });
bot.on('end', () => {
  ready = false; clearInterval(idleTimer);
  generation++;
  // A disconnect must not turn an already cancelled task back into running.
  if (active && !active.task.cancelled) stop('running').catch(console.error);
});
bot.on('kicked', reason => console.error('[bot] kicked:', reason));
bot.on('error', err => console.error('[bot]', err.message));
