'use strict';
// What each answer at a blaze fight led to on the runs now playing, said to Jev (note 2602): the record
// scripts/trials/blaze-outcomes.js writes to artifacts/blaze-outcomes.json every twenty minutes from the full runs'
// logs (the last day's answers of encounter_stance with a blaze within sixteen, hunt_target at blazes and
// empty_spawner, in the Nether), by option: times chosen, followed within two minutes by a blaze killed, by a death,
// and the health lost in the next thirty seconds. Each option carries its own row; the rows of every way on offer
// go in the question's state once, as what is true for all of them (note 2267). The tables kept in code (notes 1027,
// 2168, 2274) were snapshots of other days: on 2026-10-30 the day's own record read corner ambush chosen 23 times, a
// kill after 52%, a death after 9%, close in 12, 100% and 0%, against take cover 130, 5% and 15%, keep working 106, 5%
// and 22%, retreat 94, 5% and 23%, and none of it reached Jev. A row is said from five picks.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'artifacts', 'blaze-outcomes.json');
// JEV_BLAZE_OUTCOMES names another file (the tests').
const fileNow = () => process.env.JEV_BLAZE_OUTCOMES || FILE;
// A row is said from five picks; the price carries the record from ten (note 2605).
const KEEP_MS = 60000, LEAST = 5, PRICED_FROM = 10;
let cache = { at: 0, data: null, file: null };

function load(file = fileNow()) {
  const now = Date.now();
  if (cache.data && cache.file === file && now - cache.at < KEEP_MS) return cache.data;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { data = null; }
  cache = { at: now, data, file };
  return data;
}

const words = k => String(k).replaceAll('_', ' ');
const pct = (k, n) => Math.round(100 * k / n);
const hhmm = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z` : ''; };
const when = data => `the full runs of the last day, read at ${hhmm(data.to)}`;

// The row of one option at one question, or null under five picks.
function rowOf(question, key, file = fileNow()) {
  const data = load(file);
  const r = data?.questions?.[question]?.[key];
  return r && r.n >= LEAST ? r : null;
}

// The option's own sentence.
function ownSays(question, key, file = fileNow()) {
  const data = load(file), r = rowOf(question, key, file);
  if (!r) return '';
  return ` In the record of ${when(data)}, this way chosen here ${r.n} times: a blaze killed within two minutes after ${r.kill} (${pct(r.kill, r.n)}%), a death within two minutes after ${r.died} (${pct(r.died, r.n)}%)${r.lost !== null && r.lost !== undefined ? `, about ${r.lost} health lost in the next thirty seconds` : ''}.`;
}

// A stance with a deadly drop beside the feet (note 2608): the same record under its own key, a death within a minute
// after the pick. On 2026-10-30 keep working was chosen so 38 times and the bot was dead within a minute after 12,
// nook 7 of 21, hold on span 6 of 27, take cover 8 of 62; await in reach 0 of 28, seal 0 of 16, shield guard 0 of 5.
const DROP = 'encounter_stance@drop';
function dropSays(key, file = fileNow()) {
  const data = load(file), r = rowOf(DROP, key, file);
  if (!r) return '';
  return ` In the record of ${when(data)}, this way chosen with a deadly drop beside the feet ${r.n} times: the bot dead within a minute after ${r.died} (${pct(r.died, r.n)}%)${r.lost !== null && r.lost !== undefined ? `, about ${r.lost} health lost in the next thirty seconds` : ''}.`;
}

// The rows of the ways on offer, for the question's state: killers first (the drop's, the safest first).
function tableSays(question, offered, file = fileNow()) {
  const data = load(file);
  if (!data) return '';
  const rows = (offered || []).filter(k => k !== 'none_good').map(k => [k, rowOf(question, k, file)]).filter(([, r]) => r);
  if (!rows.length) return '';
  if (question === DROP) {
    rows.sort((a, b) => (a[1].died / a[1].n - b[1].died / b[1].n) || (b[1].n - a[1].n));
    const said = rows.map(([k, r]) => `${words(k)} ${r.n}: dead within a minute after ${pct(r.died, r.n)}%`);
    return `Of the ways on offer here, what each led to with a deadly drop beside the feet in the record of ${when(data)} (times chosen; followed within a minute by a death): ${said.join('; ')}. A way not listed was chosen under five times.`;
  }
  rows.sort((a, b) => (b[1].kill / b[1].n - a[1].kill / a[1].n) || (a[1].died / a[1].n - b[1].died / b[1].n));
  const said = rows.map(([k, r]) => `${words(k)} ${r.n}: a kill after ${pct(r.kill, r.n)}%, a death after ${pct(r.died, r.n)}%`);
  return `Of the ways on offer here, what each led to in the record of ${when(data)} (times chosen; followed within two minutes by a blaze killed; by a death): ${said.join('; ')}. A way not listed was chosen under five times.`;
}

// The death rate's share of the health now, carried on the option's damage figure as the push record is (survival.js
// pushRecordOn, note 2026): a way chosen here with blazes about that was followed by a death within two minutes in
// died-of-n of its picks is priced at that share of the health the bot has, over its estimate. Rows under ten picks
// price nothing. -> the damage added, or 0.
function deathShare(question, key, health, file = fileNow()) {
  const r = rowOf(question, key, file);
  if (!r || r.n < PRICED_FROM || !r.died) return 0;
  return Math.round(r.died / r.n * (Number.isFinite(health) ? health : 20) * 10) / 10;
}

module.exports = { FILE, DROP, LEAST, PRICED_FROM, load, rowOf, ownSays, dropSays, tableSays, deathShare };
