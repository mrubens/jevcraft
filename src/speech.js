'use strict';
// Player chat uses short, everyday language. Full engine errors and decision
// traces stay in saved state and logs, where debugging details belong.
const name = value => String(value || 'items').replace(/^minecraft:/, '').replaceAll('_', ' ');
const list = tasks => tasks.map(t => `${t.count} ${name(t.item)}`).join(', ');

// Not every blocker can be retried. Once the world no longer matches the saved
// plan, resume fails the same way every time, so name what does help instead.
const REPLAN = /building site changed/i;
// Radians of yaw either side of where Jev was already facing: a glance around
// while it ponders, never a full spin.
const SWAY = [-.55, .35, -.15, .7, .1, -.4];
function recoveryHint(error) {
  return REPLAN.test(String(error?.message || error || ''))
    ? 'Ask me to build it again and I will pick a fresh spot.'
    : 'Say "Jev resume" to try again.';
}

// Model calls and long searches leave the body perfectly still, which reads as
// "it did not hear me" rather than "it is thinking". A bare arm swing is the
// only safe emote here: it writes one arm_animation packet and touches no
// physics, controls or rotation. Looking around would fight the flight
// controller and boat paddling, which rewrite yaw every tick; sneaking would
// corrupt the deliberate sneak in placement and navigation recovery. Repeated
// chat is not an option either, because vanilla kicks for spam.
function thinking(bot, intervalMs = 1500) {
  if (typeof bot?.swingArm !== 'function') return () => {};
  const swing = () => { try { bot.swingArm('right'); } catch (_) { /* a closed socket is not worth reporting */ } };
  // Where Jev was facing before it started pondering, to be given back at the
  // end so a think never leaves it staring off in a new direction.
  const home = bot.entity && Number.isFinite(bot.entity.yaw) ? { yaw: bot.entity.yaw, pitch: bot.entity.pitch } : null;
  const canLook = home && typeof bot.look === 'function';
  const glance = (yaw, pitch) => {
    try { Promise.resolve(bot.look(yaw, pitch, true)).catch(() => {}); } catch (_) { /* as above */ }
  };
  // Looking around is only safe while Jev is standing still. The navigator
  // aims the head every tick while it flies or walks, and an emote must never
  // fight it for that; comparing position beat to beat needs no knowledge of
  // which subsystem is driving.
  let previous = bot.entity?.position?.clone?.() || null, beat = 0;
  const tick = () => {
    const here = bot.entity?.position;
    const still = here && previous && here.distanceTo(previous) < .05;
    if (here?.clone) previous = here.clone();
    // An even beat reads as a stuck animation rather than as thought, so the
    // arm rests every third one and the head drifts on its own longer cycle.
    if (beat % 3 !== 2) swing();
    if (still && canLook) glance(home.yaw + SWAY[beat % SWAY.length], home.pitch + (beat % 4 === 0 ? -.3 : .12));
    beat++;
  };
  swing(); beat = 1;
  const timer = setInterval(tick, Math.max(200, Math.round(intervalMs / 2)));
  timer.unref?.();
  return () => {
    clearInterval(timer);
    if (canLook) glance(home.yaw, home.pitch);
  };
}

// One rule for everything the bot says: the same line twice in short
// succession is a stuck bot, not news. Installed once on the bot, it drops an
// exact repeat within the window, except when a player spoke a moment ago,
// because "Jev status" asked twice deserves the same answer twice.
function quietRepeats(bot, { windowMs = 120000, replyMs = 15000 } = {}) {
  if (typeof bot?.chat !== 'function' || bot._quietRepeats) return bot;
  const original = bot.chat.bind(bot), said = new Map();
  bot._quietRepeats = { dropped: 0 };
  bot._client?.on?.('playerChat', () => { bot._lastPlayerChatAt = Date.now(); });
  bot.chat = message => {
    const text = String(message), now = Date.now();
    const answering = now - (bot._lastPlayerChatAt || 0) < replyMs;
    if (!answering && said.has(text) && now - said.get(text) < windowMs) { bot._quietRepeats.dropped++; return; }
    said.set(text, now);
    if (said.size > 64) said.delete(said.keys().next().value);
    return original(message);
  };
  return bot;
}

