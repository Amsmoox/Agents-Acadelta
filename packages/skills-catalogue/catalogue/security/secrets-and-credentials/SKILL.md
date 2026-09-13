---
name: secrets-and-credentials
description: Handle keys, tokens and passwords so they do not leak, and respond when one does. Use when adding a credential, reviewing configuration, or after a suspected exposure.
recommendedForRoles:
  - security
  - devops
  - engineer
tags:
  - security
  - secrets
---

# Secrets and credentials

Assume every secret will eventually be read by someone who should not have it.
Design for how much that costs.

## When to use

Adding or rotating any credential, reviewing configuration, or responding to a
suspected leak.

## Rules

- **Never in the repository.** Not in code, not in configuration, not in a test
  fixture, not commented out. Git keeps it for ever, and history is public the
  moment the repository is.
- **Environment or secret manager**, injected at run time.
- **Never in an argument list.** Process arguments are readable by every user on
  the machine. Environment or a file with narrow permissions.
- **Never in a log**, an error message, a client bundle, or a transcript. Redact
  where it is written, not downstream.
- **Scope it.** A token that can do one thing costs one thing when it leaks.
- **Expire it.** A short-lived credential limits the window; a permanent one is a
  permanent liability.

## Rotation

Rotating should be routine, not an emergency procedure performed for the first
time during an emergency. It needs to work without downtime, which means the
system must accept the old and the new at once for a period.

## When one leaks

1. **Revoke first.** Before investigating, before telling anyone, before working
   out how bad it is. Revocation is cheap; the window is not.
2. Issue a replacement and deploy it.
3. Then find out what it could reach and whether it was used. Check the access
   logs for the whole period it was exposed, not just since you noticed.
4. Rewriting git history does not help — assume anything pushed was cloned.
