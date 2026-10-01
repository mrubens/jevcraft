#!/usr/bin/env node
'use strict';
// The portal cast, slot by slot, from the flight records (trial note 767).
// Every slot a cast worked on: whether a stand was reached (the cast got as
// far as pouring from one), whether a stand was dug out or a line into the
// slot cleared, whether walls went up, lava poured, water poured, and
// whether the slot turned to obsidian (the lava went in and the cast moved
// on to another slot, never back). And the cast's failures at its site, as
// portal_method said them (the frame's reasons since the last block went
// in): how many, why, how often one was asked again within 30 seconds, and
// how many blocks were cast when new_site left the frame.
//
//   node scripts/cast-attempts.js [--since 2026-09-30T06:00:00Z] [--to ISO]
//                                 [--port N] [--json] [--verbose]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const has = name => args.includes(name);
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');

const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const portOf = name => Number((name.match(/-(\d{5})-Jev-/) || [])[1]);
const invOf = line => {
  const i = line.indexOf('"inventory":{');
  if (i < 0) return null;
  const j = line.indexOf('}', i);
  try { return JSON.parse(line.slice(i + 12, j + 1)); } catch (_) { return null; }
};
const skey = s => `${s.x},${s.y},${s.z}`;

// A failure reason with its coordinates and counts taken out, so the same
// cause at another slot reads as one.
function reasonOf(why) {
  return String(why)
    .replace(/\(-?\d+, -?\d+, -?\d+\)/g, '(x)')
    .replace(/\(-?\d+(\.\d+)?, -?\d+(\.\d+)?, -?\d+(\.\d+)?\)/g, '(x)')
    .replace(/: \d+ stands? beside it.*$/, ': <ways>')
    .replace(/\d+/g, 'N')
    .slice(0, 110);
}

// The site failure's words in a portal_method option (work.js
// siteFailedSays): the frame, what is cast, the count since the last block
// went in, and up to three reasons with their counts.
const SITE = /The frame at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) of ten cast, has failed at its site (once|twice|(\d+) times) since the last block went in: (.*?)\.(?: Not counted| The |$)/;
function siteFailure(options) {
  for (const o of Object.values(options || {})) {
    const m = String(o?.description || '').match(SITE);
    if (!m) continue;
    const n = m[5] === 'once' ? 1 : m[5] === 'twice' ? 2 : Number(m[6]);
    const whys = {};
    for (const w of m[7].matchAll(/"([^"]*)" (once|twice|(\d+) times)/g)) whys[w[1]] = w[2] === 'once' ? 1 : w[2] === 'twice' ? 2 : Number(w[3]);
    return { origin: { x: +m[1], y: +m[2], z: +m[3] }, cast: +m[4], n, whys };
  }
  return null;
}

function readPort(files, since, to) {
  const slots = []; // every slot episode
  const asks = []; // portal_method asks at a site failure
  const leaves = []; // new_site chosen
  const errors = {}; // errors thrown during cast_portal (not swallowed)
  let inv = { lava: 0, water: 0 }, cur = null, prevStep = null;
  const open = new Map(); // slot key -> episode within this session
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.f, 'utf8'); } catch (_) { continue; }
    open.clear(); cur = null;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const i = line.lastIndexOf('"at":"');
      const t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
      if (!(t >= since && t <= to)) {
        const iv = invOf(line); if (iv) inv = { lava: iv.lava_bucket || 0, water: iv.water_bucket || 0 };
        continue;
      }
      const iv = invOf(line);
      const cast = line.includes('"cast_portal"'), pm = line.includes('"portal_method"');
      let step = null, o = null;
      if (cast || pm || line.startsWith('{"kind":"error"')) {
        try { o = JSON.parse(line); } catch (_) { o = null; }
        step = o?.snapshot?.step || o?.snapshot?.goal?.step || null;
      }
      if (step?.action === 'cast_portal' && step.slot) {
        const k = skey(step.slot);
        let ep = open.get(k);
        if (!ep) { ep = { port: f.port, slot: step.slot, from: t, to: t, phases: {}, lava: 0, water: 0, back: 0 }; open.set(k, ep); slots.push(ep); }
        if (cur && cur !== ep) { cur.left = t; if (ep.left) ep.back++; }
        ep.to = t; ep.phases[step.phase] = (ep.phases[step.phase] || 0) + 1;
        if (step.phase === 'lava' && ep.lava) ep.lavaAgain = true;
        cur = ep;
      }
      if (iv) {
        const now = { lava: iv.lava_bucket || 0, water: iv.water_bucket || 0 };
        const s = step?.action === 'cast_portal' ? step : prevStep;
        if (cur && s?.action === 'cast_portal' && s.slot && skey(s.slot) === skey(cur.slot)) {
          if (now.lava < inv.lava && /^(lava|water)$/.test(s.phase)) cur.lava++;
          if (now.water < inv.water && /^(water)$/.test(s.phase)) cur.water++;
        }
        inv = now;
      }
      if (o?.kind === 'error' && step?.action === 'cast_portal') { const r = reasonOf(o.label); errors[r] = (errors[r] || 0) + 1; }
      if (pm && o?.kind === 'decision') {
        const d = o.snapshot?.decision;
        if (d?.id === 'portal_method') {
          const sf = siteFailure(d.options);
          const pick = (d.path || []).at(-1);
          if (sf) asks.push({ port: f.port, t, ...sf, pick, options: Object.keys(d.options || {}) });
          if (pick === 'new_site') {
            const m = String(d.options?.new_site?.description || '').match(/as it stands, (\d+) of ten in it/);
            leaves.push({ port: f.port, t, placed: m ? +m[1] : null, sf });
          }
        }
      }
      if (step) prevStep = step;
    }
  }
  return { slots, asks, leaves, errors };
}

