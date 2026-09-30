'use strict';
// Should this visit to a fortress happen now (note 638).
//
// Note 631 measured what moves a blaze fight's outcome: the health and the
// hunger it BEGINS at (over 16 health, 14% died and 12% brought a rod; 8 to
// 16, 24% and 6%; under 8, 58% and none; hunger under 18, 24% and 6%). The
// fortress questions had twelve ways in and none of them was "not yet":
// fortress_approach asked how, never whether, and leave_nether was asked
// only when the hunt was short of fitness. Here the visit itself is asked,
// with the bot's state, the played record's rows for it, and what can change
// the row first: eating what is carried, going back for food, a hoglin, or
// another fortress. Every option is a real route with its price; nothing is
// refused for health (physical safety keeps its own rules).
//
// Asked once per visit and held: until the bot dies, its hunger falls two
// points, or its time is out (five minutes for going in, two for the rest).
// A wait ends when health is full; the visit then goes on as chosen.
const { says: recordSays, rowSays, bandOf, HUNGER, DAY } = require('./blaze-record');

const round = n => Math.round(n * 10) / 10;
const words = s => String(s).replaceAll('_', ' ');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const HOLD_MS = { go_in: 5 * 60000, heal_first: 3 * 60000, go_back: 2 * 60000, hoglin_hunt: 3 * 60000, leave_fortress: 60000 };
const HUNGER_DROP = 2;
const HURT_DROP = 6;

// The pillar stance against hoglins (note 626, flight records of 2026-09-28):
// asked within a second counted once.
const PILLAR = { day: '2026-09-28', stances: 168, lost: 0.1, said: 0.4, deaths: 2, shield: { stances: 16, lost: 1.8, said: 2.1, deaths: 3 } };

const deathsOf = goal => (goal?.survival?.deaths || []).length;
const dimensionOf = bot => /nether/.test(String(bot.game?.dimension || '')) ? 'nether' : /end/.test(String(bot.game?.dimension || '')) ? 'end' : 'overworld';

// What the bot can do about health and hunger where it stands: the food
// carried and what it brings hunger to, whether health comes back at all
// (hunger 18 or more, after eating), and how long the wait is.
function fitness(bot) {
  const health = bot.health ?? 20, hunger = bot.food ?? 20;
  let carried = [];
  try { carried = require('./healing').foodCarried(bot); } catch (_) { carried = []; }
  const points = carried.reduce((n, f) => n + f.count * f.points, 0);
  const eatenTo = Math.min(20, hunger + points);
  const healable = hunger >= 18 || eatenTo >= 18;
  const fast = eatenTo >= 20 && (hunger >= 20 ? (bot.foodSaturation ?? 0) > 0 : true);
  const items = carried.reduce((n, f) => n + f.count, 0);
  const seconds = health >= 20 ? 0 : healable ? round((20 - health) * (fast ? 0.5 : 4) + (hunger < 20 ? Math.min(items, 4) * 1.6 : 0)) : null;
  return { health, hunger, carried, points, eatenTo, healable, seconds, items };
}

// The mobs about: blazes in sight within 48, for the guard on waiting.
function blazesInSight(bot) {
  const here = bot.entity?.position;
  if (!here) return 0;
  try { return require('./danger').threats(bot, 48).filter(t => t.entity.name === 'blaze' && t.visible).length; } catch (_) { return 0; }
}
const hostileNear = (bot, radius = 24) => { try { return require('./danger').threats(bot, radius).filter(t => t.visible); } catch (_) { return []; } };

// What the goal wants in rods, one number (eye-need.js), against what is carried.
const eyeSays = (bot, goal) => require('./eye-need').says(bot, goal);

