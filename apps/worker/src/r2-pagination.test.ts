import { describe, expect, it, vi } from "vitest";
import { getR2StorageStats, pruneUnreferencedContentAssets } from "./sites";
import type { DbSite, Env } from "./types";

const site = { id: "site-test", username: "owner" } as DbSite;

function storageEnv(list: ReturnType<typeof vi.fn>) {
  const remove = vi.fn();
  return {
    env: {
      SITE_ASSETS: { list, delete: remove },
      DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
    } as unknown as Env,
    remove,
  };
}

describe("R2 pagination safety", () => {
  it("counts all progressing pages, including empty intermediate pages", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ objects: [{ key: "sites/owner/public/one", size: 12 }], truncated: true, cursor: "a" })
      .mockResolvedValueOnce({ objects: [], truncated: true, cursor: "b" })
      .mockResolvedValueOnce({ objects: [{ key: "sites/owner/public/two", size: 8 }], truncated: false });
    const { env } = storageEnv(list);
    await expect(getR2StorageStats(env, site)).resolves.toEqual({ files: 2, bytes: 20 });
    expect(list.mock.calls).toEqual([
      [{ prefix: "sites/owner/public/" }],
      [{ prefix: "sites/owner/public/", cursor: "a" }],
      [{ prefix: "sites/owner/public/", cursor: "b" }],
    ]);
  });

  for (const [name, sequence] of [
    ["missing cursor", [undefined]],
    ["repeated cursor", ["a", "a"]],
    ["cursor cycle", ["a", "b", "a"]],
  ] as const) {
    for (const operation of ["stats", "prune"] as const) {
      it(`stops ${operation} on a ${name}`, async () => {
        let calls = 0;
        const list = vi.fn(async () => {
          if (calls >= sequence.length) throw new Error("Test stopped an unbounded scan");
          return { objects: [], truncated: true, cursor: sequence[calls++] };
        });
        const { env } = storageEnv(list);
        const result = operation === "stats"
          ? getR2StorageStats(env, site)
          : pruneUnreferencedContentAssets(env, site, new Map(), { version: 1, sourceFiles: {}, assetFiles: {}, updatedAt: "" });
        await expect(result).rejects.toThrow("R2 object listing did not advance");
        expect(list).toHaveBeenCalledTimes(sequence.length);
      });
    }
  }
});
