#!/usr/bin/env node
'use strict';
// Climbs out of the mine, from the flight records (note 768). Read-only.
//   node scripts/climb-record.js [--since 2026-09-30T06:00:00Z] [--until ISO] [--port N] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
//
// A climb spell is a run of frames whose step is ascend_to_surface, no more
// than a minute apart. For each: its seconds, the blocks it rose (the
// highest y reached over the y it began at), the ways it went (the step's
// method: straight_up, walk_then_up, bridge, else the staircase), and
// whether a pickaxe was carried when it began.
// For each climb_out answer: the ways offered and the one chosen, what the
// column overhead held when straight_up was not offered (the question's
// straightUpBlocked), the pickaxes carried, and the chosen way's run until
// the next climb_out answer or its spell's end: seconds and blocks risen,
// against the seconds its option said.
// For each surface_trip climb answer (tripCost's "N blocks up ... about M
// ... It wears U of the W uses"): the quote against the climb it began, in
// seconds, blocks and pickaxe uses (read from the tools on the decision
// frames either side, where the pickaxes carried are the same ones).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T06:00:00Z'));
const until = Date.parse(arg('until', new Date(Date.now() + 60000).toISOString()));
const onlyPort = arg('port');
const asJson = argv.includes('--json');
const GAP_MS = 60000;

const fileStart = f => { const m = f.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const round = (x, n = 1) => Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null;
// "about 35 seconds" / "about 3 minutes" -> seconds; the first one said.
function saidSeconds(text) {
  const m = String(text || '').match(/about (\d+(?:\.\d+)?) (seconds|minutes?)/);
  return m ? Number(m[1]) * (/^min/.test(m[2]) ? 60 : 1) : null;
}
// What the column overhead held, from the question's straightUpBlocked.
function overheadOf(blocked) {
  const b = String(blocked || '');
  if (!b) return null;
  const falls = b.match(/^(\w[\w ]*?) in it would fall on the head/);
  if (falls) return `falls: ${falls[1]}`;
  if (/water or lava/.test(b)) return 'water or lava in or beside it';
  if (/building blocks carried/.test(b)) return 'too few building blocks';
  if (/not all of it is loaded/.test(b)) return 'not loaded';
  const way = b.match(/^(\w[\w ]*?) in the way/);
  return way ? `in the way: ${way[1]}` : b.slice(0, 40);
}
const pickUses = tools => (tools || []).filter(t => /_pickaxe$/.test(t.name));

function readFile(file, port) {
  const frames = [];
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(o.at || o.snapshot?.decision?.at || '');
    if (!(t >= since && t <= until)) continue;
    const s = o.snapshot || {};
    const f = { t, port, kind: o.kind, pos: s.position || null, action: s.step?.action || s.goal?.step?.action || null, method: s.step?.method || s.goal?.step?.method || null,
      picks: s.inventory ? Object.keys(s.inventory).filter(n => /_pickaxe$/.test(n)) : null, dim: s.dimension };
    if (s.tools) f.tools = pickUses(s.tools);
    if (o.kind === 'decision' && s.decision) {
      const d = s.decision;
      f.decision = { id: d.id, path: d.path, state: d.state, options: d.options };
      f.inv = s.inventory || null;
    }
    if (o.kind === 'damage') f.damage = o.detail?.type || o.label;
    frames.push(f);
  }
  return frames;
}

function spellsOf(frames) {
  const spells = [];
  let cur = null;
  for (const f of frames) {
    if (f.kind !== 'observation' || f.action !== 'ascend_to_surface' || !f.pos) continue;
    if (cur && f.t - cur.last <= GAP_MS) {
      cur.last = f.t; cur.top = Math.max(cur.top, f.pos.y); cur.endY = f.pos.y;
      cur.methods.add(f.method || 'staircase');
      continue;
    }
    if (cur) spells.push(cur);
    cur = { port: f.port, t: f.t, last: f.t, fromY: f.pos.y, top: f.pos.y, endY: f.pos.y, methods: new Set([f.method || 'staircase']), hand: f.picks ? !f.picks.length : handAt(frames, f.t) };
  }
  if (cur) spells.push(cur);
  return spells;
}

