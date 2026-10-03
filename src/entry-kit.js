'use strict';
// What goes into the Nether that the record says changes who comes out
// (note 791). Every Nether stay of 2026-09-30T06:00Z to 2026-10-01T04:57Z
// (scripts/nether-kit.js: 111 stays in 94 trials, 50.3 Nether hours, 67
// deaths) read with what it carried in: 108 crossed with a shield in the off
// hand and none with a spare; 24 shields broke there, and the Nether minutes
// after a break killed 4.4 an hour against 1.0 in every other Nether minute
// (20 deaths in 271 minutes, 14 of them a blaze's). The crossing's question
// (crossing_kit) was asked before all 99 crossings and never said a shield,
// armour or a ghast, and offered none of them.
//
// So the crossing offers each item the record shows a difference for, priced
// in Overworld minutes from the pockets as they are (the iron carried or
// smelted, the planks or logs, a table, the mining where the iron is short)
// against what the stays with and without it came to; Jev chooses. And in the
// Nether, a spare shield made from the pockets while the one held is worn
// (upkeep's spare_shield), said with the wear.
const { countOf } = require('./skills');

// The record (scripts/nether-kit.js over the window). Each side: [stays,
// Nether hours, deaths an hour, blaze deaths an hour, rods an hour].
const RECORD = Object.freeze({
  window: '2026-09-30T06:00Z to 2026-10-01T04:57Z', stays: 111, trials: 94, hours: 50.3, deaths: 67,
  shield: { inHand: 108, spares: 0, breaks: 24, deadIn2: 13, afterMin: 271, afterDeaths: 20, afterBlaze: 14, afterRate: 4.42, otherRate: 1.03, makeableAtEntry: 12, makeableAtBreak: 7 },
  armour: { label: 'four armour pieces worn', with: [64, 26.6, 1.2, 0.23, 1.24], without: [47, 23.7, 1.48, 0.63, 2.28] },
  stone: { label: '64 or more ghast-proof blocks carried', with: [94, 42.3, 1.25, 0.31, 1.68], without: [17, 8.0, 1.75, 1.0, 2.0] },
  gold: { label: 'a piece of golden armour worn or carried', with: [36, 16.4, 1.16, 0.3, 1.95], without: [75, 33.8, 1.42, 0.47, 1.63], piglinWith: 1, piglinWithout: 3 },
});

const SMELT_SECONDS = 10, CRAFT_SECONDS = 3, PUT_DOWN_SECONDS = 3, LOG_SECONDS = 10.4;
const STONE_KIT = 64;
const IRON_FOR = Object.freeze({ boots: 4, helmet: 5, leggings: 7, chestplate: 8 });
const SLOT_OF = Object.freeze({ helmet: 5, chestplate: 6, leggings: 7, boots: 8 });
// Blocks a ghast's fireball does not break (blast resistance 6), against
// netherrack's 0.4 and dirt's 0.5.
const GHAST_PROOF = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'nether_bricks', 'basalt', 'smooth_basalt', 'polished_blackstone'];

const items = bot => { try { return bot?.inventory?.items?.() || []; } catch (_) { return []; } };
const sum = (bot, re) => items(bot).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mins = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 30) / 2} minutes`;
const dimOf = bot => String(bot?.game?.dimension || '');
const rate = side => `${side[0]} stays (${side[1]} Nether hours): ${side[2]} deaths an hour, ${side[3]} of them a blaze's, ${side[4]} rods an hour`;

