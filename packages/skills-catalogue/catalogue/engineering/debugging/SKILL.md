---
name: debugging
description: Find the true cause of a defect and prove the fix. Use when something behaves wrongly and the reason is not yet known.
recommendedForRoles:
  - engineer
  - qa
tags:
  - debugging
  - quality
---

# Debugging

The goal is not to make the symptom disappear. It is to know why it happened.

## Order of work

1. **Reproduce it.** A defect you cannot reproduce is a defect you cannot know
   you have fixed. Write down the exact steps and the exact wrong result. If it
   only happens sometimes, find what differs between the times it does and does not.
2. **Narrow it.** Cut the reproduction down until removing anything else makes it
   stop. Bisect: by input, by code path, by commit. Each step should halve what
   is left.
3. **Explain it.** State the cause as a sentence with a mechanism: "the cursor
   carries a timestamp, Postgres keeps microseconds, JavaScript Date does not,
   so rows sharing a millisecond are skipped." If you cannot write that sentence,
   you have found a correlation, not a cause.
4. **Fix the cause.** A fix that makes the symptom go away without explaining it
   moves the defect rather than removing it.
5. **Prove it.** Write a test that fails before the fix and passes after. Run it
   both ways round — a test that never failed proves nothing.

## When you are stuck

- Check your assumptions one at a time, cheapest first. Print the value you are
  certain about; it is often the one that is wrong.
- Read the error text literally, including the parts you think you understand.
- Look at what changed. If it worked last week, something is different.
- Reproduce it in isolation, outside the application. Most "framework bugs" stop
  reproducing at that point, and the ones that do not are worth reporting.

## Do not

Do not add a retry, a longer timeout, a null guard or a try/catch to make a
symptom stop, unless you can say why the underlying condition is legitimate.
Silencing an error deletes the evidence for whoever meets it next.
