'use strict';
// Food as a resource the Nether stay is managed by, as blocks became one
// (restock_blocks, blocksCarried): what is carried, what a stay spends, and
// every way to more from where the bot stands, each with what it yields,
// what it costs and what it needs, put to Jev (restock_food).
//
// The design review of 2026-09-28 found that in the Nether health was a fact
// the questions reported and never a resource they managed: 58 stretches of
// a minute or more under 8 health with hunger under 18 and nothing carried
// that is food, 13.3 bot-hours, 36 ended in a death (note 626). Health does
// not come back under hunger 18, and the Nether has little to eat. The
// stage-save trials began with what the source world carried (two raw
// mutton) and were never asked the food-kit question the crossing is asked.
//
// What the Nether has to eat, read from the 26.1.2 server jar (its loot
// tables, recipes, tags and worldgen features; note 639):
//  - a hoglin: 2 to 4 raw porkchops (looting adds 0 or 1 a level), a chance
//    of leather; the drop is cooked as it falls when the hoglin is on fire
//    or the killing weapon smelts loot. Raw is 3 hunger, cooked 8.
//  - red and brown mushrooms: the jar's features red_mushroom_nether and
//    brown_mushroom_nether are placed in the nether_wastes and basalt_deltas
//    biomes only (not the forests, not the soul sand valley), half of the
//    chunks getting 96 tries each within seven blocks; a mushroom stands
//    only in the dark on a solid floor. How many stand is not counted.
//    Mushroom stew is a bowl (3 planks make 4, crimson and warped planks
//    serve), a red and a brown mushroom: 6 hunger.
//  - the chests: a bastion's hoglin stable (a golden carrot roll 10% for 8
//    to 17, a golden apple 10%, and 3 to 4 rolls of a pool that holds
//    porkchop and cooked porkchop 2 to 5 each, 1 in 14 each) and its other
//    chests (golden carrots 12 in 89 for 6 to 17, a golden apple 9 in 89, a
//    cooked porkchop 1 in 13 of 3 to 4 rolls), a treasure chest's enchanted
//    golden apple (2 in 112 of 3 rolls), a ruined portal's chest (golden
//    apples, golden carrots, glistering melon). Golden carrot 6, golden apple
//    4, cooked porkchop 8. A fortress's chests hold no food, and neither
//    does the bridge bastion's.
//  - nothing else: piglin barter's 19 items hold no food, a strider drops
//    string, chorus fruit grows only in the End, and cake, golden carrots
//    and golden apples are made from Overworld crops, apples, milk and eggs.
// Cooking: a furnace (eight cobblestone, blackstone or cobbled deepslate) is
// 10 seconds an item and its fuel is coal or charcoal (8 items each), a
// blaze rod (12) or lava; crimson and warped stems and planks do not burn
// (the jar's non_flammable_wood), so the Nether's wood is no fuel. A
// campfire (3 logs or stems, 3 sticks, a coal or charcoal) or a soul campfire
// (the coal is a soul sand or soil) cooks 4 items at once, 30 seconds each,
// with no fuel; the smoker halves the furnace's time. The bot cooks only
// at a furnace (work.js, the crossing kit's top_up_cook).
const { countOf } = require('./skills');
const { foodSupply } = require('./foraging');

const words = s => String(s).replaceAll('_', ' ');
const r1 = n => Math.round(n * 10) / 10;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));

// The food a stay wants is crossing-kit.js netherStay's; a stay spends about
// forty hunger an hour (99.5 hours of the trials' Nether time, note 607).
const HUNGER_AN_HOUR = 40;
// Food points carried under which the step is offered (a fact said in the
// option, not a rule: Jev chooses).
const LOW_POINTS = 8;
// The kit question is asked again after this long in the same stay.
const STAY_KIT_MS = 60 * 60000;

