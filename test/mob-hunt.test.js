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
  // The kit is not planned: it is offered where the hunt begins (note 476).
  const missing = planCatalog(registry, 'blaze_rod', 1, { iron_ingot: 40, oak_planks: 30, stick: 8, crafting_table: 1 });
  assert.deepEqual(missing.map(s => s.action), ['hunt_mob']);
  assert.deepEqual(missing[0].kit, { carried: [], missing: Object.keys(combatGear) });
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
  assert(!bow.some(s => s.action === 'craft' && s.item === 'iron_sword'), 'the kit is offered where the hunt begins, not planned (note 476)');
  assert(bow.find(s => s.action === 'hunt_mob').kit.missing.includes('hand'), 'a spider fights back: the kit it lacks is said');
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
  // In the Overworld, where a chestplate can be made: without Jev, the
  // code's default makes it (in the Nether it cannot: kitChoice, note 476).
  bot.game.dimension = 'overworld';
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
    assert.match(questions.branch_0.criteria.hunt_7, /About [\d.]+ seconds and [\d.]+ damage from 20 health, [\d.]+ after; it lands about [\d.]+ a hit through what is worn\./); assert(state.riskNow);
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

test('in the Nether with a stone sword and no armour, the kit is Jev\'s choice with its costs: fight with what is carried, golden boots here, or back for the iron', async () => {
  // mid-227-r-nether-1 fetched iron in the Nether for the kit 1,130 times in twenty-five minutes, then died (note 476).
  const { isSetAside } = require('../src/progress');
  const { bot, slots, goal, task } = fixture('blaze');
  for (const slot of [5, 6, 7, 8, 45]) slots[slot] = null;
  slots[36] = { name: 'stone_sword', slot: 36, count: 1, type: registry.itemsByName.stone_sword.id, durabilityUsed: 0 };
  slots[20] = { name: 'iron_pickaxe', slot: 20, count: 1, type: registry.itemsByName.iron_pickaxe.id, durabilityUsed: 0 };
  goal.portals = [{ x: 40, y: 64, z: 0, dimension: 'nether' }];
  const asked = [], back = [];
  let choice = 'return_for_kit';
  const client = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice, confidence: 0.9 } } }; } };
  const actions = { acquireStep: async () => assert.fail('nothing fetched before Jev chooses'), returnOverworld: async () => back.push('portal') };
  assert.equal(await prepareCombatGear(bot, task, goal, () => {}, actions, { client }), false);
  const { options } = asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['fight_with_carried', 'make_kit_here', 'return_for_kit']);
  assert.match(options.fight_with_carried, /a stone sword, no armour worn \(0 armour points\), no shield\. One blaze fought so: about \d+ seconds/);
  assert.match(options.make_kit_here, /golden boots/, 'gold is in the Nether');
  assert.match(options.return_for_kit, /iron sword, iron helmet, iron chestplate, iron leggings and shield: 23 iron ingots, from 23 iron ore mined there/);
  assert.match(options.return_for_kit, /40 blocks off/);
  assert.deepEqual(back, ['portal']);
  assert.equal(goal.errand.dimension, 'overworld');
  assert.deepEqual(goal.errand.items.map(i => i.item), ['iron_sword', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'shield']);
  // Going on with what is carried leaves the pieces for half an hour, and the hunt goes on.
  delete goal.combatKit; choice = 'fight_with_carried';
  assert.equal(await prepareCombatGear(bot, task, goal, () => {}, actions, { client }), true);
  assert(isSetAside(goal, 'rung', 'iron_helmet') && isSetAside(goal, 'rung', 'shield'));
  assert.equal(await prepareCombatGear(bot, task, goal, () => {}, actions, { client }), true);
  assert.equal(asked.length, 2, 'not asked again while the pieces wait');
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
  // The staircase makes ground: four blocks along the leg each step.
  const dig = async (b, t, g, s, target, resource) => { tunnels.push([target.x, target.z, resource]); bot.entity.position = bot.entity.position.offset(4 * Math.sign(target.x - bot.entity.position.x), 0, 0); };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: dig });
  assert.equal(goal.fortressSearch.legs, 1); assert(Math.abs(tunnels[0][0]) >= FORTRESS_LEG - 1, 'a full leg along x'); assert.equal(tunnels[0][2], 'fortress');
  // Three bricks are the bot's own building blocks, not a fortress: the sweep goes on.
  bot.findBlocks = () => [new Vec3(3, 64, 1), new Vec3(3, 65, 1), new Vec3(4, 64, 1)];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: dig });
  assert.equal(goal.fortressSearch.found, undefined, 'a handful of bricks is not a fortress');
  assert.equal(goal.fortressSearch.legs, 1, 'and the leg in hand is kept');
  tunnels.length = 1;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
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
  const asked = [], visits = [];
  // Whether the visit happens now (fortress_visit, note 638) is answered go_in: these tests are about what comes after it.
  return { asked, visits, systemOne: async ({ kind, state, questions }) => {
    if (questions.branch_0.criteria.go_in) { visits.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'go_in', confidence: 0.9 } } }; }
    asked.push({ kind, state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } };
  } };
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
  assert.doesNotMatch(options.cross_level, /It stays level/, 'a fortress at the height of the span has nothing left to climb');
  assert.match(options.walk_route, /walks upright/);
  assert.deepEqual(state.threatsInView, ['hoglin 4 blocks off']);
  assert.equal(laid.size, 26, 'the span Jev chose, a block for each cell over the lava');
  assert.equal(bot.entity.position.x, 29.5);
  assert.equal(goal.fortressSearch.approach.choice, 'cross_level');
  assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
});

test('note 641: a level crossing toward a fortress well above says the climb is still to be made from the end of the span', async () => {
  // mid-242-bb-nether-1-fortress-*: "2 from it" was across; the span of 16 blocks ended 37 under the bricks, with none carried, over the lava.
  const { findFortressStep } = require('../src/mob-hunt');
  const bricks = Array.from({ length: 25 }, (_, i) => new Vec3(30 + i, 103, 0));
  const rock = p => p.y <= 31 ? 'lava' : p.y === 103 && p.z === 0 && p.x >= 30 && p.x <= 54 ? 'nether_bricks' : p.y === 64 && p.x <= 3 ? 'netherrack' : null;
  const { bot } = netherWorld(new Vec3(0.5, 65, 0.5), rock);
  bot.findBlocks = () => bricks;
  bot.time = { timeOfDay: 6000 };
  bot.entities = {};
  const client = jevStub(['keep_searching']);
  const goal = { fortressSearch: { axis: 1, legs: 3, target: { x: 96, y: 65, z: 0 } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('the code walked on its own'); }, tunnel: async () => { throw new Error('the code tunnelled on its own'); } });
  const { options } = client.asked[0];
  assert.match(options.cross_level, /39 blocks up at the height the bot stands/);
  assert.match(options.cross_level, /It stays level: it ends 38 blocks under the nearest brick \(y 103\), and the 38 blocks up are still to be made from the end of the span, with \d+ blocks? left, over the lava it was laid across; the way up is asked again from there\./);
});

test('a fortress in view is asked whether the visit happens now before the way in (fortress_visit, note 638); leaving it shuns it and asks no way in', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const goal0 = () => ({ fortressSearch: { axis: 1, legs: 3, target: { x: 96, y: 65, z: 0 } } });
  // Go in: the visit is asked first, the way in second, and the answer is held for the next pass.
  const a = fortressAcrossLava();
  const client = jevStub(['cross_level']);
  const goal = goal0();
  await findFortressStep(a.bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} });
  assert.equal(client.visits.length, 1, 'the visit asked once');
  assert.deepEqual(Object.keys(client.visits[0].options).sort(), ['go_in', 'leave_fortress']);
  assert.match(client.visits[0].state.visit, /^about to approach a Nether fortress \d+ blocks off/);
  assert.equal(client.asked[0].kind, 'fortress');
  assert.equal(goal.fortressVisit.pick, 'go_in');
  // Leave it: no way in is asked, the fortress is shunned for ten minutes.
  const b = fortressAcrossLava();
  const leave = { asked: [], systemOne: async ({ questions }) => { const o = questions.branch_0.criteria; leave.asked.push(Object.keys(o)); return { answers: { branch_0: { choice: o.leave_fortress ? 'leave_fortress' : 'walk_route', confidence: 0.9 } } }; } };
  const g2 = goal0();
  await findFortressStep(b.bot, new Task('hunt'), g2, () => {}, { client: leave, navigate: async () => {}, tunnel: async () => {} });
  assert.equal(leave.asked.length, 1, 'only the visit was asked');
  assert.equal(g2.fortressSearch.shunned.length, 1);
  assert(g2.fortressSearch.shunned[0].until > Date.now() + 500000);
  assert.equal(g2.fortressSearch.shunned[0].why, 'Jev chose to leave it and search on');
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
  assert.equal(goal2.fortressSearch.legMode, 'descend');
  assert.deepEqual(steps, [['tunnel', FORTRESS_Y]], 'the staircase toward the fortress heights, no walk and no level crossing');
  // It made no ground from where it began: that staircase rests from here, said with the next ask (note 557).
  assert.equal(goal2.fortressSearch.target, undefined);
  assert(Object.keys(goal2.fortressSearch.legRests).some(k => k.startsWith('seek_')), 'the staircase rests from here');
  // Without Jev, the heading with the most open air; the compass's own at a tie.
  const children = { leg_east: {}, leg_south: {}, leg_west: {}, leg_north: {}, seek_fortress_height: {} };
  assert.equal(legFallback(children, [], { current: 'leg_east', open: { leg_east: 0, leg_south: 40, leg_west: 0, leg_north: 0 } }), 'leg_south');
  assert.equal(legFallback(children, [], { current: 'leg_west', open: { leg_east: 5, leg_south: 5, leg_west: 5, leg_north: 5 } }), 'leg_west');
  assert.equal(legFallback(children, [], { current: 'leg_west', open: { leg_east: null, leg_south: null, leg_west: null, leg_north: null } }), 'leg_west');
});

test('a fortress leg over a void is priced by the blocks carried, its failure kept on its own heading, and the blocks round the bot offered to mine', async () => {
  // mid-211-s-nether-4 and mid-202-o (note 480): in a basalt delta with nothing carried, "94 of open air, about 34 seconds" south,
  // chosen some thirty times; its failure was noted on the next heading, and the hidden restock mined netherrack only.
  const { findFortressStep } = require('../src/mob-hunt');
  // A basalt ledge to z 1, a sixty-block void to z 61 over the lava sea, basalt again from z 62; a basalt wall north from z -4.
  const rock = p => p.y <= 31 ? 'lava' : (p.x === 5 && p.y === 63 && p.z === -3) ? 'netherrack'
    : (p.z <= 1 && p.y <= 64) || (p.z <= -4) || (p.z >= 62 && p.y <= 64) ? 'basalt' : null;
  const carried = [];
  const { bot, dug } = netherWorld(new Vec3(0.5, 65, 1.5), rock, carried);
  const near = [new Vec3(5, 63, -3)];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 1; z++) for (let y = 60; y <= 64; y++) near.push(new Vec3(x, y, z));
  bot.findBlocks = ({ maxDistance }) => near.filter(p => p.distanceTo(bot.entity.position) <= maxDistance);
  // The last leg went south from the ledge's edge and failed: the staircase found no way over the void.
  const goal = { fortressSearch: { axis: 1, legs: 3, heading: 1, lastHeading: 1, legMode: 'level', target: { x: 1, y: 65, z: 97 }, legFrom: { x: 0, z: 1 }, legSince: Date.now() - 30000, legFails: 3 } };
  const mined = [];
  const actions = { navigate: async () => {}, tunnel: async () => { throw new Error('No safe way toward (1, 65, 97): open air'); },
    mineAt: async (b, t, g, sv, p, name, drops) => { mined.push(name); dug.add(`${p}`); carried.push({ name: drops, count: 1 }); }, returnOverworld: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  // No ground made from where it began: the leg south rests from here (note 557).
  assert(goal.fortressSearch.legRests.south, 'the leg south rests from here');
  assert.equal(goal.fortressSearch.target, undefined, 'the leg is ended, the next asked');
  // Five minutes on, back from the edge, the next leg is asked with south among the ways again.
  goal.fortressSearch.legRests.south.until = Date.now() - 1;
  bot.entity.position = new Vec3(0.5, 65, -0.5);
  const client = jevStub(['restock_blocks']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client });
  assert.equal(client.asked.length, 1);
  const { options, state } = client.asked[0];
  assert.match(options.leg_south, /it needs 60 blocks laid, crouched, about 1\.4 seconds a cell, 0 carried: the blocks run out at cell 2/);
  assert.match(options.leg_east, /96 of open air; about 22 seconds\./, 'a walk along the ledge, floored all the way');
  assert.doesNotMatch(options.leg_east, /blocks laid/);
  assert.match(options.leg_south, /The last leg this way, begun 2 blocks from here, ended no nearer: No safe way toward \(1, 65, 97\): open air/);
  for (const k of ['leg_east', 'leg_west', 'leg_north']) assert.doesNotMatch(options[k], /ended no nearer/, `${k} was not tried`);
  const [, want, can] = options.restock_blocks.match(/^Dig (\d+) blocks to lay spans with here, one after another, from the (\d+) that can be dug from ground walked to from here \(\d+ basalt\)/);
  assert.equal(Number(want), Math.min(60, Number(can)), 'what the longest leg short of blocks needs, as far as can be had here');
  assert.match(options.restock_blocks, /The longest leg short of blocks needs 60 laid and 0 are carried: 60 short/);
  assert.match(options.restock_blocks, /not to be dug from ground walked to from here [^:]*: [\d,]+ basalt, 1 netherrack/, 'the netherrack walled in by basalt');
  assert.match(options.return_for_blocks, /back through the portal to the Overworld/);
  assert.equal(state.blocksCarried, 0);
  // Jev chose the restock: basalt is mined, the leg waits for it.
  assert.equal(mined.length, Number(want)); assert(mined.every(n => n === 'basalt'));
  assert.equal(goal.fortressSearch.target, undefined, 'no leg begun short of blocks');
});

