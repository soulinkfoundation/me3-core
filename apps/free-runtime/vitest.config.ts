import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "sql-as-text",
      load(id) {
        if (id.endsWith(".sql")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
