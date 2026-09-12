# Notice

**agentco** — a control plane for running a company of AI agents.

Copyright © 2026 **Mharrech Ayoub** \<mharrech.ayoub@gmail.com\>
Licensed under the MIT License. See [`LICENSE`](./LICENSE).

## Attribution requirement

The MIT License permits use, modification, distribution and commercial use —
but it is **conditional**. The copyright notice and permission notice above
must be retained in all copies or substantial portions of the Software.

That includes:

- the `LICENSE` file
- this `NOTICE.md`
- the `SPDX-FileCopyrightText` headers at the top of every source file

Removing them does not make the code unlicensed. It makes the copy
**non-compliant**, and every subsequent distribution of it an infringement.

## If you forked this

You are welcome to. Keep the notices, add your own copyright line for your
changes, and state clearly that your work is derived from this project.

## Provenance

Every build reports its own origin at `GET /health/provenance` — project name,
version, repository and commit. That endpoint is part of the software, not
telemetry: it makes an outbound request to nobody and reports only to whoever
queries it.
