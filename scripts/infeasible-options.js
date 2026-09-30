#!/usr/bin/env node
'use strict';
// Options that promised what the code could not do (note 754). Read from the
// flight records; read-only.
//   node scripts/infeasible-options.js [--since 2026-09-30T06:00:00Z] [--until ISO] [--port N] [--within 10000] [--json] [--top 20]
// JEV_ROOT reads another checkout's records (from a worktree).
//
// For every answer Jev weighed (two options or more), whether its run ended
// within --within ms (10 s) in one of:
//   no_route      a no_route frame, or an error that says no route, no path,
//                 no way, no leg or no reachable ground
//   made_nothing  a craft that made nothing (craft-failures.js), or timed out
//                 waiting for its output
//   missing_input a missing ingredient, recipe or harvest tool
//   no_room       no free slot, a full inventory
// the first such frame before the next answer to the same question, the
// survival layer's interruptions (threats, preemptions, air) not counted.
// Grouped by question and option; with the bot-minutes after each such
// answer until the bot next got anywhere (more than three blocks from where
// it stood when it answered, or something worth keeping gained), capped at
// 15 minutes and merged where the spans overlap.
// Besides, from the offers themselves:
//   - craft options offered as ready (stone_tools, torches, make_pickaxe,
//     spare_pickaxe) with no sticks and nothing to make them from carried,
//     and a walk (explore, travel_*, look_around, loot) offered beside a
//     work_free that says the bot is walled in where it stands;
//   - daylight said ("seconds of daylight left") below y 0 in the Overworld;
//   - "7.5 seconds a block" by hand said below y 0 (deepslate is 15);
//   - the chat's "pockets are full" lines (and "attempt N" among them);
//   - stillness_detour and rung_progress asked while a hand-dig climb was
//     under way (a climb_out answer with no pickaxe carried in the last three
//     minutes, the bot higher than when the climb began), with the climb's
//     blocks a minute.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T06:00:00Z'));
const until = Date.parse(arg('until', new Date(Date.now() + 60000).toISOString()));
const port = arg('port');
const WITHIN = Number(arg('within', 10000));
const TOP = Number(arg('top', 20));
const asJson = argv.includes('--json');
const LOST_CAP_MS = 15 * 60000;
const CLIMB_MS = 3 * 60000;

const INTERRUPT = /^(Threat nearby|Preempted by|The bot died|Low air|Interrupted|Cancelled|The detour has had its time)/;
const CAUSES = [
  ['no_room', /free slot|inventory is full|pockets are full/i],
  ['made_nothing', /made nothing|after crafting|inventory update: [a-z ]+ after crafting/i],
  ['missing_input', /missing ingredient|No usable recipe|Missing harvest tool|no tool for|not enough [a-z_ ]+ to craft|no sticks can be made/i],
  ['no_route', /No route|noPath|No path|No way to|No way on|No leg from here|No reachable|No existing route|cannot be reached from|came no nearer/i],
];
const FILLER = /^(cobblestone|cobbled_deepslate|netherrack|dirt|coarse_dirt|gravel|stone|deepslate|andesite|diorite|granite|tuff|calcite|basalt|blackstone|sand|red_sand|soul_sand|soul_soil|end_stone|leaf_litter|stick|wheat_seeds|.*_sapling|rotten_flesh|string|bone|arrow)$/;
const WALKS = /^(explore|travel_\w+|look_around|loot|trade|fetch_cache)$/;
const CRAFTS = new Set(['stone_tools', 'torches', 'make_pickaxe', 'spare_pickaxe']);

function causeOf(frame) {
  if (frame.kind === 'no_route') return 'no_route';
  const label = String(frame.label || '');
  if (INTERRUPT.test(label)) return 'interrupt';
  for (const [name, re] of CAUSES) if (re.test(label)) return name;
  return null;
}

