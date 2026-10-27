'use strict';
// A ruined portal or a village known on the way, offered on the upkeep question as a trip of its own (note 2302): what
// it usually holds, the walk there with its height, and which of the bot's open needs it covers. The loot trip to a
// ruin sat inside 'side trip', one of eight, and villages were offered only for their beds. The user, watching full-10
// (2026-10-27 17:0xZ): 'Jev found a ruined portal and a village, not doing anything with either. Is that right?', then
// 'yes, build it'. Serendipity (memory): react to what is found.
const { Vec3 } = require('vec3');
const SCAN = 384;

const countOf = (bot, name) => (bot.inventory?.items?.() || []).filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const words = n => n.replaceAll('_', ' ');

function needsSays(bot, kind) {
  const worn = [5, 6, 7, 8].map(s => bot.inventory?.slots?.[s]?.name).filter(Boolean);
  const out = [];
  if (kind === 'ruined_portal') {
    if (!worn.includes('golden_boots') && countOf(bot, 'golden_boots') === 0) out.push('no golden boots yet (piglins leave a player in any gold alone; four gold ingots make them, and a ruin\'s chest often holds gold or a gold piece)');
    if (countOf(bot, 'flint_and_steel') === 0) out.push('no flint and steel carried (a ruin\'s chest often holds one)');
    if (countOf(bot, 'obsidian') < 10) out.push(`${countOf(bot, 'obsidian')} of the portal's ten obsidian carried (the ruin's frame stands part built, finished by placing the missing blocks, and its chest may hold more)`);
  } else {
    if (countOf(bot, 'bread') + countOf(bot, 'cooked_beef') + countOf(bot, 'cooked_porkchop') < 8) out.push('little food carried (village chests hold bread, and each hay bale is nine wheat, three bread)');
    if (countOf(bot, 'iron_ingot') < 8) out.push(`${countOf(bot, 'iron_ingot')} iron ingots carried (village chests often hold iron)`);
  }
  return out.length ? ` Of what the bot is short of: ${out.join('; ')}.` : '';
}

function walkSays(bot, at) {
  const L = require('./levels'), H = require('./height-says');
  const flat = Math.round(Math.hypot(at.x - bot.entity.position.x, at.z - bot.entity.position.z));
  const mins = Math.max(1, Math.round(L.walkSeconds(flat) / 60));
  return `${flat} blocks off${H.heightSays(bot, at)}, about ${mins} minute${mins === 1 ? '' : 's'} at the bot's ${L.LEVEL_RECORD.walkBlocksAMinute} blocks a minute, and as long back to here${H.wayFailedSays(bot, at)}`;
}

// -> { [key]: option } for the upkeep question.
function foundOptions(bot, goal, { lootActions = null } = {}) {
  if (!/overworld/.test(String(bot.game?.dimension || 'overworld')) || !bot.entity?.position) return {};
  const out = {};
  try {
    const ruin = require('./looting').unlootedLandmarks(bot, goal, SCAN).find(l => l.landmark.kind === 'ruined_portal');
    if (ruin && lootActions) out.visit_ruined_portal = {
      description: `Go to the ruined portal at (${ruin.landmark.x}, ${ruin.landmark.y}, ${ruin.landmark.z}), ${walkSays(bot, ruin.landmark)}, and open its chest: a ruined portal's chest holds gold (nuggets, ingots, sometimes a gold armour piece or tool), flint and steel or a fire charge, obsidian now and then, and sometimes a golden apple.${needsSays(bot, 'ruined_portal')}`,
      run: async (b, t, g, sv) => require('./looting').lootStep(b, t, g, sv, lootActions),
    };
  } catch (_) { /* not offered */ }
  try {
    const here = bot.entity.position;
    const village = (goal.villages || []).filter(v => !v.lootedAt && String(v.dimension || 'overworld').includes('overworld') && Math.hypot(v.x - here.x, v.z - here.z) <= SCAN)
      .sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z))[0];
    if (village && lootActions?.navigate) out.visit_village = {
      description: `Go to the village at (${village.x}, ${village.y}, ${village.z}), ${walkSays(bot, village)}, and open its chests: a village holds ${village.beds ? `${village.beds} beds, ` : ''}${village.hay ? `${village.hay} hay bales (nine wheat each), ` : ''}chests with bread, iron and now and then tools or diamonds, and villagers who trade for emeralds.${needsSays(bot, 'village')}`,
      run: async (b, t, g, sv) => {
        const { goals } = require('mineflayer-pathfinder');
        await lootActions.navigate(b, t, new goals.GoalNear(village.x, village.y, village.z, 8), { timeoutMs: 240000, stallMs: 15000 });
        let took = 0;
        for (let i = 0; i < 8; i++) { t.check(); if (!(await require('./looting').lootNearby(b, t, g, sv, lootActions))) break; took++; }
        village.lootedAt = Date.now(); sv();
        console.log(`[village] at (${village.x}, ${village.z}): ${took} chest${took === 1 ? '' : 's'} opened`);
        return took > 0;
      },
    };
  } catch (_) { /* not offered */ }
  return out;
}

module.exports = { foundOptions };
