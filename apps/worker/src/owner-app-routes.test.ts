import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OWNER_APP_ROUTE_PREFIXES } from "./owner-app-routes";

const pagesDir = fileURLToPath(new URL("../../web/src/pages", import.meta.url));

describe("owner app routes", () => {
  it("reserves every top-level web page so direct visits load the app", () => {
    const routes = readdirSync(pagesDir, { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? entry.name : entry.name.match(/^([^.[]+)\.vue$/)?.[1]))
      .filter((name): name is string => Boolean(name) && !name!.startsWith("["))
      .map((name) => `/${name}`);

    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((route) => !OWNER_APP_ROUTE_PREFIXES.includes(route))).toEqual([]);
  });
});
