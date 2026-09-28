'use strict';
const { Vec3 } = require('vec3');
const { checkAir, needsAir } = require('./vitals');
const { checkThreats, immediateThreat } = require('./danger');
const { recoveryOptions, executeRecoveryOption } = require('./recovery-options');
const LIMITS = { calls: 6, windowMs: 3600000, sameFailure: 2, cooldownMs: 60000, planMs: 900000, actionMs: 120000, actionSteps: 12,
  surfaceMs: 600000, surfaceSteps: 192, jevConfidence: require('./decisions').question('recovery_action').gate.threshold };
const emergency = err => ['Cancelled', 'NeedsAir', 'NeedsSafety'].includes(err.name);
const identity = goal => JSON.stringify([goal.request, goal.kind, goal.item, goal.count, goal.from]);
const life = goal => goal.survival?.deaths?.at(-1)?.at || null;
const available = bot => !needsAir(bot) && (bot.health ?? 20) > 8 && (bot.food ?? 20) > 6 && !immediateThreat(bot);

function actionBudget(action) {
  // One surface action can require a hundred individually inspected stair
  // steps. Twelve attempts cut off healthy progress deep underground.
  if (action.kind === 'surface') return { steps: LIMITS.surfaceSteps, ms: LIMITS.surfaceMs };
  if (action.kind === 'acquire' && action.dependencies?.length) {
    const units = action.dependencies.reduce((n, step) => n + Math.min(32, Math.max(1, Number(step.count) || 1)), 0);
    // Allow ingredient gathering plus travel/crafting/verification actions;
    // requesting twelve blocks cannot finish in exactly twelve step calls.
    return { steps: Math.min(96, Math.max(LIMITS.actionSteps, 8 + units * 2)), ms: LIMITS.actionMs };
  }
  return { steps: LIMITS.actionSteps, ms: LIMITS.actionMs };
}

// Recovery is a judgment: code enumerates the executable options and Jev
// picks one, in a few hundred milliseconds, saying how sure it is. A pick
// below the confidence gate is no pick. There is no generative second
// opinion: when Jev cannot choose, the failure goes back to the caller.
const describeOption = o => o.kind === 'acquire' ? `Gather ${o.count} ${String(o.item).replaceAll('_', ' ')}: ${o.description}` : `${o.kind.replaceAll('_', ' ')}: ${o.description}`;

async function askJev(client, bot, task, observation, { signal, threshold = LIMITS.jevConfidence } = {}) {
  const started = Date.now();
  const options = Object.fromEntries(observation.options.map(o => [o.id, describeOption(o)]));
  const response = await require('./decisions').ask(client, { state: observation.context, signal, questions: { recovery: ['recovery_action', { options }] } });
  task.check();
  const answer = response.answers?.recovery;
  if (!answer || !(answer.choice === 'none' || Object.hasOwn(options, answer.choice))) throw new Error('Jev selected an unavailable recovery option');
  const confident = answer.choice !== 'none' && answer.confidence >= threshold;
  const selected = confident ? structuredClone(observation.options.find(o => o.id === answer.choice)) : null;
  return { source: 'jev', model: client.model || 'jev', judgment: answer, options, confident,
    diagnosis: selected ? `Jev chose: ${describeOption(selected)}` : answer.choice === 'none' ? 'Jev judged that none of the offered actions addresses this failure' : `Jev was not confident enough to act (${Math.round((answer.confidence || 0) * 100)}%)`,
    steps: selected ? [selected] : [], latencyMs: Date.now() - started, usage: response.usage, createdAt: new Date().toISOString() };
}

