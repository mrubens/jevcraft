'use strict';
// What the game comes back to in this dimension: the chests holding the
// End's makings (rod-stash.js) and the End portal found. A search that walks
// away says how far from them each way leads (note 1371). 25598 (2026-10-06),
// its twelve eyes banked at (203, 63, 245) and its End portal found at
// (604, -37, 1540), went to top up food at 16:37Z and chose a heading at each
// leg of the search with only the biomes and water said; by 17:04Z it was
// at (984, 63, -752), 1350 blocks from its eyes, and there built a Nether
// portal to go back for them. It drowned at 17:56Z on the way, its iron
// armour and shield lost two thousand blocks from the End portal.
const r = n => Math.round(n);

function anchorsOf(bot, goal) {
  const out = [];
  try {
    const rs = require('./rod-stash');
    const dim = rs.dimOf(bot);
    for (const s of rs.stashes(goal)) {
      if (s.dimension !== dim || !rs.withContents(s)) continue;
      out.push({ what: `the chest with ${rs.listed(s.contents)} at (${s.position.x}, ${s.position.y}, ${s.position.z})`, at: s.position });
    }
    // In the Overworld, the portal its Nether chests lie behind (note 1397):
    // 25590 (2026-10-07 15:00 to 15:15Z), five rods and eleven pearls in its
    // Nether chests, was walked from 201 to 657 blocks off its portal on food
    // searches whose headings named none of it.
    if (dim === 'overworld') {
      const nether = rs.stashes(goal).filter(s => s.dimension === 'nether' && rs.withContents(s));
      const here = bot.entity?.position;
      const portal = here && (goal.portals || []).filter(q => q.dimension === 'overworld').sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
      if (nether.length && portal) {
        const sum = k => nether.reduce((n, s) => n + Number(s.contents?.[k] || 0), 0);
        const what = [['blaze_rod', 'blaze rod'], ['ender_pearl', 'ender pearl'], ['ender_eye', 'eye of ender']].filter(([k]) => sum(k)).map(([k, w]) => `${sum(k)} ${w}${sum(k) === 1 ? '' : 's'}`).join(', ');
        out.push({ what: `the portal at (${portal.x}, ${portal.y}, ${portal.z}), the way to the bot's Nether chests (${what})`, at: portal });
      }
    }
    const c = goal?.endPortal?.center;
    if (dim === 'overworld' && c) out.push({ what: `the End portal at (${c.x}, ${c.y}, ${c.z})`, at: c });
  } catch (_) { /* nothing known */ }
  return out;
}

// How far a walk of `reach` blocks on heading (east = 0, by eighths, as
// exploration.js's rays) takes the bot from each anchor.
function headingSays(bot, goal, heading, { reach = 128 } = {}) {
  const here = bot.entity?.position;
  if (!here) return '';
  const angle = heading * Math.PI / 4, x = here.x + Math.cos(angle) * reach, z = here.z + Math.sin(angle) * reach;
  const said = anchorsOf(bot, goal).map(a => {
    const d0 = Math.hypot(a.at.x - here.x, a.at.z - here.z), d1 = Math.hypot(a.at.x - x, a.at.z - z);
    return `${d1 < d0 ? 'nearer' : 'farther'} ${r(Math.abs(d1 - d0))} to ${r(d1)} blocks from ${a.what}`;
  });
  return said.length ? ` ${reach} blocks this way: ${said.join('; ')}.` : '';
}

// Where the bot stands from them now.
function nowSays(bot, goal) {
  const here = bot.entity?.position;
  if (!here) return null;
  const said = anchorsOf(bot, goal).map(a => `${r(Math.hypot(a.at.x - here.x, a.at.z - here.z))} blocks from ${a.what}`);
  return said.length ? said.join('; ') : null;
}

module.exports = { anchorsOf, headingSays, nowSays };
