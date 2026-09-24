// How to meet one skeleton eight blocks off, measured: twenty seconds a stance
// on the arena server (25574 only), a probe player, full health each round.
// 2026-09-24: no shield 17.7, per-arrow block 16.3, shield held 0 (no kill),
// bow with cover 15.8 to 17.5 (no kill), advance behind the shield 2 (dead in 5 s),
// sprint at it with a stone sword and no shield 0 to 2 (dead in 4 s).
//   NODE_PATH=node_modules node scripts/shield-probe.js [none|deflect|held|bow|advance|charge]
const mineflayer = require('mineflayer'); const fs = require('fs'); const { Vec3 } = require('vec3');
const B = require('path').join(__dirname, '..');
const { arenaBuild, sessionSetup } = require(B + '/scripts/lib/arena');
const { deflect } = require(B + '/src/projectile-guard');
const { Task } = require(B + '/src/skills');
const CONSOLE = B + '/.test-combat/console.in';
const say = l => fs.appendFileSync(CONSOLE, l + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAME = 'ShieldProbe', D = 'minecraft:the_nether', STAND = [2010.5, 77, 2010.5], SKEL = [2010.5, 77, 2002.5];
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25574, username: NAME, version: '26.1' });
async function round(label, stance) {
  say(`execute in ${D} run kill @e[type=minecraft:skeleton]`); say(`execute in ${D} run kill @e[type=minecraft:arrow]`);
  say(`clear ${NAME}`); say(`gamemode survival ${NAME}`);
  if (stance !== 'none' && stance !== 'charge') say(`item replace entity ${NAME} weapon.offhand with minecraft:shield`);
  if (stance.startsWith('advance') || stance === 'charge') say(`item replace entity ${NAME} weapon.mainhand with minecraft:stone_sword`);
  if (stance === 'bow') { say(`give ${NAME} minecraft:bow`); say(`give ${NAME} minecraft:arrow 32`); }
  say(`execute in ${D} run tp ${NAME} ${STAND.join(' ')} 180 0`);
  say(`effect give ${NAME} minecraft:instant_health 1 5 true`); say(`effect give ${NAME} minecraft:saturation 1 5 true`);
  await sleep(2500);
  say(`execute in ${D} run summon minecraft:skeleton ${SKEL.join(' ')} {PersistenceRequired:1b}`);
  await sleep(500);
  const start = bot.health; let hits = 0, lowest = bot.health; const onHurt = () => { if (bot.health < lowest) hits++; lowest = Math.min(lowest, bot.health); };
  bot.on('health', onHurt);
  const end = Date.now() + 20000, task = new Task('probe');
  const skel = () => Object.values(bot.entities).find(e => e.name === 'skeleton');
  if (stance === 'held') bot.activateItem(true);
  let killedAt = null;
  while (Date.now() < end && bot.health > 4) {
    const s = skel();
    if (!s) { killedAt ??= Date.now(); await sleep(200); continue; }
    await bot.lookAt(s.position.offset(0, 1.5, 0), true);
    if (stance === 'bow') {
      const { shoot } = require(B + '/src/combat');
      try { await shoot(bot, task, s, {}); } catch (e) { console.log('shoot', e.message); await sleep(300); }
      continue;
    }
    if (stance === 'charge') {
      if (s.position.distanceTo(bot.entity.position) <= 2.8) { bot.setControlState('forward', false); bot.attack(s); await sleep(650); }
      else { bot.setControlState('forward', true); bot.setControlState('sprint', true); await sleep(100); }
      continue;
    }
    if (stance.startsWith('advance')) {
      const d = s.position.distanceTo(bot.entity.position);
      if (d <= 2.8) { bot.setControlState('forward', false); bot.deactivateItem(); await sleep(stance === 'advance_quick' ? 50 : 150); bot.attack(s); await sleep(250); bot.activateItem(true); await sleep(400); }
      else { bot.activateItem(true); bot.setControlState('forward', true); await sleep(150); }
      continue;
    }
    if (stance === 'deflect') await deflect(bot, task).catch(() => {});
    await sleep(stance === 'deflect' ? 50 : 200);
  }
  if (stance === 'held' || stance.startsWith('advance') || stance === 'charge') { bot.deactivateItem(); bot.clearControlStates(); }
  bot.removeListener('health', onHurt);
  console.log(JSON.stringify({ label, damage: Math.round((start - lowest) * 10) / 10, hits, killedIn: killedAt ? Math.round((killedAt - (end - 20000)) / 100) / 10 : null, shieldSlot: bot.inventory.slots[45]?.name || null }));
}
bot.once('spawn', async () => {
  try {
    for (const c of [...sessionSetup(), ...arenaBuild('room')]) say(c);
    await sleep(3000);
    const only = process.argv[2];
    for (const [label, stance] of [['no shield', 'none'], ['shield raised per arrow (deflect)', 'deflect'], ['shield held up throughout', 'held'],
      ['bow with shield cover (shoot)', 'bow'], ['advance behind the shield', 'advance'], ['charge with a sword, no shield', 'charge']]) if (!only || only === stance) await round(label, stance);
  } catch (e) { console.log('error', e.message); }
  say(`execute in ${D} run kill @e[type=minecraft:skeleton]`); say(`gamemode spectator ${NAME}`);
  bot.quit(); setTimeout(() => process.exit(0), 500);
});
bot.on('error', e => { console.log('bot error', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 120000);
