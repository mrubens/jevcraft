'use strict';
// A camp at the Nether portal (note 2809): the bed carried placed beside the Overworld portal and made the respawn
// point, a chest beside it, and in the chest the kit a bare body needs to go straight back in (a stone sword, a stone
// pickaxe, a stack of blocks, food). The user, 2026-11-10: 'make death cheap: a spare kit in a chest and the spawn
// point set at the portal'. The middle batch of 2026-11-09 and 10 (37 trials on one build): 32 died once, 31 of them
// in full iron, a median 38 minutes in, and 59 in 100 of the batch's minutes came after that death; the respawn
// point stood a median 188 blocks from the portal (14 to 558), the bot was back in the Nether a median 36 minutes
// after a death in a kit, 17 of 36 died again bare first and 8 reached their drops. The pieces stood already (a
// chest by the bed slept in, bed-kit.js; the bed by the End's ring, end-supplies.js), each an option among a dozen
// on a crowded question, wherever the bed happened to be: kit_by_bed was answered 3 times in the batch.
//
// Asked on its own (portal_camp), with the batch's record and the two costs set side by side (asked of Jev in four
// situations before it shipped: 0.24 to 0.46 for the camp without that sentence, 0.55 to 0.82 with it): where a portal is known within 32 blocks, a bed is
// carried, no camp stands by a portal and nothing hostile is within 12. In the Nether the way is out through the
// portal first (an errand), then the camp, then the ladder as it was.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');

const NEAR_PORTAL = 32, CAMP_REACH = 24, ASK_AGAIN_MS = 30 * 60000, FAILED_MS = 20 * 60000, BLOCKS = 32, FOOD_POINTS = 12, FOOD_KEPT = 20;
const ERRAND = 'the camp at the portal';
const RECORD = 'In the batch of 2026-11-09 and 10 (37 trials on one build): 32 died once, 31 of them in full iron, a median 38 minutes after entering the Nether; the respawn point stood a median 188 blocks from the portal (14 to 558); after a death in a kit the bot was back in the Nether a median 36 minutes later, 17 of 36 died again with nothing worn before any kit was back, and 59 in 100 of all the minutes played came after a first death. No trial has had a camp at its portal: what it saves is the walk and the kit made again, by this record, not a count of its own.';
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dim = bot => (/nether/.test(String(bot.game?.dimension || '')) ? 'nether' : /end/.test(String(bot.game?.dimension || '')) ? 'end' : 'overworld');
const nearest = (goal, where, at) => (goal.portals || []).filter(p => p.dimension === where).slice().sort((a, b) => flat(a, at) - flat(b, at))[0] || null;
const bedCarried = bot => (bot.inventory?.items?.() || []).find(i => /_bed$/.test(i.name)) || null;
const BLOCK = /^(cobblestone|cobbled_deepslate|netherrack|dirt|blackstone)$/;

// The camp that stands: the respawn bed within CAMP_REACH of an Overworld portal, with its chest.
function standing(bot, goal) {
  const sb = bot._survivalState?.spawnBed?.foot;
  if (!sb || !Number.isFinite(sb.x)) return null;
  const portal = nearest(goal, 'overworld', sb);
  if (!portal || flat(portal, sb) > CAMP_REACH) return null;
  const chest = goal.bedKit?.bedFoot && Math.hypot(goal.bedKit.bedFoot.x - sb.x, goal.bedKit.bedFoot.z - sb.z) <= 2 ? goal.bedKit : null;
  return { bed: sb, portal, chest, off: Math.round(flat(portal, sb)) };
}

// What the pockets give the chest, leaving the body its own: -> [{ item, count, slot }].
function kitFor(bot) {
  const items = bot.inventory?.items?.() || [], out = [];
  const count = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  if (countOf(bot, 'stone_sword') >= 1 && count(/_(sword|axe)$/) >= 2) out.push({ item: 'stone_sword', count: 1, slot: 'sword' });
  if (countOf(bot, 'stone_pickaxe') >= 1 && count(/_pickaxe$/) >= 2) out.push({ item: 'stone_pickaxe', count: 1, slot: 'pickaxe' });
  // The building block most carried (the first camp's bot carried 134 and no cobblestone among them, and none was left).
  const blocks = items.filter(i => BLOCK.test(i.name)).reduce((m, i) => { m[i.name] = (m[i.name] || 0) + i.count; return m; }, {});
  const most = Object.entries(blocks).sort((a, b) => b[1] - a[1])[0];
  if (most && count(BLOCK) >= BLOCKS * 2 && most[1] >= BLOCKS) out.push({ item: most[0], count: BLOCKS, slot: 'cobblestone' });
  try {
    const foods = require('./healing').foodCarried(bot).slice().sort((a, b) => b.points - a.points);
    const total = foods.reduce((n, f) => n + f.count * f.points, 0);
    let spare = Math.min(FOOD_POINTS, total - FOOD_KEPT);
    for (const f of foods) { if (spare <= 0) break; const n = Math.min(f.count, Math.ceil(spare / f.points)); if (n > 0) { out.push({ item: f.name, count: n, slot: 'food' }); spare -= n * f.points; } }
  } catch (_) { /* no food set aside */ }
  return out;
}

