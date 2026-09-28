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
// second once the air is gone (vitals.js drowningSeconds).
const RATE = { lava: 8, in_fire: 2, burning: 1, head_in_block: 2, drowning: 2 };
// What burning lasts after the source is left: fifteen seconds after lava,
// eight after fire.
const BURNS_AFTER = { lava: 15, fire: 8 };
// The answer waited for before the fallback takes it: five times the 0.2
// seconds answers take (note 530), and under half of the shortest window
// (lava from full health).
const ASK_MS = 1000;
// A way Jev chose to leave be (burning left to burn out) is held until the
// health has fallen this much more, or the burning could have ended.
const HOLD_HEALTH = 4;

const round = n => Math.round(n * 10) / 10;
// Fire resistance on the body (an enchanted golden apple's): lava and
// burning do not hurt while it lasts.
function fireResistant(bot) {
  const e = bot?.registry?.effectsByName?.fire_resistance || bot?.registry?.effectsByName?.FireResistance;
  return !!e && !!bot.entity?.effects?.[e.id];
}

// How long the body lasts at the rate it is losing health now.
function lasts(bot, key, { air = bot.oxygenLevel ?? 20, inFire = false } = {}) {
  const hp = bot.health ?? 20;
  if (key === 'air') {
    const breath = require('./vitals').breathSeconds(bot, air);
    return { breathSeconds: round(breath), thenLosesPerSecond: RATE.drowning, secondsToDeath: round(breath + Math.max(0, hp / RATE.drowning)) };
  }
  if ((key === 'lava' || key === 'fire') && fireResistant(bot)) return { losesPerSecond: 0, fireResistance: true, secondsToDeath: null };
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
function lavaThroughArmour(bot) {
  const names = [5, 6, 7, 8].map(slot => bot?.inventory?.slots?.[slot]?.name).filter(Boolean);
  if (!names.length) return null;
  const ce = require('./combat-estimate');
  return 2 * ce.afterArmour(4, ce.armourOf(names));
}

// The condition in words, for the question's state.
function conditionSays(bot, key, facts = {}) {
  const l = lasts(bot, key, facts);
  const hp = round(bot.health ?? 20);
  if (l.fireResistance) return `${key === 'lava' ? 'In lava' : facts.inFire ? 'Standing in fire' : 'Alight'} at ${hp} health, with fire resistance on the body: it does not hurt while that lasts.`;
  switch (key) {
    case 'lava': return `In lava at ${hp} health: it takes about ${l.losesPerSecond} health a second ${l.throughArmourWorn ? 'through the armour worn (fire protection not counted)' : 'before armour'}, about ${l.secondsToDeath} seconds to death at that rate; once out, the body burns on up to ${BURNS_AFTER.lava} seconds at a health a second unless put out in water.`;
    case 'fire': return facts.inFire
      ? `Standing in fire at ${hp} health: about ${l.losesPerSecond} health a second before armour, about ${l.secondsToDeath} seconds to death at that rate, and it burns on up to ${BURNS_AFTER.fire} seconds after the fire is left.`
      : `Alight at ${hp} health, out of the fire: about ${l.fireLeftSeconds} second${l.fireLeftSeconds === 1 ? '' : 's'} of fire left (from the hurt that lit it: ${BURNS_AFTER.lava} after lava, ${BURNS_AFTER.fire} after fire, 5 after a fireball), a health a second that armour does not stop, about ${l.healthItTakes} health${l.burnsToDeath ? ', all the health the bot has' : ''}; water puts it out at once, and the Nether has no water.`;
    case 'head_in_block': return `The head is in ${facts.block ? `a block of ${String(facts.block).replaceAll('_', ' ')}` : 'a block'} at ${hp} health: suffocating, about ${l.losesPerSecond} health a second, about ${l.secondsToDeath} seconds to death at that rate.`;
    case 'air': return `The head is under water with ${facts.air ?? bot.oxygenLevel} of 20 air at ${hp} health: about ${l.breathSeconds} seconds of breath, then drowning at ${l.thenLosesPerSecond} health a second, about ${l.secondsToDeath} seconds to death if nothing changes.`;
    default: return `${key} at ${hp} health.`;
  }
}

// A way Jev chose to leave be, still standing: burning left to burn out.
function held(bot, key, now = Date.now()) {
  const h = bot?._bodyHeld;
  if (!h || h.key !== key) return null;
  if (now > h.until || (bot.health ?? 20) <= h.health - HOLD_HEALTH) { delete bot._bodyHeld; return null; }
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
  const tree = Object.fromEntries(keys.map(k => [k, { description: ways[k].description, run: ways[k].run }]));
  // Only a cancellation stops the question: the task's own check throws for
  // the very lava or breath it is asked about, and the watchers' stops
  // (a threat, a preemption) are what this answers first.
  const only = { get cancelled() { return task?.cancelled; }, label: task?.label, check() { if (task?.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
  const t0 = Date.now();
  let decision, by = 'jev';
  try {
    decision = await (decide || require('./decisions').decide)('body_way', { client, bot, task: only, goal, save, tree, watchAir: false,
      context: { ...context, default: keys[0] },
      state: { condition: key, says: conditionSays(bot, key, facts), health: bot.health, ...lasts(bot, key, facts), ...facts },
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
  if (way.hold && (by === 'jev' || by === 'only')) bot._bodyHeld = { key, choice, at: Date.now(), until: Date.now() + way.hold * 1000, health: bot.health ?? 20 };
  else if (bot?._bodyHeld?.key === key) delete bot._bodyHeld;
  const acted = await way.run();
  return { key: choice, by, acted: acted !== false };
}

module.exports = { answer, held, lasts, conditionSays, fireResistant, RATE, BURNS_AFTER, ASK_MS, HOLD_HEALTH };
