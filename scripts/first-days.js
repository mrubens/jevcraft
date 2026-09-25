'use strict';
// The first three in-game days on a fresh Normal world, judged. The user's
// goal (2026-09-24): no deaths, no step retried in a loop, never standing
// still or pacing for more than a minute outside a shelter or bed, and iron
// tools, iron armour, a shield, a bed and a home by the end; two fresh worlds
// in a row.
//
//   node scripts/first-days.js start first-days-1   # fresh world + fresh Jev on the clean server
//   node scripts/first-days.js verdict               # the current trial, now or at its end
//   node scripts/first-days.js status                # the trial log
//
// The clean server is .clean-run on 25581; the bot is the one whose pid is
// in .bot-state/pids/127.0.0.1-25581-Jev.pid. More trial servers run side by
// side, each a copy in .clean-run-<port>, chosen with FIRST_DAYS_PORT:
//   FIRST_DAYS_PORT=25582 node scripts/first-days.js start first-days-40
// A trial is sixty minutes of wall clock from the bot's first join:
// three days of twenty minutes. Nothing in the game is touched but the
// world's name; Jev is not an operator.
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { analyse } = require('./lib/audit');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.FIRST_DAYS_PORT || 25581);
const SERVER = path.join(ROOT, PORT === 25581 ? '.clean-run' : `.clean-run-${PORT}`);
const STATE = path.join(ROOT, '.bot-state');
const IDENTITY = `127_0_0_1-${PORT}-Jev`;
const LOG = path.join(ROOT, 'artifacts', 'first-days-trials.json');
const DAYS_MS = 60 * 60000;
const trials = () => { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (_) { return []; } };
const saveTrials = t => { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(t, null, 2)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pid = port => { try { return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`).toString().trim().split('\n')[0] || null; } catch (_) { return null; } };
const alive = p => { try { process.kill(Number(p), 0); return true; } catch (_) { return false; } };

// Ladder phases at or past the goal's milestones: the ladder moves past the
// home rung only once the home is complete, and past the armour only once
// all four pieces are worn.
const PAST_ARMOUR = /^(golden_boots|bow|arrows|diamond_sword|reach_nether|enter_nether|obtain_|find_|craft_eyes|enter_end|defeat_dragon|return_|complete)/;

function milestones(snapshot, state) {
  const inv = snapshot?.inventory || {}, eq = snapshot?.equipment || {};
  const has = re => Object.keys(inv).some(n => re.test(n)) || Object.values(eq).some(n => n && re.test(n));
  const home = state?.survival?.home;
  // Worn, not carried: the armour counts once it is on.
  const worn = ['head', 'torso', 'legs', 'feet'].every(slot => /^(iron|diamond|netherite)_/.test(eq[slot] || ''));
  return {
    iron_pickaxe: has(/^(iron|diamond|netherite)_pickaxe$/),
    iron_sword: has(/^(iron|diamond|netherite)_sword$/),
    iron_armour: worn,
    shield: has(/^shield$/),
    bed: !!home?.bed?.claimedAt || has(/_bed$/),
    home: !!(home?.completedAt || (home?.bed?.claimedAt && home?.stash?.position)),
    phase: state?.gameProgress?.phase || null,
    pastArmour: PAST_ARMOUR.test(state?.gameProgress?.phase || ''),
  };
}

// Each milestone counts once it has been reached at any time in the trial,
// not only if it is still held at the end (the user, 2026-09-25): trial 79
// had everything by minute 34 and wore its iron pickaxe out at minute 50.
// Frame by frame, the pockets and what is worn each from the latest frame
// that has them (heartbeats carry the pockets and not the equipment).
// With it, when each was first reached (m.at, milliseconds): the bed and
// the home from the saved home's own times where the frames do not say.
const MILESTONES = ['iron_pickaxe', 'iron_sword', 'iron_armour', 'shield', 'bed', 'home'];
function reached(frames, state) {
  let inventory = null, equipment = null;
  const m = milestones({}, state), at = {};
  const home = state?.survival?.home, time = iso => (iso ? Date.parse(iso) : NaN);
  if (m.bed && Number.isFinite(time(home?.bed?.claimedAt))) at.bed = time(home.bed.claimedAt);
  if (m.home) {
    const t = Number.isFinite(time(home?.completedAt)) ? time(home.completedAt) : Math.max(time(home?.bed?.claimedAt), time(home?.stash?.placedAt));
    if (Number.isFinite(t)) at.home = t;
  }
  for (const f of frames) {
    if (f.snapshot?.inventory && typeof f.snapshot.inventory === 'object') inventory = f.snapshot.inventory;
    if (f.snapshot?.equipment && typeof f.snapshot.equipment === 'object') equipment = f.snapshot.equipment;
    if (!inventory && !equipment) continue;
    // The frames say what was carried and worn; the bed claimed and the
    // home come from the saved home above, not from every frame.
    const now = milestones({ inventory: inventory || {}, equipment: equipment || {} }, {});
    for (const k of MILESTONES) if (now[k] && !(at[k] <= f.t)) { m[k] = true; if (Number.isFinite(f.t)) at[k] = Math.min(at[k] ?? Infinity, f.t); }
  }
  m.at = at;
  return m;
}
// The items are wanted by this minute; the day's other rules hold for the
// whole sixty. Standing still and pacing cost time and so count against it,
// and are reported, not failed on their own (the user, 2026-09-25).
const TARGET_MS = Number(process.env.FIRST_DAYS_TARGET_MIN || 45) * 60000;

function verdict(trial, { now = Date.now() } = {}) {
  const from = Date.parse(trial.startedAt), to = Math.min(now, from + DAYS_MS);
  const a = analyse({ identity: IDENTITY, from, to });
  if (!a) return { pass: false, reasons: ['no flight frames in the trial window'] };
  const state = JSON.parse(fs.readFileSync(path.join(STATE, `${IDENTITY}.json`), 'utf8'));
  const survival = (() => { try { return JSON.parse(fs.readFileSync(path.join(STATE, `${IDENTITY}-survival.json`), 'utf8')); } catch (_) { return state.survival; } })();
  state.survival = survival || state.survival;
  // One death, however many records: the flight's damage frame and the
  // survival record of the same death differ by milliseconds, and a set of
  // exact times counted trial 21's one death twice.
  const deaths = new Set();
  for (const t of [...a.deaths.map(d => d.t), ...(state.survival?.deaths || []).map(d => Date.parse(d.at)).filter(t => t >= from && t <= to)].sort((x, y) => x - y)) {
    if (![...deaths].some(d => Math.abs(d - t) < 10000)) deaths.add(t);
  }
  // A loop: the same problem persisted three times, or a step flipping.
  const loops = [...Object.entries(a.problems).filter(([, v]) => v.count >= 3).map(([p, v]) => `${v.count}× ${p.slice(0, 120)}`),
    ...a.flips.map(f => `flipping ${f.between}`)];
  const still = a.still.filter(s => !s.waiting && s.seconds > 60).map(s => `${s.seconds} s at ${s.at} (${s.step || '-'}, ${s.survival || '-'})`);
  // Pacing windows run back to back while it lasts: more than a minute is
  // two windows touching.
  const pacing = [];
  for (let i = 0; i < a.pacing.length; i++) {
    let j = i;
    while (j + 1 < a.pacing.length && a.pacing[j + 1].from - a.pacing[j].to < 10000) j++;
    const span = a.pacing[j].to - a.pacing[i].from;
    if (span > 60000) pacing.push(`${Math.round(span / 1000)} s at ${a.pacing[i].at} (${a.pacing[i].step || '-'})`);
    i = j;
  }
  // The pockets and what is worn, each from the latest frame that has it:
  // heartbeats now carry the pockets but not the equipment, and the latest
  // frame with pockets read a shield in the off-hand as no shield (trial 19).
  const m = reached(a.frames, state);
  const byTarget = k => m[k] && (m.at[k] == null || m.at[k] <= from + TARGET_MS);
  const missing = MILESTONES.filter(k => !byTarget(k));
  const done = to - from >= DAYS_MS, pastTarget = to - from >= TARGET_MS;
  const minute = t => Math.round((t - from) / 60000);
  const reasons = [...(deaths.size ? [`${deaths.size} death(s)`] : []), ...loops.map(l => `loop: ${l}`),
    ...(pastTarget ? missing.map(k => `missing by minute ${TARGET_MS / 60000}: ${k}${m[k] && m.at[k] ? ` (reached at minute ${minute(m.at[k])})` : ''}`) : [])];
  const notes = [...still.map(s => `still: ${s}`), ...pacing.map(p => `pacing: ${p}`)];
  return { world: trial.world, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - from) / 60000), done,
    pass: done && !reasons.length, failedAlready: reasons.length > 0, reasons, notes,
    reachedAtMinute: Object.fromEntries(Object.entries(m.at).map(([k, t]) => [k, minute(t)])), milestones: m, missing };
}

// Whoever watches in Spectator sees in the dark: a datapack in the new
// world gives night vision to spectators each tick. Only spectators: the
// bot plays in Survival and gets nothing (no cheats, the audit's rule).
function spectatorNightVision(worldDir) {
  const pack = path.join(worldDir, 'datapacks', 'spectator-night-vision');
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(pack, file)), { recursive: true }); fs.writeFileSync(path.join(pack, file), text); };
  write('pack.mcmeta', JSON.stringify({ pack: { description: 'Night vision for spectators watching a trial', min_format: 101, max_format: 101 } }, null, 2));
  write('data/trial/function/spectators.mcfunction', 'effect give @a[gamemode=spectator] minecraft:night_vision infinite 0 true\n');
  write('data/minecraft/tags/function/tick.json', JSON.stringify({ values: ['trial:spectators'] }, null, 2));
}

// The trial's bot, by the pid file index.js writes. A bot started before
// the pid files (it served a viewer on port 3044) is found by that port.
const BOT_PID = path.join(STATE, 'pids', `127.0.0.1-${PORT}-Jev.pid`);
function botPid() {
  try { const p = fs.readFileSync(BOT_PID, 'utf8').trim(); if (p && alive(p)) return p; } catch (_) {}
  return PORT === 25581 ? pid(3044) : null;
}

async function start(world) {
  if (!/^[a-z0-9-]+$/.test(world || '')) throw new Error('A world name of lowercase letters, digits and dashes');
  // A watchdog that restarts a quiet bot leaves the trial's bot alone while
  // this runs: stopping the old server quiets the recording, and one started
  // a bot on the old state in the middle of trial 30's start.
  const starting = BOT_PID.replace(/\.pid$/, '.starting');
  fs.mkdirSync(path.dirname(starting), { recursive: true }); fs.writeFileSync(starting, `${process.pid}\n`);
  try { await startTrial(world); } finally { fs.rmSync(starting, { force: true }); }
}

async function startTrial(world) {
  const props = path.join(SERVER, 'server.properties');
  const server = pid(PORT), bot = botPid();
  if (bot) { process.kill(Number(bot)); await sleep(3000); }
  if (server) {
    fs.writeFileSync(path.join(SERVER, 'console.in'), 'stop\n');
    for (let i = 0; i < 60 && alive(server); i++) await sleep(1000);
    // A server that said "Stopping" and never went kept the old world up,
    // and trial 5 ran on trial 4's world and player (2026-09-24).
    if (alive(server)) { process.kill(Number(server), 'SIGTERM'); for (let i = 0; i < 20 && alive(server); i++) await sleep(1000); }
    if (alive(server)) { process.kill(Number(server), 'SIGKILL'); await sleep(2000); }
  }
  if (pid(PORT)) throw new Error(`The old server is still on ${PORT}; nothing was started`);
  fs.writeFileSync(props, fs.readFileSync(props, 'utf8').replace(/^level-name=.*$/m, `level-name=${world}`));
  spectatorNightVision(path.join(SERVER, world));
  spawn('sh', ['start.sh'], { cwd: SERVER, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 120 && !pid(PORT); i++) await sleep(1000);
  const log = () => { try { return fs.readFileSync(path.join(SERVER, 'logs', 'latest.log'), 'utf8'); } catch (_) { return ''; } };
  for (let i = 0; i < 60 && !log().includes(`Preparing level "${world}"`); i++) await sleep(1000);
  if (!log().includes(`Preparing level "${world}"`)) throw new Error(`The server on ${PORT} did not load ${world}`);
  // A watchdog that restarts a silent bot may have started one on the old
  // state while the server was down (trial 2 ran on the old state that way):
  // no bot at all before the state is archived.
  for (let i = 0; i < 20; i++) { const other = botPid(); if (!other) break; process.kill(Number(other), 'SIGKILL'); await sleep(1500); }
  // Fresh bot state: the old files kept aside, the dream seeded.
  const archive = path.join(STATE, `archive-${IDENTITY}-${Date.now()}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const f of fs.readdirSync(STATE).filter(f => f.startsWith(IDENTITY) && f.endsWith('.json'))) fs.renameSync(path.join(STATE, f), path.join(archive, f));
  fs.writeFileSync(path.join(STATE, `${IDENTITY}-dream.json`), JSON.stringify({ version: 1, dream: 'beat_the_game', setBy: 'TestPlayer', setAt: new Date().toISOString() }));
  const out = fs.openSync(process.env.FIRST_DAYS_LOG || path.join(ROOT, 'artifacts', `first-days-${world}.log`), 'a');
  const child = spawn(process.execPath, ['index.js'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, MC_HOST: '127.0.0.1', MC_PORT: String(PORT), MC_USERNAME: 'Jev', RECOVERY_ADVISER: 'jev', JEV_ENCOUNTERS: '1' } });
  child.unref();
  for (let i = 0; i < 30 && !botPid(); i++) await sleep(1000);
  if (String(botPid()) !== String(child.pid)) throw new Error(`The trial's bot is not the one just started (${botPid()} vs ${child.pid}); start again`);
  const all = trials();
  all.push({ world, port: PORT, startedAt: new Date().toISOString() });
  saveTrials(all);
  console.log(`Trial on ${world} started at ${all.at(-1).startedAt}; verdict from ${new Date(Date.now() + DAYS_MS).toISOString()}.`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'start') return start(arg);
  const all = trials();
  if (cmd === 'status') { console.log(JSON.stringify(all, null, 2)); return; }
  if (cmd === 'verdict') {
    // This server's latest trial: the ones before ports were written down
    // were all on 25581.
    const trial = all.filter(t => (t.port || 25581) === PORT).at(-1);
    if (!trial) throw new Error(`No trial started on ${PORT}`);
    const v = verdict(trial);
    // Read again before writing: another server's trial may have started
    // since, and its entry is not to be lost.
    const latest = trials(), mine = latest.find(t => t.world === trial.world && t.startedAt === trial.startedAt);
    if (mine) { mine.verdict = v; saveTrials(latest); }
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  console.log('first-days.js start <world> | verdict | status');
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { milestones, reached, verdict, PAST_ARMOUR, spectatorNightVision };
