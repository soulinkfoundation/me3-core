import { pluginNavEmojiById } from "./plugins";

export type AppFeatureId =
  | "assistant"
  | "mission-control"
  | "journal"
  | "wheel-of-life"
  | "calendar"
  | "email"
  | "files"
  | "sites"
  | "social"
  | "accounts"
  | "account";

export const APP_FEATURE_ICONS: Record<AppFeatureId, string> = {
  assistant: pluginNavEmojiById("me3.agent-chat"),
  "mission-control": pluginNavEmojiById("me3.mission-control"),
  journal: pluginNavEmojiById("me3.journal"),
  "wheel-of-life": "🛞",
  calendar: pluginNavEmojiById("me3.calendar"),
  email: "📧",
  files: "📂",
  sites: pluginNavEmojiById("me3.landing-pages"),
  social: pluginNavEmojiById("me3.social-publishing"),
  accounts: pluginNavEmojiById("me3.accounts"),
  account: "⚙️",
};

type AppFeatureMatcher = {
  id: AppFeatureId;
  matches: (path: string) => boolean;
};

function matchesPathPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const APP_FEATURE_MATCHERS: AppFeatureMatcher[] = [
  { id: "assistant", matches: (path) => matchesPathPrefix(path, "/assistant") },
  {
    id: "mission-control",
    matches: (path) =>
      matchesPathPrefix(path, "/tasks") ||
      matchesPathPrefix(path, "/mission-control"),
  },
  { id: "journal", matches: (path) => matchesPathPrefix(path, "/journal") },
  {
    id: "wheel-of-life",
    matches: (path) => matchesPathPrefix(path, "/wheel-of-life"),
  },
  { id: "calendar", matches: (path) => matchesPathPrefix(path, "/calendar") },
  { id: "email", matches: (path) => matchesPathPrefix(path, "/email") },
  { id: "files", matches: (path) => matchesPathPrefix(path, "/files") },
  {
    id: "sites",
    matches: (path) =>
      matchesPathPrefix(path, "/sites") || matchesPathPrefix(path, "/create"),
  },
  { id: "social", matches: (path) => matchesPathPrefix(path, "/social") },
  { id: "accounts", matches: (path) => matchesPathPrefix(path, "/accounts") },
  {
    id: "account",
    matches: (path) =>
      matchesPathPrefix(path, "/account") || matchesPathPrefix(path, "/settings"),
  },
];

export function appFeatureForPath(path: string): AppFeatureId | null {
  return APP_FEATURE_MATCHERS.find((feature) => feature.matches(path))?.id ?? null;
}

export function appFeatureIconForPath(path: string): string | null {
  const feature = appFeatureForPath(path);
  return feature ? APP_FEATURE_ICONS[feature] : null;
}
