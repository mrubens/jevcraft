'use strict';
// Every question Jev is asked, rendered as it goes out and read for what is
// false where it is asked (src/decisions/prompt-audit.js, note 677):
//   - each recorded question (evals/replays/cases.jsonl, and any fixture
//     under test/fixtures that holds a question with its state and tree),
//     asked through decide() with a client that only keeps the request;
//   - each defined question's own words, rendered as asked on the Overworld
//     and in the Nether;
//   - the bot's own chat lines (src/narration.js), as said off the Overworld;
//   - with --live DIR, the questions the bots have been asked lately (the
//     decisions kept in DIR/*-Jev.json), read only.
// A question's dimension is its state's, or the bot's where recorded, or
// read from what it says (inferred, and said so).
//   node scripts/audit-prompts.js [--live ../.bot-state] [--json] [--all]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pa = require('../src/decisions/prompt-audit');

// The Nether's own things: a question that speaks of several of them and of
// nothing of the Overworld's side was asked there.
const NETHER_SIGNS = /\b(netherrack|blazes?|ghasts?|piglins?|hoglins?|fortress(es)?|magma cubes?|basalt|soul s(and|oil)|nether bricks?|wither skeletons?|nether wart|crimson|warped|lava sea|in the nether)\b/gi;
// And the Overworld's: a question speaking of these was asked there, or
// cannot be told apart by its words.
const OVERWORLD_SIGNS = /\b(biomesNearby|villages?|cows?|sheep|under the surface|oak|birch|spruce|home level)\b/gi;
const NETHER_QUESTIONS = new Set(['fortress_leg', 'fortress_approach', 'nether_gather', 'fortress_visit', 'leave_nether', 'nether_food_kit', 'bastion_raid', 'blaze_hunt']);
function dimensionOf(rec) {
  const explicit = pa.norm(rec.dimension || rec.state?.dimension);
  if (explicit) return { dimension: explicit === 'nether' ? 'the_nether' : explicit, inferred: false };
  // The healing record says the day only on the Overworld (healing.js
  // daylightSays), and the way back for food only off it.
  if (/^(day|night|dusk)\b/.test(String(rec.state?.healing?.daylight || '')) || Number.isFinite(rec.state?.timeOfDay) && rec.question === 'pocket_next' && rec.state.night === true) return { dimension: 'overworld', inferred: true, strong: true };
  if (/no day or night here/.test(String(rec.state?.healing?.daylight || '')) || rec.state?.healing?.withoutFood) return { dimension: 'the_nether', inferred: true, strong: true };
  if (NETHER_QUESTIONS.has(rec.question)) return { dimension: 'the_nether', inferred: true, strong: true };
  const text = JSON.stringify([rec.state, rec.tree]);
  const signs = new Set((text.match(NETHER_SIGNS) || []).map(s => s.toLowerCase().replace(/e?s$/, '')));
  const home = new Set((text.match(OVERWORLD_SIGNS) || []).map(s => s.toLowerCase()));
  if (signs.size >= 3 && home.size < 2) return { dimension: 'the_nether', inferred: true };
  return { dimension: null, inferred: true };
}

// Questions with their state and tree anywhere in a fixture.
function fixtureRecords(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    let o; try { o = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { continue; }
    const visit = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 8) return;
      if (!Array.isArray(v) && v.state && typeof v.state === 'object' && (v.tree || v.options) && typeof (v.question || v.id) === 'string') out.push({ source: `test/fixtures/${name}`, question: v.question || v.id, state: v.state, tree: v.tree || v.options, dimension: v.dimension });
      for (const x of Object.values(v)) visit(x, depth + 1);
    };
    visit(o, 0);
  }
  return out;
}
function replayRecords() {
  const file = path.join(ROOT, 'evals', 'replays', 'cases.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(c => ({ source: `replay ${c.name}`, question: c.question, state: c.state, tree: c.tree, dimension: c.dimension }));
}
function liveRecords(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).filter(n => /-Jev\.json$/.test(n))) {
    let g; try { g = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { continue; }
    for (const d of (g.goal || g).decisions || []) if (d.state && d.options && d.id) out.push({ source: `live ${name.replace(/-Jev\.json$/, '')} ${d.at}`, question: d.id, state: d.state, tree: d.options, dimension: d.dimension });
  }
  return out;
}

// The request as it goes out, through decide() and the client's lean step.
async function render(rec) {
  const { decide, question } = require('../src/decisions');
  const { leanRequest } = require('../src/decisions/lean');
  try { question(rec.question); } catch (_) { return null; }
  const { dimension, inferred, strong = !inferred } = dimensionOf(rec);
  // A live bot's dimension goes in with the state (decide does the same).
  const state = rec.state && typeof rec.state === 'object' && dimension && !rec.state.dimension ? { ...rec.state, dimension } : rec.state;
  let sent = null;
  const client = { model: 'audit', systemOne: async req => {
    sent = leanRequest(req);
    return { answers: Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, { choice: Object.keys(q.criteria)[0], confidence: 0.9 }])) };
  } };
  const env = process.env.JEV_PROMPT_AUDIT; process.env.JEV_PROMPT_AUDIT = '0';
  const log = console.log; console.log = () => {};
  try {
    await decide(rec.question, { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(rec.tree)), state });
  } catch (err) { return { error: err.message }; }
  finally { console.log = log; if (env === undefined) delete process.env.JEV_PROMPT_AUDIT; else process.env.JEV_PROMPT_AUDIT = env; }
  if (!sent) return null;
  const root = sent.questions.branch_0;
  // The tree as sent: each branch's criteria in the recorded shape.
  const tree = JSON.parse(JSON.stringify(rec.tree));
  return { id: rec.question, dimension, inferred, strong, instructions: root?.instructions, state: sent.state, tree };
}

