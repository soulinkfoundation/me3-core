import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PAY_DIRECTLY_SCHEMA, createPaymentMethod, deletePaymentMethod } from "./pay-directly";
import { publishSiteFromSource, republishForPaymentChange } from "./site-publish";
import { createEmptyPublishManifest, getSiteFileText, putSiteFile, savePublishManifest } from "./sites";
import { registerCommerceRoutes } from "./routes/commerce";
import type { DbSite, Env } from "./types";

// Failure modes: an unpayable paid offer stops the site publishing; the live page still offers
// Book for it, sending buyers into a checkout that fails; saving a way to get paid leaves the page
// on Enquire until the owner publishes by hand; removing it leaves Book live; a site already
// rendered with this readiness is rendered again on every status read; the Enquire link writes
// the owner's email into the page or opens for a site that isn't live.

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  for (const sql of PAY_DIRECTLY_SCHEMA) raw.exec(sql);
  raw.exec(`INSERT INTO owner_profile(id, email) VALUES('owner', 'me@owner.test');
    INSERT INTO sites(id, user_id, username, site_role, published_at) VALUES('site', 'owner', 'clara', 'profile', datetime('now'));`);
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  };
  const env = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  return { raw, env };
}

const profile = {
  version: "0.1", handle: "clara", name: "Clara",
  intents: { book: { enabled: true, bookingTypes: [{ id: "one_to_one", type: "one_to_one", label: "1:1", offers: [
    { id: "session", title: "Session", duration: 60, pricing: { enabled: true, suggestedAmount: 5000, currency: "EUR", paymentMethod: "manual" } },
  ] }] } },
};

async function site(env: Env): Promise<DbSite> {
  return (await env.DB.prepare("SELECT * FROM sites WHERE id = 'site'").first<DbSite>())!;
}

async function publish(env: Env) {
  await putSiteFile(env, "site", "src/me.json", JSON.stringify(profile), "application/json");
  const manifest = createEmptyPublishManifest();
  await savePublishManifest(env, "site", manifest);
  await publishSiteFromSource(env, await site(env), manifest);
}

const home = async (env: Env) => (await getSiteFileText(env, "site", "public/index.html")) || "";

describe("paid offers nobody can pay for yet", () => {
  it("publish with Enquire, and flip to Book and back when a way to get paid is saved and removed", async () => {
    const { env } = fixture();
    await publish(env);
    expect(await home(env)).toContain('href="/api/enquire/clara?about=Session"');
    expect(await home(env)).not.toContain("me@owner.test");

    // Nothing changed since the last render, so nothing is republished.
    expect(await republishForPaymentChange(env, "owner")).toBe(0);

    const bank = await createPaymentMethod(env, "owner", { kind: "bank", accountName: "Clara Doyle", iban: "IE29AIBK93115212345678" });
    expect(await republishForPaymentChange(env, "owner")).toBe(1);
    expect(await home(env)).not.toContain("/api/enquire/");
    expect(await home(env)).toContain('class="booking-widget');

    await deletePaymentMethod(env, "owner", bank.id);
    expect(await republishForPaymentChange(env, "owner")).toBe(1);
    expect(await home(env)).toContain('href="/api/enquire/clara?about=Session"');
    expect(await home(env)).not.toContain('class="booking-widget');
  });

  it("Enquire opens an email to the owner of a live site only", async () => {
    const { env, raw } = fixture();
    const app = new Hono<{ Bindings: Env }>();
    registerCommerceRoutes(app as never, { requireOwner: async () => null, unauthorized: () => new Response(null, { status: 401 }), getCoreWebOrigin: () => "http://localhost" } as never);
    const response = await app.fetch(new Request("http://localhost/api/enquire/clara?about=Session"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("mailto:me@owner.test?subject=Enquiry%3A%20Session");
    raw.exec("UPDATE sites SET published_at = NULL");
    expect((await app.fetch(new Request("http://localhost/api/enquire/clara"), env)).status).toBe(404);
  });
});
