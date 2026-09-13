---
name: writing-tests
description: Decide what to test and write tests that catch real defects. Use when adding a feature, fixing a bug, or finding existing tests that pass while the code is broken.
recommendedForRoles:
  - engineer
  - qa
tags:
  - testing
  - quality
---

# Writing tests

A test earns its place by failing when the code is wrong.

## What to test

Test **behaviour and invariants**, not implementation. A test pinned to the exact
words of a message breaks on every honest rewrite; a test that asserts the
affordance exists survives it.

Cover, in this order:

1. **The contract** — the thing the code promises for ordinary input.
2. **The boundaries** — zero, one, many; empty, missing, maximum; first and last.
3. **The failure paths** — every error the function can return, and what state is
   left behind when it does.
4. **The invariant** — the thing that must be true no matter the order of events.
   These are the tests worth the most and the ones most often missing.

## Regression tests

Every bug fixed gets a test that fails without the fix. Name it for the
behaviour, not the ticket, and put a comment above it saying what went wrong —
the next person to see it fail needs to know what it is protecting.

## Make it fail first

Run a new test against the unfixed code and watch it fail. A test that has never
failed is an assertion about nothing. When you cannot easily do that, change the
expected value, confirm it fails, and change it back.

## Concurrency and isolation

Race conditions need a real concurrent test — two calls in flight at once — not a
mock that returns in a fixed order. Data isolation needs a real second tenant,
not a stubbed permission check.

## Signs of a bad test

- It passes when you break the code.
- It fails when you rename something private.
- It depends on state another test left behind.
- It asserts on a log line, a timestamp, or the order of an unordered collection.
