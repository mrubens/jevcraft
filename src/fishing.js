'use strict';
// Food from the water (note 1203): cod and salmon killed at the water's
// top, and a fishing rod cast from the bank.
//
// 25588 (world mid-231-bp, 2026-10-04 07:29 to 08:27Z) searched for food
// for an hour on a map of frozen ocean, river and stony shore, swam across
// water again and again, found no cow, sheep or rabbit, and starved to 0.36
// health at hunger 0. Its food question had only the land's ways (a hunt of
// an animal in view, a herd seen, the search for a dry area), and the water
// it crossed was never one of them. Here are the two ways a player has, each
// an option of obtain_food said with what it takes and what it brings; the
// choice between them and the land's ways is Jev's.
const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { swimmableWater, dryPassable } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const words = s => String(s).replaceAll('_', ' ');

// The fish that are food: a cod or a salmon drops one raw fish, always, two
// hunger raw. Not a pufferfish (it poisons) and not a tropical fish (one
// point): neither is offered.
const FISH = { cod: 'cod', salmon: 'salmon' };
const FISH_HEALTH = 3;
const fishFood = (bot, entity) => entity && FISH[entity.name] && bot.registry?.foodsByName?.[FISH[entity.name]] ? FISH[entity.name] : undefined;
// A fish is struck from the water's top: the swimmer's eye is about a block
// over the water and a swing reaches three, so a fish two blocks down is in
// reach and a deeper one is dived for on the breath. More than four blocks
// down is not offered: the breath's first four points are about three
// seconds, and a body sinks about a block and a half a second.
const SPEAR_DEPTH = 4, SPEAR_SIGHT = 24, REACH = 3;

// The water's top over a point, and how far under it the point lies; null
// where the column is roofed (ice over a frozen ocean, stone over a cave
// pool) or the point is not in water.
function surfaceOver(bot, position) {
  const p = position.floored();
  if (!swimmableWater(bot.blockAt(p))) return null;
  for (let y = p.y; y <= p.y + 12; y++) {
    const above = bot.blockAt(new Vec3(p.x, y + 1, p.z));
    if (swimmableWater(above)) continue;
    return dryPassable(above) ? { y, depth: Math.max(0, Math.round((y + 0.9 - position.y) * 10) / 10) } : null;
  }
  return null;
}
const live = (bot, e) => bot.entities[e.id] === e && e.isValid !== false;
// The fish in view that can be had: food fish within 24 blocks, under open
// water no deeper than the dive, not one that could not be got to in the
// last two minutes (state.failedPrey, as the land's hunts keep it).
function fishInView(bot, state = {}) {
  const here = bot.entity.position;
  return Object.values(bot.entities || {}).filter(e => fishFood(bot, e) && e.isValid !== false && e.position &&
    e.position.distanceTo(here) < SPEAR_SIGHT && !(state?.failedPrey?.[e.uuid || e.id] > Date.now() - 120000))
    .map(e => ({ e, top: surfaceOver(bot, e.position) })).filter(f => f.top && f.top.depth <= SPEAR_DEPTH)
    .sort((a, b) => a.e.position.distanceTo(here) - b.e.position.distanceTo(here)).map(f => f.e);
}
// Those of them a swim at the water's top gets over: at most four surveyed,
// two offered (a school is one kind, and the hunt holds for its kind).
async function fishCandidates(bot, task, state) {
  const { surfaceMovement } = require('./surface'), { surveyRoute } = require('./skills');
  const seen = fishInView(bot, state);
  if (!seen.length) return [];
  const surface = surfaceMovement(bot);
  try {
    const out = [];
    for (const target of seen.slice(0, 4)) {
      const flat = Math.hypot(target.position.x - bot.entity.position.x, target.position.z - bot.entity.position.z);
      const route = flat <= 4 ? { status: 'success' } : await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalNearXZ(target.position.x, target.position.z, 3), 500);
      if (route.status === 'success' && live(bot, target) && surfaceOver(bot, target.position)) out.push(target);
      if (out.length === 2) break;
    }
    return out;
  } finally { surface.restore(); }
}
const swingDamage = name => ({ wooden_sword: 4, golden_sword: 4, stone_sword: 5, copper_sword: 5, iron_sword: 6, diamond_sword: 7, netherite_sword: 8,
  wooden_axe: 7, golden_axe: 7, stone_axe: 9, copper_axe: 9, iron_axe: 9, diamond_axe: 9, netherite_axe: 10 })[name] || 1;
