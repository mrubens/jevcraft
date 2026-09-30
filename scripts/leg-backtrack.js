#!/usr/bin/env node
'use strict';
// The fortress search's legs over the flight records (note 688): how many
// legs chosen went back over ground already seen (more than half of what
// the leg looks over seen before), how many went straight back over the
// last leg's own line, and how many legs each fortress found took.
//
//   node scripts/leg-backtrack.js [--since 2026-09-29T12:00Z] [--json]
//
// A leg is a fortress_leg answer that goes a way (leg_*, floor_*,
// widen_search). A fortress found is a fortress_approach asked on a port
// with none asked there in the ten minutes before; the legs chosen on that
// port since the last one found are its count. Legs after the last one
// found on a port are a search that had found nothing when the records end.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const since = new Date(opt('--since', '2026-09-29T12:00:00Z')).getTime();
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const dir = opt('--dir', path.join(ROOT, '.bot-state', 'flight'));
const FOUND_GAP = 10 * 60000;

// What a leg's text says of the ground it looks over, in either wording.
function coverageOf(text) {
  if (!text) return {};
  let m = text.match(/Unseen ahead: about (\d+) of (\d+) chunks/);
  let unseen = null, all = null;
  if (m) { unseen = +m[1]; all = +m[2]; }
  else if ((m = text.match(/\(about (\d+) chunks\), about (\d+) chunks? (?:is|are) unseen/))) { all = +m[1]; unseen = +m[2]; }
  const stood = text.match(/stood on (\d+) of (?:the )?(\d+) blocks/);
  const back = /back the way the last leg came|Back over the last leg's (?:own )?(?:ground|line)/i.test(text);
  return { unseen, all, stood: stood ? +stood[1] : null, back };
}
const seenShare = c => Number.isFinite(c.unseen) && c.all ? 1 - c.unseen / c.all : null;
const isLeg = k => /^(leg|floor|round)_|^widen_search$/.test(k || '');

async function main() {
  const tsOf = f => { const m = f.match(/-Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)/); return m ? new Date(`${m[1]}:${m[2]}:${m[3]}Z`).getTime() : 0; };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && tsOf(f) >= since - 6 * 3600000).sort();
  const events = [];
  for (const f of files) {
    const port = (f.match(/-(\d{5})-Jev-/) || [])[1] || '?';
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"kind":"decision"') || !(line.includes('"id":"fortress_leg"') || line.includes('"id":"fortress_approach"'))) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const d = r.snapshot?.decision; if (!d) continue;
      const at = new Date(r.at || d.at).getTime(); if (!(at >= since)) continue;
      if (d.id === 'fortress_approach') { events.push({ port, at, file: f, kind: 'approach' }); continue; }
      const chosen = d.path?.at(-1);
      const opts = d.options || {};
      const text = k => opts[k]?.description ?? (typeof opts[k] === 'string' ? opts[k] : null);
      const legs = Object.keys(opts).filter(isLeg).map(k => ({ k, ...coverageOf(text(k)) }));
      events.push({ port, at, file: f, kind: 'leg', chosen, isLeg: isLeg(chosen), c: coverageOf(text(chosen)), legs, pos: r.snapshot?.position });
    }
  }
  events.sort((a, b) => a.port.localeCompare(b.port) || a.at - b.at);
  const out = { since: new Date(since).toISOString(), files: files.length, asked: 0, legsChosen: 0, withCoverage: 0, overHalfSeen: 0, overHalfSeenWithFresherOffered: 0, backOverLastLeg: 0, backOverHalfSeen: 0, stoodOverHalf: 0, found: [], unfinished: [], examples: [] };
  const lastApproach = {}, sinceFound = {};
  for (const e of events) {
    if (e.kind === 'approach') {
      if (!(lastApproach[e.port] > e.at - FOUND_GAP)) { out.found.push({ port: e.port, at: new Date(e.at).toISOString(), legs: sinceFound[e.port] || 0 }); sinceFound[e.port] = 0; }
      lastApproach[e.port] = e.at;
      continue;
    }
    out.asked++;
    if (!e.isLeg) continue;
    out.legsChosen++; sinceFound[e.port] = (sinceFound[e.port] || 0) + 1;
    const share = seenShare(e.c);
    if (share !== null) out.withCoverage++;
    if (e.c.stood !== null && e.c.stood > 48) out.stoodOverHalf++;
    if (e.c.back) out.backOverLastLeg++;
    if (share !== null && share > 0.5) {
      out.overHalfSeen++;
      if (e.c.back) out.backOverHalfSeen++;
      const fresher = e.legs.filter(l => l.k !== e.chosen && seenShare(l) !== null && seenShare(l) <= 0.5);
      if (fresher.length) out.overHalfSeenWithFresherOffered++;
      if (out.examples.length < 12 || args.includes('--list')) out.examples.push({ port: e.port, at: new Date(e.at).toISOString(), file: e.file, chosen: e.chosen, seen: Math.round(share * 100), stood: e.c.stood, back: e.c.back, fresher: fresher.map(l => `${l.k} ${Math.round(seenShare(l) * 100)}% seen`) });
    }
  }
  for (const [port, n] of Object.entries(sinceFound)) if (n) out.unfinished.push({ port, legs: n });
  const counts = out.found.map(f => f.legs).sort((a, b) => a - b);
  out.legsPerFortress = counts.length ? { found: counts.length, median: counts[Math.floor(counts.length / 2)], mean: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length * 10) / 10, max: counts.at(-1), counts } : null;
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`Flight records since ${out.since}: ${out.files} files, fortress_leg asked ${out.asked} times, a leg chosen ${out.legsChosen} times (${out.withCoverage} with the ground seen said).`);
  console.log(`Legs chosen over ground more than half seen: ${out.overHalfSeen} (${out.overHalfSeenWithFresherOffered} of them with a leg at half or less seen on offer); back the way the last leg came: ${out.backOverLastLeg} (${out.backOverHalfSeen} of them more than half seen); on a line stood on for more than half its blocks: ${out.stoodOverHalf}.`);
  if (out.legsPerFortress) console.log(`Fortresses found: ${out.legsPerFortress.found}; legs chosen before each: median ${out.legsPerFortress.median}, mean ${out.legsPerFortress.mean}, most ${out.legsPerFortress.max} (${out.legsPerFortress.counts.join(', ')}).`);
  console.log(`Searches with no fortress found when the records end: ${out.unfinished.map(u => `${u.port} ${u.legs} legs`).join(', ') || 'none'}.`);
  for (const x of out.examples) console.log(`  ${x.port} ${x.at} ${x.chosen}: ${x.seen}% seen, stood ${x.stood}${x.back ? ', back the way the last leg came' : ''}${x.fresher.length ? `; offered: ${x.fresher.join(', ')}` : ''}`);
}
main().catch(err => { console.error(err); process.exit(1); });
