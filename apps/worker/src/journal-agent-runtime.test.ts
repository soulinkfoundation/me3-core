import { describe, expect, it } from "vitest";
import {
  readJournalEntriesForAgent,
} from "@me3-core/plugin-journal";

type JournalRow = {
  id: string;
  user_id: string;
  entry_date: string;
  title: string | null;
  body: string;
  body_format: string;
  updated_at: string;
  revision: number;
  archived_at: string | null;
};

describe("Journal Agent read contract", () => {
  it("reads the latest seven non-empty entries by default", async () => {
    const database = createJournalDb(
      Array.from({ length: 9 }, (_, index) =>
        journalRow(
          `2026-07-${String(index + 1).padStart(2, "0")}`,
          `Entry ${index + 1}`,
        )
      ),
    );

    const result = await readJournalEntriesForAgent(
      database.db,
      "owner",
      { mode: "latest" },
    );

    expect(result.entries).toHaveLength(7);
    expect(result.entries[0]?.date).toBe("2026-07-09");
    expect(result.entries[6]?.date).toBe("2026-07-03");
    expect(result.hasMore).toBe(true);
  });

  it("reads an exact date and an inclusive range", async () => {
    const database = createJournalDb([
      journalRow("2026-07-01", "First"),
      journalRow("2026-07-02", "Second"),
      journalRow("2026-07-03", "Third"),
    ]);

    const exact = await readJournalEntriesForAgent(
      database.db,
      "owner",
      { mode: "date", date: "2026-07-02" },
    );
    const range = await readJournalEntriesForAgent(
      database.db,
      "owner",
      {
        mode: "range",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-02",
      },
    );

    expect(exact.entries.map((entry) => entry.title)).toEqual(["Second"]);
    expect(range.entries.map((entry) => entry.title)).toEqual(["First", "Second"]);
  });

  it("rejects an inverted date range", async () => {
    const database = createJournalDb([]);
    await expect(
      readJournalEntriesForAgent(database.db, "owner", {
        mode: "range",
        dateFrom: "2026-07-10",
        dateTo: "2026-07-01",
      }),
    ).rejects.toThrow("on or before");
  });
});

function journalRow(
  date: string,
  title: string,
  body = `Body for ${title}.`,
): JournalRow {
  return {
    id: `journal-${date}`,
    user_id: "owner",
    entry_date: date,
    title,
    body,
    body_format: "html",
    updated_at: `${date}T12:00:00.000Z`,
    revision: 1,
    archived_at: null,
  };
}

function createJournalDb(initialRows: JournalRow[]) {
  const rows = initialRows.map(row => ({ ...row }));
  return { db: { prepare(sql: string) { return { bind(...values: unknown[]) { return {
    async all<T>() { return { results: selectJournalRows(rows, sql, values) as T[] }; },
    async first<T>() { return null as T | null; },
    async run() { throw new Error("Journal read must not write"); },
  }; } }; } } };
}

function selectJournalRows(
  rows: JournalRow[],
  sql: string,
  values: unknown[],
): JournalRow[] {
  const ownerId = String(values[0]);
  let selected = rows.filter(
    (row) =>
      row.user_id === ownerId &&
      row.archived_at === null &&
      (row.title?.trim() || row.body.trim()),
  );
  let limit = 1;

  if (sql.includes("entry_date = ?")) {
    selected = selected.filter((row) => row.entry_date === values[1]);
  } else if (sql.includes("entry_date >= ?")) {
    selected = selected
      .filter(
        (row) =>
          row.entry_date >= String(values[1]) &&
          row.entry_date <= String(values[2]),
      )
      .sort((left, right) => left.entry_date.localeCompare(right.entry_date));
    limit = Number(values[3]);
  } else {
    selected = selected.sort((left, right) =>
      right.entry_date.localeCompare(left.entry_date)
    );
    limit = Number(values[1]);
  }

  return selected.slice(0, limit);
}
