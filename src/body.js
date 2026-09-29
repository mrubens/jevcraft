'use strict';
// The body's own dangers, asked of Jev (the user, 2026-09-28: "Which
// reflexes do we have? Can we get rid of them and just ask Jev"). In lava,
// alight, a head in a block, out of breath: the code took one way out by
// rule, the one it ranked first. Each is now one question (body_way), asked
// the moment the step meets it, with the ways out the code can carry out
// from here, each with its seconds, and how long the body lasts at the rate
// it is losing health. The answer is acted on at once; Jev answers in about
// 0.2 seconds (note 530), inside every one of these windows (lava, the
// shortest, is 2.5 seconds from full health). The code's old order is the
// question's fallback, when Jev cannot be reached or has not answered in
// ASK_MS.
//
// The ways themselves (a walk out of lava, a pillar, a dig, a swim) are the
// mechanics they always were, built where they live (survival.js lavaWays,
// vitals.js fireWays, headWays, airWays): this module asks and holds.

// Health a second at the game's rates. Lava hurts 4 a time and a body can
// be hurt once each half second: 8 a second, before armour and fire
// protection. Standing in fire, 1 a half second; burning, 1 a second, which
// armour does not stop. A head in a block, 1 a half second; drowning, 2 a
// second once the air is gone (vitals.js drowningSeconds). A hot floor (a
// magma block, a lit campfire) 1 a half second, a soul campfire 2 (the
// terrain's HOT_FLOOR, its hurt a time), through armour (note 579).
const RATE = { lava: 8, in_fire: 2, burning: 1, head_in_block: 2, drowning: 2, hot_floor: 2 };
// What burning lasts after the source is left: fifteen seconds after lava,
// eight after fire.
const BURNS_AFTER = { lava: 15, fire: 8 };
// The answer waited for before the fallback takes it: five times the 0.2
// seconds answers take (note 530), and under half of the shortest window
// (lava from full health).
const ASK_MS = 1000;
// A way Jev chose to leave be (burning left to burn out) is held until the
// health has fallen this much more, or half what it was when that is less
// (so it is asked again before the health is gone: mid-244-bb chose to let
// it burn at 8.3 and was asked next at 0.3, note 595), or the burning
// could have ended, or a way not on offer then is on offer now.
const HOLD_HEALTH = 4;
const holdDrop = hp => Math.min(HOLD_HEALTH, (hp ?? 20) / 2);
// The ways on offer now, for a hold to be looked at against: a way that
// was not there when the burn was left be (the bucket that would not pour
// with the feet at the lava's edge, or in the air over a step) is a new
// question. mid-244-bb came out of lava at 12.3 with a water bucket, its
// feet still in the lava's edge cell: burning out was the one way, held,
// and the fire took it to 8.3 before anything was asked (note 595).
const WAYS_NOW = { fire: bot => require('./vitals').inFire(bot) ? null : Object.keys(require('./vitals').fireWays(bot, null)) };
// Looked at no oftener than this (a pond's search is some hundreds of
// blocks read).
const RECHECK_MS = 250;
// A way a blow stopped is said to the questions asked this soon after.
const STOPPED_SAID_MS = 10000;

const round = n => Math.round(n * 10) / 10;
// Fire resistance on the body (an enchanted golden apple's, a potion's):
// lava and burning do not hurt while it lasts. Counted here, where lava is
// weighed as harmless or deadly, only with half a minute or more of it left
// (fire-resistance.js SURE_SECONDS: a swim out and the fifteen seconds of
// burning after lava); less, the lava is counted as it is without it
// (note 656). An effect whose time the server did not give is counted.
function fireResistant(bot, now = Date.now()) {
  const e = bot?.registry?.effectsByName?.fire_resistance || bot?.registry?.effectsByName?.FireResistance;
  const on = !!e && bot.entity?.effects?.[e.id];
  if (!on) return false;
  if (!Number.isFinite(on.duration) || on.duration < 0) return true;
  const fr = require('./fire-resistance');
  return fr.left(bot, now) >= fr.SURE_SECONDS;
}

// Alight out of the fire: the fire resistance left outlasts the fire left on
// the body, so the burning does nothing (note 656).
function outlastsBurning(bot) {
  const s = require('./fire-resistance').left(bot);
  return s > 0 && s >= require('./combat-estimate').burnLeft(bot) + 1;
}

