'use strict';
// Note 776's probe: would Jev still name a rung that shows no benefit for the
// Nether, once it is offered as optional with its record and the Nether is
// the ladder's own next? From 2026-09-30 20:00Z to 2026-10-01 03:00Z the
// ladder handed the optional rungs 162 pre-Nether minutes and Jev named them
// at win_strategy for 1,155 more (the food for the Nether 848), the Nether
// first on offer beside them each time. The ladder's change alone reaches
// the first; this asks the recorded questions again to see the second.
//
// Each recorded win_strategy ask before the Nether whose answer named an
// optional rung (kit-record.js needBeforeNether false) with the Nether first
// on offer is asked twice of Jev through decide(): as recorded, and as note
// 776 puts it: each optional rung's record the new one (its minutes, how
// many finished it, the stays with and without it, the rule), not marked
// the ladder's next; the rungs that stay on the ladder first; with none
// left, the Nether is the ladder's own stage (stage_reach_nether) and the
// optional rungs are offered beside it; the state's beforeTheNether says
// which are optional.
//   node scripts/optional-rungs-probe.js [--since ISO] [--to ISO] [--cases 40] [--runs 3] [--phase nether_food]
// JEV_ROOT reads another checkout's records (from a worktree).
const path = require('path');
const fs = require('fs');
require('../src/env').loadEnv();

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const since = Date.parse(opt('--since', '2026-09-30T20:00:00Z'));
const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
const maxCases = Number(opt('--cases', 40));
const runs = Number(opt('--runs', 3));
const onlyPhase = opt('--phase', null);

const record = require('../src/kit-record');
const { DEFERRABLE } = require('../src/game-progress');
const optional = phase => DEFERRABLE.has(phase) && !/^home_/.test(phase) && !record.needBeforeNether(phase);
const label = p => p.replaceAll('_', ' ');

// The recorded asks: one file at a time, pre-Nether (the dimension at the
// ask), the answer an optional rung, the Nether first on offer.
function recordedCases() {
  const out = [];
  for (const f of fs.readdirSync(FLIGHT).filter(n => n.endsWith('.jsonl')).sort()) {
    const text = fs.readFileSync(path.join(FLIGHT, f), 'utf8');
    if (!text.includes('"win_strategy"')) continue;
    let nether = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.includes('"dimension":"the_nether"') || line.includes('"dimension":"minecraft:the_nether"')) nether = true;
      if (nether || !line.includes('"id":"win_strategy"')) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const d = o.snapshot?.decision, t = Date.parse(d?.at || o.at || '');
      if (!d || !(t >= since && t < to) || !Array.isArray(d.path)) continue;
      const answer = d.path.at(-1);
      const phase = /^rung_(.+)$/.exec(answer)?.[1];
      if (!phase || !optional(phase) || !d.options?.nether_first || (onlyPhase && phase !== onlyPhase)) continue;
      out.push({ file: f, at: new Date(t).toISOString(), answer, phase, options: d.options, state: d.state });
    }
  }
  return out;
}

// Spread over rungs and files: the food dominates the minutes, the rest are
// few; each file gives at most two.
function sample(cases) {
  const perFile = {}, picked = [];
  const byPhase = {};
  for (const c of cases) (byPhase[c.phase] ||= []).push(c);
  const phases = Object.keys(byPhase);
  let i = 0;
  while (picked.length < maxCases && phases.some(p => byPhase[p].length)) {
    const p = phases[i++ % phases.length];
    const c = byPhase[p].shift();
    if (!c || (perFile[c.file] || 0) >= 2) continue;
    perFile[c.file] = (perFile[c.file] || 0) + 1;
    picked.push(c);
  }
  return picked;
}

