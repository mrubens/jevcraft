'use strict';
// The walk out with rods (note 762): every life in the flight records that
// carried 4 or more blaze rods in the Nether (scripts/rod-stage.js's lives)
// and started back toward a portal (a return_to_portal, home_with_rods,
// return_overworld or pillar_to_portal step, or portal_way asked). For each:
// the way in (the cells stood on in the Nether before the walk out began,
// from the portal or the life's start), the walk out's route (its cells, how
// many of them on or beside the way in, the ways chosen, crossings), how it
// ended (a death: lava, a fall, a mob; out of the Nether; the record's end),
// where a death happened against the way in (the nearest cell stood on
// before), and the last 60 seconds: questions, answers, health and the
// body's height, the drops and the lava hurts.
// With --simulate, each walk out's cells are replayed against the new rule
// (src/walk-out.js): the way back by the cells stood on (backTrail) from
// where the walk out began, and whether the death's cell is on that way.
//   node scripts/walk-out.js [--from 2026-09-29T23:00:00Z] [--to ISO] [--dir <flight dir>] [--min 4] [--json <file>] [--detail]
const path = require('path');
const fs = require('fs');
const { read } = require('./rod-stage');

const WALK_OUT = new Set(['return_to_portal', 'home_with_rods', 'return_overworld', 'pillar_to_portal', 'enter_portal']);
const WINDOW_MS = 60000;
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const key = c => `${c.x},${c.y},${c.z}`;
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };

