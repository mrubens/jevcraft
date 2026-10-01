'use strict';
// What is owed at each level, said with every climb up and every way down
// (note 763). Nether reach collapsed on every source world but 242, the one
// whose trials start on the surface with a lava pool at the surface in
// minutes: on the other four the bot starts underground, and before the
// Nether it went between the depth and the surface over and over, a climb
// for the food, down for the lava, up for a log, down for the diamonds.
// 2026-09-30 05:30Z-19:30Z (scripts/portal-time.js --by-world): climbs to
// open sky were 16.9% of the pre-Nether minutes on the hard worlds (1054 of
// 6229) against 1.5% on 242; 289 trips from under y 40 to over y 60 in 132
// trials. mid-237-bc, 86 blocks down with three iron pickaxes, mining
// diamond ore, was offered its food trip as "about 62 seconds in all" and
// climbed for 30 of 80 food points, the diamonds and the lava still owed
// below. Each way up or down now says what is still owed up there and down
// here, and the climb's cost at the bot's own measured pace: which way to
// go, and when, stays Jev's.
const { climbToSurface } = require('./surface');

// The bot's own climbs and descents, measured (scripts/portal-time.js
// heightTrips; descents are runs of frames falling 20 blocks or more).
const LEVEL_RECORD = {
  window: '2026-09-30 05:30Z to 19:30Z',
  climbs: 240, upSecondsABlock: 4.9, // climbs to open sky rising 20 blocks or more, stalls and questions counted
  descents: 843, downSecondsABlock: 3.3,
  // Walks to lava of 32 blocks or more (go_to_landmark, to_lava_for_portal,
  // the fetch's to_lava): the blocks nearer a minute, stalls, detours and
  // walks that never arrived counted; 293 that arrived made 53.6.
  walks: 592, walkBlocksAMinute: 38.5, arrivedBlocksAMinute: 53.6,
};
// Seconds for a walk of so many blocks at the bot's measured pace.
const walkSeconds = blocks => Math.round(blocks / LEVEL_RECORD.walkBlocksAMinute * 60);
const walkPaceSays = () => `the bot's walks to lava of 32 blocks or more made ${LEVEL_RECORD.walkBlocksAMinute} blocks a minute (${LEVEL_RECORD.walks} walks, ${LEVEL_RECORD.window}, stalls and detours counted)`;
const UNDER = 8; // blocks of cover over the head that make a climb out a trip (surface.js, the climb questions)

// Where the ores the ladder wants lie (strategy.js ORE_DEPTH, the same bands).
const ORE = { iron: { from: -24, to: 56, most: 16 }, gold: { from: -64, to: 32, most: -16 }, diamond: { from: -64, to: 16, most: -59 } };
const IRON_FOR = { iron_helmet: 5, iron_chestplate: 8, iron_leggings: 7, iron_boots: 4, iron_pickaxe: 3, iron_sword: 2, bucket: 3, shield: 1 };

const count = (bot, re) => (bot.inventory?.items?.() || []).filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
const words = s => String(s).replaceAll('_', ' ');
const overworld = bot => /overworld/.test(String(bot?.game?.dimension || 'overworld'));

// Blocks of cover over the bot's head, or null where not in the Overworld
// or the column is not loaded.
function depthHere(bot) {
  if (!overworld(bot) || !bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  try { return climbToSurface(bot, bot.entity.position); } catch (_) { return null; }
}
const upSeconds = blocks => Math.round(blocks * LEVEL_RECORD.upSecondsABlock);
const downSeconds = blocks => Math.round(blocks * LEVEL_RECORD.downSecondsABlock);
const minutes = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`;
function climbSays(blocks) {
  return `${blocks} blocks up to open sky: ${minutes(upSeconds(blocks))} at the bot's own pace (${LEVEL_RECORD.upSecondsABlock} seconds a block risen over its ${LEVEL_RECORD.climbs} climbs of 20 blocks or more before the Nether, ${LEVEL_RECORD.window}, the stalls and questions on the way counted), and ${minutes(downSeconds(blocks))} to come back down to this depth (${LEVEL_RECORD.downSecondsABlock} seconds a block over ${LEVEL_RECORD.descents} descents)`;
}

