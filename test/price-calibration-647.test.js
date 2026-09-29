'use strict';
// Note 647: the stance prices against what the options took, split by
// situation, and the models that made them run high: the fire a landing
// lights (four ticks, a second after it, not a steady chance of being alight
// at once), the fire already on the body (its ticks, not its seconds), what a
// bow, a crossbow and a ghast land (the game's scatter and the record's
// rates, not every shot every two seconds), a biter out of sight (a quarter),
// and what still lands behind a wall (15 in 100 of the open rate).
const test = require('node:test');
const assert = require('node:assert/strict');
const ce = require('../src/combat-estimate');
const calib = require('../scripts/price-calibration');

const IRON = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
const near = (a, b, eps = 0.06) => Math.abs(a - b) <= eps;

test('the fire a landing lights: nothing for the first second, then a chance that climbs for four to 1 - e^(-4 x the landing rate); not the steady value from the first moment', () => {
  const rate = 0.1;
  assert.equal(ce.burnChance(rate, 0, 30, 0.9), 0, 'no tick before a second has passed');
  assert(near(ce.burnChance(rate, 0, 30, 2), 1 - Math.exp(-rate * 1)), 'a second in, one second of landings can have lit it');
  assert(near(ce.burnChance(rate, 0, 30, 20), 1 - Math.exp(-rate * ce.FIRE_TICKS.fireball)), 'long after, the steady value over the four seconds of ticks');
  // Landings that stop leave the fire to run its five seconds out.
  assert(ce.burnChance(rate, 0, 3, 7) > 0 && ce.burnChance(rate, 0, 3, 9) === 0);
  // As pieces of a timeline: first tick a second in, the last five seconds past the last landing.
  const pieces = ce.burnRamp(rate, 0, 4);
  assert.equal(pieces[0].from, 1);
  assert(near(pieces.at(-1).to, 4 + ce.FIRE_SECONDS.fireball, 1e-9));
  assert(pieces.every(p => p.effect === 'burn' && p.perSecond <= 1 - Math.exp(-rate * ce.FIRE_TICKS.fireball) + 1e-9));
});

test('a blaze ten blocks off costs a stance of a second and a quarter of building under one health, not 2.8; over fifteen seconds in the open it still costs what it took (mid-243-ag, note 631)', () => {
  const e = ce.fightEstimate({ threats: [{ name: 'blaze', distance: 10, visible: true, shoots: true }], armour: IRON, weapon: 'iron_sword', health: 16.9 });
  const setup = ce.stanceCost({ mobs: e.mobs, setup: 1.2, seconds: 1.2 });
  // Over its own 1.2 seconds: the hits, and the fire not yet begun (its first tick a second after a landing).
  assert(setup.damage > 0.1 && setup.damage < 0.5, `${setup.damage}`);
  // The same behind a wall for the fifteen: the seconds of building, and 15 in 100 of the open rate after.
  const behind = ce.stanceCost({ mobs: e.mobs, setup: 1.2, reaches: () => false });
  assert(behind.damage > 1.3 && behind.damage < 2.4, `${behind.damage} (2.8 for the setup alone before)`);
  // What the bot took in the open from a blaze in sight, per second, over the
  // records (0.48 from 8 to 12 blocks, one blaze, all that it did): the open
  // fifteen seconds is 0.5 a second, not 0.8.
  const open = ce.stanceCost({ mobs: e.mobs, setup: 15, seconds: 15, shield: false }).damage / 15;
  assert(open > 0.4 && open < 0.7, `${open} a second`);
});

