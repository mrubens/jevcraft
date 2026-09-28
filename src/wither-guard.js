'use strict';
// A wither skeleton met as a player meets one (note 601). mid-242-ah-
// fortress-1, 2026-09-28 11:43: in full iron with an iron sword and a
// shield, a wither skeleton came at the bot across a warped cavern; it ate
// with the skeleton coming, was struck, withered, and went from 10 to none in
// six seconds while "none of these" was answered at each asking (0.40). What
// a player does, from the 26.1.2 jar:
//
// - A wither skeleton is 0.7 by 2.4 (EntityType sized): its box is not let
//   into a space under three blocks high. Its blow lands where its box,
//   widened sqrt(2.04) - 0.6 (about 0.83) sideways and not at all up or down,
//   meets the player's (Mob.isWithinMeleeAttackRange, getAttackBoundingBox):
//   about 1.5 blocks centre to centre. A player's sword reaches three blocks
//   from the eye. So under a ceiling two high, with the cells round it two
//   high too, it stands a block and a half off at the nearest: out of its
//   reach, within the sword's (lowCeilingPlan).
// - A shield raised facing the blow takes it whole; a hit taken whole is no
//   hurt (LivingEntity.hurtServer returns false), and the wither comes only
//   with a hurt (WitherSkeleton.doHurtTarget adds it after a blow that
//   hurts), so a blocked blow withers nothing; a stone sword disables no
//   shield. Its blows come every twenty ticks at reach (MeleeAttackGoal), each
//   with the swing of its arm the client sees (Mob.swing, the animate
//   packet), and a blocked one knocks it back half a block. So the shield
//   stays up facing it, and the sword swings right after its blow lands on
//   the shield, or while it is within the sword's reach and out of its own,
//   and the shield goes straight back up (guard).
const { Vec3 } = require('vec3');
const ce = require('./combat-estimate');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The jar's widening of a mob's box for its blow (Mob.DEFAULT_ATTACK_REACH).
const WIDEN = Math.sqrt(2.04) - 0.6;
// Its blow comes each twenty ticks at reach; a swing of the sword right
// after it is safe until the next.
const BLOW_EVERY = 1, AFTER_BLOW_MS = 600;
const AROUND4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Whether a mob's blade reaches a player standing at `at` (feet).
function bladeReaches(mob, at, { width = 0.6, height = 1.8 } = {}) {
  if (!mob?.position || !at) return false;
  const h = mob.height || ce.bodyHeight(mob.name);
  const span = (mob.width || 0.6) / 2 + WIDEN + width / 2;
  const overlap = mob.position.y < at.y + height && at.y < mob.position.y + h;
  return overlap && Math.abs(mob.position.x - at.x) < span && Math.abs(mob.position.z - at.z) < span;
}

// The walkers taller than two blocks: a space two high keeps them out.
function tallWalker(t) {
  const { WALKERS } = require('./walk-reach');
  return !!t?.entity?.position && WALKERS.has(t.entity.name) && ce.bodyHeight(t.entity.name) > 2;
}

const empty = b => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name || '');
const solid = b => !!b && b.boundingBox === 'block';
const NOT_DUG = /bedrock|obsidian|barrier|spawner|chest|end_portal|reinforced|command/;
const key = c => `${c.x},${c.y},${c.z}`;

// The order the ceiling's blocks go down in: each against a face already
// there (the rock, or one put down before it). null when one has none.
// `first`, a cell's rank (lower first) among those that can go in: the
// cells toward the tall walkers first, so the way under is shut soonest.
function attachOrder(bot, cells, first = () => 0) {
  const left = cells.slice(), out = [], placed = new Set();
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (left.length) {
    const can = left.map((c, i) => ({ c, i })).filter(({ c }) => faces.some(([dx, dy, dz]) => { const n = c.offset(dx, dy, dz); return placed.has(key(n)) || solid(bot.blockAt(n)); }));
    if (!can.length) return null;
    const i = can.sort((a, b) => first(a.c) - first(b.c))[0].i;
    const [c] = left.splice(i, 1);
    out.push(c); placed.add(key(c));
  }
  return out;
}

