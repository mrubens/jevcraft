'use strict';
const { friendlyProblem, activity, name } = require('./speech');

function statusMessage(bot, active, saved) {
  const goal = active && !active.idle ? active.goal : saved;
  const messages = [];
  if (goal) {
    if (goal.status === 'complete') messages.push('I finished your last task.');
    else if (goal.status === 'cancelled' || goal.status === 'interrupted') messages.push('I stopped. Say "Jev resume" when you want me to carry on.');
    else if (goal.recoveryAdvice?.active) messages.push("I'm stuck. I need to think for a bit.");
    else if (goal.status === 'blocked') messages.push(`${friendlyProblem(goal.lastError)} Say "Jev resume" to try again.`);
    else messages.push(activity(goal.step));
    if (goal.kind === 'bundle') {
      const done = goal.tasks.filter(t => t.status === 'complete').length, next = goal.tasks.find(t => t.status !== 'complete');
      messages.push(`${done} of ${goal.tasks.length} things done.${next ? ` Next: ${name(next.item)}.` : ''}`);
    }
  }
  if (active?.idle) {
    const idle = active.goal;
    messages.push(idle.survivalAction ? activity(idle.survivalAction) : "I'm nearby and ready to help.");
  }
  return messages.join(' ') || "I'm ready. What should we do?";
}

module.exports = { statusMessage };
