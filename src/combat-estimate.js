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
  pillager: { hit: 4, health: 24, shoots: true }, witch: { hit: 6, health: 26, shoots: true, ignoresArmour: true, every: 3, note: 'harming potions go through armour, and poison and slowness keep the bot from getting away' },
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

// How far a shooter shoots from: one further off walks in first. A witch
// throws from about ten blocks; the bows about fifteen.
const RANGE = { witch: 10, ghast: 40, blaze: 16 };
const HOLD_SECONDS = 15, APPROACH = 3, FUSE = 1.5, LIGHTS_AT = 3;
const inRange = m => Math.max(0, ((m.distance || 0) - (RANGE[m.name] || 15)) / APPROACH);
// A shot every two seconds (a witch's potion every three). A shield takes
// about half of the arrows (raised between swings and against each shot
// seen coming); a witch's thrown potion is not stopped by it.
const shooting = (m, shield) => m.visible ? m.hitsBot / (m.every || 2) * (shield && m.name !== 'witch' ? 0.5 : 1) : 0;

// The fight where the bot stands, as a timeline: nearest first; every mob
// still standing hits meanwhile, biters once a second at arm's length,
// shooters every two seconds in sight once within their range, the one
// being struck a third as often. At most `atOnce` biters are at arm's
// length together (the open cells round the bot: two in a tunnel, eight in
// the open); the rest wait their turn. [{ from, to, perSecond }] pieces.
function fightTimeline(order, { shield = false, atOnce = Infinity } = {}) {
  const pieces = [];
  let t = 0;
  order.forEach((m0, i) => {
    const end = t + m0.secondsToKill;
    let biters = 0;
    order.slice(i).forEach((m, j) => {
      if (m.name === 'creeper') return;
      // The one being struck hits back a third as often if it bites; a
      // shooter being closed on shoots as ever.
      let perSecond;
      if (m.shoots) perSecond = shooting(m, shield);
      else if (++biters > atOnce) return;
      else perSecond = (j === 0 ? STRUCK : 1) * m.hitsBot;
      const from = Math.max(t, m.shoots ? inRange(m) : 0);
      if (perSecond > 0 && end > from) pieces.push({ from, to: end, perSecond });
    });
    t = end;
  });
  return pieces;
}
// The damage a timeline deals in its first `seconds` (all of it without).
function within(pieces, seconds = Infinity) {
  return pieces.reduce((n, p) => n + p.perSecond * Math.max(0, Math.min(p.to, seconds) - p.from), 0);
}

// threats: [{ name, distance, shoots, visible }]; armour: piece names worn;
// weapon: the item name or null; atOnce: how many biters can be at arm's
// length together where the bot stands.
function fightEstimate({ threats, armour = [], weapon = null, health = 20, shield = false, atOnce = Infinity }) {
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
      // A drowned's thrown trident is eight, where its hand is three.
      hitsBot: round(m.ignoresArmour ? m.hit : afterArmour(t.name === 'drowned' && shoots ? 8 : m.hit, worn)), swingsToKill: hitsToKill, secondsToKill: round(seconds), ...(m.every ? { every: m.every } : {}), ...(m.note ? { note: m.note } : {}) };
  }).filter(Boolean);
  const order = [...mobs].sort((a, b) => a.distance - b.distance);
  const timeline = fightTimeline(order, { shield, atOnce });
  const taken = within(timeline), seconds = order.reduce((n, m) => n + m.secondsToKill, 0);
  const creepers = order.filter(m => m.name === 'creeper');
  return {
    armourPoints: worn.points, weapon: weapon || 'bare hands',
    mobs,
    fightHere: { seconds: round(seconds), damageTaken: round(taken), healthNow: round(health), healthAfter: round(health - taken),
      // The same stretch every stance is priced over (stanceCost below).
      inFifteenSeconds: round(within(timeline, HOLD_SECONDS)),
      ...(Number.isFinite(atOnce) ? { atArmsLengthAtOnce: atOnce } : {}),
      ...(creepers.length ? { creeper: 'not counted: a creeper that reaches the bot goes off for about ' + round(afterArmour(MOBS.creeper.hit, worn)) + ' after armour' } : {}),
      ...(unknown.length ? { notCounted: `no figures for ${[...new Set(unknown)].join(', ')}` } : {}) },
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
const arrives = m => Math.max(0, ((m.distance || 0) - (m.name === 'creeper' ? LIGHTS_AT : 1.5)) / APPROACH);
function stanceCost({ mobs, setup = 0, seconds = HOLD_SECONDS, reaches = () => false, fight = null, shield = false }) {
  let damage = 0;
  const blasts = [], still = new Set();
  const fought = m => !!fight && m.name !== 'creeper' && (!fight.only || fight.only(m));
  for (const m of mobs) {
    if (m.name === 'creeper') {
      const at = arrives(m) + FUSE;
      if (at <= setup || (at <= seconds && reaches(m))) { blasts.push({ name: m.name, distance: m.distance, seconds: round(at), hitsBot: m.hitsBot }); damage += m.hitsBot; }
      if (reaches(m)) still.add(m.name);
      continue;
    }
    if (m.shoots && !m.visible) continue;
    const from = m.shoots ? inRange(m) : arrives(m);
    // Building or digging: every mob that gets there, from when it does,
    // the shield down.
    damage += Math.max(0, setup - from) * (m.shoots ? shooting(m, false) : m.hitsBot);
    if (!fought(m) && reaches(m) && seconds > setup) {
      still.add(m.name);
      damage += Math.max(0, seconds - Math.max(setup, from)) * (m.shoots ? shooting(m, shield) : m.hitsBot);
    }
  }
  if (fight && seconds > setup) {
    const order = mobs.filter(fought).sort((a, b) => a.distance - b.distance);
    damage += within(fightTimeline(order, { shield, atOnce: fight.atOnce ?? Infinity }), seconds - setup);
    for (const m of order) if (!m.shoots || m.visible) still.add(m.name);
  }
  return { seconds, setup: round(setup), damage: round(damage), blasts, still: [...still] };
}

module.exports = { fightEstimate, fightTimeline, within, stanceCost, afterArmour, armourOf, MOBS, WEAPONS, RANGE, HOLD_SECONDS, APPROACH, FUSE, LIGHTS_AT };
