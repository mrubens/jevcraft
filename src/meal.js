'use strict';
// A meal the bot chose, eaten through the shots (note 701).
//
// 25597 (mid-242-jg, 2026-09-29 23:26:15Z) chose eat at 12.1 health, hunger
// 17, blazes about; hunger stayed 17 and it died 12 seconds later. The shot
// hold (shot-reflex.js) had been on since a behind_cover answer at 23:26:07,
// and a shield_up answer came 34 ms after the eat was chosen. A shield and a
// meal are both a hand's use, and the server keeps one use at a time: the
// hold's raise (use_item, off hand) ended the meal, and its lowering
// (release_use_item) ended whatever was in use, the meal too; the hold's
// own refusal while the main hand is in use lowered the shield it had
// raised, and so ended the meal it was standing aside for. Of the 90 meals
// chosen as a stance in the Nether since 12:00Z, 86 were eaten; the shot
// hold was on in none of the 86 and in 2 of the 3 not eaten with the bot
// alive (scripts/low-health-record.js).
//
// So while a chosen meal is on (bot._meal), nothing raises the shield or
// lowers it by a release (combat.js), and the hold answers no warning; a
// shot already in the air on a line that lands inside the meal, and late
// enough for a raised shield to block it, is the one thing that cuts it
// (shot-reflex.js tick), and the meal is begun again once no shot is on its
// way.
const EAT_MS = 1600;
// The hand's change reaching the server before the eat begins (the golden
// apple's lesson: an eat begun before it ended at once).
const SETTLE_MS = 150;
const RETRY_WAIT_MS = 4000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The meal on now, or null.
function mealOn(bot, now = Date.now()) {
  const m = bot?._meal;
  return m && now <= m.endsAt + 1000 ? m : null;
}
// Cut by the shot reflex: said on the meal, and the eat run begins it again.
function cutMeal(bot, why, now = Date.now()) {
  const m = mealOn(bot, now);
  if (!m || m.cut) return false;
  m.cut = { at: now, why };
  return true;
}

// Eat `item` through: the hand settled, the eat begun, and begun again after
// a cut by a shot (at most `tries` times in all, while `helps()` holds).
// `eaten()` says whether it was eaten (hunger, saturation or the count).
// -> { eaten, tries, cuts: [why] }
async function eatThrough(bot, task, item, { eaten, helps = () => true, tries = 3 } = {}) {
  const cuts = [];
  for (let n = 1; n <= tries; n++) {
    const have = bot.inventory?.items?.().find(i => i.name === item.name);
    if (!have) return { eaten: false, tries: n - 1, cuts, why: `no ${item.name.replaceAll('_', ' ')} left` };
    await bot.equip(have, 'hand');
    for (let k = 0; k < 10 && bot.heldItem?.name !== item.name; k++) { task.check(); await sleep(50); }
    await sleep(SETTLE_MS);
    const meal = bot._meal = { item: item.name, at: Date.now(), endsAt: Date.now() + EAT_MS + 400, cut: null };
    let result;
    try {
      const eating = bot.consume().then(() => 'done', err => (err?.message || 'failed'));
      const cut = (async () => { while (!meal.cut) { await sleep(50); if (Date.now() > meal.endsAt + 2000) return 'timeout'; } return 'cut'; })();
      result = await Promise.race([eating, cut]);
      if (result === 'cut') eating.catch(() => {});
    } finally { if (bot._meal === meal) bot._meal = null; }
    if (eaten()) return { eaten: true, tries: n, cuts };
    if (!meal.cut) return { eaten: false, tries: n, cuts, why: typeof result === 'string' && result !== 'done' ? result : 'cut short' };
    cuts.push(meal.cut.why);
    task.check();
    if (n === tries || !helps()) break;
    // Begun again once no shot is on its way to the bot.
    const until = Date.now() + RETRY_WAIT_MS;
    while (Date.now() < until && require('./shot-reflex').shotComing(bot)) { task.check(); await sleep(50); }
  }
  return { eaten: false, tries, cuts, why: cuts.at(-1) || 'cut short' };
}

// Whether a meal begun now is eaten before a shot from a shooter with a line
// here can land, for the eat option's words (note 701). A blaze shoots only
// at the end of a three-second glow (blaze-stand.js VOLLEY), so one not
// glowing now cannot land inside a meal begun now; one glowing can.
// `lined`: [{ name, distance, inSeconds (to its next shot) }]; `spawner`:
// { from, to, lastAgo } (spawner-clock.js nextTry) or null.
// -> { finishes, says }
const MEAL_FROM_NOW = (EAT_MS + SETTLE_MS + 150) / 1000;
function finishSays(lined, spawner = null, mealSeconds = MEAL_FROM_NOW) {
  const r = n => Math.round(n * 10) / 10, secs = n => `${r(n)} second${r(n) === 1 ? '' : 's'}`;
  const next = spawner ? ` The spawner's next try is ${spawner.to <= 0 ? 'due now' : spawner.from ? `${r(spawner.from)} to ${r(spawner.to)} seconds off` : `within ${r(spawner.to)} seconds`}; a new blaze glows three seconds before it shoots.` : '';
  if (!lined.length) return { finishes: true, says: next };
  const soon = [...lined].sort((a, b) => a.inSeconds - b.inSeconds)[0];
  const who = `the ${soon.name.replaceAll('_', ' ')} ${Math.round(soon.distance)} blocks off`;
  if (soon.inSeconds < mealSeconds) return { finishes: false,
    says: ` Not done before a shot: ${who}, with a line here, shoots in about ${secs(soon.inSeconds)}, inside the ${secs(mealSeconds)} the meal takes from now. A shot on its way raises the shield, which ends the meal; it is begun again once the shots are past.${next}` };
  return { finishes: true, says: ` Done before any shot lands here: the soonest of the ${lined.length === 1 ? 'shooter' : `${lined.length} shooters`} with a line here, ${who}, can shoot in about ${secs(soon.inSeconds)}, after the ${secs(mealSeconds)} the meal takes.${next}` };
}

module.exports = { mealOn, cutMeal, eatThrough, finishSays, MEAL_FROM_NOW, EAT_MS, SETTLE_MS };