// The pillar the hunt stands on: two blocks up, from which a hoglin's blow
// does not reach (its reach is sideways, 1.4 blocks; the jar's
// Mob.isWithinMeleeAttackRange, note 586) and a sword's does. Measured over
// 2026-09-28's flight records (the design review of that day): 168 pillar
// stances against hoglins lost 0.1 health on average, with 2 deaths.
const PILLAR_RECORD = { day: '2026-09-28', stances: 168, lost: 0.1, deaths: 2 };
const PILLAR_FROM = 12;
const PILLAR_WAIT_MS = 45000;
const PILLAR_BLOCKS = 2;
// The hunts of a hoglin for its meat over 2026-09-28 (nether-travel.js
// HOGLIN_HUNTS): 66 begun, none brought meat, 61 ended at the sighting.
// None of them was made from a pillar.

// The food carried, as the crossing kit counts it, and what cooking makes of
// the raw meat.
const RAW_MEAT = { porkchop: 'cooked_porkchop', beef: 'cooked_beef', mutton: 'cooked_mutton', chicken: 'cooked_chicken', rabbit: 'cooked_rabbit' };
function foodStock(bot) {
  const foods = bot.registry?.foodsByName || {};
  const points = foodSupply(bot);
  const raw = Object.entries(RAW_MEAT).map(([item, cooked]) => ({ item, cooked, n: countOf(bot, item) })).filter(m => m.n > 0 && foods[m.cooked]);
  const cookedGain = raw.reduce((n, m) => n + m.n * (foods[m.cooked].foodPoints - (foods[m.item]?.foodPoints || 0)), 0);
  return { points, raw, cookedGain };
}

// Whether food is a thing to manage now: the Nether, Survival, with monsters
// about, and little carried or health short at a hunger where it does not
// come back. Said in the option as facts; never a gate on Jev's answer.
function foodNeed(bot, goal) {
  if (!bot?.entity || !inNether(bot) || bot.game?.gameMode !== 'survival' || bot.game?.difficulty === 'peaceful') return null;
  const { points } = foodStock(bot), hunger = bot.food ?? 20, health = bot.health ?? 20;
  const low = points < LOW_POINTS, hurt = hunger < 18 && health < 20;
  if (!low && !hurt) return null;
  const why = [low ? `${points} food points carried, under ${LOW_POINTS}` : null, hurt ? `hunger ${hunger} with health ${r1(health)} (health comes back at eighteen or more)` : null].filter(Boolean).join('; ');
  return { points, hunger, health, low, hurt, why };
}

// The stay's food, from crossing-kit.js: the minutes the goal still wants in
// the Nether, and the points that carries at forty an hour.
function stayFacts(bot) {
  const { netherStay } = require('./crossing-kit');
  const stay = netherStay(bot), { points } = foodStock(bot);
  const lasts = Math.round(points / HUNGER_AN_HOUR * 60);
  return { ...stay, carried: points, lasts, short: Math.max(0, stay.points - points) };
}
const staySays = (bot, stay) => `The goal still wants about ${stay.minutes} minutes in the Nether, and a stay spends about ${HUNGER_AN_HOUR} hunger an hour (99.5 hours of the trials' Nether time, note 607): ${stay.carried ? `${stay.carried} food points carried last about ${stay.lasts} minutes at that rate` : 'no food points are carried to last'}, and ${stay.points} points (${stay.points / 8} cooked steaks or porkchops) cover the stay${stay.short ? `, ${stay.short} more than are carried` : ''}. Raw meat counts at its raw points (three a beef or porkchop) until it is cooked (eight).`;

