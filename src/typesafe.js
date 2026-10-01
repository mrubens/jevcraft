'use strict';

// Minimal TypeSafe System One client.
//
// Uses the documented POST /v1/systemone endpoint with native fetch. Keep
// credentials here; decision code passes only state and typed questions.

const BASE_URL = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai';
const MODEL = process.env.TYPESAFE_DEFAULT_MODEL || 'jev-latest';

const { leanRequest } = require('./decisions/lean');

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const BREAKER_MS = 15000;
// The account's refusals: no credits, the key refused (jev-down.js ACCOUNT).
const ACCOUNT_STATUSES = new Set([401, 402, 403]);

class TypeSafeError extends Error {
  constructor(message, { status, requestId, body } = {}) {
    super(message);
    this.name = 'TypeSafeError';
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

// Question builders. `criteria` labels are what the model chooses between, so
// every label carries a description saying what belongs in it and what doesn't.
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = (instructions, criteria = null) => ({ type: 'noul', instructions, criteria });
const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });

// Bind every nested classifier call to the same player-request lifetime,
// including catalog traversal and command argument classification.
function withRequestSignal(client, signal) {
  return { systemOne(args) {
    signal.throwIfAborted();
    return client.systemOne({ ...args, signal: args.signal ? AbortSignal.any([signal, args.signal]) : signal });
  } };
}

// A stage of a call, marked on its trace as milliseconds since the trace
// began (trace.t0) and kept in order: { stage, ms, ...extra }. Cheap and
// always on; a trace with no t0 is left alone.
function stage(trace, name, extra = null) {
  if (!trace || !Number.isFinite(trace.t0)) return;
  (trace.stages ||= []).push({ stage: name, ms: Math.round(performance.now() - trace.t0), ...(extra || {}) });
}

// A choice's answer is the option with the highest probability (the
// service's Choice contract), read from the distribution it returns: now
// and then the `choice` field names one a hundredth below another in the
// same response (36 of 12,070 judgments in the flight records of
// 2026-09-27 and 28, each by 0.01). mid-242-bc-fortress-2 took
// break_spawner at 0.26 over leave_and_heal at 0.27 and died of it
// (note 623); what is taken, logged and weighed must be the one the
// distribution puts first. A tie keeps the service's pick; `served` keeps
// what it said.
function pickByDistribution(response) {
  for (const answer of Object.values(response?.answers || {})) {
    const p = answer?.probabilities;
    if (!answer || typeof answer.choice !== 'string' || !p || typeof p !== 'object') continue;
    const mine = Number(p[answer.choice]) || 0;
    let best = answer.choice, top = mine;
    for (const [key, value] of Object.entries(p)) if (Number(value) > top) { best = key; top = Number(value); }
    if (best !== answer.choice) { answer.served = { choice: answer.choice, probability: mine }; answer.choice = best; }
  }
  return response;
}

