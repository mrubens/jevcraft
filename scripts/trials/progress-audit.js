'use strict';
// Is each running midgame trial getting anywhere? The watcher (watch.sh)
// stops only for a death or a loop, and a bot that is busy but going nowhere
// is neither: mid-242-aa-nether-1-fortress-1 walked back and forth at a
// fortress and dug at random for over seventy minutes, 81 patrol passes,
// no stretch reached and no blaze seen, and only a person watching caught it
// (2026-09-27). This reads the last minutes of each trial's flight record
// and bot log and says, per trial: where it is, what it spent the time on,
// what ground it covered, what it kept asking, and a plain verdict with the
// flags it raised, each flag said with its threshold; and, for every trial,
// the design review's measures against their targets (note 573).
//   node scripts/trials/progress-audit.js [auto | port ...] [--minutes 15] [--history 60] [--since <iso>] [--json]
//   node scripts/trials/progress-audit.js --cohort <iso> [--since <iso>] [--json]
//   node scripts/trials/progress-audit.js --by-commit [--since <iso>] [--to <iso>] [--json]
// auto (the default) finds the running midgame servers as watch.sh does;
// --since keeps the trials begun after it. --cohort sums the measures over
// every trial's whole record, before and after a deploy (note 598).
// --by-commit groups every flight record's runs (one bot process each) by
// the commit its connection frame names (src/recorder/commit.js), not by a
// clock time: bots restart onto new builds every 10 to 15 minutes. Per
// commit: runs, bot-hours, deaths and rods per bot-hour, runs that gained a
// rod, Nether entries. Records with no commit are 'unknown'. --since and
// --to cut the frames by time here.
// JEV_ROOT reads another checkout's servers and records (from a worktree).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..', '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const CELL = 4;
// How long a hold is said to every question after it (decisions/repeats.js SAID_MS).
const HOLD_SAID_MS = 2 * 60000;

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
    // The design review's measures (note 573), each against its target.
    quickNothing: { seconds: 2, per15: 5, says: 'target: under 5 a 15 min, per question, of answers whose action ended (the same question asked again) in under 2 s with nothing gained (no move over 3 blocks, nothing carried changed, so no block dug or placed)' },
    reaskAfterHold: { max: 0, says: 'target: 0 askings of a question within 2 min after it was held as coming to nothing ([repeat] in the bot log) that offered a held answer again from within 4 blocks of where it was held (every asking in those 2 min said beside it)' },
    stallShare: { share: 0.10, says: 'target: under 10% of the clocked minutes on persist, detour (the stall\'s detours, "differently" among them) or shake loose' },
    netherGround: { per15: 20, says: 'target: 20+ new 4×4 columns a 15 min while in the Nether (ours: the review set none)' },
    fortressSighting: { minutes: 30, says: 'target: a fortress sighted within 30 min of entering the Nether (ours, from the pace told to Jev: rods and pearls within two hours of it)' },
    firstRod: { minutes: 60, says: 'target: the first blaze rod within 60 min of entering the Nether (ours, from the same pace)' },
    rungTarget: { closer: 8, says: 'target: the rung\'s target (the portal, the fortress, blazes, endermen, or the step\'s own) 8+ blocks closer at the window\'s end than at its start, or reached' },
    // Note 598's measures.
    waitShare: { share: 0.20, says: 'target: under 20% of the clocked minutes waiting: hold_bunker, in a shelter or sealed pocket (pocket_next stay, wait in shelter), a pillar top hold, back_to_wall, the wait for day (sealed), and the three minutes of a stay_in_fortress walk' },
    stanceRate: { perMinute: 1, stretchMinutes: 1, health: 1, mob: 2, says: 'target: under 1 encounter_stance or turn_priority asking a minute over the stretches of a minute or more in which health stayed within 1, and the nearest mob\'s distance within 2 blocks, of what they were at the stretch\'s start' },
    noneGoodStreak: { says: 'no target: the longest run of none_good answers in a row to one question' },
    // Note 650: 25598 stood on a span tip 110 minutes and nothing said so.
    stranded: { says: 'stranded: every position of the last 30 min within 12 blocks of each other, and either 10+ none_good answers in a row to one question in the last 15 min or none good in 40%+ of 40+ answers in the half hour (scripts/lib/stranded.js)' },
  };
}

const midgameStart = at => { const m = at.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };

// The frames of the window, parsed, and the positions of the history before
// it, from observation lines alone (they are small; the full snapshots with
// their terrain are what makes a file megabytes). Only the files that can
// hold either are read: a file's frames run from its name's time to the next
// file's.
// `slim` (a function of a parsed frame) keeps only what a caller needs, for
// a read over hours (the cohort's).
function readFlight({ identity, from, to, historyFrom, dir = FLIGHT, slim = null }) {
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
      let f; try { f = { ...JSON.parse(line), t }; } catch (_) { continue; }
      frames.push(slim ? slim(f) : f);
    }
  });
  frames.sort((a, b) => a.t - b.t);
  return { frames, history };
}

// The bot log has no times of its own; the times inside its lines (a step's
// or a decision's "at") place it. Read back from its end until a line wholly
// before the window, then count the lines that say the bot is stuck or
// unhappy with what it was offered.
const STAMPS = /"(?:at|askedAt)":"(\d{4}-\d\d-\d\dT[\d:.]+Z)"/g;
const stampsOf = l => l.includes('At":"') || l.includes('"at":"') ? [...l.matchAll(STAMPS)].map(m => Date.parse(m[1])) : [];
// What the bot log's lines count, a line at a time, in order. A hold
// ([repeat], decisions/index.js) is placed at the newest stamp before it,
// and at the bot's place in the status line before it. A re-ask the hold
// did not stop is a decision line of that question answered after it,
// within the two minutes the hold is said, that offered a held answer
// again from within four blocks of where it was held (tried.js NEAR): the
// hold is on the answer, from here, not on the question. An asking with
// the held answers left out is the question asked with its other ways
// (note 583), and one from new ground is asked afresh (note 560); each was
// counted until note 611, and still is as askedAfterHold.
const HOLD_NEAR = 4;
const heldOf = says => {
  const one = says.match(/^(.+?) was chosen \d+ times?\b/);
  if (one) return [one[1]];
  const run = says.match(/^the last \d+ answers to this question in a row \((.*?), in the last /);
  return run ? run[1].split(', ').map(s => s.replace(/ \d+ times?$/, '')) : [];
};
const leavesSaid = (tree, pre = []) => Object.entries(tree || {}).flatMap(([k, n]) => n?.children ? leavesSaid(n.children, [...pre, k]) : [[...pre, k].join('/').replaceAll('_', ' ')]);
const POSITION = /"position":\{"x":(-?[\d.e+-]+),"y":(-?[\d.e+-]+),"z":(-?[\d.e+-]+)/;
function botLogCounter(from) {
  const out = { read: false, missingOption: {}, stall: 0, still: 0, bug: 0, repeat: {}, reaskAfterHold: {}, askedAfterHold: {} };
  let lastStamp = null, lastPos = null;
  const holds = [], asked = new Set();
  const line = (l, stamps = stampsOf(l)) => {
    const m = l.match(/^\[missing option\] ([a-z_]+):/);
    if (m) out.missingOption[m[1]] = (out.missingOption[m[1]] || 0) + 1;
    else if (l.startsWith('[stall]')) out.stall++;
    else if (l.startsWith('[still]')) out.still++;
    else if (l.startsWith('[bug]')) out.bug++;
    else if (l.startsWith('[repeat] ')) {
      const said = l.match(/^\[repeat\] ([^:]+): (.*)$/);
      const id = (said?.[1] || '?').trim().replaceAll(' ', '_');
      out.repeat[id] = (out.repeat[id] || 0) + 1;
      holds.push({ id, at: lastStamp ?? from, pos: lastPos, held: heldOf(said?.[2] || '') });
    } else if (l.startsWith('{')) {
      const i = l.lastIndexOf('"position":{"x":');
      const p = i >= 0 ? l.slice(i).match(POSITION) : null;
      if (p) lastPos = { x: +p[1], y: +p[2], z: +p[3] };
      const d = l.match(/"decision":\{"at":"([^"]+)"(?:,"askedAt":"[^"]+")?,"id":"([a-z_0-9]+)"/);
      if (d) {
        const at = Date.parse(d[1]), key = `${d[2]}@${d[1]}`;
        if (!asked.has(key)) {
          asked.add(key);
          // Holds too old to be said any more are dropped (a log of hours).
          while (holds.length && at - holds[0].at > HOLD_SAID_MS && holds.length > 64) holds.shift();
          const after = holds.filter(h => h.id === d[2] && at > h.at && at - h.at <= HOLD_SAID_MS);
          if (after.length) {
            out.askedAfterHold[d[2]] = (out.askedAfterHold[d[2]] || 0) + 1;
            let offered = null;
            try { const o = JSON.parse(l).decision?.options; if (o) offered = new Set(leavesSaid(o)); } catch (_) { /* a line cut short: counted */ }
            const near = h => !h.pos || !lastPos || Math.hypot(lastPos.x - h.pos.x, lastPos.y - h.pos.y, lastPos.z - h.pos.z) <= HOLD_NEAR;
            if (after.some(h => near(h) && (!offered || !h.held.length || h.held.some(x => offered.has(x))))) out.reaskAfterHold[d[2]] = (out.reaskAfterHold[d[2]] || 0) + 1;
          }
        }
      }
    }
    for (const t of stamps) if (!(lastStamp >= t)) lastStamp = t;
  };
  return { out, line, lastStamp: () => lastStamp };
}
const copyCounts = o => JSON.parse(JSON.stringify(o));
const minusCounts = (a, b) => {
  const out = {};
  for (const [k, v] of Object.entries(a)) out[k] = typeof v === 'number' ? v - (b[k] || 0) : v && typeof v === 'object' ? minusCounts(v, b[k] || {}) : v;
  return out;
};

// A whole bot log read forward in chunks (one can be half a gigabyte, more
// than a string holds), its counts split at `split`: a line is on the side
// of its own newest stamp, or of the newest before it.
function scanBotLog(file, { from = 0, split = Infinity, chunk = 8 << 20 } = {}) {
  const c = botLogCounter(from);
  let fd; try { fd = fs.openSync(file, 'r'); } catch (_) { return { before: c.out, after: null }; }
  let before = null, rest = '';
  const buf = Buffer.alloc(chunk);
  const each = l => {
    const stamps = stampsOf(l);
    if (!before && Math.max(c.lastStamp() ?? -Infinity, ...stamps) >= split) before = copyCounts(c.out);
    c.line(l, stamps);
  };
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, chunk, null)) > 0;) {
      const lines = (rest + buf.toString('utf8', 0, n)).split('\n');
      rest = lines.pop();
      for (const l of lines) each(l);
    }
    if (rest) each(rest);
  } finally { fs.closeSync(fd); }
  c.out.read = true;
  if (!before) return { before: c.out, after: split === Infinity ? null : { ...botLogCounter(from).out, read: true } };
  before.read = true;
  return { before, after: { ...minusCounts(c.out, before), read: true } };
}

