'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
test('every mob the game calls hostile is a threat: a zombie villager is one', () => {
  // Trial 104: killed by a zombie villager that was on no list, hit five times with no threat in sight.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 18000 }, entities: {} };
  let id = 1;
  for (const e of registry.entitiesArray.filter(e => e.type === 'hostile' && !['enderman', 'zombified_piglin', 'giant', 'wither'].includes(e.name))) {
    bot.entities = { [id]: { id, name: e.name, type: 'hostile', position: new Vec3(4.5, 64, 0.5), height: e.height, width: e.width, isValid: true } };
    assert.equal(threats(bot).length, 1, e.name);
    id++;
  }
});

test('a goat is a threat once it has rammed the bot; near, it is a fact in riskNow, and at 0.7 health a high one', () => {
  // first-days-210: at 0.7 health among goats, it walked up to a rabbit beside two and was rammed to death, told of neither.
  const { threats } = require('../src/danger');
  const { riskNow } = require('../src/risk');
  const registry = require('minecraft-data')('26.1');
  const goat = { id: 7, name: 'goat', type: 'animal', position: new Vec3(4.5, 64, 0.5), height: 1.3, width: 0.9, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: { 7: goat }, health: 20, food: 20, inventory: { items: () => [], slots: [] } };
  assert.equal(threats(bot).length, 0, 'an animal until it rams');
  assert.match(riskNow(bot).animalsThatHit.what.goat, /rams whoever is near/);
  assert.deepEqual(riskNow(bot).animalsThatHit.near, [{ name: 'goat', distance: 4 }]);
  bot.health = 0.7;
  assert.equal(threats(bot).length, 0, 'still no rule: the facts are Jev\'s');
  assert.match(riskNow(bot).level, /^high: one hit from the goat 4 blocks off would end the bot/);
  bot.health = 20; bot._hurtBy = { goat: Date.now() - 5000 };
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['goat'], 'rammed a moment ago: it is attacking');
  assert(require('../src/combat-estimate').MOBS.goat.hit > 0);
});

test('a spider by day is calm only in daylight: one in a dark cave is a threat', () => {
  // first-days-203: at y 19 in a cave by day, a spider at arm's length was counted by no layer.
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const spider = { id: 3, name: 'spider', type: 'hostile', position: new Vec3(2.5, 19, 0.5), height: 0.9, width: 1.4, isValid: true };
  let light = { skyLight: 0, light: 0 };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 19, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 }, entities: { 3: spider }, blockAt: () => ({ name: 'cave_air', ...light }) };
  assert.deepEqual(threats(bot).map(t => t.entity.name), ['spider'], 'dark cave, midday');
  light = { skyLight: 15, light: 0 };
  assert.equal(threats(bot).length, 0, 'in the sun');
  light = { skyLight: 0, light: 14 };
  assert.equal(threats(bot).length, 0, 'by a torch');
  delete bot.blockAt;
  assert.equal(threats(bot).length, 0, 'light unknown: the hour decides, as before');
});

test('an angry enderman closing on the bot is the bot\'s before it is at arm\'s length; one keeping its distance is not', () => {
  // mid-236-c: one screaming from twenty blocks was counted only at four, and hit for seven three times in two seconds after.
  const { provoked } = require('../src/danger');
  const reg = require('prismarine-registry')('26.1');
  const { Vec3 } = require('vec3');
  const key = reg.entitiesByName.enderman.metadataKeys.indexOf('creepy');
  const bot = { registry: reg, entity: { position: new Vec3(0, 64, 0) } };
  const e = { id: 5, name: 'enderman', position: new Vec3(20, 64, 0), metadata: { [key]: true } };
  assert.equal(provoked(bot, e), false, 'first seen at twenty');
  e.position = new Vec3(12, 64, 0);
  assert.equal(provoked(bot, e), true, 'eight blocks nearer at once: coming at the bot');
  const far = { id: 6, name: 'enderman', position: new Vec3(-20, 64, 0), metadata: { [key]: true } };
  assert.equal(provoked(bot, far), false);
  far.position = new Vec3(-19, 64, 1);
  assert.equal(provoked(bot, far), false, 'angry at something else, wandering');
});

