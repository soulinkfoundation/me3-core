// End-to-end smoke for the free runtime, run locally in workerd (wrangler dev) with real Durable Object SQLite.
// Simulated: ME3 Cloud (a local JWKS server signs the hosted mobile session). Real: Core, the agent, Workers AI.
// Usage: CLOUDFLARE_ACCOUNT_ID=<sandbox account> pnpm smoke      (SMOKE_SKIP_CHAT=1 skips the model call)
// Leaves smoke-report.json. Reset: the state directory is created fresh in the OS temp dir on every run.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync, createSign, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT || 8931);
const CLOUD_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CLOUD = `http://127.0.0.1:${CLOUD_PORT}`;
const SERVICE_TOKEN = `smoke-${randomUUID()}`;
const MODEL = process.env.SMOKE_CHAT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const skipChat = process.env.SMOKE_SKIP_CHAT === "1";
const state = mkdtempSync(join(tmpdir(), "me3-free-smoke-"));
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` -> ${JSON.stringify(detail)}`}`); };

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "smoke", alg: "RS256", use: "sig" };
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
function hostedSession(sub, installIds) {
  const body = `${b64({ alg: "RS256", kid: "smoke", typ: "JWT" })}.${b64({ iss: CLOUD, sub, exp: Math.floor(Date.now() / 1000) + 300, typ: "me3_mobile_hosted_session", aud: "me3-mobile-hosted-session", scope: "mobile.v1", install_ids: installIds })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
}
const cloud = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/api/profile/starter")) {
    const authorised = req.headers.authorization === `Bearer ${SERVICE_TOKEN}`;
    res.statusCode = authorised ? 200 : 401;
    return res.end(JSON.stringify({ ok: authorised, forwardedFor: req.headers["x-me3-free-runtime-user"], path: req.url }));
  }
  res.end(req.url === "/.well-known/jwks.json" ? JSON.stringify({ keys: [jwk] }) : "{}");
}).listen(CLOUD_PORT, "127.0.0.1");