function readBotLog(file, from, { chunk = 2 << 20, cap = 48 << 20 } = {}) {
  const c = botLogCounter(from), out = c.out;
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
    const stamps = lines.map(stampsOf);
    stamps.forEach((ts, i) => { if (ts.length && Math.max(...ts) < from) begin = i + 1; });
    for (let i = begin; i < lines.length; i++) c.line(lines[i], stamps[i]);
    out.read = true; out.coversWindow = reachedStart;
  } finally { fs.closeSync(fd); }
  return out;
}

// When a blaze rod was first carried: the first frame since `from` whose
// inventory holds one, the flight files read in time order until it is
// found. Read only for a trial that has had one, so most trials read none.
function firstCarried({ identity, item, from, dir = FLIGHT }) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return null; }
  const files = names.filter(f => f.startsWith(identity + '-') && f.endsWith('.jsonl'))
    .map(f => ({ f, start: midgameStart(f.slice(identity.length + 1)) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  const held = new RegExp(`"inventory":\\{[^}]*"${item}":[1-9]`);
  for (let i = 0; i < files.length; i++) {
    if ((files[i + 1]?.start ?? Infinity) < from) continue;
    let text; try { text = fs.readFileSync(path.join(dir, files[i].f), 'utf8'); } catch (_) { continue; }
    for (let j = text.indexOf(`"${item}":`); j >= 0; j = text.indexOf(`"${item}":`, j + 1)) {
      const s = text.lastIndexOf('\n', j) + 1, e = text.indexOf('\n', j), line = text.slice(s, e < 0 ? undefined : e);
      const t = frameAt(line);
      if (t >= from && held.test(line)) return t;
      j = e < 0 ? text.length : e;
    }
  }
  return null;
}

// Ground blocks: what digging through the world brings in and spans and
// pillars spend. Only these: every block item counted crafting too (a log
// into four planks read as four blocks dug).
const GROUND = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|rooted_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|smooth_basalt|blackstone|sand|red_sand|sandstone|soul_sand|soul_soil|end_stone|nether_bricks|magma_block|glowstone|crimson_nylium|warped_nylium|clay|mud)$/;
const isBlockItem = name => GROUND.test(name);

// A count series with its excursions taken out: a change of more than 8
// that the series undoes (comes back to within 8 of where it was) within
// thirty seconds is read as no change. A frame taken mid-click, a stack on
// the cursor, or a stack dropped and walked back over with full pockets
// is not a block dug or laid (note 753). `times` in ms, beside the values;
// without them, one frame is the reach.
function steady(values, times = null, reachMs = 30000) {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) {
    const base = out[i - 1];
    if (Math.abs(out[i] - base) <= 8) continue;
    const up = out[i] > base;
    for (let j = i + 1; j < out.length; j++) {
      if (times ? times[j] - times[i - 1] > reachMs : j > i + 1) break;
      if (Math.abs(out[j] - base) <= 8) { for (let k = i; k < j; k++) out[k] = base; break; }
      if (up ? out[j] < base : out[j] > base) break;
    }
  }
  return out;
}

