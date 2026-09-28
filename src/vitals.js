'use strict';
const { Vec3 } = require('vec3');
const { swimmableWater, waterLevel, besideDrop } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unsafeFoods = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'rotten_flesh', 'chicken', 'suspicious_stew', 'chorus_fruit']);

class NeedsAir extends Error {
  constructor() { super('Low air: interrupt work and surface'); this.name = 'NeedsAir'; }
}

// The head in a solid block: suffocating, a point every half second. The
// clean run's night mine let gravel (or its own digging) close over its head
// at y 35 and died there in ten seconds, its steps failing around it
// (2026-09-24). Counted as needing air, so work stops, and the block is dug.
// Only while it is hurting (suffocation is a point every half second): a
// position read mid-step inside a block's corner is not suffocation.
// The game's test is a small box round the eye, four fifths of the body's
// width, not the eye's cell alone: mid-205-l rejoined with its eye at x
// -368.9, the box reaching into gravel in the next column, and suffocated
// with its eye's own cell open, nothing dug (2026-09-27).
const SOLID_FOR_BREATH = b => !!b && b.boundingBox === 'block' && !/_leaves$|glass|slab|stairs|fence|wall|door|trapdoor|scaffolding|chest|bed$/.test(b.name);
function suffocatingBlock(bot) {
  const eye = bot.entity?.position?.offset(0, bot.entity.eyeHeight || 1.62, 0);
  if (!eye || typeof bot.blockAt !== 'function') return null;
  const r = (bot.entity.width ?? 0.6) * 0.4;
  const cells = [];
  for (const dx of [-r, r]) for (const dz of [-r, r]) { const c = eye.offset(dx, 0, dz).floored(); if (!cells.some(q => q.equals(c))) cells.push(c); }
  cells.sort((a, b) => a.offset(0.5, 0.5, 0.5).distanceTo(eye) - b.offset(0.5, 0.5, 0.5).distanceTo(eye));
  for (const c of cells) { const b = bot.blockAt(c); if (SOLID_FOR_BREATH(b)) return b; }
  return null;
}
function headInBlock(bot) {
  if (!(bot._recentHurtAt > Date.now() - 2000)) return false;
  return !!suffocatingBlock(bot);
}
function needsAir(bot) { return bot.oxygenLevel <= 12 || headInBlock(bot); }
// In lava, whatever the step: every dig and walk checks breath here, and
// now the body in lava too, so the survival layer's way out comes at once.
// mid-211-b climbed straight up into lava and burned from seventeen health
// to four over nine seconds while the climb went on (2026-09-26). Not while
// the way out of lava is itself being walked.
function checkAir(bot) {
  if (needsAir(bot)) throw new NeedsAir();
  if (!bot._leavingLava && require('./terrain').bodyInLava(bot)) throw new (require('./danger').NeedsSafety)({ entity: { name: 'lava' }, distance: 0 });
}
function headSubmerged(bot) {
  const eye = bot.entity?.position?.offset(0, bot.entity.eyeHeight || 1.62, 0);
  if (!eye) return false;
  const head = eye.floored(), block = bot.blockAt?.(head);
  if (!swimmableWater(block)) return false;
  const level = waterLevel(block);
  // Flowing water only fills part of a block. Its name alone cannot establish
  // that the player's eyes are below the fluid surface.
  const height = swimmableWater(bot.blockAt(head.offset(0, 1, 0))) ? 1 : (8 - (level >= 8 ? 0 : level)) / 9;
  return eye.y < head.y + height;
}

// A dig the server never finishes is given up, not waited on: mid-243-a
// stood thirty seconds on one block of a shelter's wall, not hit, with a
// creeper coming, until the blast (2026-09-26). Bounded by what the game
// says the dig takes with the tool held: three times that and a margin
// for the round trip.
const DIG_SLACK = 3, DIG_MARGIN_MS = 2000;
function digBound(bot, block) {
  let ms = null;
  try { ms = block.digTime(bot.heldItem?.type ?? null, false, !!bot.entity?.isInWater, !bot.entity?.onGround, [], bot.entity?.effects || {}); } catch (_) { ms = null; }
  return Number.isFinite(ms) ? ms * DIG_SLACK + DIG_MARGIN_MS : null;
}
async function digWithAirGuard(bot, task, block) {
  task.check(); checkAir(bot);
  let interrupted;
  const started = Date.now(), bound = typeof block?.digTime === 'function' ? digBound(bot, block) : null;
  const watcher = setInterval(() => {
    try {
      task.check(); checkAir(bot);
      if (bound && Date.now() - started > bound) throw Object.assign(new Error(`The ${block.name.replaceAll('_', ' ')} did not break in ${Math.round((Date.now() - started) / 1000)} seconds, ${DIG_SLACK} times what the dig takes: given up`), { name: 'DigStalled' });
    }
    catch (err) { interrupted ||= err; bot.stopDigging(); }
  }, 100);
  try { await bot.dig(block); }
  catch (err) { throw interrupted || err; }
  finally { clearInterval(watcher); }
  if (interrupted) throw interrupted;
  task.check(); checkAir(bot);
}

