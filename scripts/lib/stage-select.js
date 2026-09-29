'use strict';
// Which stage save a trial starts from (scripts/trials/start-stage.sh). The
// saves are kept by checkpoint.sh the first time a trial reaches the Nether
// or a fortress, and the old pick, "the one least started from", was
// misleading in three ways (design review, 2026-09-28): the 28 fortress
// saves came from about 12 worlds (several a few minutes apart in one), about
// 40% were saved at hunger 17 or lower, where health does not come back in
// the Nether, carrying two raw mutton, and so those starts measured the
// starting state more than the bot.
//
// Selection only: the saves are read, never edited, and nothing is added to
// a start. The health, hunger and food carried come from the world's own
// player data (world/players/data/<uuid>.dat), which is what the server
// loads: the bot's state files do not hold them.
//
// The rule (fortress and nether stages alike unless said):
//   1. prefer saves at health 20 and hunger 18 or more (health comes back
//      only at 18 or more) carrying at least MIN_FOOD food points (fortress
//      stage only: the nether stage is kept on arrival, before a fortress
//      stay's stock is wanted),
//   2. of those, take the source world with the fewest trials running now,
//      then the fewest starts so far (a save's
//      source world is the world it came from, whatever nether or fortress
//      trial it was kept in), then within it the save least started from,
//      so every source world starts once before one repeats;
//   3. if fewer than MIN_QUALIFYING saves qualify for a fortress start, fall
//      back to the nether stage's saves, by the same rule;
//   4. STAGE_ANY=1 keeps the old pick: the least started save, whatever it
//      carried or came from.
// Two more (note 641), from the eight deaths in an hour on
// mid-242-bb-nether-1-215842: a save the bot was taken on, standing on a span
// one block wide over lava, was 7 deaths in 8 starts, five of them a ghast's
// fireball pushing it off in the first thirteen minutes, and every start from
// it measured that one place; and three saves of one map take every start
// when only they qualify.
//   5. a save whose player stands on a span one or two blocks wide with lava
//      at the bottom of a drop of three or more (or a drop of 23 or more) is
//      not a start (save-spot.js
//      reads it from the world files; where it cannot, the save counts);
//   6. a save started MAX_PER_HOUR times in the last hour rests (starts are
//      logged in .trial-checkpoints/stage-starts.log by start-stage.sh, not in
//      the saves), so a pool of a few saves gives way to the nether stage's
//      instead of taking every start.
//   7. two-arm trials (note 666, scripts/lib/arms.js): a start asked for on
//      one arm takes first the save another arm started (asked as the same
//      stage) in the last six hours and this arm has not, so each pick is
//      started once per arm and the arms play the same saves.
const fs = require('node:fs');
const path = require('node:path');

const MIN_HEALTH = 20, MIN_HUNGER = 18, MIN_FOOD = 40, MIN_QUALIFYING = 3;
// Starts of one save in an hour after which it rests (STAGE_MAX_PER_HOUR).
const MAX_PER_HOUR = 4, HOUR_MS = 3600000;
const { spotOf, spotSays } = require('./save-spot');
// Foods that are not food to a bot that wants health back.
const NOT_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew']);

let foodsTable;
function foods() {
  if (foodsTable) return foodsTable;
  foodsTable = {};
  for (const version of ['1.21.11', '1.21.4', '1.21']) {
    try { const data = require('minecraft-data')(version); if (data?.foodsByName) { for (const [name, f] of Object.entries(data.foodsByName)) foodsTable[name] = f.foodPoints; break; } } catch (_) { /* next */ }
  }
  return foodsTable;
}

// 'mid-242-ba-nether-2-fortress-1-124020' -> '242-ba': the world the save came
// from, through any chain of trials begun at an earlier save (-nether-2,
// -fortress-6) and without the save's clock time.
const sourceWorld = name => String(name).replace(/^mid-/, '').replace(/-\d{6}$/, '').replace(/(-(nether|fortress)-\d+)+$/, '');

// The food points carried: each stack's count times the food's points.
function foodPoints(inventory, table = foods()) {
  let points = 0; const items = {};
  for (const it of inventory || []) {
    const name = String(it.id || '').replace('minecraft:', '');
    if (NOT_FOOD.has(name) || !(table[name] > 0)) continue;
    points += table[name] * (it.count || 1); items[name] = (items[name] || 0) + (it.count || 1);
  }
  return { points, items };
}

