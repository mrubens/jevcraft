'use strict';
const { countOf } = require('./skills');
const { prepareCombatGear } = require('./mob-hunt');
const { carriedEquipment, durable } = require('./mob-policy');
const { foodSupply } = require('./foraging');
const { checkThreats } = require('./danger');
const { decide } = require('./decisions');

// The kit for the End, as Jev's choice (end_kit, note 1147).
//
// Before the portal the code fetched, in a fixed order with no question, a
// bow, 192 arrows, 64 cobblestone, an iron pickaxe, two water buckets, four
// beds, an enchanting table and 64 food points. Arrows here come only from
// skeletons, none to two each, or crafted from chickens' feathers (the rule sparing chickens lifted 2026-10-19):
// 192 of them is about that many skeletons killed, and nothing said what the
// arrows were for or what going with fewer costs. The lead trial of
// 2026-10-04 (25594, seven rods and twelve pearls in its chests at 00:56Z)
// was one pearl from this list.
//
// Now each item short of what the code would take is an option, said with
// what it is for and how it is got, beside going now with what is carried,
// said with the whole kit and what the rehearsed fight took. One item is
// topped up at a time and the question asked again (arrows thirty-two at a
// time), or after a quarter hour on it.
//
// Two water buckets: one for a landing after the dragon's knockback, one
// poured against an enderman (end-combat.js). With one, the enderman took
// the bucket and the next knockback had nothing to land in.
const END_BEDS = 4, END_BED_MS = 20 * 60000;
// The arrows the code would take (note 1311): 64, the 48 that freed a
// fresh End in the rehearsal after notes 1155 to 1176 and a margin, not the
// 192 of the bow-only fight before them. 25593 (2026-10-05), its twelve
// eyes held, was four hours on the bow alone with 192 arrows still to come
// from skeletons after it.
const WANTS = { arrow: 64, cobblestone: 64, water_bucket: 2, food: 64, health: 18 };
const HOLD_MS = 15 * 60000, ARROW_STEP = 32, FILL_HOLD_MS = 30 * 60000;
// A home by the portal (note 2017): with the portal lit and the bed slept in
// last far from it, a bed carried to the ring and slept in there, so a death
// comes back beside the portal and the kit's errands start from it. full-3
// (2026-10-21 17:29 to 23:03Z), its portal lit at (2052, 42, 1511) and its
// spawn bed 1,800 blocks off at (700, 103, 293), died nine times, each 1,365
// to 1,771 blocks from the portal, came back bare to the old bed, and gained
// not one item of the kit in five and a half hours.
const HOME_FAR = 300, HOME_NEAR = 24, HOME_LEG = 64, BED_AT_HAND = 16, WALK_PACE = 3.4;
const bedtimeSays = bot => { const t = bot.time?.timeOfDay; if (!Number.isFinite(t)) return ''; const left = t >= 12542 && t < 23460 ? 0 : Math.round(((12542 - t + 24000) % 24000) / 20 / 60); return left ? ` (in about ${left} real minutes)` : ' (now)'; };
const spawnBedOf = bot => bot._survivalState?.spawnBed?.foot || null;
function homeByPortal(bot, goal) {
  const ep = goal.endPortal, here = bot.entity?.position, sb = spawnBedOf(bot);
  if (!(ep?.litAt || ep?.neededEyes === 0) || !ep.center || !here || !/overworld/.test(String(bot.game?.dimension || 'overworld'))) return null;
  const bedOff = sb ? Math.round(Math.hypot(sb.x - ep.center.x, sb.z - ep.center.z)) : null;
  if (bedOff != null && bedOff <= HOME_FAR) return null;
  // What the time since the portal was lit has come to (note 2018): the
  // deaths since and how far from the ring each was, and the kit's items
  // gained in the time on them.
  const litAt = ep.litAt || Math.max(0, ...(ep.insertions || []).map(i => i.at || 0)) || null;
  const deaths = litAt ? (bot._survivalState?.deaths || []).filter(d => Date.parse(d.at) > litAt) : [];
  const far = deaths.map(d => d.position).filter(p => p && Number.isFinite(p.x)).map(p => Math.round(Math.hypot(p.x - ep.center.x, p.z - ep.center.z)));
  const spent = Object.values(goal.endKit?.spent || {}).reduce((n, sp) => n + (sp.ms || 0), 0);
  // The bed slept in last, standing within reach: taken up and carried
  // (the user, 2026-10-22, note 2019), no wool or planks wanted.
  let atBed = null;
  try {
    if (sb && Math.hypot(sb.x - here.x, sb.y - here.y, sb.z - here.z) <= BED_AT_HAND) {
      const b = bot.blockAt?.(new (require('vec3').Vec3)(sb.x, sb.y, sb.z));
      if (b && /_bed$/.test(b.name)) atBed = { foot: sb, name: b.name, d: Math.round(Math.hypot(sb.x - here.x, sb.z - here.z)) };
    }
  } catch (_) { atBed = null; }
  const ws = bot.spawnPoint && Number.isFinite(bot.spawnPoint.x) ? Math.round(Math.hypot(bot.spawnPoint.x - ep.center.x, bot.spawnPoint.z - ep.center.z)) : null;
  return { bedOff, off: Math.round(Math.hypot(here.x - ep.center.x, here.z - ep.center.z)), beds: bedsOf(bot), center: ep.center, litAt, deaths: deaths.length, far, spentMin: Math.round(spent / 60000), atBed, worldSpawnOff: ws };
}
const sinceLitSays = home => {
  if (!home.litAt) return '';
  const h = Math.round((Date.now() - home.litAt) / 360000) / 10;
  const where = home.far.length ? `, ${Math.min(...home.far)} to ${Math.max(...home.far)} blocks from the ring` : '';
  return ` Since the portal was lit, ${h} hours ago: ${home.deaths} death${home.deaths === 1 ? '' : 's'}${where}, each coming back at the bed slept in last with nothing carried${home.spentMin ? `, and ${home.spentMin} minutes on the kit's top-ups` : ''}.`;
};
// The dragon's fight as rehearsed (scripts/endgame.js dragon, port 25578,
// 2026-10-04; a bow, a diamond sword, iron armour and a shield, no bed
// used). By the bow (01:12Z, a fresh End): the ten crystals and the dragon's
// whole 200 health, 143 arrows loosed in 25 minutes, the bot never hurt
// badly. By the sword (03:31Z, the crystals already down, 16 arrows
// carried): the dragon's last 146 in 13 minutes, struck at its head each
// time it perched on the fountain, the bot alive at full health. Both ended
// "Free the End". The crystals are the arrows' work: each stands on a
// pillar out of the sword's reach and heals the dragon while it stands.
// With fewer arrows on a fresh End: 32 (03:00 to 03:13Z) took seven of the
// ten crystals; 21 (04:41 to 04:48Z) took three, and with none left the
// dragon stood at 187 of 200 and the bot died by the fountain.
const REHEARSED = { day: '2026-10-04', bow: { arrows: 143, minutes: 25 }, sword: { arrows: 16, health: 146, minutes: 13 }, few: [{ arrows: 32, crystals: 7 }, { arrows: 21, crystals: 3, dragon: 187, minutes: 8 }],
  // 48 arrows on a fresh End (05:00 to 05:10Z, the fight as it stood after notes 1155 to 1176): 'Free the End' in 9.9 minutes, 46 loosed.
  enough: { arrows: 48, minutes: 10, left: 2 } };
