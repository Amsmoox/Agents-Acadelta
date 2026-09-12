// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllOrganizations } from "./queries.js";

function page(ids: string[], nextCursor: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: ids.map((id) => ({ id, slug: id, name: id, mission: null, status: "active" })),
      nextCursor,
    }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAllOrganizations", () => {
  it("follows the cursor to the end instead of stopping at the first page", async () => {
    // The list used to request one page and discard nextCursor, which silently
    // capped both the list and the filter counts drawn from it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(["a", "b"], "cursor-1"))
      .mockResolvedValueOnce(page(["c", "d"], "cursor-2"))
      .mockResolvedValueOnce(page(["e"], null));
    vi.stubGlobal("fetch", fetchMock);

    const all = await fetchAllOrganizations();

    expect(all.map((o) => o.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("passes the cursor and the status filter on every follow-up request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(["a"], "cursor-1"))
      .mockResolvedValueOnce(page(["b"], null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAllOrganizations("archived");

    const second = String(fetchMock.mock.calls[1]?.[0]);
    expect(second).toContain("status=archived");
    expect(second).toContain("cursor=cursor-1");
  });

  it("stops rather than looping forever if the server always returns a cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["x"], "always"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAllOrganizations();

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });
});