// Sticks from the pockets: sticks carried, or planks (two make four), or
// logs (one makes four planks); a pickaxe at a table wants four planks more
// where no table is carried.
function sticksFrom(inv = {}, { table = false } = {}) {
  const sum = re => Object.entries(inv).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + (+v || 0), 0);
  const logs = sum(/_log$|_stem$|_wood$|_hyphae$/), planks = sum(/_planks$/), sticks = sum(/^stick$/);
  const units = planks + logs * 4 - (table && !inv.crafting_table ? 4 : 0);
  return sticks + (units >= 2 ? Math.floor(units / 2) * 4 : 0);
}
function craftLacks(key, inv = {}) {
  if (key === 'torches') return sticksFrom(inv) < 1 ? 'sticks (no sticks, planks or logs carried)' : null;
  if (key === 'stone_tools' || key === 'make_pickaxe' || key === 'spare_pickaxe') return sticksFrom(inv, { table: true }) < 2 ? 'sticks (no sticks, planks or logs carried)' : null;
  return null;
}

function portOf(f) { return (f.match(/-(\d{5})-Jev-/) || [])[1] || '?'; }

const out = {
  since: new Date(since).toISOString(), answers: 0, infeasible: 0, byCause: {}, byQuestion: {}, byOption: {}, askedByOption: {},
  lostMinutes: 0, lostByCause: {}, lostByOption: {},
  // noPick: of those, with no pickaxe carried (what note 754's rule leaves
  // out: a walk, or a craft whose chain begins with one, walled in with no
  // pickaxe); the rest are said with the chain or the digging out.
  offers: { craftNoInput: 0, craftNoInputChosen: 0, craftNoInputFailed: 0, craftNoInputWalledNoPick: 0, walkWalledIn: 0, walkWalledInChosen: 0, walkWalledInFailed: 0, walkWalledInNoPick: 0, walkWalledInNoPickChosen: 0,
    daylightUnderground: 0, handSevenAndHalfDeep: 0, handDigFigures: {} },
  pocketsFull: { lines: 0, attempts: 0, maxAttempt: 0, byPort: {} },
  craftRests: 0,
  climbs: { handClimbs: 0, preempted: 0, preemptedClimbing: 0, preemptedRising: 0, byQuestion: {}, blocksPerMinute: [] },
  // Spells of a minute or more in the Overworld under y 16 with no pickaxe
  // and no wood (log, planks or stick) carried, until either is carried
  // again, a death or the record's end; and the upkeep answers before them that chose carry_on over
  // wood_reserve in the half hour before.
  noWoodDeep: { spells: 0, minutes: [], carryOnBefore: 0, died: 0 },
  examples: [],
};
const count = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };

let files = [];
try { files = fs.readdirSync(path.join(ROOT, '.bot-state', 'flight')); } catch (_) { files = []; }
files = files.filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
  .filter(f => { try { return fs.statSync(path.join(ROOT, '.bot-state', 'flight', f)).mtimeMs >= since; } catch (_) { return false; } });

