'use strict';
// Note 715: against one skeleton, a chosen stance holds until its outcome
// (killed, lost, hurt past what the hold priced, or the bot moved off), not
// a line of sight it loses and regains or a few blocks it closes or backs
// off skirmishing, and not a failed try at closing the ground.
//
// 25588 (mid-243-ia, 2026-09-30 02:23-02:26Z) stood within five blocks of
// one skeleton at full health the whole time: encounter_stance flipped
// fight, take_cover, charge_shooter and seal every two to three seconds
// (fight 0.62 -> take_cover 0.79 -> fight 0.84 -> take_cover 0.67 ->
// keep_working -> fight 0.9 -> take_cover 0.65 -> fight 0.44 ->
// charge_shooter 0.41 -> seal 0.7), turn_priority went to survival 18 of 22
// times, and the portal step made no ground. A player shields up, walks to
// the skeleton, kills it in about four hits, and carries on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const holds = require('../src/holds');
const danger = require('../src/danger');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const reflex = require('../src/shot-reflex');

const skeleton = (distance, visible = true, id = 9) => ({ entity: { id, name: 'skeleton', type: 'hostile' }, distance, visible });
const zombie = (distance, visible = true, id = 4) => ({ entity: { id, name: 'zombie', type: 'hostile' }, distance, visible });

test('danger.soloRangedThreat: one bow or crossbow shooter alone, and only alone', () => {
  assert.equal(danger.soloRangedThreat(null, [skeleton(6)]).entity.name, 'skeleton');
  // A piglin only with a crossbow: shooter() itself gates that.
  assert.equal(danger.soloRangedThreat(null, [{ entity: { id: 1, name: 'piglin' }, distance: 6, visible: true }]), null);
  assert.equal(danger.soloRangedThreat(null, [{ entity: { id: 1, name: 'piglin', heldItem: { name: 'crossbow' } }, distance: 6, visible: true }]).entity.name, 'piglin');
  // Not alone: a second threat of any kind ends the solo case (a new threat
  // arrives).
  assert.equal(danger.soloRangedThreat(null, [skeleton(6), zombie(6)]), null);
  // Not a bow or crossbow shooter: a lone zombie is not this rule's mob.
  assert.equal(danger.soloRangedThreat(null, [zombie(6)]), null);
  // Not a blaze or ghast: those have their own established stance mechanics.
  assert.equal(danger.soloRangedThreat(null, [{ entity: { id: 1, name: 'blaze' }, distance: 6, visible: true }]), null);
  assert.equal(danger.soloRangedThreat(null, []), null);
});

test('holds.diverged: a closing stance (fight, charge_shooter) is never "off the spot" it holds at, because closing on the mob is the point of it', () => {
  const fight = holds.begin({ choice: 'fight', at: 0, health: 20, expects: { damage: 1, seconds: 5 }, mobs: [skeleton(6)], offered: ['fight', 'take_cover'] });
  holds.extend(fight, 5000, { x: 0, y: 70, z: 0 });
  assert.equal(fight.spot, undefined, 'a closing stance keeps no spot');
  // Walked six blocks toward the skeleton since: no divergence from that.
  assert.equal(holds.diverged(fight, { now: 6000, health: 20, mobs: [skeleton(2)], offered: ['fight', 'take_cover'], at: { x: 6, y: 70, z: 0 } }), null);

  // take_cover (a holding stance): its spot is fixed at the first extend,
  // and moving off it is the outcome "the bot moved off".
  const cover = holds.begin({ choice: 'take_cover', at: 0, health: 20, expects: { damage: 0.5, seconds: 5 }, mobs: [skeleton(6)], offered: ['fight', 'take_cover'] });
  holds.extend(cover, 5000, { x: 0, y: 70, z: 0 });
  assert.deepEqual(cover.spot, { x: 0, y: 70, z: 0 });
  assert.equal(holds.diverged(cover, { now: 6000, health: 20, mobs: [skeleton(6)], offered: ['fight', 'take_cover'], at: { x: 0, y: 70, z: 0 } }), null, 'still on its spot');
  assert.match(holds.diverged(cover, { now: 6000, health: 20, mobs: [skeleton(6)], offered: ['fight', 'take_cover'], at: { x: 3, y: 70, z: 0 } }), /off the spot it was holding/);
});

