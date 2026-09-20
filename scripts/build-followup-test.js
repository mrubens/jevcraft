'use strict';

// Drive a build and then a follow-up that continues it, as a player would.
//
// Joins a second bot that types in chat, then waits for each request to reach a
// resting point instead of for a fixed time, so a slow build is observed rather
// than reported as a failure. Needs a running bot and a disposable server.
//
//   MC_PORT=25570 node scripts/build-followup-test.js
//   MC_PORT=25570 node scripts/build-followup-test.js "Jev build a barn" "Jev add a porch to the barn"
//
// Exits non-zero unless every request finished, so it can gate a change.

const mineflayer = require('mineflayer');
const { loadEnv } = require('../src/env');
loadEnv();

const COMMANDS = process.argv.slice(2);
if (!COMMANDS.length) COMMANDS.push('Jev build a small watchtower', 'Jev add a balcony to the watchtower');
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT || 900) * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);
// What the bot says when a request has reached a resting point. Blocked and
// budget-exhausted both invite another try, so both end the step as failures.
const DONE = /done!|you got|i've got|i'm here|all done|i'm at /i;
const STUCK = /say "jev resume"|ask me to build it again|taking a while/i;

const tester = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.TEST_PLAYER || 'TestPlayer',
  auth: 'offline',
  version: process.env.MC_VERSION || false,
});

let settled = null;
tester.on('chat', (username, message) => {
  if (username === tester.username) return;
  console.log(`${stamp()}  <${username}> ${message}`);
  if (DONE.test(message)) settled = { kind: 'done', message };
  else if (STUCK.test(message)) settled = { kind: 'stuck', message };
});
tester.on('kicked', reason => console.log(`${stamp()}  [test] kicked: ${reason}`));
tester.on('error', err => console.log(`${stamp()}  [test] error: ${err.message}`));

async function run(command) {
  console.log(`\n${stamp()}  >>> ${command}`);
  settled = null;
  tester.chat(command);
  const started = Date.now();
  while (Date.now() - started < STEP_TIMEOUT) {
    await sleep(1000);
    if (settled) {
      console.log(`${stamp()}  === ${settled.kind.toUpperCase()} after ${Math.round((Date.now() - started) / 1000)}s`);
      return settled;
    }
  }
  console.log(`${stamp()}  === TIMEOUT after ${STEP_TIMEOUT / 1000}s`);
  return { kind: 'timeout' };
}

tester.once('spawn', async () => {
  console.log(`${stamp()}  [test] ${tester.username} joined at ${tester.entity.position.floored()}`);
  await sleep(4000);
  // The roster can lag the join and chat works regardless, so never refuse to
  // drive the test just because the player list is late.
  for (let i = 0; i < 30 && !Object.keys(tester.players).some(n => n !== tester.username); i++) await sleep(1000);
  console.log(`${stamp()}  [test] roster: ${Object.keys(tester.players).join(', ') || '(empty)'}`);

  // Start clean so an older blocked goal cannot be resumed instead.
  tester.chat('Jev stop');
  await sleep(4000);

  const results = [];
  for (const command of COMMANDS) {
    const result = await run(command);
    results.push({ command, ...result });
    if (result.kind !== 'done') break;
    await sleep(5000);
  }

  console.log('\n========== SUMMARY ==========');
  for (const r of results) console.log(`${r.kind.padEnd(8)} ${r.command}\n         ${r.message || ''}`);
  const ok = results.length === COMMANDS.length && results.every(r => r.kind === 'done');
  console.log(ok ? 'PASS' : 'FAIL');
  tester.quit();
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
});
