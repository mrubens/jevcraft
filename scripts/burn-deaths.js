#!/usr/bin/env node
'use strict';
// Every Nether death by lava or fire, read by the thirty seconds before it
// (note 792): how the bot got into the lava or alight (a push off its
// footing and by what, its own walk, a fall, a blaze's or a ghast's
// fireball, a flame stood or walked into), what held the turn, whether the
// pathfinder was walking, whether the way out ran (the lava escape, the run
// out of fire) and what came of it; then every run out of fire in the
// window (vitals.js outOfFire, one held-key move a cell): how many never
// moved, with the shield's hold on or not, and each such run replayed on the
// trial's saved ground with the bot's own code (the route, the held-key
// move, the game's physics; the keys let go every half second as the hurt
// watchdog and the shield's hold let them go) to see whether it now leaves
// the flames. Read-only: the flight records and the saved worlds.
//
//   JEV_ROOT=~/Code/jevcraft node scripts/burn-deaths.js [--since ISO] [--to ISO] [--list] [--json out.json] [--no-replay]
//   ... --cut <port> <world> <x> <y> <z> <r> <dy-below> <dy-above> > fixture.json   (a test fixture from a save)
// The default window is 2026-09-30T06:00Z to 2026-10-01T04:57:47Z, the
// window of note 791 (TypeSafe's credits ran out at its end, note 781).
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = process.env.JEV_ROOT ? path.resolve(process.env.JEV_ROOT) : path.join(__dirname, '..');
const FLIGHT = path.join(ROOT, '.bot-state', 'flight');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SINCE = Date.parse(arg('--since', '2026-09-30T06:00:00Z')), TO = Date.parse(arg('--to', '2026-10-01T04:57:47Z'));
const WINDOW_MS = 30000, RING_MS = 45000, CHAIN_GAP_MS = 3000, STUCK_MS = 1000, STUCK_BLOCKS = 0.5;
const round = (n, k = 1) => n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** k) / 10 ** k;
const median = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const tally = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const BURN = /^hurt: (lava|on fire|in fire)$/;
const CLOSING = /^(charge_nearest|charge|charge_shooter|close_in|fight|fight_at_spawner|fight_from_footing|rail_and_fight|strike_from_above|shield_the_charge|break_spawner|dig_in_and_fight|rise_to_strike|defend|stalk_mob|crit_jump)$/;

// What killed, by the last hurts (nether-kit.js's reading, note 791).
function killerOf(hurts) {
  const by = h => {
    const c = `${h.type} ${h.cause} ${h.direct}`;
    if (/lava/.test(c)) return 'lava';
    if (/fall/.test(c)) return 'fall';
    if (/blaze|small_fireball/.test(c)) return 'blaze';
    if (/wither_skeleton|wither\b/.test(c)) return 'wither skeleton';
    if (/ghast|fireball/.test(c)) return 'ghast';
    const m = c.match(/(zombified_piglin|piglin_brute|piglin|hoglin|magma_cube|skeleton|zombie|enderman)/);
    if (m) return m[1];
    if (/on_fire|in_fire/.test(c)) return 'fire';
    return h.type || '?';
  };
  const ks = hurts.slice(-3).map(by);
  if (ks.at(-1) === 'fire' && ks.includes('blaze')) return 'blaze';
  return ks.at(-1) || '?';
}

