import { describe, expect, it, vi } from "vitest";
import { resolveJevRouterMode, runJevToolRouter } from "./agent-chat";

describe("Jev tool router", () => {
  it("defaults managed installs active and self-hosted installs off", () => {
    expect(resolveJevRouterMode(undefined, "managed")).toBe("active");
    expect(resolveJevRouterMode(undefined, "self_hosted")).toBe("off");
    expect(resolveJevRouterMode("shadow", "managed")).toBe("shadow");
  });

  it("selects independently relevant tool families", async () => {
    const run = vi.fn(async () => ({ model: "jev-1.13.0", answers: {
      reminders: { type: "noul", noul: 0.98 }, calendar: { type: "noul", noul: 0.91 },
      conversation: { type: "noul", noul: 0.08 },
    } }));
    const decision = await runJevToolRouter({
      route: {
        providerId: "workers-ai", model: "@cf/test", backupModel: null, apiKey: null,
        ai: { run }, configured: true, jevRouterMode: "active",
        aiGateway: { accountId: "account", gatewayId: "test-gateway", apiToken: null, routeWorkersAi: true, routeExternalProviders: true },
      },
      message: "Show my reminders and calendar",
    });
    expect(decision?.selectedFamilies).toEqual(["calendar", "reminders"]);
    expect(run).toHaveBeenCalledWith("typesafe/jev", expect.any(Object), expect.objectContaining({ gateway: expect.objectContaining({ id: "test-gateway" }) }));
  });

  it("fails open when Jev is unavailable", async () => {
    const decision = await runJevToolRouter({
      route: {
        providerId: "workers-ai", model: "@cf/test", backupModel: null, apiKey: null,
        ai: { run: async () => { throw new Error("unavailable"); } }, configured: true, jevRouterMode: "active", aiGateway: null,
      },
      message: "Show my tasks",
    });
    expect(decision).toBeNull();
  });
});
