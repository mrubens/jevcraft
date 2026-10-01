'use strict';
// Every stay at a live blaze spawner (note 774), from the flight records;
// read-only.
//   node scripts/cage-stays.js [--since 2026-09-30T06:00Z] [--until ...] [--port 25584] [--list] [--json]
//
// A stay: the frames in the Nether within 16 blocks of a known cage (the
// cage read from the at_spawner step's target, or "spawner at (x, y, z)" /
// "cage at (x, y, z)" in a question's words), a gap of five minutes away
// ending it (cage-yield.js AWAY_MS), or a death, or another dimension.
// For each: its minutes; the blazes killed (the bot's own count at the cage,
// "At this cage N minutes so far: K blazes killed", cage-yield.js, the most
// said in the stay); the rods gained (blaze rods carried, powder counted as
// half a rod); the health lost (every fall of health between frames); a death.
// Each box, slit or stand answer (PLAN below) chosen in it, with how long it
// held: to the first of a threat thrown at the step ("Threat nearby",
// "Preempted by ...": preempted), another answer to a question that holds
// the bot at the cage (encounter_stance, empty_spawner, hunt_target, the
// stall's): undone, or the stay's end; the same answer chosen again is the
// same hold. And the box and the slit undoing each other: open_slit chosen to
// dig a block the bot laid ("laid by the bot"), and a box or cover chosen to
// place blocks after a slit in the same stay.
// With --replay, the rules of note 774 read over the same answers: a preempt
// at a held box or slit kept off unless a blaze was inside the box (its middle
// within 0.9 of the bot across) or a hit landed in the 4 seconds before; a slit that
// digs the bot's own block of a held box not offered; cover placed into a held
// window refused; and the fights offered with the bot walled in by its own
// blocks (the question's walledIn), and how many of them got the bot no block
// from where it was chosen in 20 seconds.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('since', '2026-09-30T06:00:00Z'));
const until = Date.parse(arg('until', new Date().toISOString()));
const port = arg('port');

const RANGE = 16, AWAY_MS = 5 * 60000, HOLD_RULE_MS = 3 * 60000;
const PLAN = new Set(['box_here', 'box_in_line', 'box_at_spawner', 'dig_in_at_spawner', 'open_slit', 'stay_and_fight', 'stand_by_spawner']);
const BOX = new Set(['box_here', 'box_in_line', 'box_at_spawner']);
const HOLDERS = new Set(['encounter_stance', 'empty_spawner', 'hunt_target', 'stillness_detour', 'rung_progress']);
const PREEMPT = /^(Threat nearby|Preempted by)/;
const CAGE_RE = /(?:spawner|cage) at \((-?\d+), (-?\d+), (-?\d+)\)/g;
const KILLS_RE = /At this cage (\d+) minutes? so far: (\d+) blazes? killed/;
const r1 = v => Math.round(v * 10) / 10;
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const text = v => String(typeof v === 'string' ? v : v?.description ?? '');
const rodsOf = inv => inv ? (inv.blaze_rod || 0) + Math.floor((inv.blaze_powder || 0) / 2) : null;

function slim(r) {
  const s = r.snapshot || {}, d = s.decision, at = Date.parse(r.at);
  const step = s.step || s.goal?.step;
  const f = { at, kind: r.kind, label: r.label, dim: s.dimension, health: Number.isFinite(s.health) ? s.health : null,
    pos: s.position ? { x: s.position.x, y: s.position.y, z: s.position.z } : null, rods: rodsOf(s.inventory), cages: [] };
  if (step?.action === 'at_spawner' && step.target) f.cages.push(step.target);
  if (r.kind === 'damage') f.hurt = true;
  if (d) {
    const leaf = d.path?.at(-1);
    const chosen = text(d.options?.[leaf]);
    f.decision = { id: d.id, leaf, chosen: chosen.slice(0, 900), walledIn: !!d.state?.walledIn };
    const all = Object.values(d.options || {}).map(text).join(' ') + ' ' + JSON.stringify(d.state || {});
    for (const m of all.matchAll(CAGE_RE)) f.cages.push({ x: +m[1], y: +m[2], z: +m[3] });
    const k = KILLS_RE.exec(all); if (k) f.killsSaid = +k[2];
    if (d.id === 'empty_spawner' && typeof d.state?.spawner === 'string') { const m = /at \((-?\d+), (-?\d+), (-?\d+)\)/.exec(d.state.spawner); if (m) f.cages.push({ x: +m[1], y: +m[2], z: +m[3] }); }
  }
  if (s.mobs && s.position) f.blazeIn = s.mobs.some(m => m.name === 'blaze' && m.at && Math.hypot(m.at.x - s.position.x, m.at.z - s.position.z) <= 0.9 && Math.abs(m.at.y - s.position.y) < 2);
  return f;
}

