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

// A drowned's thrown trident too: mid-243-i, in full iron with a shield,
// stood and took four of them, 4.5 a throw, twenty health to none, the
// shield never raised (2026-09-27).
const INCOMING = new Set(['small_fireball', 'fireball', 'dragon_fireball', 'arrow', 'spectral_arrow', 'trident',
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
    // The velocity the server sent (shot-reflex.js watchShots): mineflayer's
    // own is divided by 8000 as the older protocol wanted, and read so every
    // shot stood still (note 676).
    const velocity = bot._shots?.get?.(entity.id)?.v || entity.velocity;
    // A projectile whose velocity has not arrived yet still counts when it
    // is already in the bot's lap, for its first second in view. After
    // that a still arrow is one stuck in the ground, and it stays a minute:
    // trial 62 held its shield up fifty-five seconds at the misses lying
    // round its feet, and never got to answer the skeleton or the creeper.
    entity._seenAt ||= Date.now();
    // A shot whose velocity has not arrived is judged by where it has moved
    // since it was last looked at: mid-202-k saw a blaze's fireball eight
    // blocks off and was struck 1.3 seconds later with no shield raised
    // between (note 382, 2026-09-27); at eight blocks a still-looking shot
    // was waited on until it came within six.
    const moved = entity._guardSeen && !entity._guardSeen.position.equals(entity.position) ? entity.position.minus(entity._guardSeen.position) : null;
    entity._guardSeen = { position: entity.position.clone(), at: Date.now() };
    if (!velocity || Math.abs(velocity.x) + Math.abs(velocity.y) + Math.abs(velocity.z) < 0.05) {
      if (moved) return entity.position.plus(moved).distanceTo(eye) < distance;
      return distance < 6 && Date.now() - entity._seenAt < 1000;
    }
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

// On a one-wide span over a drop (terrain.js onSpan) too, crouched: with
// every key up the turn walks nowhere (note 273 was forward held through a
// turn), and there an arrow's knockback is the fall. mid-243-e, walking off
// a forty-block edge from a skeleton, was hit and knocked over it with its
// shield in hand (2026-09-27).
async function deflect(bot, task, { holdMs = 700 } = {}) {
  if (!shielded(bot) || meleeClose(bot, { holdMs })) return false;
  const shot = incoming(bot)[0];
  if (!shot) return false;
  // Answered otherwise at its shooter's warning (shot-reflex.js
  // shot_answer): out of its line, struck first or taken, as Jev chose.
  const reflex = require('./shot-reflex'), fired = bot._shots?.get?.(shot.id);
  if (fired && reflex.answeredOtherwise(bot, fired.owner)) return false;
  const deadline = Date.now() + holdMs;
  bot.pathfinder?.setGoal?.(null);
  bot.clearControlStates?.();
  if (require('./terrain').onSpan(bot)) bot.setControlState?.('sneak', true);
  try {
    await bot.lookAt(shot.position, true);
    task.check();
    raiseShield(bot);
    // Held while what it rose for is still coming, at the reach it rose
    // for: held only while a shot was within twelve, a trident fifteen off
    // raised and dropped it at once, a hundred times a second, and mid-244-m
    // blocked nothing; two tridents took it from 8.9 (2026-09-27).
    while (Date.now() < deadline) {
      task.check();
      if (!incoming(bot).length) break;
      await sleep(50);
    }
  } finally { lowerShield(bot); }
  return true;
}

module.exports = { deflect, incoming, meleeClose, INCOMING, REACH };
