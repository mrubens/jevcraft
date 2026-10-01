'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { handlers, combatGear, durable, carriedEquipment, equipped, readyEquipment, kitReady, observedDead, shooter, hasFood, SHOOTERS, FIGHT_FLOOR: HUNT_FLOOR } = require('./mob-policy');
const { threats, checkThreats, NeedsSafety } = require('./danger');
const { canStrike, defenseWeapon, bowReady, shoot, strike } = require('./combat');
const { deflect } = require('./projectile-guard');
const { aimAtEntity } = require('./projectiles');
const { dryStanding } = require('./mining-access');
const { dryBodySpace, damagingTerrain, supportCell, dropWithin, dropNear, onSpan } = require('./terrain');
const { fightEstimate } = require('./combat-estimate');
const { checkAir } = require('./vitals');
const { surveyRoute, countOf, pickaxeTier } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');
const { decide } = require('./decisions');
const { descendTo } = require('./descent');
const { setAside, isSetAside, watch, unwatch, attemptsFor } = require('./progress');
const { bridgeTo, surveyCrossing, blocksCarried, stepOntoFooting, spanBlockSources, gatherSpanBlocks } = require('./bridging');
const { crossToward, crossingSays, crossingSeconds, nearer, surveyLeg, legSays, WALK_SPEED, floorWay, walkFloor, headingColumns, wayDownSays, floorWalkSays, goDown, FLOOR_WALKABLE } = require('./nether-travel');
const coverage = require('./nether-coverage'), regions = require('./nether-regions');
const { bunkerFight, digBunker, raiseCover, openToward, swarm, nearWall, centroid: bunkerCentroid } = require('./bunker');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dimension = bot => String(bot.game.dimension).replace(/^minecraft:/, '').replace(/^the_/, '');
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const valid = (bot, target) => bot.entities[target.id] === target && target.isValid !== false && !observedDead(bot, target);

// Gold on the feet in the Nether, where it keeps piglins neutral; the
// better boots everywhere else. Worn iron boots passed the readiness
// check, so the golden pair stayed in the pockets through the trip.
function preferredBoots(bot) {
  const carried = new Set(carriedEquipment(bot).map(i => i.name));
  if (bot.game?.dimension && dimension(bot) === 'nether') return carried.has('golden_boots') ? 'golden_boots' : null;
  return ['netherite_boots', 'diamond_boots', 'iron_boots'].find(name => carried.has(name)) || null;
}

// The ladder's step for each piece, whose setting aside means it waits.
const PIECE_RUNG = { hand: ['iron_sword', 'diamond_sword'], head: ['iron_helmet', 'iron_armour'], torso: ['iron_chestplate', 'iron_armour'],
  legs: ['iron_leggings', 'iron_armour'], feet: ['iron_boots', 'iron_armour'], 'off-hand': ['shield'] };
async function prepareCombatGear(bot, task, goal, save, actions, { client = task.opportunityClient, mob = goal.mobHunt?.entity } = {}) {
  // What is carried is worn; what is missing is Jev's to fetch or go
  // without, told what each costs (kitChoice). Jev's "Nether first" set the
  // armour aside and this fetched every piece before the portal anyway (the
  // decision review, 2026-09-26); in the Nether it fetched iron that is not
  // there to be had (mid-227-r-nether-1, note 476).
  const { isSetAside } = require('./progress');
  const waiting = destination => (PIECE_RUNG[destination] || []).some(p => isSetAside(goal, 'rung', p));
  let short = false;
  const missing = [];
  for (const [destination, names] of Object.entries(combatGear)) {
    task.check(); checkAir(bot);
    const current = equipped(bot, destination);
    const preferred = destination === 'feet' ? preferredBoots(bot) : null;
    if (names.includes(current?.name) && durable(bot.registry, current) && (!preferred || current.name === preferred)) continue;
    const carried = (preferred && carriedEquipment(bot).find(item => item.name === preferred)) ||
      carriedEquipment(bot).filter(item => names.includes(item.name)).sort((a, b) => names.indexOf(b.name) - names.indexOf(a.name))[0];
    if (!carried && waiting(destination)) { short = true; continue; }
    // The hand holds the tool of the work in hand: a sword carried is ready,
    // the fight takes it up (combat.js defendNearby). Put in the hand each
    // pass, it swapped with the tunnel's pickaxe and back, and mid-227-g's
    // staircase turned between the two until the flip watch ended it
    // (2026-09-27).
    if (destination === 'hand' && carried) continue;
    if (!carried) { missing.push(destination); continue; }
    await bot.equip(carried, destination);
    task.check();
    if (equipped(bot, destination)?.name !== carried.name) throw new Error(`Server did not confirm ${carried.name} equipped in ${destination}`);
    goal.step = { action: 'equip_combat', item: carried.name, destination }; save();
  }
  if (missing.length) return kitChoice(bot, task, goal, save, actions, missing, { client, mob });
  // Going without what waits is Jev's choice made: the crossing goes on.
  return short ? true : kitReady(bot);
}

// What the missing pieces take, planned from the pockets as they are: the
// pieces that can be made where the bot stands (golden boots from the
// Nether's gold, in place of iron), and those whose ore is in another
// dimension. Two plans at most, not one a piece: a plan of iron pieces in
// the Nether is some seventy milliseconds each on the event loop.
function kitPieces(bot, missing) {
  const { planOutputs, elsewhereOf } = require('./knowledge');
  const inventory = {};
  for (const i of bot.inventory.items()) inventory[i.name] = (inventory[i.name] || 0) + i.count;
  const where = bot.game?.dimension, equipment = carriedEquipment(bot).map(i => i.name);
  const plan = items => planOutputs(bot.registry, items.map(item => ({ item, count: countOf(bot, item) + 1 })), inventory, { dimension: where, equipment, reserveOutputs: false }).steps;
  const gold = () => { try { return !elsewhereOf(plan(['golden_boots']), where); } catch (_) { return false; } };
  const pieces = missing.map(destination => ({ destination, item: destination === 'feet' && dimension(bot) === 'nether' && gold() ? 'golden_boots' : combatGear[destination][0] }));
  let steps;
  try { steps = plan(pieces.map(p => p.item)); } catch (_) { return { here: [], away: [], unplanned: pieces }; }
  const awayWhere = elsewhereOf(steps, where, pieces.map(p => ({ item: p.item, count: 1 })));
  const bring = new Set((awayWhere?.bring || []).map(i => i.item));
  const here = pieces.filter(p => !bring.has(p.item)), away = pieces.filter(p => bring.has(p.item));
  let hereSteps = away.length ? null : steps;
  if (here.length && away.length) { try { hereSteps = plan(here.map(p => p.item)); } catch (_) { hereSteps = null; } }
  const iron = s => (s || []).filter(st => st.action === 'craft').reduce((n, st) => n + (st.consumes?.iron_ingot || 0), 0);
  return { here: hereSteps ? here : [], away, unplanned: hereSteps ? [] : here, hereSteps, hereIron: iron(hereSteps), awayIron: iron(steps) - iron(hereSteps), awayWhere };
}
const words = s => String(s || '').replaceAll('_', ' ');
const Dimension = d => d ? `${d[0].toUpperCase()}${d.slice(1)}` : d;
const listed = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '';
// One fight with what is carried, against the mob hunted: the estimate the
// hunt's own question gives (combat-estimate.js).
function carriedFightSays(bot, mob) {
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
  const weapon = defenseWeapon(bot)?.name || null, shield = bot.inventory.slots?.[45]?.name === 'shield';
  const { armourOf } = require('./combat-estimate');
  let fight = '';
  if (mob) {
    try {
      const one = fightEstimate({ threats: [{ name: mob, distance: 8, shoots: SHOOTERS.has(mob), visible: true }], armour: worn, weapon, health: bot.health ?? 20, shield });
      if (one.mobs[0]) fight = ` One ${words(mob)} fought so: about ${Math.round(one.fightHere.seconds)} seconds, ${Math.round(one.fightHere.damageTaken * 10) / 10} health lost, ${Math.round(one.fightHere.healthAfter * 10) / 10} of ${Math.round(bot.health ?? 20)} left${one.mobs[0].note ? ` (${one.mobs[0].note})` : ''}.`;
    } catch (_) { fight = ''; }
  }
  return `${weapon ? `a ${words(weapon)}` : 'no sword or axe (a fist)'}, ${worn.length ? worn.map(words).join(', ') : 'no armour'} worn (${armourOf(worn).points} armour points)${shield ? ', a shield' : ', no shield'}.${fight}`;
}

// The kit for a fight is offered, not required: going on with what is
// carried, making what can be made here, or the trip to where its iron is.
// Required, the planner sent a Nether blaze hunt with a stone sword after
// iron ore, and mid-227-r-nether-1 spun on "No iron ore in the nether" for
// twenty-five minutes, then died (note 476). The answer holds ten minutes
// while the same pieces are missing in the same dimension, and is not
// planned again meanwhile.
const KIT_CHOICE_HOLD_MS = 10 * 60000;
async function kitChoice(bot, task, goal, save, actions, missing, { client, mob, now = Date.now() } = {}) {
  // Held while in the same dimension with no piece newly missing: a piece
  // made is the choice carried out, not a new question.
  const sig = dimension(bot), was = goal.combatKit;
  const held = was?.sig === sig && now - was.at < KIT_CHOICE_HOLD_MS && missing.every(d => was.missing?.includes(d)) ? was : null;
  const still = list => (list || []).filter(p => missing.includes(p.destination));
  let pick = held && (held.pick !== 'make_kit_here' || still(held.here).length) ? held.pick : null, here = still(held?.here), away = still(held?.away);
  if (!pick) {
    const k = kitPieces(bot, missing);
    ({ here, away } = k);
    const all = [...k.here, ...k.away, ...k.unplanned].map(p => words(p.item));
    const carriedIron = countOf(bot, 'iron_ingot');
    const tree = {
      fight_with_carried: { description: `Go on with what is carried: ${carriedFightSays(bot, mob)} Without ${listed(all)} for now; the pieces are left for half an hour, then offered again.` },
    };
    if (here.length) tree.make_kit_here = { description: `Make ${listed(here.map(p => words(p.item)))} here first${k.hereIron ? `: ${k.hereIron} iron ingots, ${carriedIron} carried` : ''}. It takes: ${k.hereSteps.map(s => `${words(s.action)} ${s.count || 1} ${words(s.item || s.block || s.entity)}`).join(', ')}.${away.length ? ` The rest (${listed(away.map(p => words(p.item)))}) cannot be made in the ${Dimension(dimension(bot))}.` : ''}` };
    if (away.length && k.awayWhere?.dimension === 'overworld' && dimension(bot) !== 'overworld' && actions.returnOverworld) {
      const ores = Object.entries(k.awayWhere.mines).map(([block, n]) => `${n} ${words(block)}`);
      tree.return_for_kit = { description: `Go back to the Overworld for ${listed(away.map(p => words(p.item)))}: ${k.awayIron} iron ingots${carriedIron ? ` (${carriedIron} carried)` : ''}, from ${listed(ores)} mined there, smelted and crafted; there is none in the ${Dimension(dimension(bot))}. ${require('./game-progress').portalTrip(bot, goal)} The hunt waits until the kit is made and the bot is back.` };
    }
    // One route only (nothing can be made here, and no way back is at
    // hand): there is nothing to choose between.
    if (Object.keys(tree).length === 1) pick = 'fight_with_carried';
    else {
      // The old order, for the tests' stand-in only (note 707).
      const oldOrder = tree.make_kit_here ? 'make_kit_here' : tree.return_for_kit ? 'return_for_kit' : 'fight_with_carried';
      const decision = await decide('combat_kit', { client, bot, task, goal, save, tree, context: { oldOrder },
        state: { missing: all, carried: carriedFightSays(bot, mob), ...(mob ? { against: mob } : {}), dimension: dimension(bot), health: bot.health, hunger: bot.food, ironIngotsCarried: carriedIron } });
      if (decision.stale) return false;
      pick = decision.path.at(-1);
    }
    goal.combatKit = { pick, sig, missing, at: now, here, away }; save();
  }
  if (pick === 'fight_with_carried') {
    for (const destination of missing) setAside(goal, 'rung', PIECE_RUNG[destination][0], 'Jev chose to fight with what is carried', 1800000);
    delete goal.combatKit; save();
    return true;
  }
  if (pick === 'return_for_kit') {
    goal.errand = { dimension: 'overworld', items: away.map(p => ({ item: p.item, count: countOf(bot, p.item) + 1 })), for: 'the combat kit', at: now };
    goal.step = { action: 'return_for_kit', pieces: away.map(p => p.item) }; save();
    await actions.returnOverworld(bot, task, goal, save);
    return false;
  }
  const piece = here[0];
  goal.step = { action: 'prepare_combat_equipment', destination: piece.destination, item: piece.item }; save();
  // Worn equipment is still physically present; require an additional
  // item rather than accepting that worn stack as its own replacement.
  await actions.acquireStep(bot, task, piece.item, countOf(bot, piece.item) + 1, goal, save);
  return false;
}


function combatMovement(bot) {
  const movements = bot.pathfinder.movements;
  const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers,
    allowParkour: movements.allowParkour, allowedPosition: movements.allowedPosition, scafoldingBlocks: movements.scafoldingBlocks };
  const allowed = p => dryBodySpace(bot, p) && !damagingTerrain.has(bot.blockAt(supportCell(p))?.name) &&
    (!previous.allowedPosition || previous.allowedPosition(p));
  Object.assign(movements, { canDig: false, allow1by1towers: false, allowParkour: false, scafoldingBlocks: [], allowedPosition: allowed });
  return { allowed, restore: () => Object.assign(movements, previous) };
}

function isolated(bot, target, handler = handlers[target.name] || {}) {
  // Blazes come off a spawner two and three at a time: another of the
  // hunted kind blocks the fight only when it is close to the bot itself,
  // or no blaze in a fortress would ever be fought. A mob of another kind
  // is given more room, a shooter most of all.
  // Six blazes stood over a spawner with the bot seven blocks off and none
  // was ever "isolated". Kin out of sight cannot shoot; up to two more in
  // view is a fight, three is a swarm.
  const others = threats(bot).filter(t => t.entity !== target);
  const kinInView = others.filter(t => t.entity.name === target.name && t.visible && t.distance < 8).length;
  // A hoglin twelve blocks off is not a reason to leave a blaze alone. The
  // crimson forest above a fortress is full of them, and at twelve blocks
  // every blaze in the spawner room was "not isolated" and none was ever
  // fought. Something that shoots still gets a wide berth.
  // Three of the hunted kind in view was "too many" whatever the bot's
  // condition, and a spawner keeps eleven in the air: the live run stood
  // level with them at full health for half an hour and never opened a
  // fight. In the arena a swarm fought in the open at full health came
  // home with rods; watched, it came home with nothing. The crowd stops a
  // fight only once the bot is already hurt; whole, the nearest one is a
  // fight like any other.
  const crowd = (kinInView >= 3 && (bot.health ?? 20) < 16) || others.some(t => t.entity.name !== target.name &&
    (t.distance < (shooter(t.entity) ? 16 : 8) || t.entity.position.distanceTo(target.position) < 6));
  if (crowd) return false;
  // A sword sweep must not hit a nearby player or provoke another mob. A
  // flock of chickens is not a crowd of mobs: a passive animal only needs
  // the hostiles kept away.
  // Another of the same kind is the crowd rule's business above: counted
  // here as well, every blaze beside another at a spawner was "not
  // isolated", and there is no other kind of blaze at a spawner.
  return handler.passive || !Object.values(bot.entities).some(e => e !== target && e !== bot.entity && e.name !== target.name && valid(bot, e) &&
    e.position && bot.registry.entitiesByName[e.name]?.metadataKeys?.includes('health') && e.position.distanceTo(target.position) < 4);
}

// A passive animal is a chase with whatever is carried, not an encounter:
// no armour, no shield and a lower health floor. Mobs that fight back keep
// the full kit and near-full health.
function canBegin(bot, handler = {}) {
  // Not from a one-wide span over a drop (terrain.js onSpan): a fight there
  // is swings and turns where a step the wrong way is the fall (note 273).
  const standing = bot.game.gameMode === 'survival' && bot.game.difficulty !== 'peaceful' &&
    bot.oxygenLevel > 12 && dryStanding(bot, bot.entity.position) && !onSpan(bot);
  // Burning is the normal state of a blaze fight: the fireball that lights
  // the bot is thrown by the thing it came to kill, and there is no water
  // in the Nether to put it out. Refusing to fight while alight meant
  // standing in the open on fire being shot by the blaze, over and over,
  // which is the whole reason two blazes cost thirty health where one costs
  // a single point. Fire ends a fight only when the fight is already lost.
  const burning = !!(bot.entity.metadata?.[0] & 1);
  if (handler.passive) return standing && !burning && bot.health >= 10 && bot.food >= 6;
  // The health, hunger, food and kit the fight used to be gated on are
  // facts on Jev's choice now (fitness, below): the gate was a hidden rule,
  // and mid-227-m stalked blazes at 11.9 health, was lit by a fireball and
  // burned from 6.4 to none with no water in the Nether to put it out (note
  // 392, 2026-09-27). What stays here is the footing: a fight is swings and
  // turns, and that needs ground to stand on.
  return standing;
}

// What the hunt once refused a fight for, as facts: health against the
// fourteen the code required (eighteen was a bar the Nether could not meet
// once the food ran out); hunger, since health comes back only at eighteen
// or more and a bot at fifteen health and seventeen hunger with nothing to
// eat once took on a spawner and lost every point for good; whether food is
// carried; fire, which in the Nether nothing but waiting puts out; and the
// kit, the armour that has to be on (the hand is whatever the last action
// needed: requiring a sword in hand made drawing the bow a reason not to
// swing, and two blazes shot the bot through five rounds of that).
function fitness(bot) {
  const health = Math.round((bot.health ?? 20) * 10) / 10, food = bot.food ?? 20;
  const burning = !!(bot.entity?.metadata?.[0] & 1);
  const kitMissing = Object.entries(combatGear).filter(([destination, names]) => destination === 'hand'
    ? !carriedEquipment(bot).some(item => names.includes(item.name))
    : !(names.includes(equipped(bot, destination)?.name) && durable(bot.registry, equipped(bot, destination)))).map(([d]) => d);
  const foodCarried = hasFood(bot);
  return { health, food, floor: HUNT_FLOOR, healing: food >= 18, foodCarried, burning, kitMissing,
    // The kit is Jev's choice (combat_kit, note 480), said here as a fact,
    // not a condition health can meet: mid-227-r-nether-4 sat in "recover
    // before combat" at twenty health and nineteen food, waiting on iron no
    // rest would bring (note 508).
    fit: health >= HUNT_FLOOR && food >= HUNT_FLOOR && (food >= 18 || foodCarried) && !(burning && health < 10) };
}
const KIT_WORDS = { head: 'iron or better helmet worn', torso: 'iron or better chestplate worn', legs: 'iron or better leggings worn', feet: 'iron, diamond, netherite or golden boots worn', 'off-hand': 'shield in the off hand' };
function fitnessSays(bot, f = fitness(bot)) {
  const parts = [`Health ${f.health}${f.health < f.floor ? ` (under the ${f.floor} the code once required to start a fight)` : ''}`,
    `hunger ${f.food}: ${f.healing ? 'health comes back while it stays at eighteen or more' : `health does not come back under eighteen${f.foodCarried ? ', and food is carried to eat first' : ', and nothing is carried to eat: every point lost is gone for good'}`}`];
  if (f.burning) parts.push(`alight now: fire takes half a heart a second${dimension(bot) === 'nether' ? `, and in the Nether there is no water to put it out${(() => { try { const items = bot.inventory.items(); return (items.some(i => i.name === 'cauldron') && items.some(i => i.name === 'water_bucket')) || require('./fire-resistance').carried(bot).length > 0; } catch (_) { return false; } })() ? ': a cauldron of water or a fire resistance potion carried can, and otherwise only waiting burns it off' : '; only waiting burns it off'}` : ''}`);
  // Each piece by what the kit asks of it, iron or better (mob-policy
  // combatGear): "no sword or axe carried" was said of a bot with a stone
  // sword in hand, beside a fight option that struck with it (note 614).
  if (f.kitMissing.length) {
    const held = (w => /_(sword|axe)$/.test(w || '') ? w.replaceAll('_', ' ') : null)(defenseWeapon(bot)?.name);
    parts.push(`the kit is short: no ${f.kitMissing.map(d => d === 'hand' ? `iron or better sword carried${held ? ` (${/^[aeiou]/.test(held) ? 'an' : 'a'} ${held} is)` : ''}` : KIT_WORDS[d] || `${d} armour worn`).join(', no ')}`);
  }
  return `${parts.join('; ')}.`;
}

// A blaze hovers, so there is no standing room within two blocks of it: the
// route check refused every fight, the survival layer sealed the bot in
// instead, and three arena runs ended with no swing and no rod. The ground
// under it is reachable and a sword reaches three blocks, so standing
// beneath and swinging up is the second thing to try.
function approaches(bot, target) {
  const t = target.position, y = Math.round(bot.entity.position.y);
  const under = new goals.GoalNear(Math.floor(t.x), y, Math.floor(t.z), 1);
  const level = new goals.GoalNear(Math.floor(t.x), Math.round(t.y), Math.floor(t.z), 2);
  // Following a thing that is flying means towering up to it, and a tower
  // is a place to fall off. The one death in forty-five arena runs was not
  // a mob at all: the bot killed its blaze from the top of a pillar and
  // dropped twenty health's worth of blocks. Something overhead is reached
  // by standing under it.
  // Standing under it only where the sword reaches up to it; from farther
  // below, up to its floor by the ground there is (stairs, a slope; the
  // combat movement builds no tower). mid-83-j sat six blocks under nine
  // blazes, offered only the cell beneath them at its own level, and every
  // hunt ended "No dry combat route" (2026-09-26).
  const near = new goals.GoalNear(Math.floor(t.x), Math.round(t.y) - 1, Math.floor(t.z), 3);
  if (t.y > bot.entity.position.y + 1.5) return t.y - bot.entity.position.y <= 4 ? [under, near] : [near, under];
  // Something below is reached by going down to it. Standing on a fortress
  // roof, the only goal offered was a point at the bot's own height, which
  // it was already standing on: the route "succeeded" without moving, so
  // the fight never started and the live run watched blazes through the
  // floor for an hour.
  if (t.y < bot.entity.position.y - 1.5) return [level, under];
  return [new goals.GoalFollow(target, 2), under];
}
// `movement` is the combat movement policy, whose `allowed` vets each step;
// the survey itself runs on the pathfinder's own movements. Passing one for
// the other threw "undefined is not a function" in the middle of a fight.
// Not to footing a blaze's fireball pushes the bot off: under a blaze
// over a fortress bridge is the lava's edge, and a fireball that lands
// pushes about two blocks (combat-estimate FIREBALL). mid-235-p-fortress-1
// was thrown off an edge at 5.5 health (note 509). Such a blaze is fought
// from a stand instead (blaze-stand.js), offered beside it.
function pushedOff(bot, target, route) {
  if (target.name !== 'blaze') return false;
  const last = route.path?.at(-1), end = last ? new Vec3(Math.floor(last.x), Math.floor(last.y), Math.floor(last.z)) : bot.entity.position.floored();
  const { FIREBALL } = require('./combat-estimate');
  const drop = dropNear(bot, end, FIREBALL.knock);
  return (!!drop && (drop.into === 'lava' || drop.damage >= (bot.health ?? 20) / 2)) || require('./blaze-stand').lavaWithin(bot, end);
}
async function combatRoute(bot, task, target, movement, timeoutMs = 400, { pushed = null } = {}) {
  // A blaze: the one reachability every attack on it reads (blaze-stand.js
  // blazeReach, note 774), and the walk goes to the cell it names. The
  // pathfinder's survey here and the strike cells close_in and
  // charge_nearest read disagreed: 25584 was offered hunt_10566 "in the
  // open" walled in by its own blocks, and this survey answered "No dry
  // combat route" to the fight three seconds later.
  if (target.name === 'blaze') {
    const stand = require('./blaze-stand');
    const reach = stand.blazeReach(bot, target);
    if (reach) return { route: null, destination: new goals.GoalBlock(reach.cell.x, reach.cell.y, reach.cell.z), reach };
    if (pushed && stand.pushedOnly(bot, target)) pushed.push(target);
    return null;
  }
  for (const destination of approaches(bot, target)) {
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, timeoutMs);
    if (route.status !== 'success' || !route.path.every(movement.allowed)) continue;
    if (pushedOff(bot, target, route)) { if (pushed) pushed.push(target); continue; }
    return { route, destination };
  }
  return null;
}

// The route exception names one live entity and expires with this action.
// Other mobs, liquid, cliffs, cancellations and low health still interrupt it.
function encounter(bot, task, target, expiresAt) {
  const previous = bot._combatEncounter;
  bot._combatEncounter = { task, target, dimension: bot.game.dimension, expiresAt };
  return () => { bot._combatEncounter = previous; };
}

async function fightForDrop(bot, task, target, goal, save, actions, { timeoutMs = 30000, pickupWaitMs = 2500 } = {}) {
  task.check(); checkAir(bot);
  const state = goal.mobHunt, handler = handlers[target.name];
  if (!handler || handler.item !== state?.item || !valid(bot, target) || !canBegin(bot, handler) || !isolated(bot, target, handler)) throw new Error('Mob encounter is no longer feasible');
  const before = countOf(bot, state.item), start = bot.entity.position.clone(), deadline = Date.now() + timeoutMs;
  const shieldWear = () => equipped(bot, 'off-hand')?.durabilityUsed || 0;
  const initialShieldWear = shieldWear(), guarded = !handler.passive && equipped(bot, 'off-hand')?.name === 'shield';
  const ready = () => handler.passive ? bot.health >= 8 && bot.food >= 4 : bot.health >= 12 && bot.food >= 12 && kitReady(bot);
  const sword = () => carriedEquipment(bot).find(item => combatGear.hand.includes(item.name));
  const restoreEncounter = encounter(bot, task, target, deadline), movement = combatMovement(bot);
  const previousInterrupt = task.interruptCheck;
  let dead = false, attacks = 0, shield = false, shots = 0, failedShots = 0;
  const onDeath = entity => {
    if (entity === target) { dead = true; bot._defeatedMobs ||= new WeakSet(); bot._defeatedMobs.add(entity); }
  };
  bot.on('entityDead', onDeath);
  // The hunt's claim on the kind, renewed for as long as the fight runs:
  // staked for five seconds by the hunt's tick, it lapsed during the walk
  // to the target, and mid-83-j's fights under the spawner ended "Threat
  // nearby: blaze at 5 blocks" five seconds in, every one (2026-09-26).
  const claim = () => { if (!handler.passive) bot._huntingEntity = { name: target.name, until: Date.now() + 5000 }; };
  claim();
  task.interruptCheck = () => {
    claim();
    previousInterrupt?.(); checkAir(bot);
    try { checkThreats(bot); }
    catch (err) {
      // Which mob ended the fight, and why it was not the fight's own kin
      // (the diagnosis of mid-83-j's five-second fights, 2026-09-26).
      if (err.name === 'NeedsSafety') {
        const { immediateThreat, hunted } = require('./danger');
        const t = immediateThreat(bot);
        if (t) console.log(`[fight] ${target.name} fight ended by ${t.entity.name} ${t.entity.id} at ${t.distance.toFixed(2)} (visible ${t.visible}, hunted ${hunted(bot, t.entity)}, encounter ${bot._combatEncounter?.target?.name}/${Math.round(((bot._combatEncounter?.expiresAt || 0) - Date.now()) / 1000)}s, dim ${bot._combatEncounter?.dimension}/${bot.game?.dimension})`);
      }
      throw err;
    }
    if (!ready() || !isolated(bot, target, handler)) throw new NeedsSafety({ entity: target, distance: target.position.distanceTo(bot.entity.position) });
    if (Date.now() >= deadline) throw new Error(`Timed out fighting ${target.name} after ${Math.round(timeoutMs / 1000)} seconds`);
    if (bot.entity.position.distanceTo(start) > 48) throw new Error(`${target.name} moved beyond the bounded combat area`);
  };
  const guard = () => task.check();
  const lowerShield = () => { if (shield) { bot.deactivateItem(); shield = false; } };
  try {
    // The kit's sword is already in hand for a mob that fights back; a
    // passive animal is struck with the best thing carried, or bare hands.
    if (handler.passive) {
      const weapon = defenseWeapon(bot);
      if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
      guard();
    }
    while (valid(bot, target) && !dead) {
      guard();
      // Carried onto a one-wide span over a drop in the fight: no swing, no
      // shot and no turn from there (terrain.js onSpan). The fight ends and
      // the survival layer holds the bot still, crouched.
      if (onSpan(bot)) throw new NeedsSafety({ entity: target, distance: target.position.distanceTo(bot.entity.position) });
      // A blaze's volley is seen coming by its glow, three seconds ahead:
      // the shield is up and facing it for the shots, and down between
      // (blaze-stand.js shieldVolley).
      // And the flames they light at the bot's feet are put out with a punch.
      if (target.name === 'blaze' && (await require('./blaze-stand').putOutFlames(bot, task) ||
        await require('./blaze-stand').shieldVolley(bot, task, { toward: target.position }))) continue;
      // A fireball in the air outranks everything else for half a second.
      if (!canStrike(bot, target) && await deflect(bot, task)) continue;
      if (!canStrike(bot, target)) {
        lowerShield();
        // A blaze shoots. Answer from range with the bow while it is in clear
        // view and an arrow can reach it; close to the sword when none can,
        // or after three draws that could not be released.
        const range = target.position.distanceTo(bot.entity.position);
        if (handler.ranged && failedShots < 3 && range >= 4 && range <= 20 && bowReady(bot) && aimAtEntity(bot, target)) {
          try {
            await shoot(bot, task, target, { cover: false }); shots++;
            goal.step = { action: 'hunt_mob', entity: target.name, entityId: target.id, item: state.item, attacks, shots, health: bot.health }; save();
          } catch (err) {
            task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
            failedShots++;
          }
          continue;
        }
        const approach = await combatRoute(bot, task, target, movement);
        if (!approach) throw new Error(`No dry combat route to ${target.name}`);
        // Struck from where it stands (note 774c): no walk to its own cell.
        if (approach.reach && approach.reach.steps === 0) { await bot.lookAt(target.position.offset(0, 0.9, 0), true); await sleep(150); continue; }
        const destination = approach.destination;
        const volley = target.name === 'blaze' ? () => require('./blaze-stand').volleyComing(bot) : () => false;
        await actions.navigate(bot, task, destination, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
          stopWhen: () => dead || !valid(bot, target) || canStrike(bot, target) || volley() });
        continue;
      }
      bot.pathfinder.setGoal(null); bot.clearControlStates();
      // Back to the sword after the bow.
      if (shots && !combatGear.hand.includes(bot.heldItem?.name) && sword()) { await bot.equip(sword(), 'hand'); guard(); }
      await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
      guard();
      if (!valid(bot, target) || dead || !canStrike(bot, target)) continue;
      lowerShield();
      if (target.name === 'enderman') {
        bot._provokedMobs ||= new Map();
        bot._provokedMobs.set(target.id, target);
        if (bot._provokedMobs.size > 64) bot._provokedMobs.delete(bot._provokedMobs.keys().next().value);
      }
      const swing = await strike(bot, task, target); if (swing !== 'missed') attacks++;
      goal.step = { action: 'hunt_mob', entity: target.name, entityId: target.id, item: state.item, attacks, swing, health: bot.health }; save();
      const wearBefore = shieldWear(), swungAt = Date.now();
      if (!guarded) {
        // Nothing to block: wait out the swing cooldown, keep facing the animal.
        while (Date.now() < Math.min(deadline, swungAt + 600) && valid(bot, target) && !dead) {
          await sleep(50); guard();
          await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
        }
        continue;
      }
      bot.activateItem(true); shield = true;
      // Raising a shield has a startup delay. Blindly lowering it every 700 ms
      // repeatedly exposed Jev exactly when an Enderman swung. Keep facing the
      // target, then use observed shield wear as evidence of a blocked hit;
      // the following sword swing fits inside the mob's attack cooldown.
      const guardUntil = Math.min(deadline, swungAt + 1500);
      while (Date.now() < guardUntil && valid(bot, target) && !dead) {
        await sleep(50); guard();
        if (Date.now() - swungAt >= 700 && shieldWear() > wearBefore) break;
        await bot.lookAt(target.position.offset(0, Math.min((target.height || 1.8) / 2, 1.5), 0), true);
      }
    }
    lowerShield();
    // Entity removal can mean teleport/unload. Record it separately from death
    // and never infer a drop from either event.
    const pickupDeadline = Math.min(deadline, Date.now() + pickupWaitMs);
    const unreachableDrops = new Set();
    do {
      await sleep(100); guard();
      const drops = Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === state.item && e.position.distanceTo(target.position) < 8);
      for (const drop of drops.slice(0, 4)) {
        if (countOf(bot, state.item) > before) break;
        guard();
        const p = drop.position.floored(), key = `${drop.id}:${p}`, destination = new goals.GoalNear(p.x, p.y, p.z, 1);
        // A drop still falling from a flying mob has no standing position yet.
        // Reobserve it during the bounded pickup window instead of declaring
        // no loot from one early snapshot.
        if (!dryStanding(bot, p) || unreachableDrops.has(key)) continue;
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 300);
        if (route.status !== 'success' || !route.path.every(movement.allowed)) { unreachableDrops.add(key); continue; }
        await actions.navigate(bot, task, destination, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
          stopWhen: () => countOf(bot, state.item) > before });
        for (let i = 0; i < 10 && countOf(bot, state.item) <= before; i++) { await sleep(50); guard(); }
      }
    } while (countOf(bot, state.item) <= before && Date.now() < pickupDeadline);
    const pickedUp = Math.max(0, countOf(bot, state.item) - before);
    const result = { at: new Date().toISOString(), entity: target.name, entityId: target.id, item: state.item,
      deathObserved: dead, attacks, shots, pickedUp, shieldWear: Math.max(0, shieldWear() - initialShieldWear),
      health: bot.health, outcome: pickedUp ? 'pickup_confirmed' : dead ? 'no_pickup' : 'target_lost' };
    state.history = [...(state.history || []), result].slice(-40);
    state.encountersWithoutPickup = pickedUp ? 0 : (state.encountersWithoutPickup || 0) + 1;
    setAside(goal, 'hunt_target', target.uuid || target.id, result.outcome, 120000);
    if (pickedUp && goal.search?.[target.name]) goal.search[target.name] = { attempts: 0, origin: { ...bot.entity.position.floored() } };
    bot.emit('mob_hunt', result); save();
    if (!dead && !pickedUp) throw new Error(`${target.name} disappeared without a confirmed drop`);
    if (state.encountersWithoutPickup >= 64) throw blocked(`No ${state.item} pickup in 64 encounters; progress saved`);
    return result;
  } finally {
    lowerShield(); bot.pathfinder.setGoal(null); bot.clearControlStates();
    // The next candidate check wants the sword in hand, not the bow.
    if (shots && !combatGear.hand.includes(bot.heldItem?.name) && sword()) await bot.equip(sword(), 'hand').catch(() => {});
    bot.removeListener('entityDead', onDeath); movement.restore(); restoreEncounter();
    task.interruptCheck = previousInterrupt;
    if (dead) bot._provokedMobs?.delete(target.id);
  }
}

// The hunt's claim on this kind of mob, renewed on every tick it is live.
// It has to be staked first in the loop: staking it where the fight runs
// was useless, because the survival layer sealed the bot in before that
// code was ever reached, so the claim was never made and the blazes stayed
// an emergency. Chicken, egg. The live arbiter stakes it before the claims
// are read, whoever then gets the turn.
// The count a hunt ends at: the ladder's own number for its blaze hunt
// (blaze-stand.js rodsTarget, from eye-need.js), else the hunt's own.
const huntTarget = (bot, goal) => goal.mobHunt?.entity === 'blaze' ? require('./blaze-stand').rodsTarget(bot, goal) : goal.mobHunt?.targetCount;
const ladderRods = goal => goal.kind === 'win' && goal.gameProgress?.phase === 'obtain_blaze_rods';
// What the goal wants in rods against what is carried, one sentence, on the
// fortress questions (eye-need.js): the search is for these and no more.
const rodsFact = (bot, goal, opts = { brief: true }) => ladderRods(goal) ? { rodsTheGoalWants: require('./eye-need').says(bot, goal, opts) } : {};
function stakeHunt(bot, goal) {
  const state = goal?.mobHunt;
  if (!state || countOf(bot, state.item) >= huntTarget(bot, goal)) return false;
  bot._huntingEntity = { name: state.entity, until: Date.now() + 5000 };
  return true;
}

async function huntObserved(bot, task, goal, save, actions, client) {
  const state = goal.mobHunt;
  if (!state) return false;
  if (countOf(bot, state.item) >= huntTarget(bot, goal)) { delete goal.mobHunt; save(); return false; }
  // Not while the rods are being banked (rod-bank.js, note 760).
  if (dimension(bot) === 'nether' && require('./rod-bank').pending(goal)) return false;
  const handler = handlers[state.entity] || {};
  stakeHunt(bot, goal);
  if (!canBegin(bot, handler)) return false;
  // Hungry off the Overworld with nothing to eat: prepareMobHunt's own
  // fitness gate reaches foodLeave (the tested leave_nether question:
  // go_back, keep_on, restock_food) before a fight begins, but this call
  // path (the live arbiter's hunt claim, note 672) had no way to it at
  // all, so a hunt observed here fell straight to fortress_visit's
  // thinner food branch or another box built to wait out a hunger that
  // never comes back (note 741, 25584: sealed at 6.4 health, hunger 15,
  // no food, 181 blocks from its portal, for over five minutes with the
  // trip never once asked). Asked here the same way, before anything
  // else, and held off for the twenty minutes keep_on or restock_food buys
  // (isSetAside, as prepareMobHunt's own gate already honours).
  if (dimension(bot) === 'nether' && bot.food < 18 && !hasFood(bot) && actions.returnOverworld && !isSetAside(goal, 'nether_return', 'food')) {
    const { netherLeaveHeld } = require('./game-progress');
    const foodActionsHere = { ...actions, client: actions.client || client };
    const pick = netherLeaveHeld(goal, 'food') && !tripHomeClosed(bot, goal) ? 'go_back' : await foodLeave(bot, task, goal, save, foodActionsHere);
    if (pick === null) return false;
    if (pick === 'go_back') {
      goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
      await actions.returnOverworld(bot, task, goal, save); return true;
    }
    // keep_on or restock_food already ran, or a trip home held is closed
    // from here (tripHomeClosed): the hunt goes on, as prepareMobHunt's
    // own gate lets it once keepOn holds.
  }
  // The cage's plan held in its box (cage-hold.js, note 774): the hunt runs
  // its hold, not hunt_target asked over it. 25584's hunt asked hunt_target
  // at its box six times in ten minutes, box_here, defer and a fight "in the
  // open" from inside the walls among them.
  if (state.entity === 'blaze') {
    let held = null;
    try { held = require('./cage-hold').holding(bot, goal); } catch (_) { held = null; }
    if (held && await require('./empty-spawner').holdPlan(bot, task, goal, save, actions, held)) return true;
  }
  const candidates = Object.values(bot.entities).filter(e => e.name === state.entity && valid(bot, e) &&
    e.position.distanceTo(bot.entity.position) < 24 && isolated(bot, e, handler) &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  // A blaze hunt about to go at blazes none of which sees the bot yet is a
  // visit beginning (note 638); with one in sight the fight is on, and the
  // stances are asked. A fresh visit is not asked at a live spawner already
  // known and still owed rods (cage-hold.js cageFight): the bot is already
  // at the fortress there, mid-fight, not approaching one (note 731, 25588:
  // fortress_visit asked "Healing before going into the fortress" 17
  // minutes into a fight at that very spawner's cage). An answer already
  // held from before (food, a hoglin, leaving) is still read and honoured
  // either way: that is what carried it out last time doing nothing, not a
  // fresh approach (note 708).
  if (state.entity === 'blaze' && candidates.length && !(() => { try { return threats(bot, 48).some(t => t.entity.name === 'blaze' && t.visible); } catch (_) { return true; } })() &&
      (require('./fortress-visit').holdsOff(bot, goal) || !(() => { try { return require('./cage-hold').cageFight(bot, goal); } catch (_) { return false; } })())) {
    const visit = await require('./fortress-visit').ask(bot, task, goal, save, { ...actions, client: actions.client || client }, {});
    if (visit === null) return false;
    // A visit answer held from before (food, a hoglin, leaving) did its
    // work when chosen: this turn did nothing, and says so (note 708).
    if (visit === 'held') return false;
    if (visit !== 'go_in') return true;
  }
  const tree = {}, positions = new Map(), pushed = [];
  const footing = state.entity === 'blaze' ? require('./blaze-stand').knockSays(bot) : '';
  // What reaches the bot where it would fight: a shooter in sight within
  // its own reach (a blaze's forty-eight), anything else within sixteen.
  const { RANGE } = require('./combat-estimate');
  const reaching = (() => { try { return threats(bot, 64).filter(t => shooter(t.entity) ? t.visible && t.distance <= (RANGE[t.entity.name] || 16) : t.distance <= 16); } catch (_) { return []; } })();
  const cage = state.entity === 'blaze' ? require('./blaze-stand').spawnerAt(bot) : null;
  // What each option gains toward the rods (note 614): mid-242-aa-fortress-5
  // deferred single blazes at full health twice, told what each fight cost
  // and nothing of what leaving them gains, which is nothing.
  const rodsNeed = state.entity === 'blaze' ? require('./blaze-stand').rodsNeeded(bot, goal) : 0;
  const { towardRods } = require('./blaze-stand');
  const rodsOf = state.entity === 'blaze' ? require('./blaze-stand').rodsOf(bot, goal) : '';
  const liveCage = !!cage && cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) <= 16;
  const spawnerSays = cage ? ` A blaze spawner is ${Math.round(cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position))} blocks off: while the bot is within sixteen of it, it makes up to four more every ten to forty seconds.` : '';
  // The cage's own cap, said plainly on defer (note 731): capped, leaving
  // these costs nothing in fresh spawns while it stands; not capped, more
  // are coming whether the bot fights now or not.
  const capNow = liveCage ? (() => { try { return require('./spawner-clock').capSays(bot, cage); } catch (_) { return null; } })() : null;
  // How many times running defer was chosen against this same live spawner
  // with nothing come of it since: 25598 (note 731) deferred at 07:25:18
  // and again at 07:30:49, both against the one blaze it needed for its
  // last rod, each told nothing of the one before it.
  const deferStreak = liveCage ? goal.huntDeferStreak || 0 : 0;
  const deferStreakSays = deferStreak ? ` Chosen ${deferStreak} time${deferStreak === 1 ? '' : 's'} running against this cage: nothing has changed since, and the rods still needed are the same.` : '';
  // The ones with no way on foot to them from here, said: with every fight
  // left out and nothing said of why, defer read as the one answer to a
  // blaze come to the bot at its fortress (25590, mid-242-yc, 11:14:20Z:
  // box_here, leave_and_heal and defer, 3 rods owed; note 750).
  const unreached = [];
  // Walled in by its own blocks, every walk begins by digging them: said
  // with each blaze left unoffered for it (note 774).
  let walled;
  const walledSays = () => { if (walled === undefined) { try { walled = require('./walled-in').walledInSays(bot) ? ' (the bot is walled in by its own blocks; the walk counted is over open ground, no block dug)' : ''; } catch (_) { walled = ''; } } return walled; };
  for (const target of candidates.slice(0, 4)) {
    const restore = encounter(bot, task, target, Date.now() + 1500), movement = combatMovement(bot);
    try {
      // A blaze no walk reaches is still a fight with a bow in range (note
      // 774): offered as the bow's alone, said so below (bowOnly).
      const reached = canStrike(bot, target) || await combatRoute(bot, task, target, movement, 400, { pushed });
      const range = target.position.distanceTo(bot.entity.position);
      const bowOnly = !reached && handler.ranged && bowReady(bot) && range >= 4 && range <= 20 && !pushed.includes(target) &&
        !!(() => { try { return threats(bot, 24).find(t => t.entity === target)?.visible; } catch (_) { return false; } })();
      if (!reached && !bowOnly) {
        if (!pushed.includes(target)) { const d = target.position.distanceTo(bot.entity.position), dy = Math.round(target.position.y - bot.entity.position.y); unreached.push(`the ${target.name.replaceAll('_', ' ')} ${Math.round(d)} blocks off${Math.abs(dy) >= 2 ? `, ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}: no way on foot to within a sword's reach of it from here${walledSays()}, so no fight with it is offered; the ways that wait for it to come (a stand, a box) are`); }
        continue;
      }
      positions.set(target.id, target.position.clone());
      // What this one fight costs, and what is beside the mob (the decision
      // audit, 2026-09-25): a hoglin's toss or a blaze's knockback beside
      // lava or a drop is the fall, not the fight.
      const distance = target.position.distanceTo(bot.entity.position);
      const asThreat = (e, d) => ({ name: e.name, distance: d, shoots: shooter(e), ...(e.heldItem?.name ? { held: e.heldItem.name } : {}), visible: true });
      const kit = { armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean),
        weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' };
      const one = fightEstimate({ threats: [asThreat(target, distance)], ...kit });
      const mob = one.mobs[0];
      // The fight as it will be: the others that reach the bot where it
      // fights fight too. mid-235-p-nether-3 took a blaze at four blocks
      // told "5.9 damage, 14.2 health after" with another blaze seven off
      // and the spawner three away; four blazes' fire took it from twenty
      // to nine in five seconds, the stances beside it priced at 22 to 40
      // (note 533).
      const others = reaching.filter(t => t.entity !== target);
      const all = others.length ? fightEstimate({ threats: [asThreat(target, distance), ...others.slice(0, 7).map(t => asThreat(t.entity, t.distance))], ...kit }) : null;
      // A live spawner keeps making them: the fight is also priced with those
      // that come over its own seconds, counted at the cage (blaze-stand
      // spawnerNewcomers, note 631). The 2 blazes about at first sight were
      // the whole price of a fight in rooms that held 6 to 8 a minute later.
      const newcomers = (() => {
        const base = all || one;
        if (!liveCage || target.name !== 'blaze' || !base?.fightHere) return null;
        const cageAt = cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position);
        const present = 1 + others.filter(t => t.entity.name === 'blaze').length;
        let seconds = base.fightHere.seconds, n = 0, est = null;
        for (let i = 0; i < 3; i++) {
          n = Math.round(require('./blaze-stand').spawnerNewcomers(present, seconds));
          if (n < 1) return null;
          est = fightEstimate({ threats: [asThreat(target, distance), ...others.slice(0, 7).map(t => asThreat(t.entity, t.distance)), ...Array.from({ length: n }, () => asThreat({ name: 'blaze' }, cageAt))], ...kit });
          seconds = est.fightHere.seconds;
        }
        return { n, cageAt: Math.round(cageAt), fight: est.fightHere };
      })();
      const at = target.position.floored();
      const lavaNear = require('./survival').lavaBeside(bot, at), dropNear = dropWithin(bot, at, 3);
      const { UNPROVOKED } = require('./danger');
      const hitters = Object.values(bot.entities || {}).filter(e => Object.hasOwn(UNPROVOKED, e.name) && e.position && e.position.distanceTo(target.position) <= 6);
      // Said as a sentence, as every other option is: mid-208-k-nether-3-
      // fortress-2 was shown each blaze as a JSON record beside a worded
      // defer, and deferred four times in two minutes (note 557).
      // The one it goes at, by its own figures; the others' share is in the price.
      const gain = one?.fightHere ? { kills: 1, seconds: one.fightHere.seconds, dies: one.fightHere.healthAfter <= 0, all: true } : { kills: 1 };
      // What a box or a slit at the cage offers instead, said beside the
      // open fight, not left for Jev to find only by noticing the other
      // option in the same tree (note 731): the open fight takes every shot
      // that lands, a box or slit takes only what has a line through its
      // one opening.
      const coveredOffered = target.name === 'blaze' && liveCage && typeof bot.dig === 'function' ? ' A box or a slit built at the cage is offered too, alongside this: walled in but for one opening toward it, only a blaze in line with that opening sees the bot, where the open ground here gives every one of them a shot.' : '';
      const bowSays = bowOnly ? ` No walk reaches it within the sword's reach from here${walledSays()}: this fight is the bow's alone, shot from here while it is in view, and ends when three draws cannot be loosed or it goes out of the bow's twenty; the sword's figures above are what a kill would cost if it comes in.` : '';
      tree[`hunt_${target.id}`] = { description: huntSays(bot, target, { handler, distance, mob, one, all, others, spawnerSays, newcomers, lavaNear, dropNear, footing: target.name === 'blaze' ? footing : '', hitters, UNPROVOKED, item: state.item }) + bowSays + towardRods(rodsNeed, gain, { spawner: liveCage, of: rodsOf }) + coveredOffered,
        run: () => fightForDrop(bot, task, target, goal, save, actions) };
    } finally { movement.restore(); restore(); }
  }
  // Blazes are taken from a stand as well as in the open, as a player with
  // iron and no fire resistance takes them: a hole in the brick, the
  // spawner's cage under a ceiling, a wall at the back (blaze-stand.js).
  // Offered whenever one is in sight, alone or not: a spawner keeps several
  // in the air, and mid-235-p-fortress-4 was asked about one blaze at eight
  // blocks beside a drop, deferred, and spent the next twenty-two minutes
  // sealed in a pocket ten blocks from their spawner (2026-09-27).
  // Seen or heard: blazes twenty blocks off behind a wall come to the bot
  // once they see it, and a stand is where it meets them. mid-208-k-nether-
  // 3-fortress-2 had two at sixteen to twenty-four out of sight, was offered
  // only the fight in the open (13.4 damage to 6.6 health) or leaving them,
  // and left them four times (note 557).
  const blazesInSight = state.entity === 'blaze' ? threats(bot, 24).filter(t => t.entity.name === 'blaze') : [];
  if (blazesInSight.length && !isSetAside(goal, 'hunt_stand', 'blaze')) {
    const stands = require('./blaze-stand').blazeStands(bot, threats(bot, 24), { hunted: true, dig: typeof bot.dig === 'function', holds: state.standResults || [], need: rodsNeed, of: rodsOf, goal });
    for (const [key, o] of Object.entries(stands)) tree[key] = { description: o.description + footing, ...(o.expects ? { expects: o.expects } : {}), ...(o.judgeBy ? { judgeBy: o.judgeBy, seconds: require('./cage-hold').PLAN_MS / 1000, commit: require('./cage-hold').planCommit() } : {}), run: async () => {
      try { await require('./blaze-stand').huntFromStand(bot, task, goal, save, actions, { ...o, key }, { item: state.item, want: countOf(bot, state.item) + 1 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'hunt_stand', 'blaze', err.message, 120000); state.lastStandError = err.message; save(); }
    } };
  }
  // Twenty or more stacked within sixteen of a live cage: pulling back out
  // of their sight, priced with the spawner's cap (note 774).
  if (state.entity === 'blaze' && liveCage) {
    try { const ch = require('./cage-hold'), fight = ch.cageFight(bot, goal); const pb = fight && ch.pullBackOption(bot, task, goal, save, fight, { navigate: actions.navigate }); if (pb) tree.pull_back = pb; } catch (_) { /* none */ }
  }
  // A rod already on the ground from an earlier kill is a fact, not a
  // silent loss: its position and the risk of going for it, priced the
  // same way a fight is (note 710: holdCorner struck what came within
  // reach and never once fetched a rod that landed past it, and every
  // stance's own stall or end left it there unmentioned).
  const groundRods = state.entity === 'blaze' ? Object.values(bot.entities).filter(e => e.getDroppedItem?.()?.name === state.item &&
    e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= 24)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 4) : [];
  for (const drop of groundRods) {
    const distance = drop.position.distanceTo(bot.entity.position), p = drop.position.floored();
    const nearLava = require('./blaze-stand').lavaWithin(bot, p, 2);
    const reachable = require('./drop-collection').pickupPositions(bot, drop).length > 0;
    tree[`fetch_rod_${drop.id}`] = { description: `Fetch the ${state.item.replaceAll('_', ' ')} lying on the ground ${Math.round(distance)} blocks off at (${p.x}, ${p.y}, ${p.z}), from an earlier kill.` +
      `${nearLava ? ' Lava is within two blocks of it: the walk there stands that close.' : ''}${reachable ? '' : ' No standing spot near it reads as dry and safe right now; the walk there may fail and find nothing changed.'}`,
      run: () => collectNearbyDrops(bot, task, state.item, { radius: 10, origin: drop.position.clone(), timeoutMs: 6000, move: actions.navigate }) };
  }
  // The rods got so far out through the portal to a chest on the Overworld
  // side, and back for the rest (rod-bank.js, note 760).
  if (state.entity === 'blaze') { const bank = require('./rod-bank').bankOffer(bot, goal); if (bank) tree.bank_rods = require('./rod-bank').option(bot, task, goal, save, actions, bank); }
  if (!Object.keys(tree).length) return false;
  // The bot's fitness, on every option and in the state: what the code
  // once refused a fight for, as facts for Jev's choice (fitness, above).
  const fit = fitness(bot), fitSaid = fitnessSays(bot, fit);
  for (const option of Object.values(tree)) {
    if (typeof option.description === 'string') option.description += ` ${fitSaid}`;
    else option.description.fitness = fitSaid;
  }
  // Leaving them is not leaving their fire: said, so it is not read as a
  // way out (note 533).
  const firing = reaching.filter(t => shooter(t.entity));
  const stillShoot = firing.length ? ` Leaving them does not take the bot out of their fire: ${mobsSaid(firing)}, in sight and within reach, keep${firing.length === 1 ? 's' : ''} shooting where it stands; getting out of their line (a retreat, out of sight, cover) is the encounter's own choice once they claim the bot.` : '';
  // What leaving them came to in the arena, where it was measured: the
  // blazes stay, and so does their fire (blaze-stand.js MEASURED).
  const deferSays = state.entity === 'blaze' ? require('./blaze-stand').measuredSays('defer', bot).says.replace('this way', 'leaving them, the encounter answered as it came') : '';
  const deferGain = rodsNeed ? `${towardRods(rodsNeed, 'none', { spawner: liveCage, of: rodsOf })} Left, these are not offered again for two minutes.${capNow ? ` ${capNow}` : ''}${deferStreakSays}` : '';
  // Where the work goes next: at a known spawner still owed rods, it stays
  // there (the spawner is the work), not a silent switch to searching for
  // another fortress (note 740). 25590 chose defer at its own cage with a
  // rod still owed and, its only candidate set aside, walked 35 blocks
  // toward an old sighting from earlier in the trial, then into a fortress
  // search, without this ever being said or chosen.
  const deferNext = liveCage ? ` Left, the work stays at this spawner: it is still owed and known, so the next turn asks it again, not a search for another.`
    : rodsNeed ? ` Left, the work goes to find another blaze or a fortress to make one: none is known this close.` : '';
  tree.defer = { description: `Leave these targets alone for now if the observed situation is unsuitable; keep the resource goal saved.${stillShoot}${deferSays}${deferGain}${deferNext} ${fitSaid}${fit.fit ? '' : ' Left alone, the hunt recovers first: food if any is carried, cover from the shooters, and health while hunger is eighteen or more.'}`, run: async () => {
    for (const target of candidates) setAside(goal, 'hunt_target', target.uuid || target.id, 'Jev chose to leave it for now', 120000);
    if (blazesInSight.length) setAside(goal, 'hunt_stand', 'blaze', 'Jev chose to leave them for now', 120000);
    save();
  } };
  // What the stay at this cage has itself come to (kills, rods, health lost
  // since the bot came near), said on defer and on every hold beside it
  // (cage-yield.js HOLDS, note 702): defer's own arena row (a fight begun
  // elsewhere, at some other health) can read as safe on its own, and this
  // cage's own record is the fact that says whether staying here has
  // actually been (note 740, the coordinator's 25585: 16 blazes in sword
  // reach, defer answered twice against a row of "1 killed, 21 damage" with
  // nothing said of this cage's own 32 minutes of nothing).
  if (state.entity === 'blaze') { try { require('./cage-yield').annotate(bot, goal, tree); } catch (_) { /* no cage */ } }
  const snapshot = { request: goal.request, resource: state.item, need: huntTarget(bot, goal) - countOf(bot, state.item),
    ...(state.entity === 'blaze' && ladderRods(goal) ? { rodsTheGoalWants: require('./eye-need').says(bot, goal) } : {}),
    ...(state.entity === 'blaze' ? { blazes: blazesSays(bot, goal, state), playedRecord: require('./blaze-record').says(bot), playedAnswers: require('./blaze-record').answersSay(bot), blazeCounts: (() => { try { return require('./blaze-record').entryFacts(bot, { cage: require('./blaze-stand').spawnerAt(bot) }).says; } catch (_) { return undefined; } })() } : {}),
    // What followed the trials' rods (after-rod.js, note 659) is no longer
    // said: re-asked without it, no answer of 8 moved (note 672).
    health: bot.health, food: bot.food, dimension: dimension(bot), riskNow: require('./risk').riskNow(bot),
    fitness: { ...fit, said: fitSaid },
    // A blaze whose every way to fight it in the open ends within a push of
    // lava or a deep drop: fought from a stand, not walked under.
    ...(unreached.length ? { noWayToStrike: unreached.map(u => `${u} ${Object.keys(tree).some(k => /^(box|hole|wall|stand|back_to|corner|cage|spawner)/.test(k)) ? 'offered' : 'not on offer here'}`) } : {}),
    ...(pushed.length ? { notFoughtInTheOpen: pushed.map(e => ({ entity: e.name, distance: Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10, why: 'every way to it ends within a fireball\'s push (about two blocks) of lava or a deep drop' })) } : {}) };
  let decision;
  {
    // Fresh means the fight is still the one Jev was shown. Health equal to
    // the snapshot was the test, and a bot on fire loses health every second:
    // alight in a fortress, every answer came back stale and the bot stood
    // in the open asking again. A few points lost in flight still leaves the
    // same fight, and canBegin holds the floor.
    // With Jev unreachable the nearest candidate is fought: it passed the
    // same checks, and standing in a blaze's sight waiting for an answer is
    // the worse choice.
    const interrupt = () => { if (!canBegin(bot, handler)) throw Object.assign(new Error('Combat decision interrupted'), { name: 'CombatInterrupted' }); };
    try { decision = await decide('hunt_target', { client, bot, task, goal, save, tree, state: snapshot, interrupt,
      isFresh: () => canBegin(bot, handler) && bot.health >= snapshot.health - 4 && candidates.every(e => !positions.has(e.id) ||
        valid(bot, e) && e.position.distanceTo(positions.get(e.id)) < 2 && isolated(bot, e, handler)) }); }
    catch (err) { task.check(); if (err.name === 'CombatInterrupted') return false; throw err; }
  }
  if (decision.stale) return false;
  // Kept for encounter_stance to hear, a question asked by a different
  // layer a second later (note 723): 25597 answered hunt_target defer at
  // 04:59:27 and, one second later, encounter_stance answered charge_nearest
  // against the same blazes, not told defer had just been chosen. defer
  // means the observed situation is unsuitable to hunt right now; a closing
  // stance chosen moments after against the mobs just left alone reverses
  // it, and is said so (danger.js huntAnswerJustNow).
  if (decision.path[0] === 'defer') { goal.lastHuntDefer = { at: Date.now(), position: { ...bot.entity.position } }; goal.huntDeferStreak = (goal.huntDeferStreak || 0) + 1; }
  else { delete goal.lastHuntDefer; delete goal.huntDeferStreak; }
  await decision.action.run();
  return decision.path[0] !== 'defer';
}

// A fight the hunt offers, as a sentence: the mob and where, how it is
// fought with what is carried, what it drops, its price alone and with the
// others that reach the bot, and what is beside it.
function huntSays(bot, target, { handler, distance, mob, one, all, others, spawnerSays, newcomers = null, lavaNear, dropNear, footing, hitters, UNPROVOKED, item }) {
  const name = target.name.replaceAll('_', ' '), here = bot.entity.position;
  const dy = Math.round(target.position.y - here.y);
  const where = `${Math.round(distance)} blocks off${Math.abs(dy) >= 2 ? `, ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}, at (${Math.round(target.position.x)}, ${Math.round(target.position.y)}, ${Math.round(target.position.z)})`;
  let seen = true;
  try { const { lineClear } = require('./danger'), eye = here.offset(0, 1.62, 0); seen = [1.6, 0.9, 0.15].some(h => lineClear(bot, eye, target.position.offset(0, h, 0))); } catch (_) { seen = true; }
  const weapon = defenseWeapon(bot)?.name?.replaceAll('_', ' ');
  const worn = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean).length;
  const shield = bot.inventory?.slots?.[45]?.name === 'shield';
  const how = handler.passive ? 'Chase it and strike it with what is carried'
    : handler.ranged && bowReady(bot) ? 'Shoot it from range while it is in view, then close with the sword'
    : `Close on it and strike it${weapon ? ` with the ${weapon}` : ' bare-handed'}${shield ? ', the shield raised toward its shots' : ''}${worn ? `, ${worn} piece${worn === 1 ? '' : 's'} of armour worn` : ', no armour worn'}`;
  const drop = target.name === 'blaze' ? ` A blaze drops a rod about half the time; ${item.replaceAll('_', ' ')}s are what the request needs now, and the drop is picked up after.${require('./blaze-stand').measuredSays('open', bot).says}` : ` Its drop is picked up after.`;
  const price = !mob || handler.passive ? '' : all
    ? ` With ${mobsSaid(others)} reaching the bot here too and fighting with it: about ${all.fightHere.seconds} seconds and ${all.fightHere.damageTaken} damage from ${Math.round(bot.health * 10) / 10} health${all.fightHere.healthAfter <= 0 ? ' (more than the bot has)' : `, ${all.fightHere.healthAfter} after`}; this one alone would be about ${one.fightHere.seconds} seconds and ${one.fightHere.damageTaken}.${spawnerSays}`
    : ` About ${one.fightHere.seconds} seconds and ${one.fightHere.damageTaken} damage from ${Math.round(bot.health * 10) / 10} health, ${one.fightHere.healthAfter} after; it lands about ${mob.hitsBot} a hit through what is worn.${spawnerSays || ''}`;
  const withNewcomers = !newcomers ? '' : ` With the ${newcomers.n} more the spawner puts in over the seconds the fight then takes (one about every six, up to six about; the trials' record at a cage like this one: two within sixteen blocks at first sight, five by twenty or thirty seconds, six to eight by a minute), counted at the cage ${newcomers.cageAt} blocks off: about ${newcomers.fight.seconds} seconds and ${newcomers.fight.damageTaken} damage from ${Math.round(bot.health * 10) / 10} health${newcomers.fight.healthAfter <= 0 ? ' (more than the bot has)' : `, ${newcomers.fight.healthAfter} after`}.`;
  const note = mob?.note ? ` It ${mob.note}.` : '';
  const beside = [lavaNear ? ' Lava is within two blocks of it: a knockback there lands in it.' : '', dropNear ? ' A drop is within three blocks of it.' : '',
    hitters.length ? ` ${hitters.length} ${[...new Set(hitters.map(e => e.name.replaceAll('_', ' ')))].join(' and ')} within six blocks of it: ${[...new Set(hitters.map(e => UNPROVOKED[e.name].note))].join('; ')}.` : '',
    footing ? ` ${footing.trim()}` : ''].join('');
  return `Fight the ${name} ${where}${seen ? '' : ', out of sight now (heard through the walls; it comes once it sees the bot)'}, in the open: ${how}.${drop}${price}${withNewcomers}${note}${beside}`;
}
// The blazes about, as the hunt's facts: how many, seen or heard, their
// heights against the bot, a spawner seen, and what they are for.
function blazesSays(bot, goal, state) {
  let about = [];
  try { about = threats(bot, 48).filter(t => t.entity.name === 'blaze'); } catch (_) { about = []; }
  const here = bot.entity.position;
  const dys = about.map(t => Math.round(t.entity.position.y - here.y));
  const spawner = (goal.fortressSearch?.map?.spawners || []).map(s => ({ ...s, off: Math.round(Math.hypot(s.x + 0.5 - here.x, s.y + 0.5 - here.y, s.z + 0.5 - here.z)) })).sort((a, b) => a.off - b.off)[0];
  const need = huntTarget(bot, goal) - countOf(bot, state.item);
  return `${about.length} blaze${about.length === 1 ? '' : 's'} within forty-eight blocks (${about.filter(t => t.visible).length} in sight, the rest heard through the walls)` +
    (about.length ? `, the nearest ${Math.round(about[0].distance)} blocks off, from ${Math.min(...dys)} to ${Math.max(...dys)} blocks above the bot's feet` : '') +
    `${spawner ? `; a spawner seen ${spawner.off} blocks off at (${spawner.x}, ${spawner.y}, ${spawner.z}), which keeps making them while the bot is within sixteen` : ''}` +
    `; these are the blazes the fortress search came for: ${need} blaze rod${need === 1 ? '' : 's'} still needed, and nothing else gives them`;
}

// Cover the hunt raised stays up for a minute: the door rule is kept off
// it, or the two dig and build the same cell in turn.
const COVER_KEPT_MS = 60000;
function keepCover(state, cell) {
  if (!cell) return false;
  if (cell.offset) {
    const now = Date.now();
    state.cover = [...(state.cover || []).filter(c => c.until > now), ...[cell, cell.offset(0, 1, 0)].map(p => ({ key: `${p}`, until: now + COVER_KEPT_MS }))].slice(-8);
  }
  return true;
}
const coverKept = state => (state.cover || []).filter(c => c.until > Date.now()).map(c => c.key);

// Hungry off the Overworld with nothing to eat, short of the fitness to
// fight: back for food, or on without it, as Jev chooses (leave_nether).
// null when the question went stale.
// What the food ways carry out with, from the hunt's own actions.
const foodActions = (bot, task, goal, save, actions) => ({ navigate: actions.navigate, returnOverworld: actions.returnOverworld, acquire: actions.acquireStep, client: actions.client,
  mineOne: actions.mineAt ? (p, block) => actions.mineAt(bot, task, goal, save, p, block, block) : null });
// The food kit of the stay, asked inside the Nether the first time a Nether
// question is due (nether-food.js askStayKit): true when a way was chosen and
// carried out, so the pass ends there.
async function stayKit(bot, task, goal, save, actions) {
  if (goal.kind !== 'win' || !(actions.client || task.opportunityClient)) return false;
  const pick = await require('./nether-food').askStayKit(bot, task, goal, save, { actions: foodActions(bot, task, goal, save, actions), client: actions.client || task.opportunityClient });
  return !!pick && pick !== 'go_on';
}
async function foodLeave(bot, task, goal, save, actions) {
  const { portalTrip } = require('./game-progress');
  // What a hit costs at this health, said with staying: "no fight is
  // started" read as safe, and mid-235-p-fortress-7 kept on at 4.2 with
  // nothing to eat, where one blaze fireball that landed was the end; one
  // did, from forty-eight blocks, two minutes later (note 528).
  let hits = null; try { hits = require('./crossing-kit').netherHitSays(bot); } catch (_) { /* no body */ }
  const exposed = hits ? ` The search goes on where the Nether's mobs are: a blaze in sight shoots from as far as forty-eight blocks and a ghast from sixty-four, fight or no fight. ${hits}` : '';
  const tree = {
    go_back: { description: `Go back to the Overworld for food, hunted and cooked there. ${portalTrip(bot, goal)} The hunt waits till the bot is fed and back.` },
    // What twenty minutes at this health and hunger with nothing to eat has
    // cost in the record, not just the rule that it will not heal (note
    // 741, 25584: chosen at 6.4 health with the trip 181 blocks off and
    // never told what fights begun in that row came to).
    keep_on: { description: `Stay and go on without food for twenty minutes: hunger ${bot.food}, and health comes back only at eighteen or more. ${require('./nether-travel').keepOnFightSays(bot)} ${fitnessSays(bot)}${exposed} ${require('./food-facts').recordSays(bot)}` },
  };
  // Food as a resource of the stay (nether-food.js): the ways to more here,
  // each priced, asked next.
  let restock = null;
  try { restock = require('./nether-food').restockFoodOption(bot, task, goal, save, { actions: foodActions(bot, task, goal, save, actions), client: actions.client || task.opportunityClient }); } catch (_) { restock = null; }
  if (restock) tree.restock_food = { description: restock.description };
  // The trip home whose walk cannot begin from here, and going on without
  // food where one hit ends the bot and health cannot come back, are said,
  // not offered (note 706); going on stays only where nothing else is.
  let closed = null; try { closed = tripHomeClosed(bot, goal); } catch (_) { closed = null; }
  if (closed) delete tree.go_back;
  const lastHit = require('./last-hit').lastHit(bot);
  if (lastHit && Object.keys(tree).length > 1) delete tree.keep_on;
  const decision = await decide('leave_nether', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { for: 'food', ...rodsFact(bot, goal, {}), health: bot.health, food: bot.food, foodCarried: false, dimension: dimension(bot), ...(hits ? { whatAHitCosts: hits } : {}), ...(closed ? { tripHome: closed.says } : {}) } });
  if (decision.stale) return null;
  const pick = decision.path.at(-1);
  if (pick === 'restock_food') { await restock.run(); save(); return null; }
  goal.leaveNether = { reason: 'food', pick, until: 0, at: Date.now() };
  if (pick === 'keep_on') { setAside(goal, 'nether_return', 'food', require('./nether-travel').keepOnWhy(bot), 20 * 60000); delete goal.stockFood; }
  save();
  return pick;
}

async function prepareMobHunt(bot, task, step, goal, save, actions) {
  const handler = handlers[step.entity];
  if (!handler || handler.item !== step.item) throw blocked(`Unsupported mob source ${step.entity} for ${step.item}`);
  // The rods being banked (rod-bank.js, note 760): the walk out is the work,
  // not the hunt.
  if (dimension(bot) === 'nether' && require('./rod-bank').pending(goal)) { if (actions.returnOverworld) await actions.returnOverworld(bot, task, goal, save); return; }
  if (bot.game.difficulty === 'peaceful') throw blocked(`${step.entity} does not spawn in Peaceful; cannot obtain ${step.item} by hunting here`);
  const previous = goal.mobHunt;
  goal.mobHunt = { ...(previous?.item === step.item ? previous : {}), item: step.item, entity: step.entity,
    targetCount: countOf(bot, step.item) + step.count };
  goal.stockFood = true; save();
  // While this runs, mobs of this kind are the hunt's business and not the
  // survival layer's emergency. Refreshed every tick; it lapses in seconds.
  bot._huntingEntity = { name: step.entity, until: Date.now() + 5000 };
  // What the bot's time at each spawner known comes to (note 686): said
  // with the way back to it.
  if (step.entity === 'blaze' && goal.fortressSearch?.map?.spawners?.length) {
    require('./rung-measure').watchKills(bot);
    require('./fortress-map').noteSpawners(bot, goal.fortressSearch.map, { kills: bot._kills?.blaze || 0, rods: countOf(bot, step.item) });
  }
  // A drop on the floor is a drop not carried. The arena killed a blaze and
  // scored nothing three times over because the rod lay where it fell: the
  // fight's own pickup only runs when the fight's own code did the killing.
  if (await collectNearbyDrops(bot, task, step.item, { radius: 12, timeoutMs: 5000, move: actions.navigate })) {
    goal.step = { action: 'collect_drop', item: step.item, carried: countOf(bot, step.item) }; save(); return;
  }
  // A rod on a floor the bot is standing on top of cannot be walked to. The
  // spawner drill killed all four blazes for no damage and came home with
  // nothing, because the drops were in the chamber and the bot was on its
  // roof. Where the walk fails and the drop is below, go down after it.
  const below = Object.values(bot.entities || {}).find(e => e.getDroppedItem?.()?.name === step.item &&
    e.position && e.position.distanceTo(bot.entity.position) < 24 && e.position.y < bot.entity.position.y - 2);
  if (below) {
    goal.step = { action: 'down_for_the_drop', item: step.item, drop: Math.round(bot.entity.position.y - below.position.y) }; save();
    try { if (await descendTo(bot, task, below.position, { arriveWith: HUNT_FLOOR }) >= 1) return; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastDescentError = err.message; }
  }
  if (!handler.passive && !await prepareCombatGear(bot, task, goal, save, actions)) return;
  if (handler.dimension && dimension(bot) !== handler.dimension) { await actions.enterNether(bot, task, goal, save); return; }
  if (dimension(bot) === 'nether' && await stayKit(bot, task, goal, save, actions)) return;
  // A spawner known here and no blaze near: the ways at an empty spawner
  // room are Jev's (empty-spawner.js), before the unfit branch or the
  // search. mid-242-dc-fortress-22 stood two blocks from a cage at 3.8
  // health with nothing to eat, and the search walked it 42 blocks off the
  // spawner unasked (note 681).
  if (step.entity === 'blaze' && dimension(bot) === 'nether' &&
      await require('./empty-spawner').atSpawner(bot, task, goal, save, { ...actions, waitAtSpawner: () => findFortressStep(bot, task, goal, save, actions) })) return;
  // Fit in every way but where it stands (a slab, a fence top, a ceiling at
  // the head): waiting was the answer to all of canBegin, and waiting does
  // not change the footing. It stood recovering at full health on a
  // fortress roof. The stalk below moves it; a fight begins wherever that
  // lands on dry ground. With nothing in view to fight (huntObserved runs
  // first, and asks Jev with the fitness as facts), a bot short of the
  // fitness recovers here: food, cover from the shooters, health.
  if (!handler.passive && !fitness(bot).fit) {
    // Nothing to eat and hunger under eighteen means no regeneration: the
    // recovery never comes. Off the Overworld that is a trip back for food.
    // Unless Jev chose to go on in the Nether without going back (nether-
    // travel.js keep_on): then the search goes on, and the fight waits for
    // food. mid-211-c's way back was lost 250 blocks off (note 241).
    // Going back is Jev's (leave_nether), with the trip and the hour it
    // comes out at: the rule went back at hunger seventeen unasked, and
    // mid-202-o-nether-3 came out into the night and was 330 blocks from
    // its portal by the morning's food search (note 495).
    let keepOn = isSetAside(goal, 'nether_return', 'food');
    if (bot.food < 18 && !hasFood(bot) && dimension(bot) !== 'overworld' && actions.returnOverworld && !keepOn) {
      const { netherLeaveHeld } = require('./game-progress');
      // A trip held whose walk cannot begin from here is asked again, not
      // walked into its first failure (note 706).
      const pick = netherLeaveHeld(goal, 'food') && !tripHomeClosed(bot, goal) ? 'go_back' : await foodLeave(bot, task, goal, save, actions);
      if (pick === null) return;
      if (pick === 'go_back') {
        goal.step = { action: 'return_for_food', health: bot.health, food: bot.food }; goal.stockFood = true; save();
        await actions.returnOverworld(bot, task, goal, save); return;
      }
      keepOn = true;
    }
    if (keepOn && bot.food < 18 && !hasFood(bot) && handler.dimension === 'nether' && dimension(bot) === 'nether' && actions.tunnel && !threats(bot, 16).some(t => t.visible)) {
      await findFortressStep(bot, task, goal, save, actions); return;
    }
    goal.step = { action: 'recover_before_combat', health: bot.health, food: bot.food, neededHealth: handler.passive ? 10 : 14, neededFood: handler.passive ? 6 : 14 }; save();
    // Something already at arm's length, still hitting: not a hazard to
    // wait out but the fight itself, arrived early. This step only ever
    // checked a drop underfoot and a shooter's line; a melee mob already in
    // reach fell through both and was answered with a 500 ms sleep. The
    // arena's enderman_single drill (note 713) died this way: brought to
    // three blocks while the bot was down to 8.6 health and unfit to
    // re-enter the fight, it stood in recover_before_combat and took the
    // rest of its hits with no defense offered at all, none to Jev either.
    const adjacent = threats(bot, 6).filter(t => t.visible && !shooter(t.entity) && t.distance <= 3.5).sort((a, b) => a.distance - b.distance)[0];
    if (adjacent) throw new NeedsSafety(adjacent);
    // Hit while it waits, by something it cannot see, beside a drop that
    // would end it: off the edge first. mid-92-i recovered on a Nether ledge
    // eighty blocks up, burned by something out of sight, and a hit at 2.4
    // health put it forty blocks down (2026-09-26).
    if (bot._recentHurtAt > Date.now() - 2000) {
      const { dropNear } = require('./terrain');
      const deep = dropNear(bot, bot.entity.position.floored(), 2);
      // With Jev reachable and a mob about to answer, the encounter is the
      // stance's (note 549): the survival step asks it, the drop said and
      // firm ground offered there (fight_from_footing). The step below is
      // the code's own only without Jev, or with nothing seen to ask about.
      const about = (actions.client || task.opportunityClient) && process.env.JEV_ENCOUNTERS !== '0' && threats(bot, 16).sort((a, b) => a.distance - b.distance)[0];
      if (deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2) && about) throw new NeedsSafety(about);
      if (deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2)) {
        const { firmGround } = require('./survival');
        const cell = firmGround(bot, 8, { margin: 3 });
        if (cell) {
          goal.step = { action: 'off_the_edge', to: { ...cell }, health: bot.health }; save();
          require('./terrain').holdOffEdge(bot, bot.entity.position.floored(), threats(bot, 64).map(t => t.entity));
          try { await actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2000 }); return; }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        }
      }
    }
    // Not in the open, if something out there shoots. Health comes back at
    // the same rate behind a wall and the wall is free.
    const shooters = threats(bot, 24).filter(t => t.visible && shooter(t.entity));
    if (shooters.length && bot.health < 18) {
      const from = bunkerCentroid(shooters);
      // No wall within walking distance: build one. Two blocks placed where
      // the bot already stands beat nine blocks walked under fire.
      if (!nearWall(bot, from)) {
        goal.step = { action: 'take_cover', shooters: shooters.length, health: bot.health }; save();
        try { if (await raiseCover(bot, task, from)) { await sleep(400); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastCoverError = err.message; }
        await sleep(500); task.check(); return;
      }
      goal.step = { action: 'dig_in_to_recover', shooters: shooters.length, health: bot.health }; save();
      try { await digBunker(bot, task, goal, save, { from, navigate: actions.navigate }); return; }
      // Why it could not dig in matters as much as that it did not: a
      // swallowed failure here reads, from outside, as a bot that simply
      // chose to stand in the open and be shot.
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; goal.mobHunt.lastBunkerError = err.message; save(); }
    }
    await sleep(500); task.check(); return;
  }
  // A mob already in view is stalked where it is: the observed-hunt check at
  // the top of the loop takes it the moment the route and the odds allow.
  // Exploring for it instead climbed to the surface every time a cave spider
  // showed, and the diamond shaft was dug and left three times in a row.
  // A mob that stays out of reach for a minute is set aside for two.
  // Everything above reads `goal.mobHunt` by name: `state` is declared here,
  // and a reference to it earlier in this function is a temporal-dead-zone
  // crash, which is what "Cannot access 'state' before initialization"
  // was, thrown out of the recovery branch on every tick the bot was hurt.
  const state = goal.mobHunt;
  const near = Object.values(bot.entities || {}).filter(e => e.name === step.entity && e.isValid !== false &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id) && e.position.distanceTo(bot.entity.position) < 32)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
  if (near) {
    if (goal.fortressSearch) goal.fortressSearch.patrols = 0;
    rememberSighting(state, bot, near);
    if (countOf(bot, step.item) > (state.watchedWith ?? -1)) { delete state.watchingSince; state.watchedWith = countOf(bot, step.item); }
    // A spawner's worth of blazes is fought from a bunker, not in the open:
    // dig in beside them and take them at the door.
    // Hurt, not merely outnumbered. Held at the door the bot took nine
    // damage and got no rods in two runs, because blazes hover out of reach
    // of a doorway; fought in the open at full health it got two.
    // Two shooters at different angles cannot both be kept inside one
    // shield arc, and the arena charged twenty-six health a pair to prove
    // it. They are met at a tunnel mouth instead, where they have to arrive
    // one at a time. A single one is still fought in the open, which now
    // costs nothing at all.
    const inView = threats(bot, 24).filter(t => t.entity.name === step.entity && t.visible).length;
    // A box, hole or slit already under way at the spawner (chosen at
    // empty_spawner, now an intention: note 731, intention.js TIMED) is the
    // wall this would otherwise dig from scratch: 25588 had "Digging in
    // beside them" fire on a box one block from whole, walking off to a
    // fresh bunker at a different spot while the almost-finished box stood
    // empty. While that intention holds, the wall it is building or has
    // already built is left to finish and be used, not preempted.
    const buildingBox = (() => { try { const i = require('./intention').holding(bot, goal); return !!i && i.q === 'empty_spawner' && /^(box_here|box_in_line|box_at_spawner|dig_in_at_spawner|open_slit)$/.test(i.choice); } catch (_) { return false; } })();
    // A wall at hand, not a wall somewhere. Sent to find one nine blocks
    // off, the bot took forty-one damage crossing the room and arrived with
    // nothing; fighting where it stood cost twenty-six.
    const cornered = !buildingBox && handler.ranged && (inView >= 2 || (swarm(bot) && bot.health < 16));
    // A spawner keeps three or more in the air, and three of a kind in view
    // means none of them is isolated enough to fight: the live run stood
    // eight blocks from a fortress spawner watching blazes, one second at a
    // time, and took nothing home. With no wall to back into, build one.
    // Behind it most of them are out of sight, the rest have to come round,
    // and a fight the bot can actually start is worth more than a tidy
    // reason not to.
    if (cornered && !nearWall(bot, near.position) && !isSetAside(goal, 'hunt_cover', step.entity) &&
        !(state.stairsTo && state.stairsTo.until > Date.now())) {
      goal.step = { action: 'break_their_line', entity: step.entity, inView, health: bot.health }; save();
      try { if (keepCover(state, await raiseCover(bot, task, near.position))) { await sleep(300); return; } }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; state.lastCoverError = err.message; }
      setAside(goal, 'hunt_cover', step.entity, state.lastCoverError || 'no cover could be raised', 60000); save();
    }
    if (cornered && nearWall(bot, near.position) && !isSetAside(goal, 'hunt_bunker', step.entity)) {
      goal.step = { action: 'take_the_door', entity: step.entity, inView, health: bot.health }; save();
      // A hold that ends quietly with nothing gained is a failure too: the
      // arena measured the door at zero rods, and without a cooldown the
      // bot walked straight back into the same bunker for another two
      // minutes.
      try {
        if (!await bunkerFight(bot, task, goal, save, actions, { item: step.item, want: countOf(bot, step.item) + 1 })) { setAside(goal, 'hunt_bunker', step.entity, 'held the door and gained nothing', 120000); save(); }
        return;
      }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'hunt_bunker', step.entity, err, 120000); state.lastBunkerError = err.message; save(); }
    }
    const key = near.uuid || near.id;
    if (!state.stalking || state.stalking.key !== key) state.stalking = { key, since: Date.now() };
    const distance = near.position.distanceTo(bot.entity.position);
    goal.step = { action: 'stalk_mob', entity: step.entity, distance: Number(distance.toFixed(1)) }; save();
    // The supervisor: three quarters of a minute without getting any closer
    // sets the mob aside. A fixed timer set aside mobs the bot was closing on.
    if (watch(goal, 'hunt_target', key, distance, { stallMs: 45000, restMs: 120000, why: 'no closer in three quarters of a minute' }).stalled) { delete state.stalking; save(); }
    // A mob seen far off is closed on, not watched: a blaze at twenty-nine
    // blocks was stood in front of for sixteen persistence rounds while the
    // observed-hunt check, which looks within twenty-four, never saw it.
    if (distance > 10 && actions.navigate) {
      const from = bot.entity.position.clone();
      // The mob being closed on is the encounter for the walk: without
      // that, the threat check saw the blaze at sixteen blocks and the bot
      // fled the thing it was hunting.
      const restore = encounter(bot, task, near, Date.now() + 20000);
      try { await actions.navigate(bot, task, new goals.GoalNear(near.position.x, near.position.y, near.position.z, 8), { timeoutMs: 20000, stallMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      finally { restore(); }
      // No way to it (a blaze on a wall across the lava): set it aside and
      // walk the fortress; the walk brings another into reach.
      if (bot.entity.position.distanceTo(from) < 1.5) {
        setAside(goal, 'hunt_target', key, 'no way to it', 120000); unwatch(goal, 'hunt_target', key); delete state.stalking; save();
        if (handler.dimension === 'nether' && actions.tunnel) { await findFortressStep(bot, task, goal, save, actions); }
      }
      return;
    }
    // Digging toward them, a step a tick, until they are within a sword.
    //
    // Not only downward, and not once every fifteen seconds. Level with the
    // blazes at last, the live bot sat in the one-block-high hole its own
    // descent had left: the ceiling of that hole blocked every line of
    // sight, so nothing was visible, nothing was a candidate, and it opened
    // one door a quarter of a minute and never moved. The staircase cuts a
    // passage the bot's own height and keeps cutting.
    const stairs = state.stairsTo;
    const target = stairs && new Vec3(stairs.x, stairs.y, stairs.z);
    if (stairs && stairs.until > Date.now() && actions.tunnel && target.distanceTo(bot.entity.position) > 3.5) {
      goal.step = { action: 'dig_toward_them', entity: step.entity, to: { x: stairs.x, y: stairs.y, z: stairs.z },
        away: Math.round(target.distanceTo(bot.entity.position)) }; save();
      try { await actions.tunnel(bot, task, goal, save, target, 'approach'); return; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastStairsError = err.message; save(); }
    } else if (stairs && (stairs.until <= Date.now() || target.distanceTo(bot.entity.position) <= 3.5)) { delete state.stairsTo; save(); }
    // Watching, not fighting. The observed hunt takes a target the moment it
    // is allowed to; a stalk that has watched the same mob for fifteen
    // seconds is not waiting for an opening, it is stuck.
    state.watchingSince ||= Date.now();
    if (Date.now() - state.watchingSince > 15000) {
      state.watchingSince = Date.now();
      state.watchFails = (state.watchFails || 0) + 1;
      // Change the situation, not the target. Setting the mob aside was
      // itself the bug: with a spawner room full of blazes the bot avoided
      // one every fifteen seconds until it had avoided all twelve and had
      // nothing left to hunt. Cover breaks their line and makes them come
      // round it, which is the thing that was missing.
      // Below and behind rock: go through the floor. A fortress roof is two
      // blocks of nether brick with the spawner room under it, and no amount
      // of walking round the outside ever reaches that.
      // Out of reach and watched too long: dig to it, whatever the reason
      // the walk did not work. Set here so the passage is cut a step a tick
      // by the branch above rather than a step every fifteen seconds.
      if (near.position.distanceTo(bot.entity.position) > 3.5) {
        state.stairsTo = { x: Math.floor(near.position.x), y: Math.floor(near.position.y), z: Math.floor(near.position.z), until: Date.now() + 90000 }; save();
      }
      const dy = near.position.y - bot.entity.position.y;
      // Two below counts: at exactly two the old test was one block short,
      // and the bot sat four blocks from the blazes' level building cover
      // on its own floor, which does nothing about a mob beneath it.
      if (dy <= -1.5) {
        goal.step = { action: 'dig_down_to_them', entity: step.entity, drop: Math.round(-dy) }; save();
        // What the descent saw and did, kept on the hunt: eight attempts
        // live and the bot's height never changed, and nothing recorded why.
        const feet = bot.entity.position.floored();
        const column = [-1, -2, -3, -4].map(d => bot.blockAt(feet.offset(0, d, 0))?.name || '?');
        try {
          const dropped = await descendTo(bot, task, near.position, { arriveWith: HUNT_FLOOR });
          state.lastDescent = { at: Date.now(), dropped, from: { ...feet }, column, health: bot.health }; save();
          if (dropped >= 1) return;
        }
        catch (err) {
          task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
          state.lastDescentError = err.message; state.lastDescent = { at: Date.now(), error: err.message, from: { ...feet }, column }; save();
          // A one-block roof over a room too deep to drop into: the live bot
          // stood on [netherrack, air, air, air] refusing the fall for an
          // hour. The staircase digs down through the rock beside the room
          // and comes in at floor level, a step a tick, until level with them.
          if (/too deep|lava/.test(err.message) && actions.tunnel) {
            state.stairsTo = { x: Math.floor(near.position.x), y: Math.floor(near.position.y), z: Math.floor(near.position.z), until: Date.now() + 60000 }; save();
          }
        }
      }
      // Level with them and something between: a door toward them, before
      // any wall. Cover is for a target that can see the bot, not one it
      // has already fenced itself off from.
      // Cover and doors are for a mob already in reach. While a shaft is
      // being dug at them, cover placed "one step toward them" goes into the
      // very cell the shaft is about to dig: the live bot got to within four
      // blocks, walled its own tunnel shut, dug it open, walled it again.
      const digging = state.stairsTo && state.stairsTo.until > Date.now();
      if (Math.abs(dy) <= 1.5 && !digging) {
        goal.step = { action: 'open_a_door', entity: step.entity }; save();
        try { if (await openToward(bot, task, near.position, { spare: coverKept(state) })) { await sleep(300); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        goal.step = { action: 'break_their_line', entity: step.entity, watched: state.watchFails }; save();
        try { if (keepCover(state, await raiseCover(bot, task, near.position))) { await sleep(300); return; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      if (state.watchFails >= 3) {
        setAside(goal, 'hunt_target', key, 'watched three times without getting anywhere', 120000); unwatch(goal, 'hunt_target', key); delete state.stalking; state.watchFails = 0; save();
        bot.chat?.(`Watching ${step.entity.replaceAll('_', ' ')}s and getting nowhere. Trying another angle.`);
      }
      return;
    }
    await sleep(1000); return;
  }
  delete state.stalking;
  // Where the blazes were last seen is where they will be again: a spawner
  // keeps its room full. After a death the bot swept from the portal as if
  // it had never been there. Head back to the freshest sighting first.
  // Not while a walk to a spawner Jev chose is under way (note 686).
  //
  // Not while the bot is at a known spawner still owed rods, either (note
  // 740): rememberedSpot explicitly skips a sighting within 12 blocks of
  // here, so a hunt_target defer that set the cage's only blaze aside found
  // no `near` candidate and this then picked an old, far-off sighting to
  // walk toward instead of the cage the bot was standing at. The spawner at
  // hand is the work; findFortressStep below already returns to it
  // (cage-hold.js cageFight) when the bot is this close.
  const atKnownSpawner = state.entity === 'blaze' ? (() => { try { return require('./cage-hold').cageFight(bot, goal); } catch (_) { return null; } })() : null;
  const spot = !goal.fortressSearch?.spawnerWait?.go && !atKnownSpawner && rememberedSpot(state, bot);
  if (spot && actions.navigate) {
    spot.triedAt = Date.now(); spot.tries = (spot.tries || 0) + 1; save();
    goal.step = { action: 'return_to_blazes', target: { x: spot.x, y: spot.y, z: spot.z }, seen: spot.seen }; save();
    const from = bot.entity.position.clone();
    // Gold passed on the way is mined and the walk goes on (note 653).
    try { await actions.navigate(bot, task, new goals.GoalNear(spot.x, spot.y, spot.z, 6), { timeoutMs: 60000, stallMs: 10000, passing: true }); delete spot.why; }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; spot.why = String(err.message || err).slice(0, 160); }
    if (bot.entity.position.distanceTo(from) < 2 && actions.tunnel) {
      try { await actions.tunnel(bot, task, goal, save, new Vec3(spot.x, spot.y, spot.z), 'fortress'); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    return;
  }
  // Blazes live in fortresses, and a fortress is found by sweeping, not by
  // rings around the portal: fortress strips run north to south, so a walk
  // east or west crosses one. Nether bricks in view end the sweep.
  if (handler.dimension === 'nether' && actions.tunnel) { await findFortressStep(bot, task, goal, save, actions); return; }
  // A hunt circles where it started, in rings of twenty-four blocks, rather
  // than walking the map's frontier: the mob comes to the bot at night. By
  // day underground the caves are the hunting ground, not the surface.
  // Required here, not at the top: surface.js reaches this module through work.js.
  const { surfaceObserver } = require('./surface');
  const underground = dimension(bot) === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
  await actions.explore(bot, task, goal, save, step.entity, { surfaceOnly: dimension(bot) === 'overworld' && !underground, frontier: false });
}

// Sightings of the hunted mob, clustered within sixteen blocks, newest
// first; a cluster seen many times is a spawner.
// Whether each was in sight (a line from the eyes through open air) or only
// heard through the walls is kept, and said where the sightings are
// (blazeSpotSays).
function rememberSighting(state, bot, entity) {
  const p = entity.position, dimension = bot.game?.dimension;
  state.sightings ||= [];
  let visible = false;
  try { const eye = bot.entity.position.offset(0, 1.62, 0), { lineClear } = require('./danger'); visible = [1.6, 0.9, 0.15].some(dy => lineClear(bot, eye, p.offset(0, dy, 0))); } catch (_) { visible = false; }
  const near = state.sightings.find(s => s.dimension === dimension && Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) < 16);
  if (near) { Object.assign(near, { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: Date.now(), seen: (near.seen || 1) + 1, inSight: (near.inSight || 0) + (visible ? 1 : 0) }); }
  else state.sightings.unshift({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), dimension, at: Date.now(), seen: 1, inSight: visible ? 1 : 0 });
  state.sightings = state.sightings.slice(0, 12);
}
// The freshest sighting in this dimension worth walking back to: not one
// just tried, not one the bot is already at, not one given up on.
function rememberedSpot(state, bot) {
  const here = bot.entity.position, dimension = bot.game?.dimension;
  return (state.sightings || []).filter(s => s.dimension === dimension && (s.tries || 0) < 4 && !(s.triedAt > Date.now() - 180000) &&
    Math.hypot(s.x - here.x, s.z - here.z) > 12 && Math.hypot(s.x - here.x, s.y - here.y, s.z - here.z) < 400)
    .sort((a, b) => (b.seen - a.seen) || (b.at - a.at))[0] || null;
}

const FORTRESS_MIN_BRICKS = 24;
// Bricks looked for: the nearest this many, and where they fill it, the
// wider count (findFortressStep).
const FORTRESS_LOOK = 512, FORTRESS_VIEW = 4096;
// A wait by a spawner Jev chose (wait_at_spawner), before the legs are asked again.
const SPAWNER_WAIT_MS = 3 * 60000;
// A walk to a spawner Jev chose (go_to_spawner), before the legs are asked
// again: 100 blocks of fortress floor at a walk is under a minute, the way
// asked where it finds none included.
const SPAWNER_GO_MS = 5 * 60000;
// A walk over the fortress's corridors again Jev chose (stay_in_fortress).
const PATROL_MS = 3 * 60000;
// How far back the times the bot walked all it could reach of a fortress
// are said (walkedAllSays).
const WALKED_ALL_MS = 30 * 60000;
// The times the bot walked all it could reach of the fortress lately, and
// what came of them: 25589 went back into its fortress and walked the same
// floors seven times in forty minutes, no blaze killed, each asking told
// only the floors walked (note 686).
function walkedAllSays(bot, state, now = Date.now()) {
  const log = (state.walkedAllLog || []).filter(e => now - e.at < WALKED_ALL_MS);
  if (log.length < 2) return '';
  const first = log[0], kills = Math.max(0, (bot._kills?.blaze || 0) - first.kills), rods = Math.max(0, countOf(bot, 'blaze_rod') - first.rods);
  const mins = Math.max(1, Math.round((now - first.at) / 60000));
  return ` It has walked all it can reach of this fortress ${log.length} times in the last ${mins} minutes, ${kills || rods ? `${kills} blaze${kills === 1 ? '' : 's'} killed and ${rods} rod${rods === 1 ? '' : 's'} taken meanwhile` : 'no blaze killed and no rod taken meanwhile'}.`;
}
const LEAVE_RADIUS = 48, LEAVE_MS = 4 * 60 * 1000;
// A fortress set aside from a place is set aside, all of it, from about
// that place (within the ledger's "from here", tried.js NEAR) while the
// set-aside lasts. It was set aside by its bricks within the extent of what
// the look kept about the nearest, and a fortress bigger than one look is
// more: 25585's, 4,096 bricks and cut short, was left at 19:28:35 over
// (-116, 73, 180) and asked about again at 19:28:37 over (-131, 73, 154),
// thirty blocks on, from the same spot, "Leaving this fortress" and "A
// fortress! I'm heading for it" said together eight times in eight minutes
// (note 682). From elsewhere it is met again as before.
const leftFromHere = (sh, here) => !!sh?.from && !!here && Math.hypot(sh.from.x - here.x, sh.from.y - here.y, sh.from.z - here.z) <= require('./tried').NEAR;
const FORTRESS_BLOCKS = ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart'];
const FORTRESS_LEG = 96;
// The next leg of the sweep: ninety-six blocks along x, one way, at a
// height between the lava sea and the ceiling.
// Legs run along x until a direction will not give; then the sweep turns.
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const HEADING_NAMES = ['east', 'south', 'west', 'north'];
// The heading nearest the bearing from `a` to `b`.
const bearingOf = (a, b) => { const dx = b.x + 0.5 - a.x, dz = b.z + 0.5 - a.z; return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 2) : (dz >= 0 ? 1 : 3); };
// A fortress in view farther than this is headed toward as the legs go
// (fortress_approach head_toward, note 708); within it, the ways in.
const TOWARD_FROM = 48;
// Where fortresses stand: their corridors and bridges mostly between y 48
// and 75, over the lava sea at y 31. A leg at y 100 through the rock passes
// over every one of them unseen (mid-205-m, note 394).
const FORTRESS_Y = 64, FORTRESS_BAND = 8;
const headingIndex = state => Number.isInteger(state.heading) ? state.heading % 4 : (state.axis === -1 ? 2 : 0);
function fortressLegTarget(state, position) {
  // A leg seeking the fortress heights (chooseLeg's seek_fortress_height)
  // ends at them; a leg down to the floor (floor_<heading>) at the floor's
  // height; a level leg keeps its height between the sea and the roof.
  const y = state.legMode === 'descend' ? FORTRESS_Y : state.legMode === 'floor' && Number.isFinite(state.floorY) ? state.floorY : Math.max(40, Math.min(80, Math.round(position.y)));
  const [dx, dz] = HEADINGS[headingIndex(state)];
  // A side of the widening spiral (chooseLeg's widen_search) is its own length.
  const length = Number.isFinite(state.legLength) ? state.legLength : FORTRESS_LEG;
  // A leg round what stopped a heading's line (round_<heading>) runs from a
  // step to the side: its end is shifted by that step.
  const sx = state.legShift?.x || 0, sz = state.legShift?.z || 0;
  return new Vec3(Math.round(position.x + sx + length * dx), y, Math.round(position.z + sz + length * dz));
}

// The same heading from a step to either side, where its own line stops
// short (chooseLeg's round_<heading>, note 751): for each side and each step
// of 8, 16, 24 and 32 blocks, the step itself surveyed (it must get there
// with the blocks carried) and the heading's line from its end; the one
// whose line goes farthest before anything stops it, where that is farther
// than the straight line goes, the shorter step on a tie. Null otherwise.
const ROUND_STEPS = [8, 16, 24, 32];
function roundLeg(bot, straight, i) {
  if (!straight?.stoppedBy || !Number.isInteger(straight.stoppedAt) || /unloaded/.test(straight.stoppedBy)) return null;
  const reachOf = sv => Math.min(Number.isInteger(sv.stoppedAt) ? sv.stoppedAt : sv.cells, Number.isInteger(sv.runsOut) ? sv.runsOut : Infinity);
  const carried = straight.carried ?? blocksCarried(bot);
  let best = null;
  for (const side of [(i + 1) % 4, (i + 3) % 4]) {
    for (const off of ROUND_STEPS) {
      const step = surveyLeg(bot, HEADINGS[side], { cells: off, blocks: carried });
      if (!step || Number.isInteger(step.stoppedAt) || Number.isInteger(step.runsOut) || step.cells < off) break;
      const line = surveyLeg(bot, HEADINGS[i], { cells: FORTRESS_LEG, from: new Vec3(step.end.x, step.end.y, step.end.z), blocks: carried - (step.lay || 0) });
      if (!line) continue;
      const reach = reachOf(line);
      if (reach > straight.stoppedAt && (!best || reach > best.reach)) {
        const parts = [step.open && `${step.open} open`, step.rock && `${step.rock} of rock to dig`, step.lay && `${step.lay} to lay a block on`].filter(Boolean).join(', ');
        best = { side, off, reach, line, from: step.end, seconds: (step.seconds || 0) + (line.seconds || 0), sideSays: `${parts || 'open'}, about ${step.seconds} seconds` };
      }
    }
  }
  return best;
}

// How each heading's last leg ended no nearer, kept on that heading: noted
// on whatever heading the sweep had turned to, leg_south's failure read as
// leg_west's and leg_south looked untried, some thirty times over in
// mid-211-s-nether-4 and mid-202-o (note 480). Where it began, so a failure
// far from here is read as that.
// A staircase seeking the fortress heights is kept apart (seek_<heading>):
// filed as the level leg's, mid-202-o-nether-2's leg_north grew to "564
// tries from there" while seek_fortress_height, chosen again and again,
// said nothing of its own failure (note 500).
// A leg down to the floor and along it (floor_<heading>) is kept apart as
// well: its failure is the way down's or the floor's, not the level leg's.
// A leg round what stopped a heading's line (round_<heading>) is kept apart
// too: its failure is the side step's line, not the straight one (note 751).
const legKey = (i, mode) => mode === true || mode === 'descend' ? `seek_${HEADING_NAMES[i]}` : mode === 'floor' ? `floor_${HEADING_NAMES[i]}` : mode === 'round' ? `round_${HEADING_NAMES[i]}` : HEADING_NAMES[i];
// Where it ended and with how many blocks carried, where known: a leg that
// ran out of blocks there ends there again with no more carried (note 751c).
function legEnded(state, why, seeking = false, { at = null, carried = null } = {}) {
  const i = Number.isInteger(state.lastHeading) ? state.lastHeading : headingIndex(state);
  const history = state.legHistory ||= {};
  const from = state.legFrom || null, was = history[legKey(i, seeking)];
  const same = was?.from && from && Math.hypot(was.from.x - from.x, was.from.z - from.z) < 8;
  history[legKey(i, seeking)] = { ended: why || 'no ground made', from, tries: same ? (was.tries || 1) + 1 : 1, at: Date.now(),
    ...(at ? { endAt: { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) } } : {}), ...(Number.isFinite(carried) ? { carried } : {}) };
}
// A level leg that ran out of blocks where this one would, with no more
// carried now than then: said as tried. 25593 (mid-237-ca, 19:03 to 19:06Z
// on 2026-09-30) took leg_north with 0 blocks at 19:05:31, its pathfinder
// walk ending on its own span at z -178, where the last leg north had run
// out of blocks a minute before, and ran out there again (note 751c). The
// place this one stops: where the pathfinder's walk ends (`walkEnd`), else
// the cell where its blocks run out on the line.
function triedSays(state, name, here, survey, walkEnd, carried, now = Date.now()) {
  const h = state.legHistory?.[name];
  if (!h?.endAt || !/out of blocks/.test(h.ended || '') || !(carried <= (h.carried ?? 0))) return '';
  const [dx, dz] = HEADINGS[HEADING_NAMES.indexOf(name)];
  const stop = walkEnd || (Number.isInteger(survey?.runsOut) ? { x: here.x + dx * survey.runsOut, z: here.z + dz * survey.runsOut } : null);
  if (!stop || Math.hypot(stop.x - h.endAt.x, stop.z - h.endAt.z) > 4) return '';
  const ago = Math.max(1, Math.round((now - h.at) / 1000));
  return ` Tried: the last leg ${name} ran out of blocks at (${h.endAt.x}, ${h.endAt.y}, ${h.endAt.z}) ${ago < 90 ? `${ago} seconds` : `${Math.round(ago / 60)} minutes`} ago with ${h.carried} carried; with ${carried} carried now this one stops at the same place.`;
}
function legHistorySays(state, name, here, what = 'leg') {
  const h = state.legHistory?.[name];
  if (!h) return '';
  const where = h.from ? `, begun ${Math.round(Math.hypot(h.from.x - here.x, h.from.z - here.z))} blocks from here` : '';
  return ` The last ${what} this way${where}, ended no nearer${h.tries > 1 ? ` (${h.tries} tries from there)` : ''}: ${h.ended}.`;
}
const capital = s => `${s[0].toUpperCase()}${s.slice(1)}`;

// The blocks a span can be laid with (bridging.js MATERIALS) round the bot,
// by kind: a basalt delta is thousands of them with hardly any netherrack,
// and the restock mined netherrack only (mid-211-s-nether-4, mid-202-o,
// note 480). Only those it can dig from ground walked to from here are
// offered (bridging.js spanBlockSources): counted within sixteen blocks
// across the drop, mid-244-ad-nether-2's restock walked its span back and
// forth for a minute and dug nothing (note 561).
const RESTOCK_REACH = 16, RESTOCK_WALK = 32, RESTOCK_MOST = 128;
// Where nothing can be dug from ground within that, the floor the bot
// stands on is looked along farther, to the rock it joins: 25589 (mid-243-
// cd-nether-1) stood at the far end of its own span over the lava sea, no
// block carried and an iron pickaxe with 170 uses, the shore netherrack a
// walk of 30 back along the span; nothing within sixteen, the restock was
// not offered, every leg rested "out of blocks", and the one way to blocks
// offered was a portal 219 blocks off (note 655). The walk is the span's
// few dozen cells; on open ground the near look has found rock already.
const RESTOCK_FAR = { reach: 64, walk: 96, cells: 800 };
// Seconds a block of this kind takes to dig with the tool the dig would
// take (skills.js cheapestTool), as the crossing's survey reckons it.
// `tool`, where given, is the item type it will be dug with (a pickaxe
// made first), null the hand.
function digSeconds(bot, block, tool) {
  if (typeof block?.digTime !== 'function') return null;
  const type = tool !== undefined ? tool : require('./skills').cheapestTool(bot, block)?.type ?? null;
  return block.digTime(type, false, false, false, [], {}) / 1000;
}
const kindsSaid = tally => Object.entries(tally).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${c.toLocaleString('en-US')} ${n.replaceAll('_', ' ')}`).join(', ');
// The restock priced: how many (what the longest leg short of blocks still
// needs past those carried, as many as can be had here), from where, and
// the seconds: the walk to the first, then a dig and a step a block.
function restockPlan(bot, goal, surveys) {
  const carried = blocksCarried(bot);
  const short = surveys.filter(s => Number.isInteger(s?.runsOut));
  const pick = pickaxeFirst(bot);
  return blocksPlan(bot, goal, Math.max(0, ...short.map(s => (s.lay || 0) - carried)), { tool: pick.carried || pick.none ? undefined : pick.tool });
}
// `need` blocks past those carried, as many as can be dug here, priced.
function blocksPlan(bot, goal, need, { tool } = {}) {
  const carried = blocksCarried(bot);
  const skip = p => isSetAside(goal, 'reach', p);
  let found = spanBlockSources(bot, { reach: RESTOCK_REACH, walk: RESTOCK_WALK, skip }), far = false;
  if (need && !found.sources.length) {
    const farther = spanBlockSources(bot, { ...RESTOCK_FAR, skip });
    if (farther.sources.length) { found = farther; far = true; }
  }
  if (!need || !found.sources.length) return { found, need, want: 0, carried };
  const want = Math.min(need, RESTOCK_MOST, found.sources.length);
  const first = found.sources[0], taken = found.sources.slice(0, want);
  const digs = taken.map(t => digSeconds(bot, t.block, tool));
  const seconds = digs.some(d => d === null) ? null : Math.round(first.walk / WALK_SPEED + digs.reduce((n, d) => n + d, 0) + want / WALK_SPEED);
  return { found, need, want, first, seconds, carried, far };
}
// The reach the gathering looks within, as the plan found its blocks.
const restockReach = far => far ? RESTOCK_FAR : { reach: RESTOCK_REACH, walk: RESTOCK_WALK };
function restockSays(bot, plan, last, pick = pickaxeFirst(bot)) {
  const { found, need, want, first, seconds, carried } = plan, here = bot.entity.position;
  const has = found.sources.length;
  const whereFrom = first.walk ? `a walk of ${first.walk} block${first.walk === 1 ? '' : 's'} from here${plan.far ? `, back along the floor the bot stands on (nothing can be dug from ground within ${RESTOCK_REACH} blocks of here)` : ''}` : 'where the bot stands';
  return `Dig ${want} block${want === 1 ? '' : 's'} to lay spans with here, one after another, from the ${has} that can be dug from ground walked to from here (${kindsSaid(found.reachable)}): ` +
    `the nearest ${Math.round(first.p.distanceTo(here))} blocks off, dug from ${whereFrom}${seconds === null ? '' : `, about ${seconds} seconds in all`}. ${pick.says}` +
    `The longest leg short of blocks needs ${need + carried} laid and ${carried} are carried: ${need} short${want < need ? `, and only ${want} can be had here` : ''}. ` +
    (Object.keys(found.unreachable).length && !plan.far ? `Within ${RESTOCK_REACH} blocks but not to be dug from ground walked to from here (across open drop, under a span's floor, or with nowhere for the drop to land): ${kindsSaid(found.unreachable)}. ` : '') +
    (last ? `The last restock, ${Math.max(1, Math.round((Date.now() - last.at) / 60000))} min ago ${Math.round(Math.hypot(last.from.x - here.x, last.from.z - here.z))} blocks from here, gained ${last.gained}${last.why ? `: ${last.why}` : ''}. ` : '') +
    'The leg is chosen again after.';
}

// The pickaxe the blocks are dug with: carried, or made first from the
// wood carried (the mining step makes one: mid-242-ab-nether-4's iron
// pickaxe wore out beside its fortress and its restock made a wooden one
// from four oak logs), or none, and netherrack dug by hand drops nothing.
// Its restock was offered as "about 65 seconds" dug by hand, and the last
// one had gained nothing (note 591). `tool` is what the digging is priced
// with.
// The pickaxe made is the best whose head is carried: 25581 (mid-243-ch)
// stood 31 blocks from its fortress with 12 iron ingots, four planks and two
// logs, its iron pickaxe worn out on the legs, and was offered "a wooden
// pickaxe is made first" by restock_blocks and blocks_then_cross; neither
// made one, the digging was done by hand, and each ended "three blocks in a
// row gave nothing (Missing harvest tool for netherrack)" for forty minutes
// (note 654). `item` is the pickaxe made.
const PICK_HEADS = [
  ['iron_pickaxe', 'iron ingots', /^iron_ingot$/],
  ['stone_pickaxe', 'cobblestone or blackstone', /^(cobblestone|cobbled_deepslate|blackstone)$/],
];
function pickaxeFirst(bot) {
  if (!bot.inventory?.items) return { carried: false, none: true, tool: null, says: '' };
  if (pickaxeTier(bot) >= 1) return { carried: true, says: '' };
  return bestMakeable(bot);
}
// The best pickaxe the pockets make as they are, whether one is carried or
// not: a spare beside the one in hand is made the same way (note 687).
function bestMakeable(bot) {
  if (!bot.inventory?.items) return { carried: false, none: true, tool: null, says: '' };
  const items = bot.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = sum(/_log$|_stem$|_hyphae$|_wood$/), planks = sum(/_planks$/), sticks = sum(/^stick$/);
  const table = countOf(bot, 'crafting_table') > 0;
  // Four planks for a table unless one is carried, two for sticks (four of
  // them) unless two are carried, and three more for a wooden head.
  const wood = logs * 4 + planks, frame = (table ? 0 : 4) + (sticks >= 2 ? 0 : 2);
  // Raw iron with a furnace and fuel carried is an iron head too, smelted
  // first (pickaxe-budget.js smeltableIron, note 751).
  const smelt = require('./pickaxe-budget').smeltableIron(bot);
  const heads = PICK_HEADS.map(([item, said, re]) => ({ item, said, n: sum(re) }));
  if (smelt.ingots && heads[0].n < 3) Object.assign(heads[0], { n: heads[0].n + smelt.ingots, said: heads[0].n ? `iron ingots and ${smelt.says}` : smelt.says, smelted: true });
  const head = heads.find(h => h.n >= 3 && wood >= frame) ||
    (wood >= frame + 3 ? { item: 'wooden_pickaxe', said: 'planks', n: 0 } : null);
  const woodSaid = [logs && `${logs} log${logs === 1 ? '' : 's'}`, planks && `${planks} planks`, sticks && `${sticks} stick${sticks === 1 ? '' : 's'}`, table && 'a crafting table'].filter(Boolean).join(', ');
  // None to be made: what it is short of, so a fetch that supplies it can
  // say so. 25589 carried cobblestone and a table and was one stem short
  // of the sticks, and fetch_stems said "none can be made from what is
  // carried" (critic-20260930T0034Z item 1, note 705).
  if (!head) {
    const headCarried = heads.find(h => h.n >= 3);
    const planksShort = Math.max(1, (headCarried ? frame : frame + 3) - wood), stems = Math.ceil(planksShort / 4);
    const parts = [!table && 'a crafting table', sticks < 2 && 'the sticks', !headCarried && 'the head'].filter(Boolean);
    const then = headCarried ? `${/^iron/.test(headCarried.item) ? 'an' : 'a'} ${headCarried.item.replace('_', ' ')} from the ${headCarried.said} carried` : 'a wooden pickaxe';
    const short = { planks: planksShort, stems, for: parts.join(', '), then };
    return { carried: false, none: true, tool: null, short,
      says: `No pickaxe is carried and none can be made yet: short of ${planksShort} planks (${stems} log${stems === 1 ? '' : 's'} or stem${stems === 1 ? '' : 's'}) for ${short.for || 'it'}, then ${then}. Netherrack dug by hand drops nothing. ` };
  }
  const name = head.item.replace('_', ' '), a = /^iron/.test(head.item) ? 'an' : 'a';
  const from = head.smelted ? `3 of the ${head.said}${woodSaid ? `; ${woodSaid}` : ''}` : head.n ? `3 of the ${head.n} ${head.said}${woodSaid ? `; ${woodSaid}` : ''}` : woodSaid;
  return { carried: false, item: head.item, tool: bot.registry?.itemsByName?.[head.item]?.id ?? null, name: `${a} ${name}`,
    from, ...(head.smelted ? { smelted: true } : {}), says: `No pickaxe is carried, and netherrack dug by hand drops nothing: ${a} ${name} is made first from what is carried (${from}), ${head.smelted ? 'about half a minute with the smelting' : 'a few seconds'}, and the rock is dug with it. ` };
}
// The pickaxe pickaxeFirst said, made from what is carried: the craft
// steps one at a time (planks, the table, sticks, the pickaxe). Null when it
// is carried after, or why not.
async function makePickaxe(bot, task, goal, save, actions, pick = pickaxeFirst(bot)) {
  if (pick.carried) return null;
  if (pick.none || !pick.item) return 'none can be made from what is carried';
  if (!actions.acquireStep) return 'no way to craft here';
  const want = countOf(bot, pick.item) + 1;
  try {
    for (let i = 0; i < 8 && countOf(bot, pick.item) < want; i++) if (await actions.acquireStep(bot, task, pick.item, want, goal, save)) break;
  } catch (err) { task.check(); if (!retryable(err)) throw err; return `${pick.name} was not made: ${err.message}`; }
  return countOf(bot, pick.item) >= want ? null : `${pick.name} was not made`;
}
// The ways to a pickaxe on the way into a fortress, where none is carried
// and the ways in dig rock by hand: made here from what is carried, or
// stems fetched from the Nether's forests for one. The legs offered both
// (notes 654, 655); the way in did not. Of 1,851 crossings straight at a
// fortress over two days, 591 were taken with no pickaxe; those that ran
// came 8.9 blocks nearer a minute against 27.3 with one, and 39 of them had
// the pickaxe to be made in a few seconds from what was carried (note 669).
// Each run returns 'pickaxe' when one is carried after, and throws why not.
const PICKAXE_WAYS = ['make_pickaxe', 'fetch_stems'];
async function pickaxeWays(bot, task, goal, save, actions, { handSays = '', after = '' } = {}) {
  const ways = {};
  if (!actions.acquireStep || pickaxeTier(bot) >= 1) return ways;
  const pick = pickaxeFirst(bot);
  if (!pick.carried && !pick.none) {
    ways.make_pickaxe = { description: `Make ${pick.name} here from what is carried (${pick.from}), a few seconds at a crafting table: with it rock is dug in a fraction of the time it takes by hand, and what is dug comes back as blocks to lay.${handSays} ${after}`.trim(),
      run: async () => {
        const unmade = await makePickaxe(bot, task, goal, save, actions, pick);
        if (unmade) throw new Error(`The pickaxe was not made: ${unmade}`);
        return 'pickaxe';
      } };
  }
  if (pick.none) {
    const nw = require('./nether-wood');
    const fetch = await nw.fetchStemsOffer(bot, task, goal);
    if (fetch) ways.fetch_stems = { description: `${await fetch.describe()}${handSays} ${after}`.trim(), place: fetch.place,
      run: async () => {
        const done = await nw.fetchStems(bot, task, goal, save, { acquireStep: actions.acquireStep });
        if (done.unmade) throw new Error(done.unmade);
        return pickaxeTier(bot) >= 1 ? 'pickaxe' : 'stems';
      } };
  }
  return ways;
}

// Straight at the fortress with the blocks for it mined here first: the
// crossing surveyed to its end at the height the bot stands (rock dug,
// blocks laid over the air and the lava), the blocks it lays against those
// carried, the netherrack to be had here and its seconds, where the
// crossing ends against the fortress's floors, and the shooters in sight.
// mid-242-ab-nether-4 stood 102 blocks from a fortress behind a netherrack
// wall, no blocks and no pickaxe, and was offered the pathfinder's route
// ("found no route"), a staircase unmeasured and leaving; the legs offered
// the blocks for a leg, and Jev answered none good six times in a row.
// Straight at it at y 47, 142 cells: 205 blocks of rock dug and 36 laid,
// 13 of them over lava, with 225 netherrack to be dug round the bot (note
// 591). Null where the crossing needs no more blocks than are carried (the
// crossing alone is cross_level), makes no ground, or nothing can be mined.
const FORTRESS_CROSS = 192, CROSS_STACK = 64;
function mineThenCrossPlan(bot, goal, target, bricks = []) {
  if (typeof bot.blockAt !== 'function' || !/nether/.test(String(bot.game?.dimension || ''))) return null;
  const pick = pickaxeFirst(bot);
  if (pick.none) return null;
  const tool = pick.carried ? undefined : pick.tool;
  const carried = blocksCarried(bot);
  let all = null;
  try { all = surveyCrossing(bot, target, { cells: FORTRESS_CROSS, blocks: 999, tool }); } catch (_) { return null; }
  if (!all.cells || all.gain < 1 || all.bridge <= carried) return null;
  const plan = blocksPlan(bot, goal, Math.min(CROSS_STACK, all.bridge) - carried, { tool });
  if (!plan.want) return null;
  const withMined = surveyCrossing(bot, target, { cells: FORTRESS_CROSS, blocks: carried + plan.want, tool });
  if (withMined.gain < 1) return null;
  return { all, plan, withMined, pick, want: carried + plan.want, bricks, target };
}
function mineThenCrossSays(bot, cross, where) {
  const { all, plan, withMined, pick, bricks } = cross, here = bot.entity.position;
  const crossing = crossingSeconds(withMined), minutes = Math.max(1, Math.round(((plan.seconds ?? 0) + crossing) / 60));
  const whereFrom = plan.first.walk ? `a walk of ${plan.first.walk} block${plan.first.walk === 1 ? '' : 's'}` : 'where the bot stands';
  // Where it ends against the fortress: its nearest floor from there, or
  // how high its bricks there run.
  const end = withMined.end, floors = fortressFloors(bot, bricks);
  const floor = floors.slice().sort((a, b) => a.distanceTo(end) - b.distanceTo(end))[0];
  const column = bricks.filter(b => Math.hypot(b.x - end.x, b.z - end.z) <= 3);
  const endSays = floor && Math.hypot(floor.x - end.x, floor.z - end.z) <= 16
    ? ` From where it ends the nearest of the fortress's floors is ${Math.round(Math.hypot(floor.x + 0.5 - end.x, floor.z + 0.5 - end.z))} blocks across and ${Math.abs(floor.y + 1 - end.y)} ${floor.y + 1 >= end.y ? 'up' : 'down'}; the way onto it is asked from there.`
    : column.length ? ` Where it ends, the fortress's bricks there run up to y ${Math.max(...column.map(b => b.y))}, ${Math.max(...column.map(b => b.y)) + 1 - end.y} above the feet; the way up onto them is asked from there.` : '';
  const shooters = threatsInView(bot).filter(t => shooter(t.entity));
  const shot = shooters.length
    ? ` In sight: ${mobsSaid(shooters)}; no block is laid while one that can see the bot is within its reach, and a fireball's push on a one-wide span over open air is the fall.`
    : ' No ghast or blaze is in sight now; were one to come, no block is laid while it can see the bot, and a fireball\'s push on a one-wide span over open air is the fall.';
  return `Mine netherrack for blocks here first, then go straight at the fortress with them, ${where}. ${pick.says}` +
    `The crossing to its end lays ${all.bridge} block${all.bridge === 1 ? '' : 's'} (${all.overLava} over lava) and digs ${all.dig} of rock in ${all.cells} cells; ${withMined.carried - plan.want} carried${all.bridge > withMined.carried ? `, ${withMined.carried} after the mining (${plan.want < plan.need ? `only ${plan.want} to be had here` : `a stack of ${CROSS_STACK} at most`}), so it stops short` : ''}. ` +
    `Mined first: ${plan.want} from the ${plan.found.sources.length} that can be dug from ground walked to from here (${kindsSaid(plan.found.reachable)}), the nearest ${Math.round(plan.first.p.distanceTo(here))} blocks off, dug from ${whereFrom}${plan.seconds === null ? '' : `, about ${plan.seconds} seconds`}. ` +
    `Then, with them: ${crossingSays(withMined, 'the fortress')}${endSays}${shot} About ${minutes} minute${minutes === 1 ? '' : 's'} in all. Should the mining gain little or the pickaxe not be made, the crossing still goes on with what is carried, its rock dug by hand (note 677).`;
}
// Mined, then crossed: the blocks gathered as the restock gathers them
// (restockStep), then the crossing to its end. Returns why it ended short,
// null when it went on to its end.
async function mineThenCross(bot, task, goal, save, actions, state, cross) {
  const { target } = cross;
  if (blocksCarried(bot) < cross.want) {
    const here = bot.entity.position;
    state.restock = { want: cross.want, since: Date.now(), said: cross.plan.seconds, from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) }, ...(cross.plan.far ? { far: true } : {}) }; save();
    await restockStep(bot, task, goal, save, actions, state);
  }
  // With the blocks carried already the restock is not run, and the
  // crossing's rock was dug by hand: 25592's, 57 blocks of basalt at about
  // six seconds each with the makings of a pickaxe carried (note 655).
  // Unmade, the crossing goes on as surveyed, by hand.
  await makePickaxe(bot, task, goal, save, actions);
  const survey = surveyCrossing(bot, target, { cells: FORTRESS_CROSS });
  if (!survey.cells || survey.gain < 1) return `no crossing to make after the mining (${blocksCarried(bot)} blocks carried${state.lastRestock?.why ? `; the mining ended: ${state.lastRestock.why}` : ''})${survey.stoppedBy ? `: ${survey.stoppedBy}` : ''}`;
  goal.step = { action: 'cross_toward', what: 'the fortress', target: { x: target.x, y: target.y, z: target.z }, cells: survey.cells, dig: survey.dig, bridge: survey.bridge, carried: survey.carried }; save();
  try { await bridgeTo(bot, task, target, { maxBlocks: survey.bridge, maxSteps: survey.cells }); }
  catch (err) { task.check(); if (!retryable(err)) throw err; return err.message; }
  return survey.stoppedBy;
}

// The blocks for a pillar, gathered here: netherrack and rock with a
// pickaxe (carried, or made first from what is carried), else what a bare
// hand digs that drops (block-stock.js HAND_BLOCKS). Null where nothing can
// be had here that way. -> { want, seconds, says, run }.
function pillarGather(bot, goal, need) {
  if (!(need > 0) || !bot.inventory?.items) return null;
  const { SCAFFOLD } = require('./pillar-recovery'), bs = require('./block-stock');
  const scaffoldOf = b => b.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0);
  const here = bot.entity.position;
  const gatherRun = (names, want, seconds, what) => async (bot, task, goal, save, actions) => {
    const target = scaffoldOf(bot) + want, skip = p => isSetAside(goal, 'reach', p);
    try {
      const r = await gatherSpanBlocks(bot, task, target, { navigate: actions.navigate, reach: RESTOCK_REACH, walk: RESTOCK_WALK, skip,
        mineAt: s => actions.mineAt(bot, task, goal, save, s.p, s.name, s.drops),
        deadline: Date.now() + Math.max(60, (seconds ?? 60) * 2) * 1000, ...(names ? { names } : {}), carried: scaffoldOf, what });
      return r?.why || null;
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err; return err.message; }
  };
  const pick = pickaxeFirst(bot);
  if (!pick.none) {
    const plan = blocksPlan(bot, goal, need, { tool: pick.carried ? undefined : pick.tool });
    if (plan.want && !plan.far) {
      const from = plan.first.walk ? `a walk of ${plan.first.walk} block${plan.first.walk === 1 ? '' : 's'}` : 'where the bot stands';
      const run = gatherRun(null, plan.want, plan.seconds, 'rock for the pillar');
      return { want: plan.want, seconds: plan.seconds, kinds: kindsSaid(plan.found.reachable),
        says: `Mine ${plan.want} block${plan.want === 1 ? '' : 's'} for a pillar here first, from the ${plan.found.sources.length} that can be dug from ground walked to from here (${kindsSaid(plan.found.reachable)}), the nearest ${Math.round(plan.first.p.distanceTo(here))} blocks off, dug from ${from}${plan.seconds === null ? '' : `, about ${plan.seconds} seconds`}. ${pick.says}`.trim(),
        run: async (bot, task, goal, save, actions) => {
          if (!pick.carried) { const unmade = await makePickaxe(bot, task, goal, save, actions, pick); if (unmade) return `no pickaxe to dig with: ${unmade}`; }
          goal.step = { action: 'restock_blocks', want: plan.want, for: 'pillar' }; save();
          return run(bot, task, goal, save, actions);
        } };
    }
  }
  if (bs.pickaxeCarried(bot)) return null;
  const hand = bs.handGather(bot, { reach: RESTOCK_REACH, walk: RESTOCK_WALK });
  if (!hand.n) return null;
  const want = Math.min(need, hand.n, RESTOCK_MOST), taken = hand.sources.slice(0, want);
  const seconds = Math.round(taken[0].walk / WALK_SPEED + taken.reduce((n, t) => n + 5 * (t.block?.hardness ?? 1), 0) + want / WALK_SPEED);
  const run = gatherRun(bs.HAND_BLOCKS, want, seconds, 'what a hand digs for the pillar');
  return { want, seconds, kinds: `${kindsSaid(hand.found.reachable)}, by hand`,
    says: `Dig ${want} block${want === 1 ? '' : 's'} by hand for a pillar here first (${kindsSaid(hand.found.reachable)} within ${RESTOCK_REACH} blocks, dug from ground walked to: they drop by hand, netherrack does not), the nearest ${Math.round(taken[0].p.distanceTo(here))} blocks off, about ${seconds} seconds.`,
    run: async (bot, task, goal, save, actions) => { goal.step = { action: 'restock_blocks', want, for: 'pillar', byHand: true }; save(); return run(bot, task, goal, save, actions); } };
}

// A leg that ended at once, no ground made from where it began, rests
// from that spot: offered again it ends the same way. mid-242-ac-nether-1
// stood on its fortress's floor by a wall in the lava and was asked the leg
// every three seconds for fifteen minutes, east and north ninety times over,
// each ending at the first cell (a thousand tries from there) and the stall's
// loose ends asking again (note 557). Rested headings are said, not offered;
// from eight blocks off, or after five minutes, they are offered again.
const LEG_REST_MS = 5 * 60000, LEG_REST_WITHIN = 8;
function legResting(state, key, here, now = Date.now()) {
  const r = state.legRests?.[key];
  return r && r.until > now && Math.hypot(r.from.x - here.x, r.from.z - here.z) < LEG_REST_WITHIN && Math.abs((r.from.y ?? here.y) - here.y) < 4 ? r : null;
}
function restLeg(state, why, here, made = 0, now = Date.now()) {
  const i = Number.isInteger(state.lastHeading) ? state.lastHeading : headingIndex(state);
  const key = legKey(i, state.legMode);
  (state.legRests ||= {})[key] = { from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) }, until: now + LEG_REST_MS, at: now, made, why: why || 'no way on' };
  return key;
}
function restSays(key, r, now = Date.now()) {
  const [kind, name] = key.startsWith('seek_') ? ['seek', key.slice(5)] : key.startsWith('floor_') ? ['floor', key.slice(6)] : key.startsWith('round_') ? ['round', key.slice(6)] : ['level', key];
  const mins = Math.max(1, Math.round((r.until - now) / 60000));
  return `${kind === 'seek' ? `the staircase toward the fortress heights heading ${name}` : kind === 'floor' ? `the floor below, heading ${name}` : kind === 'round' ? `the leg round what stops the line ${name}` : `leg ${name}`}: ended ${Math.round((now - r.at) / 60000)} minutes ago ${r.made ? `${r.made} block${r.made === 1 ? '' : 's'} from where it began` : 'where it began'}, no way on (${r.why}); not offered from here for ${mins} more minute${mins === 1 ? '' : 's'}`;
}
// The pickaxe carried, as the ways that dig need it said. mid-242-ac-
// nether-1's staircase rested "no tool for nether bricks", said only
// inside a failure (note 557). With none it was "rock and nether bricks cannot be dug ... a crossing
// through rock digs nothing", beside a crossing priced "digging 113 blocks of
// rock ... about 782 seconds" that did dig them, by hand: mid-242-cf-nether-1-
// fortress-9 crawled at four blocks a minute through basalt for twelve
// minutes told both (note 669). Rock is dug by hand, slowly, for nothing.
// A staircase's digs with the last pickaxe, none other to be made: its
// steps as tunneling.js stairFromHere counts them, two blocks a step
// (pickaxe-budget.js lastPickaxeSays). '' otherwise.
function stairDigs(bot, goal, target) {
  if ((bot.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name)).reduce((n, i) => n + i.count, 0) !== 1) return '';
  let stair = null;
  try { stair = require('./tunneling').stairFromHere(bot, goal, target); } catch (_) { stair = null; }
  return stair?.gains ? require('./pickaxe-budget').lastPickaxeSays(bot, 2 * stair.steps) : '';
}
function pickaxeSays(bot, goal = null) {
  const picks = (bot.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
  if (picks.length && goal && /nether/.test(String(bot.game?.dimension || ''))) { const w = require('./pickaxe-budget').wearSays(bot, goal); if (w) return w; }
  if (!picks.length) return `none carried: rock is dug by hand and drops nothing, ${handDigSays(bot)}; the staircase and the legs dig it by hand at those times`;
  const left = i => { const max = bot.registry?.itemsByName?.[i.name]?.maxDurability; return max ? max - (i.durabilityUsed || 0) : null; };
  return picks.map(i => `${i.name.replaceAll('_', ' ')}${left(i) === null ? '' : `, ${left(i)} uses left`}`).join('; ');
}
// The game's time to break a block: a block whose drop wants a pickaxe,
// broken without one, takes its hardness times five seconds; with the
// pickaxe, ticks of speed / hardness / 30 (a stone pickaxe's speed is 4).
const digSecondsOf = (hardness, speed = null) => Math.ceil(1 / (speed ? speed / hardness / 30 : 1 / hardness / 100)) / 20;
const NETHER_ROCK = ['netherrack', 'basalt', 'blackstone', 'nether_bricks'];
function handDigSays(bot) {
  const known = NETHER_ROCK.map(n => [n, bot.registry?.blocksByName?.[n]?.hardness]).filter(([, h]) => Number.isFinite(h) && h > 0);
  if (!known.length) return 'far slower than with a pickaxe';
  const sec = s => `${Math.round(s * 10) / 10}`;
  return `about ${known.map(([n, h], i) => `${sec(digSecondsOf(h))}${i ? '' : ' seconds'} a block of ${n.replaceAll('_', ' ')}`).join(', ')} (with a stone pickaxe ${known.map(([, h]) => sec(digSecondsOf(h, 4))).join(', ')})`;
}
// Where blazes were seen (the hunt's sightings, rememberSighting), as the
// search says them and offers the way back: a spawner keeps its room full.
// mid-242-ac-nether-1 stood on its fortress's floor with blazes seen near
// it forty times and was asked only for legs (note 557): the hunt walks back
// to a sighting four times (rememberedSpot) and then only the search runs.
function blazeSpots(bot, goal) {
  const here = bot.entity.position, dim = bot.game?.dimension;
  return (goal.mobHunt?.sightings || []).filter(s => s.dimension === dim && Math.hypot(s.x - here.x, s.y - here.y, s.z - here.z) < 400)
    .map(s => ({ spot: s, off: Math.round(Math.hypot(s.x - here.x, s.y - here.y, s.z - here.z)) }))
    .sort((a, b) => (b.spot.seen || 1) - (a.spot.seen || 1) || a.off - b.off);
}
// The blaze spawners the fortress map holds, not seen broken, nearest
// first (note 686).
function spawnersKnown(bot, state) {
  const here = bot.entity.position;
  return (state.map?.spawners || []).filter(s => !s.broken && !s.notBlaze && (!s.mob || s.mob === 'blaze'))
    .map(s => ({ s, off: Math.round(Math.hypot(s.x + 0.5 - here.x, s.y + 0.5 - here.y, s.z + 0.5 - here.z)) })).sort((a, b) => a.off - b.off);
}
// A spawner as said with a way to it: where, the blazes seen near it, what
// the bot's time within its sixteen came to, and whether there is a way
// there (floors seen joining it, the pathfinder's survey, ground stood on).
function spawnerSays(bot, goal, state, { s, off }, planned = null, route = null, now = Date.now()) {
  const here = bot.entity.position, dy = Math.round(s.y - here.y);
  const ago = t => { const m = Math.round((now - t) / 60000); return m ? `${m} minute${m === 1 ? '' : 's'} ago` : 'just now'; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const seen = (goal.mobHunt?.sightings || []).filter(p => p.dimension === bot.game?.dimension && Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) <= 16).reduce((n, p) => n + (p.seen || 1), 0);
  const tally = s.lastThereAt ? `${plural(s.kills || 0, 'blaze')} killed and ${plural(s.rods || 0, 'rod')} taken in about ${Math.max(1, Math.round((s.secondsThere || 0) / 60))} minute${Math.round((s.secondsThere || 0) / 60) > 1 ? 's' : ''} within 16 of it, last there ${ago(s.lastThereAt)}` : 'the bot has not been within 16 of it since it was seen';
  const steps = planned ? require('./fortress-map').stepsTo(state.map, planned, s) : null;
  const stood = coverage.stoodNear(state, coverage.dimOf(bot), s, 32);
  const way = steps !== null ? `Floors seen join it to here, about ${steps} steps.`
    : route && !route.cells ? 'The pathfinder found no route toward it from here (it digs no netherrack).'
    : route ? `The pathfinder found ${route.status === 'success' ? 'a whole route' : 'a route part of the way'} of ${route.cells} cells, placing ${route.place} and digging ${route.dig}.`
    : 'No floor seen joins it to here.';
  return `at (${s.x}, ${s.y}, ${s.z}), ${off} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}, seen ${ago(s.seenAt || now)}: ${seen ? `blazes seen near it ${plural(seen, 'time')}` : 'no blaze seen near it'}; ${tally}. ${way}${stood === null ? '' : ` The bot has stood ${stood} blocks from it.`}`;
}
function blazeSpotSays({ spot, off }, here, now = Date.now()) {
  const dy = Math.round(spot.y - here.y), mins = Math.round((now - (spot.at || now)) / 60000);
  const sight = Number.isInteger(spot.inSight) ? ` (${spot.inSight} of them in sight, the rest heard through the walls)` : '';
  return `${spot.seen || 1} time${(spot.seen || 1) === 1 ? '' : 's'} at (${spot.x}, ${spot.y}, ${spot.z})${sight}, ${off} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''}, last ${mins ? `${mins} minute${mins === 1 ? '' : 's'} ago` : 'just now'}` +
    `${spot.tries ? `; the hunt walked back toward it ${spot.tries} time${spot.tries === 1 ? '' : 's'}${spot.why ? `, the last ending: ${spot.why}` : ''}` : ''}`;
}
// The blazes the bot knows of now, in sight or heard through the walls,
// nearest first. A sighting is kept only within thirty-two blocks (the
// hunt's own look), so mid-242-ac-nether-2-fortress-1, with two blazes
// thirty-four blocks off, was sent after a sighting 109 blocks off from
// forty-seven minutes before (note 570).
const BLAZES_ABOUT = 96;
function blazesAbout(bot) {
  const here = bot.entity?.position;
  if (!here) return [];
  let lineClear = null; try { ({ lineClear } = require('./danger')); } catch (_) { /* no world */ }
  const eye = here.offset(0, 1.62, 0);
  return Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.isValid !== false && e.position && e.position.distanceTo(here) <= BLAZES_ABOUT)
    .map(e => {
      let visible = false;
      try { visible = !!lineClear && typeof bot.blockAt === 'function' && [1.6, 0.9, 0.15].some(dy => lineClear(bot, eye, e.position.offset(0, dy, 0))); } catch (_) { visible = false; }
      return { entity: e, off: Math.round(e.position.distanceTo(here)), dy: Math.round(e.position.y - here.y), visible };
    })
    .sort((a, b) => a.off - b.off);
}
function blazesAboutSays(about) {
  if (!about.length) return null;
  const n = about[0], p = n.entity.position, inSight = about.filter(b => b.visible).length;
  return `${about.length} blaze${about.length === 1 ? '' : 's'} about now (${inSight ? `${inSight} in sight` : 'none in sight'}${inSight < about.length ? `, ${about.length - inSight} heard through the walls` : ''}), the nearest ${n.off} blocks off${Math.abs(n.dy) >= 2 ? ` and ${Math.abs(n.dy)} ${n.dy > 0 ? 'up' : 'down'}` : ''} at (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}
function blazesSeenFacts(bot, goal) {
  const spots = blazeSpots(bot, goal), about = blazesAboutSays(blazesAbout(bot));
  if (!spots.length) return about;
  const total = spots.reduce((n, s) => n + (s.spot.seen || 1), 0);
  return `${about ? `${about}; ` : ''}blazes seen ${total} time${total === 1 ? '' : 's'} in ${spots.length} place${spots.length === 1 ? '' : 's'}; the busiest ${blazeSpotSays(spots[0], bot.entity.position)}` +
    (spots.length > 1 ? `; next ${blazeSpotSays(spots[1], bot.entity.position)}` : '');
}

// A way Jev left (fortress_approach's other_way): the place is set aside for
// ten minutes, as the option says, not offered again from the search until
// then, and said with the ways that are. It was said and not done:
// mid-242-ac-nether-2-fortress-1 left the way to where blazes were seen 345
// times in ten minutes, and the next tick offered the same place as the
// only way and asked the way to it again (note 570).
const WAY_LEFT_MS = 10 * 60000;
const WAY_LEFT_NEAR = 8;
function waysLeft(state, now = Date.now()) { return (state.waysLeft || []).filter(w => w.until > now); }
function wayLeft(state, p, now = Date.now()) {
  return waysLeft(state, now).find(w => Math.hypot(w.x - p.x, w.y - p.y, w.z - p.z) <= WAY_LEFT_NEAR) || null;
}
function leaveWay(state, place, what, why, from, now = Date.now()) {
  state.waysLeft = [...waysLeft(state, now).filter(w => Math.hypot(w.x - place.x, w.y - place.y, w.z - place.z) > WAY_LEFT_NEAR),
    { x: place.x, y: place.y, z: place.z, what, why, at: now, until: now + WAY_LEFT_MS, from: { x: Math.round(from.x), y: Math.round(from.y), z: Math.round(from.z) } }].slice(-12);
}
function waysLeftSays(state, here, now = Date.now()) {
  const list = waysLeft(state, now);
  if (!list.length) return null;
  const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };
  return list.map(w => `${w.what} at (${w.x}, ${w.y}, ${w.z}), ${Math.round(Math.hypot(w.x - here.x, w.y - here.y, w.z - here.z))} blocks off: Jev left the way there ${mins(now - w.at)} ago, set aside for ${mins(w.until - now)} more${w.why ? ` (${w.why})` : ''}`);
}

// What has been seen before that lies one heading's way (within forty-five
// degrees of it, 256 blocks): where blazes were seen, a spawner seen, the
// fortress bricks last found and the fortresses remembered.
const THAT_WAY = 256;
function sightingsThatWay(bot, goal, state, here, heading) {
  const out = [];
  const near = p => Math.hypot(p.x - here.x, p.z - here.z) <= THAT_WAY && coverage.liesThatWay(here, p, heading);
  const off = p => `${Math.round(Math.hypot(p.x - here.x, p.z - here.z))} blocks off${Math.abs(p.y - here.y) >= 4 ? ` and ${Math.round(Math.abs(p.y - here.y))} ${p.y > here.y ? 'up' : 'down'}` : ''}`;
  for (const { spot } of blazeSpots(bot, goal)) if (near(spot)) out.push(`the blazes seen ${spot.seen || 1} time${(spot.seen || 1) === 1 ? '' : 's'} at (${spot.x}, ${spot.y}, ${spot.z}), ${off(spot)}`);
  for (const s of state.map?.spawners || []) if (near(s)) out.push(`the spawner seen at (${s.x}, ${s.y}, ${s.z}), ${off(s)}`);
  if (state.found && near(state.found)) out.push(`the fortress bricks last found at (${state.found.x}, ${state.found.y}, ${state.found.z}), ${off(state.found)}`);
  let landmarks = [];
  try { landmarks = require('./exploration').knownLandmarks(bot, goal, 'nether_fortress'); } catch (_) { landmarks = []; }
  for (const { landmark: l } of landmarks) if (near(l) && !(state.found && Math.hypot(l.x - state.found.x, l.z - state.found.z) < 32)) out.push(`the fortress remembered at (${l.x}, ${l.y ?? '?'}, ${l.z}), ${off({ ...l, y: l.y ?? here.y })}`);
  return out.length ? ` Seen before and lying this way: ${out.slice(0, 4).join('; ')}.` : '';
}

// The next leg is Jev's (fortress_leg): each heading surveyed at the
// height the bot stands (nether-travel.js surveyLeg), and, off the
// fortress heights, a staircase down or up toward them. mid-205-m's
// thirteen legs went the way the compass said at y 96 to 104, six seconds a
// cell of netherrack and nothing seen (note 394, 2026-09-27). With a leg short of blocks, the ways to more are
// beside the legs: mining what is round the bot, or back through the
// portal; the code chose between them itself after four failed ticks, and
// mined netherrack in a delta of basalt (note 480).
// A fortress in view is one of the ways too (fortress, from fortressInView):
// staying in it, or going back into one left or set aside. mid-235-p stood
// in its fortress at minute 52 and was asked only for legs, twice: six
// "patrols" in under a second, none a step, then leg_north; four minutes
// later, back at the same fortress's far side, its bricks still filtered
// as left behind, leg_north again, told "from y 49 none is seen" five
// blocks from the bricks (note 507).
// The fortress the search already knows, when none is in view and rods are
// still owed: where, how far, how long known, whether and why it is set
// aside, and the walk back to it as a way. -> { at, off, says, option } or null.
function knownFortressOutOfView(bot, goal, state, here, now = Date.now()) {
  let rods = 0; try { rods = require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { rods = 0; }
  if (!(rods > 0) || !/nether/.test(String(bot.game?.dimension || ''))) return null;
  let p = state.fortressAt || state.approach?.found || state.found || null;
  if (!p) {
    let known = [];
    try { known = require('./exploration').knownLandmarks(bot, goal, 'nether_fortress'); } catch (_) { known = []; }
    p = known[0]?.landmark || null;
  }
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  const at = { x: Math.round(p.x), y: Math.round(Number.isFinite(p.y) ? p.y : here.y), z: Math.round(p.z) };
  const off = Math.round(Math.hypot(at.x - here.x, at.z - here.z));
  const reach = Math.max(p.extent || 0, 16);
  const aside = (state.shunned || []).filter(sh => sh.until > now && Math.hypot(sh.x - at.x, sh.z - at.z) <= Math.max(sh.radius || 16, reach)).sort((a, b) => b.until - a.until)[0];
  const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };
  const knownFor = p.firstAt ? `, known ${mins(now - p.firstAt)}` : '';
  const asideSays = aside ? ` It is set aside ${mins(aside.until - now)} more: ${aside.why || 'left for now'}${aside.from ? `, from (${aside.from.x}, ${aside.from.y}, ${aside.from.z})` : ''}${aside.left?.length ? `, its ways in then: ${aside.left.slice(0, 6).join(', ')}` : ''}.` : ' It is not set aside.';
  // The walk back found no way from about here (note 775): said on the way
  // back and in the facts, with what each way that could change it does.
  const failed = backFailedHere(state, here, at, now);
  const failedSays = failed ? ` Tried ${Math.max(1, Math.round((now - failed.at) / 1000))} seconds ago from about here: the walk back (the pathfinder, then straight across at this height, then the staircase) found no way, ${failed.why}${failed.carried != null ? `, with ${failed.carried} blocks carried` : ''}.` : '';
  const says = `The fortress at (${at.x}, ${at.y}, ${at.z}), ${off} blocks off and out of view${knownFor}; ${rods} blaze rod${rods === 1 ? '' : 's'} still needed, and it is where they are known to be.${asideSays}${failedSays} Every leg from here searches for another fortress.`;
  const option = save => ({ description: `Go back to the fortress known at (${at.x}, ${at.y}, ${at.z}), ${off} blocks off: ${rods} blaze rod${rods === 1 ? '' : 's'} still needed, and it is where they are known to be. The walk is the leg's own (the pathfinder, then straight across, then the staircase), and once its bricks are in view the way in is asked.${aside ? ` Taken, it is no longer set aside (${aside.why || 'left for now'}).` : ''}${failedSays}`,
    target: at,
    run: () => {
      state.shunned = (state.shunned || []).filter(sh => Math.hypot(sh.x - at.x, sh.z - at.z) > Math.max(sh.radius || 16, reach));
      delete state.leaving;
      // A level walk headed at it: the mode and heading the last leg left
      // (a staircase, the floor, a step round) are not the way back, and the
      // chat said "Searching past the fortress ... heading east" of a walk
      // west (25585, note 775).
      const toward = bearingOf(here, at);
      state.heading = toward; state.lastHeading = toward; state.legMode = 'level'; delete state.descent; delete state.sidestep;
      state.target = { ...at }; state.rememberedTarget = true; state.legSince = Date.now(); state.legFrom = { x: Math.round(here.x), z: Math.round(here.z) };
      delete state.lastLegError; delete state.lastCrossStop; delete state.legBest;
      save(); return 'fortress';
    } });
  // Within the leg's own arrival (8 blocks) the walk there is no walk.
  return { at, off, says, option: off >= 8 ? option : null, ...(failed ? { failed } : {}) };
}
// The walk back to a fortress known that found no way, from within 16 blocks
// of here in the last ten minutes (note 775).
const BACK_FAILED_MS = 10 * 60000, BACK_FAILED_NEAR = 16;
function backFailedHere(state, here, at = null, now = Date.now()) {
  const f = state?.backFailed;
  if (!f || now - f.at > BACK_FAILED_MS || !here) return null;
  if (Math.hypot(f.from.x - here.x, f.from.y - here.y, f.from.z - here.z) > BACK_FAILED_NEAR) return null;
  if (at && Math.hypot(f.target.x - at.x, f.target.z - at.z) > 16) return null;
  return f;
}

async function chooseLeg(bot, task, goal, save, actions, state, fortress = null) {
  const here = bot.entity.position, y = Math.round(here.y);
  const current = headingIndex(state);
  // What the last leg cost the pickaxes, kept for the budget said below
  // (pickaxe-budget.js legBudgetSays, note 751).
  const budget = require('./pickaxe-budget');
  budget.noteLegWear(bot, state);
  const surveys = HEADINGS.map(h => surveyLeg(bot, h, { cells: FORTRESS_LEG }));
  // What each heading would show that has not been seen, and what seen
  // before lies that way (nether-coverage.js): a leg into air already
  // looked across was offered on the same terms as one into space never
  // seen (note 572). A full look from here first.
  const dim = coverage.dimOf(bot);
  coverage.look(bot, state);
  // Where fortresses can begin (nether-regions.js): each heading says where
  // it leaves the region the bot stands in and what is known past it. mid-
  // 243-ch walked thirteen legs round a bastion's region, where no fortress
  // begins, never told so (note 652). What a leg opens there is said apart
  // (note 751).
  const landmarks = goal.landmarks || [];
  const barren = regions.barrenAt(landmarks);
  const seenThatWay = HEADINGS.map(h => coverage.headingCoverage(state, dim, here, h, { length: FORTRESS_LEG, bot, barren }));
  const thatWay = HEADINGS.map(h => sightingsThatWay(bot, goal, state, here, h));
  const headingSays = i => thatWay[i] + regions.headingRegionSays(here, HEADINGS[i], regions.known(landmarks), state, dim);
  const back = state.legFrom && Number.isInteger(state.lastHeading) ? (state.lastHeading + 2) % 4 : null;
  // What a leg is for, first: the new ground it looks over, whether it goes
  // back over the last leg's own line, and where it ends against where the
  // search began. 25598 (mid-243-hb) at 21:07:55Z on 2026-09-29 went west 90
  // blocks, ran out of blocks over the lava sea, and chose leg_east (0.2
  // against 0.19) straight back over them to x -358: "back the way the last
  // leg came" and "mostly seen" were said, 1,100 characters in, after the
  // cells and the blocks (note 688).
  state.origin ||= { x: Math.round(here.x), z: Math.round(here.z) };
  const origin = state.origin;
  const fromStart = p => Math.round(Math.hypot(p.x - origin.x, p.z - origin.z));
  const endSays = (i, length = FORTRESS_LEG) => ` Its end is ${fromStart({ x: here.x + HEADINGS[i][0] * length, z: here.z + HEADINGS[i][1] * length })} blocks from where the search began (the bot is ${fromStart(here)} from there now).`;
  const lastFrom = back === null ? null : Math.round(Math.hypot(state.legFrom.x - here.x, state.legFrom.z - here.z));
  // Said last in the leg's words and as the search's loss: said first as
  // "ground just walked" it read as the one sure way, and the recorded
  // question went leg_east 10 of 10 (seek_fortress_height 9 of 10 as now).
  const backSays = i => i !== back ? '' : coverage.backSays(lastFrom, HEADING_NAMES[i], FORTRESS_LEG);
  const legLead = i => `${coverage.headingSays(seenThatWay[i], HEADING_NAMES[i])}${endSays(i)}`.trim() + ' ';
  const { restingSays } = require('./tunneling');
  // Each way's staircase as the step would dig it (fortressLegTarget), and
  // whether it rests: a level leg digs one where the walk and the span give
  // out, and the fortress heights are one alone.
  const rests = mode => HEADINGS.map((h, i) => restingSays(goal, fortressLegTarget({ heading: i, legMode: mode }, here), here));
  const levelRests = rests('level');
  const options = {};
  const resting = [];
  // A leg whose own line is closed at its first cell (lava in the way,
  // rock with lava or water behind it) makes no ground: said, not offered.
  // mid-244-ab-nether-2, in a pocket over the lava sea, was offered legs of
  // ninety-six blocks that each ended at once, and asked again and again
  // (note 572).
  const blocked = [];
  // The walk each level leg takes first, the pathfinder toward its end
  // (findFortressStep), said with the line read from here (note 751b).
  const walkFirst = [], walkEnds = [];
  for (const [i] of HEADINGS.entries()) {
    if (legResting(state, HEADING_NAMES[i], here) || surveys[i]?.stoppedAt === 0) continue;
    walkFirst[i] = await require('./nether-travel').legWalkSays(bot, task, fortressLegTarget({ heading: i, legMode: 'level' }, here), { state, keep: walkEnds, i });
  }
  HEADINGS.forEach((h, i) => {
    const rest = legResting(state, HEADING_NAMES[i], here);
    if (rest) { resting.push(restSays(HEADING_NAMES[i], rest)); return; }
    if (surveys[i]?.stoppedAt === 0) { blocked.push(`leg ${HEADING_NAMES[i]}: closed at the first cell at y ${y}, ${surveys[i].stoppedBy}`); return; }
    options[`leg_${HEADING_NAMES[i]}`] = { description: legLead(i) + legSays(surveys[i], { direction: HEADING_NAMES[i], length: FORTRESS_LEG, y }) + (walkFirst[i] || '') + triedSays(state, HEADING_NAMES[i], here, surveys[i], walkEnds[i], blocksCarried(bot)) + require('./pickaxe-budget').lastPickaxeSays(bot, surveys[i]?.rockBlocks) +
      legHistorySays(state, HEADING_NAMES[i], here) +
      (levelRests[i] ? ` Where the walk and the span give out, ${levelRests[i]}.` : '') + headingSays(i) + backSays(i),
      run: () => { state.heading = i; state.legMode = 'level'; return true; } };
  });
  // Round what stops a heading's line: where lava, rock with lava or water
  // behind it, or rock no hand breaks stops the line short of its ninety-
  // six blocks, the same heading from a step to either side (8 to 32
  // blocks), offered where that line goes farther than the straight one
  // (roundLeg). 25593 (mid-242-xd, 11:12:33Z on 2026-09-30) went north 70
  // blocks to "lava or water behind the netherrack", was offered only the
  // four headings from there, and took leg_south back over the 67 blocks
  // it had just walked; a player steps along the wall and goes on (note 751).
  HEADINGS.forEach((h, i) => {
    const key = `round_${HEADING_NAMES[i]}`;
    const rest = legResting(state, key, here);
    if (rest) { resting.push(restSays(key, rest)); return; }
    const round = roundLeg(bot, surveys[i], i);
    if (!round) return;
    const at = new Vec3(round.from.x + 0.5, round.from.y, round.from.z + 0.5);
    const seen = coverage.headingCoverage(state, dim, at, h, { length: FORTRESS_LEG, bot, barren });
    const sideName = HEADING_NAMES[round.side];
    const roundEnd = { x: round.from.x + h[0] * FORTRESS_LEG, z: round.from.z + h[1] * FORTRESS_LEG };
    options[key] = { description: `${coverage.headingSays(seen, HEADING_NAMES[i]).trim()} Its end is ${fromStart(roundEnd)} blocks from where the search began (the bot is ${fromStart(here)} from there now). Go round what stops the line ${HEADING_NAMES[i]} (${surveys[i].stoppedBy} at cell ${surveys[i].stoppedAt}): ${round.off} blocks ${sideName} first (${round.sideSays}), then ${HEADING_NAMES[i]} ${FORTRESS_LEG} blocks from there, a line ${round.off} blocks ${sideName} of this heading's: ${legSays(round.line, { direction: HEADING_NAMES[i], length: FORTRESS_LEG, y: round.from.y })} Its line goes ${round.reach} cells before anything stops it, against ${surveys[i].stoppedAt} for the straight one; about ${round.seconds} seconds in all.` +
      legHistorySays(state, key, here) + headingSays(i),
      run: () => { state.heading = i; state.legMode = 'round'; state.legShift = { x: HEADINGS[round.side][0] * round.off, z: HEADINGS[round.side][1] * round.off }; state.sidestep = { ...round.from, key }; return true; } };
  });
  // Down to the floor and along it: where the ground under the bot lies
  // four or more below and a way down to it is found, each heading's floor
  // walked from the foot of that way (nether-travel.js). mid-244-ad-nether-2
  // laid ninety blocks of span at y 74 over a cavern floor walkable fifteen
  // to twenty below, and chose to go back for blocks twenty-eight times
  // (note 568): only the level legs were offered.
  const down = typeof bot.blockAt === 'function' ? floorWay(bot) : null;
  if (down) HEADINGS.forEach((h, i) => {
    const key = legKey(i, 'floor'), rest = legResting(state, key, here);
    if (rest) { resting.push(restSays(key, rest)); return; }
    const floor = walkFloor(bot, down.way.end, headingColumns(down.way.end, h, FORTRESS_LEG));
    if (floor.floor < FLOOR_WALKABLE) return;
    const fortressUp = down.y < 48 ? ` Fortress corridors stand mostly between y 48 and 75: from the floor at y ${down.y} they are seen above through open air, and reached by climbing to them.` : '';
    options[key] = { description: `${legLead(i)}Go down to the floor and walk it ${HEADING_NAMES[i]} ${FORTRESS_LEG} blocks, bridging only across the lava and open air on it. ${wayDownSays(down)} ${floorWalkSays(floor, { along: HEADING_NAMES[i] })}${fortressUp}` +
      legHistorySays(state, key, here) + headingSays(i) + backSays(i),
      run: () => { state.heading = i; state.legMode = 'floor'; state.floorY = down.y;
        state.descent = { x: down.way.end.x, y: down.way.end.y, z: down.way.end.z, floorY: down.y, maxDrop: down.way.maxDrop, dug: down.way.dug, path: down.way.path.map(p => ({ x: p.x, y: p.y, z: p.z })) }; return true; } };
  });
  // The search widened, not turned back: the next side of a square spiral
  // round where it began (nether-coverage.js spiralSide), a way of its own
  // beside the legs, offered where the level leg that way is. Each side
  // goes clockwise along a ring and the next ring is 96 blocks farther out,
  // so no side goes back over another; the legs of ninety-six blocks from
  // the compass went back and forth over the same ground (note 688).
  // The leg back over the last one comes after the ways past what stopped
  // it and the other headings, said as what it is (backSays, note 751).
  if (back !== null && options[`leg_${HEADING_NAMES[back]}`]) { const o = options[`leg_${HEADING_NAMES[back]}`]; delete options[`leg_${HEADING_NAMES[back]}`]; options[`leg_${HEADING_NAMES[back]}`] = o; }
  const side = coverage.spiralSide(origin, here);
  const sideLeg = `leg_${HEADING_NAMES[side.heading]}`;
  let widenUnseen = null;
  if (options[sideLeg]) {
    const seen = coverage.headingCoverage(state, dim, here, HEADINGS[side.heading], { length: side.length, bot });
    widenUnseen = seen.cells ? seen.unseenInView ?? seen.unseen : null;
    options.widen_search = { description: `Widen the search: the next side of a square spiral round where it began at (${origin.x}, ${origin.z}), clockwise, each ring ${coverage.RING} blocks past the last, so no side goes back over another. From here: ${HEADING_NAMES[side.heading]} ${side.length} blocks, ending ${side.endFrom} blocks from the start.${coverage.headingSays(seen, HEADING_NAMES[side.heading])} Its first ${Math.min(FORTRESS_LEG, side.length)} blocks are as ${sideLeg} says.${backSays(side.heading)}`,
      run: () => { state.heading = side.heading; state.legMode = 'level'; state.legLength = side.length; return true; } };
  }
  const off = y - FORTRESS_Y;
  if (Math.abs(off) > FORTRESS_BAND && actions.tunnel) {
    // A heading whose staircase rests is not offered as a fresh one: mid-
    // 202-o-nether-2 chose seek_fortress_height north four times in three
    // minutes, its staircase resting since 20:53 and never said, and each
    // step threw before a stair (note 500). All resting, the rest is said.
    const seekRests = rests('descend');
    const open = seekRests.some(r => !r) ? HEADINGS.map((h, i) => i).filter(i => !seekRests[i]) : HEADINGS.map((h, i) => i);
    const most = surveys.every(s => !s) && open.includes(current) ? current : open.map(i => [surveys[i]?.open || 0, i]).sort((a, b) => b[0] - a[0] || (a[1] === current ? -1 : b[1] === current ? 1 : 0))[0][1];
    const passed = HEADINGS.map((h, i) => i).filter(i => seekRests[i] && i !== most).map(i => ` Not heading ${HEADING_NAMES[i]}: ${seekRests[i]}.`).join('');
    const seekRest = legResting(state, legKey(most, true), here);
    // With no pickaxe the staircase digs its rock by hand at the game's
    // times (note 705): from where no step toward the heights gains it is
    // not a way, said among the closed; else it says the seconds. 25585 was offered
    // it with no pickaxe over and over and it ended "no route" (note 687).
    const byHand = require('./block-stock').pickaxeCarried(bot) ? { offered: true, says: '' }
      : (() => { const to = fortressLegTarget({ heading: most, legMode: 'descend' }, here), bs = require('./block-stock');
        return bs.handWaySays(bot, require('./tunneling').stairFromHere(bot, goal, to), bs.handLine(bot, to)); })();
    if (seekRest) resting.push(restSays(legKey(most, true), seekRest));
    else if (!byHand.offered) blocked.push(`the staircase toward the fortress heights heading ${HEADING_NAMES[most]}: ${byHand.says}`);
    else options.seek_fortress_height = { description: `Dig a staircase ${off > 0 ? 'down' : 'up'} toward y ${FORTRESS_Y} heading ${HEADING_NAMES[most]}, ${Math.abs(off)} blocks of height, a step at a time with rock round the bot and no block dug with lava or water behind it: fortress corridors and bridges stand mostly between y 48 and 75, over the lava sea at y 31, and from y ${y} ${fortress ? 'only what open air shows is seen, the fortress in view among it' : 'none is seen through the rock'}. The leg goes level again once within ${FORTRESS_BAND} of y ${FORTRESS_Y}.` +
      (seekRests[most] ? ` ${capital(seekRests[most])}: taken now, it digs nothing until then.` : '') + byHand.says + stairDigs(bot, goal, fortressLegTarget({ heading: most, legMode: 'descend' }, here)) + passed + legHistorySays(state, legKey(most, true), here, 'staircase'),
      run: () => { state.heading = most; state.legMode = 'descend'; return true; } };
  }
  if (fortress) {
    if (fortress.offer !== false) options[fortress.key] = { description: fortress.description, run: fortress.run };
    // Off its floors, straight at it with the blocks mined here first: a
    // way in the legs' blocks never were (note 591). Chosen here it is
    // carried out, not the fortress's ways asked again (the flip of note
    // 541), so it is offered from where Jev left the fortress over it too,
    // said so; the ledger rests it where it comes to nothing.
    const bricks = fortress.bricks || [];
    if (fortress.key === 'back_to_fortress' && bricks.length && actions.mineAt && actions.navigate) {
      const floors = fortressFloors(bot, bricks), near = list => list.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
      const target = near(floors.length ? floors : bricks);
      const cross = mineThenCrossPlan(bot, goal, target, bricks);
      if (cross) {
        const off = Math.round(flatTo(target, here)), dy = Math.round(target.y + 1 - here.y);
        options.blocks_then_cross = { description: mineThenCrossSays(bot, cross, `${off} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}` : ''}`) +
          (fortress.facts?.setAside ? ` The fortress is ${fortress.facts.setAside.replace(/:.*$/, '')}; taken, it is no longer set aside.` : '') +
          ((fortress.leftHere || []).includes('blocks then cross') ? ' Jev left the fortress from where the bot stands with this way among its ways in.' : ''),
          run: async () => {
            state.shunned = (state.shunned || []).filter(sh => !bricks.some(b => Math.hypot(sh.x - b.x, sh.z - b.z) <= (sh.radius || 16)));
            delete state.leaving; delete state.target; save();
            const why = await mineThenCross(bot, task, goal, save, actions, state, cross);
            if (why) state.lastLegError = `the crossing to the fortress: ${why}`;
            save(); return 'cross';
          } };
      }
    }
    for (const [key, o] of Object.entries(fortress.others || {})) options[key] = o;
    // Where the fortress's bricks go from here, said with each heading: its
    // corridors run on past the last brick seen (fortressRuns).
    const runs = fortressRuns(fortress.bricks || [], here);
    HEADINGS.forEach((h, i) => { if (runs[i] >= 8 && options[`leg_${HEADING_NAMES[i]}`]) options[`leg_${HEADING_NAMES[i]}`].description += ` The fortress's bricks in view run ${runs[i]} blocks this way from here; what lies past them is unseen.`; });
    // Each leg against the fortress in view: toward it or away (note 708).
    // 25584 took leg_east 60 blocks away from a fortress 104 blocks west,
    // the legs said as a search for one.
    const near = (p, list) => Math.round(Math.min(...list.map(b => flatTo(b, p))));
    if (bricks.length) HEADINGS.forEach((h, i) => {
      const o = options[`leg_${HEADING_NAMES[i]}`];
      if (!o) return;
      const now = near(here, bricks), end = near({ x: here.x + h[0] * FORTRESS_LEG, z: here.z + h[1] * FORTRESS_LEG }, bricks);
      o.description = `${end < now - 8 ? 'Toward' : end > now + 8 ? 'Away from' : 'Across from'} the fortress in view: its end is ${end} blocks from its nearest brick (${now} now). ${o.description}`;
    });
  }
  // A fortress already known, out of view, with rods still owed: the Nether's
  // work is that fortress, so the legs say it and why it is left, and the
  // way back to it is a way of its own (note 750). 25590 (mid-242-yc) reached
  // the fortress milestone at (160, 60, 260) and 98 minutes later was on leg
  // 37 "looking for a fortress", north, away from it and from the stems it
  // wanted, told of neither (critic-20260930T1157Z item 1).
  let knownFortress = null;
  if (!fortress) knownFortress = knownFortressOutOfView(bot, goal, state, here);
  if (knownFortress) {
    const kf = knownFortress;
    HEADINGS.forEach((h, i) => {
      const o = options[`leg_${HEADING_NAMES[i]}`];
      if (!o) return;
      const end = Math.round(Math.hypot(here.x + h[0] * FORTRESS_LEG - kf.at.x, here.z + h[1] * FORTRESS_LEG - kf.at.z));
      o.description = `${end < kf.off - 8 ? 'Toward' : end > kf.off + 8 ? 'Away from' : 'Across from'} the fortress known at (${kf.at.x}, ${kf.at.y}, ${kf.at.z}), out of view: its end is ${end} blocks from it (${kf.off} now). ${o.description}`;
    });
    if (kf.option) options.back_to_fortress = kf.option(save);
  }
  // A blaze spawner the map holds is the place the blazes come from: each
  // not seen broken is a way of its own, nearest first (note 686). 25589
  // fought blazes at the cage at (-108, 77, 155), left it, and walked the
  // fortress's floors again and again, back_to_fortress each time: the
  // spawner was said only in fortressInView.map, and offered only as
  // wait_at_spawner, on the floors with nothing left to walk.
  const covered = fortress?.others?.wait_at_spawner?.spawner;
  const cages = spawnersKnown(bot, state).filter(k => k.off > GO_TO_NEAR && !wayLeft(state, k.s) && !(covered && covered.x === k.s.x && covered.y === k.s.y && covered.z === k.s.z)).slice(0, 3);
  if (cages.length) {
    const planned = require('./fortress-map').plan(bot, state.map);
    for (const [i, k] of cages.entries()) {
      // Keyed by the number the spawner was given when first offered
      // (keys.js, note 749): the nearest was go_to_spawner and the next
      // go_to_spawner_2, so which spawner a key named changed as the bot
      // walked between them.
      const s = k.s, key = `go_to_spawner_${require('./decisions/keys').id(goal, 'spawner', s, { base: 1 })}`, ended = state.goToEnded?.[`spawner:${s.x},${s.y},${s.z}`];
      // The pathfinder's survey toward the nearest only: a survey is up to
      // half a second on a loaded machine.
      const route = i === 0 && actions.navigate ? await routeSurvey(bot, task, new goals.GoalNear(s.x, s.y, s.z, 4), new Vec3(s.x, s.y, s.z)) : null;
      options[key] = { description: `Go to the blaze spawner ${spawnerSays(bot, goal, state, k, planned, route)} While the bot is within 16 of it, it makes up to 4 blazes every 10 to 40 seconds. The walk is on foot first; where it finds no way, the way there is asked (fortress_approach). There, with no blaze near, the stand is asked (empty_spawner).${ended ? ` The last try at it ended: ${ended.why}.` : ''}`,
        target: { x: s.x, y: s.y, z: s.z },
        run: () => { state.spawnerWait = { x: s.x, y: s.y, z: s.z, until: Date.now() + SPAWNER_GO_MS, startedAt: Date.now(), go: true }; delete state.spawnerWaitEnded; save(); return 'goto'; } };
    }
  }
  // Where blazes were seen, farther than the hunt's own look: the way back
  // to the busiest of them, walked on foot first and otherwise asked.
  // A place Jev left is not offered until its ten minutes are up (said
  // in waysLeft). The blazes about now are a way of their own.
  const spots = blazeSpots(bot, goal).filter(s => s.off > 12 && !wayLeft(state, s.spot));
  const about = blazesAbout(bot).filter(b => b.off > 12 && !wayLeft(state, b.entity.position.floored()));
  if (about.length && !(spots[0] && spots[0].spot.at > Date.now() - 60000 && Math.hypot(spots[0].spot.x - about[0].entity.position.x, spots[0].spot.y - about[0].entity.position.y, spots[0].spot.z - about[0].entity.position.z) <= 16)) {
    const b = about[0], p = b.entity.position.floored(), ended = state.goToEnded?.blazes_about;
    options.go_to_blazes_about = { description: `Go to the blazes about now: ${blazesAboutSays(about)}. The hunt takes each one as it comes into view within its reach. The walk there is on foot first, digging and laying nothing; where it finds no way, the way there is asked (fortress_approach: a span, a pillar, a drop or a staircase, each with what it meets).${ended ? ` The last try at blazes about ended: ${ended.why}.` : ''}`,
      target: { x: p.x, y: p.y, z: p.z }, run: () => { state.goTo = { x: p.x, y: p.y, z: p.z, kind: 'blazes_about', since: Date.now() }; save(); return 'goto'; } };
  }
  if (spots.length) {
    // The last try at this place, not at any place blazes were seen: 25581
    // (mid-243-jd, 12:58:18Z) was offered (-132, 57, 511) said "the hunt walked
    // back toward it 2 times, the last ending: No route ... beside lava" and,
    // in the same option, "The last try at it ended: reached it", which was
    // the walk to (-159, 59, 510) a moment before (note 750b).
    const best = spots[0], s = best.spot, spotKey = `${s.x},${s.y},${s.z}`, ended = state.goToEnded?.[`blazes:${spotKey}`];
    // The walk surveyed from here before it is offered, as the spawner's is:
    // a place whose route was refused says so from here now, not only from
    // an older walk's ending.
    const route = actions.navigate ? await routeSurvey(bot, task, new goals.GoalNear(s.x, s.y, s.z, 4), new Vec3(s.x, s.y, s.z)) : null;
    const routeSays = !route ? '' : !route.cells ? ' The pathfinder finds no route toward it from here now: the walk ends at once, and the way there is asked (fortress_approach).'
      : ` The pathfinder finds ${route.status === 'success' ? 'a whole route' : 'a route part of the way'} of ${route.cells} cells from here now, ending ${route.gain} blocks nearer.`;
    // Whether the bot has been near it on foot: the ground the search has
    // stood on is the one sign that there is a walk there.
    const stood = coverage.stoodNear(state, dim, s, 32);
    const way = HEADINGS.findIndex(h => coverage.liesThatWay(here, s, h));
    const reach = ` It lies ${way >= 0 ? `${HEADING_NAMES[way]} of here` : 'here'}; ${stood === null ? 'the bot has not stood within 32 blocks of it, so whether it can be walked to is not known' : `the bot has stood ${stood} blocks from it before`}.`;
    options.go_to_blazes = { description: `Go to where blazes were seen ${blazeSpotSays(best, here)}: blazes come from a spawner, which keeps its room full, and the hunt takes each one as it comes into view.${reach} The walk there is on foot first, digging and laying nothing; where it finds no way, the way there is asked (fortress_approach: a span, a pillar, a drop or a staircase, each with what it meets).${routeSays}${ended ? ` The last try at it ended: ${ended.why}.` : ''}`,
      target: { x: s.x, y: s.y, z: s.z }, run: () => { state.goTo = { x: s.x, y: s.y, z: s.z, kind: 'blazes', key: spotKey, since: Date.now() }; save(); return 'goto'; } };
  }
  // At a fortress in view with rods owed and blazes seen at it, the work is
  // reaching those blazes, by every way the fortress approach prices (its
  // walk, a level crossing, a dig down, a staircase, a pillar, the blocks for
  // them dug first), each offered here as a way to them (note 750e). 25583
  // (mid-230-ae, 04:32-04:42Z on 2026-10-01) stood at its fortress's bricks,
  // blazes seen there 70 times, 0 of 7 rods, and this question offered legs
  // to search for another and go_to_blazes on foot only ("no way across along
  // the ground found"); it took leg_north, round_north and leg_east by turns.
  let toBlazes = null;
  const rodsOwed = (() => { try { return require('./blaze-stand').rodsNeeded(bot, goal); } catch (_) { return 0; } })();
  if (fortress && rodsOwed > 0 && (fortress.bricks || []).length && actions.navigate) {
    const bricks = fortress.bricks;
    const atIt = sp => bricks.some(b => Math.hypot(b.x - sp.x, b.z - sp.z) <= BLAZES_AT && Math.abs(b.y - sp.y) <= BLAZES_AT);
    const spot = blazeSpots(bot, goal).filter(s => !wayLeft(state, s.spot) && atIt(s.spot) && s.off > 4)[0];
    if (spot) {
      const s = spot.spot, target = new Vec3(s.x, s.y, s.z), key = `${s.x},${s.y},${s.z}`;
      const record = state.blazeWay?.key === key ? state.blazeWay : (state.blazeWay = { key, failed: [] });
      const ways = await fortressApproaches(bot, task, goal, save, actions, state, target, [], record);
      const lead = `To the blazes seen ${blazeSpotSays(spot, here)}, at this fortress, with ${rodsOwed} blaze rod${rodsOwed === 1 ? '' : 's'} still needed: `;
      toBlazes = { spot: key, facts: ways.facts, keys: [] };
      for (const [k, o] of Object.entries(ways.options)) {
        if (!/^(walk_route|cross_level|descend|tunnel|pillar_up|blocks_then_pillar|blocks_then_cross|head_toward)$/.test(k)) continue;
        const name = `blazes_${k}`;
        toBlazes.keys.push(name);
        options[name] = { description: `${lead}${o.description.replace(/the fortress(?=[, ])/, 'the place')}`, target: { x: s.x, y: s.y, z: s.z },
          run: async () => {
            const from = target.distanceTo(bot.entity.position), startedAt = bot.entity.position.clone();
            let why = null;
            try { why = await o.run(); } catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
            if (target.distanceTo(bot.entity.position) < from - STEP_GAIN) { record.failed = []; save(); return 'way'; }
            record.failed = [...record.failed, { choice: k, why: why || 'came no nearer', at: Date.now(), from: { x: startedAt.x, y: startedAt.y, z: startedAt.z }, kit: { carried: blocksCarried(bot), tier: bot.inventory?.items ? pickaxeTier(bot) : 0 } }].slice(-8);
            s.tries = (s.tries || 0) + 1; s.why = why || 'came no nearer'; save();
            return 'way';
          } };
      }
    }
  }
  const short = surveys.some(s => Number.isInteger(s?.runsOut));
  { const most = surveys.filter(s => Number.isInteger(s?.runsOut)).sort((a, b) => (b.lay || 0) - (a.lay || 0))[0]; if (most) require('./block-stock').noteBlocksShort(goal, most.lay, most.carried, 'the longest leg short of blocks'); }
  // With no pickaxe carried and none to be made from what is carried, rock
  // dug by hand drops nothing: no restock to offer, and each leg says so.
  // 25585 was offered "Dig 35 blocks ... about 78 seconds" with "none can
  // be made" in the same line (note 655).
  // Kept past the block so the portal trip below can see whether blocks are
  // still to be had here (note 729): 25591 stood on netherrack with a
  // pickaxe and was sent 109 blocks to the portal "for stone" while
  // restock_blocks itself found blocks within reach.
  let plan = null, groundSaid = null;
  if (short && actions.mineAt && actions.navigate) {
    plan = restockPlan(bot, goal, surveys);
    if (plan.want && !pickaxeFirst(bot).none) {
      options.restock_blocks = { description: restockSays(bot, plan, state.lastRestock),
        run: async () => { state.restock = { want: blocksCarried(bot) + plan.want, since: Date.now(), said: plan.seconds, from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) }, ...(plan.far ? { far: true } : {}) }; save(); await restockStep(bot, task, goal, save, actions, state); return 'restock'; } };
    }
    // Fewer than the leg needs to be had here: back to the rock last stood
    // on, the way it came, as a player walks back along the bridge (note
    // 695). Offered by the pathfinder's own route there, the walk its run
    // makes first; with none, said. Offered with no pickaxe too (note 729):
    // 25594 sat 14+ minutes on the tip of its own span with no pickaxe and
    // 197 blocks carried, and this was gated behind a pickaxe it did not
    // need to walk back the way it came.
    if (plan.want < plan.need) {
      const back = await backToGround(bot, task, goal, state, plan);
      if (back?.option) { options.back_to_ground = back.option(actions, save); groundSaid = back.where; }
      else if (back?.says) blocked.push(back.says);
    }
  }
  // With no pickaxe, making one is a way of its own: every leg through rock,
  // the staircase and the blocks for a span wait on it. 25581 was told what
  // a pickaxe takes and that it carried it (blockStock.makingAPickaxe), was
  // never offered making one, and answered none_good (note 654).
  const pick = pickaxeFirst(bot);
  if (!pick.carried && !pick.none && actions.acquireStep) {
    options.make_pickaxe = { description: `Make ${pick.name} here from what is carried (${pick.from}), a few seconds at a crafting table: with it rock is dug several times faster and the netherrack dug comes back as blocks to lay, for spans and pillars. Without it rock is dug by hand, slowly, dropping nothing, and ${blocksCarried(bot)} block${blocksCarried(bot) === 1 ? '' : 's'} can be laid. The leg is chosen again after.`,
      run: async () => {
        const unmade = await makePickaxe(bot, task, goal, save, actions, pick);
        if (unmade) throw new Error(`The pickaxe was not made: ${unmade}`);
        return 'pickaxe';
      } };
  }
  // No pickaxe and none to be made for want of wood: the stems of the
  // Nether's forests, the nearest known and the way there (nether-wood.js).
  // 25583 had thirty ingots and warped stems eleven blocks off, and 25585
  // tunnelled its legs by hand with one plank (notes 655, 658).
  if (pick.none && actions.acquireStep) {
    const nw = require('./nether-wood');
    const fetch = await nw.fetchStemsOffer(bot, task, goal);
    if (fetch) options.fetch_stems = { description: `${await fetch.describe()} The leg is chosen again after.`,
      run: async () => {
        const done = await nw.fetchStems(bot, task, goal, save, { acquireStep: actions.acquireStep });
        if (done.unmade) throw new Error(done.unmade);
        return 'pickaxe';
      } };
  }
  // Offered only by a portal there is to go back by: one remembered here,
  // the one the bot came through worked out from its Overworld side, or
  // one in view. 25597 (mid-242-gf) was offered it with none of those
  // (the one it knew then lay past the walk back's reach), chose it, and
  // the code answered "No loaded return portal observed" (note 685).
  // Still Jev's to weigh against restock_blocks (mid-211-s kept both, note
  // 480): what changes here is the fact it is given, not the option taken
  // away (note 693's "no bandaids"). 25591 was told "for stone" while
  // standing on netherrack with a pickaxe; returnForKitSays now says what
  // is actually short and what restock_blocks itself found here (`plan`).
  // With no pickaxe and none to be made from the pockets, the trip home is a
  // way to one too (iron, stone and wood there), priced beside the stems
  // (note 751): 25593 fetched stems for nineteen wooden pickaxes in two hours.
  const homeBy = (short || pickaxeFirst(bot).none) && actions.returnOverworld ? portalBack(bot, goal, here) : null;
  const homeStart = homeBy ? portalTripStart(bot, goal, homeBy) : null;
  if (homeBy && !homeStart.ok) blocked.push(`back through the portal (${homeBy.says}): ${homeStart.why}`);
  if (homeBy && homeStart.ok) {
    options.return_for_blocks = { description: returnForKitSays(bot, homeBy, { goal, plan, ground: groundSaid }),
      run: async () => { await actions.returnOverworld(bot, task, goal, save); return 'returned'; } };
  }
  // A fortress floor known overhead within a climb's reach: the climb with
  // what is carried, or the blocks dug for it first (note 694).
  const overhead = !onFortressFloors(bot, state) ? fortressOverhead(bot, goal) : null;
  let climbFact = null;
  if (overhead) {
    const climb = climbWays(bot, task, goal, save, actions, state, overhead);
    Object.assign(options, climbOffers(climb, overhead, state));
    climbFact = climb.noPillar;
  }
  // A leg short of blocks and a pickaxe to dig more here: the digging is
  // named first, before the legs over open air it is for (note 751c; a
  // player mines a stack before stepping out over the void).
  if (options.restock_blocks && surveys.some(sv => Number.isInteger(sv?.runsOut))) { const r = options.restock_blocks; delete options.restock_blocks; const rest = { ...options }; for (const k of Object.keys(options)) delete options[k]; Object.assign(options, { restock_blocks: r }, rest); }
  // The walk back to the fortress known found no way from about here (note
  // 775): the ways that change what stopped it (blocks dug here, stems for a
  // pickaxe, a pickaxe made) are named first, each saying so, then the way
  // back with its failure, then the legs away; not the legs away alone.
  if (knownFortress?.failed) {
    const f = knownFortress.failed, ago = Math.max(1, Math.round((Date.now() - f.at) / 1000));
    const lead = ['restock_blocks', 'fetch_stems', 'make_pickaxe'].filter(k => options[k]);
    for (const k of lead) options[k].description += ` The walk back to the fortress at (${knownFortress.at.x}, ${knownFortress.at.z}), ${knownFortress.off} blocks off, found no way from about here ${ago} seconds ago (${f.why}); the leg's question is asked again after this, with the way back on offer.`;
    const first = [...lead, ...(options.back_to_fortress ? ['back_to_fortress'] : [])];
    if (first.length) { const rest = Object.fromEntries(Object.entries(options).filter(([k]) => !first.includes(k))); const head = Object.fromEntries(first.map(k => [k, options[k]])); for (const k of Object.keys(options)) delete options[k]; Object.assign(options, head, rest); }
  }
  // Every way from here rests or is gone: nothing to ask. The step says so
  // and the stall's own question takes it from there.
  // With a way to the blazes on offer, a search for another fortress is not
  // (note 750e): said, the legs left out. With none, they stay, as before.
  let searchNotOffered = null;
  if (toBlazes?.keys.length) {
    const searches = Object.keys(options).filter(k => /^(leg_|round_|floor_)|^(widen_search|seek_fortress_height)$/.test(k));
    for (const k of searches) delete options[k];
    if (searches.length) searchNotOffered = `the search for another fortress (${searches.map(k => k.replaceAll('_', ' ')).join(', ')}) is not offered: this fortress, in view, is where blazes were seen and ${rodsOwed} rod${rodsOwed === 1 ? ' is' : 's are'} still needed, and ${toBlazes.keys.length === 1 ? 'a way' : `${toBlazes.keys.length} ways`} to those blazes ${toBlazes.keys.length === 1 ? 'is' : 'are'} offered`;
  }
  const left = waysLeftSays(state, here);
  if (!Object.keys(options).length) throw new Error(`No leg from here can be walked, dug or bridged: ${[...blocked, ...resting].join('; ')}${left ? `; and the ways Jev left: ${left.join('; ')}` : ''}`);
  try { require('./healing').withNoHealSays(bot, goal, options); } catch (_) { /* no body */ }
  // With no pickaxe and a way to one on offer, the question leads with it:
  // its first line what the ways here lack without one, and the ways to one
  // first. 25589 answered carry_on to 37 of 42 upkeeps in four hours
  // and fetch_stems stayed second here while every way in dug or laid (note
  // 687).
  const bs = require('./block-stock');
  // At the fight by a spawner with a sword carried, the pickaxe is not what
  // the rods need now: said, not put first (cage-hold.js, note 700).
  const swordThere = require('./cage-hold').swordNotPickaxe(bot, goal);
  const lead = swordThere ? null : bs.pickaxeLead(bot, PICKAXE_WAYS.filter(k => options[k]), blocked.filter(b => /no pickaxe|does not break/.test(b)).map(b => b.split(':')[0]));
  if (swordThere) { if (options.fetch_stems) options.fetch_stems.description += ` ${swordThere.leaves}`; if (options.make_pickaxe) options.make_pickaxe.description += ` ${swordThere.makes}`; }
  const tree = Object.fromEntries(Object.entries(lead ? bs.pickaxeFirstOrder(options) : options).map(([k, o]) => [k, { description: o.description, ...(o.target ? { target: o.target } : {}), ...(o.waits ? { waits: o.waits } : {}) }]));
  const blazesSeen = blazesSeenFacts(bot, goal);
  const facts = { ...(lead ? { withoutAPickaxe: lead } : {}), ...(blazesSeen ? { blazesSeen } : {}), height: y, fortressHeights: 'corridors and bridges mostly between y 48 and 75, over the lava sea at y 31; bricks are seen within 128 blocks, and only through open air',
    legsSoFar: state.legs || 0, minutesSearching: state.since ? Math.round((Date.now() - state.since) / 60000) : 0,
    lastLeg: Number.isInteger(state.lastHeading) ? (() => { const seeking = state.legMode === 'descend', h = state.legHistory?.[legKey(state.lastHeading, state.legMode)];
      return `${seeking ? 'a staircase toward the fortress heights ' : state.legMode === 'floor' ? 'down to the floor and along it ' : state.legMode === 'round' ? 'round what stopped the line ' : ''}${HEADING_NAMES[state.lastHeading]}${h ? `, ended no nearer: ${h.ended}` : ''}`; })() : null,
    ...(resting.length ? { legsResting: resting } : {}), ...(blocked.length ? { legsClosed: blocked } : {}),
    seenSoFar: coverage.coverageSays(state, dim, here, FORTRESS_LEG),
    ...(left ? { waysLeft: left } : {}),
    structureRegions: regions.regionFacts(here, landmarks, state, dim), ...portalBackFact(goal, here),
    blocksCarried: blocksCarried(bot), pickaxe: pickaxeSays(bot, goal), pickaxeBudget: budget.legBudgetSays(bot, state), health: bot.health, food: bot.food, threatsInView: threatsInView(bot).map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    // Hurt or hungry, the search's own state does not say what going on
    // costs: it names the height fortresses stand at and the blocks
    // carried, never health, food carried or what fights begun this hurt
    // have come to. 25597 chose leg after leg at 13.5 health and hunger 17
    // with nothing to eat, none of that said (note 734). Said whenever
    // health or hunger is short of full, as fitnessSays does for a hunt:
    // health, whether it comes back, and food carried in words, not a
    // number alone; under fourteen health (the fight floor, HUNT_FLOOR)
    // the played record's row (blaze-record.js rowSays) is added, since the
    // search is toward the fights that need it.
    ...((bot.health < 20 || (bot.food ?? 20) < 20) ? { fitness: `${fitnessSays(bot)}${bot.health < HUNT_FLOOR ? ` ${require('./blaze-record').rowSays(bot.health, bot.food ?? 20)}.` : ''}` } : {}),
    ...(fortress ? { fortressInView: fortress.facts } : {}), ...(knownFortress ? { fortressKnown: knownFortress.says } : {}),
    ...(toBlazes ? { toTheBlazes: Object.fromEntries(Object.entries(toBlazes.facts).filter(([k]) => /^(walkRoute|staircase|pillar|crossLevel|descend|byHand|triedFromHere|failed|whatAHitCosts)$/.test(k))) } : {}), ...(searchNotOffered ? { searchNotOffered } : {}), ...(climbFact ? { climb: climbFact } : {}), ...rodsFact(bot, goal) };
  // The old order's facts (the most ground unseen, the open air each
  // heading's blocks reach): context, read by the tests' stand-in only (note 707).
  const open = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, surveys[i] ? surveys[i].reach : null]));
  const unseen = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, seenThatWay[i].cells ? seenThatWay[i].unseenInView ?? seenThatWay[i].unseen : null]));
  const stood = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, seenThatWay[i].stood]));
  const decision = await decide('fortress_leg', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree, state: facts,
    context: { current: `leg_${HEADING_NAMES[current]}`, open, unseen, stood, passes: fortress?.passes || 0, widen: options.widen_search ? { leg: sideLeg, unseen: widenUnseen } : null } });
  if (decision.stale) return false;
  return options[decision.path.at(-1)].run();
}
// The portal the search can go home by, as the way back (work.js
// returnFromNether) finds it: one in view, the nearest remembered in the
// Nether, or the one the bot came through, worked out from its Overworld
// side. -> { portal, says } or null.
function portalBack(bot, goal, here) {
  const off = p => Math.round(Math.hypot(p.x - here.x, p.z - here.z));
  let seen = null;
  try { seen = bot.findBlock?.({ matching: b => b?.name === 'nether_portal', maxDistance: 64 }) || null; } catch (_) { seen = null; }
  if (seen) return { portal: seen.position, says: `the one in view ${off(seen.position)} blocks off at ${seen.position.x}, ${seen.position.y}, ${seen.position.z}` };
  const known = (goal.portals || []).filter(p => p.dimension === 'nether').sort((a, b) => off(a) - off(b))[0];
  if (known) return { portal: known, says: `the nearest known ${off(known)} blocks off at ${known.x}, ${known.y}, ${known.z}` };
  const came = require('./game-progress').cameThrough(goal, here);
  if (came) return { portal: came, says: `the one it came through, not seen since, worked out from its Overworld side as near (${came.x}, ${came.z}), ${off(came)} blocks off` };
  return null;
}
// Whether the way back to that portal can make its first move from here,
// read from what the walk back reads as it goes (work.js walkToKnownPortal
// and tunnelToward): one in view is walked into; within 48 blocks it is
// walked to; farther, a leg of 32 on foot toward it (resting two minutes
// once one made no ground), a crossing straight at it (resting once it
// came no nearer, refused while a shooter can see the bot), then a stair,
// which digs with a pickaxe carried or made from what is carried, or by
// hand where a first step gains. With none of those, the trip ends in its
// first second or becomes a hunt for wood: 25591 (mid-242-jb, 22:19:54Z on
// 2026-09-29) chose return_for_blocks with its legs resting and no wood,
// and nether_gather was asked for stems half a second later (note 695).
// -> { ok } or { ok: false, why }.
function portalTripStart(bot, goal, homeBy) {
  if (!homeBy?.portal) return { ok: false, why: 'no portal is known to go back by' };
  if (/^the one in view/.test(homeBy.says) || bot.game?.gameMode === 'creative' || typeof bot.blockAt !== 'function') return { ok: true };
  const here = bot.entity.position, p = new Vec3(homeBy.portal.x, homeBy.portal.y, homeBy.portal.z);
  if (here.distanceTo(p) <= 48) return { ok: true };
  if (!isSetAside(goal, 'portal_leg', p)) return { ok: true };
  const closed = ['a leg of 32 blocks on foot toward it made no ground a moment ago (resting)'];
  if (/nether/.test(String(bot.game?.dimension || ''))) {
    const nt = require('./nether-travel');
    if (nt.crossingResting(bot, goal, p)) closed.push('the crossing straight at it came no nearer (resting)');
    else {
      const survey = surveyCrossing(bot, p, { cells: nt.CROSS_STRETCH });
      const refused = require('./bridging').spanRefused(bot);
      if (survey.cells && survey.gain >= 1 && !refused) return { ok: true };
      closed.push(refused ? `no crossing now: ${refused.says}` : `a crossing straight at it goes nowhere (${survey.stoppedBy || 'no ground made'})`);
    }
  }
  // The staircase resting toward it (by its area, or from here): the walk
  // back goes straight to the portal's way question (work.js stairsOrWay),
  // which offers the legs round and other work. 25588 (mid-243-hf) was
  // offered the trip home eight times at 0.2 health with its legs, crossing
  // and staircase all resting, each ending "cannot be reached from here"
  // (note 706).
  const t = require('./tunneling');
  const stairRest = t.restingWay(goal, p, here);
  if (stairRest) {
    closed.push(`${stairRest.what} rests (${String(stairRest.why).slice(0, 100)}), ${stairRest.minutes} more minute${stairRest.minutes === 1 ? '' : 's'}`);
    return { ok: false, why: `the way back to it cannot begin from here: ${closed.join('; ')}`, until: stairRest.until };
  }
  if (pickaxeTier(bot) >= 1 || !pickaxeFirst(bot).none) return { ok: true };
  if (Math.hypot(p.x - here.x, p.z - here.z) <= t.STAIR_ACROSS && t.stairFromHere(bot, goal, p)?.gains) return { ok: true };
  closed.push(`no stair to it by hand from here (${Math.hypot(p.x - here.x, p.z - here.z) > t.STAIR_ACROSS ? `more than ${t.STAIR_ACROSS} blocks across` : 'no step toward it gains'}), and no pickaxe is carried or can be made from what is carried`);
  return { ok: false, why: `the way back to it cannot begin from here: ${closed.join('; ')}` };
}
// The trip home through a portal, closed from here: every way its walk
// begins with is resting or refused (portalTripStart), said with the portal.
// null where the trip can begin, or off the Nether. Read by every offer of
// the trip (for food, for blocks, for the kit) and by portalTrip's words.
function tripHomeClosed(bot, goal) {
  if (!/nether/.test(String(bot?.game?.dimension || '')) || !bot.entity?.position) return null;
  let homeBy = null; try { homeBy = portalBack(bot, goal, bot.entity.position); } catch (_) { homeBy = null; }
  if (!homeBy) return null;
  let start = null; try { start = portalTripStart(bot, goal, homeBy); } catch (_) { start = null; }
  if (!start || start.ok) return null;
  return { portal: homeBy.portal, says: `The way back to the portal (${homeBy.says}) cannot be reached from here: ${start.why.replace(/^the way back to it cannot begin from here: /, '')}.`, until: start.until || null };
}
// How far a search on from here goes with what is carried, each heading at
// this height (nether-travel.js surveyLeg): what searching on can reach
// where no pickaxe is carried. 25585 chose to search on from under its
// fortress eleven times in half an hour, told only that the legs lay a block
// a cell; from there east ended in 3 cells at basalt, south at the first
// gap, and west 45 cells on (note 692).
function searchReachSays(bot) {
  const said = [];
  for (const [i, h] of HEADINGS.entries()) {
    let s = null;
    try { s = surveyLeg(bot, h, { cells: FORTRESS_LEG }); } catch (_) { s = null; }
    if (!s) continue;
    const goes = Math.min(...[s.stoppedAt, s.runsOut, s.cells].filter(Number.isInteger));
    const why = Number.isInteger(s.runsOut) && s.runsOut === goes ? 'a gap with no block to lay' : s.stoppedBy;
    said.push(`${HEADING_NAMES[i]} ${goes} block${goes === 1 ? '' : 's'}${why && goes < FORTRESS_LEG ? ` (then ${why})` : ''}`);
  }
  return said.length ? ` At this height from here, with no pickaxe, the legs go (rock dug by hand on the way): ${said.join('; ')}.` : '';
}
// Searching on chosen from about here before, and the bot here again: what
// the choice came to. 25585 left its fortress from the same few blocks
// eleven times in half an hour and each search brought it back (note 692).
const { LEFT_FROM_MS } = require('./fortress-hold');
function leftBeforeSays(state, here, now = Date.now()) {
  const before = (state.leftFrom || []).filter(l => now - l.at < LEFT_FROM_MS && Math.hypot(l.x - here.x, l.z - here.z) <= 16 && Math.abs(l.y - here.y) < 8);
  if (!before.length) return '';
  const first = Math.max(1, Math.round((now - Math.min(...before.map(l => l.at))) / 60000));
  return ` Chosen from within 16 blocks of here ${before.length === 1 ? 'once' : `${before.length} times`} in the last ${first} minute${first === 1 ? '' : 's'}, and the search brought the bot back here each time.`;
}
// The rock the bot last stood on (nether-coverage.js lastGround), farther
// than the restock's looks reach, and the pathfinder's route back to it from
// here: the offer and the walk it begins with are the same route.
const BACK_REST_MS = 5 * 60000;
async function backToGround(bot, task, goal, state, plan) {
  const g = coverage.lastGround(state, bot);
  if (!g) return null;
  const here = bot.entity.position, at = new Vec3(g.x, g.y, g.z), off = Math.round(at.distanceTo(here));
  if (flatTo(at, here) <= RESTOCK_REACH) return null;
  const where = `the ${g.name.replaceAll('_', ' ')} last stood on at (${g.x}, ${g.y}, ${g.z}), ${off} blocks back`;
  if (isSetAside(goal, 'back_to_ground', at)) return { says: `back to ${where}: it came to nothing from here a few minutes ago (${attemptsFor(goal).why('back_to_ground', at) || 'no nearer'}), resting` };
  const route = await routeSurvey(bot, task, new goals.GoalNear(g.x, g.y, g.z, 2), at);
  if (!route) return null;
  // A route that ends short of the ground but within the restock's own reach
  // of it goes as far as it goes and the blocks are dug from there: 25593
  // (19:05:31Z, note 751c) stood on its span with 0 blocks, the basalt last
  // stood on 133 back and the route "its nearest ends 7 blocks short", and
  // was offered no way back at all.
  const short = route.end ? Math.round(flatTo(at, route.end)) : null;
  const partWay = route.status !== 'success' && route.cells && short !== null && short <= RESTOCK_REACH;
  if (route.status !== 'success' && !partWay) return { says: `back to ${where}: the pathfinder finds no route there from here${route.cells ? ` (its nearest ends ${Math.max(0, off - route.gain)} blocks short)` : ''}, so it is not offered` };
  const goTo = partWay ? route.end : at;
  const work = [route.dig && `digging ${route.dig}`, route.place && `laying ${route.place}`].filter(Boolean).join(' and ');
  const seconds = Math.round(route.cells / WALK_SPEED + route.dig * 1.5);
  return { where: { says: where, off }, option: (actions, save) => ({ target: { x: g.x, y: g.y, z: g.z },
    description: `Walk back to ${where} the way the pathfinder finds (${route.cells} steps${work ? `, ${work} blocks` : ''}, about ${seconds} seconds${route.besideLava ? `, ${route.besideLava} of them beside lava` : ''}${partWay ? `; its route ends ${short} blocks short of it, within the ${RESTOCK_REACH} blocks the digging reaches from where it stands` : ''}), and dig blocks to lay there: here only ${plan.want} can be had and the longest leg short of blocks needs ${plan.need + plan.carried}. The leg is chosen again from there.`,
    run: async () => {
      goal.step = { action: 'back_to_ground', target: { x: g.x, y: g.y, z: g.z } }; save();
      const before = bot.entity.position.distanceTo(at);
      let why = null;
      try { await actions.navigate(bot, task, new goals.GoalNear(goTo.x, goTo.y, goTo.z, 2), { timeoutMs: Math.max(30000, route.cells * 700), stallMs: 8000 }); }
      catch (err) { task.check(); if (!retryable(err)) throw err; why = String(err.message || err).slice(0, 160); }
      if (bot.entity.position.distanceTo(goTo) > 4) {
        const said = `The walk back to ${where} ended ${Math.round(bot.entity.position.distanceTo(at))} blocks from it${why ? `: ${why}` : ''}`;
        if (before - bot.entity.position.distanceTo(at) < 2) { setAside(goal, 'back_to_ground', at, said.slice(0, 200), BACK_REST_MS); save(); }
        throw new Error(said);
      }
      state.restock = { want: blocksCarried(bot) + plan.need, since: Date.now(), said: null, from: partWay ? { x: Math.round(goTo.x), y: Math.round(goTo.y), z: Math.round(goTo.z) } : { x: g.x, y: g.y, z: g.z } }; save();
      await restockStep(bot, task, goal, save, actions, state);
      return 'restock';
    } }) };
}
// The trip home said as what it fixes. With a pickaxe it is stone for the
// spans. With none, every way on here wants a pickaxe, blocks or wood, and
// the trip is for those: 25585 (mid-242-gf-fortress-1) walked one 47-block
// line for half an hour under its fortress with no pickaxe, no wood and no
// blocks, and return_for_blocks said only "for stone to lay spans with" and
// was never chosen (note 692). The walks back's record is said with it.
function returnForKitSays(bot, homeBy, { hand = null, goal = null, plan = null, ground = null } = {}) {
  const bs = require('./block-stock'), gp = require('./game-progress');
  const here = bot.entity.position, d = Math.round(Math.hypot(homeBy.portal.x - here.x, homeBy.portal.z - here.z));
  if (!bot.inventory?.items || bs.pickaxeCarried(bot)) {
    let pace = '';
    try { pace = gp.netherPaceSays(bot, d).says; } catch (_) { pace = ''; }
    // In the Nether the blocks a span or pillar wants are netherrack,
    // blackstone and basalt, not stone: said as "for stone" whatever the
    // dimension, this trip was chosen 109 blocks from a fortress with
    // netherrack diggable at the feet (note 729).
    // Said by where the blocks are got: the Overworld's are cobblestone,
    // dirt and the like, never netherrack; 25593 was told "for netherrack"
    // (note 751c).
    const material = 'cobblestone, dirt or other blocks got there';
    // The fact restock_blocks itself found here, so the trip is weighed
    // against it honestly rather than looking like the only way on
    // (fixes-inform-jev: a fact added, not an option withheld).
    const dugHere = plan?.want ? ` Of the ${plan.need + plan.carried} the longest leg short of blocks needs, ${plan.want} can be dug from ground walked to from here (restock_blocks); the rest is not to be had that way.`
      : plan && plan.need ? ` Nothing of what a leg is short of can be dug from ground walked to from here${ground ? `; ${ground.says} has blocks to dig (back_to_ground)${ground.off < d ? ', nearer than the portal' : ''}` : ''}.` : '';
    return `Go back through the portal to the Overworld, ${homeBy.says}, for ${material} to lay spans with; the Nether is entered again by the same portal, and the search goes on from there.${dugHere}${pace}`;
  }
  const wood = (bot.inventory.items() || []).some(i => /_(log|stem|hyphae|wood|planks)$/.test(i.name));
  const laid = blocksCarried(bot);
  const lacks = bs.kitLacks(bot);
  if (!hand) try { hand = bs.handGather(bot); } catch (_) { hand = null; }
  const got = !hand ? '' : hand.n ? `Here a hand gets only ${kindsSaid(hand.found.reachable)}: ` : 'Here a hand gets no block: ';
  // The wood here too, where the Nether's stems are known: the trip home and
  // the fetch, each with its distance. 25589 was offered only the portal,
  // 325 blocks off, "a pickaxe needs wood (none carried)", with a warped
  // forest noticed 376 blocks off (note 703).
  const stems = wood ? '' : stemsKnownSays(bot, goal, d);
  const needs = ['netherrack dug by hand drops nothing', ...(laid < bs.KIT_BLOCKS ? [`a span or pillar needs blocks (${laid} carried)`] : []), wood ? null : `a pickaxe needs wood (none carried${stems})`].filter(Boolean);
  const t = gp.NETHER_TRIPS, r = n => Math.max(1, Math.round(n));
  const record = dimension(bot) === 'nether' && d >= t.over ? ` Walks back like this made ${t.slow} to ${t.fast} blocks a minute (about ${r(d / t.fast)} to ${r(d / t.slow)} minutes); of ${t.trips} over ${t.over} blocks, ${t.arrived} came out, ${t.died} died, the rest were given up or stalled.` : '';
  return `Go back through the portal (${homeBy.says}) for ${bs.listSays(lacks)}: every way on here needs one of them. ${got}${needs.join('; ')}. Back through the same portal after.${record}`;
}
// The nearest stems known, against the portal's distance: '; the nearest
// stems known: ...' or ''.
function stemsKnownSays(bot, goal, portalOff) {
  if (!goal || typeof bot.findBlocks !== 'function') return '';
  let place = null;
  try { place = require('./nether-wood').stemPlaces(bot, goal)[0] || null; } catch (_) { place = null; }
  if (!place?.at) return '';
  const here = bot.entity.position, off = Math.round(Math.hypot(place.at.x - here.x, place.at.z - here.z));
  const kind = /^warped/.test(place.name) ? 'warped' : 'crimson';
  const what = place.n ? `${kind} stems seen` : `a ${kind} forest noticed, no stem seen in it yet`;
  return `; the nearest Nether wood known: ${what}, ${off} blocks ${compass(place.at.x - here.x, place.at.z - here.z)}, ${off < portalOff ? 'nearer than' : 'farther than'} the portal`;
}
// And how far the search has come from it: the nearest known in the Nether.
const compass = (dx, dz) => { const ns = dz < -0.38 * Math.hypot(dx, dz) ? 'north' : dz > 0.38 * Math.hypot(dx, dz) ? 'south' : '', ew = dx > 0.38 * Math.hypot(dx, dz) ? 'east' : dx < -0.38 * Math.hypot(dx, dz) ? 'west' : ''; return ns && ew ? `${ns}-${ew}` : ns || ew || 'here'; };
function portalBackFact(goal, here) {
  const portal = (goal.portals || []).filter(p => p.dimension === 'nether').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
  if (!portal) return { portalBack: require('./game-progress').cameThrough(goal, here) ? 'no portal has been seen in the Nether since the crossing; the one the bot came through is worked out from its Overworld side' : 'no portal is known in the Nether: there is no way back to the Overworld known from here' };
  const off = Math.round(Math.hypot(portal.x - here.x, portal.z - here.z));
  return { portalBack: `the nearest portal known in the Nether is at (${portal.x}, ${portal.y}, ${portal.z}), ${off} blocks ${compass(portal.x - here.x, portal.z - here.z)} of here` };
}
// The restock Jev chose, held until its blocks are carried, wherever the
// leg's end lies: it was looked at only within eight blocks of the leg's
// end, so a dig a few blocks off handed the tick to the leg, which walked
// back to the span's end, and the next tick dug again (note 561). Gathered
// in one go (bridging.js gatherSpanBlocks); it ends where nothing more can
// be had from here, three blocks in a row gain nothing, or at twice the
// time it was said to take, and what it gained is said on the next offer.
async function restockStep(bot, task, goal, save, actions, state) {
  const r = state.restock;
  if (blocksCarried(bot) >= r.want || !actions.mineAt || !actions.navigate) { delete state.restock; save(); return false; }
  const have = blocksCarried(bot);
  // The pickaxe the offer said is made first, made first: dug by hand,
  // netherrack drops nothing (note 654).
  const pick = pickaxeFirst(bot);
  if (!pick.carried && !pick.none) {
    goal.step = { action: 'make_pickaxe', item: pick.item, for: 'restock_blocks' }; save();
    const unmade = await makePickaxe(bot, task, goal, save, actions, pick);
    if (unmade) {
      state.lastRestock = { at: Date.now(), from: r.from || { x: Math.round(bot.entity.position.x), z: Math.round(bot.entity.position.z) }, gained: 0, why: `no pickaxe to dig with: ${unmade}` };
      delete state.restock; save();
      return true;
    }
  }
  goal.step = { action: 'restock_blocks', want: r.want, have }; save();
  const deadline = r.said === null || r.said === undefined ? null : r.since + Math.max(60, r.said * 2) * 1000;
  let result = { gained: 0, why: null };
  try {
    result = await gatherSpanBlocks(bot, task, r.want, { navigate: actions.navigate, deadline, ...restockReach(r.far),
      skip: p => isSetAside(goal, 'reach', p),
      onBlock: s => { goal.step = { action: 'restock_blocks', block: s.name, target: { x: s.p.x, y: s.p.y, z: s.p.z }, from: { x: s.from.x, y: s.from.y, z: s.from.z }, want: r.want, have: blocksCarried(bot) }; save(); },
      mineAt: s => actions.mineAt(bot, task, goal, save, s.p, s.name, s.drops) });
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err;
    result = { gained: blocksCarried(bot) - have, why: err.message };
  }
  state.lastRestock = { at: Date.now(), from: r.from || { x: Math.round(bot.entity.position.x), z: Math.round(bot.entity.position.z) }, gained: result.gained, why: result.why };
  delete state.restock; save();
  return true;
}
// The leg Jev chose begun from here.
function beginLeg(state, here) {
  const next = fortressLegTarget(state, here); state.target = { x: next.x, y: next.y, z: next.z }; state.legs++; state.legSince = Date.now();
  state.legFrom = { x: Math.round(here.x), z: Math.round(here.z) }; state.lastHeading = headingIndex(state); delete state.lastLegError; delete state.legLength; delete state.legShift;
  delete state.legBest; delete state.lastCrossStop;
}
// A direction the sweep cannot make ground in for several ticks is given
// up for the next one round the compass: a leg toward an open cavern had
// the staircase shuffling along one ledge.
function turnSweep(state) {
  const current = Number.isInteger(state.heading) ? state.heading : (state.axis === -1 ? 2 : 0);
  state.heading = (current + 1) % 4; state.legFails = 0; delete state.target;
}
// The way to a fortress seen is Jev's (fortress_approach). Both fortresses
// any trial has found were lost within a second of the sighting: mid-242-c
// walking the lava sea's shore three blocks above it as the leg turned to
// its fortress (note 264), mid-215-e on a span over the lava sea with a
// hoglin behind it (note 273). The code alone had tried, in its own order,
// the pathfinder at two heights, a drop, a span of up to sixty-four blocks
// and a staircase, and given the face up after six failures. Now each way is
// offered with what it meets, surveyed from here, and the mobs in sight; the
// answer holds for the approach until it ends no nearer, and is asked again
// with what failed. Leaving the fortress for now is always one of the ways.
const APPROACH_HOLD_MS = 5 * 60000;
// Bricks seen within this of the last approach's are the same fortress.
const SAME_FORTRESS = 32;
// The place the way in was asked about is kept from within this of where
// the bot stood when it was first asked: tried.js's "from about here".
const APPROACH_FROM = 16;
// The health under which a descent goes no lower (descent.js descendTo's hpFloor).
const DESCEND_FLOOR = 12;
// As far as a span toward a fortress was ever laid.
const APPROACH_CROSS = 64;
// Ground gained toward the fortress, the approach's own "came nearer": a
// block, what one step of the staircase or one cell of a span makes, less
// the quarter block the feet sit off a cell's centre. The approach had
// counted 1.5, and a staircase digs one step a pass: 94 of the 96 staircase
// passes it recorded as "tunnel: came no nearer" from 2026-09-29 23Z to
// 09-30 11:30Z had moved the bot a block or more toward the bricks, and each
// was said to Jev as a way that failed (note 750).
const STEP_GAIN = 0.75;
// From here, as a failed way's own spot: the cell the bot stands in and the
// ones beside it (note 750).
const TRIED_HERE = 2;
// Where blazes were seen counts as at a fortress within this of its bricks
// (across and up or down): a blaze keeps to its fortress's bounds and its
// spawner's room, and is heard through walls from about this far (note 750e).
const BLAZES_AT = 32;
const retryable = err => !['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name);
const flatTo = (a, b) => Math.hypot(a.x + 0.5 - b.x, a.z + 0.5 - b.z);

// The mobs in sight a way to the fortress has to reckon with: within
// thirty-two blocks, and a ghast within sixty-four, whose fireball's blast
// throws a player (mid-87-l, thrown forty blocks down into the lava).
function threatsInView(bot) {
  try { return threats(bot, 64).filter(t => t.visible && (t.distance <= 32 || t.entity.name === 'ghast')); }
  catch (_) { return []; }
}
const mobsSaid = list => [...new Set(list.map(t => `${/^[aeiou]/.test(t.entity.name) ? 'an' : 'a'} ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`))].slice(0, 4).join(', ');

// The pathfinder's route toward `target`, surveyed before it is walked:
// its cells, the blocks it would place and dig, how many of its cells are
// with lava round them (movement.js lavaAlong), and how much nearer its end is.
async function routeSurvey(bot, task, target, brick) {
  if (!bot.pathfinder?.movements || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return null;
  try {
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, target, 500);
    const path = route?.path || [];
    const end = path.at(-1);
    return { status: route?.status || 'noPath', cells: path.length,
      place: path.reduce((n, p) => n + (p.toPlace?.length || 0), 0), dig: path.reduce((n, p) => n + (p.toBreak?.length || 0), 0),
      // Its cells with lava round them, as the walk prices them (movement.js
      // lavaAlong, note 660).
      lava: route?.lava || null, besideLava: route?.lava?.beside || 0,
      gain: end ? Math.round(flatTo(brick, bot.entity.position) - flatTo(brick, end)) : 0, end: end ? { x: end.x, y: end.y, z: end.z } : null };
  } catch (err) { if (!retryable(err)) throw err; return null; }
}

// What lies straight under the bot, down to sixteen blocks: the first
// floor, or lava.
function columnBelow(bot) {
  if (typeof bot.blockAt !== 'function') return null;
  const feet = bot.entity.position.floored();
  for (let k = 1; k <= 16; k++) {
    const b = bot.blockAt(feet.offset(0, -k, 0));
    if (!b) return null;
    if (/lava/.test(b.name)) return { lava: true, depth: k - 1 };
    if (k > 1 && b.boundingBox === 'block') return { name: b.name, depth: k - 1 };
  }
  return { depth: 16, open: true };
}

// A crossing's rock dug by hand, against the same rock dug with the pickaxe
// that would be had (the one made from what is carried, else a stone one):
// `says` for the crossing, `brief` for the ways to the pickaxe.
function handDigOf(bot, nearest, survey) {
  const pick = pickaxeFirst(bot);
  const tool = pick.tool ?? bot.registry?.itemsByName?.stone_pickaxe?.id ?? null;
  if (tool === null) return null;
  const withPick = surveyCrossing(bot, nearest, { cells: survey.cells, tool });
  const hand = Math.round(survey.digSeconds), dug = Math.round(withPick.digSeconds);
  const name = pick.name || 'a stone pickaxe';
  const whole = crossingSeconds(withPick);
  return {
    says: ` Of its about ${crossingSeconds(survey)} seconds, about ${hand} are the ${survey.dig} blocks of rock dug by hand, none of which drops anything; with ${name} they take about ${dug}, the crossing about ${whole}${pick.none ? ' (none can be made from what is carried: wood is what is short)' : ' (made here from what is carried, a few seconds: make_pickaxe)'}.`,
    brief: ` The crossing straight at the fortress from here digs ${survey.dig} blocks of rock: about ${crossingSeconds(survey)} seconds by hand, about ${whole} with ${name}.`,
  };
}

// The climb to a fortress floor overhead with what is carried, or dug here
// first: a pillar from a column by the floor (within twelve across), else a
// pillar where the bot stands and a span across at the floor's height to
// it. One builder for every question asked with a known floor above
// (fortress_approach, fortress_leg, and the stall's and rung's questions).
// 25591 (mid-242-jb) stood 15 under its fortress's bricks and 18 across
// with 231 blocks for five and a half minutes, asked the stall's question
// five times with none good on top, and was offered only a crossing that
// stayed level (note 694). -> { options, noPillar }
const CLIMB_REACH = 32;
function dropUnder(bot, p, deepest = 64) {
  for (let d = 1; d <= deepest; d++) {
    const b = bot.blockAt(p.offset(0, -d, 0));
    if (!b) return { blocks: d - 1, into: null };
    if (/lava/.test(b.name)) return { blocks: d - 1, into: 'lava' };
    if (/water/.test(b.name)) return { blocks: d - 1, into: 'water' };
    if (b.boundingBox === 'block') return { blocks: d - 1, into: null };
  }
  return { blocks: deepest, into: null };
}
// The rock over the column the pillar rises through, dug on the way up:
// how many blocks, of what, and the seconds with the tool that would be
// used (a hand's, where no pickaxe is carried).
function columnDig(bot, site, topY) {
  const out = { blocks: 0, seconds: 0, names: new Set() };
  for (let y = site.y + 2; y <= topY + 1; y++) {
    const b = bot.blockAt(new Vec3(site.x, y, site.z));
    if (!b || b.boundingBox === 'empty') continue;
    out.blocks++; out.names.add(b.name.replaceAll('_', ' '));
    if (typeof b.digTime === 'function' && bot.inventory?.items) out.seconds += b.digTime(require('./skills').cheapestTool(bot, b)?.type ?? null, false, false, false, [], {}) / 1000;
  }
  out.seconds = Math.round(out.seconds);
  out.says = out.blocks ? ` It digs ${out.blocks} block${out.blocks === 1 ? '' : 's'} of ${[...out.names].join(' and ')} over the head on the way up, about ${out.seconds} seconds${require('./block-stock').pickaxeCarried(bot) ? '' : ' by hand, none of which drops anything'}.` : '';
  return out;
}
function climbWays(bot, task, goal, save, actions, state, nearest, { inView = threatsInView(bot) } = {}) {
  const out = { options: {}, noPillar: null };
  const here = bot.entity.position, dy = Math.round(nearest.y + 1 - here.y), flatNow = flatTo(nearest, here);
  if (!(actions.dig && dy >= 2 && flatNow <= CLIMB_REACH && typeof bot.blockAt === 'function')) return out;
  const { pillarSite, pillarUp, SCAFFOLD } = require('./pillar-recovery');
  const scaffold = bot.inventory?.items?.().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) || 0;
  // A column by the floor first; else one where the bot stands, the floor
  // then reached by a span at its height.
  const byFloor = flatNow <= 12 ? pillarSite(bot, nearest.y + 1, nearest, { radius: 5 }) : null;
  const site = byFloor || pillarSite(bot, nearest.y + 1, null, { radius: 2 });
  if (!site) {
    if (flatNow > 12) out.noPillar = `a pillar up the ${dy} blocks toward the floor is not offered: no column within 2 blocks of here is clear of lava and water and of blocks the climb does not dig`;
    return out;
  }
  const up = nearest.y + 1 - site.y, walk = Math.round(site.offset(0.5, 0, 0.5).distanceTo(here));
  const across = Math.round(Math.hypot(nearest.x - site.x, nearest.z - site.z));
  const floorAt = `(${nearest.x}, ${nearest.y + 1}, ${nearest.z})`;
  // A push off the top lands beside the column, not on its foot: over
  // whatever drop is beside the foot. mid-208-k-nether-3-fortress-1 was
  // told "a fall of up to 9 blocks" from its pillar's top on a ledge of
  // the lava sea; a ghast's fireball put it thirty-seven down into the
  // lava (note 551).
  const beside = require('./terrain').dropNear(bot, site, 3);
  // A column dug up through rock has walls on every side: nothing there
  // throws the bot off, and a push is a fall only from as high as the
  // column stands open at a side (25591's rose through 16 of basalt from its
  // own tunnel, note 694).
  const openTop = (() => {
    for (let y = nearest.y + 1; y > site.y; y--) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const h of [0, 1]) {
      if (bot.blockAt(new Vec3(site.x + dx, y + h, site.z + dz))?.boundingBox !== 'block') return y;
    }
    return null;
  })();
  const rise = openTop === null ? 0 : openTop - site.y;
  const fall = rise + (beside?.fallBlocks || 0), into = beside?.into === 'lava' ? 'lava' : beside?.into === 'water' ? 'water' : null;
  const walled = openTop !== null && openTop < nearest.y + 1 ? `The column is walled by rock on every side above y ${openTop + 1}; below that a` : 'On top a';
  const pushSays = openTop === null ? 'The column rises inside rock, walled on every side up to the floor\'s height: a push there has nowhere to throw the bot.'
    : `${walled} push is a fall of up to ${fall} block${fall === 1 ? '' : 's'}${beside ? ` (the pillar's ${rise}, then a drop of ${beside.fallBlocks}, ${beside.blocksAway === 1 ? 'a block' : `${beside.blocksAway} blocks`} from its foot)` : ''}, ${into === 'lava' ? 'into lava' : into === 'water' ? 'into water, no harm' : fall <= 3 ? 'no harm' : `about ${fall - 3} health`}.`;
  // What pushes up there: a shooter in view within its reach (a ghast
  // sixty-four, a blaze forty-eight), whose shot that lands pushes.
  const { RANGE } = require('./combat-estimate');
  const pushers = inView.filter(t => shooter(t.entity) && t.distance <= Math.max(16, RANGE[t.entity.name] || 0));
  const pushersSay = pushers.length ? ` ${capital(mobsSaid(pushers))} can shoot the bot on top, and a shot that lands pushes it, shield or not; the top has no wall.` : '';
  const sightSays = `${inView.length ? ` In sight: ${mobsSaid(inView)}.` : ''}${pushersSay}`;
  const toColumn = async () => {
    if (site.distanceTo(bot.entity.position.floored()) >= 1 && actions.navigate) {
      try { await actions.navigate(bot, task, new goals.GoalBlock(site.x, site.y, site.z), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { task.check(); if (!retryable(err)) throw err; return `no way to the column at (${site.x}, ${site.y}, ${site.z}): ${err.message}`; }
    }
    return site.distanceTo(bot.entity.position.floored()) >= 1.5 ? `not at the column at (${site.x}, ${site.y}, ${site.z})` : null;
  };
  const carriedNow = () => bot.inventory?.items?.().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) || 0;
  const gatherFirst = (need, climb) => {
    const gather = pillarGather(bot, goal, need - scaffold);
    // A pillar that stops short of the floor stands the bot on a column in
    // the air, no way in: offered where what is dug here reaches it, else
    // said.
    if (gather && scaffold + gather.want < need) { out.noPillar = `${byFloor ? `a pillar up the ${need} blocks to the floor is not offered:` : `the climb to the floor is not offered: ${need} blocks wanted,`} ${scaffold} carried and ${gather.want} to be had here (${gather.kinds}), ${need - scaffold - gather.want} short`; return null; }
    if (!gather) return null;
    return { gather, run: async () => {
      const got = await gather.run(bot, task, goal, save, actions, state);
      if (carriedNow() <= scaffold) return `no blocks were dug for the pillar${got ? `: ${got}` : ''}`;
      return climb();
    } };
  };
  if (byFloor) {
    // What lies between the top and the floor, at its height: a pillar
    // beside the floor gets there; one some blocks off leaves a gap.
    // mid-242-bb was offered "Pillar straight up 2 blocks ... the floor is
    // then 6 blocks across", nothing said of the six (note 613).
    const { stepToward } = require('./bridging');
    let cell = new Vec3(site.x, nearest.y + 1, site.z), gap = 0;
    for (let n = 0, step; n < 12 && (step = stepToward(cell, nearest)); n++) { cell = cell.plus(step); if (bot.blockAt(cell.offset(0, -1, 0))?.boundingBox !== 'block') gap++; }
    const betweenSays = across <= 1 ? '' : gap ? `, with ${gap} of open air with no floor between the top and it at that height (a span, ${blocksCarried(bot)} blocks carried that a span is laid with)` : ', with ground between the top and it at that height';
    const columnSays = `from ${walk ? `a column ${walk} blocks from here` : 'where the bot stands'}, with no lava or water in or beside it; the floor at ${floorAt} is then ${across} block${across === 1 ? '' : 's'} across${betweenSays}.${columnDig(bot, site, nearest.y + 1).says} ${pushSays}${sightSays}`;
    const pillarRun = async () => {
      const off = await toColumn(); if (off) return off;
      const placed = await pillarUp(bot, task, nearest.y + 1, { dig: actions.dig });
      return placed ? null : 'the pillar would not rise';
    };
    if (scaffold >= 1) out.options.pillar_up = { description: `Pillar straight up ${up} blocks to the fortress floor's height (jump and lay a block under the feet, ${scaffold} carried that can be laid${scaffold < up ? `: they run out ${scaffold} up` : `, ${scaffold - up} left after`}${require('./block-stock').afterSays({ noPickaxe: !require('./block-stock').pickaxeCarried(bot), left: scaffold - up }).replace(/^ /, '; ').replace(/\.$/, '')}), ${columnSays}`, run: pillarRun };
    // The blocks for the whole pillar gathered here first, where those
    // carried run out short of the floor (note 692).
    if (scaffold < up && actions.mineAt && actions.navigate) {
      const first = gatherFirst(up, pillarRun);
      if (first) out.options.blocks_then_pillar = {
        description: `${first.gather.says} Then pillar straight up ${up} blocks to the fortress floor's height with them (${scaffold} carried and ${first.gather.want} dug), ${columnSays} About ${Math.max(1, Math.round(((first.gather.seconds ?? 0) + up * 1.2) / 60))} minute${Math.round(((first.gather.seconds ?? 0) + up * 1.2) / 60) > 1 ? 's' : ''} in all.`,
        run: first.run };
    }
    return out;
  }
  // The pillar where the bot stands, then a span at the floor's height:
  // offered only where the span, surveyed from the top, reaches the floor.
  const top = new Vec3(site.x, nearest.y + 1, site.z);
  const span = surveyCrossing(bot, nearest, { from: top, cells: CLIMB_REACH + 8, blocks: 1e6, wall: true });
  const endOff = Math.round(flatTo(nearest, span.end));
  if (span.stoppedBy || endOff > 2) {
    out.noPillar = `a pillar up the ${up} blocks here and a span across to the floor is not offered: at the floor's height the span stops ${span.cells} cells on, ${endOff} from the floor${span.stoppedBy ? ` (${span.stoppedBy})` : ''}`;
    return out;
  }
  const need = up + span.bridge;
  const cells = [];
  { const { stepToward } = require('./bridging'); let c = top; for (let n = 0, step; n < span.cells && (step = stepToward(c, nearest)); n++) { c = c.plus(step); if (bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block') cells.push(c.offset(0, -1, 0)); } }
  const drops = cells.map(c => dropUnder(bot, c));
  const deepest = drops.reduce((m, d) => Math.max(m, d.blocks), 0), lava = drops.filter(d => d.into === 'lava').length;
  const spanSays = span.bridge ? ` The span lays ${span.bridge} over open air${lava ? `, ${lava} of them over lava` : ''}, crouched, a drop of up to ${deepest + 1} under it: a hit on it is that fall.` : ' Nothing is laid across: it is floor or rock all the way.';
  const column = columnDig(bot, site, nearest.y + 1);
  const digSays = `${column.says}${span.dig ? ` Across, it digs ${span.dig} block${span.dig === 1 ? '' : 's'}${span.wall ? `, ${span.wall} of them the fortress's wall (nether bricks)` : ''}, about ${Math.round(span.digSeconds)} seconds.` : ''}`;
  const seconds = Math.round(up * 1.2 + column.seconds + crossingSeconds(span));
  const climbSays = `pillar straight up ${up} blocks ${walk ? `from a column ${walk} block${walk === 1 ? '' : 's'} from here` : 'where the bot stands'}, then span ${span.cells} cells across at that height to the fortress floor at ${floorAt}`;
  const climbRun = async () => {
    const off = await toColumn(); if (off) return off;
    await pillarUp(bot, task, nearest.y + 1, { dig: actions.dig, maxBlocks: up + 2 });
    const short = Math.round(nearest.y + 1 - bot.entity.position.y);
    if (short >= 1) return `the pillar stopped ${short} short of the floor's height`;
    await bridgeTo(bot, task, nearest, { maxBlocks: span.bridge + 2, maxSteps: span.cells + 2, wall: true });
    const left = Math.round(flatTo(nearest, bot.entity.position));
    return left <= 2 ? null : `the span stopped ${left} blocks from the floor`;
  };
  const whole = `${capital(climbSays)}: ${need} blocks laid`;
  if (scaffold >= need) {
    out.options.pillar_up = { description: `${whole} of ${scaffold} carried, about ${seconds} seconds.${digSays} ${pushSays}${spanSays}${sightSays}`, run: climbRun };
  } else if (actions.mineAt && actions.navigate) {
    const first = gatherFirst(need, climbRun);
    if (first) out.options.blocks_then_pillar = {
      description: `${first.gather.says} Then ${climbSays}: ${need} blocks laid (${scaffold} carried and ${first.gather.want} dug), about ${Math.max(1, Math.round(((first.gather.seconds ?? 0) + seconds) / 60))} minutes in all.${digSays} ${pushSays}${spanSays}${sightSays}`,
      run: first.run };
    else if (!out.noPillar) out.noPillar = `the climb to the floor is not offered: ${need} blocks wanted (${up} up, ${span.bridge} across), ${scaffold} carried and none to be had here`;
  } else out.noPillar = `the climb to the floor is not offered: ${need} blocks wanted (${up} up, ${span.bridge} across), ${scaffold} carried`;
  return out;
}

// The nearest known fortress floor overhead within a climb's reach: a floor
// on the fortress map, else the brick the approach or the search found.
// -> Vec3 of the brick (the floor is stood on a block above it) or null.
function fortressOverhead(bot, goal) {
  const here = bot.entity?.position, s = goal?.fortressSearch;
  if (!here || !s || !/nether/.test(String(bot.game?.dimension || ''))) return null;
  const within = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.y + 1 - here.y >= 2 && flatTo(p, here) <= CLIMB_REACH;
  const floors = Object.keys(s.map?.cells || {}).map(k => { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; }).filter(within);
  // The approach's target is a floor it chose; the search's first brick may
  // be a pier's or a wall's.
  const pick = floors.sort((a, b) => flatTo(a, here) - flatTo(b, here))[0] || [s.approach?.found, s.found].find(within);
  return pick ? new Vec3(pick.x, pick.y, pick.z) : null;
}

// The climb as a way of its own outside the approach (the leg's, the
// stall's and the rung's questions): its target the floor, the fortress
// taken off the set-aside list when it is chosen (the choice is to go to
// it), and a climb that ends short a failure with its why.
function climbOffers(climb, overhead, state) {
  const target = { x: overhead.x, y: overhead.y + 1, z: overhead.z };
  return Object.fromEntries(Object.entries(climb.options).map(([k, o]) => [k, { ...o, target, run: async () => {
    if (state?.shunned) state.shunned = state.shunned.filter(sh => Math.hypot(sh.x - overhead.x, sh.z - overhead.z) > (sh.radius || 16));
    const why = await o.run();
    if (why) throw new Error(`The climb to the fortress floor at (${target.x}, ${target.y}, ${target.z}) ended: ${why}`);
    return 'climbed';
  } }]));
}

// Each way to the fortress that can be tried from here, with what it
// meets. `run` returns why it ended, when it did not throw.
// A bridge or a pillar onto the fortress's deck, named first when the
// blocks for the whole of it are already carried (note 745, item 3):
// pillar_up is offered only that way (climbWays above asks for
// blocks_then_pillar instead where the carried stock falls short);
// cross_level is offered whichever way, so `bridgeReady` (the caller's own
// survey.carried - survey.bridge >= 0) says which. Kept as its own
// function so the ordering is tested without the whole survey.
function bridgeFirstOrder(options, { bridgeReady = false } = {}) {
  const ready = ['cross_level', 'pillar_up'].filter(k => options[k] && (k === 'pillar_up' || bridgeReady));
  return ready.length
    ? Object.fromEntries([...ready.map(k => [k, options[k]]), ...Object.entries(options).filter(([k]) => !ready.includes(k))])
    : options;
}
// The staircase from a cell beside the bot on its own floor, where none
// begins from the cell it stands in (a gap's edge): the cells round the feet
// at their height with a whole block under them, room for the body and no
// liquid, each surveyed as the staircase would be from there (tunneling.js
// stairFromHere), the one gaining with the fewest steps. -> { cell, stair }
// or null.
function stairBeside(bot, goal, target) {
  const feet = bot.entity.position.floored(), was = bot.entity.position;
  const open = b => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name || '');
  let best = null;
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = feet.offset(dx, 0, dz), under = bot.blockAt(c.offset(0, -1, 0));
      if (!under || under.boundingBox !== 'block' || /lava|magma/.test(under.name || '') || !open(bot.blockAt(c)) || !open(bot.blockAt(c.offset(0, 1, 0)))) continue;
      bot.entity.position = c.offset(0.5, 0, 0.5);
      const stair = require('./tunneling').stairFromHere(bot, goal, target);
      if (stair?.gains && (!best || stair.steps < best.stair.steps)) best = { cell: { x: c.x, y: c.y, z: c.z }, stair };
    }
  } finally { bot.entity.position = was; }
  return best;
}

async function fortressApproaches(bot, task, goal, save, actions, state, nearest, bricks = [], record = state.approach) {
  const here = bot.entity.position.clone(), flat = Math.round(flatTo(nearest, here)), dy = Math.round(nearest.y + 1 - here.y);
  const where = `${flat} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}` : ''}`;
  const inView = threatsInView(bot);
  const options = {};
  let noRoute = null, handDig = null, noStair = null, noPillar = null;
  if (actions.navigate) {
    const level = new goals.GoalNear(nearest.x, Math.round(here.y), nearest.z, 4);
    const route = await routeSurvey(bot, task, level, nearest);
    const surveyed = !route ? 'Not surveyed from here.'
      : !route.cells ? 'The pathfinder found no route toward it from here.'
      : `Surveyed toward the first: ${route.status === 'success' ? 'a whole route' : 'a route part of the way'} of ${route.cells} cells, placing ${route.place} block${route.place === 1 ? '' : 's'} and digging ${route.dig}; it ends ${route.gain} blocks nearer.${route.lava?.beside ? ` ${require('./movement').lavaAlongSays(route.lava, bot)}` : ''}`;
    const edge = route?.besideLava && inView.length ? ` In sight: ${mobsSaid(inView)}; a hit at the lava's edge is the fall.` : '';
    // No route found is no way: said in the state, not offered. mid-242-ab-
    // nether-4 was offered "the pathfinder found no route toward it from
    // here" as a way in, and chose it (note 591).
    if (route && !route.cells) noRoute = 'the pathfinder found no route toward it from here (it walks, bridges and climbs, and digs no netherrack)';
    // A route that ends no nearer is no way in either: surveyed, it gains
    // under a block (the approach's own measure of nearer), and walked it
    // ends where it began, "No route from here" (note 750: 35 of the 50
    // walks offered on a survey gaining two blocks or less failed so).
    else if (route && route.gain < 1) noRoute = `the pathfinder's route toward it from here (${route.cells} cells) ends no nearer to it`;
    else options.walk_route = { description: `Walk the pathfinder's route to the fortress, ${where}: to a point level with the bot beside it first, then on up or down to the floor itself. ${surveyed} The pathfinder walks upright on open ground and crouched beside lava or a drop that kills: a crouch stops the body at an edge, but a push there carries it over.${edge}`,
      run: async () => {
        const from = bot.entity.position.clone();
        // On to the floor itself once level with it: the walk had ended at
        // the first point whenever that came nearer, and mid-242-bb stood
        // three blocks off and two below its target, the walk "getting
        // somewhere" and the floor never reached (note 613).
        const onIt = new goals.GoalNear(nearest.x, nearest.y + 1, nearest.z, 3);
        let why = null;
        for (const g of [level, onIt]) {
          if (onIt.isEnd(bot.entity.position.floored())) break;
          try { await actions.navigate(bot, task, g, { timeoutMs: 45000, stallMs: 8000, passing: true }); why = null; }
          catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
        }
        if (onIt.isEnd(bot.entity.position.floored())) return null;
        const off = Math.round(nearest.offset(0.5, 1, 0.5).distanceTo(bot.entity.position));
        const nearer = nearest.distanceTo(bot.entity.position) < nearest.distanceTo(from) - 1.5;
        return `${nearer ? 'came nearer, ' : ''}ended ${off} blocks from the floor${why ? `: ${why}` : ''}`;
      } };
  }
  // Under the health the descent keeps (descent.js hpFloor, 12) it goes no
  // lower: not offered, said. 25588 at 1.2 health was offered it as the one
  // way in, took it, and left the fortress in the same second (note 706).
  let noDescend = null;
  if (flatTo(nearest, here) <= 12 && nearest.y < here.y - 2 && (bot.health ?? 20) < DESCEND_FLOOR) noDescend = `digging straight down toward the bricks goes no lower under ${DESCEND_FLOOR} health (${Math.round((bot.health ?? 20) * 10) / 10} now)`;
  else if (flatTo(nearest, here) <= 12 && nearest.y < here.y - 2) {
    const column = columnBelow(bot);
    const under = !column ? '' : column.lava ? ` Lava is ${column.depth} blocks under the bot's feet.` : column.open ? ' Nothing solid within sixteen blocks under the bot\'s feet.' : ` The first floor under the bot's feet is ${column.name.replaceAll('_', ' ')}, ${column.depth} blocks down.`;
    options.descend = { description: `Dig straight down where the bot stands toward the bricks, ${Math.round(here.y - nearest.y - 1)} blocks below and ${flat} across, a block at a time.${under} A drop deeper than the health allows (nine blocks at full health, less hurt) or one onto or beside lava is refused, and the bot stays where it is; under 12 health it goes no lower at all (${Math.round((bot.health ?? 20) * 10) / 10} now), and it stops after 24 steps (note 677).`,
      run: async () => { const dropped = await descendTo(bot, task, nearest); return dropped >= 1 ? null : 'dropped no lower'; } };
  }
  let crossNotNow = null, bridgeReady = false;
  if (typeof bot.blockAt === 'function') {
    const survey = surveyCrossing(bot, nearest, { cells: APPROACH_CROSS });
    // The span's own check, as it runs before its first cell: with a
    // shooter in sight the crossing stops at once, and is said, not offered
    // (note 695; bridging.js spanRefused).
    const refused = survey.cells && survey.gain >= 1 ? require('./bridging').spanRefused(bot) : null;
    if (refused) crossNotNow = `straight across at this height (${survey.cells} cells): not now, ${refused.says}`;
    else if (survey.cells && survey.gain >= 1) {
      const open = survey.overLava ? 'lava' : 'open air';
      const risk = survey.bridge ? `${inView.length ? ` In sight: ${mobsSaid(inView)}; a hit on a one-wide span over ${open} is the fall.` : ''} On the span no mob is swung at or turned to: the bot holds still, crouched, until it is off.` : '';
      // The crossing is level: the "N from it" of its text is across, and a
      // fortress standing well above ends the span under it, out of blocks
      // and over the lava it was laid across (mid-242-bb-nether-1-fortress-*:
      // a span of 16 blocks toward a fortress 38 up, "2 from it", ended 37
      // under its bricks with none carried, and the bot stood there, a
      // fireball's push from the lava, for the rest of the ten minutes).
      const under = Math.round(nearest.y - survey.end.y), left = survey.carried - survey.bridge;
      const climb = under >= 4 ? ` It stays level: it ends ${under} blocks under the nearest brick (y ${Math.round(nearest.y)}), and the ${under} blocks up are still to be made from the end of the span, with ${left} block${left === 1 ? '' : 's'} left${survey.overLava ? ', over the lava it was laid across' : ''}; the way up is asked again from there.` : '';
      // Enough is already carried to lay the whole span, nothing left to
      // gather first: note 745's first-named signal below.
      bridgeReady = left >= 0 && under < 4;
      // Rock dug by hand is most of a crossing's time: said beside what a
      // pickaxe makes of it, and the ways to one are offered (pickaxeWays).
      if (survey.noPickaxe && survey.dig) handDig = handDigOf(bot, nearest, survey);
      options.cross_level = { description: `${crossingSays(survey, `the fortress, ${where}`)}${climb}${handDig?.says || ''}${require('./pickaxe-budget').lastPickaxeSays(bot, survey.dig)}${risk}`,
        run: async () => { await bridgeTo(bot, task, nearest, { maxBlocks: survey.bridge, maxSteps: survey.cells }); return survey.stoppedBy; } };
    }
  }
  // Far off, the way the search's legs go, toward it: 25584 (mid-242-nh)
  // saw a fortress 104 blocks off, was offered only the staircase and a
  // crossing that ended 71 short (the walk's survey found no whole route),
  // answered none good, and a leg then took it 60 blocks the other way. The
  // legs had brought it 80 blocks west in three minutes, walking, crossing
  // and digging in turn (note 708).
  if (flat > TOWARD_FROM && actions.navigate) {
    const heading = HEADING_NAMES[bearingOf(here, nearest)];
    options.head_toward = { description: `Head ${heading} toward it the way the search's legs go, a pass at a time: the pathfinder's walk where it finds ground${noRoute ? ' (no whole route from here)' : ''}, straight across at this height where the cells ahead allow, the staircase where neither does. The way in is asked again within ${TOWARD_FROM} blocks of it, or after a pass that gains nothing.`,
      run: async () => {
        const target = new Vec3(nearest.x, Math.round(bot.entity.position.y), nearest.z), from = flatTo(nearest, bot.entity.position);
        const gained = () => flatTo(nearest, bot.entity.position) < from - 1.5;
        let why = null;
        try { await actions.navigate(bot, task, new goals.GoalNearXZ(target.x, target.z, TOWARD_FROM - 8), { timeoutMs: 30000, stallMs: 8000, passing: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
        if (gained()) return null;
        const crossed = await crossToward(bot, task, goal, save, target, { what: 'the fortress in view' });
        if (crossed.tried && gained()) return null;
        if (crossed.survey?.stoppedBy) why = crossed.survey.stoppedBy;
        if (actions.tunnel) {
          try { await actions.tunnel(bot, task, goal, save, target, 'fortress'); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; why = err.message; }
        }
        return gained() ? null : why || 'came no nearer';
      } };
  }
  // Up to a floor overhead by a pillar: jump and lay a block under the
  // feet, from a column with no lava or water in or beside it. mid-235-p-
  // fortress-6 stood on its own span at y 49 beside the fortress's footing,
  // its corridors eight above, and every staircase up was refused for the
  // drop beside its steps (note 523). Farther across, a pillar here and a
  // span at the floor's height (note 694).
  { const climb = climbWays(bot, task, goal, save, actions, state, nearest, { inView }); Object.assign(options, climb.options); noPillar = climb.noPillar; }
  // Straight at it with the blocks for the crossing mined here first,
  // where the blocks carried stop it short (note 591).
  if (actions.mineAt && actions.navigate) {
    const cross = mineThenCrossPlan(bot, goal, nearest, bricks.length ? bricks : [nearest]);
    if (cross) options.blocks_then_cross = { description: mineThenCrossSays(bot, cross, where), run: () => mineThenCross(bot, task, goal, save, actions, state, cross) };
  }
  // No pickaxe, and a way in that digs rock by hand: the ways to a pickaxe
  // are ways in of their own, the way in asked again after (note 669).
  if (handDig || (actions.tunnel && bot.inventory?.items && !require('./block-stock').pickaxeCarried(bot))) {
    Object.assign(options, await pickaxeWays(bot, task, goal, save, actions, { handSays: handDig ? ` ${handDig.brief}` : '', after: 'The way in is asked again after.' }));
  }
  // No pickaxe and none to be made here: what a bare hand gets here, said,
  // and the trip home for what every way in wants (note 692).
  let byHand = null;
  if (bot.inventory?.items && !require('./block-stock').pickaxeCarried(bot) && pickaxeFirst(bot).none && /nether/.test(String(bot.game?.dimension || ''))) {
    const hand = require('./block-stock').handGather(bot);
    byHand = hand.says;
    const homeBy = actions.returnOverworld ? portalBack(bot, goal, here) : null;
    const homeStart = homeBy ? portalTripStart(bot, goal, homeBy) : null;
    if (homeBy && !homeStart.ok) byHand = `${byHand} Back through the portal (${homeBy.says}) is not offered: ${homeStart.why}.`;
    if (homeBy && homeStart.ok) options.return_for_blocks = { description: returnForKitSays(bot, homeBy, { hand, goal }),
      run: async () => { await actions.returnOverworld(bot, task, goal, save); return 'returned'; } };
  }
  // With no pickaxe, the staircase only where a step toward it can be dug
  // by hand, and said so; else said in the facts (note 687).
  // With a pickaxe too, the staircase only where a first step toward it
  // gains: 25581 (mid-242-dd-fortress-24) stood on a pier's top in open air
  // 27 under its fortress's floor, was offered the staircase, and it ended
  // "came no nearer" within a second, twice (note 692).
  const stair = actions.tunnel ? require('./tunneling').stairFromHere(bot, goal, nearest) : null;
  const stairByHand = actions.tunnel && !require('./block-stock').pickaxeCarried(bot)
    ? require('./block-stock').handWaySays(bot, stair, require('./block-stock').handLine(bot, nearest))
    : stair && !stair.gains && !stair.pushed ? { offered: false, says: `no step toward it can be dug from here (${stair.blocked || 'nothing nearer can be dug'})` } : { offered: true, says: '' };
  // No step from the cell the bot stands in, but from one beside it on the
  // same floor: the staircase begins there, a step back from the edge. 25581
  // (mid-243-kc, 14:55:35Z) walked to (-248, 45, -243), a gap's edge under its
  // fortress 27 up, and from there no stair step had a floor ("no floor to
  // step onto: 6 of the steps nearer"); from (-247, 45, -242), a step back,
  // the staircase went, and it had been offered a moment before. With the
  // walk and the crossing gone too, keep_searching was the one option left,
  // and the leg question took leg_south (note 750c).
  let stairFrom = null;
  if (actions.tunnel && !stairByHand.offered && require('./block-stock').pickaxeCarried(bot) && typeof bot.blockAt === 'function') {
    stairFrom = stairBeside(bot, goal, nearest);
    if (stairFrom) noStair = null;
  }
  if (actions.tunnel && !stairByHand.offered && !stairFrom) noStair = `the staircase is not offered: ${stairByHand.says}`;
  if (stairFrom) {
    const c = stairFrom.cell, rest = require('./tunneling').restingSays(goal, nearest, c);
    options.tunnel = { description: `Dig a staircase through the rock toward the fortress, ${where}, from (${c.x}, ${c.y}, ${c.z}), a step back onto the floor beside the bot (from where it stands no step toward it has a floor: ${stair?.blocked || 'nothing nearer can be dug'}): a step at a time with rock round the bot, no block dug with lava or water behind it, and it stops where every step nearer would be one; about ${stairFrom.stair.steps} steps, about ${stairFrom.stair.seconds} seconds.${rest ? ` ${capital(rest)}: taken now, it digs nothing until then.` : ''}${stairDigs(bot, goal, nearest)}`,
      run: async () => {
        if (actions.navigate) {
          try { await actions.navigate(bot, task, new goals.GoalBlock(c.x, c.y, c.z), { timeoutMs: 8000, stallMs: 3000, onFoot: true }); }
          catch (err) { task.check(); if (!retryable(err)) throw err; return `the step back to (${c.x}, ${c.y}, ${c.z}) failed: ${err.message}`; }
        }
        await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); return null;
      } };
  }
  if (actions.tunnel && stairByHand.offered) {
    const rest = require('./tunneling').restingSays(goal, nearest, here);
    options.tunnel = { description: `Dig a staircase through the rock toward the fortress, ${where}, a step at a time with rock round the bot: no block is dug with lava or water behind it, and it stops where every step nearer would be one.${rest ? ` ${capital(rest)}: taken now, it digs nothing until then.` : ''}${stairByHand.says}${stairDigs(bot, goal, nearest)}`,
      run: async () => { await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); return null; } };
  }
  // A way that already came to nothing from where the bot stands, with the
  // same blocks and pickaxe, meets the same world again: it is said as tried,
  // in the facts, not offered as if it would work (note 750). 25590
  // (mid-242-yc, 11:12-11:14Z) stood 7 blocks from its fortress's floor and
  // was offered its walk, crossing, staircase and pillar again and again,
  // each ending no nearer, no_route between, and took them in turn.
  const kitNow = { carried: blocksCarried(bot), tier: bot.inventory?.items ? pickaxeTier(bot) : 0 };
  const triedHere = {};
  for (const f of record?.failed || []) {
    if (!options[f.choice] || !f.from || !f.kit) continue;
    if (Math.hypot(f.from.x - here.x, f.from.y - here.y, f.from.z - here.z) > TRIED_HERE) continue;
    if (f.kit.carried !== kitNow.carried || f.kit.tier !== kitNow.tier) continue;
    triedHere[f.choice] = f.why;
  }
  for (const k of Object.keys(triedHere)) delete options[k];
  // The trip home for the kit says what it is for as it stands here: "every
  // way on here needs one of them" is false beside a way in offered with what
  // is carried (25590 at 11:12:46Z: return_for_blocks said so beside pillar_up,
  // its floor 2 blocks off by the walk that followed, note 750).
  if (options.return_for_blocks) {
    const beside = ['walk_route', 'cross_level', 'descend', 'pillar_up', 'tunnel', 'head_toward'].filter(k => options[k]);
    if (beside.length) options.return_for_blocks.description = options.return_for_blocks.description.replace('every way on here needs one of them.', `the ${beside.map(k => k.replaceAll('_', ' ')).join(', ')} offered beside it ${beside.length === 1 ? 'goes' : 'go'} with what is carried; the other ways on need one of them.`);
  }
  // An errand away from the fortress says how far it takes the bot from it
  // and what it leaves (fortress-away.js): the fetch of stems was taken from
  // 7 blocks off the floor for stems 173 blocks away (25590, 11:14:36Z).
  if (options.fetch_stems?.place?.at) {
    const away = require('./fortress-away').awaySays(bot, goal, options.fetch_stems.place.at, { owed: true, from: nearest });
    if (away) options.fetch_stems.description += ` ${away}`;
  }
  const minutes = state.legSince ? Math.round((Date.now() - state.legSince) / 60000) : null;
  // The fortress left is all of it in view, not sixteen blocks of it:
  // mid-235-p-nether-3 chose to leave its fortress seven times in three
  // seconds, each time the next brick past sixteen blocks a fortress found
  // anew and its ways asked again (note 533).
  const extent = fortressExtent(bricks, nearest);
  // What searching on from here meets: the legs from here that ended at
  // once and rest, and how long the search has gone. mid-242-ab-nether-4
  // left its fortress 102 blocks off after 146 minutes of search with every
  // leg from there resting "out of blocks", told only that the sweep goes
  // on (note 591).
  const searching = state.since ? Math.round((Date.now() - state.since) / 60000) : null;
  const restingHere = HEADING_NAMES.map(n => [n, legResting(state, n, here)]).filter(([, r]) => r);
  const onFrom = restingHere.length ? ` From here ${restingHere.length === HEADING_NAMES.length ? 'every leg' : `the leg${restingHere.length === 1 ? '' : 's'} ${restingHere.map(([n]) => n).join(', ')}`} ended at once and rest${restingHere.length === 1 || restingHere.length === HEADING_NAMES.length ? 's' : ''} a few minutes (${[...new Set(restingHere.map(([, r]) => r.why))].slice(0, 2).join('; ')}).` : '';
  // Leaving says what it leaves (fortress-hold.js, note 721), in the question's
  // facts as `leaving`: the fortress's distance, what reaching it needs and the
  // ways to that as they stand. 25584 left at 04:31:17 and 04:32:52 told the
  // legs and the minutes, its fetch of stems set aside unsaid. Said on the
  // option itself it read as the option's case: the recorded questions went
  // keep_searching 24 of 25 with it there, and fetch_stems 10 of 10 with it in
  // the facts and the fetch on offer (probe, note 721).
  const anchor = state.fortressAt && sameFortress(state, state.fortressAt, nearest) ? state.fortressAt : nearest;
  const reach = require('./fortress-hold').reachSays(bot, goal, { target: nearest, anchor, offered: options, facts: { ...(noPillar ? { pillar: noPillar } : {}), ...(noRoute ? { walkRoute: noRoute } : {}) } });
  options.keep_searching = { description: `Leave this fortress for ten minutes and go on with the search from here (${state.legs || 0} leg${state.legs === 1 ? '' : 's'} so far${minutes ? `, ${minutes} minutes on this one` : ''}${searching ? `, ${searching} minutes searching` : ''}): the next leg of the search is asked from here, and the fortress may be met again from another side. Left is all of it in view, its bricks out to ${extent} blocks from the nearest${bricks.length >= FORTRESS_VIEW ? ` (the look keeps the nearest ${FORTRESS_VIEW} bricks, and this fortress runs on past them: from here all of it is left, and past ${extent} blocks it is met again as the leg goes)` : ''}.${onFrom}${require('./block-stock').pickaxeCarried(bot) ? '' : ` The sweep's legs over open air and lava lay a block a cell, and with no pickaxe carried none comes back or can be dug: the ${blocksCarried(bot)} carried are all there will be.${searchReachSays(bot)}`}${leftBeforeSays(state, here)}`,
    run: async () => {
      // From where, kept with it: going back from the same spot asks the
      // same ways again (fortressInView). mid-235-q-nether-2 left its
      // fortress and went back to it every three seconds for a minute, each
      // way in weighed and left in the one question and the fortress taken
      // back in the next (note 541). The one set-aside (fortress-hold.js).
      const ways = Object.keys(options).filter(k => k !== 'keep_searching').map(k => k.replaceAll('_', ' '));
      require('./fortress-hold').leave(bot, state, { anchor, target: nearest, radius: Math.max(anchor === nearest ? 0 : anchor.extent || 0, Math.ceil(flatTo(nearest, anchor)) + extent), left: ways, save, goal });
      return null;
    } };
  // What waits at the bricks, seen or not: mid-227-o dug down ten blocks
  // into its fortress told "none in view", onto a blaze two blocks off and
  // six wither skeletons, and was dead in five seconds (note 418). The
  // bot knows the mobs about whether a wall is between or not.
  const atBricks = (() => { try { return threats(bot, 64).filter(t => t.entity.position && t.entity.position.distanceTo(new Vec3(nearest.x, nearest.y, nearest.z)) <= 16); } catch (_) { return []; } })();
  const counted = {};
  for (const t of atBricks) counted[t.entity.name] = (counted[t.entity.name] || 0) + 1;
  const waiting = Object.entries(counted).map(([n, c]) => `${c} ${n.replaceAll('_', ' ')}${c === 1 ? '' : 's'}`).join(', ');
  // And the health in Nether terms, through what is worn: a way that
  // arrives among blazes arrives at it (note 515).
  let hits = null; try { hits = require('./crossing-kit').netherHitSays(bot); } catch (_) { /* no body */ }
  if (waiting) for (const [key, option] of Object.entries(options)) if (!PICKAXE_WAYS.includes(key)) option.description += ` Within sixteen blocks of the bricks, seen or not: ${waiting}; a way that arrives among them arrives in their fight.${hits && key !== 'keep_searching' ? ` ${hits}` : ''}`;
  // The blazes at the bricks are the rods themselves, and a fight with one
  // wants the sword, not a pickaxe or blocks: said on the ways that take the
  // bot from them for a pickaxe or blocks (note 750; 25590's fetch of stems
  // 173 blocks off, a blaze come to it at the floor's edge).
  if (counted.blaze) for (const key of ['fetch_stems', 'return_for_blocks']) {
    if (options[key]) options[key].description += ` ${counted.blaze} blaze${counted.blaze === 1 ? ' is' : 's are'} within sixteen blocks of the bricks now: a blaze is fought with the sword, and the fight wants no pickaxe and no blocks; this takes the bot away from ${counted.blaze === 1 ? 'it' : 'them'}.`;
  }
  // What each way came to on this approach, said with it.
  for (const [key, option] of Object.entries(options)) {
    const tries = (record?.failed || []).filter(f => f.choice === key);
    if (tries.length) option.description += ` Tried on this approach ${tries.length === 1 ? 'once' : `${tries.length} times`} and ended no nearer: ${tries.at(-1).why}.`;
  }
  // A bridge or a pillar onto the deck, with the blocks for the whole of it
  // already carried (bridgeReady; pillar_up offered only the same way,
  // climbWays above): named first, ahead of a route the pathfinder may
  // yet refuse or a staircase dug by hand. 25581 (mid-243-ig, note 745)
  // carried 172 blocks and no pickaxe, was offered cross_level and
  // pillar_up (both ready) behind walk_route and return_for_blocks, and
  // answered a leave three times in the same second instead.
  const orderedOptions = bridgeFirstOrder(options, { bridgeReady });
  return { options: orderedOptions, facts: { fortress: { distance: flat, height: dy }, leaving: reach, ...(noRoute ? { walkRoute: noRoute } : {}), ...(noStair ? { staircase: noStair } : {}), ...(byHand ? { byHand } : {}), ...(noPillar ? { pillar: noPillar } : {}), ...(noDescend ? { descend: noDescend } : {}), ...(crossNotNow ? { crossLevel: crossNotNow } : {}), health: bot.health, food: bot.food, ...(hits ? { whatAHitCosts: hits } : {}), blocksCarried: blocksCarried(bot),
    ...(bot.inventory?.items ? { pickaxe: pickaxeSays(bot, goal) } : {}),
    threatsInView: inView.map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    ...(waiting ? { atTheBricks: waiting } : {}),
    // Blazes at the bricks: what the bot's fights with blazes came to, by the health and hunger begun at (blaze-record.js, note 631).
    ...(counted.blaze ? { playedRecord: require('./blaze-record').says(bot) } : {}),
    ...(record?.failed?.length ? { failed: record.failed.map(f => `${f.choice.replaceAll('_', ' ')}: ${f.why}`) } : {}),
    ...(Object.keys(triedHere).length ? { triedFromHere: Object.entries(triedHere).map(([k, why]) => `${k.replaceAll('_', ' ')}: tried from where the bot stands, with the same blocks and pickaxe, and ended no nearer (${why}); not offered again from here`) } : {}) } };
}

// Standing on the fortress's floors as its map has them (fortress-map.js
// standing: a floor seen within a block of the feet's height and three
// across), the one test of "in the fortress" said (note 687).
function onFortressFloors(bot, state) {
  if (!state?.map?.cells || !bot?.entity?.position) return false;
  try { return !!require('./fortress-map').standing(bot, state.map); } catch (_) { return false; }
}

// `stretch`: on the fortress's floors, the way to a stretch of them the
// patrol's walk did not reach (its why), kept apart from the way into the
// fortress and asked afresh for each stretch. mid-235-p-nether-3-fortress-3
// stood on a floor with the next stretch twelve blocks off across a gap of
// two: the walk refused the edge, the staircase found "no floor 2" and
// rested, and every pass for an hour reached nothing, the span never tried
// (note 556).
async function approachFortress(bot, task, goal, save, actions, state, nearest, bricks = [], { stretch = null } = {}) {
  // Every way is surveyed and walked from a cell with a floor: crouched
  // over an edge on the block beside, the bot steps back onto it first.
  try { await stepOntoFooting(bot, task); }
  catch (err) { task.check(); if (!retryable(err)) throw err; }
  const found = { x: nearest.x, y: nearest.y, z: nearest.z };
  const kind = stretch ? 'stretchWay' : 'approach', same = stretch ? 2 : SAME_FORTRESS;
  // The approach is the fortress's, not the brick's (note 706): an aim moved
  // within the same fortress keeps what failed on the way to it.
  const apart = stretch ? Math.hypot(state[kind]?.found.x - found.x, state[kind]?.found.z - found.z) > same || Math.abs(state[kind]?.found.y - found.y) > 1
    : !!state[kind] && !sameFortress(state, state[kind].found, found);
  if (!state[kind] || apart) {
    state[kind] = { found, failed: stretch ? [{ choice: 'walk_route', why: stretch.why, at: Date.now() }] : [] };
  }
  const approach = state[kind];
  // Where the bot stood when the way to this place was first asked: the
  // place is kept from about there (findFortressStep, note 613).
  const at = bot.entity.position;
  if (!approach.from || approach.found.x !== found.x || approach.found.y !== found.y || approach.found.z !== found.z) approach.from = { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) };
  approach.found = found;
  // "In the fortress" (narration.js) only standing on its floors seen:
  // a way to a place asked from off them (go_to_blazes, the spawner) is
  // no walk in it. 25585 said "I'm in the fortress" 44 blocks under it
  // (note 687).
  const onFloors = !!stretch && onFortressFloors(bot, state);
  // firstAt travels with it: narration reads it to tell a fortress already
  // announced from one just found (note 739), instead of saying "A
  // fortress! I'm heading for it." anew each time this step is set, which a
  // large fortress's approach (fortress_approach held up to five minutes,
  // asked again on every failure) does often.
  const fortressAt = !stretch && state.fortressAt ? { x: state.fortressAt.x, y: state.fortressAt.y, z: state.fortressAt.z, firstAt: state.fortressAt.firstAt } : null;
  goal.step = { action: 'find_fortress', found, ...(fortressAt ? { fortress: fortressAt } : {}), ...(onFloors ? { walking: found } : {}), legs: state.legs }; save();
  const approaches = await fortressApproaches(bot, task, goal, save, actions, state, nearest, bricks, approach);
  const { options } = approaches;
  // The blazes lead: they are what the search is for, and the ones about
  // now may be nearer than the place asked about (note 570).
  const blazesSeen = blazesSeenFacts(bot, goal);
  // The rods line goes after the rest: read first it moved recorded answers (eye-need.js).
  const facts = { ...(blazesSeen ? { blazesSeen } : {}), ...approaches.facts, ...rodsFact(bot, goal) };
  if (stretch) {
    const what = stretch.what || 'a stretch of the fortress\'s floors';
    facts.stretch = `${what}, ${Math.round(flatTo(nearest, bot.entity.position))} blocks off; the walk there on foot failed: ${stretch.why}`;
    // On its floors, leaving a way is not leaving the fortress: mid-242-ac-
    // nether-1 chose keep_searching for one stretch it had no way to, and
    // its whole fortress, the bot standing on it with blazes seen there
    // forty times, was set aside for ten minutes of legs that ended at once
    // (note 557). The way is left; the fortress's other ways are asked.
    delete options.keep_searching;
    // Heading toward is the way to the fortress itself (note 708), not to a
    // place asked about beside it.
    delete options.head_toward;
    // The ways across along the ground to floors seen unwalked (note 564).
    if (stretch.across) {
      for (const [key, option] of Object.entries(crossingOptions(bot, task, what, stretch.across, actions))) {
        const tries = approach.failed.filter(f => f.choice === key);
        if (tries.length) option.description += ` Tried on this approach ${tries.length === 1 ? 'once' : `${tries.length} times`} and ended no nearer: ${tries.at(-1).why}.`;
        options[key] = option;
      }
    }
    options.other_way = { description: `Leave this way for now: ${what} is set aside for ten minutes, not the fortress, and the fortress's other ways are asked again (its unwalked floors, where blazes were seen, a spawner seen, walking its corridors again, or a leg away).`,
      run: async () => { stretch.leave?.(); return null; } };
  }
  let pick = approach.choice && approach.until > Date.now() && options[approach.choice] ? approach.choice : null;
  if (!pick) {
    const tree = Object.fromEntries(Object.entries(options).map(([key, o]) => [key, { description: o.description, run: o.run }]));
    const decision = await decide('fortress_approach', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree, state: facts,
      context: { failed: approach.failed.map(f => f.choice) }, target: found });
    if (decision.stale) return;
    pick = decision.path.at(-1);
    approach.choice = pick; approach.until = Date.now() + APPROACH_HOLD_MS; save();
  }
  goal.step = { action: 'find_fortress', found, ...(fortressAt ? { fortress: fortressAt } : {}), ...(onFloors ? { walking: found } : {}), approach: pick, legs: state.legs }; save();
  const from = nearest.distanceTo(bot.entity.position), startedAt = bot.entity.position.clone();
  let why = null;
  try { why = await options[pick].run(); }
  catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  // What failed is kept with the fortress: going back to it says so.
  if (pick === 'keep_searching') { delete approach.choice; delete approach.until; save(); return 'Jev chose to leave the fortress and search on'; }
  if (pick === 'other_way') {
    delete approach.choice; delete approach.until;
    if (stretch) leaveWay(state, found, stretch.what || 'the place chosen', `the walk there on foot failed: ${stretch.why}`, bot.entity.position);
    save(); return 'Jev chose to leave this way for now';
  }
  // A pickaxe had is what the way was for: the way in is asked again with it.
  if (PICKAXE_WAYS.includes(pick) && pickaxeTier(bot) >= 1) { delete approach.choice; delete approach.until; save(); return null; }
  // Gone home for the kit: the way in is asked again on the way back.
  if (pick === 'return_for_blocks' && why === 'returned') { delete approach.choice; delete approach.until; save(); return null; }
  // Closer counts, by a step's ground (STEP_GAIN); a shuffle along the shelf
  // does not.
  if (nearest.distanceTo(bot.entity.position) < from - STEP_GAIN) { approach.failed = []; save(); return null; }
  // Where it failed from and with what, so the same way is not offered
  // again from the same spot with the same pockets (fortressApproaches).
  const stood = startedAt;
  approach.failed = [...approach.failed, { choice: pick, why: why || 'came no nearer', at: Date.now(), from: { x: Math.round(stood.x * 10) / 10, y: Math.round(stood.y * 10) / 10, z: Math.round(stood.z * 10) / 10 }, kit: { carried: blocksCarried(bot), tier: bot.inventory?.items ? pickaxeTier(bot) : 0 } }].slice(-8);
  delete approach.choice; delete approach.until; save();
  return `${pick.replaceAll('_', ' ')}: ${why || 'came no nearer'}`;
}

// A fortress's floors: its bricks with two blocks of air over them, the
// corridors and bridges a player walks. Walls, footings and roofs are not.
function fortressFloors(bot, bricks) {
  if (typeof bot.blockAt !== 'function') return bricks;
  // Lava on a floor is no floor: mid-242-aa-fortress-1's patrol set out for
  // bricks under a lava fall down a stair onto its corridor (note 557).
  const clear = q => { const b = bot.blockAt(q); return !b || (b.boundingBox === 'empty' && !/lava|water/.test(b.name || '')); };
  // Ground to walk: a brick, stair or slab of the fortress's with two
  // clear over it and another such beside it at its height. A lone brick
  // top is no corridor: mid-242-bb's nearest "floor" was the stump of a
  // bridge pier it had dug a shaft up, a brick at the shaft's foot, and
  // before it two bricks of its own stacked in the open, each a place the
  // way in was asked about with the bridge's deck thirty blocks up (note
  // 613).
  // Nor the foot of a hole the bot dug into the fortress's bricks: the
  // cells over it are its own digging (own-blocks.js), not a corridor's.
  const listed = new Set(bricks.map(b => `${b.x},${b.y},${b.z}`));
  const { dugOut } = require('./own-blocks');
  const open = b => clear(b.offset(0, 1, 0)) && clear(b.offset(0, 2, 0)) && !dugOut(bot, b.offset(0, 1, 0)) && !dugOut(bot, b.offset(0, 2, 0));
  // A fence or a wart in the list stands on no floor of its own.
  const floorBlock = b => listed.has(`${b.x},${b.y},${b.z}`) && !NOT_FLOORS.test(bot.blockAt(b)?.name || '') && open(b);
  return bricks.filter(b => floorBlock(b) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => floorBlock(b.offset(dx, 0, dz))));
}
const NOT_FLOORS = /fence|wart|wall/;
// Where no floor is seen yet, the nearest brick by raw distance can be one
// buried in the fortress's own wall or roof, with rock or more bricks on
// every side: nothing stands beside it to walk to, so every way in asks the
// pathfinder for a route to a cell that has none, and it comes back
// "no route" a foot from what looks like the target (25589, mid-242-nc-
// fortress-3, 05:59:44 and 06:00:24Z: `cross_level` and `walk_route` offered
// 1 to 15 blocks from "the nearest", `no_route` straight after, note 725).
// A brick with open air on at least one side (or above) can be walked to
// from that side; one with none cannot, whatever its distance. Preferred
// first; every brick is still tried if none here is exposed.
function exposedBrick(bot, b) {
  if (typeof bot.blockAt !== 'function') return true;
  const open = q => { const bl = bot.blockAt(q); return !bl || (bl.boundingBox === 'empty' && !/lava|water/.test(bl.name || '')); };
  return [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => open(b.offset(dx, dy, dz)));
}
function exposedBricks(bot, bricks) {
  const exposed = bricks.filter(b => exposedBrick(bot, b));
  return exposed.length ? exposed : bricks;
}
// In the fortress: standing at the height of one of its floors, within six
// blocks of it. The one test for the patrol, the approach and staying.
// Not, though, on a block the bot laid itself (a pillar's own top, own-
// blocks.js laidAt): a pillar up to a floor's height followed by a span
// that then failed with no route (bridgeTo threw, note 745, 25581 at
// 343,66,-254) still ends within the six-block, 1.5-height slack of the
// floor it never actually reached, and read as "on it" by proximity
// alone; the next pass said "Walked what I can reach of this fortress"
// having walked none of it. `bot` and `goal` are optional (some callers
// have neither loaded): with neither, the proximity test alone still runs
// as before.
function onFortressFloor(here, floors, bot = null, goal = null) {
  if (bot && typeof bot.blockAt === 'function') {
    try { if (require('./own-blocks').laidAt(bot, here.floored().offset(0, -1, 0), goal)) return false; } catch (_) { /* the block under the feet is not known as the bot's own */ }
  }
  return floors.some(f => Math.abs(f.y + 1 - here.y) <= 1.5 && Math.hypot(f.x + 0.5 - here.x, f.z + 0.5 - here.z) <= 6);
}
// How far a fortress runs from `from` across the ground: its bricks in view
// joined to it with gaps of no more than `link` blocks, the farthest of
// them, and at least sixteen.
function fortressExtent(bricks, from, link = 8) {
  const key = (x, z) => `${Math.floor(x / link)},${Math.floor(z / link)}`;
  const grid = new Map();
  for (const b of bricks) { const k = key(b.x, b.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const joined = new Set(), queue = [from];
  let far = 16;
  while (queue.length) {
    const b = queue.pop(), gx = Math.floor(b.x / link), gz = Math.floor(b.z / link);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const c of grid.get(`${gx + dx},${gz + dz}`) || []) {
      if (joined.has(c) || flat(b, c) > link) continue;
      joined.add(c); queue.push(c); far = Math.max(far, Math.ceil(flat(from, c)) + 2);
    }
  }
  return far;
}
// Whether `to` lies among the bricks joined to `from` (fortressExtent's links).
function linkedTo(bricks, from, to, link = 8) {
  const key = (x, z) => `${Math.floor(x / link)},${Math.floor(z / link)}`;
  const grid = new Map();
  for (const b of bricks) { const k = key(b.x, b.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const joined = new Set(), queue = [from];
  while (queue.length) {
    const b = queue.pop(), gx = Math.floor(b.x / link), gz = Math.floor(b.z / link);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const c of grid.get(`${gx + dx},${gz + dz}`) || []) {
      if (joined.has(c) || flat(b, c) > link) continue;
      if (flat(c, to) <= link) return true;
      joined.add(c); queue.push(c);
    }
  }
  return false;
}
// One fortress, one place (note 706): the bricks seen are matched to the
// fortress already known, by its extent (the bricks joined to it, eight
// blocks a link, or within the extent measured before, at least
// SAME_FORTRESS), and only bricks apart from it are another fortress. The
// nearest brick is the approach's aim, not the fortress's name. 25588
// (mid-243-hf) named five places of one fortress in twenty minutes, from
// (-328, -293) to (-264, -308), each stall setting aside sixteen blocks
// round the nearest brick and the next pass taking the nearest brick past
// them as a fortress found anew, its approach begun again from nothing.
const FORTRESS_KEPT_MS = 60 * 60000;
function fortressAnchor(state, bricks, nearest, now = Date.now()) {
  const a = state.fortressAt;
  if (a && now - (a.seenAt || 0) < FORTRESS_KEPT_MS) {
    const d = Math.hypot(nearest.x - a.x, nearest.z - a.z);
    // A region holds one fortress or one bastion, never both (nether-
    // regions.js): bricks seen sparsely, through gaps and openings rather
    // than one continuous wall, can fail both the extent and the link tests
    // while still being the same fortress the search already knows of.
    // 25595 (mid-242-vh, note 739) had its anchor replaced three times in
    // three minutes as the nearest visible brick shifted between distant,
    // disjoint parts of the one fortress ((-106,66,93), then (-70,37,140),
    // then (-98,66,103)), each replacement read as a wholly new find by
    // fortress_leg, fortress_approach and rung_progress in the same second,
    // each pulling toward whichever point it last saw. Kept, not replaced:
    // the same region is the same fortress, so the anchor's own point and
    // firstAt stay; only its extent grows to cover what is newly seen.
    const ra = regions.regionOf(a.x, a.z), rn = regions.regionOf(nearest.x, nearest.z);
    if (d <= Math.max(a.extent || 0, SAME_FORTRESS) || linkedTo(bricks, a, nearest) || (ra.rx === rn.rx && ra.rz === rn.rz)) {
      a.extent = Math.max(a.extent || 16, Math.ceil(d) + 2); a.seenAt = now;
      return a;
    }
  }
  state.fortressAt = { x: nearest.x, y: nearest.y, z: nearest.z, extent: fortressExtent(bricks, nearest), firstAt: now, seenAt: now };
  return state.fortressAt;
}
// The anchor, seeded from bricks near the cage itself, for a fortress not
// yet known this way: findFortressStep's own bricks search (below) only
// runs where the atCage gate does not return first, so a trial that reaches
// a live cage before that search ever ran (a saved position, or every early
// tick quieted by the flat GO_TO_NEAR gate) never learns the fortress's own
// extent, and cageExtent stays false for as long as the trial runs: 25594
// (mid-242-sc) was asked fortress_approach 9 blocks from its cage and again
// four minutes later, from a box built 13.2 blocks off (note 720). Cheap (a
// second bricks search, the same as the one below): only run where the
// anchor is still unknown.
function seedFortressAt(bot, state, cage) {
  if (state.fortressAt) return state.fortressAt;
  const ids = FORTRESS_BLOCKS.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  if (!ids.length) return null;
  let own; try { own = require('./own-blocks').ownSet(bot, state); } catch (_) { own = new Set(); }
  let near = [];
  try { near = bot.findBlocks({ matching: ids, maxDistance: 48, count: FORTRESS_MIN_BRICKS + own.size }).filter(b => !own.has(`${b.x},${b.y},${b.z}`)); } catch (_) { near = []; }
  if (near.length < FORTRESS_MIN_BRICKS) return null;
  const cageV = new Vec3(cage.x, cage.y, cage.z);
  const nearest = near.slice().sort((a, b) => a.distanceTo(cageV) - b.distanceTo(cageV))[0];
  return fortressAnchor(state, near, nearest);
}
// Two places of the one fortress known (its anchor's reach), or failing
// one, within SAME_FORTRESS of each other.
function sameFortress(state, p, q) {
  const a = state?.fortressAt, reach = a ? Math.max(a.extent || 0, SAME_FORTRESS) : 0;
  if (a && Math.hypot(p.x - a.x, p.z - a.z) <= reach && Math.hypot(q.x - a.x, q.z - a.z) <= reach) return true;
  // A region holds one fortress or one bastion, never both: two places
  // in the fortress's own known region are its own, however sparsely
  // joined or far beyond its extent as first measured (note 739,
  // fortressAnchor above; keeps this reading the same one record).
  if (a) {
    const rp = regions.regionOf(p.x, p.z), rq = regions.regionOf(q.x, q.z), ra = regions.regionOf(a.x, a.z);
    if (rp.rx === ra.rx && rp.rz === ra.rz && rq.rx === ra.rx && rq.rz === ra.rz) return true;
  }
  return Math.hypot(p.x - q.x, p.z - q.z) <= SAME_FORTRESS;
}

// How far the fortress's bricks in view run from here along each heading
// (east, south, west, north): a corridor goes on past its last brick seen.
function fortressRuns(bricks, here) {
  return HEADINGS.map(([dx, dz]) => Math.max(0, ...bricks.map(b => Math.round((b.x + 0.5 - here.x) * dx + (b.z + 0.5 - here.z) * dz))));
}

// The way across to a group of floors seen unwalked (fortress-map.js
// crossing): along the ground, and round the lava where the way has lava
// on it and there is a way round.
function crossingFor(bot, map, planned, keys) {
  const fm = require('./fortress-map');
  const members = [...new Set([keys].flat().flatMap(k => [...fm.reach(map, k).keys()]))].map(fm.parse);
  const way = fm.crossing(bot, planned, members);
  const round = way?.cover ? fm.crossing(bot, planned, members, { lava: false }) : null;
  return { way, round, members, says: acrossSays(way, round) };
}
function acrossSays(way, round) {
  const fm = require('./fortress-map');
  return way ? `${fm.crossingSays(way)}, about ${way.seconds} seconds${round ? `; round the lava instead, ${fm.crossingSays(round)}, about ${round.seconds} seconds` : way.cover ? '; no way round the lava found along the ground' : ''}` : null;
}
// The floors seen unwalked, as parts to cross to: each part's way across
// along the ground found in one search, and the parts one way reaches
// through the same lava, rock or gap offered as one, the nearest part
// named. mid-235-q-nether-1-fortress-3's nearest two parts lay across the
// same lava in its corridor, offered apart, and the choice to cross was
// split between them (note 564).
const UNWALKED_PARTS = 8;
function unwalkedParts(bot, map, planned) {
  const fm = require('./fortress-map');
  const groups = planned.groups.slice(0, UNWALKED_PARTS);
  const members = groups.map(g => [...fm.reach(map, g.key).keys()].map(fm.parse));
  const ways = fm.crossings(bot, planned, members);
  const rounds = ways.some(w => w?.cover) ? fm.crossings(bot, planned, members.map((m, i) => ways[i]?.cover ? m : null), { lava: false }) : [];
  // The same obstacle: the first cell that is not floor, of one kind,
  // within a corridor's width of the other's.
  const parts = [];
  groups.forEach((g, i) => {
    const way = ways[i], first = way?.cells.find(c => c.kind !== 'walk');
    const same = first && parts.find(p => p.first && p.first.kind === first.kind && Math.abs(p.first.x - first.x) + Math.abs(p.first.y - first.y) + Math.abs(p.first.z - first.z) <= 3);
    if (same) same.groups.push(g);
    else parts.push({ g, way, round: rounds[i] || null, first, groups: [g] });
  });
  return parts;
}
// How far the floors joined to here run: a room walked again is paced.
function joinedExtentSays(planned) {
  const cells = [...(planned.dist?.keys() || [])].map(k => k.split(',').map(Number));
  if (!cells.length) return 'no floor joined to here';
  const w = Math.max(...cells.map(c => c[0])) - Math.min(...cells.map(c => c[0])) + 1, l = Math.max(...cells.map(c => c[2])) - Math.min(...cells.map(c => c[2])) + 1;
  return `the ${cells.length} floors joined to here lie within ${Math.max(w, l)} by ${Math.min(w, l)} blocks, and walking them again is walking back and forth in that`;
}
// The ways across along the ground, for fortress_approach on the way to
// floors seen unwalked: covering the lava lying on the floor, scooping its
// sources with the buckets carried, and digging through (or round the lava
// through) the rock filling the way. Each priced by its cells, blocks and
// seconds, and what standing beside lava risks.
function crossingOptions(bot, task, what, across, actions) {
  const options = {}, { way, round } = across;
  if (!way) return options;
  const { crossAlong } = require('./bridging');
  const fm = require('./fortress-map');
  const carried = blocksCarried(bot);
  const run = (c, scoop = false) => async () => {
    const done = await crossAlong(bot, task, c, { navigate: actions.navigate, scoop });
    return done ? null : 'came no nearer';
  };
  const blocksSays = c => {
    const need = c.cover + c.span;
    if (!need) return '';
    return ` ${need} block${need === 1 ? '' : 's'} laid of the ${carried} carried${need > carried ? `: they run out ${carried} in, and the crossing stops there` : `, ${carried - need} left after`}.${require('./block-stock').afterSays({ noPickaxe: !require('./block-stock').pickaxeCarried(bot), left: carried - need })}`;
  };
  const toolSays = c => {
    if (!c.digs) return '';
    const pick = (bot.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name));
    return pick ? '' : ' No pickaxe carried: the rock is dug by hand, and netherrack dug by hand drops nothing.';
  };
  const { RATE, BURNS_AFTER } = require('./body');
  const fireproof = !!require('./body').lasts(bot, 'lava').fireResistance;
  const burn = c => c.besideLava ? ` ${c.besideLava} of its cells are beside lava: a misstep or a push there puts the bot in it, about ${RATE.lava} health a second while in it and burning up to ${BURNS_AFTER.lava} seconds after at a health a second${fireproof ? ' (fire resistance is on the body: none of that while it lasts)' : ''}; the crossing is walked crouched, and a cell with lava on it when reached is not walked into.` : '';
  if (way.cover) {
    const feed = way.feed || {};
    const feedSays = feed.source ? `has a source at (${feed.source.join(', ')})` : `is flowing, with no source seen among the ${feed.cells || way.cover} lava cells followed from it${feed.falls ? `: it runs down from above, up to (${feed.top.join(', ')}), and keeps coming` : ''}`;
    options.cover_lava = { description: `Cover the lava lying on the floor on the way to ${what}: ${fm.crossingSays(way)}. A block laid into lava takes its place, and flowing lava whose way is covered stops there: ${way.cover === 1 ? 'its one cell on the way is' : `the ${way.cover} cells of it on the way are each`} covered with a block laid on the floor under it and walked on a block up.${blocksSays(way)} About ${way.seconds} seconds.${toolSays(way)} The lava ${feedSays}; lava still running beside the laid blocks can run onto one where it has room.${burn(way)}`,
      run: run(way) };
    const buckets = (bot.inventory?.items?.() || []).filter(i => i.name === 'bucket').reduce((n, i) => n + i.count, 0);
    if (buckets && way.lavaSources) {
      options.scoop_lava = { description: `Scoop the lava on the way to ${what} with the ${buckets} empty bucket${buckets === 1 ? '' : 's'} carried: ${way.lavaSources} of its ${way.cover} cells on the way are sources, and a bucket takes a source each (flowing lava cannot be scooped; a flow whose source is taken drains in a few seconds); a cell still lava when reached is covered with a block instead. ${fm.crossingSays(way)}, about ${way.seconds} seconds at most.${burn(way)}`,
        run: run(way, true) };
    }
  }
  const dig = way.cover ? round : way;
  if (dig?.digs) {
    options.dig_through = { description: `Dig through the rock filling the way to ${what}${way.cover ? ', round the lava' : ''}: ${fm.crossingSays(dig)}.${blocksSays(dig)} About ${dig.seconds} seconds, ${dig.digSeconds} of them digging.${toolSays(dig)} Rock is dug only where no lava or water lies behind it.${burn(dig)}`,
      run: run(dig) };
  } else if (way.cover && round?.span) {
    // Round the lava over open air: a span laid along the ground's edge.
    options.span_round = { description: `Go round the lava to ${what} along the ground, laying a one-wide span where there is no floor: ${fm.crossingSays(round)}.${blocksSays(round)} About ${round.seconds} seconds, crouched; on the span no mob is swung at or turned to.${burn(round)}`,
      run: run(round) };
  }
  return options;
}

// The fortress in view, as fortress_leg offers it (chooseLeg). `stay`: the
// bot is on its floors and has walked all it can reach of what it has seen
// (fortress-map.js, `map` and `planned`); what is left is Jev's with what the
// map comes to: walking its corridors again, crossing to floors seen
// unwalked, waiting by a spawner seen, the blazes. Otherwise its bricks are
// left behind or set aside, and going back is offered with when and why.
function fortressInView(bot, goal, save, state, bricks, { stay, map = null, planned = null, aside = null }) {
  const here = bot.entity.position;
  const nearest = bricks.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  const off = Math.round(nearest.distanceTo(here));
  const near = (goal.mobHunt?.sightings || []).filter(s => s.dimension === bot.game?.dimension && Math.hypot(s.x - nearest.x, s.z - nearest.z) <= LEAVE_RADIUS);
  const blazes = near.reduce((n, s) => n + (s.seen || 1), 0);
  // How many of them were in sight: heard through its walls is not a blaze
  // the walk of its floors meets (note 686).
  const inSight = near.every(s => Number.isInteger(s.inSight)) ? near.reduce((n, s) => n + s.inSight, 0) : null;
  const seen = blazes ? `blazes seen near it ${blazes} time${blazes === 1 ? '' : 's'}${inSight === null ? '' : ` (${inSight ? `${inSight} in sight` : 'none in sight'}, the rest heard through the walls)`}` : 'no blaze seen near it yet';
  const passes = state.patrols || 0;
  const minutes = state.inFortressSince ? Math.round((Date.now() - state.inFortressSince) / 60000) : 0;
  // Its floors against where the bot stands: bricks a block off can be a
  // footing under corridors eight blocks up (note 523).
  const floors = fortressFloors(bot, bricks);
  const floor = floors.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  const floorSays = !floor ? 'none of its bricks in view has room to stand on it'
    : onFortressFloor(here, floors, bot, goal) ? 'the bot stands at the height of its floors'
    : `the nearest of its floors ${Math.round(Math.hypot(floor.x + 0.5 - here.x, floor.z + 0.5 - here.z))} blocks across and ${Math.abs(Math.round(floor.y + 1 - here.y))} ${floor.y + 1 >= here.y ? 'up' : 'down'}`;
  const facts = { bricks: bricks.length, nearestBlocksOff: off, floors: floorSays, passes, minutesThere: minutes, blazesSeenNear: blazes };
  const walkedSays = planned => `${planned.walked} of the ${planned.seen} floors seen walked`;
  if (state.map) facts.map = require('./fortress-map').mapSays(bot, state.map, planned || require('./fortress-map').plan(bot, state.map));
  if (stay && map && planned) {
    const fm = require('./fortress-map');
    const others = {};
    // A spawner seen through open air is where blazes come without walking:
    // waiting by it is a player's way (blaze-stand.js has how it makes them).
    // Only one seen: a spawner behind a wall is not known.
    const known = spawnersKnown(bot, state)[0];
    const spawner = known && new Vec3(known.s.x, known.s.y, known.s.z);
    if (spawner) {
      const d = Math.round(spawner.offset(0.5, 0.5, 0.5).distanceTo(here));
      const steps = fm.stepsTo(map, planned, spawner);
      const way = steps === null ? 'No floor seen joins it to where the bot stands: the walk there is on foot first, and where it finds no way the way there is asked (fortress_approach).' : `Floors seen join it to where the bot stands, about ${steps} steps.`;
      facts.spawner = `a spawner seen ${d} blocks off at (${spawner.x}, ${spawner.y}, ${spawner.z})`;
      others.wait_at_spawner = { description: `Wait by the spawner seen at (${spawner.x}, ${spawner.y}, ${spawner.z}), ${d} blocks off, for ${SPAWNER_WAIT_MS / 60000} minutes: a fortress's spawners are blaze spawners, and while a player is within sixteen blocks of one it makes up to four blazes within four blocks of itself every ten to forty seconds, and the hunt takes each one as it comes into view. ${way} ${capital(seen)}${known.s.lastThereAt ? `; ${known.s.kills || 0} killed and ${known.s.rods || 0} rods taken within 16 of it` : ''}. The legs are asked again after.${state.spawnerWaitEnded ? ` The last wait here ended: ${state.spawnerWaitEnded}.` : ''}`,
        spawner: { x: spawner.x, y: spawner.y, z: spawner.z },
        // The spawner's next blazes, by its clock where a try was seen (waits.js, note 698).
        waits: require('./waits').spawnerTry(bot, spawner),
        run: () => { state.spawnerWait = { x: spawner.x, y: spawner.y, z: spawner.z, until: Date.now() + SPAWNER_WAIT_MS }; delete state.spawnerWaitEnded; save(); return 'wait'; } };
    }
    // Floors seen that no floor seen joins to here, nearest first: the way
    // across is Jev's, each said as it lies along the ground (lava lying on
    // the floor to cover, rock filling the way to dig, open air to span),
    // and round the lava where there is a way round. The straight line
    // between the nearest two floors went through the walls: mid-235-q-
    // nether-1-fortress-3's was "4 of lava, 2 of wall or rock", where the way
    // was six blocks laid into the lava of the corridor beside (note 564).
    // The nearest floors not yet walked, kept beside the patrol's own
    // description below (note 739): stay_in_fortress said only its own
    // pacing, never what the closest unwalked branch would cost instead.
    // 25588 (mid-242-we-fortress-1, 08:37:15Z) chose stay_in_fortress while
    // its own text said three minutes of walking back and forth with no
    // spawner seen, and unwalked_1 sat 13 blocks off with one block to dig.
    let firstUnwalked = null;
    // Each keyed by the number its floors were given when first offered
    // (keys.js, note 749), not by its place among the nearest three.
    const unwalkedKey = g => `unwalked_${require('./decisions/keys').id(goal, 'unwalked', { x: g.at[0], y: g.at[1] + 1, z: g.at[2] }, { near: 8, base: 1 })}`;
    unwalkedParts(bot, map, planned).filter(part => !wayLeft(state, { x: part.g.at[0], y: part.g.at[1] + 1, z: part.g.at[2] })).slice(0, 3).forEach((part, i) => {
      const { g, groups } = part, across = { way: part.way, round: part.round, says: acrossSays(part.way, part.round) };
      const gap = across.way ? null : fm.gapTo(bot, planned, g, map);
      const floors = groups.reduce((n, p) => n + p.cells, 0), open = groups.reduce((n, p) => n + p.open, 0);
      const more = groups.length > 1 ? ` (with ${groups.length - 1} more part${groups.length === 2 ? '' : 's'} the same way reaches, ${floors} floors in all, ${open} of them running on into unseen space)` : '';
      const ended = state.goToEnded?.[`unwalked:${g.key}`];
      const dy = g.dy ? ` and ${Math.abs(g.dy)} ${g.dy > 0 ? 'up' : 'down'}` : '';
      if (i === 0) firstUnwalked = { key: unwalkedKey(g), g, dy, cost: across.way ? across.says : gap ? `no way across along the ground found; the nearest crossing is ${gap.across} blocks from a floor it can walk to` : 'no way across along the ground found yet' };
      others[unwalkedKey(g)] = { description: `Go to the fortress's unwalked floors seen ${g.off} blocks off${dy}, at (${g.at[0]}, ${g.at[1] + 1}, ${g.at[2]}): ${g.cells} floor${g.cells === 1 ? '' : 's'} seen there, ${g.open} of them running on into unseen space${more}; no floor seen joins them to where the bot stands` +
        `${across.way ? `: the way across along the ground is ${across.says}` : gap ? `: no way across along the ground found; the nearest crossing is ${gap.across} blocks from a floor it can walk to (${gap.from[0]}, ${gap.from[1] + 1}, ${gap.from[2]}), between them ${gap.says}${gap.dy ? `, ${Math.abs(gap.dy)} ${gap.dy > 0 ? 'up' : 'down'}` : ''}` : ''}. ` +
        `The walk there is on foot first, digging and laying nothing; where it finds no way, the way there is asked (fortress_approach: covering the lava, digging through the rock, a span, a pillar, a drop or a staircase, each with what it meets).${ended ? ` The last try at it ended: ${ended.why}.` : ''}`,
        target: { x: g.at[0], y: g.at[1] + 1, z: g.at[2] }, run: () => { state.goTo = { x: g.at[0], y: g.at[1] + 1, z: g.at[2], kind: 'unwalked', key: g.key, keys: groups.map(p => p.key), since: Date.now() }; save(); return 'goto'; } };
    });
    // What staying gains against that: it re-walks ground already seen (the
    // least lately walked of it), nothing past what has already been seen;
    // said beside the nearest unwalked branch's own distance and cost, when
    // there is one, so pacing is weighed against actually going there.
    const against = firstUnwalked ? ` Against staying: ${firstUnwalked.key} is ${firstUnwalked.g.off} blocks off${firstUnwalked.dy} with ${firstUnwalked.cost}; staying re-walks the ${walkedSays(planned)} already, nothing past what has already been seen there.` : '';
    const patrol = planned.patrol.length ? { key: 'stay_in_fortress',
      description: `Stay in the fortress and walk its corridors again for blazes for ${PATROL_MS / 60000} minutes, the least lately walked first, any new way on seen walked first: ${walkedSays(planned)}, ${planned.patrol.length} of those joined to here twelve or more steps off; ${joinedExtentSays(planned)}${!map.spawners.length ? ', and no spawner has been seen' : map.spawners.some(sp => fm.stepsTo(map, planned, new Vec3(sp.x, sp.y, sp.z)) !== null) ? ', a spawner seen among them' : ', no spawner seen among them'}; ${passes} time${passes === 1 ? '' : 's'} asked here, ${minutes} minute${minutes === 1 ? '' : 's'} in it, ${seen}. Blazes come from their spawners and spawn on the fortress's bricks as time passes. The legs are asked again after.${walkedAllSays(bot, state)}${against}`,
      run: () => { state.patrolUntil = Date.now() + PATROL_MS; save(); return 'stay'; } } : null;
    return { key: 'stay_in_fortress', ...(patrol ? {} : { offer: false }), passes, bricks, facts, others,
      description: patrol?.description || '', run: patrol?.run || (() => 'stay') };
  }
  const leftAgo = state.leaving ? Math.round((LEAVE_MS - (state.leaving.until - Date.now())) / 60000) : null;
  // Set aside for what it was, not always "a face not approached": mid-235-
  // p-fortress-7's was nothing to walk to, said as the other, and going
  // back from the same spot was undone at once, six times (note 528).
  // The latest set-aside that bears here: one left from about where the bot
  // stands, else the latest over these bricks. The oldest was found first:
  // 25585 left its fortress at 19:28:38 and was offered it back at 19:28:39
  // from the same spot, told only of a leave four minutes old from elsewhere,
  // so the same-spot rule never saw the new one (note 682).
  const shuns = (state.shunned || []).filter(sh => sh.why && (leftFromHere(sh, here) || Math.hypot(sh.x - nearest.x, sh.z - nearest.z) <= (sh.radius || 16)));
  const shun = shuns.filter(sh => leftFromHere(sh, here)).at(-1) || shuns.at(-1);
  const mins = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };
  // Standing on its floors, going back from where Jev left it over its ways
  // in is walking them from here, not those ways asked again: offered
  // (note 557). One found to hold nothing to walk to still is not.
  const onFloors = onFortressFloor(here, fortressFloors(bot, bricks), bot, goal);
  const sameSpot = !(onFloors && shun?.left) && leftFromHere(shun, here);
  // Off its floors with every way in it offered from here resting (the
  // ledger's), going back is asking those ways again, each resting, and
  // the approach sends the work straight back here: mid-242-bb chose
  // back_to_fortress seven times in five minutes, offered as "its ways in
  // from here came to nothing", each followed within a second by the
  // approach asked again from the same spot (note 613). Said, not
  // offered, as from where Jev left it (note 541).
  const spent = !onFloors ? require('./tried').spent(goal, 'fortress_approach', { here }) : null;
  const waysRest = !!spent?.spent;
  const why = state.leaving && Math.hypot(state.leaving.x - nearest.x, state.leaving.z - nearest.z) <= LEAVE_RADIUS
    ? `left ${leftAgo} minute${leftAgo === 1 ? '' : 's'} ago after its passes, and set behind the bot for ${Math.round((state.leaving.until - Date.now()) / 60000)} more`
    : shun ? `set aside ${mins(Date.now() - (shun.at || Date.now()))} ago, for ${mins(shun.until - Date.now())} more: ${shun.why}${!sameSpot ? '' : shun.left ? `, from where the bot stands, over the ways into it from here (${shun.left.length ? shun.left.join(', ') : 'none but leaving'}): going back from here is asking those same ways again` : '; the bot stands where that was found, and from here the same look finds the same'}`
    : aside || 'set aside as a face not approached, for ten minutes';
  // Its floors all walked, said plainly: going back walks them again, and
  // that finds nothing new. 25589 chose back_to_fortress over and over at
  // 0.78, each followed by "Walked what I can reach of this fortress"
  // (note 686). From its floors, the map from here; off them, the last
  // time the bot walked all it could reach, while nothing since was walked.
  const fmap = state.map && require('./fortress-map');
  const fromHere = fmap && onFloors ? fmap.plan(bot, state.map) : null;
  const walkedNow = state.map ? Object.values(state.map.cells).filter(c => c[0]).length : 0;
  const allWalked = fromHere?.from ? !fromHere.frontiers.length
    : !!state.walkedAll && Date.now() - state.walkedAll.at < LEAVE_MS * 5 && walkedNow <= state.walkedAll.walked + 8;
  const known = allWalked ? spawnersKnown(bot, state)[0] : null;
  const walkedSaysAll = !allWalked ? '' : ` Every floor of it joined to ${fromHere?.from ? 'here' : 'where the bot last walked it'} that runs on into unseen space has been walked: walking them again finds nothing new.${walkedAllSays(bot, state)}${known ? ` The spawner at (${known.s.x}, ${known.s.y}, ${known.s.z})${known.s.rods ? `, where ${known.s.rods} rod${known.s.rods === 1 ? ' was' : 's were'} taken,` : ''} is a way of its own (go_to_spawner).` : ''}`;
  const restSays = waysRest ? `; from here every way into it last offered came to nothing (${spent.keys.map(k => k.replaceAll('_', ' ')).join(', ')}): going back from here is asking those same ways again` : '';
  // Going back from where it was found to hold nothing to walk to is no
  // move: the patrol sets it aside again before a step. Nor from where Jev
  // left it over its ways in (keep_searching): the same ways are asked
  // again, and each answer undid the other (note 541). Said as a fact
  // with the legs, not offered (chooseLeg).
  return { key: 'back_to_fortress', passes, bricks, facts: { ...facts, setAside: `${why}${restSays}` }, ...(sameSpot || waysRest ? { offer: false, leftHere: sameSpot ? shun?.left || [] : [] } : {}),
    description: `Go back into the fortress in view: ${bricks.length} of its bricks, the nearest ${off} blocks off, ${why}; ${floorSays}; ${seen}.${state.map ? ` Of its floors seen, ${Object.values(state.map.cells).filter(c => c[0]).length} of ${Object.keys(state.map.cells).length} walked.` : ''}${walkedSaysAll} Taken, it is no longer set aside, and ${onFloors ? 'its floors are walked from where the bot stands' : 'the way to its bricks is asked (fortress_approach), or its floors walked when the bot is among them'}.`,
    run: () => {
      delete state.leaving;
      state.shunned = (state.shunned || []).filter(sh => !bricks.some(b => Math.hypot(sh.x - b.x, sh.z - b.z) <= (sh.radius || 16)));
      delete state.target; delete state.rememberedTarget; save();
      return 'fortress';
    } };
}

// A place Jev chose to go to from the search (go_to_blazes): walked on
// foot first, digging and laying nothing; where the walk finds no way, the
// way there is Jev's (fortress_approach, the walk's failure said), leaving
// that way among the ways. How it ended is said with the next offer.
const GO_TO_NEAR = 8;
const GO_TO_SAYS = { blazes: 'where blazes were seen', blazes_about: 'the blazes about now', unwalked: 'unwalked floors of the fortress, seen across a gap' };
// A way chosen runs until it ends, and how it ended is kept and said with
// the next offer, a stall raised from inside it among the ends: the stall
// left state.goTo standing, and the next tick walked the same way again
// unasked (note 570).
async function goToStep(bot, task, goal, save, actions, state) {
  const g = state.goTo;
  try { await goToWay(bot, task, goal, save, actions, state); }
  catch (err) {
    if (err?.name === 'Stalled' && state.goTo === g) {
      (state.goToEnded ||= {})[g.key ? `${g.kind}:${g.key}` : g.kind] = { why: String(err.message || err).replace(/^Stalled: /, ''), at: Date.now() };
      delete state.goTo; save();
    }
    throw err;
  }
}
async function goToWay(bot, task, goal, save, actions, state) {
  const g = state.goTo, target = new Vec3(g.x, g.y, g.z);
  goal.step = { action: 'find_fortress', goingTo: { x: g.x, y: g.y, z: g.z, kind: g.kind }, legs: state.legs || 0 }; save();
  // Floors across a gap are reached when stood on: at their height, a step
  // from the cell; blazes when near. Within 2.5 blocks from the cell's
  // corner was "reached" from a block under the floor two across: 25598's
  // crossing dug by hand for seven minutes to a fortress floor a block up,
  // was "reached it" three times in three seconds without a step, and left
  // the fortress for the next bricks forty-eight blocks off (note 669).
  const close = g.kind === 'unwalked'
    ? () => { const p = bot.entity.position; return Math.abs(p.y - target.y) < 0.75 && Math.hypot(p.x - target.x - 0.5, p.z - target.z - 0.5) <= 1.5; }
    : () => target.distanceTo(bot.entity.position) <= GO_TO_NEAR;
  let why = null;
  if (!close() && actions.navigate) {
    try { await actions.navigate(bot, task, new goals.GoalNear(g.x, g.y, g.z, g.kind === 'unwalked' ? 1 : 4), { timeoutMs: 60000, stallMs: 8000, passing: true, onFoot: true }); }
    catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  }
  if (!close()) {
    let left = false;
    // Floors seen unwalked: the ways across them along the ground are
    // among the ways asked (note 564).
    let across = null;
    if (g.kind === 'unwalked' && g.key && state.map?.cells?.[g.key]) {
      const fm = require('./fortress-map');
      across = crossingFor(bot, state.map, fm.plan(bot, state.map), (g.keys || [g.key]).filter(k => state.map.cells[k]));
    }
    const ended = await approachFortress(bot, task, goal, save, actions, state, target.floored(), [],
      { stretch: { why: why || 'the walk came no nearer', what: GO_TO_SAYS[g.kind] || 'the place chosen', leave: () => { left = true; }, across } });
    if (ended) why = left ? 'Jev chose to leave that way for now' : ended;
  }
  const reached = close();
  (state.goToEnded ||= {})[g.key ? `${g.kind}:${g.key}` : g.kind] = { why: reached ? 'reached it' : why || 'came no nearer', at: Date.now() };
  // Floors not reached are passed over a while, their why said (the map's
  // waysFailed); reached, the next look walks them.
  if (g.kind === 'unwalked' && g.key && !reached && state.map?.failed) state.map.failed[g.key] = { why: why || 'came no nearer', at: Date.now() };
  if (g.kind === 'blazes') {
    const spot = (goal.mobHunt?.sightings || []).find(s => s.x === g.x && s.y === g.y && s.z === g.z);
    if (spot && !reached) { spot.tries = (spot.tries || 0) + 1; spot.why = why || 'came no nearer'; }
  }
  delete state.goTo; save();
}

async function findFortressStep(bot, task, goal, save, actions) {
  const state = goal.fortressSearch ||= { axis: Math.round(bot.entity.position.x) % 2 === 0 ? 1 : -1, legs: 0 };
  if (await stayKit(bot, task, goal, save, actions)) return;
  // At a live spawner's cage with the rods wanted, the bot is where the
  // search is for: no fortress visit, approach or leg is asked from there
  // (cage-hold.js, note 700). 25589 (mid-242-hd-fortress-2) was asked
  // fortress_approach two blocks from the cage at (-108, 77, 155) and chose
  // keep_searching, "Leaving this fortress for now" (23:24:46Z); 25585 said
  // "I'm looking for a fortress (leg 4)" from beside its cage. The step
  // names the cage; the stall's question comes with the stay, the slit and
  // the ways off. A wait or a walk to a spawner Jev chose runs as it does.
  //
  // A flat eight blocks from the cage was not the fortress's own reach: 25594
  // rose into its own box by the cage (nine off by that count) and was asked
  // fortress_approach a second after answering stand_by_spawner, taking
  // cross_level "toward the fortress, 6 blocks off" while at its spawner; and
  // 25589 said "I'm looking for a fortress (leg 6, heading east)" three
  // blocks from the cage (note 717). Held instead against the fortress's own
  // extent (fortressAnchor's reach, mob-hunt.js), the one place it is already
  // known to run to: within it, with the cage's own fortress and rods
  // wanted, the bot is still where the search is for however far the box or
  // the wait stands from the cage itself.
  const atCage = !state.spawnerWait && !state.goTo ? require('./cage-hold').cageFight(bot, goal) : null;
  if (atCage) seedFortressAt(bot, state, atCage.cage);
  const fa = state.fortressAt;
  const cageExtent = atCage && fa && Math.hypot(atCage.cage.x - fa.x, atCage.cage.z - fa.z) <= Math.max(fa.extent || 0, GO_TO_NEAR)
    ? Math.hypot(bot.entity.position.x - fa.x, bot.entity.position.z - fa.z) <= Math.max(fa.extent || 0, GO_TO_NEAR) : false;
  if (atCage && (atCage.off <= GO_TO_NEAR || cageExtent)) {
    if (goal.step?.action !== 'at_spawner') console.log(`[fortress] at the spawner at (${atCage.cage.x}, ${atCage.cage.y}, ${atCage.cage.z}), ${atCage.off} blocks off${cageExtent ? `, within the fortress's own ${Math.max(fa.extent || 0, GO_TO_NEAR)} blocks` : ''}, ${atCage.need} rods wanted: no visit, approach or leg asked from here`);
    goal.step = { action: 'at_spawner', target: { x: atCage.cage.x, y: atCage.cage.y, z: atCage.cage.z }, off: atCage.off, legs: state.legs || 0 }; save();
    await sleep(1000); task.check(); return;
  }
  // A fetch of stems chosen under the fortress work and still holding (cut by
  // a preemption, say) is carried on here, not set down by the fortress's own
  // questions (fortress-hold.js, note 721): 25584 chose fetch_stems at
  // 04:33:41Z and was asked the fortress's visit in its place a second later.
  const errand = require('./fortress-hold').errandHolding(bot, goal);
  if (errand && actions.acquireStep) {
    console.log(`[fortress] carrying on the fetch of stems chosen ${Math.round((Date.now() - errand.at) / 1000)} seconds ago (${errand.q.replaceAll('_', ' ')}), not asking the fortress's questions in its place`);
    const done = await require('./nether-wood').fetchStems(bot, task, goal, save, { acquireStep: actions.acquireStep });
    if (done.unmade) throw new Error(done.unmade);
    return;
  }
  // The hunt's work while no blaze is near is this search, whatever branch
  // of it runs: a tick that only asked Jev left the hunt's own step named,
  // and the step "turned between find fortress and hunt mob" twice a
  // second in mid-235-p-fortress-6 (note 523).
  if (goal.step?.action !== 'find_fortress') { goal.step = { action: 'find_fortress', legs: state.legs || 0 }; save(); }
  // What is seen of the Nether as the search goes (nether-coverage.js), a
  // few lines a tick, the legs walked in one go included.
  coverage.watch(bot, goal); coverage.stand(bot, state);
  // An escalation owed to the leg's question (tried.js owed): an answer of
  // it in hand came to nothing below (the walk of the floors failed, every
  // way to the fortress rests). That answer ends here and the question is
  // asked, with the failure said, not carried on unasked while the next
  // failure goes past the question to the rung: on 25583 a floor two blocks
  // up with no way to it was walked again after the escalation, and the
  // rods were set aside thirty seconds into the trial with the heights, the
  // blocks to dig and the Overworld's stone never offered again; on the
  // next trial the fortress's ways were asked again a second after theirs
  // had escalated (mid-242-ae-nether-2 and -3-fortress-1, note 583).
  const owedLeg = require('./tried').owed(goal, 'fortress_leg');
  if (owedLeg) {
    const why = owedLeg.at(-1).slice(0, 200), at = Date.now();
    if (state.spawnerWait) { state.spawnerWaitEnded = why; state.spawnerWaitEndedAt = at; delete state.spawnerWait; }
    if (state.goTo) { const g = state.goTo; (state.goToEnded ||= {})[g.key ? `${g.kind}:${g.key}` : g.kind] = { why, at }; delete state.goTo; }
    if (state.target) { delete state.target; delete state.rememberedTarget; }
    delete state.patrolUntil; delete state.restock; save();
  }
  // A wait by a spawner Jev chose (wait_at_spawner): near its cage until
  // the wait is up; the hunt takes a blaze the moment one is in view.
  // A wait by a spawner found since not to be a blaze spawner (a bastion's
  // magma cube spawner, note 750d) ends here, said, and is no fortress.
  if (state.spawnerWait && typeof bot.blockAt === 'function' && bot.blockAt(new Vec3(state.spawnerWait.x, state.spawnerWait.y, state.spawnerWait.z))?.name === 'spawner') {
    const kind = require('./fortress-map').spawnerKind(bot, new Vec3(state.spawnerWait.x, state.spawnerWait.y, state.spawnerWait.z));
    if (!kind.blaze) { state.spawnerWaitEnded = `not a blaze spawner: ${kind.why}`; state.spawnerWaitEndedAt = Date.now(); delete state.spawnerWait; save(); }
  }
  if (state.spawnerWait) {
    const w = state.spawnerWait, cage = new Vec3(w.x, w.y, w.z);
    const off = cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position);
    // How it ended, with what came: a stand at an empty spawner (empty-
    // spawner.js) is asked again with it (note 681).
    const came = w.came?.length ? `${w.came.length} blaze${w.came.length === 1 ? '' : 's'} came` : 'no blaze came';
    // A walk to it Jev chose (go_to_spawner, note 686): how it ended is
    // said with the next offer of it.
    const walked = why => { if (w.go) (state.goToEnded ||= {})[`spawner:${w.x},${w.y},${w.z}`] = { why, at: Date.now() }; };
    if (!(w.until > Date.now())) {
      state.spawnerWaitEnded = w.go ? `the walk's ${Math.round(SPAWNER_GO_MS / 60000)} minutes ran out ${Math.round(off)} blocks from it` : w.startedAt ? `waited ${Math.round((Date.now() - w.startedAt) / 1000)} seconds, ${came}` : 'waited its minutes';
      // The wait ending is not a leave (note 721 rule 4: a way failing is
      // said on the next asking, never a leave): the fortress kept as
      // state.approach.found stays the step's found, so narration does not
      // read this as "leaving the fortress" off a stale, unrelated shunned
      // entry (note 732, 25591 at 07:31:57Z: pillar_up was Jev's choice
      // here, not a leave, and yet "Leaving the fortress" was said).
      walked(state.spawnerWaitEnded); state.spawnerWaitEndedAt = Date.now(); delete state.spawnerWait;
      goal.step = { action: 'find_fortress', ...(state.approach?.found ? { found: state.approach.found } : {}), legs: state.legs || 0 }; save();
      // Ended here, not fallen through into the bricks search below: with the
      // wait just deleted, the next tick re-asks fresh from the top of this
      // function, where the cage/fortress-extent gate above runs again with
      // the current state. Falling through in the same tick was how the leg
      // question and its "I'm looking for a fortress" chat fired a second
      // after a stand_by_spawner answer, still at the cage (note 717).
      return;
    }
    else if (w.go && off <= GO_TO_NEAR) {
      // There: the walk ends, and with no blaze near the stand is asked
      // next pass (empty-spawner.js); a blaze near is the hunt's.
      state.spawnerWaitEnded = `reached it, ${Math.round(off)} blocks from the cage`; walked('reached it');
      state.spawnerWaitEndedAt = Date.now(); delete state.spawnerWait;
      goal.step = { action: 'at_spawner', target: { x: w.x, y: w.y, z: w.z }, off: Math.round(off), legs: state.legs || 0 }; save();
    }
    else {
      // The spawner is the step's target: the rung's measure and the stall
      // watch read it (stillness.js actionOf), not the search's (note 681).
      goal.step = { action: w.go ? 'go_to_spawner' : 'wait_at_spawner', spawner: { x: w.x, y: w.y, z: w.z }, target: { x: w.x, y: w.y, z: w.z }, off: Math.round(off), secondsLeft: Math.round((w.until - Date.now()) / 1000), legs: state.legs || 0 }; save();
      // The stand's own cell (a ceiling over it or rock at its back), walked
      // to once; otherwise within eight of the cage is the wait.
      const cell = w.cell && new Vec3(w.cell.x, w.cell.y, w.cell.z);
      if (cell && !w.cellTried && bot.entity.position.floored().distanceTo(cell) >= 1 && actions.navigate) {
        w.cellTried = true; save();
        try { await actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 20000, stallMs: 4000, onFoot: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; }
        return;
      }
      // A stand chosen at the cage with no cell of its own is taken within
      // four of it, as its option says, where the bot's own spot sees next to
      // none of the cells its blazes come in (fewer than 1 in 100 of its tries): 25591 (mid-242-nb) chose the stand
      // six blocks off inside a box whose window faced rock and stood there,
      // every blaze out of sight (note 708). Walked once; then it waits.
      if (off <= 8 && w.chosen === 'empty_spawner' && !w.cell && !w.nearTried && actions.navigate && off > 4.5) {
        let line = null; try { line = require('./blaze-tactics').standLine(bot, bot.entity.position.floored(), cage); } catch (_) { line = null; }
        if (line && line.per100 < 1) {
          w.nearTried = true; save();
          try { await actions.navigate(bot, task, new goals.GoalNear(w.x, w.y, w.z, 4), { timeoutMs: 15000, stallMs: 4000, onFoot: true }); }
          catch (err) { task.check(); if (!retryable(err)) throw err; }
          return;
        }
      }
      if (off <= 8) { await sleep(1000); task.check(); return; }
      let why = null;
      if (actions.navigate) {
        try { await actions.navigate(bot, task, new goals.GoalNear(w.x, w.y, w.z, 4), { timeoutMs: 30000, stallMs: 6000, passing: true, onFoot: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
      } else why = 'no way to walk there';
      // No way on foot: the way there is Jev's once for the wait, as for
      // any place chosen (a span, a pillar, the staircase through the rock).
      const far = () => cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) > 8;
      // A walk that came nearer goes on next pass: a long walk is more than
      // one navigation's half minute, and was ended as "no way to it"
      // after the first (note 686).
      if (!why && far() && cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) < off - 4) return;
      if (far() && !w.asked) {
        w.asked = true; save();
        const ended = await approachFortress(bot, task, goal, save, actions, state, cage, [], { stretch: { why: why || 'the walk came no nearer', what: 'the spawner seen' } });
        if (ended) why = ended;
        if (!far()) return;
      }
      if (far()) {
        state.spawnerWaitEnded = `no way to it: ${why || 'came no nearer'}`; walked(state.spawnerWaitEnded); state.spawnerWaitEndedAt = Date.now(); delete state.spawnerWait;
        // Same as above (note 721 rule 4, note 732): a failed walk to the
        // spawner is not a leave, so the fortress found earlier stays found.
        goal.step = { action: 'find_fortress', ...(state.approach?.found ? { found: state.approach.found } : {}), legs: state.legs || 0 }; save();
      }
      return;
    }
  }
  if (state.goTo) { await goToStep(bot, task, goal, save, actions, state); return; }
  const ids = FORTRESS_BLOCKS.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  // Bricks near a face that would not be approached are ignored for ten
  // minutes: the fortress was straight below a shelf with a cave between,
  // and every tick tried the same drop. The sweep meets it elsewhere.
  state.shunned = (state.shunned || []).filter(sh => sh.until > Date.now());
  // Leaving a section after its patrols: that section is behind the bot for
  // the length of the leg. From ninety blocks out the same bricks were still
  // in view, the leg was undone at once, and the dream run walked out and
  // back between the fortress and a leg ninety blocks off every three
  // minutes.
  if (state.leaving && !(state.leaving.until > Date.now())) delete state.leaving;
  const left = b => !!state.leaving && Math.hypot(state.leaving.x - b.x, state.leaving.z - b.z) <= LEAVE_RADIUS;
  const standing = bot.entity.position;
  const shunnedThere = b => state.shunned.some(sh => Math.hypot(sh.x - b.x, sh.z - b.z) <= (sh.radius || 16)) || left(b);
  // Bricks in view, as seen from where a set-aside was chosen: all of them.
  const shunned = b => shunnedThere(b) || state.shunned.some(sh => leftFromHere(sh, standing));
  // A fortress is hundreds of bricks. A handful is the bot's own: it
  // carries nether bricks and builds its pockets and bridges with them, and
  // the sweep "patrolled" three of its own blocks while starting a new leg
  // every tick, four hundred of them, never old enough to turn.
  // The nearest bricks, and where they fill the first look, a wider one:
  // the look keeps the nearest it counts, and a fortress's walls beside
  // the bot are five hundred bricks within ten blocks. mid-235-p-fortress-7
  // stood on its floor at (252, 58, 212), saw 512 bricks none past ten
  // blocks, and set the fortress aside as "nothing twelve blocks off to
  // walk to" with its floors at (257, 58, 216) and (273, 57, 213); back_to
  // _fortress was chosen and undone in the same breath six times (note 528).
  // Not the bot's own: a brick it laid is not the fortress (own-blocks.js).
  // mid-242-bb was asked the way to "the fortress, 7 blocks off and 2 up"
  // over and over about two bricks it had stacked (note 613).
  const own = require('./own-blocks').ownSet(bot, state);
  const look = count => bot.findBlocks({ matching: ids, maxDistance: 128, count: count + own.size }).filter(b => !own.has(`${b.x},${b.y},${b.z}`)).slice(0, count);
  let seen = look(FORTRESS_LOOK);
  if (seen.length >= FORTRESS_LOOK) seen = look(FORTRESS_VIEW);
  const cutShort = seen.length >= FORTRESS_VIEW;
  const found = seen.filter(b => !shunned(b));
  let bricks = found.length >= FORTRESS_MIN_BRICKS ? found : [];
  // Arrival is arrival (note 739b): once known to be inside a found
  // fortress (state.inFortressSince), a look that happens to catch too few
  // of its bricks in view -- turned toward a wall, down a bare corridor --
  // is not "no fortress in view". Without this the whole Inside branch
  // below is skipped for that one look and falls through to the blind
  // sweep's own fortress_leg tree, which offers go_to_blazes toward
  // wherever blazes were last seen rather than the fortress's own spawner
  // and unwalked branches (25583, mid-242-vh, 08:57-09:02Z: fortress_leg
  // sent it back to "blazes seen at (-139,74,96)", where it had stood
  // three minutes before). The cached bricks are dropped after five
  // seconds, or at once wherever the fortress is actually left (every spot
  // that clears state.inFortressSince clears these with it).
  if (bricks.length) { state.lastBricks = bricks; state.lastBricksAt = Date.now(); }
  else if (state.inFortressSince && state.lastBricks && Date.now() - (state.lastBricksAt || 0) < 5000) bricks = state.lastBricks;
  // Bricks enough for a fortress, all left behind or set aside: said to
  // Jev with the next leg, going back among the ways (fortressInView),
  // said as they stand now, before a leg's end lets them be seen again.
  let setAside = !bricks.length && seen.length >= FORTRESS_MIN_BRICKS ? fortressInView(bot, goal, save, state, seen, { stay: false }) : null;
  // Off its floors with the leg's question owed: its ways in are what came
  // to nothing, so going back to it is among the legs, said so.
  const offFloors = !!owedLeg && bricks.length > 0 && !onFortressFloor(bot.entity.position, fortressFloors(bot, bricks), bot, goal);
  // Still the target, not set aside (fortress-hold.js, note 721): the leg
  // question says what leaving it leaves, and a leg taken from here is the
  // leaving, set aside as keep_searching sets it. 25584 took leg_north,
  // leg_east and leg_west from a brick 1 block off at 04:34:05 to 04:34:37Z
  // with nothing recorded, and each next pass found the same bricks and asked
  // the visit again.
  let leftOnLeg = null;
  if (offFloors) {
    setAside = fortressInView(bot, goal, save, state, bricks, { stay: false, aside: `its ways in from here came to nothing: ${owedLeg.at(-1).slice(0, 200)}` });
    const near = bricks.slice().sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    const anchor = fortressAnchor(state, bricks, near), floors = fortressFloors(bot, bricks);
    const target = (floors.length ? floors : bricks).slice().sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    setAside.facts.leaving = `${require('./fortress-hold').reachSays(bot, goal, { target, anchor })} Every leg, widen_search and seek_fortress_height leaves it.`;
    leftOnLeg = { anchor, target, radius: Math.max(anchor.extent || 0, fortressExtent(bricks, anchor)) };
  }
  if (bricks.length && !offFloors) {
    const here = bot.entity.position;
    const byNear = list => list.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    // In the fortress is on its floors (onFortressFloor), not within six
    // blocks of any brick: mid-235-p-fortress-6 stood on its own span a
    // block from the fortress's footing, its corridors eight blocks up,
    // was "inside", and set out for bricks it had no way to (note 523).
    const floors = fortressFloors(bot, bricks);
    const nearest = byNear(bricks)[0];
    const anchor = fortressAnchor(state, bricks, nearest);
    state.found = { x: nearest.x, y: nearest.y, z: nearest.z };
    // The way in is asked about one place, kept while the bot is about
    // where it was first asked and the place is still one of the floors:
    // the nearest, picked afresh at each pass, moved fifteen to forty
    // blocks as mid-242-bb walked a few steps, so each asking was about a
    // new place, every way on offer again, none resting (note 613).
    // No floor seen yet: the nearest raw brick can be one buried in the
    // fortress's own wall or roof with rock or more bricks on every side,
    // nothing beside it to walk to (note 725: exposedBricks). Preferred
    // over it, a brick with open air on some side.
    const candidates = floors.length ? floors : exposedBricks(bot, bricks), a = state.approach;
    const kept = a?.found && a.from && Math.hypot(a.from.x - here.x, a.from.y - here.y, a.from.z - here.z) <= APPROACH_FROM
      ? candidates.find(f => f.x === a.found.x && f.y === a.found.y && f.z === a.found.z) : null;
    if (!onFortressFloor(here, floors, bot, goal)) {
      const target = kept || byNear(candidates)[0];
      // Whether the visit happens now is asked before the way in (note 638):
      // the bot's health and hunger are what a fight's outcome turns on.
      const hold = require('./fortress-hold');
      const visit = await require('./fortress-visit').ask(bot, task, goal, save, actions, { fortress: { distance: Math.round(flatTo(target, here)), height: Math.round(target.y + 1 - here.y), at: { x: anchor.x, y: anchor.y, z: anchor.z } },
        // What leaving leaves, said on it (note 721); the ways in are
        // surveyed next, by the approach.
        reach: (() => { let said = null; return () => (said ??= hold.reachSays(bot, goal, { target, anchor })); })(),
        // The whole fortress, by its one place and extent (note 706), the
        // one set-aside (fortress-hold.js).
        leave: () => hold.leave(bot, state, { anchor, target, radius: Math.max(anchor.extent || 0, fortressExtent(bricks, anchor)), left: ['the visit itself'], save, goal }) });
      if (visit !== 'go_in') return;
      await approachFortress(bot, task, goal, save, actions, state, target, bricks); return;
    }
    // Inside: the fortress as the bot has seen it (fortress-map.js), walked
    // a corridor at a time to the nearest floor that runs on into space not
    // yet seen, on foot, digging and laying nothing. mid-242-aa-fortress-1's
    // passes set out for bricks picked from all within 128 blocks, walls and
    // floors behind walls among them: two of five reached, the rest "No
    // path" and staircases dug through the walls, blazes never seen, and
    // after eleven minutes it left (note 557). What is walked is kept
    // across passes; when nothing is left to walk to, the choice is Jev's.
    const fm = require('./fortress-map');
    const map = fm.look(bot, state);
    state.inFortressSince ||= Date.now();
    const planned = fm.plan(bot, map);
    if (state.patrolUntil && !(state.patrolUntil > Date.now())) delete state.patrolUntil;
    // Nothing of it seen to walk to: not a stretch of fortress but a few
    // bricks (the bot's own pocket walls, often) or a corner seen through
    // rock. Patrolling it was a return that did nothing, then a fresh leg
    // the next look undid (note 528). A look cut short by its count is not
    // a few bricks: the rest of the fortress lies past what it kept.
    if (!cutShort && !planned.frontiers.length && !planned.groups.length && !planned.patrol.length && !map.spawners.length) {
      state.shunned.push({ x: nearest.x, z: nearest.z, until: Date.now() + 600000, at: Date.now(),
        why: 'none of its floors seen from where the bot stood runs on into unseen space, lies unwalked across a gap, or is twelve steps off to walk again: nothing to walk to',
        from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) } });
      delete state.found; state.patrols = 0; delete state.inFortressSince; delete state.lastBricks; delete state.lastBricksAt; save();
      setAside = fortressInView(bot, goal, save, state, seen, { stay: false });
    }
    else if (!owedLeg && (planned.frontiers.length || (state.patrolUntil && planned.patrol.length))) {
      const exploring = !!planned.frontiers.length, next = exploring ? planned.frontiers[0] : planned.patrol[0];
      const [x, y, z] = next.at;
      // Walking a found fortress's own corridors is not a new find of it
      // (note 739): firstAt carries so narration does not say "A fortress!
      // I'm heading for it." on every patrol pass of one already known.
      goal.step = { action: 'find_fortress', found: state.found, ...(state.fortressAt ? { fortress: { x: state.fortressAt.x, y: state.fortressAt.y, z: state.fortressAt.z, firstAt: state.fortressAt.firstAt } } : {}), [exploring ? 'exploring' : 'patrolling']: { x, y, z }, steps: next.steps, walked: planned.walked, seen: planned.seen, legs: state.legs }; save();
      let why = null;
      if (actions.navigate) {
        try { await actions.navigate(bot, task, new goals.GoalNear(x, y + 1, z, 1), { timeoutMs: 30000, stallMs: 6000, passing: true, onFoot: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
      } else why = 'no way to walk';
      const off = new Vec3(x + 0.5, y + 1, z + 0.5).distanceTo(bot.entity.position);
      // Not reached is not stood on: the walk's goal is within a block of
      // the floor, and a floor two blocks up with no way to it (the walk
      // failing at once, ending 2.0 off) had counted as reached at three,
      // walked thirty times in three seconds (mid-242-ae-nether-2-fortress-1,
      // note 583).
      if (off > 1.75) { map.failed[next.key] = { why: why || `the walk ended ${Math.round(off)} blocks short`, at: Date.now() }; save(); }
      fm.look(bot, state, { force: true });
      // A way on is walked when stood on (the look's visit marks it), not when
      // the walk ends near it: 25581 (mid-243-jd) stood a block under the
      // floor it was exploring to, at (-145, 57, 550), after a dig down, and
      // "reached" it every pass for four minutes (12:59:24-13:03:51Z), never
      // on it, never asked anything (note 750b). Not stood on, it is passed
      // over as any failed walk is, with where the bot ended.
      if (off <= 1.75 && exploring && map.cells[next.key] && !map.cells[next.key][0]) {
        const p = bot.entity.position, dy = Math.round(y + 1 - p.y);
        map.failed[next.key] = { why: `the walk ended beside it, not on it (${dy ? `${Math.abs(dy)} block${Math.abs(dy) === 1 ? '' : 's'} ${dy > 0 ? 'under' : 'over'} its floor` : 'at its height'})${why ? `: ${why}` : ''}`, at: Date.now() };
      }
      save();
      return;
    }
    else {
      // Nothing left to walk to from here: staying, crossing to what is
      // seen unwalked, a spawner seen, the blazes, or a leg away are Jev's
      // (fortress_leg), with what the map comes to.
      // Not while a fight is on (note 696): 25592 said "Walked what I can
      // reach" and took leg_west with blazes 1.9 to 4.7 blocks off round the
      // bricks, a second after leaving them for now. The fight's turn comes
      // first; with it still on at the wait's end, nothing is decided here
      // and the next pass looks again.
      const fight = await require('./danger').waitOutFight(bot, task);
      if (fight.still) { console.log(`[fortress] walked what it can reach, the leg not asked: a fight is on (${fight.still})`); return; }
      state.patrols = (state.patrols || 0) + 1;
      state.walkedAll = { at: Date.now(), walked: planned.walked };
      require('./rung-measure').watchKills(bot);
      state.walkedAllLog = [...(state.walkedAllLog || []).filter(e => Date.now() - e.at < WALKED_ALL_MS), { at: Date.now(), kills: bot._kills?.blaze || 0, rods: countOf(bot, 'blaze_rod') }].slice(-16);
      if (!(state.patrolSaidAt > Date.now() - 120000)) { state.patrolSaidAt = Date.now(); bot.chat?.('Walked what I can reach of this fortress. Deciding where next.'); }
      // Along the fortress's own length, as the outage default: fortress
      // corridors run straight along x or z.
      const spanX = Math.max(...bricks.map(b => b.x)) - Math.min(...bricks.map(b => b.x));
      const spanZ = Math.max(...bricks.map(b => b.z)) - Math.min(...bricks.map(b => b.z));
      const mean = k => bricks.reduce((n, b) => n + b[k], 0) / bricks.length;
      state.heading = spanX >= spanZ ? (mean('x') >= here.x ? 0 : 2) : (mean('z') >= here.z ? 1 : 3);
      save();
      if (await chooseLeg(bot, task, goal, save, actions, state, fortressInView(bot, goal, save, state, bricks, { stay: true, map, planned })) !== true) return;
      state.leaving = { x: Math.round(here.x), z: Math.round(here.z), until: Date.now() + LEAVE_MS };
      state.patrols = 0; delete state.inFortressSince; delete state.lastBricks; delete state.lastBricksAt; delete state.target; delete state.patrolUntil;
      beginLeg(state, here); save();
      return;
    }
  }
  const here = bot.entity.position;
  // A fortress seen before (exploration.js remembers them) is walked back
  // to rather than swept for again.
  // Not while the leg's question is owed a failure: the owed hook above
  // drops the target and its mark, and taken again here at once, the walk
  // to the fortress remembered ran unasked. On 25590 the fortress at (-70,
  // 32, 140) was walked to pass after pass with fortress_leg owed, both
  // failures went to it, the second passed it over, and the rods were set
  // aside 3.2 minutes into the trial with eleven of its twelve ways never
  // tried (note 605). The fortress remembered is said on the legs that lie
  // its way (sightingsThatWay).
  // Nor where the walk back to it found no way from about here (note 775):
  // taken again unasked, it fails the same way; the legs' question says it.
  const remembered = !owedLeg && require('./exploration').knownLandmarks(bot, goal, 'nether_fortress').find(k => k.distance > 24 && !shunnedThere(k.landmark) && !backFailedHere(state, here, k.landmark));
  if (remembered && !state.rememberedTarget) {
    state.target = { x: remembered.landmark.x, y: remembered.landmark.y, z: remembered.landmark.z }; state.rememberedTarget = true; state.legSince = Date.now();
  }
  // Blocks Jev chose to dig before the next leg, until they are carried,
  // wherever the digging takes it from the leg's end (restockStep).
  if (state.restock && await restockStep(bot, task, goal, save, actions, state)) return;
  if (!state.target || Math.hypot(state.target.x - here.x, state.target.z - here.z) < 8) {
    // A leg walked to its end: whatever was left behind may be seen again,
    // and that heading's failure is history.
    if (state.target && !state.rememberedTarget) delete state.leaving;
    if (state.target && Number.isInteger(state.lastHeading) && state.legHistory) { for (const mode of ['level', 'descend', 'floor', 'round']) delete state.legHistory[legKey(state.lastHeading, mode)]; }
    delete state.rememberedTarget;
    // A leg begun again where the last one began got nowhere, however the
    // step was cut short: mid-83-f began five legs south from one spot in
    // the Nether, each ended by the progress watch before the leg counted
    // its failures, and the audit called the loop (2026-09-26). Turned.
    if (state.legFrom && Math.hypot(state.legFrom.x - here.x, state.legFrom.z - here.z) < 8) turnSweep(state);
    // The leg's heading and height are Jev's, with each heading surveyed
    // (chooseLeg); the compass's own heading is the outage default.
    state.since ||= Date.now();
    if (await chooseLeg(bot, task, goal, save, actions, state, setAside) !== true) return;
    if (leftOnLeg) require('./fortress-hold').leave(bot, state, { ...leftOnLeg, left: ['its ways in from here, then a leg away'], save, goal });
    beginLeg(state, here);
  }
  goal.step = { action: 'find_fortress', target: state.target, legs: state.legs }; save();
  // A leg round what stopped a heading (round_<heading>) steps to the side
  // first: on foot, else straight across as the crossing goes; then the
  // leg's own line from there. Whether or not the step gets there, it is
  // not tried again: the leg's walk then goes as any leg does.
  if (state.sidestep) {
    const s0 = state.sidestep, to = new Vec3(s0.x, s0.y, s0.z);
    delete state.sidestep; save();
    if (Math.hypot(to.x - here.x, to.z - here.z) > 2) {
      let reached = false;
      if (actions.navigate) {
        try { await actions.navigate(bot, task, new goals.GoalNear(to.x, to.y, to.z, 1), { timeoutMs: 20000, stallMs: 6000, passing: true }); reached = bot.entity.position.distanceTo(to) <= 3; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      if (!reached) { try { await crossToward(bot, task, goal, save, to, { what: 'the step round what stopped the leg' }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; } }
      return;
    }
  }
  const leg = new Vec3(state.target.x, state.target.y, state.target.z);
  const flat = p => Math.hypot(leg.x - p.x, leg.z - p.z);
  const before = flat(here);
  // Ground made on the leg is a new nearest approach to its end. A walk
  // that went some way in and came back, or along a ledge, made none: mid-
  // 215-d stood at y 95 with its leg's target a hundred blocks off and out
  // of reach on foot (note 251, 2026-09-26).
  const approach = { best: state.legBest };
  const gained = () => { const made = nearer(approach, flat(bot.entity.position), before); state.legBest = approach.best; return made; };
  // Seeking the fortress heights (chooseLeg): the staircase alone, down or
  // up toward the leg's end, until the bot is within the band; a crossing at
  // the standing height would keep it where nothing is seen.
  const seeking = state.legMode === 'descend' && Math.abs(here.y - FORTRESS_Y) > FORTRESS_BAND;
  // Down to the floor first, by the way found when it was chosen; the leg
  // then goes on along the floor at its height. A way down that does not
  // get there ends the leg, and that heading's floor rests from here.
  if (state.legMode === 'floor' && state.descent) {
    const d = state.descent;
    goal.step = { action: 'find_fortress', target: state.target, down: { x: d.x, y: d.y, z: d.z }, legs: state.legs }; save();
    const done = actions.navigate ? await goDown(bot, task, d, actions.navigate) : { reached: false, why: 'no way to walk' };
    delete state.descent; save();
    if (done.reached) { state.legFails = 0; return; }
    state.lastLegError = `the way down to the floor at y ${d.floorY}: ${done.why}`;
    legEnded(state, state.lastLegError, 'floor');
    restLeg(state, state.lastLegError, here, 0);
    delete state.target; save();
    return;
  }
  if (seeking) {
    try { await actions.tunnel(bot, task, goal, save, leg, 'fortress'); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastLegError = err.message; }
    if (gained() || Math.abs(bot.entity.position.y - FORTRESS_Y) < Math.abs(here.y - FORTRESS_Y) - 0.5) { state.legFails = 0; return; }
  }
  // The pathfinder first: it walks open ground, bridges and climbs where a
  // staircase can only dig. The tunnel takes over where it finds no way.
  if (actions.navigate && !seeking) {
    try { await actions.navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 6), { timeoutMs: 30000, stallMs: 8000, passing: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (gained()) { state.legFails = 0; return; }
  }
  // No ground on foot in the Nether: straight on at this height, through
  // the netherrack or over the air and lava on blocks laid ahead, as far as
  // the cells ahead show it can go (nether-travel.js).
  const crossed = seeking ? { tried: false } : await crossToward(bot, task, goal, save, leg, { what: 'the fortress search\'s leg' });
  if (crossed.tried && gained()) { state.legFails = 0; return; }
  if (crossed.survey?.stoppedBy) state.lastCrossStop = crossed.survey.stoppedBy;
  if (!seeking) {
    try { await actions.tunnel(bot, task, goal, save, leg, 'fortress'); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastLegError = err.message; }
    if (gained()) { state.legFails = 0; return; }
  }
  // Four failures and twenty seconds: a leg whose every attempt fails at
  // once turned the compass four times in half a minute.
  // Counted from nothing on a fresh search: incremented from undefined it
  // was NaN, never four, and a leg that never once made ground never turned.
  state.legFails = (state.legFails || 0) + 1;
  legEnded(state, state.lastLegError || state.lastCrossStop, seeking ? 'descend' : state.legMode, { at: bot.entity.position, carried: blocksCarried(bot) });
  // Every way on failed within a few blocks of where the leg began: the leg
  // ends here and its heading rests from this spot (legResting), its
  // failure said with the next ask, not tried again tick after tick.
  // mid-242-ac-nether-1's legs each made a block or two to the lava's edge
  // and came back to it at the next ask (note 557).
  const along = state.legFrom ? Math.hypot(state.legFrom.x - here.x, state.legFrom.z - here.z) : Infinity;
  // The walk back to a fortress known (back_to_fortress) that found no way
  // is that answer's failure, not a heading's: said as that, kept for the
  // next asking of the legs, and the ledger's entry for it marked. 25585
  // (mid-227-ab, 02:47:58 and 02:51:59Z on 2026-10-01) chose it twice; each
  // ended "No way on east from here. Choosing another." of a walk west, and
  // the legs away were asked as if it had not been chosen (note 775).
  if (state.rememberedTarget && state.target && along < LEG_REST_WITHIN) {
    const f = bot.entity.position.floored(), why = String(state.lastLegError || state.lastCrossStop || 'no way on').split(/;\s/)[0].slice(0, 160);
    state.backFailed = { at: Date.now(), from: { x: f.x, y: f.y, z: f.z }, target: { ...state.target }, why, carried: blocksCarried(bot) };
    try {
      const tried = require('./tried'), e = tried.latestOf(goal, 'fortress_leg');
      if (e && String(e.method).split('/').at(-1) === 'back_to_fortress') tried.markBlocked(e, `the walk back to the fortress found no way: ${why}`);
    } catch (_) { /* no ledger */ }
    delete state.target; delete state.rememberedTarget; state.legFails = 0; save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.(`No way back to the fortress at ${Math.round(state.backFailed.target.x)}, ${Math.round(state.backFailed.target.z)} from here${why.length <= 60 ? `: ${why}` : ''}. Choosing how.`); }
    return;
  }
  if (along < LEG_REST_WITHIN) {
    restLeg(state, state.lastLegError || state.lastCrossStop, here, Math.round(along));
    delete state.target; state.legFails = 0; save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.(noWaySays(state, 'Choosing another.')); }
    return;
  }
  // Short of blocks, the ways to more are Jev's beside the legs (chooseLeg:
  // restock_blocks, return_for_blocks), asked when the sweep turns.
  if (state.legFails >= 4 && Date.now() - (state.legSince || 0) >= 20000) {
    turnSweep(state); save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.(noWaySays(state, 'Choosing another way.')); }
  }
}
// The turn said with its reason: "No way on in this direction" was said on
// 25598 at 21:10:16Z when the leg had run out of blocks over the lava sea,
// with no wall in the way (note 688). The reason is the leg's record's
// (legEnded), its first clause.
function noWaySays(state, then) {
  const name = Number.isInteger(state.lastHeading) ? HEADING_NAMES[state.lastHeading] : null;
  const why = String(state.lastLegError || state.lastCrossStop || '').split(/[;:.](?:\s|$)/)[0].trim();
  return `No way on${name ? ` ${name}` : ' this way'} from here${why && why.length <= 60 ? `: ${why}` : ''}. ${then}`;
}

// What huntObserved would take the turn for (src/arbiter.js): a hunt on,
// footing to fight from, and one of its kind in reach and alone. The route
// to it (combatRoute) is a search and is not asked, so a mob the hunt then
// finds no way to is claimed here and passed over there. Nor is the claim
// on its kind staked: that is huntObserved's, as it runs.
function claim(bot, goal = {}) {
  const state = goal.mobHunt;
  if (!state || !bot?.entity?.position || countOf(bot, state.item) >= huntTarget(bot, goal)) return null;
  const handler = handlers[state.entity] || {};
  if (!canBegin(bot, handler)) return null;
  const near = Object.values(bot.entities || {}).filter(e => e.name === state.entity && valid(bot, e) && e.position.distanceTo(bot.entity.position) < 24)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 4);
  const target = near.find(e => isolated(bot, e, handler) && !isSetAside(goal, 'hunt_target', e.uuid || e.id));
  if (!target) return null;
  // A blaze hunt with none in sight asks the visit first (huntObserved), and
  // a visit answer held from before that is not to go in does nothing: the
  // hunt given the turn then would do nothing, so it claims none. 25591
  // (mid-242-nb) chose turn_priority's hunt about 30 times in 7 minutes,
  // boxed in beside a cage, get_food_here held, and none led anywhere (note 708).
  const seen = (() => { try { return threats(bot, 48).some(t => t.entity.name === state.entity && t.visible); } catch (_) { return true; } })();
  if (state.entity === 'blaze' && !seen && require('./fortress-visit').holdsOff(bot, goal)) return null;
  // Walled in with the one hunted out of sight: the fight begins only through
  // the walls, said with the claim.
  let walled = null;
  if (!seen) { try { walled = require('./walled-in').walledInSays(bot); } catch (_) { walled = null; } }
  // A live spawner still owed rods, known here: hunt_target offers a box or
  // slit at it beside the open fight, said so turn_priority's own "hunt"
  // option does not read as the open ground being the only way (note 731).
  let cage = false;
  if (target.name === 'blaze') { try { cage = !!require('./cage-hold').cageFight(bot, goal); } catch (_) { cage = false; } }
  return { layer: 'hunt', action: 'hunt', urgency: 'routine', facts: { entity: target.name, distance: Math.round(target.position.distanceTo(bot.entity.position) * 10) / 10,
    item: state.item, have: countOf(bot, state.item), want: huntTarget(bot, goal), health: bot.health, ...(seen ? {} : { outOfSight: true }),
    ...(walled ? { walledIn: `${walled.own} of the ${walled.of} blocks round it its own` } : {}), ...(cage ? { cage: true } : {}) } };
}

module.exports = { blazeSpots, spawnersKnown, wayLeft, BLAZES_AT, knownFortressOutOfView, backFailedHere, triedSays, backToGround, tripHomeClosed, fortressAnchor, seedFortressAt, sameFortress, linkedTo, climbWays, climbOffers, fortressOverhead, CLIMB_REACH, noWaySays, onFortressFloors, onFortressFloor, bestMakeable, makePickaxe, crossingFor, crossingOptions, unwalkedParts, claim, stakeHunt, prepareCombatGear, combatMovement, canBegin, fitness, fitnessSays, isolated, fightForDrop, huntObserved, prepareMobHunt, findFortressStep, fortressLegTarget, turnSweep, chooseLeg, FORTRESS_Y, HEADING_NAMES, rememberSighting, rememberedSpot, approaches, combatRoute, FORTRESS_LEG, fortressFloors, approachFortress, fortressApproaches, bridgeFirstOrder, pickaxeFirst, fortressInView, portalBack, portalTripStart, returnForKitSays, exposedBrick, exposedBricks, blazesAbout, blazesAboutSays, routeSurvey };
