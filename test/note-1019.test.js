'use strict';
// Note 1019: standing at the back of its slot, the bot is told so in every
// question asked there, and what walking out of it leaves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const slot = require('../src/enderman-slot');
const { Task } = require('../src/skills');

function slotBot() {
  // A slot dug east from its mouth at (0, 64, 0): the back at (2, 64, 0).
  const open = p => p.z === 0 && (p.y === 64 || p.y === 65) && p.x <= 2;
  return { game: { dimension: 'the_nether' }, health: 20, food: 20,
    entity: { position: new Vec3(2.5, 64, 0.5), onGround: true },
    inventory: { items: () => [], slots: {} },
    blockAt: p => ({ position: p, name: open(p.floored()) ? 'air' : 'netherrack', boundingBox: open(p.floored()) ? 'empty' : 'block' }),
    entities: { 7: { id: 7, name: 'enderman', position: new Vec3(-7.5, 64, 0.5), metadata: { 17: true }, isValid: true } },
    _slotAt: { b: new Vec3(2, 64, 0), mouth: new Vec3(0, 64, 0), d: new Vec3(1, 0, 0), at: Date.now() } };
}

test('at the back of the slot the bot is told where it stands, who is about and what leaving does', () => {
  const said = slot.standing(slotBot());
  assert.match(said, /^The bot stands at the back of the slot it dug at \(2, 64, 0\): one wide and two high, rock on every side but the mouth, two blocks to the west\. An enderman is 2\.9 blocks tall and does not come in under a roof two high/);
  assert.match(said, /1 enderman within 32 blocks, the nearest 10 off, 1 turned on the bot now/);
  assert.match(said, /Any way that walks out of it leaves that: in the open an enderman that has turned is at the bot at once/);
  const out = slotBot(); out.entity.position = new Vec3(-6.5, 64, 0.5);
  assert.equal(slot.standing(out), null, 'out of it, nothing is said');
  assert.equal(out._slotAt, undefined, 'and the slot is forgotten once the bot is well away');
});

test('the slot goes with a gameplay question asked while the bot stands in it, with its guidance line', async () => {
  const decisions = require('../src/decisions');
  const said = [], asked = [];
  const client = { systemOne: async ({ state, questions }) => { said.push(state); asked.push(questions); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  const tree = { fetch_stems: { description: 'Fetch stems.' }, carry_on: { description: 'Carry on.' } };
  await decisions.decide('upkeep', { client, bot: slotBot(), task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree, state: { health: 20 } });
  assert.match(said[0].slot, /^The bot stands at the back of the slot it dug/);
  assert.match(JSON.stringify(asked[0]), /slot is the slot the bot stands in now/);
  const away = slotBot(); delete away._slotAt; said.length = 0;
  await decisions.decide('upkeep', { client, bot: away, task: new Task('work'), goal: { kind: 'win' }, save: () => {}, tree, state: { health: 20 } });
  assert.equal(said[0].slot, undefined);
});
