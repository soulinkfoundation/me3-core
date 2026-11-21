import { DurableObject } from "cloudflare:workers";
import { budgetDecision, DEFAULT_BUDGET, type BudgetState } from "./budget";

/** The single global ledger for free chat spend. Every user's object checks in here before a chat turn. */
export class FreeBudget extends DurableObject {
  private read(): BudgetState {
    const stored = this.ctx.storage.kv.get<BudgetState>("state");
    return { ...DEFAULT_BUDGET, ...stored };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    let state = this.read();
    if (url.pathname === "/settings" && request.method === "POST") {
      if (typeof body.paused === "boolean") state.paused = body.paused;
      if (typeof body.dailyBudgetUsd === "number" && body.dailyBudgetUsd >= 0) state.dailyBudgetMicroUsd = Math.round(body.dailyBudgetUsd * 1_000_000);
      if (typeof body.perUserDailyMessages === "number" && body.perUserDailyMessages >= 0) state.perUserDailyMessages = Math.floor(body.perUserDailyMessages);
      if (typeof body.perUserDailyUsd === "number" && body.perUserDailyUsd >= 0) state.perUserDailyMicroUsd = Math.round(body.perUserDailyUsd * 1_000_000);
    }
    const decision = budgetDecision(state, Date.now(), url.pathname === "/check" ? Number(body.addMicroUsd ?? 0) : 0);
    state = decision.state;
    this.ctx.storage.kv.put("state", state);
    return Response.json({
      ok: true,
      allowed: decision.allowed,
      reason: decision.reason ?? null,
      day: state.day,
      spentUsd: state.spentMicroUsd / 1_000_000,
      dailyBudgetUsd: state.dailyBudgetMicroUsd / 1_000_000,
      perUserDailyMessages: state.perUserDailyMessages,
      perUserDailyUsd: state.perUserDailyMicroUsd / 1_000_000,
      perUserDailyMicroUsd: state.perUserDailyMicroUsd,
      paused: state.paused,
    });
  }
}
