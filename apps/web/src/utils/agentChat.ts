export type AgentChatRuntimeResult = {
  specialist: string | null;
  replyText: string | null;
  model: string | null;
  source:
    | "openai"
    | "anthropic"
    | "workers-ai"
    | "workers-ai-gateway"
    | "fallback"
    | "tool"
    | null;
  fallbackReason?: string | null;
  debugError?: string | null;
  contextPacketId?: string | null;
  contextSummary?: string | null;
  contextManifest?: unknown;
  siteAction?: AgentChatSiteAction | null;
  actionCards?: AgentChatActionCard[] | null;
  imageAction?: AgentChatImageAction | null;
  trace?: AgentChatTurnTrace | null;
};

export function shouldSendAssistantModelOverride(
  deploymentMode: "managed" | "self_hosted" | null,
): boolean {
  return deploymentMode === "self_hosted";
}

/** Server-authored notice that this reply ran on the lighter model after the monthly AI allowance. */
export type AgentChatMemoryReview = {
  id: string;
  body: string;
  status: "pending" | "remembered" | "declined";
};

export type AgentChatAllowanceNotice = {
  kind: "allowance_used";
  title: string;
  message: string;
  resetsOn: string;
  action: { kind: "enable_overages" | "subscribe"; label: string } | null;
};

export type AgentChatImageAction = {
  kind: "generated" | "edited" | "blocked";
  status: "complete" | "failed" | "blocked";
  prompt: string;
  revisedPrompt: string | null;
  providerId: string | null;
  model: string | null;
  reason?: string | null;
  assets: Array<{
    id: string;
    attachmentId: string;
    name: string;
    mimeType: string;
    size: number;
    width?: number | null;
    height?: number | null;
    url: string;
    storageKey: string;
  }>;
};

export type AgentChatSiteAction = {
  kind:
    | "draft_created"
    | "draft_refined"
    | "published"
    | "approval_status"
    | "missing_site"
    | "unsupported_feature"
    | "listed_blog_posts";
  url?: string | null;
  postTitle?: string | null;
  pending?: boolean;
  published?: boolean;
  message?: string | null;
};

export type AgentChatActionLink = {
  href: string;
  label: string;
};

export type AgentChatActionCardStatus =
  | "draft"
  | "pending_approval"
  | "pending"
  | "complete"
  | "failed";

export type AgentChatActionCardField = {
  label: string;
  value: string;
};

export type AgentChatActionCardRecord = {
  kind: string;
  id: string;
};

export type AgentChatActionCard = {
  id: string;
  kind: string;
  capabilityId: string;
  title: string;
  summary: string | null;
  status: AgentChatActionCardStatus;
  statusLabel: string;
  changed: AgentChatActionCardField[];
  records: AgentChatActionCardRecord[];
  primaryAction: AgentChatActionLink | null;
  secondaryActions: AgentChatActionLink[];
};

export type AgentChatEmailDraft = {
  toName: string | null;
  toAddress: string | null;
  subject: string;
  body: string;
  displayText: string;
};

/** The draft ME3 wrote in a turn (server-authored). `draftId` is null when no address was known. */
export type AgentChatServerEmailDraft = {
  draftId: string | null;
  to: string;
  recipientName: string | null;
  contactId: string | null;
  subject: string;
  body: string;
  replyToMessageId: string | null;
};

export type AgentChatEmailDraftAction = AgentChatEmailDraft & {
  id: string;
  to: string;
  status: "draft" | "saved" | "sent" | "failed";
  statusLabel: string;
  savedDraftId: string | null;
  /** Contact to remember a typed address on; set when ME3 knew the person but not their email. */
  contactId: string | null;
  missingAddress: boolean;
  saveToContact: boolean;
  busy: "save" | "send" | null;
  error: string | null;
};