async function readFile(file) {
  const frames = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const at = Date.parse(r.at);
    if (!(at >= since && at <= until)) continue;
    frames.push(slim(r));
  }
  frames.sort((a, b) => a.at - b.at);
  return frames;
}

const key = c => `${c.x},${c.y},${c.z}`;
const off = (p, c) => Math.hypot(p.x - c.x - 0.5, p.y - c.y - 0.5, p.z - c.z - 0.5);

function stays(frames, file) {
  const cages = new Map();
  for (const f of frames) for (const c of f.cages) cages.set(key(c), c);
  if (!cages.size) return [];
  const list = [...cages.values()];
  const out = [];
  let cur = null, lastHealth = null;
  const close = () => { if (cur) out.push(cur); cur = null; };
  for (const f of frames) {
    const nether = /nether/.test(String(f.dim || ''));
    if (f.dim && !nether) { close(); lastHealth = f.health ?? lastHealth; continue; }
    let cage = null, d = Infinity;
    if (f.pos && nether) for (const c of list) { const o = off(f.pos, c); if (o < d) { d = o; cage = c; } }
    const inside = cage && d <= RANGE;
    if (cur && (f.at - cur.last > AWAY_MS || (inside && key(cage) !== cur.cage))) close();
    if (inside && !cur) cur = { file, cage: key(cage), start: f.at, last: f.at, frames: [], rods0: null, rodsMax: null, lost: 0, died: false, kills: 0 };
    if (cur) {
      if (inside) cur.last = f.at;
      if (f.rods != null) { if (cur.rods0 == null) cur.rods0 = f.rods; cur.rodsMax = Math.max(cur.rodsMax ?? f.rods, f.rods); }
      if (f.health != null) {
        if (lastHealth != null && f.health < lastHealth) cur.lost += lastHealth - f.health;
        if (f.health <= 0 && (lastHealth ?? 1) > 0) { cur.died = true; cur.frames.push(f); cur.last = f.at; close(); lastHealth = 0; continue; }
      }
      if (f.killsSaid != null) cur.kills = Math.max(cur.kills, f.killsSaid);
      cur.frames.push(f);
    }
    if (f.health != null) lastHealth = f.health;
  }
  close();
  return out.filter(s => s.last - s.start >= 60000).map(s => measure(s));
}

