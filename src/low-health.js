'use strict';
// A question about the work asked at low health says so, and offers seeing
// to the body first (note 752c).
//
// 25588 (mid-, 14:09:10 to 14:09:28Z) took nine zombie hits in eight
// seconds, 20 to 1.3; at 14:09:21, at 2 health, night_mine_target was asked
// ("Dig to the coal ore 4 blocks off ... 128 coal carried") with no word of
// the health, no way to heal or wall in, and answered ore_32; at 14:09:28
// turn_priority gave the work ("craft (stick)") 0.51 over "Eat cooked beef
// now, about 1.6 seconds" 0.46, the work's option saying only "Health 2.3:
// it does not come back at hunger 17". The same at 14:06 to 14:07 (20 to
// 3.8). A question about the plan does not carry the body unless its
// builder put it there, and none of the work's did.
//
// Low is the arbiter's STANCE_HEALTH (6) or under, or four health and more
// lost to hits in the last 30 seconds (hit-log.js). Then:
//   - says(): the health, how it fell and to what (the hits by source), and
//     what the work given the turn at this health came to in the played
//     record (low-health-record.js);
//   - ways(): eat_first (the best food carried, EAT_SECONDS standing still,
//     hunger to what and whether health then comes back) and wall_in_first
//     (a two-block pocket where the bot stands, its blocks and seconds), each
//     run before the question is asked again (decisions/index.js).
const LOW = 6, FALL_MS = 30000, FALL = 4;
const round = n => Math.round(n * 10) / 10;

// -> { health, fell: { from, seconds, hits } | null } or null when not low.
function lowNow(bot, now = Date.now()) {
  const hp = bot?.health;
  if (!Number.isFinite(hp) || hp <= 0) return null;
  let hits = [];
  try { hits = require('./hit-log').recent(bot, { now, ms: FALL_MS }); } catch (_) { hits = []; }
  const top = Math.max(0, ...hits.map(h => h.health).filter(Number.isFinite));
  const fell = hits.length && top - hp >= FALL ? { from: round(top), seconds: Math.max(1, Math.round((now - hits[0].at) / 1000)), hits: hits.length } : null;
  if (hp > LOW && !fell) return null;
  return { health: round(hp), fell };
}

// The best food carried and what eating it does.
function mealOf(bot) {
  let item = null;
  try { const v = require('./vitals'); item = v.chooseFood(bot) || null; } catch (_) { item = null; }
  if (!item || (bot.food ?? 20) >= 20) return null;
  const points = bot.registry?.foodsByName?.[item.name]?.foodPoints ?? null;
  const after = points ? Math.min(20, (bot.food ?? 20) + points) : null;
  return { item, after };
}

// What walling in keeps off: mobs hitting the bot lately, or mobs about
// that can get to it (not those standing off). With neither, a pocket
// keeps off nothing, and where health does not come back it heals nothing:
// 25598 (16:50:57 to 16:52:35Z) at 1 health, hunger 14 and no food chose
// wall_in_first four times with nothing hitting it (note 752e).
function pocketGains(bot, now = Date.now()) {
  let hits = 0, about = [];
  try { hits = require('./hit-log').recent(bot, { now, ms: FALL_MS }).length; } catch (_) { hits = 0; }
  try { const d = require('./danger'); about = d.threats(bot, 16).filter(t => !d.standsOff(bot, t, now) && (t.visible || t.distance <= 6)); } catch (_) { about = []; }
  return { hits, about: about.length, nearest: about[0] || null };
}
function pocketOf(bot) {
  try {
    const s = require('./survival');
    const feet = bot.entity.position.floored();
    const plan = s.pocketPlan(bot, feet, s.pocketBiters(bot));
    const stock = require('./shelter').materialStock(bot);
    if (!plan || !plan.cells.length || stock < plan.cells.length) return null;
    return { blocks: plan.cells.length, seconds: plan.seconds };
  } catch (_) { return null; }
}

