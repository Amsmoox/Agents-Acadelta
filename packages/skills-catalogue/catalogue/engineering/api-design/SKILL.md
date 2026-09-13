---
name: api-design
description: Design an HTTP API that is predictable and hard to misuse. Use when adding endpoints, changing a response shape, or reviewing an interface.
recommendedForRoles:
  - engineer
  - cto
tags:
  - api
  - design
---

# API design

An API is a promise. The cost of breaking it is paid by everyone who believed it.

## Shape

- **Resources, not actions.** `POST /orders` rather than `POST /createOrder`.
  Where a verb is genuinely the thing — archive, cancel, invoke — hang it off
  the resource: `POST /orders/:id/cancel`.
- **Use the method's meaning.** GET never changes anything. PUT replaces the
  whole thing. PATCH changes named fields. POST creates, or does the thing a verb
  route names.
- **One representation.** The object a list returns should be the object a fetch
  returns. A client that has to handle two shapes for one thing will get it wrong.

## Status codes people can act on

- `201` with the created object, not `200` with an id.
- `409` for a conflict with the current state; say what the conflict is.
- `422` for input that parsed but is not acceptable; name the field.
- `404` rather than `403` for a resource in another tenant — a 403 confirms it
  exists.
- `429` when a limit was hit, and say which one.

## Errors

Return a stable machine code and a sentence a person can read. The sentence is
not decoration: a caller given only a number retries the same request.

```json
{ "error": { "code": "ORDER_ALREADY_SHIPPED", "message": "That order shipped on 3 June and cannot be changed.", "detail": { "shippedAt": "..." } } }
```

## Paging

Use a keyset cursor, not an offset. Offsets skip and repeat rows when the table
is written to between requests. Put only the row identifier in the cursor and
read the sort key back from the row — a timestamp round-tripped through JSON
loses precision and drops rows at page boundaries.

## Changing an existing API

Add fields; do not remove or repurpose them. Widen what you accept before you
narrow what you return. When something must break, version the route rather than
changing the meaning of an existing one.
