'use strict';
// How the stance prices compare with what the stances took (note 631 (3): the
// holding stances were priced two to three times what they took). From the
// flight records: every encounter_stance answer Jev gave, the damage its
// chosen option's description said ("About 3.7 damage from the mobs here in
// the next fifteen seconds this way"; the fight's "about 20.2 of it in the
// first fifteen seconds"; a run's or a charge's "about 7 damage ... over the
// 2.3 seconds"; a meal's), and the damage the bot took in that same window
// from the moment the answer was given (the game's damage events with the
// health drop that followed, as scripts/blaze-record.js reads them).
// Per option: how many answers, the median priced (raw, and capped at the
// health the bot had: it cannot take more than it has), the median taken,
// the ratio of the two, and a flag where |priced - taken| / taken exceeds 50%.
//
// What it can measure: the figure a description states for a window, against
// the damage events in that window, per option, over every answer whose
// window the record covers whole.
// What it cannot: (1) the price is only as stated, so an option whose
// description states no figure is counted as "no figure" and left out;
// (2) the taken damage is all damage (fire, falls, lava, a mob the price did
// not count), where the price is "from the mobs here"; (3) the stance often
// ends before the window does (it is held until it fails, the health falls by
// six, or another question is asked), and the bot may have done other
// things in it: this is the damage after the choice, not caused by the choice
// alone; (4) what was chosen is not chosen at random, so an option's rows say
// what happened where Jev picked it, not what it would have cost anywhere;
// (5) a window the record does not cover whole (the run ended, the bot
// reconnected) is dropped unless the bot died in it, which biases a little
// toward the kept; (6) the record cannot say what the priced option would
// have taken had another been chosen.
//   node scripts/price-calibration.js [--dir <flight dir>] [--from ISO] [--to ISO] [--nether] [--min-n 5] [--json]
const path = require('node:path');
const { hurts, eachFile } = require('./blaze-record');

const WINDOW_S = 15, FLAG = 0.5;

