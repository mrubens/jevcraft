'use strict';
// How often a fight with blazes asks shot_answer and encounter_stance (note
// 709): per fight-minute, the fights as scripts/blaze-record.js fights() has
// them, split by whether a spawner's blazes were about (three or more within
// 16 at once). Each shot_answer is also sorted by whether an encounter_stance
// answer was in force (answered in the 15 seconds before, the stance's own
// hold), and whether that stance is one that answers the warnings itself
// since note 709 (shot-reflex.js STANCE_SHOTS): what the rule takes off the
// questions, read on records from before it.
//   node scripts/fight-asks.js [--from 2026-09-29T22:00:00Z] [--to ISO] [--dir <flight dir>]
const path = require('path');
const { eachFile, fights } = require('./blaze-record');
const { stanceShotsOf } = require('../src/shot-reflex');

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const from = Date.parse(arg('--from', '2026-09-29T22:00:00Z'));
const to = Date.parse(arg('--to', new Date().toISOString()));
const dir = arg('--dir', path.join(__dirname, '..', '.bot-state', 'flight'));
const HOLD_MS = 15000;

const rows = { spawner: { fights: 0, ms: 0, shot: 0, stance: 0, shotUnderStance: 0, shotByStance: 0 }, other: { fights: 0, ms: 0, shot: 0, stance: 0, shotUnderStance: 0, shotByStance: 0 } };
const worst = [];
eachFile(dir, from, '"blaze"', (frames, file) => {
  const asks = frames.filter(f => f.kind === 'decision' && f.snapshot?.decision?.id).map(f => ({ at: f.at, id: f.snapshot.decision.id, by: f.snapshot.decision.by || null, path: f.snapshot.decision.path }));
  for (const e of fights(frames, { from, to })) {
    const r = e.max16 >= 3 ? rows.spawner : rows.other;
    const inside = asks.filter(a => a.at >= e.start && a.at <= e.end);
    const stances = inside.filter(a => a.id === 'encounter_stance');
    const shots = inside.filter(a => a.id === 'shot_answer');
    r.fights++; r.ms += e.end - e.start; r.shot += shots.length; r.stance += stances.length;
    r.shotUnderStance += shots.filter(s => asks.some(a => a.id === 'encounter_stance' && a.at <= s.at && s.at - a.at < HOLD_MS)).length;
    const stanceAt = s => asks.filter(a => a.id === 'encounter_stance' && a.at <= s.at && s.at - a.at < HOLD_MS).at(-1);
    r.shotByStance += shots.filter(s => stanceShotsOf(stanceAt(s)?.path?.[0])).length;
    const minutes = (e.end - e.start) / 60000;
    if (minutes >= 0.5) worst.push({ file: file.slice(10, 15), start: new Date(e.start).toISOString().slice(11, 19), minutes: Math.round(minutes * 10) / 10, perMinute: Math.round((shots.length + stances.length) / minutes * 10) / 10, shot: shots.length, stance: stances.length });
  }
});
const say = (name, r) => {
  const min = r.ms / 60000;
  console.log(`${name}: ${r.fights} fights, ${Math.round(min)} fight-minutes; shot_answer ${r.shot} (${(r.shot / min).toFixed(1)} a minute, ${r.shotUnderStance} with a stance answered in the 15 s before, ${r.shotByStance} of those under a stance that now answers them), encounter_stance ${r.stance} (${(r.stance / min).toFixed(1)} a minute); both ${((r.shot + r.stance) / min).toFixed(1)} a fight-minute`);
};
console.log(`${new Date(from).toISOString()} to ${new Date(to).toISOString()}`);
say('spawner (3+ blazes within 16)', rows.spawner);
say('fewer blazes', rows.other);
console.log('busiest fights (half a minute or more):');
for (const w of worst.sort((a, b) => b.perMinute - a.perMinute).slice(0, 8)) console.log(`  ${w.file} ${w.start} ${w.minutes} min: ${w.perMinute} a minute (${w.shot} shot, ${w.stance} stance)`);