const bestWeapon = bot => bot.inventory.items().filter(i => /_(sword|axe)$/.test(i.name)).sort((a, b) => swingDamage(b.name) - swingDamage(a.name))[0] || null;
// What the option says of one fish: how deep it is and the blows it takes.
function spearFacts(bot, target) {
  const top = surfaceOver(bot, target.position), item = fishFood(bot, target), f = bot.registry.foodsByName;
  const weapon = bestWeapon(bot)?.name || null;
  const blows = Math.ceil(FISH_HEALTH / swingDamage(weapon));
  return { depth: top?.depth ?? null, blows,
    action: `Swim out over this ${words(target.name)} and kill it from the water's top (${FISH_HEALTH} health: ${blows === 1 ? 'one blow' : `${blows} blows`} with ${weapon ? `the ${words(weapon)}` : 'bare hands'}), then pick up its raw ${words(item)} as it floats up. ` +
      `It swims about ${top?.depth ?? '?'} blocks under the water's top now; a swing reaches about two blocks down from there, and a deeper fish is dived for on the breath (a few seconds, then up). ` +
      `A ${words(target.name)} drops one raw ${words(item)}, always: ${f[item].foodPoints} hunger raw and safe to eat so, ${f[`cooked_${item}`]?.foodPoints} cooked. Fish move; the chase is given 45 seconds (in the drill of 2026-10-04, five fish in a pool four deep took 5 to 12 seconds each with a stone sword, 14 to 26 with bare hands).` };
}

// Kill one fish and pick up what it drops. The swim over it is the
// pathfinder's at the water's top; the last blocks and the dive are steered
// by hand (the pathfinder does not dive): the jump key holds the head up,
// and let go over a fish out of reach the body sinks to it while the breath
// is above sixteen of twenty.
async function spear(bot, task, target, actions, goal, save) {
  const { surfaceMovement } = require('./surface'), { makeRoom } = require('./inventory-tidy'), { strike } = require('./combat');
  const { foodSupply } = require('./foraging');
  const surface = surfaceMovement(bot);
  const inWater = () => swimmableWater(bot.blockAt(bot.entity.position.floored())) || swimmableWater(bot.blockAt(bot.entity.position.offset(0, 1, 0).floored()));
  const steer = async (to, { dive = false } = {}) => {
    const flat = Math.hypot(to.x - bot.entity.position.x, to.z - bot.entity.position.z);
    await bot.lookAt(new Vec3(to.x, bot.entity.position.y + 1.62, to.z), true);
    bot.setControlState('forward', flat > 0.6);
    bot.setControlState('jump', inWater() && !(dive && (bot.oxygenLevel ?? 20) > 16));
  };
  try {
    const item = fishFood(bot, target);
    if (!item) throw new Error(`Food target ${target?.name} is not a cod or a salmon`);
    if (!await makeRoom(bot, task, item, { goal, away: target.position })) throw new Error(`No room in my pockets for ${words(item)}`);
    const before = count(bot, item), foodBefore = foodSupply(bot), started = Date.now(), deadline = started + 45000;
    const weapon = bestWeapon(bot);
    if (weapon) await bot.equip(weapon, 'hand');
    else if (bot.heldItem) await require('./skills').emptyHand(bot);
    let attacks = 0, missed = 0, nearest = Infinity, dived = false, last = target.position.clone();
    while (live(bot, target) && Date.now() < deadline) {
      task.check(); checkAir(bot); checkThreats(bot);
      last = target.position.clone();
      const top = surfaceOver(bot, target.position);
      if (!top) throw new Error(`The ${words(target.name)} swam under ice or a roof, where the water's top cannot be swum`);
      const flat = Math.hypot(target.position.x - bot.entity.position.x, target.position.z - bot.entity.position.z);
      const eye = bot.entity.position.offset(0, 1.62, 0), aim = target.position.offset(0, (target.height || 0.3) / 2, 0);
      if (flat > 5) {
        bot.clearControlStates();
        try { await actions.navigate(bot, task, new goals.GoalNearXZ(target.position.x, target.position.z, 3), { timeoutMs: 6000, stallMs: 3000, stopWhen: () => !live(bot, target) || Math.hypot(target.position.x - bot.entity.position.x, target.position.z - bot.entity.position.z) <= 4 }); }
        catch (err) {
          task.check(); checkAir(bot); checkThreats(bot); if (err.name === 'NeedsAir') throw err;
          // Two swims that failed and got no nearer, as the land's hunt counts them.
          const gap = bot.entity.position.distanceTo(target.position);
          if (gap < nearest - 1) { nearest = gap; missed = 0; } else if (++missed >= 2) throw new Error(`Cannot get over the ${words(target.name)} from here: ${err.message}`);
        }
        continue;
      }
      const direction = aim.minus(eye);
      const hit = eye.distanceTo(aim) <= REACH ? bot.world.raycast(eye, direction.unit(), direction.norm()) : null;
      if (eye.distanceTo(aim) > REACH || (hit && eye.distanceTo(hit.intersect || hit.position) < direction.norm() - 0.25)) {
        if (flat <= 1.5 && top.depth > 2 && (bot.oxygenLevel ?? 20) > 16) dived = true;
        await steer(target.position, { dive: flat <= 1.5 });
        await sleep(100);
        continue;
      }
      bot.setControlState('forward', false);
      bot.setControlState('jump', inWater());
      await bot.lookAt(aim, true);
      if (await strike(bot, task, target) !== 'missed') attacks++;
      for (let i = 0; i < 6 && live(bot, target); i++) { task.check(); checkThreats(bot); await sleep(100); }
    }
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    if (live(bot, target)) throw new Error(`Could not kill the ${words(target.name)} within 45 seconds: it kept out of reach (${attacks} ${attacks === 1 ? 'blow' : 'blows'} landed)`);
    // The fish floats up where it died; the head is kept up meanwhile.
    const pickupBy = Date.now() + 10000;
    while (count(bot, item) <= before && Date.now() < pickupBy) {
      task.check(); checkThreats(bot);
      const drop = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === item && e.position.distanceTo(last) < 8)
        .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
      await steer(drop ? drop.position : last);
      await sleep(100);
    }
    if (count(bot, item) <= before) throw new Error(`No raw ${words(item)} picked up after killing the ${words(target.name)}`);
    goal.survivalAction = { action: 'food_collected', source: target.name, item, count: count(bot, item) - before, needsCooking: false, attacks, dived,
      seconds: Math.round((Date.now() - started) / 1000), foodPointsGained: foodSupply(bot) - foodBefore, at: new Date().toISOString() };
    save();
  } finally {
    // Left afloat, whatever ended it: the shore rule takes it from there.
    bot.clearControlStates?.();
    if (inWater()) bot.setControlState?.('jump', true);
    surface.restore();
  }
}