function friendlyProblem(error) {
  const text = String(error?.message || error || '');
  if (/silk touch/i.test(text)) return 'I need a tool with Silk Touch to pick up that block.';
  if (/That place is in the /i.test(text)) return text;
  if (REPLAN.test(text)) return 'Something new is in the way where I planned to build, so that plan no longer fits.';
  if (/No supported survival acquisition|bedrock/i.test(text)) return 'I don\'t know a way to get that in Survival.';
  if (/Chest handover is unconfirmed/i.test(text)) return text;
  if (/chest.*(?:lid|open)|free block near you for a chest/i.test(text)) return text;
  if (/handover was interrupted|pickup.*(?:unconfirmed|not confirmed)/i.test(text)) return 'I\'m not sure you got all the items. Please check the ground nearby before asking for more.';
  if (/recipient|player.*(?:visible|loaded)|cannot see|can.t see|pickup.*confirm/i.test(text)) return 'I need you a bit closer so I can give you the items.';
  if (/inventory.*full|inventory space|free.*slot/i.test(text)) return 'My pockets are full. I need to make some room.';
  if (/food|hungry|hunger/i.test(text)) return 'I need some food before I can keep going.';
  if (/tool|pickaxe|durability/i.test(text)) return 'I need the right tool before I can keep going.';
  if (/find|search|explor/i.test(text)) return 'I haven\'t found it yet. We may need to look farther away.';
  if (/route|path|reach|standing|navigation|stair|surface|obstruct|place|support/i.test(text)) return 'I can\'t reach a safe spot to do that yet.';
  if (/API|TypeSafe|OpenRouter|fetch|model|network|timeout|timed out/i.test(text)) return 'I\'m having trouble thinking right now. Please try again in a moment.';
  return 'I got stuck and couldn\'t finish that yet.';
}

