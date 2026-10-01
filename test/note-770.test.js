'use strict';
// Note 770. 25585 (mid-241-bi, 23:38:26 to 23:39:40Z) switched stance seven
// times against one skeleton 1 to 2.5 blocks off and never swung: every
// option priced a creeper 23.8 blocks off going off beside it (the fight 12.7
// damage where the hunt put the skeleton at 1.3), and the hides said nothing
// of the skeleton being within the sword's reach. 25598 (mid-241-bk, 23:39:26
// to 55Z) guarded a zombie with a skeleton shooting, answered keep_on with a
// zombie 4 blocks off unsaid, and took hits in the quarter second a raised
// shield takes to block.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');

function scene(mobs, { health = 20, items = [{ name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 64 }], shield = true } = {}) {
  const entities = Object.fromEntries(mobs.map(m => [m.id, { type: 'hostile', height: m.name === 'creeper' ? 1.7 : 1.95, width: 0.6, isValid: true, metadata: [], ...m }]));
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food: 19, oxygenLevel: 20,
    entities, time: { timeOfDay: 6000 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, width: 0.6, height: 1.8, eyeHeight: 1.62, velocity: new Vec3(0, 0, 0), metadata: [0] },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, ...(shield ? { 45: { name: 'shield' } } : {}) }, emptySlotCount: () => 10 },
    heldItem: { name: 'iron_sword' },
    blockAt: p => { const f = p.floored(); const s = f.y < 64; return { position: f, name: s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [] }; },
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, activateItem() {}, deactivateItem() {} });
  const danger = Object.values(entities).map(e => ({ entity: e, distance: e.position.distanceTo(bot.entity.position), visible: e.visible !== false }))
    .sort((a, b) => a.distance - b.distance);
  return { bot, danger };
}
const optionsOf = (bot, danger) => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  return survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
};

