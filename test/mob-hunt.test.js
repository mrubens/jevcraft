'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { planCatalog, knowledge } = require('../src/knowledge');
const { combatGear, armorSlots, readyEquipment, handlers } = require('../src/mob-policy');
const { combatTarget, checkThreats, safeFromHostiles, hostileEntities } = require('../src/danger');
const { prepareCombatGear, fightForDrop, huntObserved, prepareMobHunt, isolated } = require('../src/mob-hunt');

function fixture(name = 'blaze') {
  const slots = Array(46).fill(null), task = new Task('hunt');
  const target = { id: 7, uuid: 'original-target', name, position: new Vec3(2, 64, .5),
    width: .6, height: name === 'enderman' ? 2.9 : 1.8, isValid: true };
  const attacks = [], controls = [], movement = { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: name === 'blaze' ? 'the_nether' : 'overworld', gameMode: 'survival', difficulty: 'normal' },
    time: { timeOfDay: 6000 },
    health: 20, food: 20, oxygenLevel: 20, entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: target },
    inventory: { slots, items: () => slots.slice(9, 45).filter(Boolean) },
    world: { raycast: () => null }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    pathfinder: { movements: movement, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
    clearControlStates: () => {}, lookAt: async () => {},
    activateItem: offHand => controls.push(['raise', offHand]), deactivateItem: () => controls.push(['lower']),
    equip: async (item, destination) => {
      const to = destination === 'hand' ? 36 : armorSlots[destination];
      const old = slots[to], from = item.slot;
      slots[to] = { ...item, slot: to }; slots[from] = old && { ...old, slot: from };
    },
    attack: entity => attacks.push(entity),
  });
  Object.defineProperty(bot, 'heldItem', { get: () => slots[36] });
  for (const [destination, names] of Object.entries(combatGear)) {
    const slot = destination === 'hand' ? 36 : armorSlots[destination];
    slots[slot] = { name: names[0], count: 1, type: registry.itemsByName[names[0]].id, slot, durabilityUsed: 0 };
  }
  const goal = { request: `Jev get me ${handlers[name].item.replaceAll('_', ' ')}`,
    mobHunt: { entity: name, item: handlers[name].item, targetCount: 1 } };
  return { bot, task, target, goal, slots, attacks, controls, movement };
}

test('the exact supported vanilla mob loot tables extend the Eyes of Ender recipe graph', () => {
  const sources = knowledge(registry).mobSources;
  assert.equal(sources.blaze_rod[0].entity, 'blaze'); assert(sources.blaze_rod[0].requiresPlayerKill);
  assert.equal(sources.ender_pearl[0].entity, 'enderman'); assert(sources.ender_pearl[0].randomDrop);
  const equipment = Object.values(combatGear).map(names => names[0]);
  const plan = planCatalog(registry, 'ender_eye', 16, {}, { equipment });
  const hunts = plan.filter(s => s.action === 'hunt_mob');
  assert.deepEqual(hunts.map(s => [s.entity, s.count]).sort(), [['blaze', 8], ['enderman', 16]]);
  assert.equal(plan.at(-1).item, 'ender_eye'); assert.equal(plan.at(-1).count, 16);
  assert(!plan.some(s => /sword|helmet|chestplate|leggings|boots|shield/.test(s.item || '')), 'Equipped gear is not crafted again');
  const missing = planCatalog(registry, 'blaze_rod', 1, { iron_ingot: 40, oak_planks: 30, stick: 8, crafting_table: 1 });
  for (const item of equipment) assert(missing.some(s => s.action === 'craft' && s.item === item), item);
  assert.throws(() => planCatalog(registry, 'bedrock', 1), /No supported survival acquisition/);
});

test('string comes from a spider and arrows from skeletons (never a chicken), so a bow and arrows plan without a cobweb or a tripwire', () => {
  const sources = knowledge(registry).mobSources;
  assert.equal(sources.string[0].entity, 'spider'); assert(!sources.string[0].requiresPlayerKill, 'string drops however the spider dies');
  assert.equal(sources.feather, undefined, 'no chicken is hunted for feathers (the user, 2026-09-25)');
  assert.equal(sources.arrow[0].entity, 'skeleton');
  assert(!knowledge(registry).sources.string.some(s => s.block === 'tripwire'), 'tripwire is placed string, never a deposit');
  const bow = planCatalog(registry, 'bow', 1, { stick: 3, crafting_table: 1 });
  assert.deepEqual(bow.map(s => [s.action, s.entity || s.item, s.count]).slice(-2), [['hunt_mob', 'spider', 3], ['craft', 'bow', 1]]);
  assert(bow.some(s => s.action === 'craft' && s.item === 'iron_sword'), 'a spider fights back, so the hunt still wants the kit');
  const seen = planCatalog(registry, 'bow', 1, { stick: 3, crafting_table: 1 }, { nearby: ['cobweb'] });
  assert(seen.some(s => s.action === 'mine' && s.block === 'cobweb') && !seen.some(s => s.action === 'hunt_mob'), 'a cobweb in view beats the hunt');
  const arrows = planCatalog(registry, 'arrow', 16, { stick: 4, crafting_table: 1 });
  assert.deepEqual(arrows.filter(s => s.action === 'hunt_mob').map(s => s.entity), ['skeleton']);
  assert(!arrows.some(s => s.entity === 'chicken'));
});

test('a chicken or a pig is never struck: the swing is refused, and a sword swing that would sweep one is refused too', () => {
  // The user, 2026-09-25: "never hurt a chicken", "or a pig".
  const { installGuard } = require('../src/protected-animals');
  const { Vec3 } = require('vec3');
  const struck = [];
  const bot = { entity: { position: new Vec3(0, 64, 0), onGround: true }, heldItem: { name: 'iron_sword' }, controlState: {}, entities: {}, attack: t => struck.push(t.name) };
  const chicken = { id: 1, name: 'chicken', position: new Vec3(1.5, 64, 0), isValid: true }, pig = { id: 2, name: 'pig', position: new Vec3(0, 64, 1.5), isValid: true };
  const zombie = { id: 3, name: 'zombie', position: new Vec3(2, 64, 0), isValid: true };
  bot.entities = { 1: chicken, 2: pig, 3: zombie };
  installGuard(bot);
  assert.throws(() => bot.attack(chicken), { name: 'ProtectedAnimal' });
  assert.throws(() => bot.attack(pig), { name: 'ProtectedAnimal' });
  assert.throws(() => bot.attack(zombie), /sweep/, 'the chicken beside the zombie would be swept');
  bot.heldItem = { name: 'iron_axe' };
  bot.attack(zombie);
  assert.deepEqual(struck, ['zombie'], 'an axe does not sweep');
  bot.heldItem = { name: 'iron_sword' }; bot.entity.onGround = false;
  bot.attack(zombie);
  assert.deepEqual(struck, ['zombie', 'zombie'], 'a falling (critical) hit does not sweep');
});

test('two blazes off one spawner are each a fight: the crowd rule counts kin, the sweep rule counts other kinds', () => {
  const { bot, target } = fixture('blaze');
  bot.health = 20;
  bot.entities[21] = { id: 21, name: 'blaze', position: target.position.offset(1.5, 0.5, 0), width: .6, height: 1.8, isValid: true };
  assert(isolated(bot, target), 'another blaze beside it does not make it unfightable');
  bot.entities[22] = { id: 22, name: 'wither_skeleton', position: target.position.offset(-1, 0, 1), width: .7, height: 2.4, isValid: true };
  assert(!isolated(bot, target), 'a mob of another kind beside it still does');
});

test('combat preparation verifies equipment slots and replaces worn gear instead of counting it as ready', async () => {
  const { bot, slots, goal, task } = fixture();
  slots[6].durabilityUsed = registry.itemsByName.iron_chestplate.maxDurability - 1;
  const requests = [], actions = { acquireStep: async (_b, _t, item, count) => requests.push({ item, count }) };
  assert.equal(await prepareCombatGear(bot, task, goal, () => {}, actions), false);
  assert.deepEqual(requests, [{ item: 'iron_chestplate', count: 1 }]);
  slots[9] = { name: 'iron_chestplate', slot: 9, count: 1, durabilityUsed: 0 };
  assert(await prepareCombatGear(bot, task, goal, () => {}, actions)); assert(readyEquipment(bot));
  assert.equal(slots[6].durabilityUsed, 0); assert(slots[9].durabilityUsed > 0, 'The worn piece is retained');
  slots[10] = { ...slots[6], slot: 10 }; slots[6] = null;
  bot.equip = async () => {};
  await assert.rejects(prepareCombatGear(bot, task, goal, () => {}, actions), /Server did not confirm/);
});