// The iron carried, as ingots, raw iron counted (it smelts one for one).
const ironCarried = bot => count(bot, /^iron_ingot$/) + count(bot, /^raw_iron$/);
const goldCarried = bot => count(bot, /^gold_ingot$/) + count(bot, /^raw_gold$/);
function oreAt(kind, y) {
  const o = ORE[kind];
  return `${kind} ore lies between y ${o.from} and ${o.to}, most around y ${o.most}${y > o.to ? `: ${Math.round(y - o.most)} blocks below here` : y < o.from ? `: above here` : ': at this depth'}`;
}
// The wood the ladder's crafts take: sticks for a pickaxe or a sword, planks
// for a bed or a chest, a crafting table. Logs grow at the surface.
const WOODY = /^(stone_pickaxe|iron_pickaxe|nether_pickaxe|stone_sword|iron_sword|diamond_sword|bed|home_bed|carry_bed|nether_chest|shield)$/;
function woodShort(bot, rungs) {
  if (!rungs.some(r => WOODY.test(r.phase))) return null;
  const logs = count(bot, /_log$|_stem$/), planks = count(bot, /_planks$/), sticks = count(bot, /^stick$/);
  const units = logs + planks / 4 + sticks / 8;
  // A craft or two takes a log's worth; the rungs open want more than that
  // only for a bed or a chest (three and eight planks).
  const wants = rungs.some(r => /bed|chest/.test(r.phase)) ? 3 : 1;
  if (units >= wants) return null;
  return `wood (${Math.floor(units * 10) / 10} logs' worth carried; the ${rungs.filter(r => WOODY.test(r.phase)).map(r => words(r.phase)).slice(0, 3).join(', ')} want${rungs.filter(r => WOODY.test(r.phase)).length === 1 ? 's' : ''} sticks or planks; trees grow at the surface)`;
}

