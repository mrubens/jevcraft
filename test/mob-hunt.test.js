'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { planCatalog, knowledge } = require('../src/knowledge');
const { combatGear, armorSlots, readyEquipment } = require('../src/mob-policy');
const { combatTarget, checkThreats, safeFromHostiles, hostileEntities } = require('../src/danger');
const { prepareCombatGear, fightForDrop, huntObserved, prepareMobHunt, isolated } = require('../src/mob-hunt');

function fixture(name = 'blaze') {
  const slots = Array(46).fill(null), task = new Task('hunt');
  const target = { id: 7, uuid: 'original-target', name, position: new Vec3(2, 64, .5),
    width: .6, height: name === 'enderman' ? 2.9 : 1.8, isValid: true };
  const attacks = [], controls = [], movement = { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] };
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: name === 'blaze' ? 'the_nether' : 'overworld', gameMode: 'survival', difficulty: 'normal' },
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
  const goal = { request: `Jev get me ${name === 'blaze' ? 'a blaze rod' : 'an ender pearl'}`,
    mobHunt: { entity: name, item: name === 'blaze' ? 'blaze_rod' : 'ender_pearl', targetCount: 1 } };
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
