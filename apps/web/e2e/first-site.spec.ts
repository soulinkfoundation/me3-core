import { test, expect } from "./fixtures/test";
import type { Page, Route } from "@playwright/test";

// UI tests for a new owner's first site on web (me3-iyql, me3-5u97.2.4), matching iOS/Android.
// Every application API is simulated, including the assistant's turns: no model, Cloud or Soulink runs.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
const draftCard = {
  kind: "site_draft", title: "Publish your website", summary: "Maya Okafor at maya.me3.app",
  username: "maya", name: "Maya Okafor", publicUrl: "https://maya.me3.app", previewPath: "/preview/maya/", theme: "warm",
  themes: [{ id: "warm", name: "Warm" }, { id: "meadow", name: "Meadow" }, { id: "paper", name: "Paper" }],
  services: [{ title: "Free 30-minute clarity call", bookable: true }], newsletter: true,
  searchQuery: "sports massage Bristol", hasPhoto: false,
  howItWorks: "Nothing is live until you publish.",
};
const plan = {
  with: "Kieran (stand-in)", handle: "kieran", publicUrl: "http://localhost:8788", bookingUrl: "http://localhost:8788/book",
  offering: { id: "intro-call", offerId: "intro-call", title: "Free 20-minute call", durationMinutes: 20 },
  slot: { start: "2026-11-02T10:00:00Z", end: "2026-11-02T10:20:00Z", timezone: "UTC", label: "Mon 2 Nov, 10:00" }, notes: null,
};
const people = {
  results: [
    { profileId: "p-me", name: "Maya Okafor", bio: "**Sports massage** in [Bristol](https://x.example)", self: true, publicUrl: "https://maya.me3.app", location: { label: "Bristol, UK" }, offerings: [{ id: "clarity-call", title: "Free 30-minute clarity call", durationMinutes: 30 }] },
    { profileId: "p-k", name: "Kieran (stand-in)", bio: "Builds ME3.", publicUrl: "http://localhost:8788", offerings: [{ id: "intro-call", title: "Free 20-minute call", durationMinutes: 20 }] },
  ],
};

type Approval = { id: string; actionId: string; status: string; threadId: string; requestedAt: string; resolvedAt: string | null; payload: Record<string, unknown> };
type State = { bio: string; dismissed: boolean; approvals: Approval[]; sent: string[]; decisions: Array<{ id: string; decision: string }>; themes: string[]; patches: unknown[]; messages: Array<{ id: string; role: string; text: string; createdAt: string }> };

const sse = (events: Array<[string, unknown]>) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

