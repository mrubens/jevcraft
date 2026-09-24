'use strict';
// The late-game rehearsal: the rungs the dream run has never reached, run
// on an isolated normal world before the run gets there. Each drill runs the
// ladder's own handlers (gameHandlers in src/work.js) with the survival
// layer beside them, as the run does, and reports what passing needs.
//
//   stronghold  about 300 blocks from the true stronghold with eyes and a
//               kit: throw, follow, find the End portal
//   enter_end   beside the portal found: fill the frame, go through
//   dragon      in the End: crystals, the dragon, alive
//
//   sh .test-endgame/start.sh &
//   MC_PORT=25578 node scripts/endgame.js stronghold
//   ENDGAME_JEV=1 ... uses Jev for the decisions (costs calls); by default
//   the code's own order decides, as in an outage.
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, countOf } = require('../src/skills');
const { createSurvival, gameHandlers } = require('../src/work');

const port = Number(process.env.MC_PORT || 25578);
if (!Number.isInteger(port) || [25565, 25570, 25574, 25577, 25579].includes(port)) throw new Error('The endgame rehearsal needs its own server (default 25578); 25565, 25570, 25574, 25577 and 25579 are in use elsewhere');
const serverDir = path.join(__dirname, '..', '.test-endgame');
const consolePath = path.join(serverDir, 'console.in');
const serverLog = path.join(serverDir, 'logs', 'latest.log');
const username = process.env.ENDGAME_USER || 'EndgameJev';
// A player to put in Spectator on the bot, if one is named in the environment.
require('../src/env').loadEnv();
const audience = process.env.ARENA_WATCHER || '';
const drills = process.argv.slice(2).length ? process.argv.slice(2) : ['stronghold'];
const id = Date.now().toString(36), directory = path.join(__dirname, '..', 'artifacts', `endgame-${id}`);
const statePath = path.join(__dirname, '..', 'artifacts', 'endgame-state.json');
fs.mkdirSync(directory, { recursive: true });
const log = entry => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = async line => { fs.writeFileSync(consolePath, line + '\n'); await sleep(150); };
const commands = async lines => { for (const line of lines) await command(line); };
const known = () => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return {}; } };
const remember = patch => fs.writeFileSync(statePath, JSON.stringify({ ...known(), ...patch }, null, 2));

// The server's own answer to "where is the stronghold": the truth the
// drill measures the bot's estimate against.
async function locateStronghold() {
  const before = fs.existsSync(serverLog) ? fs.statSync(serverLog).size : 0;
  await command('execute in minecraft:overworld run locate structure minecraft:stronghold');
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const text = fs.readFileSync(serverLog, 'utf8').slice(before);
    const m = /nearest minecraft:stronghold is at \[(-?\d+), ~, (-?\d+)\]/.exec(text);
    if (m) return { x: Number(m[1]), z: Number(m[2]) };
  }
  throw new Error('The server did not answer where the stronghold is');
}

// The server's answer to an `execute if` test, as a count. The client's
// view is no test: the dragon flies out of tracking range, and the first
// dragon drill "passed" in a minute with two arrows shot and every crystal
// standing. The dragon's death is the kill_dragon advancement.
async function serverCount(test, what) {
  const before = fs.existsSync(serverLog) ? fs.statSync(serverLog).size : 0;
  await command(`execute ${test}`);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const text = fs.readFileSync(serverLog, 'utf8').slice(before);
    // "Test passed. Count: 9" on this server; a bare "Test passed" is one.
    const m = /Test passed(?:[.,] count: (\d+))?/i.exec(text);
    if (m) return Number(m[1] ?? 1);
    if (/Test failed/.test(text)) return 0;
  }
  throw new Error(`The server did not answer about ${what}`);
}
const countInEnd = type => serverCount(`in minecraft:the_end if entity @e[type=minecraft:${type}]`, type);
const dragonKilled = async () => await serverCount(`if entity @a[name=${username},advancements={minecraft:end/kill_dragon=true}]`, 'the dragon') > 0;

const KIT = [['ender_eye', 20], ['diamond_pickaxe', 1], ['diamond_sword', 1], ['bow', 1], ['arrow', 64], ['cooked_beef', 64], ['water_bucket', 1],
  ['cobblestone', 64], ['cobblestone', 64], ['torch', 32], ['water_bucket', 1], ['white_bed', 1], ['oak_log', 16]];
