'use strict';
// The way through the Nether between the End portal and a chest of the
// bot's far off in the Overworld (note 1279): a block walked there is eight
// here. Asked of Jev once for each chest: through_nether casts or finds a
// portal on this side, walks the Nether to the portal by the chest, takes
// what is in it, and comes back the same way with the eyes; walk goes over
// the ground as before. goal.netherShortcut = { chest, phase: 'out' | 'back', at }.
const FAR = 600;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SAYS = '25597 (2026-10-05) walked from its home to its stronghold in 3 h 44 min (00:59 to 04:43Z), 1,800 blocks with seas and a hilltop on the way';
const ERRAND = 'the way through the Nether';
const stronghold = goal => goal?.gameProgress?.milestones?.stronghold_located?.center || goal?.endPortal?.center || null;

async function ask(bot, task, goal, save, chest, far) {
  const sh = stronghold(goal);
  if (!sh || goal.kind !== 'win') return false;
  const held = goal.netherShortcut;
  if (held && held.chest && held.chest.x === chest.x && held.chest.z === chest.z) return false;
  if (goal.netherShortcutAsked && goal.netherShortcutAsked.x === chest.x && goal.netherShortcutAsked.z === chest.z) return false;
  const nether = Math.round(far / 8);
  const tree = {
    through_nether: { description: `Go there and back through the Nether: a portal on this side (one remembered within 600 blocks, or one made here, a few minutes with the lava and water about), ${nether} blocks in the Nether to the portal by the chest and as many back, in place of ${far} on foot each way here. Nothing of the goal's is carried on the way there: the eyes stay in the chest until it is reached. Coming back the eyes are carried through the Nether, and a death there drops them a dimension from the bed; on 2026-10-04 (16:00 to 19:00Z) seventeen of the trials' deaths were in the Nether, most to piglins with no gold on, blazes, and lava.` },
    walk: { description: `Walk there over the ground and back, ${far} blocks each way. ${SAYS}. A death on the ground on the way back drops the eyes nearer the bed than one in the Nether.` },
  };
  goal.netherShortcutAsked = { x: chest.x, z: chest.z, at: Date.now() }; save?.();
  const decision = await require('./decisions').decide('nether_shortcut', { client: task.opportunityClient, bot, task, goal, save, tree, state: { blocksOnFoot: far, blocksInTheNether: nether } });
  if (decision.stale || decision.path.at(-1) !== 'through_nether') return false;
  goal.netherShortcut = { chest: { ...chest }, phase: 'out', at: Date.now() };
  goal.errand = { dimension: 'nether', items: [], for: ERRAND, at: Date.now() };
  bot.chat?.(`Through the Nether for them: ${nether} blocks there in place of ${far} here.`);
  save?.();
  return true;
}

// The portal's own kit carried (note 2782): ten obsidian, a lighter, three blocks to stand the lintel on.
function portalKit(bot) {
  const n = name => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((a, i) => a + i.count, 0);
  let supports = 0; try { supports = require('./build-sites').portalSupports(bot).count; } catch (_) { supports = 0; }
  return n('obsidian') >= 10 && n('flint_and_steel') + n('fire_charge') > 0 && supports >= 3;
}
// To the stronghold through the Nether with a portal built under it (note 2783, the user 2026-11-01 'Yes do both': the
// speedrunners' blind travel): in the Overworld, the bearings' estimate more than FAR off, the stronghold not yet found,
// the portal's kit carried and a portal known within FAR, asked once for each estimate.
function blindDue(bot, goal) {
  const est = goal?.strongholdSearch?.estimate, here = bot.entity?.position;
  if (!est || !here || stronghold(goal) || goal.kind !== 'win' || goal.netherShortcut) return null;
  if (!/overworld/.test(String(bot.game?.dimension || ''))) return null;
  const far = Math.round(flat(here, est));
  if (far <= FAR) return null;
  if (goal.blindAsked && flat(goal.blindAsked, est) < 64) return null;
  if (!portalKit(bot)) return null;
  const portal = (goal.portals || []).filter(p => p.dimension === 'overworld').sort((a, b) => flat(a, here) - flat(b, here))[0];
  if (!portal || flat(portal, here) > FAR) return null;
  return { est, far, portal, portalOff: Math.round(flat(portal, here)) };
}
async function askBlind(bot, task, goal, save) {
  const d = blindDue(bot, goal);
  if (!d) return false;
  goal.blindAsked = { x: d.est.x, z: d.est.z, at: Date.now() }; save?.();
  const tx = Math.round(d.est.x / 8), tz = Math.round(d.est.z / 8);
  const tree = {
    through_nether: { description: `Go to the stronghold's estimate at (${Math.round(d.est.x)}, ${Math.round(d.est.z)}) through the Nether: in by the portal ${d.portalOff} blocks off, about ${Math.round(d.far / 8)} blocks there to under the estimate, (${tx}, ${tz}), a portal built there from the ten obsidian carried and lit, and out in the Overworld near the estimate, where the eyes are thrown again; in place of ${d.far} blocks on foot. No eye of ender goes through with the bot (they are put away first). ${SAYS}.` },
    walk: { description: `Walk the ${d.far} blocks to the estimate over the ground, the eyes thrown on the way as before. ${SAYS}.` },
  };
  const decision = await require('./decisions').decide('blind_travel', { client: task.opportunityClient, bot, task, goal, save, tree, state: { blocksOnFoot: d.far, blocksInTheNether: Math.round(d.far / 8), estimate: { x: Math.round(d.est.x), z: Math.round(d.est.z) } } });
  if (decision.stale || decision.path.at(-1) !== 'through_nether') return false;
  goal.netherShortcut = { phase: 'blind', target: { x: d.est.x, z: d.est.z }, at: Date.now() };
  goal.errand = { dimension: 'nether', items: [], for: ERRAND, at: Date.now() };
  bot.chat?.(`To the stronghold through the Nether: ${Math.round(d.far / 8)} blocks there in place of ${d.far} here, a portal built under it.`);
  save?.();
  return true;
}
// Where the way out of the Nether should come out: the chest on the way
// there, the End portal on the way back. -> {x, z} or null
function exitTarget(goal) {
  const s = goal?.netherShortcut;
  if (s?.phase === 'out') return s.chest;
  if (s?.phase === 'blind') return s.target;
  return stronghold(goal);
}

