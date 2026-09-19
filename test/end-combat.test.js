'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const registry = require('prismarine-registry')('26.1');
const { Task } = require('../src/skills');
const { metadata, perchedHead, observeArena, safeEndPoint, arenaMovement, arenaRoutes, fightEndStep } = require('../src/end-combat');
const { exitEnd } = require('../src/end-exit');
const { dodgeRoutes } = require('../src/end-safety');
function fixture() {
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), registry,
    health: 20, food: 20, oxygenLevel: 20, isAlive: true, game: { gameMode: 'survival', dimension: 'the_end' },
    entity: { position: new Vec3(.5, 64, .5) }, entities: {},
    inventory: { items: () => [{ name: 'bow', count: 1 }, { name: 'arrow', count: 64 }], slots: [] },
    blockAt: p => ({ name: p.y < 64 ? 'end_stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [], world: { raycast: () => null }, clearControlStates() {},
    pathfinder: { movements: { blocksCantBreak: new Set([registry.blocksByName.end_stone.id]), scafoldingBlocks: [], canDig: false }, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }) },
  });
  const goal = { kind: 'win', request: 'Jev beat Minecraft', gameProgress: { milestones: {} } }, task = new Task('End');
  return { bot, goal, task };
}
function entity(bot, id, name, position, values = {}) {
  const e = { id, name, position, yaw: 0, metadata: {}, isValid: true, width: 2, height: 2 };
  for (const [key, value] of Object.entries(values)) e.metadata[registry.entitiesByName[name].metadataKeys.indexOf(key)] = value;
  bot.entities[id] = e; return e;
}

test('End hazard envelopes include crystal blasts and observed breath radius; the arena policy restores', () => {
  const { bot } = fixture();
  const crystal = entity(bot, 8, 'end_crystal', new Vec3(10, 64, 0));
  assert.equal(safeEndPoint(bot, bot.entity.position), false);
  const original = { ...bot.pathfinder.movements }, policy = arenaMovement(bot);
  assert(policy.allowed({ x: -5, y: 64, z: 0 })); assert.equal(policy.allowed({ x: 5, y: 64, z: 0 }), false);
  policy.restore(); assert.deepEqual(bot.pathfinder.movements, { ...original, allow1by1towers: undefined, allowSprinting: undefined, allowedPosition: undefined });
  delete bot.entities[crystal.id];
  entity(bot, 9, 'area_effect_cloud', new Vec3(0, 64, 0), { radius: 6 });
  assert.equal(safeEndPoint(bot, new Vec3(7, 64, 0)), false);
  assert.equal(safeEndPoint(bot, new Vec3(9, 64, 0)), true);
  assert.equal(safeEndPoint(bot, new Vec3(0, 70, 0)), true);
});

test('a provoked Enderman permits retreat but does not leave the current firing position classified safe', () => {
  const { bot } = fixture();
  entity(bot, 8, 'enderman', new Vec3(4, 64, .5), { creepy: true });
  assert.equal(safeEndPoint(bot, bot.entity.position), false);
  assert.equal(safeEndPoint(bot, new Vec3(-20, 64, .5)), true);
});

test('continuous evasions between a dragon and cloud are not rejected by voxel-center rounding', () => {
  const { bot } = fixture();
  bot.entity.position = new Vec3(-8.134908614838846, 64, 16.52985303765932);
  const dragon = entity(bot, 20, 'ender_dragon', new Vec3(-1.1656053750352129, 68.76007488966775, 2.783597633921879), { phase: 3 });
  entity(bot, 21, 'area_effect_cloud', new Vec3(-15.5, 64, 20.5), { radius: 7 });
  const policy = arenaMovement(bot);
  try {
    assert(dodgeRoutes(bot, dragon, policy.allowedPoint).length > 0);
    assert.equal(dodgeRoutes(bot, dragon, p => policy.allowed(p.floored())).length, 0);
  } finally { policy.restore(); }
});

