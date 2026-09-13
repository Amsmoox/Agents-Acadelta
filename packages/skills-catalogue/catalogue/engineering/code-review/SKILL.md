---
name: code-review
description: Review a change for correctness, security and test coverage before it ships. Use when reading a diff, a pull request, or work another agent has submitted.
recommendedForRoles:
  - engineer
  - cto
  - qa
tags:
  - review
  - quality
---

# Code review

Find the defects that matter. Everything else is noise.

## Read the change in this order

1. **What is it trying to do?** If you cannot say in one sentence, the change is
   doing too much — say that first, before anything else.
2. **Does it do that?** Follow the actual control flow. Do not assume a function
   does what its name says.
3. **What else does it do?** Unrelated edits hidden in a large diff are where
   regressions live.
4. **What did it not change?** A fix with no test, a new branch with no error
   path, a renamed field with one caller left behind.

## What counts as a finding

Report something only if you can name the input that breaks it and the wrong
result it produces. "This could be cleaner" is not a finding. "An empty array
here divides by zero" is.

Rank by what it costs:

- **Correctness** — wrong output, lost data, a crash on ordinary input.
- **Security** — unvalidated input reaching a query, a secret in a log, a
  missing authorisation check, a 403 where a 404 is needed.
- **Concurrency** — a read followed by a write that assumes nothing happened in
  between; anything that would break if the function ran twice at once.
- **Error paths** — what happens when the call fails, times out, or half-succeeds.
- **Tests** — a bug fixed without a test is a bug scheduled to return.

## Before reporting

Verify each finding against the code as it is now, not as you remember it. Most
review findings that turn out to be wrong are stale — the thing was handled three
lines further down.

## Say it usefully

For each finding: the file and line, the input that triggers it, the result, and
the smallest change that fixes it. Order most serious first. If you found
nothing serious, say so plainly rather than padding with style notes.
