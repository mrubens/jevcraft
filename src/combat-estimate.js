'use strict';
// What a fight would cost this bot, from the game's own numbers: each mob's
// hit after this bot's armour, how many swings of this weapon kill it, and,
// for fighting where it stands, about how much health it takes to kill them
// all. Facts for Jev's stance question, not a rule: the general figures in
// its guidance ("a zombie hits for about 3") left the sum to Jev, and it
// chose to fight three zombies at eight health unarmoured (2026-09-24).
//
// Normal difficulty. Melee mobs hit about once a second at arm's length;
// shooters about every two seconds while in sight. Every biting mob is taken
// to reach the bot, and the nearest is killed first. The mob being struck is
// knocked back by each swing and lands about a third of its hits (the
// bot's recorded fights, 0.27 a second, note 550). Checked against the
// arena's cave trio (a skeleton and two zombies, iron armor with gold
// boots, a diamond sword): estimated about 8 damage in 6 seconds, measured
// 4.9 to 5.5 in 7 (with a shield raised between swings).
const STRUCK = 1 / 3;
const WALK = 4; // blocks a second, closing on a mob

// Wither I, as a wither skeleton's hit gives it (26.1 WitherSkeleton
// doHurtTarget: two hundred ticks, amplifier 0): one health every forty
// ticks through armour, able to take the last, for ten seconds after the
// last hit that lands; hits from two of them do not add, each renews it.
// mid-235-p-fortress-7 fought one at 15.5 health told 13.7 damage, the
// blade alone; it was gone at 7.2, and the wither and the fire left 4.2
// (note 528).
const WITHER = { perSecond: 0.5, seconds: 10 };
// Poison I, as a cave spider's bite, a bee's sting, a bogged's arrow or a
// witch's potion gives it, read from the 26.1.2 server jar: one health
// every twenty-five ticks (PoisonMobEffect, 25 >> amplifier), magic, which
// armour does not stop, and only while health is above 1 (it takes a whole
// point from 1.23 and leaves 0.23, and nothing from 1: the poison alone
// never kills; the bite after it does). It ticks when the time left is a
// multiple of twenty-five, so a fresh bite's first point comes three
// quarters of a second after it. A bite renews it to its full length, one
// poison over another adds nothing. Its length by difficulty (CaveSpider
// and Bee doHurtTarget): a cave spider's seven seconds on Normal (fifteen
// on Hard), a bee's ten (eighteen); a bogged's arrow five (Bogged, a
// hundred ticks); a witch's thrown potion forty-five (Potions.POISON).
// Natural healing goes on beside it (FoodData does not look at effects),
// a point each four seconds at eighteen hunger or more: the poison outruns
// it three to one. mid-243-f, at 6.1 health among cave spiders by their
// spawner, was told the fight cost 0.4 (the bites alone, one spider); the
// poison took a point every 1.25 seconds from 8.1 to 0.23 and a bite
// finished it (note 542).
const POISON = { perSecond: 20 / 25, first: 0.75, floor: 1 };
// What a poison of `poison` damage leaves of `damage` in all against
// `health`: the poison takes nothing below 1.
const poisonFloored = (damage, poison, health) => !(poison > 0) || !Number.isFinite(health) ? damage : damage - poison + Math.min(poison, Math.max(0, health - POISON.floor));
// A poison or wither running on the bot now: the seconds left, the time
// the server sent it being stamped where it came (session.js effectAt);
// mineflayer keeps the duration it was sent, not what is left.
function effectLeft(bot, name, now = Date.now()) {
  const effects = bot?.entity?.effects || {};
  for (const [id, e] of Object.entries(effects)) {
    const n = (bot.registry?.effects?.[id]?.name || bot.registry?.effectsArray?.find(x => x.id === Number(id))?.name || '').toLowerCase();
    if (n !== name || !Number.isFinite(e?.duration)) continue;
    const gone = Number.isFinite(e.at) ? (now - e.at) / 1000 : 0;
    return { seconds: Math.max(0, e.duration / 20 - gone), amplifier: e.amplifier || 0 };
  }
  return null;
}
// Fire on a player, read from the 26.1.2 server jar: a blaze's small
// fireball that lands sets five seconds (SmallFireball.onHitEntity,
// igniteForSeconds 5; one a shield takes puts it back out), a fire block
// eight after the body leaves it (BaseFireBlock.entityInside), lava fifteen
// (Entity.lavaHurt); each sets the time left to the longer of the two, and
// it burns one health a second (Entity.baseTick, on_fire, which armour does
// not stop) however many lit it. Only water or time puts it out, and the
// Nether has no water.
const FIRE_SECONDS = { fireball: 5, in_fire: 8, lava: 15 };
const BURN_PER_SECOND = 1;
// What a landing's fire takes, measured (note 631): over the flight records
// of 2026-09-28, 357 blaze fireballs that landed on a bot not already alight
// and burned out before the next hurt took four ticks of fire each in 293
// (the first a second after the landing, then one a second, none at the
// fifth: the 100 ticks of a five second fire, one hurt each 20), the others
// cut short (a death, a swing of the shield) or relit, so a landing costs its
// hit and four more, the fire half of it and more at iron: 2.5 + 4 = 6.5
// through full iron (scripts/blaze-record.js --landings). Of the 63
// deaths that had a landing in their last fifteen seconds, 48 took it at
// 6.5 health or less, where one landing is the end, and the questions said
// "at 3 health, 2 fireballs (2.5 each) end it".
const FIRE_TICKS = { fireball: 4 };
// The fire a stretch of landings lights, as the health it is expected to take
// (note 647). A landing at u puts the bot alight for FIRE_SECONDS.fireball
// and the fire's ticks come a second after it, one a second, FIRE_TICKS of
// them: a tick density of one over [u + 1, u + 5). With landings at
// `perSecond` (Poisson) from `from` to `to`, a tick falls at t if a landing
// fell in the four seconds ending one second before it, so at t the chance
// is 1 - e^(-perSecond x that overlap), and it is not at its steady value
// the moment the shooting starts: it starts a second in and climbs for four.
// Priced as if it were (a steady chance of being alight from the first
// second, five seconds past the last shot), a blaze ten blocks off cost a
// stance of a second and a quarter's building 2.8, where the hits and fire
// of its landings in those seconds come to under one; the holding stances'
// prices ran two to three times what they took (note 631, note 647).
const BURN_STEP = 0.5;
const burnLag = () => FIRE_SECONDS.fireball - FIRE_TICKS.fireball;
function burnChance(perSecond, from, to, t) {
  const a = Math.max(from, t - FIRE_SECONDS.fireball), b = Math.min(to, t - burnLag());
  return b > a ? 1 - Math.exp(-perSecond * (b - a)) : 0;
}
// The same over landings at different rates in turn (`segments`: [{ from, to,
// perSecond }], the landing rates of the phases of a run so far): the health
// the fire takes between t0 and t1, the fire already on the bot (`alightUntil`
// seconds from the run's start) counted as certain while it lasts.
function burnBetween(segments, t0, t1, alightUntil = 0) {
  let total = 0;
  for (let t = t0; t < t1 - 1e-9; t += BURN_STEP) {
    const b = Math.min(t + BURN_STEP, t1), mid = (t + b) / 2;
    const lands = segments.reduce((n, g) => n + g.perSecond * Math.max(0, Math.min(g.to, mid - burnLag()) - Math.max(g.from, mid - FIRE_SECONDS.fireball)), 0);
    total += (mid < Math.max(0, alightUntil - 0.5) ? 1 : 1 - Math.exp(-lands)) * (b - t);
  }
  return total;
}
// The fire already on the body (`left` seconds of it, burnLeft), as pieces:
// its ticks fall a second apart and the last a second before it ends, so
// 4.9 seconds left is four more health and 3.5 is three, not a health a
// second for the whole of them (note 631's open item: about a point over on
// every fire the bot was alight in). One piece a tick, from where it falls.
function bodyBurn(left) {
  const out = [], ticks = Math.floor(left + 1e-9), start = Math.max(0, left - ticks - 0.5);
  for (let i = 0; i < ticks; i++) out.push({ from: start + i, to: start + i + 1, perSecond: BURN_PER_SECOND, effect: 'burn' });
  return out;
}
// The same as pieces of a timeline: [{ from, to, perSecond: chance a tick
// falls, effect: 'burn' }], each BURN_STEP long, from the first tick's second
// to the last landing's fire going out.
function burnRamp(perSecond, from, to) {
  const out = [];
  if (!(perSecond > 0) || !(to > from)) return out;
  for (let a = from + burnLag(); a < to + FIRE_SECONDS.fireball - 1e-9; a += BURN_STEP) {
    const b = Math.min(a + BURN_STEP, to + FIRE_SECONDS.fireball), p = burnChance(perSecond, from, to, (a + b) / 2);
    if (p > 0) out.push({ from: a, to: b, perSecond: p, effect: 'burn' });
  }
  return out;
}
// One landing's cost in health: the hit and the fire it sets, less the fire
// still to come on a bot already alight (a landing sets it back to its five
// seconds, so it adds only what that is beyond what was left).
function landingCost(hit, alightFor = 0) {
  return hit + Math.max(0, FIRE_TICKS.fireball - Math.max(0, alightFor));
}
// How many landings end the bot from `health` when each comes from its own
// volley (nine seconds apart, so each fire burns out before the next: a
// landing is `landingCost` whole), the fire already on it counted first.
function landingsApart(health, hit, alightFor = 0) {
  if (!(hit > 0)) return null;
  const alight = Math.max(0, alightFor), left = health - alight;
  if (left <= 0) return 0;
  const first = landingCost(hit, alight);
  return first >= left ? 1 : 1 + Math.ceil((left - first) / landingCost(hit));
}
// A blaze's landings, said: how many end the bot, from separate volleys and
// (the fewest) within one, and what one is (note 631).
function landingsSays(health, hit, alightFor = 0, { who = 'the blaze' } = {}) {
  const r = n => Math.round(n * 10) / 10, hp = r(health), alight = Math.max(0, alightFor);
  const volley = landingsToEnd(health, hit, alight), apart = landingsApart(health, hit, alight);
  if (volley === null) return '';
  if (volley === 0) return `At ${hp} health the burning alone ends the bot; a fireball that lands only hurries it (about ${r(hit)} after armour).`;
  const extra = Math.max(0, FIRE_TICKS.fireball - alight), one = r(landingCost(hit, alight));
  const fire = extra > 0 ? `about ${extra} more health from the fire` : 'no more health than the fire already on it';
  if (volley === 1) return `At ${hp} health, 1 fireball from ${who} that lands ends it: it is about ${r(hit)} after armour and sets the bot alight for ${FIRE_SECONDS.fireball} seconds, ${fire} (${one} for one landing${alight > 0 ? ', less the fire still to come' : ''}).`;
  const each = r(landingCost(hit));
  const what = `each is about ${r(hit)} after armour and sets the bot alight for ${FIRE_SECONDS.fireball} seconds, about ${FIRE_TICKS.fireball} more health from the fire: ${each} for one landing`;
  if (apart === volley) return `At ${hp} health, ${apart} fireballs from ${who} that land end it (${what}).`;
  return `At ${hp} health, ${apart} fireballs from ${who} that land from separate volleys end it (${what}), or ${volley} in one volley, whose fire is one fire.`;
}
// How many landings in one volley end the bot from `health` (the fire
// already on it counted first): 0 where the burning alone does, else at
// least one. A volley's three come within a fifth of a second, so their
// fires are one fire.
function landingsToEnd(health, hit, alightFor = 0) {
  const left = health - Math.max(0, alightFor);
  if (!(hit > 0)) return null;
  if (left <= 0) return 0;
  for (let n = 1; n <= 40; n++) if (n * hit + Math.max(0, FIRE_TICKS.fireball - Math.max(0, alightFor)) >= left) return n;
  return 40;
}
// The seconds of fire left on the bot now: from the last hurt that lit it
// (session.js stamps _alightUntil), while the game says it burns; alight
// with nothing stamped, the second to come. mid-208-k was asked its stance
// at 5.9 health alight, the fire in no figure, and burned the rest (note 548).
function burnLeft(bot, now = Date.now()) {
  if (!(bot?.entity?.metadata?.[0] & 1)) return 0;
  const left = ((bot._alightUntil || 0) - now) / 1000;
  return left > 0 ? left : 1;
}
// The seconds a set of [from, to] spans covers, overlaps counted once.
function spanned(spans) {
  let total = 0, end = -Infinity;
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end); end = b;
  }
  return total;
}
// The same spans merged, as timeline pieces at an effect's rate (the
// wither's, or the poison's), marked with which it is.
function effectPieces(spans, effect = 'wither') {
  const out = [], perSecond = effect === 'poison' ? POISON.perSecond : WITHER.perSecond;
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last.to) last.to = Math.max(last.to, b); else out.push({ from: a, to: b, perSecond, effect });
  }
  return out;
}
// The spans an effect covers, each [from, to] clipped to [0, end].
const clipped = (spans, end) => spans.map(([a, b]) => [Math.max(0, a), Math.min(b, end)]);