// The player data of a save, parsed: { health, hunger, saturation, foodPoints,
// foods, dimension }, or { error } where it cannot be read.
async function vitalsOf(snapshotDir, { nbt = require('prismarine-nbt') } = {}) {
  const dir = path.join(snapshotDir, 'world', 'players', 'data');
  let file;
  try { file = fs.readdirSync(dir).filter(f => f.endsWith('.dat')).sort()[0]; } catch (_) { return { error: 'no player data' }; }
  if (!file) return { error: 'no player data' };
  try {
    const { parsed } = await nbt.parse(fs.readFileSync(path.join(dir, file)));
    const p = nbt.simplify(parsed), f = foodPoints(p.Inventory);
    const [x, y, z] = Array.isArray(p.Pos) ? p.Pos : [];
    return { health: p.Health, hunger: p.foodLevel, saturation: Math.round((p.foodSaturationLevel ?? 0) * 10) / 10, foodPoints: f.points, foods: f.items, dimension: String(p.Dimension || '').replace('minecraft:', ''), position: [x, y, z].every(Number.isFinite) ? { x, y, z } : null };
  } catch (err) { return { error: String(err.message).slice(0, 80) }; }
}

// Why a save does not qualify (an empty list: it does). Food is asked only of
// the fortress stage.
function shortfalls(v, { stage = 'fortress', minFood = MIN_FOOD } = {}) {
  if (!v || v.error) return [v?.error || 'unread'];
  const out = [];
  if (!(v.health >= MIN_HEALTH)) out.push(`health ${Math.round(v.health * 10) / 10} (under ${MIN_HEALTH})`);
  if (!(v.hunger >= MIN_HUNGER)) out.push(`hunger ${v.hunger} (under ${MIN_HUNGER})`);
  if (stage === 'fortress' && !(v.foodPoints >= minFood)) out.push(`${v.foodPoints} food points (under ${minFood})`);
  return out;
}

// Why a save is not a start beyond its vitals (an empty list: none): where the
// player stands, and how often it was started from in the hour before.
function placeShortfalls(s, { maxPerHour = MAX_PER_HOUR } = {}) {
  const out = [];
  const says = spotSays(s.spot);
  if (says) out.push(says);
  if (maxPerHour > 0 && (s.recent || 0) >= maxPerHour) out.push(`started ${s.recent} times in the last hour (rests at ${maxPerHour})`);
  return out;
}
const allShortfalls = (s, opts = {}) => [...shortfalls(s.vitals, { stage: s.stage, minFood: opts.minFood ?? MIN_FOOD }), ...placeShortfalls(s, opts)];

// The starts of each save in the hour before `now`, from the log
// start-stage.sh appends to: "<ISO time>\t<stage>\t<save name>" a line.
function recentStarts(root, now = Date.now()) {
  const by = {};
  let text = ''; try { text = fs.readFileSync(path.join(root, '.trial-checkpoints', 'stage-starts.log'), 'utf8'); } catch (_) { return by; }
  for (const line of text.split('\n')) {
    const [at, stage, name] = line.split('\t');
    const t = Date.parse(at);
    if (name && Number.isFinite(t) && now - t >= 0 && now - t < HOUR_MS) by[`${stage}/${name}`] = (by[`${stage}/${name}`] || 0) + 1;
  }
  return by;
}

