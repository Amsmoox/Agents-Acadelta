---
name: seo-audit
description: Audit a site for the things that actually affect search visibility. Use when traffic is flat or falling, or before publishing a new site section.
recommendedForRoles:
  - cmo
  - researcher
  - general
tags:
  - seo
  - marketing
  - audit
---

# SEO audit

Most SEO advice is noise. A small number of things move the result.

## When to use

Organic traffic is flat or falling, a new section is about to launch, or a
migration is planned.

## Order, by what it costs when wrong

1. **Can it be crawled and indexed?** `robots.txt`, `noindex` tags, canonical
   tags pointing somewhere wrong, pages reachable only by a script. A page that
   cannot be indexed cannot rank, and this is where catastrophic mistakes live —
   a `noindex` left on after a staging deploy costs everything.
2. **Is there one URL per thing?** Duplicates with tracking parameters, both
   trailing-slash forms, both protocols, both www forms. Pick one, redirect the
   rest permanently, and set canonicals.
3. **Does each page answer one question?** Title and heading matching what
   somebody actually searched, and content that answers it in the first screen.
4. **Is it fast on a phone?** Largest contentful paint and layout shift, measured
   on real devices rather than a desktop lab run.
5. **Internal links.** A page nothing links to is a page that will not rank.
   Link from related pages with the words people search for.

## What to ignore

Keyword density, meta keywords, exact-match anchor text everywhere, and anything
promising a specific rank. They do not work and some are penalised.

## Migrations

The single biggest risk. Map every old URL to a new one, redirect permanently
with a 301, and keep them for years. Check the map before launch and the error
logs for weeks after.

## Report it

Per finding: the pages affected, the evidence, the estimated impact, and the fix.
Order by impact, not by ease.
