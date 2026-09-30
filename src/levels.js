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
const OWED_MS = 1000, owedMemo = new WeakMap();
function owed(bot, goal = {}) {
  const memo = bot && typeof bot === 'object' ? owedMemo.get(bot) : null;
  if (memo && memo.goal === goal && Date.now() - memo.at < OWED_MS) return memo.value;
  const value = owedNow(bot, goal);
  if (bot && typeof bot === 'object') owedMemo.set(bot, { goal, at: Date.now(), value });
  return value;
}
function owedNow(bot, goal = {}) {
  const up = [], down = [], of = {};
  if (!overworld(bot) || !bot?.inventory?.items) return { up, down, of };
  const put = (list, phase, says) => { list.push(says); of[phase] = list === up ? 'up' : 'down'; };
  let rungs = [];
  try { rungs = require('./game-progress').openRungs(bot, goal); } catch (_) { rungs = []; }
  const y = bot.entity?.position?.y ?? 64;
  for (const r of rungs) {
    if (r.phase === 'nether_food') {
      let cook = 0;
      try { const c = require('./work').cookable(bot); cook = c?.ready ? Math.round(c.after - c.now) : 0; } catch (_) { cook = 0; }
      const short = Math.max(0, (r.wants || 0) - (r.carried || 0) - cook);
      if (short > 0) put(up, r.phase, `food for the Nether (${r.carried} of ${r.wants} points carried${cook ? `, ${cook} more once the raw food carried is cooked` : ''}; animals and crops are at the surface)`);
    } else if (/^(bed|home_bed|carry_bed)$/.test(r.phase) && /gather_wool|village_bed/.test(r.action || '')) {
      put(up, r.phase, r.action === 'village_bed' ? `a bed from the village (at the surface)` : `wool for the ${words(r.phase)} (${r.count || 3} more; sheep are at the surface)`);
    } else if (r.phase === 'diamond_sword' && count(bot, /^diamond$/) < 2) {
      put(down, r.phase, `diamonds for the diamond sword (${count(bot, /^diamond$/)} of 2 carried; ${oreAt('diamond', y)})`);
    } else if (r.phase === 'golden_boots' && goldCarried(bot) < 4) {
      put(down, r.phase, `gold for the golden boots (${goldCarried(bot)} of 4 carried, raw gold counted; ${oreAt('gold', y)})`);
    } else {
      const items = r.items || (r.item ? [r.item] : []);
      const iron = items.reduce((n, i) => n + (IRON_FOR[i] || 0), 0);
      if (iron && ironCarried(bot) < iron) put(down, r.phase, `iron for the ${words(r.phase)} (${ironCarried(bot)} of ${iron} carried, raw iron counted; ${oreAt('iron', y)})`);
    }
  }
  const wood = woodShort(bot, rungs);
  if (wood) {
    up.push(wood);
    // A rung whose only want is the wood is a trip up for it (the spare
    // pickaxe's sticks: 20 climbs, 140 minutes, after rung_iron_pickaxe on
    // the hard worlds).
    for (const r of rungs) if (WOODY.test(r.phase) && !of[r.phase]) of[r.phase] = 'up';
  }
  const lava = portalLava(bot, goal);
  if (lava) put(lava.level === 'up' ? up : down, 'reach_nether', lava.says);
  return { up, down, of };
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
  let lava = null;
  try { lava = require('./work').nearestLava(bot, goal); } catch (_) { lava = null; }
  const depth = depthHere(bot) ?? 0, top = (here?.y ?? 64) + depth;
  const at = lava?.at ? lava.at : { y: require('./obsidian').LAVA_DEPTH };
  const level = at.y >= top - UNDER ? 'up' : 'down';
  const where = lava?.at ? `the lava known is ${lava.distance} blocks off at y ${Math.round(at.y)} (${lava.how})` : `no lava is known; the deep lava lies at y ${at.y}`;
  return { level, wants, says: `lava for the portal (${wants} bucket${wants === 1 ? '' : 's'} still to fetch; ${where})` };
}

// The sentence said with a climb or a way down: the height, the pace, and
// what is owed at each level. `going` is 'up' (a climb out) or 'down'.
function levelsSays(bot, goal = {}, { going = null } = {}) {
  const depth = depthHere(bot);
  if (depth === null) return '';
  const { up, down } = owed(bot, goal);
  if (!up.length && !down.length) return '';
  const under = depth >= UNDER;
  const upSaid = up.length ? `Owed at the surface${under ? ' (up there)' : ''}: ${up.join('; ')}.` : `Nothing open is owed at the surface${under ? ' up there' : ''}.`;
  const downSaid = down.length ? `Owed at depth${under ? ' (down here or below)' : ' (below)'}: ${down.join('; ')}.` : `Nothing open is owed at depth${under ? ' down here' : ''}.`;
  const climb = under ? ` The bot is ${climbSays(depth)}.` : '';
  const once = up.length && down.length ? ' Each level\'s needs done in one visit is one climb between them; each need done on its own is a climb each.'
    : going === 'up' && !up.length && down.length ? ' A climb up now leaves every one of those owed below.'
      : going === 'down' && up.length && !down.length ? ' A way down now leaves every one of those owed up top.' : '';
  return ` ${upSaid} ${downSaid}${climb}${once}`;
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
  if (level === 'down' && !under) return ` Its gathering is at depth.${up.length ? ` Still owed at the surface, a climb back up after it: ${up.join('; ')}.` : ''}`;
  return '';
}

module.exports = { walkSeconds, walkPaceSays, rungLevelSays,  LEVEL_RECORD, UNDER, depthHere, upSeconds, downSeconds, climbSays, owed, portalLava, levelsSays, surfaceLeg, woodShort };
