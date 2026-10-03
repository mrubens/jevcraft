'use strict';
// An enderman fought from a slot (note 981): a tunnel one wide and two high
// dug two cells into rock, the bot at its back. An enderman is 2.9 tall and
// does not come into a space two high; from the slot's mouth its blow reaches
// about 1.1 blocks past its own body (the game's melee box, 0.83 past a body
// 0.3 from its middle) and the bot stands 1.5 from the mouth, while the
// sword reaches three. A look at its eyes brings it. In the open the trials'
// kit took a median 5.7 damage a kill and died in 3 of 13 arena fights
// (hunt_target's own record); on 2026-10-02 and 03 Jev left the endermen at
// 152 of 272 hunt_target askings, and 129 bot-minutes of stalking and
// hunting them brought 16 pearls.
const { Vec3 } = require('vec3');
const ROCK = /^(netherrack|warped_nylium|crimson_nylium|blackstone|basalt|soul_soil|soul_sand|stone|deepslate|dirt|grass_block|andesite|diorite|granite|tuff|cobblestone|nether_wart_block|warped_wart_block|end_stone|sandstone|nether_bricks)$/;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const EYES = 2.55, REACH = 3, SWING_MS = 650, HURT_STOP = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STARE_MS = 450, STARE_EVERY_MS = 12000;
// A look that does not turn it is tried again after three seconds, three
// times, and one turned is waited for twenty seconds (note 996): of the
// first five fights live (2026-10-03), three ran their whole minute with an
// enderman about that never came, a look every twelve seconds.
const STARE_AGAIN_MS = 3000, STARE_MISSES = 3, TURNED_WAIT_MS = 20000;
// The server's own word that it has been stared at or screams (its entity
// data, 17 and 18): one brought is not gone out to again.
const angry = e => !!(e.metadata?.[17] || e.metadata?.[18]);

// Along the slot to `to`. With `eyes` (an entity) the look stays on its eyes
// the whole way, the legs worked for whichever way that leaves the slot's
// line: an enderman looked at stands still, and comes when the look breaks.
async function walkTo(bot, task, to, out, eyes) {
  const until = Date.now() + 2500;
  const at = () => bot.entity.position;
  const ahead = () => (to.x - at().x) * out.x + (to.z - at().z) * out.z;
  const keys = ['forward', 'back', 'left', 'right'];
  try {
    while (Date.now() < until && Math.abs(ahead()) > 0.15) {
      task.check();
      if (eyes && eyes.isValid !== false) { bot._stareMeant = { id: eyes.id, until: Date.now() + 500 }; await bot.lookAt(eyes.position.offset(0, EYES, 0), true); }
      else await bot.lookAt(at().offset(out.x * 4, 1.62, out.z * 4), true);
      // Held to the slot's middle line as it goes: the legs have eight ways only.
      const off = (to.x - at().x) * out.z + (to.z - at().z) * out.x, pull = Math.max(-1, Math.min(1, off * 4));
      const sign = Math.sign(ahead()), wx = out.x * sign + out.z * pull, wz = out.z * sign + out.x * pull, yaw = bot.entity.yaw;
      const f = wx * -Math.sin(yaw) + wz * -Math.cos(yaw), l = wx * -Math.cos(yaw) + wz * Math.sin(yaw);
      bot.setControlState('forward', f > 0.38); bot.setControlState('back', f < -0.38);
      bot.setControlState('left', l > 0.38); bot.setControlState('right', l < -0.38);
      await sleep(40);
    }
  } finally { for (const key of keys) bot.setControlState(key, false); }
}

