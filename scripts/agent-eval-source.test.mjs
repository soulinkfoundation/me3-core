import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Alter only disposable copied source. A report must become stale if any choice
// admission, projection, immutable snapshot or presentation tool behavior changes.
for (const dependency of ["apps/worker/src/agent-target-selection.ts", "apps/worker/src/agent-target-projection.ts", "packages/agent/src/presentations.ts", "packages/agent/src/tools/presentations.ts"]) {
  test(`fingerprint covers target execution dependency ${dependency}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "me3-eval-source-"));
    try {
      for (const path of ["scripts", "apps/worker/src", "apps/worker/migrations", ...["agent", "agent-chat", "calendar", "journal", "mission-control", "social-publishing", "landing-pages", "web-research", "knowledge"].map(name => `packages/${name}/src`)]) cpSync(resolve(path), join(directory, path), { recursive: true });
      const url = pathToFileURL(join(directory, "scripts/agent-eval-source.mjs")).href;
      const fingerprint = () => execFileSync(process.execPath, ["--input-type=module", "-e", `import { sourceFingerprint } from ${JSON.stringify(url)}; process.stdout.write(sourceFingerprint());`], { cwd: directory, encoding: "utf8" });
      const before = fingerprint();
      const path = join(directory, dependency);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n// synthetic execution dependency change\n`);
      assert.notEqual(fingerprint(), before, "A changed execution dependency must invalidate current-source evidence");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
