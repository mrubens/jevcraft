# docs/

## Design

- [How Jev thinks](how-jev-thinks.md): one recorded chat request, step by step, with the real questions, answers, confidences, latency and tokens. Start here.
- [Every question Jev is asked](decisions.md): generated from `src/decisions`; each question's options, trigger, stakes, confidence bar and code fallback.
- [Rule audit](rule-audit.md): the choices handed from code to Jev, with the probes that checked them, and those code still makes.
- [Observatory](observatory.md): the local 3D viewer of the world, the bot's actions and every Jev judgment.

## Building and movement

- [Stairs and slabs in custom builds](oriented-building.md)
- [Wooden doors in builds and navigation](doors.md)
- [Creative flight](creative-flight.md)

## Evidence and working notes

These are the project's lab notebook, kept as written. They name dated runs and refer to the person running them as "the user".

- [Trial notes](trial-notes.md): every acceptance, dream and first-days trial, newest first, with what went wrong and what changed because of it.
- [Companion reliability checks](reliability-tests.md): the controlled tests behind specific improvements, and what each does and does not show.
- [Run ledger](run-ledger.md): one line per finished run, written by the bot (`src/ledger.js`).
- [`traces/`](traces/): a recorded request to open in the Observatory.
