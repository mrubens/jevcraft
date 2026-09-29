'use strict';
// Two-arm trials (note 666): some ports run the bot from a pinned baseline
// checkout and the rest from main, on the same mix of starts, so "is main
// better than the baseline" is read over the same hours and the same worlds
// rather than across commits that change every hour.
//
// An arm is a checkout. `.bot-state/arms/<port>` names the checkout that
// port's bot runs from (a path, absolute or from ROOT); no file, or ROOT
// itself, is the arm 'main'. A baseline checkout is a git worktree at the
// pinned commit under ROOT/.arms/<name> (`setup`), with three links back
// into ROOT: node_modules, .env, and .bot-state. The bot keeps its state,
// pid file, flight records and restart request under its own
// `__dirname/.bot-state` (index.js, src/session.js), so the link is what puts
// a baseline bot's state in ROOT's .bot-state, where the supervisor, the
// verdict and the quiet restart look; the process runs with cwd ROOT (the
// few paths said from the cwd, as artifacts/missing-options.jsonl, land in
// ROOT's). The flight record's commit is read with git in the checkout the
// code was loaded from (src/recorder/commit.js), so a baseline run records
// the baseline's commit; its arm rides in the connection frame as JEV_ARM
// (in builds that have it) and in `.bot-state/arms/starts.log`, one line a
// start: "<ISO time>\t<port>\t<arm>\t<commit>\t<pid>\t<checkout>".
//
// A quiet restart (touching .bot-state/restart-requested) reaches a
// baseline bot through the link too: it quits, and its port's supervisor
// starts it again from the port's arm, so it stays on the baseline's code.
//
//   node scripts/lib/arms.js setup <name> <commit>       make ROOT/.arms/<name> at <commit>
//   node scripts/lib/arms.js set <port> <name|path|main>  the arm a port's next bot runs from
//   node scripts/lib/arms.js list                         each port's arm, and the checkouts
//   node scripts/lib/arms.js launch <port> <log file>     start the port's bot on its arm (supervisor.sh)
//   node scripts/lib/arms.js name <port>                  the port's arm name
//   node scripts/lib/arms.js owed-fresh <port>            the fresh source this port's arm owes the other (start-fresh.sh pair)
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const armsDir = root => path.join(root, '.bot-state', 'arms');
const checkoutsDir = root => path.join(root, '.arms');
const real = p => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };

// The arm's name for a checkout: 'main' for ROOT, else the directory's name.
const nameOf = (checkout, root = ROOT) => real(checkout) === real(root) ? 'main' : path.basename(checkout);

