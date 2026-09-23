'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { frameOffsets, portalAt } = require('../src/stronghold');
const { activePortal, enterEnd, bridgeFootings } = require('../src/end-portal');
const { nextGameStage } = require('../src/game-progress');
const { Task } = require('../src/skills');

function fixture({ eyes = 12, filled = 0, active = false } = {}) {
  const center = new Vec3(0, 64, 0), blocks = new Map(), item = { name: 'ender_eye', count: eyes };
  for (const [i, offset] of frameOffsets.entries()) {
    const position = center.offset(offset.x, 0, offset.z), properties = { facing: offset.facing, eye: i < filled };
    blocks.set(`${position}`, { name: 'end_portal_frame', position, boundingBox: 'block', getProperties: () => properties });
  }
  if (active) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    const position = center.offset(x, 0, z);
    blocks.set(`${position}`, { name: 'end_portal', position, boundingBox: 'empty' });
  }
  let controls = {}, activated = 0;
  const bot = { registry, entity: { position: new Vec3(-2.5, 64, .5) }, entities: {},
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, oxygenLevel: 20,
    inventory: { items: () => item.count ? [item] : [] },
    blockAt: p => blocks.get(`${p.floored()}`) || { name: p.y < 64 ? 'stone' : 'air', position: p.floored(), boundingBox: p.y < 64 ? 'block' : 'empty' },
    world: { raycast: () => null },
    pathfinder: { movements: { canDig: true, scafoldingBlocks: [1], allow1by1towers: true }, getPathTo: () => ({ status: 'success', path: [] }), setGoal() {} },
    lookAt: async () => {}, equip: async held => { bot.heldItem = held; }, deactivateItem() {},
    clearControlStates: () => { controls = {}; }, setControlState: (name, value) => { controls[name] = value; },
    activateBlock: async frame => { activated++; frame.getProperties().eye = true; item.count--; },
  };
  const goal = { kind: 'win', gameProgress: { milestones: { stronghold_located: { source: 'observed_end_portal_frame_ring' } } }, endPortal: portalAt(bot, center) };
  const actions = { navigate: async (_b, _t, destination) => { bot.entity.position = new Vec3(destination.x + .5, destination.y, destination.z + .5); } };
  return { bot, goal, item, center, blocks, actions, activations: () => activated, controls: () => controls };
}

test('portal insertion consumes exactly one Eye and verifies the changed frame before persisting progress', async () => {
  const { bot, goal, actions, item, activations } = fixture({ filled: 2, eyes: 10 });
  await enterEnd(bot, new Task('portal'), goal, () => {}, actions);
  assert.equal(activations(), 1); assert.equal(item.count, 9);
  assert.equal(goal.endPortal.frames.filter(f => f.eye).length, 3);
  assert.equal(goal.endPortal.neededEyes, 9); assert.equal(goal.endPortal.insertions.length, 1);
  assert.equal(goal.gameProgress.milestones.end_entered, undefined);
  assert.deepEqual(bot.pathfinder.movements, { canDig: true, scafoldingBlocks: [1], allow1by1towers: true, allowedPosition: undefined });
});

test('insufficient observed empty-frame supply replans ordinary acquisition without throwing an Eye', async () => {
  const { bot, goal, actions, activations } = fixture({ filled: 4, eyes: 3 });
  await enterEnd(bot, new Task('portal'), goal, () => {}, actions);
  assert.equal(activations(), 0); assert.equal(goal.endPortal.neededEyes, 8);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  bot.game.dimension = 'the_nether';
  assert.equal(nextGameStage(bot, goal).count, 3, 'Only the missing five Eyes need three additional rods');
});

test('portal interaction approaches exclude fractional-height frame tops', async () => {
  const { bot, goal, actions } = fixture({ filled: 10, eyes: 2 });
  bot.entity.position = new Vec3(6.5, 64, 6.5);
  const navigate = actions.navigate; let approaches = 0;
  actions.navigate = async (b, t, destination) => {
    const support = new Vec3(destination.x, destination.y - 1, destination.z);
    assert.notEqual(bot.blockAt(support).name, 'end_portal_frame'); approaches++;
    await navigate(b, t, destination);
  };
  await enterEnd(bot, new Task('portal'), goal, () => {}, actions);
  assert(approaches > 0); assert.equal(goal.endPortal.insertions.length, 1);
});

