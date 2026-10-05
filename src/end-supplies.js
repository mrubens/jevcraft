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
// skeletons, none to two each (the bot never hurts chickens for feathers):
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
const WANTS = { arrow: 192, cobblestone: 64, water_bucket: 2, food: 64, health: 18 };
const HOLD_MS = 15 * 60000, ARROW_STEP = 32;
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
const rehearsedSays = () => `In the rehearsals of ${REHEARSED.day} (a bow, a diamond sword, iron armour and a shield, no bed used): by the bow, on a fresh End, ${REHEARSED.bow.arrows} arrows loosed in ${REHEARSED.bow.minutes} minutes took the ten crystals and the dragon's whole 200 health; by the sword, with every crystal already down and ${REHEARSED.sword.arrows} arrows carried, the dragon's last ${REHEARSED.sword.health} went in ${REHEARSED.sword.minutes} minutes, struck at its head each time it perched on the fountain; the bot alive both times. The crystals are the arrows' work: each stands on a pillar out of the sword's reach and heals the dragon while it stands, an arrow or a few for each of the ten. With fewer arrows, on a fresh End: ${REHEARSED.enough.arrows} were enough, the ten crystals down and the dragon dead in ${REHEARSED.enough.minutes} minutes, most of its health taken by the sword at its perches, ${REHEARSED.enough.left} arrows left and the bot never under full health for long; ${REHEARSED.few[0].arrows} took ${REHEARSED.few[0].crystals} of the ten crystals before they were gone, and ${REHEARSED.few[1].arrows} took ${REHEARSED.few[1].crystals}, the dragon healed to ${REHEARSED.few[1].dragon} of 200 and the bot dead by the fountain ${REHEARSED.few[1].minutes} minutes in.`;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const bedsOf = bot => bot.inventory.items().filter(i => /_bed$/.test(i.name)).reduce((n, i) => n + i.count, 0);