// Food before the fight, from food-facts.js (note 664): hunger and whether health
// comes back, what is carried and the minutes of fighting it holds, what fights
// begun with and without food came to, and each way to more with its price.
const foodFacts = (bot, goal) => {
  const ff = require('./food-facts');
  return ff.beforeSays(bot, goal, { trip: dimensionOf(bot) === 'nether' ? ff.tripSays(bot, goal) : '' });
};
// The food line an option says of itself: the hunger clock and the fact that
// health comes back only at 18 or more.
const foodLine = bot => `Food: ${require('./food-facts').clockSays(bot)} Health comes back only at hunger 18 or more.`;

// The state the question is asked with.
function facts(bot, goal, ctx = {}) {
  const f = fitness(bot);
  const worn = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  let weapon = null; try { weapon = require('./combat').defenseWeapon(bot)?.name || null; } catch (_) { /* none */ }
  let need = null; try { need = require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { /* not a rod hunt */ }
  const state = {
    visit: ctx.fortress ? `about to approach a Nether fortress ${ctx.fortress.distance} blocks off${ctx.fortress.height ? ` and ${Math.abs(ctx.fortress.height)} ${ctx.fortress.height > 0 ? 'up' : 'down'}` : ''}, for blaze rods` : 'about to go at blazes heard or seen out of sight, for blaze rods',
    health: round(f.health), hunger: f.hunger,
    food: f.carried.length ? f.carried.map(c => c.says) : 'nothing to eat carried',
    healthComesBack: f.health >= 20 ? 'health is full' : f.healable ? `yes: ${f.hunger >= 18 ? `at hunger ${f.hunger}` : `once what is carried is eaten (hunger ${f.eatenTo})`}, about ${f.seconds} seconds to full` : `no: at hunger ${f.hunger}${f.points ? `, and eating all that is carried brings it only to ${f.eatenTo}` : ' with nothing to eat'}, under eighteen, none of it comes back`,
    worn: worn.length ? worn.map(words) : 'no armor', weapon: weapon ? words(weapon) : 'no sword or axe', shield: bot.inventory?.slots?.[45]?.name === 'shield',
    ...(need != null ? { rodsStillNeeded: need, rodsTheGoalWants: eyeSays(bot, goal) } : {}),
    blazesInSightNow: blazesInSight(bot),
    fireResistance: require('./fire-resistance').says(bot),
    foodBeforeTheFight: foodFacts(bot, goal),
    playedRecord: recordSays(bot),
    // The blazes' count at a spawner and what fights of each count came to (note 665).
    blazeCounts: require('./blaze-record').entryFacts(bot, {}).says,
    aboutTheRecord: `The record of the trials of ${DAY} (note 631, counted again in note 661). The health rows and the hunger rows were counted separately: there is no row for both. Each is what happened to bots that began a fight there, not what getting to a better row first would do; a bot that began healthy may differ in other ways.`,
  };
  return { state, f };
}

// What a row is worth said beside the row the bot is in, for the options
// that would change it.
function rowThen(health, food, now) {
  const to = bandOf(health), from = bandOf(now.health);
  const hungerNow = now.hunger < 18 ? HUNGER.hungry : HUNGER.fed, hungerTo = food < 18 ? HUNGER.hungry : HUNGER.fed;
  const parts = [];
  if (to !== from) parts.push(`the health row moves from ${from.said} (${from.diedPct}% died, ${from.rodPct}% brought a rod) to ${to.said} (${to.diedPct}% died, ${to.rodPct}% brought a rod)`);
  if (hungerTo !== hungerNow) parts.push(`the hunger row moves from ${now.hunger < 18 ? 'under 18' : '18 or more'} (${hungerNow.diedPct}% died, ${hungerNow.rodPct}% brought a rod) to ${food < 18 ? 'under 18' : '18 or more'} (${hungerTo.diedPct}% died, ${hungerTo.rodPct}% brought a rod)`);
  return parts.length ? `Then ${parts.join(', and ')}: fights begun in that row, not a trial of waiting.` : 'Then the row the bot is in does not change.';
}

// The options, each priced. `ctx.leave` is the way to leave the fortress in
// view (only on an approach); `actions` carries returnOverworld and
// navigate, as the hunt has them.
function options(bot, task, goal, save, actions, ctx = {}) {
  const { f } = facts(bot, goal, ctx);
  const nether = dimensionOf(bot) === 'nether';
  const tree = {};
  const row = rowSays(f.health, f.hunger);
  tree.go_in = { description: `Go in now, at health ${round(f.health)} and hunger ${f.hunger}${f.carried.length ? ` with ${f.carried.map(c => c.says).join('; ')} carried` : ' with nothing to eat'}: ${ctx.fortress ? 'the way in is asked next (fortress_approach), and each blaze fight after it as it comes' : 'the fights are asked as they come'}. What the bot's own fights with blazes came to, ${row}. That is the record of fights begun in that row (two days of trials), not a forecast for this fortress. ${f.health < 20 ? (f.healable ? `Health does come back on the way (${f.hunger >= 18 ? `hunger ${f.hunger}` : 'after eating'}), at about a point each four seconds, half a second with saturation at full hunger.` : `Health does not come back: hunger ${f.hunger} is under eighteen and ${f.points ? `eating all that is carried brings it only to ${f.eatenTo}` : 'nothing carried is food'}, so every point lost in the fight stays lost.`) : ''} ${foodLine(bot)}`.replace(/\s+$/, '') };

  // Eat what is carried and wait here: where it is possible.
  const canFeed = f.hunger < 18 && f.points > 0;
  if ((f.health < 20 && f.healable) || canFeed) {
    const after = f.healable ? 20 : f.health;
    tree.heal_first = { description: `Do not go in yet: ${f.items && f.hunger < 20 ? `eat what is carried (${f.carried.map(c => c.says).join('; ')}), which brings hunger to ${f.eatenTo}, and ` : ''}${f.healable && f.health < 20 ? `wait where the bot stands until the health is full: from ${round(f.health)}, about ${f.seconds} seconds (${f.eatenTo >= 20 ? 'a point each half second while saturation lasts, then each four seconds' : 'a point each four seconds at hunger 18 or 19'}); standing still spends no hunger; at most three minutes, then the visit is asked again` : `then the visit is asked again: ${f.healable ? `health is full, so this raises hunger to ${f.eatenTo}, where health comes back after a hit, and heals nothing now` : `health does not come back at hunger ${f.eatenTo}, under eighteen, so this raises hunger and not health`}`}. ` +
      `${rowThen(after, f.eatenTo, { health: f.health, hunger: f.hunger })} Nothing here gets the bot a rod; it is the time the wait costs. A mob that comes meanwhile is met as it always is, and ends the wait. What it heals to holds only while hunger stays at 18 or more: ${require('./food-facts').clockSays(bot)}` };
  }

  // Back for food. Offered where health cannot come back here, and where the food carried is short of the
  // stay's own count (nether-food.js stayFacts, the crossing kit's measure), which said out
  // loud is the price: 22 fights began with nothing to eat at hunger 18 or more, and
  // fights begun with nothing to eat at hunger under 18 ended in a death 47% of the time.
  let stay = null; try { stay = require('./nether-food').stayFacts(bot); } catch (_) { stay = null; }
  let tripClosed = null; try { tripClosed = nether ? require('./mob-hunt').tripHomeClosed(bot, goal) : null; } catch (_) { tripClosed = null; }
  if (nether && actions?.returnOverworld && (!f.healable || stay?.short > 0) && !tripClosed) {
    let trip = ''; try { trip = require('./game-progress').portalTrip(bot, goal).trim(); } catch (_) { trip = 'the way back to a portal is not known'; }
    let there = ''; try { there = require('./healing').overworldFoodSays(bot, goal) || ''; } catch (_) { /* unknown */ }
    tree.go_back = { description: `Go back through the portal to the Overworld for food, hunted and cooked there, and come back fed. ${trip}${there ? ` ${there}` : ''} The measured pace is part of the price: the walk back is minutes, not seconds, and of the walks back that began over 60 blocks in the Nether that day most were given up or ended in a death (note 626). ${rowThen(20, 20, { health: f.health, hunger: f.hunger })} It gains no rod while it lasts. ${require('./food-facts').overworldWays(bot)} ${f.healable ? '' : `${require('./food-facts').regenSays(bot)} `}${require('./food-facts').recordSays(bot)}`,
      run: async () => {
        goal.leaveNether = { reason: 'food', pick: 'go_back', until: 0, at: Date.now() };
        goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
        await actions.returnOverworld(bot, task, goal, save);
      } };
  }

  // The ways to food from here (nether-food.js restockFoodOption: a hoglin, a stew, cooking the raw
  // meat carried, a bastion's chests, the trip home), asked as their own question where the food
  // carried is under eight points or health is hurt at a hunger where it does not come back.
  if (nether) {
    try {
      const r = require('./nether-food').restockFoodOption(bot, task, goal, save, { actions: actions || {}, client: actions?.client || task?.opportunityClient });
      if (r) tree.get_food_here = { description: r.description, run: r.run };
    } catch (_) { /* no route from here */ }
  }

  // A hoglin for its meat: where hunger is under eighteen in the Nether.
  if (nether && f.hunger < 18 && goal.survival) {
    let known = null; try { known = require('./nether-travel').hoglinsKnown(bot, goal); } catch (_) { known = null; }
    if (known && (known.inView.length || known.seen.length)) {
      let says = ''; try { says = require('./nether-travel').hoglinSays(bot, known); } catch (_) { says = 'Hunt a hoglin for its meat.'; }
      const p = PILLAR;
      tree.hoglin_hunt = { description: `${says} Two facts, both from ${p.day}'s trials: the pillar stance against a hoglin (two blocks up, where its blow does not reach) lost ${p.lost} health on average over ${p.stances} stances, against ${p.said} said, with ${p.deaths} deaths inside fifteen seconds, where the ${p.shield.stances} shield-guard stances lost ${p.shield.lost}; and the hunts that went for a hoglin for its meat brought none in 66 begun in the Nether. This hunt goes at the hoglin on foot: it does not stand on a pillar, so the pillar figure is for a hoglin that comes to a bot already up there. ${rowThen(20, Math.min(20, f.hunger + 9), { health: f.health, hunger: f.hunger })} (a hoglin's two to four raw porkchops, three hunger each).`,
        run: async () => {
          if (!known.inView.length && actions?.navigate) await require('./sightings').walkToSighting(bot, task, goal, save, 'hoglin', known.seen[0], actions.navigate);
          // The hunt as survival.foodHunt sets it (two minutes, six health).
          goal.survival.nightPlan = { plan: 'hunt', kind: 'hoglin', food: true, until: Date.now() + 120000, startHealth: bot.health };
          save();
        } };
    }
  }

  // Fire resistance (note 656): drunk before going in where a potion is
  // carried, or bartered for where gold and a piglin are at hand.
  Object.assign(tree, fireOptions(bot, task, goal, save, actions, ctx));

  // Another fortress: where the one in view can be left.
  if (ctx.leave) {
    tree.leave_fortress = { description: `Leave this fortress for ten minutes and search for another one (${ctx.fortress ? `this one is ${ctx.fortress.distance} blocks off` : 'the fortress in view'}). It changes nothing about health or hunger (health ${round(f.health)}, hunger ${f.hunger}: ${f.healable || f.health >= 20 ? 'as they stand' : 'nothing comes back on the way'}) and the next fortress begins this question again from the same row unless something on the way changes it. It gains no rod, and the search is the minutes the trials' fortress searches took.`,
      run: async () => { ctx.leave(); } };
  }
  return tree;
}

// The walk to the fortress in view at a walk's pace, for what the
// effect's minutes cover.
const WALK_PER_SECOND = 4.3;
// The fire resistance options: each a real route from here, priced with
// the potion's minutes against the walk ahead and the barter's odds from the
// game's table (fire-resistance.js). Offered while the effect is not on for
// a minute more.
const FIRE_OFFER_BELOW = 60;
function fireOptions(bot, task, goal, save, actions = {}, ctx = {}) {
  const fr = require('./fire-resistance'), out = {};
  const left = fr.left(bot);
  if (left >= FIRE_OFFER_BELOW) return out;
  const walk = ctx.fortress ? Math.round(Math.hypot(ctx.fortress.distance || 0, ctx.fortress.height || 0) / WALK_PER_SECOND) : 0;
  const ahead = ctx.fortress ? `the fortress is about ${walk} seconds' walk off at a walk's pace (more with climbing and a way to find), and the effect runs down on the way` : 'the blazes are close: the fight begins within seconds';
  const have = fr.carried(bot);
  if (have.length) {
    const p = have[0], count = have.reduce((n, x) => n + (x.item.count || 1), 0);
    out.drink_fire_resistance = { description: `${p.kind === 'drink' ? 'Drink' : 'Throw at the feet'} ${fr.kindSays(p)} now, then go in (the way in and each fight asked as they come): ${fr.clock(p.seconds)} of fire resistance from now; ${ahead}. ${fr.WHAT} ${count} fire resistance potion${count === 1 ? '' : 's'} carried; one used here is not there for a later fight or a fall into lava.${left > 0 ? ` About ${Math.round(left)} seconds of it are on the body now; drinking sets it to the potion's length, it does not add.` : ''}`,
      run: async () => {
        goal.step = { action: 'drink_fire_resistance', kind: p.kind, before: 'fortress_visit' }; save();
        return fr.drink(bot, task, p);
      } };
    return out;
  }
  const nether = dimensionOf(bot) === 'nether';
  const b = require('./bartering');
  let ready = false; try { ready = nether && b.barterReady(bot, goal) && (b.dressed(bot) || !!actions.acquireStep); } catch (_) { ready = false; }
  if (ready) {
    const gold = b.barterGold(bot);
    const odds = fr.barterOdds(gold.throwable);
    out.barter_fire_resistance = { description: `Before going in, barter with the piglins about for a fire resistance potion: ${fr.barterSays(gold.throwable)} ${gold.dressed ? 'A gold piece is worn or carried, as a barter needs.' : 'Golden boots are made from four ingots first and worn, or the piglins turn on the bot.'} Three piglins a round, each admiring its ingot about eight seconds, so about ${Math.ceil(Math.min(gold.throwable, odds.expectedIngots) / 3) * 10} seconds for the throws an average potion takes, and it stops at the first potion, when the gold is gone, or when no piglin is in view; the gold thrown is gone either way (the pearls it brings kept). Then this visit is asked again, with what was bartered. It gains no rod meanwhile. ${fr.clock(fr.POTIONS[11].seconds)} of fire resistance a potion, running from when it is drunk.`,
      run: async () => {
        const r = await b.barterForFireResistance(bot, task, goal, save, actions);
        goal.step = { action: 'barter_fire_resistance_done', thrown: r.thrown, firePotions: r.firePotions, pearls: r.pearls, why: r.why }; save();
        return r.firePotions > 0;
      } };
  }
  return out;
}

// Whether the held answer still stands: no death since, hunger not two
// down, not hurt six (with no blaze in sight: a fight going on is the
// stance's), and its time not out.
function stands(bot, goal, now = Date.now()) {
  const h = goal.fortressVisit;
  if (!h) return null;
  if (h.deaths !== deathsOf(goal)) return null;
  if (now - h.at > (HOLD_MS[h.pick] || 60000)) return null;
  if (h.food - (bot.food ?? 20) >= HUNGER_DROP) return null;
  if (h.pick === 'go_in' && h.health - (bot.health ?? 20) >= HURT_DROP && !blazesInSight(bot)) return null;
  return h;
}

// A held answer that is neither going in nor the heal's wait: carried out
// when chosen, it keeps the hunt's visit from doing anything until it lapses
// (note 708). -> the hold, or null
function holdsOff(bot, goal, now = Date.now()) {
  const h = stands(bot, goal, now);
  return h && h.pick !== 'go_in' && h.pick !== 'heal_first' ? h : null;
}

// The wait: one step of it. Eat what is carried while hunger is under 20
// (health comes back at 18 or more), otherwise let a second pass. Ends
// with health full (the visit then goes on), or when mobs come.
async function rest(bot, task, goal, save) {
  const f = fitness(bot);
  const eatable = f.items > 0 && f.hunger < 20 && (f.health < 20 || f.hunger < 18), waitable = f.health < 20 && f.hunger >= 18;
  const done = !eatable && !waitable;
  if (done || hostileNear(bot, 24).length) {
    goal.fortressVisit = { pick: 'go_in', at: Date.now(), health: bot.health ?? 20, food: bot.food ?? 20, deaths: deathsOf(goal), after: done ? 'waited' : 'mobs came' };
    save(); return false;
  }
  goal.step = { action: 'recover_before_visit', health: bot.health, food: bot.food }; save();
  if (f.hunger < 20 && f.items) {
    const { chooseFood } = require('./vitals');
    const food = chooseFood(bot);
    if (food) {
      const before = bot.food;
      try { await bot.equip(food, 'hand'); await bot.consume(); } catch (err) { task.check(); }
      if (bot.food <= before) await sleep(300);
      return true;
    }
  }
  await sleep(1000); task.check();
  return true;
}

// Ask (or read the held answer). -> 'go_in' when the visit goes on as
// asked, 'acted' when the pick was carried out or is waiting (the caller
// returns), null when the question went stale (the caller returns and the
// loop asks again).
async function ask(bot, task, goal, save, actions = {}, ctx = {}, now = Date.now()) {
  const client = actions.client || task.opportunityClient;
  if (!client || process.env.JEV_FORTRESS_VISIT === '0') return 'go_in';
  const h = stands(bot, goal, now);
  if (goal.fortressVisit && !h) { delete goal.fortressVisit; save(); }
  if (h) {
    if (h.pick === 'go_in') return 'go_in';
    if (h.pick === 'heal_first') return (await rest(bot, task, goal, save)) ? 'acted' : 'go_in';
    // Carried out when it was chosen: held, nothing is done now (note 708).
    return 'held';
  }
  const { state } = facts(bot, goal, ctx);
  const tree = options(bot, task, goal, save, actions, ctx);
  const decision = await require('./decisions').decide('fortress_visit', { client, bot, task, goal, save, tree, state, target: ctx.fortress?.at || null });
  if (decision.stale) return null;
  const pick = decision.path.at(-1);
  goal.fortressVisit = { pick, at: Date.now(), health: bot.health ?? 20, food: bot.food ?? 20, deaths: deathsOf(goal) };
  save();
  if (pick === 'go_in') return 'go_in';
  if (pick === 'heal_first') return (await rest(bot, task, goal, save)) ? 'acted' : 'go_in';
  // Drunk, the visit goes on as go_in, held as that; bartered, it is asked
  // again with what the barter brought (note 656).
  if (pick === 'drink_fire_resistance') {
    try { await tree[pick].run(); } catch (err) { task.check?.(); if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err; }
    goal.fortressVisit = { ...goal.fortressVisit, pick: 'go_in', after: 'drank fire resistance' }; save();
    return 'go_in';
  }
  if (pick === 'barter_fire_resistance') {
    try { await tree[pick].run(); } catch (err) { task.check?.(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err; }
    delete goal.fortressVisit; save();
    return 'acted';
  }
  if (tree[pick]?.run) await tree[pick].run();
  return 'acted';
}

module.exports = { ask, facts, options, fireOptions, FIRE_OFFER_BELOW, fitness, stands, holdsOff, rest, rowThen, PILLAR, HOLD_MS, HUNGER_DROP, HURT_DROP };