// Each defined question's own words, as asked on the Overworld and in the
// Nether (no state: the shared glosses that go with every question, and the
// question's guidance). A question asked only on the Overworld says so in
// its definition (`overworldOnly`) and is rendered there only.
function definedRecords() {
  const { all, withRealTime } = require('../src/decisions');
  const out = [];
  for (const spec of all()) {
    if (!spec.instructions) continue;
    for (const dimension of spec.overworldOnly ? ['overworld'] : ['overworld', 'the_nether']) {
      out.push({ source: `definition ${spec.id}`, id: spec.id, dimension, inferred: false, instructions: withRealTime(spec, { dimension }, dimension), state: {}, tree: {} });
    }
  }
  return out;
}

// The chat lines said off the Overworld, each survival line and each step's.
function narrationRecords() {
  const narration = require('../src/narration');
  const { SURVIVAL } = narration;
  const out = [];
  const sample = { threats: ['zombified_piglin'], item: 'porkchop', what: 'fortress', distance: 40, chore: 'stock_stash', target: 'blaze' };
  const linesFor = narration.linesFor || (action => [].concat(SURVIVAL[action]).map(v => typeof v === 'function' ? v({}, sample) : v).filter(Boolean));
  for (const action of Object.keys(SURVIVAL)) {
    const lines = linesFor(action, { dimension: 'the_nether' });
    if (lines === null) continue; // said only on the Overworld
    out.push({ source: `narration ${action}`, id: `narration:${action}`, dimension: 'the_nether', inferred: false, instructions: { task: lines.join(' | ') }, state: {}, tree: {} });
  }
  return out;
}

async function run({ live = null, all = false } = {}) {
  const records = [...replayRecords(), ...fixtureRecords(path.join(ROOT, 'test', 'fixtures')), ...(live ? liveRecords(live) : [])];
  const findings = [], rendered = [], errors = [];
  for (const rec of records) {
    const r = await render(rec);
    if (!r) continue;
    if (r.error) { errors.push({ source: rec.source, error: r.error }); continue; }
    rendered.push({ ...r, source: rec.source });
    for (const f of pa.audit(r)) findings.push({ ...f, source: rec.source, inferred: r.inferred, weak: !r.strong });
  }
  for (const r of [...definedRecords(), ...narrationRecords()]) {
    rendered.push(r);
    for (const f of pa.audit(r)) findings.push({ ...f, source: r.source, inferred: false });
  }
  // A guidance that names a record never sent with its question, over the
  // recorded askings of it (a warning: some records are sent only at times).
  const warnings = [];
  const byId = new Map();
  for (const r of rendered.filter(r => r.state && Object.keys(r.state).length)) (byId.get(r.id) || byId.set(r.id, []).get(r.id)).push(r);
  for (const [id, list] of byId) {
    const sent = new Set(); for (const r of list) pa.keysOf(r.state, sent);
    const named = new Set(list.flatMap(r => pa.fieldsNamed(r.instructions?.guidance)));
    for (const f of named) if (!sent.has(f) && !pa.GLOSSED.has(f)) warnings.push({ class: 'contradiction', rule: 'guidance-names-a-record-never-sent', id, term: f, asked: list.length });
  }
  return { records: records.length, rendered: rendered.length, findings, warnings, errors, all };
}

function report({ records, rendered, findings, warnings, errors }, { all = false } = {}) {
  const weak = findings.filter(f => f.weak);
  const lines = [`${records} recorded questions, ${rendered} rendered (with the definitions and the chat lines); ${findings.length - weak.length} findings, ${weak.length} unconfirmed (the dimension read from the question's words only), ${warnings.length} warnings`];
  const groups = {};
  for (const f of findings) (groups[`${f.weak ? 'unconfirmed: ' : ''}${f.class} / ${f.rule}`] ||= []).push(f);
  for (const [g, list] of Object.entries(groups)) {
    lines.push('', `## ${g}: ${list.length}`);
    const byQ = {};
    for (const f of list) (byQ[f.id] ||= []).push(f);
    for (const [id, fs_] of Object.entries(byQ)) {
      lines.push(`- ${id} (${fs_.length}${fs_.some(f => f.inferred) ? ', dimension inferred for some' : ''}): ${[...new Set(fs_.map(f => f.dimension))].join(', ')}; terms ${[...new Set(fs_.map(f => f.term))].join(', ')}`);
      const shown = all ? fs_ : [...new Map(fs_.map(f => [f.clause, f])).values()].slice(0, 3);
      for (const f of shown) lines.push(`    ${f.at} [${f.source}]: "${f.clause.slice(0, 200)}"`);
    }
  }
  if (warnings.length) { lines.push('', `## warnings: ${warnings.length}`); for (const w of warnings) lines.push(`- ${w.id}: guidance names \`${w.term}\`, sent in none of its ${w.asked} recorded askings`); }
  if (errors.length) { lines.push('', `## not rendered: ${errors.length}`); for (const e of errors.slice(0, 10)) lines.push(`- ${e.source}: ${e.error.slice(0, 160)}`); }
  return lines.join('\n');
}

module.exports = { run, report, render, dimensionOf, replayRecords, fixtureRecords, definedRecords, narrationRecords };

if (require.main === module) {
  const args = process.argv.slice(2);
  const liveAt = args.indexOf('--live');
  const opts = { live: liveAt >= 0 ? path.resolve(args[liveAt + 1]) : null, all: args.includes('--all') };
  process.env.JEV_NONE_GOOD = '0';
  run(opts).then(result => {
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(report(result, opts));
    if (result.findings.some(f => !f.weak)) process.exitCode = 1;
  }).catch(err => { console.error(err); process.exitCode = 1; });
}