test('a restock at the end of a span over the lava sea digs only what it can reach on foot, in one go, and never the span', async () => {
  // mid-244-ad-nether-2 (note 561): at the end of its cobblestone span, 61 carried and every leg needing 90 and more, it chose
  // "Mine 64 netherrack, the nearest 10 blocks off": across the drop. Each mine step walked back along the span and dug nothing,
  // the leg walked it back to the span's end between them, and the next offer was the span itself, "36 cobblestone, 1 blocks off".
  const { findFortressStep } = require('../src/mob-hunt');
  const span = p => p.x === 0 && p.y === 72 && p.z >= -20 && p.z <= 0;
  const outcrop = p => p.x >= 1 && p.x <= 3 && p.z >= -15 && p.z <= -11 && p.y >= 40 && p.y <= 74;
  const island = p => p.x >= 9 && p.x <= 12 && p.z >= -24 && p.z <= -18 && p.y >= 60 && p.y <= 72;
  const rock = p => p.y <= 31 ? 'lava' : span(p) ? 'cobblestone' : outcrop(p) || island(p) || (p.z >= 1 && p.y <= 72) ? 'netherrack' : null;
  const carried = [{ name: 'cobblestone', count: 61 }];
  const { bot, dug } = netherWorld(new Vec3(0.5, 73, -19.5), rock, carried);
  const world = [];
  for (let x = -20; x <= 20; x++) for (let y = 50; y <= 80; y++) for (let z = -40; z <= 5; z++) { const p = new Vec3(x, y, z); if (rock(p) && rock(p) !== 'lava') world.push(p); }
  bot.findBlocks = ({ matching, maxDistance }) => { const ids = [].concat(matching);
    return world.filter(p => !dug.has(`${p}`) && p.distanceTo(bot.entity.position) <= maxDistance && ids.includes(registry.blocksByName[rock(p)].id)); };
  const walks = [], digs = [];
  const actions = { tunnel: async () => {}, returnOverworld: async () => {},
    navigate: async (b, t, g) => { walks.push(g); if (Number.isFinite(g.y)) bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    mineAt: async (b, t, g, sv, p, name, drops) => {
      assert(bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) <= 4.5, `${p} dug from where the bot stands`);
      digs.push(p); dug.add(`${p}`); carried.push({ name: drops, count: 1 });
    } };
  const goal = { fortressSearch: { axis: 1, legs: 1, heading: 3, lastHeading: 3, legMode: 'level', target: { x: 1, y: 76, z: -22 }, legFrom: { x: 0, z: 74 }, legSince: Date.now() - 600000 } };
  const client = jevStub(['restock_blocks']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client });
  const { options } = client.asked[0];
  const said = options.restock_blocks;
  const [, want, can, need] = said.match(/^Dig (\d+) blocks to lay spans with here, one after another, from the (\d+) that can be dug from ground walked to from here \(\d+ netherrack\).* (\d+) short/);
  assert.equal(Number(want), Math.min(Number(need), Number(can)));
  assert.match(said, /The longest leg short of blocks needs \d+ laid and 61 are carried/);
  assert.match(said, /not to be dug from ground walked to from here [^:]*: [\d,]+ netherrack, 17 cobblestone\./, 'the island across the drop, and the span itself');
  assert.match(said, /the nearest \d+ blocks off, dug from a walk of \d+ blocks? from here, about \d+ seconds in all/);
  // Chosen: gathered in one go, from the outcrop beside the span, the span and the island untouched.
  assert.equal(digs.length, Number(want));
  assert(digs.every(outcrop), `only the outcrop: ${digs.filter(p => !outcrop(p)).join(' ')}`);
  assert(!walks.some(g => g.constructor.name === 'GoalNearXZ'), 'no walk back toward the leg\'s end between blocks');
  assert.equal(goal.fortressSearch.restock, undefined);
  assert.equal(goal.fortressSearch.lastRestock.gained, Number(want));
  // A restock held (a threat broke it off) goes on where it stands, however far from the leg's end: it was looked at only
  // within eight blocks of it, and the leg walked the bot back to the span's end between digs.
  bot.entity.position = new Vec3(0.5, 73, -9.5); walks.length = 0; digs.length = 0;
  const have = carried.reduce((n, i) => n + i.count, 0);
  goal.fortressSearch.restock = { want: have + 3, since: Date.now(), said: 30, from: { x: 0, y: 73, z: -20 } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client: jevStub([]) });
  assert.equal(digs.length, 3, 'the restock went on');
  assert(!walks.some(g => g.constructor.name === 'GoalNearXZ'), 'the leg did not take the tick');
  assert.equal(goal.fortressSearch.lastRestock.gained, 3);
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

// A bridge deck of nether bricks at y 55 from x 1 to 30 (or `length`), z -1 to 1, on a
// footing at x 1 and 2 down to the lava sea; the bot on its own netherrack
// span at y 48 beside the footing (mid-235-p-fortress-6, note 523).
function fortressOverhead(position, length = 30) {
  const deck = p => p.y === 55 && p.x >= 1 && p.x <= length && p.z >= -1 && p.z <= 1;
  const footing = p => p.x >= 1 && p.x <= 2 && p.z >= -1 && p.z <= 1 && p.y >= 32 && p.y < 55;
  const rock = p => p.y <= 31 ? 'lava' : deck(p) || footing(p) ? 'nether_bricks' : p.y === 48 && p.z === 0 && p.x >= -10 && p.x <= 0 ? 'netherrack' : null;
  const world = netherWorld(position, rock);
  const bricks = [];
  for (let x = 1; x <= length; x++) for (let z = -1; z <= 1; z++) bricks.push(new Vec3(x, 55, z));
  for (let x = 1; x <= 2; x++) for (let z = -1; z <= 1; z++) for (let y = 40; y < 55; y++) bricks.push(new Vec3(x, y, z));
  world.bricks = bricks;
  world.bot.findBlocks = ({ matching }) => matching === registry.blocksByName.spawner.id ? [] : bricks;
  return world;
}

test('a pillar up over the lava sea with a ghast in view says its push, and that the ghast can shoot the bot on top (mid-208-k-nether-3-fortress-1, note 551)', async () => {
  // Pillared nine up from a ledge of the lava sea, told "a fall of up to 9 blocks"; a ghast came into view at 54 to 63
  // blocks and its fireball put the bot thirty-seven blocks down into the lava.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = fortressOverhead(new Vec3(0.5, 49, 0.5), 12);
  bot.entities = { 21: { id: 21, name: 'ghast', type: 'hostile', position: new Vec3(0.5, 60, 50.5), height: 4, width: 4, isValid: true } };
  const client = jevStub(['keep_searching']);
  const goal = { step: { action: 'hunt_mob', entity: 'blaze' }, fortressSearch: { axis: 1, legs: 15 } };
  const actions = { client, dig: async () => {}, navigate: async () => { throw new Error('No route'); }, tunnel: async () => { throw new Error('The staircase is set aside'); } };
  try { await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions); } catch (err) { assert.equal(err.name, 'NeedsSafety'); }
  const asked = client.asked.find(q => q.options?.pillar_up);
  assert(asked, client.asked.map(q => Object.keys(q.options || {}).join(',')).join(' | '));
  assert.match(asked.options.pillar_up, /into lava\. In sight: a ghast 51 blocks off\. A ghast 51 blocks off can shoot the bot on top, and a shot that lands pushes it, shield or not; the top has no wall\./);
});

