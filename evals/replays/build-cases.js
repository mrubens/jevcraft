'use strict';
// How cases.jsonl was first built (2026-09-27), from flight records that have since rotated away: kept to show where each case came from. New cases are added to cases.jsonl directly.
// Build evals/replays/cases.jsonl from recorded decisions, with the day's fixes applied to their text.
process.chdir('/Users/matt/Code/jevcraft');
const fs = require('fs'), path = require('path');
function loadDecision(port, from, id, at, nth = 0) {
  const files = fs.readdirSync('.bot-state/flight').filter(f => f.includes(`-${port}-`));
  const out = [];
  for (const f of files) for (const line of fs.readFileSync(path.join('.bot-state/flight', f), 'utf8').split('\n')) {
    if (!line.includes(`"${id}"`)) continue;
    let l; try { l = JSON.parse(line); } catch (_) { continue; }
    const d = l.snapshot?.decision;
    if (d?.id === id && (d.at || l.at) >= from) out.push(d);
  }
  out.sort((a, b) => a.at < b.at ? -1 : 1);
  const d = at ? out.find(x => x.at.slice(11).startsWith(at)) : out.at(nth);
  if (!d) throw new Error(`no ${id} at ${at} on ${port}`);
  return d;
}
const text = v => typeof v === 'string' ? v : JSON.stringify(v);
const treeOf = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.children ? { description: text(v.description), children: treeOf(v.children) } : { description: text(v.description) }]));
const COVER = "Put a block two high in the line of the blaze (20 blocks off), beside the bot, and stay behind it: 2 blocks, about 1.2 seconds; a shot does not come through a block, and a shooter that moves round finds the bot open again. About 1.2 damage from the mobs here in the next fifteen seconds this way, the 1.2 seconds of placing it included, from 1.4 health.";
const WARDEN = " A warden is blind: it finds a player by the vibrations of moving, digging and placing, and by smell, and each sniff angers it more. Angry at a player it cannot reach, it strikes with a sonic boom that passes through blocks and armour: about 10 damage, every few seconds, within 15 blocks across and 20 up or down. A wall does not stop it; only distance does. The warden is 8 blocks off, within the boom's reach. The bot has been hit by the boom 2 times in the last minute.";
const TUNNEL = "Dig a passage out through the pocket's west wall, away from the warden: one wide and two high, 9 blocks, about 23 seconds, ending 17 blocks across from where it is now, beyond its boom's 15; then go back to work from there. Digging is a vibration the warden hears and comes toward." + WARDEN;
const POISON = " The bot is poisoned, about 12 seconds left: poison takes about one health a second or so but never the last one; a harming potion or any hit still can.";
const FIGHT_NOSTEP = "Fight here: swing at whatever comes into reach, and close on the nearest mob when it is within eight blocks and not at reach yet. None of them can be reached from here: every one shoots, none is at reach, and the ground toward the nearest carries no step. Fighting here is standing in their line of fire with nothing to swing at: about 14.3 damage from their shots in the next fifteen seconds, from 10.7 health (more than the bot has), and no end while they shoot.";
const BRICKS = " Within sixteen blocks of the bricks, seen or not: 6 wither skeletons, 1 blaze, 1 magma cube; a way that arrives among them arrives in their fight.";
const BESIDE = "Open the pocket, put the carried bed down on level ground beside it, 3 blocks off, and sleep: the night passes in seconds, instead of about 9 real minutes in the pocket; the bed is picked back up after. Sleep is refused while a monster is within about eight blocks sideways and five up or down of the bed (vanilla), seen or not: none now. Out of the pocket until the bed is down and slept in.";