// Damage per hit on Normal, and health; `armor`, the armor points a mob
// wears by its kind, which the bot's swings go through as the bot's own
// armor takes a mob's (26.1.2 Zombie.createAttributes: two, which the husk,
// the drowned, the zombie villager and the zombified piglin keep): a stone
// sword's five comes to 4.9, and a zombie takes five swings of it, not four.
const MOBS = {
  zombie: { hit: 3, health: 20, armor: 2 }, husk: { hit: 3, health: 20, armor: 2 }, drowned: { hit: 3, health: 20, armor: 2 }, zombie_villager: { hit: 3, health: 20, armor: 2 },
  spider: { hit: 2, health: 16 }, cave_spider: { hit: 2, health: 12, poisons: 7, note: 'each bite that lands poisons the bot for seven seconds, renewed by the next: one health every 1.25 seconds that armour does not stop, only while health is above 1' },
  skeleton: { hit: 3, health: 20, shoots: true }, stray: { hit: 3, health: 20, shoots: true, note: 'slows' }, parched: { hit: 3, health: 16, shoots: true }, bogged: { hit: 3, health: 16, shoots: true, poisons: 5, note: 'each arrow that lands poisons the bot for five seconds: one health every 1.25 seconds that armour does not stop, only while health is above 1' },
  pillager: { hit: 4, health: 24, shoots: true }, witch: { hit: 6, health: 26, shoots: true, ignoresArmour: true, every: 3, poisons: 45, note: 'harming potions go through armour; its first at a bot not yet poisoned is poison, forty-five seconds of one health every 1.25 seconds that armour does not stop, only while health is above 1; slowness keeps the bot from getting away' },
  creeper: { hit: 24, health: 20, note: 'the hit is its blast two blocks off, once; fought, it goes off where the bot stands when its fuse ends (creeperFought)' },
  // An enderman, from the 26.1.2 jar (EnderMan): struck by a blade it does
  // not teleport (only a hurt from no living thing does, nine in ten), an
  // arrow or a potion makes it teleport and does nothing to it; angry, it
  // goes 0.15 faster (SPEED_MODIFIER_ATTACKING, CHASE below), and teleports
  // toward a player more than sixteen blocks off. `struck`: the hits a
  // second it lands while it is the one being struck, where the rest land a
  // third (STRUCK): in the bot's three enderman fights with three or more
  // swings (25589 and 25598 on 2026-09-27 and 28, mid-242-ac-nether-3) it
  // landed 14 hits in 20.4 seconds, about 0.7 a second; a swing's knockback
  // is walked back at its speed before its next blow is due.
  enderman: { hit: 7, health: 40, struck: 0.7, note: 'while it is the one being struck it still lands about 0.7 of its hits a second (most mobs a swing knocks back land a third); a sword\'s blow does not make it teleport, an arrow does (and does nothing to it); a shield raised toward it takes its blow; it is 2.9 tall and cannot come into a space under three blocks high, so a two-high pocket or hole keeps it out; angry, it runs at about 8.7 blocks a second, faster than the bot sprints, and teleports toward a player more than sixteen blocks off' }, vindicator: { hit: 13, health: 24 }, slime: { hit: 4, health: 16, splits: [{ size: 'medium', count: 3, hit: 2, health: 4 }] },
  zombified_piglin: { hit: 8, health: 20, armor: 2 }, piglin: { hit: 8, health: 16 }, piglin_brute: { hit: 13, health: 50 },
  // A hoglin or a zoglin, from the 26.1.2 jar (HoglinBase.hurtAndThrowTarget,
  // HoglinAi, Zoglin): a blow is half its six and up to five more, three to
  // eight before armour, five and a half on the average (`least`, `most`);
  // one blow every forty ticks (MeleeAttack.create(40); a baby's is fifteen,
  // for half a point, and throws nothing), where most biters strike every
  // twenty (`blowEvery`); its 0.6 knockback resistance keeps a sword's
  // knockback from putting it back, so being struck does not thin its blows
  // (`struck`, blows a second while it is the one struck). Each blow that
  // lands throws the target on top of the usual knockback (throwTarget:
  // 0.2 to 0.7 of a block a tick back, up to half a block a tick up). In the
  // bot's 37 recorded hoglin blows (flight records to 2026-09-28) the body
  // was carried up to 4.2 blocks back and 2.9 up within a second and a half
  // (1.3 back on the median, walls and ceilings stopping many), and the
  // blows came two seconds apart while it fought (mid-208-k-nether-1:
  // 01:29:28.6, 30.6, 32.8, 34.9, 36.9). Said as a blow a second and six a
  // blow, mid-208-k-nether-1 and nether-4-fortress-1 fought and ate between
  // hoglins told "5 blows end the bot" where a hardest blow is 4.8 through
  // their iron and three did (note 587).
  hoglin: { hit: 5.5, least: 3, most: 8, health: 40, blowEvery: 2, struck: 0.5, toss: 4, note: 'three to eight a blow before armour, one blow every two seconds at arm\'s length whether struck or not (a sword\'s knockback barely moves it), and each blow that lands throws the bot up and back, up to about four blocks back and three up; a baby hits for half a point and throws nothing' },
  zoglin: { hit: 5.5, least: 3, most: 8, health: 40, blowEvery: 2, struck: 0.5, toss: 4, note: 'three to eight a blow before armour, one blow every two seconds at arm\'s length whether struck or not, and each blow that lands throws the bot up and back, up to about four blocks back and three up' },
  wither_skeleton: { hit: 8, health: 20, withers: WITHER.perSecond, note: 'each hit withers the bot for ten seconds, renewed by the next: about one health every two seconds that armour does not stop, and it can take the last' }, blaze: { hit: 5, health: 20, shoots: true, burns: 1, note: 'sets alight: each fireball that lands burns for five seconds more, about one a second through armour, and there is no water in the Nether to put it out' },
  magma_cube: { hit: 6, health: 16, note: 'a big one: it splits into two to four mediums (4 a hit), each of those into two to four smalls (3 a hit)', splits: [{ size: 'medium', count: 3, hit: 4, health: 4 }, { size: 'small', count: 9, hit: 3, health: 1 }] }, silverfish: { hit: 1, health: 8 }, phantom: { hit: 4, health: 20 },
  // Every mob the danger list names (the decision audit, 2026-09-25): one
  // not here added nothing, and a ghast fight read "0 damage".
  // A ghast's fireball is 6 on Normal (LargeFireball.onHitEntity; the
  // fireball damage type scales with difficulty, 9 is Hard's): through iron
  // 3.1, what each of mid-235-p-nether-4-fortress-2's cost (note 551).
  ghast: { hit: 6, health: 10, shoots: true, note: 'fireballs that blast and set alight' }, breeze: { hit: 3, health: 30, shoots: true, note: 'wind charges throw the bot' },
  ravager: { hit: 12, health: 100 }, evoker: { hit: 6, health: 24, note: 'fangs from the ground, and vexes' }, vex: { hit: 9, health: 14, note: 'flies through walls' },
  guardian: { hit: 6, health: 30, shoots: true, note: 'a laser' }, elder_guardian: { hit: 8, health: 80, shoots: true, note: 'a laser, and mining fatigue' },
  warden: { hit: 30, health: 500, note: 'never to be fought' }, creaking: { hit: 3, health: 1, note: 'cannot be hurt while its heart stands' },
  illusioner: { hit: 4, health: 32, shoots: true }, endermite: { hit: 2, health: 8 },
  goat: { hit: 2, health: 10, note: 'rams now and then unprovoked, and throws the bot several blocks' }, polar_bear: { hit: 6, health: 30, note: 'goes for a player near its cubs' },
  // Neutral until struck or hurt by the bot (danger.js provoked), then a
  // pack: mid-218-k (2026-09-27).
  wolf: { hit: 4, health: 8, note: 'the whole pack turns on a player that strikes one' }, bee: { hit: 2, health: 10, poisons: 10, note: 'the hive turns together, and each sting poisons the bot for ten seconds: one health every 1.25 seconds that armour does not stop, only while health is above 1' },
  llama: { hit: 1, health: 22, shoots: true, note: 'spits, and the herd spits together' }, trader_llama: { hit: 1, health: 22, shoots: true, note: 'spits, and the herd spits together' },
  iron_golem: { hit: 15, health: 100, note: 'throws the bot high' }, panda: { hit: 6, health: 20 }, dolphin: { hit: 3, health: 10 },
};
// Damage and swings a second.
const WEAPONS = {
  wooden_sword: [4, 1.6], golden_sword: [4, 1.6], stone_sword: [5, 1.6], copper_sword: [5, 1.6], iron_sword: [6, 1.6], diamond_sword: [7, 1.6], netherite_sword: [8, 1.6],
  wooden_axe: [7, 0.8], golden_axe: [7, 1], stone_axe: [9, 0.8], copper_axe: [9, 0.8], iron_axe: [9, 0.9], diamond_axe: [9, 1], netherite_axe: [10, 1],
  trident: [9, 1.1],
};
// Bare hands recharge in a quarter second, but a mob struck cannot be hurt
// again for half a second: two hits a second land, not four.
const FIST = [1, 2];
// Armour points and toughness per piece.
const ARMOUR = {
  leather_helmet: [1, 0], leather_chestplate: [3, 0], leather_leggings: [2, 0], leather_boots: [1, 0],
  golden_helmet: [2, 0], golden_chestplate: [5, 0], golden_leggings: [3, 0], golden_boots: [1, 0],
  chainmail_helmet: [2, 0], chainmail_chestplate: [5, 0], chainmail_leggings: [4, 0], chainmail_boots: [1, 0],
  iron_helmet: [2, 0], iron_chestplate: [6, 0], iron_leggings: [5, 0], iron_boots: [2, 0], turtle_helmet: [2, 0],
  copper_helmet: [2, 0], copper_chestplate: [4, 0], copper_leggings: [3, 0], copper_boots: [1, 0],
  diamond_helmet: [3, 2], diamond_chestplate: [8, 2], diamond_leggings: [6, 2], diamond_boots: [3, 2],
  netherite_helmet: [3, 3], netherite_chestplate: [8, 3], netherite_leggings: [6, 3], netherite_boots: [3, 3],
};

