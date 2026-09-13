---
name: observability
description: Instrument a system so failures explain themselves. Use when adding logging, metrics or tracing, or when an outage was hard to diagnose.
recommendedForRoles:
  - devops
  - engineer
  - cto
tags:
  - observability
  - monitoring
  - operations
---

# Observability

The test is simple: when something breaks at three in the morning, can somebody
find out why without adding code?

## When to use

Adding instrumentation, choosing what to alert on, or reviewing why a past
incident took too long to diagnose.

## The three, and what each is for

- **Logs** — what happened in one request. Structured key-value, not prose.
  Include a request id on every line so one journey can be followed end to end.
- **Metrics** — how the system behaves in aggregate, over time. Cheap, sampled,
  good for "is it getting worse".
- **Traces** — where the time went across services in one request. The only one
  that answers "which hop is slow".

## What to record

For every external call and every unit of work: what was attempted, whether it
succeeded, how long it took, and enough identity to find the row afterwards.

For every error: the error, the input that caused it, and the context to
reproduce it. An error log with no identifiers tells you something is wrong and
nothing else.

## Never log

Passwords, tokens, keys, full card numbers, personal data you would not put in an
email. Redact at the point of writing, not in a later pipeline — the pipeline
will be misconfigured one day.

## Alerts

Alert on symptoms users feel: error rate, latency, queue depth, failed
transactions. Do not alert on causes — CPU at 90% is fine if nobody notices.

Every alert must be actionable and documented: what it means, what to check, what
to do. An alert nobody acts on trains people to ignore the whole channel, which
costs you the one that mattered.
