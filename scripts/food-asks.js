'use strict';
// Food questions and what their answers came to (note 784), from the flight
// records: every question with a food way on offer, a bot-hour by the hunger,
// health, food carried and place it was asked at; every food answer and
// whether food was eaten or carried within ten minutes of it; food errands
// (food answers no more than three minutes apart) that gained nothing and
// their minutes; food errands dropped for the work while health could not
// come back (under 14, hunger under 18, no safe food carried: note 771c's
// need), and the reverse, food answers at full hunger and health with the
// work on offer beside them.
//   node scripts/food-asks.js [--since 2026-09-30T12:00Z] [--until 2026-10-01T04:57Z] [--port 25589] [--json] [--under784]
// Also run by scripts/food-errands.js --asks. Read-only, one file at a time.
//
// --under784: the same answers walked through note 784's rule (food-plan.js
// replay): which asks the held food plan would not have sent, and the dead
// minutes it would have cut (a source failed is not offered again from the
// same stall, a plan for the reserve alone held until its end).
const fs = require('node:fs');
const path = require('node:path');

const foods = Object.fromEntries(require('minecraft-data')('26.1').foodsArray.map(f => [f.name, f.foodPoints]));
const UNSAFE = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew', 'chorus_fruit']);
const points = inv => Object.entries(inv || {}).reduce((n, [k, c]) => n + (foods[k] && !UNSAFE.has(k) ? c * foods[k] : 0), 0);

// The food ways, by key, whatever question offers them.
const FOOD_KEY = /^(obtain_food|eat_carried|food_reserve|top_up_food|top_up_food_near|top_up_cook|restock_food|return_for_food|go_for_food|get_food_here|hoglin_food|hoglin_walk|hoglin_pillar|hoglin_hunt|cook_meat|go_home_for_food|search_food|seen_food_\d+|village_food|pick_up_dropped|raid_bastion|mushroom_stew|cook_cooked_\w+)$/;
// hunt_<id> is food only under a food branch; hunt_target's hunt_<id> is a blaze.
const FOOD_PARENT = /^(obtain_food|go_for_food)$/;
const NOT_FOOD_Q = new Set(['hunt_target', 'while_cooking']);
// Answers that go on with the work.
const WORK_KEY = /^(continue_request|carry_on|go_without|go_on|keep_on|keep_at_it|search_on|work_here|night_mine|go_in)$/;
const STALL_Q = new Set(['rung_progress', 'stillness_detour']);
const SPELL_GAP_MS = 3 * 60000;
const FAILED_WORDS = /No route|no way to|came to nothing|Cannot get to|could not reach|changed nothing|not reachable/i;
const AFTER_MS = 10 * 60000;
const PLAY_GAP_MS = 2 * 60000;

const hungerBand = h => h == null ? '?' : h <= 6 ? '0-6' : h <= 12 ? '7-12' : h <= 17 ? '13-17' : '18-20';
const healthBand = h => h == null ? '?' : h < 7 ? 'under 7' : h < 14 ? '7-13' : h < 20 ? '14-19' : '20';
const carriedBand = c => c <= 0 ? '0' : c < 18 ? '1-17' : c < 80 ? '18-79' : '80+';
const placeOf = (dim, y) => /nether/.test(String(dim)) ? 'nether' : /end/.test(String(dim)) ? 'end' : !Number.isFinite(y) ? '?' : y < 56 ? 'overworld under y 56' : 'overworld y 56+';
const round = n => Math.round(n * 10) / 10;
// The kind of way to food an answer took, for the record a source is priced by.
function sourceKind(leaf) {
  const k = String(leaf).split('/').at(-1);
  if (/^hunt_(N|\d+)$/.test(k)) return 'hunt';
  if (/^seen_food_(N|\d+)$/.test(k)) return 'herd_walk';
  if (k === 'search_food') return 'search';
  if (k === 'go_home_for_food') return 'home';
  if (k === 'village_food') return 'village';
  if (/^cook_|^top_up_cook$/.test(k)) return 'cook';
  if (k === 'eat_carried') return 'meal';
  if (k === 'return_for_food') return 'portal';
  if (/^hoglin_/.test(k)) return 'hoglin';
  if (/^top_up_food|^food_reserve$|^pick_up_dropped$/.test(k)) return 'work_food_step';
  if (/^(restock_food|get_food_here|raid_bastion|mushroom_stew)$/.test(k)) return 'restock';
  if (k === 'survival:obtain_food' || k === 'obtain_food' || k === 'go_for_food') return 'food_first';
  return 'other';
}
const sum = a => a.reduce((n, v) => n + v, 0);
// Health that cannot come back (note 771c): under 14, hunger under 18, nothing safe to eat.
const cannotHeal = f => f.health != null && f.health < 14 && f.food != null && f.food < 18 && !(f.carried > 0);

