import { describe, expect, it } from "vitest";
import type { TikTokCreatorInfo } from "../stores/social";
import {
  emptyTikTokChoices,
  fitTikTokChoices,
  tiktokBlocker,
  tiktokChoicesProblem,
  tiktokDeclaration,
  tiktokDeliveryOptions,
  tiktokDisclosureLabel,
  tiktokPrivacyDisabled,
} from "./tiktok-post";

const creator: TikTokCreatorInfo = {
  avatarUrl: null,
  username: "owner",
  nickname: "Owner",
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSeconds: 60,
};

describe("TikTok post choices", () => {
  it("starts with nothing chosen for the owner", () => {
    expect(emptyTikTokChoices()).toEqual({
      privacyLevel: "",
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      disclose: false,
      yourBrand: false,
      brandedContent: false,
    });
    expect(tiktokChoicesProblem(emptyTikTokChoices(), creator, 12)).toBe("Choose who can see it on TikTok.");
  });

  it("is ready once an audience is chosen and the video fits", () => {
    const choices = { ...emptyTikTokChoices(), privacyLevel: "PUBLIC_TO_EVERYONE" as const };
    expect(tiktokChoicesProblem(choices, creator, 12)).toBeNull();
    expect(tiktokChoicesProblem(choices, creator, 61)).toBe("This TikTok account takes videos up to 60 seconds.");
    expect(tiktokChoicesProblem(choices, creator, null)).toMatch(/length/);
    expect(tiktokChoicesProblem(choices, null, 12)).toMatch(/loading/);
  });

  it("asks which kind of commercial content once disclosure is on", () => {
    const choices = { ...emptyTikTokChoices(), privacyLevel: "PUBLIC_TO_EVERYONE" as const, disclose: true };
    expect(tiktokChoicesProblem(choices, creator, 12)).toBe(
      "You need to indicate if your content promotes yourself, a third party, or both.",
    );
    expect(tiktokDisclosureLabel({ ...choices, yourBrand: true })).toBe("Your video will be labeled as 'Promotional content'");
    expect(tiktokDisclosureLabel({ ...choices, brandedContent: true })).toBe("Your video will be labeled as 'Paid partnership'");
    expect(tiktokDisclosureLabel({ ...choices, yourBrand: true, brandedContent: true })).toBe(
      "Your video will be labeled as 'Paid partnership'",
    );
    expect(tiktokDeclaration({ ...choices, yourBrand: true })).toEqual({ brandedPolicy: false });
    expect(tiktokDeclaration({ ...choices, brandedContent: true })).toEqual({ brandedPolicy: true });
  });

  it("keeps branded content off Only me", () => {
    const branded = { ...emptyTikTokChoices(), disclose: true, brandedContent: true };
    expect(tiktokPrivacyDisabled("SELF_ONLY", branded)).toBe("Branded content visibility cannot be set to private.");
    expect(tiktokPrivacyDisabled("PUBLIC_TO_EVERYONE", branded)).toBeNull();
    expect(fitTikTokChoices({ ...branded, privacyLevel: "SELF_ONLY" }, creator).privacyLevel).toBe("");
  });

  it("drops choices the creator has turned off", () => {
    const fitted = fitTikTokChoices(
      { ...emptyTikTokChoices(), privacyLevel: "MUTUAL_FOLLOW_FRIENDS", allowDuet: true, allowComment: true },
      creator,
    );
    expect(fitted).toMatchObject({ privacyLevel: "", allowDuet: false, allowComment: true });
    expect(fitTikTokChoices({ ...emptyTikTokChoices(), yourBrand: true }, creator).yourBrand).toBe(false);
  });

  it("sends Direct Post options with consent only when the owner posts", () => {
    expect(tiktokDeliveryOptions(
      { ...emptyTikTokChoices(), privacyLevel: "FOLLOWER_OF_CREATOR", allowComment: true, disclose: true, yourBrand: true },
      12.4,
    )).toEqual({
      deliveryMode: "direct_publish",
      privacyLevel: "FOLLOWER_OF_CREATOR",
      allowComment: true,
      allowDuet: false,
      allowStitch: false,
      brandOrganic: true,
      brandContent: false,
      isAiGenerated: false,
      consent: true,
      videoDurationSeconds: 13,
    });
  });
});

describe("tiktokBlocker", () => {
  it("lets TikTok post once the settings report no problem", () => {
    expect(tiktokBlocker({ problem: null })).toBeNull();
    expect(tiktokBlocker({ problem: "Choose who can see it on TikTok." })).toBe("Choose who can see it on TikTok.");
    expect(tiktokBlocker(undefined)).toBe("Choose TikTok's settings.");
  });
});