function armourOf(names) {
  return names.reduce((a, n) => { const [p, t] = ARMOUR[n] || [0, 0]; return { points: a.points + p, toughness: a.toughness + t }; }, { points: 0, toughness: 0 });
}
// The game's armour formula.
function afterArmour(damage, { points, toughness }) {
  const effective = Math.min(20, Math.max(points / 5, points - damage / (2 + toughness / 4)));
  return damage * (1 - effective / 25);
}
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
// A creeper's blast by distance, the game's explosion formula (power 3, so
// six blocks across), on Normal and before armour: 43 at point blank, 24 at
// two blocks, 16 at three, 10 at four. The same encounter was told 11,
// 18.5 and "up to 20" by three options (the decision review, 2026-09-26).
function creeperBlast(distance) {
  const impact = Math.max(0, 1 - distance / 6);
  return impact ? Math.floor((impact * impact + impact) / 2 * 7 * 6 + 1) : 0;
}
// Said the same way wherever a creeper is: by distance, after what is worn.
function creeperBlastSays(worn) {
  return [0, 2, 3, 4].map(d => `${Math.round(afterArmour(creeperBlast(d), worn))} ${d ? `at ${d} blocks` : 'at point blank'}`).join(', ');
}

// The time between the bot's own swings, by the tool's kind (combat.js
// waits this long before striking again; a fist half a second, the time a
// mob struck cannot be hurt again).
const SWING_MS = { sword: 700, axe: 1300, pickaxe: 950, shovel: 1200, trident: 1000, fist: 500 };
const swingMsOf = weapon => SWING_MS[weapon ? weapon.split('_').at(-1) : 'fist'] || SWING_MS.fist;
// The pace the bot's own fights went, measured from the flight records of
// 2026-09-26 to 28 (note 550), where the kill had been priced at the
// weapon's recharge (a sword's 1.6 swings a second, every swing landing):
// - A kill took about 0.9 seconds per swing its health needs after the
//   first (the median of 369 kills, the mob gone a second after its last
//   swing, its death's 20 ticks; 1.12 on the mean, the long ones pulling
//   it), counting the swing's own 0.7 and about 0.2 more: the jump for a
//   critical (four swings in ten), the knockback walked back, and the swings
//   that miss, which the criticals' extra half about makes up.
// - Closing on one out of reach took about 1.6 to 2 seconds a block past
//   three and a half before the first swing (91 fights: 2.4 at four to five
//   blocks, 4.4 at five to six, 4.5 at six to seven, 13 at seven to eight),
//   where a walk is a quarter second a block: the charge's route runs to
//   where the mob stood, not where it comes to meet the bot; mid-235-p-
//   nether-4's wither skeleton came to 0.9 blocks during it and took 20 to
//   6.6 health in three hits before a swing, and fortress-2 the same.
// - The mob landed 0.18 hits a second of that time (49 in 271 s, a quarter
//   of it at reach, 0.69 a second there); and from the first swing to the
//   kill about 0.27 a second (34 in 127 s of fights that ended in a kill),
//   near the third a second reckoned for the one struck (STRUCK).
// The 52 fight stances against one biter that ended in its kill took 243
// seconds from the answer to the kill and 105 health in its blows: priced
// by this, 252 and 106 (at a sword's recharge, as before, 129 and 67). The
// 0.2 and the 1.6 are fitted to those 52 (the swing's 0.2 is also the
// median of the 369 kills); a pace that runs to the mob as it comes, not to
// where it stood, would be seen in the next records as a shorter closing.
const PACE = { extra: 0.2, closeFrom: 3.5, closePerBlock: 1.6, leadBites: 0.18 };
// The seconds from one swing that counts to the next with this weapon.
const swingEvery = weapon => round(swingMsOf(WEAPONS[weapon] ? weapon : null) / 1000 + PACE.extra, 2);
// The seconds before the first swing at a mob this far off.
const leadFor = distance => round(Math.max(0, (distance || 0) - PACE.closeFrom) * PACE.closePerBlock);
// A creeper fought, by the game (26.1.2 SwellGoal and Creeper.tick): its
// fuse lights once a player it targets is within three blocks, about where
// the sword reaches; while lit it stands still, and the fuse burns on while
// that player is within seven blocks and in its sight, whatever strikes it
// (a hit and its knockback do not touch the fuse); beyond seven or out of
// sight it burns back down a tick at a time. Thirty ticks after lighting
// it goes off, and a blast six blocks off or more does nothing. So a fight
// kills it first only when its swings fit in the fuse, the first landing a
// moment after it lights (it lights about where the sword reaches, and the
// look and the step in come first); otherwise it goes off where the bot has
// backed to (the dance backs out to where the blast does nothing, room
// behind allowing). mid-241-a was told "0 damage" for a creeper 4.4 blocks
// off with an iron sword, walked at it, and it went off three blocks off
// with the wall at the bot's back: 4.9 to none; mid-230-v was told the same
// with a diamond sword, whose three swings at 0.7 seconds take 1.4 of the
// fuse's 1.5 with no time to lose, and took two blasts (note 529).
// A creeper already struck (its health, where the caller read it) needs
// fewer. One already lit (litFor, seconds since the bot saw it light) has
// that much less fuse, for the swings and for the backing out, which goes
// at a walk (the back key does not sprint) from where it stands now:
// mid-239-c's creeper came to 3.1 blocks while the fight was asked again
// and again, and went off there, 20 to 5.1 (note 529).
const BLAST_CLEAR = 6, FUSE_KEPT = 7, FIRST_SWING = 0.25, BACK_SPEED = 4.3;
function creeperFought({ weapon = null, worn = { points: 0, toughness: 0 }, room = null, health = MOBS.creeper.health, distance = null, litFor = null } = {}) {
  const [damage] = WEAPONS[weapon] || FIST;
  const swingMs = swingMsOf(WEAPONS[weapon] ? weapon : null);
  const swings = Math.max(1, Math.ceil(health / damage));
  const killSeconds = FIRST_SWING + (swings - 1) * swingMs / 1000;
  const lit = Number.isFinite(litFor), fuseLeft = lit ? Math.max(0, FUSE - litFor) : FUSE;
  const base = { swings, killSeconds: round(killSeconds, 2), swingSeconds: swingMs / 1000, health: round(health), room, ...(lit ? { fuseLeft: round(fuseLeft) } : {}) };
  if (killSeconds < fuseLeft) return { ...base, diesFirst: true };
  const from = Math.min(Number.isFinite(distance) ? distance : LIGHTS_AT, lit ? Infinity : LIGHTS_AT);
  const backs = Math.min(Math.max(0, room ?? Infinity), BACK_SPEED * Math.max(0, fuseLeft - FIRST_SWING));
  const at = Math.min(BLAST_CLEAR, from + backs);
  return { ...base, diesFirst: false, worn, goesOffAt: round(at), hitsBot: round(afterArmour(creeperBlast(at), worn)) };
}
// A block put in a creeper's line from its eyes to the bot's (creeper-
// sight.js): its fuse burns only in sight, so the block in by the time the
// fuse would end stops the blast; not in by then, it goes off where it
// stands, lit, or about where it lights (three blocks), not yet. One not lit
// walks on meanwhile at its own speed (MOB_SPEED, below). `cutSeconds` is the
// placing until the block that cuts the line is in.
function creeperBlocked({ distance, litFor = null, cutSeconds, worn = { points: 0, toughness: 0 } }) {
  const lit = Number.isFinite(litFor);
  const lightsIn = lit ? 0 : Math.max(0, (distance - LIGHTS_AT) / blocksPerSecond('creeper'));
  const goesOffIn = lit ? Math.max(0, FUSE - litFor) : lightsIn + FUSE;
  const at = lit ? distance : Math.min(distance, LIGHTS_AT);
  const inTime = cutSeconds < goesOffIn;
  return { lit, lightsIn: round(lightsIn), goesOffIn: round(goesOffIn), cutSeconds: round(cutSeconds), inTime, margin: round(goesOffIn - cutSeconds),
    ...(inTime ? {} : { goesOffAt: round(at), blast: round(afterArmour(creeperBlast(at), worn)) }) };
}
// The same fight said wherever it is priced.
function creeperFoughtSays(c, { weapon = null, health = 20, distance = null } = {}) {
  const w = weapon && WEAPONS[weapon] ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands';
  const rule = `A creeper's fuse lights once the bot is within ${LIGHTS_AT} blocks, about where a sword reaches, and it goes off ${FUSE} seconds later unless the bot is more than ${FUSE_KEPT} blocks from it or out of its sight by then; a hit does not put the fuse out, and a blast ${BLAST_CLEAR} blocks off or more does nothing.`;
  const who = distance != null ? `the creeper ${Math.round(distance)} blocks off` : 'it';
  const litSays = c.fuseLeft != null ? ` It is lit now, about ${c.fuseLeft} seconds of its fuse left.` : '';
  const kill = `With ${w}, ${who}${c.health < MOBS.creeper.health ? ` (${c.health} health left)` : ''} takes ${c.swings} swing${c.swings === 1 ? '' : 's'}, the first about ${FIRST_SWING} seconds ${c.fuseLeft != null ? 'from now' : 'after it lights'}${c.swings > 1 ? ` and one each ${c.swingSeconds} seconds after` : ''}: about ${c.killSeconds} seconds`;
  if (c.diesFirst) return ` ${rule}${litSays} ${kill}, inside the fuse, so held at reach it dies before it goes off.`;
  const where = c.goesOffAt >= BLAST_CLEAR ? `about ${c.goesOffAt} blocks off, where the blast does nothing${c.room == null ? ' (if there is room behind the bot to back out that far; with a wall at its back, three blocks off, about ' + Math.round(afterArmour(creeperBlast(LIGHTS_AT), c.worn || { points: 0, toughness: 0 })) + ')' : ''}`
    : `about ${c.goesOffAt} blocks off${c.room != null ? (c.room <= 0 ? ' (no room to back out)' : ` (${round(c.room)} block${c.room === 1 ? '' : 's'} of room behind the bot${c.fuseLeft != null ? ', backed at a walk in the fuse left' : ''})`) : ''}: about ${Math.round(c.hitsBot)} after the armour worn${c.hitsBot >= health ? ', more than the bot has' : ''}`;
  return ` ${rule}${litSays} ${kill}, longer than the fuse${c.fuseLeft != null ? ' left' : ''}, so it goes off first, ${where}; counted in the fight's figures.`;
}

