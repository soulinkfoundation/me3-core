import app from "../../worker/src/app";
import { retryAgentTurnNotifications } from "../../worker/src/agent-notifications";
import { dispatchDueCalendarPushNotifications } from "../../worker/src/calendar-push-notifications";
import { rememberDeferredTurns } from "../../worker/src/agent-memory-backlog";
import { dispatchDueGratitudeReminders } from "../../worker/src/gratitude";
import { Me3Agent } from "../../worker/src/me3-agent";
import { dispatchDueMorningCalendarPushes } from "../../worker/src/morning-calendar-push";
import { dispatchDueNewsPapers } from "../../worker/src/news-paper";
import { dispatchDueNewsNotifications } from "../../worker/src/news-push";
import type { Env, OwnerPublicPage } from "../../worker/src/types";
import { addUserSpend, localDay, messagesLeft, nextLocalMidnight, reusableLedgerAnswer, usageCostMicroUsd, type LedgerAnswer, type UserAllowance } from "./budget";
import { createD1Adapter } from "./d1-adapter";
import { getMe3CloudApiOrigin, getMe3CloudOrigin } from "../../worker/src/sites";
import { freePageRequest, isFreePagePath, ownerFieldsFromFreePage, publicPageFromFreePage } from "./free-page";
import { FREE_PLAN_NOTE, freeApiAccess, isFreeAllowancePath, freePluginList, freeStarters, freeToolAllowlist, freeTour, isChatTurnPath, isTourPath, rewriteMobileInstall, sanitizeChatTurnBody } from "./policy";
import { exportFreeContent, upgradedReply } from "./upgrade";
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
// Shared by every user object in this isolate: the last global ledger answer (see LEDGER_REUSE_MS).
let lastLedgerAnswer: LedgerAnswer<BudgetCheck> | null = null;
const TICK_SECONDS = 15 * 60;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;
// How long the public page read from Cloud is reused; saving the page here refreshes it at once.
const PUBLIC_PAGE_TTL_MS = 30 * 60 * 1000;

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
  user: "That's today's free messages used up. They come back at midnight, or upgrade to keep chatting.",
  budget: "Free chat is paused for the rest of today because ME3's free allowance has been used. It comes back at midnight UTC.",
  paused: "Free chat is paused for the moment. Please try again later.",
} as const;

type LimitKind = keyof typeof LIMIT_REPLIES;
/** What the apps show about the day's free chat: messages left, what stopped it, and when it comes back. */
export type FreeAllowance = { ok: true; messagesLeft: number; limited: LimitKind | null; resetsAt: string };

/** A limit is an ordinary reply from ME3, in the shape the apps already render, not an error. */
function limitReply(kind: LimitKind, stream: boolean, threadId: unknown, freeAllowance: FreeAllowance): Response {
  const payload = { ok: true, runtime: "agent", status: "complete", source: "free-limit", limit: kind, threadId: typeof threadId === "string" ? threadId : null, replyText: LIMIT_REPLIES[kind], model: null, approvalId: null, freeAllowance };
  if (!stream) return Response.json(payload);
  const frames = [["status", { state: "started" }], ["delta", { text: payload.replyText, source: "runtime" }], ["done", payload]] as const;
  return new Response(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  });
}