// The climb a question's answer began: the ascend_to_surface frames from its
// first within 30 s of the answer to the first frame of other work after it.
function runFrom(frames, t0, until = Infinity) {
  let first = null, last = null, methods = new Set();
  for (const f of frames) {
    if (f.t >= until) break;
    if (f.kind !== 'observation' || f.t < t0) continue;
    if (f.action === 'ascend_to_surface') { if (first === null) { if (f.t > t0 + 30000) break; first = f.t; } last = f.t; methods.add(f.method || 'staircase'); }
    else if (first !== null) break;
  }
  return first === null ? null : { t: first, last, methods };
}
// Whether a pickaxe was carried at t: the last frame at or before it that
// lists the pockets.
const handAt = (frames, t) => { const f = [...frames].reverse().find(g => g.picks && g.t <= t); return f ? !f.picks.length : null; };
// The highest y from t0 to t1, and the y at t0.
const riseBase = (frames, t) => frames.find(f => f.pos && f.t >= t)?.pos.y ?? 0;
function riseBetween(frames, t0, t1) {
  let y0 = null, top = -Infinity;
  for (const f of frames) {
    if (!f.pos || f.t < t0) continue;
    if (f.t > t1) break;
    if (y0 === null) y0 = f.pos.y;
    top = Math.max(top, f.pos.y);
  }
  return y0 === null ? null : Math.max(0, Math.round(top - y0));
}
// Pickaxe uses between two times, where the same pickaxes are carried
// either side (a pickaxe made or broken in between leaves it unread).
function usesBetween(frames, t0, t1) {
  const before = [...frames].reverse().find(f => f.tools && f.t <= t0 + 2000 && f.t >= t0 - 120000);
  const after = frames.find(f => f.tools && f.t >= t1 && f.t <= t1 + 120000);
  if (!before || !after) return null;
  const names = xs => xs.map(t => t.name).sort().join(',');
  if (names(before.tools) !== names(after.tools) || !before.tools.length) return null;
  return before.tools.reduce((n, t) => n + t.remaining, 0) - after.tools.reduce((n, t) => n + t.remaining, 0);
}

