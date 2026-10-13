import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverInboundEmail, handleInboundEmail, type ForwardableEmailMessageLike } from "./mailbox-inbound";
import { reconcileMailboxAttachmentStaging } from "./mailbox-attachment-staging";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); });

function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8"));
  for (const name of ["0021_managed_email_inbound_deliveries", "0048_mailbox_attachment_staging"]) {
    db.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  db.exec("INSERT INTO owner_profile (id) VALUES ('owner')");
  db.exec(`INSERT INTO mailbox_aliases (id, alias_local_part, forwarding_email, status) VALUES ('mailbox-1', 'owner', '', 'active')`);
  const objects = new Map<string, Uint8Array>();
  const state = { failBatch: false, lostCommitResponse: false, failPut: false, failDelete: false };
  const prepare = (sql: string) => {
    let values: any[] = [];
    const statement = {
      sql, get values() { return values; },
      bind(...args: any[]) { values = args; return statement; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const result = db.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return statement;
  };
  const env = {
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        if (state.failBatch) throw new Error("D1 unavailable");
        db.exec("BEGIN");
        try {
          for (const statement of statements) db.prepare(statement.sql).run(...statement.values);
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        if (state.lostCommitResponse) throw new Error("Commit response lost");
        return [];
      },
    },
    SITE_ASSETS: {
      async put(key: string, content: Uint8Array) {
        objects.set(key, content);
        if (state.failPut) throw new Error("R2 put response lost");
      },
      async delete(keys: string[]) {
        if (state.failDelete) throw new Error("R2 delete unavailable");
        keys.forEach((key) => objects.delete(key));
      },
    },
  } as unknown as Env;
  vi.spyOn(console, "error").mockImplementation(() => {});
  return { db, env, objects, state };
}

const raw = [
  "From: Sender <sender@example.com>", "To: owner@me3.app", "Subject: Nested MIME",
  'Content-Type: multipart/mixed; boundary="outer.+"', "", "preamble",
  "--outer.+", 'Content-Type: multipart/alternative; boundary="alternative"', "",
  "--alternative", "Content-Type: text/plain; charset=utf-8", "", "Plain body",
  "--alternative", 'Content-Type: multipart/related; boundary="related"', "",
  "--related", "Content-Type: text/html", "", '<p>HTML body<img src="cid:logo"></p>',
  "--related", 'Content-Type: image/png; name="logo.png"', 'Content-Disposition: inline; filename="logo.png"',
  "Content-ID: <logo>", "Content-Transfer-Encoding: base64", "", "aW1hZ2U=", "--related--",
  "--alternative--", "--outer.+", 'Content-Type: application/pdf; name="file.pdf"',
  'Content-Disposition: attachment; filename="file.pdf"', "Content-Transfer-Encoding: base64", "", "cGRm",
  "--outer.+--", "epilogue",
].join("\r\n");
function message(): ForwardableEmailMessageLike {
  const bytes = new TextEncoder().encode(raw);
  return {
    from: "sender@example.com", to: "owner@me3.app", headers: new Headers(), rawSize: bytes.length,
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    canBeForwarded: false, forward: vi.fn(), setReject: vi.fn(),
  };
}
const managedDelivery = {
  deliveryId: "delivery-test-1", managedInstallationId: "mi-test", coreInstallId: "core_test",
  recipient: "owner@me3.app", bodySha256: "a".repeat(64),
};

describe("inbound MIME and attachment persistence", () => {
  it.each([false, true])("preserves nested MIME on direct/managed delivery (%s)", async (managed) => {
    const { db, env, objects } = setup();
    if (managed) expect((await deliverInboundEmail(message(), env, { managedDelivery })).status).toBe("accepted");
    else { const incoming = message(); await handleInboundEmail(incoming, env); expect(incoming.setReject).not.toHaveBeenCalled(); }
    const row = db.prepare("SELECT * FROM mailbox_messages").get()!;
    expect(row.text_body).toBe("Plain body");
    expect(row.html_body).toBe('<p>HTML body<img src="cid:logo"></p>');
    const attachments = JSON.parse(String(row.metadata_json)).attachments;
    expect(attachments).toMatchObject([{ filename: "logo.png", disposition: "inline", contentId: "<logo>" }, { filename: "file.pdf" }]);
    expect([...objects.values()].map((value) => new TextDecoder().decode(value))).toEqual(["image", "pdf"]);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });

  it.each(["failBatch", "failPut"] as const)("cleans every staged key after %s", async (failure) => {
    const { db, env, objects, state } = setup(); state[failure] = true;
    expect((await deliverInboundEmail(message(), env, { managedDelivery })).status).toBe("unavailable");
    expect(objects.size).toBe(0);
    expect(db.prepare("SELECT * FROM mailbox_messages").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });

  it("marks the sending contact as in touch without copying the email", async () => {
    const { db, env } = setup();
    db.exec(`INSERT INTO contacts (id, user_id, name, email, last_interaction_at) VALUES
      ('sender', 'owner', 'Sender', 'Sender@Example.com', '2026-01-01T00:00:00.000Z'),
      ('other', 'owner', 'Other', 'other@example.com', NULL)`);
    expect((await deliverInboundEmail(message(), env, { managedDelivery })).status).toBe("accepted");
    const rows = db.prepare("SELECT id, last_interaction_at, notes, metadata FROM contacts ORDER BY id").all() as Array<Record<string, string | null>>;
    expect(Date.now() - Date.parse(String(rows[1].last_interaction_at))).toBeLessThan(60_000);
    expect(rows[0].last_interaction_at).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Plain body");
  });

  it("retains cleanup work when R2 deletion fails and reconciles it later", async () => {
    const { db, env, objects, state } = setup(); state.failBatch = state.failDelete = true;
    await deliverInboundEmail(message(), env, { managedDelivery });
    expect(objects.size).toBe(2);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(1);
    state.failDelete = false;
    await reconcileMailboxAttachmentStaging(env, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(objects.size).toBe(0);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });

  it("preserves committed attachments after a lost D1 response", async () => {
    const { db, env, objects, state } = setup(); state.lostCommitResponse = true;
    expect((await deliverInboundEmail(message(), env, { managedDelivery })).status).toBe("duplicate");
    expect(objects.size).toBe(2);
    expect(db.prepare("SELECT * FROM mailbox_messages").all()).toHaveLength(1);
  });

  it.each([false, true])("cleans only the losing delivery in duplicate/conflict races (%s)", async (conflict) => {
    const { db, env, objects } = setup();
    // Both requests get past the preflight before either can commit.
    const results = await Promise.all([
      deliverInboundEmail(message(), env, { managedDelivery }),
      deliverInboundEmail(message(), env, { managedDelivery: { ...managedDelivery, bodySha256: conflict ? "b".repeat(64) : managedDelivery.bodySha256 } }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["accepted", conflict ? "conflict" : "duplicate"]);
    expect(objects.size).toBe(2);
    const row = db.prepare("SELECT metadata_json FROM mailbox_messages").get()!;
    expect(JSON.parse(String(row.metadata_json)).attachments.every((attachment: any) => objects.has(attachment.storageKey))).toBe(true);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });
});