test('a wolf that bites turns its pack into threats; any other mob that hurt the bot is one too', () => {
  // mid-218-k was bitten from twenty to none by wolves, never counted a threat, while it chose which cow to hunt (2026-09-27).
  const { threats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const wolf = (id, x) => ({ id, name: 'wolf', type: 'animal', position: new Vec3(x, 64, 0.5), height: 0.85, width: 0.6, isValid: true });
  const bear = { id: 9, name: 'polar_bear', type: 'animal', position: new Vec3(0.5, 64, 5.5), height: 1.4, width: 1.4, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 },
    entities: { 1: wolf(1, 2.5), 2: wolf(2, 4.5), 3: wolf(3, 6.5), 9: bear } };
  assert.equal(threats(bot).length, 0, 'wolves and a bear left be are not threats');
  bot._hurtBy = { wolf: Date.now() }; bot._hurtById = { 1: Date.now() };
  assert.deepEqual(threats(bot).map(t => t.entity.id).sort(), [1, 2, 3], 'the whole pack');
  bot._hurtById[9] = Date.now();
  assert(threats(bot).some(t => t.entity.id === 9), 'a bear that struck the bot');
  bot._hurtBy = { wolf: Date.now() - 60000 }; bot._hurtById = { 1: Date.now() - 60000, 9: Date.now() - 60000 };
  assert.equal(threats(bot).length, 0, 'a minute on, calm again');
});

test('a shooter a charge could not reach is still a threat: its bow reaches the bot', () => {
  // mid-230-p's skeleton, marked unreachable after a charge, shot it every three to six seconds and nothing answered (2026-09-27).
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const skeleton = { id: 7, name: 'skeleton', type: 'hostile', position: new Vec3(8.5, 64, 0.5), height: 1.99, width: 0.6, isValid: true };
  const zombie = { id: 8, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 6.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 },
    entities: { 7: skeleton }, _unreachable: { ids: [7, 8], until: Date.now() + 20000 } };
  assert.equal(immediateThreat(bot)?.entity.id, 7, 'the skeleton');
  // A biter walk-reach does not judge (a cave spider climbs) is left be on the charge's word while it lands nothing.
  bot.entities = { 9: { id: 9, name: 'cave_spider', type: 'hostile', position: new Vec3(0.5, 64, 6.5), height: 0.5, width: 0.7, isValid: true } };
  bot._unreachable.ids.push(9);
  assert.equal(immediateThreat(bot), undefined, 'a climber the charge could not reach is left be while it lands nothing');
  // A walker is not: the charge failing says the bot has no way to it, and whether it has one to the bot is
  // walk-reach's to judge (unknown ground here: it reaches). mid-242-ae's spear piglin (note 586).
  bot.entities = { 8: zombie };
  assert.equal(immediateThreat(bot)?.entity.id, 8, 'a walker the charge could not reach is still judged by its own way to the bot');
});

test('an unseen biter within a hit and a jump is a threat where a knock is a fall, and not on firm ground (mid-227-r-nether-1-nether-1)', () => {
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const cube = { id: 9, name: 'magma_cube', type: 'hostile', position: new Vec3(-0.5, 67, 1.5), height: 2, width: 2, isValid: true };
  // Every ray blocked: out of sight.
  const lip = p => ({ position: p, name: p.x >= 2 && p.y < 64 ? (p.y <= 20 ? 'lava' : 'air') : p.y < 64 ? 'netherrack' : 'air', boundingBox: !(p.x >= 2) && p.y < 64 ? 'block' : 'empty' });
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 20, food: 20, time: { timeOfDay: 6000 },
    world: { raycast: (from) => ({ position: from.offset(0, 0.1, 0) }) }, blockAt: lip, entities: { 9: cube }, inventory: { items: () => [], slots: [] } };
  assert.equal(immediateThreat(bot)?.entity.id, 9, 'at the lip of a drop into lava');
  bot.blockAt = p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' });
  assert.equal(immediateThreat(bot), undefined, 'on firm ground an unseen one is not');
});

