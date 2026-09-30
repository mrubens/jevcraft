#!/usr/bin/env node
'use strict';
// How much ground the fortress search wins for its minutes (note 751), per
// Nether trial, from the Nether's first frame to the first fortress sighted
// (a fortress_approach asked, or a question whose state has a fortress in
// view), or the trial's end:
//   - search minutes (bot time in the Nether, gaps of a minute or more left out)
//   - new columns of 4 by 4 stood on per 10 minutes, and the ground the search
//     says it has seen at fortress heights (seenSoFar) gained per 10 minutes
//   - leg-minutes, and the share of them spent on columns stood on before
//     that leg began (ground already searched)
//   - legs reversed (the heading opposite the last leg's) within 2 minutes of
//     the last leg's choice, and all reversals
//   - minutes of legs that ended no nearer, by why (lava or water, no route,
//     out of blocks, rock by hand, other)
//   - minutes from the Nether's first frame to the first sighting
//   - the pickaxe as a budget: minutes with none carried, of those how many
//     with raw iron, a furnace and fuel carried (an iron pickaxe to be smelted
//     and made), and the pickaxes made on the search by kind
//
//   node scripts/search-efficiency.js [--since 2026-09-29T23:00:00Z] [--to ISO]
// (trials running at --since are measured from then on)
//                                     [--port N] [--json] [--verbose]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const since = Date.parse(opt('--since', '2026-09-29T23:00:00Z'));
const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
const onlyPort = opt('--port', null);
const GAP_MS = 60000, REVERSE_MS = 2 * 60000, CELL = 4;
const OPPOSITE = { east: 'west', west: 'east', north: 'south', south: 'north' };
const isLeg = k => /^(leg|floor|round)_|^widen_search$/.test(k || '');
const headingOf = k => (String(k || '').match(/(east|south|west|north)/) || [])[1] || null;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

function whyClass(text) {
  const t = String(text || '').toLowerCase();
  if (/lava|water/.test(t)) return 'lava or water';
  if (/no route|no way|noroute|no path|could not find|pathfinder/.test(t)) return 'no route';
  if (/blocks|out of/.test(t)) return 'out of blocks';
  if (/does not break|by hand|pickaxe/.test(t)) return 'rock by hand';
  return 'other';
}
const FUEL = /^(coal|charcoal|coal_block|lava_bucket|blaze_rod)$/;
function pickState(inv = {}) {
  const picks = Object.entries(inv).filter(([k]) => /_pickaxe$/.test(k)).reduce((n, [, v]) => n + v, 0);
  const smeltable = (inv.raw_iron || 0) >= 3 && (inv.furnace || 0) > 0 && Object.entries(inv).some(([k, v]) => FUEL.test(k) && v > 0);
  // An iron one to be made on the spot: the sticks and a table from the wood
  // carried too (mob-hunt.js bestMakeable).
  const sum = re => Object.entries(inv).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
  const wood = sum(/_log$|_stem$|_hyphae$|_wood$/) * 4 + sum(/_planks$/), frame = ((inv.crafting_table || 0) ? 0 : 4) + ((inv.stick || 0) >= 2 ? 0 : 2);
  return { picks, smeltable, ironMakeable: smeltable && wood >= frame, byKind: Object.fromEntries(Object.entries(inv).filter(([k]) => /_pickaxe$/.test(k))) };
}

