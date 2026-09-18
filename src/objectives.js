'use strict';

const fs = require('fs');
const path = require('path');
const { choice, noul } = require('./typesafe');
const { Vec3 } = require('vec3');

const TYPES = {
  house: 'Build a small house or shelter.',
  concrete: 'Obtain purple concrete blocks (not merely concrete powder).',
  nether: 'Find or create a working route to the Nether.',
  stop: 'Stop or cancel the current task.',
  status: 'Report progress on the current task.',
  resume: 'Continue or retry the saved task.',
  other: 'Any other request, conversation, or unsupported construction/material.',
};

async function interpret(client, request, from, username) {
  const numbers = [...new Set(['32', '64', '16', '1', ...(request.match(/\b\d{1,4}\b/g) || [])])]
    .filter(n => Number(n) > 0 && Number(n) <= 1024);
  const response = await client.systemOne({
    state: { request, speaker: from, bot_name: username },
    questions: {
      addressed: noul('Is `request` directed at `bot_name` asking the bot to act or report, rather than conversation with another player?'),
      objective: choice('What outcome does the player request in `request`? Choose other if the specific requested item or building is unsupported.', TYPES),
      quantity: choice('Assuming the request is to obtain purple concrete, how many blocks are requested? Default to 32 if unspecified. A stack is 64 and half a stack is 32.', Object.fromEntries(numbers.map(n => [n, `${n} blocks`]))),
      material: choice('Assuming the request is a small house, which construction material does the player request? Use oak_planks for unspecified wood or no preference.', {
        oak_planks: 'Wooden oak planks; default house material.',
        cobblestone: 'Cobblestone or stone.', dirt: 'Dirt.', other: 'A specified material outside these options.',
      }),
    },
  });
  const a = response.answers;
  if (!a || !Object.hasOwn(TYPES, a.objective?.choice) || !Number.isFinite(a.addressed?.noul)) {
    throw new Error('Invalid Jev interpretation response');
  }
  if (a.addressed.noul < 0.5) return null;
  const kind = a.objective.choice;
  if (kind === 'house' && !['oak_planks', 'cobblestone', 'dirt'].includes(a.material?.choice)) {
    return { kind: 'other' };
  }
  if (kind === 'concrete' && !numbers.includes(a.quantity?.choice)) throw new Error('Invalid concrete quantity');
  return { kind, request, from, count: kind === 'concrete' ? Number(a.quantity.choice) : undefined,
    material: kind === 'house' ? a.material.choice : undefined, interpretation: a, usage: response.usage };
}

class GoalStore {
  constructor(file) { this.file = file; }
  read() {
    if (!fs.existsSync(this.file)) return null;
    const goal = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (goal.version !== 1) throw new Error('Unsupported saved goal version');
    return goal;
  }
  save(goal) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    goal.updatedAt = new Date().toISOString();
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(goal, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
}

function houseBlueprint(origin, material = 'oak_planks') {
  const o = new Vec3(origin.x, origin.y, origin.z);
  const blocks = [];
  const empty = [];
  for (let y = -1; y <= 3; y++) {
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      const doorway = x === 0 && z === -2 && y >= 0 && y < 2;
      const pos = o.offset(x, y, z);
      if (y === -1 || y === 3 || (edge && !doorway)) blocks.push({ ...pos, material });
      else empty.push({ ...pos });
    }
  }
  return { origin: { ...o }, blocks, empty, entrance: { ...o.offset(0, 0, -3) } };
}

function verifyHouse(bot, blueprint) {
  if (!blueprint) return { ok: false, reason: 'No building site selected' };
  const missing = blueprint.blocks.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name !== p.material);
  const obstructed = blueprint.empty.filter(p => {
    const b = bot.blockAt(new Vec3(p.x, p.y, p.z));
    return !b || !['air', 'cave_air', 'void_air'].includes(b.name);
  });
  return { ok: !missing.length && !obstructed.length, missing: missing.length, obstructed: obstructed.length };
}

module.exports = { interpret, GoalStore, houseBlueprint, verifyHouse };