// How far a shooter shoots from: one further off walks in first. A witch
// throws from about ten blocks; the bows about fifteen.
// A blaze fires at whatever it targets in sight within its follow range,
// forty-eight blocks (the game's Blaze attributes and its attack goal), its
// aim scattering with the distance. Sixteen was a guess: mid-235-p-fortress-1
// took its last fireball from a blaze 16.5 blocks off, counted by nothing,
// and mid-227-r-nether-3 was hit from thirty-two to thirty-five (notes 491,
// 509).
// A ghast fires from as far as sixty-four blocks: mid-243-q was struck
// twice on a span by one never in the frames (the look reached forty-eight)
// and knocked into the lava sea (note 513).
const RANGE = { witch: 10, ghast: 64, blaze: 48 };
// How often a blaze's fire lands, by distance, from the game's own aim
// (26.1 Blaze$BlazeAttackGoal): each fireball's heading is scattered
// sideways by a triangle of half-width 2.297 x half the square root of the
// distance, three to a volley, a volley about every nine seconds (60 ticks
// charging, 6 between shots, 100 resting). It lands where its line passes
// within 0.6 of the player's middle (half the body's 0.6 width plus the
// projectile's 0.3 margin, ProjectileUtil.computeMargin). The scatter grows
// with the root of the distance, not the distance: about 46 in 100 land
// at 4 blocks, 24 at 16, 14 at 48, and a volley lands one more often than
// not out to about twenty-two blocks. Counted in claims by this, not by the
// forty-eight it fires from: at forty-eight, survival held the turn near a
// fortress on every blaze in sight (notes 509, 513).
// A fireball that lands pushes the bot as any hit does (LivingEntity
// knockback, 0.4, shield raised or not: the push is dealt before the
// block is weighed): about two blocks on open ground by the bot's own
// physics (prismarine-physics), nine ticks in the air; today's frames, 33
// hits with no key pressed, moved a median of one block, a quarter of
// them one and a half or more, up to three (walls and crouching stop the
// rest). A shield raised toward it takes the fireball whole and the fire
// with it: the game puts back the fire a fully blocked fireball set.
const FIREBALL = { scatter: 2.297 * 0.5, within: 0.6, volley: 3, volleySeconds: 178 / 20, knock: 2, melee: 6, meleeReach: 2 };
const fireballHits = new Map();
// The chance one fireball lands at `distance`: the sideways miss is
// a·X + b·Y, X and Y the two triangles and (a, b) the heading's sine and
// cosine, summed over headings and the triangles' grid.
function fireballHit(distance) {
  const d = Math.max(1, Math.round((distance || 0) * 2) / 2);
  if (fireballHits.has(d)) return fireballHits.get(d);
  const w = FIREBALL.scatter * Math.sqrt(d), N = 60, H = 12;
  // Triangle density on [-w, w], sampled at cell midpoints.
  const xs = Array.from({ length: N }, (_, i) => -w + (i + 0.5) * 2 * w / N), pdf = x => (w - Math.abs(x)) / (w * w), cell = 2 * w / N;
  let total = 0;
  for (let h = 0; h < H; h++) {
    const theta = (h + 0.5) * (Math.PI / 4) / H, a = Math.sin(theta), b = Math.cos(theta);
    let p = 0;
    for (const x of xs) for (const y of xs) if (Math.abs(a * x + b * y) < FIREBALL.within) p += pdf(x) * pdf(y) * cell * cell;
    total += p;
  }
  const p = Math.min(1, total / H);
  fireballHits.set(d, p);
  return p;
}
const volleyHit = distance => 1 - (1 - fireballHit(distance)) ** FIREBALL.volley;
// A blaze's fire at the game's own pace (note 602): three fireballs a volley,
// a volley about every nine seconds, each landing by its distance, so a
// landing about every `every` seconds; and the chance the bot is alight at a
// moment from its five seconds a landing. Priced at a shot every two seconds
// and alight whenever one was in sight, a blaze ten off cost 1.35 a second
// and the burning where the game's own numbers give about 0.3 and 0.4: four
// blazes about read as 48 to 62 in fifteen seconds for every stance.
function blazeCadence(distance) {
  const every = FIREBALL.volleySeconds / (FIREBALL.volley * fireballHit(Math.max(FIREBALL.meleeReach, distance || 0)));
  return { every: round(every, 2), burns: round(1 - Math.exp(-FIRE_TICKS.fireball / every), 2) };
}
// What the other shooters land (note 647). Every one of them was priced a shot
// every two seconds, each landing: a skeleton at ten blocks was 0.5 hits a
// second, where the flight records of 2026-09-26 to 28 have a skeleton in
// sight land 0.24 a second within 4 blocks, 0.18 from 4 to 12 and 0.09 from
// 12 to 16 (2,000 skeleton-seconds, 450 hits), and ghasts, priced the same,
// landed 0.05 a second in sight where 0.5 was priced.
// - A bow, from the 26.1.2 jar (AbstractSkeleton.reassessWeaponGoal and
//   RangedBowAttackGoal): the bow is drawn twenty ticks and the goal waits
//   forty more (Normal; twenty on Hard) before the next draw, a shot every
//   three seconds; the arrow's aim is scattered as a triangle of half-width
//   0.0172275 x (14 - 4 x the difficulty's id) = 0.1034 of its direction,
//   and it starts aimed 0.2 of the horizontal distance high and falls
//   (gravity 0.05 a tick, speed 1.6): it lands where it passes within 0.6
//   sideways of the player's middle (the body's half width and the
//   projectile's margin) and inside the body's height less that fall. The
//   game's own figure for a bot standing still is every arrow within 6
//   blocks, 70 in 100 at 10, 55 at 14; the record's, over a bot that also
//   walks, shields and stands behind blocks, about two thirds of that.
// - A crossbow (a pillager's, a piglin's): charged 25 ticks and then a wait
//   of 20 to 40 (CrossbowAttackGoal, the brain's CrossbowAttack), a shot
//   about every 2.75 seconds, scattered as the bow's. A pillager's landings
//   are too few in the record to correct (14 hits); a piglin's bolts landed
//   0.054 a second per piglin in sight within 4 blocks, 0.03 from 4 to 8, and
//   3 in 3,143 seconds from 8 to 12 and none in the 13,000 beyond, priced at
//   a shot every two seconds from as far as fifteen: the record's rates are
//   used, since the game's numbers say nothing of when a piglin attacks.
// - A ghast (Ghast$GhastShootFireballGoal, the same as ghast.js GHAST): a
//   fireball every three seconds while it has a line, flying slowly (from 0.1
//   a block a tick, gaining) at where the bot was when it was thrown, so the
//   longer the flight the more of them miss or are struck back. Landings in
//   the flight records per second of a ghast in sight, by its distance: 5 in
//   35 seconds from 12 to 16 blocks, 15 in 165 from 16 to 24, 23 in 314 from
//   24 to 32, 52 in 929 from 32 to 48, 46 in 1,517 beyond, against the shot
//   every three seconds.
const BOW_EVERY = 3, CROSSBOW_EVERY = 2.75;
const GHAST_SHOT = { every: 3, table: [[16, 5, 35], [24, 15, 165], [32, 23, 314], [48, 52, 929], [Infinity, 46, 1517]] };
const ghastShot = distance => { const [, hits, seconds] = GHAST_SHOT.table.find(([to]) => (distance || 0) < to) || GHAST_SHOT.table.at(-1); return { every: GHAST_SHOT.every, lands: round(Math.min(1, hits / seconds * GHAST_SHOT.every), 2), hits, seconds }; };
const ARROW = { inaccuracy: 6, within: 0.6, fall: 0.0101, high: 0.2, aimAt: 0.6, margin: 0.3, tall: 1.8 };
// The cdf of a triangle on [-w, w] at x.
const triangleCdf = (w, x) => x <= -w ? 0 : x >= w ? 1 : x < 0 ? 0.5 * (1 + x / w) ** 2 : 1 - 0.5 * (1 - x / w) ** 2;
// The chance an arrow or a bolt lands on a player standing still `distance`
// blocks off, from the game's scatter (see above).
function arrowHit(distance) {
  const d = Math.max(1, distance || 0), w = 0.0172275 * ARROW.inaccuracy * d;
  const sideways = w <= ARROW.within ? 1 : triangleCdf(w, ARROW.within) - triangleCdf(w, -ARROW.within);
  // Where the arrow arrives over the target's feet, and the band of heights
  // that hit: the aim's point, the lift of 0.2 a block of distance, less the
  // fall.
  const height = ARROW.aimAt + ARROW.high * d - ARROW.fall * d * d;
  const lo = -ARROW.margin - height, hi = ARROW.tall + ARROW.margin - height;
  const upright = w <= 0.05 ? (lo < 0 && hi > 0 ? 1 : 0) : triangleCdf(w, hi) - triangleCdf(w, lo);
  return Math.max(0, Math.min(1, sideways * upright));
}
// A piglin's bolts, landings a second per piglin in sight (measured).
const piglinBolts = distance => distance < 4 ? 0.054 : distance < 8 ? 0.03 : distance < 12 ? 0.001 : 0.0005;
// { every, lands, basis } for a shooter that is not a blaze, or null.
function shotModel(name, distance) {
  const d = Math.round(distance || 0);
  if (name === 'skeleton' || name === 'stray' || name === 'bogged' || name === 'parched') { const lands = round(arrowHit(distance), 2); return { every: BOW_EVERY, lands, basis: 'game', says: `a shot every ${BOW_EVERY} seconds, ${Math.round(lands * 100)} in 100 landing from ${d} blocks on a bot standing still (the game's scatter; walking and shielding took the record's bot to about two thirds of that)` }; }
  if (name === 'pillager') { const lands = round(arrowHit(distance), 2); return { every: CROSSBOW_EVERY, lands, basis: 'game', says: `a bolt every ${CROSSBOW_EVERY} seconds, ${Math.round(lands * 100)} in 100 landing from ${d} blocks on a bot standing still (the game's scatter)` }; }
  if (name === 'piglin') { const rate = piglinBolts(distance || 0); return { every: CROSSBOW_EVERY, lands: round(Math.min(1, rate * CROSSBOW_EVERY), 3), basis: 'measured', says: rate >= 0.01 ? `its bolts landed about ${rate} a second per piglin in sight at this range (measured: 3 in 3,143 seconds from 8 to 12 blocks, none beyond)` : 'its bolts landed hardly at all from this far off (measured: 3 in 3,143 seconds from 8 to 12 blocks, none in 13,000 beyond)' }; }
  if (name === 'ghast') { const g = ghastShot(distance); return { every: g.every, lands: g.lands, basis: 'measured', says: `a fireball every ${g.every} seconds, ${Math.round(g.lands * 100)} in 100 landing from ${d} blocks (measured: ${g.hits} landings in ${g.seconds} seconds of a ghast in sight at about this range)` }; }
  return null;
}
// Landings a second from one shooter's mob record.
const landsPerSecond = m => (m.lands ?? 1) / (m.every || 2);
// The farthest a blaze's volley lands one more often than not.
const FIRE_LANDS = (() => { let d = 1; while (d < RANGE.blaze && volleyHit(d + 1) >= 0.5) d++; return d; })();
const inHundred = p => Math.round(p * 100);
// Said wherever a blaze's distance matters: the chance by distance, with
// the push.
function fireballSays(distance) {
  const d = Math.round(distance);
  return ` A blaze's fireball lands about ${inHundred(fireballHit(d))} in 100 from ${d} blocks, a volley of three at least one about ${inHundred(volleyHit(d))} in 100 (the game scatters its aim wider with distance: about ${inHundred(fireballHit(4))} in 100 at 4 blocks, ${inHundred(fireballHit(16))} at 16, ${inHundred(fireballHit(48))} at 48; a volley about every ${Math.round(FIREBALL.volleySeconds)} seconds); each that lands pushes the bot about ${FIREBALL.knock} blocks, shield raised or not.`;
}
// How far a shooter is counted a threat by its fire, where RANGE is how
// far it fires from: a blaze by where its volleys land.
const FIRE_REACH = { ...RANGE, blaze: FIRE_LANDS };
// What still lands behind a wall (note 647). A stance that puts blocks or rock
// between the bot and the shooters was priced as if none of their shots came
// after the seconds of building: "Behind it, none of them reaches it". The
// flight records say otherwise for every one of them alike: in the stance
// windows that hold (take_cover, seal, dig_down, pillar, out_of_sight, the
// wall's rail), from the fourth second on the bot took 0.11 of the open rate
// behind cover from a blaze, 0.17 to 0.22 from a skeleton, 0.04 to 0.25 from a
// ghast and 0.2 from a piglin (the open rate being what the model gives for
// that shooter standing in the open, per second), about 0.15 in all: a
// shooter finds a line round the block or the corner, a fireball's blast and
// its fire come round it, the wall is not always where the line is, a stance
// is broken off and begun again. Priced as that share of its open rate for the
// seconds after the setup, where the shooter is taken not to reach the bot.
const COVER_LEAK = 0.15;
const HOLD_SECONDS = 15, APPROACH = 3, FUSE = 1.5, LIGHTS_AT = 3;
// How fast each mob goes after the bot on the ground, from the 26.1 server
// jar: its movement speed attribute (createAttributes), and the move
// control sets both the speed and the input to it (Mob.setSpeed sets zza),
// so a step is the speed squared, the input kept at 0.98 (aiStep), against
// the ground's friction, 0.6 x 0.91 kept each tick. A player sprinting
// (0.13, the input at 0.98) comes out at 5.6 blocks a second, as measured:
// a spider or a hoglin about 3.9, a skeleton or a creeper 2.7, a zombie
// 2.3, a piglin or a vindicator 5.3. Their chase goals go at this speed
// (the modifier 1). A mob gives up a target further off than its follow
// range: sixteen blocks unless set (Mob.createMobAttributes).
const MOB_SPEED = {
  zombie: 0.23, husk: 0.23, drowned: 0.23, zombie_villager: 0.23, zombified_piglin: 0.23,
  spider: 0.3, cave_spider: 0.3, enderman: 0.3, hoglin: 0.3, zoglin: 0.3, warden: 0.3, ravager: 0.3,
  skeleton: 0.25, stray: 0.25, bogged: 0.25, parched: 0.25, wither_skeleton: 0.25, creeper: 0.25, witch: 0.25, silverfish: 0.25, endermite: 0.25,
  pillager: 0.35, vindicator: 0.35, piglin: 0.35, piglin_brute: 0.35, illusioner: 0.5, evoker: 0.5, creaking: 0.4,
  blaze: 0.23, breeze: 0.63, magma_cube: 0.2, slime: 0.2,
};
// How tall each mob stands, from the 26.1.2 server jar (EntityType, sized).
// A mob's blow reaches as high as it stands and no higher: its melee range
// is its own box widened about 0.83 to the sides (the square root of 2.04,
// less 0.6) and not at all upward (Mob.isWithinMeleeAttackRange,
// getAttackBoundingBox), against the player's box (1.8 tall).
const BODY_HEIGHT = { zombie: 1.95, husk: 1.95, drowned: 1.95, zombie_villager: 1.95, zombified_piglin: 1.95, piglin: 1.95, piglin_brute: 1.95, vindicator: 1.95, pillager: 1.95, witch: 1.95, evoker: 1.95, illusioner: 1.95,
  skeleton: 1.99, stray: 1.99, bogged: 1.99, parched: 1.99, wither_skeleton: 2.4, creeper: 1.7, hoglin: 1.4, zoglin: 1.4, spider: 0.9, cave_spider: 0.5, enderman: 2.9, ravager: 2.2, iron_golem: 2.7, warden: 2.9, creaking: 2.7,
  silverfish: 0.3, endermite: 0.3, blaze: 1.8, breeze: 1.77 };
