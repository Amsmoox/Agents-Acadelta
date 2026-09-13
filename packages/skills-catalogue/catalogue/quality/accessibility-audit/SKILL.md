---
name: accessibility-audit
description: Check an interface against WCAG and against how people actually use assistive technology. Use when reviewing UI work or auditing an existing screen.
recommendedForRoles:
  - qa
  - designer
  - engineer
tags:
  - accessibility
  - design
  - testing
---

# Accessibility audit

Automated tools catch perhaps a third of it. The rest needs a person.

## Do these first, in order

1. **Keyboard only.** Unplug the mouse. Can you reach everything, in a sensible
   order? Is the focus always visible? Can you escape every dialog and menu? Does
   focus return where it came from when one closes? A control you can reach but
   not see focused is a control that is not usable.
2. **Headings and landmarks.** One `h1`. No skipped levels. Real `nav`, `main`,
   `header`. A screen reader user navigates by these before anything else.
3. **Names.** Every control has an accessible name. An icon-only button needs
   `aria-label`. Every input has a real `<label>`, not a placeholder standing in
   for one.
4. **Colour.** 4.5:1 for body text, 3:1 for large text and for the visual
   boundary of a control. And nothing may be conveyed by colour alone — a red
   border with no message is invisible to a third of colour-blind users.
5. **Images.** Meaningful ones have alt text that says what they mean. Decorative
   ones have `alt=""`, not a filename.
6. **Live changes.** Something that appears without a page load — a toast, a
   validation error, a result count — needs an appropriate live region, or it
   happens silently.

## Forms specifically

Errors must be associated with their field, described in text, and announced. An
error summary that says "please fix the errors below" helps nobody who cannot see
below.

## Motion and zoom

Respect `prefers-reduced-motion`. Check the page at 200% zoom and at 400% — text
must reflow rather than being cut off or requiring horizontal scrolling.

## Report it usefully

For each finding: the element, the guideline, who it affects and how, and the
fix. "Fails 1.4.3" tells a developer nothing on its own.