function activity(step = {}) {
  if (step.action === 'combined_request') return activity(step.detail || { action: 'collect', item: step.item });
  const item = name(step.item || step.drops || step.resource || step.name || step.block);
  switch (step.action) {
    case 'boat_travel': return "I'm taking a boat across the water.";
    case 'reach_shore': return "I'm swimming back to dry land.";
    case 'prepare_build_site': return step.operation === 'fill' ? "I'm filling in a solid base for the building." : "I'm making the ground level for the building.";
    case 'craft': return `I'm making ${item}.`;
    case 'mine': case 'collect': return `I'm collecting ${item}.`;
    case 'deliver': return `I'm bringing you ${item}.`;
    case 'store_delivery': return `I'm putting your ${item} in a chest.`;
    case 'collect_nearby_resource': return `I spotted some ${item} nearby. I'll grab it, then get back to your task.`;
    case 'smelt': case 'cook_food': return `I'm cooking ${item === 'items' ? 'food' : item}.`;
    case 'make_obsidian': return { pour: "I'm pouring water on lava to make obsidian.", mine: "I'm mining the obsidian I made.", reach_lava: "I'm digging toward lava to make obsidian." }[step.phase] || "I'm making obsidian from lava.";
    case 'refuel_furnace': return step.item === 'oak_planks' ? "I'm getting more fuel for the furnace." : "I'm getting the missing supplies for the furnace.";
    case 'explore': case 'approach_discovery': case 'approach_found_creature': return `I'm looking for ${name(step.name || step.entity || step.resource)}.`;
    case 'come': return "I'm coming to you.";
    case 'follow': return "I'm following you.";
    case 'visit': return `I'm heading to ${step.label || 'the saved place'}.`;
    case 'eat': case 'eat_food': return "I'm eating something.";
    case 'return_to_surface': case 'ascend_to_surface': return "I'm finding a way back up.";
    case 'prepare_expedition_food': return "I'm packing some food for the trip.";
    case 'tunnel': return `I'm digging a staircase${step.target ? ` toward y=${step.target.y}` : ''}.`;
    case 'return_to_mine': return `I'm heading back to my ${item || 'mine'} shaft.`;
    case 'persist': return "I got stuck and I'm trying again.";
    case 'hunt_mob': return `I'm hunting a ${name(step.entity)} for ${item}.`;
    case 'stalk_mob': return `There's a ${name(step.entity)} near. I'm waiting for my chance.`;
    case 'find_fortress': return step.found ? "I can see a fortress. Heading for it." : `I'm sweeping for a fortress, leg ${step.legs || 1}.`;
    case 'recover_before_combat': return "I'm getting my strength back before a fight.";
    case 'equip_combat': case 'prepare_combat_equipment': return "I'm getting my armour and sword on.";
    case 'home_site': return "I'm looking for a spot for a base.";
    case 'level_site': return `I'm levelling the ground for the base: ${step.digs || 0} to dig, ${step.fills || 0} to fill.`;
    case 'pour_water': return "I'm making a pond beside the plot.";
    case 'return_home': return "I'm walking back to the base.";
    case 'place_bed': case 'claim_bed': return "I'm setting up the bed at the base.";
    case 'place_chest': return "I'm putting the stash chest beside the bed.";
    case 'till': return "I'm tilling the plot."; case 'plant': return "I'm planting the plot.";
    case 'build_pen': return "I'm fencing the cow pen."; case 'gather_wool': return "I'm getting wool for a bed.";
    case 'restock': return "I'm restocking from the chest at the base."; case 'stash_valuables': return "I'm leaving my valuables at the base.";
    case 'sleep': return "I'm sleeping the night through."; case 'stay_up': return "I'm staying up tonight; there's work the dark is good for.";
    case 'return_to_portal': case 'enter_nether': return "I'm heading for my Nether portal.";
    case 'return_overworld': return "I'm heading back through the portal.";
    default: return "I'm working on it.";
  }
}

function completion(goal) {
  const chest = [goal, ...(goal.tasks || [])].flatMap(g => g.deliveryEvidence || []).filter(e => e.method === 'chest');
  if (chest.length) {
    const places = [...new Set(chest.map(e => `${e.position.x}, ${e.position.y}, ${e.position.z}`))];
    return places.length === 1 ? `All done! I left items for you in the chest at ${places[0]}.` : 'All done! I left items in the chests I pointed out.';
  }
  if (['obtain', 'craft'].includes(goal.kind)) return goal.deliver ? `You got ${goal.count} ${name(goal.item)}!` : `I've got ${goal.count} ${name(goal.item)}.`;
  if (goal.kind === 'bundle') return `All done! ${list(goal.tasks)}. ${goal.tasks.every(t => t.deliver) ? 'You have the whole list.' : 'I kept the items you asked me to keep.'}`;
  if (goal.kind === 'find') {
    const p = goal.discovery.found.position;
    return `Found ${name(goal.discoveryTarget.name)}! It's at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}.`;
  }
  if (goal.kind === 'come') return `I'm here with ${goal.target || goal.from}!`;
  if (goal.kind === 'visit') return `I'm at ${goal.destination.label}!`;
  if (goal.kind === 'house' || goal.kind === 'build') {
    const changed = goal.buildContinuation?.mode === 'edit' && goal.buildContinuation.name;
    return changed ? `${changed} is changed, and I checked it over for missing blocks.`
      : 'The building is done! I checked it for missing blocks.';
  }
  if (goal.kind === 'win') return 'We beat the dragon! I made it back home alive.';
  if (goal.kind === 'concrete') return `You got ${goal.count} purple concrete!`;
  return 'The Nether portal works! I went through to check.';
}
module.exports = { quietRepeats, name, list, friendlyProblem, recoveryHint, thinking, activity, completion };