const cellOf = (p, dim) => `${String(dim || '?').replace(/^minecraft:/, '')}:${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const human = s => String(s).replaceAll('_', ' ');
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

// Everything the verdict is made of, from the parsed frames.
function measure({ frames, history, from, to, trial = {}, botLog = null, minutes, historyMinutes, known = null, firstRodAt = null, clock = null, supervised = null }) {
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

  // Time by step or rung: the run clock's entries, cut to the window.
  const entries = timeline({ frames, from, to, clock });
  const doing = doingOf(entries);
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

  // Blocks dug and laid, from the block items carried frame to frame, with
  // each item's excursions undone within thirty seconds taken out (steady):
  // a frame taken mid-click, a stack on the cursor, or a stack dropped and
  // picked back up read as blocks laid and dug. Counted raw, 25581 (mid-243-jd) read 246, 128, 246 cobblestone
  // across 11:55:20-26Z on 2026-09-30, "about 3,400 dug and 3,400 laid" in
  // a window that dug a few hundred (the live critic's report of 11:57Z,
  // note 753).
  const carrying = frames.filter(f => f.snapshot?.inventory && typeof f.snapshot.inventory === 'object');
  const invs = carrying.map(f => f.snapshot.inventory), invAt = carrying.map(f => f.t);
  const names = new Set(invs.flatMap(inv => Object.keys(inv)).filter(isBlockItem));
  let dug = 0, laid = 0;
  for (const k of names) {
    const series = steady(invs.map(inv => +inv[k] || 0), invAt.every(Number.isFinite) ? invAt : null);
    for (let i = 1; i < series.length; i++) { const d = series[i] - series[i - 1]; if (d > 0) dug += d; else laid -= d; }
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
    supervised,
    lastFrameMinutesAgo: lastT === null ? null : round((to - lastT) / 60000, 1),
    clockedMinutes: round(clocked, 1), byDoing: byDoing.slice(0, 6), top,
    ground: { cells: cells.size, newCells: fresh, newShare: cells.size ? round(fresh / cells.size, 2) : null, walked: Math.round(walked), net: net === null ? null : Math.round(net), farthest: Math.round(far), dug, laid },
    fortress: fortress && { ...fortress, minutesAgo: round((to - fortressAt) / 60000, 1) },
    blazesInSight: blazes.size,
    questions: { asked: seen.size, byJev: answered, noneGood, noneGoodShare: answered ? round(noneGood / answered, 2) : null, top: repeats.slice(0, 5) },
    botLog, deaths: deaths.length,
  };
  m.review = review({ minutes, frames, positioned, history, from, to, trial, known, firstRodAt, doing, clocked, progress, botLog, last, entries });
  m.flags = flag(m, T, minutes);
  m.verdict = verdictOf(m, minutes);
  return m;
}

// The design review's measures (note 573), per trial over the window.
const dimOf = d => String(d || '').replace(/^minecraft:/, '').replace(/^the_/, '');
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sameCarried = (a, b) => { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((+a[k] || 0) !== (+b[k] || 0)) return false; return true; };
// The index of the last element of a sorted-by-t list at or before t.
const atOrBefore = (list, t) => { let lo = 0, hi = list.length - 1, i = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; } return i; };
const REACH = { 'the portal': 4, 'the fortress': 24, blazes: 12, endermen: 12 };

// The run clock's entries ([end, what, ms]) in [from, to]: every clock
// the frames carry (each keeps its last half hour), joined, or `clock`
// when a reader has joined them already; with no clock, the observations'
// survival action while it is current, else their step.
function clockOf(frames, into = new Map()) {
  for (const f of frames) for (const e of f.snapshot?.goal?.gameProgress?.clock?.recent || []) if (Array.isArray(e)) into.set(`${e[0]}|${e[1]}`, e);
  return into;
}
function timeline({ frames, from, to, clock = null }) {
  const all = clock || [...clockOf(frames).values()];
  const entries = all.filter(([t]) => t >= from && t <= to).sort((a, b) => a[0] - b[0]);
  if (entries.length) return entries;
  const obs = frames.filter(f => f.kind === 'observation' && f.snapshot?.position && f.t >= from && f.t <= to);
  for (let i = 0; i + 1 < obs.length; i++) {
    const s = obs[i].snapshot, sa = s.survivalAction || s.goal?.survivalAction;
    const current = sa?.action && (!sa.at || obs[i].t - Date.parse(sa.at) < 8000) ? sa.action : null;
    entries.push([obs[i + 1].t, current || s.step?.action || s.goal?.step?.action || 'no step', Math.min(obs[i + 1].t - obs[i].t, 5000)]);
  }
  return entries;
}
function doingOf(entries) {
  const doing = {};
  for (const [, what, dt] of entries) doing[what] = (doing[what] || 0) + dt;
  return doing;
}

// Every decision once, by its id and time, in order.
function decisionsOf(frames) {
  const decs = [], seen = new Set();
  for (const f of frames) {
    const d = f.kind === 'decision' && f.snapshot?.decision;
    if (!d?.id || d.stale) continue;
    const at = Date.parse(d.at) || f.t, key = `${d.id}@${at}`;
    if (seen.has(key)) continue; seen.add(key);
    decs.push({ id: d.id, at, askedAt: Date.parse(d.askedAt) || at, answer: (d.path || []).join('/') || '?', only: !!d.only, byJev: !!d.judgments?.length, noneGood: !!d.noneGood });
  }
  return decs.sort((a, b) => a.at - b.at);
}

// Minutes spent waiting (note 598): the survival waits by the clock's name
// for them, hold_bunker by its step, and a stay_in_fortress walk (a
// fortress_leg answer) for its three minutes or until the legs are asked
// again, the find_fortress minutes inside it.
const WAITS = /^(wait_in_shelter|pillar_hold|back_to_wall|wait_for_day|wait_for_day_sealed)$|(?:^|: )(hold_bunker)$/;
const PATROL_MS = 3 * 60000; // mob-hunt.js PATROL_MS
function waitsOf({ entries, decs }) {
  const legs = decs.filter(d => d.id === 'fortress_leg'), patrols = [];
  legs.forEach((d, i) => { if (d.answer.split('/')[0] === 'stay_in_fortress') patrols.push([d.at, Math.min(d.at + PATROL_MS, legs[i + 1]?.at ?? Infinity)]); });
  const by = {};
  let clocked = 0;
  for (const [t, what, dt] of entries) {
    clocked += dt;
    const w = what.match(WAITS);
    if (w) { const k = w[1] || w[2]; by[k] = (by[k] || 0) + dt; continue; }
    if (!patrols.length || !/(?:^|: )find_fortress$/.test(what)) continue;
    let ms = 0;
    for (const [a, b] of patrols) ms += Math.max(0, Math.min(t, b) - Math.max(t - dt, a));
    if (ms) by.stay_in_fortress = (by.stay_in_fortress || 0) + Math.min(ms, dt);
  }
  const ms = Object.values(by).reduce((a, b) => a + b, 0);
  return { ms, clockedMs: clocked, minutes: round(ms / 60000, 1), clocked: round(clocked / 60000, 1), share: clocked >= 60000 ? round(ms / clocked, 2) : null,
    by: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v / 60000, 1)])) };
}

// Stance askings while nothing changed (note 598): the frames cut into
// stretches, a new one each time health moves more than 1 or the nearest
// mob's distance more than 2 blocks from the stretch's start (or a mob comes
// or goes, or the dimension changes); encounter_stance and turn_priority
// askings counted in the stretches of a minute or more. Health is in every
// frame, the mobs only in the full ones (an event's), so the nearest mob is
// what the last full frame said.
const STANCE = new Set(['encounter_stance', 'turn_priority']);
function stanceOf({ frames, decs }) {
  const T = thresholds(0, 0).stanceRate;
  const stretches = [];
  let cur = null;
  const nearOf = s => {
    let near = null;
    for (const m of s.mobs) {
      const d = Number.isFinite(m.d) ? m.d : m.at && s.position ? dist3(m.at, s.position) : null;
      if (d !== null && (near === null || d < near)) near = d;
    }
    return near;
  };
  for (const f of frames) {
    const s = f.snapshot;
    if (!s) continue;
    const dim = s.dimension ? dimOf(s.dimension) : null, health = typeof s.health === 'number' ? s.health : null;
    const near = Array.isArray(s.mobs) ? nearOf(s) : undefined;
    if (cur) {
      const changed = (dim && cur.dim && dim !== cur.dim) || (health !== null && cur.health !== null && Math.abs(health - cur.health) > T.health)
        || (near !== undefined && cur.near !== undefined && ((near === null) !== (cur.near === null) || Math.abs(near - cur.near) > T.mob));
      if (!changed) {
        cur.end = f.t;
        if (cur.health === null) cur.health = health;
        if (cur.near === undefined) cur.near = near;
        if (!cur.dim) cur.dim = dim;
        continue;
      }
      cur.end = f.t;
    }
    stretches.push(cur = { start: f.t, end: f.t, dim, health, near });
  }
  const asks = decs.filter(d => STANCE.has(d.id));
  let i = 0, stillAsks = 0, stillMs = 0, worst = null;
  for (const s of stretches) {
    let n = 0;
    while (i < asks.length && asks[i].at < s.start) i++;
    for (let j = i; j < asks.length && asks[j].at < s.end; j++) n++;
    const ms = s.end - s.start;
    if (ms < T.stretchMinutes * 60000) continue;
    stillAsks += n; stillMs += ms;
    const rate = n / (ms / 60000);
    if (n && (!worst || rate > worst.perMinute)) worst = { asks: n, minutes: round(ms / 60000, 1), perMinute: round(rate, 2), at: new Date(s.start).toISOString() };
  }
  return { asks: asks.length, stillAsks, stillMs, stillMinutes: round(stillMs / 60000, 1), perMinute: stillMs >= 60000 ? round(stillAsks / (stillMs / 60000), 2) : null, worst };
}

// The longest run of none_good answers in a row to one question, each
// question's answers in their own order (note 598).
function noneGoodStreakOf(decs) {
  const run = {};
  let best = null;
  for (const d of decs) {
    if (d.only) continue;
    if (!d.noneGood) { delete run[d.id]; continue; }
    const r = run[d.id] ||= { id: d.id, run: 0, from: d.at };
    r.run++; r.to = d.at;
    if (!best || r.run > best.run) best = { ...r };
  }
  return best && { id: best.id, run: best.run, from: new Date(best.from).toISOString(), to: new Date(best.to).toISOString() };
}

// Answers that came back at once with nothing gained: each answer's
// action ends when its question is asked again.
function quickOf({ decs, positioned, carried }) {
  const T = thresholds(0, 0);
  const byQuestion = {};
  const lastOf = {};
  for (const d of decs) {
    const q = byQuestion[d.id] ||= { id: d.id, answers: 0, quick: 0, answersQuick: {} };
    q.answers++;
    const a = lastOf[d.id]; lastOf[d.id] = d;
    if (!a || d.askedAt - a.at >= T.quickNothing.seconds * 1000 || d.askedAt < a.at) continue;
    const i0 = atOrBefore(positioned, a.at), base = positioned[i0]?.snapshot.position;
    let gained = false;
    for (let i = Math.max(0, i0); !gained && i < positioned.length && positioned[i].t <= d.at; i++) if (base && dist3(positioned[i].snapshot.position, base) > 3) gained = true;
    const j0 = atOrBefore(carried, a.at), inv = carried[j0]?.snapshot.inventory;
    for (let j = Math.max(0, j0); !gained && inv && j < carried.length && carried[j].t <= d.at; j++) if (!sameCarried(carried[j].snapshot.inventory, inv)) gained = true;
    if (gained) continue;
    q.quick++; q.answersQuick[a.answer] = (q.answersQuick[a.answer] || 0) + 1;
  }
  return Object.values(byQuestion);
}

// Minutes on the stall's own steps, from the run clock.
const STALL = /(^|: )(persist|detour|shake_loose)$/;
function stallOf(doing) {
  const by = {};
  for (const [k, ms] of Object.entries(doing)) { const s = k.match(STALL)?.[2]; if (s) by[s] = (by[s] || 0) + ms; }
  return { ms: Object.values(by).reduce((a, b) => a + b, 0), by };
}

function review({ minutes, frames, positioned, history, from, to, trial, known, firstRodAt, doing, clocked, progress, botLog, last, entries = [] }) {
  // A 15 min of the minutes asked for, not of the trial's so far: one
  // quick answer in a trial a minute old is not fifteen a 15 min.
  const T = thresholds(0, 0), per15 = n => round(n * 15 / minutes, 1);

  // 1. Answers that came back at once with nothing gained.
  const decsAll = decisionsOf(frames), decs = decsAll.filter(d => !d.only);
  const carried = frames.filter(f => f.snapshot?.inventory && typeof f.snapshot.inventory === 'object');
  const quickNothing = quickOf({ decs, positioned, carried }).filter(q => q.quick).map(q => ({ id: q.id, quick: q.quick, answers: q.answers, per15: per15(q.quick),
    answer: Object.entries(q.answersQuick).sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.quick - a.quick);

  // 2. Asked again after a hold, from the bot log.
  const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const reask = botLog?.read ? { holds: { ...botLog.repeat }, reasked: { ...botLog.reaskAfterHold }, total: sum(botLog.reaskAfterHold), asked: sum(botLog.askedAfterHold) } : null;

  // 3. Minutes on the stall's own steps, from the run clock.
  const stallBy = stallOf(doing).by;
  const detourBy = {};
  for (let i = 0; i + 1 < positioned.length; i++) {
    const s = positioned[i].snapshot, step = s.step || s.goal?.step;
    if (step?.action === 'detour') detourBy[step.choice || '?'] = (detourBy[step.choice || '?'] || 0) + Math.min(positioned[i + 1].t - positioned[i].t, 5000);
  }
  const stallMin = Object.values(stallBy).reduce((a, b) => a + b, 0) / 60000;
  const stall = { minutes: round(stallMin, 1), clocked: round(clocked, 1), share: clocked >= 1 ? round(stallMin / clocked, 2) : null,
    by: Object.fromEntries(Object.entries(stallBy).map(([k, ms]) => [k, round(ms / 60000, 1)])),
    detours: Object.fromEntries(Object.entries(detourBy).sort((a, b) => b[1] - a[1]).map(([k, ms]) => [k, round(ms / 60000, 1)])) };

  // 4. New ground in the Nether, a 15 min of Nether time.
  const before = new Set(history.map(h => cellOf(h.position, h.dimension)));
  const netherCells = new Set();
  let netherMs = 0;
  for (let i = 0; i < positioned.length; i++) {
    const s = positioned[i].snapshot;
    if (dimOf(s.dimension) !== 'nether') continue;
    netherCells.add(cellOf(s.position, s.dimension));
    const n = positioned[i + 1];
    if (n && dimOf(n.snapshot.dimension) === 'nether') netherMs += Math.min(n.t - positioned[i].t, 30000);
  }
  const netherFresh = [...netherCells].filter(c => !before.has(c)).length;
  const nether = { minutes: round(netherMs / 60000, 1), cells: netherCells.size, newCells: netherFresh, per15: netherMs >= 5 * 60000 ? round(netherFresh * 15 / (netherMs / 60000), 1) : null };

  // 5. From the Nether to a fortress in sight and to the first rod: the
  // bot's own record (world file, gameProgress), else the trial record,
  // else what the window shows.
  const started = Date.parse(trial.startedAt), reachedAt = trial.verdict?.reachedAtMinute || {};
  const fromTrial = k => Number.isFinite(started) && Number.isFinite(reachedAt[k]) ? started + reachedAt[k] * 60000 : null;
  const netherAt = known?.gameProgress?.milestones?.nether_entered?.at ?? progress?.milestones?.nether_entered?.at ?? fromTrial('nether');
  const forts = (known?.landmarks || []).filter(l => l.kind === 'nether_fortress' && Number.isFinite(l.firstAt));
  let fortressAt = null, fortressFrom = null;
  if (forts.length) { fortressAt = Math.min(...forts.map(l => l.firstAt)); fortressFrom = 'landmark first seen'; }
  else if (fromTrial('fortress') !== null) { fortressAt = fromTrial('fortress'); fortressFrom = 'trial record'; }
  else { const f = frames.find(f => f.snapshot?.decision?.state?.fortressInView); if (f) { fortressAt = f.t; fortressFrom = 'in view this window'; } }
  // Retracted where nothing of a fortress's own was seen (note 750d): no
  // fortress landmark (nether bricks), no floor of one walked this window,
  // and a bastion known. 25589 (mid-243-ma) read a bastion's magma cube
  // spawner at (-238, 39, 26) as its fortress's cage at 17:13:35Z.
  if (fortressAt !== null && !forts.length && (known?.landmarks || []).some(l => l.kind === 'bastion')) {
    const walked = frames.some(f => { const s = f.snapshot?.step || f.snapshot?.goal?.step; return s?.action === 'find_fortress' && (s.walking || s.patrolling || s.exploring); });
    if (!walked) { fortressFrom = `retracted: ${fortressFrom}, but no fortress brick seen as a landmark or floor walked, and a bastion known`; fortressAt = null; }
  }
  let rodAt = firstRodAt, rodFrom = firstRodAt ? 'flight record' : null;
  // A trial from a checkpoint may begin with rods got before it.
  if (rodAt && Number.isFinite(started) && rodAt - started < 120000 && netherAt < started) { rodAt = null; rodFrom = 'when the trial began'; }
  if (!rodAt) {
    const i = carried.findIndex(f => +f.snapshot.inventory.blaze_rod > 0);
    if (i > 0) { rodAt = carried[i].t; rodFrom = 'this window'; } else if (i === 0) rodFrom = 'before the window';
  }
  const since = t => Number.isFinite(netherAt) && Number.isFinite(t) ? round((t - netherAt) / 60000) : null;
  const firsts = { netherAt: Number.isFinite(netherAt) ? new Date(netherAt).toISOString() : null, minutesInNetherSoFar: since(to),
    fortress: fortressAt ? { minutes: since(fortressAt), from: fortressFrom } : null, ...(/^retracted/.test(fortressFrom || '') ? { fortressRetracted: fortressFrom } : {}),
    rod: rodAt ? { minutes: since(rodAt), from: rodFrom } : rodFrom ? { minutes: null, from: rodFrom } : null };

  // 6. The rung's target: how far at the window's start and end.
  let step = null;
  for (let i = frames.length - 1; i >= 0 && !step; i--) step = frames[i].snapshot?.step || frames[i].snapshot?.goal?.step || null;
  const phase = progress?.phase || null, endDim = dimOf(last.dimension);
  const phases = [...new Set(frames.map(f => f.snapshot?.goal?.gameProgress?.phase).filter(Boolean))];
  const portals = dim => [...(known?.portals || []).filter(p => dimOf(p.dimension) === dim), ...(dim === 'overworld' && known?.portalFrame?.origin && !(known?.portals || []).some(p => dimOf(p.dimension) === 'overworld') ? [known.portalFrame.origin] : [])];
  const mobsKnown = (name, dim) => { const at = new Map(); for (const f of frames) if (dimOf(f.snapshot?.dimension) === dim) for (const mob of f.snapshot?.mobs || []) if (mob.name === name && mob.at) at.set(mob.id ?? `${mob.at.x},${mob.at.z}`, mob.at); return [...at.values()]; };
  const targets = [];
  const want = (name, dim, points) => { if (!targets.some(t => t.name === name)) targets.push({ name, dim, points }); };
  if (/portal|overworld/.test(step?.action || '')) want('the portal', endDim, portals(endDim));
  if (phase === 'reach_nether' && endDim === 'overworld') want('the portal', 'overworld', portals('overworld'));
  if (phase === 'obtain_blaze_rods') {
    if (endDim === 'nether') { want('the fortress', 'nether', forts.filter(l => dimOf(l.dimension) === 'nether')); want('blazes', 'nether', mobsKnown('blaze', 'nether')); }
    else want('the portal', endDim, portals(endDim));
  }
  if (phase === 'obtain_ender_pearls') want('endermen', endDim, mobsKnown('enderman', endDim));
  const stepTarget = step?.target || step?.walking || step?.found;
  if (!targets.length && stepTarget && Number.isFinite(stepTarget.x)) targets.push({ name: `the ${human(step.action)} target`, dim: endDim, points: [stepTarget] });
  const rung = { phase, phases, step: step?.action || null, targets: targets.map(({ name, dim, points }) => {
    const ps = positioned.filter(f => dimOf(f.snapshot.dimension) === dim);
    if (!points.length) return { name, known: false, met: null };
    if (!ps.length) return { name, known: true, met: null, says: `not in the ${dim} this window` };
    const d = f => Math.min(...points.map(p => flat(f.snapshot.position, p)));
    const start = Math.round(d(ps[0])), end = Math.round(d(ps.at(-1))), best = Math.round(Math.min(...ps.map(d)));
    const reach = REACH[name] ?? 4, closer = start - end;
    return { name, start, best, end, reached: end <= reach, improving: end <= reach || closer >= T.rungTarget.closer, met: end <= reach || closer >= T.rungTarget.closer };
  }) };

  // 7-9. Waiting, stance askings while nothing changed, none-good runs (note 598).
  const waits = waitsOf({ entries, decs: decsAll });
  const { stillMs, ...stance } = stanceOf({ frames, decs: decsAll });
  const noneGoodStreak = noneGoodStreakOf(decsAll);
  // 10. Stranded (note 650): the last half hour's positions, the history
  // before the window and the window's, and the window's answers.
  const stranded = require('../lib/stranded').strandedOf({ positions: [...history, ...positioned.map(f => ({ t: f.t, position: f.snapshot.position, dimension: f.snapshot.dimension }))].sort((a, b) => a.t - b.t), decs: decsAll, now: to });

  return { quickNothing, reask, stall, nether, firsts, rung, waits: (({ ms, clockedMs, ...w }) => w)(waits), stance, noneGoodStreak, stranded };
}

// The review's measures said a line each, each against its target.
function reviewLines(m) {
  const r = m.review, T = thresholds(0, 0), out = [];
  if (!r) return out;
  const top = r.quickNothing[0];
  const quickMet = !r.quickNothing.some(q => q.per15 >= T.quickNothing.per15);
  out.push({ id: 'quickNothing', met: quickMet, text: `quick answers, nothing gained (under 5 a 15 min per question): ${r.quickNothing.length ? r.quickNothing.slice(0, 3).map(q => `${q.id} ${q.quick} of ${q.answers} (${q.per15}/15min, ${q.answer})`).join(', ') : 'none'}` });
  if (r.reask) out.push({ id: 'reaskAfterHold', met: r.reask.total <= T.reaskAfterHold.max, text: `re-asked after a hold (target 0): ${r.reask.total}${Object.keys(r.reask.holds).length ? `; holds ${Object.entries(r.reask.holds).map(([k, v]) => `${k} ${v}`).join(', ')}` : '; no holds'}${r.reask.total ? `; re-asks ${Object.entries(r.reask.reasked).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}${r.reask.asked ? `; asked in all within 2 min of a hold ${r.reask.asked}` : ''}` });
  else out.push({ id: 'reaskAfterHold', met: null, text: 're-asked after a hold (target 0): no bot log' });
  const s = r.stall;
  out.push({ id: 'stallShare', met: s.share === null ? null : s.share < T.stallShare.share, text: `persist/detour/shake loose (under 10%): ${s.share === null ? 'no clock' : `${Math.round(s.share * 100)}%, ${s.minutes} of ${s.clocked} min`}${Object.keys(s.by).length ? ` (${Object.entries(s.by).map(([k, v]) => `${human(k)} ${v}`).join(', ')})` : ''}${Object.keys(s.detours).length ? `; detours ${Object.entries(s.detours).map(([k, v]) => `${human(k)} ${v}`).join(', ')}` : ''}` });
  const n = r.nether;
  out.push({ id: 'netherGround', met: n.per15 === null ? null : n.per15 >= T.netherGround.per15, text: `new Nether columns (20+ a 15 min): ${n.per15 === null ? `${n.minutes} min in the Nether` : `${n.per15}/15min, ${n.newCells} of ${n.cells} in ${n.minutes} min`}` });
  const f = r.firsts, soFar = f.minutesInNetherSoFar;
  const late = (x, lim) => x ? (x.minutes === null ? null : x.minutes <= lim) : soFar === null ? null : soFar <= lim ? null : false;
  out.push({ id: 'fortressSighting', met: late(f.fortress, T.fortressSighting.minutes), text: `Nether to fortress sighted (30 min): ${f.netherAt === null ? 'not in the Nether yet' : f.fortress ? `${f.fortress.minutes} min (${f.fortress.from})` : `none yet, ${soFar} min in`}` });
  out.push({ id: 'firstRod', met: late(f.rod, T.firstRod.minutes), text: `Nether to first blaze rod (60 min): ${f.netherAt === null ? 'not in the Nether yet' : f.rod ? (f.rod.minutes === null ? `held ${f.rod.from}` : `${f.rod.minutes} min (${f.rod.from})`) : `none yet, ${soFar} min in`}` });
  const g = r.rung;
  if (!g.targets.length) out.push({ id: 'rungTarget', met: null, text: `rung ${g.phase ? human(g.phase) : '?'}${g.step ? ` (${human(g.step)})` : ''}: no place to measure` });
  for (const t of g.targets) out.push({ id: 'rungTarget', met: t.met, text: `rung ${g.phase ? human(g.phase) : '?'}${g.phases.length > 1 ? ` (also ${g.phases.filter(p => p !== g.phase).map(human).join(', ')})` : ''}, ${t.name}: ${t.known === false ? 'none known' : t.says || `${t.start} at the start, ${t.end} at the end, best ${t.best} — ${t.reached ? 'reached' : t.improving ? 'improving' : 'not improving'}`}` });
  const w = r.waits;
  if (w) out.push({ id: 'waitShare', met: w.share === null ? null : w.share < T.waitShare.share, text: `waiting (under 20%): ${w.share === null ? 'no clock' : `${Math.round(w.share * 100)}%, ${w.minutes} of ${w.clocked} min`}${Object.keys(w.by).length ? ` (${Object.entries(w.by).map(([k, v]) => `${human(k)} ${v}`).join(', ')})` : ''}` });
  const st = r.stance;
  if (st) out.push({ id: 'stanceRate', met: st.perMinute === null ? null : st.perMinute < T.stanceRate.perMinute, text: `stance askings while nothing changed (under 1 a min): ${st.perMinute === null ? `no still stretch of a minute (${st.asks} asked)` : `${st.perMinute}/min, ${st.stillAsks} in ${st.stillMinutes} min unchanged (${st.asks} asked in all)${st.worst ? `; worst ${st.worst.asks} in ${st.worst.minutes} min from ${st.worst.at.slice(11, 16)}Z` : ''}`}` });
  if (r.stranded) out.push({ id: 'stranded', met: false, text: r.stranded.says });
  if (r.waits) out.push({ id: 'noneGoodStreak', met: null, noTarget: true, text: `longest none-good run (no target): ${r.noneGoodStreak ? `${r.noneGoodStreak.run} in a row to ${r.noneGoodStreak.id}, ${r.noneGoodStreak.from.slice(11, 19)} to ${r.noneGoodStreak.to.slice(11, 19)}Z` : 'none'}` });
  return out;
}

