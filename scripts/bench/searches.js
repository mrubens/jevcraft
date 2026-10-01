'use strict';
// Note 795: the synchronous world searches that held the event loop, timed
// offline at the places the bots were when the [slow] lines named them
// (artifacts/midgame-*.log; positions from the flight records), on the
// trial's own world as the server left it (.clean-run*/<world>), else its
// source. Each is timed as it was before note 795 (the state refusals
// stripped, the portal found by a function of the Block) and as it is.
//   node scripts/bench/searches.js [case prefix] [--profile]
const fs = require('node:fs');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { worldBot, time } = require('./world-bot');

// The checkout the trials run from: the nearest directory up with the
// trials' sources (a worktree under .claude/worktrees reads the main one's).
const ROOT = (() => { let d = path.join(__dirname, '..', '..'); while (!fs.existsSync(path.join(d, '.trial-sources')) && path.dirname(d) !== d) d = path.dirname(d); return d; })();
function worldDir(name) {
  for (const d of fs.readdirSync(ROOT).filter(d => d.startsWith('.clean-run'))) {
    const w = path.join(ROOT, d, name);
    if (fs.existsSync(path.join(w, 'level.dat'))) return w;
  }
  const n = name.match(/^mid-(\d+)/)?.[1];
  return path.join(ROOT, '.trial-sources', `first-days-${n}`);
}

const CASES = [
  // surface.js surfaceCandidates: the climb's landing search
  { name: 'landings mid-236-ae y25', world: 'mid-236-ae', at: [218.5, 25, 397.4], run: 'landings', live: '2.4-3.1 s' },
  { name: 'landings mid-237-ay y32', world: 'mid-237-ay', at: [107.5, 32, 64.5], run: 'landings', live: '2.0 s' },
  { name: 'landings mid-226-ad y12', world: 'mid-226-ad', at: [396.5, 12, 196.5], run: 'landings', live: '0.8-0.9 s' },
  { name: 'landings mid-241 start', world: 'mid-241-start', at: [-156, -18, -521], run: 'landings', live: '13-21 s held (note 772)' },
  // work.js explore's land search
  { name: 'explore mid-235-ad', world: 'mid-235-ad', at: [227.5, 62, -40.7], run: 'explore', live: '1.7 s' },
  { name: 'explore mid-226-ae', world: 'mid-226-ae', at: [232.6, 62.2, 207.4], run: 'explore', live: '1.3 s' },
  { name: 'explore mid-231-ad', world: 'mid-231-ad', at: [-47.5, 71, 179.5], run: 'explore', live: '1.2 s' },
  // shore.js reachShore's landings
  { name: 'shore mid-243-az', world: 'mid-243-az', at: [-22.5, 61, -35.6], run: 'shore', live: '4.5 s' },
  { name: 'shore mid-236-ac', world: 'mid-236-ac', at: [223.5, 48.5, 360.5], run: 'shore', live: '2.3 s' },
  { name: 'shore mid-226-af', world: 'mid-226-af', at: [396.6, 5, 218.3], run: 'shore', live: '1.8 s' },
  // shore.js landingsAbout: the banks the water stances state
  { name: 'banks mid-243-az', world: 'mid-243-az', at: [-22.5, 61, -35.6], run: 'banks', live: '(in the stance question)' },
  { name: 'banks mid-226-af', world: 'mid-226-af', at: [396.6, 5, 218.3], run: 'banks', live: '(in the stance question)' },
  // work.js catalogPlan's look about
  { name: 'catalog mid-231-ad', world: 'mid-231-ad', at: [-131.5, 105, 285.5], run: 'catalog', live: '2.1 s' },
  { name: 'catalog mid-229-ac', world: 'mid-229-ac', at: [147.5, 6, 26.5], run: 'catalog', live: '1.3 s' },
  { name: 'catalog mid-226-ae', world: 'mid-226-ae', at: [410.7, 26, 163.5], run: 'catalog', live: '0.9 s' },
  // mob-hunt.js portalBack's portal in view
  { name: 'portal mid-218-aa nether', world: 'mid-218-aa', at: [67.5, 33, 209.5], dimension: 'the_nether', run: 'portal', live: '0.8-1.1 s' },
  { name: 'portal mid-227-ab nether', world: 'mid-227-ab', at: [232.9, 99, 12.5], dimension: 'the_nether', run: 'portal', live: '0.8-1.0 s' },
];