// The rod. A catch is the game's fishing table: fish 85 in 100 (of those
// cod 60, salmon 25, pufferfish 13, tropical fish 2), junk 10, treasure 5;
// so a cod or a salmon is about 72 catches in 100. The bite comes 5 to 30
// seconds after the bobber lands under open sky (about 17 the mean, with
// the cast and the reel about 20 a catch), about twice that under a roof.
// A rod is 3 sticks and 2 string (string from spiders) and has 64 casts in
// it.
const TABLE = { food: 0.85 * 0.85, cod: 0.85 * 0.6, salmon: 0.85 * 0.25 };
const CATCH_SECONDS = 24, ROD_SECONDS = 240, ROD_FISH = 8, WATER_SIGHT = 32, BITE_TIMEOUT = 50000;
const rodOf = bot => bot.inventory.items().find(i => i.name === 'fishing_rod') || null;
const castsLeft = (bot, rod) => Math.max(0, (bot.registry.itemsByName.fishing_rod?.maxDurability || 64) - (rod?.durabilityUsed || 0));

// Where to fish from: the nearest bank cell right at open water (the water
// a step down beside the feet) with two or three cells of open water
// straight out from it; the cast goes to the farthest of them. The catch is
// thrown from the bobber at the bot and rises about half a block on the
// way: in the drill of 2026-10-04 the bot stood three blocks back from the
// pool's edge, the bobber lay 0.6 from the wall, and all 12 catches in 270
// seconds struck the bank's side and stayed in the water (nothing carried
// after). At the edge, what falls short floats against the bank under the
// feet, within a pick-up's reach. -> { water, stand, distance, openSky } or null
function castSpot(bot, { sight = WATER_SIGHT } = {}) {
  const water = bot.registry.blocksByName.water?.id;
  if (water == null || !bot.findBlocks) return null;
  const here = bot.entity.position;
  const open = p => { const b = bot.blockAt(p); return b?.name === 'water' && dryPassable(bot.blockAt(p.offset(0, 1, 0))); };
  const cells = bot.findBlocks({ matching: water, maxDistance: sight, count: 512 }).filter(open)
    .sort((a, b) => a.distanceTo(here) - b.distanceTo(here)).slice(0, 64);
  const standable = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' && dryPassable(bot.blockAt(p)) && dryPassable(bot.blockAt(p.offset(0, 1, 0)));
  let best = null;
  for (const w of cells) {
    if (best && best.distance <= w.distanceTo(here) - 2) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const stand = w.offset(-dx, 1, -dz), distance = stand.distanceTo(here);
      if ((best && distance >= best.distance) || !standable(stand) || !open(w.offset(dx, 0, dz))) continue;
      const far = open(w.offset(2 * dx, 0, 2 * dz)) ? w.offset(2 * dx, 0, 2 * dz) : w.offset(dx, 0, dz);
      const eye = stand.offset(0.5, 1.62, 0.5), aim = far.offset(0.5, 0.9, 0.5), line = aim.minus(eye);
      if (bot.world?.raycast?.(eye, line.unit(), line.norm())) continue;
      best = { water: far, stand, distance };
    }
  }
  if (!best) return null;
  return { ...best, distance: Math.round(best.distance), openSky: require('./surface').openSkyOver(bot, best.water) };
}

