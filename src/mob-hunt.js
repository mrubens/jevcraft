'use strict';
const { goldInPassing, mineGoldInPassing } = require('./opportunistic-mining');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { handlers, combatGear, durable, carriedEquipment, equipped, readyEquipment, kitReady, observedDead, shooter, hasFood, SHOOTERS, FIGHT_FLOOR: HUNT_FLOOR } = require('./mob-policy');
const { threats, checkThreats, NeedsSafety } = require('./danger');
const { canStrike, defenseWeapon, bowReady, shoot, strike } = require('./combat');
const { deflect } = require('./projectile-guard');
const { aimAtEntity } = require('./projectiles');
const { dryStanding } = require('./mining-access');
const { dryBodySpace, damagingTerrain, supportCell, dropWithin, onSpan } = require('./terrain');
const { fightEstimate } = require('./combat-estimate');
const { checkAir } = require('./vitals');
const { surveyRoute, countOf } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');
const { decide } = require('./decisions');
const { descendTo } = require('./descent');
const { setAside, isSetAside, watch, unwatch } = require('./progress');
const { bridgeTo, surveyCrossing, underFire, blocksCarried, MATERIALS } = require('./bridging');
const { crossToward, crossingSays, nearer, surveyLeg, legSays, WALK_SPEED } = require('./nether-travel');
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
function fitnessSays(bot, f = fitness(bot)) {
  const parts = [`Health ${f.health}${f.health < f.floor ? ` (under the ${f.floor} the code once required to start a fight)` : ''}`,
    `hunger ${f.food}: ${f.healing ? 'health comes back while it stays at eighteen or more' : `health does not come back under eighteen${f.foodCarried ? ', and food is carried to eat first' : ', and nothing is carried to eat: every point lost is gone for good'}`}`];
  if (f.burning) parts.push(`alight now: fire takes half a heart a second${dimension(bot) === 'nether' ? ', and in the Nether there is no water to put it out; only waiting burns it off' : ''}`);
  if (f.kitMissing.length) parts.push(`the kit is short: no ${f.kitMissing.map(d => d === 'hand' ? 'sword or axe carried' : `${d} armour worn`).join(', no ')}`);
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
async function combatRoute(bot, task, target, movement, timeoutMs = 400) {
  for (const destination of approaches(bot, target)) {
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, timeoutMs);
    if (route.status === 'success' && route.path.every(movement.allowed)) return { route, destination };
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
        await actions.navigate(bot, task, destination, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
          stopWhen: () => dead || !valid(bot, target) || canStrike(bot, target) });
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
function stakeHunt(bot, goal) {
  const state = goal?.mobHunt;
  if (!state || countOf(bot, state.item) >= state.targetCount) return false;
  bot._huntingEntity = { name: state.entity, until: Date.now() + 5000 };
  return true;
}

async function huntObserved(bot, task, goal, save, actions, client) {
  const state = goal.mobHunt;
  if (!state) return false;
  if (countOf(bot, state.item) >= state.targetCount) { delete goal.mobHunt; save(); return false; }
  const handler = handlers[state.entity] || {};
  stakeHunt(bot, goal);
  if (!canBegin(bot, handler)) return false;
  const candidates = Object.values(bot.entities).filter(e => e.name === state.entity && valid(bot, e) &&
    e.position.distanceTo(bot.entity.position) < 24 && isolated(bot, e, handler) &&
    !isSetAside(goal, 'hunt_target', e.uuid || e.id)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  const tree = {}, positions = new Map();
  for (const target of candidates.slice(0, 4)) {
    const restore = encounter(bot, task, target, Date.now() + 1500), movement = combatMovement(bot);
    try {
      if (!canStrike(bot, target) && !await combatRoute(bot, task, target, movement)) continue;
      positions.set(target.id, target.position.clone());
      // What this one fight costs, and what is beside the mob (the decision
      // audit, 2026-09-25): a hoglin's toss or a blaze's knockback beside
      // lava or a drop is the fall, not the fight.
      const distance = target.position.distanceTo(bot.entity.position);
      const one = fightEstimate({ threats: [{ name: target.name, distance, shoots: shooter(target), ...(target.heldItem?.name ? { held: target.heldItem.name } : {}), visible: true }], armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean),
        weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' });
      const mob = one.mobs[0];
      const at = target.position.floored();
      const lavaNear = require('./survival').lavaBeside(bot, at), dropNear = dropWithin(bot, at, 3);
      tree[`hunt_${target.id}`] = { description: { action: handler.passive ? 'Chase this observed animal and strike it with what is carried, then verify item pickup.' :
        handler.ranged && bowReady(bot) ? 'Fight this observed isolated mob: arrows from range while it is in view, then the sword, shield and armor up close; verify item pickup.' :
        'Fight this observed isolated mob with carried armor, sword and shield, then verify item pickup.',
        entity: target.name, position: { ...target.position }, distance,
        item: state.item, randomDrop: true,
        ...(mob && !handler.passive ? { fight: { hitsBot: mob.hitsBot, seconds: one.fightHere.seconds, damageTaken: one.fightHere.damageTaken, healthAfter: one.fightHere.healthAfter, ...(mob.note ? { note: mob.note } : {}) } } : {}),
        ...(lavaNear ? { lavaNearIt: 'lava within two blocks of it: a knockback there lands in it' } : {}),
        ...(dropNear ? { dropNearIt: 'a drop within three blocks of it' } : {}),
        ...(() => { const { UNPROVOKED } = require('./danger'); const near = Object.values(bot.entities || {}).filter(e => Object.hasOwn(UNPROVOKED, e.name) && e.position && e.position.distanceTo(target.position) <= 6);
          return near.length ? { hittersNearIt: `${near.length} ${[...new Set(near.map(e => e.name.replaceAll('_', ' ')))].join(' and ')} within six blocks of it: ${[...new Set(near.map(e => UNPROVOKED[e.name].note))].join('; ')}` } : {}; })() }, run: () => fightForDrop(bot, task, target, goal, save, actions) };
    } finally { movement.restore(); restore(); }
  }
  if (!Object.keys(tree).length) return false;
  // The bot's fitness, on every option and in the state: what the code
  // once refused a fight for, as facts for Jev's choice (fitness, above).
  const fit = fitness(bot), fitSaid = fitnessSays(bot, fit);
  for (const option of Object.values(tree)) option.description.fitness = fitSaid;
  tree.defer = { description: `Leave these targets alone for now if the observed situation is unsuitable; keep the resource goal saved. ${fitSaid}${fit.fit ? '' : ' Left alone, the hunt recovers first: food if any is carried, cover from the shooters, and health while hunger is eighteen or more.'}`, run: async () => {
    for (const target of candidates) setAside(goal, 'hunt_target', target.uuid || target.id, 'Jev chose to leave it for now', 120000); save();
  } };
  const snapshot = { request: goal.request, resource: state.item, need: state.targetCount - countOf(bot, state.item), health: bot.health, food: bot.food, dimension: dimension(bot), riskNow: require('./risk').riskNow(bot),
    fitness: { ...fit, said: fitSaid } };
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
async function foodLeave(bot, task, goal, save, actions) {
  const { portalTrip } = require('./game-progress');
  const tree = {
    go_back: { description: `Go back to the Overworld for food, hunted and cooked there. ${portalTrip(bot, goal)} The hunt waits till the bot is fed and back.` },
    keep_on: { description: `Stay and go on without food for twenty minutes: hunger ${bot.food}, and health comes back only at eighteen or more, so no fight is started; the fortress search goes on meanwhile. ${fitnessSays(bot)}` },
  };
  const decision = await decide('leave_nether', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree,
    state: { for: 'food', health: bot.health, food: bot.food, foodCarried: false, dimension: dimension(bot) } });
  if (decision.stale) return null;
  const pick = decision.path.at(-1);
  goal.leaveNether = { reason: 'food', pick, until: 0, at: Date.now() };
  if (pick === 'keep_on') { setAside(goal, 'nether_return', 'food', 'Jev chose to go on in the Nether without going back for food', 20 * 60000); delete goal.stockFood; }
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
    if (await mineGoldInPassing(bot, task, goal, save, actions)) return;
    spot.triedAt = Date.now(); spot.tries = (spot.tries || 0) + 1; save();
    goal.step = { action: 'return_to_blazes', target: { x: spot.x, y: spot.y, z: spot.z }, seen: spot.seen }; save();
    const from = bot.entity.position.clone();
    let stoppedForGold = false;
    const stopWhen = () => (stoppedForGold = goldInPassing(bot, goal));
    try { await actions.navigate(bot, task, new goals.GoalNear(spot.x, spot.y, spot.z, 6), { timeoutMs: 60000, stallMs: 10000, stopWhen }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    // A walk cut short for gold is not a try at the spot.
    if (stoppedForGold) { spot.tries--; delete spot.triedAt; save(); return; }
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
function rememberSighting(state, bot, entity) {
  const p = entity.position, dimension = bot.game?.dimension;
  state.sightings ||= [];
  const near = state.sightings.find(s => s.dimension === dimension && Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) < 16);
  if (near) { Object.assign(near, { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: Date.now(), seen: (near.seen || 1) + 1 }); }
  else state.sightings.unshift({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), dimension, at: Date.now(), seen: 1 });
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
  // ends at them; a level leg keeps its height between the sea and the roof.
  const y = state.legMode === 'descend' ? FORTRESS_Y : Math.max(40, Math.min(80, Math.round(position.y)));
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
const legKey = (i, seeking) => seeking ? `seek_${HEADING_NAMES[i]}` : HEADING_NAMES[i];
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

// The blocks a span can be laid with (bridging.js MATERIALS) in the ground
// round the bot, by kind: a basalt delta is thousands of them with hardly
// any netherrack, and the restock mined netherrack only, counting blocks
// without basalt (mid-211-s-nether-4, mid-202-o, note 480).
const RESTOCK_REACH = 16, RESTOCK_STACK = 64;
function bridgingNearby(bot) {
  if (typeof bot.findBlocks !== 'function' || typeof bot.blockAt !== 'function') return [];
  const ids = MATERIALS.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
  const here = bot.entity.position, kinds = {};
  for (const p of bot.findBlocks({ matching: ids, maxDistance: RESTOCK_REACH, count: 4096 }) || []) {
    const b = bot.blockAt(p);
    if (!b || !MATERIALS.includes(b.name)) continue;
    const k = kinds[b.name] ||= { name: b.name, count: 0, nearest: Infinity, block: null };
    k.count++;
    const d = p.distanceTo(here);
    if (d < k.nearest) { k.nearest = d; k.block = b; }
  }
  return Object.values(kinds).sort((x, y) => y.count - x.count || x.nearest - y.nearest);
}
// Seconds a block of this kind takes to dig with the tool the dig would
// take (skills.js cheapestTool), as the crossing's survey reckons it.
function digSeconds(bot, block) {
  if (typeof block?.digTime !== 'function') return null;
  const tool = require('./skills').cheapestTool(bot, block);
  return block.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000;
}
function restockSays(bot, kinds, want) {
  const [k] = kinds, per = digSeconds(bot, k.block);
  const all = kinds.map(x => `${x.count.toLocaleString('en-US')} ${x.name.replaceAll('_', ' ')}`).join(', ');
  return `Mine ${want} ${k.name.replaceAll('_', ' ')} to lay spans with, the nearest ${Math.round(k.nearest)} blocks off` +
    `${per === null ? '' : `, about ${Math.round(want * per + want / WALK_SPEED)} seconds (${Math.round(per * 10) / 10} a block to dig)`}. ` +
    `Within ${RESTOCK_REACH} blocks, of what a span is laid with: ${all}. ${blocksCarried(bot)} carried now. The leg is chosen again after.`;
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
  const back = state.legFrom && Number.isInteger(state.lastHeading) ? (state.lastHeading + 2) % 4 : null;
  const { restingSays } = require('./tunneling');
  // Each way's staircase as the step would dig it (fortressLegTarget), and
  // whether it rests: a level leg digs one where the walk and the span give
  // out, and the fortress heights are one alone.
  const rests = mode => HEADINGS.map((h, i) => restingSays(goal, fortressLegTarget({ heading: i, legMode: mode }, here), here));
  const levelRests = rests('level');
  const options = {};
  HEADINGS.forEach((h, i) => {
    options[`leg_${HEADING_NAMES[i]}`] = { description: legSays(surveys[i], { direction: HEADING_NAMES[i], length: FORTRESS_LEG, y }) +
      (i === back ? ' This is back the way the last leg came.' : '') + legHistorySays(state, HEADING_NAMES[i], here) +
      (levelRests[i] ? ` Where the walk and the span give out, ${levelRests[i]}.` : ''),
      run: () => { state.heading = i; state.legMode = 'level'; return true; } };
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
    options.seek_fortress_height = { description: `Dig a staircase ${off > 0 ? 'down' : 'up'} toward y ${FORTRESS_Y} heading ${HEADING_NAMES[most]}, ${Math.abs(off)} blocks of height, a step at a time with rock round the bot and no block dug with lava or water behind it: fortress corridors and bridges stand mostly between y 48 and 75, over the lava sea at y 31, and from y ${y} ${fortress ? 'only what open air shows is seen, the fortress in view among it' : 'none is seen through the rock'}. The leg goes level again once within ${FORTRESS_BAND} of y ${FORTRESS_Y}.` +
      (seekRests[most] ? ` ${capital(seekRests[most])}: taken now, it digs nothing until then.` : '') + passed + legHistorySays(state, legKey(most, true), here, 'staircase'),
      run: () => { state.heading = most; state.legMode = 'descend'; return true; } };
  }
  if (fortress) options[fortress.key] = { description: fortress.description, run: fortress.run };
  const short = surveys.some(s => Number.isInteger(s?.runsOut));
  if (short && actions.acquireStep) {
    const kinds = bridgingNearby(bot).filter(k => !isSetAside(goal, 'restock', k.name));
    if (kinds.length) {
      const want = Math.min(RESTOCK_STACK, kinds[0].count), name = kinds[0].name;
      const seconds = digSeconds(bot, kinds[0].block);
      options.restock_blocks = { description: restockSays(bot, kinds, want),
        run: async () => { state.restock = { name, want: countOf(bot, name) + want, since: Date.now(), said: seconds === null ? null : Math.round(want * seconds + want / WALK_SPEED) }; save(); await restockStep(bot, task, goal, save, actions, state); return 'restock'; } };
    }
  }
  if (short && actions.returnOverworld) {
    const portal = (goal.portals || []).filter(p => p.dimension === 'nether').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
    options.return_for_blocks = { description: `Go back through the portal to the Overworld${portal ? `, the nearest known ${Math.round(Math.hypot(portal.x - here.x, portal.z - here.z))} blocks off at ${portal.x}, ${portal.y}, ${portal.z}` : ', none known in the Nether: the way is found from what is loaded'}, for stone to lay spans with; the Nether is entered again by the same portal, and the search goes on from there.`,
      run: async () => { await actions.returnOverworld(bot, task, goal, save); return 'returned'; } };
  }
  const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
  const facts = { height: y, fortressHeights: 'corridors and bridges mostly between y 48 and 75, over the lava sea at y 31; bricks are seen within 128 blocks, and only through open air',
    legsSoFar: state.legs || 0, minutesSearching: state.since ? Math.round((Date.now() - state.since) / 60000) : 0,
    lastLeg: Number.isInteger(state.lastHeading) ? (() => { const seeking = state.legMode === 'descend', h = state.legHistory?.[legKey(state.lastHeading, seeking)];
      return `${seeking ? 'a staircase toward the fortress heights ' : ''}${HEADING_NAMES[state.lastHeading]}${h ? `, ended no nearer: ${h.ended}` : ''}`; })() : null,
    blocksCarried: blocksCarried(bot), health: bot.health, food: bot.food, threatsInView: threatsInView(bot).map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    ...(fortress ? { fortressInView: fortress.facts } : {}) };
  // Without Jev: the open air each heading's carried blocks reach.
  const open = Object.fromEntries(HEADINGS.map((h, i) => [`leg_${HEADING_NAMES[i]}`, surveys[i] ? surveys[i].reach : null]));
  const decision = await decide('fortress_leg', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree, state: facts,
    context: { current: `leg_${HEADING_NAMES[current]}`, open, passes: fortress?.passes || 0 } });
  if (decision.stale) return false;
  return options[decision.path.at(-1)].run();
}
// The restock Jev chose, held until its blocks are carried: each call of
// acquireStep is one step of it. It ends where it fails, or at twice the
// time it was said to take, and the failure is said on the next offer.
async function restockStep(bot, task, goal, save, actions, state) {
  const r = state.restock;
  if (countOf(bot, r.name) >= r.want) { delete state.restock; save(); return false; }
  const over = r.said !== null && Date.now() - r.since > Math.max(60, r.said * 2) * 1000;
  goal.step = { action: 'restock_blocks', item: r.name, want: r.want, have: countOf(bot, r.name) }; save();
  try {
    if (over) throw new Error(`still short after twice the ${r.said} seconds it was said to take`);
    await actions.acquireStep(bot, task, r.name, r.want, goal, save);
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err;
    setAside(goal, 'restock', r.name, err.message, 5 * 60000); delete state.restock; save();
  }
  return true;
}
// The leg Jev chose begun from here.
function beginLeg(state, here) {
  const next = fortressLegTarget(state, here); state.target = { x: next.x, y: next.y, z: next.z }; state.legs++; state.legSince = Date.now();
  state.legFrom = { x: Math.round(here.x), z: Math.round(here.z) }; state.lastHeading = headingIndex(state); delete state.lastLegError;
  delete state.legBest;
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
async function fortressApproaches(bot, task, goal, save, actions, state, nearest) {
  const here = bot.entity.position.clone(), flat = Math.round(flatTo(nearest, here)), dy = Math.round(nearest.y + 1 - here.y);
  const where = `${flat} blocks off${Math.abs(dy) >= 2 ? ` and ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}` : ''}`;
  const inView = threatsInView(bot);
  const options = {};
  if (actions.navigate) {
    const level = new goals.GoalNear(nearest.x, Math.round(here.y), nearest.z, 4);
    const route = await routeSurvey(bot, task, level, nearest);
    const surveyed = !route ? 'Not surveyed from here.'
      : !route.cells ? 'The pathfinder found no route toward it from here.'
      : `Surveyed toward the first: ${route.status === 'success' ? 'a whole route' : 'a route part of the way'} of ${route.cells} cells, placing ${route.place} block${route.place === 1 ? '' : 's'} and digging ${route.dig}, ${route.besideLava} of its cells within two blocks of lava; it ends ${route.gain} blocks nearer.`;
    const edge = route?.besideLava && inView.length ? ` In sight: ${mobsSaid(inView)}; a hit at the lava's edge is the fall.` : '';
    options.walk_route = { description: `Walk the pathfinder's route to the fortress, ${where}: to a point level with the bot above it first, then to the bricks' own height if that comes no nearer. ${surveyed} The pathfinder walks upright, not crouched: a push or a misstep at an edge is the fall.${edge}`,
      run: async () => {
        const from = bot.entity.position.clone();
        let why = null;
        for (const g of [level, new goals.GoalNear(nearest.x, nearest.y + 1, nearest.z, 3)]) {
          try { await actions.navigate(bot, task, g, { timeoutMs: 45000, stallMs: 8000 }); }
          catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
          if (nearest.distanceTo(bot.entity.position) < nearest.distanceTo(from) - 1.5) return null;
        }
        return why;
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
      options.cross_level = { description: `${crossingSays(survey, `the fortress, ${where}`)}${risk}${shot}`,
        run: async () => { await bridgeTo(bot, task, nearest, { maxBlocks: survey.bridge, maxSteps: survey.cells }); return survey.stoppedBy; } };
    }
  }
  if (actions.tunnel) {
    const rest = require('./tunneling').restingSays(goal, nearest, here);
    options.tunnel = { description: `Dig a staircase through the rock toward the fortress, ${where}, a step at a time with rock round the bot: no block is dug with lava or water behind it, and it stops where every step nearer would be one.${rest ? ` ${capital(rest)}: taken now, it digs nothing until then.` : ''}`,
      run: async () => { await actions.tunnel(bot, task, goal, save, nearest, 'fortress'); return null; } };
  }
  const minutes = state.legSince ? Math.round((Date.now() - state.legSince) / 60000) : null;
  options.keep_searching = { description: `Leave this fortress for ten minutes and go on with the search from here (${state.legs || 0} leg${state.legs === 1 ? '' : 's'} so far${minutes ? `, ${minutes} minutes on this one` : ''}): the sweep goes on along its heading, and the fortress may be met again from another side.`,
    run: async () => {
      state.shunned.push({ x: nearest.x, z: nearest.z, until: Date.now() + 600000 }); delete state.target; save();
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
    const tries = (state.approach?.failed || []).filter(f => f.choice === key);
    if (tries.length) option.description += ` Tried on this approach ${tries.length === 1 ? 'once' : `${tries.length} times`} and ended no nearer: ${tries.at(-1).why}.`;
  }
  return { options, facts: { fortress: { distance: flat, height: dy }, health: bot.health, food: bot.food, ...(hits ? { whatAHitCosts: hits } : {}), blocksCarried: blocksCarried(bot),
    threatsInView: inView.map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`),
    ...(waiting ? { atTheBricks: waiting } : {}),
    ...(state.approach?.failed?.length ? { failed: state.approach.failed.map(f => `${f.choice.replaceAll('_', ' ')}: ${f.why}`) } : {}) } };
}

async function approachFortress(bot, task, goal, save, actions, state, nearest) {
  const found = { x: nearest.x, y: nearest.y, z: nearest.z };
  if (!state.approach || Math.hypot(state.approach.found.x - found.x, state.approach.found.z - found.z) > SAME_FORTRESS) state.approach = { found, failed: [] };
  const approach = state.approach;
  approach.found = found;
  goal.step = { action: 'find_fortress', found, legs: state.legs }; save();
  const { options, facts } = await fortressApproaches(bot, task, goal, save, actions, state, nearest);
  let pick = approach.choice && approach.until > Date.now() && options[approach.choice] ? approach.choice : null;
  if (!pick) {
    const tree = Object.fromEntries(Object.entries(options).map(([key, o]) => [key, { description: o.description, run: o.run }]));
    const decision = await decide('fortress_approach', { client: actions.client || task.opportunityClient, bot, task, goal, save, tree, state: facts,
      context: { failed: approach.failed.map(f => f.choice) } });
    if (decision.stale) return;
    pick = decision.path.at(-1);
    approach.choice = pick; approach.until = Date.now() + APPROACH_HOLD_MS; save();
  }
  goal.step = { action: 'find_fortress', found, approach: pick, legs: state.legs }; save();
  const from = nearest.distanceTo(bot.entity.position);
  let why = null;
  try { why = await options[pick].run(); }
  catch (err) { task.check(); if (!retryable(err)) throw err; why = err.message; }
  if (pick === 'keep_searching') { delete state.approach; save(); return; }
  // Closer counts; a shuffle along the shelf does not.
  if (nearest.distanceTo(bot.entity.position) < from - 1.5) { approach.failed = []; save(); return; }
  approach.failed = [...approach.failed, { choice: pick, why: why || 'came no nearer', at: Date.now() }].slice(-8);
  delete approach.choice; delete approach.until; save();
}

// The fortress in view, as fortress_leg offers it (chooseLeg). `stay`:
// a pass over its every stretch ended, and walking them again is Jev's to
// weigh against the legs with what the passes came to; blazes come from
// their spawners and spawn on its bricks as time passes. Otherwise its
// bricks are left behind or set aside, and going back is offered with
// when and why.
function fortressInView(bot, goal, save, state, bricks, { stay }) {
  const here = bot.entity.position;
  const nearest = bricks.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  const off = Math.round(nearest.distanceTo(here));
  const blazes = (goal.mobHunt?.sightings || []).filter(s => s.dimension === bot.game?.dimension && Math.hypot(s.x - nearest.x, s.z - nearest.z) <= LEAVE_RADIUS)
    .reduce((n, s) => n + (s.seen || 1), 0);
  const seen = blazes ? `blazes seen near it ${blazes} time${blazes === 1 ? '' : 's'}` : 'no blaze seen near it yet';
  const passes = state.patrols || 0;
  const minutes = state.inFortressSince ? Math.round((Date.now() - state.inFortressSince) / 60000) : 0;
  const facts = { bricks: bricks.length, nearestBlocksOff: off, passes, minutesThere: minutes, blazesSeenNear: blazes };
  if (stay) return { key: 'stay_in_fortress', passes, facts,
    description: `Stay in the fortress the bot is in and walk its stretches again for blazes: ${bricks.length} of its bricks in view, the nearest ${off} blocks off; ${passes} pass${passes === 1 ? '' : 'es'} over every stretch in view, ${minutes} minute${minutes === 1 ? '' : 's'} there, ${seen}. Blazes come from their spawners and spawn on the fortress's bricks as time passes; the stretches out of view are found only by a leg. The legs are asked again after the next pass.`,
    run: () => { state.visited = []; save(); return 'stay'; } };
  const leftAgo = state.leaving ? Math.round((LEAVE_MS - (state.leaving.until - Date.now())) / 60000) : null;
  const why = state.leaving && Math.hypot(state.leaving.x - nearest.x, state.leaving.z - nearest.z) <= LEAVE_RADIUS
    ? `left ${leftAgo} minute${leftAgo === 1 ? '' : 's'} ago after its passes, and set behind the bot for ${Math.round((state.leaving.until - Date.now()) / 60000)} more`
    : 'set aside as a face not approached, for ten minutes';
  return { key: 'back_to_fortress', passes, facts: { ...facts, setAside: why },
    description: `Go back into the fortress in view: ${bricks.length} of its bricks, the nearest ${off} blocks off, ${why}; ${seen}. Taken, it is no longer set aside, and the way to its bricks is asked (fortress_approach), or its stretches walked when the bot is among them.`,
    run: () => {
      delete state.leaving;
      state.shunned = (state.shunned || []).filter(sh => !bricks.some(b => Math.hypot(sh.x - b.x, sh.z - b.z) <= (sh.radius || 16)));
      delete state.target; delete state.rememberedTarget; save();
      return 'fortress';
    } };
}

async function findFortressStep(bot, task, goal, save, actions) {
  const state = goal.fortressSearch ||= { axis: Math.round(bot.entity.position.x) % 2 === 0 ? 1 : -1, legs: 0 };
  if (await mineGoldInPassing(bot, task, goal, save, actions)) return;
  const stopWhen = () => goldInPassing(bot, goal);
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
  const seen = bot.findBlocks({ matching: ids, maxDistance: 128, count: 512 });
  const found = seen.filter(b => !shunned(b));
  const bricks = found.length >= FORTRESS_MIN_BRICKS ? found : [];
  // Bricks enough for a fortress, all left behind or set aside: said to
  // Jev with the next leg, going back among the ways (fortressInView),
  // said as they stand now, before a leg's end lets them be seen again.
  const setAside = !bricks.length && seen.length >= FORTRESS_MIN_BRICKS ? fortressInView(bot, goal, save, state, seen, { stay: false }) : null;
  if (bricks.length) {
    const here = bot.entity.position;
    const nearest = bricks.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    state.found = { x: nearest.x, y: nearest.y, z: nearest.z };
    if (nearest.distanceTo(here) > 6) { await approachFortress(bot, task, goal, save, actions, state, nearest); return; }
    // Inside: walk the structure. The farthest brick not yet walked to is
    // the next stretch of corridor; blazes come into view on the way and
    // the observed hunt takes them. Standing on the first brick found was
    // twenty rounds of no progress.
    state.visited ||= [];
    // Floor bricks only: two blocks of air over them and near the bot's
    // level. Aiming at a ceiling brick had the bot pillaring up to it and
    // being sent back down, twice a second.
    const clear = q => { const b = bot.blockAt(q); return !b || b.boundingBox === 'empty'; };
    const floors = bricks.filter(b => clear(b.offset(0, 1, 0)) && clear(b.offset(0, 2, 0)) && Math.abs(b.y + 1 - here.y) <= 6);
    const walkable = floors.length ? floors : bricks;
    // The nearest fresh stretch beyond twelve blocks, not the farthest: the
    // farthest brick in view is the one across the lava.
    const fresh = walkable.filter(b => !state.visited.some(v => Math.hypot(v.x - b.x, v.z - b.z) < 12));
    const byDistance = fresh.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    const next = byDistance.find(b => b.distanceTo(here) >= 12);
    // Every stretch in view walked: patrol it again, blazes spawn as time
    // passes and the walk brings them into view; the sweep left the
    // structure for the lava shore after one pass.
    // Nothing twelve blocks off to walk to, walked or not: this is not a
    // stretch of fortress to patrol but a few bricks (the bot's own pocket
    // walls, often) or a corner seen through rock. Patrolling it was a
    // return that did nothing, six times over, then a fresh leg that the
    // next look undid: twenty seconds still, again and again. It is shunned
    // like an unapproachable face, and the sweep goes on.
    if (!next && !walkable.some(b => b.distanceTo(here) >= 12)) {
      state.shunned.push({ x: nearest.x, z: nearest.z, until: Date.now() + 600000 }); delete state.found; state.patrols = 0; delete state.inFortressSince; save();
    }
    else if (!next) {
      // A pass ended: staying for another or leaving on a leg is Jev's
      // (fortress_leg, stay_in_fortress), with the passes and minutes it
      // came to. Six passes counted by the code were six ticks: mid-235-p
      // left its fortress 0.4 seconds after the first, not a step walked
      // (note 507).
      state.patrols = (state.patrols || 0) + 1; state.inFortressSince ||= Date.now();
      if (!(state.patrolSaidAt > Date.now() - 120000)) { state.patrolSaidAt = Date.now(); bot.chat?.('Walked this stretch. Patrolling the fortress for blazes.'); }
      // Along the fortress's own length, away from where it was patrolled,
      // as the outage default: fortress corridors run straight along x or z.
      const spanX = Math.max(...bricks.map(b => b.x)) - Math.min(...bricks.map(b => b.x));
      const spanZ = Math.max(...bricks.map(b => b.z)) - Math.min(...bricks.map(b => b.z));
      const mean = k => bricks.reduce((n, b) => n + b[k], 0) / bricks.length;
      state.heading = spanX >= spanZ ? (mean('x') >= here.x ? 0 : 2) : (mean('z') >= here.z ? 1 : 3);
      save();
      if (await chooseLeg(bot, task, goal, save, actions, state, fortressInView(bot, goal, save, state, bricks, { stay: true })) !== true) return;
      state.leaving = { x: Math.round(here.x), z: Math.round(here.z), until: Date.now() + LEAVE_MS };
      state.patrols = 0; delete state.inFortressSince; delete state.target; state.visited = [];
      beginLeg(state, here); save();
      return;
    }
    else {
    state.visited.push({ x: next.x, y: next.y, z: next.z }); state.visited = state.visited.slice(-32); state.inFortressSince ||= Date.now();
    goal.step = { action: 'find_fortress', found: state.found, walking: { x: next.x, y: next.y, z: next.z }, legs: state.legs }; save();
    if (actions.navigate) {
      try { await actions.navigate(bot, task, new goals.GoalNear(next.x, next.y + 1, next.z, 3), { timeoutMs: 30000, stallMs: 6000, stopWhen }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; await actions.tunnel(bot, task, goal, save, next, 'fortress'); }
    } else await actions.tunnel(bot, task, goal, save, next, 'fortress');
    return;
    }
  }
  const here = bot.entity.position;
  // A fortress seen before (exploration.js remembers them) is walked back
  // to rather than swept for again.
  const remembered = require('./exploration').knownLandmarks(bot, goal, 'nether_fortress').find(k => k.distance > 24 && !shunned(k.landmark));
  if (remembered && !state.rememberedTarget) {
    state.target = { x: remembered.landmark.x, y: remembered.landmark.y, z: remembered.landmark.z }; state.rememberedTarget = true; state.legSince = Date.now();
  }
  if (!state.target || Math.hypot(state.target.x - here.x, state.target.z - here.z) < 8) {
    // A leg walked to its end: whatever was left behind may be seen again,
    // and that heading's failure is history.
    if (state.target && !state.rememberedTarget) delete state.leaving;
    if (state.target && Number.isInteger(state.lastHeading) && state.legHistory) { delete state.legHistory[legKey(state.lastHeading, false)]; delete state.legHistory[legKey(state.lastHeading, true)]; }
    delete state.rememberedTarget;
    // Blocks Jev chose to mine before the next leg, until they are carried.
    if (state.restock && actions.acquireStep && await restockStep(bot, task, goal, save, actions, state)) return;
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
  if (seeking) {
    try { await actions.tunnel(bot, task, goal, save, leg, 'fortress'); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; state.lastLegError = err.message; }
    if (gained() || Math.abs(bot.entity.position.y - FORTRESS_Y) < Math.abs(here.y - FORTRESS_Y) - 0.5) { state.legFails = 0; return; }
  }
  // The pathfinder first: it walks open ground, bridges and climbs where a
  // staircase can only dig. The tunnel takes over where it finds no way.
  if (actions.navigate && !seeking) {
    try { await actions.navigate(bot, task, new goals.GoalNearXZ(leg.x, leg.z, 6), { timeoutMs: 30000, stallMs: 8000, stopWhen }); }
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
  legEnded(state, state.lastLegError || state.lastCrossStop, seeking);
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
  if (!state || !bot?.entity?.position || countOf(bot, state.item) >= state.targetCount) return null;
  const handler = handlers[state.entity] || {};
  if (!canBegin(bot, handler)) return null;
  const near = Object.values(bot.entities || {}).filter(e => e.name === state.entity && valid(bot, e) && e.position.distanceTo(bot.entity.position) < 24)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 4);
  const target = near.find(e => isolated(bot, e, handler) && !isSetAside(goal, 'hunt_target', e.uuid || e.id));
  if (!target) return null;
  return { layer: 'hunt', action: 'hunt', urgency: 'routine', facts: { entity: target.name, distance: Math.round(target.position.distanceTo(bot.entity.position) * 10) / 10,
    item: state.item, have: countOf(bot, state.item), want: state.targetCount, health: bot.health } };
}

module.exports = { claim, stakeHunt, prepareCombatGear, combatMovement, canBegin, fitness, fitnessSays, isolated, fightForDrop, huntObserved, prepareMobHunt, findFortressStep, fortressLegTarget, turnSweep, chooseLeg, FORTRESS_Y, HEADING_NAMES, rememberSighting, rememberedSpot, approaches, combatRoute, FORTRESS_LEG };
