'use strict';
// Food errands in the flight records (note 761): every obtain_food win of
// survival_priority, by the hunger it was won at and whether safe food was
// carried; what the survival claim on turn_priority said when it won; and each
// errand (obtain_food wins no more than SPELL_GAP_MS apart) with what it cost:
// minutes, blocks climbed, hunger and food points at its start and end, and
// the wins taken after it was met (hunger 18 or more with safe food carried).
//   node scripts/food-errands.js [--since 2026-09-30T06:00Z] [--until ISO] [--port 25588] [--json] [--asks]
// --asks (note 784): the food questions a bot-hour by hunger, health, food
// carried and place; what came of each food answer within ten minutes; the
// errands that gained nothing; food errands dropped for the work while
// health could not come back, and errands at full hunger and health taken
// over the work (scripts/food-asks.js, also run alone).
// Read-only, one file at a time.
//
// Reserve errands (note 771): the wins taken for the reserve alone (hunger
// eighteen or more, or under it with food carried that brings it there),
// joined into errands the same way, each with its minutes, the food points
// it gained (the most carried within a minute after its last win, less what
// was carried at its first), its hunger and points at the start, whether it
// began underground or at night, and whether the work's own step was the
// food; and every walk to a herd seen (seen_food_N) that met "no route" to
// that herd within ten seconds, with how often the same herd was chosen
// again after.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-30T06:00:00Z'));
const until = Date.parse(arg('--until', '9999-01-01T00:00:00Z'));
const port = arg('--port', null);
const asJson = argv.includes('--json');
const dir = arg('--dir', path.join(ROOT, '.bot-state', 'flight'));
const SPELL_GAP_MS = 3 * 60000;
// The work's own steps that are the food for the Nether (work.js kitFoodStep, gatherNetherFood).
const FOOD_STEPS = new Set(['nether_food', 'hunt_food_for_nether', 'food_near_frame', 'food_known', 'cook_for_nether', 'fetch_food_from_stash', 'harvest_for_nether']);
const foods = Object.fromEntries(require('minecraft-data')('26.1').foodsArray.map(f => [f.name, f.foodPoints]));
const UNSAFE = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'suspicious_stew', 'chorus_fruit']);
const points = inv => Object.entries(inv || {}).reduce((n, [k, c]) => n + (foods[k] && !UNSAFE.has(k) ? c * foods[k] : 0), 0);
const band = h => h == null ? '?' : h <= 6 ? '0-6' : h <= 12 ? '7-12' : h <= 17 ? '13-17' : '18-20';
const BANDS = ['0-6', '7-12', '13-17', '18-20'];
const round = n => Math.round(n * 10) / 10;

const R = { files: 0, wins: [], claims: [], errands: [], reserve: [], herdWalks: [] };
const reserveOnly = (food, carried) => food >= 18 || (food < 18 && carried > 0 && carried >= 18 - food);