// What the camp would be made of from the pockets as they are, said.
function makingsSay(bot) {
  const items = bot.inventory?.items?.() || [];
  const count = re => items.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
  const planks = count(/_planks$/) + 4 * count(/_(log|stem)$/), cobble = count(BLOCK);
  let food = 0; try { food = require('./healing').foodCarried(bot).reduce((n, f) => n + f.count * f.points, 0); } catch (_) { food = 0; }
  return { bed: bedCarried(bot)?.name || null, chest: countOf(bot, 'chest') >= 1, planks, cobble, sticks: countOf(bot, 'stick'), food };
}

// -> the offer, or null where it is not asked now.
function offer(bot, goal, { now = Date.now() } = {}) {
  if (!goal || goal.kind !== 'win' || bot.game?.gameMode !== 'survival' || !bot.entity?.position) return null;
  const where = dim(bot);
  if (where === 'end' || standing(bot, goal)) return null;
  const c = goal.portalCamp;
  if (c?.choice === 'make') return null;
  if (c?.askedAt && now - c.askedAt < ASK_AGAIN_MS && (goal.survival?.deaths || []).length === (c.deathsThen ?? -1)) return null;
  if (c?.failedAt && now - c.failedAt < FAILED_MS) return null;
  const here = bot.entity.position, portal = nearest(goal, where, here);
  if (!portal || flat(portal, here) > NEAR_PORTAL || !nearest(goal, 'overworld', where === 'overworld' ? here : { x: here.x * 8, z: here.z * 8 })) return null;
  const m = makingsSay(bot);
  if (!m.bed) return null;
  try { if (require('./danger').threats(bot, 12).length) return null; } catch (_) { return null; }
  return { where, portal, off: Math.round(flat(portal, here)), makings: m };
}

// The bed placed beside the bot and used: by day or night the use sets the respawn point (the server's own word).
async function placeAndSet(bot, task, goal, save, actions) {
  const { bedSiteNear } = require('./survival'), { placeOriented, isBed } = require('./home-base');
  const bed = bedCarried(bot), site = bedSiteNear(bot);
  if (!bed) throw new Error('no bed is carried');
  if (!site) throw new Error('no two level cells beside the bot for the bed');
  goal.step = { action: 'portal_camp', doing: 'the bed', at: { x: site.foot.x, y: site.foot.y, z: site.foot.z } }; save();
  await placeOriented(bot, task, actions, site.stand, site.foot, bed.name, () => isBed(bot.blockAt(site.foot)) && isBed(bot.blockAt(site.head)));
  const set = await new Promise(resolve => {
    let done = false; const finish = ok => { if (done) return; done = true; bot.off?.('message', on); resolve(ok); };
    const on = m => { const key = m?.json?.translate || m?.translate || String(m || ''); if (/set_spawn|respawn point set/i.test(key)) finish(true); };
    bot.on?.('message', on);
    Promise.resolve().then(() => bot.activateBlock(bot.blockAt(site.foot))).catch(() => {});
    setTimeout(() => finish(false), 3000);
  });
  // By night the use is a sleep: the point is set by it, and the bot is up again at once (the night's sleep stays
  // the survival layer's).
  const slept = !!bot.isSleeping;
  if (slept) { try { await bot.wake(); } catch (_) { /* up at dawn */ } }
  if (!set && !slept) throw new Error('the bed was placed and the server did not say the respawn point was set');
  if (bot._survivalState) bot._survivalState.spawnBed = { name: bed.name, foot: { x: site.foot.x, y: site.foot.y, z: site.foot.z }, head: { x: site.head.x, y: site.head.y, z: site.head.z }, at: new Date().toISOString(), camp: true };
  save();
  return site;
}

