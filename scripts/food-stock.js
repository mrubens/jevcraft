#!/usr/bin/env node
'use strict';
// The food carried over each run (note 796), from the flight records: the
// healing food (safe food, foraging.js foodSupply's kinds) carried a played
// minute, raw against cooked; where food came in and went out (eaten, put
// in a furnace, dropped or stashed, died with, gone unexplained); how long
// the bot went with no healing food carried; and at each low-health moment
// (health falling under 8) and each death, the food carried, the hunger and
// the last food question asked before it with its options and answer.
// Then the record a reserve is priced by: of the played minutes at each
// level of food carried, how many were followed within 30 minutes by a
// low-health moment with nothing that heals carried.
//   node scripts/food-stock.js [--since 2026-09-30T06:00Z] [--until 2026-10-01T04:57:47Z] [--json] [--examples]
//   node scripts/food-stock.js --under796 [--cache file]   (the same spells under note 796's reserve: under796 below)
//   --save file keeps the spells, moments and minutes read, for --cache.
// JEV_ROOT reads another checkout's records (from a worktree). Jev-down
// spells (scripts/lib/jev-down.js) are kept off the played clock, and
// moments in them are counted apart (note 781). Read-only.
const fs = require('node:fs');
const path = require('node:path');
const JD = require('./lib/jev-down');
const FA = require('./food-asks');

const foods = Object.fromEntries(require('minecraft-data')('26.1').foodsArray.map(f => [f.name, f.foodPoints]));
const UNSAFE = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'rotten_flesh', 'chicken', 'suspicious_stew', 'chorus_fruit']);
const RAW = new Set(['beef', 'porkchop', 'mutton', 'rabbit', 'cod', 'salmon', 'potato']);
const COOKED_OF = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', chicken: 'cooked_chicken' };
const RAW_OF = Object.fromEntries(Object.entries(COOKED_OF).map(([r, c]) => [c, r]));
const isFood = k => foods[k] != null;
const safe = k => isFood(k) && !UNSAFE.has(k);
const LOW = 8, REARM = 12, AHEAD_MS = 30 * 60000, PLAY_GAP_MS = 2 * 60000, QUESTION_MS = 10 * 60000;
const r1 = n => n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
const med = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? r1(b[b.length >> 1]) : null; };
const sum = a => a.reduce((n, v) => n + v, 0);

