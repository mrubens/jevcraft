'use strict';
// The chest into the Nether (note 760): every Nether entry in the flight
// records (a frame in the Overworld, the next with a dimension in the
// Nether, on one connection), what it carried to keep rods in (a chest, the
// wood for one: planks, a log or stem is 4 planks, and a crafting table),
// and how the stay went for the rods (the most carried, the death with them).
// With the win_strategy askings that offered the crossing kit's chest rung
// (rung_nether_chest): its probability, what was chosen, and its words.
//   node scripts/rod-chest-kit.js [--from 2026-09-29T23:00:00Z] [--to ISO] [--dir <flight dir>] [--list] [--says]
const path = require('path');
const { eachFile } = require('./blaze-record');

const r2 = v => Math.round(v * 100) / 100;
const sum = (inv, re) => Object.entries(inv || {}).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
// What an inventory carries toward a chest: 'chest', 'wood' (a chest's 8
// planks with a table carried, or 12 without), 'planks8' (8 planks' worth,
// short of the table's 4) or 'none'.
function chestKit(inv) {
  if ((inv?.chest || 0) > 0) return 'chest';
  const planks = sum(inv, /_planks$/) + 4 * sum(inv, /_(log|stem|wood|hyphae)$/);
  const table = (inv?.crafting_table || 0) > 0;
  if (planks >= (table ? 8 : 12)) return 'wood';
  if (planks >= 8) return 'planks8';
  return 'none';
}
const rodsOf = inv => (inv?.blaze_rod || 0) + Math.floor((inv?.blaze_powder || 0) / 2);

function slim(f) {
  const s = f.snapshot || {}, d = s.decision;
  const keep = d?.id === 'win_strategy' && d.options?.rung_nether_chest;
  return { at: f.at, kind: f.kind, dim: s.dimension, hp: s.health, inv: s.inventory ? { chest: s.inventory.chest, crafting_table: s.inventory.crafting_table, blaze_rod: s.inventory.blaze_rod, blaze_powder: s.inventory.blaze_powder,
    ...Object.fromEntries(Object.entries(s.inventory).filter(([k]) => /_(planks|log|stem|wood|hyphae)$/.test(k))) } : undefined,
    ws: keep ? { choice: d.path?.at(-1), p: d.judgments?.[0]?.probabilities || {}, says: String(d.options.rung_nether_chest?.description ?? d.options.rung_nether_chest ?? ''), open: Object.keys(d.options) } : undefined };
}

// The entries of one connection's frames, each with the stay after it.
function entries(frames, file, { from = -Infinity, to = Infinity } = {}) {
  const out = [];
  let prevDim = null, cur = null, prevHp = null;
  for (const x of frames) {
    if (!(x.at >= from && x.at <= to)) continue;
    if (x.dim) {
      if (x.dim === 'the_nether' && prevDim === 'overworld') {
        cur = { file, at: new Date(x.at).toISOString(), kit: null, inv: null, maxRods: 0, died: false, diedWith: 0, left: false };
        out.push(cur);
      } else if (x.dim !== 'the_nether' && cur) { cur.left = true; cur.leftWith = cur.rods || 0; cur = null; }
      prevDim = x.dim;
    }
    if (cur && x.inv && x.dim === 'the_nether') {
      if (!cur.inv) { cur.inv = x.inv; cur.kit = chestKit(x.inv); }
      cur.rods = rodsOf(x.inv); cur.maxRods = Math.max(cur.maxRods, cur.rods);
    }
    if (typeof x.hp === 'number') {
      if (cur && x.hp === 0 && prevHp > 0) { cur.died = true; cur.diedWith = cur.rods || 0; cur = null; }
      prevHp = x.hp;
    }
  }
  return out.filter(e => e.kit);
}

function report(list, asks) {
  const by = k => list.filter(e => e.kit === k);
  const row = a => ({ entries: a.length, gained2Rods: a.filter(e => e.maxRods >= 2).length, diedWith2Rods: a.filter(e => e.died && e.diedWith >= 2).length });
  const chosen = {};
  for (const q of asks) chosen[q.choice] = (chosen[q.choice] || 0) + 1;
  const ps = asks.map(q => q.p.rung_nether_chest).filter(v => typeof v === 'number').sort((a, b) => a - b);
  return {
    entries: list.length,
    byKit: { chest: row(by('chest')), woodForChestAndTable: row(by('wood')), eightPlanksNoTable: row(by('planks8')), none: row(by('none')) },
    chestOrEightPlanks: list.filter(e => e.kit !== 'none').length,
    winStrategyWithChestRung: { asked: asks.length, chestRungChosen: chosen.rung_nether_chest || 0, chosen,
      chestRungProbability: ps.length ? { median: r2(ps[ps.length >> 1]), max: r2(ps.at(-1)), mean: r2(ps.reduce((n, v) => n + v, 0) / ps.length) } : null,
      openedWithNetherFirst: asks.filter(q => q.open.includes('nether_first')).length },
  };
}

