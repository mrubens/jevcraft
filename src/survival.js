'use strict';
const { move } = require('./motion');
const { makeRoom } = require('./inventory-tidy');
const { attemptsFor, setAside, isSetAside, failedWithin, watch, unwatch } = require('./progress');
const { HOLDS, EMERGENCIES, excused, refused, flipped } = require('./stillness');
const { Vec3 } = require('vec3');
const { feetCell } = require('./terrain');
const { goals } = require('mineflayer-pathfinder');
const { threats, immediateThreat, checkThreats, hunted, claimed, hostileEntities, nightHunted, stanceHeld, coming: comingAt, STANCE_HOLD_MS, STANCE_HEALTH, STANCE_NEWCOMER } = require('./danger');
const shelter = require('./shelter');
const { decide } = require('./decisions');
const { maintainVitals, chooseFood, lastResortFood, sideEffectSays, checkAir } = require('./vitals');
const { foodSupply, lastResortSupply, forageChoices } = require('./foraging');
const { bedCarried, placeOriented, isBed, homeOf, layout, homeChores } = require('./home-base');
const { kitReady } = require('./mob-policy');
const { fightEstimate, stanceCost, RANGE, blocksPerSecond, followRange, bodyHeight, PLAYER_SPRINT, HOLD_SECONDS, slimeSize } = require('./combat-estimate');
// A slime's or a magma cube's size, for the estimate (combat-estimate slimeOf).
const sizeOf = entity => { const size = slimeSize(entity); return size ? { size } : {}; };
const { walkersApart, apartSays } = require('./walk-reach');
const { darkCells, groundCells, placeTorches, lightSources, blockLight } = require('./torches');
// Dark enough where the bot stands for monsters to spawn: a fact for the
// questions that weigh staying against leaving.
const darkHere = bot => { const feet = feetCell(bot); return blockLight(feet, lightSources(bot, feet, 4)) === 0 && ((bot.blockAt(feet)?.skyLight ?? 15) < 8 || night(bot)); };
const { verifyHouse } = require('./objectives');
const { recoverItems } = require('./recovery');
const { surveyRoute, countOf } = require('./skills');
const { defendNearby, defenseWeapon, shooter, shotTargets, shoot, lowerShield, raiseShield, canStrike, strikeTarget } = require('./combat');
const { digBunker, bunkerSide, wallStands, nearWall, centroid } = require('./bunker');
const { deflect } = require('./projectile-guard');
const { takeTurn } = require('./turn');
const { reservedForConstruction } = require('./build-sites');
const { reachShore } = require('./shore');
const { surfaceObserver } = require('./surface');
const { tunnelStep } = require('./tunneling');
const { thinking } = require('./speech');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// What a walk that found no route says, with where it was going
// (skills.js NoRoute carries it).
const noRouteSays = (err, what) => {
  const d = err?.destination;
  return `${what} found no route to ${d ? `(${d.x}, ${Number.isFinite(d.y) ? `${d.y}, ` : ''}${d.z})` : 'its destination'}`;
};
const MEAL_CUT_MS = 10000;
// The rule's step out of every line (note 701) is said with the stance asked
// after it for this long.
const LETHAL_SAID_MS = 15000;
const pos = p => new Vec3(p.x, p.y, p.z);
const { DAY, night } = require('./day');
const { NETHER_FOOD_POINTS, KIT_FOOD_POINTS } = require('./home-stash');
// Lava within two blocks sideways or one below: a knockback lands in it.
// A cell the bot can step into without falling or burning: solid under it,
// room for its body, and no lava beside.
// A witch too: it throws from where it stands and drinks to heal, so it is
// closed on, not waited out behind a wall (trial 7's bot walled off from
// one five times and was poisoned to death between).
// What reaches a player two blocks up, said beside the pillar: spiders
// climb, endermen teleport, witches throw up, a blast reaches (the audit).
// A mob's swing reaches as high as it stands: a wither skeleton (2.4 tall)
// hits a player two up, and mid-92-p pillared from one at twenty health
// and was cut down in four blows while it placed the blocks (2026-09-26).
const REACH_UP = { spider: 'climbs', cave_spider: 'climbs', enderman: 'teleports, and is tall enough to hit two up', witch: 'throws potions up', creeper: 'goes off at the foot and the blast reaches',
  wither_skeleton: 'is tall enough to hit a player two up', ravager: 'is tall enough to hit two up', iron_golem: 'is tall enough to hit two up', warden: 'is tall enough to hit two up',
  // Those that fly: mid-205-g pillared from phantoms twice at five health,
  // told two up was out of reach of all but the climbers (2026-09-27).
  phantom: 'flies, and dives on a player wherever it stands; only a roof keeps it off', blaze: 'flies', vex: 'flies, through walls too', bee: 'flies', allay: 'flies',
  // Those that jump: mid-211-h pillared from a magma cube over the lava sea
  // and it jumped up and knocked the bot off, fifty-five blocks down
  // (2026-09-27).
  magma_cube: 'jumps higher than two blocks, and its hit throws', slime: 'jumps higher than two blocks' };
// A mob's blow reaches as high as it stands and no higher (combat-estimate
// BODY_HEIGHT, from the jar): a walker on ground beside a pillar's column
// reaches a player on the top when that ground's height and its own are
// over the top: a wither skeleton (2.4) from the bot's own floor, a zombie
// or a piglin (1.95) from ground one up beside it. mid-242-aa pillared from
// a tunnel floor at y 73 beside a fortress floor at 74; its top at 75 was
// one above that floor, and the wither skeleton struck it there twice and
// stepped up onto the top as the blows pushed the bot off (note 559).
// The highest ground a walker can stand on in the eight cells round a
// pillar's column, from its base up to its top (a floor under it, room for
// a body over it): { up, at } with `up` above the base, or null. The eight
// all count: a blow reaches a player's box from a diagonal cell too.
function groundBeside(bot, base, most = 2) {
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/lava/.test(b.name); };
  const floor = p => bot.blockAt(p)?.boundingBox === 'block';
  let best = null;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    for (let up = most; up >= 0; up--) {
      if (best && up <= best.up) break;
      const c = base.offset(dx, up, dz);
      if (open(c) && open(c.offset(0, 1, 0)) && floor(c.offset(0, -1, 0))) { best = { up, at: c }; break; }
    }
  }
  return best;
}
const climbers = danger => { const kinds = [...new Set(danger.map(t => t.entity.name).filter(n => REACH_UP[n]))]; return kinds.length ? ` Two up does not stop ${kinds.map(n => `a ${n.replaceAll('_', ' ')} (${REACH_UP[n]})`).join(' or ')}.` : ''; };
// Two up is out of reach only of mobs on the bot's own level: one standing
// a block or more higher (stairs, a slope, a ledge) is level with the top
// of the pillar or near it. mid-239-b pillared at the foot of its stairs
// with the zombies coming down them (2026-09-27).
const above = (bot, danger) => {
  const y = Math.floor(bot.entity.position.y), up = danger.filter(t => !shooter(t.entity) && t.distance <= 8 && Math.floor(t.entity.position?.y ?? y) >= y + 1);
  return up.length ? ` ${up.length === 1 ? `A ${up[0].entity.name.replaceAll('_', ' ')} stands` : `${up.length} of the mobs stand`} a block or more above the bot's feet (${up.map(t => `${Math.floor(t.entity.position.y) - y} up, ${Math.round(t.distance)} off`).join('; ')}): two up is within reach of ${up.length === 1 ? 'it' : 'them'}.` : '';
};
// Who comes after a run, and how soon it is at the bot again: every mob
// that walks goes after a player it is set on while within its follow
// range, at its own speed (combat-estimate blocksPerSecond, from the jar).
// mid-239-b ran ten blocks from a spider three off at seven health, told
// "a way is found ... 11 blocks further from every mob", as if they stood
// still; a spider goes 3.9 blocks a second to a sprint's 5.6 and climbs,
// and was biting again under three seconds after the run ended (note 532).
// Shooters are said by their shots; a rider and an enderman on their own.
function chaseSays(bot, danger, { apartIds = new Set(), destination = null, runSeconds = null } = {}) {
  const chasers = danger.filter(t => t.entity?.position && !shooter(t.entity) && !t.entity.vehicle && t.entity.name !== 'enderman' && !apartIds.has(t.entity.id) && t.distance <= followRange(t.entity.name))
    .sort((a, b) => a.distance - b.distance).slice(0, 3);
  if (!chasers.length) return '';
  const r1 = x => Math.round(x * 10) / 10;
  const dest = destination ? new Vec3(destination.x + 0.5, destination.y, destination.z + 0.5) : null;
  const each = chasers.map(t => {
    const name = t.entity.name.replaceAll('_', ' '), v = blocksPerSecond(t.entity.name), range = followRange(t.entity.name);
    const climbs = REACH_UP[t.entity.name] === 'climbs' ? ', climbing walls' : '';
    const head = `the ${name} ${Math.round(t.distance)} blocks off at about ${r1(v)} blocks a second${climbs}`;
    if (!dest || !runSeconds) return `${head}${v >= SPRINT ? ', as fast as the run or faster' : `, about ${r1(SPRINT - v)} a second slower than the run`}, and it gives up only more than ${range} blocks behind`;
    const toDest = t.entity.position.distanceTo(dest), arrives = Math.max(0, toDest - 1.5) / v, behind = toDest - v * runSeconds;
    if (behind > range) return `${head}: about ${Math.round(behind)} blocks behind when the run ends, past the ${range} it follows to, and it gives up`;
    if (arrives <= runSeconds) return `${head}: it is at the bot before the run ends`;
    return `${head}: about ${Math.max(1, Math.round(behind))} blocks behind when the run ends, and at the bot about ${r1(arrives - runSeconds)} seconds after`;
  });
  // The wither on the bot ticks on through the run and the wait after it:
  // the one that comes on meets the bot with that much less. mid-242-ac-
  // nether-1-fortress-1 ran three times from a wither skeleton at 6.4
  // health and met it again each time, at 5.4, 3.4 and 2.4 (note 559).
  let witherSays = '';
  if (dest && runSeconds) {
    const { effectLeft, WITHER } = require('./combat-estimate');
    const left = effectLeft(bot, 'wither')?.seconds || 0;
    const first = chasers.map(t => { const v = blocksPerSecond(t.entity.name), toDest = t.entity.position.distanceTo(dest); return toDest - v * runSeconds > followRange(t.entity.name) ? null : Math.max(0, toDest - 1.5) / v; }).filter(x => x != null).sort((a, b) => a - b)[0];
    if (left > 0 && first != null) {
      const then = Math.max(0, (bot.health ?? 20) - Math.min(left, first) * WITHER.perSecond);
      witherSays = ` The wither on the bot runs on meanwhile: about ${r1(then)} health when the first of them is at the bot again${then < 1 ? ', or none' : ''}.`;
    }
  }
  // How a kind gives the bot up where the jar says more than its range: a
  // piglin brute by sight too, and home to its bastion (note 576).
  const { GIVES_UP } = require('./combat-estimate');
  const givesUp = [...new Set(chasers.map(t => t.entity.name))].filter(n => GIVES_UP[n]).map(n => ` By the game's rule, ${GIVES_UP[n]}.`).join('');
  return ` They follow a running player (the bot sprints about ${SPRINT} blocks a second): ${each.join('; ')}.${witherSays}${givesUp}`;
}
// What the biters that follow a run land on the bot in the next fifteen
// seconds, the wither they leave with it: one at its reach now strikes as the
// bot turns to run (a run opens the block and a half of its reach only after
// it has started), one as fast as the run or faster strikes through it at
// its pace, and one that is at the bot again after the run strikes on its
// arrival. mid-242-ah-nether-1 ran from a wither skeleton at arm's length,
// told only that it would be six blocks behind and at the bot 1.2 seconds
// after the run: it struck as the run began, 5.1 to 0.6, and the wither did
// the rest (note 601). -> { damage, says }
const RUN_START = 0.3;
function chaseCost(bot, danger, { apartIds = new Set(), destination = null, runSeconds = null, seconds = 15 } = {}) {
  if (!destination || !runSeconds) return { damage: 0, says: '' };
  const ce = require('./combat-estimate');
  const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const dest = new Vec3(destination.x + 0.5, destination.y, destination.z + 0.5);
  const r1 = x => Math.round(x * 10) / 10;
  const chasers = danger.filter(t => t.entity?.position && !shooter(t.entity) && !t.entity.vehicle && t.entity.name !== 'enderman' && t.entity.name !== 'creeper' && !apartIds.has(t.entity.id) && t.distance <= followRange(t.entity.name) && ce.MOBS[t.entity.name]?.hit > 0);
  let damage = 0, withering = null;
  const parts = [];
  for (const t of chasers) {
    const m = ce.MOBS[t.entity.name], name = t.entity.name.replaceAll('_', ' ');
    const hit = r1(ce.afterArmour(m.hit, worn)), every = m.blowEvery || 1, v = blocksPerSecond(t.entity.name);
    const toDest = t.entity.position.distanceTo(dest), behind = toDest - v * runSeconds;
    const blows = [];
    const atReach = t.distance <= 2.5;
    if (v >= SPRINT && (atReach || Math.max(0, toDest - 1.5) / v <= runSeconds)) for (let s = atReach ? RUN_START : Math.max(0, toDest - 1.5) / v; s < runSeconds; s += every) blows.push(s);
    else if (atReach) blows.push(RUN_START);
    else { const arrives = Math.max(0, toDest - 1.5) / v; if (arrives <= runSeconds) blows.push(arrives); }
    // At the bot again after the run, where it follows that far.
    if (v < SPRINT && behind <= followRange(t.entity.name)) { const again = Math.max(0, toDest - 1.5) / v; if (again > runSeconds && again < seconds) blows.push(again); }
    if (!blows.length) continue;
    damage += blows.length * hit;
    if (m.withers) { const from = Math.min(...blows), to = Math.min(seconds, Math.max(...blows) + ce.WITHER.seconds); withering = [Math.min(withering?.[0] ?? from, from), Math.max(withering?.[1] ?? to, to)]; }
    const when = blows.map(s => s <= RUN_START + 0.01 ? 'as the bot turns to run, being at its reach now' : s <= runSeconds ? `${r1(s)} seconds into the run` : `on reaching the bot again ${r1(s - runSeconds)} seconds after the run`);
    parts.push(`the ${name} ${blows.length} blow${blows.length === 1 ? '' : 's'} (${[...new Set(when)].join(', ')}), about ${hit} each after armour`);
  }
  if (withering) damage += (withering[1] - withering[0]) * ce.WITHER.perSecond;
  damage = r1(damage);
  if (!parts.length) return { damage: 0, says: '' };
  const h = r1(bot.health ?? 20);
  return { damage, says: ` About ${damage} damage from those that follow in the next fifteen seconds this way, from ${h} health${damage >= h ? ' (more than the bot has)' : ''}: ${parts.join('; ')}${withering ? ', and the wither a wither skeleton\'s blow leaves, one health every two seconds for ten seconds after it that armour does not stop' : ''}; the stance is asked again when the run ends.` };
}
// The hardest blow of those that can get to the bot, said first on every
// stance: what one blow takes through the armour worn, how many end the bot
// from the health it has, and how soon the mob can be at arm's length at
// its own speed. mid-242-ae-nether-1 stood at 20 health beside a piglin
// brute; the fight said "9 swings ... 50 health" and 116.5 damage all told,
// the rail said its walling seconds with "anything at reach hitting freely
// meanwhile" and no figure at all, and nothing said that two of the
// brute's blows (12.2 each through an iron helmet and chestplate) were the
// bot's twenty. The rail was chosen at 0.66; the brute came from 6.9 blocks
// to 1.7 in about a second and struck twice (note 576).
// Led by the one that can end the bot soonest at its own pace, a creeper's
// blast among them: 25594 (mid-242-he), asked about a creeper 6 blocks off
// in sight, had every option lead with "The zombie 16 blocks off, out of
// sight, hits for about 2.2", the creeper left out as no biter (note 685).
function blowsSay(mobs, health) {
  const { MOBS, LIGHTS_AT, FUSE } = require('./combat-estimate');
  const h = Math.round((health ?? 20) * 10) / 10;
  // A blanket "in sight or within eight blocks" cutoff (as 1d055eda's
  // per-mob notes use) was tried here and reverted: build-reach.test.js's
  // sword piglin, 16 blocks off and out of sight, is meant to lead exactly
  // because it can be at the bot before a slow pocket seals; the fact this
  // function reports (how soon the hardest biter arrives, at its own blow)
  // is the same fact whether that biter is close, far, seen or not, and the
  // pocket's own price depends on it. 25589's magma cube (note 725, critic
  // 06:04Z), 9 blocks off and out of sight among only magma cubes, was a
  // real case of this lead-in naming a far mob with nothing nearer to say
  // instead; distinguishing it from the piglin's own, correct warning needs
  // more than distance or sight alone (arrival time, on this evidence, does
  // not separate them either: 4.4s against the piglin's 2.7s), so it is
  // left as a known gap rather than guessed at here (see note 725's trial
  // note for what was tried and why it was backed out).
  const biters = (mobs || []).filter(m => !m.apart && !m.shoots && m.name !== 'creeper' && m.hitsBot > 0 && !m.bornOf);
  const creepers = (mobs || []).filter(m => !m.apart && m.name === 'creeper' && m.hitsBot > 0);
  if (!biters.length && !creepers.length) return '';
  const endsIn = m => {
    const v = blocksPerSecond(m.name);
    if (m.name === 'creeper') return m.hitsBot >= h ? Math.max(0, (m.distance || 0) - LIGHTS_AT) / v + FUSE : Infinity;
    const blows = Math.max(1, Math.ceil(h / m.hitsBot));
    return Math.max(0, (m.distance || 0) - (m.reach || 1.5)) / v + (blows - 1) * (MOBS[m.name]?.blowEvery || 1);
  };
  const hardestBiter = biters.slice().sort((a, b) => b.hitsBot - a.hitsBot || a.distance - b.distance)[0];
  const creeper = creepers.slice().sort((a, b) => endsIn(a) - endsIn(b) || a.distance - b.distance)[0];
  // Or, its blast not the bot's end, the harder of the two that comes first.
  const arrives = m => Math.max(0, (m.distance || 0) - (m.name === 'creeper' ? LIGHTS_AT : m.reach || 1.5)) / blocksPerSecond(m.name) + (m.name === 'creeper' ? FUSE : 0);
  if (creeper && (!hardestBiter || endsIn(creeper) < endsIn(hardestBiter) || (arrives(creeper) < arrives(hardestBiter) && creeper.hitsBot > hardestBiter.hitsBot))) {
    const v = blocksPerSecond('creeper'), soon = Math.round(Math.max(0, (creeper.distance || 0) - LIGHTS_AT) / v * 10) / 10;
    const unseen = creeper.visible === false ? ', out of sight,' : '';
    const ends = creeper.hitsBot >= h ? `as much as the ${h} health the bot has` : `not all of the ${h} health the bot has`;
    const when = soon <= 0.1 ? `it is within ${LIGHTS_AT} blocks now` : `at its walk (about ${Math.round(v * 10) / 10} blocks a second) it can be within ${LIGHTS_AT} blocks in about ${soon} second${soon === 1 ? '' : 's'}`;
    return `The creeper ${Math.round((creeper.distance || 0) * 10) / 10} blocks off${unseen} goes off ${FUSE} seconds after it lights, within ${LIGHTS_AT} blocks in sight of the bot: about ${creeper.hitsBot} through the armour worn two blocks off, ${ends}, and ${when}.`;
  }
  const m = hardestBiter;
  const blows = Math.max(1, Math.ceil(h / m.hitsBot));
  const bare = m.bornOf ? null : MOBS[m.name]?.hit;
  const v = blocksPerSecond(m.name), soon = Math.round(Math.max(0, (m.distance || 0) - (m.reach || 1.5)) / v * 10) / 10;
  const name = m.name.replaceAll('_', ' ');
  const hardest = biters.length > 1 ? 'the hardest hitter of the ' + biters.length + ' here that can get to the bot' : '';
  const when = soon <= 0.1 ? 'it is at arm\'s length now' : `at its own speed (about ${Math.round(v * 10) / 10} blocks a second) it can be at arm's length in about ${soon} second${soon === 1 ? '' : 's'}`;
  // One out of sight is said so: its blow is the same round the rock (note
  // 581). Joined with `hardest` by a single comma each, never two in a row
  // (note 725: "out of sight,, the hardest hitter" when both held).
  const unseenWord = m.visible === false ? 'out of sight' : '';
  const clauses = [unseenWord, hardest].filter(Boolean);
  const unseen = clauses.length ? `, ${clauses.join(', ')},` : '';
  // A blow that varies is said from its least to its hardest, and the
  // blows that end the bot at its hardest; its pace as the jar has it (a
  // hoglin's every two seconds). "Hits for about 3.4 ... 5 blows end the
  // bot from 13.9" was said of a hoglin whose hardest is 4.8 through that
  // iron: three did (mid-208-k-nether-4-fortress-1, note 587).
  const most = m.hitsBotMost, fewest = most ? Math.max(1, Math.ceil(h / most)) : blows;
  const every = MOBS[m.name]?.blowEvery || 1;
  const size = most ? `${m.hitsBotLeast} to ${most} a blow through the armour worn, about ${m.hitsBot} on the average (${MOBS[m.name].least} to ${MOBS[m.name].most} before it)` : `about ${m.hitsBot} a blow through the armour worn${bare && bare !== m.hitsBot ? ` (${bare} before it)` : ''}`;
  const pace = every === 1 ? 'a blow a second at arm\'s length' : `a blow every ${every} seconds at arm's length`;
  const ends = most && fewest < blows ? `${fewest === 1 ? 'one blow at its hardest ends' : `${fewest} blows at their hardest end`} the bot from ${h} health (${blows} on the average)` : `${blows === 1 ? 'one blow ends' : `${blows} blows end`} the bot from ${h} health`;
  return `The ${name} ${Math.round(m.distance || 0)} blocks off${unseen} hits for ${size}, ${pace}: ${ends}, and ${when}.`;
}
// A retreat's footing is found when it runs, not before (runAway): said, so
// the run is not read as a known safe place (the decision audit, 2026-09-25).
// Found before the bot moves, not as it runs: up to twenty-four spots, a
// route search of up to 150 ms each, standing still. mid-241-n was told "as
// it runs", stood three seconds searching, and a creeper walked up and went
// off (note 534).
const NO_ROUTE_YET = ' No route is checked yet: it is searched for before the bot moves, up to 24 spots at up to 0.15 seconds each (about 3.6 seconds standing still at most); where it ends, how high and how lit, is found then.';
// The pocket is built the way a player closes one against what comes: the
// cells a walker comes in by or strikes from first (the eight round the bot
// at its feet and at its head, and the one over its head where a walker can
// get up level with it), those toward the biter that can be there soonest
// first; then the floor's and the roof's corners. mid-242-ad-nether-3's was
// built nearest cell first, the whole roof last, with ground two up beside
// its column: the walls went up, a sword piglin walked in along that ground
// and dropped in over the bot's head with the roof not begun (note 581).
// `plan.shutAt`, the seconds until no walker can get in; `plan.seconds`,
// the whole building.
function pocketPlan(bot, feet, biters = []) {
  let missing;
  try { missing = shelter.missingShell(bot, { origin: { x: feet.x, y: feet.y, z: feet.z } }); } catch (_) { return null; }
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); };
  const floor = p => bot.blockAt(p)?.boundingBox === 'block';
  // Over the head is a way in when a walker can stand level with the top
  // of the walls: ground two up beside the column, or a step up just
  // outside them (onto the walls' top once they stand).
  let over = !!columnOpening(bot, feet, 2);
  for (let dx = -2; dx <= 2 && !over; dx++) for (let dz = -2; dz <= 2 && !over; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
    for (const up of [1, 2]) { const c = feet.offset(dx, up, dz); if (open(c) && open(c.offset(0, 1, 0)) && floor(c.offset(0, -1, 0))) { over = true; break; } }
  }
  const way = c => (c.y === feet.y || c.y === feet.y + 1) ? !(c.x === feet.x && c.z === feet.z) : over && c.y === feet.y + 2 && c.x === feet.x && c.z === feet.z;
  // The side over a drop first, lowest first: a hit while the pocket goes
  // up throws the bot a block, and mid-242-e, sealing beside a hole with
  // zombies at arm's length, was knocked twenty-two blocks down before
  // that side was walled (2026-09-27).
  const { dropAt } = require('./terrain');
  const overDrop = c => dropAt(bot, new Vec3(c.x, feet.y, c.z));
  // How soon a biter can be at a cell, at its own speed: the side toward it.
  const soonest = c => biters.length ? Math.round(Math.min(...biters.map(t => t.entity.position.distanceTo(c.offset(0.5, 0.5, 0.5)) / blocksPerSecond(t.entity.name))) * 10) / 10 : 0;
  const here = bot.entity.position;
  const cells = missing.map(c => ({ c, drop: overDrop(c), way: way(c), soon: soonest(c), d: c.distanceTo(here) }))
    .sort((a, b) => (b.drop - a.drop) || (a.drop && a.c.y - b.c.y) || (b.way - a.way) || (a.soon - b.soon) || (a.d - b.d)).map(x => x.c);
  const last = cells.map(way).lastIndexOf(true);
  return { cells, ways: cells.filter(way).length, over, shutAt: Math.round((last + 1) * BLOCK_SECONDS * 10) / 10, seconds: Math.round(cells.length * BLOCK_SECONDS * 10) / 10 };
}
// The biters a pocket is built against: those within the twenty-four a
// stance counts and their own follow range, seen or not.
function pocketBiters(bot) {
  try { return threats(bot, 24).filter(t => !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name) && t.distance <= followRange(t.entity.name)); } catch (_) { return []; }
}
// The race a pocket is: blocks to place against the nearest biter's walk.
// Trial 70 chose to seal with four zombies coming, the nearest six blocks
// off, told nothing of either, and went from twelve to nothing with the
// pocket half built.
// And the order the blocks go down in, and when the ways in are shut
// against when that biter can be there (pocketPlan, note 581).
function pocketRace(bot, danger, plan = null) {
  const biters = danger.filter(t => !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name));
  plan = plan || pocketPlan(bot, feetCell(bot), biters);
  if (!plan) return '';
  const n = plan.cells.length;
  // At its own speed (combat-estimate), as dig_down's race: a spider is at
  // the bot in half a zombie's time (note 544).
  const walkIn = t => Math.max(0, t.distance - 1.5) / blocksPerSecond(t.entity.name);
  const biter = biters.slice().sort((x, y) => walkIn(x) - walkIn(y))[0];
  const at = biter ? Math.round(walkIn(biter) * 10) / 10 : null;
  const race = biter ? `; the nearest ${biter.entity.name.replaceAll('_', ' ')}, ${Math.round(biter.distance)} blocks off${biter.visible === false ? ' and out of sight' : ''}, can be at the bot in about ${at} seconds at its own speed` : '';
  const ways = plan.ways && plan.ways < n ? ` The cells a walker comes in by or strikes from go first${biter ? `, those toward the ${biter.entity.name.replaceAll('_', ' ')} first` : ''} (the walls round the bot at its feet and head${plan.over ? ', and the one over its head: there is ground level with the walls\' top, and a walker there drops in' : ''}): shut to walkers after ${plan.ways} block${plan.ways === 1 ? '' : 's'}, about ${plan.shutAt} seconds; the corners of the floor and roof after.` : '';
  const first = biter && plan.ways ? (at < plan.shutAt ? ` The ${biter.entity.name.replaceAll('_', ' ')} can be there before they are shut: one there first stands in a gap${plan.over ? ' or drops in over the head' : ''}, and the pocket does not close on it.` : ` They are shut before the ${biter.entity.name.replaceAll('_', ' ')} can be there.`) : '';
  return ` About ${n} block${n === 1 ? '' : 's'} to place here, some ${Math.round(plan.seconds)} seconds of building${race}.${ways}${first}`;
}
// A shaft pocket's seconds, from the top of its column to its foot: each
// block's dig with the tool it takes, and a second more a block to turn,
// drop and settle (the night's shaft pockets took three seconds to the
// bottom of two blocks and four of three, the medians of 144 in the flight
// records of 2026-09-23 to 26); then the cap.
function shaftSeconds(bot, column) {
  const { cheapestTool } = require('./skills');
  let digMs = 0, depth = 0;
  for (let y = column.start.y - 1; y >= column.bottom.y; y--) {
    const b = bot.blockAt(new Vec3(column.start.x, y, column.start.z)); depth++;
    if (b?.boundingBox !== 'block') continue;
    if (typeof b.digTime !== 'function') { digMs += 750; continue; }
    const tool = cheapestTool(bot, b);
    digMs += b.digTime(tool ? tool.type : null, false, false, false, [], {});
  }
  return { seconds: Math.round((digMs / 1000 + depth * SHAFT_BLOCK_SECONDS + BLOCK_SECONDS) * 10) / 10, depth };
}
// The walkers coming at the bot now (danger.js coming), said against the
// seconds the way asked about takes: a shaft's dig, a pocket's blocks, the
// walk to a room and its sealing. mid-244-a, ten blocks ahead of four
// zombies after a run, was offered the shaft pocket as "done in seconds";
// it was about four seconds of digging, the zombies were at the shaft in
// about as many, and they bit it from 13.1 to nothing (note 544).
// `at`, where the way is done, for a mob's walk there instead of to the bot.
function comingSays(list, { seconds = null, doing = null, at = null } = {}) {
  if (!list?.length) return '';
  const r1 = x => Math.round(x * 10) / 10;
  const first = at ? [...list].sort((a, b) => a.entity.position.distanceTo(at) - b.entity.position.distanceTo(at))[0] : list[0];
  const arrives = at ? Math.max(0, first.entity.position.distanceTo(at) - 1.5) / first.speed : first.atBotIn;
  const more = list.length - 1;
  const head = ` Coming at the bot now: the ${first.entity.name.replaceAll('_', ' ')} ${Math.round(first.distance)} blocks off at about ${r1(first.speed)} blocks a second${more ? `, ${more} more behind it` : ''}${first.following ? `, after the bot since its ${first.following.replaceAll('_', ' ')}` : ''}; ${at ? 'there' : 'at the bot'} in about ${r1(arrives)} seconds`;
  if (seconds == null || !doing) return `${head}.`;
  return arrives < seconds ? `${head}, before ${doing} is done (about ${r1(seconds)} seconds): it ${at ? 'gets there' : 'reaches the bot'} first.` : `${head}; ${doing} is done first (about ${r1(seconds)} seconds).`;
}
const comingFacts = list => list.slice(0, 4).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, blocksASecond: Math.round(t.speed * 10) / 10, atBotInSeconds: Math.round(t.atBotIn * 10) / 10, ...(t.following ? { followingSince: t.following } : {}) }));
// A creeper close walks up to a pillar or a pocket and goes off, and a
// pocket is not closed before the blast (the live run, 17:16, at three
// health): said, not decided by hiding the options.
function creeperNoteFor(danger) {
  const creeper = danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7).sort((a, b) => a.distance - b.distance)[0];
  return creeper ? ` A creeper is ${Math.round(creeper.distance)} blocks off${creeper.visible === false ? ', out of sight' : ''}: it walks up to whatever is built and goes off, and a pocket is not closed before the blast.` : '';
}
const GROUND_SHOOTERS = new Set(['skeleton', 'stray', 'bogged', 'parched', 'pillager', 'witch']);
// The stances that move the bot or keep its hands busy building, digging or
// eating: a shield raised at each arrow stops them.
// The most a route drops the bot (movement.js).
const ROUTE_DROP = 3;
const MOVING_STANCES = new Set(['retreat', 'leave_reach', 'fight_from_footing', 'out_of_the_push', 'rail_and_fight', 'seal', 'bunker', 'charge_shooter', 'creeper_dance', 'come_down', 'dig_down', 'eat', 'eat_golden_apple', 'drink_fire_resistance']);
// Two blocks up: from the pillar's report to two up took a second and a
// half to two seconds in mid-92-e, mid-92-g and mid-110-k (2026-09-26).
const PILLAR_SECONDS = 1.5;
// A block of a pocket six tenths of a second (the median over 229 pocket
// passes in the flight records of 2026-09-23 to 26); eating a second and six
// tenths; digging down a second a block more than the dig itself (below).
const BLOCK_SECONDS = 0.6, EAT_SECONDS = 1.6, SHAFT_BLOCK_SECONDS = 1;
// How far a creeper behind a block moves before the block is asked about
// again: more than a standing one is nudged (a push, a knockback's slide),
// about a quarter second of its walk.
const CREEPER_WALKS = 0.75;
// How far a creeper's blast reaches (combat-estimate creeperBlast: none at six).
const CREEPER_BLAST_REACH = 6;
// A run: about five and a half blocks a second sprinting. The route searches
// made before the stance is asked, at most (scoutRetreat).
const SPRINT = 5.6, SCOUT_MS = 300;
// A swim at the surface: about two blocks a second. mid-215-j swam 29
// blocks of open sea in 14.3 seconds on its way to a ruined portal (the
// flight frames of 2026-09-27, note 501).
const SWIM = 2;
// Walkers that still get at a player two blocks up. A magma cube and a slime
// are here because they jump: the pillar's text said "two up does not stop a
// magma cube (jumps higher than two blocks, and its hit throws)" (REACH_UP)
// while its price left them out, "about 0 damage from the mobs here", so the
// pillar was the cheapest stance every time cubes came: taken with 13 of
// them 8 blocks off over a drop of 21 into lava (25593 mid-243-eh, 11:06:42Z
// on 2026-09-29, pillar 0.71 with hold_on_span priced 35.6), and in 25581
// mid-243-ff (0.77, y 58), 25583 mid-243-eg and 25598 mid-243-da-nether-1;
// each cube's hit threw the bot off the one-wide top into the lava sea
// (note 662).
const CLIMBERS = new Set(['spider', 'cave_spider', 'enderman', 'wither_skeleton', 'ravager', 'iron_golem', 'warden', 'magma_cube', 'slime']);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// "the spider, the zombie and 3 skeletons": the mobs of these kinds in `mobs`.
function mobList(names, mobs) {
  const parts = names.map(n => { const k = mobs.filter(m => m.name === n).length; return k > 1 ? `${k} ${n.replaceAll('_', ' ')}s` : `the ${n.replaceAll('_', ' ')}`; });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
}
// What a shooter's shot is called: a ghast's and a blaze's are fireballs.
const SHOT_WORDS = { witch: 'potion', ghast: 'fireball', blaze: 'fireball', breeze: 'wind charge', guardian: 'laser', elder_guardian: 'laser' };
const shotWord = name => SHOT_WORDS[name] || 'arrow';
// The stances that hide the bot from shooters rather than meet them.
const HIDING_STANCES = new Set(['out_of_sight', 'nook', 'take_cover']);
// Whether a stance did anything (note 596): a swing, a block placed or dug,
// a step of a block or more, what is carried changed (eaten, placed,
// picked up). A stance whose point is to strike (STRIKING_STANCES) and was
// held to its end with none of these failed; any stance that ended without
// them, with nothing changed about it since, would end the same again.
// Stances that stand behind the raised shield from their first moment.
const SHIELD_STANCES = new Set(['shield_guard', 'shield_the_charge']);
// Hostiles that hop at a player they see rather than walk: slimes and
// magma cubes (26.1.2 Slime's MoveControl, toward the nearest player in
// range).
const HOPPERS = new Set(['slime', 'magma_cube']);
const STRIKING_STANCES = new Set(['fight', 'fight_from_footing', 'rail_and_fight', 'strike_from_above', 'shield_guard', 'low_ceiling', 'close_in', 'charge_nearest']);
// The work's steps that are the blaze hunt going at them: carrying on with
// one of these is not said to gain nothing toward the rods (note 614).
const HUNT_STEPS = new Set(['stalk_mob', 'hunt', 'hunt_mob', 'close_in', 'charge_nearest', 'blaze_sortie', 'break_spawner', 'collect_rods', 'collect_drop', 'down_for_the_drop', 'dig_toward_them', 'dig_down_to_them', 'cross_toward', 'return_to_blazes']);
const STANCE_IDLE_MS = 10 * 60000;
const carriedCount = bot => { try { return bot.inventory?.items?.().reduce((n, i) => n + (i.count || 0), 0) ?? 0; } catch (_) { return 0; } };
function stanceMark(bot) {
  const p = bot.entity?.position;
  return { swingAt: bot._defenseAttackAt || 0, blocks: bot._stalls?.marked || 0, carried: carriedCount(bot), food: bot.food, pos: p ? { x: p.x, y: p.y, z: p.z } : null };
}
function stanceActed(bot, start) {
  if (!start) return true;
  const now = stanceMark(bot);
  if (now.swingAt > start.swingAt || now.blocks !== start.blocks || now.carried !== start.carried || (now.food ?? 0) > (start.food ?? 0)) return true;
  return !!(start.pos && now.pos) && Math.hypot(now.pos.x - start.pos.x, now.pos.y - start.pos.y, now.pos.z - start.pos.z) >= 1;
}
// The scene a stance ended in: the bot's place and health, each mob about.
function stanceScene(bot, danger) {
  const p = bot.entity?.position;
  return { pos: p ? { x: p.x, y: p.y, z: p.z } : null, health: bot.health ?? 20,
    mobs: (danger || []).filter(t => t.entity?.position).map(t => ({ id: t.entity.id, x: t.entity.position.x, y: t.entity.position.y, z: t.entity.position.z })) };
}
// The same scene: the bot within a block of where it was, health within a
// point, the same mobs about, each within a block of where it stood.
function sameScene(a, b) {
  if (!a?.pos || !b?.pos) return false;
  const far = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) >= 1;
  if (far(a.pos, b.pos) || Math.abs(a.health - b.health) >= 1 || a.mobs.length !== b.mobs.length) return false;
  return b.mobs.every(m => { const was = a.mobs.find(x => x.id === m.id); return !!was && !far(was, m); });
}
// A hiding spot whose walk just failed is passed over this long, while the
// bot stands within four blocks of where that walk began (note 570).
const COVER_FAILED_MS = 30000;
function coverFailedSays(list) {
  return `Not the spot${list.length === 1 ? '' : 's'} tried just now: ${list.map(f => `${f.why}, ${Math.max(1, Math.round((Date.now() - f.at) / 1000))} seconds ago`).join('; ')}.`;
}
// What can throw the bot over an edge with a shot: a shooter in sight
// within its reach, and one that flies (a ghast, a blaze) within its reach
// out of sight too: it drifts to a new line at any moment, and fires about
// a second after it has one (note 551). mid-243-ad hid from a ghast behind
// its last three planks on its span over the lava sea; the ghast out of
// sight, the next question priced its fireballs at nothing, the work walked
// the bot out from behind the planks, and a fireball threw it twenty-two
// blocks into the lava (note 563).
const FLYING_SHOOTERS = new Set(['ghast', 'blaze']);
// Lava n blocks down, in words: level with the feet at none.
const lavaDown = n => n ? `${n} block${n === 1 ? '' : 's'} down` : 'level with the feet';
// A run cut short: true where it got a block or more from where it began
// (a partial escape, the mobs looked at again), false with the stance's
// failure said where it did not.
function ranFrom(survival, from, p, err) {
  const moved = Math.round(survival.bot.entity.position.distanceTo(from) * 10) / 10;
  if (moved >= 1) return true;
  const short = Math.round(p.offset(0.5, 0, 0.5).distanceTo(survival.bot.entity.position) * 10) / 10;
  survival.state.failWhy = `the run to the footing at (${p.x}, ${p.y}, ${p.z}) ended ${short} blocks short of it, where it began${err?.message ? `: ${err.message}` : ''}`;
  return false;
}
function shotPushers(bot, range = 64) {
  const { RANGE } = require('./combat-estimate');
  let about = [];
  try { about = threats(bot, range); } catch (_) { return []; }
  // A blaze's fireball pushes nothing with fire resistance on the body
  // (LivingEntity.hurtServer returns before the knockback for fire damage,
  // note 656): not a pusher while the effect outlasts a stance's fifteen
  // seconds. A ghast's blast is not fire, and still pushes.
  const proof = require('./fire-resistance').left(bot) >= HOLD_SECONDS;
  return about.filter(t => shooter(t.entity) && !(proof && require('./combat-estimate').FIRE_SHOTS.has(t.entity.name)) && t.distance <= Math.max(16, RANGE[t.entity.name] || 0) && (t.visible || FLYING_SHOOTERS.has(t.entity.name)))
    .sort((a, b) => b.visible - a.visible || a.distance - b.distance);
}
// Said with every stance that leaves the bot open over the drop beside it
// while such a shooter is about: one shot that lands is the push over it,
// and that fall, not the shot's own damage, is the price of standing open.
// The fall into lava is priced by the lava from where the body comes up
// (terrain.js lavaFate). Null where there is no drop that costs half the
// health or more, or nothing that can shoot the bot over it.
// The floor under the feet where a ghast's fireball can break it: a block
// of blast resistance under about 4 (ghast.js HOLDS_AT), with a fall under
// it into lava or of half the health or more. mid-242-ac-nether-3-fortress-4
// (13:15:44) and mid-242-ba-fortress-4 (14:25:55) each stood on netherrack
// over the lava sea when a fireball landed and broke the block under the
// feet; the second was walled on the side the push went, every stance
// said "a push into the wall, not the fall", and the wall held while the
// body went down through the floor into the lava (note 610). Null with no
// ghast that can push the bot, or a floor that holds.
function blastFloor(bot, feet, pushers, health = bot.health ?? 20) {
  if (!pushers.some(t => t.entity.name === 'ghast')) return null;
  const under = bot.blockAt(feet.offset(0, -1, 0));
  if (!under || under.boundingBox !== 'block') return null;
  const resistance = bot.registry?.blocksByName?.[under.name]?.resistance;
  if (resistance == null || resistance >= require('./ghast').HOLDS_AT) return null;
  let into = 'deep', fall = 48;
  for (let dy = 2; dy <= 49; dy++) {
    const b = bot.blockAt(feet.offset(0, -dy, 0));
    // Not loaded: a fall of at least as far as read.
    if (!b) { fall = dy - 1; break; }
    if (b.name === 'lava') { into = 'lava'; fall = dy - 1; break; }
    if (/water/.test(b.name || '')) return null;
    if (b.boundingBox === 'block') { into = 'ground'; fall = dy - 1; break; }
  }
  const damage = into === 'lava' ? Infinity : Math.max(0, fall - 3);
  if (into !== 'lava' && damage < health / 2) return null;
  return { name: under.name, resistance, into, fall, damage };
}
function shotOverEdge(bot, feet, health = bot.health ?? 20) {
  const pushers = shotPushers(bot);
  if (!pushers.length) return null;
  const terrain = require('./terrain');
  // As far as the throw of the kinds that can push it (knock-record.js).
  const drop = terrain.dropNear(bot, feet, require('./knock-record').reachFor(pushers.map(t => t.entity.name)));
  const floor = blastFloor(bot, feet, pushers, health);
  const dropKills = !!drop && (drop.into === 'lava' || drop.damage >= health / 2);
  if (!dropKills && !floor) return null;
  const { MOBS, afterArmour, armourOf } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
  const p = pushers[0], name = p.entity.name, said = name.replaceAll('_', ' '), word = shotWord(name);
  const m = MOBS[name];
  const hit = m ? Math.round((m.ignoresArmour ? m.hit : afterArmour(m.hit, worn)) * 10) / 10 : null;
  const after = Math.max(0, health - (hit || 0));
  const floorFate = floor?.into === 'lava' ? terrain.lavaFate(bot, { into: 'lava', cell: feet, fallBlocks: floor.fall }, after) : null;
  const floorSays = floor ? ` The floor under the feet is ${floor.name.replaceAll('_', ' ')} (blast resistance ${floor.resistance}), a block a ghast's fireball can break (under about 4): one that lands at the feet can open it, and a wall at the side does not hold the body up: it goes down through it ${floorFate ? terrain.lavaFateSays(floorFate, floor.fall, after) : floor.into === 'lava' ? `into lava ${floor.fall} blocks down` : `a fall of ${floor.into === 'deep' ? 'more than ' : ''}${floor.fall} blocks, about ${floor.into === 'deep' ? 'more than ' : ''}${floor.damage} health${floor.damage >= after ? `, more than the ${Math.round(after * 10) / 10} left after the ${word}` : ''}`}.` : '';
  const floorDeadly = !!floor && (floor.into === 'lava' ? (floorFate ? floorFate.deadly : true) : floor.damage >= after);
  const pusherSaid = { name, distance: Math.round(p.distance * 10) / 10, visible: !!p.visible };
  // Only the floor: no drop beside it a push goes over (walled all round).
  if (!dropKills) return { says: ` Open under the feet to the ${said} ${Math.round(p.distance)} blocks off (${p.visible ? 'in sight' : 'out of sight now; it flies'}).${floorSays}`, walled: floorSays, deadly: floorDeadly, pusher: pusherSaid,
    drop: { blocksAway: 0, fallBlocks: floor.fall, into: floor.into, damage: floor.damage } };
  const fate = drop.into === 'lava' ? terrain.lavaFate(bot, drop, after) : null;
  const deadly = drop.into === 'lava' ? (fate ? fate.deadly : true) : drop.damage >= after;
  const where = drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot';
  // Short: the drop's own sentence (terrain.js dropNote) says the lava's
  // figures.
  const fall = drop.into === 'lava'
    ? `into lava ${lavaDown(drop.fallBlocks)}, ${!fate || fate.shoreBlocks == null ? `no ground to climb out onto within ${terrain.LAVA_SHORE_RADIUS} blocks of where the body comes up` : fate.deadly ? `the nearest ground out ${fate.shoreBlocks} block${fate.shoreBlocks === 1 ? '' : 's'} off, more lava and fire after it than the ${Math.round(after * 10) / 10} health left after the ${word}` : `the nearest ground out ${fate.shoreBlocks} block${fate.shoreBlocks === 1 ? '' : 's'} off, about ${fate.takes} health of lava and the fire after it`}`
    : `a fall of ${drop.fallBlocks} blocks, about ${drop.damage} health${drop.damage >= after ? `, more than the ${Math.round(after * 10) / 10} left after the ${word}` : ''}`;
  const seen = p.visible ? 'in sight' : `out of sight now; it flies, and can have a line again at any moment, its ${word} about a second after`;
  const more = pushers.length > 1 ? ` (and ${pushers.length - 1} more that can shoot it here)` : '';
  // Walled already on the sides a push goes toward, from every shooter that
  // can push it (the rail or the span's walls put up before): a push stops
  // at the wall. mid-243-ad-nether-3 had walled north and west of its cell
  // against a ghast to the south-east; every stance was still said to be
  // the fall into the lava, Jev answered that none was good, and the next
  // fireball pushed the bot a tenth of a block, into its wall (note 582).
  if (!floor && pushers.every(q => walledToward(bot, feet, q.entity.position))) {
    const lee = leeFirst(feet, AROUND_CARDINAL.map(([dx, dz]) => feet.offset(dx, 0, dz)), p.entity.position).lee, where = lee.map(c => compass(c.x - feet.x, c.z - feet.z)).join(' and ');
    return { walledNow: true, pusher: { name, distance: Math.round(p.distance * 10) / 10, visible: !!p.visible }, drop,
      says: ` Walled here toward the push: a ${word} from the ${said} ${Math.round(p.distance)} blocks off (${p.visible ? 'in sight' : 'out of sight now; it flies'}) pushes the bot away from it, ${where}, and on ${lee.length === 1 ? 'that side' : 'those sides'} a block stands at the feet or ground with no drop beside it, so one that lands costs its ${hit ?? 'own'} damage and a push into the wall, not the fall. The drop ${drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot'} lies on the other sides.`,
      leaving: ` Off this cell the walls are behind it: walked out from here, a ${word} that lands is the push over the drop ${where} of it again.` };
  }
  // Walled toward the push, but on a floor the blast breaks: the wall
  // holds and the floor goes (note 610).
  if (floor && pushers.every(q => walledToward(bot, feet, q.entity.position))) {
    const lee = leeFirst(feet, AROUND_CARDINAL.map(([dx, dz]) => feet.offset(dx, 0, dz)), p.entity.position).lee, toward = lee.map(c => compass(c.x - feet.x, c.z - feet.z)).join(' and ');
    return { says: ` Walled here toward the push: a ${word} from the ${said} ${Math.round(p.distance)} blocks off (${p.visible ? 'in sight' : 'out of sight now; it flies'}) pushes the bot away from it, ${toward}, into a block or onto ground with no drop beside it.${floorSays}`,
      walled: floorSays, deadly: floorDeadly, pusher: pusherSaid, drop };
  }
  // The shots already due, said on every stance that stays open: the
  // volley on its way is not the average rate (note 617).
  let dueNow = '';
  try {
    const due = pushers.map(t => shotsDue(bot, t)).filter(k => k?.shots.length);
    if (due.length) {
      const lands = Math.round((1 - due.reduce((m, k) => m * (1 - k.each) ** k.shots.length, 1)) * 100);
      const by = Math.max(...due.map(k => k.shots.at(-1).in));
      dueNow = ` Due now: ${dueSays(due)}; at least one lands about ${lands} in 100 within ${by} seconds, and one that lands while the bot is still open here is that push.`;
    }
  } catch (_) { dueNow = ''; }
  const says = ` Open here to the ${said} ${Math.round(p.distance)} blocks off (${seen})${more}: one ${word} that lands pushes the bot off its feet, and the drop ${where} is ${fall}. So a ${word} that lands here is priced by that fall, not by its ${hit ?? 'own'} damage: ${deadly ? 'the bot\'s death, and everything carried lost with it' : 'the fall and what it costs'}. A wall at the open sides stops the push; a block in the line stops the ${word} only while the line stays there.${dueNow}${floorSays}`;
  // The walled stances, priced the same way: with the wall up, the shot
  // costs what it costs.
  const walled = floor ? ` Walled, a ${word} that lands here pushes the bot into the wall, not over the drop beside it.${floorSays}` : ` Walled, a ${word} that lands here costs its ${hit ?? 'own'} damage and a push into the wall, not the fall${drop.into === 'lava' ? ' into the lava' : ''}.`;
  return { says, walled, deadly, pusher: { name, distance: Math.round(p.distance * 10) / 10, visible: !!p.visible }, drop };
}
// A spear holder's knock over the drop beside the bot, said on every stance
// that leaves it open, as a shooter's push is (shotOverEdge): it runs in
// from up to ten blocks and strikes on the way in, and a hit that lands
// knocks the bot back. mid-242-af-nether-1 was told the drop on the fight
// alone; Jev answered none of these twice at a spear piglin by a
// three-block edge into lava, the fight was taken, and the piglin's one hit
// that landed (15.2 to 9.5) put the bot in the lava (note 586). Null where
// no spear holder that can get to the bot is within its ten, or no drop
// beside costs half the health or more.
function spearOverEdge(bot, feet, coming, mobs = [], health = bot.health ?? 20) {
  const { holdsSpear } = require('./danger');
  const holders = coming.filter(t => holdsSpear(t.entity) && t.distance <= 10 && (t.visible || t.distance <= 5)).sort((a, b) => a.distance - b.distance);
  if (!holders.length) return null;
  const terrain = require('./terrain');
  const drop = terrain.dropNear(bot, feet, 3);
  if (!drop || (drop.into !== 'lava' && drop.damage < health / 2)) return null;
  const p = holders[0], said = p.entity.name.replaceAll('_', ' ');
  const hit = mobs.find(m => m.spear && m.name === p.entity.name)?.hitsBot;
  const where = drop.blocksAway ? `${drop.blocksAway} block${drop.blocksAway === 1 ? '' : 's'} off` : 'under the bot';
  const fall = drop.into === 'lava' ? `into lava ${drop.fallBlocks} blocks down` : `a fall of ${drop.fallBlocks} blocks, about ${drop.damage} health${drop.damage >= health ? `, more than the ${Math.round(health * 10) / 10} the bot has` : ''}`;
  const more = holders.length > 1 ? ` (and ${holders.length - 1} more with spears)` : '';
  return { drop, holder: { name: p.entity.name, distance: Math.round(p.distance * 10) / 10 },
    says: ` Open here to the ${said} with a spear ${Math.round(p.distance)} blocks off${more}: it runs in from up to ten blocks and strikes on the way in, and a hit that lands knocks the bot back (seen: 0.7 of a block, and one hit over a three-block edge into lava), and the drop ${where} is ${fall}. So each of its hits that lands here is priced by that fall, not by its ${hit ?? 'own'} damage.`,
    walled: ' Walled on the drop side, a spear\'s knock stops at the wall.',
    shielded: ' A spear hit the shield takes knocks the bot nowhere; one landing while the shield is down for a swing knocks it back as ever, toward the drop if it comes from the other side.' };
}
// Whether a push away from `from` stops: each side a push goes toward
// (leeFirst) holds a block at the feet, or is ground with no drop beside it.
// Along a one-wide span the next cell is still beside the drop: open.
const AROUND_CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const compass = (dx, dz) => dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north';
function walledToward(bot, feet, from) {
  const { dropAt, besideDrop } = require('./terrain');
  const { lee } = leeFirst(feet, AROUND_CARDINAL.map(([dx, dz]) => feet.offset(dx, 0, dz)), from);
  if (!lee.length) return false;
  return lee.every(c => bot.blockAt(c)?.boundingBox === 'block' || (!dropAt(bot, c) && !besideDrop(bot, c)));
}
// The cells a wall at the feet goes in: each side open over the drop, and,
// against a blast's push, each side it goes toward that is floored but has
// the drop within a throw beyond it. A fireball's push carries the body past
// the cell beside it: mid-243-ah-fortress-5, on a one-wide diagonal ridge
// of basalt at y 52 over the lava sea, every side at its feet floored
// (basalt west and north, its own planks east and south), was thrown 2.9
// blocks west and 1.9 north, over the basalt west of it and off the
// ridge, twenty blocks into the lava; the rail was not offered, no side
// being open over the drop, and every stance said the push was its death
// (note 610). The sides a push goes toward first (leeFirst); `onward` is the
// side a span being laid goes on, left open for it.
//
// A blast's push (a ghast's fireball, a breeze's wind charge) throws the
// body two to four blocks, seen: 2.9 and 1.9 (mid-243-ah-fortress-5), 4.2
// along a span (mid-243-ag-nether-2); a blow's or an arrow's knock, about
// a block, stops on a floored cell beside the feet.
const FAR_PUSHERS = new Set(['ghast', 'breeze']);
function wallCells(bot, feet, { pusher = null, onward = null } = {}) {
  const { dropAt } = require('./terrain');
  const sides = AROUND_CARDINAL.filter(([dx, dz]) => !(onward && onward.x === dx && onward.z === dz)).map(([dx, dz]) => feet.offset(dx, 0, dz));
  const open = sides.filter(c => dropAt(bot, c));
  const blast = shotPushers(bot).find(t => FAR_PUSHERS.has(t.entity.name))?.entity?.position;
  // Floored, but with the drop within the throw beyond it on that side:
  // along a span that goes on the body lands on the span.
  const carriesOff = c => { const d = c.minus(feet); for (let k = 1; k <= 3; k++) { const at = c.plus(d.scaled(k)); if (bot.blockAt(at)?.boundingBox === 'block') return false; if (dropAt(bot, at)) return true; } return false; };
  const lee = blast ? leeFirst(feet, sides, blast).lee.filter(c => !open.some(o => o.equals(c)) && bot.blockAt(c)?.boundingBox !== 'block' && carriesOff(c)) : [];
  return leeFirst(feet, [...open, ...lee], pusher || blast).sides;
}
// Gravel and sand hold where a floor is under them, and fall where none is:
// a wall of them goes on a floor, one already there or laid first of a
// block that holds over air. mid-243-ah-fortress-5 and mid-243-ag-nether-2
// carried fourteen and sixteen gravel, told "too few blocks carried" or
// offered no wall, and a fireball threw each into the lava (note 610).
const WALL_FALLING = new Set(['gravel', 'sand', 'red_sand']);
// What a wall at `cells` takes and what is carried for it: `floors` the
// cells with nothing under them, laid first of a block that holds (a
// building material); the walls on them of either. `enough` when both are
// carried; `falling` the gravel or sand the walls take, the holding blocks
// kept for the floors and used first for walls past them.
function wallStock(bot, cells, { extra = 0 } = {}) {
  const floors = cells.filter(c => bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block').length;
  const items = bot.inventory.items();
  const holding = items.filter(i => shelter.buildingMaterials.has(i.name)).reduce((n, i) => n + i.count, 0) + extra;
  const loose = items.filter(i => WALL_FALLING.has(i.name)).reduce((n, i) => n + i.count, 0);
  const need = floors + cells.length;
  const falling = Math.max(0, need - holding);
  return { need, floors, holding, loose, falling, enough: holding >= floors && holding + loose >= need, looseName: items.find(i => WALL_FALLING.has(i.name))?.name || null };
}
// The cells the rail walls with what is carried (the planks the logs make
// counted): every side wallCells gives, or, short of blocks for all of
// them, the sides a push from a shooter goes toward alone. mid-243-ag-
// nether-2 stood on its one-wide span over the lava sea with one plank and
// sixteen gravel, told "too few blocks carried (1) to wall the 2 open
// sides (4)"; the plank under a wall of gravel on the south side, where
// the ghast's push went, was the wall it needed, and a fireball threw it
// off that side into the lava (note 610). { cells, all, leeOnly }.
function wallPlan(bot, feet, { onward = null } = {}) {
  const all = wallCells(bot, feet, { pusher: pusherAt(bot), onward });
  const planks = shelter.plankCraft?.(bot) || null;
  const fits = cells => wallStock(bot, cells, { extra: planks?.available || 0 }).enough;
  if (!all.length || fits(all)) return { cells: all, all, leeOnly: false };
  const shot = shotPushers(bot)[0]?.entity?.position;
  const lee = shot ? leeFirst(feet, all, shot).lee : [];
  if (lee.length && lee.length < all.length && fits(lee)) return { cells: lee, all, leeOnly: true };
  return { cells: all, all, leeOnly: false };
}
// How far a blast's push carries the body, and which way (note 612). The
// 26.1.2 jar (ServerExplosion.hurtEntities): the push is along the line
// from where the blast is to the eyes, times (1 - distance / (2 x power)),
// the share of the body the blast sees and (1 - explosion knockback
// resistance); a ghast's power of 1 pushes only a body within two blocks
// of where its fireball bursts, at most a block a tick, and the fireball's
// own hit knocks it as well (away from the fireball, and up). The fireball
// bursts on the bot's side toward the ghast, so the push goes away from
// the ghast and up. Seen in the day's seven pushes (2026-09-28, the flight
// frames' first ticks after each hit): 0.27 to 0.42 a tick across and up
// to 0.45 up, within 12 degrees of the line from the ghast (away from it,
// all seven); the body rose one to three blocks and came back down to its
// own level 2.1 (into the lava beside its span, mid-242-bb-fortress-4),
// 2.2 (onto its span, mid-242-ac-nether-3-fortress-4), 3.3 (mid-242-ac-
// nether-3-fortress-5, off the same span), 3.5, 3.5 and 4.0 blocks away
// (mid-243-ah-fortress-5, mid-243-ag-nether-2, mid-242-bb-fortress-2);
// one broke the netherrack under the feet and went down through it
// (mid-242-ba-fortress-4, blastFloor), and in four more the save has the
// netherrack under the feet gone (lava in its cell by the lava sea). Past
// the cell beside the feet the body is a block up or more, so a block at
// the feet' level there does not stop it, and one at the head's level
// does. mid-242-bb-fortress-2 stood on
// a one-wide netherrack path at y 46 over the lava sea with a ghast 55
// blocks off in sight; its fireball threw the bot 4 blocks west and 1.2
// north, over the path's edge, 18 blocks into the lava.
// Five: nine in ten of 33 landed fireballs threw the body within 4.3 blocks
// and one 6.1 (knock-record.js, note 662); the four here was under the four
// throws of 4.1 to 4.5 that ended in the lava overnight.
const BLAST_THROW = require('./knock-record').BLAST_THROW, BLAST_SPREAD = 15;
const COMPASS8 = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const bearing = (dx, dz) => COMPASS8[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];
// Where a push from `from` (a position) carries a body standing in `cell`
// over a drop that kills: { blocksAway, fallBlocks, into, damage, toward,
// cell }, or null where it stops at a block or on ground. Along the line
// away from `from` and 15 degrees either side of it, as far as the throw.
// The body is moved along x and along z apart, as the game moves it: a
// block met on one stops that one, and the push goes on along the other,
// sliding along the wall (a push north into a wall with a little west in
// it goes on west). `at` is where in the cell the body stands (its middle
// where not given).
const BODY_HALF = 0.3;
function pushCarries(bot, cell, from, { health = bot.health ?? 20, reach = BLAST_THROW, at = null } = {}) {
  if (!from || typeof bot?.blockAt !== 'function') return null;
  const terrain = require('./terrain');
  const x0 = at ? at.x : cell.x + 0.5, z0 = at ? at.z : cell.z + 0.5;
  const ax = x0 - from.x, az = z0 - from.z, n = Math.hypot(ax, az);
  if (n < 1e-6) return null;
  const solid = p => bot.blockAt(p)?.boundingBox === 'block';
  // A block the body meets: at the feet' level only in the first block of
  // the throw (after it the body is a block up), at the head's level all
  // the way.
  const stops = (x, z, s) => { const q = new Vec3(Math.floor(x), cell.y, Math.floor(z)); return solid(q.offset(0, 1, 0)) || (s <= 1 && solid(q)); };
  const deadly = new Map();
  const overDrop = q => {
    const k = `${q}`;
    if (!deadly.has(k)) {
      let d = null;
      if (!solid(q) && terrain.dropAt(bot, q)) { const drop = terrain.dropNear(bot, q, 0); if (drop && (drop.into === 'lava' || drop.into === 'unknown' || drop.damage >= health / 2)) d = drop; }
      deadly.set(k, d);
    }
    return deadly.get(k);
  };
  for (const deg of [0, -BLAST_SPREAD, BLAST_SPREAD]) {
    const r = deg * Math.PI / 180, ux = (ax * Math.cos(r) - az * Math.sin(r)) / n, uz = (ax * Math.sin(r) + az * Math.cos(r)) / n;
    let x = x0, z = z0, xOn = Math.abs(ux) > 1e-6, zOn = Math.abs(uz) > 1e-6;
    for (let s = 0.1; s <= reach + 1e-6 && (xOn || zOn); s += 0.1) {
      if (xOn) { const nx = x + ux * 0.1; if (stops(nx + Math.sign(ux) * BODY_HALF, z, s)) xOn = false; else x = nx; }
      if (zOn) { const nz = z + uz * 0.1; if (stops(x, nz + Math.sign(uz) * BODY_HALF, s)) zOn = false; else z = nz; }
      const q = new Vec3(Math.floor(x), cell.y, Math.floor(z));
      if (q.x === cell.x && q.z === cell.z) continue;
      const drop = overDrop(q);
      if (drop) return { ...drop, blocksAway: Math.max(1, Math.round(Math.hypot(q.x + 0.5 - x0, q.z + 0.5 - z0))), toward: bearing(ax, az), cell: { x: q.x, y: q.y, z: q.z } };
    }
  }
  return null;
}
// The blast pushers that can put the bot over a drop from where it stands:
// a ghast (or a breeze) in sight within its reach whose push carries the
// body over a drop that kills, or the floor under the feet its blast can
// break over such a fall. [{ t, over, floor }].
function blastPushesOver(bot, cell = feetCell(bot), { health = bot.health ?? 20, pushers = shotPushers(bot) } = {}) {
  return pushers.filter(t => t.visible && FAR_PUSHERS.has(t.entity?.name) && t.entity.position)
    .map(t => ({ t, over: walledToward(bot, cell, t.entity.position) ? null : pushCarries(bot, cell, t.entity.position, { health, at: cell.equals(feetCell(bot)) ? bot.entity.position : null }), floor: blastFloor(bot, cell, [t], health) }))
    .filter(x => x.over || x.floor);
}
// Whether a blast's push carries the body over a drop that kills from
// `cell` (a move's end), in words for the move: "a fireball from the ghast
// 49 blocks off that lands there pushes the body over the drop 3 blocks
// south, a fall of 32 blocks", or null where none does. For a question that
// moves the bot a cell at a time (unstuck_move): mid-243-af-fortress-5
// stepped from the one cell of its fortress ledge a push could not carry
// over the edge into the next, told nothing of the ghast 47 blocks off in
// sight, and its fireball threw the body 3.8 blocks south, 32 down (note
// 621).
function pushAtSays(bot, cell, { health = bot.health ?? 20, pushers = shotPushers(bot) } = {}) {
  let at = [];
  try { at = blastPushesOver(bot, cell, { health, pushers }); } catch (_) { at = []; }
  if (!at.length) return null;
  const { t, over, floor } = at[0], said = t.entity.name.replaceAll('_', ' ');
  const fall = over ? `pushes the body over the drop ${over.blocksAway} block${over.blocksAway === 1 ? '' : 's'} ${over.toward}, ${over.into === 'lava' ? `into lava ${lavaDown(over.fallBlocks)}` : over.into === 'unknown' ? `a fall of at least ${over.fallBlocks} blocks` : `a fall of ${over.fallBlocks} blocks, about ${over.damage} health`}`
    : `can break the ${floor.name.replaceAll('_', ' ')} under the feet, over ${floor.into === 'lava' ? `lava ${lavaDown(floor.fall)}` : `a fall of ${floor.fall} blocks`}`;
  return `a ${shotWord(t.entity.name)} from the ${said} ${Math.round(t.distance)} blocks off that lands there ${fall}`;
}
// The nearest footing, by the walk (a level step, one up with head room,
// one down, as bunker.js wayTo), where no blast pusher's push carries the
// body over a drop that kills, the floor holds against its blast, and no
// lava is beside it: { cell, way, steps }, or null within `steps`.
// Kept a moment, for the claim that asks it often.
const FOOTING_STEPS = 16;
function pushFooting(bot, blasts, { steps = FOOTING_STEPS, health = bot.health ?? 20 } = {}) {
  const list = (blasts || []).filter(t => t.entity?.position);
  if (!list.length || typeof bot?.blockAt !== 'function') return null;
  const feet = feetCell(bot);
  const key = `${feet}|${list.map(t => `${t.entity.id}@${t.entity.position.floored()}`).join(',')}|${Math.round(health)}`;
  const kept = bot._pushFooting;
  if (kept && kept.key === key && Date.now() - kept.at < 1000) return kept.found;
  const { standable } = require('./bunker');
  const clear = p => bot.blockAt(p)?.boundingBox === 'empty';
  // No cell the walk's own pathfinder refuses for a mob (danger.js
  // safeFromHostiles: nearer a mob in sight than it is now, within its
  // twelve, or a shooter's twenty): a footing toward the piglins was one
  // the walk could not reach.
  const { safeFromHostiles, hostileEntities } = require('./danger');
  let hostiles = [];
  try { hostiles = hostileEntities(bot, 64); } catch (_) { hostiles = []; }
  const apart = c => { try { return safeFromHostiles(bot, c.offset(0.5, 0, 0.5), hostiles); } catch (_) { return true; } };
  const safe = c => !lavaBeside(bot, c) && list.every(t => (walledToward(bot, c, t.entity.position) || !pushCarries(bot, c, t.entity.position, { health })) && !blastFloor(bot, c, [t], health));
  const from = new Map([[`${feet}`, null]]);
  let ring = [feet], found = null;
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  for (let n = 0; n < steps && ring.length && !found; n++) {
    const next = [];
    for (const c of ring) for (const [dx, dz] of AROUND_CARDINAL) for (const dy of [0, 1, -1]) {
      const to = c.offset(dx, dy, dz), k = `${to}`;
      if (from.has(k)) continue;
      if (dy === 1 && !clear(c.offset(0, 2, 0))) continue;
      if (dy === -1 && !clear(c.offset(dx, 1, dz))) continue;
      if (!standable(bot, to) || lavaBeside(bot, to) || !apart(to)) continue;
      from.set(k, c); next.push(to);
    }
    const cell = next.filter(safe).sort((a, b) => far(a) - far(b))[0];
    if (cell) {
      const way = [cell];
      for (let p = from.get(`${cell}`); p && `${p}` !== `${feet}`; p = from.get(`${p}`)) way.unshift(p);
      found = { cell, way, steps: way.length };
    }
    ring = next;
  }
  bot._pushFooting = { key, at: Date.now(), found };
  return found;
}
// The step to that footing, in words and seconds: the walk's cells (those
// beside a drop that kills walked crouched in the Nether, as routeEdge
// counts them), the seconds within a push of the drop until it stands
// there, and the chance a shot lands meanwhile by the shooter's own rate.
// A ghast aims each fireball at where the bot is when it fires and leads
// no target (Ghast$GhastShootFireballGoal: the line from 4 blocks in front
// of it to the target's middle, nothing added for its motion); a large
// fireball's box is a block wide, the body's 0.6, so a fireball meets the
// body only where the body is within about 0.8 of the line across it when
// it comes. Walking, the body moves across the line by its speed times the
// fireball's flight times the sine of the angle between the walk and the
// line: past 0.8, a fireball fired while it walks passes to the side.
const FIREBALL_MEETS = 0.8;
function footingStep(bot, footing, pusher, { health = bot.health ?? 20 } = {}) {
  const { fallBeside } = require('./movement');
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const beside = footing.way.filter(c => fallBeside(bot, c, health)).length;
  const seconds = Math.max(0.3, Math.round(((footing.way.length - (nether ? beside : 0)) / 4.3 + (nether ? beside / CROUCH_SPEED : 0) + 0.2) * 10) / 10);
  const p = { name: pusher.entity.name, distance: pusher.distance, visible: !!pusher.visible };
  // How far across the ghast's line the walk carries the body in one
  // fireball's flight.
  let across = null, flight = null;
  if (p.name === 'ghast' && footing.way.length) {
    const here = bot.entity.position, end = footing.cell.offset(0.5, 0, 0.5), g = pusher.entity.position;
    const wx = end.x - here.x, wz = end.z - here.z, w = Math.hypot(wx, wz), lx = here.x - g.x, lz = here.z - g.z, l = Math.hypot(lx, lz);
    if (w > 1e-6 && l > 1e-6) {
      flight = require('./ghast').outSeconds(pusher.distance);
      const sine = Math.abs(wx * lz - wz * lx) / (w * l);
      across = Math.round(footing.way.length / seconds * flight * sine * 10) / 10;
    }
  }
  const passes = across != null && across >= FIREBALL_MEETS;
  // Walking across its line, what can still land is a fireball already on
  // its way at the start that comes before the body is 0.8 across: while
  // the ghast keeps its line one is fired each three seconds, so about the
  // seconds that takes in three.
  const early = passes ? Math.min(seconds, FIREBALL_MEETS / (across / flight)) : null;
  const chance = passes ? Math.round(Math.min(1, early / require('./ghast').GHAST.every) * 100) : Math.round(shotChanceNow(bot, seconds, [pusher]).chance * 100);
  return { seconds, beside, crouched: nether && beside > 0, chance, early: early == null ? null : Math.round(early * 10) / 10, pusher: p, across, flight, passes };
}
// Said on turn_priority, on the survival claim and the work's option, and
// on every stance that stays: a blast pusher in sight that can put the bot
// over a drop that kills, what one shot that lands is, its rate of fire,
// and the footing a push cannot carry it over from (note 612). mid-242-bb-
// fortress-2's turn_priority said the drop beside the bot and the piglin
// it answered; the ghast 55 blocks off in sight was said nowhere, and the
// work and the fight stood the bot where its fireball was the fall.
function blastOverSays(bot, { health = bot.health ?? 20 } = {}) {
  let at = [];
  try { at = blastPushesOver(bot, feetCell(bot), { health }); } catch (_) { at = []; }
  if (!at.length) return null;
  const { t, over, floor } = at[0], name = t.entity.name, said = name.replaceAll('_', ' '), word = shotWord(name);
  const rate = name === 'ghast' ? `one ${word} every ${require('./ghast').GHAST.every} seconds while it has a line, the first about a second after it has one` : `a ${word} about every ${require('./combat-estimate').MOBS[name]?.every || 2} seconds`;
  const fall = over ? `the drop ${over.blocksAway} block${over.blocksAway === 1 ? '' : 's'} ${over.toward}, ${over.into === 'lava' ? `into lava ${lavaDown(over.fallBlocks)}` : over.into === 'unknown' ? `a fall of at least ${over.fallBlocks} blocks, the ground under it not loaded` : `a fall of ${over.fallBlocks} blocks, about ${over.damage} health`}`
    : `the ${floor.name.replaceAll('_', ' ')} under the feet, which its blast can break, over ${floor.into === 'lava' ? `lava ${lavaDown(floor.fall)}` : `a fall of ${floor.fall} blocks`}`;
  // Priced by the fall, the lava by where the body comes up (terrain.js
  // lavaFate), after the shot's own damage.
  const { MOBS, afterArmour, armourOf } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const hit = MOBS[name] ? Math.round((MOBS[name].ignoresArmour ? MOBS[name].hit : afterArmour(MOBS[name].hit, worn)) * 10) / 10 : 0;
  const after = Math.max(0, health - hit);
  const terrain = require('./terrain');
  const fate = over?.into === 'lava' ? terrain.lavaFate(bot, over, after) : null;
  const deadly = over ? (over.into === 'lava' ? (fate ? fate.deadly : true) : over.into === 'unknown' || over.damage >= after) : floor.into === 'lava' || floor.damage >= after;
  const footing = pushFooting(bot, at.map(x => x.t), { health });
  const step = footing ? footingStep(bot, footing, t, { health }) : null;
  const there = footing ? ` Footing a push from it cannot carry the bot over stands ${footing.steps} step${footing.steps === 1 ? '' : 's'} off at (${footing.cell.x}, ${footing.cell.y}, ${footing.cell.z}), about ${step.seconds} seconds of walking${step.crouched ? `, ${step.beside} of its cells beside the drop walked crouched` : ''}.` : ` No footing a push from it cannot carry the bot over is within ${FOOTING_STEPS} steps of walking.`;
  const lands = over ? `one that lands pushes the body about 2 to 4 blocks away from it, ${over.toward}, and a block up or more, and here that carries it over ${fall}` : `one that lands at the feet can break ${fall}, and the body goes down through it`;
  const says = ` The ${said} ${Math.round(t.distance)} blocks off has the bot in sight and fires ${rate}; ${lands}: ${deadly ? 'the bot\'s death, and everything carried lost with it' : 'the fall and what it costs'}.${there}`;
  return { says, pusher: { name, distance: Math.round(t.distance * 10) / 10 }, over, floor, deadly, hit, footing, step };
}

// A stance that builds its wall or its cover stands open while it builds:
// the walls stop the push only once they stand, and a shot that lands
// before then is the fall. mid-243-ad-nether-3 chose rail_and_fight on its
// span over the lava sea, told "Walled, a fireball that lands here costs its
// 3.4 damage and a push into the wall" beside six blocks and 4.6 seconds of
// walling, the planks made first; the ghast sixty blocks off fired every
// three seconds, and its fireball landed 1.3 seconds in, before any block
// was down, and threw the bot twenty-three blocks into the lava (note 582).
// The chance that a shot lands within `seconds`, by the shooter's own rate
// of fire: a ghast one fireball every three seconds while it has a line
// (ghast.js GHAST, from the jar), a blaze a volley of three about every
// nine seconds landing by its distance (combat-estimate volleyHit), the
// rest a shot about every two seconds (their `every`).
function shotChanceIn(pusher, seconds) {
  if (!(seconds > 0)) return 0;
  const ce = require('./combat-estimate');
  if (pusher.name === 'ghast') return Math.min(1, seconds / require('./ghast').GHAST.every);
  if (pusher.name === 'blaze') return Math.min(1, seconds / ce.FIREBALL.volleySeconds) * ce.volleyHit(pusher.distance);
  return Math.min(1, seconds / (ce.MOBS[pusher.name]?.every || 2));
}
// What is known now of a shooter's next shots, beyond its average rate
// (note 617): the fireballs already in the air at the bot, and a blaze's
// volley once it glows. A blaze glows (its flags' bit 1, sent to the
// client) for three seconds, fires three 0.3 seconds apart and rests five
// (Blaze$BlazeAttackGoal: 60 ticks charging, 6 between shots, 100
// resting): glowing, its three are on their way within 3.6 seconds; not
// glowing, none of its comes sooner than the glow and the flight. mid-242-
// ah-fortress-5 stood a block from an edge over the lava sea with two
// blazes 14 and 15 off, the farther glowing: shield_policy was asked for a
// shot on its way, and the stance a moment later priced the rail at "about
// 8 in 100 that a fireball lands first" and the cover at 12, by the
// average of a volley every nine seconds. Its volley was in the air as it
// answered; the first fireball landed 0.9 seconds later, before a block
// was down, and pushed the bot a block west, off the edge, 23 into the
// lava. null for a shooter nothing more is known of (the rate stands).
// { shots: [{ in, air }], each, after, glowing, glowKnown, flight }: each
// shot's seconds until it reaches the bot, the chance each lands, and the
// seconds after which shots not yet scheduled can come.
function shotsDue(bot, t, now = Date.now()) {
  const e = t?.entity, name = e?.name;
  if (!e?.position || (name !== 'blaze' && name !== 'ghast')) return null;
  const ghast = require('./ghast'), ce = require('./combat-estimate');
  const distance = t.distance ?? e.position.distanceTo(bot.entity.position);
  const flight = name === 'ghast' ? ghast.outSeconds(distance) : ghast.flightSeconds(distance);
  const kind = name === 'blaze' ? 'small_fireball' : 'fireball';
  // A shot in the air at the bot: between this shooter and the bot, within
  // three blocks of the line from one to the other, and nearer that line
  // than to any other shooter of its kind's. Read by where it is, not its
  // velocity, which a fireball's often lacks (note 382).
  const eye = bot.entity.position.offset(0, 1.5, 0);
  const lineOff = (s, from) => {
    const to = eye.minus(from), n = to.norm();
    if (n < 1e-6) return null;
    const off = s.position.minus(from), along = off.dot(to) / n;
    if (along < -1 || along > n) return null;
    return { along, perp: Math.sqrt(Math.max(0, off.dot(off) - along * along)), total: n };
  };
  const shooters = Object.values(bot.entities || {}).filter(o => o?.name === name && o.position && o.isValid !== false);
  const shots = [];
  for (const s of Object.values(bot.entities || {})) {
    if (s?.name !== kind || !s.position || s.isValid === false) continue;
    const mine = lineOff(s, e.position);
    if (!mine || mine.perp > 3) continue;
    // One going away from the bot (struck back at a ghast) is not coming.
    const v = s.velocity;
    if (v && Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) >= 0.05 && eye.minus(s.position).dot(v) < 0) continue;
    if (shooters.some(o => o !== e && (lineOff(s, o.position)?.perp ?? Infinity) < mine.perp)) continue;
    const flown = ghast.flightSeconds(Math.max(0, mine.along));
    shots.push({ in: Math.max(0.05, Math.round((flight - flown) * 10) / 10), air: true, flown });
  }
  // The next shot not scheduled here: for a ghast, three seconds after the
  // last one fired; for a blaze, after this volley's rest and the next
  // glow, or after the glow a blaze not glowing has still to begin.
  let after = 0, glowing = false, glowKnown = false;
  if (name === 'ghast' && shots.length) after = Math.max(0, ghast.GHAST.every - Math.min(...shots.map(s => s.flown)));
  if (name === 'blaze' && e.metadata) {
    const stand = require('./blaze-stand');
    stand.volleyWatch(bot);
    const { glow, shots: at, rest } = stand.VOLLEY;
    if (stand.charged(e)) {
      glowing = true;
      const lit = e._glowAt ? (now - e._glowAt) / 1000 : null;
      glowKnown = lit != null;
      // Not yet fired: those of the three still ahead of the glow's clock,
      // or, not seen since it began, all but those in the air, the first
      // at once.
      const ahead = lit != null ? at.map(s => s - lit).filter(s => s > 0) : Array.from({ length: Math.max(0, at.length - shots.length) }, (_, i) => i * (at[1] - at[0]));
      for (const f of ahead) shots.push({ in: Math.round((f + flight) * 10) / 10, air: false });
      after = (ahead.length ? Math.max(...ahead) : 0) + rest + glow;
    } else after = (e._restAt ? Math.max(0, rest - (now - e._restAt) / 1000) : 0) + glow;
  }
  if (!shots.length && !(name === 'blaze' && e.metadata)) return null;
  shots.sort((a, b) => a.in - b.in);
  // A blaze's fireball lands by its aim's scatter at this distance; a
  // ghast's goes where the bot was as it fired, and a body standing there
  // is met.
  const each = name === 'blaze' ? ce.fireballHit(distance) : 1;
  return { name, distance, shots, each, after: after + flight, glowing, glowKnown, flight };
}
// The chance a shot from any of `pushers` lands within `seconds`: what is
// known of each (shotsDue), and past it each one's average rate.
function shotChanceNow(bot, seconds, pushers = shotPushers(bot)) {
  if (!(seconds > 0)) return { chance: 0, due: [] };
  let miss = 1;
  const due = [];
  for (const t of pushers) {
    const p = { name: t.entity?.name, distance: t.distance, visible: !!t.visible };
    let known = null;
    try { known = shotsDue(bot, t); } catch (_) { known = null; }
    if (!known) { miss *= 1 - shotChanceIn(p, seconds); continue; }
    const within = known.shots.filter(s => s.in <= seconds).length;
    miss *= (1 - known.each) ** within * (1 - shotChanceIn(p, Math.max(0, seconds - known.after)));
    if (known.shots.length) due.push({ ...known, within, visible: p.visible });
  }
  return { chance: Math.min(1, 1 - miss), due };
}
// The shots due, in words: "the blaze 15 blocks off is glowing now: its
// volley of three is due, at the bot in about 0.3, 0.6 and 0.9 seconds,
// each landing about 24 in 100".
function dueSays(due) {
  return due.map(k => {
    const said = k.name.replaceAll('_', ' '), word = shotWord(k.name), air = k.shots.filter(s => s.air).length;
    const times = k.shots.slice(0, 3).map(s => s.in);
    const when = times.length === 1 ? `${times[0]} seconds` : `${times.slice(0, -1).join(', ')} and ${times.at(-1)} seconds`;
    const what = k.glowing
      ? `is glowing now${k.glowKnown ? '' : ' (since when is not known, so its shots may come at once)'}, its volley of three due${air ? ` (${air} of it in the air already)` : ''}`
      : `has ${air === 1 ? `a ${word}` : `${air} ${word}s`} in the air at the bot now, due`;
    return `the ${said} ${Math.round(k.distance)} blocks off ${what} at the bot in about ${when}, each ${k.each >= 1 ? 'meeting a body that stands where it was aimed' : `landing about ${Math.round(k.each * 100)} in 100`}`;
  }).join('; ');
}
function openWhileBuildingSays(bot, over, seconds, what) {
  if (!over || !(seconds > 0)) return '';
  const p = over.pusher, word = shotWord(p.name), said = p.name.replaceAll('_', ' ');
  const ce = require('./combat-estimate');
  const rate = p.name === 'ghast' ? `one ${word} every ${require('./ghast').GHAST.every} seconds while it has a line${p.visible ? ' (one may be on its way already)' : ', once it has a line again'}`
    : p.name === 'blaze' ? `a volley of three about every ${Math.round(ce.FIREBALL.volleySeconds)} seconds, at least one of it landing from ${Math.round(p.distance)} blocks about ${Math.round(ce.volleyHit(p.distance) * 100)} in 100`
      : `a shot about every ${ce.MOBS[p.name]?.every || 2} seconds`;
  const pushers = shotPushers(bot);
  const now = pushers.length ? shotChanceNow(bot, seconds, pushers) : { chance: shotChanceIn(p, seconds), due: [] };
  const chance = Math.round(now.chance * 100);
  const more = pushers.length > 1 ? ` (the ${pushers.length - 1} more that can shoot it here counted with it)` : '';
  const due = now.due.length ? `; ${dueSays(now.due)}` : '';
  return ` Until ${what} stands, about ${Math.round(seconds * 10) / 10} seconds, the bot is open over the drop: the ${said} ${Math.round(p.distance)} blocks off fires ${rate}${due ? `${due}; so` : ', so'} ${chance >= 100 ? `a ${word} can all but surely land first` : `about ${chance} in 100 that a ${word} lands first`}${more}, and one that lands before then is the push over the drop: ${over.deadly ? 'the bot\'s death, and everything carried lost with it' : 'the fall and what it costs'}, whatever the damage figure says.`;
}
// An escape's way counted against a push, as a stance standing still is
// (shotOverEdge): the cells of the walk beside a fall that kills (the fire
// run's measure, movement.js fallBeside), the seconds along them (crouched
// in the Nether, as the walk goes there beside a deadly edge, about 1.3
// blocks a second), and the chance that a shot from what can push the bot
// lands meanwhile, by its rate of fire (shotChanceIn). mid-243-ah-
// fortress-5's out_of_sight was offered four times along its ridge over
// the lava sea as "walk 5 blocks ... about 1.2 seconds in their fire",
// nothing said of the drop beside the way, and the walk was refused each
// time where it began: "the way passes along a drop that would kill"; the
// ghast's fireball threw it off where it stood (note 610). `cells` are the
// way's cells from the first step to its end; null with nothing that can
// push the bot, { beside: 0 } where no cell of the way is by such a fall.
const CROUCH_SPEED = 4.317 * 0.3;
function routeEdge(bot, cells, { health = bot.health ?? 20 } = {}) {
  const pushers = shotPushers(bot);
  if (!pushers.length || !cells?.length) return null;
  const { fallBeside } = require('./movement');
  const falls = cells.map(c => fallBeside(bot, c, health));
  const beside = falls.filter(Boolean);
  if (!beside.length) return { beside: 0, cells, says: ` None of the ${cells.length} cell${cells.length === 1 ? '' : 's'} of its way lies beside a drop a push could put the bot over.` };
  const nether = /nether/.test(String(bot.game?.dimension || ''));
  const seconds = Math.round(beside.length / (nether ? CROUCH_SPEED : 4.3) * 10) / 10;
  const p = pushers[0], pusher = { name: p.entity.name, distance: p.distance, visible: !!p.visible }, word = shotWord(pusher.name), said = pusher.name.replaceAll('_', ' ');
  // Measured to its end (dropNear reads down to 48): the walk's own
  // measure stops at a fall that already kills.
  const deep = cells.map(c => require('./terrain').dropNear(bot, c, 1)).filter(d => d && (d.into === 'lava' || d.damage >= health / 2));
  const worst = deep.find(d => d.into === 'lava') ? { into: 'lava', fall: deep.find(d => d.into === 'lava').fallBlocks } : beside.find(f => f.into === 'lava') || beside[0];
  const drop = worst.into === 'lava' ? `a drop into lava${worst.fall ? ` ${worst.fall} down` : ''}` : worst.into === 'deep' ? `a drop of more than ${worst.fall}` : `a drop of ${worst.fall} onto ground that costs half the health or more`;
  const ce = require('./combat-estimate');
  const rate = pusher.name === 'ghast' ? `one ${word} every ${require('./ghast').GHAST.every} seconds while it has a line`
    : pusher.name === 'blaze' ? `a volley of three about every ${Math.round(ce.FIREBALL.volleySeconds)} seconds` : `a shot about every ${ce.MOBS[pusher.name]?.every || 2} seconds`;
  const now = shotChanceNow(bot, seconds, pushers), chance = Math.round(now.chance * 100);
  const due = now.due.length ? `; ${dueSays(now.due)}` : '';
  return { beside: beside.length, cells, seconds, chance, drop: worst,
    says: ` ${beside.length} of the ${cells.length} cell${cells.length === 1 ? '' : 's'} of its way lie${beside.length === 1 ? 's' : ''} beside ${drop}, walked ${nether ? 'crouched (a step does not go over the edge; a push still throws the body)' : 'upright'}: about ${seconds} seconds beside it, while the ${said} ${Math.round(pusher.distance)} blocks off fires ${rate}${due ? `${due}; so` : ', so'} ${chance >= 100 ? `a ${word} can all but surely land on the way` : `about ${chance} in 100 that a ${word} lands on the way`}, and one that lands there is the push over the drop.` };
}
// The open sides a push goes toward first: a push goes away from what
// pushes (a shot's blast from where it lands, on the shooter's side of the
// body, to the body), so the sides facing away from it are walled first and
// the rest after. `pusher` is a position; the sides are cells beside `feet`.
// { sides, lee } with `lee` the leading sides a push goes toward.
function leeFirst(feet, sides, pusher) {
  if (!pusher || !sides.length) return { sides, lee: [] };
  const ax = feet.x + 0.5 - pusher.x, az = feet.z + 0.5 - pusher.z, n = Math.hypot(ax, az) || 1;
  const along = c => ((c.x - feet.x) * ax + (c.z - feet.z) * az) / n;
  const sorted = sides.slice().sort((a, b) => along(b) - along(a));
  return { sides: sorted, lee: sorted.filter(c => along(c) > 0.1) };
}
// What pushes the bot here: the shooter that can put it over (shotPushers),
// else the nearest that bites within six.
function pusherAt(bot) {
  const shot = shotPushers(bot)[0];
  if (shot) return shot.entity.position;
  let near = [];
  try { near = threats(bot, 6).filter(t => !shooter(t.entity)); } catch (_) { /* none */ }
  return near.sort((a, b) => a.distance - b.distance)[0]?.entity?.position || null;
}
// The stances that close the drop's sides off, or shut the bot in: the rest
// leave it open to a shot's push over the edge.
const CLOSES_THE_DROP = new Set(['rail_and_fight', 'seal', 'bunker']);
// What a stance costs against the mobs about, said the same way on every
// stance (combat-estimate.js stanceCost): the crowd deaths were each told
// the fight's cost and nothing of the others', and Jev took the stances
// that carried no figure. `doing` names the building or digging first;
// `done` says what the bot is once it is done ("Two up", "Sealed in").
function costSays(cost, health, mobs, { doing = null, done = null, over = 'in the next fifteen seconds this way' } = {}) {
  const h = Math.round(health * 10) / 10;
  const setupSays = !doing || !cost.setup ? '' : cost.setup >= cost.seconds ? `, and the ${cost.setup} seconds of ${doing} not done within them` : `, the ${cost.setup} seconds of ${doing} included`;
  // Poison takes nothing below 1 (combat-estimate POISON): counted to 1 at
  // most, and said, so a figure made of poison is not read as a death.
  const { poisonFloored } = require('./combat-estimate');
  const damage = cost.poison > 0 ? Math.round(poisonFloored(cost.damage, cost.poison, health) * 10) / 10 : cost.damage;
  const poison = cost.poison > 0 ? Math.round(Math.min(cost.poison, Math.max(0, health - 1)) * 10) / 10 : 0;
  const poisonSays = poison > 0 ? ` About ${poison} of it is poison (one health every 1.25 seconds, only while health is above 1: it leaves the bot at 1 or just under, and the next bite or hit kills).` : '';
  let s = ` About ${damage} damage from the mobs here ${over}${setupSays}, from ${h} health${damage >= health ? ' (more than the bot has)' : ''}.${poisonSays}`;
  // A figure that leaves less health than one blow of the mobs about is a
  // coin toss, said as one: the price is an average over blows that land
  // three at a time. mid-242-ab-nether-3-fortress-6's bunker was told "about
  // 14.1 damage ... from 14.3 health" beside options that were each more than
  // the bot had, was taken, and five blows of three ended it (note 628).
  // A blaze's blow is a fireball that lands with its fire (combat-estimate
  // FIRE_TICKS, note 631): the 2.5 through iron and four more.
  const ceLand = require('./combat-estimate');
  // With fire resistance on the body past the fifteen seconds, a blaze's
  // fireball is no blow at all (note 656).
  const blowOf = m => m.name === 'blaze' && m.shoots && m.hitsBot > 0 ? (m.fireproofFor >= ceLand.HOLD_SECONDS ? 0 : ceLand.landingCost(m.hitsBot)) : (m.jab ?? m.hitsBot ?? 0);
  const blowMob = mobs.filter(m => !m.apart && !['creeper', 'warden', 'ghast'].includes(m.name)).sort((a, b) => blowOf(b) - blowOf(a))[0];
  const blow = blowMob ? blowOf(blowMob) : 0;
  const blowSays = blowMob?.name === 'blaze' && blowMob.shoots ? `the ${Math.round(blow * 10) / 10} of one fireball that lands (its hit and its fire)` : `the ${Math.round(blow * 10) / 10} of one blow`;
  const margin = damage > 0 && damage < health && blow > 0 && health - damage < blow ? ` That leaves ${Math.round((health - damage) * 10) / 10} health, less than ${blowSays}: one blow more than the figure counts, or one landing sooner than it does, ends the bot.` : '';
  // The biters out of sight further off that can come in while the bot
  // builds or digs, said as counted (farBiters, note 581).
  const farIn = cost.farIn || [];
  if (farIn.length) s += ` Counted though out of sight, at the bot before the ${doing || 'setting up'} is done at its own speed: ${farIn.map(f => `the ${f.name.replaceAll('_', ' ')} ${Math.round(f.distance)} blocks off, in about ${f.seconds} second${f.seconds === 1 ? '' : 's'}`).join(', ')}.`;
  for (const b of cost.blasts) s += ` The creeper ${Math.round(b.distance)} blocks off can go off beside the bot in about ${b.seconds} seconds${doing && cost.setup ? `, ${b.seconds <= cost.setup ? 'before' : 'after'} the ${doing} is done` : ''}: about ${Math.round(b.hitsBot)} ${b.at && b.at !== 2 ? `${b.at} blocks off, where it goes off fought,` : 'two blocks off'} after the armour worn${b.hitsBot >= health ? ', more than the bot has' : ''}.`;
  // Those that reach it again partway (a shooter walked to a new line) are
  // said with when, and counted from then.
  // What the figure counts at the game's and the record's rates rather than
  // in full, said where it is (note 647): the biters out of sight, and the
  // shooters kept off by what stands between.
  const { UNSEEN, COVER_LEAK } = require('./combat-estimate');
  if (cost.unseenBiters?.length) s += ` ${mobList(cost.unseenBiters, mobs.filter(m => cost.unseenBiters.includes(m.name))).replace(/^./, c => c.toUpperCase())} out of sight within eight blocks ${cost.unseenBiters.length === 1 && mobs.filter(m => cost.unseenBiters.includes(m.name)).length === 1 ? 'is' : 'are'} counted at ${Math.round(UNSEEN.arrives * 100)} in 100 of their blows: a mob takes a player as its target only in sight and drops it after three seconds out of it, and in the flight records' windows with only such biters about a quarter of what was priced landed; one that comes into sight is the whole fight.`;
  if (cost.leaks?.length) s += ` ${mobList(cost.leaks, mobs.filter(m => cost.leaks.includes(m.name))).replace(/^./, c => c.toUpperCase())} kept off by what stands between still lands ${Math.round(COVER_LEAK * 100)} in 100 of what it lands in the open after the first seconds (measured over the record's holding stances: a shooter finds a line round the block, the blast and the fire come round it).`;
  const later = (cost.later || []).map(l => `the ${l.name.replaceAll('_', ' ')} after about ${l.seconds} seconds`);
  const laterSays = later.length ? `; ${later.length > 1 ? `${later.slice(0, -1).join(', ')} and ${later.at(-1)}` : later[0]} reach${later.length === 1 ? 'es' : ''} it again, counted from then` : '';
  const stillOf = cost.stillMobs || mobs;
  if (done && cost.setup < cost.seconds) s += cost.still.length ? ` ${done}, ${mobList(cost.still, stillOf)} still reach${cost.still.length === 1 && stillOf.filter(m => m.name === cost.still[0]).length === 1 ? 'es' : ''} it${laterSays}.` : ` ${done}, none of them reaches it${later.length ? ' at first' : ''}${laterSays}.`;
  return s + margin;
}
// The biters out of sight but near, with a way to the bot (walk-reach.js;
// a spider climbs, so is never judged apart): within the eight a biter is
// a threat from (danger.js immediateThreat), priced with the ones in view.
const UNSEEN_BITER_REACH = 8;
function unseenBiters(bot, danger) {
  let near = [];
  try { near = threats(bot, UNSEEN_BITER_REACH).filter(t => !t.visible && !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name) && !danger.some(d => d.entity?.id === t.entity.id)); } catch (_) { return []; }
  if (!near.length) return [];
  const apart = walkersApart(bot, near);
  return near.filter(t => !apart.ids.has(t.entity.id)).map(t => ({ ...t, unseen: true }));
}
// The biters out of sight past those eight, within the twenty-four a stance
// counts and their own follow range (a piglin's 16), with a way to the bot:
// not a threat by themselves, but a stance that stands the bot still
// building or digging for many seconds is open to each that can come in
// that time. mid-242-ad-nether-3 chose a pocket of 23 blocks, told "about 0
// damage ... the 13.8 seconds of building included", with a sword piglin
// 15.7 blocks off round the rock, said only as "out of sight but about";
// it was at the bot, dropped in through the roof not yet built, eleven
// seconds later, and three blows ended it (note 581).
function farBiters(bot, counted = []) {
  let far = [];
  try {
    far = threats(bot, 24).filter(t => !t.visible && !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name) &&
      t.distance > UNSEEN_BITER_REACH && t.distance <= followRange(t.entity.name) && !counted.some(d => d.entity?.id === t.entity.id));
  } catch (_) { return []; }
  if (!far.length) return [];
  const apart = walkersApart(bot, far);
  return far.filter(t => !apart.ids.has(t.entity.id)).map(t => ({ ...t, unseen: true, far: true }));
}
// Why the piglins about are after the bot, and what it would take to stop
// it, said in the stance question: mid-242-ad-nether-3 met four of them in
// an iron helmet and chestplate with no gold on, and no question it was
// asked said that gold was the whole of their quarrel (note 581). The rule
// is the game's (PiglinAi: a player wearing any gold armour piece is not a
// target, save to one angry with it, and the anger spreads to the piglins
// near the one struck); a brute ignores gold.
const GOLD_SLOTS = { golden_helmet: [5, 'head'], golden_chestplate: [6, 'chest'], golden_leggings: [7, 'legs'], golden_boots: [8, 'feet'] };
function piglinGoldSays(bot, danger = []) {
  if (!danger.some(t => t.entity?.name === 'piglin')) return null;
  const worn = [5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean);
  if (worn.some(n => /^golden_/.test(n))) return null;
  const said = n => n.replaceAll('_', ' ');
  const rule = 'The piglins here go for the bot because it wears no gold: a piglin leaves a player wearing any one piece of gold armour alone, save one angry with it (struck by that player, and the piglins near the one struck, for about 30 seconds); a piglin brute goes for a player whatever is worn.';
  const piece = bot.inventory.items().find(i => GOLD_SLOTS[i.name]);
  if (piece) {
    const [slot, where] = GOLD_SLOTS[piece.name];
    const on = bot.inventory.slots?.[slot]?.name;
    const { armourOf } = require('./combat-estimate');
    const less = on ? armourOf([on]).points - armourOf([piece.name]).points : 0;
    return `${rule} ${said(piece.name).replace(/^./, c => c.toUpperCase())} ${piece.count > 1 ? 'are' : 'is'} carried: putting it on is one move in the inventory, under half a second standing still, ${on ? `in place of the ${said(on)}${less > 0 ? ` (${less} armour point${less === 1 ? '' : 's'} less)` : ''}` : `on the ${where}, bare now, so nothing worn comes off`}.`;
  }
  const ingots = countOf(bot, 'gold_ingot');
  return `${rule} No gold armour is carried${ingots ? `; ${ingots} gold ingot${ingots === 1 ? '' : 's'} carried, and golden boots take four at a crafting table` : ', nor gold to make any (golden boots take four ingots at a crafting table)'}.`;
}
// How many biters can be at arm's length at once where the bot stands: the
// cells round it a mob could stand in (room for a body, ground under it or
// a step up). Two in a tunnel, eight on open ground.
function openCells(bot, feet = feetCell(bot)) {
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/lava/.test(b.name); };
  const floor = p => bot.blockAt(p)?.boundingBox === 'block';
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    const c = feet.offset(dx, 0, dz);
    if (open(c) && open(c.offset(0, 1, 0)) && (floor(c.offset(0, -1, 0)) || floor(c.offset(0, -2, 0)))) n++;
    else if (floor(c) && open(c.offset(0, 1, 0)) && open(c.offset(0, 2, 0))) n++;
  }
  return n;
}
// The bot's column open overhead onto ground a walker stands on: a shaft
// dug down from a tunnel's floor, a hole under a ledge. Mobs walk to its
// edge and drop in, into the bot's own cells, as many as come, whatever the
// cells round it hold; and a pillar's top in it is level with that ground.
// mid-229-r dug down three from a tunnel with zombies eight blocks off, the
// lid not on when they came; told its fight was one zombie at a time
// ("0 of the eight cells round the bot are open ground"), about 3.5
// damage, it fought, and the three came down into its cell (note 526).
// The first cell up the column (two to `most` over the feet) with ground
// beside it: { up, ground }, or null.
function columnOpening(bot, feet = feetCell(bot), most = 4) {
  const open = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); };
  const floor = p => bot.blockAt(p)?.boundingBox === 'block';
  for (let up = 2; up <= most; up++) {
    const c = feet.offset(0, up, 0);
    if (!open(c)) return null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = c.offset(dx, 0, dz);
      if (open(n) && open(n.offset(0, 1, 0)) && floor(n.offset(0, -1, 0))) return { up, ground: n };
    }
  }
  return null;
}
// The mobs whose bodies are in the bot's own cells (its feet and head):
// fallen into a one-wide shaft on top of it, or pressed into it. No block
// goes where a body is: a pillar's first block goes into the feet cell, and
// a pocket closed round them shuts them in with the bot. mid-229-r was
// offered the pillar ("two up, none of them reaches it", 6.3 damage) and the
// pocket ("shut in, none of them reaches it", 2.5) five times with three
// zombies in its cell, each failed without a block placed, and the zombies
// took it from 12.7 to none in ten seconds (note 526).
function inOwnCells(bot, danger, feet = feetCell(bot)) {
  const { bodyIn } = require('./work');
  return danger.filter(t => t.entity?.position && [0, 1].some(dy => bodyIn(t.entity, feet.offset(0, dy, 0))));
}
const ownCellsSays = list => {
  const kinds = mobList([...new Set(list.map(t => t.entity.name))], list.map(t => ({ name: t.entity.name })));
  return `${list.length === 1 ? `${kinds.replace(/^the /, 'A ')} stands` : `${kinds.replace(/^the /, 'The ')} stand`} in the bot's own cells with it`;
};
// A meal worth a stance: the bot is hurt, and hunger after it is high enough
// for health to come back. At full health, or still under eighteen after
// it, eating in a fight is a second and a half for nothing; offered anyway,
// its small bill (the mobs over those seconds only) outbid the stances that
// deal with them (mid-92-e's replay, 2026-09-26).
// With no safe food, the last resort (rotten flesh, raw chicken), its
// Hunger said: offered only under a hidden rule, it was never a stance, and
// four of the day's low-health deaths carried rotten flesh (note 515).
function mealHelps(bot) {
  if ((bot.food ?? 20) >= 20 || (bot.health ?? 20) >= 20) return null;
  const food = chooseFood(bot) || lastResortFood(bot);
  if (!food) return null;
  return (bot.food ?? 20) + (bot.registry.foodsByName?.[food.name]?.foodPoints || 0) >= 18 ? food : null;
}
// The meal's bill is for the eating alone: said, so it is not read as a way
// out of the crowd.
const EAT_AFTER = ' The mobs are all still here when it is done.';
// Eating in an encounter, said: what the meal gives back and when. Health
// comes back once a half second while hunger is full and saturation lasts
// (a point and a half of saturation each), once in four seconds from
// eighteen hunger, and not below.
function eatSays(bot, food) {
  const f = bot.registry.foodsByName?.[food.name] || {};
  const hunger = Math.min(20, (bot.food ?? 20) + (f.foodPoints || 0));
  const saturation = Math.min(hunger, (bot.foodSaturation ?? 0) + (f.saturation || 0));
  const missing = Math.max(0, Math.round(20 - (bot.health ?? 20)));
  const back = hunger >= 20 && saturation >= 1.5 && missing
    ? `then health comes back about one each half second while the saturation lasts, about ${Math.min(missing, Math.floor(saturation / 1.5))} in ${Math.round(Math.min(missing, Math.floor(saturation / 1.5)) / 2)} seconds`
    : hunger >= 18 && missing ? 'then health comes back about one each four seconds' : missing ? 'and health does not come back below eighteen hunger' : 'health is full';
  const effect = sideEffectSays(food.name);
  return `Eat the ${food.name === 'chicken' ? 'raw chicken' : food.name.replaceAll('_', ' ')} now (${countOf(bot, food.name)} carried): about ${EAT_SECONDS} seconds standing still, the hand busy and the shield down, no swing; hunger ${bot.food} to ${hunger}, ${back}.${effect ? ` It is the last resort: ${effect}.` : ''}`;
}
function firmStep(bot, p) {
  if (!p) return false;
  const floor = bot.blockAt(p.offset(0, -1, 0)), body = [bot.blockAt(p), bot.blockAt(p.offset(0, 1, 0))];
  return floor?.boundingBox === 'block' && !/lava|magma|fire/.test(floor.name) && body.every(b => b && b.boundingBox === 'empty' && !/lava|fire/.test(b.name)) && !lavaBeside(bot, p);
}
// The charge's own way to a shooter, walked ahead of time: straight at it,
// a cell at a time, level, a step up or a step down onto firm ground, as
// closeOnShooter moves. How far it gets, or null when it gets to reach.
// mid-110-h was offered a charge at two skeletons the ground between would
// not carry it to, and fought on for fifty-four seconds (2026-09-26).
function chargeStopsAt(bot, target) {
  let at = feetCell(bot);
  const goal = target.position.floored();
  for (let i = 0; i < 24; i++) {
    const flat = goal.minus(at); flat.y = 0;
    if (Math.hypot(flat.x, flat.z) <= 2.5 && Math.abs(goal.y - at.y) <= 2) return null;
    const len = Math.hypot(flat.x, flat.z) || 1;
    const ahead = at.offset(Math.round(flat.x / len), 0, Math.round(flat.z / len));
    const next = [ahead, ahead.offset(0, 1, 0), ahead.offset(0, -1, 0)].find(c => firmStep(bot, c));
    if (!next) return { blocks: i, left: Math.round(target.position.distanceTo(at.offset(0.5, 0, 0.5))) };
    at = next;
  }
  return null;
}
// The last run at this mob, if it got no nearer: a mob that keeps its
// distance (a witch, a skeleton backing off) or a way that does not carry
// the bot to it.
const CHARGE_REMEMBERED_MS = 30000;
function chargeSays(bot, entity) {
  const last = bot._charges?.[entity?.id];
  if (!last || Date.now() - last.at > CHARGE_REMEMBERED_MS || last.to < last.from - 1) return '';
  const name = (last.name || entity.name || 'mob').replaceAll('_', ' ');
  return ` The last run at the ${name}, ${Math.round((Date.now() - last.at) / 1000)} seconds ago, ended ${Math.round(last.to)} blocks off, no nearer than the ${Math.round(last.from)} it began at.`;
}
// Ore worth a night's digging, nearest first, below the bot or level with
// it: a tunnel up toward an ore in the roof is a tunnel toward the surface.
// Not copper: nothing on the ladder wants it, and trial 20's stone pickaxe
// wore out on fifty-seven of it and left the bot without one (2026-09-24).
// (Jev may still choose it: nightTarget offers every kind, copper's use said.)
const NIGHT_ORES = new Set(['coal_ore', 'iron_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore', 'copper_ore', 'deepslate_copper_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore']);
// What each ore gives and what it is for, said to Jev with the choice.
const ORE_YIELD = { coal: ['coal', 'fuel for every smelt, and torches'], iron: ['raw_iron', 'tools, armour, a shield and a bucket'], copper: ['raw_copper', 'nothing on the ladder wants it'],
  gold: ['raw_gold', 'golden boots for the Nether'], redstone: ['redstone', 'nothing on the ladder wants it'], lapis: ['lapis_lazuli', 'enchanting'],
  diamond: ['diamond', 'the best tools and armour'], emerald: ['emerald', 'trading with villagers'] };
const oreKind = name => (/(?:deepslate_)?(\w+?)_ore$/.exec(name || '') || [])[1];
// The nearest of each kind of ore the night mine could go for: dry, not
// above the feet (a tunnel up is a tunnel toward the surface), in the
// working depth, and not a target that failed lately.
function nightOreChoices(bot, feet, attempts) {
  const names = Object.keys(bot.registry?.blocksByName || {}).filter(n => ORE_YIELD[oreKind(n)] && /_ore$/.test(n));
  const ids = names.map(name => bot.registry.blocksByName[name].id);
  const found = bot.findBlocks?.({ matching: ids, maxDistance: 24, count: 64 }) || [];
  const wet = q => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
    .some(([x, y, z]) => /water|lava|bubble_column|kelp|seagrass/.test(bot.blockAt(q.offset(x, y, z))?.name || ''));
  const byKind = new Map();
  for (const q of found.filter(q => q.y <= feet.y + 1 && q.y >= -48 && !attempts?.resting('night_mine', q) && !wet(q)).sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))) {
    const name = bot.blockAt(q)?.name, kind = oreKind(name);
    if (kind && !byKind.has(kind)) byKind.set(kind, { position: q, name, kind });
  }
  return [...byKind.values()];
}
// What the rock about the bot holds, for a choice about mining it: the ore
// in view with its distance, and which kinds the best pickaxe carried
// mines. A pocket's "mine the night away" said only "toward ore in the
// rock", and Jev sat the night out with iron wanted and a stone pickaxe.
const PICK_TIER = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 };
const ORE_TIER = { coal: 1, copper: 2, iron: 2, lapis: 2, gold: 3, redstone: 3, diamond: 3, emerald: 3 };
function rockHolds(bot, feet, attempts) {
  const tier = Math.max(0, ...bot.inventory.items().map(i => /^(\w+)_pickaxe$/.exec(i.name)).filter(Boolean).map(m => PICK_TIER[m[1]] || 0));
  if (!tier) return 'No pickaxe is carried: stone and ore cannot be mined.';
  const pick = Object.keys(PICK_TIER).find(k => PICK_TIER[k] === tier);
  const mines = Object.keys(ORE_TIER).filter(k => ORE_TIER[k] <= tier), not = Object.keys(ORE_TIER).filter(k => ORE_TIER[k] > tier);
  const seen = nightOreChoices(bot, feet, attempts).map(c => `${c.kind} ${Math.round(c.position.distanceTo(feet))} blocks off`);
  const uses = Math.max(0, ...bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => remainingUses(bot, i)));
  const keep = usesToClimbOut(bot);
  const wear = Number.isFinite(uses) ? ` The best pickaxe has ${uses} uses left; about ${keep} of them are the climb back out from here, and the mine stops when it gets down to that.` : '';
  return `${seen.length ? `Ore in view: ${seen.join(', ')}.` : 'No ore in view from here; a branch finds it in the rock.'} The ${pick} pickaxe carried mines ${mines.join(', ')} ore${not.length ? `; ${not.join(', ')} need a better one` : ''}.${wear}`;
}

// What a pocket is built of: what the bot carries to wall itself in with.
// Natural ground in the shell was never placed and stays where it is.
const POCKET_BLOCKS = new Set(['cobblestone', 'cobbled_deepslate', 'netherrack', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'blackstone', 'basalt',
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks']);

async function clearAboveBed(bot, task, actions, site) {
  for (const cell of [site.foot, site.head].filter(Boolean).map(p => p.offset(0, 1, 0))) {
    const block = bot.blockAt(cell);
    if (!block || block.boundingBox !== 'block' || !block.diggable || /bed$|chest|furnace|crafting_table/.test(block.name)) continue;
    task.check();
    try { await actions.dig(bot, task, cell, { requireDrops: false }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
}
function lavaBeside(bot, p) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 0; dy++) {
    if (bot.blockAt(new Vec3(p.x + dx, p.y + dy, p.z + dz))?.name === 'lava') return true;
  }
  return false;
}
// In lava, nothing else is the question: a hoglin knocked the bot into
// the pool beside it at eight health, and it "held a defensive position"
// in the lava four times until it burned. The nearest cell with a floor,
// air for the body and no lava in it, forward and jumping at it.
// Phantoms spawn over a player awake for three in-game days (72000 ticks).
const SLEEP_DEBT_TICKS = 48000;
const worldAge = bot => Number(bot.time?.age);

const inLava = bot => require('./terrain').bodyInLava(bot);
const inWater = bot => !!bot.entity?.isInWater || bot.blockAt(feetCell(bot))?.name === 'water';
// The shield raised facing the nearest biter within four blocks (at its
// reach, or there within the second or two the bot stands still), for a
// moment of standing still: true when it was raised.
async function guardFacing(bot) {
  if (bot.inventory?.slots?.[45]?.name !== 'shield' || !bot.entity?.position) return false;
  const wg = require('./wither-guard');
  let near = [];
  try { near = threats(bot, 4).filter(t => wg.guardable(t) && (t.visible || t.distance <= 2)).sort((a, b) => wg.bladeReaches(b.entity, bot.entity.position) - wg.bladeReaches(a.entity, bot.entity.position) || a.distance - b.distance); } catch (_) { return false; }
  if (!near.length) return false;
  const e = near[0].entity;
  try { await bot.lookAt?.(e.position.offset(0, (e.height || bodyHeight(e.name)) * 0.6, 0), true); return raiseShield(bot); } catch (_) { return false; }
}
// A shield stance was standing behind the raised shield and a biter it
// guards against is at arm's length (its blade reaches, or within two
// blocks); the bot is neither alight nor in lava (note 683).
function keepShieldForStance(bot) {
  if (!bot._shieldRaised || !SHIELD_STANCES.has(bot._stance?.choice) || !bot.entity?.position) return false;
  if ((bot.entity.metadata?.[0] & 1) || inLava(bot)) return false;
  const wg = require('./wither-guard');
  try { return threats(bot, 4).some(t => wg.guardable(t) && (wg.bladeReaches(t.entity, bot.entity.position) || t.distance <= 2)); } catch (_) { return false; }
}
// Seconds between a biter's blows at its reach (a hoglin two, most one).
const ce_blowEvery = name => require('./combat-estimate').MOBS[name]?.blowEvery || 1;
// Walked to the middle of a cell, a few ticks at most: where a stance is
// judged from the middle (a ceiling that keeps a tall walker a block and a
// half off it, note 601).
async function centreOn(bot, task, cell) {
  const centre = new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5);
  const off = () => Math.hypot(bot.entity.position.x - centre.x, bot.entity.position.z - centre.z);
  try {
    for (let i = 0; i < 20 && off() > 0.15; i++) {
      task.check();
      await bot.lookAt?.(centre.offset(0, bot.entity.position.y - centre.y + 1.62, 0), true);
      // Crouched: a walk's step overshoots a tenth of a block.
      bot.setControlState?.('sneak', true); bot.setControlState?.('forward', true);
      await sleep(50);
    }
  } finally { bot.setControlState?.('forward', false); bot.setControlState?.('sneak', false); }
}

// A passage out of a pocket away from a creeper (Survival.passageOut): its
// end at least this far from the creeper, more than the six blocks that keep
// a door shut; at least this long, so the bot is in rock and not at a door;
// and no longer than this.
const PASSAGE_CLEAR = 10, PASSAGE_MIN = 4, PASSAGE_MAX = 16;
// A biter's arm's length, as the shield guard reads it (projectile-guard MELEE_REACH).
const MELEE_REACH = 3.5;
// The pocket's choices that open its wall toward the mobs outside.
const OPENS_ON_MOBS = new Set(['dig_in_and_fight', 'open_on_watcher']);

// Where a held stance looks, for the shield: a shield covers only the way
// the bot faces. A shot on its way first (the guard's own rule), then the
// nearest shooter that can see the bot, then the nearest mob. mid-227-n
// held its pillar facing the nearest mob each pass while the skeleton
// behind it shot through a raised shield (note 395, 2026-09-27).
// But a biter at arm's length whose blow reaches the bot where it stands
// comes before any shot or shooter: it hits every second, and the swing
// and the shield both go the way the bot looks (projectile-guard's own
// rule, meleeClose). mid-208-k-nether-3-fortress-2 held its pillar facing
// a blaze twenty blocks off, the wither skeleton three blocks behind it on
// the floor below, whose blow reaches a player two up: it was struck from
// behind, 20 to 15.2, and knocked off the top (note 559). A spider at a
// pillar's foot, which reaches only by climbing, does not turn it from the
// shooter (note 395).
function armsLengthBiter(bot, danger) {
  const { bodyHeight } = require('./combat-estimate');
  const feetY = bot.entity?.position?.y ?? 0;
  return danger.filter(t => t.entity?.position && !shooter(t.entity) && t.distance <= MELEE_REACH && t.entity.position.y + bodyHeight(t.entity.name) > feetY + 0.01)
    .sort((a, b) => a.distance - b.distance)[0] || null;
}
function shieldFacing(bot, danger) {
  const biter = armsLengthBiter(bot, danger);
  if (biter) return { at: biter.entity.position.offset(0, (biter.entity.height || 1.8) / 2, 0), name: biter.entity.name };
  const shot = require('./projectile-guard').incoming(bot, { reach: 24 })[0];
  if (shot?.position) return { at: shot.position, name: shot.name };
  const aimed = danger.find(t => t.visible && shooter(t.entity)) || danger[0];
  return aimed?.entity?.position ? { at: aimed.entity.position.offset(0, 1, 0), name: aimed.entity.name } : null;
}
// Out to six blocks: at three, a fall into the Nether's lava sea found no
// shore, the step did nothing, and the bot burned four seconds standing.
// Through lava a body moves about 0.4 blocks a second, from the 26.1 jar
// (LivingEntity.travelInLava): the input adds 0.02 of the keys' 0.98 a
// tick and the lava halves the motion every tick, sprinting or not, so
// 0.0196 a tick at most. The flow's push (Entity, 0.007 a tick in the
// Nether's fast lava, 0.0023 elsewhere, halved as well) adds or takes up
// to about 0.14 a second. It was said as a block a second, not measured,
// and mid-244-ab's ways out were priced at twice what they took (note 569).
const LAVA_BLOCKS_A_SECOND = 0.4;
// And how lava spreads, from the same jar (LavaFluid): a block every ten
// ticks and up to seven from where it pours in the Nether (fast lava), a
// block every thirty ticks and up to three elsewhere. Faster than a body
// swims either way.
const lavaSpreads = bot => /nether/.test(String(bot.game?.dimension || ''))
  ? 'lava spreads a block every half second here, up to seven blocks from where it pours'
  : 'lava spreads a block every second and a half, up to three blocks from where it pours';

// The way through lava to each cell near, walked as a body goes: a cell
// the body fits in (feet and head with no collision box, lava counting as
// room), a step to a side up to one up (a jump, with head room over where
// it jumps from) or one down. -> Map of 'x,y,z' to { blocks, from }.
// Straight-line distance went through rock: mid-244-ab was told of a dry
// cell 2.9 blocks off behind the tunnel's corner and swam into the wall
// (note 569).
function lavaRoutes(bot, feet, radius = 6) {
  const fits = c => [c, c.offset(0, 1, 0)].every(p => bot.blockAt(p)?.boundingBox === 'empty');
  const key = c => `${c.x},${c.y},${c.z}`;
  const out = new Map([[key(feet), { blocks: 0, from: null, cell: feet }]]);
  const open = [feet], done = new Set();
  // A diagonal step where both cells beside it at its level fit, as a body
  // slides past a corner only with room.
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (out.get(key(open[i])).blocks < out.get(key(open[bi])).blocks) bi = i;
    const c = open.splice(bi, 1)[0], ck = key(c);
    if (done.has(ck)) continue;
    done.add(ck);
    const here = out.get(ck);
    for (const [dx, dz, cost] of steps) for (const dy of dx && dz ? [0] : [0, 1, -1]) {
      const to = c.offset(dx, dy, dz), k = key(to);
      if (done.has(k) || Math.abs(to.x - feet.x) > radius + 1 || Math.abs(to.z - feet.z) > radius + 1 || to.y < feet.y - 2 || to.y > feet.y + 6) continue;
      if (dy === 1 && bot.blockAt(c.offset(0, 2, 0))?.boundingBox !== 'empty') continue;
      if (dy === -1 && bot.blockAt(to.offset(0, 2, 0))?.boundingBox !== 'empty') continue;
      if (dx && dz && !(fits(c.offset(dx, 0, 0)) && fits(c.offset(0, 0, dz)))) continue;
      if (!fits(to)) continue;
      const blocks = here.blocks + cost;
      if (out.has(k) && out.get(k).blocks <= blocks) continue;
      out.set(k, { blocks, from: c, cell: to }); open.push(to);
    }
  }
  return out;
}
// How high a body in lava gets, from prismarine-physics (what the bot's own
// body moves by) on mid-243-af-nether-1's beach, the lava sea's top at y 31
// (note 592). Holding jump alone it bobs with the feet about 0.6 under the
// lava's top and over it: in lava jump adds 0.04 a tick and the lava halves
// the motion, and out of it the body falls back. Pressed against a wall with
// room over it, the push out of a liquid (0.3 up a tick) lifts it fast, 30.1
// to 32.4 in about a second, and no higher than about half a block over the
// lava's top: onto a floor level with the lava's top it comes out in 1.1
// seconds, and onto the beach's gravel, a block higher, never, bouncing
// between 31.2 and 32.6 for ten seconds. mid-243-af-nether-1 was steered at
// that gravel, "2 above the feet", and burned from 17.9 to none in four
// seconds against it. The top of the lava the body is in: the highest lava
// cell of the unbroken run up from the feet, in the columns its box
// touches; null in none.
const LAVA_WALL_RISE = 3, LAVA_JUMP_RISE = 0.8;
function lavaTop(bot, p = bot.entity.position) {
  let top = null;
  const head = Math.floor(p.y + 1.8);
  for (let x = Math.floor(p.x - 0.3); x <= Math.floor(p.x + 0.3); x++) for (let z = Math.floor(p.z - 0.3); z <= Math.floor(p.z + 0.3); z++) {
    let seen = null;
    for (let y = Math.floor(p.y); y <= head + 8; y++) {
      if (/^(flowing_)?lava$/.test(bot.blockAt(new Vec3(x, y, z))?.name || '')) seen = y;
      else if (seen !== null || y >= head) break;
    }
    if (seen !== null && (top === null || seen > top)) top = seen;
  }
  return top;
}
// The highest cell out a swim reaches: one whose floor is no higher than the
// lava's top, or a jump up from the feet where the lava is shallower.
const swimReach = (feet, top) => top === null ? feet.y + 1 : Math.max(feet.y + 1, top + 1);
// Where a block put into the lava lets the body stand at the lava's top:
// the top lava cell of the body's own column or one beside it, with room
// over it and a block beside it to put it against, the nearest first. The
// body presses against that block holding jump (the push out of the lava
// lifts it), and as the feet clear the cell the block goes in under them.
function lavaFill(bot, top) {
  if (top === null) return null;
  const p = bot.entity.position, feet = p.floored();
  const solid = c => { const b = bot.blockAt(c); return b?.boundingBox === 'block' && !/lava|water/.test(b.name) ? b : null; };
  const room = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name); };
  const out = [];
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cell = new Vec3(feet.x + dx, top, feet.z + dz);
    if (!/^(flowing_)?lava$/.test(bot.blockAt(cell)?.name || '') || !room(cell.offset(0, 1, 0)) || !room(cell.offset(0, 2, 0))) continue;
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ref = solid(cell.offset(fx, 0, fz));
      if (!ref) continue;
      // How far the body swims to press against it: to the side of the
      // cell it lies on.
      const wall = Math.max(0, Math.abs((cell.x + 0.5 + fx * 0.2) - p.x) + Math.abs((cell.z + 0.5 + fz * 0.2) - p.z) - 0.1);
      out.push({ cell, ref, face: new Vec3(-fx, 0, -fz), wall });
    }
  }
  return out.sort((a, b) => a.wall - b.wall)[0] || null;
}
// The cells walked to reach `to`, the first step first; null with no way.
function routeOf(routes, to) {
  const k = c => `${c.x},${c.y},${c.z}`;
  if (!routes.has(k(to))) return null;
  const path = [];
  // Copies, not the cells themselves: the last is the target, and the
  // caller hangs this path on it (best.route), a cell holding a path that
  // holds the cell; the goal it went into could not be saved (mid-242-hb,
  // 2026-09-29 20:54Z, 'Converting circular structure to JSON').
  for (let c = to; c && routes.get(k(c))?.from; c = routes.get(k(c)).from) path.unshift(c.clone ? c.clone() : { x: c.x, y: c.y, z: c.z });
  return path;
}
// Eaten only when one is gone: the equip's own held-item change came after
// the eating began and ended it at once (mineflayer finishes an eat on any
// held-item change), and mid-244-n "ate" its golden apple every half second
// for four seconds, none eaten, zombies hitting it from 9.6 to none
// (2026-09-27). The hand settles before the eat. In lava too (body_way),
// where the task's own lava check is held off while it eats.
async function eatApple(bot, task, apple) {
  const before = countOf(bot, apple.name), wasLeaving = bot._leavingLava;
  if (require('./terrain').bodyInLava(bot)) bot._leavingLava = true;
  try {
    // Eaten through the shots as any chosen meal (meal.js, note 701).
    const r = await require('./meal').eatThrough(bot, task, apple, { eaten: () => countOf(bot, apple.name) < before });
    return r.eaten;
  }
  catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
  finally { bot._leavingLava = wasLeaving; }
}
// `dryOnly`: the same ranking as `water`, with the water cells left out, for
// the dry way offered beside the wet one (body_way).
function lavaExit(bot, radius = 6, { water = false, dryOnly = false } = {}) {
  const feet = feetCell(bot), cells = [];
  if (dryOnly) water = true;
  // Water is a way out too, and the best one: it puts the fire out. Making
  // obsidian, the water poured over the pool filled every cell beside the
  // bot when it went into the lava, the nearest dry cell was seven blocks
  // off through the pool, and mid-92-h burned without moving (2026-09-26).
  const dry = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !(water ? /lava|fire/ : /lava|fire|water/).test(b.name); };
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 5; dy++) {
    const c = feet.offset(dx, dy, dz);
    if (bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block' || require('./terrain').hotFloor(bot.blockAt(c.offset(0, -1, 0))) || !dry(c) || !dry(c.offset(0, 1, 0))) continue;
    // Out of lava, never the cell the feet are in: the body leaned from it
    // into the lava beside, it was "the nearest dry cell", and mid-92-m
    // burned from sixteen health standing in it (2026-09-26). Cells with
    // lava beside them come after those without.
    if (water && c.equals(feet)) continue;
    // Water a step up is no way out: the climb out of a liquid is refused
    // where the body would rise into liquid, so mid-92-n bobbed in the
    // lava against the obsidian under the water it had poured, the one
    // exit it was steered at, and burned from sixteen (2026-09-26).
    if (water && c.y > feet.y && [c, c.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water')) continue;
    if (dryOnly && [c, c.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water')) continue;
    cells.push(c);
  }
  // By the way through, not the straight line: a cell behind rock is as
  // far as the walk round it. One out of a jump's reach (two or more up)
  // keeps its straight line: the pillar rises to it.
  const routes = lavaRoutes(bot, feet, radius);
  const routed = c => routes.get(`${c.x},${c.y},${c.z}`);
  const far = c => routed(c) ? routed(c).blocks : c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  for (let i = cells.length - 1; i >= 0; i--) if (!routed(cells[i]) && cells[i].y <= feet.y + 1) cells.splice(i, 1);
  const lavaBy = c => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => [0, 1].some(dy => /lava/.test(bot.blockAt(c.offset(x, dy, z))?.name || ''))) ? 4 : 0;
  // Out of lava upright, the push can carry past the cell: one on a ledge
  // comes after one with a floor all round. mid-235-a stepped out onto the
  // Nether ledge's edge and over it, twenty blocks into the lava below
  // (2026-09-26).
  const edge = c => require('./terrain').besideDrop(bot, c) ? 4 : 0;
  // A jump rises one block: a cell two up is out of reach from lava one
  // deep. mid-230-d was steered at a ledge two above its feet, hopped in
  // place five seconds and burned (2026-09-26). Deeper in, the swim reaches
  // what is level with the lava's top and no higher (lavaTop, note 592).
  const reach = swimReach(feet, lavaTop(bot));
  const high = c => c.y > reach ? 8 : 0;
  const cost = c => far(c) + (water ? lavaBy(c) : 0) + edge(c) + high(c);
  const best = cells.sort((a, b) => cost(a) - cost(b))[0] || null;
  // The way to it, for the walk and its seconds.
  if (best && routed(best)) { best.route = routeOf(routes, best); best.blocks = routed(best).blocks; }
  return best;
}

// A fight is not taken with a drop beside the bot: one hit's knockback on
// a Nether ledge was a thirty-block fall, twice in ten minutes. Beside a
// drop means a neighbouring cell the body could be pushed into with no
// floor for three blocks under it, or lava under it.
const { besideDrop, dropWithin, KNOCKBACK } = require('./terrain');
// The encounter rules' own bunker, when Jev cannot be asked: three seconds
// of digging under fire the most it is worth. Jev is told the seconds.
const BUNKER_DIG_MS = 3000;
const heavyHitters = (danger, radius) => danger.filter(t => KNOCKBACK.has(t.entity.name) && t.distance <= radius);
// What is left once the pickaxes carried wear out: how many more stone ones
// the sticks, wood and cobblestone carried make, and what the climb out is
// by hand without one. mid-244-k night-mined six pickaxes down to none, one
// stick and no wood left, and dug seventy blocks up by hand, forty-six
// minutes of its three hours (2026-09-27).
function pickaxeReserve(bot, feet) {
  const n = name => bot.inventory.items().filter(i => i.name === name || (name === 'log' && /_log$/.test(i.name)) || (name === 'planks' && /_planks$/.test(i.name))).reduce((t, i) => t + i.count, 0);
  const sticks = n('stick') + 2 * n('planks') + 8 * n('log');
  const stone = ['cobblestone', 'cobbled_deepslate', 'blackstone'].reduce((t, m) => t + n(m), 0);
  const table = n('crafting_table') > 0 || n('planks') + 4 * n('log') >= 4;
  const more = table ? Math.min(Math.floor(sticks / 2), Math.floor(stone / 3)) : 0;
  const up = require('./surface').climbToSurface(bot, feet);
  return { stonePickaxesMakeable: more, sticksAvailable: sticks, ...(up ? { blocksToOpenSky: up, climbOutByHandMinutes: Math.round(up * 3 * 7.5 / 60) } : {}) };
}

// A mob that bites within arm's length, in sight or not: no sealing it out.
// What a warden does, said wherever a wall is weighed against one: it
// hunts by the vibration of moving, digging and placing, and by smell, each
// sniff angering it more; angry at a player it cannot reach, it strikes
// with a sonic boom through blocks and armour. mid-230-n stayed in a pocket
// two minutes with a warden seven to eleven blocks off, told only that it
// was outside, and was boomed through the wall three times, twenty health
// to none (2026-09-27).
// The 26.1.2 jar (SonicBoom): 10 damage scaled by difficulty ("scaling":
// "always": 6 on Easy, 15 on Hard), past armour and its enchantments (the
// bypasses_armor and bypasses_enchantments tags), released 34 ticks into a
// 60-tick charge with 40 ticks' cooldown after, so one about every five
// seconds. At the health the bot has, the booms that end it are said (note
// 554: "healing from 10 health" stood beside a boom of 10, and a stay in
// reach of it was chosen as if the wait came out even).
const BOOM_ACROSS = 15, BOOM_UP = 20;
const BOOM_DAMAGE = { easy: 6, normal: 10, hard: 15 };
function wardenSays(bot) {
  const warden = threats(bot, 32).filter(t => t.entity.name === 'warden').sort((a, b) => a.distance - b.distance)[0];
  const booms = (bot._sonicBooms || []).filter(t => Date.now() - t < 60000).length;
  if (!warden && !booms) return '';
  const p = bot.entity.position, w = warden?.entity.position;
  const inReach = w && Math.hypot(w.x - p.x, w.z - p.z) <= BOOM_ACROSS && Math.abs(w.y - p.y) <= BOOM_UP;
  const damage = BOOM_DAMAGE[bot.game?.difficulty] || BOOM_DAMAGE.normal;
  const facts = ` A warden is blind: it finds a player by the vibrations of moving, digging and placing, and by smell, and each sniff angers it more. Angry at a player it cannot reach, it strikes with a sonic boom that passes through blocks and armour: about ${damage} damage, about every five seconds, within ${BOOM_ACROSS} blocks across and ${BOOM_UP} up or down. A wall does not stop it; only distance does.`;
  const here = warden ? ` The warden is ${Math.round(warden.distance)} blocks off, ${inReach ? 'within the boom\'s reach' : 'beyond the boom\'s reach'}.` : '';
  const hit = booms ? ` The bot has been hit by the boom ${booms === 1 ? 'once' : `${booms} times`} in the last minute.` : '';
  const hp = Math.round(bot.health ?? 20), toEnd = Math.max(1, Math.ceil(hp / damage));
  const ends = inReach || booms ? ` At ${hp} health, ${toEnd === 1 ? 'one boom ends it, whatever heals before it' : `${toEnd} booms end it, the last about ${(toEnd - 1) * 5} seconds after the first, less what heals between them`}.` : '';
  return facts + here + hit + ends;
}
// A mob spawner within its reach of the bot: it makes more of its mob
// while a player is within sixteen blocks, so a fight beside it, or a wait
// for its mobs to lose interest, does not end there.
// The bot's own effects that bear on a fight, said as facts.
function effectsSay(bot) {
  const effects = bot.entity?.effects || {};
  const byId = id => (bot.registry?.effects?.[id]?.name || bot.registry?.effectsArray?.find(e => e.id === Number(id))?.name || '').toLowerCase();
  const out = [];
  const { effectLeft, POISON } = require('./combat-estimate');
  for (const [id, e] of Object.entries(effects)) {
    // What is left now, not the length the server sent: mid-243-f was told
    // "about 7 seconds left" two seconds after the bite that gave it seven.
    const name = byId(id), running = effectLeft(bot, name);
    const secs = running ? Math.round(running.seconds) : Number.isFinite(e?.duration) ? Math.round(e.duration / 20) : null;
    const left = secs ? `, about ${secs} seconds left` : '';
    // Its rate, what is left of it and where it stops: "about one health a
    // second or so" priced nothing, and mid-243-f fought cave spiders at
    // 6.1 health told 0.4 damage while the poison took it to 0.23 (note 542).
    if (name === 'poison') {
      const every = Math.max(1, 25 >> (e?.amplifier || 0)) / 20;
      const ticks = running ? Math.floor(running.seconds / every) : secs ? Math.floor(secs / every) : null;
      const more = ticks != null && Number.isFinite(bot.health) ? Math.min(ticks, Math.max(0, Math.ceil(bot.health - POISON.floor))) : ticks;
      out.push(`The bot is poisoned${left}: one health every ${every} seconds that armour does not stop${more != null ? `, about ${more} more before it ends` : ''}, whatever is chosen; it takes a point only while health is above 1, so on its own it leaves the bot at 1 or just under and never kills, but a bite, a hit or a harming potion after it does. Each bite from a cave spider sets it back to seven seconds (a bee's sting ten, a bogged's arrow five). Health still comes back beside it at eighteen hunger or more, but a point each four seconds does not keep up (only at full hunger with saturation to spend, up to a point each half second, does it).`);
    }
    // With its rate and what is left of it: "it takes health" priced
    // nothing, and mid-235-p-fortress-7 fought a wither skeleton on at
    // 15.5 and withered on to 4.2 (note 528). One every forty ticks at
    // level I, halved each level up; armour does not stop it.
    else if (name === 'wither') {
      const every = Math.max(1, 40 >> (e?.amplifier || 0)) / 20;
      const more = secs ? Math.floor(secs / every) : null;
      out.push(`The bot is withering${left}: about one health every ${every === 1 ? 'second' : `${every} seconds`} that armour does not stop${more ? `, about ${more} more before it ends` : ''}, and it can take the last; each hit from a wither skeleton sets it back to ten seconds.`);
    }
    else if (name === 'slowness') out.push(`The bot is slowed${left}: a run covers less ground.`);
    else if (name === 'regeneration') out.push(`The bot is regenerating${left}.`);
    else if (name === 'weakness') out.push(`The bot is weakened${left}: its hits do less.`);
  }
  // The fire on the bot, with what is left of it (combat-estimate burnLeft):
  // counted in every stance's figures (note 548).
  const { burnLeft, burnSays } = require('./combat-estimate');
  const burning = burnLeft(bot);
  if (burning > 0) out.push(burnSays(burning));
  return out.length ? ' ' + out.join(' ') : '';
}
// Shooters that fire from farther than the mobs a stance weighs, in sight
// and in their own reach (a blaze's forty-eight, a ghast's sixty-four),
// said with what one shot that lands costs at this health. Not priced as
// the near ones are: a blaze's aim scatters with the distance. mid-235-p-
// fortress-7 was asked its stance at 4.2 health against a ghast at 61, a
// blaze at 48 in sight and unsaid; the blaze's fireball landed a second
// later, 4.2 to 1.7, and the fire it set burned the rest (note 528).
function fartherShootersSay(bot, danger) {
  const { MOBS, afterArmour, armourOf, fireballHit, volleyHit } = require('./combat-estimate');
  const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory?.slots?.[slot]?.name).filter(Boolean));
  const hp = Math.round((bot.health ?? 20) * 10) / 10;
  let far = [];
  try { far = threats(bot, 64).filter(t => t.visible && RANGE[t.entity.name] && t.distance <= RANGE[t.entity.name] && !danger.some(d => d.entity?.id === t.entity.id)); } catch (_) { far = []; }
  const said = far.slice(0, 3).map(t => {
    const name = t.entity.name.replaceAll('_', ' '), d = Math.round(t.distance), m = MOBS[t.entity.name] || {};
    const hit = Math.round(afterArmour(m.hit || 0, worn) * 10) / 10, burn = t.entity.name === 'blaze' ? 5 * (m.burns || 0) : 0;
    const chance = t.entity.name === 'blaze' ? `, each of its fireballs landing about ${Math.round(fireballHit(d) * 100)} in 100 from there and a volley of three at least one about ${Math.round(volleyHit(d) * 100)} in 100 (a volley about every nine seconds)` : '';
    const costs = `one that lands is about ${hit}${burn ? ` and ${burn} burn over the five seconds after` : ''}`;
    return `a ${name} ${d} blocks off has the bot in sight and fires from as far as ${RANGE[t.entity.name]}${chance}; ${costs}, ${hit + burn >= hp ? `more than the ${hp} health there is` : `from ${hp} health`}`;
  });
  return said.length ? { says: ` Farther off, not in the figures above: ${said.join('; ')}.`, list: far.slice(0, 3).map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`) } : null;
}
const SPAWNER_REACH = 16;
function spawnerAbout(bot) {
  const id = bot.registry?.blocksByName?.spawner?.id;
  if (id === undefined || typeof bot.findBlocks !== 'function') return null;
  const p = bot.findBlocks({ matching: id, maxDistance: SPAWNER_REACH, count: 1 })[0];
  if (!p) return null;
  const distance = Math.round(p.distanceTo(bot.entity.position));
  const mob = spawnerMob(bot, p), kind = mob ? mob.replaceAll('_', ' ') : null;
  const many = kind ? `${kind}${/s$/.test(kind) ? '' : 's'}` : 'of its mob';
  return { at: p, distance, ...(mob ? { mob } : {}), says: ` A ${kind ? `${kind} ` : 'mob '}spawner is ${distance} blocks off: while a player is within ${SPAWNER_REACH} blocks of it, it makes more ${many}, up to four at a time every ten to forty seconds, so the mobs here do not run out and do not lose interest while the bot stays within that. Beyond ${SPAWNER_REACH} blocks of it no more come; broken with a pickaxe, it makes no more.` };
}
// The mob a spawner makes, from its block entity as the server sends it
// (SpawnData): mid-243-f fought cave spiders seven blocks from one told
// only "a mob spawner" (note 542). Null where it was not sent.
function spawnerMob(bot, at) {
  try {
    const e = bot.blockAt?.(at)?.blockEntity;
    const id = e?.SpawnData?.entity?.id ?? e?.SpawnData?.id ?? e?.SpawnPotentials?.[0]?.data?.entity?.id;
    return typeof id === 'string' && id ? id.replace(/^minecraft:/, '') : null;
  } catch (_) { return null; }
}
// What is known of a place that keeps making mobs, said to the choices that
// decide whether the bot stays there, not only to the fight: a spawner in
// reach, a dungeon or mineshaft remembered near, and the mobs met and the
// hits taken within sixteen blocks in the last fifteen minutes. mid-220-g
// mined gravel for one flint nineteen blocks from a dungeon it knew, in a
// mineshaft, for eighteen minutes, sealed itself in about sixty times, and
// was shot by a skeleton; the pocket's stay and leave, the night mine's
// target and the work's source never said where it was (note 476).
const MOB_PLACE_REACH = 16, MOB_PLACE_MS = 15 * 60000, STRUCTURE_REACH = 24;
function mobSourceAbout(bot, goal, { at = bot.entity?.position, places, of = 'here' } = {}) {
  if (!at) return null;
  const here = new Vec3(at.x, at.y, at.z);
  const id = bot.registry?.blocksByName?.spawner?.id;
  const found = id !== undefined && typeof bot.findBlocks === 'function' ? bot.findBlocks({ matching: [id], maxDistance: SPAWNER_REACH, count: 1, point: here })[0] : null;
  const spawner = found && found.distanceTo(here) <= SPAWNER_REACH + 1 && bot.blockAt?.(found)?.name === 'spawner' ? { at: found, distance: Math.round(found.distanceTo(here)), mob: spawnerMob(bot, found) } : null;
  const where = String(bot.game?.dimension || 'overworld').replace(/^minecraft:/, '').replace(/^the_/, '');
  const structures = (goal?.landmarks || bot._survivalGoal?.landmarks || [])
    .filter(l => ['dungeon', 'mineshaft'].includes(l.kind) && (l.dimension || 'overworld') === where)
    .map(l => ({ kind: l.kind, at: new Vec3(l.x, l.y ?? here.y, l.z), distance: Math.round(Math.hypot(l.x - here.x, (l.y ?? here.y) - here.y, l.z - here.z)) }))
    .filter(l => l.distance <= STRUCTURE_REACH).sort((a, b) => a.distance - b.distance);
  const now = Date.now(), near = e => now - e.at < MOB_PLACE_MS && Math.hypot(e.x - here.x, e.y - here.y, e.z - here.z) <= MOB_PLACE_REACH;
  const hurts = (bot._hurtPlaces || []).filter(near).length;
  const seen = (places || bot._survivalState?.mobPlaces || goal?.survival?.mobPlaces || []).filter(near);
  const met = seen.filter(e => e.kind === 'encounter').length, sealed = seen.filter(e => e.kind === 'pocket').length;
  const parts = [];
  if (spawner) parts.push(`a ${spawner.mob ? spawner.mob.replaceAll('_', ' ') : 'mob'} spawner ${spawner.distance} blocks off: while a player is within ${SPAWNER_REACH} blocks of it, it makes more ${spawner.mob ? `${spawner.mob.replaceAll('_', ' ')}s` : 'of its mob'}, up to four at a time every ten to forty seconds, at any hour; its mobs do not leave at daylight, and under rock they do not burn. Beyond ${SPAWNER_REACH} blocks of it no more come; broken with a pickaxe, it makes no more`);
  for (const s of structures.slice(0, 2)) parts.push(s.kind === 'dungeon'
    ? `a dungeon remembered ${s.distance} blocks off: a room round a mob spawner, which makes more of its mob while a player is within ${SPAWNER_REACH} blocks of it, at any hour, until it is broken`
    : `a mineshaft remembered ${s.distance} blocks off: dark corridors where mobs spawn at any hour, often with a cave spider spawner in them`);
  const history = [hurts && `hurt by mobs ${hurts} time${hurts === 1 ? '' : 's'}`, met && `met mobs ${met} time${met === 1 ? '' : 's'}`, sealed && `sealed in a pocket with mobs watching ${sealed} time${sealed === 1 ? '' : 's'}`].filter(Boolean);
  if (history.length) parts.push(`within ${MOB_PLACE_REACH} blocks of ${of} in the last ${MOB_PLACE_MS / 60000} minutes the bot has been ${history.join(', ')}`);
  if (!parts.length) return null;
  const daylight = spawner || structures.length ? ' Daylight does not end this: underground it is as dark at noon, and a spawner\'s mobs do not leave at dawn; going farther than that from it does.' : '';
  return { spawner, structures, hurts, met, sealed, says: ` About this place: ${parts.join('; ')}.${daylight}`,
    state: { ...(spawner ? { spawnerBlocksAway: spawner.distance } : {}), ...(structures.length ? { remembered: structures.map(s => ({ kind: s.kind, blocksAway: s.distance })) } : {}),
      lastFifteenMinutesWithin16: { hurtByMobs: hurts, mobEncounters: met, pocketsWatched: sealed } } };
}
const biterAtArm = bot => threats(bot).some(t => t.distance <= 2.2 && !shooter(t.entity));

function firmGround(bot, radius = 4, { margin = 1, awayFrom = null } = {}) {
  const feet = feetCell(bot), cells = [];
  // Farther from a mob than now by two blocks at least (a creeper coming).
  const gains = c => !awayFrom || c.offset(0.5, 0, 0.5).distanceTo(awayFrom) >= bot.entity.position.distanceTo(awayFrom) + 2;
  const open = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water|powder_snow/.test(b.name); };
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
    const c = feet.offset(dx, dy, dz);
    const floor = bot.blockAt(c.offset(0, -1, 0));
    if (floor?.boundingBox !== 'block' || /magma/.test(floor.name) || !open(c) || !open(c.offset(0, 1, 0)) || (margin > 1 ? dropWithin(bot, c, margin) : besideDrop(bot, c)) || lavaBeside(bot, c) || !gains(c)) continue;
    cells.push(c);
  }
  const far = c => c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position);
  return cells.sort((a, b) => far(a) - far(b))[0] || null;
}

// Hostiles that daylight does not remove and that keep following.
const PERSISTENT_THREATS = new Set(['creeper', 'spider', 'cave_spider', 'enderman', 'witch', 'pillager', 'vindicator', 'husk', 'drowned']);
// Mobs worth hiding from rather than meeting. A wither skeleton carries a
// sword: the arena's first drill had the bot wall itself in against one and
// take fourteen damage through the doorway instead of four swings and done.
// A piglin only shoots when it is holding a crossbow, which `shooter` knows.
const shoots = threat => shooter(threat.entity);
// Ground to run to. It was the overworld's surface only, so in the Nether
// no retreat and no step back from a lava edge could find anywhere to
// stand, and every flee there fell straight through to sealing in. Magma is
// left out: it burns whoever stands on it.
const ESCAPE_FOOTING = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'stone', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite',
  'sand', 'red_sand', 'gravel', 'cobblestone', 'cobbled_deepslate', 'sandstone', 'terracotta',
  'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'smooth_basalt', 'blackstone', 'nether_bricks', 'crimson_nylium', 'warped_nylium',
  'end_stone', 'obsidian',
  // A bastion's own floors (note 576): mid-242-ae-nether-1 stood on
  // polished blackstone bricks among its piglins, and no run could find
  // anywhere to stand on them.
  'polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', 'polished_blackstone', 'chiseled_polished_blackstone', 'gilded_blackstone', 'polished_basalt'];
const shelterNeeded = bot => bot.game.difficulty !== 'peaceful' && bot.game.dimension === 'overworld' &&
  bot.time?.timeOfDay >= DAY.DUSK && bot.time.timeOfDay < DAY.DAWN;
// The server lets a player sleep from 12541 until 23458; with the only
// survival player in bed the night passes in a hundred ticks.
const { SLEEP_FROM, SLEEP_UNTIL } = DAY;
// Whether a failed sleep is still being waited out. Older saved state has
// only the time of the failure, which waits the full ten minutes.
const sleepWaiting = holder => isSetAside(holder, 'sleep', 'bed');
// Real minutes until dawn: what a night waited out costs the run.
const minutesToDawn = bot => Math.round(((DAY.DAWN - (bot.time?.timeOfDay ?? 0) + 24000) % 24000) / 1200);
// The work a night plan leaves waiting, in words: the ladder's step, else
// the step in hand. The night's ways said their own minutes and never what
// they held up, and mid-220-h and mid-226-g spent a third of three hours on
// nights, the portal work twenty to forty minutes (note 531).
function workWaiting(goal, bot = null) {
  const phase = goal?.rungTime?.phase || goal?.gameProgress?.phase;
  // The portal's state, what the work still needs, beside the step's name.
  if (phase === 'reach_nether' && bot?.entity?.position && typeof bot.blockAt === 'function') {
    const here = bot.entity.position, far = p => Math.round(here.distanceTo(new Vec3(p.x, p.y, p.z)));
    const frame = goal.portalFrame, way = goal.portalMethod?.kind, near = goal.portalMethod?.near;
    const placed = frame ? frame.blocks.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === 'obsidian').length : 0;
    const parts = [frame ? `${placed} of the frame's ten obsidian in, the frame ${far(frame.origin)} blocks off` : 'no frame begun',
      way === 'cast' ? 'to be cast from lava and water' : way === 'build' ? 'from ten obsidian mined' : way === 'ruin' ? 'a ruined portal to finish' : null,
      near ? `the lava chosen ${far(near)} blocks off` : null].filter(Boolean);
    return `the reach nether step (the portal: ${parts.join('; ')})`;
  }
  if (phase && phase !== 'complete') return `the ${phase.replaceAll('_', ' ')} step`;
  const step = goal?.step;
  const what = step?.item || step?.block || (step?.action && !['game_progression', 'stay_below'].includes(step.action) ? step.action : null);
  return what ? `the work on ${String(what).replaceAll('_', ' ')}` : goal?.request ? 'the request' : null;
}
// Underground the night is the dark the bot works in all day: mobs spawn
// by light, not by the hour, so nightfall changes nothing below; only the
// surface turns dangerous, until dawn burns its zombies and skeletons.
const BELOW_NIGHT = 'Underground the dark is the same at any hour: mobs spawn wherever the light is low, by day as by night, and nightfall changes nothing down here.';
// Said at night only: by day it had told a bot underground at 2000 that the
// surface "is night, with its mobs, until dawn" (the prompt audit, note 677).
const BELOW_NIGHT_SURFACE = ' Only the surface is night, with its mobs, until dawn.';
// A sealed wait for daylight, when health does not come back: in the
// Overworld, hurt, under eighteen hunger. Its price is the minutes to dawn
// (by day, through dusk and the whole night) and about no hunger, standing
// still; null when it is no wait of that kind (note 515).
function sealedWaitSays(bot) {
  if (bot.game?.dimension !== 'overworld' || bot.game?.difficulty === 'peaceful' || (bot.health ?? 20) >= 20 || (bot.food ?? 20) >= 18) return null;
  const t = bot.time?.timeOfDay ?? 0, ticks = (DAY.DAWN - t + 24000) % 24000, minutes = Math.round(ticks / 1200);
  const day = t >= DAY.DAWN || t < DAY.DUSK;
  return { ticks, minutes, says: `Seal a pocket (the way is asked next) and wait in it for daylight, about ${minutes} real minutes off${day ? `: it is day now, so the wait runs through dusk and the whole night, and daylight is what the bot already has` : ''}. ${Math.round(bot.health * 10) / 10} health, which does not come back meanwhile (hunger ${bot.food}, below eighteen), and standing still in it spends no hunger: it falls with moving, mining, fighting and healing, so the wait costs minutes, not food. At dawn the mobs in the open burn; eating to eighteen ends the wait, health coming back.` };
}
// The cap over a shaft pocket (shaftPocket puts it two over the floor):
// the block its way out is dug through. Null when the column over the head
// holds nothing solid to dig, or a liquid or a falling block sits on it.
function shaftCap(bot, refuge) {
  const cap = pos(refuge.origin).offset(0, 2, 0);
  if (!shelter.solid(bot.blockAt(cap))) return null;
  const over = bot.blockAt(cap.offset(0, 1, 0))?.name || '';
  if (/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$|concrete_powder|water|lava/.test(over)) return null;
  return cap;
}
// A pocket shut to walkers but not whole (shelter.js closedIn), said.
const pocketOpenSays = open => `shut to walkers, but ${open.length} cell${open.length === 1 ? '' : 's'} of its shell ${open.length === 1 ? 'holds' : 'hold'} ${[...new Set(open.map(c => c.name))].join(' and ')}, which no block goes into (${open.slice(0, 3).map(c => `${c.x}, ${c.y}, ${c.z}`).join('; ')})`;
// A pocket being sealed where the bot stands, as its last pass left it: the
// blocks of it in place, and a mob standing in a cell of it, which no block
// goes into while it stands there. Said on the claim and the stance, not
// retried: mid-226-h's seal went at the cell a skeleton stood in forty times
// in forty seconds, two blocks placed, the skeleton shooting it from 17.1 to
// none at 1.6 blocks, and nothing said the pocket would not close (note 520).
function sealingSays(bot, state, now = Date.now()) {
  const s = state?.sealing;
  if (!s || now - s.at > 20000 || !bot.entity?.position || pos(s.origin).distanceTo(feetCell(bot)) > 1) return null;
  const refuge = { origin: s.origin, dimension: bot.game?.dimension };
  const of = shelter.enclosure(refuge).length, placed = of - shelter.missingShell(bot, refuge).length;
  const { occupant } = require('./work');
  const inCells = shelter.missingShell(bot, refuge).map(p => ({ p, body: occupant(bot, p) })).filter(c => c.body);
  // One mob two blocks tall stands in two cells of a wall: said once.
  const bodies = [...new Set(inCells.map(c => c.body))];
  const mobs = bodies.map(body => { const cells = inCells.filter(c => c.body === body).map(c => `${c.p}`);
    return `a ${(body.username || body.name || 'mob').replaceAll('_', ' ')} stands in the cell${cells.length > 1 ? 's' : ''} at ${cells.join(' and ')}`; });
  return { placed, of, ...(inCells.length ? { mobInCells: inCells.map(({ p, body }) => ({ name: body.name, cell: { x: p.x, y: p.y, z: p.z } })) } : {}),
    says: `The pocket here is ${placed} of ${of} blocks${mobs.length ? `; ${mobs.join(', ')}, and no block goes where a body is, so it does not close while ${bodies.length > 1 ? 'they stay' : 'it stays'} there` : ''}.` };
}
const sleepable = bot => bot.time?.timeOfDay >= SLEEP_FROM && bot.time.timeOfDay <= SLEEP_UNTIL;
// Three cells in a line: where the bot stands, the bed's foot, its head.
// Level floor under both bed cells, air at feet and head height.
// The bed at the base, when it stands and is within a short walk: the
// first night of run two was spent walled in two blocks from it.
// Within a short walk means within a hundred and sixty blocks: the second
// run walled itself in thirty blocks from its bed because the bed was out of
// view. (A hundred at first; the base's pond and plot pulled the working
// radius out to a hundred and sixty.)
// A bed remembered as claimed counts while its chunk is unloaded; a bed
// seen to be gone does not.
// The walk home to bed: a long one at dusk, a short one once the night has
// come. Dark already, the clean run walked a hundred and thirty blocks to
// its bed through the mobs, arrived at three health with a skeleton, a
// spider and a spear-carrying zombie beside it, could not sleep, and died
// there twice (2026-09-24 00:48).
const HOME_BED_WALK = 160, NIGHT_BED_WALK = 48;
const darkNow = bot => { const t = bot.time?.timeOfDay ?? 0; return t >= 13000 && t < 23000; };
function nearbyHomeBed(bot, goal) {
  const home = homeOf(bot, goal);
  if (!home?.bed?.claimedAt) return null;
  const { bed } = layout(home);
  const foot = pos(bed.foot), block = bot.blockAt(foot);
  if (foot.distanceTo(bot.entity.position) > (darkNow(bot) ? NIGHT_BED_WALK : HOME_BED_WALK) || (block && !isBed(block))) return null;
  return { foot, head: pos(bed.head), stand: pos(bed.stand), placed: true };
}
// Any bed in view, not only our own: the live run sealed itself into a
// pocket, then mined out of it, with a village bed a few blocks off,
// because the only beds it knew were one carried and one at a base four
// hundred blocks away. Overworld only (a bed anywhere else explodes), not
// one a villager is in, and with a cell beside it to stand in.
const FACING = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
function observedBed(bot) {
  if (!/overworld/.test(String(bot.game?.dimension || '')) || typeof bot.findBlocks !== 'function') return null;
  const ids = (bot.registry?.blocksArray || []).filter(b => /_bed$/.test(b.name)).map(b => b.id);
  if (!ids.length) return null;
  const here = bot.entity.position;
  const found = bot.findBlocks({ matching: ids, maxDistance: 48, count: 16 }).sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
  const standable = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' &&
    [0, 1].every(dy => { const b = bot.blockAt(p.offset(0, dy, 0)); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); });
  for (const p of found) {
    const block = bot.blockAt(p);
    if (!isBed(block)) continue;
    const props = block.getProperties?.() || {};
    if (props.part === 'head' || props.occupied === true || props.occupied === 'true') continue;
    const [dx, dz] = FACING[props.facing] || [0, 0];
    const head = p.offset(dx, 0, dz);
    const stand = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z]) => p.offset(x, 0, z)).find(c => !c.equals(head) && standable(c));
    if (stand) return { foot: p, head, stand, placed: true, observed: true };
  }
  return null;
}
const bedToSleepIn = (bot, goal) => nearbyHomeBed(bot, goal) || observedBed(bot);

function bedSite(bot) {
  const feet = feetCell(bot);
  const floor = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
  const free = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const foot = feet.offset(dx, 0, dz), head = feet.offset(2 * dx, 0, 2 * dz);
    if ([foot, head].every(p => floor(p) && free(p) && free(p.offset(0, 1, 0)))) return { stand: feet, foot, head };
  }
  return null;
}
// Two level cells for the bed within a few blocks, with a cell beside them
// to stand in: from a pocket, out past its walls (sleep_beside).
function bedSiteNear(bot, radius = 4) {
  const here = feetCell(bot);
  const floor = p => bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block';
  const free = p => { const b = bot.blockAt(p); return !!b && b.boundingBox === 'empty' && !/water|lava/.test(b.name); };
  const room = p => floor(p) && free(p) && free(p.offset(0, 1, 0));
  const sites = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 1; dy++) {
    const stand = here.offset(dx, dy, dz);
    if ((Math.abs(dx) <= 1 && Math.abs(dz) <= 1) || !room(stand)) continue;
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const foot = stand.offset(ax, 0, az), head = stand.offset(2 * ax, 0, 2 * az);
      if (room(foot) && room(head)) sites.push({ stand, foot, head });
    }
  }
  return sites.sort((a, b) => a.stand.distanceTo(here) - b.stand.distanceTo(here))[0] || null;
}
// A bed nook: where no two level cells lie beside the feet (a staircase, a
// shaft, a one-by-two pocket), the two are dug out of the rock as a player
// does underground, the foot beside the bot and the head past it, each with
// the floor under it kept and the cell above it cleared: a bed needs air
// over it. The one carried bed that did go down in the six midgame trials
// of 2026-09-26 found no level cells in a staircase or a pocket, and the
// bot sealed itself in eleven times with it on its back.
// Nothing that falls over the nook, no liquid beside it, and nothing dug
// that is kept (a bed, a chest, a spawner, construction). Closed in rock
// all round (the bot's own two cells aside) is said, and is required from
// a sealed pocket: the pocket stays shut. `shell` counts cells a pocket
// about to be sealed will fill as solid.
const NOOK_KEEP = /bed$|chest|furnace|crafting_table|spawner|obsidian|bedrock|portal|barrel|shulker|amethyst/;
const FALLS = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|pointed_dripstone|[a-z_]*anvil)$/;
const WET = /water|lava|bubble_column/;
const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function bedNook(bot, goal = {}, { sealed = false, shell = [] } = {}) {
  if (!bot.entity?.position || typeof bot.blockAt !== 'function') return null;
  const feet = feetCell(bot), filled = new Set(shell.map(String));
  const open = b => !!b && b.boundingBox === 'empty' && !WET.test(b.name) && !/cobweb|fire/.test(b.name);
  const found = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const foot = feet.offset(dx, 0, dz), head = feet.offset(2 * dx, 0, 2 * dz);
    const cells = [foot, foot.offset(0, 1, 0), head, head.offset(0, 1, 0)];
    if (![foot, head].every(p => { const floor = bot.blockAt(p.offset(0, -1, 0)); return floor?.boundingBox === 'block' && !/magma/.test(floor.name); })) continue;
    const dig = [];
    let ok = true;
    for (const c of cells) {
      const b = bot.blockAt(c);
      if (open(b)) continue;
      if (!b || b.boundingBox !== 'block' || !b.diggable || NOOK_KEEP.test(b.name) || reservedForConstruction(goal, c, { from: feet })) { ok = false; break; }
      dig.push(c);
    }
    if (!ok) continue;
    if ([foot, head].some(p => FALLS.test(bot.blockAt(p.offset(0, 2, 0))?.name || ''))) continue;
    if (cells.some(c => AROUND.some(([x, y, z]) => WET.test(bot.blockAt(c.offset(x, y, z))?.name || '')))) continue;
    const own = new Set([...cells, feet, feet.offset(0, 1, 0)].map(String));
    const enclosed = cells.every(c => AROUND.every(([x, y, z]) => { const n = c.offset(x, y, z); return own.has(`${n}`) || filled.has(`${n}`) || bot.blockAt(n)?.boundingBox === 'block'; }));
    if (sealed && !enclosed) continue;
    found.push({ stand: feet, foot, head, dig, enclosed });
  }
  return found.sort((a, b) => (b.enclosed - a.enclosed) || a.dig.length - b.dig.length)[0] || null;
}
// Sleep is refused while a monster is within eight blocks of the bed and
// five up or down (vanilla), seen or not: counted the one way for every
// bed option (the decision audit).
const monstersByBed = (bot, foot, radius = 48) => threats(bot, radius).filter(t => t.entity.position.distanceTo(foot) <= 8 && Math.abs(t.entity.position.y - foot.y) <= 5).length;
// Who they are and how far, for the fact on a bed option: "a spider 2 blocks
// off means the server will refuse the sleep" (mid-243-bg, 2026-09-28: the
// bed went down with a spider at two blocks and was left standing).
const monstersAtBed = (bot, foot, radius = 48) => threats(bot, radius).filter(t => t.entity.position.distanceTo(foot) <= 8 && Math.abs(t.entity.position.y - foot.y) <= 5);
const refusalSays = (bot, foot) => {
  const near = monstersAtBed(bot, foot);
  if (!near.length) return '';
  const who = near.slice(0, 4).map(t => `a ${String(t.entity.name).replaceAll('_', ' ')} ${Math.round(t.entity.position.distanceTo(foot))} blocks off${t.visible ? '' : ' (out of sight)'}`);
  return ` ${near.length} monster${near.length === 1 ? ' is' : 's are'} within eight blocks sideways and five up or down of the bed now, seen or not: sleep is refused while any are. ${who.join(', ').replace(/^a/, 'A')}${near.length > 4 ? ` and ${near.length - 4} more` : ''}: the server will refuse the sleep, and the bed would be put down and picked up for nothing.`;
};
// A task that only the owner's stop can end is not this: cleanup of what the
// bot itself put down runs to its end whatever the threat layer preempts.
const uncancellable = task => ({ get cancelled() { return false; }, label: task?.label, check() {} });
// What a bed nook is, said the one way wherever it is offered.
function nookSays(bot, nook, { pocket = false, later = false } = {}) {
  const n = nook.dig.length, near = monstersByBed(bot, nook.foot);
  const where = pocket ? 'out of the pocket\'s wall' : 'beside the bot';
  const closed = nook.enclosed ? `, closed in rock all round${pocket ? ' so the pocket stays shut' : ''}` : ', open to the air on a side';
  const wait = later ? ` Bedtime is from ${SLEEP_FROM}, about ${Math.max(0, Math.round((SLEEP_FROM - (bot.time?.timeOfDay ?? 0)) / 20))} seconds off.` : '';
  return `dig a bed nook ${where}, the two cells in a line where the bed goes (foot and head), ${n ? `${n} block${n === 1 ? '' : 's'} to dig` : 'nothing to dig'} and the floor under them kept${closed}; put the carried bed in it and sleep. The night passes in seconds, instead of about ${minutesToDawn(bot)} real minutes ${pocket ? 'in the pocket' : 'in a pocket or a night mine'}; the bed is picked back up after.${wait} Sleep is refused while a monster is within about eight blocks sideways and five up or down of the bed (vanilla), seen or not: ${near ? `${near} ${near === 1 ? 'is' : 'are'} now` : 'none now'}.`;
}
const emptySite = (bot, refuge) => refuge.kind !== 'house' && !refuge.verifiedAt &&
  shelter.shell(refuge.origin).every(p => shelter.replaceable(bot.blockAt(p)));

// Encounter stances are Jev's; JEV_ENCOUNTERS=0 hands them to the rules.
// A creeper within seven blocks: no pocket or bunker is begun, the blast
// comes before the last block.
// Night-mine tools: the uses left on a pickaxe, and the one the pockets
// can make now (iron before stone), with sticks or planks and a table carried.
const PICKAXE_SPARE_USES = 24;
// The uses the climb out takes: about two digs for every block of rock over
// the head, a staircase's step and its headroom, and a margin. Twenty-four
// was kept at any depth, and mid-87-a stopped mining forty blocks down with
// that many left, wore through them on the stairs and dug the last
// twenty-four blocks by hand, at two a minute (2026-09-25).
function usesToClimbOut(bot) {
  const feet = feetCell(bot);
  let top = feet.y;
  for (let y = feet.y + 2; y <= Math.min(feet.y + 200, 319); y++) {
    const b = bot.blockAt(new Vec3(feet.x, y, feet.z));
    if (!b) break;
    if (b.boundingBox === 'block') top = y;
  }
  return Math.max(PICKAXE_SPARE_USES, 2 * (top - feet.y) + 16);
}
function remainingUses(bot, item) {
  const max = bot.registry?.itemsByName?.[item.name]?.maxDurability;
  return max ? max - (item.durabilityUsed || 0) : Infinity;
}
function pickaxeCraftable(bot) {
  const has = name => countOf(bot, name);
  const planks = bot.inventory.items().filter(i => /_planks$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  const logs = bot.inventory.items().filter(i => /_log$/.test(i.name)).reduce((n, i) => n + i.count, 0);
  if (!(has('stick') >= 2 || planks >= 2 || logs >= 1) || !has('crafting_table')) return null;
  if (has('iron_ingot') >= 3) return 'iron_pickaxe';
  if (has('cobblestone') >= 3 || has('cobbled_deepslate') >= 3) return 'stone_pickaxe';
  return null;
}
// A creeper whose fuse is lit (its swell direction is 1).
function creeperSwelling(bot, entity) {
  const i = bot.registry?.entitiesByName?.creeper?.metadataKeys?.indexOf('swell_dir');
  return i >= 0 && entity.metadata?.[i] === 1;
}
// When each creeper's fuse was seen to light (its swell_dir metadata going
// to 1), watched as the server sends it: the dance is not asked while a
// stance question is out, and a hold at reach is only as good as the fuse
// it thinks is left.
function watchFuses(bot) {
  if (bot._creeperFuses) return bot._creeperFuses;
  const fuses = bot._creeperFuses = new Map();
  bot.on?.('entityUpdate', e => {
    if (e?.name !== 'creeper') return;
    if (creeperSwelling(bot, e)) { if (!fuses.has(e.id)) fuses.set(e.id, Date.now()); } else fuses.delete(e.id);
  });
  return fuses;
}
// How far the bot can back straight away from a creeper once it strikes,
// on its own level: the dance backs with the back key facing it, and a wall
// or a drop behind stops it where the blast still reaches (mid-241-a backed
// into a wall and the blast came three blocks off; mid-239-c stood in a
// hole with no cell open round it, and took the blast three blocks off,
// 14.9 through a helmet and a chestplate, where "15 at 3 blocks" was said
// beside a fight of "0 damage", note 529). Measured from where the bot
// stands, its body's edge (0.3) leading. None where the dance does not run
// (no blade, a drop or lava within two): there the fight stands and swings.
// And not toward another creeper: backing from one, mid-241-n backed four
// blocks toward a second three blocks below, down the drop onto its level,
// lit it passing and took its blast from 4.3 blocks, 16 to 10.9; both had
// been priced as going off six blocks off (note 534). The room ends a step
// before one that comes within three blocks of another creeper.
function backRoom(bot, entity) {
  const { BLAST_CLEAR, LIGHTS_AT } = require('./combat-estimate');
  const here = bot.entity.position, feet = here.floored();
  if (!/_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') || dropWithin(bot, feet, 2) || lavaBeside(bot, feet)) return 0;
  const dx = here.x - entity.position.x, dz = here.z - entity.position.z, len = Math.hypot(dx, dz) || 1;
  const max = BLAST_CLEAR - LIGHTS_AT;
  const others = Object.values(bot.entities || {}).filter(e => e !== entity && e.id !== entity.id && e.name === 'creeper' && e.position && e.isValid !== false && e.position.distanceTo(here) < 16);
  let room = 0;
  for (let d = 0.5; d <= max; d += 0.5) {
    const edge = d + 0.3;
    const at = new Vec3(Math.floor(here.x + dx / len * edge), feet.y, Math.floor(here.z + dz / len * edge));
    const b = bot.blockAt(at), head = bot.blockAt(at.offset(0, 1, 0)), floor = bot.blockAt(at.offset(0, -1, 0));
    if (!b || !head || !floor || b.boundingBox !== 'empty' || head.boundingBox !== 'empty' || floor.boundingBox !== 'block' || /lava/.test(b.name)) break;
    const body = new Vec3(here.x + dx / len * d, here.y, here.z + dz / len * d);
    if (others.some(o => o.position.distanceTo(body) < LIGHTS_AT && o.position.distanceTo(body) < o.position.distanceTo(here))) break;
    room = d;
  }
  return room;
}
// Where the dance's back-off ends, looked at as it backs (the same bounds
// backRoom prices): a step from a drop, or coming within three of a creeper
// other than the one it backs from and nearer it than when it began.
function backingEnds(bot, from, startedAt) {
  const { LIGHTS_AT } = require('./combat-estimate');
  const feet = feetCell(bot);
  if (dropWithin(bot, feet, 1) || lavaBeside(bot, feet)) return true;
  return Object.values(bot.entities || {}).some(e => e !== from && e.id !== from?.id && e.name === 'creeper' && e.position && e.isValid !== false &&
    e.position.distanceTo(bot.entity.position) < LIGHTS_AT && e.position.distanceTo(bot.entity.position) < (startedAt.get(e.id) ?? Infinity));
}
// Seconds since a creeper was seen to light, or undefined when it is not
// lit; lit where its lighting was not seen, half the fuse is taken as gone.
function creeperLitFor(bot, entity) {
  if (!entity || !creeperSwelling(bot, entity)) return undefined;
  const at = watchFuses(bot).get(entity.id);
  return at ? (Date.now() - at) / 1000 : require('./combat-estimate').FUSE / 2;
}
// How long a run's route search may stand the bot still with creepers
// about (creeper-run.js creepersFor): until the nearest coming on would be
// within three blocks at its walk, a quarter second short; one lit, or
// within three now, a moment (two or three searches). Without one, no end
// but the candidates' (note 604).
function searchBudget(bot, creepers) {
  if (!creepers?.length) return Infinity;
  const { LIGHTS_AT, blocksPerSecond } = require('./combat-estimate');
  const each = creepers.map(c => Number.isFinite(c.litFor) || c.distance < LIGHTS_AT ? 0.3 : Math.max(0.3, (c.distance - LIGHTS_AT) / blocksPerSecond('creeper') - 0.25));
  return Math.round(Math.min(...each) * 1000);
}
// Where a creeper's fuse stands when a meal eaten where the bot stands is
// done: lit by then, the seconds of it left and the blast there if the bot
// stays; gone off during it, that (note 604).
function creeperAfterMeal(bot, creepers) {
  if (!creepers?.length) return '';
  const { creeperOnWay } = require('./creeper-run');
  const { FUSE, FUSE_KEPT, afterArmour, armourOf, blocksPerSecond } = require('./combat-estimate');
  const here = bot.entity.position.clone(), way = [{ at: here, t: 0 }, { at: here, t: EAT_SECONDS }];
  const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
  const r1 = n => Math.round(n * 10) / 10;
  for (const c of creepers) {
    const w = creeperOnWay(bot, c.entity, way, { litFor: c.litFor, until: EAT_SECONDS + FUSE });
    if (w.lights == null || w.lights > EAT_SECONDS) continue;
    const name = `the creeper ${Math.round(c.distance)} blocks off`;
    const coming = w.lights > 0 ? `, coming on at about ${r1(blocksPerSecond('creeper'))} blocks a second, is within three about ${w.lights} seconds in and lights there` : ' is lit or within three now';
    if (w.goesOff && w.t <= EAT_SECONDS) return ` While it eats, ${name}${coming}, and goes off before the meal is done, about ${w.distance} blocks from the bot: about ${Math.round(afterArmour(w.blast, worn))} after the armour worn.`;
    const left = r1(Math.max(0, (w.goesOff ? w.t : w.lights + FUSE) - EAT_SECONDS));
    const hit = w.goesOff ? Math.round(afterArmour(w.blast, worn)) : 0;
    const blast = w.goesOff ? ` with the bot still there it goes off ${w.distance} blocks from it, about ${hit} after the armour worn${hit >= (bot.health ?? 20) ? ', more than the bot has' : ''},` : ' it goes off';
    return ` While it eats, ${name}${coming}: done eating, about ${left} seconds of its fuse are left, and${blast} unless the bot is more than ${FUSE_KEPT} blocks from it or out of its sight by then.`;
  }
  return '';
}
// A creeper's health as the server last sent it (undefined unread).
function creeperHealth(bot, entity) {
  const key = bot.registry?.entitiesByName?.creeper?.metadataKeys?.indexOf('health');
  const h = key >= 0 ? entity?.metadata?.[key] : undefined;
  return Number.isFinite(h) ? h : undefined;
}
// What the fight's price of a creeper reads from the world: the room to
// back into, its health, and how long it has been lit.
function creeperFacts(bot, entity) {
  const health = creeperHealth(bot, entity), litFor = creeperLitFor(bot, entity);
  return { backRoom: backRoom(bot, entity), ...(Number.isFinite(health) ? { health } : {}), ...(Number.isFinite(litFor) ? { litFor } : {}) };
}
const creeperClose = danger => danger.some(t => t.entity.name === 'creeper' && t.distance <= 7);
const encounterJudgments = survival => !!survival.client && process.env.JEV_ENCOUNTERS !== '0';

// Minecraft actions are injected to avoid a dependency cycle with the work
// executor. The state lives on the retained goal and can also be shared by an
// idle companion session. No survival interruption replaces the player request.
// A pocket is not begun where a creeper in sight would reach it and go off
// before it closed: its walk to lighting distance and its fuse against
// six tenths of a second a block. mid-79-g began twenty blocks with two
// creepers close (note 157); mid-92-u, followed half a minute by one, dug
// in with it eight blocks off and was blown up at full health (2026-09-26).
// The dance and the backing off answer a creeper; the pocket after.
function creeperRace(bot, blocks) {
  const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
  return threats(bot, 16).some(t => t.entity.name === 'creeper' && (t.visible || t.distance <= 5) &&
    blocks * BLOCK_SECONDS > Math.max(0, (t.distance - LIGHTS_AT) / APPROACH) + FUSE);
}

function creeperSays(bot) {
  const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
  const near = threats(bot, 16).filter(t => t.entity.name === 'creeper' && (t.visible || t.distance <= 5)).sort((a, b) => a.distance - b.distance)[0];
  if (!near) return '';
  const secs = Math.round((Math.max(0, (near.distance - LIGHTS_AT) / APPROACH) + FUSE) * 10) / 10;
  return ` A creeper is ${Math.round(near.distance)} blocks off: coming on, it could go off beside the bot in about ${secs} seconds; a shelter is walled or dug at about ${BLOCK_SECONDS} seconds a block.`;
}

class Survival {
  constructor(bot, actions, { state, client } = {}) {
    this.bot = bot; this.actions = actions; this.client = client;
    this.state = state || { shelters: [] };
    this.state.shelters ||= [];
    // The places mobs were met, for the work's choices too (mobSourceAbout).
    bot._survivalState = this.state;
    watchFuses(bot);
    // A shooter's warning asked about as it begins, and a shot in the air on
    // a line that hits met with the shield, whatever holds the turn
    // (shot-reflex.js, note 676). The latest layer's questions are asked.
    require('./shot-reflex').install(bot, this);
    // A blaze spawner's tries, seen as they come, for the lull's clock (note 691).
    require('./spawner-clock').watch(bot);
    if (encounterJudgments(this) || !bot._shotSurvival?.client) bot._shotSurvival = this;
    if (!bot._survivalHurtListener) {
      bot._survivalHurtListener = (entity, source) => {
        if (entity !== bot.entity) return;
        bot._recentHurtAt = Date.now();
        // Who did it, by kind: a neutral mob that hits the bot has turned.
        if (source?.name) (bot._hurtBy ||= {})[source.name] = Date.now();
        if (source?.id !== undefined) (bot._hurtById ||= {})[source.id] = Date.now();
        // Where a mob hurt it, for what is said of the place (mobSourceAbout).
        if (source?.name && ['hostile', 'mob'].includes(source.type) && bot.entity?.position) {
          const p = bot.entity.position;
          bot._hurtPlaces = [...(bot._hurtPlaces || []).filter(e => Date.now() - e.at < MOB_PLACE_MS), { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: Date.now(), by: source.name }].slice(-60);
        }
        // Hurt three times in fifteen seconds with no survival action at all
        // is a bug with no trace: the replay run was shot for forty-eight
        // seconds in the Nether and the record held nothing but its health.
        // Say what was going on, once in a while, so it can be found.
        const now = Date.now();
        bot._hurtTimes = [...(bot._hurtTimes || []).filter(t => now - t < 15000), now];
        // Hit twice in four seconds with no survival action in three: the
        // turn is held by a step that is not looking (a crafting window, a
        // dig, a walk). Trial 29's night mine stopped to craft a pickaxe at
        // y -9 and a zombie took it from twenty to nothing in seven seconds.
        // The walk, the dig and any window are stopped, and the step's next
        // check unwinds to the survival layer, where the stance is chosen.
        // Once, when a hostile mob landed it. A survival action counts only
        // if it answers the mobs: trial 57 was told to keep working, went
        // on digging stone by hand for its shelter, and was hit five times
        // before anything looked up (the arena replay of its ledge).
        const byMob = source && require('./danger').hostileEntities(bot, 8).includes(source);
        // A stance Jev chose is the answer while it holds: the watchdog threw
        // a retreat out at the first hit (it reports nothing as it runs), and
        // a pocket or a charge at the first hit three seconds after they
        // began. Leaving the mobs be is not an answer.
        // Not while standing in fire: no stance is carried out there, and
        // the way out comes first (vitals.js outOfFire). mid-229-g sealed a
        // pocket in a fire a ghast's fireball lit, from eleven health to
        // none, the watchdog giving way to the seal (2026-09-27).
        const held = require('./danger').stanceHeld(bot, now);
        const answering = held && held.choice !== 'keep_working' && !require('./vitals').inFire(bot);
        if (bot._hurtTimes.filter(t => now - t < 4000).length >= (byMob ? 1 : 2) && !answering && !(bot._threatResponseAt > now - 3000) && !(bot._threatAbortAt > now - 5000) && (bot.health ?? 0) > 0) {
          bot._threatAbortAt = now; bot._threatAbort = true;
          const was = require('./turn').stopForTurn(bot);
          console.log(`[hurt] hit with no survival response (health ${Math.round(bot.health)}): the step is stopped for the survival layer ${JSON.stringify({
            ...was, step: bot._survivalGoal?.step?.action || null })}`);
        }
        if (bot._hurtTimes.length >= 3 && !(bot._survivalReportedAt > now - 15000) && !(bot._silentHurtLoggedAt > now - 30000)) {
          bot._silentHurtLoggedAt = now;
          const { threats: seen, immediateThreat: urgent, hunted, combatTarget } = require('./danger');
          const goal = bot._survivalGoal;
          console.log(`[bug] hurt without a survival response ${JSON.stringify({ health: Math.round(bot.health), source: source?.name,
            step: goal?.step?.action, lastSurvival: goal?.survivalAction?.action,
            immediate: urgent(bot)?.entity?.name || null,
            threats: seen(bot, 32).slice(0, 5).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible,
              hunted: !!hunted(bot, t.entity), target: !!combatTarget(bot, t.entity) })) })}`);
        }
      };
      bot.on('entityHurt', bot._survivalHurtListener);
    }
  }

  // A mob met here, or a pocket watched here, for what is said of the place
  // (mobSourceAbout): once per twenty seconds in the same spot, the last
  // fifteen minutes kept.
  noteMobPlace(kind, mobs) {
    const p = this.bot.entity?.position;
    if (!p) return;
    const now = Date.now(), ring = (this.state.mobPlaces || []).filter(e => now - e.at < MOB_PLACE_MS);
    const last = [...ring].reverse().find(e => e.kind === kind);
    if (!(last && now - last.at < 20000 && Math.hypot(last.x - p.x, last.y - p.y, last.z - p.z) <= 4)) ring.push({ kind, x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), at: now, mobs });
    this.state.mobPlaces = ring.slice(-60);
  }

  placeAbout(goal, opts = {}) { return mobSourceAbout(this.bot, goal, { places: this.state.mobPlaces, ...opts }); }

  currentShelter() {
    const bot = this.bot;
    return this.state.shelters.filter(s => (!(s.avoidUntil > Date.now()) || shelter.inside(bot, s)) && s.dimension === bot.game.dimension &&
      pos(s.origin).distanceTo(bot.entity.position) < 128 && bot.blockAt(pos(s.origin)) &&
      // An unfinished emergency site is useful only while nearby. After a
      // descent or a gathering trip, choose a new local site instead of hauling
      // supplies back up a tree. Retain old records to protect partial work.
      (s.verifiedAt || s.kind === 'house' || shelter.inside(bot, s) ||
        (pos(s.origin).distanceTo(bot.entity.position) <= 12 && Math.abs(s.origin.y - bot.entity.position.y) <= 3)) &&
      // A pocket well below is not worth the walk back down when a new one
      // costs five blocks: the by-hand climb lost a day's height each dusk.
      !(s.kind !== 'house' && !shelter.inside(bot, s) && s.origin.y < bot.entity.position.y - 6 && shelter.materialStock(bot) >= 16))
      .sort((a, b) => pos(a.origin).distanceTo(bot.entity.position) + (a.verifiedAt ? 0 : 32) -
        pos(b.origin).distanceTo(bot.entity.position) - (b.verifiedAt ? 0 : 32))[0];
  }

  rememberHouse(blueprint) {
    if (!blueprint || !verifyHouse(this.bot, blueprint).ok) return false;
    if (this.state.shelters.some(s => s.kind === 'house' && s.dimension === this.bot.game.dimension && pos(s.origin).equals(pos(blueprint.origin)))) return false;
    this.state.shelters.push({ kind: 'house', origin: { ...blueprint.origin }, blueprint,
      dimension: this.bot.game.dimension, verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    return true;
  }

  report(goal, save, action) {
    // An action that stalled (stillness.js) is refused for ten minutes and
    // the layer falls through to its next answer. Never a wait worth
    // making, nor a way out of danger.
    // Refused where the supervisor set it aside too, which is the goal: a
    // flip raised forty-four times in mid-92-c (return to the surface and
    // dig in, once a second at the surface with a spider coming) was set
    // aside on the goal and never refused here (2026-09-25).
    const key = `survival:${action.action}`;
    // Any action, an emergency's too, reported twenty times in a second with
    // the bot not moving is answering nothing: it is refused five seconds and
    // the rest of the turn answers. The step off an edge, the step back from
    // lava, keep working and the pillar held each spun so, a hundred times a
    // second, until a creeper, an arrow or a zombie ended it (notes 339,
    // 370, 377, 380; 2026-09-27).
    const now = Date.now(), here = this.bot.entity?.position;
    const spin = this._spin ||= {};
    if (spin.until?.[key] > now) throw Object.assign(new Error(`${action.action.replaceAll('_', ' ')} is set aside: it ran twenty times in a second and the bot did not move`), { name: 'SetAside', until: spin.until[key] });
    const run = spin.runs?.[key];
    if (run && now - run.since < 1000 && here && run.at && here.distanceTo(run.at) < 0.3) run.count++;
    else (spin.runs ||= {})[key] = { since: now, at: here?.clone?.() || null, count: 1 };
    if (spin.runs[key].count >= 20) { (spin.until ||= {})[key] = now + 5000; delete spin.runs[key]; console.log(`[survival] ${action.action} ran twenty times in a second without the bot moving: set aside five seconds`); }
    const flip = !EMERGENCIES.has(action.action) && flipped(goal, key);
    // A hold whose results can be read rests as any action does unless it
    // is getting them: mid-226-h's seal, "resting ten seconds" after each
    // failure, ran again at once forty times, its hold excusing it by name
    // (note 520).
    // Jev's own answer (action.chosen, the pocket's ways out when the stall
    // was said on them, note 752) is not refused for a stall; a flip is.
    if (flip || (!action.chosen && !EMERGENCIES.has(action.action) && !excused(this.bot, action.action, now) && (refused(this, key) || refused(goal, key)))) {
      const entry = (flip && attemptsFor(goal).of('flip')[key]) || attemptsFor(this).of('act')[key] || attemptsFor(goal).of('act')[key];
      throw Object.assign(new Error(`${action.action.replaceAll('_', ' ')} is set aside: ${entry?.why || 'it stalled'}`), { name: 'SetAside', until: entry?.until });
    }
    goal.survivalAction = { ...action, at: new Date().toISOString() }; save();
    this.bot._survivalReportedAt = Date.now(); this.bot._survivalGoal = goal;
    // An answer to the mobs about, as the hurt listener counts one: leaving
    // them be is not.
    if (action.threats && action.action !== 'keep_working') this.bot._threatResponseAt = Date.now();
  }

  // The hold on a one-wide span over a drop (hold_on_span): nothing swung at
  // but what is at arm's length, crouched and still, the open sides walled
  // where something can push, off it away from a creeper first. A stance
  // (stanceOptions), and the code's own first answer only when Jev cannot be
  // reached (flee).
  async holdOnSpan(task, goal, save) {
    const bot = this.bot;
    const close = threats(bot).filter(t => t.distance <= 8);
    // A hold refused (a stall, a spin) is no reason to stop answering the
    // mob: the swing and the shield below still come (note 420).
    try { this.report(goal, save, { action: 'hold_on_span', threats: close.map(t => t.entity.name).slice(0, 4), health: bot.health }); }
    catch (err) { if (err.name !== 'SetAside') throw err; }
    bot.pathfinder?.setGoal?.(null); bot.clearControlStates?.(); lowerShield(bot);
    bot.setControlState?.('sneak', true);
    // Crouched is no hold against a hit: its knockback throws a player a
    // block, and off a one-wide ledge that is the fall. mid-230-f, on a
    // ravine ledge at y -28 with zombies at arm's length, held still,
    // was hit from ten to seven and knocked twenty-three blocks down
    // (2026-09-27). With a mob that hits within six, the open sides are
    // walled first, the floor beside the feet and a block on it: a
    // player thrown into a wall stays where it is.
    // Shots too: a blocked fireball still pushes, and mid-242-h, bridging
    // toward a fortress under a blaze's fire, blocked four and drifted
    // off its span with them, thirty blocks into the lava (2026-09-27).
    // A shooter in sight within its own reach counts, not only within
    // eight: mid-202-g held still on a span four seconds with a ghast in
    // sight twenty-two blocks off, walls never raised, and its fireball
    // threw the bot into the lava (2026-09-27).
    // Looked for as far as a ghast fires, sixty-four: looked for within
    // forty-eight, mid-242-aa-nether-2 held still on a span with a ghast
    // in sight fifty-eight to sixty-two blocks off, 102 blocks carried and
    // no wall raised, and its fireball threw the bot five blocks down
    // into the lava (note 551).
    // And a ghast or a blaze out of sight within its reach: it flies, and
    // has a line again at any moment. mid-243-ad's ghast was behind its
    // cover a second; the walls were never up, and when it drifted back to
    // a line its fireball threw the bot into the lava (note 563).
    const shooting = shotPushers(bot);
    const shots = require('./projectile-guard').incoming(bot, { reach: 24 }).length > 0 || shooting.length > 0;
    // While a span is being laid too, but not on the side it goes on:
    // mid-243-j, crossing at y 59 over the lava sea, was hit twice by an
    // enderman, no wall up, and the second hit threw it thirty blocks into
    // the lava (2026-09-27).
    const pressed = shots || close.some(t => t.distance <= 6 && !shooter(t.entity));
    // A creeper coming: walls do not stop a blast, and crouched still is
    // where it goes off. Off the span, away from it, first. mid-241-h held
    // on a ledge at y 74 at 8.9 health and one went off beside it
    // (2026-09-27).
    const { LIGHTS_AT, APPROACH } = require('./combat-estimate');
    const creeper = close.filter(t => t.entity.name === 'creeper' && t.distance <= LIGHTS_AT + APPROACH * 3).sort((a, b) => a.distance - b.distance)[0];
    if (creeper && !isSetAside(this, 'off_span', 'here')) {
      const cell = firmGround(bot, 8, { margin: 2, awayFrom: creeper.entity.position }) || firmGround(bot, 8, { awayFrom: creeper.entity.position });
      if (cell) {
        this.report(goal, save, { action: 'off_span', to: { ...cell }, threats: ['creeper'], health: bot.health });
        try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2000 }); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'off_span', 'here', err, 10000); }
        return true;
      }
    }
    if (pressed && await this.railSpan(task, goal, save, { ahead: bot._spanning?.target, blast: shooting.some(t => t.entity.name === 'ghast') })) return true;
    // No walls to be had (no blocks for them): off the span to firm
    // ground near by, crouched, as a player steps back from a ledge.
    // mid-235-j stood at the end of its span over the lava sea with
    // sixteen gravel and two planks, a ghast shooting, held still five
    // times, and the fireball threw it into the lava (2026-09-27).
    if (pressed && !isSetAside(this, 'off_span', 'here')) {
      const cell = firmGround(bot, 8, { margin: 2 }) || firmGround(bot, 8);
      if (cell && !cell.equals(feetCell(bot))) {
        this.report(goal, save, { action: 'off_span', to: { ...cell }, threats: close.map(t => t.entity.name).slice(0, 4), health: bot.health });
        try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 6000, stallMs: 2000 }); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'off_span', 'here', err, 10000); }
        return true;
      }
    }
    // A mob at arm's length is struck crouched and still (combat.js
    // defendNearby on a span); nothing else is done about it here.
    if (await defendNearby(bot, task, goal, save)) return true;
    // A shot on its way meets the shield, crouched (projectile-guard.js
    // deflect keeps the crouch on a span): this returned before the
    // shield's turn, and mid-227-l held still on a fortress bridge under
    // two blazes' fire, no wall to be had and no firm ground near, from
    // 7.5 to none (2026-09-27).
    if (await deflect(bot, task)) { this.report(goal, save, { action: 'block_shot', threats: close.map(t => t.entity.name).slice(0, 4), health: bot.health }); return; }
    try { for (let n = 0; n < 4; n++) { task.check(); await sleep(100); } }
    finally { if (!bot._spanning) bot.setControlState?.('sneak', false); }
    return true;
  }

  // The mobs an encounter answers: those in sight, a creeper within four
  // or a warden within twenty-four seen or not, and the mob that stopped the
  // work whatever its sight line reads this time: mid-244-f's skeleton at
  // three blocks stopped the work twenty times a second for four minutes
  // while the stance, held for a creeper, never saw it, its line of sight
  // flickering between the two looks; seven health to under three
  // (2026-09-27).
  encounterDanger() {
    const bot = this.bot;
    const danger = threats(bot).filter(t => t.visible || (t.entity.name === 'creeper' && t.distance <= 4) || (t.entity.name === 'warden' && t.distance <= 24));
    const urgent = require('./danger').immediateThreat(bot) || require('./danger').immediateThreat(bot, { stoodOff: true });
    if (urgent && !urgent.projectile && !danger.some(t => t.entity.id === urgent.entity.id)) danger.push(urgent), danger.sort((a, b) => a.distance - b.distance);
    // A ghast in sight past the twenty-four looked at, whose push can put
    // the bot over a drop that kills beside it (danger.js pushOverDrop):
    // survival claims the turn for it (note 586), and the stance is asked
    // with it. mid-242-bb-fortress-2 stood by the lava sea with a ghast 45
    // to 55 blocks off; survival had the turn and asked nothing, the code's
    // step off the edge found no route, and the stance came only with the
    // piglins (note 612).
    const push = require('./danger').pushOverDrop(bot);
    for (const t of push?.pushers || []) {
      if (t.projectile || !t.visible || !FAR_PUSHERS.has(t.entity?.name) || danger.some(d => d.entity.id === t.entity.id)) continue;
      danger.push(t); danger.sort((a, b) => a.distance - b.distance);
    }
    return danger;
  }

  // What to do about shots is asked at each shooter's warning, beside
  // whatever holds the turn (shot-reflex.js shot_answer, note 676): the
  // standing choice asked here in an encounter (shield_policy) left the
  // shield down through the work's steps, the walks and the questions, 71%
  // of the shots that landed on a bot carrying one.

  async flee(task, goal, save) {
    const bot = this.bot;
    const jev = encounterJudgments(this);
    // Asked first (note 549): with Jev reachable and no stance holding, the
    // encounter is Jev's before anything is done about it. The hold on a
    // span (hold_on_span), the step off an edge (fight_from_footing, and the
    // drop said with every stance), the swing (every stance swings at what
    // is in reach, and the question's wait swings meanwhile) and the shield
    // (shot_answer, at each shooter's warning) were the code's first, and
    // are so below only when Jev cannot be reached or has not answered.
    let asked = false;
    if (jev && !stanceHeld(bot)) {
      const danger = this.encounterDanger();
      if (danger.length) {
        asked = true;
        if (await this.stanceStep(task, goal, save, danger, false)) return;
      }
    }
    // On a one-wide span over a drop, nothing is swung at, turned to or
    // walked from: the bot holds still, crouched (terrain.js onSpan). A
    // swing at a hoglin behind mid-215-e turned it about on its span, and
    // the crossing walked it off the far end into the lava sea (note 273).
    // Unless the span's own answers are not holding: hurt twice in six
    // seconds on it, the encounter is Jev's like any other (the stances,
    // the retreat off it among them). Four deaths on spans in a day were
    // the span branch's alone to the end, Jev asked only when too late or
    // never (notes 435, 436, 439, 443).
    // Nor while a stance Jev chose holds: that stance is carried out, not
    // the span's hold in its place. mid-243-ad chose to send a ghast's
    // fireball back on its span, and between its watches this held still
    // instead, four turns in twelve seconds, the stall watch calling it
    // "turning between return fireball and hold on span" (note 563).
    const bleeding = (bot._hurtTimes || []).filter(t => Date.now() - t < 6000).length >= 2;
    if (require('./terrain').onSpan(bot) && !(bleeding && this.client && !bot._spanning) && !(jev && stanceHeld(bot))) { await this.holdOnSpan(task, goal, save); return; }
    // Off the edge before anything else is done about the mob. Only when
    // one is close enough to hit, and only to a cell a few blocks off.
    // A hoglin close and a drop within its toss: a pocket, the one thing it
    // cannot throw the bot out of. Fighting, pillaring and stepping away on
    // the ledge by the live run's Nether portal each ended thirty blocks down,
    // three deaths in five minutes. The reserve always has the blocks.
    // With Jev asked, the drop is a fact on the stance question instead.
    const tossers = heavyHitters(threats(bot), 6);
    if (!jev && tossers.length && dropWithin(bot, feetCell(bot), 3) && !creeperClose(threats(bot)) && shelter.materialStock(bot) >= 4) {
      this.report(goal, save, { action: 'seal_on_ledge', threats: tossers.map(t => t.entity.name), health: bot.health });
      if (await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) return;
    }
    // A hoglin throws the body blocks, not a step: with one about, the edge
    // three blocks off is the edge, and the ground moved to is three blocks
    // from any drop (the day audit's two Nether falls, one into lava).
    const close = threats(bot).filter(t => t.distance <= 8);
    // Up on the bot's own pillar, a heavy hitter counts only if its blow
    // reaches the top (a mob's melee reaches as high as it stands and no
    // higher: 1.4 for a hoglin, so not two up from the ground it walks).
    // Every heavy hitter counted, the step back off the edge took mid-243-ag
    // down from its finished two-up pillar at 3.5 health into the hoglin the
    // stance had priced at no damage, and it was struck dead two seconds
    // later (note 626).
    const topBody = onPillarTop(bot, this.state.pillar, 1);
    const reachesTop = t => { const y = t.entity.position?.y, at = bot.entity?.position?.y; return !Number.isFinite(y) || !Number.isFinite(at) || y + bodyHeight(t.entity.name) > at + 0.01; };
    const heavy = heavyHitters(threats(bot), 10).filter(t => !topBody || reachesTop(t)).length > 0;
    const feet = feetCell(bot);
    // A deep drop two blocks off is the edge too, with a mob close: an
    // arrow's knockback and a step of the fight carried mid-100-d two blocks
    // and down a twenty-one-block shaft (2026-09-25). Deep is half the
    // health or more from the fall, or lava; the ground moved to is three
    // blocks from it.
    const deep = require('./terrain').dropNear(bot, feet, 2);
    // Lava level with the feet within two blocks is as deadly as a drop into
    // it: mid-214-b, on a fortress leg at y 51 in the Nether, was hit by an
    // enderman beside a pool, went in, and two seconds of lava and the fire
    // after it took all twenty health (2026-09-26).
    const deadly = (!!deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2)) || lavaBeside(bot, feet);
    // Not while a stance that moves holds, as with the shield below: its
    // own steps keep off edges, and mid-208-a, dancing with a creeper four
    // blocks off, was walked away from an edge in the creeper's face and
    // took its blast from twenty to eleven (2026-09-26).
    const moving = stanceHeld(bot) && MOVING_STANCES.has(stanceHeld(bot).choice);
    // Up on its own pillar the drop round it is the point of it, the
    // walkers' reach kept off: mid-205-e chose the pillar at 0.97 among
    // five zombies, and each time it was up this stepped it back off the
    // edge into them (2026-09-26). A heavy hitter's toss still counts where
    // its blow reaches the top (above).
    const pillar = this.state.pillar;
    const onPillar = !heavy && onPillarTop(bot, pillar, 1);
    // Not while swimming: the edge is under the water's surface, and the
    // step out of it walked two bots out of the water and off drops (notes
    // 439, 459).
    const swimming = !!bot.entity?.isInWater || inWater(bot);
    if ((close.length || heavy) && !moving && !onPillar && !swimming && (heavy ? dropWithin(bot, feet, 3) : besideDrop(bot, feet) || deadly) && !isSetAside(this, 'firm_ground', 'here')) {
      // Not the cell stood on: the fallback's ground only need not be beside
      // a drop, and with the deadly drop two blocks off the feet were such
      // ground. mid-244-i walked to where it stood, twenty passes a second,
      // for minutes at y 3 with three zombies about (2026-09-27).
      const cell = ((heavy || deadly) && firmGround(bot, 8, { margin: 3 })) || firmGround(bot);
      if (cell && !cell.equals(feet)) {
        this.report(goal, save, { action: 'off_the_edge', to: { ...cell }, threats: close.map(t => t.entity.name) });
        require('./terrain').holdOffEdge(bot, feet, threats(bot, 64).map(t => t.entity));
        // Given up for the fight once a biter is at arm's length, unless the
        // edge is a heavy hitter's toss: mid-236-d's way to a cell a block
        // off stalled for three seconds while a zombie walked up and hit it
        // from nine to three (2026-09-26).
        const biter = () => !heavy && threats(bot, 5).some(t => t.distance <= 3 && !shooter(t.entity));
        // A shot on its way stops it for the shield, as in stepOnce's copy.
        const { incoming, deflect } = require('./projectile-guard');
        const shot = () => bot.inventory.slots?.[45]?.name === 'shield' && incoming(bot).length > 0;
        try {
          const from = bot.entity.position.clone();
          await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 3000, stallMs: 1500, stopWhen: () => biter() || shot() });
          if (shot()) { await deflect(bot, task); return; }
          // A step that went nowhere is no answer: mid-244-l's to the cell
          // beside it came back at once, a hundred times a second, with a
          // skeleton and a creeper about, until an arrow and a blast
          // (2026-09-27). Set aside a moment; the rest of the turn answers.
          const moved = bot.entity.position.distanceTo(from) >= 0.3;
          if (!moved) setAside(this, 'firm_ground', 'here', 'the step off the edge went nowhere', 5000);
          else if (!biter()) return;
          else setAside(this, 'firm_ground', 'here', 'a biter at arm\'s length', 5000);
        }
        catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; setAside(this, 'firm_ground', 'here', err, 5000); }
      }
    }
    // A swing can buy room, but it must not consume the escape action. Ending
    // the turn after every hit trapped an unarmed bot in a losing melee loop.
    const swung = await defendNearby(bot, task, goal, save);
    // With a creeper out of sight within four blocks among them (danger.js
    // immediateThreat): it is the danger, seen or not.
    const danger = this.encounterDanger();
    // A shot from a shooter out of view: the shield up to it, since there
    // is no mob here to answer (danger.js immediateThreat, projectile).
    if (!danger.length) {
      if (!swung && await deflect(bot, task)) { this.report(goal, save, { action: 'block_shot', threats: [], health: bot.health }); return; }
      lowerShield(bot); return;
    }
    // Something already in the air is answered before anything is decided:
    // the decision takes longer than the flight.
    // Not while a stance that moves or builds holds: with three skeletons
    // shooting there is nearly always an arrow in the air, and each block
    // raised the shield and ended the tick, so the run, the pocket or the
    // pillar chosen did not go on: in 13 of the 70 such stances chosen with
    // three or more mobs and a shooter about in the midgame trials of
    // 2026-09-25 and 26, the shield came up within five seconds instead.
    const held = stanceHeld(bot);
    // Nor while the ghast's fireball is being struck back: the shield up to
    // it is the strike not made (note 551).
    const busy = held && (MOVING_STANCES.has(held.choice) || held.choice === 'return_fireball' || (held.choice === 'pillar' && !(this.state.pillar && bot.entity.position.y >= this.state.pillar.y + 1.9)));
    if (!swung && !busy && await deflect(bot, task)) {
      this.report(goal, save, { action: 'block_shot', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
      return;
    }
    // The stance is Jev's. The rules below answer only when Jev cannot be
    // reached, is switched off (JEV_ENCOUNTERS=0), or every stance has just
    // failed.
    if (jev && !asked && await this.stanceStep(task, goal, save, danger, swung)) return;
    // The rule: a creeper is fought the player's way.
    if (await this.creeperDance(task, goal, save, danger, swung)) return;
    if (!swung && await this.closeOnShooter(task, goal, save, danger)) return;
    // A mob at arm's length is fought, swing after swing, while health holds:
    // a route search between swings is seconds of free hits, and nothing
    // outruns a zombie in a tunnel anyway. Low health falls through to the
    // escape search below.
    const armed = /_(sword|axe)$|^trident$/.test(defenseWeapon(bot)?.name || '');
    // Two hoglins on open ground are fought from two blocks up: they cannot
    // climb, a player two up is out of their reach but not out of the
    // sword's, and there are no free hits while a pocket is built around
    // them. The replay run died to a pair in nine seconds; the arena pair
    // drill lost two of three the same way, digging in while both hit.
    // Up before they are in reach, not after: on the live run the pillar went
    // up with a hoglin already at arm's length, which threw the bot off it.
    // Two in sight within sixteen, or one within ten once health is down.
    const hoglins = creeperClose(danger) ? [] : danger.filter(t => ['hoglin', 'zoglin'].includes(t.entity.name) && t.distance <= 16);
    if ((hoglins.length >= 2 || (hoglins.some(t => t.distance <= 10) && bot.health < 14)) && await this.pillarFrom(task, goal, save, hoglins)) return;
    // An enderman teleports after a runner and hits for four through iron:
    // death eighteen ran, held, ate, and died at the fifth hit. It is fought
    // where it stands while health holds, and below that sealed out: a
    // two-high pocket is a room a three-high enderman cannot stand in.
    const enderman = danger.find(t => t.entity.name === 'enderman' && t.distance <= 8);
    if (enderman && !danger.some(t => t.entity.name !== 'enderman' && t.distance <= 8)) {
      if (armed && bot.health >= 8) {
        this.report(goal, save, { action: 'fight', threats: ['enderman'], health: bot.health, stand: true });
        if (!swung && !canStrike(bot, enderman.entity)) await this.charge(task, goal, save, enderman, false);
        return;
      }
      if (await this.sealHere(task, goal, save, danger)) return;
    }
    // Within a sword's reach, not an arm's: a wither skeleton hits from
    // three blocks, and at two and a half the bot was searching for a
    // route instead of swinging.
    const inReach = t => t.distance <= 3.2 || canStrike(bot, t.entity);
    if (swung && armed && bot.health >= 8 && danger.some(inReach)) {
      this.report(goal, save, { action: 'fight', threats: danger.filter(inReach).map(t => t.entity.name), health: bot.health });
      // A blaze hovers a half block outside the sword and shoots from there;
      // holding ground at three blocks is standing still to be shot. Close
      // the gap. The arena's weak spawner run took twelve health in thirty
      // seconds of "fight" with three swings landed, all four blazes at 3.0.
      const hover = danger.find(t => shooter(t.entity) && t.distance > 2.4 && t.distance <= 3.6 && !canStrike(bot, t.entity));
      // Only onto ground: the step is taken blind, and a fortress bridge
      // has lava on both sides of it.
      const ahead = hover && bot.entity.position.plus(hover.entity.position.minus(bot.entity.position).scaled(1 / Math.max(hover.distance, 1))).floored();
      if (hover && firmStep(bot, ahead)) {
        lowerShield(bot);
        await move(bot, task, { label: 'close_on_shooter', keys: ['forward'], sneak: false, why: 'a step onto ground checked firm and dry, in a fight',
          look: hover.entity.position.offset(0, 1, 0), maxMs: 360, tick: 60, until: () => canStrike(bot, hover.entity) });
      }
      return;
    }
    // Moving on: a raised shield is a crawl.
    lowerShield(bot);
    if (await this.rangedChoice(task, goal, save, danger, armed)) return;
    await this.escape(task, goal, save, danger, armed);
  }

  // Home for the night: out of the shaft by the stairs it dug, then over the
  // ground to the bed.
  async goHomeForNight(task, goal, save, homeBed, underground) {
    const bot = this.bot;
    this.report(goal, save, { action: 'go_home_for_night', distance: Math.round(homeBed.foot.distanceTo(bot.entity.position)), underground });
    // Out of the shaft by the stairs it dug, then home over the ground:
    // a path search from the bottom of a mine to a bed timed out. A
    // stumble on the stairs is retried next tick; only the walk itself
    // failing sets the bed aside, and only for two minutes.
    if (underground && this.actions.surfaceStep) {
      try { await this.actions.surfaceStep(bot, task, goal, save); }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
        // A climb that fails every tick is not a way home: sixteen blocks
        // under the bed the dream run tried it once a second, reporting
        // nothing. Three failures in a minute set the walk aside, and the
        // night is spent the other ways (a pocket, the mine).
        const now = Date.now();
        this.state.surfaceFailures = [...(this.state.surfaceFailures || []).filter(t => now - t < 60000), now];
        if (this.state.surfaceFailures.length >= 3) { setAside(this, 'surface_home', 'here', err, 600000); this.state.surfaceFailures = []; this.report(goal, save, { action: 'surface_home_set_aside', reason: err.message }); }
      }
    } else {
      // At any hour: the held walk comes here every tick, and one that waited
      // for dusk did nothing after bedtime. Trial 94 held it thirty blocks
      // from its bed twenty times a second for the night, the sleep option
      // never offered (2026-09-25).
      try { await this.actions.navigate(bot, task, new goals.GoalNear(homeBed.foot.x, homeBed.foot.y, homeBed.foot.z, 3), { timeoutMs: 60000, stallMs: 8000, sprint: true }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'bed_route', 'home', err, 120000); }
    }
  }

  // A lone shooter on the ground, the player's way: run at it and hit it.
  // Measured in the arena (2026-09-24, scripts/shield-probe.js), one
  // skeleton eight blocks off, twenty seconds a stance: 17.7 damage standing,
  // 16.3 raising the shield as each arrow came (it takes a quarter second to
  // come up; the arrow is quicker), 15.8 to 17.5 with the bow and no kill,
  // none holding the shield up throughout and no kill either, 2 walking at
  // it behind the shield (dead in five seconds), and 0 to 2 sprinting at it
  // with a stone sword and no shield (dead in four). The first trials'
  // skeleton deaths were the per-arrow block and pockets built under fire.
  // Two at once the same way: standing, 16.3 in twenty seconds; running at
  // the nearer and then the other, none, both dead in eight seconds (trial
  // 8's bot was shot dead walking away from a pair, 2026-09-24). Up to three,
  // armed, at six health for one and ten for more, with no melee mob at
  // arm's length and no creeper close; ground that is not firm ahead is held
  // behind the shield, if there is one.
  // Chosen by Jev, only what makes the charge possible is checked (a blade,
  // ground shooters in view, dry firm footing); health and the other mobs
  // about were Jev's to weigh.
  async closeOnShooter(task, goal, save, danger, { chosen = false } = {}) {
    const bot = this.bot;
    const weapon = defenseWeapon(bot);
    if (!/_(sword|axe)$/.test(weapon?.name || '')) return false;
    // A biter at arm's length, in view or not, is the swing's, not a charge's:
    // mid-241-g charged a skeleton with a zombie at its back out of the list
    // in view, broke off at once for it, and did so ten times a second while
    // the zombie hit it from four to none (2026-09-27).
    if (!chosen && (bot.health < 6 || creeperClose(danger) || threats(bot, 3).some(t => !shooter(t.entity)))) return false;
    const shooters = danger.filter(t => t.visible && shooter(t.entity) && t.distance <= 16);
    const ground = shooters.filter(t => GROUND_SHOOTERS.has(t.entity.name)).sort((a, b) => a.distance - b.distance);
    if (!ground.length) return false;
    // As measured: from dry, firm footing, at full-ish health for more than
    // one. The dream run charged three from a river at ten health and stood
    // in the water, shot, for thirty-seven seconds (2026-09-24).
    if (!chosen && (ground.length !== shooters.length || shooters.length > 3 || (shooters.length > 1 && bot.health < 14))) return false;
    // A charge that could not get going rests: re-chosen every tick, trial
    // 21's bot raised its shield for a moment a tick and stood forty seconds
    // under a skeleton's arrows across uneven ground (2026-09-24).
    if (isSetAside(this, 'close_on_shooter', 'here')) return false;
    // Mid-hop is not refused: the feet are waited for, a second at most.
    for (let n = 0; n < 10 && bot.entity.onGround === false && !bot.entity.isInWater; n++) { task.check(); await sleep(100); }
    if (bot.entity.isInWater || inWater(bot) || bot.entity.onGround === false) return false;
    let target = ground[0];
    const shielded = bot.inventory.slots?.[45]?.name === 'shield';
    let e = target.entity;
    this.report(goal, save, { action: 'close_on_shooter', entity: e.name, target: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) },
      distance: Number(target.distance.toFixed(1)), health: bot.health });
    if (bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
    const end = Date.now() + 12000 * Math.min(3, ground.length);
    // Three seconds without getting nearer and the charge is not working.
    // Chosen, six health lost hands the encounter back to Jev.
    let best = Infinity, bestAt = Date.now();
    const startHealth = bot.health;
    const startedAt = Date.now(), expects = chosen ? bot._stance?.expects : null;
    // Whether it did anything: a charge broken off before a step or a swing
    // is no answer, and the turn goes on to the next.
    let acted = false;
    const onPace = () => { const t = (Date.now() - startedAt) / 1000; return t <= expects.seconds && startHealth - bot.health <= expects.damage * Math.min(1, t / Math.max(0.1, expects.seconds)) + (expects.oneHit || 0); };
    const going = () => chosen ? (expects ? onPace() : bot.health > startHealth - 6) : bot.health >= 4;
    try {
      while (Date.now() < end && going()) {
        const gap = bot.entity.position.distanceTo(e.position);
        if (gap < best - 0.5) { best = gap; bestAt = Date.now(); }
        else if (Date.now() - bestAt > 3000 && !canStrike(bot, e)) { setAside(this, 'close_on_shooter', 'here', 'three seconds without getting nearer', 15000); return false; }
        task.check(); checkAir(bot);
        // The one down, the next: nearest of the others still in sight.
        if (bot.entities[e.id] !== e || e.isValid === false) {
          const next = threats(bot).filter(t => t.visible && GROUND_SHOOTERS.has(t.entity.name) && t.distance <= 16).sort((a, b) => a.distance - b.distance)[0];
          if (!next) break;
          target = next; e = next.entity; best = Infinity; bestAt = Date.now();
        }
        if (threats(bot).some(t => t.entity !== e && ((t.distance <= 3 && !shooter(t.entity)) || (t.entity.name === 'creeper' && t.distance <= 5)))) break;
        await bot.lookAt(e.position.offset(0, 1.5, 0), true);
        if (canStrike(bot, e)) {
          bot.clearControlStates?.(); lowerShield(bot);
          if (bot.entities[e.id] === e) { bot.attack(e); acted = true; }
          if (shielded) raiseShield(bot);
          await sleep(650); lowerShield(bot);
          continue;
        }
        const flat = e.position.minus(bot.entity.position); flat.y = 0;
        const ahead = bot.entity.position.plus(flat.scaled(1 / Math.max(flat.norm(), 1))).floored();
        // Level, a step up, or a step down: a block's drop is walked.
        const level = firmStep(bot, ahead), up = !level && firmStep(bot, ahead.offset(0, 1, 0)), down = !level && !up && firmStep(bot, ahead.offset(0, -1, 0));
        if (!level && !up && !down) { setAside(this, 'close_on_shooter', 'here', 'no firm ground toward the shooter', 15000); return false; }
        await move(bot, task, { label: 'close_on_shooter', keys: up ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false,
          why: 'running at a lone shooter over ground checked firm', look: e.position.offset(0, 1.5, 0), maxMs: 250, tick: 50, until: () => canStrike(bot, e) });
        acted = true;
      }
    } finally { lowerShield(bot); bot.clearControlStates?.(); }
    return acted;
  }

  // A creeper, the player's way: hit it, and back out to where its blast
  // does nothing (six blocks; beyond seven its fuse burns back down), or
  // hold at reach while the swings left fit in the fuse left; hit it again
  // when it comes on. A hit does not put the fuse out (26.1.2 SwellGoal). Running only delays it (a creeper follows), and a
  // pocket beside it is worse: the dream run ran from one for forty
  // seconds, walled itself in with it outside, and one blast took twelve
  // health through iron. Only armed, at eight health or more, with no other
  // mob within five blocks and no drop within two for the knockback.
  // A step back from a creeper coming on, while a question is out: only
  // with no drop or lava behind, and not past what the question waits for.
  async backFromCreeper(task, stop = () => false) {
    const bot = this.bot;
    const { LIGHTS_AT } = require('./combat-estimate');
    const near = () => threats(bot, 12).filter(t => t.entity.name === 'creeper' && t.visible).sort((a, b) => a.distance - b.distance)[0];
    const creeper = near();
    if (!creeper || creeper.distance > LIGHTS_AT + 3) return false;
    const feet = feetCell(bot);
    if (dropWithin(bot, feet, 2) || lavaBeside(bot, feet)) return false;
    await move(bot, task, { label: 'creeper_back_off_waiting', keys: ['back'], sneak: false, why: 'backing from a creeper coming on while the stance is chosen',
      look: creeper.entity.position.offset(0, 1, 0), maxMs: 600, tick: 50,
      until: () => stop() || !near() || near().distance > LIGHTS_AT + 3 || dropWithin(bot, feetCell(bot), 1) });
    return true;
  }

  async creeperDance(task, goal, save, danger, swung, { chosen = false } = {}) {
    const bot = this.bot;
    const creeper = danger.find(t => t.entity.name === 'creeper' && t.distance <= 6);
    if (!creeper) return false;
    const armed = /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '');
    const feet = feetCell(bot);
    // Backing out blind is only safe with no drop or lava behind.
    if (!armed || dropWithin(bot, feet, 2) || lavaBeside(bot, feet)) return false;
    // Other creepers are the same dance, the nearest hit and all of them
    // backed from; any other mob close is not (the pair drill: 11 damage
    // while a second creeper kept the dance off). Chosen, that was Jev's to
    // weigh.
    if (!chosen && ((bot.health ?? 20) < 8 || danger.some(t => t.entity.name !== 'creeper' && t.distance <= 5))) return false;
    const e = creeper.entity;
    const creepers = danger.filter(t => t.entity.name === 'creeper').map(t => t.entity);
    const look = e.position.offset(0, 1, 0);
    const distance = () => Math.min(...creepers.map(c => c.position.distanceTo(bot.entity.position)));
    const { BLAST_CLEAR, FUSE, FUSE_KEPT, SWING_MS, WEAPONS, FIRST_SWING } = require('./combat-estimate');
    const fuses = watchFuses(bot);
    // Struck first, at reach with the blade ready: called from the fight's
    // hold with nothing swung, the dance closed in and backed off unstruck
    // (mid-241-a, note 529).
    const blade = defenseWeapon(bot)?.name, [damage] = WEAPONS[blade] || [1];
    const healthOf = c => { const h = creeperHealth(bot, c); const hit = bot._creeperStruck?.id === c.id && Date.now() - bot._creeperStruck.at < 400 ? bot._creeperStruck.left : Infinity; return Math.min(h ?? 20, hit); };
    const strikeIt = async () => {
      const before = healthOf(e);
      const hit = await defendNearby(bot, task, goal, save);
      if (hit && bot._struck?.id === e.id) bot._creeperStruck = { id: e.id, at: Date.now(), left: Math.max(0, before - damage) };
      return hit;
    };
    if (!swung && canStrike(bot, e)) swung = await strikeIt();
    const swelling = creepers.some(c => creeperSwelling(bot, c) && c.position.distanceTo(bot.entity.position) < 4);
    // Lit, and the swings still needed land before its fuse ends (from when
    // it was seen to light): held at reach, it dies first. A player finishes
    // one so; backing out, a blow short, lets it go off.
    // Only where its lighting was seen (else its fuse left is not known)
    // and it is at reach or a step from it on the bot's own level, the step
    // counted as the price counts it (creeperFought's first swing): mid-244-aa
    // held with a creeper struck once and lit two blocks up a ledge, told
    // the swings did not fit (1.65 seconds), walked at the ledge for a
    // quarter second unable to strike, and backed with a second of fuse
    // left: 20 to none through full iron (note 534).
    const atReach = canStrike(bot, e), level = Math.abs(e.position.y - bot.entity.position.y) < 0.6;
    if (creeperSwelling(bot, e) && e.isValid !== false && creepers.length === 1 && fuses.has(e.id) && (atReach || (creeper.distance < 3.5 && level))) {
      const swingMs = SWING_MS[blade?.split('_').at(-1)] || SWING_MS.fist;
      const left = Math.ceil(healthOf(e) / damage);
      const nextSwing = atReach ? Math.max(0, swingMs - (Date.now() - (bot._defenseAttackAt || 0))) : FIRST_SWING * 1000;
      const needs = left > 0 ? nextSwing + (left - 1) * swingMs : 0;
      const fuseLeft = FUSE * 1000 - (Date.now() - fuses.get(e.id));
      if (needs < fuseLeft - 50) {
        this.report(goal, save, { action: 'creeper_hold', distance: Number(creeper.distance.toFixed(1)), swingsLeft: left, fuseLeftMs: Math.round(fuseLeft), health: bot.health });
        if (canStrike(bot, e)) await sleep(Math.min(100, Math.max(20, nextSwing)));
        else await move(bot, task, { label: 'creeper_hold', keys: ['forward'], sneak: false, why: 'back to reach of a lit creeper the swings left kill before it goes off', look, maxMs: 300, tick: 50, until: () => canStrike(bot, e) });
        return true;
      }
    }
    // Just hit, or lit within reach, or in reach while the sword recovers:
    // back off to where the blast does nothing.
    // Backed only as far as the room goes (backRoom, backingEnds): mid-241-n
    // backed blind for its 1.2 seconds, down a drop and to 2.5 blocks from
    // a second creeper, which went off (note 534).
    const startedAt = new Map(Object.values(bot.entities || {}).filter(o => o.name === 'creeper' && o.position).map(o => [o.id, o.position.distanceTo(bot.entity.position)]));
    const ends = () => backingEnds(bot, e, startedAt);
    if (swung || (swelling && creeper.distance < 3.5) || canStrike(bot, e)) {
      this.report(goal, save, { action: 'creeper_back_off', distance: Number(creeper.distance.toFixed(1)), swelling, struck: swung, health: bot.health });
      await move(bot, task, { label: 'creeper_back_off', keys: ['back'], sneak: false, why: 'backing out of a creeper\'s blast between hits', look, maxMs: 1200, tick: 50, until: () => distance() >= BLAST_CLEAR || ends() });
      return true;
    }
    // Out of reach and none lit: close in for the next hit, the swing reflex
    // takes it at the next look. Not at a lit one further off: its fuse
    // burns on within seven blocks, and mid-230-v closed in on one lit 4.9
    // blocks off and was blown up (note 529).
    const lit = () => creepers.some(c => creeperSwelling(bot, c) && c.position.distanceTo(bot.entity.position) < FUSE_KEPT + 1);
    if (!lit()) {
      this.report(goal, save, { action: 'creeper_close_in', distance: Number(creeper.distance.toFixed(1)), health: bot.health });
      await move(bot, task, { label: 'creeper_close_in', keys: ['forward'], sneak: false, why: 'closing to swing range on a creeper that is not lit', look: e.position.offset(0, 1, 0), maxMs: 600, tick: 50,
        until: () => canStrike(bot, e) || lit() });
      // At reach and not lit: struck now, not on the next look. A close-in
      // that hands back at reach with nothing swung gives the mob its turn
      // first, as the fight's charge did (note 555).
      if (!lit() && canStrike(bot, e)) await strikeIt();
      return true;
    }
    // Lit, out of reach and already backing room: nothing for the dance to
    // do. Answering "back off until five away" at five away returned at once,
    // every step, and the loop never let the connection breathe: the arena
    // server timed the bot out twice in the creeper pair drill.
    if (distance() >= BLAST_CLEAR) return false;
    await move(bot, task, { label: 'creeper_back_off', keys: ['back'], sneak: false, why: 'a lit creeper just out of reach', look, maxMs: 600, tick: 50, until: () => distance() >= BLAST_CLEAR || ends() });
    return true;
  }

  // The stance for an encounter: fight, go up, dig into the wall, dig down,
  // seal in, run, eat or shoot, each already checked possible from here.
  // Asked once and held for fifteen seconds, until health falls by six,
  // until it fails, or until a mob it was not chosen against comes within
  // six blocks; the reflexes (the swing at arm's length, off a ledge, away
  // from lava) run before it every tick whatever the stance, and the shield
  // against an arrow in flight while the stance stands its ground.
  // Every stance says what the mobs here cost the bot over the fifteen
  // seconds, worked out the same way (stanceCost).
  stanceOptions(task, goal, save, danger, swung) {
    const bot = this.bot, options = {};
    // The fight stance itself, kept where the stances that end in it can
    // reach it after `options.fight` is left out (a stance that ended here
    // without acting is not offered again until something changes) or was
    // never built: fight_from_footing and rail_and_fight ran
    // `options.fight.run()` and threw "Cannot read properties of undefined
    // (reading 'run')" seven times on 2026-09-28, the step failed and rested
    // three minutes with the bot standing where it had walked to.
    let fightStance = null;
    // The walkers with no way to the bot (walk-reach.js): left out of what
    // reaches it, said with every stance. mid-205-v's column over a cave
    // floor had every stance priced with eight walkers at the bot in a
    // second that could not climb to it, and the skeleton was the death
    // (note 525).
    const apart = this.lastApart = walkersApart(bot, danger);
    const coming = apart.ids.size ? danger.filter(t => !apart.ids.has(t.entity.id)) : danger;
    const nearest = coming[0] || danger[0];
    const armed = /_(sword|axe)$|^trident$/.test(defenseWeapon(bot)?.name || '');
    const inReach = t => t.distance <= 3.2 || canStrike(bot, t.entity);
    const { SCAFFOLD } = require('./pillar-recovery');
    const scaffold = bot.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0);
    const feet = feetCell(bot);
    const headroom = [1, 2, 3].every(dy => { const b = bot.blockAt(feet.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); });
    // And the climb's own test for each of its two blocks (pillar-recovery
    // climbStop): offered where the climb stops at once, mid-244-ab-nether-3's
    // pillar put no block down and the question came again with a hoglin at
    // arm's length (note 587).
    const { climbStop } = require('./pillar-recovery');
    const pillarStop = headroom ? climbStop(bot, feet) || climbStop(bot, feet.offset(0, 1, 0)) : null;
    // Nothing is built, dug or drawn with a mob at arm's length that does
    // not shoot: a pillar, a pocket, a bunker and a bow each take a second
    // or more of standing still, and every one of those seconds is its hit.
    // The dream run pillared with two zombies beside it, unarmoured, and
    // went from twenty to nothing in eight seconds (2026-09-24).
    const armsLength = coming.some(t => t.distance <= 3 && !shooter(t.entity));
    // Building costs a second or so a block: said to Jev with the options
    // below rather than decided for it by hiding them.
    const buildCost = armsLength ? ' Something that bites is at arm\'s length now, and it hits freely while the blocks go down.' : '';
    const creeperNote = creeperNoteFor(coming);
    // A witch's potions come over a pillar and into a doorway: mid-72-c dug
    // a bunker against one at twenty health, the harm (armour does not stop
    // it) and the poison came in at the doorway, and a skeleton finished it
    // at five (2026-09-26). A shut pocket is the cover a thrown potion stops at.
    const witch = danger.find(t => t.entity.name === 'witch');
    const witchNote = witch ? ` A witch ${Math.round(witch.distance)} blocks off throws its potions over a pillar and into a doorway: harm that armour does not stop, and poison that keeps taking health for half a minute; a shut pocket stops them.` : '';
    // How many can reach at once here: two in a tunnel, eight in the open.
    // Unless the column over the bot opens onto ground: then they drop in on
    // top of it, and nothing bounds how many (columnOpening).
    const open = openCells(bot, feet);
    const opening = columnOpening(bot, feet);
    const inCell = inOwnCells(bot, danger, feet), inCellIds = new Set(inCell.map(t => t.entity.id));
    const shielded = bot.inventory?.slots?.[45]?.name === 'shield';
    // The eight counted are those that can get to the bot first: eight
    // walkers held below it crowded the skeleton out of the figures.
    // And the biters out of sight within the eight a biter counts from, with
    // a way to the bot: out of sight is not out of reach. mid-243-f's fight
    // was priced for the one cave spider in view, 0.4 damage, with two more
    // round the corner at 5.6 and 5.8 and a skeleton at 7.9; a second later
    // they were at 3.8 and 4.8 (note 542). Said as unseen in the figures.
    const hiddenNear = this.lastHidden = unseenBiters(bot, danger);
    const counted = [...coming, ...hiddenNear, ...(apart.ids.size ? danger.filter(t => apart.ids.has(t.entity.id)) : [])];
    // Held off for minutes (held-off.js, note 599): priced at what each has
    // done on every stance alike, and said on each (stanceStep).
    const heldOff = require('./held-off');
    heldOff.observe(bot, danger);
    const quietIds = this.lastQuiet = new Map(heldOff.quietOf(bot, counted, { record: this.state.pillarWait?.mobs }).map(x => [x.t.entity.id, x]));
    // A creeper is priced by where it goes off, and that is as far as the
    // bot can back from it (backRoom). The poison on the bot runs on in
    // every figure (combat-estimate effectLeft).
    const estimateArgs = ({ threats: counted.slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...sizeOf(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible, id: t.entity.id, ...(quietIds.has(t.entity.id) ? { quiet: quietIds.get(t.entity.id).q.minutes } : {}), ...(t.unseen ? { unseen: true } : {}), ...(apart.ids.has(t.entity.id) ? { apart: true } : {}), ...(inCellIds.has(t.entity.id) ? { inCell: true } : {}), ...(t.entity.name === 'creeper' && t.entity.position ? creeperFacts(bot, t.entity) : {}) })),
      armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: shielded, atOnce: opening ? Infinity : open + inCell.length,
      poisonedFor: require('./combat-estimate').effectLeft(bot, 'poison')?.seconds || 0, burningFor: require('./combat-estimate').burnLeft(bot),
      // The fire resistance on the body: a blaze's fire counted from when it
      // ends (note 656).
      fireproofFor: require('./fire-resistance').left(bot) });
    const estimate = fightEstimate(estimateArgs);
    const cost = estimate.fightHere;
    // And the biters out of sight further off, within their own follow range
    // and with a way to the bot (farBiters): each counted in a stance's
    // building or digging where it can be at the bot before that is done, at
    // its own speed and with its own blow, and in the fight after it once
    // there; not in the fight here (combat-estimate stanceCost `far`).
    const far = this.lastFar = farBiters(bot, counted);
    const farMobs = far.length ? fightEstimate({ threats: far.map(t => ({ name: t.entity.name, distance: t.distance, shoots: false, ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: false, id: t.entity.id, unseen: true })),
      armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: shielded }).mobs.map(m => Object.assign(m, { far: true })) : [];
    const mobs = [...(estimate.mobs || []), ...farMobs];
    // A shelter built or dug under their noses holds back only the biters
    // that come after it is closed: one at the bot before is in with it, in
    // the pocket's gap, the bunker's tunnel or down the open shaft (note
    // 581). When each can be there, at its own speed (combat-estimate
    // arrives).
    const { arrives } = require('./combat-estimate');
    const bites = m => !m.shoots && m.name !== 'creeper' && !m.apart;
    // One blow from the hardest hitter here: the give a stance's pace is
    // allowed before it is asked again (holding below).
    const oneHit = Math.max(0, ...mobs.filter(m => m.name !== 'creeper' && !m.apart).map(m => m.hitsBot || 0));
    const bitersHere = coming.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper').length;
    // How few hits the health left is, said on the stances that stand in
    // reach or in the line of fire: mid-110-h charged a skeleton at 4.5
    // health told only "hands back after six health lost" (2026-09-26).
    const hardest = (estimate.mobs || []).filter(m => m.name !== 'creeper' && !m.apart && m.hitsBot > 0).sort((a, b) => b.hitsBot - a.hitsBot)[0];
    // Each shooter's shot by its name: a ghast's fireballs were said as "2
    // arrows from the ghast" (note 551).
    // A blaze's fireball lands with its fire (combat-estimate FIRE_TICKS): the
    // hits that end the bot are counted with it, not by the hit alone, which
    // said "at 3 health, 2 fireballs end it" where one does (note 631).
    const blazeLands = (() => {
      const b = bot.health < 14 ? (estimate.mobs || []).find(m => m.name === 'blaze' && !m.apart && m.shoots && m.hitsBot > 0) : null;
      if (!b) return '';
      const ce = require('./combat-estimate');
      // With fire resistance on the body a landing is nothing until it ends
      // (note 656).
      if (b.fireproofFor > 0) return ` With fire resistance on the body (about ${Math.round(b.fireproofFor)} seconds left), a blaze's fireball that lands does nothing until it ends; after it, ${ce.landingsSays(bot.health, b.hitsBot, 0).replace(/^At /, 'at ')}`;
      return ` ${ce.landingsSays(bot.health, b.hitsBot, ce.burnLeft(bot))}`;
    })();
    const hitsLeft = blazeLands && hardest?.name === 'blaze' ? blazeLands : (hardest && bot.health < 14 ? ` At ${Math.round(bot.health * 10) / 10} health, ${Math.max(1, Math.ceil(bot.health / hardest.hitsBot))} ${hardest.shoots ? shotWord(hardest.name) : 'hit'}${Math.ceil(bot.health / hardest.hitsBot) === 1 ? '' : 's'} from the ${hardest.name.replaceAll('_', ' ')} (about ${hardest.hitsBot} each after armour${hardest.hitsBotMost ? `, up to ${hardest.hitsBotMost}: ${Math.max(1, Math.ceil(bot.health / hardest.hitsBotMost))} at the hardest` : ''}) end it${mobs.some(m => m.poisons && !m.apart) || mobs.some(m => m.poisonedFor > 0) ? ', or one once the poison has taken it to 1' : ''}.` : '') + (hardest?.name === 'blaze' ? '' : blazeLands);
    // The estimate counts each creeper's blast where it goes off, or none
    // where the swings kill it inside its fuse, and says why beside the
    // figures: trial 118 fought two creepers and a spider with no armour at
    // twelve health, told only "6.7 damage"; mid-241-a was told "0 damage"
    // with a creeper coming on and a wall at its back (note 529).
    const creeperCount = coming.filter(t => t.entity.name === 'creeper').length;
    // The decision audit (2026-09-25): what the lists above leave out. The
    // near ones out of sight that are counted are said so.
    const hiddenCounted = hiddenNear.filter(t => counted.slice(0, 8).includes(t));
    const unseenLeft = require('./danger').unseenNote(bot, [...danger, ...hiddenCounted]);
    const unseen = (hiddenCounted.length ? ` Counted in the figures though out of sight, each with a way to the bot: ${hiddenCounted.map(t => `a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`).join(', ')}.` : '') + unseenLeft;
    // "Them all" is the mobs in the figures: with more out of sight left
    // out of them, it says which (note 614: one blaze priced as "them all"
    // with four more behind the walls).
    const countedHere = (estimate.mobs || []).filter(m => !m.apart).length;
    const killWhom = unseenLeft ? `the ${countedHere === 1 ? 'one' : countedHere} in these figures, not those out of sight below` : 'them all';
    // A creeper the fight closes on is met as the dance meets it (strike,
    // then back out of the blast, or hold where the swings kill it first):
    // said once, with the figures (creeperFoughtText).
    const nearestCreeper = nearest?.entity.name === 'creeper' ? ` The nearest is the creeper: the fight meets it as the creeper dance does.` : '';
    const { creeperBlastSays, creeperBlast: blastAt, afterArmour, armourOf } = require('./combat-estimate');
    const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
    const creeperBlast = Math.round(afterArmour(blastAt(2), worn)), blastSays = creeperBlastSays(worn);
    // Every stance that fights says the creeper the same way: whether the
    // swings kill it inside its fuse and, if not, where it goes off and
    // what that blast is (combat-estimate.js creeperFought).
    const creeperFoughtText = ({ there = false } = {}) => {
      const { creeperFought, creeperFoughtSays } = require('./combat-estimate');
      const near = coming.filter(t => t.entity.name === 'creeper').sort((a, b) => a.distance - b.distance);
      if (!near.length) return '';
      const weapon = defenseWeapon(bot)?.name || null;
      // Fought elsewhere (firm ground stepped to), the room there is not
      // measured: said as unknown.
      const facts = near[0].entity.position ? creeperFacts(bot, near[0].entity) : {};
      const c = creeperFought({ weapon, worn, distance: near[0].distance, ...facts, room: there ? null : facts.backRoom ?? null });
      const more = near.length > 1 ? ` ${near.length} creepers are here: each is met the same way, one at a time.` : '';
      return `${creeperFoughtSays(c, { weapon, health: bot.health, distance: near[0].distance })}${more} A blast by distance after the armour worn: ${blastSays}.`;
    };
    // The drop beside the bot, measured, on every stance that stays or moves
    // on this ground (mid-100-d, 2026-09-25).
    // With a blaze about, the push its fireball gives against the drop's
    // distance: mid-235-p-fortress-1 was thrown off an edge at 5.5 health by
    // one (note 509).
    const blazeAbout = danger.some(t => t.entity.name === 'blaze');
    // The rods the goal still needs, with a blaze here (note 614), and the
    // blazes the fight's own figures count.
    const rodsNeed = blazeAbout ? require('./blaze-stand').rodsNeeded(bot, goal) : 0;
    const standKeys = new Set();
    const fightBlazes = (estimate.mobs || []).filter(m => m.name === 'blaze' && !m.apart).length;
    // With a hoglin or a zoglin able to get to the bot, the drop within its
    // toss (up to about four blocks back in the bot's own records, where a
    // knockback is three), said with the toss (note 587).
    const tosser = coming.map(t => t.entity.name).find(n => require('./combat-estimate').MOBS[n]?.toss);
    const tossReach = tosser ? require('./combat-estimate').MOBS[tosser].toss : 3;
    // And the ground a ghast's or a cube's throw covers (knock-record.js),
    // with what it measured said beside the drop.
    const knockKinds = danger.map(t => t.entity.name);
    const dropHere = require('./terrain').dropNear(bot, feet, Math.max(tossReach, require('./knock-record').reachFor(knockKinds)));
    const tossSays = tosser && dropHere ? ` A ${tosser}'s blow throws the bot up and back, up to about ${tossReach} blocks back and three up, not a step.` : '';
    const knockRecord = dropHere && (dropHere.into === 'lava' || dropHere.damage >= (bot.health ?? 20) / 2) ? require('./knock-record').knockSays(knockKinds) : '';
    const edge = require('./terrain').dropNote(dropHere, bot.health, bot) + tossSays + knockRecord + (blazeAbout ? require('./blaze-stand').knockSays(bot, feet) : '');
    // A ghast in sight whose fireball's push carries the bot over a drop
    // that kills from here, and the footing where it cannot (note 612).
    const blastOver = blastOverSays(bot);
    // How many can be at arm's length at once, said where it is not all of
    // them: in a tunnel a crowd comes one or two at a time.
    const inCellSays = inCell.length ? ` ${ownCellsSays(inCell)}, at arm's length whatever the cells round it hold.` : '';
    const openingSays = opening ? `, but the column over the bot is open ${opening.up} up onto ground beside it at ${opening.ground}: mobs walk to its edge and drop in, into the bot's own cells, as many as come, and all of them are at arm's length at once` : '';
    const atOnceNote = (bitersHere >= 2 ? (open >= 8 ? ' Open ground all round: every biter can be at arm\'s length at once.' : opening ? ` ${open} of the eight cells round the bot are open ground${openingSays}.` : ` ${open} of the eight cells round the bot are open ground: at most ${open + inCell.length} at arm's length at once${inCell.length ? ', counting those in its own cells' : ''}.`) : '') + inCellSays;
    // What the estimate leaves out, said wherever it is quoted: the charge
    // quoted it without, and mid-110-k's replay went from the pillar to the
    // charge past a creeper six blocks off.
    const creeperLeftOut = creeperCount ? creeperFoughtText() : '';
    // A fight that reaches nothing: every mob about shoots, none is at reach,
    // and the ground toward the nearest carries no step. Its estimate
    // assumed a kill; here it is the shots taken standing, with no end.
    // mid-244-s chose it on a pillar told "about 6.2 seconds and 2.9
    // damage", and it ended at once (note 416).
    const shootersOnly = coming.length && coming.every(t => shooter(t.entity) && !inReach(t));
    // Nothing about can get to the bot, and none of them shoots.
    const noneCome = !coming.length;
    // Or the nearest a shooter out of reach, nothing at arm's length, and
    // the charge the fight would make refused by its own rules (more than
    // eight off, two up or down, the bot beside a drop, lava by it):
    // mid-244-x's fight at a skeleton in a mineshaft was offered as a kill,
    // ran, ended at once, and the one stance left was dug under its arrows
    // (note 447).
    const chargeRefused = t => t.distance > 8 || Math.abs(t.entity.position.y - bot.entity.position.y) > 2 || besideDrop(bot, feetCell(bot)) || lavaBeside(bot, t.entity.position.floored());
    const noStep = nearest && ((shootersOnly && chargeStopsAt(bot, nearest.entity)?.blocks === 0) ||
      (shooter(nearest.entity) && !inReach(nearest) && !coming.some(inReach) && chargeRefused(nearest)));
    const shotsIn15 = noStep ? Math.round(stanceCost({ mobs: mobs.filter(m => m.shoots && m.visible !== false && !m.quiet), setup: HOLD_SECONDS, seconds: HOLD_SECONDS, health: bot.health }).damage * 10) / 10 : 0;
    // The biters the fight is priced to come at the bot that are not coming
    // (none nearer by a block a second: danger.js coming): counted as coming,
    // and the record says how many did. Of the fights in the flight records
    // begun with biters 4 to 16 blocks off in sight, not coming, 156 had one
    // within three blocks inside fifteen seconds in 37 in 100 and took 2.3
    // against the 8.3 priced; on the builds since 13:00Z on 2026-09-28, 29 of
    // them 21 in 100 and 0.94 against 12.4 (note 647). The biters coming
    // arrived 75 in 100 and took 3.96 against 8.1. Said, not changed: the
    // record cannot say why one stands off (a portal or a fungus it will not
    // pass, no way in, not its target), only that it does.
    const towardIds = new Set(comingAt(bot, { list: coming }).map(t => t.entity.id));
    const idle = coming.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper' && t.visible && t.distance > 3.5 && t.distance <= 16 && !towardIds.has(t.entity.id));
    const idleSays = idle.length && !noStep && !noneCome && !coming.some(t => !shooter(t.entity) && t.entity.name !== 'creeper' && t.distance <= 3.5)
      ? ` ${idle.length === 1 ? `The ${idle[0].entity.name.replaceAll('_', ' ')} ${Math.round(idle[0].distance)} blocks off is not coming at the bot` : `${idle.length} of the biters ${Math.round(idle[0].distance)} to ${Math.round(idle.at(-1).distance)} blocks off are not coming at the bot`} now (none nearer by a block a second), and the figure counts ${idle.length === 1 ? 'it' : 'each'} as coming: in the flight records, of the fights begun with biters like that, about a third had one at arm's length inside fifteen seconds (a fifth on the latest builds), and the bot took about a quarter of what was priced (those that were coming at the bot arrived in three of four).` : '';
    // Ground to fight from, off the edge: mid-211-s fought a magma cube on
    // a span over the lava sea, told the drop and that a knock over it was
    // the end, with no way offered to fight anywhere else; the second hit
    // threw it down forty blocks into the lava (note 469). A player steps
    // back onto firm ground first. Offered where the drop beside the bot is
    // lava or half its health, and firm ground three from any drop is within
    // sixteen (eight found none from mid-211-s's span: its snapshot, started
    // again, fought there and fell in ten seconds).
    // What a fight here costs at the edge is not its damage but its hits:
    // each that lands is a knock, and one over the drop ends it. mid-211-s
    // was told the drop and a fight of 2.2 damage, and fought (note 469).
    const hitsLanding = hardest && edge && !noStep ? Math.max(1, Math.round(cost.damageTaken / (hardest.jab ?? hardest.hitsBot))) : 0;
    const edgeHits = hitsLanding ? ` By the estimate about ${hitsLanding} of their hits land${hitsLanding === 1 ? 's' : ''} in this fight, and each is a knock that can put the bot over the drop.` : '';
    const deepHere = require('./terrain').dropNear(bot, feet, 3);
    // A spear holder's reach and knock, said with the fight: mid-244-z was
    // told the fight's cost, closed on a spear zombie over a cave floor, was
    // jabbed a block back each second out of its swing, and the last jab
    // put it over a fifteen-block drop three blocks behind it (note 497).
    const spearing = mobs.filter(m => m.jab);
    const spearSays = spearing.length ? ` ${spearing.length === 1 ? `The ${spearing[0].name.replaceAll('_', ' ')} with a spear jabs` : `${spearing.length} of them have spears and jab`} from about ${spearing[0].reach} blocks, as far as a sword reaches and past an arm, about once a second for about ${Math.max(...spearing.map(m => m.jab))} each after armour, however often it is struck; each jab knocks the bot about ${spearing[0].knock === 1 ? 'a block' : `${spearing[0].knock} blocks`} back out of its swing, to be closed on again, so it takes about twice the swinging time. From the game's own rules: ${require('./combat-estimate').SPEAR_WAYS}.${edge && deepHere ? ` The drop ${deepHere.blocksAway ? `${deepHere.blocksAway} block${deepHere.blocksAway === 1 ? '' : 's'} off` : 'under the bot'} is ${Math.max(1, Math.ceil(deepHere.blocksAway / spearing[0].knock))} jab${Math.ceil(deepHere.blocksAway / spearing[0].knock) > 1 ? 's' : ''} away.` : ''}` : '';
    // Any drop within three blocks that a knock over it hurts, not only one
    // costing half the health: the fall's cost is said, and weighing it is
    // Jev's. 25597's hold beside an eleven-block drop (8 of 20) was offered
    // no step back from it among thirteen magma cubes' knocks (note 684).
    const groundBy = deepHere && (deepHere.into === 'lava' || deepHere.damage > 0) && firmGround(bot, 16, { margin: 3 });
    if (groundBy) {
      const far = Math.round(groundBy.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10;
      // The mobs with no way to the bot here, judged again from that
      // ground: whether the step brings the bot to them or there is nothing
      // to fight there either. mid-244-ad-nether-2 was offered this against
      // a piglin with no way onto its bridge, told nothing of whether it
      // could get to the ground stepped to, and took it four times in five
      // over carrying on across (note 566).
      const apartHere = danger.filter(t => apart.ids.has(t.entity.id));
      let thereSays = '';
      if (apartHere.length) {
        let there = { ids: new Set() };
        try { there = walkersApart(bot, apartHere, { at: groundBy.offset(0.5, 0, 0.5) }); } catch (_) { there = { ids: new Set() }; }
        const name = t => `the ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`;
        const list = ts => ts.length > 1 ? `${ts.slice(0, -1).map(name).join(', ')} and ${name(ts.at(-1))}` : name(ts[0]);
        const come = apartHere.filter(t => !there.ids.has(t.entity.id)), still = apartHere.filter(t => there.ids.has(t.entity.id));
        if (come.length) thereSays += ` ${list(come)[0].toUpperCase()}${list(come).slice(1)}, with no way to the bot here, ${come.length === 1 ? 'is' : 'are'} not kept from that ground (a way there, or none the search can rule out): stepping there can put the bot where ${come.length === 1 ? 'it' : 'they'} can get to it.`;
        if (still.length) thereSays += ` ${list(still)[0].toUpperCase()}${list(still).slice(1)} ${still.length === 1 ? 'has' : 'have'} no way to that ground either${!coming.length && !come.length ? ': nothing here comes to be fought there, and the fight stands and waits for one that does' : ''}.`;
      }
      // Priced as the rail is: the step's seconds with what gets to the bot
      // hitting, then the fight there, begun once it is there (note 576).
      // Its way beside a drop a push can put the bot over, said and priced,
      // and walked along those cells as offered (note 610).
      const footWay = require('./bunker').wayTo(bot, groundBy);
      const footEdge = footWay?.length ? routeEdge(bot, footWay) : null;
      const footEdgeCells = new Set((footEdge?.beside ? footWay : []).map(c => `${c.x},${c.y},${c.z}`));
      const stepSeconds = Math.max(1, Math.round(far / 4.3 + (footEdge?.beside ? footEdge.seconds - footEdge.beside / 4.3 : 0)));
      const footCost = stanceCost({ mobs, setup: stepSeconds, ...(coming.length ? { fight: { lead: true } } : {}), shield: shielded, health: bot.health });
      options.fight_from_footing = { expects: { damage: footCost.damage, seconds: footCost.seconds, oneHit }, description: `Step to firm ground ${far} blocks off, three blocks or more from any drop (about ${stepSeconds} second${far > 4.3 ? 's' : ''}${coming.length ? ', the mobs hitting freely meanwhile' : ''}), then fight there: a knock there lands on ground, where here it goes over the edge.${footEdge?.says || ''}${thereSays}${creeperCount ? creeperFoughtText({ there: true }) : ''}${edge}` + (coming.length ? costSays(footCost, bot.health, mobs, { doing: 'stepping there', done: 'There' }) : ''),
        run: async () => {
          this.report(goal, save, { action: 'fight_from_footing', to: { ...groundBy } });
          const movements = bot.pathfinder?.movements, towers = movements?.allow1by1towers;
          if (movements) movements.allow1by1towers = false;
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(groundBy.x, groundBy.y, groundBy.z), { timeoutMs: Math.max(4000, stepSeconds * 2000), stallMs: 1200, ...(footEdgeCells.size ? { edgeTaken: n => footEdgeCells.has(`${n.x},${n.y},${n.z}`) } : {}) }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { if (movements) movements.allow1by1towers = towers; }
          const at = feetCell(bot);
          if (Math.hypot(at.x - groundBy.x, at.z - groundBy.z) > 1.5) return false;
          return fightStance ? fightStance.run() : false;
        } };
      // Whether a blast's push from where it is carries the bot over a drop
      // from that ground too: three blocks from any drop is short of a
      // fireball's throw (note 612).
      const blastsThere = blastOver ? blastPushesOver(bot, groundBy) : [];
      if (blastOver) options.fight_from_footing.description += blastsThere.length
        ? ` There a ${shotWord(blastsThere[0].t.entity.name)} from the ${blastsThere[0].t.entity.name.replaceAll('_', ' ')} still carries the bot over ${blastsThere[0].over ? `the drop ${blastsThere[0].over.blocksAway} blocks ${blastsThere[0].over.toward} of it` : 'a fall through the floor its blast can break'}.`
        : ` There a ${shotWord(blastOver.pusher.name)} from the ${blastOver.pusher.name.replaceAll('_', ' ')} pushes the bot onto ground or into rock, not over a drop.`;
    }
    // Out of a blast's push (note 612): a ghast in sight whose fireball
    // pushes the bot over a drop that kills from where it stands, and
    // footing within reach of the walk where that push cannot carry it
    // over. A player who sees a ghast while on a ledge over the lava steps
    // back from the edge before it fires. mid-242-bb-fortress-2 stood on a
    // one-wide netherrack path over the lava sea, fought piglins 14 to 25
    // blocks off with a ghast 55 blocks off in sight; every stance said the
    // fireball was the fall, the one step off offered was to fight three
    // blocks from any drop 4.5 blocks off, Jev answered none of these
    // (0.47, 0.52), and the next fireball threw it 4 blocks west into the
    // lava 18 down.
    if (blastOver?.footing && !inWater(bot)) {
      const { footing, step } = blastOver;
      const cell = footing.cell, off = Math.round(cell.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10;
      const wayCells = new Set(footing.way.map(c => `${c.x},${c.y},${c.z}`));
      const g = blastOver.pusher, word = shotWord(g.name), said = g.name.replaceAll('_', ' ');
      // From every side: wherever a ghast drifts, a push from there lands on ground.
      const allSides = [0, 1, 2, 3, 4, 5, 6, 7].every(i => !pushCarries(bot, cell, cell.offset(0.5 - 10 * Math.cos(i * Math.PI / 4), 0, 0.5 - 10 * Math.sin(i * Math.PI / 4))));
      const rate = g.name === 'ghast' ? `one ${word} every ${require('./ghast').GHAST.every} seconds while it has a line (one may be on its way already)` : `a ${word} about every ${require('./combat-estimate').MOBS[g.name]?.every || 2} seconds`;
      // A ghast aims where the bot is and leads no target: a walk across
      // its line takes the body out of where each fireball fired meanwhile
      // comes (footingStep).
      const aim = step.across == null ? '' : step.passes
        ? ` It aims each ${word} where the bot is when it fires and leads no target; a ${word} takes about ${step.flight} seconds to come ${Math.round(g.distance)} blocks, and this walk carries the body about ${step.across} blocks across its line meanwhile, where a ${word} meets the body only within about ${FIREBALL_MEETS}: one fired while it walks passes to the side of it, and lands only where it meets a block within two blocks of the bot, pushing it less the farther off it bursts; one already on its way when the walk starts comes where the bot stands now, and meets it if it comes in the first ${step.early} seconds, before the body is ${FIREBALL_MEETS} across: about ${step.chance} in 100 while the ${said} has a line (one fired every ${require('./ghast').GHAST.every} seconds).`
        : ` It aims each ${word} where the bot is when it fires and leads no target, but this walk goes nearly along its line: about ${step.across} blocks across it in the ${step.flight} seconds a ${word} takes to come ${Math.round(g.distance)} blocks, within the ${FIREBALL_MEETS} a ${word} meets the body at, so one fired while it walks still comes at it.`;
      const window = ` Until it stands there, about ${step.seconds} seconds, it is within a push of the drop: the ${said} ${Math.round(g.distance)} blocks off fires ${rate}.${aim} ${step.passes ? `A ${word} that lands on the way` : `So ${step.chance >= 100 ? `a ${word} can all but surely land first` : `about ${step.chance} in 100 that a ${word} lands first`}, and one that lands before then`} is the push over the drop: ${blastOver.deadly ? 'the bot\'s death' : 'the fall and what it costs'}.`;
      const thereSays = ` There a ${word} that lands costs its ${blastOver.hit || 'own'} damage and a push onto ground or into rock, the floor under it holding against the blast; ${allSides ? 'no drop is within a push of it from any side, wherever the ghast drifts to' : `from another side, where the ${said} can drift to, a push can still reach a drop`}.`;
      const stepCost = stanceCost({ mobs, setup: step.seconds, ...(coming.length ? { fight: { lead: true } } : {}), shield: shielded, health: bot.health });
      options.out_of_the_push = { expects: { damage: stepCost.damage, seconds: stepCost.seconds, oneHit },
        description: `Step ${footing.steps} block${footing.steps === 1 ? '' : 's'} back from the edge to footing at (${cell.x}, ${cell.y}, ${cell.z}), ${off} blocks off, where a push from the ${said} cannot carry the bot over a drop, and stand there, striking what comes to arm's length${step.crouched ? `; ${step.beside} of the ${footing.steps} cells of its way lie beside the drop, walked crouched` : ''}.${window}${thereSays}${edge}` + costSays(stepCost, bot.health, mobs, { doing: 'stepping there', done: 'There' }),
        run: async () => {
          const here = feetCell(bot);
          if (here.equals(cell)) {
            // Held there: asked again once a push from where the ghast is
            // now would carry the bot over from this cell after all.
            const now = blastPushesOver(bot, cell);
            if (now.length) { this.state.stanceWhy = `from (${cell.x}, ${cell.y}, ${cell.z}) a push from the ${now[0].t.entity.name.replaceAll('_', ' ')}, where it has drifted, carries the bot over ${now[0].over ? `the drop ${now[0].over.blocksAway} blocks ${now[0].over.toward}` : 'a fall through the floor'}`; return false; }
            this.report(goal, save, { action: 'out_of_the_push_hold', at: { ...cell }, health: bot.health });
            await sleep(250);
            return true;
          }
          this.report(goal, save, { action: 'out_of_the_push', to: { ...cell }, blocks: footing.steps, from: g.name, health: bot.health, stance: true });
          const movements = bot.pathfinder?.movements, towers = movements?.allow1by1towers;
          if (movements) movements.allow1by1towers = false;
          let walkWhy = null;
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: Math.max(3000, step.seconds * 3000), stallMs: 1200, edgeTaken: n => wayCells.has(`${n.x},${n.y},${n.z}`) }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; walkWhy = err.message; }
          finally { if (movements) movements.allow1by1towers = towers; }
          if (feetCell(bot).equals(cell)) return true;
          const short = Math.round(cell.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10;
          this.state.stanceWhy = `the step to (${cell.x}, ${cell.y}, ${cell.z}) ended ${short} blocks short of it${walkWhy ? `: ${walkWhy}` : ''}`;
          return false;
        } };
    }
    // On a one-wide span over a drop: the span's own hold, chosen (note
    // 549). It was the code's first answer there before any question; said
    // with the open sides, the blocks for them and what can push.
    let spanWalled = false, holdWindow = 0;
    if (require('./terrain').onSpan(bot)) {
      // The sides open over the drop and those a push goes toward with the
      // drop beside them, gravel or sand for a wall on a floor (note 610).
      const openSides = wallCells(bot, feet, { pusher: pusherAt(bot) });
      const spanStock = wallStock(bot, openSides), wallBlocks = spanStock.need;
      // The planks the logs carried make count, said as made first (note
      // 563): mid-243-ad was told three blocks with five oak logs carried.
      const stock = spanStock.holding, planks = shelter.plankCraft?.(bot) || null;
      const carried = stock + spanStock.loose + (planks?.available || 0);
      const canWall = wallStock(bot, openSides, { extra: planks?.available || 0 }).enough;
      const madeSays = planks && stock < wallBlocks ? `, the ${planks.item.replaceAll('_', ' ')} for them made first from the logs carried (${planks.available}), about a second more` : '';
      const { LIGHTS_AT, APPROACH } = require('./combat-estimate');
      // A shooter that flies counts out of sight too, within its reach: it
      // drifts to a line again at any moment (shotPushers).
      const pushers = [...coming.filter(t => (t.distance <= 6 && !shooter(t.entity))), ...shotPushers(bot)];
      const spanCreeper = coming.find(t => t.entity.name === 'creeper' && t.distance <= LIGHTS_AT + APPROACH * 3);
      const pushSays = pushers.length ? ` What can push the bot here: ${pushers.slice(0, 4).map(t => `the ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off${t.visible === false ? ' (out of sight, and it flies)' : ''}`).join(', ')}.` : ' Nothing about is within six blocks to hit it, nor a shooter in sight within its reach.';
      spanWalled = !!openSides.length && !!pushers.length && canWall;
      const walls = !openSides.length ? ' No side of the span at the feet is open over the drop.'
        : pushers.length ? (canWall ? ` The ${openSides.length} open side${openSides.length === 1 ? '' : 's'} at the feet ${openSides.length === 1 ? 'is' : 'are'} walled first: ${wallBlocks} block${wallBlocks === 1 ? '' : 's'}, about ${Math.round(wallBlocks * BLOCK_SECONDS * 10) / 10} seconds${madeSays}; a push stops at a wall, and the walls stay up while the bot holds here.` : ` Too few blocks carried (${carried}${planks ? `, counting the ${planks.available} planks the logs make` : ''}) to wall the ${openSides.length} open side${openSides.length === 1 ? '' : 's'} (${wallBlocks}${spanStock.floors ? `, ${spanStock.floors} of them floors under a wall, which gravel or sand does not make` : ''}): with something pushing it steps off the span to firm ground within eight instead, if there is any.`)
        : ` The ${openSides.length} open side${openSides.length === 1 ? '' : 's'} at the feet ${openSides.length === 1 ? 'is' : 'are'} left open while nothing pushes.`;
      // Priced as the rail is (note 578): the walls first under what is at
      // reach, then what comes struck where it stands, the shooters shooting.
      const holdSetup = spanWalled ? wallBlocks * BLOCK_SECONDS + (planks && stock < wallBlocks ? 1 : 0) : 0;
      // Open until the sides a push goes toward are walled, the planks first
      // (railSpan walls those sides first).
      const holdLee = leeFirst(feet, openSides, pusherAt(bot)).lee;
      holdWindow = spanWalled && holdLee.length ? holdLee.reduce((n, c) => n + (bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' ? 1 : 2), 0) * BLOCK_SECONDS + (planks && stock < wallBlocks ? 1 : 0) : 0;
      const holdCost = stanceCost({ mobs, setup: holdSetup, fight: { only: m => !m.shoots }, reaches: m => m.shoots, shield: shielded });
      options.hold_on_span = { expects: { damage: holdCost.damage, seconds: holdCost.seconds, oneHit }, description: `Hold still and crouched on the span: nothing is turned to or walked from, what comes to arm's length is struck crouched, and a shot on its way meets the shield, crouched (a player crouched does not walk off an edge, but a hit or a shot's push still throws it).${walls}${spanCreeper ? ` A creeper ${Math.round(spanCreeper.distance)} blocks off: off the span away from it first, walls do not stop a blast.` : ''}${pushSays}${edge}` + costSays(holdCost, bot.health, mobs, { doing: holdSetup ? 'walling' : null, done: 'Held' }),
        run: () => this.holdOnSpan(task, goal, save) };
    }
    // Where there is no ground to go to, the edge walled at the feet, then
    // the fight: a knock stops at a block. mid-211-s's ledge ran beside a
    // netherrack wall with lava in it and no ground three from a drop within
    // sixteen; its snapshot, started again, fought on the open edge and fell
    // twice (note 471). The span's own railing (railSpan), chosen.
    // With only shooters about and nothing to swing at too: a shot that
    // lands pushes as a hit does, and mid-235-q-nether-2 at the lip of a
    // thirty-block drop under a blaze's fire was offered the fight's rail
    // only while something could be fought; from 9.4 health it had cover
    // (in the wrong line) and a walk to ground eighteen blocks off, and a
    // fireball put it over (note 541). The rail is walled and held.
    // The sides open over the drop, and those a push goes toward with a
    // drop beside them (wallCells, note 610); gravel or sand for a wall on
    // a floor (wallStock).
    const railPlan = deepHere && (deepHere.into === 'lava' || deepHere.damage >= (bot.health ?? 20) / 2) ? wallPlan(bot, feet) : null;
    const railSides = railPlan?.cells || [];
    const railStock = wallStock(bot, railSides);
    const railBlocks = railStock.need;
    let railWindow = 0;
    // Planks made from the logs carried count, made first (note 563).
    // Blocks that hold first, then planks the logs make, then gravel or
    // sand for walls on a floor (note 610).
    const railStack = railSides.length > 0 && railStock.holding >= railStock.need;
    const railPlanks = !railStack && railSides.length ? shelter.plankCraft?.(bot) : null;
    const railMade = railPlanks && (railStock.holding + railPlanks.available >= railStock.need || (!railStock.enough && wallStock(bot, railSides, { extra: railPlanks.available }).enough)) ? railPlanks : null;
    const railFalling = railStack ? 0 : Math.max(0, railStock.need - railStock.holding - (railMade?.available || 0));
    const railLoose = !railStack && !railMade && railStock.enough;
    if (railSides.length && (railStack || railMade || railLoose)) {
      const overDrop = railSides.filter(c => require('./terrain').dropAt(bot, c)), floored = railSides.filter(c => !overDrop.includes(c));
      const sidesSaid = cs => cs.map(c => compass(c.x - feet.x, c.z - feet.z)).join(' and ');
      const which = floored.length
        ? `Wall ${railSides.length === 1 ? 'the side' : `the ${railSides.length} sides`} at the feet a push goes toward or open over the drop: ${overDrop.length ? `${sidesSaid(overDrop)} open over it, ` : ''}${sidesSaid(floored)} floored but with the drop beside ${floored.length === 1 ? 'it' : 'them'}, where a push carries the body past the cell beside it`
        : `Wall the ${railSides.length} open side${railSides.length === 1 ? '' : 's'} at the feet over the drop`;
      const looseSays = railFalling > 0 && railStock.looseName ? `, ${railFalling} of them ${railStock.looseName.replaceAll('_', ' ')}, which holds on the floor under it` : '';
      const leftOpen = railPlan.leeOnly ? railPlan.all.filter(c => !railSides.includes(c)) : [];
      const leeOnlySays = leftOpen.length ? `; the blocks carried wall only the side${railSides.length === 1 ? '' : 's'} a push from the ${shotPushers(bot)[0].entity.name.replaceAll('_', ' ')} goes toward, and ${sidesSaid(leftOpen)} stay${leftOpen.length === 1 ? 's' : ''} open (a push from it does not go that way; a hit from a mob beside the bot can)` : '';
      const railing = `${which}${leeOnlySays} (${railBlocks} block${railBlocks === 1 ? '' : 's'}${looseSays}, about ${Math.round(railBlocks * BLOCK_SECONDS * 10) / 10} seconds${railMade ? `, the ${railMade.item.replaceAll('_', ' ')} for it made first from the logs carried, about a second more` : ''}, anything at reach hitting freely meanwhile)`;
      // Priced as every stance is, the fight after the walls too: the
      // walling's seconds with everything that gets to the bot hitting
      // freely, then the fight here begun once the blocks are down (as the
      // pillar's, note 559). It was priced only where nothing could be
      // fought: mid-242-ae-nether-1's rail read its 2.4 seconds of walling
      // and no figure beside the fight's 116.5 against a piglin brute 6.9
      // blocks off, was chosen at 0.66, and the brute was at it in a
      // second and struck twice, 12.2 each (note 576).
      // mid-242-ac-nether-3 was offered it with an enderman at arm's length
      // told only "hitting freely meanwhile", took it twice, and was hit from
      // 11.9 to none with no wall up; the planks' second counts too (note 578).
      const railSetup = railBlocks * BLOCK_SECONDS + (railMade ? 1 : 0);
      const railLee = leeFirst(feet, railSides, pusherAt(bot)).lee;
      railWindow = railLee.length ? railLee.reduce((n, c) => n + (bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' ? 1 : 2), 0) * BLOCK_SECONDS + (railMade ? 1 : 0) : 0;
      // Behind the wall the shooters in sight still shoot, as its words say
      // and the span's hold prices them (note 612): the wall stops the push,
      // not the shot. Priced at nothing past the walling, mid-242-ac-nether-
      // 3-fortress-5's rail read 5.8 in fifteen seconds beside a ghast firing
      // every three.
      const railCost = noStep ? stanceCost({ mobs, setup: railSetup, reaches: m => m.shoots, shield: shielded })
        : stanceCost({ mobs, setup: railSetup, fight: { lead: true, atOnce: opening ? Infinity : open + inCell.length }, shield: shielded, health: bot.health });
      options.rail_and_fight = { expects: { damage: railCost.damage, seconds: railCost.seconds, oneHit },
        description: noStep
          ? `${railing}, then hold here behind it: ${leftOpen.length ? 'a push from its shot that lands stops at the wall' : 'a push from a shot that lands, or a step back, stops at the wall'}; nothing is at reach to swing at, and the shooters still shoot where the bot stands.${creeperLeftOut}${edge}` + costSays(railCost, bot.health, mobs, { doing: 'walling', done: 'Behind the wall' })
          : `${railing}, then fight here: ${leftOpen.length ? `a push from its shot stops at the wall; a knock toward ${sidesSaid(leftOpen)} still goes over` : 'a knock toward the drop stops at the wall'}.${creeperLeftOut}${edge}` + costSays(railCost, bot.health, mobs, { doing: railMade ? 'making the planks and walling' : 'walling', done: 'Walled' }) + hitsLeft,
        run: async () => {
          if (!await this.railSpan(task, goal, save, { blast: danger.some(t => t.entity.name === 'ghast') })) return false;
          return noStep ? true : fightStance ? fightStance.run() : false;
        } };
    }
    options.fight = { expects: noStep || noneCome ? { damage: shotsIn15, seconds: 15, oneHit } : { damage: cost.damageTaken, seconds: cost.seconds, oneHit }, description: `Fight here${armed ? '' : ' with bare hands (no sword or axe)'}: swing at whatever comes into reach, and close on the nearest mob when it is within eight blocks and not at reach yet. ${noneCome ? 'None of them can get to the bot and none of them shoots: a fight here stands and waits for one that comes, with nothing to swing at meanwhile.' : noStep ? `${shootersOnly ? `None of them can be reached from here: ${apart.ids.size ? 'every one that can get to the bot' : 'every one'} shoots, none is at reach, and the ground toward the nearest carries no step.` : `The nearest, a ${nearest.entity.name.replaceAll('_', ' ')} ${Math.round(nearest.distance)} blocks off, shoots and cannot be run at from here (a drop beside the bot, too far, or too far up or down).`} ${shootersOnly ? '' : 'The rest are not at arm\'s length either. '}Fighting here is standing in their line of fire with nothing to swing at: about ${shotsIn15} damage from their shots in the next fifteen seconds, from ${cost.healthNow} health${shotsIn15 >= cost.healthNow ? ' (more than the bot has)' : ''}, and no end while they shoot.` : `Estimated for these mobs with this weapon and armour: about ${cost.seconds} seconds and ${cost.damageTaken} damage to kill ${killWhom}, from ${cost.healthNow} health${cost.healthAfter <= 0 ? ' (more than the bot has)' : ''}; about ${cost.inFifteenSeconds} of it in the first fifteen seconds.${cost.pace ? ` ${cost.pace}` : ''}${cost.poison ? ` ${cost.poison}` : ''}`}${atOnceNote}${creeperLeftOut}${nearestCreeper}${nearest && shooter(nearest.entity) && !inReach(nearest) ? (() => { const stop = chargeStopsAt(bot, nearest.entity); return stop ? ` The nearest shoots, and the ground straight at it stops a closing run after ${stop.blocks} block${stop.blocks === 1 ? '' : 's'}, ${stop.left} short, in its line of fire.` : ''; })() : ''}${nearest && !inReach(nearest) ? chargeSays(bot, nearest.entity) : ''}${idleSays}${unseen}${edge}${spearSays}${edgeHits}${hitsLeft}`,
      run: async () => {
        // Swung only where the swing can land (the swing's own test,
        // canStrike): a mob 3.2 blocks off counted as at reach by distance
        // alone, with the ledge's edge between the eye and it, held the fight
        // "swinging" a second at a time with not one swing made, for as long
        // as its estimate ran, 467 times (mid-208-k-nether-4-fortress-1's
        // hoglin two below, note 596).
        const strikable = danger.filter(t => t.entity?.position && canStrike(bot, t.entity));
        if (strikable.length) { this.report(goal, save, { action: 'fight', threats: strikable.map(t => t.entity.name), health: bot.health, stance: true }); await this.swingFor(task, goal, save); return true; }
        const said = `the ${nearest.entity.name.replaceAll('_', ' ')} ${Math.round(nearest.distance * 10) / 10} blocks off`;
        const outOfSword = inReach(nearest) ? `: ${said} is ${Math.round(Math.abs(nearest.entity.position.y - bot.entity.position.y) * 10) / 10} blocks ${nearest.entity.position.y < bot.entity.position.y ? 'below' : 'above'} the feet and out of the sword's reach from where the bot stands (no clear swing at it)` : '';
        if (await this.charge(task, goal, save, nearest, false, { chosen: true })) return true;
        // Out of reach, and the charge showed it: a stance that failed.
        // Not a walker that walk-reach finds a way to the bot for: the run's
        // failing says only that the bot had no way to it, and it comes on
        // its own. mid-242-ah-fortress-1's wither skeleton, struck and
        // knocked back to 3.6 blocks, was run at with a route cut short;
        // the fight ended there, was left out of the next asking, and the
        // meal taken in its place was the bot's death (note 601). It is held
        // for, facing it with the shield up, below.
        // A slime or a magma cube hops at a player it sees within its follow
        // range whatever it is doing this moment: its hops come in bursts,
        // and between them it reads as not coming. 25597 (mid-242-gf) chose
        // the fight at a big magma cube seven blocks off, 0.69; the run at it
        // found no way (the bot on its own two-block perch), the cube read as
        // not coming, and the fight ended at once, three times in four
        // minutes, for a hold on the span that a hit knocked it off (note 684).
        const { WALKERS } = require('./walk-reach');
        const hopsAt = HOPPERS.has(nearest.entity.name) && nearest.visible && nearest.distance <= followRange(nearest.entity.name);
        const comesOn = (WALKERS.has(nearest.entity.name) || HOPPERS.has(nearest.entity.name)) && !shooter(nearest.entity) && (coming.includes(nearest) || hopsAt);
        if (!comesOn && bot._unreachable?.until > Date.now() && bot._unreachable.ids.includes(nearest.entity.id)) { this.state.stanceWhy = `nothing was struck${outOfSword}, and the run at ${said} found no way to it`; return false; }
        // A shooter does not come into reach: held, the fight stood in its
        // fire. mid-100-e held one at eleven blocks from 5.9 health to 4 and
        // chose a pocket too late (2026-09-25). Not taken, so the stance is
        // asked again without it.
        if (shooter(nearest.entity) && !danger.some(inReach)) return false;
        // No level way to it: the fight is held here, facing it, and the
        // swing takes it when it comes into reach. Not a stance that failed,
        // unless it does not come: trial 73 held a fight at a creeper that
        // stayed six blocks off for three minutes, beside a drop, and nothing
        // else was done. Eight seconds without it a block nearer and it is
        // left be like one a charge could not reach.
        // Eight seconds of this hold, not of any before it: the record of a
        // hold at the same hoglin half a minute earlier, never cleared, read
        // as eight seconds without it coming nearer the moment
        // mid-208-k-nether-1's fight from footing began, the hoglin twelve
        // blocks off and walking up; it was left be as out of reach, and
        // bit the bot to death while it ate (note 552). A hold is one run
        // after another a quarter second apart; two seconds between is a
        // new one.
        const held = this.state.standing, now = Date.now();
        if (!held || held.id !== nearest.entity.id || now - (held.lastAt ?? held.since) > 2000) this.state.standing = { id: nearest.entity.id, since: now, distance: nearest.distance, lastAt: now };
        else if (nearest.distance < held.distance - 1) Object.assign(held, { since: now, distance: nearest.distance, lastAt: now });
        else if (now - held.since <= 8000) held.lastAt = now;
        else {
          this.state.stanceWhy = `held ${Math.round((now - held.since) / 1000)} seconds facing ${said}: it came no nearer and nothing was struck${outOfSword}`;
          delete this.state.standing;
          bot._unreachable = { ids: [...new Set([...(bot._unreachable?.until > Date.now() ? bot._unreachable.ids : []), nearest.entity.id])], until: Date.now() + 20000 };
          return false;
        }
        this.report(goal, save, { action: 'fight', threats: [nearest.entity.name], health: bot.health, stance: true, stand: true });
        await bot.lookAt?.(nearest.entity.position.offset(0, 1, 0), true);
        // Facing it with the shield up while it does not come into reach:
        // mid-242-ac-nether-3-fortress-2 held so with the shield down, a
        // spear piglin a block below at three blocks, and took three hits
        // between swings, 17.8 to none (note 586). The swing lowers it.
        if (shielded) raiseShield(bot);
        await sleep(250);
        return true;
      } };
    fightStance = options.fight;
    // A walker below the bot's ground, struck from the edge above it, where
    // the sword reaches it and its blow does not reach up (strike-below.js,
    // note 596). mid-208-k-nether-4-fortress-1's hoglin stood two below a
    // one-wide ledge for twenty minutes, the fight chosen 467 times and each
    // standing with nothing in reach; Jev said none of these 365 times.
    const strikeBelow = this.strikeBelowOption(task, goal, save, { danger, apart, mobs, shielded, cost });
    if (strikeBelow) options.strike_from_above = strikeBelow;
    // A spear holder met as a player meets one (note 586): facing it with
    // the shield up, striking it as it comes within the sword's reach on its
    // run in. It charges from up to ten blocks, strikes on the way in and
    // backs off six or seven to come again (combat-estimate SPEAR_WAYS, the
    // 26.1.2 jar); spear damage is not among what gets past a shield, and a
    // hit the shield takes knocks the bot nowhere. Not offered before:
    // mid-242-af-nether-1 answered none of these twice at a spear piglin by
    // a three-block edge into lava and was knocked in by its one hit that
    // landed; mid-242-ac-nether-3-fortress-2 took three hits standing and
    // closing with its shield down, 17.8 to none.
    const spearHolders = coming.filter(t => (t.visible || t.distance <= 5) && t.distance <= 16 && require('./danger').holdsSpear(t.entity));
    const shieldCarried = shielded || bot.inventory.items().some(i => i.name === 'shield');
    if (spearHolders.length && shieldCarried) {
      const spearMobs = mobs.filter(m => m.spear && !m.far && !m.apart);
      const facing = spearHolders[0];
      const guardCost = stanceCost({ mobs, seconds: 15, fight: { only: m => !m.spear, lead: true }, reaches: m => !m.spear && !m.apart, health: bot.health });
      const weaponName = defenseWeapon(bot)?.name;
      const kills = spearMobs.map(m => `the ${m.name.replaceAll('_', ' ')} ${m.swingsToKill} swing${m.swingsToKill === 1 ? '' : 's'} that land${m.eachSwing ? ` (${m.eachSwing} a swing through its armor)` : ''}`).join(', ');
      const others = mobs.filter(m => !m.spear && !m.apart && !m.far && m.name !== 'creeper').length;
      const names = spearHolders.length === 1 ? `the ${facing.entity.name.replaceAll('_', ' ')} with a spear ${Math.round(facing.distance)} blocks off` : `the ${spearHolders.length} with spears, the nearest first (the ${facing.entity.name.replaceAll('_', ' ')} ${Math.round(facing.distance)} blocks off)`;
      options.shield_the_charge = { expects: { damage: guardCost.damage, seconds: 15, oneHit },
        description: `Face ${names} with the shield raised${shielded ? '' : ' (taken to the off hand first)'}, and strike ${spearHolders.length === 1 ? 'it' : 'each'} with the ${weaponName ? weaponName.replaceAll('_', ' ') : 'bare hands'} as it comes within the sword's reach on its run in; nothing is walked to or charged at. From the game's own rules: ${require('./combat-estimate').SPEAR_WAYS}, and a hit the shield takes knocks the bot nowhere. The shield comes down for each swing and is a quarter second going up again before it blocks: a hit landing then lands as ever, and one from the side or behind is not blocked.${kills ? ` To kill: ${kills}.` : ''} The blocks are the game's rules, not yet seen in the bot's own fights with spears; its hits while the shield is down are left out of the figure below.${others ? ' The other mobs here are struck as they come to reach, and their hits land as in the fight.' : ''}` + costSays(guardCost, bot.health, mobs),
        run: async () => {
          this.report(goal, save, { action: 'shield_the_charge', threats: spearHolders.map(t => t.entity.name), health: bot.health, stance: true });
          if (!shielded) { const s = bot.inventory.items().find(i => i.name === 'shield'); if (s) await bot.equip(s, 'off-hand'); }
          const { holdsSpear } = require('./danger');
          for (const until = Date.now() + 15000; Date.now() < until;) {
            task.check(); checkAir(bot);
            const near = threats(bot, 16).filter(t => holdsSpear(t.entity) && (t.visible || t.distance <= 5)).sort((a, b) => a.distance - b.distance)[0];
            if (!near) return true;
            // A mob at the sword's reach is struck (the swing lowers the
            // shield and raises it after); otherwise face the nearest spear
            // with the shield up.
            if (strikeTarget(bot)) { await defendNearby(bot, task, goal, save); continue; }
            await bot.lookAt?.(near.entity.position.offset(0, (near.entity.height || 1.95) * 0.85, 0), true);
            raiseShield(bot);
            await sleep(100);
          }
          return true;
        } };
    }
    // A biter met as a player meets a wither skeleton (wither-guard.js, note
    // 601): the shield up facing it and the sword swung between its blows;
    // or under a ceiling two high, which one 2.4 tall cannot come under.
    // mid-242-ah-fortress-1 was offered neither, answered none of these at
    // 0.40 twice, and was withered to death from 10 in six seconds.
    const guardOpt = this.shieldGuardOption(task, goal, save, { coming, mobs, shielded, oneHit });
    if (guardOpt) options.shield_guard = guardOpt;
    const lowOpt = this.lowCeilingOption(task, goal, save, { coming, mobs, shielded, oneHit });
    if (lowOpt) options.low_ceiling = lowOpt;
    // Already up is the stance held, not a stance that failed: read as a
    // failure it was asked again every tick, a hundred and twenty times in
    // three hoglin drills.
    const up = onPillarTop(bot, this.state.pillar);
    // The hold up there, kept while the bot is on the top and ended once it
    // is off (pillar-wait.js, note 590).
    const pillarWait = require('./pillar-wait');
    if (up) pillarWait.watchPillar(this.state, this.state.pillar, danger, bot);
    else if (this.state.pillarWait) pillarWait.endPillarHold(this.state, this.state.stance?.choice && this.state.stance.choice !== 'pillar' ? `off the top, ${this.state.stance.choice.replaceAll('_', ' ')} chosen` : 'off the top');
    // Two up, what still reaches: the shooters, the climbers (fought from
    // there), a witch's potions and a creeper's blast at the foot. mid-110-k
    // pillared at thirteen health with a creeper six blocks off and three
    // skeletons, told nothing of what that cost, and the blast was all of it.
    // A spear's thrust reaches past an arm: two up is in its reach. mid-244-o
    // pillared from spear zombies and was speared on top, three hits from
    // 6.6 to none (2026-09-27).
    const spears = coming.filter(t => /_spear$/.test(t.entity.heldItem?.name || ''));
    // Two up is two up from where the mobs stand, not from the bot's floor:
    // in a cave a zombie on a ledge a block or two higher is at the pillar's
    // top. mid-241-k held a pillar told "two up, none of them reaches it"
    // with zombies about a cave's uneven floor and was hit on top, then
    // fought six from 14 health to none (note 424).
    // A blow reaches as high as the mob stands (BODY_HEIGHT): one whose
    // ground and height are over the top reaches it, a zombie a block up as
    // a wither skeleton on the bot's own floor.
    const topY = up ? feet.y : feet.y + 2;
    const reachesTopFrom = (standY, name) => standY + bodyHeight(name) > topY + 0.01;
    const onLedge = coming.filter(t => !shooter(t.entity) && t.entity.position && t.distance <= 5 && t.entity.position.y >= (up && this.state.pillar ? this.state.pillar.y : feet.y) + 0.5 && reachesTopFrom(t.entity.position.y, t.entity.name));
    // And the ground round the column, wherever the mobs stand now: they
    // walk to it. mid-242-aa's wither skeletons were seven blocks off on a
    // fortress floor one above the tunnel it pillared from (note 559).
    const base = up && this.state.pillar ? new Vec3(this.state.pillar.x, this.state.pillar.y, this.state.pillar.z) : feet;
    const beside = groundBeside(bot, base);
    const besideReach = beside ? coming.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper' && !REACH_UP[t.entity.name]?.startsWith('climbs') && reachesTopFrom(base.y + beside.up, t.entity.name)) : [];
    const ledgeKinds = new Set([...onLedge, ...besideReach].map(t => t.entity.name));
    // Its top in an open column is level with the ground the column opens
    // onto, where walkers stand (columnOpening); and with a mob in the bot's
    // own cells the first block does not go down, so it does not rise while
    // that one stays, and every one about reaches it where it stands.
    const topBesideGround = !up && opening && opening.up <= 3;
    const notRising = !up && inCell.length > 0;
    const pillarCost = stanceCost({ mobs, setup: up ? 0 : PILLAR_SECONDS, fight: { only: m => CLIMBERS.has(m.name) || (!m.shoots && m.name !== 'creeper' && ledgeKinds.has(m.name)), lead: true }, reaches: m => notRising || m.shoots || m.spear || m.name === 'creeper' || m.name === 'warden' || ledgeKinds.has(m.name) || (topBesideGround && !CLIMBERS.has(m.name)), shield: shielded });
    const pillarBlocked = (notRising ? ` ${ownCellsSays(inCell)}: the pillar's first block goes into the cell under the bot's feet, and no block goes where a body is, so it does not rise while ${inCell.length === 1 ? 'that one stays' : 'they stay'} there.` : '') +
      (topBesideGround ? ` The column over the bot opens onto ground ${opening.up} up at ${opening.ground}: two up is level with ${opening.up === 2 ? 'it' : 'a block under it'}, and walkers that stand there reach a player on the pillar's top.` : '');
    const ledgeSays = onLedge.length ? ` ${onLedge.length === 1 ? `The ${onLedge[0].entity.name.replaceAll('_', ' ')} ${Math.round(onLedge[0].distance)} blocks off stands` : `${onLedge.length} of them stand`} on ground above the bot's floor (a ledge or a slope), high enough that ${onLedge.length === 1 ? 'its blow reaches' : 'their blows reach'} a player two up.` : '';
    // The ground round the column said where it is over the floor: the top
    // is that much less above it, and who stands there reaches it. A blow
    // on a top one block wide also puts the bot off it: the game's
    // knockback (LivingEntity.knockback, 0.4 a tick and a hop) moved
    // mid-242-aa 0.8 of a block with the first and off the top with the
    // second, two blocks down among them, and the wither skeleton stepped
    // up onto the top from the ground beside it (note 559).
    const besideKinds = [...new Set(besideReach.map(t => t.entity.name))];
    const besideSays = beside && beside.up >= 1 && !topBesideGround ? ` The ground beside the pillar's column is ${beside.up} up, at ${beside.at.x}, ${beside.at.y}, ${beside.at.z}: two up is ${beside.up >= 2 ? 'level with it' : 'one above it'}, and a blow reaches as high as the mob stands (a zombie or a piglin 1.95, a wither skeleton 2.4)${besideKinds.length ? `, so ${mobList(besideKinds, besideReach.map(t => ({ name: t.entity.name })))} reach${besideReach.length === 1 ? 'es' : ''} a player on the top from there` : ''}${beside.up === 1 ? ', and one there steps up onto the top once the bot is off its middle' : ''}.` : '';
    const topReachers = coming.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper' && (CLIMBERS.has(t.entity.name) || ledgeKinds.has(t.entity.name) || notRising || topBesideGround));
    // Where every biter about reaches the top, the pillar is no cover from
    // any of them, said first: told the general rule ("walkers of a
    // player's height cannot reach a player two up") with the exceptions
    // after it, Jev took the pillar five times in five on mid-242-aa's
    // replay (note 559).
    const biters = coming.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper');
    const noCover = biters.length > 0 && biters.every(t => topReachers.includes(t));
    // Up already, the hold says what it has been: the minutes, what was
    // struck, how each mob about has gone and whether it reaches the top or
    // the sword reaches it (pillar-wait.js). mid-208-k-nether-4-fortress-1
    // and mid-242-af held a pillar eleven and twelve minutes over a hoglin
    // and a piglin that neither came nor went, told each fifteen seconds to
    // "go two blocks straight up" and nothing of the hold (note 590).
    const holdSays = up ? pillarWait.pillarWaitSays(bot, this.state, goal, { about: danger, reachesTop: t => topReachers.includes(t) || (!shooter(t.entity) && inReach(t)), strikes: inReach, shoots: t => shooter(t.entity), hurtBy: bot._hurtBy || {} }) : null;
    this.lastPillarHold = holdSays;
    const pillarOpens = up && !noCover
      ? 'Hold on the pillar\'s top, two up, and fight from there: hoglins, zombies, piglins and other walkers of a player\'s height cannot reach a player two up, and the sword reaches one that stands at the column\'s foot; shooters still can hit.'
      : noCover
      ? `Go two blocks straight up on placed blocks and fight from there. Here two up is no cover from any of the mobs that bite: ${mobList([...new Set(biters.map(t => t.entity.name))], biters.map(t => ({ name: t.entity.name })))} reach${biters.length === 1 ? 'es' : ''} its top, and the fight up there is the fight here, begun once the blocks are down, on a top one block wide; shooters still can hit.`
      : 'Go two blocks straight up on placed blocks and fight from there: hoglins, zombies, piglins and other walkers of a player\'s height cannot reach a player two up, but the sword still reaches them; shooters still can hit.';
    const pillarSays = up && noCover ? pillarOpens.replace('Go two blocks straight up on placed blocks and fight from there.', 'Hold on the pillar\'s top and fight from there.') : pillarOpens;
    const knockSays = topReachers.length ? ` A blow that lands knocks the bot back (the game's knockback, with a hop): on a top one block wide the first leaves it at the edge and the next puts it off, two blocks down among them, where it is the fight here.` : '';
    if ((scaffold >= 2 && headroom && !pillarStop) || up) options.pillar = { expects: { damage: pillarCost.damage, seconds: pillarCost.seconds, oneHit }, description: pillarSays + ledgeSays + besideSays + (spears.length ? ` A spear reaches past an arm: the ${[...new Set(spears.map(t => t.entity.name.replaceAll('_', ' ')))].join(' and ')} with a spear still reach${spears.length === 1 ? 'es' : ''} the bot two up.` : '') + (up ? '' : buildCost) + pillarBlocked + creeperNote + climbers(coming) + (up ? '' : above(bot, coming)) + knockSays + witchNote + costSays(pillarCost, bot.health, mobs, { doing: up ? null : 'going up', done: notRising ? `Not up while ${inCell.length === 1 ? 'it stands' : 'they stand'} there` : 'Two up' }) + (noStep && shootersOnly ? ` With only shooters about, none at reach, there is nothing ${up ? 'up here' : 'two up'} to swing at: held, it is standing in their line of fire, and they shoot with no end while it holds.` : '') + (edge && heavyHitters(coming, 16).length ? edge.replace(/ A drop of/, ' Two up, a hoglin\'s toss still reaches the bot, and a drop of') : edge) + (holdSays?.hold || ''),
      // Held up there, the stance is kept: facing the nearest, the swing and
      // the shield (the tick's own, before this) taking what comes. Returned
      // at once, it ran twenty passes a second with nothing reported, and the
      // hurt watchdog stopped the work under it at each hit (mid-243-i).
      // Facing the shooter, not the nearest: a shield covers only the way
      // the bot looks, and mid-227-n on its pillar faced the spider at its
      // foot while the skeleton shot it from 14.4 to none through a shield
      // raised at four of the last five hits (note 395, 2026-09-27).
      run: async () => {
        if (!up) return this.pillarFrom(task, goal, save, danger);
        const face = shieldFacing(bot, danger);
        pillarWait.watchPillar(this.state, this.state.pillar, danger, bot);
        this.report(goal, save, { action: 'pillar_hold', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, ...(face ? { facing: face.name } : {}) });
        if (face) await bot.lookAt?.(face.at, true);
        await sleep(250);
        return true;
      } };
    // The fight chosen from the top, and what it came to in this hold.
    if (holdSays?.fight && options.fight) options.fight.description += holdSays.fight;
    // Down off a pillar of the bot's own: stood on one, nothing else here
    // moves it (a route drops three blocks at most), and mid-83-e stood five
    // up on its dirt for seventy seconds, shot by a skeleton, choosing to
    // retreat and not moving (2026-09-26). A block a time, dug underfoot.
    const { pillarDescent, descendPillar, pillarHeight } = require('./pillar-recovery');
    // On its own pillar's top, anywhere over the block, and as high as it
    // was raised: mid-242-af stood 0.2 of a block off the middle and
    // mid-208-k-nether-4-fortress-1 under a fungus's cap with no side open at
    // head height, and neither was offered the way down in eleven and twelve
    // minutes held (note 590).
    const down = pillarDescent(bot, goal, { combat: true, center: up });
    // Up off the ground by more than a route drops: only then is there no
    // way off it but digging down.
    let onPillar = 0;
    const high = down ? (up && this.state.pillar ? feet.y - this.state.pillar.y : pillarHeight(bot, feet)) : null;
    if (down && high) {
      const stranded = high > ROUTE_DROP;
      if (stranded) onPillar = high;
      options.come_down = { description: up
        ? `Come down the pillar the way it went up: the block under the feet is dug out and the bot drops onto the next, about a second each, ${high} block${high === 1 ? '' : 's'} down to the ground it went up from; shot at meanwhile if a shooter is about. Down there the mobs that cannot reach the top can reach the bot again, and the sword reaches them.${hitsLeft}`
        : stranded
        ? `Get down off the pillar to the ground, ${high} blocks: its top block is dug out and the bot drops onto the next, about a second each, the only way off it; shot at meanwhile if a shooter is about. On the ground the retreat, the pocket and the charge work again; up here none of them can.${hitsLeft}`
        : `Dig out the block under the feet and drop onto the next, about a second each, down to the ground beside, ${high} block${high === 1 ? '' : 's'} below; shot at meanwhile if a shooter is about. A route steps down ${ROUTE_DROP} blocks, so the retreat and the charge get off it as well, and the walls of a pocket go up beside ${high} block${high === 1 ? '' : 's'} of open air.${hitsLeft}`,
        run: async () => {
          this.report(goal, save, { action: 'come_down', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, stance: true });
          // Its own pillar, as many blocks as it went up, not into the ground under it.
          let steps = 0;
          const limit = up ? high : 24;
          while (steps < limit) {
            try { if (!await descendPillar(bot, task, goal, save, null, { combat: true })) break; }
            catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; break; }
            steps++;
          }
          return steps > 0;
        } };
    }
    // A bunker where there is a wall to dig: its seconds said (bunker.js
    // bunkerDigMs, the game's dig times with the tool carried) and weighed
    // by Jev. Offered only under three seconds of digging, it was offered in
    // none of the 78 "none of these" picks with shooters about of
    // 2026-09-27, 57 of them underground, where the pillar was taken 49
    // times though its own text says shooters still hit (note 499).
    // At the doorway the biters come one at a time and are fought; the
    // shooters in line with it and a creeper at it still reach.
    // Dug once: in the bunker already, the stance is to stay in it (note
    // 569). A wall left undug for the lava or water behind it is said: no
    // cell with liquid beside it or above it is opened (tunneling.js
    // safeExcavation), and another side is dug instead.
    const dug = this.state.bunkerDug, inDug = require('./bunker').inBunker(bot, dug);
    const bunkerMs = nearWall(bot, centroid(danger), { dug }) ? require('./bunker').bunkerDigMs(bot, centroid(danger), { dug }) : Infinity;
    const undug = !inDug && Number.isFinite(bunkerMs) ? require('./bunker').liquidBehind(bot, feetCell(bot), centroid(danger)) : [];
    const undugSays = undug.length ? ` Not dug where ${undug.length === 1 ? 'there is' : 'there are'} ${undug.slice(0, 3).join('; ')}: a cell opened there lets it in, and lava in a tunnel spreads faster than a body moves through it.` : '';
    // The biters at the bot before it is in follow it in and are fought
    // there together, as here; the doorway holds back those that come after.
    // mid-244-ag dug in a cave told "about 8.9 damage ... at the doorway, one
    // biter at a time", five zombies within ten blocks, three of them out of
    // sight and uncounted past eight: all five were at it while it dug, and
    // they hit it fourteen times from 20 to none (note 581).
    const bunkerSays = () => {
      const setup = bunkerMs / 1000 + BLOCK_SECONDS;
      const first = mobs.filter(m => bites(m) && arrives(m) < setup);
      const c = stanceCost({ mobs, setup, fight: { atOnce: Math.max(1, first.length), only: m => !m.shoots }, reaches: m => m.shoots || m.name === 'creeper' || m.name === 'warden', shield: shielded });
      const done = first.length > 1 ? `In it, with the ${first.length} there before it is dug in fought together in the tunnel (the doorway holds back only those after)` : first.length ? `In it, with the ${first[0].name.replaceAll('_', ' ')} there before it is dug in in the tunnel and the rest one at a time at the doorway` : 'At the doorway, one biter at a time';
      return costSays(c, bot.health, mobs, { doing: 'digging in', done });
    };
    if (Number.isFinite(bunkerMs)) options.bunker = { description: (inDug
      ? `Stay in the bunker already dug here, at its inside cell facing the doorway, so only one mob at a time can reach, and fight them there: no more digging.`
      : `Dig into the nearby wall, three blocks in and one to the side at the end where the rock allows, so only one mob at a time can reach, and fight them at the doorway: about ${Math.round(bunkerMs / 100) / 10} seconds of digging with the tools carried, shot at meanwhile.${undugSays}`) + buildCost + creeperNote + witchNote +
      bunkerSays(),
      run: async () => { this.report(goal, save, { action: 'dig_in_bunker', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, stance: true });
        try { this.state.bunkerDug = await digBunker(bot, task, goal, save, { from: centroid(danger), navigate: this.actions.navigate, dug: this.state.bunkerDug }); save(); return true; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; } } };
    // Against blazes, the stands a player takes rods from with iron and no
    // fire resistance, back to rock where a fireball's push meets a wall
    // (blaze-stand.js): a hole dug into the brick, the spawner's cage under
    // a ceiling, a wall at the back. The fortress stage's three deaths were
    // offered none of them (notes 509, 512, 514).
    if (blazeAbout && !inWater(bot)) {
      // Priced with the biters out of sight that have a way to the bot, as
      // every other stance is (note 542): mid-242-ac-nether-1-fortress-1's
      // back_to_wall read "about 0 damage ... none of them reaches it" with
      // a wither skeleton five blocks off round a corner, and it struck the
      // bot a second later (note 559).
      const stands = require('./blaze-stand').blazeStands(bot, [...danger, ...hiddenNear], { dig: typeof this.actions.dig === 'function', need: rodsNeed, of: require('./blaze-stand').rodsOf(bot, goal), holds: goal?.mobHunt?.standResults || [], goal });
      for (const key of Object.keys(stands)) standKeys.add(key);
      for (const [key, o] of Object.entries(stands)) options[key] = { expects: o.expects, description: o.description + (o.kind === 'hole' && !o.site.inside ? buildCost : '') + hitsLeft,
        run: async () => {
          this.report(goal, save, { action: key, threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, stance: true });
          try { return await require('./blaze-stand').takeStand(bot, task, goal, save, o, { navigate: this.actions.navigate }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled', 'StanceFailed'].includes(err.name)) throw err; this.state.stanceWhy = err.message; return false; }
        } };
      // The rods carried into a chest while no blaze sees the bot (rod-stash.js,
      // note 704): a death drops them, a chest keeps them.
      const stash = require('./rod-stash').stashOffer(bot, goal);
      if (stash) options.stash_rods = { expects: { damage: 0, seconds: stash.seconds }, description: require('./rod-stash').offerSays(stash),
        run: async () => {
          this.report(goal, save, { action: 'stash_rods', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, stance: true });
          return require('./rod-stash').stashRods(bot, task, goal, save, this.actions, stash);
        } };
    }
    // Out of the shooters' line, as a player under arrows steps behind a
    // corner of rock or back into the tunnel it came by, or digs a short L
    // into the wall: the 78 picks above had only the pillar, a block of
    // cover in the open and pockets of twenty to thirty-four blocks. Each is
    // checked with the game's raycast from every shooter's eye to where the
    // bot would stand (bunker.js seenFrom), and priced as the rest are: the
    // walk or the digging under fire, then what still reaches it, the biters
    // that come round fought at arm's length a few at a time.
    const shooting = danger.filter(t => shooter(t.entity)).map(t => t.entity);
    const biting = danger.filter(t => !shooter(t.entity)).map(t => t.entity);
    const seenHere = shooting.length ? require('./bunker').seenFrom(bot, shooting, feet) : [];
    const shooterNames = list => mobList([...new Set(list.map(e => e.name))], list.map(e => ({ name: e.name })));
    const heldHidden = this.state.stance?.choice === 'out_of_sight' || this.state.stance?.choice === 'nook';
    // Out of the line is not out of reach: a shooter that loses sight of the
    // bot walks on toward it and shoots once it has a line again (bunker.js
    // lineRegained, the game's bow goal). Each shooter in sight is walked
    // to the hiding place by its way, and counted from the second it has a
    // line: mid-242-y was told one damage in fifteen seconds round a corner
    // from a skeleton three blocks off; then "none of them reaches" the end
    // of an L the skeleton walked into, and was shot from the turn (note
    // 522).
    const lineCache = new Map();
    const regainAt = (cell, { open = null, setup = 0 } = {}) => {
      const out = new Map();
      for (const t of danger.filter(d => (d.visible || d.entity.name === 'ghast') && shooter(d.entity)).slice(0, 8)) {
        // A ghast flies and drifts at random: it has no way to walk to a
        // line (bunker.js lineRegained), and none can be said (note 551).
        if (t.entity.name === 'ghast') { out.set(t.entity.id, { name: t.entity.name, distance: t.distance, drifts: true }); continue; }
        const r = require('./bunker').lineRegained(bot, t.entity, cell, { open, within: Math.max(0, require('./combat-estimate').HOLD_SECONDS - setup), cache: lineCache });
        out.set(t.entity.id, { name: t.entity.name, distance: t.distance, ...(r ? { blocks: r.blocks, seconds: Math.round((setup + r.seconds) * 10) / 10 } : { none: true }) });
      }
      return out;
    };
    const reachesAgain = regain => m => m.name === 'creeper' || m.name === 'warden' || (m.shoots && regain.get(m.id)?.seconds) || false;
    const regainSays = regain => {
      const walkers = [...regain.values()].filter(r => !r.drifts), drifting = [...regain.values()].filter(r => r.drifts);
      const ghastHit = mobs.find(m => m.name === 'ghast')?.hitsBot;
      const drifts = drifting.length ? ` The ghast ${Math.round(drifting[0].distance)} blocks off does not walk to a line: it drifts through the air at random, so when it has one on this spot cannot be worked out, and the figures below leave its fireballs out; each that lands is about ${ghastHit ?? '?'} after armour.` : '';
      const parts = walkers.slice(0, 4).map(r => `the ${r.name.replaceAll('_', ' ')} ${Math.round(r.distance)} blocks off ${r.none ? 'has none within the fifteen seconds' : r.blocks ? `has one after about ${r.blocks} blocks of walking, about ${r.seconds} seconds in` : `has one from where it stands, about ${r.seconds} seconds in`}`);
      return (parts.length ? ` A shooter that loses sight of the bot walks on toward it by its way and shoots once it has a line again, its bow drawn in about a second: ${parts.join('; ')}.` : '') + drifts;
    };
    // Where the bot hid, kept with the stance: it is asked again when a
    // shooter has a line there (stanceStep).
    const hideAt = cell => { const st = this.state.stance; if (st) st.hidden = { cell: `${cell}`, seenBy: require('./bunker').seenFrom(bot, shooting, cell).map(e => e.id) }; };
    // A spot the walk just failed to reach is not a spot to hide in: its
    // walk ended where it began, and the next question offered the same
    // spot. mid-244-ad chose out_of_sight forty-one times in eleven seconds
    // from 6.4 health to 1.2 under a crossbow piglin's bolts, a walk of six
    // blocks, and moved 1.4, each failure said with no why (note 570). A
    // failed spot is passed over while the bot stands within four blocks
    // of where the walk began, for COVER_FAILED_MS; the failure, with its
    // why, is said in the state and with the next spot offered.
    const coverFailed = (this.state.coverFailed || []).filter(f => Date.now() - f.at < COVER_FAILED_MS && Math.hypot(f.from.x - feet.x, f.from.y - feet.y, f.from.z - feet.z) <= 4);
    this.state.coverFailed = coverFailed;
    const cover = shooting.length && !inWater(bot) && (seenHere.length || heldHidden)
      ? require('./bunker').coverWithin(bot, shooting, { steps: 8, avoid: biting, skip: c => coverFailed.some(f => f.cell === `${c}`) }) : null;
    if (cover) {
      // Its way beside a drop a push can put the bot over, said and priced,
      // and walked along those cells as offered, crouched there in the
      // Nether (note 610).
      const coverEdge = cover.steps ? routeEdge(bot, cover.path) : null;
      const coverEdgeCells = new Set((coverEdge?.beside ? cover.path : []).map(c => `${c.x},${c.y},${c.z}`));
      const secs = Math.round(((cover.steps - (coverEdge?.beside || 0)) / 4.3 + (coverEdge?.seconds || 0)) * 10) / 10;
      const atOnce = Math.max(1, openCells(bot, cover.cell));
      const regain = regainAt(cover.cell, { setup: secs });
      const hiddenCost = stanceCost({ mobs, setup: secs, fight: { atOnce, only: m => !m.shoots }, reaches: reachesAgain(regain), shield: shielded });
      const off = Math.round(cover.cell.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10;
      const biters = biting.length ? ` What bites comes round to it and is fought at arm's length, at most ${atOnce} at once there.` : '';
      options.out_of_sight = { expects: { damage: hiddenCost.damage, seconds: hiddenCost.seconds, oneHit },
        description: (cover.steps
          ? `Walk ${plural(cover.steps, 'block')} to a spot ${off} blocks off that no line from ${shooterNames(shooting)} reaches (rock stands between), about ${secs} seconds in their fire on the way, and stay there.`
          : `Stay where the bot stands: no line from ${shooterNames(shooting)} reaches it here (rock stands between).`) + biters + regainSays(regain) +
          (coverEdge?.says || '') + costSays(hiddenCost, bot.health, mobs, { doing: cover.steps ? 'walking there' : null, done: 'Out of their line' }) + hitsLeft +
          (coverFailed.length ? ` ${coverFailedSays(coverFailed)}` : ''),
        run: async () => {
          if (!cover.steps) {
            this.report(goal, save, { action: 'out_of_sight_hold', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
            hideAt(feet);
            const next = [...biting].sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
            if (next) await bot.lookAt?.(next.position.offset(0, 1.6, 0), true);
            await sleep(250);
            return true;
          }
          this.report(goal, save, { action: 'out_of_sight', to: { x: cover.cell.x, y: cover.cell.y, z: cover.cell.z }, blocks: cover.steps, threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, stance: true });
          const from = bot.entity.position.clone();
          let walkWhy = null;
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cover.cell.x, cover.cell.y, cover.cell.z), { timeoutMs: Math.max(3000, secs * 3000, (coverEdge?.seconds || 0) * 3000), stallMs: 1200, ...(coverEdgeCells.size ? { edgeTaken: n => coverEdgeCells.has(`${n.x},${n.y},${n.z}`) } : {}) }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; walkWhy = err.message; }
          const there = feetCell(bot).equals(cover.cell);
          if (there) { hideAt(cover.cell); return true; }
          // Not there: why, said, and the spot passed over from here.
          const moved = Math.round(bot.entity.position.distanceTo(from) * 10) / 10, short = Math.round(cover.cell.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10;
          const why = `the walk to the spot at (${cover.cell.x}, ${cover.cell.y}, ${cover.cell.z}) ended ${short} blocks short of it, ${moved < 1 ? 'where it began' : `${moved} blocks from where it began`}${walkWhy ? `: ${walkWhy}` : ''}`;
          this.state.coverFailed = [...coverFailed, { cell: `${cover.cell}`, at: Date.now(), why, from: { x: feet.x, y: feet.y, z: feet.z } }].slice(-6);
          this.state.stanceWhy = why;
          return false;
        } };
    }
    // The L dug in: two in and one to the side, its end out of every
    // shooter's line with the rock that is left (bunker.js nookSite).
    const inNook = this.state.nook && `${feet}` === this.state.nook.end;
    const nook = !inNook && seenHere.length && !inWater(bot) && typeof this.actions.dig === 'function' ? require('./bunker').nookSite(bot, shooting) : null;
    if (nook || inNook) {
      const setup = nook ? Math.round((nook.ms + nook.cells.length * 250) / 100) / 10 : 0;
      const regain = regainAt(nook ? nook.end : feet, { open: nook ? new Set(nook.cells.flatMap(c => [`${c}`, `${c.offset(0, 1, 0)}`])) : null, setup });
      const nookCost = stanceCost({ mobs, setup, fight: { atOnce: 1, only: m => !m.shoots }, reaches: reachesAgain(regain), shield: shielded });
      const walk = nook && nook.walkMs ? ` from the wall ${Math.round(nook.stand.offset(0.5, 0, 0.5).distanceTo(bot.entity.position) * 10) / 10} blocks off` : '';
      // In it, with a shooter come round to a line into it: said as it is.
      const seesIn = inNook ? seenHere : [];
      options.nook = { expects: { damage: nookCost.damage, seconds: nookCost.seconds, oneHit },
        description: (nook
          ? `Dig an L into the rock${walk}: two blocks in and one to the side, ${nook.blocks} blocks ${nook.with}, about ${setup} seconds of digging and stepping in, shot at meanwhile; no line from ${shooterNames(shooting)} reaches its end.`
          : seesIn.length
            ? `Stay round the turn of the nook dug here: ${seesIn.map(e => `the ${e.name.replaceAll('_', ' ')} ${Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10} blocks off`).join(' and ')} ${seesIn.length === 1 ? 'has' : 'have'} a line into it now.`
            : `Stay round the turn of the nook dug here: no line from ${shooterNames(shooting)} reaches it.`) +
          ' What bites comes to the mouth and round the turn one at a time and is fought at arm\'s length.' + regainSays(regain) + (nook ? buildCost + creeperNote : '') +
          costSays(nookCost, bot.health, mobs, { doing: nook ? 'digging in' : null, done: 'Round the turn' }) + hitsLeft,
        run: async () => {
          if (inNook) {
            this.report(goal, save, { action: 'nook_hold', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health });
            hideAt(feet);
            const w = this.state.nook.watch;
            if (w) await bot.lookAt?.(new Vec3(w.x + 0.5, w.y + 1.2, w.z + 0.5), true);
            await sleep(250);
            return true;
          }
          this.report(goal, save, { action: 'dig_nook', stand: { ...nook.stand }, end: { ...nook.end }, blocks: nook.blocks, threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, stance: true });
          try {
            const dug = await require('./bunker').digNook(bot, task, nook, { navigate: this.actions.navigate });
            if (!dug) return false;
            this.state.nook = { end: `${nook.end}`, watch: { x: nook.watch.x, y: nook.watch.y, z: nook.watch.z } };
            hideAt(nook.end);
            return true;
          } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
        } };
    }
    // Built against the biters that can get to the bot, seen or not, the
    // side toward the soonest first (pocketPlan, note 581).
    const pocketFor = [...coming, ...hiddenNear, ...far].filter(t => !shooter(t.entity) && !['creeper', 'warden'].includes(t.entity.name));
    const plan = pocketPlan(bot, feet, pocketFor);
    const race = pocketRace(bot, pocketFor, plan);
    // Underground the dawn changes nothing: no mob there burns in it.
    const nightLong = shelterNeeded(bot) && surfaceObserver(bot)(bot.entity.position) ? ` At night the mobs outside do not lose interest: about ${minutesToDawn(bot)} real minutes to dawn.` : '';
    // The blocks against what the crowd deals while they go down: mid-92-e
    // and mid-83-d chose pockets of twenty to thirty-four blocks with a
    // zombie at arm's length and four shooters about, and neither was shut.
    // A biter at the bot before the ways in are shut stands in a gap or
    // drops in (sealHere does not place a block where a body is), and the
    // pocket does not close on it: it hits from when it is there on; one
    // that comes after finds them shut. A mob in the bot's own cells is
    // inside the pocket: shut in with it.
    const getsIn = m => bites(m) && !!plan && arrives(m) < plan.shutAt;
    const sealPriced = plan ? stanceCost({ mobs: mobs.filter(m => !bites(m) || getsIn(m)), setup: plan.seconds, reaches: m => inCellIds.has(m.id) || getsIn(m) }) : null;
    const sealCost = (inCell.length ? ` ${ownCellsSays(inCell)}: ${inCell.length === 1 ? 'it is' : 'they are'} inside the pocket, and closed, it shuts ${inCell.length === 1 ? 'it' : 'them'} in with the bot.` : '') + (sealPriced ? costSays(sealPriced, bot.health, mobs, { doing: 'building', done: 'Shut in' }) : '');
    if (shelter.materialStock(bot) >= 4) options.seal = { ...(sealPriced ? { expects: { damage: sealPriced.damage, seconds: sealPriced.seconds, oneHit } } : {}), description: 'Close a two-block pocket around the bot where it stands and wait inside for the mobs to lose interest; no fighting.' + race + buildCost + creeperNote + sealCost + nightLong + unseen + (high ? ` The bot stands ${high} block${high === 1 ? '' : 's'} above the ground beside it: the walls go up beside nothing, placed against open air.` : ''),
      run: () => this.sealHere(task, goal, save, danger) };
    // The classic enderman roof (note 727, after 713's and 718's own "not
    // fixed"): an enderman is 2.9 blocks tall and cannot path into a cell
    // under three blocks of headroom, so a lid one block above the bot's
    // own head (or a two-high gap already there) keeps it out for good,
    // not just until a second one joins the crowd (the single-enderman
    // fast path above, gated to exactly one within eight blocks and
    // nothing else); the sword still reaches out and strikes its legs from
    // under it. Cheap next to `seal`'s full shell (one block and a couple
    // of seconds, not eight to thirty), and unlike `seal` the bot keeps
    // fighting instead of waiting blind. Offered only where every threat
    // about is an enderman: a zombie or a spider fits under the same lid
    // and would go on landing its own hits.
    if (danger.length && danger.every(t => t.entity.name === 'enderman')) {
      const roof = require('./enderman-roof');
      const plan = roof.roofPlan(bot);
      if (plan) {
        // While the lid goes up (or the step into a gap is taken), an
        // enderman already at arm's length lands the same as any build
        // costs (armsLength, buildCost above); once up, none can land
        // another, so the price stops at the setup, not carried through
        // the fight that follows.
        const capCost = stanceCost({ mobs: mobs.filter(m => m.name === 'enderman'), setup: plan.seconds, reaches: m => arrives(m) < plan.seconds });
        const stepWords = plan.kind === 'here' ? 'Already under a two-high ceiling here' : plan.kind === 'gap' ? `Step ${plan.blocks === 0 && plan.cell.distanceTo(feet) < 1.5 ? 'onto' : 'into'} a two-high gap already ${Math.round(plan.cell.distanceTo(feet))} block${Math.round(plan.cell.distanceTo(feet)) === 1 ? '' : 's'} off` : 'Place one block above the bot\'s own head, capping the space here at two blocks high';
        options.cap_fight = { ...(plan.kind !== 'here' ? { expects: { damage: capCost.damage, seconds: capCost.seconds, oneHit } } : {}),
          description: `${stepWords}: an enderman cannot path into a cell that low, so once the lid is up none still about can ever land a hit, and the sword goes on reaching its legs from here.` + (plan.kind === 'place' ? buildCost : '') + (plan.kind === 'here' ? '' : costSays(capCost, bot.health, mobs, { doing: plan.kind === 'place' ? 'placing the lid' : 'stepping in', done: 'Capped' })) + (danger.length > 1 ? ` ${danger.length} endermen about; capped, they are taken one at a time, whichever is struck.` : ''),
          run: async () => {
            this.report(goal, save, { action: 'cap_overhead', kind: plan.kind, blocks: plan.blocks, threats: danger.length, health: bot.health, stance: true });
            if (!await roof.takeRoof(bot, task, this.actions, plan)) return false;
            return fightStance ? fightStance.run() : false;
          } };
      }
    }
    // Down into the ground where the bot stands, a block over its head: a
    // player's pocket in a crowd, two or three digs and one block where the
    // pocket above takes twenty to thirty-four (shelter.shell) on open
    // ground. The night's shaft pocket (digShaft), straight down from here
    // only: a walk to another column is a walk through the crowd.
    const column = typeof this.actions.dig === 'function' && typeof this.actions.place === 'function' && shelter.materialStock(bot) >= 1 && !inWater(bot) ? this.shaftColumn({ radius: 0 }) : null;
    // Not offered where its dig would refuse at once: a biter within three
    // follows the bot down an open shaft, and digShaft stops for one (note
    // 410's rule). mid-205-p chose it three times with a zombie and a
    // spider at arm's length, each ended at once, and the crowd had it
    // between the tries (note 455).
    const biterClose = coming.some(t => t.distance <= 3 && !shooter(t.entity) && t.entity.name !== 'creeper');
    if (column?.bottom && column.start.equals(feet) && !biterClose) {
      const { seconds: setup, depth } = shaftSeconds(bot, column);
      // A creeper that walks up to the lid goes off through it: mid-220-c dug
      // down three with one seventeen blocks off, told "none of them reaches
      // it", and the blast came through the cap fourteen seconds later
      // (2026-09-26).
      // A biter at the shaft's top before the lid drops in onto the bot and
      // stays (note 581).
      const digCost = stanceCost({ mobs, setup, reaches: m => m.name === 'creeper' || m.name === 'warden' || (bites(m) && arrives(m) < setup) });
      // The race it is, as the pocket's is said: mid-229-r dug down with a
      // zombie eight blocks off, 5.4 seconds of digging against its two of
      // walking; the three came to the shaft's top before the lid, the dig
      // stopped for them, and they dropped in on the bot (note 526).
      // At its own speed: a spider twelve blocks off is at the top in under
      // three seconds, a zombie in four and a half (combat-estimate).
      const walkIn = t => Math.max(0, t.distance - 1.5) / blocksPerSecond(t.entity.name);
      const firstBiter = danger.filter(t => !shooter(t.entity) && t.entity.name !== 'creeper' && !apart.ids.has(t.entity.id)).sort((a, b) => walkIn(a) - walkIn(b))[0];
      const biterAt = firstBiter ? Math.round(walkIn(firstBiter)) : null;
      const digRace = firstBiter && biterAt < setup ? ` The ${firstBiter.entity.name.replaceAll('_', ' ')} ${Math.round(firstBiter.distance)} blocks off can be at the shaft's top in about ${biterAt} second${biterAt === 1 ? '' : 's'}, before the lid: a biter within three stops the dig (it follows down an open shaft), and the bot is left at the foot of an open shaft that mobs drop into, onto it.` : '';
      options.dig_down = { expects: { damage: digCost.damage, seconds: digCost.seconds, oneHit }, description: `Dig straight down ${plural(depth, 'block')} where the bot stands, put a block over its head and wait inside for the mobs to lose interest; no fighting. Walled in the ground on every side; about ${setup} seconds of digging and the one block.` + digRace + buildCost + creeperNote + costSays(digCost, bot.health, mobs, { doing: 'digging down', done: 'Shut in below' }) + nightLong,
        run: async () => {
          this.report(goal, save, { action: 'dig_down', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health, depth, stance: true });
          try { return await this.digShaft(task, goal, save, { start: column.start, bottom: column.bottom, spot: column.spot, here: feet, stance: true }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
        } };
    }
    // Something to eat, as a stance: in an encounter the meal is Jev's to
    // choose, not a reflex between two of its stances (vitals.js). mid-83-d
    // ate for three seconds at twelve health in the middle of the retreat
    // it had chosen, and mid-92-g twice under a skeleton's arrows; of 56
    // retreats chosen with three or more mobs about, 15 had a meal within
    // five seconds.
    const meal = mealHelps(bot);
    // Eaten where the bot stands, the shooters that shoot meanwhile are those
    // with a line to it here, by the same check the stands are priced with
    // (bunker.js seenFrom). mid-235-p-nether-3 stood at 0.5 health, hunger
    // 16 and mutton carried, twenty seconds by a wall no blaze had a line
    // to; the wall was priced at 0 and the meal at 7.2 from blazes counted
    // as in sight a moment before, and it never ate (note 533).
    const seenIds = new Set(seenHere.map(e => e.id));
    const eatMobs = shooting.length ? mobs.map(m => m.shoots && m.id != null && !seenIds.has(m.id) ? Object.defineProperty({ ...m, visible: false }, 'id', { value: m.id }) : m) : mobs;
    // The wither and poison a blow in the meal leaves are counted whole,
    // past the meal's own seconds (note 601).
    const eatCost = stanceCost({ mobs: eatMobs, setup: EAT_SECONDS, seconds: EAT_SECONDS, effectsTo: EAT_SECONDS + 10 });
    // Whether the meal can be eaten here before a shot lands (note 701): the
    // shooters with a line here, each at its next shot (a blaze's glow, a
    // draw, a ghast's mouth), and the spawner's clock.
    const eatFinish = (() => {
      if (!meal || !seenHere.length) return { says: '' };
      try {
        const bs = require('./blaze-stand'), sr = require('./shot-reflex');
        const here = bot.entity.position;
        const lined = seenHere.map(e => ({ name: e.name, distance: e.position.distanceTo(here),
          inSeconds: e.name === 'blaze' ? bs.volleyIn(bot, e) : sr.warningOn(bot, e) && e._shotWarn ? Math.max(0, (e._shotWarn.kind === 'ghast' ? 0.5 : 1) - (Date.now() - e._shotWarn.at) / 1000) : 1 }));
        const cage = seenHere.some(e => e.name === 'blaze') ? bs.spawnerAt(bot) : null;
        const clock = cage && cage.offset(0.5, 0.5, 0.5).distanceTo(here) <= 16 ? require('./spawner-clock').nextTry(bot, cage) : null;
        return require('./meal').finishSays(lined, clock);
      } catch (_) { return { says: '' }; }
    })();
    const eatSight = shooting.length && seenIds.size < shooting.length ? ` Of the ${shooting.length} shooter${shooting.length === 1 ? '' : 's'} about, ${seenIds.size ? `${seenIds.size} ha${seenIds.size === 1 ? 's' : 've'}` : 'none has'} a line to the bot where it stands, and one without shoots while it eats only if it comes round to a line.` : '';
    // What the bot meets them with after it, beside what the fight here
    // costs: its figure is the meal's second and a half only, where every
    // other stance is priced over fifteen, and mid-229-r's replay took it at
    // 12.7 health five times in five with three zombies in the bot's cell,
    // the fight priced at 14 (note 526).
    // And one coming that is at the bot just as the meal ends, said with
    // when: mid-242-ah-fortress-1 ate told "about 0 damage" with a wither
    // skeleton 2.1 seconds off, and its blow landed 0.1 seconds after the
    // meal, the shield down; 14.5 to 10, and the wither after (note 601).
    // A shield raised is a quarter second from blocking.
    const { arrives: arrivesAt } = require('./combat-estimate');
    const nextBiter = !armsLength && !noStep ? eatMobs.filter(m => !m.apart && !m.far && !m.shoots && m.name !== 'creeper' && m.hitsBot > 0)
      .map(m => ({ m, at: arrivesAt(m) })).filter(x => x.at < EAT_SECONDS + 1.5).sort((a, b) => a.at - b.at)[0] : null;
    // Within the meal, it strikes with the hand busy and the shield down
    // (mid-243-af-fortress-3 ate at 6.4 health told "about 5 damage", a
    // wither skeleton 6.4 blocks off: its blow took 4.8 and the wither the
    // rest, note 601).
    const nextSays = nextBiter ? (() => { const m = nextBiter.m, r1 = x => Math.round(x * 10) / 10, blow = `about ${m.hitsBot} after armour${m.withers ? ', and the wither after it, about 5 more over ten seconds that armour does not stop' : ''}`;
      return nextBiter.at < EAT_SECONDS
        ? ` The ${m.name.replaceAll('_', ' ')} ${Math.round(m.distance)} blocks off, at its own speed, is at arm's length about ${r1(nextBiter.at)} seconds into the meal, the hand busy and the shield down: its blow, ${blow}, lands before the meal is eaten.`
        : ` The ${m.name.replaceAll('_', ' ')} ${Math.round(m.distance)} blocks off, at its own speed, is at arm's length about ${r1(nextBiter.at - EAT_SECONDS)} seconds after the meal ends (${r1(nextBiter.at)} from now), the sword not yet back in hand and the shield a quarter second from blocking once raised: its first blow, ${blow}, can land as the meal ends.`; })() : '';
    const eatLeaves = (armsLength || nextBiter) && !noStep ? (() => { const h = Math.round(Math.max(0, bot.health - eatCost.damage) * 10) / 10;
      return `${nextSays} It deals with none of them: they meet the bot with about ${h} health where it has ${Math.round(bot.health * 10) / 10} now, and the fight here is about ${cost.damageTaken} damage${cost.damageTaken >= h ? ` (more than ${h})` : ''}.`; })() : '';
    // Held to what it was said to cost: mid-205-a chose to eat told about
    // 1.6 seconds, and ate on for four more with two zombies hitting and a
    // creeper walking up to it (2026-09-26).
    // A creeper coming on while the bot stands to eat: where its fuse is
    // when the meal ends (creeper-run.js). mid-242-af-nether-2-fortress-2's
    // meal was told "about 0 damage" with a creeper 7 blocks off walking in
    // at 2.7 a second: within three and lit 1.5 seconds in, the meal done
    // with the fuse all but burning where it stands (note 604).
    const eatCreeper = meal ? creeperAfterMeal(bot, this.creepersOfRun(danger)) : '';
    if (meal && !(this.state.mealCutAt > Date.now() - MEAL_CUT_MS)) options.eat = { expects: { damage: eatCost.damage, seconds: EAT_SECONDS, oneHit }, description: eatSays(bot, meal) + (armsLength ? ' Something that bites is at arm\'s length now, and it hits freely while the bot eats.' : '') + costSays(eatCost, bot.health, mobs, { over: 'while it eats' }) + eatSight + EAT_AFTER + eatFinish.says + eatCreeper + eatLeaves,
      run: async () => {
        this.report(goal, save, { action: 'eat', item: meal.name, food: bot.food, health: bot.health, stance: true });
        // Marked before the meal and cleared when it is eaten: a meal cut
        // short, however it was cut, is not offered again for ten seconds.
        // mid-235-g chose to eat with two drowned at arm's length; the meal
        // began every half second and was never eaten, food at seventeen
        // throughout, twelve health to none (2026-09-27).
        // Eaten is hunger up: the consume came back in half a second with
        // nothing eaten while a zombie hit, was taken for a meal and the
        // mark cleared, and mid-227-f began its beef nine times (2026-09-27).
        this.state.mealCutAt = Date.now();
        try { return await this.eatChosen(task, meal); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      } };
    // Out of every line first, then the meal (note 701): where a spot no
    // shooter's line reaches is a short walk off and one has a line here.
    if (meal && cover?.steps && seenHere.length && !(this.state.mealCutAt > Date.now() - MEAL_CUT_MS)) {
      const secs = Math.round(cover.steps / 4.3 * 10) / 10;
      const regain = regainAt(cover.cell, { setup: secs });
      // The walk in their fire, then the meal where only what comes round
      // to a line or to arm's length reaches it.
      const outCost = stanceCost({ mobs, setup: secs, seconds: secs + EAT_SECONDS, reaches: m => !m.shoots || reachesAgain(regain)(m), effectsTo: secs + EAT_SECONDS + 10 });
      options.step_out_and_eat = { expects: { damage: outCost.damage, seconds: outCost.seconds, oneHit },
        description: `Walk ${plural(cover.steps, 'block')} (about ${secs} seconds, in their fire meanwhile) to a spot no line from ${shooterNames(shooting)} reaches, then eat the ${meal.name.replaceAll('_', ' ')} there (about ${EAT_SECONDS} seconds).${regainSays(regain)}` + costSays(outCost, bot.health, mobs, { over: 'over the walk and the meal', doing: 'walking there', done: 'Out of their line' }),
        run: async () => {
          this.report(goal, save, { action: 'step_out_and_eat', to: { x: cover.cell.x, y: cover.cell.y, z: cover.cell.z }, blocks: cover.steps, item: meal.name, health: bot.health, stance: true });
          let walkWhy = null;
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cover.cell.x, cover.cell.y, cover.cell.z), { timeoutMs: Math.max(3000, secs * 3000), stallMs: 1200 }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; walkWhy = err.message; }
          if (!feetCell(bot).equals(cover.cell)) {
            this.state.stanceWhy = `the walk to the spot at (${cover.cell.x}, ${cover.cell.y}, ${cover.cell.z}) out of their line did not get there${walkWhy ? `: ${walkWhy}` : ''}`;
            return false;
          }
          hideAt(cover.cell);
          this.state.mealCutAt = Date.now();
          try { return await this.eatChosen(task, meal); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
        } };
    }
    // The charge at a few ground shooters, where it can be run.
    const ground = danger.filter(t => t.visible && GROUND_SHOOTERS.has(t.entity.name) && t.distance <= 16);
    // Offered only where it can run: its run refuses the water (either test of
    // it) and the air, and mid-202-h, offered it waist-deep in a stream, had
    // it fail at once and rest twenty seconds, leaving shelters that cost
    // more than its health and working on; it was shot at 3.2 (2026-09-27).
    // Not a charge whose ground carries no step toward the shooter: from a
    // pillar mid-244-s was offered one "stopping after 0 blocks", chose it,
    // and it ended at once, twice, arrows every three seconds (note 416).
    const chargeMoves = ground.length && chargeStopsAt(bot, ground[0].entity)?.blocks !== 0;
    if (chargeMoves && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && !inWater(bot) && !bot.entity.isInWater && !isSetAside(this, 'close_on_shooter', 'here')) options.charge_shooter = {
      expects: { damage: cost.damageTaken, seconds: cost.seconds, oneHit },
      description: `Run at the ${ground.map(t => t.entity.name).join(', ')} (nearest ${Math.round(ground[0].distance)} blocks) and strike, one after another, over ground checked firm; gives way if it cannot get nearer, and hands back to be chosen again once it has cost more health or time than estimated here.${(() => { const stop = chargeStopsAt(bot, ground[0].entity); return stop ? ` The ground straight at the nearest does not carry the charge there: it stops after ${stop.blocks} block${stop.blocks === 1 ? '' : 's'}, ${stop.left} short, in the line of fire.` : ' The ground straight at the nearest carries the charge to it.'; })()}${chargeSays(bot, ground[0].entity)} Estimated for all the mobs here with this weapon and armour: about ${cost.seconds} seconds and ${cost.damageTaken} damage, from ${cost.healthNow} health${cost.healthAfter <= 0 ? ' (more than the bot has)' : ''}; about ${cost.inFifteenSeconds} of it in the first fifteen seconds.${cost.poison ? ` ${cost.poison}` : ''}${creeperLeftOut}${unseen}${edge}${hitsLeft}`,
      run: () => this.closeOnShooter(task, goal, save, danger, { chosen: true }) };
    // A creeper the player's way: hit, back out of the blast, hit again.
    // Possible with a blade and no drop or lava to back into.
    const feetDrop = dropWithin(bot, feet, 2) || lavaBeside(bot, feet);
    if (coming.some(t => t.entity.name === 'creeper' && t.distance <= 6) && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && !feetDrop) options.creeper_dance = {
      // What it costs, said as the fight's figures say it: the blast where
      // it goes off, or none where the swings kill it inside its fuse. It
      // said the knockback put the fuse out; a hit does not (26.1.2
      // SwellGoal), and mid-241-a's fight, which meets a creeper this same
      // way, took a blast three blocks off with a wall behind (note 529).
      // Trial 114 danced at twelve health with no armour and a zombie
      // beside it, and one blast was all of it.
      description: `Hit the creeper, then back out to where its blast does nothing, or hold at reach where the swings left kill it before it goes off; close in to hit again when it comes on. Other creepers are backed from the same way, other mobs are not watched.${creeperFoughtText()} The bot has ${Math.round(bot.health)} health and ${[5, 6, 7, 8].filter(slot => bot.inventory.slots?.[slot]).length} pieces of armour on.${(() => {
        // How many there are, and how many blasts the health takes: mid-215-b
        // danced with three creepers five to seven blocks off, told only of
        // one blast, and two went off (2026-09-26).
        const creepers = coming.filter(t => t.entity.name === 'creeper');
        // The blast where one goes off here (the fight's figure), and how
        // many of those the health takes.
        const blast = (estimate.mobs || []).find(m => m.name === 'creeper')?.fought?.blast;
        const count = creepers.length > 1 ? ` ${creepers.length} creepers are here (${creepers.map(t => Math.round(t.distance)).join(', ')} blocks off): the dance hits one at a time while the others come on.` : '';
        const blasts = blast ? ` Gone off where the dance backs to here, a blast is about ${blast} after the armour worn: ${Math.max(1, Math.ceil(bot.health / blast))} of them end${Math.ceil(bot.health / blast) === 1 ? 's' : ''} it.` : '';
        // Lit, with neither the swings nor the room behind fitting in its
        // fuse, the dance does not answer it: mid-243-aa took the dance at
        // 1.7 blocks from a lit creeper with its own blocks at the bot's
        // back, and one blast took 20 (note 547).
        const lit = (estimate.mobs || []).find(m => m.name === 'creeper' && m.fought?.litNowFuseLeft != null && !m.fought.diesBeforeItGoesOff && m.fought.blast > 0)?.fought;
        const nothing = lit ? ` Nothing the dance does here stops it: the creeper is lit, about ${lit.litNowFuseLeft} seconds of its fuse left; the swings take about ${lit.secondsToKillIt} seconds to kill it, and ${lit.roomBehind != null && lit.roomBehind <= 0 ? `with no room behind the bot to back into it goes off about ${lit.goesOffAt} blocks off` : `${lit.roomBehind != null ? `the ${lit.roomBehind} block${lit.roomBehind === 1 ? '' : 's'} of room behind the bot back${lit.roomBehind === 1 ? 's' : ''} it` : 'backing at a walk in the fuse left takes it'} only to about ${lit.goesOffAt} blocks off, where it goes off`}: about ${lit.blast} after the armour worn${lit.blast >= bot.health ? ', more than the bot has' : ''}.` : '';
        return count + nothing + blasts; })()}${edge}`,
      run: () => this.creeperDance(task, goal, save, danger, swung, { chosen: true }) };
    // Leave them be: the work goes on, and they are a threat again when one
    // comes within three blocks or lands a hit, or after fifteen seconds.
    // Priced by the others' real reach, how soon each that can get to the
    // bot is at it at its own speed, and said with where the work stands:
    // mid-244-ad-nether-2's carry-on was "nearest 8 blocks", the piglin that
    // had no way onto the bridge, and the drop's knock beside it, with
    // nothing of the crossing it would go on with (note 566).
    const reachers = coming.filter(t => !shooter(t.entity));
    const reachSays = (() => {
      if (!coming.length) return ' None of the mobs here can get to the bot, and none of them shoots: nothing here stops the work while that holds, nor can knock the bot anywhere.';
      if (!reachers.length) return '';
      const soon = reachers.map(t => ({ t, at: Math.round(Math.max(0, t.distance - 1.5) / blocksPerSecond(t.entity.name) * 10) / 10 })).sort((a, b) => a.at - b.at);
      const first = soon[0];
      return ` Of those that can get to the bot, the nearest, the ${first.t.entity.name.replaceAll('_', ' ')} ${Math.round(first.t.distance)} blocks off, can be at it in about ${first.at} seconds at its own speed${soon.length > 1 ? `, and ${soon.length - 1} more after it` : ''}.`;
    })();
    // At a live spawner with rods still owed (cage-hold.js cageFight), that
    // is the work in hand, not a stale hunt step: `goal.step` can still
    // hold `open_a_door` from an earlier chase that ended when the stalk
    // gave up, and saying "(open a door)" here at the spawner is what was
    // last tried, not what carrying on means now (25589, critic 05:44Z,
    // note 725).
    let atCage = null;
    try { atCage = require('./cage-hold').cageFight(bot, goal); } catch (_) { atCage = null; }
    const workLabel = atCage ? 'waiting at the spawner for blazes' : (goal?.step?.action === 'combined_request' ? goal.step.detail?.action : goal?.step?.action);
    if (!coming.some(t => t.distance <= 3)) options.keep_working = { description: `Carry on with the work${(w => w ? ` (${atCage ? w : w.replaceAll('_', ' ')})` : '')(workLabel)} and leave these mobs be for fifteen seconds${coming.length ? ` (nearest that can get to the bot ${Math.round(coming[0].distance)} blocks)` : ''}.${this.workProgress(goal)}${reachSays} The work stops at once if one comes within three blocks or lands a hit. Suits mobs that are far, slow, cannot reach the bot, or are not coming this way.${creeperCount ? (() => {
      // When the work would stop, against when the creeper lights: the
      // work stops at three blocks, which is where the fuse starts (the
      // decision review, 2026-09-26).
      const { APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
      const c = coming.filter(t => t.entity.name === 'creeper').sort((a, b) => a.distance - b.distance)[0];
      // The work stops where the wave-off lets go of it (danger.js
      // creeperFar, a second and a half's walk past its fuse's reach), not
      // at three blocks as this had said (note 677).
      const stopAt = LIGHTS_AT + APPROACH * 1.5;
      const secs = Math.max(0, Math.round((c.distance - LIGHTS_AT) / APPROACH * 10) / 10);
      const stopSecs = Math.max(0, Math.round((c.distance - stopAt) / APPROACH * 10) / 10);
      return ` The creeper ${Math.round(c.distance)} blocks off, coming on, is at ${stopAt} blocks in about ${stopSecs} seconds: that is when the work stops and the stance is asked again; at three blocks, in about ${secs} seconds, its fuse lights; it goes off ${FUSE} seconds later unless the bot is more than seven blocks off or out of its sight by then; a blast six blocks off or more does nothing.`;
    })() : ''}${(() => { const shooting = (estimate.mobs || []).filter(m => m.shoots && m.visible && !m.quiet); if (!shooting.length) return ''; const in15 = Math.round(stanceCost({ mobs: shooting, setup: HOLD_SECONDS, seconds: HOLD_SECONDS, health: bot.health }).damage); return ` The ${shooting.length === 1 ? shooting[0].name.replaceAll('_', ' ') : `${shooting.length} shooters`} in sight keep${shooting.length === 1 ? 's' : ''} shooting while the bot works: about ${in15} damage in the fifteen seconds, from ${Math.round(bot.health)} health${in15 >= bot.health ? ', more than the bot has' : ''}; the first hit ends it.`; })()}${unseen}${edge}${hitsLeft}`,
      run: async () => {
        bot._wavedOff = { ids: danger.map(t => t.entity.id), until: Date.now() + 15000 };
        this.report(goal, save, { action: 'keep_working', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, stance: true });
        return true;
      } };
    // A golden apple carried is what a fight at low health is kept for:
    // trial 81 took one from a dungeon chest in its first minute and died to
    // a spider two minutes later with it still in the pack, never offered.
    const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple') || bot.inventory.items().find(i => i.name === 'golden_apple');
    // Priced as every stance is (mid-205-q, note 475: the only one without
    // its damage and health said, and taken at 0.04 against take_cover's
    // "0.8 damage from 2.8 health").
    if (apple && bot.health < 20) options.eat_golden_apple = { expects: { damage: eatCost.damage, seconds: EAT_SECONDS, oneHit },
      description: (apple.name === 'enchanted_golden_apple'
        ? `Eat the enchanted golden apple now (${countOf(bot, apple.name)} carried): about 1.6 seconds eating while the mobs hit, then sixteen extra health as absorption, strong regeneration for twenty seconds, and resistance and fire resistance for five minutes. Worth more later in the game than any other food.`
        : `Eat the golden apple now (${countOf(bot, apple.name)} carried): about 1.6 seconds eating while the mobs hit, then four extra health as absorption and regeneration of about eight health over five seconds. Eight gold ingots and an apple to make another.`) + costSays(eatCost, bot.health, mobs, { over: 'while it eats' }) + creeperAfterMeal(bot, this.creepersOfRun(danger)),
      run: async () => {
        this.report(goal, save, { action: 'eat', item: apple.name, food: bot.food, health: bot.health, stance: true });
        return eatApple(bot, task, apple);
      } };
    // A fire resistance potion carried where fire is coming: a blaze in
    // sight or the body alight (note 656). Priced as the meal is, over the
    // seconds it takes, with the fight here after it set beside the fight
    // without it.
    const fr = require('./fire-resistance');
    const firePotion = fr.carried(bot)[0];
    const fireComing = (estimate.mobs || []).some(m => require('./combat-estimate').FIRE_SHOTS.has(m.name) && m.shoots && m.visible && !m.apart) || !!(bot.entity?.metadata?.[0] & 1);
    const proofLeft = fr.left(bot);
    if (firePotion && fireComing && proofLeft < HOLD_SECONDS * 2) {
      const takes = firePotion.kind === 'drink' ? fr.DRINK_SECONDS : fr.SPLASH_SECONDS;
      const drinkCost = stanceCost({ mobs: eatMobs, setup: takes, seconds: takes, effectsTo: takes + 10 });
      const withIt = fightEstimate({ ...estimateArgs, fireproofFor: firePotion.seconds }).fightHere.inFifteenSeconds;
      const count = fr.carried(bot).reduce((n, p) => n + (p.item.count || 1), 0);
      options.drink_fire_resistance = { expects: { damage: drinkCost.damage, seconds: takes, oneHit },
        description: `${firePotion.kind === 'drink' ? 'Drink' : 'Throw at the feet'} ${fr.kindSays(firePotion)} now (${count} carried): ${fr.clock(firePotion.seconds)} of fire resistance from then, running down whatever is done${proofLeft > 0 ? `; about ${Math.round(proofLeft)} seconds of it are on the body now, and the potion sets it to its length, it does not add` : ''}. ${fr.WHAT} The fight here over fifteen seconds, the stance after it asked again: about ${cost.inFifteenSeconds} damage as the bot is, about ${withIt} with the effect on.` + costSays(drinkCost, bot.health, mobs, { over: `while it ${firePotion.kind === 'drink' ? 'drinks' : 'throws'}` }),
        run: async () => {
          this.report(goal, save, { action: 'drink_fire_resistance', kind: firePotion.kind, health: bot.health, stance: true });
          return fr.drink(bot, task, firePotion);
        } };
    }
    // Where a run could go, said before it is chosen: with three or more
    // mobs about, 25 of the 39 retreats chosen with none at arm's length in
    // the midgame trials of 2026-09-25 and 26 found no way and failed (a
    // retreat that failed did so in 1.2 seconds on the median), and the next
    // stance was asked from lower health. The way found before the question
    // (scoutRetreat), or at least the footing.
    const runShotCost = seconds => stanceCost({ mobs: mobs.filter(m => m.shoots), setup: seconds, seconds }).damage;
    const runShot = seconds => { const d = runShotCost(seconds); return d ? ` About ${d} damage from the shooters in range over those seconds, the shield down, from ${Math.round(bot.health * 10) / 10} health${d >= bot.health ? ' (more than the bot has)' : ''}.` : ''; };
    let footing = NO_ROUTE_YET, runExpects = null;
    const { creeperRunSays, standingAgainstCreepers } = require('./creeper-run');
    const runCreepers = this.creepersOfRun(danger), runWorn = require('./combat-estimate').armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
    // Whether the footing is out of the shooters' sight, as the run says
    // it goes: each shooter in sight that has a line to it from where it
    // is now, and what its shots cost there over the rest of the fifteen
    // seconds, the run's included. mid-242-ah-nether-2-fortress-5 was told
    // "a way is found ... about 4.5 damage" at 7.4 health, four times, to
    // footing a ghast 40 blocks off, in sight with a range of 64, had a
    // line to (note 621).
    const footingSight = (d, secs) => {
      const shooting = danger.filter(t => t.visible && shooter(t.entity)).map(t => t.entity);
      if (!shooting.length) return '';
      const cell = new Vec3(d.x, d.y, d.z), seen = require('./bunker').seenFrom(bot, shooting, cell);
      if (!seen.length) return ` No shooter in sight has a line to that footing from where it is now${shooting.some(e => e.name === 'ghast') ? ' (a ghast drifts, and may have one again)' : ''}.`;
      const ids = new Set(seen.map(e => e.id)), names = shooterNames(seen);
      // Every shooter in range over the run, then those with a line to it.
      const all = stanceCost({ mobs: mobs.filter(m => m.shoots), setup: secs, reaches: m => ids.has(m.id) }).damage;
      return ` The footing is not out of their sight: ${names} ${seen.length === 1 ? 'has' : 'have'} a line to it from where ${seen.length === 1 ? 'it is' : 'they are'} now, and ${seen.length === 1 ? 'its' : 'their'} shots go on there as here: about ${all} damage from the shooters in the next fifteen seconds this way, the run included, from ${Math.round(bot.health * 10) / 10} health${all >= bot.health ? ' (more than the bot has)' : ''}.`;
    };
    const scout = this.state.retreatScout;
    const scouted = scout && scout.feet === `${feet}` && Date.now() - scout.at < 2000 ? scout : null;
    if (onPillar) footing = ` The bot stands ${onPillar} blocks up on a pillar of its own, and a route drops three blocks at most: from up here there is no way off it to run by.`;
    else if (scouted) {
      // Held no longer than the run: a retreat that reached its footing was
      // held for fifteen seconds and run again from there without a
      // question, a spider at arm's length; the new run's route searches
      // stood the bot still for 3.8 seconds of bites, seven health to one
      // (mid-239-b, note 532). Past its seconds it is asked again.
      // A creeper about: the way walked in time against its fuse, and the
      // blast where it goes off counted in the price (creeper-run.js, note
      // 604); the run told "passing none of them" came back past one, or
      // dropped into its sight beside it.
      if (scout.destination) { const secs = Math.round(scout.blocks / SPRINT * 10) / 10, c = creeperRunSays(scout.creeper, { worn: runWorn, health: bot.health }); runExpects = { damage: Math.round((runShotCost(secs) + c.damage) * 10) / 10, seconds: Math.max(1, secs), oneHit }; footing = ` A way is found: ${scout.blocks} blocks to footing ${scout.gain} blocks further from every mob about, passing none of them, about ${secs} seconds at a run.${runShot(secs)}${c.says}${footingSight(scout.destination, secs)}`; }
      else if (!scout.spots) footing = ` Nowhere to run to: no footing within ${scout.radius} blocks is four blocks further than here from every mob about, so a run from here fails at once.`;
      else if (scout.tried >= scout.candidates) footing = ` No way out: none of the ${plural(scout.candidates, 'spot')} further from every mob has a route that passes none of them, so a run from here fails at once.`;
      // The rest are searched before a step is taken, up to 150 ms each
      // (wayAway), not as it runs; with a creeper coming on, only until it
      // would be within three (searchBudget).
      else {
        const budget = searchBudget(bot, runCreepers), rest = Math.max(1, Math.round((scout.candidates - scout.tried) * 0.15));
        const stands = Number.isFinite(budget) ? Math.max(0.3, Math.min(rest, budget / 1000)) : rest;
        const c = creeperRunSays(standingAgainstCreepers(bot, runCreepers, stands), { worn: runWorn, health: bot.health, standing: true });
        if (c.damage) runExpects = { damage: c.damage, seconds: stands, oneHit };
        footing = ` No way found yet: ${scout.tried} of ${plural(scout.candidates, 'spot')} further from every mob tried and none has a route passing none of them; the rest are tried before it moves, ${Number.isFinite(budget) && budget / 1000 < rest ? `for at most about ${Math.round(stands * 10) / 10} seconds standing still, until the creeper would be within three blocks, and the run then fails and this is asked again unless one is found` : `up to about ${rest} seconds standing still`}.${c.says}`;
      }
    }
    if (!scouted && !onPillar && runCreepers.length) {
      const stands = Math.min(3.6, searchBudget(bot, runCreepers) / 1000);
      const c = creeperRunSays(standingAgainstCreepers(bot, runCreepers, stands), { worn: runWorn, health: bot.health, standing: true });
      if (c.damage) runExpects = { damage: c.damage, seconds: stands, oneHit };
      footing += ` With a creeper coming on, the search stands still for at most about ${Math.round(stands * 10) / 10} seconds, until it would be within three blocks; with no way by then the run fails and this is asked again.${c.says}`;
    }
    const chase = chaseSays(bot, danger, { apartIds: apart.ids, destination: scouted?.destination, runSeconds: scouted?.destination ? scouted.blocks / SPRINT : null });
    // What they land on the way and after, priced (note 601).
    const runChase = chaseCost(bot, danger, { apartIds: apart.ids, destination: scouted?.destination, runSeconds: scouted?.destination ? scouted.blocks / SPRINT : null });
    if (runExpects && runChase.damage) runExpects.damage = Math.round((runExpects.damage + runChase.damage) * 10) / 10;
    // A rider on a horse or a camel is faster than a running player:
    // mid-215-a ran four times from a zombie on a zombie horse with a spear,
    // caught each time, 11.3 health to 4.4 in one charge (2026-09-26).
    const riders = danger.filter(t => t.entity.vehicle).map(t => `a ${t.entity.name.replaceAll('_', ' ')} on a ${t.entity.vehicle.name?.replaceAll('_', ' ') || 'mount'}`);
    const riderSays = riders.length ? ` ${riders[0][0].toUpperCase()}${riders[0].slice(1)}${riders.length > 1 ? ` and ${riders.length - 1} more riding` : ''} ${riders.length > 1 ? 'are' : 'is'} faster than a running player: a run from ${riders.length > 1 ? 'them' : 'it'} is caught.` : '';
    // An angry enderman teleports to whoever it is after: mid-211-m ran from
    // one three times, told only that a way was found, and was hit on
    // arrival each time, 16 health to none (2026-09-27).
    const endermen = danger.some(t => t.entity.name === 'enderman');
    // It runs at about 8.7 blocks a second angry, past the bot's sprint,
    // and teleports toward one more than sixteen off (combat-estimate MOBS
    // and CHASE, note 578).
    const endermanSays = endermen ? ` An enderman after the bot runs at about ${Math.round(blocksPerSecond('enderman') * 10) / 10} blocks a second, faster than the bot sprints (${Math.round(PLAYER_SPRINT * 10) / 10}), and teleports toward it once it is more than sixteen blocks off: a run from one ends with it beside the bot again.` : '';
    options.retreat = { ...(runExpects ? { expects: runExpects } : {}), description: 'Run for footing out of the mobs\' reach and sight by a route that passes none of them; shooters keep shooting while the bot runs.' + riderSays + endermanSays + footing + chase + runChase.says + unseen,
      run: () => this.runAway(task, goal, save, danger) };
    // With no way passing every mob, the way past the reach of what bites,
    // found before the question (scoutRetreat, reachFootings): the
    // shooters' fire over the run said, and how each that bites follows and
    // gives up (note 576).
    const past = !onPillar && scouted?.pastReach;
    if (past) {
      const secs = Math.round(past.blocks / SPRINT * 10) / 10;
      const each = past.from.map(f => `${f.blocks} from the ${f.name.replaceAll('_', ' ')} (it follows a player to ${f.follows})`);
      const c = creeperRunSays(past.creeper, { worn: runWorn, health: bot.health });
      const pastChase = chaseCost(bot, danger, { apartIds: apart.ids, destination: past.destination, runSeconds: secs });
      options.leave_reach = { expects: { damage: Math.round((runShotCost(secs) + pastChase.damage + c.damage) * 10) / 10, seconds: Math.max(1, secs), oneHit },
        description: `Run past the reach of what bites, taking the shooters' fire on the way: ${past.blocks} blocks to footing ${each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each.at(-1)}` : each[0]}, nearer the bot than any of them, by a route that passes none of those that bite (the shooters are not kept clear of), about ${secs} seconds at a run.${runShot(secs)}${c.says}` +
          chaseSays(bot, danger, { apartIds: apart.ids, destination: past.destination, runSeconds: secs }) + pastChase.says + unseen,
        run: () => this.leaveReach(task, goal, save, danger) };
    }
    // In the Nether with its portal close, the way home is a stance too:
    // mid-92-q came out beside its portal among skeletons and ghasts, turned
    // between six stances in twenty-five seconds and burned, the portal
    // five blocks off the whole time (2026-09-26).
    const portalId = bot.registry?.blocksByName?.nether_portal?.id;
    const portal = /nether/.test(String(bot.game?.dimension || '')) && portalId !== undefined && this.actions.returnOverworld && typeof bot.findBlocks === 'function'
      ? bot.findBlocks({ matching: portalId, maxDistance: 8, count: 1 })[0] : null;
    if (portal) {
      const blocks = Math.round(portal.distanceTo(bot.entity.position));
      options.portal_back = { description: `Go back through the portal ${blocks} block${blocks === 1 ? '' : 's'} off, to the Overworld where the bot came from: about ${Math.max(1, Math.round(blocks / 4.3))} second${blocks > 4 ? 's' : ''} to it and about four standing in it before it takes the bot, shot at meanwhile; the mobs here stay here. The work comes back through it afterwards.` + (armsLength ? ' Something that bites is at arm\'s length now, and follows the walk.' : '') + (coming.some(t => t.entity.name === 'hoglin') ? ' A hoglin shuns a nether portal\'s blocks as it does a warped fungus: within 8 blocks of them across and 4 up or down it attacks nothing and walks off.' : ''),
        run: async () => { this.report(goal, save, { action: 'portal_back', portal: { x: portal.x, y: portal.y, z: portal.z }, threats: danger.map(t => t.entity.name) }); await this.actions.returnOverworld(bot, task, goal, save); return true; } };
    }
    // What each shot is up against: arrows to bring it down (about six a
    // full draw) and, for one that walks, how soon it is at the bot.
    const shotFacts = t => {
      const { MOBS, APPROACH, LIGHTS_AT, FUSE } = require('./combat-estimate');
      const hp = MOBS[t.entity.name]?.health, arrows = hp ? Math.ceil(hp / 6) : null;
      // One with no way to the bot does not come on while it is shot at
      // (walk-reach.js): said as walking up, it was a race that is not
      // (note 566).
      const walks = !shooter(t.entity) && !apart.ids.has(t.entity.id);
      const at = t.entity.name === 'creeper' ? Math.max(0, (t.distance - LIGHTS_AT) / APPROACH) + FUSE : Math.max(0, (t.distance - 1.5) / APPROACH);
      return `${arrows ? ` About ${arrows} arrow${arrows === 1 ? '' : 's'} bring it down, about ${arrows} seconds of drawing.` : ''}${walks ? ` It walks on meanwhile: ${t.entity.name === 'creeper' ? `beside the bot and going off in about ${Math.round(at * 10) / 10} seconds if it keeps coming` : `at the bot in about ${Math.round(at * 10) / 10} seconds`}.` : !shooter(t.entity) ? ' It has no way to the bot from where it stands, so it does not come on meanwhile.' : ''}`;
    };
    // In water: the blocks of a pillar, a pocket or a bunker do not hold
    // the bot there (a pocket is full of water, a pillar's jump is a swim),
    // the bot sinks unless it swims, and a drowned is at home in it. Out
    // of the water is a stance of its own. mid-227-d fell into a flooded
    // pit with a drowned, chose the fight, the pillar and the bunker in
    // turn while it sank, and drowned-and-was-hit from fourteen to none;
    // no option said it was in water (2026-09-27).
    if (inWater(bot)) {
      for (const k of ['pillar', 'seal', 'bunker', 'dig_down', 'nook']) delete options[k];
      const drowned = danger.filter(t => t.entity.name === 'drowned').length;
      const wet = ` The bot is in water, air ${bot.oxygenLevel ?? 20} of 20 (air runs out in about fifteen seconds under water, then it drowns at two health a second), and sinks unless it swims; a pillar, a pocket or a bunker cannot be built here.${drowned ? ` ${drowned === 1 ? 'The drowned swims' : `${drowned} drowned swim`} faster than the bot in water.` : ''}`;
      if (options.fight) options.fight.description += wet;
      // The bank out of the shooters' sight first, and said: mid-211-l and
      // mid-211-n, swimming a stream under four pillager crossbows, had the
      // retreat find no route and every building stance fail in the water
      // (notes 367 and 388, 2026-09-27).
      const shooting = danger.filter(m => shooter(m.entity)).map(m => m.entity);
      // As far as the swim itself looks (shore.js reachShore), and priced
      // as the other stances are: the seconds of swimming to the bank it
      // makes for and what the mobs deal meanwhile. mid-215-j was told only
      // that no bank was within thirty-two blocks and that it would dig or
      // climb out where it could; the bank was 35 blocks off, some 17
      // seconds of swimming, and the drowned's trident took 4.5 every two
      // seconds, more than its 15.5 health in that time (note 501).
      const banks = require('./shore').landingsAbout(bot, shooting, { reach: 64 });
      const swimFor = shooting.length && banks.hidden ? banks.hidden : banks.nearest;
      const swimSays = (() => {
        if (!swimFor) return '';
        const secs = Math.round(swimFor.distance / SWIM * 10) / 10, here = bot.entity.position, s = shooting[0];
        const toward = s && (swimFor.x - here.x) * (s.position.x - here.x) + (swimFor.z - here.z) * (s.position.z - here.z) > 0;
        const way = s ? `, ${toward ? 'toward' : 'away from'} the ${s.name.replaceAll('_', ' ')}` : '';
        return ` The swim to it is about ${secs} seconds at the surface (about ${SWIM} blocks a second)${way}.` + costSays(stanceCost({ mobs, setup: secs, seconds: secs }), bot.health, mobs, { over: 'over the swim' });
      })();
      const bankSays = !banks.nearest ? ' No dry landing near the water\'s level is in view within sixty-four blocks: nothing to swim for, and the bot climbs or digs out only where a bank or the floor is within a few blocks.'
        : shooting.length ? (banks.hidden ? ` The nearest bank out of the ${shooting.length === 1 ? 'shooter\'s' : 'shooters\''} sight is ${banks.hidden.distance} blocks off${banks.hidden.distance > banks.nearest.distance ? ` (the nearest bank of all, ${banks.nearest.distance} off, is in their sight)` : ''}; it is swum for first, shot at on the way, and behind it they cannot hit the bot.`
          : ` Every dry landing in view within sixty-four blocks is in the shooters\' sight; the nearest is ${banks.nearest.distance} blocks off.`)
        : ` The nearest dry landing is ${banks.nearest.distance} blocks off.`;
      options.get_out_of_water = { description: `Swim for the nearest dry ground with air over it, out of the shooters' sight where a bank hides the bot, digging a step into the bank if that is the way out, and deal with the mobs from there.${wet}${bankSays}${swimSays}`,
        run: async () => { this.report(goal, save, { action: 'out_of_water', threats: danger.map(t => t.entity.name).slice(0, 4), health: bot.health, air: bot.oxygenLevel, hiddenBank: banks.hidden });
          return !!await reachShore(bot, task, goal, save, { move: this.actions.navigate, client: this.client, dig: this.actions.dig, fight: danger }); } };
    }
    // Priced as every other stance is: the seconds of drawing standing
    // still, everything about reaching the bot meanwhile, then only what
    // else still shoots. Without a number beside the others' numbers the
    // bow was seldom chosen, 0.15 where four arrows would have ended
    // mid-244-s's pillager (the Fable advice on note 416).
    const shotCost = t => {
      const hp = require('./combat-estimate').MOBS[t.entity.name]?.health, arrows = hp ? Math.ceil(hp / 6) : 4;
      return stanceCost({ mobs, setup: arrows, reaches: m => m.shoots && m.name !== t.entity.name, shield: shielded });
    };
    // Cover from the shooters in sight: a block two high in the line of
    // each, as a player ducks behind a pillar from a blaze. In the Nether a
    // fireball's fire is not put out by water, and mid-227-q and mid-202-m
    // were burned down at twenty blocks from their blazes with no way to
    // break the line offered (notes 443, 451).
    const shootersSeen = danger.filter(t => t.visible && shooter(t.entity)).slice(0, 3);
    // Each in its own line: the ray from its eyes to the bot's, which it
    // must have to fire, cut where it passes nearest the bot (creeper-
    // sight.js blockPlan), two high where that is beside the bot. The cover
    // went on the side toward the shooter's larger axis, which from a blaze
    // thirty blocks off on the diagonal left the ray open a block to one
    // side: mid-235-q-nether-2's cover went up at head height west, the
    // fireball came in from the south-west past it, and its push put the
    // bot over a thirty-block drop (note 541).
    const { blockPlan, whereSays } = require('./creeper-sight');
    const plans = shootersSeen.map(t => ({ t, plan: blockPlan(bot, t.entity) }));
    const cut = plans.filter(p => p.plan.cells.length), behind = plans.filter(p => p.plan.stoppedBy);
    const coverBlocks = cut.reduce((n, p) => n + p.plan.cells.length, 0);
    const covered = new Set([...cut, ...behind].map(p => p.t.entity.id));
    // The planks the logs carried make count, made first, as for the rail
    // and the span's walls (note 563): mid-243-ad-nether-3, its last two
    // planks in a cover that did not go up, was offered no cover on its
    // span with three oak logs in the pack, twelve planks (note 582).
    const coverStock = shelter.materialStock(bot);
    const coverPlanks = coverStock < coverBlocks && typeof this.actions.acquireStep === 'function' ? shelter.plankCraft?.(bot) : null;
    const coverMade = coverPlanks && coverPlanks.available + countOf(bot, coverPlanks.item) >= coverBlocks ? coverPlanks : null;
    let coverWindow = 0;
    // Nowhere to hide is said, not left as a silent gap in the list: 25598
    // asked encounter_stance 53 times over one skeleton with retreat's own
    // "no route" said on itself (footing note above) and take_cover simply
    // missing from the tree, with no word of why it was not there (note 743).
    if (shootersSeen.length && !covered.size) this.state.stanceTakeCoverNoRoute = `Nowhere to hide: no block can cut ${shootersSeen.length === 1 ? 'the' : 'any of the'} line${shootersSeen.length === 1 ? '' : 's'} of ${shootersSeen.map(t => t.entity.name.replaceAll('_', ' ')).join(', ')} from here.`;
    else delete this.state.stanceTakeCoverNoRoute;
    if (covered.size && typeof this.actions.place === 'function' && (coverStock >= coverBlocks || coverMade) && !inWater(bot)) {
      const named = t => `the ${t.entity.name.replaceAll('_', ' ')} (${Math.round(t.distance)} blocks off)`;
      const open = plans.filter(p => !covered.has(p.t.entity.id));
      const madeSetup = coverMade && coverBlocks ? 1 : 0;
      // Open until the first cell that cuts a line is down (the floor under
      // it first where it hangs over air).
      coverWindow = cut.length ? Math.min(...cut.map(p => p.plan.cutAfter || p.plan.cells.length)) * BLOCK_SECONDS + madeSetup : 0;
      const coverCost = stanceCost({ mobs, setup: coverBlocks * BLOCK_SECONDS + madeSetup, reaches: m => !m.shoots || m.name === 'creeper' || open.some(p => p.t.entity.name === m.name), shield: shielded });
      const says = [
        ...cut.map(p => `${p.plan.cells.length === 1 ? 'a block' : `${p.plan.cells.length} blocks, two high,`} in the line from the eyes of ${named(p.t)} to the bot's, ${whereSays(bot, p.plan.cuts)}`),
        ...behind.map(p => `nothing for ${named(p.t)}: the ${p.plan.stoppedBy.name.replaceAll('_', ' ')} at ${p.plan.stoppedBy.cell} is in its line already`)];
      // Against a ghast, which of the blocks carried its blast breaks: the
      // cover is put from one that holds (ghast.js, note 551).
      const ghastCovered = cut.some(p => p.t.entity.name === 'ghast');
      const openSays = open.length ? ` No cover can go in the line of ${open.map(p => `${named(p.t)} (${p.plan.why})`).join(', ')}: it still has the bot in its fire.` : '';
      options.take_cover = { expects: { damage: coverCost.damage, seconds: coverCost.seconds, oneHit }, description: `${coverBlocks ? `Put ${says.join('; and ')}, and stay behind it: ${coverBlocks} block${coverBlocks === 1 ? '' : 's'}, about ${Math.round(coverBlocks * BLOCK_SECONDS * 10) / 10} seconds${madeSetup ? `, the ${coverMade.item.replaceAll('_', ' ')} for it made first from the logs carried (${coverMade.available}), about a second more` : ''}` : `Stay here behind what stands in the line already: ${says.join('; ')}`}; a shooter fires only with a line to the bot, a shot does not come through a block, and a shooter that moves round finds the bot open again.${openSays}` + (ghastCovered ? require('./ghast').coverSays(bot, shelter.buildingMaterials) : '') + costSays(coverCost, bot.health, mobs, { doing: 'placing it', done: 'Behind it' }) + edge,
        run: async () => {
          if (madeSetup && shelter.materialStock(bot) < coverBlocks) {
            try { await this.actions.acquireStep(bot, task, coverMade.item, countOf(bot, coverMade.item) + Math.min(coverMade.available, Math.ceil(coverBlocks / 4) * 4), goal, save); }
            catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          }
          const material = (ghastCovered && require('./ghast').blastProofMaterial(bot, shelter.buildingMaterials)) || shelter.buildingItem(bot, 1)?.name;
          const now = plans.map(({ t }) => { const e = bot.entities?.[t.entity.id] || t.entity; return { t, e, plan: e.isValid === false ? { cells: [], stoppedBy: true } : blockPlan(bot, e) }; });
          const todo = now.filter(p => p.plan.cells.length);
          if (!todo.length && !now.some(p => p.plan.stoppedBy)) throw Object.assign(new Error(now.map(p => `${p.t.entity.name.replaceAll('_', ' ')}: ${p.plan.why}`).join('; ') || 'no shooter in its line'), { name: 'StanceFailed' });
          if (todo.length && !material) throw Object.assign(new Error('no building blocks carried'), { name: 'StanceFailed' });
          if (todo.length) this.report(goal, save, { action: 'take_cover', threats: todo.map(p => p.t.entity.name), cells: todo.flatMap(p => p.plan.cells.map(c => ({ ...c }))) });
          let placed = 0;
          for (const p of todo) {
            for (const c of p.plan.cells) {
              task.check();
              try { await this.actions.place(bot, task, c, material, { stay: true }); placed++; }
              catch (err) {
                task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
                // The line cut is the cover; the rest is the second of two high.
                if (blockPlan(bot, p.e).stoppedBy) break;
                throw Object.assign(new Error(`${String(err.message || err).slice(0, 160)} (the cell in the line of the ${p.t.entity.name.replaceAll('_', ' ')} at ${c})`), { name: 'StanceFailed' });
              }
            }
          }
          if (bot.inventory?.slots?.[45]?.name === 'shield') { try { await raiseShield(bot); } catch (_) { /* the block is the cover */ } }
          if (!placed) await sleep(250);
          return true;
        } };
    }
    const blockCreeper = this.creeperBlockOption(task, goal, save, { coming, mobs, shielded, oneHit, edge });
    if (blockCreeper) options.block_creeper = blockCreeper;
    const fungus = this.warpedFungusOption(task, goal, save, { coming, mobs, shielded, oneHit, edge });
    if (fungus) options.warped_fungus = fungus;
    for (const t of shotTargets(bot, danger, { any: true }).slice(0, 3)) options[`shoot_${t.entity.id}`] = { expects: (c => ({ damage: c.damage, seconds: c.seconds, oneHit }))(shotCost(t)), description: `Shoot the ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off with the bow from here; each arrow takes about a second to draw, standing still.` + shotFacts(t) + (armsLength ? ' Something that bites is at arm\'s length now, and the draw stops when it closes.' : '') + costSays(shotCost(t), bot.health, mobs, { doing: 'drawing', done: 'The shooter down' }) + edge,
      run: async () => { await this.shootAt(task, goal, save, t); return true; } };
    // A ghast: its fireball struck back, and the bow past the twenty above
    // (ghast.js, note 551). mid-235-p-nether-4-fortress-2 was offered only
    // hiding and cover from one twenty-five to forty blocks off, and died.
    const ghastHere = danger.find(t => t.entity.name === 'ghast');
    const edgeNow = shotOverEdge(bot, feet), overEdge = edgeNow?.walledNow ? null : edgeNow;
    const ce = require('./combat-estimate');
    const ghastHit = this.lastGhastHit = !ghastHere ? null : mobs.find(m => m.name === 'ghast')?.hitsBot ?? Math.round(ce.afterArmour(ce.MOBS.ghast.hit, ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean))) * 10) / 10;
    if (ghastHere && !inWater(bot)) {
      const ghast = require('./ghast');
      const others = stanceCost({ mobs: mobs.filter(m => m.name !== 'ghast'), reaches: () => true, shield: false });
      // The wall against its push: which of the blocks carried its blast
      // breaks, the wall put from one that holds.
      if (options.rail_and_fight) options.rail_and_fight.description += ghast.coverSays(bot, shelter.buildingMaterials).replace('the cover is put from it', 'the wall is put from it').replace('the cover can be blown out by the fireball it stops', 'the wall can be blown out by the fireball whose push it stops');
      // Priced by what the strike has measured live, and over a drop a
      // shot can push the bot off by that fall (note 574).
      const back = ghast.returnOption(bot, danger, { hit: ghastHit, others, since: goal?.fireballReturns, over: overEdge });
      if (back) options.return_fireball = { expects: back.expects, description: back.description + edge,
        run: async () => {
          this.report(goal, save, { action: 'return_fireball', target: 'ghast', entityId: back.ghast.entity.id, distance: Math.round(back.ghast.distance * 10) / 10, health: bot.health, stance: true });
          const r = await ghast.returnFireball(bot, task, back.ghast.entity);
          // What came of the watch, kept with the goal: the next asking
          // says it and prices by it.
          const was = goal.fireballReturns || {};
          goal.fireballReturns = Object.fromEntries(['watches', 'came', 'struck', 'sentBack', 'killed', 'landed'].map(k => [k, (was[k] || 0) + (k === 'watches' ? 1 : r[k] || 0)]));
          goal.survivalAction = { ...goal.survivalAction, strikes: r.strikes, came: r.came, struck: r.struck, sentBack: r.sentBack, landed: r.landed, ...(r.killed ? { ghastKilled: true } : {}), ...(r.ghastGone ? { ghastGone: true } : {}) }; save();
          return true;
        } };
      for (const t of shotTargets(bot, [ghastHere], { minimum: 20.01, maximum: ghast.GHAST.reach })) {
        const a = ghast.arrowAt(t.distance);
        const cost = stanceCost({ mobs, setup: a.arrows, reaches: m => m.shoots && m.name !== 'ghast', shield: shielded });
        options[`shoot_${t.entity.id}`] = { expects: { damage: cost.damage, seconds: cost.seconds, oneHit }, description: ghast.bowSays(t, countOf(bot, 'arrow')) + costSays(cost, bot.health, mobs, { doing: 'drawing', done: 'The ghast down' }) + edge,
          run: async () => { await this.shootAt(task, goal, save, t); return true; } };
      }
    }
    // Said with every stance; first, where the work going on is the answer
    // it bears on (note 525's fact leading, note 560).
    const kept = apartSays(bot, apart);
    if (kept) for (const [k, o] of Object.entries(options)) o.description = k === 'keep_working' ? `${kept.trim()} ${o.description}` : o.description + kept;
    // What each stance costs the work: it waits while the stance holds.
    // mid-244-ad-nether-2 held a pillar on its own bridge against a sword
    // piglin on the slope below every fifteen seconds for minutes, every
    // stance priced at no damage and none at the crossing it stopped (note
    // 560).
    const waits = this.workWaits(goal, danger);
    if (waits) for (const [k, o] of Object.entries(options)) if (k !== 'keep_working') o.description += ` ${waits}`;
    // Over a drop that kills, with a shooter about that can put the bot
    // over it: every stance that leaves the bot open says so, priced by
    // the fall (note 563). mid-243-ad's keep_working said "a hit's
    // knockback ... is into lava" and priced the hidden ghast's fireballs at
    // nothing; the fall was twenty-two blocks into the lava sea, nothing to
    // climb out onto within reach.
    // Leaving them be says its "stops at once if one lands a hit" is, here,
    // after the fall; the walled stances say what a shot costs behind the
    // wall. Asked of Jev in the recorded question (keep_working 5 of 5 as
    // recorded), the fall said on the open stances alone left it split
    // between the work, the fight and "none of these"; with the walled
    // price beside it, rail_and_fight 10 of 10 (replay case
    // span-ghast-hidden-keep-working).
    const over = overEdge;
    if (edgeNow?.walledNow) for (const [k, o] of Object.entries(options)) o.description += edgeNow.says + (k === 'keep_working' ? edgeNow.leaving : '');
    if (over) for (const [k, o] of Object.entries(options)) {
      if (k === 'rail_and_fight' || (k === 'hold_on_span' && spanWalled)) {
        o.description += openWhileBuildingSays(bot, over, k === 'rail_and_fight' ? railWindow : holdWindow, 'the wall on the side a push goes') + over.walled;
        continue;
      }
      if (k === 'take_cover' && coverWindow) o.description += openWhileBuildingSays(bot, over, coverWindow, `the first block in the ${shotWord(over.pusher.name)}'s line`);
      if (CLOSES_THE_DROP.has(k) || k === 'out_of_the_push') continue;
      o.description += over.says + (k === 'keep_working' ? ' The work does not stop in time: the hit that would stop it is the one that throws the bot over.' : '');
      // Where the push cannot carry it over, said beside it (note 612).
      if (blastOver && k !== 'fight_from_footing') o.description += blastOver.footing ? ` Footing a push from the ${blastOver.pusher.name.replaceAll('_', ' ')} cannot carry the bot over stands ${blastOver.footing.steps} step${blastOver.footing.steps === 1 ? '' : 's'} off at (${blastOver.footing.cell.x}, ${blastOver.footing.cell.y}, ${blastOver.footing.cell.z}).` : ` No footing a push from the ${blastOver.pusher.name.replaceAll('_', ' ')} cannot carry the bot over is within ${FOOTING_STEPS} steps of walking.`;
    }
    // The push's own reach past the three blocks the drop is looked for in
    // (a fireball throws the body up to about four), said where the drop
    // sentence above was not.
    if (blastOver && !over && !edgeNow?.walledNow) for (const [k, o] of Object.entries(options)) {
      if (CLOSES_THE_DROP.has(k) || k === 'out_of_the_push') continue;
      o.description += blastOver.says + (k === 'keep_working' ? ' The work does not stop in time: the hit that would stop it is the one that throws the bot over.' : '');
    }
    // A spear holder's knock over the drop, on every stance but the fight
    // (which says its jabs to the drop) and those that close the drop.
    const speared = spearOverEdge(bot, feet, coming, mobs);
    if (speared) for (const [k, o] of Object.entries(options)) {
      // The step to footing says its own knock ("a knock there lands on
      // ground"): it leaves the drop.
      if (k === 'fight' || k === 'seal' || k === 'bunker' || k === 'fight_from_footing') continue;
      o.description += k === 'rail_and_fight' ? speared.walled : k === 'shield_the_charge' ? speared.says + speared.shielded : speared.says + (k === 'keep_working' ? ' The work does not stop in time: the hit that would stop it is the one that knocks the bot over.' : '');
    }
    // What each of the rest gains toward the rods the goal needs, as the
    // blaze stands say theirs (note 614): the fight its kills by its own
    // figures, a stance that strikes only what comes that, and the rest
    // none, the blazes staying where they are.
    if (rodsNeed > 0) {
      const cage = require('./blaze-stand').spawnerAt(bot), live = !!cage && cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) <= 16;
      const workHunts = HUNT_STEPS.has(goal?.step?.action);
      for (const [k, o] of Object.entries(options)) {
        if (standKeys.has(k) || k === 'none_good' || k.startsWith('shoot_') || (k === 'keep_working' && workHunts)) continue;
        const gain = k === 'fight' ? (noStep || noneCome || !fightBlazes ? 'comes' : { kills: fightBlazes, seconds: cost.seconds, dies: cost.healthAfter <= 0, all: true }) : STRIKING_STANCES.has(k) ? 'comes' : 'none';
        o.description += require('./blaze-stand').towardRods(rodsNeed, gain, { spawner: live, of: require('./blaze-stand').rodsOf(bot, goal) });
      }
    }
    // What followed each kind of answer in the played fights, in this
    // situation, on the options of that kind (blaze-record.js, note 645);
    // the blaze stands say their own where they are built.
    if (danger.some(t => t.entity.name === 'blaze')) {
      const record = require('./blaze-record'), situation = record.situationOf(bot);
      for (const [k, o] of Object.entries(options)) if (!standKeys.has(k)) o.description += record.optionSays(bot, k, situation);
    }
    // What followed each stance chosen so, over a drop that kills with a
    // ghast or magma cubes about (knock-record.js, note 662).
    if (dropHere && dropHere.into === 'lava' && knockKinds.some(n => n === 'ghast' || n === 'magma_cube')) {
      for (const [k, o] of Object.entries(options)) if (k !== 'none_good' && !k.startsWith('shoot_')) o.description += require('./knock-record').optionSays(k, knockKinds);
    }
    // The hardest blow that can get to the bot, first on every stance
    // (blowsSay, note 576): each says after it whether that mob still
    // reaches the bot its way.
    const blows = blowsSay(mobs, bot.health);
    if (blows) for (const o of Object.values(options)) o.description = `${blows} ${o.description}`;
    // Every mob here with a fact worth telling (combat-estimate.js MOBS'
    // own `note`: an enderman's 2.9 blocks and the two-high pocket that
    // keeps it out, a spider's poison, a wither skeleton's wither, a wolf's
    // pack, a goat's ram), said once with every stance. The fact was
    // already known and already used to weigh a hunt's approach
    // (mob-hunt.js) and the figures above (hitsLeft, blazeLands), but never
    // reached the stance itself: the single enderman fought or sealed out
    // by name in code, below, knew its own height; a second or third one,
    // handed to Jev as a stance question instead, was not (note 713 - the
    // crowd's own seal was offered with no word that an enderman cannot
    // enter it, and every other mob's own fact was silent here the same
    // way, general to all of them, not just the one this drill happened to
    // measure).
    // Only the mobs that bear on this stance: in sight or within eight
    // blocks. A magma cube 15 blocks off out of sight opened every option of
    // 25589's spawner fight with its five blows (critic 05:43Z), which read
    // as a reason to take cover from the blazes at three blocks.
    const bearing = m => m.visible || (Number.isFinite(m.distance) && m.distance <= 8);
    const mobNotes = [...new Map(mobs.filter(m => m.note && bearing(m)).map(m => [m.name, m.note])).values()];
    const notesSay = mobNotes.length ? ` ${mobNotes.map(n => `${n[0].toUpperCase()}${n.slice(1)}.`).join(' ')}` : '';
    if (notesSay) for (const o of Object.values(options)) o.description += notesSay;
    return options;
  }

  // The work the encounter stops, and how long it has stood for these mobs:
  // from when the first of them was met, while any of them stays about.
  // The rule when one shot that lands ends the bot and a shooter has a line
  // to it (lethal-line.js, note 701): the nearest cell out of every line, or
  // a block in each line, whichever is sooner, before the stance is asked.
  // Kept in this.state.lethalLine, said with the stance asked next. Returns
  // true when it moved or built (the stance is asked at the next look, from
  // where the bot is then); false when there was no way or it failed here
  // just now (then the stance is asked with that said).
  async breakLethalLine(task, goal, save, danger, L) {
    const bot = this.bot, feet = feetCell(bot), now = Date.now();
    const failed = this.state.lethalLineFailed;
    if (failed && now - failed.at < LETHAL_SAID_MS && failed.feet === `${feet}`) {
      this.state.lethalLine = { at: now, says: L.says, did: failed.did };
      return false;
    }
    if (inWater(bot)) return false;
    const biting = danger.filter(t => !shooter(t.entity)).map(t => t.entity);
    const way = require('./lethal-line').wayOut(bot, danger, L, { blocks: shelter.materialStock(bot), canPlace: typeof this.actions.place === 'function', avoid: biting });
    const fail = did => { this.state.lethalLineFailed = { at: Date.now(), feet: `${feet}`, did }; this.state.lethalLine = { at: Date.now(), says: L.says, did }; return false; };
    if (!way) return fail('no cell out of every line within eight blocks of walking, and no block could go in every line');
    this.report(goal, save, { action: 'out_of_line', how: way.how, health: bot.health, shooters: L.lined.map(l => l.e.name), ...(way.cell ? { to: { x: way.cell.x, y: way.cell.y, z: way.cell.z }, blocks: way.steps } : { cells: way.cells }) });
    console.log(`[lethal line] ${Math.round(bot.health * 10) / 10} health, one ${L.worst.e.name.replaceAll('_', ' ')} shot ends it: ${way.how === 'walk' ? `walking ${way.steps} block${way.steps === 1 ? '' : 's'} out of every line` : `putting ${way.cells} block${way.cells === 1 ? '' : 's'} in the lines`} before the stance`);
    if (way.how === 'walk') {
      let why = null;
      try { await this.actions.navigate(bot, task, new goals.GoalBlock(way.cell.x, way.cell.y, way.cell.z), { timeoutMs: Math.max(2500, way.seconds * 3000), stallMs: 1000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; why = err.message; }
      if (!feetCell(bot).equals(way.cell)) return fail(`the walk of ${way.steps} blocks to (${way.cell.x}, ${way.cell.y}, ${way.cell.z}), out of every line, did not get there${why ? `: ${String(why).slice(0, 120)}` : ''}`);
      this.state.lethalLine = { at: Date.now(), says: L.says, did: `walked ${way.steps} blocks to (${way.cell.x}, ${way.cell.y}, ${way.cell.z}), where no shooter's line reaches` };
      return true;
    }
    const material = shelter.buildingItem(bot, 1)?.name;
    const { blockPlan } = require('./creeper-sight');
    let placed = 0;
    for (const p of way.plans) {
      const e = bot.entities?.[p.e.id] || p.e;
      const plan = e.isValid === false ? { cells: [] } : blockPlan(bot, e);
      for (const c of plan.cells) {
        task.check();
        try { await this.actions.place(bot, task, c, material, { stay: true }); placed++; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; if (blockPlan(bot, e).stoppedBy) break; return fail(`a block in the ${e.name.replaceAll('_', ' ')}'s line at ${c} did not go down: ${String(err.message || err).slice(0, 120)}`); }
      }
    }
    if (require('./bunker').seenFrom(bot, danger.filter(t => shooter(t.entity)).map(t => t.entity), feetCell(bot)).length) return fail(`${placed} block${placed === 1 ? '' : 's'} put in the lines, and a shooter still has one`);
    this.state.lethalLine = { at: Date.now(), says: L.says, did: `put ${placed} block${placed === 1 ? '' : 's'} in the shooters' lines; none has a line to the bot now` };
    return true;
  }
  // The meal chosen as a stance, eaten through (meal.js, note 701): begun
  // again after a cut by the shot reflex for a shot on its way, while a meal
  // still helps. Eaten is hunger or saturation up: the consume came back
  // with nothing eaten while a zombie hit (mid-227-f, 2026-09-27).
  async eatChosen(task, meal) {
    const bot = this.bot;
    const hungerBefore = bot.food ?? 20, saturationBefore = bot.foodSaturation ?? 0;
    const eaten = () => (bot.food ?? 20) > hungerBefore || (bot.foodSaturation ?? 0) > saturationBefore;
    const r = await require('./meal').eatThrough(bot, task, meal, { eaten, helps: () => (bot.food ?? 20) < 20 });
    if (r.cuts.length) console.log(`[meal] ${meal.name.replaceAll('_', ' ')}: cut ${r.cuts.length} time${r.cuts.length === 1 ? '' : 's'} by a shot on its way (${r.cuts.at(-1)}), ${r.eaten ? `eaten at try ${r.tries}` : 'not eaten'}`);
    if (r.eaten) { delete this.state.mealCutAt; return true; }
    this.state.stanceWhy = r.cuts.length ? `the meal was cut ${r.cuts.length} time${r.cuts.length === 1 ? '' : 's'} by the shield raised for a shot on its way, and begun again each time; not eaten` : `the meal was not eaten: ${r.why}`;
    return false;
  }
  workWaits(goal, danger, now = Date.now()) {
    const ids = danger.map(t => t.entity?.id);
    const was = this._encounterMet;
    const same = was && now - was.seen < 30000 && ids.some(id => was.ids.includes(id));
    this._encounterMet = { since: same ? was.since : now, seen: now, ids: [...new Set([...(same ? was.ids : []), ...ids])] };
    const step = goal?.step?.action === 'combined_request' ? goal.step.detail?.action : goal?.step?.action;
    if (!step) return '';
    const secs = Math.round((now - this._encounterMet.since) / 1000);
    return `The work (${step.replaceAll('_', ' ')}) waits meanwhile${secs >= 5 ? `: it has waited ${secs} seconds for these mobs so far` : ''}.`;
  }

  // Where the work stands, said with carrying on (note 566): how far its
  // target is, and whether it was getting anywhere when these mobs stopped
  // it, by the stall watch's own record of it (stillness.js look: new
  // ground, a block dug or placed, something gained).
  workProgress(goal) {
    const bot = this.bot;
    const step = goal?.step?.action === 'combined_request' ? goal.step.detail : goal?.step;
    if (!step?.action) return '';
    const parts = [];
    const target = [step.target, step.destination, step.to].find(p => p && Number.isFinite(p.x) && Number.isFinite(p.z));
    const here = bot.entity?.position;
    if (target && here) parts.push(`its target${step.what ? `, ${String(step.what).replaceAll('_', ' ')},` : ''} is ${Math.round(Math.hypot(target.x + 0.5 - here.x, target.z + 0.5 - here.z))} blocks off${Number.isFinite(target.y) && Math.abs(target.y - here.y) >= 4 ? ` and ${Math.abs(Math.round(target.y - here.y))} ${target.y > here.y ? 'up' : 'down'}` : ''}`);
    if (Number.isFinite(step.bridge) && step.bridge > 0) parts.push(`this stretch has ${step.bridge} block${step.bridge === 1 ? '' : 's'} to lay, ${require('./bridging').blocksCarried(bot)} carried`);
    let record = null;
    try { record = bot._stalls?.records?.[require('./stillness').actionOf({ ...goal, survivalAction: null }).key]; } catch (_) { record = null; }
    if (record) {
      const idle = Math.round((record.idle || 0) / 1000);
      parts.push(idle >= 5 ? `in its last ${idle} seconds at it the work made no headway (no new ground, nothing dug, placed or gained)` : 'it was making headway when these mobs stopped it (new ground, a block dug or placed, or something gained within its last few seconds at it)');
    }
    return parts.length ? ` Where the work stands: ${parts.join('; ')}.` : '';
  }

  async stanceStep(task, goal, save, danger, swung) {
    const bot = this.bot;
    // Measured from the ground, not mid-jump: floored in the air, the feet
    // are a block high and every stance's cells with them (mid-239-b's
    // pillar, offered and then refused by its own headroom check).
    for (let n = 0; n < 8 && bot.entity.onGround === false && !bot.entity.isInWater; n++) { task.check(); await sleep(100); }
    const kinds = [...new Set(danger.map(t => t.entity.name))].sort().join(',');
    const feet = feetCell(bot);
    const held = this.state.stance;
    // Leaving the mobs be ends at the first hit, as the option says: held
    // until six health was gone, mid-92-g stood working in the Nether under
    // skeletons from fifteen health to three (2026-09-26).
    const hitSince = held?.choice === 'keep_working' && bot._recentHurtAt > held.at;
    // Held through the crowd: a stance is asked again when it fails, when
    // six health is gone since it was chosen, after fifteen seconds, or
    // when a mob the choice was not made against comes within six blocks.
    // Not when a kind of mob comes into view far off or goes out of it: a
    // crowd's kinds change all the time, and mid-83-d went retreat, pillar,
    // charge, fight, seal in eighteen seconds, none carried through. Of 168
    // stances asked again for a change of kinds in the midgame trials, 81
    // were for a kind gone out of view and 54 for one come into view more
    // than eight blocks off; a third of those changed the stance.
    // Not a live spawner's capped swarm turning over, either: a cage keeps
    // about the same count of one kind spawning and despawning the whole
    // time it is worked, and by entity id every one of them is new sooner
    // or later. 25585 held take_cover against sixteen blazes at a spawner
    // and was asked again on every one that spawned or despawned within
    // six blocks, sixty-two times in 12.8 minutes with the same blazes at
    // the same range throughout (note 743): a newcomer of a kind already
    // held against is not news, only one of a kind that was not there.
    const newcomer = held?.ids && danger.find(t => t.distance <= STANCE_NEWCOMER && !held.ids.includes(t.entity.id) && !held.kinds?.split(',').includes(t.entity.name));
    // A stance chosen on an estimate is asked again once it has cost more
    // than it was said to, health or time: first-days-219 chose to fight one
    // skeleton in full iron, told 1.3 damage in 3.8 seconds; it stood eleven
    // seconds under a ledge it could not reach and went from 9.2 health to
    // 2.9 before six health lost handed it back (2026-09-26).
    // At its pace: the damage said, spread over the seconds said, and one
    // blow of the hardest hitter's give; past its seconds, done, unless
    // nothing it was chosen on has changed (holds.js, below).
    const elapsed = held ? (Date.now() - held.at) / 1000 : 0;
    // Leaving the mobs be is not held once the turn is back here: the work it
    // left them for has just been stopped by one of them (a creeper come
    // within its fuse's reach, note 329). Held, it ran again at every tick,
    // a hundred times a second, and mid-227-k's creeper walked up through
    // it; mid-202-h and mid-227-i spun the same way (2026-09-27).
    const leftBe = held?.choice === 'keep_working' && !!immediateThreat(bot);
    // A stance that hid the bot from the shooters (out of sight, the nook)
    // is asked again once a shooter has a line to where it hid, or the bot
    // is off that spot: held on its estimate, mid-242-y sat at the end of
    // its L at 2.1 health while a skeleton walked in to the turn and shot
    // it (note 522). A line Jev was told of when it chose to stay is not
    // asked of again.
    const hid = held?.hidden;
    const offSpot = !!hid && hid.cell !== `${feet}`;
    const lineAgain = hid && !offSpot ? require('./bunker').seenFrom(bot, danger.filter(t => shooter(t.entity)).map(t => t.entity), feet).filter(e => !hid.seenBy.includes(e.id)) : [];
    // A block in a creeper's line is held while the line stays stopped and
    // the creeper stands; the moment it walks, or has a line again, it is
    // asked again (note 547).
    const blockAgain = this.blockCreeperHeld(held);
    // A stance that hid the bot from shooters (out of sight, the nook, the
    // cover) is asked again once one of the shooters it was chosen against
    // lands a hit: it was not hidden from that one. Held within its slack
    // (its estimate and one blow), mid-235-p-nether-4-fortress-2's hiding
    // place took two fireballs from a ghast that had drifted to a new line,
    // and was asked again only when the bot was off the spot (note 551).
    const shotThrough = HIDING_STANCES.has(held?.choice) ? (held.shooters || []).find(k => (bot._hurtBy?.[k] || 0) > held.at) : null;
    // A shot from a shooter it was chosen against that landed, the bot
    // still open over a drop a push puts it over: every stance priced that
    // shot as the fall, and the bot came through it somewhere else. Held on
    // its estimate, mid-243-ag-nether-2's fight on its one-wide span over
    // the lava sea took a ghast's fireball at 14:18:15 that threw it four
    // blocks along the span to its south lip, was not asked again, and the
    // next, three seconds later, threw it into the lava (note 610).
    const shotLanded = !!held && (held.shooters || []).some(k => (bot._hurtBy?.[k] || 0) > held.at);
    const pushedOpen = shotLanded && (() => { const over = shotOverEdge(bot, feet); return !!over && !over.walledNow; })();
    // Alone against one bow or crossbow shooter (note 715): a closing or
    // other non-hiding stance is the outcome's to end (it is killed or
    // gone, the bot is hurt past damageOver's health, or the bot moves off
    // its spot), not a failed try at closing the ground or a hold's own
    // clock (its extension in holds.js diverged, extend). A stance that
    // hid the bot (out_of_sight, nook, take_cover) keeps its own rule
    // below (lineAgain, shotThrough): a shooter regaining the line to
    // where the bot hid, or landing a shot through the hide, is that hide
    // failing, not skirmish noise (mid-242-y, note 522), so it is not
    // loosened here even alone against one.
    const soloRanged = require('./danger').soloRangedThreat(bot, danger);
    const soloHeld = !!held && !!soloRanged && held.ids?.length === 1 && held.ids[0] === soloRanged.entity.id;
    // The physical triggers, whatever the stance's clock: six health, a
    // newcomer within six, a hit while leaving them be, a shooter's line
    // where it hid, the bot off its spot, a creeper's line, a shot through,
    // a push come through open over the drop.
    const physical = !!held && !leftBe && (held.ids ? !newcomer : held.kinds === kinds) && !hitSince && !offSpot && !lineAgain.length && !shotThrough && !blockAgain && !pushedOpen && !held.lethalAgain;
    // More damage than priced by now, at the estimate's pace (past its
    // seconds, while held on, at its rate); without an estimate, six health.
    const extendedHold = !!held?.hold?.extended;
    const damageOver = !!held && (held.expects ? held.health - bot.health > held.expects.damage * (extendedHold ? elapsed : Math.min(elapsed, held.expects.seconds)) / Math.max(0.1, held.expects.seconds) + (held.expects.oneHit || 0) : bot.health <= held.health - STANCE_HEALTH);
    const inTime = !!held && (extendedHold ? Date.now() < held.hold.until : Date.now() - held.at < STANCE_HOLD_MS && !(held.expects && elapsed > held.expects.seconds));
    let holding = physical && !damageOver && inTime;
    // At the end of its time, a hold with nothing new is not a question
    // (holds.js, note 599): held on, 15, 30, then 60 seconds at a time, while
    // what it was chosen on stands; asked again when that is falsified (read
    // at every look while it is held on) or at its cap. Not a stance that
    // leaves the mobs be or eats, not a run (its point is the run: held on
    // past it, mid-242-ah-fortress-3's retreat stood searching for a way
    // again while the wither skeleton it ran from came back and struck it
    // twice, note 601), and not a striking stance that has not acted (note
    // 596's rule has it).
    // A rod picked up is noted when it is first seen (after-rod.js, note 659).
    require('./after-rod').noteRods(bot);
    const striking = STRIKING_STANCES.has(held?.choice);
    const extendable = physical && !damageOver && !!held?.hold && (!inTime || extendedHold) && !['keep_working', 'eat', 'eat_golden_apple', 'drink_fire_resistance', 'retreat', 'leave_reach'].includes(held.choice) && !(striking && held.start && !stanceActed(bot, held.start));
    if (extendable) holding = false;
    // One shot that lands ends the bot, and a shooter has a line to it: out
    // of every line first, then the stance is asked (lethal-line.js, note
    // 701). Not while a stance chosen with this said holds.
    const lethalNow = require('./lethal-line').lethal(bot, danger, feet);
    if (!lethalNow && this.state.lethalLine && Date.now() - this.state.lethalLine.at > LETHAL_SAID_MS) delete this.state.lethalLine;
    if (lethalNow && !(held?.lethalKnown && (holding || extendable)) && await this.breakLethalLine(task, goal, save, danger, lethalNow)) {
      if (held) held.lethalAgain = true;
      return true;
    }
    let holdEnded = null, holdCapped = false;
    // About to ask: the run's way is looked for first, so the retreat says
    // whether there is one (a moment ago from here will do).
    // And when the stance held is no longer on offer, as that asks too:
    // mid-241-n's dance was held when its creeper walked out past six, the
    // question came with the retreat told "no route is checked yet", Jev
    // took it, and the run's route searches stood the bot still three
    // seconds while the creeper walked up and went off (note 534).
    const scoutFresh = () => { const s = this.state.retreatScout; return !!s && s.feet === `${feet}` && Date.now() - s.at < 2000; };
    if (!holding && !extendable && !scoutFresh()) await this.scoutRetreat(task, danger);
    let options = this.stanceOptions(task, goal, save, danger, swung);
    if (extendable) {
      const holds = require('./holds');
      let shot = null; try { shot = require('./projectile-guard').incoming(bot, { reach: 24 })[0] || null; } catch (_) { shot = null; }
      holdEnded = holds.diverged(held.hold, { health: bot.health, mobs: danger, offered: Object.keys(options), shot, hurtBy: bot._hurtBy || {}, at: bot.entity.position });
      if (!holdEnded && inTime) holding = true;
      else if (!holdEnded) {
        const x = holds.extend(held.hold, Date.now(), bot.entity.position);
        if (x.extend) {
          holding = true; save();
          console.log(`[hold] ${held.choice.replaceAll('_', ' ')} held on ${Math.round(x.extend / 1000)} seconds more, ${Math.round((Date.now() - held.at) / 1000)} in all: nothing it was chosen on has changed (${holds.againstSays(held.hold) || 'no mob named'})`);
        } else {
          holdEnded = x.capped; holdCapped = true;
          // At its cap the rung's question is due, whatever its clock.
          require('./tried').rungDue(goal, `the ${held.choice.replaceAll('_', ' ')} stance ${x.capped}`);
        }
      }
      if (!holding && !scoutFresh()) { await this.scoutRetreat(task, danger); options = this.stanceOptions(task, goal, save, danger, swung); }
    }
    // A stance whose point is to strike, held to its end without a swing, a
    // step or a block: it failed, whatever its run said each tick (note 596).
    // mid-208-k-nether-4-fortress-1's fight "held" 5.4 seconds at a time with
    // no swing made, and was asked again as if it had been fought.
    if (held && !holding && striking && held.start && Date.now() - held.at >= 1000 && !stanceActed(bot, held.start)) {
      this.noteStanceIdle(held.choice, `held ${Math.round((Date.now() - held.at) / 1000)} seconds: nothing was struck, not a step was taken and no block was placed or dug`, danger);
    }
    if (holding && !options[held.choice] && Object.keys(options).length > 1 && !scoutFresh()) {
      await this.scoutRetreat(task, danger);
      options = this.stanceOptions(task, goal, save, danger, swung);
    }
    // A stance that just failed here is not offered again for twenty
    // seconds: the clean run's pillar, knocked off by four zombies, was
    // chosen again each tick, the rules fought between, and the bot went
    // pillar, fight, pillar, defend, off the edge, fight, flee, and died.
    // Every stance that failed in the last twenty seconds, so two that fail
    // are not tried turn about.
    // Here, not against these kinds of mob: a crowd's kinds change as mobs
    // come into view and go out of it, and each change offered the stances
    // that had just failed again. Of the stances chosen again within twenty
    // seconds and four blocks of failing in the midgame trials of
    // 2026-09-25 and 26, half were offered again that way (25 of 50).
    const failed = [].concat(this.state.stanceFailed || []).filter(f => Date.now() - f.at < 20000 && (f.where ? Math.hypot(f.where.x - feet.x, f.where.y - feet.y, f.where.z - feet.z) <= 4 : f.kinds === kinds));
    // Except a fight that failed for want of reach, once a mob is at reach:
    // trial 106's charge could not climb the stairs to a zombie at three
    // and a half blocks, the zombie came down to one, and with the fight
    // set aside the bot was offered a pillar, a retreat and a pocket in a
    // one-wide staircase, and died from fifteen health in nine seconds.
    // A shooter at arm's length is struck as a biter is: mid-239-g had a
    // skeleton at 1.7 blocks, the fight and the charge set aside a moment
    // before, and was offered only cover, a pocket and digging down; Jev
    // said none of these, twice, and a creeper came (note 510).
    const atReach = danger.some(t => t.distance <= 3.2 || (t.entity.position && canStrike(bot, t.entity)));
    // And an eat cut short with the food still carried: nothing about the
    // place made it fail, and at low health it is the stance that counts.
    // mid-205-q chose its golden apple at 0.9 health, the eat was cut short
    // under a second in, the apple still in the pack; it was taken off the
    // list for twenty seconds, and the zombies finished it (note 475). Said
    // with it, and every stance that failed is said in the state.
    // A stance that failed here just now stays on offer with the failure
    // said, not taken off for twenty seconds: that was a hidden threshold
    // (a second opinion's advice), and mid-239-h, a zombie at 0.6 blocks
    // and the fight failed two seconds before, was offered a pocket, the
    // work and a retreat, and died (note 521). Jev weighs a failure said.
    // Said once a stance, the latest with how many times: take_cover's
    // six failures in two seconds read as six sentences and no why in
    // mid-235-p-fortress-7 (note 528).
    const latest = new Map();
    for (const f of failed) latest.set(f.choice, { ...f, times: (latest.get(f.choice)?.times || 0) + 1 });
    for (const f of latest.values()) {
      if (!options[f.choice]) continue;
      const ago = Math.max(1, Math.round((Date.now() - f.at) / 1000));
      if (/^eat/.test(f.choice)) { options[f.choice].description += ` Tried ${ago} seconds ago here and cut short before it was eaten; still carried.`; continue; }
      if (f.choice === 'fight' && atReach) { options.fight.description += ` Tried ${ago} seconds ago here and ended; a mob is at reach now.`; continue; }
      const times = f.times > 1 ? `${f.times} times in the last ${Math.max(1, Math.round((Date.now() - Math.min(...failed.filter(x => x.choice === f.choice).map(x => x.at))) / 1000))} seconds here, the last ${ago} seconds ago` : `${ago} seconds ago here`;
      options[f.choice].description += ` Tried ${times}, and it failed${f.why ? `: ${String(f.why).slice(0, 200)}` : ''}.`;
    }
    // A stance that ended without doing anything (no swing, no step, no
    // block, nothing eaten), with nothing changed here since (the bot where
    // it was, each mob within a block of where it was and none come, health
    // as it was), would end the same again: it is not offered as if it might
    // not, only said, until something changes (note 596). Asked again every
    // quarter second with the same facts, mid-208-k-nether-4-fortress-1 took
    // the fight 350 times in two and a half minutes, each run at the hoglin
    // two below failing at once, "Tried 6 times ... and it failed" with no
    // why; and every seven seconds for twenty minutes after, each fight
    // standing with nothing to strike. Asking faster than anything changes
    // is the loop. Only while two or more other ways stay on offer: with one
    // left, leaving these out would be the code's choice, taken unasked;
    // then each stays on offer with the same said on it.
    const idle = this.stanceIdleNow(danger);
    // The stance held and holding is under way: its outcome is not in from
    // one run of it. A fight standing for a mob to come (its run a quarter
    // second at a time) read as "came to nothing" after its first quarter
    // second, was left out of its own next pass, and so was asked again at
    // once: 25589 (mid-242, 11:34:53Z) answered fight at 0.77 and was asked
    // again 0.5 seconds later, shield_guard, fourteen answers in three
    // minutes (note 752). Its end is judged when it ends (the striking rule
    // below, note 596; the hold's own, holds.js).
    const underWay = holding && held?.choice ? held.choice : null;
    const leftOut = [];
    const rest = () => Object.keys(options).filter(k => k !== 'none_good' && !leftOut.includes(k));
    const idleSays = f => `${f.times > 1 ? `ended ${f.times} times` : 'ended'} here without acting, the last ${Math.max(1, Math.round((Date.now() - f.at) / 1000))} seconds ago${f.why ? `: ${f.why}` : ''}; nothing has changed here since (the bot, the mobs and the health as they were), so it would end the same`;
    for (const f of idle) {
      if (!options[f.choice] || f.choice === underWay) continue;
      if (rest().length > 2) { leftOut.push(f.choice); continue; }
      const s = idleSays(f);
      options[f.choice].description += ` It ${s}.`;
    }
    // The scene as a stance's outcome turns on it (stance-scene.js, note 659):
    // an answer that came to nothing in it is left out as the idle rule
    // leaves one out, while it is unchanged and two or more other ways stay.
    const scenes = require('./stance-scene');
    const scene = scenes.sceneOf(bot, danger, { apart: this.lastApart?.ids || new Set(), strikes: e => !!e.position && canStrike(bot, e), blocks: shelter.materialStock(bot) });
    const book = scenes.observe(this.state, scene);
    const blazePlace = scenes.exposure(this.state, bot, { blazes: danger.some(t => t.entity.name === 'blaze') });
    const sceneOut = [];
    const sceneSays = f => `came to nothing ${f.times === 1 ? 'once' : `${f.times} times`} in this same scene, the last ${Math.max(1, Math.round((Date.now() - f.at) / 1000))} seconds ago${f.why ? `: ${f.why}` : ''}; nothing a stance turns on has changed since (sameSceneSoFar), so it would come to the same`;
    for (const f of scenes.nothingHere(book)) {
      if (!options[f.choice] || leftOut.includes(f.choice) || f.choice === underWay) continue;
      if (rest().length > 2) { leftOut.push(f.choice); sceneOut.push(f); continue; }
      options[f.choice].description += ` It ${sceneSays(f)}.`;
    }
    for (const k of leftOut) delete options[k];
    const notOfferedNow = [...idle.filter(f => leftOut.includes(f.choice)).map(f => ({ choice: f.choice, why: `${idleSays(f)}; offered again when something changes` })),
      ...sceneOut.map(f => ({ choice: f.choice, why: `${sceneSays(f)}; offered again when the scene changes` }))];
    if (!Object.keys(options).length) return false;
    // A spawner in reach, said with every stance: mid-207-j fought beside a
    // dungeon's zombie spawner six blocks off, told each time of "a zombie,
    // 2.5 seconds", and eight zombies came in a minute, twenty health to
    // none (2026-09-27).
    const spawner = spawnerAbout(bot);
    if (spawner) for (const o of Object.values(options)) o.description += spawner.says;
    // Held off for minutes: priced at what each has done, on every option.
    const quietSays = this.lastQuiet?.size ? require('./held-off').says(bot, [...this.lastQuiet.values()]) : '';
    if (quietSays) for (const o of Object.values(options)) o.description += quietSays;
    // Whether each can reach the bot, where that is in doubt (note 752): one
    // that has stood off, or one a run at found no way to. 25589's fight was
    // offered against a magma cube a run had just found no way to, and 25595's
    // stances named a hoglin "that can get to the bot" that stood 3.9 blocks
    // off for nine minutes with no route and no hit.
    const reachNow = (() => { try {
      const dz = require('./danger'), now = Date.now();
      return danger.slice(0, 6).filter(t => dz.standsOff(bot, t, now) || (bot._unreachable?.until > now && bot._unreachable.ids?.includes(t.entity.id)))
        .map(t => `the ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance * 10) / 10} blocks off: ${dz.reachSays(bot, t, { list: danger, now })}`);
    } catch (_) { return []; } })();
    if (reachNow.length) for (const o of Object.values(options)) o.description += ` Reach now: ${reachNow.join('; ')}.`;
    const farther = fartherShootersSay(bot, danger);
    if (farther) for (const o of Object.values(options)) o.description += farther.says;
    // A ghast about, said with every stance: when it fires, and that it
    // drifts rather than walks a way (ghast.js, note 551).
    const ghastSays = require('./ghast').ghastNote(danger, this.lastGhastHit);
    if (ghastSays) for (const o of Object.values(options)) o.description += ghastSays;
    // A pocket begun here, said with the stance that would go on with it
    // and in the state: how much of it stands, and the mob in its wall
    // (mid-226-h, note 520).
    const sealing = sealingSays(bot, this.state);
    if (sealing && options.seal) options.seal.description += ` ${sealing.says}`;
    // Met here, for what the place is said to be later (mobSourceAbout).
    this.noteMobPlace('encounter', danger.slice(0, 4).map(t => t.entity.name));
    // What ails the bot, and a witch's pursuit, said with every stance:
    // mid-244-w was poisoned by a witch, ran from it three times with the
    // witch walking after, held at one health by the poison, and a harming
    // potion from ten blocks ended it; its golden apples were never taken
    // (note 442).
    const ails = effectsSay(bot);
    const witchAbout = danger.find(t => t.entity.name === 'witch');
    for (const [k, o] of Object.entries(options)) {
      if (ails) o.description += ails;
      if (witchAbout && k === 'retreat') o.description += ' A witch walks after a player it has seen and throws within about ten blocks; a run that stays in its sight stays in its reach.';
    }
    // A quiet scene (stance-scene.js quietOf, note 700): the answer holds the
    // fifteen seconds it was priced over, said to the question.
    const quiet = scenes.quietOf(bot, danger, options);
    let choice = holding && options[held.choice] ? held.choice : null;
    // One stance possible is no choice: it is taken without asking.
    if (!choice && Object.keys(options).length === 1) choice = Object.keys(options)[0];
    // The scene unchanged since an answer that held: that answer holds, and
    // is not asked again (stance-scene.js, note 659); at holds.js's cap the
    // question is asked, and the rung's question is due.
    // Not where the stance before was ended by one of its physical triggers
    // (a newcomer, a hit, a line to where it hid, a creeper's walk, a shot,
    // the bot off its spot), a way new on offer or a shot on its way: those
    // are asked, as they were.
    let askedNow = false, noneGoodNow = false;
    const triggered = !!held && (!!held.lethalAgain || leftBe || hitSince || offSpot || lineAgain.length > 0 || !!blockAgain || !!shotThrough || pushedOpen || damageOver || (held.ids ? !!newcomer : held.kinds !== kinds)
      || /^a way not on offer|^a shot came/.test(holdEnded || ''));
    if (!choice && !holdCapped && !triggered) {
      const kept = scenes.holdFor(book, Object.keys(options));
      if (kept) {
        choice = kept.choice;
        const n = book.answers.filter(a => a.choice === choice && !a.asked).length + 1;
        if (n === 1 || n % 20 === 0) console.log(`[scene hold] ${choice.replaceAll('_', ' ')} held without asking (${n} in this scene): nothing a stance turns on has changed since it was answered ${Math.round((Date.now() - kept.askedAt) / 1000)} s ago${holdEnded ? `; the hold's own end said: ${holdEnded}` : ''}`);
      } else if (scenes.capped(book)) require('./tried').rungDue(goal, `the ${book.answers.at(-1).choice.replaceAll('_', ' ')} stance held ${Math.round((Date.now() - book.since) / 60000)} minutes with nothing it turns on changed`);
    }
    if (!choice) {
      const armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
      const ownCells = new Set(inOwnCells(bot, danger, feet).map(t => t.entity.id));
      const towardNow = comingAt(bot), following = held?.ids ? towardNow.filter(t => held.ids.includes(t.entity.id)) : [];
      // Which mobs about cannot get to the bot, first (note 525, note 560).
      const kept = this.lastApart?.mobs.length || this.lastApart?.round?.length ? apartSays(bot, this.lastApart).trim() : null;
      const anger = require('./anger');
      let calmNeutrals = null;
      try { calmNeutrals = anger.calmAbout(bot); } catch (_) { calmNeutrals = null; }
      const angryOf = t => { let a = null; try { a = anger.angerOf(bot, t.entity); } catch (_) { a = null; } return a ? { angry: `${a.why}: hunting the bot with its group, any way round` } : {}; };
      const state = { ...(kept ? { noWayToTheBot: kept } : {}), health: bot.health, food: bot.food, dimension: String(bot.game?.dimension || ''), armour, weapon: defenseWeapon(bot)?.name || 'bare hands',
        shield: bot.inventory.slots?.[45]?.name === 'shield', arrows: countOf(bot, 'arrow'), buildingBlocks: shelter.materialStock(bot),
        dropWithinThreeBlocks: require('./terrain').dropFacts(bot, feetCell(bot), 3) || false,
        darkHere: darkHere(bot),
        // The calm zombified piglins close by, and what a swing near them
        // turns (anger.js, note 703).
        ...(calmNeutrals ? { calmNeutralsNear: calmNeutrals } : {}),
        // Listed apart, those that cannot get to the bot (note 566). An
        // angry one of a group says why (note 703).
        threats: danger.filter(t => !this.lastApart?.ids.has(t.entity.id)).slice(0, 8).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible, ...angryOf(t) })),
        ...(this.lastApart?.ids.size ? { cannotGetToTheBot: danger.filter(t => this.lastApart.ids.has(t.entity.id)).slice(0, 8).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}) })) } : {}),
        // This bot's numbers: each mob's hit after its armour, swings to
        // kill with its weapon, and what fighting all of them here costs.
        // A creeper with its room to back into, its health and its fuse, as
        // the options price it: without them mid-243-aa's state said the
        // fight cost nothing, the creeper "going off 6 blocks off", while
        // its creeper stood lit 1.7 blocks off with no room behind the bot
        // and the fight and the dance each said a blast of 23 (note 547).
        estimate: fightEstimate({ threats: (this.lastApart?.ids.size ? [...danger.filter(t => !this.lastApart.ids.has(t.entity.id)), ...danger.filter(t => this.lastApart.ids.has(t.entity.id))] : danger).slice(0, 8).map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...sizeOf(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible, ...(this.lastApart?.ids.has(t.entity.id) ? { apart: true } : {}), ...(this.lastQuiet?.has(t.entity.id) ? { quiet: this.lastQuiet.get(t.entity.id).q.minutes } : {}), ...(ownCells.has(t.entity.id) ? { inCell: true } : {}), ...(t.entity.name === 'creeper' && t.entity.position ? creeperFacts(bot, t.entity) : {}) })),
          armour, weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield', atOnce: columnOpening(bot, feet) ? Infinity : openCells(bot, feet) + ownCells.size }),
        previousStance: held ? { choice: held.choice, secondsAgo: Math.round((Date.now() - held.at) / 1000), healthThen: held.health,
          ...(held.lethalAgain ? { askedAgainFor: `one shot that lands ends the bot now, and a shooter had a line to it: it stepped out of every line first (${this.state.lethalLine?.did || 'the rule'})` } : blockAgain ? { askedAgainFor: blockAgain } : shotThrough ? { askedAgainFor: `the ${shotThrough.replaceAll('_', ' ')} it was chosen against hit the bot ${Math.round((Date.now() - bot._hurtBy[shotThrough]) / 1000)} seconds ago, ${Math.round((held.health - bot.health) * 10) / 10} health lost since it was chosen` }
            : pushedOpen ? { askedAgainFor: (() => { const k = (held.shooters || []).find(n => (bot._hurtBy?.[n] || 0) > held.at); const p = held.start?.pos; return `the ${k.replaceAll('_', ' ')} it was chosen against landed a shot ${Math.round((Date.now() - bot._hurtBy[k]) / 1000)} seconds ago, ${Math.round((held.health - bot.health) * 10) / 10} health lost since it was chosen${p ? `, and the bot is ${Math.round(Math.hypot(bot.entity.position.x - p.x, bot.entity.position.z - p.z) * 10) / 10} blocks from where it chose` : ''}; it is still open over the drop a push puts it over`; })() }
            : lineAgain.length ? { askedAgainFor: `${lineAgain.map(e => `the ${e.name.replaceAll('_', ' ')} ${Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10} blocks off`).join(' and ')} ${lineAgain.length === 1 ? 'has' : 'have'} a line to where the bot hid` }
            : offSpot ? { askedAgainFor: 'the bot is off the spot it hid in' }
            : newcomer ? { askedAgainFor: `a ${newcomer.entity.name.replaceAll('_', ' ')} come within ${Math.round(newcomer.distance)} blocks` }
            // What the hold was chosen on, falsified, or its cap (holds.js).
            : holdEnded ? { askedAgainFor: holdEnded, heldSeconds: Math.round((Date.now() - held.at) / 1000) }
            : following.length ? { askedAgainFor: `it is over, and ${following.length === 1 ? 'a mob it was chosen against is' : `${following.length} mobs it was chosen against are`} still ${this.lastPillarHold?.stood ? `facing the bot, no nearer in the ${this.lastPillarHold.minutes} up on the pillar` : 'coming at the bot'}` } : {}) } : null,
        // Coming at the bot now, each at its own speed: a retreat's chasers
        // after the run (note 544).
        ...(towardNow.length ? { comingAtTheBot: comingFacts(towardNow) } : {}),
        // What failed here just now, and so is not asked again for a while:
        // each question after a failure began with nothing said of it.
        ...(failed.length ? { failedHereJustNow: failed.map(f => ({ choice: f.choice, secondsAgo: Math.round((Date.now() - f.at) / 1000), ...(f.why ? { why: f.why } : {}) })) } : {}),
        // Left out until something changes: each ended here without acting.
        ...(notOfferedNow.length ? { notOfferedNow } : {}),
        // A walk of survival's own that found no route here (step), whatever it was for.
        ...(this.state.walkFailed && Date.now() - this.state.walkFailed.at < 20000 ? { walkFailedJustNow: this.state.walkFailed.says } : {}),
        // take_cover is missing from the tree because no route was found
        // for it, not for no reason (note 743).
        ...(this.state.stanceTakeCoverNoRoute ? { takeCoverNoRoute: this.state.stanceTakeCoverNoRoute } : {}),
        ...(spawner ? { spawner: { blocksAway: spawner.distance, ...(spawner.mob ? { makes: spawner.mob } : {}) } } : {}),
        ...(farther ? { shootersFartherInSight: farther.list } : {}),
        ...(sealing ? { pocketHere: { placed: sealing.placed, of: sealing.of, ...(sealing.mobInCells ? { mobInCells: sealing.mobInCells } : {}), says: sealing.says } } : {}),
        ...(ails ? { effectsNow: ails.trim() } : {}),
        // What fights with blazes came to in the trials, by the health and hunger
        // begun at (blaze-record.js, note 631).
        ...(danger.some(t => t.entity.name === 'blaze') ? { playedRecord: require('./blaze-record').says(bot), playedAnswers: require('./blaze-record').answersSay(bot) } : {}),
        // The blazes about by count, how many can see this cell, the spawner's rule and the rows by count (note 665).
        ...(danger.some(t => t.entity.name === 'blaze') ? { blazeCounts: (() => { try { return require('./blaze-record').entryFacts(bot, { about: danger.filter(t => t.entity.name === 'blaze' && t.visible).map(t => t.entity), cage: require('./blaze-stand').spawnerAt(bot) }).says; } catch (_) { return undefined; } })() } : {}),
        // The lull by a live spawner: no blaze sees the bot, and the clock of
        // its next try (spawner-clock.js, note 691).
        ...(danger.some(t => t.entity.name === 'blaze') ? (l => l ? { lull: l.says } : {})((() => { try { return require('./spawner-clock').lull(bot); } catch (_) { return null; } })()) : {}),
        // Up on the pillar: how the hold has gone (pillar-wait.js, note 590).
        ...(this.lastPillarHold ? { pillarSoFar: this.lastPillarHold.facts } : {}),
        // Gold, where piglins are about and none is worn (note 581).
        ...((g => g ? { piglinsAndGold: g } : {})(piglinGoldSays(bot, [...danger, ...(this.lastFar || [])]))),
        // The scene unchanged and what each answer in it came to, or what
        // changed since the last one's answers; at a blaze fight, the place so
        // far (note 659). What followed the trials' rods is no longer said:
        // re-asked without it, no answer of 8 moved (note 672).
        ...((s => s ? { sameSceneSoFar: s } : {})(scenes.says(book))),
        ...(quiet ? { quietScene: quiet.says } : {}),
        ...(blazePlace ? { hereSoFar: scenes.exposureSays(blazePlace) } : {}),
        // One shot that lands ends the bot here: the rule, its numbers, and
        // what it did (lethal-line.js, note 701).
        ...(lethalNow || this.state.lethalLine ? { oneShotEnds: [lethalNow?.says || this.state.lethalLine?.says, this.state.lethalLine?.did ? `Just now: ${this.state.lethalLine.did}.` : null].filter(Boolean).join(' ') } : {}),
        riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot) };
      // At a live cage, what the stay there has come to, on each hold, and
      // what cover gives up at full health (cage-yield.js, note 702).
      const cageSoFar = (() => { try { return require('./cage-yield').annotate(bot, goal, options); } catch (_) { return null; } })();
      if (cageSoFar) state.cageSoFar = cageSoFar;
      // A hoglin about when food is what the bot lacks: killed, it is the
      // food (fortress-away.js, note 702; 25590 was held by one at 10 health,
      // hunger 10, nothing to eat, and every word said it only as a threat).
      const hoglinFood = (() => { try { return require('./fortress-away').hoglinFoodSays(bot, danger); } catch (_) { return null; } })();
      if (hoglinFood) {
        state.hoglinIsFood = hoglinFood.trim();
        for (const k of ['fight', 'strike_from_above', 'fight_from_footing']) if (typeof options[k]?.description === 'string') options[k].description += hoglinFood;
      }
      // hunt_target answered defer a moment ago from about here: the
      // observed situation was unsuitable to hunt, and a closing stance
      // (fight, charge_nearest and the rest of shot-reflex.js STANCE_SHOTS.
      // closing) chosen against the same mobs now reverses that without
      // ever hearing it (note 723). Said on every closing option and in the
      // state, not refused: the stance is Jev's, told what was just chosen.
      const huntDefer = require('./danger').huntAnswerJustNow(goal, bot);
      if (huntDefer) {
        state.huntAnswerJustNow = `defer (hunt target), chosen ${huntDefer.secondsAgo} second${huntDefer.secondsAgo === 1 ? '' : 's'} ago from about here: the observed situation was unsuitable to hunt.`;
        const closing = require('./shot-reflex').STANCE_SHOTS.closing;
        for (const k of Object.keys(options)) if (closing.has(k) && typeof options[k].description === 'string')
          options[k].description += ` This reverses defer (hunt target), chosen ${huntDefer.secondsAgo} second${huntDefer.secondsAgo === 1 ? '' : 's'} ago from about here: the hunt read the situation as unsuitable then.`;
      }
      // A stance that stands to hold the shield up (STANCE_SHOTS.holding)
      // and one that closes to strike (STANCE_SHOTS.closing) are opposite
      // sides of the same encounter; picking the other side of the one just
      // held is a reversal, priced as such, not a fresh pick with nothing
      // behind it (note 743: 25598 went take_cover, fight, take_cover,
      // fight (0.89), take_cover against one skeleton in three minutes,
      // each asking silent about the one just before it).
      if (held?.choice) {
        const shots = require('./shot-reflex').STANCE_SHOTS;
        const heldSide = shots.closing.has(held.choice) ? 'closing' : shots.holding.has(held.choice) ? 'holding' : null;
        if (heldSide) {
          const heldAgo = Math.max(1, Math.round((Date.now() - held.at) / 1000));
          const lastAnswer = book?.answers?.at(-1);
          const heldDid = lastAnswer && lastAnswer.choice === held.choice
            ? (scenes.cameToNothing(lastAnswer) ? `came to nothing${lastAnswer.why ? `: ${lastAnswer.why}` : ''}` : 'held, with nothing it turns on changed')
            : 'held';
          for (const [k, o] of Object.entries(options)) {
            if (k === held.choice || typeof o.description !== 'string') continue;
            const side = shots.closing.has(k) ? 'closing' : shots.holding.has(k) ? 'holding' : null;
            if (side && side !== heldSide) o.description += ` This reverses ${held.choice.replaceAll('_', ' ')}, chosen ${heldAgo} second${heldAgo === 1 ? '' : 's'} ago: it ${heldDid}.`;
          }
        }
      }
      // Each stance's price rides with it (not in its words): what the code
      // takes when Jev says none is good (decisions/index.js pickWhenNoneGood, note 691).
      const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, ...(o.expects ? { expects: o.expects } : {}) }]));
      let decision;
      try {
        // Jev's answer can take seconds, and a creeper's fuse is a second
        // and a half: while it is out, the bot backs from a creeper coming
        // on, as a player steps back while thinking. mid-231-a stood still
        // four seconds waiting for the answer with one eight blocks off and
        // was blown up twice, the second time dead before the answer came
        // (2026-09-26).
        let answered = false;
        // Its none-good answers counted by this scene, not the whole state's
        // fingerprint (stance-scene.js, note 659).
        const asking = this.decide(task, goal, save, { id: 'encounter_stance', state, tree, situation: `stance:${scene.key}`,
          isFresh: () => Math.abs(bot.health - state.health) < 4 }).finally(() => { answered = true; });
        // And swings at what is in reach meanwhile, as a player fights on
        // while thinking: mid-227-i's fight with magma cubes was asked again
        // every two seconds, each answer two seconds with no swing, and the
        // cubes took it from seventeen to one (2026-09-27).
        // With a shield carried and a biter the guard answers at hand, the
        // swings are the guard's (wither-guard.js): the shield up facing it,
        // the sword swung after its blow lands on the shield. The swing
        // reflex lowered the shield, readied a strike and raised it again,
        // and the blow landed in that gap: 25598's first blow at 18:57:07.3
        // came 17 ms after it; on a scratch server, a wither skeleton at arm's
        // length for twenty seconds, 15 blows of 15 landed with the reflex,
        // none with the guard (note 683).
        const guardAsked = () => bot.inventory?.slots?.[45]?.name === 'shield' && threats(bot, 4).some(t => require('./wither-guard').inGuard(t) && (t.visible || t.distance <= 2));
        const guarding = (async () => { while (!answered) { try {
          if (await this.backFromCreeper(task, () => answered)) continue;
          if (guardAsked()) { await require('./wither-guard').guard(bot, task, { until: Date.now() + 250, radius: 6, stop: () => answered }); continue; }
          if (!await defendNearby(bot, task, goal, save)) await sleep(100);
        } catch (_) { return; } } })();
        try { decision = await asking; } finally { answered = true; await guarding; }
      } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
      // Stale: the moment moved on while Jev answered; the next tick asks
      // again from where the bot is then.
      if (decision.stale) return true;
      choice = decision.path.at(-1);
      askedNow = !decision.only; noneGoodNow = !!decision.noneGood;
      // Chosen up on the pillar: counted for what the hold says next.
      if (this.lastPillarHold) require('./pillar-wait').noteChoice(this.state, choice);
    }
    // The mobs it was chosen against as they were, for a pocket it makes to
    // say what it was sealed against (pocket-wait.js, note 584).
    if (!holding || held.choice !== choice) this.state.stance = { choice, kinds, ids: [...new Set([...danger, ...(this.lastHidden || [])].map(t => t.entity.id))],
      mobs: danger.slice(0, 4).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: !!t.visible })), shooters: [...new Set(danger.filter(t => shooter(t.entity)).map(t => t.entity.name))], at: Date.now(), health: bot.health, ...(options[choice]?.expects ? { expects: options[choice].expects } : {}),
      // What the bot had done when it was chosen: whether the stance acts is
      // measured from here (stanceActed, note 596).
      start: stanceMark(bot),
      // Chosen with one shot's end said: the rule does not step it out again
      // while it holds (note 701).
      ...(lethalNow || this.state.lethalLine ? { lethalKnown: true } : {}),
      // What it was chosen on, for holding on while that stands (holds.js).
      hold: require('./holds').begin({ choice, health: bot.health, expects: options[choice]?.expects || null, mobs: danger, offered: [...Object.keys(options), ...leftOut] }) };
    // An answer in this scene, asked or held without asking (note 659).
    if (!holding || held.choice !== choice) {
      scenes.answered(this.state, { choice, asked: askedNow, noneGood: noneGoodNow, striking: STRIKING_STANCES.has(choice), start: this.state.stance.start });
      scenes.exposureAnswered(this.state, choice);
    }
    // The reflexes see the stance too (the hurt watchdog, the shield, the
    // meal): they give way to it while it holds.
    const stance = bot._stance = this.state.stance;
    // Lowered for the stance's hands, but not for one that stands behind
    // the shield itself: lowered and raised again, it blocks nothing for a
    // quarter second (combat.js SHIELD_BLOCKS_AFTER_MS), and a wither
    // skeleton at arm's length landed its blow in that gap at re-askings
    // of shield_guard (25598, 18:57:08.7 and 09.8, 236 and 49 ms after the
    // answer; note 683). The same gap under any stance that means to stand
    // and hold the shield toward the mobs (shot-reflex.js STANCE_SHOTS.
    // holding: take_cover, bunker, seal, dig_in, a box, a nook, a pillar,
    // the rest): none of them needs the hand's speed lowering it costs, and
    // lowering it on every tick this stance runs never let it stand raised
    // the quarter second it takes to start blocking, so a shot or a blow
    // landed on it whole as if it were down the whole time. 25598 held
    // take_cover against one skeleton and took two such hits, 18 to 12
    // health and 17.9 to 14.9, each "shield rising, not yet blocking";
    // stance-scene.js counted each as the stance's own failure and asked
    // again, and the answer flipped take_cover, fight, take_cover, fight,
    // take_cover in three minutes (note 743).
    const holdsShield = SHIELD_STANCES.has(choice) || require('./shot-reflex').STANCE_SHOTS.holding.has(choice);
    if (!/^shoot_/.test(choice) && !holdsShield) lowerShield(bot);
    stance.running = true;
    let done;
    // A stance whose action is resting (set aside after it failed) is a stance
    // that failed: thrown on up, the stance stayed held, ran again at every
    // tick and was refused, and the turn went to the work with nothing done.
    // mid-235-i chose to dig down at 6.7 health, its shaft pocket resting,
    // and stood fifteen seconds under a skeleton's arrows (2026-09-27).
    takeTurn(bot, 'survival', `stance: ${choice}`, { threats: danger.slice(0, 4).map(t => `${t.entity.name} ${Math.round(t.distance)}`) });
    // And one whose walk found no route (skills.js NoRoute): the stance
    // failed, said as such to the next question. Thrown on, it went past
    // the survival layer into the work, which persisted it as its own step.
    // Or one that says why it could not (failWhy): mid-205-v's retreat failed
    // twenty times on its column, each said to Jev as "it failed" and no
    // more (note 525).
    let why = null;
    delete this.state.failWhy;
    delete this.state.stanceWhy;
    try { done = await options[choice].run(); }
    catch (err) { if (err.name === 'NoRoute') why = noRouteSays(err, `the ${choice.replaceAll('_', ' ')} walk`); else if (err.name === 'StanceFailed') why = err.message; else if (err.name !== 'SetAside') throw err; done = false; }
    finally { stance.running = false; stance.ranAt = Date.now(); }
    if (!done && !why && this.state.failWhy) why = this.state.failWhy;
    delete this.state.failWhy;
    // Chosen in a quiet scene: the same mobs leave the work be for the rest
    // of the fifteen seconds, beyond eight blocks and with no hit (note 700).
    // keep_working's run sets its own.
    if (quiet && choice !== 'keep_working' && !(bot._wavedOff?.until > quiet.until)) {
      bot._wavedOff = { ids: quiet.ids, until: quiet.until, beyond: scenes.NEAR, quiet: true };
      console.log(`[scene hold] quiet: ${choice.replaceAll('_', ' ')} answered with every way under a point of damage in fifteen seconds; ${danger.slice(0, 3).map(t => `${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)}`).join(', ')} left to the work until ${new Date(quiet.until).toISOString().slice(11, 19)}Z unless one comes within ${scenes.NEAR}, a hit lands, or another comes`);
    }
    // A stance that could not be carried out is not offered again for a
    // while, and Jev chooses again at the next tick from what is left.
    why ||= this.state.stanceWhy || null; delete this.state.stanceWhy;
    // What it came to in this scene; a meal cut short is not the place's
    // doing (note 475).
    scenes.ran(this.state, { choice, done: done || /^eat/.test(choice), acted: stanceActed(bot, stance.start) || /^eat/.test(choice), why });
    // Held without asking, against one bow or crossbow shooter alone, and
    // still good on its own clock and health (soloHeld, physical, above):
    // a run that failed to land this tick (no firm step, no closer ground,
    // its own three-second give-up) is one attempt, not the stance's
    // outcome; it is kept, and the next tick's run tries again over the
    // ground as it is then, rather than a fresh question going out to Jev
    // (note 715). Only while it is a closing or holding stance (shot-
    // reflex.js STANCE_SHOTS): a run once (a meal, a step off) is not
    // retried this way, and one Jev was just asked and answered (askedNow)
    // is idled as any answer that failed at once is, so a stance Jev chose
    // and that failed at once is still said to the next question.
    const closeOrHold = !!require('./shot-reflex').stanceShotsOf(choice);
    const keepFailedHold = !done && !askedNow && soloHeld && physical && !damageOver && inTime && closeOrHold;
    if (!done && !keepFailedHold) {
      delete this.state.stance; delete bot._stance;
      this.state.stanceFailed = [...failed, { choice, kinds, where: { x: feet.x, y: feet.y, z: feet.z }, at: Date.now(), ...(why ? { why } : {}) }];
    }
    if (!done) {
      // Ended without acting: left out while nothing here changes.
      // Not a meal cut short with the food still carried: nothing about the
      // place made it fail (note 475).
      if (!/^eat/.test(choice) && !stanceActed(bot, stance.start)) this.noteStanceIdle(choice, why, danger);
    }
    return true;
  }

  // A stance that ended here without acting, kept with the scene it ended
  // in (note 596): the bot's place, health, and each mob about by where it
  // stood. Kept ten minutes at most; read while the scene is the same.
  noteStanceIdle(choice, why, danger) {
    const now = Date.now();
    const list = (this.state.stanceIdle || []).filter(f => now - f.at < STANCE_IDLE_MS);
    const scene = stanceScene(this.bot, danger);
    const before = list.find(f => f.choice === choice && sameScene(f.scene, scene));
    const entry = { choice, at: now, scene, times: (before?.times || 0) + 1, first: before?.first ?? now, ...(why ? { why: String(why).slice(0, 240) } : before?.why ? { why: before.why } : {}) };
    this.state.stanceIdle = [...list.filter(f => f !== before), entry];
  }
  // Those whose scene is the scene now.
  stanceIdleNow(danger) {
    const now = Date.now(), scene = stanceScene(this.bot, danger);
    this.state.stanceIdle = (this.state.stanceIdle || []).filter(f => now - f.at < STANCE_IDLE_MS && sameScene(f.scene, scene));
    return this.state.stanceIdle;
  }

  // A shooter in view at bow range, and a bow in the pack: running from a
  // skeleton is how most of the dream run's deaths went, arrows in the back.
  // Code lists the shots that have a clear arc, the retreat and the pocket;
  // Jev picks (with Jev not reachable, the bot holds: note 707). A melee mob within three blocks is the swing
  // and escape rules' business, not a moment to draw a bow.
  async rangedChoice(task, goal, save, danger, armed) {
    const bot = this.bot;
    if (bot.health < 8 || danger.some(t => t.distance <= 3 && !shooter(t.entity))) return false;
    const targets = shotTargets(bot, danger).slice(0, 3);
    if (!targets.length) return false;
    const tree = {};
    // What the shot, the run and the pocket each risk, said (the decision
    // audit, 2026-09-25): a creeper closing while the bow draws, the mobs
    // the list in view leaves out, and the pocket no longer hidden when a
    // creeper is near but offered with what a creeper does to one.
    const unseen = require('./danger').unseenNote(bot, danger);
    const creeper = danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7).sort((a, b) => a.distance - b.distance)[0];
    const creeperShot = creeper ? ` A creeper is ${Math.round(creeper.distance)} blocks off: it closes while the bow draws, and its blast reaches about five.` : '';
    for (const t of targets) tree[`shoot_${t.entity.id}`] = { description: { action: 'Shoot this mob with the bow from where the bot stands. It is in clear view at bow range and shoots back; each arrow takes about a second to draw, standing still.' + creeperShot + unseen,
      entity: t.entity.name, distance: Math.round(t.distance), arrowsCarried: countOf(bot, 'arrow') }, run: () => this.shootAt(task, goal, save, t) };
    tree.retreat = { description: 'Run for footing out of its range and out of its sight; the mob keeps shooting while the bot runs.' + NO_ROUTE_YET + unseen, run: () => this.escape(task, goal, save, danger, armed) };
    if (shelter.materialStock(bot) >= 12) tree.dig_in = { description: 'Seal a two-block pocket where the bot stands and wait for it to lose interest.' + (creeper ? ` A creeper ${Math.round(creeper.distance)} blocks off walks up to a pocket and goes off before it closes.` : '') + unseen, run: () => this.sealHere(task, goal, save, danger) };
    const about = [...danger];
    for (const t of threats(bot, 16)) if (!about.some(a => a.entity.id === t.entity.id)) about.push(t);
    const state = { health: bot.health, food: bot.food, arrowsCarried: countOf(bot, 'arrow'), recentSurvivalAction: goal.survivalAction,
      threats: about.sort((a, b) => a.distance - b.distance).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), shoots: shooter(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: t.visible !== false })),
      riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal) };
    const decision = await this.decide(task, goal, save, { id: 'ranged_response', state, tree, context: { health: bot.health },
      isFresh: () => Math.abs(bot.health - state.health) < 4 && targets.some(t => bot.entities[t.entity.id] === t.entity && t.entity.isValid !== false) });
    if (decision.stale) return true;
    await decision.action.run();
    return true;
  }

  async shootAt(task, goal, save, threat) {
    const bot = this.bot, target = threat.entity;
    this.report(goal, save, { action: 'shoot', target: target.name, entityId: target.id, distance: Number(threat.distance.toFixed(1)), arrows: countOf(bot, 'arrow'), health: bot.health });
    // The target is the point; the draw stops only for a melee mob closing
    // to arm's length, which the next loop meets with the sword.
    const threatCheck = b => {
      if (threats(b, 3).some(t => t.entity !== target && !shooter(t.entity) && (t.visible || t.distance <= 2))) throw Object.assign(new Error('A mob closed to arm\'s length during the draw'), { name: 'ShotInterrupted' });
    };
    try {
      const shot = await shoot(bot, task, target, { threatCheck });
      goal.survivalAction = { ...goal.survivalAction, released: true, arrowId: shot.arrowId, ticks: Number(shot.ticks.toFixed(1)), at: new Date().toISOString() }; save();
    } catch (err) {
      task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err;
      goal.survivalAction = { ...goal.survivalAction, released: false, reason: err.message, at: new Date().toISOString() }; save();
    }
    delete this.state.trappedSince;
  }

  // Footing out of reach and out of sight, by a route that does not pass a
  // hostile: true when the bot set off (arrived or was cut short, so the
  // next look is from wherever it got to), false when no route was found.
  // With `only`, the room gained is measured from those mobs alone (the
  // creepers in a crowd), and a nearer hop will do; the route still passes
  // no hostile.
  // The footing a run could go to, found without a route search: the far
  // spots past a persistent chaser's follow range, and the nearer ones that
  // gain `gain` blocks on every mob about. Said on the retreat option too.
  escapeFootings(danger, { gain = 4, only = false } = {}) {
    const bot = this.bot;
    const ids = ESCAPE_FOOTING.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
    // Away from every hostile about, not only the ones in view this
    // instant: at two health the bot ran from a blaze, then from a piglin
    // twenty blocks the other way, straight back to the blaze, which had
    // dropped out of sight for the second look.
    const about = [...new Set([...danger.map(t => t.entity), ...hostileEntities(bot, 32)])];
    const from = only ? danger.map(t => t.entity) : about;
    const distance = p => Math.min(...from.map(e => e.position.distanceTo(p)));
    // A creeper does not burn off at dawn and follows to about sixteen
    // blocks. A six-block hop from one only buys a minute before it is back
    // at the same tree; the escape from a mob that persists has to reach
    // past its follow range, or the same creeper interrupts all morning.
    const persistent = danger.some(t => PERSISTENT_THREATS.has(t.entity.name));
    const radius = persistent ? 40 : 20;
    const footing = bot.findBlocks({ matching: ids, maxDistance: radius, count: 512,
      useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
    }).map(p => p.offset(0, 1, 0)).filter(p => !isSetAside(this, 'escape', p) && !lavaBeside(bot, p));
    // Out of a sculk sensor's hearing where any footing is: mid-230-n ran
    // from a creeper into the deep dark and worked beside a shrieker that
    // called a warden (note 414). Within it only when nothing else is.
    const heard = require('./sculk').hearing(bot, radius);
    const quiet = footing.filter(p => !heard(p));
    if (quiet.length && quiet.length < footing.length) footing.splice(0, footing.length, ...quiet);
    const gaining = p => distance(p) >= distance(bot.entity.position) + gain;
    // With a hoglin about, no footing near an edge and no route along one.
    const heavy = heavyHitters(threats(bot, 16), 16).length > 0;
    // An arrow's knockback moves the bot as a toss does, less far: with a
    // shooter about, no footing beside a drop into lava or one deep enough
    // to take half the health. mid-242-p ran from a crossbow piglin to a
    // spot beside a three-block drop to the lava, and the next arrow put it
    // in (note 427).
    const shot = !heavy && danger.some(t => shooter(t.entity));
    const deadlyBeside = p => { const d = require('./terrain').dropNear(bot, p, 2); return !!d && (d.into === 'lava' || d.damage >= (bot.health ?? 20) / 2); };
    const edgeSafe = p => heavy ? !dropWithin(bot, p, 2) : !(shot && deadlyBeside(p));
    // The far spots first when the chaser persists; the ordinary hop is the
    // fallback, because standing still beside a creeper is never the answer.
    const far = persistent ? footing.filter(p => p.distanceTo(bot.entity.position) >= 20 && distance(p) >= 20 && edgeSafe(p)).sort((a, b) => distance(b) - distance(a)) : [];
    const near = footing.filter(p => p.distanceTo(bot.entity.position) >= (only ? 3 : 6) && gaining(p) && edgeSafe(p)).sort((a, b) => distance(b) - distance(a));
    // Out of sight first, as the retreat says it runs: of the nearest
    // two dozen, those no shooter in sight has a line to from where it is
    // now go before those it has. Farther from the mobs alone, a ghast
    // with a range of 64 had a line to every footing the runs went for
    // (note 621).
    const shooting = danger.filter(t => t.visible && shooter(t.entity)).map(t => t.entity);
    if (shooting.length && near.length) {
      const { seenFrom } = require('./bunker'), head = near.splice(0, 24);
      const seen = new Map(head.map(p => [p, seenFrom(bot, shooting, p).length > 0]));
      near.unshift(...head.filter(p => !seen.get(p)), ...head.filter(p => seen.get(p)));
    }
    return { about, footing, far, near, heavy, persistent, radius };
  }

  // Footing past the reach of what bites: further from each biter that can
  // follow the bot than the range it follows a player to (combat-estimate
  // followRange), and nearer the bot than any of them, so the bot is there
  // first. The shooters are not kept clear of: their shots over the run are
  // its price, said. Where every mob about is kept clear of, as the retreat
  // does, a crowd leaves no way: mid-242-ae-nether-1 in a bastion, eighteen
  // piglins within twenty-four and a piglin brute seven blocks off, was told
  // "no way out" and never offered the way off the brute's ground (note 576).
  reachFootings(danger) {
    const bot = this.bot;
    const biters = danger.filter(t => t.entity?.position && !shooter(t.entity) && !['creeper', 'enderman'].includes(t.entity.name) && !t.entity.vehicle && t.distance <= followRange(t.entity.name));
    if (!biters.length || typeof bot.findBlocks !== 'function') return null;
    const clear = t => followRange(t.entity.name) + 2;
    const ids = ESCAPE_FOOTING.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
    const radius = Math.min(32, Math.max(...biters.map(t => clear(t) + 8)));
    const here = bot.entity.position;
    const heavy = heavyHitters(threats(bot, 16), 16).length > 0;
    const shot = !heavy && danger.some(t => shooter(t.entity));
    const deadlyBeside = p => { const d = require('./terrain').dropNear(bot, p, 2); return !!d && (d.into === 'lava' || d.damage >= (bot.health ?? 20) / 2); };
    const edgeSafe = p => heavy ? !dropWithin(bot, p, 2) : !(shot && deadlyBeside(p));
    const candidates = bot.findBlocks({ matching: ids, maxDistance: radius, count: 512,
      useExtraInfo: b => shelter.solid(b) && shelter.replaceable(bot.blockAt(b.position.offset(0, 1, 0))) && shelter.replaceable(bot.blockAt(b.position.offset(0, 2, 0))),
    }).map(p => p.offset(0, 1, 0))
      .filter(p => !isSetAside(this, 'escape', p) && !lavaBeside(bot, p) && edgeSafe(p) &&
        biters.every(t => t.entity.position.distanceTo(p) >= clear(t) && t.entity.position.distanceTo(p) > p.distanceTo(here)))
      .sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    return { biters, candidates: candidates.slice(0, 12), heavy };
  }

  // The run past their reach, chosen: the way the stance question found, or
  // searched again from here.
  async leaveReach(task, goal, save, danger) {
    const bot = this.bot;
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    const creepers = this.creepersOfRun(danger), unsteer = this.steerFromCreepers(movements, creepers);
    try {
      const scout = this.state.retreatScout;
      const fresh = scout?.pastReach && Date.now() - scout.at < 2000 && scout.feet === `${feetCell(bot)}`;
      let p = fresh ? pos(scout.pastReach.destination) : null;
      if (!p) {
        const found = this.reachFootings(danger);
        const way = found?.candidates.length ? await this.wayAway(task, movements, { about: found.biters.map(t => t.entity), heavy: found.heavy, creepers }, found.candidates, { budgetMs: searchBudget(bot, creepers) }) : { p: null };
        if (!way.p) { this.state.failWhy = 'no footing past the reach of those that bite has a route that passes none of them'; return false; }
        p = way.p;
      }
      delete this.state.retreatScout;
      this.report(goal, save, { action: 'leave_reach', destination: { x: p.x, y: p.y, z: p.z }, threats: danger.map(t => t.entity.name).slice(0, 4) });
      const from = bot.entity.position.clone();
      try { await this.actions.navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 10000, stallMs: 3000 }); delete this.state.trappedSince; return true; }
      catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; setAside(this, 'escape', p, err, 60000); save(); return ranFrom(this, from, p, err); }
    } finally { Object.assign(movements, previous); unsteer(); bot.clearControlStates(); }
  }

  async runAway(task, goal, save, danger, { gain = 4, only = false } = {}) {
    const bot = this.bot;
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    const creepers = this.creepersOfRun(danger), unsteer = this.steerFromCreepers(movements, creepers);
    try {
      const { about, footing, far, near, heavy, persistent } = this.escapeFootings(danger, { gain, only });
      // Beside lava, one knockback is the end: the dream run died that way at
      // its pouring spot, in full iron, with the diamond pickaxe. Get two
      // blocks from the lava first, whatever the mob does meanwhile.
      if (lavaBeside(bot, feetCell(bot))) {
        const dry = footing.filter(p => p.distanceTo(bot.entity.position) <= 8).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        for (const p of dry.slice(0, 6)) {
          const route = await surveyRoute(bot, task, movements, new goals.GoalBlock(p.x, p.y, p.z), 150);
          if (route.status !== 'success') continue;
          this.report(goal, save, { action: 'leave_lava_edge', destination: { ...p }, threats: danger.map(t => t.entity.name) });
          const from = bot.entity.position.clone();
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(p.x, p.y, p.z), { timeoutMs: 5000, stallMs: 2000 }); } catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; }
          // A walk that went nowhere is no step back: the next footing, and
          // with none, the rest of the answer. mid-229-i "left the lava
          // edge" twenty times a second without a step, a skeleton shooting
          // (2026-09-27), as note 370's step off an edge did.
          if (bot.entity.position.distanceTo(from) < 0.3) continue;
          return true;
        }
      }
      // The way the stance question already found from here, if it is fresh.
      const scout = this.state.retreatScout;
      const fresh = scout && !only && gain === 4 && Date.now() - scout.at < 2000 && scout.feet === `${feetCell(bot)}`;
      // Every candidate already tried a moment ago from here, none a way.
      const noWay = n => n ? `none of the ${plural(n, 'spot')} further from every mob has a route that passes none of them` : 'no footing near is further from every mob';
      if (fresh && !scout.destination && scout.tried >= scout.candidates) { delete this.state.retreatScout; this.state.failWhy = noWay(scout.candidates); return false; }
      const candidates = [...far.slice(0, 12), ...near.slice(0, 12)];
      // Standing still while it searches, the bot is not away from a
      // creeper coming on: the search stops where the creeper would be
      // within three (or, one lit, at once), and the run takes the least
      // blast found by then or fails, asked again (note 604).
      const way = fresh && scout.destination ? { p: pos(scout.destination) } : await this.wayAway(task, movements, { about, heavy, creepers }, candidates, { budgetMs: searchBudget(bot, creepers) });
      delete this.state.retreatScout;
      if (!way.p) { this.state.failWhy = noWay(candidates.length); return false; }
      const p = way.p, destination = new goals.GoalBlock(p.x, p.y, p.z);
      const from = bot.entity.position.clone();
      try { await this.actions.navigate(bot, task, destination, { timeoutMs: persistent ? 14000 : 7000, stallMs: 3000 }); delete this.state.trappedSince; return true; }
      catch (err) {
        task.check(); if (err.name === 'NeedsAir') throw err;
        setAside(this, 'escape', p, err, 60000); save();
        // Reobserve positions after a partial escape instead of running the
        // next stale route against the old mob positions. A run that never
        // left where it began is no escape: said as the failure it is.
        // mid-242-ah-nether-2-fortress-5's four retreats each stood three
        // seconds where they began under a ghast's fire, every one taken
        // as done, and each next stance was told "a way is found" again,
        // nothing said of the last (note 621).
        return ranFrom(this, from, p, err);
      }
    } finally { Object.assign(movements, previous); unsteer(); bot.clearControlStates(); }
  }

  // The first of the candidates with a route that passes no hostile (and, a
  // hoglin about, no edge), within `budgetMs` of route searches:
  // { p, route, tried } or { p: null, tried }.
  // With a creeper about (`creepers`, creeper-run.js creepersFor), each way
  // is walked in time against its fuse (wayAgainstCreepers): the first on
  // which none goes off is the way; with none such, the one whose blast is
  // least, said with it (note 604).
  async wayAway(task, movements, { about, heavy, creepers = [] }, candidates, { budgetMs = Infinity } = {}) {
    const bot = this.bot;
    const end = Date.now() + budgetMs;
    let tried = 0, least = null;
    // The search is the bot standing still, up to two seconds and more: with
    // a biter at its reach, behind the shield facing it. mid-242-ah-fortress-
    // 1's retreat stood 2.7 seconds searching with a wither skeleton at arm's
    // length and the shield down, and took two blows and their wither, 9.1
    // to 0.4 (note 601). Lowered again for the run.
    const guarded = await guardFacing(bot);
    try {
      for (const p of candidates) {
        if (Date.now() >= end) break;
        tried++;
        const route = await surveyRoute(bot, task, movements, new goals.GoalBlock(p.x, p.y, p.z), Math.max(20, Math.min(150, end - Date.now())));
        if (route.status !== 'success') continue;
        // Do not run through another hostile to escape the closest one.
        if (route.path.some(point => about.some(e => e.position.distanceTo(pos(point)) < Math.min(4, e.position.distanceTo(bot.entity.position) - 1)))) continue;
        if (heavy && route.path.some(point => besideDrop(bot, pos(point).floored()))) continue;
        const creeper = require('./creeper-run').wayAgainstCreepers(bot, route.path, creepers);
        if (!creeper?.worst.goesOff) return { p, route, tried, ...(creeper ? { creeper } : {}) };
        if (!least || creeper.worst.blast < least.creeper.worst.blast) least = { p, route, creeper };
      }
      return least ? { ...least, tried } : { p: null, tried };
    } finally { if (guarded) lowerShield(bot); }
  }

  // The creepers a run is walked against, and the route search's steer away
  // from them (creeper-run.js), set on the movements for the search and the
  // run alike, so the way run is the way priced.
  creepersOfRun(danger) {
    const { creepersFor } = require('./creeper-run');
    return creepersFor(this.bot, danger, e => creeperLitFor(this.bot, e));
  }
  steerFromCreepers(movements, creepers) {
    const steer = require('./creeper-run').creeperSteer(creepers);
    if (!steer || !movements) return () => {};
    const had = Object.prototype.hasOwnProperty.call(movements, 'exclusionAreasStep'), previous = movements.exclusionAreasStep;
    movements.exclusionAreasStep = [...(previous || []), steer];
    return () => { if (had) movements.exclusionAreasStep = previous; else delete movements.exclusionAreasStep; };
  }

  // The run's way found before the stance is asked, a few route searches at
  // most: the retreat was chosen blind ("no route is checked yet"), and with
  // three or more mobs about, 25 of the 39 chosen with none at arm's length
  // in the midgame trials of 2026-09-25 and 26 found no way and failed. What
  // was found is said on the option, and a way found is the one run.
  async scoutRetreat(task, danger, { budgetMs = SCOUT_MS } = {}) {
    const bot = this.bot;
    // The way out past the game's despawn distance, for wait_far_off (note 665):
    // only with a live blaze spawner within sixteen and a blaze about.
    try {
      const T = require('./blaze-tactics'), blazes = Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false && e.position.distanceTo(bot.entity.position) <= 48);
      const cage = blazes.length && /nether/.test(String(bot.game?.dimension || '')) ? require('./blaze-stand').spawnerAt(bot) : null;
      if (cage && cage.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position) <= 16) await T.scoutFar(bot, task, blazes, cage);
    } catch (err) { task.check?.(); if (['NeedsAir', 'Cancelled'].includes(err?.name)) throw err; }
    const movements = bot.pathfinder?.movements;
    if (!movements || typeof surveyRoute !== 'function') return null;
    const feet = `${feetCell(bot)}`;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    const creepers = this.creepersOfRun(danger), unsteer = this.steerFromCreepers(movements, creepers);
    try {
      const { about, far, near, heavy, radius } = this.escapeFootings(danger);
      const candidates = [...far.slice(0, 12), ...near.slice(0, 12)];
      const way = candidates.length ? await this.wayAway(task, movements, { about, heavy, creepers }, candidates, { budgetMs }) : { p: null, tried: 0 };
      const from = bot.entity.position;
      // With no way that passes every mob, a way past the reach of what
      // bites, the shooters' fire taken on it (reachFootings, note 576).
      let pastReach = null;
      if (!way.p) {
        const found = this.reachFootings(danger);
        const reach = found?.candidates.length ? await this.wayAway(task, movements, { about: found.biters.map(t => t.entity), heavy: found.heavy, creepers }, found.candidates, { budgetMs }) : null;
        if (reach?.p) pastReach = { destination: { x: reach.p.x, y: reach.p.y, z: reach.p.z }, blocks: Math.round(reach.route.path.length || reach.p.distanceTo(from)),
          from: found.biters.map(t => ({ id: t.entity.id, name: t.entity.name, blocks: Math.round(t.entity.position.distanceTo(reach.p)), follows: followRange(t.entity.name) })),
          ...(reach.creeper ? { creeper: reach.creeper } : {}) };
      }
      return this.state.retreatScout = { at: Date.now(), feet, radius, spots: far.length + near.length, tried: way.tried, candidates: candidates.length, ...(pastReach ? { pastReach } : {}),
        ...(way.p ? { destination: { x: way.p.x, y: way.p.y, z: way.p.z }, blocks: Math.round(way.route.path.length || way.p.distanceTo(from)),
          gain: Math.round(Math.min(...about.map(e => e.position.distanceTo(way.p))) - Math.min(...about.map(e => e.position.distanceTo(from)))), ...(way.creeper ? { creeper: way.creeper } : {}) } : {}) };
    } catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return null; }
    finally { Object.assign(movements, previous); unsteer(); }
  }

  async escape(task, goal, save, danger, armed) {
    const bot = this.bot;
    lowerShield(bot);
    this.report(goal, save, { action: 'escape_threat', threats: danger.map(t => ({ name: t.entity.name, distance: t.distance })) });
    // No route away from here a moment ago is no route now: the search is
    // a second of route surveys, and in the replay of trial 57's ledge each
    // one was a second without a swing while a zombie hit.
    const here = feetCell(bot), none = this.state.noRoute;
    if (!(none && Date.now() - none.at < 5000 && here.distanceTo(pos(none)) < 1.5)) {
      if (await this.runAway(task, goal, save, danger)) { delete this.state.noRoute; return; }
      this.state.noRoute = { x: here.x, y: here.y, z: here.z, at: Date.now() };
    }
    const movements = bot.pathfinder.movements;
    const previous = { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, allowSprinting: movements.allowSprinting };
    Object.assign(movements, { canDig: false, allow1by1towers: false, allowSprinting: true });
    try {
      // The cornered rules: no route away was found (or it was cut short).
      const nearest = danger[0];
      // A creeper close is not sealed against: the pocket takes seconds of
      // block after block and the blast comes first. The day audit's cave
      // death began an eighteen-cell pocket with three creepers at four
      // blocks, and one blast took seventeen health. Away from the creepers
      // first, by any footing that puts more room between them and the bot.
      const creepers = creeperClose(danger) ? danger.filter(t => t.entity.name === 'creeper' && t.distance <= 7) : [];
      if (creepers.length && await this.runAway(task, goal, save, creepers, { gain: 2, only: true })) { delete this.state.trappedSince; return; }
      // Cornered with stone in hand: a wall between us and the mob beats a
      // hold. Only the cell one step toward it, and only while that cell is
      // still empty; a mob already in it is fought, not walled.
      // A wall on one side is not cover: a skeleton shot the bot while it
      // hid from a piglin. With a ranged mob in view and no way out, close
      // every open side into a two-block pocket and let it pass. Against a
      // melee mob alone, the single wall toward it is enough.
      // A herd is sealed out like a shooter: one wall toward one hoglin
      // leaves the other four, and the bot held a "defensive position" at
      // five health in the middle of seven of them.
      //
      // Counted at two ranges, because the arena's herd drill died three
      // times out of three: the nearest hoglin was eleven blocks off, so
      // nothing was a crowd, the bot charged it, and met four at three
      // blocks. A pack seen coming is a pack. Seal while there is still
      // time to place the blocks, and never charge into one.
      // A sword-wielder already at arm's length is fought, not walled: the
      // pocket is seconds of standing still placing blocks with no swing,
      // and in the fortress a wither skeleton beside the bot, two blazes
      // behind it, took it from 19 to nothing in five of them (the dream
      // run, 2026-09-24 00:07). The fight rule swings at the top of every
      // tick; here the tick ends so the next one swings again.
      // A shooter at arm's length too: a blaze three blocks off was walled
      // against for twelve seconds of block placing while it shot, where two
      // swings would have ended it (the user, 2026-09-24).
      const melee = danger.find(t => t.entity.name !== 'creeper' && (t.distance <= 3.2 || canStrike(bot, t.entity)));
      if (armed && melee && bot.health >= 6) {
        this.report(goal, save, { action: 'fight', threats: [melee.entity.name], health: bot.health, cornered: true });
        delete this.state.trappedSince; return;
      }
      const crowd = danger.filter(t => t.distance <= 12).length >= 2;
      const pack = danger.filter(t => t.distance <= 16).length >= 2;
      // Tried and measured: charging a pack of shooters killed the bot in the
      // open swarm drill where holding had not. The half-block step toward a
      // hovering shooter that is already in the fight stays; the charge into
      // four of them from eight blocks does not.
      // A pack in the open is met at a door, not in the middle of it. One
      // block into the rock and only one of them can reach at a time; the
      // ordinary fight rule then takes them one by one. The herd drill died
      // two runs in three standing in the room with four hoglins.
      // Held until the pack thins, then given up: four hoglins were waited
      // out for seventy-five seconds without a scratch, which is the right
      // answer, but a hold with no end would be a new way to stall a run.
      if (pack) this.state.bunkerSince ||= Date.now(); else delete this.state.bunkerSince;
      const holding = this.state.bunkerSince && Date.now() - this.state.bunkerSince > 45000;
      const dug = this.state.bunkerDug;
      if (pack && !holding && bot.health >= 10 && nearWall(bot, centroid(danger), { dug }) && require('./bunker').bunkerDigMs(bot, centroid(danger), { dug }) <= BUNKER_DIG_MS) {
        this.report(goal, save, { action: 'dig_in_bunker', threats: danger.map(t => t.entity.name).slice(0, 6), health: bot.health,
          held: Math.round((Date.now() - this.state.bunkerSince) / 1000) });
        try { this.state.bunkerDug = await digBunker(bot, task, goal, save, { from: centroid(danger), navigate: this.actions.navigate, dug }); save(); delete this.state.trappedSince; return; }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      if ((crowd || danger.some(shoots)) && !creepers.length && await this.sealHere(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      // A lone mob that does not shoot is met, not walled: the wall came
      // first, and a wither skeleton standing between the sword's reach
      // and the charge's minimum was walled off every time.
      if (armed && danger.length === 1 && !shoots(nearest) && await this.charge(task, goal, save, nearest, pack)) { delete this.state.trappedSince; return; }
      if (await this.wallOff(task, goal, save, danger)) { delete this.state.trappedSince; return; }
      // No way out and a mob a few blocks off, shooting: standing still is
      // how a crossbow piglin took half the bot's health. Armed and able,
      // close the gap so the fight rule can do its work.
      // One mob is charged; a herd is not.
      if (armed && await this.charge(task, goal, save, nearest, pack)) { delete this.state.trappedSince; return; }
      // In a narrow tunnel, wait for the next bounded defensive action rather
      // than spending five failed route searches while a mob hits us. The
      // encounter still has a deadline and reports a concrete blocker.
      this.state.trappedSince ||= Date.now();
      if (Date.now() - this.state.trappedSince > 30000) {
        const error = new Error('No safe escape after 30 seconds of defending the constrained position'); error.name = 'Blocked'; throw error;
      }
      this.report(goal, save, { action: 'hold_defensive_position', threats: danger.map(t => t.entity.name),
        reason: 'No safe retreat; defend visible hostiles that enter reach' });
      // Held for a second, swinging at whatever comes into reach, bare
      // hands or not: a hold that only waited let trial 57's zombie take
      // twenty health with no swing between its hits.
      await this.swingFor(task, goal, save);
    } finally { Object.assign(movements, previous); bot.clearControlStates(); }
  }

  // Swing after swing at whatever is in reach, for a second, before the
  // next look round: one swing a tick, with a tick's half second of checks
  // between, was a bare-handed bot punching once a second against a zombie
  // hitting once a second (the replay of trial 57's ledge).
  async swingFor(task, goal, save, ms = 1000) {
    const bot = this.bot;
    let swung = false;
    for (const until = Date.now() + ms; Date.now() < until;) {
      task.check(); checkAir(bot);
      // A creeper is hit and backed from (creeperDance), not stood at.
      // Where the dance cannot run (no blade, a drop behind) the chosen
      // fight still swings: handed straight back, trial 99's bare-handed
      // fight with a creeper at arm's length ran twenty times a second and
      // struck nothing.
      const close = threats(bot, 5);
      if (close.some(t => t.entity.name === 'creeper') && await this.creeperDance(task, goal, save, close, swung, { chosen: true })) { swung = false; continue; }
      swung = await defendNearby(bot, task, goal, save);
      if (!swung) await sleep(100);
    }
  }

  // Two blocks straight up, where the head room allows and blocks are
  // carried; true once the feet are clear of what was beneath them.
  // The open sides of a one-wide ledge walled at the feet, each with the
  // floor beside it laid first to place against. True when a block went down.
  // Against a ghast (`blast`), from a block its blast does not break where
  // one is carried: a netherrack wall is blown out by the fireball it stops
  // (ghast.js, note 551).
  async railSpan(task, goal, save, { ahead = null, blast = false } = {}) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const feet = feetCell(bot);
    // The side a span being laid goes on is left open for it.
    const onward = ahead && require('./bridging').stepToward(feet, ahead);
    // The sides a push goes toward first (leeFirst): they were walled in a
    // fixed order, east, west, south, north, and mid-243-ad-nether-3's ghast
    // to the south-east pushed it north-west (note 582).
    // And the sides a push goes toward with the drop beside them, floored
    // or not (wallCells, note 610).
    const open = wallPlan(bot, feet, { onward }).cells;
    const need = wallStock(bot, open).need;
    // A block that holds over air for each floor and for walls while one
    // is carried (against a ghast, one its blast does not break first); a
    // wall on a floor of gravel or sand past those (note 610).
    const holding = () => (blast && require('./ghast').blastProofMaterial(bot, shelter.buildingMaterials, 1)) || shelter.buildingItem(bot)?.name || null;
    const loose = () => bot.inventory.items().find(i => WALL_FALLING.has(i.name) && i.count > 0)?.name || null;
    const stock = wallStock(bot, open);
    let enough = open.length > 0 && stock.enough;
    // Short of blocks that hold for it, planks from the logs carried (note
    // 563): mid-243-ad held on its span under a ghast with three planks and
    // five oak logs, and no wall went up. Before gravel or sand, where the
    // planks make up the whole of it.
    if (open.length && stock.holding < need && typeof this.actions.acquireStep === 'function') {
      const planks = shelter.plankCraft?.(bot);
      if (planks && (stock.holding + planks.available >= need || (!enough && wallStock(bot, open, { extra: planks.available }).enough))) {
        try { await this.actions.acquireStep(bot, task, planks.item, Math.min(countOf(bot, planks.item) + planks.available, countOf(bot, planks.item) + Math.ceil(need / 4) * 4), goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
        enough = wallStock(bot, open).enough;
      }
    }
    if (!open.length || !enough) return false;
    this.report(goal, save, { action: 'rail_span', sides: open.length, health: bot.health });
    let placed = 0;
    // The floors still to lay, each a holding block, kept from the walls.
    let floorsLeft = open.filter(c => bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block').length;
    for (const c of open) {
      for (const p of [c.offset(0, -1, 0), c]) {
        if (bot.blockAt(p)?.boundingBox === 'block') continue;
        task.check();
        const floor = !p.equals(c);
        const held = holding(), spare = held ? countOf(bot, held) : 0;
        const material = floor ? held : (held && spare > floorsLeft ? held : loose() || held);
        if (!material) break;
        // Gravel or sand where no floor stands under it falls (note 610).
        if (!floor && WALL_FALLING.has(material) && bot.blockAt(c.offset(0, -1, 0))?.boundingBox !== 'block') break;
        // Counted only when the block stands: mid-243-l "walled" its span
        // eleven times in four seconds under a ghast, no wall ever standing,
        // and each report ended the turn before the step off or the shield;
        // a fireball threw it into the lava (2026-09-27).
        try { await this.actions.place(bot, task, p, material); if (bot.blockAt(p)?.boundingBox === 'block') { placed++; if (floor) floorsLeft--; } }
        catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; break; }
      }
    }
    return placed > 0;
  }

  async pillarFrom(task, goal, save, danger) {
    const bot = this.bot;
    const feet = feetCell(bot);
    if (onPillarTop(bot, this.state.pillar)) return false;
    const { pillarUp, SCAFFOLD } = require('./pillar-recovery');
    if (bot.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0) < 2) return false;
    if (![1, 2, 3].every(dy => { const b = bot.blockAt(feet.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && !/lava|water/.test(b.name); })) return false;
    this.report(goal, save, { action: 'pillar_from', threats: danger.map(t => t.entity.name), health: bot.health });
    lowerShield(bot);
    let placed = 0;
    try { placed = await pillarUp(bot, task, feet.y + 2, { dig: this.actions.dig, maxBlocks: 2, threats: false }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    if (bot.entity.position.y < feet.y + 1.9) {
      // Why, for the next question: the failure was said bare, and
      // mid-229-r chose the pillar again twice with the zombies still in
      // the cell its block went into (note 526).
      const inCell = inOwnCells(bot, danger, feet);
      const stop = require('./pillar-recovery').climbStop(bot, feetCell(bot));
      this.state.stanceWhy = inCell.length ? `${placed ? `${placed} of 2 blocks went down; ` : 'no block went down: '}${ownCellsSays(inCell).replace(/^./, c => c.toLowerCase())}, where the pillar's block goes` : `${placed} of 2 blocks went down${stop ? `: the climb stops at ${stop}` : ''}`;
      return false;
    }
    this.state.pillar = { x: feet.x, y: feet.y, z: feet.z, at: Date.now() };
    return true;
  }

  // A saved shelter is only useful if there is a way to it. Forty blocks up
  // a shaft at dusk, the surface shelter from last night is not a shelter,
  // and the dream run spent a whole night failing to path to it. One that
  // cannot be reached is set aside for a while so a pocket can be sealed
  // where the bot stands.
  // The ways that are not a room: a pocket here, a shaft, a mine.
  async shelterBy(task, goal, save, method) {
    const bot = this.bot;
    if (method === 'seal_here') return this.sealHere(task, goal, save, threats(bot).filter(t => t.visible));
    if (method === 'shaft_pocket') return this.shaftPocket(task, goal, save);
    if (method === 'night_mine') {
      if (!this.canNightMine(goal)) return false;
      this.state.nightMine ||= { startedAt: Date.now(), origin: { ...feetCell(bot) }, heading: Math.floor(Math.random() * 4), failures: 0, mined: 0 };
      return this.nightMine(task, goal, save);
    }
    return false;
  }

  async reachableRefuge(task, goal, save, refuge) {
    const bot = this.bot;
    if (!refuge || shelter.inside(bot, refuge)) return refuge;
    const status = await this.refugeWay(task, refuge);
    if (status == null || status === 'success') return refuge;
    refuge.avoidUntil = Date.now() + (status === 'timeout' ? 60000 : 600000);
    this.report(goal, save, { action: 'shelter_unreachable', origin: refuge.origin, reason: status });
    return null;
  }

  // Whether the saved shelter can be walked to from here: the route search's
  // status ('success', 'noPath', 'timeout'), or null where there is nothing
  // to walk (in it, within six, no pathfinder). The question that offers the
  // shelter looks (keep) and the walk that follows its answer from the same
  // spot reads that search once, within fifteen seconds. mid-242-a was
  // offered "a sealed shelter" from its pillar's top told only that one stood
  // fifteen blocks off, ready; it had no way there, and finding that out cost
  // the walk's searches under a skeleton's arrows (note 535).
  async refugeWay(task, refuge, { keep = false } = {}) {
    const bot = this.bot;
    if (!refuge || shelter.inside(bot, refuge)) return null;
    const o = pos(refuge.origin);
    if (o.distanceTo(bot.entity.position) <= 6 || !bot.pathfinder?.movements) return null;
    const here = `${feetCell(bot)}`, key = `${o}`;
    const known = (this._refugeWays ||= new Map()).get(key);
    this._refugeWays.delete(key);
    if (!keep && known && known.from === here && Date.now() - known.at < 15000) return known.status;
    const near = new goals.GoalNear(o.x, o.y, o.z, 2);
    let route = await surveyRoute(bot, task, bot.pathfinder.movements, near, 400);
    // A search out of time has not found that there is no way: under load
    // four hundred milliseconds ran out, and mid-231-o's shelter was set
    // aside ten minutes as unreachable at 0.9 health on a "timeout" (note
    // 466). It looks longer once; still out of time, it rests a minute.
    if (route.status === 'timeout') route = await surveyRoute(bot, task, bot.pathfinder.movements, near, 2500);
    if (keep) this._refugeWays.set(key, { from: here, at: Date.now(), status: route.status });
    return route.status;
  }

  // True when it did something toward a shelter; false when there is none
  // to be had here for now (the caller then leaves the tick to the work).
  // How the night is sheltered is Jev's: the saved shelter, a room built at
  // a site, a pocket sealed where the bot stands, a shaft pocket dug down,
  // or a mine. Chosen once and held for the night; a way that fails rests
  // three minutes and the question is asked again. With `method`, the
  // caller has already chosen (the emergency beside a prepared site).
  async refugeStep(task, goal, save, { method: given = null } = {}) {
    const bot = this.bot;
    // No shelter is made under water: a pocket sealed there is full of it.
    // The way up comes first (mid-205-b, 2026-09-26).
    if (require('./vitals').headSubmerged(bot)) throw new (require('./vitals').NeedsAir)();
    if (isSetAside(this, 'refuge', 'anywhere')) return false;
    if (await reachShore(bot, task, goal, save, { move: this.actions.navigate, client: this.client, dig: this.actions.dig })) return true;
    let refuge = await this.reachableRefuge(task, goal, save, this.currentShelter());
    // Last night's pocket beside a flooded cave is not gone back to from
    // outside it: the night mine had nowhere to go there, and the bot waited
    // two nights in it. A dry site is looked for first (shelterSites).
    if (refuge && refuge.kind !== 'house' && !shelter.inside(bot, refuge) && shelter.wetBelow(bot, pos(refuge.origin)) > 0) refuge = null;
    const plan = this.state.nightPlan;
    let method = given || (plan?.method && !isSetAside(this, 'shelter_method', plan.method) ? plan.method : null);
    // A room already begun or chosen goes on without a question.
    if (!method && refuge && shelter.inside(bot, refuge)) method = 'saved_shelter';
    let site = null;
    if (!method || (method === 'build_at_site' && !refuge)) {
      // Beside a lava lake nothing within twelve blocks has a safe shell;
      // look further before giving the night up as unsafe.
      if (!refuge) {
        let sites = shelter.shelterSites(bot, goal);
        if (!sites.length) sites = shelter.shelterSites(bot, goal, 32);
        // Six sites, a little over half a second each: at a hundred and fifty
        // milliseconds every survey from a hollow eleven blocks under the
        // surface timed out, and the dream run retried the whole list for
        // seven attempts at dusk.
        for (const p of sites.slice(0, 6)) {
          if ((await surveyRoute(bot, task, bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 600)).status === 'success') { site = p; break; }
        }
      }
    }
    if (!method) {
      const stock = shelter.materialStock(bot);
      const options = {};
      const resting = key => isSetAside(this, 'shelter_method', key);
      // What each way risks, said (the decision audit, 2026-09-25): the walk
      // to a room with its time against the dark and the mobs about the
      // place, the pocket's race with every mob about, seen or not, and
      // whether a shaft has a dry column to go down at all.
      const about = threats(bot, 64);
      const walkTo = dest => {
        const distance = dest.distanceTo(bot.entity.position), seconds = Math.round(distance / 4.3), tod = bot.time?.timeOfDay ?? 6000;
        const there = about.filter(t => t.entity.position.distanceTo(dest) <= 16);
        const dark = tod >= DAY.DARK && tod < DAY.DAWN ? ' It is dark already: mobs spawn along the way.' : tod + seconds * 20 >= DAY.DARK ? ' It arrives after dark.' : '';
        return ` About ${seconds} seconds at a walk.${dark}${there.length ? ` Within sixteen blocks of it now: ${there.slice(0, 4).map(t => `a ${t.entity.name.replaceAll('_', ' ')}`).join(', ')}${there.some(t => t.entity.name === 'creeper') ? ' (a creeper among them)' : ''}.` : ''}`;
      };
      // And those coming at the bot, against each way's seconds (note 544).
      const toward = comingAt(bot, { list: about.filter(t => t.distance <= 24) });
      const walkRace = (dest, blocks) => comingSays(toward, { seconds: dest.distanceTo(bot.entity.position) / 4.3 + blocks * BLOCK_SECONDS, doing: 'the sealing there', at: dest });
      if (refuge && !resting('saved_shelter')) options.saved_shelter = { description: `Go back to the ${refuge.verifiedAt ? 'shelter used before' : 'shelter begun before'}, ${Math.round(pos(refuge.origin).distanceTo(bot.entity.position))} blocks away, and seal it: ${shelter.missingShell(bot, refuge).length} blocks to place, ${stock} carried.${shelter.inside(bot, refuge) ? comingSays(toward, { seconds: shelter.missingShell(bot, refuge).length * BLOCK_SECONDS, doing: 'the sealing' }) : walkTo(pos(refuge.origin)) + walkRace(pos(refuge.origin), shelter.missingShell(bot, refuge).length)}` };
      if (site && !resting('build_at_site')) { const need = shelter.missingShell(bot, { origin: site }).length;
        options.build_at_site = { description: `Build a small room at a dry site ${Math.round(site.distanceTo(bot.entity.position))} blocks away: ${need} blocks to place, ${stock} carried${stock < need + 4 ? ', the rest gathered first' : ''}. A room is kept and can be used again on later nights.${walkTo(site)}${walkRace(site, need)}` }; }
      const near = about.filter(t => t.distance <= 24);
      if (!resting('seal_here')) options.seal_here = { description: (stock >= 12 ? `Seal a two-block pocket around the bot where it stands with the ${stock} blocks carried; quick, and kept for later nights.` : `Dig into the ground where the bot stands and close it over (${stock} blocks carried, too few for a pocket on open ground).`) + pocketRace(bot, near) + (creeperNoteFor(near) || creeperSays(bot)) };
      if (!resting('shaft_pocket')) {
        const column = this.shaftColumn();
        const found = column.bottom ? ` A dry column is found${column.start.equals(feetCell(bot)) ? ' underfoot' : ` ${Math.round(column.start.distanceTo(bot.entity.position))} blocks over`}: ${column.start.y - column.bottom.y} blocks down.` : ` ${column.none.charAt(0).toUpperCase()}${column.none.slice(1)}; chosen, it fails and the question comes again.`;
        // The creeper's race said here too: mid-211-a chose the shaft pocket
        // at 9.2 health told "done in seconds", a creeper eight blocks off
        // and said only beside the room, and it followed the bot down and
        // went off (2026-09-26).
        // Its seconds, and the mobs coming against them: "done in seconds"
        // was about four of digging to mid-244-a's zombies' four of walking
        // (note 544).
        const dig = column.bottom ? shaftSeconds(bot, column) : null;
        const race = dig ? comingSays(toward, { seconds: dig.seconds, doing: 'the shaft' }) : comingSays(toward);
        const stops = dig && toward.length && toward[0].atBotIn < dig.seconds ? ' A biter within three blocks stops the dig part-way (it would follow the bot down), the shaft left open and the way asked again.' : '';
        options.shaft_pocket = { description: `Dig ${dig ? plural(dig.depth, 'block') : 'two or three blocks'} straight down here and cap it with one block: the fewest blocks${dig ? `, about ${dig.seconds} seconds of digging and the cap` : ''}.` + found + race + stops + creeperSays(bot) };
      }
      // The carried bed, in a nook dug beside the bot: now at bedtime, or in
      // the wall of a pocket sealed here and dug at bedtime. The one bot of
      // the six midgame trials of 2026-09-26 that carried a bed chose
      // seal_here eleven times, and the bed was never on this list.
      if (bedCarried(bot) && bot.game?.dimension === 'overworld' && !sleepWaiting(this) && !resting('bed_nook') && !isSetAside(this, 'bed_nook', 'here')) {
        const now = sleepable(bot);
        const nook = bedNook(bot, goal, now ? {} : { sealed: true, shell: shelter.shell(feetCell(bot)) });
        if (nook) options.bed_nook = { description: now ? `Put the carried bed down here instead of a shelter: ${nookSays(bot, nook)}${creeperSays(bot)}`
          : `Seal a pocket where the bot stands, as seal_here does (${stock} blocks carried), and at bedtime ${nookSays(bot, nook, { pocket: true, later: true })}${pocketRace(bot, near)}${creeperNoteFor(near)}` };
      }
      // Or, with no nook to be had, the carried bed put down beside the
      // pocket at bedtime: planned at dusk, when the night is asked, and not
      // left to a question in the pocket at bedtime (note 429).
      if (!options.bed_nook && !sleepable(bot) && bedCarried(bot) && bot.game?.dimension === 'overworld' && !sleepWaiting(this) && !resting('bed_beside') && !isSetAside(this, 'bed_out', 'here') && options.seal_here) {
        const site = bedSiteNear(bot);
        if (site) options.bed_beside = { description: `Seal a pocket where the bot stands, as seal_here does (${stock} blocks carried), and at bedtime (from ${SLEEP_FROM}, about ${Math.max(0, Math.round((SLEEP_FROM - (bot.time?.timeOfDay ?? 0)) / 20))} seconds off) open it, put the carried bed down on level ground ${Math.round(site.foot.distanceTo(bot.entity.position))} blocks off and sleep: the night passes in seconds instead of about ${minutesToDawn(bot)} real minutes in the pocket, and the bed is picked back up after. Sleep is refused while a monster is within about eight blocks sideways and five up or down of the bed (vanilla), seen or not: ${monstersByBed(bot, site.foot) || 'none'} now; refused, the pocket is there to go back to.${pocketRace(bot, near)}${creeperNoteFor(near)}` };
      }
      if (this.canNightMine(goal) && !resting('night_mine')) options.night_mine = { description: `Dig a mine from here for the night: a staircase into the rock is shelter and a mine at once, and gains ore while the night passes, about ${minutesToDawn(bot)} real minutes of the run to dawn${workWaiting(goal, bot) ? `, with ${workWaiting(goal, bot)} waiting` : ''}. ${rockHolds(bot, feetCell(bot), attemptsFor(this))}` + creeperSays(bot) };
      if (!Object.keys(options).length) {
        // Nowhere, nothing to build with, no ground to dig: failing that every
        // tick was trial 9's loop at minute ten, with no wood yet to make any
        // of it possible (2026-09-24). It rests three minutes and the work
        // goes on, which is what finds the wood.
        setAside(this, 'refuge', 'anywhere', 'no way to shelter here', 180000);
        delete this.state.nightPlan;
        this.report(goal, save, { action: 'no_shelter_here', reason: 'no way to shelter here' });
        return false;
      }
      const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description }]));
      const decision = Object.keys(tree).length === 1 ? { path: [Object.keys(tree)[0]] }
        : await this.decide(task, goal, save, { id: 'shelter_method', tree, state: { timeOfDay: bot.time?.timeOfDay, health: bot.health, food: bot.food, buildingBlocks: stock, darkHere: darkHere(bot), torches: countOf(bot, 'torch'),
          underground: !surfaceObserver(bot)(bot.entity.position), pickaxe: bot.inventory.items().find(i => /_pickaxe$/.test(i.name))?.name || null,
          ...(!options.night_mine && this.nightMineOff() ? { nightMineOff: this.nightMineOff() } : {}),
          nearbyThreats: threats(bot).filter(t => t.distance < 24).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })),
          ...(toward.length ? { comingAtTheBot: comingFacts(toward) } : {}),
          riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal) } });
      if (decision.stale) return true;
      method = decision.path.at(-1);
      this.state.nightPlan = { ...(plan || { plan: 'shelter' }), until: Date.now() + 120000, method };
      save();
    }
    // A way that fails rests, and the question is asked again next pass
    // (true). A way the caller gave (the emergency's saved site) is not the
    // question's: its failure is nothing done, and the caller answers
    // another way (false). Returned true, the emergency took the refusal
    // for its answer every pass (mid-242-ag, note 593).
    const failed = why => { setAside(this, 'shelter_method', method, why, 180000); if (this.state.nightPlan?.method === method) delete this.state.nightPlan.method; save(); return !given; };
    if (['seal_here', 'shaft_pocket', 'night_mine'].includes(method)) return (await this.shelterBy(task, goal, save, method)) || failed(`${method.replaceAll('_', ' ')} did not work here`);
    // The bed nook: slept in now at bedtime; before it, the pocket sealed
    // here, and the nook dug from inside it at bedtime (the pocket's step).
    if (method === 'bed_nook') {
      if (sleepable(bot)) {
        try { await this.nookSleep(task, goal, save); return true; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return failed(`the bed nook: ${err.message}`); }
      }
      this.state.bedNookPlan = { until: Date.now() + 600000 };
      return (await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) || failed('the pocket for the bed nook did not seal here');
    }
    if (method === 'bed_beside') {
      this.state.bedBesidePlan = { until: Date.now() + 600000 };
      return (await this.sealHere(task, goal, save, threats(bot).filter(t => t.visible))) || failed('the pocket for the bed beside did not seal here');
    }
    if (method === 'build_at_site' && !refuge) {
      if (!site) return failed('no dry site within reach');
      refuge = { origin: { ...site }, dimension: bot.game.dimension, createdAt: new Date().toISOString() };
      this.state.shelters.push(refuge); save();
    }
    if (!refuge) return failed('the saved shelter is out of reach');
    const missing = shelter.missingShell(bot, refuge);
    const stock = shelter.materialStock(bot);
    // Navigation can consume scaffold blocks or clear natural walls. Keep a
    // small travel reserve, then recheck the actual shell after entering.
    const required = missing.length + (shelter.inside(bot, refuge) ? 0 : 4);
    if (stock < required) {
      // A site selected above a mining pocket can reserve every block needed
      // to escape it. Reach that still-empty site before searching for supplies;
      // approachRefuge relaxes only this reservation and restores it afterwards.
      // Well below it, not one block: gathering dirt steps the bot into the
      // hole it dug, and read as "below the site" that sent it back up
      // after every block, one dirt a trip, with a creeper closing in.
      if (bot.entity.position.y < refuge.origin.y - 1.5 && emptySite(bot, refuge)) {
        this.report(goal, save, { action: 'return_to_surface', target: refuge.origin });
        const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
        try {
          const o = refuge.origin;
          await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
        } finally { task.interruptCheck = outerCheck; }
        return;
      }
      if (shelter.inside(bot, refuge)) {
        await this.leave(task, goal, save, refuge);
        if (shelter.inside(bot, refuge)) return;
      }
      // Short of blocks: a shaft pocket costs one block where the room costs
      // twenty-eight. Two or three down into dirt or rock and a block over
      // the head, before a trip for blocks (the dream run gathered dirt one
      // block at a time on open grass at night and a creeper found it).
      this.report(goal, save, { action: 'gather_shelter_materials', need: required, carried: stock, origin: refuge.origin });
      const outerCheck = task.interruptCheck; task.interruptCheck = () => checkThreats(bot);
      try {
        const supply = shelter.supplyTarget(bot, required - stock);
        await this.actions.acquireStep(bot, task, supply.item, supply.count, goal, save,
          { minimumMiningY: Math.min(refuge.origin.y, feetCell(bot).y) - 1 });
      } finally { task.interruptCheck = outerCheck; }
      return;
    }
    if (!shelter.inside(bot, refuge)) {
      // Reenter a previously sealed room through a verified two-block exit.
      if (shelter.sealed(bot, refuge)) {
        const exit = shelter.exits(bot, refuge).sort((a, b) => a.outside.distanceTo(bot.entity.position) - b.outside.distanceTo(bot.entity.position))[0];
        if (!exit) throw new Error('The saved shelter has no safe approach');
        await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 20000 });
        await this.actions.dig(bot, task, exit.door.offset(0, 1, 0), { requireDrops: false });
        await this.actions.dig(bot, task, exit.door, { requireDrops: false });
      }
      const o = pos(refuge.origin);
      await this.approachRefuge(task, goal, refuge, new goals.GoalBlock(o.x, o.y, o.z));
    }
    if (shelter.materialStock(bot) < shelter.missingShell(bot, refuge).length) return;
    // A pocket here just given up (a creeper racing it, or the twenty
    // seconds run out) is not begun again for the while it is set aside.
    // Before the report: after it, mid-231-l "sealed" a hundred times a
    // second at 2.5 health beside a zombie and a skeleton (2026-09-27).
    if (isSetAside(this, 'seal_here', `${pos(refuge.origin)}`)) return false;
    this.report(goal, save, { action: 'seal_shelter', origin: refuge.origin });
    const threat = immediateThreat(bot);
    const blocks = shelter.missingShell(bot, refuge).sort((a, b) => {
      // Finish a full-height wall on the threat-facing side first. Roof comes
      // last so every placement has a solid adjacent anchor.
      const rank = p => p.y < refuge.origin.y
        ? -1000 + Math.abs(p.x - refuge.origin.x) + Math.abs(p.z - refuge.origin.z)
        : (p.y === refuge.origin.y + 2 ? 1000 : 0) +
          (threat ? Math.hypot(p.x - threat.entity.position.x, p.z - threat.entity.position.z) * 10 : 0) + p.y - refuge.origin.y;
      return rank(a) - rank(b);
    });
    // Twenty seconds for the pass: trial 75 stood fifty-three seconds in one
    // on a hillside by a flooded shaft, a block now and then, never sealed,
    // and the audit failed it. A pass that runs out ends, and the place is
    // set aside for a minute so the next answer is another one.
    const passEnds = Date.now() + 20000;
    // A cell a mob stands in is left and said, not placed at: the game puts
    // no block where a body is, and mid-226-h's pass began at the skeleton's
    // cell every time, threw, and began there again, forty passes and two
    // blocks while it shot the bot from 17.1 to none (note 520).
    const { occupant, occupiedSays } = require('./work');
    const occupied = [];
    this.state.sealing = { origin: { ...refuge.origin }, at: Date.now() };
    for (const [i, p] of blocks.entries()) {
      task.check(); checkAir(bot);
      const body = occupant(bot, p);
      if (body) { occupied.push(occupiedSays(body, p)); continue; }
      // A creeper that would reach the pocket and go off before the last
      // block: the build stops and the mobs are answered. Checked when the
      // pass began only, mid-226-c went on walling itself in at night for
      // five seconds while one walked up, and one blast took it from twenty
      // (2026-09-26).
      if (creeperRace(bot, blocks.length - i)) {
        // Set aside a moment, or the next tick seals here again and stops
        // again: mid-202-j stopped a hundred times a second, at full health,
        // nothing else answering, until the creeper went off (2026-09-27).
        setAside(this, 'seal_here', `${pos(refuge.origin)}`, 'a creeper coming on would go off before the pocket closed', 10000);
        this.report(goal, save, { action: 'seal_failed', at: { ...refuge.origin }, error: 'a creeper coming on would go off before the pocket closed' }); save();
        return;
      }
      if (Date.now() > passEnds) {
        setAside(this, 'seal_here', `${pos(refuge.origin)}`, 'the pocket took more than twenty seconds to seal', 60000);
        this.report(goal, save, { action: 'seal_failed', at: { ...refuge.origin }, error: 'twenty seconds and not sealed' }); save();
        return;
      }
      const material = shelter.buildingItem(bot)?.name;
      if (!material) throw new Error('Shelter material inventory changed before sealing');
      // Snow/vegetation is being cleared to seal a room, not harvested. A
      // shovel must not become a prerequisite for emergency shelter.
      if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) await this.actions.dig(bot, task, p, { requireDrops: false });
      try { await this.actions.place(bot, task, p, material); bot._sealPlaced = { at: Date.now(), cell: { x: p.x, y: p.y, z: p.z } }; }
      catch (err) {
        task.check();
        // Stepped into between the look and the placing: the same.
        if (/^Placement obstructed: /.test(err.message)) { occupied.push(err.message.replace(/^Placement obstructed: /, '')); continue; }
        // Reaching a placement can spend the selected block as scaffolding.
        // Other shelter blocks may still be available: reobserve the shell
        // and choose from current inventory on the next bounded step.
        if (err.name === 'Blocked' && !bot.inventory.items().some(i => i.name === material && i.count > 0) && shelter.materialStock(bot) > 0) {
          save(); return;
        }
        throw err;
      }
      save();
    }
    // Every other cell done, the mob's left open: the pass ends said, and
    // the pocket here rests a moment, so the mob at it is answered (the
    // stance, told the pocket's state) rather than sealed against again.
    if (occupied.length && !shelter.sealed(bot, refuge)) {
      const why = `${occupied[0]}${occupied.length > 1 ? ` (and ${occupied.length - 1} more cell${occupied.length > 2 ? 's' : ''} so)` : ''}`;
      setAside(this, 'seal_here', `${pos(refuge.origin)}`, why, 10000);
      this.report(goal, save, { action: 'seal_failed', at: { ...refuge.origin }, error: why }); save();
      return false;
    }
    if (!shelter.inside(bot, refuge) || !shelter.sealed(bot, refuge)) throw new Error('Shelter verification failed');
    refuge.verifiedAt = new Date().toISOString();
    this.report(goal, save, { action: 'sheltered', origin: refuge.origin, health: bot.health });
  }

  async approachRefuge(task, goal, refuge, destination) {
    const bot = this.bot, movement = bot.pathfinder?.movements;
    const previous = movement?.exclusionAreasBreak;
    // Selecting a still-empty surface site must not forbid excavating the
    // natural approach beneath it. That reservation used to invalidate the
    // very route which had just selected the site from an underground start.
    // Existing/partial walls and every other construction remain protected.
    if (emptySite(bot, refuge) && movement && bot._constructionProtection) {
      const approaching = { ...goal, survival: { ...this.state, shelters: this.state.shelters.filter(s => s !== refuge) } };
      movement.exclusionAreasBreak = (previous || []).filter(rule => rule !== bot._constructionProtection);
      movement.exclusionAreasBreak.push(block => reservedForConstruction(approaching, block.position) ? 100 : 0);
    }
    try { await this.actions.navigate(bot, task, destination, { timeoutMs: 20000 }); }
    finally { if (movement) movement.exclusionAreasBreak = previous; }
  }

  // Shot at with no way out: build the whole shell where the bot stands and
  // register it as tonight's pocket, so the next loop sees a sealed shelter
  // and waits inside until nothing is watching, instead of digging straight
  // back out into the arrows. The eighth death was exactly that.
  async sealHere(task, goal, save, danger) {
    const bot = this.bot;
    if (shelter.materialStock(bot) < 12) return this.digIn(task, goal, save, danger);
    const origin = feetCell(bot);
    if (isSetAside(this, 'seal_here', `${origin}`)) return false;
    let refuge = this.state.shelters.find(s => s.origin.x === origin.x && s.origin.y === origin.y && s.origin.z === origin.z && s.dimension === bot.game.dimension);
    if (!refuge) { refuge = { origin: { ...origin }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true }; this.state.shelters.push(refuge); save(); }
    // Not with a creeper at arm's length and more of the pocket to build
    // than its fuse allows: about a second and a half from lighting, a block
    // every 0.6 s. mid-79-g began a twenty-block pocket with two creepers
    // close and was blown up from twenty health (2026-09-26); the backing
    // off and the dance are the answers to a creeper that near.
    if (creeperRace(bot, shelter.missingShell(bot, refuge).length)) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: shelter.missingShell(bot, refuge).length });
    const material = () => shelter.buildingItem(bot)?.name;
    // The side over a drop first, then the ways a walker comes in by, the
    // side toward the soonest biter first, as the seal was priced
    // (pocketPlan, note 581).
    const cells = pocketPlan(bot, origin, pocketBiters(bot))?.cells || shelter.missingShell(bot, refuge);
    // Beside a drop the bot does not move to place: what it can reach from
    // where it stands, and nothing else (place's `stay`).
    const stay = dropWithin(bot, origin, 2);
    // Three placements that fail in a row end the pass: trial 53 spent fifty
    // seconds in one, each block of the shell failing slowly and silently.
    let failedInRow = 0;
    const passEnds = Date.now() + 20000;
    // A body in the cell by its hitbox, any mob's, not the feet of the
    // danger: mid-226-h's skeleton at z 262.8 stood in the cell at z 263
    // too (note 520).
    const { occupant } = require('./work');
    this.state.sealing = { origin: { ...origin }, at: Date.now() };
    for (const p of cells) {
      task.check();
      if (Date.now() > passEnds) { this.report(goal, save, { action: 'seal_failed', at: { ...origin }, error: 'twenty seconds and not sealed' }); break; }
      const name = material(); if (!name) break;
      if (occupant(bot, p) || danger.some(t => t.entity.position.floored().equals(p))) continue;
      try { await this.actions.place(bot, task, p, name, { stay }); failedInRow = 0; bot._sealPlaced = { at: Date.now(), cell: { x: p.x, y: p.y, z: p.z } }; }
      catch (err) {
        task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
        this.state.lastSealError = err.message;
        if (++failedInRow >= 3) { this.report(goal, save, { action: 'seal_failed', at: { ...origin }, error: err.message.slice(0, 160) }); break; }
      }
    }
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) { refuge.verifiedAt = new Date().toISOString(); save(); return true; }
    // A pass that closed nothing is not a pocket: saying it was sent the
    // caller straight back here, fourteen times a second, all evening.
    // Nor is one with nothing to close and the bot still not sealed in: trial
    // 38 stood ninety-eight seconds at a shell with no missing cells, told
    // "sealed" twenty times a second, and the audit failed it.
    if (shelter.missingShell(bot, refuge).length >= cells.length) {
      setAside(this, 'seal_here', `${origin}`, cells.length ? `${cells.length} cells of the shell would not take a block` : 'the shell is whole and the bot is not sealed in it', 60000); save();
      return false;
    }
    return true;
  }

  // Straight down to a pocket walled in rock, then one block over the head.
  // The dream run came back from the Nether onto a sand island in the sea
  // at dusk with one netherrack: no site for a shelter, no blocks to build
  // one, and a staircase toward ore ran out under the water every time.
  // Down the column the bot stands on, while every cell dug and every wall
  // beside it is dry, until the two cells it stands in are walled by solid
  // blocks (sand is not: it falls), twelve blocks at most.
  async shaftPocket(task, goal, save) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function' || typeof this.actions.dig !== 'function') return false;
    const column = this.shaftColumn(), spot = column.spot, here = feetCell(bot);
    if (column.resting) return false;
    const { start = null, bottom = null } = column;
    if (!bottom) { setAside(this, 'shaft_pocket', spot, 'no dry rock straight down within four blocks', 600000); return false; }
    return this.digShaft(task, goal, save, { start, bottom, spot, here });
  }

  // The dry column a shaft pocket would go down, found without digging:
  // { start, bottom } or { none: why }. Asked when the shelter question is
  // built too, so the shaft is offered with the depth found or the reason
  // there is none (the decision audit, 2026-09-25).
  shaftColumn({ radius = 4 } = {}) {
    const bot = this.bot;
    // No pickaxe (respawned with nothing, at night, beside the mobs that
    // killed it: the clean run died there a second time gathering dirt for
    // a shelter): the shaft still goes down where every block in it digs by
    // hand in a second, dirt and the like, and the dug dirt is the cap.
    const pick = bot.inventory.items().some(i => /_pickaxe$/.test(i.name));
    const handSoft = b => !!b && (typeof b.digTime === 'function' ? b.digTime(null, false, false, false, [], {}) <= 1000 : /^(dirt|grass_block|podzol|mycelium|coarse_dirt|rooted_dirt|mud|clay|moss_block)$/.test(b.name));
    // Set aside by the column stood on, not for the whole world.
    const spot = `${feetCell(bot).x},${feetCell(bot).z}`;
    if (isSetAside(this, 'shaft_pocket', spot)) return { none: 'a shaft failed on this spot a short while ago', resting: true, spot };
    const wet = c => /water|lava/.test(bot.blockAt(c)?.name || '');
    const sides = c => [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)].map(d => c.plus(d));
    // The shelter's own test, but for the one cell over the head, which the
    // shaft opens and the cap closes.
    const walled = feet => shelter.missingShell(bot, { origin: feet }).every(p => p.equals(feet.offset(0, 2, 0)));
    // Look before digging: the whole column must be dry, or none of it is
    // dug. The bottom of the first column that works, or null.
    const columnBottom = top => {
      const first = top.offset(0, -1, 0);
      if (!bot.blockAt(first) || bot.blockAt(first).boundingBox !== 'block' || wet(first) || sides(first).some(wet)) return null;
      if (!pick && !handSoft(bot.blockAt(first))) return null;
      for (let depth = 2; depth <= 12; depth++) {
        const cell = top.offset(0, -depth, 0);
        const b = bot.blockAt(cell), under = bot.blockAt(cell.offset(0, -1, 0));
        if (!b || !under || b.name === 'bedrock' || wet(cell) || wet(cell.offset(0, -1, 0)) || /lava|magma/.test(under.name)) return null;
        if (!pick && b.boundingBox === 'block' && !handSoft(b)) return null;
        if (sides(cell).some(wet) || sides(cell.offset(0, 1, 0)).some(wet)) return null;
        if (walled(cell)) return cell;
      }
      return null;
    };
    // The column underfoot, or the nearest one within four blocks on the
    // same ground: on the island's edge the first block down had the sea
    // beside it, and the middle of the island did not.
    const here = feetCell(bot);
    const columns = [here];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) if (dx || dz) columns.push(here.offset(dx, 0, dz));
    columns.sort((a, b) => a.distanceTo(here) - b.distanceTo(here));
    for (const top of columns) {
      if (!shelter.replaceable(bot.blockAt(top)) || !shelter.replaceable(bot.blockAt(top.offset(0, 1, 0)))) continue;
      const found = columnBottom(top);
      if (found) return { start: top, bottom: found, spot };
    }
    return { none: `no dry column here: every one within four blocks meets water, lava or bedrock${pick ? '' : ', or rock too hard to dig by hand,'} before it is walled in, twelve blocks down at most`, spot };
  }

  async digShaft(task, goal, save, { start, bottom, spot, here, stance = false }) {
    const bot = this.bot;
    if (!start.equals(here)) {
      try { await this.actions.navigate(bot, task, new goals.GoalBlock(start.x, start.y, start.z), { timeoutMs: 8000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      if (!feetCell(bot).equals(start)) { setAside(this, 'shaft_pocket', spot, 'could not stand on the dry column', 120000); return false; }
    }
    // A creeper that reaches the open shaft before the cap follows the bot
    // into it: counted as the seal counts it, before every block (note 226).
    // mid-231-g dug down with one eight blocks off; it came down on top of
    // the bot five blocks down and went off, twelve health to none
    // (2026-09-27).
    // Priced as the dig it is: each block's dig with the tool it takes and
    // the drop into its cell, and the cap, not as blocks placed.
    const digSecs = c => { const b = bot.blockAt(c); if (!b || b.boundingBox !== 'block') return 0; if (typeof b.digTime !== 'function') return 1.3; const tool = require('./skills').cheapestTool(bot, b); return b.digTime(tool?.type ?? null, false, false, false, [], {}) / 1000 + 0.3; };
    const racing = y => { let secs = BLOCK_SECONDS; for (let yy = y; yy >= bottom.y; yy--) secs += digSecs(new Vec3(start.x, yy, start.z)); return creeperRace(bot, secs / BLOCK_SECONDS); };
    // Nor with a biter at arm's length: it follows the bot down the open
    // shaft. mid-229-e dug on for ten seconds with two zombies in the shaft
    // with it, a hit a second, eighteen health to five (2026-09-27).
    const biting = () => threats(bot, 4).some(t => t.distance <= 3 && !shooter(t.entity) && t.entity.name !== 'creeper');
    const raced = (why = 'a creeper would reach the open shaft before the cap') => { setAside(this, 'shaft_pocket', spot, why, 30000); save(); return false; };
    // Nor, as the night's shelter, with a shooter in sight and in range: it
    // shoots down the open shaft for the seconds of the dig. mid-218-j's
    // retreat found no way, the night's held shaft went down beside a witch
    // five blocks off, and its potions came in for twelve seconds, twenty
    // health to none (2026-09-27). As a stance it is Jev's, chosen with the
    // shots of the dig counted (dig_down); here the encounter goes back to it.
    const { RANGE } = require('./combat-estimate');
    const shotAt = () => stance ? null : threats(bot, 40).find(t => t.visible && shooter(t.entity) && t.distance <= (RANGE[t.entity.name] || 15));
    const shooting = () => { const t = shotAt(); return t && raced(`a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off, in sight, shoots down the open shaft`); };
    if (biting()) return raced('a mob at arm\'s length would follow the bot down the open shaft');
    if (shotAt()) return shooting();
    if (racing(start.y - 1)) return raced();
    // The bot stays over its shaft: an arrow's knockback on the surface put
    // mid-229-s half a block off the column as its first block came out,
    // and the dig went on beside it, two blocks down a hole it never
    // dropped into, for five seconds under a skeleton's arrows until a
    // zombie came (the saved world read, note 532). Knocked off, it steps
    // back over the opening, as a player does, and drops in.
    // Near its middle, not on its rim: a body three tenths of a block
    // either side of its center stands on the ground beside until it is.
    const offMiddle = () => Math.hypot(bot.entity.position.x - (start.x + 0.5), bot.entity.position.z - (start.z + 0.5));
    const onColumn = () => Math.floor(bot.entity.position.x) === start.x && Math.floor(bot.entity.position.z) === start.z;
    const backOn = async () => {
      if (onColumn() && offMiddle() <= 0.25) return true;
      if (offMiddle() > 2) return false;
      const over = new Vec3(start.x + 0.5, bot.entity.position.y, start.z + 0.5);
      await move(bot, task, { label: 'back_over_shaft', keys: ['forward'], sneak: false, why: 'knocked off the shaft it is digging, back over its opening', look: over, maxMs: 800, until: () => offMiddle() <= 0.25 });
      return onColumn();
    };
    const offColumn = () => { this.state.stanceWhy = 'knocked off the shaft\'s column and could not step back over it'; setAside(this, 'shaft_pocket', spot, this.state.stanceWhy, 30000); save(); return false; };
    this.report(goal, save, { action: 'shaft_pocket', from: { ...start }, to: { ...bottom } });
    for (let y = start.y - 1; y >= bottom.y; y--) {
      task.check(); checkAir(bot);
      if (racing(y)) return raced();
      if (biting()) return raced('a mob at arm\'s length would follow the bot down the open shaft');
      if (shotAt()) return shooting();
      if (!await backOn()) return offColumn();
      const c = new Vec3(start.x, y, start.z);
      if (bot.blockAt(c)?.boundingBox === 'block') await this.actions.dig(bot, task, c, { requireDrops: false, dropInto: true });
      if (!await backOn()) return offColumn();
      for (let i = 0; i < 20 && bot.entity.position.y > y + 0.1; i++) { task.check(); await sleep(50); }
    }
    if (!await backOn()) return offColumn();
    // One block over the head: whatever solid block the pockets hold now,
    // cobblestone from the dig among them. Sand or gravel would fall on it.
    const roof = bottom.offset(0, 2, 0);
    const cap = shelter.buildingItem(bot);
    if (!cap) { setAside(this, 'shaft_pocket', spot, 'nothing solid to close the shaft with', 600000); return false; }
    if (!shelter.solid(bot.blockAt(roof))) {
      try { await this.actions.place(bot, task, roof, cap.name); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (!shelter.solid(bot.blockAt(roof))) { setAside(this, 'shaft_pocket', spot, 'the cap would not go on', 600000); return false; }
    const refuge = { origin: { ...bottom }, dimension: bot.game.dimension, createdAt: new Date().toISOString(), emergency: true, shaft: true, top: { ...start } };
    if (shelter.inside(bot, refuge) && shelter.sealed(bot, refuge)) refuge.verifiedAt = new Date().toISOString();
    this.state.shelters.push(refuge); save();
    return true;
  }

  // The ladder's next item, when it can be made from the pockets by smelting
  // and crafting alone.
  benchWork(goal) {
    if (typeof this.actions.planFor !== 'function' || typeof this.actions.acquireStep !== 'function') return null;
    let stage;
    try { stage = require('./game-progress').nextGameStage(this.bot, goal); } catch (_) { return null; }
    if (!stage || !['acquire', 'acquire_set'].includes(stage.action)) return null;
    const items = stage.items || (stage.item ? [stage.item] : []);
    for (const item of items) {
      const count = stage.action === 'acquire_set' ? 1 : (stage.count || 1);
      let plan;
      try { plan = this.actions.planFor(this.bot, item, count, goal); } catch (_) { continue; }
      if (plan?.length && plan.every(st => st.action === 'smelt' || st.action === 'craft')) return { item, count, plan };
    }
    return null;
  }

  // Chosen by Jev, the creeper, health and the other mobs about were its to
  // weigh; reach, a blade and digging are what make it possible.
  async openOnWatcher(task, goal, save, refuge, watcher, { chosen = false } = {}) {
    const bot = this.bot;
    if (watcher.distance > 4.5 || typeof this.actions.dig !== 'function') return false;
    if (!/_(sword|axe)$/.test(defenseWeapon(bot)?.name || '')) return false;
    if (!chosen && (watcher.entity.name === 'creeper' || (bot.health ?? 20) < 16 || threats(bot, 16).filter(t => t.entity !== watcher.entity).length > 1)) return false;
    const feet = feetCell(bot), at = watcher.entity.position;
    const dx = at.x - (feet.x + 0.5), dz = at.z - (feet.z + 0.5);
    const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
    const cells = [feet.plus(step).offset(0, 1, 0), feet.plus(step)].filter(c => bot.blockAt(c)?.boundingBox === 'block' && bot.blockAt(c).diggable);
    if (!cells.length) return false;
    this.report(goal, save, { action: 'open_on_watcher', target: watcher.entity.name, distance: Number(watcher.distance.toFixed(1)), health: bot.health });
    for (const c of cells) {
      try { await this.actions.dig(bot, task, c, { requireDrops: false }); }
      catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
    }
    return true;
  }

  async digIn(task, goal, save, danger) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = shelter.buildingItem(bot, 4)?.name;
    if (!material) return false;
    const feet = feetCell(bot);
    const cells = [];
    for (const d of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) for (const dy of [0, 1]) {
      const p = feet.plus(d).offset(0, dy, 0);
      if (shelter.replaceable(bot.blockAt(p)) && !danger.some(t => t.entity.position.floored().equals(p))) cells.push(p);
    }
    if (shelter.replaceable(bot.blockAt(feet.offset(0, 2, 0)))) cells.push(feet.offset(0, 2, 0));
    if (!cells.length || creeperRace(bot, cells.length)) return false;
    this.report(goal, save, { action: 'dig_in', threats: danger.map(t => t.entity.name), cells: cells.length });
    let placed = 0;
    const stay = dropWithin(bot, feet, 2);
    for (const p of cells) {
      task.check();
      try { await this.actions.place(bot, task, p, material, { stay }); placed++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err; }
    }
    return placed > 0;
  }

  // One mob, closed on so the fight rule can swing. Out of the sword's reach
  // is the test, not "beyond 3.2": between the two the bot neither swung
  // nor charged.
  // Chosen by Jev (the fight stance), health and the pack were its to weigh.
  async charge(task, goal, save, nearest, pack, { chosen = false } = {}) {
    const bot = this.bot;
    if ((!chosen && (pack || bot.health < 12)) || nearest.distance > 8 || canStrike(bot, nearest.entity) || lavaBeside(bot, nearest.entity.position.floored())) return false;
    // Never at a creeper: a run at one ends beside it as its fuse lights,
    // and a creeper is struck where it comes (the dance). mid-242-e's fight,
    // held, ran at the nearest mob, a creeper eight blocks off, twice: twenty
    // to one, and then from seven to dead (2026-09-27).
    if (nearest.entity.name === 'creeper') return false;
    // Level ground only, and not from an edge: charging a wither skeleton
    // four blocks up a Nether fortress, the dream run's floor went from
    // under it and it fell thirty blocks (2026-09-24 01:39). The charge
    // neither digs, towers nor drops more than two on its way.
    const feet = feetCell(bot), t = nearest.entity.position;
    if (Math.abs(t.y - bot.entity.position.y) > 2 || besideDrop(bot, feet)) return false;
    this.report(goal, save, { action: 'charge', target: nearest.entity.name, distance: Number(nearest.distance.toFixed(1)) });
    const movements = bot.pathfinder?.movements;
    const kept = movements && { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers, maxDropDown: movements.maxDropDown };
    if (movements) Object.assign(movements, { canDig: false, allow1by1towers: false, maxDropDown: Math.min(2, movements.maxDropDown ?? 2) });
    const from = bot.entity.position.clone();
    let failed = false;
    // After the mob where it is now, and done the moment the sword reaches
    // it: the swing comes next. A route to the spot the mob started from,
    // ended only there or on a stall, ran four seconds in both of note 550's
    // wither skeleton deaths with the skeleton walked in to 0.9 to 1.8
    // blocks, and it landed three hits, 20 to 6.6, before the first swing.
    const mob = nearest.entity;
    try { await this.actions.navigate(bot, task, new goals.GoalFollow(mob, 1), { timeoutMs: 4000, stallMs: 2000, stopWhen: () => mob.isValid === false || canStrike(bot, mob) }); }
    catch (err) { task.check(); if (err.name === 'NeedsAir') throw err; failed = true; }
    finally { if (movements) Object.assign(movements, kept); }
    // A charge that went nowhere is not a charge: trial 66 "went for" a
    // zombie in a mineshaft twenty times a second for two and a half
    // minutes, the way to it failing at once each time, neither of them
    // able to reach the other. The mob is out of reach for twenty seconds
    // (danger.js), and the caller takes its next answer.
    // How the run went, said with the next question: mid-230-b ran at a
    // witch three times, each run ending as far off as it began, and was
    // offered the fight each time priced as if the witch stood still to be
    // struck; its potions took twenty health (2026-09-26).
    const after = nearest.entity.position?.distanceTo?.(bot.entity.position);
    if (Number.isFinite(after)) (bot._charges ||= {})[nearest.entity.id] = { at: Date.now(), from: nearest.distance, to: after, name: nearest.entity.name };
    if (failed && bot.entity.position.distanceTo(from) < 1 && !canStrike(bot, nearest.entity)) {
      bot._unreachable = { ids: [...new Set([...(bot._unreachable?.until > Date.now() ? bot._unreachable.ids : []), nearest.entity.id])], until: Date.now() + 20000 };
      return false;
    }
    await defendNearby(bot, task, goal, save);
    return true;
  }

  // A walker standing below the bot's ground, struck from the edge above it
  // (strike-below.js, note 596): offered for the nearest walker within six
  // blocks, not a creeper, whose top is at or below the feet of a stand on
  // the bot's own level within two steps from which the sword reaches it.
  // Said with the game's rule (its blow reaches sideways, not up), the step,
  // the swings, whether it has a way up, what it drops, and the price with
  // every other mob still reaching. Run: the step, crouched at the edge, and
  // the swings while it is in reach and below; failed, with why, when no
  // swing could be made.
  strikeBelowOption(task, goal, save, { danger, apart, mobs, shielded, cost }) {
    const bot = this.bot;
    const { WALKERS } = require('./walk-reach');
    const { strikeStand, belowReach } = require('./strike-below');
    const weapon = defenseWeapon(bot);
    if (inWater(bot) || !bot.entity?.onGround) return null;
    let target = null, stand = null;
    for (const t of danger) {
      if (t.distance > 6 || !t.entity?.position || shooter(t.entity) || t.entity.name === 'creeper' || !WALKERS.has(t.entity.name)) continue;
      stand = strikeStand(bot, t.entity);
      if (stand) { target = t; break; }
    }
    if (!target) return null;
    const e = target.entity, name = e.name.replaceAll('_', ' ');
    const m = mobs.find(x => x.id === e.id) || mobs.find(x => x.name === e.name);
    const r1 = v => Math.round(v * 10) / 10;
    const weaponSays = weapon ? `the ${weapon.name.replaceAll('_', ' ')}` : 'bare hands';
    const step = stand.steps ? `Step ${stand.steps} block${stand.steps === 1 ? '' : 's'} along this ground to (${stand.cell.x}, ${stand.cell.y}, ${stand.cell.z}), crouched, and from there strike` : 'Strike';
    const rule = ` It stands ${stand.below} blocks below that ground, its top ${stand.clearance ? `${stand.clearance} under` : 'level with'} the bot's feet there: a mob's blow reaches out from its body sideways and not up (the game's rule), so while it stands down there it cannot strike the bot, and the sword reaches it from there (within three blocks of the eye, a clear line).`;
    const kill = m?.swingsToKill ? ` To kill: about ${m.swingsToKill} swing${m.swingsToKill === 1 ? '' : 's'} that land${m.secondsToKill ? `, about ${m.secondsToKill} seconds` : ''}.` : '';
    const knock = ['hoglin', 'zoglin'].includes(e.name) ? ` A sword's knockback barely moves a ${name} (it resists knockback): struck, it turns on the bot and stays below, still out of its own reach.` : ' Each swing knocks it back about a block: it comes back under the edge to be struck again, or walks out of the sword\'s reach, and the swings go on only while it is in reach and below.';
    // Its way up, from walk-reach: none within its bounds, one round past
    // them, or one it can walk.
    const round = (apart?.round || []).find(x => x.t.entity.id === e.id);
    const way = apart?.ids?.has(e.id)
      ? (round ? ` Any way up to the bot it has goes round, ${round.atLeast} blocks of walking or more, if there is one at all.` : ` It has no way up to the bot: no ground it can walk, step up or drop along within ${apart.radius} blocks comes within its reach of the bot.`)
      : ' It has a way up to the bot by walking (the search finds ground that leads there): taking it, it is at the bot as in the fight here.';
    const { MOB_DROPS } = require('./mob-drops');
    const drops = MOB_DROPS[e.name];
    const noFood = require('./healing').foodCarried(bot).length === 0;
    const food = drops ? ` Killed, it drops ${drops.drops} on its floor ${Math.round(stand.below)} blocks below, fetched by going down there${drops.for && /^food/.test(drops.for) ? ` (${drops.for})` : ''}${noFood && /^food/.test(drops.for || '') ? '; nothing to eat is carried now' : ''}.` : '';
    // Priced with this one out of the figures: the rest reach as they do.
    const others = mobs.map(x => x === m ? { ...x, apart: true } : x);
    const stepSeconds = stand.steps ? Math.max(1, Math.round(stand.steps / 2)) : 0;
    const price = stanceCost({ mobs: others, setup: stepSeconds, fight: { lead: true }, shield: shielded, health: bot.health });
    const othersSay = others.some(x => !x.apart && !x.far) ? costSays(price, bot.health, others, { doing: stand.steps ? 'stepping there' : null, done: 'At the edge' }) : ` Nothing else here reaches the bot meanwhile: about ${price.damage} damage in the next fifteen seconds this way, from ${r1(bot.health)} health.`;
    const seconds = Math.max(4, Math.min(15, Math.round((m?.secondsToKill || 6) + stepSeconds + 1)));
    return { expects: { damage: price.damage, seconds, oneHit: 0 }, target: e.id,
      description: `${step} down at the ${name} ${r1(target.distance)} blocks off with ${weaponSays}.${rule}${kill}${knock}${way}${food}${othersSay}`,
      run: async () => {
        this.report(goal, save, { action: 'strike_from_above', target: e.name, to: { ...stand.cell }, health: bot.health, stance: true });
        const feet = feetCell(bot);
        if (!feet.equals(stand.cell)) {
          const movements = bot.pathfinder?.movements, kept = movements && { allow1by1towers: movements.allow1by1towers, canDig: movements.canDig, maxDropDown: movements.maxDropDown };
          if (movements) Object.assign(movements, { allow1by1towers: false, canDig: false, maxDropDown: 0 });
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(stand.cell.x, stand.cell.y, stand.cell.z), { timeoutMs: 4000, stallMs: 1500 }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { if (movements) Object.assign(movements, kept); }
          const at = feetCell(bot);
          if (!at.equals(stand.cell)) throw Object.assign(new Error(`the step to (${stand.cell.x}, ${stand.cell.y}, ${stand.cell.z}) above the ${name} ended at (${at.x}, ${at.y}, ${at.z})`), { name: 'StanceFailed' });
        }
        // Crouched at the edge: a player crouched does not walk off it.
        bot.setControlState?.('sneak', true);
        let swings = 0;
        try {
          const until = Date.now() + 1500;
          while (Date.now() < until) {
            task.check(); checkAir(bot);
            if (bot.entities?.[e.id] !== e || e.isValid === false) break;
            if (!belowReach(e, bot.entity.position.y) || !canStrike(bot, e)) break;
            const { SWING_MS } = require('./combat-estimate');
            const kind = weapon?.name.split('_').at(-1);
            const wait = (SWING_MS[kind] || SWING_MS.fist) - (Date.now() - (bot._defenseAttackAt || 0));
            if (wait > 0) { await sleep(Math.min(wait, 100)); continue; }
            lowerShield(bot);
            if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
            await bot.lookAt?.(e.position.offset(0, (e.height || bodyHeight(e.name)) * 0.8, 0), true);
            bot.attack(e); swings++;
            bot._defenseAttackAt = bot._threatResponseAt = Date.now();
            bot._struck = { id: e.id, at: bot._defenseAttackAt };
          }
        } finally { bot.setControlState?.('sneak', false); }
        if (swings) return true;
        if (bot.entities?.[e.id] !== e || e.isValid === false) return true;
        throw Object.assign(new Error(`no swing could be made at the ${name}: ${belowReach(e, bot.entity.position.y) ? 'the sword does not reach it from where the bot stands' : 'it is no longer below the bot\'s feet'}`), { name: 'StanceFailed' });
      } };
  }

  // The shield up facing a biter and the sword swung between its blows
  // (wither-guard.js guard, note 601): offered where a shield is carried and
  // a biter that can get to the bot (not a creeper, a shooter or a spear
  // holder) is in sight or within five, within sixteen. Priced with the one
  // faced blocking into the shield and the rest as the fight meets them;
  // said with the game's rules and what the arena measured.
  shieldGuardOption(task, goal, save, { coming, mobs, shielded, oneHit }) {
    const bot = this.bot;
    const wg = require('./wither-guard');
    const carried = shielded || bot.inventory.items().some(i => i.name === 'shield');
    if (!carried || inWater(bot)) return null;
    const biters = coming.filter(t => t.distance <= 16 && wg.inGuard(t));
    if (!biters.length) return null;
    const faced = biters[0], e = faced.entity, name = e.name.replaceAll('_', ' ');
    const fm = mobs.find(m => m.id === e.id) || mobs.find(m => m.name === e.name && !m.apart);
    // The one faced blocks into the shield: nothing, and no wither. The rest
    // as the fight meets them, the first of them closed on.
    // The shield faces the one faced: a shooter more than sixty degrees off
    // that way lands as if it were down, and its fire with it.
    // mid-242-ba-nether-2 stood in this stance facing a wither skeleton four
    // off while blazes five to nine off on its other side set it alight,
    // 7.1 to none (2026-09-28 14:09:52, note 606).
    const { SHIELD_COVER } = require('./blaze-stand');
    const bearing = p => Math.atan2(p.z - bot.entity.position.z, p.x - bot.entity.position.x) * 180 / Math.PI;
    const off = p => { const d = Math.abs(((bearing(p) - bearing(e.position)) % 360 + 540) % 360 - 180); return d; };
    const flanking = mobs.filter(m => m.shoots && bot.entities?.[m.id]?.position && off(bot.entities[m.id].position) > SHIELD_COVER);
    const others = mobs.map(m => (m === fm ? { ...m, apart: true } : flanking.includes(m) ? { ...m, unshielded: true } : m));
    const rest = others.filter(m => !m.apart && !m.far && m.name !== 'creeper');
    const price = stanceCost({ mobs: others, ...(rest.length ? { fight: { lead: true } } : {}), shield: true, health: bot.health });
    const weapon = defenseWeapon(bot);
    const r1 = v => Math.round(v * 10) / 10;
    const swings = fm?.swingsToKill;
    const every = ce_blowEvery(e.name);
    const kill = swings ? ` To kill: about ${swings} swing${swings === 1 ? '' : 's'} that land, one after each of its blows or as it comes in, about ${Math.max(1, Math.round(swings * every))} seconds once it is at reach.` : '';
    const wither = fm?.withers ? ' A wither skeleton\'s wither comes only with a blow that hurts: a blow the shield takes gives none.' : '';
    const crowd = rest.filter(m => !m.shoots).length;
    const kinds = [...new Set(flanking.map(m => m.name.replaceAll('_', ' ')))];
    const sideFire = flanking.length ? ` The shield faces the ${name}: ${flanking.length === 1 ? `the ${kinds[0]}` : `${flanking.length} ${kinds.length === 1 ? `${kinds[0]}s` : 'shooters'}`} here ${flanking.length === 1 ? 'is' : 'are'} more than ${SHIELD_COVER} degrees off that way, so ${flanking.length === 1 ? 'its shots land' : 'their shots land'} as if it were down${kinds.includes('blaze') ? ', each fireball with five seconds alight' : ''}, counted below.` : '';
    const flank = sideFire + (crowd ? ` The shield faces one way: a blow from the side or behind is not blocked, so with ${crowd === 1 ? 'another biter' : `${crowd} other biters`} here the swing waits until each at its reach has just struck, and their blows are counted below as in the fight.` : '');
    const faceSays = biters.length > 1 ? `the nearest of the ${biters.length} that bite (the ${name} ${Math.round(faced.distance)} blocks off)` : `the ${name} ${Math.round(faced.distance)} blocks off`;
    return { expects: { damage: price.damage, seconds: 15, oneHit },
      description: `Face ${faceSays} with the shield raised${shielded ? '' : ' (taken to the off hand first)'} and let it come; strike it with ${weapon ? `the ${weapon.name.replaceAll('_', ' ')}` : 'bare hands'} right after each of its blows lands on the shield, or while it is within the sword's reach (three blocks from the eye) and out of its own (about a block and a half), and raise the shield again at once; a raised shield blocks only after a quarter second, so a blow landing in that moment lands whole. The shield stays up while this is asked again. Nothing is walked to or charged, and there is no jump for a critical. From the game's own rules: a blow the shield takes whole does no harm, it comes about once a second at its reach with a swing of the arm the bot sees, a sword does not disable a shield, and a blocked blow knocks the mob back half a block.${wither}${kill}${flank}${e.name === 'wither_skeleton' ? wg.measuredSays('guard', biters.filter(t => t.entity.name === e.name).length, { also: ['fight'] }) : ''}${wg.recordSays(e.name)}` + costSays(price, bot.health, others),
      run: async () => {
        this.report(goal, save, { action: 'shield_guard', target: e.name, threats: biters.map(t => t.entity.name), health: bot.health, stance: true });
        if (!shielded) { const s = bot.inventory.items().find(i => i.name === 'shield'); if (s) await bot.equip(s, 'off-hand'); }
        const start = bot.health;
        // Asked again once health has fallen by six, as every stance is.
        const r = await wg.guard(bot, task, { until: Date.now() + 15000, focus: e.id, radius: 16, stop: () => bot.health <= start - 6 });
        this.state.stanceWhy = `the guard ${r.ended === 'none left' ? 'ended with no biter left about' : `ran ${r.swings} swing${r.swings === 1 ? '' : 's'}`}, ${r.hurt ? `${r.hurt} health lost` : 'no health lost'}`;
        return true;
      } };
  }

  // Under a ceiling two high, which a walker taller than two blocks cannot
  // come under (wither-guard.js lowCeilingPlan, walk-reach by its height,
  // note 601): offered where such a walker can get to the bot, within
  // sixteen, and the ceiling can be put in over the bot and round it with
  // the blocks carried, or a hole two in and two high dug into the rock
  // beside it. Priced: the seconds of building or digging with what gets
  // there hitting, then the tall ones out of reach and the rest fought as
  // they come; said with the rules and what the arena measured.
  lowCeilingOption(task, goal, save, { coming, mobs, shielded, oneHit }) {
    const bot = this.bot;
    const wg = require('./wither-guard');
    if (inWater(bot) || !bot.entity?.onGround) return null;
    const tall = coming.filter(t => wg.tallWalker(t) && t.distance <= 16);
    if (!tall.length) return null;
    const plan = wg.lowCeilingPlan(bot, tall, { blockSeconds: BLOCK_SECONDS });
    if (!plan) return null;
    // A race, as the pocket's is: one at the bot before the cells round it
    // are in stands where a block goes, the block does not go in, and it is
    // fought there. The arena's corner, the ceiling's blocks put in the
    // order they came, lost two runs in five that way (note 601).
    const { arrives: arrivesAt } = require('./combat-estimate');
    const first = mobs.filter(m => plan.tall.includes(m.id) && arrivesAt(m) < plan.shutAt);
    const tallIds = new Set(plan.tall.filter(id => !first.some(m => m.id === id)));
    const price = stanceCost({ mobs, setup: plan.seconds, fight: { only: m => !tallIds.has(m.id), lead: true }, reaches: m => m.shoots, shield: shielded, health: bot.health });
    const raceSays = first.length ? ` The ${first[0].name.replaceAll('_', ' ')} ${Math.round(first[0].distance)} blocks off can be at the bot in about ${Math.round(arrivesAt(first[0]) * 10) / 10} seconds at its own speed, before the ${plan.kind === 'roof' ? 'blocks over the cells round the bot are in' : 'hole is dug'} (${plan.shutAt} seconds): one there first stands where a block goes or at the mouth, the ${plan.kind === 'roof' ? 'block does not go in (the game puts none where a body is)' : 'bot is struck while it digs'}, and it is fought there as in the fight, priced so.` : ` The ${plan.kind === 'roof' ? 'blocks over the cells round the bot go in first, those toward it first' : 'hole is dug'}: in after about ${plan.shutAt} seconds, before it can be at the bot.`;
    const names = [...new Set(tall.map(t => t.entity.name))];
    const who = names.map(n => `a ${n.replaceAll('_', ' ')} is ${bodyHeight(n)} blocks tall`).join(' and ');
    const compass = ([dx, dz]) => dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north';
    const { digsWith } = require('./bunker');
    const rock = plan.dug.length ? (bot.blockAt(plan.dug[0])?.name || 'rock').replaceAll('_', ' ') : '';
    const setup = plan.kind === 'roof' && !plan.blocks
      ? `${plan.steps ? 'Step one block along this level, under' : 'Stay under'} the ceiling two up over the bot and the cells round it, and fight from under it`
      : plan.kind === 'roof'
      ? `${plan.steps ? 'Step one block along this level, then put' : 'Put'} ${plan.blocks} block${plan.blocks === 1 ? '' : 's'} of ${plan.material.replaceAll('_', ' ')} in two up over the bot and over each cell round it that is open there (about ${plan.seconds} seconds of placing, the shield down meanwhile), and fight from under that ceiling`
      : `Dig a hole two in and two high into the ${rock} to the ${compass(plan.dir)} (4 blocks ${digsWith(bot, bot.blockAt(plan.dug[0]))}, about ${plan.seconds} seconds of digging, the shield down meanwhile), step to its end and fight from there`;
    const others = mobs.filter(m => !plan.tall.includes(m.id) && !m.apart && !m.far && !m.shoots && m.name !== 'creeper');
    const shortSays = others.length ? ` The others that bite are shorter and come under it: fought there as they come.` : '';
    return { expects: { damage: price.damage, seconds: price.seconds, oneHit },
      description: `${setup}: ${who}, and its body does not go under a ceiling two high (the game's rule), so the nearest it can stand is a block and a half off, out of its own reach (a blow reaches about a block and a half centre to centre, sideways only) and within the sword's (three blocks from the eye); it is struck each time it comes to the edge, the shield up facing it between swings. Under it, a wither skeleton's blow cannot reach, and so it withers nothing.${raceSays}${shortSays}${wg.measuredSays('low', tall.filter(t => t.entity.name === 'wither_skeleton').length, { also: ['fight'] })}` + costSays(price, bot.health, mobs, { doing: plan.kind === 'roof' ? 'putting the ceiling in' : 'digging in', done: 'Under it' }),
      run: async () => {
        this.report(goal, save, { action: 'low_ceiling', kind: plan.kind, to: { ...plan.stand }, blocks: plan.blocks, health: bot.health, stance: true });
        lowerShield(bot);
        const movements = bot.pathfinder?.movements, kept = movements && { allow1by1towers: movements.allow1by1towers, canDig: movements.canDig, maxDropDown: movements.maxDropDown };
        const walkTo = async cell => {
          if (movements) Object.assign(movements, { allow1by1towers: false, canDig: false, maxDropDown: 0 });
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), { timeoutMs: 4000, stallMs: 1500 }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { if (movements) Object.assign(movements, kept); }
          if (!feetCell(bot).equals(cell)) throw Object.assign(new Error(`the step to (${cell.x}, ${cell.y}, ${cell.z}) ended at ${feetCell(bot)}`), { name: 'StanceFailed' });
        };
        if (plan.kind === 'dig') {
          for (const c of plan.dug) {
            if (bot.blockAt(c)?.boundingBox !== 'block') continue;
            try { await this.actions.dig(bot, task, c, { requireDrops: false }); }
            catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; throw Object.assign(new Error(`the hole's block at (${c.x}, ${c.y}, ${c.z}) was not dug: ${err.message}`), { name: 'StanceFailed' }); }
          }
          await walkTo(plan.stand);
        } else {
          if (plan.steps) await walkTo(plan.stand);
          // To the middle of the cell first: the ceiling keeps it out a
          // block and a half from the middle, and less from its edge.
          await centreOn(bot, task, plan.stand);
          for (const c of plan.placed) {
            if (bot.blockAt(c)?.boundingBox === 'block') continue;
            try { await this.actions.place(bot, task, c, plan.material, { stay: true }); }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; throw Object.assign(new Error(`the ceiling's block at (${c.x}, ${c.y}, ${c.z}) did not go in: ${err.message}`), { name: 'StanceFailed' }); }
          }
        }
        await centreOn(bot, task, plan.stand);
        const r = await wg.guard(bot, task, { until: Date.now() + 15000, focus: tall[0].entity.id, radius: 16 });
        this.state.stanceWhy = `under the ceiling: ${r.swings} swing${r.swings === 1 ? '' : 's'}, ${r.hurt ? `${r.hurt} health lost` : 'no health lost'}`;
        return true;
      } };
  }

  // Why a held block in a creeper's line is to be asked again, or null
  // while it holds: the line open again (the creeper come round to one), or
  // the creeper coming nearer since the line was cut (or moving at all
  // within its lighting range). A creeper walking off or round at the
  // same distance, out of its line, changes nothing the block turns on:
  // asked at each such step, 25594 (mid-242-he) answered block_creeper ten
  // times in fourteen seconds, the creeper going from 7 to 9.7 blocks off
  // (note 685). Past three blocks it walks
  // round the block toward the bot, making its way anew each second, seen
  // or not (26.1.2 MeleeAttackGoal); held on "the line is stopped", mid-243-
  // aa's stance put a block in each new line as it came round, four in six
  // seconds, never asking, until it came in lit at 1.7 blocks with the bot
  // walled in on three sides by its own blocks (note 547).
  blockCreeperHeld(held) {
    const hold = held?.choice === 'block_creeper' ? held.blockCreeper : null;
    if (!hold) return null;
    if (held.askAgain) return held.askAgain;
    const bot = this.bot, e = bot.entities?.[hold.id];
    if (!e?.position || e.isValid === false) return null;
    const r1 = v => Math.round(v * 10) / 10, d = r1(e.position.distanceTo(bot.entity.position));
    if (!require('./creeper-sight').sightLine(bot, e).stoppedBy) return `the creeper has come round the block to a line to the bot, ${d} blocks off${creeperSwelling(bot, e) ? ', lit' : ''}`;
    if (creeperSwelling(bot, e)) return `the creeper is lit behind the block, ${d} blocks off`;
    // Nearer by what the block turns on: into its blast's reach (six blocks,
    // combat-estimate creeperBlast), then each whole block nearer inside it.
    // Out of its line it does not light however near it mills (26.1.2
    // SwellGoal: no line, the fuse runs down), so moving about within three
    // is not asked for. 25581 (mid-243-hg) answered block_creeper twelve
    // times in 24 seconds behind the one block it had laid, five of them for
    // a creeper milling at 2.5 to 3 blocks, and five for each 0.75 it came
    // from 9.4 to 3.3 (note 706).
    const moved = Math.hypot(e.position.x - hold.creeperAt.x, e.position.z - hold.creeperAt.z) + Math.abs(e.position.y - hold.creeperAt.y);
    const band = x => x >= CREEPER_BLAST_REACH ? CREEPER_BLAST_REACH : Math.floor(x);
    if (moved >= CREEPER_WALKS && d <= hold.distance - CREEPER_WALKS && band(d) < band(hold.distance)) return `the creeper is coming nearer: ${r1(moved)} blocks since its line was cut, from ${r1(hold.distance)} to ${d} blocks off the bot${hold.distance >= CREEPER_BLAST_REACH ? `, into its blast's reach of ${CREEPER_BLAST_REACH}` : ''}`;
    return null;
  }

  // A block in a creeper's line (creeper-sight.js): offered for the creeper
  // within ten blocks whose fuse ends first (a lit one before one not lit,
  // then the nearest), where a cell on the ray from its eyes to the bot's
  // takes a block from here and the blocks are carried; priced by the
  // seconds until the line is cut against the fuse (creeperBlocked), with
  // the blast where it goes off if that is too late, and what it does next.
  // Held, with the line stopped, it is staying behind the block. mid-241-a
  // had a creeper coming on at 4.4 blocks, a wall at its back and 4.8
  // health: every stance offered cost more than that (note 534).
  // A block already in its line (the ground's, or one the bot laid) is the
  // same stance, staying behind it, and offered as such: mid-242-af-nether-
  // 3-fortress-1 stood on its bridge three blocks over a creeper that did
  // not see it through the bridge, was offered no way to stay out of its
  // sight, and ran down into it. And a creeper coming on from past seven is
  // one to block as well: mid-242-af-nether-2-fortress-2's was 7.1 blocks
  // off, walking in, and no block was offered (note 604).
  creeperBlockOption(task, goal, save, { coming, mobs, shielded, oneHit, edge = '' }) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function' || inWater(bot)) return null;
    const { FUSE_KEPT, FUSE, LIGHTS_AT, creeperBlocked, armourOf } = require('./combat-estimate');
    const { blockPlan, whereSays, creeperWalk } = require('./creeper-sight');
    const creepers = coming.filter(t => t.entity.name === 'creeper' && t.distance <= FUSE_KEPT + 3 && t.entity.position)
      .map(t => ({ t, litFor: creeperLitFor(bot, t.entity) }))
      .sort((a, b) => (Number.isFinite(b.litFor) - Number.isFinite(a.litFor)) || a.t.distance - b.t.distance);
    if (!creepers.length) return null;
    const { t: c, litFor } = creepers[0];
    const plan = blockPlan(bot, c.entity);
    const behind = !!plan.stoppedBy;
    const n = plan.cells.length;
    if (!behind && !(n && shelter.materialStock(bot) >= n)) return null;
    const worn = armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
    const lit = Number.isFinite(litFor), d = Math.round(c.distance * 10) / 10;
    const seenLit = lit && watchFuses(bot).has(c.entity.id);
    const cutSeconds = behind ? 0 : plan.cutAfter * BLOCK_SECONDS, total = n * BLOCK_SECONDS;
    const b = creeperBlocked({ distance: c.distance, litFor: lit ? litFor : null, cutSeconds, worn });
    const rule = ` A creeper's fuse burns only while it sees the bot within ${FUSE_KEPT} blocks, and its sight is one line from its eyes to the bot's, which any block stops; out of its sight the fuse burns back down a tick at a time, as long as it had burned, and does not go off.`;
    const fuse = lit ? ` It is lit, about ${b.goesOffIn} seconds of its fuse left${seenLit ? '' : ' (its lighting not seen: half the fuse taken as gone)'}.`
      : ` It is not lit: at ${LIGHTS_AT} blocks in about ${b.lightsIn} seconds at its walk, and it goes off ${FUSE} seconds after that if it sees the bot.`;
    const verdict = behind ? '' : b.inTime ? ` The line is cut about ${b.margin} seconds before it would go off.`
      : ` That is about ${Math.round(-b.margin * 10) / 10} seconds too late: it goes off first, about ${b.goesOffAt} blocks off, about ${Math.round(b.blast)} after the armour worn${b.blast >= bot.health ? ', more than the bot has' : ''}.`;
    // Where it goes then, by its own way (creeper-sight.js creeperWalk):
    // mid-243-aa's creeper was told to stand behind the first block; it
    // walked round each block put in its line at three to four blocks and
    // came in lit on the side left open, while the stance, held, put four
    // two-high columns round the bot without asking again (note 547).
    const walk = creeperWalk(bot, c.entity, { planned: behind ? [] : plan.cells });
    const { BLAST_CLEAR, creeperBlast, afterArmour } = require('./combat-estimate');
    const roundBlast = walk.sees && !walk.within ? Math.round(afterArmour(creeperBlast(walk.distance), worn) * 10) / 10 : 0;
    const goesOffIn = walk.sees && !walk.within ? Math.round((walk.seconds + FUSE) * 10) / 10 : null;
    const walkSays = walk.noWay ? ` It has no way to walk to the bot from where it is: it stays about there, and behind the block it does not see the bot.`
      : walk.within ? (walk.sees ? '' : ` It is within ${LIGHTS_AT} blocks: it stands where it is while the bot stays, and its fuse ${lit ? 'burns back down' : 'does not light'}.`)
      : walk.sees ? ` It is more than ${LIGHTS_AT} off, so it walks on toward the bot round the block, making its way anew about every second whether it sees the bot or not; it stops at the first point of that way within ${LIGHTS_AT} blocks. Here that point is about ${walk.blocks} blocks' walk from it, about ${walk.seconds} seconds, ${walk.distance} blocks from the bot, where it sees the bot past the block: it lights there with its whole fuse and goes off about ${goesOffIn} seconds from now, about ${Math.round(afterArmour(creeperBlast(walk.distance), worn))} after the armour worn, unless the bot is more than ${FUSE_KEPT} off or out of its sight by then. The block buys those seconds, not the end of it: they are for backing out past ${BLAST_CLEAR} blocks, where its blast does nothing, or for striking it; staying behind the block, the blast is the price, and the stance is asked again as it comes into its blast's reach of ${CREEPER_BLAST_REACH} blocks and at each block nearer inside it, or as it lights or its line opens.`
      : ` It is more than ${LIGHTS_AT} off, so it walks on toward the bot round the block, making its way anew about every second whether it sees the bot or not; it stops at the first point of that way within ${LIGHTS_AT} blocks. Here that point is about ${walk.blocks} blocks' walk from it, about ${walk.seconds} seconds, ${walk.distance} blocks from the bot, where the block still stops its line: it stands there and does not light.`;
    const next = ` Behind it: within ${LIGHTS_AT} blocks of the bot the creeper stands where it is, lit or not, and out of its sight it does not light.${walkSays} Out of its sight three seconds on end, it forgets the bot and stops following it until it sees it again. If the bot backs off past ${LIGHTS_AT} blocks from it, it walks round the block and lights again where it comes within ${LIGHTS_AT} in sight. Neither strikes the other through the block.`;
    const others = creepers.slice(1);
    const othersSays = others.length ? ` ${others.length === 1 ? `The other creeper (${Math.round(others[0].t.distance)} blocks off) is` : `${others.length} other creepers (${others.map(o => Math.round(o.t.distance)).join(', ')} blocks off) are`} not in this line.` : '';
    const rest = mobs.filter(m => m.id !== c.entity.id);
    const cost = stanceCost({ mobs: rest, setup: total, reaches: () => true, shield: shielded });
    const damage = Math.round((cost.damage + (b.inTime || behind ? roundBlast : b.blast)) * 10) / 10;
    const what = `the creeper (${d} blocks off${lit ? ', lit' : ''})`;
    const description = behind
      ? `Stay behind the ${plan.stoppedBy.name.replaceAll('_', ' ')} at ${plan.stoppedBy.cell}, in the line from the eyes of ${what} to the bot's.${rule}${fuse}${next}${othersSays}` + costSays(cost, bot.health, rest, { done: 'Behind it' }) + edge
      : `Put ${n === 1 ? 'a block' : `${n} blocks, two high,`} in the line from the eyes of ${what} to the bot's, ${whereSays(bot, plan.cuts)}: about ${Math.round(cutSeconds * 10) / 10} seconds until the line is cut${n > 1 ? ` (the ${plan.cutAfter === 1 ? 'first' : 'second'} block), ${Math.round(total * 10) / 10} for both` : ''}, and stay behind it.${rule}${fuse}${verdict}${next}${othersSays}` + costSays(cost, bot.health, rest, { doing: 'placing', done: 'Behind it' }) + edge;
    return { expects: { damage, seconds: cost.seconds, oneHit }, description,
      run: async () => {
        const e = bot.entities?.[c.entity.id] || c.entity;
        if (e.isValid === false) return true;
        const stance = this.state.stance?.choice === 'block_creeper' ? this.state.stance : null;
        // Where the creeper was when its line was cut: what the hold
        // watches (blockCreeperHeld).
        const cut = () => { if (stance && !stance.blockCreeper) stance.blockCreeper = { id: e.id, creeperAt: e.position.clone(), distance: e.position.distanceTo(bot.entity.position), at: Date.now() }; };
        const now = blockPlan(bot, e);
        // The line stopped: the bot stays behind it, a moment at a time.
        if (now.stoppedBy) { cut(); await sleep(250); return true; }
        // A line open again once this stance had cut one is not closed
        // again here: another block is another choice, asked with where the
        // creeper has come to. Held, mid-243-aa's stance put four two-high
        // columns round the bot as its creeper walked round them, until
        // it came in lit on the side left open and there was no room to
        // back out (note 547).
        if (stance?.blockCreeper) { stance.askAgain = `the creeper has come round the block to a line to the bot, ${Math.round(e.position.distanceTo(bot.entity.position) * 10) / 10} blocks off${creeperSwelling(bot, e) ? ', lit' : ''}`; return true; }
        if (!now.cells.length) throw Object.assign(new Error(now.why || 'no cell in its line takes a block'), { name: 'StanceFailed' });
        const material = shelter.buildingItem(bot, now.cells.length)?.name;
        if (!material) throw Object.assign(new Error(`not ${now.cells.length} building blocks of one kind carried`), { name: 'StanceFailed' });
        const r1 = v => Math.round(v * 10) / 10;
        this.report(goal, save, { action: 'block_creeper', creeper: r1(e.position.distanceTo(bot.entity.position)), creeperAt: { x: r1(e.position.x), y: r1(e.position.y), z: r1(e.position.z) }, lit: creeperSwelling(bot, e), cells: now.cells.map(p => ({ ...p })) });
        for (const p of now.cells) {
          task.check();
          try { await this.actions.place(bot, task, p, material, { stay: true }); }
          catch (err) {
            task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
            // The line cut is the cover; the rest is the second of two high.
            if (blockPlan(bot, e).stoppedBy) { cut(); return true; }
            throw Object.assign(new Error(String(err.message || err).slice(0, 160)), { name: 'StanceFailed' });
          }
        }
        if (blockPlan(bot, e).stoppedBy) cut();
        return true;
      } };
  }

  // A warped fungus set down beside the bot, where hoglins can get to it
  // and one is carried (hoglin-repellent.js): hoglins within eight across
  // and four up or down of the block attack nothing and walk off from it.
  // Priced with every mob hitting while it is placed and the second before
  // the hoglins notice it, then the rest but the hoglins. The bots carry
  // warped fungus picked up in the forests, and none was ever offered it:
  // mid-208-k-nether-1 and nether-4-fortress-1 were bitten to death by
  // hoglins while they ate and fought between them (note 587).
  warpedFungusOption(task, goal, save, { coming, mobs, shielded, oneHit, edge = '' }) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function' || inWater(bot)) return null;
    const { REPELLED, ACROSS, NOTICE_SECONDS, fungusPlan, ruleSays } = require('./hoglin-repellent');
    const hoglins = coming.filter(t => REPELLED.has(t.entity.name));
    if (!hoglins.length) return null;
    const stance = this.state.stance?.choice === 'warped_fungus' ? this.state.stance : null;
    const set = stance?.fungus?.at && bot.blockAt(new Vec3(stance.fungus.at.x, stance.fungus.at.y, stance.fungus.at.z))?.name === 'warped_fungus' ? stance.fungus.at : null;
    const plan = set ? null : fungusPlan(bot);
    if (!set && !plan?.cells) return null;
    const r1 = v => Math.round(v * 10) / 10;
    const here = bot.entity.position;
    const them = hoglins.map(t => `the hoglin ${Math.round(t.distance)} blocks off`).join(', ');
    const n = plan?.cells?.length || 0, setup = set ? 0 : r1(n * BLOCK_SECONDS + NOTICE_SECONDS);
    const cost = stanceCost({ mobs, setup, reaches: m => !REPELLED.has(m.name), shield: shielded });
    const outside = hoglins.filter(t => t.distance > ACROSS + 2);
    const outsideSays = outside.length ? ` ${outside.length === 1 ? 'One hoglin is' : `${outside.length} hoglins are`} more than ${ACROSS} blocks from where it goes: each is calmed when it comes that near.` : '';
    if (set) {
      const d = r1(here.distanceTo(new Vec3(set.x + 0.5, set.y, set.z + 0.5)));
      return { expects: { damage: cost.damage, seconds: cost.seconds, oneHit },
        description: `Stay by the warped fungus set down at ${set.x}, ${set.y}, ${set.z}, ${d} blocks off, against ${them}.${ruleSays()}${outsideSays} It stays where it is set; broken, it comes back as the item at a touch.` + costSays(cost, bot.health, mobs, { done: 'By the fungus' }) + edge,
        run: async () => { await sleep(250); return true; } };
    }
    const at = plan.cell, d = r1(here.distanceTo(at.offset(0.5, 0, 0.5)));
    const how = plan.laid ? `on a block of ${plan.on.replaceAll('_', ' ')} laid first from the ${plan.on.replaceAll('_', ' ')} carried (nothing here takes it)` : `on the ${plan.on.replaceAll('_', ' ')} there`;
    const description = `Set a warped fungus down at ${at.x}, ${at.y}, ${at.z}, ${d} blocks off, ${how} (${plan.carried} carried), against ${them}: about ${r1(n * BLOCK_SECONDS)} seconds placing ${n === 1 ? 'one block' : `${n} blocks`}, the shield down, and about ${NOTICE_SECONDS} second more before the hoglins notice it; then stay by it.${ruleSays()}${outsideSays} It stays where it is set; broken, it comes back as the item at a touch.` + costSays(cost, bot.health, mobs, { doing: 'placing', done: 'By the fungus' }) + edge;
    return { expects: { damage: cost.damage, seconds: cost.seconds, oneHit }, description,
      run: async () => {
        const held = this.state.stance?.choice === 'warped_fungus' ? this.state.stance : null;
        const placed = held?.fungus?.at;
        if (placed && bot.blockAt(new Vec3(placed.x, placed.y, placed.z))?.name === 'warped_fungus') { await sleep(250); return true; }
        const now = fungusPlan(bot);
        if (!now?.cells) throw Object.assign(new Error(now?.none || 'no warped fungus carried'), { name: 'StanceFailed' });
        this.report(goal, save, { action: 'warped_fungus', hoglins: hoglins.map(t => r1(t.distance)), at: { x: now.cell.x, y: now.cell.y, z: now.cell.z }, on: now.on, health: bot.health });
        for (const c of now.cells) {
          task.check();
          try { await this.actions.place(bot, task, c.at, c.item, { stay: true }); }
          catch (err) {
            task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
            throw Object.assign(new Error(`${String(err.message || err).slice(0, 160)} (the ${c.item.replaceAll('_', ' ')} at ${c.at})`), { name: 'StanceFailed' });
          }
        }
        if (held) held.fungus = { at: { x: now.cell.x, y: now.cell.y, z: now.cell.z } };
        return true;
      } };
  }

  async wallOff(task, goal, save, danger, { reach = 6, action = 'wall_off' } = {}) {
    const bot = this.bot;
    if (typeof this.actions.place !== 'function') return false;
    const material = shelter.buildingItem(bot, 2)?.name;
    if (!material) return false;
    const feet = feetCell(bot);
    // The cells of each wall still open: a one-high rail at the feet (rail
    // span) wants only the block on top. Needing both cells empty, mid-235-
    // p-fortress-7's take_cover beside its railed span placed nothing six
    // times in two seconds, "failed" each time with no why, and Jev said
    // none of these twice (note 528).
    const walls = [], why = [];
    for (const t of danger) {
      if (t.distance > reach) continue;
      const dx = t.entity.position.x - bot.entity.position.x, dz = t.entity.position.z - bot.entity.position.z;
      const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
      if (!step.x && !step.z) continue;
      const cell = feet.plus(step);
      if (walls.some(w => w.cell.equals(cell))) continue;
      const name = t.entity.name.replaceAll('_', ' ');
      // The mob not standing in it.
      if (t.entity.position.floored().equals(cell) || t.entity.position.distanceTo(cell.offset(0.5, 0, 0.5)) < 0.9) { why.push(`the ${name} stands in the cell toward it`); continue; }
      const open = [cell, cell.offset(0, 1, 0)].filter(p => shelter.replaceable(bot.blockAt(p)));
      if (!open.length) { why.push(`the cells toward the ${name} are both solid already, and it has a line over or round them`); continue; }
      walls.push({ cell, open });
    }
    if (!walls.length) { this.lastWallWhy = why.join('; ') || 'no shooter in reach to wall off'; return false; }
    this.report(goal, save, { action, threats: danger.map(t => t.entity.name), cells: walls.flatMap(w => w.open.map(p => ({ ...p }))) });
    let placed = 0;
    for (const { open } of walls) {
      for (const p of open) {
        task.check();
        try { await this.actions.place(bot, task, p, material); placed++; }
        catch (err) {
          task.check(); if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
          this.lastWallWhy = String(err.message || err).slice(0, 160);
          // A wall's foot standing is some cover; nothing placed is none.
          return placed > 0;
        }
      }
    }
    return true;
  }

  // The passage out of a pocket away from a creeper, surveyed before it is
  // offered (the pocket_next option tunnel_out): level, one wide and two
  // high, along the axis that leads farthest from the creeper, cell by cell
  // through rock that is safe to dig (nothing flowing behind it, tunneling.js
  // safeExcavation) with a solid floor under each cell, until its end is
  // PASSAGE_CLEAR blocks from the creeper and at least PASSAGE_MIN long. Null
  // where the rock ahead does not allow it.
  // A warden's too, to beyond its boom's reach (wardenSays), farther and
  // longer: mid-230-n had no way away from one but the doors (note 412).
  // And from a spawner's block (a position, not a mob), to beyond its
  // sixteen, clear of a creeper too when one is about (also) (note 476).
  // Not only level along the one axis away: mid-242-ab-nether-3-fortress-1
  // sat twenty-eight minutes and more sealed on the lip of a fortress pier,
  // twelve blocks from a blaze spawner seven above it, the mobs within 24
  // blocks growing from five to twenty and more, and was never offered a
  // way out under rock (note 597). Level, the pier's rock ran out into the air on every side short of
  // the spawner's sixteen; the way a player digs there, down into the pier
  // and away, was never looked at. Now each way that does not lead toward it
  // is surveyed, the one straight away first and then the two across, level
  // first and then a stair down (a block lower each step, three blocks dug a
  // step), and the first that ends clear is the passage, its cells kept
  // (path). `sphere` measures the clearance in three dimensions, as a
  // spawner's sixteen is.
  passageOut(from, { clear = PASSAGE_CLEAR, max = PASSAGE_MAX, also = [], sphere = false } = {}) {
    const bot = this.bot;
    const feet = feetCell(bot), at = from.entity ? from.entity.position : from.offset(0.5, 0.5, 0.5);
    const clearOf = q => also.every(a => Math.hypot(q.x + 0.5 - a.at.x, q.z + 0.5 - a.at.z) >= a.clear);
    const far = q => sphere ? Math.hypot(q.x + 0.5 - at.x, q.y - at.y, q.z + 0.5 - at.z) : Math.hypot(q.x + 0.5 - at.x, q.z + 0.5 - at.z);
    const away = feet.offset(0.5, 0, 0.5).minus(at);
    const first = Math.abs(away.x) >= Math.abs(away.z) ? new Vec3(Math.sign(away.x) || 1, 0, 0) : new Vec3(0, 0, Math.sign(away.z) || 1);
    const gain = d => d.x * away.x + d.z * away.z;
    const across = [new Vec3(first.z, 0, first.x), new Vec3(-first.z, 0, -first.x)].filter(d => gain(d) >= 0).sort((a, b) => gain(b) - gain(a));
    const named = d => d.x === 1 ? 'east' : d.x === -1 ? 'west' : d.z === 1 ? 'south' : 'north';
    const { safeExcavation } = require('./tunneling');
    const survey = (dir, drop) => {
      let here = feet, cells = 0;
      const path = [];
      for (let n = 0; n < max; n++) {
        const next = here.plus(dir).offset(0, -drop, 0);
        const floor = bot.blockAt(next.offset(0, -1, 0));
        if (!floor || floor.boundingBox !== 'block' || /lava|water/.test(floor.name)) break;
        const dig = drop ? [next, next.offset(0, 1, 0), next.offset(0, 2, 0)] : [next, next.offset(0, 1, 0)];
        let blocked = false;
        for (const c of dig) {
          const b = bot.blockAt(c);
          if (!b || /lava|water|fire/.test(b.name) || (b.boundingBox === 'block' && (!b.diggable || !safeExcavation(bot, c)))) { blocked = true; break; }
        }
        if (blocked) break;
        path.push({ at: next, dig });
        here = next; cells++;
        if (cells >= PASSAGE_MIN && far(here) >= clear && clearOf(here)) break;
      }
      if (cells < PASSAGE_MIN || far(here) < clear || !clearOf(here)) return null;
      return { dir, direction: named(dir), cells, clearance: Math.round(far(here)), end: here, down: feet.y - here.y, blocks: path.reduce((n, c) => n + c.dig.length, 0), path };
    };
    for (const drop of [0, 1]) for (const dir of [first, ...across]) { const p = survey(dir, drop); if (p) return p; }
    return null;
  }

  // Dig the passage surveyed (passageOut) and go on from its end: the pocket
  // is forgotten as one left by a door. The creeper is looked for before
  // each cell; within six blocks of the passage's head it stops, the bot
  // still enclosed, and the pocket's next step is asked again.
  async tunnelOut(task, goal, save, refuge, creeper, passage) {
    const bot = this.bot;
    this.report(goal, save, { action: 'tunnel_out', origin: refuge.origin, direction: passage.direction, cells: passage.cells, from: creeper.entity.name, distance: Number(creeper.distance.toFixed(1)), health: bot.health });
    const start = feetCell(bot).offset(0.5, 0, 0.5);
    let here = feetCell(bot), dug = 0;
    // The cells surveyed, level or a stair down (passage.path); one
    // surveyed without them is the level run along its axis.
    const cells = passage.path || Array.from({ length: passage.cells }, (_, n) => { const at = here.plus(passage.dir.scaled(n + 1)); return { at, dig: [at, at.offset(0, 1, 0)] }; });
    for (const cell of cells) {
      task.check();
      const next = cell.at, head = next.offset(0.5, 0, 0.5);
      // Come round toward the passage: within six of its head and nearer to
      // it than to the pocket it was dug from. (The first cell of a passage
      // dug from five blocks off is six from the creeper by itself.)
      const kind = creeper.entity.name;
      const near = threats(bot, 32).filter(t => t.entity.name === kind).some(t => t.entity.position.distanceTo(head) <= 6 && t.entity.position.distanceTo(head) < t.entity.position.distanceTo(start));
      if (near) { this.report(goal, save, { action: 'tunnel_out_stopped', cells: dug, reason: `a ${kind} come round within six blocks of the passage's head` }); return dug > 0; }
      for (const c of cell.dig) {
        const b = bot.blockAt(c);
        if (b && b.boundingBox === 'block') {
          if (!require('./tunneling').safeExcavation(bot, c)) { this.report(goal, save, { action: 'tunnel_out_stopped', cells: dug, reason: `lava or water behind the ${b.name.replaceAll('_', ' ')} ahead` }); return dug > 0; }
          await this.actions.dig(bot, task, c, { requireDrops: false });
        }
      }
      await this.actions.navigate(bot, task, new goals.GoalBlock(next.x, next.y, next.z), { timeoutMs: 6000, stallMs: 2000 });
      here = next; dug++;
    }
    // Left by its passage, the pocket is one night's stop like any other.
    if (refuge.kind !== 'house') { this.state.shelters = this.state.shelters.filter(s => s !== refuge); save(); }
    return true;
  }

  // The door a leave opens (leave, below), for the leave and for what the
  // leave is said to cost (way-out.js, note 679).
  leaveExit(refuge, { past = false } = {}) {
    const bot = this.bot;
    const near = threats(bot).filter(t => (t.visible || t.distance < 6) && !claimed(bot, t.entity));
    // Past them, but never out beside a creeper: mid-72-g, chosen to leave
    // with one three blocks off behind the wall, opened the pocket on it
    // and was blown up from twenty health (2026-09-26). A door within six
    // blocks of a creeper stays shut, and the pocket waits as before.
    const creepers = threats(bot, 16).filter(t => t.entity.name === 'creeper');
    const danger = past ? creepers.map(t => ({ ...t, reach: 6 })) : near;
    const clearance = p => Math.min(Infinity, ...near.map(t => t.entity.position.distanceTo(p)));
    const farthest = list => past ? [...list].sort((a, b) => clearance(b.outside || b) - clearance(a.outside || a)) : list;
    const formal = farthest(shelter.exits(bot, refuge).filter(exit => danger.every(t => t.entity.position.distanceTo(exit.outside) > (t.reach ?? 20))));
    // A pocket sealed in a staircase has no two-block exit: its door is the
    // closure the bot placed, and the way on is dug from there.
    const pocket = !formal.length && farthest(shelter.closures(bot, refuge).filter(door => danger.every(t => t.entity.position.distanceTo(door) > (t.reach ?? 20))));
    // A shaft pocket's door is its cap: dug straight down with rock (or
    // snow, ice) all round, it has no side a door can be dug through, and
    // the way out is up. mid-231-r's shaft on a snowy slope was chosen to be
    // left four times by day and refused each time as "threats block the
    // exits", with none in sight, for an hour (note 538).
    const cap = !formal.length && !pocket.length && refuge.shaft ? shaftCap(bot, refuge) : null;
    const capClear = cap && danger.every(t => t.entity.position.distanceTo(cap) > (t.reach ?? 20));
    const exit = formal[0] || (pocket.length ? { door: pocket[0], outside: null } : capClear ? { door: cap, outside: null, up: true } : null);
    return { exit, pocket, cap, near };
  }

  async leave(task, goal, save, refuge, reason, { past = false } = {}) {
    const bot = this.bot;
    // "Morning. Back to it." only when it is morning; a shelter left at
    // night for the bed, or with mobs outwaited, says so.
    reason ||= shelterNeeded(bot) ? 'Moving on.' : undefined;
    // Mobs that can see in, or are at the wall; the rest are behind rock.
    // Not the quarry, for a bot fit to fight it: the exit had to be twenty
    // blocks from every blaze, beside a spawner that is never true, so the
    // bot decided to leave and then refused every door for twenty minutes.
    // Going out for the mobs (a hunt) or past them (to the chest): no exit
    // is refused for them.
    // Going past them, the door farthest from them: mid-110-n chose to leave
    // its pocket past a zombie and a skeleton fifteen times, and was held
    // behind the lid for twenty minutes because every door was within
    // twenty blocks of one (2026-09-26).
    const { exit, pocket, cap } = this.leaveExit(refuge, { past });
    if (!exit) {
      // Said as it is: a door refused for a mob, or no door at all.
      const sides = shelter.exits(bot, refuge).length + shelter.closures(bot, refuge).length + (cap ? 1 : 0);
      const why = sides ? 'Nearby threats still block the shelter exits' : 'No wall of this pocket can be opened as a door';
      this.state.leaveRefused = why;
      await this.wait(task, goal, save, why);
      return false;
    }
    delete this.state.leaveRefused;
    // Who walked the bot out, in the record: mid-243-m left its pocket at
    // night at 9.3 health, a spider and a skeleton outside, 0.2 seconds
    // after Jev chose to sleep in a nook, and no path in the code read as
    // the one (note 422).
    const via = (new Error().stack || '').split('\n').slice(2, 5).map(l => (l.match(/at (?:async )?([\w.<>]+)/) || [])[1]).filter(Boolean).join(' < ');
    this.report(goal, save, { action: 'leave_shelter', origin: refuge.origin, reason, via, ...(this.state.leaveChosen ? { chosen: true } : {}) });
    delete this.state.leaveChosen;
    // Opening our temporary closure is necessary even if the last pick broke.
    // Bare-handed stone clearing loses its drop but must not imprison the bot
    // inside a one-cell shelter with no room to place a crafting table.
    // A pocket is one night's stop, not a home: every closure comes down so
    // the staircase continues in both directions, and the pocket is
    // forgotten so its shell no longer stands reserved against the climb.
    if (exit.up) {
      await this.actions.dig(bot, task, exit.door, { requireDrops: false });
      this.state.shelters = this.state.shelters.filter(s => s !== refuge); save();
      // Up the open shaft to where it was dug from: the walk climbs it,
      // a block under the feet where a step is too high.
      const top = refuge.top ? pos(refuge.top) : exit.door.offset(0, 1, 0);
      try { await this.actions.navigate(bot, task, new goals.GoalBlock(top.x, top.y, top.z), { timeoutMs: 15000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      return true;
    }
    const doors = exit.outside ? [exit.door] : pocket;
    for (const door of doors) {
      await this.actions.dig(bot, task, door.offset(0, 1, 0), { requireDrops: false });
      await this.actions.dig(bot, task, door, { requireDrops: false });
    }
    // Any dug-in shelter is one night's stop: left behind, it is forgotten,
    // so its shell no longer stands reserved against the next staircase.
    // Only a house persists. The bot bounced between the two floor cells of
    // a pocket it had just left, every other cell around it reserved.
    if (refuge.kind !== 'house') { this.state.shelters = this.state.shelters.filter(s => s !== refuge); save(); }
    // At the base, the whole pocket comes down in the morning. One left
    // standing beside the bed put a block on the bed and one on the stash
    // chest and walled the path to the wheat: no sleep, no food from the
    // chest, no harvest, and a bot with nothing left to try.
    const home = homeOf(bot, goal);
    if (refuge.kind !== 'house' && !shelterNeeded(bot) && home?.origin && home.dimension === bot.game.dimension &&
        pos(refuge.origin).distanceTo(pos(home.origin)) <= 12) {
      const placed = shelter.shell(refuge.origin).filter(p => POCKET_BLOCKS.has(bot.blockAt(p)?.name));
      if (placed.length) this.report(goal, save, { action: 'clear_pocket_at_base', cells: placed.length });
      for (const p of placed) { try { await this.actions.dig(bot, task, p, { requireDrops: false }); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; } }
    }
    if (exit.outside) await this.actions.navigate(bot, task, new goals.GoalBlock(exit.outside.x, exit.outside.y, exit.outside.z), { timeoutMs: 10000 });
    return true;
  }

  // One Jev decision over a tree the code built: the question is defined in
  // decisions/survival.js and asked the one way every question is.
  decide(task, goal, save, { id, state, tree, context, isFresh = () => true, interrupt = () => {}, situation = undefined, aside = false }) {
    return decide(id, { client: this.client, bot: this.bot, task, goal, save, tree, state, context, isFresh, interrupt, situation, aside });
  }

  // The carried bed goes down where the night caught us and comes back up
  // at dawn. A sleep the server refuses (a mob within eight blocks, another
  // survival player awake) hands the night to the shelter path instead.
  // With `site` (a bed nook, dug), the carried bed goes there.
  async sleepStep(task, goal, save, { site: nook = null } = {}) {
    const bot = this.bot, item = bedCarried(bot), placed = nook ? null : bedToSleepIn(bot, goal), site = nook || placed || (item && bedSite(bot));
    if (!site) throw new Error('No level ground beside me for the bed');
    if (nook && !item) throw new Error('No bed carried for the nook');
    // The game refuses a sleep with a monster within eight blocks sideways and
    // five up or down, seen or not, so the carried bed is not put down for it:
    // said as a fact on the option, and here as what the server will do.
    if (!placed) {
      const near = monstersAtBed(bot, site.foot);
      if (near.length) {
        const err = new Error(`The server refuses a sleep with monsters within eight blocks: ${near.slice(0, 3).map(t => `${t.entity.name} ${Math.round(t.entity.position.distanceTo(site.foot))} off`).join(', ')}`);
        setAside(this, 'sleep', 'bed', err, 600000);
        this.state.lastSleepError = err.message; this.report(goal, save, { action: 'sleep_failed', reason: err.message, placed: false });
        throw err;
      }
    }
    this.report(goal, save, { action: 'sleep', at: { ...site.foot }, home: !!placed });
    if (placed) {
      // A walk that fails is a route problem, not a bed problem: the shelter
      // path takes this night's next two minutes, and the bed stays in play.
      // The stand cell first (it is laid out to be reachable), then two and
      // three blocks from the foot: a single goal failed from twenty blocks.
      const approaches = [[site.stand, 1], [site.foot, 2], [site.foot, 3]];
      let reached = false, lastError = null;
      // Watching on the way: hurt, or a mob in view close by, and the walk
      // stops so the next tick's threat rules have the bot, not the bed.
      const setOut = bot.health ?? 20;
      const trouble = () => (bot.health ?? 20) <= setOut - 3 || threats(bot, 6).some(t => t.visible);
      for (const [p, range] of approaches) {
        try { await this.actions.navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, range), { timeoutMs: 45000, stallMs: 8000, stopWhen: trouble }); reached = site.foot.distanceTo(bot.entity.position) <= 3.5; }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; lastError = err; }
        if (!reached && trouble()) { this.report(goal, save, { action: 'sleep_interrupted', health: bot.health }); throw new Error('Trouble on the way to bed'); }
        if (reached) break;
      }
      if (!reached) { setAside(this, 'bed_route', 'home', lastError || 'not close enough', 120000); this.report(goal, save, { action: 'sleep_failed', reason: `no way to the bed: ${lastError?.message || 'not close enough'}` }); throw lastError || new Error('No way to the bed'); }
      if (!isBed(bot.blockAt(site.foot))) throw new Error(site.observed ? 'The bed I saw is gone' : 'The bed at the base is not where it was left');
      // A bed needs air above it. A night shelter built around the bed put
      // a block on top of it, and every sleep after that was refused as
      // obstructed while the bot waited in the dark beside it. The cell
      // above each half is cleared first; a roof one higher still covers.
      await clearAboveBed(bot, task, this.actions, site);
    }
    else await placeOriented(bot, task, this.actions, site.stand, site.foot, item, () => isBed(bot.blockAt(site.foot)) && isBed(bot.blockAt(site.head)));
    let slept = false;
    try {
      // The server confirms the sleep a moment after the click, and refuses
      // it with a message. The first bedtime read the flag before either
      // arrived and built a shelter beside the bed.
      let refused = null;
      const onMessage = message => { const key = message?.json?.translate || message?.translate || String(message || ''); if (/bed\.(not_safe|too_far_away|obstructed|occupied|no_sleep)/.test(key)) refused = key; };
      bot.on?.('message', onMessage);
      try {
        const before = bot.time?.timeOfDay;
        // Mineflayer gives up after three seconds without its sleep event and
        // throws "bot is not sleeping". That threw past the clock check below
        // and past any refusal the server sent, so a night was written off as
        // a failed sleep, unexplained, and the bot stood by its bed until
        // dawn. Its own checks (not night, monsters near) are real refusals.
        try { await bot.sleep(bot.blockAt(site.foot)); }
        catch (err) { if (!/not sleeping/.test(err.message)) throw err; }
        // The ground truth is the clock: with the only survival player in
        // bed the server jumps to morning within a hundred ticks. The
        // sleeping flag is a hint, and a refusal is only final once the
        // clock has had its chance.
        const started = Date.now(), jumped = () => !sleepable(bot) || bot.time?.timeOfDay < before;
        while (Date.now() - started < 15000 && !jumped() && !(refused && Date.now() - started > 6000)) { task.check(); await sleep(200); }
        slept = jumped();
        if (bot.isSleeping) { try { await bot.wake(); } catch (_) {} }
        if (!slept && refused) throw new Error(`The server refused the sleep: ${refused}`);
        if (!slept) throw new Error('The night did not pass in bed');
      } finally { bot.removeListener?.('message', onMessage); }
    } catch (err) {
      task.check();
      // A refusal the server named (monsters near, not safe) waits out ten
      // minutes; a sleep that simply did not take is tried again in two.
      setAside(this, 'sleep', 'bed', err, /refused|monsters|not night|can only sleep/i.test(err.message) ? 600000 : 120000);
      this.state.lastSleepError = err.message; this.report(goal, save, { action: 'sleep_failed', reason: err.message });
    }
    finally {
      // The carried bed comes back up; the base's bed stays where it is. The
      // pickup is not cancellable: the threat layer preempting on a mob that
      // comes near threw Cancelled out of this block and the bed stayed
      // standing with its item on the floor (mid-243-bg, note 633).
      if (!placed) {
        const bed = item;
        await this.pickUpBed(task, site.foot, site.head, bed);
        if (bedCarried(bot)) { if (this.state.bedLeft) delete this.state.bedLeft; }
        else {
          const standing = [site.foot, site.head].some(p => isBed(bot.blockAt(p)));
          const lying = Object.values(bot.entities || {}).filter(e => e.isValid !== false && e.position && e.getDroppedItem?.()?.name === bed && e.position.distanceTo(site.foot) <= 10)
            .sort((x, y) => x.position.distanceTo(site.foot) - y.position.distanceTo(site.foot))[0];
          this.state.bedLeft = { name: bed, ...(lying ? { drop: { x: lying.position.x, y: lying.position.y, z: lying.position.z } } : {}), foot: { x: site.foot.x, y: site.foot.y, z: site.foot.z }, head: { x: site.head.x, y: site.head.y, z: site.head.z }, dimension: String(bot.game?.dimension || ''), at: Date.now(), tries: 0 };
          this.report(goal, save, { action: 'bed_left', bed, at: { ...site.foot }, standing, note: standing ? 'the bed is still standing where it was put down' : lying ? 'the bed was broken and its item lies on the ground near there' : 'the bed was broken and its item is not in view' });
        }
      }
      save();
    }
    if (!slept) throw new Error(this.state.lastSleepError || 'The night did not pass in bed');
    attemptsFor(this).clear('sleep', 'bed'); delete this.state.nightPlan;
    this.state.sleptAtAge = worldAge(bot);
    // A night in the home's bed sets the respawn point there; a carried bed
    // is picked up again, and the respawn goes back to the world's spawn.
    this.state.respawn = placed ? { x: site.foot.x, y: site.foot.y, z: site.foot.z, dimension: 'overworld' } : null;
    this.report(goal, save, { action: 'leave_shelter', reason: 'Morning. Back to it.' });
  }

  // The bed this bot put down comes back up: both halves dug, then the item
  // collected. Not cancellable (see sleepStep); each move is short and bounded.
  async pickUpBed(task, foot, head, name) {
    const bot = this.bot, solid = uncancellable(task);
    for (const p of [foot, head]) if (isBed(bot.blockAt(p))) { try { await this.actions.dig(bot, solid, p, { requireDrops: false }); } catch (_) { /* the check below says whether it is still there */ } }
    await sleep(800);
    if (bedCarried(bot)) return true;
    try { await require('./drop-collection').collectNearbyDrops(bot, solid, name, { origin: foot.offset(0.5, 0, 0.5), radius: 10, timeoutMs: 5000, waitForSpawnMs: 800 }); } catch (_) { /* fall through to the walk */ }
    if (!bedCarried(bot)) { try { await this.actions.navigate(bot, solid, new goals.GoalNear(foot.x, foot.y, foot.z, 0.5), { timeoutMs: 4000, stallMs: 2000 }); await sleep(600); } catch (_) { /* still not carried */ } }
    return !!bedCarried(bot);
  }

  // A bed left behind (state.bedLeft, from sleepStep's cleanup) is fetched
  // when it is near and nothing hostile is: it costs three wool and three
  // planks and sets the respawn. Three tries, twenty seconds apart, then it
  // is given up and said.
  async fetchLeftBed(task, goal, save) {
    const bot = this.bot, left = this.state.bedLeft;
    if (!left) return false;
    if (bedCarried(bot)) { delete this.state.bedLeft; save(); return false; }
    if (String(bot.game?.dimension || '') !== left.dimension) return false;
    const foot = pos(left.foot), head = pos(left.head), distance = foot.distanceTo(bot.entity.position);
    if (distance > 30 || (bot.health ?? 20) < 8 || threats(bot, 12).length || immediateThreat(bot)) return false;
    if (Date.now() - (left.lastTry || 0) < 20000) return false;
    left.lastTry = Date.now(); left.tries = (left.tries || 0) + 1;
    if (left.tries > 3) { this.report(goal, save, { action: 'bed_lost', bed: left.name, at: left.foot }); delete this.state.bedLeft; save(); return false; }
    this.report(goal, save, { action: 'bed_recover', bed: left.name, at: left.foot, distance: Math.round(distance), try: left.tries });
    try {
      const to = left.drop || left.foot;
      if (distance > 3) await this.actions.navigate(bot, task, new goals.GoalNear(to.x, to.y, to.z, 2), { timeoutMs: 15000, stallMs: 5000 });
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; return true; }
    const got = await this.pickUpBed(task, foot, head, left.name);
    if (got) { this.report(goal, save, { action: 'bed_recovered', bed: left.name }); delete this.state.bedLeft; }
    save();
    return true;
  }

  // The carried bed where no level cells lie beside the feet: a nook dug
  // for it (bedNook), the bed put in and slept in, and picked back up by
  // sleepStep as ever. From a sealed pocket the cells dug out of its wall go
  // back in after, whether the night passed or the sleep was refused, so
  // the pocket is shut again and the morning leaves it the usual way. A
  // nook that would not open rests three minutes.
  async nookSleep(task, goal, save, { pocket = null } = {}) {
    const bot = this.bot;
    if (!bedCarried(bot)) throw new Error('No bed carried for the nook');
    const nook = bedNook(bot, goal, { sealed: !!pocket });
    if (!nook) throw new Error('No room beside me for a bed nook');
    const wall = pocket ? nook.dig.filter(p => shelter.shell(pos(pocket.origin)).some(s => s.equals(p))) : [];
    this.report(goal, save, { action: 'bed_nook', at: { ...nook.foot }, dig: nook.dig.length, enclosed: nook.enclosed });
    try {
      for (const p of nook.dig) { task.check(); await this.actions.dig(bot, task, p, { requireDrops: false }); }
      const blocked = [nook.foot, nook.foot.offset(0, 1, 0), nook.head, nook.head.offset(0, 1, 0)].find(p => bot.blockAt(p)?.boundingBox !== 'empty');
      if (blocked) throw new Error(`The bed nook would not open at ${blocked}`);
      await this.sleepStep(task, goal, save, { site: nook });
    } catch (err) {
      task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      // A refused sleep is already waited out (sleepStep); anything else
      // that failed here rests the nook, so it is not offered again at once.
      if (!sleepWaiting(this)) { setAside(this, 'bed_nook', 'here', err, 180000); save(); }
      throw err;
    } finally {
      if (wall.length) await this.closeNook(task, nook, wall);
    }
  }

  // The pocket's wall put back where the nook was dug out of it.
  async closeNook(task, nook, wall) {
    const bot = this.bot;
    try {
      // The walk back to the stand may fail; the wall goes back from where
      // the bot stands all the same, or the pocket is left open: mid-243-m's
      // walk failed, the wall was never put back, and it was out among a
      // spider and a skeleton a moment later (the Fable advice on note 422).
      if (!feetCell(bot).equals(nook.stand)) {
        try { await this.actions.navigate(bot, task, new goals.GoalBlock(nook.stand.x, nook.stand.y, nook.stand.z), { timeoutMs: 8000, stallMs: 3000 }); }
        catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
      for (const p of [...wall].sort((a, b) => a.y - b.y)) {
        if (bot.blockAt(p)?.boundingBox !== 'empty' || isBed(bot.blockAt(p))) continue;
        const material = shelter.buildingItem(bot)?.name;
        if (!material) break;
        try { await this.actions.place(bot, task, p, material); }
        catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
      }
    } catch (err) { if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
  }

  // Ticks awake since the last sleep, counted from the first time the bot
  // looked if it has never slept. Two in-game days is the limit.
  // The night's hunt: one option for each kind of mob about whose drops are
  // worth something, with what it drops, what that is for, what one costs
  // to kill with this weapon and armour, and what a death would drop. Jev's
  // to weigh against a pocket, a mine or the bed.
  huntOptions(goal) {
    const bot = this.bot;
    if (bot.game?.dimension !== 'overworld' && !/overworld/.test(String(bot.game?.dimension || ''))) return {};
    const { MOB_DROPS } = require('./mob-drops');
    const here = bot.entity.position;
    const kinds = new Map();
    for (const e of Object.values(bot.entities || {})) {
      if (!MOB_DROPS[e.name] || e.isValid === false || !e.position) continue;
      const distance = e.position.distanceTo(here);
      if (distance > 32 || isSetAside(this, 'night_hunt', e.name)) continue;
      const kind = kinds.get(e.name) || { count: 0, nearest: null };
      kind.count++;
      if (!kind.nearest || distance < kind.nearest.distance) kind.nearest = { entity: e, distance };
      kinds.set(e.name, kind);
    }
    const weapon = defenseWeapon(bot)?.name || null, armour = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
    const risk = this.atRisk(goal);
    const options = {};
    for (const [name, kind] of kinds) {
      const drops = MOB_DROPS[name], label = name.replaceAll('_', ' ');
      const one = fightEstimate({ threats: [{ name, distance: kind.nearest.distance, shoots: shooter(kind.nearest.entity), ...(kind.nearest.entity.heldItem?.name ? { held: kind.nearest.entity.heldItem.name } : {}), visible: true }], armour, weapon, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
      // What else is out there, where it is, and whether health comes back
      // (the decision audit, 2026-09-25): mid-110-c took the spider hunt
      // into a cave with a witch, three skeletons and three creepers, told
      // only "others met on the way fought as they come".
      const others = threats(bot, 32).filter(t => t.entity.name !== name);
      const crowd = others.length ? ` Also within thirty-two blocks: ${others.length} other hostile mob${others.length === 1 ? '' : 's'} (${[...new Set(others.map(t => t.entity.name.replaceAll('_', ' ')))].slice(0, 5).join(', ')}${others.some(t => t.entity.name === 'creeper') ? '; creepers among them' : ''}${others.some(t => shooter(t.entity)) ? '; shooters among them' : ''}).` : '';
      const dy = Math.round(kind.nearest.entity.position.y - here.y);
      const where = Math.abs(dy) >= 6 ? ` The nearest is ${Math.abs(dy)} blocks ${dy > 0 ? 'up' : 'down'}.` : '';
      const healing = (bot.food ?? 20) >= 18 ? '' : ` Health does not come back meanwhile: hunger ${bot.food}, below eighteen.`;
      // Counted in the figures where it goes off (combat-estimate.js
      // creeperFought, note 529), and said why.
      const blast = name === 'creeper' && one.creeper ? ` ${one.creeper.replace(/^counted: /, '')}` : '';
      options[`hunt_${name}`] = {
        description: `Go out and hunt the ${label}${kind.count > 1 ? `s (${kind.count} within thirty-two blocks, nearest ${Math.round(kind.nearest.distance)})` : ` ${Math.round(kind.nearest.distance)} blocks off`} for two minutes, others met on the way fought as they come, and pick up what they drop: ${drops.drops} (${drops.for}), and experience. One ${label} with ${weapon ? `the ${weapon.replaceAll('_', ' ')}` : 'bare hands'}${armour.length ? ` and ${armour.length} piece${armour.length === 1 ? "" : "s"} of armour` : ' and no armour'}: about ${one.seconds} seconds and ${one.damageTaken} damage, from ${Math.round(bot.health)} health. ${risk}${blast}${crowd}${where}${healing}`,
        kind: name };
    }
    return options;
  }

  // What a death now would cost, for every choice that risks one: the gear
  // and valuables that would drop where the bot falls, the walk back to
  // them from where it would respawn before they vanish, and the levels.
  deathCost(goal) { return require('./risk').deathCost(this.bot, goal, this.state); }
  // The same, said in a sentence with an option.
  atRisk(goal) {
    const cost = this.deathCost(goal);
    const listed = [...cost.dropsWorn, ...cost.dropsGear, ...Object.entries(cost.dropsValuables).map(([n, c]) => `${c} ${n}`)].join(', ');
    return `A death drops everything carried where it happens${listed ? ` (${listed})` : ''}, ${cost.walkBackBlocks != null ? `${cost.walkBackBlocks} blocks from where the bot would respawn` : 'far from where the bot would respawn'}, and it vanishes in five minutes${cost.stashChestBlocks != null ? `; the stash chest is ${cost.stashChestBlocks} blocks off` : '; there is no stash chest'}.`;
  }

  // The valuables into the stash chest first, when there is one and
  // something worth putting in it.
  // Out of reach of home, a chest put down here instead (field-cache.js).
  cacheOption(goal) {
    const bot = this.bot;
    if (typeof this.actions.cacheHere !== 'function') return null;
    const offer = require('./field-cache').cacheOffer(bot, goal);
    if (!offer) return null;
    return { description: `Put ${offer.chest} down here and leave the valuables in it (${offer.what}): home's chest is out of reach, and a death tonight would drop them. They are taken back passing by.${require('./strategy').pickaxeLeft(bot, offer.spends)}`,
      run: async (task, goal, save) => { await this.actions.cacheHere(bot, task, goal, save, 'the night'); return true; } };
  }

  stashOption(goal) {
    const bot = this.bot;
    const stash = homeOf(bot, goal)?.stash?.position;
    if (!stash || typeof this.actions.stashTrip !== 'function' || isSetAside(this, 'night_stash', 'chest')) return null;
    const { VALUABLES } = require('./home-stash');
    const carried = bot.inventory.items().filter(i => Object.hasOwn(VALUABLES, i.name));
    if (!carried.length) return null;
    const far = Math.round(pos(stash).distanceTo(bot.entity.position));
    if (far > 128) return null;
    // The walk's time and the dark on the way (the decision audit,
    // 2026-09-25).
    const dark = require('./day').dark(bot) ? ' It is dark: mobs spawn along the way.' : '';
    return { description: `Walk ${far} blocks to the stash chest and put the valuables carried in it (${carried.map(i => `${i.count} ${i.name.replaceAll('_', ' ')}`).join(', ')}), so a death later tonight does not drop them. About ${Math.round(far / 4.3)} seconds each way at a walk.${dark}`,
      run: async (task, goal, save) => {
        try { await this.actions.stashTrip(bot, task, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'night_stash', 'chest', err, 300000); }
        return true;
      } };
  }

  // A hunt for food Jev chose, carried out as the night hunt is (huntStep):
  // the nearest of the kind closed on and struck, its drops picked up, for
  // two minutes or six health. The Nether's hoglins (nether-travel.js):
  // mid-211-c, short of food 250 blocks from its portal, was never offered
  // them (note 241, 2026-09-26).
  foodHunt(goal, save, kind, { method = 'walk' } = {}) {
    this.state.nightPlan = { plan: 'hunt', kind, food: true, method, until: Date.now() + 120000, startHealth: this.bot.health,
      meatAtStart: countOf(this.bot, 'porkchop') + countOf(this.bot, 'cooked_porkchop') };
    this.report(goal, save, { action: 'food_hunt_chosen', kind, method });
  }

  // Food off the Overworld: back through the portal, or, in the Nether,
  // its hoglins, in view or seen earlier. The trip back is said with its
  // walk, what it crosses and the food known on the other side, and it is
  // offered while Jev's choice to go on without it holds too, said with
  // when and at what health that was chosen: mid-242-ba-fortress-1 kept on
  // at 10.1 health, was sealed in at 2.2 forty seconds later, and was
  // offered only a hoglin 123 blocks off (note 607).
  offWorldFood(task, goal, save) {
    const bot = this.bot, children = {};
    const trip = (() => { try { return ` ${require('./game-progress').portalTrip(bot, goal)}`; } catch (_) { return ''; } })();
    const there = (() => { try { const s = require('./healing').overworldFoodSays(bot, goal); return s ? ` ${s}` : ''; } catch (_) { return ''; } })();
    const keptOn = require('./nether-travel').keepOnSays(bot, goal);
    // Not offered where its walk cannot begin from here (mob-hunt.js
    // tripHomeClosed): 25588 chose it eight times at 0.2 health, each run
    // ending "cannot be reached from here" (note 706). The bastion's chests
    // are a way to food here too (nether-food.js foodRoutes).
    let closed = null; try { closed = require('./mob-hunt').tripHomeClosed(bot, goal); } catch (_) { closed = null; }
    if (!closed) children.return_for_food = { description: 'Go back through the portal to the Overworld, where food can be hunted and cooked.' + (/nether/.test(String(bot.game?.dimension || '')) ? ' In the Nether hoglins are the only meat.' : ' Nothing here is safe to eat.') + trip + there + keptOn,
      run: async () => { require('./nether-travel').chooseReturnForFood(goal); goal.survivalAction = { action: 'return_for_food', at: new Date().toISOString() }; save(); await this.actions.returnOverworld(bot, task, goal, save); } };
    if (/nether/.test(String(bot.game?.dimension || ''))) {
      const { hoglinsKnown, hoglinSays } = require('./nether-travel');
      const known = hoglinsKnown(bot, goal);
      if (known.inView.length || known.seen.length) children.hoglin_food = { description: hoglinSays(bot, known),
        run: () => require('./nether-food').huntHoglin(bot, task, goal, save, known, { navigate: this.actions.navigate, survival: this, method: 'walk' }) };
      let raid = null; try { raid = require('./bastion-raid').foodRoute(bot, goal, { navigate: this.actions.navigate, loot: this.actions.loot }); } catch (_) { raid = null; }
      if (raid) children.raid_bastion = { description: raid.description, run: () => raid.run(task, save) };
    }
    return children;
  }

  // One step of the night hunt Jev chose: the nearest of the kind, closed
  // on over level ground and struck; its drops picked up once it is down.
  // Two minutes, then Jev is asked again with the night as it is by then;
  // six health lost hands back sooner.
  async huntStep(task, goal, save) {
    const bot = this.bot, plan = this.state.nightPlan;
    const { MOB_DROPS } = require('./mob-drops');
    const drops = MOB_DROPS[plan.kind];
    const end = why => { this.report(goal, save, { action: 'hunt_over', kind: plan.kind, kills: plan.kills || 0, why }); require('./nether-food').noteHunt(bot, goal, plan, why); delete this.state.nightPlan; delete bot._nightHunt; save(); return false; };
    if (!drops) return end('nothing known of it');
    if ((bot.health ?? 20) <= (plan.startHealth ?? 20) - 6) return end('six health lost');
    // The last one is down: what it dropped, before the next.
    const last = plan.targetId != null && bot.entities[plan.targetId];
    if (plan.targetId != null && (!last || last.isValid === false)) {
      plan.kills = (plan.kills || 0) + 1;
      const origin = plan.lastAt ? pos(plan.lastAt) : bot.entity.position.clone();
      delete plan.targetId;
      const { collectNearbyDrops } = require('./drop-collection');
      for (const item of drops.items) {
        try { await collectNearbyDrops(bot, task, item, { origin, radius: 8, timeoutMs: 4000, move: this.actions.navigate }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
      }
      save(); return true;
    }
    const here = bot.entity.position;
    const target = Object.values(bot.entities).filter(e => e.name === plan.kind && e.isValid !== false && e.position && e.position.distanceTo(here) <= 32 && !(plan.skip || []).includes(e.id))
      .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here))[0];
    if (!target) return end(`no ${plan.kind.replaceAll('_', ' ')} within thirty-two blocks`);
    bot._nightHunt = { name: plan.kind, until: plan.until };
    plan.targetId = target.id; plan.lastAt = { x: target.position.x, y: target.position.y, z: target.position.z };
    this.report(goal, save, { action: 'night_hunt', target: plan.kind, distance: Number(target.position.distanceTo(here).toFixed(1)), kills: plan.kills || 0, health: bot.health });
    // From a pillar, for a hoglin (nether-food.js): stood up two blocks
    // where its blow does not reach, and struck from there.
    if (plan.method === 'pillar' && plan.kind === 'hoglin' && plan.food) {
      const step = await require('./nether-food').pillarHuntStep({ bot, sleep, canStrike, onPillar: () => onPillarTop(bot, this.state.pillar), why: () => this.state.stanceWhy,
        pillarFrom: danger => this.pillarFrom(task, goal, save, danger), defend: () => defendNearby(bot, task, goal, save),
        approach: async (mob, within) => {
          const movements = bot.pathfinder?.movements, kept = movements && { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers };
          if (movements) Object.assign(movements, { canDig: false, allow1by1towers: false });
          try { await this.actions.navigate(bot, task, new goals.GoalFollow(mob, within - 2), { timeoutMs: 4000, stallMs: 2000, stopWhen: () => mob.isValid === false || mob.position.distanceTo(bot.entity.position) <= within }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { if (movements) Object.assign(movements, kept); }
        } }, plan, target);
      if (step.end) return end(step.end);
      save(); return true;
    }
    if (canStrike(bot, target)) {
      // Not turned to on a one-wide span over a drop (terrain.js onSpan).
      if (require('./terrain').onSpan(bot)) { await sleep(100); return true; }
      await bot.lookAt(target.position.offset(0, (target.height || 1.8) / 2, 0), true);
      if (!(await defendNearby(bot, task, goal, save))) await sleep(100);
      return true;
    }
    // Closed on without digging or towering: a mob that cannot be walked to
    // is left for another after three tries.
    const movements = bot.pathfinder?.movements;
    const kept = movements && { canDig: movements.canDig, allow1by1towers: movements.allow1by1towers };
    if (movements) Object.assign(movements, { canDig: false, allow1by1towers: false });
    const before = target.position.distanceTo(here);
    try { await this.actions.navigate(bot, task, new goals.GoalFollow(target, 1.5), { timeoutMs: 4000, stallMs: 2000, stopWhen: () => canStrike(bot, target) || target.isValid === false }); }
    catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
    finally { if (movements) Object.assign(movements, kept); }
    if (target.isValid !== false && target.position.distanceTo(bot.entity.position) >= before - 0.5 && !canStrike(bot, target)) {
      plan.misses = { ...(plan.misses || {}), [target.id]: (plan.misses?.[target.id] || 0) + 1 };
      if (plan.misses[target.id] >= 3) { plan.skip = [...(plan.skip || []), target.id]; delete plan.targetId; }
    }
    return true;
  }

  sleepDebt() {
    const age = worldAge(this.bot);
    if (!Number.isFinite(age)) return false;
    this.state.sleptAtAge ??= age;
    return age - this.state.sleptAtAge > SLEEP_DEBT_TICKS;
  }

  // A night in a pocket was a night standing still: eleven minutes behind a
  // wall, every night nothing better was on offer. It is spent the way a
  // player spends it, digging a mine out of the shelter: toward ore in
  // view of the rock, or down and along a branch, one staircase step a
  // tick. Rock around a tunnel is the shelter's wall. A bed that can be
  // slept in comes first, a mob that shows is the survival layer's as
  // ever, and at dawn the mine is left for the day's work.
  canNightMine(goal) {
    const bot = this.bot;
    if (bot.game?.dimension !== 'overworld' || !shelterNeeded(bot) || bot.game.difficulty === 'peaceful') return false;
    // Health is Jev's to weigh (riskNow, deathWouldCost), not a floor here:
    // trial 34 sat a night in a pocket at seven health with nothing to eat,
    // Jev choosing the mine every five seconds and this refusing it.
    if (immediateThreat(bot)) return false;
    // Not with anything watching: the same test the pocket uses to stay shut.
    if (threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity))) return false;
    if (!bot.inventory.items().some(i => /_pickaxe$/.test(i.name)) && !pickaxeCraftable(bot)) return false;
    // A bed defers the mine only when the night is to be slept: with the
    // plan made for a shelter (the bed in view out of reach, or none
    // carried), a bed within sight kept the mine shut and the bot waited
    // eleven minutes of the second audited night.
    const sleeping = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan.plan !== 'shelter' : true;
    if (sleeping && sleepable(bot) && !sleepWaiting(this) && (bedCarried(bot) || bedToSleepIn(bot, goal))) return false;
    // A mine that would not dig a block is not a way to spend the night.
    if (this.nightMineOff()) return false;
    return true;
  }

  // Why the night mine would not dig from here, or null when it would: the
  // best pickaxe already under the uses kept for a dug climb out, and no
  // spare to be made from what is carried (nightMine keeps them). It was
  // offered all the same, said as "the mine stops when it gets down to
  // that", and chosen, and each pick sat the bot in its pocket: mid-220-h
  // chose the mine some 330 times, five seconds apart, at 48 uses of 52
  // kept, 99 of 110, 120 of 124, and waited out the nights (note 531).
  nightMineOff() {
    const bot = this.bot;
    const picks = bot.inventory.items().filter(i => /_pickaxe$/.test(i.name));
    // As nightMine keeps them: only where a pickaxe can be made at all.
    if (!picks.length || !this.actions.acquireStep) return null;
    const best = Math.max(0, ...picks.map(i => remainingUses(bot, i)));
    const keep = usesToClimbOut(bot);
    if (best >= keep) return null;
    const make = pickaxeCraftable(bot);
    if (make && !isSetAside(this, 'night_pickaxe', make)) return null;
    const r = pickaxeReserve(bot, feetCell(bot));
    const spare = make ? `the ${make.replaceAll('_', ' ')} it could make is set aside after a failed try` : `no spare can be made from what is carried (${r.sticksAvailable} sticks' worth of wood; a pickaxe is two sticks and three cobblestone or iron ingots, at a table)`;
    return `the best pickaxe has ${best} uses left, under the ${keep} kept for a dug climb out from here${r.blocksToOpenSky ? ` (${r.blocksToOpenSky} blocks of rock and ground overhead)` : ''}, and ${spare}: the mine would not dig a block`;
  }

  // Which ore the night mine goes for, or a branch deeper: Jev's, with each
  // kind's distance, what is carried and what it is for.
  async nightTarget(task, goal, save, feet) {
    const bot = this.bot;
    const choices = nightOreChoices(bot, feet, attemptsFor(this));
    // The tunnel behind, dark enough for monsters: a torch is Jev's option
    // (never a rule's).
    const dark = countOf(bot, 'torch') ? darkCells(bot, groundCells(bot, feet, 3)).filter(c => !c.equals(feet)) : [];
    const place = this.placeAbout(goal, { at: feet });
    if (!choices.length && !dark.length && !place?.spawner && !place?.structures.length) return null;
    // Where each ore lies and what is beside it, and where a branch goes
    // (the decision audit, 2026-09-25): an ore in a cave wall opens the
    // tunnel onto the cave's mobs, and lava two blocks off is one misstep.
    // Ore touching water or lava is not in the list: the staircase will not
    // open a cell onto a liquid, so it cannot be reached at all.
    const around = (q, r, re) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) if (re.test(bot.blockAt(q.offset(dx, dy, dz))?.name || '')) return true; return false; };
    const oreFacts = q => {
      const dy = q.y - feet.y;
      const open = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([x, y, z]) => /^(air|cave_air)$/.test(bot.blockAt(q.offset(x, y, z))?.name || ''));
      return ` ${dy ? `${Math.abs(dy)} block${Math.abs(dy) === 1 ? '' : 's'} ${dy > 0 ? 'up' : 'down'}` : 'level with the feet'}.${open ? ' It is in the wall of an open space: digging to it opens the tunnel onto whatever is in there.' : ''}${around(q, 2, /^lava$/) ? ' Lava within two blocks of it.' : ''}${around(q, 2, /^water$/) ? ' Water within two blocks of it.' : ''}`;
    };
    const tree = Object.fromEntries(choices.map((c, i) => { const [item, use] = ORE_YIELD[c.kind];
      return [`ore_${i}`, { description: `Dig to the ${c.name.replaceAll('_', ' ')} ${Math.round(c.position.distanceTo(feet))} blocks off (${countOf(bot, item)} ${item.replaceAll('_', ' ')} carried; ${use}).${oreFacts(c.position)}` }]; }));
    const branchY = Math.max(feet.y - 10, 16);
    tree.branch = { description: `Dig a branch down to a working depth and along it, looking for ore on the way: ${branchY < feet.y ? `down to y ${branchY}, ${feet.y - branchY} blocks below here` : branchY > feet.y ? `up to y ${branchY}, ${branchY - feet.y} blocks above here` : `level, at y ${branchY}`}, then twenty-four blocks along.` };
    if (dark.length) tree.light_tunnel = { description: `Put a torch in the tunnel here: ${dark.length} cells around the bot are dark enough for monsters to spawn in, and light stops them (${countOf(bot, 'torch')} torches carried).` };
    // What the place is, with each target, and a branch away from what makes
    // the mobs: mid-220-g's night mine was asked its target thirteen times
    // beside a dungeon it knew and answered none of these each time, the
    // one move it wanted, away, not on offer (note 476).
    if (place) {
      const source = place.spawner ? { at: place.spawner.at, what: 'the mob spawner', reach: SPAWNER_REACH } : place.structures[0] ? { at: place.structures[0].at, what: `the ${place.structures[0].kind}`, reach: STRUCTURE_REACH } : null;
      if (source) {
        const away = feet.offset(0.5, 0, 0.5).minus(source.at.offset(0.5, 0, 0.5));
        const heading = Math.abs(away.x) >= Math.abs(away.z) ? (away.x >= 0 ? 0 : 2) : (away.z >= 0 ? 1 : 3);
        const [dx, dz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][heading];
        const end = feet.offset(dx * 24, 0, dz * 24);
        const endFrom = Math.round(Math.hypot(end.x - source.at.x, end.z - source.at.z));
        tree.branch_away = { description: `Dig the branch ${['east', 'south', 'west', 'north'][heading]}, away from ${source.what}: ${branchY < feet.y ? `down to y ${branchY} and ` : ''}twenty-four blocks along, looking for ore on the way; its end is about ${endFrom} blocks across from it, ${endFrom > source.reach ? 'beyond' : 'still within'} the ${source.reach} blocks said of it here.`, heading };
      }
      for (const o of Object.values(tree)) o.description += place.says;
    }
    const decision = await this.decide(task, goal, save, { id: 'night_mine_target', tree: Object.fromEntries(Object.entries(tree).map(([k, o]) => [k, { description: o.description }])), context: {},
      state: { ...(place ? { place: place.state } : {}), timeOfDay: bot.time?.timeOfDay, feetY: feet.y, riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot), stillNeeded: require('./game-progress').rungsAhead(bot, goal, this.actions.planFor), pickaxe: bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => `${i.name} (${remainingUses(bot, i)} uses)`), afterThePickaxes: pickaxeReserve(bot, feet), freeSlots: bot.inventory.emptySlotCount?.() ?? null } });
    if (decision.stale) return null;
    const pick = decision.path.at(-1);
    if (pick === 'light_tunnel') {
      const placed = await placeTorches(bot, task, this.actions, [dark.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0]], { max: 1 });
      this.report(goal, save, { action: 'light_tunnel', placed, torches: countOf(bot, 'torch') });
      return { lit: true };
    }
    if (pick === 'branch_away') { const mine = this.state.nightMine; if (mine) mine.heading = tree.branch_away.heading; return null; }
    return pick === 'branch' ? null : choices[Number(pick.slice(4))] || null;
  }

  async nightMine(task, goal, save) {
    const bot = this.bot;
    if (!this.canNightMine(goal)) return false;
    // Ore dug with no free slot stays on the floor of the tunnel.
    if (bot.game?.gameMode !== 'creative' && !((bot.inventory.emptySlotCount?.() ?? 1) > 0) && !await makeRoom(bot, task, 'raw_iron', { goal })) return false;
    // A pickaxe about to go is replaced from the pockets before the next
    // step: the daytime spare rule never runs inside the mine, and the dream
    // run wore an iron pickaxe from twenty-two uses to none in eighteen
    // seconds with seventeen ingots and a crafting table carried, then
    // sealed itself in for the night with nothing to dig with.
    const best = Math.max(0, ...bot.inventory.items().filter(i => /_pickaxe$/.test(i.name)).map(i => remainingUses(bot, i)));
    if (best < usesToClimbOut(bot) && this.actions.acquireStep) {
      const make = pickaxeCraftable(bot);
      if (make && !isSetAside(this, 'night_pickaxe', make)) {
        this.report(goal, save, { action: 'craft_pickaxe', item: make, remaining: best });
        try { await this.actions.acquireStep(bot, task, make, countOf(bot, make) + 1, goal, save); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'night_pickaxe', make, err, 600000); }
        return true;
      }
      // No spare to be made: the last uses are kept for the way out and for
      // the morning, not spent on the night's ore. Trial 20 mined its only
      // stone pickaxe to nothing and could not dig out of its own shaft.
      return false;
    }
    const feet = feetCell(bot);
    const mine = this.state.nightMine ||= { startedAt: Date.now(), origin: { ...feet }, heading: Math.floor(Math.random() * 4), failures: 0, mined: 0 };
    // Boxed in: every heading refused (water or lava behind the rock on all
    // four sides) turned the mine in place fourteen hundred times at a
    // pocket among lava pools. The night is waited out instead.
    if (mine.boxedInUntil > Date.now()) return false;
    let target = mine.target && pos(mine.target);
    if (target && NIGHT_ORES.has(mine.targetOre) && bot.blockAt(target)?.name !== mine.targetOre) { target = null; delete mine.target; }
    if (target && !NIGHT_ORES.has(mine.targetOre) && target.distanceTo(bot.entity.position) < 2.5) target = null;
    if (!target) {
      // From a pocket on the surface, down into the rock first: an ore off to
      // the side was reached through the hillside, the pocket opened at every
      // step and was sealed again, three times, and the night was waited out.
      const atSurface = surfaceObserver(bot)(bot.entity.position);
      // Better still, the pocket itself goes down: a shaft into the rock and
      // a block over the head (shaftPocket), and the mine starts from there.
      // Every direction looks solid from inside a pocket (its own walls), so
      // no heading check tells the hillside from the hill.
      if (atSurface && !mine.sunkAt && await this.shaftPocket(task, goal, save)) { mine.sunkAt = Date.now(); save(); return true; }
      const ore = !atSurface && await this.nightTarget(task, goal, save, feet);
      if (ore?.lit) return true;
      if (ore) { target = ore.position; mine.targetOre = ore.name; }
      else {
        // No ore in reach of the eye: a branch, down to a working depth
        // and then along, in the mine's heading, and from the surface the
        // heading whose first steps are into solid ground.
        if (atSurface) {
          const solidAhead = h => { const [x, z] = [[1, 0], [0, 1], [-1, 0], [0, -1]][h % 4]; return [0, 1].every(dy => bot.blockAt(feet.offset(x, dy, z))?.boundingBox === 'block'); };
          for (let i = 0; i < 4 && !solidAhead(mine.heading); i++) mine.heading++;
        }
        const [dx, dz] = [[1, 0], [0, 1], [-1, 0], [0, -1]][mine.heading % 4];
        target = feet.offset(dx * 24, Math.max(-10, 16 - feet.y), dz * 24);
        if (target.y < feet.y - 10) target.y = feet.y - 10;
        mine.targetOre = 'branch';
      }
      mine.target = { x: target.x, y: target.y, z: target.z };
    }
    this.report(goal, save, { action: 'night_mine', target: { ...mine.target }, ore: mine.targetOre, mined: mine.mined });
    try {
      if (NIGHT_ORES.has(mine.targetOre) && target.distanceTo(bot.entity.position.offset(0, 1.6, 0)) <= 4.5) {
        const before = bot.inventory.items().length;
        await this.actions.dig(bot, task, target, { requireDrops: false });
        mine.mined++; delete mine.target; mine.failures = 0;
        // What fell is picked up on the next step into the cell.
        await sleep(300);
        if (bot.inventory.items().length === before) {
          const drop = Object.values(bot.entities).find(e => e.getDroppedItem?.() && e.position.distanceTo(target) < 2.5);
          if (drop) { try { await this.actions.navigate(bot, task, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5), { timeoutMs: 3000, stallMs: 1500 }); } catch (_) { task.check(); } }
        }
      } else {
        await tunnelStep(bot, task, mine, save, target, { dig: this.actions.dig, navigate: this.actions.navigate, strict: true });
        mine.failures = 0;
        // Steps that do not move the bot at all: the server kept putting the
        // blocks back (a client and server that disagree), every step wore
        // the pickaxe by two, and twelve looks was more than the pickaxe had.
        const at = feetCell(bot);
        const key = `${at.x},${at.y},${at.z}`;
        mine.still = mine.still?.key === key ? { key, steps: mine.still.steps + 1 } : { key, steps: 0 };
        // Rested like any other failure: marked recorded when nothing was,
        // the same ore was offered straight back and chosen fifteen times in
        // five seconds (trial 29).
        if (mine.still.steps >= 4) { mine.still = null; this.abandonTarget(mine, 'four steps without moving'); save(); return true; }
        // Steps that succeed without getting closer are a failure too: the
        // mine paced four blocks back and forth under a copper it could not
        // reach, every step a success, and never set it aside.
        const toward = watch(this, 'night_mine', target, bot.entity.position.distanceTo(target), { stallLooks: 12, restMs: 600000, why: 'twelve steps without getting closer' });
        if (toward.stalled) this.abandonTarget(mine, toward.reason, { recorded: true });
      }
    } catch (err) {
      task.check();
      if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
      mine.failures++; mine.lastError = err.message;
      // A filter that rules out every step toward the ore says so at once,
      // and so does no route to it at all: waiting for three failures first
      // (25589, note 735) asked night_mine_target for a new ore_0 as soon as
      // the target above it was abandoned, picked a fresh ore each of the
      // three times before it was, and never had a chance to rest the one
      // that had already said "no route" once.
      // A stalled walk toward it is let go the same way (note 742): 25597's
      // walk to an ore stalled twice (skills.js NavigationStall, "navigation
      // timed out without reaching new ground") and night_mine_target kept
      // flipping between ore_0 and ore_1, neither ever rested, because a
      // stall was not one of the failures counted here until three of them
      // had piled up on whichever ore was picked last.
      if (err.name === 'NoSafeWay' || err.name === 'NoRoute' || mine.failures >= 3 || /not gaining|navigation timed out/.test(err.message)) this.abandonTarget(mine, err.message);
    }
    save();
    return true;
  }

  // Set an ore aside for ten minutes and turn. Forgetting the target alone
  // chose the same nearest ore again, and the mine turned eighty times in
  // one place.
  abandonTarget(mine, why, { recorded = false } = {}) {
    if (NIGHT_ORES.has(mine.targetOre) && mine.target && !recorded) attemptsFor(this).fail('night_mine', mine.target, why, { restMs: 600000 });
    if (mine.target) unwatch(this, 'night_mine', mine.target);
    mine.lastAbandoned = { target: mine.target, why, at: new Date().toISOString() };
    // Boxed in is every heading refused, not every block of one vein: four
    // copper ores beside a lush cave were refused in a second, and the mine
    // sealed itself in for the night with a pickaxe and a stack of stone.
    // An unreachable ore is set aside above and the next look takes a
    // branch; only refused branches count toward boxed in.
    const branch = mine.targetOre === 'branch';
    if (branch) mine.heading++;
    delete mine.target; delete mine.tunnel; mine.failures = 0;
    if (!branch) return;
    const now = Date.now();
    mine.refusals = [...(mine.refusals || []).filter(r => now - r.at < 60000 && r.mined === mine.mined), { at: now, mined: mine.mined }];
    if (mine.refusals.length >= 4) { mine.boxedInUntil = now + 600000; mine.refusals = []; }
  }

  async wait(task, goal, save, reason = 'Waiting for daylight inside the verified shelter') {
    this.report(goal, save, { action: 'wait_in_shelter', reason });
    takeTurn(this.bot, 'survival', 'wait', reason);
    for (let i = 0; i < 50; i++) { task.check(); await sleep(100); }
  }

  // A survival action that fails is answered as a stall is: it rests three
  // minutes and the tick goes to the work. Thrown on into the loop it became
  // a persist, and the same branch ran again: trial 11's shaft pocket on a
  // sand island, five times (2026-09-24), as trial 9's shelter search before
  // it. Air, danger, cancellation and stalls go on up as always.
  async step(task, goal, save, onStep = () => {}) {
    try {
      const acted = await this.stepOnce(task, goal, save, onStep);
      // A pass that leaves a threat at hand unanswered is not done: the work
      // loop then arms the threat check for the same mob and every step
      // after throws on it (the Fable advice on note 430). The encounter's
      // own question answers it.
      if (!acted && !this._answeringSetAside && immediateThreat(this.bot)) return this.answerWhileSetAside(task, goal, save, onStep, new Error('the survival step returned with a threat at hand'));
      return acted;
    }
    catch (err) {
      // An answer set aside is no answer to a mob that is hitting the bot:
      // the encounter's own question comes instead. Returned as "nothing to
      // do", the turn went to vitals throwing "Threat nearby" every few
      // milliseconds while mid-244-t's skeleton shot it from two blocks,
      // twenty seconds, 9.6 to none, its seal spinning and set aside by
      // turns (note 431); mid-242-o's span hold the same (note 420).
      if (err.name === 'SetAside') return this.answerWhileSetAside(task, goal, save, onStep, err);
      if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Stalled'].includes(err.name)) throw err;
      const recent = goal.survivalAction, name = recent?.action;
      // A walk of survival's own that found no route stays survival's,
      // an emergency's too: rethrown, the work took it for its own step.
      // mid-202-o-nether-2's escape, the last report an eat, threw "No
      // route" to a cell two blocks under its own pocket's floor, and the
      // work persisted it twelve times in twenty-eight seconds, nothing
      // named, while health went from 18 to 4.8 (note 500). It is a fact
      // on the claim (setAside) and on the next stance question.
      if (err.name === 'NoRoute') {
        const says = noRouteSays(err, `a survival walk${name ? ` (the last action reported: ${name.replaceAll('_', ' ')})` : ''}`);
        this.state.walkFailed = { says, at: Date.now(), ...(err.destination ? { destination: err.destination } : {}) };
        // Rested as any failure of the action is; an emergency's rest refuses
        // nothing (report), and is only the fact.
        setAside(this, 'act', `survival:${name || 'walk'}`, says, name && !EMERGENCIES.has(name) && !HOLDS.has(name) ? 180000 : 10000); save();
        console.log(`[survival] ${says}`);
        return false;
      }
      if (!name || EMERGENCIES.has(name) || Date.now() - Date.parse(recent.at || 0) > 60000) throw err;
      // A hold that failed (the swing's walk timing out) rests ten seconds,
      // not three minutes: mid-211-q's defend failed once on "took too long
      // to decide path", rested three minutes, and a skeleton a block and a
      // half off shot it from 15.7 to none with no swing (note 445).
      const rest = HOLDS.has(name) ? 10000 : 180000;
      setAside(this, 'act', `survival:${name}`, err.message, rest); save();
      console.log(`[survival] ${name} failed and rests ${rest === 10000 ? 'ten seconds' : 'three minutes'}: ${err.message}`);
      return false;
    }
  }

  async answerWhileSetAside(task, goal, save, onStep, err) {
    const bot = this.bot;
    const hurt = (bot._hurtTimes || []).some(t => Date.now() - t < 4000);
    const close = threats(bot, 8).some(t => t.visible || t.distance <= 3) || !!immediateThreat(bot);
    if ((!hurt && !close) || this._answeringSetAside) return false;
    this._answeringSetAside = true;
    try {
      console.log(`[survival] ${err.message}; answering the mob instead`);
      await this.flee(task, goal, save);
      onStep(goal); return true;
    } catch (inner) {
      if (inner.name === 'SetAside') return false;
      throw inner;
    } finally { this._answeringSetAside = false; }
  }

  // The ways out of lava the code can carry out from here, for body_way:
  // the old rule's way first (the body's safety rule), each with where it goes and its
  // seconds. The old rule: the nearest cell out, water or dry (water puts
  // the fire out); a pillar where that cell is out of a jump's reach and
  // blocks are carried; with no cell, back toward the last dry footing; with
  // none known, up.
  lavaWays(task, goal, save) {
    const bot = this.bot;
    const feet = feetCell(bot), feetY = feet.y;
    const isWater = c => [c, c.offset(0, 1, 0)].some(p => bot.blockAt(p)?.name === 'water');
    const exit = lavaExit(bot, 6, { water: true });
    const wet = exit && isWater(exit) ? exit : null;
    const dry = exit && !wet ? exit : lavaExit(bot, 6, { dryOnly: true });
    const { SCAFFOLD } = require('./pillar-recovery');
    const scaffold = bot.inventory.items().filter(i => SCAFFOLD.includes(i.name)).reduce((n, i) => n + i.count, 0);
    // Of this dimension; one kept before the dimension was recorded counts.
    const last = this.state.lastDry && (!this.state.lastDry.dimension || String(this.state.lastDry.dimension) === String(bot.game?.dimension || '')) ? pos(this.state.lastDry) : null;
    const round = n => Math.round(n * 10) / 10;
    // By the way through the lava (lavaRoutes), not the straight line.
    const routes = lavaRoutes(bot, feet, 8);
    const routed = c => routes.get(`${c.x},${c.y},${c.z}`);
    const far = c => round(routed(c) ? routed(c).blocks : c.offset(0.5, 0, 0.5).distanceTo(bot.entity.position));
    // What a swim reaches: a cell whose floor is no higher than the lava's
    // top (lavaTop, note 592).
    const top = lavaTop(bot), reach = swimReach(feet, top);
    const swims = c => c.y <= reach;
    // Across at the lava's drag, and up as it goes, jump held: the longer.
    const rise = c => Math.max(0, c.y - bot.entity.position.y);
    const seconds = c => Math.max(0.5, round(Math.max(far(c) / LAVA_BLOCKS_A_SECOND, rise(c) / LAVA_JUMP_RISE)));
    const lavaBy = c => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => [0, 1].some(dy => /lava/.test(bot.blockAt(c.offset(x, dy, z))?.name || '')));
    const height = c => !swims(c)
      ? `, its floor ${top !== null ? `${c.y - top - 1} above the lava's top (y ${top + 1})` : `${c.y - feetY - 1} above the feet`}: a body in lava rises no higher than about half a block over the lava's top, even pressed against a wall, so a swim does not climb onto it`
      : c.y - feetY >= 1 ? `, ${c.y - feetY} up, its floor no higher than the lava's top (swum up to)` : '';
    const where = c => `${far(c)} blocks off ${routed(c) ? 'by the way through' : 'in a straight line'} at (${c.x}, ${c.y}, ${c.z})${height(c)}` +
      `${lavaBy(c) ? `, lava beside it (${lavaSpreads(bot)}, so it may be lava by the time the body gets there)` : ''}${besideDrop(bot, c) ? ', beside a drop' : ''}`;
    // What the seconds in the lava cost this body: the lava's rate through
    // the armor worn (body.js lasts), and the burning it sets after
    // (terrain.js lavaTouch). The ways were said in seconds only, and Jev
    // was left to set them against "about 4.3 seconds to death" itself
    // (mid-243-af-nether-1, note 592).
    const hp = round(bot.health ?? 20);
    const costs = s => {
      const rate = require('./body').lasts(bot, 'lava').losesPerSecond;
      if (!rate) return 'fire resistance on the body: the lava does not hurt while it lasts';
      const inIt = round(s * rate), touch = require('./terrain').lavaTouch(bot), after = touch.burn;
      if (inIt >= hp) return `about ${inIt} health in the lava at ${rate} a second, more than the ${hp} the bot has: death before it is out`;
      const all = round(inIt + after);
      return `about ${inIt} health in the lava at ${rate} a second${after ? `, then up to ${after} burning after it (${touch.nether ? 'no water to put it out in the Nether' : 'no water carried to put it out'})` : ''}: about ${all} in all, ${all >= hp ? `more than the ${hp} health the bot has unless it heals on the way` : `of the ${hp} health the bot has`}`;
    };
    const said = (c, lead) => `${lead} ${where(c)}: about ${seconds(c)} seconds at the ${LAVA_BLOCKS_A_SECOND} blocks a second a body swims through lava (the game's lava drag)${rise(c) >= 1 ? `, rising about ${LAVA_JUMP_RISE} a second as it goes` : ''}; ${costs(seconds(c))}.`;
    const report = (way, to) => this.report(goal, save, { action: 'leave_lava', way, to: to && { x: to.x, y: to.y, z: to.z }, health: bot.health });
    // The walk out, as the old rule walked it. Out of the lava and over the
    // cell chosen is out: the keys held after that carried mid-235-a on past
    // it, upright, and off the ledge it stood on (2026-09-26). Out into water
    // is out, too: the water puts the fire out and holds the body, and jump
    // held there swims. mid-237-j left the lava into a waterfall's foot and
    // swam six blocks up it on these keys, toward the lip it had fallen from
    // (note 518). With no cell, never stand: the step with nothing to do
    // returned at once, a thousand times in four seconds, while the bot
    // burned.
    // Cell by cell along the way through, jumping as it goes: a straight
    // line to a cell round a corner swims into the rock (note 569). Each
    // cell is given the seconds a body takes to cross one in lava and a
    // second over; out of the lava ends it wherever it is.
    const out = to => !inLava(bot) && (bot.entity.onGround || bot.entity.isInWater || (to && feetCell(bot).x === to.x && feetCell(bot).z === to.z));
    const walk = async (to, why) => {
      const route = to ? routeOf(routes, to) : null;
      const points = route?.length ? route : [to];
      bot._leavingLava = true;
      try {
        for (let i = 0; i < points.length; i++) {
          const wp = points[i], last = i === points.length - 1;
          const toward = wp ? wp.offset(0.5, 1, 0.5) : null;
          const centre = () => wp && Math.hypot(bot.entity.position.x - (wp.x + 0.5), bot.entity.position.z - (wp.z + 0.5)) < 0.35;
          const done = await move(bot, task, { label: 'out_of_lava', keys: toward ? ['forward', 'jump'] : ['jump'], sneak: false, why, look: toward || undefined,
            maxMs: last && !route ? 2500 : Math.round(1000 / LAVA_BLOCKS_A_SECOND + 1000), tick: 50,
            until: () => out(to) || (!last && centre()) });
          if (out(to) || (!done && !last)) break;
        }
      } finally { bot._leavingLava = false; }
      return !inLava(bot);
    };
    const ways = {};
    const toCell = (key, c, lead, why) => { ways[key] = { description: said(c, lead), run: async () => { report(key, c); return walk(c, why); } }; };
    // Only where a swim gets out: a cell over the lava's top is the block's
    // (pillar_out below), not a swim that bobs against it (note 592).
    if (wet && swims(wet)) toCell('to_water', wet, 'Into the water', 'in lava: into the water, which puts the fire out');
    if (dry && swims(dry)) toCell('to_dry_ground', dry, 'Onto the dry cell', 'in lava: the nearest dry cell, whatever the ground');
    // Out of reach of a swim: up on a block put into the lava under the
    // feet, where the lava is, as a player gets out of the lava sea, and the
    // way on from there is the next question's. The pillar it was could not
    // start in lava (pillarUp stops with lava round the body and nothing
    // under it), so the way offered as "rise 2 ... about 1.5 seconds of
    // blocks" was the swim at the gravel, four seconds and death
    // (mid-243-af-nether-1, note 592).
    const high = exit && !swims(exit) ? exit : dry && !swims(dry) ? dry : null;
    const fill = scaffold ? lavaFill(bot, top) : null;
    if (fill) {
      const stand = fill.cell.offset(0, 1, 0);
      const s = Math.max(0.5, round(fill.wall / LAVA_BLOCKS_A_SECOND + Math.max(0, stand.y + 0.05 - bot.entity.position.y) / LAVA_WALL_RISE + 0.25));
      // The dry ground a step from the block, level or a block up.
      const room = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name); };
      const floorOf = c => { const b = bot.blockAt(c.offset(0, -1, 0)); return b?.boundingBox === 'block' && !/lava/.test(b.name) && !require('./terrain').hotFloor(b); };
      let onward = null;
      for (const dy of [0, 1]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = stand.offset(dx, dy, dz);
        if (!onward && floorOf(c) && room(c) && room(c.offset(0, 1, 0)) && (!dy || room(stand.offset(0, 2, 0)))) onward = c;
      }
      const on = onward ? `standing on it at the lava's top the body is out of the lava, and ${onward.y > stand.y ? 'a step up' : 'a step'} from it is dry ground at (${onward.x}, ${onward.y}, ${onward.z})`
        : `standing on it at the lava's top the body is out of the lava, with no dry ground a step from it${high ? ` (the nearest way out is ${where(high)})` : ''}`;
      ways.pillar_out = { description: `Press against the ${fill.ref.name.replaceAll('_', ' ')} at (${fill.ref.position.x}, ${fill.ref.position.y}, ${fill.ref.position.z}) holding jump, which lifts the body to the lava's top (the push out of a liquid against a wall), and put a block into the lava under the feet at (${fill.cell.x}, ${fill.cell.y}, ${fill.cell.z}) as they clear it: about ${s} seconds in the lava, ${costs(s)}; ${on}; ${scaffold} scaffold blocks carried.`,
        run: async () => {
          report('pillar_out', stand);
          bot._leavingLava = true;
          let placed = false;
          try { placed = await this.blockIntoLava(task, fill); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { bot._leavingLava = false; }
          return placed && !inLava(bot) ? true : walk(high, 'in lava: the block did not go in; toward the way out');
        } };
    }
    const lastLava = last && [last, last.offset(0, 1, 0)].some(p => /lava/.test(bot.blockAt(p)?.name || ''));
    // The footing may be gone: the gravel mid-243-af-nether-1 stood on went
    // into the lava with it, and "the last dry footing" was the open cell
    // over where it had been (note 592).
    const lastFloor = last && bot.blockAt(last.offset(0, -1, 0));
    const floorGone = !!lastFloor && lastFloor.boundingBox !== 'block';
    if (last) ways.back_the_way_came = { description: `Back toward the last dry footing stood on, ${far(last)} blocks off ${routed(last) ? 'by the way through' : 'in a straight line, no way through seen'} at (${last.x}, ${last.y}, ${last.z})${floorGone ? `; nothing is under it now (${/lava/.test(lastFloor.name) ? 'lava' : 'open air'} where it stood), so it is no footing` : height(last)}, swimming up as it goes: about ${seconds(last)} seconds at the ${LAVA_BLOCKS_A_SECOND} blocks a second a body swims through lava${lastLava ? `; it is lava now itself (${lavaSpreads(bot)})` : lavaBy(last) ? `; lava beside it (${lavaSpreads(bot)})` : ''}${far(last) > 6 ? '; farther than any cell out seen from here' : ''}; ${costs(seconds(last))}.`,
      run: async () => { report('back_the_way_came', last); return walk(last, 'in lava with no dry cell in sight: up, and back the way the bot came'); } };
    // Straight up to the lava's own top, said beside back_the_way_came, not
    // only where nothing else is offered at all: with no water, dry cell or
    // pillar within six blocks, back_the_way_came was the one way a body
    // deep in a lava sea was given, its own cost sometimes already saying
    // "death before it is out" (the costs() branch above), and up was never
    // said beside it to weigh. 25583 (mid-242-re, 2026-09-30 03:21:34-37Z)
    // and 25591 (mid-242-qh, 2026-09-30 04:27:56-59Z) each chose
    // back_the_way_came 13-14 blocks off after a fall into a lava sea and
    // died in the four to five seconds it took; a straight rise to the
    // lava's own top, a body already near, was never checked against it.
    // Said now with its own honest seconds, whenever no closer dry footing
    // is already known: a fact for Jev to weigh, not a hidden reflex.
    if (!ways.to_water && !ways.to_dry_ground && !ways.pillar_out) {
      const riseSeconds = Math.max(0.5, round(Math.max(0, reach - bot.entity.position.y) / LAVA_JUMP_RISE));
      ways.swim_up = { description: `Swim straight up to the lava's own top${top !== null ? ` (y ${top + 1})` : ''}, no cell out a swim reaches within six blocks and no dry footing known there yet: about ${riseSeconds} second${riseSeconds === 1 ? '' : 's'} to reach it; ${costs(riseSeconds)}.`,
        run: async () => { report('swim_up', null); return walk(null, "in lava with nothing dry in sight: up to the lava's own top first"); } };
    }
    const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple');
    if (apple) ways.eat_golden_apple = { description: `Eat the enchanted golden apple (${countOf(bot, apple.name)} carried): about ${EAT_SECONDS} seconds eating in the lava first, then fire resistance for five minutes (the lava and burning no longer hurt), sixteen extra health as absorption and strong regeneration; the way out still to take after.`,
      run: async () => { report('eat_golden_apple', null); return eatApple(bot, task, apple); } };
    // A fire resistance potion (note 656): a splash acts sooner than a drink.
    const potionWay = require('./fire-resistance').bodyWay(bot, task, 'the lava and burning do not hurt', () => report('drink_fire_resistance', null));
    if (potionWay) ways.drink_fire_resistance = { ...potionWay, run: async () => { const was = bot._leavingLava; bot._leavingLava = true; try { return await potionWay.run(); } finally { bot._leavingLava = was; } } };
    const first = ways.to_water ? 'to_water' : ways.to_dry_ground ? 'to_dry_ground' : ways.pillar_out ? 'pillar_out' : last ? 'back_the_way_came' : 'swim_up';
    return ways[first] ? { [first]: ways[first], ...ways } : ways;
  }

  // The block into the lava under the feet (lavaFill): pressed against the
  // block beside the cell, jump held, the push out of the lava lifts the
  // body; the moment the feet are over the cell's top the block goes in
  // under them, and the body stands on it at the lava's top. Tried until it
  // lands or four seconds pass. True when the block is there.
  async blockIntoLava(task, fill) {
    const bot = this.bot;
    const { SCAFFOLD } = require('./pillar-recovery');
    const item = bot.inventory.items().find(i => SCAFFOLD.includes(i.name));
    if (!item) return false;
    await bot.equip(item, 'hand'); task.check();
    const landed = () => bot.blockAt(fill.cell)?.boundingBox === 'block';
    const clear = () => bot.entity.position.y >= fill.cell.y + 1.02;
    const place = bot._placeBlockWithOptions ? () => bot._placeBlockWithOptions(fill.ref, fill.face, { swingArm: 'right', forceLook: true }) : () => bot.placeBlock(fill.ref, fill.face);
    const wall = fill.ref.position.offset(0.5, 0.5, 0.5);
    const until = Date.now() + 4000;
    while (!landed() && Date.now() < until) {
      task.check();
      await move(bot, task, { label: 'out_of_lava', keys: ['forward', 'jump'], sneak: false, why: 'in lava: pressed against the block beside, the push out of the lava lifts the body over the cell a block goes into', look: wall,
        maxMs: Math.max(100, until - Date.now()), tick: 25, until: clear });
      if (!clear()) break;
      try { await place(); } catch (err) { task.check(); }
    }
    for (let i = 0; i < 20 && landed() && !bot.entity.onGround; i++) { task.check(); await sleep(25); }
    return landed();
  }

  async stepOnce(task, goal, save, onStep) {
    const bot = this.bot;
    // The survival layer has the turn: what the watchdogs held for it is met.
    takeTurn(bot, 'survival', 'step');
    bot._airAbort = false; bot._threatAbort = false;
    goal.survival = this.state;
    task.interruptCheck = undefined;
    // A shield raised to cover the last shot comes down at the next look:
    // every branch below may walk, and a raised shield is sneaking speed.
    // Kept up where a shield stance stood behind it with a biter at arm's
    // length and nothing burns: the stance is asked again with the shield
    // still between them, and an answer that walks lowers it (note 683:
    // lowered here, each re-asking of shield_guard was the question's time
    // and a quarter second after it with no block, a blow in either landing
    // whole; on a scratch server, a guard asked again every 2.5 seconds took
    // 6 wither skeleton blows in five 20-second runs lowered, 1 kept up).
    if (!keepShieldForStance(bot)) lowerShield(bot);
    if (bot.game.gameMode === 'creative') {
      await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate);
      return false;
    }
    if (this.rememberHouse(goal.blueprint)) save();
    // Burning, out of the lava and the fire: the water, before anything a
    // mob asks. The douse is the vitals step's, and vitals had the turn only
    // when this layer had nothing to do: mid-235-m came out of a lava pool
    // at 6.6 health still alight, with a water bucket, and this layer rebuilt
    // its span's walls every tick while it burned to none (note 434).
    // The way out is Jev's (body_way, src/body.js): the douse, the water or
    // letting it burn, asked the moment the step meets it. Burning left to
    // burn out by Jev's choice is held (body.js held).
    if (!inLava(bot) && !require('./terrain').bodyInLava(bot)) {
      const vitals = require('./vitals');
      if ((bot.entity?.metadata?.[0] & 1) && !vitals.inFire(bot) && !require('./body').held(bot, 'fire')) {
        let acted = false;
        const ways = vitals.fireWays(bot, task, step => { acted = true; this.report(goal, save, { ...step, health: bot.health }); });
        const r = await require('./body').answer(bot, task, 'fire', ways, { client: this.client, goal, save, facts: { inFire: false } });
        if (acted || (r.acted && r.key !== 'burn_out')) { onStep(goal); return true; }
      }
    }
    if (inLava(bot)) {
      await require('./body').answer(bot, task, 'lava', this.lavaWays(task, goal, save), { client: this.client, goal, save });
      onStep(goal); return true;
    }
    // A bed the last bedtime left behind, when it is near and nothing is.
    if (this.state.bedLeft && await this.fetchLeftBed(task, goal, save)) { onStep(goal); return true; }
    // The last dry footing, for the way back out of lava.
    if (bot.entity.onGround && !bot.entity.isInWater) {
      const f = feetCell(bot);
      const last = this.state.lastDry;
      if (!last || last.x !== f.x || last.y !== f.y || last.z !== f.z) this.state.lastDry = { x: f.x, y: f.y, z: f.z, dimension: String(bot.game?.dimension || '') };
    }
    // A ghast in sight and a drop that ends the bot beside it: off the edge
    // first. Its fireball's blast throws a player, and mid-87-l, on a ledge
    // at y 74 over the lava sea on a fortress leg, was hit from thirty
    // blocks and thrown forty down into the lava (2026-09-26).
    // Any mob in sight among the threats about, as well: a magma cube came
    // down from eighteen blocks over mid-227-a, stood still on a ledge at
    // y 77 over the lava sea while its tunnel stalled, and the bot went over
    // the edge with it and fifty blocks into the lava (2026-09-26).
    const inReach = new Set(threats(bot).map(t => t.entity.id));
    const pusher = t => t.visible && (t.entity.name === 'ghast' || inReach.has(t.entity.id));
    // A fireball on its way pushes as its ghast does, the ghast in view or not.
    const fireball = () => require('./projectile-guard').incoming(bot, { reach: 24 }).some(e => /fireball/.test(e.name || ''));
    // Not off a stance that moves, nor off the bot's own pillar: flee's
    // copy of this rule has both guards (notes 218, 250), and this one had
    // neither (the decision review, 2026-09-26).
    const heldStance = stanceHeld(bot), ownPillar = this.state.pillar;
    const guarded = (heldStance && MOVING_STANCES.has(heldStance.choice)) ||
      onPillarTop(bot, ownPillar, 1);
    // With Jev reachable, the step off the edge is his: the stance question
    // offers it with its way, its seconds and the push's reach
    // (out_of_the_push and fight_from_footing), the ghast in sight among
    // the mobs it is asked about (encounterDanger). This walk is the
    // fallback. mid-242-bb-fortress-2's took it three times in forty
    // seconds to firm ground ten blocks along its path over the lava sea
    // and found no route each time, the pathfinder refusing the edge cells
    // while the ghast could push (note 612).
    if (!encounterJudgments(this) && !guarded &&!bot.entity?.isInWater && !inWater(bot) && !(this.state.edgeTriedAt > Date.now() - 10000) && (threats(bot, 64).some(pusher) || fireball())) {
      const { dropNear } = require('./terrain');
      // From the block the bot stands on, not the air it was knocked into:
      // mid-230-q, hit at a ravine's rim, measured and planned from the cell
      // over the drop, and the route's first move was a pillar there; it
      // fell fourteen blocks, 15.1 to 4.1 (note 466). As the stance does.
      for (let n = 0; n < 8 && bot.entity.onGround === false && !bot.entity.isInWater; n++) { task.check(); await sleep(100); }
      const deep = bot.entity.onGround === false ? null : dropNear(bot, feetCell(bot), 2);
      if ((deep && (deep.into === 'lava' || deep.damage >= (bot.health ?? 20) / 2)) || lavaBeside(bot, feetCell(bot))) {
        this.state.edgeTriedAt = Date.now();
        // With a creeper the pusher, the ground is away from it, and the walk
        // short: mid-230-m walked two seconds toward ground by the creeper,
        // stalled, and the blast took it from twenty (2026-09-27). With no
        // such ground the creeper is answered as a creeper, below.
        const creeper = threats(bot, 16).filter(t => t.entity.name === 'creeper').sort((a, b) => a.distance - b.distance)[0];
        const cell = creeper ? firmGround(bot, 8, { margin: 3, awayFrom: creeper.entity.position }) : firmGround(bot, 8, { margin: 3 });
        if (cell) {
          this.report(goal, save, { action: 'off_the_edge', to: { ...cell }, from: threats(bot, 64).find(pusher)?.entity.name, drop: deep });
          require('./terrain').holdOffEdge(bot, feetCell(bot), threats(bot, 64).map(t => t.entity));
          // A shot on its way stops the walk for the shield: at the edge its
          // knockback is the fall the walk is getting away from. mid-243-e's
          // walk from a forty-block edge had gone half a block in a second
          // and a half when a skeleton's arrow put it over (2026-09-27).
          const { incoming, deflect } = require('./projectile-guard');
          const shot = () => bot.inventory.slots?.[45]?.name === 'shield' && incoming(bot).length > 0;
          // A walk to ground: no tower up in place on the way, which at the
          // rim is a jump over the drop (mid-230-q).
          const movements = bot.pathfinder?.movements, towers = movements?.allow1by1towers;
          if (movements) movements.allow1by1towers = false;
          // Its own way's cells beside the drop taken, as an escape's are
          // (note 610): refused them while the ghast could push, mid-242-bb-
          // fortress-2's step off the edge found no route three times in
          // forty seconds (note 612).
          let way = null;
          try { way = require('./bunker').wayTo(bot, cell); } catch (_) { way = null; }
          const wayCells = new Set((way || []).map(c => `${c.x},${c.y},${c.z}`));
          const edgeTaken = wayCells.size ? { edgeTaken: n => wayCells.has(`${n.x},${n.y},${n.z}`) } : {};
          try { await this.actions.navigate(bot, task, new goals.GoalBlock(cell.x, cell.y, cell.z), creeper ? { timeoutMs: 2500, stallMs: 800, stopWhen: shot, ...edgeTaken } : { timeoutMs: 6000, stallMs: 2000, stopWhen: shot, ...edgeTaken }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; }
          finally { if (movements) movements.allow1by1towers = towers; }
          if (shot()) { this.state.edgeTriedAt = 0; await deflect(bot, task); }
          onStep(goal); return true;
        }
      }
    }
    await maintainVitals(bot, task, action => this.report(goal, save, action), { client: this.client, goal, save });
    // Still in a block: nothing else this turn, the dig out comes again at
    // once. mid-79-c went on to craft its spare pickaxe under the gravel.
    if (require('./vitals').headInBlock(bot)) { onStep(goal); return true; }
    // The mob hitting the bot comes first, before a bed, a pocket, a chore
    // or anything else: trial 7's bot lay down to sleep beside a zombie
    // villager and was hit five times trying, then walled itself in with it
    // (2026-09-24). A mob that does not shoot, at arm's length and in sight
    // or in reach of the sword, is the fight-or-flee rules' before anything.
    const atArm = threats(bot).filter(t => t.distance <= 3 && !shooter(t.entity) && (t.visible || canStrike(bot, t.entity)) && !nightHunted(bot, t.entity));
    if (atArm.length && !claimed(bot, atArm[0].entity)) { await this.flee(task, goal, save); onStep(goal); return true; }
    const refuge = this.currentShelter();
    // Or shut to walkers with only lava or water left open in its shell,
    // which no block goes into: the pocket as far as it closes (note 697).
    const shutOpen = refuge && shelter.inside(bot, refuge) && !shelter.sealed(bot, refuge) ? shelter.closedIn(bot, refuge) : null;
    const sealedIn = refuge && shelter.inside(bot, refuge) && (shelter.sealed(bot, refuge) || !!shutOpen);
    // The wait's own record goes with the pocket (pocket-wait.js, note 584).
    if (!sealedIn) require('./pocket-wait').leftPocket(this.state);
    if (sealedIn) {
      delete this.state.trappedSince;
      require('./pocket-wait').watchPocket(this.state, refuge, threats(bot, 24));
      // A mob behind twenty blocks of rock is not a reason to stay sealed in
      // past dawn: underground there is always one somewhere. Wait for the
      // ones that can see in, or are at the wall.
      // Cave mobs do not burn off at dawn. A mob that can see in keeps the
      // bot inside for a few minutes, not the whole day: after that it leaves
      // armed and lets the fight-or-flee rules take over.
      // Not the mob the hunt came for, once the bot is fit to fight it. At a
      // spawner the watchers never leave, so a pocket that waits for them
      // waits forever: healed and armed beside the blaze room, the bot sat
      // sealed in for ten minutes because the blazes were still there, which
      // was the reason it came.
      const watched = !shelterNeeded(bot) && threats(bot).some(t => t.distance < 20 && (t.visible || t.distance < 6) && !claimed(bot, t.entity));
      if (watched) this.state.watchedSince ||= Date.now(); else delete this.state.watchedSince;
      // Out after three minutes of it, but not hurt: at three health the
      // dream run left its pocket past a skeleton and was shot on the stairs
      // (2026-09-24). Below ten the pocket is where it heals, eating behind
      // the wall.
      const outwaited = watched && Date.now() - this.state.watchedSince > 180000 && (bot.health ?? 20) >= 10;
      // A sealed pocket within a walk of the base's bed is left for it: the
      // night passes in the bed, not behind the wall.
      // Only from a pocket on the surface: a walk to the bed from a pocket
      // down a shaft fails, and the night is better spent behind the wall.
      // From the surface, or from a pocket within ten blocks of the bed's
      // level (the stairs' last stretch): open the pocket and let the
      // go-home rule climb and walk. From deep down, the night is better
      // spent behind the wall.
      // Leaving a pocket for a bed the bot just failed to reach is the start
      // of a loop: out, a two-minute walk in the dark, a new pocket, and two
      // minutes later out again, all night. From a pocket, a failed route
      // waits ten minutes like a failed sleep does.
      const homeBed = sleepable(bot) && !sleepWaiting(this) && !failedWithin(this, 'bed_route', 'home', 600000) && bedToSleepIn(bot, goal);
      const bedNear = homeBed && (surfaceObserver(bot)(bot.entity.position) || Math.abs(homeBed.foot.y - bot.entity.position.y) <= 10) ||
        // A bed in the pack is a bed too. A fight pocket dug at dusk held the
        // bot until dawn, eleven minutes behind a wall, with a bed on its back.
        (!homeBed && bot.game?.dimension === 'overworld' && sleepable(bot) && !sleepWaiting(this) && bedCarried(bot) && surfaceObserver(bot)(bot.entity.position));
      // Say who is keeping the bot in, and whether the hunt had claimed it:
      // a wait with no named reason cost an hour of guessing.
      // A creeper within sixteen, seen or not, is watching too: leaving
      // keeps every door within six of one shut (leave, below). mid-230-l
      // was told nothing watched its pocket with a creeper drifting three to
      // seven blocks off behind the rock, chose to leave sixty-seven times,
      // and every door was refused for it: an hour and forty minutes in the
      // pocket (2026-09-27).
      const watcher = threats(bot).find(t => t.distance < 20 && (t.visible || t.distance < 6 || (t.entity.name === 'creeper' && t.distance <= 16)) && !claimed(bot, t.entity));
      const hunt = bot._huntingEntity;
      // Inside the pocket with the bot, or at arm's length through a gap:
      // fought, not waited out (a reflex). The clean run sealed itself in
      // with a skeleton at 0.3 blocks and "waited for it to leave" for
      // eighteen minutes, arrows piling up at its feet (2026-09-24).
      // In reach by the swing's own test, not a nearer one of the reflex's:
      // mid-235-n's zombies on its lid were "in reach" to the reflex and
      // never to the swing, and the reflex held the pocket two hours and
      // twenty minutes without a hit or a question (note 478).
      const reach = watcher && strikeTarget(bot);
      // The stance's, with Jev reachable and none holding (note 549): the
      // fight here is among its options, with the rest.
      if (reach && encounterJudgments(this) && !stanceHeld(bot)) { await this.flee(task, goal, save); onStep(goal); return true; }
      if (reach) {
        this.report(goal, save, { action: 'fight_in_pocket', target: reach.entity.name, distance: Number(reach.distance.toFixed(1)), health: bot.health });
        await defendNearby(bot, task, goal, save);
        for (let n = 0; n < 5; n++) { task.check(); await sleep(100); }
        onStep(goal); return true;
      }
      // The same mob at the wall, and since when, day or night; and what the
      // place is (mobSourceAbout), said with staying and leaving: mid-220-g
      // sealed in about sixty times beside a dungeon it knew and came back
      // out to the same gravel each time, never told the place keeps making
      // mobs (note 476).
      if (watcher) {
        if (this.state.pocketWatch?.id !== watcher.entity.id) this.state.pocketWatch = { id: watcher.entity.id, since: Date.now() };
        this.noteMobPlace('pocket', [watcher.entity.name]);
      } else delete this.state.pocketWatch;
      const keptFor = watcher && this.state.pocketWatch ? Math.round((Date.now() - this.state.pocketWatch.since) / 1000) : 0;
      const place = this.placeAbout(goal);
      const placeSays = place?.says || '';
      // What next in the pocket is Jev's: stay, leave, go to bed, open the
      // wall on a watcher, or mine the night away. Held ninety seconds for
      // the same watcher and the same night.
      const night = shelterNeeded(bot);
      // And what is about that the wall hides: inside a sealed pocket nothing
      // is in sight, and mid-110-e opened its pocket for the bed with a
      // creeper ten blocks off it had not been told of, and was blown up
      // from twenty health in iron (2026-09-25).
      const about = threats(bot, 16).filter(t => t.entity !== watcher?.entity).slice(0, 4);
      const hidden = about.length ? `${about.map(t => `a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`).join(', ')}${about.some(t => !t.visible) ? ' (heard, not seen: the wall is between)' : ''}` : '';
      const who = watcher ? `${watcher.visible ? 'the' : 'a'} ${watcher.entity.name.replaceAll('_', ' ')} ${Math.round(watcher.distance)} blocks off${watcher.visible ? ', in sight' : ' (heard, not seen: the wall is between)'}${hidden ? `, and ${hidden}` : ''}` : hidden || null;
      // The ones standing on the lid, said as such: a solid block between,
      // out of the sword's reach and unable to hit the bot through it.
      // mid-235-n's zombies and skeletons piled up there, up to five, and
      // the pocket was never asked about in the two hours after (note 478).
      const under = bot.entity.position;
      const onLid = threats(bot, 8).filter(t => t.entity.position.y >= under.y + 2.5 && Math.hypot(t.entity.position.x - under.x, t.entity.position.z - under.z) <= 1.5 && !canStrike(bot, t.entity));
      const lidSays = onLid.length ? ` ${onLid.length === 1 ? `A ${onLid[0].entity.name.replaceAll('_', ' ')} is` : `${onLid.length} mobs (${onLid.map(t => t.entity.name.replaceAll('_', ' ')).join(', ')}) are`} standing on the pocket's lid, right over the bot: a solid block is between, so the sword cannot reach ${onLid.length === 1 ? 'it' : 'them'} and ${onLid.length === 1 ? 'it cannot' : 'they cannot'} hit the bot through it. Waiting under them gains nothing but time.` : '';
      const options = {};
      // The shooters past the sixteen, within their own reach: a blaze fires
      // from forty-eight at what it sees, a ghast from sixty-four. mid-235-q-
      // nether-3's pocket was said as watched by nothing, eight blazes twenty
      // to twenty-eight blocks off by their spawner, and leaving it as "4
      // zombie hits or 4 arrows" (note 548).
      const farShooters = threats(bot, 64).filter(t => t.distance >= 16 && ['blaze', 'ghast'].includes(t.entity.name) && t.distance <= require('./combat-estimate').RANGE[t.entity.name]);
      const farSays = farShooters.length ? (() => {
        const kinds = [...new Set(farShooters.map(t => t.entity.name))];
        const ds = farShooters.map(t => Math.round(t.distance));
        return ` Beyond, ${farShooters.length} ${kinds.length === 1 ? `${kinds[0]}${farShooters.length === 1 ? '' : 's'}` : 'shooters'} ${Math.min(...ds)}${Math.max(...ds) > Math.min(...ds) ? ` to ${Math.max(...ds)}` : ''} blocks off, within the reach they fire from at what they see (${kinds.map(k => `a ${k} ${require('./combat-estimate').RANGE[k]} blocks`).join(', ')}): the pocket's rock stops them, and out of it each with a line to the bot shoots.`;
      })() : '';
      const outside = (who ? ` Outside is ${who}.` : '') + farSays + lidSays + wardenSays(bot);
      // Sleep is refused with a monster within eight blocks of the bed, seen
      // or not (the decision audit): said, with the walk.
      const byBed = homeBed ? monstersByBed(bot, homeBed.foot, 32) : 0;
      const bedWalk = homeBed ? ` ${Math.round(homeBed.foot.distanceTo(bot.entity.position))} blocks away (about ${Math.round(homeBed.foot.distanceTo(bot.entity.position) / 4.3)} seconds at a walk${Math.abs(homeBed.foot.y - bot.entity.position.y) > 2 ? `, ${Math.round(homeBed.foot.y - bot.entity.position.y)} blocks up or down` : ''})` : ' in the pack';
      if (bedNear) options.go_to_bed = { description: `Open the pocket and go to the bed${bedWalk}; the night passes in seconds.${byBed ? ` ${byBed} monster${byBed === 1 ? '' : 's'} within eight blocks of the bed now: sleep is refused while any are.` : ''}${who ? ` Outside is ${who}.` : ''}`,
        run: async () => { delete this.state.watchedSince; await this.leave(task, goal, save, refuge, 'Off to bed.'); return true; } };
      // The carried bed in a nook dug out of the pocket's wall, the pocket
      // staying shut: the one bot of the six midgame trials of 2026-09-26
      // that carried a bed sat its nights out in pockets like this one.
      // Before bedtime the nook is said with the stay.
      const carried = night && bedCarried(bot) && bot.game?.dimension === 'overworld' && !sleepWaiting(this) && !isSetAside(this, 'bed_nook', 'here') && typeof this.actions.dig === 'function';
      const nook = carried && bedNook(bot, goal, { sealed: true });
      if (nook && sleepable(bot)) options.sleep_in_nook = { description: `Stay sealed in and ${nookSays(bot, nook, { pocket: true })}${outside}`,
        run: async () => {
          try { await this.nookSleep(task, goal, save, { pocket: refuge }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          delete this.state.bedNookPlan; return true;
        } };
      // No nook to be had (a pocket built on open ground has no rock round
      // the cells for one): the carried bed put down beside the pocket, as
      // at any bedtime outside. mid-211-o carried a bed through three hours
      // and was never offered sleep from a pocket; nights were sixty-two of
      // its hundred and eighty minutes (note 428).
      if (!options.sleep_in_nook && carried && sleepable(bot) && !isSetAside(this, 'bed_out', 'here')) {
        const site = bedSiteNear(bot);
        if (site) {
          const near = monstersByBed(bot, site.foot);
          options.sleep_beside = { description: `Open the pocket, put the carried bed down on level ground beside it, ${Math.round(site.foot.distanceTo(bot.entity.position))} blocks off, and sleep: the night passes in seconds, instead of about ${minutesToDawn(bot)} real minutes in the pocket; the bed is picked back up after. Sleep is refused while a monster is within about eight blocks sideways and five up or down of the bed (vanilla), seen or not: ${near ? `${near} ${near === 1 ? 'is' : 'are'} now` : 'none now'}. Out of the pocket until the bed is down and slept in.${outside}`,
            run: async () => {
              delete this.state.bedBesidePlan;
              await this.leave(task, goal, save, refuge, 'Off to bed.', { past: true });
              try {
                await this.actions.navigate(bot, task, new goals.GoalBlock(site.stand.x, site.stand.y, site.stand.z), { timeoutMs: 10000, stallMs: 3000 });
                await this.sleepStep(task, goal, save);
              } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(this, 'bed_out', 'here', err, 180000); }
              return true;
            } };
        }
      }
      if (watcher && watcher.distance <= 4.5 && /_(sword|axe)$/.test(defenseWeapon(bot)?.name || '') && typeof this.actions.dig === 'function')
        options.open_on_watcher = { description: `Open the wall toward ${who} and fight it at the gap.${watcher.entity.name === 'creeper' ? ' A creeper at the gap goes off.' : ''}`,
          run: () => this.openOnWatcher(task, goal, save, refuge, watcher, { chosen: true }) };
      // Blazes about the pocket: its wall opened toward them, one wide and
      // two high, and fought from inside, the pocket's rock at the back
      // (blaze-stand.js). mid-235-p-fortress-4 sat twenty-two minutes sealed
      // ten blocks from a spawner with blazes five to seven blocks off,
      // offered only to stay or leave; none of these, nine times.
      const blazesOut = threats(bot, 24).filter(t => t.entity.name === 'blaze');
      const opening = blazesOut.length && typeof this.actions.dig === 'function' ? require('./blaze-stand').blazeStands(bot, threats(bot, 24), { pocket: true }).dig_in_and_fight : null;
      if (opening) options.dig_in_and_fight = { description: opening.description + outside,
        run: async () => {
          delete this.state.watchedSince;
          this.report(goal, save, { action: 'dig_in_and_fight', from: 'pocket', blazes: blazesOut.length, health: bot.health });
          try { return await require('./blaze-stand').takeStand(bot, task, goal, save, opening, { navigate: this.actions.navigate }); }
          catch (err) { task.check(); if (['NeedsAir', 'Cancelled'].includes(err.name)) throw err; return false; }
        } };
      // What the night in the pocket holds up, said on every way to spend
      // it: mid-202-q mined fifty minutes of nights, the portal its rung,
      // each night told the ore and never the minutes or the work (note 531).
      const waiting = workWaiting(goal, bot);
      const below = bot.game?.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
      const nightCost = night ? ` Until dawn is about ${minutesToDawn(bot)} real minutes of the run${waiting ? `, with ${waiting} waiting` : ''}.` : '';
      if (night && !watcher && !refused(this, 'survival:night_mine') && this.canNightMine(goal))
        options.night_mine = { description: `Mine from the pocket through the night: toward ore in the rock, or down and along a branch. Rock around a tunnel is shelter too. ${rockHolds(bot, feetCell(bot), attemptsFor(this))}${nightCost}${outside}`, run: () => this.nightMine(task, goal, save) };
      // Work that needs no walking: the ladder's next item made from what is
      // carried. Trial 30 sat out its second night in a pocket with 29 raw
      // iron, coal and a furnace in its pack, the armour the one thing left.
      const bench = !watcher && goal.kind === 'win' && this.benchWork(goal);
      if (bench) options.work_here = { description: `Stay in the pocket and make the ${bench.item.replaceAll('_', ' ')} here: everything it needs is carried (${bench.plan.map(st => `${st.action} ${st.count || 1} ${String(st.item || '').replaceAll('_', ' ')}`).join(', then ')}). The furnace and the table go into the wall; the pocket stays shut.${(() => {
        // How long it takes against the night left (the decision audit,
        // 2026-09-25): ten seconds a smelt.
        const smelts = bench.plan.filter(st => st.action === 'smelt').reduce((n, st) => n + (st.count || 1), 0);
        return `${smelts ? ` About ${Math.round(smelts * 10 / 60 * 10) / 10} minutes of smelting (${smelts} at ten seconds each).` : ' Crafting only: a few seconds.'}${night ? ` About ${minutesToDawn(bot)} real minutes to dawn.` : ''}${require('./strategy').pickaxeLeft(bot, require('./strategy').planSpends(bench.plan))}`;
      })()}`,
        run: async () => { this.report(goal, save, { action: 'work_in_pocket', item: bench.item }); await this.actions.acquireStep(bot, task, bench.item, bench.count, goal, save); return true; } };
      // Out to hunt, or the valuables to the chest first (a death drops
      // everything carried): at night with nothing watching.
      if (night && !watcher) for (const [key, o] of Object.entries(this.huntOptions(goal))) options[key] = { description: o.description + outside,
        run: async () => { this.state.nightPlan = { plan: 'hunt', kind: o.kind, until: Date.now() + 120000, startHealth: bot.health }; await this.leave(task, goal, save, refuge, `Out to hunt ${o.kind.replaceAll('_', ' ')}s.`, { past: true }); return true; } };
      const stash = night && !watcher && this.stashOption(goal);
      if (stash) options.stash_valuables = { description: stash.description + outside, run: async () => { await this.leave(task, goal, save, refuge, 'To the chest.', { past: true }); return stash.run(task, goal, save); } };
      const cache = night && !watcher && !stash && this.cacheOption(goal);
      if (cache) options.cache_valuables = { description: `Open the pocket and ${cache.description.charAt(0).toLowerCase()}${cache.description.slice(1)}${outside}`, run: async () => { await this.leave(task, goal, save, refuge, 'Leaving my valuables in a chest.', { past: true }); return cache.run(task, goal, save); } };
      const bedLater = nook && !sleepable(bot) ? ` The carried bed can go down in a nook dug out of the wall, the pocket staying shut, from bedtime (${SLEEP_FROM}), about ${Math.max(0, Math.round((SLEEP_FROM - bot.time.timeOfDay) / 20))} seconds off.` : '';
      // Health and whether it comes back, at night too, and on the way out:
      // mid-92-o, at eight health and twelve hunger, chose to leave its
      // pocket in the dark told only that mobs spawn there, looked for food,
      // and died among them in a minute (2026-09-26).
      const hp = Math.round((bot.health ?? 20) * 10) / 10;
      const healthNow = hp >= 20 ? '' : (bot.food ?? 20) >= 18 ? `, healing from ${hp} health` : `, not healing: ${hp} health and hunger ${bot.food}, and health comes back only at eighteen or more`;
      // Why no mine is on offer when it is not (note 531).
      const mineOff = night && !options.night_mine ? this.nightMineOff() : null;
      // By day, the daylight a stay spends: mid-231-r stayed three days
      // through in its pocket, the stay said as "nothing is watching it"
      // and never that the day was going by (note 538).
      // How the wait has gone (pocket-wait.js, note 584): the minutes in
      // this pocket, what it was sealed against and where that is now, how
      // the mobs outside have moved while it waited, no daylight where none
      // comes, and the rung's time without a new best.
      const noFood = foodSupply(bot) === 0 && !(lastResortSupply(bot).points > 0);
      const waitSays = require('./pocket-wait').pocketWaitSays(bot, this.state, goal, { outside: threats(bot, 16).slice(0, 8), near: threats(bot, 64), night, noFood, spawner: place?.spawner });
      // Off the Overworld with the trip back for food Jev chose still held
      // (leave_nether go_back, netherLeaveHeld): that trip is the work the
      // leave goes on with, not the rung. mid-242-ab-nether-3-fortress-1 ate
      // its last rotten flesh, chose to go back for food at 05:07, sealed in
      // on the way to the portal at 05:09, and was told the leave went "back
      // to the obtain blaze rods step", past the blazes (note 589).
      const offWorld = !/overworld/.test(String(bot.game?.dimension || 'overworld'));
      // The minutes sealed in on it are not the trip's (note 597), and
      // leaving to go on with it is choosing it again: its clock starts over.
      // Only while the work would make that trip (foodTripDrives, note 670):
      // fed, or with food carried, leaving goes on with the rung, and the
      // leave says so and why.
      const tripOpts = { sealedAt: this.state.pocketWait?.since };
      const tripHeld = offWorld && require('./game-progress').netherLeaveHeld(goal, 'food', Date.now(), tripOpts);
      const foodTrip = tripHeld && require('./game-progress').foodTripDrives(bot, goal, Date.now(), tripOpts)
        ? { renew: () => { if (goal.leaveNether) { goal.leaveNether.at = Date.now(); save(); } }, to: `go on with the way back to the Overworld for food, as Jev chose at ${new Date(goal.leaveNether.at).toISOString().slice(11, 16)}${this.state.pocketWait?.since > goal.leaveNether.at ? ', before this pocket was sealed on it' : ''}`,
          says: ` ${require('./game-progress').portalTrip(bot, goal)} ${waiting ? `${waiting.charAt(0).toUpperCase()}${waiting.slice(1)}` : 'The work'} waits till the bot is fed and back.` } : null;
      // Underground the day is not waited out: the surface's burning is up
      // there, and the dark here spawns by day as by night. 25585 (mid-239-ba,
      // 11:54Z) stayed at y 11 told "the daylight waited out here is the time
      // in which the surface's zombies and skeletons burn" (note 752).
      const dayLeft = night ? '' : (() => { const d = require('./healing').daylightSays(bot); return d && /^day/.test(d) ? ` It is ${d.replace(/^day: /, 'day, ')}${below ? `, up on the surface: underground here the daylight does not come down, mobs spawn in the dark by day as by night, and waiting out the day sends none of them away` : ': the daylight waited out here is the time in which the surface\'s zombies and skeletons burn'}${(bot.food ?? 20) < 18 && (bot.health ?? 20) < 20 ? ', and staying brings no health back' : ''}.` : ''; })();
      options.stay = { description: (night ? `Stay in the pocket until daylight, about ${minutesToDawn(bot)} real minutes of the run${healthNow.startsWith(', healing') ? '' : ' with nothing gained'}${waiting ? ` and ${waiting} waiting` : ''}${healthNow}${who ? `; ${who} is outside` : ''}.${bedLater}${mineOff ? ` No night mine from here: ${mineOff}.` : ''}` : `Stay in the pocket${who ? ` while ${who} is outside` : farSays ? '' : ', though nothing is watching it'}${healthNow}.${dayLeft}`) +
        // Blazes are not waited out (note 585): mid-242-ab-nether-3 stayed
        // five minutes at full health in a pocket beside its fortress's
        // corridor, the three blazes outside told only by distance.
        (blazesOut.length ? ` Staying does not send the blaze${blazesOut.length === 1 ? '' : 's'} away: blazes keep about the fortress they spawn in, and no daylight comes in the Nether to end them.${this.state.watchedSince ? ` Watched in this pocket for ${Math.max(1, Math.round((Date.now() - this.state.watchedSince) / 60000))} minute${Math.round((Date.now() - this.state.watchedSince) / 60000) > 1 ? 's' : ''} so far.` : ''}` : '') + farSays + lidSays + wardenSays(bot) + placeSays + (waitSays?.stay || ''),
        // What the stay waits for (waits.js, note 698): daylight by night, else
        // health where it comes back, else the mobs outside moving off; with
        // nothing coming (note 679) it is not offered.
        waits: waitSays?.waits || (night ? require('./waits').daylight(bot, { night: true }) : hp < 20 && (bot.food ?? 20) >= 18 ? require('./waits').heal(bot)
          : threats(bot, 24).length ? require('./waits').mobsMoveOff('the mobs outside')
          : require('./waits').mobsMoveOff('the mobs outside', { gone: true, why: `none is within 24 blocks, it is day, and ${hp >= 20 ? 'health is full' : `health does not come back at hunger ${bot.food}`}` })),
        run: async () => { await this.wait(task, goal, save, watcher
          ? `${watcher.entity.name} at ${watcher.distance.toFixed(1)} is watching (claim ${hunt ? `${hunt.name}, ${Math.round((hunt.until - Date.now()) / 1000)}s left` : 'none'}, hp ${Math.round(bot.health)}, food ${bot.food})`
          : night ? 'Waiting for daylight inside the verified shelter' : 'Waiting in the sealed pocket'); return true; } };
      // What going out among them costs, as the stances say it: mid-92-k
      // left a pocket at twenty health past skeletons it was told only the
      // distances of, and was shot down in twenty seconds (2026-09-26).
      const outsideAll = threats(bot, 16).slice(0, 8);
      // Held off for minutes (held-off.js, note 599): priced at what each
      // has done, on the leave as on the stay, and said on both.
      const heldOff = require('./held-off');
      heldOff.observe(bot, outsideAll);
      const quietOut = heldOff.quietOf(bot, outsideAll, { record: this.state.pocketWait?.mobs });
      const quietSays = heldOff.says(bot, quietOut);
      // Only the ones that can get at the bot on its way out: a line to the
      // door or the open ground toward the work, at the door as it opens, or
      // a flyer about in the open (way-out.js). mid-242-dc-fortress-22's
      // leave was priced at 59.5 damage for a wither skeleton behind the
      // fortress wall and a skeleton, the work 77 blocks the other way, and
      // Jev stayed three times in a wait that brought nothing (note 679).
      // Where the work is, by the rung's own measure (rung-measure.js
      // parts): the fortress, the blazes seen, the cage, the portal.
      const rungParts = (() => { if (foodTrip) return []; let rp = {}; try { rp = require('./rung-measure').parts(bot, goal, { rung: goal.rungTime?.phase || '' }); } catch (_) { rp = {}; }
        return ['fortress', 'blazes', 'cage', 'portal'].map(k => Object.entries(rp).find(([key]) => key.startsWith(`${k}@`))?.[1]).filter(Boolean); })();
      const workAt = rungParts.find(x => x.at)?.at || null;
      const { exit: doorOut } = this.leaveExit(refuge, { past: true });
      const ce_ = require('./combat-estimate');
      if (quietSays && options.stay) options.stay.description += quietSays;
      // By day, what the stay waits for and when, said (note 698); by night the minutes to daylight are said already.
      if (options.stay && !night && options.stay.waits?.comes) options.stay.description += ` ${options.stay.waits.says}`;
      // What a way out costs, by where it opens: the leave's door, or a
      // passage's far end (tunnel_out).
      const priceOut = exit => {
        const way = require('./way-out').wayOut(bot, { origin: pos(refuge.origin), exit, target: workAt, mobs: outsideAll.filter(t => !quietOut.some(x => x.t === t)),
          sightOf: n => Math.max(ce_.followRange(n), ce_.RANGE[n] || 0) });
        const pricedOut = way.inWay;
        const outCost = pricedOut.length ? fightEstimate({ threats: pricedOut.map(t => ({ name: t.entity.name, distance: t.distance, shoots: shooter(t.entity), ...sizeOf(t.entity), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), visible: true })),
          armour: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere : null;
        // The creepers too: mid-83-i left past three creepers and two
        // skeletons told "2.5 damage", the creepers left out of the sum, and
        // was shot down among them in half a minute (2026-09-26).
        const creeperCount = pricedOut.filter(t => t.entity.name === 'creeper').length;
        // Every one of them held off out of sight through the wait: the fight
        // is what it costs should they all come, not what leaving is.
        return (outCost ? `${waitSays?.heldOff ? ' Should they all come at the bot at once, fighting them is estimated at about' : way.apart.length ? ` Out among the ones in the way (${pricedOut.slice(0, 4).map(t => `a ${t.entity.name.replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off`).join(', ')}), fighting them is estimated at about` : ' Out among them, fighting them all is estimated at about'} ${outCost.seconds} seconds and ${outCost.damageTaken} damage, from ${outCost.healthNow} health${outCost.healthAfter <= 0 ? ' (more than the bot has)' : ''}${creeperCount ? `, the ${creeperCount === 1 ? 'creeper' : `${creeperCount} creepers`} not counted in it: each that reaches the bot goes off for about ${outCost.creeper?.match(/about ([\d.]+)/)?.[1] || 18} health` : ''}.` : '') + require('./way-out').apartSays(way.apart) + quietSays;
      };
      const outSays = priceOut(doorOut);
      const passageExit = p => ({ door: p.path?.[0]?.at || p.end, outside: p.end });
      const ce = require('./combat-estimate');
      const worn = ce.armourOf([5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean));
      const hitsOf = name => Math.max(1, Math.ceil(hp / Math.max(0.5, ce.afterArmour(ce.MOBS[name].hit, worn))));
      // Off the Overworld no zombie is about to price the way out by (note
      // 677): the kinds about that strike, nearest first, else the Nether's
      // common ones.
      const strikers = [...new Set(threats(bot, 16).map(t => t.entity.name).filter(n => !['blaze', 'ghast', 'creeper', 'zombified_piglin', 'enderman'].includes(n) && ce.MOBS[n]?.hit))].slice(0, 2);
      const hitsHere = strikers.map(n => `${hitsOf(n)} ${/skeleton$|stray|bogged/.test(n) && n !== 'wither_skeleton' ? 'arrows' : 'blows'} of a ${n.replaceAll('_', ' ')}`).join(' or ');
      // And fireballs, with blazes about: each that lands and its five
      // seconds of fire (note 548).
      const blazesAbout = threats(bot, ce.RANGE.blaze).filter(t => t.entity.name === 'blaze');
      const fireballs = blazesAbout.length ? Math.max(1, ce.landingsApart(hp, ce.afterArmour(ce.MOBS.blaze.hit, worn), ce.burnLeft(bot)) || 1) : 0;
      // The blows that end it by what is about: off the Overworld no zombie
      // or skeleton was, and the old words priced the way out by them (note
      // 677); there only the kinds about that strike are said, none where
      // none is (a zombified piglin or an enderman is left be until struck).
      const ends = [];
      if (!offWorld) ends.push(`${hitsOf('zombie')} zombie hits or ${hitsOf('skeleton')} arrows`);
      else if (strikers.length) ends.push(hitsHere);
      if (fireballs) ends.push(`${fireballs} blaze fireball${fireballs === 1 ? ' that lands' : 's that land'} (about ${Math.round(ce.afterArmour(ce.MOBS.blaze.hit, worn) * 10) / 10} each after armour, and the ${ce.FIRE_SECONDS.fireball} seconds of fire the first sets, about ${ce.FIRE_TICKS.fireball} more health: ${Math.round(ce.landingCost(ce.afterArmour(ce.MOBS.blaze.hit, worn), ce.burnLeft(bot)) * 10) / 10} for one landing)`);
      if (ce.afterArmour(ce.MOBS.creeper.hit, worn) >= hp && (!offWorld || threats(bot, 16).some(t => t.entity.name === 'creeper'))) ends.push('one creeper\'s blast');
      const outHealth = hp >= 20 ? '' : ` It goes out at ${hp} health${(bot.food ?? 20) < 18 ? `, not healing at hunger ${bot.food}` : ''}${ends.length ? `: about ${ends[0]} end it${ends.slice(1).map(e => `, or ${e}`).join('')}` : ''}.`;
      // What leaving does with a creeper about, said: a door within six
      // blocks of one stays shut, and with every door so, the pocket waits.
      const creeperNear = threats(bot, 16).filter(t => t.entity.name === 'creeper').sort((a, b) => a.distance - b.distance)[0];
      const doorsSay = creeperNear ? ` A door within six blocks of a creeper stays shut (the creeper ${Math.round(creeperNear.distance)} blocks off now${creeperNear.visible ? '' : ', behind the rock'}): with every door so, the pocket waits for it to move off.` : '';
      // A way out that no door rule shuts: a passage dug through the far
      // wall, away from the creeper. mid-230-l chose to leave sixty-seven
      // times with a creeper drifting three to seven blocks off behind the
      // rock, every door refused for it each time, and sat a hundred minutes
      // in the pocket (note 390, 2026-09-27). The rule that keeps a door
      // within six blocks of a creeper shut is a physical one and stays; the
      // passage ends farther from the creeper than that, and is Jev's.
      // And against any keeper that will not go away, not only a creeper: a
      // spawner in reach, the passage ending beyond its sixteen blocks, or
      // the mob at the wall. mid-220-g, beside a dungeon's spawner with
      // skeletons, cave spiders and zombies at its pockets, was offered no
      // way out but the doors past them, and every retreat found no route
      // (note 476).
      const digging = !inWater(bot) && typeof this.actions.dig === 'function' && typeof this.actions.navigate === 'function';
      const spawnerHere = digging && place?.spawner;
      const fromSpawner = spawnerHere ? this.passageOut(spawnerHere.at, { clear: SPAWNER_REACH + 1, max: 24, sphere: true, also: creeperNear ? [{ at: creeperNear.entity.position, clear: PASSAGE_CLEAR }] : [] }) : null;
      const passage = !fromSpawner && creeperNear && digging ? this.passageOut(creeperNear) : null;
      const fromWatcher = !fromSpawner && !passage && watcher && digging && watcher.entity.name !== 'warden' ? this.passageOut(watcher) : null;
      // Away from blazes about, under rock the whole way: a player low on
      // health by a fortress does not open the wall on them, and leaving by
      // a door walks into the lines of all of them. The passage ends eight
      // blocks further from them than the pocket, its open end away from
      // them. mid-235-q-nether-3 was offered the window toward eight blazes,
      // staying, or going out past them, at 7 health with nothing to eat,
      // and the window let in the fireballs (note 548).
      const blazeNear = blazesAbout.slice().sort((a, b) => a.distance - b.distance)[0];
      const blazeMid = blazesAbout.length ? require('./bunker').centroid(blazesAbout) : null;
      const fromBlazes = !fromSpawner && !passage && !fromWatcher && blazeMid && digging
        ? this.passageOut({ entity: { position: blazeMid } }, { clear: Math.hypot(bot.entity.position.x - blazeMid.x, bot.entity.position.z - blazeMid.z) + 8, max: 24 }) : null;
      // Dug with a pickaxe, about 1.25 s a block (the figure this was
      // measured at with one carried); by hand it is the game's own rule
      // (hand-dig.js: netherrack about 2 s, blackstone 7.5, and so on by
      // hardness), not the pickaxe's pace. 25589 (mid-242-va, note 732) was
      // told a passage of 7 blocks took "about 18 seconds" (the pickaxe
      // figure) with no pickaxe carried, digging by hand beside a wither
      // skeleton at three blocks the whole time.
      const noPickaxe = !(bot.inventory?.items() || []).some(i => /_pickaxe$/.test(i.name));
      const outCells = p => {
        let secs;
        if (noPickaxe && p.path) {
          const { handSeconds } = require('./hand-dig');
          let total = 0, unknown = false;
          for (const c of p.path) for (const q of c.dig) {
            const b = bot.blockAt(q);
            if (!b || b.boundingBox !== 'block') continue;
            const s = handSeconds(bot, b);
            if (s == null) { unknown = true; break; }
            total += s;
          }
          secs = unknown ? Math.round((p.blocks || p.cells * 2) * 1.25) : Math.round(total);
        } else secs = Math.round((p.blocks || p.cells * 2) * 1.25);
        return `one wide and two high, ${p.cells} blocks${p.down ? `, a stair down a block each step to ${p.down} below the pocket's floor (${p.blocks} blocks dug)` : ''}, about ${secs} seconds${noPickaxe ? ' by hand (no pickaxe carried)' : ''}`;
      };
      // Where it goes from the passage's end: the trip back for food Jev
      // chose, while it is held (note 597), else the work.
      const outThen = foodTrip ? `from its end ${foodTrip.to}.${foodTrip.says}` : null;
      const blazesSay = blazesAbout.length ? ' Rock round it the whole way and the pocket\'s wall toward the blazes left standing: a blaze sees the bot only straight down the passage; a blaze that has not seen it for three seconds gives it up.' : '';
      const outSafe = kind => ` No block is dug with lava or water behind it, and the passage stops, the bot still enclosed, if a ${kind.replaceAll('_', ' ')} comes round toward its head within six blocks or the rock ahead is not safe to dig through.`;
      const walksRound = w => ` A ${w.entity.name.replaceAll('_', ' ')} after a player walks round to it through open ground, not through rock${keptFor ? `; this one has kept the pocket ${keptFor} seconds` : ''}.`;
      const outRun = (keeper, p) => async () => {
        delete this.state.watchedSince; delete this.state.pocketWatch;
        if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'tunnel_out' };
        foodTrip?.renew();
        return this.tunnelOut(task, goal, save, refuge, keeper, p);
      };
      if (fromSpawner) {
        const spawnerMob = watcher || { entity: { name: 'spawner', position: spawnerHere.at.offset(0.5, 0, 0.5) }, distance: spawnerHere.distance };
        options.tunnel_out = { description: `Dig a passage out through the pocket's ${fromSpawner.direction} wall, away from the mob spawner: ${outCells(fromSpawner)}, ending ${fromSpawner.clearance} blocks from the spawner (it is ${spawnerHere.distance} off now), beyond the ${SPAWNER_REACH} within which it makes more of its mob; then ${outThen || `go back to ${waiting || 'work'}${night ? ' in the dark, where mobs spawn' : ''} from its end.`}${blazesSay}${watcher ? walksRound(watcher) : ''}${outSafe(watcher ? watcher.entity.name : 'mob')}${priceOut(passageExit(fromSpawner))}${outHealth}`,
          run: outRun(spawnerMob, fromSpawner) };
      } else if (fromWatcher) options.tunnel_out = { description: `Dig a passage out through the pocket's ${fromWatcher.direction} wall, away from the ${watcher.entity.name.replaceAll('_', ' ')}: ${outCells(fromWatcher)}, and go back to work${night ? ' in the dark, where mobs spawn' : ''} from its end, ${fromWatcher.clearance} blocks from where it is now (it is ${Math.round(watcher.distance)} off${watcher.visible ? '' : ', behind the rock'}).${walksRound(watcher)}${outSafe(watcher.entity.name)}${priceOut(passageExit(fromWatcher))}${outHealth}`,
        run: outRun(watcher, fromWatcher) };
      else if (fromBlazes) {
        const endFrom = Math.round(Math.min(...blazesAbout.map(t => Math.hypot(t.entity.position.x - (fromBlazes.end.x + 0.5), t.entity.position.z - (fromBlazes.end.z + 0.5)))));
        options.tunnel_out = { description: `Dig a passage out through the pocket's ${fromBlazes.direction} wall, away from the blazes: ${outCells(fromBlazes)}, ending ${endFrom} blocks from the nearest of them where they are now (the nearest is ${Math.round(blazeNear.distance)} off); then ${outThen || `go back to ${waiting || 'work'} from its end.`} Rock round it the whole way and the pocket's wall toward them left standing: a blaze sees the bot only straight down the passage, and the passage runs away from them; a blaze that has not seen it for three seconds gives it up.${outSafe('blaze')}${outHealth}`,
          run: outRun(blazeNear, fromBlazes) };
      }
      if (passage) options.tunnel_out = { description: `Dig a passage out through the pocket's ${passage.direction} wall, away from the creeper: ${outCells(passage)}, and go back to work${night ? ' in the dark, where mobs spawn' : ''} from its end, ${passage.clearance} blocks from where the creeper is now (it is ${Math.round(creeperNear.distance)} off${creeperNear.visible ? '' : ', behind the rock'}). A creeper walks to a player it sees within sixteen blocks and lights its fuse within three; behind rock it sees nothing, and digging makes no noise it follows. No block is dug with lava or water behind it, and the passage stops, the bot still enclosed, if the creeper comes round toward its head within six blocks or the rock ahead is not safe to dig through.${priceOut(passageExit(passage))}${outHealth}`,
        run: async () => {
          delete this.state.watchedSince;
          if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'tunnel_out' };
          return this.tunnelOut(task, goal, save, refuge, creeperNear, passage);
        } };
      // Away from a warden, beyond its boom: the one way out that is not a
      // door past it (note 412).
      const wardenAbout = threats(bot, 32).filter(t => t.entity.name === 'warden').sort((a, b) => a.distance - b.distance)[0];
      const away = wardenAbout && !inWater(bot) && typeof this.actions.dig === 'function' && typeof this.actions.navigate === 'function' ? this.passageOut(wardenAbout, { clear: BOOM_ACROSS + 2, max: 24 }) : null;
      if (away) options.tunnel_from_warden = { description: `Dig a passage out through the pocket's ${away.direction} wall, away from the warden: ${outCells(away)}, ending ${away.clearance} blocks across from where it is now, beyond its boom's ${BOOM_ACROSS}; then go back to work from there. Digging is a vibration the warden hears and comes toward. No block is dug with lava or water behind it, and the passage stops, the bot still enclosed, if the warden comes round toward its head within six blocks.` + wardenSays(bot) + outHealth,
        run: async () => {
          delete this.state.watchedSince;
          if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'tunnel_from_warden' };
          return this.tunnelOut(task, goal, save, refuge, wardenAbout, away);
        } };
      // The trip held but not driving the work: said, so the leave is not
      // read as the trip (note 670).
      const tripNot = tripHeld && !foodTrip ? ` The trip back to the Overworld for food Jev chose at ${new Date(goal.leaveNether.at).toISOString().slice(11, 16)} is not what leaving does now: ${(bot.food ?? 20) >= 18 ? `hunger is ${bot.food}` : require('./mob-policy').hasFood(bot) ? 'food is carried' : 'going on without it was chosen'}, so the work goes on here, and food is asked about again when it is short.` : '';
      // Where the work goes from here, by the rung's own measure (rung-
      // measure.js parts): the fortress, the blazes seen, the cage, the
      // portal. mid-243-fa sat thirteen minutes sealed in 19 blocks from its
      // fortress, the leave naming only "the obtain blaze rods step".
      const workWhere = rungParts.length ? ` From here that work is ${rungParts.map(x => `${x.what} ${Math.round(x.v)} blocks off`).join(', ')}.` : '';
      options.leave = { description: `Open the pocket and ${foodTrip ? foodTrip.to : `go back to ${waiting || 'work'}`}${night ? ' in the dark, where mobs spawn' : ''}${who ? `, past ${who}` : ''}.${foodTrip ? foodTrip.says : `${workWhere}${tripNot}`}${night && below ? ` ${BELOW_NIGHT}${BELOW_NIGHT_SURFACE}` : ''}${lidSays}${doorsSay}${outSays}${outHealth}` + wardenSays(bot) + placeSays + (waitSays?.leave || ''),
        run: async () => {
          delete this.state.watchedSince;
          // Out at night is a plan for a while, not a moment: without it the
          // next tick saw the night and no shelter and sealed the bot back
          // in, and the work opened the lid again, every two seconds for a
          // minute (mid-92-f, 2026-09-26). Held as staying up for two minutes.
          if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'leave' };
          foodTrip?.renew();
          return (await this.leave(task, goal, save, refuge, undefined, { past: true })) !== false;
        } };
      // Out for food, by day or night, when hunger is under eighteen and the
      // food carried would not bring it there: the one way health comes back.
      // mid-231-r sat an hour in a shaft pocket at 0.7 health and hunger 3,
      // three days going by, offered only staying and going back to the work
      // (a stone pickaxe), and answered "none of these" over and over; the
      // rabbits it had hunted a minute before sealing in were never said
      // (note 538). The ways are the food question's own (forageChoices),
      // each with its walk, the dark and the hostiles on the way, and the
      // pocket is opened first.
      const foodWays = {};
      if ((bot.food ?? 20) < 18 && foodSupply(bot) < 18 - (bot.food ?? 20) && goal.kind !== 'creative') {
        // Surveyed once in half a minute: the pocket is visited every step,
        // and each animal in view is a route found.
        // Off the Overworld the ways are back through the portal and the
        // Nether's hoglins (offWorldFood, the food question's own), said with
        // the trip: mid-242-ab-nether-3-fortress-1 sat twenty-six minutes in
        // a Nether pocket with nothing to eat, offered no way to food at all
        // (note 589). The trip back is the leave's when the leave goes on
        // with it already (Jev's go_back held), not offered twice.
        let ways = offWorld ? {} : this._pocketFood?.until > Date.now() ? this._pocketFood.ways : {};
        if (offWorld) {
          ways = this.offWorldFood(task, goal, save);
          if (foodTrip) delete ways.return_for_food;
        } else if (!(this._pocketFood?.until > Date.now())) {
          try { ways = await forageChoices(bot, task, goal, save, this.actions, this.state); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          this._pocketFood = { until: Date.now() + 30000, ways };
        }
        for (const [k, way] of Object.entries(ways)) foodWays[k] = { description: way.description,
          run: async () => {
            delete this.state.watchedSince; delete this.state.pocketWatch;
            if (!(await this.leave(task, goal, save, refuge, 'Out for food.', { past: true }))) return false;
            // Held as the food question's own plan: the next steps go on
            // with food, not back to the question.
            this.state.foodPlan = { until: Date.now() + 300000, at: new Date().toISOString() };
            if (night) this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000, from: 'go_for_food' };
            if (way.valid && !way.valid()) return true;
            try { await way.run(); }
            catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
            return true;
          } };
        const heal = require('./healing').healingSays(bot, goal);
        const known = offWorld ? `${foodSupply(bot) ? 'the food carried is not enough' : 'nothing carried is food'}, and off the Overworld the food is back through the portal, where it is hunted and cooked${foodWays.hoglin_food ? ', or the Nether\'s hoglins' : ''}`
          : Array.isArray(heal?.nearestFood) ? `the food known: ${heal.nearestFood.join('; ')}` : 'no food known nearby: a search walks to look for animals';
        if (Object.keys(foodWays).length) options.go_for_food = {
          description: `Open the pocket and go for food, the way chosen next: ${known}. Food is the only way health comes back: ${hp} health and hunger ${bot.food}, and health returns only at eighteen or more${(bot.food ?? 20) <= 6 ? `; at hunger 0 the bot starves, a health every four seconds` : ''}. ${heal?.daylight ? `${heal.daylight.charAt(0).toUpperCase()}${heal.daylight.slice(1)}.` : ''}${night ? ' Mobs spawn in the dark on the way.' : ''}${who ? ` Outside is ${who}.` : ''}${outSays}${outHealth}`,
          children: foodWays };
      }
      // Leaving refused now by the stall watch (report's refusal of
      // survival:leave_shelter): every way here that opens the pocket runs
      // through leave(), and chosen, did nothing but wait. 25585 (mid-239-ba,
      // 11:55:32Z) chose leave, "Open the pocket and go back to the home bed
      // step", and stayed shut: leaving had been set aside at 11:50:38 as
      // "isn't getting me anywhere" (note 752). A stall's refusal is the
      // code's own guard against a loop it runs unasked; Jev's answer, with
      // the stall said on it, is carried out. A flip of leaving and sealing
      // in again still rests (the loop is the code's), and that is said on
      // each way it stops, with when it ends.
      const leaveOff = (() => {
        const key = 'survival:leave_shelter', now = Date.now();
        if (excused(bot, 'leave_shelter', now)) return null;
        const flip = flipped(goal, key) ? attemptsFor(goal).of('flip')[key] : null;
        const act = refused(this, key) ? attemptsFor(this).of('act')[key] : refused(goal, key) ? attemptsFor(goal).of('act')[key] : null;
        const e = flip || act;
        if (!e) return null;
        return { flip: !!flip, says: `${e.why || 'it stalled'}; back in about ${Math.max(1, Math.round(((e.until || now) - now) / 1000))} seconds` };
      })();
      const leaveStalled = !!leaveOff && !leaveOff.flip;
      if (leaveOff) {
        const opens = ['leave', 'go_to_bed', 'sleep_beside', 'stash_valuables', 'cache_valuables', 'go_for_food', ...Object.keys(options).filter(k => /^hunt_/.test(k))];
        for (const k of opens) if (options[k]) options[k].description += leaveOff.flip
          ? ` Leaving is set aside now for turning between leaving and sealing in again (${leaveOff.says}): chosen now, the pocket stays shut and the bot waits in it.`
          : ` Leaving stalled here before (${leaveOff.says}); chosen, the pocket is opened all the same.`;
      }
      // A choice that did nothing when it ran is not on offer again for a
      // minute, and why is said: the stay it fell back to was asked about
      // again five seconds later, the same choice came back, and did nothing
      // again, all night (note 531).
      const notNow = {};
      for (const [k, entry] of Object.entries(attemptsFor(this).of('pocket_option'))) {
        if (k === 'stay' || !(options[k] || foodWays[k])) continue;
        delete options[k]; delete foodWays[k];
        notNow[k] = `${entry.why}; back in about ${Math.max(1, Math.round((entry.until - Date.now()) / 1000))} seconds`;
      }
      if (options.go_for_food && !Object.keys(foodWays).length) delete options.go_for_food;
      // After any interruption, the way back to the work is named first,
      // ahead of night_mine, a hunt or the valuables (note 742): 25597's
      // portal cast was cut twice by one zombie 7 blocks off, sealed at
      // full health with a sword carried, and pocket_next chose night_mine
      // over leave both times, each option already saying the same cast
      // waiting on it (3 of ten obsidian in, the frame 11 blocks off) —
      // the facts were honest, but leave sat last in the list, after
      // night_mine, a hunt and the valuables. Reordered here so leave (or,
      // where an active threat forces one first, open_on_watcher, the dig
      // in beside blazes, or a tunnel out) is named right after those and
      // before the ways that set the interrupted work aside.
      if (options.leave && workWaiting(goal, bot)) {
        const FIRST = ['sleep_beside', 'go_to_bed', 'sleep_in_nook', 'open_on_watcher', 'dig_in_and_fight', 'tunnel_from_warden', 'tunnel_out'];
        const keys = Object.keys(options);
        const ordered = {};
        for (const k of keys) if (FIRST.includes(k)) ordered[k] = options[k];
        ordered.leave = options.leave;
        for (const k of keys) if (!FIRST.includes(k) && k !== 'leave') ordered[k] = options[k];
        for (const k of keys) delete options[k];
        Object.assign(options, ordered);
      }
      // The old order, for the tests' stand-in only (context.rule; note 707).
      const rule = bedNear && !watched ? 'go_to_bed' : (night || watched) && !outwaited
        ? (options.open_on_watcher && (bot.health ?? 20) >= 16 && watcher.entity.name !== 'creeper' && threats(bot, 16).filter(t => t.entity !== watcher.entity).length <= 1 ? 'open_on_watcher' : options.night_mine && !watched ? 'night_mine' : 'stay')
        : 'leave';
      // For this pocket: an answer given in another is not this one's.
      // mid-242-ag's leave, chosen in a shaft pocket forty seconds before,
      // opened the pocket Jev had just chosen to seal against a skeleton,
      // twice, the moment it closed, with no question (note 593).
      const key = `${pos(refuge.origin)}|${watcher?.entity.name || ''}|${night}|${!!bedNear}|${Object.keys(options).sort().join(',')}`;
      // A stay that waits for nothing (pocket-wait.js: what it was sealed
      // against gone, no daylight, no health to gain) is not held its ninety
      // seconds: it is asked again once the ledger can judge the wait
      // (tried.js WAIT_JUDGED_MS), and a stay that changed nothing twice
      // rests as any wait does. mid-242-dc-fortress-22 held three such stays
      // for four and a half minutes (note 679).
      const plan = this.state.pocketPlan;
      const forNothing = plan?.choice === 'stay' && waitSays?.waitsForNothing && Date.now() - (plan.at || 0) >= require('./tried').WAIT_JUDGED_MS;
      // A choice among go_for_food's own ways (return_for_food, hoglin_food,
      // ...) lives in foodWays, not options: checking options[plan.choice]
      // alone found nothing for it, so the hold never took and a food way
      // chosen here was asked again at once, every second, never given the
      // 90 seconds its own leave and walk need to run (25592, note 720).
      const held = plan?.key === key && plan.until > Date.now() && (options[plan.choice] || foodWays[plan.choice]) && !forNothing ? plan.choice : null;
      // The nook Jev chose for tonight when the pocket was sealed (shelter
      // method bed_nook) is carried out at bedtime, not asked again.
      // So is the wait for daylight chosen sealed (wait_for_day_sealed), while
      // health does not come back.
      let choice = held || (this.state.bedNookPlan?.until > Date.now() && options.sleep_in_nook ? 'sleep_in_nook' : null)
        || (this.state.sealedWait?.until > Date.now() && (bot.food ?? 20) < 18 && options.stay ? 'stay' : null)
        || (this.state.bedBesidePlan?.until > Date.now() && options.sleep_beside ? 'sleep_beside' : null);
      if (!choice) {
        const tree = Object.fromEntries(Object.entries(options).map(([k, o]) => [k, { description: o.description, ...(o.waits ? { waits: o.waits } : {}), ...(o.children ? { children: Object.fromEntries(Object.entries(o.children).map(([ck, c]) => [ck, { description: c.description }])) } : {}) }]));
        const decision = await this.decide(task, goal, save, { id: 'pocket_next', tree, context: { rule },
          // The day's fields where there is a day (note 677).
          state: { ...(offWorld ? {} : { timeOfDay: bot.time?.timeOfDay, night, daylight: night ? ((bot.time?.timeOfDay ?? 0) < DAY.DARK ? 'dusk: the sun is going down, and the night is counted from here' : 'night') : (bot.time?.timeOfDay ?? 0) >= 22000 ? 'dawn: zombies and skeletons in the open burn once the sun is up' : 'day' }),
            workWaiting: goal.rungTime?.phase || goal.step?.item || goal.step?.block || goal.request || null,
            ...(night ? { underground: below, minutesToDawn: minutesToDawn(bot) } : {}), ...(mineOff ? { nightMineOff: mineOff } : {}), ...(Object.keys(notNow).length ? { notNow } : {}),
            stillNeeded: require('./game-progress').rungsAhead(bot, goal, this.actions.planFor),
            inventory: Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])),
            ...(waitSays ? { pocketSoFar: waitSays.facts } : {}), ...(shutOpen ? { pocketNotWhole: pocketOpenSays(shutOpen) } : {}),
            riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot),
            health: bot.health, food: bot.food, armedAndArmoured: kitReady(bot), armourWorn: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, watchedForSeconds: this.state.watchedSince ? Math.round((Date.now() - this.state.watchedSince) / 1000) : 0,
            threats: threats(bot).filter(t => t.distance < 20).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance * 10) / 10, visible: t.visible, shoots: shooter(t.entity), ...(onLid.some(o => o.entity === t.entity) ? { onLid: true, inReach: false, canReachBot: false } : {}) })) } });
        if (decision.stale) { onStep(goal); return true; }
        choice = decision.path.at(-1);
        this.state.pocketPlan = { choice, key, at: Date.now(), until: Date.now() + 90000 };
      }
      // A choice that opens the pocket's wall on the mobs is carried out
      // once: the pocket sealed again after it is a new question, not the
      // same wall opened again. mid-235-q-nether-3's window toward the
      // blazes, chosen once, was dug three times in a minute and a half,
      // twenty seconds by hand each, the seal going back between, never
      // asked again; the third opening let in the fireballs (note 548).
      if (OPENS_ON_MOBS.has(choice)) delete this.state.pocketPlan;
      // A leave (or any pocket option) whose walk finds no route throws
      // NoRoute rather than returning false: thrown here, it skipped both
      // the delete of pocketPlan below and the fall back to stay, and left
      // the choice held for the rest of its ninety seconds. Every pass after
      // rethrew the same NoRoute from stepOnce's own try, which only rests a
      // fact and returns false, so turn_priority kept asking again for
      // survival (its claim still said pocket_next, that being the pocket
      // it is in) while stepOnce quietly retried the same failing leave and
      // no pocket_next question came: 25590 read "whether to stay, leave or
      // do something else there is asked next" at 04:51:32 and 04:52:32 with
      // none asked between, sealed the whole time against a piglin 15 blocks
      // off out of sight (note 723). Caught here as any other run's failure
      // is, so the plan is always cleared and stay always runs meanwhile,
      // and the next pass asks pocket_next fresh rather than holding a dead
      // choice.
      let ranOk = false, why = null;
      // Jev's answer, the stall said on it: its leave is not refused for it
      // (leaveOff above, note 752), for this run only.
      if (leaveStalled) this.state.leaveChosen = true;
      try { ranOk = await (options[choice] || foodWays[choice]).run(); }
      catch (err) { if (err.name === 'NoRoute') why = noRouteSays(err, `the ${choice.replaceAll('_', ' ')} way out`); else if (err.name !== 'SetAside') throw err; ranOk = false; }
      finally { delete this.state.leaveChosen; }
      if (!ranOk) {
        delete this.state.pocketPlan;
        if (choice !== 'stay') { setAside(this, 'pocket_option', choice, why || `chosen at ${new Date().toISOString().slice(11, 19)} and it did nothing from this pocket${this.state.leaveRefused ? ` (${this.state.leaveRefused.charAt(0).toLowerCase()}${this.state.leaveRefused.slice(1)})` : ''}`, 60000); delete this.state.leaveRefused; save(); }
        await options.stay.run();
      }
      onStep(goal); return true;
    }
    // The hunt Jev chose for the night, while it holds.
    const hunt = this.state.nightPlan?.plan === 'hunt' ? this.state.nightPlan : null;
    // A hunt for food (foodHunt) is not a night's: day or Nether, it runs its time.
    if (hunt && (hunt.until < Date.now() || (!hunt.food && !shelterNeeded(bot)))) { delete this.state.nightPlan; delete bot._nightHunt; }
    // Not under something else's fire or teeth: the hunted kind is no
    // threat (danger.js nightHunted), anything else is answered first, as
    // the claim says. mid-235-q-nether-1's food hunt of hoglins held the
    // claim while a ghast's fireball threw it off a ledge; the turn went to
    // the work six times at 12 then 8 health, and the next fireball ended
    // it (note 541).
    else if (hunt && !immediateThreat(bot) && await this.huntStep(task, goal, save)) { onStep(goal); return true; }
    if (!shelterNeeded(bot)) delete this.state.nightMine;
    else if (this.state.nightMine && !immediateThreat(bot) && !surfaceObserver(bot)(bot.entity.position.offset(0, 1, 0)) &&
        await this.nightMine(task, goal, save)) { onStep(goal); return true; }
    // Or one that has stood off, whose claim Jev gave the turn to (note
    // 752): answered as any, by the stance.
    const emergency = immediateThreat(bot) || immediateThreat(bot, { stoodOff: true });
    if (emergency) {
      // Sealing a nearby prepared site is faster than a long retreat. Otherwise
      // get clear first; ordinary digging must never continue under fire.
      // With a mob already at arm's length there is no sealing it out: the
      // third death was six zombies in the shell cells and a bot placing
      // blocks against them until its health ran out.
      // In sight or not: a zombie at arm's length round the shelter's wall
      // hits all the same. mid-202-i sealed its half-built walls for four
      // seconds with one at one to two blocks, not counted as in view, and
      // went into the fight at seven health (2026-09-27).
      // A shooter at arm's length too: the seal is no answer to a mob that
      // stands in its wall, and the claim Jev chose said the stance comes
      // next. mid-226-h sealed here forty times in forty seconds against a
      // skeleton at 1.5 to 2.1 blocks, no stance asked and no swing, 17.1 to
      // none (note 520). The pocket's state is said on the stance.
      const adjacent = biterAtArm(bot) || threats(bot).some(t => t.distance <= 3 && (t.visible || canStrike(bot, t.entity)));
      // The saved site's seal is the rule's answer, and only without Jev:
      // with Jev reachable the encounter is its question (note 549), a
      // pocket where the bot stands among the stances. mid-242-ag stood
      // beside a two-day-old pocket over a pool, the seal of it refused
      // every pass as out of reach and counted as done, 508 times in
      // thirty-three seconds, while a skeleton 4.5 blocks off shot it from
      // twenty to none: no stance asked, no swing, no shield (note 593).
      if (!encounterJudgments(this) && !adjacent && refuge && pos(refuge.origin).distanceTo(bot.entity.position) < 3 && shelter.materialStock(bot) >= shelter.missingShell(bot, refuge).length) {
        // A pass that closed nothing (a mob in a cell, the pocket resting)
        // is no answer either: the mob is, this tick.
        if (await this.refugeStep(task, goal, save, { method: 'saved_shelter' }) === false) await this.flee(task, goal, save);
      } else await this.flee(task, goal, save);
      onStep(goal); return true;
    }
    delete this.state.trappedSince;
    // A bed in the pockets moves the whole question to bedtime: no site to
    // reserve at 9500, no blocks to gather, and at 12541 the choice is
    // sleep, or stay up armed because the dark is what the request needs.
    const bed = bedCarried(bot), homeBed = bedToSleepIn(bot, goal);
    const routeBlocked = failedWithin(this, 'bed_route', 'home', 120000);
    const underground = bot.game.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
    const bedReady = (!!bed || (!!homeBed && !routeBlocked)) && bot.game.dimension === 'overworld' && !sleepWaiting(this);
    // Dusk with a bed at home: head there before bedtime rather than start
    // the walk from the bottom of a shaft at 12541. The second run chose the
    // bed thirty blocks down its mine and the walk failed at once.
    // A failed direct walk pauses the walk, not the climb: the stairs out
    // of a shaft are a different route from a path search to the bed.
    // Home before bedtime: wait by the bed rather than hand the minute back
    // to the work loop, which dived to the lava site and was climbed out of
    // again every ten seconds until 12541.
    if (homeBed && shelterNeeded(bot) && bot.time.timeOfDay >= DAY.WALK_HOME && bot.time.timeOfDay < SLEEP_FROM && homeBed.foot.distanceTo(bot.entity.position) <= 6 && !immediateThreat(bot)) {
      // The minute before bedtime is a chore, not a wait: the stash, the
      // wheat, the cows; and once, the plot grows a column for the next day.
      // A chore that failed waits two minutes. Its error was swallowed and
      // the next tick ran it again: a harvest failing at one cell ran
      // twenty times a second through a whole evening, and nobody could
      // see why.
      const attempts = attemptsFor(this);
      const chores = Object.fromEntries(Object.entries(homeChores(bot, goal)).filter(([key]) => !attempts.resting('chore', key)));
      const home = homeOf(bot, goal);
      // Which chore, or none, is Jev's.
      // A chore whose walk runs past dark says so (the decision audit,
      // 2026-09-25): the cows fetched at dusk come back in the dark.
      const late = chore => chore.walkSeconds && bot.time.timeOfDay + chore.walkSeconds * 20 >= DAY.DARK ? ` Back after dark (${DAY.DARK}): mobs spawn on the way back.` : '';
      const tree = Object.fromEntries(Object.entries(chores).map(([key, chore]) => [key, { description: chore.description + late(chore), run: async () => {
        this.report(goal, save, { action: 'evening_chore', chore: key });
        const started = Date.now();
        try {
          await chore.run(bot, task, goal, save, this.actions);
          // Back in a blink with nothing done is the same loop without an error.
          if (Date.now() - started < 300) throw new Error('The chore returned at once without doing anything');
          attempts.clear('chore', key);
        }
        catch (err) {
          task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
          attempts.fail('chore', key, err, { restMs: 120000 }); save();
          console.log(`[chore] ${key} failed: ${err.message}`);
        }
      } }]));
      if (home?.completedAt && !home.plotWide) tree.grow_plot = { description: 'Mark the home plot to grow by a column tomorrow: more wheat, more bread.', run: async () => { home.plotWide = true; save(); this.report(goal, save, { action: 'grow_plot' }); } };
      tree.wait_for_bedtime = { description: `Wait by the bed for bedtime, ${Math.max(0, SLEEP_FROM - bot.time.timeOfDay)} ticks off (about ${Math.round(Math.max(0, SLEEP_FROM - bot.time.timeOfDay) / 20)} seconds).`,
        waits: require('./waits').timer('bedtime', Math.max(0, SLEEP_FROM - bot.time.timeOfDay) * 50),
        run: async () => { this.report(goal, save, { action: 'wait_for_bedtime', ticks: SLEEP_FROM - bot.time.timeOfDay }); for (let i = 0; i < 10; i++) { task.check(); await sleep(100); } } };
      const keys = Object.keys(tree);
      // Waiting chosen is held until bedtime or a new chore appears.
      const waiting = this.state.eveningWait?.keys === keys.join(',') && this.state.eveningWait.day === Math.floor((bot.time?.age ?? 0) / 24000);
      if (keys.length === 1 || waiting) await tree.wait_for_bedtime.run();
      else {
        const decision = await this.decide(task, goal, save, { id: 'evening_chore', tree, state: { timeOfDay: bot.time.timeOfDay, sleepPossibleFrom: SLEEP_FROM, health: bot.health, food: bot.food,
          riskNow: require('./risk').riskNow(bot), threats: threats(bot, 32).slice(0, 6).map(t => ({ name: t.entity.name, distance: Math.round(t.distance), visible: t.visible })) } });
        if (!decision.stale) {
          if (decision.path.at(-1) === 'wait_for_bedtime') this.state.eveningWait = { keys: keys.join(','), day: Math.floor((bot.time?.age ?? 0) / 24000) };
          await decision.action.run();
        }
      }
      onStep(goal); return true;
    }
    // The walk home for the night is Jev's to choose (go_home_for_night
    // below); once chosen it is held, not asked again every tick.
    // Underground, night is not a question: the dark down there is the same
    // at noon, and its mobs neither spawn more nor burn at dawn. The shelter,
    // the walk home and staying up were asked at y -50 mid-dig all night,
    // every two minutes, and the climbs out for them were 110 of 408
    // pre-Nether minutes (the decision review, 2026-09-26). The night comes
    // up when the work does, or after two nights awake, when the phantoms
    // waiting on the third are a reason to find a bed.
    // A shelter Jev chose underground is held as one above is (note 466).
    const nightFree = underground && !this.sleepDebt() && !(this.state.nightPlan?.plan === 'shelter' && this.state.nightPlan.until > Date.now());
    const nightNow = shelterNeeded(bot) && !nightFree;
    const homeWalk = homeBed && nightNow && homeBed.foot.distanceTo(bot.entity.position) > 6 && (underground || !routeBlocked) &&
      !sleepWaiting(this) && !isSetAside(this, 'surface_home', 'here');
    const heldPlan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    if (homeWalk && heldPlan?.plan === 'home') { heldPlan.until = Date.now() + 120000; await this.goHomeForNight(task, goal, save, homeBed, underground); onStep(goal); return true; }
    const plan = this.state.nightPlan?.until > Date.now() ? this.state.nightPlan : null;
    const stayingUp = plan?.plan === 'stay_up';
    // Before bedtime, a bed anywhere in reach (a walk that just failed
    // included) means no sealing in yet: the walk is retried in two minutes
    // and the shelter thirty blocks from the bed was the worse night.
    const needsShelter = nightNow && !stayingUp && plan?.plan !== 'hunt';
    // A shelter once chosen is a plan, not a question for every tick: the
    // second run climbed its shaft for a shelter, was asked again at the
    // top, went back down to the mine, and was asked again at the bottom.
    // Renewed while it is being carried out: a plan that lapsed after two
    // minutes of gathering blocks put the question again, and "carry on"
    // left the half-built shell standing in the dark.
    // A wait for daylight Jev chose, sealed (wait_for_day_sealed below): the
    // pocket is made here until it is sealed, then held in the pocket's step
    // until dawn. It ends when health comes back (hunger eighteen or more),
    // its reason gone, or when there is no way to shelter here.
    if (this.state.sealedWait && !(this.state.sealedWait.until > Date.now() && (bot.food ?? 20) < 18)) delete this.state.sealedWait;
    if (this.state.sealedWait) {
      if (await this.refugeStep(task, goal, save) !== false) { onStep(goal); return true; }
      delete this.state.sealedWait;
    }
    if (needsShelter && plan?.plan === 'shelter' && !(bedReady && sleepable(bot))) {
      plan.until = Date.now() + 120000;
      if (await this.refugeStep(task, goal, save) !== false) { onStep(goal); return true; }
      // refugeStep found no way to shelter here and rested it (`refuge`,
      // `anywhere`, 180 seconds): the plan it was held for is let go, so
      // this held shortcut and secure_shelter below both stop calling it
      // again on every tick until the rest is up (note 723).
      if (isSetAside(this, 'refuge', 'anywhere')) delete this.state.nightPlan;
    }
    if (!needsShelter && this.state.recovery?.status === 'pending') {
      this.report(goal, save, { action: 'recover_items', origin: this.state.recovery.position });
      if (await recoverItems(bot, task, this.state.recovery, save, this.actions.navigate)) { onStep(goal); return true; }
    }
    // The game ladder's early expedition kit is tools and wood; its food is
    // stocked before the Nether (preparingNether) and the End. Driven by the
    // kit, the search walked trial 20's first five minutes looking for an
    // animal at full hunger (2026-09-24).
    const expeditionFood = ((goal.preparingExpedition && goal.kind !== 'win') || goal.preparingEnd || goal.preparingNether) && bot.game.difficulty !== 'peaceful';
    // One reserve for the crossing, kept with the stash that fills it: it was
    // written out here, in the Nether gate and in the stash, three times.
    const desiredFood = goal.preparingEnd ? 64 : goal.preparingNether ? NETHER_FOOD_POINTS : KIT_FOOD_POINTS;
    // A missing reserve is worth a hunt while the bot is already on the
    // surface, where the animals are. Underground it is worth the climb only
    // once hunger is real: the dream run was leaving its iron shaft at 18 of
    // 20 to walk the surface for a chicken.
    // Off the Overworld there is nothing to hunt and nowhere to climb to:
    // food is a reason to go back through the portal, and only real hunger.
    const offWorld = !/overworld/.test(String(bot.game.dimension || 'overworld'));
    const hungerTrigger = offWorld ? 8 : surfaceObserver(bot)(bot.entity.position) ? 18 : 12;
    // A reserve is worth a few minutes of looking, not the whole day: a
    // stock-driven search that finds nothing in five minutes is set aside for
    // twenty, and only real hunger forages meanwhile. The seventh climb spent
    // half an hour on a bare mountain searching for a chicken at full hunger.
    // Hurt with hunger under eighteen and nothing to eat is hungry too: the
    // health does not come back until something is eaten. mid-87-f waited
    // six minutes at three health and sixteen hunger with no food carried,
    // "recovering before combat", and a zombie ended it (2026-09-26).
    const cannotHeal = !offWorld && (bot.health ?? 20) < 14 && bot.food < 18 && !chooseFood(bot);
    const hungry = bot.food <= hungerTrigger || cannotHeal;
    const stockDriven = !offWorld && (goal.stockFood || expeditionFood || (goal.kind === 'survive' && bot.game.difficulty !== 'peaceful'));
    const now = Date.now();
    // Stocked is stocked: the flag that asked for a reserve was never taken
    // down, so the stock-driven search ran for the rest of the goal.
    if (foodSupply(bot) >= desiredFood) { unwatch(this, 'food_search', 'stock'); delete goal.stockFood; }
    // The supervisor: five minutes of searching with no more food carried
    // sets the search aside for twenty. The clock used to run from the
    // first look whatever was found meanwhile.
    if (!hungry && stockDriven && foodSupply(bot) < desiredFood && !isSetAside(this, 'food_search', 'stock', now) &&
        watch(this, 'food_search', 'stock', foodSupply(bot), { better: 'higher', epsilon: 0.5, stallMs: 300000, restMs: 1200000, why: 'five minutes of searching brought no food', now }).stalled) save();
    // A stock-up (hunger met by what is carried, or none to meet) that has
    // kept nothing in three minutes rests with the stock search, said: 25595
    // was asked 38 times at hunger 17 to 20 with 64 to 79 points carried of
    // the 80 for the Nether, its hunts eaten again by the healing (note 702).
    const errands = require('./food-errand');
    const supplyNow = foodSupply(bot), fills = errands.fillsHunger(bot, supplyNow);
    let errand = null;
    if (supplyNow < desiredFood && (stockDriven || hungry) && (!hungry || fills) && !isSetAside(this, 'food_search', 'stock', now)) {
      errand = errands.track(this.state, { supply: supplyNow, desired: desiredFood, now });
      if (errands.noYield(errand, supplyNow, now)) {
        const why = errands.restWhy(errand, supplyNow, now);
        setAside(this, 'food_search', 'stock', why, errands.REST_MS);
        this.report(goal, save, { action: 'food_errand_rested', why, food: bot.food, foodPoints: supplyNow, wanted: desiredFood });
        errands.end(this.state); errand = null; delete this.state.foodPlan; save();
      }
    } else if (supplyNow >= desiredFood) errands.end(this.state);
    const stockPaused = isSetAside(this, 'food_search', 'stock', now);
    // Resting, low hunger that what is carried fills is met by eating, not by
    // a search.
    const needsFood = supplyNow < desiredFood && ((hungry && !(stockPaused && fills)) || (stockDriven && !stockPaused));
    if (!needsShelter && !needsFood) return false;
    // "Carry on" is an answer too, held as a food trip is: on the surface
    // at hunger eighteen the question came back every pass while Jev said
    // carry on, each asking with its route surveys, until one pass said
    // food (the decision review, 2026-09-26). Held for five minutes, until
    // hunger falls two or health four from when it was chosen, or the night
    // comes; then asked again with what changed.
    const carryOn = this.state.carryOnPlan;
    if (carryOn && (carryOn.until < now || needsShelter || bot.food <= carryOn.food - 2 || (bot.health ?? 20) <= carryOn.health - 4)) delete this.state.carryOnPlan;
    if (this.state.carryOnPlan) return false;
    // Whether the shelter kept can be walked to from here, looked for before
    // it is offered (refugeWay; the walk reads the same search).
    const refugeWay = needsShelter && refuge ? await this.refugeWay(task, refuge, { keep: true }) : null;
    const state = { playerRequest: goal.request, retainedGoal: goal.kind, timeOfDay: bot.time.timeOfDay, riskNow: require('./risk').riskNow(bot), deathWouldCost: this.deathCost(goal), recentPositions: require('./stillness').recentPositions(bot),
      ...(require('./exploration').biomeView(bot) || {}),
      playerUrgency: goal.urgency ? { level: goal.urgency.level, meaning: 'How much the wording of the request pressed for speed: relaxed, ordinary or pressed. Pressure is a reason to keep working while it is still safe, never a reason to skip shelter once night is close.' } : undefined,
      health: bot.health, food: bot.food, safeFoodCarried: !!chooseFood(bot),
      // The day's facts where there is a day (note 677).
      survivalFacts: { difficulty: bot.game.difficulty, ...(/overworld/.test(String(bot.game?.dimension || 'overworld')) ? { hostileMobsSpawnAtNight: true,
        nightStartsAt: DAY.NIGHT, dawnAt: DAY.DAWN, daylightTicksRemaining: Math.max(0, DAY.NIGHT - bot.time.timeOfDay) } : {}),
        bedCarried: !!bed, homeBedNearby: !!homeBed, homeBedDistance: homeBed ? Math.round(homeBed.foot.distanceTo(bot.entity.position)) : null, underground,
        sleepPossibleFrom: SLEEP_FROM, armedAndArmoured: kitReady(bot), armourWorn: [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean), weapon: defenseWeapon(bot)?.name || null, nightsWithoutSleepTooMany: !!this.sleepDebt(),
        shelterReady: !!refuge?.verifiedAt, shelterDistance: refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null,
        ...(refugeWay ? { shelterWayFromHere: refugeWay === 'success' ? 'found' : refugeWay === 'noPath' ? 'none found' : 'not known: the route search ran out of time' } : {}) },
      recentSurvivalAction: goal.survivalAction, carriedBuildingBlocks: shelter.materialStock(bot),
      foodReserve: { foodPoints: foodSupply(bot), desiredMinimum: desiredFood, for: errands.reserveFor(goal), hungerMaximum: 20, starvationAt: 0,
        requiredBeforeExpedition: !!expeditionFood, ...(() => { const last = lastResortSupply(bot); return last.points ? { lastResort: `${last.points} more food points in the last resort, not counted in the reserve: ${last.says}` } : {}; })() } };
    const armed = kitReady(bot);
    // "Armed and armoured" is kitReady's own bar (a weapon and every armour
    // slot filled), and a bot with a sword but no armour read the same as
    // one with neither: said apart, so a sword carried is not lost inside a
    // false "not armed" (note 742).
    const weaponNow = defenseWeapon(bot)?.name || null;
    const armourNow = [5, 6, 7, 8].map(slot => bot.inventory.slots?.[slot]?.name).filter(Boolean);
    const kitSaysNow = `${weaponNow ? `the ${weaponNow.replaceAll('_', ' ')} carried` : 'no weapon carried'}, ${armourNow.length ? `${armourNow.length} piece${armourNow.length === 1 ? '' : 's'} of armour worn` : 'no armour worn'}`;
    // Phantoms come for a player who has not slept in three nights. After
    // two nights awake (sealed in, night mining, staying up), staying up is
    // off the table while a bed is on offer.
    // At night carrying on is staying up, two minutes at a time; whether the
    // kit, the bed and the nights without sleep make that wise is Jev's to
    // weigh from the facts.
    const stayUp = night(bot) && needsShelter;
    // The mobs about now, seen or not, and whether health comes back,
    // beside staying up (the decision audit, 2026-09-25).
    const about = state.riskNow.hostilesWithin;
    const nowAbout = about.count ? ` Within ${about.blocks} blocks now: ${about.count} hostile mob${about.count === 1 ? '' : 's'}${about.count > about.inSight ? `, ${about.count - about.inSight} of them out of sight` : ''}${about.kinds.includes('creeper') ? ', creepers among them' : ''}.` : '';
    // What fighting the nearest of them would cost, the same figure
    // hunt_zombie prices beside it (note 742): 25597 sealed against one
    // zombie 7 blocks off at full health with an iron sword, told only the
    // night and dawn, secure_shelter silent on the zombie it was sealing
    // against or what meeting it would cost.
    const nearestThreat = threats(bot, 24).slice().sort((a, b) => a.distance - b.distance)[0] || null;
    const threatFightSays = (() => {
      if (!nearestThreat) return '';
      const one = fightEstimate({ threats: [{ name: nearestThreat.entity.name, distance: nearestThreat.distance, shoots: shooter(nearestThreat.entity),
        ...(nearestThreat.entity.heldItem?.name ? { held: nearestThreat.entity.heldItem.name } : {}), visible: nearestThreat.visible }],
        armour: armourNow, weapon: weaponNow, health: bot.health, shield: bot.inventory?.slots?.[45]?.name === 'shield' }).fightHere;
      return ` Nearest: a ${nearestThreat.entity.name.replaceAll('_', ' ')} ${Math.round(nearestThreat.distance)} blocks off${nearestThreat.visible ? '' : ' (heard, not seen)'}; fighting it with ${kitSaysNow} is about ${one.seconds} seconds and ${one.damageTaken} damage, from ${Math.round(bot.health)} health.`;
    })();
    const healing = (bot.food ?? 20) >= 18 ? '' : ` Health does not come back meanwhile: hunger ${bot.food}, below eighteen.`;
    // Those coming at the bot now, and how soon, against the quickest
    // pocket here (a shaft underfoot): mid-244-a's four zombies walked up
    // from ten blocks while this and the pocket's way were asked, told only
    // "within 24 blocks now: 7 hostile mobs", and the shaft took longer
    // than their walk (note 544).
    const toward = comingAt(bot);
    const shaftHere = toward.length && typeof this.actions.dig === 'function' ? this.shaftColumn({ radius: 0 }) : null;
    const pocketSecs = shaftHere?.bottom ? shaftSeconds(bot, shaftHere).seconds : null;
    const comingNow = comingSays(toward, pocketSecs != null ? { seconds: pocketSecs, doing: 'a shaft pocket dug here' } : {});
    if (toward.length) state.comingAtTheBot = comingFacts(toward);
    // The work the night holds up, named on the ways to spend it, and
    // underground that the night changes nothing there (note 531).
    const waiting = workWaiting(goal, bot);
    const tree = {
      continue_request: { description: stayUp
        ? `Stay up and keep on with ${waiting || 'the request'} ${underground ? 'underground' : 'outside in the dark'}, two minutes at a time. ${underground ? `${BELOW_NIGHT} The way back up comes out among the surface's mobs until dawn` : 'Hostile mobs spawn around the bot all night'}; it has ${kitSaysNow}${bedReady ? ', and the bed is one action away' : ', and there is no bed to fall back on'}.${this.sleepDebt() ? ' It has not slept for two nights: phantoms come for a player on the third.' : ''}${nowAbout}${threatFightSays}${healing}`
        : goal.kind === 'survive' ? 'Wait nearby between player requests when survival preparations are already sufficient.'
          : underground ? `Keep on with ${waiting || 'the request'} underground. ${BELOW_NIGHT} Nightfall on the surface is about ${Math.round(((DAY.NIGHT - (bot.time?.timeOfDay ?? 0) + 24000) % 24000) / 1200)} real minutes off.${nowAbout}${healing}`
            // No daylight to spend off the Overworld (note 677).
            : !/overworld/.test(String(bot.game?.dimension || 'overworld')) ? `Spend the next action on ${waiting || 'the player request'}. No day or night comes here: what it is weighed against is the hunger and the health, which comes back only at hunger eighteen or more.${nowAbout}${healing}${require('./last-hit').riskSays(bot)}`
            : 'Spend the next action on the player request while outside. Suitable when hunger and the remaining daylight leave time for survival preparations afterwards, or when a verified shelter is already close enough to reach.',
        run: async () => { if (stayUp) { this.state.nightPlan = { plan: 'stay_up', until: Date.now() + 120000 }; this.report(goal, save, { action: 'stay_up', armed }); } } },
    };
    if (stayUp) {
      for (const [key, o] of Object.entries(this.huntOptions(goal))) tree[key] = { description: o.description,
        run: async () => { this.state.nightPlan = { plan: 'hunt', kind: o.kind, until: Date.now() + 120000, startHealth: bot.health }; this.report(goal, save, { action: 'night_hunt_chosen', kind: o.kind }); } };
      const stash = this.stashOption(goal);
      if (stash) tree.stash_valuables = { description: stash.description, run: () => stash.run(task, goal, save) };
      const cache = !stash && this.cacheOption(goal);
      if (cache) tree.cache_valuables = { description: cache.description, run: () => cache.run(task, goal, save) };
    }
    if (homeWalk) {
      const distance = Math.round(homeBed.foot.distanceTo(bot.entity.position));
      // The climb out and when the walk arrives against nightfall (the
      // decision audit, 2026-09-25).
      const { climbToSurface, climbMinutes } = require('./surface');
      const climb = underground ? climbToSurface(bot, bot.entity.position) : 0;
      const seconds = Math.round(distance / 4.3) + (climb || 0) * 3;
      const arrives = Math.round(bot.time.timeOfDay + seconds * 20);
      const arrival = arrives >= DAY.NIGHT ? `arriving about ${arrives % 24000}, after nightfall at ${DAY.NIGHT}` : `arriving about ${arrives}, before nightfall at ${DAY.NIGHT}`;
      tree.go_home_for_night = { description: `Walk home to the bed ${distance} blocks away${underground ? `, climbing out of the mine first (${climb != null ? `about ${climb} blocks up, roughly ${climbMinutes(climb)} minutes` : 'how far up is not known'})` : ''}, about ${Math.round(distance / 4.3)} seconds at a walk, ${arrival}, and wait there for bedtime (sleep is possible from ${SLEEP_FROM}; it is ${Math.round(bot.time.timeOfDay)} now). Held until the bot is there.`,
        run: async () => { this.state.nightPlan = { plan: 'home', until: Date.now() + 120000 }; await this.goHomeForNight(task, goal, save, homeBed, underground); } };
    }
    // A creeper about and how soon it could go off beside the bot, on every
    // way to spend the night: mid-243-p chose the bed with a creeper eleven
    // blocks off, told only of monsters within eight of it, and was blown up
    // putting it down (note 503), where the shelter said the race.
    const creeperRaceSays = creeperSays(bot);
    // The game's own rule, said plainly on every way to sleep, not only
    // where a monster is already within it: 25594 ran fourteen blocks from
    // a creeper, was told nothing of it or the rule on sleep_in_bed's own
    // text (the fact sat unused in the question's state, within twenty-four
    // blocks), slept, and the creeper closed the distance and went off
    // beside the bed, 20 to 1.2 (note 747).
    const sleepRuleSays = ' The game refuses the sleep while a monster is within about eight blocks sideways and five up or down of the bed, seen or not; one farther off now can still close that ground and go off beside the bed before or during the sleep.';
    // Sleep is an option where the bed fits: two level cells beside the
    // feet. In a one-wide shaft it is not, and the shelter path digs in.
    if (needsShelter && bedReady && sleepable(bot) && ((homeBed && !underground) || bedSite(bot))) {
      // The walk to the bed and the monsters about it, seen or not: sleep is
      // refused while any is within eight blocks (the decision audit).
      const walk = homeBed ? Math.round(homeBed.foot.distanceTo(bot.entity.position)) : 0;
      // Offered with them counted, not hidden while any mob is within ten
      // (the decision review, 2026-09-26): one may be killed first, or be
      // outside the eight and five that refuse a sleep.
      const byBed = monstersByBed(bot, homeBed && !bed ? homeBed.foot : bot.entity.position);
      const refused = byBed ? refusalSays(bot, homeBed && !bed ? homeBed.foot : bot.entity.position) : '';
      tree.sleep_in_bed = { description: homeBed && !bed ? `Walk to the bed ${walk} blocks away (about ${Math.round(walk / 4.3)} seconds) and sleep in it. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.${nowAbout}${sleepRuleSays}${refused}${creeperRaceSays}` : `Put the carried bed down here and sleep. The night passes in seconds, nothing is built or spent, and the request resumes at dawn.${nowAbout}${sleepRuleSays}${refused}${creeperRaceSays}`, run: () => this.sleepStep(task, goal, save) };
    }
    // Where the carried bed does not fit (a staircase, a shaft), a nook dug
    // for it beside the bot: the bed that went down in the midgame trials
    // of 2026-09-26 was offered only on two level cells, and the bot sealed
    // itself in eleven times with it on its back.
    const nook = needsShelter && bed && bedReady && sleepable(bot) && !bedSite(bot) && !isSetAside(this, 'bed_nook', 'here') && bedNook(bot, goal);
    if (nook) tree.sleep_in_nook = { description: `Where the bed does not fit as the ground lies, ${nookSays(bot, nook)} Nothing is built or spent, and the request resumes at dawn.${nowAbout}${creeperRaceSays}`, run: () => this.nookSleep(task, goal, save) };
    // Beside a bed a shelter is the worse answer, and the option says so
    // rather than being hidden.
    // A creeper about, and how soon it could go off beside the bot, said on
    // the shelter as on every stance: first-days-222 chose the shelter with
    // a creeper five blocks off, told only of sealing a room before night,
    // and was blown up three seconds later (2026-09-26).
    // Underground at night the shelter is no question while health comes
    // back or is whole. When it does not, sealing in until dawn is a real
    // way beside the climb to food on the night surface: mid-207-l, at 5.2
    // health, hunger 16 and no food, was offered only the request and a
    // food search, climbed toward the surface at night, and a zombie and a
    // spider met it on the way (note 466).
    const woundedBelow = underground && nightFree && shelterNeeded(bot) && (bot.health ?? 20) < 20 && healing;
    // The shelter kept, and whether there is a way to it from here: with none,
    // this is a pocket, a shaft or a room at a new site, asked next.
    const refugeAt = refuge ? Math.round(pos(refuge.origin).distanceTo(bot.entity.position)) : null;
    const shelterWaySays = !refugeWay ? '' : refugeWay === 'success' ? ` The shelter ${refuge.verifiedAt ? 'used before' : 'begun before'} is ${refugeAt} blocks off, and a way to it from here is found.`
      : refugeWay === 'noPath' ? ` The shelter ${refuge.verifiedAt ? 'used before' : 'begun before'}, ${refugeAt} blocks off, has no way to it from here (a route search found none): chosen, it is set aside, and the way (a pocket here, a shaft, a room at a new site) is asked next, a new site looked for first.`
      : ` The shelter ${refuge.verifiedAt ? 'used before' : 'begun before'} is ${refugeAt} blocks off; whether there is a way to it from here is not known (the route search ran out of time).`;
    // And what the place is, beside the wait for dawn: a spawner's mobs do
    // not leave at daylight (mid-220-g, note 476).
    // Already sealed in the shelter this would build, or refugeStep's own
    // "no way to shelter here" rest standing (`refuge`/`anywhere`, 180
    // seconds): not offered, so it is not asked again at once for a run
    // that can only decline or do nothing. mid-242-tb and mid-242-sg (note
    // 723) asked secure_shelter 38 and 45 times in seven and eight seconds,
    // already sealed, each run of refugeStep quietly returning without
    // building anything while survival_priority kept asking as if one more
    // try might. The [repeat] catch (repeats.js) is built for a question
    // whose facts and answer repeat; it caught this only after about forty
    // askings because refugeStep's own block placements (while it still had
    // work to do) counted as something coming of the answer each time, so
    // the run judged as unchanged only began once the shell was already
    // whole and nothing was left to place.
    const sealedNow = refuge && shelter.inside(bot, refuge) && shelter.sealed(bot, refuge);
    const shelterRests = isSetAside(this, 'refuge', 'anywhere');
    if (shelterRests && (needsShelter || woundedBelow)) state.secureShelterNotOffered = 'no way to shelter here (rests a while)';
    else if (sealedNow && (needsShelter || woundedBelow)) state.secureShelterNotOffered = 'already sealed in the shelter it would build';
    if ((needsShelter || woundedBelow) && !sealedNow && !shelterRests) tree.secure_shelter = { description: (woundedBelow
      ? `Seal a pocket here underground and wait in it for dawn, about ${minutesToDawn(bot)} real minutes off: ${Math.round(bot.health * 10) / 10} health, which does not come back meanwhile (hunger ${bot.food}, below eighteen), and hunger drops slowly while still. The surface above is night, with its mobs, until dawn, when those in the open burn; underground the dark is the same at any hour.${nowAbout}${threatFightSays}`
      // Health and gear said here too, not only on continue_request: 25592
      // walled itself in at full health over one skeleton 26 blocks off,
      // and 25584 asked secure_shelter and rest_to_heal back and forth four
      // times healing from 17 to 20, the threat never named on
      // secure_shelter's own text (note 747).
      : `Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved. Dawn is about ${minutesToDawn(bot)} real minutes off: that much of the run${waiting ? ` with ${waiting} waiting` : ''}. ${(() => { const off = this.nightMineOff(); return off ? `In the shelter it can only wait: ${off}.` : 'In the shelter it can mine or wait.'; })()}${underground ? ` ${BELOW_NIGHT}${BELOW_NIGHT_SURFACE}` : ''} Health ${Math.round(bot.health * 10) / 10} of 20, ${kitSaysNow}.${nowAbout}${threatFightSays}`) + shelterWaySays + comingNow + creeperRaceSays + (this.placeAbout(goal)?.says || '') + (bedReady ? ` A bed is in reach: sleeping in it (possible from ${SLEEP_FROM}) passes the night in seconds, and a shelter spends the night awake.` : ''),
      run: async () => { this.state.nightPlan = { plan: 'shelter', until: Date.now() + 120000 }; await this.refugeStep(task, goal, save); } };
    // At night too, with what it risks said, not hidden (the decision
    // audit, 2026-09-25): hungry in the dark, the food was never offered.
    // Said with the hunger, the points carried and what the reserve is for
    // and wants, and the errand so far (food-errand.js, note 702).
    if (needsFood) tree.obtain_food = { description: `${errands.says(bot, goal, { supply: supplyNow, desired: desiredFood, hungry, errand, now })} Keep the player request saved.` + (night(bot) && needsShelter ? ` Night: mobs spawn on the way; starvation at hunger 0.` : '') +
        (night(bot) && underground ? ` Food is mostly on the surface, and it is night there until dawn, about ${minutesToDawn(bot)} real minutes off; the climb up comes out among its mobs. ${Math.round(bot.health * 10) / 10} health now${healing ? ', not coming back' : ''}.` : ''),
      children: offWorld && this.actions.returnOverworld ? this.offWorldFood(task, goal, save) : await forageChoices(bot, task, goal, save, this.actions, this.state, { target: desiredFood }) };
    if (tree.obtain_food && !Object.keys(tree.obtain_food.children).length) delete tree.obtain_food;
    // The trip home left out for its walk cannot begin from here (note 706).
    if (needsFood && offWorld && !tree.obtain_food?.children?.return_for_food) { try { const c = require('./mob-hunt').tripHomeClosed(bot, goal); if (c) state.tripHome = c.says; } catch (_) { /* none */ } }
    // Waiting sealed for daylight, anywhere in the Overworld, when health
    // does not come back and no shelter is on offer already: by day, on the
    // surface, it was never a choice. mid-231-q and mid-211-x went on hunting
    // and working hurt under eighteen hunger with nothing safe to eat, and
    // the next encounter finished them (note 515). Priced in minutes, since
    // standing still spends no hunger, with what is outside.
    const sealedWait = sealedWaitSays(bot);
    if (sealedWait && !tree.secure_shelter && !isSetAside(this, 'refuge', 'anywhere'))
      tree.wait_for_day_sealed = { description: `${sealedWait.says}${underground ? ' Underground the dark is the same at any hour.' : ''}${nowAbout || ' Nothing hostile is within twenty-four blocks now.'}${comingNow}${creeperRaceSays}`,
        // By day, daylight is what it has: not offered (waits.js, note 698).
        waits: require('./waits').daylight(bot),
        run: async () => {
          this.state.sealedWait = { until: Date.now() + sealedWait.ticks * 50, at: new Date().toISOString() };
          this.report(goal, save, { action: 'wait_for_day_sealed', health: bot.health, food: bot.food, minutes: sealedWait.minutes });
          await this.refugeStep(task, goal, save);
        } };
    // Resting where it is while health comes back, when it does (hunger
    // eighteen or more): mid-241-i, at 2.3 health and hunger nineteen, had
    // only food to choose, walked back past the skeleton it had got away
    // from, and was shot (2026-09-27).
    if ((bot.health ?? 20) < 20 && (bot.food ?? 0) >= 18) {
      const seconds = Math.round((20 - bot.health) * 4);
      tree.rest_to_heal = { description: `Stay where it is, still, and let health come back: ${Math.round(bot.health * 10) / 10} health now, hunger ${bot.food}, about one health each four seconds while hunger stays at eighteen or more, so about ${seconds} seconds to twenty; the healing uses up hunger meanwhile.${nowAbout || ' Nothing hostile is within twenty-four blocks now.'}${comingNow} Asked again after half a minute.`,
        waits: require('./waits').heal(bot),
        run: async () => {
          this.report(goal, save, { action: 'rest_to_heal', health: bot.health, food: bot.food });
          for (const until = Date.now() + 30000; Date.now() < until && bot.health < 20 && (bot.food ?? 0) >= 18;) { task.check(); checkThreats(bot); await sleep(250); }
        } };
    }
    // A reserve top-up once chosen is held, not asked again: at full health
    // and hunger "get food or carry on" went to Jev every five seconds,
    // thirty times in two bursts, obtain_food each time at 0.96 to 0.98.
    // Held for five minutes, while food is still wanted and nothing needs
    // shelter; the source is still Jev's to choose each time.
    const foodPlan = this.state.foodPlan;
    if (foodPlan && (foodPlan.until < Date.now() || !needsFood || needsShelter || stockPaused)) delete this.state.foodPlan;
    if (this.state.foodPlan && tree.obtain_food) delete tree.continue_request;
    // A choice whose way is resting is not a choice now: first-days-213
    // chose secure_shelter thirty times in five seconds, its sealing resting
    // after "Shelter verification failed", each run refused at once and the
    // question asked again (2026-09-26). It rests as long as what it ran
    // into, and Jev is told why.
    const notNow = {};
    for (const [key, entry] of Object.entries(attemptsFor(this).of('priority_option'))) {
      if (!tree[key]) continue;
      delete tree[key];
      notNow[key] = `${entry.why}; back in about ${Math.max(1, Math.round((entry.until - Date.now()) / 1000))} seconds`;
    }
    if (Object.keys(notNow).length) state.notNow = notNow;
    if (!Object.keys(tree).length) return false;
    const runChosen = async (key, option) => {
      try { await option.run(); }
      catch (err) {
        if (err.name !== 'SetAside') throw err;
        setAside(this, 'priority_option', key, err.message, Math.max(1000, (err.until || Date.now() + 60000) - Date.now())); save();
        return false;
      }
      return true;
    };
    // One option is not a question. Jev was asked to pick the only shelter
    // on offer every night the bot could not stay up.
    if (Object.keys(tree).length === 1 && !Object.values(tree)[0].children) { const [key, only] = Object.entries(tree)[0]; await runChosen(key, only); onStep(goal); return true; }
    // A search already chosen and under way is not asked about again at
    // once: 25598 was asked "obtain_food -> search_food" every twenty to
    // forty seconds for fifteen minutes while it climbed to the surface
    // for it, told each time only that the errand's minute count had gone
    // up (note 747). Held briefly, while the same search is still on offer
    // and nothing about the bot has gotten worse.
    const searchFoodHold = this.state.searchFoodHold;
    if (searchFoodHold?.until < Date.now()) delete this.state.searchFoodHold;
    if (this.state.searchFoodHold && tree.obtain_food?.children?.search_food && !immediateThreat(bot)) {
      await runChosen('obtain_food', { run: () => tree.obtain_food.children.search_food.run() }); onStep(goal); return true;
    }
    const decision = await this.decide(task, goal, save, { id: 'survival_priority', state, tree, interrupt: () => checkThreats(bot),
      isFresh: () => bot.health === state.health && bot.food === state.food && !immediateThreat(bot) });
    onStep(goal);
    if (decision.stale) return true;
    if (decision.path.at(-1) === 'search_food') this.state.searchFoodHold = { until: Date.now() + 45000 }; else delete this.state.searchFoodHold;
    if (decision.path[0] === 'obtain_food' && !hungry && !this.state.foodPlan) this.state.foodPlan = { until: Date.now() + 300000, at: new Date().toISOString() };
    if (decision.path[0] === 'continue_request') {
      delete this.state.foodPlan;
      if (!needsShelter) this.state.carryOnPlan = { until: Date.now() + 300000, food: bot.food, health: bot.health ?? 20 };
    } else delete this.state.carryOnPlan;
    if (!await runChosen(decision.path[0], { run: () => decision.action.run() })) return false;
    return decision.path[0] !== 'continue_request';
  }
}

// On the bot's own pillar, `rise` or more up: its body over the pillar's
// column, not its floored feet. A player stands on a block while any of its
// width is over it, and mid-242-a, stepped 0.9 along its pillar's top by a
// shelter walk, stood at x 19.15 on the top at x 18: floored, its feet read
// as the air beside, the edge rule walked it off, and it fell six blocks
// among the three zombies the pillar had kept off (note 535).
function onPillarTop(bot, pillar, rise = 2) {
  const p = bot.entity?.position;
  if (!pillar || !p) return false;
  const reach = 0.5 + (bot.entity.width || 0.6) / 2;
  return Math.abs(p.x - (pillar.x + 0.5)) < reach && Math.abs(p.z - (pillar.z + 0.5)) < reach && Math.floor(p.y + 0.01) >= pillar.y + rise;
}

// A pocket answer the step carries out without asking (stepOnce's pocket
// branch): the wait for daylight chosen sealed while health does not come
// back, the nook or the bed beside chosen for tonight, or pocket_next's own
// answer held its ninety seconds. -> { choice, secondsAgo, forSeconds, why }
// or null. The held answer is read as the step reads it, but for its key
// (the options on offer), which only the step builds: said as held "while
// the pocket and what is about stay as they were".
function pocketHeldOf(bot, state, now = Date.now()) {
  const left = until => Math.max(1, Math.round((until - now) / 1000));
  if (state.bedNookPlan?.until > now) return { choice: 'sleep_in_nook', forSeconds: left(state.bedNookPlan.until), why: 'the nook chosen for tonight when the pocket was sealed' };
  if (state.sealedWait?.until > now && (bot.food ?? 20) < 18) return { choice: 'stay', forSeconds: left(state.sealedWait.until), why: 'the wait for daylight chosen sealed (survival priority), until dawn or hunger eighteen' };
  if (state.bedBesidePlan?.until > now) return { choice: 'sleep_beside', forSeconds: left(state.bedBesidePlan.until), why: 'the bed beside chosen for tonight' };
  const p = state.pocketPlan;
  if (p?.until > now && p.choice) return { choice: p.choice, secondsAgo: Math.round((now - (p.at || now)) / 1000), forSeconds: left(p.until), why: 'pocket next\'s own answer, held while the pocket and what is about stay as they were' };
  return null;
}

// What this layer would claim of the turn (src/arbiter.js), read from the
// same conditions stepOnce acts on and without acting: nothing is walked,
// searched, reported or set aside here. A plan that failed or rests is a
// fact on the claim, not the claim's end: stepOnce returned false for one,
// and mid-231-o's turn fell to the work at 0.9 health (notes 465, 466).
// The edge step (off_the_edge) is left out: its drop and ground searches
// are not cheap.
function claim(bot, goal = {}, survival = null) {
  if (!bot?.entity?.position || bot.game?.gameMode === 'creative') return null;
  const state = survival?.state || goal.survival || {};
  const hp = bot.health ?? 20, now = Date.now();
  const round = n => Math.round(n * 10) / 10;
  const reflex = require('./arbiter').observeReflexes(bot).find(r => r.layer === 'survival');
  // A pocket being sealed here, said with the mob: "answer the skeleton"
  // alone was what mid-226-h's Jev read, its seal stuck on the skeleton's
  // cell (note 520).
  const sealing = sealingSays(bot, state, now);
  const pocket = sealing ? { pocket: sealing.says } : {};
  // An alert (a creeper in reach, a mob at arm's length) is pressing, and
  // who answers it is Jev's (arbiter.js ALERTS); the body's physics is a reflex.
  // A stance Jev chose that still holds goes on, and is said so, not a
  // stance asked next: the step asks none while one holds (flee, note 696).
  const heldStance = (() => { const s = require('./danger').stanceHeld(bot, now); return s?.choice && s.choice !== 'keep_working' ? { stance: { choice: s.choice, secondsAgo: Math.round((now - s.at) / 1000) } } : {}; })();
  if (reflex && require('./arbiter').ALERTS.has(reflex.key)) return { layer: 'survival', action: reflex.action, urgency: 'pressing', alert: reflex.key, facts: { ...reflex.facts, ...pocket, ...(reflex.key === 'creeper' ? heldStance : {}) } };
  if (reflex) return { layer: 'survival', action: reflex.action, urgency: 'body', reflex: reflex.key, facts: reflex.facts, preemptible: false };
  // What rests, and why: the facts a failed plan leaves. Read straight from
  // the record (progress.js), which attemptsFor would create on a first look.
  const resting = {}, attempts = Object.values(state.attempts || {});
  const rests = (action, target) => attempts.some(e => e.action === action && String(e.target) === target && e.until > now);
  for (const entry of attempts) if (entry.action === 'act' && entry.until > now && String(entry.target).startsWith('survival:'))
    resting[String(entry.target).slice(9)] = `${entry.why}; back in about ${Math.max(1, Math.round((entry.until - now) / 1000))} seconds`;
  const hurt = bot._recentHurtAt > now - 4000;
  // Whether health comes back, on every claim of a hurt bot: it was said on
  // a shooter's alone (note 515).
  const facts = { health: hp, food: bot.food, ...(hp < 20 ? { healing: (bot.food ?? 0) >= 18 } : {}), ...(bot.time?.timeOfDay !== undefined && /overworld/.test(String(bot.game?.dimension || 'overworld')) ? { timeOfDay: bot.time.timeOfDay } : {}), ...(hurt ? { hurtLately: true } : {}),
    ...(Object.keys(resting).length ? { setAside: resting } : {}) };
  const make = (action, urgency, more = {}) => ({ layer: 'survival', action, urgency: hurt && urgency === 'routine' ? 'pressing' : urgency, facts: { ...facts, ...more } });
  const mob = t => ({ name: t.entity.name, distance: round(t.distance), seen: !!t.visible });
  // The drop beside the bot a push can put it over to its death, said on
  // the claim wherever something about can push it (danger.js
  // pushOverDrop): mid-242-ac-nether-3's turn_priority read neither the
  // drop nor the piglin's crossbow, and its arrow put the bot nineteen
  // blocks down (note 586).
  const pushOver = require('./danger').pushOverDrop(bot);
  // With a ghast in sight whose fireball's push carries the bot over it,
  // that push, its rate of fire and the footing out of it (note 612).
  const blast = pushOver ? blastOverSays(bot, { health: hp }) : null;
  const edgeFact = pushOver ? { edge: require('./terrain').dropNote(pushOver.drop, hp, bot).trim(), ...(blast ? { push: blast.says.trim() } : {}) } : {};
  // A mob at its own reach, as stepOnce's atArm: arm's length, and a spear
  // holder's longer reach (danger.js atItsReach, note 586). In sight, or
  // within two.
  const atArm = require('./danger').atReach(bot, threats(bot, 8));
  if (atArm.length) return make('escape_threat', 'pressing', { atArm: atArm.slice(0, 3).map(t => ({ ...mob(t), ...(t.entity.heldItem?.name ? { held: t.entity.heldItem.name } : {}), canReach: 'at its reach of the bot now' })), ...edgeFact, ...pocket });
  const refuge = survival?.currentShelter?.();
  const underground = bot.game?.dimension === 'overworld' && !surfaceObserver(bot)(bot.entity.position);
  // With how long it has been in the pocket and what it was sealed against
  // (pocket-wait.js, note 584).
  const insideRefuge = refuge && shelter.inside(bot, refuge);
  const sealedNow = insideRefuge && shelter.sealed(bot, refuge);
  const shutOpen = insideRefuge && !sealedNow ? shelter.closedIn(bot, refuge) : null;
  // Sealed once before (refuge.verifiedAt) and standing in it now, even with
  // a wall open that is neither whole nor only a fluid gap (closedIn's own
  // case): its own mining or working free opened it, not a shelter never
  // begun, so this is still the pocket's question, not a fresh "shelter for
  // the night" read as if none existed. 25589 (mid-242-wb) had turn_priority
  // read "Shelter for the night... asked next" nine times in under three
  // minutes while sitting and working in a pocket sealed once already
  // (critic 08:17Z, note 736).
  const openedSinceSealed = insideRefuge && !sealedNow && !shutOpen && refuge.verifiedAt;
  // A pocket answer that holds is carried out by the step without asking
  // (stepOnce's held choice, the wait for daylight chosen sealed, the nook
  // or the bed chosen for tonight): said so, not "asked next". 25594
  // (mid-239-ae, 10:45 to 10:53Z) was told "whether to stay, leave or do
  // something else there is asked next" every minute for eight minutes
  // sealed at y 8 with nothing to eat, while the wait for daylight chosen
  // at 10:44:57 answered stay each pass and pocket_next was never asked
  // (note 752).
  const pocketHeld = insideRefuge ? pocketHeldOf(bot, state, now) : null;
  if (insideRefuge && (sealedNow || shutOpen || openedSinceSealed)) return make('pocket_next', 'routine', { inPocket: true, night: shelterNeeded(bot),
    ...(pocketHeld ? { pocketHeld } : {}), ...(underground ? { underground: true } : {}),
    ...(shutOpen ? { pocketNotWhole: pocketOpenSays(shutOpen) } : openedSinceSealed ? { pocketNotWhole: 'shut before, but not now: a wall was opened since it was last sealed (its own mining, or working free)' } : {}),
    ...(require('./pocket-wait').pocketWaitSays(bot, state, goal, { near: threats(bot, 64), night: shelterNeeded(bot),
      // Whether the wait waits for nothing, as the pocket's own question
      // reads it (note 679): nothing to eat, and no spawner in reach.
      noFood: foodSupply(bot) === 0 && !(lastResortSupply(bot).points > 0), spawner: (() => { try { return survival?.placeAbout?.(goal)?.spawner || null; } catch (_) { return null; } })() })?.claim || {}) });
  const nightPlan = state.nightPlan?.until > now ? state.nightPlan : null;
  // The wait for daylight Jev chose, sealed, while it is being sealed.
  if (state.sealedWait?.until > now && (bot.food ?? 20) < 18) return make('wait_for_day_sealed', 'routine', { minutesToDawn: minutesToDawn(bot), healing: false, ...(underground ? { underground: true } : {}) });
  const hunting = nightPlan?.plan === 'hunt' && (nightPlan.food || shelterNeeded(bot));
  // A shooter is a threat as far as its own fire reaches (combat-estimate
  // RANGE, danger.js immediateThreat), hurt or not: being in its sight is
  // being under fire. mid-235-p-fortress-1 stood at 5.5 health with a blaze
  // 16.5 blocks off, past the sixteen then counted for a blaze; survival
  // claimed nothing, only the hunt and the work were offered, and the next
  // fireball threw it off the edge (note 509). Said with what it has done
  // and whether health comes back, for Jev to weigh.
  const threat = immediateThreat(bot);
  // The hunt Jev chose is the claim only while nothing else is on the bot:
  // its own kind is no threat (nightHunted), anything else comes first, as
  // stepOnce answers it (note 541).
  // A hoglin hunt said with whether one can be won at this health and where
  // the nearest is: mid-235-q-nether-2-fortress-4 went on with one at 4
  // health, the hoglin 47 blocks off, told only "Health 4." (note 607).
  if (hunting && !threat) {
    let hoglin = null;
    if (nightPlan.kind === 'hoglin') try {
      const { hoglinsKnown, hoglinFight } = require('./nether-travel');
      const known = hoglinsKnown(bot, goal), nearest = known.inView[0], seen = known.seen[0];
      hoglin = { hoglinFight: `${nearest ? `The nearest hoglin is in view ${Math.round(nearest.position.distanceTo(bot.entity.position))} blocks off.` : seen ? `None in view; ${seen.says}.` : 'No hoglin in view or seen in the last half hour.'} ${hoglinFight(bot, nearest ? nearest.position.distanceTo(bot.entity.position) : 8).says}` };
    } catch (_) { hoglin = null; }
    return make('night_hunt', 'routine', { hunting: nightPlan.kind || null, ...(nightPlan.food ? { forFood: true } : {}), ...(hoglin || {}) });
  }
  // A blaze's with the chance its fire lands from where it is, the game's
  // scatter (combat-estimate fireballHit): it is claimed where its volleys
  // mostly land or its shots have landed, and said so.
  const firing = t => {
    const hit = bot._hurtBy?.[t.entity.name], inFlight = require('./projectile-guard').incoming(bot, { reach: RANGE[t.entity.name] || 15 }).length;
    const { fireballHit, volleyHit, FIRE_REACH } = require('./combat-estimate');
    const lands = t.entity.name === 'blaze' ? { fireballLandsPer100: Math.round(fireballHit(t.distance) * 100), volleyLandsOnePer100: Math.round(volleyHit(t.distance) * 100), volleysMostlyLandWithin: FIRE_REACH.blaze } : {};
    return { shoots: true, reach: RANGE[t.entity.name] || 15, ...lands, ...(hit > now - 30000 ? { hitItSecondsAgo: Math.round((now - hit) / 1000) } : {}), ...(inFlight ? { shotsInFlight: inFlight } : {}) };
  };
  // A mob held by the stance Jev chose (danger.js stanceMobs): said with the
  // stance, which goes on, not a stance asked next (note 535).
  const holding = threat?.stance && bot._stance ? { stance: { choice: threat.stance, secondsAgo: Math.round((now - bot._stance.at) / 1000) } }
    // One still coming at the bot once that stance is over (danger.js
    // followers): said with its speed and how soon it is at the bot, the
    // stance asked again with it (note 544).
    : threat?.following ? { comingAtTheBot: { after: threat.following, blocksASecond: round(threat.speed), atBotInSeconds: round(threat.atBotIn) } }
    // A stance Jev chose that holds, the threat another than its own: the
    // step carries that stance out and asks none (flee asks only while none
    // holds), so it is said to go on, not "asked next". 25595's hold on its
    // span was held on for minutes (holds.js) while every turn_priority said
    // "the stance is asked next" of the hoglin beside it (note 752).
    : heldStance.stance ? { stance: { ...heldStance.stance, other: true } } : {};
  const reachOf = t => { try { const r = require('./danger').reachSays(bot, t); return r ? { canReach: r } : {}; } catch (_) { return {}; } };
  // Up on its own pillar, how the hold has gone (pillar-wait.js, note 590).
  const pillarSays = onPillarTop(bot, state.pillar) ? require('./pillar-wait').pillarClaimSays(state, now) : null;
  const onPillar = pillarSays ? { onPillar: pillarSays } : {};
  if (threat) return make('escape_threat', 'pressing', { ...(threat.projectile ? { threat: { name: threat.entity.name, distance: round(threat.distance), projectile: true } }
    : shooter(threat.entity) ? { threat: { ...mob(threat), ...firing(threat), ...reachOf(threat) }, healing: (bot.food ?? 0) >= 18 } : { threat: { ...mob(threat), ...reachOf(threat) } }), ...holding, ...edgeFact, ...pocket, ...onPillar });
  // One that has stood off (danger.js standsOff, note 752): no threat that
  // stops the work, but still Jev's to answer or leave be, offered beside
  // the work as routine with that fact said: never at its reach, no nearer
  // and no hit from its kind for a minute and more. Chosen, the stance is
  // asked of it as of any (stepOnce); left, the work runs, and the moment it
  // comes nearer, to its reach, or its kind lands a hit, it is a threat
  // again and the work is stopped for it as before.
  const off = immediateThreat(bot, { stoodOff: true });
  if (off) return make('escape_threat', 'routine', { threat: { ...mob(off), ...(shooter(off.entity) ? firing(off) : {}), ...reachOf(off) }, standsOff: off.stoodOff.seconds,
    ...(off.stance && bot._stance ? { stance: { choice: off.stance, secondsAgo: Math.round((now - bot._stance.at) / 1000) } } : heldStance.stance ? { stance: { ...heldStance.stance, other: true } } : {}), ...edgeFact, ...pocket, ...onPillar });
  // Something that can push the bot over a deadly drop beside it, though
  // it is no threat by the counts above (a shooter in sight past the
  // sixteen counted, a biter the hunt has not claimed at eight): a push is
  // the fall's whole cost (note 586).
  if (pushOver) {
    const t = pushOver.pushers[0];
    return make('escape_threat', 'pressing', { threat: t.projectile ? { name: t.entity.name, distance: round(t.distance), projectile: true } : shooter(t.entity) ? { ...mob(t), ...firing(t), ...reachOf(t) } : { ...mob(t), ...reachOf(t) }, ...(heldStance.stance ? { stance: { ...heldStance.stance, other: true } } : {}), ...edgeFact, ...pocket });
  }
  // sleepDebt() without its first-look write of sleptAtAge.
  const debt = Number.isFinite(worldAge(bot)) && Number.isFinite(state.sleptAtAge) && worldAge(bot) - state.sleptAtAge > SLEEP_DEBT_TICKS;
  const nightFree = underground && !debt && nightPlan?.plan !== 'shelter';
  const needsShelter = shelterNeeded(bot) && !nightFree && nightPlan?.plan !== 'stay_up' && nightPlan?.plan !== 'hunt';
  if (!needsShelter && state.recovery?.status === 'pending') return make('recover_items', 'routine', { dropsAt: state.recovery.position || null });
  const expeditionFood = ((goal.preparingExpedition && goal.kind !== 'win') || goal.preparingEnd || goal.preparingNether) && bot.game?.difficulty !== 'peaceful';
  const desiredFood = goal.preparingEnd ? 64 : goal.preparingNether ? NETHER_FOOD_POINTS : KIT_FOOD_POINTS;
  const offWorld = !/overworld/.test(String(bot.game?.dimension || 'overworld'));
  const hungerTrigger = offWorld ? 8 : !underground ? 18 : 12;
  const hungry = bot.food <= hungerTrigger || (!offWorld && hp < 14 && bot.food < 18 && !chooseFood(bot));
  const stockDriven = !offWorld && (goal.stockFood || expeditionFood || (goal.kind === 'survive' && bot.game?.difficulty !== 'peaceful'));
  const supply = foodSupply(bot);
  // As the layer reads it: resting, low hunger that what is carried fills is met by eating (note 702).
  const stockRests = rests('food_search', 'stock'), fills = require('./food-errand').fillsHunger(bot, supply);
  const needsFood = supply < desiredFood && ((hungry && !(stockRests && fills)) || (stockDriven && !stockRests));
  if (!needsShelter && !needsFood) return null;
  // "Carry on" is Jev's own answer, held: the work's turn by his choice.
  const carryOn = state.carryOnPlan;
  if (carryOn && !(carryOn.until < now || needsShelter || bot.food <= carryOn.food - 2 || hp <= carryOn.health - 4)) return null;
  const plan = nightPlan?.plan === 'shelter' || nightPlan?.plan === 'home' ? nightPlan.plan : null;
  // Whether health comes back, and the sealed wait for daylight when it does
  // not, said on the claim: turn_priority read "find food" beside the work
  // with neither (note 515).
  const last = needsFood ? lastResortSupply(bot) : null;
  const wait = sealedWaitSays(bot);
  // The night mine chosen from a pocket goes on under the rock before any
  // shelter is asked (stepOnce): said so, not "the way is asked next". Of
  // 608 secure_shelter wins since 2026-09-29 23Z, 360 saw no shelter
  // question in the next 30 seconds, 169 of them mining (note 752).
  const mining = needsShelter && state.nightMine && !surfaceObserver(bot)(bot.entity.position.offset(0, 1, 0))
    ? { nightMine: { minutes: Math.round((now - (state.nightMine.startedAt || now)) / 60000), mined: state.nightMine.mined || 0 } } : {};
  return make(needsShelter ? (plan === 'home' ? 'go_home_for_night' : 'secure_shelter') : 'obtain_food', needsShelter || bot.food <= 6 ? 'pressing' : 'routine',
    { ...(needsShelter ? { night: true, underground, ...(plan ? { plan } : {}), ...(underground && debt ? { sleepDebt: true } : {}), ...mining } : {}), ...(needsFood ? { foodCarried: supply, foodWanted: desiredFood, ...(last.points ? { lastResortCarried: last.points } : {}) } : {}),
      ...(wait ? { waitSealedMinutes: wait.minutes } : {}) });
}

module.exports = { routeOf, shotsDue, shotChanceNow, routeEdge, pushCarries, pushFooting, blastPushesOver, blastOverSays, pushAtSays, shotPushers, BLAST_THROW, wallCells, wallStock, searchBudget, lavaTop, lavaFill, swimReach, pocketPlan, pocketBiters, farBiters, piglinGoldSays, claim, chaseSays, groundBeside, onPillarTop, eatApple, LAVA_BLOCKS_A_SECOND, effectsSay, spawnerAbout, unseenBiters, fartherShootersSay, mobSourceAbout, shieldFacing, biterAtArm, pickaxeReserve, chargeSays, creeperSays, costSays, openCells, eatSays, mealHelps, EAT_AFTER, PILLAR_SECONDS, BLOCK_SECONDS, EAT_SECONDS, CLIMBERS, MOVING_STANCES, chargeStopsAt, usesToClimbOut, SLEEP_DEBT_TICKS, Survival, inLava, inWater, lavaExit, besideDrop, firmGround, night, shelterNeeded, lavaBeside, bedSite, bedNook, monstersByBed, monstersAtBed, refusalSays, nearbyHomeBed, observedBed, sleepable, SLEEP_FROM, keepShieldForStance, SHIELD_STANCES };