function keysOf(tree, pre = [], out = []) {
  for (const [k, v] of Object.entries(tree || {})) { out.push({ key: k, parent: pre.at(-1) || null }); if (v?.children) keysOf(v.children, [...pre, k], out); }
  return out;
}
const foodKey = (key, parent) => FOOD_KEY.test(key) || (/^hunt_\d+$/.test(key) && FOOD_PARENT.test(String(parent)));
// Whether the question offered food, and whether its answer was food or the work.
function classify(d) {
  if (!d?.id || NOT_FOOD_Q.has(d.id)) return null;
  if (d.id === 'turn_priority') {
    const claim = d.options?.survival?.description;
    if (claim?.action !== 'obtain_food') return null;
    return { food: d.path?.[0] === 'survival', work: d.path?.[0] === 'work', workOffered: !!d.options?.work, leaf: d.path?.[0] === 'survival' ? 'survival:obtain_food' : d.path?.[0] || '?' };
  }
  const offered = keysOf(d.options).filter(k => foodKey(k.key, k.parent));
  if (!offered.length) return null;
  const path = d.path || [];
  const food = path.some((k, i) => foodKey(k, path[i - 1] || null));
  const work = !food && (path.some(k => WORK_KEY.test(k)) || (STALL_Q.has(d.id) && path.length > 0));
  const workOffered = keysOf(d.options).some(k => WORK_KEY.test(k.key)) || STALL_Q.has(d.id);
  return { food, work, workOffered, leaf: path.map(k => k.replace(/_\d+$/, '_N')).join('/') };
}

// One record file: its timeline and its asks.
function readFile(file, { since, until }) {
  let text;
  try { if (fs.statSync(file).mtimeMs < since) return null; text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  const name = path.basename(file), m = name.match(/-(\d{5})-Jev-/);
  const port = m ? m[1] : '?';
  const frames = [], asks = [], seen = new Set();
  let carried = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const t = Date.parse(r.at), s = r.snapshot;
    if (!s || !(t >= since && t <= until)) continue;
    if (s.inventory) carried = points(s.inventory);
    // A walk or a way that failed: no route, a stall, or an error saying so.
    const failed = r.kind === 'no_route' || r.kind === 'navigation_stall' || (r.kind === 'error' && FAILED_WORDS.test(String(r.label || '')));
    if (Number.isFinite(s.health) || Number.isFinite(s.food) || failed) frames.push({ t, health: s.health ?? null, food: s.food ?? null, carried, dim: s.dimension, y: s.position?.y, pos: s.position || null, jevDown: r.kind === 'jev_down', ...(failed ? { failed: true } : {}) });
    if (r.kind !== 'decision' || r.source !== 'jev') continue;
    const d = s.decision;
    if (!d?.id) continue;
    const dt = Date.parse(d.at);
    if (!(dt >= since && dt <= until) || seen.has(d.id + d.at)) continue;
    seen.add(d.id + d.at);
    const c = classify(d);
    asks.push({ port, t: dt, id: d.id, path: d.path || [], c, health: s.health ?? null, food: s.food ?? null, carried, dim: s.dimension, y: s.position?.y, pos: s.position || null, d });
  }
  frames.sort((a, b) => a.t - b.t); asks.sort((a, b) => a.t - b.t);
  return { port, name, frames, asks };
}