function compact(r, t) {
  const s = r.snapshot || {};
  const f = { t, kind: r.kind, label: r.label || '', pos: s.position || null, onGround: s.onGround, hp: typeof s.health === 'number' ? s.health : null,
    dim: s.dimension || null, sa: s.survivalAction?.action || s.goal?.survivalAction?.action || null, step: s.step?.action || s.goal?.step?.action || null,
    pathing: !!s.pathing, ctl: s.controller ? { name: s.controller.name, since: s.controller.since, repressed: s.controller.repressed || 0 } : null,
    turn: s.turn?.holder || null, shield: (s.keys || []).includes('shield'), yaw: s.yaw ?? null };
  if (Array.isArray(s.mobs)) f.mobs = s.mobs.map(m => ({ name: m.name, d: m.d, seen: m.seen }));
  if (r.kind === 'damage') f.hurt = { type: r.detail?.type || null, cause: r.detail?.cause || null, direct: r.detail?.direct || null };
  if (r.kind === 'shot') f.shot = { name: r.detail?.name || null, landed: !!r.detail?.landed };
  if (r.kind === 'decision' && s.decision?.id) f.ask = { id: s.decision.id, chosen: (s.decision.path || []).filter(k => k && k !== 'list').at(-1) || null };
  if (r.kind === 'lava_escape') f.escape = { took: r.detail?.took || null };
  if (s.inventory && typeof s.inventory === 'object') f.inv = { water: s.inventory.water_bucket || 0, fireRes: Object.keys(s.inventory).filter(k => /fire_resistance|potion/.test(k)).length, gapple: (s.inventory.golden_apple || 0) + (s.inventory.enchanted_golden_apple || 0) };
  if (s.equipment) f.offhand = s.equipment.offhand || null;
  return f;
}

// The trial on a port at a moment: the last midgame record begun before it
// (push-scene.js worldAt, read once).
let TRIALS = null;
function worldAt(root, port, t) {
  if (!TRIALS) {
    const dir = path.join(root, 'artifacts', 'midgame');
    TRIALS = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); TRIALS.push({ port: String(j.port), s: Date.parse(j.startedAt), world: j.world }); } catch (_) { /* not a record */ }
    }
  }
  let best = null;
  for (const x of TRIALS) if (x.port === String(port) && x.s <= t && (!best || x.s > best.s)) best = x;
  return best?.world || null;
}

async function readFile(file, out) {
  const name = path.basename(file), port = (name.match(/-(\d{5})-Jev-/) || [])[1] || '?';
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const ring = [];
  let hp = null, run = null;
  const hurts = [];
  const closeRun = () => { if (run) { out.runs.push(run); run = null; } };
  for await (const line of rl) {
    if (!line) continue;
    const i = line.lastIndexOf('"at":"'), t = i < 0 ? NaN : Date.parse(line.slice(i + 6, line.indexOf('"', i + 6)));
    if (!(t >= SINCE - RING_MS && t <= TO)) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    const f = compact(r, t);
    ring.push(f); while (ring.length && ring[0].t < t - RING_MS) ring.shift();
    if (f.hurt) { hurts.push({ t, ...f.hurt }); while (hurts.length && hurts[0].t < t - 10000) hurts.shift(); }
    // The runs out of fire: one held-key move each, named while it lasts.
    if (t >= SINCE) {
      if (run && (!f.ctl || f.ctl.name !== 'out_of_fire' || f.ctl.since !== run.since)) closeRun();
      if (f.ctl?.name === 'out_of_fire') {
        if (!run) run = { port, file: name, since: f.ctl.since, t0: t, t1: t, first: f.pos, last: f.pos, yaw: f.yaw, hp: f.hp, frames: 0, shield: 0, inFire: 0, onFire: 0, dim: f.dim };
        run.frames++; run.t1 = t; if (f.pos) run.last = f.pos; if (f.shield) run.shield++;
        if (f.label === 'hurt: in fire') run.inFire++; if (f.label === 'hurt: on fire') run.onFire++;
      }
    }
    if (f.hp !== null) {
      if (f.hp === 0 && hp > 0 && t >= SINCE && /nether/.test(f.dim || '')) {
        const killer = killerOf(hurts.filter(h => h.t >= t - 10000));
        if (/^(lava|fire)$/.test(killer)) out.deaths.push({ port, file: name, t, at: new Date(t).toISOString(), killer, frames: ring.filter(x => x.t >= t - WINDOW_MS - 5000) });
      }
      hp = f.hp;
    }
  }
  closeRun();
}

