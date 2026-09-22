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

const unfinished = goal => goal.status !== 'complete' && goal.kind !== 'survive';
// A player's own work that a resume can pick up. Not the dream, which is
// the bot's idle time and relaunches itself, and not a request parked as
// impossible, which a retry cannot change.
const playerWork = goal => unfinished(goal) && !goal.dream && goal.status !== 'blocked';

function resumeSaved(saved, { currentOnly = false } = {}) {
  // Maintenance may unpause an idle companion after a reconnect. It must not
  // turn a completed request into permission to start older suspended work.
  if (currentOnly || !saved) return saved;
  if (playerWork(saved)) return saved;
  // The newest player work under whatever is on top. "Get me bedrock"
  // replaced a build and was parked as impossible, and "resume" retried the
  // bedrock forever; the dream started over a stopped build, and "resume"
  // answered that it was already working. Both buried the build where
  // nothing could reach it.
  const tasks = [...(saved.suspendedTasks || [])];
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (playerWork(tasks[i])) return { ...tasks[i], suspendedTasks: tasks.slice(0, i) };
  }
  if (saved.status !== 'complete') return saved;
  while (tasks.length) {
    const previous = tasks.pop();
    if (unfinished(previous)) return { ...previous, suspendedTasks: tasks };
  }
  return saved;
}

module.exports = { suspendPrevious, resumeSaved };
