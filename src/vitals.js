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
// The head dipped under at the water's top with the breath full (note
// 752f): the air is the block over the eyes, and a player there keeps the
// head up with the jump key, asking nothing. 25584 (17:38:10 to 17:40:01Z)
// was asked body_way about forty times at (13, 61, 124), swim_to_air and
// straight_up turn about ("1 cell, 0.4 s, against 13 seconds of breath"),
// the breath at 20 throughout, sinking a block between each and bobbing up.
function atWaterTop(bot) {
  if ((bot.oxygenLevel ?? 20) < 20 || !headSubmerged(bot)) return false;
  const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0).floored();
  const above = bot.blockAt?.(eye.offset(0, 1, 0));
  return !!above && above.boundingBox === 'empty' && !swimmableWater(above) && !/lava/.test(above.name || '');
}
async function bobUp(bot, task) {
  bot.setControlState?.('jump', true);
  try { for (let n = 0; n < 12 && headSubmerged(bot); n++) { task?.check?.(); await sleep(50); } }
  finally { bot.setControlState?.('jump', false); }
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

const SWIM_BLOWS = 3, SWIM_BLOWS_MS = 3000;
async function surfaceForAir(bot, task, onAction = () => {}, { keepOff = null } = {}) {
  onAction({ action: 'surface', oxygen: bot.oxygenLevel, ...(keepOff ? { keepOff: keepOff.why } : {}) });
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  const closed = new Set(keepOff?.cells || []);
  // The shortest way within the breath left; with none, within the breath
  // and the drowning after it, the last seconds there are.
  const find = () => airRoute(bot, closed, { budgetS: breathSeconds(bot) }) || airRoute(bot, closed, { budgetS: breathSeconds(bot) + drowningSeconds(bot) });
  let route = find();
  if (!route) return straightUp(bot, task);
  const deadline = Date.now() + 15000, began = Date.now();
  let index = 0, blowsOn = 0, blowSeen = 0;
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
      // Blows landing on the swim (note 1039): the third in three seconds or
      // more ends it, said to the question asked next, where the strike is
      // a way (note 1036). 25584's swim "of about 0.8 seconds" ran sixteen
      // with a drowned at arm's length, fourteen blows, and was never asked
      // about again.
      if (bot._blowAt > began && bot._blowAt !== blowSeen) { blowSeen = bot._blowAt; blowsOn++; }
      if (blowsOn >= SWIM_BLOWS && Date.now() - began >= SWIM_BLOWS_MS && bot.oxygenLevel > 0) {
        bot._bodyWayWhy = `${blowsOn} blows from ${bot._blowBy ? `the ${String(bot._blowBy).replaceAll('_', ' ')}` : 'a mob'} at arm's length landed in the ${Math.round((Date.now() - began) / 100) / 10} seconds of the swim, each knocking the body off it, and the head is still under (air ${bot.oxygenLevel} of 20)`;
        return false;
      }
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
      // Down a cell in water with the sneak key, the game's faster sinking (water-sink.js, note 1070).
      if (lower && bot.entity.isInWater) require('./water-sink').install(bot);
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
// The columns the body stands in: its width reaches into a neighbour's when
// it floats off the centre of its cell (note 950). 25588 (mid-236-ca,
// 2026-10-02 22:27:08Z), at 3.2 health under a pond's overhanging bank,
// floated at z 429.7: its own column was water to the air, the one at z 430
// had dirt at the waterline. Straight up was priced at two seconds with no
// dig, the rise met the dirt over the head's edge, the bot sank three blocks
// in the eight seconds and drowned.
function bodyColumns(bot) {
  const p = bot.entity.position, w = (bot.entity.width ?? 0.6) / 2 - 0.001, out = [];
  for (const x of new Set([Math.floor(p.x - w), Math.floor(p.x + w)])) for (const z of new Set([Math.floor(p.z - w), Math.floor(p.z + w)])) out.push([x, z]);
  return out;
}
function secondsUp(bot) {
  const feet = bot.entity.position.floored(), cols = bodyColumns(bot);
  let seconds = 0;
  for (let y = 2; y <= 40; y++) {
    const level = cols.map(([x, z]) => bot.blockAt(new Vec3(x, feet.y + y, z)));
    if (level.some(b => !b)) return null;
    for (const b of level) if (b.boundingBox === 'block') { const t = digSeconds(bot, b, feet.offset(0, y - 2, 0)); if (t == null) return null; seconds += t; }
    if (level.every(b => b.boundingBox !== 'block' && !swimmableWater(b))) return seconds + STEP_S;
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
      // Over every column the body is in, not the centre's alone (note 950).
      const headY = Math.floor(bot.entity.position.y + 2);
      const above = bodyColumns(bot).map(([x, z]) => bot.blockAt(new Vec3(x, headY, z))).find(b => b && b.boundingBox === 'block' && b.diggable && !/bedrock/.test(b.name));
      if (above) {
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
function fireNear(bot, p, r, { from = -1, to = 2 } = {}) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = from; dy <= to; dy++) if (FIRE.has(bot.blockAt?.(p.offset(dx, dy, dz))?.name)) return true;
  return false;
}
// The flames that make the body "in fire" (inFire): those its box stands in
// and those beside it at its feet and head, each a punch away.
const PUNCH_REST_MS = 8000;
function flamesAbout(bot) {
  const feet = bot.entity?.position?.floored();
  if (!feet || typeof bot.blockAt !== 'function') return [];
  const found = new Map(require('./blaze-stand').flamesTouching(bot).map(b => [`${b.position}`, b]));
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) {
    const b = bot.blockAt(feet.offset(dx, dy, dz));
    if (b && FIRE.has(b.name)) found.set(`${b.position || feet.offset(dx, dy, dz)}`, b.position ? b : Object.assign(b, { position: feet.offset(dx, dy, dz) }));
  }
  return [...found.values()];
}
// Or told so by the server: an in-fire hurt within the last second and a
// half (session.js). The flames a fireball lights can sit where the feet
// cell does not show them: mid-229-g took ten in-fire hurts in seven
// seconds, sealing a pocket, and nothing got it out (2026-09-27).
// The server's word is about where the body was hurt: once a way out of the
// fire has moved the body (a block put under it, a walk out), a hurt from
// before that says nothing of where it is now, and the next hurt, if the
// fire still reaches it, comes within half a second. Flames beside the
// block the body stands on, a level down, do not touch it (the body's box
// begins at its feet), as the rise onto a block says. mid-243-ad-nether-3
// put a block of gravel in the fire's cell on its span over the lava sea and
// stood on it, then was told it was still in fire, by a hurt from before
// the rise and by the flame lit beside the block under it, and rose three
// more: y 51 to 55 in a second and a half, all four sides open over a drop
// of 23 into the lava, where the next fireball threw it off (note 582).
function inFire(bot) {
  const feet = bot.entity?.position?.floored();
  if (!feet) return false;
  if (bot._inFireAt > Date.now() - 1500 && !(bot._fireLeftAt >= bot._inFireAt)) return true;
  if ([0, 1].some(dy => FIRE.has(bot.blockAt?.(feet.offset(0, dy, 0))?.name))) return true;
  return onFire(bot) && fireNear(bot, feet, 1, { from: 0, to: 1 });
}
// Marked by a way out of the fire that moved the body off the cell it was
// hurt in (inFire).
function leftFire(bot, from) {
  const now = bot.entity?.position?.floored();
  if (now && from && !now.equals(from)) bot._fireLeftAt = Date.now();
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
// The body's own way out of fire or lava in flight: a run out of fire
// (outOfFire, whether body_way or the rule chose it, marked while it runs)
// or a held-key move out of either. Nothing else takes its keys or its look
// meanwhile: the shield's hold (shot-reflex.js) leaves them to it, and the
// hurt watchdog (survival.js) counts it as the answer to the burns (note
// 792: of the 48 runs of a second or more that never moved, the shield was
// up through 30, and the watchdog stopped such a run at least 24 times).
const WAY_OUT_MS = 3000;
function wayOutRunning(bot, now = Date.now()) {
  const r = bot?._bodyWayRunning;
  if (r && now - r.at <= WAY_OUT_MS) return r.action;
  const c = bot?._controller?.name;
  return c === 'out_of_fire' || c === 'out_of_lava' ? c : null;
}
async function outOfFire(bot, task, onAction = () => {}, route = fireRoute(bot)) {
  onAction({ action: 'out_of_fire', steps: route?.length ?? null, health: bot.health });
  if (!route) return false;
  // Held while this runs, for shot_answer to read (shot-reflex.js
  // bodyWayRunning, note 709/723): out_of_fire chose the route out and its
  // own keys; 25597 answered out_of_fire three times in a row, undone each
  // time by shot_answer's own behind_cover walking it somewhere else while
  // the run out was still on its way, and the fire it was trying to leave
  // caught it again. Cleared in the finally below whether the run finished,
  // stopped at a fall, or threw.
  bot._bodyWayRunning = { action: 'out_of_fire', at: Date.now() };
  // Walked cell by cell on the keys: the path search will not start from
  // a cell of fire or cross one, and handed the route it returned at once
  // (the arena: burned in place three times out of three). A mob in a
  // cell is no wall: a body pushes past a magma cube or a blaze as a
  // player's does, so the keys stay held until the cell is reached.
  bot.pathfinder?.setGoal?.(null);
  const { move } = require('./motion');
  const from = bot.entity.position.floored();
  // Kept off every cell beside or over a fall that kills, as the route is
  // (fireRouteThrough): mid-243-af-nether-3-fortress-4 ran out of a fire at
  // a sprint down a slope, five cells none of them by an edge, went on past
  // them upright and off a ledge thirty blocks over the cavern floor, 14.8
  // to none with nothing hitting it; the keys stayed held until each cell
  // was reached, wherever the body had gone (note 610). The route's cells
  // and any the body passes that is by no such fall are kept to; come to
  // one that is, the keys are let go and the way is asked again from there.
  const { fallBeside } = require('./movement');
  const terrain = require('./terrain');
  const safe = new Set([from, ...route].map(c => `${c.x},${c.z}`));
  const guard = () => {
    const p = bot.entity?.position;
    if (!p) return;
    const c = new Vec3(Math.floor(p.x), Math.floor(p.y + 0.01), Math.floor(p.z)), key = `${c.x},${c.z}`;
    if (safe.has(key)) return;
    const under = terrain.fallFrom(terrain.atOf(bot), { x: c.x, y: c.y - 1, z: c.z });
    const over = under.into === 'lava' || (under.into === 'ground' && Math.max(0, under.n - 3) >= (bot.health ?? 20) / 2);
    if (!over && !fallBeside(bot, c)) { safe.add(key); return; }
    bot.clearControlStates?.();
    throw new Error(`Left the cells of the run out of fire at (${c.x}, ${c.y}, ${c.z}), by a fall that kills; stopped`);
  };
  try {
    for (const [i, { cell, crouched }] of fireSteps(bot, route).entries()) {
      bot._bodyWayRunning = { action: 'out_of_fire', at: Date.now() };
      const target = cell.offset(0.5, 0, 0.5);
      // At a sprint the cells on the way are passed through, not stood on:
      // held to a third of a block, each one overshot and was turned back to.
      // Crouched beside the fall, each is stood on.
      const near = i === route.length - 1 || crouched ? 0.45 : 0.8;
      const there = () => { const here = bot.entity.position; return Math.hypot(target.x - here.x, target.z - here.z) < near && Math.abs(here.y - cell.y) < 0.6; };
      const up = cell.y > Math.floor(bot.entity.position.y + 0.01);
      const look = target.offset(0, 1.6, 0);
      try {
        await move(bot, task, crouched
          ? { label: 'out_of_fire', keys: up ? ['forward', 'jump'] : ['forward'], sneak: true, look, maxMs: 2000, tick: 50, until: there, guard, throughFlames: true }
          : { label: 'out_of_fire', keys: up ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false, why: 'running out of fire', look, maxMs: 1500, tick: 50, until: there, guard, throughFlames: true });
      } catch (err) {
        if (!/^Left the cells of/.test(err.message || '')) throw err;
        console.log(`[vitals] ${err.message}`);
        break;
      }
    }
  } finally { if (bot._bodyWayRunning?.action === 'out_of_fire') delete bot._bodyWayRunning; }
  leftFire(bot, from);
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
  // Offered by the check its run makes first (pillarUp's climbStop: lava or
  // water in or beside the cells the body rises through, what is over the
  // head): 25592 chose it three times in three seconds on fire at
  // (-170, 81, 195) and the body never left y 81 (note 703).
  if (require('./pillar-recovery').climbStop(bot, feet, { canDig: () => false })) return null;
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
  const from = bot.entity.position.floored();
  let placed = 0, why = null;
  try { placed = await pillarUp(bot, task, rise.top.y, { maxBlocks: 1, threats: false, canDig: () => false, blocks: [...RISE_BLOCKS] }); }
  catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; why = String(err.message || err).slice(0, 120); }
  leftFire(bot, from);
  const out = done();
  // What came of it, for the next body_way (body.js lastWay): a rise that
  // put no block down left the body where it was.
  if (!out) bot._bodyWayWhy = placed ? `the block went down and the body stood on it at y ${Math.floor(bot.entity.position.y)}, but ${action === 'off_hot_floor' ? 'it is still on the hot floor' : 'it is still in fire there'}`
    : `no block went down${why ? ` (${why})` : ''}: the body is where it was, y ${Math.floor(bot.entity.position.y)}`;
  return out;
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
// Held means held: whatever else lets the crouch go while the body still
// stands on the magma (a step's clearControlStates, a window's click), it is
// taken up again on the next tick unless a held-key walk or the pathfinder is
// moving the body, or a click that needs the body upright is being made
// (bot._uncrouchedFor, skills.js openWindow). 25588 (mid-243-hf) chose it
// five times from 00:09:23 to 00:10:12Z and was hurt after each: the leg's
// walk that followed stood it up on the magma and the crouch was not taken
// up again (note 703).
const pathMoving = bot => { try { return !!bot.pathfinder?.isMoving?.(); } catch (_) { return false; } };
function crouchOnHotFloor(bot, onAction = () => {}) {
  onAction({ action: 'off_hot_floor', way: 'crouch_on_hot_floor', health: bot.health });
  bot.setControlState?.('sneak', true);
  if (typeof bot.on === 'function' && !bot._hotFloorCrouch) {
    const release = () => {
      const still = require('./terrain').hotUnderfoot(bot);
      if (still?.crouchSafe) {
        if (!sneaking(bot) && !bot._controller && !pathMoving(bot) && !(bot._uncrouchedFor > Date.now())) {
          bot.setControlState?.('sneak', true);
          bot._crouchTakenUp = (bot._crouchTakenUp || 0) + 1;
        }
        return;
      }
      if (bot._controller) return;
      bot.removeListener?.('physicsTick', release);
      if (bot._hotFloorCrouch === release) delete bot._hotFloorCrouch;
      if (sneaking(bot)) bot.setControlState?.('sneak', false);
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
    // Run at straight, at a sprint: the pond's cell, its floor and the cells
    // on the way read for lava and fire (lava-escape.js targetHot, note 756).
    if (bot.blockAt(c)?.name === 'water' && !/lava|fire/.test(bot.blockAt(c.offset(0, 1, 0))?.name || '') && !require('./lava-escape').targetHot(bot, c)) return c;
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
  // Alight with fire resistance that outlasts the fire: it does nothing,
  // and there is nothing to answer (note 656).
  if (require('./body').outlastsBurning(bot)) return false;
  // An enchanted golden apple carried is a way too, in any dimension: its
  // fire resistance ends what burning is left (body_way, note 549).
  if (onFire(bot) && bot.inventory?.items?.().some(i => i.name === 'enchanted_golden_apple')) return true;
  // So is a fire resistance potion (note 656).
  if (onFire(bot) && require('./fire-resistance').carried(bot).length) return true;
  // A cauldron of water, placed near or carried with a water bucket to fill
  // it from, puts a burning body out in the Nether too (note 634).
  try { if (onFire(bot) && (() => { const p = require('./cauldron').plans(bot); return !!(p.placed || p.carry); })()) return true; } catch (_) { /* no world to look at */ }
  if (!onFire(bot) || /nether/.test(String(bot.game?.dimension || ''))) return false;
  if (bot.inventory?.items?.().some(i => i.name === 'water_bucket')) return true;
  return !!(bot.blockAt && pondNear(bot));
}

// Where a bucket poured at the feet goes: onto the top of a block under the
// body's box, into an open cell the water then stands in with the body, the
// cell under the middle first, then the others the box is over, from the
// feet's level down two (a body in the air over a step lands in it). The
// cell under the middle alone was open air twice for mid-244-bb, its box's
// edge on the stone of a step as it walked up out of a cave burning, and
// the bucket was not offered (note 595).
function pourFloor(bot, p = bot.entity?.position) {
  if (!p || typeof bot.blockAt !== 'function') return null;
  const w = (bot.entity?.width ?? 0.6) / 2 - 0.001;
  const cols = [];
  for (let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++) for (let z = Math.floor(p.z - w); z <= Math.floor(p.z + w); z++) cols.push([x, z]);
  cols.sort((a, b) => Math.hypot(a[0] + 0.5 - p.x, a[1] + 0.5 - p.z) - Math.hypot(b[0] + 0.5 - p.x, b[1] + 0.5 - p.z));
  const top = Math.floor(p.y + 1e-4);
  for (let dy = 0; dy <= 2; dy++) for (const [x, z] of cols) {
    const cell = new Vec3(x, top - dy, z), floor = cell.offset(0, -1, 0);
    if (bot.blockAt(floor)?.boundingBox === 'block' && ['air', 'cave_air'].includes(bot.blockAt(cell)?.name)) return { cell, floor };
  }
  return null;
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
  const pour = pourFloor(bot);
  if (!pour) return false;
  const feet = pour.cell, below = pour.floor;
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
const closeHostile = bot => closeHostiles(bot)[0] || false;
function closeHostiles(bot) {
  const here = bot.entity?.position;
  if (!here) return [];
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
  return Object.values(bot.entities || {}).filter(e => e !== bot.entity && e.position && e.isValid !== false &&
    hostile(e) && (e.position.distanceTo(here) <= reach(e.name) || soon.has(e)) && (reaches(e) || roundCorner(e)));
}
// The meal Jev gave the turn to is stopped by what its claim is made by:
// a mob that can get at the bot while it eats (closeHostile). Run under
// the work's threat check, it was stopped by a blaze the pocket's seal was
// chosen against, out of sight behind the pocket's wall, before a bite:
// mid-242-ab-nether-3 gave the meal the turn 41 times in six seconds at
// 10.6 health, each stopped at once, the claim saying it could eat and
// the run saying it could not (note 585). Starving, it eats anyway.
// And only where the meal would be eaten through a shot on its way
// (shot-reflex.js mealThroughShot, note 1006): at a health one fireball's
// hit ends, the shield cuts every bite, and the claim stood the bot still
// in their line with nothing eaten. 25591 (2026-10-03 07:22:01 to 07:22:11Z)
// was given the meal's turn three times at 5.6 and 3.6 health with four
// blazes in line five blocks off, ate nothing, and the next fireball ended
// it; there the turn is the stance's (out of their line first).
const unhealingAmongBlazes = (bot, close = closeHostiles(bot)) => {
  if (!((bot.food ?? 20) < 18 && (bot.health ?? 20) <= UNHEALING_HEALTH && close.every(e => e.name === 'blaze'))) return false;
  if (!close.length) return true;
  try { return require('./shot-reflex').mealThroughShot(bot, { name: 'small_fireball' }); } catch (_) { return false; }
};
function checkMeal(bot) {
  if ((bot.food ?? 20) <= 2) return;
  const close = closeHostiles(bot);
  // Claimed among blazes at hunger under eighteen (note 1001), it is not stopped by them.
  if (unhealingAmongBlazes(bot, close)) return;
  const mob = close[0];
  if (mob) throw new (require('./danger').NeedsSafety)({ entity: mob, distance: mob.position.distanceTo(bot.entity.position) });
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
      ...(m.hit ? { hitsFor: Math.round(afterArmour(m.hit, worn) * 10) / 10 } : {}),
      // A blow that varies, its hardest too; and a pace other than a blow a
      // second (a hoglin's three to eight, every two seconds: note 587).
      ...(m.most ? { hitsForAtMost: Math.round(afterArmour(m.most, worn) * 10) / 10 } : {}), ...(m.blowEvery ? { blowEverySeconds: m.blowEvery } : {}),
      ...(m.note ? { note: m.note } : {}) };
  });
}
// A second and six tenths eating (survival.js EAT_SECONDS).
const EAT_MEAL_SECONDS = 1.6;
const UNHEALING_HEALTH = 14;

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
// The shooters in sight while the body burns, for body_way: each one's
// rate and hit through the armour worn, its shots in the air at the bot,
// and how many that land end the bot at the health it has; and a way's end
// in or out of their line (bunker.js seenFrom). mid-242-ah-nether-2-
// fortress-5 at 3.9 health, in fire, a ghast 52 blocks off in sight firing
// every three seconds, was asked only of the fire: it ran seven steps out
// into the ghast's line and the next fireball, 3.1 through its iron, and
// the burning ended it (note 621). { says, shooters, entities } or null.
function shootersAtBody(bot) {
  let pushers = [];
  try { pushers = require('./survival').shotPushers(bot).filter(t => t.visible && t.entity?.position); } catch (_) { return null; }
  if (!pushers.length) return null;
  const ce = require('./combat-estimate'), s = require('./survival');
  const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const hp = round(bot.health ?? 20);
  const shooters = pushers.slice(0, 3).map(t => {
    const name = t.entity.name, m = ce.MOBS[name] || {};
    const hit = round(m.ignoresArmour ? m.hit : ce.afterArmour(m.hit || 0, worn));
    const every = name === 'ghast' ? require('./ghast').GHAST.every : name === 'blaze' ? round(ce.FIREBALL.volleySeconds) : m.every || 2;
    let due = null;
    try { due = s.shotsDue(bot, t); } catch (_) { due = null; }
    const inAir = due?.shots?.filter(x => x.air) || [];
    return { name, distance: Math.round(t.distance), hit, every, ...(inAir.length ? { inTheAirDueIn: inAir.map(x => x.in) } : {}) };
  });
  const says = shooters.map(k => {
    const said = k.name.replaceAll('_', ' '), word = k.name === 'ghast' || k.name === 'blaze' ? 'fireball' : 'shot';
    // A blaze's landing is its hit and its fire (combat-estimate FIRE_TICKS, note 631).
    const lands = k.hit > 0 ? (k.name === 'blaze' ? Math.max(1, ce.landingsApart(hp, k.hit, ce.burnLeft(bot)) || 1) : Math.max(1, Math.ceil(hp / k.hit))) : null;
    return `The ${said} ${k.distance} blocks off has the bot in sight and fires ${k.name === 'blaze' ? `a volley of three about every ${k.every} seconds` : `a ${word} about every ${k.every} seconds while it keeps a line`}, about ${k.hit} health a ${word} through the armour worn${k.inTheAirDueIn ? `; ${k.inTheAirDueIn.length === 1 ? `one is in the air at the bot, due in about ${k.inTheAirDueIn[0]} seconds` : `${k.inTheAirDueIn.length} are in the air at the bot`}` : ''}${lands ? `: at ${hp} health, ${lands === 1 ? 'the next that lands ends it' : `${lands} that land end it`}${k.name === 'blaze' ? ', the fire it sets counted' : ', the burning besides'}` : ''}. A way whose end is out of its line is out of its fire; one whose end is in it is not.`;
  }).join(' ');
  return { says, shooters, entities: pushers.map(t => t.entity) };
}
// In or out of the line of the shooters in sight at `cell`, for a way's
// description: '' with none in sight.
function lineAtEnd(bot, at, cell) {
  if (!at || !cell) return '';
  let seen = [];
  try { seen = require('./bunker').seenFrom(bot, at.entities, cell); } catch (_) { return ''; }
  const names = [...new Set(at.entities.map(e => e.name.replaceAll('_', ' ')))];
  return seen.length ? ` Its end is in the line of the ${[...new Set(seen.map(e => e.name.replaceAll('_', ' ')))].join(' and the ')}: its fire goes on there.` : ` Its end is out of the line of the ${names.join(' and the ')} from where ${names.length === 1 ? 'it is' : 'they are'} now.`;
}

// The mobs whose blows reach the body now, for body_way (note 657): a biter
// at its reach (danger.js atItsReach), and a blaze within three, which
// swings instead of shooting once within two (the game's BlazeAttackGoal: a
// blow of six before armour every twenty ticks) and keeps closing. Each is
// said with where it is from the way the bot faces: a raised shield takes
// only what comes from the half in front, and the ways out of a body's
// danger face their own work (the cauldron's cell, the way out), not the
// mob. mid-243-ch (25581) at 03:33:47Z on 2026-09-29, alight at 17.3 with a
// blaze 2.3 blocks off behind it, was asked of the fire alone, chose the
// cauldron, and took six blows at its back a second apart, 17.6 to none,
// while it lined up on the rim; nothing turned it to the blaze.
// { says, mobs } or null.
const BLOW_REACH = 3;
function blowsAtBody(bot) {
  if (!bot?.entity?.position) return null;
  const danger = require('./danger'), ce = require('./combat-estimate');
  let near = [];
  try { near = danger.threats(bot, BLOW_REACH + 1); } catch (_) { return null; }
  const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const here = bot.entity.position, yaw = bot.entity.yaw ?? 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const mobs = [];
  for (const t of near) {
    const e = t.entity, name = e?.name;
    if (!e?.position || name === 'creeper') continue;
    const blaze = name === 'blaze';
    if (blaze ? t.distance > BLOW_REACH : !(danger.atItsReach(bot, t) && (t.visible || t.distance <= 2))) continue;
    const m = ce.MOBS[name] || {}, hit = blaze ? ce.FIREBALL.melee : m.hit;
    if (!(hit > 0)) continue;
    const dx = e.position.x - here.x, dz = e.position.z - here.z, h = Math.hypot(dx, dz);
    const off = h < 0.2 ? 0 : Math.round(Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / h))) * 180 / Math.PI);
    mobs.push({ entity: e, name, id: e.id, distance: round(t.distance), off, behind: off >= 90, hit, blow: round(m.ignoresArmour ? hit : ce.afterArmour(hit, worn)), every: m.blowEvery || 1,
      ...(blaze ? { swingsNow: t.distance <= ce.FIREBALL.meleeReach } : {}) });
  }
  if (!mobs.length) return null;
  const where = k => k.off >= 90 ? `behind the bot (${k.off} degrees from where it faces)` : k.off > 45 ? `to its side (${k.off} degrees from where it faces)` : 'in front of it';
  const says = 'At arm\'s length now: ' + mobs.map(k => {
    const said = k.name.replaceAll('_', ' ');
    const how = k.name === 'blaze'
      ? `${k.swingsNow ? 'within the two blocks where a blaze swings instead of shooting' : 'a blaze swings instead of shooting once within two blocks, and it keeps closing'}: ${k.hit} a blow before armour, about ${k.blow} through the armour worn, a blow a second`
      : `about ${k.blow} a blow through the armour worn, a blow ${k.every === 1 ? 'a second' : `every ${k.every} seconds`}`;
    return `the ${said} ${k.distance} blocks off, ${where(k)}: ${how}, each blow knocking the body back`;
  }).join('; ') + `. A raised shield takes only what comes from the half in front of where the bot faces${mobs.some(k => k.behind) ? ', so nothing from behind' : ''}; the ways out below face their own work, not the mob, and do not strike it.`;
  return { says, mobs };
}
// What the blows at arm's length come to over a way's seconds: about as
// many blows as whole seconds pass at each one's pace (the blaze's a second
// apart, as mid-243-ch's six were).
function blowsDuring(blows, seconds) {
  if (!blows?.mobs?.length || !(seconds > 0)) return '';
  const each = blows.mobs.map(k => ({ k, n: Math.max(1, Math.floor(seconds / k.every)) }));
  const health = round(each.reduce((s, { k, n }) => s + n * k.blow, 0));
  const names = blows.mobs.length === 1 ? `the ${blows.mobs[0].name.replaceAll('_', ' ')} is` : 'they are';
  return ` In its about ${round(seconds)} seconds, about ${each.map(({ k, n }) => `${n} blow${n === 1 ? '' : 's'} from the ${k.name.replaceAll('_', ' ')} ${k.distance} blocks off`).join(' and ')}, about ${health} health through the armour worn, each knocking the body back; and after it ${names} still there, a blow ${blows.mobs.every(k => k.every === 1) ? 'a second' : 'at each one\'s pace'}, until something turns to ${blows.mobs.length === 1 ? 'it' : 'them'}.`;
}
// Each way over the same stretch, as the stances are priced (the next
// fifteen seconds there): the fire left or the strike's seconds, whichever
// is longer, the blows and the fire each way lets land in it if nothing else
// turns to the mob. Priced alone, the cauldron's second and a half read one
// blow against the fire it saves; the blaze at the back went on after it.
// A strike lands the one struck's third (combat-estimate STRUCK) until it
// dies, then none; a way that does not strike lets every blow land; a way
// that puts the fire out ends the fire at its seconds (note 657).
const PUTS_OUT = new Set(['douse_bucket', 'to_water', 'extinguish_in_cauldron', 'set_down_cauldron']);
function horizonSays(ways, blows, burn, hp) {
  const ce = require('./combat-estimate');
  const strike = ways.strike_at_arm;
  const span = Math.min(15, Math.ceil(Math.max(burn.fireLeftSeconds || 0, strike?.seconds || 0)));
  if (!(span > 0)) return;
  const names = blows.mobs.length === 1 ? `the ${blows.mobs[0].name.replaceAll('_', ' ')}` : 'the mobs at arm\'s length';
  const over = []; let priced = 0;
  for (const [key, way] of Object.entries(ways)) {
    if (key === 'eat_golden_apple' || key === 'drink_fire_resistance') continue;
    const struck = key === 'strike_at_arm';
    if (PUTS_OUT.has(key) && !(way.seconds > 0)) continue;
    const fire = round(Math.min(burn.fireLeftSeconds || 0, PUTS_OUT.has(key) ? way.seconds : span));
    const landed = blows.mobs.reduce((n, k, i) => n + (struck && i === 0 ? Math.round(Math.min(span, way.seconds) / k.every * ce.STRUCK) : Math.floor(span / k.every)), 0);
    const hurt = round(blows.mobs.reduce((n, k, i) => n + (struck && i === 0 ? Math.round(Math.min(span, way.seconds) / k.every * ce.STRUCK) : Math.floor(span / k.every)) * k.blow, 0));
    const all = round(hurt + fire);
    // Said first, and the ways it leaves the bot alive listed before the
    // ways it does not (note 1018): at the end of each way's own telling,
    // the walk that left the blaze at the bot's back read as the way out.
    // 25591 (2026-10-03 08:14:50Z, 7.9 health, a blaze two blocks off):
    // out of their line 0.38, the meal 0.32, burn out 0.18, each closing
    // "about 19.4 health ... more than the bot has", and the strike, about
    // 5.6, 0.06; two blows from behind ended it in two seconds.
    way.description = `Over the next ${span} seconds this way${struck ? '' : `, if nothing turns to ${names}`}: about ${all} health, ${landed} blow${landed === 1 ? '' : 's'} (${hurt}) and ${fire} of fire, from ${hp}${all >= hp ? ': more than the bot has' : ''}. ${way.description}`;
    if (all >= hp) over.push(key);
    priced++;
  }
  if (over.length && over.length < priced) for (const key of over) { const way = ways[key]; delete ways[key]; ways[key] = way; }
  return over.length < priced ? over : [];
}
// Turn to the mob at arm's length and strike it (strike_at_arm, note 657):
// until it dies, goes past reach, or `seconds` pass; the look is to it, the
// swing at the weapon's recharge. True when a swing was thrown.
async function strikeAtArm(bot, task, id, onAction = () => {}, { seconds = 6 } = {}) {
  const { canStrike, strike, defenseWeapon } = require('./combat');
  const ce = require('./combat-estimate');
  const live = () => { const e = bot.entities?.[id]; return e && e.isValid !== false ? e : null; };
  const first = live();
  if (!first) return false;
  onAction({ action: 'out_of_fire', way: 'strike_at_arm', mob: first.name, distance: round(first.position.distanceTo(bot.entity.position)), health: bot.health });
  bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
  require('./combat').lowerShield?.(bot);
  const weapon = defenseWeapon(bot);
  if (weapon && bot.heldItem?.name !== weapon.name) { try { await bot.equip(weapon, 'hand'); } catch (err) { if (err.name === 'Cancelled') throw err; } }
  const swingMs = ce.SWING_MS[weapon ? weapon.name.split('_').at(-1) : 'fist'] || ce.SWING_MS.fist;
  const end = Date.now() + seconds * 1000;
  let swung = 0;
  while (Date.now() < end) {
    task?.check?.();
    const e = live();
    if (!e || e.position.distanceTo(bot.entity.position) > BLOW_REACH + 1) break;
    await bot.lookAt(e.position.offset(0, (e.height || 1.8) / 2, 0), true);
    if (!canStrike(bot, e)) { await sleep(100); continue; }
    const wait = swingMs - (Date.now() - (bot._defenseAttackAt || 0));
    if (wait > 0) { await sleep(Math.min(wait, 150)); continue; }
    await strike(bot, task, e);
    swung++;
    bot._defenseAttackAt = bot._threatResponseAt = Date.now();
    bot._struck = { id, at: bot._defenseAttackAt };
  }
  return swung > 0;
}
// The way that answers the blows: offered to a body alight, out of the
// fire, with a mob at arm's length and a weapon or a fist to strike with.
function strikeWay(bot, task, onAction, blows, burn, hp) {
  const k = blows?.mobs?.[0];
  if (!k) return null;
  const ce = require('./combat-estimate'), { defenseWeapon } = require('./combat');
  const weapon = defenseWeapon(bot)?.name || null;
  const dmg = ce.WEAPONS[weapon]?.[0] ?? 1, health = ce.MOBS[k.name]?.health ?? 20;
  const swings = Math.ceil(health / ce.afterArmour(dmg, { points: ce.MOBS[k.name]?.armor || 0, toughness: 0 }));
  const secs = round(swings * ce.swingEvery(weapon));
  const burnSays = burn.burnsToDeath ? `the fire burns on meanwhile, and at a health a second it outlasts the ${hp} health the bot has` : `the fire burns on meanwhile, a health a second (about ${round(burn.fireLeftSeconds)} seconds of it left)`;
  // The one struck is knocked back by each swing and lands about a third of
  // its blows (combat-estimate STRUCK, the bot's recorded fights).
  const landed = Math.round(secs / k.every * ce.STRUCK);
  return { description: `Turn to the ${k.name.replaceAll('_', ' ')} ${k.distance} blocks off, ${k.behind ? 'behind the bot, ' : ''}and strike it with the ${weapon ? weapon.replaceAll('_', ' ') : 'fist'}: it has ${health} health, about ${swings} swing${swings === 1 ? '' : 's'}, about ${secs} seconds at the pace the bot's fights go, facing it (a raised shield then faces it too). A mob being struck is knocked back by each swing and lands about a third of its blows (the bot's recorded fights): about ${landed} of them in those seconds, about ${round(landed * k.blow)} health through the armour worn; ${burnSays}. Killed, it strikes no more${k.name === 'blaze' ? ' and drops a rod about half the time' : ''}, and the fire left is asked of then. Asked again when it dies, goes past arm's length, or the seconds are up.`,
    seconds: secs, run: () => strikeAtArm(bot, task, k.id, onAction, { seconds: secs + 2 }) };
}