test('combat movement excludes only the selected live target and never persists after cancel, low health or expiry', () => {
  const { bot, task, target } = fixture();
  assert.throws(() => checkThreats(bot), { name: 'NeedsSafety' });
  bot._combatEncounter = { task, target, dimension: bot.game.dimension, expiresAt: Date.now() + 30000 };
  assert(combatTarget(bot, target)); assert.doesNotThrow(() => checkThreats(bot));
  assert(safeFromHostiles(bot, target.position));
  // Another of the hunted kind never ends the fight (the hunt's crowd rule
  // decides); a mob of another kind at four blocks does.
  const kin = { ...target, id: 9, position: new Vec3(4, 64, .5) }; bot.entities[9] = kin;
  assert.doesNotThrow(() => checkThreats(bot)); delete bot.entities[9];
  const other = { ...target, id: 8, name: 'wither_skeleton', position: new Vec3(4, 64, .5) }; bot.entities[8] = other;
  assert.throws(() => checkThreats(bot), { name: 'NeedsSafety' }); assert(!safeFromHostiles(bot, other.position)); delete bot.entities[8];
  bot.health = 11; assert(!combatTarget(bot, target)); bot.health = 20;
  task.cancel(); assert(!combatTarget(bot, target)); task.cancelled = false;
  bot._combatEncounter.expiresAt = 0; assert(!combatTarget(bot, target)); bot._combatEncounter.expiresAt = Date.now() + 10000;
  bot.game.dimension = 'overworld'; assert(!combatTarget(bot, target)); bot.game.dimension = 'the_nether';
  bot.entities[target.id] = { ...target }; assert(!combatTarget(bot, target), 'An entity ID reused after a reload is not authorized');
});

test('a dead mob without a drop cannot satisfy the requested inventory quantity', async () => {
  const { bot, task, target, goal, movement, controls } = fixture();
  const original = { ...movement };
  bot.attack = entity => { bot.emit('entityDead', entity); delete bot.entities[entity.id]; };
  const result = await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => assert.fail('No drops to approach') });
  assert.equal(result.outcome, 'no_pickup'); assert.equal(result.pickedUp, 0); assert(result.deathObserved);
  assert.equal(goal.mobHunt.targetCount, 1); assert.equal(bot.inventory.items().filter(i => i.name === 'blaze_rod').length, 0);
  assert.deepEqual(movement, { ...original, allowedPosition: undefined });
  assert.equal(bot._combatEncounter, undefined); assert.equal(task.interruptCheck, undefined); assert.equal(bot.listenerCount('entityDead'), 0);
  assert.deepEqual(controls, [['raise', true], ['lower']]);
});

test('drop collection counts server inventory changes and clears the pending hunt only after pickup', async () => {
  const { bot, task, target, goal, slots } = fixture();
  bot.attack = entity => {
    bot.emit('entityDead', entity); delete bot.entities[entity.id];
    bot.entities[8] = { id: 8, name: 'item', position: target.position.clone(), getDroppedItem: () => ({ name: 'blaze_rod', count: 1 }) };
  };
  const result = await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {
    slots[9] = { name: 'blaze_rod', count: 1, slot: 9 }; delete bot.entities[8];
  } });
  assert.equal(result.pickedUp, 1); assert.equal(result.outcome, 'pickup_confirmed');
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}), false); assert.equal(goal.mobHunt, undefined);
});

test('a delayed falling drop is reobserved before deciding that a kill produced no pickup', async () => {
  const { bot, task, target, goal, slots } = fixture(); let timer;
  bot.attack = entity => {
    bot.emit('entityDead', entity); delete bot.entities[entity.id];
    timer = setTimeout(() => {
      bot.entities[8] = { id: 8, name: 'item', position: target.position.clone(), getDroppedItem: () => ({ name: 'blaze_rod', count: 1 }) };
    }, 600);
  };
  try {
    const result = await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {
      slots[9] = { name: 'blaze_rod', count: 1, slot: 9 }; delete bot.entities[8];
    } });
    assert.equal(result.pickedUp, 1); assert.equal(result.outcome, 'pickup_confirmed');
  } finally { clearTimeout(timer); }
});

test('losing a target is not proof of death or loot; a provoked enderman remains a threat after combat ends', async () => {
  const { bot, task, target, goal } = fixture('enderman');
  assert.equal(hostileEntities(bot).length, 0, 'Neutral Endermen are not attacked during unrelated work');
  bot.attack = entity => { entity.isValid = false; };
  await assert.rejects(fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {} }), /disappeared without/);
  assert.equal(goal.mobHunt.history[0].outcome, 'target_lost');
  target.isValid = true;
  assert.equal(hostileEntities(bot)[0], target); assert.throws(() => checkThreats(bot), { name: 'NeedsSafety' });
  assert.equal(bot._combatEncounter, undefined);
});

test('cancellation during a fight interrupts the cooldown and restores movement, shield and threat policy', async () => {
  const { bot, task, target, goal, attacks, controls } = fixture();
  bot.attack = entity => { attacks.push(entity); task.cancel(); };
  await assert.rejects(fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {} }), { name: 'Cancelled' });
  assert.equal(attacks.length, 1); assert.equal(controls.at(-1)[0], 'lower');
  assert.equal(bot._combatEncounter, undefined); assert.equal(bot.pathfinder.movements.canDig, true);
});

test('shield guarding keeps facing a moving target and waits for the sword cooldown after observed shield damage', async () => {
  const { bot, task, target, goal, slots } = fixture(); const attacks = [], looks = [], timers = [];
  bot.lookAt = async p => looks.push({ at: Date.now(), x: p.x });
  bot.attack = entity => {
    attacks.push(Date.now());
    if (attacks.length === 1) {
      timers.push(setTimeout(() => { target.position.x += .4; }, 100));
      timers.push(setTimeout(() => { slots[45].durabilityUsed += 7; }, 250));
    } else { bot.emit('entityDead', entity); delete bot.entities[entity.id]; }
  };
  try {
    const result = await fightForDrop(bot, task, target, goal, () => {}, {}, { pickupWaitMs: 1 });
    assert.equal(attacks.length, 2); assert(attacks[1] - attacks[0] >= 650);
    assert(looks.some(p => p.x === 2.4 && p.at < attacks[1] - 100), 'Track the new facing while the shield is still raised');
    assert.equal(result.shieldWear, 7);
  } finally { timers.forEach(clearTimeout); }
});

test('a dead mob still playing its death animation does not block the next encounter', async () => {
  const { bot, task, target, goal } = fixture();
  bot.attack = entity => bot.emit('entityDead', entity); // The server removes it after its animation.
  const result = await fightForDrop(bot, task, target, goal, () => {}, {});
  assert(result.deathObserved); assert.equal(hostileEntities(bot).length, 0);
  const enderman = { ...target, id: 8, name: 'enderman', position: target.position.offset(1, 0, 0) };
  bot.entities[8] = enderman;
  assert(isolated(bot, enderman));
  const other = { ...target, id: 9, metadata: { 9: 0 } }; bot.entities[9] = other;
  assert.equal(hostileEntities(bot).length, 0); assert(isolated(bot, enderman));
});

test('peaceful difficulty is an explicit blocker without using commands to change it', async () => {
  const { bot, task, goal } = fixture(); bot.game.difficulty = 'peaceful';
  await assert.rejects(prepareMobHunt(bot, task, { entity: 'blaze', item: 'blaze_rod', count: 1 }, goal, () => {}, {}), /does not spawn in Peaceful/);
});

test('Jev selects a feasible observed target; stale model decisions cannot start combat', async () => {
  const { bot, task, target, goal } = fixture(); let modelCalls = 0, attacks = 0;
  bot.attack = () => attacks++;
  const client = { systemOne: async ({ state, questions }) => {
    modelCalls++; assert.equal(state.resource, 'blaze_rod');
    assert(questions.branch_0.criteria.hunt_7); assert(questions.branch_0.criteria.defer);
    // The decision audit: the one fight's cost is on the option, the risk in the state.
    assert(questions.branch_0.criteria.hunt_7.fight.hitsBot > 0 && questions.branch_0.criteria.hunt_7.fight.seconds > 0, JSON.stringify(questions.branch_0.criteria.hunt_7)); assert(state.riskNow);
    target.position.x += 5;
    return { answers: { branch_0: { choice: 'hunt_7' } } };
  } };
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}, client), false);
  assert.equal(modelCalls, 1); assert.equal(attacks, 0); assert(goal.decisions.at(-1).stale);
  assert.equal(bot._combatEncounter, undefined);
});