function measure({ since = Date.parse('2026-09-30T06:00:00Z'), to = Infinity, port = null, dir = FLIGHT } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')); } catch (_) { return null; }
  const byPort = new Map();
  for (const n of names) {
    const p = portOf(n), start = fileStart(n);
    if (!Number.isFinite(p) || !Number.isFinite(start) || (port && p !== port)) continue;
    if (start > to || start < since - 6 * 3600000) continue;
    if (!byPort.has(p)) byPort.set(p, []);
    byPort.get(p).push({ f: path.join(dir, n), start, port: p });
  }
  const all = { slots: [], asks: [], leaves: [], errors: {} };
  for (const [, files] of [...byPort].sort((a, b) => a[0] - b[0])) {
    files.sort((a, b) => a.start - b.start);
    const r = readPort(files, since, to);
    all.slots.push(...r.slots); all.asks.push(...r.asks); all.leaves.push(...r.leaves);
    for (const [k, v] of Object.entries(r.errors)) all.errors[k] = (all.errors[k] || 0) + v;
  }
  return summarize(all);
}

function summarize({ slots, asks, leaves, errors }) {
  const worked = slots.filter(s => Object.keys(s.phases).some(p => p !== 'fetch_lava' && p !== 'water_bucket'));
  const has = (s, ...ps) => ps.some(p => s.phases[p]);
  const stand = worked.filter(s => has(s, 'lava', 'water'));
  const dug = worked.filter(s => has(s, 'dig_stand', 'clear_line', 'clear_top'));
  const walled = worked.filter(s => has(s, 'wall'));
  const poured = worked.filter(s => s.lava > 0);
  const watered = worked.filter(s => s.water > 0 || s.phases.water);
  // Formed: lava went in, the cast went on to another slot and never came
  // back to this one in the session.
  const formed = poured.filter(s => s.left && !s.back);
  const pourAgain = worked.filter(s => s.lava > 1 || s.lavaAgain);
  // Asks at a site failure, and the ones within 30 s of the last at the
  // same port.
  asks.sort((a, b) => a.port - b.port || a.t - b.t);
  let within30 = 0;
  asks.forEach((a, i) => { const b = asks[i - 1]; if (b && b.port === a.port && a.t - b.t <= 30000) { a.within30 = true; within30++; } });
  // The failures by reason: the last ask of each run at one frame and cast
  // count holds that run's reasons.
  const runs = new Map();
  for (const a of asks) runs.set(`${a.port}|${a.origin.x},${a.origin.y},${a.origin.z}|${a.cast}`, a);
  const reasons = {}; let failures = 0;
  for (const a of runs.values()) {
    failures += a.n;
    for (const [w, n] of Object.entries(a.whys)) { const r = reasonOf(w); reasons[r] = (reasons[r] || 0) + n; }
  }
  // Asked with no cast way left on offer (the ledger had rested the keep
  // from here), and what was chosen then.
  const noKeep = asks.filter(a => !a.options.includes('cast_frame') && !a.options.includes('cast_at_lava'));
  const noKeepLeft = noKeep.filter(a => a.pick === 'new_site').length;
  // Leaving within 30 s of a site-failure ask, and at what count.
  const afterAsks = leaves.filter(l => l.sf);
  // Note 767's rules over the same asks: a failure of the cast's own
  // fetches is the trip's, not asked about at the site; and an answer that
  // kept or repaired the frame holds (not asked) through failures of the
  // same kind at the same frame and count for 180 s.
  const kindOf = why => String(why || '').split(':')[0].replace(/\s*\(-?\d+, -?\d+, -?\d+\)/g, '').replace(/\s+at$/, '').replace(/\d+/g, 'N').trim();
  const TRIP = /^(Water source is outside visible interaction reach|No existing route to the saved mining worksite)/;
  let sim = { sent: 0, within30: 0, newSite: 0, trip: 0 }, held = null, lastSent = null;
  for (const a of asks) {
    const top = Object.entries(a.whys).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
    if (TRIP.test(top)) { sim.trip++; continue; }
    const k = kindOf(Object.keys(a.whys).at(-1) || top);
    const same = held && held.port === a.port && held.origin === `${a.origin.x},${a.origin.y},${a.origin.z}` && held.cast === a.cast && held.kind === k && a.t - held.t <= 180000;
    if (same) continue;
    sim.sent++;
    if (lastSent && lastSent.port === a.port && a.t - lastSent.t <= 30000) sim.within30++;
    lastSent = a;
    if (a.pick === 'new_site') { sim.newSite++; held = null; continue; }
    held = { port: a.port, origin: `${a.origin.x},${a.origin.y},${a.origin.z}`, cast: a.cast, kind: k, t: a.t };
  }
  return {
    slots: worked.length, stand: stand.length, dug: dug.length, walled: walled.length, poured: poured.length, watered: watered.length, formed: formed.length, pourAgain: pourAgain.length,
    asks: asks.length, within30, runs: runs.size, failures, reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    newSite: leaves.length, newSiteAtFailure: afterAsks.length, sim, noKeep: noKeep.length, noKeepLeft, newSitePlaced: leaves.map(l => l.placed),
    leaves: leaves.map(l => ({ port: l.port, at: new Date(l.t).toISOString(), placed: l.placed, why: l.sf ? Object.keys(l.sf.whys)[0] : null })),
    errors: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 15),
    asksList: asks.map(a => ({ port: a.port, at: new Date(a.t).toISOString(), cast: a.cast, n: a.n, pick: a.pick, within30: !!a.within30, why: Object.keys(a.whys)[0] })),
  };
}

