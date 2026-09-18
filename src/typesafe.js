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

class TypeSafe {
  constructor({ apiKey = process.env.TYPESAFE_API_KEY, model = MODEL, timeout = 10000, maxRetries = 2 } = {}) {
    if (!apiKey) {
      throw new TypeSafeError(
        'No TypeSafe API key. Set TYPESAFE_API_KEY in the environment or in bot/.env',
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  // Ask a batch of questions about one state. Every question is answered
  // independently server-side. Measure latency and token use for each workload.
  async systemOne({ state, questions, model = this.model, signal }) {
    const body = JSON.stringify({ state, questions, model });
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
        const res = await fetch(`${BASE_URL}/v1/systemone`, {
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

module.exports = { TypeSafe, TypeSafeError, choice, noul, score };