// A slot from a cell stood in: { mouth, a, b, d, digs } or null. The two
// cells past the mouth with a floor and a roof of their own, rock on both
// sides and behind, nothing molten beside what is dug.
function slotFrom(bot, f) {
  const at = c => bot.blockAt(c), solid = b => !!b && b.boundingBox === 'block', open = b => !!b && b.boundingBox === 'empty' && !/lava|water|fire/.test(b.name);
  const rock = b => solid(b) && ROCK.test(b.name);
  if (!open(at(f)) || !open(at(f.offset(0, 1, 0))) || !solid(at(f.offset(0, -1, 0)))) return null;
  for (const [dx, dz] of DIRS) {
    const a = f.offset(dx, 0, dz), b = f.offset(2 * dx, 0, 2 * dz), back = f.offset(3 * dx, 0, 3 * dz), side = new Vec3(dz, 0, dx);
    const cells = [a, a.offset(0, 1, 0), b, b.offset(0, 1, 0)];
    if (!cells.every(c => rock(at(c)) || open(at(c)))) continue;
    if (![a, b].every(c => solid(at(c.offset(0, -1, 0))) && solid(at(c.offset(0, 2, 0))))) continue;
    if (![a, b].every(c => [0, 1].every(dy => solid(at(c.plus(side).offset(0, dy, 0))) && solid(at(c.minus(side).offset(0, dy, 0)))))) continue;
    if (![0, 1].every(dy => solid(at(back.offset(0, dy, 0))))) continue;
    const digs = cells.filter(c => solid(at(c)));
    const near = c => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([x, y, z]) => /lava|water/.test(at(c.offset(x, y, z))?.name || ''));
    if (cells.some(near)) continue;
    return { mouth: f, a, b, d: new Vec3(dx, 0, dz), digs };
  }
  return null;
}

// The nearest slot within `reach` of the bot: where it stands, or a cell at
// its height (a block up or down) walked to. With `toward` (an enderman),
// a slot whose mouth has a line to its eyes comes first, marked `line`
// (note 1000): the look that brings it is from the mouth, and where rock or
// a stem stands between it does not turn.
const lineFrom = (bot, mouth, e) => { try { return require('./danger').lineClear(bot, mouth.offset(0.5, 1.62, 0.5), e.position.offset(0, EYES, 0)); } catch (_) { return false; } };
function slotSite(bot, { reach = 6, toward = null } = {}) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
  const here = bot.entity.position.floored();
  const out = [];
  for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) for (const dy of [0, 1, -1]) {
    const f = here.offset(dx, dy, dz);
    const s = slotFrom(bot, f);
    if (s) out.push({ ...s, off: Math.abs(dx) + Math.abs(dz) + Math.abs(dy) });
  }
  out.sort((x, y) => x.off - y.off || x.digs.length - y.digs.length);
  if (!toward?.position) return out[0] || null;
  for (const s of out.slice(0, 24)) if (lineFrom(bot, s.mouth, toward)) return { ...s, line: true };
  return out[0] ? { ...out[0], line: false } : null;
}

function says(site, n) {
  return `Fight it from a slot: dig a tunnel one wide and two high two cells into the rock ${site.off ? `${site.off} blocks off at (${site.mouth.x}, ${site.mouth.y}, ${site.mouth.z})` : 'beside where the bot stands'} (${site.digs.length} blocks to dig), stand at its back and look the enderman in the eyes from its mouth to bring it${site.line ? ' (the mouth has a line to its eyes now)' : ''}. An enderman is 2.9 blocks tall and does not come into a space two high; from the mouth its blow falls about 0.4 blocks short of the bot, and the sword reaches it there. Each is struck until it dies and its drop taken from the mouth${n > 1 ? `; ${n} are about, and those that come are taken one after another` : ''}.`;
}

// The arena's record (scripts/terrain.js enderman_slot, 2026-10-03): an iron
// sword, no armour, no shield, a slot dug with an iron pickaxe.
const RECORD = { runs: 26, kills: 26, damage: 0, seconds: 15, late: { runs: 10, pearls: 7 } };
function recordSays() {
  return `The arena's record of this way, one enderman, an iron sword and no armour or shield: ${RECORD.runs} fights, ${RECORD.kills} kills, no damage taken in any, about ${RECORD.seconds} seconds each with the slot's four blocks dug by an iron pickaxe; with the drop waited for where it falls, ${RECORD.late.pearls} pearls from the last ${RECORD.late.runs}. With Jev's own answers and the trials' kit, a wall three blocks off: 3 fights, the slot chosen in each, 3 kills, 2 pearls, no damage. It goes out to look only at one that has not turned, three looks at most, and one turned is waited for twenty seconds.`;
}

const endermen = (bot, within = 40) => Object.values(bot.entities || {}).filter(e => e.name === 'enderman' && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= within)
  .sort((x, y) => x.position.distanceTo(bot.entity.position) - y.position.distanceTo(bot.entity.position));

