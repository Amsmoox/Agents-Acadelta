---
name: sql-analysis
description: Answer a question with SQL and be confident the answer is right. Use when asked for a number, a breakdown, or a trend from a database.
recommendedForRoles:
  - researcher
  - engineer
  - pm
  - cfo
tags:
  - sql
  - data
  - analysis
---

# SQL analysis

The difficulty is almost never the SQL. It is knowing whether the number means
what somebody thinks it means.

## When to use

Producing a figure, a breakdown or a trend from a database.

## Before writing the query

- **What exactly is being asked?** "How many users" — active when? Including
  deleted? Counting accounts or people? Getting this wrong produces a confident,
  precise, wrong answer.
- **What does the table actually contain?** Look at a few rows. Check for soft
  deletes, test accounts, duplicate rows, nulls where you expect values, and the
  timezone the timestamps are in.

## Writing it

- Filter out test and internal accounts, explicitly. They are almost never what
  the asker means.
- Be precise about time boundaries and say which timezone. "Last month" is
  ambiguous and the difference is often material.
- Beware `JOIN` fan-out: joining to a one-to-many table multiplies rows, and
  every `SUM` after it is wrong. Aggregate first, then join.
- `COUNT(column)` skips nulls; `COUNT(*)` does not. This is a common silent error.
- `LEFT JOIN` followed by a `WHERE` on the right-hand table is an inner join.

## Check it

- Compute it a second way and compare. Different shapes agreeing is real evidence.
- Check the total against something known.
- Look at the extremes. The largest and smallest rows expose bad joins and stray
  test data immediately.
- Sanity-check the magnitude. A number ten times what anybody expected is usually
  a fan-out, not a discovery.

## Report it

Give the number, the definition you used, the period, and what you excluded. A
figure without its definition will be compared against a differently-defined one
within the week.