test('holds.diverged: alone against one skeleton, a non-hiding stance (seal, fight, charge_shooter) is not ended by the sight it loses and regains or the few blocks it closes or backs off skirmishing', () => {
  const hold = holds.begin({ choice: 'seal', at: 0, health: 20, expects: { damage: 0.5, seconds: 5 }, mobs: [skeleton(6, true)], offered: ['fight', 'seal'] });
  // Came from 6 to 1 block, and out of sight: past NEARER_BY and a sight
  // flip, both of which would end the hold against a crowd, but this is the
  // one mob it was chosen against, alone, skirmishing.
  assert.equal(holds.diverged(hold, { now: 1000, health: 20, mobs: [skeleton(1, false)], offered: ['fight', 'seal'] }), null);
  assert.equal(holds.diverged(hold, { now: 2000, health: 20, mobs: [skeleton(7, true)], offered: ['fight', 'seal'] }), null);
  // Health lost past what the hold priced still ends it (the "hurt by N"
  // outcome): the hold priced about 0.5 damage over 5 seconds, and 20 to 12
  // in two seconds is far past that rate.
  assert.match(holds.diverged(hold, { now: 2000, health: 12, mobs: [skeleton(3, true)], offered: ['fight', 'seal'] }), /health lost/);
  // Gone (killed, or out of range past danger.js's own count): still ends it.
  assert.match(holds.diverged(hold, { now: 1000, health: 20, mobs: [], offered: ['fight', 'seal'] }), /is gone/);
});

test('holds.diverged: the same sight and distance changes still end the hold when it is not one lone bow or crossbow shooter, or when the stance hid the bot (the general rule is not loosened past its scope)', () => {
  // Two mobs: a new threat, so the solo exception does not apply.
  const withZombie = holds.begin({ choice: 'seal', at: 0, health: 20, expects: { damage: 0.5, seconds: 5 }, mobs: [skeleton(6, true), zombie(6, true)], offered: ['fight', 'seal'] });
  assert.match(holds.diverged(withZombie, { now: 1000, health: 20, mobs: [skeleton(1, true), zombie(6, true)], offered: ['fight', 'seal'] }), /came from 6 to 1 blocks off/);
  // A lone walker, not an arrow shooter: the sight flip still ends the hold.
  const withWalker = holds.begin({ choice: 'seal', at: 0, health: 20, expects: { damage: 0.5, seconds: 5 }, mobs: [zombie(6, true)], offered: ['fight', 'seal'] });
  assert.match(holds.diverged(withWalker, { now: 1000, health: 20, mobs: [zombie(6, false)], offered: ['fight', 'seal'] }), /went out of sight/);
  // take_cover (a hiding stance): even alone against the one skeleton it
  // hid from, a regained line still ends the hold (mid-242-y, note 522).
  const cover = holds.begin({ choice: 'take_cover', at: 0, health: 20, expects: { damage: 0.5, seconds: 5 }, mobs: [skeleton(6, false)], offered: ['fight', 'take_cover'] });
  assert.match(holds.diverged(cover, { now: 1000, health: 20, mobs: [skeleton(6, true)], offered: ['fight', 'take_cover'] }), /came into sight/);
});

