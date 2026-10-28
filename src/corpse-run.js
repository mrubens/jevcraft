'use strict';
// Back for what a death dropped, as a player goes. With the kit restore off
// (2026-09-23), every death cost the iron kit, the sword, the rods and the
// pearls: the survival layer's own pickup only looks within 128 blocks of
// the respawn and for half a minute, and most deaths are far from the bed.
// Dropped items only age while their chunk is loaded, so a death far from
// the respawn keeps its drops until the bot comes near again; one close to
// the respawn has the game's five minutes from the death.
//
// A death in the Nether waits for the next Nether trip (the ladder goes
// back there for its rods anyway, in a kit made again first); nothing is
// fetched from the End, where drops fall into the void.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, countOf } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');

// Beds, wool, wood, raw meat and coal are on the list too (note 2338): whether a walk back is worth it is Jev's, told
// what is there and how far. full-14 (25588, 2026-10-28 04:47Z) died 135 blocks from where it came back to life with
// a bed, 9 mutton, 8 spruce logs, coal and wool, none on the list; the walk back was never asked. The user, watching:
// 'The jev I'm watching is just hiding instead of trying to recover loot'.
const WORTH = /^(diamond|emerald|iron_ingot|gold_ingot|raw_iron|raw_gold|blaze_rod|blaze_powder|ender_pearl|ender_eye|obsidian|shield|bow|crossbow|arrow|bucket|water_bucket|lava_bucket|flint_and_steel|golden_apple|enchanted_golden_apple|trial_key|ominous_trial_key|ancient_debris|netherite_ingot|netherite_scrap|diamond_block|iron_block|gold_block|golden_carrot|cooked_beef|cooked_porkchop|cooked_mutton|bread|cooked_chicken|cooked_cod|cooked_salmon|cooked_rabbit|beef|porkchop|mutton|chicken|rabbit|cod|salmon|coal|charcoal|crafting_table|furnace|chest)$|_(helmet|chestplate|leggings|boots|sword|pickaxe|axe|bed|wool|log|stem|planks)$/;
const CHEAP = /^(wooden|stone)_(sword|pickaxe|axe)$/;
// Drops age while their chunk ticks: within the server's simulation distance
// of a player, 10 chunks on the trial servers (server.properties), so up to
// 176 blocks by chunk edges (note 2115; it was 128, and drops 128 to 176
// blocks from the respawn were counted as not ageing while they were).
const TICKING = 176, DESPAWN_MS = 5 * 60000, MARGIN_MS = 20000, KEEP_MS = 12 * 3600000 /* drops the bot is not near do not age: this bounds the list, not the drops */, LEG_MS = 120000, ARRIVE = 6, FAR = 96, LEG = 64, TURNS = [0, 50, -50, 90, -90];
const ARMOUR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
const dim = name => String(name || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
// Three dimensions: a death in a mine under the bed is not beside the bed.
const flat = (a, b) => Math.hypot(a.x - b.x, (a.y ?? b.y) - (b.y ?? a.y), a.z - b.z);

// What making the dropped things again takes, said beside leaving them:
// 25594 (2026-10-04 06:17Z), asked to go 853 blocks back for twelve eyes of
// ender, a diamond sword and its iron armor against 'what was dropped is
// made again, or found, later', left them at 0.56 to 0.42. The eyes were
// ninety hours of the run.
const TOLD = 7;
function madeAgain(items = {}) {
  const out = [];
  const n = name => items[name] || 0;
  const eyes = n('ender_eye'), pearls = n('ender_pearl') + eyes, rods = n('blaze_rod') + Math.ceil((eyes + n('blaze_powder')) / 2);
  if (pearls) out.push(`${pearls} ender pearl${pearls > 1 ? 's' : ''} from endermen or piglin barter`);
  if (rods) out.push(`${rods} blaze rod${rods > 1 ? 's' : ''} from a fortress's blazes`);
  const iron = ironOf(items);
  if (iron) out.push(`${iron} iron mined and smelted`);
  const diamonds = Object.entries(items).reduce((sum, [name, c]) => sum + c * ({ diamond: 1, diamond_sword: 2, diamond_pickaxe: 3, diamond_axe: 3, diamond_helmet: 5, diamond_chestplate: 8, diamond_leggings: 7, diamond_boots: 4 }[name] || 0), 0);
  if (diamonds) out.push(`${diamonds} diamond${diamonds > 1 ? 's' : ''} found`);
  if (n('bow')) out.push('a bow made of three strings or taken from a skeleton');
  if (n('arrow')) out.push(`${n('arrow')} arrows from skeletons`);
  return out.join(', ');
}

// The iron in `items` and the minutes of play it takes to make again, at
// the fresh runs' pace (note 2070): full-5 and full-7 (2026-10-24, 19:42 to
// 21:10Z) had about 37 and 40 iron in 47 and 27 minutes of their iron work,
// about a minute an iron. A death costs only the time it loses: full-1
// (20:18:22Z) was told of four armour pieces 1063 blocks off only '28 iron
// mined and smelted', against the walk's 28 minutes.
const IRON_MINUTES = Object.freeze({ low: 0.7, high: 1.3 });
function ironOf(items = {}) {
  const n = name => items[name] || 0;
  return n('iron_helmet') * 5 + n('iron_chestplate') * 8 + n('iron_leggings') * 7 + n('iron_boots') * 4 + n('iron_sword') * 2 + n('iron_pickaxe') * 3 + n('shield') + n('bucket') * 3 + n('water_bucket') * 3 + n('iron_ingot') + n('raw_iron');
}
function ironRemakeSays(items = {}, goal = null) {
  const iron = ironOf(items);
  if (iron < 5) return '';
  // This run's own record first (note 2273): the pace of the iron work alone said 14 to 26 minutes, where full-5, 6
  // and 7's kits lost at deaths came back on the body after a mean 1.4 hours (Fable's check-in, 2026-10-27 02:40Z).
  const back = goal?.survival?.kitBack || [];
  if (back.length) {
    const m = back.map(b => b.minutes).sort((x, y) => x - y), median = m[Math.floor(m.length / 2)];
    return ` On this run, ${back.length === 1 ? 'the one kit lost at a death was' : `the ${back.length} kits lost at deaths were`} back on the body after ${back.length === 1 ? `${m[0]} minutes` : `a median ${median} minutes (${m.join(', ')})`}, the walks, the mining, the smelting and the deaths on the way counted; the ${iron} iron alone is about ${Math.round(iron * IRON_MINUTES.low)} to ${Math.round(iron * IRON_MINUTES.high)} minutes of iron work.`;
  }
  return ` The ${iron} iron is about ${Math.round(iron * IRON_MINUTES.low)} to ${Math.round(iron * IRON_MINUTES.high)} minutes of play to mine and smelt again, at the pace of the fresh runs' iron work (about 37 and 40 iron in 47 and 27 minutes, 2026-10-24).`;
}

// The eyes of ender a run had before a death and has nowhere now (none
// carried, in a chest or in the portal's frames): how many the goal still
// wants, for a death whose own list was not kept (note 1186). 25594
// (2026-10-04 07:05Z), asked of its death of 06:02Z by the armor it wore
// alone, left it at 853 blocks; its twelve eyes lay there.
function eyesLostBy(bot, goal, run) {
  const made = goal?.gameProgress?.milestones?.eyes_obtained?.at;
  if (!run?.more || !Number.isFinite(made) || made > Date.parse(run.deathAt)) return 0;
  let n = null; try { n = require('./eye-need').need(bot, goal); } catch (_) { n = null; }
  if (!n || n.eyes || n.stashed?.eyes) return 0;
  const frames = goal.gameProgress.milestones.stronghold_located?.frames;
  if (Array.isArray(frames) && frames.some(f => f.eye)) return 0;
  return n.target;
}

function worth(items = {}) {
  const out = {};
  for (const [name, count] of Object.entries(items)) if (count > 0 && WORTH.test(name) && !CHEAP.test(name)) out[name] = count;
  return out;
}

// The run for the last death, made the first time it is looked at after
// the survival layer's own nearby pickup has finished; null when there is
// nothing to go back for now.
function corpseRun(bot, goal, now = Date.now()) {
  const survival = goal.survival || {};
  const death = (survival.deaths || []).at(-1), recovery = survival.recovery;
  if (!death) return null;
  // The deaths before the last keep their drops too, where the bot never
  // came near them again (note 1183): 25594 (2026-10-04) died at 06:02Z with
  // twelve eyes of ender 1170 blocks from its bed, and again at 06:41Z in a
  // cave on the way back for them; the run for the second death took the
  // first one's place, and the eyes were on no list.
  if (!goal.corpseRunsEarlier) {
    const tally = names => names.reduce((o, n) => ({ ...o, [n]: (o[n] || 0) + 1 }), {});
    goal.corpseRunsEarlier = (survival.deaths || []).slice(0, -1)
      .filter(d => d.at !== goal.corpseRun?.deathAt && now - Date.parse(d.at) < 3 * 3600000 && dim(d.dimension) !== 'end' && !d.lava && d.position && Object.keys(worth(tally(d.worn || []))).length)
      .map(d => ({ deathAt: d.at, position: { ...d.position }, dimension: dim(d.dimension), items: worth(tally(d.worn || [])), more: true, passes: 0, stuck: 0, status: 'open', respawn: null })).slice(-3);
  }
  if ((goal.corpseRunFor || goal.corpseRun?.deathAt) !== death.at) {
    if (recovery?.at !== death.at || recovery.status === 'pending') return null;
    const old = goal.corpseRun;
    if (old?.status === 'open' && old.choice === 'go_back') note(goal, 'diedOnWay');
    if (old && ['open', 'left', 'unreachable'].includes(old.status) && !old.loadedAt && Object.keys(old.items || {}).length && !goal.corpseRunsEarlier.some(r => r.deathAt === old.deathAt)) goal.corpseRunsEarlier = [...goal.corpseRunsEarlier, old].slice(-3);
    goal.corpseRunFor = death.at;
    // A trip chosen for the death before is not this death's (note 1255):
    // 25592 (2026-10-04 18:56:39Z), killed bare on a trip chosen at 18:36Z,
    // was through its portal again 44 seconds after it came back to life,
    // nothing asked, with no armour, sword or food, and a hoglin killed it.
    if (goal.errand?.for === KIT_ERRAND) delete goal.errand;
    // What was worn drops with the rest (recovery.js records it apart from
    // the pockets): mid-242-aa's iron helmet and chestplate were never on
    // its list (note 559).
    const dropped = { ...(recovery.inventoryBeforeDeath || {}) };
    for (const name of death.worn || []) dropped[name] = (dropped[name] || 0) + 1;
    const items = worth(dropped);
    for (const [name, count] of Object.entries(recovery.recovered || {})) if (items[name] && (items[name] -= count) <= 0) delete items[name];
    const where = dim(death.dimension);
    goal.corpseRun = { deathAt: death.at, position: { ...death.position }, dimension: where, items, passes: 0, stuck: 0,
      ...(Array.isArray(recovery.dropsSeen) ? { drops: recovery.dropsSeen, mobsAtDeath: recovery.mobsHolding || [] } : {}),
      status: where === 'end' ? 'void' : death.lava ? 'burned' : Object.keys(items).length ? 'open' : 'nothing',
      respawn: dim(bot.game?.dimension) === where ? { ...bot.entity.position } : null };
  }
  // Nor does the trip outlast its run: closed, the errand is done with.
  if (goal.errand?.for === KIT_ERRAND && goal.corpseRun && goal.corpseRun.status !== 'open') delete goal.errand;
  let run = goal.corpseRun;
  const settle = r => {
    if (r.status === 'unreachable' && !r.loadedAt) { r.status = 'open'; delete r.choice; r.stalled = r.stalled || { walks: r.stuck || 3 }; r.stuck = 0; }
    if (r.status === 'left' && !r.loadedAt && r.more && !r.toldEyes && eyesLostBy(bot, goal, r)) { r.status = 'open'; delete r.choice; }
    if (r.status === 'left' && !r.loadedAt && r.told !== TOLD) { r.status = 'open'; delete r.choice; delete r.stalled; r.stuck = 0; }
    // Eyes left only by an answer that listed them (note 1410): 25597
    // (mid-243-ma-end-3, 2026-10-08) held its eleven eyes' run as left with
    // 'leave_them', though every leave_them it answered (00:14 and 02:23Z)
    // was asked of another death's iron, and it was not asked again.
    if (r.status === 'left' && !r.loadedAt && r.items?.ender_eye && !(r.leftWith?.ender_eye >= r.items.ender_eye)) { r.status = 'open'; delete r.choice; delete r.stalled; r.stuck = 0; }
    if (r.status === 'open' && now - Date.parse(r.deathAt) > KEEP_MS) r.status = 'stale';
  };
  // The last death's run closed (or none made for it): the latest of the
  // earlier ones still open is the run in hand, asked of Jev as its own.
  if (run) settle(run);
  // The earlier ones not taken up stay on the list, left ones whose drops
  // were never come near among them, so a later fact can open them again
  // (note 1293): 25597 (mid-243-ma-end-2, 2026-10-05 14:15Z), leaving a
  // Nether death's iron, popped its twelve eyes' run, left at 13:23Z, and
  // the run of the day before, and kept neither.
  if (run?.status !== 'open' && goal.corpseRunsEarlier.length) {
    const keep = r => ['left', 'unreachable'].includes(r.status) && !r.loadedAt && now - Date.parse(r.deathAt) <= KEEP_MS;
    const closed = run;
    for (let i = goal.corpseRunsEarlier.length - 1; i >= 0; i--) {
      const r = goal.corpseRunsEarlier[i];
      settle(r);
      if (r.status !== 'open') continue;
      goal.corpseRunsEarlier.splice(i, 1);
      goal.corpseRunFor = goal.corpseRunFor || closed?.deathAt || death.at;
      run = goal.corpseRun = r; delete run.choice; delete run.announced;
      break;
    }
    goal.corpseRunsEarlier = goal.corpseRunsEarlier.filter(r => r.status === 'open' || keep(r));
    if (run === closed && closed && keep(closed) && !goal.corpseRunsEarlier.some(r => r.deathAt === closed.deathAt) && closed.deathAt !== death.at) goal.corpseRunsEarlier.push(closed);
    // One entry a death, and none for the run in hand: a check by the
    // object alone pushed the same run again after each save and load
    // (25597 held four of its eyes' run).
    goal.corpseRunsEarlier = goal.corpseRunsEarlier.filter((r, i, all) => r.deathAt !== run?.deathAt && all.findIndex(o => o.deathAt === r.deathAt) === i);
  }
  if (!run) return null;
  if (run.waitUntil > now) return null;
  // A run the code once closed as out of reach, its drops never come near
  // (so not aged a second), is Jev's to close: asked again, told of the
  // walks that failed (note 1179).
  if (run.status === 'unreachable' && !run.loadedAt) { run.status = 'open'; delete run.choice; run.stalled = run.stalled || { walks: run.stuck || 3 }; run.stuck = 0; }
  // Left on a question that did not say what making them again takes
  // (note 1180), the drops never come near: asked once more, told.
  if (run.status === 'left' && !run.loadedAt && run.told !== TOLD) { run.status = 'open'; delete run.choice; delete run.stalled; run.stuck = 0; }
  if (run.status !== 'open') return null;
  if (now - Date.parse(run.deathAt) > KEEP_MS) { run.status = 'stale'; return null; }
  if (dim(bot.game?.dimension) !== run.dimension) return null;
  // When the drops started to age: at the death, if the bot came back to
  // life within the loaded ground round them; else when it came near. The
  // clock runs whether or not the bot is fit to go: it is the game's.
  if (!run.loadedAt && run.respawn && flat(run.respawn, run.position) <= TICKING) run.loadedAt = run.deathAt;
  if (!run.loadedAt && flat(bot.entity.position, run.position) <= TICKING) run.loadedAt = new Date(now).toISOString();
  if (run.loadedAt && now - Date.parse(run.loadedAt) > DESPAWN_MS - MARGIN_MS) { run.status = 'despawned'; note(goal, 'despawned'); return null; }
  // Whether it is fit to go is Jev's to weigh (corpse_run, told what was
  // about at the death, what it wore then and wears now). As a gate here it
  // kept the kit's own way back shut until the kit was made again:
  // mid-242-aa came back through its Nether portal thirteen blocks from its
  // iron sword, iron armor, bucket and pickaxe, unarmored, was never
  // asked, and died to a wither skeleton half an hour later in no armor
  // and with a stone sword (note 559).
  return run;
}

const listed = items => Object.entries(items).map(([name, n]) => `${n > 1 ? `${n} ` : ''}${name.replace(/_/g, ' ')}`).join(', ');

async function wearRecovered(bot) {
  for (const item of bot.inventory.items()) {
    const slot = ARMOUR[item.name.split('_').pop()];
    if (!slot || bot.inventory.slots?.[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]]) continue;
    try { await bot.equip(item, slot); } catch (_) { /* worn next time the kit is readied */ }
  }
}

