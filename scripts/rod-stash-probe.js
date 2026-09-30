'use strict';
// The rods into a chest and back out, on a scratch server (note 704): a
// probe player in a netherrack room in the Nether, 4 blaze rods and 2 ender
// pearls carried, a blaze (no AI) behind a wall. src/rod-stash.js picks the
// chest's cell, puts it down (work.js place) and stores the rods through the
// chest window (mineflayer's deposit); the goal is written and read back as
// a restart would; the probe is moved off and the rods are taken out again
// (the walk by skills.js navigate, mineflayer's withdraw). The server's own
// record of the chest (data get block) is read at each step. Also the chest
// made from wood and a table carried (work.js acquireStep) when WITH_CRAFT=1.
// On a scratch server only (its console pipe, ARENA_CONSOLE; the port,
// MC_PORT); never a trial's.
//   MC_PORT=25704 ARENA_CONSOLE=<dir>/console.in node scripts/rod-stash-probe.js
const mineflayer = require('mineflayer'); const fs = require('fs');
const { pathfinder } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const PORT = Number(process.env.MC_PORT || 0), CONSOLE = process.env.ARENA_CONSOLE;
if (!PORT || !CONSOLE) { console.error('MC_PORT and ARENA_CONSOLE, a scratch server\'s'); process.exit(1); }
if ([25565].includes(PORT) || (PORT >= 25581 && PORT <= 25610)) { console.error('not a trial server'); process.exit(1); }
const LOG = process.env.ARENA_LOG;
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAME = 'StashProbe', D = 'minecraft:the_nether', X = 2000, Y = 100, Z = 2000;
const run = c => say(`execute in ${D} run ${c}`);
const count = (bot, name) => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
// What the server says the chest holds (its console log, ARENA_LOG).
async function serverSays(p) {
  if (!LOG) return null;
  const before = fs.statSync(LOG).size;
  run(`data get block ${p.x} ${p.y} ${p.z} Items`);
  await sleep(800);
  const text = fs.readFileSync(LOG, 'utf8').slice(before);
  return (/has the following block data: (.*)/.exec(text) || /(Found no elements[^\n]*|The target block is not a block entity[^\n]*)/.exec(text) || [])[1] || text.trim().split('\n').pop();
}

const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: NAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(pathfinder);
bot.once('spawn', async () => {
  const out = {};
  try {
    run(`forceload add ${X - 16} ${Z - 16} ${X + 16} ${Z + 16}`);
    run(`fill ${X - 8} ${Y - 2} ${Z - 8} ${X + 8} ${Y + 6} ${Z + 8} minecraft:netherrack`);
    run(`fill ${X - 7} ${Y} ${Z - 7} ${X + 7} ${Y + 5} ${Z + 7} minecraft:air`);
    // A wall across the room: the blaze on the far side, out of the probe's sight.
    run(`fill ${X - 7} ${Y} ${Z + 3} ${X + 7} ${Y + 5} ${Z + 3} minecraft:netherrack`);
    run(`kill @e[type=!minecraft:player,x=${X - 8},y=${Y - 2},z=${Z - 8},dx=16,dy=8,dz=16]`);
    say('difficulty normal'); say(`clear ${NAME}`); say(`gamemode survival ${NAME}`);
    run(`tp ${NAME} ${X + 0.5} ${Y} ${Z - 2.5} 0 0`);
    say(`give ${NAME} minecraft:blaze_rod 4`); say(`give ${NAME} minecraft:ender_pearl 2`);
    if (process.env.WITH_CRAFT) { say(`give ${NAME} minecraft:crimson_stem 3`); say(`give ${NAME} minecraft:crafting_table 1`); }
    else say(`give ${NAME} minecraft:chest 1`);
    say(`give ${NAME} minecraft:iron_sword 1`);
    run(`summon minecraft:blaze ${X + 0.5} ${Y + 1} ${Z + 5.5} {NoAI:1b,PersistenceRequired:1b,Tags:["probe"]}`);
    await sleep(4000);
    const { configureMovements } = require('../src/movement');
    bot.pathfinder.setMovements(configureMovements(bot));
    const rs = require('../src/rod-stash');
    const { Task, navigate } = require('../src/skills');
    const work = require('../src/work');
    const task = new Task('rod stash probe');
    let goal = { kind: 'win', mobHunt: { item: 'blaze_rod', entity: 'blaze', targetCount: 7 } };
    const save = () => {};
    bot.chat = m => console.log('[chat]', m);
    out.dimension = bot.game.dimension;
    out.carried = { blaze_rod: count(bot, 'blaze_rod'), ender_pearl: count(bot, 'ender_pearl'), chest: count(bot, 'chest') };
    const offer = rs.stashOffer(bot, goal);
    if (!offer) throw new Error('no offer');
    out.offer = { cell: offer.site.cell.toString(), walls: offer.site.walls, making: offer.making, seconds: offer.seconds, said: rs.offerSays(offer) };
    const blaze = Object.values(bot.entities).find(e => e.name === 'blaze');
    out.blazeSeesTheCell = !!blaze && [0.2, 0.5, 0.85].some(dy => require('../src/blaze-tactics').lineThrough(bot, blaze.position.offset(0, 1.53, 0), offer.site.cell.offset(0.5, dy, 0.5), new Set()));
    const t0 = Date.now();
    out.stored = await rs.stashRods(bot, task, goal, save, { place: work.place, navigate, acquireStep: work.acquireStep }, offer);
    out.storeSeconds = Math.round((Date.now() - t0) / 100) / 10;
    if (!out.stored) out.why = goal.rodStashFailed;
    out.afterStore = { carried: { blaze_rod: count(bot, 'blaze_rod'), ender_pearl: count(bot, 'ender_pearl') }, block: bot.blockAt(offer.site.cell)?.name, remembered: goal.rodStashes, server: await serverSays(offer.site.cell) };
    // A restart: the goal from its file.
    goal = JSON.parse(JSON.stringify(goal));
    const n = require('../src/eye-need').need(bot, goal);
    out.needAfterRestart = { rods: n.rods, rodsLeft: n.rodsLeft, stashed: n.stashed };
    // Off to the room's far corner and back for them.
    run(`tp ${NAME} ${X - 6.5} ${Y} ${Z - 6.5} 0 0`);
    await sleep(1500);
    out.stage = require('../src/game-progress').nextGameStage(bot, { ...goal, gameProgress: { milestones: {} } });
    bot.inventory.items(); // (the rods are 4 in the chest; 3 more make the 7)
    say(`give ${NAME} minecraft:blaze_rod 3`); say(`give ${NAME} minecraft:ender_pearl 11`);
    await sleep(1000);
    out.stageWithSeven = require('../src/game-progress').nextGameStage(bot, { ...goal, gameProgress: { milestones: {} } });
    const t1 = Date.now();
    out.taken = await rs.collect(bot, task, goal, save, { navigate });
    out.takeSeconds = Math.round((Date.now() - t1) / 100) / 10;
    out.afterTake = { carried: { blaze_rod: count(bot, 'blaze_rod'), ender_pearl: count(bot, 'ender_pearl') }, contents: goal.rodStashes[0].contents, server: await serverSays(goal.rodStashes[0].position) };
    out.stageAfter = require('../src/game-progress').nextGameStage(bot, { ...goal, gameProgress: { milestones: {} } });
  } catch (err) { out.error = err.stack || String(err); }
  console.log(JSON.stringify(out, null, 1));
  run(`kill @e[tag=probe]`);
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
bot.on('kicked', r => { console.error('kicked', r); process.exit(1); });
bot.on('error', e => { console.error('error', e.message); });
