'use strict';
// What each answer at a blaze fight led to on the runs now playing (note 2602): read from the full runs' logs
// (artifacts/first-days-full-*.log), every answer of encounter_stance with a blaze within sixteen, of hunt_target at
// blazes and of empty_spawner, in the Nether; and for each option, how many times it was chosen, how many were followed
// within two minutes by a blaze killed ('[blaze] one killed' in the log), how many by a death within two minutes, and the
// health lost in the next thirty seconds. Written to artifacts/blaze-outcomes.json, which src/blaze-outcomes.js says on
// each option and in the question's state. Run by scripts/trials/janitor.sh every twenty minutes.
//
//   node scripts/trials/blaze-outcomes.js [--hours 24] [--out artifacts/blaze-outcomes.json] [--print]
//
// On 2026-10-30 (to 19:20Z) the stale tables said on the options (notes 1027, 2168, 2274) were a week old; the day's own
// record read: corner ambush chosen 23 times, a kill after 52%, a death after 9%; close in 12, 100% and 0%; take cover
// 130, 5% and 15%; keep working 106, 5% and 22%; retreat 94, 5% and 23%. None of that reached Jev.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const KILL_MS = 120000, DEATH_MS = 120000, LOST_MS = 30000;
const QUESTIONS = new Set(['encounter_stance', 'hunt_target', 'empty_spawner']);

function args() {
  const a = process.argv.slice(2), get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { hours: Number(get('--hours', 24)), out: get('--out', path.join(__dirname, '..', '..', 'artifacts', 'blaze-outcomes.json')), print: a.includes('--print'), dir: get('--dir', path.join(__dirname, '..', '..', 'artifacts')) };
}

// One log's events: answers (at, question, key, health), kills (at), deaths (at), health readings (at, health).
async function readLog(file, sinceMs) {
  const answers = [], kills = [], deaths = [], hps = [];
  const seen = new Set();
  let lastAt = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.startsWith('{"status"')) {
      let d; try { d = JSON.parse(line); } catch (_) { continue; }
      const dec = d.decision, st = dec && dec.state;
      if (!dec || !dec.at) continue;
      const at = Date.parse(dec.at);
      if (!Number.isFinite(at)) continue;
      lastAt = at;
      if (st && typeof st === 'object' && Number.isFinite(st.health)) hps.push([at, st.health]);
      if (at < sinceMs || !QUESTIONS.has(dec.id) || seen.has(dec.askedAt)) continue;
      const dim = String((st && st.dimension) || '');
      if (!/nether/.test(dim)) continue;
      const key = Array.isArray(dec.path) ? dec.path[0] : null;
      if (!key) continue;
      if (dec.id === 'encounter_stance' && !(st.threats || []).some(t => t && t.name === 'blaze' && t.distance <= 16)) continue;
      if (dec.id === 'hunt_target' && !(st.resource === 'blaze_rod' || /blaze/.test(JSON.stringify(st.blazes || '')) || Object.keys(dec.options || {}).some(k => /^(charge_nearest|close_in|box_here|box_at_spawner)$/.test(k)))) continue;
      seen.add(dec.askedAt);
      answers.push({ at, q: dec.id, key, health: Number.isFinite(st.health) ? st.health : null });
    } else if (line.startsWith('[blaze] one killed')) {
      // The log's lines carry no time: the kill is placed at the last decision's time (within a few seconds of it).
      if (lastAt) kills.push(lastAt);
    } else if (line.startsWith('{"death"')) {
      let d; try { d = JSON.parse(line).death; } catch (_) { continue; }
      if (d && d.status === 'pending' && d.at && /nether/.test(String(d.dimension || ''))) deaths.push(Date.parse(d.at));
    }
  }
  return { answers, kills, deaths, hps };
}

function tally(logs) {
  const by = {};
  for (const { answers, kills, deaths, hps } of logs) {
    kills.sort((a, b) => a - b); deaths.sort((a, b) => a - b); hps.sort((a, b) => a[0] - b[0]);
    for (const a of answers) {
      const q = by[a.q] ||= {}, r = q[a.key] ||= { n: 0, kill: 0, died: 0, lostSum: 0, lostN: 0 };
      r.n++;
      if (kills.some(t => t >= a.at && t - a.at <= KILL_MS)) r.kill++;
      if (deaths.some(t => t >= a.at && t - a.at <= DEATH_MS)) r.died++;
      if (a.health !== null) {
        const later = hps.filter(([t]) => t > a.at && t - a.at <= LOST_MS).map(([, h]) => h);
        if (later.length) { r.lostSum += Math.max(0, a.health - Math.min(...later)); r.lostN++; }
      }
    }
  }
  for (const q of Object.values(by)) for (const r of Object.values(q)) { r.lost = r.lostN ? Math.round(r.lostSum / r.lostN * 10) / 10 : null; delete r.lostSum; delete r.lostN; }
  return by;
}

async function compute({ dir, hours }) {
  const sinceMs = Date.now() - hours * 3600000;
  const files = fs.readdirSync(dir).filter(f => /^first-days-full-\d+\.log$/.test(f)).map(f => path.join(dir, f))
    .filter(f => { try { return fs.statSync(f).mtimeMs >= sinceMs; } catch (_) { return false; } });
  const logs = [];
  for (const f of files) { try { logs.push(await readLog(f, sinceMs)); } catch (_) { /* a log mid-rotation */ } }
  return { from: new Date(sinceMs).toISOString(), to: new Date().toISOString(), logs: files.length, questions: tally(logs) };
}

async function main() {
  const a = args();
  const out = await compute(a);
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  const tmp = `${a.out}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, a.out);
  if (a.print) {
    for (const [q, rows] of Object.entries(out.questions)) {
      console.log(`== ${q}`);
      for (const [k, r] of Object.entries(rows).sort((x, y) => y[1].n - x[1].n)) console.log(`${k.padEnd(24)} n=${String(r.n).padStart(4)} kill ${String(Math.round(100 * r.kill / r.n)).padStart(3)}% died ${String(Math.round(100 * r.died / r.n)).padStart(3)}% lost ${r.lost ?? '-'}`);
    }
  }
  console.log(`blaze outcomes: ${out.logs} logs, ${Object.values(out.questions).reduce((n, q) => n + Object.values(q).reduce((m, r) => m + r.n, 0), 0)} answers, written to ${a.out}`);
}

module.exports = { readLog, tally, compute, KILL_MS, DEATH_MS, LOST_MS };
if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