// What is taken up first at the spot: what the goal is made of, then the
// kit, then the rest.
const FIRST = [/^ender_eye$/, /^(ender_pearl|blaze_rod|blaze_powder)$/, /^diamond/, /^(netherite|iron)_(helmet|chestplate|leggings|boots)$/, /^(bow|shield|arrow|iron_sword|iron_pickaxe|water_bucket|bucket)$/];
// Worth-while things rank after FIRST, and the cheap (cobblestone, dirt,
// the stone tools) last: the dying client's list of its drops is said and
// kept in this order (note 2127). full-6 (2026-10-26 02:51Z) died in full
// iron with a diamond pickaxe and was told 'cobblestone at (46, 39, 175),
// cobblestone at (48, 39, 175), 2 cobblestone ..., and more'.
const rank = name => { const i = FIRST.findIndex(r => r.test(name)); return i < 0 ? (Object.keys(worth({ [name]: 1 })).length ? FIRST.length : FIRST.length + 1) : i; };
const byRank = drops => [...drops].sort((a, b) => rank(a.name) - rank(b.name));
const lying = (bot, spot, name = null, seen = []) => Object.values(bot.entities || {}).filter(e => { const it = e?.position && e.isValid !== false ? e.getDroppedItem?.() : null; return it && (!name || it.name === name) && (e.position.distanceTo(spot) <= 12 || seen.some(d => Math.hypot(d.x - e.position.x, d.y - e.position.y, d.z - e.position.z) <= 6)); });
// What the dying client saw of its drops, said on the way back (note 2117).
function dropsSeenSays(run) {
  if (!Array.isArray(run?.drops)) return '';
  const p = run.position;
  if (!run.drops.length) return ' As it died the bot saw none of its drops lying (none within 24 blocks in the moment before it left the world): where they fell is not known beyond the death cell.';
  const far = Math.max(...run.drops.map(d => Math.hypot(d.x - p.x, d.z - p.z)));
  const low = Math.min(...run.drops.map(d => d.y)), high = Math.max(...run.drops.map(d => d.y));
  const holders = (run.mobsAtDeath || []).filter(m => m.holds?.length);
  const drops = byRank(run.drops), rest = drops.slice(6), restNames = [...new Set(rest.map(d => d.name.replaceAll('_', ' ')))];
  return ` As it died the bot saw ${run.drops.length} stack${run.drops.length === 1 ? '' : 's'} of its drops lying within ${Math.ceil(far)} block${Math.ceil(far) === 1 ? '' : 's'} of the death cell${high - low >= 3 ? `, from y ${Math.floor(low)} to ${Math.floor(high)}` : ''}: ${drops.slice(0, 6).map(d => `${d.count > 1 ? `${d.count} ` : ''}${d.name.replaceAll('_', ' ')} at (${Math.round(d.x)}, ${Math.round(d.y)}, ${Math.round(d.z)})`).join(', ')}${rest.length ? `, and ${rest.length} more stack${rest.length === 1 ? '' : 's'} of ${restNames.slice(0, 4).join(', ')}${restNames.length > 4 ? ' and the like' : ''}` : ''}; the walk back searches there.${holders.length ? ` Mobs about it then held things: ${holders.map(m => `the ${m.name.replaceAll('_', ' ')} ${m.distance} blocks off ${m.holds.map(h => h.replaceAll('_', ' ')).join(' and ')}`).join('; ')}; a zombie or skeleton picks up armour and weapons it walks over and drops them when killed.` : ''}`;
}

