---
name: containers
description: Build small, reproducible container images and run them safely. Use when writing a Dockerfile, debugging an image, or reviewing container configuration.
recommendedForRoles:
  - devops
  - engineer
tags:
  - docker
  - containers
  - operations
---

# Containers

An image should be small, reproducible, and contain nothing it does not need.

## When to use

Writing or reviewing a Dockerfile, or diagnosing why an image is enormous, slow
to build, or behaves differently from the developer machine.

## Building

- **Pin the base image** to a digest, not `latest`. `latest` means your build is
  not reproducible and can change under you overnight.
- **Multi-stage.** Compile in one stage, copy only the artefact into a minimal
  runtime stage. Build tools in a production image are both weight and attack
  surface.
- **Order layers by how often they change.** Dependency manifests and install
  first, application source last — otherwise every source edit reinstalls
  everything.
- **Use `.dockerignore`.** Without it the whole working directory, including
  `.git` and local secrets, goes into the build context.

## Running

- **Not as root.** Create a user and switch to it.
- **Read-only filesystem** where you can, with explicit writable volumes.
- **Set resource limits.** An unbounded container will take the node down with it.
- **Configuration through environment**, state through volumes. An image should
  be identical in every environment.
- **One concern per container.** If you are running a supervisor inside, you
  probably want two containers.

## Health

Give it a health check that tests the thing it does, not just that the process is
alive. A process that is running but cannot reach its database is not healthy,
and the orchestrator cannot know that unless you tell it.

## Secrets

Never in `ENV` in the Dockerfile, never in a layer. Anything written into a layer
stays in the image history even if a later layer deletes it.
