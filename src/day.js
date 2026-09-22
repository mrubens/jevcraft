'use strict';
// The Overworld clock, in one place. The same numbers were written out in
// five files, and "night" meant 9500 in one, 11500 in another and 12000 in a
// third. They are not one threshold: each is a different moment, and the
// names below say which. A change to when the bot stops work for the
// evening is now one edit, and cannot leave another file's idea of night
// behind.
const DAY = Object.freeze({
  // Work, idle chores and dream launches stop; shelter and the bed become
  // the business of the evening.
  DUSK: 9500,
  // The walk home to the base's bed starts: early when it is far.
  WALK_HOME_FAR: 10000,
  WALK_HOME: 11000,
  // What Jev is told night is, and when a sealed pocket counts as a night's.
  NIGHT: 11500,
  // Dark enough for hostiles to spawn on the surface: spiders turn, and the
  // bow rung's string is out there.
  DARK: 12000,
  // A bed can be slept in.
  SLEEP_FROM: 12541,
  SLEEP_UNTIL: 23458,
  // Morning.
  DAWN: 23000,
});

const time = bot => bot.time?.timeOfDay;
const between = (t, from, until) => Number.isFinite(t) && t >= from && t < until;
const dusk = bot => between(time(bot), DAY.DUSK, DAY.DAWN);
const night = bot => between(time(bot), DAY.NIGHT, DAY.DAWN);
const dark = bot => between(time(bot), DAY.DARK, DAY.DAWN);

module.exports = { DAY, dusk, night, dark };