// How long the body lasts at the rate it is losing health now.
function lasts(bot, key, facts = {}) {
  const { air = bot.oxygenLevel ?? 20, inFire = false } = facts;
  const hp = bot.health ?? 20;
  if (key === 'air') {
    const breath = require('./vitals').breathSeconds(bot, air);
    return { breathSeconds: round(breath), thenLosesPerSecond: RATE.drowning, secondsToDeath: round(breath + Math.max(0, hp / RATE.drowning)) };
  }
  if ((key === 'lava' || key === 'fire' || key === 'hot_floor') && (fireResistant(bot) || (key === 'fire' && !inFire && outlastsBurning(bot)))) return { losesPerSecond: 0, fireResistance: true, secondsToDeath: null };
  // The hot floor's hurt is cut by the armour worn, as lava's is: the
  // magma took 0.7 a time off mid-242-aa-nether-3 in an iron helmet and
  // chestplate (note 579).
  if (key === 'hot_floor') {
    const hurt = hurtHalfSecond(facts);
    const worn = throughArmour(bot, hurt);
    const rate = worn ?? 2 * hurt;
    return { losesPerSecond: round(rate), ...(worn != null ? { throughArmourWorn: true } : { beforeArmour: true }), secondsToDeath: round(hp / rate) };
  }
  const rate = key === 'lava' ? RATE.lava : key === 'fire' ? (inFire ? RATE.in_fire : RATE.burning) : RATE.head_in_block;
  // Alight out of the fire, the fire left on the body (combat-estimate
  // burnLeft, note 548): it ends before the health does, or not.
  if (key === 'fire' && !inFire) {
    const left = round(require('./combat-estimate').burnLeft(bot));
    return { losesPerSecond: rate, fireLeftSeconds: left, healthItTakes: round(Math.min(hp, left * rate)), secondsToDeath: round(hp / rate), ...(left * rate >= hp ? { burnsToDeath: true } : {}) };
  }
  // Lava through the armour worn: its four a time is cut by the game's
  // armour formula (lava is not among the damage that bypasses armour).
  // mid-244-ab in full iron was told "about 2.3 seconds to death" at 18.1
  // health and lasted 4.9, about 1.9 a hit (note 569). Fire protection is
  // not counted.
  if (key === 'lava') {
    const worn = lavaThroughArmour(bot);
    if (worn != null && worn < rate) return { losesPerSecond: round(worn), throughArmourWorn: true, secondsToDeath: round(hp / worn) };
  }
  return { losesPerSecond: rate, ...(key === 'lava' || (key === 'fire' && inFire) ? { beforeArmour: true } : {}), secondsToDeath: round(hp / rate) };
}
function lavaThroughArmour(bot) { return throughArmour(bot, 4); }
// A second of a hurt that comes each half second, through the armour worn.
function throughArmour(bot, hurt) {
  const names = [5, 6, 7, 8].map(slot => bot?.inventory?.slots?.[slot]?.name).filter(Boolean);
  if (!names.length) return null;
  const ce = require('./combat-estimate');
  return 2 * ce.afterArmour(hurt, ce.armourOf(names));
}
const hurtHalfSecond = facts => Number.isFinite(facts.hurt) ? facts.hurt : 1;

