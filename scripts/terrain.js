'use strict';
// Terrain drills (see scripts/lib/terrain.js): the places that killed or
// stalled the bot, staged on the isolated arena server and run against the
// real code. A drill passes when the bot gets through: no death, no fall,
// no pacing, and the thing done that the place is about.
//
//   sh .test-combat/start.sh &
//   MC_PORT=25574 node scripts/terrain.js                 # every drill, twice
//   MC_PORT=25574 TERRAIN_REPEATS=3 node scripts/terrain.js flooded_ore
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { createSurvival, dig, waitFor, enterPortal } = require('../src/work');
const { bridgeTo } = require('../src/bridging');
const { restockFromStash } = require('../src/home-stash');
const { TERRAIN, terrainDrill, buildCommands, placeCommands, vec } = require('./lib/terrain');

const port = Number(process.env.MC_PORT || 25574);
if (!Number.isInteger(port) || [25565, 25570, 25577, 25579].includes(port)) {
  throw new Error('Terrain drills need an isolated MC_PORT; 25565, 25570, 25577 and 25579 are in use elsewhere');
}
const consolePath = process.env.ARENA_CONSOLE || path.join(__dirname, '..', '.test-combat', 'console.in');
const repeats = Number(process.env.TERRAIN_REPEATS || 2);
const names = process.argv.slice(2);
const selected = names.length ? names.map(name => terrainDrill(name) || (() => { throw new Error(`Unknown terrain drill ${name}`); })()) : TERRAIN;
const username = process.env.TERRAIN_USER || 'TerrainJev';
const audience = process.env.ARENA_WATCHER || 'DoloresDoodle';
const id = Date.now().toString(36);
const directory = path.join(__dirname, '..', 'artifacts', `terrain-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = entry => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n'); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(line) { fs.writeFileSync(consolePath, line + '\n'); await sleep(120); }
async function commands(list) { for (const line of list) await command(line); }

const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin); bot.loadPlugin(pathfinder);
const task = new Task('terrain', 'terrain drills');
setTimeout(() => task.cancel(), Number(process.env.TERRAIN_TIMEOUT_MS || 30 * 60000)).unref();

let watch = null;
bot.on('death', () => { if (watch) watch.died = true; });
// The lowest point in the drill's own dimension: a portal that works lands
// the bot somewhere else entirely, which is not a fall.
bot.on('move', () => { if (watch && bot.entity?.position && String(bot.game.dimension).includes(watch.dimension)) watch.minY = Math.min(watch.minY, bot.entity.position.y); });

// Each drill's run: the real code, bounded by the drill's time, returning
// what passing needs to see.
const RUNS = {
  async furnace_wait(d, bounded) {
    const { acquireStep } = require('../src/work');
    const goal = { kind: 'obtain', request: 'terrain drill' };
    await sleep(1500);
    const before = { coal: countOf(bot, 'coal'), raw: countOf(bot, 'raw_iron') + countOf(bot, 'iron_ore') };
    let error = null;
    const started = Date.now();
    try { for (let i = 0; i < 6 && countOf(bot, 'iron_ingot') < 8; i++) await acquireStep(bot, bounded, 'iron_ingot', 8, goal, () => {}); } catch (err) { error = err.message; }
    const ores = ['3900,66,3902', '3898,65,3900', '3900,65,3898'].filter(k => !/_ore$/.test(bot.blockAt(vec(k.split(',').map(Number)))?.name || '')).length;
    return { pass: countOf(bot, 'iron_ingot') >= 8 && ores >= 1, detail: { ingots: countOf(bot, 'iron_ingot'), oresDugWhileWaiting: ores, seconds: Math.round((Date.now() - started) / 1000), error } };
  },
  async craft_full_pockets(d, bounded) { return RUNS.craft_cycle(d, bounded); },
  async craft_cycle(d, bounded) {
    const { acquireStep } = require('../src/work');
    const goal = { kind: 'obtain', request: 'terrain drill' };
    await sleep(1500);
    const errors = {}, took = [];
    try { for (let round = 0; round < d.rounds; round++) {
      const want = countOf(bot, 'stone_pickaxe') + 1, started = Date.now();
      for (let tries = 0; tries < 12 && countOf(bot, 'stone_pickaxe') < want; tries++) {
        bounded.check();
        try { await acquireStep(bot, bounded, 'stone_pickaxe', want, goal, () => {}); }
        catch (err) { if (['OutOfTime', 'Cancelled'].includes(err.name)) throw err; const k = err.message.slice(0, 70); errors[k] = (errors[k] || 0) + 1; }
      }
      took.push(Math.round((Date.now() - started) / 100) / 10);
    } } catch (err) { if (err.name !== 'OutOfTime') throw err; errors['(out of time)'] = 1; }
    const timeouts = Object.entries(errors).filter(([k]) => /Timed out/.test(k)).reduce((n, [, v]) => n + v, 0);
    return { pass: countOf(bot, 'stone_pickaxe') >= d.rounds && timeouts === 0, detail: { pickaxes: countOf(bot, 'stone_pickaxe'), secondsPerRound: took, errors, free: bot.inventory.emptySlotCount(), cursor: bot.inventory.selectedItem?.name, grid: [1, 2, 3, 4].map(i => bot.inventory.slots[i]?.name || '-') } };
  },
  async village_trade(d, bounded) {
    const { tradeStep } = require('../src/trading');
    const goal = { kind: 'win', request: 'terrain drill', villages: [{ x: d.village[0], y: d.village[1], z: d.village[2], dimension: 'overworld' }] };
    await sleep(2000);
    let trades = 0, error = null;
    try { while (countOf(bot, 'ender_pearl') < 1 && trades < 12) { bounded.check(); if (!await tradeStep(bot, bounded, goal, () => {}, { navigate })) break; trades++; } }
    catch (err) { if (err.name !== 'OutOfTime') error = err.message; }
    return { pass: countOf(bot, 'ender_pearl') >= 1, detail: { trades, pearls: countOf(bot, 'ender_pearl'), emeralds: countOf(bot, 'emerald'), arrows: countOf(bot, 'arrow'),
      made: goal.trading?.trades?.map(t => `${t.kind}:${t.gave?.count} ${t.gave?.name}->${t.got?.count} ${t.got?.name}`), read: Object.values(goal.trading?.offers || {}).map(o => (o.trades || []).length), error } };
  },
  async enchant_table(d, bounded) {
    const { enchantStep } = require('../src/enchanting');
    const { workstation } = require('../src/work');
    const goal = { kind: 'win', request: 'terrain drill' };
    await sleep(1500);
    let error = null, done = 0;
    try { while (done < 2 && await enchantStep(bot, bounded, goal, () => {}, { workstation })) done++; } catch (err) { error = err.message; }
    const { enchantsOf } = require('../src/enchanting');
    const sword = bot.inventory.items().find(i => i.name === 'diamond_sword');
    return { pass: enchantsOf(sword).length > 0 && countOf(bot, 'lapis_lazuli') > 0, detail: { sword: enchantsOf(sword), inventory: bot.inventory.items().map(i => `${i.count} ${i.name}`), done: goal.enchanting?.done, level: bot.experience?.level, error } };
  },
  async mineshaft_cart(d, bounded) {
    const { lootNearby } = require('../src/looting');
    const goal = { kind: 'win', request: 'terrain drill', landmarks: [{ kind: 'mineshaft', x: d.shaft[0], y: d.shaft[1], z: d.shaft[2], dimension: 'overworld' }] };
    await sleep(1500);
    const before = { bread: countOf(bot, 'bread'), iron: countOf(bot, 'iron_ingot') };
    let opened = false, error = null;
    try { opened = await lootNearby(bot, bounded, goal, () => {}, { approach: null, open: null, navigate }); } catch (err) { error = err.message; }
    const took = { bread: countOf(bot, 'bread') - before.bread, iron: countOf(bot, 'iron_ingot') - before.iron };
    return { pass: opened && took.bread === 3 && took.iron === 4, detail: { opened, took, record: goal.looted && Object.values(goal.looted)[0], error } };
  },
  async flooded_cave(d, bounded) {
    // As the game loop has it: the survival layer first, then, standing in
    // water, the shore search. Passing is dry ground and alive.
    const { reachShore } = require('../src/shore');
    const { dryStanding } = require('../src/mining-access');
    const { swimmableWater } = require('../src/terrain');
    const survival = createSurvival(bot, { state: {} });
    const goal = { kind: 'win', request: 'terrain drill' };
    const actions = [], errors = {};
    const out = () => dryStanding(bot, bot.entity.position) && !swimmableWater(bot.blockAt(bot.entity.position.floored()));
    try {
      while (!watch.died && !out()) {
        bounded.check();
        try {
          if (!await survival.step(bounded, goal, () => {})) await reachShore(bot, bounded, goal, () => {}, { move: navigate });
        } catch (err) { if (['OutOfTime', 'Cancelled'].includes(err.name)) throw err; errors[err.message.slice(0, 80)] = (errors[err.message.slice(0, 80)] || 0) + 1; }
        const a = goal.step?.action || goal.survivalAction?.action; if (a && actions.at(-1) !== a) actions.push(a);
        await sleep(50);
      }
    } catch (err) { if (err.name !== 'OutOfTime') throw err; }
    return { pass: out() && !watch.died, detail: { out: out(), y: Math.round(bot.entity.position.y * 10) / 10, actions: actions.slice(0, 10), errors, dig: goal.shoreRecovery?.dig } };
  },
  async flooded_ore(d, bounded) {
    const survival = createSurvival(bot, { state: {} });
    const targets = [];
    const report = survival.report.bind(survival);
    survival.report = (goal, save, action) => { if (action.action === 'night_mine') targets.push(`${action.target.x},${action.target.y},${action.target.z}`); return report(goal, save, action); };
    const goal = { kind: 'win', request: 'terrain drill' };
    const dry = vec(d.dry);
    while (!watch.died) {
      bounded.check();
      if (bot.blockAt(dry)?.name !== 'iron_ore') break;
      if (!await survival.nightMine(bounded, goal, () => {})) break;
      await sleep(50);
    }
    const wet = d.wet.join(',');
    return { pass: bot.blockAt(dry)?.name !== 'iron_ore' && !targets.includes(wet),
      detail: { targetedWet: targets.includes(wet), mined: survival.state.nightMine?.mined || 0, targets: [...new Set(targets)].slice(0, 6),
        attempts: survival.state.attempts } };
  },
  async crack_jump(d, bounded) {
    let error = null;
    try { await navigate(bot, bounded, new goals.GoalBlock(d.target[0], d.target[1] + 1, d.target[2]), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) { error = err.message; }
    const crack = bot.blockAt(vec(d.crack))?.name;
    const arrived = bot.entity.position.distanceTo(vec(d.target).offset(0.5, 1, 0.5)) <= 1.5;
    return { pass: arrived && crack === 'air' && watch.minY >= d.start[1] - 0.2, detail: { arrived, crack, minY: Math.round(watch.minY * 10) / 10, error } };
  },
  async crack_over_lava(d, bounded) {
    let error = null;
    try { await navigate(bot, bounded, new goals.GoalBlock(d.target[0], d.target[1] + 1, d.target[2]), { timeoutMs: 30000, stallMs: 8000 }); }
    catch (err) { error = err.message; }
    const crack = bot.blockAt(vec(d.crack))?.name;
    return { pass: !watch.died && watch.minY >= d.start[1] - 0.2, detail: { crack, minY: Math.round(watch.minY * 10) / 10, died: !!watch.died, error } };
  },
  async bridge_over_drop(d, bounded) {
    const placed = await bridgeTo(bot, bounded, vec(d.target), { maxBlocks: 20 });
    const gap = bot.entity.position.distanceTo(vec(d.target).offset(0.5, 1, 0.5));
    return { pass: gap <= 2.5 && watch.minY >= d.start[1] - 0.2, detail: { placed, gap: Math.round(gap * 10) / 10 } };
  },
  async bridge_under_fire(d, bounded) {
    let refused = null;
    try { await bridgeTo(bot, bounded, vec(d.target), { maxBlocks: 20 }); }
    catch (err) { refused = err.message; }
    return { pass: /Not bridging/.test(refused || '') && watch.minY >= d.start[1] - 0.2, detail: { refused } };
  },
  async portal_platform(d, bounded) {
    const arrived = () => !String(bot.game.dimension).includes('nether');
    try { await enterPortal(bot, bounded, vec(d.portal), arrived); } catch (err) { if (!arrived()) return { pass: false, detail: { error: err.message } }; }
    await waitFor(bounded, arrived, 10000).catch(() => {});
    return { pass: arrived(), detail: { dimension: bot.game.dimension } };
  },
  async ledge_fight(d, bounded) {
    // The survival layer, as on the live run: whatever it does about the
    // skeleton, it must not end at the bottom of the drop.
    const survival = createSurvival(bot, { state: {} });
    const goal = { kind: 'win', request: 'terrain drill' };
    const mobAlive = () => Object.values(bot.entities).some(e => e.name === d.mob && e.isValid !== false);
    let steps = 0;
    try { while (!watch.died && mobAlive()) { bounded.check(); await survival.step(bounded, goal, () => {}); steps++; await sleep(50); } }
    catch (err) { if (err.name !== 'OutOfTime') throw err; }
    return { pass: !mobAlive(), detail: { mobAlive: mobAlive(), health: Math.round(bot.health), steps, last: goal.survivalAction?.action } };
  },
  async ledge_shot(d, bounded) {
    // Shot at across a gap it cannot cross: passing is still being on the
    // ledge at the end, alive.
    const survival = createSurvival(bot, { state: {} });
    const goal = { kind: 'win', request: 'terrain drill' };
    const actions = [];
    try { while (!watch.died) { bounded.check(); await survival.step(bounded, goal, () => {}); const a = goal.survivalAction?.action; if (a && actions.at(-1) !== a) actions.push(a); await sleep(50); } }
    catch (err) { if (err.name !== 'OutOfTime') throw err; }
    return { pass: !watch.died && bot.entity.position.y >= d.start[1] - 1, detail: { health: Math.round(bot.health), y: Math.round(bot.entity.position.y), actions: actions.slice(0, 8) } };
  },
  async barter(d, bounded) {
    const { barterStep } = require('../src/bartering');
    const goal = { kind: 'win', request: 'terrain drill' };
    const ingots = () => countOf(bot, 'gold_ingot'), pearls = () => countOf(bot, 'ender_pearl');
    const piglinsAlive = () => Object.values(bot.entities).filter(e => e.name === 'piglin' && e.isValid !== false).length;
    let rounds = 0, error = null;
    const before = piglinsAlive();
    try { while (!watch.died && ingots() > 0 && rounds < 40) { bounded.check(); await barterStep(bot, bounded, goal, () => {}, { navigate, acquireStep: async () => {} }); rounds++; } }
    catch (err) { if (err.name !== 'OutOfTime') error = err.message; }
    const thrown = goal.barter?.thrown || 0;
    return { pass: thrown >= 36 && piglinsAlive() >= 3 && !error, detail: { thrown, pearls: pearls(), piglins: `${piglinsAlive()} of ${before}`, rounds, gold: bot.inventory.slots[8]?.name, error } };
  },
  async chest_lid(d, bounded) {
    const home = { origin: { x: d.home[0], y: d.home[1], z: d.home[2] }, dimension: 'overworld',
      stash: { position: { x: d.chest[0], y: d.chest[1], z: d.chest[2] }, contents: { cooked_beef: 8 } } };
    const goal = { kind: 'win', request: 'terrain drill', preparingNether: true, survival: { home } };
    let error = null;
    try { await restockFromStash(bot, bounded, goal, () => {}, home, { navigate, dig }, []); } catch (err) { error = err.message; }
    return { pass: countOf(bot, 'cooked_beef') >= 1, detail: { beef: countOf(bot, 'cooked_beef'), lid: bot.blockAt(vec(d.chest).offset(0, 1, 0))?.name, error } };
  },
};

async function runDrill(d, attempt) {
  // A captured place is hundreds of fills: sent forty lines at a time.
  if (d.bulk) { const lines = buildCommands(d); for (let i = 0; i < lines.length; i += 40) { fs.writeFileSync(consolePath, lines.slice(i, i + 40).join('\n') + '\n'); await sleep(300); } await sleep(1500); }
  else await commands(buildCommands(d));
  await commands(placeCommands(username, d));
  await commands([`gamemode spectator ${audience}`, `spectate ${username} ${audience}`]);
  const dimension = d.dimension === 'the_nether' ? 'nether' : 'overworld';
  await waitFor(task, () => String(bot.game.dimension).includes(dimension) && bot.entity.position.distanceTo(vec(d.start)) < 3, 30000);
  await bot.waitForChunksToLoad();
  await sleep(800);
  configureMovements(bot);
  watch = { died: false, minY: bot.entity.position.y, dimension };
  const deadline = Date.now() + d.seconds * 1000;
  const bounded = Object.create(task);
  bounded.check = () => { task.check(); if (watch.died) throw Object.assign(new Error('Died'), { name: 'Died' }); if (Date.now() > deadline) throw Object.assign(new Error('Out of time'), { name: 'OutOfTime' }); };
  const started = Date.now();
  let outcome;
  try { outcome = await RUNS[d.name](d, bounded); }
  catch (err) { outcome = { pass: false, detail: { error: `${err.name}: ${err.message}` } }; }
  bot.pathfinder.setGoal(null); bot.clearControlStates();
  // A fall is only a failure where an edge is what the drill is about: the
  // night mine goes down on purpose.
  const fell = !!d.edge && watch.minY < d.start[1] - 3;
  const result = { drill: d.name, attempt, pass: outcome.pass && !watch.died && !fell, died: watch.died, fell,
    seconds: Math.round((Date.now() - started) / 100) / 10, ...outcome.detail };
  log({ result });
  watch = null;
  if (result.died) await sleep(2500);
  return result;
}

bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad();
    await commands([`op ${username}`, 'gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'difficulty normal']);
    const rows = [];
    for (const d of selected) {
      log({ drill: d.name, why: d.why });
      const runs = [];
      for (let attempt = 1; attempt <= repeats; attempt++) runs.push(await runDrill(d, attempt));
      const passed = runs.filter(r => r.pass).length;
      rows.push({ drill: d.name, runs: runs.length, passed, deaths: runs.filter(r => r.died).length, falls: runs.filter(r => r.fell).length,
        verdict: passed === runs.length ? 'PASS' : 'FAIL', note: runs.find(r => !r.pass)?.error || '' });
    }
    await commands([`kill @e[tag=terrain]`, `clear ${username}`, 'time set 6000']);
    const widths = ['drill', 'runs', 'passed', 'deaths', 'falls', 'verdict'].map(k => Math.max(k.length, ...rows.map(r => String(r[k]).length)));
    const line = cells => `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`;
    const report = [line(['drill', 'runs', 'passed', 'deaths', 'falls', 'verdict']), line(widths.map(w => '-'.repeat(w))),
      ...rows.map(r => line([r.drill, r.runs, r.passed, r.deaths, r.falls, r.verdict]))].join('\n');
    fs.writeFileSync(path.join(directory, 'scoreboard.md'), report + '\n');
    console.log(`\n${report}\n`);
    bot.quit();
    setTimeout(() => process.exit(rows.every(r => r.verdict === 'PASS') ? 0 : 2), 500);
  } catch (err) {
    log({ terrain: 'FAIL', reason: err.message, stack: err.stack?.split('\n').slice(0, 4) });
    bot.quit(); setTimeout(() => process.exit(1), 500);
  }
});
bot.on('kicked', reason => log({ kicked: String(reason).slice(0, 200) }));
bot.on('error', err => log({ error: err.message }));