const ARMOUR = { 'armor.head': 'iron_helmet', 'armor.chest': 'iron_chestplate', 'armor.legs': 'iron_leggings', 'armor.feet': 'iron_boots', 'weapon.offhand': 'shield' };
async function kit(extra = []) {
  await commands([`clear ${username}`, `effect clear ${username}`, `effect give ${username} minecraft:instant_health 1 10 true`,
    `effect give ${username} minecraft:saturation 1 10 true`, `gamemode survival ${username}`,
    ...[...KIT, ...extra].map(([item, n]) => `give ${username} minecraft:${item} ${n}`),
    ...Object.entries(ARMOUR).map(([slot, item]) => `item replace entity ${username} ${slot} with minecraft:${item}`)]);
}

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder); bot.loadPlugin(require('../src/gaze').gazePlugin);
let client = null;
if (process.env.ENDGAME_JEV === '1') { const { TypeSafe } = require('../src/typesafe'); client = new TypeSafe(); }
let died = false;
bot.on('death', () => { died = true; });
// The moment an enderman turns, and what the bot was doing and looking at.
const turned = new Set();
bot.on('entityUpdate', e => {
  if (e.name !== 'enderman' || turned.has(e.id)) return;
  const key = bot.registry.entitiesByName.enderman.metadataKeys.indexOf('creepy');
  if (!e.metadata?.[key]) return;
  turned.add(e.id);
  log({ provoked: { id: e.id, distance: Math.round(e.position.distanceTo(bot.entity.position)), pitch: Math.round((bot.entity.pitch || 0) * 100) / 100,
    controls: Object.entries(bot.controlState || {}).filter(([, v]) => v).map(([k]) => k), pathfinding: !!bot.pathfinder?.isMoving?.(), held: bot.heldItem?.name } });
});

// Where the bot stands, what is under it, and the nearest End stone: the
// dragon drill's first honest failure was on the spawn platform.
function where() {
  const p = bot.entity.position, under = bot.blockAt(p.offset(0, -1, 0))?.name;
  const stone = bot.registry.blocksByName.end_stone && bot.findBlocks({ matching: bot.registry.blocksByName.end_stone.id, maxDistance: 64, count: 1 })[0];
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), under, endStone: stone ? Math.round(stone.distanceTo(p)) : null, health: bot.health };
}
const dimension = () => String(bot.game?.dimension || '').replace(/^minecraft:/, '');
// The ladder's step with the survival layer beside it, as the run has it:
// survival first, the rung when survival has nothing to do.
async function runUntil(task, goal, save, handler, done, { minutes }) {
  // Every change of step or survival action is logged where it happened:
  // the two-second trace missed a walk off the spawn platform entirely.
  let last = '';
  const logged = save;
  save = () => { logged(); const now = JSON.stringify([goal.step?.action, goal.survivalAction?.action]);
    if (now !== last) { last = now; try { log({ change: { step: goal.step, survival: goal.survivalAction }, where: where() }); } catch (_) {} } };
  const survival = createSurvival(bot, { state: goal.survival || {}, client });
  goal.survival = survival.state;
  const deadline = Date.now() + minutes * 60000;
  let steps = 0, errors = {}; const fast = {};
  const trace = setInterval(() => { try { log({ trace: where(), step: goal.step?.action, survival: goal.survivalAction?.action }); } catch (_) {} }, 2000);
  try {
  while (!(await done()) && !died && Date.now() < deadline) {
    task.check(); steps++;
    try {
      const began = Date.now();
      // As runGoal does: in the End the fight owns every tick, survival
      // included. The rehearsal ran the survival layer there and measured
      // a fight the run never has.
      if (!/end$/.test(dimension()) && await survival.step(task, goal, save)) {
        // A survival step that returns at once, over and over, is a spin.
        if (Date.now() - began < 5) { const k = goal.survivalAction?.action || '?'; fast[k] = (fast[k] || 0) + 1; await sleep(50); }
        continue;
      }
      await handler(bot, task, goal, save);
    } catch (err) {
      if (err.name === 'Cancelled') throw err;
      errors[err.message.slice(0, 120)] = (errors[err.message.slice(0, 120)] || 0) + 1;
      if (err.name === 'Blocked') { log({ blocked: err.message, where: where() }); break; }
      await sleep(500);
    }
    await sleep(50);
  }
  } finally { clearInterval(trace); }
  return { steps, instantSurvival: fast, errors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 6), minutes: Math.round((minutes * 60000 - Math.max(0, deadline - Date.now())) / 6000) / 10 };
}