test('a blaze in view at range is shot with the carried bow, and the sword is back in hand for the finish', async () => {
  const { bot, task, target, goal, slots, attacks } = fixture('blaze');
  target.position = new Vec3(10.5, 64, .5);
  slots[10] = { name: 'bow', count: 1, slot: 10, durabilityUsed: 0 }; slots[11] = { name: 'arrow', count: 16, slot: 11 };
  const events = []; bot.quickBarSlot = 0; bot.setQuickBarSlot = () => {};
  bot.look = async (yaw, pitch) => { bot.lastSentRotation = { yaw: (Math.PI - yaw) * 180 / Math.PI, pitch: -pitch * 180 / Math.PI }; };
  bot.activateItem = offHand => events.push(offHand ? 'raise shield' : 'draw');
  bot.deactivateItem = () => {
    const drawing = events.at(-1) === 'draw';
    events.push(drawing ? 'release' : 'lower shield');
    if (!drawing) return;
    slots[11].count--; bot.emit('entitySpawn', { id: 20, name: 'arrow', position: bot.entity.position.offset(0, 1.52, 0), velocity: new Vec3(3, 0, 0) });
    target.position = new Vec3(2, 64, .5); // The arrow lands; the blaze closes.
  };
  bot.attack = entity => { events.push(`attack with ${bot.heldItem.name}`); attacks.push(entity); bot.emit('entityDead', entity); delete bot.entities[entity.id]; };
  const result = await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => assert.fail('the arrow reaches; no walk needed') }, { pickupWaitMs: 1 });
  assert.equal(result.shots, 1); assert.equal(result.attacks, 1); assert.equal(slots[11].count, 15);
  assert.deepEqual(events.slice(0, 4), ['draw', 'release', 'attack with iron_sword', 'raise shield']);
  assert.equal(bot.heldItem.name, 'iron_sword'); assert.equal(bot._combatEncounter, undefined);
});

test('golden boots go on in the Nether and come off for iron in the Overworld', async () => {
  const { bot, slots, goal, task } = fixture('blaze');
  slots[8] = { name: 'iron_boots', slot: 8, count: 1, durabilityUsed: 0 };
  slots[20] = { name: 'golden_boots', slot: 20, count: 1, durabilityUsed: 0 };
  const actions = { acquireStep: async () => assert.fail('nothing to acquire') };
  assert(await prepareCombatGear(bot, task, goal, () => {}, actions));
  assert.equal(slots[8].name, 'golden_boots', 'gold on the feet where the piglins are');
  bot.game.dimension = 'overworld';
  assert(await prepareCombatGear(bot, task, goal, () => {}, actions));
  assert.equal(slots[8].name, 'iron_boots', 'the better boots back on at home');
});

test('a hunt stalks a mob already in view instead of exploring, and sets it aside after a minute out of reach', async () => {
  const { bot, goal, task } = fixture('spider');
  bot.game.dimension = 'overworld'; bot.game.minY = 0; bot.game.height = 256;
  bot.inventory.slots[36] = { name: 'iron_sword', slot: 36, count: 1, durabilityUsed: 0 };
  for (const [slot, name] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) bot.inventory.slots[slot] = { name, slot, count: 1, durabilityUsed: 0 };
  const explored = [];
  const actions = { acquireStep: async () => {}, explore: async (_b, _t, _g, _s, entity) => explored.push(entity) };
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, actions);
  assert.deepEqual(explored, [], 'a spider two blocks away is stalked, not searched for');
  assert.equal(goal.step.action, 'stalk_mob'); assert(goal.mobHunt.stalking);
  // Three quarters of a minute with no step closer, as the supervisor keeps it.
  const holder = goal.survival || goal;
  holder.progress['hunt_target:original-target'].bestAt -= 46000;
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, actions);
  const { isSetAside, attemptsFor } = require('../src/progress');
  assert(isSetAside(goal, 'hunt_target', 'original-target'), 'no closer in three quarters of a minute and it is set aside');
  assert.match(attemptsFor(goal).why('hunt_target', 'original-target'), /no closer/);
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, actions);
  assert.deepEqual(explored, ['spider'], 'with the only spider set aside, the hunt explores');
});

test('a piglin leaves a player in gold alone; a brute does not, and a hit ends the truce', () => {
  const { hostileEntities } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const piglin = { id: 1, name: 'piglin', position: new Vec3(8, 64, 0), isValid: true }, brute = { id: 2, name: 'piglin_brute', position: new Vec3(8, 64, 2), isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: piglin, 2: brute }, time: { timeOfDay: 6000 }, inventory: { slots: { 8: { name: 'golden_boots' } } } };
  assert.deepEqual(hostileEntities(bot).map(e => e.name), ['piglin_brute']);
  bot.inventory.slots[8] = { name: 'iron_boots' };
  assert.deepEqual(hostileEntities(bot).map(e => e.name).sort(), ['piglin', 'piglin_brute']);
  bot.inventory.slots[8] = { name: 'golden_boots' }; bot._recentHurtAt = Date.now();
  assert.deepEqual(hostileEntities(bot).map(e => e.name), ['piglin_brute'], 'a blaze\'s fire is not a piglin\'s hit');
  bot._hurtBy = { piglin: Date.now() };
  assert.deepEqual(hostileEntities(bot).map(e => e.name).sort(), ['piglin', 'piglin_brute'], 'a hit ends the truce');
});

test('a zombified piglin is left alone until one of them hurts the bot, and then the whole group is a threat', () => {
  const { hostileEntities } = require('../src/danger');
  const { Vec3 } = require('vec3');
  const a = { id: 1, name: 'zombified_piglin', position: new Vec3(6, 64, 0), isValid: true }, b = { id: 2, name: 'zombified_piglin', position: new Vec3(9, 64, 3), isValid: true };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 1: a, 2: b }, time: { timeOfDay: 6000 }, inventory: { slots: {} } };
  assert.deepEqual(hostileEntities(bot), []);
  bot._hurtBy = { zombified_piglin: Date.now() };
  assert.equal(hostileEntities(bot).length, 2, 'one hit angers every one in range');
  bot._hurtBy = { zombified_piglin: Date.now() - 60000 };
  assert.deepEqual(hostileEntities(bot), [], 'and the anger wears off');
});

test('the shooter list is one list: a crossbow piglin and a witch both shoot, a wither skeleton does not', () => {
  const { shooter } = require('../src/mob-policy');
  const combat = require('../src/combat');
  assert(shooter({ name: 'witch' }) && shooter({ name: 'blaze' }));
  assert(shooter({ name: 'piglin', heldItem: { name: 'crossbow' } }) && !shooter({ name: 'piglin', heldItem: { name: 'golden_sword' } }));
  assert(!shooter({ name: 'wither_skeleton' }));
  assert.equal(combat.shooter, shooter, 'combat hands out the same rule');
});

test('a drop to a fight is only as deep as the bot can take and still arrive fit to fight', () => {
  const { allowedDrop } = require('../src/descent');
  assert.equal(allowedDrop({ health: 20 }), 9);
  assert.equal(allowedDrop({ health: 20 }, 14), 9, 'whole, nine blocks costs six and lands at fourteen');
  assert.equal(allowedDrop({ health: 16 }, 14), 5, 'at sixteen, a nine-block drop would land at ten');
  assert.equal(allowedDrop({ health: 14 }, 14), 3, 'at the floor, only a drop that costs nothing');
});

test('a drop never lands beside lava', () => {
  const { landing } = require('../src/descent');
  const { Vec3 } = require('vec3');
  const lavaAt = new Vec3(1, 60, 0);
  const bot = { health: 20, blockAt: p => p.y === 59 ? { name: 'netherrack', boundingBox: 'block', position: p } :
    p.equals(lavaAt) ? { name: 'lava', boundingBox: 'empty', position: p } : { name: 'air', boundingBox: 'empty', position: p } };
  assert.equal(landing(bot, new Vec3(0, 64, 0)), null, 'lava beside the landing cell');
  lavaAt.x = 40;
  assert.equal(landing(bot, new Vec3(0, 64, 0)).fall, 4);
});

test('the fortress sweep runs in ninety-six-block legs along x at a safe height, and turns for bricks in view', async () => {
  const { fortressLegTarget, findFortressStep, FORTRESS_LEG } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const leg = fortressLegTarget({ axis: -1 }, new Vec3(10.5, 31, 5.5));
  assert.deepEqual([leg.x, leg.y, leg.z], [Math.round(10.5 - FORTRESS_LEG), 40, 6]);
  const tunnels = [];
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5) }, findBlocks: () => [] };
  const goal = {};
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target, resource) => tunnels.push([target.x, target.z, resource]) });
  assert.equal(goal.fortressSearch.legs, 1); assert(Math.abs(tunnels[0][0]) >= FORTRESS_LEG - 1, 'a full leg along x'); assert.equal(tunnels[0][2], 'fortress');
  // Three bricks are the bot's own building blocks, not a fortress: the sweep goes on.
  bot.findBlocks = () => [new Vec3(3, 64, 1), new Vec3(3, 65, 1), new Vec3(4, 64, 1)];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target, resource) => tunnels.push([target.x, target.z, resource]) });
  assert.equal(goal.fortressSearch.found, undefined, 'a handful of bricks is not a fortress');
  assert.equal(goal.fortressSearch.legs, 1, 'and the leg in hand is kept');
  tunnels.length = 1;
  bot.findBlocks = () => [new Vec3(30, 64, 12), ...Array.from({ length: 30 }, (_, i) => new Vec3(40 + i, 64, 12))];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target) => tunnels.push([target.x, target.z, 'bricks']) });
  assert.deepEqual(tunnels[1], [30, 12, 'bricks']); assert.deepEqual(goal.fortressSearch.found, { x: 30, y: 64, z: 12 });
});

