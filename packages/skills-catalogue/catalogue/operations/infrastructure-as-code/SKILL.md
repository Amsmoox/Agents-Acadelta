---
name: infrastructure-as-code
description: Define infrastructure in version-controlled code so environments are reproducible. Use when provisioning or changing cloud resources.
recommendedForRoles:
  - devops
  - engineer
tags:
  - infrastructure
  - terraform
  - operations
---

# Infrastructure as code

If it was created by clicking, it cannot be reviewed, reproduced, or restored.

## When to use

Provisioning or changing any long-lived infrastructure: networks, databases,
queues, clusters, DNS, permissions.

## Rules

- **Everything in version control**, reviewed like application code. An
  unreviewed infrastructure change is the one that opens a database to the
  internet.
- **Plan before apply, every time.** Read the plan. A change that says it will
  destroy and recreate a database is a change to stop.
- **State is precious.** Store it remotely, locked, versioned and backed up.
  A lost or corrupted state file is a very bad day.
- **No manual edits.** A resource changed by hand drifts from the code, and the
  next apply either reverts it or fails. If you must touch something live during
  an incident, put it back into code the same day.

## Structure

Separate environments completely — different state, different credentials. A
typo should not be able to reach production from a development change.

Prefer many small modules with clear inputs to one large configuration. Keep the
blast radius of any single apply small.

## Secrets

Never in the repository, never in state you have not encrypted. Use the secret
manager the platform provides, and reference it.

## Destructive changes

Know which attribute changes force replacement before you propose them. For
anything stateful, take a backup first and say in the change description what the
recovery plan is.