function read(dir, from, to) {
  const list = [], asks = [];
  eachFile(dir, from, '"dimension":"the_nether"', (frames, f) => {
    list.push(...entries(frames, f, { from, to }));
    for (const x of frames) if (x.ws && x.at >= from && x.at <= to) asks.push({ at: x.at, file: f, ...x.ws });
  }, slim);
  return { list, asks };
}

// With --lives <rod-stage --json file>: each life that carried 2 or more
// rods, its chest kit at its start (the life's first frame), at its first
// rod and at its end, to see where the wood went.
function lifeKits(dir, lives) {
  const fs = require('fs');
  const out = [];
  for (const l of lives.filter(x => x.maxRods >= 2)) {
    const start = Date.parse(l.start), end = Date.parse(l.end);
    let first = null, atRod = null, last = null, dimAtStart = null;
    for (const f of l.files || [l.file]) {
      let text; try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"inventory"')) continue;
        let r; try { r = JSON.parse(line); } catch (_) { continue; }
        const t = Date.parse(r.at), inv = r.snapshot?.inventory;
        if (!(t >= start && t <= end) || !inv || r.snapshot?.health === 0) continue;
        if (!first) { first = inv; dimAtStart = r.snapshot.dimension; }
        if (!atRod && rodsOf(inv) > 0) atRod = inv;
        last = inv;
      }
    }
    if (!first) continue;
    out.push({ start: l.start, file: l.file, how: l.how, maxRods: l.maxRods, rodsAtEnd: l.rodsAtEnd, dimAtStart, atStart: chestKit(first), atRod: atRod ? chestKit(atRod) : null, atEnd: last ? chestKit(last) : null });
  }
  const tally = key => out.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
  const died = out.filter(x => x.how === 'died' && x.rodsAtEnd >= 2);
  return { lives: out.length, startedInOverworld: out.filter(x => x.dimAtStart === 'overworld').length, atStart: tally('atStart'), atFirstRod: tally('atRod'), atEnd: tally('atEnd'),
    diedWith2: { n: died.length, keepAtEnd: died.filter(x => x.atEnd !== 'none' && x.atEnd !== 'planks8').length, keepAtFirstRod: died.filter(x => x.atRod === 'chest' || x.atRod === 'wood').length }, list: out };
}

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
  const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
  if (args.lives) {
    const lives = require('fs').readFileSync(args.lives, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const r = lifeKits(dir, lives);
    if (args.list) for (const x of r.list) console.log(`${x.start.slice(5, 19)} ${x.file.replace(/^127_0_0_1-/, '').slice(0, 5)} ${x.dimAtStart} rods ${x.maxRods} ${x.how}: start ${x.atStart}, first rod ${x.atRod}, end ${x.atEnd}`);
    delete r.list;
    console.log(JSON.stringify(r, null, 1));
    return;
  }
  const from = Date.parse(args.from || '2026-09-29T23:00:00Z'), to = args.to ? Date.parse(args.to) : Infinity;
  const { list, asks } = read(dir, from, to);
  if (args.list) for (const e of list) console.log(`${e.at.slice(5, 19)} ${e.file.replace(/^127_0_0_1-/, '').slice(0, 5)} ${e.kit} rods max ${e.maxRods} ${e.died ? `died with ${e.diedWith}` : e.left ? `left with ${e.leftWith}` : 'record ended'}`);
  if (args.says) { const seen = new Set(); for (const q of asks) { const k = q.says.replace(/\d+/g, 'N'); if (!seen.has(k)) { seen.add(k); console.log(`${new Date(q.at).toISOString()} p ${q.p.rung_nether_chest} -> ${q.choice}: ${q.says}`); } } }
  console.log(JSON.stringify(report(list, asks), null, 1));
}

module.exports = { chestKit, entries, report, slim };
