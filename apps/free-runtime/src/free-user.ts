import app from "../../worker/src/app";
import { retryAgentTurnNotifications } from "../../worker/src/agent-notifications";
import { dispatchDueCalendarPushNotifications } from "../../worker/src/calendar-push-notifications";
import { dispatchDueGratitudeReminders } from "../../worker/src/gratitude";
import { Me3Agent } from "../../worker/src/me3-agent";
import { dispatchDueMorningCalendarPushes } from "../../worker/src/morning-calendar-push";
import { dispatchDueNewsPapers } from "../../worker/src/news-paper";
import { dispatchDueNewsNotifications } from "../../worker/src/news-push";
import type { Env } from "../../worker/src/types";
import { countMessage, usageCostMicroUsd } from "./budget";
import { createD1Adapter } from "./d1-adapter";
import { getMe3CloudOrigin } from "../../worker/src/sites";
import { freeApiAccess, freePluginList, freeToolAllowlist, isChatTurnPath, rewriteMobileInstall, sanitizeChatTurnBody } from "./policy";
import { activateUserDatabase, prepareUserDatabase, type ActivationInput } from "./user-database";

export type FreeRuntimeEnv = Env & {
  FREE_USER: DurableObjectNamespace;
  FREE_BUDGET: DurableObjectNamespace;
  /** Shared secret ME3 Cloud presents to activate a user. */
  FREE_RUNTIME_SERVICE_TOKEN?: string;
  /** "on" includes News (the morning paper) in the free plan. */
  ME3_FREE_NEWS?: string;
};

/** Set by the Worker in index.ts on every request: the public base URL of this user's ME3. */
export const FREE_BASE_HEADER = "x-me3-free-base";

const META_TABLE = "free_runtime_meta";
const TICK_SECONDS = 15 * 60;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;

type ScheduledStep = readonly [name: string, run: (env: Env) => Promise<unknown>];
const FREE_STEPS: readonly ScheduledStep[] = [
  ["calendar push dispatch", dispatchDueCalendarPushNotifications],
  ["morning calendar push", dispatchDueMorningCalendarPushes],
  ["gratitude reminders", dispatchDueGratitudeReminders],
  ["agent turn notification retry", retryAgentTurnNotifications],
];
const NEWS_STEPS: readonly ScheduledStep[] = [
  ["news papers", dispatchDueNewsPapers],
  ["news notifications", dispatchDueNewsNotifications],
];

const LIMIT_REPLIES = {
  user: "That's today's free messages used up. They reset at midnight UTC, and a paid ME3 plan has no daily limit.",
  budget: "Free chat is paused for the rest of today because ME3's free allowance has been used. It comes back at midnight UTC.",
  paused: "Free chat is paused for the moment. Please try again later.",
} as const;

/** A limit is an ordinary reply from ME3, in the shape the apps already render, not an error. */
function limitReply(kind: keyof typeof LIMIT_REPLIES, stream: boolean, threadId: unknown): Response {
  const payload = { ok: true, runtime: "agent", status: "complete", source: "free-limit", limit: kind, threadId: typeof threadId === "string" ? threadId : null, replyText: LIMIT_REPLIES[kind], model: null, approvalId: null };
  if (!stream) return Response.json(payload);
  const frames = [["status", { state: "started" }], ["delta", { text: payload.replyText, source: "runtime" }], ["done", payload]] as const;
  return new Response(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  });
}

const upgradeRequired = () => Response.json({ ok: false, error: "This is part of a paid ME3 plan.", code: "upgrade_required" }, { status: 403 });
const notFound = () => Response.json({ ok: false, error: "Not found" }, { status: 404 });

/**
 * One free user's whole ME3: the Core app, its agent and its database, inside a single Durable Object.
 * The Worker in index.ts decides which user a request belongs to; nothing here trusts a user id from the client.
 */
export class Me3FreeUser extends Me3Agent {
  private readonly news: boolean;
  private ready: Promise<void> | null = null;
  private seenWrittenAt = 0;

