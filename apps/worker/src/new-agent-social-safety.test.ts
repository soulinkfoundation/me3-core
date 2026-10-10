import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { claimPostingPlanForConfirmation, getPostingPlan } from "@me3-core/plugin-social-publishing";
import type { SocialPostingPlanEnv } from "../../../packages/social-publishing/src/posting-plans";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username,name) VALUES ('owner','owner','Owner');
    INSERT INTO sites(id,user_id,username,site_role) VALUES ('site','owner','owner','profile');
    INSERT INTO social_accounts(id,user_id,site_id,platform,platform_account_id,display_name,status,scopes_json,metadata_json,access_token_ciphertext) VALUES ('account','owner','site','linkedin','synthetic-account','LinkedIn','active','[]','{}','synthetic-unusable-token');
    INSERT INTO social_packages(id,site_id,post_slug,post_title_snapshot,source_hash,status,created_by,source_type,source_snapshot,source_text,idea_text) VALUES ('post','site','post','Source','hash','ready','user','journal','{}','Source','Draft');
    INSERT INTO social_variants(id,package_id,platform,target_account_id,format,body_text,asset_manifest_json,approval_status,approved_at,approved_by_user_id) VALUES ('version','post','linkedin','account','post','Approved body','[]','approved','2099-01-01T00:00:00.000Z','owner');
    INSERT INTO social_posting_plans(id,user_id,site_id,account_id,status,request_json,expires_at) VALUES ('plan','owner','site','account','suggested','{"windowStart":"2099-10-11T00:00:00.000Z","windowEnd":"2099-10-15T00:00:00.000Z","requestedCount":1,"timezone":"UTC","minimumGapMinutes":0,"minimumRepostDays":null}','2099-10-16T00:00:00.000Z');
    INSERT INTO social_posting_plan_items(id,plan_id,position,variant_id,version_updated_at_snapshot,approval_status_snapshot,version_fingerprint,scheduled_for,timezone,status) VALUES ('item','plan',0,'version','2099-01-01T00:00:00.000Z','approved','synthetic-fingerprint','2099-10-12T09:00:00.000Z','UTC','suggested');`);
  let raceSql: string | null = null;
  function statement(sql: string, values: unknown[] = []) {
    return { bind: (...bound: unknown[]) => statement(sql, bound), async first<T>() {
      if (raceSql && sql.includes("SET status = 'confirming'")) { raw.exec(raceSql); raceSql = null; }
      return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null;
    }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
  }
  const env: SocialPostingPlanEnv = { DB: { prepare: sql => statement(sql), batch: statements => Promise.all(statements.map(statement => statement.run())) } };
  return { raw, env, race(sql: string) { raceSql = sql; } };
}

describe("exact approved social plan state", () => {
  it("rejects a schedule changed without changing the parent plan timestamp", async () => {
    const f = fixture(); const expected = (await getPostingPlan(f.env, "owner", "plan"))!;
    f.raw.exec("UPDATE social_posting_plan_items SET scheduled_for='2099-10-13T11:00:00.000Z' WHERE id='item'");
    await expect(claimPostingPlanForConfirmation(f.env, "owner", "plan", { confirmed: true, expectedUpdatedAt: expected.updatedAt, expectedPlan: expected })).rejects.toThrow(/changed/i);
    expect(f.raw.prepare("SELECT status FROM social_posting_plans WHERE id='plan'").get()).toMatchObject({ status: "suggested" });
  });
  it("atomically rejects an item changed between the reviewed read and the claim", async () => {
    const f = fixture(); const expected = (await getPostingPlan(f.env, "owner", "plan"))!;
    f.race("UPDATE social_posting_plan_items SET timezone='Europe/Dublin' WHERE id='item'");
    await expect(claimPostingPlanForConfirmation(f.env, "owner", "plan", { confirmed: true, expectedUpdatedAt: expected.updatedAt, expectedPlan: expected })).rejects.toThrow(/changed/i);
    expect(f.raw.prepare("SELECT status FROM social_posting_plans WHERE id='plan'").get()).toMatchObject({ status: "suggested" });
  });
  it("atomically rejects a body changed between the reviewed read and the claim", async () => {
    const f = fixture(); const expected = (await getPostingPlan(f.env, "owner", "plan"))!;
    f.race("UPDATE social_variants SET body_text='Unreviewed body' WHERE id='version'");
    await expect(claimPostingPlanForConfirmation(f.env, "owner", "plan", { confirmed: true, expectedUpdatedAt: expected.updatedAt, expectedPlan: expected })).rejects.toThrow(/changed/i);
  });
  it("claims the exact reviewed plan once", async () => {
    const f = fixture(); const expected = (await getPostingPlan(f.env, "owner", "plan"))!;
    expect(await claimPostingPlanForConfirmation(f.env, "owner", "plan", { confirmed: true, expectedUpdatedAt: expected.updatedAt, expectedPlan: expected })).toMatchObject({ alreadyConfirmed: false, plan: { status: "confirming" } });
  });
});
