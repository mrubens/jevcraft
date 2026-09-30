'use strict';
// Low health in blaze fights, from the flight records (note 701).
//   (1) The deaths in fights with blazes (blaze-record.js fights()): the last
//       stance chosen (encounter_stance) before the death, the health it was
//       chosen at, and whether a blaze had the bot in sight then (the
//       nearest observation's mobs, `seen`).
//   (2) Every meal chosen as a stance (encounter_stance eat or
//       eat_golden_apple): whether it was eaten (hunger or saturation up
//       within four seconds of the choice), and, for one not eaten, what was
//       on in those seconds: the shot hold (the recorder's shotHold), the
//       shield up (keys 'shield'), a hurt, a blaze in sight.
//   node scripts/low-health-record.js [--from 2026-09-29T12:00:00Z] [--dir .bot-state/flight] [--under 6]
const path = require('path');
const { eachFile, fights } = require('./blaze-record');
const ce = require('../src/combat-estimate');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const from = Date.parse(args.from || '2026-09-29T12:00:00Z');
const dir = path.resolve(args.dir || path.join(__dirname, '..', '.bot-state', 'flight'));
const UNDER = Number(args.under || 6);
const EAT_WINDOW_MS = 4000;

const slim = f => ({ at: f.at, kind: f.kind, label: f.label, detail: f.detail,
  snapshot: f.snapshot && { health: f.snapshot.health, food: f.snapshot.food, saturation: f.snapshot.foodSaturation, dimension: f.snapshot.dimension,
    mobs: f.snapshot.mobs && f.snapshot.mobs.filter(m => m.name === 'blaze').map(m => ({ name: m.name, d: m.d, seen: m.seen })),
    inventory: f.snapshot.inventory && { blaze_rod: f.snapshot.inventory.blaze_rod || 0 }, equipment: f.snapshot.equipment,
    keys: f.snapshot.keys, shotHold: f.snapshot.shotHold, decisionId: f.snapshot.decision?.id } });

const deaths = [], meals = [];
eachFile(dir, from, null, (frames, file) => {
  // (1) the deaths in blaze fights.
  for (const e of fights(frames, { from })) {
    if (!e.died) continue;
    let stance = null;
    for (let i = e.iEnd; i >= e.i0; i--) { const x = frames[i]; if (x.kind === 'decision' && x.snapshot?.decisionId === 'encounter_stance') { stance = { at: x.at, label: x.label, health: x.snapshot.health, i }; break; } }
    let seen = null;
    if (stance) for (let i = stance.i; i >= Math.max(0, stance.i - 40); i--) { const m = frames[i].snapshot?.mobs; if (m) { seen = m.filter(b => b.seen && b.d <= 24).length; break; } }
    // The one-shot line at the stance: a blaze's fireball through the armour
    // worn and its fire (src/lethal-line.js), from the nearest equipment seen.
    let equip = null;
    if (stance) for (let i = stance.i; i >= 0 && !equip; i--) equip = frames[i].snapshot?.equipment || null;
    const worn = equip ? ['head', 'torso', 'legs', 'feet'].map(k => equip[k]).filter(Boolean) : [];
    const oneShot = ce.afterArmour(ce.MOBS.blaze.hit, ce.armourOf(worn)) + ce.FIRE_TICKS.fireball;
    deaths.push({ oneShot: Math.round(oneShot * 10) / 10, underOneShot: stance ? stance.health <= oneShot : null, file, at: new Date(e.end).toISOString(), stance: stance?.label || null, health: stance ? Math.round(stance.health * 10) / 10 : null, secondsBefore: stance ? Math.round((e.end - stance.at) / 100) / 10 : null, blazesSeeing: seen });
  }
  // (2) the meals chosen as a stance.
  for (let i = 0; i < frames.length; i++) {
    const x = frames[i];
    if (!(x.at >= from) || x.kind !== 'decision' || x.snapshot?.decisionId !== 'encounter_stance' || !/^eat/.test(x.label || '')) continue;
    const food0 = x.snapshot.food, sat0 = x.snapshot.saturation;
    let eaten = false, hold = false, shield = false, hurt = false, died = false, seen = false;
    for (let k = i + 1; k < frames.length && frames[k].at <= x.at + EAT_WINDOW_MS; k++) {
      const s = frames[k].snapshot || {};
      if ((typeof s.food === 'number' && s.food > food0) || (typeof s.saturation === 'number' && typeof sat0 === 'number' && s.saturation > sat0 + 0.01)) { eaten = true; break; }
      if (s.shotHold) hold = true;
      if ((s.keys || []).includes('shield')) shield = true;
      if (frames[k].kind === 'damage') hurt = true;
      if (s.health === 0) died = true;
      if ((s.mobs || []).some(m => m.seen && m.d <= 24)) seen = true;
    }
    meals.push({ file, at: new Date(x.at).toISOString(), label: x.label, health: Math.round(x.snapshot.health * 10) / 10, food: food0, nether: x.snapshot.dimension === 'the_nether', eaten, hold, shield, hurt, died, blazeSeen: seen });
  }
}, slim);