// -> { kills, pearls, hurt, ended }
async function fight(bot, task, site, { navigate, seconds = 60, want = 1, item = 'ender_pearl' } = {}) {
  const { goals } = require('mineflayer-pathfinder');
  const bridging = require('./bridging');
  const count = () => (bot.inventory?.items?.() || []).filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
  const had = count(), hp0 = bot.health;
  const out = { kills: 0, pearls: 0, hurt: 0, ended: 'time' };
  if (!bot.entity.position.floored().equals(site.mouth)) await navigate(bot, task, new goals.GoalBlock(site.mouth.x, site.mouth.y, site.mouth.z), { timeoutMs: 8000, stallMs: 2500 });
  for (const c of site.digs) { task.check(); await bridging.clearCell(bot, task, c, { wall: true }); }
  await navigate(bot, task, new goals.GoalBlock(site.b.x, site.b.y, site.b.z), { timeoutMs: 5000, stallMs: 2000 });
  if (!bot.entity.position.floored().equals(site.b)) { out.ended = 'the back of the slot was not reached'; return out; }
  const sword = (bot.inventory?.items?.() || []).filter(i => /_sword$|_axe$/.test(i.name)).sort((x, y) => (/_sword$/.test(y.name) ? 1 : 0) - (/_sword$/.test(x.name) ? 1 : 0))[0];
  if (sword) { try { await bot.equip(sword, 'hand'); } catch (_) { /* the hand, then */ } }
  let dead = 0;
  let fell = null;
  let fellAt = 0;
  const onDead = e => { if (e?.name === 'enderman') { dead++; fell = e.position.clone(); fellAt = Date.now(); } };
  bot.on('entityDead', onDead);
  let hp = bot.health;
  const onHealth = () => { if (bot.health < hp) { const e = endermen(bot)[0]; console.log(`[slot] hurt ${(hp - bot.health).toFixed(1)} at (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}), slot back (${site.b.x + 0.5}, ${site.b.z + 0.5}), enderman ${e ? `(${e.position.x.toFixed(1)}, ${e.position.y.toFixed(1)}, ${e.position.z.toFixed(1)})` : 'none'}`); } hp = bot.health; };
  bot.on('health', onHealth);
  const deadline = Date.now() + seconds * 1000;
  let lastSwing = 0, lastStare = 0, misses = 0, turnedAt = null;
  try {
    while (Date.now() < deadline) {
      task.check();
      out.hurt = Math.max(0, hp0 - (bot.health ?? hp0));
      if (out.hurt >= HURT_STOP) { out.ended = 'hurt'; break; }
      if (count() - had >= want) { out.ended = 'pearl'; break; }
      const e = endermen(bot)[0];
      if (!e) { out.ended = dead ? 'none left' : 'none came'; if (dead || Date.now() > deadline - (seconds - 8) * 1000) break; await sleep(250); continue; }
      const eye = bot.entity.position.offset(0, 1.62, 0);
      // To the nearest of its body, 2.9 tall.
      const d = Math.hypot(e.position.x - eye.x, e.position.z - eye.z, Math.max(e.position.y - eye.y, 0, eye.y - (e.position.y + 2.9)));
      if (d <= REACH + 0.3) {
        // At the mouth: struck at the body, the swing at its pace.
        turnedAt = Date.now();
        if (Date.now() - lastSwing >= SWING_MS) { await bot.lookAt(e.position.offset(0, 1.0, 0), true); bot.attack(e); lastSwing = Date.now(); }
      } else if (angry(e)) {
        // Turned: waited for at the back, the eyes on the mouth's floor
        // (one looked at stands where it is); one that does not come in
        // twenty seconds is left (note 996).
        turnedAt ??= Date.now();
        if (Date.now() - turnedAt > TURNED_WAIT_MS) { out.ended = 'it turned and did not come to the mouth in twenty seconds'; break; }
        await bot.lookAt(site.mouth.offset(0.5, 0, 0.5), true);
      } else if (misses >= STARE_MISSES) {
        out.ended = `${STARE_MISSES} looks from the mouth did not turn it (no line to its eyes from there)`; break;
      } else if (Date.now() - lastStare > STARE_AGAIN_MS && e.position.distanceTo(bot.entity.position) > 5) {
        // Brought by a look at its eyes, meant: from the mouth, where the
        // slot's walls do not hide it, and back in before it has come.
        lastStare = Date.now();
        const centre = c => c.offset(0.5, 0, 0.5);
        await walkTo(bot, task, centre(site.mouth), site.d.scaled(-1));
        const until = Date.now() + STARE_MS;
        // How far off its eyes the look was at its worst while it was held
        // (something else turning the head shows here), for the miss's line.
        let worst = 0;
        const aimError = () => {
          const eye = bot.entity.position.offset(0, 1.62, 0), to = e.position.offset(0, EYES, 0).minus(eye), d = to.norm() || 1;
          const yaw = bot.entity.yaw, pitch = bot.entity.pitch;
          const look = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
          const dot = Math.max(-1, Math.min(1, (look.x * to.x + look.y * to.y + look.z * to.z) / d));
          return Math.acos(dot) * 180 / Math.PI;
        };
        while (Date.now() < until && e.isValid !== false) {
          task.check();
          bot._stareMeant = { id: e.id, until: Date.now() + 500 };
          await bot.lookAt(e.position.offset(0, EYES, 0), true);
          await sleep(50);
          worst = Math.max(worst, aimError());
        }
        const staredFrom = bot.entity.position.clone(), staredAt = e.position.clone();
        await walkTo(bot, task, centre(site.b), site.d.scaled(-1), e);
        delete bot._stareMeant;
        // Whether it turned: the server's word, a moment after.
        for (let i = 0; i < 10 && !angry(e); i++) { task.check(); await sleep(100); }
        if (!angry(e)) {
          misses++;
          // Why a look did not turn it, for the next reading of these (note 1007).
          let line = null; try { line = require('./danger').lineClear(bot, staredFrom.offset(0, 1.62, 0), staredAt.offset(0, EYES, 0)); } catch (_) { line = null; }
          const need = Math.acos(Math.max(-1, 1 - 0.025 / Math.max(1, staredFrom.distanceTo(staredAt)))) * 180 / Math.PI;
          console.log(`[slot] look ${misses} did not turn it: ${Math.round(staredFrom.distanceTo(staredAt))} blocks off, ${Math.round(staredAt.y - staredFrom.y)} up, line from where it was looked at ${line}, the look at worst ${Math.round(worst * 10) / 10} degrees off its eyes (the game wants under ${Math.round(need * 10) / 10}), held ${STARE_MS} ms, its state ${JSON.stringify((e.metadata || []).slice(15, 19))}, in hand ${bot.heldItem?.name || 'nothing'}, head ${bot.inventory?.slots?.[5]?.name || 'bare'}`);
        }
      }
      // One looked at stands where it is: the eyes go to the mouth's floor
      // while it is waited for.
      else await bot.lookAt(site.mouth.offset(0.5, 0, 0.5), true);
      await sleep(100);
    }
    delete bot._stareMeant;
    // The drops where the last fell: out for them, where nothing stands
    // there. A mob's drop comes a second after its death (the body's fall)
    // and is picked up half a second after that: waited for, and each one
    // seen within six blocks walked to (note 996: in the arena's first 26
    // kills 7 pearls were carried, where about half drop one; the walk had
    // come and gone before the pearl lay there).
    if (fell && !endermen(bot, 8).length) {
      const safety = err => { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; };
      const drops = () => Object.values(bot.entities || {}).filter(x => x.getDroppedItem?.()?.name === item && x.position.distanceTo(fell) <= 6);
      while (Date.now() - fellAt < 1200) { task.check(); await sleep(100); }
      try { await navigate(bot, task, new goals.GoalNear(fell.x, fell.y, fell.z, 1), { timeoutMs: 5000, stallMs: 1500 }); } catch (err) { safety(err); }
      for (const until = Date.now() + 4000; Date.now() < until;) {
        task.check();
        const drop = drops()[0];
        if (!drop) { if (Date.now() - fellAt > 2500) break; await sleep(150); continue; }
        const p = drop.position;
        try { await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 0), { timeoutMs: 2500, stallMs: 1000 }); } catch (err) { safety(err); }
        await sleep(250);
      }
    }
  } finally { bot.removeListener('entityDead', onDead); bot.removeListener('health', onHealth); delete bot._stareMeant; }
  out.kills = dead; out.pearls = count() - had; out.hurt = Math.max(0, hp0 - (bot.health ?? hp0));
  console.log(`[slot] ${out.kills} endermen killed from the slot, ${out.pearls} pearls, ${Math.round(out.hurt * 10) / 10} health lost: ${out.ended}`);
  return out;
}

