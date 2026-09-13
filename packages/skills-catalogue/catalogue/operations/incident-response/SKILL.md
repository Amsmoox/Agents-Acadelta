---
name: incident-response
description: Run a live incident: stop the bleeding first, find the cause afterwards. Use when something is broken in production and users are affected.
recommendedForRoles:
  - devops
  - engineer
  - cto
tags:
  - incident
  - operations
  - reliability
---

# Incident response

Restore service first. Understanding comes second, and it comes better with the
pressure off.

## When to use

Something in production is failing or degraded and people are affected right now.

## When not to use

A defect nobody is hitting yet. That is a bug report, and it goes through the
ordinary queue.

## Order

1. **Declare it.** Say out loud that this is an incident and who is running it.
   Ambiguity about whether anything is happening costs more time than the fix.
2. **Assess.** What is broken, for whom, since when, how badly. Write it in one
   sentence and keep that sentence updated — it is what everyone else reads.
3. **Mitigate.** Roll back, fail over, disable the feature, shed load. Mitigation
   is not the fix and does not need to be elegant. If a rollback is available and
   plausible, do it before diagnosing further.
4. **Verify** the mitigation with the same signal that told you it was broken.
5. **Then** diagnose, at your own pace, with the incident closed.

## While it is running

- One person decides. Others investigate and report.
- Keep a timestamped log of what you observed and what you changed. Memory
  afterwards is unreliable and the log becomes the review.
- Change one thing at a time. Two simultaneous changes and you will not know
  which worked.
- Say what you do not know. "I do not yet know whether this is the cause" is more
  useful than a confident guess.

## Afterwards

Write it up while it is fresh: timeline, impact, what actually caused it, what
made it take as long as it did to notice and to fix. Look for the missing signal
and the missing guardrail. Blame the system, not the person who pressed the
button — the system let them.