test('bricks a block off with the fortress\'s floors seven blocks up are not the fortress entered: the way up is asked, a pillar among the ways, and the hunt\'s step is the search (mid-235-p-fortress-6, note 523)', async () => {
  // mid-235-p-fortress-6 stood on its own span beside the fortress's footing, "inside" by a brick a block off, and set out
  // for bricks eight blocks up that no step reached, two a second; each "pass" of that asked stay_in_fortress, and the
  // hunt's step and the search's traded names until the stall watch struck fifty times.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = fortressOverhead(new Vec3(0.5, 49, 0.5), 12);
  const client = jevStub(['keep_searching']);
  const walked = [];
  const goal = { step: { action: 'hunt_mob', entity: 'blaze' }, fortressSearch: { axis: 1, legs: 15 } };
  const actions = { client, dig: async () => {}, navigate: async (b, t, g) => { walked.push(g); throw new Error('No route'); }, tunnel: async () => { throw new Error('The staircase is set aside'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(walked.length, 0, 'no stretch set out for from beside the footing');
  assert.equal(client.asked.length, 1); assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  const { options, state } = client.asked[0];
  assert.deepEqual(state.fortress, { distance: 1, height: 7 }, 'the way is to its nearest floor, seven up');
  assert.match(options.pillar_up, /^Pillar straight up 7 blocks to the fortress floor's height \(jump and lay a block under the feet, 64 carried that can be laid, 57 left after\)/);
  // Over the lava sea: a push off the top lands beside the column's foot, not on it (mid-208-k-nether-3-fortress-1, note 551).
  assert.match(options.pillar_up, /On top a push is a fall of up to 24 blocks \(the pillar's 7, then a drop of 17 a block from its foot\), into lava\./);
  assert.equal(goal.step.action, 'find_fortress');
  // Set aside as Jev chose: the legs are asked, and the step is still the search. From the spot it was left, going back is
  // those same ways asked again, and mid-235-q-nether-2 left and took back its fortress every three seconds for a
  // minute (note 541): said in the state, not offered.
  goal.step = { action: 'hunt_mob', entity: 'blaze' };
  const legs = jevStub(['leg_north']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client: legs });
  assert.equal(legs.asked.length, 1); assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  assert.equal(legs.asked[0].options.back_to_fortress, undefined, 'not from where it was just left');
  assert.match(legs.asked[0].state.fortressInView.setAside, /Jev chose to leave it and search on, from where the bot stands, over the ways into it from here \([^)]*pillar up[^)]*\): going back from here is asking those same ways again/);
  assert.match(legs.asked[0].state.fortressInView.floors, /the nearest of its floors 1 blocks across and 7 up/);
  assert.notEqual(goal.step.action, 'hunt_mob', 'the hunt\'s step does not come back between the questions');
  // Elsewhere, going back is offered with the same why.
  goal.step = { action: 'hunt_mob', entity: 'blaze' };
  delete goal.fortressSearch.target;
  bot.entity.position = new Vec3(0.5, 49, 8.5);
  const later = jevStub(['back_to_fortress']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { ...actions, client: later });
  assert.match(later.asked.find(a => a.options.back_to_fortress)?.options.back_to_fortress || '', /set aside 0 minutes ago, for 10 minutes more: Jev chose to leave it and search on;/);
});

// mid-242-ac-nether-1 at (-122.5, 72, 106.5): on a fortress floor walled by lava at the feet's height, the fortress set
// aside by Jev from this spot eight minutes before, blazes seen near it forty times, no pickaxe carried (note 557).
function acFloor() {
  const deck = p => p.y === 71 && p.x >= -124 && p.x <= -121 && p.z >= 105 && p.z <= 108;
  const ring = p => p.y >= 72 && p.y <= 73 && ((p.x === -125 || p.x === -120) && p.z >= 104 && p.z <= 109 || (p.z === 104 || p.z === 109) && p.x >= -125 && p.x <= -120);
  const rock = p => p.y <= 31 ? 'lava' : deck(p) || (p.y === 70 && p.x >= -124 && p.x <= -121 && p.z >= 105 && p.z <= 108) ? 'nether_bricks' : ring(p) ? 'lava' : null;
  const world = netherWorld(new Vec3(-122.5, 72, 106.5), rock, [{ name: 'netherrack', count: 84, type: 1 }]);
  const bricks = [];
  for (let x = -124; x <= -121; x++) for (let z = 105; z <= 108; z++) bricks.push(new Vec3(x, 71, z), new Vec3(x, 70, z));
  world.bot.findBlocks = ({ matching }) => matching === registry.blocksByName.spawner.id ? [] : bricks;
  return world;
}

test('on a fortress floor it had left, with blazes seen there forty times and every leg ending at once, the blazes lead the question, a failed leg rests, and leaving a way to them leaves the way, not the fortress (mid-242-ac-nether-1, note 557)', async () => {
  // mid-242-ac-nether-1 was asked the leg every three seconds for fifteen minutes, east and north ninety times, each
  // ending at the first cell, the fortress it stood on set aside and blazes seen near it forty times only a field.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = acFloor();
  const now = Date.now();
  const goal = { mobHunt: { entity: 'blaze', item: 'blaze_rod', sightings: [{ x: -108, y: 77, z: 155, dimension: 'the_nether', at: now - 60000, seen: 40, inSight: 6 }] },
    fortressSearch: { axis: 1, legs: 70, since: now - 48 * 60000,
      shunned: [{ x: -121, z: 105, radius: 16, until: now + 2 * 60000, at: now - 8 * 60000, why: 'Jev chose to leave it and search on', from: { x: -123, y: 72, z: 106 }, left: ['walk route', 'tunnel'] }] } };
  const walks = [];
  const client = jevStub(['leg_east', 'go_to_blazes', 'other_way']);
  const actions = { client, navigate: async (b, t, g, opts = {}) => { walks.push(opts); throw new Error('No route from here'); },
    tunnel: async () => { throw new Error('The staircase toward it is set aside (no safe step toward it (water or lava behind the rock: 1 of the steps nearer))'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 1);
  let { options, state } = client.asked[0];
  assert.equal(Object.keys(state)[0], 'blazesSeen', 'the blazes lead the question');
  assert.match(state.blazesSeen, /^blazes seen 40 times in 1 place; the busiest 40 times at \(-108, 77, 155\) \(6 of them in sight, the rest heard through the walls\), 51 blocks off and 5 up, last 1 minute ago/);
  assert.match(state.pickaxe, /^none carried: rock and nether bricks cannot be dug/);
  assert.match(options.go_to_blazes, /^Go to where blazes were seen 40 times at \(-108, 77, 155\)/);
  assert.match(options.back_to_fortress, /Jev chose to leave it and search on.*its floors are walked from where the bot stands\.$/, 'standing on its floors, going back is offered');
  assert.match(options.leg_east, /Lava in the way stops it at cell 2\. The first 2 cells, in order: 2 of open air with a floor, then lava in the way\./);
  // Jev took leg east: it ends at the first cell, no ground made, and rests from here rather than being tried tick after tick.
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const search = goal.fortressSearch;
  assert(search.legRests.east, 'the leg east rests from here');
  assert.equal(search.target, undefined, 'the leg is ended');
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2, 'asked again once, not every tick');
  ({ options, state } = client.asked[1]);
  assert.equal(options.leg_east, undefined, 'not offered again from here');
  assert.match(state.legsResting[0], /^leg east: ended 0 minutes ago 2 blocks from where it began, no way on \(.*water or lava behind the rock.*\); not offered from here for 5 more minutes/);
  // Jev took the blazes: the walk is on foot, and where it finds no way the way there is asked, leaving it among the ways.
  const before = walks.length;
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(walks[before].onFoot, true, 'the walk to the blazes digs and lays nothing');
  assert.equal(client.asked.length, 3); assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  ({ options, state } = client.asked[2]);
  assert.match(state.stretch, /^where blazes were seen, \d+ blocks off; the walk there on foot failed: No route from here/);
  assert(options.other_way && !options.keep_searching, 'leaving the way, not the fortress');
  assert.equal(search.shunned.length, 1, 'the fortress is not set aside again');
  assert.equal(search.goTo, undefined);
  assert.equal(search.goToEnded.blazes.why, 'Jev chose to leave that way for now');
  assert.equal(goal.mobHunt.sightings[0].tries, 1);
});

test('a way Jev left is set aside as said: not offered again, said with the ways that are, and the blazes about now lead and are a way of their own (mid-242-ac-nether-2-fortress-1, note 570)', async () => {
  // mid-242-ac-nether-2-fortress-1 answered fortress_approach 351 times in ten minutes, other_way 345 of them: each
  // "set aside for ten minutes" set nothing aside, and the next tick offered the same place (109 blocks off, seen
  // forty-seven minutes before) as the only way and asked the way to it again; two blazes thirty-four blocks off went unsaid.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = acFloor();
  const now = Date.now();
  const goal = { mobHunt: { entity: 'blaze', item: 'blaze_rod', sightings: [{ x: -108, y: 77, z: 155, dimension: 'the_nether', at: now - 47 * 60000, seen: 13, inSight: 0 }] },
    fortressSearch: { axis: 1, legs: 70, since: now - 48 * 60000,
      shunned: [{ x: -121, z: 105, radius: 16, until: now + 2 * 60000, at: now - 8 * 60000, why: 'Jev chose to leave it and search on', from: { x: -123, y: 72, z: 106 }, left: ['walk route', 'tunnel'] }] } };
  const client = jevStub(['go_to_blazes', 'other_way', 'leg_north']);
  const actions = { client, navigate: async () => { throw new Error('No route from here'); },
    tunnel: async () => { throw new Error('The staircase toward it is set aside (no safe step toward it (water or lava behind the rock: 1 of the steps nearer))'); } };
  const step = () => findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  await step(); await step();
  assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  assert.equal(Object.keys(client.asked[1].state)[0], 'blazesSeen', 'the blazes lead the way asked too');
  assert.deepEqual(goal.decisions.at(-1).path, ['other_way']);
  const left = goal.fortressSearch.waysLeft;
  assert.equal(left.length, 1);
  assert.deepEqual([left[0].x, left[0].y, left[0].z, left[0].what], [-108, 77, 155, 'where blazes were seen']);
  // Two blazes thirty-odd blocks off, over the open floor.
  bot.entities = { 31: { id: 31, name: 'blaze', type: 'hostile', position: new Vec3(-122.5, 80, 140.5), height: 1.8, width: 0.6, isValid: true },
    32: { id: 32, name: 'blaze', type: 'hostile', position: new Vec3(-120.5, 81, 141.5), height: 1.8, width: 0.6, isValid: true } };
  await step();
  assert.equal(client.asked.length, 3);
  const { options, state } = client.asked[2];
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  assert.equal(options.go_to_blazes, undefined, 'the place left is not offered again within its ten minutes');
  assert.match(state.waysLeft[0], /^where blazes were seen at \(-108, 77, 155\), \d+ blocks off: Jev left the way there 1 minute ago, set aside for 10 minutes more \(the walk there on foot failed: No route from here\)/);
  assert.equal(Object.keys(state)[0], 'blazesSeen');
  assert.match(state.blazesSeen, /^2 blazes about now \(2 in sight\), the nearest 35 blocks off and 8 up at \(-123, 80, 140\); blazes seen 13 times/);
  assert.match(options.go_to_blazes_about, /^Go to the blazes about now: 2 blazes about now/);
});

test('a way chosen that a stall ends is ended with its why, not walked again unasked (note 570)', async () => {
  // The hold on fortress_approach (decisions/repeats.js) raised a stall out of the way to the blazes; state.goTo stood,
  // and the next tick walked the same way and asked it again.
  const { findFortressStep } = require('../src/mob-hunt');
  const repeats = require('../src/decisions/repeats');
  const { bot } = acFloor();
  const goal = { mobHunt: { entity: 'blaze', item: 'blaze_rod', sightings: [] },
    fortressSearch: { axis: 1, legs: 70, goTo: { x: -108, y: 77, z: 155, kind: 'blazes', since: Date.now() } } };
  // Three answers back at once before this one, whatever they were: every way the question offers, so the hold
  // leaves none to ask with (a hold with ways left is asked with those, note 583).
  const now = Date.now();
  bot._answers = { fortress_approach: { streak: [{ choice: 'walk_route', gap: 300, at: now - 1200 }, { choice: 'cross_level', gap: 300, at: now - 900 }, { choice: 'tunnel', gap: 300, at: now - 600 }],
    last: { choice: 'other_way', at: now - 300, mark: repeats.mark(bot), judged: false, goal } } };
  const client = jevStub(['other_way']);
  const actions = { client, navigate: async () => { throw new Error('No route from here'); }, tunnel: async () => { throw new Error('The staircase is set aside'); } };
  await assert.rejects(findFortressStep(bot, new Task('hunt'), goal, () => {}, actions), err => err.name === 'Stalled');
  assert.equal(client.asked.length, 0, 'held, not asked');
  assert.equal(goal.fortressSearch.goTo, undefined, 'the way is ended');
  assert.match(goal.fortressSearch.goToEnded.blazes.why, /^fortress approach: the last 4 answers to this question in a row \(walk route 1 time, cross level 1 time, tunnel 1 time, other way 1 time/);
});

// Lines of sight through a test world: the first cell along the line with a
// full block's box stops it (the game's raycast, cube by cube).
function sightLines(bot) {
  bot.world = { raycast: (from, dir, range) => {
    const cell = from.floored(), step = ['x', 'y', 'z'].map(k => Math.sign(dir[k]));
    const next = ['x', 'y', 'z'].map((k, i) => step[i] ? ((step[i] > 0 ? cell[k] + 1 : cell[k]) - from[k]) / dir[k] : Infinity);
    const delta = ['x', 'y', 'z'].map((k, i) => step[i] ? Math.abs(1 / dir[k]) : Infinity);
    const c = [cell.x, cell.y, cell.z];
    let t = 0;
    for (let n = 0; n < 400; n++) {
      const p = new Vec3(c[0], c[1], c[2]);
      if (n > 0 && bot.blockAt(p)?.boundingBox === 'block') return { position: p, intersect: from.plus(dir.scaled(t)) };
      const i = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
      if (next[i] > range) return null;
      t = next[i]; c[i] += step[i]; next[i] += delta[i];
    }
    return null;
  } };
}
// findBlocks over a box of a test world, nearest first.
function findIn(bot, box) {
  return ({ matching, maxDistance = 128, count = 1 }) => {
    const ids = new Set(Array.isArray(matching) ? matching : [matching]), here = bot.entity.position, out = [];
    for (let x = box.x[0]; x <= box.x[1]; x++) for (let y = box.y[0]; y <= box.y[1]; y++) for (let z = box.z[0]; z <= box.z[1]; z++) {
      const p = new Vec3(x, y, z), b = bot.blockAt(p);
      if (ids.has(registry.blocksByName[b.name]?.id) && p.distanceTo(here) <= maxDistance) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(here) - b.distanceTo(here)).slice(0, count);
  };
}
// A fortress corridor: a floor of nether bricks at y 64 from x 0 to 40 and z -1 to 1, walled two high at z -2 and 2,
// roofed at y 68, open at both ends over the lava sea. `extra` names blocks of its own first (null for the rule's own).
function corridor({ length = 40, extra = () => undefined, walls = true } = {}) {
  const floor = p => p.y === 64 && p.z >= -1 && p.z <= 1 && p.x >= 0 && p.x <= length;
  const wall = p => walls && (p.z === -2 || p.z === 2) && p.y >= 64 && p.y <= 67 && p.x >= 0 && p.x <= length;
  const roof = p => walls && p.y === 68 && p.z >= -2 && p.z <= 2 && p.x >= 0 && p.x <= length;
  const rock = p => { const e = extra(p); return e !== undefined ? e : p.y <= 31 ? 'lava' : floor(p) || wall(p) || roof(p) ? 'nether_bricks' : null; };
  const world = netherWorld(new Vec3(0.5, 65, 0.5), rock);
  sightLines(world.bot);
  world.bot.findBlocks = findIn(world.bot, { x: [-3, length + 3], y: [58, 69], z: [-6, 6] });
  return world;
}
// The pathfinder as a stub: the walk arrives where it was sent, unless `refuse` says why not.
function walker(bot, walks, refuse = () => null) {
  return async (b, t, g, o = {}) => {
    walks.push({ x: g.x, y: g.y, z: g.z, onFoot: !!o.onFoot });
    const why = refuse(g);
    if (why) throw new Error(why);
    bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5);
  };
}

test('in a fortress the bot walks its floors on foot to where they run on unseen, keeps what it walked, and with nothing left to walk the choice is Jev\'s with the map (mid-242-aa-fortress-1, note 557)', async () => {
  // mid-242-aa-fortress-1 set out for bricks picked from everything within 128 blocks, behind walls or not: each pass
  // reached two of five, the rest "No path" and staircases dug through the walls, and after eleven minutes it left.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = corridor();
  const goal = { fortressSearch: { axis: 1, legs: 13 } };
  const walks = [], tunnels = [];
  const client = jevStub(['stay_in_fortress', 'leg_north']);
  const actions = { client, navigate: walker(bot, walks), tunnel: async (...a) => tunnels.push(a) };
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert(walks.length >= 1 && walks.every(w => w.onFoot), 'walked, on foot: nothing dug or laid');
  assert.equal(tunnels.length, 0);
  assert(Math.max(...walks.map(w => w.x)) >= 38, `to the corridor's open end: ${JSON.stringify(walks)}`);
  assert.equal(client.asked.length, 1, 'asked once there is nothing left to walk to');
  const { options, state } = client.asked[0];
  const map = state.fortressInView.map;
  assert.equal(map.floorsSeen, 123, 'every floor of the corridor seen');
  assert.match(map.waysOnFoot, /^none: every floor joined to here that runs on into unseen space has been walked/);
  assert.match(options.stay_in_fortress, /^Stay in the fortress and walk its corridors again for blazes for 3 minutes, the least lately walked first/);
  assert(options.leg_north, 'the legs beside it');
  assert.equal(options.wait_at_spawner, undefined, 'no spawner seen');
  // Stay: the least lately walked floors, twelve or more steps off, walked again.
  const before = walks.length;
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(walks.length, before + 1); assert(goal.step.patrolling, 'walking its corridors again');
  assert(walks.at(-1).x <= 10 && walks.at(-1).onFoot, 'back toward where it began, the least lately walked');
  // The walk over, the next ask: a leg away, and the section is left behind.
  goal.fortressSearch.patrolUntil = Date.now() - 1;
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2); assert(goal.fortressSearch.leaving, 'left as Jev chose');
  assert(Object.values(goal.fortressSearch.map.cells).filter(c => c[0]).length >= 15, `what was walked is kept: ${Object.values(goal.fortressSearch.map.cells).filter(c => c[0]).length}`);
});

test('a spawner behind a wall is not known; seen through an opening, waiting by it is offered with the way there (note 557)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  let window = false;
  // A spawner in a room north of the corridor, behind its wall; a window in the wall at x 19 to 21 when `window`.
  const extra = p => p.x === 20 && p.y === 65 && p.z === -4 ? 'spawner' : window && p.z === -2 && p.x >= 19 && p.x <= 21 && p.y >= 65 && p.y <= 66 ? null : undefined;
  const { bot } = corridor({ extra });
  const goal = { fortressSearch: { axis: 1, legs: 13 } };
  const walks = [];
  const client = jevStub(['leg_east', 'wait_at_spawner']);
  const actions = { client, navigate: walker(bot, walks), tunnel: async () => {} };
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  let { options, state } = client.asked[0];
  assert.equal(options.wait_at_spawner, undefined, 'behind the wall, not known');
  assert.equal(state.fortressInView.map.spawnersSeen, undefined);
  // The same corridor with a window: walked past it, the spawner is seen.
  window = true;
  const goal2 = { fortressSearch: { axis: 1, legs: 13 } };
  bot.entity.position = new Vec3(0.5, 65, 0.5);
  for (let i = 0; i < 20 && client.asked.length < 2; i++) await findFortressStep(bot, new Task('hunt'), goal2, () => {}, actions);
  ({ options, state } = client.asked[1]);
  assert.match(state.fortressInView.map.spawnersSeen[0], /^\(20, 65, -4\), \d+ blocks off, about \d+ steps along the floors$/);
  assert.match(options.wait_at_spawner, /^Wait by the spawner seen at \(20, 65, -4\), \d+ blocks off, for 3 minutes: .*Floors seen join it to where the bot stands, about \d+ steps\./);
  // Taken: the walk to the cage is on foot, and there it waits, a wait the stall watch lets be.
  const before = walks.length;
  await findFortressStep(bot, new Task('hunt'), goal2, () => {}, actions);
  assert.equal(walks.length, before + 1); assert(walks.at(-1).onFoot);
  assert.equal(goal2.step.action, 'wait_at_spawner');
  await findFortressStep(bot, new Task('hunt'), goal2, () => {}, actions);
  assert.equal(walks.length, before + 1, 'at the cage, it waits');
  assert.equal(require('../src/stillness').permittedWait(bot, goal2), 'waiting by a spawner');
});

test('on the fortress\'s floor, floors seen across a gap of two are Jev\'s to cross, said with the gap, and the span over it reaches them (mid-235-p-nether-3-fortress-3, notes 556 and 557)', async () => {
  // mid-235-p-nether-3-fortress-3 stood on its fortress's floor with the next stretch across a gap of two: every pass for
  // an hour reached nothing, the span never offered.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot, laid } = corridor({ walls: false, extra: p => p.y === 64 && (p.x === 10 || p.x === 11) ? null : undefined });
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  const walks = [], tunnels = [];
  const refused = g => g.x >= 12 ? 'No route from here to (13, 65, 0) (noPath): the way passes along a drop that would kill' : null;
  const client = jevStub(['unwalked_1', 'cross_level']);
  const actions = { client, dig: async () => {}, navigate: walker(bot, walks, refused), tunnel: async (...a) => tunnels.push(a) };
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  let { options } = client.asked[0];
  assert.match(options.unwalked_1, /^Go to the fortress's unwalked floors seen 3 blocks off, at \(12, 65, -?\d\): 87 floors seen there, .*no floor seen joins them to where the bot stands: the way across along the ground is 3 cells from \(9, 65, -?\d\) to \(12, 65, -?\d\): 2 of open air with no floor, to span, 1 of floor, about \d+ seconds\./);
  // Chosen: the walk is on foot; it finds no way, and the way there is asked, the span among the ways.
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2); assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  const { state } = client.asked[1];
  ({ options } = client.asked[1]);
  assert.match(state.stretch, /^unwalked floors of the fortress, seen across a gap, \d+ blocks off; the walk there on foot failed: No route/);
  assert.match(options.cross_level, /laying 2 blocks over open air and lava \(2 of them over lava\)/);
  assert.match(options.walk_route, /Tried on this approach once and ended no nearer: No route from here to \(13, 65, 0\)/);
  assert(options.other_way && !options.keep_searching);
  assert.equal(tunnels.length, 0, 'the staircase is one of the ways, not run unasked');
  assert.equal(laid.size, 2, 'a block in each cell of the gap');
  assert(bot.entity.position.x >= 11, `across it, at the far floor: ${bot.entity.position}`);
});

// A step with the crouch held: to the cell the look was aimed at, at the look's height (a step up onto a laid block).
function stepsUp(bot) {
  const set = bot.setControlState;
  let look = null;
  const lookAt = bot.lookAt;
  bot.lookAt = async p => { look = p; return lookAt(p); };
  bot.setControlState = (name, on) => {
    set(name, on);
    if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, Math.round(look.y - 1.6), Math.floor(look.z) + 0.5);
  };
}

test('on a fortress floor cut off by lava lying on its corridor, the way across is said along the ground and covering the lava crosses it (mid-235-q-nether-1-fortress-3, note 564)', async () => {
  // mid-235-q-nether-1-fortress-3 paced a small room for minutes, its corridor on east flooded with lava one deep; the
  // floors past it were offered as "4 of lava, 2 of wall or rock" on a straight line through the wall, and no way across
  // lava lying on a floor existed: the span refuses "lava in the way".
  const { findFortressStep } = require('../src/mob-hunt');
  const lava = p => p.y === 65 && p.x >= 12 && p.x <= 17 && p.z >= -1 && p.z <= 1;
  const { bot, laid } = corridor({ extra: p => lava(p) ? 'lava' : undefined });
  stepsUp(bot);
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  const walks = [], tunnels = [];
  const refused = g => g.x >= 12 ? 'No path to the goal!' : null;
  const client = jevStub(['unwalked_1', 'cover_lava']);
  const actions = { client, dig: async () => {}, navigate: walker(bot, walks, refused), tunnel: async (...a) => tunnels.push(a) };
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  let { options } = client.asked[0];
  assert(walks.every(w => w.onFoot && w.x <= 11), `walked on foot to the lava's edge only: ${JSON.stringify(walks)}`);
  assert.match(options.unwalked_1, /no floor seen joins them to where the bot stands: the way across along the ground is \d+ cells from \(11, 65, -?\d\) to \(18, 65, -?\d\): 6 of lava lying on the floor, to cover \(a block each, walked a block up\), 1 of floor, about \d+ seconds; round the lava instead, \d+ cells from .* \d+ of open air with no floor, to span, .*about \d+ seconds\./);
  // Chosen: the walk on foot finds no way, and the ways across are asked, covering the lava among them.
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2); assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  ({ options } = client.asked[1]);
  assert.match(options.cover_lava, /^Cover the lava lying on the floor on the way to unwalked floors of the fortress, seen across a gap: 7 cells from \(11, 65, -?\d\) to \(18, 65, -?\d\): 6 of lava lying on the floor/);
  assert.match(options.cover_lava, /6 blocks laid of the 64 carried, 58 left after\. About \d+ seconds\./);
  assert.match(options.cover_lava, /The lava is flowing, with no source seen among the \d+ lava cells followed from it/);
  assert.match(options.cover_lava, /\d+ of its cells are beside lava: a misstep or a push there puts the bot in it, about 8 health a second while in it and burning up to 15 seconds after/);
  assert.equal(options.scoop_lava, undefined, 'no bucket carried, and no source on the way');
  assert.equal(options.dig_through, undefined, 'walls of nether brick: nothing to dig round');
  assert.match(options.span_round, /^Go round the lava to unwalked floors of the fortress, seen across a gap along the ground, laying a one-wide span where there is no floor: \d+ cells from/);
  assert(options.other_way);
  // Covered and walked: a block into each cell of the lava, a block up, and down onto the floor past it.
  assert.equal(laid.size, 6, `a block laid into each cell of lava: ${[...laid]}`);
  assert([...laid].every(k => /^\((1[2-7]), 65, -?\d\)$/.test(k)), [...laid].join(' '));
  assert.equal(tunnels.length, 0);
  assert(bot.entity.position.x >= 18 && bot.entity.position.y === 65, `across it, on the floor past the lava: ${bot.entity.position}`);
});