function stockOf(inv) {
  let points = 0, raw = 0, cooked = 0, other = 0, lastResort = 0, cookGain = 0;
  for (const [k, c] of Object.entries(inv || {})) {
    if (!isFood(k)) continue;
    const p = c * foods[k];
    if (!safe(k)) { if (k === 'rotten_flesh' || k === 'chicken') lastResort += p; if (k === 'chicken') cookGain += c * (foods.cooked_chicken - foods.chicken); continue; }
    points += p;
    if (RAW.has(k)) { raw += p; cookGain += c * (foods[COOKED_OF[k]] - foods[k]); } else if (RAW_OF[k]) cooked += p; else other += p;
  }
  return { points, raw, cooked, other, lastResort, cookGain };
}
const band = p => p <= 0 ? '0' : p < 12 ? '1-11' : p < 24 ? '12-23' : p < 48 ? '24-47' : p < 80 ? '48-79' : '80+';
const BANDS = ['0', '1-11', '12-23', '24-47', '48-79', '80+'];
// Finer, for the reserve's record (food-reserve.js RECORD).
const FINE = [[0, 0], [1, 5], [6, 11], [12, 17], [18, 23], [24, 35], [36, 47], [48, 79], [80, Infinity]];
const fine = p => { const b = FINE.find(([a, z]) => p >= a && p <= z); return b[1] === Infinity ? `${b[0]}+` : b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`; };
const placeOf = (dim, y) => /nether/.test(String(dim)) ? 'nether' : /end/.test(String(dim)) ? 'end' : !Number.isFinite(y) ? '?' : y < 56 ? 'under' : 'surface';

// The trials (artifacts/midgame/*.json): port and start, for minutes into a run.
function trials(root) {
  const dir = path.join(root, 'artifacts', 'midgame'), out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (j.port && j.startedAt) out.push({ world: j.world, port: String(j.port), from: Date.parse(j.startedAt), source: j.source || null }); } catch (_) { /* skip */ }
  }
  return out.sort((a, b) => a.from - b.from);
}
const trialAt = (T, port, t) => { let w = null; for (const x of T) { if (x.port !== port) continue; if (x.from <= t) w = x; else break; } return w; };

// The food question's words, slim: its id, the food and work options on
// offer, the answer and when.
function questionOf(d, t, carried, health, food) {
  const opts = [];
  const walk = (tree, pre) => { for (const [k, v] of Object.entries(tree || {})) { opts.push(pre ? `${pre}/${k}` : k); if (v?.children) walk(v.children, pre ? `${pre}/${k}` : k); } };
  walk(d.options, '');
  const c = FA.classify(d);
  const claim = d.id === 'turn_priority' ? d.options?.survival?.description?.action || null : null;
  return { t, id: d.id, answer: (d.path || []).join('/'), options: opts.slice(0, 24), food: !!c?.food, work: !!c?.work, claim, carried, health: r1(health), hunger: food };
}
const isFoodQuestion = d => !!FA.classify(d) || ['kit_food', 'nether_food_kit', 'restock_food'].includes(d?.id);

// One record, slim: frames with the food stock, chat, the actions, and the
// food questions.
function readRecord(file, { since, until }) {
  let text;
  try { if (fs.statSync(file).mtimeMs < since) return null; text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const name = path.basename(file), m = name.match(/-(\d{5})-Jev-/);
  const port = m ? m[1] : '?';
  const frames = [], ev = [], seen = new Set();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(r.at), s = r.snapshot || {};
    if (!(t >= since && t <= until)) continue;
    const e = JD.evidenceOf(r);
    ev.push({ t, kind: r.kind, ...(e?.back ? { jb: 1 } : e?.down ? { jd: e.kind, ...(e.marked ? { jm: 1 } : {}) } : {}) });
    const f = { t, kind: r.kind, label: r.label, health: s.health ?? null, food: s.food ?? null, dim: s.dimension, y: s.position?.y ?? null };
    if (s.inventory) f.inv = Object.fromEntries(Object.entries(s.inventory).filter(([k]) => isFood(k)));
    const sa = s.survivalAction || s.goal?.survivalAction;
    if (sa?.action) f.sa = sa.action, f.saAt = Date.parse(sa.at) || null;
    const step = s.step?.action || s.goal?.step?.action;
    if (step) f.step = step;
    if (r.kind === 'chat' && r.detail?.from === 'Jev') f.chat = String(r.detail.message || '').slice(0, 300);
    if (r.kind === 'survival' && r.label === 'eat') f.eat = s.survivalAction?.item || true;
    const d = s.decision;
    if (r.kind === 'decision' && r.source === 'jev' && d?.id && !seen.has(d.id + d.at)) {
      seen.add(d.id + d.at);
      f.dec = d.id; f.decPath = (d.path || []).join('/');
      if (isFoodQuestion(d)) f.q = questionOf(d, Date.parse(d.at) || t, null, s.health, s.food);
      if (d.id === 'encounter_stance') f.stance = { t: Date.parse(d.at) || t, answer: (d.path || []).join('/'), eat: !!d.options?.eat, stepOutEat: !!d.options?.step_out_and_eat, hunger: s.food, health: r1(s.health) };
    }
    frames.push(f);
  }
  frames.sort((a, b) => a.t - b.t);
  ev.sort((a, b) => a.t - b.t);
  return { port, name, frames, spells: JD.spellsOf(ev) };
}

const COOK_CONTEXT = /cook|smelt|furnace|batch/i;
const DROP_CHAT = /^(Dropping|My pockets are full|I'm leaving|Leaving)\b|to make room/i;
const STASH_CHAT = /^Put .* in the chest|stash/i;

function scan(dir, { since, until, root }) {
  const T = trials(root);
  const R = { files: 0, playMs: 0, downMs: 0, time: {}, timeByPlace: {}, timeByRunMin: {}, zeroSpells: [], gains: {}, losses: {}, eats: [], lows: [], deaths: [], ahead: {}, minuteSamples: [], rawCarriedNoCooked: 0, cookGainCarriedMs: 0 };
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const fname of fs.readdirSync(dir).sort()) {
    if (!fname.endsWith('.jsonl')) continue;
    const rec = readRecord(path.join(dir, fname), { since, until });
    if (!rec || !rec.frames.length) continue;
    R.files++;
    const down = t => JD.within(rec.spells, t, 60000);
    // Carry the stock forward from the last frame that had the pockets.
    let stock = null, inv = null, lastQ = null, zero = null, lowArmed = true, prevHealth = null, lastWhy = 'record start', lastHadAt = null, lastStance = null, short = null;
    const samples = []; // { t, points, place, health, food } a played minute
    let nextSample = 0;
    const lowsHere = [];
    let prev = null, prevIdx = -1;
    for (let i = 0; i < rec.frames.length; i++) {
      const f = rec.frames[i];
      if (f.stance) lastStance = f.stance;
      if (f.q && short) { short.asks++; if (f.q.food) short.foodAnswers++; else if (f.q.work) short.workAnswers++; short.ids[f.q.id] = (short.ids[f.q.id] || 0) + 1; }
      if (f.q) { lastQ = f.q; if (zero) { zero.asks++; if (f.q.food) { zero.foodAnswers++; if (zero.firstFoodMin == null) zero.firstFoodMin = r1((f.t - zero.from) / 60000); } if (zero.firstAskMin == null) zero.firstAskMin = r1((f.t - zero.from) / 60000); else if (f.q.work) zero.workAnswers++; (zero.ids[f.q.id] ||= 0); zero.ids[f.q.id]++; } }
      // Pockets: changes between this frame and the last that had them.
      if (f.inv) {
        const s = stockOf(f.inv);
        if (inv && prev && prev.health !== 0) {
          const keys = new Set([...Object.keys(inv), ...Object.keys(f.inv)]);
          const between = rec.frames.slice(prevIdx + 1, i + 1);
          const ateBetween = between.some(x => x.eat) || (f.food != null && prev?.food != null && f.food > prev.food);
          const cookCtx = between.some(x => COOK_CONTEXT.test(`${x.sa || ''} ${x.step || ''} ${x.dec || ''} ${x.label || ''}`));
          const chat = [];
          for (let j = Math.max(0, prevIdx - 3); j < rec.frames.length && rec.frames[j].t <= f.t + 3000; j++) if (rec.frames[j].chat && rec.frames[j].t > prev.t - 2000) chat.push(rec.frames[j].chat);
          const ctx = (between.find(x => x.sa && x.saAt && f.t - x.saAt < 60000)?.sa) || f.sa && f.saAt && f.t - f.saAt < 60000 && f.sa || f.step || prev.step || between.map(x => x.dec).filter(Boolean).at(-1) || '?';
          for (const k of keys) {
            const dlt = (f.inv[k] || 0) - (inv[k] || 0);
            if (!dlt) continue;
            const pts = Math.abs(dlt) * foods[k], kind = RAW.has(k) || k === 'chicken' ? 'raw' : RAW_OF[k] ? 'cooked' : safe(k) ? 'other' : 'last_resort';
            const place = placeOf(f.dim, f.y);
            if (dlt < 0) {
              let why;
              const raw = RAW.has(k) || k === 'chicken', cooking = raw && (cookCtx || (f.inv[COOKED_OF[k]] || 0) > (inv[COOKED_OF[k]] || 0));
              if (ateBetween && -dlt <= 2) why = 'eaten';
              else if (cooking) why = 'into a furnace';
              else if (/^(eat|step_out_and_eat|eat_carried)$/.test(ctx) || between.some(x => x.eat)) why = 'eaten';
              else if (chat.some(c => STASH_CHAT.test(c))) why = 'stashed';
              else if (chat.some(c => DROP_CHAT.test(c))) why = 'dropped for room';
              else why = `gone, unexplained (${ctx})`;
              add(R.losses, `${why}|${kind}`, pts);
              if (s.points <= 0 && safe(k)) lastWhy = why.startsWith('gone') ? 'gone, unexplained' : why;
              if (why === 'eaten') R.eats.push({ port: rec.port, t: f.t, item: k, hungerBefore: prev.food, health: r1(prev.health), place, carriedBefore: stock?.points ?? null });
            } else {
              let why;
              if (RAW_OF[k] && (cookCtx || (f.inv[RAW_OF[k]] || 0) < (inv[RAW_OF[k]] || 0))) why = 'from a furnace';
              else why = ctx;
              add(R.gains, `${why}|${kind}`, pts);
            }
          }
        }
        inv = f.inv; stock = s; prev = f; prevIdx = i;
        if (s.points > 0) lastHadAt = f.t;
        // The run down: from under the reserve's floor (food-reserve.js:
        // 12 in the Overworld, 36 in the Nether) to none.
        const floorHere = /nether/.test(String(f.dim)) ? 36 : 12;
        if (s.points >= floorHere) short = null;
        else if (s.points > 0 && !short) short = { from: f.t, asks: 0, foodAnswers: 0, workAnswers: 0, ids: {}, place: placeOf(f.dim, f.y), hunger: f.food };
      } else if (f.health === 0) { prev = f; prevIdx = i; }
      // A death: what the pockets held at it.
      if (f.health === 0 && prevHealth > 0) {
        const tr = trialAt(T, rec.port, f.t);
        R.deaths.push({ port: rec.port, world: tr?.world || null, t: f.t, down: down(f.t), stock: stock ? { ...stock } : null, hunger: f.food ?? null, place: placeOf(f.dim, f.y), lastQ: lastQ && f.t - lastQ.t < QUESTION_MS ? { ...lastQ, agoS: Math.round((f.t - lastQ.t) / 1000) } : null });
        inv = null; stock = null; lowArmed = true; lastWhy = 'respawned after a death'; lastHadAt = null;
        if (zero) { zero.ended = 'death'; R.zeroSpells.push(zero); zero = null; }
      }
      // A low-health moment: health falling under 8, again once back at 12.
      if (Number.isFinite(f.health) && f.health > 0) {
        if (f.health >= REARM) lowArmed = true;
        if (lowArmed && f.health < LOW && Number.isFinite(prevHealth) && prevHealth >= LOW) {
          lowArmed = false;
          const tr = trialAt(T, rec.port, f.t);
          const died = rec.frames.some(x => x.t > f.t && x.t <= f.t + 60000 && x.health === 0);
          const low = { port: rec.port, world: tr?.world || null, t: f.t, down: down(f.t), health: r1(f.health), hunger: f.food, stock: stock ? { ...stock } : null, place: placeOf(f.dim, f.y), y: r1(f.y), diedWithin60: died,
            lastQ: lastQ && f.t - lastQ.t < QUESTION_MS ? { ...lastQ, agoS: Math.round((f.t - lastQ.t) / 1000) } : null,
            zero: zero && stock?.points <= 0 ? { began: zero.began, minutesIn: r1((f.t - zero.from) / 60000), asks: zero.asks, foodAnswers: zero.foodAnswers, workAnswers: zero.workAnswers } : null,
            foods: inv ? { ...inv } : null, stance: lastStance && f.t - lastStance.t < 30000 ? { ...lastStance, agoS: r1((f.t - lastStance.t) / 1000) } : null,
            minutesSinceFood: lastHadAt ? r1((f.t - lastHadAt) / 60000) : null };
          R.lows.push(low); lowsHere.push(low);
          if (zero && stock?.points <= 0) (zero.lows ||= []).push({ min: r1((f.t - zero.from) / 60000), died: died, down: low.down });
        }
      }
      if (Number.isFinite(f.health)) prevHealth = f.health;
      // Played time: to the next frame, under two minutes, Jev up.
      const nx = rec.frames[i + 1];
      if (!nx || !stock) continue;
      const gap = nx.t - f.t;
      if (gap <= 0 || gap > PLAY_GAP_MS || f.health === 0) continue;
      if (down(f.t)) { R.downMs += gap; continue; }
      R.playMs += gap;
      const b = band(stock.points), place = placeOf(f.dim, f.y);
      add(R.time, b, gap);
      const tp = (R.timeByPlace[place] ||= {}); add(tp, b, gap);
      const tr = trialAt(T, rec.port, f.t);
      if (tr) {
        const m = (f.t - tr.from) / 60000, rb = m < 30 ? '0-30' : m < 60 ? '30-60' : m < 120 ? '60-120' : m < 240 ? '120-240' : '240+';
        const o = (R.timeByRunMin[rb] ||= { ms: 0, pointsMs: 0, rawMs: 0, cookedMs: 0, zeroMs: 0 });
        o.ms += gap; o.pointsMs += stock.points * gap; o.rawMs += stock.raw * gap; o.cookedMs += stock.cooked * gap; if (stock.points <= 0) o.zeroMs += gap;
      }
      if (stock.raw > 0 && stock.cooked === 0 && stock.other === 0) R.rawCarriedNoCooked += gap;
      const cantHeal = stock.points <= 0 && f.food != null && f.food < 18;
      if (cantHeal) add(R.time, 'zeroAndHungerUnder18', gap);
      if (cantHeal && f.health != null && f.health < 20) add(R.time, 'zeroHungerUnder18Hurt', gap);
      // Spells at zero.
      if (stock.points <= 0) { if (!zero) { zero = { port: rec.port, from: f.t, ms: 0, place, began: lastWhy, runDown: short ? { at: short.from, minutes: r1((f.t - short.from) / 60000), asks: short.asks, foodAnswers: short.foodAnswers, workAnswers: short.workAnswers, ids: short.ids, place: short.place } : null, asks: 0, foodAnswers: 0, workAnswers: 0, ids: {}, minHealth: 20, hungerUnder18Ms: 0, hungerAtStart: f.food, yAtStart: r1(f.y) }; short = null; } zero.ms += gap; zero.to = nx.t; if (Number.isFinite(f.health) && f.health < zero.minHealth) zero.minHealth = f.health; if (f.food < 18) zero.hungerUnder18Ms += gap; }
      else if (zero) { zero.ended = 'food'; R.zeroSpells.push(zero); zero = null; }
      if (f.t >= nextSample) { samples.push({ t: f.t, points: stock.points, place, health: f.health, food: f.food }); nextSample = f.t + 60000; }
    }
    if (zero) R.zeroSpells.push(zero);
    // Ahead: of each played minute at a level of food carried, was a
    // low-health moment with no healing food carried within 30 minutes?
    for (const s of samples) {
      const hit = lowsHere.some(l => !l.down && l.t > s.t && l.t <= s.t + AHEAD_MS && (l.stock?.points ?? 0) <= 0);
      const anyLow = lowsHere.some(l => !l.down && l.t > s.t && l.t <= s.t + AHEAD_MS);
      for (const key of [`${band(s.points)}|all`, `${band(s.points)}|${s.place}`, `fine ${fine(s.points)}|${s.place === 'nether' ? 'nether' : 'overworld'}`]) {
        const o = (R.ahead[key] ||= { minutes: 0, lowWithNone: 0, low: 0 });
        o.minutes++; if (hit) o.lowWithNone++; if (anyLow) o.low++;
      }
    }
    R.minuteSamples.push(...samples.map(s => ({ ...s, port: rec.port })));
  }
  return R;
}

function summarize(R) {
  const h = ms => r1(ms / 3600000);
  const up = R.lows.filter(l => !l.down), deathsUp = R.deaths.filter(d => !d.down);
  const none = l => (l.stock?.points ?? 0) <= 0;
  const by = (list, f) => list.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  const pts = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]));
  const lossBy = {}; for (const [k, v] of Object.entries(R.losses)) { const [why] = k.split('|'); const w = why.startsWith('gone, unexplained') ? 'gone, unexplained' : why; lossBy[w] = (lossBy[w] || 0) + v; }
  const zs = R.zeroSpells.map(z => z.ms / 60000);
  const qSays = l => l.lastQ ? `${l.lastQ.id} -> ${l.lastQ.answer || '(none)'} ${l.lastQ.agoS} s before${l.lastQ.claim ? ` (claim ${l.lastQ.claim})` : ''}` : 'no food question in the 10 minutes before';
  const lowRow = list => ({ n: list.length, withNone: list.filter(none).length, withNoneHungerUnder18: list.filter(l => none(l) && l.hunger < 18).length, diedWithin60: list.filter(l => l.diedWithin60).length, withNoneDied: list.filter(l => none(l) && l.diedWithin60).length,
    rawOnly: list.filter(l => l.stock && l.stock.points > 0 && l.stock.cooked === 0 && l.stock.other === 0).length, lastResortOnly: list.filter(l => none(l) && l.stock?.lastResort > 0).length,
    noQuestion: list.filter(l => none(l) && !l.lastQ).length });
  return {
    files: R.files, playedBotHours: h(R.playMs), jevDownBotHours: h(R.downMs),
    minutesByFoodCarried: Object.fromEntries(BANDS.map(b => [b, { botHours: h(R.time[b] || 0), share: r1(100 * (R.time[b] || 0) / R.playMs) }])),
    minutesByPlace: Object.fromEntries(Object.entries(R.timeByPlace).map(([p, o]) => { const all = sum(Object.values(o)); return [p, { botHours: h(all), zeroShare: r1(100 * (o['0'] || 0) / all), under12Share: r1(100 * ((o['0'] || 0) + (o['1-11'] || 0)) / all) }]; })),
    zeroAndHungerUnder18BotHours: h(R.time.zeroAndHungerUnder18 || 0), zeroHungerUnder18HurtBotHours: h(R.time.zeroHungerUnder18Hurt || 0),
    rawOnlyBotHours: h(R.rawCarriedNoCooked),
    byMinuteOfRun: Object.fromEntries(Object.entries(R.timeByRunMin).map(([k, o]) => [k, { botHours: h(o.ms), meanPoints: r1(o.pointsMs / o.ms), meanRaw: r1(o.rawMs / o.ms), meanCooked: r1(o.cookedMs / o.ms), zeroShare: r1(100 * o.zeroMs / o.ms) }])),
    zeroSpells: { n: zs.length, botHours: r1(sum(zs) / 60), median: med(zs), over10: zs.filter(m => m >= 10).length, over30: zs.filter(m => m >= 30).length, longest: R.zeroSpells.slice().sort((a, b) => b.ms - a.ms).slice(0, 6).map(z => `${z.port} ${new Date(z.from).toISOString().slice(0, 19)} ${r1(z.ms / 60000)} min, ${z.place}`) },
    zeroSpellsByBegin: Object.fromEntries(Object.entries(R.zeroSpells.reduce((o, z) => { const x = (o[z.began] ||= { n: 0, minutes: 0, hungerUnder18Minutes: 0, withFoodAnswer: 0, noFoodQuestion: 0, minHealthUnder8: 0 }); x.n++; x.minutes += z.ms / 60000; x.hungerUnder18Minutes += z.hungerUnder18Ms / 60000; if (z.foodAnswers) x.withFoodAnswer++; if (!z.asks) x.noFoodQuestion++; if (z.minHealth < 8) x.minHealthUnder8++; return o; }, {})).map(([k, v]) => [k, { ...v, minutes: r1(v.minutes), hungerUnder18Minutes: r1(v.hungerUnder18Minutes) }])),
    runDownToZero: (() => { const l = R.zeroSpells.filter(z => z.began === 'eaten' && z.runDown); const ids = {}; for (const z of l) for (const [k, v] of Object.entries(z.runDown.ids)) ids[k] = (ids[k] || 0) + v;
      return { spells: l.length, medianMinutesFromUnderFloor: med(l.map(z => z.runDown.minutes)), noFoodQuestion: l.filter(z => !z.runDown.asks).length, noFoodAnswer: l.filter(z => !z.runDown.foodAnswers).length, workAnswered: l.filter(z => z.runDown.workAnswers).length, byPlace: by(l, z => z.runDown.place), questions: ids,
        thenLowUnder8: l.filter(z => z.minHealth < 8).length }; })(),
    zeroSpellsQuestions: (() => { const o = {}; for (const z of R.zeroSpells) for (const [k, v] of Object.entries(z.ids)) o[k] = (o[k] || 0) + v; return o; })(),
    gainedPoints: pts(R.gains), lostPoints: pts(R.losses), lostBy: pts(lossBy),
    eats: { n: R.eats.length, byHungerBefore: by(R.eats, e => e.hungerBefore == null ? '?' : e.hungerBefore >= 18 ? '18+' : e.hungerBefore >= 14 ? '14-17' : e.hungerBefore >= 7 ? '7-13' : '0-6'), atHunger18PlusFullHealth: R.eats.filter(e => e.hungerBefore >= 18 && e.health >= 20).length },
    lowHealth: { jevUp: lowRow(up), byPlace: Object.fromEntries(Object.keys(by(up, l => l.place)).map(p => [p, lowRow(up.filter(l => l.place === p))])), jevDown: R.lows.length - up.length,
      withNoneLastQuestion: by(up.filter(none), l => l.lastQ ? `${l.lastQ.id} ${l.lastQ.food ? 'food' : l.lastQ.work ? 'work' : 'other'}` : 'none in 10 min') },
    deaths: { jevUp: deathsUp.length, withNone: deathsUp.filter(d => (d.stock?.points ?? 0) <= 0).length, rawOnly: deathsUp.filter(d => d.stock && d.stock.points > 0 && d.stock.cooked === 0 && d.stock.other === 0).length,
      diedWithPoints: sum(deathsUp.map(d => d.stock?.points || 0)), diedWithRaw: sum(deathsUp.map(d => d.stock?.raw || 0)), byPlace: by(deathsUp, d => d.place), jevDown: R.deaths.length - deathsUp.length },
    // The record a reserve is priced by.
    aheadLowWithNone: Object.fromEntries(Object.entries(R.ahead).sort().map(([k, o]) => [k, { minutes: o.minutes, lowWithNoneWithin30: o.lowWithNone, pct: r1(100 * o.lowWithNone / o.minutes), anyLowWithin30: o.low }])),
    lowWithNoneZeroBegan: by(up.filter(none), l => l.zero?.began || (l.stock ? '?' : 'pockets unknown')),
    lowWithNoneMinutesSinceFood: { median: med(up.filter(none).map(l => l.minutesSinceFood)), over10: up.filter(l => none(l) && l.minutesSinceFood >= 10).length, never: up.filter(l => none(l) && l.minutesSinceFood == null).length },
    lowWithNoneSpellAnswers: { anyFoodAnswer: up.filter(l => none(l) && l.zero?.foodAnswers).length, workAnswersOnly: up.filter(l => none(l) && l.zero && !l.zero.foodAnswers && l.zero.workAnswers).length, noFoodQuestion: up.filter(l => none(l) && l.zero && !l.zero.asks).length },
    examples: up.filter(none).map(l => `${l.port} ${new Date(l.t).toISOString().slice(0, 19)} ${l.place} y ${l.y}: health ${l.health}, hunger ${l.hunger}, ${l.stock ? `${l.stock.points} points (raw ${l.stock.raw}, last resort ${l.stock.lastResort})` : 'pockets unknown'}${l.diedWithin60 ? ', died within 60 s' : ''}; ${l.zero ? `none since ${l.zero.began} ${l.zero.minutesIn} min before (food answers ${l.zero.foodAnswers}, work ${l.zero.workAnswers}, asks ${l.zero.asks})` : ''}; ${qSays(l)}`),
  };
}

// Note 796's reserve over the same spells (Jev's answers cannot be
// replayed: TypeSafe's credits are out). Under the rule, with the game's
// ladder in the Overworld, food is asked as soon as what is carried falls
// under the floor (12 points), at any hunger: at the run-down's start where
// the food ran down from under the floor, else at the spell's start (a
// respawn, a record begun with none, a batch put in a furnace). A spell
// where a food answer was already given at that point is left as it was.
// The way chosen then brings food at the record's rate and pace for the
// place it was asked (note 784's food answers by place: food within ten
// minutes 1,904 of 2,121 at y 56 or above, 770 of 1,351 under it; the herd
// walk's and the search's median minutes to the food, food-plan.js
// SOURCE_RECORD), and a spell's minutes and its low-health moments after
// the food are taken off by that rate. `p1`: every such question answered
// with food that came at that pace (the bound).
const PLACE_RATE = { surface: 1904 / 2121, under: 770 / 1351 };
const PLACE_MEDIAN_MIN = { surface: (0.6 + 1.2) / 2, under: (2.8 + 2.6) / 2 };
function under796(cache) {
  const out = { spells: 0, asked: 0, alreadyAnswered: 0, before: { zeroMinutes: 0, lows: 0, lowsDied: 0 }, after: { zeroMinutes: 0, lows: 0, lowsDied: 0 }, bound: { zeroMinutes: 0, lows: 0, lowsDied: 0 }, nether: { zeroMinutes: 0, lows: 0 }, byBegin: {} };
  for (const z of cache.zeroSpells) {
    const len = z.ms / 60000, lows = (z.lows || []).filter(l => !l.down);
    if (z.place === 'nether' || z.place === 'end' || z.place === '?') { out.nether.zeroMinutes += len; out.nether.lows += lows.length; continue; }
    out.spells++;
    out.before.zeroMinutes += len; out.before.lows += lows.length; out.before.lowsDied += lows.filter(l => l.died).length;
    const rd = z.runDown;
    const oldAnswered = rd ? rd.foodAnswers > 0 : (z.firstFoodMin != null && z.firstFoodMin <= 0.5);
    const b = (out.byBegin[z.began] ||= { spells: 0, asked: 0, beforeMin: 0, afterMin: 0, beforeLows: 0, afterLows: 0 });
    b.spells++; b.beforeMin += len; b.beforeLows += lows.length;
    if (oldAnswered) {
      out.alreadyAnswered++;
      for (const k of ['after', 'bound']) { out[k].zeroMinutes += len; out[k].lows += lows.length; out[k].lowsDied += lows.filter(l => l.died).length; }
      b.afterMin += len; b.afterLows += lows.length;
      continue;
    }
    out.asked++; b.asked++;
    const askAt = rd ? -rd.minutes : 0;
    const place = (rd?.place || z.place) === 'surface' ? 'surface' : 'under';
    const foodAt = askAt + PLACE_MEDIAN_MIN[place];
    // The spell as it went ended with food at `len` where it ended by food.
    const endedByFood = z.ended === 'food' ? len : Infinity;
    const better = foodAt < endedByFood;
    const newLen = better ? Math.max(0, Math.min(len, foodAt)) : len;
    const lowsAfter = better ? lows.filter(l => l.min < foodAt) : lows;
    const p = PLACE_RATE[place];
    out.after.zeroMinutes += p * newLen + (1 - p) * len;
    out.after.lows += p * lowsAfter.length + (1 - p) * lows.length;
    out.after.lowsDied += p * lowsAfter.filter(l => l.died).length + (1 - p) * lows.filter(l => l.died).length;
    out.bound.zeroMinutes += newLen; out.bound.lows += lowsAfter.length; out.bound.lowsDied += lowsAfter.filter(l => l.died).length;
    b.afterMin += p * newLen + (1 - p) * len; b.afterLows += p * lowsAfter.length + (1 - p) * lows.length;
  }
  const r = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r1(v) : v && typeof v === 'object' ? r(v) : v]));
  return r(out);
}

module.exports = { under796, scan, summarize, stockOf, band, BANDS, fine, FINE, readRecord, placeOf, trials };

if (require.main === module) {
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const opts = { since: Date.parse(arg('--since', '2026-09-30T06:00:00Z')), until: Date.parse(arg('--until', '2026-10-01T04:57:47Z')), root: ROOT };
  const dir = arg('--dir', path.join(ROOT, '.bot-state', 'flight'));
  if (argv.includes('--under796')) {
    const cache = arg('--cache', null);
    const c = cache ? JSON.parse(fs.readFileSync(cache, 'utf8')) : (() => { const R = scan(dir, opts); return { zeroSpells: R.zeroSpells }; })();
    console.log(JSON.stringify({ since: new Date(opts.since).toISOString(), until: new Date(opts.until).toISOString(), under796: under796(c) }, null, 1));
    process.exit(0);
  }
  const R = scan(dir, opts);
  const cache = arg('--save', null);
  if (cache) fs.writeFileSync(cache, JSON.stringify({ lows: R.lows, deaths: R.deaths, eats: R.eats, minuteSamples: R.minuteSamples, zeroSpells: R.zeroSpells }));
  const out = { since: new Date(opts.since).toISOString(), until: new Date(opts.until).toISOString(), ...summarize(R) };
  if (!argv.includes('--examples')) delete out.examples;
  console.log(JSON.stringify(out, null, 1));
}
