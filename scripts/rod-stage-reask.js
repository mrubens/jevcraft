'use strict';
// Note 759's before and after on recorded questions: the fight's questions
// (encounter_stance, hunt_target, turn_priority, empty_spawner, body_way)
// asked in the last minute before each death that dropped rods (the lives
// scripts/rod-stage.js --json wrote), asked of Jev again as recorded and
// with the rods at risk said (src/rod-risk.js, from the inventory the frame
// recorded). Each answer is sorted as going away (out of the blazes' fire,
// to heal, or the rods into a chest) or staying (a fight, a stand, a hunt,
// the work). A before and after of Jev's answers to the same words, not of
// what the bot then did.
// With --simulate, the after arm also has the options note 759 adds where the
// recorded question would have had them, their words built from the frame
// (not from the world, which the record does not hold, so the cell and the
// steps are stood in): body_way, where a way said its end was in a blaze's
// line, out_of_their_line three blocks off; encounter_stance with a blaze
// about, where the inventory carried a chest or the wood for one, stash_rods
// in their fire, priced from the recorded estimate's mobs for its seconds.
//   node scripts/rod-stage-reask.js --lives <rod-stage --json file> [--dir <flight dir>] [--runs 3] [--min-rods 2] [--limit 40] [--simulate]
require('../src/env').loadEnv();
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const dir = args.dir || path.join(__dirname, '..', '.bot-state', 'flight');
const runs = Number(args.runs || 3), minRods = Number(args['min-rods'] || 2), limit = Number(args.limit || 40);
const IDS = new Set(args.ids ? args.ids.split(',') : ['encounter_stance', 'hunt_target', 'turn_priority', 'empty_spawner', 'body_way']);
const AWAY = /^(stash_rods|leave_and_heal|retreat|leave_reach|out_of_sight|step_out|wait_far_off|heal_first|go_back|eat|step_out_and_eat|vitals|out_of_their_line|seal|nook|dig_down|take_cover|portal_back)$/;
const kindOf = (id, k) => k === 'none_good' ? 'none_good' : id === 'turn_priority' ? (k === 'survival' || k === 'vitals' ? 'away' : 'stay') : AWAY.test(k) ? 'away' : 'stay';

// The recorded questions: the last of each id in the minute before the death.
function questionsOf(life) {
  const file = path.join(dir, (life.files || [life.file]).at(-1));
  const t = Date.parse(life.end), out = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"kind":"decision"')) continue;
    let x; try { x = JSON.parse(line); } catch (_) { continue; }
    const d = x.snapshot?.decision, at = Date.parse(x.at);
    if (!d || !IDS.has(d.id) || at < t - 60000 || at > t || !d.options || !d.state) continue;
    out.set(d.id, { id: d.id, at: x.at, choice: d.path?.at(-1), options: d.options, state: d.state, inventory: x.snapshot.inventory || {} });
  }
  return [...out.values()];
}
// A body to say the rods from: the recorded inventory, in the Nether.
const bodyOf = inv => ({ game: { dimension: 'the_nether' }, inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } });

// The options note 759 adds, as they would have been said here (--simulate).
function simulated(q) {
  const add = {};
  const text = v => String(typeof v === 'string' ? v : v?.description ?? '');
  if (q.id === 'body_way' && Object.values(q.options).some(v => /Its end is in the line of the blaze/.test(text(v)))) {
    const hp = Math.round((q.state.health ?? 20) * 10) / 10, left = Math.max(1, Math.round(q.state.fireLeftSeconds || 5)), takes = q.state.healthItTakes ?? left;
    const burnsOn = q.state.burnsToDeath ? `about ${left} second${left === 1 ? '' : 's'} of it, more than the ${hp} health the bot has` : `about ${left} second${left === 1 ? '' : 's'} of it, about ${takes} health`;
    add.out_of_their_line = { description: `Walk 3 blocks to a cell the blazes in sight have no line to from where they are now (rock stands between): about 0.7 seconds, in their line until there${q.state.inFire ? ', out of the fire on the way' : ''}. The fire on the body burns on (${burnsOn}); there no fireball lands and none lights it again while they have no line. A blaze that loses sight of the bot comes on toward it and fires once it has a line again. Its end is out of the line of the blaze from where they are now.` };
  }
  if (q.id === 'encounter_stance' && !q.options.stash_rods && (q.inventory.blaze_rod || 0) >= 2 && q.state.estimate?.mobs?.some(m => m.name === 'blaze')) {
    const inv = q.inventory, sum = re => Object.entries(inv).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
    const planks = sum(/_planks$/), logs = sum(/_(log|stem|wood|hyphae)$/), table = (inv.crafting_table || 0) > 0;
    if (inv.chest || planks + 4 * logs >= (table ? 8 : 12)) {
      const rs = require('../src/rod-stash'), ce = require('../src/combat-estimate'), sv = require('../src/survival');
      const making = inv.chest ? { carried: true, seconds: 0 } : { carried: false, table, logsUsed: Math.max(0, Math.ceil(((table ? 8 : 12) - planks) / 4)), seconds: 7 };
      const seconds = inv.chest ? 1 : 8, mobs = q.state.estimate.mobs, seen = mobs.filter(m => m.name === 'blaze' && m.visible);
      const offer = { what: ['blaze_rod', 'blaze_powder', 'ender_pearl'].filter(n => inv[n]).map(n => ({ item: n, count: inv[n] })), rods: inv.blaze_rod, wanted: 7, seconds, making,
        site: { off: 2, cell: { x: 0, y: 0, z: 0 }, seen: true }, seenBy: seen.map(() => ({ name: 'blaze' })) };
      let price = '';
      try { const cost = ce.stanceCost({ mobs, seconds, shield: !!q.state.shield, health: q.state.health }); price = sv.costSays(cost, q.state.health, mobs, { over: `in the ${seconds} second${seconds === 1 ? '' : 's'} it takes` }); } catch (_) { price = ''; }
      add.stash_rods = { description: rs.offerSays(offer, { riskInState: true }).replace(' at (0, 0, 0)', '') + price };
    }
  }
  return add;
}

if (require.main === module) (async () => {
  const { TypeSafe } = require('../src/typesafe');
  const { decide } = require('../src/decisions');
  const { risk } = require('../src/rod-risk');
  const client = new TypeSafe();
  const lives = fs.readFileSync(args.lives, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(l => l.death && (l.death.rodsLost || 0) >= minRods && /Blaze|burn|flames/.test(l.death.cause || ''));
  const tally = { before: {}, after: {} }, byId = {};
  let n = 0;
  for (const life of lives) {
    for (const q of questionsOf(life)) {
      if (n >= limit) break;
      if (args.simulate && !Object.keys(simulated(q)).length) continue;
      n++;
      const tree = Object.fromEntries(Object.entries(q.options).filter(([k]) => k !== 'none_good').map(([k, v]) => [k, typeof v === 'string' ? { description: v } : v]));
      const said = risk(bodyOf(q.inventory), { kind: 'win' });
      for (const arm of ['before', 'after']) {
        const state = arm === 'after' && said ? { ...q.state, rodsAtRisk: said.says } : q.state;
        const armTree = arm === 'after' && args.simulate ? { ...tree, ...simulated(q) } : tree;
        for (let i = 0; i < runs; i++) {
          let k;
          try { const r = await decide(q.id, { client, bot: null, goal: {}, tree: JSON.parse(JSON.stringify(armTree)), state }); k = r.noneGood ? 'none_good' : r.path[0]; } catch (err) { k = `error`; }
          const kind = kindOf(q.id, k);
          if (arm === 'after' && args.simulate && /^(stash_rods|out_of_their_line)$/.test(k)) (tally.newChosen ||= {})[k] = (tally.newChosen[k] || 0) + 1;
          tally[arm][kind] = (tally[arm][kind] || 0) + 1;
          ((byId[q.id] ||= { before: {}, after: {} })[arm][kind] = (byId[q.id][arm][kind] || 0) + 1);
        }
      }
      console.log(`${life.end.slice(11, 19)} ${q.id} recorded ${q.choice} (rods ${said?.carried ?? '?'}): before ${JSON.stringify(byId[q.id].before)} after ${JSON.stringify(byId[q.id].after)}`);
    }
  }
  console.log(JSON.stringify({ questions: Math.min(n, limit), runs, tally, byId }, null, 1));
})();
module.exports = { simulated, questionsOf, kindOf };
