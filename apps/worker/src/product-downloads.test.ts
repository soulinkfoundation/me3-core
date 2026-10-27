import { describe, expect, it } from "vitest";
import { claimDownload, issueDownloadToken } from "./product-downloads";
import { COMMERCE_TEST_SCHEMA, sqliteD1 } from "./test-support/sqlite-d1";

const file = { id: "0f1e2d3c-aaaa-bbbb-cccc-111122223333", name: "prompts.pdf", size: 4_200_000, type: "application/pdf" };

async function paidOrder(status = "paid") {
  const db = sqliteD1(COMMERCE_TEST_SCHEMA);
  await db.prepare("INSERT INTO commerce_orders (id, site_id, product_slug, status) VALUES ('order-1', 'site-1', 'pdf', ?)").bind(status).run();
  return db;
}

describe("paid download links", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("works a limited number of times", async () => {
    const db = await paidOrder();
    const token = await issueDownloadToken(db, { orderId: "order-1", siteId: "site-1", file }, now);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    for (let i = 0; i < 5; i++) expect(await claimDownload(db, token, now)).toMatchObject({ siteId: "site-1", fileName: "prompts.pdf", filePath: `private/products/${file.id}.pdf` });
    expect(await claimDownload(db, token, now)).toBeNull();
  });

  it("stops working after it expires", async () => {
    const db = await paidOrder();
    const token = await issueDownloadToken(db, { orderId: "order-1", siteId: "site-1", file }, now);
    expect(await claimDownload(db, token, new Date("2026-11-03T12:00:01Z"))).toBeNull();
  });

  it("never opens for unknown tokens or orders that are no longer paid", async () => {
    const db = await paidOrder("refunded");
    const token = await issueDownloadToken(db, { orderId: "order-1", siteId: "site-1", file }, now);
    expect(await claimDownload(db, token, now)).toBeNull();
    expect(await claimDownload(db, "not-a-real-token-but-long-enough-to-look-like-one-000", now)).toBeNull();
    expect(await claimDownload(db, "../../etc", now)).toBeNull();
  });
});