test('a shooter whose kind hit the bot a moment ago is a threat however far, hunted or not (mid-227-r-nether-3)', () => {
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const blaze = { id: 4, name: 'blaze', type: 'hostile', position: new Vec3(34.5, 64, 0.5), height: 1.8, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 12, food: 20, time: { timeOfDay: 6000 },
    world: { raycast: () => null }, blockAt: p => ({ position: p, name: p.y < 64 ? 'netherrack' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    entities: { 4: blaze }, inventory: { items: () => [], slots: [] } };
  // In sight past where its volleys mostly land, a blaze fires but seldom
  // lands (combat-estimate FIRE_REACH): not a threat until one does.
  assert.equal(immediateThreat(bot), undefined, 'thirty-four off, in sight, unhunted, landing nothing: its volleys mostly miss from there');
  bot._recentHurtAt = Date.now(); bot._hurtBy = { blaze: Date.now() };
  assert.equal(immediateThreat(bot)?.entity.id, 4, 'its fire landing from thirty-four: a threat (note 491)');
  bot._recentHurtAt = 0; bot._hurtBy = {};
  // Within the twenty-two where a volley lands one more often than not, it
  // is one, hit or not (mid-235-p-fortress-1 at 16.5, note 509).
  blaze.position = new Vec3(17, 64, 0.5);
  assert.equal(immediateThreat(bot)?.entity.id, 4, 'sixteen and a half off: its volleys land');
  blaze.position = new Vec3(34.5, 64, 0.5);
  // Hunted and fit, it is the hunt's while it lands nothing.
  bot.health = 20; bot._huntingEntity = { name: 'blaze', until: Date.now() + 60000 };
  assert.equal(immediateThreat(bot), undefined, 'hunted and landing nothing: the hunt\'s');
  bot._recentHurtAt = Date.now(); bot._hurtBy = { blaze: Date.now() };
  assert.equal(immediateThreat(bot)?.entity.id, 4, 'its fire landing: a threat');
});

test('the mobs a held stance was chosen against stay the survival layer\'s while it holds, out of sight or past a count (mid-242-a, note 535)', () => {
  const { immediateThreat, stanceMobs } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const zombie = { id: 11, name: 'zombie', type: 'hostile', position: new Vec3(8.5, 76, 0.5), height: 1.95, width: 0.6, isValid: true };
  // Two up on its pillar, the zombie below out of sight under its top and
  // eight blocks off: no threat by the ordinary rules.
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 78, 0.5) }, registry, health: 17.4, food: 16, time: { timeOfDay: 20000 },
    world: { raycast: from => ({ position: from.floored(), intersect: from }) }, blockAt: p => ({ position: p, name: p.y < 76 ? 'stone' : 'air', boundingBox: p.y < 76 ? 'block' : 'empty' }),
    entities: { 11: zombie }, inventory: { items: () => [], slots: [] } };
  assert.equal(immediateThreat(bot), undefined, 'no stance: by the ordinary rules it is not one');
  bot._stance = { choice: 'pillar', ids: [11], at: Date.now() - 1000, ranAt: Date.now() - 500, health: 17.4, expects: { damage: 14.8, seconds: 15, oneHit: 2.2 } };
  assert.equal(immediateThreat(bot)?.entity.id, 11, 'the pillar was chosen against it: it holds');
  assert.equal(immediateThreat(bot).stance, 'pillar');
  assert.equal(stanceMobs(bot).length, 1);
  bot._stance.ids = [12];
  assert.equal(immediateThreat(bot), undefined, 'a mob it was not chosen against is judged as ever');
  bot._stance.ids = [11]; bot._stance.choice = 'keep_working';
  assert.equal(immediateThreat(bot), undefined, 'leaving the mobs be holds nothing against them');
  bot._stance.choice = 'pillar'; bot._stance.at = Date.now() - 16000;
  assert.equal(immediateThreat(bot), undefined, 'past its fifteen seconds it is asked again, not held');
  bot._stance.at = Date.now() - 3000; bot._stance.expects.seconds = 2.5;
  assert.equal(immediateThreat(bot), undefined, 'past the seconds it was priced over');
  bot._stance.expects.seconds = 15; bot.health = 11;
  assert.equal(immediateThreat(bot), undefined, 'six health gone since it was chosen');
  bot.health = 17.4; delete bot._stance.ranAt;
  assert.equal(immediateThreat(bot), undefined, 'chosen but not yet run: nothing to hold');
});

