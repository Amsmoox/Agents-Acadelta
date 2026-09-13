---
name: threat-modelling
description: Work out what an attacker would try before they try it. Use when designing a feature that handles money, personal data, authentication or third-party input.
recommendedForRoles:
  - security
  - engineer
  - cto
tags:
  - security
  - design
---

# Threat modelling

Four questions, in order. Most of the value is in the first.

## When to use

Designing anything that touches authentication, authorisation, money, personal
data, file uploads, or content from outside your system.

## The questions

1. **What are we building?** Draw the data flow: what enters, what stores it,
   what reads it, and where the trust boundaries are. Most missed vulnerabilities
   are missed because nobody drew this.
2. **What can go wrong?** Walk each boundary. Who can reach it? What do they
   control? What happens if they send something hostile, something enormous, or
   the same thing a thousand times?
3. **What are we doing about it?** For each, decide: mitigate, accept, or
   transfer. Write the decision down — an accepted risk that nobody recorded
   looks like an oversight later.
4. **Did we do a good job?** Review it when the design changes.

## Prompts that find real things

- **Spoofing** — can somebody act as another user or service?
- **Tampering** — can they change data in transit or at rest?
- **Repudiation** — could someone deny doing it, and would we be able to show
  otherwise?
- **Information disclosure** — what leaks in errors, logs, timing, or a 403 that
  should be a 404?
- **Denial of service** — what is unbounded? Request size, result set, retries,
  file upload, regex.
- **Elevation of privilege** — where is authorisation checked, and is it checked
  on every path or only the one through the UI?

## Rank honestly

Order by what it would cost and how easily it can be reached. An unauthenticated
data leak beats a theoretical attack requiring physical access, however clever
the second one is.
