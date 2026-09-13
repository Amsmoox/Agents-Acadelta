---
name: writing-requirements
description: Turn a request into work somebody can build and somebody else can verify. Use when given a vague ask, or before breaking a feature into tasks.
recommendedForRoles:
  - pm
  - cto
  - ceo
tags:
  - product
  - planning
  - requirements
---

# Writing requirements

A requirement that cannot be checked is an opinion.

## When to use

You have been asked for something in one sentence and it needs to become work.

## Start with the problem

Write down who has the problem, what they do today instead, and what it costs
them. If you cannot answer those, the answer is not a specification — it is a
question for whoever asked.

Do not start from a solution. "Add a filter dropdown" is a design decision
wearing a requirement's clothes, and it forecloses better answers.

## Then the shape

For each piece of work:

- **What** — one sentence, in the user's terms, not the system's.
- **Why** — the problem it solves. This is what lets somebody make a sensible
  call when they hit an unexpected fork.
- **Acceptance criteria** — checkable statements. Given this state, when this
  happens, then this is true. Someone who did not write it must be able to test
  it and get the same answer as you.
- **Out of scope** — what this deliberately does not do. This prevents more
  argument than anything else on the list.

## Decisions, not wishes

Name the things that are genuinely undecided and decide them, or say who decides
and by when. A specification full of "TBD" transfers the decision to whoever
implements it, at the worst possible moment.

## Size

If it cannot be described in a page, it is more than one piece of work. Split it
along user-visible value, not along technical layers — "the API part" is not
something anybody can accept.
