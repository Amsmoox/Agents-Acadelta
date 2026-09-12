// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createDispatchRepository } from "@agentco/core";
import { AppError, NON_INVOKABLE_STATUSES } from "@agentco/shared";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createAgentRepository } from "../agents/repository.js";

const orgParams = z.object({ orgRef: z.string().min(1).max(63) });
const agentParams = orgParams.extend({ ref: z.string().min(1).max(63) });
const runParams = orgParams.extend({ runId: z.uuid() });

const invokeSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000).optional(),
});

const SSE_HEARTBEAT_MS = 15_000;
const SSE_POLL_MS = 500;

export async function registerRunRoutes(instance: FastifyInstance) {
  const organizations = createOrganizationRepository(instance.db);
  const agents = createAgentRepository(instance.db);
  const dispatch = createDispatchRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const orgId = async (ref: string) => (await organizations.requireByRef(ref)).id;
  /** Invoking spends money, so it needs a live organization. Cancelling does not. */
  const activeOrgId = async (ref: string) => (await organizations.requireActiveByRef(ref)).id;

  /**
   * Asks an agent to run.
   *
   * Returns immediately: this records the intent, and the runner picks it up.
   * A request that waited for the agent to finish would hold a connection open
   * for as long as the work takes.
   */
  app.post(
    "/organizations/:orgRef/agents/:ref/invoke",
    { schema: { params: agentParams, body: invokeSchema } },
    async (request, reply) => {
      const org = await activeOrgId(request.params.orgRef);
      const agent = await agents.get(org, request.params.ref);

      if (NON_INVOKABLE_STATUSES.includes(agent.status)) {
        throw new AppError("AGENT_NOT_INVOKABLE", { status: agent.status });
      }
      if (!agent.eligibility.invokable) {
        throw new AppError("AGENT_NOT_INVOKABLE", { reason: agent.eligibility.reason });
      }

      const result = await dispatch.requestWake(
        org,
        agent.id,
        { type: "manual", at: new Date().toISOString() },
        request.body.prompt,
      );

      // 202: accepted, not done. The run may not have started yet.
      return reply.status(202).send({ queued: true, coalesced: result.coalesced });
    },
  );

  app.get(
    "/organizations/:orgRef/agents/:ref/runs",
    { schema: { params: agentParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agents.get(org, request.params.ref);
      return { data: await dispatch.listRuns(org, agent.id) };
    },
  );

  /**
   * Every run in the organization, newest first.
   *
   * Without this the only way to see a run was to already know which agent
   * produced it, so "what is happening right now" meant opening each agent in
   * turn. A company of four agents is the case this product is for.
   */
  app.get(
    "/organizations/:orgRef/runs",
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          status: z.enum(["live", "finished"]).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      return {
        data: await dispatch.listOrganizationRuns(org, {
          limit: request.query.limit,
          ...(request.query.status ? { status: request.query.status } : {}),
        }),
      };
    },
  );

  app.get(
    "/organizations/:orgRef/runs/:runId",
    { schema: { params: runParams } },
    async (request) => dispatch.getRun(await orgId(request.params.orgRef), request.params.runId),
  );

  app.post(
    "/organizations/:orgRef/runs/:runId/cancel",
    { schema: { params: runParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      await dispatch.requestCancel(org, request.params.runId);
      // The runner notices on its next heartbeat and stops the process; the run
      // is not finished at the moment this returns.
      return { cancelling: true };
    },
  );

  /**
   * The live transcript.
   *
   * Server-sent events rather than a socket: this is one-way, and SSE brings
   * reconnection and resumption with it. Each event carries its sequence
   * number, so a reader that drops out resumes with `Last-Event-ID` instead of
   * replaying the run or missing its middle.
   */
  app.get(
    "/organizations/:orgRef/runs/:runId/stream",
    { schema: { params: runParams, querystring: z.object({ from: z.coerce.number().optional() }) } },
    async (request, reply) => {
      const org = await orgId(request.params.orgRef);
      const runId = request.params.runId;
      await dispatch.getRun(org, runId);

      // `Last-Event-ID` wins over `?from=`. The browser sets the header by
      // itself on a reconnect and knows exactly where the reader got to; a
      // `from` in the URL is whatever the page was first opened with, and
      // letting it win replayed the whole run into an already-populated view.
      const lastEventId = request.headers["last-event-id"];
      const resumeAt = typeof lastEventId === "string" ? Number.parseInt(lastEventId, 10) : NaN;
      let cursor = Number.isFinite(resumeAt) ? resumeAt : (request.query.from ?? 0);

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Without this a reverse proxy buffers the stream and delivers nothing
        // until the run ends, which looks exactly like a hung agent.
        "x-accel-buffering": "no",
      });

      let closed = false;
      request.raw.on("close", () => {
        closed = true;
      });

      const send = (event: { id?: number; event: string; data: unknown }) => {
        if (closed) return;
        if (event.id !== undefined) reply.raw.write(`id: ${event.id}\n`);
        reply.raw.write(`event: ${event.event}\n`);
        reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
      };

      // A comment every so often: proxies and load balancers drop a connection
      // that has been silent, and a quiet agent is not a dead one.
      const heartbeat = setInterval(() => {
        if (!closed) reply.raw.write(": keep-alive\n\n");
      }, SSE_HEARTBEAT_MS);

      /**
       * Sends everything after the cursor, however much there is.
       *
       * `listEvents` returns at most a page, so one call is not "the rest" — a
       * chatty agent producing more than a page between polls had the overflow
       * left behind until the next tick, and if the run ended on that tick, for
       * good.
       */
      const drain = async (): Promise<void> => {
        for (;;) {
          const events = await dispatch.listEvents(runId, cursor);
          if (events.length === 0) return;
          for (const event of events) {
            cursor = event.seq;
            send({ id: event.seq, event: event.kind, data: event.payload });
          }
          if (closed) return;
        }
      };

      try {
        while (!closed) {
          await drain();

          const run = await dispatch.getRun(org, runId);
          if (run.status !== "running" && run.status !== "leased") {
            // One last pass before saying done. A run writes its final output
            // and *then* marks itself finished, so anything landing between the
            // drain above and this read would have been announced as complete
            // and never sent — the end of a transcript is exactly the part
            // somebody is reading for.
            await drain();
            send({ event: "done", data: { status: run.status, exitCode: run.exitCode } });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, SSE_POLL_MS));
        }
      } finally {
        clearInterval(heartbeat);
        if (!closed) reply.raw.end();
      }
    },
  );
}
