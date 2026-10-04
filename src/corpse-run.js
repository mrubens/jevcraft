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

const WORTH = /^(diamond|emerald|iron_ingot|gold_ingot|raw_iron|raw_gold|blaze_rod|blaze_powder|ender_pearl|ender_eye|obsidian|shield|bow|crossbow|arrow|bucket|water_bucket|lava_bucket|flint_and_steel|golden_apple|enchanted_golden_apple|trial_key|ominous_trial_key|ancient_debris|netherite_ingot|netherite_scrap|diamond_block|iron_block|gold_block|golden_carrot|cooked_beef|cooked_porkchop|cooked_mutton|bread)$|_(helmet|chestplate|leggings|boots|sword|pickaxe|axe)$/;
const CHEAP = /^(wooden|stone)_(sword|pickaxe|axe)$/;
const TICKING = 128, DESPAWN_MS = 5 * 60000, MARGIN_MS = 20000, KEEP_MS = 3 * 3600000, LEG_MS = 120000, ARRIVE = 6, FAR = 96, LEG = 64, TURNS = [0, 50, -50, 90, -90];
const ARMOUR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
const dim = name => String(name || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
// Three dimensions: a death in a mine under the bed is not beside the bed.
const flat = (a, b) => Math.hypot(a.x - b.x, (a.y ?? b.y) - (b.y ?? a.y), a.z - b.z);

// What making the dropped things again takes, said beside leaving them:
// 25594 (2026-10-04 06:17Z), asked to go 853 blocks back for twelve eyes of
// ender, a diamond sword and its iron armor against 'what was dropped is
// made again, or found, later', left them at 0.56 to 0.42. The eyes were
// ninety hours of the run.
const TOLD = 4;
function madeAgain(items = {}) {
  const out = [];
  const n = name => items[name] || 0;
  const eyes = n('ender_eye'), pearls = n('ender_pearl') + eyes, rods = n('blaze_rod') + Math.ceil((eyes + n('blaze_powder')) / 2);
  if (pearls) out.push(`${pearls} ender pearl${pearls > 1 ? 's' : ''} from endermen or piglin barter`);
  if (rods) out.push(`${rods} blaze rod${rods > 1 ? 's' : ''} from a fortress's blazes`);
  const iron = n('iron_helmet') * 5 + n('iron_chestplate') * 8 + n('iron_leggings') * 7 + n('iron_boots') * 4 + n('iron_sword') * 2 + n('iron_pickaxe') * 3 + n('shield') + n('bucket') * 3 + n('water_bucket') * 3 + n('iron_ingot') + n('raw_iron');
  if (iron) out.push(`${iron} iron mined and smelted`);
  const diamonds = Object.entries(items).reduce((sum, [name, c]) => sum + c * ({ diamond: 1, diamond_sword: 2, diamond_pickaxe: 3, diamond_axe: 3, diamond_helmet: 5, diamond_chestplate: 8, diamond_leggings: 7, diamond_boots: 4 }[name] || 0), 0);
  if (diamonds) out.push(`${diamonds} diamond${diamonds > 1 ? 's' : ''} found`);
  if (n('bow')) out.push('a bow made of three strings or taken from a skeleton');
  if (n('arrow')) out.push(`${n('arrow')} arrows from skeletons`);
  return out.join(', ');
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
      .filter(d => d.at !== goal.corpseRun?.deathAt && now - Date.parse(d.at) < KEEP_MS && dim(d.dimension) !== 'end' && !d.lava && d.position && Object.keys(worth(tally(d.worn || []))).length)
      .map(d => ({ deathAt: d.at, position: { ...d.position }, dimension: dim(d.dimension), items: worth(tally(d.worn || [])), more: true, passes: 0, stuck: 0, status: 'open', respawn: null })).slice(-3);
  }
  if ((goal.corpseRunFor || goal.corpseRun?.deathAt) !== death.at) {
    if (recovery?.at !== death.at || recovery.status === 'pending') return null;
    const old = goal.corpseRun;
    if (old && ['open', 'left', 'unreachable'].includes(old.status) && !old.loadedAt && Object.keys(old.items || {}).length && !goal.corpseRunsEarlier.some(r => r.deathAt === old.deathAt)) goal.corpseRunsEarlier = [...goal.corpseRunsEarlier, old].slice(-3);
    goal.corpseRunFor = death.at;
    // What was worn drops with the rest (recovery.js records it apart from
    // the pockets): mid-242-aa's iron helmet and chestplate were never on
    // its list (note 559).
    const dropped = { ...(recovery.inventoryBeforeDeath || {}) };
    for (const name of death.worn || []) dropped[name] = (dropped[name] || 0) + 1;
    const items = worth(dropped);
    for (const [name, count] of Object.entries(recovery.recovered || {})) if (items[name] && (items[name] -= count) <= 0) delete items[name];
    const where = dim(death.dimension);
    goal.corpseRun = { deathAt: death.at, position: { ...death.position }, dimension: where, items, passes: 0, stuck: 0,
      status: where === 'end' ? 'void' : death.lava ? 'burned' : Object.keys(items).length ? 'open' : 'nothing',
      respawn: dim(bot.game?.dimension) === where ? { ...bot.entity.position } : null };
  }
  let run = goal.corpseRun;
  const settle = r => {
    if (r.status === 'unreachable' && !r.loadedAt) { r.status = 'open'; delete r.choice; r.stalled = r.stalled || { walks: r.stuck || 3 }; r.stuck = 0; }
    if (r.status === 'left' && !r.loadedAt && r.more && !r.toldEyes && eyesLostBy(bot, goal, r)) { r.status = 'open'; delete r.choice; }
    if (r.status === 'left' && !r.loadedAt && r.told !== TOLD) { r.status = 'open'; delete r.choice; delete r.stalled; r.stuck = 0; }
    if (r.status === 'open' && now - Date.parse(r.deathAt) > KEEP_MS) r.status = 'stale';
  };
  // The last death's run closed (or none made for it): the latest of the
  // earlier ones still open is the run in hand, asked of Jev as its own.
  if (run) settle(run);
  while (run?.status !== 'open' && goal.corpseRunsEarlier.length) {
    goal.corpseRunFor = goal.corpseRunFor || run?.deathAt || death.at;
    run = goal.corpseRun = goal.corpseRunsEarlier.pop(); delete run.choice; delete run.announced;
    settle(run);
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
  if (run.loadedAt && now - Date.parse(run.loadedAt) > DESPAWN_MS - MARGIN_MS) { run.status = 'despawned'; return null; }
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

async function corpseRunStep(bot, task, goal, save, { move = navigate, collect = collectNearbyDrops, surface = null } = {}) {
  const run = corpseRun(bot, goal);
  if (!run) { save(); return false; }
  const spot = new Vec3(run.position.x, run.position.y, run.position.z);
  // Jev's to weigh, once a death: what was about when the bot died there,
  // against what it would get back.
  const client = task.opportunityClient;
  if (!run.choice) {
    const death = (goal.survival?.deaths || []).find(d => d.at === run.deathAt) || (goal.survival?.deaths || []).at(-1) || {};
    const about = (death.about || []).map(t => `a ${t.name.replaceAll('_', ' ')} ${t.distance} blocks off`).join(', ');
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
    const earlier = run.more ? ' This is a death before the last: what else it carried then is not on this list (what lies there is taken with the rest), and its drops last only if the bot has not been within 128 blocks of them since.' : '';
    const others = (goal.corpseRunsEarlier || []).filter(r => r.dimension === run.dimension).map(r => `${listed(r.items)}${r.more ? ' and what else it carried then' : ''}, ${Math.round(flat(bot.entity.position, r.position))} blocks from here and ${Math.round(flat(spot, r.position))} from these`);
    const alsoLying = others.length ? ` From a death before this one there also lie: ${others.join('; ')}; that is asked of after this.` : '';
    const stalled = run.stalled ? ` ${run.stalled.walks} walks toward them${run.stalled.at ? ` from about (${run.stalled.at.x}, ${run.stalled.at.z})` : ''} got no nearer, straight and to each side${run.stalled.error ? ` (the last: ${run.stalled.error})` : ''}.` : '';
    const eyes = eyesLostBy(bot, goal, run);
    if (eyes) run.toldEyes = true;
    const eyesSay = eyes ? ` The eyes of ender this run had made before that death are not carried, in a chest or in the portal's frames now: they dropped at a death since, this one or one after it, and the goal wants ${eyes}.` : '';
    const again = madeAgain({ ...run.items, ...(eyes ? { ender_eye: eyes } : {}) }), minutes = Math.max(1, Math.round(far / 4.3 / 60));
    run.told = TOLD;
    const tree = {
      go_back: { description: `Go back for ${listed(run.items)}: ${far} blocks off${far >= 100 ? `, about ${minutes} minute${minutes > 1 ? 's' : ''}' walk` : ''}${Math.abs(spot.y - bot.entity.position.y) > 4 ? `, at y ${Math.round(spot.y)}` : ''}. ${left === null ? 'They last until the bot comes within 128 blocks, then five minutes.' : `About ${left} seconds before they vanish.`} ${death.cause ? `The bot ${death.cause} there; when it died, ` : 'When the bot died there, '}${about ? `about it were ${about}` : 'nothing hostile was in view'}; it wore ${death.worn?.length ? death.worn.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} then and wears ${wornNow.length ? wornNow.map(n => n.replaceAll('_', ' ')).join(', ') : 'no armour'} now. ${hour}${stalled}${earlier}${eyesSay}${alsoLying}` },
      leave_them: { description: `Leave them and go on with what is carried: ${listed(worth(Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])))) || 'nothing worth listing'}. What was dropped is made again, or found, later${again ? `: ${again}` : ''}.${keptSays}` },
    };
    // By night, and the drops not ageing (the bot not within 128 blocks of
    // them): going when it is day is a choice of its own, not leaving them.
    if (night && until !== null && !run.loadedAt && /overworld/.test(run.dimension)) tree.wait_for_day = { description: `Go back for them when it is day, about ${until} real minute${until === 1 ? '' : 's'} off, and go on with the night as it is until then: the drops do not age while the bot is not within 128 blocks of them. Asked again at dawn.` };
    const decision = await require('./decisions').decide('corpse_run', { client, bot, task, goal, save, tree,
      state: { distance: far, secondsLeft: left, aboutAtDeath: death.about || [], wornAtDeath: death.worn || [], wornNow, night, ...(until !== null ? { [night ? 'minutesToDawn' : 'minutesToNight']: until } : {}), ...(run.stalled ? { walksThatGotNoNearer: run.stalled } : {}), ...(kept ? { inAChest: kept } : {}) } });
    if (decision.stale) return false;
    if (decision.path.at(-1) === 'wait_for_day') { run.waitUntil = Date.now() + until * 60000; save(); return false; }
    run.choice = decision.path.at(-1); save();
    if (run.choice === 'leave_them') { run.status = 'left'; save(); return false; }
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
    const leg = before > FAR ? new goals.GoalNearXZ(Math.round(here.x + Math.cos(bearing) * LEG), Math.round(here.z + Math.sin(bearing) * LEG), 4) : new goals.GoalNear(spot.x, spot.y, spot.z, 3);
    let failed = null;
    try { await move(bot, task, leg, { timeoutMs: LEG_MS, stallMs: 8000, sprint: true, passing: /nether/.test(String(bot.game?.dimension || '')) }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; failed = String(err.message || err).slice(0, 120); }
    const after = flat(bot.entity.position, spot);
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
  let got = 0;
  for (const name of Object.keys(run.items)) {
    for (let tries = 0; tries < 4 && run.items[name] > 0; tries++) {
      task.check();
      const had = countOf(bot, name);
      try { await collect(bot, task, name, { origin: spot, radius: 12, timeoutMs: 12000, allowExcavation: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      const gained = countOf(bot, name) - had;
      if (gained <= 0) break;
      got += gained;
      if ((run.items[name] -= gained) <= 0) delete run.items[name];
    }
  }
  run.passes++;
  if (got) await wearRecovered(bot);
  if (!Object.keys(run.items).length) { run.status = 'done'; bot.chat?.('Got my things back.'); }
  else if (!got || run.passes >= 2) {
    run.status = got ? 'partial' : 'gone';
    bot.chat?.(got ? `Got some of it back. The rest is gone: ${listed(run.items)}.` : `Nothing left where I died. Lava or time took it.`);
  }
  save();
  return true;
}

module.exports = { corpseRun, corpseRunStep, worth, madeAgain };
