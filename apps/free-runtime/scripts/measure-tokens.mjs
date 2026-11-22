// Measures model calls and input tokens per free chat message, run locally in workerd with the production
// chat model (me3-bybb.15). Each user sends one fresh first message, one after another, so the first user
// shows a cold cache and the rest show what users share. Reads the usage receipts from each user's DO SQLite.
// Usage: CLOUDFLARE_ACCOUNT_ID=<account> pnpm --filter @me3-core/free-runtime run measure
//   MEASURE_USERS=4  MEASURE_SHED=on  MEASURE_TEXT="..."  MEASURE_VARS="ME3_FREE_SHED:on"  (extra --var pairs, comma separated)
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.MEASURE_PORT || 8951);
const CLOUD_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVICE_TOKEN = `measure-${randomUUID()}`;
const USERS = Number(process.env.MEASURE_USERS || 4);
const TEXTS = (process.env.MEASURE_TEXT || "Hi! Can you remind me to call Sam tomorrow at 10am?|What should I focus on this week?|Add a task: buy milk|hello").split("|");
const EXTRA = (process.env.MEASURE_VARS || "").split(",").filter(Boolean).flatMap((pair) => ["--var", pair]);
const state = mkdtempSync(join(tmpdir(), "me3-free-measure-"));

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "measure", alg: "RS256", use: "sig" };
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const session = (sub, installId) => {
  const body = `${b64({ alg: "RS256", kid: "measure", typ: "JWT" })}.${b64({ iss: `http://127.0.0.1:${CLOUD_PORT}`, sub, exp: Math.floor(Date.now() / 1000) + 300, typ: "me3_mobile_hosted_session", aud: "me3-mobile-hosted-session", scope: "mobile.v1", install_ids: [installId] })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
};
const cloud = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(req.url === "/.well-known/jwks.json" ? JSON.stringify({ keys: [jwk] }) : "{}");
}).listen(CLOUD_PORT, "127.0.0.1");

const wrangler = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--inspector-port", String(PORT + 408), "--persist-to", state,
  "--var", "ENVIRONMENT:local", "--var", `FREE_RUNTIME_SERVICE_TOKEN:${SERVICE_TOKEN}`, "--var", `ME3_CLOUD_API_ORIGIN:http://127.0.0.1:${CLOUD_PORT}`, ...EXTRA],
  { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
wrangler.stdout.on("data", (chunk) => { log += chunk; });
wrangler.stderr.on("data", (chunk) => { log += chunk; });
const stop = async () => { try { process.kill(-wrangler.pid, "SIGTERM"); } catch {} await new Promise((r) => setTimeout(r, 1500)); try { process.kill(-wrangler.pid, "SIGKILL"); } catch {} };
const call = async (path, { method = "GET", token, body } = {}) => {
  const response = await fetch(`${BASE}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  try { return { status: response.status, json: JSON.parse(text), text }; } catch { return { status: response.status, json: null, text }; }
};

const turns = [];
try {
  for (let i = 0; i < 120 && !log.includes("Ready on"); i++) {
    if (/\[ERROR\]/.test(log) || wrangler.exitCode !== null) throw new Error(`wrangler dev failed:\n${log.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  // MEASURE_SHED=on measures a busy runtime: every message sheds its after-turn calls.
  if (process.env.MEASURE_SHED) await call("/internal/budget", { method: "POST", token: SERVICE_TOKEN, body: { shed: process.env.MEASURE_SHED } });
  for (let n = 0; n < USERS; n++) {
    const userId = `measure${n}`;
    const activated = await call("/internal/activate", { method: "POST", token: SERVICE_TOKEN, body: { userId, email: `${userId}@example.test`, name: `User ${n}`, handle: userId } });
    const tokens = await call(`/u/${userId}/api/mobile/token`, { method: "POST", body: { grant_type: "me3_app_claim", installId: activated.json.installId, me3SessionToken: session(userId, activated.json.installId), device: { id: "measure", name: "Measure", platform: "ios" } } });
    const token = tokens.json.accessToken;
    const thread = await call(`/u/${userId}/api/assistant/threads/primary`, { method: "POST", token, body: {} });
    const text = TEXTS[n % TEXTS.length];
    const turn = await call(`/u/${userId}/api/assistant/chat/turn/stream`, { method: "POST", token, body: { threadId: thread.json.thread.id, requestId: `measure-${randomUUID()}`, messageText: text } });
    const done = /event: done\ndata: (.*)/.exec(turn.text);
    const reply = done ? JSON.parse(done[1]) : null;
    turns.push({ userId, text, reply: reply?.replyText?.slice(0, 120), suggestions: reply?.suggestedReplies?.length ?? 0, memoryCard: Boolean(reply?.memoryReview) });
  }
} finally {
  await stop();
  cloud.close();
}

// Each user's Durable Object keeps its own SQLite file; the receipts are in ai_usage_events.
const dir = join(state, "v3", "do");
const files = readdirSync(dir, { recursive: true }).filter((file) => String(file).endsWith(".sqlite")).map((file) => join(dir, String(file)));
const perFile = files.map((file) => {
  try {
    const out = execFileSync("sqlite3", ["-json", file, "SELECT user_id, model, tokens_in, tokens_out, json_extract(metadata_json,'$.purpose') AS purpose, json_extract(metadata_json,'$.cachedInputTokens') AS cached, json_extract(metadata_json,'$.cacheWriteInputTokens') AS written, created_at FROM ai_usage_events ORDER BY rowid"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() ? JSON.parse(out) : [];
  } catch { return []; }
}).filter((list) => list.length).sort((a, b) => String(a[0].created_at).localeCompare(String(b[0].created_at)));
const summary = perFile.map((list, index) => {
  const user = `user ${index + 1}`;
  // Anthropic counts uncached input (fresh + cache writes) toward the per-minute input limit; cache reads are free of it.
  const uncached = list.reduce((sum, row) => sum + row.tokens_in - (row.cached ?? 0), 0);
  return { user, calls: list.length, inputTokens: list.reduce((s, r) => s + r.tokens_in, 0), uncachedInput: uncached,
    calls_detail: list.map((r) => `${r.purpose ?? "chat"}:${r.tokens_in}in/${r.cached ?? 0}read/${r.written ?? 0}write/${r.tokens_out}out`) };
});
console.log(JSON.stringify({ turns, summary }, null, 2));