// Search body-sized spaces for breathable air, the quickest way there: a
// step through water or air is about 0.4 s, and a block in the way costs
// the time to dig it with the fastest tool carried, as the game reckons it
// under water. Trial 63 drowned a pointed dripstone's width from a dry cave:
// water and air alone found no way, and the straight dig up broke into the
// lake over its head. A block dug is named on the route cell (`digs`).
const STEP_S = 0.4;
// Breath, in seconds: a point of air lasts fifteen ticks with the head
// under, less a margin for a stroke that goes wrong. Out of it, drowning
// takes two health a second.
const AIR_POINT_S = 0.75, BREATH_MARGIN_S = 2;
const breathSeconds = (bot, oxygen = bot.oxygenLevel ?? 20) => Math.max(0, oxygen * AIR_POINT_S - BREATH_MARGIN_S);
const drowningSeconds = bot => Math.max(0, ((bot.health ?? 20) - 1) / 2);
// The dig time from where the digger stands (`stand`, its feet): wet with
// the head in water, afloat with no floor under it. A swimmer with a floor
// sinks to stand and dig, five times quicker than afloat. mid-244-y's
// estimate took the swimmer's own footing, afloat in the lake, for every
// block on the way, twenty-five times a dig it would have made standing
// (note 477). Without `stand`, where the bot is now.
function digSeconds(bot, block, stand = null) {
  if (!block || typeof block.digTime !== 'function' || block.diggable === false || /bedrock|lava|obsidian/.test(block.name)) return null;
  const tools = [null, ...new Set((bot.inventory?.items?.() || []).filter(i => /_(pickaxe|shovel|axe)$/.test(i.name)).map(i => i.type))];
  let wet, floating;
  if (stand) {
    wet = swimmableWater(bot.blockAt?.(stand.offset(0, 1, 0))) || swimmableWater(bot.blockAt?.(stand));
    floating = bot.blockAt?.(stand.offset(0, -1, 0))?.boundingBox !== 'block';
  } else {
    const below = bot.entity?.position && bot.blockAt?.(bot.entity.position.floored().offset(0, -1, 0));
    wet = !!bot.entity?.isInWater; floating = !bot.entity?.onGround && below?.boundingBox !== 'block';
  }
  let best = Infinity;
  for (const type of tools) { try { best = Math.min(best, block.digTime(type, false, wet, floating, [], bot.entity?.effects || {})); } catch (_) { /* not for this tool */ } }
  return Number.isFinite(best) ? best / 1000 : null;
}
// Cheapest first, without sorting the whole frontier each step.
function heap() {
  const a = [];
  const up = i => { while (i) { const j = (i - 1) >> 1; if (a[j].cost <= a[i].cost) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } };
  const down = i => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].cost < a[m].cost) m = l; if (r < a.length && a[r].cost < a[m].cost) m = r; if (m === i) return; [a[i], a[m]] = [a[m], a[i]]; i = m; } };
  return { get size() { return a.length; }, push(x) { a.push(x); up(a.length - 1); }, pop() { const top = a[0], last = a.pop(); if (a.length) { a[0] = last; down(0); } return top; } };
}
// `closed` names cells a swimmer was held out of on the way (see
// surfaceForAir): the search goes round them. `from` is where the swim
// starts (the bot's feet by default), and `budgetS` how far it may go, in
// seconds: the breath left, not a box. mid-244-y's air was nine blocks west
// along a flooded column, a search boxed to eight each way found none, and
// it dug straight up into twelve blocks of stone (note 477). A node count
// bounds the search's cost.
const ROUTE_NODES = 4096;
function airRoute(bot, closed = new Set(), { from = null, budgetS = breathSeconds(bot) } = {}) {
  const start = (from || bot.entity.position).floored();
  const open = b => swimmableWater(b) || b && ['air', 'cave_air', 'void_air'].includes(b.name);
  const water = p => swimmableWater(bot.blockAt(p));
  // Air over moving water at a lip is no place to breathe: the swimmer
  // floats there, its keys let go, and the current carries it off the
  // edge. mid-237-j swam up a waterfall to its top, breathed in the
  // spill at the lip with a thirteen-block shaft beside it, and was
  // carried over into the lava at its foot, three times (note 518).
  const spill = p => waterLevel(bot.blockAt(p)) > 0 && besideDrop(bot, p);
  // Seconds to make a cell passable, dug from `stand`: 0 open, the dig time
  // for a block that brings nothing down, null otherwise.
  const clear = (p, stand) => {
    const b = bot.blockAt(p);
    if (open(b)) return 0;
    if (/sand|gravel|concrete_powder/.test(b?.name || '')) return null;
    return digSeconds(bot, b, stand);
  };
  const directions = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, -1, 0)];
  const frontier = heap();
  frontier.push({ p: start, path: [], cost: 0 });
  const best = new Map([[`${start}`, 0]]);
  for (let n = 0; frontier.size && n < ROUTE_NODES; n++) {
    const { p, path, cost } = frontier.pop();
    if (cost > (best.get(`${p}`) ?? Infinity)) continue;
    if (!closed.has(`${p}`) && open(bot.blockAt(p)) && open(bot.blockAt(p.offset(0, 1, 0))) && !water(p.offset(0, 1, 0)) &&
      (water(p) || bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block') && !spill(p)) return Object.assign(path.length ? path : [p], { seconds: cost });
    for (const d of directions) {
      const next = p.plus(d);
      if (next.y < start.y - 4) continue;
      if (closed.has(`${next}`)) continue;
      const feet = clear(next, p), head = clear(next.offset(0, 1, 0), p);
      if (feet == null || head == null) continue;
      // A block with a collision box is in the way however quickly it comes
      // away, and is named to be dug: mid-92-b's way to air went up through
      // a lily pad, which breaks at a touch and so cost nothing and was
      // named as nothing, and its underside held the head a tenth under the
      // surface until the bot drowned pressing jump into it (2026-09-25).
      const inWay = (q, t) => t > 0 || (!open(bot.blockAt(q)) && bot.blockAt(q)?.boundingBox === 'block');
      const feetDug = inWay(next, feet), headDug = inWay(next.offset(0, 1, 0), head);
      // Through air only where there is water about or ground within three
      // below: a step into a cave is a short drop, off a cliff is not.
      const dug = feetDug || headDug;
      const ground = [1, 2, 3].some(dy => bot.blockAt(next.offset(0, -dy, 0))?.boundingBox === 'block');
      if (!dug && !water(next) && !water(next.offset(0, 1, 0)) && !water(next.offset(0, -1, 0)) && !ground && d.y >= 0) continue;
      const total = cost + STEP_S + feet + head;
      if (total > budgetS || total >= (best.get(`${next}`) ?? Infinity)) continue;
      best.set(`${next}`, total);
      const cell = next.clone();
      cell.digs = [feetDug && next, headDug && next.offset(0, 1, 0)].filter(Boolean);
      frontier.push({ p: next, path: [...path, cell], cost: total });
    }
  }
  return null;
}

// Before a route that takes the head under water: each stretch of it with
// the head under, from the last breath to the next, in seconds (a step
// about 0.4 s, each block at the game's time dug from the cell before), set
// against the breath there is. A cell dug beside water fills with it.
// mid-244-y's way to shore swam up into a sealed lake toward a landing and
// stalled under its lid, the air twenty blocks off, no breath counted
// (note 477). Null when every stretch fits; else how long, the breath, and
// the cell where it runs out.
function breathShort(bot, path) {
  const water = p => swimmableWater(bot.blockAt(p));
  const dug = new Set(), around = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const under = c => water(c) || (dug.has(`${c}`) && around.some(d => water(c.plus(d))));
  const full = breathSeconds(bot, 20), now = headSubmerged(bot);
  let breath = now ? breathSeconds(bot) : full, held = now ? 0 : null, stand = bot.entity.position.floored();
  for (const node of path) {
    const p = new Vec3(node.x, node.y, node.z).floored();
    let t = STEP_S;
    for (const q of node.toBreak || []) {
      const c = new Vec3(q.x, q.y, q.z).floored();
      t += digSeconds(bot, bot.blockAt(c), stand) ?? Infinity; dug.add(`${c}`);
    }
    if (under(p.offset(0, 1, 0))) {
      held = (held ?? 0) + t;
      if (held > breath) return { seconds: Number.isFinite(held) ? Math.round(held * 10) / 10 : null, breath: Math.round(breath * 10) / 10, at: { x: p.x, y: p.y, z: p.z } };
    } else { held = null; breath = full; }
    stand = p;
  }
  return null;
}

async function surfaceForAir(bot, task, onAction = () => {}) {
  onAction({ action: 'surface', oxygen: bot.oxygenLevel });
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  const closed = new Set();
  // The shortest way within the breath left; with none, within the breath
  // and the drowning after it, the last seconds there are.
  const find = () => airRoute(bot, closed, { budgetS: breathSeconds(bot) }) || airRoute(bot, closed, { budgetS: breathSeconds(bot) + drowningSeconds(bot) });
  let route = find();
  if (!route) return straightUp(bot, task);
  const deadline = Date.now() + 15000;
  let index = 0;
  // Air comes before anything, and a swimmer held still is spending it for
  // nothing: mid-92-b pressed jump into a lily pad the way to air went
  // through, not a hair of movement for thirteen seconds, and drowned
  // (2026-09-25). Whatever holds it (a block the search misread, a boat, a
  // current), a second with no ground gained and no air back closes the cell
  // it was making for, and the way is found again from where it is; with
  // none left, straight up, digging.
  const STILL_MS = 1000;
  const mark = () => ({ at: Date.now(), p: bot.entity.position.clone(), air: bot.oxygenLevel });
  let last = mark();
  try {
    // A reconnect starts with a full client air bar even when the saved player
    // is underwater. Require actual breathable headroom as well as full air.
    while (bot.oxygenLevel < 20 || headSubmerged(bot)) {
      task.check();
      if (Date.now() >= deadline) throw new Error('Could not reach breathable air along the observed swimming route');
      const p = bot.entity.position;
      // A block in the way on the route is dug when the bot is beside it.
      for (const cell of route[index].digs || []) {
        const block = bot.blockAt(cell);
        if (!block || block.boundingBox !== 'block') continue;
        // Let go and sink onto the floor: a dig afloat takes five times as
        // long. Not for one that comes away at a touch (a lily pad).
        bot.clearControlStates();
        if (!(digSeconds(bot, block) < 0.5)) for (let i = 0; i < 12 && !bot.entity.onGround; i++) { task.check(); await sleep(50); }
        try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
        await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
        try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
        task.check();
        last = mark();
      }
      // Still with the eyes out of the water is breathing, not stuck.
      if (p.distanceTo(last.p) > 0.15 || bot.oxygenLevel > last.air || !headSubmerged(bot)) last = mark();
      else if (Date.now() - last.at > STILL_MS) {
        closed.add(`${route[index]}`);
        onAction({ action: 'surface', oxygen: bot.oxygenLevel, heldOutOf: { x: route[index].x, y: route[index].y, z: route[index].z } });
        bot.clearControlStates();
        route = find(); index = 0; last = mark();
        if (!route) return await straightUp(bot, task);
        continue;
      }
      const target = route[index].offset(0.5, 0, 0.5);
      const horizontal = Math.hypot(target.x - p.x, target.z - p.z);
      // A cell lower than the swimmer is sunk to, not swum over: trial 87's
      // way to air went down a block under a low ceiling and up again, and
      // the swimmer, holding jump the whole time and counting the lower
      // cell reached from above it, floated against the ceiling and drowned.
      // The feet held at the cell's own height, within a tenth: under a
      // low ceiling a tenth too high is a head against the rock.
      const lower = target.y < p.y - 0.1;
      const reached = horizontal < 0.35 && Math.abs(p.y - target.y) <= 0.3;
      if (reached && index < route.length - 1) { index++; continue; }
      if (horizontal > 0.2) await bot.lookAt(new Vec3(target.x, p.y + 1.62, target.z), true);
      bot.setControlState('forward', horizontal > 0.2 && !(lower && p.y - target.y > 0.4));
      bot.setControlState('jump', !lower && p.y < target.y + 0.05 && (bot.entity.isInWater || p.y < target.y));
      bot.setControlState('sneak', lower && !!bot.entity.isInWater);
      await sleep(50);
    }
    task.check();
  } finally { bot.clearControlStates(); }
}

// No observed swimming route: straight up, as a player trapped under water
// goes, digging what is over the head (a fallen sand ceiling keeps coming,
// so it keeps being dug) and swimming through what is not. Trial 7's bot
// broke into a lakebed on its way up a staircase, the sand came down and the
// water after it, and "no observed swimming route" was thrown twenty times a
// second until it drowned (2026-09-24).
// Only where the way up fits the time there is: every block over the head
// at the game's time with the best tool from where the bot stands, a step
// a cell. mid-244-y sank under a lid twelve blocks of stone thick and dug at
// it by hand, afloat, until it drowned (note 477).
function secondsUp(bot) {
  const feet = bot.entity.position.floored();
  let seconds = 0;
  for (let y = 2; y <= 40; y++) {
    const b = bot.blockAt(feet.offset(0, y, 0));
    if (!b) return null;
    if (b.boundingBox === 'block') { const t = digSeconds(bot, b, feet.offset(0, y - 2, 0)); if (t == null) return null; seconds += t; }
    else if (!swimmableWater(b)) return seconds + STEP_S;
    seconds += STEP_S;
  }
  return null;
}
async function straightUp(bot, task, { maxMs = 8000 } = {}) {
  const deadline = Date.now() + maxMs;
  // Worded to match the minute's pause after a failed swim (maintainVitals
  // looks for "breathable air"): unmatched, it ran every tick with the air
  // bar full in trial 11's flooded shaft (2026-09-24).
  const up = secondsUp(bot), left = breathSeconds(bot) + drowningSeconds(bot);
  if (up == null || up > left) throw new Error(`No way up to breathable air found: straight up ${up == null ? 'cannot be dug through' : `takes about ${Math.round(up)} s`}, with ${Math.round(left)} s of breath and health left`);
  try {
    while ((bot.oxygenLevel ?? 20) < 20 || headSubmerged(bot)) {
      task.check();
      if (Date.now() >= deadline) throw new Error('No way up to breathable air found: dug and swam straight up for eight seconds');
      const above = bot.blockAt(bot.entity.position.offset(0, 2, 0).floored());
      if (above && above.boundingBox === 'block' && above.diggable && !/bedrock/.test(above.name)) {
        bot.clearControlStates();
        try { await require('./skills').equipBestTool(bot, above); } catch (_) { /* the hand, then */ }
        await bot.lookAt(above.position.offset(0.5, 0.5, 0.5), true);
        try { await bot.dig(above, true); } catch (_) { await sleep(100); }
        continue;
      }
      await require('./motion').move(bot, task, { label: 'swim_up', keys: ['jump'], sneak: false, why: 'no swimming route: straight up to air',
        maxMs: 300, tick: 50, until: () => !headSubmerged(bot) });
    }
  } finally { bot.clearControlStates(); }
}

// In powder snow: the bot sinks into it, and after seven seconds inside it
// freezes, a point every two seconds. Trial 89 spawned in a drift four deep,
// read the snow over its head as a roof, tried to dig out as from a mine,
// and froze to death in under a minute. The way out is the nearest cell
// with no powder snow at the feet or the head and a floor under it, the
// snow on the way dug (a hand takes it in a moment), then walked to.
const POWDER = 'powder_snow';
function inPowderSnow(bot) {
  const feet = bot.entity?.position?.floored();
  return !!feet && [0, 1].some(dy => bot.blockAt?.(feet.offset(0, dy, 0))?.name === POWDER);
}
function snowRoute(bot) {
  const start = bot.entity.position.floored();
  const clearOrSnow = b => b && (b.boundingBox === 'empty' || b.name === POWDER) && !/lava|water|fire/.test(b.name);
  const out = p => [0, 1].every(dy => { const b = bot.blockAt(p.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && b.name !== POWDER && !/lava|water|fire/.test(b.name); }) &&
    bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' && bot.blockAt(p.offset(0, -1, 0))?.name !== POWDER;
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];
  const queue = [{ p: start, path: [] }], seen = new Set([`${start}`]);
  for (let i = 0; i < queue.length && i < 2048; i++) {
    const { p, path } = queue[i];
    if (path.length && out(p)) return path;
    for (const d of dirs) {
      const next = p.plus(d);
      if (seen.has(`${next}`) || next.distanceTo(start) > 8) continue;
      seen.add(`${next}`);
      if (!clearOrSnow(bot.blockAt(next)) || !clearOrSnow(bot.blockAt(next.offset(0, 1, 0)))) continue;
      // Down only onto something: a drift over a drop is not the way out.
      if (d.y === 0 && bot.blockAt(next.offset(0, -1, 0))?.boundingBox !== 'block' && bot.blockAt(next.offset(0, -1, 0))?.name !== POWDER) continue;
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}
async function outOfPowderSnow(bot, task, onAction = () => {}) {
  const route = snowRoute(bot);
  onAction({ action: 'out_of_powder_snow', steps: route?.length ?? null });
  if (!route) {
    // No way through the snow found from the blocks: the nearest firm
    // ground with no snow on it, walked to.
    const { firmGround } = require('./survival');
    const cell = firmGround(bot, 8);
    if (!cell) return false;
    const { goals } = require('mineflayer-pathfinder');
    try { await bot.pathfinder.goto(new goals.GoalBlock(cell.x, cell.y, cell.z)); } catch (err) { if (err.name === 'Cancelled') throw err; }
    return !inPowderSnow(bot);
  }
  for (const cell of route) {
    for (const c of [cell, cell.offset(0, 1, 0)]) {
      task.check();
      const b = bot.blockAt(c);
      if (b?.name !== POWDER) continue;
      await bot.lookAt(c.offset(0.5, 0.5, 0.5), true);
      try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
    }
  }
  // Also what the bot stands in now, feet and head.
  const feet = bot.entity.position.floored();
  for (const c of [feet, feet.offset(0, 1, 0)]) { const b = bot.blockAt(c); if (b?.name === POWDER) { try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; } } }
  const end = route.at(-1);
  const { goals } = require('mineflayer-pathfinder');
  try { await bot.pathfinder.goto(new goals.GoalBlock(end.x, end.y, end.z)); } catch (err) { if (err.name === 'Cancelled') throw err; }
  return !inPowderSnow(bot);
}

// Fire: trial 101 walked to an oak by the lava pool it had found, the
// forest caught, and it stood in the burning grass from twenty health to
// nothing in twenty seconds, mining the tree, with nothing answering the
// hurt (2026-09-25). In fire, or burning with fire beside it, the bot gets
// to the nearest cell two blocks clear of any fire, or into water, which
// puts it out; burning with no fire near, it burns out in a few seconds.
const FIRE = new Set(['fire', 'soul_fire']);
const onFire = bot => !!(bot.entity?.metadata?.[0] & 1);
function fireNear(bot, p, r) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 2; dy++) if (FIRE.has(bot.blockAt?.(p.offset(dx, dy, dz))?.name)) return true;
  return false;
}
// Or told so by the server: an in-fire hurt within the last second and a
// half (session.js). The flames a fireball lights can sit where the feet
// cell does not show them: mid-229-g took ten in-fire hurts in seven
// seconds, sealing a pocket, and nothing got it out (2026-09-27).
function inFire(bot) {
  const feet = bot.entity?.position?.floored();
  if (!feet) return false;
  if (bot._inFireAt > Date.now() - 1500) return true;
  if ([0, 1].some(dy => FIRE.has(bot.blockAt?.(feet.offset(0, dy, 0))?.name))) return true;
  return onFire(bot) && fireNear(bot, feet, 1);
}
// A way round the flames first; ringed by them, a way through (a player
// runs through a block of fire rather than stand in one). Then the same
// along cells beside a fall that kills, walked crouched (outOfFire): on a
// one-wide span over the lava sea every cell out is beside the drop, and
// refusing them all left mid-243-ad-nether-1 standing in the fire at the
// span's end from 7.5 to none, its far cells clear of any flame (note 575).
function fireRoute(bot) {
  return fireRouteThrough(bot, false) || fireRouteThrough(bot, true) || fireRouteThrough(bot, false, { edges: true }) || fireRouteThrough(bot, true, { edges: true });
}
function fireRouteThrough(bot, throughFire, { edges = false } = {}) {
  const { fallBeside } = require('./movement');
  const start = bot.entity.position.floored();
  const clear = b => b && b.boundingBox === 'empty' && (throughFire || !FIRE.has(b.name)) && b.name !== 'lava';
  const water = p => bot.blockAt(p)?.name === 'water';
  const floor = p => { const b = bot.blockAt(p.offset(0, -1, 0)); return b && (b.boundingBox === 'block' || b.name === 'water') && b.name !== 'lava' && !require('./terrain').hotFloor(b); };
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const queue = [{ p: start, path: [] }], seen = new Set([`${start}`]);
  for (let i = 0; i < queue.length && i < 4096; i++) {
    const { p, path } = queue[i];
    if (path.length && (water(p) || !fireNear(bot, p, 2))) return path;
    for (const d of dirs) for (const dy of [0, 1, -1]) {
      const next = p.plus(d).offset(0, dy, 0);
      if (seen.has(`${next}`) || next.distanceTo(start) > 12) continue;
      if (!(clear(bot.blockAt(next)) || water(next)) || !clear(bot.blockAt(next.offset(0, 1, 0))) || !(water(next) || floor(next))) continue;
      // A step up needs the head room over the cell left.
      if (dy === 1 && !clear(bot.blockAt(p.offset(0, 2, 0)))) continue;
      // No cell beside a fall that kills (note 545's rule, movement.js
      // fallBeside) on the run at a sprint: it carries on past the cell it
      // stops on. mid-208-k-nether-2 ran out of a fire at 19.5 health onto
      // a cell by an edge and over it, forty-seven into lava (note 548).
      // Crouched (edges), a body does not walk off an edge; a step down
      // is one a crouched body will not take, so none beside a fall.
      const fall = !water(next) && fallBeside(bot, next);
      if (fall && (!edges || dy === -1)) continue;
      seen.add(`${next}`);
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}
// Each step of a route out of fire, and how it is walked: at a sprint, or
// crouched (the game's walk at three tenths, about 1.3 blocks a second)
// where the cell left or the cell stepped to is beside a fall that kills.
const SNEAK = 4.317 * 0.3;
function fireSteps(bot, route) {
  const { fallBeside } = require('./movement');
  const edge = p => bot.blockAt(p)?.name !== 'water' && !!fallBeside(bot, p);
  let from = bot.entity.position.floored();
  return route.map(cell => { const crouched = edge(from) || edge(cell); from = cell; return { cell, crouched }; });
}
function fireRouteSeconds(bot, route) {
  return fireSteps(bot, route).reduce((s, step) => s + 1 / (step.crouched ? SNEAK : SPRINT), 0);
}
async function outOfFire(bot, task, onAction = () => {}, route = fireRoute(bot)) {
  onAction({ action: 'out_of_fire', steps: route?.length ?? null, health: bot.health });
  if (!route) return false;
  // Walked cell by cell on the keys: the path search will not start from
  // a cell of fire or cross one, and handed the route it returned at once
  // (the arena: burned in place three times out of three). A mob in a
  // cell is no wall: a body pushes past a magma cube or a blaze as a
  // player's does, so the keys stay held until the cell is reached.
  bot.pathfinder?.setGoal?.(null);
  const { move } = require('./motion');
  for (const [i, { cell, crouched }] of fireSteps(bot, route).entries()) {
    const target = cell.offset(0.5, 0, 0.5);
    // At a sprint the cells on the way are passed through, not stood on:
    // held to a third of a block, each one overshot and was turned back to.
    // Crouched beside the fall, each is stood on.
    const near = i === route.length - 1 || crouched ? 0.45 : 0.8;
    const there = () => { const here = bot.entity.position; return Math.hypot(target.x - here.x, target.z - here.z) < near && Math.abs(here.y - cell.y) < 0.6; };
    const up = cell.y > Math.floor(bot.entity.position.y + 0.01);
    const look = target.offset(0, 1.6, 0);
    await move(bot, task, crouched
      ? { label: 'out_of_fire', keys: up ? ['forward', 'jump'] : ['forward'], sneak: true, look, maxMs: 2000, tick: 50, until: there }
      : { label: 'out_of_fire', keys: up ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false, why: 'running out of fire', look, maxMs: 1500, tick: 50, until: there });
  }
  return !inFire(bot);
}
// Up out of the flames on a block put where they are, as a player does
// with no cell to run to: the block put in the fire's cell puts that
// flame out, and the body stands a block over it. Any full block that
// holds on the floor it is put on.
const RISE_BLOCKS = new Set(['netherrack', 'cobblestone', 'cobbled_deepslate', 'dirt', 'nether_bricks', 'blackstone', 'basalt', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'soul_soil', 'soul_sand', 'gravel', 'sand', 'red_sand', 'end_stone', 'deepslate']);
function riseOutOfFire(bot) {
  const feet = bot.entity.position.floored();
  const block = bot.inventory?.items?.().find(i => RISE_BLOCKS.has(i.name));
  if (!block || bot.blockAt(feet.offset(0, -1, 0))?.boundingBox !== 'block') return null;
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !FIRE.has(b.name) && !/lava|water/.test(b.name); };
  const top = feet.offset(0, 1, 0);
  if (!open(top) || !open(top.offset(0, 1, 0))) return null;
  // Flames beside the body standing there can spread to it; those beside
  // the block under it, a level down, do not touch it.
  const around = dy => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].filter(([dx, dz]) => dy.some(y => FIRE.has(bot.blockAt(top.offset(dx, y, dz))?.name))).length;
  return { block, top, flamesBeside: around([0, 1]), flamesBelow: around([-1]), fall: require('./movement').fallBeside(bot, top) };
}
async function riseOnBlock(bot, task, onAction = () => {}, { action = 'out_of_fire', done = () => !inFire(bot) } = {}) {
  const rise = riseOutOfFire(bot);
  onAction({ action, way: 'rise_on_block', health: bot.health });
  if (!rise) return false;
  bot.pathfinder?.setGoal?.(null);
  const { pillarUp } = require('./pillar-recovery');
  try { await pillarUp(bot, task, rise.top.y, { maxBlocks: 1, threats: false, canDig: () => false, blocks: [...RISE_BLOCKS] }); }
  catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
  return done();
}

