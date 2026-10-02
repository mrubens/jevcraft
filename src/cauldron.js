'use strict';
// A cauldron of water puts a burning body out (note 634). The Nether has no
// water to run into and a poured bucket evaporates there, so nothing but
// time put out a fire on the bot (note 631: 44 of 70 blaze deaths were alight
// at the end). Filling a cauldron from a water bucket has no dimension check,
// and a burning body inside a water cauldron is put out at the moment its
// feet are under the water, which costs the cauldron one of its three levels.
//
// Measured on the arena server in the Nether (2026-09-28, note 634):
//   - a cauldron put down on netherrack and a water bucket used on it: level
//     3 in about half a second, the bucket left empty (a bucket of water is
//     one cauldron, and an empty bucket used on a full one takes it back);
//   - the fire out within a tenth of a second of the feet going under the
//     water; the cauldron one level lower; a level-1 cauldron is left empty;
//   - the bowl is not a hole a body walks into: its rim is a block high with
//     walls an eighth thick, the hollow three quarters of a block wide, so a
//     body 0.6 wide drops in only with the middle of it within 0.075 of the
//     cauldron's middle in both directions. A jump onto the rim carries it
//     across (a walk across the rim at a walk's steps skipped the window),
//     so the bot lines its side up first and steps along the rim in single
//     ticks; four of four tries went in; out again by a jump (half a second).
// The ways are said to Jev (vitals.js fireWays, body_way); the code decides
// nothing here.
const { Vec3 } = require('vec3');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Iron ingots in a cauldron's recipe.
const CAULDRON_IRON = 7;
// The reach of a placed cauldron worth a way: a walk of a few blocks.
const NEAR = 6;
// The window the middle of the body must be in, either way from the
// cauldron's middle: the hollow is 0.75 wide, the body 0.6.
const WINDOW = 0.06;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const passable = b => !!b && b.boundingBox === 'empty' && !/lava|water|fire|magma|cactus|berry|web/.test(b.name);
const standable = b => !!b && b.boundingBox === 'block';
const at = (bot, p) => bot.blockAt?.(p);
const nether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const have = (bot, name) => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

// The water in a cauldron block, 0 to 3.
function levelOf(block) {
  if (!block || block.name !== 'water_cauldron') return 0;
  const p = block.getProperties?.();
  const n = Number(p?.level ?? block.metadata);
  return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 1;
}

// The bot's own alight state (metadata flag 0), as body.js reads it.
const alight = bot => !!(bot?.entity?.metadata?.[0] & 1);

// The cell a body stands in to step onto a cauldron at `cell` from the
// side `d`: open at the feet with a floor under, and open over it for a
// jump (two cells above the feet), the cells over the cauldron open for the
// body on the rim and inside (two above the rim).
function approachFrom(bot, cell, [dx, dz]) {
  const s = cell.offset(-dx, 0, -dz);
  if (!passable(at(bot, s)) && !(at(bot, s)?.name === 'air')) return null;
  if (!standable(at(bot, s.offset(0, -1, 0)))) return null;
  if (![1, 2].every(dy => passable(at(bot, s.offset(0, dy, 0))))) return null;
  if (![1, 2].every(dy => passable(at(bot, cell.offset(0, dy, 0))))) return null;
  return s;
}

// A placed cauldron with water in it within reach, and the cell to go in
// from: the nearest side by the walk to it.
function placedCauldron(bot, radius = NEAR) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const here = bot.entity.position;
  let cells = [];
  try { cells = bot.findBlocks({ matching: b => b?.name === 'water_cauldron', maxDistance: radius, count: 8 }) || []; } catch (_) { return null; }
  const options = [];
  for (const cell of cells) {
    const block = at(bot, cell);
    if (!levelOf(block)) continue;
    for (const d of SIDES) {
      const from = approachFrom(bot, cell, d);
      if (from) options.push({ cell, from, d, level: levelOf(block), walk: Math.hypot(from.x + 0.5 - here.x, from.z + 0.5 - here.z) + Math.abs(from.y - here.y) });
    }
  }
  options.sort((a, b) => a.walk - b.walk);
  return options[0] || null;
}