// The same kit without the shield, the water bucket and the food (note
// 1383): the arena's drills of 2026-10-06 evening, current code, each a
// fresh End. The record above said the kill's kit without those three.
const NO_FOOD = { from: '19:27', to: '19:56Z', runs: 5, died: 5, minutes: [2.2, 6.4], crystalsMost: 7 };
const NO_FOOD_SAYS = `The same kit without the shield, the water bucket and the food died in each of ${NO_FOOD.runs} drills that evening (${NO_FOOD.from} to ${NO_FOOD.to}), ${NO_FOOD.minutes[0]} to ${NO_FOOD.minutes[1]} minutes in, at most ${NO_FOOD.crystalsMost} crystals down: twice struck off its own pillar by the dragon with no water to land in, and with no food its health came back only while its hunger lasted.`;
// The live trials' first End fights (note 1406), none with a water bucket,
// arrows or snowballs, entered so from 'enter_now' with each offered.
const LIVE_END_SAYS = 'The first live trials in the End (2026-10-07, 20:09 to 20:39Z, four fights from one stronghold stage, no water bucket, no arrows and no snowballs carried) all died within ten minutes, the dragon never hurt, two of them through faults in the code since mended: the last, under the perched dragon by the fountain with the sword, was thrown 56 blocks up as it took off and died of the fall, which a bucket of water poured under the feet before landing answers; an earlier one was knocked off its bridge into the void by the breath.';
const rehearsedSays = () => `On 2026-10-06 the arena killed the dragon on a fresh End with no diamond: full iron, a shield, an iron sword, a bow and 16 arrows, 48 snowballs, an iron pickaxe, 128 cobblestone, a water bucket and 16 cooked beef, in about 31 minutes, the bot alive throughout (snowballs thrown at the crystals the arrows could not reach). ${NO_FOOD_SAYS} In the rehearsals of ${REHEARSED.day} (a bow, a diamond sword, iron armour and a shield, no bed used): by the bow, on a fresh End, ${REHEARSED.bow.arrows} arrows loosed in ${REHEARSED.bow.minutes} minutes took the ten crystals and the dragon's whole 200 health; by the sword, with every crystal already down and ${REHEARSED.sword.arrows} arrows carried, the dragon's last ${REHEARSED.sword.health} went in ${REHEARSED.sword.minutes} minutes, struck at its head each time it perched on the fountain; the bot alive both times. The crystals are the arrows' work: each stands on a pillar out of the sword's reach and heals the dragon while it stands, an arrow or a few for each of the ten. With fewer arrows, on a fresh End: ${REHEARSED.enough.arrows} were enough, the ten crystals down and the dragon dead in ${REHEARSED.enough.minutes} minutes, most of its health taken by the sword at its perches, ${REHEARSED.enough.left} arrows left and the bot never under full health for long; ${REHEARSED.few[0].arrows} took ${REHEARSED.few[0].crystals} of the ten crystals before they were gone, and ${REHEARSED.few[1].arrows} took ${REHEARSED.few[1].crystals}, the dragon healed to ${REHEARSED.few[1].dragon} of 200 and the bot dead by the fountain ${REHEARSED.few[1].minutes} minutes in.`;

// What is worn and held, said with going (note 1340): 25593 chose the End at
// 01:26Z on 2026-10-06 with nothing worn and a stone sword, never said here.
const gearSays = bot => { try { return require('./mob-hunt').endFightGearSays(bot); } catch (_) { return ''; } };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// What going in with the beds carried means against the dragon (note 2120): the kit question's enter_now said
// 'beds 1 of 4' with the bed's worth only on its top-up; full-3 (2026-10-25 17:06Z) chose enter_now with one bed.
function bedsWorthSays(items) {
  const beds = items.find(i => i.key === 'beds');
  if (!beds || !beds.short) return '';
  return ` With ${beds.carried} bed${beds.carried === 1 ? '' : 's'}: ${require('./bed-bomb').dragonBedSays()}`;
}
const bedsOf = bot => bot.inventory.items().filter(i => /_bed$/.test(i.name)).reduce((n, i) => n + i.count, 0);

