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
const { setAside, isSetAside, watch, unwatch } = require('./progress');
const { bridgeTo, surveyCrossing, underFire, blocksCarried, stepOntoFooting, spanBlockSources, gatherSpanBlocks } = require('./bridging');
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
      const fallback = tree.make_kit_here ? 'make_kit_here' : tree.return_for_kit ? 'return_for_kit' : 'fight_with_carried';
      const decision = await decide('combat_kit', { client, bot, task, goal, save, tree, context: { fallback },
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
  if (f.burning) parts.push(`alight now: fire takes half a heart a second${dimension(bot) === 'nether' ? ', and in the Nether there is no water to put it out; only waiting burns it off' : ''}`);
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
  const handler = handlers[state.entity] || {};
  stakeHunt(bot, goal);
  if (!canBegin(bot, handler)) return false;
  const candidates = Object.values(bot.entities).filter(e => e.name === state.entity && valid(bot, e) &&
    e.position.distanceTo(bot.entity.position) < 24 && isolated(bot, e, handler) &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  // A blaze hunt about to go at blazes none of which sees the bot yet is a
  // visit beginning (note 638); with one in sight the fight is on, and the
  // stances are asked.
  if (state.entity === 'blaze' && candidates.length && !(() => { try { return threats(bot, 48).some(t => t.entity.name === 'blaze' && t.visible); } catch (_) { return true; } })()) {
    const visit = await require('./fortress-visit').ask(bot, task, goal, save, { ...actions, client: actions.client || client }, {});
    if (visit === null) return false;
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
  for (const target of candidates.slice(0, 4)) {
    const restore = encounter(bot, task, target, Date.now() + 1500), movement = combatMovement(bot);
    try {
      if (!canStrike(bot, target) && !await combatRoute(bot, task, target, movement, 400, { pushed })) continue;
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
      tree[`hunt_${target.id}`] = { description: huntSays(bot, target, { handler, distance, mob, one, all, others, spawnerSays, newcomers, lavaNear, dropNear, footing: target.name === 'blaze' ? footing : '', hitters, UNPROVOKED, item: state.item }) + towardRods(rodsNeed, gain, { spawner: liveCage, of: rodsOf }),
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
    const stands = require('./blaze-stand').blazeStands(bot, threats(bot, 24), { hunted: true, dig: typeof bot.dig === 'function', holds: state.standResults || [], need: rodsNeed, of: rodsOf });
    for (const [key, o] of Object.entries(stands)) tree[key] = { description: o.description + footing, run: async () => {
      try { await require('./blaze-stand').huntFromStand(bot, task, goal, save, actions, o, { item: state.item, want: countOf(bot, state.item) + 1 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'hunt_stand', 'blaze', err.message, 120000); state.lastStandError = err.message; save(); }
    } };
  }
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
  const deferGain = rodsNeed ? `${towardRods(rodsNeed, 'none', { spawner: liveCage, of: rodsOf })} Left, these are not offered again for two minutes.` : '';
  tree.defer = { description: `Leave these targets alone for now if the observed situation is unsuitable; keep the resource goal saved.${stillShoot}${deferSays}${deferGain} ${fitSaid}${fit.fit ? '' : ' Left alone, the hunt recovers first: food if any is carried, cover from the shooters, and health while hunger is eighteen or more.'}`, run: async () => {
    for (const target of candidates) setAside(goal, 'hunt_target', target.uuid || target.id, 'Jev chose to leave it for now', 120000);
    if (blazesInSight.length) setAside(goal, 'hunt_stand', 'blaze', 'Jev chose to leave them for now', 120000);
    save();
  } };
  const snapshot = { request: goal.request, resource: state.item, need: huntTarget(bot, goal) - countOf(bot, state.item),
    ...(state.entity === 'blaze' && ladderRods(goal) ? { rodsTheGoalWants: require('./eye-need').says(bot, goal) } : {}),
    ...(state.entity === 'blaze' ? { blazes: blazesSays(bot, goal, state), playedRecord: require('./blaze-record').says(bot), playedAnswers: require('./blaze-record').answersSay(bot) } : {}),
    health: bot.health, food: bot.food, dimension: dimension(bot), riskNow: require('./risk').riskNow(bot),
    fitness: { ...fit, said: fitSaid },
    // A blaze whose every way to fight it in the open ends within a push of
    // lava or a deep drop: fought from a stand, not walked under.
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
    keep_on: { description: `Stay and go on without food for twenty minutes: hunger ${bot.food}, and health comes back only at eighteen or more, so no fight is started; the fortress search goes on meanwhile. ${fitnessSays(bot)}${exposed}` },
  };
  // Food as a resource of the stay (nether-food.js): the ways to more here,
  // each priced, asked next.
  let restock = null;
  try { restock = require('./nether-food').restockFoodOption(bot, task, goal, save, { actions: foodActions(bot, task, goal, save, actions), client: actions.client || task.opportunityClient }); } catch (_) { restock = null; }
  if (restock) tree.restock_food = { description: restock.description };
  const decision = await decide('leave_nether', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { for: 'food', ...rodsFact(bot, goal, {}), health: bot.health, food: bot.food, foodCarried: false, dimension: dimension(bot), ...(hits ? { whatAHitCosts: hits } : {}) } });
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
  if (bot.game.difficulty === 'peaceful') throw blocked(`${step.entity} does not spawn in Peaceful; cannot obtain ${step.item} by hunting here`);
  const previous = goal.mobHunt;
  goal.mobHunt = { ...(previous?.item === step.item ? previous : {}), item: step.item, entity: step.entity,
    targetCount: countOf(bot, step.item) + step.count };
  goal.stockFood = true; save();
  // While this runs, mobs of this kind are the hunt's business and not the
  // survival layer's emergency. Refreshed every tick; it lapses in seconds.
  bot._huntingEntity = { name: step.entity, until: Date.now() + 5000 };
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
      const pick = netherLeaveHeld(goal, 'food') ? 'go_back' : await foodLeave(bot, task, goal, save, actions);
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
    // A wall at hand, not a wall somewhere. Sent to find one nine blocks
    // off, the bot took forty-one damage crossing the room and arrived with
    // nothing; fighting where it stood cost twenty-six.
    const cornered = handler.ranged && (inView >= 2 || (swarm(bot) && bot.health < 16));
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
  const spot = rememberedSpot(state, bot);
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
// A walk over the fortress's corridors again Jev chose (stay_in_fortress).
const PATROL_MS = 3 * 60000;
const LEAVE_RADIUS = 48, LEAVE_MS = 4 * 60 * 1000;
const FORTRESS_BLOCKS = ['nether_bricks', 'nether_brick_fence', 'nether_brick_stairs', 'nether_brick_slab', 'nether_wart'];
const FORTRESS_LEG = 96;
// The next leg of the sweep: ninety-six blocks along x, one way, at a
// height between the lava sea and the ceiling.
// Legs run along x until a direction will not give; then the sweep turns.
const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const HEADING_NAMES = ['east', 'south', 'west', 'north'];
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
  return new Vec3(Math.round(position.x + FORTRESS_LEG * dx), y, Math.round(position.z + FORTRESS_LEG * dz));
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
const legKey = (i, mode) => mode === true || mode === 'descend' ? `seek_${HEADING_NAMES[i]}` : mode === 'floor' ? `floor_${HEADING_NAMES[i]}` : HEADING_NAMES[i];
function legEnded(state, why, seeking = false) {
  const i = Number.isInteger(state.lastHeading) ? state.lastHeading : headingIndex(state);
  const history = state.legHistory ||= {};
  const from = state.legFrom || null, was = history[legKey(i, seeking)];
  const same = was?.from && from && Math.hypot(was.from.x - from.x, was.from.z - from.z) < 8;
  history[legKey(i, seeking)] = { ended: why || 'no ground made', from, tries: same ? (was.tries || 1) + 1 : 1, at: Date.now() };
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
  const found = spanBlockSources(bot, { reach: RESTOCK_REACH, walk: RESTOCK_WALK, skip: p => isSetAside(goal, 'reach', p) });
  if (!need || !found.sources.length) return { found, need, want: 0, carried };
  const want = Math.min(need, RESTOCK_MOST, found.sources.length);
  const first = found.sources[0], taken = found.sources.slice(0, want);
  const digs = taken.map(t => digSeconds(bot, t.block, tool));
  const seconds = digs.some(d => d === null) ? null : Math.round(first.walk / WALK_SPEED + digs.reduce((n, d) => n + d, 0) + want / WALK_SPEED);
  return { found, need, want, first, seconds, carried };
}
function restockSays(bot, plan, last, pick = pickaxeFirst(bot)) {
  const { found, need, want, first, seconds, carried } = plan, here = bot.entity.position;
  const has = found.sources.length;
  const whereFrom = first.walk ? `a walk of ${first.walk} block${first.walk === 1 ? '' : 's'} from here` : 'where the bot stands';
  return `Dig ${want} block${want === 1 ? '' : 's'} to lay spans with here, one after another, from the ${has} that can be dug from ground walked to from here (${kindsSaid(found.reachable)}): ` +
    `the nearest ${Math.round(first.p.distanceTo(here))} blocks off, dug from ${whereFrom}${seconds === null ? '' : `, about ${seconds} seconds in all`}. ${pick.says}` +
    `The longest leg short of blocks needs ${need + carried} laid and ${carried} are carried: ${need} short${want < need ? `, and only ${want} can be had here` : ''}. ` +
    (Object.keys(found.unreachable).length ? `Within ${RESTOCK_REACH} blocks but not to be dug from ground walked to from here (across open drop, under a span's floor, or with nowhere for the drop to land): ${kindsSaid(found.unreachable)}. ` : '') +
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
  const items = bot.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = sum(/_log$|_stem$/), planks = sum(/_planks$/), sticks = sum(/^stick$/);
  const table = countOf(bot, 'crafting_table') > 0;
  // Four planks for a table unless one is carried, two for sticks (four of
  // them) unless two are carried, and three more for a wooden head.
  const wood = logs * 4 + planks, frame = (table ? 0 : 4) + (sticks >= 2 ? 0 : 2);
  const head = PICK_HEADS.map(([item, said, re]) => ({ item, said, n: sum(re) })).find(h => h.n >= 3 && wood >= frame) ||
    (wood >= frame + 3 ? { item: 'wooden_pickaxe', said: 'planks', n: 0 } : null);
  const woodSaid = [logs && `${logs} log${logs === 1 ? '' : 's'}`, planks && `${planks} planks`, sticks && `${sticks} stick${sticks === 1 ? '' : 's'}`, table && 'a crafting table'].filter(Boolean).join(', ');
  if (!head) return { carried: false, none: true, tool: null, says: 'No pickaxe is carried and none can be made from what is carried: netherrack dug by hand drops nothing. ' };
  const name = head.item.replace('_', ' '), a = /^iron/.test(head.item) ? 'an' : 'a';
  const from = head.n ? `3 of the ${head.n} ${head.said}${woodSaid ? `; ${woodSaid}` : ''}` : woodSaid;
  return { carried: false, item: head.item, tool: bot.registry?.itemsByName?.[head.item]?.id ?? null, name: `${a} ${name}`,
    from, says: `No pickaxe is carried, and netherrack dug by hand drops nothing: ${a} ${name} is made first from what is carried (${from}), a few seconds, and the rock is dug with it. ` };
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
    for (let i = 0; i < 8 && pickaxeTier(bot) < 1; i++) if (await actions.acquireStep(bot, task, pick.item, want, goal, save)) break;
  } catch (err) { task.check(); if (!retryable(err)) throw err; return `${pick.name} was not made: ${err.message}`; }
  return pickaxeTier(bot) >= 1 ? null : `${pick.name} was not made`;
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
    `Then, with them: ${crossingSays(withMined, 'the fortress')}${endSays}${shot} About ${minutes} minute${minutes === 1 ? '' : 's'} in all.`;
}
// Mined, then crossed: the blocks gathered as the restock gathers them
// (restockStep), then the crossing to its end. Returns why it ended short,
// null when it went on to its end.
async function mineThenCross(bot, task, goal, save, actions, state, cross) {
  const { target } = cross;
  if (blocksCarried(bot) < cross.want) {
    const here = bot.entity.position;
    state.restock = { want: cross.want, since: Date.now(), said: cross.plan.seconds, from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) } }; save();
    await restockStep(bot, task, goal, save, actions, state);
  }
  const survey = surveyCrossing(bot, target, { cells: FORTRESS_CROSS });
  if (!survey.cells || survey.gain < 1) return `no crossing to make after the mining (${blocksCarried(bot)} blocks carried${state.lastRestock?.why ? `; the mining ended: ${state.lastRestock.why}` : ''})${survey.stoppedBy ? `: ${survey.stoppedBy}` : ''}`;
  goal.step = { action: 'cross_toward', what: 'the fortress', target: { x: target.x, y: target.y, z: target.z }, cells: survey.cells, dig: survey.dig, bridge: survey.bridge, carried: survey.carried }; save();
  try { await bridgeTo(bot, task, target, { maxBlocks: survey.bridge, maxSteps: survey.cells }); }
  catch (err) { task.check(); if (!retryable(err)) throw err; return err.message; }
  return survey.stoppedBy;
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
  const [kind, name] = key.startsWith('seek_') ? ['seek', key.slice(5)] : key.startsWith('floor_') ? ['floor', key.slice(6)] : ['level', key];
  const mins = Math.max(1, Math.round((r.until - now) / 60000));
  return `${kind === 'seek' ? `the staircase toward the fortress heights heading ${name}` : kind === 'floor' ? `the floor below, heading ${name}` : `leg ${name}`}: ended ${Math.round((now - r.at) / 60000)} minutes ago ${r.made ? `${r.made} block${r.made === 1 ? '' : 's'} from where it began` : 'where it began'}, no way on (${r.why}); not offered from here for ${mins} more minute${mins === 1 ? '' : 's'}`;
}
// The pickaxe carried, as the ways that dig need it said: a staircase, a
// tunnel and a crossing through rock dig nothing without one. mid-242-ac-
// nether-1's staircase rested "no tool for nether bricks", said only
// inside a failure (note 557).
function pickaxeSays(bot) {
  const picks = (bot.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
  if (!picks.length) return 'none carried: rock and nether bricks cannot be dug, so a staircase, a tunnel or a crossing through rock digs nothing';
  const left = i => { const max = bot.registry?.itemsByName?.[i.name]?.maxDurability; return max ? max - (i.durabilityUsed || 0) : null; };
  return picks.map(i => `${i.name.replaceAll('_', ' ')}${left(i) === null ? '' : `, ${left(i)} uses left`}`).join('; ');
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
// cell of netherrack and nothing seen (note 394, 2026-09-27). Without Jev,
// the heading with the most open air the blocks carried reach, the code's
// own heading at a tie. With a leg short of blocks, the ways to more are
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
async function chooseLeg(bot, task, goal, save, actions, state, fortress = null) {
  const here = bot.entity.position, y = Math.round(here.y);
  const current = headingIndex(state);
  const surveys = HEADINGS.map(h => surveyLeg(bot, h, { cells: FORTRESS_LEG }));
  // What each heading would show that has not been seen, and what seen
  // before lies that way (nether-coverage.js): a leg into air already
  // looked across was offered on the same terms as one into space never
  // seen (note 572). A full look from here first.
  const dim = coverage.dimOf(bot);
  coverage.look(bot, state);
  const seenThatWay = HEADINGS.map(h => coverage.headingCoverage(state, dim, here, h, { length: FORTRESS_LEG, bot }));
  const thatWay = HEADINGS.map(h => sightingsThatWay(bot, goal, state, here, h));
  // Where fortresses can begin (nether-regions.js): each heading says where
  // it leaves the region the bot stands in and what is known past it. mid-
  // 243-ch walked thirteen legs round a bastion's region, where no fortress
  // begins, never told so (note 652).
  const landmarks = goal.landmarks || [];
  const headingSays = i => coverage.headingSays(seenThatWay[i], HEADING_NAMES[i]) + thatWay[i] + regions.headingRegionSays(here, HEADINGS[i], regions.known(landmarks), state, dim);
  const back = state.legFrom && Number.isInteger(state.lastHeading) ? (state.lastHeading + 2) % 4 : null;
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
  HEADINGS.forEach((h, i) => {
    const rest = legResting(state, HEADING_NAMES[i], here);
    if (rest) { resting.push(restSays(HEADING_NAMES[i], rest)); return; }
    if (surveys[i]?.stoppedAt === 0) { blocked.push(`leg ${HEADING_NAMES[i]}: closed at the first cell at y ${y}, ${surveys[i].stoppedBy}`); return; }
    options[`leg_${HEADING_NAMES[i]}`] = { description: legSays(surveys[i], { direction: HEADING_NAMES[i], length: FORTRESS_LEG, y }) +
      (i === back ? ' This is back the way the last leg came.' : '') + legHistorySays(state, HEADING_NAMES[i], here) +
      (levelRests[i] ? ` Where the walk and the span give out, ${levelRests[i]}.` : '') + headingSays(i),
      run: () => { state.heading = i; state.legMode = 'level'; return true; } };
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
    options[key] = { description: `Go down to the floor and walk it ${HEADING_NAMES[i]} ${FORTRESS_LEG} blocks, bridging only across the lava and open air on it. ${wayDownSays(down)} ${floorWalkSays(floor, { along: HEADING_NAMES[i] })}${fortressUp}` +
      (i === back ? ' This is back the way the last leg came.' : '') + legHistorySays(state, key, here) + headingSays(i),
      run: () => { state.heading = i; state.legMode = 'floor'; state.floorY = down.y;
        state.descent = { x: down.way.end.x, y: down.way.end.y, z: down.way.end.z, floorY: down.y, maxDrop: down.way.maxDrop, dug: down.way.dug, path: down.way.path.map(p => ({ x: p.x, y: p.y, z: p.z })) }; return true; } };
  });
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
    if (seekRest) resting.push(restSays(legKey(most, true), seekRest));
    else options.seek_fortress_height = { description: `Dig a staircase ${off > 0 ? 'down' : 'up'} toward y ${FORTRESS_Y} heading ${HEADING_NAMES[most]}, ${Math.abs(off)} blocks of height, a step at a time with rock round the bot and no block dug with lava or water behind it: fortress corridors and bridges stand mostly between y 48 and 75, over the lava sea at y 31, and from y ${y} ${fortress ? 'only what open air shows is seen, the fortress in view among it' : 'none is seen through the rock'}. The leg goes level again once within ${FORTRESS_BAND} of y ${FORTRESS_Y}.` +
      (seekRests[most] ? ` ${capital(seekRests[most])}: taken now, it digs nothing until then.` : '') + passed + legHistorySays(state, legKey(most, true), here, 'staircase'),
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
    const best = spots[0], s = best.spot, ended = state.goToEnded?.blazes;
    // Whether the bot has been near it on foot: the ground the search has
    // stood on is the one sign that there is a walk there.
    const stood = coverage.stoodNear(state, dim, s, 32);
    const way = HEADINGS.findIndex(h => coverage.liesThatWay(here, s, h));
    const reach = ` It lies ${way >= 0 ? `${HEADING_NAMES[way]} of here` : 'here'}; ${stood === null ? 'the bot has not stood within 32 blocks of it, so whether it can be walked to is not known' : `the bot has stood ${stood} blocks from it before`}.`;
    options.go_to_blazes = { description: `Go to where blazes were seen ${blazeSpotSays(best, here)}: blazes come from a spawner, which keeps its room full, and the hunt takes each one as it comes into view.${reach} The walk there is on foot first, digging and laying nothing; where it finds no way, the way there is asked (fortress_approach: a span, a pillar, a drop or a staircase, each with what it meets).${ended ? ` The last try at it ended: ${ended.why}.` : ''}`,
      target: { x: s.x, y: s.y, z: s.z }, run: () => { state.goTo = { x: s.x, y: s.y, z: s.z, kind: 'blazes', since: Date.now() }; save(); return 'goto'; } };
  }
  const short = surveys.some(s => Number.isInteger(s?.runsOut));
  if (short && actions.mineAt && actions.navigate) {
    const plan = restockPlan(bot, goal, surveys);
    if (plan.want) {
      options.restock_blocks = { description: restockSays(bot, plan, state.lastRestock),
        run: async () => { state.restock = { want: blocksCarried(bot) + plan.want, since: Date.now(), said: plan.seconds, from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) } }; save(); await restockStep(bot, task, goal, save, actions, state); return 'restock'; } };
    }
  }
  // With no pickaxe, making one is a way of its own: every leg through rock,
  // the staircase and the blocks for a span wait on it. 25581 was told what
  // a pickaxe takes and that it carried it (blockStock.makingAPickaxe), was
  // never offered making one, and answered none_good (note 654).
  const pick = pickaxeFirst(bot);
  if (!pick.carried && !pick.none && actions.acquireStep) {
    options.make_pickaxe = { description: `Make ${pick.name} here from what is carried (${pick.from}), a few seconds at a crafting table: with it rock is dug and the netherrack dug comes back as blocks to lay, so the legs through rock, the staircase toward the fortress heights and the blocks for a span open again. Without it rock and netherrack dug by hand drop nothing and ${blocksCarried(bot)} block${blocksCarried(bot) === 1 ? '' : 's'} can be laid. The leg is chosen again after.`,
      run: async () => {
        const unmade = await makePickaxe(bot, task, goal, save, actions, pick);
        if (unmade) throw new Error(`The pickaxe was not made: ${unmade}`);
        return 'pickaxe';
      } };
  }
  if (short && actions.returnOverworld) {
    const portal = (goal.portals || []).filter(p => p.dimension === 'nether').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
    options.return_for_blocks = { description: `Go back through the portal to the Overworld${portal ? `, the nearest known ${Math.round(Math.hypot(portal.x - here.x, portal.z - here.z))} blocks off at ${portal.x}, ${portal.y}, ${portal.z}` : ', none known in the Nether: the way is found from what is loaded'}, for stone to lay spans with; the Nether is entered again by the same portal, and the search goes on from there.`,
      run: async () => { await actions.returnOverworld(bot, task, goal, save); return 'returned'; } };
  }
  // Every way from here rests or is gone: nothing to ask. The step says so
  // and the stall's own question takes it from there.
  const left = waysLeftSays(state, here);
  if (!Object.keys(options).length) throw new Error(`No leg from here can be walked, dug or bridged: ${[...blocked, ...resting].join('; ')}${left ? `; and the ways Jev left: ${left.join('; ')}` : ''}`);
  try { require('./healing').withNoHealSays(bot, goal, options); } catch (_) { /* no body */ }
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, ...(o.target ? { target: o.target } : {}) }]));
  const blazesSeen = blazesSeenFacts(bot, goal);
  const facts = { ...(blazesSeen ? { blazesSeen } : {}), height: y, fortressHeights: 'corridors and bridges mostly between y 48 and 75, over the lava sea at y 31; bricks are seen within 128 blocks, and only through open air',
    legsSoFar: state.legs || 0, minutesSearching: state.since ? Math.round((Date.now() - state.since) / 60000) : 0,
    lastLeg: Number.isInteger(state.lastHeading) ? (() => { const seeking = state.legMode === 'descend', h = state.legHistory?.[legKey(state.lastHeading, state.legMode)];
      return `${seeking ? 'a staircase toward the fortress heights ' : state.legMode === 'floor' ? 'down to the floor and along it ' : ''}${HEADING_NAMES[state.lastHeading]}${h ? `, ended no nearer: ${h.ended}` : ''}`; })() : null,
    ...(resting.length ? { legsResting: resting } : {}), ...(blocked.length ? { legsClosed: blocked } : {}),
    seenSoFar: coverage.coverageSays(state, dim, here, FORTRESS_LEG),
    ...(left ? { waysLeft: left } : {}),
    structureRegions: regions.regionFacts(here, landmarks, state, dim), ...portalBackFact(goal, here),
    blocksCarried: blocksCarried(bot), pickaxe: pickaxeSays(bot), health: bot.health, food: bot.food, threatsInView: threatsInView(bot).map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    ...(fortress ? { fortressInView: fortress.facts } : {}), ...rodsFact(bot, goal) };
  // Without Jev: the most ground unseen beside the leg's open air, then the
  // open air each heading's carried blocks reach.
  const open = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, surveys[i] ? surveys[i].reach : null]));
  const unseen = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, seenThatWay[i].cells ? seenThatWay[i].unseenInView ?? seenThatWay[i].unseen : null]));
  const stood = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, seenThatWay[i].stood]));
  const decision = await decide('fortress_leg', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree, state: facts,
    context: { current: `leg_${HEADING_NAMES[current]}`, open, unseen, stood, passes: fortress?.passes || 0 } });
  if (decision.stale) return false;
  return options[decision.path.at(-1)].run();
}
// The portal the search can go home by, and how far the search has come
// from it: the nearest known in the Nether.
const compass = (dx, dz) => { const ns = dz < -0.38 * Math.hypot(dx, dz) ? 'north' : dz > 0.38 * Math.hypot(dx, dz) ? 'south' : '', ew = dx > 0.38 * Math.hypot(dx, dz) ? 'east' : dx < -0.38 * Math.hypot(dx, dz) ? 'west' : ''; return ns && ew ? `${ns}-${ew}` : ns || ew || 'here'; };
function portalBackFact(goal, here) {
  const portal = (goal.portals || []).filter(p => p.dimension === 'nether').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
  if (!portal) return {};
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
    result = await gatherSpanBlocks(bot, task, r.want, { navigate: actions.navigate, deadline, reach: RESTOCK_REACH, walk: RESTOCK_WALK,
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
  state.legFrom = { x: Math.round(here.x), z: Math.round(here.z) }; state.lastHeading = headingIndex(state); delete state.lastLegError;
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
// As far as a span toward a fortress was ever laid.
const APPROACH_CROSS = 64;
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
// within two blocks of lava, and how much nearer its end is.
async function routeSurvey(bot, task, target, brick) {
  if (!bot.pathfinder?.movements || !(bot.pathfinder.getPathFromTo || bot.pathfinder.getPathTo)) return null;
  try {
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, target, 500);
    const path = route?.path || [];
    const { lavaBeside } = require('./survival');
    const end = path.at(-1);
    return { status: route?.status || 'noPath', cells: path.length,
      place: path.reduce((n, p) => n + (p.toPlace?.length || 0), 0), dig: path.reduce((n, p) => n + (p.toBreak?.length || 0), 0),
      besideLava: typeof bot.blockAt === 'function' ? path.filter(p => lavaBeside(bot, new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))).length : 0,
      gain: end ? Math.round(flatTo(brick, bot.entity.position) - flatTo(brick, end)) : 0 };
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

// Each way to the fortress that can be tried from here, with what it
// meets. `run` returns why it ended, when it did not throw.
async function fortressApproaches(bot, task, goal, save, actions, state, nearest, bricks = [], record = state.approach) {
  const here = bot.entity.position.clone(), flat = Math.round(flatTo(nearest, here)), dy = Math.round(nearest.y + 1 - here.y);
  const where = `${flat} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}` : ''}`;
  const inView = threatsInView(bot);
  const options = {};
  let noRoute = null;
  if (actions.navigate) {
    const level = new goals.GoalNear(nearest.x, Math.round(here.y), nearest.z, 4);
    const route = await routeSurvey(bot, task, level, nearest);
    const surveyed = !route ? 'Not surveyed from here.'
      : !route.cells ? 'The pathfinder found no route toward it from here.'
      : `Surveyed toward the first: ${route.status === 'success' ? 'a whole route' : 'a route part of the way'} of ${route.cells} cells, placing ${route.place} block${route.place === 1 ? '' : 's'} and digging ${route.dig}, ${route.besideLava} of its cells within two blocks of lava; it ends ${route.gain} blocks nearer.`;
    const edge = route?.besideLava && inView.length ? ` In sight: ${mobsSaid(inView)}; a hit at the lava's edge is the fall.` : '';
    // No route found is no way: said in the state, not offered. mid-242-ab-
    // nether-4 was offered "the pathfinder found no route toward it from
    // here" as a way in, and chose it (note 591).
    if (route && !route.cells) noRoute = 'the pathfinder found no route toward it from here (it walks, bridges and climbs, and digs no netherrack)';
    else options.walk_route = { description: `Walk the pathfinder's route to the fortress, ${where}: to a point level with the bot beside it first, then on up or down to the floor itself. ${surveyed} The pathfinder walks upright, not crouched: a push or a misstep at an edge is the fall.${edge}`,
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
  if (flatTo(nearest, here) <= 12 && nearest.y < here.y - 2) {
    const column = columnBelow(bot);
    const under = !column ? '' : column.lava ? ` Lava is ${column.depth} blocks under the bot's feet.` : column.open ? ' Nothing solid within sixteen blocks under the bot\'s feet.' : ` The first floor under the bot's feet is ${column.name.replaceAll('_', ' ')}, ${column.depth} blocks down.`;
    options.descend = { description: `Dig straight down where the bot stands toward the bricks, ${Math.round(here.y - nearest.y - 1)} blocks below and ${flat} across, a block at a time.${under} A drop deeper than the health allows (nine blocks at full health, less hurt) or one onto or beside lava is refused, and the bot stays where it is.`,
      run: async () => { const dropped = await descendTo(bot, task, nearest); return dropped >= 1 ? null : 'dropped no lower'; } };
  }
  if (typeof bot.blockAt === 'function') {
    const survey = surveyCrossing(bot, nearest, { cells: APPROACH_CROSS });
    if (survey.cells && survey.gain >= 1) {
      const fire = underFire(bot);
      const open = survey.overLava ? 'lava' : 'open air';
      const risk = survey.bridge ? `${inView.length ? ` In sight: ${mobsSaid(inView)}; a hit on a one-wide span over ${open} is the fall.` : ''} On the span no mob is swung at or turned to: the bot holds still, crouched, until it is off.` : '';
      const shot = fire ? ` A ${fire.entity.name.replaceAll('_', ' ')} ${Math.round(fire.distance)} blocks off can see the bot now: no block is laid while something that shoots can, so the span stops at once.` : '';
      // The crossing is level: the "N from it" of its text is across, and a
      // fortress standing well above ends the span under it, out of blocks
      // and over the lava it was laid across (mid-242-bb-nether-1-fortress-*:
      // a span of 16 blocks toward a fortress 38 up, "2 from it", ended 37
      // under its bricks with none carried, and the bot stood there, a
      // fireball's push from the lava, for the rest of the ten minutes).
      const under = Math.round(nearest.y - survey.end.y), left = survey.carried - survey.bridge;
      const climb = under >= 4 ? ` It stays level: it ends ${under} blocks under the nearest brick (y ${Math.round(nearest.y)}), and the ${under} blocks up are still to be made from the end of the span, with ${left} block${left === 1 ? '' : 's'} left${survey.overLava ? ', over the lava it was laid across' : ''}; the way up is asked again from there.` : '';
      options.cross_level = { description: `${crossingSays(survey, `the fortress, ${where}`)}${climb}${risk}${shot}`,
        run: async () => { await bridgeTo(bot, task, nearest, { maxBlocks: survey.bridge, maxSteps: survey.cells }); return survey.stoppedBy; } };
    }
  }
  // Up to a floor overhead by a pillar: jump and lay a block under the
  // feet, from a column with no lava or water in or beside it. mid-235-p-
  // fortress-6 stood on its own span at y 49 beside the fortress's footing,
  // its corridors eight above, and every staircase up was refused for the
  // drop beside its steps (note 523).
  if (actions.dig && dy >= 2 && flatTo(nearest, here) <= 12 && typeof bot.blockAt === 'function') {
    const { pillarSite, pillarUp, SCAFFOLD } = require('./pillar-recovery');
    const site = pillarSite(bot, nearest.y + 1, nearest, { radius: 5 });
    const scaffold = bot.inventory?.items?.().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) || 0;
    if (site && scaffold >= 1) {
      const up = nearest.y + 1 - site.y, walk = Math.round(site.offset(0.5, 0, 0.5).distanceTo(here));
      const across = Math.round(Math.hypot(nearest.x - site.x, nearest.z - site.z));
      // A push off the top lands beside the column, not on its foot: over
      // whatever drop is beside the foot. mid-208-k-nether-3-fortress-1 was
      // told "a fall of up to 9 blocks" from its pillar's top on a ledge of
      // the lava sea; a ghast's fireball put it thirty-seven down into the
      // lava (note 551).
      const beside = require('./terrain').dropNear(bot, site, 3);
      const fall = up + (beside?.fallBlocks || 0), into = beside?.into === 'lava' ? 'lava' : beside?.into === 'water' ? 'water' : null;
      // What lies between the top and the floor, at its height: a pillar
      // beside the floor gets there; one some blocks off leaves a gap.
      // mid-242-bb was offered "Pillar straight up 2 blocks ... the floor is
      // then 6 blocks across", nothing said of the six (note 613).
      const { stepToward } = require('./bridging');
      let cell = new Vec3(site.x, nearest.y + 1, site.z), gap = 0;
      for (let n = 0, step; n < 12 && (step = stepToward(cell, nearest)); n++) { cell = cell.plus(step); if (bot.blockAt(cell.offset(0, -1, 0))?.boundingBox !== 'block') gap++; }
      const betweenSays = across <= 1 ? '' : gap ? `, with ${gap} of open air with no floor between the top and it at that height (a span, ${blocksCarried(bot)} blocks carried that a span is laid with)` : ', with ground between the top and it at that height';
      const pushSays = `On top a push is a fall of up to ${fall} blocks${beside ? ` (the pillar's ${up}, then a drop of ${beside.fallBlocks} ${beside.blocksAway === 1 ? 'a block' : `${beside.blocksAway} blocks`} from its foot)` : ''}, ${into === 'lava' ? 'into lava' : into === 'water' ? 'into water, no harm' : `about ${Math.max(0, fall - 3)} health`}.`;
      // What pushes up there: a shooter in view within its reach (a ghast
      // sixty-four, a blaze forty-eight), whose shot that lands pushes.
      const { RANGE } = require('./combat-estimate');
      const pushers = inView.filter(t => shooter(t.entity) && t.distance <= Math.max(16, RANGE[t.entity.name] || 0));
      const pushersSay = pushers.length ? ` ${capital(mobsSaid(pushers))} can shoot the bot on top, and a shot that lands pushes it, shield or not; the top has no wall.` : '';
      options.pillar_up = { description: `Pillar straight up ${up} blocks to the fortress floor's height (jump and lay a block under the feet, ${scaffold} carried that can be laid${scaffold < up ? `: they run out ${scaffold} up` : `, ${scaffold - up} left after`}${require('./block-stock').afterSays({ noPickaxe: !require('./block-stock').pickaxeCarried(bot), left: scaffold - up }).replace(/^ /, '; ').replace(/\.$/, '')}), from ${walk ? `a column ${walk} blocks from here` : 'where the bot stands'}, with no lava or water in or beside it; the floor at (${nearest.x}, ${nearest.y + 1}, ${nearest.z}) is then ${across} block${across === 1 ? '' : 's'} across${betweenSays}. ${pushSays}${inView.length ? ` In sight: ${mobsSaid(inView)}.` : ''}${pushersSay}`,
        run: async () => {
          if (site.distanceTo(bot.entity.position.floored()) >= 1 && actions.navigate) {
            try { await actions.navigate(bot, task, new goals.GoalBlock(site.x, site.y, site.z), { timeoutMs: 10000, stallMs: 3000 }); }
            catch (err) { task.check(); if (!retryable(err)) throw err; return `no way to the column at (${site.x}, ${site.y}, ${site.z}): ${err.message}`; }
          }
          if (site.distanceTo(bot.entity.position.floored()) >= 1.5) return `not at the column at (${site.x}, ${site.y}, ${site.z})`;
          const placed = await pillarUp(bot, task, nearest.y + 1, { dig: actions.dig });
          return placed ? null : 'the pillar would not rise';
        } };
    }
  }
  // Straight at it with the blocks for the crossing mined here first,
  // where the blocks carried stop it short (note 591).
  if (actions.mineAt && actions.navigate) {
    const cross = mineThenCrossPlan(bot, goal, nearest, bricks.length ? bricks : [nearest]);
    if (cross) options.blocks_then_cross = { description: mineThenCrossSays(bot, cross, where), run: () => mineThenCross(bot, task, goal, save, actions, state, cross) };
  }
  if (actions.tunnel) {
    const rest = require('./tunneling').restingSays(goal, nearest, here);
    options.tunnel = { description: `Dig a staircase through the rock toward the fortress, ${where}, a step at a time with rock round the bot: no block is dug with lava or water behind it, and it stops where every step nearer would be one.${rest ? ` ${capital(rest)}: taken now, it digs nothing until then.` : ''}`,
      run: async () => { await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); return null; } };
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
  options.keep_searching = { description: `Leave this fortress for ten minutes and go on with the search from here (${state.legs || 0} leg${state.legs === 1 ? '' : 's'} so far${minutes ? `, ${minutes} minutes on this one` : ''}${searching ? `, ${searching} minutes searching` : ''}): the sweep goes on along its heading, and the fortress may be met again from another side. Left is all of it in view, its bricks out to ${extent} blocks from the nearest.${onFrom}${require('./block-stock').pickaxeCarried(bot) ? '' : ` The sweep's legs over open air and lava lay a block a cell, and with no pickaxe carried none comes back or can be dug: the ${blocksCarried(bot)} carried are all there will be.`}`,
    run: async () => {
      // From where, kept with it: going back from the same spot asks the
      // same ways again (fortressInView). mid-235-q-nether-2 left its
      // fortress and went back to it every three seconds for a minute, each
      // way in weighed and left in the one question and the fortress taken
      // back in the next (note 541).
      const at = bot.entity.position;
      const ways = Object.keys(options).filter(k => k !== 'keep_searching').map(k => k.replaceAll('_', ' '));
      state.shunned.push({ x: nearest.x, z: nearest.z, radius: extent, until: Date.now() + 600000, at: Date.now(), why: 'Jev chose to leave it and search on',
        from: { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) }, left: ways });
      delete state.target; save();
      bot.chat?.('Leaving this fortress for now. Searching on for another way in.');
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
  if (waiting) for (const [key, option] of Object.entries(options)) option.description += ` Within sixteen blocks of the bricks, seen or not: ${waiting}; a way that arrives among them arrives in their fight.${hits && key !== 'keep_searching' ? ` ${hits}` : ''}`;
  // What each way came to on this approach, said with it.
  for (const [key, option] of Object.entries(options)) {
    const tries = (record?.failed || []).filter(f => f.choice === key);
    if (tries.length) option.description += ` Tried on this approach ${tries.length === 1 ? 'once' : `${tries.length} times`} and ended no nearer: ${tries.at(-1).why}.`;
  }
  return { options, facts: { fortress: { distance: flat, height: dy }, ...(noRoute ? { walkRoute: noRoute } : {}), health: bot.health, food: bot.food, ...(hits ? { whatAHitCosts: hits } : {}), blocksCarried: blocksCarried(bot),
    ...(bot.inventory?.items ? { pickaxe: pickaxeSays(bot) } : {}),
    threatsInView: inView.map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    ...(waiting ? { atTheBricks: waiting } : {}),
    // Blazes at the bricks: what the bot's fights with blazes came to, by the health and hunger begun at (blaze-record.js, note 631).
    ...(counted.blaze ? { playedRecord: require('./blaze-record').says(bot) } : {}),
    ...(record?.failed?.length ? { failed: record.failed.map(f => `${f.choice.replaceAll('_', ' ')}: ${f.why}`) } : {}) } };
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
  if (!state[kind] || Math.hypot(state[kind].found.x - found.x, state[kind].found.z - found.z) > same || (stretch && Math.abs(state[kind].found.y - found.y) > 1)) {
    state[kind] = { found, failed: stretch ? [{ choice: 'walk_route', why: stretch.why, at: Date.now() }] : [] };
  }
  const approach = state[kind];
  // Where the bot stood when the way to this place was first asked: the
  // place is kept from about there (findFortressStep, note 613).
  const at = bot.entity.position;
  if (!approach.from || approach.found.x !== found.x || approach.found.y !== found.y || approach.found.z !== found.z) approach.from = { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) };
  approach.found = found;
  goal.step = { action: 'find_fortress', found, ...(stretch ? { walking: found } : {}), legs: state.legs }; save();
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
  goal.step = { action: 'find_fortress', found, ...(stretch ? { walking: found } : {}), approach: pick, legs: state.legs }; save();
  const from = nearest.distanceTo(bot.entity.position);
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
  // Closer counts; a shuffle along the shelf does not.
  if (nearest.distanceTo(bot.entity.position) < from - 1.5) { approach.failed = []; save(); return null; }
  approach.failed = [...approach.failed, { choice: pick, why: why || 'came no nearer', at: Date.now() }].slice(-8);
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
// In the fortress: standing at the height of one of its floors, within six
// blocks of it. The one test for the patrol, the approach and staying.
function onFortressFloor(here, floors) {
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
  const blazes = (goal.mobHunt?.sightings || []).filter(s => s.dimension === bot.game?.dimension && Math.hypot(s.x - nearest.x, s.z - nearest.z) <= LEAVE_RADIUS)
    .reduce((n, s) => n + (s.seen || 1), 0);
  const seen = blazes ? `blazes seen near it ${blazes} time${blazes === 1 ? '' : 's'}` : 'no blaze seen near it yet';
  const passes = state.patrols || 0;
  const minutes = state.inFortressSince ? Math.round((Date.now() - state.inFortressSince) / 60000) : 0;
  // Its floors against where the bot stands: bricks a block off can be a
  // footing under corridors eight blocks up (note 523).
  const floors = fortressFloors(bot, bricks);
  const floor = floors.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  const floorSays = !floor ? 'none of its bricks in view has room to stand on it'
    : onFortressFloor(here, floors) ? 'the bot stands at the height of its floors'
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
    const spawner = map.spawners.map(s => new Vec3(s.x, s.y, s.z)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    if (spawner) {
      const d = Math.round(spawner.offset(0.5, 0.5, 0.5).distanceTo(here));
      const steps = fm.stepsTo(map, planned, spawner);
      const way = steps === null ? 'No floor seen joins it to where the bot stands: the walk there is on foot first, and where it finds no way the way there is asked (fortress_approach).' : `Floors seen join it to where the bot stands, about ${steps} steps.`;
      facts.spawner = `a spawner seen ${d} blocks off at (${spawner.x}, ${spawner.y}, ${spawner.z})`;
      others.wait_at_spawner = { description: `Wait by the spawner seen at (${spawner.x}, ${spawner.y}, ${spawner.z}), ${d} blocks off, for ${SPAWNER_WAIT_MS / 60000} minutes: a fortress's spawners are blaze spawners, and while a player is within sixteen blocks of one it makes up to four blazes within four blocks of itself every ten to forty seconds, and the hunt takes each one as it comes into view. ${way} ${capital(seen)}. The legs are asked again after.${state.spawnerWaitEnded ? ` The last wait here ended: ${state.spawnerWaitEnded}.` : ''}`,
        run: () => { state.spawnerWait = { x: spawner.x, y: spawner.y, z: spawner.z, until: Date.now() + SPAWNER_WAIT_MS }; delete state.spawnerWaitEnded; save(); return 'wait'; } };
    }
    // Floors seen that no floor seen joins to here, nearest first: the way
    // across is Jev's, each said as it lies along the ground (lava lying on
    // the floor to cover, rock filling the way to dig, open air to span),
    // and round the lava where there is a way round. The straight line
    // between the nearest two floors went through the walls: mid-235-q-
    // nether-1-fortress-3's was "4 of lava, 2 of wall or rock", where the way
    // was six blocks laid into the lava of the corridor beside (note 564).
    unwalkedParts(bot, map, planned).filter(part => !wayLeft(state, { x: part.g.at[0], y: part.g.at[1] + 1, z: part.g.at[2] })).slice(0, 3).forEach((part, i) => {
      const { g, groups } = part, across = { way: part.way, round: part.round, says: acrossSays(part.way, part.round) };
      const gap = across.way ? null : fm.gapTo(bot, planned, g, map);
      const floors = groups.reduce((n, p) => n + p.cells, 0), open = groups.reduce((n, p) => n + p.open, 0);
      const more = groups.length > 1 ? ` (with ${groups.length - 1} more part${groups.length === 2 ? '' : 's'} the same way reaches, ${floors} floors in all, ${open} of them running on into unseen space)` : '';
      const ended = state.goToEnded?.[`unwalked:${g.key}`];
      const dy = g.dy ? ` and ${Math.abs(g.dy)} ${g.dy > 0 ? 'up' : 'down'}` : '';
      others[`unwalked_${i + 1}`] = { description: `Go to the fortress's unwalked floors seen ${g.off} blocks off${dy}, at (${g.at[0]}, ${g.at[1] + 1}, ${g.at[2]}): ${g.cells} floor${g.cells === 1 ? '' : 's'} seen there, ${g.open} of them running on into unseen space${more}; no floor seen joins them to where the bot stands` +
        `${across.way ? `: the way across along the ground is ${across.says}` : gap ? `: no way across along the ground found; the nearest crossing is ${gap.across} blocks from a floor it can walk to (${gap.from[0]}, ${gap.from[1] + 1}, ${gap.from[2]}), between them ${gap.says}${gap.dy ? `, ${Math.abs(gap.dy)} ${gap.dy > 0 ? 'up' : 'down'}` : ''}` : ''}. ` +
        `The walk there is on foot first, digging and laying nothing; where it finds no way, the way there is asked (fortress_approach: covering the lava, digging through the rock, a span, a pillar, a drop or a staircase, each with what it meets).${ended ? ` The last try at it ended: ${ended.why}.` : ''}`,
        target: { x: g.at[0], y: g.at[1] + 1, z: g.at[2] }, run: () => { state.goTo = { x: g.at[0], y: g.at[1] + 1, z: g.at[2], kind: 'unwalked', key: g.key, keys: groups.map(p => p.key), since: Date.now() }; save(); return 'goto'; } };
    });
    const patrol = planned.patrol.length ? { key: 'stay_in_fortress',
      description: `Stay in the fortress and walk its corridors again for blazes for ${PATROL_MS / 60000} minutes, the least lately walked first, any new way on seen walked first: ${walkedSays(planned)}, ${planned.patrol.length} of those joined to here twelve or more steps off; ${joinedExtentSays(planned)}${!map.spawners.length ? ', and no spawner has been seen' : map.spawners.some(sp => fm.stepsTo(map, planned, new Vec3(sp.x, sp.y, sp.z)) !== null) ? ', a spawner seen among them' : ', no spawner seen among them'}; ${passes} time${passes === 1 ? '' : 's'} asked here, ${minutes} minute${minutes === 1 ? '' : 's'} in it, ${seen}. Blazes come from their spawners and spawn on the fortress's bricks as time passes. The legs are asked again after.`,
      run: () => { state.patrolUntil = Date.now() + PATROL_MS; save(); return 'stay'; } } : null;
    return { key: 'stay_in_fortress', ...(patrol ? {} : { offer: false }), passes, bricks, facts, others,
      description: patrol?.description || '', run: patrol?.run || (() => 'stay') };
  }
  const leftAgo = state.leaving ? Math.round((LEAVE_MS - (state.leaving.until - Date.now())) / 60000) : null;
  // Set aside for what it was, not always "a face not approached": mid-235-
  // p-fortress-7's was nothing to walk to, said as the other, and going
  // back from the same spot was undone at once, six times (note 528).
  const shun = (state.shunned || []).find(sh => sh.why && Math.hypot(sh.x - nearest.x, sh.z - nearest.z) <= (sh.radius || 16));
  const mins = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${m} minute${m === 1 ? '' : 's'}`; };
  // Standing on its floors, going back from where Jev left it over its ways
  // in is walking them from here, not those ways asked again: offered
  // (note 557). One found to hold nothing to walk to still is not.
  const onFloors = onFortressFloor(here, fortressFloors(bot, bricks));
  const sameSpot = !(onFloors && shun?.left) && !!shun?.from && Math.hypot(shun.from.x - here.x, shun.from.y - here.y, shun.from.z - here.z) <= 4;
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
  const restSays = waysRest ? `; from here every way into it last offered came to nothing (${spent.keys.map(k => k.replaceAll('_', ' ')).join(', ')}): going back from here is asking those same ways again` : '';
  // Going back from where it was found to hold nothing to walk to is no
  // move: the patrol sets it aside again before a step. Nor from where Jev
  // left it over its ways in (keep_searching): the same ways are asked
  // again, and each answer undid the other (note 541). Said as a fact
  // with the legs, not offered (chooseLeg).
  return { key: 'back_to_fortress', passes, bricks, facts: { ...facts, setAside: `${why}${restSays}` }, ...(sameSpot || waysRest ? { offer: false, leftHere: sameSpot ? shun?.left || [] : [] } : {}),
    description: `Go back into the fortress in view: ${bricks.length} of its bricks, the nearest ${off} blocks off, ${why}; ${floorSays}; ${seen}.${state.map ? ` Of its floors seen, ${Object.values(state.map.cells).filter(c => c[0]).length} of ${Object.keys(state.map.cells).length} walked.` : ''} Taken, it is no longer set aside, and ${onFloors ? 'its floors are walked from where the bot stands' : 'the way to its bricks is asked (fortress_approach), or its floors walked when the bot is among them'}.`,
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
  // Floors across a gap are reached when stood on; blazes when near.
  const near = g.kind === 'unwalked' ? 2.5 : GO_TO_NEAR;
  const close = () => target.distanceTo(bot.entity.position) <= near;
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
  if (g.key && !reached && state.map?.failed) state.map.failed[g.key] = { why: why || 'came no nearer', at: Date.now() };
  if (g.kind === 'blazes') {
    const spot = (goal.mobHunt?.sightings || []).find(s => s.x === g.x && s.y === g.y && s.z === g.z);
    if (spot && !reached) { spot.tries = (spot.tries || 0) + 1; spot.why = why || 'came no nearer'; }
  }
  delete state.goTo; save();
}

async function findFortressStep(bot, task, goal, save, actions) {
  const state = goal.fortressSearch ||= { axis: Math.round(bot.entity.position.x) % 2 === 0 ? 1 : -1, legs: 0 };
  if (await stayKit(bot, task, goal, save, actions)) return;
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
    if (state.spawnerWait) { state.spawnerWaitEnded = why; delete state.spawnerWait; }
    if (state.goTo) { const g = state.goTo; (state.goToEnded ||= {})[g.key ? `${g.kind}:${g.key}` : g.kind] = { why, at }; delete state.goTo; }
    if (state.target) { delete state.target; delete state.rememberedTarget; }
    delete state.patrolUntil; delete state.restock; save();
  }
  // A wait by a spawner Jev chose (wait_at_spawner): near its cage until
  // the wait is up; the hunt takes a blaze the moment one is in view.
  if (state.spawnerWait) {
    const w = state.spawnerWait, cage = new Vec3(w.x, w.y, w.z);
    const off = cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position);
    if (!(w.until > Date.now())) { state.spawnerWaitEnded = 'waited its minutes'; delete state.spawnerWait; goal.step = { action: 'find_fortress', legs: state.legs || 0 }; save(); }
    else {
      goal.step = { action: 'wait_at_spawner', spawner: { x: w.x, y: w.y, z: w.z }, off: Math.round(off), secondsLeft: Math.round((w.until - Date.now()) / 1000), legs: state.legs || 0 }; save();
      if (off <= 8) { await sleep(1000); task.check(); return; }
      let why = null;
      if (actions.navigate) {
        try { await actions.navigate(bot, task, new goals.GoalNear(w.x, w.y, w.z, 4), { timeoutMs: 30000, stallMs: 6000, passing: true, onFoot: true }); }
        catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
      } else why = 'no way to walk there';
      // No way on foot: the way there is Jev's once for the wait, as for
      // any place chosen (a span, a pillar, the staircase through the rock).
      const far = () => cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) > 8;
      if (far() && !w.asked) {
        w.asked = true; save();
        const ended = await approachFortress(bot, task, goal, save, actions, state, cage, [], { stretch: { why: why || 'the walk came no nearer', what: 'the spawner seen' } });
        if (ended) why = ended;
        if (!far()) return;
      }
      if (far()) { state.spawnerWaitEnded = `no way to it: ${why || 'came no nearer'}`; delete state.spawnerWait; goal.step = { action: 'find_fortress', legs: state.legs || 0 }; save(); }
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
  const shunned = b => state.shunned.some(sh => Math.hypot(sh.x - b.x, sh.z - b.z) <= (sh.radius || 16)) || left(b);
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
  const bricks = found.length >= FORTRESS_MIN_BRICKS ? found : [];
  // Bricks enough for a fortress, all left behind or set aside: said to
  // Jev with the next leg, going back among the ways (fortressInView),
  // said as they stand now, before a leg's end lets them be seen again.
  let setAside = !bricks.length && seen.length >= FORTRESS_MIN_BRICKS ? fortressInView(bot, goal, save, state, seen, { stay: false }) : null;
  // Off its floors with the leg's question owed: its ways in are what came
  // to nothing, so going back to it is among the legs, said so.
  const offFloors = !!owedLeg && bricks.length > 0 && !onFortressFloor(bot.entity.position, fortressFloors(bot, bricks));
  if (offFloors) setAside = fortressInView(bot, goal, save, state, bricks, { stay: false, aside: `its ways in from here came to nothing: ${owedLeg.at(-1).slice(0, 200)}` });
  if (bricks.length && !offFloors) {
    const here = bot.entity.position;
    const byNear = list => list.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    // In the fortress is on its floors (onFortressFloor), not within six
    // blocks of any brick: mid-235-p-fortress-6 stood on its own span a
    // block from the fortress's footing, its corridors eight blocks up,
    // was "inside", and set out for bricks it had no way to (note 523).
    const floors = fortressFloors(bot, bricks);
    const nearest = byNear(bricks)[0];
    state.found = { x: nearest.x, y: nearest.y, z: nearest.z };
    // The way in is asked about one place, kept while the bot is about
    // where it was first asked and the place is still one of the floors:
    // the nearest, picked afresh at each pass, moved fifteen to forty
    // blocks as mid-242-bb walked a few steps, so each asking was about a
    // new place, every way on offer again, none resting (note 613).
    const candidates = floors.length ? floors : bricks, a = state.approach;
    const kept = a?.found && a.from && Math.hypot(a.from.x - here.x, a.from.y - here.y, a.from.z - here.z) <= APPROACH_FROM
      ? candidates.find(f => f.x === a.found.x && f.y === a.found.y && f.z === a.found.z) : null;
    if (!onFortressFloor(here, floors)) {
      const target = kept || byNear(candidates)[0];
      // Whether the visit happens now is asked before the way in (note 638):
      // the bot's health and hunger are what a fight's outcome turns on.
      const visit = await require('./fortress-visit').ask(bot, task, goal, save, actions, { fortress: { distance: Math.round(flatTo(target, here)), height: Math.round(target.y + 1 - here.y), at: { x: target.x, y: target.y, z: target.z } },
        leave: () => {
          state.shunned.push({ x: target.x, z: target.z, radius: fortressExtent(bricks, target), until: Date.now() + 600000, at: Date.now(), why: 'Jev chose to leave it and search on',
            from: { x: Math.round(here.x), y: Math.round(here.y), z: Math.round(here.z) }, left: ['the visit itself'] });
          delete state.target; save();
          bot.chat?.('Leaving this fortress for now. Searching on for another way in.');
        } });
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
      delete state.found; state.patrols = 0; delete state.inFortressSince; save();
      setAside = fortressInView(bot, goal, save, state, seen, { stay: false });
    }
    else if (!owedLeg && (planned.frontiers.length || (state.patrolUntil && planned.patrol.length))) {
      const exploring = !!planned.frontiers.length, next = exploring ? planned.frontiers[0] : planned.patrol[0];
      const [x, y, z] = next.at;
      goal.step = { action: 'find_fortress', found: state.found, [exploring ? 'exploring' : 'patrolling']: { x, y, z }, steps: next.steps, walked: planned.walked, seen: planned.seen, legs: state.legs }; save();
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
      fm.look(bot, state, { force: true }); save();
      return;
    }
    else {
      // Nothing left to walk to from here: staying, crossing to what is
      // seen unwalked, a spawner seen, the blazes, or a leg away are Jev's
      // (fortress_leg), with what the map comes to.
      state.patrols = (state.patrols || 0) + 1;
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
      state.patrols = 0; delete state.inFortressSince; delete state.target; delete state.patrolUntil;
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
  const remembered = !owedLeg && require('./exploration').knownLandmarks(bot, goal, 'nether_fortress').find(k => k.distance > 24 && !shunned(k.landmark));
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
    if (state.target && Number.isInteger(state.lastHeading) && state.legHistory) { for (const mode of ['level', 'descend', 'floor']) delete state.legHistory[legKey(state.lastHeading, mode)]; }
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
    beginLeg(state, here);
  }
  goal.step = { action: 'find_fortress', target: state.target, legs: state.legs }; save();
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
  legEnded(state, state.lastLegError || state.lastCrossStop, seeking ? 'descend' : state.legMode);
  // Every way on failed within a few blocks of where the leg began: the leg
  // ends here and its heading rests from this spot (legResting), its
  // failure said with the next ask, not tried again tick after tick.
  // mid-242-ac-nether-1's legs each made a block or two to the lava's edge
  // and came back to it at the next ask (note 557).
  const along = state.legFrom ? Math.hypot(state.legFrom.x - here.x, state.legFrom.z - here.z) : Infinity;
  if (along < LEG_REST_WITHIN) {
    restLeg(state, state.lastLegError || state.lastCrossStop, here, Math.round(along));
    delete state.target; state.legFails = 0; save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.('No way on in this direction from here. Choosing another.'); }
    return;
  }
  // Short of blocks, the ways to more are Jev's beside the legs (chooseLeg:
  // restock_blocks, return_for_blocks), asked when the sweep turns.
  if (state.legFails >= 4 && Date.now() - (state.legSince || 0) >= 20000) {
    turnSweep(state); save();
    if (!(state.turnSaidAt > Date.now() - 60000)) { state.turnSaidAt = Date.now(); bot.chat?.('No way on in this direction. Turning the search.'); }
  }
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
  return { layer: 'hunt', action: 'hunt', urgency: 'routine', facts: { entity: target.name, distance: Math.round(target.position.distanceTo(bot.entity.position) * 10) / 10,
    item: state.item, have: countOf(bot, state.item), want: huntTarget(bot, goal), health: bot.health } };
}

module.exports = { crossingFor, crossingOptions, unwalkedParts, claim, stakeHunt, prepareCombatGear, combatMovement, canBegin, fitness, fitnessSays, isolated, fightForDrop, huntObserved, prepareMobHunt, findFortressStep, fortressLegTarget, turnSweep, chooseLeg, FORTRESS_Y, HEADING_NAMES, rememberSighting, rememberedSpot, approaches, combatRoute, FORTRESS_LEG, fortressFloors, approachFortress, pickaxeFirst };
