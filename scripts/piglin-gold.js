#!/usr/bin/env node
'use strict';
// Piglins and gold, from the flight records (trial note 773): in the Nether,
// the hits piglins landed and whether any gold armour piece was worn when
// they did, the stance questions asked with a piglin among the threats (and
// whether their options said gold), the deaths that came within fifteen
// seconds of a piglin's hit, and how much gold was carried (golden armour,
// ingots, raw gold) at each piglin stance question. A piglin leaves a player
// wearing any gold armour piece alone, save one struck by it (PiglinAi).
//
//   node scripts/piglin-gold.js [--since ISO] [--to ISO] [--port N] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GOLD_ARMOUR = /^golden_(helmet|chestplate|leggings|boots)$/;
const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const portOf = name => Number((name.match(/^127_0_0_1-(\d+)-/) || [])[1]);

async function readFile(file, { since, to }) {
  const r = { piglinHits: 0, hitsGoldWorn: 0, stanceAsks: 0, stanceAsksGoldWorn: 0, stanceAsksGoldSaid: 0, stanceAsksGoldInState: 0, stanceAsksGoldCarried: 0, stanceAsksIngots: 0, stanceAsksRawGold: 0,
    deathsAfterPiglinHit: 0, netherFiles: 0, examples: [] };
  let lastPiglinHit = -Infinity, lastHealth = null, nether = false;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const head = line.slice(0, 300);
    const am = line.match(/"at":"([^"]+)"\}?$/) || line.match(/"at":"([^"]+)"/);
    const t = am ? Date.parse(am[1]) : NaN;
    if (!(t >= since && t <= to)) continue;
    const isNether = /"dimension":"(minecraft:)?the_nether"/.test(line.slice(0, 2000));
    const kind = (head.match(/^\{"kind":"([^"]+)"/) || [])[1];
    const hm = line.match(/"health":(-?[\d.]+)/);
    const health = hm ? +hm[1] : null;
    if (isNether) nether = true;
    if (kind === 'damage' && /by piglin"/.test(head)) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      if (!/nether/.test(o.snapshot?.dimension || '')) continue;
      r.piglinHits++; lastPiglinHit = t;
      const eq = o.snapshot?.equipment || {};
      if (Object.values(eq).some(n => GOLD_ARMOUR.test(n || ''))) r.hitsGoldWorn++;
    }
    if (health === 0 && lastHealth > 0 && t - lastPiglinHit <= 15000) r.deathsAfterPiglinHit++;
    if (health != null) lastHealth = health;
    if (kind === 'decision' && /"id":"encounter_stance"/.test(line) && /"piglin"/.test(line)) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const d = o.snapshot?.decision, st = d?.state || {};
      if (!/nether/.test(o.snapshot?.dimension || '')) continue;
      const threats = JSON.stringify(st.threats || st.estimate || '');
      if (!/piglin/.test(threats)) continue;
      r.stanceAsks++;
      const eq = o.snapshot?.equipment || {}, inv = o.snapshot?.inventory || {};
      if (Object.values(eq).some(n => GOLD_ARMOUR.test(n || ''))) r.stanceAsksGoldWorn++;
      if (Object.keys(inv).some(n => GOLD_ARMOUR.test(n))) r.stanceAsksGoldCarried++;
      if (inv.gold_ingot) r.stanceAsksIngots++;
      if (inv.raw_gold) r.stanceAsksRawGold++;
      if (st.piglinsAndGold) r.stanceAsksGoldInState++;
      const opts = Object.entries(d.options || {}).filter(([k]) => k !== 'none_good');
      if (opts.length && opts.every(([, v]) => /gold/i.test(typeof v.description === 'string' ? v.description : JSON.stringify(v.description)))) r.stanceAsksGoldSaid++;
      if (r.examples.length < 3) r.examples.push({ at: new Date(t).toISOString(), choice: d.path?.at(-1), goldWorn: Object.values(eq).filter(n => /^golden_/.test(n || '')), rawGold: inv.raw_gold || 0, ingots: inv.gold_ingot || 0 });
    }
  }
  r.netherFiles = nether ? 1 : 0;
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const since = Date.parse(opt('--since', '2026-09-30T06:00:00Z')), to = opt('--to') ? Date.parse(opt('--to')) : Infinity;
  const port = opt('--port') ? Number(opt('--port')) : null;
  const dir = path.join(ROOT, '.bot-state', 'flight');
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl') && n.startsWith('127_0_0_1-'))
    .filter(n => (port == null || portOf(n) === port) && fileStart(n) <= to)
    .filter(n => { try { return fs.statSync(path.join(dir, n)).mtimeMs >= since; } catch (_) { return false; } });
  const all = { files: files.length };
  const examples = [];
  for (const n of files) {
    const r = await readFile(path.join(dir, n), { since, to });
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') all[k] = (all[k] || 0) + v;
    for (const e of r.examples) if (examples.length < 8) examples.push({ port: portOf(n), ...e });
  }
  if (args.includes('--json')) { console.log(JSON.stringify({ since: new Date(since).toISOString(), ...all, examples }, null, 2)); return; }
  console.log(`Flight records since ${new Date(since).toISOString()}: ${all.files} files, ${all.netherFiles} with Nether frames.`);
  console.log(`Piglin hits in the Nether: ${all.piglinHits}, ${all.hitsGoldWorn} with a gold armour piece worn; deaths within 15 s of a piglin's hit: ${all.deathsAfterPiglinHit}.`);
  console.log(`Stance questions with a piglin among the threats: ${all.stanceAsks}; gold worn at ${all.stanceAsksGoldWorn}, a gold armour piece carried unworn at ${all.stanceAsksGoldCarried}, gold ingots carried at ${all.stanceAsksIngots}, raw gold at ${all.stanceAsksRawGold}; the gold rule in the question's state at ${all.stanceAsksGoldInState}, in every option's words at ${all.stanceAsksGoldSaid}.`);
  for (const e of examples) console.log(`  ${e.port} ${e.at} ${e.choice} gold worn ${e.goldWorn.join(',') || 'none'} raw gold ${e.rawGold} ingots ${e.ingots}`);
}
if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
module.exports = { readFile };