// A death in the Nether, the bot back to life in the Overworld: the kit lies
// where it fell, not a second older (nobody is within the ticking 176 blocks of it), and
// the way to it is the portal. The rule was the kit made again first, then
// the next Nether trip: 25592 (2026-10-04 15:31Z) died in its warped forest
// in iron armour with a diamond sword and an iron pickaxe, 5 pearls in a
// chest beside it, and set about wood, stone, a furnace and iron ore again;
// on 2026-10-03 the kit made again was 22 to 52 minutes, a median 37. Whether
// to go straight back for it is Jev's, asked once a death (note 1233).
// -> true when the trip was chosen (the errand set).
const KIT_ERRAND = 'the kit dropped at the death there';
const TRIP_RECORD = 'on 2026-10-03 the 4 deaths in the Nether with nothing in the home chest were back in the Nether 22 to 52 minutes later, a median 37, the kit mined and smelted again';
// The trip come to nothing, the bot in the Nether in next to no armour: out
// again for a kit, not on with the hunt as it stands (note 1251). Of the
// eleven trips of 2026-10-04 (15:45 to 19:00Z) nine brought nothing back,
// and the ladder took the pearls or the rods up again from there: 25592
// (18:39Z) went on to its warped forest with no sword, no food and no gold
// and was killed by a piglin at 18:56Z; 25590 died bare in the Nether three
// times after its trip.
function tripCameToNothing(bot, goal, run, save, now = Date.now()) {
  if (run?.dimension !== 'nether' || dim(bot.game?.dimension) !== 'nether' || goal.errand?.dimension === 'overworld') return false;
  const worn = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  if (worn.length >= 2) return false;
  goal.errand = { dimension: 'overworld', items: [], for: 'a kit made again: what the death dropped was not got back', at: now };
  bot.chat?.('Nothing of my kit to be had here, and next to nothing on me: back out to make one.');
  save?.();
  return true;
}
// What is carried to dig or bridge with, said on the trip.
const TRIPS = 'On 2026-10-04 (15:45 to 19:00Z) eleven such trips were taken as the bot stood: two came back with any of the kit; four were given up at the drops for want of a way to them; three found nothing left, two of those deaths in lava or fire; and five were followed by a death within half an hour, four of them to piglins with no gold on.';
async function kitTrip(bot, task, goal, save, now = Date.now()) {
  const run = goal.corpseRun;
  // Put off to dawn, it is asked again then, by day.
  if (run?.trip?.pick === 'go_at_dawn' && now >= run.trip.until) delete run.trip;
  if (!run || run.status !== 'open' || run.trip || run.loadedAt || run.dimension !== 'nether' || dim(bot.game?.dimension) !== 'overworld' || !bot.entity?.position) return false;
  if (!Object.keys(run.items || {}).length || now - Date.parse(run.deathAt) > KEEP_MS) return false;
  const here = bot.entity.position, spot = run.position;
  const near = (list, to) => list.slice().sort((a, b) => flat(a, to) - flat(b, to))[0] || null;
  const portals = goal.portals || [];
  const out = near(portals.filter(p => p.dimension === 'overworld'), here), there = near(portals.filter(p => p.dimension === 'nether'), spot);
  if (!out || !there) return false;
  const death = (goal.survival?.deaths || []).find(d => d.at === run.deathAt) || {};
  const about = (death.about || []).map(t => `a ${t.name.replaceAll('_', ' ')} ${t.distance} blocks off`).join(', ');
  const wornNow = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  // In a kit already (three pieces of armour worn), the drops are the next
  // trip's, as they were: 25595 (2026-10-04 15:50Z), in full iron 517 blocks
  // from its portal, was asked and told 'about 2 minutes' walk' (note 1236).
  if (wornNow.length >= 3) return false;
  const weapon = (bot.inventory?.items?.() || []).filter(i => /_(sword|axe)$/.test(i.name)).map(i => i.name.replaceAll('_', ' '))[0] || null;
  // The hour and the depth, as corpse_run says them: of the first four
  // askings three were at night or under the rock, each answered go_now on
  // a walk said as a minute or two, and none had reached its portal twenty
  // minutes later (25593 chose it at y 16 by night and died to a zombie on
  // the way up; 25589 and 25584 sealed in for the night).
  const { DAY } = require('./day');
  const t = bot.time?.timeOfDay, night = require('./day').night(bot);
  const toDawn = Number.isFinite(t) ? Math.max(1, Math.round(((DAY.DAWN - t + 24000) % 24000) / 1200)) : null;
  const toNight = Number.isFinite(t) ? Math.max(1, Math.round(((DAY.NIGHT - t + 24000) % 24000) / 1200)) : null;
  let depth = 0; try { depth = require('./levels').depthHere(bot) || 0; } catch (_) { depth = 0; }
  const hourSays = toDawn === null ? '' : night ? ` It is night: dawn in about ${toDawn} real minute${toDawn === 1 ? '' : 's'}, and mobs spawn in the open along the walk to the portal until then.` : ` It is day: night in about ${toNight} real minute${toNight === 1 ? '' : 's'}.`;
  const depthSays = depth >= 3 ? ` The bot is ${Math.round(depth)} blocks under the ground: the climb to the surface comes first.` : '';
  // The food it goes with, and what lay with the drops (note 1239): 25584
  // (2026-10-04 16:05 to 16:23Z) went back with none, took its kit up among
  // the blazes that had killed it, and at 1 health with nothing to eat was
  // dead at the same spawner eleven minutes after it got there.
  const foods = bot.registry?.foodsByName || {};
  const points = list => Object.entries(list).reduce((n, [name, c]) => n + (foods[name]?.foodPoints || 0) * c, 0);
  const carriedFood = points(Object.fromEntries((bot.inventory?.items?.() || []).map(i => [i.name, i.count])));
  const rec = goal.survival?.recovery, droppedFood = rec?.at === run.deathAt ? points(rec.inventoryBeforeDeath || {}) : null;
  const foodSays = ` ${carriedFood ? `${carriedFood} food points are carried` : 'No food is carried'}${droppedFood === null ? '' : droppedFood ? `, and about ${droppedFood} lay in the pack that dropped` : ', and none was in the pack that dropped'}: in the Nether health comes back only at hunger eighteen or more (it is ${bot.food ?? 20} now) and there is little to eat there, so what a fight at the drops takes stays lost${carriedFood || droppedFood ? ' past what that food gives back' : ''}.`;
  // No gold on, the piglins (note 1246): of the first kit trips' deaths
  // four were to piglins, bare (25590 three times, 25584).
  const GOLDEN = /^golden_/, goldOn = wornNow.some(n => GOLDEN.test(n)), goldDropped = Object.keys(run.items || {}).some(n => GOLDEN.test(n));
  const piglinSays = goldOn ? '' : ` No gold is worn: a piglin attacks a player wearing none on sight${goldDropped ? ', and the golden piece lies with the drops' : ''}; on 2026-10-04 (16:00 to 17:25Z) six deaths in the Nether were to piglins or in flight from them, every one with no gold on.`;
  const carriedNames = (bot.inventory?.items?.() || []);
  const pickaxe = carriedNames.find(i => /_pickaxe$/.test(i.name))?.name || null, blocks = carriedNames.filter(i => /^(cobblestone|netherrack|dirt|cobbled_deepslate|stone|andesite|diorite|granite)$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const waySays = ` ${pickaxe ? `A ${pickaxe.replaceAll('_', ' ')}` : 'No pickaxe'} and ${blocks} building block${blocks === 1 ? '' : 's'} are carried: in the Nether a gap is bridged with blocks and rock is dug with a pickaxe, and a walk without them stops at the first of either.`;
  const toPortal = Math.round(flat(here, out)), fromPortal = Math.round(flat(there, spot));
  const minutes = Math.max(1, Math.round((toPortal + fromPortal) / 4.3 / 60));
  const again = madeAgain(run.items);
  const withSays = `with ${weapon ? `a ${weapon}` : 'no sword or axe'} and ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'}`;
  const tree = {
    go_now: { description: `Go back for them now, as the bot stands (${withSays}): ${listed(run.items)} lie in the Nether where the bot died, ${fromPortal} blocks from the portal on that side; the portal on this side is ${toPortal} blocks off, about ${minutes} minute${minutes === 1 ? '' : 's'} at a clear walk over level ground, and longer over water, hills or rock.${hourSays}${depthSays} They are not a second older: dropped things age only while a player is within 128 blocks, and they last until the bot comes that near again, then five minutes. ${death.cause ? `The bot ${death.cause} there; when it died, ` : 'When the bot died, '}${about || 'nothing hostile was seen'}${about ? ' was about' : ''}; what was about then may be about still, and a mob the bot had struck forgets it once the bot is gone.${/burn|flame|fire|lava/i.test(death.cause || '') ? ' A death by fire is often on burning ground, and what drops into fire or lava is destroyed: 25593 (2026-10-04) went back 162 blocks for the kit of a death it burned to, and nothing lay there.' : ''} The bot wore ${(death.worn || []).map(n => n.replaceAll('_', ' ')).join(', ') || 'nothing'} then. Taken up, the kit is worn and carried at once and the ladder goes on from there.${foodSays}${piglinSays}${waySays} ${TRIPS}` },
    kit_first: { description: `Make a kit again here first, and take the drops up on the next trip into the Nether: ${again || 'what the ladder asks for'}. In the record, ${TRIP_RECORD}. The drops do not age meanwhile, and the bot comes to them ${withSays.replace(/^with /, 'no longer with ')}, in whatever it has made.` },
  };
  if (night && toDawn !== null) tree.go_at_dawn = { description: `Go back for them at dawn, about ${toDawn} real minute${toDawn === 1 ? '' : 's'} off: the night is seen out first as the night's own question has it (a shelter, a bed), and this is asked again by day. The drops do not age meanwhile.` };
  const decision = await require('./decisions').decide('kit_trip', { client: task.opportunityClient, bot, task, goal, save, tree,
    state: { foodPointsCarried: carriedFood, hunger: bot.food ?? 20, night, ...(night ? { minutesToDawn: toDawn } : {}), depth: Math.round(depth), toPortal, fromPortalToDrops: fromPortal, wornNow, weapon, aboutAtDeath: death.about || [], wornAtDeath: death.worn || [], drops: run.items } });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  run.trip = { pick, at: now, ...(pick === 'go_at_dawn' ? { until: now + toDawn * 60000 } : {}) };
  if (pick !== 'go_now') { save(); return false; }
  // Chosen here, it is not asked again on the far side.
  run.choice = 'go_back'; run.told = TOLD; note(goal, 'begun');
  goal.errand = { dimension: 'nether', items: [], for: KIT_ERRAND, at: now };
  bot.chat?.(`Straight back through the portal for what I dropped: ${listed(run.items)}.`);
  save();
  return true;
}

// The deaths that came hard on the one before (note 2032): back bare, the
// bot set out at once and died again within ten minutes. full-2 (2026-10-22
// 15:47:27 and 15:49:57Z) came back to life at its bed and was blown up 60
// blocks from it two and a half minutes later, nothing worn either time.
// This run's own record of its walks back, kept as it goes (note 2115), and
// the fleet's: the seven full runs of 2026-10-19 to 25 (full-1 to full-7),
// from their server logs, 288 deaths and 74 walks back set out, and the kit
// came back whole or in part 0 times: 18 walks found nothing where it died
// (7 of them within three minutes of the death), 14 ended in a death on the
// way (a median 7 minutes out, about 350 blocks off), the rest were given up
// or re-asked. Every kit lost was made again: full-5 smelted 377 ingots and
// made 12 chestplates in 23 hours. The game's part, from the 26.1.2 server:
// an item lying in a ticking chunk (within 176 blocks of a player) is gone
// 5 minutes after it fell there; a zombie or skeleton spawns able to pick
// up armour and weapons it walks over with chance 0.55 times the local
// difficulty's multiplier (0 where the ground is new, toward 1 after many
// hours played in it, DifficultyInstance), and the one that killed the bot
// stands where it died.
const FLEET_RECORD = Object.freeze({ runs: 7, from: '2026-10-19', to: '2026-10-25', deaths: 288, setOut: 74, back: 0, some: 0, nothing: 18, nothingQuick: 7, diedOnWay: 14, diedMinutes: 7, diedBlocks: 350 });
function note(goal, key) { if (!goal) return; const r = goal.corpseRecord ||= {}; r[key] = (r[key] || 0) + 1; }
function recordSays(bot, goal, now = Date.now()) {
  const r = goal?.corpseRecord || {}, deaths = (bot?._survivalState?.deaths || []).length;
  const F = FLEET_RECORD;
  const own = r.begun ? ` On this run: ${deaths} death${deaths === 1 ? '' : 's'}, ${r.begun} walk${r.begun === 1 ? '' : 's'} back set out, ${r.done || 0} got everything back, ${r.partial || 0} some of it, ${r.gone || 0} found nothing where it died, ${r.diedOnWay || 0} ended in a death on the way, ${r.left || 0} left the drops${r.despawned ? `, ${r.despawned} gone before the bot came` : ''}.` : deaths ? ` On this run: ${deaths} death${deaths === 1 ? '' : 's'} and no walk back set out yet.` : '';
  // The fleet's line says what its source can see (note 2183): it was read from the server logs, which see deaths and
  // chat, not pickups, so 'the kit back whole 0 times' was never a measurement; said that way it read as 'the walk never
  // works', and today's six runs left their drops 23 times in 25 (full iron 44 blocks off with 281 seconds on it among them).
  return `${own} On the ${F.runs} full runs of ${F.from} to ${F.to}: ${F.deaths} deaths and ${F.setOut} walks back set out; ${F.diedOnWay} of the walks ended in a death on the way (about ${F.diedMinutes} minutes out, about ${F.diedBlocks} blocks off) and ${F.nothing} found nothing where the bot died (${F.nothingQuick} of them within three minutes of the death); how many of the other ${F.setOut - F.diedOnWay - F.nothing} got the kit back that record does not say (it was read from the server logs, which do not see a pickup). These walks were made with a fault since mended: until 2026-10-27 14:00Z the walk and the pickup left out every cell and every drop with a hostile near it, and the drops lie where the bot died, beside what killed it, so a walk stopped short of them and no pickup there took anything. With it mended (notes 2287, 2288) the arena drill of 2026-10-27 (a death in iron with a zombie two blocks off, the respawn 40 blocks away) walked back to the spot in 3 runs of 3 and picked up all 19 of the 19 things dropped each time; the old way reached the spot in none of 3 and got 1 to 11 of them. The game: an item lying within ${TICKING} blocks of a player is gone five minutes after it fell there (farther off it waits); zombies and skeletons may pick up armour and weapons they walk over (about 55 in 100 of them where the ground has been played in for many hours, none where it is new), and the one that killed the bot stands where it died.`;
}
// The walks back for these same drops that ended in a death (note 2113):
// where, to what, with what about and what worn, said on every way. full-6
// (2026-10-25 23:26 to 23:50Z), its iron armour 221 blocks off where a
// skeleton shot it, went back bare at night, was killed on the way at
// (1, 97, 161) by a spider among three zombies, came back to life at its bed
// and was offered go_back again 15 seconds later, told nothing of it, with
// dawn 2 minutes off: it went (0.48 against waiting 0.24) and a zombie killed
// it 31 seconds later.
function triedDeathsSays(bot, run, now = Date.now()) {
  const since = Date.parse(run?.deathAt || run?.at || '');
  if (!Number.isFinite(since)) return '';
  const later = (bot._survivalState?.deaths || []).filter(d => Date.parse(d.at) > since && d.position);
  if (!later.length) return '';
  const here = bot.entity?.position;
  const one = d => {
    const p = d.position, mins = Math.max(1, Math.round((now - Date.parse(d.at)) / 60000));
    const about = (d.about || []).slice(0, 4).map(t => `a ${String(t.name).replaceAll('_', ' ')} ${t.distance} blocks off`).join(', ');
    const worn = (d.worn || []).filter(w => w !== 'shield');
    return `${mins} minute${mins === 1 ? '' : 's'} ago at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})${here ? `, ${Math.round(Math.hypot(p.x - here.x, p.z - here.z))} blocks from here` : ''}, ${String(d.cause || 'died').replace(/^was /, '')}${about ? `, with ${about}` : ''}, ${worn.length ? `in ${worn.map(w => w.replaceAll('_', ' ')).join(', ')}` : 'with no armour on'}`;
  };
  return ` Since these were dropped, ${later.length === 1 ? 'a walk back for them ended in a death' : `${later.length} walks back for them ended in deaths`}: ${later.slice(-3).map(one).join('; ')}.`;
}
function quickDeathsSays(bot) {
  const t = (bot._survivalState?.deaths || []).map(d => Date.parse(d.at)).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 3) return '';
  const quick = t.slice(1).filter((x, i) => x - t[i] <= 10 * 60000).length;
  return quick ? ` Of this run's last ${t.length} deaths, ${quick} came within ten minutes of the one before, the bot back with what it carries now.` : '';
}
// The arms worth making before a walk back with nothing (note 2148): a
// stone sword where no sword or axe is carried, a shield where none is and an
// iron ingot is. -> item names
function armsFirstWant(bot) {
  const items = bot?.inventory?.items?.() || [], has = re => items.some(i => re.test(i.name));
  const out = [];
  if (!has(/_(sword|axe)$/)) out.push('stone_sword');
  if (!has(/^shield$/) && !(bot?.inventory?.slots?.[45]?.name === 'shield') && countOf(bot, 'iron_ingot') >= 1) out.push('shield');
  return out;
}
// Stairs a go toward the drops: by hand a tunnel of 64 took past the ten minutes a pass may run (note 2370). full-19
// (25591, 2026-10-28 11:13 to 11:48Z), no pickaxe, dug down toward its drops 220 blocks off inside one pass, was
// restarted by the stuck watch three times into the same pass, and the pickaxe it chose to make was never made.
const handSteps = bot => (bot.inventory?.items?.() || []).some(i => /_pickaxe$/.test(i.name)) ? 64 : 8;
async function corpseRunStep(bot, task, goal, save, { move = navigate, collect = collectNearbyDrops, surface = null, room = null, gatherFood = null, kitActions = null, arm = null } = {}) {
  const run = corpseRun(bot, goal);
  if (!run && await kitTrip(bot, task, goal, save)) return false;
  if (!run) { save(); return false; }
  const spot = new Vec3(run.position.x, run.position.y, run.position.z);
  // Jev's to weigh, once a death: what was about when the bot died there,
  // against what it would get back.
  const client = task.opportunityClient;
  // Through the Nether (note 1393): the ladder's errand carries the bot
  // there; the walk here is the last of it, once the shortcut has ended
  // near the place.
  if (run.choice === 'through_nether') {
    if (goal.netherShortcut?.for === 'corpse_run') return false;
    run.choice = 'go_back'; note(goal, 'begun'); save();
  }
  if (!run.choice) {
    const death = (goal.survival?.deaths || []).find(d => d.at === run.deathAt) || (goal.survival?.deaths || []).at(-1) || {};
    const about = (death.about || []).map(t => `a ${t.name.replaceAll('_', ' ')} ${t.distance} blocks off`).join(', ');
    // What each kind about it then does to the body as it is worn now (note 2281): full-6 (25596, 2026-10-27 11:43Z),
    // bare, was told 'impaled by Drowned there; about it were a drowned 14 blocks off', went back at 0.56 for raw iron
    // 62 blocks off, and the drowned's tridents (8 a throw on no armour) ended it 39 seconds after it came back to life.
    let aboutHits = '';
    try {
      const kinds = [...new Map((death.about || []).map(t => [t.name, t])).values()].slice(0, 4);
      if (kinds.length) {
        // A death by impaling is a trident's whatever a drowned in sight then held (note 2284): full-6 (25596, 2026-10-27
        // 13:04Z) died 'impaled by Drowned' with a drowned holding a fishing rod 10 blocks off, was told 'a drowned's about
        // 3 (7 end the bot)', went back at 0.77, and was slain by a drowned there 23 minutes later.
        const holds = n => (n === 'drowned' && /impaled/.test(String(death.cause || '')) ? 'trident' : null) || (run.mobsAtDeath || []).find(m => m.name === n && m.holds?.length)?.holds?.[0] || null;
        const est = require('./combat-estimate').fightEstimate({ threats: kinds.map(t => ({ name: t.name, distance: t.distance, visible: true, ...(holds(t.name) ? { held: holds(t.name), ...(/trident|bow|crossbow/.test(holds(t.name)) ? { shoots: true } : {}) } : {}) })), armour: [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean), health: 20 }).mobs;
        const each = est.filter(m => m.hitsBot > 0).map(m => `a ${m.name.replaceAll('_', ' ')}'s about ${m.hitsBot} (${Math.ceil((bot.health ?? 20) / m.hitsBot)} end the bot from ${Math.round(bot.health ?? 20)} health)`);
        if (each.length) aboutHits = ` As worn now, a hit from each kind that was about it: ${each.join('; ')}.`;
      }
    } catch (_) { aboutHits = ''; }
    const wornNow = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
    const far = Math.round(flat(bot.entity.position, spot));
    const left = run.loadedAt ? Math.max(0, Math.round((DESPAWN_MS - (Date.now() - Date.parse(run.loadedAt))) / 1000)) : null;
    // The hour by the one clock (day.js), and how long it lasts: 25594
    // (2026-10-04 07:29:11Z) was told 'it is night' at dawn, tick 23000 and
    // some, nine minutes of day ahead and the walk four, and left twelve
    // eyes of ender at 0.55 to 0.41 (note 1188).
    const { DAY } = require('./day');
    const t = bot.time?.timeOfDay, night = require('./day').night(bot);
    const until = Number.isFinite(t) ? Math.max(1, Math.round((((night ? DAY.DAWN : DAY.NIGHT) - t + 24000) % 24000) / 1200)) : null;
    const hour = /overworld/.test(dim(bot.game?.dimension)) && until !== null ? (night ? `It is night: dawn in about ${until} real minute${until === 1 ? '' : 's'}.` : `It is day: night in about ${until} real minute${until === 1 ? '' : 's'}.`) : '';
    // What a chest in the Nether keeps did not drop (rod-stash.js, note 704).
    let kept = ''; try { kept = require('./rod-stash').stashSays(goal); } catch (_) { kept = ''; }
    const keptSays = kept ? ` Not dropped: ${kept}, kept there and counted as held.` : '';
    const earlier = run.more ? ' This is a death before the last: what else it carried then is not on this list (what lies there is taken with the rest), and its drops last only if the bot has not been within ${TICKING} blocks of them since.' : '';
    const others = (goal.corpseRunsEarlier || []).filter(r => r.dimension === run.dimension).map(r => `${listed(r.items)}${r.more ? ' and what else it carried then' : ''}, ${Math.round(flat(bot.entity.position, r.position))} blocks from here and ${Math.round(flat(spot, r.position))} from these`);
    const alsoLying = others.length ? ` From a death before this one there also lie: ${others.join('; ')}; that is asked of after this.` : '';
    const stalled = run.stalled ? ` ${run.stalled.walks} walks toward them${run.stalled.at ? ` from about (${run.stalled.at.x}, ${run.stalled.at.z})` : ''} got no nearer, straight and to each side${run.stalled.error ? ` (the last: ${run.stalled.error})` : ''}.` : '';
    const eyes = eyesLostBy(bot, goal, run);
    if (eyes) run.toldEyes = true;
    // Eyes lying by the End portal the bot found (note 1292): the walk back
    // is the walk to the portal, and its frames are filled there. 25597
    // (mid-243-ma-end-2, 2026-10-05 13:23Z) left its twelve eyes 45 blocks
    // from its portal, 0.49 to 0.45, told only what making them again takes.
    const ring = goal.endPortal?.center || goal.gameProgress?.endPortal?.center;
    const emptyFrames = (goal.endPortal?.frames || goal.gameProgress?.endPortal?.frames || []).filter(fr => !fr.eye).length;
    const nearRing = ring && run.items.ender_eye && /overworld/.test(run.dimension) ? Math.round(Math.hypot(ring.x - run.position.x, ring.z - run.position.z)) : null;
    const ringSays = nearRing != null && nearRing <= 300 ? ` They lie ${nearRing} blocks from the End portal the bot found at (${ring.x}, ${ring.y}, ${ring.z})${emptyFrames ? `, ${emptyFrames} of its frames empty` : ''}: the walk back is the walk to the portal, and the ${run.items.ender_eye} eyes go into its frames there.` : '';
    // The food for a long walk (note 1296): 25597 (2026-10-05 14:21 to
    // 15:13Z) set out on 1895 blocks with nothing to eat and starved to the
    // mobs 90 blocks short.
    let foodCarried = 0; try { foodCarried = require('./foraging').foodSupply(bot); } catch (_) { foodCarried = 0; }
    const walkFoodSays = far >= 300 ? ` Sprinting costs a point of hunger (saturation first) for about every 40 blocks, about ${Math.round(far / 40)} for this walk sprinted; the bot is at hunger ${bot.food ?? 20} with ${foodCarried ? `${foodCarried} food points carried` : 'nothing carried to eat'}, and health does not come back below hunger 18.` : '';
    const eyesSay = eyes ? ` The eyes of ender this run had made before that death are not carried, in a chest or in the portal's frames now: they dropped at a death since, this one or one after it, and the goal wants ${eyes}.` : '';
    // What the eyes were on this run's own clock (note 1189): the minutes of
    // play its rods and pearls took.
    let took = '';
    if (eyes || run.items.ender_eye) {
      const by = goal.gameProgress?.clock?.byDoing || {};
      const ms = Object.entries(by).filter(([k]) => /^(obtain_blaze_rods|obtain_ender_pearls|craft_eyes)\b/.test(k)).reduce((n, [, v]) => n + v, 0);
      if (ms >= 60000) took = ` On this run's clock the rods and pearls for its eyes were ${Math.round(ms / 60000)} minutes of play.`;
    }
    const again = madeAgain({ ...run.items, ...(eyes ? { ender_eye: eyes } : {}) }), flatWalk = Math.hypot(spot.x - bot.entity.position.x, spot.z - bot.entity.position.z);
    // The way down or up is walked too, at the bot's own measured pace by
    // the block (levels.js), and a place under the ground is said to be one
    // (note 1220): the hour does not reach it, and what was about it then
    // does not burn at dawn. 25594 (2026-10-04 12:01:58Z), bare, was told
    // '147 blocks off, about 1 minute's walk, at y -23 ... It is day' of
    // its things in a cave among a skeleton and two creepers, went at 0.81,
    // was three and a half minutes getting down, and was shot dead by the
    // pile in twenty-three seconds.
    let rec = null; try { rec = require('./levels').LEVEL_RECORD; } catch (_) { rec = null; }
    const dy = spot.y - bot.entity.position.y;
    const climbSeconds = Math.abs(dy) > 4 && rec ? Math.abs(dy) * (dy < 0 ? rec.downSecondsABlock : rec.upSecondsABlock) : 0;
    // At the pace the bot's own walks have made, stalls and detours counted
    // (note 1294), not a clear sprint: 25597 (2026-10-05 14:21Z) was told
    // 1895 blocks were 'about 7 minutes' walk', where its record makes them
    // about 49.
    const pace = rec?.walkBlocksAMinute ? rec.walkBlocksAMinute / 60 : 4.3;
    const minutes = Math.max(1, Math.round((flatWalk / pace + climbSeconds) / 60));
    // Under 100 blocks the walk is said in seconds against the seconds the
    // drops have left (note 2127): full-6 was told '44 blocks off, at y 37.
    // About 281 seconds before they vanish' with the walk and 27-block climb
    // (about 200 seconds at the record's pace) unsaid.
    const walkSeconds = Math.round(flatWalk / pace + climbSeconds);
    const walkLeft = left === null || far >= 100 ? '' : walkSeconds >= left ? ` The way there is about ${walkSeconds} seconds at the pace the bot's walks and climbs have made, stalls counted: more than are left.` : ` The way there is about ${walkSeconds} seconds of them, at the pace the bot's walks and climbs have made, stalls counted.`;
    const under = /overworld/.test(run.dimension) && spot.y < 50;
    const carriesWeapon = (bot.inventory?.items?.() || []).filter(i => /_(sword|axe)$/.test(i.name)).map(i => i.name.replaceAll('_', ' '))[0] || null;
    const underSays = under ? ` The place is under the ground (y ${Math.round(spot.y)}, ${Math.round(Math.abs(dy))} blocks ${dy < 0 ? 'down' : 'up'} from here): the hour does not reach it, and what was about it at the death does not burn at dawn; the bot goes there with ${carriesWeapon ? `a ${carriesWeapon}` : 'no sword or axe'} and ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'}.` : '';
    run.told = TOLD;
    const quick = quickDeathsSays(bot);
    // The kit in the chest beside the bed first (bed-kit.js, note 2032).
    let bedKit = null; try { bedKit = kitActions ? require('./bed-kit').bedKitChores(bot, goal).take_bed_kit : null; } catch (_) { bedKit = null; }
    const tree = {
      go_back: { description: `Go back for ${listed(run.items)}: ${far} blocks off${far >= 100 ? `, about ${minutes} minute${minutes > 1 ? 's' : ''}' ${climbSeconds ? 'walk and climb' : 'walk'}${rec?.walkBlocksAMinute ? ` at the ${rec.walkBlocksAMinute} blocks a minute the bot's walks have made, stalls and detours counted` : ''}` : ''}${Math.abs(spot.y - bot.entity.position.y) > 4 ? `, at y ${Math.round(spot.y)}` : ''}. ${left === null ? `They last until the bot comes within ${TICKING} blocks, then five minutes.` : `About ${left} seconds before they vanish.${walkLeft}`} ${death.cause ? `The bot ${death.cause} there; when it died, ` : 'When the bot died there, '}${about ? `about it were ${about}` : 'nothing hostile was in view'}; it wore ${death.worn?.length ? death.worn.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} then and wears ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} now.${aboutHits} ${hour}${underSays}${stalled}${earlier}${eyesSay}${ringSays}${walkFoodSays}${alsoLying}` },
      leave_them: { description: `Leave them and go on with what is carried: ${listed(worth(Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])))) || 'nothing worth listing'}. What was dropped is made again, or found, later${again ? `: ${again}` : ''}.${ironRemakeSays(run.items, goal)}${took}${keptSays}` },
    };
    // What holds for every way (the quick deaths, the walks back that ended in one, the drops seen, the record) is said once,
    // in the question's state, not on each way (note 2268's rule, the user 2026-10-27: 'should it just be in the state always?').
    const tried = triedDeathsSays(bot, run);
    if (bedKit) tree.kit_first = { description: `${bedKit.description} Then back for them as go back says.` };
    // By night, and the drops not ageing (the bot not within the ticking 176 blocks of
    // them): going when it is day is a choice of its own, not leaving them.
    // By day too, when the walk is longer than the day that is left.
    const toDawn = Number.isFinite(t) ? Math.max(1, Math.round(((DAY.DAWN - t + 24000) % 24000) / 1200)) : null;
    // Food for the walk first, where little is carried for it (note 1298):
    // 25597 (2026-10-05 15:37Z), twelve eyes 1895 blocks off and nothing to
    // eat, the walk there costing about 47 hunger sprinted, left them.
    // Into the Nether, the stay there wants its own food too (note 2333 critic, note 2335): health comes back only at
    // hunger eighteen and more, and the Nether's only food is its hoglins. The walk's want and the Nether floor
    // (food-reserve.js) said as one.
    const dropsInNether = /nether/.test(String(run.dimension || ''));
    const netherFloor = (() => { try { return require('./food-reserve').FLOOR.nether; } catch (_) { return 36; } })();
    const foodWant = Math.max(Math.min(30, Math.round(far / 40)), dropsInNether ? netherFloor : 0);
    // Arms first (note 2148, Fable's second opinion 04:40Z): at a respawn the
    // question was drops or not, and the move a strong player makes first,
    // a stone sword and a shield in two or three minutes, was not on it.
    // Tonight (2026-10-26 00:00 to 04:00Z) all 9 deaths with nothing worn
    // came 11 to 28 minutes after the run's previous death.
    const armsWant = armsFirstWant(bot);
    const withNow = `with ${carriesWeapon ? `a ${carriesWeapon}` : 'no sword or axe'} and ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'}`;
    if (arm && armsWant.length) {
      const cobble = countOf(bot, 'cobblestone') + countOf(bot, 'cobbled_deepslate') + countOf(bot, 'blackstone'), sticks = countOf(bot, 'stick'), planks = (bot.inventory?.items?.() || []).filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0), logs = (bot.inventory?.items?.() || []).filter(i => /_log$|_stem$/.test(i.name)).reduce((n, i) => n + i.count, 0), ingots = countOf(bot, 'iron_ingot');
      const table = countOf(bot, 'crafting_table') > 0;
      let spells = ''; try { spells = require('./decisions').deathSpells(goal) || ''; } catch (_) { spells = ''; }
      tree.arm_first = { description: `Make ${listed(Object.fromEntries(armsWant.map(i => [i, 1])))} here first, then set out for them as go back says: a stone sword is two cobblestone and a stick (${cobble} cobblestone, ${sticks} sticks, ${planks} planks, ${logs} logs carried${cobble >= 2 ? '' : '; stone is dug where the bot stands or below'})${armsWant.includes('shield') ? `, a shield an iron ingot and six planks (${ingots} ingots carried)` : ''}, a few seconds at a crafting table${table ? ' (one is carried)' : ' (four planks make one)'}; about two or three minutes with the gathering. The bot goes to them ${withNow} now. ${left === null ? 'The drops do not age meanwhile.' : `About ${left} seconds before the drops vanish, the arms' minutes among them.`} Ten minutes at most on the arms; then the walk with what there is.${spells ? ` ${spells}` : ''}` };
    }
    // Offered whenever less is carried than the walk (and a Nether stay) wants, not past 300 blocks alone (note 2335):
    // full-10 (25586, 2026-10-28 04:09:41Z) went back 205 blocks into the Nether with 0 food, offered go_back and
    // leave_them only, charged a blaze at 20 health and sat at 1.1 with no healing; the live critic's report of 04:15Z.
    // Not in the Nether (note 2375): the food got 'here' is the Overworld's animal search, which finds no ground there.
    // full-17 (25587, 2026-10-28 13:33 to 13:40Z) chose food_first in the Nether at food 13, its kit 689 blocks off in
    // the Overworld, and the search failed 22 times running ('No reachable surveyed ground while searching for
    // animals'), four health lost to a piglin meanwhile.
    if (gatherFood && foodCarried < foodWant && !/nether/.test(String(bot.game?.dimension || ''))) tree.food_first = { description: `Get food for the walk first, here: hunted, cooked or taken from a chest, toward ${foodWant} food points carried (${foodCarried} now), then set out for them; the drops do not age meanwhile. Twenty minutes at most on the food; then the walk with what there is.` };
    if (toDawn !== null && (night || minutes > until) && !run.loadedAt && /overworld/.test(run.dimension)) tree.wait_for_day = { description: `Set out for them at ${night ? 'dawn' : 'the next dawn'}, about ${toDawn} real minute${toDawn === 1 ? '' : 's'} off, with the day ahead for the walk${night ? '' : ` (the day left now, about ${until}, is shorter than the walk, about ${minutes})`}, and go on with other things until then: the drops do not age while the bot is not within ${TICKING} blocks of them.${night ? ' From dawn the zombies and skeletons on open ground burn in the sun (not under a roof or in water, not husks or a zombie with a helmet, and never spiders or creepers), and no more spawn there in the light.' : ''} Asked again at dawn.` };
    // Through the Nether, where the drop lies far off in the Overworld and a
    // portal the bot knows stands within 600 blocks of it and another within
    // 600 of the bot (note 1393): the nether shortcut's own way (out to the
    // place, the errand into the Nether, a block there eight here). 25598
    // (2026-10-07 06:41 and 07:00Z), its twelve eyes lying 8 blocks from its
    // End portal 1,182 blocks off and its portals at home and by the
    // stronghold, was offered only the walk, about 33 minutes, and chose to
    // wait for dawn twice.
    if (/overworld/.test(run.dimension) && /overworld/.test(String(bot.game?.dimension || '')) && far >= 400) {
      const overs = (goal.portals || []).filter(q => q.dimension === 'overworld');
      const mine = overs.map(q => ({ q, d: Math.round(flat(bot.entity.position, q)) })).sort((x, y) => x.d - y.d)[0];
      const theirs = overs.map(q => ({ q, d: Math.round(flat(spot, q)) })).sort((x, y) => x.d - y.d)[0];
      if (mine && theirs && mine.d <= 600 && theirs.d <= 600 && mine.q !== theirs.q) {
        const inNether = Math.round(flat(mine.q, theirs.q) / 8);
        tree.through_nether = { description: `Go back for them through the Nether: ${mine.d} blocks to the portal at (${mine.q.x}, ${mine.q.y}, ${mine.q.z}), about ${inNether} blocks across the Nether, and out by the portal at (${theirs.q.x}, ${theirs.q.y}, ${theirs.q.z}), ${theirs.d} blocks from them, in place of ${far} blocks over the ground. They last until the bot comes within 128 blocks, then five minutes; the Nether's mobs and lava are on the way.` };
      }
    }
    const seen = dropsSeenSays(run).trim(), record = recordSays(bot, goal).trim();
    const decision = await require('./decisions').decide('corpse_run', { client, bot, task, goal, save, tree,
      state: { food: `${foodCarried} food points carried, ${foodWant} wanted for the walk${dropsInNether ? ' and a stay in the Nether, where the only food is its hoglins' : ''}; hunger ${bot.food}: ${bot.food >= 18 ? 'health comes back' : 'under eighteen, health does not come back until the bot eats'}`, distance: far, secondsLeft: left, aboutAtDeath: death.about || [], wornAtDeath: death.worn || [], wornNow, night, ...(until !== null ? { [night ? 'minutesToDawn' : 'minutesToNight']: until } : {}), ...(run.stalled ? { walksThatGotNoNearer: run.stalled } : {}), ...(kept ? { inAChest: kept } : {}), ...(seen ? { dropsSeen: seen } : {}), ...(quick ? { quickDeaths: quick.trim() } : {}), ...(tried ? { walksBackThatDied: tried.trim() } : {}), walkBackRecord: record, ...(() => { try { const n = require('./risk').deathCost(bot, goal).nothingToLose; return n ? { nothingToLose: n } : {}; } catch (_) { return {}; } })() } });
    if (decision.stale) return false;
    if (decision.path.at(-1) === 'kit_first' && bedKit) {
      try { await bedKit.run(bot, task, goal, save, kitActions); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[corpse run] the kit by the bed was not taken: ${String(err.message || err).slice(0, 160)}`); }
      run.choice = 'go_back'; save(); return false;
    }
    if (decision.path.at(-1) === 'food_first') { run.choice = 'go_back'; note(goal, 'begun'); run.foodFirst = { at: Date.now(), want: foodWant }; save(); }
    if (decision.path.at(-1) === 'arm_first') { run.choice = 'go_back'; note(goal, 'begun'); run.armFirst = { at: Date.now(), want: armsFirstWant(bot) }; save(); }
    else if (decision.path.at(-1) === 'wait_for_day') { run.waitUntil = Date.now() + toDawn * 60000; save(); return false; }
    if (decision.path.at(-1) === 'through_nether') {
      const ns = require('./nether-shortcut');
      goal.netherShortcut = { chest: { x: Math.round(spot.x), y: Math.round(spot.y), z: Math.round(spot.z) }, phase: 'out', at: Date.now(), for: 'corpse_run' };
      goal.errand = { dimension: 'nether', items: [], for: ns.ERRAND, at: Date.now() };
      run.choice = 'through_nether'; save();
      bot.chat?.(`Through the Nether for them: ${Math.round(far / 8)} blocks there in place of ${far} here.`);
      return false;
    }
    if (!['food_first', 'arm_first'].includes(decision.path.at(-1))) run.choice = decision.path.at(-1); save();
    if (decision.path.at(-1) === 'go_back') note(goal, 'begun');
    if (run.choice === 'leave_them') { run.status = 'left'; note(goal, 'left'); run.leftWith = { ...run.items }; tripCameToNothing(bot, goal, run, save); save(); return false; }
  }
  // The arms for the walk, where that was chosen (note 2148): one item a
  // pass, until both are carried or ten minutes are spent on them.
  if (run.armFirst) {
    const next = (run.armFirst.want || []).find(i => !countOf(bot, i));
    if (next && Date.now() - run.armFirst.at < 10 * 60000 && arm) {
      goal.step = { action: 'arm_for_walk', item: next, to: { ...run.position } }; save();
      try { await arm(bot, task, next, countOf(bot, next) + 1, goal, save); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name)) throw err; console.log(`[corpse] the ${next.replaceAll('_', ' ')} for the walk stopped: ${String(err?.message || err).slice(0, 120)}`); delete run.armFirst; save(); }
      return true;
    }
    delete run.armFirst; save();
  }
  // The food for the walk, where that was chosen: a pass of the gathering
  // at a time, until it is carried or twenty minutes are spent on it.
  if (run.foodFirst) {
    let have = 0; try { have = require('./foraging').foodSupply(bot); } catch (_) { have = 0; }
    if (have < run.foodFirst.want && Date.now() - run.foodFirst.at < 20 * 60000 && gatherFood) {
      goal.step = { action: 'food_for_walk', want: run.foodFirst.want, have, to: { ...run.position } }; save();
      await gatherFood(bot, task, goal, save);
      return true;
    }
    delete run.foodFirst; save();
  }
  if (!run.announced) {
    run.announced = true;
    bot.chat?.(`Going back for what I dropped when I died, ${Math.round(flat(bot.entity.position, spot))} blocks off: ${listed(run.items)}.`);
  }
  goal.step = { action: 'corpse_run', to: { ...run.position }, items: { ...run.items } }; save();
  const before = flat(bot.entity.position, spot);
  if (before > ARRIVE) {
    // Far off, a leg at a time over the ground (a walk of a thousand blocks
    // is not one the pathfinder plans); after a leg that got no nearer, the
    // next is turned to one side of the straight line and then the other.
    // Far off and under the rock, up to the surface first: the legs are
    // walked over the ground. 25594 (2026-10-04 06:38Z) walked a leg into a
    // cave at y 41, 540 blocks from its things, and three legs from there
    // had no path within the second; asked on 'six walks got no nearer', Jev
    // left twelve eyes of ender (note 1182).
    let depth = 0; try { depth = require('./levels').depthHere(bot) || 0; } catch (_) { depth = 0; }
    if (before > FAR && depth >= 3 && surface && !(run.climbFailed >= 2)) {
      const y = bot.entity.position.y;
      goal.step = { action: 'corpse_run', to: { ...run.position }, items: { ...run.items }, way: 'up to the surface first' }; save();
      try { await surface(bot, task, goal, save); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      run.climbFailed = bot.entity.position.y - y >= 2 ? 0 : (run.climbFailed || 0) + 1;
      save(); return true;
    }
    const here = bot.entity.position, turn = TURNS[(run.stuck || 0) % TURNS.length] * Math.PI / 180;
    const bearing = Math.atan2(spot.z - here.z, spot.x - here.x) + turn;
    // Down to the drops' level outside the ground that ticks, then in level
    // (note 1394): drops start their five minutes when the bot comes within
    // 128 blocks, and a way down from over them is slower than that. 25598
    // (2026-10-07 07:46:55 to 07:52Z) came within reach of its twelve eyes
    // 77 blocks over them at y 15, beside its End portal, dug down a block
    // in ten to forty seconds, and they were gone at y 25.
    const dy = here.y - spot.y, edge = TICKING + 8, across = Math.hypot(here.x - spot.x, here.z - spot.z) || 1;
    if (!run.loadedAt && dy > 12 && across > edge) {
      const start = edge + dy + 16;
      if (across <= start) {
        const unit = { x: (here.x - spot.x) / across, z: (here.z - spot.z) / across };
        const target = new Vec3(Math.round(spot.x + unit.x * edge), Math.round(spot.y + 1), Math.round(spot.z + unit.z * edge));
        goal.step = { action: 'corpse_run', to: { ...run.position }, items: { ...run.items }, way: `down to their level (y ${Math.round(spot.y)}) before coming within ${TICKING} blocks` }; save();
        try { await require('./bridging').tunnelStraight(bot, task, target, { maxSteps: handSteps(bot), navigate: move, down: true }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[corpse run] the way down stopped: ${String(err.message || err).slice(0, 160)}`); }
        return true;
      }
      // A leg that would end inside the edge ends at the start of the way down.
      if (across - LEG < start) {
        const to = { x: here.x + (spot.x - here.x) / across * (across - start), z: here.z + (spot.z - here.z) / across * (across - start) };
        try { await move(bot, task, new goals.GoalNearXZ(Math.round(to.x), Math.round(to.z), 4), { timeoutMs: LEG_MS, stallMs: 8000, sprint: true, hostilesOk: true }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
        return true;
      }
    }
    const leg = before > FAR ? new goals.GoalNearXZ(Math.round(here.x + Math.cos(bearing) * LEG), Math.round(here.z + Math.sin(bearing) * LEG), 4) : new goals.GoalNear(spot.x, spot.y, spot.z, 3);
    let failed = null;
    try { await move(bot, task, leg, { timeoutMs: LEG_MS, stallMs: 8000, sprint: true, hostilesOk: true, passing: /nether/.test(String(bot.game?.dimension || '')) }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; failed = String(err.message || err).slice(0, 120); }
    let after = flat(bot.entity.position, spot);
    // A walk that got no nearer, the drops within a leg: dug and bridged
    // straight at them as the tunnel home goes (bridging.js), the pickaxe and
    // blocks carried (note 1363). 25592 (2026-10-06 08:56 to 08:58Z), its
    // twelve eyes 75 blocks off across the Nether, stalled twice on its walk
    // and left them, their five minutes running.
    if (after > ARRIVE && before - after < 2 && before <= FAR) {
      try {
        const r = await require('./bridging').tunnelStraight(bot, task, spot, { maxSteps: handSteps(bot), navigate: move, down: true });
        console.log(`[corpse run] dug and bridged toward the drops: ${r?.arrived ? 'arrived' : `${Math.round(after - flat(bot.entity.position, spot))} blocks nearer`}`);
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[corpse run] the dig toward the drops stopped: ${String(err.message || err).slice(0, 120)}`); }
      after = flat(bot.entity.position, spot);
    }
    if (after > ARRIVE) {
      // Whether the things are given up is Jev's (it closed here on a count
      // of three: 25594, 2026-10-04 06:11Z, 800 blocks from twelve eyes of
      // ender, a diamond sword, a bow, 51 arrows and its iron armor, never
      // within sight of them). When a walk each way (straight, and to
      // each side by two angles) has got no nearer, the question is asked
      // again with what failed.
      if (before - after >= 8) { run.stuck = 0; delete run.climbFailed; }
      else if (++run.stuck % TURNS.length === 0) {
        run.stalled = { walks: (run.stalled?.walks || 0) + TURNS.length, at: { x: Math.round(bot.entity.position.x), z: Math.round(bot.entity.position.z) }, ...(failed ? { error: failed } : {}) };
        delete run.choice; delete run.announced;
      }
      save(); return true;
    }
  }
  // At the spot: what is lying there, a stack at a time while it pays. What
  // lies there and is worth carrying is on the list whether or not the
  // record had it.
  for (const e of Object.values(bot.entities || {})) {
    const it = e?.position && e.isValid !== false ? e.getDroppedItem?.() : null;
    if (!it || e.position.distanceTo(spot) > 12 || run.items[it.name] || !Object.keys(worth({ [it.name]: it.count || 1 })).length) continue;
    run.items[it.name] = it.count || 1;
  }
  // The eyes and the kit before the rest, and room made for each: walking
  // in takes up whatever lies nearest, and with the pockets full nothing
  // more is taken. 25594 (2026-10-04 08:05 to 08:07Z) came to its things
  // with five minutes on them, its pockets filled on the way in with the
  // leather, bone and wool of that death; twelve eyes of ender, a diamond
  // sword and its iron armor lay there, no stack of them went in, the pass
  // said 'nothing left where I died', and they were gone at 08:07:52
  // (note 1192).
  const makeRoom = room || (async name => require('./inventory-tidy').makeRoom(bot, task, name, { keep: new Set(Object.keys(run.items)), purpose: 'the things dropped at the death, lying here', goal }));
  let got = 0, full = false;
  for (const name of Object.keys(run.items).sort((a, b) => rank(a) - rank(b))) {
    for (let tries = 0; tries < 4 && run.items[name] > 0; tries++) {
      task.check();
      if (lying(bot, spot, name, run.drops || []).length) {
        try { if (!await makeRoom(name)) full = true; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      const had = countOf(bot, name);
      // Searched where the stack was seen to land as the bot died (note 2117), else at the death cell.
      const seenAt = (run.drops || []).find(d => d.name === name);
      const origin = seenAt ? new Vec3(seenAt.x, seenAt.y, seenAt.z) : spot;
      try { await collect(bot, task, name, { origin, radius: 12, timeoutMs: 12000, allowExcavation: true, hostilesOk: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      const gained = countOf(bot, name) - had;
      if (gained <= 0) break;
      got += gained;
      if ((run.items[name] -= gained) <= 0) delete run.items[name];
    }
  }
  run.passes++;
  if (got) await wearRecovered(bot);
  if (!Object.keys(run.items).length) { run.status = 'done'; note(goal, 'done'); bot.chat?.('Got my things back.'); }
  // Not closed while something on the list is still seen lying there and
  // the game's five minutes are not out: the next pass is for it.
  else if (Object.keys(run.items).some(name => lying(bot, spot, name, run.drops || []).length) && run.passes < 8) {
    if (full) bot.chat?.('My pockets are full and my things are still lying here. Making room.');
  }
  else if (!got || run.passes >= 2) {
    run.status = got ? 'partial' : 'gone'; note(goal, run.status);
    // What the entity list held at the verdict (note 2116): in 288 deaths this
    // month no walk back got the kit, and the arena drill of 2026-10-26 (die
    // in iron, respawn 40 blocks off, on flat ground and on a pillar) saw every
    // drop at once and picked up every one. full-5 (2026-10-25 11:19:00Z) stood
    // 3 blocks from where it died 64 seconds before and saw none: the next such
    // verdict says what was in the list, by distance from the spot.
    try {
      const all = Object.values(bot.entities || {}).filter(e => e?.position && e.isValid !== false), here = bot.entity.position;
      const drops = all.map(e => { let it = null; try { it = e.getDroppedItem?.(); } catch (_) { it = null; } return it ? { name: it.name, n: it.count, d: Math.round(e.position.distanceTo(spot)) } : null; }).filter(Boolean).sort((a, b) => a.d - b.d);
      const within = r => drops.filter(x => x.d <= r).length;
      console.log(`[corpse] ${run.status} at ${Math.round(here.distanceTo(spot))} blocks from the spot, ${Math.round((Date.now() - Date.parse(run.deathAt)) / 1000)} s after the death: ${all.length} entities in the list, ${drops.length} of them items (${within(12)} within 12 of the spot, ${within(32)} within 32, ${within(96)} within 96)${drops.length ? `; nearest ${drops.slice(0, 6).map(x => `${x.name}x${x.n}@${x.d}`).join(' ')}` : ''}; wanted ${listed(run.items)}; mobs about ${all.filter(e => e.type === 'hostile' || e.type === 'mob').map(e => `${e.name}@${Math.round(e.position.distanceTo(spot))}${(e.equipment || []).filter(Boolean).length ? `[${(e.equipment || []).filter(Boolean).map(i => i.name).join(',')}]` : ''}`).slice(0, 6).join(' ') || 'none'}; seen at the death: ${Array.isArray(run.drops) ? `${run.drops.length} stacks` : 'not recorded'}`);
    } catch (_) { /* said only */ }
    bot.chat?.(got ? `Got some of it back. The rest is gone: ${listed(run.items)}.` : `Nothing left where I died. Lava or time took it.`);
    tripCameToNothing(bot, goal, run, save);
  }
  save();
  return true;
}

// The walk back under way, for a question asked in the middle of it (the
// upkeep's, note 1211): what is gone back for, how far, and what is left
// of the game's five minutes. -> { list, far, secondsLeft } or null
function underWay(bot, goal, now = Date.now()) {
  const run = goal?.corpseRun;
  if (!run || run.status !== 'open' || run.choice !== 'go_back' || run.waitUntil > now || !bot?.entity?.position) return null;
  if (dim(bot.game?.dimension) !== run.dimension) return null;
  return { list: listed(run.items), far: Math.round(flat(bot.entity.position, run.position)),
    secondsLeft: run.loadedAt ? Math.max(0, Math.round((DESPAWN_MS - (now - Date.parse(run.loadedAt))) / 1000)) : null };
}

// The drops of the last death and their clock, said on the work's turn (note 2047): the run is a work step and waits for
// work to have the turn, and the survival layer held it for shelter and food with the drops unsaid. Near the bot their
// chunk is loaded and they vanish five minutes after the death; full-2 (2026-10-23 07:54Z), full-3 (11:05Z) and full-4
// (13:46Z) had the turn to work 457, 506 and 670 seconds after their deaths.
function dropsWaitSays(bot, goal, now = Date.now()) {
  const run = goal?.corpseRun;
  if (!run || run.status !== 'open' || !Object.keys(run.items || {}).length || !run.position || !bot?.entity?.position) return '';
  if (dim(bot.game?.dimension) !== run.dimension) return '';
  const off = Math.round(Math.hypot(run.position.x - bot.entity.position.x, run.position.z - bot.entity.position.z));
  const left = DESPAWN_MS - (now - Date.parse(run.loadedAt || run.deathAt));
  const what = Object.entries(run.items).map(([n, c]) => `${c > 1 ? `${c} ` : ''}${n.replaceAll('_', ' ')}`).join(', ');
  if (off <= TICKING && left > 0) return ` Given the turn, the work asks first about going back for what the last death dropped, ${off} blocks off: ${what}. That ground is loaded about the bot, so they vanish five minutes after the death, about ${Math.round(left / 1000)} seconds from now.`;
  if (off > TICKING) return ` Given the turn, the work asks first about going back for what the last death dropped, ${off} blocks off: ${what}. Drops age only while their ground is loaded, so they keep until the bot comes near.`;
  return '';
}
module.exports = { armsFirstWant, dropsSeenSays, byRank, recordSays, FLEET_RECORD, TICKING, triedDeathsSays, dropsWaitSays, quickDeathsSays, TOLD, tripCameToNothing, KIT_ERRAND, kitTrip, corpseRun, corpseRunStep, worth, madeAgain, ironRemakeSays, IRON_MINUTES, underWay };
