'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchWinAcceptance } = require('../scripts/lib/win-witness');
function fixture() {
  let time = 1000, items = [];
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    health: 20, isAlive: true, entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: Object.assign(new EventEmitter(), { items: () => items }) });
  const events = [], start = options => watchWinAcceptance(bot, { now: () => time, record: e => events.push(e), ...options });
  const go = dimension => { time += 1000; bot.game.dimension = dimension; bot.emit('game'); };
  const give = stock => { time += 100; items = Object.entries(stock).map(([name, count]) => ({ name, count })); bot.inventory.emit('updateSlot'); };
  const kill = (at = time) => bot._client.emit('advancements', { progressMapping: [{ key: 'minecraft:end/kill_dragon', value: [
    { criterionIdentifier: 'killed_dragon', criterionProgress: at },
  ] }] });
  const exit = () => { time += 1000; bot._client.emit('game_state_change', { reason: 'win_game' }); };
  const supplies = () => { go('minecraft:the_nether'); give({ blaze_rod: 8 }); go('minecraft:overworld'); give({ ender_pearl: 16 }); give({ ender_eye: 16 }); };
  const win = () => { supplies(); go('minecraft:the_end'); kill(); exit(); go('overworld'); };
  return { bot, events, start, go, give, kill, exit, supplies, win };
}

test('winning witness rejects controlled, resumed, equipped and wrong-mode/dimension/difficulty starts', () => {
  for (const options of [{ resumed: true }, { scenario: 'controlled' }]) assert.throws(() => fixture().start(options), /uninterrupted empty Normal/);
  for (const [key, value] of [['dimension', 'end'], ['gameMode', 'creative'], ['difficulty', 'peaceful']]) {
    const f = fixture(); f.bot.game[key] = value; assert.throws(f.start, /uninterrupted empty Normal/);
  }
  const f = fixture(); f.give({ dirt: 1 }); assert.throws(f.start, /uninterrupted empty Normal/);
});

test('independent packet/inventory witness requires the complete ordered living journey and leaves server audit pending', () => {
  const f = fixture(), witness = f.start();
  assert.equal(witness.verify().ok, false);
  f.win(); const result = witness.verify();
  assert.equal(result.ok, true); assert.deepEqual(result.missing, []);
  assert.equal(result.independentServerVerification, 'required');
  assert.equal(witness.state.resources.blaze_rod.firstDimension, 'nether');
  assert(f.events.some(e => e.kind === 'inventory' && e.item === 'ender_eye' && e.maximum === 16));
  witness.detach();
  for (const emitter of [f.bot, f.bot._client, f.bot.inventory]) assert.equal(emitter.eventNames().length, 0);
});

test('dragon disappearance, old credit, future credit and dimension return without the exit event cannot win', () => {
  const f = fixture(), witness = f.start();
  f.supplies(); f.go('end');
  f.bot.emit('entityDead', { name: 'ender_dragon' }); f.kill(500); f.kill(2000); f.kill(999999);
  assert.equal(witness.state.milestones.dragon_kill_credit, undefined);
  f.kill(); f.go('overworld');
  assert.equal(witness.verify().ok, false); assert(witness.verify().missing.includes('exit_portal_used'));
  witness.detach();
});

test('death, disconnect, temporary Creative or difficulty changes permanently invalidate a run', () => {
  for (const change of ['death', 'end', 'mode', 'difficulty']) {
    const f = fixture(), witness = f.start();
    if (change === 'mode') { f.bot.game.gameMode = 'creative'; f.bot.emit('game'); f.bot.game.gameMode = 'survival'; }
    else if (change === 'difficulty') { f.bot.game.difficulty = 'peaceful'; f.bot.emit('game'); f.bot.game.difficulty = 'normal'; }
    else f.bot.emit(change);
    f.win(); assert.equal(witness.verify().ok, false, change); assert(witness.state.violations.length); witness.detach();
  }
});

test('difficulty packets are checked even when the game plugin emits no game event', () => {
  const f = fixture();
  const updateDifficulty = packet => { f.bot.game.difficulty = packet.difficulty; };
  f.bot._client.on('difficulty', updateDifficulty);
  const witness = f.start();
  f.bot._client.emit('difficulty', { difficulty: 'peaceful' });
  f.bot._client.emit('difficulty', { difficulty: 'normal' });
  f.win(); assert.equal(witness.verify().ok, false);
  assert(witness.state.violations.some(v => v.reason.includes('Difficulty')));
  witness.detach(); f.bot._client.removeListener('difficulty', updateDifficulty);
  assert.equal(f.bot._client.eventNames().length, 0);
});

test('dimension loading is not a death, but living return waits for the live player state', () => {
  const f = fixture(), witness = f.start(); f.supplies(); f.go('end'); f.kill(); f.exit();
  f.bot.isAlive = false; f.go('overworld');
  assert.equal(witness.verify().ok, false); assert.equal(witness.state.violations.length, 0);
  f.bot.isAlive = true; f.bot.emit('spawn'); assert.equal(witness.verify().ok, true); witness.detach();
});

test('late supplies cannot manufacture the required pre-End resource progression', () => {
  const f = fixture(), witness = f.start();
  f.go('end'); f.kill(); f.exit(); f.go('overworld'); f.supplies();
  assert.equal(witness.verify().ok, false);
  assert(witness.verify().missing.includes('eyes_obtained_before_first_end_entry'));
  assert(witness.verify().missing.includes('blaze_rod_before_first_end_entry'));
  witness.detach();
});