// The raw frames of a life's files in its time, with what the walk reads.
function framesOf(dir, files, from, to) {
  const out = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (_) { continue; }
      const at = Date.parse(r.at);
      if (!(at >= from && at <= to)) continue;
      const s = r.snapshot || {}, d = s.decision;
      out.push({ at, kind: r.kind, label: r.label, detail: r.kind === 'damage' ? r.detail : undefined,
        pos: s.position, dim: s.dimension, hp: typeof s.health === 'number' ? s.health : null, onGround: s.onGround,
        rods: s.inventory ? (s.inventory.blaze_rod || 0) : undefined, step: s.goal?.step?.action || s.step?.action, portal: s.goal?.step?.portal || s.step?.portal,
        survival: s.goal?.survivalAction?.action || s.survivalAction?.action,
        decision: r.kind === 'decision' && d ? { id: d.id, choice: d.path?.at(-1), p: d.judgments?.[0]?.probabilities } : null });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Cells stood on, from positions: the cell under a body on the ground, its
// feet cell recorded (the pathfinder's node), in the Nether only.
function trailOf(frames) {
  const cells = new Map();
  for (const f of frames) if (f.pos && f.dim === 'the_nether' && f.onGround !== false && f.hp !== 0) { const c = cellOf(f.pos); cells.set(key(c), c); }
  return [...cells.values()];
}
const nearest = (cells, p) => { let best = Infinity; for (const c of cells) best = Math.min(best, Math.hypot(c.x + 0.5 - p.x, c.y - p.y, c.z + 0.5 - p.z)); return best; };

// The port's records from `from` on (a trial's world goes on across
// records: a deploy's restart, a reconnect).
function portFiles(dir, file, from, to) {
  const port = (file.match(/-(\d{5})-Jev-/) || [])[1];
  const stamp = f => Date.parse(f.replace(/^.*-Jev-/, '').replace(/\.jsonl$/, '').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z'));
  const all = fs.readdirSync(dir).filter(f => f.includes(`-${port}-Jev-`) && f.endsWith('.jsonl')).sort((a, b) => stamp(a) - stamp(b));
  const within = all.filter(f => stamp(f) <= to);
  const i = within.findIndex(f => stamp(f) >= from);
  return within.slice(Math.max(0, (i < 0 ? within.length : i) - 1));
}
// The way in: the cells stood on in the Nether since the last crossing
// into it (the last frame in another dimension) before `t0`.
function wayInFrames(dir, life, t0) {
  const files = portFiles(dir, (life.files || [life.file])[0], t0 - 6 * 3600000, t0);
  const frames = framesOf(dir, files, t0 - 6 * 3600000, t0);
  let i = frames.length - 1;
  while (i >= 0 && !(frames[i].dim && frames[i].dim !== 'the_nether')) i--;
  return { frames: frames.slice(i + 1), crossedAt: i >= 0 ? frames[i + 1]?.at : null };
}

function walkOut(dir, life) {
  const files = life.files || [life.file];
  const frames = framesOf(dir, files, Date.parse(life.start), Date.parse(life.end) + 2000);
  let rods = 0;
  const startAt = frames.find(f => { if (typeof f.rods === 'number') rods = f.rods; return rods >= 4 && f.dim === 'the_nether' && (WALK_OUT.has(f.step) || f.decision?.id === 'portal_way'); });
  if (!startAt) return null;
  const t0 = startAt.at, after = frames.filter(f => f.at >= t0);
  const inn = wayInFrames(dir, life, t0), before = inn.frames;
  const wayIn = trailOf(before);
  const out = after.filter(f => f.pos && f.dim === 'the_nether' && f.hp !== 0);
  const outCells = trailOf(after);
  const onWayIn = outCells.filter(c => nearest(wayIn, { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }) <= 2).length;
  const choices = after.filter(f => f.decision && ['portal_way', 'leave_nether', 'stillness_detour', 'way_down', 'nether_gather', 'rung_progress', 'cross_level', 'crossing', 'cross_toward', 'body_way'].includes(f.decision.id)).map(f => `${f.decision.id}>${f.decision.choice}`);
  const steps = [...new Set(after.map(f => f.step).filter(Boolean))];
  const died = life.how === 'died';
  const lastPos = [...frames].reverse().find(f => f.pos && f.dim === 'the_nether')?.pos;
  const portal = startAt.portal || after.find(f => f.portal)?.portal || null;
  const res = { file: files.at(-1), start: new Date(t0).toISOString(), how: life.how, rods: startAt.rods ?? rods, cause: life.death?.cause || null,
    portal, portalOff: portal && startAt.pos ? Math.round(Math.hypot(portal.x - startAt.pos.x, portal.z - startAt.pos.z)) : null,
    enteredNether: inn.crossedAt ? new Date(inn.crossedAt).toISOString() : null, wayInFrom: before.find(f => f.pos)?.pos && cellOf(before.find(f => f.pos).pos),
    crossingsOnWayIn: before.filter((f, i, a) => f.step === 'cross_toward' && a[i - 1]?.step !== 'cross_toward').length,
    minutesOut: r1(((died ? Date.parse(life.end) : after.at(-1).at) - t0) / 60000), wayInCells: wayIn.length, outCells: outCells.length, outOnWayIn: onWayIn,
    steps, choices: tally(choices), healthAtStart: r1(startAt.hp),
    // Falls between frames on the ground: the body two and a half blocks or
    // more lower at the next frame on the ground than at the last.
    drops: dropsOf(out), hurts: tally(after.filter(f => f.kind === 'damage' && f.dim === 'the_nether').map(f => f.detail?.type)) };
  if (died && lastPos) {
    const deathAt = Date.parse(life.end), last = frames.filter(f => f.at >= deathAt - WINDOW_MS && f.at <= deathAt);
    const lastGround = [...last].reverse().find(f => f.pos && f.onGround && f.hp > 0)?.pos || lastPos;
    res.death = { at: life.end, where: cellOf(lastPos), from: cellOf(lastGround), drop: r1(lastGround.y - lastPos.y),
      kind: /lava/i.test(res.cause || '') ? 'lava' : /fell|ground too hard|high place/i.test(res.cause || '') ? 'fall' : /Blaze|burn|flames|fire/i.test(res.cause || '') ? 'blaze' : 'mob',
      wayInOff: r1(nearest(wayIn, lastGround)), stepAtDeath: [...last].reverse().find(f => f.step)?.step, survivalAtDeath: [...last].reverse().find(f => f.survival)?.survival,
      hurts: tally(last.filter(f => f.kind === 'damage').map(f => f.detail?.type + (f.detail?.cause ? `:${f.detail.cause}` : ''))),
      questions: last.filter(f => f.decision).map(f => `${r1((f.at - deathAt) / 1000)}s hp${r1(f.hp)} ${f.decision.id}>${f.decision.choice}`),
      heights: last.filter(f => f.pos && f.kind === 'observation').filter((f, i, a) => i % 5 === 0 || i === a.length - 1).map(f => `${r1((f.at - deathAt) / 1000)}s (${Math.round(f.pos.x)},${r1(f.pos.y)},${Math.round(f.pos.z)})`) };
  }
  return res;
}
function dropsOf(frames) {
  const out = { over2: 0, deepest: 0 };
  let last = null;
  for (const f of frames) {
    if (!f.pos) continue;
    if (f.onGround) { if (last != null && last - f.pos.y >= 2.5) { out.over2++; out.deepest = Math.max(out.deepest, r1(last - f.pos.y)); } last = f.pos.y; }
  }
  return out;
}
function tally(a) { const o = {}; for (const k of a) o[k] = (o[k] || 0) + 1; return o; }

// The new rule on the recorded walk: the way back by the cells stood on
// (walk-out.js backTrail), from where the walk out began, and whether the
// cell the death was fallen from lies on it (within 1.5 blocks).
function simulate(dir, life, res) {
  const { backTrail } = require('../src/walk-out');
  const frames = wayInFrames(dir, life, Date.parse(res.start)).frames;
  const trail = { cells: [] };
  const { noteCell, feetOf } = require('../src/walk-out');
  // The record has a position about a second apart; the plugin notes every
  // cell. Between two frames on the ground within six blocks, the cells on
  // the straight line are noted too.
  let prev = null;
  for (const f of frames) {
    if (!(f.pos && f.dim === 'the_nether' && f.onGround !== false && f.hp !== 0)) { prev = null; continue; }
    const c = feetOf(f.pos);
    if (prev) {
      const n = Math.max(Math.abs(c.x - prev.x), Math.abs(c.z - prev.z));
      if (n > 1 && n <= 6) for (let k = 1; k < n; k++) noteCell(trail, { x: Math.round(prev.x + (c.x - prev.x) * k / n), y: Math.round(prev.y + (c.y - prev.y) * k / n), z: Math.round(prev.z + (c.z - prev.z) * k / n) }, f.at);
    }
    noteCell(trail, c, f.at); prev = c;
  }
  const start = frames.at(-1)?.pos;
  const way = start ? backTrail(trail, cellOf(start), res.portal) : null;
  return { trailCells: trail.cells.length, backCells: way?.cells.length ?? 0, reachesPortal: !!way?.reaches, deathOnWay: res.death ? !!way?.cells.some(c => Math.hypot(c.x - res.death.from.x, c.y - res.death.from.y, c.z - res.death.from.z) <= 1.5) : null };
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  const from = Date.parse(args.from || '2026-09-29T23:00:00Z'), to = args.to ? Date.parse(args.to) : Infinity;
  const min = Number(args.min || 4);
  const lives = read(dir, from, to).filter(l => l.maxRods >= min);
  const rows = [];
  for (const l of lives) {
    const r = walkOut(dir, l);
    if (!r) continue;
    if (args.simulate) r.simulated = simulate(dir, l, r);
    rows.push(r);
  }
  if (args.json) fs.writeFileSync(args.json, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (args.detail) for (const r of rows) console.log(JSON.stringify(r, null, 1));
  const died = rows.filter(r => r.how === 'died');
  console.log(JSON.stringify({ lives: lives.length, walkedOut: rows.length, ends: tally(rows.map(r => r.how)), deaths: tally(died.map(r => r.death?.kind)),
    rodsLost: died.reduce((n, r) => n + (r.rods || 0), 0), medianMinutesOut: median(rows.map(r => r.minutesOut)),
    outCellsOnWayIn: `${rows.reduce((n, r) => n + r.outOnWayIn, 0)} of ${rows.reduce((n, r) => n + r.outCells, 0)}`,
    deathsOffWayIn: died.filter(r => r.death && r.death.wayInOff > 2).length,
    dropsOverTwo: rows.reduce((n, r) => n + r.drops.over2, 0), hurtsOnTheWay: tally(rows.flatMap(r => Object.entries(r.hurts).flatMap(([k, v]) => Array(v).fill(k)))),
    rows: rows.map(r => `${r.start.slice(5, 19)} ${r.file.replace(/^127_0_0_1-/, '').slice(0, 5)} ${r.rods} rods ${r.how}${r.cause ? ` (${r.cause})` : ''} portal ${r.portalOff} off, ${r.minutesOut} min out, ${r.outOnWayIn}/${r.outCells} cells on the way in${r.death ? `; died ${r.death.kind} ${r.death.wayInOff} from the way in, fell ${r.death.drop}` : ''}${r.simulated ? `; back by the way in: ${r.simulated.backCells} cells${r.simulated.reachesPortal ? ' to the portal' : ''}, death cell on it: ${r.simulated.deathOnWay}` : ''}`) }, null, 1));
}

module.exports = { framesOf, trailOf, walkOut, wayInFrames, WALK_OUT };
