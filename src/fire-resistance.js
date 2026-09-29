'use strict';
// Fire resistance: the potion that makes a blaze's fire nothing (note 656).
//
// Read from the 26.1.2 server jar:
// - LivingEntity.hurtServer returns before any hurt or knockback when the
//   damage is fire (the is_fire damage tag: in_fire, campfire, on_fire,
//   lava, hot_floor, fireball, unattributed_fireball) and the body has
//   fire resistance. A blaze's small fireball is `fireball` damage: with the
//   effect it does nothing, pushes nothing, and the fire it sets is put
//   back as it was (SmallFireball.onHitEntity: setRemainingFireTicks when
//   the hurt did not land). Burning (on_fire) and lava do nothing.
// - Not fire: a blaze's swing within two blocks (a mob attack), a ghast's
//   blast (LargeFireball.onHit, level.explode: explosion damage; the six of
//   its direct hit is `fireball` and does nothing), arrows, blades, falls.
// - Potions.FIRE_RESISTANCE is 3600 ticks, three minutes; LONG_FIRE_RESISTANCE
//   9600, eight. Their ids in the potion registry (the potion_contents
//   component's potionId) are 11 and 12 (the jar's registries report).
// - A potion is drunk in 32 ticks (1.6 seconds). A splash potion is thrown
//   and acts where it breaks, on each body within four blocks, its length
//   cut by the distance from the break to the body's box
//   (ThrownSplashPotion). Thrown at the feet on the scratch server (note
//   656) two gave 2:21 and 3:00 of the three minutes.
// - The piglin barter table (loot_table/gameplay/piglin_bartering.json),
//   one roll a gold ingot: 469 in weight, of which a fire resistance potion
//   8 and a fire resistance splash potion 8 (both the three-minute kind), a
//   water bottle 10, ender pearls 10 (two to four).
const round = n => Math.round(n * 10) / 10;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const POTIONS = { 11: { potion: 'fire_resistance', seconds: 180 }, 12: { potion: 'long_fire_resistance', seconds: 480 } };
const BY_NAME = { fire_resistance: POTIONS[11], long_fire_resistance: POTIONS[12] };
const KINDS = { potion: 'drink', splash_potion: 'splash', lingering_potion: 'lingering' };
const DRINK_SECONDS = 1.6, SPLASH_SECONDS = 0.5;
// The barter table's weights (the jar's piglin_bartering.json).
const BARTER = { total: 469, potion: 8, splash: 8, pearls: 10, pearlsEach: 3 };
const PER_THROW = (BARTER.potion + BARTER.splash) / BARTER.total;
// Lava is counted harmless only with this much of the effect left: a
// lava swim out and the fifteen seconds of burning that lava sets after it,
// with the rest as margin. The seconds are said wherever it is counted.
const SURE_SECONDS = 30;

// The potion an item holds: its potion_contents component (26.1) or the
// old Potion tag. -> { kind, potion, seconds } for fire resistance, else null.
function potionOf(item) {
  if (!item || !KINDS[item.name]) return null;
  let id = null;
  const c = item.componentMap?.get?.('potion_contents') || (item.components || []).find(x => x?.type === 'potion_contents');
  if (c) id = c.data?.potionId ?? c.data?.potion ?? null;
  let def = Number.isFinite(Number(id)) ? POTIONS[Number(id)] : typeof id === 'string' ? BY_NAME[id.replace('minecraft:', '')] : null;
  if (!def) {
    const tag = item.nbt?.value?.Potion?.value;
    if (typeof tag === 'string') def = BY_NAME[tag.replace('minecraft:', '')];
  }
  if (!def) return null;
  return { kind: KINDS[item.name], potion: def.potion, seconds: def.seconds };
}
const isFireResistance = item => !!potionOf(item);

// The fire resistance potions carried, drinkable ones first, the longest first.
function carried(bot) {
  const items = bot?.inventory?.items?.() || [];
  return items.map(item => ({ item, ...potionOf(item) })).filter(p => p.kind && p.kind !== 'lingering')
    .sort((a, b) => (a.kind === 'drink' ? 0 : 1) - (b.kind === 'drink' ? 0 : 1) || b.seconds - a.seconds);
}

// The one that acts soonest (a splash, thrown, before a potion drunk), for
// the body already in lava or fire.
const quickest = bot => carried(bot).sort((a, b) => (a.kind === 'splash' ? 0 : 1) - (b.kind === 'splash' ? 0 : 1) || b.seconds - a.seconds)[0] || null;
const takes = p => p?.kind === 'drink' ? DRINK_SECONDS : SPLASH_SECONDS;

