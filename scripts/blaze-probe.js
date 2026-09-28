'use strict';
// A blaze's volley, measured against a player in iron with a shield: on the
// arena server (25574 only), one blaze hovering at a set distance over a
// netherrack floor in a carved room, a probe player standing still and
// facing it, full health each round, the game's own fire (mob griefing on).
// Logs when the blaze glows (its charged flag, metadata 16 bit 0), each
// fireball's spawn, every hurt and the fire on the player.
//   node scripts/blaze-probe.js [none|always|timed] [distance] [seconds] [blazes]
// none: the shield never up; always: up and facing it the whole round;
// timed: up from 2.6 seconds into each glow (its three shots come at 3.0,
// 3.3 and 3.6) until a second after it stops glowing, down between.
const mineflayer = require('mineflayer'); const fs = require('fs'); const path = require('path');
const { arenaDir } = require('./lib/arena');
const { volleyWatch, volleyDue, charged } = require('../src/blaze-stand');
const CONSOLE = process.env.ARENA_CONSOLE || path.join(arenaDir(), 'console.in');
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mode = process.argv[2] || 'none', distance = Number(process.argv[3] || 12), seconds = Number(process.argv[4] || 40), count = Number(process.argv[5] || 1);
const PORT = Number(process.env.MC_PORT || 25574), UP = Number(process.env.PROBE_UP || 1);
const NAME = 'BlazeProbe', D = 'minecraft:the_nether', X = 1600, Y = 100, Z = 1600;
const run = c => say(`execute in ${D} run ${c}`);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: NAME, version: '26.1', auth: 'offline' });
const events = [];
const t0 = { at: 0 };
const note = (what, extra = {}) => { const e = { t: Math.round((Date.now() - t0.at) / 100) / 10, what, ...extra }; events.push(e); console.log(JSON.stringify(e)); };
bot.once('spawn', async () => {
  run(`forceload add ${X - 32} ${Z - 32} ${X + 48} ${Z + 32}`);
  run(`fill ${X - 6} ${Y - 4} ${Z - 6} ${X + 30} ${Y + 14} ${Z + 6} minecraft:netherrack`);
  run(`fill ${X - 5} ${Y} ${Z - 5} ${X + 29} ${Y + 13} ${Z + 5} minecraft:air`);
  run(`kill @e[type=!minecraft:player,x=${X - 6},y=${Y - 4},z=${Z - 6},dx=40,dy=20,dz=14]`);
  say('gamerule minecraft:mob_griefing true'); say('difficulty normal');
  say(`clear ${NAME}`); say(`gamemode survival ${NAME}`);
  run(`tp ${NAME} ${X + 0.5} ${Y} ${Z + 0.5} -90 0`);
  for (const [slot, item] of [['head', 'iron_helmet'], ['chest', 'iron_chestplate'], ['legs', 'iron_leggings'], ['feet', 'iron_boots']]) say(`item replace entity ${NAME} armor.${slot} with minecraft:${item}`);
  say(`item replace entity ${NAME} weapon.offhand with minecraft:shield`);
  // The trials' sword in the main hand (PROBE_SWORD=1), as in a fight.
  if (process.env.PROBE_SWORD) say(`item replace entity ${NAME} weapon.mainhand with minecraft:${process.env.PROBE_SWORD === "1" ? "iron_sword" : process.env.PROBE_SWORD}`);
  // PROBE_HOLE=1: the probe stands in a hole one wide and two high, rock
  // behind, beside and over it, its mouth toward the blazes.
  if (process.env.PROBE_HOLE) {
    run(`fill ${X - 1} ${Y} ${Z - 1} ${X} ${Y + 2} ${Z + 1} minecraft:netherrack`);
    run(`fill ${X} ${Y} ${Z} ${X} ${Y + 1} ${Z} minecraft:air`);
  }
  say(`effect clear ${NAME}`); say(`effect give ${NAME} minecraft:instant_health 1 20 true`);
  await sleep(2500);
  volleyWatch(bot);
  // Spread across the front, thirty degrees apart.
  for (let i = 0; i < count; i++) {
    const a = (i - (count - 1) / 2) * Math.PI / 6;
    run(`summon minecraft:blaze ${(X + 0.5 + distance * Math.cos(a)).toFixed(1)} ${Y + UP} ${(Z + 0.5 + distance * Math.sin(a)).toFixed(1)} {PersistenceRequired:1b,Tags:["probe"]}`);
  }
  await sleep(500);
  t0.at = Date.now();
  let hp = bot.health, burning = false, shield = false, glow = false, damage = 0, burnDamage = 0;
  bot.on('health', () => { if (bot.health < hp) { const lost = Math.round((hp - bot.health) * 10) / 10; damage += hp - bot.health; if (burning && lost <= 1.01) burnDamage += lost; note('hurt', { lost, health: Math.round(bot.health * 10) / 10, burning }); } hp = bot.health; });
  bot.on('entitySpawn', e => { if (e.name === 'small_fireball') note('fireball', { off: Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10 }); });
  const all = () => Object.values(bot.entities).filter(e => e.name === 'blaze');
  const blaze = () => all()[0];
  while (Date.now() - t0.at < seconds * 1000 && bot.health > 6) {
    const b = blaze();
    if (!b) { await sleep(100); continue; }
    await bot.lookAt(b.position.offset(0, 1, 0), true);
    const g = charged(b);
    if (g !== glow) { glow = g; note(g ? 'glows' : 'stops glowing', { off: Math.round(b.position.distanceTo(bot.entity.position) * 10) / 10, dy: Math.round((b.position.y - bot.entity.position.y) * 10) / 10 }); }
    const b2 = !!(bot.entity.metadata?.[0] & 1);
    if (b2 !== burning) { burning = b2; note(b2 ? 'alight' : 'out'); }
    const want = mode === 'always' || (mode === 'timed' && all().some(e => volleyDue(bot, e)));
    if (count > 1) { const c = all().reduce((s, e) => s.plus(e.position), b.position.scaled(0)).scaled(1 / all().length); await bot.lookAt(c.offset(0, 1, 0), true); }
    // PROBE_OFF=<degrees>: face that far round from the blaze, to measure
    // how wide the shield covers.
    if (process.env.PROBE_OFF) await bot.look(bot.entity.yaw + Number(process.env.PROBE_OFF) * Math.PI / 180, bot.entity.pitch, true);
    if (want && !shield) { bot.activateItem(true); shield = true; note('shield up'); }
    if (!want && shield) { bot.deactivateItem(); shield = false; note('shield down'); }
    await sleep(50);
  }
  const summary = { mode, distance, seconds: Math.round((Date.now() - t0.at) / 1000), damage: Math.round(damage * 10) / 10, burnDamage: Math.round(burnDamage * 10) / 10,
    fireballs: events.filter(e => e.what === 'fireball').length, glows: events.filter(e => e.what === 'glows').length, hurts: events.filter(e => e.what === 'hurt').length };
  console.log(JSON.stringify({ summary }));
  run(`kill @e[tag=probe]`); run(`kill @e[type=minecraft:small_fireball]`);
  run(`fill ${X - 5} ${Y} ${Z - 5} ${X + 29} ${Y + 13} ${Z + 5} minecraft:air replace minecraft:fire`);
  bot.quit(); setTimeout(() => process.exit(0), 300);
});