// The same slot against tall walkers that come on their own (note 987): a
// wither skeleton is 2.4 blocks tall and 0.7 wide, does not go under a roof
// two high, and its blow reaches about 1.5 blocks centre to centre; the bot
// at the slot's back stands 1.85 from the nearest it can stand. No look
// brings them and none is gone out to: they are struck as each comes to the
// mouth, one at a time, the slot being one wide. Dug with the back to them:
// the two cells nearest first and stepped into, then the two behind.
const TALL = { wither_skeleton: 2.4, enderman: 2.9 };
// Into the slot, the back to what comes: to its mouth, the two cells
// nearest dug and stepped into, then the two behind. Throws StanceFailed
// where its back is not reached.
async function enter(bot, task, site, { navigate } = {}) {
  const { goals } = require('mineflayer-pathfinder');
  const bridging = require('./bridging');
  if (!bot.entity.position.floored().equals(site.mouth)) await navigate(bot, task, new goals.GoalBlock(site.mouth.x, site.mouth.y, site.mouth.z), { timeoutMs: 6000, stallMs: 2000 });
  const centre = c => c.offset(0.5, 0, 0.5), outward = site.d.scaled(-1);
  for (const cell of [site.a, site.b]) {
    for (const c of [cell.offset(0, 1, 0), cell]) { task.check(); await bridging.clearCell(bot, task, c, { wall: true }); }
    await walkTo(bot, task, centre(cell), outward);
  }
  if (!bot.entity.position.floored().equals(site.b)) throw Object.assign(new Error(`the back of the slot at (${site.b.x}, ${site.b.y}, ${site.b.z}) was not reached`), { name: 'StanceFailed' });
}
async function stand(bot, task, site, { navigate, names = ['wither_skeleton'], seconds = 45 } = {}) {
  const hp0 = bot.health, out = { kills: 0, hurt: 0, ended: 'time', inAt: null };
  const t0 = Date.now();
  const about = (within) => Object.values(bot.entities || {}).filter(e => names.includes(e.name) && e.isValid !== false && e.position && e.position.distanceTo(bot.entity.position) <= within)
    .sort((x, y) => x.position.distanceTo(bot.entity.position) - y.position.distanceTo(bot.entity.position));
  try { await enter(bot, task, site, { navigate }); }
  catch (err) { task.check(); if (err.name !== 'StanceFailed') throw err; out.ended = err.message; out.hurt = Math.max(0, hp0 - bot.health); return out; }
  out.inAt = Date.now() - t0;
  const sword = (bot.inventory?.items?.() || []).filter(i => /_sword$|_axe$/.test(i.name)).sort((x, y) => (/_sword$/.test(y.name) ? 1 : 0) - (/_sword$/.test(x.name) ? 1 : 0))[0];
  if (sword) { try { await bot.equip(sword, 'hand'); } catch (_) { /* the hand, then */ } }
  let dead = 0, lastSwing = 0, quietSince = null;
  const onDead = e => { if (names.includes(e?.name)) dead++; };
  bot.on('entityDead', onDead);
  const deadline = Date.now() + seconds * 1000;
  try {
    while (Date.now() < deadline) {
      task.check();
      const e = about(24)[0];
      if (!e) { quietSince ??= Date.now(); if (Date.now() - quietSince > 4000) { out.ended = dead ? 'none left' : 'none came'; break; } await sleep(150); continue; }
      quietSince = null;
      const eye = bot.entity.position.offset(0, 1.62, 0);
      const d = Math.hypot(e.position.x - eye.x, e.position.z - eye.z, Math.max(e.position.y - eye.y, 0, eye.y - (e.position.y + (TALL[e.name] || 2))));
      if (d <= REACH + 0.3 && Date.now() - lastSwing >= SWING_MS) { await bot.lookAt(e.position.offset(0, 1.0, 0), true); bot.attack(e); lastSwing = Date.now(); }
      else await bot.lookAt(site.mouth.offset(0.5, 1.2, 0.5), true);
      await sleep(80);
    }
  } finally { bot.removeListener('entityDead', onDead); }
  out.kills = dead; out.hurt = Math.max(0, hp0 - (bot.health ?? hp0));
  console.log(`[slot] stood in the slot against ${names.join(', ').replaceAll('_', ' ')}: in after ${out.inAt} ms, ${out.kills} killed, ${Math.round(out.hurt * 10) / 10} health lost: ${out.ended}`);
  return out;
}

module.exports = { lineFrom, enter, stand, TALL, slotSite, slotFrom, says, fight, recordSays, RECORD };
