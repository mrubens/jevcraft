#!/usr/bin/env node
'use strict';
// Everything about ender pearls the flight records hold (trial note 788):
// pearls carried over time, where the pearl rung was reached in a run and
// what it did there, endermen within reach by dimension and by the rung in
// hand, the fights with them and the deaths, the gold carried in the Nether
// and the piglins in view while it was, barters, warped forests found, and
// the minutes per pearl by source. Jev-down time is off the clock (note
// 781): a frame with Jev-down evidence adds nothing to any minute count.
//
//   node scripts/pearl-record.js [--since ISO] [--to ISO] [--json]
// JEV_ROOT reads another checkout's records (from a worktree).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { evidenceOf } = require('./lib/jev-down');

const CAP_MS = 30000;
const GOLD_ARMOUR = /^golden_(helmet|chestplate|leggings|boots)$/;
const PEARL_ACTIONS = /^(barter|bastion_gold|warped_pearls|warped_search|pearl_patrol|return_overworld|trade)$/;
const fileStart = name => { const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN; };
const dimOf = d => /nether/.test(d || '') ? 'nether' : /end/.test(d || '') ? 'end' : 'overworld';
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };

// Gold an ingot's worth carried, and what a barter could throw (a gold piece
// worn or carried, else four ingots kept for boots; bartering.js barterGold).
function goldOf(inv, eq) {
  const ingots = inv.gold_ingot || 0, nuggets = inv.gold_nugget || 0, raw = inv.raw_gold || 0, blocks = inv.gold_block || 0;
  const piece = Object.values(eq || {}).some(n => GOLD_ARMOUR.test(n || '')) || Object.keys(inv).some(n => GOLD_ARMOUR.test(n));
  const ingotEq = ingots + Math.floor(nuggets / 9) + blocks * 9;
  return { all: ingotEq + raw, throwable: Math.max(0, ingotEq - (piece ? 0 : 4)) };
}

