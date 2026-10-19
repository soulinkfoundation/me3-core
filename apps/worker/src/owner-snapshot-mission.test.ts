import { describe, expect, it } from "vitest";
import { loadOwnerSnapshotContext, type OwnerSnapshotDb } from "../../../packages/agent-chat/src/owner-snapshot";

// The agent reads the private Mission. Failure modes: an old line left in the site profile beats the private
// Mission; a [blanks] template (old or new) reaches the agent as if it were the owner's Mission.
function snapshotDb(missionStatement: string | null, siteBusiness: Record<string, unknown> | null) {
  const db: OwnerSnapshotDb = {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async <T>() => {
              if (sql.includes("FROM mission_dashboard_settings")) return { mission_statement: missionStatement, settings_json: "{}", updated_at: "2026-10-19T10:00:00Z" } as T;
              if (sql.includes("sf.path IN ('src/me.json', 'me.json')") && siteBusiness) {
                return { content: JSON.stringify({ name: "Kieran", business: siteBusiness }), path: "src/me.json", updated_at: "2026-10-19T10:00:00Z" } as T;
              }
              return null;
            },
            all: async <T>() => ({ results: [] as T[] }),
          };
        },
      };
    },
  };
  return db;
}

const owner = { id: "owner-1", name: "Kieran", username: "kieran", timezone: "Europe/Dublin", assistantName: "ME3" };

describe("owner snapshot Mission", () => {
  it("uses the private Mission over anything left in the site profile", async () => {
    const snapshot = await loadOwnerSnapshotContext({ db: snapshotDb("I help my family thrive by being present.", { positioningStatement: "An old public line." }), ownerId: "owner-1", owner, meJsonUrl: null });
    expect(snapshot.prompt).toContain("- I help my family thrive by being present.");
    expect(snapshot.prompt).not.toContain("An old public line.");
  });

  it("never passes a fill-in-the-blanks template off as the Mission", async () => {
    for (const template of ["I help [who] [the change you want for them] by [how you help].", "I am here to help [who/what] become [desired change]."]) {
      const snapshot = await loadOwnerSnapshotContext({ db: snapshotDb(template, null), ownerId: "owner-1", owner, meJsonUrl: null });
      expect(snapshot.prompt).toContain("Mission statement:\n- Not set");
    }
  });

  it("still reads a Mission written on the site before it moved", async () => {
    const snapshot = await loadOwnerSnapshotContext({ db: snapshotDb(null, { audience: "makers", solution: "pairing with them" }), ownerId: "owner-1", owner, meJsonUrl: null });
    expect(snapshot.prompt).toContain("- I help makers by pairing with them.");
  });
});