// Where the bot can stand under a ceiling two high that keeps every tall
// walker here out of its reach, and what it takes: the ceiling put in over
// the bot's cell and each cell round it that is open there ('roof', the
// blocks carried), or a hole two in and two high dug into the rock beside
// it ('dig', the tools carried). Judged by walk-reach with the change made
// (the walkers' own heights, note 601): each tall walker kept off, and the
// sword still reaching where it can stand nearest. The quicker first.
// -> { kind, stand, at, placed, dug, seconds, blocks, digMs, material } or null
function lowCeilingPlan(bot, danger, { blockSeconds = 0.6 } = {}) {
  if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const tall = danger.filter(tallWalker);
  if (!tall.length) return null;
  const { walkersApart } = require('./walk-reach');
  const shelter = require('./shelter');
  const feet = bot.entity.position.floored();
  const stock = bot.inventory.items().filter(i => shelter.buildingMaterials.has(i.name)).sort((a, b) => shelter.LAST_MATERIALS.has(a.name) - shelter.LAST_MATERIALS.has(b.name) || b.count - a.count)[0];
  const keptOff = (at, opts) => { let kept; try { kept = walkersApart(bot, tall, { at, ...opts }); } catch (_) { return false; } return tall.every(t => kept.ids.has(t.entity.id)); };
  const eye = bot.entity.position.offset(0, 1.62, 0);
  const plans = [];
  // Under a ceiling put in: the bot's own cell, or one step along its level.
  const stands = [{ cell: feet, steps: 0 }, ...AROUND4.map(([dx, dz]) => ({ cell: feet.offset(dx, 0, dz), steps: 1 }))]
    .filter(({ cell }) => empty(bot.blockAt(cell)) && empty(bot.blockAt(cell.offset(0, 1, 0))) && solid(bot.blockAt(cell.offset(0, -1, 0))));
  for (const { cell, steps } of stands) {
    const over = [];
    let unfit = false;
    for (let dx = -1; dx <= 1 && !unfit; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = cell.offset(dx, 2, dz), b = bot.blockAt(c);
      // Not loaded, or neither open nor a full block (a slab, a torch, a
      // liquid): not judged, not offered.
      if (empty(b)) over.push(c);
      else if (!solid(b)) { unfit = true; break; }
    }
    if (unfit || (over.length && (!stock || stock.count < over.length))) continue;
    // A body in a cell stops its block (the game puts none where a body
    // is): a tall walker already under one of them has come in.
    const bodyIn = c => tall.some(t => { const p = t.entity.position, w = (t.entity.width || 0.7) / 2, h = t.entity.height || ce.bodyHeight(t.entity.name);
      return p.x + w > c.x && p.x - w < c.x + 1 && p.z + w > c.z && p.z - w < c.z + 1 && p.y < c.y + 1 && p.y + h > c.y; });
    if (over.some(bodyIn)) continue;
    const nearest = c => Math.min(...tall.map(t => Math.hypot(t.entity.position.x - (c.x + 0.5), t.entity.position.z - (c.z + 0.5))));
    // Its own cell last: the cells round it are the way in.
    const order = attachOrder(bot, over, c => (c.x === cell.x && c.z === cell.z ? 1000 : nearest(c)));
    if (!order) continue;
    const at = new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5);
    if (order.some(c => at.offset(0, 1.62, 0).distanceTo(c.offset(0.5, 0.5, 0.5)) > 4.5)) continue;
    if (!keptOff(at, { placed: order })) continue;
    // Shut to it once every cell round the bot's own is in: its own last
    // of those in the order.
    const lastRound = order.reduce((n, c, i) => (c.x === cell.x && c.z === cell.z ? n : i + 1), 0);
    plans.push({ kind: 'roof', stand: cell, at, placed: order, dug: [], steps, blocks: order.length, material: stock?.name || null,
      shutAt: Math.round((steps * 0.3 + lastRound * blockSeconds) * 10) / 10,
      seconds: Math.round((steps * 0.3 + order.length * blockSeconds) * 10) / 10 });
  }
  // A hole two in and two high into the rock beside the bot, rock over it.
  const { blockDigMs } = require('./bunker');
  for (const [dx, dz] of AROUND4) {
    const a = feet.offset(dx, 0, dz), b = feet.offset(2 * dx, 0, 2 * dz);
    const cells = [a, a.offset(0, 1, 0), b, b.offset(0, 1, 0)];
    const blocks = cells.map(c => bot.blockAt(c));
    if (!blocks.every(x => solid(x) && x.diggable !== false && !NOT_DUG.test(x.name || ''))) continue;
    if (![a, b].every(c => solid(bot.blockAt(c.offset(0, -1, 0))) && solid(bot.blockAt(c.offset(0, 2, 0))))) continue;
    // No liquid to run in through the walls opened.
    const wet = cells.some(c => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => /lava|water/.test(bot.blockAt(c.offset(x, y, z))?.name || '')));
    if (wet) continue;
    const digMs = blocks.reduce((n, x) => n + blockDigMs(bot, x), 0);
    if (!Number.isFinite(digMs)) continue;
    const at = new Vec3(b.x + 0.5, b.y, b.z + 0.5);
    if (!keptOff(at, { dug: cells })) continue;
    plans.push({ kind: 'dig', stand: b, at, placed: [], dug: cells, steps: 2, blocks: 4, digMs, dir: [dx, dz], shutAt: Math.round((digMs / 1000 + 0.6) * 10) / 10,
      seconds: Math.round((digMs / 1000 + 0.6) * 10) / 10 });
  }
  if (!plans.length) return null;
  const best = plans.sort((x, y) => x.seconds - y.seconds)[0];
  // The eye's distance to where it stood, said: a block placed from here.
  best.from = Math.round(eye.distanceTo(best.at.offset(0, 1.62, 0)) * 10) / 10;
  best.tall = tall.map(t => t.entity.id);
  return best;
}