// The kit, item by item: { key, item, carried, wants, short, says }.
function kitItems(bot, goal, actions = {}, now = Date.now()) {
  const equipment = carriedEquipment(bot), out = [];
  const bow = equipment.some(i => i.name === 'bow' && durable(bot.registry, i));
  out.push({ key: 'bow', item: 'bow', carried: bow ? 1 : 0, wants: 1, short: !bow,
    says: 'Make or find a bow first: none that will last is carried. Without one the crystals on their pillars and the dragon in flight are out of reach, and the fight is the sword at its perch alone, the crystals healing it. Three sticks and three string at a crafting table; string is a spider\'s drop, and a skeleton drops a bow now and then.' });
  const arrows = require('./skills').arrowsCarried(bot), step = Math.min(WANTS.arrow, arrows + ARROW_STEP);
  out.push({ key: 'arrows', item: 'arrow', carried: arrows, wants: WANTS.arrow, short: arrows < WANTS.arrow, target: step,
    says: `Get more arrows first: ${arrows} carried, the code would take ${WANTS.arrow}. ${rehearsedSays()} Here arrows come from skeletons, none to two each, at night or in caves, or are crafted from a feather, a flint and a stick, the feathers from chickens: chosen, it hunts skeletons until ${step} are carried or a quarter hour has gone, and this is asked again.` });
  // Snowballs for the crystals where the arrows are few (note 1342): any
  // projectile breaks one. The arena's drill of 2026-10-06 (01:59 to 02:03Z,
  // a fresh End, no armour, a stone sword, one arrow and 48 snowballs) threw
  // 7 and took 2 crystals 24 and 27 blocks over its feet.
  const snow = countOf(bot, 'snowball'), SNOW = 32;
  // The nearest snowy ground in what is loaded (note 1368): 25598 (2026-10-06
  // 16:15Z), twelve eyes banked, was offered snowballs with no word of where
  // snow lies and chose arrows, at a skeleton or less a kill.
  // The grove, not the cherry grove (note 1752): /grove/ matched cherry_grove, and 25588's stronghold-1 trial (2026-10-16) was told 'Snowy ground in what is loaded: the cherry grove about 148 blocks off', where no snow lies.
  const snowNear = (() => {
    try {
      const here = bot.entity.position.floored(), name = require('./exploration').biomeName;
      let best = null;
      for (let dx = -160; dx <= 160; dx += 16) for (let dz = -160; dz <= 160; dz += 16) {
        const d = Math.hypot(dx, dz); if (d > 160 || (best && d >= best.d)) continue;
        const b = name(bot, bot.blockAt(here.offset(dx, 70 - here.y, dz)));
        if (b && /snow|frozen|ice_spikes|^grove$|jagged|frozen_peaks/.test(b)) best = { d: Math.round(d), biome: b.replaceAll('_', ' ') };
      }
      return best;
    } catch (_) { return null; }
  })();
  out.push({ key: 'snowballs', item: 'snowball', carried: snow, wants: SNOW, short: snow < SNOW && arrows < REHEARSED.enough.arrows, target: Math.min(SNOW, snow + 16),
    says: `Dig snowballs up to ${SNOW} first (${snow} carried): one is dug from each snow layer with a shovel, on the snowy plains, taiga and slopes, sixteen to a stack. ${snowNear ? `Snowy ground in what is loaded: the ${snowNear.biome} about ${snowNear.d} blocks off.` : 'No snowy biome is in what is loaded within 160 blocks.'} In the End fights of 2026-10-15 (25588, about ninety runs with no arrow and no snowball carried) every crystal was climbed to, most deaths came on those pillars and their tops (the dragon's fireballs and body), and the best run broke seven of the ten; with snowballs the uncaged crystals are broken from the ground or a short stub, no climb. A thrown snowball or egg breaks an end crystal as an arrow does, thrown at half an arrow's speed: it reaches about 28 blocks up, so a crystal on one of the taller pillars is thrown at from a pillar of blocks part way up. In the arena's drill of 2026-10-06 (a fresh End, no armour, a stone sword, one arrow and 48 snowballs), 7 thrown took 2 crystals 24 and 27 blocks over the bot's feet. With the same kit and an iron pickaxe, after the throws from a pillar's top, the caged crystals opened with the pickaxe and the wait by the perch moved out to 16 blocks (2026-10-06 05:52 to 06:23Z): the dragon dead in about 31 minutes on a fresh End, the bot alive throughout, its lowest health 4; before those (04:47Z) the same kit died at seven minutes in the perched dragon's breath.` });
  const blocks = countOf(bot, 'cobblestone');
  out.push({ key: 'blocks', item: 'cobblestone', carried: blocks, wants: WANTS.cobblestone, short: blocks < WANTS.cobblestone, target: WANTS.cobblestone,
    says: `Take cobblestone up to ${WANTS.cobblestone} first (${blocks} carried): the blocks laid in the End for a way off the entry platform, a pocket from endermen and a pillar's foot.` });
  const pick = equipment.some(i => ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(i.name));
  // The pickaxes' uses left said (note 1758): 25588's dragon-40 (2026-10-16) wore its iron pickaxe out twenty minutes into the fight and had no block for the last four crystals' climbs.
  const picks = equipment.filter(i => ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(i.name));
  const usesLeft = picks.reduce((n, i) => n + Math.max(0, (bot.registry.itemsByName[i.name]?.maxDurability || 0) - (i.durabilityUsed || 0)), 0);
  out.push({ key: 'pickaxe', item: 'iron_pickaxe', carried: pick ? 1 : 0, wants: 1, short: !pick, usesLeft,
    says: `${pick ? `${picks.length} pickaxe${picks.length === 1 ? '' : 's'} of iron or better carried, ${usesLeft} blocks of digging left in ${picks.length === 1 ? 'it' : 'them'} (an iron pickaxe lasts 250).` : 'Make an iron pickaxe first (none of iron or better is carried):'} end stone and the entry platform's obsidian are dug with it, the way off the platform where it is walled, a trench for a bed and a pocket from endermen, and every block of the fight's climbs, roofs and pockets is end stone dug with it: 25588's dragon-40 (2026-10-16) wore an iron pickaxe out twenty minutes into the fight, six crystals broken, and had no block for the last four. A spare is three iron ingots and two sticks at a crafting table.` });
  // A second pickaxe (note 1814): the End grows no wood, and a pickaxe worn out there ends the tunnels, the holes and the way down the columns. 25588's dragon-181 (2026-10-18) died with its pickaxe nearly spent, 3 ingots, one stick and no crafting table; dragon-182 wore it out at tunnel cell 57 of 72 with no craft to offer and died on the surface with no crystal struck; dragon-176 struck one and stood six minutes on its column with no way down. Made here, where wood and a table are to be had.
  const ingots = countOf(bot, 'iron_ingot'), sticks = countOf(bot, 'stick'), tableCarried = countOf(bot, 'crafting_table');
  out.push({ key: 'spare_pickaxe', item: 'iron_pickaxe', carried: Math.max(0, picks.length - 1), wants: 1, short: pick && picks.length < 2 && usesLeft < 250,
    says: `Make a second iron pickaxe first (${usesLeft} blocks of digging left in the one carried; a fresh one has 250): in the End a tunnel under the island to a crystal's foot is 70 to 150 digs, the column dug down after a blow 20 to 40, and a hole two deep 2; the End grows no wood for sticks or a table, and the pickaxe spent there ends the tunnels, the holes and the way down the columns. Carried now: ${ingots} iron ingots, ${sticks} sticks, ${tableCarried ? 'a' : 'no'} crafting table; three ingots and two sticks make one at a table.` });
  const water = countOf(bot, 'water_bucket');
  out.push({ key: 'water', item: 'water_bucket', carried: water, wants: WANTS.water_bucket, short: water < WANTS.water_bucket, target: WANTS.water_bucket,
    says: `Fill water buckets up to two first (${water} carried): one for a landing after the dragon's wing throws the bot, one poured at its feet against endermen it has turned, which water hurts. A bucket is three iron ingots at a crafting table (${countOf(bot, 'bucket')} empty bucket${countOf(bot, 'bucket') === 1 ? '' : 's'}, ${countOf(bot, 'iron_ingot')} iron ingots and ${countOf(bot, 'raw_iron')} raw iron carried), filled at any water. ${LIVE_END_SAYS}` });
  // A boat for the fall (note 2178; the user, 2026-10-26): placed under the body and boarded in the air it lands the
  // bot unhurt where the bucket is spent or none is carried; five planks.
  const boatsCarried = (bot.inventory?.items?.() || []).filter(i => require('./boats').boatItem(i.name)).reduce((n, i) => n + i.count, 0);
  out.push({ key: 'boat', item: 'oak_boat', carried: boatsCarried, wants: 1, short: boatsCarried < 1, target: 1,
    says: `Make a boat first (${boatsCarried} carried): five planks at a crafting table. In the End a fall off a column is 15 to 20 blocks onto the island; the water bucket catches it while one is full, and a boat placed on the ground under the body and boarded in the air catches it too, the boat picked up after. full-3's End deaths counted five 'doomed to fall by Ender Dragon'.` });
  const beds = bedsOf(bot), bedsOpen = !goal.endBeds || now - goal.endBeds.startedAt < END_BED_MS;
  out.push({ key: 'beds', item: 'bed', carried: beds, wants: END_BEDS, short: beds < END_BEDS && bedsOpen,
    says: `Make beds up to ${END_BEDS} first (${beds} carried), three wool and three planks each, the wool sheared: in the End a bed explodes when slept in, and one laid beside the perched dragon's head and blown from a trench is the heaviest blow the bot can deal it, about five health to the bot each. ${require('./bed-bomb').dragonBedSays()} Not yet used against the dragon in the rehearsals or the runs. Twenty minutes at it at most.` });
  let table = true, ready = false;
  if (actions.enchant) { try { const e = require('./enchanting'); table = !!e.tableNear(bot, goal); ready = !!e.enchantReady(bot, goal); } catch (_) { table = true; ready = false; } }
  out.push({ key: 'enchant', item: 'enchanting_table', carried: table ? 1 : 0, wants: 1, short: !!actions.enchant && (!table || ready), ready,
    says: ready ? 'Enchant what the levels carried will buy on the sword, the bow and the armour first, at the enchanting table near.'
      : 'Make an enchanting table first (four obsidian, two diamonds and a book) and enchant what the levels will buy on the sword, the bow and the armour: none is near.' });
  const food = foodSupply(bot);
  out.push({ key: 'food', item: 'food', carried: food, wants: WANTS.food, short: food < WANTS.food || bot.food < 18,
    says: `Gather food up to ${WANTS.food} points first (${food} carried, hunger ${bot.food} of 20): the End has nothing to eat, and health comes back only at hunger eighteen or more.` });
  out.push({ key: 'health', item: 'health', carried: Math.round(bot.health ?? 20), wants: WANTS.health, short: (bot.health ?? 20) < WANTS.health,
    says: `Wait and heal to ${WANTS.health} first (health ${Math.round((bot.health ?? 20) * 10) / 10}${bot.food >= 18 ? '' : `; at hunger ${bot.food} it does not come back until the bot eats`}).` });
  return out;
}
const kitSays = items => items.map(i => i.key === 'bow' ? (i.carried ? 'a bow' : 'no bow') : i.key === 'pickaxe' ? (i.carried ? 'an iron pickaxe or better' : 'no iron pickaxe') : i.key === 'spare_pickaxe' ? (i.carried ? 'a second pickaxe' : i.short ? 'no second pickaxe, the one carried part worn' : null) : i.key === 'enchant' ? null
  : `${i.key} ${i.carried} of ${i.wants}`).filter(Boolean).join(', ');

