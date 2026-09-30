'use strict';
// Lava, by rule (note 756). The body's safety, not a judgment: 25597
// (mid-241-bf, 2026-09-30 14:14:51-59Z) came back from a reconnect standing
// in a pool of its own poured water beside the lava it had fetched, the
// water's flow carried it into a lava cell a block down within two seconds
// (nothing held: no key, no walk), and the way out was a question, body_way,
// asked 4.1 seconds after the first lava hurt (the ways out took that long
// to be worked out on a loaded machine) and still unanswered 1.2 seconds
// later, when the bot died at y -55 with its full kit. Since 2026-09-29 23Z,
// 26 of 38 spells in lava ended in death (scripts/lava-deaths.js).
//
// So: in lava without fire resistance on the body, the way out is taken at
// once, the safety rule's own order (survival.js lavaWays: into water, onto
// the nearest dry cell a swim reaches, a block put into the lava under the
// feet, back the way the bot came, straight up), no question asked; every
// other question waits for it (decisions/index.js refuses to ask while the
// body is in lava). With fire resistance lasting, the lava does not hurt and
// the way is still Jev's (body_way). The facts the rule acted on are logged
// and put on the flight record (the 'lava_escape' event).
//
// And every movement target a reflex or a survival action chooses is read
// for lava and fire at the cell, its floor and the cells on the way
// (targetHot), before anything is placed or walked; and on joining (a
// reconnect, a restart) the ground about the bot is read again before any
// action resumes (settleAfterJoin).
const { Vec3 } = require('vec3');

const HOT_BODY = /^(lava|flowing_lava|fire|soul_fire)$/;
const LAVA = /^(flowing_)?lava$/;
const round = n => Math.round(n * 10) / 10;
const cellOf = p => ({ x: p.x, y: p.y, z: p.z });

// In lava with no fire resistance lasting (body.js fireResistant): the
// body is burning down at about two health a half second through iron.
function mustEscape(bot) {
  try { return !!bot?.entity?.position && require('./terrain').bodyInLava(bot) && !require('./body').fireResistant(bot); }
  catch (_) { return false; }
}

// What is hot at a cell for a body in it: lava or fire.
function hotBody(bot, c) {
  const b = bot.blockAt(new Vec3(c.x, c.y, c.z));
  return b && HOT_BODY.test(b.name) ? b.name : null;
}
// The floor a body standing at `c` has: lava or fire under it, a hot floor
// (a magma block, a lit campfire), or open air over lava within four blocks
// (a fall into it). Water holds the body up. -> the hot name, or null.
function hotUnder(bot, c) {
  const terrain = require('./terrain');
  for (let dy = 1; dy <= 5; dy++) {
    const b = bot.blockAt(new Vec3(c.x, c.y - dy, c.z));
    if (!b) return null;
    if (LAVA.test(b.name) || HOT_BODY.test(b.name)) return b.name;
    if (b.boundingBox === 'block') return dy === 1 && terrain.hotFloor(b) ? b.name : null;
    if (/water|bubble_column|kelp|seagrass/.test(b.name)) return null;
  }
  return null;
}

