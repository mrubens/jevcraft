#!/usr/bin/env node
'use strict';
// Known lava pools that vanish from the lava's way (trial note 767b). For
// every lava_way asked: the pools the bot had found or walked to in that
// run (its chat: "a lava pool at X, Z", "Walking to the lava pool at (x, y,
// z)"), within 256 blocks, that no option names; and of those, the ones a
// walk to had stalled or ended before the ask.
//
//   node scripts/lava-pools.js [--since 2026-09-30T23:36:00Z] [--to ISO]
// JEV_ROOT reads another checkout's records.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const since = Date.parse(opt('--since', '2026-09-30T23:36:00Z')), to = opt('--to') ? Date.parse(opt('--to')) : Infinity;
const startOf = n => { const m = n.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };

function measure() {
  const out = { asks: 0, withMissing: 0, missing: 0, afterWalk: 0, afterStall: 0, cases: [] };
  const byPort = new Map(); // port -> pools "x,z" -> { x, y, z, walkedAt, stalledAt }, kept across a port's restarts
  for (const name of fs.readdirSync(FLIGHT).filter(n => n.endsWith('.jsonl') && startOf(n) >= since - 3600000 && startOf(n) <= to).sort((a, b) => startOf(a) - startOf(b))) {
    const port = (name.match(/-(\d{5})-Jev-/) || [])[1];
    if (!byPort.has(port)) byPort.set(port, new Map());
    const pools = byPort.get(port);
    let walking = null;
    for (const line of fs.readFileSync(path.join(FLIGHT, name), 'utf8').split('\n')) {
      if (!line || !/"kind":"(chat|decision|navigation_stall|observation)"/.test(line.slice(0, 40))) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(o.at);
      if (o.kind === 'chat') {
        const m = String(o.detail?.message || '');
        let a = m.match(/a lava pool at (-?\d+), (-?\d+)/);
        if (a && !pools.has(`${a[1]},${a[2]}`)) pools.set(`${a[1]},${a[2]}`, { x: +a[1], z: +a[2] });
        a = m.match(/Walking to the lava pool at \((-?\d+), (-?\d+), (-?\d+)\)/);
        if (a) { const p = pools.get(`${a[1]},${a[3]}`) || { x: +a[1], z: +a[3] }; p.y = +a[2]; p.walkedAt = t; pools.set(`${a[1]},${a[3]}`, p); walking = p; }
        continue;
      }
      if (o.kind === 'navigation_stall' && walking && t - walking.walkedAt < 180000) { walking.stalledAt = t; continue; }
      if (o.kind === 'observation') { if (o.snapshot?.step?.action !== 'go_to_landmark') walking = null; continue; }
      const d = o.snapshot?.decision;
      if (o.kind !== 'decision' || d?.id !== 'lava_way' || t < since || t > to) continue;
      const here = o.snapshot.position;
      const text = Object.values(d.options || {}).map(v => v.description || '').join(' ');
      out.asks++;
      const missing = [...pools.values()].filter(p => here && Math.hypot(p.x - here.x, p.z - here.z) <= 256 && !text.includes(`(${p.x}, `) );
      const named = missing.filter(p => !new RegExp(`\\(${p.x}, -?\\d+, ${p.z}\\)`).test(text));
      if (!named.length) continue;
      out.withMissing++; out.missing += named.length;
      out.afterWalk += named.filter(p => p.walkedAt && p.walkedAt < t).length;
      out.afterStall += named.filter(p => p.stalledAt && p.stalledAt < t).length;
      out.cases.push({ port, at: o.at, offered: Object.keys(d.options || {}).join(','), missing: named.map(p => `(${p.x}, ${p.y ?? '?'}, ${p.z})${p.stalledAt ? ' stalled' : p.walkedAt ? ' walked' : ''} ${Math.round(Math.hypot(p.x - here.x, p.z - here.z))} across`) });
    }
  }
  return out;
}
if (require.main === module) {
  const r = measure();
  console.log(`lava_way asked ${r.asks} times; ${r.withMissing} asked with a pool found in the run (within 256 blocks across) not on offer, ${r.missing} pools in all, ${r.afterWalk} of them walked to before, ${r.afterStall} after a walk to them stalled.`);
  for (const c of r.cases) console.log(`  ${c.port} ${c.at} offered ${c.offered}; not on offer: ${c.missing.join('; ')}`);
}
module.exports = { measure };
