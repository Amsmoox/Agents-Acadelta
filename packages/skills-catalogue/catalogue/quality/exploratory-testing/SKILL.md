---
name: exploratory-testing
description: Hunt for defects without a script, in the places scripted tests do not reach. Use when asked to audit a feature deeply or to find what nobody thought to check.
recommendedForRoles:
  - qa
tags:
  - testing
---

# Exploratory testing

Scripted tests check what somebody already thought of. This is for everything else.

## Charters

Work in short, named sessions with one question each, rather than wandering.
A charter is: *explore [this area] with [these resources] to discover [this kind
of information].* Time-box it, and write down what you find as you go.

## Where defects hide

- **Between features.** Each works alone; together they disagree about the same
  data.
- **The second time.** Do it twice. Do it twice quickly. Do it in two tabs.
- **Going backwards.** Browser back, cancel halfway, refresh mid-operation, close
  and return.
- **The boundaries of the real world.** A name with an apostrophe, an emoji, a
  right-to-left script. A number at zero and one below it. A date in February.
- **Interruption.** Kill the network mid-request. Log out in another tab.
- **Stale state.** A saved filter pointing at something deleted. A bookmark to a
  page whose data has changed underneath it.
- **Volume.** One row, and ten thousand. Empty, and full.

## While you work

Vary one thing at a time, so you can say what caused what. When something looks
odd, stop and pin it down before moving on — an oddity you cannot reproduce an
hour later is lost.

Record everything, including the things that turned out to be fine. Coverage you
cannot describe is coverage nobody can trust.
