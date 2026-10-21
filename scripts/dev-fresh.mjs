// Local first-run loop: wipe local state, start a brand-new owner, and seed one
// other ME3 user ("Kieran (stand-in)") with a free 20-minute call.
//
//   pnpm dev:fresh                 wipe, migrate, start, seed (sandbox ME3 Cloud)
//   pnpm dev:fresh -- --cloud=none skip ME3 Cloud; password setup only
//   pnpm dev:fresh -- --no-standin start only the fresh owner
//
// State lives in apps/worker/.wrangler/fresh, separate from `pnpm dev` state.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerDir = resolve(root, "apps/worker");
const stateRoot = resolve(workerDir, ".wrangler/fresh");
const config = "wrangler.core.example.toml";

const CLOUD_ORIGINS = {
  sandbox: "https://me3-app-sandbox.kieranbutler22.workers.dev",
  none: "http://127.0.0.1:9", // Unreachable on purpose: Cloud features stay off.
};

const args = process.argv.slice(2);
const cloudArg = args.find((arg) => arg.startsWith("--cloud="))?.split("=")[1] || "sandbox";
const withStandin = !args.includes("--no-standin");
if (!(cloudArg in CLOUD_ORIGINS)) {
  console.error(`Unknown --cloud=${cloudArg}. Use sandbox or none.`);
  process.exit(1);
}
const cloudOrigin = CLOUD_ORIGINS[cloudArg];

const owner = {
  label: "owner",
  workerPort: 8787,
  inspectorPort: 9329,
  webOrigin: "http://localhost:4000",
  apiOrigin: "http://localhost:8787",
  state: resolve(stateRoot, "owner"),
};
const standin = {
  label: "kieran",
  workerPort: 8788,
  inspectorPort: 9330,
  webOrigin: "http://localhost:8788",
  apiOrigin: "http://localhost:8788",
  state: resolve(stateRoot, "standin"),
};

const STANDIN = {
  email: "kieran-standin@example.test",
  password: "local-standin-password",
  name: "Kieran (stand-in)",
  username: "kieran",
  bio: "Builds ME3. Book a free 20-minute call to talk about your site or your assistant.",
  offerId: "intro-call",
};

const children = [];
let shuttingDown = false;

async function main() {
  const busy = [];
  for (const port of [4000, owner.workerPort, ...(withStandin ? [standin.workerPort] : [])]) {
    if (await portInUse(port)) busy.push(port);
  }
  if (busy.length) {
    throw new Error(
      `Port ${busy.join(", ")} already in use. Stop the other ME3 dev server (Ctrl+C in its terminal) and rerun.`,
    );
  }

  step("Wiping local first-run state");
  rmSync(stateRoot, { recursive: true, force: true });

  await run("node", ["scripts/create-dev-vars.mjs"], root);

  step("Applying D1 migrations");
  for (const instance of withStandin ? [owner, standin] : [owner]) {
    await run(
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "apply", "me3-core-db", "--local", "--config", config, "--persist-to", instance.state],
      workerDir,
      { CI: "1", ...wranglerEnv() },
    );
  }

  step("Starting workers and web app");
  startWorker(owner, { ME3_CLOUD_ORIGIN: cloudOrigin });
  if (withStandin) startWorker(standin, { ME3_CLOUD_ORIGIN: CLOUD_ORIGINS.none, ME3_SITE_USERNAME: STANDIN.username });
  children.push(start("pnpm", ["exec", "vite", "--port", "4000", "--strictPort"], resolve(root, "apps/web"), "web"));

  await waitForOk(`http://127.0.0.1:${owner.workerPort}/health`);
  await waitForOk(`${owner.webOrigin}/`);

  if (withStandin) {
    await waitForOk(`http://127.0.0.1:${standin.workerPort}/health`);
    step("Seeding Kieran (stand-in) with a free 20-minute call");
    await seedStandin();
  }

  const setupCode = readDevVar("SETUP_PASSWORD");
  console.log(`
────────────────────────────────────────────────────────────
 ME3 is running as a brand-new install.

   Open:        ${owner.webOrigin}
   Setup code:  ${setupCode || "(see SETUP_PASSWORD in apps/worker/.dev.vars)"}
   ME3 Cloud:   ${cloudArg === "none" ? "off" : `${cloudArg} (${cloudOrigin})`}
${withStandin ? `   Stand-in:    ${standin.webOrigin}  (${STANDIN.name}, free 20-minute call)\n` : ""}
 Ctrl+C stops everything. Run \`pnpm dev:fresh\` again to start over.
────────────────────────────────────────────────────────────
`);
}