// A route tried from the bot's record: what came of the hunts of a hoglin
// made in this trial (goal.netherFood.hunts, noted as each ends), and of the
// stews and the trips.
function noteRoute(goal, entry) {
  const f = goal.netherFood ||= { hunts: [] };
  f.hunts = [...(f.hunts || []), { at: Date.now(), ...entry }].slice(-16);
}
function noteHunt(bot, goal, plan, why) {
  if (!goal || !plan?.food) return;
  const meat = countOf(bot, 'porkchop') + countOf(bot, 'cooked_porkchop') - (plan.meatAtStart || 0);
  noteRoute(goal, { route: plan.method === 'pillar' ? 'hoglin_pillar' : 'hoglin_walk', kills: plan.kills || 0, meat: Math.max(0, meat), why: String(why).slice(0, 120), ...(plan.pillarFailed ? { pillarFailed: plan.pillarFailed } : {}), ...(plan.struck ? { struck: plan.struck } : {}) });
}
function recordSays(goal, route) {
  const list = (goal?.netherFood?.hunts || []).filter(h => h.route === route);
  if (!list.length) return route === 'hoglin_pillar' ? ' No hunt of a hoglin has been made from a pillar yet by this bot: nothing is measured of how one goes end to end (only the pillar stances against hoglins, above).' : ' None made yet in this trial.';
  const got = list.filter(h => h.meat > 0).length, last = list.at(-1), ago = Math.max(1, Math.round((Date.now() - last.at) / 60000));
  return ` Made in this trial: ${list.length}, ${got} brought meat (${list.reduce((n, h) => n + h.meat, 0)} porkchops in all); the last, ${ago} minute${ago === 1 ? '' : 's'} ago, ended: ${last.why}${last.pillarFailed ? ` (the pillar: ${last.pillarFailed})` : ''}.`;
}

// The hunt of a hoglin for food, begun: the survival layer runs it as the
// night hunt (survival.js huntStep), two minutes or six health lost. The
// sighting walked to first; a hoglin not there is said and not hunted (61 of
// the day's 66 hunts began at a place none was within thirty-two blocks of:
// the walk's outcome was ignored and the hunt begun all the same).
function startFoodHunt(bot, goal, save, { kind = 'hoglin', method = 'walk' } = {}) {
  const state = goal.survival ||= {};
  state.nightPlan = { plan: 'hunt', kind, food: true, method, until: Date.now() + 120000, startHealth: bot.health, meatAtStart: countOf(bot, 'porkchop') + countOf(bot, 'cooked_porkchop') };
  save?.();
}
async function huntHoglin(bot, task, goal, save, known, { navigate, method = 'walk', survival = null } = {}) {
  if (!known.inView.length && known.seen[0] && navigate) {
    const there = await require('./sightings').walkToSighting(bot, task, goal, save, 'hoglin', known.seen[0], navigate);
    if (!there) {
      noteRoute(goal, { route: method === 'pillar' ? 'hoglin_pillar' : 'hoglin_walk', kills: 0, meat: 0, why: `walked to where ${known.seen[0].says} and none was within thirty-two blocks` }); save?.();
      return false;
    }
  }
  if (survival?.foodHunt) survival.foodHunt(goal, save, 'hoglin', { method });
  else startFoodHunt(bot, goal, save, { method });
  return true;
}

// The pillar hunt's step, as the night hunt takes it (survival.js huntStep):
// walk to within twelve blocks of the hoglin, put two blocks under the feet
// (survival.js pillarFrom, the stance's own), and strike from the top what
// comes within the sword's reach; the hoglin that does not come in forty-five
// seconds ends the hunt. Down to the ground it is the work's own descent
// (work.js descendPillar) and the drop picked up after. `deps` are the
// survival layer's own moves.
async function pillarHuntStep(deps, plan, target) {
  const { bot } = deps;
  const away = target.position.distanceTo(bot.entity.position);
  if (deps.onPillar()) {
    plan.pillarAt ||= Date.now();
    if (deps.canStrike(bot, target)) {
      plan.struck = (plan.struck || 0) + 1;
      await bot.lookAt(target.position.offset(0, (target.height || 1.4) / 2, 0), true);
      await deps.defend();
      return { handled: true };
    }
    if (Date.now() - plan.pillarAt > PILLAR_WAIT_MS) return { end: `no hoglin came within the sword's reach of the pillar in ${PILLAR_WAIT_MS / 1000} seconds` };
    await deps.sleep(250);
    return { handled: true };
  }
  delete plan.pillarAt;
  if (away > PILLAR_FROM) {
    await deps.approach(target, PILLAR_FROM);
    return { handled: true };
  }
  const up = await deps.pillarFrom([{ entity: target, distance: away }]);
  if (!up) {
    plan.method = 'walk'; plan.pillarFailed = deps.why() || 'no block went down';
    return { handled: true };
  }
  plan.pillarAt = Date.now();
  return { handled: true };
}

