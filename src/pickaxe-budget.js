'use strict';
// What the pickaxes carried have left against the digging ahead: the step
// in hand's blocks and the way home to open sky after it, with the wood
// and the heads for another carried or not, and the nearest wood known.
// Said to Jev where the choice is made (upkeep, surface_trip, the ladder's
// pickaxe rungs), not kept as a threshold. mid-231-r crossed 226 uses of
// iron pickaxe into a staircase down to lava at y -11, 42 blocks below it
// and 74 under open sky, with no log, plank or stick: the step and the
// climb back were some 350 digs, nobody was told, and the last pickaxe
// broke at y 20 on the way up (note 538). mid-220-h's iron pickaxe, at 12
// uses 66 blocks down, was counted worn and climbed on unasked (note 531).
const { Vec3 } = require('vec3');

const words = s => String(s || '').replaceAll('_', ' ');
const LOG = /_log$|_stem$/;
const HEADS = { iron_pickaxe: /^iron_ingot$/, stone_pickaxe: /^(cobblestone|cobbled_deepslate|blackstone)$/ };
// By hand a stair digs three blocks at about seven and a half seconds each
// (surface.js climbOptions): the 24 seconds a stair mid-231-r climbed at.
const HAND_STAIR_SECONDS = 24;

// Raw iron carried is iron ingots wherever a furnace and fuel are carried:
// a furnace set down smelts three in about thirty seconds, so an iron head
// (250 uses) is in the pockets, not only the ingots. 25593 (mid-242-xd,
// 2026-09-30) carried 15 raw iron, two furnaces and 150 coal through two
// hours of the fortress search and made nineteen wooden pickaxes (59 uses
// each), fetching stems for them between legs; of 952 Nether minutes with
// no pickaxe since 2026-09-29 23Z, 485 were with raw iron, a furnace and
// fuel carried (scripts/search-efficiency.js, note 751).
const FUEL = /^(coal|charcoal|coal_block|lava_bucket)$/;
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const SMELT_SECONDS = 10;
function smeltableIron(bot) {
  const items = bot?.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const raw = sum(/^raw_iron$/), furnace = sum(/^furnace$/) > 0, fuel = items.filter(i => FUEL.test(i.name));
  if (raw < 3 || !furnace || !fuel.length) return { raw, ingots: 0, furnace, fuel: fuel.map(i => i.name), says: '' };
  const fuelSaid = words(fuel[0].name);
  return { raw, ingots: raw, furnace, fuel: fuel.map(i => i.name),
    says: `${raw} raw iron, smelted in the furnace carried with the ${fuelSaid} carried (about ${SMELT_SECONDS} seconds an ingot)` };
}

function usesOf(bot, item) {
  const max = bot.registry?.itemsByName?.[item.name]?.maxDurability;
  return max ? max - (item.durabilityUsed || 0) : Infinity;
}

// The pickaxes that can be made from the pockets as they are: two sticks
// each, from sticks, planks (two make four) or logs (one makes four
// planks), a table carried or four planks for one, and three ingots or
// three cobblestone a head.
function makeable(bot) {
  const items = bot.inventory?.items?.() || [];
  const sum = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = sum(LOG), planks = sum(/_planks$/), sticks = sum(/^stick$/), table = sum(/^crafting_table$/) > 0;
  const plankUnits = planks + logs * 4 - (table ? 0 : 4);
  const stickPairs = plankUnits < 0 ? 0 : Math.floor((sticks + Math.floor(plankUnits / 2) * 4) / 2);
  const heads = Object.fromEntries(Object.entries(HEADS).map(([k, re]) => [k, Math.floor(sum(re) / 3)]));
  heads.iron_pickaxe = Math.floor((sum(HEADS.iron_pickaxe) + smeltableIron(bot).ingots) / 3);
  const kinds = Object.keys(HEADS).filter(k => heads[k] > 0);
  const count = Math.min(stickPairs, heads.iron_pickaxe + heads.stone_pickaxe);
  // The wood short of the first one, in planks: a table (four) unless one
  // is carried, and two for the sticks unless two are (mid-243-ga was one
  // plank short, 72 blocks under the nearest tree, note 671).
  const plankShort = Math.max(0, (table ? 0 : 4) + (sticks >= 2 ? 0 : 2) - planks - logs * 4);
  const lacks = !stickPairs ? `no sticks can be made (${logs} logs, ${planks} planks, ${sticks} sticks${table || plankUnits >= 0 ? '' : ', and no table or wood for one'})${plankShort ? `: ${plankShort} plank${plankShort === 1 ? '' : 's'} short of ${table ? 'two sticks' : 'a crafting table and two sticks'}, ${Math.ceil(plankShort / 4)} log${plankShort > 4 ? 's' : ''} of any wood` : ''}`
    : !kinds.length ? 'no head can be made (3 iron ingots or 3 cobblestone)' : '';
  return { count, kinds, logs, planks, sticks, table, lacks, plankShort, wood: Math.floor((logs + planks / 4 + sticks / 8) * 10) / 10 };
}

