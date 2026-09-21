import { describe, expect, it, vi } from "vitest";
import { listNavigationFeatures, updateNavigationFeature } from "./navigation-features";

function navigationFeatureEnv(rows: Array<{ feature_id: string; visible: number }> = []) {
  const statement = {
    bind: vi.fn(function (this: typeof statement) { return this; }),
    all: vi.fn(async () => ({ results: rows })),
    run: vi.fn(async () => ({})),
  };
  const env = { DB: { prepare: vi.fn(() => statement) } };
  return { env: env as never, statement };
}

describe("navigation features", () => {
  it("keeps Calendar visible by default for existing installations", async () => {
    const { env } = navigationFeatureEnv();

    const features = await listNavigationFeatures(env, "owner-1");

    expect(features.find((feature) => feature.id === "calendar")?.visible).toBe(true);
  });

  it("allows Calendar visibility to be disabled", async () => {
    const { env, statement } = navigationFeatureEnv();

    const feature = await updateNavigationFeature(env, "owner-1", "calendar", false);

    expect(feature).toMatchObject({ id: "calendar", visible: false });
    expect(statement.bind).toHaveBeenCalledWith("owner-1", "calendar", 0);
    expect(statement.run).toHaveBeenCalledOnce();
  });
});