// The logged starts as pairing starts (two-arm trials, note 666): a line
// with an arm ("<ISO time>\t<stage>\t<save>\t<arm>\t<stage asked for>") is
// { t, key: '<asked>|<stage>/<save>', arm }; older lines carry no arm and
// are not paired.
function pairingStarts(root) {
  let text = ''; try { text = fs.readFileSync(path.join(root, '.trial-checkpoints', 'stage-starts.log'), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const [at, stage, name, arm, asked] = line.split('\t');
    const t = Date.parse(at);
    if (name && arm && Number.isFinite(t)) out.push({ t, key: `${asked || stage}|${stage}/${name}`, arm });
  }
  return out;
}

// The start this arm owes another (arms.js owed, keyed as pairingStarts), for
// a start asked as `stage`: the same save, whatever its hourly rest says (the
// pair is the point), unless it is gone or its player stands on a span.
function pairPick(stages, stage, owedKeys = []) {
  for (const { key, since } of owedKeys) {
    const [asked, rest] = key.split('|');
    if (asked !== stage || !rest) continue;
    const [st, name] = rest.split('/');
    const s = (stages[st] || []).find(x => x.name === name);
    if (!s || spotSays(s.spot)) continue;
    return { snapshot: s, stage: st, rule: 'pair', why: `the other arm started ${name} (${st} stage) at ${new Date(since).toISOString()} and this arm has not yet: started once per arm, so both arms play the same saves` };
  }
  return null;
}

// The snapshots of a stage, each { name, dir, stage, source, started, recent,
// spot, vitals }.
async function readStage(root, stage, { vitals = vitalsOf, spot = spotOf, now = Date.now() } = {}) {
  const base = path.join(root, '.trial-checkpoints', 'stages', stage);
  let names = [];
  try { names = fs.readdirSync(base).sort(); } catch (_) { return []; }
  const out = [], recent = recentStarts(root, now);
  for (const name of names) {
    const dir = path.join(base, name);
    if (!fs.existsSync(path.join(dir, 'world')) || !fs.existsSync(path.join(dir, 'state'))) continue;
    let started = 0; try { started = Number(fs.readFileSync(path.join(dir, 'started'), 'utf8').trim()) || 0; } catch (_) { /* never */ }
    let last = 0; try { last = fs.statSync(path.join(dir, 'started')).mtimeMs; } catch (_) { /* never */ }
    const v = await vitals(dir);
    out.push({ name, dir, stage, source: sourceWorld(name), started, last, recent: recent[`${stage}/${name}`] || 0, vitals: v, spot: v && !v.error ? spot(dir, v) : null });
  }
  return out;
}

// Starts so far by source world: the sum over that world's saves.
function worldStarts(snaps) {
  const by = {};
  for (const s of snaps) by[s.source] = (by[s.source] || 0) + s.started;
  return by;
}

// The source worlds of the trials running now, a count each: the world each
// listening trial server holds, by its level-name (a trial name such as
// mid-242-ee-fortress-9 has the source world 242-ee). Lifetime starts alone
// sent four of seven fortress starts made in a row to one world
// (2026-09-29, 242-ee was the least started), and nine of ten blaze blows
// that killed overnight came in one spawner room: one world's room measured,
// not the bot.
function runningSources(root, { exceptPort = null, listening = portListening } = {}) {
  const by = {};
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter(d => /^\.clean-run(-\d+)?$/.test(d)); } catch (_) { return by; }
  for (const d of dirs) {
    let props = '';
    try { props = fs.readFileSync(path.join(root, d, 'server.properties'), 'utf8'); } catch (_) { continue; }
    const port = Number((props.match(/^server-port=(\d+)/m) || [])[1]);
    const level = (props.match(/^level-name=(.+)$/m) || [])[1];
    if (!port || !level || !/^mid-/.test(level) || port === Number(exceptPort) || !listening(port)) continue;
    const src = sourceWorld(level);
    by[src] = (by[src] || 0) + 1;
  }
  return by;
}
function portListening(port) {
  const r = require('node:child_process').spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 && !!String(r.stdout || '').trim();
}

// The rotation over a set of saves: the source world with the fewest trials
// running now, then the fewest starts (the one started longest ago on a tie),
// then its save least started from (the one carrying most food, then the
// later save, on a tie).
function rotate(pool, all = pool, running = {}) {
  const starts = worldStarts(all), lastBy = {};
  for (const s of all) lastBy[s.source] = Math.max(lastBy[s.source] || 0, s.last);
  const now = w => running[w] || 0;
  const worlds = [...new Set(pool.map(s => s.source))].sort((a, b) => now(a) - now(b) || starts[a] - starts[b] || lastBy[a] - lastBy[b] || (a < b ? -1 : 1));
  const inWorld = pool.filter(s => s.source === worlds[0]).sort((a, b) => a.started - b.started || (b.vitals.foodPoints || 0) - (a.vitals.foodPoints || 0) || (a.name < b.name ? 1 : -1));
  return inWorld[0];
}