// A smelt from what is carried: a furnace (or eight stone for one) and a fuel
// the smelt step burns (fuel.js).
function smeltKit(bot) {
  const { CARRIED_FUELS, fuelPlanks } = require('./fuel');
  const furnace = countOf(bot, 'furnace') > 0, stone = ['cobblestone', 'cobbled_deepslate', 'blackstone'].some(n => countOf(bot, n) >= 8);
  const fuel = items(bot).find(i => CARRIED_FUELS.includes(i.name) || fuelPlanks.includes(i.name) || /^(?!crimson_|warped_).*_log$/.test(i.name))?.name || null;
  return { ok: !!fuel && (furnace || stone), furnace, fuel };
}
// n iron ingots: carried, smelted from raw iron carried, or short (mined).
function ironFor(bot, n, y = 64) {
  const ingots = countOf(bot, 'iron_ingot'), raw = countOf(bot, 'raw_iron'), smelt = smeltKit(bot);
  const carried = Math.min(n, ingots), smelted = smelt.ok ? Math.min(n - carried, raw) : 0, short = n - carried - smelted;
  const seconds = smelted ? smelted * SMELT_SECONDS + (smelt.furnace ? PUT_DOWN_SECONDS : PUT_DOWN_SECONDS + CRAFT_SECONDS) : 0;
  const parts = [];
  if (carried) parts.push(`${carried} of the ${ingots} iron ingots carried`);
  if (smelted) parts.push(`${smelted} smelted from the ${raw} raw iron carried (${SMELT_SECONDS} seconds an ingot in ${smelt.furnace ? 'the furnace carried' : 'a furnace made from 8 of the stone carried'}, the ${smelt.fuel.replaceAll('_', ' ')} carried for fuel)`);
  if (short) {
    const { minutesSays } = require('./kit-record');
    parts.push(`${short} more mined and smelted, ${raw && !smelt.ok ? `the ${raw} raw iron carried waiting on a furnace and fuel, ` : ''}${minutesSays('iron_armour', y) || 'a trip to iron ore'}`);
  }
  return { seconds, short, says: parts.join(', ') };
}
// p planks, and a table unless one is carried: from planks, logs (four
// planks each), or logs still to cut.
function planksFor(bot, p) {
  const table = countOf(bot, 'crafting_table') > 0, want = p + (table ? 0 : 4);
  const planks = sum(bot, /_planks$/), logs = sum(bot, /_(log|stem|wood|hyphae)$/), have = planks + 4 * logs;
  const cut = Math.max(0, Math.ceil((want - have) / 4));
  const seconds = (planks < want ? CRAFT_SECONDS : 0) + (table ? 0 : CRAFT_SECONDS + PUT_DOWN_SECONDS) + cut * LOG_SECONDS;
  const carried = [planks ? `${planks} planks` : null, logs ? plural(logs, 'log') : null].filter(Boolean).join(' and ');
  const from = planks >= want ? `${want} of the ${planks} planks carried` : have >= want ? `planks from the ${carried} carried`
    : `${carried ? `the ${carried} carried and ` : ''}${cut} more ${cut === 1 ? 'log' : 'logs'} cut (about ${LOG_SECONDS} seconds a log within a tree, plus the walk to one; note 787)`;
  return { seconds, cut, says: `${from}${table ? ', at the crafting table carried' : ', 4 of them for a crafting table'}` };
}

// What the shield the crossing would carry costs from here: an iron ingot
// and six planks at a table.
function shieldCost(bot) {
  const y = Math.round(bot?.entity?.position?.y ?? 64);
  const iron = ironFor(bot, 1, y), wood = planksFor(bot, 6);
  const seconds = iron.seconds + wood.seconds + CRAFT_SECONDS;
  return { seconds, mined: iron.short > 0, cut: wood.cut, says: `${iron.says}; ${wood.says}; ${iron.short ? `${mins(seconds)} beside the mining` : mins(seconds)} in all` };
}

// The armour pieces had: worn, or carried (worn at the next step,
// mob-policy.js wearBestArmour), iron or better, golden boots for the feet.
function armourHad(bot) {
  const slots = bot?.inventory?.slots || [];
  const good = (name, piece) => new RegExp(`^(iron|diamond|netherite)_${piece}$`).test(name || '') || (piece === 'boots' && name === 'golden_boots');
  return Object.keys(IRON_FOR).filter(piece => good(slots[SLOT_OF[piece]]?.name, piece) || items(bot).some(i => good(i.name, piece)));
}