// The chest beside the camp's bed (bed-kit.js: the home of one bed) and the kit in it: a stone sword and a stone
// pickaxe made from the pockets where a second of each is not carried, cobblestone, food past what the body keeps.
// Its own step, so a camp whose chest did not go down is finished at the next step there (note 2813: the first camp
// made, mid-full-19-campdrill-5 on 25585 at 17:02Z on 2026-11-10, set its respawn point and had no chest).
async function stockCamp(bot, task, goal, save, actions) {
  const acts = { ...(actions.stashActions || {}), acquireStep: actions.acquireStep };
  const tolerate = err => { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name)) throw err; return String(err?.message || err).slice(0, 160); };
  const bk = require('./bed-kit'), stash = require('./home-stash');
  const out = { left: [], notes: [], chest: null };
  let home = bk.bedKitHome(bot, goal);
  if (!home) { out.notes.push('the bed is not read as the respawn bed'); return out; }
  try {
    if (!home.stash?.position) await bk.placeBedChest(bot, task, goal, save, home, acts);
    home = bk.bedKitHome(bot, goal) || home;
  } catch (err) { out.notes.push(`no chest: ${tolerate(err)}`); }
  if (!home.stash?.position) return out;
  out.chest = home.stash.position;
  for (const item of ['stone_sword', 'stone_pickaxe']) {
    if (countOf(bot, item) >= 1) continue;
    goal.step = { action: 'portal_camp', doing: `a spare ${item.replace('_', ' ')}` }; save();
    try { for (let i = 0; i < 5 && countOf(bot, item) < 1; i++) { task.check(); if (await acts.acquireStep(bot, task, item, 1, goal, save) === true) break; } }
    catch (err) { out.notes.push(`${item}: ${tolerate(err)}`); }
  }
  try {
    const armour = stash.spareArmour(bot, home).filter(n => countOf(bot, n) >= 1).map(n => ({ item: n, count: 1, slot: 'armour' }));
    const stored = await stash.stockStash(bot, task, goal, save, home, acts, { only: () => false, extra: [...kitFor(bot), ...armour] });
    out.left = (stored || []).map(m => `${m.count} ${m.item.replaceAll('_', ' ')}`);
  } catch (err) { out.notes.push(`stocking: ${tolerate(err)}`); }
  return out;
}

async function makeCamp(bot, task, goal, save, actions) {
  const acts = { ...(actions.stashActions || {}), acquireStep: actions.acquireStep };
  const site = await placeAndSet(bot, task, goal, save, acts);
  const stocked = await stockCamp(bot, task, goal, save, actions);
  return { bed: { x: site.foot.x, y: site.foot.y, z: site.foot.z }, ...stocked };
}

// The bare body by its camp takes the kit out of the chest (the kit is its own; what it does next is the trip's
// question, corpse-run.js kitTrip). -> true when something was taken.
async function takeKit(bot, task, goal, save, actions) {
  if (dim(bot) !== 'overworld') return false;
  const camp = standing(bot, goal);
  if (!camp?.chest?.position || Math.hypot(camp.chest.position.x - bot.entity.position.x, camp.chest.position.z - bot.entity.position.z) > 16) return false;
  const items = bot.inventory?.items?.() || [];
  if (items.some(i => /_(sword|axe)$/.test(i.name)) && items.some(i => /_pickaxe$/.test(i.name))) return false;
  if (goal.portalCamp?.tookAt && Date.now() - goal.portalCamp.tookAt < 120000) return false;
  const bk = require('./bed-kit'), stash = require('./home-stash'), home = bk.bedKitHome(bot, goal);
  if (!home?.stash?.position) return false;
  (goal.portalCamp ||= {}).tookAt = Date.now();
  goal.step = { action: 'portal_camp', doing: 'the kit out of the chest', at: { ...home.stash.position } }; save();
  const acts = { ...(actions.stashActions || {}), acquireStep: actions.acquireStep };
  try {
    // By what is in it when the lid is up (the chest's remembered contents are from before it was stocked), in up to
    // three passes: the first taking-out (mid-full-19-campdrill-7, 25585, 2026-11-10 17:16:35Z, two seconds after the
    // body came back) moved the 32 netherrack and left the sword, the pickaxe and the beef, each move's failure unsaid.
    const took = await stash.withChest(bot, task, goal, save, home, acts, async window => {
      const out = [], failed = [];
      for (let pass = 0; pass < 3; pass++) {
        const there = window.containerItems();
        if (!there.length) break;
        if (pass) await new Promise(resolve => setTimeout(resolve, 400));
        for (const it of there) {
          task.check();
          try { await window.withdraw(it.type, null, it.count); out.push(`${it.count} ${it.name.replaceAll('_', ' ')}`); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err; failed.push(`${it.name} (pass ${pass + 1}): ${String(err?.message || err).slice(0, 80)}`); }
        }
      }
      if (failed.length) console.log(`[portal_camp] not taken at once: ${failed.join('; ')}`);
      const left = window.containerItems().map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`);
      if (left.length) console.log(`[portal_camp] still in the chest: ${left.join(', ')}`);
      try { stash.rememberContents(home, window); } catch (_) { /* read at the next opening */ }
      return out;
    });
    if (goal.portalCamp) goal.portalCamp.left = [];
    save();
    if (took.length) { bot.chat?.(`Back at my camp by the portal: took ${took.join(', ')} out of the chest.`); console.log(`[portal_camp] took ${took.join(', ')} out of the camp's chest`); }
    return took.length > 0;
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name)) throw err; console.log(`[portal_camp] the kit was not taken: ${String(err?.message || err).slice(0, 160)}`); return false; }
}