// Fish from the bank until `want` cod or salmon are caught or the time is
// up. Each cast is mineflayer's bot.fish(), which reels in at the bite; the
// catch is read off the pockets. A threat or a cancelled task reels in and
// ends it. -> { fish, casts, caught: { name: n }, seconds }
async function fishWithRod(bot, task, spot, actions, goal, save, { want = 4, seconds = ROD_SECONDS } = {}) {
  const { makeRoom } = require('./inventory-tidy'), { foodSupply } = require('./foraging');
  if (!rodOf(bot)) {
    if (!actions.acquireStep) throw new Error('No fishing rod carried and none can be made here');
    // The recipe plan a step at a time: the table, the sticks, the rod.
    for (let step = 0; step < 6 && !rodOf(bot); step++) { task.check(); checkThreats(bot); await actions.acquireStep(bot, task, 'fishing_rod', 1, goal, save); }
    if (!rodOf(bot)) throw new Error('The fishing rod was not made');
  }
  if (!await makeRoom(bot, task, 'cod', { goal })) throw new Error('No room in my pockets for a fish');
  const { stand, water } = spot;
  if (bot.entity.position.distanceTo(stand.offset(0.5, 0, 0.5)) > 1) await actions.navigate(bot, task, new goals.GoalBlock(stand.x, stand.y, stand.z), { timeoutMs: Math.max(15000, spot.distance * 1000) });
  const snapshot = () => { const c = {}; for (const i of bot.inventory.items()) c[i.name] = (c[i.name] || 0) + i.count; return c; };
  const started = Date.now(), deadline = started + seconds * 1000, foodBefore = foodSupply(bot), caught = {};
  const fishCaught = () => (caught.cod || 0) + (caught.salmon || 0);
  let casts = 0, dry = 0;
  const reel = () => { try { bot.activateItem(); } catch (_) { /* the rod is gone */ } };
  while (fishCaught() < want && Date.now() < deadline) {
    task.check(); checkAir(bot); checkThreats(bot);
    const rod = rodOf(bot);
    if (!rod) break;   // the last cast broke it
    if (bot.heldItem?.name !== 'fishing_rod') await bot.equip(rod, 'hand');
    await bot.lookAt(water.offset(0.5, 0.9, 0.5), true);
    const before = snapshot();
    let done = false, failed = null;
    const cast = bot.fish().then(() => { done = true; }, err => { done = true; failed = err; });
    casts++;
    const castAt = Date.now();
    try { while (!done && Date.now() - castAt < BITE_TIMEOUT) { task.check(); checkThreats(bot); await sleep(200); } }
    catch (err) { if (!done) reel(); await Promise.race([cast, sleep(3000)]); throw err; }
    if (!done) { reel(); await Promise.race([cast, sleep(3000)]); if (!failed) failed = new Error('the bobber never bit'); }
    if (failed) {
      // Two casts with no bite in fifty seconds each: the line is not in water.
      if (++dry >= 2) throw new Error(`No bite in ${dry} casts at the water at (${water.x}, ${water.y}, ${water.z}): ${failed.message}`);
      await sleep(600); continue;
    }
    dry = 0;
    // The catch flies to the bot: about a second.
    let got = {};
    for (let i = 0; i < 15; i++) {
      await sleep(200);
      const now = snapshot();
      got = Object.fromEntries(Object.entries(now).map(([name, n]) => [name, n - (before[name] || 0)]).filter(([name, n]) => n > 0 && name !== 'fishing_rod'));
      if (Object.keys(got).length) break;
    }
    for (const [name, n] of Object.entries(got)) caught[name] = (caught[name] || 0) + n;
    goal.survivalAction = { action: 'fishing', casts, caught: { ...caught }, at: new Date().toISOString() }; save();
    await sleep(400);
  }
  const result = { fish: fishCaught(), casts, caught, seconds: Math.round((Date.now() - started) / 1000) };
  if (!result.fish) throw new Error(`${casts} casts in ${result.seconds} seconds brought no cod or salmon${Object.keys(caught).length ? ` (${Object.entries(caught).map(([n, c]) => `${c} ${words(n)}`).join(', ')})` : ''}`);
  goal.survivalAction = { action: 'food_collected', source: 'fishing_rod', item: (caught.cod || 0) >= (caught.salmon || 0) ? 'cod' : 'salmon', count: result.fish, casts, caught, seconds: result.seconds,
    needsCooking: false, foodPointsGained: foodSupply(bot) - foodBefore, at: new Date().toISOString() };
  save();
  return result;
}