// The hot floor (note 579): a magma block, or a lit campfire, under the
// body. mid-242-aa-nether-3's crouched walk at a drop ended with its box's
// edge on a magma block beside a hole into the lava, the keys let go, and
// it stood there from 20 to none in seventeen seconds, the work, the rest
// before a fight and a meal each standing still on it; nothing looked at the
// floor it stood on, only at the floor of cells it chose to walk to.
// Crouched on a magma block the body is not hurt (the game's rule), and a
// campfire hurts crouched or not.
const sneaking = bot => !!(bot.getControlState ? bot.getControlState('sneak') : bot.controlState?.sneak);
function onHotFloor(bot) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  const hot = require('./terrain').hotUnderfoot(bot);
  return hot && !(hot.crouchSafe && sneaking(bot)) ? hot : null;
}
// The nearest cell off it, walked crouched: crouched, the magma passed over
// does not hurt and the body does not walk off an edge (so no step down).
// Other magma may be crossed on the way; a campfire is not.
function hotFloorRoute(bot, hot = onHotFloor(bot), radius = 8) {
  if (!hot) return null;
  const { hotFloor } = require('./terrain');
  const open = b => !!b && b.boundingBox === 'empty' && !FIRE.has(b.name) && !/lava|water|powder_snow/.test(b.name);
  const under = p => bot.blockAt(p.offset(0, -1, 0));
  const cool = p => !hotFloor(under(p));
  const standable = p => open(bot.blockAt(p)) && open(bot.blockAt(p.offset(0, 1, 0))) && under(p)?.boundingBox === 'block' &&
    (cool(p) || under(p).name === 'magma_block');
  const start = hot.cell, dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const queue = [{ p: start, path: [] }], seen = new Set([`${start}`]);
  for (let i = 0; i < queue.length && i < 2048; i++) {
    const { p, path } = queue[i];
    if (path.length && cool(p)) return path;
    for (const [dx, dz] of dirs) for (const dy of [0, 1]) {
      const next = p.offset(dx, dy, dz);
      if (seen.has(`${next}`) || Math.hypot(next.x - start.x, next.z - start.z) > radius || !standable(next)) continue;
      if (dy === 1 && !open(bot.blockAt(p.offset(0, 2, 0)))) continue;
      seen.add(`${next}`);
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}
async function offHotFloor(bot, task, onAction = () => {}, route = hotFloorRoute(bot)) {
  onAction({ action: 'off_hot_floor', steps: route?.length ?? null, health: bot.health });
  if (!route) return false;
  bot.pathfinder?.setGoal?.(null);
  const { move } = require('./motion');
  for (const cell of route) {
    const target = cell.offset(0.5, 0, 0.5);
    // Stood on each, near its middle: the game hurts by the nearest block
    // under the box, so the cell's own floor is the one that counts there.
    const there = () => { const here = bot.entity.position; return Math.hypot(target.x - here.x, target.z - here.z) < 0.3 && Math.abs(here.y - cell.y) < 0.6; };
    const up = cell.y > Math.floor(bot.entity.position.y + 0.01);
    await move(bot, task, { label: 'off_hot_floor', keys: up ? ['forward', 'jump'] : ['forward'], sneak: true, look: target.offset(0, 1.6, 0), maxMs: 2000, tick: 50, until: there });
  }
  return !onHotFloor(bot);
}
// Crouched where it stands: held while the body stays on the magma and no
// held-key walk is running, let go once it is off (whatever walked it off).
// A walk that stands it up on the magma again meets the question again.
function crouchOnHotFloor(bot, onAction = () => {}) {
  onAction({ action: 'off_hot_floor', way: 'crouch_on_hot_floor', health: bot.health });
  bot.setControlState?.('sneak', true);
  if (typeof bot.on === 'function' && !bot._hotFloorCrouch) {
    const release = () => {
      if (bot._controller) return;
      const still = require('./terrain').hotUnderfoot(bot);
      if (still?.crouchSafe && sneaking(bot)) return;
      bot.removeListener?.('physicsTick', release);
      if (bot._hotFloorCrouch === release) delete bot._hotFloorCrouch;
      if (!still?.crouchSafe && sneaking(bot)) bot.setControlState?.('sneak', false);
    };
    bot._hotFloorCrouch = release;
    bot.on('physicsTick', release);
  }
  return true;
}

// Water within eight blocks a burning body can run into (douse).
function pondNear(bot) {
  const here = bot.entity.position.floored();
  for (let r = 1; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, -1, 1]) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const c = here.offset(dx, dy, dz);
    if (bot.blockAt(c)?.name === 'water' && !/lava|fire/.test(bot.blockAt(c.offset(0, 1, 0))?.name || '')) return c;
  }
  return null;
}
// Whether the fire on the bot is one the reflex can do anything about: in
// fire (flames at the feet, beside a burning body, or the server's in-fire
// hurt), which is stepped out of; or alight where water puts it out, a
// bucket carried or a pond within eight, which the Nether never has. Alight
// with neither, only time puts it out (a fireball's five seconds, the
// eight after fire, lava's fifteen), and standing still spends that time
// under whatever lit it: mid-235-q-nether-3, mid-208-k and
// mid-235-q-nether-2-fortress-1 each stood five to seven seconds on the
// reflex, keys let go, a blaze five to forty-eight blocks off shooting on,
// 20 to 9, 15.3 to 5.9 and 9 to 5, the stance not asked till it ended
// (note 548). That burn is a fact of every choice then (its seconds left,
// combat-estimate burnLeft), and who acts is the claims' question.
function fireToAnswer(bot) {
  if (inFire(bot)) return true;
  // An enchanted golden apple carried is a way too, in any dimension: its
  // fire resistance ends what burning is left (body_way, note 549).
  if (onFire(bot) && bot.inventory?.items?.().some(i => i.name === 'enchanted_golden_apple')) return true;
  if (!onFire(bot) || /nether/.test(String(bot.game?.dimension || ''))) return false;
  if (bot.inventory?.items?.().some(i => i.name === 'water_bucket')) return true;
  return !!(bot.blockAt && pondNear(bot));
}

