'use strict';
// How often a question is asked again with nothing changed since its last
// answer (note 724). Read from the flight records; read-only.
//   node scripts/unchanged-asks.js [--since 2026-09-30T00:00Z] [--until ...] [--port 25594] [--top 25] [--json]
//
// For every decision frame Jev weighed (source jev), per bot process (one
// record file), the question's previous answer in the same record is looked
// up, and what changed between the two is read from the frames' own
// snapshots with the rule's own measure (src/decisions/unchanged.js
// changed()): the block the bot stands in, the inventory's counts, the health
// band. Blocks dug or placed are not in the frames; a dig or place that kept
// or spent the block shows in the inventory, and one that did not is missed,
// so "changed nothing" here can be a little high.
// Printed: asks per bot-minute by question, the peak in any one minute, and
// the asks whose previous answer changed nothing (and of those, how many came
// with the same facts, unchanged.digest). And the replay: the same frames
// walked through the rule (unchanged.js replay()), each ask the rule would
// have held counted, with the asks per minute that would have gone to Jev.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const unchanged = require('../src/decisions/unchanged');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T00:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');
const top = Number(arg('top', 25));
const dir = arg('dir', path.join(ROOT, '.bot-state', 'flight'));

const snapMark = s => unchanged.markOf({ entity: { position: s?.position }, health: s?.health, inventory: { items: () => Object.entries(s?.inventory || {}).map(([name, count]) => ({ name, count })) } });

async function readFile(file) {
  const asks = [];
  let first = null, last = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    // Every frame's time bounds the bot-minutes; only decisions are parsed whole.
    const at = line.match(/"at":"(\d{4}-[^"]+Z)"/g);
    const t = at ? Date.parse(at.at(-1).slice(6, -1)) : NaN;
    if (Number.isFinite(t) && t >= since && t <= until) { first ??= t; last = t; }
    if (!line.startsWith('{"kind":"decision"')) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const tt = Date.parse(o.at || '');
    if (!Number.isFinite(tt) || tt < since || tt > until || o.source !== 'jev') continue;
    const d = o.snapshot?.decision;
    if (!d?.id || !d.path) continue;
    let digest = null;
    try { digest = unchanged.digest(d.state, d.options || {}); } catch (_) { /* unreadable */ }
    asks.push({ t: tt, id: d.id, choice: d.path.join('/'), mark: snapMark(o.snapshot), digest });
  }
  return { asks, minutes: first && last ? (last - first) / 60000 : 0 };
}

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-Jev-`)))
    .filter(f => fs.statSync(path.join(dir, f)).mtimeMs >= since);
  const by = {}, row = id => by[id] ||= { asks: 0, peak: 0, nothing: 0, nothingSameFacts: 0, nothingSameAnswer: 0, within10: 0, held: 0 };
  let minutes = 0, asksAll = 0, nothingAll = 0, heldAll = 0;
  const worst = [];
  for (const f of files) {
    const { asks, minutes: m } = await readFile(path.join(dir, f));
    minutes += m;
    const lastOf = {}, perMinute = {};
    for (const a of asks) {
      const r = row(a.id); r.asks++; asksAll++;
      const w = (perMinute[a.id] ||= []); w.push(a.t);
      while (w.length && a.t - w[0] > 60000) w.shift();
      r.peak = Math.max(r.peak, w.length);
      if (w.length >= 20 && !worst.some(x => x.file === f && x.id === a.id)) worst.push({ file: f, id: a.id, choice: a.choice, perMinute: w.length, at: new Date(a.t).toISOString().slice(11, 19) });
      const prev = lastOf[a.id];
      if (prev && !unchanged.changed(prev.mark, a.mark)) {
        r.nothing++; nothingAll++;
        if (prev.digest === a.digest) r.nothingSameFacts++;
        if (prev.choice === a.choice) r.nothingSameAnswer++;
        if (a.t - prev.t <= 10000) r.within10++;
      }
      lastOf[a.id] = a;
    }
    // The replay: the rule over the same asks.
    const held = unchanged.replay(asks);
    for (const h of held) { row(h.id).held++; heldAll++; }
  }
  const perMin = n => minutes ? (n / minutes).toFixed(3) : '-';
  const rows = Object.entries(by).sort((a, b) => b[1].asks - a[1].asks).slice(0, top);
  if (argv.includes('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), files: files.length, botMinutes: Math.round(minutes), asks: asksAll, nothing: nothingAll, held: heldAll, by, worst }, null, 1)); return; }
  console.log(`${files.length} records since ${new Date(since).toISOString()}, ${Math.round(minutes)} bot-minutes, ${asksAll} asks weighed by Jev (${perMin(asksAll)} a bot-minute)`);
  console.log(`asks whose previous answer to the same question changed nothing (same block, same inventory, same health band): ${nothingAll} (${(100 * nothingAll / Math.max(1, asksAll)).toFixed(1)}%)`);
  console.log(`replayed through the rule: ${heldAll} of them held, not asked (${(100 * heldAll / Math.max(1, asksAll)).toFixed(1)}% of all asks); ${perMin(asksAll - heldAll)} asks a bot-minute after\n`);
  console.log('asks\t/min\tpeak/1m\tnothing\tsame facts\tsame answer\t<=10s\theld\tquestion');
  for (const [id, r] of rows) console.log(`${r.asks}\t${perMin(r.asks)}\t${r.peak}\t${r.nothing}\t${r.nothingSameFacts}\t\t${r.nothingSameAnswer}\t\t${r.within10}\t${r.held}\t${id}`);
  console.log('\nminutes with 20 or more asks of one question (first seen):');
  for (const w of worst.sort((a, b) => b.perMinute - a.perMinute).slice(0, 15)) console.log(`  ${w.perMinute}/min\t${w.at}\t${w.file.match(/-(\d{5})-Jev-(.{19})/)?.slice(1).join(' ')}\t${w.id} ${w.choice}`);
})();