// Where a carried cauldron would go: a side of the cell the bot stands in
// (open, a floor under, room over), the bot's own cell being the one it
// goes in from.
function placeSpot(bot) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const feet = bot.entity.position.floored();
  if (!standable(at(bot, feet.offset(0, -1, 0)))) return null;
  if (![1, 2].every(dy => passable(at(bot, feet.offset(0, dy, 0))))) return null;
  // Nearest the way the bot faces first.
  const yaw = bot.entity.yaw ?? 0, look = [-Math.sin(yaw), -Math.cos(yaw)];
  const sides = SIDES.slice().sort((a, b) => (b[0] * look[0] + b[1] * look[1]) - (a[0] * look[0] + a[1] * look[1]));
  for (const d of sides) {
    const cell = feet.offset(d[0], 0, d[1]);
    if (!passable(at(bot, cell)) && at(bot, cell)?.name !== 'air') continue;
    if (!standable(at(bot, cell.offset(0, -1, 0)))) continue;
    if (![1, 2].every(dy => passable(at(bot, cell.offset(0, dy, 0))))) continue;
    return { cell, from: feet, d, ref: at(bot, cell.offset(0, -1, 0)) };
  }
  return null;
}

// What the two ways come to for `bot`: a water cauldron placed near, or a
// cauldron and a water bucket carried and a spot to put it down.
function plans(bot) {
  const carriedCauldron = have(bot, 'cauldron'), bucket = have(bot, 'water_bucket');
  return { placed: placedCauldron(bot), carry: carriedCauldron && bucket ? placeSpot(bot) : null, cauldrons: carriedCauldron, buckets: bucket };
}

// Which axis the bot enters along: forward is (-sin yaw, -cos yaw).
const yawFor = ([dx, dz]) => Math.atan2(-dx, -dz);
const frame = d => { const yaw = yawFor(d); return { yaw, fwd: [-Math.sin(yaw), -Math.cos(yaw)], right: [Math.cos(yaw), -Math.sin(yaw)] }; };
const offsetOf = (bot, cell, v) => { const p = bot.entity.position; return (p.x - (cell.x + 0.5)) * v[0] + (p.z - (cell.z + 0.5)) * v[1]; };

// A mob's blow since `since` (session.js marks each one the server says
// was a mob's attack): it knocks the body back, off the rim or out of line
// with the bowl, and the steps are undone. The way stops at it, the keys
// let go, and body_way asks again with the blows said (note 657): mid-243-ch
// (25581) lined up on the rim for five seconds under a blaze's six blows at
// its back, a second apart, from 17.6 to none, and never went in.
const struck = (bot, since) => (bot?._blowAt || 0) > since;
const letGo = bot => { bot.clearControlStates?.(); bot.setControlState?.('sneak', false); return false; };

// Put a carried cauldron down at `spot` and fill it from the water bucket.
async function setDown(bot, task, spot, onAction = () => {}) {
  const cauldron = bot.inventory.items().find(i => i.name === 'cauldron'), bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!cauldron || !bucket) return false;
  onAction({ action: 'out_of_fire', way: 'set_down_cauldron', health: bot.health });
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  await bot.equip(cauldron, 'hand'); task?.check?.();
  await bot.lookAt(spot.cell.offset(0.5, 0.5, 0.5), true);
  const place = bot._placeBlockWithOptions ? () => bot._placeBlockWithOptions(spot.ref, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: true }) : () => bot.placeBlock(spot.ref, new Vec3(0, 1, 0));
  try { await place(); } catch (err) { if (err.name === 'Cancelled') throw err; }
  task?.check?.();
  const put = at(bot, spot.cell);
  if (put?.name !== 'cauldron') return false;
  await bot.equip(bucket, 'hand'); task?.check?.();
  await bot.lookAt(spot.cell.offset(0.5, 0.5, 0.5), true);
  try { await bot.activateBlock(put); } catch (err) { if (err.name === 'Cancelled') throw err; }
  for (let i = 0; i < 20 && !levelOf(at(bot, spot.cell)); i++) { task?.check?.(); await sleep(50); }
  return levelOf(at(bot, spot.cell)) > 0;
}

