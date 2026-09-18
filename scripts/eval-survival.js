'use strict';
require('../src/env').loadEnv();
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { TypeSafe } = require('../src/typesafe');
const { Survival } = require('../src/survival');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

(async () => {
  const client = new TypeSafe();
  const results = [];
  for (const scenario of [
    { name: 'daylight-house-work', timeOfDay: 4000, kind: 'house', expected: false },
    { name: 'dusk-house-without-refuge', timeOfDay: 10800, kind: 'house', expected: true },
    { name: 'night-concrete-without-refuge', timeOfDay: 15000, kind: 'concrete', expected: true },
    { name: 'hungry-with-carried-raw-chicken', timeOfDay: 4000, kind: 'survive', food: 14, inventory: [{ name: 'chicken', count: 2 }], expected: true, cooking: true },
  ]) {
    const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', difficulty: 'normal' },
      time: { timeOfDay: scenario.timeOfDay }, entity: { position: new Vec3(0, 64, 0) }, entities: {},
      health: 20, food: scenario.food ?? 20, oxygenLevel: 20, inventory: { items: () => scenario.inventory || [] }, registry,
      pathfinder: { movements: {} } });
    let cooked;
    const controller = new Survival(bot, { acquireStep: async (b, t, output, amount) => { cooked = { output, amount }; } }, { client });
    let built = false;
    controller.refugeStep = async () => { built = true; };
    const goal = { kind: scenario.kind, request: scenario.kind === 'house' ? 'Build a house' : 'Get me 32 purple concrete' };
    const handled = await controller.step(new Task('eval', goal.request), goal, () => {});
    const record = { name: scenario.name, pass: handled === scenario.expected && (scenario.cooking ? cooked?.output === 'cooked_chicken' && cooked.amount === 2 && !built : built === scenario.expected),
      expectedShelter: scenario.expected && !scenario.cooking, cooked, handled, decision: goal.decisions?.at(-1) };
    results.push(record); console.log(JSON.stringify(record));
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(`artifacts/survival-eval-${Date.now().toString(36)}.json`, JSON.stringify(results, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