test('a retreat\'s chasers still coming at the bot once its run is over stay the survival layer\'s, and the stance is asked again (mid-244-a, note 544)', () => {
  // mid-244-a: the run ended ten blocks ahead of four zombies walking up; past the eight counted for a biter nothing was a threat, and the night's shaft pocket was asked and dug until they bit.
  const { immediateThreat, followers, coming } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const zombie = { id: 21, name: 'zombie', type: 'hostile', position: new Vec3(10.5, 70, 0.5), height: 1.95, width: 0.6, isValid: true };
  const other = { id: 22, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 70, 12.5), height: 1.95, width: 0.6, isValid: true };
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 70, 0.5) }, registry, health: 13.1, food: 16, time: { timeOfDay: 16000 },
    world: { raycast: () => null }, blockAt: p => ({ position: p, name: p.y < 70 ? 'grass_block' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty' }),
    entities: { 21: zombie, 22: other }, inventory: { items: () => [], slots: [] } };
  // The retreat chosen against the first, run 2.5 seconds, over.
  bot._stance = { choice: 'retreat', ids: [21], at: Date.now() - 3000, ranAt: Date.now() - 400, health: 14.5, expects: { damage: 0, seconds: 2.5, oneHit: 1.4 } };
  assert.equal(immediateThreat(bot), undefined, 'not known to be coming: nothing measured yet');
  // A second ago both were 2.3 blocks further from where the bot is now: coming at a zombie's walk.
  const was = Date.now() - 1000;
  bot._mobTracks = new Map([[21, [{ at: was, x: 12.8, y: 70, z: 0.5 }]], [22, [{ at: was, x: 0.5, y: 70, z: 14.8 }]]]);
  const threat = immediateThreat(bot);
  assert.equal(threat?.entity.id, 21, 'the retreat\'s chaser, still coming, is a threat ten blocks off');
  assert.equal(threat.following, 'retreat');
  assert(Math.abs(threat.atBotIn - 8.5 / 2.3) < 0.2, `at the bot in about 3.7 seconds at its own speed, not ${threat.atBotIn}`);
  assert.deepEqual(followers(bot).map(t => t.entity.id), [21], 'the other was not run from: a fact, not the stance\'s');
  assert.deepEqual(coming(bot).map(t => t.entity.id), [21, 22], 'both are coming, each said');
  // One standing where it was is not following.
  bot._mobTracks = new Map([[21, [{ at: was, x: 10.5, y: 70, z: 0.5 }]]]);
  assert.equal(immediateThreat(bot), undefined, 'milling ten blocks off: not coming');
  // Nor once the mobs were left be, or out of sight (a pocket closed round the bot).
  bot._mobTracks = new Map([[21, [{ at: was, x: 12.8, y: 70, z: 0.5 }]]]);
  bot._stance.choice = 'keep_working';
  assert.equal(immediateThreat(bot), undefined, 'leaving the mobs be holds nothing against them');
  bot._stance.choice = 'retreat';
  bot.world.raycast = from => ({ position: from.floored(), intersect: from });
  assert.equal(immediateThreat(bot), undefined, 'out of sight behind a wall: not counted as coming');
});

test('a walker left be as out of a charge\'s reach is a threat again once it walks at the bot (mid-208-k-nether-1, note 552)', () => {
  // Marked out of reach at twelve blocks, the hoglin came on at four blocks a second, nothing claimed it, and it bit from two.
  const { immediateThreat } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  // Since note 586 a walker (the hoglin) is judged by walk-reach, not the charge: shown with a climber the charge
  // could not reach, which walk-reach does not judge.
  const spider = { id: 210, name: 'cave_spider', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 0.5, width: 0.7, isValid: true };
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, world: { raycast: () => null }, time: { timeOfDay: 6000 },
    entities: { 210: spider }, _unreachable: { ids: [210], until: Date.now() + 20000 } };
  assert.equal(immediateThreat(bot), undefined, 'standing off, it is left be while it lands nothing');
  bot._mobTracks = new Map([[210, [{ at: Date.now() - 1000, x: 10.5, y: 64, z: 0.5 }]]]);
  assert.equal(immediateThreat(bot)?.entity.id, 210, 'four blocks nearer in a second: coming, so a threat');
  // The hoglin itself, standing off: a threat, the charge's failure is not its way.
  delete bot._mobTracks;
  bot.entities = { 211: { id: 211, name: 'hoglin', type: 'animal', position: new Vec3(6.5, 64, 0.5), height: 1.4, width: 1.4, isValid: true } };
  bot._unreachable.ids.push(211);
  assert.equal(immediateThreat(bot)?.entity.id, 211);
});