// The kit in the camp's chest is still to be taken by a body back to life beside it: the trip's question waits for
// it (corpse-run.js kitTrip), so it is asked with the kit in hand. Not after the taking was tried since that death.
function kitWaiting(bot, goal) {
  try {
    if (dim(bot) !== 'overworld' || !bot.entity?.position) return false;
    const camp = standing(bot, goal);
    if (!camp?.chest?.position || Math.hypot(camp.chest.position.x - bot.entity.position.x, camp.chest.position.z - bot.entity.position.z) > 16) return false;
    const items = bot.inventory?.items?.() || [];
    if (items.some(i => /_(sword|axe)$/.test(i.name)) && items.some(i => /_pickaxe$/.test(i.name))) return false;
    const died = Date.parse(goal.corpseRun?.deathAt || '') || 0;
    return !(goal.portalCamp?.tookAt > died);
  } catch (_) { return false; }
}

// The ladder's step: the kit taken, the camp under way, or the question. -> true when the step was spent here.
async function step(bot, task, goal, save, actions, client, { now = Date.now() } = {}) {
  if (!goal || goal.kind !== 'win' || bot.game?.gameMode !== 'survival') return false;
  if (await takeKit(bot, task, goal, save, actions)) return true;
  const c = goal.portalCamp;
  // A camp that stands with no chest, or nothing in it, is finished from where the bot is by it (note 2813).
  if (c?.made && dim(bot) === 'overworld' && now - (c.stockTriedAt || 0) > 10 * 60000) {
    const camp = standing(bot, goal);
    if (camp && Math.hypot(camp.bed.x - bot.entity.position.x, camp.bed.z - bot.entity.position.z) <= 16 && (!camp.chest?.position || !(c.left || []).length) && (bot.inventory.items().some(i => /_(sword|axe)$/.test(i.name)) && bot.inventory.items().some(i => /_pickaxe$/.test(i.name)))) {
      c.stockTriedAt = now; save();
      const stocked = await stockCamp(bot, task, goal, save, actions);
      c.left = stocked.left; c.notes = stocked.notes; save();
      console.log(`[portal_camp] the chest ${stocked.chest ? 'stands' : 'did not go down'}; left ${stocked.left.join(', ') || 'nothing'}${stocked.notes.length ? `; ${stocked.notes.join('; ')}` : ''}`);
      return true;
    }
  }
  if (c?.choice === 'make') {
    if (now - c.at > 20 * 60000 || standing(bot, goal)) { delete c.choice; save(); return false; }
    const where = dim(bot);
    if (where === 'nether') {
      // Out through the portal first: the ladder's own return (game-progress.js errandStage).
      if (goal.errand?.for !== ERRAND) { goal.errand = { dimension: 'overworld', items: [], for: ERRAND, at: now }; save(); }
      return false;
    }
    if (where !== 'overworld') { delete c.choice; save(); return false; }
    const here = bot.entity.position, portal = nearest(goal, 'overworld', here);
    if (!portal || flat(portal, here) > NEAR_PORTAL) {
      if (!portal) { delete c.choice; save(); return false; }
      goal.step = { action: 'portal_camp', doing: 'the walk to the portal', portal: { x: portal.x, y: portal.y, z: portal.z } }; save();
      try { await actions.stashActions.navigate(bot, task, new goals.GoalNear(portal.x, portal.y, portal.z, 6), { timeoutMs: 60000, stallMs: 8000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name)) throw err; }
      return true;
    }
    try {
      const made = await makeCamp(bot, task, goal, save, actions);
      goal.portalCamp = { ...c, choice: undefined, made: true, madeAt: now, stockTriedAt: now, bed: made.bed, portal: { x: portal.x, y: portal.y, z: portal.z }, left: made.left, notes: made.notes };
      delete goal.portalCamp.choice;
      bot.chat?.(`Camp made by the portal: the bed is my respawn point${made.left.length ? `, and the chest holds ${made.left.join(', ')}` : ''}.`);
      console.log(`[portal_camp] made at (${made.bed.x}, ${made.bed.y}, ${made.bed.z}), ${Math.round(flat(portal, made.bed))} blocks from the portal; left ${made.left.join(', ') || 'nothing'}${made.notes.length ? `; ${made.notes.join('; ')}` : ''}`);
    } catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err?.name)) throw err;
      goal.portalCamp = { askedAt: c.askedAt, deathsThen: c.deathsThen, failedAt: now, failed: String(err?.message || err).slice(0, 160) };
      console.log(`[portal_camp] not made: ${goal.portalCamp.failed}`);
    }
    save();
    return true;
  }
  if (!client) return false;
  const o = offer(bot, goal, { now });
  if (!o) return false;
  const m = o.makings;
  const through = o.where === 'nether' ? `out through the portal ${o.off} blocks off, ` : '';
  const chestSays = m.chest ? 'the chest carried' : m.planks >= 8 ? `a chest from 8 of the ${m.planks} planks' worth of wood carried` : `no chest (${m.planks} planks' worth of wood carried, 8 wanted)`;
  const sb = bot._survivalState?.spawnBed?.foot, op = nearest(goal, 'overworld', o.where === 'overworld' ? bot.entity.position : { x: bot.entity.position.x * 8, z: bot.entity.position.z * 8 });
  const respawnNow = sb && op ? `a bed ${Math.round(flat(sb, op))} blocks from the Overworld portal` : sb ? 'a bed' : 'the world spawn';
  const tree = {
    make_camp: { description: `Make camp at the portal now: ${through}the ${m.bed.replaceAll('_', ' ')} carried placed beside the portal on the Overworld side and used, which sets the respawn point there by day or night; ${chestSays} beside it; and in it a stone sword and a stone pickaxe (made from the ${m.cobble} blocks and the wood carried where a second is not), ${BLOCKS} blocks and about ${FOOD_POINTS} food points of the ${m.food} carried past the ${FOOD_KEPT} the body keeps. About two to four minutes${o.where === 'nether' ? ', the two crossings with it' : ''}, then on as before. After it a death anywhere brings the bot back to life beside the portal with that kit a step away, and what it dropped lies ahead of it, not ageing until it is near. Set beside the record: these few minutes once, against a median 36 minutes after each death in a kit, in trials where 32 of 37 died at least once. The bed stays there: the nights after are without it unless another is made.` },
    go_on: { description: `Go on without a camp: the bed stays carried, and a death brings the bot back to life at ${respawnNow} with empty hands, as in the record. Asked again at a portal after half an hour or a death.` },
  };
  const state = { record: RECORD, dimension: o.where, portalBlocksOff: o.off, respawnPointNow: respawnNow, carried: m, health: bot.health, food: bot.food, deathsThisRun: (goal.survival?.deaths || []).length };
  const decision = await require('./decisions').decide('portal_camp', { client, bot, task, goal, save, tree, state });
  if (decision.stale) return false;
  const pick = decision.path.at(-1);
  goal.portalCamp = { ...(goal.portalCamp || {}), askedAt: now, deathsThen: (goal.survival?.deaths || []).length, ...(pick === 'make_camp' ? { choice: 'make', at: now } : {}) };
  delete goal.portalCamp.failedAt;
  save();
  return pick === 'make_camp';
}

module.exports = { step, offer, standing, kitFor, makeCamp, stockCamp, takeKit, kitWaiting, makingsSay, RECORD, ERRAND, NEAR_PORTAL };