// Blocks a step would dig from here to its target, if all of it is rock:
// a stair down or up digs three, a block across two. Caves on the way dig
// less; said as "up to".
function stepDigs(bot, goal) {
  const step = goal?.step, t = step?.target || step?.at;
  if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z) || !bot.entity?.position) return null;
  const feet = bot.entity.position.floored();
  const dy = Math.abs(feet.y - t.y), across = Math.hypot(t.x - feet.x, t.z - feet.z);
  const digs = 3 * dy + 2 * Math.max(0, Math.round(across) - dy) + (step.action === 'mine' ? (step.count || 1) : 0);
  const what = step.action === 'tunnel' || step.action === 'to_lava_for_portal' ? `the way to ${t.x}, ${t.y}, ${t.z}${step.toward ? ` (${words(step.toward)})` : ''}`
    : `the ${words(step.block || step.item || step.action)} at ${t.x}, ${t.y}, ${t.z}`;
  return { what, digs, endY: t.y };
}

// The nearest wood the bot knows of: logs within the loaded world near it,
// or remembered where seen (resource-observation.js).
function nearestWood(bot, goal) {
  const here = bot.entity?.position;
  if (!here) return null;
  const found = [];
  try {
    if (typeof bot.findBlocks === 'function' && bot.registry?.blocksArray) {
      const ids = bot.registry.blocksArray.filter(b => LOG.test(b.name)).map(b => b.id);
      for (const p of bot.findBlocks({ matching: ids, maxDistance: 64, count: 4 }) || []) found.push({ p, name: bot.blockAt?.(p)?.name, how: 'seen' });
    }
  } catch (_) { /* nothing in view */ }
  const dim = bot.game?.dimension || 'overworld';
  for (const e of Object.values(goal?.resourceMemory || {})) {
    if (e.dimension !== dim || !LOG.test(e.name || '') || Date.now() - (e.seenAt || 0) > 1800000) continue;
    found.push({ p: new Vec3(e.position.x, e.position.y, e.position.z), name: e.name, how: 'remembered' });
  }
  const near = found.filter(f => f.p).sort((a, b) => a.p.distanceTo(here) - b.p.distanceTo(here))[0];
  if (!near) return null;
  const rise = Math.round(near.p.y - here.y);
  return { distance: Math.round(near.p.distanceTo(here)), up: rise, name: near.name || 'log', how: near.how,
    says: `the nearest wood known is ${words(near.name || 'a log')} ${Math.round(near.p.distanceTo(here))} blocks off${rise >= 2 ? `, ${rise} up` : rise <= -2 ? `, ${-rise} down` : ''} (${near.how === 'seen' ? 'in the world loaded about here' : 'seen earlier'})` };
}

