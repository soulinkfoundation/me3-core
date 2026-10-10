import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createD1TurnStore } from "../../../packages/agent/src/store";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import { registerMissionControlRoutes } from "./routes/mission-control";
import type { AppBindings } from "./http/types";
import type { Env } from "./types";

function fixture(enabled = false) {
  const f = mailboxFixture();
  f.raw.exec(`INSERT INTO plugin_installations(plugin_id,version,enabled,status)
    VALUES ('me3.mission-control','0.1.0',${enabled ? 1 : 0},'${enabled ? "installed" : "disabled"}');`);
  let resumes = 0;
  const env = { ...f.env, ME3_ASSISTANT_RUNTIME: "agent", ME3_AGENT: {
    idFromName: () => "alice", get: () => ({ fetch: async (_url: string, init: RequestInit) => {
      resumes++; expect(JSON.parse(String(init.body))).toEqual({ userId: "alice", turnId: "turn" });
      return Response.json({ ok: true, turnId: "turn" });
    } }),
  } } as unknown as Env;
  const app = new Hono<AppBindings>();
  registerMissionControlRoutes(app, { requireOwner: async () => "alice", unauthorized: c => c.json({ error: "Unauthorized" }, 401) });
  return { ...f, env, app, resumes: () => resumes };
}

async function approval(f: ReturnType<typeof fixture>, ownerId = "alice", key = "send-key") {
  const store = createD1TurnStore(f.env.DB, { ownerId, threadId: "thread", turnId: "turn", requestId: "request" });
  return store.requestApproval(key, { id: "call", name: "core_mailbox_send", arguments: { draftId: "draft" } },
    { title: "Send reviewed email", summary: "To client@example.test: Reviewed subject", recipient: "client@example.test", subject: "Reviewed subject", body: "Full reviewed body" });
}
const post = (f: ReturnType<typeof fixture>, id: string, body: unknown) => f.app.request(`/api/mission-control/approvals/${id}`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, f.env);

describe("Core agent approvals on existing client routes", () => {
  it("lists owner Core cards even with Tasks and Projects disabled", async () => {
    const f = fixture(); const id = await approval(f); await approval(f, "bob", "private-key");
    const response = await f.app.request("/api/mission-control/approvals?status=pending", {}, f.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ approvals: [{ id, pluginId: "me3.core", actionId: "core_mailbox_send",
      title: "Send reviewed email", riskLevel: "high", status: "pending", payload: { body: "Full reviewed body" } }] });
    const all = await f.app.request("/api/mission-control/approvals?status=approved", {}, f.env);
    expect(await all.json()).toEqual({ approvals: [] });
  });

  it("resumes Core decisions before the plugin guard and maps existing rejected decisions", async () => {
    const f = fixture(); const id = await approval(f);
    expect((await post(f, id, { confirmed: true })).status).toBe(400);
    const result = await post(f, id, { decision: "approved" });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ approval: { id, status: "approved" } });
    expect(f.resumes()).toBe(1);
    const second = await approval(f, "alice", "decline-key");
    expect((await post(f, second, { decision: "rejected" })).status).toBe(200);
    expect(f.raw.prepare("SELECT status FROM me3_agent_approvals WHERE id=?").get(second)?.status).toBe("declined");
    expect((await post(f, id, { decision: "rejected" })).status).toBe(409);
  });

  it("merges enabled plugin approvals and keeps their existing resolution behavior", async () => {
    const f = fixture(true); const id = await approval(f);
    f.raw.exec(`INSERT INTO mission_approvals (id,user_id,plugin_id,action_id,title,risk_level,status)
      VALUES ('plugin-approval','alice','me3.mission-control','review','Review project','medium','pending');`);
    const response = await f.app.request("/api/mission-control/approvals?status=pending", {}, f.env);
    const data = await response.json() as { approvals: Array<{ id: string }> };
    expect(data.approvals.map(card => card.id).sort()).toEqual([id, "plugin-approval"].sort());
    expect((await post(f, "plugin-approval", { decision: "approved" })).status).toBe(200);
    expect(f.raw.prepare("SELECT status FROM mission_approvals WHERE id='plugin-approval'").get()?.status).toBe("approved");
    expect(f.resumes()).toBe(0);
  });
});
