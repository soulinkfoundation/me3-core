import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const migrations = new URL("../apps/worker/migrations/", import.meta.url);

export function createSeededAgentEvalInstallation(baseDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) ||
      new Date(`${baseDate}T12:00:00.000Z`).toISOString().slice(0, 10) !== baseDate) {
    throw new Error("Eval baseDate must be YYYY-MM-DD.");
  }
  const raw = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec("PRAGMA foreign_keys = ON");

  const day = (offset) => {
    const date = new Date(`${baseDate}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const at = (offset, hour) => `${day(offset)}T${hour}:00:00.000Z`;
  const insert = (sql, ...values) => raw.prepare(sql).run(...values);

  insert("INSERT INTO owner_profile (id, email, name, username, timezone, bio) VALUES (?, ?, ?, ?, ?, ?)",
    "eval-owner", "owner@example.invalid", "Eval Owner", "eval-owner", "Europe/Dublin", "A synthetic ME3 owner for agent evaluation.");
  insert("INSERT INTO owner_profile (id, name, username, timezone) VALUES (?, ?, ?, ?)",
    "other-owner", "Other Owner", "other-owner", "Europe/Dublin");
  for (const pluginId of ["me3.calendar", "me3.journal", "me3.mission-control", "me3.landing-pages", "me3.social-publishing"]) {
    insert("INSERT INTO plugin_installations (plugin_id, version, enabled, status) VALUES (?, 'eval', 1, 'installed')", pluginId);
  }
  insert("INSERT INTO sites (id, user_id, username, site_role, published_at) VALUES (?, ?, ?, ?, ?)",
    "eval-site", "eval-owner", "eval-owner", "profile", at(-1, "12"));
  insert("INSERT INTO user_calendar_events (id, user_id, title, starts_at, ends_at, timezone) VALUES (?, ?, ?, ?, ?, ?)",
    "eval-planning", "eval-owner", "Planning session", at(1, "09"), at(1, "10"), "Europe/Dublin");
  insert("INSERT INTO user_calendar_events (id, user_id, title, starts_at, ends_at, timezone) VALUES (?, ?, ?, ?, ?, ?)",
    "other-event", "other-owner", "Private other-owner event", at(1, "11"), at(1, "12"), "Europe/Dublin");
  insert("INSERT INTO calendar_sources (id, user_id, kind, name, status) VALUES (?, ?, ?, ?, ?)",
    "eval-soulink-source", "eval-owner", "ics_url", "Soulink events", "active");
  insert("INSERT INTO calendar_source_events (id, source_id, external_key, title, starts_at, ends_at, timezone) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "eval-soulink-event", "eval-soulink-source", "soulink:circle", "Soulink circle", at(2, "17"), at(2, "18"), "Europe/Dublin");
  insert("INSERT INTO bookings (id, site_id, guest_name, guest_email, starts_at, ends_at, duration_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "eval-booking", "eval-site", "Ada Example", "ada@example.invalid", at(3, "13"), at(3, "14"), 60, "confirmed");
  insert("INSERT INTO scheduling_time_types (id, user_id, title, duration_minutes, buffer_minutes, timezone, windows_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "eval-call-type", "eval-owner", "30-minute call", 30, 15, "Europe/Dublin",
    JSON.stringify(Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => [day, ["09:00-17:00"]]))));
  insert("INSERT INTO user_reminders (id, user_id, title, remind_at, timezone) VALUES (?, ?, ?, ?, ?)",
    "eval-reminder", "eval-owner", "Call Sam", at(1, "08"), "Europe/Dublin");
  insert("INSERT INTO mission_projects (id, user_id, name, slug) VALUES (?, ?, ?, ?)",
    "eval-project", "eval-owner", "ME3 Launch", "me3-launch");
  insert("INSERT INTO mission_tasks (id, user_id, project_id, title, due_at) VALUES (?, ?, ?, ?, ?)",
    "eval-task", "eval-owner", "eval-project", "Review launch plan", at(4, "15"));
  insert("INSERT INTO journal_entries (id, user_id, entry_date, title, body) VALUES (?, ?, ?, ?, ?)",
    "eval-journal", "eval-owner", day(-1), "Planning reflection", "I need a calmer launch week.");
  for (let index = 0; index < 12; index++) {
    insert("INSERT INTO contacts (id, user_id, name, email, notes) VALUES (?, ?, ?, ?, ?)",
      `eval-contact-${index + 1}`, "eval-owner", index === 0 ? "Ada Example" : `Contact ${String(index + 1).padStart(2, "0")} Example`,
      index === 0 ? "ada@example.invalid" : `contact${index + 1}@example.invalid`, "Synthetic evaluation contact.");
  }
  insert("INSERT INTO contacts (id, user_id, name, email) VALUES (?, ?, ?, ?)", "other-contact", "other-owner", "Private other-owner contact", "private@example.invalid");
  for (const [id, owner, local] of [["eval-mailbox", "eval-owner", "eval-owner"], ["other-mailbox", "other-owner", "other-owner"]]) {
    insert("INSERT INTO mailbox_aliases (id, user_id, alias_local_part, forwarding_email, forwarding_status, status) VALUES (?, ?, ?, ?, 'verified', 'active')", id, owner, local, `${local}@example.invalid`);
  }
  for (const [id, mailbox, sender, subject, body] of [
    ["eval-email-ada", "eval-mailbox", "ada@example.invalid", "QA launch review", "Could we review the launch plan this Thursday? I am free in the afternoon."],
    ["eval-email-news", "eval-mailbox", "news@example.invalid", "Community newsletter", "This month's community circle is open for registration."],
    ["other-email", "other-mailbox", "private@example.invalid", "Private other-owner email", "Do not expose this private fixture."],
  ]) {
    insert("INSERT INTO mailbox_messages (id, mailbox_id, direction, message_kind, status, from_address, to_address, subject, text_body, folder, received_at) VALUES (?, ?, 'inbound', 'email', 'received', ?, ?, ?, ?, 'inbox', ?)", id, mailbox, sender, "eval-owner@example.invalid", subject, body, at(-1, "10"));
  }

  return {
    raw,
    ownerId: "eval-owner",
    baseDate,
    day,
    db: {
      prepare(sql) {
        return {
          bind(...values) {
            const statement = raw.prepare(sql);
            return {
              async first() { return statement.get(...values) || null; },
              async all() { return { results: statement.all(...values) }; },
              async run() { return { meta: { changes: statement.run(...values).changes } }; },
            };
          },
        };
      },
    },
    close() { raw.close(); },
  };
}
