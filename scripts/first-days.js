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
// The clean server is .clean-run on 25581; the bot is the one on dashboard
// 3044. A trial is sixty minutes of wall clock from the bot's first join:
// three days of twenty minutes. Nothing in the game is touched but the
// world's name; Jev is not an operator.
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { analyse } = require('./lib/audit');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, '.clean-run');
const STATE = path.join(ROOT, '.bot-state');
const IDENTITY = '127_0_0_1-25581-Jev';
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

function verdict(trial, { now = Date.now() } = {}) {
  const from = Date.parse(trial.startedAt), to = Math.min(now, from + DAYS_MS);
  const a = analyse({ identity: IDENTITY, from, to });
  if (!a) return { pass: false, reasons: ['no flight frames in the trial window'] };
  const state = JSON.parse(fs.readFileSync(path.join(STATE, `${IDENTITY}.json`), 'utf8'));
  const survival = (() => { try { return JSON.parse(fs.readFileSync(path.join(STATE, `${IDENTITY}-survival.json`), 'utf8')); } catch (_) { return state.survival; } })();
  state.survival = survival || state.survival;
  const deaths = new Set([...a.deaths.map(d => d.t), ...(state.survival?.deaths || []).map(d => Date.parse(d.at)).filter(t => t >= from && t <= to)]);
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
  const latest = key => [...a.frames].reverse().find(f => f.snapshot?.[key] && typeof f.snapshot[key] === 'object')?.snapshot?.[key];
  const m = milestones({ inventory: latest('inventory'), equipment: latest('equipment') }, state);
  const missing = ['iron_pickaxe', 'iron_sword', 'iron_armour', 'shield', 'bed', 'home'].filter(k => !m[k]);
  const done = to - from >= DAYS_MS;
  const reasons = [...(deaths.size ? [`${deaths.size} death(s)`] : []), ...loops.map(l => `loop: ${l}`), ...still.map(s => `still: ${s}`),
    ...pacing.map(p => `pacing: ${p}`), ...(done ? missing.map(k => `missing: ${k}`) : [])];
  return { world: trial.world, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - from) / 60000), done,
    pass: done && !reasons.length, failedAlready: reasons.some(r => !r.startsWith('missing')), reasons, milestones: m, missing };
}

async function start(world) {
  if (!/^[a-z0-9-]+$/.test(world || '')) throw new Error('A world name of lowercase letters, digits and dashes');
  const props = path.join(SERVER, 'server.properties');
  const server = pid(25581), bot = pid(3044);
  if (bot) { process.kill(Number(bot)); await sleep(3000); }
  if (server) {
    fs.writeFileSync(path.join(SERVER, 'console.in'), 'stop\n');
    for (let i = 0; i < 60 && alive(server); i++) await sleep(1000);
    // A server that said "Stopping" and never went kept the old world up,
    // and trial 5 ran on trial 4's world and player (2026-09-24).
    if (alive(server)) { process.kill(Number(server), 'SIGTERM'); for (let i = 0; i < 20 && alive(server); i++) await sleep(1000); }
    if (alive(server)) { process.kill(Number(server), 'SIGKILL'); await sleep(2000); }
  }
  if (pid(25581)) throw new Error('The old server is still on 25581; nothing was started');
  fs.writeFileSync(props, fs.readFileSync(props, 'utf8').replace(/^level-name=.*$/m, `level-name=${world}`));
  spawn('sh', ['start.sh'], { cwd: SERVER, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 120 && !pid(25581); i++) await sleep(1000);
  const log = () => { try { return fs.readFileSync(path.join(SERVER, 'logs', 'latest.log'), 'utf8'); } catch (_) { return ''; } };
  for (let i = 0; i < 60 && !log().includes(`Preparing level "${world}"`); i++) await sleep(1000);
  if (!log().includes(`Preparing level "${world}"`)) throw new Error(`The server on 25581 did not load ${world}`);
  // A watchdog that restarts a silent bot may have started one on the old
  // state while the server was down (trial 2 ran on the old state that way):
  // no bot at all before the state is archived.
  for (let i = 0; i < 20; i++) { const other = pid(3044); if (!other) break; process.kill(Number(other), 'SIGKILL'); await sleep(1500); }
  // Fresh bot state: the old files kept aside, the dream seeded.
  const archive = path.join(STATE, `archive-${IDENTITY}-${Date.now()}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const f of fs.readdirSync(STATE).filter(f => f.startsWith(IDENTITY) && f.endsWith('.json'))) fs.renameSync(path.join(STATE, f), path.join(archive, f));
  fs.writeFileSync(path.join(STATE, `${IDENTITY}-dream.json`), JSON.stringify({ version: 1, dream: 'beat_the_game', setBy: 'TestPlayer', setAt: new Date().toISOString() }));
  const out = fs.openSync(process.env.FIRST_DAYS_LOG || path.join(ROOT, 'artifacts', `first-days-${world}.log`), 'a');
  const child = spawn(process.execPath, ['index.js'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, MC_HOST: '127.0.0.1', MC_PORT: '25581', MC_USERNAME: 'Jev', JEV_DASHBOARD_PORT: '3044', RECOVERY_ADVISER: 'jev', JEV_ENCOUNTERS: '1' } });
  child.unref();
  for (let i = 0; i < 30 && !pid(3044); i++) await sleep(1000);
  if (String(pid(3044)) !== String(child.pid)) throw new Error(`The bot on 3044 is not the trial's own (${pid(3044)} vs ${child.pid}); start again`);
  const all = trials();
  all.push({ world, startedAt: new Date().toISOString() });
  saveTrials(all);
  console.log(`Trial on ${world} started at ${all.at(-1).startedAt}; verdict from ${new Date(Date.now() + DAYS_MS).toISOString()}.`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'start') return start(arg);
  const all = trials();
  if (cmd === 'status') { console.log(JSON.stringify(all, null, 2)); return; }
  if (cmd === 'verdict') {
    const trial = all.at(-1);
    if (!trial) throw new Error('No trial started');
    const v = verdict(trial);
    trial.verdict = v; saveTrials(all);
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  console.log('first-days.js start <world> | verdict | status');
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { milestones, verdict, PAST_ARMOUR };
