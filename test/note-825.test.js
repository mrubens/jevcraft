// Note 825: 25598 (mid-241-cj, 2026-10-01) walked at the same unreachable
// cells of a mineshaft 72 times while searching for planks; the explore
// walk now leaves out a destination set aside from about here (note 775).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3'), { Task } = require('../src/skills');
const { explore } = require('../src/work');
const routeAside = require('../src/route-aside');

test('25598: a search walk leaves out a destination its walks found no way to three times from about here', async () => {
  const registry = require('minecraft-data')('26.1');
  const grass = registry.blocksByName.grass_block.id;
  const bot = { registry, game: { gameMode: 'survival' }, entities: {}, entity: { position: new Vec3(.5, 64, .5) },
    inventory: { items: () => [] },
    blockAt: p => { const name = p.y >= 64 ? 'air' : 'stone'; return { name, position: p, type: registry.blocksByName[name].id, boundingBox: name === 'air' ? 'empty' : 'block' }; },
    findBlocks: ({ matching }) => matching.includes(grass) ? [new Vec3(10, 63, 0), new Vec3(-12, 63, 0)] : [],
    pathfinder: { movements: {}, setGoal() {}, goto: async g => { bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); } },
  };
  const goal = { search: { sand: { attempts: 3, leg: 2, origin: { x: 0, y: 64, z: 0 }, progressLeg: 2 } } };
  // First walk: the nearer ground.
  await explore(bot, new Task('search'), goal, () => {}, 'sand');
  const first = bot.entity.position.clone();
  // Its walk found no way three times from here: set aside.
  bot.entity.position = new Vec3(.5, 64, .5);
  for (let i = 0; i < 3; i++) routeAside.noteFailure(goal, new Error(`Searching for sand: No route from here to (${Math.floor(first.x)}, ${Math.floor(first.y)}, ${Math.floor(first.z)}) (noPath)`), bot.entity.position);
  goal.search.sand.visited = {};
  await explore(bot, new Task('search'), goal, () => {}, 'sand');
  assert.notEqual(Math.floor(bot.entity.position.x), Math.floor(first.x), 'the set-aside ground is left out');
});