const specs = [
  { name: 'blaze-at-1.4-cover-offered', src: [25586, '2026-09-27T15:30:05Z', 'encounter_stance', '16:49:5'], add: { take_cover: COVER }, expect: ['take_cover'], forbid: ['pillar', 'none_good'], note: 'note 451' },
  { name: 'blaze-at-1.4-cover-missing', src: [25586, '2026-09-27T15:30:05Z', 'encounter_stance', '16:49:5'], expect: ['none_good', 'retreat', 'seal'], forbid: [], known: 'the pillar is taken against a blaze though its text says two up does not stop one (notes 461, 462)', note: 'notes 451, 462' },
  { name: 'warden-booming-passage-offered', src: [25583, '2026-09-27T13:09:00Z', 'pocket_next', '13:35:1'], append: { stay: WARDEN, leave: WARDEN }, add: { tunnel_from_warden: TUNNEL }, expect: ['tunnel_from_warden', 'none_good'], forbid: ['stay'], note: 'note 412' },
  { name: 'warden-booming-no-way-away', src: [25583, '2026-09-27T13:09:00Z', 'pocket_next', '13:35:1'], append: { stay: WARDEN, leave: WARDEN }, expect: ['none_good', 'leave'], forbid: ['stay'], note: 'notes 412, 462' },
  { name: 'poisoned-by-witch-apple-offered', src: [25590, '2026-09-27T15:31:16Z', 'encounter_stance', '15:53:3'], appendAll: POISON, append: { retreat: ' A witch walks after a player it has seen and throws within about ten blocks; a run that stays in its sight stays in its reach.' }, expect: ['eat_golden_apple'], forbid: [], note: 'note 442' },
  { name: 'pillar-vs-pillager-no-reach', src: [25584, '2026-09-27T13:36:39Z', 'encounter_stance', '14:00:3'], drop: ['charge_shooter'], replace: { fight: FIGHT_NOSTEP }, expect: ['seal', 'take_cover', 'come_down', 'shoot_4400', 'pillar'], forbid: ['fight', 'charge_shooter'], note: 'note 416' },
  { name: 'fortress-mobs-at-bricks', src: [25586, '2026-09-27T12:35:27Z', 'fortress_approach', '14:07'], appendAll: BRICKS, expect: ['tunnel', 'keep_searching', 'walk_route'], forbid: ['descend'], note: 'note 418' },
  { name: 'bedtime-pocket-bed-beside', src: [25591, '2026-09-27T11:54:00Z', 'pocket_next', '13:11'], add: { sleep_beside: BESIDE }, expect: ['sleep_beside'], forbid: [], note: 'notes 428, 429' },
  { name: 'one-zombie-full-health', src: [25587, '2026-09-27T13:04:47Z', 'encounter_stance', '13:45:2'], expect: ['fight', 'bunker'], forbid: ['none_good', 'retreat'], note: 'control' },
  { name: 'crowd-biters-at-arm', src: [25585, '2026-09-27T16:04:02Z', 'encounter_stance', '17:07:4'], drop: ['dig_down'], expect: ['seal', 'fight', 'retreat', 'take_cover'], forbid: ['none_good'], note: 'control: the least bad, not a hedge (note 462)' },
];
const out = [];
for (const c of specs) {
  const [port, from, id, at, nth] = c.src;
  const d = loadDecision(port, from, id, at, nth);
  const tree = treeOf(d.options);
  delete tree.none_good;
  for (const k of c.drop || []) delete tree[k];
  for (const [k, v] of Object.entries(c.replace || {})) if (tree[k]) tree[k].description = v;
  for (const [k, v] of Object.entries(c.append || {})) if (tree[k]) tree[k].description += v;
  if (c.appendAll) for (const k of Object.keys(tree)) tree[k].description += c.appendAll;
  for (const [k, v] of Object.entries(c.add || {})) tree[k] = { description: v };
  const state = { ...d.state }; delete state.runClock;
  out.push({ name: c.name, ...(c.known ? { known: c.known } : {}), question: id, recordedAt: d.at, recordedChoice: d.path, note: c.note, expect: c.expect, forbid: c.forbid, state, tree });
  console.log(c.name, id, d.at, Object.keys(tree).join(','));
}
fs.mkdirSync('evals/replays', { recursive: true });
fs.writeFileSync('evals/replays/cases.jsonl', out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log('wrote', out.length);