// Mushrooms of both kinds in the loaded ground within reach, and what the
// stew is made of that the bot carries.
const MUSHROOMS = ['red_mushroom', 'brown_mushroom'];
const MUSHROOM_LOOK = 48;
function mushroomsIn(bot) {
  const out = { red: 0, brown: 0, nearest: null };
  if (typeof bot.findBlocks !== 'function' || !bot.registry?.blocksByName?.red_mushroom) return out;
  const here = bot.entity.position;
  const ids = MUSHROOMS.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  for (const p of bot.findBlocks({ matching: ids, maxDistance: MUSHROOM_LOOK, count: 64 }) || []) {
    const b = bot.blockAt(p);
    if (!b || !MUSHROOMS.includes(b.name)) continue;
    out[b.name === 'red_mushroom' ? 'red' : 'brown']++;
    const d = Math.round(p.distanceTo(here));
    if (!out.nearest || d < out.nearest) out.nearest = d;
  }
  return out;
}
const mushroomCarried = bot => ({ red: countOf(bot, 'red_mushroom'), brown: countOf(bot, 'brown_mushroom') });
const planksCarried = bot => bot.inventory.items().filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0);
const woodForBowls = bot => planksCarried(bot) + 4 * bot.inventory.items().filter(i => /_(log|stem)$/.test(i.name)).reduce((n, i) => n + i.count, 0);

// The chests that hold food, said for what a lifted lid gets (from the jar's
// tables, expectation per chest counted from the pools' weights).
const CHEST_FOOD = 'A bastion\'s hoglin stable chest holds about 17 food points on average (golden carrots 8 to 17 a 1 in 10 roll at 6 each, a golden apple 1 in 10, and 3 to 4 rolls of a pool with porkchop and cooked porkchop 2 to 5 each at 1 in 14 apiece), its other chests about 12 (golden carrots 12 in 89 for 6 to 17, a cooked porkchop 1 in 13 of 3 to 4 rolls), a ruined portal\'s chest about 4 (golden apples, golden carrots); a fortress\'s chests and the bridge bastion\'s hold none. Lifting a bastion chest\'s lid turns the piglins that see it hostile (bastion_raid is that question, note 636); the bot does not go for chests for food.';
const NOT_FOOD = 'piglin barter\'s items (19 in the jar) hold none, a strider drops string, chorus fruit grows only in the End, and cake, golden carrots and golden apples are made from an apple, a carrot, milk, sugar, wheat and eggs, all of the Overworld.';