// Burning with no fire about (lava sets a body burning for a quarter of a
// minute after it is left): water puts it out, as a player pours the bucket
// at their feet and takes it back. mid-110-b stepped into the lava pool it
// was getting obsidian from, got out, and burned from thirteen health to two
// standing beside it with a water bucket in its pack (2026-09-25).
async function douse(bot, task, onAction = () => {}) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (/nether/.test(String(bot.game?.dimension || ''))) return false;
  // No water carried: water within eight blocks is walked into, as a player
  // runs for the pond. mid-110-j came out of a lava pool with an empty bucket
  // and burned from sixteen health to nothing on the bank (2026-09-26).
  if (!bucket) {
    const pond = pondNear(bot);
    return pond ? intoWater(bot, task, pond, onAction) : false;
  }
  const feet = bot.entity.position.floored(), below = feet.offset(0, -1, 0);
  if (bot.blockAt(below)?.boundingBox !== 'block' || !['air', 'cave_air'].includes(bot.blockAt(feet)?.name)) return false;
  onAction({ action: 'douse', health: bot.health });
  await bot.equip(bucket, 'hand'); task.check();
  await bot.lookAt(below.offset(0.5, 1, 0.5), true);
  bot.activateItem();
  for (let n = 0; n < 20 && onFire(bot); n++) { await sleep(50); task.check(); }
  // The water back into the bucket, for the next time and the obsidian.
  const empty = bot.inventory.items().find(i => i.name === 'bucket');
  if (empty && bot.blockAt(feet)?.name === 'water') {
    await bot.equip(empty, 'hand'); task.check();
    await bot.lookAt(feet.offset(0.5, 0.9, 0.5), true);
    bot.activateItem();
    await sleep(150);
  }
  return !onFire(bot);
}

