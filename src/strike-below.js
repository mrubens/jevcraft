'use strict';
// A mob standing below the bot's ground, struck from the edge above it.
//
// mid-208-k-nether-4-fortress-1 (25589, note 596) stood twenty minutes at
// 7.9 health, nothing to eat, on a one-wide netherrack ledge at y 46 with a
// hoglin two blocks below on the nylium at (-38.9, 44, 67.9): the hoglin
// never came nearer and never struck, and the fight was chosen 467 times,
// each standing with nothing in the sword's reach (the ledge's own edge
// between the eye and the hoglin) until it was asked again. A player there
// steps to the end of the ledge, a block on, and strikes down: from there
// the sword reaches the hoglin's back, and the hoglin cannot strike back.
//
// The game's rule (26.1.2, Mob.isWithinMeleeAttackRange, note 586): a mob's
// blow lands where its own box, widened sideways by its reach and not at
// all up or down, touches the target. A mob whose top is at or below the
// bot's feet touches nothing of it, whatever its reach. The bot's sword
// lands within three blocks of the eye to the mob's box (canStrike, the
// same test the swing uses).
const { Vec3 } = require('vec3');

// How far along its own level the bot looks for such a stand.
const STAND_STEPS = 2;
const AROUND4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const bodyHeightOf = entity => entity?.height || require('./combat-estimate').bodyHeight(entity?.name);

// The mob's top below these feet: it cannot strike a body standing there.
function belowReach(entity, feetY) {
  return !!entity?.position && entity.position.y + bodyHeightOf(entity) <= feetY + 1e-6;
}

// The cells on the bot's own level it can walk to in a few steps, nearest
// first: the feet open, the head open, a full block under.
function levelCells(bot, feet, steps = STAND_STEPS) {
  const key = c => `${c.x},${c.y},${c.z}`;
  const open = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|water/.test(b.name || ''); };
  const standable = c => open(c) && open(c.offset(0, 1, 0)) && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block';
  const out = [{ cell: feet, steps: 0 }], seen = new Set([key(feet)]);
  for (let i = 0; i < out.length; i++) {
    const { cell, steps: n } = out[i];
    if (n >= steps) continue;
    for (const [dx, dz] of AROUND4) {
      const c = cell.offset(dx, 0, dz);
      if (seen.has(key(c))) continue;
      seen.add(key(c));
      if (standable(c)) out.push({ cell: c, steps: n + 1 });
    }
  }
  return out;
}

// Where on the bot's level the sword reaches this mob while it cannot reach
// the bot: the bot's own cell first, then the fewest steps.
// -> { cell, at, steps, below, eye } or null
function strikeStand(bot, entity, { steps = STAND_STEPS } = {}) {
  if (!entity?.position || entity.isValid === false || typeof bot.blockAt !== 'function' || !bot.entity?.position) return null;
  const { canStrike } = require('./combat');
  const feet = bot.entity.position.floored();
  for (const { cell, steps: n } of levelCells(bot, feet, steps)) {
    if (!belowReach(entity, cell.y)) continue;
    const at = n ? new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5) : bot.entity.position.clone();
    if (!canStrike(bot, entity, { from: at })) continue;
    const top = entity.position.y + bodyHeightOf(entity);
    return { cell, at, steps: n, below: Math.round((cell.y - entity.position.y) * 10) / 10, clearance: Math.round((cell.y - top) * 10) / 10,
      eye: Math.round(at.offset(0, 1.62, 0).distanceTo(entity.position.offset(0, bodyHeightOf(entity) / 2, 0)) * 10) / 10 };
  }
  return null;
}

module.exports = { strikeStand, belowReach, levelCells, STAND_STEPS };
