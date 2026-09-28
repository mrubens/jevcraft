'use strict';
// Eyes off endermen's heads. An enderman turns on a player who looks at
// its head, from as far as sixty-four blocks (26.1.2 EnderMan
// isBeingStaredBy: the look's unit vector against the one from the
// player's eyes to the enderman's, 2.55 up its 2.9, closer than
// 1 - 0.025 / distance, with a line of sight and no carved pumpkin worn).
// That is a cone about six degrees across at four blocks and under three
// at twenty. The pathfinder walks with its gaze level: walking straight
// toward one at twenty blocks is in it. In the End, where they stand in
// dozens, one provoked that way fought the rehearsal bot off its feet at
// the pillars.
//
// mid-242-ac-nether-3 (note 578) was laying a span crouched, each step
// looking at eye height over the next cell: from a crouch's 1.27 that is
// about fourteen degrees up, and an enderman standing on the span's line
// four blocks ahead had its eyes in that line. It was on the bot in half a
// second, 20 to none in seven. Only a level gaze was lowered then.
//
// Now any look is checked against every enderman in range: while the
// bot walks with a level gaze near one it looks at the ground ahead, as
// before, and whatever the look (a step's, a block placed, a dig, a
// swing), one that would fall in the cone round an enderman's eyes is
// turned just below them, or above where below will not do. The server
// takes a block placed, a dig or a swing by where they are aimed, not by
// the look, so turning it costs them nothing. The listener runs after the
// pathfinder's and the moves' on the same tick, before the look is sent.
const DOWN = -0.5; // radians: about thirty degrees below the horizon
const LEVEL = 0.05;
const RANGE = 64;
const EYE = 2.55; // an enderman's eyes above its feet
// The game's cone is 0.025 over the distance; four times it keeps the
// look clear of it between ticks and against a small error in where the
// enderman is read.
const STARE = 0.025, MARGIN = 4;

const endermen = bot => {
  const here = bot.entity?.position;
  if (!here) return [];
  return Object.values(bot.entities || {}).filter(e => e.name === 'enderman' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) <= RANGE);
};
// Any enderman, screaming or not: one that screams may be angry at the
// dragon, and a glance makes it the bot's.
const endermanInView = bot => endermen(bot).length > 0;

// Whether this tick's gaze should be lowered: moving forward with a level
// gaze, near one. Not only the pathfinder: the dragon dodge presses the
// keys itself with its eyes on the destination, and that is when the
// second rehearsal enderman turned.
function lowerGaze(bot) {
  if (!bot.entity || Math.abs(bot.entity.pitch || 0) > LEVEL) return false;
  if (!bot.controlState?.forward) return false;
  return endermanInView(bot);
}

// The player's eyes: 1.62 up standing, 1.27 crouched.
const eyeOf = bot => bot.entity.position.offset(0, bot.controlState?.sneak ? 1.27 : 1.62, 0);
// mineflayer's look: yaw 0 faces north (-z), turning toward west (-x);
// pitch up is positive.
const lookVector = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
// Whether a look with this yaw and pitch is on this enderman's eyes, by
// the game's test widened `margin` times.
function staresAt(bot, e, yaw, pitch, margin = 1) {
  const eye = eyeOf(bot);
  const to = { x: e.position.x - eye.x, y: e.position.y + EYE - eye.y, z: e.position.z - eye.z };
  const d = Math.hypot(to.x, to.y, to.z);
  if (d < 0.01) return true;
  const v = lookVector(yaw, pitch);
  return (v.x * to.x + v.y * to.y + v.z * to.z) / d > 1 - STARE * margin / d;
}
// The endermen a look is on, by the game's own test (margin 1) or the
// widened one.
const staredAt = (bot, yaw = bot.entity.yaw, pitch = bot.entity.pitch, margin = MARGIN) =>
  endermen(bot).filter(e => staresAt(bot, e, yaw, pitch, margin));

// A pitch that keeps this yaw and is on no enderman's eyes: just below the
// eyes of the one it is on (its body, which provokes nothing), else just
// above, else the ground ahead, else straight down or up; the nearest of
// these to the look as it was.
function awayPitch(bot, yaw = bot.entity.yaw, pitch = bot.entity.pitch) {
  const on = staredAt(bot, yaw, pitch);
  if (!on.length) return null;
  const eye = eyeOf(bot), options = [];
  for (const e of on) {
    const dx = e.position.x - eye.x, dz = e.position.z - eye.z, dy = e.position.y + EYE - eye.y;
    const d = Math.hypot(dx, dy, dz), at = Math.atan2(dy, Math.hypot(dx, dz));
    const cone = Math.acos(Math.max(-1, 1 - STARE * MARGIN / Math.max(d, 0.01))) + 0.02;
    options.push(at - cone, at + cone);
  }
  options.push(DOWN, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  const clear = options.filter(p => p >= -Math.PI / 2 && p <= Math.PI / 2 && !staredAt(bot, yaw, p).length)
    .sort((a, b) => Math.abs(a - pitch) - Math.abs(b - pitch));
  return clear.length ? clear[0] : null;
}

function gazePlugin(bot) {
  const tick = () => {
    if (lowerGaze(bot)) bot.entity.pitch = DOWN;
    const away = awayPitch(bot);
    if (away != null) bot.entity.pitch = away;
  };
  // After the pathfinder's own physicsTick listener, which sets the level
  // gaze on the same tick.
  bot.once('spawn', () => bot.on('physicsTick', tick));
}

module.exports = { gazePlugin, lowerGaze, endermanInView, staresAt, staredAt, awayPitch, DOWN, EYE };