test('the sweep turns a quarter round the compass when a direction gives no ground', () => {
  const { fortressLegTarget, turnSweep, FORTRESS_LEG } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const state = { axis: 1, legFails: 4, target: { x: 1 } };
  turnSweep(state);
  assert.equal(state.legFails, 0); assert.equal(state.target, undefined);
  const leg = fortressLegTarget(state, new Vec3(0, 64, 0));
  assert.deepEqual([leg.x, leg.z], [0, FORTRESS_LEG], 'east was blocked: the next leg runs south');
  turnSweep(state); turnSweep(state);
  assert.deepEqual([fortressLegTarget(state, new Vec3(0, 64, 0)).x, fortressLegTarget(state, new Vec3(0, 64, 0)).z], [0, -FORTRESS_LEG]);
});

test('a fortress roof under a shelf is reached by digging straight down, never over lava or a long drop', async () => {
  const { descendTo } = require('../src/descent');
  const { Vec3 } = require('vec3');
  const solid = name => ({ name, boundingBox: 'block', diggable: true, digTime: () => 1000 });
  const air = { name: 'air', boundingBox: 'empty' };
  const column = {};
  // Shelf at 64 (feet 65), cave 61-63, fortress roof at 60.
  for (let y = 40; y <= 70; y++) column[y] = y === 64 ? solid('netherrack') : y === 60 ? solid('nether_bricks') : air;
  const bot = {
    health: 20, entity: { position: new Vec3(0.5, 65, 0.5) },
    blockAt: p => column[p.y] ? { ...column[p.y], position: p } : null,
    inventory: { items: () => [] },
    dig: async block => { column[block.position.y] = air; let y = block.position.y - 1; while (column[y] && column[y].boundingBox === 'empty') y--; bot.entity.position = new Vec3(0.5, y + 1, 0.5); },
  };
  const dropped = await descendTo(bot, new Task('hunt'), new Vec3(0, 60, 0));
  assert.equal(bot.entity.position.y, 61); assert.equal(dropped, 4);
  // Lava under the shelf: refused.
  column[64] = solid('netherrack'); column[62] = { name: 'lava', boundingBox: 'empty', diggable: false }; bot.entity.position = new Vec3(0.5, 65, 0.5);
  await assert.rejects(descendTo(bot, new Task('hunt'), new Vec3(0, 50, 0)), /too deep or ends in lava/);
  assert.equal(column[64].name, 'netherrack', 'the shelf stays whole');
  // A twelve-block drop: refused too; and hurt, even seven is too far.
  for (let y = 50; y <= 63; y++) column[y] = air;
  await assert.rejects(descendTo(bot, new Task('hunt'), new Vec3(0, 40, 0)), /too deep/);
  column[57] = solid('nether_bricks'); bot.health = 12;
  await assert.rejects(descendTo(bot, new Task('hunt'), new Vec3(0, 57, 0)), /too deep/);
  bot.health = 20;
  assert.equal(await descendTo(bot, new Task('hunt'), new Vec3(0, 57, 0)), 7, 'at full health the seven-block drop onto the fortress roof is taken');
});

test('a span is laid one block ahead at a time toward a fortress across open air, and stops beside it', async () => {
  const { bridgeTo } = require('../src/bridging');
  const { Vec3 } = require('vec3');
  const blocks = new Map([[`${new Vec3(0, 64, 0)}`, 'netherrack']]);
  const at = p => ({ name: blocks.get(`${p}`) || 'air', boundingBox: blocks.has(`${p}`) ? 'block' : 'empty', diggable: true, position: p, digTime: () => 500 });
  let look = null; const placed = [];
  const bot = {
    entity: { position: new Vec3(0.5, 65, 0.5) }, health: 20,
    inventory: { items: () => [{ name: 'netherrack', count: 20, type: 1 }] },
    blockAt: at, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { assert(controls.sneak, 'crouched while placing at the end of the span'); assert(bot._spanning, 'marked on the span while it is laid (terrain.js onSpan): no reflex swings or turns'); const p = ref.position.plus(face); blocks.set(`${p}`, 'netherrack'); placed.push([p.x, p.y, p.z]); },
    setControlState: (name, on) => { controls[name] = on; if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, 65, Math.floor(look.z) + 0.5); },
    getControlState: name => !!controls[name],
    dig: async () => {},
  };
  const controls = {};
  const laid = await bridgeTo(bot, new Task('hunt'), new Vec3(6, 64, 0));
  assert.equal(laid, 5); assert.deepEqual(placed, [[1, 64, 0], [2, 64, 0], [3, 64, 0], [4, 64, 0], [5, 64, 0]]);
  assert.equal(bot.entity.position.x, 5.5, 'standing on the last span block, beside the brick');
  assert.equal(controls.sneak, false, 'and standing up again once the span is done'); assert.equal(bot._spanning, null, 'and off it');
  // A blaze that can see the bot: no span is laid in the open under fire.
  bot.entities = { 9: { id: 9, name: 'blaze', position: new Vec3(12.5, 68, 0.5), isValid: true, height: 1.8 } };
  bot.world = { raycast: () => null };
  await assert.rejects(bridgeTo(bot, new Task('hunt'), new Vec3(12, 64, 0)), /Not bridging with a blaze/);
  assert.equal(placed.length, 5, 'not one more block');
});

// A Nether world as a rule: `solid(p)` names the block at p, or null for
// air. The bot walks to the cell it looks at when it holds forward.
function netherWorld(position, solid, items = [{ name: 'netherrack', count: 64, type: 1 }]) {
  const dug = new Set(), laid = new Set();
  const at = p => {
    const key = `${p}`;
    const name = laid.has(key) ? 'netherrack' : dug.has(key) ? null : solid(p);
    return { name: name || 'air', boundingBox: name && name !== 'lava' ? 'block' : 'empty', diggable: name !== 'bedrock', position: p, digTime: () => 400 };
  };
  let look = null;
  const controls = {};
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {}, world: { raycast: () => null },
    inventory: { items: () => items }, findBlocks: () => [], chat() {}, blockAt: at, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); laid.add(`${p}`); items[0].count--; },
    dig: async block => { dug.add(`${block.position}`); },
    setControlState: (name, on) => { controls[name] = on; if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.floor(bot.entity.position.y), Math.floor(look.z) + 0.5); },
    getControlState: name => !!controls[name], clearControlStates() {} };
  return { bot, dug, laid };
}

test('a crossing is surveyed cell by cell: rock to dig, air to lay blocks over, and where it must stop', () => {
  const { surveyCrossing } = require('../src/bridging');
  // Netherrack underfoot to x 4, a wall of it at x 3 and 4, then open air over the lava sea.
  const rock = p => p.y <= 40 ? 'lava' : (p.y === 64 && p.x <= 4) || (p.x >= 3 && p.x <= 4 && p.y <= 66 && p.y >= 65) ? 'netherrack' : null;
  const { bot } = netherWorld(new Vec3(0.5, 65, 0.5), rock, [{ name: 'netherrack', count: 3, type: 1 }]);
  const s = surveyCrossing(bot, new Vec3(40, 65, 0));
  assert.deepEqual([s.cells, s.dig, s.bridge, s.overLava], [7, 4, 3, 3], JSON.stringify(s));
  assert.match(s.stoppedBy, /out of blocks \(3 carried\)/);
  assert.equal(s.gain, 7);
  // Lava behind the rock: the dig stops short of it, as the staircase's does.
  const behind = p => p.x === 4 && p.y === 65 && p.z === 1 ? 'lava' : rock(p);
  const { bot: b2 } = netherWorld(new Vec3(0.5, 65, 0.5), behind);
  const s2 = surveyCrossing(b2, new Vec3(40, 65, 0));
  assert.equal(s2.cells, 3); assert.match(s2.stoppedBy, /lava or water behind the netherrack/);
});

test('a span never digs into rock with lava behind it, nor walks into lava', async () => {
  const { bridgeTo } = require('../src/bridging');
  const rock = p => (p.x === 2 && p.y === 65 && p.z === 1) ? 'lava' : p.y === 64 || (p.x === 2 && p.y >= 65 && p.y <= 66) ? 'netherrack' : null;
  const { bot, dug } = netherWorld(new Vec3(0.5, 65, 0.5), rock);
  await assert.rejects(bridgeTo(bot, new Task('cross'), new Vec3(10, 65, 0)), /Lava or water behind the netherrack/);
  assert.equal(dug.size, 0, 'the wall with lava behind it stands');
  const flow = p => (p.x === 2 && p.y === 65) ? 'lava' : p.y === 64 ? 'netherrack' : null;
  const { bot: b2 } = netherWorld(new Vec3(0.5, 65, 0.5), flow);
  await assert.rejects(bridgeTo(b2, new Task('cross'), new Vec3(10, 65, 0)), /Lava in the way/);
  assert(b2.entity.position.x < 2, 'not a step into it');
});

