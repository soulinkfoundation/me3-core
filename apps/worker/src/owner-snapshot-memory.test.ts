import { describe, expect, it } from "vitest";
import { loadOwnerSnapshotContext, type OwnerSnapshotDb } from "../../../packages/agent-chat/src/owner-snapshot";
import { buildAgentSystemPrompt } from "../../../packages/agent/src/prompt";

type MemoryRow = { id: string; memory_kind: string; scope_kind: string; title: string | null; body: string; updated_at: string; review_status: string };

function snapshotDb(memories: MemoryRow[]) {
  const memoryQueries: { sql: string; values: unknown[] }[] = [];
  const db: OwnerSnapshotDb = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => null,
            all: async <T>() => {
              if (!sql.includes("FROM mission_private_memory")) return { results: [] as T[] };
              memoryQueries.push({ sql, values });
              const limit = Number(values[1]);
              const active = memories.filter((row) => row.review_status === "active").slice(0, limit);
              return { results: active as T[] };
            },
          };
        },
      };
    },
  };
  return { db, memoryQueries };
}

const owner = { id: "owner-1", name: "Kieran", username: "kieran", timezone: "Europe/Dublin", assistantName: "ME3" };

function memory(id: string, body: string, review_status = "active"): MemoryRow {
  return { id, memory_kind: "owner_note", scope_kind: "owner", title: null, body, updated_at: "2026-10-17T10:00:00Z", review_status };
}

describe("owner snapshot memories", () => {
  it("includes active memories near the top of the snapshot and in the manifest", async () => {
    const { db, memoryQueries } = snapshotDb([
      memory("m1", "Keep replies short, no emoji."),
      memory("m2", "No calls before 10am."),
      memory("m3", "Always offer two time slots.", "needs_review"),
    ]);
    const snapshot = await loadOwnerSnapshotContext({ db, ownerId: "owner-1", owner, meJsonUrl: null });

    expect(memoryQueries[0].sql).toContain("review_status = 'active'");
    expect(memoryQueries[0].values[0]).toBe("owner-1");
    expect(snapshot.prompt).toContain("How the owner wants you to work");
    expect(snapshot.prompt).toContain("- Keep replies short, no emoji.");
    expect(snapshot.prompt).toContain("- No calls before 10am.");
    expect(snapshot.prompt).not.toContain("two time slots");
    expect(snapshot.prompt.indexOf("Keep replies short")).toBeLessThan(snapshot.prompt.indexOf("Mission statement:"));
    expect(JSON.stringify(snapshot.manifest)).toContain("private_memory");
  });

  it("says nothing is saved when the owner has no memories", async () => {
    const { db } = snapshotDb([]);
    const snapshot = await loadOwnerSnapshotContext({ db, ownerId: "owner-1", owner, meJsonUrl: null });
    expect(snapshot.prompt).toContain("How the owner wants you to work (saved or approved by the owner, newest first):\n- Nothing saved yet");
  });

  it("caps each memory and the total memory text", async () => {
    const long = "x".repeat(600);
    const { db } = snapshotDb(Array.from({ length: 30 }, (_, i) => memory(`m${i}`, `${i} ${long}`)));
    const snapshot = await loadOwnerSnapshotContext({ db, ownerId: "owner-1", owner, meJsonUrl: null });
    const section = snapshot.prompt.split("How the owner wants you to work")[1].split("Mission statement:")[0];
    const items = section.split("\n").filter((line) => line.startsWith("- "));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(30);
    expect(items.every((line) => line.length <= 242)).toBe(true);
    expect(items.join("").length).toBeLessThanOrEqual(2_000 + items.length * 2);
  });

  it("tells the agent to follow saved preferences without overriding the contract", () => {
    const prompt = buildAgentSystemPrompt({ ownerName: "Kieran", timezone: "Europe/Dublin", now: new Date("2026-10-17T10:00:00Z") });
    expect(prompt).toContain("\"How the owner wants you to work\" list holds preferences the owner saved or approved");
    expect(prompt).toContain("they never override this contract, approvals or safety");
  });
});