test('the way across along the ground digs round the lava through natural rock, scoops sources with a bucket carried, and digs through a mouth filled with netherrack (note 564)', () => {
  const fm = require('../src/fortress-map');
  const { crossingFor, crossingOptions } = require('../src/mob-hunt');
  // The corridor with lava on its floor at x 12 to 17, its south wall netherrack from x 9 to 20 and z 2 to 4 (the rock
  // round it), the lava at x 12 and 13 sources.
  const rockBeside = p => p.x >= 9 && p.x <= 20 && p.z >= 2 && p.z <= 4 && p.y >= 64 && p.y <= 67 ? 'netherrack' : undefined;
  const lava = p => p.y === 65 && p.x >= 12 && p.x <= 17 && p.z >= -1 && p.z <= 1;
  const { bot } = corridor({ extra: p => lava(p) ? 'lava' : rockBeside(p) });
  const at = bot.blockAt;
  // Netherrack by hand: two seconds a block.
  bot.blockAt = p => { const b = at(p); if (b.name === 'lava') b.metadata = p.x <= 13 ? 0 : 3; b.digTime = () => 2000; return b; };
  // The map as walked to the lava's edge: the floors either side of it seen, those this side walked.
  const map = { cells: {}, failed: {}, spawners: [], chests: [] };
  for (let x = 0; x <= 40; x++) for (let z = -1; z <= 1; z++) if (x < 12 || x > 17) map.cells[`${x},64,${z}`] = [x < 12 ? 1 : 0, 0, 0];
  bot.entity.position = new Vec3(11.5, 65, 0.5);
  const planned = fm.plan(bot, map);
  assert.equal(planned.groups.length, 1);
  const across = crossingFor(bot, map, planned, planned.groups[0].key);
  assert.equal(across.way.cover, 6);
  assert.equal(across.way.lavaSources, 2, 'two of the cells on the way are sources');
  assert(across.round && across.round.digs >= 4 && !across.round.cover, `round the lava through the rock: ${JSON.stringify(across.round)}`);
  assert(across.round.cells.every(c => !lava(new Vec3(c.x, c.y, c.z)) && !lava(new Vec3(c.x, c.y - 1, c.z))), 'no cell of the way round in or on the lava');
  assert.match(across.says, /; round the lava instead, \d+ cells from \(\d+, 65, -?\d\) to \(\d+, 65, -?\d\): \d+ of rock filling the way, to dig \(\d+ blocks, about [\d.]+ seconds\)/);
  // With a bucket carried, scooping is a way; digging round is one; each priced.
  bot.inventory.items = () => [{ name: 'netherrack', count: 64, type: 1 }, { name: 'bucket', count: 1, type: 2 }];
  let options = crossingOptions(bot, new Task('hunt'), 'floors seen', across, {});
  assert.deepEqual(Object.keys(options).sort(), ['cover_lava', 'dig_through', 'scoop_lava']);
  assert.match(options.scoop_lava.description, /^Scoop the lava on the way to floors seen with the 1 empty bucket carried: 2 of its 6 cells on the way are sources, and a bucket takes a source each \(flowing lava cannot be scooped/);
  assert.match(options.dig_through.description, /^Dig through the rock filling the way to floors seen, round the lava: .* No pickaxe carried: the rock is dug by hand, and netherrack dug by hand drops nothing\. Rock is dug only where no lava or water lies behind it\./);
  // A corridor's mouth filled with netherrack, the floor seen past it: dug through, no lava.
  const plug = p => p.x >= 12 && p.x <= 13 && p.y >= 65 && p.y <= 67 && p.z >= -1 && p.z <= 1 ? 'netherrack' : undefined;
  const { bot: b2 } = corridor({ extra: plug });
  b2.entity.position = new Vec3(11.5, 65, 0.5);
  const map2 = { cells: {}, failed: {}, spawners: [], chests: [] };
  for (let x = 0; x <= 40; x++) for (let z = -1; z <= 1; z++) if (x < 12 || x > 13) map2.cells[`${x},64,${z}`] = [x < 12 ? 1 : 0, 0, 0];
  const planned2 = fm.plan(b2, map2);
  const across2 = crossingFor(b2, map2, planned2, planned2.groups[0].key);
  assert.equal(across2.way.digCells, 2); assert.equal(across2.way.digs, 4);
  options = crossingOptions(b2, new Task('hunt'), 'floors seen', across2, {});
  assert.deepEqual(Object.keys(options), ['dig_through']);
  // Two parts past the same lava (the floor past it broken at x 25) are one way across, offered as one.
  const { unwalkedParts } = require('../src/mob-hunt');
  const { bot: b3 } = corridor({ extra: p => lava(p) ? 'lava' : p.y === 64 && p.x === 25 && Math.abs(p.z) <= 1 ? null : undefined });
  b3.entity.position = new Vec3(11.5, 65, 0.5);
  const map3 = { cells: {}, failed: {}, spawners: [], chests: [] };
  for (let x = 0; x <= 40; x++) for (let z = -1; z <= 1; z++) if ((x < 12 || x > 17) && x !== 25) map3.cells[`${x},64,${z}`] = [x < 12 ? 1 : 0, 0, 0];
  const planned3 = fm.plan(b3, map3);
  assert.equal(planned3.groups.length, 2);
  const parts = unwalkedParts(b3, map3, planned3);
  assert.equal(parts.length, 1, 'one way across the lava to both');
  assert.deepEqual(parts[0].groups.map(g => g.cells), [21, 45]);
  assert.match(options.dig_through.description, /^Dig through the rock filling the way to floors seen: 3 cells from \(11, 65, -?\d\) to \(14, 65, -?\d\): 2 of rock filling the way, to dig \(4 blocks, about 1\.6 seconds\), 1 of floor\./);
});

test('walking a small room again is said as pacing it: how far the floors joined to here run (mid-235-q-nether-1-fortress-3, note 564)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = corridor({ length: 16 });
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  const walks = [];
  const client = jevStub(['leg_north']);
  const actions = { client, navigate: walker(bot, walks), tunnel: async () => {} };
  for (let i = 0; i < 20 && !client.asked.length; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const { options } = client.asked[0];
  assert.match(options.stay_in_fortress, /; the 51 floors joined to here lie within 17 by 3 blocks, and walking them again is walking back and forth in that, and no spawner has been seen;/);
});

test('after six empty patrols the sweep leaves along the fortress, and the section left behind does not pull it back', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = corridor();
  const goal = { fortressSearch: { axis: 1, legs: 3 } };
  const walks = [];
  const actions = { navigate: walker(bot, walks), tunnel: async () => {} };
  // Five times asked here before: walked to its end, the sixth ask without Jev is a leg along the corridor.
  goal.fortressSearch.patrols = 5;
  for (let i = 0; i < 20 && !goal.fortressSearch.leaving; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  const state = goal.fortressSearch;
  assert(state.leaving, 'the section is left behind');
  assert.equal(state.heading, 2, 'along the corridor, back the way it runs (-x from its east end)');
  // Out along the leg the same bricks are still in view: the leg goes on.
  bot.entity.position = new Vec3(30.5, 65, 0.5);
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
  const rock = { name: 'netherrack', boundingBox: 'block', diggable: true }, air = { name: 'air', boundingBox: 'empty' };
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
  assert.match(fitnessSays(bare), /the kit is short: no iron or better sword carried, no iron or better helmet worn, no iron or better chestplate worn, no iron or better leggings worn, no iron, diamond, netherite or golden boots worn, no shield in the off hand\./);
  // A stone sword carried is said, not "no sword or axe carried" (note 614:
  // mid-242-aa-fortress-5 was told so beside options striking with it).
  const stone = make(20, false); stone.inventory = { items: () => [{ name: 'stone_sword' }], slots: {} };
  assert.match(fitnessSays(stone), /the kit is short: no iron or better sword carried \(a stone sword is\), no iron or better helmet worn/);
  assert.doesNotMatch(fitnessSays(stone), /no sword or axe carried/);
  // A passive chase has no armour behind it, so fire still calls it off.
  assert(!canBegin(make(18, true), { item: 'feather', passive: true }), 'a chase in shirtsleeves stops for fire');
  // In view at nine health, the fight is asked, the fitness on every option and in the state.
  const { bot, task, goal } = fixture('blaze');
  bot.health = 9; bot.food = 12;
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}, client), false, 'deferred, as Jev chose');
  assert(asked, 'asked, where the old gate refused without a word');
  assert.match(asked.options.hunt_7, /Health 9 \(under the 14 the code once required to start a fight\); hunger 12: health does not come back under eighteen/);
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
  // Rows of three along x, each a floor beside a floor (note 613: a lone brick top is no floor).
  const pocket = Array.from({ length: 30 }, (_, i) => new Vec3(1 + (i % 3), 64 + Math.floor(i / 9), (Math.floor(i / 3) % 3) * 3 - 4));
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 65, 0.5) }, chat() {},
    blockAt: () => clear, findBlocks: () => pocket };
  const goal = { fortressSearch: { axis: 1, heading: 1, legs: 3, legSince: Date.now() - 60000, target: { x: 0, y: 65, z: 96 } } };
  const tunnels = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target) => tunnels.push([target.x, target.z]) });
  assert.equal(goal.fortressSearch.shunned.length, 1, 'the bricks are shunned');
  assert.deepEqual(tunnels, [[0, 96]], 'and the leg in hand is walked, not a new one begun');
  assert.equal(goal.fortressSearch.legs, 3);
});