const moved = r => r.first && r.last ? Math.hypot(r.last.x - r.first.x, r.last.z - r.first.z) : 0;
const stuck = r => r.t1 - r.since >= STUCK_MS && moved(r) < STUCK_BLOCKS;

// One death, read: how it got in, what held the turn, the way out.
function readDeath(d) {
  const fr = d.frames, end = d.t, win = fr.filter(f => f.t >= end - WINDOW_MS);
  // The burning that killed: the burn hurts back from the death, no more
  // than CHAIN_GAP_MS apart (a body alight is hurt each second, in a flame
  // or lava each half second).
  const burns = win.filter(f => BURN.test(f.label));
  let k = burns.length - 1;
  while (k > 0 && burns[k].t - burns[k - 1].t <= CHAIN_GAP_MS) k--;
  const chain = burns.slice(k), start = chain[0]?.t ?? end;
  const lavaHurt = chain.find(f => f.label === 'hurt: lava');
  const kind = lavaHurt ? 'lava' : 'fire';
  const before = t => [...fr].reverse().find(f => f.t <= t && f.pos);
  const at0 = before(start) || win[0] || {};
  const o = { port: d.port, at: d.at, killer: d.killer, kind, burnSeconds: round((end - start) / 1000), healthIn: round(before(start - 1)?.hp ?? null) };
  // How it got in.
  if (kind === 'lava') {
    const hurtAt = lavaHurt.t;
    const ground = fr.filter(f => f.t < hurtAt && f.t >= hurtAt - 5000 && f.onGround && f.pos);
    const left = ground.at(-1) || null;
    const top = ground.reduce((m, f) => Math.max(m, f.pos.y), -Infinity);
    o.fell = Number.isFinite(top) && lavaHurt.pos ? round(Math.max(0, top - lavaHurt.pos.y)) : null;
    const leftT = left?.t ?? hurtAt;
    const pushHurt = fr.filter(f => f.hurt && !BURN.test(f.label) && f.t >= leftT - 1500 && f.t <= hurtAt).at(-1);
    const shot = fr.filter(f => f.shot && /^fireball$/.test(f.shot.name || '') && f.t >= leftT - 2000 && f.t <= hurtAt).at(-1);
    const ghastNear = (left?.mobs || at0.mobs || []).some(m => m.name === 'ghast');
    o.by = pushHurt ? `pushed: ${pushHurt.hurt.cause || pushHurt.hurt.type}${pushHurt.hurt.direct && pushHurt.hurt.direct !== pushHurt.hurt.cause ? ` (${pushHurt.hurt.direct})` : ''}`
      : shot || (ghastNear && o.fell > 1.5 && !(left?.pathing) && !(left?.ctl)) ? 'pushed: a ghast\'s fireball bursting by the bot'
        : left?.ctl ? `walked in: held-key move ${left.ctl.name}` : left?.pathing ? `walked in: the pathfinder (${left.sa || left.step || '?'})`
          : o.fell > 1.5 ? 'fell: nothing held (a floor gone, a knock unrecorded)' : 'stood: nothing held (a drift)';
    o.held = { sa: left?.sa || at0.sa || null, step: left?.step || at0.step || null, turn: left?.turn || at0.turn || null, pathing: !!left?.pathing, ctl: left?.ctl?.name || null };
  } else {
    const ign = fr.filter(f => f.hurt && f.t >= start - 3000 && f.t <= start && !BURN.test(f.label)).at(-1);
    const first = chain[0];
    o.by = ign && /blaze|small_fireball/.test(`${ign.hurt.cause} ${ign.hurt.direct}`) ? 'alight: a blaze\'s fireball'
      : ign && /ghast|fireball/.test(`${ign.hurt.cause} ${ign.hurt.direct} ${ign.hurt.type}`) ? 'alight: a ghast\'s fireball'
        : first?.label === 'hurt: in fire' ? (first.pathing ? 'alight: walked into a flame (the pathfinder)' : first.ctl ? `alight: walked into a flame (${first.ctl.name})` : 'alight: stood in a flame')
          : 'alight: on fire, source unrecorded';
    // Any blaze hit in the burn's thirty seconds: the burning is the blaze fight's.
    o.blazeHits = win.filter(f => f.hurt && /blaze|small_fireball/.test(`${f.hurt.cause} ${f.hurt.direct}`)).length;
    o.held = { sa: at0.sa || null, step: at0.step || null, turn: at0.turn || null, pathing: !!at0.pathing, ctl: at0.ctl?.name || null };
  }
  const blazes = f => (f?.mobs || []).filter(m => m.name === 'blaze' && m.d <= 8).length;
  o.blazeWithin8 = blazes(at0) > 0;
  o.fightingOn = o.blazeWithin8 && CLOSING.test(o.held.sa || o.held.step || '');
  o.inFireHurts = chain.filter(f => f.label === 'hurt: in fire').length;
  // The way out: lava escapes, runs out of fire (each a held-key move), body_way.
  const runs = new Map();
  for (const f of win) if (f.ctl?.name === 'out_of_fire' && f.t >= start - 1000) {
    const r = runs.get(f.ctl.since) || { since: f.ctl.since, t1: f.t, first: f.pos, last: f.pos, shield: 0 };
    r.t1 = f.t; if (f.pos) r.last = f.pos; if (f.shield) r.shield++;
    runs.set(f.ctl.since, r);
  }
  const rs = [...runs.values()];
  o.runs = rs.length; o.runsStood = rs.filter(stuck).length; o.runsStoodShield = rs.filter(r => stuck(r) && r.shield).length;
  o.runSeconds = round(rs.reduce((n, r) => n + Math.max(0, r.t1 - r.since), 0) / 1000);
  o.bodyWay = win.filter(f => f.ask?.id === 'body_way' && f.t >= start - 1000).map(f => f.ask.chosen);
  o.lavaEscapes = win.filter(f => f.escape && f.t >= start - 1500).map(f => f.escape.took);
  o.leaveLava = win.some(f => f.sa === 'leave_lava' && f.t >= start);
  const inv = [...fr].reverse().find(f => f.inv)?.inv || {};
  o.water = inv.water || 0; o.fireRes = inv.fireRes || 0;
  // The way out did not hold: a run that stood (keys let go, or refused)
  // while the body burned in a flame.
  o.stoodInFlames = o.runsStood > 0 && o.inFireHurts > 0;
  return o;
}

