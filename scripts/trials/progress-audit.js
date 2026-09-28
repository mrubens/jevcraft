'use strict';
// Is each running midgame trial getting anywhere? The watcher (watch.sh)
// stops only for a death or a loop, and a bot that is busy but going nowhere
// is neither: mid-242-aa-nether-1-fortress-1 walked back and forth at a
// fortress and dug at random for over seventy minutes, 81 patrol passes,
// no stretch reached and no blaze seen, and only a person watching caught it
// (2026-09-27). This reads the last minutes of each trial's flight record
// and bot log and says, per trial: where it is, what it spent the time on,
// what ground it covered, what it kept asking, and a plain verdict with the
// flags it raised, each flag said with its threshold.
//   node scripts/trials/progress-audit.js [auto | port ...] [--minutes 15] [--history 60] [--json]
// auto (the default) finds the running midgame servers as watch.sh does.
// JEV_ROOT reads another checkout's servers and records (from a worktree).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..', '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const CELL = 4;

// What raises a flag, said as what it is so a reader can judge it.
function thresholds(minutes, history) {
  return {
    newGround: { share: 0.10, says: `under 10% of the ${CELL}×${CELL} columns it stood in over the last ${minutes} min were new (not stood in during the ${history} min before)` },
    pacing: { walked: 150, net: 16, says: `walked 150+ blocks in ${minutes} min and ended under 16 blocks from where it began` },
    digging: { dug: 48, share: 0.25, says: `48+ ground blocks (stone, netherrack, dirt, bricks…) gained in ${minutes} min with under 25% new ground` },
    oneThing: { share: 0.8, says: `one step or rung took 80%+ of the clocked minutes (at least two thirds of the ${minutes} min clocked)` },
    milestone: { minutes: 45, says: 'no milestone (the bot\'s own or the midgame verdict\'s) for 45+ min' },
    sameAnswer: { count: Math.max(10, minutes), share: 2 / 3, says: `one question given the same answer ${Math.max(10, minutes)}+ times in ${minutes} min, two thirds or more of its answers` },
    noneGood: { share: 0.2, min: 5, says: '"none of these is good" in 20%+ of Jev\'s answers (at least 5 answers)' },
    fortress: { minutes: 10, share: 0.25, says: 'at a fortress 10+ min with under 25% new ground, or its last pass reaching under half its stretches' },
    silent: { minutes: 3, says: 'no flight frame for 3+ min (bot down or stalled)' },
  };
}

const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };

// The frames of the window, parsed, and the positions of the history before
// it, from observation lines alone (they are small; the full snapshots with
// their terrain are what makes a file megabytes). Only the files that can
// hold either are read: a file's frames run from its name's time to the next
// file's.
function readFlight({ identity, from, to, historyFrom, dir = FLIGHT }) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return { frames: [], history: [] }; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f, start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  const frames = [], history = [];
  files.forEach(({ f, start }, i) => {
    const next = files[i + 1]?.start ?? Infinity;
    if (next < historyFrom || start > to) return;
    let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { return; }
    if (next < from) {
      // History only: observation lines, found without splitting the file.
      for (let i = text.indexOf('{"kind":"observation"'); i >= 0; i = text.indexOf('{"kind":"observation"', i + 1)) {
        const end = text.indexOf('\n', i), line = text.slice(i, end < 0 ? undefined : end);
        const t = frameAt(line);
        if (!(t >= historyFrom && t < from)) continue;
        try { const s = JSON.parse(line).snapshot; if (s?.position) history.push({ t, position: s.position, dimension: s.dimension }); } catch (_) {}
      }
      return;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const t = frameAt(line);
      if (!(t >= historyFrom && t <= to)) continue;
      if (t < from) {
        if (!line.startsWith('{"kind":"observation"')) continue;
        try { const s = JSON.parse(line).snapshot; if (s?.position) history.push({ t, position: s.position, dimension: s.dimension }); } catch (_) {}
        continue;
      }
      try { frames.push({ ...JSON.parse(line), t }); } catch (_) {}
    }
  });
  frames.sort((a, b) => a.t - b.t);
  return { frames, history };
}

