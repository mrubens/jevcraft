#!/usr/bin/env node
'use strict';
// What each layer given the turn at low health came to, from the flight
// records (note 752c): every turn_priority answer at 6 health or under
// (the arbiter's STANCE_HEALTH), by the layer given the turn, with what
// followed in the next 60 seconds: a death (health at 0), the health 30
// seconds on, and the hits taken meanwhile. Also every work-side question
// asked at 6 health or under (any question but turn_priority, the stance,
// shot_answer, body_way, survival_priority, pocket_next and the shelter).
// src/low-health-record.js carries the figures this prints, said on the
// work's option and on work-side questions asked at low health.
//   node scripts/low-health-turns.js [--since ISO] [--to ISO] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const since = Date.parse(opt('--since', '2026-09-29T23:00:00Z'));
const to = opt('--to', null) ? Date.parse(opt('--to')) : Infinity;
const LOW = 6, AFTER_MS = 60000, LATER_MS = 30000;
const SURVIVAL_QS = new Set(['turn_priority', 'encounter_stance', 'shot_answer', 'body_way', 'survival_priority', 'pocket_next', 'shelter_method', 'ranged_response', 'hunt_target', 'empty_spawner', 'unstuck_move', 'way_down', 'climb_out', 'combat_kit']);

const frameAt = line => { const i = line.lastIndexOf('"at":"'); return i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6))); };
const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };

async function readFile(file) {
  const health = [], hurts = [], asks = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const t = frameAt(line);
    if (!(t >= since && t <= to)) continue;
    const h = /"flying":(?:true|false),"health":(-?[\d.]+)/.exec(line);
    if (h) health.push({ t, hp: Number(h[1]) });
    if (line.startsWith('{"kind":"damage"')) hurts.push(t);
    if (line.startsWith('{"kind":"decision"')) {
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const d = o.snapshot?.decision;
      if (!d?.id || !Array.isArray(d.path)) continue;
      const hp = Number.isFinite(d.state?.health) ? d.state.health : o.snapshot?.health;
      if (!(hp <= LOW)) continue;
      const chosen = d.options?.[d.path[0]]?.description;
      asks.push({ t: Date.parse(d.askedAt || o.at) || t, id: d.id, layer: d.path[0], action: chosen?.action || null, hp });
    }
  }
  return { health, hurts, asks };
}

function outcome(rec, a) {
  const after = rec.health.filter(x => x.t > a.t && x.t <= a.t + AFTER_MS);
  const died = after.some(x => x.hp <= 0);
  const later = rec.health.filter(x => x.t >= a.t + LATER_MS - 5000 && x.t <= a.t + LATER_MS + 5000).map(x => x.hp)[0];
  const hits = rec.hurts.filter(x => x > a.t && x <= a.t + LATER_MS).length;
  return { died, later: Number.isFinite(later) ? later : null, hits };
}

async function main() {
  const dir = path.join(ROOT, '.bot-state', 'flight');
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl') && n.startsWith('127_0_0_1-')).map(n => path.join(dir, n))
    .filter(f => fileStart(path.basename(f)) <= to && fs.statSync(f).mtimeMs >= since);
  const turn = {}, work = { asks: 0, died: 0, hits: 0, byId: {} };
  for (const f of files) {
    const rec = await readFile(f);
    for (const a of rec.asks) {
      const o = outcome(rec, a);
      if (a.id === 'turn_priority') {
        const hitBefore = rec.hurts.some(x => x <= a.t && x > a.t - 20000);
        const k = `${a.layer === 'vitals' && a.action === 'eat' ? 'eat' : a.layer}${hitBefore ? ', hit in the 20 s before' : ''}`;
        const b = turn[k] ||= { n: 0, died: 0, laterSum: 0, laterN: 0, hits: 0 };
        b.n++; if (o.died) b.died++; if (o.later !== null && !o.died) { b.laterSum += o.later; b.laterN++; } b.hits += o.hits;
      } else if (!SURVIVAL_QS.has(a.id)) {
        if (rec.hurts.some(x => x <= a.t && x > a.t - 20000)) { work.hitAsks = (work.hitAsks || 0) + 1; if (o.died) work.hitDied = (work.hitDied || 0) + 1; }
        work.asks++; if (o.died) work.died++; work.hits += o.hits; work.byId[a.id] = (work.byId[a.id] || 0) + 1;
      }
    }
  }
  const rows = Object.fromEntries(Object.entries(turn).map(([k, b]) => [k, { turns: b.n, diedWithin60s: b.died, healthAfter30s: b.laterN ? Math.round(b.laterSum / b.laterN * 10) / 10 : null, hitsIn30s: Math.round(b.hits / b.n * 10) / 10 }]));
  const out = { since: new Date(since).toISOString(), files: files.length, turnPriorityAtLowHealth: rows, workQuestionsAtLowHealth: { asks: work.asks, diedWithin60s: work.died, hitBefore: work.hitAsks || 0, hitBeforeDied: work.hitDied || 0, hitsIn30s: work.asks ? Math.round(work.hits / work.asks * 10) / 10 : 0, byQuestion: Object.fromEntries(Object.entries(work.byId).sort((a, b) => b[1] - a[1]).slice(0, 12)) } };
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`Flight records since ${out.since}: ${files.length} files.`);
  console.log('turn_priority at 6 health or under, by the layer given the turn (turns, died within 60 s, mean health 30 s on among those alive, hits in 30 s):');
  for (const [k, r] of Object.entries(rows).sort((a, b) => b[1].turns - a[1].turns)) console.log(`  ${k}: ${r.turns}, died ${r.diedWithin60s} (${Math.round(100 * r.diedWithin60s / r.turns)}%), health after ${r.healthAfter30s}, hits ${r.hitsIn30s}`);
  const w = out.workQuestionsAtLowHealth;
  console.log(`Work-side questions asked at 6 health or under: ${w.asks}, died within 60 s ${w.diedWithin60s} (hit in the 20 s before: ${w.hitBefore}, died ${w.hitBeforeDied}), hits in 30 s ${w.hitsIn30s} a question; by question ${Object.entries(w.byQuestion).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
}
module.exports = { readFile, outcome };
if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
