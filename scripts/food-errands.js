'use strict';
// Food errands in the flight records (note 761): every obtain_food win of
// survival_priority, by the hunger it was won at and whether safe food was
// carried; what the survival claim on turn_priority said when it won; and each
// errand (obtain_food wins no more than SPELL_GAP_MS apart) with what it cost:
// minutes, blocks climbed, hunger and food points at its start and end, and
// the wins taken after it was met (hunger 18 or more with safe food carried).
//   node scripts/food-errands.js [--since 2026-09-30T06:00Z] [--until ISO] [--port 25588] [--json]
// Read-only, one file at a time.
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

const R = { files: 0, wins: [], claims: [], errands: [] };

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
    try { const r = JSON.parse(line); const at = Date.parse(r.at); if (at >= since && at <= until) frames.push({ at, kind: r.kind, s: r.snapshot }); } catch (_) { /* a torn line */ }
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
    const mode = /no hunger to meet/.test(text) ? 'top-up' : /fills it/.test(text) ? 'hungry, carried fills it' : /does not fill/.test(text) ? 'hungry, carried short' : 'other';
    const win = { port: p, at: d.at, food, health: s.health, carried, leaf: d.path.at(-1), mode, y: s.position?.y, dim: s.dimension, step: s.goal?.step?.action || null };
    R.wins.push(win);
    const t = Date.parse(d.at);
    if (spell && t - spell.to > SPELL_GAP_MS) close();
    if (!spell) spell = { port: p, file: name, from: t, to: t, startFood: food, startCarried: carried, startY: s.position?.y, dim: s.dimension, wins: 0, leaves: new Set(), metAt: null, afterMet: 0 };
    spell.to = t; spell.wins++; spell.leaves.add(win.leaf.replace(/_\d+$/, '_N'));
    spell.endFood = food; spell.endCarried = carried;
    const met = food >= 18 && carried > 0;
    if (met) { if (!spell.metAt) spell.metAt = t; spell.afterMet++; }
  }
  close();
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
if (asJson) console.log(JSON.stringify({ ...out, wins: R.wins, claims: R.claims }, null, 1));
else console.log(JSON.stringify(out, null, 1));
