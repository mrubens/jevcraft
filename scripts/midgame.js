'use strict';
// The midgame, judged. The user's goal (2026-09-25): Jev, starting from a
// world past the first three days, reaches the Nether, a fortress, six blaze
// rods and twelve ender pearls with no deaths and no loops, on two worlds in
// a row.
//
//   node scripts/midgame.js start mid-110-a .clean-run-25582/first-days-110 .bot-state/archive-127_0_0_1-25582-Jev-1790359748711
//   node scripts/midgame.js verdict
//   node scripts/midgame.js status
//
// The world is a copy of one a first-days trial passed on, as that trial
// left it (the server saved it when the next trial stopped it), and the bot
// resumes from that trial's own saved state (the archive first-days.js made
// when it started the next trial on that server). Nothing is given: the bot
// carries what it carried, remembers what it remembered, and is not an
// operator. MIDGAME_PORT picks the server, as FIRST_DAYS_PORT does.
// A trial passes once all four are reached with no death and no loop before
// then; it fails on a death, a loop, or MIDGAME_HOURS (default 3) without
// all four.
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { analyse } = require('./lib/audit');
const { strandedFromFrames } = require('./lib/stranded');
const { spellsOf, overlapMs, within, INFRA, says: jevDownSays } = require('./lib/jev-down');
const { spectatorNightVision } = require('./first-days');
const { ensureSupervisor, absences } = require('./lib/supervise');
const { launch, armOf } = require('./lib/arms');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.MIDGAME_PORT || 25582);
const SERVER = path.join(ROOT, PORT === 25581 ? '.clean-run' : `.clean-run-${PORT}`);
const STATE = path.join(ROOT, '.bot-state');
const IDENTITY = `127_0_0_1-${PORT}-Jev`;
// One file a trial: three trials started at once each read one shared log,
// added themselves and wrote it back, and the last write left only its own
// entry (2026-09-25); the others were never judged.
const LOG_DIR = path.join(ROOT, 'artifacts', 'midgame');
const LIMIT_MS = Number(process.env.MIDGAME_HOURS || 3) * 3600000;
const BLAZE_RODS = 6, PEARLS = 12;
const trials = () => { try { return fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8'))).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)); } catch (_) { return []; } };
const saveTrial = t => { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(path.join(LOG_DIR, `${t.world}.json`), JSON.stringify(t, null, 2)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pid = port => { try { return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`).toString().trim().split('\n')[0] || null; } catch (_) { return null; } };
const alive = p => { try { process.kill(Number(p), 0); return true; } catch (_) { return false; } };

// What the frames show, each counted once reached: the Nether by the
// dimension the bot stood in; a fortress by walking in one (the sweep's
// "walking" leg) or by a blaze rod in hand, which only a fortress gives;
// rods as rods, powder (two a rod) and eyes (one powder each) together;
// pearls as pearls and eyes.
const MILESTONES = ['nether', 'fortress', 'blaze_rods', 'ender_pearls'];
// The player made an operator on every trial server, to spectate and follow
// Jev (Jev itself never is): TRIAL_WATCHER, from the environment or .env.
// None set, no one is made an operator.
function trialWatcher() {
  if (process.env.TRIAL_WATCHER) return process.env.TRIAL_WATCHER;
  try { return (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^TRIAL_WATCHER=(\S+)/m) || [])[1] || null; } catch (_) { return null; }
}
function counts(inventory = {}) {
  const n = k => Number(inventory[k] || 0);
  return { rods: n('blaze_rod') + n('blaze_powder') / 2 + n('ender_eye') / 2, pearls: n('ender_pearl') + n('ender_eye') };
}
// The blaze rods in the last inventory the frames show.
function rodsCarriedNow(frames) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const inv = frames[i].snapshot?.inventory;
    if (inv && typeof inv === 'object') return Number(inv.blaze_rod || 0);
  }
  return 0;
}
function reached(frames) {
  const at = {}, best = { rods: 0, pearls: 0 };
  const mark = (k, t) => { if (!(k in at)) at[k] = t; };
  for (const f of frames) {
    const s = f.snapshot || {};
    if (/nether/.test(String(s.dimension || ''))) mark('nether', f.t);
    const step = s.goal?.step || s.step;
    if (step?.action === 'find_fortress' && step.walking) mark('fortress', f.t);
    if (s.inventory && typeof s.inventory === 'object') {
      const c = counts(s.inventory);
      best.rods = Math.max(best.rods, c.rods); best.pearls = Math.max(best.pearls, c.pearls);
      if (c.rods >= 1) mark('fortress', f.t);
      if (c.rods >= BLAZE_RODS) mark('blaze_rods', f.t);
      if (c.pearls >= PEARLS) mark('ender_pearls', f.t);
    }
  }
  return { at, best };
}

// The watcher's cuts (scripts/trials/watch.sh), said as reasons (note 763):
// a fresh world an hour played with no Nether, and an hour in the Nether
// with no fortress, were ended by the watcher with `reasons: []`, so 44 of
// 108 endings since 2026-09-30 10Z were missing from the loop and death
// rates. -> the reasons, none when neither cut applies.
const CUT_MINUTES = 60;
// A fresh world casting its portal's frame at the hour is given until ninety
// minutes (note 903): of the five cut at sixty minutes from 13:20Z to 14:30Z
// on 2026-10-02, four had a frame begun (two with 2 and 3 of ten cast). The harness's rule, not the bot's: an arrival after minute
// sixty is said as that (netherAfterTheHour on the verdict).
const CUT_CASTING_MINUTES = 90, CASTING_WITHIN_MS = 10 * 60000;
function castingLately(frames, to) {
  return (frames || []).some(f => f.t >= to - CASTING_WITHIN_MS && ((f.snapshot?.step || f.snapshot?.goal?.step)?.action === 'cast_portal'));
}
function cutReasons(world, playedMinutes, reachedAtMinute = {}, { casting = false } = {}) {
  const out = [];
  const limit = casting ? CUT_CASTING_MINUTES : CUT_MINUTES;
  if (!/fortress|nether/.test(world || '') && playedMinutes >= limit && reachedAtMinute.nether == null) out.push(`cut: no Nether in ${limit} minutes played${casting ? ' (a portal frame being cast at the hour)' : ''}`);
  if (!/fortress/.test(world || '') && reachedAtMinute.nether != null && reachedAtMinute.fortress == null && playedMinutes - reachedAtMinute.nether >= CUT_MINUTES) out.push(`cut: no fortress in ${CUT_MINUTES} minutes after the Nether`);
  return out;
}

// Jev down (note 781, scripts/lib/jev-down.js): no decision can be made, so
// the spell is not play. It is kept off the played clock (the three hours
// run on by it, and the watcher's hour cuts read played minutes), out of
// the loops (a 402 persist is the outage, not a loop) and the stranded
// check, and said apart: "Jev down N min". On 2026-10-01 from 04:57:47Z
// every verdict on 25581, 25583 and 25584 failed on "loop: N× TypeSafe 402"
// a minute or two in, and the overnight loop started a new world each time.
const STRANDED_DOWN_SHARE = 0.1;
function verdict(trial, { now = Date.now(), dir = undefined, identity = IDENTITY } = {}) {
  const from = Date.parse(trial.startedAt);
  const read = to => analyse({ identity, from, to, ...(dir ? { dir } : {}) });
  // The window: the three hours played, run on by the Jev-down time in it.
  let to = Math.min(now, from + LIMIT_MS), a = read(to), spells = a ? spellsOf(a.frames) : [];
  for (let i = 0; a && spells.length && i < 4; i++) {
    const next = Math.min(now, from + LIMIT_MS + overlapMs(spells, from, to));
    if (next <= to) break;
    to = next; a = read(to) || a; spells = spellsOf(a.frames);
  }
  if (!a) return { pass: false, reasons: ['no flight frames in the trial window'] };
  const downMs = overlapMs(spells, from, to);
  const downNow = !!spells.at(-1)?.open && now - spells.at(-1).to < 3 * 60000;
  const { at, best } = reached(a.frames);
  const all = MILESTONES.every(k => k in at);
  const doneAt = all ? Math.max(...MILESTONES.map(k => at[k])) : null;
  // Deaths and loops count up to the moment the last milestone came.
  const until = doneAt ?? to;
  const deaths = [];
  for (const t of a.deaths.map(d => d.t).filter(t => t <= until).sort((x, y) => x - y)) if (!deaths.some(d => Math.abs(d - t) < 10000)) deaths.push(t);
  // Not loops: a problem that is the outage's own words, or that came and
  // went inside a spell; a flip that began inside one.
  const SLACK = 30000;
  const outage = (p, v) => INFRA.test(p) || (within(spells, v.first ?? 0, SLACK) && within(spells, v.last ?? v.first ?? 0, SLACK));
  const loopsSeen = [...Object.entries(a.problems).filter(([p, v]) => v.count >= 3 && (v.first ?? 0) <= until && !outage(p, v)).map(([p, v]) => `${v.count}× ${p.slice(0, 120)}`),
    ...a.flips.filter(f => (f.from ?? 0) <= until && !within(spells, f.from ?? 0, SLACK)).map(f => `flipping ${f.between}`)];
  // Not a trial's end while blaze rods are carried (note 861): a loop there
  // is the way out not found yet, and ending the trial ends the only rods
  // there are. mid-220-ar (25592, 2026-10-01 22:04Z) was cut as "loop: 3×
  // The nether portal ... cannot be reached from here" with six rods carried
  // at full health, the most of any life on record. Its three hours still
  // end it, and a death or being stranded.
  // Nor once a rod has been got in the trial at all (note 901): banked, the
  // rods are in a chest and none is carried, and the trial that put them
  // there is the one that goes back for more. mid-243-kc-fortress-3 (25594,
  // 2026-10-02 14:44:31Z) banked two blaze rods past its portal and was cut
  // fifty seconds later as "loop: flipping collect_nearby_resource <->
  // tunnel", gathering wood by its chest.
  const rodsNow = rodsCarriedNow(a.frames);
  const rodsGot = Math.max(rodsNow, Number(best?.rods) || 0);
  // Nor once a pearl has been got (note 1011): the hunt for them is a stalk
  // and a fight in turn, which reads as a flip between two steps.
  // mid-242-ug-nether-1 (25597, 2026-10-03 07:20 to 07:38Z) took three
  // ender pearls from the slot in eighteen minutes, the most of any trial,
  // and was cut as "loop: flipping stalk_mob <-> acquire".
  const pearlsGot = Number(best?.pearls) || 0;
  const loops = rodsGot >= 1 || pearlsGot >= 1 ? [] : loopsSeen;
  const minute = t => Math.round((t - from) / 60000);
  const windowMs = to - from;
  // Time with no bot running (quit for a restart and not started again, a
  // crash, a server down) is not play: the verdict says how much of the
  // window was played, and a run that timed out with a tenth or more of it
  // unplayed says so instead of claiming the whole window.
  const timedOut = !all && windowMs - downMs >= LIMIT_MS;
  const gone = absences(a.frames, from, to, { closed: timedOut || all });
  const absentMs = gone.reduce((n, g) => n + (g.to - g.from), 0);
  // A spell's time the bot was not running is counted once, as absent.
  const downPlayedMs = Math.max(0, downMs - gone.reduce((n, g) => n + overlapMs(spells, g.from, g.to), 0));
  const playedMs = windowMs - absentMs - downPlayedMs;
  const playedBy = t => (t - from) - gone.reduce((n, g) => n + Math.max(0, Math.min(t, g.to) - g.from), 0) - overlapMs(spells, from, t);
  const unplayed = timedOut && absentMs >= 0.1 * (windowMs - downPlayedMs);
  const said = unplayed ? `after ${Math.round(playedMs / 60000)} minutes played of ${LIMIT_MS / 3600000} hours (the bot was not running for ${Math.round(absentMs / 60000)}; not a verdict on play)` : `after ${LIMIT_MS / 3600000} hours`;
  // Stranded (note 650): not a death and not a loop, and no more play in it:
  // half an hour inside a dozen blocks with the way off answered none good.
  // Not while Jev was down for a tenth of that half hour: it could answer nothing.
  const strandedSeen = all ? null : strandedFromFrames(a.frames, { now: to });
  const stranded = strandedSeen && overlapMs(spells, to - strandedSeen.minutes * 60000, to) < STRANDED_DOWN_SHARE * strandedSeen.minutes * 60000 ? strandedSeen : null;
  const reasons = [...(deaths.length ? [`${deaths.length} death(s)${deaths.some(t => within(spells, t, SLACK)) ? `, ${deaths.filter(t => within(spells, t, SLACK)).length} while Jev was down` : ''}`] : []), ...loops.map(l => `loop: ${l}`), ...(stranded ? [stranded.says] : []),
    ...(timedOut ? MILESTONES.filter(k => !(k in at)).map(k => `missing ${said}: ${k}`) : []),
    ...(all ? [] : cutReasons(trial.world, Math.round(playedMs / 60000), Object.fromEntries(Object.entries(at).map(([k, t]) => [k, Math.round(playedBy(t) / 60000)])), { casting: castingLately(a.frames, to) }))];
  return { world: trial.world, source: trial.source, ...(trial.arm ? { arm: trial.arm } : {}), from: new Date(from).toISOString(), minutes: Math.round((to - from) / 60000),
    pass: all && !reasons.length, done: all || timedOut || reasons.length > 0, failedAlready: reasons.length > 0, reasons, ...(stranded ? { stranded } : {}),
    ...(!/fortress|nether/.test(trial.world || '') && at.nether != null && playedBy(at.nether) > CUT_MINUTES * 60000 ? { netherAfterTheHour: Math.round(playedBy(at.nether) / 60000) } : {}),
    ...(rodsGot >= 1 && loopsSeen.length ? { loopsWithRodsCarried: { rods: rodsNow, got: rodsGot, loops: loopsSeen } } : {}),
    playedMinutes: Math.round(playedMs / 60000), absentMinutes: Math.round(absentMs / 60000), unplayed,
    absences: gone.map(g => ({ atMinute: minute(g.from), minutes: Math.round((g.to - g.from) / 60000) })),
    // Said apart, never a reason: the spells, and whether Jev is down now
    // (watch.sh stops for nothing then; a restart would only stand too).
    jevDownMinutes: Math.round(downMs / 6000) / 10, jevDownNow: downNow,
    ...(spells.length ? { jevDown: { says: jevDownSays(spells.filter(s => s.to >= from && s.from <= to)), spells: spells.map(s => ({ atMinute: minute(s.from), minutes: Math.round(s.ms / 6000) / 10, kind: s.kind, ...(s.open ? { open: true } : {}) })) } } : {}),
    reachedAtMinute: Object.fromEntries(Object.entries(at).map(([k, t]) => [k, minute(t)])), most: { blazeRods: best.rods, enderPearls: best.pearls } };
}

const BOT_PID = path.join(STATE, 'pids', `127.0.0.1-${PORT}-Jev.pid`);
const botPid = () => { try { const p = fs.readFileSync(BOT_PID, 'utf8').trim(); if (p && alive(p)) return p; } catch (_) {} return null; };

async function start(world, source, archive) {
  if (!/^[a-z0-9-]+$/.test(world || '')) throw new Error('A world name of lowercase letters, digits and dashes');
  const src = path.resolve(ROOT, source || ''), arc = path.resolve(ROOT, archive || '');
  if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error(`No saved world at ${source}`);
  const saved = fs.existsSync(arc) && fs.readdirSync(arc).filter(f => /-Jev(-[a-z-]+)?\.json$/.test(f));
  if (!saved?.length) throw new Error(`No bot state in ${archive}`);
  if (fs.existsSync(path.join(SERVER, world))) throw new Error(`${world} already exists on ${PORT}`);
  // A trial's record is kept by its world's name, across every port: a
  // second world of the same name on another port would take its record.
  if (fs.existsSync(path.join(LOG_DIR, `${world}.json`))) throw new Error(`${world} already has a trial record`);
  armOf(PORT, ROOT); // an arm that cannot carry the bot stops the start before the server is touched
  const starting = BOT_PID.replace(/\.pid$/, '.starting');
  fs.mkdirSync(path.dirname(starting), { recursive: true }); fs.writeFileSync(starting, `${process.pid}\n`);
  try {
    const server = pid(PORT), bot = botPid();
    if (bot) { process.kill(Number(bot)); await sleep(3000); }
    if (server) {
      fs.writeFileSync(path.join(SERVER, 'console.in'), 'stop\n');
      for (let i = 0; i < 60 && alive(server); i++) await sleep(1000);
      if (alive(server)) { process.kill(Number(server), 'SIGTERM'); for (let i = 0; i < 20 && alive(server); i++) await sleep(1000); }
      if (alive(server)) { process.kill(Number(server), 'SIGKILL'); await sleep(2000); }
    }
    if (pid(PORT)) throw new Error(`The old server is still on ${PORT}; nothing was started`);
    // The world as the first-days trial left it, copied: the source stays.
    fs.cpSync(src, path.join(SERVER, world), { recursive: true });
    fs.rmSync(path.join(SERVER, world, 'session.lock'), { force: true });
    spectatorNightVision(path.join(SERVER, world));
    const props = path.join(SERVER, 'server.properties');
    fs.writeFileSync(props, fs.readFileSync(props, 'utf8').replace(/^level-name=.*$/m, `level-name=${world}`));
    // The watcher is an operator from the start: its entries (both of its
    // UUIDs, the one the server resolves by name and the one it joins with)
    // copied from ops.json files where an op took.
    if (trialWatcher()) try {
      const ops = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; } };
      const watcher = trialWatcher();
      const known = new Map();
      for (const d of fs.readdirSync(ROOT).filter(d => d.startsWith('.clean-run'))) for (const o of ops(path.join(ROOT, d, 'ops.json'))) if (o.name === watcher) known.set(o.uuid, o);
      const mine = ops(path.join(SERVER, 'ops.json'));
      for (const o of known.values()) if (!mine.some(m => m.uuid === o.uuid)) mine.push(o);
      fs.writeFileSync(path.join(SERVER, 'ops.json'), JSON.stringify(mine, null, 2));
    } catch (_) {}
    spawn('sh', ['start.sh'], { cwd: SERVER, detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 120 && !pid(PORT); i++) await sleep(1000);
    const log = () => { try { return fs.readFileSync(path.join(SERVER, 'logs', 'latest.log'), 'utf8'); } catch (_) { return ''; } };
    for (let i = 0; i < 60 && !log().includes(`Preparing level "${world}"`); i++) await sleep(1000);
    if (!log().includes(`Preparing level "${world}"`)) throw new Error(`The server on ${PORT} did not load ${world}`);
    // The watcher (TRIAL_WATCHER) is made an operator on every trial server,
    // to spectate and follow Jev; Jev itself never is.
    if (trialWatcher()) fs.writeFileSync(path.join(SERVER, 'console.in'), `op ${trialWatcher()}\n`);
    for (let i = 0; i < 20; i++) { const other = botPid(); if (!other) break; process.kill(Number(other), 'SIGKILL'); await sleep(1500); }
    // This server's state set aside; the source trial's state in its place,
    // under this server's name.
    const aside = path.join(STATE, `archive-${IDENTITY}-${Date.now()}`);
    fs.mkdirSync(aside, { recursive: true });
    for (const f of fs.readdirSync(STATE).filter(f => f.startsWith(IDENTITY) && f.endsWith('.json'))) fs.renameSync(path.join(STATE, f), path.join(aside, f));
    for (const f of saved) fs.copyFileSync(path.join(arc, f), path.join(STATE, f.replace(/^127_0_0_1-\d+-Jev/, IDENTITY)));
    const out = fs.openSync(path.join(ROOT, 'artifacts', `midgame-${world}.log`), 'a');
    // The bot runs from the port's arm (scripts/lib/arms.js: main, or a
    // pinned baseline checkout), and the trial record says which.
    const { child, arm, commit } = launch(PORT, out, { root: ROOT });
    for (let i = 0; i < 30 && !botPid(); i++) await sleep(1000);
    if (String(botPid()) !== String(child.pid)) throw new Error(`The trial's bot is not the one just started (${botPid()} vs ${child.pid})`);
    const trial = { world, port: PORT, source, archive, startedAt: new Date().toISOString(), arm: arm.name, commit };
    saveTrial(trial);
    if (ensureSupervisor(PORT, ROOT)) console.log(`No supervisor was watching ${PORT}: one started (artifacts/supervisors/${PORT}.log).`);
    console.log(`Midgame trial ${world} (from ${source}) started at ${trial.startedAt}; at most ${LIMIT_MS / 3600000} hours.`);
  } finally { fs.rmSync(starting, { force: true }); }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'start') return start(...args);
  const all = trials();
  if (cmd === 'status') { console.log(JSON.stringify(all, null, 2)); return; }
  if (cmd === 'verdict') {
    const trial = all.filter(t => t.port === PORT).at(-1);
    if (!trial) throw new Error(`No midgame trial started on ${PORT}`);
    const v = verdict(trial);
    saveTrial({ ...trial, verdict: v });
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  console.log('midgame.js start <world> <source world dir> <state archive dir> | verdict | status');
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { reached, counts, verdict, cutReasons, CUT_MINUTES, MILESTONES };