test('a Nether leg that makes no ground on foot goes on straight at this height, bridging the gap and tunnelling the wall', async () => {
  // mid-215-d stood at y 95 unable to reach its next leg's target a hundred blocks off on foot (note 251).
  const { findFortressStep } = require('../src/mob-hunt');
  const rock = p => p.y <= 31 ? 'lava' : (p.y === 94 && (p.x <= 3 || p.x >= 21)) || (p.x >= 21 && p.x <= 24 && (p.y === 95 || p.y === 96)) ? 'netherrack' : null;
  const { bot, laid, dug } = netherWorld(new Vec3(0.5, 95, 0.5), rock);
  const goal = { fortressSearch: { axis: 1, legs: 1, target: { x: 96, y: 80, z: 0 }, legSince: Date.now(), legFrom: { x: -50, z: 0 } } };
  const tunnels = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate: async () => {}, tunnel: async (b, t, g, s, target) => tunnels.push(target) });
  assert.equal(laid.size, 17, 'a block for each cell of open air, x 4 to 20');
  assert.equal(dug.size, 8, 'the wall at x 21 to 24, two high');
  assert.equal(bot.entity.position.x, 32.5, 'thirty-two blocks along, the stretch the survey saw');
  assert.equal(tunnels.length, 0, 'ground made: no staircase');
  assert.equal(goal.fortressSearch.legFails, 0);
  assert.equal(Math.round(goal.fortressSearch.legBest), 64, 'the nearest approach is kept for the leg');
});

// A fortress across the lava sea from a ledge: netherrack to x 3 at y 64,
// the fortress's bricks from x 30 along z 0, lava at y 31 and below.
function fortressAcrossLava() {
  const bricks = Array.from({ length: 25 }, (_, i) => new Vec3(30 + i, 64, 0));
  const rock = p => p.y <= 31 ? 'lava' : p.y === 64 && p.z === 0 && p.x >= 30 && p.x <= 54 ? 'nether_bricks' : p.y === 64 && p.x <= 3 ? 'netherrack' : null;
  const world = netherWorld(new Vec3(0.5, 65, 0.5), rock);
  world.bot.findBlocks = () => bricks;
  world.bot.time = { timeOfDay: 6000 };
  const hoglin = { id: 3, name: 'hoglin', type: 'hostile', position: new Vec3(-3.5, 65, 0.5), height: 1.4, width: 1.4, isValid: true };
  world.bot.entities = { 3: hoglin };
  return world;
}
// Jev as a stub: records what it was asked and answers from `picks`.
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => { asked.push({ kind, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('a fortress in view is Jev\'s to approach: each way with what it meets, the span\'s cells over lava and the hoglin in sight', async () => {
  // mid-242-c (note 264) and mid-215-e (note 273) each went into the lava sea within a second of seeing a fortress, by a way the code chose alone.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot, laid } = fortressAcrossLava();
  const client = jevStub(['cross_level']);
  const goal = { fortressSearch: { axis: 1, legs: 3, target: { x: 96, y: 65, z: 0 } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('the code walked on its own'); }, tunnel: async () => { throw new Error('the code tunnelled on its own'); } });
  assert.equal(client.asked.length, 1); assert.equal(client.asked[0].kind, 'fortress');
  const { options, state } = client.asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['cross_level', 'keep_searching', 'tunnel', 'walk_route']);
  assert.match(options.cross_level, /29 blocks, laying 26 blocks over open air and lava \(26 of them over lava\)/);
  assert.match(options.cross_level, /64 blocks carried, 38 left after/);
  assert.match(options.cross_level, /It ends 29 blocks nearer/);
  assert.match(options.cross_level, /a hoglin 4 blocks off; a hit on a one-wide span over lava is the fall/);
  assert.match(options.walk_route, /walks upright/);
  assert.deepEqual(state.threatsInView, ['hoglin 4 blocks off']);
  assert.equal(laid.size, 26, 'the span Jev chose, a block for each cell over the lava');
  assert.equal(bot.entity.position.x, 29.5);
  assert.equal(goal.fortressSearch.approach.choice, 'cross_level');
  assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
});

test('the way chosen to a fortress holds while it makes ground, and a failure is asked again with what failed', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { approachFallback } = require('../src/decisions/travel');
  const { bot } = fortressAcrossLava();
  const client = jevStub(['tunnel', 'keep_searching']);
  const goal = { fortressSearch: { axis: 1, legs: 3, target: { x: 96, y: 65, z: 0 } } };
  let tunnels = 0;
  const actions = { client, tunnel: async () => { tunnels++; if (tunnels === 1) { bot.entity.position = new Vec3(3.5, 65, 0.5); return; } throw new Error('No safe way toward (30, 64, 0): lava'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(tunnels, 2); assert.equal(client.asked.length, 1, 'held while it made ground');
  assert.equal(goal.fortressSearch.approach.choice, undefined, 'let go once it came no nearer');
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2);
  assert.match(client.asked[1].options.tunnel, /Tried on this approach once and ended no nearer: No safe way toward/);
  assert.deepEqual(client.asked[1].state.failed, ['tunnel: No safe way toward (30, 64, 0): lava']);
  assert(goal.fortressSearch.shunned.some(s => s.x === 30), 'left for now, as Jev chose');
  assert.equal(tunnels, 2);
  // Without Jev, the order the code kept, each way failed on this approach passed over.
  const children = { walk_route: {}, cross_level: {}, tunnel: {}, keep_searching: {} };
  assert.equal(approachFallback(children, [], { failed: [] }), 'walk_route');
  assert.equal(approachFallback(children, [], { failed: ['walk_route', 'cross_level'] }), 'tunnel');
  assert.equal(approachFallback(children, [], { failed: ['walk_route', 'cross_level', 'tunnel'] }), 'keep_searching');
});

test('no hunt fight is begun from a one-wide span over the lava sea', async () => {
  const { canBegin } = require('../src/mob-hunt');
  const { bot, target, goal, task, attacks } = fixture('blaze');
  assert.equal(canBegin(bot, handlers.blaze), true, 'on firm ground');
  // Netherrack one block wide along x under the feet, lava far below.
  bot.blockAt = p => { const span = p.y === 63 && Math.floor(p.z) === 0; return { name: span ? 'netherrack' : p.y < 40 ? 'lava' : 'air', boundingBox: span ? 'block' : 'empty', position: p }; };
  assert.equal(canBegin(bot, handlers.blaze), false);
  await assert.rejects(fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {} }), /no longer feasible/);
  assert.deepEqual(attacks, []);
});

test('the next leg of the fortress search is Jev\'s: each heading surveyed for open air against rock, and the fortress heights offered from high up', async () => {
  // mid-205-m (note 394): thirteen legs at y 96 to 104 straight through solid netherrack, six seconds a cell, nothing seen in fifty-one minutes.
  const { findFortressStep, FORTRESS_LEG, FORTRESS_Y } = require('../src/mob-hunt');
  const { legFallback } = require('../src/decisions/travel');
  // Solid netherrack everywhere at the standing height except a cavern to the south: open air from z 1 to 40, its floor thirty blocks down.
  const rock = p => p.y === 99 && p.z <= 0 ? 'netherrack' : (p.z >= 1 && p.z <= 40 && p.x === 0) ? (p.y < 70 ? 'netherrack' : null) : 'netherrack';
  const { bot } = netherWorld(new Vec3(0.5, 100, 0.5), rock);
  const client = jevStub(['leg_south']);
  const goal = {};
  const tunnels = [];
  const actions = { client, navigate: async () => {}, tunnel: async (b, t, g, s, target) => tunnels.push({ x: target.x, y: target.y, z: target.z }) };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 1); assert.equal(client.asked[0].kind, 'fortress');
  const { options, state } = client.asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['leg_east', 'leg_north', 'leg_south', 'leg_west', 'seek_fortress_height']);
  assert.match(options.leg_east, /Go east 96 blocks at y 100: of the 96 cells ahead, 96 of rock to dig \(about 6 seconds a cell, and nothing is seen from inside it\); about 576 seconds/);
  assert.match(options.leg_south, /40 of open air \(40 of them over a drop of four or more: a cavern or the lava sea's edge, where a fortress is seen from afar\) and 56 of rock to dig/);
  assert.match(options.seek_fortress_height, /Dig a staircase down toward y 64 heading south, 36 blocks of height/);
  assert.match(options.seek_fortress_height, /fortress corridors and bridges stand mostly between y 48 and 75/);
  assert.equal(state.height, 100); assert.equal(state.legsSoFar, 0);
  assert.equal(goal.fortressSearch.heading, 1, 'south, as Jev chose'); assert.equal(goal.fortressSearch.legMode, 'level');
  assert.deepEqual([goal.fortressSearch.target.x, goal.fortressSearch.target.z], [1, FORTRESS_LEG + 1], 'a leg south from (0.5, 0.5)');
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  // From high up, the fortress heights: the staircase alone toward y 64, no crossing at the standing height.
  const again = jevStub(['seek_fortress_height']);
  const goal2 = {};
  const steps = [];
  await findFortressStep(bot, new Task('hunt'), goal2, () => {}, { client: again, navigate: async () => steps.push('walk'), tunnel: async (b, t, g, s, target) => steps.push(['tunnel', target.y]) });
  assert.equal(goal2.fortressSearch.legMode, 'descend'); assert.equal(goal2.fortressSearch.target.y, FORTRESS_Y);
  assert.deepEqual(steps, [['tunnel', FORTRESS_Y]], 'the staircase toward the fortress heights, no walk and no level crossing');
  // Without Jev, the heading with the most open air; the compass's own at a tie.
  const children = { leg_east: {}, leg_south: {}, leg_west: {}, leg_north: {}, seek_fortress_height: {} };
  assert.equal(legFallback(children, [], { current: 'leg_east', open: { leg_east: 0, leg_south: 40, leg_west: 0, leg_north: 0 } }), 'leg_south');
  assert.equal(legFallback(children, [], { current: 'leg_west', open: { leg_east: 5, leg_south: 5, leg_west: 5, leg_north: 5 } }), 'leg_west');
  assert.equal(legFallback(children, [], { current: 'leg_west', open: { leg_east: null, leg_south: null, leg_west: null, leg_north: null } }), 'leg_west');
});

