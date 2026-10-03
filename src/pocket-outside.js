'use strict';
// What stands outside a sealed pocket, in two facts the pocket's question
// did not say (note 1067): what meeting it costs as the bot is, and, at
// night in the Overworld, whether the dawn ends it where it stands.
// 25595 (2026-10-03 14:34:41 to 14:35:09Z), back to life with bare hands and
// nothing on, sealed a pocket two blocks under the grass against one zombie
// with 54 seconds of the night left, was told the stay "waits for nothing
// but the minutes" and that the zombie was "not in the way out", tunnelled
// out at 0.39 (the stay 0.21), met the zombie at its tunnel's end and died
// to it from 20 health in eight seconds; the dawn it did not wait for burns
// a zombie under open sky.
const { fightEstimate } = require('./combat-estimate');

// The kinds the sun burns (the game's rule): not a husk, a creeper or a spider.
const SUN = /^(zombie|zombie_villager|skeleton|stray|bogged|drowned|phantom)$/;
const words = n => String(n).replaceAll('_', ' ');
const round = n => Math.round(n * 10) / 10;

// mobs: danger.js threats ({ entity, distance, visible }). -> { stay, leave }
function outsideSays(bot, mobs, { night = false, minutesToDawn = null } = {}) {
  const out = { stay: '', leave: '' };
  const near = (mobs || []).filter(t => t?.entity?.position && t.entity.name !== 'creeper').slice(0, 4);
  if (!near.length || !/overworld/.test(String(bot?.game?.dimension || 'overworld'))) return out;
  let fight = '';
  try {
    const armour = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
    const weapon = (bot.inventory?.items?.() || []).map(i => i.name).find(n => /_(sword|axe)$/.test(n)) || null;
    if (!weapon || armour.length < 2) {
      const est = fightEstimate({ threats: near.map(t => ({ name: t.entity.name, distance: t.distance, shoots: false, visible: !!t.visible, id: t.entity.id })), armour, weapon, health: bot.health ?? 20 });
      const cost = est?.fightHere;
      if (cost && Number.isFinite(cost.damageTaken)) {
        const them = near.length === 1 ? `the ${words(near[0].entity.name)}` : `the ${near.length} of them`;
        fight = ` Met outside as the bot is (${weapon ? words(weapon) : 'bare hands'}, ${armour.length ? armour.map(words).join(', ') : 'nothing worn'}): about ${round(cost.seconds)} seconds of fighting and ${round(cost.damageTaken)} damage to kill ${them}, from ${round(bot.health ?? 20)} health${cost.damageTaken >= (bot.health ?? 20) ? ', more than the bot has' : ''}.`;
      }
    }
  } catch (_) { fight = ''; }
  let sun = '';
  if (night) {
    try {
      const { openSkyOver } = require('./surface');
      const burns = near.filter(t => SUN.test(t.entity.name) && openSkyOver(bot, t.entity.position));
      if (burns.length) {
        const who = burns.length === 1 ? `The ${words(burns[0].entity.name)} ${Math.round(burns[0].distance)} blocks off stands` : `${burns.length} of them (${burns.map(t => `the ${words(t.entity.name)} ${Math.round(t.distance)} off`).join(', ')}) stand`;
        const dawn = Number.isFinite(minutesToDawn) ? (minutesToDawn <= 1 ? 'about a minute off' : `about ${minutesToDawn} real minutes off`) : 'when it comes';
        sun = ` ${who} under open sky: the dawn, ${dawn}, burns ${burns.length === 1 ? 'it' : 'them'} there (the game's rule for zombies and skeletons in daylight)`;
      }
    } catch (_) { sun = ''; }
  }
  out.stay = `${fight}${sun ? `${sun}, and a stay to the dawn outlasts ${/^The /.test(sun.trim()) ? 'it' : 'them'}.` : ''}`;
  out.leave = `${fight}${sun ? `${sun}; going out now meets ${/^The /.test(sun.trim()) ? 'it' : 'them'} before that.` : ''}`;
  return out;
}

module.exports = { outsideSays, SUN };
