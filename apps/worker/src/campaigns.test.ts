import { describe, expect, it, vi } from "vitest";
import {
  deleteCampaign,
  normalizeCampaignAudienceFilter,
  parseCampaignAudienceFilter,
  type CampaignStatus,
} from "./campaigns";
import type { Env } from "./types";

function campaignEnv(input: {
  status?: CampaignStatus;
  activeJobs?: number;
  found?: boolean;
} = {}) {
  const deleteObject = vi.fn().mockResolvedValue(undefined);
  const deletedCampaigns: string[] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: async () => {
        if (sql.includes("FROM email_campaigns campaign")) {
          return input.found === false
            ? null
            : {
                id: "campaign-1",
                status: input.status || "draft",
                site_username: "kieran",
              };
        }
        if (sql.includes("COUNT(*) AS count")) {
          return { count: input.activeJobs || 0 };
        }
        throw new Error(`Unexpected first query: ${sql}`);
      },
      all: async () => {
        if (sql.includes("FROM email_campaign_assets")) {
          return {
            results: [{ storage_path: "campaigns/campaign-1/image.png" }],
          };
        }
        throw new Error(`Unexpected all query: ${sql}`);
      },
      run: async () => {
        if (sql.startsWith("DELETE FROM email_campaigns")) {
          deletedCampaigns.push(String(bindings[0]));
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected run query: ${sql}`);
      },
    }),
  }));
  const env = {
    DB: { prepare },
    SITE_ASSETS: { delete: deleteObject },
  } as unknown as Env;
  return { env, deleteObject, deletedCampaigns };
}

describe("campaign deletion", () => {
  it("keeps customer audience filters narrow and defaults malformed stored data safely", () => {
    expect(normalizeCampaignAudienceFilter({ kind: "customers", itemRef: "product:course" }))
      .toEqual({ kind: "customers", itemRef: "product:course" });
    expect(parseCampaignAudienceFilter("not-json")).toEqual({ kind: "all" });
    expect(() => normalizeCampaignAudienceFilter({ kind: "customers", itemRef: "other:course" }))
      .toThrow(/valid product or service/);
  });

  it("deletes an owner draft and its stored assets", async () => {
    const fixture = campaignEnv();

    await expect(deleteCampaign(fixture.env, "owner-1", "campaign-1")).resolves.toEqual({
      campaignId: "campaign-1",
    });
    expect(fixture.deletedCampaigns).toEqual(["campaign-1"]);
    expect(fixture.deleteObject).toHaveBeenCalledWith(
      "sites/kieran/campaigns/campaign-1/image.png",
    );
  });

  it("retains sent history and campaigns with active delivery jobs", async () => {
    await expect(
      deleteCampaign(campaignEnv({ status: "sent" }).env, "owner-1", "campaign-1"),
    ).rejects.toMatchObject({
      code: "campaign_not_deletable",
      status: 409,
    });
    await expect(
      deleteCampaign(
        campaignEnv({ status: "failed", activeJobs: 1 }).env,
        "owner-1",
        "campaign-1",
      ),
    ).rejects.toMatchObject({
      code: "campaign_delivery_active",
      status: 409,
    });
  });
});
