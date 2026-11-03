import type { AgentChatActionCard } from "./agentChat";

export type AssistantSitePreview = {
  href: string;
  title: string;
  statusLabel: string;
  siteUsername: string;
  pageId: string;
  editorHref: string | null;
  revision: string;
};

export const ASSISTANT_SITE_BUILDER_STARTER_PROMPT =
  "Build me a page for ";

export function assistantSitePageHasUnpublishedChanges(page: {
  publishedAt: string | null;
  updatedAt: string;
}): boolean {
  if (!page.publishedAt) return false;
  return normalizeSitePageTimestamp(page.updatedAt) >
    normalizeSitePageTimestamp(page.publishedAt);
}

type AssistantSiteBuilderThreadMessage = {
  role?: string;
  text?: string;
  actionCards?: AgentChatActionCard[] | null;
};

const LEGACY_SITE_BUILDER_PROMPT = "help me build a new me3 site";
const LEGACY_LANDING_PAGE_SITE_STARTER_PROMPT = "build me a landing page site for";
const LEGACY_POLISHED_SITE_BUILDER_STARTER_PROMPT =
  "build me a polished landing page site for";
const SITE_BUILDER_STARTER_PROMPT =
  ASSISTANT_SITE_BUILDER_STARTER_PROMPT.trim().toLowerCase();

export function isAssistantSiteBuilderThread(
  messages: AssistantSiteBuilderThreadMessage[],
): boolean {
  return messages.some((message) => {
    if (message.role === "user") {
      const text = message.text?.replace(/\s+/g, " ").trim().toLowerCase() || "";
      if (
        text === "@site" ||
        text.startsWith(SITE_BUILDER_STARTER_PROMPT) ||
        text.startsWith(LEGACY_LANDING_PAGE_SITE_STARTER_PROMPT) ||
        text.startsWith(LEGACY_POLISHED_SITE_BUILDER_STARTER_PROMPT) ||
        text.startsWith(LEGACY_SITE_BUILDER_PROMPT)
      ) {
        return true;
      }
    }

    return (message.actionCards || []).some((card) =>
      card.records.some((record) => record.kind === "landing_page"),
    );
  });
}

export function findLatestAssistantSitePreview(
  messages: Array<{ id?: string; actionCards?: AgentChatActionCard[] | null }>,
): AssistantSitePreview | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const cards = messages[messageIndex]?.actionCards || [];
    for (let cardIndex = cards.length - 1; cardIndex >= 0; cardIndex -= 1) {
      const card = cards[cardIndex];
      if (!card || !card.records.some((record) => record.kind === "landing_page")) {
        continue;
      }

      const preview = card.secondaryActions.find(
        (action) => action.label.trim().toLowerCase() === "preview",
      );
      const site = card.records.find((record) => record.kind === "site");
      const page = card.records.find((record) => record.kind === "landing_page");
      if (!preview || !site || !page) continue;
      const advancedEditor = card.secondaryActions.find(
        (action) => action.label.trim().toLowerCase() === "advanced editor",
      );
      const legacyEditor =
        card.primaryAction?.label.trim().toLowerCase() === "open draft"
          ? card.primaryAction
          : null;

      return {
        href: preview.href,
        title: card.summary?.trim() || card.title,
        statusLabel: card.statusLabel,
        siteUsername: site.id,
        pageId: page.id,
        editorHref: advancedEditor?.href || legacyEditor?.href || null,
        revision: messages[messageIndex]?.id || `${messageIndex}:${card.id}`,
      };
    }
  }

  return null;
}

function normalizeSitePageTimestamp(value: string): number {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
