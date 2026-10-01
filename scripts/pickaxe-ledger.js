#!/usr/bin/env node
'use strict';
// The pickaxe ledger (note 779): every pickaxe carried in the flight records,
// what wore it, when it left the pockets and why, the rungs that reopened on
// that, and the time spent with none.
//
//   node scripts/pickaxe-ledger.js [--since 2026-09-30T12:00:00Z] [--to ISO]
//        [--dir .bot-state/flight] [--cache file.jsonl] [--port 25581] [--json]
//
// Read from each record that carries the pockets (every decision, chat,
// survival, error and stall frame, and an observation every ten seconds): the
// pickaxes by name, and where the frame carries tools, each one's uses left.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const arg = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const SINCE = Date.parse(arg('--since', '2026-09-30T12:00:00Z'));
const TO = Date.parse(arg('--to', '2100-01-01T00:00:00Z'));
const DIR = arg('--dir', path.join(process.cwd(), '.bot-state', 'flight'));
const CACHE = arg('--cache', null);
const PORT = arg('--port', null);
const JSON_OUT = args.includes('--json');

const registry = require('minecraft-data')('26.1');
const stackOf = name => registry.itemsByName[name]?.stackSize || 64;
const TIERS = ['wooden', 'golden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];
const RANK = { wooden: 1, golden: 1, stone: 2, copper: 2, iron: 3, diamond: 4, netherite: 5 };
const tierOf = name => (/^(\w+)_pickaxe$/.exec(name) || [])[1];
const SOUND = 24; // crossing-kit.js SPARE_PICKAXE_DURABILITY
const BRIEF_MS = 120000;

function slotsUsed(inv) {
  let n = 0;
  for (const [name, count] of Object.entries(inv || {})) n += Math.ceil(count / stackOf(name));
  return n;
}

// One compact row a frame that carries the pockets.
function rowOf(o, port, file) {
  const s = o.snapshot || {};
  const t = Date.parse(o.at);
  if (!Number.isFinite(t)) return null;
  const hp = s.health;
  if (!s.inventory) return (o.kind === 'vitals' && hp !== undefined && hp <= 0) ? { t, port, file, k: 'dead', hp } : null;
  const picks = {};
  for (const [n, c] of Object.entries(s.inventory)) if (/_pickaxe$/.test(n)) picks[n] = c;
  // On the cursor or in the grid is carried (recorded from note 779 on).
  for (const n of [s.cursor, ...(s.grid || [])]) if (/_pickaxe$/.test(n || '')) picks[n] = (picks[n] || 0) + 1;
  const row = { t, port, file, k: o.kind, picks, slots: slotsUsed(s.inventory), kinds: Object.keys(s.inventory).length,
    inv: s.inventory, dim: /nether/.test(String(s.dimension || '')) ? 'nether' : /end/.test(String(s.dimension || '')) ? 'end' : 'overworld',
    y: s.position ? Math.round(s.position.y) : null, hp, act: (s.goal?.step || s.step)?.action || null };
  // Loose items within six blocks (full frames only): a pickaxe thrown from
  // the pockets lands beside the bot as a new one.
  if (s.entities && s.position) row.loose = s.entities.filter(e => e.name === 'item' && e.position && Math.hypot(e.position.x - s.position.x, e.position.y - s.position.y, e.position.z - s.position.z) <= 6).map(e => e.id);
  if (s.tools) row.tools = s.tools.filter(x => /_pickaxe$/.test(x.name)).map(x => [x.name, x.remaining]);
  if (o.kind === 'decision' && s.decision) row.dec = { id: s.decision.id, path: s.decision.path };
  if (o.kind === 'chat' && o.detail?.from === 'Jev' || (o.kind === 'chat' && /pickaxe/.test(o.detail?.message || ''))) row.say = String(o.detail?.message || '').slice(0, 160);
  if (s.goal?.gameProgress?.phase) row.phase = s.goal.gameProgress.phase;
  return row;
}

async function extract() {
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).map(f => {
    const m = /-(\d{5})-Jev-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(f);
    return m ? { f, port: m[1], start: Date.parse(`${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) } : null;
  }).filter(Boolean).filter(x => (!PORT || x.port === PORT) && x.start <= TO && fs.statSync(path.join(DIR, x.f)).mtimeMs >= SINCE)
    .sort((a, b) => a.start - b.start);
  const rows = [];
  for (const { f, port } of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"inventory"') && !line.includes('"kind":"vitals"')) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      const t = Date.parse(o.at);
      if (!(t >= SINCE && t <= TO)) continue;
      const r = rowOf(o, port, f);
      if (r) rows.push(r);
    }
  }
  return rows;
}

// Pickaxes as items: the tools list matched frame to frame by name, an item's
// uses never rising; one with no match before it was made (or picked up),
// one with no match after it left.
function matchTools(prev, next) {
  const out = { kept: [], made: [], gone: [] };
  const byName = list => list.reduce((m, [n, r]) => ((m[n] ||= []).push(r), m), {});
  const a = byName(prev), b = byName(next);
  for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const olds = (a[n] || []).slice().sort((x, y) => y - x), news = (b[n] || []).slice().sort((x, y) => y - x);
    const usedNew = new Set();
    for (const o of olds) {
      let j = -1;
      for (let i = 0; i < news.length; i++) if (!usedNew.has(i) && news[i] <= o && (j < 0 || news[i] > news[j])) j = i;
      if (j >= 0) { usedNew.add(j); out.kept.push({ name: n, from: o, to: news[j] }); } else out.gone.push({ name: n, uses: o });
    }
    news.forEach((r, i) => { if (!usedNew.has(i)) out.made.push({ name: n, uses: r }); });
  }
  return out;
}

const fmt = t => new Date(t).toISOString().slice(0, 19) + 'Z';
const count = picks => Object.values(picks || {}).reduce((a, b) => a + b, 0);

function analyse(rows) {
  const byTrial = {};
  for (const r of rows) (byTrial[`${r.port} ${r.file}`] ||= []).push(r);
  const out = { trials: 0, disappearances: [], wear: { best: 0, lower: 0, spare: 0, spareWhileMain: 0, byTier: {} }, spares: [], reopened: [], none: [], usesOverTime: {} };
  for (const [key, list] of Object.entries(byTrial)) {
    list.sort((x, y) => x.t - y.t);
    out.trials++;
    const port = list[0].port;
    // Uses by tier over time, a sample every ten minutes.
    let lastSample = 0;
    const series = out.usesOverTime[key] = [];
    let lastTools = null, lastToolsAt = 0;
    const spareItems = [], recentGone = []; // pickaxes made while another sound one was carried: { name, uses, at, by }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.tools) {
        if (r.t - lastSample >= 600000) {
          const byTier = {};
          for (const [n, u] of r.tools) byTier[tierOf(n)] = (byTier[tierOf(n)] || 0) + u;
          series.push({ at: fmt(r.t), byTier });
          lastSample = r.t;
        }
        if (lastTools && r.t - lastToolsAt < 180000) {
          const m = matchTools(lastTools, r.tools);
          const best = Math.max(0, ...lastTools.filter(([, u]) => u >= SOUND).map(([n]) => RANK[tierOf(n)] || 0));
          for (const k of m.kept) {
            const spent = k.from - k.to;
            if (spent <= 0) continue;
            const tier = tierOf(k.name);
            out.wear.byTier[tier] = (out.wear.byTier[tier] || 0) + spent;
            const lowerWhileBetter = (RANK[tier] || 0) < best;
            if (lowerWhileBetter) out.wear.lower += spent; else out.wear.best += spent;
            const sp = spareItems.find(s => s.name === k.name && Math.abs(s.uses - k.from) <= 0 && !s.done);
            if (sp) {
              out.wear.spare += spent;
              const others = lastTools.filter(([n, u]) => !(n === k.name && u === k.from) && u >= SOUND).length;
              if (others) out.wear.spareWhileMain += spent;
              sp.uses = k.to;
              if (k.to < SOUND && !sp.wornAt) { sp.wornAt = r.t; sp.wornBy = r.act; sp.wornWithMain = others > 0; }
            }
          }
          for (const g of m.gone) recentGone.push({ name: g.name, uses: g.uses, t: r.t });
          for (const g of m.gone) { const sp = spareItems.find(s => s.name === g.name && s.uses === g.uses && !s.done); if (sp) { sp.done = true; sp.goneAt = r.t; } }
          for (const mk of m.made) {
            const max = registry.itemsByName[mk.name]?.maxDurability;
            const others = lastTools.filter(([, u]) => u >= SOUND).length;
            // Back off the floor at the uses it left with is not a pickaxe made.
            const k = recentGone.findIndex(g => g.name === mk.name && g.uses === mk.uses && r.t - g.t <= 300000);
            if (k >= 0) { recentGone.splice(k, 1); continue; }
            if (max && mk.uses === max && others >= 1) {
              const sp = { port, name: mk.name, uses: mk.uses, at: r.t, by: r.dec ? r.dec.path?.join('/') : r.act, phase: r.phase, others: lastTools.map(([n, u]) => `${tierOf(n)}:${u}`).join(',') };
              spareItems.push(sp); out.spares.push(sp);
            }
          }
        }
        lastTools = r.tools; lastToolsAt = r.t;
      }
      // Disappearances by name, from the counts every frame carries.
      const prev = list[i - 1];
      if (!prev || r.k === 'dead' || prev.k === 'dead' || !r.picks || !prev.picks) continue;
      for (const [name, c] of Object.entries(prev.picks)) {
        const now = r.picks[name] || 0;
        if (now >= c) continue;
        // When it came back (the same name's count restored).
        let back = null;
        for (let j = i + 1; j < list.length && list[j].t - r.t <= BRIEF_MS; j++) {
          if (list[j].k === 'dead') break;
          if ((list[j].picks?.[name] || 0) >= c) { back = list[j]; break; }
        }
        // The uses the item had at the last frame with tools, and how long
        // before: a pickaxe dug with at about a block a second can wear out
        // in the frames between.
        let usesBefore = null, sampledAgoS = null;
        for (let j = i - 1; j >= 0 && r.t - list[j].t < 600000; j--) if (list[j].tools) { const u = list[j].tools.filter(([n]) => n === name).map(([, x]) => x); if (u.length) { usesBefore = Math.min(...u); sampledAgoS = (r.t - list[j].t) / 1000; } break; }
        const couldBreak = usesBefore !== null && usesBefore <= Math.max(12, sampledAgoS / 2);
        const died = list.slice(i, i + 3).some(x => x.k === 'dead' || (x.hp !== undefined && x.hp <= 0)) || (count(r.picks) === 0 && Object.keys(r.inv).length <= 3);
        const newKinds = Object.keys(r.inv).filter(n => !(n in prev.inv));
        const full = prev.slots >= 36;
        const otherGone = Object.keys(prev.inv).filter(n => !(n in r.inv) && !/_pickaxe$/.test(n));
        // Seen thrown: a loose item within six blocks in the first full frame
        // after (within 20 s) that the last one before (within 20 s) did not have.
        let thrown = null;
        { let before = null, after = null;
          for (let j = i - 1; j >= 0 && r.t - list[j].t <= 20000; j--) if (list[j].loose) { before = list[j]; break; }
          for (let j = i; j < list.length && list[j].t - r.t <= 20000; j++) if (list[j].loose) { after = list[j]; break; }
          if (before && after) thrown = after.loose.some(id => !before.loose.includes(id) && id > Math.max(0, ...before.loose)); }
        const dropDecision = list.slice(Math.max(0, i - 5), i + 1).find(x => x.dec && (x.dec.path || []).some(p => /drop|toss|leave/.test(p) && /pickaxe/.test(p)));
        let cause;
        if (died) cause = 'died';
        else if (dropDecision) cause = `dropped (${dropDecision.dec.id}: ${dropDecision.dec.path.join('/')})`;
        else if (couldBreak && !back) cause = 'broke';
        else if (full || (newKinds.length && prev.slots >= 35)) cause = 'tossed from full pockets';
        else if (/stash|deposit|chest/.test(r.act || '')) cause = `stored (${r.act})`;
        else cause = 'other';
        out.disappearances.push({ port, file: key.split(' ')[1], name, at: fmt(r.t), atMs: r.t, from: fmt(prev.t), back: back ? fmt(back.t) : null, gapS: back ? Math.round((back.t - prev.t) / 1000) : null,
          brief: !!back, cause, thrown, usesBefore, sampledAgoS, slots: prev.slots, newKinds, otherGone, act: r.act || prev.act, dim: r.dim, y: r.y, left: count(r.picks) });
      }
    }
    // Spares worn: what wore them (the step in hand when they fell under 24).
    // Rungs reopened: a pickaxe rung answered at win_strategy or a spare
    // chosen within a gap, or within two minutes after a lasting loss or a
    // spare worn under 24.
    const pickRung = r => r.dec && (r.dec.path || []).some(p => /rung_(stone|iron|nether)_pickaxe|spare_pickaxe|make_pickaxe|^pickaxe_first$/.test(p));
    for (const d of out.disappearances.filter(x => x.port === port && x.file === key.split(' ')[1])) {
      const until = d.brief ? Date.parse(d.back) : d.atMs + 120000;
      const asked = list.filter(r => r.t >= Date.parse(d.from) && r.t <= until && pickRung(r));
      if (asked.length) out.reopened.push({ port, at: d.at, name: d.name, brief: d.brief, cause: d.cause, rungs: asked.map(r => r.dec.path.join('/')) });
    }
    for (const sp of spareItems.filter(s => s.wornAt)) {
      const asked = list.filter(r => r.t >= sp.wornAt && r.t <= sp.wornAt + 120000 && pickRung(r));
      if (asked.length) out.reopened.push({ port, at: fmt(sp.wornAt), name: sp.name, brief: false, cause: 'spare worn under 24', rungs: asked.map(r => r.dec.path.join('/')) });
    }
    // Time with no pickaxe: spans of frames with none, the loss before it.
    let start = null, startRow = null;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r.picks || r.k === 'dead') { if (start !== null) { out.none.push(spanOf(start, list[i - 1], startRow, out, port)); start = null; } continue; }
      const none = count(r.picks) === 0;
      if (none && start === null) { start = r.t; startRow = r; }
      if (!none && start !== null) { out.none.push(spanOf(start, r, startRow, out, port)); start = null; }
    }
    if (start !== null) out.none.push(spanOf(start, list.at(-1), startRow, out, port));
  }
  return out;
}
function spanOf(start, end, row, out, port) {
  const loss = out.disappearances.filter(d => d.port === port && d.atMs <= start && d.left === 0).at(-1);
  const lossCause = loss && start - loss.atMs < 5000 ? loss.cause : 'carried none from the start of the record or after a death';
  return { port, at: fmt(start), minutes: Math.round((end.t - start) / 6000) / 10, dim: row.dim, y: row.y, underground: row.dim === 'overworld' && row.y !== null && row.y < 50, cause: lossCause, lastName: loss?.name, usesBefore: loss?.usesBefore };
}

function tally(list, key) { const m = {}; for (const x of list) { const k = typeof key === 'function' ? key(x) : x[key]; m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); }

(async () => {
  let rows;
  if (CACHE && fs.existsSync(CACHE)) rows = fs.readFileSync(CACHE, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => (!PORT || r.port === PORT) && r.t >= SINCE && r.t <= TO);
  else { rows = await extract(); if (CACHE) fs.writeFileSync(CACHE, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); }
  const out = analyse(rows);
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); return; }
  const d = out.disappearances;
  const brief = d.filter(x => x.brief), lasting = d.filter(x => !x.brief);
  console.log(`${out.trials} records, ${rows.length} frames with the pockets, ${fmt(SINCE)} to ${fmt(Math.min(TO, rows.reduce((m, r) => Math.max(m, r.t), 0)))}`);
  console.log(`\nWear (uses spent, matched item to item): ${JSON.stringify(out.wear.byTier)}`);
  console.log(`  by the best tier carried ${out.wear.best}; by a lower tier while a better sound one was carried ${out.wear.lower}`);
  console.log(`  by spares (made while another sound pickaxe was carried) ${out.wear.spare}, ${out.wear.spareWhileMain} of it with another sound one carried`);
  const sp = out.spares;
  console.log(`\nSpares made: ${sp.length} (${JSON.stringify(tally(sp, 'name'))}); worn under ${SOUND} while carried: ${sp.filter(s => s.wornAt).length}, ${sp.filter(s => s.wornWithMain).length} with another sound one carried`);
  const worn = sp.filter(s => s.wornAt);
  if (worn.length) console.log(`  minutes from made to worn: median ${median(worn.map(s => (s.wornAt - s.at) / 60000)).toFixed(1)}; by step: ${JSON.stringify(tally(worn, s => s.wornBy || 'none'))}`);
  console.log(`\nDisappearances: ${d.length}; brief (back within ${BRIEF_MS / 1000} s) ${brief.length}, lasting ${lasting.length}`);
  console.log(`  brief by cause: ${JSON.stringify(tally(brief, 'cause'))}; gap median ${median(brief.map(x => x.gapS))} s, by step ${JSON.stringify(tally(brief, 'act'))}`);
  console.log(`  lasting by cause: ${JSON.stringify(tally(lasting, 'cause'))}`);
  console.log(`  a new loose item beside the bot in the frames around it (seen thrown): brief ${brief.filter(x => x.thrown === true).length} of ${brief.filter(x => x.thrown !== null).length} with frames to tell, lasting not broken ${lasting.filter(x => x.cause !== 'broke' && x.cause !== 'died' && x.thrown === true).length} of ${lasting.filter(x => x.cause !== 'broke' && x.cause !== 'died' && x.thrown !== null).length}`);
  console.log(`  with the pockets full (36 slots) before: brief ${brief.filter(x => x.slots >= 36).length}, lasting ${lasting.filter(x => x.slots >= 36).length}`);
  console.log(`\nRungs asked in a gap or within 2 minutes of a loss: ${out.reopened.length} (${JSON.stringify(tally(out.reopened, 'cause'))})`);
  const none = out.none;
  const mins = l => Math.round(l.reduce((a, x) => a + x.minutes, 0));
  console.log(`\nWith no pickaxe: ${none.length} spans, ${mins(none)} minutes; underground in the Overworld ${none.filter(x => x.underground).length} spans ${mins(none.filter(x => x.underground))} min; Nether ${none.filter(x => x.dim === 'nether').length} spans ${mins(none.filter(x => x.dim === 'nether'))} min`);
  const byCause = {};
  for (const x of none) { const k = x.cause; (byCause[k] ||= { spans: 0, minutes: 0 }); byCause[k].spans++; byCause[k].minutes += x.minutes; }
  for (const [k, v] of Object.entries(byCause).sort((a, b) => b[1].minutes - a[1].minutes)) console.log(`  ${k}: ${v.spans} spans, ${Math.round(v.minutes)} min`);
  if (args.includes('--list')) { for (const x of d) console.log(JSON.stringify(x)); for (const x of sp) console.log('spare', JSON.stringify(x)); }
})();
function median(a) { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