test('the fire already on the body is its ticks, a second apart and the last a second before it ends: 4.9 seconds left is four more health, 3.5 is three (note 631 open item)', () => {
  assert.equal(ce.bodyBurn(4.9).length, 4);
  assert.equal(ce.bodyBurn(3.5).length, 3);
  assert.equal(ce.bodyBurn(5).length, 5, 'a full five: the landing itself, not yet a second on');
  assert.equal(ce.bodyBurn(1).length, 1, 'alight with nothing stamped, the second to come');
  assert.equal(ce.bodyBurn(0.4).length, 0);
  const zombie = burningFor => ce.fightEstimate({ threats: [{ name: 'zombie', distance: 3, visible: true }], weapon: 'iron_sword', health: 20, burningFor });
  const cold = zombie(0).fightHere.damageTaken, alight = zombie(4.9).fightHere.damageTaken;
  assert(near(alight - cold, 4, 0.11), `four more, not 4.9: ${alight - cold}`);
  assert.match(zombie(4.9).fightHere.fire, /about 5 seconds of fire left.*: 4 more health from it/);
  // The run of phases counts the fire on now as certain until its ticks are done, then the landings' own.
  assert(near(ce.burnBetween([], 0, 3, 4), 3, 0.3) && ce.burnBetween([], 0, 3, 0) === 0);
});

