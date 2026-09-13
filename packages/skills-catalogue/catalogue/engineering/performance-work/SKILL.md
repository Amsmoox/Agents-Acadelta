---
name: performance-work
description: Make something faster, with evidence that it was slow and evidence that it is not any more. Use when latency, cost or throughput is a stated problem.
recommendedForRoles:
  - engineer
  - devops
tags:
  - performance
  - engineering
---

# Performance work

Optimisation without measurement is decoration.

## Order

1. **State the target.** "The report page takes 9 seconds and should take under
   2" is a target. "Make it faster" is not.
2. **Measure where the time goes.** Profile, trace, or time the stages. Do not
   guess: the slow part is routinely not the part everybody blames.
3. **Fix the biggest thing.** A 90% improvement on 3% of the time is nothing.
4. **Measure again** on the same workload. Keep the before and after numbers.
5. **Stop** when you hit the target. Past that you are spending time nobody asked
   you to spend.

## Where the time usually is

- **Queries in a loop.** One query per row, called from a template. Look for this
  first; it is the most common and the easiest to fix.
- **A missing index.** Read the query plan, do not assume. A sequential scan on a
  large table is visible immediately.
- **Fetching more than you show.** Selecting every column and every row to
  display twenty.
- **Work done repeatedly** that could be done once, or at write time instead of
  read time.
- **Serial round trips** that could be concurrent.

## Measure honestly

- Use a realistic data volume. Everything is fast with a hundred rows.
- Report a percentile, not an average. An average hides the slow tail, and the
  slow tail is what people complain about.
- Warm the cache the same way in both runs, or neither.

## Before adding a cache

A cache is a correctness problem you are choosing to take on: staleness,
invalidation, and a second source of truth. Exhaust the cheaper fixes first — an
index, a smaller query, removing the loop — and when you do add one, decide how
it is invalidated before you write it.