async function intoWater(bot, task, pond, onAction = () => {}) {
  onAction({ action: 'douse', health: bot.health, pond: { ...pond } });
  await require('./motion').move(bot, task, { label: 'into_water', keys: ['forward', 'sprint'], sneak: false, why: 'burning, into the water to put it out',
    look: pond.offset(0.5, 1, 0.5), maxMs: 4000, tick: 50, until: () => !onFire(bot) || !!bot.entity.isInWater });
  return !onFire(bot);
}

function safeFood(bot, item) { return !!bot.registry.foodsByName?.[item.name] && !unsafeFoods.has(item.name); }

// Food with a Hunger side effect and nothing worse. The effect costs well
// under one hunger point over its thirty seconds; the item gives several.
// With nothing else in the pockets it is the only way back to the eighteen
// that regeneration needs: the dream run sat sealed in a pocket beside a
// blaze spawner at ten health and seventeen hunger for ten minutes, two
// rotten flesh in its pack, healing nothing, because it would not eat them.
const lastResortFoods = new Set(['rotten_flesh', 'chicken']);
function lastResortFood(bot) {
  return bot.inventory.items().find(item => lastResortFoods.has(item.name) && bot.registry.foodsByName?.[item.name]);
}
// The game's side effects of these foods, which minecraft-data's foods do
// not carry (it has the hunger and saturation: rotten flesh 4 and 0.8, raw
// chicken 2 and 1.2): rotten flesh gives Hunger for thirty seconds four
// times in five, raw chicken three times in ten. Hunger I adds 0.005
// exhaustion a tick, three over the thirty seconds, and four exhaustion is
// one point off saturation first, then hunger: about three quarters of a
// point, against the four the flesh gives. Said wherever the food is,
// since four of the day's low-health deaths carried rotten flesh told only
// "no food" (note 515: mid-231-o, mid-207-l, mid-211-x, mid-231-q).
const SIDE_EFFECTS = { rotten_flesh: { chance: 0.8, effect: 'hunger', seconds: 30 }, chicken: { chance: 0.3, effect: 'hunger', seconds: 30 } };
const HUNGER_EFFECT_POINTS = 0.005 * 20 * 30 / 4;
function sideEffectSays(name) {
  const e = SIDE_EFFECTS[name];
  return e ? `each eaten has a ${Math.round(e.chance * 100)}% chance of Hunger for ${e.seconds} seconds, which spends about ${HUNGER_EFFECT_POINTS} of a hunger point (saturation first)` : null;
}

const CLOSE = 5;
// Close and able to get at the bot: through a wall it is not. Sealed in a
// pocket at three health with a skeleton outside, the dream run would not
// eat, so could not heal, and the work walked it out to be shot (2026-09-24).
function closeHostile(bot) {
  const here = bot.entity?.position;
  if (!here) return false;
  const eye = here.offset(0, 1.62, 0);
  const reaches = e => {
    if (typeof bot.world?.raycast !== 'function') return true;
    const aim = e.position.offset(0, Math.min(e.height || 1.6, 1.6), 0), dir = aim.minus(eye), d = dir.norm();
    if (d < 1.2) return true;
    const hit = bot.world.raycast(eye, dir.scaled(1 / d), d);
    return !hit || eye.distanceTo(hit.intersect || hit.position) >= d - 0.5;
  };
  // A creeper's reach is its walk to lighting distance and its fuse: one
  // that would be there before the meal and its answer are done is close.
  // mid-214-c ate at 18.6 health with one eight blocks off and in sight,
  // stood still three and a half seconds, and one blast took it all
  // (2026-09-26).
  // A mob that throws or shoots reaches the bot as far as its range: the
  // meal stands still in it. mid-237-b, poisoned, stood eating three
  // seconds with a witch ten blocks off and its harming potion took four
  // (2026-09-26).
  const { APPROACH, LIGHTS_AT, RANGE } = require('./combat-estimate');
  const creeperReach = LIGHTS_AT + APPROACH * 2 * EAT_MEAL_SECONDS;
  const SHOOTERS = { skeleton: 15, stray: 15, bogged: 15, pillager: 15, ...RANGE };
  const reach = name => name === 'creeper' ? Math.max(CLOSE, creeperReach) : Math.max(CLOSE, SHOOTERS[name] || 0);
  // Hostile as the danger list has it (danger.js hostileEntities), not by
  // the registry's type, which calls a hoglin an animal and a ghast, a
  // magma cube, a slime and a phantom a mob: mid-208-k-nether-1 ate with a
  // hoglin at 1.2 blocks and again at 2, bitten 9.4 to 4.6 and 4 to none
  // while the meal stood still (note 552). A provoked neutral counts; a
  // piglin left be by the gold worn does not.
  const danger = require('./danger');
  const listed = new Set(danger.hostileEntities(bot, 64));
  const hostile = e => listed.has(e) || (!['piglin', 'zombified_piglin'].includes(e.name) && (bot.registry?.entitiesByName?.[e.name]?.type === 'hostile' || e.type === 'hostile'));
  // And a biter coming at the bot is close when its own walk has it at the
  // bot before the meal is done (danger.js coming, the jar's speeds): a
  // hoglin comes about 3.9 blocks a second, past the five counted here in
  // the meal's second and a half.
  const soon = new Set(danger.coming(bot).filter(t => t.atBotIn <= EAT_MEAL_SECONDS).map(t => t.entity));
  // Through a wall is not able to get at the bot, but round a corner is: a
  // biter out of sight within five with a way to the bot (danger.js
  // unseenClose, walk-reach) is close. mid-242-ac-nether-1-fortress-1 ate
  // at 13.1 health with a wither skeleton 3.6 blocks off round a fortress
  // corner, the claim saying nothing of it, and its first blow took 6.7
  // (note 559).
  let round;
  const roundCorner = e => { if (!round) { try { round = new Set(danger.unseenClose(bot).map(t => t.entity)); } catch (_) { round = new Set(); } } return round.has(e); };
  return Object.values(bot.entities || {}).some(e => e !== bot.entity && e.position && e.isValid !== false &&
    hostile(e) && (e.position.distanceTo(here) <= reach(e.name) || soon.has(e)) && (reaches(e) || roundCorner(e)));
}

