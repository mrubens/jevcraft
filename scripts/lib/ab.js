'use strict';
// The two-arm comparison (note 666): the flight records and the midgame
// trial records of a window, split by the arm each bot ran on
// (scripts/lib/arms.js), and measured the same way on each side, with the
// noise said beside each number. scripts/ab-report.js prints it.
//
// A run is one bot process: its flight file and that file's -partN
// continuations (scripts/lib/flight-commit.js). Its arm is, in order: the
// connection frame's `arm` (JEV_ARM, builds after note 666), the start logged
// in .bot-state/arms/starts.log for that port just before the file began,
// the arm whose checkout is at the run's commit, else 'main' (a bot started
// before the arms or by an old supervisor).
//
// The measures of a run, over frames less than a minute apart (a longer
// silence is the bot down, not bot time), each stretch charged to the state
// at its start:
//   - Nether time: the bot stood in the Nether;
//   - fortress time: in the Nether, and a blaze seen within 24 blocks in the
//     last 30 s or within 48 blocks (across) of a fortress the record names
//     (find_fortress's `found`, a step or landmark at a nether_fortress, a
//     question's fortressInView within 16 blocks);
//   - blaze-sight time: a blaze seen within 24 blocks in the last 30 s;
//   - deaths: the health going from above zero to zero, with the dimension
//     it happened in and the game's line for it (a later question's
//     recentDeaths, scripts/blaze-record.js deaths(); else the server log);
//   - rods gained: rises in the rods carried (two powder a rod);
//   - fights with blazes: scripts/blaze-record.js fights(), and those that
//     had four or more blazes within 16 at once.
const fs = require('node:fs');
const path = require('node:path');
const { runKey, partOf } = require('./flight-commit');

const GAP_MS = 60000, SIGHT_MS = 30000, FORTRESS_RANGE = 48, SIGHT_RANGE = 24;
const COMMIT = /"commit":"([0-9a-f]{4,40})"/, ARM = /"arm":"([\w.-]+)"/;
const HEAD_BYTES = 2 * 1024 * 1024;

// ---- statistics ------------------------------------------------------------
const Z = 1.959964;
// Byar's approximation to the exact (Garwood) 95% interval of a Poisson count.
function poissonCI(k) {
  const lo = k === 0 ? 0 : k * (1 - 1 / (9 * k) - Z / (3 * Math.sqrt(k))) ** 3;
  const k1 = k + 1, hi = k1 * (1 - 1 / (9 * k1) + Z / (3 * Math.sqrt(k1))) ** 3;
  return [Math.max(0, lo), hi];
}
// A rate per hour with its interval: { k, hours, rate, lo, hi }.
function rateOf(k, hours) {
  if (!(hours > 0)) return { k, hours: hours || 0, rate: null, lo: null, hi: null };
  const [lo, hi] = poissonCI(k);
  return { k, hours, rate: k / hours, lo: lo / hours, hi: hi / hours };
}
function wilson(k, n) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + Z * Z / n, c = p + Z * Z / (2 * n), m = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const propOf = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, p: n ? k / n : null, lo, hi }; };
// log Γ (Lanczos), for the exact tests.
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
// Two-sided exact binomial test of k in n against p0 (the outcomes no likelier than k's).
function binomialP(k, n, p0) {
  if (!n) return 1;
  if (p0 <= 0) return k === 0 ? 1 : 0;
  if (p0 >= 1) return k === n ? 1 : 0;
  const lp = i => lchoose(n, i) + i * Math.log(p0) + (n - i) * Math.log(1 - p0);
  const at = lp(k);
  let s = 0;
  for (let i = 0; i <= n; i++) { const l = lp(i); if (l <= at + 1e-7) s += Math.exp(l); }
  return Math.min(1, s);
}
// Two rates compared: a's over b's, with the 95% interval of the ratio (the
// conditional binomial: a's share of the events against its share of the
// hours) and the exact two-sided p of no difference.
function rateRatio(a, b) {
  const n = a.k + b.k;
  if (!(a.hours > 0 && b.hours > 0)) return null;
  const share = a.hours / (a.hours + b.hours), p = binomialP(a.k, n, share);
  if (!n) return { ratio: null, lo: null, hi: null, p };
  const odds = x => x >= 1 ? Infinity : x / (1 - x), scale = b.hours / a.hours, [lo, hi] = wilson(a.k, n);
  return { ratio: a.k / n >= 1 ? Infinity : odds(a.k / n) * scale, lo: odds(lo) * scale, hi: odds(hi) * scale, p };
}
// Fisher's exact two-sided test of two proportions.
function fisherP(k1, n1, k2, n2) {
  const K = k1 + k2, N = n1 + n2;
  if (!n1 || !n2) return 1;
  const lp = x => lchoose(n1, x) + lchoose(n2, K - x) - lchoose(N, K);
  const at = lp(k1);
  let s = 0;
  for (let x = Math.max(0, K - n2); x <= Math.min(K, n1); x++) { const l = lp(x); if (l <= at + 1e-7) s += Math.exp(l); }
  return Math.min(1, s);
}