// In: line the side up with the cauldron's middle at a crouch's steps, hop
// onto the rim, and step along it a tick at a time until the body drops in.
async function stepIn(bot, task, plan, onAction = () => {}, since = Date.now()) {
  const { move } = require('./motion');
  const { cell, from, d } = plan;
  const { fwd, right } = frame(d);
  const start = bot.entity.position;
  // Walked to the cell it goes in from, if not there.
  if (Math.floor(start.x) !== from.x || Math.floor(start.z) !== from.z || Math.abs(start.y - from.y) > 0.6) {
    const { navigate } = require('./skills');
    const { goals } = require('mineflayer-pathfinder');
    try { await navigate(bot, task, new goals.GoalBlock(from.x, from.y, from.z), { timeoutMs: 6000, stallMs: 3000, onFoot: true, stopWhen: () => struck(bot, since) }); } catch (err) { if (err.name === 'Cancelled') throw err; }
  }
  task?.check?.();
  if (struck(bot, since)) return letGo(bot);
  const aim = () => bot.entity.position.offset(d[0] * 5, 1.6, d[1] * 5);
  // Along the ground, each key a tick or two.
  const pulse = (key, sneak = true) => move(bot, task, { label: 'into_cauldron', keys: [key], sneak, why: sneak ? undefined : 'a step along the cauldron\'s rim', look: aim(), maxMs: 60, tick: 25 });
  for (let i = 0; i < 24; i++) {
    if (struck(bot, since)) return letGo(bot);
    const across = offsetOf(bot, cell, right);
    if (Math.abs(across) <= WINDOW * 0.75) break;
    await pulse(across < 0 ? 'right' : 'left'); await sleep(90);
  }
  onAction({ action: 'out_of_fire', way: 'into_cauldron', health: bot.health });
  const rim = cell.y + 0.95, inside = () => bot.entity.position.y < cell.y + 0.6 && Math.abs(offsetOf(bot, cell, fwd)) < 0.5 && Math.abs(offsetOf(bot, cell, right)) < 0.5;
  // The hop: up and over the wall, a few ticks; carried on by its own
  // speed it may cross the whole bowl, so it stops at the rim.
  if (struck(bot, since)) return letGo(bot);
  await move(bot, task, { label: 'into_cauldron', keys: ['forward', 'jump'], sneak: false, why: 'a hop onto the cauldron\'s rim', look: aim(), maxMs: 500, tick: 25,
    until: () => inside() || struck(bot, since) || (bot.entity.position.y >= rim && offsetOf(bot, cell, fwd) > -0.55) });
  // Along the rim a tick at a time, forward or back, until the middle of
  // the body is over the hollow and gravity does the rest.
  for (let i = 0; i < 40 && !inside(); i++) {
    task?.check?.();
    await sleep(160);
    if (inside()) break;
    if (struck(bot, since)) return letGo(bot);
    if (!bot.entity.onGround) continue;
    if (bot.entity.position.y < cell.y + 0.9) break;
    const along = offsetOf(bot, cell, fwd), across = offsetOf(bot, cell, right);
    if (Math.abs(across) > WINDOW) { await pulse(across < 0 ? 'right' : 'left', false); continue; }
    if (Math.abs(along) <= WINDOW) continue;
    await pulse(along < 0 ? 'forward' : 'back', false);
  }
  for (let i = 0; i < 6 && !inside(); i++) await sleep(100);
  // The fire is out a tick or two after the feet go under the water.
  for (let i = 0; i < 12 && alight(bot); i++) { task?.check?.(); await sleep(50); }
  return inside() && !alight(bot);
}