class RecoveryAdviser {
  // `off` disables recovery advice; anything else lets Jev choose among the
  // code-checked options.
  constructor(bot, actions, { mode = process.env.RECOVERY_ADVISER || 'jev', enabled = mode !== 'off', client = null,
    observe = recoveryOptions, judge = askJev, execute = executeRecoveryOption, ...requestOptions } = {}) {
    Object.assign(this, { bot, actions, enabled, client, observe, judge, execute, requestOptions });
  }
  get configured() { return this.enabled && !!this.client; }
  state(goal) { return goal.recoveryAdvice ||= { calls: 0, failures: [], history: [] }; }
  recordFailure(goal, err) {
    const state = this.state(goal);
    state.failures.push({ at: Date.now(), message: err.message, step: structuredClone(goal.step || {}), position: { ...this.bot.entity.position } });
    state.failures = state.failures.slice(-12);
  }
  async suggest(task, goal, save) {
    if (!this.configured || !available(this.bot)) return false;
    const state = this.state(goal), now = Date.now();
    const signature = JSON.stringify([goal.lastError, goal.step?.action, goal.step?.item, goal.step?.drops]);
    // Six an hour, not six a life: a long goal like beating the game had
    // used its six by the first evening and never had advice again.
    const recent = state.history.filter(h => now - h.at < LIMITS.windowMs).length;
    if (state.active || recent >= LIMITS.calls || now - (state.lastAskedAt || 0) < LIMITS.cooldownMs ||
      state.history.filter(h => h.signature === signature).length >= LIMITS.sameFailure) return false;
    // Reserve the call before observation/network work so a restart or failed
    // service cannot bypass the persistent cost and repetition limits.
    state.calls++; state.lastAskedAt = now;
    const record = { signature, at: now, status: 'observing', objective: identity(goal), life: life(goal), dimension: this.bot.game.dimension };
    state.history.push(record); state.history = state.history.slice(-LIMITS.calls); save();
    this.bot.pathfinder.setGoal(null); this.bot.clearControlStates?.();
    const previous = task.interruptCheck;
    task.interruptCheck = () => checkThreats(this.bot);
    try {
      const observation = await this.observe(this.bot, task, goal, this.actions);
      record.context = observation.context; record.options = observation.options;
      if (!observation.options.length) { record.status = 'unavailable'; record.outcome = 'No executable recovery options observed'; save(); return false; }
      record.status = 'judging'; record.source = 'jev'; save();
      const advice = await this.judge(this.client, this.bot, task, observation, this.requestOptions);
      record.jev = { judgment: advice.judgment, options: advice.options, latencyMs: advice.latencyMs, usage: advice.usage };
      task.check();
      if (identity(goal) !== record.objective || life(goal) !== record.life || this.bot.game.dimension !== record.dimension) throw new Error('Recovery advice became stale');
      Object.assign(record, advice, { status: advice.steps.length ? 'planned' : 'no_plan' });
      if (advice.steps.length) {
        state.active = { historyAt: record.at, objective: record.objective, life: record.life, dimension: record.dimension,
          steps: structuredClone(advice.steps), cursor: 0, attempts: 0, expiresAt: Date.now() + LIMITS.planMs,
          anchor: { ...this.bot.entity.position } };
        const describe = s => s.kind === 'acquire' ? `gathering ${s.count} ${s.item.replaceAll('_', ' ')}` :
          ({ surface: 'getting back to the surface', relocate: 'a different approach', shelter: 'another shelter spot',
            descend_pillar: 'digging down off this pillar', explore: `looking for ${String(s.resource || '').replaceAll('_', ' ')} somewhere else` }[s.kind] || 'a different approach');
        // Two relocations in a row are both "a different approach", and saying
        // so twice reads as a stutter rather than as a plan. Jev says what it
        // is going to try, once each.
        const plan = [...new Set(advice.steps.map(describe))];
        this.bot.chat?.(`That is not working. I'll try ${plan.join(', then ')}.`);
      }
      save(); this.bot.emit?.('recovery_advice', record);
      return !!state.active;
    } catch (err) {
      record.status = emergency(err) ? 'interrupted' : 'failed'; record.outcome = err.message;
      if (err.rejectedAdvice) record.rejectedAdvice = err.rejectedAdvice;
      save();
      if (emergency(err)) throw err;
      this.bot.emit?.('recovery_advice', record); return false;
    } finally { task.interruptCheck = previous; }
  }
  // A move chosen as an answer to the stall's question (work.js answerStall,
  // note 571): the plan this adviser carries out, as a pick of its own
  // question was. One question answers a failure; this carries it out.
  adopt(goal, save, option, context = null) {
    const state = this.state(goal), now = Date.now();
    const record = { signature: JSON.stringify([goal.lastError, goal.step?.action, goal.step?.item, goal.step?.drops]), at: now, status: 'planned', source: 'stall question',
      objective: identity(goal), life: life(goal), dimension: this.bot.game.dimension, ...(context ? { context } : {}), steps: [structuredClone(option)] };
    state.history.push(record); state.history = state.history.slice(-LIMITS.calls);
    state.active = { historyAt: now, objective: record.objective, life: record.life, dimension: record.dimension,
      steps: [structuredClone(option)], cursor: 0, attempts: 0, expiresAt: now + LIMITS.planMs, anchor: { ...this.bot.entity.position } };
    save?.(); this.bot.emit?.('recovery_advice', record);
    return true;
  }
  finish(goal, save, outcome) {
    const state = this.state(goal), active = state.active;
    const record = state.history.find(h => h.at === active?.historyAt);
    if (record) { record.status = 'finished'; record.outcome = outcome; record.finishedAt = Date.now(); }
    delete state.active; save();
    this.bot.emit?.('recovery_result', { outcome, record });
  }
  async step(task, goal, save) {
    task.check();
    const active = goal.recoveryAdvice?.active;
    if (!active) return false;
    if (!this.configured || identity(goal) !== active.objective || life(goal) !== active.life || this.bot.game.dimension !== active.dimension ||
      Date.now() > active.expiresAt || this.bot.entity.position.distanceTo(new Vec3(active.anchor.x, active.anchor.y, active.anchor.z)) > 32) {
      this.finish(goal, save, 'Discarded stale or disabled recovery plan'); return false;
    }
    if (!available(this.bot)) return false; // Survival gets first chance to handle emergencies.
    const action = active.steps[active.cursor];
    const budget = actionBudget(action);
    active.actionStartedAt ||= Date.now();
    if (++active.attempts > budget.steps || Date.now() - active.actionStartedAt > budget.ms) {
      this.finish(goal, save, 'Recovery action budget exhausted'); throw new Error('Recovery action budget exhausted');
    }
    const bounded = Object.create(task);
    bounded.check = () => {
      task.check(); checkAir(this.bot); checkThreats(this.bot);
      if ((this.bot.health ?? 20) <= 8 || (this.bot.food ?? 20) <= 6) {
        const err = new Error('Recovery interrupted for critical vitals'); err.name = 'NeedsSafety'; throw err;
      }
      if (life(goal) !== active.life || this.bot.game.dimension !== active.dimension) throw new Error('Recovery world changed during execution');
      if (Date.now() > Math.min(active.expiresAt, active.actionStartedAt + budget.ms)) throw new Error('Recovery action timed out');
    };
    goal.recoveryAction = { ...action, at: new Date().toISOString(), attempt: active.attempts }; save();
    try {
      const complete = await this.execute(this.bot, bounded, goal, save, action, this.actions);
      bounded.check();
      active.anchor = { ...this.bot.entity.position };
      if (complete) { active.cursor++; active.attempts = 0; delete active.actionStartedAt; }
      if (active.cursor >= active.steps.length) {
        this.finish(goal, save, 'Recovery actions completed; retrying original objective');
        this.bot.chat?.('Okay, back to your request.');
      } else save();
      return true;
    } catch (err) {
      if (!emergency(err)) this.finish(goal, save, `Recovery action failed: ${err.message}`);
      throw err;
    }
  }
}
module.exports = { RecoveryAdviser, askJev, LIMITS, describeOption };