let wrangler;
async function start() {
  wrangler = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT), "--inspector-port", String(PORT + 408), "--persist-to", state,
    "--var", "ENVIRONMENT:local", "--var", `FREE_RUNTIME_SERVICE_TOKEN:${SERVICE_TOKEN}`, "--var", `ME3_CLOUD_API_ORIGIN:${CLOUD}`,
    "--var", "ME3_AI_CHAT_PROVIDER:workers-ai", "--var", `ME3_AI_CHAT_MODEL:${MODEL}`, "--var", `ME3_AGENT_FAST_MODEL:${MODEL}`, ...(process.env.SMOKE_AFTER_TURN === "on" ? [] : ["--var", "ME3_AGENT_MEMORY:off", "--var", "ME3_AGENT_SUGGESTED_REPLIES:off"])],
    { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  wrangler.stdout.on("data", (chunk) => { log += chunk; });
  wrangler.stderr.on("data", (chunk) => { log += chunk; });
  for (let i = 0; i < 120; i++) {
    if (log.includes("Ready on")) return;
    if (/\[ERROR\]/.test(log) || wrangler.exitCode !== null) throw new Error(`wrangler dev failed:\n${log.slice(-1500)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("wrangler dev did not start");
}
async function stop() {
  if (!wrangler) return;
  try { process.kill(-wrangler.pid, "SIGTERM"); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try { process.kill(-wrangler.pid, "SIGKILL"); } catch {}
  wrangler = undefined;
}
const call = async (path, { method = "GET", token, body, headers } = {}) => {
  const response = await fetch(`${BASE}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
};
const activate = (userId, extra = {}) => call("/internal/activate", { method: "POST", token: SERVICE_TOKEN, body: { userId, email: `${userId}@example.test`, name: userId, handle: userId, ...extra } });
const claim = (userId, installId, sub = userId, device = "smoke-device") => call(`/u/${userId}/api/mobile/token`, { method: "POST", body: { grant_type: "me3_app_claim", installId, me3SessionToken: hostedSession(sub, [installId]), device: { id: device, name: "Smoke", platform: "ios" } } });

let failed = false;
try {
  await start();
  check("health", (await call("/health")).json?.ok === true);
  check("activation needs the service token", (await call("/internal/activate", { method: "POST", token: "wrong", body: { userId: "alice" } })).status === 401);
  check("a user nobody activated has no ME3", (await call("/u/mallory/api/account")).status === 404);
  check("a user nobody activated stores nothing", (await call("/internal/status?userId=mallory", { token: SERVICE_TOKEN })).status === 404);

  const alice = await activate("alice");
  const bob = await activate("bob");
  check("activation returns an install id and base URL", /^core_/.test(alice.json?.installId) && alice.json?.apiBaseURL === `${BASE}/u/alice`, alice.json);
  check("activation is repeatable", (await activate("alice")).json?.installId === alice.json?.installId);
  check("users get different installs", alice.json?.installId !== bob.json?.installId);

  const aliceTokens = await claim("alice", alice.json.installId);
  check("mobile sign-in with a Cloud session issues Core tokens", aliceTokens.status === 200 && aliceTokens.json?.accessToken && aliceTokens.json?.refreshToken, aliceTokens.json ?? aliceTokens.text);
  const token = aliceTokens.json.accessToken;
  check("sign-in tells the app the user's own base URL", aliceTokens.json?.install?.apiBaseURL === `${BASE}/u/alice/api`, aliceTokens.json?.install);
  check("sign-in advertises only free features", !aliceTokens.json?.install?.capabilities?.includes("mailbox") && !aliceTokens.json?.install?.capabilities?.includes("sites") && aliceTokens.json?.install?.capabilities?.includes("assistant"), aliceTokens.json?.install?.capabilities);
  check("the public link is the user's ME3 page, not the runtime", /\/alice$/.test(aliceTokens.json?.install?.publicURL ?? "") && !aliceTokens.json.install.publicURL.includes(String(PORT)), aliceTokens.json?.install?.publicURL);
  const account = await call("/u/alice/api/account", { token });
  check("the signed-in user is the activated owner", account.status === 200 && JSON.stringify(account.json).includes("alice@example.test"), account.json ?? account.text);

  check("another Cloud user cannot claim alice's ME3", (await claim("alice", alice.json.installId, "bob")).status === 403);
  check("alice's Cloud session cannot claim bob's ME3", (await claim("bob", alice.json.installId, "alice")).status === 403);
  check("alice's Core token is not valid in bob's ME3", (await call("/u/bob/api/account", { token })).status === 401);
  check("requests without credentials are refused", (await call("/u/alice/api/account")).status === 401);

  for (const [name, path, method] of [["mailbox", "/api/mailbox/messages", "GET"], ["sites", "/api/sites/alice/content", "GET"], ["password setup", "/api/admin/bootstrap", "POST"], ["AI settings", "/api/ai-settings", "GET"], ["file upload", "/api/assistant/attachments", "POST"], ["MCP", "/mcp", "POST"]]) {
    const blocked = await call(`/u/alice${path}`, { method, token, body: method === "POST" ? {} : undefined });
    check(`paid or setup route is off: ${name}`, blocked.status === 403 && blocked.json?.code === "upgrade_required", blocked.status);
  }
  check("batch cannot reach a paid route", (await call("/u/alice/api/batch", { method: "POST", token, body: { requests: ["/api/mailbox/messages"] } })).status === 403);
  check("internal object paths are not reachable from outside", (await call("/u/alice/__free/status", { token })).status === 404);

  const thread = await call("/u/alice/api/assistant/threads/primary", { method: "POST", token, body: {} });
  check("main chat thread resolves", thread.status === 200 && thread.json?.thread?.id, thread.json ?? thread.text);
  check("the free page editor needs the owner's sign-in", (await call("/u/alice/api/free/page")).status === 401);
  const page = await call("/u/alice/api/free/page", { token });
  check("the free page editor forwards to ME3 Cloud as the user", page.status === 200 && page.json?.forwardedFor === "alice" && page.json?.path === "/api/profile/starter", page.json ?? page.text);
  const plugins = await call("/u/alice/api/plugins", { token });
  const pluginIds = (plugins.json?.plugins ?? []).map((plugin) => plugin.id).sort();
  check("the app's menu source lists only free features", plugins.status === 200 && pluginIds.join() === "me3.agent-chat,me3.calendar,me3.journal,me3.mission-control", plugins.json ?? plugins.text);
  check("a free user cannot switch on a paid plugin", (await call("/u/alice/api/plugins/me3.accounts/activate", { method: "POST", token, body: {} })).status === 403);
  const sitesList = await call("/u/alice/api/sites", { token });
  check("Home can read an empty site list", sitesList.status === 200 && Array.isArray(sitesList.json?.sites) && sitesList.json.sites.length === 0, sitesList.json ?? sitesList.text);
  check("Home can read the contact list", (await call("/u/alice/api/contacts", { token })).status === 200);
  check("creating a site stays a paid feature", (await call("/u/alice/api/sites", { method: "POST", token, body: {} })).status === 403);
  const tour = await call("/u/alice/api/assistant/tour", { token });
  check("the first-run tour has only the Home step", tour.status === 200 && tour.json?.steps?.map((step) => step.id).join() === "home", tour.json ?? tour.text);
  const goals = await call("/u/alice/api/tasks/goals", { token });
  check("goals API works", goals.status === 200, goals.text.slice(0, 200));
  const journal = await call("/u/alice/api/journal/articles", { token });
  check("journal API works", journal.status === 200, journal.text.slice(0, 200));

  let chat = null;
  if (!skipChat) {
    const turn = await call("/u/alice/api/assistant/chat/turn/stream", { method: "POST", token, body: { threadId: thread.json.thread.id, requestId: `smoke-${randomUUID()}`, messageText: process.env.SMOKE_CHAT_TEXT || "Reply with the single word: ready", model: { providerId: "anthropic", model: "claude-opus-5-5" } } });
    const done = /event: done\ndata: (.*)/.exec(turn.text);
    chat = done ? JSON.parse(done[1]) : null;
    check("a chat turn completes", chat?.ok === true && typeof chat.replyText === "string" && chat.replyText.length > 0, turn.text.slice(-600));
    check("the client's model choice is ignored", chat?.model === MODEL, chat?.model);
  }
  const budgetCall = (body) => call("/internal/budget", { method: body ? "POST" : "GET", token: SERVICE_TOKEN, body });
  const sendChat = (text) => call("/u/alice/api/assistant/chat/turn/stream", { method: "POST", token, body: { threadId: thread.json.thread.id, requestId: `smoke-${randomUUID()}`, messageText: text } });
  const limitOf = (turn) => { const done = /event: done\ndata: (.*)/.exec(turn.text); return done ? JSON.parse(done[1]).limit ?? null : "no-done-event"; };
  check("budget needs the service token", (await call("/internal/budget", { token: "wrong" })).status === 401);
  const before = await budgetCall();
  check("budget starts at $100 a day and 20 messages", before.json?.dailyBudgetUsd === 100 && before.json?.perUserDailyMessages === 20 && before.json?.paused === false, before.json);
  await budgetCall({ paused: true });
  check("kill switch pauses free chat with a normal reply", limitOf(await sendChat("hello")) === "paused");
  await budgetCall({ paused: false, dailyBudgetUsd: 0 });
  check("an exhausted budget pauses free chat", limitOf(await sendChat("hello")) === "budget");
  const used = (await call("/internal/status?userId=alice", { token: SERVICE_TOKEN })).json?.chatCount ?? 0;
  await budgetCall({ dailyBudgetUsd: 100, perUserDailyMessages: used });
  check("a user at their daily messages gets the limit reply", limitOf(await sendChat("hello")) === "user");
  await budgetCall({ perUserDailyMessages: 20 });
  if (!skipChat) {
    check("chat works again once limits are restored", limitOf(await sendChat("Reply with the single word: ready")) === null);
    const spent = await budgetCall();
    check("model spend reaches the global ledger", spent.json?.spentUsd > 0, spent.json);
  }
  const bobTokens = await claim("bob", bob.json.installId);
  const bobThread = await call("/u/bob/api/assistant/threads/primary", { method: "POST", token: bobTokens.json?.accessToken, body: {} });
  check("bob's chat is separate from alice's", bobThread.json?.thread?.id && bobThread.json.thread.id !== thread.json.thread.id && bobThread.json.thread.lastMessageAt === null, bobThread.json);
  const status = await call("/internal/status?userId=alice", { token: SERVICE_TOKEN });
  check("a per-user timer is armed after use", status.json?.nextTickAt > Date.now(), status.json);

  await stop();
  await start();
  const refreshed = await call("/u/alice/api/mobile/token/refresh", { method: "POST", body: { refreshToken: aliceTokens.json.refreshToken, refresh_token: aliceTokens.json.refreshToken, device: { id: "smoke-device" }, deviceId: "smoke-device" } });
  check("after a restart the refresh token still signs in", refreshed.status === 200 && refreshed.json?.accessToken, refreshed.json ?? refreshed.text);
  const again = await call("/u/alice/api/assistant/threads/primary", { method: "POST", token: refreshed.json?.accessToken, body: {} });
  check("after a restart the same thread is there", again.json?.thread?.id === thread.json.thread.id && (skipChat || again.json.thread.lastMessageAt !== null), again.json);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await stop();
  cloud.close();
}
const report = {
  ranAt: new Date().toISOString(),
  revision: execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
  dirty: execSync("git status --porcelain", { cwd: root }).toString().trim().length > 0,
  command: `${skipChat ? "SMOKE_SKIP_CHAT=1 " : ""}pnpm smoke`,
  simulated: ["ME3 Cloud JWKS and hosted mobile session"],
  model: skipChat ? null : MODEL,
  stateDirectory: state,
  passed: checks.filter((item) => item.pass).length,
  failed: checks.filter((item) => !item.pass).length,
  checks,
};
writeFileSync(join(root, "smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${report.passed} passed, ${report.failed} failed. Report: apps/free-runtime/smoke-report.json`);
process.exit(failed || report.failed ? 1 : 0);
