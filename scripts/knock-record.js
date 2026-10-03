'use strict';
// What a hit throws the bot, and what followed each stance chosen with a
// drop that kills beside it and a ghast or a magma cube about (note 662).
//   node scripts/knock-record.js [--from 2026-09-28T04:45:00Z] [--to 2026-09-29T11:45:00Z] [--json] [--dir <flight dir>]
// From the flight records (.bot-state/flight):
//  - throws: each hit that landed in the Nether (a ghast's fireball, a magma
//    cube's, a hoglin's blow, an arrow), how far over the ground the body was
//    1.5 seconds later (a portal jump, over 20 blocks, left out), and whether
//    the lava was touched within six seconds;
//  - stances: each encounter_stance answer with such a drop within three
//    blocks in its state, counted once per stretch of the same answer (under a
//    minute between askings, in one file), with whether the lava was touched
//    within 30 seconds and whether the bot died within 60.
const fs = require('fs');
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
const lo = Date.parse(args.from || '2026-09-28T04:45:00Z'), hi = Date.parse(args.to || '2026-09-29T11:45:00Z');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && fs.statSync(path.join(dir, f)).mtimeMs > lo);
const hits = [], asks = [];
for (const f of files) {
  const fr = [];
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch (_) { continue; }
    const s = j.snapshot || {}, t = Date.parse(j.at);
    if (!(t >= lo && t <= hi) || j.kind === 'observation') continue;
    fr.push({ t, kind: j.kind, label: j.label || '', s });
  }
  const lastAsk = new Map();
  for (let i = 0; i < fr.length; i++) {
    const { t, s, label } = fr[i], p = s.position;
    const m = p && s.dimension === 'the_nether' && label.match(/^hurt: (fireball by ghast|mob attack by (?:magma_cube|hoglin)|arrow by \w+)/);
    if (m && !(i > 0 && fr[i - 1].label === label && t - fr[i - 1].t < 1000)) {
      let far = 0, lava = false;
      for (let k = i; k < fr.length && fr[k].t - t < 6000; k++) {
        const q = fr[k].s.position;
        if (q && fr[k].t - t <= 1500) far = Math.max(far, Math.hypot(q.x - p.x, q.z - p.z));
        if (/^hurt: lava/.test(fr[k].label)) lava = true;
      }
      if (far < 20) hits.push({ by: m[1].replace('mob attack by ', '').replace('fireball by ', '').replace('arrow by ', 'arrow:'), far, lava });
    }
    const d = s.decision;
    if (d && d.id === 'encounter_stance' && !d.noneGood && d.state?.dimension === 'the_nether') {
      const drop = d.state.dropWithinThreeBlocks, kinds = new Set((d.state.threats || []).map(x => x.name));
      if (!(drop && (drop.into === 'lava' || drop.deadly))) continue;
      const kind = kinds.has('ghast') ? 'ghast' : kinds.has('magma_cube') ? 'magma_cube' : kinds.has('hoglin') ? 'hoglin' : null;
      if (!kind) continue;
      const choice = (d.path || [])[0], at = Date.parse(d.at) || t, key = `${kind}/${choice}`;
      if (lastAsk.has(key) && at - lastAsk.get(key) < 60000) { lastAsk.set(key, at); continue; }
      lastAsk.set(key, at);
      let lava = false, died = false;
      for (let k = i; k < fr.length && fr[k].t - at < 60000; k++) {
        if (fr[k].t - at < 30000 && /^hurt: lava/.test(fr[k].label)) lava = true;
        if (fr[k].kind === 'danger' && fr[k].s.health === 0) died = true;
      }
      asks.push({ kind, choice, lava, died });
    }
  }
}
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const throws = {};
for (const h of hits) (throws[h.by] = throws[h.by] || []).push(h);
const out = { throws: {}, stances: {} };
for (const [by, a] of Object.entries(throws)) {
  const d = a.map(h => h.far).sort((x, y) => x - y);
  out.throws[by] = { n: a.length, median: +q(d, 0.5).toFixed(1), p90: +q(d, 0.9).toFixed(1), most: +d.at(-1).toFixed(1), lava: a.filter(h => h.lava).length };
}
for (const a of asks) { const o = (out.stances[`${a.kind}/${a.choice}`] = out.stances[`${a.kind}/${a.choice}`] || { n: 0, lava: 0, died: 0 }); o.n++; if (a.lava) o.lava++; if (a.died) o.died++; }
if (args.json) console.log(JSON.stringify(out, null, 1));
else {
  console.log('Throws (over the ground in 1.5 s; lava within 6 s):');
  for (const [by, o] of Object.entries(out.throws)) if (o.n >= 3) console.log(`  ${by.padEnd(22)} n ${String(o.n).padStart(3)}  median ${o.median}  p90 ${o.p90}  most ${o.most}  lava ${o.lava}`);
  console.log('Stances with a deadly drop within three blocks, per stretch (lava within 30 s, death within 60 s):');
  for (const [k, o] of Object.entries(out.stances).sort((a, b) => a[0].localeCompare(b[0]))) if (o.n >= 3) console.log(`  ${k.padEnd(34)} n ${String(o.n).padStart(3)}  lava ${String(o.lava).padStart(3)} (${Math.round(100 * o.lava / o.n)}%)  died ${o.died}`);
}