async function topUp(bot, task, goal, save, actions, item) {
  // The food is gathered here, as the crossing's is (work.js gatherNetherFood:
  // the chest, the plot, the hunt), not left to the survival layer's own
  // errand (note 1158): chosen, the step set its name and came back, the
  // layer had no claim, and the loop spun. 25594 (2026-10-04 02:27:59 to
  // 02:47Z), at its stronghold with twelve eyes, chose the food first at
  // 0.61 and stood fifteen minutes in its pocket, "spinning: 21 passes in a
  // second", then chose it again.
  if (item.key === 'food') {
    goal.step = { action: 'prepare_end_supplies', item: 'food', count: WANTS.food }; save();
    if (actions.gatherFood) await actions.gatherFood(bot, task, goal, save);
    else await new Promise(resolve => setTimeout(resolve, 250));
    return;
  }
  if (item.key === 'health') {
    goal.step = { action: 'recover_before_end', health: bot.health, food: bot.food }; save();
    for (let n = 0; n < 5; n++) { task.check(); checkThreats(bot); await new Promise(resolve => setTimeout(resolve, 100)); }
    return;
  }
  if (item.key === 'enchant') {
    if (item.ready) { await actions.enchant(bot, task, goal, save); return; }
    goal.step = { action: 'prepare_end_supplies', item: 'enchanting_table', count: 1 }; save();
    await actions.acquireStep(bot, task, 'enchanting_table', 1, goal, save); return;
  }
  if (item.key === 'beds') {
    // Four, from carried wool, shearing for more; twenty minutes at it at
    // most, then the fight goes on with the bow.
    goal.endBeds ||= { startedAt: Date.now() };
    const { woolCarried } = require('./home-base');
    const shearing = require('./shearing');
    const wool = woolCarried(bot);
    goal.step = { action: 'prepare_end_supplies', item: 'bed', count: END_BEDS, carried: item.carried, wool: wool.total }; save();
    if (wool.dyed) { await actions.acquireStep(bot, task, 'white_wool', countOf(bot, 'white_wool') + wool.dyed, goal, save); return; }
    if (wool.count >= 3) { await actions.acquireStep(bot, task, `${wool.colour}_bed`, countOf(bot, `${wool.colour}_bed`) + 1, goal, save); return; }
    if (shearing.canShear(bot) && shearing.woollySheep(bot, goal).length) {
      await shearing.shearSheep(bot, task, goal, save, { navigate: actions.navigate, acquireStep: actions.acquireStep, want: wool.total + 3 }); return;
    }
    await actions.acquireStep(bot, task, 'white_bed', countOf(bot, 'white_bed') + 1, goal, save);
    return;
  }
  // The arrows the feathers and flint carried make, crafted first (note
  // 1982): a batch a feather short of its whole target went to the chickens
  // for it with the rest uncrafted. full-2 (2026-10-21 03:02 to 03:40Z), its
  // End portal lit, carried 7 arrows, 7 feathers and 8 flint toward 39, and
  // hunted chickens forty minutes with 28 arrows' makings in its pack.
  if (item.key === 'arrows') {
    const k = Math.min(countOf(bot, 'feather'), countOf(bot, 'flint'));
    const can = require('./skills').arrowsCarried(bot) + 4 * k;
    if (k > 0 && can < item.target) {
      goal.step = { action: 'prepare_end_supplies', item: 'arrow', count: can, from: 'the feathers and flint carried' }; save();
      await actions.acquireStep(bot, task, 'arrow', can, goal, save);
      return;
    }
  }
  const count = item.key === 'bow' || item.key === 'pickaxe' || item.key === 'spare_pickaxe' ? 1 + countOf(bot, item.item) : item.target;
  goal.step = { action: 'prepare_end_supplies', item: item.item, count }; save();
  await actions.acquireStep(bot, task, item.item, count, goal, save);
}