// Replayed through the real stance step (src/survival.js stanceStep): one
// skeleton skirmishing at 1 to 7 blocks, in and out of sight, full health
// throughout, over three simulated minutes. fight and charge_shooter each
// fail to close the ground about a third of the time they run (a blocked
// step, as the trial's "the ground straight at it stops a closing run");
// take_cover succeeds but the skeleton steps round the block it hid behind
// often. Before note 715, every one of these was a physical trigger
// (lineAgain, a failed run wiping the hold) or a holds.js divergence
// (NEARER_BY, a sight flip, "off the spot"), so the question went out to
// Jev nearly every tick, as 25588's flight record shows (fight 0.62 ->
// take_cover 0.79 -> fight 0.84 -> take_cover 0.67 -> ... every two to
// three seconds). Held against its own outcome instead, Jev is asked only
// a handful of times.
function skirmishBot() {
  const skel = { id: 9, name: 'skeleton', type: 'hostile', position: new Vec3(6.5, 70, 0.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'bow' } };
  const bot = Object.assign(new EventEmitter(), {
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entities: { 9: skel }, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 70, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: p.y < 70 ? 'stone' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty', diggable: true, shapes: p.y < 70 ? [[0, 0, 0, 1, 1, 1]] : [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, _hurtBy: {},
  });
  return { bot, skel };
}
// Distance and sight at tick `i` (0-based): a skirmish, never settling.
const DIST = [6, 5, 3, 1, 2, 5, 7, 6, 4, 2, 1, 3, 6, 7, 5, 3, 2, 1, 4, 6];
const SEES = i => i % 3 !== 0; // out of sight about a third of the time
function setTick(world, i) {
  const d = DIST[i % DIST.length], visible = SEES(i);
  world.skel.position = world.bot.entity.position.offset(d, 0, 0);
  return [{ entity: world.skel, distance: d, visible }];
}
// fight and charge_shooter: move a step toward the skeleton, failing to
// close (no route this tick) one time in three, as the trial's charge did
// against uneven ground; take_cover: hide, but the line is often open
// again the moment the skeleton steps round it (handled by stanceStep
// itself, via lineAgain, reading bot.world.raycast -> null, always "seen").
function skirmishOptions(survival, world) {
  let tries = 0;
  const closeIn = key => ({ description: `${key} toward the skeleton.`, expects: { damage: 0.4, seconds: 5, oneHit: 0 },
    run: async () => {
      tries++;
      if (tries % 3 === 0) { survival.state.stanceWhy = 'the ground straight at it stops a closing run after 2 blocks'; return false; }
      const p = world.bot.entity.position, d = world.skel.position.x - p.x;
      world.bot.entity.position = p.offset(Math.sign(d) * Math.min(1, Math.abs(d)), 0, 0);
      return true;
    } });
  return {
    fight: closeIn('fight'), charge_shooter: closeIn('charge_shooter'),
    take_cover: { description: 'Take cover from the skeleton.', expects: { damage: 0.3, seconds: 5, oneHit: 0 },
      run: async () => { const st = survival.state.stance; if (st) st.hidden = { cell: `${world.bot.entity.position.floored()}`, seenBy: [] }; return true; } },
  };
}

async function replaySkirmish({ ticks = 180 } = {}) {
  const world = skirmishBot();
  const { bot } = world;
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  const asked = [];
  survival.scoutRetreat = async () => {};
  survival.stanceOptions = () => skirmishOptions(survival, world);
  survival.decide = async (task, g, save, q) => {
    const offered = Object.keys(q.tree);
    asked.push({ at: Date.now(), offered });
    const prefer = ['fight', 'charge_shooter', 'take_cover'].find(k => offered.includes(k));
    return { path: [prefer || offered[0]] };
  };
  const real = Date.now;
  let t = 1758000000000;
  try {
    for (let i = 0; i < ticks; i++) {
      Date.now = () => t;
      const danger = setTick(world, i);
      await survival.stanceStep(new Task('x'), {}, () => {}, danger, false);
      t += 500; // the recorded median gap between looks
    }
  } finally { Date.now = real; }
  return { asked, survival, bot };
}

test('replayed through the stance step, one skeleton skirmishing at full health for three minutes holds a stance against its own outcome: Jev is asked a handful of times, not once every two or three seconds (note 715)', async () => {
  const { asked, bot } = await replaySkirmish({ ticks: 180 }); // 90 seconds of looks
  // 25588 was asked encounter_stance about every two to three seconds
  // (roughly 20 times in the ninety seconds this replays); held against the
  // outcome instead, it should be asked only when a hold's own clock caps
  // out or a real outcome fires, not on every sight flip or failed try.
  assert(asked.length <= 8, `Jev asked encounter_stance ${asked.length} times over 180 ticks (90 seconds)`);
  assert.equal(bot.health, 20, 'no damage landed in this skirmish, so the hold was never lost to it either');
});