function flag(m, T, minutes) {
  const flags = [], g = m.ground, pct = x => `${Math.round(x * 100)}%`;
  const say = (id, text) => flags.push({ id, text, threshold: T[id].says });
  if (m.lastFrameMinutesAgo !== null && m.lastFrameMinutesAgo >= T.silent.minutes) say('silent', `no frame for ${Math.round(m.lastFrameMinutesAgo)} min${m.supervised === false ? ' and no supervisor is watching this port, so nothing will start the bot again (note 640: mid-242-bd and mid-243-be sat down for 2.5 hours); sh scripts/trials/supervisor.sh <port> starts one' : ''}`);
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
  for (const r of reviewLines(m)) if (r.met === false) say(r.id, r.text);
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

// A trial's window: its record, the frames of the last minutes and the
// positions of the history before them, and its bot log's tail. The trail
// map (trail-map.js) draws from the same window the audit judges.
function trialWindow({ port, world }, { minutes, historyMinutes, now = Date.now() }) {
  let trial = {};
  try { trial = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'midgame', `${world}.json`), 'utf8')); } catch (_) {}
  const started = Date.parse(trial.startedAt);
  const to = now, from = Math.max(now - minutes * 60000, Number.isFinite(started) ? started : 0);
  const historyFrom = Math.max(from - historyMinutes * 60000, Number.isFinite(started) ? started : 0);
  const { frames, history } = readFlight({ identity: `127_0_0_1-${port}-Jev`, from, to, historyFrom });
  const botLog = readBotLog(path.join(ROOT, 'artifacts', `midgame-${world}.log`), from);
  // The bot's own record of the world: when it came into the Nether, the
  // fortresses it has seen and when first, its portals (read only).
  let known = null;
  try { known = JSON.parse(fs.readFileSync(path.join(ROOT, '.bot-state', `127_0_0_1-${port}-Jev-world.json`), 'utf8')).known || null; } catch (_) {}
  // The first rod, looked for only where one has been carried.
  let firstRodAt = null;
  const rods = frames.some(f => +f.snapshot?.inventory?.blaze_rod > 0) || trial.verdict?.most?.blazeRods > 0;
  if (rods) {
    const netherAt = known?.gameProgress?.milestones?.nether_entered?.at;
    firstRodAt = firstCarried({ identity: `127_0_0_1-${port}-Jev`, item: 'blaze_rod', from: Math.max(Number.isFinite(netherAt) ? netherAt : 0, Number.isFinite(started) ? started : 0) });
  }
  return { trial, from, to, frames, history, botLog, known, firstRodAt };
}

