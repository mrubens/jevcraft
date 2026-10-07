'use strict';
// The milestones the bot on a port stands at now, from the tail of its
// newest flight record, as midgame.js reads them: "nether" in the Nether,
// "fortress" on the fortress search's walk to one it found. One per line.
// Used by checkpoint.sh to keep a snapshot the first time a trial gets there,
// so later stages can be started from it (the user, 2026-09-27: trials spent
// one to two hours reaching the Nether, and the fortress, rods and pearls
// were tried a few times a day).
//   node scripts/trials/milestone.js <port>
const fs = require('fs');
const path = require('path');

const port = process.argv[2];
const dir = path.join(__dirname, '..', '..', '.bot-state', 'flight');
let newest = null;
try {
  newest = fs.readdirSync(dir).filter(f => f.includes(`-${port}-`) && f.endsWith('.jsonl'))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
} catch (_) { process.exit(0); }
if (!newest) process.exit(0);
const file = path.join(dir, newest);
const size = fs.statSync(file).size, from = Math.max(0, size - 200000);
const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(size - from);
fs.readSync(fd, buf, 0, buf.length, from); fs.closeSync(fd);
const frames = buf.toString('utf8').split('\n').slice(1).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const last = frames.filter(f => f.snapshot?.dimension).at(-1)?.snapshot;
if (!last || last.health === 0) process.exit(0);
const out = [];
if (/nether/.test(String(last.dimension))) out.push('nether');
// In the End, alive (note 1402): the dragon's fight started again from the
// moment of entry, many times a day. The stronghold stage's first live End
// entry (25595, 2026-10-07 20:08Z) died in the dragon's breath a minute in.
if (/the_end/.test(String(last.dimension))) out.push('dragon');
// On its floors (the map's floors are the fortress's own bricks), as
// midgame.js marks it; a stalk of a mob is not a fortress: 25589 (mid-243-ma)
// stalked a blaze 25 blocks off at 17:23:47Z by a bastion 16 blocks from
// where it read a fortress, and a "fortress" stage was saved there
// (mid-243-ma-172613, note 750d).
if (frames.slice(-40).some(f => { const s = f.snapshot?.goal?.step || f.snapshot?.step; return s?.action === 'find_fortress' && (s.walking || s.patrolling || s.exploring); })) out.push('fortress');
// At its stronghold with the eyes the portal wants (note 1398): the stage the
// dragon is tried from many times a day. In the Overworld, the stronghold
// located, and the eyes held (carried by the last frames that show the
// pack, or in the bot's Overworld chests) at least the portal's empty frames
// (twelve where none are counted); none of 2026-10-06's eight sets of eyes
// reached a frame, each of them about a day of play to make again.
try {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.bot-state', `127_0_0_1-${port}-Jev.json`), 'utf8')), goal = g.goal || g;
  const ms = goal.gameProgress?.milestones || {};
  if (/overworld/.test(String(last.dimension)) && (ms.stronghold_located || goal.endPortal?.center) && !goal.endPortal?.litAt) {
    const carried = Math.max(0, ...frames.slice(-120).map(f => Number(f.snapshot?.inventory?.ender_eye || 0)));
    const kept = (goal.rodStashes || []).filter(c => !c.lostAt && c.dimension === 'overworld').reduce((n, c) => n + Number(c.contents?.ender_eye || 0), 0);
    const frs = goal.endPortal?.frames || ms.stronghold_located?.frames || [];
    const need = Number.isInteger(goal.endPortal?.neededEyes) ? goal.endPortal.neededEyes : frs.length ? frs.filter(f => !f.eye).length : 12;
    // And there: within 600 blocks of the portal (the save is the dragon's
    // part, not the walk to it). mid-243-ma-end-3 (25597, 2026-10-07 17:35Z)
    // was saved with its eleven eyes in a chest 2,400 blocks off its portal.
    const c = goal.endPortal?.center || ms.stronghold_located?.center, p = last.position;
    const near = c && p && Math.hypot(p.x - c.x, p.z - c.z) <= 600;
    if (need > 0 && near && carried + kept >= need) out.push('stronghold');
  }
} catch (_) { /* no state */ }
process.stdout.write(out.join('\n'));