// The biters coming at the bot while it would eat, for the meal's claim:
// each with its speed, how soon it is at the bot against the meal's
// seconds, and its hit through what is worn. mid-208-k-nether-1's claim
// read "Eat beef now, about 1.6 seconds" with a hoglin eleven blocks off
// walking up at 3.9 blocks a second, at the bot a second after the meal,
// and turn_priority gave vitals the turn (note 552).
function comingWhileEating(bot) {
  if (!bot?.entity?.position) return [];
  const { MOBS, afterArmour, armourOf } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean));
  return require('./danger').coming(bot).slice(0, 3).map(t => {
    const m = MOBS[t.entity.name] || {};
    return { name: t.entity.name, distance: Math.round(t.distance * 10) / 10, blocksASecond: Math.round(t.speed * 10) / 10, atBotInSeconds: Math.round(t.atBotIn * 10) / 10,
      ...(m.hit ? { hitsFor: Math.round(afterArmour(m.hit, worn) * 10) / 10 } : {}), ...(m.note ? { note: m.note } : {}) };
  });
}
// A second and six tenths eating (survival.js EAT_SECONDS).
const EAT_MEAL_SECONDS = 1.6;

function chooseFood(bot) {
  return bot.inventory.items().filter(item => safeFood(bot, item))
    .sort((a, b) => {
      const value = item => bot.registry.foodsByName[item.name].effectiveQuality - (item.name.includes('golden') ? 100 : 0);
      return value(b) - value(a);
    })[0];
}

async function until(task, predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    task.check();
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(100);
  }
  task.check();
}