function portFiles(port) {
  const identity = `127_0_0_1-${port}-Jev-`;
  const tsOf = f => { const m = f.match(/-Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z/); return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) : NaN; };
  let names = [];
  try { names = fs.readdirSync(FLIGHT); } catch (_) { return []; }
  return names.filter(f => f.startsWith(identity) && f.endsWith('.jsonl')).map(f => ({ f: path.join(FLIGHT, f), start: tsOf(f) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
}

// A frame's time, dimension, position and inventory without parsing the
// whole line (most are observations); decisions of the search parsed whole.
const AT = /"at":"([^"]+)"\}?\s*$/;
function frameOf(line) {
  const m = line.match(AT);
  const t = m ? Date.parse(m[1]) : NaN;
  const dim = (line.match(/"dimension":"([a-z_:]+)"/) || [])[1] || null;
  const p = line.match(/"position":\{"x":(-?[\d.e-]+),"y":(-?[\d.e-]+),"z":(-?[\d.e-]+)\}/);
  let inv = null;
  const i = line.indexOf('"inventory":{');
  if (i >= 0) { const j = line.indexOf('}', i); try { inv = JSON.parse(line.slice(i + 12, j + 1)); } catch (_) { inv = null; } }
  // Pickaxe uses carried (the snapshot's tools, with what each has left).
  let uses = null;
  const ti = line.indexOf('"tools":[');
  if (ti >= 0) { const tj = line.indexOf(']', ti); try { uses = JSON.parse(line.slice(ti + 8, tj + 1)).filter(x => /_pickaxe$/.test(x.name)).reduce((n, x) => n + (x.remaining || 0), 0); } catch (_) { uses = null; } }
  return { t, nether: !!dim && /nether/.test(dim), pos: p ? { x: +p[1], y: +p[2], z: +p[3] } : null, inv, uses };
}