const strip = d => String(d || '').replace(/ In the record: [^]*?(?:\.(?= [A-Z])|\.$)/g, '').replace(/ Its record: [^]*?(?:\.(?= [A-Z])|\.$)/g, '');
const clone = o => JSON.parse(JSON.stringify(o));
// The question as note 776 asks it, from the recorded one.
function asNow(c) {
  const tree = {};
  const rungKeys = Object.keys(c.options).filter(k => /^rung_/.test(k));
  const kept = rungKeys.filter(k => !optional(k.slice(5)));
  const opts = rungKeys.filter(k => optional(k.slice(5)));
  const state = clone(c.state || {});
  for (const k of kept) tree[k] = { ...clone(c.options[k]), ladderNext: k === kept[0] };
  if (kept.length) {
    // The Nether first leaves only what stays on the ladder.
    const nf = clone(c.options.nether_first);
    nf.description = nf.description.replace(/^Leave [^.]*? for later and go for the Nether now/, `Leave ${kept.map(k => label(k.slice(5))).join(', ')} for later and go for the Nether now`);
    tree.nether_first = nf;
  } else {
    const nf = c.options.nether_first.description;
    const kit = /( At the portal the kit is said[^]*)$/.exec(nf)?.[1] || '';
    tree.stage_reach_nether = { description: `Go on to reach nether (the portal, and through it for a fortress, blaze rods and ender pearls), with the kit carried now.${kit}`, ladderNext: true };
  }
  for (const k of opts) {
    const n = clone(c.options[k]);
    delete n.ladderNext;
    n.description = `${strip(n.description)}${record.rungRecordSays(k.slice(5))}`;
    tree[k] = n;
  }
  for (const k of Object.keys(c.options)) if (!tree[k] && !/^rung_|^nether_first$|^none_good$/.test(k)) tree[k] = clone(c.options[k]);
  if (typeof state.beforeTheNether === 'string') {
    const list = opts.map(k => label(k.slice(5)));
    state.beforeTheNether = `${kept.length ? `May wait until after it: ${kept.map(k => label(k.slice(5))).join(', ')}.` : 'Nothing left is needed before the Nether: a portal can be made or found now.'} Optional before the Nether, not on the ladder unless chosen (no benefit for them in the first Nether stays' record, kit-record.js): ${list.join(', ')}.${/( At the portal the kit is said[^]*)$/.exec(state.beforeTheNether)?.[1] || ''}`;
  }
  return { tree, state };
}

(async () => {
  const { TypeSafe } = require('../src/typesafe');
  const { decide } = require('../src/decisions');
  const client = new TypeSafe();
  const all = recordedCases();
  const cases = sample(all);
  console.log(`${all.length} recorded win_strategy asks before the Nether answered with an optional rung, the Nether first on offer (${new Date(since).toISOString()} on); ${cases.length} asked, ${runs} runs each, as recorded and as note 776 asks them.`);
  const tally = { before: { same: 0, n: 0 }, after: { same: 0, nether: 0, other: 0, n: 0 } };
  const byPhase = {};
  for (const c of cases) {
    const b = byPhase[c.phase] ||= { cases: 0, beforeSame: 0, beforeN: 0, afterSame: 0, afterNether: 0, afterN: 0 };
    b.cases++;
    const now = asNow(c);
    const res = { before: {}, after: {} };
    for (let i = 0; i < runs; i++) {
      for (const [k, q] of [['before', { tree: clone(Object.fromEntries(Object.entries(c.options).filter(([key]) => key !== 'none_good'))), state: c.state }], ['after', now]]) {
        let pick;
        try { const r = await decide('win_strategy', { client, bot: null, goal: {}, tree: clone(q.tree), state: q.state }); pick = r.noneGood ? 'none_good' : r.path.at(-1); }
        catch (err) { pick = `error: ${String(err.message).slice(0, 40)}`; }
        res[k][pick] = (res[k][pick] || 0) + 1;
        tally[k].n++; if (pick === c.answer) tally[k].same++;
        if (k === 'before') { b.beforeN++; if (pick === c.answer) b.beforeSame++; }
        else { b.afterN++; if (pick === c.answer) b.afterSame++; if (/^(nether_first|stage_reach_nether)$/.test(pick)) { b.afterNether++; tally.after.nether++; } }
      }
    }
    console.log(`  ${c.file.replace(/^127_0_0_1-|-Jev-/g, ' ').trim()} ${c.at.slice(11, 19)} recorded ${c.answer}: as recorded ${JSON.stringify(res.before)}; as note 776 asks ${JSON.stringify(res.after)}`);
  }
  console.log('\nBy rung (the recorded answer named again, as recorded / as note 776 asks; the Nether taken instead):');
  for (const [p, b] of Object.entries(byPhase)) console.log(`  ${p}: ${b.cases} cases; ${b.beforeSame} of ${b.beforeN} / ${b.afterSame} of ${b.afterN}; the Nether ${b.afterNether} of ${b.afterN}`);
  console.log(`\nAll: the recorded optional rung named again ${tally.before.same} of ${tally.before.n} as recorded, ${tally.after.same} of ${tally.after.n} as note 776 asks; the Nether taken ${tally.after.nether} of ${tally.after.n}.`);
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(path.join('artifacts', `optional-rungs-probe-${Date.now().toString(36)}.json`), JSON.stringify({ since: new Date(since).toISOString(), byPhase, tally }, null, 2));
})().catch(err => { console.error(err); process.exitCode = 1; });