// The cauldron's ways for a body alight (not standing in fire), each with
// its seconds, what it saves and what is beside it. The measured times are
// src/cauldron.js's (note 634).
function cauldronWays(bot, task, onAction, burn, hp) {
  const cauldron = require('./cauldron'), ways = {};
  if (!onFire(bot)) return ways;
  let plans;
  try { plans = cauldron.plans(bot); } catch (_) { return ways; }
  const shot = shootersAtBody(bot), { fallBeside } = require('./movement');
  // A blow knocks the body back: off the rim, out of line with the bowl, out
  // of the cell it goes in from. The steps stop at the first and it is asked
  // again (cauldron.js struck, note 657).
  const blows = blowsAtBody(bot);
  // The steps measured with nothing striking, against the time between blows.
  const gap = blows ? Math.min(...blows.mobs.map(k => k.every)) : Infinity;
  const knocked = secs => blows ? `${blowsDuring(blows, secs)} A blow knocks the body off the rim or out of line with the bowl: the steps stop at the first blow that lands and the way is asked again.${secs > gap ? ` The ${round(secs)} seconds were measured with nothing striking; the blows come ${gap === 1 ? 'a second' : `${gap} seconds`} apart, so one is due before the steps are done, and the fire is put out only if the steps finish between two blows.` : ''}` : '';
  const saves = `it saves the ${Math.max(1, Math.round(burn.fireLeftSeconds))} second${Math.round(burn.fireLeftSeconds) === 1 ? '' : 's'} of fire left, about ${burn.burnsToDeath ? `all ${hp} health the bot has` : `${burn.healthItTakes} of the ${hp} health`}`;
  const beside = from => {
    const fall = fallBeside(bot, from);
    return fall ? ` Beside the cell it goes in from there is ${fall.into === 'lava' ? `a drop into lava${fall.fall ? ` ${fall.fall} down` : ''}` : fall.into === 'deep' ? `a drop of more than ${fall.fall}` : `a drop of ${fall.fall} onto ground that costs half the health or more`}: the hop is a jump upright, not a crouch.` : '';
  };
  const body = 'a hop onto its rim (a block up, walls an eighth of a block thick round a bowl three quarters wide, so the body drops in only with its middle over the bowl\'s middle: it lines up first and steps along the rim a tick at a time), and the fire is out the moment the feet are under the water (measured in the Nether, about a tenth of a second)';
  if (plans.placed) {
    const { cell, from, level } = plans.placed;
    const here = bot.entity.position, d = Math.round(Math.hypot(cell.x + 0.5 - here.x, cell.z + 0.5 - here.z) * 10) / 10;
    const secs = Math.round((1.2 + d / 3.5) * 10) / 10;
    ways.extinguish_in_cauldron = { seconds: secs, description: `Step into the cauldron of water ${d} blocks off at (${cell.x}, ${cell.y}, ${cell.z}) (${level} of 3 levels of water): the walk to the cell beside it, then ${body}: about ${secs} seconds from now, burning meanwhile; ${saves}. It costs the cauldron one level of its ${level}, and the way out is a hop, half a second. The Nether's water does not evaporate in a cauldron.${beside(from)}${lineAtEnd(bot, shot, cell)}${knocked(secs)}`,
      run: () => cauldron.extinguishIn(bot, task, plans.placed, onAction) };
  }
  if (plans.carry) {
    const { cell, from } = plans.carry;
    ways.set_down_cauldron = { seconds: cauldron.HOP_SECONDS, description: `Put the cauldron carried down beside the bot at (${cell.x}, ${cell.y}, ${cell.z}), fill it from the water bucket (${plans.buckets} carried: the bucket is left empty, and no water bucket is left for a fall or the portal cast), and step in: ${body}: about ${cauldron.seconds(cauldron.HOP_SECONDS)} seconds from now in all (measured: the fire out 0.8 to 1 second after the first step, the placing and filling a fraction of a second each), burning meanwhile; ${saves}. What it spends: the water bucket's water (the Nether has none to refill it from) and the cauldron's place in the pack, the cauldron staying where it is put (two levels of water left in it for another fire here, and a pickaxe takes it up again without water); the bucket is carried on empty. The Nether's water does not evaporate in a cauldron.${beside(from)}${lineAtEnd(bot, shot, cell)}${knocked(cauldron.HOP_SECONDS)}`,
      run: () => cauldron.setDownAndIn(bot, task, plans.carry, onAction) };
  }
  return ways;
}