function auditTrial({ port, world }, { minutes, historyMinutes, now = Date.now() }) {
  const w = trialWindow({ port, world }, { minutes, historyMinutes, now });
  // The minutes asked for, not the trial's so far: a trial five minutes old
  // has not spent "80% of the window" on anything.
  return { port, world, ...measure({ ...w, minutes, historyMinutes, supervised: require('../../src/quiet-restart').supervised(port) }) };
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
  // The design review's measures, every trial, each against its target.
  out.push('Against the review\'s targets (ok / OVER / - not measurable / . no target):');
  for (const r of rows) {
    out.push(`${r.port} ${r.world}`);
    for (const l of reviewLines(r)) out.push(`  ${l.met === true ? 'ok  ' : l.met === false ? 'OVER' : l.noTarget ? '.   ' : '-   '} ${l.text}`);
  }
  out.push('');
  out.push('Flags, and what raises them:');
  for (const [id, t] of Object.entries(T)) out.push(`  ${id}: ${t.says}`);
  return out.join('\n');
}

// ---- Before and after a deploy, across every trial (note 598) ----
//   --cohort <iso> [--since <iso>]
// Every trial record (artifacts/midgame), each from its start to its
// verdict's end (else the next trial on its port, else now), its time cut
// at the deploy: the flight record's and bot log's measures summed on each
// side, deaths from the servers' own logs, and the minutes to the Nether,
// to a fortress sighted and to the first rod by the side the trial began on
// (a trial running across the deploy began before it).

