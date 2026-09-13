---
name: technical-writing
description: Write documentation people can act on. Use when writing a README, a guide, release notes, or an explanation of how something works.
recommendedForRoles:
  - pm
  - engineer
  - researcher
  - general
tags:
  - writing
  - documentation
---

# Technical writing

Documentation is read by somebody in a hurry who has a problem. Write for them.

## When to use

Any document whose purpose is to let somebody do something: a README, a runbook,
a guide, an API reference, release notes.

## Decide which kind it is

Four kinds, and mixing them is the most common failure:

- **Tutorial** — teaches a beginner by having them do something that works. No
  options, no alternatives, no explanation of internals.
- **How-to** — solves one problem for somebody who already knows the basics.
  Steps, in order.
- **Reference** — describes what exists, accurately and exhaustively. Boring by
  design. No narrative.
- **Explanation** — why it works this way, what was considered instead.

A README that tries to be all four teaches nobody and answers nothing.

## Rules that matter most

- **Start with what the reader wants to achieve**, not with what the thing is.
- **Say what to do**, in the imperative. "Run `x`" not "you may wish to run `x`".
- **Show the command and the expected output.** A step whose success cannot be
  recognised is a step people get stuck on.
- **State the prerequisites first**, so nobody gets three steps in before finding
  out they need an account.
- **Cut every sentence that does not change what the reader does.** Documentation
  is not paid by the word.

## Keep it true

Wrong documentation is worse than none — it costs the reader time and their
trust. When you change behaviour, change the document in the same commit. Date
anything you cannot commit to keeping current.