const bodyHeight = name => BODY_HEIGHT[name] ?? 1.95;
const FOLLOW_RANGE = { zombie: 35, husk: 35, drowned: 35, zombie_villager: 35, zombified_piglin: 35, enderman: 64, blaze: 48, pillager: 32, ravager: 32, creaking: 32, warden: 24, breeze: 24, vindicator: 12, piglin_brute: 12, evoker: 12, illusioner: 18 };
// How a mob gives a player up where its brain says more than the follow
// range, read from the 26.1.2 jar. A piglin brute (PiglinBruteAi) goes after
// the nearest player it sees within its follow range (12, createAttributes),
// or one it is angry at (struck by it: ANGRY_AT, 600 ticks) within that
// range seen or not, and drops it otherwise (StopAttackingIfTargetInvalid);
// idle, it walks back to its HOME, the spot it was made at (initMemories),
// from within a hundred blocks (StrollToPoi). No biome spawns one: it comes
// only with a bastion's pieces. mid-242-ae-nether-1 was never told how one
// gives up, and the way off its bastion was never offered (note 576).
const GIVES_UP = {
  piglin_brute: 'a piglin brute keeps after a player only while that player is within 12 blocks of it and in its sight (seen or not for 30 seconds once the bot has struck it), then walks back to the spot in its bastion it was made at; brutes come only with a bastion and are found nowhere else',
};
const SPRINT_SPEED = 0.13;
const groundSpeed = s => s * s * 0.98 * 20 / (1 - 0.6 * 0.91);
// A chase goal's own modifier where it is not 1: a skeleton kind with a
// blade in hand goes after its target at 1.2 times its speed
// (AbstractSkeleton's meleeGoal, new MeleeAttackGoal(this, 1.2, false)), so
// a wither skeleton comes on at a spider's 3.9 blocks a second, not 2.7.
// Said at 2.7, mid-235-p-nether-4-fortress-2's runs were told the skeleton
// would be 12 to 15 blocks behind at their end and it was 8.6 to 9.2 (note
// 550); mid-242-ac-nether-1-fortress-1 ran from one three times, told it
// would be about 10 behind, and it was at the bot again each time (note 559).
// An angry enderman goes 0.15 faster than its 0.3 (EnderMan.setTarget adds
// SPEED_MODIFIER_ATTACKING): about 8.7 blocks a second. mid-242-ac-nether-3's
// came 2.2 blocks in a quarter second, 8.8 (note 578).
const CHASE = { wither_skeleton: 1.2, enderman: 1.5 };
const blocksPerSecond = name => groundSpeed((MOB_SPEED[name] ?? 0.25) * (CHASE[name] ?? 1));
const followRange = name => FOLLOW_RANGE[name] ?? 16;
// The bot's own run, the same way: the input 0.98 at the sprint's speed.
const PLAYER_SPRINT = SPRINT_SPEED * 0.98 * 20 / (1 - 0.6 * 0.91);
const inRange = m => Math.max(0, ((m.distance || 0) - (RANGE[m.name] || 15)) / APPROACH);
// A shot every two seconds (a witch's potion every three). A shield takes
// about half of the arrows (raised between swings and against each shot
// seen coming); a witch's thrown potion is not stopped by it.
// A shooter that sets alight burns as it hits: a small fireball sets a
// player on fire for five seconds, about one a second that armour does not
// stop, renewed by each that lands (a blaze's fire is steady while it
// shoots). mid-235-p-fortress-2 went from 14.7 to none in twenty seconds
// against blazes priced at their fireball alone (note 512).
const shooting = (m, shield) => m.visible ? (m.hitsBot * landsPerSecond(m) + (m.burns || 0)) * (shield && m.name !== 'witch' ? 0.5 : 1) : 0;
// A shooter's fire as timeline pieces: its shots, each a hit, and the burn
// they leave, which is not.
const shotPieces = (m, shield, from, to) => {
  if (!m.visible || !(to > from)) return [];
  const f = shield && m.name !== 'witch' ? 0.5 : 1;
  return [{ from, to, perSecond: m.hitsBot * landsPerSecond(m) * f, hit: m.hitsBot }, ...(m.burns ? burnRamp(f * landsPerSecond(m), from, to) : [])];
};
// A body that has just been hurt cannot be hurt again for half a second
// (26.1 LivingEntity.hurtServer: within ten ticks of a hit, a blow no
// bigger than the last one does nothing, a bigger one only its excess), so
// however many bite, at most two full hits a second land: mid-241-aa's two
// zombies in its cell struck it every half second, never faster (note 535;
// note 526 left it open). Summed hit by hit, eight zombies round the bot
// were priced at eight hits a second. The wither and a burn are not hits.
const HURT_PER_SECOND = 2;
// One blow at `at`, as a piece: its whole hit over the half second after it
// that a hurt body cannot be hurt again, so two landing together count as
// the bigger (within), and one landing before a stretch ends counts whole.
const blowAt = (at, hit) => ({ from: at, to: at + 1 / HURT_PER_SECOND, perSecond: hit * HURT_PER_SECOND, hit, blow: true });

// A biter with no line to the bot (`unseen`, within the eight a biter is
// counted from) was priced as at the bot as any other: it comes as its own
// speed brings it. The game gives it no target to come at: a mob takes a
// player as its target only in sight (NearestAttackableTargetGoal, mustSee)
// and drops it after sixty ticks out of it (TargetGoal, unseenMemoryTicks),
// so one round a rock reaches the bot only by wandering into sight first. In
// the flight records' 272 stance windows with only out-of-sight biters about
// the price was 3.06 and the damage taken 0.73 (a fight 6.8 against 0.39); a
// quarter landed. Its blows are counted at that chance, and said so; a biter
// out of sight that can be there before a build or a dig is done (`far`) is
// not weighed here, it is said as counted (note 581).
const UNSEEN = { arrives: 0.25 };
const arrival = m => m.unseen && !m.far && !m.remembered ? UNSEEN.arrives : 1;

// A slime or magma cube of a given size (26.1.2 Slime.setSize and
// MagmaCube.getAttackDamage): health is the size squared and the hit the size
// (a magma cube's two more), Normal, so 1, 4 and 16 health and 3, 4 and 6 for
// a magma cube of size 1, 2 and 4; killed, one of size 2 or more is two to
// four of half its size (three reckoned). Every one was priced as the big
// one and its whole family: the magma cubes of the fortress are sizes 1, 2
// and 4 in equal parts (Slime.finalizeSpawn, 1 << nextInt(3)), and the
// flight records' fights with them were priced 9.6 to 16.7 and took 0.3 to
// 0.9 (note 647). The size is the entity's own (`size`, the caller reads
// metadata 16 with slimeSize); with none given the big one is priced, the most
// it can be.
const SLIMES = { magma_cube: { plus: 2 }, slime: { plus: 0 } };
const slimeHit = (name, size) => size + SLIMES[name].plus;
const SIZE_WORDS = { 1: 'small', 2: 'medium', 4: 'big' };
function slimeOf(t) {
  if (!SLIMES[t.name] || !(t.size >= 1) || t.split) return null;
  const size = Math.round(t.size);
  return { ...MOBS[t.name], hit: slimeHit(t.name, size), health: size * size, note: `a ${SIZE_WORDS[size] || `size ${size}`} one: ${size * size} health, a hit of ${slimeHit(t.name, size)} before armour${size > 1 ? `, and it splits into about three of size ${size / 2} where it dies` : ''}` };
}
function slimeSplits(t) {
  if (!SLIMES[t.name] || !(t.size >= 1)) return null;
  const out = [];
  for (let size = Math.round(t.size) / 2, count = 3; size >= 1; size /= 2, count *= 3) out.push({ size: SIZE_WORDS[size] || `size ${size}`, count, hit: slimeHit(t.name, size), health: size * size });
  return out;
}
// The size of a slime or a magma cube from its entity (metadata 16), or
// undefined where it is not one or the size is not known.
const slimeSize = entity => SLIMES[entity?.name] && Number.isFinite(Number(entity.metadata?.[16])) && Number(entity.metadata[16]) >= 1 ? Number(entity.metadata[16]) : undefined;