type BudgetCheck = { allowed: boolean; reason: "budget" | "paused" | null; perUserDailyMessages: number; perUserDailyMicroUsd: number; shed?: boolean };

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
  private baseSeen = false;
  private publicPageRead: { at: number; page: OwnerPublicPage | null } | null = null;

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
      // Free chat is priced by prompt size: writing and search tools load only when a turn needs them.
      ME3_AGENT_LEAN_TOOLS: "on",
      // One message may not run the model more than a few times, and the agent knows what the plan leaves out.
      ME3_AGENT_MAX_STEPS: "8",
      ME3_AGENT_PLAN_NOTE: FREE_PLAN_NOTE,
      // A free ME3 has no profile site: its public me3.app page in Cloud gives News a town and the agent a bio.
      ME3_OWNER_PUBLIC_PAGE: () => self.agent!.publicPage(),
      // News and Soup picks spend from the same daily allowance as chat and stop with it.
      ME3_FAST_MODEL_ALLOWED: () => self.agent!.fastModelAllowed(),
      // While free chat is busy a message is one model call: no follow-ups, memory waits for a quiet tick (me3-bybb.15).
      ME3_AGENT_SHED_AFTER_TURN: () => self.agent!.shedAfterTurn(),
      // Soulink knows each free ME3 by its own /u/{userId} address, so two free users never share a channel.
      ME3_SOULINK_ISSUER: () => self.agent!.meta("base_url"),
      ME3_OWNER_PUBLIC_URL: () => self.agent!.publicUrl(),
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

  private pageConfig() {
    return { cloudApiOrigin: getMe3CloudApiOrigin(this.env), serviceToken: (this.env as FreeRuntimeEnv).FREE_RUNTIME_SERVICE_TOKEN ?? "", userId: this.meta("user_id") ?? "" };
  }

  /** The owner's page while it is public, read from Cloud and reused for a while. A failed read is not kept. */
  private async publicPage(): Promise<OwnerPublicPage | null> {
    if (this.publicPageRead && Date.now() - this.publicPageRead.at < PUBLIC_PAGE_TTL_MS) return this.publicPageRead.page;
    const response = await freePageRequest(new Request("https://free-runtime.invalid/api/free/page"), this.pageConfig());
    if (!response.ok) return null;
    const page = publicPageFromFreePage(await response.json().catch(() => null));
    this.publicPageRead = { at: Date.now(), page };
    return page;
  }

  /** False once today's free allowance is used or free is paused; also reports settled spend. Fails closed. */
  private async fastModelAllowed(): Promise<boolean> {
    try {
      return (await this.settleSpend()).allowed;
    } catch (error) {
      console.error("Free budget check failed", error);
      return false;
    }
  }

  /** True while the global ledger says free chat is busy. Unsure counts as busy. */
  private async shedAfterTurn(): Promise<boolean> {
    try {
      return (await this.settleSpend()).shed === true;
    } catch {
      return true;
    }
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

  /** The owner's me3.app page, as the apps are told (rewriteMobileInstall). */
  private publicUrl(): string | null {
    const handle = this.ctx.storage.sql.exec("SELECT username FROM owner_profile WHERE id = 'owner'").toArray()[0]?.username;
    return typeof handle === "string" && handle ? `${getMe3CloudOrigin(this.env)}/${handle}` : null;
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
    // A closed ME3 is not reopened by a sign-in; only ME3 Cloud reopening it (/internal/freeze) does that.
    if (this.isActivated() && this.closedAt()) return Response.json({ ok: false, error: "This ME3 has moved to a paid plan", code: "upgraded" }, { status: 409 });
    await this.prepare();
    try {
      const { installId } = await activateUserDatabase(this.env.DB, {
        userId: input.userId,
        email: typeof input.email === "string" ? input.email : null,
        name: typeof input.name === "string" ? input.name : null,
        handle: typeof input.handle === "string" ? input.handle : null,
        timezone: typeof input.timezone === "string" ? input.timezone : null,
        coreToken: typeof input.coreToken === "string" && input.coreToken.length >= 32 ? input.coreToken : null,
      });
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      this.setMeta("user_id", input.userId);
      const base = request.headers.get(FREE_BASE_HEADER);
      if (base) this.setMeta("base_url", base);
      return Response.json({ ok: true, installId });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Activation failed" }, { status: 409 });
    }
  }

  /** Set once the user's paid ME3 is live: nothing here changes any more, so a copy taken later misses nothing. */
  private closedAt(): number {
    return Number(this.meta("closed_at") ?? 0);
  }

  /** ME3 Cloud only (index.ts checks the service token): close or reopen, export a closed ME3, delete everything. */
  private async internal(action: string, request: Request): Promise<Response> {
    if (action === "freeze") {
      const body = (await request.json().catch(() => null)) as { frozen?: unknown } | null;
      if (body?.frozen === false) {
        this.setMeta("closed_at", "0");
        return Response.json({ ok: true, closedAt: 0 });
      }
      // Repeating the call keeps the first closing time.
      if (!this.closedAt()) this.setMeta("closed_at", String(Date.now()));
      this.setMeta("next_tick_at", "0");
      return Response.json({ ok: true, closedAt: this.closedAt() });
    }
    if (action === "export") {
      if (!this.closedAt()) return Response.json({ ok: false, error: "Close this ME3 before exporting it", code: "not_closed" }, { status: 409 });
      return Response.json({ ok: true, ...exportFreeContent(this.ctx.storage) });
    }
    if (action === "purge") {
      const body = (await request.json().catch(() => null)) as { force?: unknown } | null;
      // An open ME3 is only deleted on purpose (account deletion), never by a late or repeated clean-up.
      if (!this.closedAt() && body?.force !== true) return Response.json({ ok: false, error: "This ME3 is still in use", code: "not_closed" }, { status: 409 });
      this.ready = null;
      await this.destroy();
      return Response.json({ ok: true, purged: true });
    }
    return notFound();
  }

  /** The free page editor: the caller must be this ME3's owner; the page itself is read and saved in ME3 Cloud. */
  private async freePage(request: Request): Promise<Response> {
    const context = { waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const owner = await app.fetch(new Request(new URL("/api/account", request.url), { headers: { authorization: request.headers.get("authorization") ?? "" } }), this.env, context);
    if (!owner.ok) return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const response = await freePageRequest(request, this.pageConfig());
    const url = new URL(request.url);
    if (!response.ok || url.pathname !== "/api/free/page") return response;
    const body = await response.clone().json().catch(() => null);
    this.publicPageRead = { at: Date.now(), page: publicPageFromFreePage(body) };
    // Cloud is the source for the name, handle and photo; keep this ME3's owner row in step whenever the page
    // is read or saved, so the apps show them everywhere.
    const fields = ownerFieldsFromFreePage(body, getMe3CloudApiOrigin(this.env), Date.now());
    if (fields) {
      const current = this.ctx.storage.sql.exec("SELECT avatar_url FROM owner_profile WHERE id = 'owner'").toArray()[0]?.avatar_url as string | null | undefined;
      // A read keeps the photo address it already has, so the app's image cache is not thrown away each time.
      const samePhoto = request.method === "GET" && Boolean(current) === Boolean(fields.avatarUrl) && current?.split("?")[0] === fields.avatarUrl?.split("?")[0];
      this.ctx.storage.sql.exec(
        "UPDATE owner_profile SET name = COALESCE(NULLIF(?, ''), name), username = COALESCE(NULLIF(?, ''), username), avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'owner'",
        fields.name, fields.handle, samePhoto ? (current ?? null) : fields.avatarUrl,
      );
    }
    return response;
  }

  /**
   * This ME3's public base URL (index.ts sets it on every request). Kept from activation, which ME3 Cloud
   * makes at the address it gives the apps, so Soulink always sees one issuer even if another hostname is used.
   */
  private rememberBase(base: string | null) {
    if (!base || this.baseSeen) return;
    if (!this.meta("base_url")) this.setMeta("base_url", base);
    this.baseSeen = true;
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
  private async settleSpend(fresh = false, turn = false): Promise<BudgetCheck> {
    const sql = this.ctx.storage.sql;
    const marker = Number(this.meta("usage_reported_rowid") ?? 0);
    // A call still in flight has reported no usage yet; stop before it so it is reported once it settles (or after ten minutes).
    const pending = sql.exec(
      "SELECT min(rowid) AS first FROM ai_usage_events WHERE rowid > ? AND coalesce(json_extract(metadata_json,'$.usageReported'),1) = 0 AND created_at > datetime('now','-10 minutes')",
      marker,
    ).toArray()[0]?.first as number | null;
    const upTo = pending ? pending - 1 : Number(sql.exec("SELECT coalesce(max(rowid), 0) AS last FROM ai_usage_events").toArray()[0].last);
    const rows = upTo > marker
      ? (sql.exec("SELECT estimated_cost_usd, tokens_in, tokens_out, coalesce(json_extract(metadata_json,'$.rejectedBeforeGeneration'),0) AS rejected FROM ai_usage_events WHERE rowid > ? AND rowid <= ?", marker, upTo).toArray() as { estimated_cost_usd: number; tokens_in: number; tokens_out: number; rejected: number }[])
      : [];
    // Chat turns always ask the ledger, so a pause stops the next message at once.
    const reused = fresh ? null : reusableLedgerAnswer(lastLedgerAnswer, rows.length > 0, Date.now());
    if (reused) return reused;
    const budget = (this.env as FreeRuntimeEnv).FREE_BUDGET;
    const response = await budget.get(budget.idFromName("global")).fetch("https://free-budget/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // A refused call (rate limit or overload) tells the ledger free chat is busy.
      body: JSON.stringify({ addMicroUsd: usageCostMicroUsd(rows), turn, rateLimited: rows.filter((row) => row.rejected).length }),
    });
    if (!response.ok) throw new Error("Free budget is unavailable");
    if (upTo > marker) {
      this.setMeta("usage_reported_rowid", String(upTo));
      this.saveAllowance(addUserSpend(this.allowance(), this.today(), usageCostMicroUsd(rows)));
    }
    const answer = (await response.json()) as BudgetCheck;
    lastLedgerAnswer = { at: Date.now(), value: answer };
    return answer;
  }

  private timeZone(): string | null {
    const zone = this.ctx.storage.sql.exec("SELECT timezone FROM owner_profile WHERE id = 'owner'").toArray()[0]?.timezone;
    return typeof zone === "string" && zone ? zone : null;
  }

  private today(now = Date.now()): string {
    return localDay(now, this.timeZone());
  }

  private allowance(): UserAllowance {
    try {
      const stored = JSON.parse(this.meta("chat_allowance") ?? "null") as Partial<UserAllowance> | null;
      if (stored && typeof stored.day === "string") return { day: stored.day, count: Number(stored.count) || 0, spentMicroUsd: Number(stored.spentMicroUsd) || 0 };
    } catch {
      // A damaged record starts the day again.
    }
    return { day: "", count: 0, spentMicroUsd: 0 };
  }

  private saveAllowance(allowance: UserAllowance) {
    this.setMeta("chat_allowance", JSON.stringify(allowance));
  }

  private describeAllowance(budget: BudgetCheck | null, limited: LimitKind | null): FreeAllowance {
    const now = Date.now();
    const left = budget ? messagesLeft(this.allowance(), this.today(now), budget) : 0;
    const reason = limited ?? (!budget ? "paused" : !budget.allowed ? (budget.reason === "paused" ? "paused" : "budget") : left === 0 ? "user" : null);
    const zone = reason === "user" ? this.timeZone() : null;
    return { ok: true, messagesLeft: reason ? 0 : left, limited: reason, resetsAt: new Date(nextLocalMidnight(now, zone)).toISOString() };
  }

  /** GET /api/free/allowance, for the owner only: how much free chat is left today. */
  private async freeAllowance(request: Request): Promise<Response> {
    const context = { waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    const owner = await app.fetch(new Request(new URL("/api/account", request.url), { headers: { authorization: request.headers.get("authorization") ?? "" } }), this.env, context);
    if (!owner.ok) return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const budget = await this.settleSpend().catch((error) => {
      console.error("Free budget check failed", error);
      return null;
    });
    return Response.json(this.describeAllowance(budget, null));
  }

  /** Null lets the turn run; otherwise the reply to send instead. Fails closed: no ledger, no model call. */
  private async chatLimit(stream: boolean, threadId: unknown): Promise<Response | null> {
    let budget: BudgetCheck;
    try {
      budget = await this.settleSpend(true, true);
    } catch (error) {
      console.error("Free budget check failed", error);
      return limitReply("paused", stream, threadId, this.describeAllowance(null, "paused"));
    }
    if (!budget.allowed) {
      const kind = budget.reason === "paused" ? "paused" : "budget";
      return limitReply(kind, stream, threadId, this.describeAllowance(budget, kind));
    }
    const day = this.today();
    if (messagesLeft(this.allowance(), day, budget) === 0) return limitReply("user", stream, threadId, this.describeAllowance(budget, "user"));
    const today = addUserSpend(this.allowance(), day, 0);
    this.saveAllowance({ ...today, count: today.count + 1 });
    return null;
  }

  async tick() {
    // A closed ME3 sends nothing and does not come back on the timer.
    if (!this.isActivated() || this.closedAt()) return;
    await this.prepare();
    const budget = await this.settleSpend().catch((error) => {
      console.error("Free budget report failed", error);
      return null;
    });
    // Memory from turns a busy moment deferred, a batch at a time, once free chat is quiet.
    if (budget?.allowed && !budget.shed) await rememberDeferredTurns(this.env, AbortSignal.timeout(60_000)).catch((error) => console.error("Free runtime step failed: deferred memory", error));
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
      return Response.json({ ok: true, userId: this.meta("user_id"), chatDay: this.meta("chat_day"), chatCount: Number(this.meta("chat_count") ?? 0), lastSeenAt: Number(this.meta("last_seen_at") ?? 0), nextTickAt: Number(this.meta("next_tick_at") ?? 0), closedAt: this.closedAt(), bytes: this.ctx.storage.sql.databaseSize });
    }
    if (url.pathname.startsWith("/__free/")) return this.internal(url.pathname.slice("/__free/".length), request);
    if (this.closedAt()) return upgradedReply();

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
    this.rememberBase(request.headers.get(FREE_BASE_HEADER));
    if (isFreePagePath(url.pathname)) return this.freePage(forwarded);
    if (isFreeAllowancePath(url.pathname)) return request.method === "GET" ? this.freeAllowance(forwarded) : notFound();
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
    if (isJson && response.ok && url.pathname === "/api/assistant/starters") {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(freeStarters((await response.json()) as Parameters<typeof freeStarters>[0])), { status: response.status, headers });
    }
    if (isJson && response.ok && isTourPath(url.pathname)) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(JSON.stringify(freeTour((await response.json()) as Parameters<typeof freeTour>[0])), { status: response.status, headers });
    }
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