// A movement target read for lava and fire: the cell and the one over it
// (the head), its floor, and the cells on the straight way to it from
// `from` (the body's feet, by default), each with its floor. -> { part,
// cell, name } for the first hot thing found, or null. `past`: also the cell
// one beyond the target on the same line (a climb or run that carries past
// it, mid-235-a).
function targetHot(bot, to, { from = bot?.entity?.position, past = false, path = true } = {}) {
  if (!to || typeof bot?.blockAt !== 'function') return null;
  const t = new Vec3(Math.floor(to.x), Math.floor(to.y), Math.floor(to.z));
  for (const [part, c] of [['target', t], ['target head', t.offset(0, 1, 0)]]) { const n = hotBody(bot, c); if (n) return { part, cell: cellOf(c), name: n }; }
  const under = hotUnder(bot, t);
  if (under) return { part: 'target floor', cell: cellOf(t.offset(0, -1, 0)), name: under };
  if (path && from) {
    const a = new Vec3(from.x, from.y, from.z), b = t.offset(0.5, 0, 0.5);
    const start = a.floored(), n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
    const seen = new Set();
    // Every column the body's box (0.6 across) touches on the way.
    for (let i = 1; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n, z = a.z + (b.z - a.z) * i / n;
      for (let cx = Math.floor(x - 0.3); cx <= Math.floor(x + 0.3); cx++) for (let cz = Math.floor(z - 0.3); cz <= Math.floor(z + 0.3); cz++) {
        const c = new Vec3(cx, Math.floor(y + 0.01), cz), k = `${c}`;
        if (seen.has(k) || (c.x === start.x && c.z === start.z) || (c.x === t.x && c.z === t.z)) continue;
        seen.add(k);
        for (const [part, q] of [['path', c], ['path head', c.offset(0, 1, 0)]]) { const h = hotBody(bot, q); if (h) return { part, cell: cellOf(q), name: h }; }
        const u = hotUnder(bot, c);
        if (u && bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block') return { part: 'path floor', cell: cellOf(c.offset(0, -1, 0)), name: u };
      }
    }
    if (past && (t.x !== start.x || t.z !== start.z)) {
      const dx = Math.sign(t.x - start.x), dz = Math.sign(t.z - start.z);
      const beyond = t.offset(Math.abs(t.x - start.x) >= Math.abs(t.z - start.z) ? dx : 0, 0, Math.abs(t.x - start.x) >= Math.abs(t.z - start.z) ? 0 : dz);
      const h = hotBody(bot, beyond) || (bot.blockAt(beyond.offset(0, -1, 0))?.boundingBox !== 'block' ? hotUnder(bot, beyond) : null);
      if (h) return { part: 'past the target', cell: cellOf(beyond), name: h };
    }
  }
  return null;
}
const hotSays = hit => hit ? `${hit.name.replaceAll('_', ' ')} ${hit.part === 'past the target' ? 'under the cell past the target' : `at the ${hit.part}`} (${hit.cell.x}, ${hit.cell.y}, ${hit.cell.z})` : '';

// Lava within `reach` blocks across of the feet, from a block over them to
// two under: what a drift in water or a slip carries the body into.
function lavaNear(bot, reach = 2, p = bot.entity.position) {
  const f = p.floored();
  let best = null;
  for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) for (let dy = -2; dy <= 1; dy++) {
    const c = f.offset(dx, dy, dz);
    if (!LAVA.test(bot.blockAt(c)?.name || '')) continue;
    const d = Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z);
    if (!best || d < best.rawDistance || (d === best.rawDistance && c.y > best.cell.y)) best = { cell: cellOf(c), distance: round(d), rawDistance: d };
  }
  if (best) delete best.rawDistance;
  return best;
}

// What the body is in and near, for the log and the record.
function surroundings(bot) {
  const p = bot.entity.position, f = p.floored();
  const name = c => bot.blockAt(c)?.name || null;
  const flow = bot.blockAt(f);
  const level = flow?.getProperties?.().level;
  return {
    position: { x: round(p.x), y: round(p.y), z: round(p.z) }, health: round(bot.health ?? 20),
    dimension: String(bot.game?.dimension || ''), feet: name(f), head: name(f.offset(0, 1, 0)), floor: name(f.offset(0, -1, 0)),
    inLava: require('./terrain').bodyInLava(bot), inWater: !!bot.entity.isInWater || /water/.test(flow?.name || ''),
    ...(/water/.test(flow?.name || '') && level !== undefined ? { waterLevel: Number(level), waterFlowing: Number(level) !== 0 } : {}),
    alight: !!(bot.entity.metadata?.[0] & 1), fireResistant: (() => { try { return require('./body').fireResistant(bot); } catch (_) { return false; } })(),
    velocity: bot.entity.velocity ? { x: round(bot.entity.velocity.x * 20), y: round(bot.entity.velocity.y * 20), z: round(bot.entity.velocity.z * 20) } : null,
    lavaNear: lavaNear(bot),
  };
}