// The look keeps the nearest it counts, as mineflayer's findBlocks does.
function nearestBricks(bricks) {
  return ({ matching, count, point }, bot) => matching === registry.blocksByName.spawner.id ? []
    : bricks.slice().sort((a, b) => a.distanceTo(point) - b.distanceTo(point)).slice(0, count);
}

test('a fortress whose walls fill the nearest five hundred bricks is still seen to its far floors: its stretches are walked, not set aside as nothing to walk to (mid-235-p-fortress-7, note 528)', async () => {
  // mid-235-p-fortress-7 stood on its fortress's floor with 512 bricks in view, none past ten blocks; the patrol found
  // no stretch twelve off, set the fortress aside, and back_to_fortress was chosen and undone at once six times.
  const { findFortressStep } = require('../src/mob-hunt');
  const deck = p => p.y === 64 && p.z >= -1 && p.z <= 1 && p.x >= -3 && p.x <= 40;
  const wall = p => p.x >= -10 && p.x <= 10 && p.z >= 2 && p.z <= 6 && p.y >= 60 && p.y <= 75;
  const bricks = [];
  for (let x = -10; x <= 40; x++) for (let z = -1; z <= 6; z++) for (let y = 60; y <= 75; y++) { const p = new Vec3(x, y, z); if (deck(p) || wall(p)) bricks.push(p); }
  const { bot } = netherWorld(new Vec3(0.5, 65, 0.5), p => deck(p) || wall(p) ? 'nether_bricks' : p.y <= 31 ? 'lava' : null);
  const find = nearestBricks(bricks);
  bot.findBlocks = o => find({ ...o, point: o.point || bot.entity.position.floored() });
  assert(find({ matching: 0, count: 512, point: new Vec3(0, 65, 0) }).every(b => Math.hypot(b.x, b.z) < 12), 'the nearest 512 are all within twelve');
  const walked = [];
  const goal = { fortressSearch: { axis: 1, legs: 15 } };
  sightLines(bot);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client: jevStub([]), navigate: async (b, t, g, o = {}) => { walked.push([g.x, g.z, o.onFoot]); }, tunnel: async () => {} });
  assert.equal((goal.fortressSearch.shunned || []).length, 0, 'not set aside');
  assert.equal(walked.length, 1, 'its deck is walked');
  assert(walked[0][2] && goal.step.exploring, 'on foot, to where it runs on unseen');
  assert(Object.keys(goal.fortressSearch.map.cells).some(k => +k.split(',')[0] >= 30), 'its far floors seen past the walls');
});

test('a fortress set aside as nothing to walk to says so, and going back is not offered from the spot that found it (note 528)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const clear = { boundingBox: 'empty' };
  // Rows of three along x, each a floor beside a floor (note 613: a lone brick top is no floor).
  const pocket = Array.from({ length: 30 }, (_, i) => new Vec3(1 + (i % 3), 64 + Math.floor(i / 9), (Math.floor(i / 3) % 3) * 3 - 4));
  const bot = { registry, game: { dimension: 'the_nether' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 65, 0.5) }, entities: {}, chat() {},
    inventory: { items: () => [] }, blockAt: () => clear, findBlocks: () => pocket };
  const goal = { fortressSearch: { axis: 1, legs: 3 } };
  const client = jevStub(['leg_north', 'back_to_fortress']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} });
  assert.equal(goal.fortressSearch.shunned.length, 1);
  assert.equal(client.asked.length, 1);
  let { options, state } = client.asked[0];
  assert.equal(options.back_to_fortress, undefined, 'from where it was found empty, going back does nothing');
  assert.match(state.fortressInView.setAside, /^set aside 0 minutes ago, for 10 minutes more: none of its floors seen from where the bot stood runs on into unseen space, lies unwalked across a gap, or is twelve steps off to walk again: nothing to walk to; the bot stands where that was found/);
  // Elsewhere, going back is offered with the same why.
  delete goal.fortressSearch.target;
  bot.entity.position = new Vec3(0.5, 65, 20.5);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, tunnel: async () => {} });
  assert.equal(client.asked.length, 2);
  ({ options } = client.asked[1]);
  assert.match(options.back_to_fortress, /set aside 0 minutes ago, for 10 minutes more: none of its floors seen from where the bot stood/);
  assert.doesNotMatch(options.back_to_fortress, /face not approached/);
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

test('a sweep with every leg failing and too few blocks to cross is offered the portal back for more, Jev\'s to take', async () => {
  // mid-87-k: on an island in the lava sea with eighteen blocks, twelve legs turned in four minutes. The code once chose the
  // restock itself after four failures, netherrack only (note 480); now it is an option beside the legs.
  const { findFortressStep } = require('../src/mob-hunt');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: {}, entity: { position: new Vec3(57.5, 32, 1.5) },
    inventory: { items: () => [{ name: 'cobblestone', count: 7 }, { name: 'cobbled_deepslate', count: 11 }] },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 32 ? 'lava' : 'air', position: p, boundingBox: 'empty' }), world: { raycast: () => null }, chat() {} };
  const goal = { portals: [{ dimension: 'nether', x: 40, y: 70, z: 1 }], fortressSearch: { axis: 1, legs: 9, legFails: 3, legSince: Date.now() - 60000, legFrom: { x: 57, z: 1 }, target: { x: 153, y: 40, z: 1 } } };
  let back = 0;
  const actions = { navigate: async () => {}, tunnel: async () => {}, acquireStep: async () => assert.fail('nothing to mine within reach'), returnOverworld: async () => { back++; } };
  await findFortressStep(bot, new Task('fortress'), goal, () => {}, actions);
  assert.equal(back, 0, 'not the code\'s to choose');
  // The leg east made no ground and rests from here; five minutes on it is offered again.
  goal.fortressSearch.legRests.east.until = Date.now() - 1;
  const client = jevStub(['return_for_blocks']);
  await findFortressStep(bot, new Task('fortress'), goal, () => {}, { ...actions, client });
  const { options } = client.asked[0];
  assert.match(options.leg_east, /it needs 96 blocks laid, crouched, about 1\.4 seconds a cell, 18 carried: the blocks run out at cell 18/);
  assert.equal(options.restock_blocks, undefined, 'nothing within sixteen blocks to mine');
  assert.match(options.return_for_blocks, /the nearest known 18 blocks off at 40, 70, 1/);
  assert.equal(back, 1, 'back through the portal, as Jev chose');
});

