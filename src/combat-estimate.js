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
// knocked back by each swing and lands about a third of its hits. Checked
// against the arena's cave trio (a skeleton and two zombies, iron armour
// with gold boots, a diamond sword): estimated about 8 damage in 6 seconds,
// measured 4.9 to 5.5 in 7 (with a shield raised between swings).
const STRUCK = 1 / 3;
const WALK = 4; // blocks a second, closing on a mob

// Damage per hit on Normal, and health.
const MOBS = {
  zombie: { hit: 3, health: 20 }, husk: { hit: 3, health: 20 }, drowned: { hit: 3, health: 20 }, zombie_villager: { hit: 3, health: 20 },
  spider: { hit: 2, health: 16 }, cave_spider: { hit: 2, health: 12, note: 'poisons' },
  skeleton: { hit: 3, health: 20, shoots: true }, stray: { hit: 3, health: 20, shoots: true, note: 'slows' }, parched: { hit: 3, health: 20, shoots: true }, bogged: { hit: 3, health: 16, shoots: true, note: 'poisons' },
  pillager: { hit: 4, health: 24, shoots: true }, witch: { hit: 6, health: 26, shoots: true, ignoresArmour: true, note: 'harming potions go through armour, and poison and slowness keep the bot from getting away' },
  creeper: { hit: 22, health: 20, note: 'the hit is its blast, once, at point blank' },
  enderman: { hit: 7, health: 40 }, vindicator: { hit: 13, health: 24 }, slime: { hit: 4, health: 16 },
  zombified_piglin: { hit: 8, health: 20 }, piglin: { hit: 8, health: 16 }, piglin_brute: { hit: 13, health: 50 },
  hoglin: { hit: 6, health: 40, note: 'throws the bot about three blocks' }, zoglin: { hit: 6, health: 40, note: 'throws the bot about three blocks' },
  wither_skeleton: { hit: 8, health: 20, note: 'withers' }, blaze: { hit: 5, health: 20, shoots: true, note: 'sets alight' },
  magma_cube: { hit: 5, health: 16 }, silverfish: { hit: 1, health: 8 }, phantom: { hit: 4, health: 20 },
  // Every mob the danger list names (the decision audit, 2026-09-25): one
  // not here added nothing, and a ghast fight read "0 damage".
  ghast: { hit: 9, health: 10, shoots: true, note: 'fireballs that blast and set alight' }, breeze: { hit: 3, health: 30, shoots: true, note: 'wind charges throw the bot' },
  ravager: { hit: 12, health: 100 }, evoker: { hit: 6, health: 24, note: 'fangs from the ground, and vexes' }, vex: { hit: 9, health: 14, note: 'flies through walls' },
  guardian: { hit: 6, health: 30, shoots: true, note: 'a laser' }, elder_guardian: { hit: 8, health: 80, shoots: true, note: 'a laser, and mining fatigue' },
  warden: { hit: 30, health: 500, note: 'never to be fought' }, creaking: { hit: 3, health: 1, note: 'cannot be hurt while its heart stands' },
  illusioner: { hit: 4, health: 32, shoots: true }, endermite: { hit: 2, health: 8 },
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

// threats: [{ name, distance, shoots, visible }]; armour: piece names worn;
// weapon: the item name or null.
function fightEstimate({ threats, armour = [], weapon = null, health = 20, shield = false }) {
  const worn = armourOf(armour);
  const [damage, rate] = WEAPONS[weapon] || FIST;
  const unknown = [];
  const mobs = threats.map(t => {
    const m = MOBS[t.name];
    if (!m) { unknown.push(t.name); return null; }
    const hitsToKill = Math.ceil(m.health / damage);
    const shoots = !!(m.shoots || t.shoots);
    // A shooter backs off after each hit and is closed on again: twice the
    // swinging time, and the walk to it first. Trial 44 was told a skeleton
    // took 2.5 seconds and 1.3 damage; it took fourteen health in six
    // seconds without falling, and Jev, told otherwise, fought on at two.
    const seconds = shoots ? hitsToKill / rate * 2 + Math.max(0, (t.distance || 0) - 3) / WALK : hitsToKill / rate;
    return { name: t.name, distance: t.distance, shoots, visible: t.visible !== false,
      hitsBot: round(m.ignoresArmour ? m.hit : afterArmour(m.hit, worn)), swingsToKill: hitsToKill, secondsToKill: round(seconds), ...(m.note ? { note: m.note } : {}) };
  }).filter(Boolean);
  // Fighting here: nearest first; every mob still standing hits meanwhile,
  // biters once a second at arm's length, shooters every two seconds in
  // sight, the one being struck a third as often.
  const order = [...mobs].sort((a, b) => a.distance - b.distance);
  let taken = 0, seconds = 0;
  for (let i = 0; i < order.length; i++) {
    const t = order[i].secondsToKill;
    // The one being struck hits back a third as often if it bites; a shooter
    // being closed on shoots as ever.
    // A shield on the arm takes about half of the arrows (raised between
    // swings and against each shot seen coming).
    const perSecond = order.slice(i).reduce((s, m, j) => s + (m.name === 'creeper' ? 0 : (j === 0 && !m.shoots ? STRUCK : 1) * (m.shoots ? (m.visible ? m.hitsBot / 2 * (shield ? 0.5 : 1) : 0) : m.hitsBot)), 0);
    taken += perSecond * t; seconds += t;
  }
  const creepers = order.filter(m => m.name === 'creeper');
  return {
    armourPoints: worn.points, weapon: weapon || 'bare hands',
    mobs,
    fightHere: { seconds: round(seconds), damageTaken: round(taken), healthNow: round(health), healthAfter: round(health - taken),
      ...(creepers.length ? { creeper: 'not counted: a creeper that reaches the bot goes off for about ' + round(afterArmour(MOBS.creeper.hit, worn)) + ' after armour' } : {}),
      ...(unknown.length ? { notCounted: `no figures for ${[...new Set(unknown)].join(', ')}` } : {}) },
  };
}

module.exports = { fightEstimate, afterArmour, armourOf, MOBS, WEAPONS };