// The death messages, as scripts/trials/death-index.js finds them (it is a
// script with side effects, so not required).
const DEATH = / Jev ((was|died|fell|drowned|blew|burned|hit the|tried|walked into|suffocated|experienced|went|froze|starved|withered|discovered)[^\n]*)/;
const causeOf = text => text.replace(/ (whilst|while) .*$/, '').replace(/ using \[.*$/, '').trim();

// The deaths in one server log, each with its world (the last "Preparing
// level" before it) and its clock time (local, as the server writes it).
// The day is the archive's name, carried on past midnight, or latest.log's
// last change counted back; a trial's span settles it (resolveDeaths).
function deathsInLog(text, name, mtimeMs) {
  const lines = text.split('\n'), out = [];
  const clock = l => { const m = l.match(/^\[(\d\d):(\d\d):(\d\d)\]/); return m ? (+m[1] * 60 + +m[2]) * 60 + +m[3] : null; };
  let day;
  const named = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (named) day = new Date(+named[1], +named[2] - 1, +named[3]);
  else {
    const m = new Date(mtimeMs);
    let rolls = 0, prev = null;
    for (const l of lines) { const s = clock(l); if (s === null) continue; if (prev !== null && s < prev - 60) rolls++; prev = s; }
    day = new Date(m.getFullYear(), m.getMonth(), m.getDate() - rolls);
  }
  let world = null, prev = null;
  for (const l of lines) {
    const level = l.match(/Preparing level "([^"]+)"/);
    if (level) world = level[1];
    const s = clock(l);
    if (s === null) continue;
    if (prev !== null && s < prev - 60) day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    prev = s;
    const d = l.match(DEATH);
    if (d) out.push({ world, cause: causeOf(d[1]), t: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, s).getTime() });
  }
  return out;
}
function serverDeaths(root = ROOT) {
  const out = [];
  let servers = [];
  try { servers = fs.readdirSync(root).filter(d => /^\.clean-run(-\d+)?$/.test(d)); } catch (_) {}
  for (const dir of servers) {
    const logs = path.join(root, dir, 'logs');
    let names = [];
    try { names = fs.readdirSync(logs).sort(); } catch (_) { continue; }
    for (const f of names) {
      if (!(f.endsWith('.log.gz') || f === 'latest.log')) continue;
      const file = path.join(logs, f);
      try {
        const text = f.endsWith('.gz') ? require('zlib').gunzipSync(fs.readFileSync(file)).toString() : fs.readFileSync(file, 'utf8');
        for (const d of deathsInLog(text, f, fs.statSync(file).mtimeMs)) out.push({ ...d, server: dir });
      } catch (_) {}
    }
  }
  return out;
}
// Each death to its trial: the world's trial whose span holds it, the day
// moved by one either way where the log's day was wrong.
function resolveDeaths(deaths, trials) {
  const byWorld = new Map(trials.map(t => [t.world, t]));
  const out = [];
  for (const d of deaths) {
    const tr = byWorld.get(d.world);
    if (!tr) continue;
    const t = [0, -1, 1].map(k => d.t + k * 86400000).find(t => t >= tr.start - 60000 && t <= tr.end + 5 * 60000);
    if (t !== undefined) out.push({ ...d, t });
  }
  return out;
}

// Every trial record, with its span. A verdict marked done ends it; one not
// done says the minutes as of its last update, which is not the trial's
// end (a trial left running, or stopped without a verdict): the last write
// to its port's flight files before the next trial there ends it, else the
// verdict's minutes, else the next trial or now.
function trialRecords({ since = null, now = Date.now(), dir = path.join(ROOT, 'artifacts', 'midgame'), flight = FLIGHT } = {}) {
  let flightNames = [];
  try { flightNames = fs.readdirSync(flight); } catch (_) {}
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) {}
  const all = [];
  for (const f of names) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    const start = Date.parse(r.startedAt);
    if (!Number.isFinite(start)) continue;
    all.push({ ...r, world: r.world || f.slice(0, -5), start });
  }
  all.sort((a, b) => a.start - b.start);
  for (const [i, t] of all.entries()) {
    const next = all.slice(i + 1).find(n => n.port === t.port)?.start ?? Infinity;
    const v = t.verdict, said = Number.isFinite(v?.minutes) ? (Date.parse(v.from) || t.start) + v.minutes * 60000 : null;
    let ended = v?.done && said !== null ? said : null;
    if (ended === null && t.port) {
      const identity = `127_0_0_1-${t.port}-Jev`;
      for (const f of flightNames) {
        if (!f.startsWith(identity + '-') || !f.endsWith('.jsonl')) continue;
        const s = midgameStart(f.slice(identity.length + 1));
        if (!(s >= t.start - 60000 && s < next)) continue;
        try { const m = fs.statSync(path.join(flight, f)).mtimeMs; if (!(ended >= m)) ended = m; } catch (_) {}
      }
    }
    if (ended === null) ended = said ?? Infinity;
    t.end = Math.max(t.start, Math.min(ended, next, now));
  }
  return all.filter(t => !(since !== null && t.start <= since));
}

