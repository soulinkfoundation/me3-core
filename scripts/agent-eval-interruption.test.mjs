import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("SIGINT and SIGTERM checkpoint the reserved in-flight call without fabricating a row", async () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const directory = mkdtempSync(join(tmpdir(), "me3-eval-interruption-"));
    const preload = join(directory, "synthetic-fetch.mjs"); const reportPath = join(directory, "report.json");
    writeFileSync(preload, 'globalThis.fetch=async()=>{process.stdout.write("synthetic-call-started\\n");setInterval(()=>{},1000);return new Promise(()=>{});};');
    const child = spawn(process.execPath, ["--import", "tsx", "--import", preload, "scripts/evaluate-agent.mjs", "--runtime=new", "--model=workers-ai:@cf/zai-org/glm-5.3-flash", "--limit=1", "--repeat=1", "--date=2026-10-10", "--max-cost-usd=1", `--report=${reportPath}`],
      { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "synthetic", CLOUDFLARE_API_TOKEN: "synthetic", CLOUDFLARE_AI_GATEWAY_ID: "synthetic" }, stdio: ["ignore", "pipe", "pipe"] });
    try {
      let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
      const exit = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Synthetic child timeout: ${stderr}`)); }, 10_000);
        child.once("error", reject);
        child.stdout.on("data", chunk => { if (String(chunk).includes("synthetic-call-started")) child.kill(signal); });
        child.once("exit", (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
      });
      assert.equal(exit.code, 1, stderr); assert.equal(exit.signal, null);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      assert.equal(report.interruption.signal, signal); assert.ok(Number.isFinite(Date.parse(report.interruption.at)));
      assert.equal(report.interruption.activeScenario.id, "calendar-find-1");
      assert.equal(report.interruption.activeScenario.stage, "candidate");
      assert.equal(report.results.length, 0); assert.equal(report.gate.passed, false);
      assert.equal(report.budget.chargedUsd, 0); assert.ok(report.budget.reservedUsd > 0);
    } finally { child.kill("SIGKILL"); rmSync(directory, { recursive: true, force: true }); }
  }
});