// The pieces the record speaks to, priced from the pockets. -> [{ key, item,
// count, says, short }]: each an offer at the crossing, Jev's to take.
function offers(bot) {
  if (bot?.game?.gameMode !== 'survival' || !/overworld/.test(dimOf(bot) || 'overworld') || bot.game?.difficulty === 'peaceful' || !bot.inventory) return [];
  const out = [], r = RECORD.shield, y = Math.round(bot.entity?.position?.y ?? 64);
  const SW = require('./shield-wear'), s = SW.state(bot);
  if (!s.spare) {
    const c = shieldCost(bot);
    out.push({ key: 'shield', item: 'shield', count: countOf(bot, 'shield') + 1, seconds: c.seconds, mined: c.mined, cut: c.cut,
      says: `A spare shield, carried in: ${c.says}. ${s.held ? `The shield in the off hand has ${s.left} of its ${s.max} uses left, about ${plural(s.fireballs, 'blaze fireball')} blocked (each takes ${SW.WEAR.fireball})` : 'No shield is in the off hand'}. In the record (${RECORD.window}, ${RECORD.stays} Nether stays): ${r.inHand} crossed with a shield in the off hand and none with a spare; ${r.breaks} shields broke in the Nether, ${r.deadIn2} of those bots dead within two minutes, and the Nether minutes after a break killed ${r.afterRate} an hour (${r.afterDeaths} deaths in ${r.afterMin} minutes, ${r.afterBlaze} a blaze's) against ${r.otherRate} an hour in every other Nether minute. A spare in the pockets goes into the off hand by itself when the one held breaks. At ${r.makeableAtEntry} of the ${r.breaks} crossings whose shield later broke, the pockets made one then; at the break, ${r.makeableAtBreak}.` });
  }
  const had = armourHad(bot), missing = Object.keys(IRON_FOR).filter(p => !had.includes(p));
  if (missing.length) {
    const piece = missing[0], n = IRON_FOR[piece], iron = ironFor(bot, n, y), wood = countOf(bot, 'crafting_table') ? null : planksFor(bot, 0);
    const seconds = iron.seconds + (wood?.seconds || 0) + CRAFT_SECONDS;
    out.push({ key: 'armour', item: `iron_${piece}`, count: countOf(bot, `iron_${piece}`) + 1, seconds, mined: iron.short > 0,
      says: `Iron ${piece} first, the cheapest of the ${plural(missing.length, 'piece')} not had (${missing.join(', ')}; iron ${missing.map(p => `${p} ${IRON_FOR[p]}`).join(', ')}): ${n} iron, ${iron.says}${wood ? `; a crafting table, ${wood.says}` : ''}; ${iron.short ? `${mins(seconds)} beside the mining` : mins(seconds)} in all. ${rateSays('armour')}` });
  }
  const kinds = GHAST_PROOF.map(k => [k, countOf(bot, k)]).sort((a, b) => b[1] - a[1]), [kind, most] = kinds[0];
  const ghast = kinds.reduce((n, [, v]) => n + v, 0);
  // Blocks short of the crossing's count are the ladder's blocks rung (note
  // 673), said there, and its step mines cobblestone; here only the count met
  // with too few of one ghast-proof kind (netherrack and dirt) is offered.
  const { netherBlocks, NETHER_BLOCKS } = require('./crossing-kit');
  if (most < STONE_KIT && netherBlocks(bot) >= NETHER_BLOCKS) {
    const item = ['cobblestone', 'cobbled_deepslate'].includes(kind) && most > 0 ? kind : y < 0 ? 'cobbled_deepslate' : 'cobblestone';
    const have = countOf(bot, item), short = STONE_KIT - have;
    const { RUNGS } = require('./kit-record'), b = RUNGS.nether_blocks;
    out.push({ key: 'stone', item, count: STONE_KIT, seconds: null, mined: true,
      says: `${STONE_KIT} ${item.replaceAll('_', ' ')}, one kind a ghast's fireball does not break, for covers and bridges: ${have} carried, ${short} more mined (a stone pickaxe digs one in about 0.6 seconds, an iron one 0.4, a use of the pickaxe each, besides the steps between faces; the blocks rung's record: ${b[0]} trials, a median ${b[2]} minutes each). ${ghast} ghast-proof blocks carried in all (${kinds.filter(([, v]) => v).map(([k, v]) => `${v} ${k.replaceAll('_', ' ')}`).join(', ') || 'none'}); netherrack and dirt break under a fireball, and a cover begun in one kind stops where that kind runs out (note 786: 18 covers did). ${rateSays('stone')}` });
  }
  return out;
}