test('a cloud arriving during movement permits retreat from the current position, not a stale route origin', () => {
  const { bot } = fixture();
  bot.entity.position = new Vec3(-8.48255943866737, 62, 11.5);
  const policy = arenaMovement(bot);
  // Recorded End O: the cloud arrived while Jev stepped off a one-block ledge.
  // By landing, he was closer to it than when the ordinary route began.
  bot.entity.position = new Vec3(-7.170140192063626, 61, 10.092254133875322);
  const cloud = entity(bot, 277, 'area_effect_cloud', new Vec3(-6.839787510025595, 61, 6.97640353841328), { radius: 3 });
  const away = bot.entity.position.minus(cloud.position).unit();
  try {
    assert(policy.allowedPoint(bot.entity.position.plus(away.scaled(.2))), 'The first step away from the newly arrived cloud must be allowed');
    assert.equal(policy.allowedPoint(bot.entity.position.minus(away.scaled(.3))), false, 'Moving further into the cloud is still forbidden');
  } finally { policy.restore(); }
});

test('perched head geometry uses the actual part id and sitting phase; flying or flaming dragons are not melee candidates', () => {
  const { bot } = fixture(), dragon = entity(bot, 20, 'ender_dragon', new Vec3(0, 65, 0), { phase: 6 });
  const head = perchedHead(bot, dragon); assert.equal(head.id, 21); assert.deepEqual(head.position, new Vec3(0, 64, 6.5));
  assert.equal(metadata(bot, dragon, 'phase'), 6);
  for (const phase of [0, 3, 5, 9]) {
    dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')] = phase;
    assert.equal(perchedHead(bot, dragon), null);
  }
});

test('arena routes seek a shallower angle for high crystals instead of only approaching the pillar', async () => {
  const { bot, goal, task } = fixture(); goal.endCombat = { visits: {} };
  const crystal = entity(bot, 8, 'end_crystal', new Vec3(.5, 104, 40.5));
  bot.findBlocks = () => [new Vec3(0, 63, 8), new Vec3(0, 63, -8)];
  const original = bot.entity.position.clone();
  const routes = await arenaRoutes(bot, task, goal, { allowed: () => true }, crystal);
  assert.equal(routes[0].p.z, -8, 'The first route backs away to gain an angle above the column');
  assert.equal(routes[0].desiredHorizontalRange, 44);
  assert.equal(typeof routes[0].clearCrystalShot, 'boolean');
  assert.deepEqual(bot.entity.position, original, 'Candidate aim checks must never move the real player');
});

test('unloaded crystals remain unresolved across reloads; dragon tracking loss preserves the observed arena', () => {
  const { bot } = fixture(), state = {};
  const crystal = entity(bot, 8, 'end_crystal', new Vec3(50, 104, 40));
  const dragon = entity(bot, 20, 'ender_dragon', new Vec3(0, 65, 0), { phase: 6 });
  observeArena(bot, state, 1000); delete bot.entities[8]; delete bot.entities[20];
  observeArena(bot, state, 10000);
  assert.equal(state.knownCrystals['50,104,40'].status, 'unresolved');
  assert.deepEqual(state.arenaCenter, { ...dragon.position });
  const reloaded = JSON.parse(JSON.stringify(state));
  bot.entity.position = new Vec3(49, 64, 40);
  observeArena(bot, reloaded, 11000); assert.equal(reloaded.knownCrystals['50,104,40'].status, 'unresolved');
  observeArena(bot, reloaded, 12600); assert.equal(reloaded.knownCrystals['50,104,40'].status, 'absent_on_revisit');
  bot.entities[8] = crystal; observeArena(bot, reloaded, 13000);
  assert.equal(reloaded.knownCrystals['50,104,40'].status, 'observed');
});

test('End controller verifies an explosion and removal together; crystal loss alone is not success or dragon credit', async () => {
  for (const exploded of [false, true]) {
    const { bot, goal, task } = fixture();
    entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
    await fightEndStep(bot, task, goal, () => {}, {}, {}, { shot: async (b, t, target) => {
      if (exploded) bot._client.emit('explosion', { center: { ...target.position } });
      delete bot.entities[target.id]; return { ticks: 0, targetId: target.id };
    } });
    assert.equal(goal.endCombat.destroyedCrystals.length, exploded ? 1 : 0);
    assert.equal(goal.gameProgress.milestones.dragon_defeated, undefined);
    assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(bot._client.listenerCount('explosion'), 0);
    assert.equal(task.interruptCheck, undefined); assert.equal(bot.pathfinder.movements.canDig, false);
  }
});