// Out of the shooters' line while the body burns (note 759): the ways out
// of fire end where they end, most of them in a blaze's line, where its next
// volley lands and lights the body again. 25581, 25592 and 25589 answered
// out_of_fire ten times and more in a few seconds each among six to eight
// blazes, every way's end said to be in their line, and burned to death; of
// 489 body_way askings in the Nether with a blaze seeing the bot
// (2026-09-29T23:00Z to 2026-09-30T17:00Z), 317 offered only ways that
// ended in its line, and 149 of those were followed by a death within
// thirty seconds (79 offered one that ended out of it: 20). The nearest cell
// within eight blocks of walking that none of the shooters in sight sees now
// (bunker.js coverWithin: no fire, lava or biter on the way), walked as the
// run out of fire is. Null with no shooter in sight or no such cell.
function outOfLineWay(bot, task, onAction, shot, standing) {
  if (!shot?.entities?.length) return null;
  let cover = null;
  const feet = bot.entity.position.floored();
  try { cover = require('./bunker').coverWithin(bot, shot.entities, { steps: 8, skip: c => standing && c.equals(feet) }); } catch (_) { return null; }
  if (!cover?.steps || !cover.path?.length) return null;
  const secs = round(Math.max(0.3, fireRouteSeconds(bot, cover.path)));
  const names = [...new Set(shot.entities.map(e => e.name.replaceAll('_', ' ')))];
  const who = shot.entities.length === 1 ? `the ${names[0]}` : `the ${shot.entities.length} ${names.length === 1 ? `${names[0]}s` : 'shooters'}`;
  const burn = require('./body').lasts(bot, 'fire', { inFire: false }), hp = round(bot.health ?? 20);
  const left = Math.max(1, Math.round(burn.fireLeftSeconds || 0));
  const takes = burn.healthItTakes >= 0.5 ? `about ${burn.healthItTakes} health` : 'under a health';
  const burnsOn = burn.burnsToDeath ? `about ${left} second${left === 1 ? '' : 's'} of it, more than the ${hp} health the bot has` : `about ${left} second${left === 1 ? '' : 's'} of it, ${takes}`;
  const c = cover.cell;
  const comes = [shot.entities.some(e => e.name === 'blaze') ? ' A blaze that loses sight of the bot comes on toward it and fires once it has a line again.' : '',
    shot.entities.some(e => e.name === 'ghast') ? ' A ghast drifts where it will and fires whenever it has a line again.' : ''].join('');
  return { seconds: secs,
    description: `Walk ${cover.steps} block${cover.steps === 1 ? '' : 's'} to (${c.x}, ${c.y}, ${c.z}), a cell ${shot.entities.length === 1 ? `${who} in sight has no line to from where it is` : `none of ${who} in sight has a line to from where they are`} now (rock stands between): about ${secs} seconds, in their line until there${standing ? ', out of the fire on the way' : ''}. The fire on the body burns on (${burnsOn}); there no fireball lands and none lights it again while they have no line.${comes}${lineAtEnd(bot, shot, c)}`,
    run: async () => { onAction({ action: 'out_of_fire', way: 'out_of_their_line', steps: cover.steps, health: bot.health }); await outOfFire(bot, task, () => {}, cover.path); return true; } };
}

