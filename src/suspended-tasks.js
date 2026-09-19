'use strict';

// Kept in the same atomic checkpoint as the current task: replacing a request
// cannot create a crash gap between separate history and active-state files.
function suspendPrevious(previous) {
  if (!previous) return [];
  const { suspendedTasks = [], ...current } = previous;
  const tasks = [...suspendedTasks];
  if (current.kind !== 'survive' && current.status !== 'complete') tasks.push(current);
  return tasks.slice(-8);
}

function resumeSaved(saved) {
  if (!saved || saved.status !== 'complete') return saved;
  const tasks = [...(saved.suspendedTasks || [])];
  while (tasks.length) {
    const previous = tasks.pop();
    if (previous.status !== 'complete' && previous.kind !== 'survive') return { ...previous, suspendedTasks: tasks };
  }
  return saved;
}

module.exports = { suspendPrevious, resumeSaved };
