import { afterEach, describe, expect, it, vi } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import { codingTaskStatus, connectCodingAgent, createCodingAgentServices, getCodingAgentConnection } from "./coding-agent";
import type { Env } from "./types";

// Failure modes: an issue opens before the owner approves; the token leaks back to a client; a bare
// repository name picks the wrong repo; a repo without the Claude workflow gets an issue nobody picks
// up; an error, a pull request or a running reply reads as the wrong status; tools show before
// GitHub is connected.
function secretsEnv(initial: Record<string, string> = {}) {
  const secrets = new Map(Object.entries(initial));
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first<T>() { return (secrets.has(String(values[0])) ? { value: secrets.get(String(values[0])) } : null) as T; },
        async run() {
          if (sql.startsWith("DELETE")) secrets.delete(String(values[0]));
          else secrets.set(String(values[0]), String(values[1]));
          return {};
        },
      };
      return statement;
    },
  };
  return { env: { DB } as unknown as Env, secrets };
}

type Route = (url: URL, init: RequestInit) => unknown;
function stubGitHub(routes: Record<string, Route>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(route(url, init)), { status: 200 });
  }));
  return calls;
}

const repos = [
  { full_name: "soulinkfoundation/me3-ios", name: "me3-ios", has_issues: true, permissions: { push: true } },
  { full_name: "soulinkfoundation/me3-core", name: "me3-core", has_issues: true, permissions: { push: true } },
  { full_name: "someone/me3-core", name: "me3-core", has_issues: true, permissions: { push: true } },
  { full_name: "soulinkfoundation/archive", name: "archive", has_issues: true, archived: true, permissions: { push: true } },
];

function toolContext(services: unknown, approved = false) {
  return { db: {}, ownerId: "owner", messageText: "", signal: new AbortController().signal, enabledPluginIds: new Set(), services, approved } as unknown as AgentToolContext;
}

afterEach(() => vi.unstubAllGlobals());

describe("Send to Claude", () => {
  it("reads Claude's replies as the right status", () => {
    expect(codingTaskStatus("open", "")).toMatchObject({ status: "waiting" });
    expect(codingTaskStatus("open", "Claude Code is working… [View job](https://github.com/o/r/actions/runs/1)")).toMatchObject({ status: "working" });
    expect(codingTaskStatus("open", "**Claude encountered an error after 2s** —— [View job](https://github.com/o/r/actions/runs/1)")).toMatchObject({ status: "failed" });
    expect(codingTaskStatus("open", "**Claude finished** and opened a pull request to review: https://github.com/o/r/pull/7"))
      .toEqual({ status: "pull_request", label: "PR ready to review", link: "https://github.com/o/r/pull/7" });
    expect(codingTaskStatus("open", "**Claude finished** [Create PR ➔](https://github.com/o/r/compare/main...claude/issue-1?quick_pull=1)"))
      .toMatchObject({ status: "finished", label: "Ready to open a PR" });
    expect(codingTaskStatus("closed", "")).toMatchObject({ status: "closed" });
  });

  it("keeps the token on the installation and hides the tools until GitHub is connected", async () => {
    const { env, secrets } = secretsEnv();
    expect(await createCodingAgentServices(env)).toBeUndefined();
    stubGitHub({ "GET /user": () => ({ login: "owner" }), "GET /user/repos": () => repos });
    const connection = await connectCodingAgent(env, "  github_pat_secret  ");
    expect(secrets.get("coding_agent_github_token")).toBe("github_pat_secret");
    expect(JSON.stringify(connection)).not.toContain("github_pat_secret");
    expect(JSON.stringify(await getCodingAgentConnection(env))).not.toContain("github_pat_secret");
    expect(connection).toMatchObject({ connected: true, login: "owner", repositories: ["soulinkfoundation/me3-ios", "soulinkfoundation/me3-core", "someone/me3-core"] });
  });

  it("asks for approval before opening the issue, then opens it with the @claude trigger", async () => {
    const { env } = secretsEnv({ coding_agent_github_token: "token" });
    const calls = stubGitHub({
      "GET /user/repos": () => repos,
      "GET /repos/soulinkfoundation/me3-ios/contents/.github/workflows/claude.yml": () => ({}),
      "POST /repos/soulinkfoundation/me3-ios/issues": () => ({ number: 12, html_url: "https://github.com/soulinkfoundation/me3-ios/issues/12" }),
    });
    const coding = await createCodingAgentServices(env);
    const tool = createDomainTools().find(candidate => candidate.name === "core_coding_send")!;
    expect(tool.approval).toBe("required");
    const args = { repository: "me3-ios", title: "Fix the journal save button", brief: "It flickers after saving." };

    const pending = await tool.execute(args, toolContext({ coding }));
    expect(pending).toMatchObject({ status: "needs_approval", approval: { title: "Send to Claude", summary: "soulinkfoundation/me3-ios: Fix the journal save button" } });
    expect(calls.some(call => call.method === "POST")).toBe(false);

    const sent = await tool.execute(args, toolContext({ coding }, true));
    expect(sent).toMatchObject({ status: "ok", data: { repository: "soulinkfoundation/me3-ios", number: 12 } });
    const post = calls.find(call => call.method === "POST")!;
    expect(post.body).toEqual({ title: "Fix the journal save button", body: "@claude It flickers after saving.\n\n---\nSent from ME3." });
  });

  it("refuses ambiguous names and repos where Claude is not set up", async () => {
    const { env } = secretsEnv({ coding_agent_github_token: "token" });
    const calls = stubGitHub({ "GET /user/repos": () => repos });
    const coding = (await createCodingAgentServices(env))!;
    await expect(coding.resolveRepository("me3-core")).rejects.toThrow(/More than one repository/);
    await expect(coding.resolveRepository("archive")).rejects.toThrow(/can't reach archive/);
    expect(await coding.resolveRepository("https://github.com/soulinkfoundation/me3-core.git")).toBe("soulinkfoundation/me3-core");
    await expect(coding.send({ repository: "soulinkfoundation/me3-core", title: "T", brief: "B" })).rejects.toThrow(/isn't set up in soulinkfoundation\/me3-core/);
    expect(calls.some(call => call.method === "POST")).toBe(false);
  });

  it("finds recent tasks by the ME3 footer and reports each status", async () => {
    const { env } = secretsEnv({ coding_agent_github_token: "token" });
    const calls = stubGitHub({
      "GET /user": () => ({ login: "owner" }),
      "GET /user/repos": () => repos,
      "GET /search/issues": () => ({ items: [{ number: 7, title: "Fix it", html_url: "https://github.com/soulinkfoundation/me3-ios/issues/7", state: "open", created_at: "2026-10-18T10:00:00Z", repository_url: "https://api.github.com/repos/soulinkfoundation/me3-ios" }] }),
      "GET /repos/soulinkfoundation/me3-ios/issues/7/comments": () => [
        { user: { login: "claude[bot]" }, body: "**Claude finished** [Create PR ➔](https://github.com/x/compare/main...b)" },
        { user: { login: "github-actions[bot]" }, body: "**Claude finished** and opened a pull request to review: https://github.com/soulinkfoundation/me3-ios/pull/8" },
      ],
    });
    const coding = (await createCodingAgentServices(env))!;
    const result = await coding.status({}) as { tasks: Array<Record<string, unknown>> };
    expect(result.tasks).toEqual([expect.objectContaining({ repository: "soulinkfoundation/me3-ios", number: 7, status: "pull_request", link: "https://github.com/soulinkfoundation/me3-ios/pull/8" })]);
    const search = calls.find(call => call.path === "/search/issues");
    expect(search).toBeDefined();
  });
});
