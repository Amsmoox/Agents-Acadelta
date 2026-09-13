---
name: design-systems
description: Keep an interface consistent by building from shared tokens and components. Use when adding UI, reviewing visual work, or a product has started to look assembled from parts.
recommendedForRoles:
  - designer
  - engineer
tags:
  - design
  - frontend
  - consistency
---

# Design systems

Consistency is not an aesthetic preference. It is what lets somebody learn a
product once instead of every screen.

## When to use

Adding a new screen or component, or reviewing UI that has drifted.

## Tokens before components

Decide the small set once — colour, spacing, radius, type scale, shadow — and
name them by role rather than by value. `--surface` and `--danger`, not `--grey-2`
and `--red-500`: a role survives a rebrand, a value does not.

Never write a raw value in a component. The moment one component has its own
shade of grey, there are two systems.

## Colour carries meaning

Pick a rule and hold it. A good one: colour means state — active, needs
attention, failed, idle — and nothing else. Brand marks are the documented
exception. Under that rule a coloured element is always informative, and somebody
can scan a dense screen and see only what matters.

## Components

Before building one, check whether it exists. Two date pickers is not twice the
capability, it is twice the maintenance and two behaviours to learn.

A component owns its states — default, hover, focus, active, disabled, loading,
error — so no caller has to invent them. A component that cannot show its own
loading state will be wrapped in a bespoke one at every call site.

## Reviewing for drift

Look for: a hard-coded colour or spacing value, a one-off component duplicating
an existing one, the same concept with two names, a control with no visible focus
state, and text below the contrast threshold.
