'use strict';
// A shield blocks a fireball, and the dream run never raised one at a blaze.
// The arena put a number on it: two blazes cost thirty-one health for one
// rod, five times the bill for a single blaze, because the bot walked into
// the volleys with its shield down.
//
// The rule is not about blazes. A fireball is an entity with a position and
// a velocity, like an arrow or a wither skull, so the rule is about things
// flying at the bot: face the nearest one and hold the shield while it
// crosses the gap. A shield only covers the way the bot is looking, so the
// look is half the answer.
const { raiseShield, lowerShield } = require('./combat');

const INCOMING = new Set(['small_fireball', 'fireball', 'dragon_fireball', 'arrow', 'spectral_arrow',
  'wither_skull', 'shulker_bullet', 'llama_spit', 'wind_charge', 'breeze_wind_charge']);
const REACH = 20;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const shielded = bot => bot.inventory?.slots?.[45]?.name === 'shield';

// Close and closing. Something that spawned across the room and is flying
// somewhere else does not deserve a stance, and a stance costs movement.
function incoming(bot, { reach = REACH } = {}) {
  const eye = bot.entity.position.offset(0, 1.5, 0);
  return Object.values(bot.entities || {}).filter(entity => {
    if (!INCOMING.has(entity.name) || !entity.position || entity.isValid === false) return false;
    const distance = entity.position.distanceTo(eye);
    if (distance > reach) return false;
    const velocity = entity.velocity;
    // A projectile whose velocity has not arrived yet still counts when it
    // is already in the bot's lap, for its first second in view. After
    // that a still arrow is one stuck in the ground, and it stays a minute:
    // trial 62 held its shield up fifty-five seconds at the misses lying
    // round its feet, and never got to answer the skeleton or the creeper.
    entity._seenAt ||= Date.now();
    if (!velocity || Math.abs(velocity.x) + Math.abs(velocity.y) + Math.abs(velocity.z) < 0.05) return distance < 6 && Date.now() - entity._seenAt < 1000;
    return entity.position.plus(velocity).distanceTo(eye) < distance;
  }).sort((a, b) => a.position.distanceTo(eye) - b.position.distanceTo(eye));
}

// Hold the block until the shot has landed or gone by, then hand movement
// back. Bounded in tens of milliseconds: this runs inside a fight loop.
// Not with a mob at arm's length that does not shoot: the shield covers one
// way, and turning it to an arrow gives the one hitting the bot its back.
// The dream run died that way in a cave (2026-09-24): full iron, a shield,
// its hand empty, turning to the skeleton's arrows every second while two
// zombies beside it took it from twenty to nothing in fifty seconds.
// A creeper's reach is its fuse: one that would walk to lighting distance
// while the shield is held is at arm's length already. mid-226-b faced a
// skeleton's arrows for three quarters of a second, two hundred times over,
// with a creeper four blocks off and a dance chosen to meet it, and the
// blast took seven health through iron; a second creeper took the rest
// (2026-09-26).
const MELEE_REACH = 3.5;
function meleeClose(bot, { holdMs = 700 } = {}) {
  try {
    const { threats } = require('./danger');
    const { shooter } = require('./combat');
    const { APPROACH, LIGHTS_AT } = require('./combat-estimate');
    const creeperReach = LIGHTS_AT + APPROACH * holdMs / 1000;
    return threats(bot, Math.max(MELEE_REACH, creeperReach) + 1).some(t =>
      (t.distance <= MELEE_REACH && !shooter(t.entity)) || (t.entity.name === 'creeper' && t.distance <= creeperReach));
  } catch (_) { return false; }
}

// Nor on a one-wide span over a drop (terrain.js onSpan): the turn to the
// shot is a turn on the span, and the crossing's step walks the way it
// faces (note 273).
async function deflect(bot, task, { holdMs = 700 } = {}) {
  if (!shielded(bot) || meleeClose(bot, { holdMs }) || require('./terrain').onSpan(bot)) return false;
  const shot = incoming(bot)[0];
  if (!shot) return false;
  const deadline = Date.now() + holdMs;
  bot.pathfinder?.setGoal?.(null);
  bot.clearControlStates?.();
  try {
    await bot.lookAt(shot.position, true);
    task.check();
    raiseShield(bot);
    while (Date.now() < deadline) {
      task.check();
      if (!incoming(bot, { reach: 12 }).length) break;
      await sleep(50);
    }
  } finally { lowerShield(bot); }
  return true;
}

module.exports = { deflect, incoming, meleeClose, INCOMING, REACH };