// The ways out of fire, a block over the head and the water, for body_way
// (src/body.js), each run by the mechanics below; the old rule's way first,
// its fallback.
const round = n => Math.round(n * 10) / 10;
// A sprint, about 5.6 blocks a second.
const SPRINT = 5.6;
// A block put underfoot on a jump: half the survival step's pillar seconds
// (survival.js PILLAR_SECONDS, two blocks).
const PILLAR_RISE_SECONDS = 0.75;
function fireWays(bot, task, onAction = () => {}) {
  const ways = {};
  const standing = inFire(bot), nether = /nether/.test(String(bot.game?.dimension || ''));
  const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple');
  const eat = () => ({ description: `Eat the enchanted golden apple (${apple.count} carried): about ${EAT_MEAL_SECONDS} seconds eating first, then fire resistance for five minutes (burning no longer hurts), sixteen extra health as absorption and strong regeneration.`,
    run: async () => { onAction({ action: 'eat', item: apple.name, health: bot.health, burning: true }); return require('./survival').eatApple(bot, task, apple); } });
  if (standing) {
    // Every way out there is (note 575): the run clear of any edge; the
    // crouched walk along cells beside a fall that kills, where it is the
    // only way or the quicker; a block put in the fire's cell to stand on.
    const to = route => bot.blockAt(route.at(-1))?.name === 'water' ? 'water' : 'a cell two blocks from any flame';
    const steps = route => `${route.length} step${route.length === 1 ? '' : 's'}`;
    const clear = fireRouteThrough(bot, false), route = clear || fireRouteThrough(bot, true);
    if (route) ways.out_of_fire = { description: `Run out of the fire, ${steps(route)} to ${to(route)}${clear ? '' : ', through a flame on the way'}: about ${round(Math.max(0.3, route.length / SPRINT))} seconds at a sprint, then burning on up to eight seconds unless it ends in water.`,
      run: () => outOfFire(bot, task, onAction, route) };
    const edgeClear = fireRouteThrough(bot, false, { edges: true }), edgeRoute = edgeClear || fireRouteThrough(bot, true, { edges: true });
    const edgeSteps = edgeRoute ? fireSteps(bot, edgeRoute) : [];
    const edgeSeconds = edgeRoute ? fireRouteSeconds(bot, edgeRoute) : Infinity;
    if (edgeSteps.some(s => s.crouched) && (!route || edgeSeconds < route.length / SPRINT)) {
      const { fallBeside } = require('./movement');
      const falls = [bot.entity.position.floored(), ...edgeRoute].map(c => fallBeside(bot, c)).filter(Boolean);
      const worst = falls.find(f => f.into === 'lava') || falls[0];
      const drop = worst.into === 'lava' ? `a drop into lava${worst.fall ? ` ${worst.fall} down` : ''}` : worst.into === 'deep' ? `a drop of more than ${worst.fall}` : `a drop of ${worst.fall} onto ground that costs half the health or more`;
      const crouched = edgeSteps.filter(s => s.crouched).length;
      ways.crouch_out_of_fire = { description: `Walk out of the fire crouched, ${steps(edgeRoute)} to ${to(edgeRoute)}${edgeClear ? '' : ', through a flame on the way'}, ${crouched} of them beside ${drop}: crouched, a body does not walk off an edge (a hit or a push still throws it), at about ${round(SNEAK)} blocks a second; about ${round(edgeSeconds)} seconds, then burning on up to eight seconds unless it ends in water.`,
        run: () => outOfFire(bot, task, onAction, edgeRoute) };
    }
    const rise = riseOutOfFire(bot);
    if (rise) ways.rise_on_block = { description: `Jump and put a block of ${rise.block.name.replaceAll('_', ' ')} (${rise.block.count} carried) in the fire's cell underfoot, which puts that flame out, and stand on it a block up: about ${round(PILLAR_RISE_SECONDS)} seconds; ${rise.flamesBeside ? `${rise.flamesBeside} flame${rise.flamesBeside === 1 ? '' : 's'} still beside the cell it rises to, so the body may stand beside fire there` : 'no flame beside the cell it rises to'}${rise.flamesBelow ? ` (${rise.flamesBelow} beside the block under it, a level down, which do not touch a body standing on it)` : ''}${rise.fall ? `, and ${rise.fall.into === 'lava' ? 'a drop into lava' : 'a fall that costs half the health or more'} beside it` : ''}; then burning on up to eight seconds.`,
      run: () => riseOnBlock(bot, task, onAction) };
    if (apple) ways.eat_golden_apple = eat();
    return ways;
  }
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  const feet = bot.entity.position.floored();
  const pours = bucket && !nether && bot.blockAt(feet.offset(0, -1, 0))?.boundingBox === 'block' && ['air', 'cave_air'].includes(bot.blockAt(feet)?.name);
  if (pours) ways.douse_bucket = { description: 'Pour the water bucket at the feet, which puts the fire out at once, and take the water back: about a second.', run: () => douse(bot, task, onAction) };
  // The Nether has no water to run into (fireToAnswer).
  const pond = !nether && pondNear(bot);
  if (pond) {
    const d = round(pond.offset(0.5, 0, 0.5).distanceTo(bot.entity.position));
    ways.to_water = { description: `Run into the water ${d} blocks off at (${pond.x}, ${pond.y}, ${pond.z}): about ${round(Math.max(0.3, d / SPRINT))} seconds at a sprint, burning meanwhile, and the fire is out.`,
      run: () => intoWater(bot, task, pond, onAction) };
  }
  const left = Math.max(1, Math.round(require('./combat-estimate').burnLeft(bot))), hp = bot.health ?? 20;
  ways.burn_out = { description: `Leave it to burn out and go on: about ${left} second${left === 1 ? '' : 's'} of fire left, a health a second that armour does not stop, about ${Math.min(left, round(hp))} health${left >= hp ? ', all the health the bot has' : ''}${nether ? '; in the Nether nothing else puts it out' : ''}. Asked again if health falls ${require('./body').HOLD_HEALTH} more.`,
    hold: 15, run: async () => false };
  if (apple) ways.eat_golden_apple = eat();
  // The old rule: the bucket poured where it can be, else (none carried)
  // the water run into, else nothing.
  const first = pours ? 'douse_bucket' : !bucket && pond ? 'to_water' : 'burn_out';
  return { [first]: ways[first], ...ways };
}
// The ways off a hot floor (note 579), each said with where it goes and
// its seconds: the step off to the nearest floor that does not hurt, walked
// crouched; on a magma block, the crouch where it stands (the game does not
// hurt a crouched body on one); a block put in the cell over it to stand
// on; the golden apple, whose fire resistance stops the hot floor's hurt.
// The first is the fallback's: the step off where there is one.
function hotFloorWays(bot, task, onAction = () => {}, hot = onHotFloor(bot)) {
  const ways = {};
  if (!hot) return ways;
  const floor = hot.block.name.replaceAll('_', ' ');
  const { fallBeside } = require('./movement');
  const route = hotFloorRoute(bot, hot);
  if (route) {
    const end = route.at(-1), onto = bot.blockAt(end.offset(0, -1, 0))?.name?.replaceAll('_', ' ') || 'a block';
    const crossed = route.slice(0, -1).filter(c => bot.blockAt(c.offset(0, -1, 0))?.name === 'magma_block').length;
    const edges = [hot.cell, ...route].map(c => fallBeside(bot, c)).filter(Boolean);
    const worst = edges.find(f => f.into === 'lava') || edges[0];
    ways.step_off_hot_floor = { description: `Step off the ${floor} crouched, ${route.length} step${route.length === 1 ? '' : 's'} to (${end.x}, ${end.y}, ${end.z}) on ${onto}${crossed ? `, over ${crossed} more magma on the way` : ''}: crouched, a magma block does not hurt and a body does not walk off an edge${worst ? ` (${worst.into === 'lava' ? 'a drop into lava' : 'a fall that costs half the health or more'} beside the way)` : ''}; about ${round(Math.max(0.3, route.length / SNEAK))} seconds at about ${round(SNEAK)} blocks a second.`,
      run: () => offHotFloor(bot, task, onAction, route) };
  }
  if (hot.crouchSafe) ways.crouch_on_hot_floor = { description: `Crouch where it stands and stay crouched: the game does not hurt a crouched body on a magma block, so it stops at once, and the bot can rest, eat or wait here crouched. The crouch is let go once the body is off the magma; a walk that stands it up on the magma again is asked about again. Crouched, a body moves at about ${round(SNEAK)} blocks a second.`,
    run: async () => crouchOnHotFloor(bot, onAction) };
  const rise = hot.crouchSafe && bot.entity.position.floored().equals(hot.cell) ? riseOutOfFire(bot) : null;
  if (rise) ways.rise_on_block = { description: `Jump and put a block of ${rise.block.name.replaceAll('_', ' ')} (${rise.block.count} carried) in the cell over the ${floor}, and stand on it a block up, off the magma: about ${round(PILLAR_RISE_SECONDS)} seconds${rise.fall ? `, with ${rise.fall.into === 'lava' ? 'a drop into lava' : 'a fall that costs half the health or more'} beside it` : ''}.`,
    run: () => riseOnBlock(bot, task, onAction, { action: 'off_hot_floor', done: () => !onHotFloor(bot) }) };
  const apple = bot.inventory?.items?.().find(i => i.name === 'enchanted_golden_apple');
  if (apple) ways.eat_golden_apple = { description: `Eat the enchanted golden apple (${apple.count} carried) standing here: about ${EAT_MEAL_SECONDS} seconds eating first, hurt meanwhile, then fire resistance for five minutes, which stops the hot floor's hurt, sixteen extra health as absorption and strong regeneration.`,
    run: async () => { onAction({ action: 'eat', item: apple.name, health: bot.health, hotFloor: true }); return require('./survival').eatApple(bot, task, apple); } };
  return ways;
}
// The way out from under a block, as the old rule stepped: aside into an
// open cell with a floor and nothing that falls over it, then the dig of
// what is still there (maintainVitals below).
function asideCell(bot) {
  const feet = bot.entity.position.floored();
  const open = b => b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => feet.offset(dx, 0, dz))
    .find(c => open(bot.blockAt(c)) && open(bot.blockAt(c.offset(0, 1, 0))) && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' &&
      !/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/.test(bot.blockAt(c.offset(0, 2, 0))?.name || '')) || null;
}
function headWays(bot, task, onAction = () => {}) {
  const ways = {};
  const block = suffocatingBlock(bot) || bot.blockAt(bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0).floored());
  const aside = asideCell(bot);
  if (aside) ways.step_aside = { description: `Step out from under it into the open cell beside the feet at (${aside.x}, ${aside.y}, ${aside.z}): about half a second, nothing falling over that cell; what is still over the head after is dug.`,
    run: async () => {
      onAction({ action: 'dig_out_of_block', block: bot.blockAt(bot.entity.position.floored().offset(0, 1, 0))?.name, stepAside: { ...aside } });
      try {
        // Only a cancellation stops the step: the threat check would end it
        // at the first creeper in view.
        const only = { get cancelled() { return task.cancelled; }, label: task.label, check() { if (task.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
        await require('./motion').move(bot, only, { label: 'out_from_under', keys: ['forward'], sneak: false, why: 'stepping out from under a block over the head',
          look: aside.offset(0.5, 1.6, 0.5), maxMs: 1200, tick: 50, until: () => !headInBlock(bot) || bot.entity.position.floored().equals(aside) });
      } catch (err) { if (err.name === 'Cancelled') throw err; }
      return !headInBlock(bot);
    } };
  const secs = block ? digSeconds(bot, block) : null;
  ways.dig_out = { description: `Dig the ${block ? block.name.replaceAll('_', ' ') : 'block'} the head is in${secs != null ? `, about ${round(secs)} seconds with the best tool carried` : ''}, and whatever falls after it${block && /sand|gravel/.test(block.name) ? ' (a falling column keeps coming, a dig each block)' : ''}.`,
    run: async () => true };
  return ways;
}
function airWays(bot, task, onAction = () => {}) {
  const ways = {};
  const breath = breathSeconds(bot), left = breath + drowningSeconds(bot);
  const route = airRoute(bot, new Set(), { budgetS: breath }) || airRoute(bot, new Set(), { budgetS: left });
  if (route) {
    const digs = route.reduce((n, c) => n + (c.digs?.length || 0), 0);
    ways.swim_to_air = { description: `Swim the shortest way to air, ${route.length} cell${route.length === 1 ? '' : 's'}${digs ? `, digging ${digs} block${digs === 1 ? '' : 's'} on the way` : ''}: about ${round(route.seconds ?? route.length * STEP_S)} seconds, against ${round(breath)} seconds of breath${route.seconds > breath ? ' (past the breath, into the drowning)' : ''}.`,
      run: () => surfaceForAir(bot, task, onAction) };
  }
  const up = secondsUp(bot);
  if (up != null && up <= left) ways.straight_up = { description: `Swim and dig straight up to air: about ${round(up)} seconds, against ${round(breath)} seconds of breath${up > breath ? ' (past the breath, into the drowning)' : ''}.`,
    run: async () => { onAction({ action: 'surface', oxygen: bot.oxygenLevel, way: 'straight_up' }); await straightUp(bot, task); } };
  return ways;
}

// The task the body's own dangers are answered under: only a cancellation
// stops them. The work's turn hands the vitals its task with the threat
// check on (work.js), and it threw "Threat nearby" at the first check,
// before the fire was looked at, twenty-one times a second: mid-243-ad-
// nether-1 stood in fire from 7.5 to none with magma cubes three blocks
// off, and mid-242-ac-nether-1-fortress-3 from 9.2 to 5.4 with blazes six
// off, its way out found and never walked (note 575). The threat is what
// the stance answers; the body's danger is answered first.
function bodyTask(task) {
  return { get cancelled() { return task.cancelled; }, get label() { return task.label; }, interruptCheck: undefined,
    check() { if (task.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
}

async function maintainVitals(bot, task, onAction = () => {}, { client = null, goal = null, save = () => {} } = {}) {
  const own = bodyTask(task);
  own.check();
  const asked = { client, goal, save };
  // A submerged head with the air bar full is a reason to swim up only while
  // swimming up works. Under a stone roof it never could: the replay run and
  // its drill tried every tick, and the way out (the shore search, which can
  // dig) never had a turn. After a failed swim, only low air sends it up
  // again for a minute.
  const lately = bot._surfaceFailedAt > Date.now() - 60000;
  // Out of the block first, the way Jev chooses (body_way): a step aside
  // into open air beside the feet, as a player steps out from under gravel,
  // or the dig; then the dig of what is still there, as often as it takes.
  // Nothing but a cancellation stops it: a creeper ten blocks off and the
  // spare pickaxe each broke off the dig, four tries a time, while mid-79-c
  // suffocated under gravel from nineteen health (2026-09-26).
  const body = require('./body');
  if (headInBlock(bot)) await body.answer(bot, own, 'head_in_block', headWays(bot, own, onAction), { ...asked, facts: { block: suffocatingBlock(bot)?.name } });
  // And on while the column is still coming down: between one gravel dug
  // and the next landing the head's cell is air for a moment, the dig
  // stopped there, and the next block fell on a bot doing something else.
  // mid-110-p, climbing a one-wide shaft under a gravel column, suffocated
  // from twelve health that way in six seconds (2026-09-26).
  const eyeCell = () => bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0).floored();
  const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$/;
  const falling = () => {
    const eye = eyeCell();
    for (let dy = 1; dy <= 6; dy++) {
      const b = bot.blockAt(eye.offset(0, dy, 0));
      if (!b) break;
      if (FALLS.test(b.name)) return true;
      if (b.boundingBox === 'block') break;
    }
    return Object.values(bot.entities || {}).some(e => e.name === 'falling_block' && e.position && Math.abs(e.position.x - (eye.x + 0.5)) < 0.8 &&
      Math.abs(e.position.z - (eye.z + 0.5)) < 0.8 && e.position.y > eye.y - 0.5 && e.position.y < eye.y + 8);
  };
  const eyeBlocked = () => { const b = bot.blockAt(eyeCell()); return !!b && b.boundingBox === 'block' && FALLS.test(b.name); };
  const digging = headInBlock(bot);
  for (let tries = 0, waited = 0; tries < 24 && waited < 20; ) {
    if (own.cancelled) throw new (require('./skills').Cancelled)(own.label);
    if (headInBlock(bot) || (digging && eyeBlocked())) {
      tries++;
      const block = suffocatingBlock(bot) || bot.blockAt(eyeCell()), eye = block.position;
      onAction({ action: 'dig_out_of_block', block: block.name, at: { x: eye.x, y: eye.y, z: eye.z } });
      require('./turn').takeTurn(bot, 'vitals', 'dig_out_of_block', block.name);
      try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
      try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
      await sleep(150);
    } else if (digging && falling()) { waited++; await sleep(100); }
    else break;
  }
  own.check();
  // In powder snow, or told by the server it is freezing.
  if (inPowderSnow(bot) || bot._freezingAt > Date.now() - 3000) { await outOfPowderSnow(bot, own, onAction); own.check(); }
  // The fire and the burning: the way is Jev's (body_way). Standing in fire
  // with no way out found, the old run, which says so.
  if (inFire(bot)) {
    const ways = fireWays(bot, own, onAction);
    if (Object.keys(ways).length) await body.answer(bot, own, 'fire', ways, { ...asked, facts: { inFire: true } });
    else await outOfFire(bot, own, onAction);
    own.check();
  }
  if (onFire(bot) && !inFire(bot) && !require('./terrain').bodyInLava(bot) && !body.held(bot, 'fire')) {
    await body.answer(bot, own, 'fire', fireWays(bot, own, onAction), { ...asked, facts: { inFire: false } }); own.check();
  }
  // The hot floor, the same: whatever the step is (a walk, a dig, a rest
  // before a fight, a meal), the floor the body stands on is looked at here.
  const hot = onHotFloor(bot);
  if (hot) {
    const ways = hotFloorWays(bot, own, onAction, hot);
    if (Object.keys(ways).length) await body.answer(bot, own, 'hot_floor', ways, { ...asked, facts: { floor: hot.block.name, hurt: hot.hurt, crouchSafe: hot.crouchSafe } });
    own.check();
  }
  if (bot.oxygenLevel <= 12 || (headSubmerged(bot) && !lately)) {
    // The way up is Jev's (body_way); with none found, the old swim, which
    // throws that no way up was found.
    const ways = airWays(bot, own, onAction);
    const surface = () => Object.keys(ways).length ? body.answer(bot, own, 'air', ways, { ...asked, facts: { air: bot.oxygenLevel } }) : surfaceForAir(bot, own, onAction);
    try { await surface(); delete bot._surfaceFailedAt; }
    catch (err) { if (err.name !== 'Cancelled' && /breathable air/.test(err.message)) bot._surfaceFailedAt = Date.now(); throw err; }
  }
  // The meal is the work's, stopped by what stops the work.
  task.check();
  // Natural regeneration needs at least 18 hunger points. A sheltered injured
  // player at 17 must not wait all night with carried food and no healing.
  if (!(bot.food <= 16 || (bot.health < 20 && bot.food < 18) || (bot.health <= 12 && bot.food < 20))) return false;
  // Not with a mob at arm's length. Eating is a second and a half standing
  // still with the hand busy, and the health it brings back comes over the
  // next minute: death nineteen ate twice at six health with a zombie
  // beside it. Starvation is the one reason to eat anyway.
  if (bot.food > 2 && closeHostile(bot)) return false;
  // In an encounter the meal is a stance, Jev's to choose with the others
  // (survival.js stanceOptions, eat): eaten here between two ticks of a
  // stance it stopped the run or the pocket chosen, a second and a half at
  // a time (mid-83-d ate at twelve health in the middle of its retreat).
  // Down to six hunger, where the bot can no longer sprint, it still eats.
  const held = require('./danger').stanceHeld(bot);
  if (bot.food > 6 && held && held.choice !== 'keep_working' && held.choice !== 'eat') return false;
  // The last resort after the safe food, with no rule of its own: its four
  // points are worth more than the three quarters its Hunger may spend, and
  // the gate that ate it only hurt and under eighteen was a threshold of
  // ours, not the game's (note 515). The claim says what it is and does.
  const food = chooseFood(bot) || lastResortFood(bot);
  if (!food) return false; // The higher-level survival planner must forage.
  onAction({ action: 'eat', item: food.name, food: bot.food, health: bot.health });
  require('./turn').takeTurn(bot, 'vitals', 'eat', food.name);
  await bot.equip(food, 'hand');
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  task.check();
  const before = bot.food;
  let watcher;
  try {
    const cancelled = new Promise((_, reject) => {
      watcher = setInterval(() => {
        try { task.check(); }
        catch (err) { bot.deactivateItem(); reject(err); }
      }, 100);
    });
    // The hand can empty between the equip and the bite (a slot resync);
    // mineflayer's consume reads the held item's name without looking.
    if (bot.heldItem === null) throw new Error('The food was not in hand to eat');
    await Promise.race([bot.consume(), cancelled]);
    await until(task, () => bot.food > before, 3000, 'Eating did not restore hunger');
  } finally { clearInterval(watcher); bot.deactivateItem(); }
  return true;
}

// What maintainVitals would do this turn, as a claim (src/arbiter.js): the
// same conditions, nothing done. The fire, the air and the head in a block
// are reflexes; powder snow and a submerged head are pressing; the meal is
// routine, pressing once sprinting is gone. A meal that waits on a renewing
// shelter plan is a claim beside it now, not a turn that never comes.
function claim(bot) {
  if (!bot?.entity?.position || bot.game?.gameMode === 'creative') return null;
  const reflex = require('./arbiter').observeReflexes(bot).find(r => r.layer === 'vitals');
  // An alert (a creeper in reach, a mob at arm's length) is pressing, and
  // who answers it is Jev's (arbiter.js ALERTS); the body's physics is a reflex.
  if (reflex && require('./arbiter').ALERTS.has(reflex.key)) return { layer: 'vitals', action: reflex.action, urgency: 'pressing', alert: reflex.key, facts: reflex.facts };
  if (reflex) return { layer: 'vitals', action: reflex.action, urgency: 'body', reflex: reflex.key, facts: reflex.facts, preemptible: false };
  const facts = { health: bot.health, food: bot.food, air: bot.oxygenLevel, ...(bot.health < 20 ? { healing: bot.food >= 18 } : {}) };
  if (inPowderSnow(bot) || bot._freezingAt > Date.now() - 3000) return { layer: 'vitals', action: 'out_of_powder_snow', urgency: 'pressing', facts: { ...facts, freezing: true } };
  if (headSubmerged(bot) && !(bot._surfaceFailedAt > Date.now() - 60000)) return { layer: 'vitals', action: 'surface', urgency: 'pressing', facts: { ...facts, headUnderwater: true } };
  if (!(bot.food <= 16 || (bot.health < 20 && bot.food < 18) || (bot.health <= 12 && bot.food < 20))) return null;
  if (bot.food > 2 && closeHostile(bot)) return null;
  const held = require('./danger').stanceHeld(bot);
  if (bot.food > 6 && held && held.choice !== 'keep_working' && held.choice !== 'eat') return null;
  const food = chooseFood(bot) || lastResortFood(bot);
  if (!food) return null;
  const effect = sideEffectSays(food.name);
  const coming = comingWhileEating(bot);
  return { layer: 'vitals', action: 'eat', urgency: bot.food <= 6 ? 'pressing' : 'routine', facts: { ...facts, item: food.name, foodPoints: bot.registry.foodsByName?.[food.name]?.foodPoints, ...(effect ? { effect } : {}),
    ...(coming.length ? { comingAtTheBot: coming } : {}) }, cost: { seconds: EAT_MEAL_SECONDS } };
}

// The actions this layer reports, wherever it is run from (survival.js
// stepOnce runs it too): the turn they took was the vitals'.
const ACTIONS = new Set(['dig_out_of_block', 'douse', 'eat', 'out_of_fire', 'off_hot_floor', 'out_of_powder_snow', 'surface']);

module.exports = { claim, ACTIONS, onHotFloor, hotFloorRoute, hotFloorWays, offHotFloor, crouchOnHotFloor, suffocatingBlock, douse, intoWater, pondNear, fireWays, headWays, airWays, asideCell, inFire, fireRoute, outOfFire, inPowderSnow, snowRoute, outOfPowderSnow, lastResortFood, lastResortFoods, sideEffectSays, SIDE_EFFECTS, chooseFood, safeFood, maintainVitals, needsAir, checkAir, headSubmerged, headInBlock, NeedsAir, digWithAirGuard, airRoute, surfaceForAir, breathSeconds, breathShort, STEP_S, fireToAnswer, onFire };
