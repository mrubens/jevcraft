'use strict';
// Real Jev judgments over bounded combat scenarios, including the idle-at-full-
// health failure seen in End O/P. This evaluation performs no game actions.
require('../src/env').loadEnv();
const fs = require('fs'), path = require('path');
const { TypeSafe } = require('../src/typesafe'), { decideTree } = require('../src/decisions');
const { endDecisionInstructions, endDecisionState } = require('../src/decisions/end-state');
const leaf = description => ({ description });
const attack = leaf({ action: 'Shoot the currently arrow-vulnerable flying dragon along the checked clear trajectory',
  safeFiringPosition: true, flightSeconds: 1, dragonHealth: 175.5, observedHealingCrystals: 0 });
const move = leaf({ action: 'Reposition along this surveyed route to gain a future attack opportunity', targetDistance: 30, currentTargetDistance: 35 });
const wait = leaf({ action: 'Wait one second without attacking or moving', health: 20, canRegenerate: false, usefulAttackAvailableNow: true });
const base = () => ({ request: 'Defeat the dragon and return alive', health: 20, food: 20, arrows: 230,
  position: { x: -20, y: 63, z: 16 }, safe: true, dragon: { phase: 0, health: 175.5 }, head: null, crystals: [],
  combat: { knownCrystals: {}, shots: [], noProgress: 7, idleObservations: 0 } });
const cases = [
  { name: 'healthy-clear-flying-shot', accepted: ['shoot_dragon'], tree: { shoot_dragon: attack, reposition: move, observe: wait } },
  { name: 'minor-regeneration-does-not-waste-the-opening', health: 19.8, accepted: ['shoot_dragon'],
    tree: { shoot_dragon: attack, reposition: move, observe: leaf({ ...wait.description, health: 19.8, canRegenerate: true }) } },
  { name: 'resolved-earlier-cloud-is-not-a-current-threat', previousCloud: true, accepted: ['shoot_dragon'],
    tree: { shoot_dragon: attack, reposition: move, observe: wait } },
  { name: 'reachable-healing-crystal-first', crystal: true, accepted: ['crystal'], tree: {
    crystal: leaf({ action: 'Destroy an observed healing crystal with a clear bow trajectory, removing a source of dragon health regeneration', position: { x: 30, y: 90, z: 0 } }),
    shoot_dragon: leaf({ ...attack.description, observedHealingCrystals: 1 }), observe: wait } },
  { name: 'reachable-perched-head', phase: 6, accepted: ['strike_head'], tree: {
    strike_head: leaf('Strike the reachable head of the perched dragon with the carried sword'), reposition: move, observe: wait } },
  { name: 'recover-low-health-on-safe-ground', health: 8, accepted: ['observe'], tree: {
    reposition: move, observe: leaf({ action: 'Wait at this safe position for natural food regeneration', health: 8, canRegenerate: true, usefulAttackAvailableNow: false }) } },
  { name: 'approach-unreachable-perched-head', phase: 6, accepted: ['approach_head'], tree: {
    approach_head: leaf({ action: 'Approach the perched head to get within sword reach', targetDistance: 2.5, currentTargetDistance: 8 }),
    observe: leaf({ ...wait.description, usefulAttackAvailableNow: false }) } },
];
(async () => {
  const client = new TypeSafe(), results = [], directory = path.join(__dirname, '..', 'artifacts', `end-decisions-${Date.now().toString(36)}`);
  fs.mkdirSync(directory, { recursive: true });
  let scenarios = cases;
  if (process.argv[2]) {
    const tracePath = path.resolve(process.argv[2]), trace = JSON.parse(fs.readFileSync(tracePath, 'utf8')), seen = new Set();
    const eligible = trace.frames.filter(f => {
      const s = f.snapshot, d = s?.decision;
      if (seen.has(d?.at) || d?.path?.[0] !== 'observe' || !d.options?.shoot_dragon || !d.options?.observe ||
        s.health !== 20 || s.goal?.endCombat?.observedCrystals?.length !== 0) return false;
      seen.add(d.at); return true;
    });
    if (eligible.length < 3) throw new Error('Replay needs three distinct recorded healthy waits with an available shot');
    scenarios = [eligible[0], eligible[Math.floor(eligible.length / 2)], eligible.at(-1)].map(f => {
      const s = f.snapshot, combat = s.goal.endCombat;
      return { name: `recorded-wait-${s.decision.at}`, accepted: ['shoot_dragon'], tree: s.decision.options,
        source: { tracePath, frame: f.id, originalDecision: s.decision.path, originalJudgments: s.decision.judgments,
          note: 'Recorded candidate descriptions retained; new question and state summary reconstructed from the same observation' },
        state: endDecisionState({ request: s.goal.request, health: s.health, food: s.food, arrows: s.inventory.arrow,
          position: s.position, safe: true, dragon: combat.dragon, head: null, crystals: combat.observedCrystals, combat }) };
    });
  }
  for (const scenario of scenarios) {
    const input = base(); input.health = scenario.health ?? input.health; input.dragon.phase = scenario.phase ?? 0;
    if (scenario.previousCloud) input.combat.lastInterrupted = { at: Date.now() - 20000, reason: 'dragon_breath_cloud' };
    if (scenario.crystal) { input.crystals = [{ id: 8, position: { x: 30, y: 90, z: 0 } }]; input.combat.knownCrystals.a = { status: 'observed', ...input.crystals[0] }; }
    if (scenario.phase === 6) input.head = { position: { x: 0, y: 64, z: 6 }, reachable: scenario.name === 'reachable-perched-head' };
    const state = scenario.state || endDecisionState(input);
    const result = await decideTree(client, { tree: scenario.tree, state, rootInstructions: endDecisionInstructions });
    const record = { name: scenario.name, source: scenario.source, state, tree: scenario.tree, instructions: endDecisionInstructions,
      accepted: scenario.accepted, selected: result.path, pass: scenario.accepted.includes(result.path[0]),
      judgments: result.judgments, latencyMs: result.latencyMs, usage: result.usage };
    results.push(record); console.log(JSON.stringify({ name: record.name, selected: record.selected, pass: record.pass, judgments: record.judgments }));
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ provider: client.provider, model: client.model, results }, null, 2));
  }
  console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, total: results.length, directory, limitation: 'Model scenario evaluation, not live combat or acceptance' }));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
