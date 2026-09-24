'use strict';
// Combat practice. The dream run lost seven lives in one fortress and every
// lesson cost a ten-minute restock; here a lesson costs a minute. Each drill
// stages one encounter that actually killed the bot, runs the real survival
// and mob-hunt code against it, and scores what it cost. Repeat, change a
// rule, compare the column.
//
//   sh .test-combat/start.sh &                     # the arena server
//   MC_PORT=25574 node scripts/arena.js            # every drill, three runs
//   MC_PORT=25574 node scripts/arena.js blaze_swarm_wall
//   ARENA_REPEATS=5 ARENA_JEV=1 node scripts/arena.js wither_skeleton_pair
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { compatibilityPlugin } = require('../src/compatibility');
const { configureMovements } = require('../src/movement');
const { Task, navigate, countOf } = require('../src/skills');
const { createSurvival, dig, waitFor, Blocked } = require('../src/work');
const { tunnelStep, resourceTunnelStep } = require('../src/tunneling');
const { prepareMobHunt, huntObserved } = require('../src/mob-hunt');
const { DRILLS, drill, sessionSetup, arenaBuild, standingCell, sweep, resetCommands, spawnCommands, summarise, table } = require('./lib/arena');

const port = Number(process.env.MC_PORT || 25574);
// The player's worlds and the dream run must never see an arena command.
if (!Number.isInteger(port) || port < 1 || port > 65535 || [25565, 25570, 25577, 25579].includes(port)) {
  throw new Error('The arena needs an isolated MC_PORT; 25565, 25570, 25577 and 25579 are in use elsewhere');
}
const consolePath = process.env.ARENA_CONSOLE || path.join(__dirname, '..', '.test-combat', 'console.in');
const repeats = Number(process.env.ARENA_REPEATS || 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('ARENA_REPEATS must be 1 to 20');
const names = process.argv.slice(2);
const selected = names.length ? names.map(name => {
  const found = drill(name);
  if (!found) throw new Error(`Unknown drill ${name}; known: ${DRILLS.map(d => d.name).join(', ')}`);
  return found;
}) : DRILLS;

const id = Date.now().toString(36);
// A stable name so a watching player's `/spectate` survives every restart.
const username = process.env.ARENA_USER || 'ArenaJev';
// A player to put in Spectator on the bot, if one is named in the environment.
require('../src/env').loadEnv();
const audience = process.env.ARENA_WATCHER || '';
const directory = path.join(__dirname, '..', 'artifacts', `arena-${id}`);
fs.mkdirSync(directory, { recursive: true });
const log = entry => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  console.log(line); fs.appendFileSync(path.join(directory, 'events.jsonl'), line + '\n');
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One command a line down the server's console pipe. The pipe has a reader
// (start.sh holds it open with tail), so a write never blocks for long.
async function command(line) {
  fs.writeFileSync(consolePath, line + '\n');
  await sleep(120);
}
async function commands(list) { for (const line of list) await command(line); }

const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
bot.loadPlugin(compatibilityPlugin);
bot.loadPlugin(pathfinder);
let currentGoal = { request: 'arena', status: 'starting' };

// Everything a run is scored on, gathered by listener rather than by asking
// the bot afterwards: health has been restored by then and the mobs are gone.
let run = null;
const startRun = () => { run = { deaths: 0, damageTaken: 0, minHealth: 20, kills: 0, strikes: 0, shieldRaises: 0, actions: new Set(), errors: [], struck: new Map() }; };
let previousHealth = 20;
bot.on('health', () => {
  if (!run) { previousHealth = bot.health; return; }
  if (bot.health < previousHealth) run.damageTaken += previousHealth - bot.health;
  run.minHealth = Math.min(run.minHealth, bot.health);
  previousHealth = bot.health;
});
bot.on('death', () => { if (run) { run.deaths++; run.died = true; } previousHealth = 20; });
bot.on('entityDead', entity => {
  if (!run || entity?.name !== run.entity) return;
  if (Date.now() - (run.struck.get(entity.id) || 0) < 6000) run.kills++; else run.diedOnTheirOwn = (run.diedOnTheirOwn || 0) + 1;
});
bot.on('error', err => { if (run) run.errors.push(err.message); log({ error: err.message }); });
bot.on('kicked', reason => log({ kicked: String(reason) }));
bot.on('end', reason => { if (!finished) { log({ arena: 'FAIL', reason: `connection ended: ${reason}` }); process.exit(1); } });

const alive = name => Object.values(bot.entities).filter(e => (Array.isArray(name) ? name.includes(e.name) : e.name === name) && e.isValid !== false &&
  e.position?.distanceTo(bot.entity.position) < 64);

// What actually killed the bot, in the server's own words. "Slain by
// zombified piglin" is the difference between a combat finding and a
// contaminated arena, and the bot itself cannot tell them apart.
const serverLog = process.env.ARENA_SERVER_LOG || path.join(__dirname, '..', '.test-combat', 'logs', 'arena-console.log');
function deathCause() {
  try {
    const lines = fs.readFileSync(serverLog, 'utf8').split('\n').filter(l => l.includes(`]: ${username} `));
    return lines.length ? lines.at(-1).replace(/^.*\]: /, '') : null;
  } catch (_) { return null; }
}

