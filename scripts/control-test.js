'use strict';
// Live chat stop/resume and process restart test. No world commands or grants.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mineflayer = require('mineflayer');
const { compatibilityPlugin } = require('../src/compatibility');
require('../src/env').loadEnv();
const id = Date.now().toString(36);
const username = `Ctrl${id}`;
const address = process.env.CHAT_NAME || 'Jev';
const host = process.env.MC_HOST || '127.0.0.1';
const port = Number(process.env.MC_PORT || 25567);
const version = process.env.MC_VERSION || '26.1';
const root = path.join(__dirname, '..');
const identity = `${host}-${port}-${username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const stateFile = path.join(root, '.bot-state', `${identity}.json`);
const survivalFile = path.join(root, '.bot-state', `${identity}-survival.json`);
const directory = path.join(root, 'artifacts', `control-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'checks.jsonl'), JSON.stringify(value) + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = () => fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
async function until(fn, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = fn(); if (result) return result; await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
let child;
function startBot() {
  child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, MC_HOST: host, MC_PORT: String(port), MC_VERSION: version, MC_USERNAME: username } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => fs.appendFileSync(path.join(directory, 'bot.log'), data));
}
async function killBot() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM'); await exited;
}
const observer = mineflayer.createBot({ host, port, version, username: `Check${id}`, auth: 'offline' });
observer.loadPlugin(compatibilityPlugin);
const replies = [];
observer.on('chat', (from, message) => {
  if (from === username) { replies.push(message); log({ botChat: message }); }
});
observer.on('error', err => log({ observerError: err.message }));
observer.once('spawn', async () => {
  try {
    await observer.waitForChunksToLoad();
    if (process.env.CONTROL_DIFFICULTY && observer.game.difficulty !== process.env.CONTROL_DIFFICULTY) {
      throw new Error(`Expected ${process.env.CONTROL_DIFFICULTY}, got ${observer.game.difficulty}`);
    }
    log({ scenario: process.env.CONTROL_SCENARIO || 'live control test', server: `${host}:${port}`,
      difficulty: observer.game.difficulty, gameMode: observer.game.gameMode });
    startBot();
    await until(() => observer.players[username]?.entity, 'bot spawn');
    await sleep(1000);
    observer.chat('Building a small oak_planks house with a floor, doorway and roof.');
    await sleep(1000);
    if (state()) throw new Error('Unaddressed acknowledgement started a task');
    log({ check: 'unaddressed bot chatter does not start work', pass: true });
    observer.chat(`${address} stop`);
    await until(() => fs.existsSync(survivalFile) && JSON.parse(fs.readFileSync(survivalFile)).paused, 'idle stop persisted');
    await sleep(1500);
    const idlePosition = observer.players[username].entity.position.clone();
    await sleep(1500);
    if (idlePosition.distanceTo(observer.players[username].entity.position) > 0.2) throw new Error('Idle survival moved after stop');
    log({ check: 'stop also pauses autonomous survival between requests', pass: true });
    observer.chat(`${address} resume`);
    await until(() => !JSON.parse(fs.readFileSync(survivalFile)).paused, 'idle resume');
    observer.chat(`${address} build a house`);
    await until(() => state()?.history?.some(h => (h.inventory.oak_log || 0) > 0), 'real survival gathering');
    let blueprint = state().blueprint;
    const createdAt = state().createdAt;
    if (state().initialInventory?.length) throw new Error('Control trial did not start with empty inventory');
    const beforeStatus = replies.length;
    observer.chat(`${address} status`);
    const statusReply = await until(() => replies.slice(beforeStatus).find(message => message.startsWith('running:')), 'live status reply', 10000);
    if (state().createdAt !== createdAt || state().status !== 'running') throw new Error('Status changed the active task');
    log({ check: 'status reports the retained running request without replacing it', pass: true, statusReply });
    observer.chat(`${address} stop`);
    await until(() => state()?.status === 'cancelled', 'stop checkpoint');
    await sleep(1500);
    const paused = state();
    const position = observer.players[username].entity.position.clone();
    await sleep(1500);
    if (position.distanceTo(observer.players[username].entity.position) > 0.2) throw new Error('Bot kept moving after stop');
    if (state().history.length !== paused.history.length) throw new Error('Bot executed more steps after stop');
    log({ check: 'stop halts movement and task steps', pass: true });

    observer.chat(`${address} resume`);
    await until(() => state()?.status === 'running' && state().history.length > paused.history.length, 'resume progress');
    if (state().createdAt !== createdAt) throw new Error('Resume replaced the player goal');
    if (blueprint && JSON.stringify(state().blueprint) !== JSON.stringify(blueprint)) throw new Error('Resume moved the building site');
    blueprint ||= state().blueprint;
    log({ check: 'resume retains goal and any selected site and progresses', pass: true, siteSelected: !!blueprint });

    await killBot();
    const checkpoint = state();
    if (checkpoint.status !== 'running') throw new Error('Restart checkpoint is not resumable');
    await sleep(1000);
    startBot();
    await until(() => state()?.history?.length > checkpoint.history.length, 'automatic restart resume');
    if (state().createdAt !== createdAt) throw new Error('Restart replaced the player goal');
    if (blueprint && JSON.stringify(state().blueprint) !== JSON.stringify(blueprint)) throw new Error('Restart moved the building site');
    log({ check: 'process restart resumes saved task', pass: true });
    observer.chat(`${address} stop`);
    await until(() => state()?.status === 'cancelled', 'final stop');
    log({ result: 'PASS', username, stateFile });
  } catch (err) { log({ result: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { await killBot(); observer.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