class TypeSafe {
  constructor({ provider = process.env.JEV_PROVIDER || (process.env.TYPESAFE_API_KEY ? 'typesafe' : process.env.OPENROUTER_API_KEY ? 'openrouter' : 'typesafe'),
    apiKey, model, timeout = 10000, maxRetries = 2 } = {}) {
    if (!['typesafe', 'openrouter'].includes(provider)) throw new TypeSafeError('JEV_PROVIDER must be typesafe or openrouter');
    apiKey ??= provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY;
    model ??= provider === 'openrouter' ? process.env.OPENROUTER_JEV_MODEL || 'typesafe/jev-1.13' : MODEL;
    if (!apiKey) {
      throw new TypeSafeError(
        `No ${provider} API key. Set ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'} in the environment or in bot/.env`,
      );
    }
    this.apiKey = apiKey;
    this.provider = provider;
    this.endpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/alpha/decisions' : `${BASE_URL}/v1/systemone`;
    this.model = model;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  // Ask a batch of questions about one state. Every question is answered
  // independently server-side. Measure latency and token use for each workload.
  // `run` and `kind` never reach the wire: they say which run the ledger
  // charges the call to and what sort of question it was.
  // A service that is down is asked again in fifteen seconds, not by every
  // caller meanwhile: at up to thirty seconds a call (three tries at ten), a
  // run of questions during an outage would each wait it out. While the
  // breaker is open a call fails at once; nothing is decided by code then
  // (note 707): the asker holds and asks again (jev-down.js), and the first
  // ask after the breaker's fifteen seconds is the one that finds Jev back.
  // `trace`, when given, is marked with the time of each stage of the call
  // (stage() below): a question that never came back (mid-243-q-nether-3,
  // note 540) could not say where it stood.
  async systemOne({ state, questions, model = this.model, signal, run, kind, trace }) {
    // The breaker's error carries what opened it (note 781): a 402 is the
    // account out of credits for the fifteen seconds as for the first call.
    if (this.openUntil > Date.now()) { stage(trace, 'breaker'); throw Object.assign(new TypeSafeError(`The decision service is not answering${this.openWhy ? ` (${this.openWhy})` : ''}; asking again in ${Math.ceil((this.openUntil - Date.now()) / 1000)}s`, { status: this.openStatus || 503 }), { breaker: true }); }
    const started = performance.now();
    try {
      const response = await this.exchange({ state, questions, model, signal, trace });
      this.charge({ run, kind, usage: response?.usage, latencyMs: performance.now() - started, ok: true });
      delete this.openUntil; delete this.openStatus; delete this.openWhy;
      return response;
    } catch (err) {
      // A call abandoned by its own caller cost nothing worth counting.
      if (!signal?.aborted) this.charge({ run, kind, latencyMs: performance.now() - started, ok: false });
      // Open for an outage and for the account's refusals (no credits, the
      // key refused: ACCOUNT_STATUSES), not for a question rejected.
      if (!signal?.aborted && !(err instanceof TypeSafeError && err.status && !RETRY_STATUSES.has(err.status) && !ACCOUNT_STATUSES.has(err.status))) {
        this.openUntil = Date.now() + BREAKER_MS;
        if (err instanceof TypeSafeError && ACCOUNT_STATUSES.has(err.status)) { this.openStatus = err.status; this.openWhy = String(err.message).slice(0, 160); } else { delete this.openStatus; delete this.openWhy; }
      }
      throw err;
    }
  }

  charge(entry) {
    if (!this.ledger) return;
    try { this.ledger.record(entry); } catch (err) { console.error('[ledger]', err.message); }
  }

  async exchange({ state, questions, model = this.model, signal, trace }) {
    // The same facts in fewer words (decisions/lean.js, note 672).
    ({ state, questions } = leanRequest({ state, questions }));
    // OpenRouter accepts omitted optional criteria, but rejects explicit null
    // for Noul questions. Preserve the caller's native questions unchanged.
    const wireQuestions = this.provider === 'openrouter' ? Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      if (question.criteria !== null) return [id, question];
      const { criteria: _criteria, ...rest } = question;
      return [id, rest];
    })) : questions;
    const body = JSON.stringify({ state, questions: wireQuestions, model });
    let lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      signal?.throwIfAborted();
      if (attempt > 0) {
        const backoff = Math.min(500 * 2 ** (attempt - 1), 5000);
        stage(trace, 'retry', { attempt, backoffMs: Math.round(backoff) });
        await require('node:timers/promises').setTimeout(backoff * (1 - Math.random() * 0.25), undefined, { signal });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        stage(trace, 'sent', attempt ? { attempt } : { chars: body.length });
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        });

        const requestId = res.headers.get('x-request-id') || undefined;
        stage(trace, 'headers', { status: res.status, ...(requestId ? { requestId } : {}) });
        const text = await res.text();
        stage(trace, 'body', { bytes: text.length });

        if (!res.ok) {
          const err = new TypeSafeError(
            `TypeSafe ${res.status}: ${text.slice(0, 500)}`,
            { status: res.status, requestId, body: text },
          );
          if (RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
            lastErr = err;
            continue;
          }
          throw err;
        }

        const parsed = pickByDistribution(JSON.parse(text));
        stage(trace, 'parsed');
        return parsed;
      } catch (err) {
        stage(trace, 'failed', { error: String(err?.name || err).slice(0, 40), aborted: !!signal?.aborted });
        signal?.throwIfAborted();
        // Timeouts and connection failures are worth another attempt; a 4xx is not.
        if (err instanceof TypeSafeError && !RETRY_STATUSES.has(err.status)) throw err;
        lastErr = err;
        if (attempt >= this.maxRetries) throw err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr;
  }
}

module.exports = { TypeSafe, TypeSafeError, choice, noul, score, withRequestSignal, stage, pickByDistribution };
