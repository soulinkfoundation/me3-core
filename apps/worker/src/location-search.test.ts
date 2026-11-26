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

it("falls back to Open-Meteo for towns when Photon keeps refusing, and says who is asking", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
    .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
    .mockResolvedValueOnce(Response.json({ results: [{ id: 2964180, name: "Galway", latitude: 53.27, longitude: -9.05, country: "Ireland", country_code: "IE", admin1: "Connacht", feature_code: "PPLA" }] }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await searchLocationQuery({}, `Galway ${Date.now()}`);

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(String(fetchMock.mock.calls[2][0])).toContain("geocoding-api.open-meteo.com");
  expect(fetchMock.mock.calls[0][1].headers["User-Agent"]).toMatch(/ME3/);
  expect(result).toMatchObject({ ok: true, locations: [{ label: "Galway, Connacht, Ireland", locality: "Galway", countryCode: "IE", precision: "locality" }] });
});

it("reports the lookup unavailable only when both lookups fail", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
  const result = await searchLocationQuery({}, `Nowhere ${Date.now()}`);
  expect(result).toMatchObject({ ok: false, status: 502 });
});