// ---- runs ------------------------------------------------------------------
const fileStart = file => { const m = file.match(/-Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z/); return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN; };
const portOf = file => Number((file.match(/-(\d{4,5})-Jev-/) || [])[1]) || null;

// The arm and commit of a run from the head of its first part.
function headOf(file) {
  let text = '';
  try { const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(HEAD_BYTES); const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0); fs.closeSync(fd); text = buf.toString('utf8', 0, n); } catch (_) { return {}; }
  const line = text.split('\n').find(l => l.startsWith('{"kind":"connection"'));
  if (!line) return {};
  return { commit: (COMMIT.exec(line) || [])[1] || null, arm: (ARM.exec(line) || [])[1] || null };
}

// A run's arm: the frame's, the logged start's, the commit's, else main.
function armOfRun({ port, start, head = {} }, { starts = [], commits = new Map() } = {}) {
  if (head.arm) return { arm: head.arm, by: 'frame' };
  const logged = starts.filter(s => s.port === port && s.t <= start + 5000 && start - s.t < 120000).at(-1);
  if (logged) return { arm: logged.arm, by: 'start log' };
  if (head.commit && commits.has(head.commit)) return { arm: commits.get(head.commit), by: 'commit' };
  return { arm: 'main', by: 'default' };
}

// What a run's measures need of a frame, and no more (hours of records are gigabytes).
function slim(r) {
  const s = r.snapshot || {}, st = s.decision?.state;
  const blazes = Array.isArray(s.mobs) ? s.mobs.filter(m => m.name === 'blaze').map(m => ({ name: 'blaze', id: m.id, d: m.d, seen: m.seen })) : undefined;
  const pick = o => o && { action: o.action, kind: o.kind, structure: o.structure, found: o.found, position: o.position };
  return { at: Date.parse(r.at), kind: r.kind, detail: r.kind === 'damage' ? r.detail : undefined,
    snapshot: { health: s.health, food: s.food, dimension: s.dimension, position: s.position && { x: s.position.x, y: s.position.y, z: s.position.z },
      mobs: blazes, inventory: s.inventory && typeof s.inventory === 'object' ? { blaze_rod: s.inventory.blaze_rod || 0, blaze_powder: s.inventory.blaze_powder || 0 } : undefined,
      equipment: s.equipment, step: pick(s.step), survivalAction: pick(s.survivalAction),
      decision: st && (st.recentDeaths || st.fortressInView) ? { state: { recentDeaths: st.recentDeaths?.slice(0, 1), fortressInView: st.fortressInView && { nearestBlocksOff: st.fortressInView.nearestBlocksOff } } } : undefined } };
}

// Fortress places a frame names.
function fortressPoints(s) {
  const out = [];
  for (const o of [s.step, s.survivalAction]) {
    if (!o) continue;
    if (o.action === 'find_fortress' && o.found && Number.isFinite(o.found.x)) out.push(o.found);
    if ((o.structure === 'nether_fortress' || o.kind === 'nether_fortress') && o.position && Number.isFinite(o.position.x)) out.push(o.position);
  }
  const fv = s.decision?.state?.fortressInView;
  if (fv && fv.nearestBlocksOff <= 16 && s.position) out.push(s.position);
  return out;
}