test('a held stance keeps a ghast it was chosen against out to its sixty-four, a walker to twenty-four (mid-235-p-nether-4-fortress-2, note 551)', () => {
  // Hidden from a ghast that drifted to twenty-five to forty blocks: past twenty-four the stance kept nothing,
  // the work had the turn and stood still, and the ghast found a new line and fired.
  const { immediateThreat, stanceMobs, stanceReach } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  const ghast = { id: 21, name: 'ghast', type: 'hostile', position: new Vec3(38.5, 70, 0.5), height: 4, width: 4, isValid: true };
  const zombie = { id: 11, name: 'zombie', type: 'hostile', position: new Vec3(0.5, 64, 30.5), height: 1.95, width: 0.6, isValid: true };
  // Rock everywhere but the bot's cell: nothing in sight.
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 15.3, food: 16, time: { timeOfDay: 6000 },
    world: { raycast: from => ({ position: from.floored(), intersect: from }) }, blockAt: p => ({ position: p, name: 'netherrack', boundingBox: 'block' }),
    entities: { 21: ghast, 11: zombie }, inventory: { items: () => [], slots: [] } };
  assert.equal(stanceReach(ghast), 64);
  assert.equal(stanceReach({ name: 'blaze' }), 48);
  assert.equal(stanceReach(zombie), 24);
  bot._stance = { choice: 'out_of_sight', ids: [21, 11], at: Date.now() - 1000, ranAt: Date.now() - 500, health: 15.3, expects: { damage: 1.3, seconds: 15, oneHit: 3.1 } };
  assert.deepEqual(stanceMobs(bot).map(t => t.entity.id), [21], 'the ghast at thirty-eight kept, the zombie at thirty not');
  assert.equal(immediateThreat(bot)?.entity.id, 21);
  assert.equal(immediateThreat(bot).stance, 'out_of_sight', 'survival keeps the turn while the stance holds');
  // mid-242-aa-nether-2: behind its cover from a ghast sixty-two blocks off, the work walked it out onto a span.
  ghast.position = new Vec3(61.5, 70, 0.5);
  assert.equal(immediateThreat(bot)?.entity.id, 21, 'at sixty-two, behind the cover: still the stance\'s');
  ghast.position = new Vec3(70.5, 70, 0.5);
  assert.deepEqual(stanceMobs(bot), [], 'past its sixty-four');
});

test('a wither skeleton round a corner a few blocks off, with a way to the bot, is a threat and keeps the meal off; one walled apart is not (mid-242-ac-nether-1-fortress-1, note 559)', () => {
  // At 13.1 health a wither skeleton 3.6 blocks off out of sight: nothing claimed it, the meal took the turn, and its first blow took 6.7.
  const { immediateThreat } = require('../src/danger');
  const { claim } = require('../src/vitals');
  const registry = require('minecraft-data')('26.1');
  const skeleton = { id: 7, name: 'wither_skeleton', type: 'hostile', position: new Vec3(2.5, 64, 3.5), height: 2.4, width: 0.7, isValid: true, heldItem: { name: 'stone_sword' } };
  // Every ray toward it blocked (the corner), the floor open between.
  let walled = false;
  const cell = p => p.x === 2 && p.z === 3;
  // A fortress room: brick outside x -3 to 5, z -3 to 6, y 64 to 67.
  const room = p => p.x >= -3 && p.x <= 5 && p.z >= -3 && p.z <= 6 && p.y >= 64 && p.y <= 67;
  const solid = p => !room(p) || (walled && p.y <= 67 && Math.abs(p.x - 2) <= 1 && Math.abs(p.z - 3) <= 1 && (!cell(p) || p.y === 67));
  const bot = { game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, registry, health: 13.1, food: 17, oxygenLevel: 20, time: { timeOfDay: 6000 },
    world: { raycast: (from, dir) => (dir.z > 0.3 ? { position: from.offset(0, 0, 1).floored(), intersect: from.offset(0, 0, 1) } : null) },
    blockAt: p => { const f = p.floored(); return { position: f, name: solid(f) ? 'nether_bricks' : 'air', boundingBox: solid(f) ? 'block' : 'empty' }; },
    entities: { 7: skeleton }, inventory: { items: () => [{ name: 'mutton', count: 6 }], slots: [] } };
  assert.equal(immediateThreat(bot)?.entity.id, 7, 'out of sight 3.6 blocks off with a way round: a threat');
  assert.equal(claim(bot), null, 'and no meal with it there');
  walled = true;
  assert.equal(immediateThreat(bot), undefined, 'shut in a cell of brick: no way to the bot, not a threat');
  assert.equal(claim(bot)?.action, 'eat', 'and the meal is claimed');
});