// The record of an item: the stays with it against those without, said as
// the played record, not a forecast.
function rateSays(key) {
  const r = RECORD[key];
  return `In the record (${RECORD.window}; the played record, not a forecast, and the stays differ in other ways): with ${r.label}, ${rate(r.with)}; without, ${rate(r.without)}${key === 'gold' ? `; piglins killed ${r.piglinWith} with gold and ${r.piglinWithout} without` : ''}.`;
}

// What crossing without each offer means, for cross_now. -> string
function goingWithout(list) {
  if (!list.length) return '';
  const r = RECORD.shield;
  const parts = list.map(o => o.key === 'shield' ? `no spare shield (after a break the Nether killed ${r.afterRate} an hour, ${r.otherRate} otherwise)`
    : o.key === 'armour' ? `fewer than four armour pieces (blaze deaths ${RECORD.armour.without[3]} an hour without, ${RECORD.armour.with[3]} with)`
      : `fewer than ${STONE_KIT} blocks of one ghast-proof kind (deaths ${RECORD.stone.without[2]} an hour under 64 ghast-proof, ${RECORD.stone.with[2]} with)`);
  return ` Crossing now goes with ${parts.join('; ')}.`;
}

// In the Nether: a spare shield made from the pockets while the one held is
// worn (note 791). Offered when the shield in the off hand has two-thirds of
// its uses or fewer left (band 1) and again at a third (band 2), no spare is
// carried, and the pockets make one: an iron ingot, or raw iron with a
// furnace (or eight stone) and fuel; six planks (any wood, the Nether's
// stems' too) and a table or four planks more. -> { band, seconds, says } or null
const WORN_BANDS = [2 / 3, 1 / 3];
function netherSpare(bot) {
  if (!/nether/.test(dimOf(bot)) || bot?.game?.gameMode !== 'survival' || !bot.inventory) return null;
  const SW = require('./shield-wear'), s = SW.state(bot);
  if (!s.held || s.spare) return null;
  const band = WORN_BANDS.filter(f => s.left <= s.max * f).length;
  if (!band) return null;
  const ingots = countOf(bot, 'iron_ingot'), raw = countOf(bot, 'raw_iron'), smelt = smeltKit(bot);
  const planks = sum(bot, /_planks$/) + 4 * sum(bot, /_(log|stem|wood|hyphae)$/), table = countOf(bot, 'crafting_table') > 0;
  if (!(ingots || (raw && smelt.ok)) || planks < (table ? 6 : 10)) return null;
  const iron = ironFor(bot, 1), wood = planksFor(bot, 6);
  const seconds = iron.seconds + wood.seconds + CRAFT_SECONDS, r = RECORD.shield;
  return { band, seconds, says: `Make a spare shield now, from what is carried (an iron ingot: ${iron.says}; ${wood.says}), ${mins(seconds)} standing here: ${SW.says(bot, s)} The worn one stays in the off hand until it breaks, and the spare goes on by itself then. Of the ${r.breaks} shields that broke in the Nether in the record, the pockets made a spare at ${r.makeableAtBreak} breaks and none was made; the Nether minutes after a break killed ${r.afterRate} an hour against ${r.otherRate}.` };
}

