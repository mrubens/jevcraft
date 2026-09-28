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

// Wither I, as a wither skeleton's hit gives it (26.1 WitherSkeleton
// doHurtTarget: two hundred ticks, amplifier 0): one health every forty
// ticks through armour, able to take the last, for ten seconds after the
// last hit that lands; hits from two of them do not add, each renews it.
// mid-235-p-fortress-7 fought one at 15.5 health told 13.7 damage, the
// blade alone; it was gone at 7.2, and the wither and the fire left 4.2
// (note 528).
const WITHER = { perSecond: 0.5, seconds: 10 };
// The seconds a set of [from, to] spans covers, overlaps counted once.
function spanned(spans) {
  let total = 0, end = -Infinity;
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue;
    total += b - Math.max(a, end); end = b;
  }
  return total;
}
// The same spans merged, as timeline pieces at the wither's rate.
function witherPieces(spans) {
  const out = [];
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last.to) last.to = Math.max(last.to, b); else out.push({ from: a, to: b, perSecond: WITHER.perSecond });
  }
  return out;
}

// Damage per hit on Normal, and health.
const MOBS = {
  zombie: { hit: 3, health: 20 }, husk: { hit: 3, health: 20 }, drowned: { hit: 3, health: 20 }, zombie_villager: { hit: 3, health: 20 },
  spider: { hit: 2, health: 16 }, cave_spider: { hit: 2, health: 12, note: 'poisons' },
  skeleton: { hit: 3, health: 20, shoots: true }, stray: { hit: 3, health: 20, shoots: true, note: 'slows' }, parched: { hit: 3, health: 20, shoots: true }, bogged: { hit: 3, health: 16, shoots: true, note: 'poisons' },
  pillager: { hit: 4, health: 24, shoots: true }, witch: { hit: 6, health: 26, shoots: true, ignoresArmour: true, every: 3, note: 'harming potions go through armour, and poison and slowness keep the bot from getting away' },
  creeper: { hit: 24, health: 20, note: 'the hit is its blast two blocks off, once; fought, it goes off where the bot stands when its fuse ends (creeperFought)' },
  enderman: { hit: 7, health: 40 }, vindicator: { hit: 13, health: 24 }, slime: { hit: 4, health: 16, splits: [{ size: 'medium', count: 3, hit: 2, health: 4 }] },
  zombified_piglin: { hit: 8, health: 20 }, piglin: { hit: 8, health: 16 }, piglin_brute: { hit: 13, health: 50 },
  hoglin: { hit: 6, health: 40, note: '3 to 8 a hit, and throws the bot about three blocks' }, zoglin: { hit: 6, health: 40, note: 'throws the bot about three blocks' },
  wither_skeleton: { hit: 8, health: 20, withers: WITHER.perSecond, note: 'each hit withers the bot for ten seconds, renewed by the next: about one health every two seconds that armour does not stop, and it can take the last' }, blaze: { hit: 5, health: 20, shoots: true, burns: 1, note: 'sets alight: each fireball that lands burns for five seconds more, about one a second through armour, and there is no water in the Nether to put it out' },
  magma_cube: { hit: 6, health: 16, note: 'a big one: it splits into two to four mediums (4 a hit), each of those into two to four smalls (3 a hit)', splits: [{ size: 'medium', count: 3, hit: 4, health: 4 }, { size: 'small', count: 9, hit: 3, health: 1 }] }, silverfish: { hit: 1, health: 8 }, phantom: { hit: 4, health: 20 },
  // Every mob the danger list names (the decision audit, 2026-09-25): one
  // not here added nothing, and a ghast fight read "0 damage".
  ghast: { hit: 9, health: 10, shoots: true, note: 'fireballs that blast and set alight' }, breeze: { hit: 3, health: 30, shoots: true, note: 'wind charges throw the bot' },
  ravager: { hit: 12, health: 100 }, evoker: { hit: 6, health: 24, note: 'fangs from the ground, and vexes' }, vex: { hit: 9, health: 14, note: 'flies through walls' },
  guardian: { hit: 6, health: 30, shoots: true, note: 'a laser' }, elder_guardian: { hit: 8, health: 80, shoots: true, note: 'a laser, and mining fatigue' },
  warden: { hit: 30, health: 500, note: 'never to be fought' }, creaking: { hit: 3, health: 1, note: 'cannot be hurt while its heart stands' },
  illusioner: { hit: 4, health: 32, shoots: true }, endermite: { hit: 2, health: 8 },
  goat: { hit: 2, health: 10, note: 'rams now and then unprovoked, and throws the bot several blocks' }, polar_bear: { hit: 6, health: 30, note: 'goes for a player near its cubs' },
  // Neutral until struck or hurt by the bot (danger.js provoked), then a
  // pack: mid-218-k (2026-09-27).
  wolf: { hit: 4, health: 8, note: 'the whole pack turns on a player that strikes one' }, bee: { hit: 2, health: 10, note: 'the hive turns together, and each sting poisons' },
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
const FOLLOW_RANGE = { zombie: 35, husk: 35, drowned: 35, zombie_villager: 35, zombified_piglin: 35, enderman: 64, blaze: 48, pillager: 32, ravager: 32, creaking: 32, warden: 24, breeze: 24, vindicator: 12, piglin_brute: 12, evoker: 12, illusioner: 18 };
const SPRINT_SPEED = 0.13;
const groundSpeed = s => s * s * 0.98 * 20 / (1 - 0.6 * 0.91);
const blocksPerSecond = name => groundSpeed(MOB_SPEED[name] ?? 0.25);
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
const shooting = (m, shield) => m.visible ? (m.hitsBot / (m.every || 2) + (m.burns || 0)) * (shield && m.name !== 'witch' ? 0.5 : 1) : 0;

// The fight where the bot stands, as a timeline: nearest first; every mob
// still standing hits meanwhile, biters once a second at arm's length,
// shooters every two seconds in sight once within their range, the one
// being struck a third as often. At most `atOnce` biters are at arm's
// length together (the open cells round the bot: two in a tunnel, eight in
// the open); the rest wait their turn. [{ from, to, perSecond }] pieces.
// A wither skeleton that bites withers the bot from then until ten seconds
// after it dies, steady while it hits (WITHER).
function fightTimeline(order, { shield = false, atOnce = Infinity } = {}) {
  const pieces = [], killed = new Map(), withering = new Map();
  let t = 0;
  order.forEach((m0, i) => {
    const end = t + m0.secondsToKill;
    let biters = 0;
    order.slice(i).forEach((m, j) => {
      if (m.name === 'creeper') return;
      // One from a split is not there until the one it came from is dead.
      if (m.bornOf && !killed.has(m.bornOf)) return;
      // The one being struck hits back a third as often if it bites; a
      // shooter being closed on shoots as ever. A spear holder jabs as
      // ever too: a swing's knockback leaves it within its reach, and it
      // reaches past the ones at arm's length (mid-244-z, note 497).
      let perSecond;
      if (m.shoots) perSecond = shooting(m, shield);
      else if (m.jab) perSecond = m.jab;
      else if (++biters > atOnce) return;
      else perSecond = (j === 0 ? STRUCK : 1) * m.hitsBot;
      const from = Math.max(t, m.shoots ? inRange(m) : 0);
      if (perSecond > 0 && end > from) pieces.push({ from, to: end, perSecond });
      if (m.withers && !m.shoots && !withering.has(m)) withering.set(m, from);
    });
    killed.set(m0, end);
    t = end;
  });
  pieces.push(...witherPieces([...withering].map(([m, from]) => [from, killed.get(m) + WITHER.seconds])));
  return pieces;
}
// The damage a timeline deals in its first `seconds` (all of it without).
function within(pieces, seconds = Infinity) {
  return pieces.reduce((n, p) => n + p.perSecond * Math.max(0, Math.min(p.to, seconds) - p.from), 0);
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
function fightEstimate({ threats, armour = [], weapon = null, health = 20, shield = false, atOnce = Infinity }) {
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
    for (const s of MOBS[t.name]?.splits || []) {
      const per = Math.round(s.count / parents.length);
      parents = parents.flatMap(p => Array.from({ length: per }, () => ({ ...t, distance: (t.distance || 0) + 0.5, split: s, from: p })));
      out.push(...parents);
    }
    return out;
  });
  mobs = threats.map(t => {
    const base = t.split ? { hit: t.split.hit, health: t.split.health, note: `a ${t.split.size} one, from a split` } : MOBS[t.name];
    if (!base) { unknown.push(t.name); return null; }
    // A spear in a mob's hand (26.1): its charged thrust is the hit. One
    // took mid-87-m from twenty to 11.4 through full iron, a zombie
    // villager's, where three a hit was reckoned (2026-09-26): about
    // thirteen before armour.
    const spear = /_spear$/.test(t.held || '');
    const m = spear ? { ...base, hit: Math.max(base.hit, SPEAR_HIT), note: `a spear: it jabs for about ${SPEAR.jab} before armour about once a second from about ${SPEAR.reach} blocks, each jab knocking the bot about a block back, and its charged thrust hits for about thirteen` } : base;
    const hitsToKill = Math.ceil(m.health / damage);
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
    const seconds = fought ? (fought.fuseLeft != null ? (fought.diesFirst ? fought.killSeconds : fought.fuseLeft) : (fought.diesFirst ? fought.killSeconds : FUSE) + Math.max(0, (t.distance || 0) - LIGHTS_AT) / WALK) : shoots ? hitsToKill / rate * 2 + Math.max(0, (t.distance || 0) - 3) / WALK : hitsToKill / rate * (spear ? 2 : 1);
    return { name: t.name, distance: t.distance, shoots, visible: t.visible !== false, ...(t.apart ? { apart: true } : {}),
      ...(fought ? { fought: { swings: fought.swings, secondsToKillIt: fought.killSeconds, ...(fought.health < MOBS.creeper.health ? { healthLeft: fought.health } : {}), ...(fought.fuseLeft != null ? { litNowFuseLeft: fought.fuseLeft } : {}), ...(fought.diesFirst ? { diesBeforeItGoesOff: true } : { goesOffAt: fought.goesOffAt, blast: fought.hitsBot }), ...(fought.room != null ? { roomBehind: round(fought.room) } : {}) } } : {}),
      // A drowned's thrown trident is eight, where its hand is three.
      hitsBot: round(m.ignoresArmour ? m.hit : afterArmour(t.name === 'drowned' && shoots ? 8 : m.hit, worn)), swingsToKill: hitsToKill, secondsToKill: round(seconds), ...(spear ? { spear: true, jab: round(afterArmour(SPEAR.jab, worn)), reach: SPEAR.reach, knock: SPEAR.knock } : {}), ...(m.every ? { every: m.every } : {}), ...(m.burns ? { burns: m.burns } : {}), ...(m.withers ? { withers: m.withers } : {}), ...(m.note ? { note: m.note } : {}) };
  });
  // The mob each split one comes from, kept off the record (not enumerable).
  mobs.forEach((m, i) => { if (m && threats[i].from) Object.defineProperty(m, 'bornOf', { value: mobs[threats.indexOf(threats[i].from)] }); });
  // And the entity each stands for, off the record too, where the caller
  // gave its id: a stance's cost asks where that one mob can get to.
  mobs.forEach((m, i) => { if (m && !threats[i].from && threats[i].id != null) Object.defineProperty(m, 'id', { value: threats[i].id }); });
  mobs = mobs.filter(Boolean);
  // One with no way to the bot (walk-reach.js) is not fought, and does not
  // hit (mid-205-v, note 525).
  const order = mobs.filter(m => !m.apart).sort((a, b) => a.distance - b.distance);
  // The cells round the bot bound how many can come at it, but not the
  // ones already there: in a tunnel or a shaft the open cells counted none,
  // with three zombies at arm's length, and the fight was told it cost
  // nothing; mid-235-f took it at 0.91 from 5.9 health and was killed
  // (2026-09-27).
  atOnce = Math.max(atOnce, order.filter(m => !m.shoots && m.name !== 'creeper' && m.distance <= 3).length);
  const timeline = fightTimeline(order, { shield, atOnce });
  const seconds = order.reduce((n, m) => n + m.secondsToKill, 0);
  // Each creeper fought that is not killed inside its fuse goes off once,
  // when its turn in the fight comes and the fuse has run.
  const blasts = [];
  order.reduce((t, m) => { if (m.fought?.blast > 0) blasts.push({ at: t + m.secondsToKill, damage: m.fought.blast }); return t + m.secondsToKill; }, 0);
  const blastsWithin = s => blasts.filter(b => b.at <= s).reduce((n, b) => n + b.damage, 0);
  const taken = within(timeline) + blastsWithin(Infinity);
  const creepers = order.filter(m => m.name === 'creeper');
  const nearestCreeper = creepers[0];
  const nearestThreat = nearestCreeper && threats.find(t => t.name === 'creeper' && !t.from && t.distance === nearestCreeper.distance);
  const creeperSays = nearestCreeper && creeperFoughtSays(creeperFought({ weapon, worn, room: nearestThreat?.backRoom ?? null, distance: nearestCreeper.distance, litFor: nearestThreat?.litFor ?? null, ...(Number.isFinite(nearestThreat?.health) ? { health: nearestThreat.health } : {}) }), { weapon, health, distance: nearestCreeper.distance }).trim();
  return {
    armourPoints: worn.points, weapon: weapon || 'bare hands',
    mobs,
    fightHere: { seconds: round(seconds), damageTaken: round(taken), healthNow: round(health), healthAfter: round(health - taken),
      // The same stretch every stance is priced over (stanceCost below).
      inFifteenSeconds: round(within(timeline, HOLD_SECONDS) + blastsWithin(HOLD_SECONDS)),
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
const arrives = m => Math.max(0, ((m.distance || 0) - (m.name === 'creeper' ? LIGHTS_AT : m.reach || 1.5)) / APPROACH);
const bites = m => m.jab ?? m.hitsBot;
function stanceCost({ mobs, setup = 0, seconds = HOLD_SECONDS, reaches = () => false, fight = null, shield = false }) {
  let damage = 0;
  const blasts = [], still = new Set(), later = [], withering = [];
  // Which mobs, not only their kinds: "3 zombies still reach it" was said
  // where one of three did (note 526).
  const stillMobs = new Set(), stillReach = m => { still.add(m.name); stillMobs.add(m); };
  const fought = m => !!fight && !m.apart && m.name !== 'creeper' && (!fight.only || fight.only(m));
  for (const m of mobs) {
    // No way to the bot: it neither arrives nor goes off beside it.
    if (m.apart) continue;
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
    damage += Math.max(0, setup - from) * (m.shoots ? shooting(m, false) : bites(m));
    if (m.withers && !m.shoots) withering.push([from, setup]);
    // `reaches` may say from when: a shooter out of its line that walks to
    // a new one reaches the bot from the second it has it (bunker.js
    // lineRegained), not never.
    const r = reaches(m), again = r === true ? 0 : typeof r === 'number' && Number.isFinite(r) ? r : null;
    if (!fought(m) && again != null && seconds > setup) {
      const start = Math.max(setup, from, again);
      if (again > 0 && Math.max(setup, again) >= seconds) continue;
      if (again > setup) later.push({ name: m.name, seconds: round(again) }); else stillReach(m);
      damage += Math.max(0, seconds - start) * (m.shoots ? shooting(m, shield) : bites(m));
      if (m.withers && !m.shoots) withering.push([start, seconds]);
    }
  }
  if (fight && seconds > setup) {
    const order = mobs.filter(fought).sort((a, b) => a.distance - b.distance);
    const reach = order.filter(m => !m.shoots && m.name !== 'creeper' && m.distance <= 3).length;
    damage += within(fightTimeline(order, { shield, atOnce: Math.max(fight.atOnce ?? Infinity, reach) }), seconds - setup);
    for (const m of order) if (!m.shoots || m.visible) stillReach(m);
  }
  // Withering while one not fought bites, from its first hit to the end
  // of the stretch (the fought wither in their timeline).
  damage += spanned(withering.map(([a, b]) => [a, Math.min(b, seconds)])) * WITHER.perSecond;
  const out = { seconds, setup: round(setup), damage: round(damage), blasts, still: [...still], later: later.sort((a, b) => a.seconds - b.seconds) };
  return Object.defineProperty(out, 'stillMobs', { value: [...stillMobs] });
}

module.exports = { MOB_SPEED, blocksPerSecond, followRange, PLAYER_SPRINT, WITHER, SPEAR, SWING_MS, BLAST_CLEAR, FUSE_KEPT, creeperFought, creeperFoughtSays, creeperBlast, creeperBlastSays, fightEstimate, fightTimeline, within, stanceCost, afterArmour, armourOf, MOBS, WEAPONS, RANGE, FIRE_REACH, FIREBALL, fireballHit, volleyHit, fireballSays, HOLD_SECONDS, APPROACH, FUSE, LIGHTS_AT };
