---
name: refactoring
description: Change the shape of code without changing what it does. Use when code is hard to work with and the behaviour must stay identical.
recommendedForRoles:
  - engineer
  - cto
tags:
  - refactoring
  - engineering
---

# Refactoring

Refactoring changes structure and nothing else. The moment behaviour changes, it
is not a refactor any more — it is a change, and it needs the scrutiny of one.

## Before you start

- **Have tests.** Without them you cannot tell a refactor from a rewrite. If
  there are none, write characterisation tests first: capture what the code does
  now, including the parts that look wrong.
- **Know why.** "Cleaner" is not a reason. A reason is: this is the third time
  this week somebody has had to change the same thing in four places.

## How

1. One transformation at a time. Rename, or extract, or move — not all three.
2. Run the tests after each one.
3. Commit each step separately, so a mistake can be undone without losing the rest.

## Keep separate

Never mix a refactor with a behaviour change in one commit. When a reviewer has
to read four hundred moved lines to find the two that changed, they will not find
them. Move first, change second, in two commits.

## When to stop

Stop when the thing you wanted to do next is easy. Refactoring is not an end in
itself, and a codebase can be polished long past the point where anybody
benefits.

## Worth doing

- The same change having to be made in several places.
- A function whose name and behaviour have drifted apart.
- A conditional nobody can read, guarding something simple.
- Duplication that has been copied a third time.

## Not worth doing

- Code nobody is going to touch again.
- Style that differs from your preference but is consistent with its neighbours.
- Anything you cannot test.