function main() {
  const since = Date.parse(opt('--since', '2026-09-30T06:00:00Z'));
  const to = opt('--to', null) ? Date.parse(opt('--to', null)) : Infinity;
  const port = opt('--port', null) ? Number(opt('--port', null)) : null;
  const r = measure({ since, to, port });
  if (!r) { console.log('no records'); return; }
  if (has('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`Slots worked: ${r.slots}; a stand reached (poured from) ${r.stand}; a stand dug or a line cleared ${r.dug}; walls put up ${r.walled}; lava poured ${r.poured}; water poured ${r.watered}; turned to obsidian ${r.formed}; poured into twice or more ${r.pourAgain}.`);
  console.log(`Site-failure asks of portal_method: ${r.asks} (${r.within30} within 30 s of the last at that port), over ${r.runs} runs at a frame and count, ${r.failures} failures said.`);
  console.log('Failures by reason:');
  for (const [w, n] of r.reasons) console.log(`  ${n}\t${w}`);
  console.log(`Asked with no cast way on offer (the keep rested by the ledger): ${r.noKeep}, new_site chosen at ${r.noKeepLeft} of them.`);
  console.log(`new_site chosen: ${r.newSite} (${r.newSiteAtFailure} at a site failure); blocks cast then: ${JSON.stringify(r.newSitePlaced)}`);
  for (const l of r.leaves) console.log(`  ${l.port} ${l.at} ${l.placed} of ten: ${l.why || '-'}`);
  console.log(`Under note 767's rules (the trip's failures not asked at the site; a keep or repair held 180 s through failures of the same kind at the same frame and count): ${r.sim.sent} asks of ${r.asks} sent (${r.sim.within30} within 30 s of the last at that port), ${r.sim.trip} not asked as the trip's; new_site chosen at an ask still sent: ${r.sim.newSite} of ${r.newSiteAtFailure}.`);
  console.log('Errors thrown during the cast (not swallowed):');
  for (const [w, n] of r.errors) console.log(`  ${n}\t${w}`);
  if (has('--verbose')) for (const a of r.asksList) console.log(`  ${a.port} ${a.at} cast ${a.cast} n ${a.n} -> ${a.pick}${a.within30 ? ' (within 30 s)' : ''}: ${a.why}`);
}

if (require.main === module) main();
module.exports = { measure, summarize, siteFailure, reasonOf };
