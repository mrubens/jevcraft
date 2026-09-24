'use strict';
// Real chat routing and bounded rejection in a separate controlled world.
// No grants, teleports, injected failures, or runtime model stubs.
require('../src/env').loadEnv();
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), mineflayer = require('mineflayer');
const { compatibilityPlugin } = require('../src/compatibility');
const id = Date.now().toString(36), username = `Block${id}`, witness = `Check${id}`;
const root = path.join(__dirname, '..'), directory = path.join(root, 'artifacts', `unreachable-${id}`);
fs.mkdirSync(directory, { recursive: true });
const host = '127.0.0.1', port = Number(process.env.MC_PORT || 25578);
const stateFile = path.join(root, '.bot-state', `127_0_0_1-${port}-${username}.json`);
const state = () => fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
const log = value => { const line = JSON.stringify({ at: new Date().toISOString(), ...value }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const replies = [];
let child, finishing = false;
function abort(reason) {
  if (finishing) return;
  finishing = true;
  log({ result: 'FAIL', error: reason });
  if (child && child.exitCode === null) child.kill('SIGTERM');
  observer.quit(); setTimeout(() => process.exit(1), 1000);
}
async function until(fn, label, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
const observer = mineflayer.createBot({ host, port, username: witness, version: '26.1', auth: 'offline' });
observer.loadPlugin(compatibilityPlugin);
observer.on('chat', (from, message) => { if (from === username) { replies.push(message); log({ botChat: message }); } });
observer.once('spawn', async () => {
  try {
    await observer.waitForChunksToLoad();
    child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, MC_HOST: host, MC_PORT: String(port),
      MC_VERSION: '26.1', MC_USERNAME: username } });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => fs.appendFileSync(path.join(directory, 'bot.log'), data));
    await until(() => observer.players[username]?.entity && replies.some(r => r.startsWith('Call me Jev')), 'ready bot');
    log({ scenario: 'controlled impossible item request over real chat', username, witness, server: `${host}:${port}`, gameMode: observer.game.gameMode });
    assert.equal(observer.game.gameMode, 'survival');
    observer.chat('Jev get me one bedrock');
    await until(() => state()?.item === 'bedrock' && state().status === 'blocked', 'explicit unsupported-item blocker');
    const failed = state();
    assert.equal(failed.count, 1); assert.equal(failed.initialInventory.length, 0);
    assert.match(failed.lastError, /No supported survival acquisition method for bedrock/);
    await until(() => replies.some(r => r.startsWith('Blocked:') && r.includes('bedrock')), 'chat blocker');
    assert(!replies.some(r => /^Delivered|^Obtained/.test(r)), 'No false success');
    fs.writeFileSync(path.join(directory, 'blocked-goal.json'), JSON.stringify(failed, null, 2));
    log({ check: 'Impossible survival acquisition is bounded, saved, and reported honestly', pass: true, error: failed.lastError,
      attempts: failed.failures, adviserCalls: failed.recoveryAdvice?.calls || 0 });
    await new Promise(resolve => setTimeout(resolve, 6000));
    assert.equal(state().status, 'blocked');
    assert.equal(state().failures, failed.failures, 'No automatic retry loop after rejection');
    const beforeStatus = replies.length;
    observer.chat('Jev status');
    await until(() => replies.slice(beforeStatus).some(r => /bedrock/.test(r) && /blocked|No supported/.test(r)), 'status retains the blocker', 15000);
    assert.equal(state().createdAt, failed.createdAt);
    log({ check: 'Status preserves the failed request', pass: true });
    observer.chat('Jev come here');
    await until(() => state()?.kind === 'come' && state().status === 'complete', 'new request after blocker', 45000);
    const distance = observer.entity.position.distanceTo(observer.players[username].entity.position);
    assert(distance <= 3.5);
    assert.notEqual(state().createdAt, failed.createdAt);
    log({ check: 'A new reachable request works after failure', pass: true, distance });
    log({ result: 'PASS', directory });
  } catch (err) { log({ result: 'FAIL', error: err.stack }); process.exitCode = 1; }
  finally {
    finishing = true;
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    observer.quit(); setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
});
observer.on('error', err => abort(err.message));
observer.on('end', reason => abort(`Observer disconnected: ${reason}`));
