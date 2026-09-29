'use strict';
// The shot reflex measured at work (note 676): a probe player in iron with
// a shield walks back and forth across a netherrack room (pathfinder, eight
// blocks each way) with a blaze hovering seven blocks to its side, and at
// each end stands three seconds facing away from it swinging at nothing, as
// a step stands at a dig or a wall. Counts the fireballs, the ones that
// landed (the server's hurt from a small fireball) and the laps walked. On a scratch server only (its console pipe, ARENA_CONSOLE; the
// port, MC_PORT); never a trial's.
//   MC_PORT=25700 ARENA_CONSOLE=<dir>/console.in node scripts/shot-reflex-probe.js [off|reflex|rules|jev] [seconds] [blazes]
// off: the shield carried and never raised (the walk as the trials walked);
// reflex: src/shot-reflex.js with no one to ask, so only a shot already in
// the air is met; rules: every warning answered shield_up at once (the
// rule without Jev); jev: every warning asked of a stand-in that answers
// shield_up after 0.2 seconds (Jev's median).
const mineflayer = require('mineflayer'); const fs = require('fs'); const path = require('path');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const reflex = require('../src/shot-reflex');
const PORT = Number(process.env.MC_PORT || 0), CONSOLE = process.env.ARENA_CONSOLE;
if (!PORT || !CONSOLE) { console.error('MC_PORT and ARENA_CONSOLE, a scratch server\'s'); process.exit(1); }
if ([25565].includes(PORT) || (PORT >= 25581 && PORT <= 25610)) { console.error('not a trial server'); process.exit(1); }
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mode = process.argv[2] || 'reflex', seconds = Number(process.argv[3] || 60), count = Number(process.argv[4] || 1);
const NAME = 'ShotProbe', D = 'minecraft:the_nether', X = 1600, Y = 100, Z = 1600;
const run = c => say(`execute in ${D} run ${c}`);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: NAME, version: '26.1', auth: 'offline' });
bot.loadPlugin(pathfinder);
bot.once('spawn', async () => {
  run(`forceload add ${X - 32} ${Z - 32} ${X + 48} ${Z + 32}`);
  run(`fill ${X - 6} ${Y - 4} ${Z - 6} ${X + 30} ${Y + 14} ${Z + 6} minecraft:netherrack`);
  run(`fill ${X - 5} ${Y} ${Z - 5} ${X + 29} ${Y + 13} ${Z + 5} minecraft:air`);
  run(`kill @e[type=!minecraft:player,x=${X - 6},y=${Y - 4},z=${Z - 6},dx=40,dy=20,dz=14]`);
  // PROBE_WALL=1: a wall three high a block toward the blazes beside each
  // end, for the step behind a block (behind_cover).
  if (process.env.PROBE_WALL) for (const dz of [-3, 3]) run(`fill ${X + 1} ${Y} ${Z + dz - 1} ${X + 1} ${Y + 2} ${Z + dz + 1} minecraft:netherrack`);
  say('gamerule minecraft:mob_griefing false'); say('difficulty normal');
  say(`clear ${NAME}`); say(`gamemode survival ${NAME}`); say(`effect clear ${NAME}`);
  run(`tp ${NAME} ${X + 0.5} ${Y} ${Z - 3.5} 0 0`);
  for (const [slot, item] of [['head', 'iron_helmet'], ['chest', 'iron_chestplate'], ['legs', 'iron_leggings'], ['feet', 'iron_boots']]) say(`item replace entity ${NAME} armor.${slot} with minecraft:${item}`);
  say(`item replace entity ${NAME} weapon.offhand with minecraft:shield`);
  say(`item replace entity ${NAME} weapon.mainhand with minecraft:iron_sword`);
  // Kept alive for the count: health back, and the fire it is set.
  say(`effect give ${NAME} minecraft:regeneration 9999 3 true`); say(`effect give ${NAME} minecraft:saturation 9999 0 true`);
  await sleep(2500);
  const moves = new Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.scafoldingBlocks = [];
  bot.pathfinder.setMovements(moves);
  const counts = { fireballs: 0, landed: 0, laps: 0, holds: 0, refused: {}, asked: 0 };
  let t0 = Date.now();
  const survival = mode === 'rules' ? { client: null } : mode === 'jev' ? { client: {}, decide: async (task, goal, save, q) => { if (!counts.asked++) console.log(JSON.stringify({ first: q.state, options: Object.fromEntries(Object.entries(q.tree).map(([k, o]) => [k, o.description])) })); await sleep(200); return { path: [process.env.PROBE_ANSWER && q.tree[process.env.PROBE_ANSWER] ? process.env.PROBE_ANSWER : q.tree.shield_up ? 'shield_up' : 'keep_on'] }; } } : null;
  if (mode !== 'off') reflex.install(bot, survival);
  if (mode === 'off') reflex.watchShots(bot);
  for (let i = 0; i < count; i++) run(`summon minecraft:blaze ${X + 7.5} ${Y + 1} ${Z + 0.5 + (i - (count - 1) / 2) * 3} {PersistenceRequired:1b,Tags:["probe"]}`);
  await sleep(500);
  // Each landing with what the shield and the hold were doing (PROBE_DEBUG).
  bot._client.on('damage_event', p => {
    if (p.entityId !== bot.entity.id || bot.entities[p.sourceDirectId - 1]?.name !== 'small_fireball') return;
    counts.landed++;
    if (process.env.PROBE_DEBUG) {
      const shot = bot.entities[p.sourceDirectId - 1], s = bot._shots?.get(shot.id), yaw = bot.entity.yaw, from = s?.from || shot.position, d = from.minus(bot.entity.position);
      console.log('landed', JSON.stringify({ t: Date.now() - t0, flags: bot.entity.metadata?.[8], raisedMsAgo: Date.now() - (bot._shieldRaisedAt || 0), hold: bot._shotHold?.why || null, refused: bot._shotRefused?.why || null,
        facingDeg: Math.round(Math.acos((-Math.sin(yaw) * d.x - Math.cos(yaw) * d.z) / Math.hypot(d.x, d.z)) * 180 / Math.PI), inAirMs: s ? Date.now() - s.at : null, onGround: bot.entity.onGround, owner: s?.owner, blazeOff: Math.round(from.distanceTo(bot.entity.position) * 10) / 10, warn: bot.entities[s?.owner]?._shotWarn ? Date.now() - bot.entities[s.owner]._shotWarn.at : null, answer: bot._shotAnswers?.get(s?.owner) ? { key: bot._shotAnswers.get(s.owner).key === bot.entities[s.owner]?._shotWarn?.key, choice: bot._shotAnswers.get(s.owner).choice, ends: bot._shotAnswers.get(s.owner).endsAt ? bot._shotAnswers.get(s.owner).endsAt - Date.now() : null } : null, glowing: bot.entities[s?.owner]?.metadata?.[16] }));
    }
  });
  bot.on('entitySpawn', e => { if (e.name === 'small_fireball') counts.fireballs++; });
  let held = false;
  t0 = Date.now();
  bot.on('physicsTick', () => { if (!!bot._shotHold !== held) { held = !!bot._shotHold; if (held) counts.holds++; } if (bot._shotRefused && Date.now() - bot._shotRefused.at < 60) counts.refused[bot._shotRefused.why] = (counts.refused[bot._shotRefused.why] || 0) + 1; });
  if (process.env.PROBE_DEBUG_HOLD) setInterval(() => console.log(Math.round((Date.now() - t0) / 100) / 10, bot._shotHold?.why || '-', bot.entity.position.floored().toString(), JSON.stringify(bot.controlState)), 1000);
  const ends = [[X, Y, Z - 4], [X, Y, Z + 4]];
  let leg = 1;
  while (Date.now() - t0 < seconds * 1000) {
    const [gx, gy, gz] = ends[leg];
    bot.pathfinder.setGoal(new goals.GoalBlock(gx, gy, gz));
    const start = Date.now();
    while (Date.now() - start < 15000 && Date.now() - t0 < seconds * 1000) {
      const p = bot.entity.position;
      if (Math.abs(p.x - gx - 0.5) < 0.6 && Math.abs(p.z - gz - 0.5) < 0.6) break;
      await sleep(100);
    }
    bot.pathfinder.setGoal(null);
    counts.laps += 0.5; leg = 1 - leg;
    // Then three seconds of work stood still, facing away from the blaze
    // (the wall, a dig): most of the trials' landings came so.
    const still = Date.now();
    while (Date.now() - still < 3000 && Date.now() - t0 < seconds * 1000) { await bot.look(Math.PI / 2, 0, true); if (bot.targetDigBlock == null) bot.swingArm(); await sleep(250); }
  }
  console.log(JSON.stringify({ mode, seconds, blazes: count, ...counts, tally: bot._shotTally || null }));
  run(`kill @e[tag=probe]`); run(`kill @e[type=minecraft:small_fireball]`);
  bot.quit(); setTimeout(() => process.exit(0), 300);
});
