---
name: test-planning
description: Enumerate what to test before testing any of it, so nothing important is missed. Use when planning coverage for a feature, a release, or an audit.
recommendedForRoles:
  - qa
  - engineer
  - pm
tags:
  - testing
  - planning
---

# Test planning

Write the cases down first. A plan made while testing tests what was easy to
reach.

## Eight dimensions

Work through all of them. Each case is one line: **input → expected**.

1. **Normal flows** — the happy path, and the second and third visit, which are
   different from the first.
2. **Edge cases** — zero, one, very many. Empty, missing, maximum. A brand-new
   account. A saved selection that no longer exists.
3. **Invalid input** — bounds, wrong types, empty against null, hostile strings,
   payloads far larger than expected.
4. **Failure** — every error the dependency can return, timeouts, malformed
   responses, a batch that half-succeeds, no network at all.
5. **Permissions** — signed out, wrong tenant, each role, an entitlement that
   expired, an identifier guessed from another account.
6. **State transitions** — loading to data to empty to error to retry. What a
   background job does to a screen somebody is looking at.
7. **Races** — two tabs, a double submit, rapid switching, responses arriving out
   of order, two writers on one row.
8. **Regressions** — everything already asserted about this area, plus every
   other caller of anything shared you touched.

## Then

Mark each case: verified, failed, or **untested**. Untested is a real outcome —
record what it needed that you did not have. Quietly dropping a case you could
not run is how a gap becomes a surprise.

## Sizing

Not every dimension deserves equal weight. Spend it where a defect would cost
most: data loss, money, access to somebody else's information. A cosmetic
regression on a rarely used screen is worth one line, not ten.
