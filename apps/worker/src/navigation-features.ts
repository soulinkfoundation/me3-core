import type { Env } from "./types";

export const NAVIGATION_FEATURES = [
  {
    id: "assistant",
    name: "Assistant",
    description: "Chat with ME3 and run assistant jobs.",
  },
  {
    id: "journal",
    name: "Journal",
    description: "Write private daily notes and reflections.",
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Plan goals, projects, and tasks.",
  },
  {
    id: "email",
    name: "Email",
    description: "Read and manage your ME3 mailbox.",
  },
  {
    id: "files",
    name: "Files",
    description: "Browse private files stored in ME3.",
  },
  {
    id: "social",
    name: "Socials",
    description: "Create, approve, and publish social posts.",
  },
  {
    id: "accounts",
    name: "Accounts",
    description: "Manage your accounts and customers.",
  },
] as const;

export type NavigationFeatureId = (typeof NAVIGATION_FEATURES)[number]["id"];

export type NavigationFeature = (typeof NAVIGATION_FEATURES)[number] & {
  visible: boolean;
};

const featureIdSet = new Set<string>(NAVIGATION_FEATURES.map(({ id }) => id));

export async function listNavigationFeatures(
  env: Env,
  ownerId: string,
): Promise<NavigationFeature[]> {
  const rows = await env.DB.prepare(
    `SELECT feature_id, visible
     FROM owner_navigation_features
     WHERE user_id = ?`,
  )
    .bind(ownerId)
    .all<{ feature_id: string; visible: number }>();
  const visibility = new Map(
    (rows.results || []).map((row) => [row.feature_id, row.visible === 1]),
  );

  // New installations show the baseline assistant by default while optional
  // workspaces remain hidden. The migration writes visible rows for
  // installations that existed before this setting was introduced.
  return NAVIGATION_FEATURES.map((feature) => ({
    ...feature,
    visible: visibility.get(feature.id) ?? feature.id === "assistant",
  }));
}

export async function updateNavigationFeature(
  env: Env,
  ownerId: string,
  featureId: string,
  visible: unknown,
): Promise<NavigationFeature> {
  if (!featureIdSet.has(featureId)) {
    throw new NavigationFeatureInputError("Feature is not configurable", 404);
  }
  if (typeof visible !== "boolean") {
    throw new NavigationFeatureInputError("Visible must be true or false", 400);
  }

  await env.DB.prepare(
    `INSERT INTO owner_navigation_features (user_id, feature_id, visible, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, feature_id) DO UPDATE SET
       visible = excluded.visible,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(ownerId, featureId, visible ? 1 : 0)
    .run();

  const feature = NAVIGATION_FEATURES.find(({ id }) => id === featureId)!;
  return { ...feature, visible };
}

export class NavigationFeatureInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export async function shouldShowFeatureDiscovery(
  env: Env,
  ownerId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT dismissed_at
     FROM owner_feature_discovery
     WHERE user_id = ?`,
  )
    .bind(ownerId)
    .first<{ dismissed_at: string | null }>();
  return !row?.dismissed_at;
}

export async function dismissFeatureDiscovery(
  env: Env,
  ownerId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO owner_feature_discovery (user_id, dismissed_at, updated_at)
     VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       dismissed_at = excluded.dismissed_at,
       updated_at = excluded.updated_at`,
  )
    .bind(ownerId)
    .run();
}