function measureTrial(tr) {
  // A trial begun before the window is measured from the window's start
  // (its time to a sighting then counts from the first Nether frame in it).
  const start = Math.max(tr.start, since), end = Math.min(tr.end, to);
  const frames = [], decisions = [];
  for (const { f, start: fs0 } of portFiles(tr.port)) {
    if (fs0 > end || fs0 < start - 6 * 3600000) continue;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      const fr = frameOf(line);
      if (!(fr.t >= start && fr.t <= end)) continue;
      frames.push(fr);
      if (line.includes('"kind":"decision"') && (line.includes('"id":"fortress_leg"') || line.includes('"id":"fortress_approach"') || line.includes('"fortressInView"'))) {
        let r; try { r = JSON.parse(line); } catch (_) { continue; }
        const d = r.snapshot?.decision; if (!d) continue;
        decisions.push({ t: fr.t, id: d.id, chosen: d.path?.at(-1) || null, state: d.state || {}, pos: fr.pos, inView: !!d.state?.fortressInView });
      }
    }
  }
  frames.sort((a, b) => a.t - b.t); decisions.sort((a, b) => a.t - b.t);
  const netherAt = frames.find(f => f.nether)?.t ?? null;
  if (netherAt === null) return null;
  const sight = decisions.find(d => d.t >= netherAt && (d.id === 'fortress_approach' || d.inView));
  // The search runs on past a sighting where that fortress is set aside or
  // left (25593 mid-242-xd saw one 0.8 minutes in and searched two hours
  // more): every leg in the Nether is measured, and the first sighting is
  // said apart.
  const cut = end;
  const win = frames.filter(f => f.t >= netherAt && f.t <= cut);
  const legs = decisions.filter(d => d.id === 'fortress_leg' && d.t >= netherAt && d.t < cut);
  // Bot time and columns stood, frame by frame.
  const stoodAt = new Map(); // column -> first time stood
  let botMs = 0, noPickMs = 0, smeltMs = 0, allNoPickMs = 0, allSmeltMs = 0, allMakeMs = 0, woodenWhileSmeltable = 0;
  const made = {};
  let lastInv = null;
  for (let i = 0; i < win.length; i++) {
    const f = win[i], next = win[i + 1]?.t ?? cut, dt = next - f.t;
    if (f.inv) {
      const ps = pickState(f.inv);
      if (lastInv) for (const [k, v] of Object.entries(ps.byKind)) if (v > (lastInv.byKind[k] || 0)) {
        made[k] = (made[k] || 0) + v - (lastInv.byKind[k] || 0);
        if (k === 'wooden_pickaxe' && lastInv.smeltable) woodenWhileSmeltable += v - (lastInv.byKind[k] || 0);
      }
      lastInv = ps;
    }
    if (!f.nether || !(dt > 0) || dt >= GAP_MS) continue;
    botMs += dt;
    if (lastInv && !lastInv.picks) { allNoPickMs += dt; if (lastInv.smeltable) allSmeltMs += dt; if (lastInv.ironMakeable) allMakeMs += dt; }
    if (f.pos) { const k = `${Math.floor(f.pos.x / CELL)},${Math.floor(f.pos.z / CELL)}`; if (!stoodAt.has(k)) stoodAt.set(k, f.t); }
  }
  // Each leg: from its choice to the next fortress_leg asked (or the cut).
  const chosen = legs.filter(d => isLeg(d.chosen));
  let legMs = 0, revisitMs = 0, reversedFast = 0, reversedAll = 0, reversedAfterBlock = 0, newCols = 0, usesSpent = 0;
  const perLeg = [];
  const blocked = {};
  for (let i = 0; i < legs.length; i++) {
    const d = legs[i];
    if (!isLeg(d.chosen)) continue;
    const endT = legs[i + 1]?.t ?? cut;
    const legFrames = win.filter(f => f.t >= d.t && f.t < endT);
    let ms = 0, rev = 0, spent = 0, lastUses = null;
    const fresh = new Set();
    for (let j = 0; j < legFrames.length; j++) {
      const f = legFrames[j], dt = (legFrames[j + 1]?.t ?? endT) - f.t;
      if (!f.nether || !(dt > 0) || dt >= GAP_MS) continue;
      ms += dt;
      if (Number.isFinite(f.uses)) { if (lastUses !== null && f.uses < lastUses) spent += lastUses - f.uses; lastUses = f.uses; }
      if (f.inv) { const ps = pickState(f.inv); if (!ps.picks) { noPickMs += dt; if (ps.smeltable) smeltMs += dt; } }
      if (f.pos) {
        const k = `${Math.floor(f.pos.x / CELL)},${Math.floor(f.pos.z / CELL)}`, first = stoodAt.get(k);
        if (first !== undefined && first < d.t - 1000) rev += dt; else fresh.add(k);
      }
    }
    newCols += fresh.size; usesSpent += spent; perLeg.push(spent);
    legMs += ms; revisitMs += rev;
    // How it ended, as the next question says it.
    const nextLast = legs[i + 1]?.state?.lastLeg;
    if (nextLast && /ended no nearer/.test(nextLast)) { const c = whyClass(nextLast.split('ended no nearer')[1]); blocked[c] = (blocked[c] || 0) + ms; }
    const prev = chosen[chosen.indexOf(d) - 1];
    if (prev && headingOf(prev.chosen) && OPPOSITE[headingOf(prev.chosen)] === headingOf(d.chosen)) {
      reversedAll++;
      if (d.t - prev.t <= REVERSE_MS) reversedFast++;
      if (/ended no nearer/.test(d.state?.lastLeg || '')) reversedAfterBlock++;
    }
  }
  const seenOf = d => { const m = String(d.state?.seenSoFar || '').match(/about (\d+) chunks' worth of ground in all/); return m ? +m[1] : null; };
  const seens = legs.map(seenOf).filter(Number.isFinite);
  const min = legMs / 60000;
  return {
    world: tr.world, port: tr.port, source: /\/stages\/nether\//.test(tr.source || '') ? 'nether checkpoint' : 'fresh',
    netherAt: new Date(netherAt).toISOString(), sighted: !!sight, minutesToSighting: sight ? round((sight.t - netherAt) / 60000) : null,
    searchMinutes: round(min), netherMinutes: round(botMs / 60000), wallMinutes: round((cut - netherAt) / 60000),
    newColumnsPer10: min >= 1 ? round(newCols / min * 10) : null, newColumns: newCols,
    seenChunksGained: seens.length >= 2 ? Math.max(0, seens.at(-1) - seens[0]) : null,
    seenChunksPer10: seens.length >= 2 && min >= 1 ? round(Math.max(0, seens.at(-1) - seens[0]) / min * 10) : null,
    legsChosen: chosen.length, legMinutes: round(legMs / 60000), revisitShare: legMs ? round(revisitMs / legMs, 2) : null,
    reversedWithin2Min: reversedFast, reversedAll, reversedAfterBlock,
    blockedMinutes: Object.fromEntries(Object.entries(blocked).map(([k, v]) => [k, round(v / 60000)])),
    noPickaxeMinutes: round(noPickMs / 60000), noPickaxeIronSmeltableMinutes: round(smeltMs / 60000),
    pickaxeUsesOnLegs: usesSpent, pickaxeUsesPerLeg: perLeg,
    netherNoPickaxeIronMakeableMinutes: round(allMakeMs / 60000),
    netherNoPickaxeMinutes: round(allNoPickMs / 60000), netherNoPickaxeIronSmeltableMinutes: round(allSmeltMs / 60000), pickaxesMade: made, woodenMadeWithIronSmeltable: woodenWhileSmeltable,
  };
}

function summarize(rows) {
  const sum = (k) => round(rows.reduce((n, r) => n + (r[k] || 0), 0));
  const blocked = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.blockedMinutes)) blocked[k] = round((blocked[k] || 0) + v);
  const made = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.pickaxesMade)) made[k] = (made[k] || 0) + v;
  const legMin = sum('legMinutes');
  const revisit = round(rows.reduce((n, r) => n + (r.revisitShare || 0) * r.legMinutes, 0) / (legMin || 1), 2);
  return {
    trials: rows.length, sighted: rows.filter(r => r.sighted).length,
    medianMinutesToSighting: median(rows.filter(r => r.sighted).map(r => r.minutesToSighting)),
    unsightedSearchMinutes: sum('searchMinutes') - round(rows.filter(r => r.sighted).reduce((n, r) => n + r.searchMinutes, 0)),
    searchMinutes: sum('searchMinutes'), medianNewColumnsPer10: median(rows.map(r => r.newColumnsPer10)), medianSeenChunksPer10: median(rows.map(r => r.seenChunksPer10)),
    legsChosen: sum('legsChosen'), legMinutes: legMin, revisitShare: revisit,
    reversedWithin2Min: sum('reversedWithin2Min'), reversedAll: sum('reversedAll'), reversedAfterBlock: sum('reversedAfterBlock'),
    blockedMinutes: blocked, noPickaxeMinutes: sum('noPickaxeMinutes'), noPickaxeIronSmeltableMinutes: sum('noPickaxeIronSmeltableMinutes'), pickaxesMade: made,
    pickaxeUsesOnLegs: sum('pickaxeUsesOnLegs'), medianUsesPerLeg: median(rows.flatMap(r => r.pickaxeUsesPerLeg)), meanUsesPerLeg: round(sum('pickaxeUsesOnLegs') / (sum('legsChosen') || 1)), p75UsesPerLeg: (() => { const s = rows.flatMap(r => r.pickaxeUsesPerLeg).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * 0.75)] : null; })(), usesPerLegMinute: round(sum('pickaxeUsesOnLegs') / (legMin || 1)),
    netherMinutes: sum('netherMinutes'), netherNoPickaxeMinutes: sum('netherNoPickaxeMinutes'), netherNoPickaxeIronSmeltableMinutes: sum('netherNoPickaxeIronSmeltableMinutes'), netherNoPickaxeIronMakeableMinutes: sum('netherNoPickaxeIronMakeableMinutes'), woodenMadeWithIronSmeltable: sum('woodenMadeWithIronSmeltable'),
  };
}

