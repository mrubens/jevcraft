'use strict';

// Drive the live bot end to end by joining a second bot that plays the part of
// a human typing in chat. Prints what JevBot says and where it goes, so a real
// behavioural failure is visible without a Minecraft client open.
//
//   node scripts/live-test.js "chop some trees" "come here"

const mineflayer = require('mineflayer');
const { loadEnv } = require('../src/env');
loadEnv();

const COMMANDS = process.argv.slice(2);
if (COMMANDS.length === 0) COMMANDS.push('where are you?');

const SECONDS_PER_COMMAND = Number(process.env.LIVE_TEST_WAIT || 25);

const tester = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: Number(process.env.MC_PORT || 25565),
  username: 'TestPlayer',
  auth: 'offline',
  version: process.env.MC_VERSION || false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// entity.position is mutated in place, so a snapshot must be cloned or every
// comparison against it reports zero movement.
const posOf = (bot, name) => {
  const p = bot.players[name];
  return p && p.entity ? p.entity.position.clone() : null;
};

tester.on('chat', (username, message) => {
  if (username !== tester.username) console.log(`    <${username}> ${message}`);
});

tester.once('spawn', async () => {
  console.log(`[test] TestPlayer joined at ${tester.entity.position.floored()}`);
  await sleep(3000);

  const target = Object.keys(tester.players).find((n) => n !== tester.username);
  if (!target) {
    console.log('[test] no other player online — is the bot running?');
    return tester.quit();
  }
  console.log(`[test] found ${target} at ${posOf(tester, target)?.floored()}\n`);

  for (const command of COMMANDS) {
    const before = posOf(tester, target);
    console.log(`  >> "${command}"`);
    tester.chat(command);

    // Watch for the whole window so slow behaviour is still observed.
    for (let i = 0; i < SECONDS_PER_COMMAND; i++) await sleep(1000);

    const after = posOf(tester, target);
    const moved = before && after ? Math.round(before.distanceTo(after) * 10) / 10 : null;
    console.log(`     moved ${moved} blocks -> ${after ? after.floored() : 'unknown'}\n`);
  }

  console.log('[test] done');
  tester.quit();
  process.exit(0);
});

tester.on('error', (e) => console.error('[test] error:', e.message));
tester.on('kicked', (r) => console.error('[test] kicked:', r));
