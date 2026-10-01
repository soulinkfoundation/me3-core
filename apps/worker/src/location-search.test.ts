import { afterEach, expect, it, vi } from "vitest";
import { searchLocationQuery } from "./location-search";

afterEach(() => vi.unstubAllGlobals());

it("retries a transient Photon failure before reporting location lookup unavailable", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ features: [] }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await searchLocationQuery({}, `retry-location-${Date.now()}`);

  expect(result.ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