  constructor(ctx: DurableObjectState, env: FreeRuntimeEnv) {
    const self: { agent?: Me3FreeUser } = {};
    // Core reaches its agent as ME3_AGENT.idFromName("owner"). Every free user is "owner" of their own
    // database, so that lookup must resolve to this object and never to a shared name.
    const ownAgent = {
      idFromName: (name: string) => ({ name, toString: () => name }),
      get: () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => self.agent!.agentRequest(new Request(input, init)) }),
    } as unknown as DurableObjectNamespace;
    const news = env.ME3_FREE_NEWS?.trim().toLowerCase() === "on";
    super(ctx, {
      ...env,
      DB: createD1Adapter(ctx.storage),
      ME3_AGENT: ownAgent,
      ME3_USER_AGENT: undefined,
      ME3_DEPLOYMENT_MODE: "self_hosted",
      ME3_AGENT_TOOL_ALLOWLIST: freeToolAllowlist({ news }),
      // Session and encryption secrets are generated per database (install_secrets), so a session issued
      // by one user's ME3 is never valid in another's. Setup-by-password does not exist here.
      JWT_SECRET: undefined,
      TOKEN_ENCRYPTION_KEY: undefined,
      SETUP_PASSWORD: undefined,
      SITE_ASSETS: undefined,
      BROWSER: undefined,
    } as FreeRuntimeEnv);
    self.agent = this;
    this.news = news;
  }

  private agentRequest(request: Request) {
    return super.onRequest(request);
  }

  private isActivated(): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", META_TABLE).toArray().length > 0;
  }

  private prepare(): Promise<void> {
    return (this.ready ??= (async () => {
      const result = await prepareUserDatabase(this.ctx.storage, this.env.DB);
      if (result.failed.length) throw new Error(`Database update failed: ${result.failed.join("; ")}`);
    })().catch((error) => {
      this.ready = null;
      throw error;
    }));
  }

  private meta(name: string): string | null {
    const row = this.ctx.storage.sql.exec(`SELECT value FROM ${META_TABLE} WHERE name = ?`, name).toArray()[0];
    return row ? String(row.value) : null;
  }

  private setMeta(name: string, value: string) {
    this.ctx.storage.sql.exec(`INSERT INTO ${META_TABLE} (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`, name, value);
  }

  private async activate(request: Request): Promise<Response> {
    const input = (await request.json().catch(() => null)) as ActivationInput | null;
    if (!input || typeof input.userId !== "string" || !input.userId) return Response.json({ ok: false, error: "userId is required" }, { status: 400 });
    await this.prepare();
    try {
      const { installId } = await activateUserDatabase(this.env.DB, {
        userId: input.userId,
        email: typeof input.email === "string" ? input.email : null,
        name: typeof input.name === "string" ? input.name : null,
        handle: typeof input.handle === "string" ? input.handle : null,
        timezone: typeof input.timezone === "string" ? input.timezone : null,
      });
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      this.setMeta("user_id", input.userId);
      return Response.json({ ok: true, installId });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Activation failed" }, { status: 409 });
    }
  }

  /** Reminders and pushes run on a per-user timer that only keeps going while the user is around. */
  private async touch() {
    const now = Date.now();
    if (now - this.seenWrittenAt < SEEN_WRITE_INTERVAL_MS) return;
    this.seenWrittenAt = now;
    this.setMeta("last_seen_at", String(now));
    if (Number(this.meta("next_tick_at") ?? 0) > now) return;
    this.setMeta("next_tick_at", String(now + TICK_SECONDS * 1000));
    await this.schedule(TICK_SECONDS, "tick");
  }

  /** Sends settled model spend to the global ledger and returns whether free chat may run right now. */
  private async settleSpend(): Promise<{ allowed: boolean; reason: "budget" | "paused" | null; perUserDailyMessages: number }> {
    const sql = this.ctx.storage.sql;
    const marker = Number(this.meta("usage_reported_rowid") ?? 0);
    // A call still in flight has reported no usage yet; stop before it so it is reported once it settles (or after ten minutes).
    const pending = sql.exec(
      "SELECT min(rowid) AS first FROM ai_usage_events WHERE rowid > ? AND coalesce(json_extract(metadata_json,'$.usageReported'),1) = 0 AND created_at > datetime('now','-10 minutes')",
      marker,
    ).toArray()[0]?.first as number | null;
    const upTo = pending ? pending - 1 : Number(sql.exec("SELECT coalesce(max(rowid), 0) AS last FROM ai_usage_events").toArray()[0].last);
    const rows = upTo > marker
      ? (sql.exec("SELECT estimated_cost_usd, tokens_in, tokens_out FROM ai_usage_events WHERE rowid > ? AND rowid <= ?", marker, upTo).toArray() as { estimated_cost_usd: number; tokens_in: number; tokens_out: number }[])
      : [];
    const budget = (this.env as FreeRuntimeEnv).FREE_BUDGET;
    const response = await budget.get(budget.idFromName("global")).fetch("https://free-budget/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addMicroUsd: usageCostMicroUsd(rows) }),
    });
    if (!response.ok) throw new Error("Free budget is unavailable");
    if (upTo > marker) this.setMeta("usage_reported_rowid", String(upTo));
    return (await response.json()) as { allowed: boolean; reason: "budget" | "paused" | null; perUserDailyMessages: number };
  }

  /** Null lets the turn run; otherwise the reply to send instead. Fails closed: no ledger, no model call. */
  private async chatLimit(stream: boolean, threadId: unknown): Promise<Response | null> {
    let budget: Awaited<ReturnType<Me3FreeUser["settleSpend"]>>;
    try {
      budget = await this.settleSpend();
    } catch (error) {
      console.error("Free budget check failed", error);
      return limitReply("paused", stream, threadId);
    }
    if (!budget.allowed) return limitReply(budget.reason === "paused" ? "paused" : "budget", stream, threadId);
    const counted = countMessage({ day: this.meta("chat_day") ?? "", count: Number(this.meta("chat_count") ?? 0) }, budget.perUserDailyMessages, Date.now());
    if (!counted.allowed) return limitReply("user", stream, threadId);
    this.setMeta("chat_day", counted.day);
    this.setMeta("chat_count", String(counted.count));
    return null;
  }

  async tick() {
    await this.prepare();
    await this.settleSpend().catch((error) => console.error("Free budget report failed", error));
    for (const [name, run] of this.news ? [...FREE_STEPS, ...NEWS_STEPS] : FREE_STEPS) {
      try {
        await run(this.env);
      } catch (error) {
        console.error(`Free runtime step failed: ${name}`, error);
      }
    }
    const now = Date.now();
    if (now - Number(this.meta("last_seen_at") ?? 0) > ACTIVE_WINDOW_MS) {
      this.setMeta("next_tick_at", "0");
      return;
    }
    this.setMeta("next_tick_at", String(now + TICK_SECONDS * 1000));
    await this.schedule(TICK_SECONDS, "tick");
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__free/activate" && request.method === "POST") return this.activate(request);
    // An object nobody activated stays empty: no schema, no storage, no Core.
    if (!this.isActivated()) return notFound();
    if (url.pathname === "/__free/status") {
      return Response.json({ ok: true, userId: this.meta("user_id"), chatDay: this.meta("chat_day"), chatCount: Number(this.meta("chat_count") ?? 0), lastSeenAt: Number(this.meta("last_seen_at") ?? 0), nextTickAt: Number(this.meta("next_tick_at") ?? 0), bytes: this.ctx.storage.sql.databaseSize });
    }
    if (url.pathname.startsWith("/__free/")) return notFound();

    let forwarded = request;
    const needsBody = request.method === "POST" && (url.pathname === "/api/batch" || isChatTurnPath(url.pathname));
    let body: unknown;
    if (needsBody) {
      body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
      if (isChatTurnPath(url.pathname)) body = sanitizeChatTurnBody(body as Record<string, unknown>);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      forwarded = new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) });
    }
    if (freeApiAccess(request.method, url.pathname, { news: this.news }, body) !== "allow") return upgradeRequired();

    await this.prepare();
    await this.touch();
    if (request.method === "POST" && isChatTurnPath(url.pathname)) {
      const limited = await this.chatLimit(url.pathname.endsWith("/stream"), (body as Record<string, unknown>).threadId);
      if (limited) return limited;
    }
    const response = await app.fetch(forwarded, this.env, {
      waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext);
    const isJson = response.headers.get("content-type")?.includes("application/json");
    if (isJson && response.ok && url.pathname === "/api/plugins") {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(freePluginList((await response.json()) as { plugins?: { id: string }[] }, { news: this.news })), { status: response.status, headers });
    }
    const base = request.headers.get(FREE_BASE_HEADER);
    if (!base || !url.pathname.startsWith("/api/mobile/") || !isJson) return response;
    const handle = this.ctx.storage.sql.exec("SELECT username FROM owner_profile WHERE id = 'owner'").toArray()[0]?.username;
    const cloud = getMe3CloudOrigin(this.env);
    const corrected = rewriteMobileInstall(await response.json(), { base, publicURL: typeof handle === "string" && handle ? `${cloud}/${handle}` : cloud });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(corrected), { status: response.status, headers });
  }
}