// Kept up at each step: out and come within reach of the chest, the way
// back begins; back in the Overworld far from the End portal with the eyes,
// into the Nether again; at the End portal, done.
function settle(bot, goal, save, { eyesCarried = 0, wanted = 12 } = {}) {
  const s = goal?.netherShortcut;
  if (!s || !/overworld/.test(String(bot.game?.dimension || ''))) return;
  const here = bot.entity.position, sh = stronghold(goal);
  const ours = goal.errand?.for === ERRAND;
  // Out near the estimate, or the stronghold found meanwhile: the blind travel is done (note 2783).
  if (s.phase === 'blind' && (flat(here, s.target) <= 256 || sh)) { delete goal.netherShortcut; if (ours) delete goal.errand; save?.(); return; }
  if (s.phase === 'blind') return;
  // Out for a corpse run's drop (note 1393): arrived within reach, the way is
  // done; the corpse run walks the rest.
  if (s.for === 'corpse_run' && flat(here, s.chest) <= FAR) { delete goal.netherShortcut; if (ours) delete goal.errand; save?.(); return; }
  if (s.phase === 'out' && flat(here, s.chest) <= FAR) { s.phase = 'back'; if (ours) delete goal.errand; save?.(); }
  if (s.phase === 'back' && sh && flat(here, sh) <= FAR) { delete goal.netherShortcut; if (goal.errand?.for === ERRAND) delete goal.errand; save?.(); return; }
  // Back with nothing to carry yet (the chest not reached): no errand into the Nether.
  if (s.phase === 'back' && eyesCarried < wanted && goal.errand?.for === ERRAND) { delete goal.errand; save?.(); }
  // Back through the Nether only where a portal comes out by the End
  // portal: with none there the way back would come out where it went in
  // (note 1282). 25597 (2026-10-05 05:30Z) died by its stronghold before its
  // portal there was lit and came back to life by its chest at home.
  const portalBy = sh && (goal.portals || []).some(p => p.dimension === 'overworld' && flat(p, sh) <= FAR);
  if (s.phase === 'back' && sh && !portalBy) { delete goal.netherShortcut; if (goal.errand?.for === ERRAND) delete goal.errand; save?.(); return; }
  if (s.phase === 'back' && sh && flat(here, sh) > FAR && eyesCarried >= wanted && !(goal.errand?.for === ERRAND && goal.errand.dimension === 'nether')) {
    goal.errand = { dimension: 'nether', items: [], for: ERRAND, at: Date.now() }; save?.();
  }
}
const carriesEyesBack = goal => goal?.netherShortcut?.phase === 'back';
const blindTarget = goal => goal?.netherShortcut?.phase === 'blind' ? goal.netherShortcut.target : null;

module.exports = { FAR, ERRAND, ask, askBlind, blindDue, blindTarget, portalKit, exitTarget, settle, carriesEyesBack };
