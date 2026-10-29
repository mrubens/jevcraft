'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { checkThreats, threats } = require('./danger');
const { checkAir } = require('./vitals');
const { surveyRoute } = require('./skills');
const { swimmableWater } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stock = bot => bot.inventory.items().reduce((out, item) => { out[item.name] = (out[item.name] || 0) + item.count; return out; }, {});
const pos = p => new Vec3(p.x, p.y, p.z);
// What is worn and in the off hand: dropped at a death with the rest, and
// not among inventory.items() (slots 9 to 44). mid-242-aa died in the
// Nether in an iron helmet and chestplate, and the way back for its drops
// listed neither (note 559).
const wornNow = bot => [5, 6, 7, 8, 45].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);

function observeAliveInventory(bot, now = Date.now()) {
  if (bot.health > 0 && bot.isAlive && bot.inventory) {
    bot._aliveInventory = { at: now, entityId: bot.entity.id, items: stock(bot), worn: wornNow(bot) };
  }
}

// Deaths are recorded, never a reason to stop: the bot used to pause after
// three in ten minutes until a person said "resume", and on a run that packs
// light and plans to die that only stood it still (the user, 2026-09-23:
// "remove that check for all runs").
// The stance and its book, kept on the survival state while it holds.
const STANCE_KEYS = ['stance', 'stanceFailed', 'stanceIdle', 'stanceWhy', 'stanceScene', 'stanceScenesRecent', 'stanceTakeCoverNoRoute', 'standing', 'creeperStandoff', 'retreatScout', 'lethalLine', 'mealCutAt'];
function recordDeath(bot, state, now = Date.now()) {
  // 26.1 can clear inventory before Mineflayer emits the health-based death
  // event. Preserve the last observed alive inventory, with its evidence time.
  const observed = bot._aliveInventory;
  const recent = observed && observed.entityId === bot.entity.id && now - observed.at <= 2000;
  // Lava at the body: what it dropped burns, and nothing is gone back for.
  const cell = bot.entity.position.floored();
  const lava = [cell, cell.offset(0, 1, 0), cell.offset(0, -1, 0)].some(c => /lava/.test(bot.blockAt?.(c)?.name || ''));
  // What was about when it died, and what it wore: the way back for the
  // drops is weighed against them (corpse-run.js).
  let about = [];
  try { about = require('./danger').threats(bot, 24).slice(0, 8).map(t => ({ name: t.entity.name, distance: Math.round(t.distance) })); } catch (_) { about = []; }
  const worn = recent && observed.worn ? [...observed.worn] : wornNow(bot);
  // The drops as the dying client sees them (note 2117): where each stack
  // landed, and what the mobs about hold. The arena drills of 2026-10-26 (die
  // in iron, quit and rejoin as the bot does, respawn 40 or 150 blocks off)
  // saw every stack at once, 2.4 to 6.7 blocks from the death cell, and picked
  // up every one; in play no walk back of 74 this week got the kit. The run
  // back searches where the stacks were seen, and says what was seen.
  let dropsSeen = [], mobsHolding = [];
  try {
    const here = bot.entity.position;
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || e.isValid === false) continue;
      let it = null; try { it = e.getDroppedItem?.(); } catch (_) { it = null; }
      if (it && e.position.distanceTo(here) <= 24) { dropsSeen.push({ name: it.name, count: it.count || 1, x: Math.round(e.position.x * 10) / 10, y: Math.round(e.position.y * 10) / 10, z: Math.round(e.position.z * 10) / 10 }); continue; }
      if ((e.type === 'hostile' || e.type === 'mob') && e.position.distanceTo(here) <= 16) {
        const held = (e.equipment || []).filter(Boolean).map(i => i.name);
        mobsHolding.push({ name: e.name, distance: Math.round(e.position.distanceTo(here)), ...(held.length ? { holds: held } : {}) });
      }
    }
    // The kit before the cobblestone when the list is capped (note 2127).
    try { dropsSeen = require('./corpse-run').byRank(dropsSeen); } catch (_) {}
    dropsSeen = dropsSeen.slice(0, 40); mobsHolding = mobsHolding.slice(0, 8);
  } catch (_) { dropsSeen = []; mobsHolding = []; }
  // How it died, in the game's own words, and what Jev had last chosen:
  // said with every question after (decisions/index.js recentDeaths).
  const cause = bot._deathMessage && now - bot._deathMessage.at < 5000 ? bot._deathMessage.text : null;
  const lastChoice = (bot._lastDecision && now - bot._lastDecision.at < 60000) ? { question: bot._lastDecision.id, choice: bot._lastDecision.choice, secondsBefore: Math.round((now - bot._lastDecision.at) / 1000) } : null;
  // The base's bed carried along drops with everything else: the base
  // asks for a bed again.
  if (state.home?.bed?.carriedAt) { delete state.home.bed.carriedAt; delete state.home.bed.claimedAt; }
  // A kit lost (note 2273): the iron worn at the death, kept until as much is worn again, for the measured time back.
  { const iron = (worn || []).filter(n => /^(iron|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.test(n)).length; if (iron >= 2 && !state.kitLost) state.kitLost = { at: new Date(now).toISOString(), pieces: iron }; }
  // What the pockets held, the worth-while part, kept with each death (note 2398): the recovery below holds only the
  // last death's, and full-19 (25591, 2026-10-28 16:41Z) died in the Nether in full iron and again in the Overworld
  // three minutes after, before its walk back for the first was ever made; the first death's kit was on no list.
  let carried = null;
  try { carried = require('./corpse-run').worth(recent ? { ...observed.items } : stock(bot)); } catch (_) { carried = null; }
  state.deaths = [...(state.deaths || []), { at: new Date(now).toISOString(), position: { ...bot.entity.position }, dimension: bot.game.dimension, about, worn,
    ...(carried && Object.keys(carried).length ? { carried } : {}),
    food: bot.food, ...(cause ? { cause } : {}), ...(lastChoice ? { lastChoice } : {}), ...(lava ? { lava } : {}) }].slice(-10);
  // No stance or answer outlives the body it was chosen for (note 778b):
  // 25598 (mid-241-bs, 04:58:25Z) respawned with the fight held from
  // 04:57:38 still its stance and its scene's answers on the book, while
  // Jev was down and nothing new could be asked.
  for (const k of STANCE_KEYS) delete state[k];
  if (bot) delete bot._stance;
  state.recovery = { status: 'pending', at: new Date(now).toISOString(), position: { ...bot.entity.position },
    dimension: bot.game.dimension, inventoryBeforeDeath: recent ? { ...observed.items } : stock(bot),
    inventoryObservedAt: new Date(recent ? observed.at : now).toISOString(), recovered: {}, attempts: 0, dropsSeen, mobsHolding,
    // What was worn too (note 2272): the inventory leaves out the armour slots, so a death in full iron read as bare.
    worn };
}

