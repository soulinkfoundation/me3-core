#!/usr/bin/env node
/**
 * Measures how fast an ME3 install answers the requests every page makes.
 *
 *   pnpm perf:check -- --host https://kieran.me3.app [--cookie "me3_session=..."] [--runs 3] [--json]
 *
 * Exits 1 when a request is slower than its budget, so a release can be
 * checked before it is tagged. Pass a session cookie to time the signed-in
 * API reads as well; without one those are reported but not judged.
 */
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const host = (option("host", process.env.ME3_PERF_HOST || "")).replace(/\/$/, "");
const cookie = option("cookie", process.env.ME3_PERF_COOKIE || "");
const runs = Number(option("runs", "3"));
const json = args.includes("--json");
if (!host) {
  console.error("Usage: pnpm perf:check -- --host https://your-install.example [--cookie ...] [--runs 3]");
  process.exit(2);
}

// Budgets are time to first byte in milliseconds, measured warm (best of N).
const checks = [
  { name: "SPA shell", path: "/assistant", budgetMs: 400 },
  { name: "health", path: "/health", budgetMs: 400 },
  { name: "brand image", path: "/me3-logo-light.png", budgetMs: 150, expectCache: /max-age=86400/ },
  { name: "dog avatar", path: "/me3-dog-head-emoji-smooth.webp", budgetMs: 150, maxBytes: 40_000 },
  { name: "favicon", path: "/favicon.png", budgetMs: 150, maxBytes: 60_000 },
  { name: "session", path: "/api/auth/me", budgetMs: 400, needsCookie: true },
  { name: "home layout", path: "/api/home/layout", budgetMs: 400, needsCookie: true },
  { name: "mailbox brief", path: "/api/mailbox/brief", budgetMs: 600, needsCookie: true },
];

async function measure(path, withCookie) {
  const startedAt = performance.now();
  const response = await fetch(`${host}${path}`, {
    headers: {
      Accept: path.startsWith("/api/") ? "application/json" : "*/*",
      ...(withCookie && cookie ? { Cookie: cookie } : {}),
    },
    redirect: "manual",
  });
  const ttfbMs = performance.now() - startedAt;
  const bytes = (await response.arrayBuffer()).byteLength;
  return {
    status: response.status,
    ttfbMs,
    totalMs: performance.now() - startedAt,
    bytes,
    cacheControl: response.headers.get("cache-control") || "",
    serverTiming: response.headers.get("server-timing") || "",
  };
}

const rows = [];
let failed = false;
for (const check of checks) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) samples.push(await measure(check.path, check.needsCookie));
  const best = samples.reduce((a, b) => (a.ttfbMs < b.ttfbMs ? a : b));
  const judged = !check.needsCookie || Boolean(cookie);
  const problems = [];
  if (judged && best.status >= 400) problems.push(`status ${best.status}`);
  if (judged && best.ttfbMs > check.budgetMs) problems.push(`ttfb ${Math.round(best.ttfbMs)}ms > ${check.budgetMs}ms`);
  if (check.maxBytes && best.bytes > check.maxBytes) problems.push(`${best.bytes} bytes > ${check.maxBytes}`);
  if (check.expectCache && !check.expectCache.test(best.cacheControl)) problems.push(`cache-control "${best.cacheControl}"`);
  if (problems.length) failed = true;
  rows.push({
    check: check.name,
    path: check.path,
    status: best.status,
    bestTtfbMs: Math.round(best.ttfbMs),
    worstTtfbMs: Math.round(Math.max(...samples.map((s) => s.ttfbMs))),
    bytes: best.bytes,
    workerMs: best.serverTiming.match(/dur=([\d.]+)/)?.[1] ?? "",
    result: judged ? (problems.length ? problems.join("; ") : "ok") : "not signed in",
  });
}

if (json) {
  console.log(JSON.stringify({ host, runs, rows, ok: !failed }, null, 2));
} else {
  console.table(rows);
  console.log(failed ? "perf:check FAILED" : "perf:check ok");
}
process.exit(failed ? 1 : 0);