// The death's line, said as a cause: "was burned to a crisp (fighting Blaze)".
function causeOf(text) {
  if (!text) return 'unknown';
  const t = String(text).replace(/^Jev /, '').replace(/ using \[.*$/, '').trim();
  const m = t.match(/^(.*?) (?:whilst|while) (?:fighting|trying to escape) (.+)$/);
  return m ? `${m[1]} (fighting ${m[2]})` : t.replace(/ (whilst|while) .*$/, '');
}

// One run's frames (time-ordered) to its measures, within [from, to].
function measureRun(frames, { from = -Infinity, to = Infinity, blaze = require('../blaze-record') } = {}) {
  const m = { botMs: 0, netherMs: 0, fortressMs: 0, sightMs: 0, rods: 0, deaths: [], fights: 0, fightsDied: 0, fights4: 0, fights4Died: 0, first: null, last: null };
  let prevT = null, dim = null, rods = null, pts = [], seenAt = -Infinity, pos = null, hp = null;
  const inWindow = frames.filter(f => f.at >= from && f.at <= to);
  const near = p => pos && pts.some(q => Math.hypot(q.x - p.x, q.z - p.z) <= FORTRESS_RANGE);
  const dimAt = new Map();
  for (const f of inWindow) {
    const s = f.snapshot || {}, t = f.at;
    if (prevT !== null && t >= prevT && t - prevT <= GAP_MS) {
      const dt = t - prevT, nether = dim === 'the_nether', sight = prevT - seenAt <= SIGHT_MS;
      m.botMs += dt;
      if (nether) { m.netherMs += dt; if (sight || near(pos)) m.fortressMs += dt; if (sight) m.sightMs += dt; }
    }
    prevT = t; m.first ??= t; m.last = t;
    if (s.dimension) dim = s.dimension;
    if (s.position) pos = s.position;
    for (const p of fortressPoints(s)) if (!pts.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 8)) pts.push(p);
    if (s.mobs?.some(b => b.seen && b.d <= SIGHT_RANGE)) seenAt = t;
    if (typeof s.health === 'number') { if (s.health === 0 && hp > 0) dimAt.set(t, dim); hp = s.health; }
    if (s.inventory) {
      const n = (s.inventory.blaze_rod || 0) + Math.floor((s.inventory.blaze_powder || 0) / 2);
      if (rods !== null && n > rods) m.rods += n - rods;
      rods = n;
    }
  }
  for (const d of blaze.deaths(frames)) if (d.at >= from && d.at <= to) m.deaths.push({ at: d.at, dimension: dimAt.get(d.at) || null, msg: d.msg });
  // A death blaze-record did not see (no dimension on the frame) is still a death.
  for (const [at, d] of dimAt) if (!m.deaths.some(x => x.at === at)) m.deaths.push({ at, dimension: d, msg: null });
  for (const e of blaze.fights(frames, { from, to })) {
    m.fights++; if (e.died) m.fightsDied++;
    if (e.max16 >= 4) { m.fights4++; if (e.died) m.fights4Died++; }
  }
  return m;
}

// The runs of a flight directory with a frame in [from, to]:
// [{ key, port, start, arm, armBy, commit, ...measures }].
function readRuns(dir, { from = -Infinity, to = Infinity, starts = [], commits = new Map(), progress = null } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch (_) { return []; }
  const byRun = new Map();
  for (const f of names) {
    const start = fileStart(runKey(f));
    if (Number.isFinite(start) && start > to) continue;
    let mtime; try { mtime = fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { continue; }
    if (mtime < from) continue;
    (byRun.get(runKey(f)) || byRun.set(runKey(f), []).get(runKey(f))).push(f);
  }
  const out = [];
  let i = 0;
  for (const [key, files] of byRun) {
    progress?.(++i, byRun.size, key);
    files.sort((a, b) => partOf(a) - partOf(b));
    const port = portOf(key), start = fileStart(key);
    const head = headOf(path.join(dir, files[0]));
    const frames = [];
    for (const f of files) {
      let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        const at = line.lastIndexOf('"at":"'), t = at < 0 ? NaN : Date.parse(line.slice(at + 6, line.indexOf('"', at + 6)));
        // A minute either side: a death's line is read from a later question.
        if (!(t >= from - GAP_MS && t <= to + 5 * GAP_MS)) continue;
        try { frames.push(slim(JSON.parse(line))); } catch (_) { /* a torn line */ }
      }
    }
    frames.sort((a, b) => a.at - b.at);
    const measures = measureRun(frames, { from, to });
    if (measures.first === null) continue;
    const a = armOfRun({ port, start, head }, { starts, commits });
    out.push({ key, port, start, arm: a.arm, armBy: a.by, commit: head.commit || null, ...measures });
  }
  return out;
}