// The condition in words, for the question's state.
function conditionSays(bot, key, facts = {}) {
  const l = lasts(bot, key, facts);
  const hp = round(bot.health ?? 20);
  if (l.fireResistance) return `${key === 'lava' ? 'In lava' : key === 'hot_floor' ? `On a ${String(facts.floor || 'hot floor').replaceAll('_', ' ')}` : facts.inFire ? 'Standing in fire' : 'Alight'} at ${hp} health, with fire resistance on the body (${(() => { const s = require('./fire-resistance').left(bot); return s > 0 ? `about ${Math.round(s)} seconds left, running down` : 'its time not given'; })()}): it does not hurt while that lasts.`;
  switch (key) {
    case 'lava': return `In lava at ${hp} health: it takes about ${l.losesPerSecond} health a second ${l.throughArmourWorn ? 'through the armour worn (fire protection not counted)' : 'before armour'}, about ${l.secondsToDeath} seconds to death at that rate; once out, the body burns on up to ${BURNS_AFTER.lava} seconds at a health a second unless put out in water.`;
    case 'fire': return facts.inFire
      ? `Standing in fire at ${hp} health: about ${l.losesPerSecond} health a second before armour, about ${l.secondsToDeath} seconds to death at that rate, and it burns on up to ${BURNS_AFTER.fire} seconds after the fire is left.`
      : `Alight at ${hp} health, out of the fire: about ${l.fireLeftSeconds} second${l.fireLeftSeconds === 1 ? '' : 's'} of fire left (from the hurt that lit it: ${BURNS_AFTER.lava} after lava, ${BURNS_AFTER.fire} after fire, 5 after a fireball), a health a second that armour does not stop, about ${l.healthItTakes} health${l.burnsToDeath ? `, all the health the bot has: it dies of the burning in about ${l.secondsToDeath} seconds, before the fire ends, unless it is put out` : `, leaving about ${round(hp - l.healthItTakes)}`}; water puts it out at once, and the Nether has no water.${require('./cauldron').says(bot)}`;
    case 'head_in_block': return `The head is in ${facts.block ? `a block of ${String(facts.block).replaceAll('_', ' ')}` : 'a block'} at ${hp} health: suffocating, about ${l.losesPerSecond} health a second, about ${l.secondsToDeath} seconds to death at that rate.`;
    case 'hot_floor': {
      const floor = String(facts.floor || 'hot floor').replaceAll('_', ' ');
      return `Standing on a ${floor} at ${hp} health: it hurts every half second, about ${l.losesPerSecond} health a second ${l.throughArmourWorn ? 'through the armour worn' : 'before armour'}, about ${l.secondsToDeath} seconds to death at that rate; ${facts.crouchSafe ? 'the game does not hurt a crouched body on a magma block, and' : 'crouching does not stop it;'} off it onto any other floor it stops.`;
    }
    case 'air': return `The head is under water with ${facts.air ?? bot.oxygenLevel} of 20 air at ${hp} health: about ${l.breathSeconds} seconds of breath, then drowning at ${l.thenLosesPerSecond} health a second, about ${l.secondsToDeath} seconds to death if nothing changes.`;
    default: return `${key} at ${hp} health.`;
  }
}

// The burning, for every other question asked while the body is alight
// (decisions/index.js): mid-244-bb was asked survival_priority four times
// burning, 12.3 to 0.3 health, and chose to walk for food each time, the
// fire in no fact of it (note 595). With the way out left be, when it is
// asked again.
function burningSays(bot) {
  if (!(bot?.entity?.metadata?.[0] & 1) || fireResistant(bot) || outlastsBurning(bot)) return null;
  let standing = false; try { standing = require('./vitals').inFire(bot); } catch (_) { /* no world */ }
  const hp = round(bot.health ?? 20);
  const h = bot._bodyHeld?.key === 'fire' ? bot._bodyHeld : null;
  const left = h ? ` The way out was left be: ${h.by === 'only' ? 'burning out was the only way there was' : 'Jev chose to let it burn out'} at ${round(h.health)} health; the way out is asked again at about ${round(Math.max(0, h.health - (h.drop ?? HOLD_HEALTH)))} health, when the burning could have ended, or when a way not on offer then (the water bucket poured, water run into) is on offer.` : '';
  if (standing) return `The bot is standing in fire at ${hp} health: about ${RATE.in_fire} health a second, and it burns on up to ${BURNS_AFTER.fire} seconds after the fire is left.${left}`;
  const l = lasts(bot, 'fire', { inFire: false });
  return `The bot is alight at ${hp} health: about ${l.fireLeftSeconds} second${l.fireLeftSeconds === 1 ? '' : 's'} of fire left, a health a second that armour does not stop, about ${l.healthItTakes} health${l.burnsToDeath ? `, all the health the bot has: it dies of the burning in about ${l.secondsToDeath} seconds, before the fire ends, unless water puts it out first` : ''}. Water puts it out at once; the Nether has none.${require('./cauldron').says(bot)}${left}`;
}

// A way Jev chose to leave be, still standing: burning left to burn out.
function held(bot, key, now = Date.now()) {
  const h = bot?._bodyHeld;
  if (!h || h.key !== key) return null;
  if (now > h.until || (bot.health ?? 20) <= h.health - (h.drop ?? HOLD_HEALTH)) { delete bot._bodyHeld; return null; }
  if (h.offered && WAYS_NOW[key] && !(h.lookedAt > now - RECHECK_MS)) {
    h.lookedAt = now;
    let ways = null;
    try { ways = WAYS_NOW[key](bot); } catch (_) { /* no world to look at: the hold stands */ }
    const fresh = (ways || []).filter(k => !h.offered.includes(k));
    if (fresh.length) { delete bot._bodyHeld; return null; }
  }
  return h;
}