test('a leg walk that goes some way and comes back out is not ground made on the leg', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  // Flat netherrack, lava at the body's height at x 21: nothing to cross on.
  const rock = p => p.x === 21 && p.y === 95 ? 'lava' : p.y === 94 ? 'netherrack' : null;
  const { bot } = netherWorld(new Vec3(0.5, 95, 0.5), rock);
  // The leg came within sixty of its end before; this walk ends seventy-six off.
  const goal = { fortressSearch: { axis: 1, legs: 1, target: { x: 96, y: 80, z: 0 }, legSince: Date.now(), legFrom: { x: -50, z: 0 }, legBest: 60 } };
  const tunnels = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { navigate: async () => { bot.entity.position = new Vec3(20.5, 95, 0.5); }, tunnel: async (b, t, g, s, target) => tunnels.push(target) });
  assert.equal(tunnels.length, 1, 'the staircase is tried: the walk came no nearer than before');
  assert.equal(goal.fortressSearch.legFails, 1);
  assert.match(goal.fortressSearch.lastCrossStop, /lava in the way/);
});

test('a fortress whose every stretch in view was walked is patrolled again, not left for the sweep', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const clear = { boundingBox: 'empty' };
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 65, 0.5) }, chat() {},
    blockAt: () => clear, findBlocks: () => [new Vec3(2, 64, 0), new Vec3(20, 64, 0), ...Array.from({ length: 24 }, (_, i) => new Vec3(21 + i, 64, 1))] };
  const goal = { fortressSearch: { axis: 1, legs: 3, visited: [{ x: 20, y: 64, z: 0 }, { x: 40, y: 64, z: 0 }], target: { x: 96, y: 65, z: 0 } } };
  const tunnels = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target) => tunnels.push([target.x, target.z]) });
  assert.equal(tunnels.length, 0, 'no sweep leg while the fortress is in view');
  assert.equal(goal.fortressSearch.patrols, 1); assert.deepEqual(goal.fortressSearch.target, { x: 96, y: 65, z: 0 }, 'the leg target is kept for later');
  assert.equal(goal.fortressSearch.visited.length, 2);
});

test('after six empty patrols the sweep leaves along the fortress, and the section left behind does not pull it back', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const clear = { boundingBox: 'empty' };
  // A corridor along x from 0 to 44 at z 0: every stretch walked.
  const bricks = [new Vec3(2, 64, 0), new Vec3(20, 64, 0), ...Array.from({ length: 24 }, (_, i) => new Vec3(21 + i, 64, 1))];
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 65, 0.5) }, chat() {},
    blockAt: () => clear, findBlocks: () => bricks };
  const goal = { fortressSearch: { axis: 1, legs: 3, patrols: 6, visited: [{ x: 20, y: 64, z: 0 }, { x: 40, y: 64, z: 0 }] } };
  const walked = [];
  const actions = { navigate: async (b, t, g) => { walked.push([g.x, g.z]); }, tunnel: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const state = goal.fortressSearch;
  assert(state.leaving, 'the section is left behind');
  assert.equal(state.heading, 0, 'along the corridor (+x), the way the fortress runs');
  // Ninety blocks out the same bricks are still in view: the leg goes on.
  bot.entity.position = new Vec3(30.5, 65, 0.5);
  walked.length = 0;
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(goal.step.action, 'find_fortress'); assert(goal.step.target, 'a sweep leg, not the walk back to the bricks just patrolled');
  assert(!goal.step.found);
});

test('blaze sightings are remembered by place and the hunt walks back to the busiest one', () => {
  const { rememberSighting, rememberedSpot } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(-40, 65, -10) } };
  const state = {};
  rememberSighting(state, bot, { position: new Vec3(30, 77, 76) });
  rememberSighting(state, bot, { position: new Vec3(31, 77, 75) });
  rememberSighting(state, bot, { position: new Vec3(7, 53, -30) });
  assert.equal(state.sightings.length, 2, 'two blazes in one room are one place');
  const spot = rememberedSpot(state, bot);
  assert.deepEqual([spot.x, spot.y, spot.z, spot.seen], [31, 77, 75, 2], 'the room seen twice comes first');
  spot.triedAt = Date.now();
  assert.equal(rememberedSpot(state, bot).seen, 1, 'a spot just tried yields to the next');
  bot.game.dimension = 'overworld';
  assert.equal(rememberedSpot(state, bot), null, 'sightings belong to their dimension');
});

test('a swarm of blazes is fought from a bunker dug into natural rock away from them', () => {
  const { bunkerSide, swarm } = require('../src/bunker');
  const { Vec3 } = require('vec3');
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true }, air = { boundingBox: 'empty' };
  const bot = { entity: { position: new Vec3(0.5, 65, 0.5) }, game: { dimension: 'the_nether' }, world: { raycast: () => null },
    time: { timeOfDay: 6000 },
    entities: Object.fromEntries([1, 2, 3].map(i => [i, { id: i, name: 'blaze', position: new Vec3(8 + i, 66, 0.5), isValid: true, height: 1.8 }])),
    // Rock to the west only; the blazes are east.
    blockAt: p => (p.y === 64 || (p.x < 0 && p.y <= 66)) ? { ...rock, position: p } : { ...air, position: p } };
  assert(swarm(bot), 'three blazes in view are a swarm');
  const side = bunkerSide(bot, new Vec3(0, 65, 0), new Vec3(10, 66, 0));
  assert.deepEqual([side.x, side.z], [-1, 0], 'the bunker goes into the rock away from the blazes');
});

test('a hole beside the bot with a safe landing is stepped into instead of digging beside it', async () => {
  const { descendTo } = require('../src/descent');
  const { Vec3 } = require('vec3');
  const solid = name => ({ name, boundingBox: 'block', diggable: true, digTime: () => 500 });
  const air = { name: 'air', boundingBox: 'empty' };
  // Bot on netherrack at x=-40 over a void; the shaft at x=-39 drops seven onto bricks.
  const at = p => { const b = (p.x === -40 && p.y === 64) ? solid('netherrack') : (p.x === -39 && p.y === 57) ? solid('nether_bricks') : air; return { ...b, position: p }; };
  let look = null;
  const bot = { health: 20, entity: { position: new Vec3(-39.5, 65, -12.5) }, blockAt: at, inventory: { items: () => [] }, lookAt: async p => { look = p; },
    setControlState: (name, on) => { if (name === 'forward' && on) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, 58, Math.floor(look.z) + 0.5); },
    dig: async () => { throw new Error('should not dig'); } };
  const dropped = await descendTo(bot, new Task('hunt'), new Vec3(-39, 57, -13));
  assert.equal(dropped, 7); assert.equal(bot.entity.position.x, -38.5);
});