test('a changed combat target triggers a bounded replan while explicit cancellation still unwinds', async () => {
  for (const cancel of [false, true]) {
    const { bot, goal, task } = fixture(); entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
    const step = fightEndStep(bot, task, goal, () => {}, {}, {}, { shot: async () => {
      if (cancel) { task.cancel(); task.check(); }
      throw new Error('The target moved during drawing');
    } });
    if (cancel) await assert.rejects(step, { name: 'Cancelled' });
    else { await step; assert.match(goal.endCombat.lastInterrupted.reason, /moved/); assert.equal(goal.endCombat.noProgress, 1); }
    assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(bot._client.listenerCount('explosion'), 0);
  }
});

test('two confirmed missed crystal shots require a different firing position before spending more arrows', async () => {
  const { bot, goal, task } = fixture(); entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
  bot.findBlocks = () => [new Vec3(-8, 63, 0)]; let shots = 0, moved = 0;
  const actions = { navigate: async (b, t, destination) => { moved++; bot.entity.position = new Vec3(destination.x + .5, destination.y, destination.z + .5); } };
  const shot = async () => { shots++; return { ticks: 0, origin: { ...bot.entity.position.offset(0, 1.52, 0) } }; };
  for (let n = 0; n < 3; n++) await fightEndStep(bot, task, goal, () => {}, actions, {}, { shot });
  assert.equal(shots, 2); assert.equal(moved, 1); assert.equal(goal.endCombat.shots[0].outcome, 'target_remains');
  await fightEndStep(bot, task, goal, () => {}, actions, {}, { shot });
  assert.equal(shots, 3); assert.equal(goal.endCombat.destroyedCrystals.length, 0);
});

test('repeated observation yields to an executable crystal revisit and renews only after actual movement', async () => {
  const { bot, goal, task } = fixture();
  entity(bot, 20, 'ender_dragon', new Vec3(50, 65, 0), { phase: 6, health: 200 });
  goal.endCombat = { steps: 0, shots: [], destroyedCrystals: [], visits: {}, idleObservations: 4,
    knownCrystals: { remembered: { position: { x: 80, y: 95, z: 0 }, status: 'unresolved' } } };
  bot.findBlocks = () => [new Vec3(8, 63, 0)]; let moves = 0, choices = 0;
  const client = { systemOne: async ({ questions }) => {
    choices++;
    const options = questions.branch_0.criteria;
    assert(options.observe);
    assert.match(options['move_1,0'].action, /previously observed crystal/);
    assert(options['move_1,0'].targetDistance < options['move_1,0'].currentTargetDistance);
    assert.equal(options['move_1,0'].clearCrystalShot, undefined, 'Unknown is not a confirmed blocked shot');
    return { answers: { branch_0: { choice: 'observe' } } };
  } };
  const actions = { navigate: async () => { moves++; if (moves > 1) bot.entity.position = new Vec3(8.5, 64, .5); } };
  await fightEndStep(bot, task, goal, () => {}, actions, client);
  assert.equal(goal.endCombat.idleObservations, 5);
  await fightEndStep(bot, task, goal, () => {}, actions, client);
  assert.equal(moves, 1); assert.equal(choices, 1);
  assert.equal(goal.endCombat.idleObservations, 5, 'A no-op route must not renew waiting');
  await fightEndStep(bot, task, goal, () => {}, actions, client);
  assert.equal(moves, 2); assert.equal(goal.endCombat.idleObservations, 0);
  assert.equal(goal.endCombat.knownCrystals.remembered.status, 'unresolved');
});