// The plan answers of a stay and how each ended.
function measure(s) {
  const fr = s.frames.filter(f => f.at <= s.last);
  const holds = [];
  let slitAt = null, slitOwn = 0, boxAfterSlit = 0, walledFights = 0, walledFightsFailed = 0;
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i], d = f.decision;
    if (!d) continue;
    if (d.leaf === 'open_slit') { slitAt = f.at; if (/laid by the bot/.test(d.chosen)) slitOwn++; }
    if (slitAt && (BOX.has(d.leaf) && /wall it in|to place of/.test(d.chosen) || d.leaf === 'take_cover' && /^(.*?)Put \d+ blocks?/.test(d.chosen))) { boxAfterSlit++; slitAt = null; }
    // A fight offered and chosen with the bot walled in by its own blocks.
    if (d.walledIn && (/^hunt_\d+$/.test(d.leaf) || ['close_in', 'charge_nearest'].includes(d.leaf)) && f.pos) {
      walledFights++;
      const moved = fr.slice(i + 1).some(g => g.at - f.at <= 20000 && g.pos && Math.hypot(g.pos.x - f.pos.x, g.pos.z - f.pos.z) >= 1);
      if (!moved) walledFightsFailed++;
    }
    if (!PLAN.has(d.leaf)) continue;
    // The same answer chosen again carries the hold on.
    const prev = holds.at(-1);
    if (prev && prev.leaf === d.leaf && prev.open) continue;
    if (prev?.open) prev.open = false;
    const h = { leaf: d.leaf, at: f.at, end: s.last, why: 'stay ended', open: true, preempts: [] };
    for (let j = i + 1; j < fr.length; j++) {
      const g = fr[j];
      if (g.kind === 'error' && PREEMPT.test(g.label || '')) {
        // Would note 774 have kept it off: a blaze inside the box (its middle
        // within 0.9 across) or a hit landed in the 4 seconds before.
        const hit = fr.slice(Math.max(0, j - 40), j).some(x => x.hurt && g.at - x.at <= 4000);
        const inside = fr.slice(Math.max(0, j - 5), j + 1).some(x => x.blazeIn);
        h.preempts.push({ at: g.at, kept: hit || inside });
        if (h.end === s.last) { h.end = g.at; h.why = 'preempted'; }
        continue;
      }
      const e = g.decision;
      if (e && HOLDERS.has(e.id) && e.leaf !== d.leaf) { if (h.end === s.last || g.at < h.end) { if (h.why !== 'preempted') { h.end = g.at; h.why = 'undone'; } } h.undoneAt = h.undoneAt ?? g.at; break; }
    }
    // Under the rule: the hold ends at the first preempt the rule keeps (a
    // blaze inside, a hit through), six health gone since it began, its own
    // time (HOLD_RULE_MS) or the stay's end; the questions asked of the
    // turn's claims meanwhile (encounter_stance, hunt_target) are not asked
    // at a held box, and the cage's own (empty_spawner, the stall's) carry it
    // on, so an undoing counts only after a preempt the rule keeps.
    const firstKept = h.preempts.find(p => p.kept);
    const h0 = fr.find(g => g.at >= f.at && g.health != null)?.health ?? 20;
    const hurt6 = fr.find(g => g.at > f.at && g.health != null && h0 - g.health >= 6);
    h.ruleEnd = Math.min(firstKept ? firstKept.at : Infinity, hurt6 ? hurt6.at : Infinity, f.at + HOLD_RULE_MS, s.last);
    h.ruleWhy = firstKept && h.ruleEnd === firstKept.at ? 'a blaze inside or a hit' : hurt6 && h.ruleEnd === hurt6.at ? 'six health gone' : h.ruleEnd === f.at + HOLD_RULE_MS ? 'its time' : 'stay ended';
    holds.push(h);
  }
  const rodsGained = s.rodsMax != null && s.rods0 != null ? Math.max(0, s.rodsMax - s.rods0) : 0;
  return { file: s.file, cage: s.cage, start: s.start, end: s.last, minutes: r1((s.last - s.start) / 60000), kills: s.kills, rods: rodsGained, lost: r1(s.lost), died: s.died,
    holds: holds.map(h => ({ leaf: h.leaf, at: h.at, seconds: r1((h.end - h.at) / 1000), why: h.why, preempts: h.preempts.length, ruleSeconds: r1((h.ruleEnd - h.at) / 1000), keptOff: h.preempts.filter(p => !p.kept && p.at < h.ruleEnd).length, ruleWhy: h.ruleWhy })),
    slitOwn, boxAfterSlit, undo: slitOwn + boxAfterSlit, walledFights, walledFightsFailed };
}

