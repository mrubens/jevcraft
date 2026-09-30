'use strict';
// Questions asked round and round (note 749). Read from the flight records;
// read-only.
//   node scripts/ask-loops.js [--since 2026-09-30T06:00Z] [--until ...] [--port 25594] [--top 20] [--json] [--triggers] [--commit]
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
// With --triggers (note 764) each asking again of a question is put to what
// the record shows set it off (triggerOf below), by question, ranked by the
// minutes of re-asks within 30 s. With --commit the asks are walked through
// the commitment rule (src/decisions/commit.js; turn_priority's ruling,
// arbiter.js; win_strategy's going to the Nether, strategy.js) and the
// figures printed again for the asks that would still go to Jev.
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
  const asks = [], takenBack = [], stale = [], positions = [], weak = [], errors = [];
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
    // Failures said between two askings (note 764): an error, a walk with no
    // route, a stalled walk.
    if (/^\{"kind":"(error|no_route|navigation_stall)"/.test(line)) {
      const t = Number.isFinite(t0) ? t0 : NaN;
      if (Number.isFinite(t) && t >= since && t <= until) errors.push({ t, label: (line.match(/"label":"([^"]{0,80})/) || [])[1] || '' });
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
    // A least bad taken on a sliver (note 749c): none good at twice the best
    // listed or more, and something other than none good acted on.
    { const listedW = Object.entries(probs).filter(([k]) => k !== 'none_good').sort((a, b) => b[1] - a[1]);
      const ngW = probs.none_good || 0, bestW = listedW[0]?.[1] || 0;
      if (ngW > 0 && ngW >= 2 * bestW && d.path[0] !== 'none_good') {
        const KEEP = /^(carry_on|keep_on|go_on|keep_at_it|continue_request|search_on|wait_here)$/;
        const calm = Object.entries(d.options || {}).find(([k, n]) => k !== 'none_good' && (n?.ladderNext || KEEP.test(k)));
        weak.push({ t, id: d.id, took: d.path.join('/'), calm: calm ? calm[0] : null, safety: /^(encounter_stance|body_way|shot_answer|ranged_response)$/.test(d.id) });
      } }
    const topKey = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    asks.push({ t, id: d.id, choice: d.path.join('/'), pos: P(s.position), dimension: s.dimension, kinds: Object.keys(s.inventory || {}), top: topKey, noneGood: topKey === 'none_good',
      ids: leaves(d.options), state: d.state, options: d.options, health: s.health, inventory: s.inventory, food: s.food, mobs: s.mobs,
      deaths: (s.goal?.survival?.deaths || []).length || 0 });
  }
  return { asks, takenBack, stale, positions, weak, errors, minutes: first && last ? (last - first) / 60000 : 0 };
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
    if (i.q === 'climb_out') return true; // not an intention before note 749c
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
    // climb_out's ways carry their target from note 749c on; the records
    // before it do not: read as the trips they now are.
    const climb = a.id === 'climb_out' && !/^none_good$/.test(key);
    const trip = I.tripOf(a.id, key, node) || (climb ? 'open sky' : null);
    if (I.committing(a.id, key, node) || climb) { cur = { q: a.id, choice: key, t: a.t, target: P(node?.target), trip, dimension: a.dimension, health: a.health }; out.trips++; }
  }
}
// What set off each asking again of a question (note 764), as far as the
// record shows, first that applies: its last answer failed (an error, a walk
// with no route or stalled, said between the two), its last answer was
// thrown away as stale, it arrived (its target within 4 blocks), a named
// fact changed band (the dimension, the health band falling or back to
// full, the hunger band, the mobs that threaten within 16 by kind and
// number, a kind of thing carried got or gone, 16 blocks walked), a new
// option was offered; else nothing the record names changed, and the asking
// was its caller's poll. turn_priority's own reason (its state's `why`, the
// arbiter's broken()) is kept beside.
function facts(a) { return require('../src/decisions/commit').factsFromSnapshot({ position: a.pos, dimension: a.dimension, health: a.health, food: a.food, inventory: a.inventory, mobs: a.mobs }, a.t, a.deaths || 0); }
function triggerOf(prev, a, { errors, stale }) {
  const C = require('../src/decisions/commit');
  const err = errors.find(e => e.t > prev.t && e.t <= a.t);
  if (err) return /Threat nearby|Preempted|hurt|creeper|NeedsSafety/i.test(err.label) ? 'stopped by a threat' : 'failed';
  if (stale.some(x => x.id === a.id && x.t > prev.t && x.t <= a.t)) return 'stale';
  const node = leafNode(prev.options, prev.choice), tgt = P(node?.target);
  if (tgt && a.pos && dist(tgt, a.pos) <= 4) return 'arrived';
  const f0 = facts(prev), f1 = facts(a);
  if (f0.dimension && f1.dimension && f0.dimension !== f1.dimension) return 'fact: dimension';
  const hb0 = C.healthBand(f0.health), hb1 = C.healthBand(f1.health);
  if (hb0 != null && hb1 != null && (hb1 < hb0 || (hb1 === 5 && hb0 !== 5))) return 'fact: health band';
  if (C.foodBand(f0.food) !== C.foodBand(f1.food)) return 'fact: hunger band';
  if (C.threatsChanged(f0.threats, f1.threats)) return 'fact: threats';
  const k0 = Object.keys(f0.inv || {}), k1 = Object.keys(f1.inv || {});
  if (k1.some(k => !k0.includes(k)) || k0.some(k => !k1.includes(k))) return 'fact: a kind carried got or gone';
  if (f0.pos && f1.pos && dist(f0.pos, f1.pos) >= 16) return 'fact: moved 16+';
  const offered0 = new Set(Object.keys(prev.ids || {}));
  if (Object.keys(a.ids || {}).some(k => !offered0.has(k))) return 'new option';
  return 'poll';
}
function triggersMeasure(asks, ev, out) {
  const lastOf = {};
  for (const a of asks) {
    const prev = lastOf[a.id]; lastOf[a.id] = a;
    if (!prev) continue;
    const gap = a.t - prev.t;
    const r = out[a.id] ||= { reasks: 0, within: 0, ms: 0, by: {}, byWithin: {}, why: {} };
    r.reasks++;
    const k = triggerOf(prev, a, ev);
    r.by[k] = (r.by[k] || 0) + 1;
    if (gap <= WITHIN) {
      r.within++; r.ms += gap; r.byWithin[k] = (r.byWithin[k] || 0) + 1;
      if (a.id === 'turn_priority') { const w = String(a.state?.why || '?').replace(/\d+(\.\d+)?/g, 'N').replace(/: .*/, ''); r.why[w] = (r.why[w] || 0) + 1; }
    }
  }
}
// What the recorded options do not carry and the builder now puts on them:
// the night mine's ore as its kind and the line its yield is held to
// (survival.js nightTarget), read back from the option's own words.
const REPLAY_NODES = {
  night_mine_target: options => Object.fromEntries(Object.entries(options).map(([k, n]) => {
    const d = typeof n?.description === 'string' ? n.description : '';
    const kind = (d.match(/^Dig to the (?:deepslate )?([a-z]+) ore/) || [])[1];
    if (!/^ore_\d+$/.test(k) || !kind) return [k, n];
    const c = d.match(/\((\d+) ([a-z ]+?) carried;/);
    const item = c ? c[2].replaceAll(' ', '_') : null, carried = c ? Number(c[1]) : 0;
    const more = /still wants (\d+) more/.test(d) ? Number(d.match(/still wants (\d+) more/)[1]) : /wants no more/.test(d) ? 0 : null;
    let cap; try { cap = require('../src/inventory-tidy').capOf(item); } catch (_) { cap = undefined; }
    const line = item ? require('../src/decisions/commit').needLine(carried, more, cap) : null;
    return [k, { ...n, commit: { as: `ore:${kind}`, until: line ? { items: { [item]: line } } : {} } }];
  })),
};
// turn_priority's ruling as a commitment (arbiter.js broken, note 764), over
// its recorded asks: each ask's own reason (its state's `why`) read against
// the ruling the rule would still hold. A fight ruling (survival's
// escape_threat or creeper_back_off) holds through a newcomer, its own step
// stopped, health or food falling and survival's own alert; a minute passed
// holds where the scene is as it was (the claims' layers and actions, the
// kinds of mob within 16, the food band), up to five minutes; "no ruling"
// (the ruling dropped by a reflex's pass or the winner's claim alone, which
// now keep it) is held where the same layers claim, the winner among them,
// within its minute or the same scene, and neither health fell six nor the
// food band moved (a fight excepted). The record cannot tell a reflex's pass
// from another claim's alone, so the last is an upper bound.
function turnReplay(asks, out) {
  const FIGHT = /^(escape_threat|creeper_back_off)$/;
  const A = require('../src/arbiter');
  const kinds16 = a => [...new Set((a.mobs || []).filter(m => m.d <= 16).map(m => m.name))].sort().join(',');
  const layersOf = a => Object.keys(a.options || {}).filter(k => k !== 'none_good').sort().join('|');
  const sceneOf = a => `${Object.entries(a.options || {}).filter(([k]) => k !== 'none_good').map(([k, n]) => `${k}:${n?.description?.action}`).sort().join('|')}#${kinds16(a)}#${A.foodBand(a.food)}`;
  let r = null;
  const kept = [];
  for (const a of asks) {
    if (a.id !== 'turn_priority') { kept.push(a); continue; }
    out.asks++;
    const why = String(a.state?.why || '');
    let held = false;
    const w = r && a.options?.[r.winner];
    if (r && w && a.t - r.at0 < A.RULING_MAX_MS) {
      const fight = r.winner === 'survival' && FIGHT.test(w.description?.action || '');
      const sameLayers = layersOf(a) === r.layers;
      if (/^a minute passed/.test(why)) held = sceneOf(a) === r.scene;
      else if (/^(its winner was stopped|a newcomer within six blocks|health fell|food crossed a band)/.test(why)) held = fight;
      else if (/^the claims changed/.test(why)) held = fight && sameLayers;
      else if (/^no ruling/.test(why)) held = sameLayers && (a.t < r.until || sceneOf(a) === r.scene) && (fight || (!(a.health <= r.health - 6) && A.foodBand(a.food) === r.band));
      if (held) { out.held++; const k = why.replace(/: .*/, '').replace(/\d+/g, 'N'); out.by[k] = (out.by[k] || 0) + 1; if (/^a minute/.test(why) || a.t >= r.until) r.until = a.t + A.RULING_MS; continue; }
    }
    kept.push(a);
    const winner = a.choice.split('/')[0];
    r = { winner, layers: layersOf(a), scene: sceneOf(a), at0: a.t, until: a.t + A.RULING_MS, health: a.health, band: A.foodBand(a.food) };
  }
  return kept;
}
// win_strategy's going to the Nether held as one answer (strategy.js, note
// 764): after nether_first or stage_reach_nether, asked again only when the
// dimension changes, ten minutes pass, the portal's stage is not on offer, or
// the ladder is working on a phase the answer's beforeTheNether did not name
// (a rung neither open nor known then; read from the words, an
// approximation of openRungs).
function strategyReplay(asks, out) {
  let h = null;
  const kept = [];
  const named = a => String(a.state?.beforeTheNether || '').toLowerCase();
  for (const a of asks) {
    if (a.id !== 'win_strategy') { kept.push(a); continue; }
    out.asks++;
    if (h && a.t - h.at < 10 * 60000 && a.dimension === h.dimension && a.options?.stage_reach_nether) {
      const w = String(a.state?.workingOn || '').toLowerCase();
      if (w === 'reach nether' || h.named.includes(w)) { out.held++; continue; }
    }
    kept.push(a);
    const c = a.choice.split('/').at(-1);
    h = /^(nether_first|stage_reach_nether)$/.test(c) ? { at: a.t, dimension: a.dimension, named: named(a) } : null;
  }
  return kept;
}
// The commitment rule (src/decisions/commit.js) over the recorded asks: each
// question whose definition declares what ends its answers (define's
// `commit`) is walked in order; an ask while the last answer's commitment
// holds is one the rule would have answered with the held answer. The ask
// after it is where the record shows it ended, so what followed is the
// record's (an answer held is taken to have gone on as it was).
function commitMeasure(asks, ev, out) {
  const C = require('../src/decisions/commit');
  const D = require('../src/decisions');
  const byId = {};
  for (const a of asks) (byId[a.id] ||= []).push(a);
  const kept = new Set(asks);
  for (const [id, list] of Object.entries(byId)) {
    let def; try { def = D.question(id); } catch (_) { continue; }
    if (!def.commit) continue;
    let prevT = -Infinity;
    const walked = list.map(a => {
      const failedSince = ev.errors.some(e => e.t > prevT && e.t <= a.t && !/Threat nearby|Preempted|hurt|creeper|NeedsSafety/i.test(e.label));
      prevT = a.t;
      const tree = REPLAY_NODES[id] ? REPLAY_NODES[id](a.options || {}) : (a.options || {});
      return { t: a.t, id, choice: a.choice, tree, facts: facts(a), failedSince, a };
    });
    const r = C.replay(def, walked);
    const o = out[id] ||= { asks: 0, held: 0, ends: {} };
    o.asks += list.length; o.held += r.held.length;
    for (const [k, n] of Object.entries(r.ends)) o.ends[k] = (o.ends[k] || 0) + n;
    for (const h of r.held) kept.delete(h.a);
  }
  return asks.filter(a => kept.has(a));
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
  const trig = {}, committed = {}, afterCommit = {}, turnHeld = { asks: 0, held: 0, by: {} }, stratHeld = { asks: 0, held: 0 };
  let commitAsks = 0;
  const trips = { trips: 0, turned: 0, before: 0, after: 0, pairsBefore: {}, pairsAfter: {} };
  const extra = { takenBack: 0, takenBackHeld: 0, stale: 0, staleWatched: 0, staleBy: {}, weak: 0, weakCalm: 0, weakNone: 0, weakBy: {} };
  for (const f of files) {
    const { asks, takenBack, stale, positions, weak, errors, minutes: m } = await readFile(path.join(dir, f));
    if (argv.includes('--triggers')) triggersMeasure(asks, { errors, stale }, trig);
    if (argv.includes('--commit')) {
      const left = strategyReplay(turnReplay(commitMeasure(asks, { errors, stale }, committed), turnHeld), stratHeld);
      commitAsks += left.length; measure(left, afterCommit, f);
    }
    for (const w of weak) { if (w.safety) continue; extra.weak++; (extra.weakBy[w.id] = (extra.weakBy[w.id] || 0) + 1); if (w.calm && w.calm !== w.took.split('/')[0]) extra.weakCalm++; else if (!w.calm) extra.weakNone++; }
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
  console.log(`least bad taken with none good at twice the best listed or more (not the stance or the body's own): ${extra.weak} (${Object.entries(extra.weakBy).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ')}); an option that changes nothing was on offer and not taken: ${extra.weakCalm} (now taken); none on offer: ${extra.weakNone} (marked weak; win_strategy goes on with the ladder's stage)`);
  if (argv.includes('--trips')) {
    console.log(`\ntrips and timed answers to plan questions: ${trips.trips}; turned round within ${WITHIN / 1000} s by a plan answer that does not carry them on, before arriving or failing: ${trips.turned}`);
    console.log(`  that answer on offer under the gate as it was (the ERRANDS list): ${trips.before}; under note 749's (a trip by what its option is): ${trips.after}`);
    const show = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`).join('\n');
    console.log(`  before:\n${show(trips.pairsBefore)}\n  after:\n${show(trips.pairsAfter) || '    none'}`);
  }
  table(before, 'as asked');
  if (argv.includes('--triggers')) {
    const rows = Object.entries(trig).sort((a, b) => b[1].ms - a[1].ms).slice(0, top);
    const kinds = ['failed', 'stopped by a threat', 'stale', 'arrived', 'fact: dimension', 'fact: health band', 'fact: hunger band', 'fact: threats', 'fact: a kind carried got or gone', 'fact: moved 16+', 'new option', 'poll'];
    const all = Object.values(trig).reduce((s, r) => { s.within += r.within; s.ms += r.ms; for (const [k, n] of Object.entries(r.byWithin)) s.by[k] = (s.by[k] || 0) + n; return s; }, { within: 0, ms: 0, by: {} });
    console.log(`\nre-asks within 30 s of the same question, by what the record shows set them off (note 764): ${all.within}, ${(all.ms / 60000).toFixed(0)} re-ask minutes (the gaps summed)`);
    console.log(`  all: ${kinds.filter(k => all.by[k]).map(k => `${k} ${Math.round(100 * all.by[k] / all.within)}%`).join(', ')}`);
    console.log('re-ask min\t<=30s\t' + kinds.map(k => k.replace('fact: ', '').replace('a kind carried got or gone', 'kinds').replace('stopped by a threat', 'stopped').slice(0, 8)).join('\t') + '\tquestion');
    for (const [id, r] of rows) console.log(`${(r.ms / 60000).toFixed(1)}\t\t${r.within}\t${kinds.map(k => r.byWithin[k] ? `${Math.round(100 * r.byWithin[k] / r.within)}%` : '-').join('\t')}\t${id}`);
    if (trig.turn_priority) console.log(`turn_priority's own reason at its re-asks within 30 s: ${Object.entries(trig.turn_priority.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; ')}`);
  }
  if (argv.includes('--commit')) {
    console.log(`\nreplayed through the commitment rule (note 764, src/decisions/commit.js): ${asksAll} asks become ${commitAsks} (${(commitAsks / hours).toFixed(1)} a bot-hour); held by question:`);
    for (const [id, r] of Object.entries(committed).sort((a, b) => b[1].held - a[1].held)) console.log(`  ${id}: ${r.asks} -> ${r.asks - r.held} (${r.held} held); ended by ${Object.entries(r.ends).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    console.log(`  turn_priority (arbiter.js ruling): ${turnHeld.asks} -> ${turnHeld.asks - turnHeld.held} (${turnHeld.held} held; by the reason it had been asked: ${Object.entries(turnHeld.by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')})`);
    console.log(`  win_strategy (going to the Nether held): ${stratHeld.asks} -> ${stratHeld.asks - stratHeld.held} (${stratHeld.held} held)`);
    table(afterCommit, 'after the commitment rule');
  }
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
