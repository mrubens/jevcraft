'use strict';

function statusMessage(bot, active, saved) {
  const goal = active && !active.idle ? active.goal : saved;
  const messages = [];
  if (goal) {
    const detail = (goal.recoveryAdvice?.active ? 'Trying a different approach' : goal.lastError) ||
      goal.decisions?.at(-1)?.path?.join(' > ') || JSON.stringify(goal.step || {});
    messages.push(`${goal.status}: ${goal.request}. ${detail}`);
  }
  if (active?.idle) {
    const idle = active.goal;
    messages.push(`Between requests: ${idle.lastError || idle.survivalAction?.action || 'watching survival needs'}. Health ${bot.health}, food ${bot.food}.`);
  }
  return messages.join(' ') || 'No saved task.';
}

module.exports = { statusMessage };
