'use strict';
// Jev down on a scratch server (note 707): the bot's own loop (work.js
// runIdle, the arbiter live) with its TypeSafe client pointed at a closed
// port. What is looked for: the question held, '[jev down]' in the log and
// the chat line said once, the bot not moving while it holds; a fire set at
// its feet answered all the same (the body's safety rule); and, the client
// pointed back at TypeSafe, '[jev down] back', "Jev is back." and a decision
// of Jev's own after it. Prints one JSON line of what was seen.
// On a scratch server only (its console pipe, ARENA_CONSOLE; the port,
// MC_PORT); never a trial's. TypeSafe only (no OpenRouter).
//   MC_PORT=25707 ARENA_CONSOLE=<dir>/console.in node --env-file=.env scripts/jev-down-probe.js
const mineflayer = require('mineflayer'); const fs = require('fs');
const { pathfinder } = require('mineflayer-pathfinder');
const PORT = Number(process.env.MC_PORT || 0), CONSOLE = process.env.ARENA_CONSOLE;
if (!PORT || !CONSOLE) { console.error('MC_PORT and ARENA_CONSOLE, a scratch server\'s'); process.exit(1); }
if ([25565].includes(PORT) || (PORT >= 25581 && PORT <= 25610)) { console.error('not a trial server'); process.exit(1); }
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAME = 'DownProbe';
const CLOSED = process.env.CLOSED_ENDPOINT || 'http://127.0.0.1:1/v1/systemone';

// Every line the bot's code logs, kept with its time.
const lines = [];
const t0 = Date.now();
const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
const original = console.log;
console.log = (...a) => { const line = a.join(' '); lines.push({ at: seconds(), line }); original(`[${seconds()}]`, line); };
const seen = re => lines.find(l => re.test(l.line));
const until = async (test, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(100); } return false; };

const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: NAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(require('../src/compatibility').compatibilityPlugin);
bot.loadPlugin(pathfinder);
const said = [];
bot.once('spawn', async () => {
  const out = { port: PORT };
  const { TypeSafe } = require('../src/typesafe');
  const client = new TypeSafe({ provider: 'typesafe' });
  const live = client.endpoint;
  client.endpoint = CLOSED;
  const chat = bot.chat.bind(bot);
  bot.chat = m => { said.push({ at: seconds(), m }); original(`[${seconds()}] <chat>`, m); return chat(m); };
  try {
    say('difficulty peaceful'); say(`clear ${NAME}`); say(`gamemode survival ${NAME}`); say('time set 1000'); say('gamerule doDaylightCycle false');
    say(`tp ${NAME} 0.5 -60 0.5`); say(`fill -6 -61 -6 6 -61 6 minecraft:grass_block`); say(`fill -6 -60 -6 6 -56 6 minecraft:air`);
    say(`give ${NAME} minecraft:beef 3`); say(`give ${NAME} minecraft:oak_log 8`); say(`effect clear ${NAME}`);
    await sleep(4000);
    await bot.waitForChunksToLoad();
    require('../src/movement').configureMovements(bot);
    const { Task } = require('../src/skills');
    const work = require('../src/work');
    const goal = { kind: 'idle', status: 'running' };
    const store = { save: () => {} };
    const task = new Task('jev down probe');
    // The bot's own loop, as in play, with nothing else to do.
    const running = work.runIdle(bot, task, goal, store, { decisionClient: client, until: () => task.cancelled }).catch(err => { out.loopError = String(err?.stack || err).slice(0, 400); });

    // 1. Held: the first question fails, the bot says it once and stays.
    out.heldSeen = await until(() => seen(/^\[jev down\] (?!back)/), 30000);
    out.heldLine = seen(/^\[jev down\] (?!back)/)?.line;
    const at = bot.entity.position.clone();
    await sleep(10000);
    out.movedWhileHeld = Math.round(bot.entity.position.distanceTo(at) * 100) / 100;
    out.waitingSaid = said.filter(s => /waiting here until it does/.test(s.m)).length;
    out.decisionsWhileHeld = (goal.decisions || []).filter(d => !d.stale && d.path && !d.safetyRule).map(d => d.id);

    // 2. A fire at the feet: the body's own physics is answered all the same.
    const feet = bot.entity.position.floored();
    const before = lines.length, healthBefore = bot.health;
    say(`setblock ${feet.x} ${feet.y} ${feet.z} minecraft:fire`);
    await until(() => lines.slice(before).some(l => /safety rule|out of fire|out_of_fire|put_out_flames|\[body\]/.test(l.line)), 8000);
    await sleep(3000);
    out.fireLines = lines.slice(before).filter(l => /safety rule|fire|\[body\]|\[arbiter\]/.test(l.line)).map(l => `${l.at} ${l.line}`).slice(0, 12);
    out.fireMoved = Math.round(bot.entity.position.distanceTo(feet.offset(0.5, 0, 0.5)) * 100) / 100;
    out.healthAfterFire = bot.health; out.healthBeforeFire = healthBefore;
    out.stillDown = require('../src/jev-down').isDown(bot);

    // 3. Jev back: the client pointed at TypeSafe again.
    const back = lines.length;
    client.endpoint = live;
    out.restoredAt = seconds();
    out.backSeen = await until(() => lines.slice(back).some(l => /^\[jev down\] back/.test(l.line)), 60000);
    out.backLine = lines.slice(back).find(l => /^\[jev down\] back/.test(l.line))?.line;
    out.backSaid = said.filter(s => /Jev is back/.test(s.m)).length;
    await until(() => (goal.decisions || []).some(d => !d.stale && d.judgments?.length), 60000);
    out.freshDecision = (goal.decisions || []).filter(d => !d.stale && d.judgments?.length).map(d => ({ id: d.id, path: d.path, askedAt: d.askedAt }))[0] || null;
    out.staleAfterOutage = (goal.decisions || []).filter(d => d.jevWasDown).map(d => ({ id: d.id, jevWasDown: d.jevWasDown }));
    out.said = said;
    task.cancel();
    await Promise.race([running, sleep(5000)]);
  } catch (err) { out.error = String(err?.stack || err); }
  original(JSON.stringify(out));
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
bot.on('kicked', r => { original('kicked', r); process.exit(1); });
bot.on('error', e => { original('error', e.message); });
