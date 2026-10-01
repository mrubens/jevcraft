'use strict';
// Footing one block wide over a drop that kills, with something about that
// can push the bot off it (note 769). A hard rule of the body, as the lava
// escape is: a stance that stands still (the shield guard, a meal, the
// charge's shield) is not held on such footing while a pusher can reach
// it; the bot first steps back to footing two wide or more, or walls the
// open sides at its feet, and holds there. Jev is told the footing's width,
// what can push, which of the two is done first and what it costs, and the
// bot's own record of pushes off such footing (push-record.js).
//
// Why a hard rule: of the 27 Nether deaths that began with a fall off the
// footing since 2026-09-29T23:00Z (scripts/lava-deaths.js --pushes), 24
// stood on footing one block wide, and seven held a stance that stands
// still, six of them the shield guard (a hoglin three times, a magma cube,
// a piglin's arrow, a ghast's fireball). 25585 at 15:31:15Z stood 3.7
// seconds on its own cobblestone span, one wide, 17 over the lava sea, the
// shield up, a hoglin come along the span to arm's length: its blows the
// shield took (no health lost) each knocked the body back with a hop, 1.1
// blocks in all, off the north edge.
//
// The game's rules (26.1.2, read from the server jar):
// - LivingEntity.hurtServer calls knockback(0.4, ...) away from the
//   attacker for every blow not tagged no_knockback, whether or not the
//   shield took the damage (BlocksAttacks.onBlocked, then the knockback);
//   on the ground the knockback also lifts the body 0.4 (a hop). A hoglin's
//   own throw (HoglinBase.hurtAndThrowTarget) comes only with a blow that
//   hurts: the shield stops the throw, not the knock.
// - Player.maybeBackOffFromEdge, the crouch's hold at an edge, clips only
//   the player's own moves (MoverType SELF or PLAYER), and only a move with
//   no upward part, on or just above the ground: a knock lifts the body, so
//   crouched or not it carries over the edge.
// - A blast (a ghast's fireball) pushes by ServerExplosion.hurtEntities
//   whatever is held; the shield takes the damage of a fireball that meets
//   it, not the blast's push, and the blast breaks a floor of low
//   resistance under the feet (ghast.js).
// - A block at the feet' level beside the body stops a knock toward it: the
//   body is moved along each axis and stops at a block (Entity.move).
const { Vec3 } = require('vec3');

const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const compass = (dx, dz) => dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north';
// The stances that stand still where the bot is: held on footing one wide
// with a pusher about, each blow or blast is the knock over the edge.
// hold_on_span walls or steps off by itself (survival.js holdOnSpan).
const STATIONARY = new Set(['shield_guard', 'shield_the_charge', 'eat', 'eat_golden_apple', 'drink_fire_resistance', 'back_to_wall']);
// What can push the bot, and from how far: a biter within its charge (it
// can be at arm's length within a few seconds), a magma cube within its
// hop, a shooter in sight within its reach. A blow's knock is about half a
// block with a hop (the game's 0.4), a hoglin's landed blow throws up to
// four; a fireball's blast two to four (knock-record.js).
const BITERS = { hoglin: 8, zoglin: 8, piglin: 8, piglin_brute: 8, zombified_piglin: 8, wither_skeleton: 8, zombie: 6, husk: 6, skeleton: 6, enderman: 6, vindicator: 8, ravager: 8, spider: 6, cave_spider: 6, drowned: 6 };
const HOPPERS = { magma_cube: 6, slime: 6 };
const SHOOTERS = { ghast: 64, blaze: 16, skeleton: 16, stray: 16, bogged: 16, pillager: 16, piglin: 16, breeze: 24 };
const CROUCH_SPEED = 4.317 * 0.3;
const BLOCK_SECONDS = 0.6;
const BACK_STEPS = 8;