function readFile(file) {
  const name = path.basename(file), m = name.match(/-(\d{5})-Jev-/);
  const p = m ? m[1] : '?';
  if (port && p !== port) return;
  let text;
  try { if (fs.statSync(file).mtimeMs < since) return; text = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  R.files++;
  const frames = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); const at = Date.parse(r.at); if (at >= since && at <= until) frames.push({ at, kind: r.kind, s: r.snapshot, detail: r.detail }); } catch (_) { /* a torn line */ }
  }
  frames.sort((a, b) => a.at - b.at);
  // The positions over time, for the climb.
  const ys = frames.filter(f => f.s?.position && Number.isFinite(f.s.position.y)).map(f => ({ at: f.at, y: f.s.position.y, dim: f.s.dimension }));
  let spell = null;
  const close = () => {
    if (!spell) return;
    const inside = ys.filter(p => p.at >= spell.from && p.at <= spell.to + 30000);
    let climbed = 0;
    for (let i = 1; i < inside.length; i++) if (inside[i].dim === inside[i - 1].dim) climbed += Math.max(0, inside[i].y - inside[i - 1].y);
    R.errands.push({ ...spell, minutes: round((spell.to - spell.from) / 60000), climbed: Math.round(climbed) });
    spell = null;
  };
  // The food points carried over time, for what a reserve errand gained.
  const carriedAt = frames.filter(f => f.s?.inventory).map(f => ({ at: f.at, n: points(f.s.inventory) }));
  let rspell = null;
  const rclose = () => {
    if (!rspell) return;
    const after = carriedAt.filter(c => c.at >= rspell.from && c.at <= rspell.to + 60000);
    const peak = after.reduce((n, c) => Math.max(n, c.n), rspell.startCarried);
    const inside = ys.filter(p => p.at >= rspell.from && p.at <= rspell.to + 30000);
    let climbed = 0;
    for (let i = 1; i < inside.length; i++) if (inside[i].dim === inside[i - 1].dim) climbed += Math.max(0, inside[i].y - inside[i - 1].y);
    R.reserve.push({ ...rspell, minutes: round((rspell.to - rspell.from) / 60000 + 0.5), gained: Math.max(0, peak - rspell.startCarried), climbed: Math.round(climbed) });
    rspell = null;
  };
  // Walks to a herd seen that met no route to it.
  const noRoutes = frames.filter(f => f.kind === 'no_route' && f.detail?.goal);
  for (const f of frames) {
    const d0 = f.s?.decision;
    if (f.kind !== 'decision' || d0?.id !== 'survival_priority' || d0.path?.[0] !== 'obtain_food' || !/^seen_food_\d+$/.test(String(d0.path.at(-1)))) continue;
    const t = Date.parse(d0.at), leaf = d0.path.at(-1), target = d0.options?.obtain_food?.children?.[leaf]?.target || null;
    const miss = noRoutes.find(n => n.at >= t && n.at <= t + 10000);
    R.herdWalks.push({ port: p, at: d0.at, leaf, target, noRoute: !!miss, goal: miss?.detail?.goal || null, y: f.s.position?.y });
  }
  for (const f of frames) {
    const d = f.s?.decision;
    if (f.kind !== 'decision' || !d) continue;
    const s = f.s, food = s.food, carried = points(s.inventory);
    if (d.id === 'turn_priority' && d.path?.[0] === 'survival') {
      const claim = d.options?.survival?.description;
      if (claim?.action === 'obtain_food') R.claims.push({ port: p, at: d.at, food, health: s.health, carried, does: claim.does, dim: s.dimension });
    }
    if (d.id !== 'survival_priority' || d.path?.[0] !== 'obtain_food') continue;
    const text = String(d.options?.obtain_food?.description || '');
    // The words before note 761, and after it.
    const mode = /no hunger to meet|This tops up the reserve\./.test(text) ? 'top-up'
      : /fills it|Eating what is carried meets that|[Ee]at what is carried/.test(text) ? 'hunger, carried covers it'
        : /does not fill|This is for the hunger\./.test(text) ? 'hungry, carried short'
          : /for the hunger and the reserve/.test(text) ? 'under 18, reserve' : 'other';
    const win = { port: p, at: d.at, food, health: s.health, carried, leaf: d.path.at(-1), mode, y: s.position?.y, dim: s.dimension, step: s.goal?.step?.action || null, workOffered: !!d.options?.continue_request, desired: d.state?.foodReserve?.desiredMinimum ?? null };
    R.wins.push(win);
    const t = Date.parse(d.at);
    if (spell && t - spell.to > SPELL_GAP_MS) close();
    if (!spell) spell = { port: p, file: name, from: t, to: t, startFood: food, startCarried: carried, startY: s.position?.y, dim: s.dimension, wins: 0, leaves: new Set(), metAt: null, afterMet: 0 };
    spell.to = t; spell.wins++; spell.leaves.add(win.leaf.replace(/_\d+$/, '_N'));
    spell.endFood = food; spell.endCarried = carried;
    const met = food >= 18 && carried > 0;
    if (met) { if (!spell.metAt) spell.metAt = t; spell.afterMet++; }
    if (reserveOnly(food, carried)) {
      if (rspell && t - rspell.to > SPELL_GAP_MS) rclose();
      if (!rspell) rspell = { port: p, from: t, to: t, startFood: food, startCarried: carried, health: s.health, wins: 0, underground: !!d.state?.survivalFacts?.underground, night: Number.isFinite(d.state?.timeOfDay) ? d.state.timeOfDay >= 11500 && d.state.timeOfDay < 23000 : null, workFood: FOOD_STEPS.has(win.step), desired: d.state?.foodReserve?.desiredMinimum ?? null };
      rspell.to = t; rspell.wins++;
    }
  }
  close(); rclose();
}

