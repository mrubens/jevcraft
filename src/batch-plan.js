'use strict';
const { planOutputs } = require('./knowledge');
const { PlanError } = require('./plan');

// Exact recipes determine amounts. Dependencies retain both consumable lots and
// reusable tools/stations; joining two jobs must never introduce a tool cycle.
function batchPlan(registry, outputs, inventory = {}, context = {}) {
  const plan = planOutputs(registry, outputs, inventory, context);
  if (plan.sequence.length > 800) throw new PlanError('Combined recipe plan is too large; split the request');
  const lots = Object.fromEntries(Object.entries(plan.available).map(([name, count]) => [name, [{ count, readers: new Set() }]]));
  const nodes = new Map();
  for (const [id, step] of plan.sequence.entries()) {
    const node = { id, step: structuredClone(step), dependencies: new Set() };
    nodes.set(id, node);
    const use = (name, count, consume) => {
      for (const lot of lots[name] || []) {
        if (count <= 0) break;
        const used = Math.min(lot.count, count);
        if (!used) continue;
        if (lot.producer !== undefined) node.dependencies.add(lot.producer);
        if (consume) {
          for (const reader of lot.readers) if (reader !== id) node.dependencies.add(reader);
          lot.count -= used;
        } else lot.readers.add(id);
        count -= used;
      }
      if (count > 0) throw new PlanError(`Combined recipe plan is missing ${count} ${name}`, name);
    };
    for (const [name, count] of Object.entries(step.requires || {})) use(name, count, false);
    for (const [name, count] of Object.entries(step.consumes || {})) use(name, count, true);
    for (const [name, count] of Object.entries(step.produces || {})) (lots[name] ||= []).push({ count, producer: id, readers: new Set() });
  }
  const dependsOn = (id, ancestor, seen = new Set()) => {
    if (id === ancestor) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return [...nodes.get(id).dependencies].some(parent => dependsOn(parent, ancestor, seen));
  };
  const key = ({ count, fuel, consumes, produces, ...step }) => JSON.stringify(step);
  const groups = new Map();
  for (const node of nodes.values()) {
    if (node.step.action === 'reserve_output') continue;
    const signature = key(node.step), candidates = groups.get(signature) || [];
    const target = candidates.find(id => !dependsOn(node.id, id) && !dependsOn(id, node.id));
    if (target === undefined) { candidates.push(node.id); groups.set(signature, candidates); continue; }
    const kept = nodes.get(target);
    kept.step.count += node.step.count;
    for (const field of ['consumes', 'produces']) for (const [name, count] of Object.entries(node.step[field]))
      kept.step[field][name] = (kept.step[field][name] || 0) + count;
    if (kept.step.action === 'smelt') {
      kept.step.fuel = Math.ceil(kept.step.count / 1.5);
      kept.step.consumes.oak_planks = kept.step.fuel;
    }
    for (const dependency of node.dependencies) kept.dependencies.add(dependency);
    nodes.delete(node.id);
    for (const other of nodes.values()) if (other.dependencies.delete(node.id)) other.dependencies.add(target);
  }
  const pending = new Set(nodes.keys()), ordered = [];
  const priority = step => step.action === 'reserve_output' ? 100 :
    ['mine', 'hunt_mob', 'fill_bucket'].includes(step.action) ? 0 : plan.totals[step.item] ? 30 : 10;
  while (pending.size) {
    const ready = [...pending].map(id => nodes.get(id)).filter(node => [...node.dependencies].every(id => !pending.has(id)))
      .sort((a, b) => priority(a.step) - priority(b.step) || a.id - b.id);
    if (!ready.length) throw new PlanError('Combined recipe dependencies contain a cycle');
    const node = ready[0]; pending.delete(node.id);
    if (node.step.action !== 'reserve_output') ordered.push(node.step);
  }
  return { steps: ordered, reserved: plan.reserved, totals: plan.totals };
}

// Delivered quantities are irrevocable progress. Kept outputs still count as
// requested stock, even when an earlier child was marked complete before a loss.
function remainingOutputs(goal) {
  return goal.tasks.map(child => ({ item: child.item, count: child.count - (child.deliver ? child.delivered || 0 : 0) }))
    .filter(output => output.count > 0);
}

module.exports = { batchPlan, remainingOutputs };
