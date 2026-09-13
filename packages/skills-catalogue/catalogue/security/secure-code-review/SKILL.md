---
name: secure-code-review
description: Read code specifically for vulnerabilities rather than for correctness. Use when reviewing anything that handles input, authentication, or sensitive data.
recommendedForRoles:
  - security
  - engineer
tags:
  - security
  - review
---

# Secure code review

An ordinary review asks whether the code does what it should. This one asks what
else it can be made to do.

## When to use

Any change touching authentication, authorisation, user input, file handling,
serialisation, or a third-party integration.

## Follow the input

Start at every place data enters — request bodies, query strings, headers,
cookies, file uploads, webhooks, message queues, anything a model produced — and
follow each one to where it is used. Vulnerabilities live at the destination.

Check at each destination:

- **A query** — is it parameterised? String concatenation into SQL, a shell
  command, an LDAP filter or a template is the whole bug.
- **A response** — is it escaped for where it lands? HTML, an attribute, a URL
  and JavaScript each need different escaping.
- **A path** — can it escape the directory? `../`, an absolute path, a symlink.
- **A URL the server fetches** — can it be pointed at internal addresses?
- **Deserialisation** — can it construct arbitrary objects?

## Authorisation

The most common serious defect is not a missing check but a check in one place
and not another. For every resource, ask: is authorisation enforced on every
route that reaches it, including list endpoints, exports, and the one added last
week? Is it enforced by identity from the session, or by an id from the request?

An id from the request that is trusted is how one customer reads another's data.

## Secrets and errors

Look for credentials in code, in logs, in error responses, in client bundles.
Check that failures do not disclose whether a record exists, and that a resource
in another tenant answers not-found rather than forbidden.

## Report it

Name the input, the path it takes, and what an attacker gets. A finding without
those three is a suggestion.
