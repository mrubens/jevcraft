'use strict';
// This is an explicitly labelled illustration, never evidence from a real run.
const { Trace } = require('./trace');
function demo() {
  const trace = new Trace({ id: 'demo', mode: 'demo', label: 'Illustrated run · cherry cabin' });
  const palette = ['grass_block', 'dirt', 'stone', 'water', 'cherry_log', 'cherry_leaves', 'sand', 'cherry_planks'];
  const blocks = [], known = [], radius = 12, origin = { x: 0, y: 64, z: 0 };
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    known.push([x, z]);
    const river = x >= 6 && x <= 8;
    for (let y = -3; y < 0; y++) blocks.push([x, y, z, y === -1 ? (river ? 3 : x === 5 || x === 9 ? 6 : 0) : y === -2 ? 1 : 2]);
  }
  for (const [x, z] of [[-7, -6], [-8, 5], [2, -8], [10, 7]]) {
    for (let y = 0; y < 5; y++) blocks.push([x, y, z, 4]);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 3; y < 7; y++) {
      if (Math.abs(dx) + Math.abs(dz) + (y === 6 ? 1 : 0) < 5 && (dx || dz || y > 4)) blocks.push([x + dx, y, z + dz, 5]);
    }
  }
  const world = { origin, radius, minY: -5, maxY: 12, palette, blocks, known };
  const blueprint = { origin: { x: -5, y: 64, z: -3 }, blocks: [] };
  for (let x = 0; x < 6; x++) for (let z = 0; z < 5; z++) {
    blueprint.blocks.push({ x: x - 5, y: 64, z: z - 3, material: 'cherry_planks' });
    if (!x || !z || x === 5 || z === 4) for (let y = 1; y < 4; y++) if (!(z === 4 && x === 3 && y < 3)) blueprint.blocks.push({ x: x - 5, y: y + 64, z: z - 3, material: 'cherry_planks' });
  }
  // The typed answers Jev returns for a chat request, illustrated. Every
  // question below is one the bot really asks in a single batched call.
  const usage = { input_tokens: 1840, output_tokens: 296 };
  const interpretation = {
    addressed: { type: 'noul', noul: 0.98 },
    interaction: { type: 'choice', choice: 'request', confidence: 0.97, probabilities: { request: 0.98, discussion: 0.02 } },
    objective: { type: 'choice', choice: 'build', confidence: 0.86, probabilities: { build: 0.9, house: 0.09, craft: 0.01 } },
    wood_choice: { type: 'choice', choice: 'cherry', confidence: 0.95, probabilities: { cherry: 0.96, none: 0.03, oak: 0.01 } },
    quantity: { type: 'choice', choice: 'unspecified', confidence: 0.99, probabilities: { unspecified: 1 } },
    delivery: { type: 'choice', choice: 'unspecified', confidence: 0.7, probabilities: { unspecified: 0.78, speaker: 0.2, bot: 0.02 } },
    material: { type: 'choice', choice: 'other', confidence: 0.9, probabilities: { other: 0.93, oak_planks: 0.07 } },
  };
  const unsure = { ...interpretation, objective: { type: 'choice', choice: 'build', confidence: 0.41, probabilities: { build: 0.46, house: 0.4, craft: 0.14 } } };
  let decision = null;
  const frames = [
    { label: 'Asked back: I\'m not sure whether you want me to design and build something or build a small house. Could you say it another way?', kind: 'clarify', source: 'jev',
      detail: { request: 'Jev make me a cherry place to live', kind: 'clarify', interpretation: unsure, usage, latencyMs: 231,
        message: 'I\'m not sure whether you want me to design and build something or build a small house. Could you say it another way?',
        clarification: { reason: 'uncertain_objective', question: 'objective', confidence: 0.41, threshold: 0.65, options: ['build', 'house'] } } },
    { label: 'Understood: build', kind: 'request', source: 'jev', detail: { request: 'Jev build me a cherry cabin', kind: 'build', interpretation, usage, latencyMs: 204 } },
    { label: 'Site inspected', kind: 'action', source: 'rules' },
    { label: 'Gather cherry logs', kind: 'decision', source: 'jev' },
    { label: 'Walking to cherry tree', kind: 'action', source: 'rules' },
    { label: 'Path blocked by leaves', kind: 'error', source: 'rules' },
    { label: 'Replanning approach', kind: 'decision', source: 'jev' },
    { label: 'Collecting cherry logs', kind: 'action', source: 'rules' },
    { label: 'Craft cherry planks', kind: 'decision', source: 'jev' },
    { label: 'Return to the building site', kind: 'action', source: 'rules' },
    { label: 'Begin cabin foundation', kind: 'action', source: 'rules' },
  ];
  const points = [[2, 5], [2, 5], [1, 3], [-1, 2], [-3, 0], [-5, -3], [-4, -3], [-6, -5], [-5, -4], [-3, 0], [-2, 1]];
  for (let i = 0; i < frames.length; i++) {
    const at = new Date(Date.UTC(2026, 8, 18, 19, 0, i * 8)).toISOString();
    if (frames[i].kind === 'decision') decision = { at, path: ['player_request', 'gather_materials', 'source_cherry_log_near'], latencyMs: 143, model: 'jev-latest', usage: { input_tokens: 612, output_tokens: 58 },
      options: {
        player_request: { description: 'Continue building the requested cherry cabin', children: {
          gather_materials: { description: 'Gather cherry logs for the cabin', children: {
            source_cherry_log_near: { description: { block: 'cherry_log', blocksWithinReach: 4, distance: 7, elevationChange: 0 } },
            source_cherry_log_far: { description: { block: 'cherry_log', blocksWithinReach: 9, distance: 31, elevationChange: 5 } },
          } },
          prepare_site: { description: 'Clear vegetation from the reserved site', action: 'clear' },
        } },
        survival: { description: 'Prepare supplies before continuing', action: 'prepare' },
      },
      asked: {
        branch_0: { task: 'Which priority should the bot handle NEXT? Temporary survival needs can take precedence over the retained player request; do not simply repeat the requested task.' },
        branch_1: { task: 'Assuming the current priority/subtask is player_request, choose its next child.' },
        branch_2: { task: 'Assuming the current priority/subtask is player_request → gather_materials, choose its next child.' },
      },
      judgments: [{ branch: 'branch_0', choice: 'player_request', confidence: 0.84, probabilities: { player_request: 0.89, survival: 0.11 } },
        { branch: 'branch_1', choice: 'gather_materials', confidence: 0.66, probabilities: { gather_materials: 0.76, prepare_site: 0.24 } },
        { branch: 'branch_2', choice: 'source_cherry_log_near', confidence: 0.9, probabilities: { source_cherry_log_near: 0.93, source_cherry_log_far: 0.07 } }],
      state: { health: 20, food: 18, missing: 'cherry_planks', visibleTrees: 4, request: 'Build me a cherry cabin' } };
    const [x, z] = points[i];
    trace.append({ at, kind: frames[i].kind, source: frames[i].source, label: frames[i].label,
      snapshot: { connected: null, position: { x, y: 64, z }, yaw: 0.8, pitch: 0, health: 20, food: 18, dimension: 'overworld',
        inventory: { cherry_log: i > 6 ? 12 : 0, cherry_planks: i > 7 ? 48 : 0, stone_axe: 1, bread: 4 },
        goal: { request: 'Build me a cherry cabin', kind: 'build', status: 'running', blueprint, interpretation: i >= 1 ? interpretation : undefined,
          step: { action: i < 8 ? 'collect' : 'build', item: i < 8 ? 'cherry_log' : 'cherry_planks' },
          designReview: i >= 2 ? { fits: 0.91, accepted: true, threshold: 0.5 } : undefined,
          dependencies: [{ action: 'collect', item: 'cherry_log', count: 20 }, { action: 'craft', item: 'cherry_planks', count: 80 }, { action: 'build', item: 'cabin', count: 1 }] },
        decision, world, entities: [{ id: 2, name: 'You', kind: 'player', position: { x: 2, y: 64, z: 6 } }],
        route: [{ x, y: 64, z }, { x: x - 1, y: 64, z: z - 1 }, { x: -6, y: 64, z: -5 }] },
      detail: { illustration: true, note: 'Synthetic scene for exploring the interface. No Minecraft bot was controlled.', ...(frames[i].detail || {}) } });
  }
  return { ...trace.view(), capabilities: { controls: false, terrain: true },
    note: 'Illustrated sample. Terrain, choices and probabilities are synthetic; this is not your running game.' };
}
module.exports = { demo };