// What the open rungs and the portal still owe, by level: `up` wants the
// surface (animals, sheep, trees), `down` the depth (ore, the lava known
// below). A rung the pockets already cover owes nothing.
// Read once a second a bot: the win_strategy tree says it with each rung
// and again with the Nether now, and each reading scans for lava about.
const OWED_MS = 1000, owedMemo = new WeakMap(), lavaMemo = new WeakMap();
function owed(bot, goal = {}) {
  const memo = bot && typeof bot === 'object' ? owedMemo.get(bot) : null;
  if (memo && memo.goal === goal && Date.now() - memo.at < OWED_MS) return memo.value;
  const value = owedNow(bot, goal);
  if (bot && typeof bot === 'object') owedMemo.set(bot, { goal, at: Date.now(), value });
  return value;
}
// What one rung still owes and at which level: { level: 'up'|'down', says },
// or null where the pockets cover it.
function rungNeed(bot, r, y) {
  if (r.phase === 'nether_food') {
    let cook = 0;
    try { const c = require('./work').cookable(bot); cook = c?.ready ? Math.round(c.after - c.now) : 0; } catch (_) { cook = 0; }
    const short = Math.max(0, (r.wants || 0) - (r.carried || 0) - cook);
    return short > 0 ? { level: 'up', says: `food for the Nether (${r.carried} of ${r.wants} points carried${cook ? `, ${cook} more once the raw food carried is cooked` : ''}; animals and crops are at the surface)` } : null;
  }
  if (/^(bed|home_bed|carry_bed)$/.test(r.phase) && /gather_wool|village_bed/.test(r.action || '')) return { level: 'up', says: r.action === 'village_bed' ? `a bed from the village (at the surface)` : `wool for the ${words(r.phase)} (${r.count || 3} more; sheep are at the surface)` };
  if (r.phase === 'diamond_sword') return count(bot, /^diamond$/) < 2 ? { level: 'down', says: `diamonds for the diamond sword (${count(bot, /^diamond$/)} of 2 carried; ${oreAt('diamond', y)})` } : null;
  if (r.phase === 'golden_boots') return goldCarried(bot) < 4 ? { level: 'down', says: `gold for the golden boots (${goldCarried(bot)} of 4 carried, raw gold counted; ${oreAt('gold', y)})` } : null;
  const items = r.items || (r.item ? [r.item] : []);
  const iron = items.reduce((n, i) => n + (IRON_FOR[i] || 0), 0);
  return iron && ironCarried(bot) < iron ? { level: 'down', says: `iron for the ${words(r.phase)} (${ironCarried(bot)} of ${iron} carried, raw iron counted; ${oreAt('iron', y)})` } : null;
}
function owedNow(bot, goal = {}) {
  const up = [], down = [], of = {}, way = [], optional = [];
  if (!overworld(bot) || !bot?.inventory?.items) return { up, down, of, way, optional };
  const put = (list, phase, says) => { list.push(says); of[phase] = list === up ? 'up' : 'down'; };
  let rungs = [];
  // The ladder's own order, not the level order this feeds (game-progress.js levelOrder).
  try { rungs = require('./game-progress').openRungs(bot, goal, Date.now(), { ordered: false }); } catch (_) { rungs = []; }
  const y = bot.entity?.position?.y ?? 64;
  for (const r of rungs) { const need = rungNeed(bot, r, y); if (need) put(need.level === 'up' ? up : down, r.phase, need.says); }
  const wood = woodShort(bot, rungs);
  if (wood) {
    up.push(wood);
    // A rung whose only want is the wood is a trip up for it (the spare
    // pickaxe's sticks: 20 climbs, 140 minutes, after rung_iron_pickaxe on
    // the hard worlds).
    for (const r of rungs) if (WOODY.test(r.phase) && !of[r.phase]) of[r.phase] = 'up';
  } else {
    // Short of the wood kept for spare pickaxes and a table, taken while up
    // there (note 776): 25598 (mid-241-bp, 2026-10-01 02:50Z) was on the
    // iron pickaxe's step at night underground for one oak log, its stone
    // pickaxe at 3 uses, the surface left with no wood for a spare.
    const reserve = woodReserveShort(bot);
    if (reserve) up.push(reserve);
  }
  const lava = portalLava(bot, goal);
  if (lava) put(lava.level === 'up' ? up : down, 'reach_nether', lava.says);
  // Water and buckets for the cast, owed at either level (note 776): 25590
  // (mid-218-ab, 02:53Z) stood 5 blocks from its chosen lava at y 32,
  // climbed 31 blocks for water, made a bucket at the surface and walked
  // back 49 blocks, about 4 minutes, for one water bucket.
  const water = castWater(bot, goal, lava);
  if (water) way.push(water);
  // What Jev may choose and the ladder does not hand (note 776): said
  // apart, with the level each would take the bot to.
  let opts = [];
  try { opts = require('./game-progress').optionalRungs(bot, goal); } catch (_) { opts = []; }
  for (const r of opts) { const need = rungNeed(bot, r, y); optional.push({ phase: r.phase, level: need?.level || null, says: need?.says || `the ${words(r.phase)} (made from what is carried)` }); }
  return { up, down, of, way, optional };
}
function woodReserveShort(bot) {
  let reserve = 6;
  try { reserve = require('./work').WOOD_RESERVE || 6; } catch (_) { reserve = 6; }
  const units = count(bot, /_log$|_stem$/) + count(bot, /_planks$/) / 4 + count(bot, /^stick$/) / 8;
  if (units >= reserve) return null;
  return `wood toward the ${reserve} logs' worth kept for spare pickaxes and a crafting table (${Math.floor(units * 10) / 10} carried; trees grow at the surface): taken while up there, or each spare pickaxe made below is a climb for its sticks`;
}
// The cast's water: a water bucket carried, or an empty bucket and water to
// fill it, at whichever level the lava is. Null when nothing is owed.
function castWater(bot, goal, lava) {
  if (!lava || goal.portalMethod?.kind === 'ruined' || goal.portalFrame?.ruin) return null;
  const waterB = count(bot, /^water_bucket$/), empty = count(bot, /^bucket$/), lavaB = count(bot, /^lava_bucket$/);
  if (waterB) return null;
  const iron = ironCarried(bot);
  const bucket = empty ? `an empty bucket carried to fill` : iron >= 3 ? `no empty bucket: one is made from 3 of the ${iron} iron carried, raw iron counted` : `no empty bucket and ${iron} of the 3 iron one takes`;
  return `water for the cast (no water bucket carried; ${bucket}${lavaB ? `, ${lavaB} lava bucket${lavaB === 1 ? '' : 's'} carried` : ''}): water lies in lakes and rivers at the surface and in springs and aquifers underground, and is filled at whichever level is passed first on the way to the lava, not on a trip of its own`;
}

