'use strict';
// Isolated live rotation diagnostic. No grants, commands, attacks or movement.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { compatibilityPlugin } = require('../src/compatibility');
const { sentAimMatches } = require('../src/projectiles');
const port = Number(process.env.MC_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25577].includes(port)) throw new Error('Choose an explicit isolated test MC_PORT');
const id = `aim-${Date.now().toString(36)}`, directory = path.join(__dirname, '..', 'artifacts', id);
fs.mkdirSync(directory, { recursive: true });
const bot = mineflayer.createBot({ host: '127.0.0.1', port, username: `Aim${id.slice(4)}`, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin);
let finished = false;
const record = { classification: 'controlled client rotation diagnostic; not game-completion acceptance', port, setupCommands: [], turns: [] };
const finish = error => {
  if (finished) return; finished = true; clearTimeout(timer);
  Object.assign(record, { result: error ? 'FAIL' : 'PASS', error: error?.stack, directory });
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record)); bot.quit();
  setTimeout(() => process.exit(error ? 1 : 0), 300);
};
const timer = setTimeout(() => finish(new Error('Rotation diagnostic exceeded 30 seconds')), 30000);
bot.on('error', finish); bot.on('end', reason => { if (!finished) finish(new Error(`Disconnected: ${reason}`)); });
bot.on('death', () => finish(new Error('Player died during rotation diagnostic')));
bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad(); await bot.waitForTicks(2);
    record.initial = { position: { ...bot.entity.position }, health: bot.health, dimension: bot.game.dimension };
    const yaw = bot.entity.yaw;
    for (const pitch of [0, 1.05, -.65, .9]) {
      const target = { yaw, pitch }, started = Date.now();
      await bot.look(yaw, pitch, false);
      const atPromise = { ...bot.lastSentRotation }, premature = !sentAimMatches(atPromise, target);
      while (!sentAimMatches(bot.lastSentRotation, target) && Date.now() - started < 2500) {
        await new Promise(r => setTimeout(r, 10));
      }
      assert(sentAimMatches(bot.lastSentRotation, target), 'Both angles must reach the outgoing packet');
      record.turns.push({ target, atPromise, premature, sent: { ...bot.lastSentRotation }, elapsedMs: Date.now() - started });
    }
    record.final = { position: { ...bot.entity.position }, health: bot.health, dimension: bot.game.dimension };
    finish();
  } catch (error) { finish(error); }
});