test('hungry in the Nether with nothing to eat, the hunt asks before going back for food, with the trip and the hour it comes out at', async () => {
  // mid-202-o-nether-3, -4 and mid-218-m-nether-1 (note 495): at hunger seventeen with nothing to eat the hunt went back
  // through the portal by rule, unasked, and came out into the night.
  const { bot, task, goal } = fixture();
  bot.entities = {}; bot.food = 17; bot.time = { timeOfDay: 12500 };
  goal.portals = [{ x: 20, y: 102, z: 7, dimension: 'nether' }];
  let back = 0;
  const actions = { returnOverworld: async () => { back++; }, navigate: async () => {}, acquireStep: async () => {} };
  const client = jevStub(['keep_on', 'go_back']);
  await prepareMobHunt(bot, task, { entity: 'blaze', item: 'blaze_rod', count: 1 }, goal, () => {}, { ...actions, client });
  assert.equal(back, 0, 'staying, as Jev chose');
  assert.equal(client.asked.length, 1);
  const { options } = client.asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['go_back', 'keep_on', 'restock_food']);
  assert.match(options.restock_food, /^Get food here before going back, the way asked next with each priced:|^Get food here before going on/);
  assert.match(options.go_back, /The nearest portal remembered is 21 blocks off/);
  assert.match(options.go_back, /comes out in the Overworld at night/);
  assert.match(options.keep_on, /hunger 17/);
  // What a hit costs at this health, fight or no fight (mid-235-p-fortress-7 kept on at 4.2, note 528).
  assert.match(options.keep_on, /a blaze in sight shoots from as far as forty-eight blocks and a ghast from sixty-four, fight or no fight\. One blaze fireball through what is worn/);
  assert.match(client.asked[0].state.whatAHitCosts, /fireballs? ends? it/);
  // Asked again once staying lapses: back, as Jev chose.
  require('../src/progress').attemptsFor(goal).clear('nether_return', 'food');
  await prepareMobHunt(bot, task, { entity: 'blaze', item: 'blaze_rod', count: 1 }, goal, () => {}, { ...actions, client });
  assert.equal(back, 1);
  assert.equal(goal.step.action, 'return_for_food');
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
  // With a blaze at the bricks the state carries what the bot's fights with blazes came to (note 631); a landing's cost is
  // its hit and four ticks of fire, not five (no armour here: 5 and 4, 9), said with how many end it from separate volleys and within one.
  assert.match(state.playedRecord, /^In the trials of 2026-09-28, 415 fights with blazes/);
  assert.match(options.tunnel, /about 5 hit and 4 burn over the next five seconds \(four ticks of fire; 9 for one landing\)/);
  assert.match(options.tunnel, /Health 20, coming back about one each four seconds at hunger 20: about 3 fireballs end it, each from its own volley; 4 within one volley, whose fire is one fire\./);
});

test('a resting staircase is not offered fresh as seek_fortress_height', async () => {
  // mid-202-o-nether-2 (note 500): seek_fortress_height north, chosen at 0.64 to 0.87 for three minutes with its staircase resting since 20:53,
  // each step throwing before a stair; the failure was filed under leg_north ("564 tries from there") and the option said nothing.
  const { findFortressStep, chooseLeg, fortressLegTarget } = require('../src/mob-hunt');
  const { setAside } = require('../src/progress');
  const rock = p => (p.z >= 1 && p.z <= 40 && p.x === 0) ? (p.y < 70 ? 'netherrack' : null) : 'netherrack';
  const here = new Vec3(0.5, 100, 0.5);
  const { bot } = netherWorld(here, rock);
  const rest = (goal, i, why) => { const t = fortressLegTarget({ heading: i, legMode: 'descend' }, here);
    setAside(goal, 'staircase', { x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 }, why, 3 * 60000); };
  // South has the open air, and its staircase rests: the heading offered is another, and south's rest is said.
  const goal = {};
  rest(goal, 1, 'refusing to open a drop');
  const client = jevStub(['seek_fortress_height']);
  const state = { legs: 2 };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  let { options } = client.asked[0];
  assert.match(options.seek_fortress_height, /Dig a staircase down toward y 64 heading (east|west|north)/);
  assert.match(options.seek_fortress_height, /Not heading south: the staircase toward it is set aside \(refusing to open a drop\), taken up again in 3 minutes/);
  assert.notEqual(state.heading, 1, 'not the resting heading');
  // Every heading resting: still offered, with its rest said.
  for (const i of [0, 2, 3]) rest(goal, i, 'lava behind the next stair');
  const again = jevStub(['leg_east']);
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client: again, navigate: async () => {}, tunnel: async () => {} }, { legs: 2 });
  options = again.asked[0].options;
  assert.match(options.seek_fortress_height, /heading south, .*The staircase toward it is set aside \(refusing to open a drop\), taken up again in 3 minutes: taken now, it digs nothing until then\./);
  // A seeking leg that fails is kept as its own (seek_south), not as leg_south, and said with the option.
  const goal2 = { fortressSearch: { legs: 3, heading: 1, lastHeading: 1, legMode: 'descend', target: { x: 1, y: 64, z: 97 }, legFrom: { x: 0, z: 0 }, legSince: Date.now() } };
  const stalled = async () => { throw Object.assign(new Error('Staircase toward (1, 64, 97) stalled: refusing to open a drop'), { name: 'StaircaseStalled' }); };
  await findFortressStep(bot, new Task('hunt'), goal2, () => {}, { navigate: async () => {}, tunnel: stalled });
  assert.match(goal2.fortressSearch.legHistory.seek_south.ended, /stalled: refusing to open a drop/);
  assert.equal(goal2.fortressSearch.legHistory.south, undefined, 'not filed under the level leg');
  assert(goal2.fortressSearch.legRests.seek_south && !goal2.fortressSearch.legRests.south, 'the staircase rests, filed as its own');
  goal2.fortressSearch.legRests.seek_south.until = Date.now() - 1;
  const third = jevStub(['leg_east']);
  await chooseLeg(bot, new Task('hunt'), goal2, () => {}, { client: third, navigate: async () => {}, tunnel: async () => {} }, goal2.fortressSearch);
  options = third.asked[0].options;
  assert.match(options.seek_fortress_height, /heading south.*The last staircase this way, begun 1 blocks from here, ended no nearer: Staircase toward \(1, 64, 97\) stalled/);
  assert.doesNotMatch(options.leg_south, /ended no nearer/);
});

test('fit to fight is health and food, not the kit: the kit is for Jev to weigh (mid-227-r-nether-4)', () => {
  const { fitToFight } = require('../src/mob-policy');
  const bot = { health: 20, food: 19, entity: { metadata: [] }, inventory: { items: () => [{ name: 'stone_sword', count: 1 }], slots: [] }, registry: require('minecraft-data')('26.1') };
  assert.equal(fitToFight(bot), true, 'no iron worn, full health and food: fit');
  bot.health = 6;
  assert.equal(fitToFight(bot), false);
});

// The hunt's fixture in a world of nether brick from the registry (the
// game's dig times), `solid` where the brick is and `lava` where lava is,
// an iron pickaxe carried.
function brickHunt(solid, { lava = () => false } = {}) {
  const f = fixture('blaze');
  const Block = require('prismarine-block')(registry), cache = new Map();
  f.bot.blockAt = p => {
    const at = p.floored(), key = `${at}`;
    if (!cache.has(key)) { const b = Block.fromStateId(registry.blocksByName[lava(at) ? 'lava' : solid(at) ? 'nether_bricks' : 'air'].defaultState); b.position = at; cache.set(key, b); }
    return cache.get(key);
  };
  f.bot.findBlocks = ({ matching, maxDistance = 16, count = 1, point }) => {
    const ids = [].concat(matching), at = point || f.bot.entity.position, out = [];
    for (let x = -10; x <= 10; x++) for (let y = -3; y <= 3; y++) for (let z = -10; z <= 10; z++) {
      const p = at.floored().offset(x, y, z);
      if (p.distanceTo(at) <= maxDistance && ids.includes(f.bot.blockAt(p).type)) out.push(p);
    }
    return out.sort((a, b) => a.distanceTo(at) - b.distanceTo(at)).slice(0, count);
  };
  f.slots[10] = { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id, slot: 10, durabilityUsed: 0 };
  f.bot.dig = async () => {};
  return f;
}

test('a blaze hunt beside a nether-brick wall is offered the hole dug into it and the wall at the back, the dig seconds from the pickaxe, beside the fight in the open (notes 509, 512, 514)', async () => {
  // Brick floor, a brick mass to the west (x <= -1); the blaze six blocks east.
  const { bot, task, target, goal } = brickHunt(p => p.y <= 63 || (p.x <= -1 && p.y <= 67));
  target.position = new Vec3(6.5, 64.5, 0.5);
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}, client), false, 'deferred');
  assert(asked, 'asked');
  assert(asked.options.hunt_7, Object.keys(asked.options).join(','));
  const { blockDigMs } = require('../src/bunker');
  const secs = Math.round(2 * blockDigMs(bot, bot.blockAt(new Vec3(-1, 64, 0))) / 100) / 10;
  assert.match(asked.options.dig_in_and_fight, new RegExp(`^Dig a hole one wide and two high into the nether bricks beside the bot \\(2 blocks with the iron pickaxe, about ${secs} seconds? of digging`));
  assert.match(asked.options.dig_in_and_fight, /Rods that fall near are picked up between volleys\./);
  assert.match(asked.options.dig_in_and_fight, /Health 20; hunger 20/, 'the fitness said on it too');
  assert.match(asked.options.back_to_wall, /^Stay on footing with a wall at its back/);
  // Left for now, the stands are left too: not asked again each pass.
  const { isSetAside } = require('../src/progress');
  assert(isSetAside(goal, 'hunt_stand', 'blaze'));
});

test('a blaze over the lava beside a fortress bridge is not walked under: the fight goes to a stand, and the push is said where the bot stands (note 509)', async () => {
  const { combatRoute, combatMovement } = require('../src/mob-hunt');
  // A brick bridge at y 63 from x -6 to 2 over the lava sea at y 40; the bot at x 0, the edge three blocks east.
  const { bot, task, target, goal } = brickHunt(p => p.y === 63 && p.x <= 2 && p.x >= -6 && Math.abs(p.z) <= 3, { lava: p => p.y <= 40 });
  // The route under the blaze ends at the bridge's edge, the lava one block off.
  target.position = new Vec3(4.5, 66, 0.5);
  bot.pathfinder.getPathTo = () => ({ status: 'success', path: [{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }] });
  const pushed = [];
  const movement = combatMovement(bot);
  try { assert.equal(await combatRoute(bot, task, target, movement, 400, { pushed }), null, 'no fight at the edge'); }
  finally { movement.restore(); }
  assert.deepEqual(pushed.map(e => e.id), [7, 7]);
  // One over the bridge's middle, the route ending three from the edge: fought, the push said.
  target.position = new Vec3(-3.5, 66, 0.5);
  bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await huntObserved(bot, task, goal, () => {}, {}, client);
  assert(asked?.hunt_7, Object.keys(asked || {}).join(','));
  assert(asked.hunt_7.includes('A blaze\'s fireball that lands pushes the bot about 2 blocks, shield raised or not; the drop into lava is 3 blocks off: about 2 landing in turn put it over.'), asked.hunt_7);
});

// mid-235-p-nether-3 (note 533): crouched at the corner of a ledge, its middle over the air, every way to the fortress
// failed at once ("Nothing solid underfoot to bridge from", no route), and leaving it left sixteen blocks of it: the next
// brick past those was a fortress found anew, fifteen questions in three seconds.
function fortressFromLedge(position, length = 60) {
  const rock = p => p.y <= 31 ? 'lava' : p.y === 64 && p.z === 0 && p.x >= 30 && p.x < 30 + length ? 'nether_bricks'
    : p.y === 64 && (p.x <= -1 || (p.x <= 0 && p.z >= 1)) ? 'netherrack' : null;
  const world = netherWorld(position, rock);
  const bricks = Array.from({ length }, (_, i) => new Vec3(30 + i, 64, 0));
  world.bot.findBlocks = () => bricks;
  world.bot.time = { timeOfDay: 6000 };
  return world;
}
const pickFirst = picks => { const asked = []; return { asked, systemOne: async ({ kind, state, questions }) => {
  if (questions.branch_0.criteria.go_in) return { answers: { branch_0: { choice: 'go_in', confidence: 0.9 } } };
  asked.push({ kind, state, options: questions.branch_0.criteria });
  return { answers: { branch_0: { choice: picks.shift() || Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } };
} }; };

test('crouched over an edge on the block beside, the bot steps back onto it before any way to the fortress is surveyed or walked (note 533)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { restingCell } = require('../src/terrain');
  const { bot, laid } = fortressFromLedge(new Vec3(0.30000001, 65, 0.65));
  assert.equal(`${restingCell(bot)}`, '(-1, 65, 0)', 'the box rests on the netherrack beside, the cell under its middle open');
  const client = pickFirst(['cross_level']);
  const goal = { fortressSearch: { axis: 1, legs: 7, target: { x: 96, y: 65, z: 0 } } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} });
  assert.equal(client.asked.length, 1);
  assert.match(client.asked[0].options.cross_level, /It ends \d+ blocks nearer/);
  assert(laid.size >= 25, `the span went down from the block the bot stood on (${laid.size} laid)`);
  assert(bot.entity.position.x >= 28, `across, at ${bot.entity.position}`);
});