async function readFile(file) {
  const r = { file: path.basename(file), ms: 0, downMs: 0, dimMs: {}, phaseMs: {}, pearlActionMs: {}, maxPearls: 0, maxRods: 0, pearlGains: [],
    endermanMs: {}, endermanNearRung: {}, endermanIds: {}, endermanClose: 0, endermanFightFrames: 0, endermanStance: {}, endermanHurt: 0,
    piglinMs: 0, piglinGoldMs: 0, netherGoldMax: 0, netherThrowableMax: 0, netherGoldMs: 0, netherMsBothShort: 0,
    warpedFound: 0, deaths: [], firstPearlStep: null, rodsAtFirstPearlStep: null, firstSevenRods: null, firstNether: null, startT: null, endT: null,
    barterFrames: 0, pearlDecisions: {}, replay: { minutes: 0, routeMin: { enderman: 0, forest: 0, barter: 0 }, anyMin: 0, asks: 0, asksBy: {} }, endermanHuntFrames: 0, endermanHuntMs: 0, milestonesAtPearl: null };
  let prev = null, lastHealth = null, lastEnderNear = -Infinity, lastStep = null, lastPearls = 0, rung = null;
  // The order question replayed (src/pearl-order.js): in the Nether, short
  // of both, on a rung other than the pearls, the routes real from here (an
  // enderman within 24, a warped forest found in this record within 512, a
  // piglin within 32 with gold to throw) and when it would be asked: no
  // answer held, the hold's half hour run out, a kind of route real now that
  // was not offered at the answer, or a death since.
  const forests = []; let hold = null, deathsSeen = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const settle = (f, t) => {
    if (!prev) return;
    const dt = Math.min(CAP_MS, Math.max(0, t - prev.t));
    if (prev.down) { r.downMs += dt; return; }
    r.ms += dt;
    add(r.dimMs, prev.dim, dt);
    if (prev.phase) add(r.phaseMs, prev.phase, dt);
    if (prev.pearlAction) add(r.pearlActionMs, prev.pearlAction, dt);
    if (prev.enderHunt) r.endermanHuntMs += dt;
    if (prev.routes) { r.replay.minutes += dt; let any = false; for (const k of Object.keys(prev.routes)) if (prev.routes[k]) { r.replay.routeMin[k] += dt; any = true; } if (any) r.replay.anyMin += dt; }
    for (const [k, v] of Object.entries(prev.ender || {})) if (v && k !== 'near24') { add(r.endermanMs, k, dt); if (k.endsWith('16')) add(r.endermanNearRung, `${prev.dim}:${prev.phase || 'none'}`, dt); }
    if (prev.dim === 'nether') {
      if (prev.piglin) r.piglinMs += dt;
      if (prev.piglin && prev.throwable > 0) r.piglinGoldMs += dt;
      if (prev.throwable > 0) r.netherGoldMs += dt;
      if (prev.rods < 7 && prev.pearls < 13) r.netherMsBothShort += dt;
    }
  };
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(o.at); if (!Number.isFinite(t)) continue;
    const s = o.snapshot || {};
    r.startT ??= t; r.endT = t;
    const down = !!evidenceOf(o);
    const inv = s.inventory || null;
    const step = s.goal?.step || s.step || lastStep;
    if (s.goal?.step || s.step) lastStep = s.goal?.step || s.step;
    const dim = dimOf(s.dimension || prev?.dim);
    if (dim === 'nether' && r.firstNether == null) r.firstNether = t;
    const pearls = inv ? (inv.ender_pearl || 0) + (inv.ender_eye || 0) : (prev?.pearls || 0);
    const rods = inv ? (inv.blaze_rod || 0) + Math.floor(((inv.blaze_powder || 0) + (inv.ender_eye || 0)) / 2) : (prev?.rods || 0);
    if (inv && pearls > lastPearls) r.pearlGains.push({ t, n: pearls - lastPearls, dim, step: step?.action, phase: step?.phase });
    if (inv) lastPearls = pearls;
    r.maxPearls = Math.max(r.maxPearls, pearls); r.maxRods = Math.max(r.maxRods, rods);
    if (rods >= 7 && r.firstSevenRods == null) r.firstSevenRods = t;
    // The rung in hand: the ladder's phase, written about once a minute.
    if (s.goal?.gameProgress?.phase) rung = s.goal.gameProgress.phase;
    const phase = rung || step?.phase || null;
    const pearlAction = rung === 'obtain_ender_pearls' ? (step?.action || 'between') : null;
    if (step?.entity === 'enderman') r.endermanHuntFrames++;
    if (pearlAction && r.firstPearlStep == null) { r.firstPearlStep = t; r.rodsAtFirstPearlStep = rods; r.milestonesAtPearl = Object.keys(s.goal?.gameProgress?.milestones || {}); }
    if (step?.action === 'barter') r.barterFrames++;
    // Endermen in reach, by the distance of the nearest.
    let ender = null, piglin = false;
    const pos = s.position;
    if (Array.isArray(s.entities) && pos) {
      let near = Infinity;
      for (const e of s.entities) {
        if (!e?.position) continue;
        const d = Math.hypot(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
        if (e.name === 'enderman') { near = Math.min(near, d); if (d <= 16) { r.endermanIds[`${dim}:${e.id}`] = 1; } }
        if (e.name === 'piglin' && d <= 32) piglin = true;
      }
      ender = { [`${dim}16`]: near <= 16, [`${dim}32`]: near <= 32, near24: near <= 24 };
      if (near <= 8) { lastEnderNear = t; r.endermanClose++; }
    } else if (prev) { ender = prev.ender; piglin = prev.piglin; }
    const sa = s.goal?.survivalAction;
    if (sa?.target === 'enderman' && sa.at && Math.abs(Date.parse(sa.at) - t) < 2000) r.endermanFightFrames++;
    if (o.kind === 'damage' && /by enderman/.test(o.label || '')) r.endermanHurt++;
    if (o.kind === 'decision' && s.decision) {
      const d = s.decision, choice = d.path?.at?.(-1) || o.label;
      if (d.id === 'encounter_stance' && /enderman/.test(JSON.stringify(d.state?.threats || d.state?.estimate || ''))) add(r.endermanStance, choice, 1);
      if (pearlAction || /^pearls_/.test(choice || '') || Object.keys(d.options || {}).some(k => /^pearls_/.test(k))) add(r.pearlDecisions, `${d.id}:${choice}`, 1);
    }
    if (o.kind === 'survival' && o.label === 'landmark found' && /warped/.test(line)) r.warpedFound++;
    if (o.kind === 'chat') { const fm = String(o.detail?.message || '').match(/^A warped forest at (-?\d+), (-?\d+)/); if (fm) forests.push({ x: +fm[1], z: +fm[2] }); }
    let gold = prev?.gold || { all: 0, throwable: 0 };
    if (inv) gold = goldOf(inv, s.equipment);
    if (dim === 'nether') { r.netherGoldMax = Math.max(r.netherGoldMax, gold.all); r.netherThrowableMax = Math.max(r.netherThrowableMax, gold.throwable); }
    const health = typeof s.health === 'number' ? s.health : null;
    if (health === 0 && lastHealth > 0) r.deaths.push({ t, dim, phase, enderman: t - lastEnderNear <= 15000 });
    if (health != null) lastHealth = health;
    let routes = null;
    if (!down && dim === 'nether' && rods < 7 && pearls < 13 && rung !== 'obtain_ender_pearls' && pos) {
      routes = { enderman: !!ender?.near24, forest: forests.some(f => Math.hypot(f.x - pos.x, f.z - pos.z) <= 512), barter: piglin && gold.throwable > 0 };
      const kinds = Object.keys(routes).filter(k => routes[k]);
      if (kinds.length) {
        const fresh = !hold || t - hold.at > 30 * 60000 || kinds.some(k => !hold.offered.has(k)) || r.deaths.length > deathsSeen;
        if (fresh) { r.replay.asks++; for (const k of kinds) add(r.replay.asksBy, k, 1); hold = { at: t, offered: new Set(kinds) }; deathsSeen = r.deaths.length; }
      }
    }
    settle(o, t);
    prev = { routes, t, down, dim, phase, pearlAction, enderHunt: step?.entity === 'enderman', ender, piglin, throwable: gold.throwable, gold, rods, pearls };
  }
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const since = Date.parse(opt('--since', '2000-01-01T00:00:00Z')), to = opt('--to') ? Date.parse(opt('--to')) : Infinity;
  const dir = path.join(ROOT, '.bot-state', 'flight');
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl') && n.startsWith('127_0_0_1-')).filter(n => !/-25565-/.test(n))
    .filter(n => fileStart(n) <= to).filter(n => { try { return fs.statSync(path.join(dir, n)).mtimeMs >= since; } catch (_) { return false; } })
    .map(n => path.join(dir, n));
  const queue = files.slice().sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  const results = [];
  const workers = Math.min(Number(opt('--workers', 8)), queue.length);
  await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { worker: true } });
    const next = () => { const f = queue.shift(); if (f) w.postMessage(f); else { w.terminate(); resolve(); } };
    w.on('message', m => { results.push(m); next(); });
    w.on('error', reject);
    next();
  })));
  const out = summarize(results);
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
  print(out);
}

