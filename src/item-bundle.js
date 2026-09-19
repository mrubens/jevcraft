'use strict';
const { choice, noul } = require('./typesafe');
const { catalogTree, itemCandidates } = require('./catalog');
const { resolvedPreferenceContext } = require('./preferences');

// Multi-label traversal preserves all requested outputs. Each question is a
// separate yes/no judgment; a single Choice would discard sibling items.
async function resolveItemBundle(client, registry, request, numbers = [], context = {}) {
  context = { ...context, memory: await resolvedPreferenceContext(client, registry, context.memory) };
  let frontier = Object.entries(catalogTree(registry)).map(([key, node]) => ({ path: [key], node }));
  const items = [], judgments = [], started = performance.now();
  const suggestions = itemCandidates(registry, request).map(item => item.name);
  const contains = (node, item) => node.item === item || Object.values(node.children || {}).some(child => contains(child, item));
  for (let depth = 0; frontier.length && depth < 12; depth++) {
    if (frontier.length > 256) throw new Error('That request spans too many catalog branches; please split it into smaller requests.');
    const next = [];
    for (let offset = 0; offset < frontier.length; offset += 28) {
      const page = frontier.slice(offset, offset + 28);
      const candidates = Object.fromEntries(page.map((entry, i) => [`candidate_${i}`, {
        path: entry.path, description: entry.node.description, item: entry.node.item,
        relevantEntries: suggestions.filter(item => contains(entry.node, item)),
      }]));
      const response = await client.systemOne({ state: { request, candidates, context }, questions:
        Object.fromEntries(page.map((_, i) => [`candidate_${i}`, noul({
          task: `Does candidates.candidate_${i} contain at least one of the FINAL outputs the player requests? Select every requested output, including members of explicitly requested sets.`,
          rules: 'Full armor means helmet, chestplate, leggings and boots in the named material, not weapons or horse/wolf armor. Exclude ingredients, tools needed to obtain outputs, negated items, and optional suggestions. An unspecified variant means ONE ordinary default, not all variants: white for an uncolored bed/wool; for unspecified wooden objects use relevant explicit context.memory notes, then context.memory.preferences, then oak if neither applies. Honor current explicit colors/species over memory, and choose only one matching variant. A branch can contain a requested output even when its description only shows some examples.',
        })])) });
      judgments.push({ candidates, answers: response.answers, usage: response.usage });
      for (let i = 0; i < page.length; i++) {
        const value = response.answers?.[`candidate_${i}`]?.noul;
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid multi-item catalog response');
        if (value < 0.65) continue;
        const { node, path } = page[i];
        if (node.item) items.push(node.item);
        else next.push(...Object.entries(node.children).map(([key, child]) => ({ path: [...path, key], node: child })));
      }
    }
    if (items.length > 16) throw new Error('Please request at most 16 different items at once.');
    frontier = next;
  }
  if (frontier.length) throw new Error('Multi-item catalog exceeded its depth limit');
  if (!items.length) return { items: [], judgments };
  const questions = { covered: noul('Do selectedOutputs cover ALL final item outputs requested in request, including every piece of a requested set, with no extra unrequested outputs? Ingredients mentioned only as a means are not outputs. For an unspecified variant, one matching default counts as satisfying the requested item: use explicit context.memory notes, then learned context.memory.preferences for wood, otherwise ordinary white/oak defaults. A preferred cherry plank is still a plank, not an extra output. Past tasks in memory are not current requests and must not add outputs. Answer no if any output is missing or any unrelated item was added.') };
  for (const [i, item] of items.entries()) {
    questions[`quantity_${i}`] = choice(`How many ${item} are requested in request? Apply numbers only to this output. A full set contains one of each member; two sets contain two of each. An unspecified amount is default.`,
      { ...Object.fromEntries(numbers.map(n => [n, `${n} of ${item}`])), default: 'No explicit amount: one item (or the ordinary concrete batch).' });
    questions[`recipient_${i}`] = choice(`Who should receive ${item} in request? Use the recipient for the whole list unless the player gives this item a different recipient.`, {
      speaker: 'Give/bring/deliver to the speaker (me/for me); bring without another named recipient.',
      bot: 'Keep it, for yourself, or no recipient specified.',
    });
  }
  const response = await client.systemOne({ state: { request, selectedOutputs: items, context }, questions });
  judgments.push({ selectedOutputs: items, answers: response.answers, usage: response.usage });
  if (!(response.answers?.covered?.noul >= 0.65)) return { items: [], judgments, incomplete: true };
  const outputs = items.map((item, i) => {
    const quantity = response.answers?.[`quantity_${i}`]?.choice, recipient = response.answers?.[`recipient_${i}`]?.choice;
    if (![...numbers, 'default'].includes(quantity) || !['speaker', 'bot'].includes(recipient)) throw new Error('Invalid item quantity or recipient in combined request');
    return { kind: 'obtain', item, count: quantity === 'default' ? item.endsWith('_concrete') ? 32 : 1 : Number(quantity), deliver: recipient === 'speaker' };
  });
  return { items: outputs, judgments, latencyMs: Math.round(performance.now() - started) };
}

// Child state is saved atomically with the parent, including pending handovers.
// Completed deliveries are never replayed. Retained outputs are rechecked, as
// a later recipe or a death may have consumed/lost them before the whole list ends.
async function bundleStep(bot, task, goal, save, execute, { prepare } = {}) {
  task.check();
  if (!Array.isArray(goal.tasks) || !goal.tasks.length) throw new Error('Combined request has no tasks');
  for (const child of goal.tasks) {
    if (!child.deliver && child.status === 'complete' &&
      bot.inventory.items().filter(i => i.name === child.item).reduce((n, i) => n + i.count, 0) < child.count) child.status = 'pending';
  }
  // Reconcile an uncertain handover before planning new stock. Otherwise a
  // reconnect between dropping and pickup could duplicate the player's items.
  const handingOver = goal.tasks.findIndex(child => child.pendingDelivery);
  if (handingOver < 0 && prepare && !await prepare()) return false;
  const index = handingOver >= 0 ? handingOver : require('./bundle-batch').nextBatchTask(goal);
  if (index < 0) return true;
  const child = goal.tasks[index];
  child.from = goal.from; child.request ||= goal.request; child.status = 'running';
  child.requesterPosition ||= goal.requesterPosition;
  child.resourceMemory = goal.resourceMemory ||= {};
  child.opportunistic = goal.opportunistic ||= { primarySteps: 0, history: [], skipped: {} };
  goal.activeTask = index;
  const checkpoint = () => {
    goal.step = { action: 'combined_request', task: index + 1, total: goal.tasks.length, item: child.item, count: child.count, detail: child.step };
    save();
  };
  checkpoint(); task.check();
  if (await execute(child, checkpoint)) { child.status = 'complete'; child.completedAt = new Date().toISOString(); }
  task.check(); checkpoint();
  return goal.tasks.every(entry => entry.status === 'complete' && (entry.deliver ||
    bot.inventory.items().filter(i => i.name === entry.item).reduce((n, i) => n + i.count, 0) >= entry.count));
}

const bundleSummary = goal => goal.tasks.map(task => `${task.count} ${task.item.replaceAll('_', ' ')}${task.status === 'complete' ? ' (done)' : ''}`).join(', ');
module.exports = { resolveItemBundle, bundleStep, bundleSummary };
