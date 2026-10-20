import { describe, expect, it } from "vitest";
import {
  canonicalizeBodyRelaxed,
  canonicalizeBodySimple,
  canonicalizeHeaderRelaxed,
  splitMessage,
  verifyDkim,
} from "./mailbox-sender-auth";
import { testDkimSigner } from "./mailbox-sender-auth.test-helpers";

// Failure modes: a forged From passes because the From line is trusted; a body
// edited after signing still passes; a signature by some other domain counts
// for the owner's address; a second From header slips past the signed one; a
// relaxed canonicalization detail (folding, trailing blank lines) rejects real
// Gmail mail.

const signer = () => testDkimSigner();

const MAIL = [
  "From: Kieran <kieran@gmail.test>",
  "To: me3@me3.test",
  "Subject: Book a table",
  "Date: Tue, 20 Oct 2026 09:00:00 +0000",
  "",
  "Please book Friday at 7.  ",
  "",
  "",
].join("\n");

describe("DKIM canonicalization (RFC 6376 section 3.4.6 example)", () => {
  const raw = "A: X\r\nB : Y\t\r\n\tZ  \r\n\r\n C \r\nD \t E\r\n\r\n\r\n";
  it("relaxes headers", () => {
    const { headers } = splitMessage(raw);
    expect(headers.map(header => canonicalizeHeaderRelaxed(header.raw)).join("")).toBe("a:X\r\nb:Y Z\r\n");
  });
  it("relaxes and simplifies the body", () => {
    const { body } = splitMessage(raw);
    expect(canonicalizeBodyRelaxed(body)).toBe(" C\r\nD E\r\n");
    expect(canonicalizeBodySimple(body)).toBe(" C \r\nD \t E\r\n");
    expect(canonicalizeBodyRelaxed("")).toBe("");
    expect(canonicalizeBodySimple("")).toBe("\r\n");
  });
});

describe("verifyDkim", () => {
  it("passes a signature from the From domain", async () => {
    const { sign, resolveTxt } = await signer();
    expect(await verifyDkim(await sign(MAIL), { resolveTxt })).toEqual({ dkim: "pass", domain: "gmail.test" });
  });

  it("fails when the body or a signed header changed after signing", async () => {
    const { sign, resolveTxt } = await signer();
    const signed = await sign(MAIL);
    expect((await verifyDkim(signed.replace("Friday", "Saturday"), { resolveTxt })).dkim).toBe("fail");
    expect((await verifyDkim(signed.replace("Subject: Book a table", "Subject: Pay this invoice"), { resolveTxt })).dkim).toBe("fail");
  });

  it("fails a valid signature from another domain, an unsigned From and a second From", async () => {
    const { sign, resolveTxt } = await signer();
    const other = await sign(MAIL.replace("kieran@gmail.test", "kieran@owner.test"));
    expect(await verifyDkim(other, { resolveTxt })).toMatchObject({ dkim: "fail", reason: "Signing domain does not match the From address" });
    expect(await verifyDkim(await sign(MAIL, { headers: "to:subject" }), { resolveTxt })).toMatchObject({ dkim: "fail", reason: "From is not signed" });
    const doubled = (await sign(MAIL)).replace("From: Kieran", "From: attacker@evil.test\r\nFrom: Kieran");
    expect((await verifyDkim(doubled, { resolveTxt })).dkim).toBe("none");
  });

  it("treats unsigned mail and a missing key as not verified", async () => {
    const { sign } = await signer();
    expect(await verifyDkim(MAIL, { resolveTxt: async () => [] })).toMatchObject({ dkim: "none" });
    expect((await verifyDkim(await sign(MAIL), { resolveTxt: async () => [] })).dkim).toBe("fail");
  });

  it("survives headers added above the signature in transit, as Cloudflare does", async () => {
    const { sign, resolveTxt } = await signer();
    const relayed = `Received: from mx.example by mx.cloudflare.net\r\nARC-Authentication-Results: i=1; dkim=pass\r\n${await sign(MAIL)}`;
    expect((await verifyDkim(relayed, { resolveTxt })).dkim).toBe("pass");
  });
});