// What a read over hours keeps of a frame.
function slimFrame(clock) {
  return f => {
    clockOf([f], clock);
    const s = f.snapshot || {}, d = s.decision;
    return { kind: f.kind, t: f.t, snapshot: { position: s.position, dimension: s.dimension, health: s.health, inventory: s.inventory, survivalAction: s.survivalAction, step: s.step && { action: s.step.action },
      ...(Array.isArray(s.mobs) ? { mobs: s.mobs.map(m => ({ d: m.d, at: m.at })) } : {}),
      ...(d ? { decision: { id: d.id, at: d.at, askedAt: d.askedAt, path: d.path, stale: d.stale, only: d.only, noneGood: d.noneGood, judgments: d.judgments?.length ? [1] : [] } } : {}) } };
  };
}

// One trial's measures on each side of `at`.
function trialSides(tr, at, { dir = FLIGHT, logs = path.join(ROOT, 'artifacts') } = {}) {
  const clock = new Map();
  const { frames } = tr.port ? readFlight({ identity: `127_0_0_1-${tr.port}-Jev`, from: tr.start, to: tr.end, historyFrom: tr.start, dir, slim: slimFrame(clock) }) : { frames: [] };
  const entries = [...clock.values()];
  const split = tr.start >= at ? -Infinity : tr.end <= at ? Infinity : at;
  const log = scanBotLog(path.join(logs, `midgame-${tr.world}.log`), { from: tr.start, split });
  const sides = {};
  for (const [side, a, b] of [['before', tr.start, Math.min(tr.end, at)], ['after', Math.max(tr.start, at), tr.end]]) {
    if (b <= a) continue;
    const fr = frames.filter(f => f.t >= a && f.t < b);
    const en = timeline({ frames: fr, from: a, to: b === tr.end ? b : b - 1, clock: entries });
    const decsAll = decisionsOf(fr), decs = decsAll.filter(d => !d.only);
    const positioned = fr.filter(f => f.snapshot?.position), carried = fr.filter(f => f.snapshot?.inventory && typeof f.snapshot.inventory === 'object');
    const quickBy = {};
    for (const q of quickOf({ decs, positioned, carried })) if (q.quick) quickBy[q.id] = q.quick;
    const waits = waitsOf({ entries: en, decs: decsAll }), stall = stallOf(doingOf(en)), stance = stanceOf({ frames: fr, decs: decsAll });
    const bl = log[side];
    sides[side] = { hours: (b - a) / 3600000, frames: fr.length, clockedMs: waits.clockedMs, waitMs: waits.ms,
      waitBy: Object.fromEntries(Object.entries(waits.by).map(([k, v]) => [k, v * 60000])), stallMs: stall.ms, quickBy,
      byJev: decsAll.filter(d => d.byJev).length, noneGood: decsAll.filter(d => d.noneGood).length, streak: noneGoodStreakOf(decsAll),
      stanceAsks: stance.asks, stillAsks: stance.stillAsks, stillMs: stance.stillMs,
      log: bl?.read ? { holds: Object.values(bl.repeat).reduce((x, y) => x + y, 0), reasked: Object.values(bl.reaskAfterHold).reduce((x, y) => x + y, 0), reaskedBy: bl.reaskAfterHold, asked: Object.values(bl.askedAfterHold || {}).reduce((x, y) => x + y, 0) } : null };
  }
  // The first rod carried, not one the trial began with (a checkpoint's).
  let rodAt = null;
  if (tr.verdict?.most?.blazeRods > 0) { const f = frames.find(f => +f.snapshot?.inventory?.blaze_rod > 0); if (f && f.t - tr.start >= 120000) rodAt = f.t; }
  return { sides, rodAt };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function firstsOf(trials) {
  const said = (xs, eligible, ran) => ({ eligible, reached: xs.length, median: xs.length ? round(median(xs)) : null, min: xs.length ? round(Math.min(...xs)) : null, max: xs.length ? round(Math.max(...xs)) : null, notReachedMedianMinutes: ran.length ? round(median(ran)) : null });
  const minutesRun = t => (t.end - t.start) / 60000;
  const staged = (t, stage) => String(t.source || '').includes(`/stages/${stage}`);
  const at = t => t.verdict?.reachedAtMinute || {};
  const n = trials.filter(t => !String(t.source || '').includes('/stages/'));
  const inNether = trials.filter(t => Number.isFinite(at(t).nether));
  const f = inNether.filter(t => !staged(t, 'fortress'));
  const atFortress = trials.filter(t => staged(t, 'fortress'));
  return {
    nether: said(n.filter(t => Number.isFinite(at(t).nether)).map(t => at(t).nether), n.length, n.filter(t => !Number.isFinite(at(t).nether)).map(minutesRun)),
    fortress: said(f.filter(t => Number.isFinite(at(t).fortress)).map(t => at(t).fortress - at(t).nether), f.length, f.filter(t => !Number.isFinite(at(t).fortress)).map(t => minutesRun(t) - at(t).nether)),
    rod: said(f.filter(t => t.rodAt).map(t => (t.rodAt - t.start) / 60000 - at(t).nether), f.length, f.filter(t => !t.rodAt).map(t => minutesRun(t) - at(t).nether)),
    // A trial begun at a fortress checkpoint counts from its start.
    rodFromFortress: said(atFortress.filter(t => t.rodAt).map(t => (t.rodAt - t.start) / 60000), atFortress.length, atFortress.filter(t => !t.rodAt).map(minutesRun)),
  };
}

function cohort({ at, since = null, now = Date.now(), progress = null, root = ROOT, dir = FLIGHT }) {
  const trials = trialRecords({ since, now, dir: path.join(root, 'artifacts', 'midgame'), flight: dir });
  const deaths = resolveDeaths(serverDeaths(root), trials);
  const blank = () => ({ trials: 0, hours: 0, clockedMs: 0, waitMs: 0, waitBy: {}, stallMs: 0, quickBy: {}, byJev: 0, noneGood: 0, streak: null, stanceAsks: 0, stillAsks: 0, stillMs: 0, logTrials: 0, holds: 0, reasked: 0, reaskedBy: {}, askedAfter: 0, flightTrials: 0 });
  const acc = { before: blank(), after: blank() };
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  trials.forEach((tr, i) => {
    const { sides, rodAt } = trialSides(tr, at, { dir, logs: path.join(root, 'artifacts') });
    tr.rodAt = rodAt;
    for (const [side, s] of Object.entries(sides)) {
      const a = acc[side];
      a.trials++; a.hours += s.hours;
      if (s.frames) a.flightTrials++;
      for (const k of ['clockedMs', 'waitMs', 'stallMs', 'byJev', 'noneGood', 'stanceAsks', 'stillAsks', 'stillMs']) a[k] += s[k];
      for (const [k, v] of Object.entries(s.waitBy)) add(a.waitBy, k, v);
      for (const [k, v] of Object.entries(s.quickBy)) add(a.quickBy, k, v);
      if (s.streak && (!a.streak || s.streak.run > a.streak.run)) a.streak = { ...s.streak, world: tr.world };
      if (s.log) { a.logTrials++; a.holds += s.log.holds; a.reasked += s.log.reasked; a.askedAfter += s.log.asked || 0; for (const [k, v] of Object.entries(s.log.reaskedBy)) add(a.reaskedBy, k, v); }
    }
    if (progress) progress(i + 1, trials.length, tr.world);
  });
  const T = thresholds(0, 0);
  const sideOut = side => {
    const a = acc[side], clockedMin = a.clockedMs / 60000;
    const ds = deaths.filter(d => side === 'before' ? d.t < at : d.t >= at);
    const byCause = {};
    for (const d of ds) byCause[d.cause] = (byCause[d.cause] || 0) + 1;
    const quickTotal = Object.values(a.quickBy).reduce((x, y) => x + y, 0);
    const worstQuick = Object.entries(a.quickBy).sort((x, y) => y[1] - x[1])[0];
    const perHour = n => a.hours ? round(n / a.hours, 3) : null;
    return {
      trials: a.trials, withFlight: a.flightTrials, withBotLog: a.logTrials, hours: round(a.hours, 1), clockedHours: round(clockedMin / 60, 1),
      reaskAfterHold: { total: a.reasked, holds: a.holds, perHour: perHour(a.reasked), by: a.reaskedBy, askedAfterHold: a.askedAfter, met: a.logTrials ? a.reasked <= T.reaskAfterHold.max : null },
      quickNothing: { total: quickTotal, per15: clockedMin ? round(quickTotal * 15 / clockedMin, 1) : null,
        worst: worstQuick ? { id: worstQuick[0], count: worstQuick[1], per15: clockedMin ? round(worstQuick[1] * 15 / clockedMin, 2) : null } : null,
        met: clockedMin ? !(worstQuick && worstQuick[1] * 15 / clockedMin >= T.quickNothing.per15) : null },
      stallShare: { share: clockedMin >= 1 ? round(a.stallMs / a.clockedMs, 3) : null, minutes: round(a.stallMs / 60000), met: clockedMin >= 1 ? a.stallMs / a.clockedMs < T.stallShare.share : null },
      waitShare: { share: clockedMin >= 1 ? round(a.waitMs / a.clockedMs, 3) : null, minutes: round(a.waitMs / 60000), by: Object.fromEntries(Object.entries(a.waitBy).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, round(v / 60000)])),
        met: clockedMin >= 1 ? a.waitMs / a.clockedMs < T.waitShare.share : null },
      stanceRate: { perMinute: a.stillMs >= 60000 ? round(a.stillAsks / (a.stillMs / 60000), 2) : null, stillAsks: a.stillAsks, stillMinutes: round(a.stillMs / 60000), asks: a.stanceAsks,
        met: a.stillMs >= 60000 ? a.stillAsks / (a.stillMs / 60000) < T.stanceRate.perMinute : null },
      noneGood: { count: a.noneGood, byJev: a.byJev, share: a.byJev ? round(a.noneGood / a.byJev, 3) : null, longestRun: a.streak },
      deaths: { total: ds.length, perHour: perHour(ds.length), byCause: Object.fromEntries(Object.entries(byCause).sort((x, y) => y[1] - x[1]).map(([k, n]) => [k, { n, perHour: perHour(n) }])) },
      firsts: firstsOf(trials.filter(t => side === 'before' ? t.start < at : t.start >= at)),
    };
  };
  return { at: new Date(at).toISOString(), since: since === null ? null : new Date(since).toISOString(), trials: trials.length, deathsFound: deaths.length, before: sideOut('before'), after: sideOut('after') };
}

