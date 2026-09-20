'use strict';
// Player chat uses short, everyday language. Full engine errors and decision
// traces stay in saved state and logs, where debugging details belong.
const name = value => String(value || 'items').replace(/^minecraft:/, '').replaceAll('_', ' ');
const list = tasks => tasks.map(t => `${t.count} ${name(t.item)}`).join(', ');

// Not every blocker can be retried. Once the world no longer matches the saved
// plan, resume fails the same way every time, so name what does help instead.
const REPLAN = /building site changed/i;
function recoveryHint(error) {
  return REPLAN.test(String(error?.message || error || ''))
    ? 'Ask me to build it again and I will pick a fresh spot.'
    : 'Say "Jev resume" to try again.';
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
    case 'refuel_furnace': return step.item === 'oak_planks' ? "I'm getting more fuel for the furnace." : "I'm getting the missing supplies for the furnace.";
    case 'explore': case 'approach_discovery': case 'approach_found_creature': return `I'm looking for ${name(step.name || step.entity || step.resource)}.`;
    case 'come': return "I'm coming to you.";
    case 'follow': return "I'm following you.";
    case 'visit': return `I'm heading to ${step.label || 'the saved place'}.`;
    case 'eat': case 'eat_food': return "I'm eating something.";
    case 'return_to_surface': case 'ascend_to_surface': return "I'm finding a way back up.";
    case 'prepare_expedition_food': return "I'm packing some food for the trip.";
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
  if (goal.kind === 'house' || goal.kind === 'build') return 'The building is done! I checked it for missing blocks.';
  if (goal.kind === 'win') return 'We beat the dragon! I made it back home alive.';
  if (goal.kind === 'concrete') return `You got ${goal.count} purple concrete!`;
  return 'The Nether portal works! I went through to check.';
}
module.exports = { name, list, friendlyProblem, recoveryHint, activity, completion };
