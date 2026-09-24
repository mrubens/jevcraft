'use strict';

// Minimal TypeSafe System One client.
//
// Uses the documented POST /v1/systemone endpoint with native fetch. Keep
// credentials here; decision code passes only state and typed questions.

const BASE_URL = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai';
const MODEL = process.env.TYPESAFE_DEFAULT_MODEL || 'jev-latest';

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

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
  // A service that is down is asked again in a minute, not by every caller
  // meanwhile: at up to thirty seconds a call (three tries at ten), a run of
  // decisions during an outage would stand the bot still for minutes. While
  // the breaker is open a call fails at once and its caller takes its
  // rule-based fallback.
  async systemOne({ state, questions, model = this.model, signal, run, kind }) {
    if (this.openUntil > Date.now()) throw new TypeSafeError(`The decision service is not answering; asking again in ${Math.ceil((this.openUntil - Date.now()) / 1000)}s`, { status: 503 });
    const started = performance.now();
    try {
      const response = await this.exchange({ state, questions, model, signal });
      this.charge({ run, kind, usage: response?.usage, latencyMs: performance.now() - started, ok: true });
      delete this.openUntil;
      return response;
    } catch (err) {
      // A call abandoned by its own caller cost nothing worth counting.
      if (!signal?.aborted) this.charge({ run, kind, latencyMs: performance.now() - started, ok: false });
      if (!signal?.aborted && !(err instanceof TypeSafeError && err.status && !RETRY_STATUSES.has(err.status))) this.openUntil = Date.now() + 60000;
      throw err;
    }
  }

  charge(entry) {
    if (!this.ledger) return;
    try { this.ledger.record(entry); } catch (err) { console.error('[ledger]', err.message); }
  }

  async exchange({ state, questions, model = this.model, signal }) {
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
        await require('node:timers/promises').setTimeout(backoff * (1 - Math.random() * 0.25), undefined, { signal });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
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
        const text = await res.text();

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

        return JSON.parse(text);
      } catch (err) {
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

module.exports = { TypeSafe, TypeSafeError, choice, noul, score, withRequestSignal };