test('an insertion needs both consumption and frame confirmation; cancellation restores the movement policy', async () => {
  for (const mode of ['no_consume', 'no_frame', 'cancel']) {
    const { bot, goal, actions, item, controls } = fixture(), task = new Task('portal');
    bot.activateBlock = async frame => {
      if (mode !== 'no_frame') frame.getProperties().eye = true;
      if (mode !== 'no_consume') item.count--;
      if (mode === 'cancel') task.cancel();
    };
    await assert.rejects(enterEnd(bot, task, goal, () => {}, actions, { confirmationMs: 80 }),
      mode === 'cancel' ? { name: 'Cancelled' } : /frame and inventory confirmation/);
    assert.equal(goal.endPortal.insertions, undefined);
    assert.equal(bot.pathfinder.movements.canDig, true);
    assert.deepEqual(controls(), {});
  }
});

test('filled frames or a partial interior cannot establish an active portal or permit entry', async () => {
  for (const mode of ['filled', 'partial', 'changed']) {
    const { bot, goal, center, blocks, actions } = fixture({ filled: 12, eyes: 0, active: mode !== 'filled' });
    if (mode === 'partial') blocks.delete(`${center}`);
    if (mode === 'changed') blocks.delete(`${center.offset(-2, 0, 0)}`);
    if (mode !== 'changed') assert.equal(activePortal(bot, center), false);
    await assert.rejects(enterEnd(bot, new Task('portal'), goal, () => {}, actions), mode === 'changed' ? /ring/ : /nine observed/);
    assert.equal(goal.gameProgress.milestones.end_entered, undefined);
  }
});

test('verified active portal crossing requires a living End transition and clears controls', async () => {
  for (const transition of ['the_end', 'overworld', 'dead']) {
    const { bot, goal, actions, controls } = fixture({ filled: 12, eyes: 0, active: true });
    bot.setControlState = (name, value) => {
      if (name === 'forward' && value) {
        bot.game.dimension = transition === 'dead' ? 'the_end' : transition;
        if (transition === 'dead') bot.health = 0;
      }
    };
    const run = enterEnd(bot, new Task('portal'), goal, () => {}, actions, { entryMs: 80 });
    if (transition === 'the_end') { await run; assert(goal.gameProgress.milestones.end_entered); }
    else { await assert.rejects(run, /living End/); assert.equal(goal.gameProgress.milestones.end_entered, undefined); }
    assert.deepEqual(controls(), {}); assert.equal(bot.pathfinder.movements.canDig, true);
  }
});

test('portal contact waits for the server dimension packet despite predicted falling and never counts contact alone', async () => {
  for (const received of [true, false]) {
    const { bot, goal, actions } = fixture({ filled: 12, eyes: 0, active: true });
    let timer, contact = false;
    bot.setControlState = (name, value) => {
      if (name === 'forward' && value && !contact) {
        contact = true; bot.entity.position = new Vec3(.5, 62.9, .5);
        if (received) timer = setTimeout(() => { bot.game.dimension = 'the_end'; }, 130);
      }
    };
    try {
      const run = enterEnd(bot, new Task('portal'), goal, () => {}, actions, { entryMs: 200 });
      if (received) { await run; assert(goal.gameProgress.milestones.end_entered); }
      else { await assert.rejects(run, /No living End/); assert.equal(goal.gameProgress.milestones.end_entered, undefined); }
      assert.equal(goal.step.action, 'await_end_transition');
    } finally { clearTimeout(timer); }
  }
});

test('a portal room whose floor a cave took: footing beside the far frame is laid, outside the ring and within reach', () => {
  const { bot, center } = fixture();
  // Nothing under the ring but air (the cave), as in the rehearsal world.
  const blockAt = bot.blockAt;
  bot.blockAt = p => { const b = blockAt(p); return b.name === 'stone' ? { name: 'cave_air', position: p.floored(), boundingBox: 'empty' } : b; };
  const outside = p => Math.abs(Math.floor(p.x) - center.x) > 1 || Math.abs(Math.floor(p.z) - center.z) > 1;
  const frame = center.offset(-2, 0, 0);
  const footings = bridgeFootings(bot, frame, outside);
  assert(footings.length > 0);
  for (const p of footings) {
    assert(outside(p), `${p} is outside the ring`);
    assert.notEqual(bot.blockAt(p.offset(0, -1, 0)).name, 'end_portal_frame', 'never on a frame top');
    assert(p.offset(.5, 1.62, .5).distanceTo(frame.offset(.5, .5, .5)) <= 5, `${p} reaches the frame`);
  }
});