// The kit, item by item: { key, item, carried, wants, short, says }.
function kitItems(bot, goal, actions = {}, now = Date.now()) {
  const equipment = carriedEquipment(bot), out = [];
  const bow = equipment.some(i => i.name === 'bow' && durable(bot.registry, i));
  out.push({ key: 'bow', item: 'bow', carried: bow ? 1 : 0, wants: 1, short: !bow,
    says: 'Make or find a bow first: none that will last is carried. Without one the crystals on their pillars and the dragon in flight are out of reach, and the fight is the sword at its perch alone, the crystals healing it. Three sticks and three string at a crafting table; string is a spider\'s drop, and a skeleton drops a bow now and then.' });
  const arrows = countOf(bot, 'arrow'), step = Math.min(WANTS.arrow, arrows + ARROW_STEP);
  out.push({ key: 'arrows', item: 'arrow', carried: arrows, wants: WANTS.arrow, short: arrows < WANTS.arrow, target: step,
    says: `Get more arrows first: ${arrows} carried, the code would take ${WANTS.arrow}. ${rehearsedSays()} Here arrows come only from skeletons, none to two each, at night or in caves (the bot never hurts chickens for feathers): chosen, it hunts skeletons until ${step} are carried or a quarter hour has gone, and this is asked again.` });
  const blocks = countOf(bot, 'cobblestone');
  out.push({ key: 'blocks', item: 'cobblestone', carried: blocks, wants: WANTS.cobblestone, short: blocks < WANTS.cobblestone, target: WANTS.cobblestone,
    says: `Take cobblestone up to ${WANTS.cobblestone} first (${blocks} carried): the blocks laid in the End for a way off the entry platform, a pocket from endermen and a pillar's foot.` });
  const pick = equipment.some(i => ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(i.name));
  out.push({ key: 'pickaxe', item: 'iron_pickaxe', carried: pick ? 1 : 0, wants: 1, short: !pick,
    says: 'Make an iron pickaxe first (none of iron or better is carried): end stone and the entry platform\'s obsidian are dug with it, the way off the platform where it is walled, a trench for a bed and a pocket from endermen.' });
  const water = countOf(bot, 'water_bucket');
  out.push({ key: 'water', item: 'water_bucket', carried: water, wants: WANTS.water_bucket, short: water < WANTS.water_bucket, target: WANTS.water_bucket,
    says: `Fill water buckets up to two first (${water} carried): one for a landing after the dragon's wing throws the bot, one poured at its feet against endermen it has turned, which water hurts.` });
  const beds = bedsOf(bot), bedsOpen = !goal.endBeds || now - goal.endBeds.startedAt < END_BED_MS;
  out.push({ key: 'beds', item: 'bed', carried: beds, wants: END_BEDS, short: beds < END_BEDS && bedsOpen,
    says: `Make beds up to ${END_BEDS} first (${beds} carried), three wool and three planks each, the wool sheared: in the End a bed explodes when slept in, and one laid beside the perched dragon's head and blown from a trench is the heaviest blow the bot can deal it, about five health to the bot each. Not used in the rehearsals: what one takes from the dragon is not measured here. Twenty minutes at it at most.` });
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
const kitSays = items => items.map(i => i.key === 'bow' ? (i.carried ? 'a bow' : 'no bow') : i.key === 'pickaxe' ? (i.carried ? 'an iron pickaxe or better' : 'no iron pickaxe') : i.key === 'enchant' ? null
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
  const count = item.key === 'bow' || item.key === 'pickaxe' ? 1 + countOf(bot, item.item) : item.target;
  goal.step = { action: 'prepare_end_supplies', item: item.item, count }; save();
  await actions.acquireStep(bot, task, item.item, count, goal, save);
}

async function prepareEndSupplies(bot, task, goal, save, actions, client = task.opportunityClient) {
  task.check(); goal.preparingEnd = true; save();
  if (!await prepareCombatGear(bot, task, goal, save, actions)) return false;
  const now = Date.now(), items = kitItems(bot, goal, actions, now), short = items.filter(i => i.short);
  if (!short.length) { delete goal.preparingEnd; delete goal.endKit; save(); return true; }
  const kit = goal.endKit ||= {}, sig = short.map(i => `${i.key}:${i.carried}`).join(',');
  const held = kit.choice && (kit.choice.pick === 'enter_now' || now - kit.choice.at < HOLD_MS) ? kit.choice : null;
  let pick = null;
  // Going now holds until the kit is worse than when it was chosen, an item
  // of it lower (note 1171): not for a quarter hour, and not until any
  // count changes. 25594 (2026-10-04 03:58:49 to 04:13:57Z) chose to go at
  // 0.40, went down for its ring, and at the quarter hour was asked again,
  // chose the food at 0.37 over going at 0.30, and went looking for animals
  // and wood with its twelve eyes in the pack. A top-up holds while its
  // item is short of what it was chosen to reach.
  const counts = Object.fromEntries(items.map(i => [i.key, i.carried]));
  const worse = held?.pick === 'enter_now' && Object.entries(held.counts || {}).some(([k, n]) => (counts[k] ?? 0) < n);
  if (held?.pick === 'enter_now' && held.counts && !worse) pick = 'enter_now';
  else if (held && held.pick !== 'enter_now') {
    const item = short.find(i => `top_up_${i.key}` === held.pick);
    if (item && !(held.target != null && item.carried >= held.target)) pick = held.pick;
  }
  if (!pick) {
    const ring = goal.endPortal?.center && bot.entity?.position ? ` The portal's ring is ${Math.round(Math.hypot(bot.entity.position.x - goal.endPortal.center.x, bot.entity.position.z - goal.endPortal.center.z))} blocks off and ${Math.round(bot.entity.position.y - goal.endPortal.center.y)} under where the bot stands.` : '';
    const tree = { enter_now: { description: `Go to the End with what is carried now: ${kitSays(items)}; health ${Math.round((bot.health ?? 20) * 10) / 10}.${ring} Short of what the code would take: ${short.map(i => i.key).join(', ')}. ${rehearsedSays()} There is no way back out of the End but the dragon's death or the bot's own, and a death there leaves everything carried on its island.` } };
    // What each top-up has come to so far (note 1307): 25593 (2026-10-05
    // 17:04 to 20:50Z) chose the bow again and again, its time on string
    // said nowhere, the End's ring 700 blocks off and its twelve eyes held.
    const spentSays = key => { const sp = kit.spent?.[key]; if (!sp || sp.ms < 5 * 60000) return ''; return ` Taken up already for about ${Math.round(sp.ms / 60000)} minutes of play since ${new Date(sp.since).toISOString().slice(11, 16)}Z, the ${key} carried going from ${sp.from} to ${counts[key] ?? 0} meanwhile.`; };
    for (const i of short) tree[`top_up_${i.key}`] = { description: i.says + spentSays(i.key) };
    // The old order, for the tests' stand-in only (note 707).
    const oldOrder = `top_up_${(short.find(i => !['food', 'health'].includes(i.key)) || short[0]).key}`;
    const decision = await decide('end_kit', { client, bot, task, goal, save, tree, context: { oldOrder },
      state: { kit: Object.fromEntries(items.filter(i => i.key !== 'enchant').map(i => [i.key, `${i.carried} carried, the code would take ${i.wants}`])), health: bot.health, hunger: bot.food, ...(bot.entity?.position ? { riskNow: require('./risk').riskNow(bot) } : {}) } });
    if (decision.stale) return false;
    pick = decision.path.at(-1);
    const item = short.find(i => `top_up_${i.key}` === pick);
    kit.choice = { pick, at: now, sig, ...(pick === 'enter_now' ? { counts } : {}), ...(item?.target != null ? { target: item.target } : {}) }; save();
  }
  if (pick === 'enter_now') { delete goal.preparingEnd; save(); return true; }
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
module.exports = { prepareEndSupplies, kitItems, rehearsedSays, END_BEDS, REHEARSED };