// The plan by level (note 776): the needs owed at each level, the order
// that visits each once, and the portal cast at the level of its lava. The
// level the portal is not cast at goes first; with no lava owed, the level
// the bot is at goes first. -> { here, last, of, up, down, way, optional, says }
function levelPlan(bot, goal = {}) {
  const depth = depthHere(bot);
  if (depth === null) return null;
  const o = owed(bot, goal);
  const here = depth >= UNDER ? 'down' : 'up', lava = o.of.reach_nether || null;
  const last = lava || (here === 'up' ? 'down' : 'up'), first = last === 'up' ? 'down' : 'up';
  const name = l => l === 'up' ? 'the surface' : 'depth';
  // Short names for the plan's order; the needs in full are said beside it.
  const list = l => [...Object.entries(o.of).filter(([p, at]) => at === l && p !== 'reach_nether').map(([p]) => words(p)),
    ...((l === 'up' ? o.up : o.down).some(x => /^wood/.test(x)) ? ['wood'] : []), ...(lava === l ? ['the portal\'s lava'] : [])];
  const parts = [];
  if (list(first).length) parts.push(`${name(first)} first, once, for all of it (${list(first).join(', ')})`);
  if (list(last).length) parts.push(`${parts.length ? 'then ' : ''}${name(last)}, once (${list(last).join(', ')})${lava ? `, the portal cast there beside its lava` : ''}`);
  const trip = list(first).length && here === last ? ` The bot is at ${name(last)} now: ${name(first)}'s needs are one trip there and back before the portal, all of them in it.` : '';
  const way = o.way.length ? ` On the way, at either level: ${o.way.join('; ')}.` : '';
  const opt = o.optional.length ? ` Optional, not owed (the ladder does not hand them; each is on offer with its minutes and its record): ${o.optional.map(x => `${x.says}${x.level ? ` [${name(x.level)}]` : ''}`).join('; ')}.` : '';
  const says = parts.length ? `The plan by level: ${parts.join('; ')}.${trip}${way}${opt}` : `${way}${opt}`.trim();
  return { here, last, of: o.of, up: o.up, down: o.down, way: o.way, optional: o.optional, says };
}

// The lava the portal still wants, and where the lava known is: none owed
// once a portal is known in the Overworld or the Nether is entered.
function portalLava(bot, goal = {}) {
  if ((goal.portals || []).some(p => p.dimension === 'overworld') || goal.gameProgress?.milestones?.nether_entered) return null;
  const obsidian = count(bot, /^obsidian$/), buckets = count(bot, /^lava_bucket$/);
  const placed = Number.isFinite(goal.portalFrame?.placedSeen) ? goal.portalFrame.placedSeen : 0;
  const wants = Math.max(0, 10 - obsidian - buckets - placed);
  if (!wants) return null;
  const here = bot.entity?.position;
  // The lava scan once a second a bot (note 776): the ladder's level order
  // reads this on copies of the goal (takeBackRungs' probes), each a miss in
  // owed's memo, and a scan for lava is a findBlocks.
  let lava = null;
  const memo = bot && typeof bot === 'object' ? lavaMemo.get(bot) : null;
  if (memo && Date.now() - memo.at < OWED_MS && memo.frame === (goal.portalFrame?.origin ? JSON.stringify(goal.portalFrame.origin) : null)) lava = memo.value;
  else {
    try { lava = require('./work').nearestLava(bot, goal); } catch (_) { lava = null; }
    if (bot && typeof bot === 'object') lavaMemo.set(bot, { at: Date.now(), value: lava, frame: goal.portalFrame?.origin ? JSON.stringify(goal.portalFrame.origin) : null });
  }
  const depth = depthHere(bot) ?? 0, top = (here?.y ?? 64) + depth;
  const at = lava?.at ? lava.at : { y: require('./obsidian').LAVA_DEPTH };
  const level = at.y >= top - UNDER ? 'up' : 'down';
  const where = lava?.at ? `the lava known is ${lava.distance} blocks off at y ${Math.round(at.y)} (${lava.how})` : `no lava is known; the deep lava lies at y ${at.y}`;
  return { level, wants, says: `lava for the portal (${wants} bucket${wants === 1 ? '' : 's'} still to fetch; ${where})` };
}

