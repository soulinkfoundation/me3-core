import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerWheelOfLifeRoutes } from "./wheel-of-life";
import { registerGoalRoutes } from "./goals";
import { isCorePluginEnabled } from "../plugins";
import { getMissionWheel } from "../wheel-of-life";
import { getGoals } from "../goals";
import type { AppHono } from "../http/types";

vi.mock("../plugins", () => ({ isCorePluginEnabled: vi.fn() }));
vi.mock("../wheel-of-life", () => ({
  getMissionWheel: vi.fn(async (_env, ownerId) => ({ settings: { userId: ownerId }, snapshots: [] })),
  updateMissionWheelSettings: vi.fn(), createMissionWheelSnapshot: vi.fn(), listMissionWheelSnapshots: vi.fn(),
}));
vi.mock("../goals", () => ({ getGoals: vi.fn(async () => ({ goals: [] })), updateGoals: vi.fn() }));
function appFor(ownerId: string | null = "alice") {
  const app = new Hono() as AppHono;
  const deps = { requireOwner: async () => ownerId, unauthorized: (c: any) => c.json({error:"Unauthorized"}, 401) };
  registerWheelOfLifeRoutes(app, deps);
  registerGoalRoutes(app, deps);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCorePluginEnabled).mockImplementation(async (_env, id) => id === "me3.journal");
});
describe("reflection route ownership", () => {
  it("serves the same private wheel through Journal and the legacy native-client URL", async () => {
    const app = appFor();
    const current = await app.request('/api/journal/wheel');
    const legacy = await app.request('/api/mission-control/wheel');
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual(await legacy.json());
    expect(getMissionWheel).toHaveBeenCalledWith(undefined, 'alice');
    expect(isCorePluginEnabled).toHaveBeenCalledWith(undefined, 'me3.journal');
  });
  it("requires an owner on both wheel URLs and goals before touching private data", async () => {
    const app = appFor(null);
    for (const path of ['/api/journal/wheel','/api/mission-control/wheel','/api/tasks/goals']) {
      expect((await app.request(path)).status).toBe(401);
    }
    expect(getMissionWheel).not.toHaveBeenCalled();
    expect(getGoals).not.toHaveBeenCalled();
  });
  it("keeps goals gated by Tasks while Wheel works independently in Journal", async () => {
    const app = appFor();
    expect((await app.request('/api/tasks/goals')).status).toBe(403);
    expect((await app.request('/api/journal/wheel')).status).toBe(200);
    vi.mocked(isCorePluginEnabled).mockResolvedValue(false);
    expect((await app.request('/api/journal/wheel')).status).toBe(403);
    expect((await app.request('/api/mission-control/wheel')).status).toBe(403);
  });
});