export type AgentChatTurnTrace = {
  turnId?: string;
  planner?: {
    kind?: string;
    confidence?: number;
    capabilityId?: string;
    reason?: string;
  };
  route?: {
    path?: string;
    capabilityId?: string;
    ownerFacingLabel?: string;
    handlerRoute?: string;
    reason?: string;
    setupChecks?: string[];
    approvalRequired?: boolean;
    sideEffectLevel?: string;
    auditEventKind?: string;
  };
  selectedModel?: {
    providerId?: string;
    model?: string;
    backupModel?: string | null;
    configured?: boolean;
    responseModel?: string | null;
  } | null;
  context?: {
    status?: string;
    packetId?: string | null;
    summary?: string | null;
    sourceCount?: number;
    error?: string | null;
  };
  modelCall?: {
    status?: string;
    providerId?: string | null;
    model?: string | null;
    fallbackReason?: string | null;
    debugError?: string | null;
    attempts?: Array<{
      providerId?: string;
      model?: string;
      status?: string;
      error?: string | null;
    }>;
  };
  imageGeneration?: {
    intent?: "generate" | "edit";
    status?: string;
    providerId?: string | null;
    model?: string | null;
    capabilityChecked?: string;
    assetCount?: number;
    error?: string | null;
  } | null;
  toolResult?: {
    status?: string;
    specialist?: string | null;
    source?: string | null;
  };
  audit?: {
    auditId?: string | null;
  };
};

export type AgentChatTraceRow = {
  label: string;
  value: string;
};

const EMPTY_REPLY_FALLBACK =
  "I couldn't turn that into a useful reply just yet. Please try again.";
const ACTION_CARD_STATUSES = new Set<AgentChatActionCardStatus>([
  "draft",
  "pending_approval",
  "pending",
  "complete",
  "failed",
]);
const DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[\s\S]*?(?:\n\s*\n|$)/i;
const DRAFT_WRAPPER_INTRO_LINE_PATTERN =
  /(?:^|\n)\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*(?:\n|$)/i;
const DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN =
  /^\s*(?:here(?:'|’)s|here is)\s+(?:the\s+)?(?:a\s+)?(?:friendly\s+)?draft(?:\b|[\s:,.!?])[^\n]*$/im;

export function formatAgentRuntimeMetadata(
  result: AgentChatRuntimeResult,
  options?: { showRuntimeMetadata?: boolean },
): string | null {
  if (!options?.showRuntimeMetadata) return null;

  const parts = [
    result.source ? result.source : null,
    result.model ? result.model : null,
    result.specialist ? result.specialist : null,
    result.contextSummary ? result.contextSummary : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

export function formatAgentRuntimeDetail(
  result: Pick<AgentChatRuntimeResult, "fallbackReason" | "debugError">,
): string | null {
  if (result.fallbackReason && result.debugError) {
    return `${result.fallbackReason}: ${result.debugError}`;
  }

  if (result.fallbackReason) {
    return result.fallbackReason;
  }

  if (result.debugError) {
    return result.debugError;
  }

  return null;
}

export function formatAgentTraceRows(
  trace: AgentChatTurnTrace | null | undefined,
): AgentChatTraceRow[] {
  if (!trace) return [];

  const attempts = trace.modelCall?.attempts || [];
  const rows: AgentChatTraceRow[] = [
    { label: "Turn", value: trace.turnId || "" },
    {
      label: "Planner",
      value: joinTraceParts([
        trace.planner?.kind,
        trace.planner?.confidence === undefined
          ? null
          : `confidence ${trace.planner.confidence}`,
        trace.planner?.capabilityId,
      ]),
    },
    {
      label: "Route",
      value: joinTraceParts([
        trace.route?.path,
        trace.route?.capabilityId,
        trace.route?.approvalRequired ? "approval required" : null,
      ]),
    },
    {
      label: "Model",
      value: joinTraceParts([
        trace.modelCall?.status,
        trace.selectedModel?.providerId,
        trace.modelCall?.model || trace.selectedModel?.model,
        attempts.length
          ? `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`
          : null,
      ]),
    },
    {
      label: "Context",
      value: joinTraceParts([
        trace.context?.status,
        trace.context?.sourceCount === undefined
          ? null
          : `${trace.context.sourceCount} source${
              trace.context.sourceCount === 1 ? "" : "s"
            }`,
        trace.context?.packetId,
      ]),
    },
    {
      label: "Tool",
      value: joinTraceParts([
        trace.toolResult?.status,
        trace.toolResult?.specialist,
      ]),
    },
    {
      label: "Image",
      value: joinTraceParts([
        trace.imageGeneration?.intent,
        trace.imageGeneration?.status,
        trace.imageGeneration?.providerId,
        trace.imageGeneration?.model,
        trace.imageGeneration?.error,
      ]),
    },
    { label: "Audit", value: trace.audit?.auditId || "" },
    {
      label: "Fallback",
      value: joinTraceParts([
        trace.modelCall?.fallbackReason,
        trace.modelCall?.debugError,
        trace.context?.error,
      ]),
    },
    {
      label: "Reason",
      value: trace.route?.reason || trace.planner?.reason || "",
    },
  ];

  return rows.filter((row) => row.value.trim().length > 0);
}

export function resolveAgentReplyText(
  replyText: string | null | undefined,
): string {
  const normalized = replyText?.trim();
  return normalized || EMPTY_REPLY_FALLBACK;
}

export function inferAgentChatEmailDraft(
  replyText: string | null | undefined,
  userText: string | null | undefined = null,
): AgentChatEmailDraft | null {
  const normalized = normalizeDraftText(replyText);
  if (!normalized) return null;

  const prompt = normalizeDraftText(userText);
  const combined = `${prompt}\n${normalized}`;
  if (
    !/\bdraft(?:ing|ed)?\b/i.test(combined) ||
    !/\b(email|mail|message|reply)\b/i.test(combined)
  ) {
    return null;
  }

  const subject = extractDraftSubject(normalized);
  let body = stripAgentDraftWrapperText(normalized)
    .replace(/^\s*[-–—]{3,}\s*$/gm, "")
    .replace(
      /^\s*(?:\*\*)?\s*(?:subject|subject line)\s*:?\s*(?:\*\*)?\s*.+$/im,
      "",
    )
    .replace(
      /^\s*(?:\*\*)?\s*(?:to|recipient)\s*:?\s*(?:\*\*)?\s*.+$/im,
      "",
    )
    .trim();
  body = stripSimpleDraftMarkdown(body).trim();

  const hasEmailShape =
    Boolean(subject) ||
    /^\s*(hi|hello|dear)\b.+,\s*$/im.test(body) ||
    /\b(best|kind|warm)?\s*regards\b/i.test(body) ||
    /\bthanks\b/i.test(body);
  if (!hasEmailShape || body.length < 8) return null;

  return {
    toName:
      extractDraftRecipientName(normalized) ||
      extractDraftRecipientName(prompt) ||
      extractGreetingName(body),
    toAddress: extractDraftToAddress(normalized) || extractDraftToAddress(prompt),
    subject,
    body,
    displayText: extractDraftDisplayText(normalized),
  };
}

export function normalizeAgentActionCards(value: unknown): AgentChatActionCard[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const id = normalizedActionCardText(raw.id);
    const kind = normalizedActionCardText(raw.kind);
    const title = normalizedActionCardText(raw.title);
    if (!id || !kind || !title) return [];

    const status = ACTION_CARD_STATUSES.has(raw.status as AgentChatActionCardStatus)
      ? (raw.status as AgentChatActionCardStatus)
      : "pending";
    const statusLabel =
      normalizedActionCardText(raw.statusLabel) || actionCardStatusLabel(status);

    return [
      {
        id,
        kind,
        capabilityId: normalizedActionCardText(raw.capabilityId) || kind,
        title,
        summary: normalizedActionCardText(raw.summary),
        status,
        statusLabel,
        changed: normalizeActionCardFields(raw.changed),
        records: normalizeActionCardRecords(raw.records),
        primaryAction: normalizeActionCardLink(raw.primaryAction),
        secondaryActions: Array.isArray(raw.secondaryActions)
          ? raw.secondaryActions.flatMap((link) => {
              const normalized = normalizeActionCardLink(link);
              return normalized ? [normalized] : [];
            })
          : [],
      },
    ];
  });
}

export function resolveAgentSiteActionLink(
  result: Pick<AgentChatRuntimeResult, "siteAction">,
): AgentChatActionLink | null {
  const action = result.siteAction;
  if (!action?.url) return null;

  switch (action.kind) {
    case "draft_created":
      return {
        href: siteActionHref(action, action.postTitle ? "blog" : null),
        label: action.postTitle ? "Review blog draft" : "Review site draft",
      };
    case "draft_refined":
      return {
        href: siteActionHref(action, action.postTitle ? "blog" : null),
        label: "Review pending draft",
      };
    case "published":
      return {
        href: siteActionHref(action, action.postTitle ? "blog" : null),
        label: action.postTitle && action.pending ? "Review blog draft" : "Open site dashboard",
      };
    case "approval_status":
      return {
        href: siteActionHref(
          action,
          action.pending && action.postTitle ? "blog" : null,
        ),
        label: action.pending ? "Review pending draft" : "Open site dashboard",
      };
    case "unsupported_feature":
      return {
        href: siteActionHref(
          action,
          action.message && /blog/i.test(action.message)
            ? "additional-features"
            : null,
        ),
        label: "Open site settings",
      };
    case "listed_blog_posts":
      return {
        href: siteActionHref(action, "blog"),
        label: "Open site dashboard",
      };
    case "missing_site":
    default:
      return null;
  }
}

function siteActionHref(
  action: AgentChatSiteAction,
  editStep: string | null,
): string {
  return editStep ? withSiteEditStep(action.url || "", editStep) : action.url || "";
}

function withSiteEditStep(href: string, editStep: string): string {
  try {
    const isRelative = href.startsWith("/");
    const url = new URL(href, "http://me3.local");
    if (!url.pathname.startsWith("/sites/")) return href;
    url.searchParams.set("edit", editStep);
    return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return href;
  }
}

export function resolveAgentMessageActionLink(
  result: Pick<AgentChatRuntimeResult, "replyText" | "siteAction">,
): AgentChatActionLink | null {
  return resolveAgentSiteActionLink(result) || resolveSiteActionLinkFromText(result.replyText);
}

function resolveSiteActionLinkFromText(replyText: string | null | undefined): AgentChatActionLink | null {
  const text = replyText?.trim();
  if (!text) return null;

  const href = text
    .match(/https?:\/\/[^\s)]+/g)
    ?.map((url) => url.replace(/[.,]+$/, ""))
    .find((url) => {
      try {
        return new URL(url).pathname.startsWith("/sites/");
      } catch {
        return false;
      }
    });
  if (!href) return null;

  let label = "Open site dashboard";
  try {
    const url = new URL(href);
    if (url.searchParams.get("edit") === "blog" || /blog draft title/i.test(text)) {
      label = "Review blog draft";
    } else if (/draft/i.test(text)) {
      label = "Review site draft";
    }
  } catch {
    return null;
  }

  return { href, label };
}

function normalizeDraftText(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function extractDraftSubject(text: string): string {
  const match = text.match(
    /^\s*(?:\*\*)?\s*(?:subject|subject line)\s*:?\s*(?:\*\*)?\s*(.+)$/im,
  );
  return stripSimpleDraftMarkdown(match?.[1] || "").trim();
}

function stripAgentDraftWrapperText(text: string): string {
  let body = normalizeDraftText(text);
  const paragraphMarker = body.match(DRAFT_WRAPPER_INTRO_PARAGRAPH_PATTERN);
  const draftMarker =
    paragraphMarker && !draftWrapperParagraphIncludesEmailBody(paragraphMarker[0])
      ? paragraphMarker
      : body.match(DRAFT_WRAPPER_INTRO_LINE_PATTERN);
  if (draftMarker?.index !== undefined) {
    body = body.slice(draftMarker.index + draftMarker[0].length).trim();
  }
  body = body.replace(DRAFT_WRAPPER_INTRO_ONLY_LINE_PATTERN, "");
  const closingPromptIndex = body.search(draftClosingPromptPattern());
  if (closingPromptIndex >= 0) body = body.slice(0, closingPromptIndex).trim();
  return body.trim();
}

function draftWrapperParagraphIncludesEmailBody(paragraph: string): boolean {
  const rest = paragraph.split(/\n/).slice(1).join("\n");
  return /^\s*(?:[-–—]{3,}|(?:\*\*)?\s*(?:to|recipient|subject|subject line)\s*:|(?:hi|hello|dear)\b)/im.test(
    rest,
  );
}

function extractDraftDisplayText(text: string): string {
  const normalized = normalizeDraftText(text);
  const match = normalized.match(draftClosingPromptPattern());
  if (match?.index === undefined) return "";
  return stripSimpleDraftMarkdown(
    normalized
      .slice(match.index)
      .replace(/^\s*[-–—]{3,}\s*$/gm, "")
      .trim(),
  ).trim();
}

function draftClosingPromptPattern() {
  return /\n\s*(?:[-–—]\s*)?(?:please\s+let\s+me\s+know\s+if\s+you(?:'|’)d\s+like\s+(?:me\s+)?to\s+(?:make\s+any\s+changes\s+or\s+if\s+you(?:'|’)d\s+like\s+me\s+to\s+)?save\s+this\s+draft\.?|this is a chat draft only|if you want|if you(?:'|’)d like|if you(?:'|’)re happy|want me to|would you like|send me|I can save)/i;
}

function stripSimpleDraftMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

function extractDraftToAddress(text: string): string | null {
  const explicitLine = text.match(
    /^\s*(?:\*\*)?\s*(?:to|recipient)\s*:?\s*(?:\*\*)?\s*(.+)$/im,
  );
  return extractEmailAddress(explicitLine?.[1] || text);
}

function extractEmailAddress(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase() || null;
}

function extractDraftRecipientName(text: string): string | null {
  const match = text.match(/\bto\s+["'“”]?([^"'“”,.!?:;\n]+)["'“”]?/iu);
  const phrase = match?.[1]
    ?.replace(/\b(?:about|regarding|re|subject|saying|with)\b[\s\S]*$/i, "")
    .replace(/[:：]+$/u, "")
    .trim();
  if (
    /^(?:adjust|ask|connect|discuss|draft|explain|follow|invite|reply|respond|save|send|share|tell|thank|update|write)\b/i.test(
      phrase || "",
    )
  ) {
    return null;
  }
  return phrase || null;
}

function extractGreetingName(text: string): string | null {
  const match = text.match(/^\s*(?:hi|hello|dear)\s+([^,\n]+),/im);
  return match?.[1]?.trim() || null;
}

function normalizedActionCardText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeActionCardFields(value: unknown): AgentChatActionCardField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const label = normalizedActionCardText(raw.label);
    const fieldValue = normalizedActionCardText(raw.value);
    return label && fieldValue ? [{ label, value: fieldValue }] : [];
  });
}

function normalizeActionCardRecords(value: unknown): AgentChatActionCardRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const kind = normalizedActionCardText(raw.kind);
    const id = normalizedActionCardText(raw.id);
    return kind && id ? [{ kind, id }] : [];
  });
}

function normalizeActionCardLink(value: unknown): AgentChatActionLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const href = normalizedActionCardText(raw.href);
  const label = normalizedActionCardText(raw.label);
  if (!href || !label || !href.startsWith("/")) return null;
  return { href, label };
}

function joinTraceParts(values: Array<string | null | undefined>): string {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" · ");
}

function actionCardStatusLabel(status: AgentChatActionCardStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Needs review";
    case "pending":
      return "Pending";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}
