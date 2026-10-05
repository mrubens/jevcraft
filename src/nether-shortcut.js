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

// Where the way out of the Nether should come out: the chest on the way
// there, the End portal on the way back. -> {x, z} or null
function exitTarget(goal) {
  const s = goal?.netherShortcut;
  if (s?.phase === 'out') return s.chest;
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

module.exports = { FAR, ERRAND, ask, exitTarget, settle, carriesEyesBack };
