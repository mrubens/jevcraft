'use strict';

// Vanilla 26.1 EnderDragonPhase ids. Supply the mechanics explicitly rather
// than asking a general action classifier to infer them from an integer.
const PHASES = ['circling', 'strafing', 'approaching_landing', 'landing', 'taking_off',
  'perched_breathing_fire', 'perched_scanning', 'perched_attacking', 'charging', 'dying', 'hovering'];
const endDecisionInstructions = {
  task: 'Choose the most useful available action NOW in this Ender Dragon fight.',
  mechanics: [
    'Flying dragons can be hurt by arrows. Perched dragons deflect arrows; an offered sword strike can hurt their reachable head.',
    'Listed attacks already have safe footing, reach or a clear arrow trajectory checked by code. Reflexes interrupt any action if new danger appears.',
    'Healing crystals restore the dragon\'s health. When both attacks are available, destroy a healing crystal BEFORE shooting the dragon. Missing entity tracking alone does not prove a crystal is gone.',
  ],
  priorities: [
    'Preserve survival, remove healing crystals, then damage the dragon. At good health, prefer an available effective attack over waiting or changing position for its own sake.',
    'Move when it gains a needed attack opportunity, investigates an unresolved crystal, or escapes danger. A route being new is not itself a combat benefit.',
    'Wait when there is a concrete reason: necessary healing at safe footing, or no useful attack or approach yet. Do not wait for a vulnerable phase when an effective attack is already offered.',
  ],
};

function endDecisionState({ request, health, food, arrows, position, safe, dragon, head, crystals, combat }) {
  const known = Object.values(combat.knownCrystals || {});
  return {
    request, task: 'Defeat the Ender Dragon and remain alive.', health, food, arrows, position,
    survival: { maximumHealth: 20, currentFootingSafe: safe, needsHealing: health < 16,
      naturalRegenerationPossible: health < 20 && food >= 18, immediateEmergenciesHandledByCode: true },
    dragon: dragon && { ...dragon, phaseName: PHASES[dragon.phase] || 'unknown',
      arrowsDeflected: [5, 6, 7].includes(dragon.phase) },
    perchedHead: head, crystals,
    crystalEvidence: { observed: crystals.length, confirmedExplosions: known.filter(c => c.status === 'destroyed').length,
      absentOnLoadedRevisit: known.filter(c => c.status === 'absent_on_revisit').length },
    unresolvedCrystalLocations: known.filter(c => c.status === 'unresolved'),
    noProgress: combat.noProgress, pausesWithoutProgress: combat.idleObservations || 0,
    recentShots: combat.shots.slice(-3).map(s => ({ at: s.at, target: s.target, outcome: s.outcome || 'launch_confirmed_hit_unverified' })),
    lastDamage: combat.lastDamage,
    // Old hazards are history, not current threats. The current safety facts
    // above and offered actions determine what can be done now.
    previousInterruption: combat.lastInterrupted,
  };
}

module.exports = { endDecisionInstructions, endDecisionState };