for (const f of files) {
  let text; try { text = fs.readFileSync(path.join(ROOT, '.bot-state', 'flight', f), 'utf8'); } catch (_) { continue; }
  const frames = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    const i = l.lastIndexOf('"at":"'); const t = i < 0 ? NaN : Date.parse(l.slice(i + 6, l.indexOf('"', i + 6)));
    if (!(t >= since && t <= until)) continue;
    let o; try { o = JSON.parse(l); } catch (_) { continue; }
    const s = o.snapshot || {};
    frames.push({ t, kind: o.kind, label: o.label, s, detail: o.detail, pos: s.position || null, inv: s.inventory || null });
  }
  frames.sort((a, b) => a.t - b.t);
  const p = portOf(f);
  // The pockets' worth at each frame that carries them, for the "got
  // anywhere" test.
  let lastInv = null;
  for (const fr of frames) { if (fr.inv) lastInv = fr.inv; fr.invNow = lastInv; }
  const worth = inv => { const w = {}; for (const [k, v] of Object.entries(inv || {})) if (!FILLER.test(k)) w[k] = +v || 0; return w; };
  const spans = [];
  let climb = null;
  // The no-wood-deep spells.
  let spell = null, lastCarryOn = -Infinity, lastT = null;
  const hasWood = inv => Object.keys(inv).some(k => /_log$|_stem$|_planks$|^stick$/.test(k) && +inv[k] > 0);
  const hasPick = inv => Object.keys(inv).some(k => /_pickaxe$/.test(k) && +inv[k] > 0);
  // A spell under a minute is not counted: a death's empty pockets read as
  // one for the frames before the respawn.
  const closeSpell = (t, died = false) => {
    if (spell && t - spell.t0 >= 60000) { out.noWoodDeep.spells++; if (spell.carryOn) out.noWoodDeep.carryOnBefore++; out.noWoodDeep.minutes.push((t - spell.t0) / 60000); if (died) out.noWoodDeep.died++; }
    spell = null;
  };
  for (const fr of frames) {
    if (fr.kind === 'decision' && fr.s.decision?.id === 'upkeep' && fr.label === 'carry_on' && fr.s.decision?.options?.wood_reserve) lastCarryOn = fr.t;
    if (spell && lastT !== null && fr.t - lastT > 60000) closeSpell(lastT);
    lastT = fr.t;
    if (fr.kind === 'error' && /The bot died/.test(String(fr.label || ''))) { closeSpell(fr.t, true); continue; }
    if (!fr.inv || !fr.pos) continue;
    const deep = /overworld/.test(String(fr.s.dimension || '')) && fr.pos.y < 16;
    const bare = !hasWood(fr.inv) && !hasPick(fr.inv);
    if (!spell && deep && bare) spell = { t0: fr.t, carryOn: fr.t - lastCarryOn < 30 * 60000 };
    else if (spell && !bare) closeSpell(fr.t);
  }
  if (spell && lastT !== null) closeSpell(lastT);
  for (let i = 0; i < frames.length; i++) {
    const o = frames[i];
    // The climb's height as the frames show it, for ten minutes at most.
    if (climb && o.pos && o.t - climb.t0 <= 10 * 60000) { climb.tNow = o.t; climb.yNow = Math.max(climb.yNow, o.pos.y); }
    if (o.kind === 'chat') {
      const msg = String(o.detail?.message || '');
      if (/pockets are full/i.test(msg)) {
        out.pocketsFull.lines++; count(out.pocketsFull.byPort, p);
        const m = msg.match(/attempt (\d+)/); if (m) { out.pocketsFull.attempts++; out.pocketsFull.maxAttempt = Math.max(out.pocketsFull.maxAttempt, +m[1]); }
      }
      continue;
    }
    if (o.kind === 'error' && /made nothing (twice|\d+ times)/.test(String(o.label || ''))) out.craftRests++;
    if (o.kind !== 'decision') continue;
    const d = o.s.decision || {};
    const q = d.id, choice = o.label;
    const options = d.options || {};
    const probs = d.judgments?.[0]?.probabilities || {};
    const inv = d.state?.inventory || o.invNow || {};
    const y = o.pos?.y ?? d.state?.position?.y;
    const overworld = /overworld/.test(String(d.dimension || o.s.dimension || ''));
    // Said on the offer.
    const texts = Object.entries(options).map(([k, v]) => [k, typeof v === 'string' ? v : String(v?.description || '')]);
    if (overworld && Number.isFinite(y) && y < 0) {
      if (texts.some(([, t]) => /seconds of daylight left/.test(t))) out.offers.daylightUnderground++;
      if (texts.some(([, t]) => /by hand at about 7\.5 seconds a block|at seven seconds a block/.test(t))) out.offers.handSevenAndHalfDeep++;
    }
    for (const [, t] of texts) for (const m of t.matchAll(/(\d+(?:\.\d+)?) (?:s|seconds) a block[^.;]{0,20}by hand|by hand at about (\d+(?:\.\d+)?) seconds a block|at (seven|\d+) seconds a block/g)) count(out.offers.handDigFigures, m[1] || m[2] || m[3]);
    const walled = texts.some(([k, t]) => k === 'work_free' && /walled in where it stands/.test(t));
    const weighed = Object.keys(probs).filter(k => k !== 'none_good').length >= 2;
    // The run's end, for the chosen answer.
    let cause = null, failFrame = null;
    if (q && choice) {
      for (let j = i + 1; j < frames.length && frames[j].t - o.t <= WITHIN; j++) {
        const n = frames[j];
        if (n.kind === 'decision' && n.s.decision?.id === q) break;
        if (n.kind !== 'error' && n.kind !== 'no_route') continue;
        const c = causeOf(n);
        if (c === 'interrupt') break;
        if (c) { cause = c; failFrame = n; break; }
      }
    }
    const noPick = !Object.keys(inv).some(k => /_pickaxe$/.test(k));
    for (const [k] of texts) {
      if (CRAFTS.has(k) && craftLacks(k, inv)) { out.offers.craftNoInput++; if (walled && noPick) out.offers.craftNoInputWalledNoPick++; if (k === choice) { out.offers.craftNoInputChosen++; if (cause) out.offers.craftNoInputFailed++; } }
      if (walled && WALKS.test(k)) { out.offers.walkWalledIn++; if (noPick) out.offers.walkWalledInNoPick++; if (k === choice) { out.offers.walkWalledInChosen++; if (noPick) out.offers.walkWalledInNoPickChosen++; if (cause) out.offers.walkWalledInFailed++; } }
    }
    // A hand-dig climb under way, and the questions that came during it.
    const pick = Object.keys(inv).some(k => /_pickaxe$/.test(k));
    if (q === 'climb_out' && ['staircase', 'straight_up', 'walk_then_up'].includes(choice) && !pick && Number.isFinite(y)) {
      if (climb && o.t - climb.t0 > 0) out.climbs.blocksPerMinute.push(Math.round((climb.yNow - climb.y0) / Math.max(1 / 60, (climb.tNow - climb.t0) / 60000) * 10) / 10);
      climb = { t0: o.t, y0: y, tNow: o.t, yNow: y, last: o.t };
      out.climbs.handClimbs++;
    } else if (climb && (q === 'stillness_detour' || q === 'rung_progress') && o.t - climb.last <= CLIMB_MS && !pick) {
      out.climbs.preempted++; count(out.climbs.byQuestion, `${q}/${choice}`);
      if (Number.isFinite(y) && y > climb.y0) out.climbs.preemptedClimbing++;
      // Rising in the 90 seconds before the question (a stair by hand in
      // deepslate is 46 s): what note 754's rules count as progress, a new
      // height on the climb out.
      const before = frames.slice(Math.max(0, i - 400), i).filter(f => f.pos && o.t - f.t <= 90000 && o.t - f.t >= 60000)[0];
      if (before && Number.isFinite(y) && y >= before.pos.y + 1) out.climbs.preemptedRising++;
    }
    if (!weighed || !q || !choice) continue;
    out.answers++; count(out.askedByOption, `${q}/${choice}`);
    if (!cause) continue;
    out.infeasible++; count(out.byCause, cause); count(out.byQuestion, q); count(out.byOption, `${q}/${choice}`);
    if (out.examples.length < 12) out.examples.push(`${new Date(o.t).toISOString().slice(11, 19)} ${p} ${q}/${choice} -> ${cause}: ${String(failFrame.label).slice(0, 120)}`);
    // Minutes until the bot next got anywhere.
    const from = o.pos, had = worth(o.invNow);
    let end = Math.min(o.t + LOST_CAP_MS, frames.at(-1).t);
    for (let j = i + 1; j < frames.length && frames[j].t <= o.t + LOST_CAP_MS; j++) {
      const n = frames[j];
      const moved = from && n.pos && Math.hypot(n.pos.x - from.x, n.pos.y - from.y, n.pos.z - from.z) > 3;
      const gained = n.inv && Object.entries(worth(n.inv)).some(([k, v]) => v > (had[k] || 0));
      if (moved || gained) { end = n.t; break; }
    }
    spans.push({ a: o.t, b: end, cause, key: `${q}/${choice}` });
  }
  if (climb && climb.tNow > climb.t0) out.climbs.blocksPerMinute.push(Math.round((climb.yNow - climb.y0) / ((climb.tNow - climb.t0) / 60000) * 10) / 10);
  // Merged: overlapping spans counted once, charged to the first answer.
  spans.sort((x, z) => x.a - z.a);
  let reach = -Infinity;
  for (const s of spans) {
    const a = Math.max(s.a, reach), ms = Math.max(0, s.b - a);
    reach = Math.max(reach, s.b);
    const min = ms / 60000;
    out.lostMinutes += min; count(out.lostByCause, s.cause, min); count(out.lostByOption, s.key, min);
  }
}