// Deaths with no line in the record, given the server log's (progress-audit
// deathsInLog; the day moved by one either way, as resolveDeaths does).
function serverCauses(deaths, root, { since = 0, read = serverLogDeaths } = {}) {
  const byPort = new Map();
  for (const d of deaths) if (!d.msg && d.port) (byPort.get(d.port) || byPort.set(d.port, []).get(d.port)).push(d);
  for (const [port, list] of byPort) {
    const logged = read(root, port, since);
    for (const d of list) {
      const hit = logged.map(l => ({ l, off: Math.min(...[0, -1, 1].map(k => Math.abs(l.t + k * 86400000 - d.at))) })).filter(x => x.off <= 30000).sort((a, b) => a.off - b.off)[0];
      if (hit) d.msg = hit.l.cause;
    }
  }
}
function serverLogDeaths(root, port, since) {
  const { deathsInLog } = require('../trials/progress-audit');
  const logs = path.join(root, Number(port) === 25581 ? '.clean-run' : `.clean-run-${port}`, 'logs'), out = [];
  let names = [];
  try { names = fs.readdirSync(logs); } catch (_) { return out; }
  for (const f of names) {
    if (!(f.endsWith('.log.gz') || f === 'latest.log')) continue;
    const file = path.join(logs, f);
    try {
      const mt = fs.statSync(file).mtimeMs;
      if (mt < since - 86400000) continue;
      const text = f.endsWith('.gz') ? require('node:zlib').gunzipSync(fs.readFileSync(file)).toString() : fs.readFileSync(file, 'utf8');
      out.push(...deathsInLog(text, f, mt));
    } catch (_) { /* unreadable */ }
  }
  return out;
}

// ---- trials ----------------------------------------------------------------
// A trial's arm: its record's, else the arm of the runs on its port in its
// span; 'mixed' when those runs were on more than one arm (a port switched
// mid-trial), and such a trial is not counted for either.
function trialArm(trial, runs) {
  const mine = runs.filter(r => r.port === trial.port && r.last >= trial.start && r.first <= trial.end);
  const arms = new Set(mine.map(r => r.arm));
  if (arms.size > 1) return 'mixed';
  if (trial.arm) return arms.size === 1 && !arms.has(trial.arm) ? 'mixed' : trial.arm;
  return arms.size === 1 ? [...arms][0] : 'main';
}
const startKind = t => /\/stages\/fortress\//.test(String(t.source || '')) ? 'fortress save' : /\/stages\/nether\//.test(String(t.source || '')) ? 'nether save' : /trial-sources\/first-days-(\d+)/.test(String(t.source || '')) ? `fresh ${String(t.source).match(/first-days-(\d+)/)[1]}` : 'other';

