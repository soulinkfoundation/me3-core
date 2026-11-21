import { describe, expect, it } from "vitest";
import { freeApiAccess, freeToolAllowlist, sanitizeChatTurnBody } from "../src/policy";
import { toolAllowedByEnv } from "../../worker/src/agent-tool-allowlist";

// Failure modes: a paid or costly capability reaches a free user (route, agent tool, model choice, or through
// /api/batch), or a free feature is blocked.
describe("free tier policy", () => {
  it("allows the free feature APIs", () => {
    for (const path of ["/api/mobile/token", "/api/assistant/chat/turn/stream", "/api/mission-control/tasks", "/api/tasks/goals", "/api/journal/articles", "/api/calendar/events", "/api/account", "/api/push/devices", "/api/auth/me"]) {
      expect(freeApiAccess("GET", path, { news: false }), path).toBe("allow");
    }
  });

  it("blocks paid features, setup and uploads", () => {
    for (const path of ["/api/mailbox/messages", "/api/sites/x", "/api/social/queue", "/api/accounts/summary", "/api/files/list", "/api/computer/jobs", "/api/ai-settings", "/api/admin/bootstrap", "/api/auth/login", "/api/assistant/attachments", "/api/coding-agent/tasks", "/api/payments/x", "/mcp", "/api/assistantx", "/"]) {
      expect(freeApiAccess("POST", path, { news: false }), path).toBe("upgrade");
    }
  });

  it("keeps News off unless it is switched on", () => {
    expect(freeApiAccess("GET", "/api/news/today", { news: false })).toBe("upgrade");
    expect(freeApiAccess("GET", "/api/news/today", { news: true })).toBe("allow");
  });

  it("limits the agent to free tools", () => {
    const env = { ME3_AGENT_TOOL_ALLOWLIST: freeToolAllowlist({ news: false }) };
    for (const name of ["core_mission_task_create", "core_journal_save", "core_calendar_event_create", "core_reminders_create", "core_memory_search", "core_tools_load"]) expect(toolAllowedByEnv(env, name), name).toBe(true);
    for (const name of ["core_mailbox_send", "core_web_search", "core_images_generate", "core_sites_starter_draft", "core_payments_propose", "core_computer_start", "core_news_paper", "core_social_queue_read", "core_coding_send", "core_accounts_summary"]) expect(toolAllowedByEnv(env, name), name).toBe(false);
    expect(toolAllowedByEnv({ ME3_AGENT_TOOL_ALLOWLIST: freeToolAllowlist({ news: true }) }, "core_news_paper")).toBe(true);
  });

  it("leaves installs without an allowlist untouched", () => {
    expect(toolAllowedByEnv({}, "core_mailbox_send")).toBe(true);
    expect(toolAllowedByEnv({ ME3_AGENT_TOOL_ALLOWLIST: "  " }, "core_mailbox_send")).toBe(true);
  });

  it("drops a client's model choice from a chat turn", () => {
    expect(sanitizeChatTurnBody({ messageText: "hi", model: { providerId: "anthropic", model: "claude-opus" }, mode: "deep" })).toEqual({ messageText: "hi" });
  });

  it("rejects a batch that reaches a blocked path", () => {
    expect(freeApiAccess("POST", "/api/batch", { news: false }, { requests: ["/api/account", "/api/mission-control/tasks?x=1"] })).toBe("allow");
    expect(freeApiAccess("POST", "/api/batch", { news: false }, { requests: ["/api/account", "/api/mailbox/messages"] })).toBe("upgrade");
    expect(freeApiAccess("POST", "/api/batch", { news: false }, { requests: "nope" })).toBe("upgrade");
  });
});