// mid-244-ad-nether-2 (notes 560, 566): on its own one-wide bridge over a valley, a sword piglin on the slope below
// with no way onto it. The stance was asked of it every fifteen seconds for minutes and the crossing never went on.
function bridgeWorld(from, { ramp = false } = {}) {
  const isSolid = f => f.y < 40 || (f.x >= 3 && f.x <= 14 && f.z >= 5 && f.z <= 14 && f.y <= 62) || (f.y === 64 && f.z === 0 && f.x >= from && f.x <= 0) ||
    // A ledge from the slope up to beside the bridge's end: a step up from the slope, and the bot within reach from it.
    (ramp && f.x >= 0 && f.x <= 3 && f.z >= 1 && f.z <= 5 && f.y <= 63);
  return p => { const f = p.floored(); return { position: f, name: isSolid(f) ? (f.y === 64 ? 'cobblestone' : 'netherrack') : 'air', boundingBox: isSolid(f) ? 'block' : 'empty' }; };
}
const bridgeThreatBot = (world, held = 'golden_sword') => {
  const piglin = { id: 7, name: 'piglin', type: 'hostile', position: new Vec3(4.5, 63, 6.5), height: 1.95, width: 0.6, isValid: true, heldItem: { name: held } };
  return { game: { dimension: 'the_nether', gameMode: 'survival' }, entity: { position: new Vec3(0.5, 65, 0.5) }, registry: require('minecraft-data')('26.1'), health: 20, food: 20, time: { timeOfDay: 6000 },
    world: { raycast: () => null }, blockAt: world, entities: { 7: piglin }, inventory: { items: () => [], slots: [] } };
};
test('a walker with no way to the bot is no encounter while it stays so, unless it hits the bot or shoots (mid-244-ad-nether-2, note 566)', () => {
  const { immediateThreat, noWayIds } = require('../src/danger');
  // The short bridge closes the search inside its bounds (sure); the long one leaves them (any way round is 17 or more).
  for (const from of [-6, -30]) {
    const bot = bridgeThreatBot(bridgeWorld(from));
    assert.equal(immediateThreat(bot), undefined, `bridge from ${from}: the sword piglin on the slope cannot get to the bot`);
    assert.deepEqual([...noWayIds(bot)], [7], `bridge from ${from}`);
    bot._hurtById = { 7: Date.now() };
    assert.equal(immediateThreat(bot)?.entity.id, 7, `bridge from ${from}: once it has hit the bot it is one`);
    const crossbow = bridgeThreatBot(bridgeWorld(from), 'crossbow');
    assert.equal(immediateThreat(crossbow)?.entity.id, 7, `bridge from ${from}: a crossbow piglin shoots, and is one`);
  }
  const ramp = bridgeThreatBot(bridgeWorld(-6, { ramp: true }));
  assert.equal(immediateThreat(ramp)?.entity.id, 7, 'with a way up beside the bridge, it is one');
  // And the risk said to every question leaves it out of what fighting them all costs.
  const risk = require('../src/risk').riskNow(bridgeThreatBot(bridgeWorld(-30)));
  assert.equal(risk.fightingAllHere.damageTaken, 0);
  assert.equal(risk.hostilesWithin.cannotGetToTheBot, 1);
  assert.match(risk.level, /none of the mobs about has a way to the bot/);
});

test('a walker outside the search\'s bounds is not said to have no way to the bot: its way may be straight (note 566)', () => {
  const { walkersApart } = require('../src/walk-reach');
  const flat = p => { const f = p.floored(); return { position: f, name: f.y < 64 ? 'stone' : 'air', boundingBox: f.y < 64 ? 'block' : 'empty' }; };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt: flat };
  const apart = walkersApart(bot, [{ entity: { id: 3, name: 'zombie', position: new Vec3(14.5, 64, 0.5) }, distance: 14 }]);
  assert.equal(apart.ids.size, 0);
  assert.deepEqual(apart.round, [], 'a zombie fourteen blocks off on open ground has a straight way, not one round');
});