test('a bow\'s arrow lands as the game scatters it: every one within six blocks, 72 in 100 at ten, 56 at fourteen, from a shot every three seconds', () => {
  assert.equal(ce.arrowHit(2), 1);
  assert(ce.arrowHit(6) > 0.99, `${ce.arrowHit(6)}`);
  assert(near(ce.arrowHit(10), 0.72, 0.03) && near(ce.arrowHit(14), 0.56, 0.03), `${ce.arrowHit(10)}, ${ce.arrowHit(14)}`);
  assert(ce.arrowHit(20) < ce.arrowHit(14));
  const e = ce.fightEstimate({ threats: [{ name: 'skeleton', distance: 10, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' });
  assert.equal(e.mobs[0].every, 3);
  assert.equal(e.mobs[0].lands, 0.72);
  assert.match(e.mobs[0].shots, /a shot every 3 seconds, 72 in 100 landing from 10 blocks on a bot standing still/);
  // 15 seconds in its sight, hits of 2.5: 0.24 landings a second, not 0.5.
  const c = ce.stanceCost({ mobs: e.mobs, setup: 15, seconds: 15, shield: false });
  assert(near(c.damage, e.mobs[0].hitsBot * 15 * 0.72 / 3, 0.15), `${c.damage}`);
  // The record: 0.17 a second in sight from 4 to 12 blocks, for a bot that also walks and shields: the model's 0.24 is above it, not a third of it.
  assert(0.72 / 3 > 0.17 && 0.72 / 3 < 0.17 * 2);
});

test('a ghast\'s fireball lands as often as the record has it by its distance, from a shot every three seconds: 43 in 100 within 16 blocks, 27 to 24, 17 to 48, 9 beyond', () => {
  const at = d => ce.ghastShot(d);
  assert.deepEqual([at(10).lands, at(20).lands, at(28).lands, at(40).lands, at(60).lands], [0.43, 0.27, 0.22, 0.17, 0.09]);
  assert.equal(at(40).every, 3);
  const e = ce.fightEstimate({ threats: [{ name: 'ghast', distance: 40, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' });
  assert.equal(e.mobs[0].lands, 0.17);
  assert.match(e.mobs[0].shots, /a fireball every 3 seconds, 17 in 100 landing from 40 blocks \(measured: 52 landings in 929 seconds/);
  const open = ce.stanceCost({ mobs: e.mobs, setup: 15, seconds: 15, shield: false }).damage;
  assert(open > 2 && open < 4, `${open} in fifteen seconds (it was 3.1 x 7.5 = 23 when every shot landed every two seconds)`);
});

test('a piglin\'s crossbow bolt lands as the record has them, 0.03 a second per piglin in sight from four to eight blocks and hardly at all beyond', () => {
  const at = distance => ce.fightEstimate({ threats: [{ name: 'piglin', distance, shoots: true, held: 'crossbow', visible: true }], armour: IRON, weapon: 'iron_sword' }).mobs[0];
  assert.equal(at(6).every, 2.75);
  assert(near(at(6).lands / at(6).every, 0.03, 0.002) && near(at(2).lands / at(2).every, 0.054, 0.002));
  assert(at(11).lands / at(11).every < 0.002 && at(14).lands / at(14).every < 0.001);
  assert.match(at(14).shots, /hardly at all/);
  assert.match(at(6).shots, /about 0\.03 a second per piglin in sight at this range \(measured/);
  // A pillager: the game's scatter, no record to correct it.
  const p = ce.fightEstimate({ threats: [{ name: 'pillager', distance: 10, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' }).mobs[0];
  assert.equal(p.every, 2.75);
  assert.equal(p.lands, 0.72);
});

test('a biter out of sight within eight blocks is counted at a quarter of its blows, and said so; one in sight, or far and counted by when it could be there, is not', () => {
  const at = extra => ce.fightEstimate({ threats: [{ name: 'zombie', distance: 5, visible: !extra.unseen, ...extra }], armour: IRON, weapon: 'iron_sword', health: 20 });
  const seen = at({}), hidden = at({ unseen: true });
  assert(near(hidden.fightHere.inFifteenSeconds, seen.fightHere.inFifteenSeconds * ce.UNSEEN.arrives, 0.11), `${hidden.fightHere.inFifteenSeconds} against ${seen.fightHere.inFifteenSeconds}`);
  assert.equal(ce.UNSEEN.arrives, 0.25);
  const build = e => ce.stanceCost({ mobs: e.mobs, setup: 2, fight: { lead: true } });
  assert.deepEqual(build(hidden).unseenBiters, ['zombie']);
  assert.equal(build(seen).unseenBiters, undefined);
  // Counted by when it can be there before the build is done: whole (survival.js farBiters marks it `far`).
  const far = at({ unseen: true }).mobs.map(m => Object.assign(m, { far: true }));
  assert.equal(ce.stanceCost({ mobs: far, setup: 8, reaches: () => false }).damage, ce.stanceCost({ mobs: seen.mobs, setup: 8, reaches: () => false }).damage);
  // The sentence beside the figure.
  const { costSays } = require('../src/survival');
  const says = costSays(build(hidden), 20, hidden.mobs, { doing: 'building' });
  assert.match(says, /The zombie out of sight within eight blocks is counted at 25 in 100 of their blows: a mob takes a player as its target only in sight and drops it after three seconds out of it/);
  assert.doesNotMatch(costSays(build(seen), 20, seen.mobs, { doing: 'building' }), /out of sight within eight blocks/);
});

test('behind a wall a shooter still lands 15 in 100 of what it lands in the open, after the seconds of building; said beside the figure, and not where the stance is over in its own seconds', () => {
  assert.equal(ce.COVER_LEAK, 0.15);
  const e = ce.fightEstimate({ threats: [{ name: 'skeleton', distance: 10, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword', health: 20 });
  const bare = ce.stanceCost({ mobs: e.mobs, setup: 2, reaches: () => false, shield: false });
  const openAll = ce.stanceCost({ mobs: e.mobs, setup: 15, seconds: 15, shield: false }).damage;
  const openSetup = ce.stanceCost({ mobs: e.mobs, setup: 2, seconds: 2, shield: false }).damage;
  // The setup in the open, then 13 seconds at 15 in 100 of the open rate.
  assert(near(bare.damage - openSetup, (openAll - openSetup) * 0.15 * 13 / 13 * 1, 0.4), `${bare.damage}: ${openSetup} in the setup, ${(bare.damage - openSetup).toFixed(2)} after, the open rate x 0.15 x 13 s is ${(openAll / 15 * 0.15 * 13).toFixed(2)}`);
  assert.deepEqual(bare.leaks, ['skeleton']);
  // A stance that is over in its own seconds (a meal, a run) has no "after".
  assert.equal(ce.stanceCost({ mobs: e.mobs, setup: 2, seconds: 2, reaches: () => false }).leaks, undefined);
  // One the stance fights, or that reaches the bot again, is not leaking.
  assert.equal(ce.stanceCost({ mobs: e.mobs, setup: 2, reaches: () => true }).leaks, undefined);
  const { costSays } = require('../src/survival');
  assert.match(costSays(bare, 20, e.mobs, { doing: 'placing it', done: 'Behind it' }), /The skeleton kept off by what stands between still lands 15 in 100 of what it lands in the open after the first seconds \(measured/);
  // A blaze: its landing rate divided, its fire with it.
  const b = ce.fightEstimate({ threats: [{ name: 'blaze', distance: 10, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword', health: 20 });
  const bl = ce.stanceCost({ mobs: b.mobs, setup: 2, reaches: () => false }), blOpen = ce.stanceCost({ mobs: b.mobs, setup: 2, seconds: 2 });
  assert(bl.damage > blOpen.damage && bl.damage < blOpen.damage + 0.15 * ce.stanceCost({ mobs: b.mobs, setup: 15, seconds: 15 }).damage + 0.6, `${blOpen.damage} in the setup, ${bl.damage} with the leak`);
});

test('the estimate said on the mob: what its shots land at, in the state Jev is given, and the instructions say a figure is an expected damage', () => {
  const e = ce.fightEstimate({ threats: [{ name: 'ghast', distance: 30, shoots: true, visible: true }, { name: 'skeleton', distance: 8, shoots: true, visible: true }], armour: IRON, weapon: 'iron_sword' });
  assert(e.mobs.every(m => m.every && m.lands && m.shots));
  const { DECISIONS } = require('../src/decisions/survival');
  const stance = (DECISIONS || []).find?.(d => d.id === 'encounter_stance');
  if (stance) assert.match(stance.instructions.guidance, /A figure is an expected damage, an average over a few large hits/);
});

// ---- the calibration script's splits ----
const at = s => 1_800_000_000_000 + s * 1000;
const state = (threats, extra = {}) => ({ threats, health: 20, armour: [], weapon: 'iron_sword', shield: false, est: threats.map(t => ({ name: t.name, distance: t.distance, shoots: !!t.shoots, visible: t.visible !== false })), fire: 0, ...extra });
const decisionFrame = (t, option, description, { health = 20, dimension = 'the_nether', threats = [{ name: 'blaze', distance: 10, shoots: true, visible: true }], extra } = {}) => ({ at: at(t), kind: 'decision',
  snapshot: { health, dimension, decision: { id: 'encounter_stance', at: new Date(at(t)).toISOString(), path: [option], judgments: [1], options: { [option]: { description } }, state: state(threats, extra) } } });
const beat = (from, to, { health = 20, mobs = [{ name: 'blaze', d: 10 }] } = {}) => { const out = []; for (let t = from; t <= to; t += 1) out.push({ at: at(t), kind: 'observation', snapshot: { health, dimension: 'the_nether', mobs } }); return out; };
const hurt = (t, type, cause, health) => [{ at: at(t), kind: 'damage', detail: { type, cause }, snapshot: { health } }, { at: at(t) + 60, kind: 'observation', snapshot: { health: health - 3, dimension: 'the_nether' } }];
const COVER = 'Put a block. About 3 damage from the mobs here in the next fifteen seconds this way, the 1.2 seconds of placing it included, from 20 health. Behind it, none of them reaches it.';

test('every answer says the situation it was given in (the mobs, the health band, the dimension), the seconds to the next ask, when in the window each hurt fell, and how near the mobs came', () => {
  assert.equal(calib.kindOf(['zombie', 'blaze']), 'blaze');
  assert.equal(calib.kindOf(['zombified_piglin']), 'piglin');
  assert.equal(calib.kindOf(['ghast']), 'ghast');
  assert.equal(calib.kindOf(['cave_spider']), 'spider');
  assert.equal(calib.kindOf(['enderman']), 'other');
  assert.equal(calib.kindOf([]), 'none');
  assert.deepEqual([7.9, 8, 14, 14.1].map(calib.bandOf), ['under 8', '8 to 14', '8 to 14', 'over 14']);
  const frames = [decisionFrame(0, 'take_cover', COVER), decisionFrame(1.5, 'fight', 'Fight. about 9 of it in the first fifteen seconds, from 20 health.'), ...beat(0, 40, { mobs: [{ name: 'blaze', d: 10 }, { name: 'zombie', d: 20 }] }), ...hurt(4, 'fireball', 'blaze', 20), ...hurt(6, 'fall', undefined, 17)].sort((a, b) => a.at - b.at);
  const { answers } = calib.calibrate(frames);
  const a = answers.find(x => x.option === 'take_cover');
  assert.deepEqual([a.kind, a.nether, a.band, a.near, a.n, a.next, a.closest], ['blaze', true, 'over 14', 10, 1, 1.5, 10]);
  // The fall is not the mobs': taken counts both, takenMob the fireball only; when it fell is in seconds after the answer.
  assert.equal(a.taken, 6);
  assert.equal(a.takenMob, 3);
  assert.deepEqual(a.when.map(([t, d, type]) => [t, d, type]), [[4, 3, 'fireball']]);
  assert.equal(a.est.length, 1);
});

test('a fight that ends early says when: the mobs of the kinds priced gone from the frames inside the window, and is compared at its own length', () => {
  const fight = 'Fight here. Estimated: about 9 seconds and 30 damage to kill them all, from 20 health; about 12 of it in the first fifteen seconds.';
  const frames = [decisionFrame(0, 'fight', fight, { threats: [{ name: 'zombie', distance: 4 }] }), ...beat(0, 4, { mobs: [{ name: 'zombie', d: 4 }] }), ...beat(5, 40, { mobs: [] })];
  const { answers } = calib.calibrate(frames);
  assert.equal(answers[0].over, 5);
  // Whole: an engagement that lasted the window; prorated: the price cut to the seconds it lasted.
  const long = { option: 'fight', priced: 12, capped: 12, taken: 0, takenMob: 0, seconds: 15 };
  const rows = [answers[0], long];
  assert.equal(calib.table(rows, { view: 'whole', minN: 1 }).rows[0].n, 1);
  assert.equal(calib.table(rows, { view: 'all', minN: 1 }).rows[0].n, 2);
  const pro = calib.table([answers[0]], { view: 'prorated', minN: 1 }).rows[0];
  assert(near(pro.meanCapped, 12 * 5 / 15, 0.01), `${pro.meanCapped}`);
});

test('rows split by situation, health band or dimension, and repeated asks are one decision: an episode is the first of a stretch of the same option in a run', () => {
  const mk = (kind, option, capped, takenMob, run, t) => ({ kind, option, priced: capped, capped, taken: takenMob, takenMob, seconds: 15, band: 'over 14', nether: true, run, at: t });
  const rows = [mk('blaze', 'take_cover', 4, 1, 'a', 0), mk('blaze', 'take_cover', 4, 1, 'a', 500), mk('blaze', 'take_cover', 4, 1, 'a', 90000), mk('blaze', 'take_cover', 4, 1, 'a', 400000), mk('ghast', 'take_cover', 2, 0, 'b', 0)];
  const eps = calib.episodes(rows);
  assert.equal(eps.length, 3, 'the asks at 0, 0.5 and 90 seconds are one; the one at 400 seconds and the other run\'s are two more');
  const t = calib.table(eps, { by: 'situation', minN: 1 });
  assert.deepEqual(t.rows.map(r => [r.group, r.option, r.n]), [['blaze', 'take_cover', 2], ['ghast', 'take_cover', 1]]);
  assert.equal(calib.table(rows, { by: 'dimension', minN: 1 }).rows[0].group, 'nether');
  assert.match(calib.print(t, { noFigure: 0, unfinished: 0 }, 5, 1), /^group\s+option/);
});

test('priced again by another model of the same mobs: the recorded price moved by what the model changes, a fire already on the body left where it was', () => {
  const old = require('../src/combat-estimate');
  // A model that counts every landing's fire whole and steady, as the baseline did.
  const answer = { option: 'take_cover', priced: 8.5, capped: 8.5, taken: 7.9, takenMob: 7.9, seconds: 15, health: 15.1, hp: 15.1, armour: ['iron_helmet', 'iron_chestplate'], weapon: 'iron_sword', shield: true, fire: 4, desc: 'the 1.2 seconds of placing it included. Behind it, none of them reaches it.', est: [{ name: 'blaze', distance: 10.2, shoots: true, visible: true }] };
  const same = calib.reprice([answer], old, old)[0];
  assert.equal(same.priced, 8.5, 'the same model on both sides moves nothing');
  const lower = { ...old, fightEstimate: args => old.fightEstimate({ ...args, burningFor: args.burningFor }), stanceCost: p => { const r = old.stanceCost(p); return { ...r, damage: r.damage + 1.5 }; } };
  const after = calib.reprice([answer], old, lower)[0];
  assert(near(after.priced, 10, 0.02) && after.repriced, `${after.priced}`);
  assert.equal(after.capped, 10);
  assert.equal(calib.reprice([{ ...answer, none: true }], old, lower)[0].none, true);
  // The stretch the option prices, from its text.
  assert.deepEqual(calib.stanceOf(answer), { setup: 1.2, seconds: 15, fight: null, shootersReach: false });
  assert.equal(calib.stanceOf({ option: 'fight', desc: '', seconds: 15 }).fight.lead, true);
});

test('a magma cube or a slime is priced at its own size, not as the big one and all its family: health the size squared, a hit of the size (a magma cube\'s two more), and about three of half its size where it dies', () => {
  const worn = ['iron_helmet', 'iron_chestplate'];
  const fight = (name, size) => ce.fightEstimate({ threats: [{ name, distance: 5, visible: true, ...(size ? { size } : {}) }], armour: worn, weapon: 'iron_sword', health: 20 });
  const [small, medium, big, unknown] = [1, 2, 4, undefined].map(s => fight('magma_cube', s));
  assert.deepEqual([small.mobs.length, medium.mobs.length, big.mobs.length], [1, 4, 13], 'the small one alone; the medium and three smalls; the big, three mediums and nine smalls');
  assert.equal(unknown.mobs.length, 13, 'no size known: the big one, the most it can be');
  assert.match(small.mobs[0].note, /a small one: 1 health, a hit of 3 before armour$/);
  assert.match(medium.mobs[0].note, /a medium one: 4 health, a hit of 4 before armour, and it splits into about three of size 1/);
  assert(small.fightHere.damageTaken < 2 && medium.fightHere.damageTaken < big.fightHere.damageTaken / 3, `${small.fightHere.damageTaken}, ${medium.fightHere.damageTaken}, ${big.fightHere.damageTaken}`);
  // A slime: the size is the hit (4, 2, 1) and the family is the same.
  const slime = fight('slime', 2);
  assert.equal(slime.mobs.length, 4);
  assert.equal(slime.mobs[0].hitsBot, Math.round(ce.afterArmour(2, ce.armourOf(worn)) * 10) / 10);
  // The size from the entity's own metadata (index 16).
  assert.equal(ce.slimeSize({ name: 'magma_cube', metadata: { 16: 2 } }), 2);
  assert.equal(ce.slimeSize({ name: 'magma_cube', metadata: {} }), undefined);
  assert.equal(ce.slimeSize({ name: 'zombie', metadata: { 16: 2 } }), undefined);
});

test('a fight priced with biters that are not coming at the bot says so, with what the record has of such fights; not where one is coming, at arm\'s length, or a shooter', () => {
  const { EventEmitter } = require('events');
  const { Vec3 } = require('vec3');
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, registry: require('minecraft-data')('26.1'),
    inventory: { items: () => [{ name: 'iron_sword' }, { name: 'cobblestone', count: 64 }], slots: {} },
    blockAt: p => ({ position: p, name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }), world: { raycast: () => null }, findBlocks: () => [] });
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const t = (name, distance, extra = {}) => ({ entity: { id: distance, name, position: new Vec3(distance, 64, 0), height: 1.95 }, distance, visible: true, ...extra });
  const fight = list => survival.stanceOptions(new Task('x'), {}, () => {}, list, false).fight.description;
  const idle = fight([t('zombie', 8)]);
  assert.match(idle, /The zombie 8 blocks off is not coming at the bot now \(none nearer by a block a second\), and the figure counts it as coming: in the flight records, of the fights begun with biters like that, about a third had one at arm's length inside fifteen seconds \(a fifth on the latest builds\), and the bot took about a quarter of what was priced/);
  assert.match(fight([t('zombie', 8), t('zombie', 12)]), /2 of the biters 8 to 12 blocks off are not coming at the bot now/);
  assert.doesNotMatch(fight([t('zombie', 8, { approach: 2 })]), /not coming at the bot now/, 'coming at two blocks a second');
  assert.doesNotMatch(fight([t('zombie', 2.5), t('zombie', 8)]), /not coming at the bot now/, 'one at arm\'s length: the fight is on');
  assert.doesNotMatch(fight([t('zombie', 20)]), /not coming at the bot now/, 'past sixteen');
});
