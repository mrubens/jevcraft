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

test('string comes from a spider and feathers from a chicken, so a bow and arrows plan without a cobweb or a tripwire', () => {
  const sources = knowledge(registry).mobSources;
  assert.equal(sources.string[0].entity, 'spider'); assert(!sources.string[0].requiresPlayerKill, 'string drops however the spider dies');
  assert.equal(sources.feather[0].entity, 'chicken'); assert(sources.feather[0].passive);
  assert(!knowledge(registry).sources.string.some(s => s.block === 'tripwire'), 'tripwire is placed string, never a deposit');
  const bow = planCatalog(registry, 'bow', 1, { stick: 3, crafting_table: 1 });
  assert.deepEqual(bow.map(s => [s.action, s.entity || s.item, s.count]).slice(-2), [['hunt_mob', 'spider', 3], ['craft', 'bow', 1]]);
  assert(bow.some(s => s.action === 'craft' && s.item === 'iron_sword'), 'a spider fights back, so the hunt still wants the kit');
  const seen = planCatalog(registry, 'bow', 1, { stick: 3, crafting_table: 1 }, { nearby: ['cobweb'] });
  assert(seen.some(s => s.action === 'mine' && s.block === 'cobweb') && !seen.some(s => s.action === 'hunt_mob'), 'a cobweb in view beats the hunt');
  const arrows = planCatalog(registry, 'arrow', 16, { stick: 4, crafting_table: 1 });
  assert.deepEqual(arrows.map(s => [s.action, s.entity || s.block || s.item, s.count]), [['mine', 'gravel', 4], ['hunt_mob', 'chicken', 4], ['craft', 'arrow', 16]]);
  assert(!arrows.some(s => /sword|helmet|chestplate|leggings|boots|shield/.test(s.item || '')), 'a chicken needs no armour');
});

test('a chicken is chased with the best carried weapon, no armour, no shield and a flock around it', async () => {
  const { bot, task, target, goal, slots, controls, attacks } = fixture('chicken');
  for (const slot of [5, 6, 7, 8, 36, 45]) slots[slot] = null;
  slots[10] = { name: 'stone_sword', count: 1, slot: 10, durabilityUsed: 0 }; slots[11] = { name: 'wooden_axe', count: 1, slot: 11, durabilityUsed: 0 };
  bot.entities[8] = { id: 8, name: 'chicken', position: target.position.offset(1, 0, 0), width: .4, height: .7, isValid: true };
  bot.health = 12; bot.food = 8;
  assert(!readyEquipment(bot)); assert(isolated(bot, target));
  const requests = [];
  await prepareMobHunt(bot, task, { entity: 'chicken', item: 'feather', count: 2 }, goal, () => {}, { acquireStep: async (_b, _t, item) => requests.push(item), explore: async () => {} });
  assert.deepEqual(requests, [], 'no armour is fetched for a chicken');
  assert.equal(goal.mobHunt.targetCount, 2);
  bot.attack = entity => {
    attacks.push(entity); bot.emit('entityDead', entity); delete bot.entities[entity.id];
    bot.entities[9] = { id: 9, name: 'item', position: target.position.clone(), getDroppedItem: () => ({ name: 'feather', count: 1 }) };
  };
  const result = await fightForDrop(bot, task, target, goal, () => {}, { navigate: async () => { slots[12] = { name: 'feather', count: 1, slot: 12 }; delete bot.entities[9]; } });
  assert.equal(bot.heldItem.name, 'stone_sword'); assert.deepEqual(attacks, [target]);
  assert.equal(result.outcome, 'pickup_confirmed'); assert.deepEqual(controls, [], 'no shield to raise');
  assert.equal(bot._combatEncounter, undefined);
  const spider = { ...target, id: 13, name: 'spider' }; bot.entities[13] = spider;
  assert.equal(hostileEntities(bot).length, 0, 'a spider by day is neutral');
  assert(!isolated(bot, spider), 'a spider still wants the room a sweep needs');
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
  const other = { ...target, id: 8, position: new Vec3(4, 64, .5) }; bot.entities[8] = other;
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
  goal.mobHunt.stalking.since = Date.now() - 46000;
  await prepareMobHunt(bot, task, { entity: 'spider', item: 'string', count: 3 }, goal, () => {}, actions);
  assert(goal.mobHunt.avoided['original-target'], 'a minute out of reach and it is set aside');
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
  assert.deepEqual(hostileEntities(bot).map(e => e.name).sort(), ['piglin', 'piglin_brute'], 'a hit ends the truce');
});
