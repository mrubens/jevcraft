'use strict';
// Note 666: two-arm trials. The arm a port's bot runs from, the commit and
// arm its flight record carries, the pairing of starts, and the report.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Vec3 } = require('vec3');
const arms = require('../scripts/lib/arms');
const ab = require('../scripts/lib/ab');
const stage = require('../scripts/lib/stage-select');
const { loadedCommit } = require('../src/recorder/commit');
const { Trace } = require('../src/recorder/trace');
const { observeBot } = require('../src/recorder/observer');

const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
// A ROOT with .bot-state, and a baseline checkout beside it linked the way setup links it.
function rootWithBaseline(name = 'baseline-abc1234') {
  const root = tmp('ab-root');
  fs.mkdirSync(path.join(root, '.bot-state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'index.js'), '');
  const co = path.join(root, '.arms', name);
  fs.mkdirSync(co, { recursive: true });
  fs.writeFileSync(path.join(co, 'index.js'), '');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(co, 'node_modules'));
  fs.symlinkSync(path.join(root, '.bot-state'), path.join(co, '.bot-state'));
  return { root, co };
}

// ---- the arm of a port ----
test('note 666: a port with no arm file runs main from ROOT; one naming a linked checkout runs from it', () => {
  const { root, co } = rootWithBaseline();
  assert.deepEqual(arms.armOf(25590, root), { name: 'main', checkout: root });
  arms.setArm(25590, 'baseline-abc1234', { root });
  assert.deepEqual(arms.armOf(25590, root), { name: 'baseline-abc1234', checkout: co });
  assert.equal(fs.readFileSync(path.join(root, '.bot-state', 'arms', '25590'), 'utf8').trim(), 'baseline-abc1234');
  // An absolute path names it too; 'main' takes the file away.
  fs.writeFileSync(path.join(root, '.bot-state', 'arms', '25591'), co + '\n');
  assert.equal(arms.armOf(25591, root).name, 'baseline-abc1234');
  arms.setArm(25590, 'main', { root });
  assert.equal(arms.armOf(25590, root).name, 'main');
  assert.equal(arms.armOf(25592, root).name, 'main');
});

test('note 666: a checkout whose .bot-state is not ROOT\'s is refused, not run as if it were main', () => {
  const { root } = rootWithBaseline();
  const loose = path.join(root, '.arms', 'loose');
  fs.mkdirSync(path.join(loose, '.bot-state'), { recursive: true });
  fs.writeFileSync(path.join(loose, 'index.js'), '');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(loose, 'node_modules'));
  assert.throws(() => arms.setArm(25593, 'loose', { root }), /not a link to/);
  assert.equal(fs.existsSync(path.join(root, '.bot-state', 'arms', '25593')), false);
  fs.mkdirSync(path.join(root, '.bot-state', 'arms'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bot-state', 'arms', '25593'), 'loose\n');
  assert.throws(() => arms.armOf(25593, root), /arm of 25593/);
  assert.throws(() => arms.botSpawn(25593, root, {}), /arm of 25593/);
});

test('note 666: the bot is started on its arm\'s index.js by absolute path, cwd ROOT, JEV_ARM set, and the start logged', () => {
  const { root, co } = rootWithBaseline();
  arms.setArm(25594, 'baseline-abc1234', { root });
  const s = arms.botSpawn(25594, root, { PATH: '/bin' });
  assert.deepEqual(s.args, [path.join(co, 'index.js')]);
  assert.equal(s.options.cwd, root);
  assert.equal(s.options.env.JEV_ARM, 'baseline-abc1234');
  assert.equal(s.options.env.MC_PORT, '25594');
  assert.equal(s.options.env.RECOVERY_ADVISER, 'jev');
  const calls = [];
  const out = path.join(root, 'bot.log');
  const r = arms.launch(25594, out, { root, env: {}, run: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 4242, unref() {} }; }, commit: () => 'abc1234' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], path.join(co, 'index.js'));
  assert.equal(r.commit, 'abc1234');
  const [start] = arms.readStarts(root);
  assert.equal(start.port, 25594); assert.equal(start.arm, 'baseline-abc1234'); assert.equal(start.commit, 'abc1234'); assert.equal(start.pid, 4242); assert.equal(start.checkout, co);
  // main's bot is started from ROOT's own index.js.
  arms.launch(25595, out, { root, env: {}, run: (cmd, args) => { calls.push({ args }); return { pid: 1 }; }, commit: () => 'fff0000' });
  assert.equal(calls[1].args[0], path.join(root, 'index.js'));
  assert.equal(arms.readStarts(root)[1].arm, 'main');
});