async function fixture(page: Page, overrides: Partial<State> = {}) {
  const state: State = { bio: "", dismissed: true, approvals: [], sent: [], decisions: [], themes: [], patches: [], messages: [], ...overrides };
  const at = () => new Date(Date.now() + state.messages.length).toISOString();
  const say = (role: string, text: string) => state.messages.push({ id: `m${state.messages.length + 1}`, role, text, createdAt: at() });
  const view = (approval: Approval) => ({ ...approval.payload, ...approval, pluginId: "me3.core", title: approval.payload.title, summary: approval.payload.summary, payload: approval.payload, turnId: "t" });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace(/^\/api/, ""); const method = route.request().method();
    if (path === "/assistant/chat/turn/stream") {
      const text = route.request().postDataJSON().messageText as string;
      state.sent.push(text); say("user", text);
      let events: Array<[string, unknown]> = [];
      if (text.startsWith("Build my website.")) {
        state.approvals.push({ id: "draft-1", actionId: "core_sites_starter_draft", status: "pending", threadId: "main", requestedAt: at(), resolvedAt: null, payload: draftCard });
        say("assistant", "This action needs your approval before I can continue.");
      } else if (text.startsWith("Show me how an assistant finds me") || text.startsWith("Find ")) {
        events.push(["tool", { state: "complete", toolName: "core_people_search", result: { status: "ok", data: people } }]);
        say("assistant", "This is what an assistant sees.");
      } else if (text.startsWith("Book the Free 20-minute call")) {
        state.approvals.push({ id: "call-1", actionId: "core_scheduling_book_free_call", status: "pending", threadId: "main", requestedAt: at(), resolvedAt: null, payload: { kind: "free_call_booking", title: "Book a free call", summary: "Free 20-minute call", plan, howItWorks: "Books the time on Kieran's site with your name and email." } });
        say("assistant", "This action needs your approval before I can continue.");
      }
      const reply = state.messages[state.messages.length - 1].text;
      events = [["thread", { threadId: "main" }], ...events, ["delta", { text: reply }], ["done", { threadId: "main", replyText: reply }]];
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });
    }
    const decided = path.match(/^\/assistant\/approvals\/([^/]+)$/);
    if (decided && method === "POST") {
      const body = route.request().postDataJSON(); state.decisions.push({ id: decided[1], decision: body.decision });
      const approval = state.approvals.find(item => item.id === decided[1])!;
      approval.status = body.decision === "approved" ? "approved" : "declined"; approval.resolvedAt = at();
      if (approval.id === "draft-1" && body.decision === "approved") { state.bio = "Sports massage in Bristol."; say("assistant", "Your site is live."); }
      if (approval.id === "call-1" && body.decision === "approved") say("assistant", "Booked.");
      return json(route, { ok: true });
    }
    if (path === "/sites/maya/draft-preview-html") return route.fulfill({ status: 200, contentType: "text/html", body: `<h1>Maya Okafor</h1><p>Look: ${url.searchParams.get("theme")}</p>` });
    if (path === "/sites/maya/draft-theme" && method === "PUT") { state.themes.push(route.request().postDataJSON().theme); return json(route, { ok: true }); }
    if (path === "/mission-control/dashboard" && method === "PATCH") {
      const body = route.request().postDataJSON(); state.patches.push(body); state.dismissed = body.settings.setupChecklistDismissed; return json(route, {});
    }
    const pending = state.approvals.filter(item => item.status === "pending").map(view);
    const data: unknown = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "maya", name: "Maya Okafor", timezone: "UTC" }, workspace: { hasProfileSite: true } }
      : path === "/assistant/approvals" ? { approvals: url.searchParams.get("status") === "pending" ? pending : state.approvals.map(view) }
      : path === "/mission-control/approvals" ? { approvals: pending }
      : path === "/assistant/threads/primary" ? { thread }
      : path === "/assistant/threads" ? { threads: [thread] }
      : path === "/assistant/threads/main/messages" ? { thread, messages: state.messages }
      : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
      : path === "/ai-settings" ? { deploymentMode: "managed", providers: [] }
      : path === "/config" ? { deploymentMode: "managed", ownerAuthConfigured: true, ownerPasswordAuthConfigured: true, setupRequired: [] }
      : path === "/sites" ? { sites: [{ username: "maya", site_role: "profile", site_type: "profile" }] }
      : path === "/sites/maya/content" ? { ok: true, profile: { name: "Maya Okafor", bio: state.bio }, pages: [], posts: [] }
      : path === "/mission-control/dashboard" ? { settings: { goals: [], setupChecklistDismissed: state.dismissed } }
      : path === "/soulink/status" ? { connection: null }
      : path === "/calendar/feed" ? { events: [], bookings: [], reminders: [], tasks: [], sources: [] }
      : path === "/mailbox" ? { mailbox: { aliasAddress: "maya@inbox.me3.app" } } : path === "/mailbox/messages" ? { messages: [] }
      : path === "/mission-control/tasks" ? { tasks: [] } : path === "/journal/archive" ? { entries: [] }
      : path === "/mission-control/wheel" ? { snapshots: [], settings: { segments: [] } }
      : path === "/mission-control/projects" ? { projects: [] } : path === "/payments" ? { payments: [] }
      : path === "/plugins" ? { plugins: [] } : path === "/navigation-features" ? { features: [] } : {};
    return json(route, data);
  });
  return state;
}