function pickaxeBudget(bot, goal = {}, { look = true } = {}) {
  if (!bot?.inventory?.items || !bot.entity?.position) return null;
  const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => ({ name: i.name, uses: usesOf(bot, i) }));
  const usesLeft = picks.reduce((n, p) => n + (Number.isFinite(p.uses) ? p.uses : 0), 0);
  const feet = bot.entity.position.floored();
  const overworld = /overworld/.test(String(bot.game?.dimension || 'overworld'));
  let up = null;
  if (overworld && typeof bot.blockAt === 'function') { try { up = require('./surface').climbToSurface(bot, feet); } catch (_) { up = null; } }
  const ahead = stepDigs(bot, goal);
  const skyY = Number.isFinite(up) ? feet.y + up : null;
  const homeUp = skyY === null ? null : Math.max(0, skyY - (ahead ? ahead.endY : feet.y));
  const home = homeUp === null ? null : { up: homeUp, straight: homeUp, stairs: 3 * homeUp };
  const aheadDigs = ahead?.digs || 0;
  // The stairs are the way out a climb usually takes (straight up needs the
  // column clear and a block a step); short is said against them.
  const need = aheadDigs + (home?.stairs || 0), short = picks.length > 0 && need > 0 && usesLeft < need;
  const wood = makeable(bot), known = look ? nearestWood(bot, goal) : null;
  const list = picks.length ? picks.map(p => `${words(p.name)} (${Number.isFinite(p.uses) ? `${p.uses} uses left` : 'uses unknown'})`).join(', ') : 'none';
  const parts = [`Pickaxes carried: ${list}${picks.length > 1 ? `, ${usesLeft} uses in all` : ''}.`];
  if (ahead) parts.push(`The step in hand digs up to about ${ahead.digs} blocks on ${ahead.what} if it is all rock.`);
  if (home && home.up >= 4) parts.push(`The way home from ${ahead ? 'there' : 'here'} is ${home.up} blocks up to open sky: about ${home.straight} digs straight up the column, ${home.stairs} by stairs.`);
  if (short) {
    const gap = need - usesLeft;
    parts.push(`That is ${gap} more digs than the uses carried: the last ${gap} by hand, about ${Math.round(gap / 3 * HAND_STAIR_SECONDS / 60)} minutes at ${HAND_STAIR_SECONDS} seconds a stair, unless another pickaxe is made first.`);
  } else if (need > 0 && picks.length) parts.push(`The uses carried cover it, ${usesLeft - need} to spare.`);
  parts.push(wood.count ? `The pockets make ${wood.count} more pickaxe${wood.count === 1 ? '' : 's'} (${wood.kinds.map(words).join(' or ')}).`
    : `No other pickaxe can be made from the pockets: ${wood.lacks}.`);
  if (!wood.count && !(wood.logs || wood.planks || wood.sticks)) parts.push(known ? `No wood carried; ${known.says}.` : `No wood carried, and none known${Number.isFinite(up) && up >= 4 ? `; open sky is ${up} blocks up from here` : ''}.`);
  else if (known && wood.wood < 1) parts.push(`${known.says[0].toUpperCase()}${known.says.slice(1)}.`);
  return { picks, usesLeft, up, ahead, home, need, short, wood, nearestWood: known, says: parts.join(' ') };
}