// The bot log has no times of its own; the times inside its lines (a step's
// or a decision's "at") place it. Read back from its end until a line wholly
// before the window, then count the lines that say the bot is stuck or
// unhappy with what it was offered.
function readBotLog(file, from, { chunk = 2 << 20, cap = 48 << 20 } = {}) {
  const out = { read: false, missingOption: {}, stall: 0, still: 0, bug: 0 };
  let fd; try { fd = fs.openSync(file, 'r'); } catch (_) { return out; }
  try {
    const size = fs.fstatSync(fd).size;
    let pos = size, text = '', reachedStart = false;
    while (pos > 0 && size - pos < cap) {
      const n = Math.min(chunk, pos); pos -= n;
      const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, pos);
      text = buf.toString('utf8') + text;
      const times = [...text.slice(0, Math.min(text.length, chunk)).matchAll(/"(?:at|askedAt)":"(\d{4}-\d\d-\d\dT[\d:.]+Z)"/g)].map(m => Date.parse(m[1]));
      if (times.length && Math.max(...times) < from) { reachedStart = true; break; }
    }
    // Keep only the lines after the last one stamped before the window.
    const lines = text.split('\n');
    let begin = 0;
    lines.forEach((l, i) => { const ts = [...l.matchAll(/"(?:at|askedAt)":"(\d{4}-\d\d-\d\dT[\d:.]+Z)"/g)].map(m => Date.parse(m[1])); if (ts.length && Math.max(...ts) < from) begin = i + 1; });
    for (const l of lines.slice(begin)) {
      const m = l.match(/^\[missing option\] ([a-z_]+):/);
      if (m) out.missingOption[m[1]] = (out.missingOption[m[1]] || 0) + 1;
      else if (l.startsWith('[stall]')) out.stall++;
      else if (l.startsWith('[still]')) out.still++;
      else if (l.startsWith('[bug]')) out.bug++;
    }
    out.read = true; out.coversWindow = reachedStart;
  } finally { fs.closeSync(fd); }
  return out;
}

// Ground blocks: what digging through the world brings in and spans and
// pillars spend. Only these: every block item counted crafting too (a log
// into four planks read as four blocks dug).
const GROUND = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|rooted_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|smooth_basalt|blackstone|sand|red_sand|sandstone|soul_sand|soul_soil|end_stone|nether_bricks|magma_block|glowstone|crimson_nylium|warped_nylium|clay|mud)$/;
const isBlockItem = name => GROUND.test(name);

