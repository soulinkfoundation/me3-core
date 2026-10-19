import { describe, expect, it } from "vitest";
import {
  legacyMissionFromBusiness,
  missionSentence,
  normalizeMissionAnswers,
  ownedMissionStatement,
  readOwnerMission,
  saveOwnerMission,
} from "@me3-core/plugin-mission-control";

// The Mission is private and lives in Core, apart from the public site. Failure modes: a fill-in-the-blanks
// template counts as a Mission; answers build a broken or run-on sentence; unknown or oversized answers are
// stored; saving with nothing usable succeeds; saving the Mission wipes goals or other dashboard settings; the
// Mission someone wrote before the move (statement or the three site answers) is lost.
describe("private Mission", () => {
  it("treats templates and blanks as no Mission", () => {
    expect(ownedMissionStatement("I am here to help [who/what] become [desired change] by being [way of being] and creating [work/service], guided by [values].")).toBeNull();
    expect(ownedMissionStatement("I help [who] [the change you want for them] by [how you help].")).toBeNull();
    expect(ownedMissionStatement("   ")).toBeNull();
    expect(ownedMissionStatement(42)).toBeNull();
    expect(ownedMissionStatement("  Help my family thrive.  ")).toBe("Help my family thrive.");
  });

  it("builds one plain sentence from the answers", () => {
    expect(missionSentence({ who: "first-time founders", change: "launch with confidence", how: "coaching and simple tools." })).toBe(
      "I help first-time founders launch with confidence by coaching and simple tools.",
    );
    expect(missionSentence({ who: "my family", how: "being present", why: "they matter most" })).toBe(
      "I help my family by being present, because they matter most.",
    );
    expect(missionSentence({ who: "my community", change: "feel less alone" })).toBe("I help my community feel less alone.");
    expect(missionSentence({ change: "grow", how: "teaching" })).toBe("");
  });

  it("keeps only the four answers, trimmed and capped", () => {
    expect(normalizeMissionAnswers({ who: "  makers ", change: "x".repeat(400), how: "", extra: "nope", why: 3 })).toEqual({
      who: "makers",
      change: "x".repeat(240),
    });
    expect(normalizeMissionAnswers("nope")).toEqual({});
  });

  it("carries over a Mission written on the site", () => {
    expect(legacyMissionFromBusiness({ positioningStatement: "I help makers ship." })).toEqual({ statement: "I help makers ship.", answers: {} });
    expect(legacyMissionFromBusiness({ audience: "makers", primaryProblem: "shipping", solution: "pairing with them" })).toEqual({
      statement: "I help makers with shipping by pairing with them.",
      answers: { who: "makers", how: "pairing with them" },
    });
    expect(legacyMissionFromBusiness({ positioningStatement: "I am here to help [who/what] become [desired change]." })).toBeNull();
    expect(legacyMissionFromBusiness(undefined)).toBeNull();
  });

  it("saves the statement and answers without touching goals", async () => {
    const db = fakeDashboardDb({ settings_json: JSON.stringify({ goals: [{ id: "run", title: "Run 10k", status: "active" }], kanbanEnabled: true }), mission_statement: "I am here to help [who/what]." });
    expect(await readOwnerMission(db, "owner")).toEqual({ statement: null, answers: {} });
    const saved = await saveOwnerMission(db, "owner", { answers: { who: "makers", change: "ship", how: "pairing" } });
    expect(saved).toEqual({ statement: "I help makers ship by pairing.", answers: { who: "makers", change: "ship", how: "pairing" } });
    expect(JSON.parse(db.row()!.settings_json)).toMatchObject({ goals: [{ id: "run" }], kanbanEnabled: true, missionAnswers: { who: "makers" } });
    const edited = await saveOwnerMission(db, "owner", { statement: "  I build calm tools for makers.  " });
    expect(edited.statement).toBe("I build calm tools for makers.");
    expect(await readOwnerMission(db, "owner")).toEqual({ statement: "I build calm tools for makers.", answers: { who: "makers", change: "ship", how: "pairing" } });
  });

  it("creates the row for a new owner and refuses an empty Mission", async () => {
    const db = fakeDashboardDb(null);
    await expect(saveOwnerMission(db, "owner", { statement: "[who]", answers: { how: "teaching" } })).rejects.toThrow(/mission/i);
    await saveOwnerMission(db, "owner", { statement: "Help my family thrive." });
    expect(db.row()).toMatchObject({ mission_statement: "Help my family thrive." });
    expect(JSON.parse(db.row()!.settings_json)).toEqual({ missionAnswers: {} });
  });
});

type Row = { user_id: string; settings_json: string; mission_statement: string | null };

// A tiny stand-in for the two statements the Mission store runs, including SQLite's json_set merge.
function fakeDashboardDb(initial: Partial<Row> | null) {
  let row: Row | null = initial ? { user_id: "owner", settings_json: "{}", mission_statement: null, ...initial } : null;
  const db = {
    row: () => row,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              return (sql.includes("SELECT") && row && values[0] === row.user_id ? { mission_statement: row.mission_statement, settings_json: row.settings_json } : null) as T | null;
            },
            async run() {
              const [userId, answersJson, statement] = values as [string, string, string];
              if (!row) row = { user_id: userId, settings_json: JSON.stringify({ missionAnswers: JSON.parse(answersJson) }), mission_statement: statement };
              else row = { ...row, settings_json: JSON.stringify({ ...JSON.parse(row.settings_json), missionAnswers: JSON.parse(answersJson) }), mission_statement: statement };
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database & { row: () => Row | null };
}