// ---- the comparison ----------------------------------------------------------
function summarize(runs, trials) {
  const by = new Map();
  const arm = name => by.get(name) || by.set(name, { arm: name, runs: 0, ports: new Set(), commits: {}, botMs: 0, netherMs: 0, fortressMs: 0, sightMs: 0, rods: 0,
    deaths: [], fights: 0, fightsDied: 0, fights4: 0, fights4Died: 0, trials: [], armBy: {} }).get(name);
  for (const r of runs) {
    const a = arm(r.arm);
    a.runs++; a.ports.add(r.port); a.commits[r.commit || 'unknown'] = (a.commits[r.commit || 'unknown'] || 0) + 1; a.armBy[r.armBy] = (a.armBy[r.armBy] || 0) + 1;
    for (const k of ['botMs', 'netherMs', 'fortressMs', 'sightMs', 'rods', 'fights', 'fightsDied', 'fights4', 'fights4Died']) a[k] += r[k];
    a.deaths.push(...r.deaths);
  }
  for (const t of trials) arm(t.arm).trials.push(t);
  const H = ms => ms / 3600000;
  return [...by.values()].map(a => {
    const nether = a.deaths.filter(d => d.dimension === 'the_nether'), causes = {};
    for (const d of nether) causes[causeOf(d.msg)] = (causes[causeOf(d.msg)] || 0) + 1;
    const judged = a.trials.filter(t => t.verdict), v = t => t.verdict || {};
    const kinds = {};
    for (const t of a.trials) kinds[startKind(t)] = (kinds[startKind(t)] || 0) + 1;
    return {
      arm: a.arm, runs: a.runs, ports: [...a.ports].filter(Boolean).sort(), commits: a.commits, armBy: a.armBy,
      botHours: H(a.botMs), netherHours: H(a.netherMs), fortressHours: H(a.fortressMs), blazeSightHours: H(a.sightMs),
      deaths: rateOf(a.deaths.length, H(a.botMs)), netherDeaths: rateOf(nether.length, H(a.netherMs)),
      netherDeathsByCause: Object.fromEntries(Object.entries(causes).sort((x, y) => y[1] - x[1]).map(([c, k]) => [c, rateOf(k, H(a.netherMs))])),
      rodsPerFortressHour: rateOf(a.rods, H(a.fortressMs)),
      fights: a.fights, fightDeaths: propOf(a.fightsDied, a.fights), fights4: a.fights4, fights4Share: propOf(a.fights4, a.fights), fights4Deaths: propOf(a.fights4Died, a.fights4),
      trials: a.trials.length, judged: judged.length, starts: kinds,
      passes: propOf(judged.filter(t => v(t).pass).length, judged.length),
      loops: propOf(judged.filter(t => (v(t).reasons || []).some(r => /^loop/.test(r))).length, judged.length),
      stranded: propOf(judged.filter(t => v(t).stranded || (v(t).reasons || []).some(r => /stranded/.test(r))).length, judged.length),
      trialDeaths: propOf(judged.filter(t => (v(t).reasons || []).some(r => /death/.test(r))).length, judged.length),
    };
  }).sort((x, y) => (x.arm === 'main') - (y.arm === 'main') || (x.arm === 'mixed') - (y.arm === 'mixed') || (x.arm < y.arm ? -1 : 1));
}

// main against each other arm, measure by measure.
function compare(rows) {
  const main = rows.find(r => r.arm === 'main'), out = {};
  if (!main) return out;
  for (const o of rows.filter(r => r.arm !== 'main' && r.arm !== 'mixed')) {
    const causes = [...new Set([...Object.keys(main.netherDeathsByCause), ...Object.keys(o.netherDeathsByCause)])];
    const zero = h => ({ k: 0, hours: h });
    out[o.arm] = {
      deaths: rateRatio(main.deaths, o.deaths), netherDeaths: rateRatio(main.netherDeaths, o.netherDeaths),
      netherDeathsByCause: Object.fromEntries(causes.map(c => [c, rateRatio(main.netherDeathsByCause[c] || zero(main.netherHours), o.netherDeathsByCause[c] || zero(o.netherHours))])),
      rodsPerFortressHour: rateRatio(main.rodsPerFortressHour, o.rodsPerFortressHour),
      fightDeaths: { p: fisherP(main.fightDeaths.k, main.fightDeaths.n, o.fightDeaths.k, o.fightDeaths.n) },
      fights4Deaths: { p: fisherP(main.fights4Deaths.k, main.fights4Deaths.n, o.fights4Deaths.k, o.fights4Deaths.n) },
      passes: { p: fisherP(main.passes.k, main.passes.n, o.passes.k, o.passes.n) },
      loops: { p: fisherP(main.loops.k, main.loops.n, o.loops.k, o.loops.n) },
      stranded: { p: fisherP(main.stranded.k, main.stranded.n, o.stranded.k, o.stranded.n) },
    };
  }
  return out;
}

// ---- the table ---------------------------------------------------------------
const r2 = x => x == null || !Number.isFinite(x) ? (x === Infinity ? 'inf' : '-') : x >= 10 ? x.toFixed(1) : x.toFixed(2);
const pc = x => x == null ? '-' : `${Math.round(100 * x)}%`;
const rateSays = r => r.rate == null ? `${r.k} in 0 h` : `${r2(r.rate)} [${r2(r.lo)}-${r2(r.hi)}] (${r.k})`;
const propSays = p => p.n ? `${pc(p.p)} [${pc(p.lo)}-${pc(p.hi)}] (${p.k}/${p.n})` : '- (0)';
const ratioSays = c => !c ? '-' : c.ratio == null ? `p ${c.p.toFixed(2)}` : `x${r2(c.ratio)} [${r2(c.lo)}-${r2(c.hi)}] p ${c.p.toFixed(2)}`;