// The routes, each priced from where the bot stands. `ctx.actions` carries
// navigate, returnOverworld and acquire; `ctx.survival` the survival layer
// where the caller has it. Synchronous: nothing here surveys a walk.
function foodRoutes(bot, task, goal, save, { actions = {}, survival = null } = {}) {
  const routes = {}, notOffered = [];
  const stock = foodStock(bot), here = bot.entity.position;
  const { hoglinsKnown, hoglinSays, hoglinFight } = require('./nether-travel');
  let known = { inView: [], seen: [] };
  try { known = hoglinsKnown(bot, goal); } catch (_) { /* none */ }
  const hoglin = known.inView[0] || known.seen[0];
  if (hoglin) {
    const fight = hoglinFight(bot, known.inView[0] ? known.inView[0].position.distanceTo(here) : 8);
    routes.hoglin_walk = { description: `${hoglinSays(bot, known)}${recordSays(goal, 'hoglin_walk')} It needs nothing carried but a weapon; raw meat is eaten as it is (3 each) or cooked at a furnace (8 each) where one can be made.`,
      run: () => huntHoglin(bot, task, goal, save, known, { navigate: actions.navigate, survival, method: 'walk' }) };
    const blocks = require('./pillar-recovery').SCAFFOLD, laid = bot.inventory.items().filter(i => blocks.includes(i.name)).reduce((n, i) => n + i.count, 0);
    if (laid >= PILLAR_BLOCKS) {
      const p = PILLAR_RECORD;
      routes.hoglin_pillar = { description: `Hunt the same hoglin from a pillar (${hoglin === known.inView[0] ? `${known.inView.length} in view, the nearest ${Math.round(known.inView[0].position.distanceTo(here))} blocks off` : known.seen[0].says}): walk to within ${PILLAR_FROM} blocks of it, put ${PILLAR_BLOCKS} of the ${laid} blocks carried that can be laid under the feet, and strike from the top what comes within the sword's reach; the same food, two to four raw porkchops. A hoglin's blow reaches sideways 1.4 blocks and not up (the jar), so on a pillar two up it does not land, and the sword reaches down to its back; ${p.stances} pillar stances against hoglins over ${p.day}'s trials lost ${p.lost} health on average, ${p.deaths} ended in a death. What it does not stop: a ghast's fireball or a blaze's, a piglin's crossbow, and a fall from the top (a push off it is a drop of two). The hoglin comes only once it has seen the bot; one that does not come within ${PILLAR_WAIT_MS / 1000} seconds ends the hunt, the bot then down on the ground again. The walk to it is the plain hunt's; fought on the ground instead, ${fight.says.charAt(0).toLowerCase()}${fight.says.slice(1)}${recordSays(goal, 'hoglin_pillar')}`,
        run: () => huntHoglin(bot, task, goal, save, known, { navigate: actions.navigate, survival, method: 'pillar' }) };
    } else notOffered.push(`the hunt from a pillar: ${laid} blocks carried that can be laid, ${PILLAR_BLOCKS} are needed`);
  } else notOffered.push('a hoglin: none in view and none seen in the last half hour within 192 blocks (they are found in the crimson forests and the bastions\' stables)');

  // The stew.
  const seen = mushroomsIn(bot), have = mushroomCarried(bot);
  const pairs = Math.min(seen.red + have.red, seen.brown + have.brown);
  if (pairs >= 1 && actions.mineOne) {
    const wood = woodForBowls(bot), bowls = countOf(bot, 'bowl');
    const stews = Math.min(pairs, 4);
    const bowlSays = bowls >= stews ? `${bowls} bowls carried` : wood >= 3 ? `bowls are made from ${bowls ? 'wood' : 'three planks'} (${bowls} carried, planks' worth of wood carried ${wood}; three planks make four)` : `no bowl carried and ${wood} planks' worth of wood: bowls (three planks, crimson or warped serve) are short`;
    if (bowls >= stews || wood >= 3) {
      const gain = stews * 6;
      routes.mushroom_stew = { description: `Make mushroom stew from the mushrooms in view: ${seen.red} red and ${seen.brown} brown within ${MUSHROOM_LOOK} blocks (the nearest ${seen.nearest} off; ${have.red + have.brown ? `${have.red} red and ${have.brown} brown carried; ` : ''}up to ${stews} stew${stews === 1 ? '' : 's'} counted), dug by hand and picked up, then crafted (a red and a brown mushroom and a bowl each; ${bowlSays}; a crafting table carried or set down). Each stew is 6 hunger, ${gain} for ${stews}, eaten from a stack of one, and its bowl is left when it is eaten. About ${Math.round(stews * 6 + seen.nearest / 4.3)} seconds for the gathering from where the bot stands, at a walk and six seconds a mushroom. Not measured: how the walk there goes; a mushroom stands on a solid floor in the dark, on the same floors as the lava and drops. The game generates them in the nether wastes and basalt deltas only.${recordSays(goal, 'mushroom_stew').replace(' None made yet in this trial.', ' None gathered yet by this bot in the game.')}`,
        run: async () => {
          goal.step = { action: 'nether_food', route: 'mushroom_stew', stews }; save?.();
          const { gatherSpanBlocks } = require('./bridging');
          const carried = b => Math.min(countOf(b, 'red_mushroom'), countOf(b, 'brown_mushroom'));
          const done = await gatherSpanBlocks(bot, task, carried(bot) + stews, { navigate: actions.navigate, mineAt: s => actions.mineOne(s.p, s.name), reach: 24, walk: 32, names: MUSHROOMS, carried, what: 'mushrooms' });
          if (carried(bot) >= 1 && actions.acquire) {
            try { await actions.acquire(bot, task, 'mushroom_stew', countOf(bot, 'mushroom_stew') + carried(bot), goal, save); }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err; done.why = err.message; }
          }
          noteRoute(goal, { route: 'mushroom_stew', kills: 0, meat: 0, why: `${countOf(bot, 'mushroom_stew')} stews carried after${done.why ? `: ${done.why}` : ''}` }); save?.();
        } };
    } else notOffered.push(`mushroom stew: ${seen.red} red and ${seen.brown} brown in view, but ${bowlSays}`);
  } else notOffered.push(`mushroom stew: ${seen.red} red and ${seen.brown} brown mushrooms within ${MUSHROOM_LOOK} blocks (${have.red + have.brown ? `${have.red} red and ${have.brown} brown carried; ` : ''}the game generates them in the nether wastes and basalt deltas only, and how many stand there is not counted)`);

  // Raw meat carried, cooked at a furnace.
  if (stock.raw.length && stock.cookedGain > 0 && actions.acquire) {
    const { cookable } = require('./work');
    let cook = null; try { cook = cookable(bot); } catch (_) { cook = null; }
    if (cook?.ready) {
      const secs = cook.n * 10 + (cook.furnace ? 2 : 6);
      routes.cook_meat = { description: `Cook the raw meat carried: ${cook.items.map(i => `${i.n} ${words(i.raw)}`).join(', ')}, ${cook.now} food points as carried and ${cook.after} once cooked (+${stock.cookedGain}). ${cook.furnace ? `The ${cook.furnace} carried is` : `A furnace is made from eight of the ${words(cook.stone)} carried and`} put down here, fuelled with the ${words(cook.fuel)} carried (coal and charcoal burn 8 items, a blaze rod 12; the Nether's own wood does not burn): about ten seconds an item, about ${secs} seconds standing at it, with no walk. The meat is in the furnace, not eaten, while it cooks${(bot.food ?? 20) < 18 ? `: health does not come back at hunger ${bot.food} meanwhile` : ''}.`,
        run: async () => {
          const first = cook.items.slice().sort((a, b) => b.n - a.n)[0];
          goal.step = { action: 'cook_for_nether', item: first.cooked, raw: first.n, foodPoints: stock.points }; save?.();
          await actions.acquire(bot, task, first.cooked, countOf(bot, first.cooked) + first.n, goal, save);
        } };
    } else notOffered.push(`cooking the raw meat carried (${stock.raw.map(m => `${m.n} ${words(m.item)}`).join(', ')}, +${stock.cookedGain} points): ${cook ? `no ${cook.fuel ? 'furnace or eight blocks of stone to make one' : 'fuel that burns (coal, charcoal, a blaze rod) is carried'}` : 'nothing to cook it with is carried'}; the Nether's stems and planks do not burn`);
  }

  // The trip back.
  if (actions.returnOverworld) {
    let there = ''; try { there = require('./healing').overworldFoodSays(bot, goal) || ''; } catch (_) { there = ''; }
    const nv = require('./nether-travel');
    routes.return_for_food = { description: `Go back through the portal to the Overworld for food, hunted and cooked there, and come back fed. ${require('./game-progress').portalTrip(bot, goal)}${there ? ` ${there}` : ''}${nv.keepOnSays(bot, goal)}${nv.standingTripSays(bot, goal, 'return_for_food')}`,
      run: async () => {
        nv.chooseReturnForFood(goal); delete goal.netherFoodKit;
        goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save?.();
        await actions.returnOverworld(bot, task, goal, save);
      } };
  }
  return { routes, notOffered, known, seen, stock };
}

