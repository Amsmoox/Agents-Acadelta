---
name: bug-reporting
description: Write a defect report somebody can act on without asking you anything. Use whenever you find something broken and are handing it to someone else to fix.
recommendedForRoles:
  - qa
  - engineer
tags:
  - testing
  - communication
---

# Bug reporting

The report is the deliverable. A defect nobody can reproduce is a defect nobody
will fix.

## What every report needs

1. **Title** — the symptom, specific. "Empty password is accepted at the payment
   step", not "login broken".
2. **Steps** — numbered, from a known starting state, with the exact values you
   used. "Enter a single space" not "enter something invalid".
3. **Expected** — what should have happened, and why you believe that.
4. **Actual** — what did happen, quoted exactly. Include the error text verbatim.
5. **Scope** — does it happen every time? On other browsers, other accounts,
   other data? Where did you stop looking?
6. **Evidence** — the request and response, the log line, the screenshot, the
   commit you tested.

## Severity, honestly

Say what it costs, not how you feel about it. Data loss, a security hole and a
misaligned icon are three different things, and calling all of them urgent makes
the word useless.

## Narrow it before you file it

Two minutes spent removing irrelevant steps saves an hour later. Try to make it
fail with less: fewer steps, simpler data, a smaller account. If it stops
failing, you have learned something worth putting in the report.

## Your verdict is the deliverable

An investigation that finds eleven defects **succeeded**. Report it as finished
work with an adverse result, not as a failure or a blockage. Blocked means you
could not proceed; it does not mean the news is bad.
