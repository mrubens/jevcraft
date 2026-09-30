'use strict';
// Questions asked round and round (note 749). Read from the flight records;
// read-only.
//   node scripts/ask-loops.js [--since 2026-09-30T06:00Z] [--until ...] [--port 25594] [--top 20] [--json]
//
// For every decision Jev weighed (source jev), per bot process (one record
// file), by question:
//   asks, and asks a bot-hour (the bot-hours are every record's first to last
//     frame in the window);
//   within 30 s: the share of asks whose previous asking of the same question
//     in the same record was 30 seconds or less before;
//   none good on top: the share whose likeliest answer was none_good;
//   spells: runs of three or more asks of one question each within 30 s of
//     the one before; their bot-minutes (first ask to last), and of those the
//     minutes of spells that went nowhere (the bot ended fewer than 64 blocks
//     from where the spell began, and carried no new kind of item);
//   renumbered: consecutive askings (within two minutes) that offered the same
//     key for a different thing: its target 8 or more blocks off the last, or,
//     with no target, its words (numbers and headings aside) not the same.
//     A key that names its thing never does; a positional key (biome_0,
//     hunt_1, walk_to_2) does whenever the list is ordered anew, and the
//     ledger's, the least-bad memo's and Jev's own history of it are split.
// With --replay the asks are walked through the ask layer's rules of note
// 749 (src/decisions/loops.js replay) and the same figures are printed for
// the asks that would have gone to Jev.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T06:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const top = Number(arg('top', 20));
const dir = arg('dir', path.join(ROOT, '.bot-state', 'flight'));
const WITHIN = 30000, PAIR = 120000, SPELL_MIN = 3, NOWHERE = 64, MOVED_TARGET = 8;

const P = v => v && Number.isFinite(v.x) ? { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) } : null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// A key that is a place in a list, not a name: ends in a bare ordinal.
const POSITIONAL = /^[a-z_]*[a-z]_\d{1,2}$/;
// An option's words without what changes as the bot moves: numbers,
// headings, distances.
const HEADINGS = /\b(north|south|east|west|north-east|north-west|south-east|south-west|northeast|northwest|southeast|southwest|up|down|above|below|ahead|behind|left|right)\b/g;
const sig = d => String(typeof d === 'string' ? d : JSON.stringify(d || '')).toLowerCase().replace(/-?\d+(\.\d+)?/g, '').replace(HEADINGS, '').replace(/\bblocks?\b/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
function identity(node) {
  const t = P(node?.target);
  return t ? { t } : { s: sig(node?.description) };
}
const sameThing = (a, b) => a.t && b.t ? dist(a.t, b.t) < MOVED_TARGET : a.t || b.t ? false : a.s === b.s;
function leaves(tree, pre = [], out = {}) {
  for (const [k, n] of Object.entries(tree || {})) {
    if (k === 'none_good') continue;
    if (n?.children) leaves(n.children, [...pre, k], out); else out[[...pre, k].join('/')] = identity(n);
  }
  return out;
}

async function readFile(file) {
  const asks = [], takenBack = [], stale = [], positions = [];
  let first = null, last = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const at = line.match(/"at":"(\d{4}-[^"]+Z)"/);
    const t0 = at ? Date.parse(at[1]) : NaN;
    if (Number.isFinite(t0) && t0 >= since && t0 <= until) { first ??= t0; last = t0; }
    // A rung set aside and taken back (asides.js): the chat line says when.
    if (line.startsWith('{"kind":"chat"') && line.includes('after all: I set it aside')) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(o.at || ''), text = JSON.stringify(o.detail || o.snapshot?.chat || o).match(/Back to the ([a-z ]+) after all: I set it aside (\d+) (second|minute)/);
      if (Number.isFinite(t) && t >= since && t <= until && text) takenBack.push({ t, phase: text[1], agoMs: Number(text[2]) * (text[3] === 'minute' ? 60000 : 1000), pos: P(o.snapshot?.position) });
      continue;
    }
    if (!line.startsWith('{"kind":"decision"')) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(o.at || '');
    if (Number.isFinite(t) && t >= since && t <= until && o.source === 'stale' && /Discarded changed-state/.test(o.label || '')) { stale.push({ t, id: o.snapshot?.decision?.id || null }); continue; }
    if (Number.isFinite(t) && t >= since && t <= until && o.snapshot?.position) positions.push({ t, pos: P(o.snapshot.position) });
    if (!Number.isFinite(t) || t < since || t > until || o.source !== 'jev') continue;
    const s = o.snapshot || {}, d = s.decision;
    if (!d?.id || !d.path) continue;
    const probs = d.judgments?.[0]?.probabilities || {};
    const topKey = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    asks.push({ t, id: d.id, choice: d.path.join('/'), pos: P(s.position), dimension: s.dimension, kinds: Object.keys(s.inventory || {}), top: topKey, noneGood: topKey === 'none_good',
      ids: leaves(d.options), state: d.state, options: d.options, health: s.health, inventory: s.inventory });
  }
  return { asks, takenBack, stale, positions, minutes: first && last ? (last - first) / 60000 : 0 };
}

