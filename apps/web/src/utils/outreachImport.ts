// Reads a list of prospects the owner pasted or uploaded: a CSV, rows copied
// from a spreadsheet, or one name per line. ME3 saves them; nothing is sent.

export type ProspectImportRow = {
  name: string;
  email?: string;
  phone?: string;
  organisation?: string;
  offer?: string;
  /** The list's own word for it ("Sent", "Agreed"); the server maps it. */
  status?: string;
  /** YYYY-MM-DD */
  followUpAt?: string;
  notes?: string;
};

type Field = keyof ProspectImportRow;

export const IMPORT_BATCH_SIZE = 50;

const HEADERS: Record<Field, string[]> = {
  name: ["name", "full name", "contact", "contact name", "person"],
  email: ["email", "e mail", "email address", "e mail address"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "mobile number"],
  organisation: ["organisation", "organization", "org", "company", "business", "association"],
  offer: ["offer", "offered", "what was offered", "pitch"],
  status: ["status", "stage", "outcome"],
  followUpAt: ["follow up", "followup", "follow up date", "next follow up", "follow up on"],
  notes: ["notes", "note", "comments", "comment"],
};

const EMAIL = /[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[^\s<>(),;:"']+/;

function fieldForHeader(cell: string): Field | null {
  const words = cell.trim().toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const match = (Object.keys(HEADERS) as Field[]).find((field) => HEADERS[field].includes(words));
  return match || null;
}

function delimiterFor(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(",")) return ",";
  return firstLine.includes(";") ? ";" : ",";
}

// Cells may be quoted, and a quoted cell may hold the delimiter or a line break.
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((cells) => cells.map((value) => value.trim())).filter((cells) => cells.some(Boolean));
}

const pad = (value: number) => String(value).padStart(2, "0");

// Dates are read day-first (20/11/2026) unless that cannot be a date.
function dateFrom(value: string): string | undefined {
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (numeric) {
    const [first, second] = [Number(numeric[1]), Number(numeric[2])];
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const [day, month] = second > 12 && first <= 12 ? [second, first] : [first, second];
    return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? `${year}-${pad(month)}-${pad(day)}` : undefined;
  }
  const time = /[a-z]/i.test(value) && /\d{4}/.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rowFrom(values: Partial<Record<Field, string>>): ProspectImportRow | null {
  const email = values.email?.match(EMAIL)?.[0].toLowerCase();
  const organisation = values.organisation?.trim();
  const name = values.name?.replace(/<[^>]*>/g, "").trim() || organisation || email;
  if (!name) return null;
  const followUpAt = values.followUpAt ? dateFrom(values.followUpAt) : undefined;
  return {
    name,
    ...(email ? { email } : {}),
    ...(values.phone ? { phone: values.phone } : {}),
    ...(organisation ? { organisation } : {}),
    ...(values.offer ? { offer: values.offer } : {}),
    ...(values.status ? { status: values.status } : {}),
    ...(followUpAt ? { followUpAt } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

export function parseProspectList(text: string): { rows: ProspectImportRow[]; unnamed: number } {
  const lines = splitRows(text.replace(/^﻿/, ""), delimiterFor(text));
  if (lines.length === 0) return { rows: [], unnamed: 0 };

  const header = lines[0].map(fieldForHeader);
  const hasHeader = header.some(Boolean) && !lines[0].some((cell) => EMAIL.test(cell));
  const rows: ProspectImportRow[] = [];
  let unnamed = 0;
  for (const cells of hasHeader ? lines.slice(1) : lines) {
    const values: Partial<Record<Field, string>> = {};
    if (hasHeader) {
      header.forEach((field, index) => {
        if (field && cells[index] && !values[field]) values[field] = cells[index];
      });
    } else {
      // No header: the cell with an address is the email, then name, then organisation.
      const emailCell = cells.find((cell) => EMAIL.test(cell));
      const rest = cells.filter((cell) => cell && cell !== emailCell);
      if (emailCell) values.email = emailCell;
      values.name = rest[0] ?? emailCell?.replace(EMAIL, "");
      if (rest[1]) values.organisation = rest[1];
    }
    const row = rowFrom(values);
    if (row) rows.push(row);
    else unnamed++;
  }
  return { rows, unnamed };
}

export function importBatches<T>(rows: T[], size = IMPORT_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size));
  return batches;
}
