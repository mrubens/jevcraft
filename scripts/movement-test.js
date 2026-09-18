'use strict';
// Exercise the real chat entry point with two survival players. No world commands.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { navigate, Task } = require('../src/skills');
require('../src/env').loadEnv();
const id = Date.now().toString(36);
const username = `Move${id}`;
const host = process.env.MC_HOST || '127.0.0.1';
const port = Number(process.env.MC_PORT || 25567);
const root = path.join(__dirname, '..');
const dir = path.join(root, 'artifacts', `movement-${id}`);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(root, '.bot-state', `${host}-${port}-${username}`.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
const state = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(dir, 'checks.jsonl'), JSON.stringify(value) + '\n'); };
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
let child;
const observer = mineflayer.createBot({ host, port, version: '26.1', username: `Walk${id}`, auth: 'offline' });
observer.loadPlugin(compatibilityPlugin); observer.loadPlugin(pathfinder);
const distance = () => observer.entity.position.distanceTo(observer.players[username].entity.position);
const walk = (x, z) => navigate(observer, new Task('test', 'walk'), new goals.GoalNear(x, 64, z, 1), { timeoutMs: 30000 });
observer.once('spawn', async () => {
  try {
    await observer.waitForChunksToLoad(); configureMovements(observer);
    child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, MC_HOST: host, MC_PORT: String(port), MC_VERSION: '26.1', MC_USERNAME: username } });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => fs.appendFileSync(path.join(dir, 'bot.log'), data));
    await until(() => observer.players[username]?.entity, 'bot spawn');
    await sleep(1500);
    await walk(-20, 10);
    if (distance() < 10) throw new Error('Test did not create approach distance');
    observer.chat(`${username} come here`);
    await until(() => state()?.kind === 'come' && state().status === 'complete', 'come completion');
    if (distance() > 3.5) throw new Error('Come completed out of range');
    log({ check: 'come reaches requesting player', pass: true, distance: distance() });
    observer.chat(`${username} follow me`);
    await until(() => state()?.kind === 'follow' && state().status === 'running', 'follow starts');
    for (const [x, z] of [[-32, 12], [-32, 28]]) {
      await walk(x, z);
      await until(() => distance() <= 3.5, 'follow catches moving player');
    }
    log({ check: 'follow tracks two successive destinations', pass: true, distance: distance() });
    observer.chat(`${username} stop`);
    await until(() => state()?.status === 'cancelled', 'stop saved');
    await sleep(1500);
    const stopped = observer.players[username].entity.position.clone();
    await walk(-42, 28);
    await sleep(1500);
    if (stopped.distanceTo(observer.players[username].entity.position) > 0.3) throw new Error('Follow continued after stop');
    log({ check: 'stop ends continuous following', pass: true });
    log({ result: 'PASS', artifact: dir });
  } catch (err) { log({ result: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally {
    observer.pathfinder.setGoal(null);
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    observer.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
});
observer.on('error', err => log({ error: err.message }));