// The figures over one record's asks (all, or those a replay lets through).
// `ups`: where the rule of note 749 sends a spell up (loops.replay): each
// spell is counted as reached when it goes up within it, with the minutes of
// it that came after (the looping the question above is told of, and the
// answers given rest from there).
function measure(asks, by, file, ups = null) {
  const row = id => by[id] ||= { asks: 0, within: 0, noneGoodTop: 0, spells: 0, spellMs: 0, nowhereMs: 0, pairs: 0, renumberedPairs: 0, renumberedKeys: new Set(), longest: null, wentUp: 0, reached: 0, afterUpMs: 0, nowhereAfterUpMs: 0, upAtAsk: [], upAtMs: [] };
  const lastOf = {}, spellOf = {};
  const closeSpell = (id) => {
    const sp = spellOf[id]; delete spellOf[id];
    if (!sp || sp.n < SPELL_MIN) return;
    const r = row(id), ms = sp.end.t - sp.start.t;
    r.spells++; r.spellMs += ms;
    const newKinds = sp.end.kinds.filter(k => !sp.start.kinds.includes(k)).length;
    const net = sp.start.pos && sp.end.pos && sp.start.dimension === sp.end.dimension ? dist(sp.start.pos, sp.end.pos) : Infinity;
    const nowhere = net < NOWHERE && !newKinds;
    if (nowhere) r.nowhereMs += ms;
    const up = ups && ups.find(u => u.id === id && u.t >= sp.start.t && u.t <= sp.end.t);
    if (up) { r.reached++; r.afterUpMs += sp.end.t - up.t; if (nowhere) r.nowhereAfterUpMs += sp.end.t - up.t; r.upAtAsk.push(up.n); r.upAtMs.push(up.t - sp.start.t); }
    if (!r.longest || ms > r.longest.ms) r.longest = { ms, n: sp.n, file, at: new Date(sp.start.t).toISOString().slice(11, 19), net: Math.round(net) };
  };
  for (const a of asks) {
    const r = row(a.id); r.asks++;
    if (a.noneGood) r.noneGoodTop++;
    const prev = lastOf[a.id];
    if (prev && a.t - prev.t <= WITHIN) {
      r.within++;
      const sp = spellOf[a.id] ||= { start: prev, n: 1 };
      sp.n++; sp.end = a;
    } else closeSpell(a.id);
    if (prev && a.t - prev.t <= PAIR) {
      const shared = Object.keys(a.ids).filter(k => POSITIONAL.test(k.split('/').at(-1)) && prev.ids[k]);
      if (shared.length) {
        r.pairs++;
        const moved = shared.filter(k => !sameThing(prev.ids[k], a.ids[k]));
        if (moved.length) { r.renumberedPairs++; for (const k of moved) r.renumberedKeys.add(k.replace(/\d+$/, 'N')); }
      }
    }
    lastOf[a.id] = a;
  }
  for (const id of Object.keys(spellOf)) closeSpell(id);
}