// ------------------------------------------------------------ the replay

const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { EventEmitter } = require('node:events');

function regionDir(port, world) {
  const base = path.join(ROOT, String(port) === '25581' ? '.clean-run' : `.clean-run-${port}`, world);
  return [path.join(base, 'dimensions', 'minecraft', 'the_nether', 'region'), path.join(base, 'DIM-1', 'region')].find(d => fs.existsSync(d)) || null;
}
const worlds = new Map();
function savedNether(port, world) {
  const key = `${port}/${world}`;
  if (!worlds.has(key)) { const dir = regionDir(port, world); worlds.set(key, dir ? require('./trials/trail-map').savedWorld(dir) : null); }
  return worlds.get(key);
}
// A block from a saved name, cached by cell.
function savedBlockAt(w) {
  const cache = new Map();
  return p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), key = `${x},${y},${z}`;
    if (cache.has(key)) return cache.get(key);
    const n = w.blockAt(x, y, z);
    let b = null;
    if (n !== undefined) {
      const def = registry.blocksByName[String(n).replace(/^minecraft:/, '')] || registry.blocksByName.air;
      b = Block.fromStateId(def.defaultState, 0); b.position = new Vec3(x, y, z);
    }
    cache.set(key, b); return b;
  };
}
// A body on saved ground, alight, the controls read by the game's physics.
function burningBot(blockAt, at, { yaw = 0, health = 20 } = {}) {
  const controls = {};
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw, pitch: 0, effects: {}, attributes: {}, metadata: [1] }, entities: {},
    // The physics' jump clock: with none, a held jump never leaves the ground.
    jumpTicks: 0, jumpQueued: false,
    inventory: { items: () => [], slots: {} },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt,
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (y, p) => { bot.entity.yaw = y; bot.entity.pitch = p; };
  return bot;
}
// The game's physics on the bot, twenty ticks a second; and every half
// second, as each burn hurt came, the keys let go (the hurt watchdog's stop,
// the shield hold's lock): what the run met in the records.
function physics(bot, { letGoMs = 500 } = {}) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const world = { getBlock: p => bot.blockAt(p) };
  const ph = Physics(registry, world); fixPlayerDimensions(ph);
  const run = { ticks: 0 };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    ph.simulatePlayer(s, world); s.apply(bot);
    if (letGoMs && ++run.ticks % Math.round(letGoMs / 50) === 0) bot.clearControlStates();
  }, 50);
  return run;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Clear of the flames: none in the cells the body's box stands in, nor