// Ask which way, and carry it out. `ways` is { key: { description, run,
// seconds } } in the code's old order (the first is the fallback's), from
// the builders named above. -> { key, by: 'jev'|'fallback'|'only', acted }
// A way whose run returns false did not get the body out; the step goes on
// as it did when the old rule's way failed.
async function answer(bot, task, key, ways, { client = null, goal = null, save = () => {}, facts = {}, context = {}, log = console.log, decide = null } = {}) {
  const keys = Object.keys(ways || {});
  if (!keys.length) return { key: null, by: 'none', acted: false };
  // In a fight with blazes each way says what followed it in the played fights
  // (blaze-record.js waySays, note 661).
  const said = k => { try { return require('./blaze-record').waySays(bot, k); } catch (_) { return ''; } };
  const tree = Object.fromEntries(keys.map(k => [k, { description: ways[k].description + said(k), run: ways[k].run }]));
  // Only a cancellation stops the question: the task's own check throws for
  // the very lava or breath it is asked about, and the watchers' stops
  // (a threat, a preemption) are what this answers first.
  const only = { get cancelled() { return task?.cancelled; }, label: task?.label, check() { if (task?.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
  const t0 = Date.now();
  // What else is hurting the body while it is asked (note 657): a mob at
  // arm's length and its blows, with where it is from the way the bot
  // faces; and a way chosen a moment ago that a blow stopped.
  let blows = null;
  try { blows = require('./vitals').blowsAtBody(bot); } catch (_) { blows = null; }
  const stopped = bot?._bodyWayStopped && t0 - bot._bodyWayStopped.at < STOPPED_SAID_MS ? bot._bodyWayStopped : null;
  let decision, by = 'jev';
  try {
    decision = await (decide || require('./decisions').decide)('body_way', { client, bot, task: only, goal, save, tree, watchAir: false,
      context: { ...context, default: keys[0] },
      state: { condition: key, says: conditionSays(bot, key, facts), health: bot.health, ...lasts(bot, key, facts), ...facts,
        ...(blows ? { atArmsLength: blows.says } : {}),
        ...(stopped ? { lastWay: `${stopped.way.replaceAll('_', ' ')} was chosen ${round((t0 - stopped.at) / 1000 + stopped.after)} seconds ago and stopped ${stopped.after} seconds in: ${stopped.why}.` } : {}) },
      interrupt: () => { if (Date.now() - t0 >= ASK_MS) throw Object.assign(new Error(`body_way: no answer in ${ASK_MS / 1000} seconds`), { name: 'CutShort' }); } });
  } catch (err) {
    if (err?.name === 'Cancelled') throw err;
    // Cut short or failed: the old order's way, said.
    log(`[body] ${key}: ${err?.message || err}; took ${keys[0]} by the old order`);
    decision = { path: [keys[0]], action: tree[keys[0]] };
    by = 'fallback';
  }
  if (keys.length === 1) by = 'only';
  else if (decision.fallback || !client) by = 'fallback';
  const choice = decision.path?.[0] && ways[decision.path[0]] ? decision.path[0] : keys[0];
  const way = ways[choice];
  // Held as Jev's choice, or as the one way there is: the old order's
  // burning left alone asked nothing and held nothing, the turn staying
  // with the fire as it did. Burning out as the only way was not held, and
  // mid-242-aa-nether-1-fortress-1, alight in the Nether with no apple, took
  // it forty times in fifteen minutes, every step (note 560).
  // Kept with the ways it was chosen among: one that comes after is asked.
  if (way.hold && (by === 'jev' || by === 'only')) bot._bodyHeld = { key, choice, by, at: Date.now(), until: Date.now() + way.hold * 1000, health: bot.health ?? 20, drop: holdDrop(bot.health), offered: keys };
  else if (bot?._bodyHeld?.key === key) delete bot._bodyHeld;
  const began = Date.now();
  const acted = await way.run();
  // A way a mob's blow stopped (cauldron.js struck) is said to the next
  // question, with what stopped it.
  if (acted === false && bot?._blowAt > began) bot._bodyWayStopped = { way: choice, at: Date.now(), after: round((bot._blowAt - began) / 1000), why: `a blow from ${bot._blowBy ? `the ${String(bot._blowBy).replaceAll('_', ' ')}` : 'a mob'} at arm's length knocked the body back` };
  return { key: choice, by, acted: acted !== false };
}

module.exports = { answer, held, holdDrop, burningSays, lasts, conditionSays, fireResistant, outlastsBurning, RATE, BURNS_AFTER, ASK_MS, HOLD_HEALTH };
