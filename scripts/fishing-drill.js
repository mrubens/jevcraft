'use strict';
// The fishing drill (note 1203): the food question's two ways to fish
// (src/fishing.js), run against the rehearsal server on a pool built in the
// sky, with what each brought and how long it took.
//
//   sh .test-endgame/start.sh &
//   node scripts/fishing-drill.js rod spear craft
//
//   rod    a rod carried at the bank: fish_with_rod chosen and run
//   spear  cod and salmon in the pool, a stone sword: hunt_<id> chosen and run
//   craft  no rod, 2 string and planks: fish_with_rod makes the rod first
//
// FISH_BARE=1: the spear drill with bare hands (three blows a fish).
// FISH_DIR: the rehearsal server's directory (its console.in), .test-endgame
// unless set. The port is 25578 only.
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task } = require('../src/skills');
const { createSurvival } = require('../src/work');
const { forageChoices, foodSupply } = require('../src/foraging');

const port = Number(process.env.MC_PORT || 25578);
if (port !== 25578) throw new Error('The fishing drill runs on the rehearsal server, port 25578, only');
const serverDir = process.env.FISH_DIR ? path.resolve(process.env.FISH_DIR) : path.join(__dirname, '..', '.test-endgame');
const consolePath = path.join(serverDir, 'console.in');
const username = process.env.FISH_USER || 'FishJev';
const drills = process.argv.slice(2).length ? process.argv.slice(2) : ['rod', 'spear'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = async line => { fs.writeFileSync(consolePath, line + '\n'); await sleep(150); };
const commands = async lines => { for (const line of lines) await command(line); };
const log = entry => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

// A stone slab at y 200 to 204 with a pool 17 by 13 and 4 deep let into it;
// the bot on the bank at its north side, under open sky, by day.
const O = { x: Number(process.env.FISH_X || 5000), y: 200, z: Number(process.env.FISH_Z || 5000) };
async function arena() {
  await commands([`gamemode creative ${username}`, `tp ${username} ${O.x} ${O.y + 6} ${O.z - 7}`]);
  await sleep(3000);
  await commands([
    `fill ${O.x - 10} ${O.y} ${O.z - 10} ${O.x + 10} ${O.y + 4} ${O.z + 10} minecraft:stone`,
    `fill ${O.x - 10} ${O.y + 5} ${O.z - 10} ${O.x + 10} ${O.y + 12} ${O.z + 10} minecraft:air`,
    `fill ${O.x - 8} ${O.y + 1} ${O.z - 4} ${O.x + 8} ${O.y + 4} ${O.z + 8} minecraft:water`,
    `kill @e[type=!minecraft:player,x=${O.x},y=${O.y},z=${O.z},distance=..40]`,
    'time set 2000', 'weather clear', `tp ${username} ${O.x + 0.5} ${O.y + 5} ${O.z - 6.5}`, `gamemode survival ${username}`,
    `clear ${username}`, `effect clear ${username}`, `effect give ${username} minecraft:instant_health 1 10 true`, `effect give ${username} minecraft:saturation 1 10 true`,
  ]);
  await sleep(2000);
}

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
let died = false;
bot.on('death', () => { died = true; });
bot.on('kicked', reason => log({ kicked: String(reason).slice(0, 200) }));

const carried = () => Object.fromEntries(bot.inventory.items().map(i => [i.name, bot.inventory.items().filter(j => j.name === i.name).reduce((n, j) => n + j.count, 0)]));
async function ask(task, goal, survival) {
  const choices = await forageChoices(bot, task, goal, () => {}, survival.actions, survival.state);
  return choices;
}

const run = {
  async rod(task, goal, survival) {
    await commands([`give ${username} minecraft:fishing_rod 1`]); await sleep(2500);
    const before = Object.keys(await ask(task, goal, survival));
    const choices = await ask(task, goal, survival), way = choices.fish_with_rod;
    log({ drill: 'rod', options: before, fish_with_rod: way?.description || null });
    if (!way) return { ok: false, why: 'fish_with_rod was not offered' };
    const started = Date.now(), points = foodSupply(bot);
    let error = null, result = null;
    try { result = await way.run(); } catch (err) { error = err.message; }
    return { ok: !error && foodSupply(bot) > points, error, result, seconds: Math.round((Date.now() - started) / 1000), pointsGained: foodSupply(bot) - points, carried: carried(), survivalAction: goal.survivalAction };
  },
  async spear(task, goal, survival) {
    await commands([`clear ${username}`, ...(process.env.FISH_BARE ? [] : [`give ${username} minecraft:stone_sword 1`]),
      ...[[0, 3, 0], [2, 3, 1], [-2, 2, 2]].map(([dx, dy, dz]) => `summon minecraft:cod ${O.x + dx} ${O.y + dy} ${O.z + dz}`),
      ...[[3, 3, 3], [-3, 2, 4]].map(([dx, dy, dz]) => `summon minecraft:salmon ${O.x + dx} ${O.y + dy} ${O.z + dz}`)]);
    await sleep(2500);
    const kills = [], started = Date.now(), points = foodSupply(bot);
    for (let i = 0; i < 5; i++) {
      const choices = await ask(task, goal, survival);
      const key = Object.keys(choices).find(k => /^hunt_\d+$/.test(k));
      if (i === 0) log({ drill: 'spear', options: Object.keys(choices), hunt: key ? choices[key].description : null });
      if (!key) break;
      const t0 = Date.now();
      try { await choices[key].run(); kills.push({ ...goal.survivalAction, at: undefined, health: bot.health, breath: bot.oxygenLevel }); }
      catch (err) { kills.push({ error: err.message, name: err.name, seconds: Math.round((Date.now() - t0) / 1000), health: bot.health, breath: bot.oxygenLevel }); }
      await sleep(500);
    }
    bot.clearControlStates();
    return { ok: foodSupply(bot) > points, kills, seconds: Math.round((Date.now() - started) / 1000), pointsGained: foodSupply(bot) - points, carried: carried(), health: bot.health };
  },
  async craft(task, goal, survival) {
    await commands([`tp ${username} ${O.x + 0.5} ${O.y + 5} ${O.z - 6.5}`, `clear ${username}`, `give ${username} minecraft:string 2`, `give ${username} minecraft:oak_planks 8`]); await sleep(1500);
    const choices = await ask(task, goal, survival), way = choices.fish_with_rod;
    log({ drill: 'craft', options: Object.keys(choices), rod: way?.description?.rod || null });
    if (!way) return { ok: false, why: 'fish_with_rod was not offered with 2 string carried' };
    way.description.fishWanted = 1;
    const started = Date.now(), points = foodSupply(bot);
    let error = null, result = null;
    try { result = await require('../src/fishing').fishWithRod(bot, task, { stand: new (require('vec3').Vec3)(way.target.x, way.target.y, way.target.z), water: new (require('vec3').Vec3)(way.description.water.x, way.description.water.y, way.description.water.z), distance: way.description.distance }, survival.actions, goal, () => {}, { want: 1 }); }
    catch (err) { error = err.message; }
    return { ok: !error && foodSupply(bot) > points, error, result, seconds: Math.round((Date.now() - started) / 1000), pointsGained: foodSupply(bot) - points, carried: carried() };
  },
};

bot.once('spawn', async () => {
  const task = new Task('fishing', 'fishing drill');
  const results = {};
  try {
    await sleep(1500);
    configureMovements(bot);
    await arena();
    const goal = { request: 'drill', survival: {} };
    const survival = createSurvival(bot, { state: goal.survival, client: null });
    goal.survival = survival.state;
    for (const name of drills) {
      if (!run[name]) throw new Error(`No drill named ${name}`);
      results[name] = await run[name](task, goal, survival);
      log({ drill: name, ...results[name], died });
    }
  } catch (err) { log({ error: err.stack || err.message }); }
  const ok = Object.values(results).length === drills.length && Object.values(results).every(r => r.ok) && !died;
  log({ done: true, ok });
  bot.quit(); setTimeout(() => process.exit(ok ? 0 : 1), 500);
});