// The fight where the bot stands, as a timeline: nearest first; every mob
// still standing hits meanwhile, biters once a second at arm's length,
// shooters every two seconds in sight once within their range, the one
// being struck a third as often. At most `atOnce` biters are at arm's
// length together (the open cells round the bot: two in a tunnel, eight in
// the open); the rest wait their turn. [{ from, to, perSecond }] pieces.
// A wither skeleton that bites withers the bot from then until ten seconds
// after it dies, steady while it hits (WITHER).
// A poisoner poisons the bot from its first bite (three quarters of a
// second on, the first tick) until its poison's length after it dies, one
// poison however many bite, with the poison already on the bot
// (`poisonedFor`, its seconds left). The first bite is taken to land as it
// comes, the struck third or not: each of mid-243-f's three fights with a
// cave spider took a bite within a second of its start (note 542).
// The fire already on the bot (`burningFor`, its seconds left) burns on
// from the start, one fire with any the shooters light.
// `lead`: the seconds before the first swing at the first in order, a biter
// out of reach closed on (fightEstimate), in place of that mob's first
// swing's interval; it lands PACE.leadBites of its hits a second meanwhile
// (note 550).
function fightTimeline(order, { shield = false, atOnce = Infinity, poisonedFor = 0, burningFor = 0, lead = null } = {}) {
  const pieces = [], killed = new Map(), withering = new Map(), poisoning = new Map();
  let t = 0;
  order.forEach((m0, i) => {
    const led = i === 0 && lead != null && m0.secondsASwing > 0 ? lead : null;
    const end = t + (led != null ? led + m0.secondsToKill - m0.secondsASwing : m0.secondsToKill);
    let biters = 0;
    order.slice(i).forEach((m, j) => {
      if (m.name === 'creeper') return;
      // One from a split is not there until the one it came from is dead.
      if (m.bornOf && !killed.has(m.bornOf)) return;
      // The one being struck hits back a third as often if it bites; a
      // shooter being closed on shoots as ever. A spear holder jabs as
      // ever too: a swing's knockback leaves it within its reach, and it
      // reaches past the ones at arm's length (mid-244-z, note 497).
      // One in the bot's own cells is not knocked out of reach by the swing
      // that strikes it: mid-241-aa's two zombies in its cell each bit about
      // once a second while it was struck, where a third as often was
      // reckoned for the one fought (note 535).
      const from = Math.max(t, m.shoots ? inRange(m) : 0);
      if (m.shoots) {
        pieces.push(...shotPieces(m, shield && !m.unshielded, from, end));
        if (m.poisons && m.visible && end > from && !poisoning.has(m)) poisoning.set(m, from);
        return;
      }
      // A hoglin strikes every two seconds, struck or not (MOBS blowEvery,
      // struck; note 587).
      let perSecond;
      const rate = 1 / (MOBS[m.name]?.blowEvery || 1);
      if (m.jab) perSecond = m.jab;
      else if (++biters > atOnce) return;
      else perSecond = (j === 0 && !m.inCell ? MOBS[m.name]?.struck ?? STRUCK * rate : rate) * m.hitsBot;
      // One out of sight is there at the chance the record gives it (UNSEEN).
      const w = arrival(m);
      perSecond *= w;
      // Closed on first: its hits as they came while the bot got to it.
      const closing = j === 0 && led > 0 && !m.jab && !m.inCell ? Math.min(led, end - from) : 0;
      if (closing > 0) pieces.push({ from, to: from + closing, perSecond: PACE.leadBites * m.hitsBot * w, hit: m.hitsBot * w });
      if (perSecond > 0 && end > from + closing) pieces.push({ from: from + closing, to: end, perSecond, hit: (m.jab ?? m.hitsBot) * w });
      if (m.withers && !m.shoots && !withering.has(m)) withering.set(m, from);
      if (m.poisons && perSecond > 0 && end > from && !poisoning.has(m)) poisoning.set(m, from);
    });
    killed.set(m0, end);
    t = end;
  });
  if (burningFor > 0) pieces.push(...bodyBurn(burningFor));
  pieces.push(...effectPieces([...withering].map(([m, from]) => [from, killed.get(m) + WITHER.seconds])));
  pieces.push(...effectPieces([...[...poisoning].map(([m, from]) => [from + POISON.first, killed.get(m) + m.poisons]), [0, poisonedFor || 0]], 'poison'));
  return pieces;
}
// The damage a timeline deals in its first `seconds` (all of it without):
// the pieces that are hits (`hit`, the size of one) at most two of the
// biggest landing a second between them (HURT_PER_SECOND), the rest as they
// come.
// The fire (effect 'burn') is one fire however many light it: at each
// moment the strongest of its pieces, not their sum (four blazes in sight
// were four health a second of burning, where the game burns one).
function within(pieces, seconds = Infinity) {
  // A blow that lands inside the stretch counts whole (blowAt).
  const end = p => p.blow ? (p.from < seconds ? p.to : p.from) : Math.min(p.to, seconds);
  const hits = pieces.filter(p => p.hit > 0 && end(p) > p.from);
  let total = pieces.filter(p => !(p.hit > 0) && p.effect !== 'burn').reduce((n, p) => n + p.perSecond * Math.max(0, end(p) - p.from), 0);
  const burns = pieces.filter(p => p.effect === 'burn' && end(p) > p.from);
  const burnCuts = [...new Set(burns.flatMap(p => [p.from, end(p)]))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < burnCuts.length; i++) {
    const on = burns.filter(p => p.from <= burnCuts[i] && end(p) >= burnCuts[i + 1]);
    // One fire however many light it: alight at a moment unless none of
    // them has (each piece's rate is the chance it keeps the bot alight).
    if (on.length && Number.isFinite(burnCuts[i + 1] - burnCuts[i])) total += (1 - on.reduce((q, p) => q * (1 - Math.min(1, p.perSecond)), 1)) * (burnCuts[i + 1] - burnCuts[i]);
  }
  const cuts = [...new Set(hits.flatMap(p => [p.from, end(p)]))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const on = hits.filter(p => p.from <= a && end(p) >= b);
    if (!on.length || !Number.isFinite(b - a)) continue;
    total += Math.min(on.reduce((n, p) => n + p.perSecond, 0), HURT_PER_SECOND * Math.max(...on.map(p => p.hit))) * (b - a);
  }
  return total;
}