// The pick for a stage: { snapshot, stage, rule, why } or { error }.
// `stages` maps a stage name to its snapshots (fortress needs nether too).
function choose(stages, stage, { any = false, minQualifying = MIN_QUALIFYING, minFood = MIN_FOOD, maxPerHour = MAX_PER_HOUR, owedKeys = [], running = {} } = {}) {
  const own = stages[stage] || [];
  const paired = pairPick(stages, stage, owedKeys);
  if (paired) return paired;
  if (any) {
    const best = [...own].sort((a, b) => a.started - b.started || (a.name < b.name ? -1 : 1))[0];
    return best ? { snapshot: best, stage, rule: 'any', why: `STAGE_ANY: the least started ${stage} save (${best.started} starts), whatever it carried or came from` } : { error: `no usable ${stage} snapshot` };
  }
  const qualifying = pool => pool.filter(s => !allShortfalls(s, { minFood, maxPerHour }).length);
  const good = qualifying(own);
  // What kept saves out beyond health, hunger and food, said with the pick.
  const kept = (pool, label = stage) => {
    const fit = pool.filter(s => !shortfalls(s.vitals, { stage: s.stage, minFood }).length);
    const span = fit.filter(s => spotSays(s.spot)).length, rest = maxPerHour > 0 ? fit.filter(s => (s.recent || 0) >= maxPerHour).length : 0;
    const t = [span && `${span} on a span over lava or a deadly drop`, rest && `${rest} resting after ${maxPerHour} starts in the hour`].filter(Boolean).join(', ');
    return t ? ` (${label} stage: ${t} left out)` : '';
  };
  // Where no save qualifies the start is still made, but from a save that is
  // not on a span or resting when there is one.
  const off = pool => { const ok = pool.filter(s => !placeShortfalls(s, { maxPerHour }).length); return ok.length ? ok : pool; };
  const describe = (s, pool) => `${s.name} from world ${s.source}, ${running[s.source] || 0} running now, ${worldStarts(pool)[s.source]} starts in it so far: health ${s.vitals.health}, hunger ${s.vitals.hunger}, ${s.vitals.foodPoints} food points; ${new Set(pool.map(x => x.source)).size} source worlds in the pool`;
  if (good.length >= (stage === 'fortress' ? minQualifying : 1)) {
    const pick = rotate(good, own, running);
    return { snapshot: pick, stage, rule: 'qualifying', why: `${good.length} of ${own.length} ${stage} saves were saved at health ${MIN_HEALTH}, hunger ${MIN_HUNGER} or more${stage === 'fortress' ? ` and ${minFood}+ food points` : ''}; took the source world with the fewest trials running, then started least (${describe(pick, good)})${kept(own)}` };
  }
  if (stage === 'fortress') {
    const nether = stages.nether || [], ng = qualifying(nether);
    const why = `only ${good.length} of ${own.length} fortress saves qualify (needs ${minQualifying}); fell back to the nether stage${kept(own)}`;
    if (ng.length) { const pick = rotate(ng, nether, running); return { snapshot: pick, stage: 'nether', rule: 'fallback-nether', why: `${why}: ${ng.length} of ${nether.length} nether saves at health ${MIN_HEALTH}, hunger ${MIN_HUNGER} or more; took the source world with the fewest trials running, then started least (${describe(pick, ng)})${kept(nether, 'nether')}` }; }
    if (nether.length) { const pick = rotate(off(nether), nether, running); return { snapshot: pick, stage: 'nether', rule: 'fallback-nether-any', why: `${why}, and no nether save qualifies either: took the source world with the fewest trials running, then started least (${describe(pick, nether)})` }; }
    if (own.length) { const pick = rotate(off(own), own, running); return { snapshot: pick, stage, rule: 'none-qualify', why: `${why}, and there are no nether saves: took the source world with the fewest trials running, then started least among all fortress saves (${describe(pick, own)})` }; }
    return { error: 'no usable fortress snapshot' };
  }
  if (own.length) { const pick = rotate(off(own), own, running); return { snapshot: pick, stage, rule: 'none-qualify', why: `no ${stage} save at health ${MIN_HEALTH} and hunger ${MIN_HUNGER} or more: took the source world with the fewest trials running, then started least (${describe(pick, own)})` }; }
  return { error: `no usable ${stage} snapshot` };
}

// The listing: one row per save, the rotation's order marked.
function listing(stages, stage, opts = {}) {
  const own = stages[stage] || [], lines = [];
  const starts = worldStarts(own);
  const order = [...own].sort((a, b) => starts[a.source] - starts[b.source] || a.started - b.started);
  const pick = choose(stages, stage, opts);
  lines.push(`${stage}: ${own.length} saves from ${new Set(own.map(s => s.source)).size} source worlds`);
  const rows = [['snapshot', 'source', 'health', 'hunger', 'food pts', 'started', 'last hour', 'world starts', 'qualifies']];
  for (const s of order) {
    const v = s.vitals, why = allShortfalls(s, opts);
    rows.push([s.name + (pick.snapshot === s ? ' <- next' : ''), s.source, v.error ? '?' : String(Math.round(v.health * 10) / 10), v.error ? '?' : String(v.hunger), v.error ? '?' : String(v.foodPoints), String(s.started), String(s.recent || 0), String(starts[s.source]), why.length ? 'no: ' + why.join('; ') : 'yes']);
  }
  const width = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
  for (const r of rows) lines.push(r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd());
  const q = own.filter(s => !allShortfalls(s, opts).length);
  lines.push(`${q.length} of ${own.length} qualify (health ${MIN_HEALTH}, hunger ${MIN_HUNGER}+${stage === 'fortress' ? `, ${opts.minFood ?? MIN_FOOD}+ food points` : ''}), from ${new Set(q.map(s => s.source)).size} of ${new Set(own.map(s => s.source)).size} source worlds`);
  lines.push(pick.error ? pick.error : `next start: ${pick.snapshot.name} (${pick.stage}; rule ${pick.rule}): ${pick.why}`);
  return lines.join('\n');
}

module.exports = { runningSources, sourceWorld, foodPoints, vitalsOf, shortfalls, placeShortfalls, allShortfalls, recentStarts, pairingStarts, pairPick, readStage, worldStarts, rotate, choose, listing, MIN_HEALTH, MIN_HUNGER, MIN_FOOD, MIN_QUALIFYING, MAX_PER_HOUR };