for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) readFile(path.join(dir, f));

const byBand = list => Object.fromEntries(BANDS.map(b => [b, list.filter(w => band(w.food) === b).length]));
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const sum = a => a.reduce((n, v) => n + v, 0);
const out = {
  since: new Date(since).toISOString(), ...(until < 1e15 ? { until: new Date(until).toISOString() } : {}), files: R.files,
  obtainFoodWins: R.wins.length,
  winsByHunger: byBand(R.wins),
  winsByHungerCarrying: byBand(R.wins.filter(w => w.carried > 0)),
  winsByMode: R.wins.reduce((o, w) => (o[w.mode] = (o[w.mode] || 0) + 1, o), {}),
  winsTopUpUnder18: R.wins.filter(w => w.mode === 'top-up' && w.food < 18).length,
  winsCarriedCoversHunger: R.wins.filter(w => w.food < 18 && w.carried >= 18 - w.food).length,
  winsCarriedCoversHungerFullHealth: R.wins.filter(w => w.food < 18 && w.carried >= 18 - w.food && w.health >= 20).length,
  winsMet: R.wins.filter(w => w.food >= 18 && w.carried > 0).length,
  winsInNether: R.wins.filter(w => w.dim === 'the_nether').length,
  winsInNetherAt18: R.wins.filter(w => w.dim === 'the_nether' && w.food >= 18).map(w => `${w.port} ${w.at} ${w.leaf} hunger ${w.food} hp ${round(w.health)}`),
  winsOverWorkFoodStep: R.wins.filter(w => FOOD_STEPS.has(w.step)).length,
  claimWins: R.claims.length,
  claimWinsMet: R.claims.filter(c => c.food >= 18 && c.carried > 0).length,
  claimWinsByHunger: byBand(R.claims),
  errands: R.errands.length,
  errandsByStartHunger: byBand(R.errands.map(e => ({ food: e.startFood }))),
  errandMinutes: { total: round(sum(R.errands.map(e => e.minutes))), median: median(R.errands.map(e => e.minutes)) },
  errandClimbed: { total: sum(R.errands.map(e => e.climbed)), median: median(R.errands.map(e => e.climbed)) },
  errandsStartedAt13to17: (() => { const l = R.errands.filter(e => e.startFood >= 13 && e.startFood <= 17); return { n: l.length, minutes: round(sum(l.map(e => e.minutes))), climbed: sum(l.map(e => e.climbed)) }; })(),
  errandsMetThenReAsked: (() => { const l = R.errands.filter(e => e.afterMet > 0); return { n: l.length, winsAfterMet: sum(l.map(e => e.afterMet)), minutesAfterMet: round(sum(l.map(e => (e.to - e.metAt) / 60000))) }; })(),
  longest: R.errands.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 8).map(e => `${e.port} ${new Date(e.from).toISOString().slice(11, 19)} ${e.minutes} min, ${e.wins} wins, climbed ${e.climbed}, hunger ${e.startFood}->${e.endFood}, points ${e.startCarried}->${e.endCarried}, ${[...e.leaves].join('/')}`),
};
// Reserve errands (note 771), by the hunger they began at and whether food was carried.
const reserveGroup = l => ({ errands: l.length, wins: sum(l.map(e => e.wins)), minutes: round(sum(l.map(e => e.minutes))), gainedNothing: l.filter(e => !e.gained).length,
  pointsGained: sum(l.map(e => e.gained)), pointsAMinute: round(sum(l.map(e => e.gained)) / Math.max(0.1, sum(l.map(e => e.minutes)))), medianMinutes: median(l.map(e => e.minutes)), climbed: sum(l.map(e => e.climbed)) });