// A body_way (body.js) that drinks or throws one, where the body is in
// lava, fire or on a hot floor (note 656): `where` says the hurt it stops.
function bodyWay(bot, task, where, onAction = () => {}) {
  const p = quickest(bot);
  if (!p) return null;
  const count = carried(bot).reduce((n, x) => n + (x.item.count || 1), 0);
  return { description: `${p.kind === 'drink' ? 'Drink' : 'Throw at the feet'} ${kindSays(p)} (${count} fire resistance potion${count === 1 ? '' : 's'} carried): about ${takes(p)} seconds first, hurt meanwhile, then ${where} for ${clock(p.seconds)}, running down whatever is done; the way out still to take after.`,
    seconds: takes(p),
    run: async () => { onAction({ action: 'drink_fire_resistance', kind: p.kind, health: bot.health }); return drink(bot, task, p); } };
}

// The seconds of fire resistance left on the body (combat-estimate
// effectLeft, from the time the server sent it), 0 with none.
function left(bot, now = Date.now()) {
  try { return require('./combat-estimate').effectLeft(bot, 'fire_resistance', now)?.seconds || 0; } catch (_) { return 0; }
}
const sure = (bot, now) => left(bot, now) >= SURE_SECONDS;

const clock = s => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const kindSays = p => p.kind === 'drink' ? `a potion of fire resistance (${clock(p.seconds)}), drunk in ${DRINK_SECONDS} seconds` : `a splash potion of fire resistance (${clock(p.seconds)}), thrown at the feet: it acts about ${SPLASH_SECONDS} seconds from the throw, for most of its length (two thrown at the feet gave 2:21 and 3:00 of 3:00; the farther from the body it breaks, the shorter)`;
// What fire resistance does and does not stop, said once wherever it is.
const WHAT = 'While it lasts a blaze\'s fireball does nothing (no hurt, no push, no fire), burning and fire do nothing, and lava does not hurt; a blaze\'s swing within two blocks, a ghast\'s blast (its direct hit is fire and does nothing, the explosion is not), arrows, blades and falls hurt as ever.';

// The effect and the potions carried, in words.
function says(bot, now = Date.now()) {
  const s = left(bot, now), have = carried(bot);
  const on = s > 0 ? `Fire resistance is on the body with about ${clock(s)} left${s < SURE_SECONDS ? ` (under ${SURE_SECONDS} seconds: lava is still counted as hurting)` : ''}; it runs down whatever is done.` : 'No fire resistance on the body.';
  const kinds = have.length ? ` Carried: ${have.map(p => `${p.item.count > 1 ? `${p.item.count} x ` : ''}${kindSays(p)}`).join('; ')}.` : '';
  return `${on}${kinds}${s > 0 || have.length ? ` ${WHAT}` : ''}`;
}

// A barter's chance of a fire resistance potion, and what it costs.
function barterOdds(ingots = 0) {
  const n = Math.max(0, Math.floor(ingots));
  return { perThrow: PER_THROW, perHundred: round(PER_THROW * 100), expectedIngots: round(1 / PER_THROW), withGold: n, chanceWithGold: n ? Math.round(100 * (1 - (1 - PER_THROW) ** n)) : 0 };
}
function barterSays(ingots = 0) {
  const o = barterOdds(ingots);
  return `A piglin's barter is one gold ingot a throw, and each throw brings one of the barter table's items: a fire resistance potion ${BARTER.potion} in ${BARTER.total}, a fire resistance splash potion ${BARTER.splash} in ${BARTER.total} (the game's table), about ${o.perHundred} in 100 a throw for either, about ${o.expectedIngots} ingots for one on the average${o.withGold ? `; with the ${o.withGold} ingot${o.withGold === 1 ? '' : 's'} to throw, about ${o.chanceWithGold} in 100 of at least one` : ''}. Each is the three-minute kind; it starts running down when drunk, not when bartered. The same throws bring pearls at their own odds (ender pearls ${BARTER.pearls} in ${BARTER.total}, two to four at a time), and the pearls and potions are picked up either way.`;
}

// Drink (or throw at the feet) the best one carried. -> true once the
// effect is on the body.
async function drink(bot, task, pick = carried(bot)[0]) {
  if (!pick?.item) return false;
  const before = left(bot);
  try {
    await bot.equip(pick.item, 'hand');
    for (let n = 0; n < 10 && bot.heldItem?.name !== pick.item.name; n++) { task?.check?.(); await sleep(50); }
    if (pick.kind === 'drink') await bot.consume();
    else {
      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
      bot.activateItem();
      await sleep(50);
      bot.deactivateItem?.();
    }
  } catch (err) { task?.check?.(); if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err; }
  for (let n = 0; n < 10 && !(left(bot) > before); n++) { task?.check?.(); await sleep(150); }
  return left(bot) > before;
}

module.exports = { quickest, takes, bodyWay, POTIONS, BARTER, PER_THROW, DRINK_SECONDS, SPLASH_SECONDS, SURE_SECONDS, WHAT, potionOf, isFireResistance, carried, left, sure, clock, kindSays, says, barterOdds, barterSays, drink };