// beside its feet or head (vitals.js inFire, the server's word left out).
function clearOfFlames(bot) {
  const vitals = require('../src/vitals'), motion = require('../src/motion');
  const saved = bot._inFireAt; bot._inFireAt = 0;
  try { return !motion.bodyBurning(bot) && !vitals.inFire(bot); } finally { bot._inFireAt = saved; }
}

// `flamesRefused`: the run as the old rule walked it, the flames on its
// route refused (motion.js before note 792), for the comparison.
async function replayRun(r, { flamesRefused = false } = {}) {
  const world = worldAt(ROOT, r.port, r.t0);
  const w = world && savedNether(r.port, world);
  if (!w || !r.first) return { replayed: false, why: !world ? 'no trial record' : 'no save' };
  const blockAt = savedBlockAt(w);
  const at = new Vec3(r.first.x, r.first.y, r.first.z);
  if (!blockAt(at)) return { replayed: false, why: 'the save holds no chunk there' };
  const vitals = require('../src/vitals'), motion = require('../src/motion');
  const { Task } = require('../src/skills');
  const bot = burningBot(blockAt, at, { yaw: r.yaw ?? 0, health: r.hp ?? 20 });
  bot._inFireAt = Date.now();
  const fireThere = !clearOfFlames(bot);
  if (!fireThere) return { replayed: false, why: 'no flame at the run\'s start in the save (gone since)' };
  const route = vitals.fireRoute(bot);
  if (!route?.length) return { replayed: true, fireThere, route: 0, out: false, why: 'no route out on the saved ground' };
  // The old rule's refusal of the route's first step: the flames ahead read
  // from the cells the box would take, the body alight but not in a flame's cell.
  const first = route[0].offset(0.5, 0, 0.5), p = bot.entity.position;
  const yawTo = Math.atan2(-(first.x - p.x), -(first.z - p.z));
  const y0 = bot.entity.yaw; bot.entity.yaw = yawTo;
  const escaping = !!motion.bodyBurning(bot);
  const oldRefused = !escaping ? motion.burningAhead(bot, ['forward'], { deep: true }) : null;
  const newRefused = !escaping ? motion.burningAhead(bot, ['forward'], { deep: true, flames: false }) : null;
  bot.entity.yaw = y0;
  const ph = physics(bot);
  const log = console.log; console.log = () => {};
  const t0 = Date.now();
  let err = null;
  const move = motion.move;
  if (flamesRefused) motion.move = (b, t, o) => move(b, t, { ...o, throughFlames: false });
  try { await vitals.outOfFire(bot, new Task('replay'), () => {}, route); } catch (e) { err = e.message; }
  finally { motion.move = move; await sleep(150); clearInterval(ph.timer); console.log = log; }
  const out = clearOfFlames(bot);
  return { replayed: true, fireThere, route: route.length, through: route.some(c => ['fire', 'soul_fire'].includes(blockAt(c)?.name) || ['fire', 'soul_fire'].includes(blockAt(c.offset(0, 1, 0))?.name)),
    oldRefused: oldRefused ? oldRefused.name : null, newRefused: newRefused ? newRefused.name : null, out, seconds: round((Date.now() - t0) / 1000), moved: round(bot.entity.position.distanceTo(at)), err };
}