function summarize(results) {
  const T = { files: results.length, botHours: 0, downHours: 0, dimMin: {}, phaseMin: {}, pearlActionMin: {}, endermanMin: {}, endermanNearRungMin: {}, endermenDistinct: {},
    endermanFightFrames: 0, endermanHurt: 0, endermanStance: {}, piglinMin: 0, piglinGoldMin: 0, netherGoldMin: 0, netherMinBothShort: 0,
    filesNether: 0, filesNetherGold: 0, filesNetherThrowable: 0, netherGoldMaxDist: {}, warpedFound: 0, filesWarped: 0,
    deaths: 0, deathsByDim: {}, deathsEnderman: 0, deathsInPearlPhase: 0, pearlGains: [], maxPearls: 0, filesWithPearls: 0,
    replay: { minutes: 0, anyMin: 0, routeMin: {}, asks: 0, asksBy: {}, files: 0 }, filesSevenRods: 0, maxRodsDist: {}, endermanHuntMin: 0, endermanHuntFrames: 0, filesPearlStep: 0, pearlStepRods: [], pearlStepBeforeSeven: 0, pearlDecisions: {}, barterFrames: 0, pearlFiles: [] };
  const m = ms => ms / 60000;
  for (const r of results) {
    T.botHours += r.ms / 3600000; T.downHours += r.downMs / 3600000;
    for (const [k, v] of Object.entries(r.dimMs)) add(T.dimMin, k, m(v));
    for (const [k, v] of Object.entries(r.phaseMs)) add(T.phaseMin, k, m(v));
    for (const [k, v] of Object.entries(r.pearlActionMs)) add(T.pearlActionMin, k, m(v));
    for (const [k, v] of Object.entries(r.endermanMs)) add(T.endermanMin, k, m(v));
    for (const [k, v] of Object.entries(r.endermanNearRung)) add(T.endermanNearRungMin, k, m(v));
    for (const k of Object.keys(r.endermanIds)) add(T.endermenDistinct, k.split(':')[0], 1);
    for (const [k, v] of Object.entries(r.endermanStance)) add(T.endermanStance, k, v);
    for (const [k, v] of Object.entries(r.pearlDecisions)) add(T.pearlDecisions, k, v);
    T.endermanFightFrames += r.endermanFightFrames; T.endermanHurt += r.endermanHurt;
    T.piglinMin += m(r.piglinMs); T.piglinGoldMin += m(r.piglinGoldMs); T.netherGoldMin += m(r.netherGoldMs); T.netherMinBothShort += m(r.netherMsBothShort);
    if (r.dimMs.nether) {
      T.filesNether++;
      if (r.netherGoldMax > 0) T.filesNetherGold++;
      if (r.netherThrowableMax > 0) T.filesNetherThrowable++;
      const b = r.netherGoldMax === 0 ? '0' : r.netherGoldMax < 5 ? '1-4' : r.netherGoldMax < 10 ? '5-9' : r.netherGoldMax < 20 ? '10-19' : '20+';
      add(T.netherGoldMaxDist, b, 1);
    }
    T.warpedFound += r.warpedFound; if (r.warpedFound) T.filesWarped++;
    for (const d of r.deaths) { T.deaths++; add(T.deathsByDim, d.dim, 1); if (d.enderman) T.deathsEnderman++; if (d.phase === 'obtain_ender_pearls') T.deathsInPearlPhase++; }
    T.pearlGains.push(...r.pearlGains.map(g => ({ file: r.file, ...g, at: new Date(g.t).toISOString() })));
    T.maxPearls = Math.max(T.maxPearls, r.maxPearls); if (r.maxPearls) T.filesWithPearls++;
    if (r.firstSevenRods != null) T.filesSevenRods++;
    if (r.dimMs?.nether) add(T.maxRodsDist, String(r.maxRods || 0), 1);
    T.endermanHuntMin += m(r.endermanHuntMs || 0); T.endermanHuntFrames += r.endermanHuntFrames || 0;
    if (r.firstPearlStep != null) {
      T.filesPearlStep++; T.pearlStepRods.push(r.rodsAtFirstPearlStep);
      if (r.firstSevenRods == null || r.firstPearlStep < r.firstSevenRods) T.pearlStepBeforeSeven++;
      T.pearlFiles.push({ file: r.file, rods: r.rodsAtFirstPearlStep, maxRods: r.maxRods, pearlMin: +m(Object.values(r.pearlActionMs).reduce((a, b) => a + b, 0)).toFixed(1),
        actions: Object.fromEntries(Object.entries(r.pearlActionMs).map(([k, v]) => [k, +m(v).toFixed(1)])), playedMin: +m(r.ms).toFixed(1), minuteOfFile: +m(r.firstPearlStep - r.startT).toFixed(1),
        deaths: r.deaths.length, milestones: r.milestonesAtPearl, endermanHuntMin: +m(r.endermanHuntMs).toFixed(1), endermanFightFrames: r.endermanFightFrames, warpedFound: r.warpedFound, netherGoldMax: r.netherGoldMax });
    }
    T.barterFrames += r.barterFrames;
    if (r.replay) { T.replay.minutes += m(r.replay.minutes); T.replay.anyMin += m(r.replay.anyMin); T.replay.asks += r.replay.asks; if (r.replay.asks) T.replay.files++;
      for (const [k, v] of Object.entries(r.replay.routeMin)) add(T.replay.routeMin, k, m(v)); for (const [k, v] of Object.entries(r.replay.asksBy)) add(T.replay.asksBy, k, v); }
  }
  for (const o of [T.dimMin, T.phaseMin, T.pearlActionMin, T.endermanMin, T.endermanNearRungMin]) for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
  for (const k of ['botHours', 'downHours']) T[k] = +T[k].toFixed(1);
  T.endermanHuntMin = +T.endermanHuntMin.toFixed(1);
  T.replay.minutes = Math.round(T.replay.minutes); T.replay.anyMin = Math.round(T.replay.anyMin);
  for (const k of Object.keys(T.replay.routeMin)) T.replay.routeMin[k] = Math.round(T.replay.routeMin[k]);
  for (const k of ['piglinMin', 'piglinGoldMin', 'netherGoldMin', 'netherMinBothShort']) T[k] = Math.round(T[k]);
  return T;
}