// The poison in a fight's figures, said with them: who poisons, its rate,
// how much of the figure it is, and that it stops at 1.
function poisonFightSays(order, poison, { health = 20, poisonedFor = 0 } = {}) {
  if (!(poison > 0)) return '';
  const kinds = [...new Set(order.filter(m => m.poisons).map(m => m.name))];
  const who = kinds.length ? `each ${kinds.map(k => ({ cave_spider: 'cave spider bite', bee: 'bee sting', bogged: 'bogged arrow', witch: 'witch potion' }[k] || k.replaceAll('_', ' '))).join(' or ')} that lands poisons the bot (${kinds.map(k => `${k.replaceAll('_', ' ')} ${MOBS[k].poisons} seconds`).join(', ')}, renewed by the next)` : '';
  const running = poisonedFor > 0 ? `the poison on the bot now has about ${round(poisonedFor)} seconds left` : '';
  const capped = Math.min(poison, Math.max(0, health - POISON.floor));
  return `About ${round(capped)} of it is poison: ${[running, who].filter(Boolean).join(', and ')}; one health every 1.25 seconds that armour does not stop, however many poison it, and only while health is above 1, so the poison alone leaves the bot at 1 or just under, never dead: the next bite or hit then kills.`;
}
// The fire on the bot, said where it is priced.
function burnSays(seconds) {
  const s = Math.max(1, Math.round(seconds));
  const ticks = bodyBurn(seconds).length;
  return `The bot is alight: about ${s} second${s === 1 ? '' : 's'} of fire left, ${BURN_PER_SECOND} health a second that armour does not stop, the last a second before it ends: ${ticks} more health from it, whatever is chosen, and each fireball that lands sets it back to ${FIRE_SECONDS.fireball}; counted in the figures. Only water or time puts it out, and the Nether has no water.`;
}
// threats: [{ name, distance, shoots, visible }]; armour: piece names worn;
// weapon: the item name or null; atOnce: how many biters can be at arm's
// length together where the bot stands.
const SPEAR_HIT = 13;
// Its jab, the hit it fights with, measured: the game data has the spears
// but not their reach or damage. mid-244-z's zombie (an iron spear) jabbed
// eight times in twelve seconds through full iron, 1.9 to 3.1 a hit (four
// to six before armour by the formula above; five trials' forty-odd jabs
// through iron are mostly four or five), from 2.5 to 3 blocks centre to
// centre where a sword reaches three from the eye, about once a second (the
// half second a body struck cannot be hurt again at the quickest). Each
// knocked the bot about a block back and the zombie followed to its reach:
// it does not back off, the bot is put back (note 497).
const SPEAR = { jab: 5, reach: 3, knock: 1 };
// What a spear holder's hits were seen to be, by kind, where the zombies'
// thirteen and five above are not it: a piglin's golden spear, seven hits
// in three deaths (mid-242-ae, mid-242-ac-nether-3-fortress-2, mid-242-af-
// nether-1), 5.7 to 6.7 each through eight armour points, eight before
// it: the piglin's own blow, a golden spear adding nothing to it (26.1.2
// Item.Properties.spear: the material's damage bonus, gold's none). Priced
// at thirteen, every stance told Jev two blows would end the bot from
// 17.8, where three did (note 586).
const SPEAR_SEEN = { piglin: 8 };
// How a spear holder fights, from the 26.1.2 jar (PiglinAi's fight:
// SpearApproach to within ten blocks, SpearAttack, SpearRetreat): it runs
// in with the spear raised from as far as ten blocks until within two,
// landing its hit on the way in, then walks to a spot six or seven blocks
// off and comes again. Its reach is 2.25 past its own body sideways and
// none up or down (AttackRange 2 to 4.5, half in a mob's hand): about 2.8
// blocks straight ahead and 4 on the diagonal. Spear damage is not among
// what gets past a shield (damage_type tag bypasses_shield), and a spear
// does not disable one (Weapon, no blocking cooldown): a shield raised
// facing it, a quarter second before, takes the hit.
const SPEAR_WAYS = 'it runs in with the spear raised from as far as ten blocks and strikes on the way in, from about 2.8 blocks straight ahead and 4 on the diagonal, then backs off six or seven blocks and comes again; a shield raised facing it a quarter second before takes the hit, which a spear does not get past';
// The pace in words, said with the fight's figures: the swings each kind
// takes, how often one that counts came in the bot's own fights, and the
// closing first. mid-235-p-nether-4 was told "about 2.5 seconds" for a
// wither skeleton seven blocks off, four swings at a sword's recharge; it
// took three hits before the first swing and was dead in six (note 550).
function paceSays(order, { weapon = null, lead = null } = {}) {
  const biters = order.filter(m => m.secondsASwing > 0);
  if (!biters.length) return '';
  const w = WEAPONS[weapon] ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands';
  const [damage, rate] = WEAPONS[weapon] || FIST;
  const kinds = [...new Set(biters.map(m => m.name))].slice(0, 3).map(name => {
    const m = biters.find(x => x.name === name), n = biters.filter(x => x.name === name).length;
    const health = m.health ?? MOBS[name]?.health;
    return `${n > 1 ? `each of the ${n} ${name.replaceAll('_', ' ')}s` : `the ${name.replaceAll('_', ' ')}`} ${m.swingsToKill} (${health} health, ${m.eachSwing ?? damage} a swing${m.eachSwing ? ' through its armor' : ''}${m.spear ? ', twice the time for the jabs that put the bot back' : ''})`;
  });
  const swings = biters.reduce((n, m) => n + m.swingsToKill, 0);
  const every = biters[0].secondsASwing / (biters[0].spear ? 2 : 1);
  const closing = lead > 0 ? ` Closing on the ${order[0].name.replaceAll('_', ' ')} ${Math.round(order[0].distance)} blocks off came first: about ${lead} seconds before the first swing in those fights (about 1.6 a block past three and a half, the run going where the mob stood while it came on), the mob landing about one hit in each five or six seconds of it on the average; one that walks straight in is at reach in about ${round(Math.max(0, order[0].distance - 1.5) / blocksPerSecond(order[0].name))} seconds at its own speed, and at reach before the first swing they landed about 0.7 hits a second.` : '';
  return `With ${w}, about ${swings} swing${swings === 1 ? '' : 's'} that land: ${kinds.join(', ')}. In the bot's own fights so far one came about every ${every} seconds, not the ${round(1 / rate, 2)} of the weapon's recharge: the jump for a critical, the knockback walked back and the misses.${closing}`;
}
// `poisonedFor`: the seconds of poison already on the bot (effectLeft).
// `burningFor`: the seconds of fire on the bot now (burnLeft).
function fightEstimate({ threats, armour = [], weapon = null, health = 20, shield = false, atOnce = Infinity, poisonedFor = 0, burningFor = 0 }) {
  const worn = armourOf(armour);
  const [damage, rate] = WEAPONS[weapon] || FIST;
  const unknown = [];
  let mobs;
  // A big slime or magma cube killed is two to four smaller ones where it
  // stood, and a medium magma cube's are smaller again (three of each
  // reckoned): mid-211-s was told a big magma cube cost 2.2 damage, about
  // one hit, fought it on a ledge, and the second hit put it into the lava
  // (note 472). Every one of them is swung at and hits back.
  // Each comes only when the one it came from dies (bornOf, below).
  threats = threats.flatMap(t => {
    const out = [t];
    let parents = [t];
    for (const s of slimeSplits(t) || MOBS[t.name]?.splits || []) {
      const per = Math.round(s.count / parents.length);
      parents = parents.flatMap(p => Array.from({ length: per }, () => ({ ...t, distance: (t.distance || 0) + 0.5, split: s, from: p })));
      out.push(...parents);
    }
    return out;
  });
  mobs = threats.map(t => {
    const base = t.split ? { hit: t.split.hit, health: t.split.health, note: `a ${t.split.size} one, from a split` } : slimeOf(t) || MOBS[t.name];
    if (!base) { unknown.push(t.name); return null; }
    // A spear in a mob's hand (26.1): its charged thrust is the hit. One
    // took mid-87-m from twenty to 11.4 through full iron, a zombie
    // villager's, where three a hit was reckoned (2026-09-26): about
    // thirteen before armour.
    const spear = /_spear$/.test(t.held || '');
    const seen = spear ? SPEAR_SEEN[t.name] : undefined;
    const m = spear ? { ...base, hit: seen ?? Math.max(base.hit, SPEAR_HIT), note: seen ? `a spear: each hit seen was about ${seen} before armour, about once a second, from about ${SPEAR.reach} blocks, each knocking the bot back (seen: 0.7 of a block, and one over a three-block edge into lava); ${SPEAR_WAYS}` : `a spear: it jabs for about ${SPEAR.jab} before armour about once a second from about ${SPEAR.reach} blocks, each jab knocking the bot about a block back, and its charged thrust hits for about thirteen; ${SPEAR_WAYS}` } : base;
    const dealt = afterArmour(damage, { points: t.split ? 0 : m.armor || 0, toughness: 0 });
    const hitsToKill = Math.ceil(m.health / dealt);
    const shoots = !!(m.shoots || t.shoots);
    // A shooter backs off after each hit and is closed on again: twice the
    // swinging time, and the walk to it first. Trial 44 was told a skeleton
    // took 2.5 seconds and 1.3 damage; it took fourteen health in six
    // seconds without falling, and Jev, told otherwise, fought on at two.
    // A spear holder puts the bot back instead, a block a jab, and the bot
    // closes again: the same twice. mid-244-z was told 2.5 seconds and 7.2
    // damage, and was jabbed from 15.4 to 2.7 in six (note 497).
    // A creeper is killed inside its fuse or goes off (creeperFought): the
    // fight with it lasts the swings or the fuse.
    const fought = t.name === 'creeper' && !t.split ? creeperFought({ weapon, worn, room: t.backRoom ?? null, distance: t.distance, litFor: t.litFor ?? null, ...(Number.isFinite(t.health) ? { health: t.health } : {}) }) : null;
    // A biter at the pace the bot's fights went (PACE, note 550): a swing
    // that counts each `every` seconds, the first one interval in (the look,
    // the weapon to hand and its recharge, or the turn from the one before).
    // A shooter keeps its twice the recharge: the recorded skeleton kills
    // took about 2.9 seconds from the first swing and four in all, near it.
    const every = swingEvery(weapon);
    const seconds = fought ? (fought.fuseLeft != null ? (fought.diesFirst ? fought.killSeconds : fought.fuseLeft) : (fought.diesFirst ? fought.killSeconds : FUSE) + Math.max(0, (t.distance || 0) - LIGHTS_AT) / WALK) : shoots ? hitsToKill / rate * 2 + Math.max(0, (t.distance || 0) - 3) / WALK : hitsToKill * every * (spear ? 2 : 1);
    return Object.defineProperty({ name: t.name, distance: t.distance, shoots, visible: t.visible !== false, ...(t.apart ? { apart: true } : {}), ...(t.quiet ? { quiet: t.quiet } : {}), ...(t.inCell ? { inCell: true } : {}),
      ...(!fought && !shoots ? { secondsASwing: round(every * (spear ? 2 : 1), 2) } : {}), ...(m.armor && !t.split ? { armor: m.armor, eachSwing: round(dealt) } : {}),
      ...(fought ? { fought: { swings: fought.swings, secondsToKillIt: fought.killSeconds, ...(fought.health < MOBS.creeper.health ? { healthLeft: fought.health } : {}), ...(fought.fuseLeft != null ? { litNowFuseLeft: fought.fuseLeft } : {}), ...(fought.diesFirst ? { diesBeforeItGoesOff: true } : { goesOffAt: fought.goesOffAt, blast: fought.hitsBot }), ...(fought.room != null ? { roomBehind: round(fought.room) } : {}) } } : {}),
      // A drowned's thrown trident is eight, where its hand is three.
      hitsBot: round(m.ignoresArmour ? m.hit : afterArmour(t.name === 'drowned' && shoots ? 8 : m.hit, worn)),
      // A blow that varies (a hoglin's three to eight): its least and its
      // hardest through the armour worn, and how often it comes (note 587).
      ...(m.most && !spear ? { hitsBotLeast: round(afterArmour(m.least, worn)), hitsBotMost: round(afterArmour(m.most, worn)) } : {}), ...(m.blowEvery && !spear ? { blowEvery: m.blowEvery } : {}),
      swingsToKill: hitsToKill, secondsToKill: round(seconds), ...(spear ? { spear: true, jab: round(afterArmour(seen ?? SPEAR.jab, worn)), reach: SPEAR.reach, knock: SPEAR.knock } : {}), ...(t.name === 'blaze' && !t.split ? blazeCadence(t.distance) : shoots && !t.split && shotModel(t.name, t.distance) ? (({ every, lands, says }) => ({ every, lands, shots: says }))(shotModel(t.name, t.distance)) : { ...(m.every ? { every: m.every } : {}), ...(m.burns ? { burns: m.burns } : {}) }), ...(m.withers ? { withers: m.withers } : {}), ...(m.poisons ? { poisons: m.poisons } : {}), ...(t.unseen ? { unseen: true } : {}), ...(m.note ? { note: m.note } : {}) }, 'health', { value: m.health });
  });
  // The mob each split one comes from, kept off the record (not enumerable).
  mobs.forEach((m, i) => { if (m && threats[i].from) Object.defineProperty(m, 'bornOf', { value: mobs[threats.indexOf(threats[i].from)] }); });
  // And the entity each stands for, off the record too, where the caller
  // gave its id: a stance's cost asks where that one mob can get to.
  mobs.forEach((m, i) => { if (m && !threats[i].from && threats[i].id != null) Object.defineProperty(m, 'id', { value: threats[i].id }); });
  mobs = mobs.filter(Boolean);
  // The poison already on the bot, off the record on each mob: every
  // stance priced from these mobs counts it (stanceCost).
  if (poisonedFor > 0) mobs.forEach(m => Object.defineProperty(m, 'poisonedFor', { value: poisonedFor }));
  // So is the fire on the bot now.
  if (burningFor > 0) mobs.forEach(m => Object.defineProperty(m, 'burningFor', { value: burningFor }));
  // One with no way to the bot (walk-reach.js) is not fought, and does not
  // hit (mid-205-v, note 525).
  // One that has held off for minutes (held-off.js, note 599) is fought
  // here all the same: the fight goes at it, and a mob gone at fights back.
  const order = mobs.filter(m => !m.apart).sort((a, b) => a.distance - b.distance);
  // The cells round the bot bound how many can come at it, but not the
  // ones already there: in a tunnel or a shaft the open cells counted none,
  // with three zombies at arm's length, and the fight was told it cost
  // nothing; mid-235-f took it at 0.91 from 5.9 health and was killed
  // (2026-09-27).
  atOnce = Math.max(atOnce, order.filter(m => !m.shoots && m.name !== 'creeper' && m.distance <= 3).length);
  // The first, a biter out of reach, is closed on before its first swing
  // (PACE): that lead in place of its first swing's interval.
  const first = order[0];
  const lead = first?.secondsASwing > 0 ? (first.inCell ? 0 : leadFor(first.distance)) : null;
  const timeline = fightTimeline(order, { shield, atOnce, poisonedFor, burningFor, lead });
  const spans = order.map((m, i) => i === 0 && lead != null ? lead + m.secondsToKill - m.secondsASwing : m.secondsToKill);
  const seconds = spans.reduce((n, s) => n + s, 0);
  // Each creeper fought that is not killed inside its fuse goes off once,
  // when its turn in the fight comes and the fuse has run.
  const blasts = [];
  order.reduce((t, m, i) => { if (m.fought?.blast > 0) blasts.push({ at: t + spans[i], damage: m.fought.blast }); return t + spans[i]; }, 0);
  const blastsWithin = s => blasts.filter(b => b.at <= s).reduce((n, b) => n + b.damage, 0);
  // The poison takes nothing below 1: counted to 1 at most, the bites and
  // blasts beside it as they come.
  const poisonPart = s => within(timeline.filter(p => p.effect === 'poison'), s);
  const taken = poisonFloored(within(timeline) + blastsWithin(Infinity), poisonPart(Infinity), health);
  const poisonSays = poisonFightSays(order, poisonPart(Infinity), { health, poisonedFor });
  const pace = paceSays(order, { weapon, lead });
  const creepers = order.filter(m => m.name === 'creeper');
  const nearestCreeper = creepers[0];
  const nearestThreat = nearestCreeper && threats.find(t => t.name === 'creeper' && !t.from && t.distance === nearestCreeper.distance);
  const creeperSays = nearestCreeper && creeperFoughtSays(creeperFought({ weapon, worn, room: nearestThreat?.backRoom ?? null, distance: nearestCreeper.distance, litFor: nearestThreat?.litFor ?? null, ...(Number.isFinite(nearestThreat?.health) ? { health: nearestThreat.health } : {}) }), { weapon, health, distance: nearestCreeper.distance }).trim();
  return {
    armourPoints: worn.points, weapon: weapon || 'bare hands',
    mobs,
    fightHere: { seconds: round(seconds), damageTaken: round(taken), healthNow: round(health), healthAfter: round(health - taken),
      // The same stretch every stance is priced over (stanceCost below).
      inFifteenSeconds: round(poisonFloored(within(timeline, HOLD_SECONDS) + blastsWithin(HOLD_SECONDS), poisonPart(HOLD_SECONDS), health)),
      ...(poisonSays ? { poison: poisonSays } : {}),
      ...(burningFor > 0 ? { fire: burnSays(burningFor) } : {}),
      ...(pace ? { pace } : {}), ...(lead > 0 ? { closingFirst: lead } : {}),
      ...(Number.isFinite(atOnce) ? { atArmsLengthAtOnce: atOnce } : {}),
      ...(creepers.length ? { creeper: `counted: ${creeperSays} A blast by distance after the armour worn: ${creeperBlastSays(worn)}.` } : {}),
      ...(unknown.length ? { notCounted: `no figures for ${[...new Set(unknown)].join(', ')}` } : {}),
      ...(mobs.some(m => m.apart) ? { leftOut: `${mobs.filter(m => m.apart).length} with no way to the bot` } : {}) },
  };
}