// ------------------------------------------------------------ a fixture

function cut([port, world, x, y, z, r, below, above]) {
  const w = savedNether(port, world);
  if (!w) throw new Error(`no save for ${port}/${world}`);
  const X = Math.floor(+x), Y = Math.floor(+y), Z = Math.floor(+z), R = +r;
  const box = { x: [X - R, X + R], y: [Y - +below, Y + +above], z: [Z - R, Z + R] };
  const palette = [], rows = [];
  const code = n => { let i = palette.indexOf(n); if (i < 0) { palette.push(n); i = palette.length - 1; } return String.fromCharCode(i < 26 ? 97 + i : 65 + i - 26); };
  for (let yy = box.y[0]; yy <= box.y[1]; yy++) for (let zz = box.z[0]; zz <= box.z[1]; zz++) {
    let row = '';
    for (let xx = box.x[0]; xx <= box.x[1]; xx++) row += code(String(w.blockAt(xx, yy, zz) ?? 'air').replace(/^minecraft:/, ''));
    rows.push(row.replace(/([a-zA-Z])\1+/g, m => `${m[0]}${m.length}`));
  }
  return { note: `${world} (${port}), the_nether region files as saved after the trial (read-only); rows by y then z, one char per x from box.x[0] (palette index, a=0), run-length coded; cut by scripts/burn-deaths.js --cut`, box, palette, rle: true, rows };
}

