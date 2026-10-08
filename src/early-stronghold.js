'use strict';
// The stronghold found before the eyes are all made, and the eyes put in its
// frames as they come (note 1411), each Jev's to choose. By the ladder the
// search began only with all thirteen eyes held, and every set of them was
// carried or kept in a chest far from its portal until then: of the eight
// sets made in the trials on 2026-10-06 none reached a frame, and 25597
// (mid-243-ma-end-3, 2026-10-07 22:24Z) died to phantoms with eleven, 2,100
// blocks from where it came back to life. An eye in a frame stays there
// through any death.
const { eyeTarget } = require('./eye-need');

const count = (bot, name) => (bot.inventory?.items() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const overworld = bot => /overworld/.test(String(bot.game?.dimension || ''));
const banked = goal => { try { return require('./eye-bank').banked(goal); } catch (_) { return 0; } };
const EARLY_EYES = 2, ASK_AGAIN_MS = 30 * 60000, FRAME_ASK_MS = 10 * 60000, CHOICE_MS = 60 * 60000;
const LOST_SAYS = 'Of the eight sets of eyes made in the trials on 2026-10-06, none reached a frame: each was carried or kept in a chest far from its portal, and lost at a death, in lava or to despawning. 25597 (2026-10-07 22:24Z) died to phantoms with eleven eyes, 2,100 blocks from where it came back to life. An eye put in a frame of the portal stays there through any death.';

function portalNeed(goal) {
  const m = goal?.gameProgress?.milestones || {}, ep = goal?.endPortal;
  const frames = Array.isArray(ep?.frames) && ep.frames.length ? ep.frames : m.stronghold_located?.frames;
  return Number.isInteger(ep?.neededEyes) ? ep.neededEyes : Array.isArray(frames) && frames.length ? frames.filter(f => !f.eye).length : null;
}

// The ladder's stage for a choice made, or null.
function earlyStage(bot, goal, now = Date.now()) {
  if (!overworld(bot)) return null;
  const m = goal?.gameProgress?.milestones || {}, held = count(bot, 'ender_eye');
  const fresh = c => c && now - (c.at || 0) < CHOICE_MS;
  if (!m.stronghold_located) {
    const search = goal.strongholdSearch;
    if (goal.earlyStronghold?.pick === 'locate_now' && fresh(goal.earlyStronghold) && (held >= 1 || (search?.estimate && (search.bearings || []).length >= 2)))
      return { phase: 'find_stronghold', action: 'find_stronghold', early: true };
    return null;
  }
  const need = portalNeed(goal);
  if (goal.endPortal?.litAt || !Number.isInteger(need) || need <= 0) return null;
  if (goal.framePlan?.pick === 'fill_now' && fresh(goal.framePlan) && held >= 1 && held < need)
    return { phase: 'fill_end_portal', action: 'fill_end_portal_some', eyes: held, need };
  return null;
}

// Jev's questions, where they are due: true when one was answered.
async function earlyChoices(bot, task, goal, save, client, now = Date.now()) {
  if (!client || !overworld(bot)) return false;
  const m = goal.gameProgress?.milestones || {}, held = count(bot, 'ender_eye'), inChest = banked(goal);
  const decide = (id, tree, state) => require('./decisions').decide(id, { client, bot, task, goal, save, tree, state });
  if (!m.stronghold_located) {
    const target = eyeTarget(goal), have = held + inChest, was = goal.earlyStronghold;
    const searching = (goal.strongholdSearch?.bearings || []).length > 0;
    const due = !was || (was.pick === 'keep_making' && (now - was.at >= ASK_AGAIN_MS || have >= (was.eyes || 0) + 2)) || (was.pick === 'locate_now' && now - was.at >= CHOICE_MS);
    if (searching || have < EARLY_EYES || have >= target || !due) return false;
    const p = bot.entity.position, fromMiddle = Math.round(Math.hypot(p.x, p.z));
    const tree = {
      locate_now: { description: `Find the stronghold now with the ${held} eye${held === 1 ? '' : 's'} carried${inChest ? ` (and ${inChest} in the chest)` : ''}: each is thrown for a bearing, one in five breaks and four in five are picked up again, and two bearings far apart place it. The nearest strongholds stand in a ring 1,280 to 2,816 blocks from the world's middle; the bot is ${fromMiddle} blocks from it. Found, its portal shows how many of its frames come filled (about one in ten), and the eyes made after can go into its frames as they come, where no death can take them. ${LOST_SAYS} The rest are made after, with a trip or more between the portal and the Nether.` },
      keep_making: { description: `Make the rest first: ${target - have} more of the ${target} the goal wants (${held} carried${inChest ? `, ${inChest} in the chest` : ''}), then find the stronghold with all of them and light the portal in one trip. Until then every eye is carried or in the chest.` },
    };
    const decision = await decide('early_stronghold', tree, { eyesHeld: held, eyesInChest: inChest, eyesWanted: target, blocksFromWorldMiddle: fromMiddle });
    if (decision.stale) return false;
    const pick = decision.path.at(-1);
    goal.earlyStronghold = { pick, at: now, eyes: have }; save();
    if (pick === 'locate_now') bot.chat?.(`The stronghold first, with ${held} eye${held === 1 ? '' : 's'}.`);
    return true;
  }
  const need = portalNeed(goal), ep = goal.endPortal;
  if (ep?.litAt || !Number.isInteger(need) || held < 1 || held >= need) return false;
  const was = goal.framePlan;
  if (was && (was.eyes === held || now - was.at < FRAME_ASK_MS) && !(was.pick === 'fill_now' && now - was.at >= CHOICE_MS)) return false;
  const c = ep?.center || m.stronghold_located?.center, p = bot.entity.position;
  const far = c ? Math.round(Math.hypot(p.x - c.x, p.z - c.z)) : null;
  const tree = {
    fill_now: { description: `Go to the End portal${far !== null ? `, ${far} blocks off,` : ''} and put the ${held} eye${held === 1 ? '' : 's'} carried in its frames: ${need} are empty, ${need - held} would be left to fill. ${LOST_SAYS}` },
    keep_carrying: { description: `Keep the ${held} eye${held === 1 ? '' : 's'} carried and go on making the rest (${need - held} more${inChest ? `; ${inChest} in the chest` : ''}); a death drops what is carried where it happens.` },
  };
  const decision = await decide('frame_eyes', tree, { eyesCarried: held, framesEmpty: need, blocksToPortal: far });
  if (decision.stale) return false;
  goal.framePlan = { pick: decision.path.at(-1), at: now, eyes: held }; save();
  return true;
}

module.exports = { EARLY_EYES, LOST_SAYS, earlyStage, earlyChoices, portalNeed };
