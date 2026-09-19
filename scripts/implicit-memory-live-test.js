'use strict';
// Real player chat, production sessions, reconnects and ordinary Survival
// handovers with controlled supplies. Only use an isolated fixture server.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { createSession } = require('../src/session'), { TypeSafe } = require('../src/typesafe');
const { Task, countOf } = require('../src/skills'), { waitFor } = require('../src/work');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Explicit isolated MC_PORT required');
require('../src/env').loadEnv();
const id = Date.now().toString(36), directory = path.resolve('artifacts', `implicit-memory-live-${id}`), x = Number(process.env.MEMORY_TEST_X || 3000);
const stateDirectory = path.join(directory, 'state'); fs.mkdirSync(stateDirectory, { recursive: true });
const config = { host: '127.0.0.1', port, username: `Jev${id}`, version: '26.1', auth: 'offline' };
const identity = `${config.host}-${config.port}-${config.username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
process.env.MC_WORLD_ID = `implicit-fixture-${id}`;
const goalFile = path.join(stateDirectory, `${identity}.json`);
fs.writeFileSync(path.join(stateDirectory, `${identity}-survival.json`), JSON.stringify({ version: 1, paused: true }));
const client = new TypeSafe(), task = new Task('implicit memory fixture'), chats = [];
let session, receiver, deaths = 0, commands = 0;
const log = event => { const row = JSON.stringify({ at: new Date().toISOString(), ...event }); console.log(row); fs.appendFileSync(path.join(directory, 'events.jsonl'), row + '\n'); };
const readGoal = () => fs.existsSync(goalFile) ? JSON.parse(fs.readFileSync(goalFile)) : null;
const memory = () => session.bot.companionMemory.context(receiver.username);
const ready = async bot => { await new Promise(r => bot.once('spawn', r)); await bot.waitForChunksToLoad(); };
const start = () => {
  const s = createSession(config, client, { stateDirectory });
  s.bot.on('death', () => { deaths++; task.cancel(); }); s.bot.on('error', e => log({ error: e.message }));
  const write = s.bot._client.write;
  s.bot._client.write = function (name, packet, ...args) { if (name.startsWith('chat_command')) commands++; return write.call(this, name, packet, ...args); };
  return s;
};
const restart = async () => {
  const ended = new Promise(resolve => session.bot.once('end', resolve)); session.shutdown(); await ended;
  session = start(); await ready(session.bot);
};
const ask = async (message, predicate) => {
  log({ request: message }); const start = chats.length; receiver.chat(message);
  await waitFor(task, () => predicate(chats.slice(start)), 60000);
};
const timer = setTimeout(() => task.cancel(), 7 * 60000);
(async () => {
  try {
    session = start(); receiver = mineflayer.createBot({ host: config.host, port, username: `Pal${id}`, version: '26.1', auth: 'offline' });
    receiver.on('chat', (from, message) => { if (from === config.username) { chats.push(message); log({ reply: message }); } });
    receiver.on('death', () => { deaths++; task.cancel(); });
    await Promise.all([ready(session.bot), ready(receiver)]);
    const setup = [`forceload add ${x - 16} -16 ${x + 16} 16`, `fill ${x - 8} 64 -8 ${x + 8} 72 8 air`,
      `fill ${x - 8} 61 -8 ${x + 8} 63 8 bedrock`, `gamemode survival ${config.username}`, `gamemode survival ${receiver.username}`,
      `tp ${config.username} ${x + 4.5} 64 .5`, `tp ${receiver.username} ${x + .5} 64 .5`,
      `give ${config.username} cherry_log 1`, `give ${config.username} cherry_planks 2`, `give ${config.username} oak_planks 2`];
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(setup, null, 2)); log({ phase: 'setup', directory });
    await waitFor(task, () => fs.existsSync(path.join(directory, 'ready')), 180000);
    await waitFor(task, () => countOf(session.bot, 'oak_planks') === 2 && session.bot.entity.position.y === 64, 10000);
    await ask('Jev give me a cherry log', () => countOf(receiver, 'cherry_log') === 1 && readGoal()?.status === 'complete');
    assert.equal(memory().preferences[0]?.value, 'cherry'); assert.equal(memory().notes.length, 0);
    const evidence = structuredClone(memory().preferences[0]);
    await restart(); assert.deepEqual(memory().preferences, [evidence]);
    await ask('Jev give me two planks', () => countOf(receiver, 'cherry_planks') === 2 && readGoal()?.status === 'complete');
    assert.equal(readGoal().item, 'cherry_planks'); assert.equal(countOf(receiver, 'oak_planks'), 0);
    assert.deepEqual(memory().preferences, [evidence], 'the inferred default cannot become new evidence');
    await ask('Jev what wood do I prefer?', replies => replies.some(reply => /asked for cherry wood before/.test(reply)));
    await ask('Jev give me two oak planks', () => countOf(receiver, 'oak_planks') === 2 && readGoal()?.status === 'complete');
    assert.equal(memory().preferences[0].value, 'oak');
    await ask('Jev forget my wood preference', () => memory().preferences.length === 0);
    await restart(); assert.equal(memory().preferences.length, 0);
    assert.equal(commands, 0); assert.equal(deaths, 0); assert.equal(session.bot.health, 20);
    log({ result: 'PASS', rememberedAcrossRestart: evidence.value, noSelfReinforcement: true, explicitOverride: 'oak', forgottenAcrossRestart: true,
      independentlyReceived: receiver.inventory.items().map(i => ({ item: i.name, count: i.count })), commands, deaths, health: session.bot.health, directory });
  } catch (error) { log({ result: 'FAIL', error: error.stack, goal: readGoal()?.kind, directory }); process.exitCode = 1; }
  finally { clearTimeout(timer); session?.shutdown(); receiver?.quit(); setTimeout(() => process.exit(process.exitCode || 0), 500); }
})();
