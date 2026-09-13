---
name: release-and-rollback
description: Ship a change to production and be able to undo it. Use when planning a deploy, a migration, or a risky feature launch.
recommendedForRoles:
  - devops
  - engineer
  - cto
tags:
  - deployment
  - release
  - operations
---

# Release and rollback

Every release is a bet. The question is what it costs when you are wrong.

## When to use

Planning any deploy that could affect users: a feature launch, a schema change, a
dependency upgrade, a configuration change.

## Before

- **Know how to undo it**, and have tried. An untested rollback is a hope.
- **Separate the risky part.** A release with a migration, a feature and a
  refactor in it cannot be partially rolled back. Ship them in separate releases.
- **Decide what "it went wrong" looks like** — which metric, what threshold, how
  long you watch. Decide it beforehand, because afterwards everyone will argue
  about whether the graph is bad.

## Strategies, and when each fits

- **Rolling** — replace instances gradually. Fine for a stateless change with a
  compatible API.
- **Blue-green** — run both, switch traffic, keep the old one warm. Fast
  rollback, double the resources for a while.
- **Canary** — a small share of traffic first, watched, then widened. Best for
  anything where you are unsure, and the only one that finds problems that need
  real traffic to appear.
- **Feature flag** — ship the code dark, turn it on separately. Decouples deploy
  risk from release risk, and gives an instant off switch that needs no deploy.

## Data

Code can roll back. Data usually cannot. A migration that drops a column cannot
be undone by redeploying yesterday's build — so never destroy data in the same
release that stops using it. Expand, migrate, then contract, in separate releases
with time between them.

## After

Watch for longer than feels necessary. The failures that matter are often not
immediate: a slow leak, a queue filling, a nightly job meeting the new schema.