const DRILLS = {
  async stronghold(task) {
    const truth = await locateStronghold();
    const start = { x: truth.x + 280, z: truth.z + 110 };
    await kit();
    await commands([`time set 1000`, `execute in minecraft:overworld run spreadplayers ${start.x} ${start.z} 0 8 false ${username}`]);
    await sleep(4000); await bot.waitForChunksToLoad();
    const goal = { kind: 'win', request: 'endgame rehearsal', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 } } } };
    const handlers = gameHandlers(bot, client);
    const outcome = await runUntil(task, goal, () => {}, handlers.find_stronghold, () => !!goal.endPortal, { minutes: Number(process.env.ENDGAME_MINUTES || 25) });
    const search = goal.strongholdSearch || {};
    const estimate = search.estimate;
    const result = { drill: 'stronghold', pass: !!goal.endPortal && !died, died, truth,
      portal: goal.endPortal?.center, estimateOff: estimate ? Math.round(Math.hypot(estimate.x - truth.x, estimate.z - truth.z)) : null,
      from: Math.round(Math.hypot(bot.entity.position.x - truth.x, bot.entity.position.z - truth.z)),
      throws: search.throws || 0, moves: search.moves || 0, eyesLeft: countOf(bot, 'ender_eye'), ...outcome };
    if (goal.endPortal) remember({ endPortal: goal.endPortal, truth });
    return result;
  },
  async enter_end(task) {
    const portal = known().endPortal;
    if (!portal) return { drill: 'enter_end', pass: false, skipped: 'no portal found yet: run the stronghold drill first' };
    await kit([['ender_eye', 0]]);
    const c = portal.center || portal;
    await commands([`execute in minecraft:overworld run tp ${username} ${c.x + 3} ${c.y + 1} ${c.z}`]);
    await sleep(3000); await bot.waitForChunksToLoad();
    const goal = { kind: 'win', request: 'endgame rehearsal', endPortal: portal, gameProgress: { version: 1, milestones: { nether_entered: { at: 1 }, stronghold_located: { at: 1, ...portal } } } };
    const handlers = gameHandlers(bot, client);
    const outcome = await runUntil(task, goal, () => {}, handlers.enter_end, () => dimension() === 'the_end' || dimension() === 'end', { minutes: 6 });
    return { drill: 'enter_end', pass: /end$/.test(dimension()) && !died, died, dimension: dimension(), eyesLeft: countOf(bot, 'ender_eye'), ...outcome };
  },
  async dragon(task) {
    // Straight onto the spawn platform, where the portal lands a player:
    // the fight is what is rehearsed here. ENDGAME_VIA_PORTAL=1 walks in.
    if (!/end$/.test(dimension()) && process.env.ENDGAME_VIA_PORTAL !== '1') {
      await command(`execute in minecraft:the_end run tp ${username} 100.5 49 0.5`);
      await sleep(4000); await bot.waitForChunksToLoad();
    }
    if (!/end$/.test(dimension())) {
      const entered = await DRILLS.enter_end(task);
      log({ result: entered });
      if (!entered.pass) return { drill: 'dragon', pass: false, skipped: 'could not enter the End' };
    }
    // ENDGAME_BEDS=4 carries beds for the perched head (bed-bomb.js).
    await kit([['arrow', 64], ['arrow', 64], ...(process.env.ENDGAME_BEDS ? [['white_bed', Number(process.env.ENDGAME_BEDS)]] : [])]);
    const goal = { kind: 'win', request: 'endgame rehearsal', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 }, end_entered: { at: Date.now() } } } };
    const handlers = gameHandlers(bot, client);
    // Truth from the server, asked every twenty seconds.
    await sleep(3000);
    const before = await countInEnd('end_crystal');
    let checkedAt = 0, killed = await dragonKilled();
    if (killed) return { drill: 'dragon', pass: false, skipped: 'this player has killed a dragon already: the advancement cannot tell a new kill' };
    const slain = async () => { if (Date.now() - checkedAt > 20000) { checkedAt = Date.now(); killed = await dragonKilled(); } return killed; };
    const outcome = await runUntil(task, goal, () => {}, handlers.fight_dragon, slain, { minutes: Number(process.env.ENDGAME_MINUTES || 25) });
    killed = await dragonKilled();
    const combat = goal.endCombat || {};
    return { drill: 'dragon', pass: killed && !died, died, dragonsInView: await countInEnd('ender_dragon'), crystalsBefore: before, crystalsAfter: await countInEnd('end_crystal'),
      destroyed: (combat.destroyedCrystals || []).length, shots: (combat.shots || []).length, arrowsLeft: countOf(bot, 'arrow'), beds: combat.beds || [], ...outcome };
  },
};

bot.once('spawn', async () => {
  const task = new Task('endgame', 'late-game rehearsal');
  try {
    await bot.waitForChunksToLoad();
    configureMovements(bot);
    // A run that ended mid-air (the dragon's knockback) rejoins there: slow
    // falling for the setup, or the next drill dies before its first step.
    await commands([`op ${username}`, `effect give ${username} minecraft:slow_falling 8 0 true`, 'difficulty normal', ...(audience ? [`gamemode spectator ${audience}`] : [])]);
    for (const name of drills) {
      if (!DRILLS[name]) throw new Error(`Unknown drill ${name}`);
      died = false;
      log({ drill: name });
      const result = await DRILLS[name](task);
      log({ result });
      if (audience) await commands([`spectate ${username} ${audience}`]);
    }
    bot.quit(); setTimeout(() => process.exit(0), 500);
  } catch (err) {
    log({ endgame: 'FAIL', reason: err.message, stack: err.stack?.split('\n').slice(0, 5) });
    bot.quit(); setTimeout(() => process.exit(1), 500);
  }
});
bot.on('kicked', reason => log({ kicked: String(reason).slice(0, 200) }));
bot.on('error', err => log({ error: err.message }));