test('the bunker turns a corner at its end, because a straight shaft is a shooting gallery', () => {
  const { cornerCell } = require('../src/bunker');
  const { Vec3 } = require('vec3');
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true };
  const air = { name: 'air', boundingBox: 'empty' };
  // Solid rock everywhere except the shaft already dug west along x.
  const dug = new Set(['-1,77,0', '-2,77,0', '-3,77,0', '-1,78,0', '-2,78,0', '-3,78,0']);
  const bot = { blockAt: p => ({ ...(dug.has(`${p.x},${p.y},${p.z}`) ? air : rock), position: p }) };
  const side = new Vec3(-1, 0, 0), end = new Vec3(-3, 77, 0);
  const corner = cornerCell(bot, end, side);
  assert(corner, 'a corner is found');
  assert.equal(corner.x, -3, 'the turn is perpendicular to the shaft, not further along it');
  assert.equal(Math.abs(corner.z), 1);
  // With nothing but air around the end there is nothing to turn into.
  const hollow = { blockAt: p => ({ ...air, position: p }) };
  assert.equal(cornerCell(hollow, end, side), null);
});

test('the wall search looks for walls, not for the floor it is standing on', () => {
  const { wallStands } = require('../src/bunker');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const rock = registry.blocksByName.netherrack;
  // A room: floor at y 76, walls at x = 6, air between. The floor is nearer
  // to the bot than any wall and would swamp an unfiltered search.
  const solidAt = p => p.y === 76 || p.x >= 6;
  const bot = {
    registry, entity: { position: new Vec3(0.5, 77, 0.5) },
    blockAt: p => ({ name: solidAt(p) ? 'netherrack' : 'air', boundingBox: solidAt(p) ? 'block' : 'empty', diggable: true, position: p }),
    findBlocks: ({ maxDistance }) => {
      const found = [];
      for (let x = -2; x <= 8; x++) for (let y = 74; y <= 80; y++) for (let z = -2; z <= 2; z++) {
        const p = new Vec3(x, y, z);
        if (solidAt(p) && p.distanceTo(bot.entity.position) <= maxDistance) found.push(p);
      }
      return found.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
    },
  };
  const stands = wallStands(bot, new Vec3(-8, 77, 0));
  assert(stands.length, 'a wall is found');
  for (const cell of stands) assert.equal(cell.y, 77, 'every stand is at the bot\'s own level, not on the floor blocks');
  assert.equal(stands[0].x, 5, 'and it is the cell beside the wall');
});

test('something overhead is reached by standing under it, never by towering up to it', () => {
  const { approaches } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 77, 0.5) } };
  const overhead = approaches(bot, { position: new Vec3(6.5, 80, 0.5) });
  assert(overhead.every(g => !g.entity), 'no follow goal for a flying target: a tower is a place to fall off');
  assert.equal(overhead[0].y, 77, 'within the sword\'s reach up, under it at the bot\'s own level first');
  // mid-83-j: six blocks under nine blazes, the cell beneath them was out of the sword's reach.
  const high = approaches(bot, { position: new Vec3(6.5, 83, 0.5) });
  assert.equal(high[0].y, 82, 'farther up, its own floor first, reached by the ground there');
  assert.equal(high[1].y, 77);
  const level = approaches(bot, { position: new Vec3(6.5, 77, 0.5) });
  assert.equal(level.length, 2, 'a target on the ground is followed as usual, with the ground goal as fallback');
  // Standing on a fortress roof, a goal at the bot's own height is a goal it
  // is already standing on: the route succeeds without moving and the fight
  // never starts.
  const below = approaches(bot, { position: new Vec3(6.5, 70, 0.5) });
  assert.equal(below[0].y, 70, 'something below is reached by going down to it');
});

test('the hunt\'s health, hunger, food, fire and kit are facts on Jev\'s choice, not a gate; only the footing is a rule', async () => {
  // mid-227-m (note 392): stalking blazes at 11.9 health, lit by a fireball, burned from 6.4 to none with no water in the Nether.
  const { canBegin, fitness, fitnessSays } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const kit = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } };
  const make = (health, onFire, food = 20) => ({
    game: { gameMode: 'survival', difficulty: 'normal', dimension: 'the_nether' }, health, food, oxygenLevel: 20,
    entity: { position: new Vec3(0.5, 77, 0.5), metadata: { 0: onFire ? 1 : 0 } },
    registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'diamond_sword' }], slots: kit },
    blockAt: p => ({ name: p.y < 77 ? 'netherrack' : 'air', boundingBox: p.y < 77 ? 'block' : 'empty', position: p }),
  });
  const blaze = { item: 'blaze_rod', dimension: 'nether', ranged: true };
  for (const [health, fire] of [[18, false], [18, true], [9, true], [9, false]]) assert(canBegin(make(health, fire), blaze), `footing is the rule: ${health} health, ${fire ? 'alight' : 'unlit'}`);
  assert(fitness(make(18, false)).fit);
  const lit = fitness(make(9, true));
  assert(!lit.fit && lit.burning);
  assert.match(fitnessSays(make(9, true), lit), /Health 9 \(under the 14 the code once required to start a fight\); hunger 20: health comes back while it stays at eighteen or more; alight now: fire takes half a heart a second, and in the Nether there is no water to put it out; only waiting burns it off\./);
  assert.match(fitnessSays(make(11.9, false, 12)), /Health 11.9 \(under the 14 .*\); hunger 12: health does not come back under eighteen, and nothing is carried to eat: every point lost is gone for good\./);
  const bare = make(18, false); bare.inventory = { items: () => [], slots: {} };
  assert.match(fitnessSays(bare), /the kit is short: no sword or axe carried, no head armour worn, no torso armour worn, no legs armour worn, no feet armour worn/);
  // A passive chase has no armour behind it, so fire still calls it off.
  assert(!canBegin(make(18, true), { item: 'feather', passive: true }), 'a chase in shirtsleeves stops for fire');
  // In view at nine health, the fight is asked, the fitness on every option and in the state.
  const { bot, task, goal } = fixture('blaze');
  bot.health = 9; bot.food = 12;
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}, client), false, 'deferred, as Jev chose');
  assert(asked, 'asked, where the old gate refused without a word');
  assert.match(asked.options.hunt_7.fitness, /Health 9 \(under the 14 the code once required to start a fight\); hunger 12: health does not come back under eighteen/);
  assert.match(asked.options.defer, /Left alone, the hunt recovers first: food if any is carried, cover from the shooters, and health while hunger is eighteen or more/);
  assert.equal(asked.state.fitness.fit, false); assert.equal(asked.state.fitness.floor, 14);
});

test('fit in every way but its footing, the hunt moves on rather than waiting to recover', async () => {
  const { bot, goal, task } = fixture('spider');
  bot.game.dimension = 'overworld'; bot.game.minY = 0; bot.game.height = 256;
  bot.inventory.slots[36] = { name: 'iron_sword', slot: 36, count: 1, durabilityUsed: 0 };
  for (const [slot, name] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'iron_boots'], [45, 'shield']]) bot.inventory.slots[slot] = { name, slot, count: 1, durabilityUsed: 0 };
  bot.health = 20; bot.food = 20;
  // Nothing solid underfoot: a fence top, a slab edge, a gap in a roof.
  const ground = bot.blockAt;
  bot.blockAt = p => p.x === 0 && p.y === 63 && p.z === 0 ? { name: 'air', boundingBox: 'empty' } : ground(p);
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, { acquireStep: async () => {}, explore: async () => {} });
  assert.notEqual(goal.step.action, 'recover_before_combat', 'waiting does not change where it stands');
  assert.equal(goal.step.action, 'stalk_mob');
  bot.blockAt = ground; bot.health = 9;
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, { acquireStep: async () => {}, explore: async () => {} });
  assert.equal(goal.step.action, 'recover_before_combat', 'hurt is still a reason to recover');
});

test('fit to fight is one test: the claim on a quarry and the hunt agree, and rotten flesh counts as something to eat', () => {
  const { fitToFight } = require('../src/mob-policy');
  const { claimed } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const kit = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'golden_boots' }, 45: { name: 'shield' } };
  let items = [{ name: 'diamond_sword', count: 1 }];
  const bot = { registry, health: 15, food: 17, inventory: { slots: kit, items: () => items }, _huntingEntity: { name: 'blaze', until: Date.now() + 5000 } };
  const blaze = { name: 'blaze' };
  assert.equal(fitToFight(bot), false, 'seventeen hunger and nothing to eat: no regeneration, no fight');
  assert.equal(claimed(bot, blaze), false, 'and no claim that would take it out of its pocket');
  items = [...items, { name: 'rotten_flesh', count: 2 }];
  assert.equal(fitToFight(bot), true, 'rotten flesh is something to eat');
  assert.equal(claimed(bot, blaze), true);
});

test('bricks in view with nothing twelve blocks off to walk to are shunned and the sweep goes on, not patrolled in place', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const clear = { boundingBox: 'empty' };
  // A pocket's worth of bricks around the bot: all within five blocks.
  const pocket = Array.from({ length: 30 }, (_, i) => new Vec3(1 + (i % 3), 64 + Math.floor(i / 9), (i % 9) - 4));
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 65, 0.5) }, chat() {},
    blockAt: () => clear, findBlocks: () => pocket };
  const goal = { fortressSearch: { axis: 1, heading: 1, legs: 3, legSince: Date.now() - 60000, target: { x: 0, y: 65, z: 96 } } };
  const tunnels = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target) => tunnels.push([target.x, target.z]) });
  assert.equal(goal.fortressSearch.shunned.length, 1, 'the bricks are shunned');
  assert.deepEqual(tunnels, [[0, 96]], 'and the leg in hand is walked, not a new one begun');
  assert.equal(goal.fortressSearch.legs, 3);
});