// Trips turned round (note 749, the check-in of 11:02Z's problem 3): an
// answer to a question about the plan that is a trip (src/intention.js
// tripOf: its option has a target it walks to, or its catalogue says where it
// goes) or a timed answer, followed within 30 s by another plan answer that
// does not carry it on, before it arrived (4 blocks), the dimension changed,
// health fell 4 or a failure was said. Counted twice: whether the gate as it
// was (the ERRANDS name list, a trip's own question asked open) would have
// offered the answer that turned it round, and whether the gate of note 749
// would.
const OLD_ERRANDS = /^(fetch_stems|return_for_blocks|return_for_food|restock_food|restock_blocks|blocks_then_cross|back_to_fortress|go_back)$/;
function tripsMeasure(asks, out) {
  const I = require('../src/intention');
  const plan = I.PLAN();
  let cur = null;
  const oldServes = (i, q, key, node, way) => I.KEEP.test(key) || key === 'none_good' || (way ? !way.drops.test(key) : q === i.q ? key === i.choice : (key === i.choice && OLD_ERRANDS.test(key)) || !!(P(node?.target) && i.target && dist(P(node.target), i.target) <= I.NEAR));
  const oldOffers = (i, q, key, node) => {
    const gated = (I.GATED.has(q) || (I.ERRAND_GATED.has(q) && OLD_ERRANDS.test(i.choice))) && !(q === i.q && !OLD_ERRANDS.test(i.choice));
    return !gated || oldServes(i, q, key, node, I.wayOf(q, i));
  };
  const newOffers = (i, q, key, node) => {
    const gated = (I.GATED.has(q) || (I.ERRAND_GATED.has(q) && i.trip)) && !(q === i.q && !i.trip);
    return !gated || I.serves(i, q, key, node, I.wayOf(q, i));
  };
  for (const a of asks) {
    if (!plan.has(a.id)) continue;
    const key = a.choice.split('/').at(-1), node = leafNode(a.options, a.choice);
    if (cur) {
      const ended = a.t - cur.t > WITHIN || (cur.target && a.pos && dist(a.pos, cur.target) <= 4) || (a.dimension && cur.dimension && a.dimension !== cur.dimension) || (Number.isFinite(a.health) && Number.isFinite(cur.health) && a.health <= cur.health - 4) ||
        !!(a.state && (a.state.failedAtOnce || a.state.whatFailedBelow || /failed|ended|done|arrived/.test(String(a.state.lastIntention || ''))));
      if (ended) cur = null;
    }
    if (cur && !(a.id === cur.q && key === cur.choice)) {
      const i = { q: cur.q, choice: cur.choice, target: cur.target, trip: cur.trip };
      if (!I.serves(i, a.id, key, node, I.wayOf(a.id, i)) || !newOffers(i, a.id, key, node) || !oldOffers(i, a.id, key, node)) {
        const pair = `${cur.q}/${cur.choice.replace(/_-?\d+(_-?\d+)*$/, '_<place>')} -> ${a.id}/${key.replace(/_-?\d+(_-?\d+)*$/, '_<place>')}`;
        out.turned++;
        if (oldOffers(i, a.id, key, node)) { out.before++; out.pairsBefore[pair] = (out.pairsBefore[pair] || 0) + 1; }
        if (newOffers(i, a.id, key, node)) { out.after++; out.pairsAfter[pair] = (out.pairsAfter[pair] || 0) + 1; }
        cur = null;
      }
    }
    const trip = I.tripOf(a.id, key, node);
    if (I.committing(a.id, key, node)) { cur = { q: a.id, choice: key, t: a.t, target: P(node?.target), trip, dimension: a.dimension, health: a.health }; out.trips++; }
  }
}
function leafNode(tree, choice) {
  let n = { children: tree };
  for (const k of String(choice).split('/')) n = n?.children?.[k];
  return n || null;
}