// The rod's option, where it can be done: a rod carried, or two string to
// make one of, and open water with a bank within 32 blocks. `target`: the
// reserve the food is for, in points; `supply`: the points carried.
function rodChoice(bot, task, goal, save, actions, { target = 12, supply = 0, walkFacts = () => ({}) } = {}) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  const { isSetAside, setAside } = require('./progress');
  if (isSetAside(goal, 'forage', 'fish_with_rod')) return null;
  const rod = rodOf(bot), string = count(bot, 'string');
  if (!rod && !(string >= 2 && actions.acquireStep)) return null;
  const spot = castSpot(bot);
  if (!spot) return null;
  const f = bot.registry.foodsByName, raw = f.cod.foodPoints;
  const want = Math.max(1, Math.min(ROD_FISH, rod ? castsLeft(bot, rod) : ROD_FISH, Math.ceil(Math.max(1, target - supply) / raw)));
  const each = Math.round(CATCH_SECONDS * (spot.openSky ? 1 : 2) / TABLE.food);
  const expected = Math.max(1, Math.min(want, Math.floor(ROD_SECONDS / each)));
  const cooked = Math.round(expected * (TABLE.cod * f.cooked_cod.foodPoints + TABLE.salmon * f.cooked_salmon.foodPoints) / TABLE.food);
  return {
    target: { x: spot.stand.x, y: spot.stand.y, z: spot.stand.z },
    description: { action: `Fish with the rod from the bank at the water ${spot.distance} blocks off, until ${want} cod or salmon are caught or four minutes pass (a threat ends it sooner). ` +
        `A bite comes 5 to 30 seconds after each cast under open sky (about twice that under a roof), and about 72 catches in 100 are a cod or a salmon (${raw} hunger raw and safe to eat so, ${f.cooked_cod.foodPoints} and ${f.cooked_salmon.foodPoints} cooked); the rest are junk, treasure, a tropical fish (1) or a pufferfish (poison, never eaten). The bot stands still on the bank while it fishes.`,
      water: { x: spot.water.x, y: spot.water.y, z: spot.water.z }, distance: spot.distance,
      rod: rod ? `carried, ${castsLeft(bot, rod)} casts left in it` : `made first from 3 sticks and 2 of the ${string} string carried (the sticks from planks, at a crafting table)`,
      openSky: spot.openSky, fishWanted: want, secondsAFish: each, catchSeconds: expected * each, pointsExpectedRaw: expected * raw, pointsExpectedCooked: cooked,
      ...((bot.inventory.emptySlotCount?.() ?? 1) <= 0 ? { pocketsFull: 'no free slot: what to drop for the catch is asked first' } : {}),
      ...walkFacts(spot.distance, spot.stand) },
    valid: () => !!rodOf(bot) || count(bot, 'string') >= 2,
    run: async () => {
      goal.survivalAction = { action: 'fishing', water: { x: spot.water.x, y: spot.water.y, z: spot.water.z }, at: new Date().toISOString() }; save();
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try { return await fishWithRod(bot, task, spot, actions, goal, save, { want }); }
      catch (err) {
        // Rested five minutes where it brought nothing, so the other ways
        // are weighed meanwhile (as the search rests where it finds no ground).
        if (!['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) { setAside(goal, 'forage', 'fish_with_rod', err.message, 300000); save(); }
        throw err;
      } finally { task.interruptCheck = outerCheck; }
    },
  };
}

module.exports = { FISH, TABLE, SPEAR_DEPTH, CATCH_SECONDS, ROD_SECONDS, fishFood, surfaceOver, fishInView, fishCandidates, spearFacts, spear, castSpot, castsLeft, fishWithRod, rodChoice };
