// Match the planner's pre-order numbering, including single-option branches.
export function branches(decision) {
  let serial = 0;
  const results = [];
  function visit(children, path = []) {
    if (!children || typeof children !== 'object') return;
    const id = `branch_${serial++}`, entries = Object.entries(children);
    const judgment = decision.judgments?.find(j => j.branch === id);
    const onPath = path.every((key, i) => decision.path?.[i] === key);
    results.push({ id, path, judgment, onPath, chosen: onPath ? decision.path?.[path.length] : null,
      candidates: entries.map(([key, node]) => ({ key, description: node.description || '', probability: judgment?.probabilities?.[key] })) });
    for (const [key, node] of entries) if (node.children) visit(node.children, [...path, key]);
  }
  visit(decision?.options);
  return results;
}