// What the mobs about cost the bot over a stance, worked out the same way
// for every stance so they can be set side by side. The crowd deaths of
// 2026-09-26 (mid-83-d, mid-92-e, mid-110-k) were each told the fight's
// cost ("more than the bot has") and nothing of the pillar's, the pocket's
// or the run's, and Jev took the stances that carried no figure: a pillar
// under three skeletons and a creeper, a pocket of thirty blocks with a
// zombie at arm's length.
//
// Over the fifteen seconds a stance is held: `setup` seconds of building or
// digging first, the hands busy and the shield down, when everything that
// gets to the bot hurts it; then what `reaches` says still reaches it in
// that stance at a steady rate, and the mobs `fight.only` picks out are
// fought as in the fight timeline above (atOnce biters at a time, all of
// them when there is no `only`). Biters walk about three blocks a second
// and hit once a second from arm's length; shooters in sight shoot as above
// once within their range; a creeper lights three blocks off and goes off
// a second and a half later, once.
// mobs: fightEstimate's mobs.
// A spear holder hits from its reach, and at its jab.
// A biter comes on at its own chase speed (blocksPerSecond, from the jar),
// not the three blocks a second once taken for all: a piglin brute runs 5.3,
// near a sprint, and mid-242-ae-nether-1's came from 6.9 blocks to 1.7 in
// about a second and struck twice while its rail went down (note 576). A
// creeper keeps the walk its fuse is reckoned with.
const arrives = m => Math.max(0, ((m.distance || 0) - (m.name === 'creeper' ? LIGHTS_AT : m.reach || 1.5)) / (m.name === 'creeper' ? APPROACH : blocksPerSecond(m.name)));
const bites = m => m.jab ?? m.hitsBot;
// A wither skeleton or a poisoner that gets to the bot leaves its effect on
// it past the reach: the wither ten seconds after its last hit, the poison
// its length (POISON), within the stretch. The poison already on the bot
// (the mobs' poisonedFor, fightEstimate) runs on whatever the stance.
// `health`, where given, floors the poison at 1 in `damage`; `poison` is
// its part either way, for the caller to floor (poisonFloored).
// `effectsTo`, where the wither and poison the stretch's blows leave are
// counted to (their own end, past the stretch): a meal is priced over its
// second and a half, and a wither skeleton's blow landing in it withers the
// bot for ten seconds after, five health it was priced as a tenth of
// (mid-242-ah-fortress-1's meal, note 601).
function stanceCost({ mobs, setup = 0, seconds = HOLD_SECONDS, reaches = () => false, fight = null, shield = false, health = null, effectsTo = null }) {
  let damage = 0;
  // The hits as timeline pieces, summed at the end under the half second a
  // hurt body cannot be hurt again (within).
  const pieces = [];
  const withering = [], poisoning = [[0, mobs.find(m => m.poisonedFor > 0)?.poisonedFor || 0]];
  // The fire on the bot now burns on whatever the stance (burnLeft).
  const burningFor = mobs.find(m => m.burningFor > 0)?.burningFor || 0;
  if (burningFor > 0) pieces.push(...bodyBurn(burningFor));
  // A biter that comes to the bot during the stance (`anchor`, when it
  // arrives or can reach again) strikes the moment it is there, a whole
  // blow (within), then at its pace: one blow each `blowEvery` seconds (a
  // second for most, two for a hoglin). Spread as a steady rate from its
  // arrival, a hoglin at the bot 0.7 seconds before a meal's end was
  // priced 2.3 where its first blow, 3.1 to 4.8 through the armour worn,
  // lands at once (mid-208-k-nether-4-fortress-1, note 587). One at arm's
  // length already has been striking at its own pace: where in it the
  // next blow falls is not known, so its blows are its steady rate.
  const leaks = new Set(), unseenCounted = new Set();
  const hurts = (m, from, to, shielded, anchor = from) => {
    if (!(to > from)) return;
    if (!m.shoots && arrival(m) < 1 && m.name !== 'creeper') unseenCounted.add(m.name);
    // A shooter off the side the shield faces (`unshielded`: a stance that
    // faces one mob) lands as if it were down (note 606).
    if (m.unshielded) shielded = false;
    if (m.shoots) pieces.push(...shotPieces(m, shielded, from, to));
    else {
      const every = m.jab ? 1 : MOBS[m.name]?.blowEvery || 1, hit = bites(m) * arrival(m);
      const steady = anchor > 0 ? anchor + every : from;
      if (anchor > 0 && anchor >= from && anchor < to) pieces.push(blowAt(anchor, hit));
      if (to > Math.max(from, steady)) pieces.push({ from: Math.max(from, steady), to, perSecond: hit / every, hit });
    }
    if (m.withers && !m.shoots) withering.push([from, to + WITHER.seconds]);
    // A shielded arrow is not a hit: a bogged's poison comes with the half
    // that land, from the first.
    if (m.poisons && (!m.shoots || m.visible)) poisoning.push([from + POISON.first, to + m.poisons]);
  };
  const blasts = [], still = new Set(), later = [], farIn = [];
  // Which mobs, not only their kinds: "3 zombies still reach it" was said
  // where one of three did (note 526).
  const stillMobs = new Set(), stillReach = m => { still.add(m.name); stillMobs.add(m); };
  // A far one not there before the setup is done is not counted at all.
  const fought = m => !!fight && !m.apart && !(m.far && !(arrives(m) < setup)) && m.name !== 'creeper' && (!fight.only || fight.only(m));
  for (const m of mobs) {
    // No way to the bot: it neither arrives nor goes off beside it. Held
    // off for minutes (held-off.js, note 599): priced at what it has done,
    // nothing, on every stance that does not go at it.
    if (m.apart || (m.quiet && !fought(m))) continue;
    // A biter out of sight past the eight a biter is counted from (`far`,
    // survival.js farBiters) counts where it can be at the bot before the
    // building or digging is done: that long the bot stands open to it,
    // wherever it is now. mid-242-ad-nether-3's pocket was priced at 0 with
    // a sword piglin 15.7 blocks off round the rock, 2.7 seconds away at
    // its own speed, and 13.8 seconds of building (note 581).
    if (m.far && !(arrives(m) < setup)) continue;
    if (m.far) farIn.push({ name: m.name, distance: round(m.distance), seconds: round(arrives(m)) });
    if (m.name === 'creeper') {
      // One lit already goes off when its fuse left runs out.
      const at = m.fought?.litNowFuseLeft ?? arrives(m) + FUSE;
      // Fought where the stance fights (the fight's figures, creeperFought):
      // killed inside its fuse, or gone off where the bot has backed to.
      // While the bot builds or digs it goes off beside it, two blocks off.
      const foughtHere = !!fight && !!m.fought && (!fight.only || fight.only(m)) && at > setup;
      if (foughtHere) {
        if (at <= seconds && m.fought.blast > 0) { blasts.push({ name: m.name, distance: m.distance, seconds: round(at), hitsBot: m.fought.blast, at: m.fought.goesOffAt }); damage += m.fought.blast; }
      } else if (at <= setup || (at <= seconds && reaches(m))) { blasts.push({ name: m.name, distance: m.distance, seconds: round(at), hitsBot: m.hitsBot, at: 2 }); damage += m.hitsBot; }
      if (reaches(m)) stillReach(m);
      continue;
    }
    if (m.shoots && !m.visible) continue;
    const from = m.shoots ? inRange(m) : arrives(m);
    // Building or digging: every mob that gets there, from when it does,
    // the shield down.
    hurts(m, from, setup, false);
    // `reaches` may say from when: a shooter out of its line that walks to
    // a new one reaches the bot from the second it has it (bunker.js
    // lineRegained), not never.
    const r = reaches(m), again = r === true ? 0 : typeof r === 'number' && Number.isFinite(r) ? r : null;
    if (!fought(m) && again != null && seconds > setup) {
      const start = Math.max(setup, from, again);
      if (again > 0 && Math.max(setup, again) >= seconds) continue;
      if (again > setup) later.push({ name: m.name, seconds: round(again) }); else stillReach(m);
      hurts(m, start, seconds, shield, Math.max(from, again));
    } else if (m.shoots && m.visible && !m.quiet && !fought(m) && again == null && seconds > setup && !(m.name === 'witch')) {
      // Kept off by what stands between, and still landing some (COVER_LEAK).
      const leaking = { ...m, poisons: undefined, ...(m.burns ? { every: (m.every || 2) / COVER_LEAK } : { lands: (m.lands ?? 1) * COVER_LEAK }) };
      hurts(leaking, Math.max(setup, from), seconds, false);
      leaks.add(m.name);
    }
  }
  if (fight && seconds > setup) {
    const order = mobs.filter(fought).sort((a, b) => a.distance - b.distance);
    const reach = order.filter(m => !m.shoots && m.name !== 'creeper' && m.distance <= 3).length;
    // `fight.lead`: the fight after the setup is the fight here, begun once
    // the setup is done: the first is met as the fight here meets it (PACE,
    // leadFor: the seconds from the start to the first swing). Fought from
    // a pillar's top with no lead, a wither skeleton seven blocks off read
    // 16.3 where the fight here read 23.8, the same blade and the same
    // fight a second and a half later (mid-242-aa, note 559).
    const first = order[0];
    const lead = fight.lead && first?.secondsASwing > 0 && !first.inCell ? leadFor(first.distance) : null;
    // The fought ones' wither and poison join the rest's: one effect each,
    // however many give it.
    for (const p of fightTimeline(order, { shield, atOnce: Math.max(fight.atOnce ?? Infinity, reach), lead })) {
      if (p.effect === 'burn') pieces.push({ ...p, from: p.from + setup, to: p.to + setup });
      else if (p.effect) (p.effect === 'poison' ? poisoning : withering).push([p.from + setup, p.to + setup]);
      else if (p.from < seconds - setup) pieces.push({ ...p, from: p.from + setup, to: Math.min(seconds, p.to + setup) });
    }
    for (const m of order) if (!m.shoots || m.visible) stillReach(m);
  }
  damage += within(pieces, seconds);
  // An effect begun within the stretch runs to `effectsTo` where given.
  const effectEnd = Math.max(seconds, effectsTo ?? seconds);
  const begunWithin = spans => spans.filter(([a]) => a < seconds);
  damage += spanned(clipped(begunWithin(withering), effectEnd)) * WITHER.perSecond;
  const poison = spanned(clipped(effectsTo != null ? [...begunWithin(poisoning)] : poisoning, effectEnd)) * POISON.perSecond;
  damage = poisonFloored(damage + poison, poison, health ?? Infinity);
  const out = { seconds, setup: round(setup), damage: round(damage), ...(poison > 0 ? { poison: round(poison) } : {}), blasts, still: [...still], later: later.sort((a, b) => a.seconds - b.seconds), ...(farIn.length ? { farIn } : {}),
    ...(leaks.size ? { leaks: [...leaks] } : {}), ...(unseenCounted.size ? { unseenBiters: [...unseenCounted] } : {}) };
  return Object.defineProperty(out, 'stillMobs', { value: [...stillMobs] });
}

module.exports = { slimeSize, slimeOf, slimeSplits, ghastShot, bodyBurn, COVER_LEAK, UNSEEN, arrival, arrowHit, shotModel, landsPerSecond, BOW_EVERY, CROSSBOW_EVERY, GHAST_SHOT, burnChance, burnRamp, burnBetween, SPEAR_SEEN, SPEAR_WAYS, arrives, GIVES_UP, BODY_HEIGHT, bodyHeight, FIRE_SECONDS, BURN_PER_SECOND, FIRE_TICKS, landingCost, landingsToEnd, landingsApart, landingsSays, burnLeft, burnSays, POISON, poisonFloored, effectLeft, MOB_SPEED, blocksPerSecond, followRange, PLAYER_SPRINT, WITHER, SPEAR, SWING_MS, BLAST_CLEAR, FUSE_KEPT, FIRST_SWING, creeperFought, creeperBlocked, creeperFoughtSays, creeperBlast, creeperBlastSays, fightEstimate, fightTimeline, within, stanceCost, afterArmour, armourOf, MOBS, WEAPONS, RANGE, FIRE_REACH, FIREBALL, fireballHit, volleyHit, fireballSays, HOLD_SECONDS, APPROACH, FUSE, LIGHTS_AT, PACE, swingEvery, leadFor };