const RUNS = {
  landings: bot => require('../../src/surface').surfaceCandidates(bot, bot.entity.position.floored()),
  explore: bot => { const w = require('../../src/work'); return w.exploreLand(bot, w.exploreLandIds(bot), null); },
  shore: bot => {
    const { dryStanding } = require('../../src/mining-access');
    const { surfaceObserver } = require('../../src/surface');
    const { safeFromHostiles } = require('../../src/danger');
    const isSurface = surfaceObserver(bot), waterY = Math.floor(bot.entity.position.y);
    return require('../../src/shore').shoreLand(bot, p => p.y >= waterY - 3 && dryStanding(bot, p) && isSurface(p) && safeFromHostiles(bot, p));
  },
  banks: bot => { const b = require('../../src/shore').landingsAbout(bot, [], { reach: 64 }); return [b.nearest, b.hidden].filter(Boolean).map(p => new Vec3(p.x, p.y, p.z)); },
  // catalogPlan's own call (work.js), without the planks laid by the bot.
  catalog: bot => {
    const ids = bot.registry.blocksArray.filter(b => /(_log|_wood|_ore|_planks)$|^(stone|sand|gravel|dirt|poppy|cornflower)$/.test(b.name)).map(b => b.id);
    const faces = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].map(f => new Vec3(...f));
    const air = b => b && ['air', 'cave_air', 'void_air'].includes(b.name);
    return bot.findBlocks({ matching: ids, maxDistance: 32, count: 48, exposed: true,
      useExtraInfo: b => faces.some(f => air(bot.blockAt(b.position.plus(f)))) });
  },
  portal: bot => { const r = require('../../src/mob-hunt').portalBack(bot, {}, bot.entity.position); return r ? [r.portal] : []; },
};

// As before note 795: the state refusals ignored, a portal looked for by a
// function of the Block, and the sky over a cell read Block by Block (a
// blockAt that is not the world's own takes the old path).
function asBefore(bot) {
  const find = bot.findBlocks, findOne = bot.findBlock;
  const strip = o => { const { openAbove, exposed, ...rest } = o; const id = bot.registry.blocksByName.nether_portal.id; return rest.matching === id ? { ...rest, matching: b => b?.name === 'nether_portal' } : rest; };
  return Object.assign(Object.create(bot), { blockAt: (p, extra) => bot.blockAt(p, extra), findBlocks: o => find(strip(o)), findBlock: o => { const b = find(strip(o))[0]; return b ? bot.blockAt(b) : null; } });
}

if (require.main === module) {
  const only = process.argv.slice(2).find(a => !a.startsWith('--'));
  const rows = [];
  for (const c of CASES) {
    if (only && !c.name.startsWith(only)) continue;
    const dir = c.world === 'mid-241-start' ? path.join(ROOT, '.trial-sources', 'first-days-241') : worldDir(c.world);
    const { bot } = worldBot(dir, { x: c.at[0], y: c.at[1], z: c.at[2] }, { dimension: c.dimension || 'overworld', radiusChunks: c.run === 'portal' ? 6 : 5 });
    let before, after;
    const beforeMs = time(() => { before = RUNS[c.run](asBefore(bot)); }, 3);
    const afterMs = time(() => { after = RUNS[c.run](bot); }, 3);
    const same = JSON.stringify(before.map(String)) === JSON.stringify(after.map(String));
    rows.push({ ...c, beforeMs, afterMs, found: after.length, same });
    console.log(`${c.name.padEnd(28)} live ${c.live.padEnd(24)} before ${String(beforeMs).padStart(5)} ms  after ${String(afterMs).padStart(4)} ms  found ${after.length}${same ? '' : '  DIFFERENT'}  (${path.relative(ROOT, dir)})`);
  }
}
module.exports = { CASES, RUNS, asBefore, worldDir };