function main() {
  const audit = require('./trials/progress-audit');
  // Every trial running in the window, those begun before it clipped to it.
  let trials = audit.trialRecords({ since: null, flight: FLIGHT }).filter(t => t.port && t.start < to && t.end > since);
  if (onlyPort) trials = trials.filter(t => String(t.port) === String(onlyPort));
  trials = trials.filter(t => !/\/stages\/fortress\//.test(t.source || ''));
  const rows = trials.map(measureTrial).filter(Boolean).filter(r => r.searchMinutes >= 1);
  const all = summarize(rows);
  if (args.includes('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), summary: all, trials: rows }, null, 1)); return; }
  console.log(`Nether trials since ${new Date(since).toISOString()} (fortress checkpoints left out): ${all.trials}, ${all.sighted} with a fortress sighted, median ${all.medianMinutesToSighting} min from the Nether to it.`);
  console.log(`Search legs: ${all.searchMinutes} bot-minutes of ${all.netherMinutes} in the Nether (${all.unsightedSearchMinutes} of them in trials that never sighted a fortress).`);
  console.log(`New columns stood on per 10 leg-minutes: median ${all.medianNewColumnsPer10}; ground seen at fortress heights gained per 10 leg-minutes: median ${all.medianSeenChunksPer10} chunks.`);
  console.log(`Legs chosen: ${all.legsChosen} over ${all.legMinutes} leg-minutes, ${Math.round(all.revisitShare * 100)}% of those minutes on columns stood on before the leg began.`);
  console.log(`Legs reversed: ${all.reversedAll} (${all.reversedWithin2Min} within 2 minutes of the last leg's choice; ${all.reversedAfterBlock} after a leg that ended no nearer).`);
  console.log(`Minutes of legs that ended no nearer, by why: ${Object.entries(all.blockedMinutes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  console.log(`Pickaxe uses spent on legs: ${all.pickaxeUsesOnLegs} (a leg: median ${all.medianUsesPerLeg}, mean ${all.meanUsesPerLeg}, three in four under ${all.p75UsesPerLeg}; ${all.usesPerLegMinute} a leg-minute).`);
  console.log(`Pickaxe: ${all.netherNoPickaxeMinutes} Nether minutes with none carried (${all.noPickaxeMinutes} of them on legs), ${all.netherNoPickaxeIronSmeltableMinutes} of them with 3+ raw iron, a furnace and fuel carried (${all.noPickaxeIronSmeltableMinutes} on legs), ${all.netherNoPickaxeIronMakeableMinutes} with the wood for the sticks too (an iron pickaxe to be made on the spot); pickaxes made in the Nether: ${Object.entries(all.pickaxesMade).map(([k, v]) => `${k.replace('_pickaxe', '')} ${v}`).join(', ') || 'none'}, ${all.woodenMadeWithIronSmeltable} of the wooden ones made with raw iron, a furnace and fuel carried.`);
  if (args.includes('--verbose')) for (const r of rows) console.log(`  ${r.port} ${r.world} ${r.source}: ${r.sighted ? `sighted at ${r.minutesToSighting} min` : `none in ${r.wallMinutes} min`}; ${r.searchMinutes} min, ${r.newColumnsPer10} cols/10, seen ${r.seenChunksPer10}/10; ${r.legsChosen} legs, ${Math.round((r.revisitShare || 0) * 100)}% revisit, reversed ${r.reversedAll} (${r.reversedWithin2Min} fast, ${r.reversedAfterBlock} after block); blocked ${JSON.stringify(r.blockedMinutes)}; no pickaxe ${r.netherNoPickaxeMinutes} (${r.netherNoPickaxeIronSmeltableMinutes} smeltable); made ${JSON.stringify(r.pickaxesMade)}, wooden with iron smeltable ${r.woodenMadeWithIronSmeltable}`);
}

module.exports = { measureTrial, summarize, whyClass, pickState };
if (require.main === module) main();