// `health: false` leaves out the health itself, where the option says it
// already (arbiter.js workBodySays).
function says(bot, { now = Date.now(), mobs = null, health = true } = {}) {
  const low = lowNow(bot, now);
  if (!low) return '';
  let hitSays = '';
  try { hitSays = require('./hit-log').says(bot, mobs || require('./danger').threats(bot, 24), { now, ms: FALL_MS }); } catch (_) { hitSays = ''; }
  const heals = (bot.food ?? 0) >= 18;
  const meal = mealOf(bot), gains = pocketGains(bot, now), pocket = !/end$/.test(String(bot.game?.dimension || '')) && (gains.hits || gains.about) ? pocketOf(bot) : null;
  let hitLately = false;
  try { hitLately = require('./hit-log').recent(bot, { now, ms: 20000 }).length > 0; } catch (_) { hitLately = false; }
  const record = require('./low-health-record').says({ hit: hitLately });
  const fell = low.fell ? `, down from ${low.fell.from} in the last ${low.fell.seconds} seconds (${low.fell.hits} hit${low.fell.hits === 1 ? '' : 's'})` : '';
  const ways = [meal ? `eating the ${meal.item.name.replaceAll('_', ' ')}, ${require('./survival').EAT_SECONDS} seconds standing still${meal.after ? `, hunger to ${meal.after}${meal.after >= 18 && !heals ? ', and health comes back from then' : ''}` : ''}` : null,
    pocket ? `walling in where it stands, ${pocket.blocks} block${pocket.blocks === 1 ? '' : 's'}, about ${pocket.seconds} seconds of building` : null].filter(Boolean);
  const lead = health ? `Health ${low.health}${fell}${heals ? '' : `, and it does not come back at hunger ${bot.food}`}.` : fell ? `Health${fell.replace(/^,/, '')}.` : '';
  return `${lead}${hitSays ? ` ${hitSays}` : ''} ${record}${ways.length ? ` The body can be seen to first: ${ways.join('; or ')}.` : ` ${meal ? '' : 'Nothing carried is food, and '}${!(gains.hits || gains.about) ? 'nothing is hitting the bot or about to get to it, so walling in keeps off nothing' : 'no pocket can be walled here with the blocks carried'}.`}${!pocket && meal && !(gains.hits || gains.about) ? ' Nothing is hitting the bot or about to get to it: walling in keeps off nothing.' : ''}`;
}

// The options offered beside a work-side question at low health, each run
// by decide() before the question is asked again. -> { tree, says } or null.
function ways(bot, { task, goal, save = () => {}, now = Date.now() } = {}) {
  if (!lowNow(bot, now)) return null;
  const tree = {}, words = says(bot, { now });
  const meal = mealOf(bot);
  if (meal) tree.eat_first = { description: `Eat the ${meal.item.name.replaceAll('_', ' ')} first, ${require('./survival').EAT_SECONDS} seconds standing still${meal.after ? `, hunger to ${meal.after}` : ''}; this question is asked again after it.`,
    run: async () => {
      const before = { food: bot.food, count: meal.item.count };
      const r = await require('./meal').eatThrough(bot, task, meal.item, { eaten: () => (bot.food ?? 0) > before.food || (bot.inventory.items().find(i => i.name === meal.item.name)?.count ?? 0) < before.count });
      return r.eaten;
    } };
  const gains = pocketGains(bot, now);
  // Not in the End: whether to stay in a pocket or leave it is asked by the
  // survival layer, which has no turn there (the fight owns the dimension),
  // and the dragon's breath pools where the bot is walled. The rehearsal of
  // 2026-10-03 (23:35Z) walled in at this offer beside the fountain and
  // stood in the box through five rehearsals after, no shot and no walk
  // out of it (note 1136).
  const inEnd = /end$/.test(String(bot.game?.dimension || ''));
  const pocket = !inEnd && (gains.hits || gains.about) ? pocketOf(bot) : null, survival = bot._shotSurvival;
  const keepsOff = gains.nearest ? `it keeps off the ${gains.nearest.entity.name.replaceAll('_', ' ')} ${Math.round(gains.nearest.distance)} blocks off${gains.about > 1 ? ` and ${gains.about - 1} more about` : ''}` : `it keeps off whatever landed the ${gains.hits} hit${gains.hits === 1 ? '' : 's'} in the last 30 seconds`;
  const heals = (bot.food ?? 0) >= 18 ? 'health comes back in it at this hunger' : `health does not come back in it at hunger ${bot.food}${mealOf(bot) ? ' until the bot eats' : ' with nothing carried to eat'}`;
  if (pocket && survival?.sealHere) tree.wall_in_first = { description: `Wall in where the bot stands first, ${pocket.blocks} block${pocket.blocks === 1 ? '' : 's'}, about ${pocket.seconds} seconds of building: ${keepsOff}; ${heals}; whether to stay, leave or go on is asked from the pocket.`,
    run: async () => !!(await survival.sealHere(task, goal, save, require('./danger').threats(bot, 16).filter(t => t.visible))) };
  if (!Object.keys(tree).length) return { tree, says: words };
  return { tree, says: words };
}

module.exports = { lowNow, says, ways, mealOf, LOW, FALL, FALL_MS };