// What the arena measured, with the kit of the death it is built from (an
// iron sword, a shield, full iron, no pickaxe; scripts/lib/arena.js
// wither_cave_corner and wither_cave_pair, five runs each, the way named
// answered wherever it was offered, the rest Jev's).
const SCENES = {
  one: 'against one wither skeleton coming across a cavern at the bot in a rock corner, from 14.5 health',
  two: 'against two wither skeletons coming across the same cavern, from 14.5 health',
};
// Measured 2026-09-28 (note 601), five runs a drill: this way wherever it
// was offered (ARENA_PREFER), and the fight as Jev chose its stances before.
const MEASURED = {
  guard: { one: { runs: 5, kills: 5, of: 5, damage: 0, seconds: 7.4, deaths: 0 }, two: { runs: 5, kills: 10, of: 10, damage: 3.6, seconds: 9.1, deaths: 0 } },
  // One death in each set came from a race lost (the skeleton under a
  // cell before its block went in), the next stance forced to be this one.
  low: { one: { runs: 5, kills: 4, of: 5, damage: 0, seconds: 10, deaths: 1 }, two: { runs: 5, kills: 10, of: 10, damage: 0, seconds: 12.2, deaths: 0 } },
  fight: { one: { runs: 5, kills: 5, of: 5, damage: 2.8, seconds: 8.2, deaths: 0 }, two: { runs: 5, kills: 10, of: 10, damage: 5.3, seconds: 10.2, deaths: 0 } },
};
const WAYS = { guard: 'this way', low: 'this way', fight: 'fought as Jev chose its stances before either was offered' };
function measuredSays(kind, count = 1, { also = [] } = {}) {
  const scene = count >= 2 ? 'two' : 'one';
  const row = (k, r) => { const x = MEASURED[k][r]; return `${WAYS[k]}, ${SCENES[r]}, ${x.runs} runs: ${x.kills} of ${x.of} killed, about ${x.damage} damage a run on the median over about ${x.seconds} seconds, ${x.deaths ? `${x.deaths} death${x.deaths === 1 ? '' : 's'}` : 'no deaths'}`; };
  const rows = [kind, ...also].filter(k => MEASURED[k]?.[scene]).map(k => row(k, scene));
  if (!rows.length) return '';
  return ` Measured in the arena with the kit of the death it is built from (full iron, an iron sword, a shield, no pickaxe): ${rows.join('; ')}.`;
}