function cohortTable(c) {
  const pct = x => x === null ? '-' : `${round(x * 100, 1)}%`;
  const mark = m => m === true ? 'ok  ' : m === false ? 'OVER' : '-   ';
  const cell = (s, f) => s ? f(s) : '-';
  const rows = [];
  const row = (name, f, target = '', met = null) => rows.push([name, cell(c.before, f), met ? mark(met(c.before)) : '', cell(c.after, f), met ? mark(met(c.after)) : '', target]);
  row('trials (flight, bot log)', s => `${s.trials} (${s.withFlight}, ${s.withBotLog})`);
  row('trial hours (clocked)', s => `${s.hours} (${s.clockedHours})`);
  row('reaskAfterHold', s => `${s.reaskAfterHold.total} (${s.reaskAfterHold.perHour ?? '-'}/h), ${s.reaskAfterHold.holds} holds, ${s.reaskAfterHold.askedAfterHold} asked in all`, '0', s => s.reaskAfterHold.met);
  row('quickNothing', s => `${s.quickNothing.total}, ${s.quickNothing.per15 ?? '-'}/15min${s.quickNothing.worst ? `; most ${s.quickNothing.worst.id} ${s.quickNothing.worst.per15}/15min` : ''}`, 'under 5 a 15 min per question', s => s.quickNothing.met);
  row('stallShare', s => `${pct(s.stallShare.share)} (${s.stallShare.minutes} min)`, 'under 10%', s => s.stallShare.met);
  row('waitShare', s => `${pct(s.waitShare.share)} (${s.waitShare.minutes} min)`, 'under 20%', s => s.waitShare.met);
  row('stance askings, unchanged', s => `${s.stanceRate.perMinute ?? '-'}/min (${s.stanceRate.stillAsks} in ${s.stanceRate.stillMinutes} min; ${s.stanceRate.asks} asked)`, 'under 1 a min', s => s.stanceRate.met);
  row('noneGood share', s => `${pct(s.noneGood.share)} (${s.noneGood.count} of ${s.noneGood.byJev})`);
  row('longest none-good run', s => s.noneGood.longestRun ? `${s.noneGood.longestRun.run} ${s.noneGood.longestRun.id} (${s.noneGood.longestRun.world})` : 'none', 'no target');
  row('deaths per hour', s => `${s.deaths.perHour ?? '-'} (${s.deaths.total})`);
  const causes = [...new Set([...Object.keys(c.before?.deaths.byCause || {}), ...Object.keys(c.after?.deaths.byCause || {})])];
  causes.sort((x, y) => ((c.before?.deaths.byCause[y]?.n || 0) + (c.after?.deaths.byCause[y]?.n || 0)) - ((c.before?.deaths.byCause[x]?.n || 0) + (c.after?.deaths.byCause[x]?.n || 0)));
  for (const k of causes) row(`  ${k}`.slice(0, 48), s => s.deaths.byCause[k] ? `${s.deaths.byCause[k].perHour} (${s.deaths.byCause[k].n})` : '0');
  const first = f => f.eligible ? `${f.reached} of ${f.eligible}${f.reached ? `, median ${f.median} (${f.min}-${f.max})` : ''}${f.notReachedMedianMinutes !== null && f.reached < f.eligible ? `; the rest ran ${f.notReachedMedianMinutes} median` : ''}` : 'no trial';
  row('min to the Nether (from start)', s => first(s.firsts.nether), 'trials begun outside the checkpoints');
  row('min Nether to fortress seen', s => first(s.firsts.fortress), '30 (ours); not begun at a fortress checkpoint');
  row('min Nether to first rod', s => first(s.firsts.rod), '60 (ours)');
  row('min fortress checkpoint to first rod', s => first(s.firsts.rodFromFortress), 'trials begun at a fortress checkpoint');
  const head = ['measure', 'before', '', 'after', '', 'target'];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = r => r.map((x, i) => x.padEnd(width[i])).join('  ').trimEnd();
  return [`Before and after ${c.at}${c.since ? `, trials begun after ${c.since}` : ', every trial'}: ${c.trials} trials, ${c.deathsFound} deaths in the server logs matched to them.`,
    'A trial running across the deploy counts on both sides by time; the minutes-to measures go by the side the trial began on.', '',
    line(head), ...rows.map(line)].join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : dflt; };
  const time = name => { const i = argv.indexOf(`--${name}`); if (i < 0) return null; const t = Date.parse(argv[i + 1]); if (!Number.isFinite(t)) throw new Error(`--${name} needs a time, as 2026-09-28T06:45Z`); return t; };
  const minutes = opt('minutes', 15), historyMinutes = opt('history', 60), json = argv.includes('--json');
  const since = time('since'), at = time('cohort');
  if (argv.includes('--by-commit')) {
    const { readRuns, groupByCommit, commitTable } = require('../lib/flight-commit');
    const to = time('to');
    const rows = groupByCommit(readRuns(FLIGHT, { from: since ?? -Infinity, to: to ?? Infinity }));
    console.log(json ? JSON.stringify(rows, null, 2) : commitTable(rows));
    return;
  }
  if (at !== null) {
    const c = cohort({ at, since, progress: (i, n, w) => process.stderr.write(`\r${i}/${n} ${w}`.padEnd(60)) });
    process.stderr.write('\n');
    console.log(json ? JSON.stringify(c, null, 2) : cohortTable(c));
    return;
  }
  const named = argv.filter((a, i) => /^\d+$/.test(a) && !/^--/.test(argv[i - 1] || ''));
  let trials = named.length ? named.map(p => ({ port: Number(p), world: worldOn(Number(p)) })).filter(t => t.world) : runningPorts();
  if (since !== null) trials = trials.filter(t => { try { return Date.parse(JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts', 'midgame', `${t.world}.json`), 'utf8')).startedAt) > since; } catch (_) { return false; } });
  const rows = trials.map(t => auditTrial(t, { minutes, historyMinutes }));
  if (json) console.log(JSON.stringify(rows.map(({ byDoing, ...r }) => ({ ...r, byDoing, targets: reviewLines(r) })), null, 2));
  else console.log(table(rows, minutes, historyMinutes));
}

if (require.main === module) main();
module.exports = { steady, readFlight, readBotLog, scanBotLog, firstCarried, measure, reviewLines, thresholds, table, trialWindow, runningPorts, worldOn, ROOT,
  waitsOf, stanceOf, noneGoodStreakOf, decisionsOf, timeline, deathsInLog, resolveDeaths, trialRecords, trialSides, cohort, cohortTable };
