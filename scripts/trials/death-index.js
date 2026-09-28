'use strict';
// Every death on the trial servers, found in their logs, with the replay
// recording it happened in (ServerReplay, one file per connection) and the
// time into that recording, for rendering in ReplayMod. The recordings are
// copied into a Prism Launcher instance's replay_recordings folder under a
// name that says the world, the time and the cause.
//   node scripts/trials/death-index.js ["<instance>/minecraft/replay_recordings"]
// Writes artifacts/deaths.json.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2] || (process.env.REPLAY_RECORDINGS || path.join(process.env.HOME, 'Library/Application Support/PrismLauncher/instances/Jev Replays/minecraft/replay_recordings'));
const DEATH = / Jev ((was|died|fell|drowned|blew|burned|hit the|tried|walked into|suffocated|experienced|went|froze|starved|withered|discovered)[^\n]*)/;
const servers = fs.readdirSync(ROOT).filter(d => /^\.clean-run(-\d+)?$/.test(d));
const deaths = [];
for (const dir of servers) {
  const logs = path.join(ROOT, dir, 'logs');
  if (!fs.existsSync(logs)) continue;
  for (const f of fs.readdirSync(logs).sort()) {
    const file = path.join(logs, f);
    const text = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString() : f === 'latest.log' ? fs.readFileSync(file, 'utf8') : null;
    if (!text) continue;
    // The day of the log: dated archives by name, latest.log by its time.
    const day = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10);
    let world = null;
    for (const line of text.split('\n')) {
      const level = line.match(/Preparing level "([^"]+)"/);
      if (level) world = level[1];
      const d = line.match(DEATH);
      const t = line.match(/^\[(\d\d):(\d\d):(\d\d)\]/);
      if (d && t) deaths.push({ server: dir, world, cause: `Jev ${d[1]}`.trim(), local: `${day}T${t[1]}:${t[2]}:${t[3]}` });
    }
  }
}
// The recording a death is in: the latest that began before it, on its server.
for (const d of deaths) {
  const recs = path.join(ROOT, d.server, 'recordings', 'players');
  const files = fs.existsSync(recs) ? fs.readdirSync(recs).flatMap(u => fs.readdirSync(path.join(recs, u)).filter(f => f.endsWith('.mcpr')).map(f => path.join(recs, u, f))) : [];
  const startOf = f => { const m = path.basename(f).match(/(\d{4}-\d{2}-\d{2})--(\d\d)-(\d\d)-(\d\d)/); return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}`).getTime() : NaN; };
  const at = new Date(d.local).getTime();
  const rec = files.filter(f => startOf(f) <= at).sort((a, b) => startOf(b) - startOf(a))[0];
  if (!rec) continue;
  d.recording = rec; d.secondsIn = Math.round((at - startOf(rec)) / 1000);
  const slug = `${d.world}-${d.local.slice(11).replaceAll(':', '')}-${d.cause.replace(/^Jev /, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 90);
  d.file = `${slug}.mcpr`;
  try { fs.mkdirSync(OUT, { recursive: true }); if (!fs.existsSync(path.join(OUT, d.file))) fs.copyFileSync(rec, path.join(OUT, d.file)); } catch (err) { d.copyError = err.message; }
}
const found = deaths.filter(d => d.recording);
fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts', 'deaths.json'), JSON.stringify(found, null, 2));
for (const d of found) console.log(`${d.file}  death at ${Math.floor(d.secondsIn / 60)}:${String(d.secondsIn % 60).padStart(2, '0')} into the replay`);
console.log(`${found.length} deaths with recordings (${deaths.length - found.length} before the recording servers)`);
