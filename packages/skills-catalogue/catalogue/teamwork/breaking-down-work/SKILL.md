---
name: breaking-down-work
description: Split a large piece of work into tasks that can be done independently and finished. Use when planning a feature, or when a task is too big to start.
recommendedForRoles:
  - pm
  - cto
  - engineer
  - ceo
tags:
  - planning
  - delegation
  - teamwork
---

# Breaking down work

A good breakdown means somebody can pick up any piece and finish it without
asking you.

## When to use

A piece of work is too large to start, or needs to be shared between several
people or agents.

## Split by value, not by layer

"The API part" and "the UI part" cannot be finished, demonstrated, or accepted on
their own, and neither is done until both are. Split along things a user could
notice: one behaviour, end to end, however small.

The exception is when one piece genuinely blocks another and can be finished
first — then say so explicitly as a dependency, rather than leaving it implied.

## What each piece needs

- **One sentence** of what it is, in the user's terms.
- **Enough context to start.** Assume the person picking it up was not in the
  conversation where it was decided.
- **A way to tell it is finished.** Checkable by somebody who did not do it.
- **Its dependencies**, named. "Cannot start until X" is information; discovering
  it halfway through is a wasted day.

## Size

Small enough to finish in one sitting, large enough to be worth handing over.
Too big and it stalls invisibly; too small and coordinating them costs more than
doing them.

## Signs it is wrong

- Two pieces that have to be done by the same person at the same time. That is one
  piece.
- A piece nobody can start until three others finish. Sequence them, or find the
  independent part.
- A piece whose description is a technical instruction. That means the decision
  was already made and the breakdown is a to-do list, not a plan.
