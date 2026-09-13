---
name: ci-cd-pipelines
description: Build and maintain a pipeline that tells the truth quickly. Use when setting up CI, adding checks, or diagnosing a pipeline nobody trusts.
recommendedForRoles:
  - devops
  - engineer
tags:
  - ci
  - automation
  - operations
---

# CI and CD pipelines

A pipeline has one job: tell you whether this change is safe, before anybody
else finds out it was not.

## When to use

Setting up continuous integration, adding a gate, or fixing a pipeline that is
slow, flaky, or routinely ignored.

## What it must do

- **Run on every change**, in a clean environment, from a checkout — not from
  whatever happened to be on the machine.
- **Be deterministic.** The same commit gives the same result. Pin versions; do
  not resolve a dependency range at build time.
- **Be fast enough to wait for.** Past about ten minutes people stop watching and
  start merging on hope. Cache dependencies, run independent jobs in parallel,
  and run the cheapest checks first so an obvious failure fails in seconds.
- **Fail for one reason at a time.** A job that runs lint, tests and a build in
  one step makes you read the log to find out which broke.

## Flaky tests

A test that fails one run in twenty is worse than no test: it teaches everybody
to re-run without reading. Quarantine it the day you notice, and either fix it or
delete it that week. Do not add an automatic retry — that is how a real
intermittent bug stays hidden for a year.

## Deploying

- Build the artefact once and promote the same bytes through environments. Do not
  rebuild per environment.
- Every deploy has a rollback that has been tried, not assumed.
- Secrets come from the environment, never from the repository. A credential in a
  build log is a leaked credential.

## Signs it is not working

People re-run failed jobs without looking. The pipeline is red on the main branch
and nobody is alarmed. Anyone says "that check always fails."
