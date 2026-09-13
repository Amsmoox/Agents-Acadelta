---
name: handing-work-over
description: Give work to somebody else so they can start immediately and finish without you. Use when delegating a task, requesting a review, or passing work between agents.
recommendedForRoles:
  - pm
  - cto
  - engineer
  - qa
  - general
tags:
  - delegation
  - communication
  - teamwork
---

# Handing work over

The handover is the work. A task somebody has to come back and ask about was not
delegated, it was announced.

## When to use

Giving a task to another person or agent, requesting a review, or returning work
that needs changes.

## What travels with it

- **What is needed**, in one sentence, as an outcome rather than an instruction.
- **Why** — enough that they can make a sensible decision at a fork you did not
  anticipate. This is the part most often left out and the part that most often
  causes the wrong thing to be built.
- **What you already know** — what you tried, what you ruled out, where the
  relevant code or document is. Every minute of context you write saves an hour
  of rediscovery.
- **How anyone will know it is done.** Checkable, by them, without you.
- **What is out of scope**, if there is an obvious adjacent thing you do not want
  done.

## Pick the right person

By what the work needs, not by who is free. Handing a security review to whoever
has capacity produces a review-shaped object.

## Returning work

When sending something back, the reason is the entire value of the message. Say
what is wrong, how you found it, and what would make it right. "Doesn't work" is
not a reason; "a single space still passes because the check is `!password` and
should be `!password.trim()`" is a fix.

## Do not

Do not hand back work to somebody who is already waiting on you for something
else in the same chain — that is a loop, and both halves will sit there. Resolve
your own part first, or hand it to a third person.