// The way out: a hop up onto the rim and on, half a second.
async function stepOut(bot, task, plan) {
  const { move } = require('./motion');
  const { fwd } = frame(plan.d);
  bot.setControlState?.('sneak', false);
  await move(bot, task, { label: 'out_of_cauldron', keys: ['forward', 'jump'], sneak: false, why: 'a hop out of the cauldron', look: bot.entity.position.offset(fwd[0] * 5, 1.6, fwd[1] * 5), maxMs: 1500, tick: 25,
    until: () => bot.entity.onGround && offsetOf(bot, plan.cell, fwd) > 0.85 });
}

// A filled cauldron's way: to it and in.
// The steps in are the body's way out of fire, and held as that while they
// run (note 923): the shot reflex leaves the keys of a way out of fire to it
// (vitals.js wayOutRunning: the shield up, the walk its own), and this way
// never said it was one. 25595 (mid-243-ia-fortress-4, 2026-10-02 16:24 to
// 16:25Z) burned beside its own cauldron of water among four blazes, the
// shield's answer on: "into_cauldron: left let go mid-move by something
// else; pressed again" 23 times, the body never lined up with the bowl, and
// its last answer was extinguish_in_cauldron at no health.
async function asWayOut(bot, run) {
  const mark = () => { bot._bodyWayRunning = { action: 'out_of_fire', at: Date.now() }; };
  mark();
  const timer = setInterval(mark, 500);
  try { return await run(); }
  finally { clearInterval(timer); if (bot._bodyWayRunning?.action === 'out_of_fire') delete bot._bodyWayRunning; }
}
async function extinguishIn(bot, task, plan, onAction = () => {}, since = Date.now()) {
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  const done = await asWayOut(bot, () => stepIn(bot, task, plan, onAction, since));
  if (done) { try { await stepOut(bot, task, plan); } catch (err) { if (err.name === 'Cancelled') throw err; } }
  return done;
}
// A carried cauldron's way: down, filled, in.
async function setDownAndIn(bot, task, spot, onAction = () => {}) {
  const since = Date.now();
  // Put down and filled whatever strikes meanwhile (it takes no footwork,
  // and a filled cauldron is a way at the next question); the steps in stop.
  if (!await setDown(bot, task, spot, onAction)) return false;
  return extinguishIn(bot, task, { cell: spot.cell, from: spot.from, d: spot.d }, onAction, since);
}

// Said for the way's description. The seconds are the measured ones: a
// placement 0.6, a fill 0.5, a hop and its steps about 1.5 in the arena's
// test (note 634), a walk at a sprint.
const PLACE_SECONDS = 1.1, HOP_SECONDS = 1.5, SPRINT = 5.6;
const seconds = (n) => Math.round(n * 10) / 10;

// For the burning's sentence in every question asked alight: a cauldron
// that would put it out, near or carried.
function says(bot) {
  let p;
  try { p = plans(bot); } catch (_) { return ''; }
  const parts = [];
  if (p.placed) { const here = bot.entity.position; parts.push(`one with water (${p.placed.level} of 3 levels) stands ${seconds(Math.hypot(p.placed.cell.x + 0.5 - here.x, p.placed.cell.z + 0.5 - here.z))} blocks off at (${p.placed.cell.x}, ${p.placed.cell.y}, ${p.placed.cell.z})`); }
  if (p.carry) parts.push('a cauldron and a water bucket are carried, and there is room to put the cauldron down and fill it');
  return parts.length ? ` A cauldron of water puts it out at once too, in the Nether as anywhere, by stepping into it: ${parts.join('; ')}.` : '';
}

module.exports = { asWayOut, struck, says, levelOf, alight, approachFrom, placedCauldron, placeSpot, plans, setDown, stepIn, stepOut, extinguishIn, setDownAndIn, have, nether, CAULDRON_IRON, NEAR, WINDOW, PLACE_SECONDS, HOP_SECONDS, SPRINT, seconds, frame, yawFor };