// The step offered where the ladder or a stall asks: one option that opens
// the question of the ways, said with what is carried, why it is on offer
// and what each way yields. null when the Nether stay is not short or no way
// is real from here.
function restockFoodOption(bot, task, goal, save, { actions = {}, survival = null, client = null } = {}) {
  const need = foodNeed(bot, goal);
  if (!need) return null;
  let found; try { found = foodRoutes(bot, task, goal, save, { actions, survival }); } catch (_) { return null; }
  const keys = Object.keys(found.routes);
  if (!keys.length) return null;
  const stay = stayFacts(bot);
  const list = keys.map(k => ({ hoglin_walk: 'a hoglin hunted on foot (2 to 4 raw porkchops, 6 to 12 points raw, 16 to 32 cooked)', hoglin_pillar: 'the same hoglin hunted from a pillar two blocks up (the pillar stances measured 0.1 health lost, none of these hunts made yet)',
    mushroom_stew: 'mushroom stew from the mushrooms in view (6 points a stew)', cook_meat: `the raw meat carried cooked (+${found.stock.cookedGain} points)`, return_for_food: 'the trip back through the portal for food (at the pace the Nether walks measured)' }[k])).join('; ');
  return { description: `Get food here before going on, the way asked next with each priced: ${list}. On offer because ${need.why}. ${staySays(bot, stay)} Health does not come back at hunger under eighteen, and the Nether has little else to eat: what its bastions' chests hold and the stew are the rest.`,
    run: () => askRestockFood(bot, task, goal, save, { actions, survival, client, found }) };
}

