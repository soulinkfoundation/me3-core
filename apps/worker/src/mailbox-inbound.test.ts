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
function message(content = raw, overrides: Partial<ForwardableEmailMessageLike> = {}): ForwardableEmailMessageLike {
  const bytes = new TextEncoder().encode(content);
  return {
    from: "sender@example.com", to: "owner@me3.app", headers: new Headers(), rawSize: bytes.length,
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    canBeForwarded: false, forward: vi.fn(), setReject: vi.fn(), ...overrides,
  };
}
function invoiceWithPdf(pdfBytes: number, html = "<p>Invoice attached</p>") {
  const pdf = btoa("%PDF-".padEnd(pdfBytes, "x")).replace(/.{76}/g, "$&\r\n");
  return [
    "From: Stripe <invoices@stripe.com>", "To: owner@me3.app", "Subject: Your invoice",
    "Message-ID: <invoice-1@stripe.com>", 'Content-Type: multipart/mixed; boundary="b1"', "",
    "--b1", "Content-Type: text/html; charset=utf-8", "", html,
    "--b1", 'Content-Type: application/pdf; name="invoice.pdf"', 'Content-Disposition: attachment; filename="invoice.pdf"',
    "Content-Transfer-Encoding: base64", "", pdf, "--b1--",
  ].join("\r\n");
}
const oversizedHeaders = () => new Headers({ from: "Client <client@example.com>", subject: "Huge scans", "message-id": "<huge-1@example.com>" });
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
    const metadata = JSON.parse(String(row.metadata_json));
    expect(row.raw_message).toBeNull();
    expect(metadata.rawStorageKey).toMatch(/^mailbox\/mailbox-1\/messages\/.+\/raw\.eml$/);
    expect(new TextDecoder().decode(objects.get(metadata.rawStorageKey))).toBe(raw);
    expect([...objects].filter(([key]) => !key.endsWith("raw.eml")).map(([, value]) => new TextDecoder().decode(value))).toEqual(["image", "pdf"]);
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
    expect(objects.size).toBe(3);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(1);
    state.failDelete = false;
    await reconcileMailboxAttachmentStaging(env, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(objects.size).toBe(0);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });

  it("preserves committed attachments after a lost D1 response", async () => {
    const { db, env, objects, state } = setup(); state.lostCommitResponse = true;
    expect((await deliverInboundEmail(message(), env, { managedDelivery })).status).toBe("duplicate");
    expect(objects.size).toBe(3);
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
    expect(objects.size).toBe(3);
    const row = db.prepare("SELECT metadata_json FROM mailbox_messages").get()!;
    expect(JSON.parse(String(row.metadata_json)).attachments.every((attachment: any) => objects.has(attachment.storageKey))).toBe(true);
    expect(db.prepare("SELECT * FROM mailbox_attachment_staging").all()).toHaveLength(0);
  });
});

describe("large and oversized inbound mail", () => {
  it("stores a multi-megabyte PDF invoice with raw MIME in R2, not D1", async () => {
    const { db, env, objects } = setup();
    const incoming = message(invoiceWithPdf(3 * 1024 * 1024));
    await handleInboundEmail(incoming, env);
    expect(incoming.setReject).not.toHaveBeenCalled();
    const row = db.prepare("SELECT * FROM mailbox_messages").get()!;
    expect(row).toMatchObject({ status: "received", subject: "Your invoice", raw_message: null });
    const metadata = JSON.parse(String(row.metadata_json));
    expect(metadata.attachments).toMatchObject([{ filename: "invoice.pdf", mimeType: "application/pdf", size: 3 * 1024 * 1024 }]);
    const pdf = objects.get(metadata.attachments[0].storageKey)!;
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(objects.get(metadata.rawStorageKey)!.byteLength).toBe(incoming.rawSize);
  });

  it("keeps D1 bodies under the row limit when the HTML part is huge", async () => {
    const { db, env } = setup();
    const html = `<p>${"newsletter ".repeat(100_000)}</p>`;
    expect((await deliverInboundEmail(message(invoiceWithPdf(10, html)), env)).status).toBe("accepted");
    const row = db.prepare("SELECT * FROM mailbox_messages").get()!;
    expect(row.html_body).toBeNull();
    expect(new TextEncoder().encode(String(row.text_body)).byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({ htmlBodyOmitted: true, textBodyTruncated: true });
  });

  it("forwards mail over 25 MB to the forwarding address and records a stub", async () => {
    const { db, env } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.exec("UPDATE mailbox_aliases SET forwarding_email = 'owner@gmail.com', forwarding_enabled = 1");
    const incoming = message("x", { rawSize: 26 * 1024 * 1024, canBeForwarded: true, headers: oversizedHeaders() });
    await handleInboundEmail(incoming, env);
    expect(incoming.forward).toHaveBeenCalledWith("owner@gmail.com");
    expect(incoming.setReject).not.toHaveBeenCalled();
    const row = db.prepare("SELECT * FROM mailbox_messages").get()!;
    expect(row).toMatchObject({
      status: "forwarded", forwarded_to: "owner@gmail.com", folder: "inbox",
      from_address: "client@example.com", subject: "Huge scans", raw_message: null,
    });
    expect(String(row.text_body)).toContain("forwarded to owner@gmail.com");
    expect(JSON.parse(String(row.metadata_json))).toMatchObject({ oversized: true, rawSize: 26 * 1024 * 1024 });
  });

  it("rejects oversized mail without forwarding but leaves the owner a stub", async () => {
    const { db, env } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const incoming = message("x", { rawSize: 26 * 1024 * 1024, canBeForwarded: true, headers: oversizedHeaders() });
    await handleInboundEmail(incoming, env);
    expect(incoming.forward).not.toHaveBeenCalled();
    expect(incoming.setReject).toHaveBeenCalledWith(expect.stringContaining("25 MB"));
    const row = db.prepare("SELECT * FROM mailbox_messages").get()!;
    expect(row).toMatchObject({ status: "dropped", subject: "Huge scans" });
    expect(String(row.error_message)).toContain("limit is 25 MB");
  });

  it("rejects with a stub when forwarding itself fails", async () => {
    const { db, env } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.exec("UPDATE mailbox_aliases SET forwarding_email = 'owner@gmail.com', forwarding_enabled = 1");
    const incoming = message("x", {
      rawSize: 26 * 1024 * 1024, canBeForwarded: true, headers: oversizedHeaders(),
      forward: vi.fn(async () => { throw new Error("destination unverified"); }),
    });
    await handleInboundEmail(incoming, env);
    expect(incoming.setReject).toHaveBeenCalled();
    expect(db.prepare("SELECT status FROM mailbox_messages").get()).toMatchObject({ status: "dropped" });
  });

  it("keeps the 1 MB inline limit without R2 and forwards larger mail", async () => {
    const { db, env } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    delete (env as { SITE_ASSETS?: unknown }).SITE_ASSETS;
    db.exec("UPDATE mailbox_aliases SET forwarding_email = 'owner@gmail.com', forwarding_enabled = 1");
    const incoming = message(invoiceWithPdf(1024 * 1024), { canBeForwarded: true });
    await handleInboundEmail(incoming, env);
    expect(incoming.forward).toHaveBeenCalledWith("owner@gmail.com");
    expect(incoming.setReject).not.toHaveBeenCalled();
    expect(db.prepare("SELECT status, subject FROM mailbox_messages").get()).toMatchObject({ status: "forwarded", subject: "(no subject)" });
  });
});