// Wear as a fact before the pickaxe breaks (note 687). Of the Nether bots
// that lost their last pickaxe on 2026-09-29, most wore it through on the
// fortress search's legs, crossings and staircases (25589's iron one from
// 117 uses to 3 in ten minutes, wooden ones from 59 to 2), no spare offered
// (spareDue wanted cobblestone) and nothing said of the wear until it
// broke. The uses carried are sampled every half minute over a quarter of
// an hour, a new pickaxe starting them again; the rate is what they were
// spent at, and how long the rest lasts at it.
const WEAR_SAMPLE_MS = 30000, WEAR_KEEP_MS = 15 * 60000, WEAR_MIN_MS = 2 * 60000;
function wearOf(bot, goal, now = Date.now()) {
  const picks = (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
  if (!picks.length) return null;
  const uses = picks.reduce((n, i) => { const u = usesOf(bot, i); return n + (Number.isFinite(u) ? u : 0); }, 0);
  const w = goal ? (goal.pickaxeWear ||= { samples: [] }) : { samples: [] };
  const last = w.samples.at(-1);
  if (last && uses > last.uses) w.samples = [];
  if (!w.samples.length || now - w.samples.at(-1).at >= WEAR_SAMPLE_MS) w.samples.push({ at: now, uses });
  w.samples = w.samples.filter(x => now - x.at <= WEAR_KEEP_MS).slice(-40);
  const first = w.samples[0] || { at: now, uses };
  const spent = first.uses - uses, minutes = (now - first.at) / 60000;
  const rate = now - first.at >= WEAR_MIN_MS && spent > 0 ? spent / minutes : null;
  return { count: picks.length, uses, spent, minutes, rate, lastsMinutes: rate ? uses / rate : null };
}
// The wear said, with whether another can be made from the pockets (the
// best head carried, wood for the sticks and a table: mob-hunt.js
// bestMakeable).
function wearSays(bot, goal, now = Date.now()) {
  const w = wearOf(bot, goal, now);
  if (!w) return '';
  let spare = null;
  try { spare = require('./mob-hunt').bestMakeable(bot); } catch (_) { spare = null; }
  const mins = n => `${n} minute${n === 1 ? '' : 's'}`;
  const rate = w.rate ? `; ${w.spent} used in the last ${mins(Math.max(1, Math.round(w.minutes)))}, at which rate ${w.count === 1 ? 'it lasts' : 'they last'} about ${mins(Math.max(1, Math.round(w.lastsMinutes)))} more` : '';
  const more = spare && !spare.none ? `the pockets make another (${spare.name.replace(/^an? /, '')} from ${spare.from})` : 'no other can be made from the pockets';
  const picks = (bot.inventory.items() || []).filter(i => /_pickaxe$/.test(i.name)).map(i => { const u = usesOf(bot, i); return `${words(i.name)}${Number.isFinite(u) ? `, ${u} uses left` : ''}`; });
  // What the fortress search's legs cost, its own record where it has one,
  // else the fleet's (note 751).
  const legs = (goal?.fortressSearch?.legWear || []).filter(Number.isFinite);
  const legSays = inNether(bot) ? (legs.length ? `; the search's last ${legs.length} leg${legs.length === 1 ? '' : 's'} spent about ${Math.round(legs.reduce((a, b) => a + b, 0) / legs.length)} uses each` : `; a fortress search's leg spends about ${LEG_WEAR_RECORD.perLeg} uses in the record`) : '';
  return `${picks.join('; ')}${w.count === 1 ? ' (the only one carried)' : `, ${w.uses} uses in all`}${rate}${legSays}; ${more}`;
}
// On a way that digs with the last pickaxe, none other to be made: the
// blocks it digs against the uses left. '' otherwise.
function lastPickaxeSays(bot, digs) {
  if (!(digs > 0)) return '';
  const picks = (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
  if (picks.reduce((n, i) => n + i.count, 0) !== 1) return '';
  let spare = null;
  try { spare = require('./mob-hunt').bestMakeable(bot); } catch (_) { spare = null; }
  if (spare && !spare.none) return '';
  const uses = usesOf(bot, picks[0]);
  if (!Number.isFinite(uses)) return '';
  return ` It digs about ${digs} blocks with the one pickaxe carried, ${uses} uses left, no other to be made from the pockets${digs >= uses ? `: it breaks on the way, the rest dug by hand and dropping nothing` : `: ${uses - digs} left after`}.`;
}

// What the fortress search's legs cost the pickaxes, in the record and in
// this search's own: the uses carried said against them, and what each way
// to another pickaxe gives (note 751, the reviewer's check-in of 2026-09-30
// 11:02Z: tools are a budget). Measured over the flight records since
// 2026-09-29 23Z (scripts/search-efficiency.js): 32,339 uses over 1,263 legs,
// a mean of 26 a leg (three in four under 23, the rest through rock), 12.9
// a minute of leg walked; and 153 wooden pickaxes made in the Nether, 66 of
// them with raw iron, a furnace and fuel carried.
const LEG_WEAR_RECORD = { perLeg: 26, perMinute: 13, legs: 1263, since: '2026-09-29 23Z' };
const USES = { wooden_pickaxe: 59, golden_pickaxe: 32, stone_pickaxe: 131, copper_pickaxe: 190, iron_pickaxe: 250, diamond_pickaxe: 1561, netherite_pickaxe: 2031 };
const usesCarried = bot => (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name)).reduce((n, i) => { const u = usesOf(bot, i); return n + (Number.isFinite(u) ? u : 0); }, 0);
// Kept on the search's state at each leg asked: what the last one spent (the
// uses carried when it began against now; a pickaxe made meanwhile makes it
// unknown and it is not kept), the last eight.
function noteLegWear(bot, state) {
  const now = usesCarried(bot);
  if (Number.isFinite(state.legUsesFrom) && state.legUsesFrom >= now) {
    (state.legWear ||= []).push(state.legUsesFrom - now);
    state.legWear = state.legWear.slice(-8);
  }
  state.legUsesFrom = now;
  return now;
}
function legBudgetSays(bot, state = {}) {
  const picks = (bot?.inventory?.items?.() || []).filter(i => /_pickaxe$/.test(i.name));
  const uses = usesCarried(bot);
  const own = (state.legWear || []).filter(Number.isFinite);
  const mean = own.length ? Math.round(own.reduce((a, b) => a + b, 0) / own.length) : null;
  const perLeg = mean ?? LEG_WEAR_RECORD.perLeg;
  const carried = picks.length ? `${uses} pickaxe uses carried (${picks.map(i => { const u = usesOf(bot, i); return `${words(i.name)} ${Number.isFinite(u) ? u : '?'}`; }).join(', ')})` : 'No pickaxe carried';
  const record = own.length ? `this search's last ${own.length} leg${own.length === 1 ? '' : 's'} spent ${own.join(', ')} uses (about ${mean} a leg)` :
    `the fortress search's legs have spent about ${LEG_WEAR_RECORD.perLeg} uses a leg in the record (${LEG_WEAR_RECORD.perMinute} a minute walked, ${LEG_WEAR_RECORD.legs} legs since ${LEG_WEAR_RECORD.since})`;
  const lasts = picks.length ? (perLeg > 0 ? `: at that the uses carried last about ${Math.max(0, Math.round(uses / perLeg * 10) / 10)} leg${uses / perLeg === 1 ? '' : 's'}` : ': the legs lately dug nothing') : '';
  let spare = null;
  try { spare = require('./mob-hunt').bestMakeable(bot); } catch (_) { spare = null; }
  const next = spare && !spare.none && spare.item ? ` The pockets make ${spare.name} next (${spare.from}), about ${USES[spare.item] || '?'} uses.` : spare?.short ? ` None can be made from the pockets: short of ${spare.short.planks} plank${spare.short.planks === 1 ? '' : 's'} for ${spare.short.for || 'it'}, then ${spare.short.then}.` : '';
  const iron = smeltableIron(bot), ingots = (bot?.inventory?.items?.() || []).filter(i => i.name === 'iron_ingot').reduce((n, i) => n + i.count, 0);
  const ironSays = ingots + iron.ingots >= 3 ? ` Iron for ${Math.floor((ingots + iron.ingots) / 3)} iron pickaxe${Math.floor((ingots + iron.ingots) / 3) === 1 ? '' : 's'} is carried (${[ingots && `${ingots} ingots`, iron.ingots && iron.says].filter(Boolean).join(', ')}), 250 uses each against 59 for a wooden one; each wants two sticks (a plank's worth).` : '';
  return `${carried}; ${record}${lasts}.${next}${ironSays}`;
}

module.exports = { LEG_WEAR_RECORD, USES, usesCarried, noteLegWear, legBudgetSays, smeltableIron, SMELT_SECONDS, pickaxeBudget, makeable, stepDigs, nearestWood, wearOf, wearSays, lastPickaxeSays, HAND_STAIR_SECONDS };
