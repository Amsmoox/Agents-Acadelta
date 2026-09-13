---
name: database-migrations
description: Change a database schema without downtime or lost data. Use when adding, altering or removing columns, tables or indexes on a live system.
recommendedForRoles:
  - engineer
  - devops
  - cto
tags:
  - database
  - operations
---

# Database migrations

The old code and the new code will run at the same time. Every migration has to
be safe for both.

## Expand, migrate, contract

Never change a column in place. Three deployments:

1. **Expand** — add the new column, nullable, with no constraint. Deploy code
   that writes both old and new and reads the old.
2. **Migrate** — backfill in batches. Deploy code that reads the new column.
3. **Contract** — once nothing reads the old column, drop it.

Each step is independently deployable and independently reversible. Skipping the
middle one is how a deploy takes the site down.

## Operations that lock

Know which ones take a lock that blocks writes on your database, and how long it
holds for on a table of your size. On PostgreSQL:

- Adding a nullable column with no default is cheap.
- Adding `NOT NULL` to an existing column rewrites the table unless you add a
  validated check constraint first.
- Creating an index blocks writes unless you build it `CONCURRENTLY`.
- Changing a column type usually rewrites the table.

Test the migration against a copy of production-sized data, not an empty
development database. The difference between one second and forty minutes only
appears at scale.

## Backfills

Batch them. A single `UPDATE` over ten million rows holds one transaction open
for the whole run, bloats the table, and cannot be interrupted. Loop over ranges
of the primary key, commit each batch, and make the loop resumable.

## Always

- Write the down migration, and try it.
- Never destroy data in the same deploy that stops using it. Leave a gap long
  enough to notice a mistake.
- Constraints and indexes are the cheapest correctness you will ever buy. Prefer
  a unique index to a check in application code: only the index sees both sides
  of a race.