// The pickaxes the depth would be worked with (note 763b): 25583 went down
// to y 16 for lava with a wooden pickaxe, never made the stone one from the
// cobblestone it dug, and dug its way out by hand.
function pickSays(bot) {
  const picks = (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name)).map(i => {
    const max = bot.registry?.itemsByName?.[i.name]?.maxDurability;
    return { name: i.name, usesLeft: max ? Math.max(0, max - (i.durabilityUsed || 0)) : null };
  });
  const cobble = count(bot, /^(cobblestone|cobbled_deepslate|blackstone)$/), ingots = count(bot, /^iron_ingot$/);
  const best = Math.max(0, ...picks.map(p => ['wooden', 'stone', 'iron', 'diamond', 'netherite'].indexOf(p.name.split('_')[0]) + 1));
  const makes = best < 3 && ingots >= 3 ? ' The iron carried makes an iron pickaxe first (three ingots and two sticks).' : best < 2 && cobble >= 3 ? ` The ${cobble} cobblestone carried makes a stone pickaxe first (three and two sticks).` : '';
  const list = picks.length ? picks.map(p => `${words(p.name)}${p.usesLeft != null ? ` (${p.usesLeft} uses left)` : ''}`).join(', ') : 'none';
  const tier = !picks.length ? ' With none, every block down there is dug by hand.' : best < 2 ? ' A wooden pickaxe mines stone and coal only, slowly, not iron, gold or diamond.' : best < 3 ? ' A stone pickaxe mines iron but not gold or diamond.' : '';
  return ` Pickaxes carried for the depth: ${list}.${tier}${makes}`;
}

// The sentence said with a climb or a way down: the height, the pace, and
// what is owed at each level. `going` is 'up' (a climb out) or 'down'.
function levelsSays(bot, goal = {}, { going = null } = {}) {
  const depth = depthHere(bot);
  if (depth === null) return '';
  const { up, down } = owed(bot, goal);
  const plan = levelPlan(bot, goal);
  const planSays = plan?.says ? ` ${plan.says}` : '';
  if (!up.length && !down.length) return planSays;
  const under = depth >= UNDER;
  const upSaid = up.length ? `Owed at the surface${under ? ' (up there)' : ''}: ${up.join('; ')}.` : `Nothing open is owed at the surface${under ? ' up there' : ''}.`;
  const downSaid = down.length ? `Owed at depth${under ? ' (down here or below)' : ' (below)'}: ${down.join('; ')}.` : `Nothing open is owed at depth${under ? ' down here' : ''}.`;
  const climb = under ? ` The bot is ${climbSays(depth)}.` : '';
  const once = up.length && down.length ? ' Each level\'s needs done in one visit is one climb between them; each need done on its own is a climb each.'
    : going === 'up' && !up.length && down.length ? ' A climb up now leaves every one of those owed below.'
      : going === 'down' && up.length && !down.length ? ' A way down now leaves every one of those owed up top.' : '';
  return ` ${upSaid} ${downSaid}${down.length || going === 'down' ? pickSays(bot) : ''}${climb}${once}${planSays}`;
}

// A trip at the surface priced from here: the climb first when the bot is
// under cover, and back down after when the trip comes back here. Seconds,
// and the words for it; nothing when the bot is at the surface.
function surfaceLeg(bot, { back = true } = {}) {
  const depth = depthHere(bot);
  if (!(depth >= UNDER)) return { seconds: 0, says: '' };
  const seconds = upSeconds(depth) + (back ? downSeconds(depth) : 0);
  return { seconds, depth, says: `the climb to open sky first, ${depth} blocks up, ${minutes(upSeconds(depth))} at the bot's own pace${back ? `, and ${minutes(downSeconds(depth))} back down to this depth after` : ''}` };
}

// A rung's own level, said with its option where it is not the level the
// bot is at: its gathering up top from under cover (the climb, and what is
// owed down here), or at depth from the surface (and what is owed up here).
function rungLevelSays(bot, goal, phase) {
  const depth = depthHere(bot);
  if (depth === null) return '';
  const { up, down, of } = owed(bot, goal);
  const level = of[phase];
  if (!level) return '';
  const under = depth >= UNDER;
  if (level === 'up' && under) return ` Its gathering is at the surface: the bot is ${climbSays(depth)}.${down.length ? ` Still owed at depth, a way back down after it: ${down.join('; ')}.` : ''}`;
  if (level === 'down' && !under) return ` Its gathering is at depth.${pickSays(bot)}${up.length ? ` Still owed at the surface, a climb back up after it: ${up.join('; ')}.` : ''}`;
  return '';
}

module.exports = { levelPlan, rungNeed, castWater, woodReserveShort, IRON_FOR, pickSays, walkSeconds, walkPaceSays, rungLevelSays,  LEVEL_RECORD, UNDER, depthHere, upSeconds, downSeconds, climbSays, owed, portalLava, levelsSays, surfaceLeg, woodShort };
