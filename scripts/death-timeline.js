'use strict';
// A trial's last seconds before a death or loop, for triage: the server's
// death line, then frame by frame the health, position, survival action,
// step, the mobs about (with distance, '?' when unseen), who held the turn,
// and each decision with its weights; then the survival log's last lines.
//   node scripts/death-timeline.js <port> [--seconds 60] [--at 2026-09-27T17:29:05Z] [--options]
// Without --at, the last death on the port's server log (or the flight's end).
const fs = require('fs');
const path = require('path');

const port = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).filter(a => a !== '--help').reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const seconds = Number(args.seconds || 60);
const root = path.join(__dirname, '..');
const server = path.join(root, port === '25581' ? '.clean-run' : `.clean-run-${port}`);
const deathRe = /Jev (was|died|fell|drowned|burned|tried|hit the|went|blew|suffocated|starved|experienced|froze|withered|walked into|discovered)/;
let log = '';
try { log = fs.readFileSync(path.join(server, 'logs', 'latest.log'), 'utf8'); } catch (_) {}
const deaths = log.split('\n').filter(l => deathRe.test(l));
const world = (() => { try { return fs.readFileSync(path.join(server, 'server.properties'), 'utf8').match(/^level-name=(.*)$/m)[1]; } catch (_) { return '?'; } })();

const flightDir = path.join(root, '.bot-state', 'flight');
// The files of the moment asked about: begun before it and written after
// it began (a new trial on the port writes newer ones; the six newest hid
// mid-244-v once mid-236-h began).
const atArg = args.at ? Date.parse(args.at) : null;
const begun = f => { const m = f.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0; };
const files = fs.readdirSync(flightDir).filter(f => f.includes(`-${port}-`) && f.endsWith('.jsonl'))
  .map(f => ({ f, t: fs.statSync(path.join(flightDir, f)).mtimeMs, b: begun(f) }))
  .filter(x => !atArg || (x.b <= atArg && x.t >= atArg - Number(args.seconds || 60) * 1000))
  .sort((a, b) => b.t - a.t).slice(0, 6).map(x => x.f);
const frames = [];
for (const f of files) {
  let text = ''; try { text = fs.readFileSync(path.join(flightDir, f), 'utf8'); } catch (_) { continue; }
  for (const line of text.split('\n')) { if (!line) continue; try { frames.push(JSON.parse(line)); } catch (_) {} }
}
frames.sort((a, b) => a.at < b.at ? -1 : 1);
let end = args.at ? Date.parse(args.at) : null;
if (!end) { const dead = frames.filter(f => f.snapshot?.health === 0 && f.kind === 'danger').at(-1); end = dead ? Date.parse(dead.at) : Date.parse(frames.at(-1)?.at); }
console.log(`${world} on ${port}; ${deaths.length} death line(s), the last: ${deaths.at(-1) || 'none'}`);
console.log(`Timeline, ${seconds} s to ${new Date(end).toISOString()}:`);
let last = '';
const rows = [];
const hms = ms => new Date(ms).toISOString().slice(11, 21);
for (const l of frames) {
  const t = Date.parse(l.at);
  if (t < end - seconds * 1000 || t > end + 500) continue;
  const s = l.snapshot || {};
  if (s.decision) {
    const d = s.decision, w = d.judgments?.[0]?.probabilities || {};
    const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    // Printed at the time it was answered (d.at is stamped when the answer
    // comes), with when it was asked, the health it was asked at and how
    // long Jev took. The frame used to be written at the next step's
    // report, after the chosen stance had run; printed at the frame's time
    // with d.at called "asked", it read as seconds of waiting for Jev:
    // mid-229-s's dig_down, answered in 0.2 seconds at 23:36:43.9, was
    // printed at 23:36:49 (note 530; the health at asking, note 522).
    const answered = Date.parse(d.at) || t;
    const asked = Date.parse(d.askedAt) || (Number.isFinite(d.latencyMs) ? answered - d.latencyMs : NaN);
    const took = Number.isFinite(d.latencyMs) ? `, Jev took ${(d.latencyMs / 1000).toFixed(1)} s` : '';
    const when = ` (asked ${Number.isFinite(asked) ? hms(asked) : '?'}${d.state?.health != null ? ` at hp ${Number(d.state.health).toFixed(1)}` : ''}${took})`;
    const lines = [`${hms(answered).slice(0, 8)} DECIDE ${d.id} -> ${(d.path || []).join('/')}${d.noneGood ? ' (none of these)' : ''}${d.stale ? ' (stale, not acted on)' : ''}${when} [${top}]`];
    if (args.options) for (const [k, o] of Object.entries(d.options || {})) lines.push(`           - ${k}: ${String(typeof o.description === 'string' ? o.description : JSON.stringify(o.description)).slice(0, 300)}`);
    rows.push([answered, lines]);
    continue;
  }
  if (!s.position || l.kind === 'observation') continue;
  const mobs = (s.mobs || []).slice(0, 4).map(m => `${m.name}@${m.d}${m.seen ? '' : '?'}`).join(',');
  const row = `hp ${s.health?.toFixed?.(1)} ${s.position.x.toFixed(1)},${s.position.y.toFixed(1)},${s.position.z.toFixed(1)} ${s.survivalAction?.action || '-'} | ${s.step?.action || '-'}${s.step?.phase ? ':' + s.step.phase : ''} | ${(l.label || '').slice(0, 70)} [${mobs}] ${s.turn ? `${s.turn.holder}/${s.turn.phase}` : ''}`;
  if (row !== last) { rows.push([t, [`${l.at.slice(11, 19)} ${row}`]]); last = row; }
}
rows.sort((a, b) => a[0] - b[0]);
for (const [, lines] of rows) for (const line of lines) console.log(line);
const botLog = path.join(root, 'artifacts', `midgame-${world}.log`);
try {
  const lines = fs.readFileSync(botLog, 'utf8').split('\n').filter(l => /^\[(survival|stall|work|missing option)\]/.test(l)).slice(-8);
  if (lines.length) { console.log('\nThe bot log\'s last survival lines:'); for (const l of lines) console.log('  ' + l.slice(0, 220)); }
} catch (_) {}