// Restrict retrieval to observed routes: no digging, scaffolding, swimming or
// approaching known hostiles. Unknown/dangerous/lost drops are a concrete
// reason to replan from current inventory, not to restore imagined supplies.
async function recoverItems(bot, task, recovery, save, navigate) {
  if (!recovery || recovery.status !== 'pending') return false;
  task.check(); checkAir(bot);
  const finish = reason => {
    recovery.status = 'finished'; recovery.reason = reason;
    recovery.inventoryAfter = stock(bot); recovery.finishedAt = new Date().toISOString();
    save(); bot.emit?.('death_recovery', recovery);
    bot.chat?.(`After respawning: ${reason}. Continuing from my current inventory.`);
    return false;
  };
  if (bot.game.gameMode === 'creative') return finish('Creative inventory remains available');
  const lost = recovery.inventoryBeforeDeath;
  if (!Object.keys(lost).length) return finish('no items were recorded in my inventory at death');
  if (bot.game.dimension !== recovery.dimension) return finish('the death location is in another dimension');
  if (Date.now() - Date.parse(recovery.at) > 300000) return finish('the drop retrieval window elapsed; the old items may have despawned');
  if (bot.health <= 12 || bot.food <= 6) return finish('my health or hunger is too low for a retrieval trip');
  if (recovery.attempts >= 5 || (recovery.startedAt && Date.now() - Date.parse(recovery.startedAt) >= 30000)) return finish('the bounded retrieval attempt ended');
  const origin = pos(recovery.position);
  if (origin.distanceTo(bot.entity.position) > 128 || !bot.blockAt(origin)) return finish('the death location is outside the currently observed area');
  const missing = name => Math.max(0, (lost[name] || 0) - (recovery.recovered[name] || 0));
  const findCandidates = () => Object.values(bot.entities || {}).filter(e => e.position && e.isValid !== false &&
    missing(e.getDroppedItem?.()?.name) > 0 && e.position.distanceTo(origin) <= 8 && !(recovery.failedEntities || []).includes(e.id))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  if (!Object.keys(lost).some(name => missing(name))) return finish('recovered the recorded item quantities');
  const before = stock(bot);
  let pickupBaseline = before;
  const countPickups = () => {
    const after = stock(bot);
    let changed = false;
    for (const name of Object.keys(lost)) {
      const count = Math.min(missing(name), Math.max(0, (after[name] || 0) - (pickupBaseline[name] || 0)));
      if (count) { recovery.recovered[name] = (recovery.recovered[name] || 0) + count; changed = true; }
    }
    pickupBaseline = after;
    if (changed) save();
    return after;
  };
  let candidates = findCandidates();
  if (!candidates.length && bot.entity.position.distanceTo(origin) <= 4) {
    // Chunk readiness does not imply entity/metadata readiness after respawn.
    // Observe briefly before concluding that the recorded drops are absent.
    const deadline = Date.now() + 3000;
    while (!candidates.length && Date.now() < deadline) {
      await sleep(100); task.check(); checkAir(bot); checkThreats(bot);
      candidates = findCandidates();
      if (Object.keys(lost).some(name => (stock(bot)[name] || 0) > (before[name] || 0))) {
        countPickups(); save(); return true;
      }
    }
  }
  if (!candidates.length && bot.entity.position.distanceTo(origin) <= 4) return finish('no matching dropped items are visible at the death location');
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers,
    allowSprinting: movement.allowSprinting, scafoldingBlocks: movement.scafoldingBlocks, maxDropDown: movement.maxDropDown };
  Object.assign(movement, { canDig: false, allow1by1towers: false, allowSprinting: false, scafoldingBlocks: [], maxDropDown: 2 });
  const previousInterrupt = task.interruptCheck;
  task.interruptCheck = () => { previousInterrupt?.(); checkThreats(bot); };
  try {
    let target, selected;
    const routeDeadline = Date.now() + 3000;
    // A trapped nearby stack says nothing about the other drops. Search a
    // bounded set of observed alternatives before abandoning retrieval, and
    // finish each incremental search instead of treating "partial" as noPath.
    for (const candidate of candidates.length ? candidates.slice(0, 8) : [null]) {
      task.check(); checkAir(bot);
      const budget = Math.min(500, routeDeadline - Date.now());
      if (budget <= 0) break;
      const p = candidate?.position || origin;
      const destination = candidate ? new goals.GoalBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) :
        new goals.GoalNear(origin.x, origin.y, origin.z, 2);
      const route = await surveyRoute(bot, task, movement, destination, budget);
      const danger = threats(bot, 128);
      const unsafe = route.path?.some(p => swimmableWater(bot.blockAt(pos(p))) || ['bubble_column', 'lava', 'fire', 'soul_fire', 'powder_snow'].includes(bot.blockAt(pos(p))?.name) ||
        danger.some(t => t.entity.position.distanceTo(pos(p)) < 12));
      if (route.status === 'success' && !unsafe) { target = destination; selected = candidate; break; }
    }
    // No straight walk there in three seconds, with no digging or towers, is not the kit out of reach (note 2477): the walk
    // back that digs and asks (corpse-run.js) is next, and said so. full-85 (25590, 2026-10-29 11:08Z) said 'I cannot
    // safely reach the items that are left. Continuing from my current inventory' of its iron kit 30 blocks off in a cave.
    if (!target) return finish('no plain walk to the items reaches them; the walk back that digs its way is next');
    recovery.startedAt ||= new Date().toISOString(); recovery.attempts++; save();
    await navigate(bot, task, target, { timeoutMs: Math.min(12000, 30000 - (Date.now() - Date.parse(recovery.startedAt))), stallMs: 4000 });
    await sleep(600); task.check(); checkAir(bot);
    const after = countPickups();
    if (selected && JSON.stringify(before) === JSON.stringify(after)) (recovery.failedEntities ||= []).push(selected.id);
    save(); bot.emit?.('death_recovery', recovery);
    return true;
  } catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
    return finish(`could not safely reach the dropped items: ${err.message}`);
  } finally {
    // A pickup can precede stop/disconnect while navigation is unwinding. Keep
    // that observed progress in the same checkpoint, without counting it twice.
    Object.assign(movement, previous); task.interruptCheck = previousInterrupt;
    countPickups();
  }
}

module.exports = { recordDeath, recoverItems, observeAliveInventory, STANCE_KEYS };
