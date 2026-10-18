import type { AgentCodingServices } from "../../../packages/agent/src/tools";
import type { Env } from "./types";

/**
 * Send to Claude: the owner's GitHub token (an installation secret, never sent to clients) lets ME3
 * open issues that mention @claude. Each repository's Claude Code workflow picks the issue up and
 * opens a pull request. GitHub stays the record: recent tasks are found by the issue footer.
 */
const TOKEN_SECRET = "coding_agent_github_token";
const FOOTER = "Sent from ME3.";
const WORKFLOW_PATH = ".github/workflows/claude.yml";

export class CodingAgentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 400) {
    super(message);
  }
}

export type CodingTaskStatus = "waiting" | "working" | "pull_request" | "finished" | "failed" | "closed";
export type CodingTask = {
  repository: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  status: CodingTaskStatus;
  label: string;
  link: string;
};

type GitHubRepo = { full_name: string; name: string; permissions?: { push?: boolean; triage?: boolean }; has_issues: boolean; archived?: boolean };
type GitHubComment = { user?: { login?: string } | null; body?: string | null };

async function readToken(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM install_secrets WHERE name = ?").bind(TOKEN_SECRET).first<{ value: string }>();
  return row?.value?.trim() || null;
}

async function github<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "ME3",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.ok) return (await response.json()) as T;
  if (response.status === 401) throw new CodingAgentError("GitHub didn't accept the token. Connect GitHub again in Settings.", 409);
  if (response.status === 403 || response.status === 404) throw new CodingAgentError("The GitHub token can't reach that repository, or it doesn't exist.", 404);
  throw new CodingAgentError(`GitHub returned an error (${response.status}). Try again.`, 502);
}

/** Repositories the token can open issues in, most recently pushed first. */
async function listRepositories(token: string): Promise<string[]> {
  const repos = await github<GitHubRepo[]>(token, "/user/repos?per_page=100&sort=pushed");
  return repos
    .filter(repo => repo.has_issues && !repo.archived && (repo.permissions?.push || repo.permissions?.triage))
    .map(repo => repo.full_name);
}

async function resolveRepository(token: string, value: string): Promise<string> {
  const wanted = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").split("/").filter(Boolean).slice(0, 2).join("/");
  if (!wanted) throw new CodingAgentError("Name the repository.");
  const repositories = await listRepositories(token);
  const matches = repositories.filter(name => wanted.includes("/")
    ? name.toLowerCase() === wanted.toLowerCase()
    : name.split("/")[1]?.toLowerCase() === wanted.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CodingAgentError(`More than one repository is called ${wanted}: ${matches.join(", ")}. Use owner/name.`);
  throw new CodingAgentError(`Claude can't reach ${wanted}. Repositories it can work in: ${repositories.slice(0, 20).join(", ") || "none"}.`, 404);
}

/** Claude edits one tracking comment per run; the workflow then links the pull request. */
export function codingTaskStatus(issueState: string, reply: string): { status: CodingTaskStatus; label: string; link: string | null } {
  const text = reply.toLowerCase();
  const links = [...reply.matchAll(/https:\/\/github\.com\/[^\s)\]]+/g)].map(match => match[0]);
  if (text.includes("encountered an error")) return { status: "failed", label: "Claude hit an error", link: null };
  if (text.includes("finished") || text.includes("completed")) {
    const pull = links.find(link => link.includes("/pull/"));
    if (pull) return { status: "pull_request", label: "PR ready to review", link: pull };
    const compare = links.find(link => link.includes("/compare/"));
    return { status: "finished", label: compare ? "Ready to open a PR" : "Claude replied", link: compare ?? null };
  }
  if (issueState === "closed") return { status: "closed", label: "Closed", link: null };
  if (reply) return { status: "working", label: "Claude is working", link: null };
  return { status: "waiting", label: "Waiting for Claude", link: null };
}

async function recentTasks(token: string, repository?: string): Promise<CodingTask[]> {
  const login = (await github<{ login: string }>(token, "/user")).login;
  const scope = repository ? `repo:${repository}` : `author:${login}`;
  const query = encodeURIComponent(`"${FOOTER}" in:body is:issue ${scope}`);
  const found = await github<{ items: Array<{ number: number; title: string; html_url: string; state: string; created_at: string; repository_url: string }> }>(
    token, `/search/issues?q=${query}&sort=created&order=desc&per_page=8`);
  return Promise.all(found.items.map(async issue => {
    const repo = issue.repository_url.split("/repos/")[1] ?? "";
    const comments = await github<GitHubComment[]>(token, `/repos/${repo}/issues/${issue.number}/comments?per_page=100`).catch(() => []);
    const reply = [...comments].reverse().find(comment => /^(claude|github-actions)/i.test(comment.user?.login ?? ""))?.body ?? "";
    const { status, label, link } = codingTaskStatus(issue.state, reply);
    return { repository: repo, number: issue.number, title: issue.title, url: issue.html_url, createdAt: issue.created_at, status, label, link: link ?? issue.html_url };
  }));
}

export async function getCodingAgentConnection(env: Env) {
  const token = await readToken(env);
  if (!token) return { connected: false as const };
  try {
    const [user, repositories] = await Promise.all([github<{ login: string }>(token, "/user"), listRepositories(token)]);
    return { connected: true as const, login: user.login, repositories };
  } catch (error) {
    return { connected: true as const, error: error instanceof Error ? error.message : String(error), repositories: [] as string[] };
  }
}

export async function connectCodingAgent(env: Env, rawToken: unknown) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) throw new CodingAgentError("Paste a GitHub token.");
  await github<{ login: string }>(token, "/user");
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).bind(TOKEN_SECRET, token).run();
  return getCodingAgentConnection(env);
}

export async function disconnectCodingAgent(env: Env) {
  await env.DB.prepare("DELETE FROM install_secrets WHERE name = ?").bind(TOKEN_SECRET).run();
  return { connected: false as const };
}

export async function listCodingTasks(env: Env, repository?: string) {
  const token = await readToken(env);
  if (!token) throw new CodingAgentError("Connect GitHub in Settings first.", 409);
  return { tasks: await recentTasks(token, repository ? await resolveRepository(token, repository) : undefined) };
}

/** Agent services; undefined until the owner connects GitHub, which hides the tools. */
export async function createCodingAgentServices(env: Env): Promise<AgentCodingServices | undefined> {
  const token = await readToken(env);
  if (!token) return undefined;
  return {
    async status({ repository }) {
      const [repositories, tasks] = await Promise.all([
        listRepositories(token),
        recentTasks(token, repository ? await resolveRepository(token, repository) : undefined),
      ]);
      return { repositories, tasks };
    },
    resolveRepository: repository => resolveRepository(token, repository),
    async send({ repository, title, brief }) {
      await github(token, `/repos/${repository}/contents/${WORKFLOW_PATH}`).catch(() => {
        throw new CodingAgentError(`Claude isn't set up in ${repository} yet: it needs ${WORKFLOW_PATH} and the CLAUDE_CODE_OAUTH_TOKEN secret.`, 409);
      });
      const issue = await github<{ number: number; html_url: string }>(token, `/repos/${repository}/issues`, {
        method: "POST",
        body: { title, body: `@claude ${brief}\n\n---\n${FOOTER}` },
      });
      return { repository, number: issue.number, url: issue.html_url, title, status: "waiting", label: "Waiting for Claude" };
    },
  };
}
