import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";

test("retired runtimes cannot start an evaluation or import the old dispatcher", () => {
  for (const runtime of ["sdk", "legacy", "agent", "", undefined]) {
    assert.throws(() => createRuntimeAdapter(runtime), /runtime=new/);
  }
  assert.equal(typeof createRuntimeAdapter("new").runTurn, "function");
});
