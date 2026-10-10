import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function sourceFingerprint() {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
  const files = ["scripts/evaluate-agent.mjs", ...readdirSync("scripts").filter(name => name.startsWith("agent-eval-") && name.endsWith(".mjs")).map(name => `scripts/${name}`),
    ...["agent", "calendar", "journal", "mission-control", "social-publishing", "landing-pages", "web-research", "knowledge"].flatMap(name => walk(`packages/${name}/src`)),
    ...walk("apps/worker/migrations"),
    ...["me3-agent", "agent-runtime", "ai-providers", "ai-gateway", "assistant-runtime-binding", "core-runtime-migrations", "agent-domain-scheduling", "agent-mailbox-services", "agent-scheduling", "calendar", "scheduling", "scheduling-preconditions", "email-providers", "managed-email-outbound", "managed-ai-billing", "network-directory", "web-research", "assistant-primary-thread", "routes/new-agent", "routes/assistant", "routes/mission-control"].map(name => `apps/worker/src/${name}.ts`),
    ...["base-character", "capabilities", "model-capabilities", "owner-snapshot", "owner-content-search", "landing-pages", "landing-page-images", "site-blog", "social-content", "reminders", "bookings"].map(name => `packages/agent-chat/src/${name}.ts`)];
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}
