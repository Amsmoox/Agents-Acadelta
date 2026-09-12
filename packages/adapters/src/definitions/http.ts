// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AdapterDefinition } from "../types.js";

/** An agent that lives somewhere else and is reached over HTTP. */
export const httpAdapter: AdapterDefinition = {
  type: "http",
  label: "Webhook",
  summary: "Calls an endpoint you host. The agent runs on your side.",
  runtimeToolDelivery: "environment",
  configSchema: [
    {
      key: "webhookUrl",
      label: "Endpoint URL",
      type: "text",
      section: "connection",
      required: true,
      placeholder: "https://example.com/agent",
    },
    {
      key: "authToken",
      label: "Authorization token",
      type: "password",
      section: "connection",
      secretRef: true,
      help: "Sent as a bearer token.",
    },
    {
      key: "timeoutSec",
      label: "Timeout",
      type: "number",
      section: "advanced",
      default: 300,
      min: 1,
    },
  ],
};
