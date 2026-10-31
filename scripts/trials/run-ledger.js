'use strict';
// The full-run ledger (note 1911): the user's goal of 2026-10-19 is a run
// from a fresh survival world to the dragon's death in one life, then the
// time it takes brought down. For each fresh trial's flight record (a
// midgame-mid-NNN-xx.log with no stage suffix) this prints when it began,
// the minutes to its first Nether, fortress rod, pearl, stronghold, End and
// dragon, its deaths, and where it stands or ended; then the funnel: how many
// runs reached each stage and the median minutes there.
//   node scripts/trials/run-ledger.js [artifacts dir]
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', '..', 'artifacts');
// A first-days record is a run from the world's birth (first-days.js start): the full run the goal asks for. A midgame record begins three days in.
const files = fs.readdirSync(dir).filter(f => /^midgame-mid-\d+-[a-z]+\.log$/.test(f) || /^first-days-[a-z0-9-]+\.log$/.test(f)).sort();
const minutes = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
// Read line by line (note 1958): a fresh run's record passes half a gigabyte in a day (first-days-full-2.log, 2026-10-20), past what one string holds (ERR_STRING_TOO_LONG), and the ledger would not run.
const readLines = file => new Promise((resolve, reject) => {
  const out = []; const rl = require('readline').createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  rl.on('line', line => { if (line.startsWith('{')) out.push(line); }); rl.on('close', () => resolve(out)); rl.on('error', reject);
});
const rows = [];
(async () => {
for (const f of files) {
  const lines = await readLines(path.join(dir, f));
  let start = null, last = null, nether = null, rod = null, pearl = null, stronghold = null, end = null, dragon = null, deaths = 0, dimension = 'overworld', step = null, health = null;
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch (_) { continue; }
    const at = d.decision?.at || d.death?.at || null;
    if (at) { start ||= at; last = at; }
    if (d.death) { deaths++; continue; }
    const dim = d.decision?.dimension || d.death?.dimension;
    if (dim) dimension = dim;
    if (dim === 'the_nether' && !nether) nether = at;
    if (dim === 'the_end' && !end) end = at;
    const s = JSON.stringify(d.step || {});
    // Held, not planned (note 1924): the step's produces carries "blaze_rod":7 at the rung's start, and full-2 read a rod at minute 48 with none in hand.
    const inv = /"inventory":\{[^}]*\}/.exec(line)?.[0] || '';
    if (/"blaze_rod":[1-9]/.test(inv) && !rod) rod = at;
    if (/"ender_pearl":[1-9]/.test(inv) && !pearl) pearl = at;
    if (/stronghold/.test(s) && /portal_room|eyes? (set|placed)|frame/.test(line) && !stronghold) stronghold = at;
    // A kill is the dragon at no health (note 2639; the project review of 2026-10-30, item 17): the pattern before took any
    // single-digit health with a decimal, 5.5 among them, as a kill.
    if (/"dragonHealth":0(\.0+)?[,}]/.test(line) && end && !dragon) dragon = at;
    step = d.step?.action || step;
    const h = /"health":([0-9.]+),"food"/.exec(line); if (h) health = Number(h[1]);
  }
  rows.push({ run: f.replace(/^midgame-|\.log$/g, '').replace(/^first-days-/, 'fresh:'), start, total: minutes(start, last), nether: minutes(start, nether), rod: minutes(start, rod), pearl: minutes(start, pearl), stronghold: minutes(start, stronghold), end: minutes(start, end), dragon: minutes(start, dragon), deaths, where: dimension, step, health });
}
const pad = (v, n) => String(v == null ? '-' : v).padStart(n);
console.log(['run'.padEnd(14), pad('min', 5), pad('nether', 7), pad('rod', 5), pad('pearl', 6), pad('strong', 7), pad('end', 5), pad('dragon', 7), pad('deaths', 7), ' where / last step'].join(''));
for (const r of rows) console.log([r.run.padEnd(14), pad(r.total, 5), pad(r.nether, 7), pad(r.rod, 5), pad(r.pearl, 6), pad(r.stronghold, 7), pad(r.end, 5), pad(r.dragon, 7), pad(r.deaths, 7), ` ${r.where} / ${r.step || '-'}${r.health != null ? ` hp ${r.health}` : ''}`].join(''));
const median = xs => { const a = xs.filter(x => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
console.log(`\n${rows.length} fresh runs on disk. Reached: nether ${rows.filter(r => r.nether != null).length} (median ${median(rows.map(r => r.nether))} min), rod ${rows.filter(r => r.rod != null).length} (${median(rows.map(r => r.rod))}), pearl ${rows.filter(r => r.pearl != null).length} (${median(rows.map(r => r.pearl))}), stronghold ${rows.filter(r => r.stronghold != null).length}, end ${rows.filter(r => r.end != null).length} (${median(rows.map(r => r.end))}), dragon ${rows.filter(r => r.dragon != null).length}. Deaths per run: median ${median(rows.map(r => r.deaths))}.`);
})();