async function main() {
  const dir = path.join(ROOT, '.bot-state', 'flight');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && (!port || f.includes(`-${port}-`))).filter(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs >= since; } catch (_) { return false; } });
  const all = [];
  for (const f of files) all.push(...stays(await readFile(path.join(dir, f)), f));
  all.sort((a, b) => a.start - b.start);
  if (argv.includes('--json')) { console.log(JSON.stringify(all, null, 1)); return; }
  const sum = (k, l = all) => l.reduce((n, s) => n + (s[k] || 0), 0);
  const holds = all.flatMap(s => s.holds);
  console.log(`Spawner stays since ${new Date(since).toISOString()}: ${all.length} in ${files.length} records, ${r1(sum('minutes'))} minutes; ${sum('kills')} blazes killed (the bot's own count at the cage), ${sum('rods')} rods gained, ${r1(sum('lost'))} health lost, ${all.filter(s => s.died).length} deaths.`);
  const dry = all.filter(s => s.minutes >= 5 && !s.kills && !s.rods);
  console.log(`Stays of 5 minutes or more with no kill and no rod: ${dry.length} (${r1(sum('minutes', dry))} minutes, ${r1(sum('lost', dry))} health lost, ${dry.filter(s => s.died).length} deaths).`);
  const byLeaf = {};
  for (const h of holds) (byLeaf[h.leaf] ||= []).push(h);
  console.log('\nBox, slit and stand answers, how long each held (same answer chosen again counted as one hold):');
  for (const [leaf, l] of Object.entries(byLeaf).sort((a, b) => b[1].length - a[1].length)) {
    const why = {}; for (const h of l) why[h.why] = (why[h.why] || 0) + 1;
    console.log(`  ${leaf}: ${l.length} holds, median ${median(l.map(h => h.seconds))} s, ${l.filter(h => h.seconds >= 60).length} held a minute or more; ended ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  const why = {}; for (const h of holds) why[h.why] = (why[h.why] || 0) + 1;
  console.log(`  all: ${holds.length} holds, median ${median(holds.map(h => h.seconds))} s, ${holds.filter(h => h.seconds >= 60).length} a minute or more; ended ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')}; preempts thrown during holds ${holds.reduce((n, h) => n + h.preempts, 0)}.`);
  console.log(`\nBox and slit undoing each other: ${sum('undo')} (a slit dug through the bot's own block ${sum('slitOwn')}, a box or cover laid after a slit ${sum('boxAfterSlit')}), in ${all.filter(s => s.undo).length} stays.`);
  console.log(`Attacks on a blaze (hunt_<id>, close_in, charge_nearest) chosen with the bot walled in by its own blocks: ${sum('walledFights')}, ${sum('walledFightsFailed')} of them not a block from where chosen 20 s later.`);
  if (argv.includes('--replay')) {
    const kept = holds.reduce((n, h) => n + h.keptOff, 0);
    console.log(`\nReplayed under note 774's preempt rule (a blaze inside the box (its middle within 0.9 across) or a hit in the 4 s before ends a held box or slit; others kept off): ${kept} of ${holds.reduce((n, h) => n + h.preempts, 0)} preempts kept off; holds median ${median(holds.map(h => h.seconds))} s -> ${median(holds.map(h => h.ruleSeconds))} s, a minute or more ${holds.filter(h => h.seconds >= 60).length} -> ${holds.filter(h => h.ruleSeconds >= 60).length} of ${holds.length}; ended ${Object.entries(holds.reduce((m, h) => (m[h.ruleWhy] = (m[h.ruleWhy] || 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  }
  if (argv.includes('--list')) {
    console.log('\nStays:');
    for (const s of all) console.log(`  ${new Date(s.start).toISOString().slice(5, 19)}Z ${s.file.replace(/^127_0_0_1-|-Jev.*$/g, '')} cage ${s.cage}: ${s.minutes} min, ${s.kills} killed, ${s.rods} rods, ${s.lost} lost${s.died ? ', died' : ''}; holds ${s.holds.map(h => `${h.leaf} ${h.seconds}s ${h.why}`).join('; ') || 'none'}${s.undo ? `; undo ${s.undo}` : ''}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
