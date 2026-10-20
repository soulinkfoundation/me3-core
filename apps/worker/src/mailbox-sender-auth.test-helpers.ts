import { canonicalizeBodyRelaxed, dkimHeaderSigningInput, splitMessage } from "./mailbox-sender-auth";

/** Test-only DKIM signer (relaxed/relaxed, rsa-sha256) with its matching DNS resolver. */
const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export async function testDkimSigner(domain = "gmail.test") {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = encode(await crypto.subtle.exportKey("spki", keys.publicKey));
  const resolveTxt = async (name: string) => name === `s1._domainkey.${domain}` ? [`v=DKIM1; k=rsa; p=${publicKey}`] : [];
  async function sign(message: string, options: { domain?: string; headers?: string } = {}) {
    const raw = message.replace(/\r?\n/g, "\r\n");
    const { headers, body } = splitMessage(raw);
    const bodyHash = encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeBodyRelaxed(body))));
    const h = options.headers || "from:to:subject:date";
    const unsigned = `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=${options.domain || domain}; s=s1;\r\n\th=${h}; bh=${bodyHash};\r\n\tb=\r\n`;
    const signature = { name: "DKIM-Signature", raw: unsigned };
    const input = dkimHeaderSigningInput(headers, signature, h.split(":"), true);
    const b = encode(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input)));
    return unsigned.replace("b=\r\n", `b=${b.slice(0, 40)}\r\n\t${b.slice(40)}\r\n`) + raw;
  }
  return { sign, resolveTxt };
}