function startWorker(instance, vars) {
  const allVars = {
    CORE_WEB_ORIGIN: instance.webOrigin,
    CORE_API_ORIGIN: instance.apiOrigin,
    ...vars,
  };
  const wranglerArgs = [
    "exec", "wrangler", "dev",
    "--config", config,
    "--port", String(instance.workerPort),
    "--inspector-port", String(instance.inspectorPort),
    "--persist-to", instance.state,
    // The stand-in never chats, so it skips the remote Workers AI connection.
    ...(instance === standin ? ["--name", "me3-core-standin", "--local"] : []),
    ...Object.entries(allVars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ];
  children.push(start("pnpm", wranglerArgs, workerDir, instance.label, wranglerEnv()));
}

async function seedStandin() {
  const origin = `http://127.0.0.1:${standin.workerPort}`;
  const bootstrap = await request(`${origin}/api/admin/bootstrap`, {
    method: "POST",
    body: {
      bootstrapCode: readDevVar("SETUP_PASSWORD"),
      email: STANDIN.email,
      name: STANDIN.name,
      username: STANDIN.username,
      bio: STANDIN.bio,
      password: STANDIN.password,
    },
  });
  const cookie = bootstrap.cookie;
  if (!cookie) throw new Error("Stand-in bootstrap did not return a session cookie");

  const sites = await request(`${origin}/api/sites`, { cookie });
  const existing = (sites.body.sites || []).find((site) => site.username === STANDIN.username);
  if (!existing) {
    await request(`${origin}/api/sites`, {
      method: "POST",
      cookie,
      body: { username: STANDIN.username, siteRole: "profile" },
    });
  }

  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const profile = {
    version: "0.1",
    name: STANDIN.name,
    handle: STANDIN.username,
    bio: STANDIN.bio,
    visibility: "public",
    intents: {
      book: {
        enabled: true,
        title: "Book a call",
        description: "Pick a time that suits you.",
        duration: 20,
        availability: {
          timezone: "Europe/Dublin",
          windows: Object.fromEntries(weekdays.map((day) => [day, ["08:00-20:00"]])),
        },
        offers: [
          {
            id: STANDIN.offerId,
            title: "Free 20-minute call",
            description: "A quick call to talk through your site or your assistant.",
            duration: 20,
            meetingProvider: "none",
          },
        ],
      },
    },
  };
  const form = new FormData();
  form.append("files", new File([JSON.stringify(profile)], "me.json", { type: "application/json" }));
  await request(`${origin}/api/sites/${STANDIN.username}/upload`, { method: "POST", cookie, form });
  await request(`${origin}/api/sites/${STANDIN.username}/publish`, { method: "POST", cookie, body: {} });

  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const slots = await request(
    `${origin}/api/book/${STANDIN.username}/slots?date=${date}&offerId=${STANDIN.offerId}`,
  );
  if (!Array.isArray(slots.body.slots) || slots.body.slots.length === 0) {
    throw new Error(`Stand-in has no bookable slots on ${date}`);
  }
}

async function request(url, { method = "GET", body, form, cookie } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url} returned ${response.status}: ${text}`);
  return {
    body: text ? JSON.parse(text) : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function run(command, commandArgs, cwd, env = {}) {
  const child = spawn(command, commandArgs, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  return new Promise((resolvePromise, reject) => {
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`)),
    );
    child.on("error", reject);
  });
}

function start(command, commandArgs, cwd, label, env = {}) {
  const child = spawn(command, commandArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1", ...env },
  });
  const prefix = (chunk) =>
    chunk.toString().split(/\r?\n/).filter(Boolean).map((line) => `[${label}] ${line}`).join("\n") + "\n";
  child.stdout.on("data", (chunk) => process.stdout.write(prefix(chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefix(chunk)));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${label}] exited (${signal || code}); stopping.`);
    process.exit(1);
  });
  return child;
}

async function portInUse(port) {
  return (await portOpen("127.0.0.1", port)) || (await portOpen("::1", port));
}

function portOpen(host, port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("error", () => resolvePromise(false));
  });
}

async function waitForOk(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

// Workers AI runs remotely even in local dev. With several Cloudflare accounts,
// Wrangler needs CLOUDFLARE_ACCOUNT_ID; it may live in apps/worker/.dev.vars.
function wranglerEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || readDevVar("CLOUDFLARE_ACCOUNT_ID");
  return accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {};
}

function readDevVar(name) {
  const file = resolve(workerDir, ".dev.vars");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`))
    .at(-1);
  return line ? line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2") : "";
}

function stopAll() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

process.on("exit", stopAll);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