function table(rows, cmp, { since = null, to = null } = {}) {
  const arms = rows.map(r => r.arm), others = Object.keys(cmp);
  const lines = [], body = [];
  const row = (name, f, c = null) => body.push([name, ...rows.map(f), ...others.map(o => c ? c(cmp[o]) : '')]);
  row('runs (ports)', r => `${r.runs} (${r.ports.length})`);
  row('commits', r => Object.entries(r.commits).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' '));
  row('bot hours', r => r2(r.botHours));
  row('Nether hours', r => r2(r.netherHours));
  row('fortress hours', r => r2(r.fortressHours));
  row('  of which blazes in sight', r => r2(r.blazeSightHours));
  row('deaths / bot hour', r => rateSays(r.deaths), c => ratioSays(c.deaths));
  row('Nether deaths / Nether hour', r => rateSays(r.netherDeaths), c => ratioSays(c.netherDeaths));
  const causes = [...new Set(rows.flatMap(r => Object.keys(r.netherDeathsByCause)))];
  causes.sort((x, y) => rows.reduce((n, r) => n + (r.netherDeathsByCause[y]?.k || 0), 0) - rows.reduce((n, r) => n + (r.netherDeathsByCause[x]?.k || 0), 0));
  for (const k of causes) row(`  ${k}`.slice(0, 56), r => r.netherDeathsByCause[k] ? rateSays(r.netherDeathsByCause[k]) : '0', c => ratioSays(c.netherDeathsByCause[k]));
  row('rods / fortress hour', r => rateSays(r.rodsPerFortressHour), c => ratioSays(c.rodsPerFortressHour));
  row('blaze fights (died)', r => propSays(r.fightDeaths), c => `p ${c.fightDeaths.p.toFixed(2)}`);
  row('fights at 4+ blazes (share)', r => propSays(r.fights4Share));
  row('  died in them', r => propSays(r.fights4Deaths), c => `p ${c.fights4Deaths.p.toFixed(2)}`);
  row('trials begun (judged)', r => `${r.trials} (${r.judged})`);
  row('  starts', r => Object.entries(r.starts).sort().map(([k, n]) => `${k}:${n}`).join(' ') || '-');
  row('  passed', r => propSays(r.passes), c => `p ${c.passes.p.toFixed(2)}`);
  row('  a loop', r => propSays(r.loops), c => `p ${c.loops.p.toFixed(2)}`);
  row('  stranded', r => propSays(r.stranded), c => `p ${c.stranded.p.toFixed(2)}`);
  row('  a death', r => propSays(r.trialDeaths));
  const head = ['measure', ...arms, ...others.map(o => `main vs ${o}`)];
  const width = head.map((h, i) => Math.max(h.length, ...body.map(b => String(b[i]).length)));
  const line = r => r.map((c, i) => String(c).padEnd(width[i])).join('  ').trimEnd();
  lines.push(`Two-arm comparison${since ? ` from ${new Date(since).toISOString()}` : ''}${to && Number.isFinite(to) ? ` to ${new Date(to).toISOString()}` : ''} (note 666).`);
  lines.push('Rates are per hour with a 95% Poisson interval [lo-hi] and the count; shares with a 95% Wilson interval. "main vs" is main\'s rate over the other arm\'s,');
  lines.push('with the ratio\'s 95% interval and the exact two-sided p of no difference (Fisher\'s for shares). An interval that holds 1 is no difference yet.');
  lines.push('Trials are counted by the arm their runs were on; one whose port changed arm mid-trial is "mixed" and counted for neither.', '');
  lines.push(line(head), ...body.map(line));
  return lines.join('\n');
}

module.exports = { poissonCI, rateOf, wilson, propOf, binomialP, rateRatio, fisherP, fileStart, portOf, headOf, armOfRun, slim, fortressPoints, causeOf, measureRun, readRuns,
  serverCauses, serverLogDeaths, trialArm, startKind, summarize, compare, table, GAP_MS };