// In the Nether: a piece of iron armour the bot goes without, made from the
// pockets (note 1024). On 2026-10-03 (00:00 to 09:00Z) 47 bot starts in the
// Nether wore no leggings with the seven ingots' worth of iron for them
// carried (25590: a helmet and chestplate, 61 raw iron, a furnace and 117
// coal), and no step or question there made a piece: the armour's rung is
// the Overworld's. The piece that takes the most off a hit first, of those
// the iron carried covers: the ingots carried, or raw iron with a furnace
// (or eight stone) and fuel; a crafting table carried or four planks.
// Not while a mob is about (the caller's weather). -> { item, seconds, says } or null
const PIECES = [['torso', 'iron_chestplate', 8, 6], ['legs', 'iron_leggings', 7, 7], ['head', 'iron_helmet', 5, 5], ['feet', 'iron_boots', 4, 8]];
function netherPiece(bot) {
  if (!/nether/.test(dimOf(bot)) || bot?.game?.gameMode !== 'survival' || !bot.inventory) return null;
  const wornAt = slot => bot.inventory.slots?.[slot]?.name || null;
  const here = bot.entity?.position;
  if (here && Object.values(bot.entities || {}).some(e => (e.type === 'hostile' || e.kind === 'Hostile mobs') && e.position && e.position.distanceTo(here) <= 24)) return null;
  const ingots = countOf(bot, 'iron_ingot'), raw = countOf(bot, 'raw_iron'), smelt = smeltKit(bot);
  const iron = ingots + (smelt.ok ? raw : 0);
  const table = countOf(bot, 'crafting_table') > 0, planks = sum(bot, /_planks$/) + 4 * sum(bot, /_(log|stem|wood|hyphae)$/);
  if (!table && planks < 4) return null;
  const piece = PIECES.find(([, item, need, slot]) => !wornAt(slot) && !countOf(bot, item) && !(item === 'iron_boots' && countOf(bot, 'golden_boots')) && iron >= need);
  if (!piece) return null;
  const [, item, need] = piece;
  const from = ironFor(bot, need), wood = planksFor(bot, 0);
  const seconds = from.seconds + wood.seconds + CRAFT_SECONDS;
  let hits = '', record = '';
  try {
    const ce = require('./combat-estimate'), worn = [5, 6, 7, 8].map(wornAt).filter(Boolean), round = n => Math.round(n * 10) / 10;
    const through = names => [round(ce.afterArmour(ce.MOBS.blaze.hit, ce.armourOf(names))), round(ce.afterArmour(ce.MOBS.wither_skeleton.hit, ce.armourOf(names)))];
    const [f0, w0] = through(worn), [f1, w1] = through([...worn, item]);
    hits = ` Worn now: ${worn.length ? worn.map(n => n.replaceAll('_', ' ')).join(', ') : 'nothing'}; a blaze's fireball lands about ${f0} and a wither skeleton's blade about ${w0}, with the ${item.replace('iron_', '')} about ${f1} and ${w1} (the fire a fireball sets is not reduced).`;
  } catch (_) { hits = ''; }
  try { record = ` Iron armour: ${require('./kit-record').BEFORE_NETHER.iron_armour.says}.`; } catch (_) { record = ''; }
  return { item, seconds, says: `Make ${/s$/.test(item) ? '' : 'an '}${item.replaceAll('_', ' ')} now and put ${/s$/.test(item) ? 'them' : 'it'} on, from what is carried (${plural(need, 'iron ingot')}: ${from.says}${wood.says ? `; ${wood.says.replace(/^0 of the \d+ planks carried, /, '')}` : ''}), ${mins(seconds)} standing here.${hits}${record}` };
}

module.exports = { netherPiece, RECORD, offers, netherSpare, shieldCost, ironFor, planksFor, armourHad, rateSays, goingWithout, GHAST_PROOF, STONE_KIT, IRON_FOR, WORN_BANDS };