// The hunt's actions, with the ones that would leave the arena stubbed. The
// kit is complete, so nothing should reach for a missing tool; a sweep that
// tried to tunnel out of the shell is refused rather than allowed to dig.
const huntActions = {
  navigate,
  acquireStep: async (b, t, item) => { throw new Blocked(`The arena kit is missing ${item}`); },
  explore: async () => { await sleep(200); },
  enterNether: async () => { await sleep(200); },
  returnOverworld: async () => { await sleep(200); },
  tunnel: (b, t, g, save, target, resource) => ['fortress', 'approach'].includes(resource)
    ? tunnelStep(b, t, g, save, target, { dig, navigate, approach: resource === 'approach', strict: resource === 'approach' })
    : resourceTunnelStep(b, t, g, save, target, resource, { dig, navigate }),
};

// The arena as the bot sees it: air to stand in, air for its head, and
// something solid underfoot. Checked from inside rather than trusted,
// because a `fill` that failed leaves no trace in the game.
async function verifyArena(d) {
  const { Vec3 } = require('vec3');
  const cell = standingCell(d);
  const at = (dx, dy, dz) => bot.blockAt(new Vec3(cell.x + dx, cell.y + dy, cell.z + dz));
  const clear = block => block && ['air', 'cave_air', 'void_air'].includes(block.name);
  const feet = at(0, 0, 0), head = at(0, 1, 0), floor = at(0, -1, 0);
  const ok = clear(feet) && clear(head) && floor?.boundingBox === 'block';
  return { ok, feet: feet?.name, head: head?.name, floor: floor?.name, cell };
}