out.reserveErrands = {
  all: reserveGroup(R.reserve),
  hunger18to20NothingCarried: reserveGroup(R.reserve.filter(e => e.startFood >= 18 && !e.startCarried)),
  hunger18to20FoodCarried: reserveGroup(R.reserve.filter(e => e.startFood >= 18 && e.startCarried > 0)),
  under18Covered: reserveGroup(R.reserve.filter(e => e.startFood < 18)),
  underground: reserveGroup(R.reserve.filter(e => e.underground)),
  undergroundAtNight: reserveGroup(R.reserve.filter(e => e.underground && e.night)),
  overTheWorksFoodStep: reserveGroup(R.reserve.filter(e => e.workFood)),
  forTheNightReserve: reserveGroup(R.reserve.filter(e => e.desired != null && e.desired < 80)),
  forTheNetherReserve: reserveGroup(R.reserve.filter(e => e.desired >= 80)),
  longest: R.reserve.slice().sort((a, b) => b.minutes - a.minutes).slice(0, 6).map(e => `${e.port} ${new Date(e.from).toISOString().slice(11, 19)} ${e.minutes} min, ${e.wins} wins, hunger ${e.startFood}, ${e.startCarried} carried, gained ${e.gained}${e.underground ? ', underground' : ''}${e.night ? ', night' : ''}`),
};
// Under note 771's rules, on the same wins: a reserve-only win over the
// work's own food step, or for the crossing's reserve (64 points or more
// wanted: the Nether's or the End's), is not asked (the ladder's food rung
// has it); every other reserve-only win is asked with the work on offer.
const rWins = R.wins.filter(w => reserveOnly(w.food, w.carried) && w.dim !== 'the_nether');
const workHasIt = w => FOOD_STEPS.has(w.step) || w.desired >= 64;
out.under771 = { reserveOnlyWins: rWins.length, notAskedWorkHasIt: rWins.filter(workHasIt).length, ofThemOverTheFoodStep: rWins.filter(w => FOOD_STEPS.has(w.step)).length,
  askedWithoutTheWorkBefore: rWins.filter(w => !workHasIt(w) && !w.workOffered).length, askedWithTheWorkBefore: rWins.filter(w => !workHasIt(w) && w.workOffered).length };
// The herd walks that met no route, and the same herd chosen again after.
const missed = R.herdWalks.filter(w => w.noRoute);
out.herdWalks = { walks: R.herdWalks.length, noRoute: missed.length,
  chosenAgainAfterNoRoute: missed.filter(w => R.herdWalks.some(o => o.port === w.port && o.leaf === w.leaf && Date.parse(o.at) > Date.parse(w.at) && Date.parse(o.at) - Date.parse(w.at) <= 10 * 60000)).length,
  noRouteAgainSameHerd: missed.filter(w => missed.some(o => o !== w && o.port === w.port && o.leaf === w.leaf && Date.parse(o.at) > Date.parse(w.at) && Date.parse(o.at) - Date.parse(w.at) <= 10 * 60000)).length,
  noRouteHerdAboveBy20: missed.filter(w => w.goal && Number.isFinite(w.y) && w.goal.y - w.y >= 20).length };
// Note 784: every food question and answer, and what came of the answers.
if (argv.includes('--asks')) out.asks = require('./food-asks').report(dir, { since, until, port });
if (asJson) console.log(JSON.stringify({ ...out, wins: R.wins, claims: R.claims }, null, 1));
else console.log(JSON.stringify(out, null, 1));
