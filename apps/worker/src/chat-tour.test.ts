import { describe, expect, it } from "vitest";
import { chatTour, type TourContext } from "./chat-tour";

// Failure modes (me3-q6la.5):
// - a step points at something the install doesn't have (an address that isn't set up, a paper that isn't on);
// - an owner whose site is built is offered Make my website again;
// - the email step drifts from the agreed framing (ME3's own address; never reads your inbox);
// - Try it does nothing, so the tour only talks.
const base: TourContext = { site: { url: "maya.me3.app", built: false }, emailAddress: "maya@inbox.me3.app", news: { setUp: false, time: "07:30" } };
const step = (context: Partial<TourContext>, id: string) => chatTour({ ...base, ...context }).steps.find(item => item.id === id);

describe("chatTour", () => {
  it("walks website, email, paper and Home, and every step has something to try", () => {
    const tour = chatTour(base);
    expect(tour.steps.map(item => item.id)).toEqual(["website", "email", "news", "home"]);
    for (const item of tour.steps) expect(item.tryIt).not.toBeNull();
  });

  it("offers Make my website only while the site isn't built", () => {
    expect(step({}, "website")?.tryIt).toEqual({ kind: "site_ask", label: "Make my website" });
    const built = step({ site: { url: "maya.me3.app", built: true } }, "website");
    expect(built?.tryIt).toEqual({ kind: "open", label: "Open the editor", to: "website" });
    expect(built?.body).toContain("maya.me3.app");
  });

  it("frames email as ME3's own address and copies the real one", () => {
    const email = step({}, "email");
    expect(email?.body).toContain("maya@inbox.me3.app is my own address");
    expect(email?.body).toContain("I never read your inbox");
    expect(email?.tryIt).toEqual({ kind: "copy", label: "Copy my address", value: "maya@inbox.me3.app" });
    expect(step({ emailAddress: null }, "email")?.tryIt).toEqual({ kind: "open", label: "Set up my email", to: "email_settings" });
  });

  it("sets up the paper until it's on, then opens it; leaves it out when news isn't available", () => {
    expect(step({}, "news")?.tryIt).toMatchObject({ kind: "prompt" });
    expect(step({ news: { setUp: true, time: "07:30" } }, "news")?.tryIt).toEqual({ kind: "open", label: "Read today's paper", to: "news" });
    expect(step({ news: { setUp: true, time: "07:30" } }, "news")?.body).toContain("07:30");
    expect(chatTour({ ...base, news: null }).steps.map(item => item.id)).toEqual(["website", "email", "home"]);
  });
});