// Note 715, item 1 (25583 mid-242-mh, 02:47:29-50Z): a ghast 40 to 49
// blocks off had shot_answer asked 8 times in 24 seconds, flipping
// shield_up and keep_on at 0.02 to 0.14 confidence; shield_up's text cited
// the blaze probe ("blazes seven blocks off") for a ghast, and keep_on's
// per-shooter text named no shot at all ("the ghast's about 4.8 health a
// shot").
function ghastWorld({ distance = 45 } = {}) {
  const ghast = { id: 11, name: 'ghast', type: 'hostile', position: new Vec3(distance, 70, 0), height: 4, width: 4, isValid: true, metadata: {}, _shotWarn: { key: `11:${Date.now()}`, at: Date.now(), kind: 'ghast' } };
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0, 70, 0), height: 1.8 }, entities: { 11: ghast },
    inventory: { slots: { 45: { name: 'shield' }, 5: null, 6: null, 7: null, 8: null }, items: () => [] },
    health: 20, _survivalGoal: null, _goal: null,
  });
  return { bot, ghast };
}

test('shot_answer for a ghast alone says its own shot, not a blaze\'s measurements (note 715)', () => {
  const { bot, ghast } = ghastWorld();
  const tree = reflex.shotOptions(bot, [ghast]);
  assert.match(tree.shield_up.description, /Face the ghast/);
  assert.doesNotMatch(tree.shield_up.description, /blazes seven blocks off/, 'a blaze probe cited for a ghast');
  assert.match(tree.shield_up.description, /71% of the shots that landed/, 'the general shield rate is still said');
  assert.match(tree.keep_on.description, /the ghast's fireball, about \d+(\.\d)? health a landing/);
  assert.doesNotMatch(tree.keep_on.description, /ghast's about \d/, 'named no shot at all');
});

test('shot_answer for a blaze still says the blaze probe\'s own measurements', () => {
  const { bot } = ghastWorld();
  const blaze = { id: 12, name: 'blaze', type: 'hostile', position: new Vec3(7, 70, 0), height: 1.8, width: 0.6, isValid: true, metadata: {}, _shotWarn: { key: '12:0', at: Date.now(), kind: 'blaze' } };
  bot.entities[12] = blaze;
  const tree = reflex.shotOptions(bot, [blaze]);
  assert.match(tree.shield_up.description, /Measured at work with blazes seven blocks off/);
});

test('a lone ghast far off holds its last shot_answer for its next warning too, while it has not come much nearer (note 715)', async () => {
  const { bot, ghast } = ghastWorld({ distance: 45 });
  const asked = [];
  const survival = { client: {}, decide: async (task, g, save, q) => { asked.push(q); return { path: ['keep_on'] }; } };
  await reflex.ask(bot, survival, [ghast]);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 1, 'asked the first time');
  assert.equal(bot._shotAnswers.get(11).choice, 'keep_on');
  // A new warning (a fresh charge cycle) a few seconds later, still far off:
  // held, not asked again.
  ghast._shotWarn = { key: `11:${Date.now() + 4000}`, at: Date.now() + 4000, kind: 'ghast' };
  await reflex.ask(bot, survival, [ghast]);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 1, 'still one ask: the far hold answered the second warning');
  assert.equal(bot._shotAnswers.get(11).choice, 'keep_on');
  assert.equal(bot._shotAnswers.get(11).by, 'held');
  // Come within FAR_NEARER_BY of a real approach: asked fresh again.
  ghast.position = new Vec3(45 - reflex.FAR_NEARER_BY, 70, 0);
  ghast._shotWarn = { key: `11:${Date.now() + 8000}`, at: Date.now() + 8000, kind: 'ghast' };
  await reflex.ask(bot, survival, [ghast]);
  await new Promise(r => setImmediate(r));
  assert.equal(asked.length, 2, 'asked again once it came notably nearer');
});