// The question of the ways to food, and the one chosen carried out.
async function askRestockFood(bot, task, goal, save, { actions = {}, survival = null, client = null, found = null } = {}) {
  found ||= foodRoutes(bot, task, goal, save, { actions, survival });
  const { routes, notOffered, stock } = found;
  const options = { ...routes };
  const nv = require('./nether-travel');
  if (!options.keep_on && (bot.food ?? 20) < 18) {
    options.keep_on = { description: `Stay in the Nether and go on without more food for twenty minutes: ${stock.points ? `eat what is carried (${stock.points} food points)` : 'nothing edible is carried'}, hunger ${bot.food}, health comes back only at eighteen or more. No fight is started while it does not.`,
      run: async () => { const { setAside } = require('./progress'); setAside(goal, 'nether_return', 'food', nv.keepOnWhy(bot), 20 * 60000); delete goal.stockFood; save?.(); } };
  }
  if (!Object.keys(options).length) throw new Error(`No way to food from here: ${notOffered.join('; ')}`.slice(0, 500));
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
  const stay = stayFacts(bot);
  const state = { carried: `${stock.points} food points${stock.raw.length ? `, of raw meat ${stock.raw.map(m => `${m.n} ${words(m.item)}`).join(', ')} (cooked, +${stock.cookedGain} points)` : ''}`,
    hunger: bot.food, health: r1(bot.health ?? 20), stay: { minutesWanted: stay.minutes, pointsWanted: stay.points, carriedLastMinutes: stay.lasts },
    waysNotOffered: notOffered, whatTheNetherHas: `${CHEST_FOOD} ${NOT_FOOD}`,
    theNetherPace: `the Nether's walks back to a portal made ${require('./game-progress').NETHER_TRIPS.slow} to ${require('./game-progress').NETHER_TRIPS.fast} blocks a minute` };
  const decision = await require('./decisions').decide('restock_food', { client: client || actions.client || task.opportunityClient, bot, task, goal, save, tree, state, context: {} });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  await options[pick].run();
  return true;
}