test('in the Nether short of pearls, with gold and a piglin in view, the ladder barters before going home', () => {
  const { nextGameStage } = require('../src/game-progress');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const items = [{ name: 'blaze_rod', count: 8 }, { name: 'gold_ingot', count: 20 }];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => items, slots: {} },
    entities: { 7: { id: 7, name: 'piglin', position: new Vec3(5, 64, 0), isValid: true, metadata: [] } } };
  const goal = { kind: 'win', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 } } } };
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'barter', JSON.stringify(stage));
  bot.entities = {};
  assert.notEqual(nextGameStage(bot, goal).action, 'barter', 'no piglin in view: home to hunt');
});

test('a fortress leg begun again where the last began turns the sweep, however the step was cut short', async () => {
  // mid-83-f: five legs south from one Nether spot, each cut short by the progress watch before its failures were counted.
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(12.5, 71, -171.5) }, findBlocks: () => [] };
  const goal = {};
  const targets = [];
  const actions = { tunnel: async (b, t, g, s, target) => { targets.push([target.x, target.z]); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  delete goal.fortressSearch.target; // the step cut short and started over, as the recovery does
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const [a, b] = targets;
  assert.notDeepEqual(a, b, `a new heading, not the same leg again: ${a} then ${b}`);
});

test('a sweep with every leg failing and too few blocks to cross goes back through the portal for more', async () => {
  // mid-87-k: on an island in the lava sea with eighteen blocks, twelve legs turned in four minutes.
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: {}, entity: { position: new Vec3(57.5, 32, 1.5) },
    inventory: { items: () => [{ name: 'cobblestone', count: 7 }, { name: 'cobbled_deepslate', count: 11 }] },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 32 ? 'lava' : 'air', position: p, boundingBox: 'empty' }), world: { raycast: () => null }, chat() {} };
  const goal = { fortressSearch: { axis: 1, legs: 9, legFails: 3, legSince: Date.now() - 60000, legFrom: { x: 57, z: 1 }, target: { x: 153, y: 40, z: 1 } } };
  let back = 0;
  let mined = 0;
  const actions = { navigate: async () => {}, tunnel: async () => {}, acquireStep: async (b, t, item) => { mined++; assert.equal(item, 'netherrack'); if (mined > 1) throw new Error('No netherrack in reach'); }, returnOverworld: async () => { back++; } };
  await findFortressStep(bot, new Task('fortress'), goal, () => {}, actions);
  assert.equal(mined, 1, 'netherrack first');
  assert.equal(back, 0);
  Object.assign(goal.fortressSearch, { legFails: 3, legSince: Date.now() - 60000, target: { x: 153, y: 40, z: 1 } });
  await findFortressStep(bot, new Task('fortress'), goal, () => {}, actions);
  assert.equal(mined, 2);
  assert.equal(back, 1, 'none to be had: back through the portal');
});

test('the hunt\'s claim on the kind is renewed while the fight runs, not left to lapse after five seconds', async () => {
  // mid-83-j: under the spawner, every fight ended "Threat nearby: blaze at 5 blocks" five seconds in.
  const { bot, task, target, goal } = fixture();
  bot._huntingEntity = { name: 'blaze', until: Date.now() - 10000 };
  let claimDuringFight = null;
  bot.attack = entity => {
    claimDuringFight = bot._huntingEntity;
    bot.emit('entityDead', entity); delete bot.entities[entity.id];
  };
  await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => {} }, { pickupWaitMs: 10 }).catch(() => {});
  assert(claimDuringFight && claimDuringFight.name === 'blaze' && claimDuringFight.until > Date.now(), `claimed while fighting: ${JSON.stringify(claimDuringFight)}`);
});

test('a piece Jev set aside for the Nether first is not fetched before the crossing; what is carried is worn', async () => {
  // The decision review: "Nether first" set the armour aside and the crossing fetched every piece anyway.
  const { setAside } = require('../src/progress');
  const { bot, slots, goal, task } = fixture();
  slots[6] = null;
  setAside(goal, 'rung', 'iron_chestplate', 'Jev chose the Nether first', 1800000);
  const requests = [], actions = { acquireStep: async (_b, _t, item, count) => requests.push({ item, count }) };
  assert.equal(await prepareCombatGear(bot, task, goal, () => {}, actions), true, 'the crossing goes on');
  assert.deepEqual(requests, [], 'nothing fetched');
});

test('a sword carried is ready: the kit does not put it in the hand over the tool of the work', async () => {
  // mid-227-g's staircase and the kit swapped the pickaxe and the sword in the hand each pass (2026-09-27).
  const { bot, slots, goal, task } = fixture();
  // The sword in the pockets, a pickaxe in the hand for the staircase.
  const sword = slots[36]; slots[37] = { ...sword, slot: 37 }; slots[36] = { name: 'iron_pickaxe', slot: 36, count: 1, durabilityUsed: 0 };
  const held = bot.heldItem;
  const equips = [];
  const equip = bot.equip; bot.equip = async (item, dest) => { equips.push([item.name, dest]); return equip.call(bot, item, dest); };
  const actions = { acquireStep: async () => false };
  const ready = await prepareCombatGear(bot, task, goal, () => {}, actions);
  assert(!equips.some(([, dest]) => dest === 'hand'), `nothing put in the hand: ${JSON.stringify(equips)}`);
  assert.equal(ready, require('../src/mob-policy').kitReady(bot));
  void held; void slots;
});

test('at the end of a span the crouch is let go only once the body has stopped', async () => {
  // mid-227-h slid off the end of its span with no key held when the crouch was let go with the walk (2026-09-27).
  const { bridgeTo } = require('../src/bridging');
  const { Vec3 } = require('vec3');
  const blocks = new Map([[`${new Vec3(0, 64, 0)}`, 'netherrack']]);
  const at = p => ({ name: blocks.get(`${p}`) || 'air', boundingBox: blocks.has(`${p}`) ? 'block' : 'empty', diggable: true, position: p, digTime: () => 500 });
  let look = null;
  const controls = {}, log = [];
  const bot = {
    entity: { position: new Vec3(0.5, 65, 0.5), velocity: new Vec3(0, 0, 0) }, health: 20,
    inventory: { items: () => [{ name: 'netherrack', count: 20, type: 1 }] },
    blockAt: at, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); blocks.set(`${p}`, 'netherrack'); },
    setControlState: (name, on) => {
      controls[name] = on; log.push(`${name}:${on}:${Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z).toFixed(2)}`);
      if (name === 'forward' && on && look) { bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, 65, Math.floor(look.z) + 0.5); bot.entity.velocity = new Vec3(0.12, 0, 0); }
      if (name === 'forward' && !on) setTimeout(() => { bot.entity.velocity = new Vec3(0, 0, 0); }, 120);
    },
    getControlState: name => !!controls[name], dig: async () => {},
  };
  await bridgeTo(bot, new Task('hunt'), new Vec3(3, 64, 0));
  const release = log.filter(l => l.startsWith('sneak:false')).at(-1);
  assert.equal(release, 'sneak:false:0.00', `the crouch let go at rest: ${log.slice(-4).join(' ')}`);
});

test('the ways to a fortress say the mobs at its bricks, seen or not', async () => {
  // mid-227-o dug down into its fortress told "none in view", onto a blaze two blocks off and six wither skeletons (2026-09-27).
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = fortressAcrossLava();
  bot.entities = {
    4: { id: 4, name: 'wither_skeleton', type: 'hostile', position: new Vec3(33.5, 65, 1.5), height: 2.4, width: 0.7, isValid: true },
    5: { id: 5, name: 'wither_skeleton', type: 'hostile', position: new Vec3(36.5, 65, 0.5), height: 2.4, width: 0.7, isValid: true },
    6: { id: 6, name: 'blaze', type: 'hostile', position: new Vec3(31.5, 67, 0.5), height: 1.8, width: 0.6, isValid: true },
  };
  bot.world = { raycast: () => ({ intersect: bot.entity.position }) };
  const client = jevStub(['keep_searching']);
  const goal = { fortressSearch: { axis: 1, legs: 3, target: { x: 96, y: 65, z: 0 } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} });
  const { options, state } = client.asked[0];
  assert.match(state.atTheBricks || '', /2 wither skeletons, 1 blaze|1 blaze, 2 wither skeletons/);
  for (const [key, text] of Object.entries(options)) assert.match(text, /Within sixteen blocks of the bricks, seen or not: .*wither skeleton/, key);
});