async function runDrill(d, attempt) {
  startRun();
  run.entity = d.entity;
  await commands(resetCommands(username, d));
  // Put the watcher back on the bot's shoulder: the reset crossed dimensions
  // and a spectator left behind sees an empty room. Harmless when nobody is
  // watching; the server just reports no such player.
  if (audience) await commands([`gamemode spectator ${audience}`, `execute in minecraft:the_nether run tp ${audience} ${d.at[0].join(' ')}`, `spectate ${username} ${audience}`]);
  // The teleport crosses dimensions, so wait for the bot to land on its mark
  // with the kit on before anything is summoned.
  await waitFor(task, () => String(bot.game.dimension).includes('nether') &&
    bot.entity.position.distanceTo({ x: d.at[0][0], y: bot.entity.position.y, z: d.at[0][2] }) < 48 &&
    bot.inventory.slots?.[45]?.name === 'shield' && countOf(bot, 'diamond_sword') >= 1, 30000);
  await bot.waitForChunksToLoad();
  // Rebuild once if the room is not there; a second failure is the harness's
  // fault and must not be scored as the bot's.
  let arena = await verifyArena(d);
  if (!arena.ok) {
    log({ drill: d.name, attempt, rebuilding: arena });
    await commands(arenaBuild(d.arena));
    await commands(resetCommands(username, d));
    await sleep(1500);
    arena = await verifyArena(d);
    if (!arena.ok) throw new Error(`The ${d.arena} arena is not built at ${JSON.stringify(arena.cell)}: feet ${arena.feet}, head ${arena.head}, floor ${arena.floor}`);
  }
  previousHealth = bot.health;
  run.minHealth = bot.health;
  run.damageTaken = 0;
  configureMovements(bot);

  const goal = { request: `Arena drill ${d.name}`, kind: d.mode === 'hunt' ? 'resource' : 'survive', status: 'running' };
  currentGoal = goal;
  const save = () => fs.writeFileSync(path.join(directory, `${d.name}-${attempt}-goal.json`), JSON.stringify(goal, null, 2));
  const survival = createSurvival(bot, { state: goal.survival, client });
  const step = { action: 'hunt_mob', entity: d.entity, item: d.item, count: d.count };
  if (d.mode === 'hunt') goal.step = step;

  await commands(spawnCommands(d));
  await waitFor(task, () => alive(d.entity).length >= d.count, 20000);
  const spawned = alive(d.entity).length;
  const started = Date.now(), deadline = started + d.seconds * 1000;
  const before = d.item ? countOf(bot, d.item) : 0;
  const drops = () => (d.item ? countOf(bot, d.item) - before : 0);
  // A hunt is won by the drop in the pockets. Ending the drill the moment
  // the mob died left every blaze rod lying on the floor and scored the
  // fight as nothing gained; the pickup is part of the work.
  let clearedAt = null;
  const won = () => d.mode === 'hunt'
    ? drops() >= (d.expect?.drops ?? 1) || (clearedAt && Date.now() - clearedAt > 12000)
    : !alive(d.entity).length;
  let lastAction;

  let beat = 0;
  while (Date.now() < deadline && !run.died && !won()) {
    task.check();
    // Every five seconds, where everyone is. A drill where nothing happens
    // is either a mob that never came or a bot that never answered, and the
    // distances say which.
    if (!alive(d.entity).length) clearedAt ||= Date.now();
    // A mob summoned outside its aggro range sometimes never came, and a
    // drill where nothing happens measures nothing. Eight seconds of that
    // and the encounter is brought to the bot.
    if (Date.now() - (run.nudgedAt || started) > 8000 && alive(d.entity).length &&
        !alive(d.entity).some(e => e.position.distanceTo(bot.entity.position) < 6)) {
      run.nudged = true; run.nudgedAt = Date.now();
      const p = bot.entity.position;
      await command(`execute in minecraft:the_nether run tp @e[tag=arena,limit=${d.count}] ${(p.x + 3).toFixed(1)} ${p.y} ${p.z.toFixed(1)}`);
      log({ drill: d.name, attempt, nudged: 'targets brought to three blocks; they would not approach' });
    }
    if (Date.now() - beat > 5000) {
      beat = Date.now();
      const near = alive(d.entity).map(e => Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10).sort((a, b) => a - b);
      log({ drill: d.name, attempt, beat: Math.round((Date.now() - started) / 1000), health: bot.health,
        at: bot.entity.position.floored(), targets: near, action: goal.survivalAction?.action || goal.step?.action || null });
    }
    try {
      if (d.mode === 'hunt') {
        goal.mobHunt ||= { item: d.item, entity: d.entity, targetCount: before + d.count };
        if (await huntObserved(bot, task, goal, save, huntActions, client)) continue;
        if (await survival.step(task, goal, save)) continue;
        goal.step = step;
        await prepareMobHunt(bot, task, step, goal, save, huntActions);
      } else if (!await survival.step(task, goal, save)) await sleep(100);
    } catch (err) {
      task.check();
      run.errors.push(err.message);
      if (!['NeedsAir', 'NeedsSafety', 'Cancelled', 'Blocked'].includes(err.name)) log({ drill: d.name, attempt, stepError: err.message });
      await sleep(150);
    }
    const action = goal.survivalAction?.action || goal.step?.action;
    if (action) run.actions.add(action);
    if (action && action !== lastAction) { lastAction = action; log({ drill: d.name, attempt, action, health: bot.health, alive: alive(d.entity).length }); }
  }

  // Killed, not merely absent. A hunt drill stops the moment the drop is in
  // the pockets, and the corpse can still be in the entity list for a tick:
  // five runs that each killed their blaze scored "cleared 1/5".
  const cleared = (run.kills >= spawned || !alive(d.entity).length) && !run.died;
  const killer = run.deaths ? deathCause() : null;
  const result = { drill: d.name, attempt, spawned, cleared, clearedMs: cleared ? Date.now() - started : null, killer, nudged: !!run.nudged,
    deaths: run.deaths, damageTaken: Math.round(run.damageTaken * 10) / 10, minHealth: Math.round(run.minHealth * 10) / 10,
    kills: run.kills, drops: d.item ? countOf(bot, d.item) - before : 0, strikes: run.strikes,
    bunkerError: goal.mobHunt?.lastBunkerError || null, diedOnTheirOwn: run.diedOnTheirOwn || 0,
    shieldRaises: run.shieldRaises, actions: [...run.actions], errors: [...new Set(run.errors)].slice(0, 6) };
  run = null;
  log({ result });
  bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.stopDigging?.();
  return result;
}