// What came of a food answer within ten minutes: food eaten or carried (the
// points carried above the start, or hunger and points together above the
// start), a death first, or nothing. -> { gained, at, died }
function outcome(frames, t0, start, to = t0 + AFTER_MS) {
  let prevHealth = start.health;
  for (const f of frames) {
    if (f.t <= t0) continue;
    if (f.t > to) break;
    if (f.health === 0 && prevHealth > 0) return { gained: false, died: true, at: f.t };
    if (f.health != null) prevHealth = f.health;
    if (f.carried > start.carried || (f.food != null && start.food != null && f.food + f.carried > start.food + start.carried)) return { gained: true, at: f.t };
  }
  return { gained: false };
}

function scan(dir, { since, until, port = null, replay = null } = {}) {
  const R = { files: 0, playMs: 0, time: {}, drain: {}, asks: [], answers: [], errands: [], drops: [], allAsks: 0 };
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.jsonl')) continue;
    if (port && !f.includes(`-${port}-Jev-`)) continue;
    const rec = readFile(path.join(dir, f), { since, until });
    if (!rec || (!rec.frames.length && !rec.asks.length)) continue;
    R.files++;
    // Time played, by bucket: each gap under two minutes to the frame before it.
    for (let i = 1; i < rec.frames.length; i++) {
      const a = rec.frames[i - 1], gap = rec.frames[i].t - a.t;
      if (gap <= 0 || gap > PLAY_GAP_MS || a.jevDown) continue;
      R.playMs += gap;
      for (const [k, v] of [['hunger', hungerBand(a.food)], ['health', healthBand(a.health)], ['carried', carriedBand(a.carried)], ['place', placeOf(a.dim, a.y)]]) {
        const o = (R.time[k] ||= {}); o[v] = (o[v] || 0) + gap;
      }
      if (cannotHeal(a)) R.time.cannotHeal = (R.time.cannotHeal || 0) + gap;
      // Hunger lost while playing, by place (the drain a plan is priced by).
      const b = rec.frames[i], pl = placeOf(a.dim, a.y);
      const dr = (R.drain[pl] ||= { lost: 0, ms: 0 }), all = (R.drain.all ||= { lost: 0, ms: 0 });
      const lost = a.food != null && b.food != null && b.food < a.food && b.health > 0 ? a.food - b.food : 0;
      dr.lost += lost; dr.ms += gap; all.lost += lost; all.ms += gap;
    }
    R.allAsks += rec.asks.length;
    const asks = rec.asks.filter(a => a.c);
    R.asks.push(...asks);
    // Each food answer, and the errands they make.
    let e = null;
    const close = (endAt, how) => {
      if (!e) return;
      e.end = endAt; e.how = how; e.minutes = round((endAt - e.from) / 60000);
      R.errands.push(e); e = null;
    };
    for (const a of rec.asks) {
      if (e && a.t - e.last > SPELL_GAP_MS) close(e.last + 30000, 'gap');
      if (e && !e.gainedAt) {
        // Gained or died since the last look.
        const o = outcome(rec.frames, e.from, e.start, a.t);
        if (o.gained) { e.gainedAt = o.at; close(o.at, 'gained'); }
        else if (o.died) close(o.at, 'died');
      }
      if (!a.c) continue;
      if (a.c.food) {
        const o = outcome(rec.frames, a.t, a);
        R.answers.push({ ...a, d: undefined, out: o });
        if (!e) e = { port: rec.port, file: rec.name, from: a.t, last: a.t, start: { food: a.food, health: a.health, carried: a.carried }, startPlace: placeOf(a.dim, a.y), asks: 0, ids: {}, fullStart: a.food >= 18 && a.health >= 20, reserveStart: a.food >= 18 || (a.carried > 0 && a.carried >= 18 - a.food), lowStart: cannotHeal(a), workOfferedAtStart: a.c.workOffered };
        e.last = a.t; e.asks++; e.ids[a.id] = (e.ids[a.id] || 0) + 1;
      } else if (a.c.work && e) {
        // The work taken over an errand under way that has gained nothing.
        if (cannotHeal(a)) {
          const back = rec.asks.find(b => b.t > a.t && b.c?.food);
          const o = outcome(rec.frames, a.t, a);
          const resumed = back && (!o.at || back.t < o.at) ? back.t : null;
          R.drops.push({ port: rec.port, at: new Date(a.t).toISOString(), q: a.id, answer: a.path.join('/'), health: round(a.health), food: a.food, place: placeOf(a.dim, a.y), errandAsks: e.asks, minutesToFoodAgain: resumed ? round((resumed - a.t) / 60000) : null, diedWithin10: !!o.died, gainedWithin10: !!o.gained });
        }
        close(a.t, 'work');
      }
    }
    if (e) { const o = outcome(rec.frames, e.from, e.start, e.last + SPELL_GAP_MS); if (o.gained) { e.gainedAt = o.at; close(o.at, 'gained'); } else close(o.died ? o.at : e.last + 30000, o.died ? 'died' : 'gap'); }
    if (replay) replay(rec, R);
  }
  return R;
}

