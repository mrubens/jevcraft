'use strict';
// Isolated, controlled flat terrain. Exercises real Jev classification, player
// chat, production sessions, a reconnect, and ordinary Survival navigation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { createSession } = require('../src/session');
const { TypeSafe } = require('../src/typesafe');
const { Task } = require('../src/skills');
const { waitFor } = require('../src/work');
const { CompanionMemory } = require('../src/memory');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
require('../src/env').loadEnv();
const id = Date.now().toString(36), directory = path.resolve('artifacts', `memory-live-${id}`), x = Number(process.env.MEMORY_TEST_X || 2600);
const stateDirectory = path.join(directory, 'state'); fs.mkdirSync(stateDirectory, { recursive: true });
const config = { host: '127.0.0.1', port, username: `Jev${id}`, version: '26.1', auth: 'offline' };
const identity = `${config.host}-${config.port}-${config.username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
process.env.MC_WORLD_ID = `memory-fixture-${id}`;
const memoryFile = path.join(stateDirectory, `${identity}-${process.env.MC_WORLD_ID}-memory.json`), goalFile = path.join(stateDirectory, `${identity}.json`);
fs.writeFileSync(path.join(stateDirectory, `${identity}-survival.json`), JSON.stringify({ version: 1, paused: true }));
const client = new TypeSafe(), task = new Task('memory fixture'), chats = [];
let session, receiver, deaths = 0, commands = 0;
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
const context = () => read(memoryFile);
const ready = async bot => { await new Promise(r => bot.once('spawn', r)); await bot.waitForChunksToLoad(); };
const start = () => {
  const s = createSession(config, client, { stateDirectory });
  s.bot.on('death', () => { deaths++; task.cancel(); });
  s.bot.on('error', e => log({ error: e.message }));
  const write = s.bot._client.write;
  s.bot._client.write = function (name, packet, ...args) { if (name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
  return s;
};
const ask = async (message, predicate) => {
  log({ request: message }); const start = chats.length; receiver.chat(message);
  await waitFor(task, () => predicate(chats.slice(start)), 60000);
};
const timer = setTimeout(() => task.cancel(), 8 * 60000);
(async () => {
  try {
    session = start(); receiver = mineflayer.createBot({ host: config.host, port, username: `Pal${id}`, version: '26.1', auth: 'offline' });
    receiver.on('chat', (from, message) => { if (from === config.username) { chats.push(message); log({ reply: message }); } });
    receiver.on('death', () => { deaths++; task.cancel(); });
    await Promise.all([ready(session.bot), ready(receiver)]);
    const setup = [`forceload add ${x - 16} -16 ${x + 32} 16`, `fill ${x - 8} 64 -8 ${x + 24} 72 8 air`,
      `fill ${x - 8} 61 -8 ${x + 24} 63 8 stone`, `gamemode survival ${config.username}`, `gamemode survival ${receiver.username}`,
      `tp ${config.username} ${x + 14.5} 64 .5`, `tp ${receiver.username} ${x + .5} 64 .5`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => receiver.entity.position.x > x && session.bot.entity.position.y === 64, 10000);
    const origin = session.bot.entity.position.clone(), home = receiver.entity.position.clone();
    await ask('Jev remember this as home', () => context()?.places.some(p => p.label === 'home'));
    assert(new Vec3(...['x', 'y', 'z'].map(k => context().places[0].position[k])).distanceTo(home) < 1);
    assert(session.bot.entity.position.distanceTo(origin) < 1, 'a memory note must not move the bot');
    await ask('Jev remember I prefer cherry planks', () => context()?.notes.length === 1);
    await ask('Jev what wood do I prefer?', replies => replies.some(m => /You told me:.*cherry/i.test(m)));
    const ended = new Promise(resolve => session.bot.once('end', resolve)); session.shutdown(); await ended;
    session = start(); await ready(session.bot);
    assert.equal(session.bot.companionMemory.context(receiver.username).places[0].label, 'home');
    await ask('Jev where is home?', replies => replies.some(m => /home was saved at/.test(m)));
    assert(session.bot.entity.position.distanceTo(origin) < 1, 'recall must not navigate');
    await ask('Jev go home', () => read(goalFile)?.kind === 'visit' && read(goalFile)?.status === 'complete');
    await waitFor(task, () => receiver.players[config.username]?.entity?.position.distanceTo(home) <= 3, 5000);
    assert(session.bot.entity.position.distanceTo(home) <= 3);
    assert(context().history.some(h => h.kind === 'visit' && h.status === 'complete'));
    await ask('Jev what did I ask you to do last time?', replies => replies.some(m => /I finished: Jev go home/.test(m)));
    await ask('Jev follow me', () => read(goalFile)?.kind === 'follow' && read(goalFile)?.status === 'running');
    await ask('Jev remember I like blue beds', () => context()?.notes.length === 2);
    assert.equal(read(goalFile).kind, 'follow'); assert.equal(read(goalFile).status, 'running');
    await ask('Jev stop', () => read(goalFile)?.status === 'cancelled');
    await ask('Jev forget home', () => context()?.places.length === 0);
    assert.equal(new CompanionMemory(memoryFile).context(receiver.username).places.length, 0);
    assert.equal(context().notes.length, 2); assert.equal(commands, 0); assert.equal(deaths, 0); assert.equal(session.bot.health, 20);
    log({ result: 'PASS', memoryFile, restarted: true, independentlyObservedArrival: receiver.players[config.username]?.entity?.position,
      health: session.bot.health, notes: context().notes.length, history: context().history.map(h => ({ request: h.request, status: h.status })),
      commands, deaths, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, goal: read(goalFile)?.kind, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); session?.shutdown(); receiver?.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