function main() {
  let names = [];
  try { names = fs.readdirSync(FLIGHT); } catch (_) { console.error(`no flight records at ${FLIGHT}`); process.exit(1); }
  const files = names.filter(n => n.endsWith('.jsonl') && fileStart(n) >= since - 6 * 3600000 && fileStart(n) <= until)
    .filter(n => !onlyPort || n.includes(`-${onlyPort}-Jev-`));
  const spells = [], answers = [], trips = [], digUps = [];
  let records = 0;
  for (const name of files) {
    const port = (name.match(/-(\d{5})-Jev-/) || [])[1];
    const frames = readFile(path.join(FLIGHT, name), port);
    if (!frames.length) continue;
    records++;
    const sp = spellsOf(frames);
    spells.push(...sp);
    const decisions = frames.filter(f => f.decision);
    let lastClimb = null;
    decisions.forEach((f, i) => {
      const d0 = f.decision;
      // unstuck_move's dig up with falling blocks over it, onto the bot's
      // head: offered, chosen, and "in wall" within 15 s of the choice.
      if (d0.id === 'unstuck_move') {
        const up = d0.options?.dig_up?.description || '';
        const fallsIn = /would fall into it, onto the bot's head/.test(up);
        if (fallsIn) {
          const chosen = d0.path?.at(-1) === 'dig_up';
          const hurt = chosen && frames.some(g => g.damage && /wall/.test(g.damage) && g.t >= f.t && g.t <= f.t + 15000);
          digUps.push({ port, at: new Date(f.t).toISOString(), chosen, hurt });
        }
      }
      const d = f.decision;
      if (d.id === 'climb_out') {
        const chosen = d.path?.at(-1);
        const nextAsk = decisions.slice(i + 1).find(g => g.decision.id === 'climb_out' || (g.decision.id === 'surface_trip' && g.decision.path?.at(-1) === 'climb'));
        const run = runFrom(frames, f.t, nextAsk?.t);
        const next = decisions.slice(i + 1).find(g => g.decision.id === 'climb_out');
        const end = Math.min(next?.t ?? Infinity, run ? run.last : f.t);
        const offered = Object.keys(d.options || {}).filter(k => k !== 'none_good');
        const picks = String(d.state?.pickaxes || '');
        const text = d.options?.[chosen]?.description || '';
        const digsSaid = Number((text.match(/about (\d+) blocks dug|(\d+) blocks to dig/) || []).slice(1).find(Boolean)) || null;
        const upSaid = Number((text.match(/(\d+) blocks up/) || [])[1]) || d.state?.blocksToOpenSky || null;
        // Under note 768: a column of falling blocks is offered where a torch
        // is carried or made from a coal and a stick, and a building block
        // is carried for every step (a column beside is not read from the
        // record, so this is the least of it).
        const inv = f.inv || {};
        const scaffold = ['netherrack', 'cobblestone', 'cobbled_deepslate', 'dirt', 'nether_bricks', 'blackstone', 'basalt', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'soul_soil', 'soul_sand'].reduce((n, k) => n + (inv[k] || 0), 0);
        const torch = (inv.torch || 0) > 0 || (((inv.coal || 0) + (inv.charcoal || 0)) > 0 && (inv.stick || 0) > 0);
        const fallsBlocked = /would fall on the head/.test(String(d.state?.straightUpBlocked || ''));
        const offeredNow = fallsBlocked && torch && scaffold >= (d.state?.blocksToOpenSky ?? Infinity);
        // The way a surface_trip climb after it would be held to (chooseClimb's keep).
        lastClimb = { t: f.t, way: chosen, picks: String(d.state?.pickaxes || '').replace(/\s*\(\d+ uses left\)/g, '') };
        const kindsSaid = (text.match(/blocks? (?:dug|to dig) \(([^)]*)\)/) || [])[1] || '';
        answers.push({ port, at: new Date(f.t).toISOString(), offered, chosen, digsSaid, upSaid, kindsSaid, underFalls: /sand|gravel|concrete powder/.test(kindsSaid), fallsBlocked, torch, offeredNow, overhead: offered.includes('straight_up') ? null : overheadOf(d.state?.straightUpBlocked) || 'no column read',
          hand: /no pickaxe/.test(picks), up: d.state?.blocksToOpenSky ?? null, said: saidSeconds(d.options?.[chosen]?.description),
          seconds: Math.max(0, (end - f.t) / 1000), rose: riseBetween(frames, f.t, end), uses: usesBetween(frames, f.t, end) });
      }
      if (d.id === 'surface_trip' && d.path?.at(-1) === 'climb') {
        const text = d.options?.climb?.description || '';
        const m = text.match(/(\d+) blocks up to open sky\. .*?(straight up the column|a staircase), about (\d+) (seconds|minutes?)/);
        const w = text.match(/wears (\d+) of the (\d+) uses/);
        const nextAsk = decisions.slice(i + 1).find(g => g.decision.id === 'surface_trip' && g.decision.path?.at(-1) === 'climb');
        const spell = runFrom(frames, f.t, nextAsk?.t);
        if (!m || !spell) return;
        spell.fromY = riseBase(frames, spell.t); spell.top = spell.fromY + riseBetween(frames, spell.t, spell.last);
        const actualUses = usesBetween(frames, f.t, spell.last);
        // The way held under note 768: the last climb_out answer in this
        // record within ten minutes with the same pickaxes, else the quicker.
        const picksNow = (f.tools || []).map(t => t.name.replaceAll('_', ' ')).sort().join(', ');
        const heldWay = lastClimb && f.t - lastClimb.t <= 10 * 60000 && ['staircase', 'straight_up'].includes(lastClimb.way) ? lastClimb.way : null;
        trips.push({ port, at: new Date(f.t).toISOString(), heldWay, saidUp: Number(m[1]), saidWay: /straight/.test(m[2]) ? 'straight_up' : 'staircase', saidSeconds: Number(m[3]) * (/^min/.test(m[4]) ? 60 : 1),
          saidUses: w ? Number(w[1]) : null, ways: [...spell.methods], seconds: (spell.last - spell.t) / 1000, rose: Math.round(spell.top - spell.fromY), uses: actualUses });
      }
    });
  }
  // Summaries.
  const byWay = {};
  for (const a of answers) {
    const k = `${a.chosen}${a.hand ? ' (hand)' : ' (pickaxe)'}`;
    const w = byWay[k] ||= { chosen: 0, seconds: [], rose: [], said: [], ratio: [], zero: 0, saidPer: [], actualPer: [], usesSaidPer: [], usesPer: [] };
    w.chosen++; w.seconds.push(a.seconds); w.rose.push(a.rose);
    if (a.rose >= 3) {
      w.actualPer.push(a.seconds / a.rose);
      if (a.said && a.upSaid) w.saidPer.push(a.said / a.upSaid);
      if (a.uses != null && !a.hand) w.usesPer.push(a.uses / a.rose);
      if (a.digsSaid && a.upSaid && !a.hand) w.usesSaidPer.push(a.digsSaid / a.upSaid);
    }
    if (a.said) { w.said.push(a.said); if (a.seconds > 0) w.ratio.push(a.seconds / a.said); }
    if (!a.rose) w.zero++;
  }
  const offeredCount = {};
  for (const a of answers) for (const k of a.offered) offeredCount[k] = (offeredCount[k] || 0) + 1;
  const overhead = {};
  for (const a of answers) if (a.overhead) { const k = a.overhead; const o = overhead[k] ||= { asks: 0, hand: 0, zeroRise: 0, seconds: 0 }; o.asks++; if (a.hand) o.hand++; if (!a.rose) o.zeroRise++; o.seconds += a.seconds; }
  const spellSum = hand => { const s = spells.filter(x => x.hand === hand); return { spells: s.length, minutes: round(s.reduce((n, x) => n + (x.last - x.t), 0) / 60000), rose: s.reduce((n, x) => n + Math.max(0, Math.round(x.top - x.fromY)), 0), zeroRise: s.filter(x => x.top - x.fromY < 1).length, zeroRiseMinutes: round(s.filter(x => x.top - x.fromY < 1).reduce((n, x) => n + (x.last - x.t), 0) / 60000) }; };
  const out = {
    window: { since: new Date(since).toISOString(), until: new Date(Math.min(until, Date.now())).toISOString(), records },
    spells: { all: spells.length, pickaxe: spellSum(false), hand: spellSum(true) },
    climbOut: { answers: answers.length, offered: offeredCount, straightUpNotOffered: answers.filter(a => a.overhead).length,
      byWay: Object.fromEntries(Object.entries(byWay).map(([k, w]) => [k, { chosen: w.chosen, medianSeconds: round(median(w.seconds), 0), medianRose: median(w.rose), roseNothing: w.zero, medianSaid: round(median(w.said), 0), secondsABlockSaid: round(median(w.saidPer)), secondsABlock: round(median(w.actualPer)), runsRising3: w.actualPer.length, usesABlockSaid: round(median(w.usesSaidPer), 2), usesABlock: round(median(w.usesPer), 2) }])),
      overheadWhenNoStraightUp: overhead },
    tripQuotes: { n: trips.length, wayDiffers: trips.filter(t => !t.ways.includes(t.saidWay)).length,
      medianSaidSeconds: round(median(trips.map(t => t.saidSeconds)), 0), medianSeconds: round(median(trips.map(t => t.seconds)), 0),
      withUses: trips.filter(t => t.uses != null && t.saidUses != null).length,
      medianUsesOverSaid: round(median(trips.filter(t => t.uses != null && t.saidUses).map(t => t.uses / t.saidUses)), 2),
      medianRoseOverSaidUp: round(median(trips.map(t => t.rose / t.saidUp)), 2),
      secondsABlockSaid: round(median(trips.map(t => t.saidSeconds / t.saidUp))), secondsABlock: round(median(trips.filter(t => t.rose >= 3).map(t => t.seconds / t.rose))),
      usesABlockSaid: round(median(trips.filter(t => t.saidUses != null).map(t => t.saidUses / t.saidUp)), 2), usesABlock: round(median(trips.filter(t => t.uses != null && t.rose >= 3).map(t => t.uses / t.rose)), 2),
      byWaySaid: Object.fromEntries(['straight_up', 'staircase'].map(w => { const ts = trips.filter(t => t.saidWay === w); return [w, { n: ts.length, climbedAnotherWay: ts.filter(t => !t.ways.includes(w)).length, usesOverSaid: round(median(ts.filter(t => t.uses != null && t.saidUses).map(t => t.uses / t.saidUses)), 2) }]; })) },
  };
  // Re-measured under note 768's rules on the same answers.
  const logErr = xs => round(median(xs.map(x => Math.abs(Math.log(x)))), 2);
  const PRIOR = require('../src/quote-record').PRIOR;
  const errs = { before: [], after: [] };
  for (const a of answers) {
    if (a.rose < 3 || !a.said || !a.upSaid || !['staircase', 'straight_up'].includes(a.chosen)) continue;
    const r = PRIOR[`${a.chosen}/${a.hand ? 'hand' : 'pickaxe'}`]?.seconds ?? 1;
    const took = a.seconds / a.rose, said = a.said / a.upSaid;
    errs.before.push(took / said); errs.after.push(took / (said * r));
  }
  // Held: the held way is quoted; else the quicker and the other are both
  // said (the staircase is always on offer), so only a walk or a span
  // climbed is a way not quoted.
  const tripQuotedNow = t => t.heldWay ? t.ways.includes(t.heldWay) : t.ways.some(w => ['staircase', 'straight_up'].includes(w));
  out.replay = {
    fallsBlockedAsks: answers.filter(a => a.fallsBlocked).length,
    fallsBlockedHand: answers.filter(a => a.fallsBlocked && a.hand).length,
    fallsNowOfferedByTorch: answers.filter(a => a.offeredNow).length,
    fallsNowOfferedByTorchHand: answers.filter(a => a.offeredNow && a.hand).length,
    digUpOntoHead: { offered: digUps.length, chosen: digUps.filter(d => d.chosen).length, inWallAfter: digUps.filter(d => d.hurt).length, nowOffered: 0 },
    tripWay: { n: trips.length, saidOtherThanClimbed: trips.filter(t => !t.ways.includes(t.saidWay)).length, heldKnown: trips.filter(t => t.heldWay).length, nowOtherThanClimbed: trips.filter(t => !tripQuotedNow(t)).length },
    secondsABlockError: { runs: errs.before.length, medianAbsLogBefore: logErr(errs.before), medianAbsLogAfter: logErr(errs.after), withinQuarterBefore: errs.before.filter(x => x >= 0.8 && x <= 1.25).length, withinQuarterAfter: errs.after.filter(x => x >= 0.8 && x <= 1.25).length },
  };
  if (asJson) { console.log(JSON.stringify({ ...out, answers, trips, digUps }, null, 1)); return; }
  console.log(`Climbs ${out.window.since} to ${out.window.until}, ${records} records`);
  console.log(`  spells: ${out.spells.all}; with a pickaxe ${JSON.stringify(out.spells.pickaxe)}; by hand ${JSON.stringify(out.spells.hand)}`);
  console.log(`  climb_out answers ${answers.length}; offered ${JSON.stringify(offeredCount)}; straight_up not offered ${out.climbOut.straightUpNotOffered}`);
  for (const [k, w] of Object.entries(out.climbOut.byWay).sort((a, b) => b[1].chosen - a[1].chosen)) console.log(`    ${k}: ${JSON.stringify(w)}`);
  console.log('  what the column overhead held when straight_up was not offered:');
  for (const [k, o] of Object.entries(overhead).sort((a, b) => b[1].asks - a[1].asks)) console.log(`    ${k}: ${o.asks} asks (${o.hand} by hand), ${o.zeroRise} rose nothing, ${round(o.seconds / 60)} min after`);
  console.log(`  surface_trip climb quotes: ${JSON.stringify(out.tripQuotes)}`);
  console.log(`  replayed under note 768: ${JSON.stringify(out.replay)}`);
}

if (require.main === module) main();
module.exports = { saidSeconds, overheadOf, spellsOf };