function print(T) {
  console.log(`Flight records: ${T.files} files, ${T.botHours} bot-hours played (${T.downHours} Jev down, off the clock).`);
  console.log(`Minutes by dimension: ${JSON.stringify(T.dimMin)}`);
  console.log(`Pearls: most carried in any record ${T.maxPearls}; records with a pearl ${T.filesWithPearls}; pearl gains ${T.pearlGains.length}.`);
  for (const g of T.pearlGains.slice(0, 20)) console.log(`  +${g.n} ${g.at} ${g.dim} ${g.step || '-'} ${g.file}`);
  console.log(`Rods: records reaching 7 ${T.filesSevenRods}. Pearl rung reached in ${T.filesPearlStep} records (${T.pearlStepBeforeSeven} before seven rods), rods carried then ${JSON.stringify(T.pearlStepRods)}.`);
  console.log(`Pearl rung minutes by step: ${JSON.stringify(T.pearlActionMin)}`);
  for (const f of T.pearlFiles) console.log(`  ${f.file} rods ${f.rods}/${f.maxRods} pearl-rung ${f.pearlMin} of ${f.playedMin} min ${JSON.stringify(f.actions)} deaths ${f.deaths} warped found ${f.warpedFound} Nether gold ${f.netherGoldMax}`);
  console.log(`Endermen within 16/32 blocks, minutes: ${JSON.stringify(T.endermanMin)}; distinct endermen within 16 by dimension ${JSON.stringify(T.endermenDistinct)}; frames within 8: see json.`);
  console.log(`Endermen within 16 by dimension:rung, minutes: ${JSON.stringify(Object.fromEntries(Object.entries(T.endermanNearRungMin).sort((a, b) => b[1] - a[1]).slice(0, 12)))}`);
  console.log(`Enderman fights (survival action on one): ${T.endermanFightFrames} frames; hits taken from endermen ${T.endermanHurt}; stance answers with an enderman among the threats ${JSON.stringify(T.endermanStance)}.`);
  console.log(`Deaths: ${T.deaths} ${JSON.stringify(T.deathsByDim)}; within 15 s of an enderman within 8: ${T.deathsEnderman}; on the pearl rung: ${T.deathsInPearlPhase}.`);
  console.log(`Nether: ${T.filesNether} records; gold carried in ${T.filesNetherGold}, a throwable ingot in ${T.filesNetherThrowable}; most gold (ingot eq.) ${JSON.stringify(T.netherGoldMaxDist)}; minutes with gold to throw ${T.netherGoldMin}, piglin within 32 ${T.piglinMin}, both ${T.piglinGoldMin}.`);
  console.log(`Nether minutes short of both rods and pearls ${T.netherMinBothShort}. Warped forests found ${T.warpedFound} in ${T.filesWarped} records. Barter step frames ${T.barterFrames}.`);
  const R = T.replay;
  console.log(`Replayed (pearl_order): ${R.minutes} Nether minutes short of both on another rung; a pearl route real from there ${R.anyMin} of them (${JSON.stringify(R.routeMin)}); the question asked ${R.asks} times in ${R.files} records (${JSON.stringify(R.asksBy)} offered), ${(R.asks / Math.max(1, R.minutes / 60)).toFixed(1)} an hour of those minutes.`);
  console.log(`Pearl decisions: ${JSON.stringify(T.pearlDecisions)}`);
  console.log(`Top phases (minutes): ${JSON.stringify(Object.fromEntries(Object.entries(T.phaseMin).sort((a, b) => b[1] - a[1]).slice(0, 14)))}`);
}

if (!isMainThread && workerData?.worker) parentPort.on('message', f => readFile(f).then(r => parentPort.postMessage(r), () => parentPort.postMessage({ file: path.basename(f), ms: 0, downMs: 0, dimMs: {}, phaseMs: {}, pearlActionMs: {}, endermanMs: {}, endermanNearRung: {}, endermanIds: {}, endermanStance: {}, pearlDecisions: {}, deaths: [], pearlGains: [] })));
else if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
module.exports = { readFile, summarize, goldOf };