test('a creeper past its follow range is left out of every stance\'s figures and said so; the fight is priced for the skeleton at arm\'s length (25585 23:39:22Z)', () => {
  const { bot, danger } = scene([
    { id: 1, name: 'skeleton', position: new Vec3(3.0, 64, 0.5), heldItem: { name: 'bow' } },
    { id: 2, name: 'creeper', position: new Vec3(0.5, 64, 24.3) },
  ]);
  const options = optionsOf(bot, danger);
  assert(options.fight, Object.keys(options).join(','));
  for (const [k, o] of Object.entries(options)) {
    assert.match(o.description, /Not counted in these figures, not after the bot from there: the creeper 23\.8 blocks off, past the 16 blocks a creeper sets on a player from/, k);
    assert.doesNotMatch(o.description, /creeper 24 blocks off can go off beside the bot/, k);
  }
  assert(options.fight.expects.damage < 5, `fight priced ${options.fight.expects.damage}`);
  assert.doesNotMatch(options.fight.description, /counted in the fight's figures/);
});

test('a hide from a shooter within the sword\'s reach says a swing reaches it and that hiding gains nothing at that range, with the fight\'s figures (25585 23:39:22 to 37Z)', () => {
  const { bot, danger } = scene([{ id: 1, name: 'skeleton', position: new Vec3(2.5, 64, 0.5), heldItem: { name: 'bow' } }]);
  const options = optionsOf(bot, danger);
  const hides = Object.keys(options).filter(k => ['out_of_sight', 'take_cover', 'nook', 'bunker', 'pillar', 'dig_in'].includes(k));
  assert(hides.length, Object.keys(options).join(','));
  for (const k of hides) assert.match(options[k].description, /The skeleton 2 blocks off is within the sword's reach now: a swing reaches it from where the bot stands\. At this range hiding from it gains nothing but the seconds it takes to walk back into a line .* The fight here, by the same figures: about [\d.]+ seconds and [\d.]+ damage/, k);
  assert.doesNotMatch(options.fight.description, /within the sword's reach now/);
  // Out of reach, not said.
  const far = scene([{ id: 1, name: 'skeleton', position: new Vec3(9.5, 64, 0.5), heldItem: { name: 'bow' } }]);
  for (const o of Object.values(optionsOf(far.bot, far.danger))) assert.doesNotMatch(o.description, /within the sword's reach now/);
});

test('the blow\'s lead names what harms first: a zombie 5 blocks off before a creeper 20 off; a far creeper alone is said by its seconds first', () => {
  const lead = require('../src/survival').blowsLead;
  const zombie = { name: 'zombie', distance: 5, hitsBot: 1.4, visible: true };
  const creeper = { name: 'creeper', distance: 20, hitsBot: 21.1, visible: true };
  assert.match(lead([zombie, creeper], 20).says, /^The zombie 5 blocks off/);
  assert.match(lead([creeper], 20).says, /^The creeper 20 blocks off is about [\d.]+ seconds of walking from lighting beside the bot/);
  // Near, as before: its blast, then its time.
  assert.match(lead([{ ...creeper, distance: 6 }], 20).says, /^The creeper 6 blocks off goes off 1\.5 seconds after it lights/);
});

test('behind a skeleton shooting now, a mob by its blow seconds off is said as farther off with its seconds first', () => {
  const { bot, danger } = scene([
    { id: 1, name: 'skeleton', position: new Vec3(6.5, 64, 0.5), heldItem: { name: 'bow' } },
    { id: 2, name: 'zombie', position: new Vec3(0.5, 64, 14.5) },
  ]);
  const options = optionsOf(bot, danger);
  const first = Object.values(options)[0].description;
  assert.match(first, /^Shooting at the bot from here: the skeleton 6 blocks off, in sight .* Farther off, its first blow about [\d.]+ seconds away at its own speed: the zombie 14 blocks off/);
});

test('shield_guard says where each shooter in sight and a zombie behind out of sight stand from the way the shield faces (25598 23:39:28 and 45Z)', () => {
  const { bot, danger } = scene([
    { id: 1, name: 'zombie', position: new Vec3(-5.5, 64, 2.5) },
    { id: 19, name: 'skeleton', position: new Vec3(-3.5, 64, 6.5), heldItem: { name: 'bow' } },
  ]);
  const options = optionsOf(bot, danger);
  assert(options.shield_guard, Object.keys(options).join(','));
  assert.match(options.shield_guard.description, /As the shield faces the zombie: the skeleton 7\.2 blocks off is \d+ degrees from that way, inside the cover: its arrows are blocked once the shield has been up a quarter second/);
  // A second zombie out of sight 2.5 blocks off behind.
  const hidden = { entity: { id: 44, name: 'zombie', type: 'hostile', position: new Vec3(2.5, 64, -1.0), height: 1.95, width: 0.6, isValid: true }, distance: 2.5, visible: false, unseen: true };
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] } });
  survival.lastHidden = [hidden];
  const guard = survival.shieldGuardOption(new Task('x'), {}, () => {}, { coming: danger, mobs: [], shielded: true, oneHit: 1.4 });
  assert.match(guard.description, /Outside the shield's cover as it faces the zombie: the zombie 2\.5 blocks off, out of sight, \d+ degrees from the way the shield faces/);
});

test('shot_answer\'s keep_on says the zombie at hand, and the shield_up where it stands from the way faced (25598 23:39:45Z)', () => {
  const shot = require('../src/shot-reflex');
  const { bot } = scene([
    { id: 19, name: 'skeleton', position: new Vec3(4.5, 64, 0.5), heldItem: { name: 'bow' } },
    { id: 1, name: 'zombie', position: new Vec3(-3.5, 64, 0.5) },
  ]);
  bot.entities[19]._shotWarn = { kind: 'bow', at: Date.now(), key: 'k' };
  const tree = shot.shotOptions(bot, [bot.entities[19]]);
  assert.match(tree.keep_on.description, /Beside the shots, what bites: the zombie 4 blocks off at arm's length in about [\d.]+ seconds at its own speed, about [\d.]+ a blow; with the shield down its blows land whole too\./);
  assert.match(tree.shield_up.description, /Faced so, the zombie 180 degrees from that way, behind it: its blows land whole\./);
});

test('a volley while the stance question is out is answered by the shield\'s rule, not asked beside it (25598 23:39:45.1Z)', () => {
  const shot = require('../src/shot-reflex');
  const { bot } = scene([{ id: 19, name: 'skeleton', position: new Vec3(4.5, 64, 0.5), heldItem: { name: 'bow' } }]);
  bot.entities[19]._shotWarn = { kind: 'bow', at: Date.now(), key: 'k1' };
  bot._asking = { id: 'encounter_stance' };
  let asked = 0;
  shot.ask(bot, { client: {}, decide: async () => { asked++; return { path: ['keep_on'] }; } }, [bot.entities[19]]);
  assert.equal(asked, 0);
  assert.equal(bot._shotAnswers.get(19).choice, 'shield_up');
  assert.equal(bot._shotAnswers.get(19).by, 'stance');
});

test('the shield is kept up between passes under a holding stance while a shooter has the bot in sight, lowered with none (the rising gap)', () => {
  const { keepShieldForStance } = require('../src/survival');
  const { bot } = scene([{ id: 1, name: 'skeleton', position: new Vec3(6.5, 64, 0.5), heldItem: { name: 'bow' } }]);
  bot._shieldRaised = true;
  bot._stance = { choice: 'take_cover', at: Date.now() };
  assert.equal(keepShieldForStance(bot), true);
  bot._stance = { choice: 'fight', at: Date.now() };
  assert.equal(keepShieldForStance(bot), false);
  const none = scene([]);
  none.bot._shieldRaised = true; none.bot._stance = { choice: 'take_cover', at: Date.now() };
  assert.equal(keepShieldForStance(none.bot), false);
});

test('a stance that swings says the shield\'s re-raise gap; lowering the shield records who lowered it', () => {
  const { bot, danger } = scene([{ id: 1, name: 'zombie', position: new Vec3(3.5, 64, 0.5) }]);
  bot._shieldRaised = true;
  const options = optionsOf(bot, danger);
  assert.match(options.fight.description, /The shield comes down for each swing and blocks again only a quarter second after it goes up: a blow or a shot in that moment lands whole \(\d+ of the \d+ hits on the bots from .* landed so\)\. The shield up now comes down at its first swing\./);
  if (options.shield_guard) assert.doesNotMatch(options.shield_guard.description, /comes down for each swing and blocks again/);
  const { lowerShield } = require('../src/combat');
  bot._shieldRaised = true;
  (function stanceTry() { lowerShield(bot); })();
  assert.match(bot._shieldLowered.by, /stanceTry note-770\.test\.js:\d+/);
});

test('in water with a creeper coming, get_out_of_water says where the landing lies from the creeper against its walk and fuse, that the shield is down for the swim, and is priced through the landing; shield_the_blast says it holds in water (25583 00:02:09Z)', () => {
  const water = (f) => f.y === 64 && f.x <= 2 && f.x >= -6 && Math.abs(f.z) <= 6;
  const { bot, danger } = scene([{ id: 7, name: 'creeper', position: new Vec3(7.5, 64, 0.5) }]);
  bot.blockAt = p => { const f = p.floored(); const w = water(f); const s = f.y < 64 || (f.y === 63 && !w); return { position: f, name: w ? 'water' : s ? 'stone' : 'air', boundingBox: s ? 'block' : 'empty', diggable: s, shapes: s ? [[0, 0, 0, 1, 1, 1]] : [], metadata: 0 }; };
  bot.entity.isInWater = true;
  bot.findBlocks = () => [new Vec3(3, 63, 0)];
  const options = optionsOf(bot, danger);
  assert(options.get_out_of_water, Object.keys(options).join(','));
  const d = options.get_out_of_water.description;
  assert.match(d, /The landing is [\d.]+ blocks from the creeper, nearer to it than the bot is now \(7\): at its walk it can be within 3 blocks of the landing in about [\d.]+ seconds and go off 1\.5 seconds after/);
  assert.match(d, /The shield is down for the swim \(the stance lowers it to move\); raised in water it blocks a blow or a blast from the side it faces as on land/);
  assert.match(d, /At the landing, by the same figures as the other stances: about [\d.]+ damage in the fifteen seconds from now/);
  assert(options.get_out_of_water.expects?.damage > 5, JSON.stringify(options.get_out_of_water.expects) + d);
  if (options.shield_the_blast) assert.match(options.shield_the_blast.description, /In water the shield blocks a blast as on land/);
});
