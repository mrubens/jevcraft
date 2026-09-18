'use strict';

const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { configureMovements } = require('./src/movement');
require('./src/env').loadEnv();
const { TypeSafe } = require('./src/typesafe');
const { interpret, GoalStore } = require('./src/objectives');
const { runGoal } = require('./src/work');
const { Task } = require('./src/skills');
const { parseAddress } = require('./src/chat-address');

const config = {
  host: process.env.MC_HOST || 'localhost', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'JevBot', auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || false,
};
const client = new TypeSafe();
const bot = mineflayer.createBot(config);
bot.loadPlugin(pathfinder);
const identity = `${config.host}-${config.port}-${config.username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const store = new GoalStore(path.join(__dirname, '.bot-state', `${identity}.json`));
let active = null;
let pending = Promise.resolve();
let generation = 0;

async function stop(status = 'cancelled') {
  if (!active) return;
  active.task.cancel();
  active.goal.status = status;
  store.save(active.goal);
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  bot.stopDigging();
  await active.promise;
}

function launch(goal) {
  const task = new Task(goal.kind, goal.request);
  const session = { task, goal };
  active = session;
  session.promise = runGoal(bot, task, goal, store, {
    onStep: g => console.log(JSON.stringify({ status: g.status, step: g.step, position: bot.entity.position, error: g.lastError })),
  }).catch(err => {
    if (err.name !== 'Cancelled') {
      goal.status = 'blocked'; goal.lastError = err.message; store.save(goal);
      console.error(err); bot.chat(`Blocked: ${err.message}`);
    }
  }).finally(() => { if (active === session) active = null; });
}

bot.on('chat', (from, request) => {
  if (from === bot.username) return;
  // Stop has a synchronous fast path, even while a network request is pending.
  const normalized = parseAddress(request, bot.username).text;
  if (/^(stop|cancel)( please)?[.!]?$/i.test(normalized)) {
    generation++;
    stop().catch(console.error);
    bot.chat('Stopped. Progress saved; say resume to continue.');
    return;
  }
  const revision = generation;
  pending = pending.then(async () => {
    const spec = await interpret(client, request, from, bot.username);
    if (!spec || revision !== generation) return;
    if (spec.kind === 'status') {
      const g = active?.goal || store.read();
      bot.chat(g ? `${g.status}: ${g.request}. ${g.lastError || JSON.stringify(g.step || {})}` : 'No saved task.');
      return;
    }
    if (spec.kind === 'other') {
      bot.chat('I can currently build a small wood/stone/dirt house, collect purple concrete, or establish a Nether route.');
      return;
    }
    if (spec.kind === 'stop') { generation++; await stop(); bot.chat('Stopped.'); return; }
    if (spec.kind === 'resume') {
      if (active) { bot.chat('Already working on the saved task.'); return; }
      const saved = store.read();
      if (!saved || saved.status === 'complete') { bot.chat('No unfinished task to resume.'); return; }
      launch(saved); return;
    }
    await stop('replaced');
    const goal = { ...spec, version: 1, status: 'pending', createdAt: new Date().toISOString(),
      requesterPosition: bot.players[from]?.entity ? { ...bot.players[from].entity.position } : null,
      initialInventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
    store.save(goal);
    bot.chat(spec.kind === 'house' ? `Building a small ${spec.material} house with a floor, doorway and roof.` :
      spec.kind === 'concrete' ? `Collecting ${spec.count} purple concrete blocks.` : 'I will establish a portal route and enter the Nether to verify it.');
    launch(goal);
  }).catch(err => { console.error(err); bot.chat(`Could not process request: ${err.message}`); });
});

bot.once('spawn', async () => {
  configureMovements(bot);
  console.log(`[bot] spawned as ${bot.username} (${bot.version})`);
  await bot.waitForChunksToLoad();
  const saved = store.read();
  if (saved && saved.status === 'running') { bot.chat('Resuming my saved task.'); launch(saved); }
  else bot.chat('Call me Jev: "Jev build a house", "Jev get me purple concrete", or "Jev find a way to the Nether".');
});
bot.on('death', () => { generation++; if (active) active.goal.lastError = 'The bot died'; stop('blocked').catch(console.error); });
bot.on('end', () => {
  generation++;
  // A disconnect must not turn an already cancelled task back into running.
  if (active && !active.task.cancelled) stop('running').catch(console.error);
});
bot.on('kicked', reason => console.error('[bot] kicked:', reason));
bot.on('error', err => console.error('[bot]', err.message));