// The damage a description prices, the seconds it prices it over and the
// health it starts from: { priced, seconds, health } or null where it states
// no figure. Sentences saying what the arena measured are other figures.
function priceOf(desc) {
  const sentences = String(desc || '').split(/(?<=\.) (?=[A-Z])/).filter(s => !/^(Measured in the arena|Measured with|The arena's)/.test(s));
  const num = x => (x === 'fifteen' ? 15 : Number(x));
  const healthOf = s => { const h = /from ([\d.]+) health/.exec(s); return h ? Number(h[1]) : null; };
  for (const s of sentences) {
    let m = /about ([\d.]+) of it in the first (fifteen|[\d.]+) seconds/i.exec(s);
    if (m) return { priced: Number(m[1]), seconds: num(m[2]), health: healthOf(s) ?? healthOf(desc) };
    m = /^About ([\d.]+) damage over the ([\d.]+) seconds/.exec(s);
    if (m) return { priced: Number(m[1]), seconds: Number(m[2]), health: healthOf(s) };
    m = /[Aa]bout ([\d.]+) damage.*? in the (?:next )?(fifteen|[\d.]+) seconds/.exec(s);
    if (m) return { priced: Number(m[1]), seconds: num(m[2]), health: healthOf(s) };
    m = /^About ([\d.]+) damage from the shooters in range over those seconds/.exec(s);
    const run = /about ([\d.]+) seconds at a run/.exec(desc);
    if (m && run) return { priced: Number(m[1]), seconds: Number(run[1]), health: healthOf(s) };
    m = /^About ([\d.]+) damage from the mobs here while it eats/.exec(s);
    const meal = /about ([\d.]+) seconds standing still/.exec(desc);
    if (m && meal) return { priced: Number(m[1]), seconds: Number(meal[1]), health: healthOf(s) };
  }
  return null;
}

// The answers in one connection's frames (sorted by time), each with the
// damage taken in its window: { option, priced, capped, taken, seconds,
// health, died, at }, or `dropped` counts where the record does not cover it.
function calibrate(frames, { from = -Infinity, to = Infinity, nether = false } = {}) {
  const out = [], dropped = { noFigure: 0, unfinished: 0 };
  const ev = hurts(frames), last = frames.length ? frames[frames.length - 1].at : 0, seen = new Set();
  for (let i = 0; i < frames.length; i++) {
    const x = frames[i];
    const d = x.kind === 'decision' && x.snapshot?.decision;
    if (!d || d.id !== 'encounter_stance' || !d.judgments?.length || d.stale) continue;
    const t0 = Date.parse(d.at) || x.at, key = t0;
    if (seen.has(key) || !(t0 >= from && t0 <= to)) continue;
    seen.add(key);
    if (nether && x.snapshot.dimension !== 'the_nether') continue;
    // shoot_<entity id> is one option, aimed at a different mob each time.
    const chosen = d.path?.[0], option = /^shoot_\d+$/.test(chosen) ? 'shoot' : chosen, price = priceOf(d.options?.[chosen]?.description);
    if (!price) { dropped.noFigure++; out.push({ option, none: true }); continue; }
    const end = t0 + price.seconds * 1000;
    let died = false, prev = x.snapshot.health, reconnected = false;
    for (let j = i; j < frames.length && frames[j].at <= end; j++) {
      const f = frames[j];
      if (f.at < t0) continue;
      if (f.kind === 'connection') reconnected = true;
      const h = f.snapshot?.health;
      if (typeof h === 'number') { if (h === 0 && prev > 0) died = true; prev = h; }
    }
    if (!died && (last < end + 1000 || reconnected)) { dropped.unfinished++; continue; }
    const taken = ev.filter(e => e.t >= t0 && e.t <= end).reduce((n, e) => n + e.drop, 0);
    const health = price.health ?? x.snapshot.health ?? null;
    out.push({ option, priced: price.priced, capped: health != null ? Math.min(price.priced, health) : price.priced, taken: Math.round(taken * 100) / 100, seconds: price.seconds, health, died, at: t0 });
  }
  return { answers: out, dropped };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r1 = x => x === null ? null : Math.round(x * 10) / 10;

// Priced against taken: OVER where the price is above what was taken by more
// than half of it, UNDER where below; with nothing taken, a price over half
// a point is OVER.
function flagOf(priced, taken) {
  const off = taken > 0 ? (priced - taken) / taken : priced > 0.5 ? Infinity : 0;
  return Math.abs(off) > FLAG ? (off > 0 ? 'OVER' : 'UNDER') : '';
}

// Answers to one row per option. Two flags, since most windows take nothing
// and a median of zeros hides the ones that did: the medians', and the
// means' (the total priced against the total taken, which is where note 631's
// two to three times was read).
function table(answers, { minN = 5 } = {}) {
  const by = {}, none = {};
  for (const a of answers) { if (a.none) none[a.option] = (none[a.option] || 0) + 1; else (by[a.option] ||= []).push(a); }
  const rows = Object.entries(by).map(([option, list]) => {
    const p = median(list.map(a => a.priced)), c = median(list.map(a => a.capped)), t = median(list.map(a => a.taken));
    const mc = mean(list.map(a => a.capped)), mt = mean(list.map(a => a.taken));
    return { option, n: list.length, noFigure: none[option] || 0, medianPriced: r1(p), medianCapped: r1(c), medianTaken: r1(t), ratio: t > 0 ? Math.round(c / t * 100) / 100 : null,
      meanCapped: r1(mc), meanTaken: r1(mt), meanRatio: mt > 0 ? Math.round(mc / mt * 100) / 100 : null, died: list.filter(a => a.died).length,
      tookAny: list.filter(a => a.taken > 0).length, flag: flagOf(c, t), meanFlag: flagOf(mc, mt), few: list.length < minN };
  }).sort((a, b) => b.n - a.n);
  const noFigureOnly = Object.entries(none).filter(([o]) => !by[o]).map(([option, n]) => ({ option, n }));
  return { rows, noFigureOnly };
}

function print(t, dropped, total, minN) {
  const head = ['option', 'n', 'took any', 'priced (median)', 'capped at health', 'taken (median)', 'ratio', 'flag (median)', 'mean capped / taken', 'flag (mean)', 'died'];
  const few = r => r.few ? ` (n<${minN})` : '';
  const body = t.rows.map(r => [r.option, r.n, r.tookAny, r.medianPriced, r.medianCapped, r.medianTaken, r.ratio ?? '-', r.flag + (r.flag ? few(r) : ''),
    `${r.meanCapped} / ${r.meanTaken}${r.meanRatio ? ` (${r.meanRatio})` : ''}`, r.meanFlag + (r.meanFlag ? few(r) : ''), r.died].map(String));
  const width = head.map((h, i) => Math.max(h.length, ...body.map(r => r[i].length)));
  const line = r => r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd();
  const lines = [line(head), ...body.map(line)];
  lines.push('', `${total} encounter_stance answers by Jev; ${t.rows.reduce((n, r) => n + r.n, 0)} with a stated figure and a whole window, ${dropped.noFigure} with no figure in the chosen option's description, ${dropped.unfinished} dropped (the record ends inside the window or the bot reconnected, and it did not die).`);
  if (t.noFigureOnly.length) lines.push('Options whose description states no figure (not measured): ' + t.noFigureOnly.map(o => `${o.option} ${o.n}`).join(', ') + '.');
  lines.push(`Flags: |capped price - taken| / taken over ${FLAG * 100}%, on the medians and on the means; "(n<${minN})" marks a row too small to lean on; "took any" is how many of the n took any damage in the window. Priced is the damage the chosen option's text said for its window (15 seconds unless it says otherwise); capped is the price held to the health the bot had; taken is every damage event in that window after the answer, whatever caused it.`);
  return lines.join('\n');
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = args.from ? Date.parse(args.from) : -Infinity, to = args.to ? Date.parse(args.to) : Infinity, minN = Number(args['min-n']) || 5;
  const answers = [], dropped = { noFigure: 0, unfinished: 0 };
  const slim = f => {
    const s = f.snapshot || {}, d = s.decision;
    const keepDecision = f.kind === 'decision' && d?.id === 'encounter_stance' && d.judgments?.length;
    return { at: f.at, kind: f.kind, detail: f.kind === 'damage' ? f.detail : undefined, snapshot: { health: s.health, dimension: s.dimension,
      ...(keepDecision ? { decision: { id: d.id, at: d.at, stale: d.stale, path: d.path, judgments: [1], options: { [d.path?.[0]]: { description: d.options?.[d.path?.[0]]?.description } } } } : {}) } };
  };
  const minMtime = Number.isFinite(from) ? from : 0;
  eachFile(dir, minMtime, '"encounter_stance"', frames => {
    const r = calibrate(frames, { from, to, nether: !!args.nether });
    answers.push(...r.answers); dropped.noFigure += r.dropped.noFigure; dropped.unfinished += r.dropped.unfinished;
  }, slim);
  const t = table(answers, { minN });
  const total = answers.length + dropped.unfinished;
  console.log(args.json ? JSON.stringify({ ...t, dropped, total }, null, 1) : print(t, dropped, total, minN));
}

if (require.main === module) main();
module.exports = { priceOf, calibrate, table, print, WINDOW_S };
