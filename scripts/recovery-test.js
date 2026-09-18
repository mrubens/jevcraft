'use strict';
// Controlled disconnect/death test of the real chat entry point. An external
// fixture console performs the printed setup, kicks, and death injection.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const mineflayer = require('mineflayer');
require('../src/env').loadEnv();
const id = Date.now().toString(36), username = `Rec${id}`, witness = `See${id}`;
const host = process.env.MC_HOST || '127.0.0.1', port = Number(process.env.MC_PORT || 25567);
const root = path.join(__dirname, '..'), directory = path.join(root, 'artifacts', `recovery-${id}`);
fs.mkdirSync(directory, { recursive: true });
const identity = `${host}-${port}-${username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const stateFile = path.join(root, '.bot-state', `${identity}.json`);
const survivalFile = path.join(root, '.bot-state', `${identity}-survival.json`);
const state = () => fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
const survival = () => fs.existsSync(survivalFile) ? JSON.parse(fs.readFileSync(survivalFile)) : null;
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify(value) + '\n'); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const setupFile = path.join(directory, 'setup-ready');
let child;
const observer = mineflayer.createBot({ host, port, username: witness, version: '26.1', auth: 'offline' });
function startBot() {
  child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, MC_HOST: host, MC_PORT: String(port),
    MC_USERNAME: username, MC_VERSION: '26.1', MC_COMMAND_USERS: '' } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => fs.appendFileSync(path.join(directory, 'bot.log'), data));
}
async function stopBot() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
}
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Bot process exited during ${label}`);
    if (fn()) return; await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const entity = () => observer.players[username]?.entity;
let joins = 0;
observer.on('playerJoined', p => { if (p.username === username) joins++; });
observer.once('spawn', async () => {
  try {
    await observer.waitForChunksToLoad(); startBot();
    await until(entity, 'initial connection');
    await until(() => fs.existsSync(path.join(directory, 'bot.log')) && fs.readFileSync(path.join(directory, 'bot.log'), 'utf8').includes('"sessionReady":true'), 'initial world ready');
    const setupCommands = [`tp ${username} 300.5 64 300.5`, `tp ${witness} 300.5 64 304.5`,
      `spawnpoint ${username} 300 64 300`, 'fill 304 64 300 304 68 300 minecraft:oak_log keep'];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify({ scenario: 'controlled fault injection, not acceptance', setupCommands }, null, 2));
    log({ phase: 'setup', username, witness, setupFile, commands: setupCommands, directory });
    await until(() => fs.existsSync(setupFile), 'external fixture setup', 180000);
    observer.chat('Jev craft 16 sticks');
    await until(() => state()?.status === 'complete' && state().item === 'stick', 'ordinary crafting', 120000);
    assert((state().history.at(-1).inventory.stick || 0) >= 16);
    observer.chat('Jev follow me');
    await until(() => state()?.kind === 'follow' && state().status === 'running', 'follow request');
    await sleep(1500);
    const createdAt = state().createdAt;
    let beforeJoins = joins, previousEntity = entity().id;
    log({ phase: 'kick_running', command: `kick ${username} controlled recovery test` });
    await until(() => joins > beforeJoins && entity()?.id !== previousEntity, 'automatic reconnect');
    await until(() => state()?.status === 'running' && state().createdAt === createdAt, 'same retained request');
    log({ check: 'disconnect reconnects without another chat request', pass: true, createdAt });

    observer.chat('Jev stop');
    await until(() => state()?.status === 'cancelled' && survival()?.paused, 'persisted stop');
    const stoppedHistory = JSON.stringify(state().history);
    beforeJoins = joins; previousEntity = entity().id;
    log({ phase: 'kick_paused', command: `kick ${username} controlled paused reconnect test` });
    await until(() => joins > beforeJoins && entity()?.id !== previousEntity, 'paused reconnect');
    await sleep(2000);
    assert.equal(state().status, 'cancelled'); assert(survival().paused);
    assert.equal(JSON.stringify(state().history), stoppedHistory);
    await stopBot(); await sleep(500); startBot();
    await until(entity, 'process restart'); await sleep(2000);
    assert.equal(state().status, 'cancelled'); assert(survival().paused);
    assert.equal(JSON.stringify(state().history), stoppedHistory);
    log({ check: 'cancelled task remains paused across disconnect and process restart', pass: true });

    observer.chat('Jev resume');
    await until(() => state()?.status === 'running' && !survival()?.paused, 'explicit resume');
    beforeJoins = joins;
    log({ phase: 'death_running', commands: [`tp ${witness} 335.5 64 330.5`, `kill ${username}`] });
    await until(() => survival()?.recovery?.status === 'pending', 'persisted death', 30000);
    const death = survival().recovery;
    assert((death.inventoryBeforeDeath.stick || 0) >= 16);
    await until(() => joins > beforeJoins && survival()?.recovery?.status === 'finished', 'respawn and item recovery', 90000);
    const recovered = survival().recovery;
    assert((recovered.recovered.stick || 0) >= 16, JSON.stringify(recovered));
    assert.equal(state().createdAt, createdAt);
    await until(() => state()?.status === 'running' && state().history?.at(-1)?.inventory.stick >= 16, 'resumed work with actual recovered inventory');
    observer.chat('Jev stop');
    await until(() => state()?.status === 'cancelled', 'stop after recovery');
    log({ check: 'death respawns, retrieves matching drops, and resumes the same goal', pass: true, recovery: recovered });
    assert(!fs.existsSync(path.join(root, '.bot-state', `${identity}-commands.jsonl`)), 'no operator commands may be issued by the bot');
    log({ result: 'PASS', directory, username, witness });
  } catch (err) { log({ result: 'FAIL', error: err.stack, directory, username, witness }); process.exitCode = 1; }
  finally { await stopBot(); observer.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
observer.on('error', err => log({ observerError: err.message }));