function fireWays(bot, task, onAction = () => {}) {
  const ways = {}; let over = [];
  const standing = inFire(bot), nether = /nether/.test(String(bot.game?.dimension || ''));
  const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple');
  const eat = () => ({ description: `Eat the enchanted golden apple (${apple.count} carried): about ${EAT_MEAL_SECONDS} seconds eating first, then fire resistance for five minutes (burning no longer hurts), sixteen extra health as absorption and strong regeneration.`,
    run: async () => { onAction({ action: 'eat', item: apple.name, health: bot.health, burning: true }); return require('./survival').eatApple(bot, task, apple); } });
  // A fire resistance potion carried (note 656): burning does nothing from
  // when it acts.
  const drinkWay = () => require('./fire-resistance').bodyWay(bot, task, 'the fire and burning do not hurt', onAction);
  if (standing) {
    // Every way out there is (note 575): the run clear of any edge; the
    // crouched walk along cells beside a fall that kills, where it is the
    // only way or the quicker; a block put in the fire's cell to stand on.
    const to = route => bot.blockAt(route.at(-1))?.name === 'water' ? 'water' : 'a cell two blocks from any flame';
    const steps = route => `${route.length} step${route.length === 1 ? '' : 's'}`;
    const clear = fireRouteThrough(bot, false), route = clear || fireRouteThrough(bot, true);
    const shot = shootersAtBody(bot), endOf = route => route?.length ? route.at(-1) : null;
    if (route) ways.out_of_fire = { description: `Run out of the fire, ${steps(route)} to ${to(route)}${clear ? '' : ', through a flame on the way'}: about ${round(Math.max(0.3, route.length / SPRINT))} seconds at a sprint, then burning on up to eight seconds unless it ends in water.${lineAtEnd(bot, shot, endOf(route))}`,
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
      // With something about that can push the bot, the push on the way is
      // priced by its rate of fire, as every escape's way is (survival.js
      // routeEdge, note 610).
      const pushed = require('./survival').routeEdge(bot, edgeRoute);
      ways.crouch_out_of_fire = { description: `Walk out of the fire crouched, ${steps(edgeRoute)} to ${to(edgeRoute)}${edgeClear ? '' : ', through a flame on the way'}, ${crouched} of them beside ${drop}: crouched, a body does not walk off an edge (a hit or a push still throws it), at about ${round(SNEAK)} blocks a second; about ${round(edgeSeconds)} seconds, then burning on up to eight seconds unless it ends in water.${pushed?.beside ? pushed.says : ''}${lineAtEnd(bot, shot, endOf(edgeRoute))}`,
        run: () => outOfFire(bot, task, onAction, edgeRoute) };
    }
    const rise = riseOutOfFire(bot);
    // Both ways leave the body alight: standing on the block puts out the
    // flame under it, not the fire on the body (note 703).
    const burnsOn = `then the body burns on up to eight seconds, about ${Math.round(Math.min(8, bot.health ?? 20))} health at a health a second, unless it ends in water`;
    if (rise) ways.rise_on_block = { description: `Jump and put a block of ${rise.block.name.replaceAll('_', ' ')} (${rise.block.count} carried) in the fire's cell underfoot, which puts that flame out, and stand on it a block up, in the same spot: about ${round(PILLAR_RISE_SECONDS)} seconds; ${rise.flamesBeside ? `${rise.flamesBeside} flame${rise.flamesBeside === 1 ? '' : 's'} still beside the cell it rises to, so the body may stand beside fire there` : 'no flame beside the cell it rises to'}${rise.flamesBelow ? ` (${rise.flamesBelow} beside the block under it, a level down, which do not touch a body standing on it)` : ''}${rise.fall ? `, and ${rise.fall.into === 'lava' ? 'a drop into lava' : 'a fall that costs half the health or more'} beside it` : ''}; ${burnsOn}: standing on the block does not put out the fire on the body.${lineAtEnd(bot, shot, rise.top)}`,
      run: () => riseOnBlock(bot, task, onAction) };
    // The flame punched out where the body stands, as a player does: fire
    // breaks at the first hit. mid-242-ah-fortress-2 stood at y 44 on the
    // blocks it had risen on out of an earlier fire, a deadly drop beside
    // it, when a flame was lit in its cell: no way out was found and no
    // rise offered, the old run found no steps twenty-one times a second
    // and never asked, and it burned from 8.5 to none in ten seconds with
    // the flame a punch away (note 602).
    const flames = flamesAbout(bot);
    // Punched a moment ago and the body is in fire still: the punch came to
    // nothing here (more flames than it reaches, or a cell it does not see),
    // and it rests while another way out is on offer. 25588 (mid-236-bn,
    // 2026-10-02 13:52:31 to 13:52:45Z), in the fires of one ghast's
    // fireball, answered put_out_flames three times in seven seconds at 0.46,
    // 0.42 and 0.38, hurt in fire after each, and burned from 13.9 to none
    // within a block of where it began (note 886).
    const punched = bot._punchedFlames;
    const punchRests = punched && Date.now() - punched.at < PUNCH_REST_MS && (ways.out_of_fire || ways.crouch_out_of_fire || ways.rise_on_block);
    if (flames.length && typeof bot.dig === 'function' && !punchRests) ways.put_out_flames = { description: `Punch out the flame${flames.length === 1 ? '' : 's'} the body stands in or beside (${flames.length}), where it stands: a hit puts fire out at once, about a quarter second a flame, no step taken; then burning on up to eight seconds, and another fireball that misses can light the cell again.${lineAtEnd(bot, shot, bot.entity.position.floored())}`,
      run: async () => {
        onAction({ action: 'out_of_fire', way: 'put_out_flames', flames: flames.length, health: bot.health });
        bot._punchedFlames = { at: Date.now() };
        bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.();
        for (const b of flamesAbout(bot)) { try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; } task?.check?.(); }
        // Out, the hurt from before the punch says nothing of the cell now (inFire).
        if (!flamesAbout(bot).length) bot._fireLeftAt = Date.now();
        return !inFire(bot);
      } };
    const outOfLine = outOfLineWay(bot, task, onAction, shot, true);
    if (outOfLine) ways.out_of_their_line = outOfLine;
    if (apple) ways.eat_golden_apple = eat();
    const potion = drinkWay();
    if (potion) ways.drink_fire_resistance = potion;
    return ways;
  }
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  const pours = bucket && !nether && pourFloor(bot);
  // What each way costs is the burning it lets on (combat-estimate
  // burnLeft at a health a second): mid-244-bb, alight at 8.3 with about
  // 10.6 seconds of fire left, was told the bucket takes "about a second"
  // and burning out takes "about 8.3 health, all the health the bot has",
  // and let it burn (note 595).
  const burn = require('./body').lasts(bot, 'fire', { inFire: false }), hp = round(bot.health ?? 20);
  const burnTakes = burn.burnsToDeath ? `all ${hp} health the bot has, its death in about ${burn.secondsToDeath} seconds` : `about ${burn.healthItTakes} of the ${hp} health`;
  if (pours) ways.douse_bucket = { description: `Pour the water bucket at the feet: the fire is out as the water reaches the body, about half a second from now (the bucket to the hand, the look down, the pour), a hurt of the burning at most meanwhile, where burning on takes ${burnTakes}. Then the water back into the bucket, about a second in all, standing where it is.`, run: () => douse(bot, task, onAction) };
  // The Nether has no water to run into (fireToAnswer).
  const pond = !nether && pondNear(bot);
  if (pond) {
    const d = round(pond.offset(0.5, 0, 0.5).distanceTo(bot.entity.position));
    ways.to_water = { description: `Run into the water ${d} blocks off at (${pond.x}, ${pond.y}, ${pond.z}): about ${round(Math.max(0.3, d / SPRINT))} seconds at a sprint, burning meanwhile, and the fire is out.`,
      run: () => intoWater(bot, task, pond, onAction) };
  }
  // A cauldron of water (src/cauldron.js, note 634): in the Nether too, where
  // nothing else puts a fire out.
  const cauldrons = cauldronWays(bot, task, onAction, burn, hp);
  Object.assign(ways, cauldrons);
  const left = Math.max(1, Math.round(burn.fireLeftSeconds)), drop = round(require('./body').holdDrop(hp));
  const ends = burn.burnsToDeath
    ? `about ${left} second${left === 1 ? '' : 's'} of fire left at a health a second that armour does not stop is about ${left} health, and the bot has ${hp}: it dies of the burning in about ${burn.secondsToDeath} seconds, before the fire ends, unless something puts it out first`
    : `about ${left} second${left === 1 ? '' : 's'} of fire left, a health a second that armour does not stop, about ${burn.healthItTakes} health, leaving about ${round(hp - burn.healthItTakes)}`;
  const outOfLine = outOfLineWay(bot, task, onAction, shootersAtBody(bot), false);
  if (outOfLine) ways.out_of_their_line = outOfLine;
  ways.burn_out = { description: `Leave it to burn out and go on: ${ends}${nether ? (Object.keys(cauldrons).length ? '; in the Nether only a cauldron\'s water puts it out' : '; in the Nether nothing else puts it out') : ''}. ${drop < 1 ? 'Asked again at the next hurt of the burning' : `Asked again at about ${round(Math.max(0, (bot.health ?? 20) - require('./body').holdDrop(bot.health)))} health (${drop} more)`}, or when another way to put it out comes.`,
    hold: 15, run: async () => false };
  if (apple) ways.eat_golden_apple = eat();
  // A meal while the fire burns on (note 1013): alight and out of the
  // flames, nothing moves the fire off the body in the Nether, and a meal
  // eaten is the health coming back as it burns. 25594 (2026-10-03 07:47:16
  // to 07:47:26Z) burned nine seconds at hunger 17, 12.6 health to none,
  // cooked food carried, its answers a block risen on twice, a run and a
  // strike; no way here was the meal.
  let meal = null; try { meal = (bot.food ?? 20) < 20 ? chooseFood(bot) || null : null; } catch (_) { meal = null; }
  if (meal) {
    const points = bot.registry?.foodsByName?.[meal.name]?.foodPoints || 0, after = Math.min(20, (bot.food ?? 20) + points);
    const heals = after >= 20 ? 'at hunger 20 with the meal\'s saturation a health comes back each half second, twice what the fire takes' : after >= 18 ? `at hunger ${after} a health comes back each four seconds` : `hunger ${after} after it is still under eighteen, where nothing comes back`;
    ways.eat_meal = { description: `Eat the ${meal.name.replaceAll('_', ' ')} now while the fire burns on: about ${EAT_MEAL_SECONDS} seconds standing still, hunger ${bot.food} to ${after}; ${heals}${(bot.food ?? 20) < 18 ? ` (at ${bot.food} now nothing does)` : ''}. The fire: ${ends}.`,
      run: async () => {
        onAction({ action: 'eat', item: meal.name, food: bot.food, health: bot.health, burning: true });
        const before = bot.food ?? 0;
        const r = await require('./meal').eatThrough(bot, task, meal, { eaten: () => (bot.food ?? 0) > before, helps: () => (bot.food ?? 20) < 20, tries: 2 });
        return r.eaten;
      } };
  }
  const potion = drinkWay();
  if (potion) ways.drink_fire_resistance = potion;
  // A mob at arm's length: turning to it and striking it is a way too, and
  // every way says what its blows come to meanwhile (note 657).
  const blows = blowsAtBody(bot);
  if (blows) {
    const strikeIt = strikeWay(bot, task, onAction, blows, burn, hp);
    if (strikeIt) ways.strike_at_arm = strikeIt;
    over = horizonSays(ways, blows, burn, hp) || [];
  } else {
    // None at arm's length yet, and biters in sight that can walk at the
    // bot (arbiter.js packSays, note 1053): said first on every way, with
    // how soon the nearest is at the bot. 25591 (2026-10-03 12:32:55Z),
    // alight, two wither skeletons 7.9 and 9.3 blocks off, was offered the
    // meal ("about 1.6 seconds standing still") with no word of them, took
    // it at 0.80, and they were at it in a second and a half: 15 health to
    // none in two.
    let pack = ''; try { pack = require('./arbiter').packSays(bot); } catch (_) { pack = ''; }
    if (pack) for (const way of Object.values(ways)) way.description = `${pack.trim()} ${way.description}`;
  }
  // The old rule: the bucket poured where it can be, else (none carried)
  // the water run into, else nothing.
  const first = pours ? 'douse_bucket' : !bucket && pond ? 'to_water' : 'burn_out';
  // Not the old rule's way where the next seconds that way take more than
  // the bot has and another way does not (note 1018).
  if (over.includes(first)) return ways;
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
  if (hot.crouchSafe) ways.crouch_on_hot_floor = { description: `Crouch where it stands and stay crouched: the game does not hurt a crouched body on a magma block, so it stops at once, and the bot can rest, eat or wait here crouched. The crouch is held until the body is off the magma, taken up again after anything lets it go; a walk stands it up and is hurt on the way. A crafting table or furnace opens only to an upright click: the crouch is let go for that moment. Crouched, a body moves at about ${round(SNEAK)} blocks a second.`,
    run: async () => crouchOnHotFloor(bot, onAction) };
  const rise = hot.crouchSafe && bot.entity.position.floored().equals(hot.cell) ? riseOutOfFire(bot) : null;
  if (rise) ways.rise_on_block = { description: `Jump and put a block of ${rise.block.name.replaceAll('_', ' ')} (${rise.block.count} carried) in the cell over the ${floor}, and stand on it a block up, off the magma: about ${round(PILLAR_RISE_SECONDS)} seconds${rise.fall ? `, with ${rise.fall.into === 'lava' ? 'a drop into lava' : 'a fall that costs half the health or more'} beside it` : ''}.`,
    run: () => riseOnBlock(bot, task, onAction, { action: 'off_hot_floor', done: () => !onHotFloor(bot) }) };
  const apple = bot.inventory?.items?.().find(i => i.name === 'enchanted_golden_apple');
  if (apple) ways.eat_golden_apple = { description: `Eat the enchanted golden apple (${apple.count} carried) standing here: about ${EAT_MEAL_SECONDS} seconds eating first, hurt meanwhile, then fire resistance for five minutes, which stops the hot floor's hurt, sixteen extra health as absorption and strong regeneration.`,
    run: async () => { onAction({ action: 'eat', item: apple.name, health: bot.health, hotFloor: true }); return require('./survival').eatApple(bot, task, apple); } };
  const potion = require('./fire-resistance').bodyWay(bot, task, 'the hot floor does not hurt', a => onAction({ ...a, hotFloor: true }));
  if (potion) ways.drink_fire_resistance = potion;
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
// The step aside walks on until the head's box (the game's test,
// suffocatingBlock) is out of the block, not until the feet cross into the
// cell beside: stopped at the cell's edge, mid-242-hb (25595) stood with
// its head still in the gravel and was hurt four times more (note 680).
// Nor until the last hurt is two seconds old (headInBlock): between hurts
// the head is in the block all the same.
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
          look: aside.offset(0.5, 1.6, 0.5), maxMs: 1200, tick: 50, until: () => !suffocatingBlock(bot) });
      } catch (err) { if (err.name === 'Cancelled') throw err; }
      return !suffocatingBlock(bot);
    } };
  // A cell beside dug out and stepped into, where none is open (note 842):
  // under a column of gravel the head's own cell fills again after each dig,
  // and 25581 (2026-10-01 22:37:49 to 22:38:00Z), mining gravel down a
  // shaft with no cell open beside it, dug at the head's cell eleven seconds
  // and suffocated from 20 to none.
  const feet = bot.entity.position.floored();
  const falls = b => /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/.test(b?.name || '');
  const column = (() => { let n = 0; for (let dy = 1; dy <= 16; dy++) { const b = bot.blockAt(feet.offset(0, dy, 0)); if (!falls(b)) break; n++; } return n; })();
  if (!aside) {
    const diggable = b => !b || b.boundingBox === 'empty' || (b.boundingBox === 'block' && b.diggable !== false && !falls(b) && !/bedrock|obsidian|lava|water/.test(b.name));
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => feet.offset(dx, 0, dz))
      .filter(c => bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' && diggable(bot.blockAt(c)) && diggable(bot.blockAt(c.offset(0, 1, 0))) && !falls(bot.blockAt(c.offset(0, 2, 0))) &&
        !/lava|water/.test(bot.blockAt(c.offset(0, 2, 0))?.name || ''))
      .map(c => ({ c, secs: [c, c.offset(0, 1, 0)].reduce((t, x) => { const b = bot.blockAt(x); return t + (b?.boundingBox === 'block' ? digSeconds(bot, b) : 0); }, 0) }))
      .sort((a, b) => a.secs - b.secs)[0];
    if (side) ways.dig_aside = { description: `Dig into the wall beside the feet at (${side.c.x}, ${side.c.y}, ${side.c.z}), its head cell then its feet cell (about ${round(side.secs)} seconds with the best tool carried), and step in: nothing falls over that cell, so the head comes out of the block for good${column > 1 ? `, where ${column} blocks of ${bot.blockAt(feet.offset(0, 1, 0))?.name?.replaceAll('_', ' ') || 'it'} over the head fill its own cell again after each is dug` : ''}.`,
      run: async () => {
        onAction({ action: 'dig_out_of_block', block: bot.blockAt(feet.offset(0, 1, 0))?.name, digAside: { x: side.c.x, y: side.c.y, z: side.c.z } });
        for (const x of [side.c.offset(0, 1, 0), side.c]) {
          if (task.cancelled) throw new (require('./skills').Cancelled)(task.label);
          const b = bot.blockAt(x);
          if (b?.boundingBox !== 'block') continue;
          try { await require('./skills').equipBestTool(bot, b); } catch (_) { /* the hand, then */ }
          try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
        }
        const only = { get cancelled() { return task.cancelled; }, label: task.label, check() { if (task.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
        try { await require('./motion').move(bot, only, { label: 'out_from_under', keys: ['forward'], sneak: false, why: 'stepping into the cell dug beside, out from under a block over the head',
          look: side.c.offset(0.5, 1.6, 0.5), maxMs: 1500, tick: 50, until: () => !suffocatingBlock(bot) }); }
        catch (err) { if (err.name === 'Cancelled') throw err; }
        return !suffocatingBlock(bot);
      } };
  }
  const secs = block ? digSeconds(bot, block) : null;
  ways.dig_out = { description: `Dig the ${block ? block.name.replaceAll('_', ' ') : 'block'} the head is in${secs != null ? `, about ${round(secs)} seconds with the best tool carried` : ''}${column > 1 ? ` (${column} blocks of it stacked over the head: each dug, the next falls into the cell)` : ''}, and whatever falls after it${block && /sand|gravel/.test(block.name) ? ' (a falling column keeps coming, a dig each block)' : ''}.`,
    run: async () => true };
  return ways;
}
// The cells a way to air keeps off with a creeper about (note 851): those
// nearer it than six blocks, or than the bot is now where that is less, so
// the way can still leave from where the bot is.
function creeperKeepOff(bot, creepers) {
  const here = bot.entity.position, cells = new Set();
  for (const t of creepers) {
    const c = t.entity.position, r = Math.max(1.5, Math.min(6, t.distance - 0.5)), f = c.floored(), n = Math.ceil(r);
    for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) for (let dz = -n; dz <= n; dz++) {
      const q = f.offset(dx, dy, dz);
      if (q.offset(0.5, 0.5, 0.5).distanceTo(c) < r && !q.equals(here.floored())) cells.add(`${q}`);
    }
  }
  return cells;
}
function creeperAtFuse(bot) {
  try {
    const { FUSE_KEPT } = require('./combat-estimate');
    return require('./danger').threats(bot, FUSE_KEPT + 1).some(t => t.entity.name === 'creeper' && t.visible);
  } catch (_) { return false; }
}
function airWays(bot, task, onAction = () => {}) {
  const ways = {};
  const breath = breathSeconds(bot), left = breath + drowningSeconds(bot);
  const route = airRoute(bot, new Set(), { budgetS: breath }) || airRoute(bot, new Set(), { budgetS: left });
  // A creeper about (note 851): where each way ends from it, and a way to
  // air that keeps off it. 25583 (mid-230-bj, 2026-10-02 00:36:36Z), its
  // head under at 20 health, was offered only the shortest way ("2 cells:
  // about 0.8 seconds") with a creeper 9.2 off unsaid; the swim ran six
  // seconds toward it and the blast took it to 5.5, the next to none.
  let creepers = [];
  try { creepers = require('./danger').threats(bot, 16).filter(t => t.entity.name === 'creeper'); } catch (_) { creepers = []; }
  const fromCreeper = r => {
    if (!creepers.length || !r?.length) return '';
    const end = r[r.length - 1].offset(0.5, 0, 0.5);
    return ` It ends ${creepers.map(t => `${round(end.distanceTo(t.entity.position))} blocks from the creeper now ${round(t.distance)} off`).join(' and ')}, which walks at the bot meanwhile.`;
  };
  if (route) {
    const digs = route.reduce((n, c) => n + (c.digs?.length || 0), 0);
    ways.swim_to_air = { description: `Swim the shortest way to air, ${route.length} cell${route.length === 1 ? '' : 's'}${digs ? `, digging ${digs} block${digs === 1 ? '' : 's'} on the way` : ''}: about ${round(route.seconds ?? route.length * STEP_S)} seconds, against ${round(breath)} seconds of breath${route.seconds > breath ? ' (past the breath, into the drowning)' : ''}.${fromCreeper(route)}`,
      run: () => surfaceForAir(bot, task, onAction) };
  }
  if (creepers.length) {
    const cells = creeperKeepOff(bot, creepers);
    const away = airRoute(bot, new Set(cells), { budgetS: breath }) || airRoute(bot, new Set(cells), { budgetS: left });
    const end = r => r?.length ? `${r[r.length - 1]}` : null;
    if (away && end(away) !== end(route)) {
      const digs = away.reduce((n, c) => n + (c.digs?.length || 0), 0);
      const why = `keeping off the creeper${creepers.length === 1 ? '' : 's'}`;
      ways.swim_from_creeper = { description: `Swim to air by a way that comes no nearer the creeper${creepers.length === 1 ? '' : 's'} than six blocks (or than now, where nearer), ${away.length} cell${away.length === 1 ? '' : 's'}${digs ? `, digging ${digs} block${digs === 1 ? '' : 's'} on the way` : ''}: about ${round(away.seconds ?? away.length * STEP_S)} seconds, against ${round(breath)} seconds of breath${away.seconds > breath ? ' (past the breath, into the drowning)' : ''}.${fromCreeper(away)}`,
        run: () => surfaceForAir(bot, task, onAction, { keepOff: { cells, why } }) };
    }
  }
  const up = secondsUp(bot);
  if (up != null && up <= left) ways.straight_up = { description: `Swim and dig straight up to air: about ${round(up)} seconds, against ${round(breath)} seconds of breath${up > breath ? ' (past the breath, into the drowning)' : ''}.`,
    run: async () => { onAction({ action: 'surface', oxygen: bot.oxygenLevel, way: 'straight_up' }); await straightUp(bot, task); } };
  // A mob at arm's length while the head is under (note 1036): the blows it
  // lands over the next seconds are said first on each way, the strike is a
  // way where the breath left covers it, and the ways that leave the bot
  // alive come before the ways that do not, as alight (note 1018). 25584
  // (2026-10-03 09:52:20 to 09:52:38Z), head under at 20 health with a
  // drowned at arm's length, took swim_to_air ("about 0.8 seconds") twice
  // and nothing else was asked for sixteen seconds: fourteen blows, no swing.
  const blows = blowsAtBody(bot);
  if (blows?.mobs?.length && Object.keys(ways).length) {
    const ce = require('./combat-estimate'), { defenseWeapon } = require('./combat');
    const k = blows.mobs[0], hp = round(bot.health ?? 20), words = n => String(n).replaceAll('_', ' ');
    const weapon = defenseWeapon(bot)?.name || null, dmg = ce.WEAPONS[weapon]?.[0] ?? 1, health = ce.MOBS[k.name]?.health ?? 20;
    const swings = Math.ceil(health / ce.afterArmour(dmg, { points: ce.MOBS[k.name]?.armor || 0, toughness: 0 }));
    const secs = round(swings * ce.swingEvery(weapon)), span = Math.max(2, Math.ceil(secs));
    if (secs <= left) {
      const landed = Math.round(secs / k.every * ce.STRUCK);
      ways.strike_at_arm = { seconds: secs, description: `Turn to the ${words(k.name)} ${k.distance} blocks off${k.behind ? ', behind the bot,' : ''} and strike it with the ${weapon ? words(weapon) : 'fist'}, head under: it has ${health} health, about ${swings} swing${swings === 1 ? '' : 's'}, about ${secs} seconds, against ${round(breath)} seconds of breath${secs > breath ? ' (past the breath, into the drowning)' : ''}. A mob being struck is knocked back by each swing and lands about a third of its blows: about ${landed} of them, about ${round(landed * k.blow)} health through the armour worn. Killed, it strikes no more, and the way to air is asked of then.`,
        run: () => strikeAtArm(bot, task, k.id, onAction, { seconds: secs + 2 }) };
    }
    const over = []; let priced = 0;
    for (const [key, way] of Object.entries(ways)) {
      const struck = key === 'strike_at_arm';
      const landed = struck ? Math.round(secs / k.every * ce.STRUCK) : Math.floor(span / k.every);
      const hurt = round(landed * k.blow);
      way.description = `Over the next ${span} seconds this way${struck ? '' : `, if nothing turns to the ${words(k.name)} at arm's length`}: about ${hurt} health, ${landed} blow${landed === 1 ? '' : 's'}, from ${hp}${hurt >= hp ? ': more than the bot has' : ''} (each blow about ${k.blow} through the armour worn and knocking the body back off its swim). ${way.description}`;
      if (hurt >= hp) over.push(key);
      priced++;
    }
    if (over.length && over.length < priced) for (const key of over) { const way = ways[key]; delete ways[key]; ways[key] = way; }
  }
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

async function maintainVitals(bot, task, onAction = () => {}, { client = null, goal = null, save = () => {}, claimed = null } = {}) {
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
    const shot = shootersAtBody(bot);
    if (Object.keys(ways).length) await body.answer(bot, own, 'fire', ways, { ...asked, facts: { inFire: true, ...(shot ? { shotAt: shot.says, shooters: shot.shooters } : {}) } });
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
  if (bot.oxygenLevel > 12 && atWaterTop(bot)) { onAction({ action: 'surface', oxygen: bot.oxygenLevel, bob: true }); await bobUp(bot, own); }
  // With breath in hand (over 12 of 20, nine seconds and more) the way up is
  // not asked while a creeper is within its fuse's reach in sight of the
  // bot (note 1059): the stance chosen at it is the answer running, and the
  // question and its swim are most of a fuse. 25583 (2026-10-03 13:25:28Z),
  // air 19, a second into the dance it chose at a creeper 3.2 blocks off
  // with three health left, was asked its way to air, swam 1.2 seconds up
  // to 1.3 blocks from it, lit, and it went off before a swing landed.
  else if (bot.oxygenLevel <= 12 || (headSubmerged(bot) && !lately && !creeperAtFuse(bot))) {
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
  // The meal the claim made among blazes at hunger under eighteen (notes
  // 1001, 1006) is run as it was claimed (note 1017): the two stops below
  // had no word of it, so the turn Jev gave the meal with a stance held ate
  // nothing and stood the bot where it was. 25590 (2026-10-03 08:08:17 to
  // 08:08:23Z), 8 health, hunger 17, cooked chicken carried, a retreat
  // chosen four seconds before: the meal held the turn six seconds with
  // nothing eaten and no step taken, and a wither skeleton walked up.
  // Only as the turn Jev gave it (claimed): between a stance's ticks the
  // meal is still not a reflex.
  const unhealing = claimed?.action === 'eat' && unhealingAmongBlazes(bot);
  if (bot.food > 2 && !unhealing && closeHostile(bot)) return false;
  // In an encounter the meal is a stance, Jev's to choose with the others
  // (survival.js stanceOptions, eat): eaten here between two ticks of a
  // stance it stopped the run or the pocket chosen, a second and a half at
  // a time (mid-83-d ate at twelve health in the middle of its retreat).
  // Down to six hunger, where the bot can no longer sprint, it still eats.
  const held = require('./danger').stanceHeld(bot);
  if (bot.food > 6 && held && held.choice !== 'keep_working' && held.choice !== 'eat' && !unhealing) return false;
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
  // A meal on (bot._meal, meal.js note 701) is what keeps the shot reflex
  // and the shield guard from raising or lowering the shield through this
  // same eat: the server keeps one use of the hand at a time, so a raise or
  // a release while the bite is in progress ends the bite with nothing
  // eaten. That was fixed for the stance-chosen meal (meal.js eatThrough)
  // but not this routine one: 25594 chose to eat at food 17 mid-fight and
  // "Eating did not restore hunger" (note 717) is the same collision, here
  // unguarded. Marking the meal here gets it the same deference.
  const meal = bot._meal = { item: food.name, at: Date.now(), endsAt: Date.now() + require('./meal').EAT_MS + 400, cut: null };
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
    // A bite the server never finished (the hand was taken by something else
    // mid-bite: a shield raised by the stance that came after, a hit's
    // knock) comes back from the library as "Promise timed out" after two
    // and a half seconds: the meal was cut, nothing eaten, and it is said
    // as that, not thrown as the work's error. Thrown, three of them read
    // as a loop: mid-242-ng-fortress-4 (25595, 2026-10-02 15:17Z) was ended
    // "loop: 3× Promise timed out." six minutes in, and mid-242-dc-nether-1
    // logged it 159 times (note 909).
    try { await Promise.race([bot.consume(), cancelled]); }
    catch (err) {
      if (!/Promise timed out/.test(String(err?.message || ''))) throw err;
      console.log(`[vitals] the bite of ${food.name} was cut before it finished (hunger ${bot.food}): nothing eaten`);
      return false;
    }
    await until(task, () => bot.food > before, 3000, 'Eating did not restore hunger');
  } finally { clearInterval(watcher); bot.deactivateItem(); if (bot._meal === meal) bot._meal = null; }
  return true;
}

// What maintainVitals would do this turn, as a claim (src/arbiter.js): the
// same conditions, nothing done. The fire, the air and the head in a block
// are reflexes; powder snow and a submerged head are pressing; the meal is
// routine, pressing once sprinting is gone. A meal that waits on a renewing
// shelter plan is a claim beside it now, not a turn that never comes.
// Raw meat eaten as it is found is the lesser half of it (note 1243): raw
// beef is 3 points and cooked 8. 25592 (2026-10-04 16:14 to 16:26Z) had
// five raw mutton and four raw beef, 22 points raw and 62 cooked, ate them
// one at a time at hunger 18 and 19 with its health full, and was 'hungry.
// Looking around for something to eat' fourteen minutes later; 25595 ate
// each beef and mutton raw as it got it for an hour. Said, where nothing
// presses: hunger still above six.
const COOKED = { beef: 'cooked_beef', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', chicken: 'cooked_chicken', porkchop: 'cooked_porkchop', potato: 'baked_potato' };
function rawFacts(bot, food) {
  const cooked = COOKED[food?.name], f = bot.registry?.foodsByName || {};
  if (!cooked || !f[cooked] || !f[food.name] || bot.food <= 6) return {};
  const items = bot.inventory?.items?.() || [];
  const carried = items.filter(i => i.name === food.name).reduce((n, i) => n + i.count, 0);
  return { raw: { points: f[food.name].foodPoints, cooked: f[cooked].foodPoints, carried, furnace: items.some(i => i.name === 'furnace'), fuel: items.some(i => /^(coal|charcoal)$|_planks$|_log$/.test(i.name)) } };
}
function claim(bot) {
  if (!bot?.entity?.position || bot.game?.gameMode === 'creative') return null;
  const reflex = require('./arbiter').observeReflexes(bot).find(r => r.layer === 'vitals');
  // An alert (a creeper in reach, a mob at arm's length) is pressing, and
  // who answers it is Jev's (arbiter.js ALERTS); the body's physics is a reflex.
  if (reflex && require('./arbiter').ALERTS.has(reflex.key)) return { layer: 'vitals', action: reflex.action, urgency: 'pressing', alert: reflex.key, facts: reflex.facts };
  if (reflex) return { layer: 'vitals', action: reflex.action, urgency: 'body', reflex: reflex.key, facts: reflex.facts, preemptible: false };
  const facts = { health: bot.health, food: bot.food, air: bot.oxygenLevel, ...(bot.health < 20 ? { healing: bot.food >= 18 } : {}) };
  if (inPowderSnow(bot) || bot._freezingAt > Date.now() - 3000) return { layer: 'vitals', action: 'out_of_powder_snow', urgency: 'pressing', facts: { ...facts, freezing: true } };
  if (headSubmerged(bot) && !atWaterTop(bot) && !(bot._surfaceFailedAt > Date.now() - 60000)) return { layer: 'vitals', action: 'surface', urgency: 'pressing', facts: { ...facts, headUnderwater: true } };
  if (!(bot.food <= 16 || (bot.health < 20 && bot.food < 18) || (bot.health <= 12 && bot.food < 20))) return null;
  // Hurt with hunger under eighteen, nothing heals until a meal is eaten
  // (note 1001): the meal is then claimed with a mob close or a stance held
  // too, pressing, and whose turn it is stays Jev's (turn_priority). Four
  // deaths at blaze spawners on 2026-10-03 (05:52 to 06:58Z) ran their last
  // half minute to two minutes at hunger 17 with food carried and no meal
  // claimed: 25592 stood in its box alight thirteen seconds, 12.6 to none.
  // Only where what is close is blazes: a biter at arm's length lands every
  // blow of the meal's second and a half (notes 552, 559), and stays the
  // meal's stop.
  const close = closeHostiles(bot);
  const unhealing = unhealingAmongBlazes(bot, close);
  if (bot.food > 2 && close.length && !unhealing) return null;
  const held = require('./danger').stanceHeld(bot);
  if (bot.food > 6 && held && held.choice !== 'keep_working' && held.choice !== 'eat' && !unhealing) return null;
  const food = chooseFood(bot) || lastResortFood(bot);
  if (!food) return null;
  const effect = sideEffectSays(food.name);
  const coming = comingWhileEating(bot);
  return { layer: 'vitals', action: 'eat', urgency: bot.food <= 6 || unhealing ? 'pressing' : 'routine', facts: { ...facts, ...(unhealing ? { healthComesBackOnlyAfterAMeal: `hunger ${bot.food} is under eighteen: nothing heals until it is eighteen or more, and a meal eaten to twenty heals a health each half second while its saturation lasts` } : {}), item: food.name, foodPoints: bot.registry.foodsByName?.[food.name]?.foodPoints, ...rawFacts(bot, food), ...(effect ? { effect } : {}),
    ...(coming.length ? { comingAtTheBot: coming } : {}) }, cost: { seconds: EAT_MEAL_SECONDS } };
}

// The actions this layer reports, wherever it is run from (survival.js
// stepOnce runs it too): the turn they took was the vitals'.
const ACTIONS = new Set(['dig_out_of_block', 'douse', 'eat', 'out_of_fire', 'off_hot_floor', 'out_of_powder_snow', 'surface']);

module.exports = { rawFacts, bodyColumns, wayOutRunning, atWaterTop, bobUp, blowsAtBody, blowsDuring, strikeAtArm, strikeWay, BLOW_REACH, shootersAtBody, flamesAbout, pourFloor, claim, checkMeal, closeHostile, ACTIONS, onHotFloor, hotFloorRoute, hotFloorWays, offHotFloor, crouchOnHotFloor, suffocatingBlock, douse, intoWater, pondNear, fireWays, headWays, creeperAtFuse, airWays, asideCell, inFire, fireRoute, outOfFire, inPowderSnow, snowRoute, outOfPowderSnow, lastResortFood, lastResortFoods, sideEffectSays, SIDE_EFFECTS, chooseFood, safeFood, maintainVitals, needsAir, checkAir, headSubmerged, headInBlock, NeedsAir, digWithAirGuard, airRoute, surfaceForAir, straightUp, breathSeconds, breathShort, STEP_S, fireToAnswer, onFire };
