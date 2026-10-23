import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateManagedAiUsage,
  estimateManagedKimiK3Usage,
} from "../../../packages/agent-chat/src";
import { syncManagedAiUsage } from "./managed-ai-billing";
import type { Env } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("managed Everyday AI billing", () => {
  it("prices Kimi K3 input, cached input, output, and the Unified Billing fee", () => {
    const uncached = estimateManagedKimiK3Usage({
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 100_000,
    });
    expect(uncached.costUsd).toBeCloseTo(4.725, 8);
    expect(uncached.pricing).toBe("cloudflare-unified-kimi-k3-2026-07");

    expect(
      estimateManagedKimiK3Usage({
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 100_000,
      }).costUsd,
    ).toBeCloseTo(3.3075, 8);
  });

  it("never counts more cached tokens than total input tokens", () => {
    expect(
      estimateManagedKimiK3Usage({
        inputTokens: 100,
        cachedInputTokens: 200,
        outputTokens: 0,
      }).costUsd,
    ).toBeCloseTo(0.0000315, 10);
  });

  it("uses the curated provider pricing for alternate managed models", () => {
    const mini = estimateManagedAiUsage("openai/gpt-5.4-mini", {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 100_000,
    });
    expect(mini.costUsd).toBeCloseTo(1.26, 8);
    expect(mini).toMatchObject({
      pricing: "cloudflare-unified-gpt-5-4-mini-2026-07",
    });
    const nano = estimateManagedAiUsage("openai/gpt-5.4-nano", {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 100_000,
    });
    expect(nano.costUsd).toBeCloseTo(0.34125, 8);
    expect(nano).toMatchObject({
      pricing: "cloudflare-unified-gpt-5-4-nano-2026-07",
    });
    const claude = estimateManagedAiUsage("anthropic/claude-sonnet-4.6", {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 100_000,
      });
    expect(claude.costUsd).toBeCloseTo(4.725, 8);
    expect(claude).toMatchObject({
      pricing: "cloudflare-unified-claude-sonnet-4-6-2026-07",
    });
    const openai = estimateManagedAiUsage("openai/gpt-5.5", {
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 100_000,
      });
    expect(openai.costUsd).toBeCloseTo(8.4, 8);
    expect(openai).toMatchObject({
      pricing: "cloudflare-unified-gpt-5-5-2026-07",
    });
  });

  it("prices the managed Workers AI fallback without a Unified Billing fee", () => {
    const fallback = estimateManagedAiUsage("@cf/zai-org/glm-4.7-flash", {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 100_000,
    });

    expect(fallback).toMatchObject({
      costUsd: 0.1,
      pricing: "workers-ai-glm-4-7-flash-2026-07",
      billingFeeRate: 0,
    });
  });

  it("syncs managed fallback-model and image-generation usage", async () => {
    const rows = [
      {
        id: "fallback-usage",
        provider: "workers-ai",
        model: "@cf/zai-org/glm-4.7-flash",
        kind: "text",
        tokens_in: 100,
        tokens_out: 20,
        estimated_cost_usd: 0.000014,
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      },
      {
        id: "legacy-image-usage",
        provider: "workers-ai",
        model: "@cf/black-forest-labs/flux-2-klein-4b",
        kind: "image",
        tokens_in: 0,
        tokens_out: 0,
        estimated_cost_usd: 0.001148,
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      },
      {
        id: "gpt-image-usage",
        provider: "openai",
        model: "gpt-image-2",
        kind: "image",
        tokens_in: 7,
        tokens_out: 1_800,
        estimated_cost_usd: 0.054035,
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      },
    ];
    let requestBody: { events?: Array<{ id: string; kind: string; model: string }> } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body || "{}"));
        return Response.json({
          acceptedEventIds: rows.map((row) => row.id),
          settings: {
            available: true,
            managed: true,
            currency: "usd",
            billingSource: "internal",
            defaultModel: "openai/gpt-5.4-mini",
            models: [],
            eligible: false,
            ineligibleReason: null,
            overagesEnabled: false,
            includedMonthlyCents: 500,
            monthlyMaximumCents: 500,
            minimumMonthlyMaximumCents: 600,
            maximumMonthlyMaximumCents: 50_000,
            currentMonth: new Date().toISOString().slice(0, 7),
            currentMonthUsageMicrousd: 1_162,
            currentMonthBillableMicrousd: 0,
            effectiveMaximumCents: 500,
            fallbackActive: false,
          },
        });
      }),
    );
    const env = {
      ME3_DEPLOYMENT_MODE: "managed",
      ME3_COMMERCE_BRIDGE_ORIGIN: "https://api.me3.app",
      ME3_COMMERCE_BRIDGE_TOKEN: "bridge-token",
      DB: {
        prepare(sql: string) {
          return {
            bind(..._values: unknown[]) {
              return {
                async all<T>() {
                  return sql.includes("FROM ai_usage_events")
                    ? { results: rows as T[] }
                    : { results: [] as T[] };
                },
                async run() {
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(syncManagedAiUsage(env)).resolves.toMatchObject({ managed: true });
    expect(requestBody.events).toEqual([
      expect.objectContaining({
        id: "fallback-usage",
        kind: "text",
        model: "zai-org/glm-4.7-flash",
      }),
      expect.objectContaining({
        id: "legacy-image-usage",
        kind: "image",
        model: "black-forest-labs/flux-2-klein-4b",
      }),
      expect.objectContaining({
        id: "gpt-image-usage",
        kind: "image",
        model: "gpt-image-2",
        inputTokens: 7,
        outputTokens: 1_800,
      }),
    ]);
  });
});

describe("managed allowance notice", () => {
  it("tells a trial owner the lighter model lasts for the rest of the trial", async () => {
    const { managedAllowanceNotice } = await import("./managed-ai-billing");
    const notice = managedAllowanceNotice({ allowancePeriod: "trial", billingSource: "trial", eligible: false, overagesEnabled: false } as any, new Date("2026-10-23T12:00:00Z"));
    expect(notice).toMatchObject({
      title: "Your trial's AI allowance is used",
      message: "Replies now use a lighter model for the rest of your trial.",
      action: { kind: "subscribe" },
    });
  });
});