test('observation stays available with no executable alternatives but retains the no-progress bound', async () => {
  const { bot, goal, task } = fixture();
  entity(bot, 20, 'ender_dragon', new Vec3(50, 65, 0), { phase: 6, health: 200 });
  goal.endCombat = { steps: 0, shots: [], destroyedCrystals: [], visits: {}, idleObservations: 5, noProgress: 79 };
  await fightEndStep(bot, task, goal, () => {}, {}, {});
  assert.equal(goal.endCombat.idleObservations, 6); assert.equal(goal.endCombat.noProgress, 80);
  await assert.rejects(fightEndStep(bot, task, goal, () => {}, {}, {}), /bounded action budget/);
  assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(task.interruptCheck, undefined);
});

test('End exit needs player kill credit, an observed active portal, an exit event and a living landing', async () => {
  const { bot, goal, task } = fixture();
  await assert.rejects(exitEnd(bot, task, goal, () => {}, {}), /kill credit/);
  goal.gameProgress.milestones.dragon_defeated = { source: 'minecraft:end/kill_dragon', at: Date.now() };
  await assert.rejects(exitEnd(bot, task, goal, () => {}, {}), /No active exit/);
  const p = new Vec3(3, 64, 0), original = bot.blockAt;
  bot.findBlocks = () => [p]; bot.blockAt = q => q.equals(p) ? { name: 'end_portal' } : original(q);
  await assert.rejects(exitEnd(bot, task, goal, () => {}, { navigate: async () => { bot.game.dimension = 'overworld'; } }, { timeoutMs: 60 }), /No exit-portal event/);
  bot.game.dimension = 'the_end';
  await exitEnd(bot, task, goal, () => {}, { navigate: async () => {
    goal.gameProgress.milestones.exit_portal_used = { at: Date.now(), source: 'game_state_change:win_game' };
    bot.game.dimension = 'overworld'; bot.isAlive = false;
    setTimeout(() => { bot.isAlive = true; }, 30);
  } }, { timeoutMs: 300 });
  assert.equal(goal.endReturn.source, 'living_exit_portal_return');
  assert.equal(bot.pathfinder.movements.canDig, false);
});

test('a dragon charge aborts a pending Jev choice and hands control to the cancellable reflex', async () => {
  const { bot, goal, task } = fixture();
  entity(bot, 8, 'end_crystal', new Vec3(24, 70, 0));
  entity(bot, 9, 'end_crystal', new Vec3(-24, 70, 0));
  const dragon = entity(bot, 20, 'ender_dragon', new Vec3(40, 66, .5), { phase: 6 });
  let aborted = false, reflex = false;
  bot.look = async () => { reflex = true; task.cancel(); };
  const client = { systemOne: async ({ signal }) => {
    dragon.metadata[registry.entitiesByName.ender_dragon.metadataKeys.indexOf('phase')] = 8;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  } };
  await assert.rejects(fightEndStep(bot, task, goal, () => {}, {}, client), { name: 'Cancelled' });
  assert(aborted); assert(reflex); assert.equal(goal.endCombat.lastInterrupted.reason, 'dragon_charge_or_contact');
  assert.equal(bot.listenerCount('entityMoved'), 0); assert.equal(task.interruptCheck, undefined);
  assert.equal(bot.pathfinder.movements.canDig, false);
});

test('a cloud arriving while eating interrupts consumption and starts an escape before another choice', async () => {
  const { bot, goal, task } = fixture(); bot.health = 13; bot.food = 17;
  bot.inventory.items = () => [{ name: 'cooked_beef', count: 2 }];
  let reflex = false, stopped = false;
  bot.equip = async () => {};
  bot.consume = () => { entity(bot, 30, 'area_effect_cloud', bot.entity.position.clone(), { radius: 3 }); return new Promise(() => {}); };
  bot.deactivateItem = () => { stopped = true; };
  bot.look = async () => { reflex = true; task.cancel(); };
  await assert.rejects(fightEndStep(bot, task, goal, () => {}, {}, { systemOne: () => { throw new Error('Emergency must precede ordinary choices'); } }), { name: 'Cancelled' });
  assert(reflex); assert(stopped); assert.equal(goal.endCombat.lastInterrupted.reason, 'dragon_breath_cloud');
  assert.equal(task.interruptCheck, undefined); assert.equal(bot.listenerCount('entityMoved'), 0);
});
