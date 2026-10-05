'use strict';
// The blaze spawner, drilled: the whole bot (session.js, the ladder's rod
// stage, the survival layer, the arbiter, the flight record) put beside a
// live blaze spawner on a private server with the kit a trial brings, and
// scored on rods in the pack, deaths and minutes. Two layouts
// (scripts/lib/arena.js): `open`, the cage on a fortress platform in a
// cavern; `buried`, the cage in a sealed room in netherrack with blazes
// piled in it, as 25584's was (2026-10-04 19:55 to 22:15Z).
//
//   ARENA_DIR=$PWD/artifacts/spawner-server ARENA_PORT=25620 sh scripts/trials/arena-start.sh &
//   MC_PORT=25620 SPAWNER_DIR=artifacts/spawner-server node scripts/spawner-drill.js open 5
//   MC_PORT=25620 SPAWNER_DIR=artifacts/spawner-server node scripts/spawner-drill.js buried 5
//
// Each run is its own process and its own state directory
// (artifacts/spawner-drill-<id>/<layout>-<n>/): state/ as a trial's
// .bot-state, flight/ the flight record (scripts/death-timeline.js reads
// it), events.jsonl every question asked of Jev with its answer, asks.jsonl
// the questions whole. The bot is not an operator and is given nothing once
// the run begins; a second connection under its name is staged first (kit,
// place) and leaves before the bot joins. A run ends at SPAWNER_RODS rods
// in the pack (2), at a death, or at SPAWNER_MINUTES (10).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { laneOf, arenaDir, arenaBuild, median } = require('./lib/arena');