const cellOf = (p, dim) => `${String(dim || '?').replace(/^minecraft:/, '')}:${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const human = s => String(s).replaceAll('_', ' ');
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

// Everything the verdict is made of, from the parsed frames.
function measure({ frames, history, from, to, trial = {}, botLog = null, minutes, historyMinutes }) {
  const T = thresholds(minutes, historyMinutes);
  const positioned = frames.filter(f => f.snapshot?.position);
  const last = positioned.at(-1)?.snapshot || {};
  const lastT = frames.at(-1)?.t ?? null;
  const goals = frames.filter(f => f.snapshot?.goal?.gameProgress);
  const progress = goals.at(-1)?.snapshot.goal.gameProgress || null;

  // Milestones: the bot's own (gameProgress), the midgame verdict's as its
  // record last saved them, and what the window's frames show.
  const milestones = {};
  for (const [k, m] of Object.entries(progress?.milestones || {})) if (Number.isFinite(m?.at)) milestones[k] = m.at;
  const started = Date.parse(trial.startedAt);
  for (const [k, min] of Object.entries(trial.verdict?.reachedAtMinute || {})) if (Number.isFinite(started)) milestones[`midgame ${k}`] = Math.min(milestones[`midgame ${k}`] ?? Infinity, started + min * 60000);
  // The window's own frames add one the record has not saved yet, but not
  // one already there at the window's start: that was reached before it.
  try {
    const { reached } = require('../midgame');
    for (const [k, t] of Object.entries(reached(frames).at)) if (!(`midgame ${k}` in milestones) && t - frames[0].t > 60000) milestones[`midgame ${k}`] = t;
  } catch (_) {}
  const latest = Object.entries(milestones).sort((a, b) => b[1] - a[1])[0] || null;
  const sinceMilestone = latest ? (to - latest[1]) / 60000 : Number.isFinite(started) ? (to - started) / 60000 : null;

  // Time by step or rung: the run clock's own last half hour, cut to the
  // window; the observations' step when there is no clock.
  const doing = {};
  const recent = progress?.clock?.recent;
  if (Array.isArray(recent) && recent.length) {
    for (const [t, what, dt] of recent) if (t >= from && t <= to) doing[what] = (doing[what] || 0) + dt;
  } else {
    const obs = positioned.filter(f => f.kind === 'observation');
    for (let i = 0; i + 1 < obs.length; i++) {
      const s = obs[i].snapshot, what = s.step?.action || s.goal?.step?.action || 'no step';
      doing[what] = (doing[what] || 0) + Math.min(obs[i + 1].t - obs[i].t, 5000);
    }
  }
  const clocked = Object.values(doing).reduce((a, b) => a + b, 0) / 60000;
  const byDoing = Object.entries(doing).sort((a, b) => b[1] - a[1]).map(([k, ms]) => [k, round(ms / 60000, 1)]);
  const top = byDoing[0] || null;

  // Ground: columns stood in, new against the history; walked against net.
  const before = new Set(history.map(h => cellOf(h.position, h.dimension)));
  const cells = new Set(positioned.map(f => cellOf(f.snapshot.position, f.snapshot.dimension)));
  const fresh = [...cells].filter(c => !before.has(c)).length;
  let walked = 0, far = 0;
  for (let i = 1; i < positioned.length; i++) {
    const a = positioned[i - 1].snapshot, b = positioned[i].snapshot;
    if (a.dimension === b.dimension) { const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z); if (d < 20) walked += d; }
  }
  const first = positioned[0]?.snapshot;
  for (const f of positioned) if (f.snapshot.dimension === first.dimension) far = Math.max(far, flat(f.snapshot.position, first.position));
  const net = first && last.position && first.dimension === last.dimension ? flat(first.position, last.position) : null;

  // Blocks dug and laid, from the block items carried frame to frame.
  let dug = 0, laid = 0, prev = null;
  for (const f of frames) {
    const inv = f.snapshot?.inventory;
    if (!inv || typeof inv !== 'object') continue;
    if (prev) for (const k of new Set([...Object.keys(prev), ...Object.keys(inv)])) {
      if (!isBlockItem(k)) continue;
      const d = (+inv[k] || 0) - (+prev[k] || 0);
      if (d > 0) dug += d; else laid -= d;
    }
    prev = inv;
  }

  // What it asked: each decision once, by its id and time.
  const seen = new Set(), questions = {};
  let answered = 0, noneGood = 0, fortress = null, fortressAt = null;
  for (const f of frames.filter(f => f.kind === 'decision')) {
    const d = f.snapshot?.decision;
    if (!d?.id || d.stale) continue;
    const key = `${d.id}@${d.at || f.t}`;
    if (seen.has(key)) continue; seen.add(key);
    const q = questions[d.id] ||= { count: 0, answers: {}, noneGood: 0, byJev: 0 };
    const answer = (d.path || []).join('/') || '?';
    q.count++; q.answers[answer] = (q.answers[answer] || 0) + 1;
    if (d.judgments?.length) { q.byJev++; answered++; }
    if (d.noneGood) { q.noneGood++; noneGood++; }
    if (d.state?.fortressInView) { fortress = d.state.fortressInView; fortressAt = f.t; }
  }
  const repeats = Object.entries(questions).map(([id, q]) => {
    const [answer, n] = Object.entries(q.answers).sort((a, b) => b[1] - a[1])[0];
    return { id, count: q.count, answer, same: n, byJev: q.byJev, noneGood: q.noneGood };
  }).sort((a, b) => b.same - a.same);

  // Blazes in sight in the window, by entity.
  const blazes = new Set();
  for (const f of frames) for (const m of f.snapshot?.mobs || []) if (m.name === 'blaze') blazes.add(m.id);

  const deaths = [];
  let health = null;
  for (const f of frames) { const h = f.snapshot?.health; if (typeof h !== 'number') continue; if (health !== null && h <= 0 && health > 0) deaths.push(f.t); health = h; }

  const m = {
    dimension: String(last.dimension || '?').replace(/^minecraft:/, '').replace(/^the_/, ''),
    phase: progress?.phase || null,
    lastMilestone: latest ? { name: latest[0], minutesAgo: round((to - latest[1]) / 60000) } : null,
    minutesSinceMilestone: sinceMilestone === null ? null : round(sinceMilestone),
    trialMinutes: Number.isFinite(started) ? round((to - started) / 60000) : null,
    lastFrameMinutesAgo: lastT === null ? null : round((to - lastT) / 60000, 1),
    clockedMinutes: round(clocked, 1), byDoing: byDoing.slice(0, 6), top,
    ground: { cells: cells.size, newCells: fresh, newShare: cells.size ? round(fresh / cells.size, 2) : null, walked: Math.round(walked), net: net === null ? null : Math.round(net), farthest: Math.round(far), dug, laid },
    fortress: fortress && { ...fortress, minutesAgo: round((to - fortressAt) / 60000, 1) },
    blazesInSight: blazes.size,
    questions: { asked: seen.size, byJev: answered, noneGood, noneGoodShare: answered ? round(noneGood / answered, 2) : null, top: repeats.slice(0, 5) },
    botLog, deaths: deaths.length,
  };
  m.flags = flag(m, T, minutes);
  m.verdict = verdictOf(m, minutes);
  return m;
}

function flag(m, T, minutes) {
  const flags = [], g = m.ground, pct = x => `${Math.round(x * 100)}%`;
  const say = (id, text) => flags.push({ id, text, threshold: T[id].says });
  if (m.lastFrameMinutesAgo !== null && m.lastFrameMinutesAgo >= T.silent.minutes) say('silent', `no frame for ${Math.round(m.lastFrameMinutesAgo)} min`);
  if (m.fortress && m.fortress.minutesThere >= T.fortress.minutes) {
    const lp = m.fortress.lastPass, poorPass = lp?.stretches && lp.reached * 2 < lp.stretches;
    if ((g.newShare !== null && g.newShare < T.fortress.share) || poorPass)
      say('fortress', `at the fortress ${m.fortress.minutesThere} min${m.fortress.minutesAgo >= 2 ? ` (as of ${Math.round(m.fortress.minutesAgo)} min ago)` : ''}, ${m.fortress.passes} passes${lp?.stretches ? `, ${lp.reached} of ${lp.stretches} stretches reached` : ''}, blazes seen near it ${m.fortress.blazesSeenNear}, revisiting ${pct(1 - (g.newShare ?? 0))} of columns — ${(g.newShare ?? 0) < T.fortress.share ? 'not exploring' : 'its passes not reaching its stretches'}`);
  }
  if (g.cells && g.newShare < T.newGround.share) say('newGround', `no new ground: ${g.newCells} of ${g.cells} columns new in ${minutes} min`);
  if (g.walked >= T.pacing.walked && g.net !== null && g.net < T.pacing.net) say('pacing', `walked ${g.walked} blocks, ended ${g.net} from where it began (never over ${g.farthest} away)`);
  if (g.dug >= T.digging.dug && (g.newShare ?? 0) < T.digging.share) say('digging', `dug about ${g.dug} blocks (laid ${g.laid}) with ${pct(g.newShare ?? 0)} new ground`);
  if (m.top && m.clockedMinutes >= minutes * 2 / 3 && m.top[1] >= T.oneThing.share * m.clockedMinutes) say('oneThing', `${human(m.top[0])} ${Math.round(m.top[1])} of the last ${Math.round(m.clockedMinutes)} min`);
  if (m.minutesSinceMilestone !== null && m.minutesSinceMilestone >= T.milestone.minutes) say('milestone', `no milestone for ${Math.round(m.minutesSinceMilestone)} min${m.lastMilestone ? ` (last: ${human(m.lastMilestone.name)})` : ''}`);
  for (const r of m.questions.top) if (r.same >= T.sameAnswer.count && r.same >= T.sameAnswer.share * r.count) say('sameAnswer', `${r.id} ${r.count}× (${r.same}× ${r.answer}${r.byJev ? '' : ', no choice offered'})`);
  if (m.questions.byJev >= T.noneGood.min && m.questions.noneGoodShare >= T.noneGood.share) say('noneGood', `none good in ${m.questions.noneGood} of ${m.questions.byJev} answers`);
  return flags;
}

function verdictOf(m, minutes) {
  if (!m.flags.length) return `moving: ${m.top ? `${human(m.top[0])} ${Math.round(m.top[1])} min, ` : ''}${m.ground.newShare === null ? 'no positions' : `${Math.round(m.ground.newShare * 100)}% new ground`}${m.lastMilestone ? `, last milestone ${m.lastMilestone.minutesAgo} min ago` : ''}`;
  return m.flags.map(f => f.text).join('; ');
}

// The running midgame trials, as watch.sh auto finds them.
function runningPorts() {
  const out = [];
  for (const d of fs.readdirSync(ROOT).filter(d => /^\.clean-run(-\d+)?$/.test(d))) {
    let props; try { props = fs.readFileSync(path.join(ROOT, d, 'server.properties'), 'utf8'); } catch (_) { continue; }
    const world = props.match(/^level-name=(.*)$/m)?.[1], port = Number(props.match(/^server-port=(\d+)/m)?.[1]);
    if (!/^mid-/.test(world || '') || !port) continue;
    try { execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { continue; }
    out.push({ port, world });
  }
  return out.sort((a, b) => a.port - b.port);
}
function worldOn(port) {
  try { return fs.readFileSync(path.join(ROOT, port === 25581 ? '.clean-run' : `.clean-run-${port}`, 'server.properties'), 'utf8').match(/^level-name=(.*)$/m)[1]; } catch (_) { return null; }
}

function auditTrial({ port, world }, { minutes, historyMinutes, now = Date.now() }) {
  let trial = {};
  try { trial = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'midgame', `${world}.json`), 'utf8')); } catch (_) {}
  const started = Date.parse(trial.startedAt);
  const to = now, from = Math.max(now - minutes * 60000, Number.isFinite(started) ? started : 0);
  const historyFrom = Math.max(from - historyMinutes * 60000, Number.isFinite(started) ? started : 0);
  const { frames, history } = readFlight({ identity: `127_0_0_1-${port}-Jev`, from, to, historyFrom });
  const botLog = readBotLog(path.join(ROOT, 'artifacts', `midgame-${world}.log`), from);
  // The minutes asked for, not the trial's so far: a trial five minutes old
  // has not spent "80% of the window" on anything.
  return { port, world, ...measure({ frames, history, from, to, trial, botLog, minutes, historyMinutes }) };
}

function table(rows, minutes, historyMinutes) {
  const T = thresholds(minutes, historyMinutes);
  const cols = [['port', r => r.port], ['world', r => r.world], ['dim', r => r.dimension], ['last milestone', r => r.lastMilestone ? `${human(r.lastMilestone.name).replace(/^midgame /, '')} ${r.lastMilestone.minutesAgo}m ago` : '-'],
    ['top step (min)', r => r.top ? `${human(r.top[0]).slice(0, 34)} ${Math.round(r.top[1])}/${Math.round(r.clockedMinutes)}` : '-'],
    ['new cols', r => r.ground.cells ? `${r.ground.newCells}/${r.ground.cells}` : '-'], ['walk/net', r => `${r.ground.walked}/${r.ground.net ?? '-'}`], ['dug/laid', r => `${r.ground.dug}/${r.ground.laid}`],
    ['most asked', r => r.questions.top[0] ? `${r.questions.top[0].id} ${r.questions.top[0].same}/${r.questions.top[0].count}` : '-'],
    ['NG', r => r.questions.byJev ? `${r.questions.noneGood}/${r.questions.byJev}` : '-'], ['flags', r => [...new Set(r.flags.map(f => f.id))].join(',') || 'ok']];
  const cells = rows.map(r => cols.map(([, f]) => String(f(r))));
  const width = cols.map(([h], i) => Math.max(h.length, ...cells.map(c => c[i].length)));
  const line = c => c.map((x, i) => x.padEnd(width[i])).join('  ').trimEnd();
  const out = [`Progress over the last ${minutes} min (new ground against the ${historyMinutes} min before), ${new Date().toISOString().slice(0, 16)}Z`, '', line(cols.map(([h]) => h)), ...cells.map(line), ''];
  const flagged = rows.filter(r => r.flags.length);
  for (const r of flagged) {
    out.push(`${r.port} ${r.world} — ${r.verdict}`);
    out.push(`  where: ${r.dimension}${r.phase ? `, on ${human(r.phase)}` : ''}; trial ${r.trialMinutes ?? '?'} min; last milestone ${r.lastMilestone ? `${human(r.lastMilestone.name)} ${r.lastMilestone.minutesAgo} min ago` : 'none'}${r.deaths ? `; ${r.deaths} death(s) in the window` : ''}`);
    out.push(`  doing: ${r.byDoing.map(([k, v]) => `${human(k)} ${v}`).join(', ') || 'no clock'} (min)`);
    const g = r.ground;
    out.push(`  ground: ${g.newCells} of ${g.cells} columns new; walked ${g.walked}, net ${g.net ?? '-'}, farthest ${g.farthest}; dug ~${g.dug}, laid ~${g.laid}; blazes in sight ${r.blazesInSight}`);
    if (r.fortress) out.push(`  fortress (as asked ${r.fortress.minutesAgo} min ago): ${r.fortress.passes} passes, ${r.fortress.minutesThere} min there, blazes seen near it ${r.fortress.blazesSeenNear}${r.fortress.lastPass ? `, last pass reached ${r.fortress.lastPass.reached} of ${r.fortress.lastPass.stretches}` : ''}${r.fortress.lastPass?.notReached ? ` (not reached: ${r.fortress.lastPass.notReached.slice(0, 2).join('; ').slice(0, 200)})` : ''}`);
    out.push(`  asked: ${r.questions.top.map(q => `${q.id} ${q.count}× (${q.same}× ${q.answer})`).join(', ')}; none good ${r.questions.noneGood} of ${r.questions.byJev}`);
    const bl = r.botLog;
    if (bl?.read) out.push(`  bot log: ${Object.entries(bl.missingOption).map(([k, v]) => `${k} none-good ${v}`).join(', ') || 'no none-good lines'}; [stall] ${bl.stall}, [still] ${bl.still}, [bug] ${bl.bug}`);
    out.push('');
  }
  if (!flagged.length) out.push('No trial flagged.', '');
  out.push('Flags, and what raises them:');
  for (const [id, t] of Object.entries(T)) out.push(`  ${id}: ${t.says}`);
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  const minutes = opt('minutes', 15), historyMinutes = opt('history', 60), json = argv.includes('--json');
  const named = argv.filter((a, i) => /^\d+$/.test(a) && !/^--/.test(argv[i - 1] || ''));
  const trials = named.length ? named.map(p => ({ port: Number(p), world: worldOn(Number(p)) })).filter(t => t.world) : runningPorts();
  const rows = trials.map(t => auditTrial(t, { minutes, historyMinutes }));
  if (json) console.log(JSON.stringify(rows.map(({ byDoing, ...r }) => ({ ...r, byDoing })), null, 2));
  else console.log(table(rows, minutes, historyMinutes));
}

if (require.main === module) main();
module.exports = { readFlight, readBotLog, measure, thresholds, table };