async function main() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
    .filter(f => fs.statSync(path.join(dir, f)).mtimeMs >= since);
  const replaying = argv.includes('--replay');
  const loops = replaying ? require('../src/decisions/loops') : null;
  const before = {}, after = {};
  let minutes = 0, asksAll = 0, sentAll = 0;
  const held = {};
  const trips = { trips: 0, turned: 0, before: 0, after: 0, pairsBefore: {}, pairsAfter: {} };
  const extra = { takenBack: 0, takenBackHeld: 0, stale: 0, staleWatched: 0, staleBy: {} };
  for (const f of files) {
    const { asks, takenBack, stale, positions, minutes: m } = await readFile(path.join(dir, f));
    // Set-asides taken back (asides.js): held had the bot been within 16
    // blocks of where it was set aside (read from the record's positions
    // then) within five minutes; a new kind carried or health are not read.
    for (const b of takenBack) {
      extra.takenBack++;
      const then = positions.filter(x => x.t <= b.t - b.agoMs).at(-1);
      if (b.agoMs < 5 * 60000 && then?.pos && b.pos && dist(then.pos, b.pos) < 16) extra.takenBackHeld++;
    }
    // Answers thrown away as stale: from the second in a row of a question
    // within 30 s, the next is watched first (index.js STALE_RUN).
    const runs = {};
    for (const x of stale) {
      extra.stale++; (extra.staleBy[x.id] = (extra.staleBy[x.id] || 0) + 1);
      const r = runs[x.id];
      runs[x.id] = r && x.t - r.at < 30000 ? { n: r.n + 1, at: x.t } : { n: 1, at: x.t };
      if (runs[x.id].n > 2) extra.staleWatched++;
    }
    minutes += m; asksAll += asks.length;
    let ups = null;
    if (loops) {
      const r = loops.replay(asks);
      ups = r.ups;
      sentAll += r.sent.length;
      for (const [why, n] of Object.entries(r.why)) held[why] = (held[why] || 0) + n;
      for (const u of r.ups) { const x = (after[u.id] ||= { wentUp: 0, noneGood: 0, nowhere: 0 }); x.wentUp++; if (/none of its options/.test(u.why)) x.noneGood++; else x.nowhere++; }
      if (argv.includes('--ups')) for (const u of r.ups) console.log(`  up ${f.match(/-(\d{5})-Jev-/)?.[1]} ${new Date(u.t).toISOString().slice(11, 19)} ${u.id} at ask ${u.n}: ${u.why}`);
    }
    measure(asks, before, f, ups);
    if (argv.includes('--trips')) tripsMeasure(asks, trips);
  }
  const hours = minutes / 60;
  const table = (by, label) => {
    const rows = Object.entries(by).sort((a, b) => b[1].spellMs - a[1].spellMs).slice(0, top);
    const all = Object.values(by).reduce((s, r) => ({ asks: s.asks + r.asks, within: s.within + r.within, ng: s.ng + r.noneGoodTop, spellMs: s.spellMs + r.spellMs, nowhereMs: s.nowhereMs + r.nowhereMs }), { asks: 0, within: 0, ng: 0, spellMs: 0, nowhereMs: 0 });
    const renumbering = Object.entries(by).filter(([, r]) => r.renumberedPairs);
    console.log(`\n${label}: ${all.asks} asks (${(all.asks / hours).toFixed(1)} a bot-hour); within 30 s of the same question ${(100 * all.within / Math.max(1, all.asks)).toFixed(1)}%; none good on top ${(100 * all.ng / Math.max(1, all.asks)).toFixed(1)}%; spells ${Math.round(all.spellMs / 60000)} bot-minutes, going nowhere ${Math.round(all.nowhereMs / 60000)}`);
    console.log(`questions whose positional keys named a different thing between consecutive askings: ${renumbering.length} (${renumbering.map(([id, r]) => `${id} ${r.renumberedPairs}/${r.pairs}`).join(', ') || 'none'})`);
    console.log('spell-min\tnowhere\tasks\t/hour\t<=30s\tng top\trenum\tlongest spell\tquestion');
    for (const [id, r] of rows) console.log(`${(r.spellMs / 60000).toFixed(1)}\t\t${(r.nowhereMs / 60000).toFixed(1)}\t${r.asks}\t${(r.asks / hours).toFixed(1)}\t${Math.round(100 * r.within / r.asks)}%\t${Math.round(100 * r.noneGoodTop / r.asks)}%\t${r.renumberedPairs}/${r.pairs}\t${r.longest ? `${r.longest.n} asks ${(r.longest.ms / 60000).toFixed(1)} min ${r.longest.file.match(/-(\d{5})-Jev-/)?.[1]} ${r.longest.at} net ${r.longest.net}` : '-'}\t${id}`);
    return all;
  };
  if (argv.includes('--json')) {
    const plain = by => Object.fromEntries(Object.entries(by).map(([k, r]) => [k, { ...r, renumberedKeys: [...r.renumberedKeys] }]));
    console.log(JSON.stringify({ since: new Date(since).toISOString(), files: files.length, botHours: +hours.toFixed(1), asks: asksAll, before: plain(before), ...(loops ? { after: plain(after), sent: sentAll, held } : {}) }));
    return;
  }
  console.log(`${files.length} records since ${new Date(since).toISOString()}, ${hours.toFixed(1)} bot-hours, ${asksAll} asks weighed by Jev`);
  console.log(`rungs set aside and taken back ("Back to the ... after all: I set it aside ..."): ${extra.takenBack}; within five minutes and 16 blocks of where set aside (held under asides.js): ${extra.takenBackHeld}`);
  console.log(`answers thrown away as stale (the facts changed while out): ${extra.stale} (${Object.entries(extra.staleBy).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ')}); third or later in a row within 30 s of the one before, watched first and not sent while still changing: ${extra.staleWatched}`);
  if (argv.includes('--trips')) {
    console.log(`\ntrips and timed answers to plan questions: ${trips.trips}; turned round within ${WITHIN / 1000} s by a plan answer that does not carry them on, before arriving or failing: ${trips.turned}`);
    console.log(`  that answer on offer under the gate as it was (the ERRANDS list): ${trips.before}; under note 749's (a trip by what its option is): ${trips.after}`);
    const show = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`).join('\n');
    console.log(`  before:\n${show(trips.pairsBefore)}\n  after:\n${show(trips.pairsAfter) || '    none'}`);
  }
  table(before, 'as asked');
  if (loops) {
    console.log(`\nreplayed through note 749's spell rule: ${asksAll - sentAll} spells sent up (${Object.entries(held).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    console.log('went up\tng\tnowhere\tspells reached/all\tmedian at ask, s\tspell-min after up (nowhere)\tquestion');
    const med = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : '-'; };
    for (const [id, r] of Object.entries(before).filter(([, r]) => r.reached).sort((a, b) => b[1].afterUpMs - a[1].afterUpMs)) {
      const u = after[id] || {};
      console.log(`${u.wentUp || 0}\t${u.noneGood || 0}\t${u.nowhere || 0}\t${r.reached}/${r.spells}\t\t\t${med(r.upAtAsk)}, ${Math.round(med(r.upAtMs) / 1000)}\t\t${(r.afterUpMs / 60000).toFixed(1)} (${(r.nowhereAfterUpMs / 60000).toFixed(1)})\t\t\t${id}`);
    }
    const tot = Object.values(before).reduce((s, r) => ({ a: s.a + r.afterUpMs, n: s.n + r.nowhereAfterUpMs }), { a: 0, n: 0 });
    console.log(`spell-minutes after the rule sent the spell up: ${(tot.a / 60000).toFixed(0)} (of spells going nowhere ${(tot.n / 60000).toFixed(0)})`);
  }
}

if (require.main === module) main();
module.exports = { sig, identity, sameThing, leaves, POSITIONAL };