const LAYOUTS = { open: 'spawner_open', buried: 'spawner_buried' };
const port = Number(process.env.MC_PORT || 25620);
// Never a trial's server, the arena's or a rehearsal's.
if (!Number.isInteger(port) || port < 25620 || port > 65535) throw new Error('The spawner drill needs its own server: MC_PORT of 25620 or above');
const ROOT = path.join(__dirname, '..');
const serverDir = path.resolve(process.env.SPAWNER_DIR || path.join(ROOT, 'artifacts', 'spawner-server'));
const consolePath = path.join(serverDir, 'console.in');
const serverLog = path.join(serverDir, 'logs', 'arena-console.log');
const MINUTES = Number(process.env.SPAWNER_MINUTES || 10);
const RODS = Number(process.env.SPAWNER_RODS || 2);
const PORTAL_OFF = Number(process.env.SPAWNER_PORTAL || 120);
const LEFT_AT = 40;
const DIMENSION = 'minecraft:the_nether';
// Iron with golden boots, an iron sword, a shield, an iron pickaxe, 64
// blocks and 32 food points: what a trial brings to its first cage.
const KIT = {
  armor: { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'golden_boots' },
  offhand: 'shield',
  items: [['iron_sword', 1], ['iron_pickaxe', 1], ['cobblestone', 32], ['netherrack', 32], ['cooked_beef', Number(process.env.SPAWNER_FOOD || 10)]],
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = async line => { fs.writeFileSync(consolePath, line + '\n'); await sleep(120); };
const commands = async lines => { for (const line of lines) await command(line); };

function table(rows) {
  const header = ['layout', 'runs', 'rods', `runs with ${RODS}`, 'deaths', 'left', `median min to ${RODS}`, 'median min'];
  const body = rows.map(r => [r.layout, String(r.runs), String(r.rods), String(r.won), String(r.deaths), String(r.left), r.minutesToRods == null ? '-' : String(r.minutesToRods), String(r.minutes)]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
  const line = row => `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  return [line(header), `|${widths.map(w => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}
function summarise(layout, runs) {
  const won = runs.filter(r => r.rods >= RODS && !r.died);
  return { layout, runs: runs.length, rods: runs.reduce((n, r) => n + (r.rods || 0), 0), won: won.length, deaths: runs.filter(r => r.died).length, left: runs.filter(r => /^left/.test(r.ended)).length,
    minutesToRods: median(won.map(r => r.minutes)), minutes: median(runs.map(r => r.minutes)) };
}

// The parent: one child a run, so nothing a run left in the process (a
// module's memory of the last bot) is in the next.
function parent() {
  const [layout, count] = process.argv.slice(2);
  if (!LAYOUTS[layout]) throw new Error(`usage: spawner-drill.js <${Object.keys(LAYOUTS).join('|')}> [runs]`);
  const runs = Number(count || process.env.SPAWNER_RUNS || 5);
  const directory = path.resolve(process.env.SPAWNER_OUT || path.join(ROOT, 'artifacts', `spawner-drill-${Date.now().toString(36)}`));
  fs.mkdirSync(directory, { recursive: true });
  const results = [];
  // SPAWNER_FIRST: the number the runs begin at (a set taken up again after a stop, in the same directory).
  const first = Number(process.env.SPAWNER_FIRST || 1);
  for (let n = first; n < first + runs; n++) {
    const out = path.join(directory, `${layout}-${n}`);
    spawnSync(process.execPath, [__filename, '--one', layout, String(n), out], { stdio: 'inherit', env: process.env });
    try { results.push(JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))); }
    catch (_) { results.push({ layout, run: n, failed: 'no result written', rods: 0, died: false, minutes: 0 }); }
    fs.writeFileSync(path.join(directory, `${layout}-results-${first}.json`), JSON.stringify({ at: new Date().toISOString(), summary: summarise(layout, results.filter(r => !r.failed)), results }, null, 2));
  }
  const report = table([summarise(layout, results.filter(r => !r.failed))]);
  fs.writeFileSync(path.join(directory, `${layout}-scoreboard.md`), `${report}\n`);
  console.log(`\n${report}\n${directory}\n`);
}

async function one() {
  const [, layout, n, out] = process.argv.slice(2);
  // SPAWNER_LANE: the same layout a lane over (160 blocks north) under another name, a second set of runs beside the first.
  const lane = Number(process.env.SPAWNER_LANE || 0);
  const arena = laneOf(LAYOUTS[layout], lane);
  const username = process.env.SPAWNER_USER || `${layout === 'open' ? 'JevOpen' : 'JevBuried'}${lane || ''}`;
  fs.mkdirSync(out, { recursive: true });
  const log = entry => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); console.log(line.slice(0, 600)); fs.appendFileSync(path.join(out, 'events.jsonl'), line + '\n'); };
  // The Jev key from the main checkout's .env (a worktree has none).
  require('../src/env').loadEnv(process.env.JEV_ENV_FILE || path.join(path.dirname(arenaDir()), '.env'));
  require('../src/env').loadEnv();
  process.env.JEV_NO_QUIET_RESTART = '1';
  const mineflayer = require('mineflayer');
  const { TypeSafe } = require('../src/typesafe');
  const client = new TypeSafe();
  if (client.provider !== 'typesafe') throw new Error('The drill asks Jev through TypeSafe only (no OpenRouter spend)');

  // Staged by a second connection under the bot's name: the room rebuilt,
  // the kit on, the bot on its mark, full health and hunger. It leaves
  // before the bot joins, so the session finds itself there as a trial's
  // bot finds itself after a restart.
  const [x1, y1, z1, x2, y2, z2] = arena.shell;
  const inShell = `x=${x1 - 5},y=${y1 - 5},z=${z1 - 5},dx=${x2 - x1 + 10},dy=${y2 - y1 + 30},dz=${z2 - z1 + 10}`;
  await commands(['difficulty normal', 'gamerule minecraft:spawn_mobs false', 'gamerule minecraft:advance_time false', 'gamerule minecraft:advance_weather false',
    'gamerule minecraft:mob_griefing true', 'gamerule minecraft:keep_inventory false', 'gamerule minecraft:immediate_respawn false',
    ...arenaBuild(arena), `execute in ${DIMENSION} run kill @e[type=!minecraft:player,${inShell}]`]);
  await new Promise((resolve, reject) => {
    const stager = mineflayer.createBot({ host: '127.0.0.1', port, username, version: '26.1', auth: 'offline' });
    const timer = setTimeout(() => { stager.quit(); reject(new Error('The staging connection did not land on the mark')); }, 60000);
    stager.on('error', reject);
    stager.once('spawn', async () => {
      try {
        await sleep(1500);
        const lines = [`gamemode survival ${username}`, `clear ${username}`, `effect clear ${username}`, `xp set ${username} 0 levels`,
          `execute in ${DIMENSION} run tp ${username} ${arena.open.join(' ')} -90 0`];
        for (const [slot, item] of Object.entries(KIT.armor)) lines.push(`item replace entity ${username} armor.${slot} with minecraft:${item}`);
        lines.push(`item replace entity ${username} weapon.offhand with minecraft:${KIT.offhand}`);
        for (const [item, count] of KIT.items) lines.push(`give ${username} minecraft:${item} ${count}`);
        lines.push(`effect give ${username} minecraft:instant_health 1 20 true`, `effect give ${username} minecraft:saturation 1 20 true`);
        await commands(lines);
        for (let i = 0; i < 100; i++) {
          await sleep(200);
          const p = stager.entity?.position;
          if (p && String(stager.game.dimension).includes('nether') && Math.hypot(p.x - arena.open[0], p.z - arena.open[2]) < 2 && stager.inventory.slots?.[45]?.name === 'shield' &&
              stager.inventory.items().some(i => i.name === 'cooked_beef') && stager.health >= 20 && stager.food >= 20) break;
        }
        await commands([`effect clear ${username}`, `execute in ${DIMENSION} run kill @e[type=!minecraft:player,${inShell}]`,
          // The blazes piled in the room already, where the layout has them.
          // Kept: with no player on the server for the moment between the
          // staging and the bot, three of the four were gone when it came.
          ...(arena.piled || []).map(at => `execute in ${DIMENSION} run summon minecraft:blaze ${at.join(' ')} {PersistenceRequired:1b}`)]);
        await sleep(500);
        clearTimeout(timer); stager.quit(); setTimeout(resolve, 1500);
      } catch (err) { reject(err); }
    });
  });

  // The saved goal a trial's bot would carry here: the game to beat, the
  // Nether entered, nothing of the eyes in hand, so the ladder's stage is
  // the rods.
  const stateDirectory = path.join(out, 'state');
  fs.mkdirSync(stateDirectory, { recursive: true });
  const identity = `127.0.0.1-${port}-${username}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = Date.now();
  fs.writeFileSync(path.join(stateDirectory, `${identity}.json`), JSON.stringify({ kind: 'win', request: 'beat the game', from: 'TestPlayer', version: 1, status: 'running',
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), suspendedTasks: [], initialInventory: [], expeditionReady: true,
    // The portal it came by, remembered SPAWNER_PORTAL blocks west (120): a trip out for food or to bank a rod is that walk, as a trial's is, not a step.
    portals: [{ x: Math.floor(arena.open[0]) - PORTAL_OFF, y: arena.open[1], z: Math.floor(arena.open[2]), dimension: 'nether' }],
    gameProgress: { version: 1, startedAt: now, milestones: { nether_entered: { at: now, dimension: 'nether', position: { x: arena.open[0], y: arena.open[1], z: arena.open[2] } } } } }, null, 2));

  // Every question asked of Jev and its answer, in order.
  const real = client.systemOne.bind(client);
  let asks = 0;
  client.systemOne = async request => {
    const askedAt = Date.now();
    let response, failed;
    try { response = await real(request); } catch (err) { failed = err; }
    try {
      for (const [key, q] of Object.entries(request.questions || {})) {
        const a = response?.answers?.[key];
        const options = Object.keys(q.criteria || {});
        const said = a?.choice && q.criteria?.[a.choice];
        log({ ask: ++asks, q: key, kind: request.kind, options, choice: a?.choice ?? (a?.probability != null ? `p=${a.probability}` : failed ? `error: ${failed.message.slice(0, 80)}` : null), confidence: a?.confidence,
          ms: Date.now() - askedAt, health: Math.round((session?.bot.health ?? 0) * 10) / 10, at_: where(), said: typeof said === 'string' ? said.slice(0, 500) : said?.description ? String(said.description).slice(0, 500) : undefined });
        fs.appendFileSync(path.join(out, 'asks.jsonl'), JSON.stringify({ at: new Date().toISOString(), ask: asks, q: key, state: request.state, question: q, answer: a || null }) + '\n');
      }
    } catch (_) { /* the log is not the run */ }
    if (failed) throw failed;
    return response;
  };

  const label = `127.0.0.1-${port}-${username}`;
  const recorder = require('../src/recorder').startRecorder({ directory: path.join(out, 'flight'), label });
  const { createSession } = require('../src/session');
  // The session's own lines (every step) go to the run's log, not the screen.
  const sessionLog = fs.createWriteStream(path.join(out, 'session.log'));
  const print = console.log, printError = console.error;
  console.log = (...args) => { sessionLog.write(args.map(a => typeof a === 'string' ? a : require('util').inspect(a)).join(' ') + '\n'); };
  console.error = console.log;
  const say = entry => { const keep = console.log; console.log = print; try { log(entry); } finally { console.log = keep; } };
  let session = null;
  const where = () => { const p = session?.bot?.entity?.position; return p ? `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}` : null; };
  const started = Date.now();
  session = createSession({ host: '127.0.0.1', port, username, auth: 'offline', version: '26.1' }, client, { stateDirectory, recorder, runLedger: null });
  const bot = session.bot;
  const count = name => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
  const run = { died: false, kills: 0, strikes: 0, minHealth: 20, struck: new Map(), swings: new Map(), killed: new Set(), ended: null };
  bot.on('death', () => { run.died = true; });
  bot.on('health', () => { if (Number.isFinite(bot.health)) run.minHealth = Math.min(run.minHealth, bot.health); });
  bot.once('spawn', () => {
    const attack = bot.attack.bind(bot);
    bot.attack = (target, ...rest) => { run.strikes++; if (target?.id !== undefined) { run.struck.set(target.id, Date.now()); if (target.name === 'blaze') run.swings.set(target.id, (run.swings.get(target.id) || 0) + 1); } return attack(target, ...rest); };
  });
  bot.on('entityDead', entity => { if (entity?.name === 'blaze' && Date.now() - (run.struck.get(entity.id) || 0) < 6000) { run.kills++; run.killed.add(entity.id); } });
  // Every rod that dropped and what became of it: picked up, or gone from
  // the floor unpicked (fire burns a rod lying in it), or still lying.
  const dropped = new Map();
  bot.on('itemDrop', entity => {
    try {
      if (entity?.getDroppedItem?.()?.name !== 'blaze_rod' || dropped.has(entity.id)) return;
      const p = entity.position, me = bot.entity.position;
      dropped.set(entity.id, { at: Date.now(), fate: 'lying' });
      say({ rodDropped: entity.id, at_: `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`, off: Math.round(p.distanceTo(me) * 10) / 10, health: Math.round(bot.health * 10) / 10 });
    } catch (_) { /* a look missed */ }
  });
  bot.on('playerCollect', (collector, collected) => { const d = dropped.get(collected?.id); if (d && collector === bot.entity) d.fate = 'picked'; });
  bot.on('entityGone', entity => {
    const d = dropped.get(entity?.id);
    if (!d || d.fate !== 'lying') return;
    // The collect comes just before the entity goes: a tick's grace.
    setTimeout(() => { if (d.fate === 'lying') { d.fate = 'gone'; say({ rodGone: entity.id, lay: Math.round((Date.now() - d.at) / 100) / 10, block: bot.blockAt?.(entity.position)?.name }); } }, 300);
  });
  session.closed.then(event => { run.ended ||= run.died ? 'died' : `connection closed: ${event?.reason}`; });
  const cage = arena.cage;
  let beat = 0, lastStep = '', rodsAt = [];
  while (!run.ended) {
    await sleep(500);
    if (!bot.entity) continue;
    const rods = count('blaze_rod');
    while (rodsAt.length < rods) { rodsAt.push(Math.round((Date.now() - started) / 100) / 10); say({ rod: rodsAt.length, seconds: rodsAt.at(-1) }); }
    if (rods >= RODS) { run.ended = 'rods'; break; }
    if (Date.now() - started > MINUTES * 60000) { run.ended = 'time'; break; }
    // Gone from the cage (for food, for a kit, to bank the rods): alive, with what it carries.
    { const p = bot.entity.position; if (Math.hypot(p.x - cage[0], p.y - cage[1], p.z - cage[2]) > LEFT_AT) { run.ended = 'left the cage'; break; } }
    if (Date.now() - started > 5000 && !String(bot.game?.dimension || '').includes('nether')) { run.ended = 'left the Nether'; break; }
    const goal = bot._goal || {};
    const step = JSON.stringify([goal.step?.action, goal.survivalAction?.action, goal.step?.phase]);
    if (step !== lastStep) { lastStep = step; say({ step: goal.step?.action, phase: goal.step?.phase, survival: goal.survivalAction?.action, health: Math.round(bot.health * 10) / 10, food: bot.food, at_: where() }); }
    if (Date.now() - beat > 10000) {
      beat = Date.now();
      const blazes = Object.values(bot.entities).filter(e => e.name === 'blaze' && e.isValid !== false && e.position);
      const p = bot.entity.position;
      say({ beat: Math.round((Date.now() - started) / 1000), health: Math.round(bot.health * 10) / 10, food: bot.food, at_: where(), cage: Math.round(Math.hypot(p.x - cage[0] - 0.5, p.y - cage[1], p.z - cage[2] - 0.5) * 10) / 10,
        blazes: blazes.map(e => Math.round(e.position.distanceTo(p) * 10) / 10).sort((a, b) => a - b), rods, strikes: run.strikes, kills: run.kills, step: goal.step?.action, survival: goal.survivalAction?.action });
    }
  }
  const rods = bot.entity ? count('blaze_rod') : rodsAt.length;
  // Rods lying where the fight was: killed for and not picked up.
  const lying = Object.values(bot.entities || {}).filter(e => e.name === 'item' && e.getDroppedItem?.()?.name === 'blaze_rod').length;
  let cause = null;
  if (run.died) {
    await sleep(500);
    try { cause = fs.readFileSync(serverLog, 'utf8').split('\n').filter(l => l.includes(`]: ${username} `) && !/joined|left the game|lost connection/.test(l)).at(-1)?.replace(/^.*\]: /, '') || null; } catch (_) { /* no log */ }
  }
  const result = { layout, run: Number(n), ended: run.ended, rods: Math.max(rods, rodsAt.length), rodsAt, rodsLying: lying, died: run.died, cause, minutes: Math.round((Date.now() - started) / 6000) / 10,
    kills: run.kills,
    // The swings each blaze took: those on the blazes killed, and those on blazes struck and left alive (a blaze dies of four).
    swingsOnKilled: [...run.swings].filter(([id]) => run.killed.has(id)).map(([, n]) => n), swingsOnLeft: [...run.swings].filter(([id]) => !run.killed.has(id)).map(([, n]) => n).sort((a, b) => b - a),
    rodsDropped: dropped.size, rodsGone: [...dropped.values()].filter(d => d.fate === 'gone').length, strikes: run.strikes, minHealth: Math.round(run.minHealth * 10) / 10, asks, out };
  say({ result });
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  try { session.shutdown(); } catch (_) { /* gone already */ }
  await recorder.close();
  await sleep(1500);
  console.log = print; console.error = printError;
  process.exit(0);
}

(process.argv[2] === '--one' ? one() : Promise.resolve().then(parent)).catch(err => { console.error(err); process.exit(1); });