// ---- the commit and arm in the flight record ----
test('note 666: a baseline worktree reports its own commit, not main\'s', () => {
  const repo = tmp('ab-repo');
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a'), '1'); git('add', 'a'); git('commit', '-qm', 'one');
  const first = git('rev-parse', '--short', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a'), '2'); git('commit', '-qam', 'two');
  const second = git('rev-parse', '--short', 'HEAD');
  const wt = path.join(repo, '.arms', 'baseline');
  git('worktree', 'add', '-q', '--detach', wt, first);
  assert.notEqual(first, second);
  assert.equal(loadedCommit(wt), first);
  assert.equal(loadedCommit(repo), second);
  assert.equal(arms.commitOf(wt), first);
  assert.equal(arms.armCommits(repo).get(first), 'baseline');
});

test('note 666: the connection frame carries the arm the bot was started on', () => {
  const b = new EventEmitter(); b.username = 'TestJev'; b.entity = { id: 1, position: new Vec3(2, 64, 3), yaw: 0, pitch: 0 };
  b.entities = { 1: b.entity }; b.health = 20; b.food = 20; b.game = { dimension: 'overworld' };
  b.inventory = { items: () => [] }; b.blockAt = () => null;
  const trace = new Trace();
  observeBot(trace, b, { getGoal: () => ({}), commit: 'feed123', arm: 'baseline-3c1af18' });
  b.emit('spawn');
  const frame = trace.frames.find(f => f.kind === 'connection');
  assert.equal(frame.detail.commit, 'feed123');
  assert.equal(frame.detail.arm, 'baseline-3c1af18');
  const bare = new Trace();
  observeBot(bare, b, { getGoal: () => ({}), commit: 'feed123', arm: null });
  b.emit('spawn');
  assert.equal(bare.frames.find(f => f.kind === 'connection').detail.arm, undefined);
});

test('note 666: a run\'s arm is the frame\'s, else the start logged just before it, else its commit\'s checkout, else main', () => {
  const starts = [{ t: 1000, port: 25590, arm: 'baseline-x' }, { t: 500000, port: 25590, arm: 'main' }];
  const commits = new Map([['3c1af18', 'baseline-x']]);
  assert.deepEqual(ab.armOfRun({ port: 25590, start: 2000, head: { arm: 'main' } }, { starts, commits }), { arm: 'main', by: 'frame' });
  assert.deepEqual(ab.armOfRun({ port: 25590, start: 2000, head: {} }, { starts, commits }), { arm: 'baseline-x', by: 'start log' });
  assert.deepEqual(ab.armOfRun({ port: 25591, start: 2000, head: {} }, { starts, commits }), { arm: 'main', by: 'default' });
  assert.deepEqual(ab.armOfRun({ port: 25590, start: 300000, head: { commit: '3c1af18' } }, { starts, commits }), { arm: 'baseline-x', by: 'commit' });
});

// ---- pairing ----
test('note 666: each start on one arm is owed once by the other, oldest first, within six hours', () => {
  const h = 3600000, now = 10 * h;
  const starts = [
    { t: now - 3 * h, key: 's1', arm: 'baseline' }, { t: now - 2 * h, key: 's1', arm: 'main' },   // paired
    { t: now - 1 * h, key: 's2', arm: 'baseline' },                                                 // main owes s2
    { t: now - 2.5 * h, key: 's3', arm: 'baseline' }, { t: now - 0.5 * h, key: 's3', arm: 'baseline' }, { t: now - 0.4 * h, key: 's3', arm: 'main' },  // main owes s3 once
    { t: now - 7 * h, key: 's4', arm: 'baseline' },                                                 // too old
  ];
  assert.deepEqual(arms.owed(starts, 'main', { now }).map(o => [o.key, (now - o.since) / h]), [['s2', 1], ['s3', 0.5]]);
  assert.deepEqual(arms.owed(starts, 'baseline', { now }), []);
});

test('note 666: a stage start takes the save the other arm started and this one has not; a save on a span is passed over', () => {
  const root = tmp('ab-stage');
  fs.mkdirSync(path.join(root, '.trial-checkpoints'), { recursive: true });
  const now = Date.now(), iso = t => new Date(t).toISOString();
  fs.writeFileSync(path.join(root, '.trial-checkpoints', 'stage-starts.log'), [
    `${iso(now - 600000)}\tfortress\tmid-242-ba-100000`,                          // before the arms: not paired
    `${iso(now - 500000)}\tfortress\tmid-243-bb-110000\tbaseline\tfortress`,
    `${iso(now - 400000)}\tnether\tmid-244-cc-120000\tbaseline\tfortress`,         // a fortress start that fell back
  ].join('\n') + '\n');
  const snap = (name, st) => ({ name, stage: st, dir: `/x/${name}`, source: stage.sourceWorld(name), started: 5, last: 0, recent: 0, vitals: { health: 20, hunger: 20, foodPoints: 60 }, spot: null });
  const stages = { fortress: [snap('mid-242-ba-100000', 'fortress'), snap('mid-243-bb-110000', 'fortress'), snap('mid-245-dd-130000', 'fortress')], nether: [snap('mid-244-cc-120000', 'nether')] };
  const owedKeys = arms.owed(stage.pairingStarts(root), 'main');
  assert.deepEqual(owedKeys.map(o => o.key), ['fortress|fortress/mid-243-bb-110000', 'fortress|nether/mid-244-cc-120000']);
  const pick = stage.choose(stages, 'fortress', { owedKeys });
  assert.equal(pick.rule, 'pair'); assert.equal(pick.snapshot.name, 'mid-243-bb-110000');
  // That save gone: the next owed, the nether save the fortress start fell back to.
  const later = stage.choose({ ...stages, fortress: stages.fortress.filter(s => s.name !== 'mid-243-bb-110000') }, 'fortress', { owedKeys });
  assert.equal(later.stage, 'nether'); assert.equal(later.snapshot.name, 'mid-244-cc-120000');
  // A nether start is not paired with a fortress start's saves; the baseline owes nothing.
  assert.notEqual(stage.choose(stages, 'nether', { owedKeys }).rule, 'pair');
  assert.deepEqual(arms.owed(stage.pairingStarts(root), 'baseline'), []);
  // A save whose player stands on a span over lava is not a start, owed or not.
  const spanned = { ...stages, fortress: stages.fortress.map(s => s.name === 'mid-243-bb-110000' ? { ...s, spot: { deadly: true, over: 'lava', ring: 3, dropBlocks: 10 } } : s) };
  const p2 = stage.choose(spanned, 'fortress', { owedKeys });
  assert.equal(p2.rule, 'pair'); assert.equal(p2.snapshot.name, 'mid-244-cc-120000');
});

test('note 666: fresh starts are paired by source number from the trial records', () => {
  const root = tmp('ab-fresh');
  const dir = path.join(root, 'artifacts', 'midgame');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const rec = (world, src, arm, ago) => fs.writeFileSync(path.join(dir, `${world}.json`), JSON.stringify({ world, source: `.trial-sources/first-days-${src}`, arm, startedAt: new Date(now - ago).toISOString() }));
  rec('mid-242-a', 242, 'baseline', 300000); rec('mid-242-b', 242, 'main', 200000); rec('mid-243-a', 243, 'baseline', 100000);
  fs.writeFileSync(path.join(dir, 'mid-244-a.json'), JSON.stringify({ world: 'mid-244-a', source: '.trial-checkpoints/stages/fortress/x/world', arm: 'baseline', startedAt: new Date(now).toISOString() }));
  assert.deepEqual(arms.owed(arms.freshStarts(root), 'main').map(o => o.key), ['243']);
  assert.deepEqual(arms.owed(arms.freshStarts(root), 'baseline'), []);
});

// ---- the report ----
const T0 = Date.parse('2026-09-29T12:00:00Z');
const at = s => new Date(T0 + s * 1000).toISOString();
const frame = (s, snapshot, kind = 'observation', detail) => JSON.stringify({ kind, snapshot, ...(detail ? { detail } : {}), id: 1, at: at(s) });
const nether = (s, { hp = 20, rods = 0, blazes = [], pos = { x: 0, y: 70, z: 0 }, step } = {}) => frame(s, { position: pos, dimension: 'the_nether', health: hp, food: 20,
  inventory: { blaze_rod: rods }, mobs: blazes.map((d, i) => ({ name: 'blaze', id: i + 1, d, seen: true, at: { x: d, y: 70, z: 0 } })), ...(step ? { step } : {}) });
const over = s => frame(s, { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, food: 20 });

// Baseline (arm in its frame): 20 minutes in the Nether, at a fortress, one
// rod, a fight at four blazes that killed it. Main (arm from the start log):
// 10 minutes overworld, 30 in the Nether away from any fortress, no death.
function fixture() {
  const root = tmp('ab-report');
  const dir = path.join(root, '.bot-state', 'flight');
  fs.mkdirSync(dir, { recursive: true });
  const b = [frame(0, { position: { x: 0, y: 70, z: 0 }, dimension: 'the_nether', health: 20 }, 'connection', { connected: true, commit: '3c1af18', arm: 'baseline-3c1af18' })];
  for (let s = 10; s <= 1200; s += 10) b.push(nether(s, { rods: s >= 600 ? 1 : 0, step: s === 10 ? { action: 'find_fortress', found: { x: 5, y: 70, z: 5 } } : undefined }));
  for (let s = 1205; s <= 1230; s += 5) b.push(nether(s, { blazes: [5, 6, 7, 8], hp: s === 1230 ? 0 : 20 - (s - 1200) / 2 }));
  b.push(frame(1240, { position: { x: 0, y: 70, z: 0 }, dimension: 'the_nether', health: 20, decision: { id: 'x', state: { recentDeaths: [{ minutesAgo: 0, cause: 'was fireballed by Blaze' }] } } }, 'decision'));
  fs.writeFileSync(path.join(dir, `127_0_0_1-25590-Jev-${at(0).replace(/:/g, '-').replace('.', '-')}.jsonl`), b.join('\n') + '\n');
  const m = [frame(0, { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20 }, 'connection', { connected: true, commit: 'bb91b3d' })];
  for (let s = 10; s <= 600; s += 10) m.push(over(s));
  for (let s = 610; s <= 2400; s += 10) m.push(nether(s, { pos: { x: 500, y: 70, z: 500 } }));
  fs.writeFileSync(path.join(dir, `127_0_0_1-25591-Jev-${at(0).replace(/:/g, '-').replace('.', '-')}.jsonl`), m.join('\n') + '\n');
  fs.mkdirSync(path.join(root, '.bot-state', 'arms'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bot-state', 'arms', 'starts.log'), `${at(-1)}\t25591\tmain\tbb91b3d\t1\t${root}\n`);
  return { root, dir };
}

test('note 666: the report measures each arm the same way from its runs', () => {
  const { root, dir } = fixture();
  const runs = ab.readRuns(dir, { from: T0 - 60000, to: T0 + 3600000, starts: arms.readStarts(root) });
  const byArm = Object.fromEntries(runs.map(r => [r.arm, r]));
  assert.equal(byArm['baseline-3c1af18'].armBy, 'frame');
  assert.equal(byArm['baseline-3c1af18'].commit, '3c1af18');
  assert.equal(byArm.main.armBy, 'start log');
  const rows = ab.summarize(runs, []);
  assert.deepEqual(rows.map(r => r.arm), ['baseline-3c1af18', 'main']);
  const [base, main] = rows;
  assert.ok(Math.abs(base.netherHours - 1240 / 3600) < 0.01, `baseline Nether hours ${base.netherHours}`);
  assert.ok(Math.abs(base.fortressHours - base.netherHours) < 0.01, 'the baseline stood by its fortress throughout');
  assert.equal(base.netherDeaths.k, 1);
  assert.deepEqual(Object.keys(base.netherDeathsByCause), ['was fireballed by Blaze']);
  assert.equal(base.rodsPerFortressHour.k, 1);
  assert.equal(base.fights4, 1); assert.equal(base.fights4Deaths.k, 1);
  assert.ok(Math.abs(main.netherHours - 1800 / 3600) < 0.01, `main Nether hours ${main.netherHours}`);
  assert.equal(main.fortressHours, 0);
  assert.equal(main.netherDeaths.k, 0);
  assert.ok(Math.abs(main.botHours - 2400 / 3600) < 0.01);
  const cmp = ab.compare(rows);
  assert.ok(cmp['baseline-3c1af18'].netherDeaths.p > 0.3, 'one death against none is no difference');
  const text = ab.table(rows, cmp, { since: T0 });
  assert.match(text, /Nether deaths \/ Nether hour\s+2\.90 \[/);
  assert.match(text, /main vs baseline-3c1af18/);
});

test('note 666: a trial is counted for the arm its runs were on, or as mixed', () => {
  const runs = [{ port: 25590, arm: 'baseline', first: 0, last: 100 }, { port: 25590, arm: 'main', first: 200, last: 300 }, { port: 25591, arm: 'main', first: 0, last: 300 }];
  assert.equal(ab.trialArm({ port: 25590, start: 0, end: 150, arm: 'baseline' }, runs), 'baseline');
  assert.equal(ab.trialArm({ port: 25590, start: 0, end: 300 }, runs), 'mixed');
  assert.equal(ab.trialArm({ port: 25591, start: 0, end: 300 }, runs), 'main');
  assert.equal(ab.trialArm({ port: 25591, start: 0, end: 300, arm: 'baseline' }, runs), 'mixed');
  const trials = [{ arm: 'main', source: '.trial-checkpoints/stages/fortress/a/world', verdict: { pass: false, reasons: ['1 death(s)', 'loop: 3× x'] } },
    { arm: 'main', source: '.trial-sources/first-days-242', verdict: { pass: false, reasons: [], stranded: { says: 'stranded' } } }, { arm: 'main', source: 'x' }];
  const [row] = ab.summarize([], trials);
  assert.equal(row.trials, 3); assert.equal(row.judged, 2);
  assert.equal(row.loops.k, 1); assert.equal(row.stranded.k, 1); assert.equal(row.trialDeaths.k, 1);
  assert.deepEqual(row.starts, { 'fortress save': 1, 'fresh 242': 1, other: 1 });
});

test('note 666: the intervals and tests say the noise', () => {
  const [lo0, hi0] = ab.poissonCI(0);
  assert.equal(lo0, 0); assert.ok(Math.abs(hi0 - 3.69) < 0.05);
  const [lo10, hi10] = ab.poissonCI(10);
  assert.ok(Math.abs(lo10 - 4.80) < 0.1 && Math.abs(hi10 - 18.39) < 0.2, `${lo10} ${hi10}`);
  // 20 deaths in 10 h against 20 in 10 h: ratio 1, p 1; 40 against 10 over equal hours: clearly apart.
  const same = ab.rateRatio({ k: 20, hours: 10 }, { k: 20, hours: 10 });
  assert.ok(Math.abs(same.ratio - 1) < 1e-9 && same.p > 0.99 && same.lo < 1 && same.hi > 1);
  const apart = ab.rateRatio({ k: 40, hours: 10 }, { k: 10, hours: 10 });
  assert.ok(Math.abs(apart.ratio - 4) < 1e-9 && apart.lo > 1 && apart.p < 0.001, JSON.stringify(apart));
  // Fisher's exact on the tea-tasting table (3/4 against 1/4): p 0.486.
  assert.ok(Math.abs(ab.fisherP(3, 4, 1, 4) - 0.486) < 0.01);
  assert.ok(Math.abs(ab.binomialP(5, 10, 0.5) - 1) < 1e-9);
  assert.equal(ab.causeOf('was burned to a crisp while fighting Blaze'), 'was burned to a crisp (fighting Blaze)');
  assert.equal(ab.causeOf('Jev was slain by Piglin using [Golden Sword]'), 'was slain by Piglin');
  assert.equal(ab.causeOf(null), 'unknown');
});
