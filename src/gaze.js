'use strict';
// Eyes down near endermen. An enderman turns on a player who looks at its
// head, from as far as sixty-four blocks, and the pathfinder walks with its
// gaze level: walking straight toward one at twenty blocks is a look within
// three degrees of its eyes, which is enough. In the End, where they stand
// in dozens, one provoked that way fought the rehearsal bot off its feet
// at the pillars.
//
// While the bot walks with a level gaze and an unprovoked enderman is in
// view, it looks at the ground ahead instead. The listener runs
// after the pathfinder's on the same tick, before the look is sent; any
// deliberate look (aiming, digging, placing) is left alone, since only a
// level gaze is lowered.
const DOWN = -0.5; // radians: about thirty degrees below the horizon
const LEVEL = 0.05;
const RANGE = 64;

function endermanInView(bot) {
  const here = bot.entity?.position;
  if (!here) return false;
  const creepy = bot.registry?.entitiesByName?.enderman?.metadataKeys?.indexOf('creepy');
  return Object.values(bot.entities || {}).some(e => e.name === 'enderman' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) <= RANGE && !(creepy >= 0 && e.metadata?.[creepy]));
}

// Whether this tick's gaze should be lowered: moving forward with a level
// gaze, near one. Not only the pathfinder: the dragon dodge presses the
// keys itself with its eyes on the destination, and that is when the
// second rehearsal enderman turned.
function lowerGaze(bot) {
  if (!bot.entity || Math.abs(bot.entity.pitch || 0) > LEVEL) return false;
  if (!bot.controlState?.forward) return false;
  return endermanInView(bot);
}

function gazePlugin(bot) {
  const tick = () => { if (lowerGaze(bot)) bot.entity.pitch = DOWN; };
  // After the pathfinder's own physicsTick listener, which sets the level
  // gaze on the same tick.
  bot.once('spawn', () => bot.on('physicsTick', tick));
}

module.exports = { gazePlugin, lowerGaze, endermanInView, DOWN };
