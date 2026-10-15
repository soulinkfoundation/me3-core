import { describe, expect, it } from "vitest";
import { getAiGatewayUsageSummary } from "./ai-gateway";
import type { Env } from "./types";

function createEnvWithLocalUsage(
  rows: Array<Record<string, unknown>>,
  deploymentMode: "managed" | "self_hosted" = "self_hosted",
): Env {
  return {
    ME3_DEPLOYMENT_MODE: deploymentMode,
    DB: {
      prepare(sql: string) {
        const bound = {
          async first<T>() {
            if (sql.includes("FROM ai_gateway_settings")) return null;
            return null as T | null;
          },
          async all<T>() {
            if (sql.includes("FROM ai_usage_events")) {
              return { results: rows as T[] };
            }
            return { results: [] as T[] };
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
        return {
          bind(..._values: unknown[]) {
            return bound;
          },
          first: bound.first,
        };
      },
    },
  } as unknown as Env;
}

describe("getAiGatewayUsageSummary", () => {
  it("includes local image generation usage when AI Gateway is not configured", async () => {
    const summary = await getAiGatewayUsageSummary(
      createEnvWithLocalUsage([
        {
          id: "usage-image-1",
          provider: "workers-ai",
          model: "@cf/black-forest-labs/flux-2-klein-4b",
          kind: "image",
          request_count: 1,
          successful_request_count: 1,
          failed_request_count: 0,
          tokens_in: 0,
          tokens_out: 0,
          estimated_cost_usd: 0.001148,
          created_at: new Date().toISOString(),
        },
      ]),
      "owner",
    );

    expect(summary.setupRequired).toBe(false);
    expect(summary.displayMode).toBe("provider_details");
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalCost).toBeCloseTo(0.001148);
    expect(summary.models[0]).toMatchObject({
      provider: "workers-ai",
      model: "@cf/black-forest-labs/flux-2-klein-4b",
      requests: 1,
      totalTokens: 0,
    });
    expect(summary.recent[0]).toMatchObject({
      id: "usage-image-1",
      provider: "workers-ai",
      model: "@cf/black-forest-labs/flux-2-klein-4b",
      success: true,
    });
  });

  it("shows managed allowance percentage without AI Gateway setup", async () => {
    const summary = await getAiGatewayUsageSummary(
      createEnvWithLocalUsage(
        [
          {
            id: "usage-image-1",
            provider: "workers-ai",
            model: "@cf/black-forest-labs/flux-2-klein-4b",
            kind: "image",
            request_count: 1,
            successful_request_count: 1,
            failed_request_count: 0,
            tokens_in: 0,
            tokens_out: 0,
            estimated_cost_usd: 1,
            created_at: new Date().toISOString(),
          },
        ],
        "managed",
      ),
      "owner",
    );

    expect(summary).toMatchObject({
      configured: true,
      setupRequired: false,
      displayMode: "managed_allowance",
      allowanceUsedPercent: 10,
      totalRequests: 1,
    });
  });
});
