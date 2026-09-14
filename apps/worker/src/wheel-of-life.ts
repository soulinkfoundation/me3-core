import type { Env } from "./types";
import {
  MissionControlInputError,
  normalizeNullableText,
  normalizeListLimit,
  normalizeIsoDateTime,
  normalizeDbDateTime,
  parseJsonRecord,
  parseJsonArray,
  isRecord,
} from "./workspace-input";

type MissionWheelSettingsRow = {
  user_id: string;
  segments_json: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
};

type MissionWheelSnapshotRow = {
  id: string;
  user_id: string;
  segments_json: string;
  notes_json: string;
  created_at: string;
};

type MissionWheelSegment = {
  id: string;
  label: string;
  helper: string;
  color: string;
  emoji: string;
  value: number | null;
};

const MISSION_WHEEL_MIN_SEGMENTS = 6;
const MISSION_WHEEL_MAX_SEGMENTS = 8;
const DEFAULT_MISSION_WHEEL_SEGMENTS: MissionWheelSegment[] = [
  {
    id: "health",
    label: "Health",
    helper: "Physical, mental and emotional wellbeing",
    color: "#26806f",
    emoji: "❤️",
    value: null,
  },
  {
    id: "spirituality",
    label: "Spirituality",
    helper: "Meaning, purpose, felt sense of connection to something greater than yourself",
    color: "#7c3aed",
    emoji: "🌿",
    value: null,
  },
  {
    id: "work",
    label: "Work",
    helper: "What you do, how you serve others",
    color: "#2563eb",
    emoji: "💼",
    value: null,
  },
  {
    id: "finances",
    label: "Finances",
    helper: "Money",
    color: "#ca8a04",
    emoji: "💰",
    value: null,
  },
  {
    id: "home",
    label: "Home",
    helper: "Environment, living situation",
    color: "#c2410c",
    emoji: "🏡",
    value: null,
  },
  {
    id: "joy",
    label: "Joy",
    helper: "What you do for fun",
    color: "#be123c",
    emoji: "🤗",
    value: null,
  },
];

export async function getMissionWheel(env: Env, userId: string) {
  const [settingsRow, snapshotRows] = await Promise.all([
    getOrCreateMissionWheelSettingsRow(env, userId),
    listMissionWheelSnapshotRows(env, userId, 50),
  ]);
  return {
    settings: serializeMissionWheelSettings(settingsRow),
    snapshots: snapshotRows.map(serializeMissionWheelSnapshot),
  };
}

export async function updateMissionWheelSettings(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const existing = await getOrCreateMissionWheelSettingsRow(env, userId);
  const segments =
    body.segments === undefined
      ? sanitizeMissionWheelSegments(parseJsonArray(existing.segments_json))
      : sanitizeMissionWheelSegments(body.segments);

  await env.DB.prepare(
    `INSERT INTO mission_wheel_settings
       (user_id, segments_json, schema_version, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       segments_json = excluded.segments_json,
       schema_version = excluded.schema_version,
       updated_at = datetime('now')`,
  )
    .bind(userId, JSON.stringify(segments))
    .run();

  return {
    settings: serializeMissionWheelSettings(
      (await getMissionWheelSettingsRow(env, userId)) as MissionWheelSettingsRow,
    ),
  };
}

export async function createMissionWheelSnapshot(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const settings = await updateMissionWheelSettings(env, userId, {
    segments: body.segments,
  });
  const segments = settings.settings.segments;
  if (!segments.every((segment) => segment.value !== null)) {
    throw new MissionControlInputError("Score every Wheel area before saving a snapshot");
  }
  const notes = normalizeMissionWheelNotes(body.notes, segments);
  const id = normalizeNullableText(body.id) || crypto.randomUUID();
  const createdAt =
    normalizeIsoDateTime(body.createdAt) || new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO mission_wheel_snapshots
       (id, user_id, segments_json, notes_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, JSON.stringify(segments), JSON.stringify(notes), createdAt)
    .run();

  return {
    snapshot: serializeMissionWheelSnapshot(
      (await getMissionWheelSnapshotRow(env, userId, id)) as MissionWheelSnapshotRow,
    ),
  };
}

export async function listMissionWheelSnapshots(
  env: Env,
  userId: string,
  limitInput: unknown = 50,
) {
  const rows = await listMissionWheelSnapshotRows(
    env,
    userId,
    normalizeListLimit(limitInput, 50),
  );
  return { snapshots: rows.map(serializeMissionWheelSnapshot) };
}