// The food-kit question of a stay: the Nether's equivalent of the crossing
// kit's food line, asked the first time a Nether question is due in a stay
// (the stage saves begin inside the Nether and were never asked at a portal),
// and each hour of it after. Not with a mob in sight; nothing is given.
function stayKitDue(bot, goal, now = Date.now()) {
  if (!bot?.entity || !inNether(bot) || bot.game?.gameMode !== 'survival' || bot.game?.difficulty === 'peaceful') return null;
  const last = goal.netherFoodKit;
  if (last && now - last.at < STAY_KIT_MS) return null;
  const stay = stayFacts(bot);
  if (!stay.short) return null;
  return stay;
}
async function askStayKit(bot, task, goal, save, { actions = {}, survival = null, client = null, now = Date.now() } = {}) {
  const stay = stayKitDue(bot, goal, now);
  if (!stay) return 'go_on';
  try { if (require('./danger').threats(bot, 16).some(t => t.visible)) return 'go_on'; } catch (_) { /* none seen */ }
  const found = foodRoutes(bot, task, goal, save, { actions, survival });
  const tree = {
    go_on: { description: `Go on with the stay on what is carried: ${stay.carried} food points, about ${stay.lasts} minutes of it at ${HUNGER_AN_HOUR} an hour, against the ${stay.minutes} minutes the goal still wants; ${stay.short} points short. Nothing is done about food now; it is asked again in an hour, and when health and hunger say so the food step is offered at the stalls.` },
  };
  if (found.routes.return_for_food) tree.return_for_food = { description: found.routes.return_for_food.description };
  const others = Object.keys(found.routes).filter(k => !['return_for_food'].includes(k));
  if (others.length) tree.restock_food = { description: `Get food here first (the ways asked next, each priced): ${others.map(k => ({ hoglin_walk: 'a hoglin hunted on foot', hoglin_pillar: 'a hoglin hunted from a pillar', mushroom_stew: 'mushroom stew', cook_meat: 'the raw meat cooked' }[k])).join(', ')}. ${found.notOffered.join('; ')}.` };
  goal.netherFoodKit = { at: now, points: stay.carried, minutes: stay.minutes };
  save?.();
  if (Object.keys(tree).length < 2) return 'go_on';
  const state = { stay: { minutesWanted: stay.minutes, pointsWanted: stay.points, pointsCarried: stay.carried, carriedLastMinutes: stay.lasts, short: stay.short }, hunger: bot.food, health: r1(bot.health ?? 20), staying: staySays(bot, stay),
    note: 'This is the food line of the crossing kit, asked inside the Nether because this stay began here (a save, or a crossing made before the kit counted food for the stay).' };
  const decision = await require('./decisions').decide('nether_food_kit', { client: client || actions.client || task.opportunityClient, bot, task, goal, save, tree, state, context: {} });
  if (decision.stale) { delete goal.netherFoodKit; return null; }
  const pick = decision.path.at(-1);
  goal.netherFoodKit.pick = pick; save?.();
  if (pick === 'return_for_food') { await found.routes.return_for_food.run(); return pick; }
  if (pick === 'restock_food') { await askRestockFood(bot, task, goal, save, { actions, survival, client, found }); return pick; }
  return pick;
}

module.exports = { foodStock, foodNeed, stayFacts, staySays, foodRoutes, restockFoodOption, askRestockFood, askStayKit, stayKitDue, startFoodHunt, huntHoglin, pillarHuntStep, noteHunt, noteRoute, recordSays, mushroomsIn,
  HUNGER_AN_HOUR, LOW_POINTS, STAY_KIT_MS, PILLAR_RECORD, PILLAR_FROM, PILLAR_WAIT_MS, PILLAR_BLOCKS, CHEST_FOOD, NOT_FOOD, RAW_MEAT };