test('leaving a fortress leaves all of it in view, not sixteen blocks of it: the next question is the leg, not the same fortress found again (note 533)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = fortressFromLedge(new Vec3(-2.5, 65, 0.5));
  const client = pickFirst(['keep_searching']);
  const goal = { fortressSearch: { axis: 1, legs: 7, target: { x: 96, y: 65, z: 0 } } };
  const actions = { client, navigate: async () => {}, tunnel: async () => {} };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(goal.decisions.at(-1).id, 'fortress_approach');
  assert.match(client.asked[0].options.keep_searching, /Left is all of it in view, its bricks out to 61 blocks from the nearest\./);
  assert.equal(goal.fortressSearch.shunned.at(-1).radius, 61);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 2);
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg', 'the bricks past sixteen blocks are the same fortress, left');
});

test('blazes heard through the fortress\'s walls are a worded fight, the stands beside it, and what they are for leads the state (mid-208-k-nether-3-fortress-2, note 557)', async () => {
  // mid-208-k-nether-3-fortress-2 had two blazes sixteen to twenty-four blocks off, out of sight: each was offered as a
  // JSON record ("action": "Fight this observed isolated mob ...") beside a worded defer, no stand among the ways, and
  // Jev left them four times in two minutes.
  const { bot, task, target, goal } = fixture('blaze');
  target.position = new Vec3(16.5, 66, .5);
  bot.entities[8] = { id: 8, uuid: 'other', name: 'blaze', position: new Vec3(20.5, 68, 4.5), width: .6, height: 1.8, isValid: true };
  // A wall of netherrack at the bot's back (x -1), and the blazes behind a wall of their own: no line reaches them.
  bot.blockAt = p => (p.y < 64 || (p.x === -1 && p.y <= 66)) ? { name: 'netherrack', boundingBox: 'block', diggable: true, position: p, digTime: () => 400 } : { name: 'air', boundingBox: 'empty', position: p };
  bot.world = { raycast: (from, dir, range) => range > 10 ? { position: from.plus(dir.scaled(5)).floored(), intersect: from.plus(dir.scaled(5)) } : null };
  goal.mobHunt.targetCount = 8;
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await huntObserved(bot, task, goal, () => {}, { navigate: async () => {} }, client);
  assert(asked, 'asked');
  const { state, options } = asked;
  assert.equal(typeof options.hunt_7, 'string', 'a sentence, as the other options are');
  assert.match(options.hunt_7, /^Fight the blaze 16 blocks off, 2 up, at \(17, 66, 1\), out of sight now \(heard through the walls; it comes once it sees the bot\), in the open: Close on it and strike it with the iron sword, the shield raised toward its shots, 4 pieces of armour worn\. A blaze drops a rod about half the time; blaze rods are what the request needs now/);
  assert.match(state.blazes, /^2 blazes within forty-eight blocks \(0 in sight, the rest heard through the walls\), the nearest 16 blocks off, from 2 to 4 blocks above the bot's feet; these are the blazes the fortress search came for: 8 blaze rods still needed/);
  assert.equal(Object.keys(state).indexOf('blazes'), 3, 'with the resource and what is needed');
  assert(options.back_to_wall, `a stand is offered with the blazes out of sight: ${Object.keys(options)}`);
});

test('on a blaze hunt, leaving them says it gains nothing toward the rods and fighting one says its kill; the fitness names the sword carried (mid-242-aa-fortress-5, note 614)', async () => {
  // 15:16:14: full health, a stone sword, ten blazes heard, hunt_target
  // answered defer (0.50) over single blazes, told the fights' prices, a
  // kit with "no sword or axe carried", and nothing of what leaving gains.
  const { bot, task, goal } = fixture('blaze');
  bot.inventory.items = () => [{ name: 'stone_sword', count: 1 }, { name: 'cooked_mutton', count: 4 }];
  bot.inventory.slots = {};
  goal.mobHunt.targetCount = 8;
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await huntObserved(bot, task, goal, () => {}, { navigate: async () => {} }, client);
  assert(asked, 'asked');
  const { options } = asked;
  assert.match(options.defer, /Toward the rods: none, no blaze killed; the blazes stay, and waiting does not send them away; 8 rods still needed\. Left, these are not offered again for two minutes\./);
  const hunt = Object.keys(options).find(k => /^hunt_\d+$/.test(k));
  assert.match(options[hunt], /Toward the rods: about 1 blaze killed in about [\d.]+ seconds?, about 0\.5 rods on the average/);
  for (const o of Object.values(options)) assert.doesNotMatch(o, /no sword or axe carried/);
  assert.match(options.defer, /no iron or better sword carried \(a stone sword is\)/);
});

test('a stand no blaze can see is said as the wait it is, with the holds already made from about here and what came of them; a hold stopped leaves the work its own step (mid-242-ab-nether-3, note 585)', async () => {
  // mid-242-ab-nether-3 held a wall beside its fortress four times in ten minutes, two minutes each, the three blazes
  // about heard through the walls: "About 0 damage ... none of them reaches it" was all the stand said, none came, none
  // was killed, and each hold's end asked the hunt again with the same wall at the same price. The first hold, stopped
  // by a fireball ten seconds in, left "hold bunker" as the step for eleven minutes.
  const { bot, task, target, goal } = fixture('blaze');
  target.position = new Vec3(16.5, 66, .5);
  bot.entities[8] = { id: 8, uuid: 'other', name: 'blaze', position: new Vec3(20.5, 68, 4.5), width: .6, height: 1.8, isValid: true };
  bot.blockAt = p => (p.y < 64 || (p.x === -1 && p.y <= 66)) ? { name: 'netherrack', boundingBox: 'block', diggable: true, position: p, digTime: () => 400 } : { name: 'air', boundingBox: 'empty', position: p };
  bot.world = { raycast: (from, dir, range) => range > 10 ? { position: from.plus(dir.scaled(5)).floored(), intersect: from.plus(dir.scaled(5)) } : null };
  goal.mobHunt.targetCount = 8;
  const at = min => new Date(Date.now() - min * 60000).toISOString();
  goal.mobHunt.standResults = [
    { at: at(6), kind: 'wall', place: { x: 0, y: 64, z: 0 }, seconds: 120, mostInSight: 0, swings: 0, kills: 0, gained: 0, ended: 'time', health: 20 },
    { at: at(3), kind: 'wall', place: { x: 0, y: 64, z: 0 }, seconds: 120, mostInSight: 0, swings: 0, kills: 0, gained: 0, ended: 'time', health: 20 },
    { at: at(4), kind: 'wall', place: { x: 40, y: 64, z: 0 }, seconds: 120, mostInSight: 2, swings: 3, kills: 1, gained: 1, ended: 'rod', health: 12 },
  ];
  goal.step = { action: 'find_fortress', legs: 11 };
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'back_to_wall', confidence: 0.6 } } }; } };
  // The hold is stopped for the survival layer at its first look, as the fireball stopped it.
  const { NeedsSafety } = require('../src/danger');
  let looks = 0;
  task.interruptCheck = () => { if (goal.step?.action === 'hold_bunker' && ++looks > 1) throw new NeedsSafety({ entity: target, distance: 16 }); };
  await assert.rejects(huntObserved(bot, task, goal, () => {}, { navigate: async () => {} }, client), /Threat nearby/);
  const wall = asked.options.back_to_wall;
  assert.match(wall, /About 0 damage/);
  assert.match(wall, /Taken, the stand is held up to 2 minutes: the bot stays there and strikes only what comes within the sword's reach; the hold ends sooner once a rod is in hand, or once no blaze is within twenty blocks, seen or heard, for 20 seconds\./);
  assert.match(wall, /None of the 2 blazes about sees this spot now \(heard through the walls, or out of its line\): a blaze comes toward the bot only once it has seen it, so none is coming to it, and the hold waits for one to wander into sight\. Waiting does not send blazes away: they keep about the fortress they spawn in\./);
  assert.match(wall, /Held from about here twice in the last 8 minutes, 4 minutes in all: 0 blazes killed, 0 rods, no blaze came within the sword's reach, none in sight; the last ended: its time was up\./, 'the hold forty blocks off is not this one');
  assert.equal(goal.step?.action, 'find_fortress', 'the work\'s own step, not a stale "hold bunker"');
  const last = goal.mobHunt.standResults.at(-1);
  assert.deepEqual([last.kind, last.place, last.kills, last.gained, last.ended], ['wall', { x: 0, y: 64, z: 0 }, 0, 0, 'stopped for the survival layer']);
});

test('a hunt fight with others that reach the bot is priced with them, and leaving them is said not to leave their fire (note 533)', async () => {
  // mid-235-p-nether-3 took a blaze at four blocks told 5.9 damage and 14.2 health after, another blaze seven off, the
  // spawner three away; four blazes took it from twenty to nine in five seconds.
  const { bot, task, target, goal } = fixture('blaze');
  target.position = new Vec3(4.5, 64, .5);
  bot.entities[8] = { id: 8, uuid: 'other', name: 'blaze', position: new Vec3(7.5, 64, 3.5), width: .6, height: 1.8, isValid: true };
  let asked = null;
  const client = { systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  assert.equal(await huntObserved(bot, task, goal, () => {}, {}, client), false);
  assert.doesNotMatch(asked.hunt_7, /isolated/, 'not "isolated" with another in reach');
  const m = /With a blaze 8 blocks off reaching the bot here too and fighting with it: about [\d.]+ seconds and ([\d.]*\d) damage from 20 health.*; this one alone would be about [\d.]+ seconds and ([\d.]*\d)\./.exec(asked.hunt_7);
  assert(m, asked.hunt_7);
  assert(Number(m[1]) > Number(m[2]), `priced with both (${m[1]}) above the one alone (${m[2]})`);
  assert.match(asked.hunt_7, /A blaze drops a rod about half the time; blaze rods are what the request needs now/);
  assert.match(asked.defer, /Leaving them does not take the bot out of their fire: a blaze 4 blocks off, a blaze 8 blocks off, in sight and within reach, keep shooting where it stands/);
});

// A one-wide cobblestone span at y 73 running east from a ledge over a netherrack cavern whose floor stands at y 56
// (feet 57), seventeen below, with a ramp down the ledge's face beside the span's first cells, a lava pool on the
// floor and piglins on it: mid-244-ad-nether-2's ninety blocks of span at y 74 over a cavern floor walkable fifteen
// to twenty below (note 568).
function spanOverCavern(carried = [{ name: 'cobblestone', count: 12 }]) {
  const pool = p => p.x >= 40 && p.x <= 42 && p.z >= -2 && p.z <= 2 && p.y === 56;
  const rock = p => {
    if (p.y <= 20) return 'lava';
    if (pool(p)) return 'lava';
    if (p.x <= 0 && p.y <= 73) return 'netherrack';
    if (p.y === 73 && p.z === 0 && p.x >= 1 && p.x <= 30) return 'cobblestone';
    if (p.z >= -3 && p.z <= -1 && p.x >= 1 && p.x <= 17 && p.y <= 73 - p.x) return 'netherrack';
    if (p.y <= 56 && p.x > -40 && p.x < 140 && p.z > -40 && p.z < 40) return 'netherrack';
    return null;
  };
  return { rock, ...netherWorld(new Vec3(30.5, 74, 0.5), rock, carried) };
}

test('on a span over a walkable cavern floor, going down and walking the floor is a leg of its own, priced by the way down, the floor and its mobs, and taken by the pathfinder down the ground (mid-244-ad-nether-2, note 568)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = spanOverCavern();
  bot.entities = { 1: { id: 1, name: 'piglin', position: new Vec3(60.5, 57, 3.5), isValid: true }, 2: { id: 2, name: 'piglin', position: new Vec3(62.5, 57, -4.5), isValid: true } };
  const client = jevStub(['floor_east']);
  const walks = [];
  const movements = { maxDropDown: 3, blocksCantBreak: new Set() };
  bot.pathfinder = { movements };
  const actions = { client, tunnel: async () => {},
    navigate: async (b, t, g, opts = {}) => { walks.push({ goal: g, drop: movements.maxDropDown, beside: opts.besideLava }); if (Number.isFinite(g.y)) bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } };
  const goal = {};
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(client.asked.length, 1);
  const { options } = client.asked[0];
  // The level legs lay a block a cell out from the span and run out at cell 12; the floor is walked.
  assert.match(options.leg_east, /it needs 96 blocks laid.*the blocks run out at cell 12/);
  for (const k of ['floor_east', 'floor_south', 'floor_west', 'floor_north']) assert(options[k], `${k} offered`);
  const said = options.floor_east;
  assert.match(said, /^Go down to the floor and walk it east 96 blocks, bridging only across the lava and open air on it\. The way down to the floor 17 blocks below \(y 57, seen under \d+ of the 64 columns round the bot\) is \d+ steps ending \d+ blocks across from here, dropping 3 \(no damage\): about \d+ seconds/);
  assert.match(said, /On the floor, of the 96 cells east: 93 of floor to walk, 3 of lava on the floor, all at y 57; about \d+ seconds\. The lava and open air need 3 blocks laid, 12 carried: 9 left after\./);
  assert.match(said, /By the floor that way: 2 piglins\./);
  assert.match(options.floor_west, /of wall to dig/);
  // Chosen: down the ground by the pathfinder, its drops allowed as deep as the way's and the way's cells walked though an
  // edge is beside them; then the leg goes on along the floor at its height.
  const search = goal.fortressSearch;
  assert.equal(search.legMode, 'floor'); assert.equal(search.floorY, 57); assert.equal(search.target.y, 57);
  assert.equal(walks.length, 1, 'the way down, and nothing more this tick');
  assert.equal(walks[0].goal.constructor.name, 'GoalNear'); assert.equal(walks[0].goal.y, 57);
  assert(walks[0].drop >= 3); assert.equal(typeof walks[0].beside, 'function');
  assert.equal(movements.maxDropDown, 3, 'the drop allowance put back');
  assert.equal(Math.floor(bot.entity.position.y), 57);
  assert.equal(search.descent, undefined);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(walks[1].goal.constructor.name, 'GoalNearXZ', 'the leg walked on the floor');
  assert.equal(client.asked.length, 1, 'not asked again');
  // The stall's answers in the Nether: the floor toward where the leg was going, beside the crossing at this height.
  const { netherAnswers } = require('../src/nether-travel');
  const { bot: b2 } = spanOverCavern();
  b2.pathfinder = { movements: { maxDropDown: 3, blocksCantBreak: new Set() } };
  const g2 = { step: { action: 'find_fortress', target: { x: 126, y: 74, z: 0 } } };
  const nav = [];
  const answers = netherAnswers(b2, new Task('stall'), g2, () => {}, { actions: { navigate: async (b, t, g) => { nav.push(g); if (Number.isFinite(g.y)) b2.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); else b2.entity.position = new Vec3(g.x, 57, g.z); } } });
  assert(answers.cross_toward, 'the crossing at this height is still offered');
  assert.match(answers.floor_toward.description, /^Go down to the floor and walk it toward the fortress search's leg\. The way down to the floor 17 blocks below/);
  assert.match(answers.floor_toward.description, /of floor to walk, 3 of lava on the floor/);
  await answers.floor_toward.run();
  assert.deepEqual(nav.map(g => g.constructor.name), ['GoalNear', 'GoalNearXZ']);
  assert(b2.entity.position.x > 30, 'a stretch along the floor toward it');
});