let finished = false;
let client = null;
const task = new Task('arena', 'combat practice');
const timer = setTimeout(() => task.cancel(), Number(process.env.ARENA_TIMEOUT_MS || 40 * 60000));

bot.once('spawn', async () => {
  try {
    await bot.waitForChunksToLoad();
    configureMovements(bot);
    require('../src/speech').quietRepeats?.(bot);
    if (process.env.ARENA_JEV === '1') {
      require('../src/env').loadEnv();
      client = new (require('../src/typesafe').TypeSafe)();
      log({ jev: 'System One decides which target to take' });
      if (process.env.JEV_ENCOUNTERS === '1') log({ jev: 'System One also picks the stance for each encounter (encounter_stance)' });
    }
    // Count the swings and the shield from the inside: the arena scores what
    // the fighting code did, not what it meant to do.
    const attack = bot.attack.bind(bot);
    // A kill counts only if the bot struck that mob in the last few seconds.
    // Four blazes once died against a chamber wall with no swing thrown and
    // the drill called it a clean sweep, which sent a whole fix down a blind
    // alley looking for rods that had never dropped.
    bot.attack = (target, ...rest) => { if (run) { run.strikes++; if (target?.id !== undefined) run.struck.set(target.id, Date.now()); } return attack(target, ...rest); };
    const activate = bot.activateItem.bind(bot);
    bot.activateItem = (offHand, ...rest) => { if (run && offHand) run.shieldRaises++; return activate(offHand, ...rest); };

    await commands([`op ${username}`, ...(audience ? [`op ${audience}`] : [])]);
    await commands(sessionSetup());
    for (const arena of ['holding', ...new Set(selected.map(d => d.arena))]) { await commands(arenaBuild(arena)); await sleep(1200); }
    log({ phase: 'arena ready', drills: selected.map(d => d.name), repeats, directory, server: `127.0.0.1:${port}` });

    const rows = [];
    for (const d of selected) {
      const runs = [];
      log({ drill: d.name, why: d.why, mode: d.mode, entity: d.entity, count: d.count, seconds: d.seconds });
      for (let attempt = 1; attempt <= repeats; attempt++) runs.push(await runDrill(d, attempt));
      const row = summarise(d, runs);
      rows.push(row);
      fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ at: new Date().toISOString(), repeats, rows, runs: rows.length }, null, 2));
      log({ summary: row });
    }
    await commands([`kill @e[tag=arena]`, `clear ${username}`]);
    const report = table(rows);
    fs.writeFileSync(path.join(directory, 'scoreboard.md'), `${report}\n`);
    finished = true;
    log({ arena: rows.every(r => r.verdict === 'PASS') ? 'PASS' : 'FAIL', failed: rows.filter(r => r.verdict === 'FAIL').map(r => r.drill), directory });
    console.log(`\n${report}\n`);
    clearTimeout(timer);
    bot.quit();
    setTimeout(() => process.exit(rows.every(r => r.verdict === 'PASS') ? 0 : 2), 500);
  } catch (err) {
    finished = true;
    log({ arena: 'FAIL', reason: err.message, stack: err.stack?.split('\n').slice(0, 4) });
    clearTimeout(timer);
    bot.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