// The commit a checkout is at (short), or null.
function commitOf(checkout, run = execFileSync) {
  try { const out = String(run('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })).trim(); return /^[0-9a-f]{4,40}$/.test(out) ? out : null; } catch (_) { return null; }
}

// Why a checkout cannot carry a bot whose state is ROOT's (an empty list: it can).
function problems(checkout, root = ROOT) {
  if (real(checkout) === real(root)) return [];
  const out = [];
  if (!fs.existsSync(path.join(checkout, 'index.js'))) out.push(`no index.js in ${checkout}`);
  if (!fs.existsSync(path.join(checkout, 'node_modules'))) out.push(`no node_modules in ${checkout}`);
  if (real(path.join(checkout, '.bot-state')) !== real(path.join(root, '.bot-state'))) out.push(`${checkout}/.bot-state is not a link to ${root}/.bot-state (the bot would keep its state and records apart)`);
  return out;
}

// The arm a port's bot runs from: { name, checkout }. A file naming a
// checkout that cannot carry the bot is an error, not a quiet fall back to
// main: a baseline port running main's code would be counted as baseline.
function armOf(port, root = ROOT) {
  let named = '';
  try { named = fs.readFileSync(path.join(armsDir(root), String(Number(port))), 'utf8').trim(); } catch (_) { /* none: main */ }
  if (!named || named === 'main') return { name: 'main', checkout: root };
  const checkout = path.isAbsolute(named) ? named : fs.existsSync(path.join(checkoutsDir(root), named)) && !named.includes('/') ? path.join(checkoutsDir(root), named) : path.resolve(root, named);
  const why = problems(checkout, root);
  if (why.length) throw new Error(`arm of ${port}: ${why.join('; ')}`);
  return { name: nameOf(checkout, root), checkout };
}

// Every port with an arm file, and every checkout under ROOT/.arms with its commit.
function listing(root = ROOT, commit = commitOf) {
  let files = [];
  try { files = fs.readdirSync(armsDir(root)).filter(f => /^\d+$/.test(f)).sort(); } catch (_) {}
  const ports = files.map(p => { try { const a = armOf(p, root); return { port: Number(p), arm: a.name, checkout: a.checkout }; } catch (err) { return { port: Number(p), error: err.message }; } });
  let names = [];
  try { names = fs.readdirSync(checkoutsDir(root)).filter(d => fs.statSync(path.join(checkoutsDir(root), d)).isDirectory()).sort(); } catch (_) {}
  const checkouts = names.map(n => ({ name: n, checkout: path.join(checkoutsDir(root), n), commit: commit(path.join(checkoutsDir(root), n)) }));
  return { ports, checkouts };
}

// The arm's commit, by name (for records that carry a commit and no arm).
function armCommits(root = ROOT, commit = commitOf) {
  const by = new Map();
  for (const c of listing(root, commit).checkouts) if (c.commit) by.set(c.commit, c.name);
  return by;
}

function recordStart({ root = ROOT, port, arm, commit, pid, checkout, at = new Date() }) {
  fs.mkdirSync(armsDir(root), { recursive: true });
  fs.appendFileSync(path.join(armsDir(root), 'starts.log'), `${at.toISOString()}\t${port}\t${arm}\t${commit || ''}\t${pid || ''}\t${checkout}\n`);
}

// Every start logged: [{ t, port, arm, commit, pid, checkout }], oldest first.
function readStarts(root = ROOT) {
  let text = '';
  try { text = fs.readFileSync(path.join(armsDir(root), 'starts.log'), 'utf8'); } catch (_) { return []; }
  return text.split('\n').filter(Boolean).map(l => { const [at, port, arm, commit, pid, checkout] = l.split('\t'); return { t: Date.parse(at), port: Number(port), arm, commit: commit || null, pid: pid ? Number(pid) : null, checkout }; })
    .filter(s => Number.isFinite(s.t) && s.arm).sort((a, b) => a.t - b.t);
}

// Pairing (note 666): each start on one arm is owed a start from the same
// place on every other arm. `starts` are [{ t, key, arm }] (a key is what
// makes two starts the same: a stage save, a fresh source); the keys this arm
// owes, oldest debt first: where another arm started it more times than this
// one, dated by the start this arm has not matched. Starts older than
// `windowMs` are not owed (a save can go, the code moves on).
const PAIR_MS = 6 * 3600000;
function owed(starts, arm, { now = Date.now(), windowMs = PAIR_MS } = {}) {
  const by = new Map();
  for (const s of starts) {
    if (!s.arm || !s.key || !(now - s.t < windowMs) || s.t > now) continue;
    let k = by.get(s.key);
    if (!k) by.set(s.key, k = new Map());
    (k.get(s.arm) || k.set(s.arm, []).get(s.arm)).push(s.t);
  }
  const out = [];
  for (const [key, arms] of by) {
    const mine = (arms.get(arm) || []).length;
    let debt = null;
    for (const [other, ts] of arms) if (other !== arm && ts.length > mine) { const t = [...ts].sort((a, b) => a - b)[mine]; if (debt === null || t < debt) debt = t; }
    if (debt !== null) out.push({ key, since: debt });
  }
  return out.sort((a, b) => a.since - b.since);
}

// The fresh starts of midgame trials (start-fresh.sh), as pairing starts:
// key the first-days source number, from the trial records.
function freshStarts(root = ROOT) {
  const dir = path.join(root, 'artifacts', 'midgame'), out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) { return out; }
  for (const f of names) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    const m = String(r.source || '').match(/(?:^|\/)\.?trial-sources\/first-days-(\d+)$/);
    if (m && r.arm) out.push({ t: Date.parse(r.startedAt), key: m[1], arm: r.arm });
  }
  return out;
}

// The spawn a port's bot is started with: node on the arm's index.js by its
// absolute path, cwd ROOT, the trial's environment and JEV_ARM.
function botSpawn(port, root = ROOT, env = process.env) {
  const arm = armOf(port, root);
  return { arm, command: process.execPath, args: [path.join(arm.checkout, 'index.js')], options: { cwd: root, detached: true,
    env: { ...env, MC_HOST: '127.0.0.1', MC_PORT: String(port), MC_USERNAME: 'Jev', RECOVERY_ADVISER: 'jev', JEV_ENCOUNTERS: '1', JEV_ARM: arm.name } } };
}

// Start the port's bot on its arm, its output appended to `out` (a path or
// an open descriptor); the start logged. Returns { child, arm, commit }.
function launch(port, out, { root = ROOT, env = process.env, run = spawn, commit = commitOf } = {}) {
  const s = botSpawn(port, root, env);
  const fd = typeof out === 'number' ? out : fs.openSync(out, 'a');
  const child = run(s.command, s.args, { ...s.options, stdio: ['ignore', fd, fd] });
  child.unref?.();
  const sha = commit(s.arm.checkout);
  recordStart({ root, port, arm: s.arm.name, commit: sha, pid: child.pid, checkout: s.arm.checkout });
  return { child, arm: s.arm, commit: sha };
}

// A baseline checkout: a detached git worktree at the commit under
// ROOT/.arms/<name>, with node_modules, .env and .bot-state linked to ROOT's.
// Where the commit's package-lock.json differs from ROOT's, its own
// node_modules is installed instead of the link.
function setup(name, commit, { root = ROOT, run = execFileSync, say = console.log } = {}) {
  if (!/^[\w.-]+$/.test(name || '') || name === 'main') throw new Error('an arm name of letters, digits, dots and dashes (not "main")');
  if (!commit) throw new Error('setup <name> <commit>');
  const dir = path.join(checkoutsDir(root), name);
  if (fs.existsSync(dir)) throw new Error(`${dir} exists (git worktree remove ${dir} first to move it)`);
  fs.mkdirSync(checkoutsDir(root), { recursive: true });
  run('git', ['worktree', 'add', '--detach', dir, commit], { cwd: root, stdio: 'inherit' });
  const link = (what, required = true) => { const from = path.join(root, what); if (!fs.existsSync(from)) { if (required) fs.mkdirSync(from, { recursive: true }); else return; } fs.symlinkSync(from, path.join(dir, what)); };
  link('.bot-state'); link('.env', false);
  let sameLock = true;
  try { run('git', ['diff', '--quiet', commit, 'HEAD', '--', 'package-lock.json'], { cwd: root, stdio: 'ignore' }); } catch (_) { sameLock = false; }
  if (sameLock) link('node_modules');
  else { say(`package-lock.json differs between ${commit} and HEAD: installing ${name}'s own node_modules`); run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' }); }
  const why = problems(dir, root);
  if (why.length) throw new Error(why.join('; '));
  say(`arm ${name}: ${dir} at ${commitOf(dir)}`);
  return dir;
}

// The arm a port's next bot runs from ('main' removes the file).
function setArm(port, arm, { root = ROOT } = {}) {
  if (!Number.isInteger(Number(port)) || !Number(port)) throw new Error('set <port> <name|path|main>');
  const file = path.join(armsDir(root), String(Number(port)));
  if (!arm || arm === 'main') { fs.rmSync(file, { force: true }); return { name: 'main', checkout: root }; }
  fs.mkdirSync(armsDir(root), { recursive: true });
  fs.writeFileSync(file, `${arm}\n`);
  try { return armOf(port, root); } catch (err) { fs.rmSync(file, { force: true }); throw err; }
}

function main(argv = process.argv.slice(2)) {
  const [cmd, a, b] = argv;
  if (cmd === 'setup') { setup(a, b); return; }
  if (cmd === 'set') { const arm = setArm(a, b); console.log(`${a}: ${arm.name} (${arm.checkout}); the next bot started on ${a} runs from it`); return; }
  if (cmd === 'name') { console.log(armOf(a).name); return; }
  if (cmd === 'owed-fresh') { const o = owed(freshStarts(), armOf(a).name)[0]; if (o) console.log(o.key); return; }
  if (cmd === 'launch') { const r = launch(Number(a), b); console.log(`${r.child.pid}\t${r.arm.name}\t${r.commit || ''}`); return; }
  if (cmd === 'list') {
    const l = listing();
    for (const p of l.ports) console.log(p.error ? `${p.port}\tERROR ${p.error}` : `${p.port}\t${p.arm}\t${p.checkout}`);
    console.log(l.ports.length ? '(every other port: main)' : 'no port has an arm file: every port runs main');
    for (const c of l.checkouts) console.log(`checkout ${c.name}\t${c.commit || '?'}\t${c.checkout}`);
    return;
  }
  console.log('arms.js setup <name> <commit> | set <port> <name|path|main> | list | launch <port> <log> | name <port>');
  process.exitCode = 2;
}

if (require.main === module) { try { main(); } catch (err) { console.error(err.message); process.exit(1); } }
module.exports = { armOf, nameOf, commitOf, problems, listing, armCommits, recordStart, readStarts, owed, freshStarts, PAIR_MS, botSpawn, launch, setup, setArm, armsDir, checkoutsDir };