const round = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10) / 10]));
out.lostMinutes = Math.round(out.lostMinutes * 10) / 10;
out.lostByCause = round(out.lostByCause); out.lostByOption = round(out.lostByOption);
const bpm = out.climbs.blocksPerMinute.filter(Number.isFinite).sort((a, b) => a - b);
out.climbs.medianBlocksPerMinute = bpm.length ? bpm[Math.floor(bpm.length / 2)] : null;
delete out.climbs.blocksPerMinute;
{
  const m = out.noWoodDeep.minutes.sort((a, b) => a - b);
  out.noWoodDeep.totalMinutes = Math.round(m.reduce((a, b) => a + b, 0));
  out.noWoodDeep.medianMinutes = m.length ? Math.round(m[Math.floor(m.length / 2)] * 10) / 10 : null;
  out.noWoodDeep.longestMinutes = m.length ? Math.round(m.at(-1)) : null;
  delete out.noWoodDeep.minutes;
}
if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const topOf = (m, n = TOP) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`${files.length} records since ${out.since}`);
console.log(`answers weighed by Jev: ${out.answers}; run ended within ${WITHIN / 1000} s in no route / made nothing / missing input / no room: ${out.infeasible} (${(100 * out.infeasible / Math.max(1, out.answers)).toFixed(1)}%)`);
console.log(`  by cause: ${topOf(out.byCause).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`bot-minutes after those answers before the bot next got anywhere: ${out.lostMinutes} (${topOf(out.lostByCause).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log('\nby question:');
for (const [k, v] of topOf(out.byQuestion)) console.log(`  ${v}\t${k}`);
console.log('\nby option (infeasible / chosen, minutes after):');
for (const [k, v] of topOf(out.byOption)) console.log(`  ${v}\t/ ${out.askedByOption[k]}\t${out.lostByOption[k] ?? 0} min\t${k}`);
const of = out.offers;
console.log(`\ncraft options offered as ready with no sticks and nothing to make them from: ${of.craftNoInput} (chosen ${of.craftNoInputChosen}, of them failed at once ${of.craftNoInputFailed}; ${of.craftNoInputWalledNoPick} walled in with no pickaxe)`);
console.log(`walks offered while walled in where it stands: ${of.walkWalledIn} (chosen ${of.walkWalledInChosen}, failed at once ${of.walkWalledInFailed}); with no pickaxe carried ${of.walkWalledInNoPick} (chosen ${of.walkWalledInNoPickChosen})`);
console.log(`questions saying daylight below y 0: ${of.daylightUnderground}; saying 7.5 (or seven) seconds a block by hand below y 0: ${of.handSevenAndHalfDeep}`);
console.log(`by-hand seconds a block said: ${topOf(of.handDigFigures, 12).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
console.log(`"pockets are full" chat lines: ${out.pocketsFull.lines} (with "attempt N": ${out.pocketsFull.attempts}, highest attempt ${out.pocketsFull.maxAttempt}); by port ${topOf(out.pocketsFull.byPort).map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`craft rests said ("made nothing twice"): ${out.craftRests}`);
const c = out.climbs;
console.log(`hand-dig climbs chosen (climb_out, no pickaxe): ${c.handClimbs}; stillness_detour/rung_progress asked within 3 min of one: ${c.preempted} (${c.preemptedClimbing} with the bot higher than the climb began, ${c.preemptedRising} with it a block or more higher than 60 to 90 s before); median climb ${c.medianBlocksPerMinute} blocks a minute`);
for (const [k, v] of topOf(c.byQuestion, 8)) console.log(`  ${v}\t${k}`);
const nw = out.noWoodDeep;
console.log(`spells under y 16 with no pickaxe and no wood: ${nw.spells} (${nw.totalMinutes} bot-minutes, median ${nw.medianMinutes}, longest ${nw.longestMinutes}; ${nw.died} ended in a death; ${nw.carryOnBefore} came within half an hour of an upkeep carry_on over wood_reserve)`);
console.log('\nexamples:'); for (const e of out.examples) console.log(`  ${e}`);