test("first landing goes from the Build your website card to a published site and a booked call", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.goto("/assistant");

  // First landing: Chat opens on the ask card, and Home's Get set up is switched on.
  const ask = page.getByTestId("site-build-ask");
  await expect(ask).toBeVisible();
  await expect.poll(() => state.patches).toEqual([{ settings: { setupChecklistDismissed: false } }]);
  await ask.getByLabel("About your work").fill("Sports massage and yoga for runners in Bristol.");
  await ask.getByLabel("Your website or social links (optional)").fill("maya.example");
  await ask.getByRole("button", { name: "Draft my site" }).click();
  await expect.poll(() => state.sent[0]).toBe("Build my website. About my work: Sports massage and yoga for runners in Bristol.\nMy website or social links: maya.example");

  // The draft card, not raw approval fields: preview, looks, Edit and Publish.
  const draft = page.getByTestId("site-draft-card");
  await expect(draft).toContainText("Maya Okafor · maya.me3.app");
  await expect(draft.frameLocator("iframe").locator("p")).toHaveText("Look: warm");
  await draft.getByRole("radio", { name: "Meadow" }).click();
  await expect(draft.frameLocator("iframe").locator("p")).toHaveText("Look: meadow");
  await expect.poll(() => state.themes).toEqual(["meadow"]);
  await expect(draft.getByRole("button", { name: "Add photo" })).toBeVisible();
  await expect(page.locator(".assistant-timeline")).not.toContainText("Preview Path");
  await page.screenshot({ path: testInfo.outputPath("site-draft.png"), fullPage: true });
  await draft.getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => state.decisions).toEqual([{ id: "draft-1", decision: "approved" }]);

  // Live, then See what they see: the owner's own listing and someone else to book.
  const live = page.getByTestId("site-live-card");
  await expect(live.getByRole("link", { name: "maya.me3.app" })).toHaveAttribute("href", "https://maya.me3.app");
  await live.getByRole("button", { name: "See what they see" }).click();
  await expect.poll(() => state.sent[1]).toBe(`Show me how an assistant finds me: search the ME3 network for "sports massage Bristol", include my own listing, and show me what they'd see.`);
  await expect(live).toHaveCount(0);
  const rows = page.getByTestId("people-results");
  await expect(rows.getByRole("listitem")).toHaveCount(2);
  await expect(rows.getByRole("listitem").first()).toContainText("Maya Okafor · You");
  await expect(rows).not.toContainText("**");
  await rows.getByRole("listitem").nth(1).getByRole("button", { name: "Book" }).click();
  await expect.poll(() => state.sent[2]).toBe("Book the Free 20-minute call with Kieran (stand-in) for me.");

  const call = page.getByTestId("free-call-card");
  await expect(call).toContainText("Free 20-minute call with Kieran (stand-in)");
  await expect(call).toContainText("Mon 2 Nov, 10:00 · 20 min");
  await call.getByRole("button", { name: "Book it" }).click();
  await expect.poll(() => state.decisions[1]).toEqual({ id: "call-1", decision: "approved" });
  await expect(page.locator(".chat-first-site")).toContainText("Booked: Free 20-minute call with Kieran (stand-in), Mon 2 Nov, 10:00");
  await page.screenshot({ path: testInfo.outputPath("booked.png"), fullPage: true });

  // Home: the Website step ticks from the published bio.
  await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Home", exact: true }).click();
  const strip = page.getByTestId("get-set-up");
  await expect(strip.getByRole("button", { name: "Website" })).toHaveClass(/is-done/);
  await expect(strip.getByRole("button", { name: "Email ME3" })).not.toHaveClass(/is-done/);
});

test("Find someone asks who, then searches for that name", async ({ page }) => {
  const state = await fixture(page, { bio: "Sports massage.", approvals: [{ id: "draft-1", actionId: "core_sites_starter_draft", status: "approved", threadId: "main", requestedAt: new Date().toISOString(), resolvedAt: new Date(Date.now() + 60_000).toISOString(), payload: draftCard }] });
  await page.goto("/assistant?view=chat&thread=main");
  await page.getByTestId("site-live-card").getByRole("button", { name: "Find someone" }).click();
  await expect(page.locator(".assistant-timeline")).toContainText("Who would you like to find?");
  await page.locator("#assistant-console-input").fill("Kieran");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => state.sent).toEqual(["Find Kieran on ME3."]);
});

test("returning owners are not sent back to the first run, and Home's Review shows the draft card", async ({ page }) => {
  await fixture(page, { bio: "Sports massage.", approvals: [{ id: "draft-1", actionId: "core_sites_starter_draft", status: "pending", threadId: "main", requestedAt: new Date().toISOString(), resolvedAt: null, payload: draftCard }] });
  await page.goto("/assistant");
  await expect(page.getByTestId("site-build-ask")).toHaveCount(0);
  await expect(page.getByTestId("get-set-up")).toHaveCount(0);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("site-draft-card")).toBeVisible();
  await expect(dialog).not.toContainText("Preview Path");
});