// In lava: the way out now, by the safety rule's order, no question asked.
// `survival` is the Survival (survival.js), whose lavaWays builds the ways
// and whose report records the one taken. -> whether the body is out.
async function escape(survival, task, goal, save, { log = console.log, why = 'in lava' } = {}) {
  const bot = survival.bot, t0 = Date.now();
  const ways = survival.lavaWays(task, goal, save);
  const keys = Object.keys(ways), took = keys[0] || null;
  const facts = { ...surroundings(bot), why, took, offered: keys, workedOutMs: Date.now() - t0 };
  if (took) facts.says = String(ways[took].description || '').slice(0, 400);
  log(`[lava-escape] ${why} at (${facts.position.x}, ${facts.position.y}, ${facts.position.z}), ${facts.health} health: ${took ? `took ${took} by the body's safety rule, no question asked` : 'no way out found'} (worked out in ${facts.workedOutMs} ms; ${keys.length} way${keys.length === 1 ? '' : 's'} on offer: ${keys.join(', ') || 'none'})`);
  bot._lavaEscape = { at: t0, took };
  const kept = survival.state.lavaEscapes ||= [];
  kept.push({ at: new Date(t0).toISOString(), position: facts.position, health: facts.health, took, offered: keys, workedOutMs: facts.workedOutMs, why });
  if (kept.length > 10) kept.splice(0, kept.length - 10);
  try { bot.emit?.('lava_escape', facts); } catch (_) { /* the record is not the escape */ }
  if (!took) return false;
  let out = false;
  try { out = (await ways[took].run()) !== false && !require('./terrain').bodyInLava(bot); }
  finally {
    const after = { took, out, seconds: round((Date.now() - t0) / 1000), health: round(bot.health ?? 20), position: surroundings(bot).position };
    log(`[lava-escape] ${took}: ${out ? 'out of the lava' : 'still in the lava'} after ${after.seconds} s at ${after.health} health`);
    Object.assign(kept[kept.length - 1] || {}, { out, seconds: after.seconds, healthAfter: after.health });
    save?.();
  }
  return out;
}

// On joining (a reconnect, a restart, a respawn): the ground about the bot
// read again before any action resumes. The old connection's keys and walk
// are gone with it; the body may have drifted or been left where the last
// action put it. In lava, the way out is taken at once (escape). In water
// with lava within two blocks, the body is walked out of the water onto the
// nearest dry cell whose cell, floor and way are clear of lava and fire, as
// the water's flow carries a body standing in it. The facts are logged, kept
// (state.joinSurvey) and put on the flight record ('join_survey').
async function settleAfterJoin(bot, survival, { log = console.log, task = null } = {}) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function' || bot.game?.gameMode === 'creative') return null;
  const { Task } = require('./skills');
  const t = task || new Task('join', 'read the ground on joining');
  const facts = surroundings(bot);
  facts.at = new Date().toISOString();
  let acted = null;
  try {
    if (facts.inLava && !facts.fireResistant && survival) {
      acted = 'lava_escape';
      facts.out = await escape(survival, t, survival.goalForJoin || {}, () => {}, { log, why: 'in lava on joining' });
    } else if (facts.inWater && facts.lavaNear) {
      acted = 'out_of_water_by_lava';
      facts.out = await outOfWaterByLava(bot, t, facts, { log });
    }
  } catch (err) {
    if (err?.name === 'Cancelled') throw err;
    facts.error = String(err?.message || err).slice(0, 200);
  }
  facts.acted = acted;
  log(`[join] the ground read again before resuming: at (${facts.position.x}, ${facts.position.y}, ${facts.position.z}) in ${facts.feet}${facts.inWater ? `${facts.waterFlowing ? ' (flowing)' : ''}` : ''}, floor ${facts.floor}, ${facts.inLava ? 'in lava' : facts.lavaNear ? `lava ${facts.lavaNear.distance} blocks off at (${facts.lavaNear.cell.x}, ${facts.lavaNear.cell.y}, ${facts.lavaNear.cell.z})` : 'no lava within 2 blocks'}; ${acted ? `${acted}: ${facts.out ? 'done' : 'not done'}${facts.error ? ` (${facts.error})` : ''}` : 'nothing to do first'}`);
  if (survival?.state) survival.state.joinSurvey = facts;
  try { bot.emit?.('join_survey', facts); } catch (_) { /* the record is not the step */ }
  return facts;
}

// Out of the water beside lava onto the nearest dry cell clear of it: the
// cell (survival.js lavaExit, its floor solid and not hot, none of the lava
// or fire in it, walked by the way through), read by targetHot, walked cell
// by cell on held keys (motion.js, which will not walk into lava either).
async function outOfWaterByLava(bot, task, facts, { log = console.log } = {}) {
  const { lavaExit, routeOf } = require('./survival');
  const { move } = require('./motion');
  const exit = lavaExit(bot, 4, { dryOnly: true });
  if (!exit) { facts.exit = null; return false; }
  const hot = targetHot(bot, exit, { past: true });
  facts.exit = { ...cellOf(exit), blocks: exit.blocks != null ? round(exit.blocks) : null, ...(hot ? { refused: hotSays(hot) } : {}) };
  if (hot) { log(`[join] the dry cell at (${exit.x}, ${exit.y}, ${exit.z}) not walked to: ${hotSays(hot)}`); return false; }
  const route = exit.route?.length ? exit.route : [exit];
  bot._leavingLava = false;
  for (const wp of route) {
    const c = new Vec3(wp.x, wp.y, wp.z);
    // Each cell on the way read again as it is reached.
    const step = targetHot(bot, c);
    if (step) { facts.stoppedAt = hotSays(step); return false; }
    await move(bot, task, { label: 'out_of_water_by_lava', keys: ['forward', 'jump'], sneak: false, why: 'out of the water, lava beside it, onto dry ground clear of the lava', look: c.offset(0.5, 1, 0.5),
      maxMs: 2000, tick: 50, until: () => { const f = bot.entity.position.floored(); return f.x === c.x && f.z === c.z; } });
  }
  // Settled on it: the jump held on the way comes down.
  for (let i = 0; i < 20 && !bot.entity.onGround; i++) { task.check(); await new Promise(r => setTimeout(r, 50)); }
  const f = bot.entity.position.floored();
  return f.x === exit.x && f.z === exit.z && !/water/.test(bot.blockAt(f)?.name || '');
}

module.exports = { mustEscape, targetHot, hotSays, hotUnder, lavaNear, surroundings, escape, settleAfterJoin, outOfWaterByLava };
