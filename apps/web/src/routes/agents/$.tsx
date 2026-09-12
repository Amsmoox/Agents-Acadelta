// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute } from "@tanstack/react-router";
import { LegacyAgentsRedirect } from "@/features/agents/legacy-redirect";

export const Route = createFileRoute("/agents/$")({
  component: LegacyAgentsRedirect,
});
