import { describe, expect, it, vi } from "vitest";

const notifySocialPostFailed = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("./push-notifications", () => ({ notifySocialPostFailed }));

import { socialPublishActivityHooks } from "./social-publishing";
import type { Env } from "./types";

describe("social failure push", () => {
  it("tells the owner's phone which post wasn't sent", async () => {
    const env = {
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ package_id: "post-1" }) }) }),
      },
    } as unknown as Env;
    await socialPublishActivityHooks(env).onFailed!({
      userId: "owner",
      publicationId: "publication-1",
      variantId: "version-1",
      platform: "x",
      platformLabel: "X",
      title: "Booking page is live",
      failureClass: "rejected",
    });
    expect(notifySocialPostFailed).toHaveBeenCalledWith(env, {
      publicationId: "publication-1",
      postId: "post-1",
      platform: "x",
      platformLabel: "X",
      failureClass: "rejected",
    });
  });
});