async function prepareEndSupplies(bot, task, goal, save, actions, client = task.opportunityClient) {
  task.check(); goal.preparingEnd = true; save();
  // Asked as the End's kit, not for a mob hunted before (note 2015): the
  // hunt's spider stayed in goal.mobHunt, and the question read 'against:
  // spider', 'One spider fought so' and 'for this fight'. full-3 (2026-10-21
  // 17:29 to 22:13Z), its End portal lit and nothing worn, answered it
  // fight_with_carried 28 times out of 30 with no mob within eight blocks,
  // and died eight times bare in the Overworld.
  if (!await prepareCombatGear(bot, task, goal, save, actions, { mob: null })) return false;
  const now = Date.now(), items = kitItems(bot, goal, actions, now), short = items.filter(i => i.short);
  if (!short.length) { delete goal.preparingEnd; delete goal.endKit; save(); return true; }
  const kit = goal.endKit ||= {}, sig = short.map(i => `${i.key}:${i.carried}`).join(',');
  // The eyes set in the frame first holds until the portal is lit, then the
  // kit is asked again (note 1380).
  // Or after half an hour (note 1389): held from the day it was chosen,
  // 25594 (2026-10-06 22:20 to 22:48Z) took its twelve eyes out of its chest
  // at night with nothing worn on an answer given hours before, and a
  // drowned took them 400 blocks along the way.
  if (kit.choice?.pick === 'fill_frame_first' && (goal.endPortal?.litAt || Date.now() - kit.choice.at > FILL_HOLD_MS)) { delete kit.choice; save(); }
  const held = kit.choice && (kit.choice.pick === 'enter_now' || kit.choice.pick === 'fill_frame_first' || now - kit.choice.at < HOLD_MS) ? kit.choice : null;
  let pick = null;
  // Going now holds until the kit is worse than when it was chosen, an item
  // of it lower (note 1171): not for a quarter hour, and not until any
  // count changes. 25594 (2026-10-04 03:58:49 to 04:13:57Z) chose to go at
  // 0.40, went down for its ring, and at the quarter hour was asked again,
  // chose the food at 0.37 over going at 0.30, and went looking for animals
  // and wood with its twelve eyes in the pack. A top-up holds while its
  // item is short of what it was chosen to reach.
  const counts = Object.fromEntries(items.map(i => [i.key, i.carried]));
  // A kit item short that the held answer never saw asks again (note 1814): the second pickaxe came in after 'enter_now' was held on the old counts.
  const worse = held?.pick === 'enter_now' && (Object.entries(held.counts || {}).some(([k, n]) => (counts[k] ?? 0) < n) || (held.counts && short.some(i => !(i.key in held.counts))));
  if (held?.pick === 'enter_now' && held.counts && !worse) pick = 'enter_now';
  else if (held?.pick === 'fill_frame_first') pick = 'fill_frame_first';
  else if (held?.pick === 'home_by_portal' && homeByPortal(bot, goal)) pick = 'home_by_portal';
  else if (held && held.pick !== 'enter_now') {
    const item = short.find(i => `top_up_${i.key}` === held.pick);
    if (item && !(held.target != null && item.carried >= held.target)) pick = held.pick;
  }
  if (!pick) {
    const ring = goal.endPortal?.center && bot.entity?.position ? ` The portal's ring is ${Math.round(Math.hypot(bot.entity.position.x - goal.endPortal.center.x, bot.entity.position.z - goal.endPortal.center.z))} blocks off and ${Math.round(bot.entity.position.y - goal.endPortal.center.y)} under where the bot stands.` : '';
    const tree = { enter_now: { description: `Go to the End with what is carried now: ${kitSays(items)}; health ${Math.round((bot.health ?? 20) * 10) / 10}.${ring} Short of what the code would take: ${short.map(i => i.key).join(', ')}.${bedsWorthSays(items)}${gearSays(bot)} ${rehearsedSays()} ${LIVE_END_SAYS} There is no way back out of the End but the dragon's death or the bot's own, and a death there leaves everything carried on its island.` } };
    // What each top-up has come to so far (note 1307): 25593 (2026-10-05
    // 17:04 to 20:50Z) chose the bow again and again, its time on string
    // said nowhere, the End's ring 700 blocks off and its twelve eyes held.
    // And at the pace so far, what the rest would take (note 1337): 25593
    // and 25592 (2026-10-06 00:45 to 01:10Z) chose arrows again and again,
    // 3 got in 24 minutes and 10 lost in 25, the ring found and 12 eyes held.
    const paceSays = (sp, now, i) => {
      const got = now - sp.from, left = (i?.wants ?? 0) - now, minutes = sp.ms / 60000;
      if (!i || !(i.wants > 1) || left <= 0) return '';
      if (got <= 0) return ` None gained in that time, ${left} more to ${i.wants}.`;
      const hours = left / (got / minutes) / 60;
      return ` At that pace (${got} in about ${Math.round(minutes)} minutes), the ${left} more to ${i.wants} would take about ${hours < 1.5 ? `${Math.round(hours * 60)} minutes` : `${Math.round(hours * 2) / 2} hours`}.`;
    };
    const spentSays = key => { const sp = kit.spent?.[key]; if (!sp || sp.ms < 5 * 60000) return ''; const now = counts[key] ?? 0; return ` Taken up already for about ${Math.round(sp.ms / 60000)} minutes of play since ${new Date(sp.since).toISOString().slice(11, 16)}Z, the ${key} carried going from ${sp.from} to ${now} meanwhile.${paceSays(sp, now, short.find(i => i.key === key))}`; };
    for (const i of short) tree[`top_up_${i.key}`] = { description: i.says + spentSays(i.key) };
    // The eyes to the frame first, the kit after (note 1380): set in the
    // frame none is lost to a death, and the kit is got near the portal or
    // anywhere after. 25598 (2026-10-06), its twelve eyes made at 15:40Z and
    // its portal found 1,300 blocks off, chose the kit's top-ups and going
    // with them for three hours; it carried eleven to a death at 18:10Z and
    // went bare and starving 650 blocks the other way. 25594 walked to its
    // portal with its twelve left in a chest 1,400 blocks back.
    const ep = goal.endPortal, eyesHeld = countOf(bot, 'ender_eye') + (() => { try { return require('./eye-bank').banked(goal); } catch (_) { return 0; } })();
    const frames = Array.isArray(ep?.frames) ? ep.frames : [], need = Number.isInteger(ep?.neededEyes) ? ep.neededEyes : frames.length ? frames.filter(f => !f.eye).length : null;
    if (ep?.center && !ep.litAt && Number.isInteger(need) && need > 0 && eyesHeld >= need && bot.entity?.position) {
      const off = Math.round(Math.hypot(bot.entity.position.x - ep.center.x, bot.entity.position.z - ep.center.z));
      const carried = countOf(bot, 'ender_eye');
      tree.fill_frame_first = { description: `Take the eyes to the portal now and set the ${need} it wants in its frame, then see to the kit: the portal's ring is ${off} blocks off, and ${carried >= need ? `the ${carried} eyes are carried` : `${carried} eyes are carried and the rest are taken from the chest first`}. Set in the frame, no eye is lost to a death; carried, a death drops them where it happens. The portal lit, this question is asked again there, the kit as it stands then.` };
    }
    const home = homeByPortal(bot, goal);
    if (home && home.beds && home.off <= HOME_NEAR) tree.home_by_portal = { description: `Stay by the portal's ring (${home.off} blocks off) until bedtime${bedtimeSays(bot)} and sleep in the carried bed here; the bed slept in stays the respawn. ${home.bedOff != null ? `The bed slept in last is ${home.bedOff} blocks from the portal, and a death before then comes back there.` : 'No bed has been slept in yet.'} Nothing else is done meanwhile.` };
    else if (home) tree.home_by_portal = { description: `Make the portal home first: ${home.beds ? `carry the bed${home.beds === 1 ? '' : 's'} carried` : home.atBed ? `take up the bed slept in last, ${home.atBed.d} blocks off here, and carry it` : 'make a bed (three wool, three planks) and carry it'} to the portal's ring, ${home.off} blocks off (about ${Math.max(1, Math.round(home.off / WALK_PACE / 60))} real minutes at the bot's walking pace of ${WALK_PACE} blocks a second, nights apart), and sleep in it there the next night; the bed slept in stays the respawn.${!home.beds && home.atBed ? ` Taken up, no bed stands for the respawn until that night: a death on the way comes back at the world spawn${home.worldSpawnOff != null ? `, ${home.worldSpawnOff} blocks from the portal` : ''}.` : ''} ${home.bedOff != null ? `The bed slept in last is ${home.bedOff} blocks from the portal: a death now comes back there, everything carried left where it fell, and the walk back to the ring is the ${home.bedOff} blocks again.` : 'No bed has been slept in yet: a death now comes back at the world spawn.'} Beside the ring a death comes back within reach of the portal and its chest, and the kit's errands go out from there.${sinceLitSays(home)}` };
    // The kit chest beside the bed at the ring (bed-kit.js, note 2185; Fable 10-26: a death in the End then costs
    // minutes, not the 73 of a kit made again): with the bed slept in last standing within reach, its chores are the
    // End kit's first options, said as what they are for here. And home_by_portal before the top-ups.
    let chores = {};
    try {
      const bk = require('./bed-kit'), sb = spawnBedOf(bot), ep = goal.endPortal;
      const bedNearRing = sb && ep?.center && Math.hypot(sb.x - ep.center.x, sb.z - ep.center.z) <= HOME_FAR;
      if (bedNearRing) {
        for (const [k, v] of Object.entries(bk.bedKitChores(bot, goal))) {
          if (!['kit_by_bed', 'stock_bed_kit', 'spare_armour_by_bed'].includes(k)) continue;
          chores[k] = { ...v, description: `${v.description} A death in the End comes back to life at this bed, ${Math.round(Math.hypot(sb.x - ep.center.x, sb.z - ep.center.z))} blocks from the portal's ring, with nothing carried: what is in the chest here is on the bot again in minutes, and what is not is made again (the full runs' re-kit after a death: about 73 minutes, 40 deaths to 2026-10-26 08:00Z; full-3 died 50 times between entering the End and the kill).` };
        }
      }
    } catch (_) { chores = {}; }
    const ordered = { ...(tree.home_by_portal ? { home_by_portal: tree.home_by_portal } : {}), ...Object.fromEntries(Object.entries(chores).map(([k, v]) => [k, { description: v.description }])), ...tree };
    for (const k of Object.keys(tree)) delete tree[k];
    Object.assign(tree, ordered);
    // The old order, for the tests' stand-in only (note 707).
    const oldOrder = `top_up_${(short.find(i => !['food', 'health'].includes(i.key)) || short[0]).key}`;
    const decision = await decide('end_kit', { client, bot, task, goal, save, tree, context: { oldOrder },
      state: { kit: Object.fromEntries(items.filter(i => i.key !== 'enchant').map(i => [i.key, `${i.carried} carried, the code would take ${i.wants}`])), health: bot.health, hunger: bot.food, whatTheKillsUsed: killsUsedSays(bot), ...(bot.entity?.position ? { riskNow: require('./risk').riskNow(bot) } : {}) } });
    if (decision.stale) return false;
    pick = decision.path.at(-1);
    const item = short.find(i => `top_up_${i.key}` === pick);
    kit.choice = { pick, at: now, sig, ...(pick === 'enter_now' ? { counts } : {}), ...(item?.target != null ? { target: item.target } : {}) }; save();
  }
  if (pick === 'enter_now' || pick === 'fill_frame_first') { delete goal.preparingEnd; save(); return true; }
  // The bed's chest chores (note 2185), carried out as bed-kit.js runs them.
  if (['kit_by_bed', 'stock_bed_kit', 'spare_armour_by_bed'].includes(pick)) {
    let chore = null; try { chore = require('./bed-kit').bedKitChores(bot, goal)[pick] || null; } catch (_) { chore = null; }
    if (!chore) { delete kit.choice; save(); return false; }
    goal.step = { action: 'prepare_end_supplies', item: pick }; save();
    try { await chore.run(bot, task, goal, save, actions); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    delete kit.choice; save();
    return false;
  }
  if (pick === 'home_by_portal') {
    const home = homeByPortal(bot, goal);
    if (!home) { delete kit.choice; save(); return false; }
    if (!home.beds && home.atBed) {
      const { Vec3 } = require('vec3'), { goals } = require('mineflayer-pathfinder');
      const foot = new Vec3(home.atBed.foot.x, home.atBed.foot.y, home.atBed.foot.z);
      goal.step = { action: 'prepare_end_supplies', item: 'home_by_portal', taking: 'the bed slept in last', at: home.atBed.foot }; save();
      await actions.navigate(bot, task, new goals.GoalNear(foot.x, foot.y, foot.z, 2), { timeoutMs: 30000, stallMs: 8000 });
      const b = bot.blockAt(foot);
      if (b && /_bed$/.test(b.name)) { await bot.dig(b); task.check(); }
      await actions.navigate(bot, task, new goals.GoalNear(foot.x, foot.y, foot.z, 0), { timeoutMs: 8000, stallMs: 4000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 800));
      console.log(`[home_by_portal] took up the bed at (${foot.x}, ${foot.y}, ${foot.z}): ${bedsOf(bot)} carried now`);
      return false;
    }
    if (!home.beds) { await topUp(bot, task, goal, save, actions, { key: 'beds', item: 'bed', carried: 0, wants: 1, short: true }); return false; }
    if (home.off <= HOME_NEAR) {
      // By the ring with a bed: the night's sleep is the survival layer's
      // (a carried bed is slept in where the bot is); the day waits here.
      goal.step = { action: 'prepare_end_supplies', item: 'home_by_portal', waiting: 'bedtime', off: home.off }; save();
      for (let n = 0; n < 50; n++) { task.check(); checkThreats(bot); await new Promise(resolve => setTimeout(resolve, 100)); }
      return false;
    }
    // Legs of 64 blocks toward the ring (note 2010's walks): asked of the
    // whole way at once, the route search gives up far off.
    const here = bot.entity.position, k = Math.min(1, HOME_LEG / home.off);
    const to = { x: Math.round(here.x + (home.center.x - here.x) * k), z: Math.round(here.z + (home.center.z - here.z) * k) };
    goal.step = { action: 'prepare_end_supplies', item: 'home_by_portal', to, off: home.off }; save();
    const { goals } = require('mineflayer-pathfinder');
    await actions.navigate(bot, task, home.off <= HOME_LEG ? new goals.GoalNearXZ(Math.round(home.center.x), Math.round(home.center.z), HOME_NEAR - 4) : new goals.GoalNearXZ(to.x, to.z, 4), { timeoutMs: 90000, stallMs: 10000 });
    return false;
  }
  const item = short.find(i => `top_up_${i.key}` === pick);
  if (!item) { delete kit.choice; save(); return false; }
  // The eyes carried, asked of before the errand (eye-bank.js, note 1193).
  if (!['health'].includes(item.key)) {
    try { await require('./eye-bank').eyesNow(bot, task, goal, save, actions, client, { errand: `for the End's kit (${item.key})` }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[eyes_now] ${String(err.message || err).slice(0, 200)}`); }
  }
  const sp = (kit.spent ||= {})[item.key] ||= { ms: 0, since: now, from: item.carried };
  const began = Date.now();
  try { await topUp(bot, task, goal, save, actions, kit.choice?.target != null ? { ...item, target: kit.choice.target } : item); }
  finally { sp.ms += Date.now() - began; save(); }
  return false;
}
// What the End's kills used, beside the sword's uses left (note 2246): the three End-stage kills of 2026-10-26 (323, 333
// and 336, 21 to 31 minutes from the entry platform or the island) were each the sword at the perched head from open
// ground, 34 to 55 blows, the crystals by climbs of 18 to 20 blocks quarried from the island with a pickaxe, food eaten
// through the fight; arrows took 8 to 17 of the dragon's 200 and the bed bombs and the boat gave nothing (Fable 17:30Z).
// stronghold-1-dragon-328 fought 55 minutes with no pickaxe and nothing to eat and was slain at 1.3 health.
function killsUsedSays(bot) {
  const items = bot?.inventory?.items?.() || [];
  const swords = items.filter(i => /_sword$/.test(i.name)).map(i => ({ name: i.name, left: Math.max(0, (bot.registry?.itemsByName?.[i.name]?.maxDurability || 0) - (i.durabilityUsed || 0)) })).sort((a, b) => b.left - a.left);
  const sword = swords[0] ? `the ${swords[0].name.replace(/_/g, ' ')} carried has ${swords[0].left} uses left` : 'no sword carried';
  const pick = items.some(i => /_pickaxe$/.test(i.name)) ? 'a pickaxe carried' : 'no pickaxe carried';
  return `The three End kills of 2026-10-26 (21 to 31 minutes) were each the sword at the perched dragon's head from open ground, 34 to 55 blows, about 60 sword uses with the crystals; the crystals' climbs were 18 to 20 blocks quarried from the island with a pickaxe, and food was eaten through the fight. Arrows took 8 to 17 of the dragon's 200; the bed bombs and the boat gave nothing. A fight with no pickaxe and nothing to eat (stronghold-1-dragon-328) lasted 55 minutes and was lost. Now: ${sword}, ${pick}.`;
}

module.exports = { bedsWorthSays, prepareEndSupplies, kitItems, homeByPortal, HOME_FAR, rehearsedSays, END_BEDS, REHEARSED };