async function getMissionWheelSettingsRow(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT user_id, segments_json, schema_version, created_at, updated_at
     FROM mission_wheel_settings
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<MissionWheelSettingsRow>();
}

async function getOrCreateMissionWheelSettingsRow(env: Env, userId: string) {
  const existing = await getMissionWheelSettingsRow(env, userId);
  if (existing) return existing;

  await env.DB.prepare(
    `INSERT INTO mission_wheel_settings
       (user_id, segments_json, schema_version)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(userId, JSON.stringify(DEFAULT_MISSION_WHEEL_SEGMENTS))
    .run();

  return (await getMissionWheelSettingsRow(env, userId)) as MissionWheelSettingsRow;
}

async function listMissionWheelSnapshotRows(
  env: Env,
  userId: string,
  limit: number,
) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, segments_json, notes_json, created_at
     FROM mission_wheel_snapshots
     WHERE user_id = ?
     ORDER BY created_at DESC, id ASC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionWheelSnapshotRow>()
    .catch(() => ({ results: [] as MissionWheelSnapshotRow[] }));
  return rows.results || [];
}

async function getMissionWheelSnapshotRow(
  env: Env,
  userId: string,
  snapshotId: string,
) {
  return env.DB.prepare(
    `SELECT id, user_id, segments_json, notes_json, created_at
     FROM mission_wheel_snapshots
     WHERE id = ? AND user_id = ?`,
  )
    .bind(snapshotId, userId)
    .first<MissionWheelSnapshotRow>();
}

export async function getLatestMissionWheelSnapshot(env: Env, userId: string) {
  const rows = await listMissionWheelSnapshotRows(env, userId, 1);
  return rows[0] ? serializeMissionWheelSnapshot(rows[0]) : null;
}

function serializeMissionWheelSettings(row: MissionWheelSettingsRow) {
  return {
    userId: row.user_id,
    schemaVersion: row.schema_version,
    segments: sanitizeMissionWheelSegments(parseJsonArray(row.segments_json)),
    createdAt: normalizeDbDateTime(row.created_at),
    updatedAt: normalizeDbDateTime(row.updated_at),
  };
}

function serializeMissionWheelSnapshot(row: MissionWheelSnapshotRow) {
  const notes = parseJsonRecord(row.notes_json);
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: normalizeDbDateTime(row.created_at) || row.created_at,
    segments: sanitizeMissionWheelSegments(parseJsonArray(row.segments_json)).map(
      (segment) => ({
        ...segment,
        notes:
          typeof notes[segment.id] === "string"
            ? String(notes[segment.id]).slice(0, 600)
            : "",
      }),
    ),
  };
}

function sanitizeMissionWheelSegment(
  value: unknown,
  index: number,
): MissionWheelSegment {
  const input = isRecord(value) ? value : {};
  const fallback =
    DEFAULT_MISSION_WHEEL_SEGMENTS[index] || DEFAULT_MISSION_WHEEL_SEGMENTS[0];
  const id = normalizeNullableText(input.id) || fallback.id;
  const rawValue = Number(input.value);
  return {
    id,
    label: (normalizeNullableText(input.label) || fallback.label).slice(0, 36),
    helper: (normalizeNullableText(input.helper) || fallback.helper).slice(0, 180),
    color:
      typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)
        ? input.color
        : fallback.color,
    emoji: (normalizeNullableText(input.emoji) || fallback.emoji).slice(0, 40),
    value:
      Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 10
        ? rawValue
        : null,
  };
}

function sanitizeMissionWheelSegments(value: unknown): MissionWheelSegment[] {
  const incoming = Array.isArray(value) ? value : [];
  const segments = incoming
    .slice(0, MISSION_WHEEL_MAX_SEGMENTS)
    .map((segment, index) => sanitizeMissionWheelSegment(segment, index));
  const seen = new Set(segments.map((segment) => segment.id));
  for (const segment of DEFAULT_MISSION_WHEEL_SEGMENTS) {
    if (segments.length >= MISSION_WHEEL_MIN_SEGMENTS) break;
    if (seen.has(segment.id)) continue;
    segments.push({ ...segment });
  }
  return segments.length >= MISSION_WHEEL_MIN_SEGMENTS
    ? segments
    : DEFAULT_MISSION_WHEEL_SEGMENTS.map((segment) => ({ ...segment }));
}

function normalizeMissionWheelNotes(
  value: unknown,
  segments: MissionWheelSegment[],
): Record<string, string> {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries(
    segments.map((segment) => [
      segment.id,
      typeof input[segment.id] === "string"
        ? String(input[segment.id]).trim().slice(0, 600)
        : "",
    ]),
  );
}