// The biters the guard answers: those that strike at arm's length, not a
// creeper (struck and backed from), a shooter or a spear holder (whose
// charge shield_the_charge meets).
// A biter the guard faces: in sight, or unseen within five (heard through a
// wall a step off, or round a corner). The option offered the stance over
// these and the guard faced only those within two unseen: mid-242-bb chose
// shield_guard against a piglin 3.3 blocks off out of sight, the guard found
// none to face and ended at once, twenty times in a second, until the spin
// watch set it aside (15:06:19, note 613).
const UNSEEN_WITHIN = 5;
const inGuard = t => !!t && (t.visible || t.distance <= UNSEEN_WITHIN) && guardable(t);
function guardable(t) {
  const e = t?.entity;
  if (!e?.position || e.name === 'creeper') return false;
  const { shooter } = require('./combat');
  if (shooter(e)) return false;
  if (require('./danger').holdsSpear(e)) return false;
  return !!ce.MOBS[e.name] && !ce.MOBS[e.name].shoots;
}

// The shield up facing the biter, the sword swung right after its blow lands
// on the shield or while it is within the sword's reach and out of its own,
// the shield straight back up; nothing walked to. Until `until`, `stop()`, or
// no biter is left within `radius`. -> { swings, blocked, hurt, ended }
async function guard(bot, task, { until, radius = 8, stop = () => false, focus = null } = {}) {
  const { threats } = require('./danger');
  const { canStrike, defenseWeapon, raiseShield, lowerShield, bystanders } = require('./combat');
  const { checkAir } = require('./vitals');
  const swungAt = new Map();
  const onSwing = e => { if (e?.id != null) swungAt.set(e.id, Date.now()); };
  bot.on?.('entitySwingArm', onSwing);
  const weapon = defenseWeapon(bot), kind = weapon?.name.split('_').at(-1);
  const recharge = ce.SWING_MS[kind] || ce.SWING_MS.fist;
  const start = bot.health;
  let swings = 0, ended = 'time';
  try {
    while (Date.now() < until) {
      task.check(); checkAir(bot);
      if (stop()) { ended = 'stopped'; break; }
      const near = threats(bot, radius).filter(inGuard);
      if (!near.length) { ended = 'none left'; break; }
      const me = bot.entity.position;
      // The one to face: a biter at its reach first, else the one chosen
      // against, else the nearest.
      const facing = near.find(t => bladeReaches(t.entity, me)) || near.find(t => t.entity.id === focus) || near[0];
      const ready = Date.now() - (bot._defenseAttackAt || 0) >= recharge;
      const safe = t => !bladeReaches(t.entity, me) || Date.now() - (swungAt.get(t.entity.id) || 0) < AFTER_BLOW_MS;
      // Only while every biter at its reach has just struck: a second one's
      // blow would land in the swing's moment with the shield down.
      const openNow = near.filter(t => bladeReaches(t.entity, me)).every(safe);
      const target = ready && openNow ? near.find(t => canStrike(bot, t.entity) && !bystanders(bot, t.entity).length) : null;
      if (target) {
        lowerShield(bot);
        if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
        await bot.lookAt?.(target.entity.position.offset(0, (target.entity.height || ce.bodyHeight(target.entity.name)) * 0.6, 0), true);
        if (canStrike(bot, target.entity)) {
          bot.attack(target.entity); swings++;
          bot._defenseAttackAt = bot._threatResponseAt = Date.now();
          bot._struck = { id: target.entity.id, at: bot._defenseAttackAt };
        }
        raiseShield(bot);
        continue;
      }
      await bot.lookAt?.(facing.entity.position.offset(0, (facing.entity.height || ce.bodyHeight(facing.entity.name)) * 0.6, 0), true);
      raiseShield(bot);
      await sleep(50);
    }
  } finally { bot.removeListener?.('entitySwingArm', onSwing); }
  return { swings, hurt: Math.round(Math.max(0, start - bot.health) * 10) / 10, ended };
}

module.exports = { WIDEN, BLOW_EVERY, AFTER_BLOW_MS, bladeReaches, tallWalker, attachOrder, lowCeilingPlan, MEASURED, SCENES, measuredSays, guardable, inGuard, UNSEEN_WITHIN, guard };