(async () => {
  if (argv[0] === '--cut') { console.log(JSON.stringify(cut(argv.slice(1)))); return; }
  // --cache: what was read kept in a file and read from it next time (the
  // janitor deletes the oldest flight records as the disk fills).
  const cache = arg('--cache', null);
  let files = [], out = { deaths: [], runs: [] };
  if (cache && fs.existsSync(cache)) ({ files, out } = JSON.parse(fs.readFileSync(cache, 'utf8')));
  else {
    files = fs.readdirSync(FLIGHT).filter(f => f.endsWith('.jsonl')).map(f => path.join(FLIGHT, f)).filter(f => fs.statSync(f).mtimeMs >= SINCE).sort();
    for (const f of files) await readFile(f, out);
    if (cache) fs.writeFileSync(cache, JSON.stringify({ files, out }));
  }
  const deaths = out.deaths.map(readDeath);
  const lava = deaths.filter(d => d.kind === 'lava'), fire = deaths.filter(d => d.kind === 'fire');
  const runs = out.runs.filter(r => /nether/.test(r.dim || '')), long = runs.filter(r => r.t1 - r.since >= STUCK_MS), stood = runs.filter(stuck);
  const report = {
    window: `${new Date(SINCE).toISOString()} to ${new Date(TO).toISOString()}`, files: files.length,
    deaths: deaths.length, byKiller: tally(deaths, d => d.killer), byKind: tally(deaths, d => d.kind),
    lava: { by: tally(lava, d => d.by.replace(/ \(.*\)$/, '')), held: tally(lava, d => d.held.ctl || d.held.sa || d.held.step || '-'), pathing: lava.filter(d => d.held.pathing).length,
      fellMedian: median(lava.map(d => d.fell)), burnSecondsMedian: median(lava.map(d => d.burnSeconds)), escapeRan: lava.filter(d => d.lavaEscapes.length || d.leaveLava).length },
    fire: { by: tally(fire, d => d.by), blazeHitInTheBurn: fire.filter(d => d.blazeHits).length, fightingOn: fire.filter(d => d.fightingOn).length,
      withRuns: fire.filter(d => d.runs).length, runStood: fire.filter(d => d.runsStood).length, runStoodInFlames: fire.filter(d => d.stoodInFlames).length, runStoodShield: fire.filter(d => d.runsStoodShield).length,
      burnSecondsMedian: median(fire.map(d => d.burnSeconds)), water: fire.filter(d => d.water).length, fireRes: fire.filter(d => d.fireRes).length },
    lavaThenBurning: deaths.filter(d => d.kind === 'lava' && d.runs).length,
    runsOutOfFire: { runs: runs.length, secondOrMore: long.length, stood: stood.length, stoodShieldUp: stood.filter(r => r.shield).length,
      inFireHurtsWhileStood: stood.reduce((n, r) => n + r.inFire, 0), inFireHurtsWhileMoving: long.filter(r => !stuck(r)).reduce((n, r) => n + r.inFire, 0) },
  };
  if (!argv.includes('--no-replay')) {
    const replays = [];
    for (const r of stood) {
      const now = await replayRun(r);
      const old = now.replayed && now.route ? await replayRun(r, { flamesRefused: true }) : null;
      replays.push({ port: r.port, at: new Date(r.t0).toISOString(), at0: r.first, shield: r.shield > 0, ...now, oldOut: old ? old.out : null });
    }
    const done = replays.filter(x => x.replayed);
    report.replay = { stood: stood.length, replayed: done.length, notReplayed: tally(replays.filter(x => !x.replayed), x => x.why),
      routeFound: done.filter(x => x.route).length, routeThroughAFlame: done.filter(x => x.through).length,
      oldRuleRefusedFirstStep: done.filter(x => x.oldRefused).length, newRuleRefusedFirstStep: done.filter(x => x.newRefused).length,
      outOfTheFlames: done.filter(x => x.out).length, stillIn: done.filter(x => x.route && !x.out).length, secondsMedian: median(done.filter(x => x.out).map(x => x.seconds)),
      outWithTheFlamesRefused: done.filter(x => x.oldOut).length };
    out.replays = replays;
  }
  const j = arg('--json', null);
  if (j) fs.writeFileSync(j, JSON.stringify({ report, deaths, replays: out.replays || [] }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (argv.includes('--list')) {
    for (const d of deaths) console.log(`${d.port} ${d.at} ${d.kind} (${d.killer}) ${d.by}${d.fell != null ? `, fell ${d.fell}` : ''}; held ${d.held.ctl || d.held.sa || '-'} | ${d.held.step || '-'}${d.held.pathing ? ' (walking)' : ''}, turn ${d.held.turn || '-'}; burned ${d.burnSeconds} s from ${d.healthIn}; blaze within 8 ${d.blazeWithin8 ? 'yes' : 'no'}${d.fightingOn ? ' (fighting on)' : ''}; runs out of fire ${d.runs} (${d.runsStood} stood, ${d.runsStoodShield} with the shield up), in-fire hurts ${d.inFireHurts}; body_way ${d.bodyWay.join('/') || '-'}; lava escape ${d.lavaEscapes.join('/') || (d.leaveLava ? 'leave_lava' : '-')}`);
    for (const x of out.replays || []) console.log(`  run ${x.port} ${x.at} at (${round(x.at0?.x)}, ${round(x.at0?.y)}, ${round(x.at0?.z)})${x.shield ? ' shield up' : ''}: ${x.replayed ? `route ${x.route}${x.through ? ' through a flame' : ''}; old rule refused ${x.oldRefused || 'nothing'}, new ${x.newRefused || 'nothing'}; ${x.out ? `out in ${x.seconds} s` : `still in (${x.err || x.why || ''})`}, moved ${x.moved}; with the flames refused ${x.oldOut ? 'out' : 'still in'}` : x.why}`);
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
