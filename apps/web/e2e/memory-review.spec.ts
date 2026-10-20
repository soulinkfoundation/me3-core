import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";

// UI test: every application API is simulated with synthetic owner memories.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };

async function fixture(page: Page) {
  const calls: string[] = [];
  const memories = [
    { id: "m-rule", body: "Keep replies short.", memoryKind: "owner_note", sourceKind: "manual", reviewStatus: "active", updatedAt: "2026-10-20T09:00:00Z" },
    { id: "m-fact", body: "Owner's daughter is Mia.", displayBody: "Your daughter is Mia.", memoryKind: "relationship_note", sourceKind: "agent", reviewStatus: "active", updatedAt: "2026-10-20T09:00:00Z" },
    { id: "m-wait", body: "Owner has a back injury.", displayBody: "You have a back injury.", memoryKind: "owner_note", sourceKind: "agent", reviewStatus: "needs_review", updatedAt: "2026-10-20T09:00:00Z" },
  ];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path.startsWith("/mission-control/memory/")) {
      calls.push(`${request.method()} ${path}`);
      const id = decodeURIComponent(path.split("/")[3]);
      const memory = memories.find(item => item.id === id);
      const body = request.method() === "DELETE" ? { ok: true } : { memory: { ...memory, reviewStatus: "active" } };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    const data = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
      : path === "/assistant/threads/primary" ? { thread }
      : path === "/assistant/threads" ? { threads: [thread] }
      : path === "/assistant/threads/main/messages" ? { thread, hasMore: false, messages: [
        { id: "q1", role: "user", text: "My back is sore again, keep my calendar light this week.", createdAt: "2026-10-20T09:00:00Z" },
        { id: "a1", role: "assistant", text: "I'll keep things light.", createdAt: "2026-10-20T09:00:05Z", memoryReview: { id: "m-wait", body: "Owner has a back injury.", displayBody: "You have a back injury.", status: "pending" } },
        { id: "a2", role: "assistant", text: "Noted.", createdAt: "2026-10-20T09:01:05Z", memoryReview: { id: "m-old", body: "Owner is in debt.", displayBody: "You are in debt.", status: "declined" } },
      ] }
      : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
      : path === "/mission-control/memory" ? { memory: memories }
      : path === "/ai-settings" ? { deploymentMode: "managed", providers: [] }
      : path === "/mission-control/approvals" ? { approvals: [] }
      : path === "/plugins" ? { plugins: [] }
      : path === "/navigation-features" ? { features: [] }
      : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  return calls;
}

test("a held-back memory is offered under its reply and the owner's answer sticks", async ({ page }, testInfo) => {
  const calls = await fixture(page);
  await page.goto("/assistant?view=chat");
  const pending = page.getByRole("group", { name: "Remember this?" }).filter({ hasText: "You have a back injury." });
  await expect(pending).toBeVisible();
  await expect(pending).not.toContainText("Owner");
  await expect(page.getByRole("group", { name: "Remember this?" }).filter({ hasText: "You are in debt." })).toContainText("Won't remember this");
  await page.screenshot({ path: testInfo.outputPath("memory-review-chat.png") });
  await pending.getByRole("button", { name: "Remember" }).click();
  await expect(pending).toContainText("Remembered");
  await expect(pending.getByRole("button")).toHaveCount(0);
  expect(calls).toEqual(["POST /mission-control/memory/m-wait/approve"]);
});

test("the agent page separates rules, remembered facts and memories waiting for an OK", async ({ page }, testInfo) => {
  const calls = await fixture(page);
  await page.goto("/agent");
  const rules = page.locator("section", { has: page.getByRole("heading", { name: "How ME3 works with you" }) });
  const facts = page.locator("section", { has: page.getByRole("heading", { name: "What ME3 remembers" }) });
  const waiting = page.locator("section", { has: page.getByRole("heading", { name: "Waiting for your OK" }) });
  await expect(rules).toContainText("Keep replies short.");
  await expect(facts).toContainText("Your daughter is Mia.");
  await expect(facts).not.toContainText("Owner");
  await expect(waiting).toContainText("You have a back injury.");
  await page.screenshot({ path: testInfo.outputPath("memory-review-agent.png"), fullPage: true });
  await waiting.getByRole("button", { name: "Don't" }).click();
  await expect(waiting).toHaveCount(0);
  expect(calls).toEqual(["DELETE /mission-control/memory/m-wait"]);
});