const solid = b => b?.boundingBox === 'block';
const open = b => !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name || '');
function standable(bot, c) {
  const u = bot.blockAt(c.offset(0, -1, 0));
  return open(bot.blockAt(c)) && open(bot.blockAt(c.offset(0, 1, 0))) && solid(u) && !/magma|campfire/.test(u.name || '');
}
// The drop off one side of the feet that kills: into lava, not loaded, or a
// fall of half the health or more. { side, into, fall } or null.
function deadlySide(bot, feet, [dx, dz], health) {
  const terrain = require('./terrain');
  const c = feet.offset(dx, 0, dz);
  if (!terrain.dropAt(bot, c)) return null;
  const d = terrain.dropNear(bot, c, 0);
  if (!d) return null;
  if (d.into === 'lava' || d.into === 'unknown' || d.damage >= health / 2) return { side: compass(dx, dz), dx, dz, into: d.into, fall: d.fallBlocks, damage: d.damage };
  return null;
}
// The floor's width: 3 where a square of three by three cells stood on
// holds the feet, 2 where one of two by two does, else 1 (a span, a ledge,
// the corner of a span that turns). And its run along x and along z
// through the feet (up to three each way), for the words.
function widthAt(bot, feet) {
  const run = (dx, dz) => { let n = 0; for (let k = 1; k <= 3; k++) { if (!standable(bot, feet.offset(dx * k, 0, dz * k))) break; n++; } return n; };
  const alongX = 1 + run(1, 0) + run(-1, 0), alongZ = 1 + run(0, 1) + run(0, -1);
  const memo = new Map();
  const ok = (dx, dz) => { const k = `${dx},${dz}`; if (!memo.has(k)) memo.set(k, dx === 0 && dz === 0 ? true : standable(bot, feet.offset(dx, 0, dz))); return memo.get(k); };
  const square = n => { for (let x0 = -(n - 1); x0 <= 0; x0++) for (let z0 = -(n - 1); z0 <= 0; z0++) { let all = true; for (let i = 0; i < n && all; i++) for (let j = 0; j < n && all; j++) all = ok(x0 + i, z0 + j); if (all) return true; } return false; };
  const width = alongX < 2 || alongZ < 2 ? 1 : square(3) ? 3 : square(2) ? 2 : 1;
  return { width, alongX, alongZ };
}
// The footing where the feet are: its width, the sides open over a drop
// that kills, and the drop's depth (the least into lava, else the deepest).
function footingAt(bot, feet, { health = bot.health ?? 20 } = {}) {
  const { width, alongX, alongZ } = widthAt(bot, feet);
  const deadly = AROUND.map(d => deadlySide(bot, feet, d, health)).filter(Boolean);
  const lava = deadly.filter(d => d.into === 'lava');
  const worst = lava.length ? lava.sort((a, b) => a.fall - b.fall)[0] : deadly.sort((a, b) => b.fall - a.fall)[0] || null;
  return { cell: feet, width, alongX, alongZ, deadly, worst, narrow: width < 2 && deadly.length > 0 };
}
function footingSays(f) {
  if (!f) return '';
  const sides = f.deadly.map(d => d.side);
  const drop = f.worst ? (f.worst.into === 'lava' ? `lava ${f.worst.fall} down` : f.worst.into === 'unknown' ? `a drop of at least ${f.worst.fall}, the ground under it not loaded` : `a fall of ${f.worst.fall}, about ${f.worst.damage} health`) : '';
  const shape = f.width >= 2 ? `${f.width} blocks wide` : f.alongX >= 2 && f.alongZ >= 2 ? 'one block wide (the corner of a span that turns)' : `one block wide (it runs ${Math.max(f.alongX, f.alongZ) >= 4 ? '4 or more' : Math.max(f.alongX, f.alongZ)} ${f.alongX >= f.alongZ ? 'east to west' : 'north to south'})`;
  return `The footing here is ${shape}${sides.length ? `, open ${sides.join(' and ')} over ${drop}` : ''}.`;
}
// What can push the bot from where it stands: [{ name, distance, how,
// position, visible }]. `about`: threats as danger.js gives them, or plain
// { name, position, distance, visible } (a flight record's mobs).
function pushersAt(about, { bot = null } = {}) {
  const out = [];
  // A walker with no way to the bot (walk-reach.js) pushes nothing: a
  // hoglin on the shore below a span cannot get onto it.
  let apart = new Set();
  if (bot) { try { apart = require('./walk-reach').walkersApart(bot, (about || []).filter(t => t.entity)).ids; } catch (_) { apart = new Set(); } }
  for (const t of about || []) {
    if (t.entity && apart.has(t.entity.id)) continue;
    const name = t.entity?.name || t.name, position = t.entity?.position || t.position, distance = t.distance, visible = t.visible !== false;
    if (!name || !position || !(distance >= 0)) continue;
    const shoots = t.entity ? (() => { try { return require('./mob-policy').shooter(t.entity); } catch (_) { return !!SHOOTERS[name]; } })() : SHOOTERS[name] && !BITERS[name];
    if (shoots && SHOOTERS[name] && visible && distance <= SHOOTERS[name]) out.push({ name, distance, position, visible, how: name === 'ghast' || name === 'breeze' ? 'blast' : 'shot' });
    else if (!shoots && BITERS[name] && distance <= BITERS[name]) out.push({ name, distance, position, visible, how: 'blow' });
    else if (HOPPERS[name] && distance <= HOPPERS[name]) out.push({ name, distance, position, visible, how: 'blow' });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
// The nearest footing two wide or more by the walk (level, a step up with
// head room, a step down), within BACK_STEPS, no nearer any biter than the
// bot is now, no lava beside it at the feet or the floor; one with no drop
// that kills beside it first. { cell, way, steps, seconds, beside } or null.
function wideFooting(bot, feet, pushers, { health = bot.health ?? 20, steps = BACK_STEPS } = {}) {
  const biters = (pushers || []).filter(p => p.how === 'blow');
  const d0 = c => Math.min(Infinity, ...biters.map(p => Math.hypot(c.x + 0.5 - p.position.x, c.z + 0.5 - p.position.z)));
  const now = d0(feet);
  const lavaNext = c => AROUND.some(([dx, dz]) => [0, -1].some(dy => /lava/.test(bot.blockAt(c.offset(dx, dy, dz))?.name || '')));
  const from = new Map([[`${feet}`, null]]);
  let ring = [feet], found = [];
  for (let n = 0; n < steps && ring.length && !found.length; n++) {
    const next = [];
    for (const c of ring) for (const [dx, dz] of AROUND) for (const dy of [0, 1, -1]) {
      const to = c.offset(dx, dy, dz), k = `${to}`;
      if (from.has(k)) continue;
      if (dy === 1 && !open(bot.blockAt(c.offset(0, 2, 0)))) continue;
      if (dy === -1 && !open(bot.blockAt(c.offset(dx, 1, dz)))) continue;
      if (!standable(bot, to) || lavaNext(to) || d0(to) < now - 0.5) continue;
      from.set(k, c); next.push(to);
    }
    found = next.map(c => ({ c, f: footingAt(bot, c, { health }) })).filter(x => x.f.width >= 2);
    ring = next;
  }
  if (!found.length) return null;
  const best = found.sort((a, b) => a.f.deadly.length - b.f.deadly.length)[0];
  const way = [best.c];
  for (let p = from.get(`${best.c}`); p && `${p}` !== `${feet}`; p = from.get(`${p}`)) way.unshift(p);
  return { cell: best.c, way, steps: way.length, seconds: Math.round((way.length / CROUCH_SPEED + 0.2) * 10) / 10, beside: best.f.deadly.length, width: best.f.width };
}
// The walls at the feet for the sides open over the drop: a floor under
// each where there is none (laid first, of a block that holds) and the
// wall on it. Counted here; laid by survival.js railSpan.
function wallsAt(bot, feet, f, carried) {
  const cells = f.deadly.map(d => feet.offset(d.dx, 0, d.dz));
  const floors = cells.filter(c => !solid(bot.blockAt(c.offset(0, -1, 0)))).length;
  const need = cells.length + floors;
  return { cells, need, floors, carried, enough: carried >= need, seconds: Math.round(need * BLOCK_SECONDS * 10) / 10 };
}
// The rule's plan for a stance that stands still here, or null where the
// footing is two wide or more, no side is open over a drop that kills, or
// nothing that can push is about. `carried`: building blocks carried.
function planAt(bot, feet, about, { health = bot.health ?? 20, carried = 0 } = {}) {
  if (!feet || typeof bot?.blockAt !== 'function') return null;
  const f = footingAt(bot, feet, { health });
  if (!f.narrow) return null;
  const pushers = pushersAt(about, { bot });
  if (!pushers.length) return null;
  const back = wideFooting(bot, feet, pushers, { health });
  const walls = wallsAt(bot, feet, f, carried);
  // The quicker of the two; the walls where no footing is in reach, the
  // step back where the blocks are short.
  const choice = back && (!walls.enough || back.seconds <= walls.seconds) ? 'back' : walls.enough ? 'walls' : 'none';
  return { footing: f, pushers, back, walls, choice };
}
function pusherSays(p) {
  const said = p.name.replaceAll('_', ' ');
  const how = p.how === 'blast' ? 'its fireball\'s blast, which the shield does not stop' : p.how === 'shot' ? `its ${p.name === 'blaze' ? 'fireball' : 'arrow'}'s knock` : `its blow's knock${p.name === 'hoglin' || p.name === 'zoglin' ? ' (and its throw when the blow lands)' : ''}, which the shield does not stop`;
  return `the ${said} ${Math.round(p.distance)} blocks off (${how})`;
}
// In words, for the options of a stance that stands still: the footing,
// what can push, what is done first and its seconds, the game's rules.
function planSays(plan, choice = null) {
  if (!plan) return '';
  const { footing: f, pushers, back, walls } = plan;
  const who = pushers.slice(0, 3).map(pusherSays).join(', ');
  const first = plan.choice === 'back'
    ? `So it is not held here: the bot first steps back ${back.steps} cell${back.steps === 1 ? '' : 's'}, crouched, to footing ${back.width} wide at (${back.cell.x}, ${back.cell.y}, ${back.cell.z}), about ${back.seconds} seconds, and holds there${walls.enough ? ` (walling the ${f.deadly.length} open side${f.deadly.length === 1 ? '' : 's'} here instead would take ${walls.need} blocks, about ${walls.seconds} seconds)` : ''}.`
    : plan.choice === 'walls'
      ? `So it is not held here open: the bot first walls the ${f.deadly.length} open side${f.deadly.length === 1 ? '' : 's'} at its feet (${walls.need} block${walls.need === 1 ? '' : 's'}${walls.floors ? `, ${walls.floors} of them floors under a wall` : ''}, about ${walls.seconds} seconds, anything at reach hitting meanwhile), and holds behind them; ${back ? `footing two wide is ${back.steps} cells off, about ${back.seconds} seconds` : `no footing two wide is within ${BACK_STEPS} steps`}.`
      : `No footing two wide is within ${BACK_STEPS} steps and the blocks carried (${walls.carried}) do not wall the ${f.deadly.length} open side${f.deadly.length === 1 ? '' : 's'} (${walls.need}): held here, a knock toward ${f.deadly.map(d => d.side).join(' or ')} is the fall.`;
  const rules = ' The game\'s rules: a blow the shield takes does no harm but still knocks the bot back, about half a block with a hop; crouching stops the bot\'s own steps at an edge, not a knock, which lifts the body over it; a block at the feet\' level on that side stops the knock.';
  const record = require('./push-record').says(choice, pushers.map(p => p.name));
  return ` ${footingSays(f)} What can push the bot off it: ${who}. ${first}${rules}${record}`;
}
// For a flight record's scene (scripts): the plan from a saved world and
// the mobs the frames listed.
function planFromRecord(bot, pos, mobs, { health = 20, carried = 0 } = {}) {
  const feet = require('./terrain').restingCell(bot, pos) || new Vec3(Math.floor(pos.x), Math.floor(pos.y + 0.01), Math.floor(pos.z));
  const about = (mobs || []).filter(m => m.at).map(m => ({ name: m.name, position: new Vec3(m.at.x, m.at.y, m.at.z), distance: m.d, visible: m.seen !== false }));
  return planAt(bot, feet, about, { health, carried });
}
module.exports = { STATIONARY, BITERS, HOPPERS, SHOOTERS, BACK_STEPS, footingAt, footingSays, widthAt, pushersAt, wideFooting, wallsAt, planAt, planSays, planFromRecord, pusherSays };