// Jev's pick among what is offered: the first of `picks` on offer, else the first option.
function pickStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => { const options = questions.branch_0.criteria; asked.push({ kind, state, options }); return { answers: { branch_0: { choice: picks.find(p => options[p]) || Object.keys(options)[0], confidence: 0.9 } } }; } };
}

test('with a failure owed to the leg\'s question, the walk of the floors in hand ends and the question is asked, not walked again unasked (mid-242-ae-nether-2-fortress-1, note 583)', async () => {
  // 25583: the walk of the fortress's floors failed and escalated to fortress_leg; the next pass walked the same floor
  // again without asking it, and the next failure went past fortress_leg to the rung, set aside thirty seconds in.
  const { findFortressStep } = require('../src/mob-hunt');
  const tried = require('../src/tried');
  const { bot } = corridor();
  const goal = { fortressSearch: { axis: 1, legs: 16 } };
  tried.escalate(goal, { from: 'step', to: 'fortress_leg', why: 'the find fortress step failed: No measurable progress on the walk of the floors' });
  const walks = [];
  const client = pickStub(['stay_in_fortress']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: walker(bot, walks), tunnel: async () => {} });
  assert.equal(walks.length, 0, 'not walked again');
  assert.equal(client.asked.length, 1, 'the leg\'s question asked');
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  assert.match(client.asked[0].state.whatFailedBelow[0], /^step: the find fortress step failed: No measurable progress/);
  assert.equal(tried.owed(goal, 'fortress_leg'), null, 'said to it, and so no longer owed');
});

test('with a failure owed to the leg\'s question off the fortress\'s floors, the leg\'s question is asked, not the ways in again (mid-242-ae-nether-3-fortress-1, note 583)', async () => {
  // 25583's next trial: fortress_approach's hold escalated to fortress_leg at 04:52:07.5, the next pass asked
  // fortress_approach again (its one way left, walk_route, twice), and that went past fortress_leg to the rung.
  const { findFortressStep } = require('../src/mob-hunt');
  const tried = require('../src/tried');
  const { bot } = fortressAcrossLava();
  const goal = { fortressSearch: { axis: 1, legs: 7, target: { x: 96, y: 65, z: 0 } } };
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'the last 3 answers to this question in a row each came back within 2 seconds' });
  const client = pickStub(['leg_north']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('the code walked on its own'); }, tunnel: async () => { throw new Error('the code tunnelled on its own'); } });
  assert.equal(client.asked.length, 1);
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg', 'the leg\'s question, not fortress_approach');
  const { options, state } = client.asked[0];
  assert.match(state.whatFailedBelow[0], /^fortress approach: the last 3 answers/);
  assert.match(options.back_to_fortress, /its ways in from here came to nothing: fortress approach: the last 3 answers/);
});

test('a floor within three blocks that the walk cannot reach is passed over after one walk, not walked thirty times in three seconds (mid-242-ae-nether-2-fortress-1, note 583)', async () => {
  // 25583: the floor to walk to was two blocks up with no way to it; the walk ended where it began, 2.0 blocks from
  // it, and a walk ending within three blocks counted as reached: the same floor thirty times in three seconds.
  const { findFortressStep } = require('../src/mob-hunt');
  const { bot } = corridor({ length: 3 });
  const goal = { fortressSearch: { axis: 1, legs: 16 } };
  const walks = [];
  // The walks to its floors (a leg's walk has no height).
  const navigate = async (b, t, g) => { if (Number.isFinite(g.y)) walks.push(`${g.x},${g.y},${g.z}`); throw new Error('No path to the goal!'); };
  for (let i = 0; i < 6; i++) await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client: pickStub(['leg_north']), navigate, tunnel: async () => {} });
  const counts = walks.reduce((m, w) => ({ ...m, [w]: (m[w] || 0) + 1 }), {});
  assert(walks.length >= 1);
  assert(Object.values(counts).every(n => n === 1), `each floor walked to once: ${JSON.stringify(counts)}`);
});

test('with a failure owed to the leg\'s question and a fortress remembered 26 blocks off, the leg\'s question is asked, not the remembered fortress walked to unasked (mid-242-aa-nether-1-fortress-4, 25590, note 605)', async () => {
  // 25590 at 12:35:04: fortress_approach's every way rested and escalated to fortress_leg. Each pass after, the owed
  // hook dropped the search's target and its "remembered" mark, and the next lines took the fortress remembered at
  // (-70, 32, 140) as the target again at once: the walk there ran unasked, "No measurable progress" at 12:35:09 and
  // 12:35:11, both sent to fortress_leg, never asked, and the second passed over it to the rung, set aside 3.2
  // minutes into the trial with eleven of the leg's twelve ways never tried.
  const { findFortressStep } = require('../src/mob-hunt');
  const tried = require('../src/tried');
  const rock = p => p.y <= 31 ? 'lava' : p.y === 54 && Math.abs(p.x + 83) <= 6 && Math.abs(p.z - 142) <= 6 ? 'netherrack' : null;
  const { bot } = netherWorld(new Vec3(-82.7, 55, 142.5), rock);
  const goal = { fortressSearch: { axis: 1, legs: 12 },
    landmarks: [{ kind: 'nether_fortress', x: -70, y: 32, z: 140, bricks: 128, dimension: 'nether' }] };
  tried.escalate(goal, { from: 'fortress_approach', to: 'fortress_leg', why: 'every way it had from here rests: cross level: Tried 2 times toward the same place from about here in the last 1 second, and it came to nothing' });
  const walks = [];
  const client = pickStub(['leg_west']);
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, navigate: async (b, t, g) => { walks.push(`${g.x},${g.z}`); throw new Error('No path to the goal!'); }, tunnel: async () => {} });
  assert(!walks.includes('-70,140'), `the remembered fortress not walked to unasked: ${walks.join(' ')}`);
  assert.equal(client.asked.length, 1, 'the leg\'s question asked');
  assert.equal(goal.decisions.at(-1).id, 'fortress_leg');
  assert.match(client.asked[0].state.whatFailedBelow[0], /^fortress approach: every way it had from here rests/);
  assert.equal(tried.owed(goal, 'fortress_leg'), null, 'said to it, and so no longer owed');
  assert.match(Object.values(client.asked[0].options).join(' '), /the fortress remembered at \(-70, 32, 140\)/, 'the remembered fortress is said on the legs that lie its way');
});

// Note 638: a blaze hunt about to go at blazes none of which sees the bot is a visit beginning: asked whether it
// happens now (fortress_visit) before the hunt; with a blaze in sight the fight is on and the hunt/stance is asked.
test('a blaze hunt at blazes out of sight is asked the visit first; with one in sight it is not', async () => {
  const scene = withWall => {
    const f = brickHunt(p => p.y <= 63 || (withWall && p.x === 3 && p.y <= 68));
    f.target.position = new Vec3(9.5, 64.5, 0.5);
    f.bot.health = 9; f.bot.food = 20;
    // The wall stops every ray across x = 3.
    f.bot.world = { raycast: (from, dir, length) => withWall && from.x < 3 && from.x + dir.x * length > 3 ? { intersect: new Vec3(3, from.y, from.z), position: new Vec3(3, 64, 0) } : null };
    return f;
  };
  const run = async f => {
    const seen = [];
    const client = { systemOne: async ({ questions }) => { const o = questions.branch_0.criteria; seen.push(Object.keys(o)); return { answers: { branch_0: { choice: o.go_in ? 'go_in' : 'defer', confidence: 0.9 } } }; } };
    await huntObserved(f.bot, f.task, f.goal, () => {}, { navigate: async () => {} }, client);
    return { seen, goal: f.goal };
  };
  const hidden = await run(scene(true));
  assert(hidden.seen[0]?.includes('go_in'), `the visit was asked first: ${JSON.stringify(hidden.seen)}`);
  assert(hidden.seen[0].includes('heal_first'), 'health 9 with the hunger to heal: waiting is offered');
  assert(!hidden.seen[0].includes('leave_fortress'), 'no fortress in view to leave on a hunt');
  assert.equal(hidden.goal.fortressVisit.pick, 'go_in');
  const open = await run(scene(false));
  assert(!open.seen.some(o => o.includes('go_in')), `in sight the fight is on, no visit asked: ${JSON.stringify(open.seen)}`);
});

// Note 631: mid-242-bc-fortress-2 (25587, 17:55:22Z) was asked hunt_target at 20 health with 2 blazes in sight
// and the cage 8 blocks off, told "about 11.7 seconds and 10.4 damage" for the fight in the open; the rooms held
// 5 within sixteen twenty seconds on and 6 a minute later, and the bot was dead at 17:56:35. The price counted the
// two about at first sight; the cage's newcomers were prose.
test('a fight near a live spawner is priced with the blazes it puts in over the fight\'s own seconds, counted at the cage (note 631)', async () => {
  const Block = require('prismarine-block')(registry), cage = new Vec3(9, 64, 4);
  const scene = withCage => {
    const f = brickHunt(p => p.y <= 63);
    f.target.position = new Vec3(6.5, 64.5, 0.5);
    f.bot.entities[8] = { id: 8, uuid: 'second', name: 'blaze', position: new Vec3(7.5, 65.5, 1.5), width: .6, height: 1.8, isValid: true };
    const base = f.bot.blockAt;
    if (withCage) f.bot.blockAt = p => { const at = p.floored(); if (at.equals(cage)) { const b = Block.fromStateId(registry.blocksByName.spawner.defaultState); b.position = at; return b; } return base(p); };
    return f;
  };
  const ask = async f => {
    let asked = null, state = null;
    const client = { systemOne: async ({ questions, state: st }) => { asked = questions.branch_0.criteria; state = st; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
    await huntObserved(f.bot, f.task, f.goal, () => {}, {}, client);
    assert(asked?.hunt_7, Object.keys(asked || {}).join(','));
    // What the bot's own fights with blazes came to, in the state (blaze-record.js).
    assert.match(state.playedRecord, /^In the trials of 2026-09-28, 415 fights with blazes/);
    return asked.hunt_7;
  };
  const says = await ask(scene(true));
  const plain = /reaching the bot here too and fighting with it: about ([\d.]+) seconds and ([\d.]+) damage/.exec(says);
  const withNew = /With the (\d+) more the spawner puts in over the seconds the fight then takes .*counted at the cage 10 blocks off: about ([\d.]+) seconds and ([\d.]+) damage/.exec(says);
  assert(plain, says);
  assert(withNew, says);
  assert(Number(withNew[1]) >= 1, 'the newcomers over the fight\'s seconds');
  assert(Number(withNew[3]) > Number(plain[2]), `${withNew[3]} against ${plain[2]}: the newcomers add damage`);
  assert(Number(withNew[1]) <= 4, 'up to six about in all, two of them here already');
  assert.match(says, /two within sixteen blocks at first sight, five by twenty or thirty seconds, six to eight by a minute/);
  // No cage seen: nothing added.
  assert.doesNotMatch(await ask(scene(false)), /the spawner puts in/);
});
