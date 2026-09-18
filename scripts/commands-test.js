'use strict';
// Controlled operator test. Setup explicitly grants only these test identities OP.
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mineflayer = require('mineflayer');
const id = Date.now().toString(36);
const username = `Cmd${id}`;
const owner = `Own${id}`;
const host = process.env.MC_HOST || '127.0.0.1';
const port = Number(process.env.MC_PORT || 25567);
const root = path.join(__dirname, '..');
const directory = path.join(root, 'artifacts', `commands-${id}`);
fs.mkdirSync(directory, { recursive: true });
const identity = `${host}-${port}-${username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
const auditFile = path.join(root, '.bot-state', `${identity}-commands.jsonl`);
const audit = () => fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
const count = bot => bot.inventory.items().filter(i => i.name === 'command_block').reduce((n, i) => n + i.count, 0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (fn()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
const log = value => { console.log(JSON.stringify(value)); fs.appendFileSync(path.join(directory, 'checks.jsonl'), JSON.stringify(value) + '\n'); };
let child, outsider;
function start() {
  child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, MC_HOST: host, MC_PORT: String(port), MC_VERSION: '26.1', MC_USERNAME: username, MC_COMMAND_USERS: owner } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => fs.appendFileSync(path.join(directory, 'bot.log'), data));
}
async function end() {
  if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; }
}
const observer = mineflayer.createBot({ host, port, username: owner, version: '26.1', auth: 'offline' });
observer.once('spawn', async () => {
  try {
    await sleep(1000); start();
    await until(() => observer.players[username]?.entity, 'bot online');
    await until(() => fs.existsSync(path.join(directory, 'bot.log')) && fs.readFileSync(path.join(directory, 'bot.log'), 'utf8').includes('"sessionReady":true'), 'bot world ready');
    log({ setupRequired: { op: [username, owner], creative: username, time: 'night' }, setupFile: path.join(directory, 'ready') });
    await until(() => fs.existsSync(path.join(directory, 'ready')), 'operator setup', 180000);
    await sleep(1000);
    const request = `${username} run /give ${owner} minecraft:command_block 1`;
    observer.chat(request);
    await until(() => count(observer) === 1 && audit().length === 1, 'explicit command block grant');
    log({ check: 'explicit allowed player command executes once with actual inventory evidence', pass: true });
    observer.chat(`/tellraw ${username} ${JSON.stringify({ text: `<${owner}> ${request}` })}`);
    await sleep(1500);
    if (audit().length !== 1 || count(observer) !== 1) throw new Error('System chat impersonation executed a command');
    outsider = mineflayer.createBot({ host, port, username: `No${id}`, version: '26.1', auth: 'offline' });
    await new Promise(resolve => outsider.once('spawn', resolve));
    outsider.chat(request);
    await sleep(1500);
    if (audit().length !== 1 || count(observer) !== 1) throw new Error('Unapproved player executed a command');
    log({ check: 'system impersonation and unapproved player requests cannot invoke commands', pass: true });
    observer.chat(`${username} get me a command block`);
    await until(() => count(observer) === 2, 'natural language command block item delivery');
    if (audit().length !== 1) throw new Error('Item acquisition invoked an operator command autonomously');
    log({ check: 'requested command block delivered from Creative inventory without autonomous commands', pass: true });
    observer.chat(`${username} please make it daytime`);
    await until(() => audit().length === 2 && observer.time.timeOfDay >= 1000 && observer.time.timeOfDay < 2000, 'classified daytime command and observed world time');
    log({ check: 'natural daytime request changes observed world time', pass: true, command: audit().at(-1).command });
    await sleep(1500);
    observer.chat(`${username} teleport me to you`);
    await until(() => audit().length === 3 && observer.entity.position.distanceTo(observer.players[username].entity.position) < 1, 'classified teleport subject and destination');
    log({ check: 'natural teleport request moves the speaker to the bot', pass: true, command: audit().at(-1).command });
    await sleep(1500);
    observer.chat(`${username} put me in Creative`);
    await until(() => audit().length === 4 && observer.game.gameMode === 'creative', 'classified Creative game mode');
    log({ check: 'natural game mode request changes the speaker game mode', pass: true, command: audit().at(-1).command });
    await sleep(1500);
    await end(); start();
    await until(() => observer.players[username]?.entity, 'restart');
    await sleep(2500);
    observer.chat(`${username} resume`);
    await sleep(2500);
    if (audit().length !== 4 || count(observer) !== 2) throw new Error('Restart/resume replayed a command');
    log({ check: 'restart and resume never replay operator commands', pass: true });
    log({ result: 'PASS', audit: audit(), receiverCount: count(observer) });
  } catch (err) { log({ result: 'FAIL', error: err.message }); process.exitCode = 1; }
  finally { await end(); observer.quit(); outsider?.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
});
observer.on('error', err => log({ error: err.message }));
