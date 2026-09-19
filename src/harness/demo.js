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
  let decision = null;
  const labels = ['Build request received', 'Site inspected', 'Gather cherry logs', 'Walking to cherry tree', 'Path blocked by leaves', 'Replanning approach', 'Collecting cherry logs', 'Craft cherry planks', 'Return to the building site', 'Begin cabin foundation'];
  const points = [[2, 5], [1, 3], [-1, 2], [-3, 0], [-5, -3], [-4, -3], [-6, -5], [-5, -4], [-3, 0], [-2, 1]];
  for (let i = 0; i < labels.length; i++) {
    const at = new Date(Date.UTC(2026, 8, 18, 19, 0, i * 8)).toISOString();
    if (i === 2 || i === 5 || i === 7) decision = { at, path: ['player_request', 'gather_materials'], latencyMs: 143,
      options: {
        player_request: { description: 'Continue building the requested cherry cabin', children: {
          gather_materials: { description: 'Gather cherry logs for the cabin', action: 'collect' },
          prepare_site: { description: 'Clear vegetation from the reserved site', action: 'clear' },
        } },
        survival: { description: 'Prepare supplies before continuing', action: 'prepare' },
      },
      judgments: [{ branch: 'branch_0', choice: 'player_request', probabilities: { player_request: 0.89, survival: 0.11 } },
        { branch: 'branch_1', choice: 'gather_materials', probabilities: { gather_materials: 0.76, prepare_site: 0.24 } }],
      state: { health: 20, food: 18, missing: 'cherry_planks', visibleTrees: 4, request: 'Build me a cherry cabin' } };
    const [x, z] = points[i];
    trace.append({ at, kind: i === 4 ? 'error' : i === 0 ? 'chat' : [2, 5, 7].includes(i) ? 'decision' : 'action',
      source: [2, 5, 7].includes(i) ? 'jev' : i === 0 ? 'observed' : 'rules', label: labels[i],
      snapshot: { connected: null, position: { x, y: 64, z }, yaw: 0.8, pitch: 0, health: 20, food: 18, dimension: 'overworld',
        inventory: { cherry_log: i > 5 ? 12 : 0, cherry_planks: i > 6 ? 48 : 0, stone_axe: 1, bread: 4 },
        goal: { request: 'Build me a cherry cabin', kind: 'build', status: 'running', blueprint,
          step: { action: i < 7 ? 'collect' : 'build', item: i < 7 ? 'cherry_log' : 'cherry_planks' },
          dependencies: [{ action: 'collect', item: 'cherry_log', count: 20 }, { action: 'craft', item: 'cherry_planks', count: 80 }, { action: 'build', item: 'cabin', count: 1 }] },
        decision, world, entities: [{ id: 2, name: 'You', kind: 'player', position: { x: 2, y: 64, z: 6 } }],
        route: [{ x, y: 64, z }, { x: x - 1, y: 64, z: z - 1 }, { x: -6, y: 64, z: -5 }] },
      detail: { illustration: true, note: 'Synthetic scene for exploring the interface. No Minecraft bot was controlled.' } });
  }
  return { ...trace.view(), capabilities: { controls: false, terrain: true },
    note: 'Illustrated sample. Terrain, choices and probabilities are synthetic; this is not your running game.' };
}
module.exports = { demo };