function summarize(R) {
  const hours = R.playMs / 3600000;
  const perHour = (n, ms) => ms ? round(n / (ms / 3600000)) : null;
  const by = (list, f) => list.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  const rate = (k, f) => Object.fromEntries(Object.entries(R.time[k] || {}).sort().map(([v, ms]) => {
    const n = R.asks.filter(a => f(a) === v).length;
    return [v, { asks: n, botHours: round(ms / 3600000), aBotHour: perHour(n, ms) }];
  }));
  const ans = R.answers;
  const gained = l => ({ answers: l.length, gainedWithin10: l.filter(a => a.out.gained).length, died: l.filter(a => a.out.died).length, nothing: l.filter(a => !a.out.gained && !a.out.died).length });
  const dead = R.errands.filter(e => !e.gainedAt);
  const errandGroup = l => ({ errands: l.length, asks: sum(l.map(e => e.asks)), minutes: round(sum(l.map(e => e.minutes))), gainedNothing: l.filter(e => !e.gainedAt).length, deadMinutes: round(sum(l.filter(e => !e.gainedAt).map(e => e.minutes))), endedBy: by(l, e => e.how) });
  const full = ans.filter(a => a.food >= 18 && a.health >= 20 && a.c.workOffered);
  return {
    files: R.files, botHours: round(hours), asksAll: R.allAsks, asksAllABotHour: perHour(R.allAsks, R.playMs),
    foodQuestions: R.asks.length, foodQuestionsABotHour: perHour(R.asks.length, R.playMs),
    foodQuestionsById: by(R.asks, a => a.id),
    byHunger: rate('hunger', a => hungerBand(a.food)),
    byHealth: rate('health', a => healthBand(a.health)),
    byCarried: rate('carried', a => carriedBand(a.carried)),
    byPlace: rate('place', a => placeOf(a.dim, a.y)),
    cannotHeal: { asks: R.asks.filter(cannotHeal).length, botHours: round((R.time.cannotHeal || 0) / 3600000), foodAnswers: ans.filter(cannotHeal).length },
    foodAnswers: gained(ans),
    foodAnswersById: Object.fromEntries(Object.entries(by(ans, a => a.id)).map(([k]) => [k, gained(ans.filter(a => a.id === k))])),
    foodAnswersByLeaf: Object.fromEntries(Object.entries(by(ans, a => `${a.id} ${a.c.leaf}`)).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([k]) => [k, gained(ans.filter(a => `${a.id} ${a.c.leaf}` === k))])),
    foodAnswersByHunger: Object.fromEntries(['0-6', '7-12', '13-17', '18-20'].map(b => [b, gained(ans.filter(a => hungerBand(a.food) === b))])),
    foodAnswersByPlace: Object.fromEntries(Object.keys(by(ans, a => placeOf(a.dim, a.y))).map(b => [b, gained(ans.filter(a => placeOf(a.dim, a.y) === b))])),
    errands: errandGroup(R.errands),
    errandsGainedNothing: { errands: dead.length, minutes: round(sum(dead.map(e => e.minutes))), asks: sum(dead.map(e => e.asks)), byPlace: Object.fromEntries(Object.keys(by(dead, e => e.startPlace)).map(p => [p, round(sum(dead.filter(e => e.startPlace === p).map(e => e.minutes)))])) },
    errandsBegunFullWithWorkOffered: errandGroup(R.errands.filter(e => e.fullStart && e.workOfferedAtStart)),
    errandsBegunForTheReserveAlone: errandGroup(R.errands.filter(e => e.reserveStart)),
    errandsBegunWhereHealthCannotComeBack: errandGroup(R.errands.filter(e => e.lowStart)),
    // The work taken over an errand under way while health could not come back.
    droppedForWorkWhileHurt: { n: R.drops.length, byQuestion: by(R.drops, d => `${d.q} ${d.answer.replace(/_\d+$/, '_N')}`), byPlace: by(R.drops, d => d.place), diedWithin10: R.drops.filter(d => d.diedWithin10).length, foodGainedWithin10: R.drops.filter(d => d.gainedWithin10).length, neverBackToFoodWithin10: R.drops.filter(d => d.minutesToFoodAgain == null && !d.diedWithin10).length, examples: R.drops.slice(0, 12).map(d => `${d.port} ${d.at.slice(0, 19)} ${d.q} ${d.answer} at ${d.health} health, hunger ${d.food}, ${d.place}${d.diedWithin10 ? ', died within 10 min' : ''}`) },
    // The reverse: food answers at full hunger and health with the work on offer.
    foodOverWorkAtFull: { answers: full.length, byId: by(full, a => a.id), ...gained(full) },
    // Hunger lost a played hour, by place (food-plan.js DRAIN).
    hungerDrainAnHour: Object.fromEntries(Object.entries(R.drain).map(([k, v]) => [k, round(v.lost / Math.max(1e-9, v.ms / 3600000))])),
    // Each kind of way to food: answers, food within ten minutes, deaths, and
    // the median minutes to the food, by place (food-plan.js SOURCE_RECORD).
    sourceRecord: (() => {
      const out = {};
      for (const a of ans) {
        const k = sourceKind(a.c.leaf), pl = placeOf(a.dim, a.y);
        for (const key of [`${k}|all`, `${k}|${pl}`]) {
          const o = (out[key] ||= { answers: 0, food: 0, died: 0, mins: [] });
          o.answers++; if (a.out.gained) { o.food++; o.mins.push((a.out.at - a.t) / 60000); } if (a.out.died) o.died++;
        }
      }
      return Object.fromEntries(Object.entries(out).sort().map(([k, o]) => { const m = o.mins.sort((x, y) => x - y); return [k, { answers: o.answers, food: o.food, died: o.died, medianMinutes: m.length ? round(m[m.length >> 1]) : null }]; }));
    })(),
    longestDead: dead.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(e => `${e.port} ${new Date(e.from).toISOString().slice(0, 19)} ${e.minutes} min, ${e.asks} asks (${Object.entries(e.ids).map(([k, n]) => `${k} ${n}`).join(', ')}), hunger ${e.start.food}, health ${round(e.start.health)}, ${e.start.carried} carried, ${e.startPlace}, ended ${e.how}`),
  };
}

function report(dir, opts = {}) {
  const R = scan(dir, opts);
  return summarize(R);
}

module.exports = { report, scan, summarize, classify, outcome, cannotHeal, points, sourceKind, placeOf, hungerBand, FOOD_KEY, WORK_KEY, SPELL_GAP_MS };

if (require.main === module) {
  const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const opts = { since: Date.parse(arg('--since', '2026-09-30T12:00:00Z')), until: Date.parse(arg('--until', '2026-10-01T04:57:00Z')), port: arg('--port', null) };
  const dir = arg('--dir', path.join(ROOT, '.bot-state', 'flight'));
  const out = { since: new Date(opts.since).toISOString(), until: new Date(opts.until).toISOString() };
  if (argv.includes('--under784')) {
    const plan = require('../src/food-plan');
    const R = scan(dir, { ...opts, replay: plan.replayRecord });
    out.before = summarize(R);
    out.under784 = plan.replaySummary(R);
  } else Object.assign(out, report(dir, opts));
  console.log(JSON.stringify(out, null, 1));
}
