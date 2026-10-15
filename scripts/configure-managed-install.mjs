#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [
  configPath,
  workerName,
  workersDevText,
  managedInstallationId,
  managedEmailGatewayOriginText,
  managedPublicOriginText,
] = process.argv.slice(2);
if (
  !configPath ||
  !workerName ||
  !/^(true|false)$/.test(workersDevText || "") ||
  !managedInstallationId ||
  !managedEmailGatewayOriginText
) {
  throw new Error(
    "usage: configure-managed-install.mjs <wrangler.toml> <worker-name> <true|false> <managed-installation-id> <managed-email-gateway-origin> [managed-public-origin]",
  );
}
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workerName)) {
  throw new Error("managed Worker name is invalid");
}
if (!/^mi-[0-9a-f]{16}$/.test(managedInstallationId)) {
  throw new Error("managed installation id is invalid");
}
if (workerName !== `me3-${managedInstallationId}`) {
  throw new Error("managed Worker name does not match the installation id");
}
const managedEmailGatewayUrl = new URL(managedEmailGatewayOriginText);
if (
  managedEmailGatewayUrl.protocol !== "https:" ||
  managedEmailGatewayUrl.origin !== managedEmailGatewayOriginText ||
  managedEmailGatewayUrl.pathname !== "/" ||
  managedEmailGatewayUrl.search ||
  managedEmailGatewayUrl.hash
) {
  throw new Error("managed email gateway origin must be an explicit HTTPS origin");
}
let managedPublicOrigin;
if (managedPublicOriginText) {
  const url = new URL(managedPublicOriginText);
  if (
    url.protocol !== "https:" ||
    url.origin !== managedPublicOriginText ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.me3\.app$/.test(url.hostname) ||
      (url.hostname.startsWith(`${workerName}.`) &&
        url.hostname.endsWith(".workers.dev"))
    )
  ) {
    throw new Error("managed public origin must be the exact managed HTTPS origin");
  }
  managedPublicOrigin = url.origin;
}

const routes = {
  ME3_MANAGED_INSTALLATION_ID: managedInstallationId,
  ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: managedEmailGatewayUrl.origin,
  ME3_SOCIAL_OAUTH_ORIGIN: "https://api.me3.app",
  ME3_AI_CHAT_PROVIDER: "workers-ai",
  ME3_AI_CHAT_MODEL: "openai/gpt-6.1-sol",
  ME3_AI_CHAT_BACKUP_MODEL: "anthropic/claude-haiku-5.5",
  // Clef sends confident conversation-only turns to Haiku (14 Oct 2026 eval: 10/10 chat turns, 0 tool turns misrouted).
  ME3_AGENT_ROUTING: "on",
  ME3_AGENT_FAST_MODEL: "anthropic/claude-haiku-5.5",
  ME3_WEB_SEARCH_MODEL: "openai/gpt-5.4-mini",
  ME3_AI_REASONING_PROVIDER: "workers-ai",
  ME3_AI_REASONING_MODEL: "@cf/zai-org/glm-5.2",
  ...(managedPublicOrigin
    ? {
        CORE_WEB_ORIGIN: managedPublicOrigin,
        CORE_API_ORIGIN: managedPublicOrigin,
      }
    : {}),
};

let config = readFileSync(configPath, "utf8");
if (!/^name\s*=\s*"[^"]+"/m.test(config)) throw new Error("top-level Worker name missing");
if (!/^ME3_DEPLOYMENT_MODE\s*=.*$/m.test(config)) {
  throw new Error("ME3_DEPLOYMENT_MODE assignment missing");
}
if (/^\s*ME3_AI_RAW_MODEL_SELECTION_ENABLED\s*=/m.test(config)) {
  throw new Error("raw model selection must be absent in a managed install");
}
assertNoPublicRouteDeclarations(config);

config = config.replace(/^name\s*=\s*"[^"]+"/m, `name = "${workerName}"`);
config = config.replace(/^ME3_DEPLOYMENT_MODE\s*=.*$/m, 'ME3_DEPLOYMENT_MODE = "managed"');
for (const key of [
  "ME3_AI_IMAGE_GENERATION_PROVIDER",
  "ME3_AI_IMAGE_GENERATION_MODEL",
]) {
  config = config.replace(new RegExp(`^${key}\\s*=.*(?:\\r?\\n|$)`, "gm"), "");
}
config = config.replace(
  /^(\s*(?:queue|dead_letter_queue)\s*=\s*)"([^"]+)"\s*$/gm,
  (_line, assignment, queueName) => `${assignment}"${managedQueueName(workerName, queueName)}"`,
);

for (const [key, value] of Object.entries(routes).reverse()) {
  const pattern = new RegExp(`^${key}\\s*=.*$`, "gm");
  const matches = [...config.matchAll(pattern)];
  if (matches.length > 1) throw new Error(`duplicate ${key} assignment`);
  if (matches.length === 1) {
    config = config.replace(pattern, `${key} = "${value}"`);
  } else {
    config = config.replace(
      /^ME3_DEPLOYMENT_MODE\s*=.*$/m,
      (line) => `${line}\n${key} = "${value}"`,
    );
  }
}

if (/^workers_dev\s*=/m.test(config)) {
  config = config.replace(/^workers_dev\s*=.*$/m, `workers_dev = ${workersDevText}`);
} else {
  config = config.replace(/^(name\s*=.*)$/m, `$1\nworkers_dev = ${workersDevText}`);
}

writeFileSync(configPath, config);

function managedQueueName(managedWorkerName, sourceQueueName) {
  if (sourceQueueName.startsWith(`${managedWorkerName}-`)) return sourceQueueName;
  if (!/^me3-[a-z0-9-]+$/.test(sourceQueueName)) {
    throw new Error(`managed queue name cannot be derived safely: ${sourceQueueName}`);
  }
  const value = `${managedWorkerName}-${sourceQueueName.slice("me3-".length)}`;
  if (value.length > 63) throw new Error(`managed queue name is too long: ${value}`);
  return value;
}

function assertNoPublicRouteDeclarations(configText) {
  for (const sourceLine of configText.split(/\r?\n/)) {
    const line = stripTomlComment(sourceLine);
    if (!line.trim()) continue;
    const tableHeader = /^\s*\[\[?\s*(.*?)\s*\]\]?\s*$/.exec(line);
    const hasRouteTable = tableHeader?.[1]
      .split(".")
      .map((part) => part.trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2"))
      .some((part) => /^(?:route|routes)$/i.test(part));
    if (
      hasRouteTable ||
      /^\s*(?:route|routes|custom_domain|"(?:route|routes|custom_domain)"|'(?:route|routes|custom_domain)')\s*(?:=|\.)/i.test(
        line,
      )
    ) {
      throw new Error(
        "managed Worker config must not declare routes or custom domains",
      );
    }
  }
}

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return line.slice(0, index);
  }
  return line;
}