const count = (list, f) => list.filter(f).length;
const blazeDeaths = deaths;
const under = blazeDeaths.filter(d => d.health != null && d.health < UNDER);
console.log(`Flight records since ${new Date(from).toISOString()} (${dir})`);
console.log(`\n(1) Deaths in fights with blazes: ${blazeDeaths.length}; with a stance chosen in the fight ${count(blazeDeaths, d => d.stance)}; the last stance chosen under ${UNDER} health ${under.length}, of those with a blaze seeing the bot then ${count(under, d => d.blazesSeeing > 0)}.`);
const lined = blazeDeaths.filter(d => d.underOneShot && d.blazesSeeing > 0);
console.log(`  the last stance chosen at or under the one-shot line (a blaze's fireball through the armour worn and its fire: 6.5 in full iron, 9 in none) with a blaze seeing the bot: ${lined.length} of ${blazeDeaths.length}`);
const byStance = {};
for (const d of under) byStance[d.stance] = (byStance[d.stance] || 0) + 1;
console.log('  last stances under', UNDER, JSON.stringify(byStance));
for (const d of under) console.log(`  ${d.at} ${d.file.replace(/^127_0_0_1-/, '').slice(0, 40)} ${d.stance} at ${d.health}, ${d.secondsBefore} s before, ${d.blazesSeeing ?? '?'} blazes seeing`);
const fightMeals = meals.filter(m => m.nether);
const notEaten = fightMeals.filter(m => !m.eaten && !m.died);
console.log(`\n(2) Meals chosen as a stance: ${meals.length} (${fightMeals.length} in the Nether); eaten within ${EAT_WINDOW_MS / 1000} s ${count(fightMeals, m => m.eaten)}, not eaten ${fightMeals.length - count(fightMeals, m => m.eaten)} (${count(fightMeals, m => !m.eaten && m.died)} with the death in those seconds).`);
console.log(`  of the ${notEaten.length} not eaten (alive): the shot hold on ${count(notEaten, m => m.hold)}, the shield up ${count(notEaten, m => m.shield)}, hurt ${count(notEaten, m => m.hurt)}, a blaze in sight ${count(notEaten, m => m.blazeSeen)}, none of these ${count(notEaten, m => !m.hold && !m.shield && !m.hurt)}`);
const eatenList = fightMeals.filter(m => m.eaten);
console.log(`  of the ${eatenList.length} eaten: the shot hold on before it was eaten ${count(eatenList, m => m.hold)}, the shield up ${count(eatenList, m => m.shield)}`);
const over = meals.filter(m => !m.nether);
console.log(`  Overworld and End: ${over.length}, eaten ${count(over, m => m.eaten)}`);
if (args.list) for (const m of notEaten) console.log(`  ${m.at} ${m.file.slice(10, 40)} at ${m.health} hold ${m.hold} shield ${m.shield} hurt ${m.hurt}`);
