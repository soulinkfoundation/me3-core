import {
  createEmptyCampaignDocument,
  parseCampaignDocument,
  type CampaignDocumentV1,
} from "../../../shared/campaign-document";
import { MANAGED_CAMPAIGN_UNSUBSCRIBE_PLACEHOLDER } from "../../../shared/managed-campaign-contract";
import {
  evaluateCampaignAudience,
  type CampaignAudienceEvaluation,
  type CampaignAudienceSubscriber,
} from "./campaign-audience";
import { renderCampaign } from "./campaign-renderer";
import { getSiteBranding } from "./site-branding";
import { getOwnerProfile, getPublicSiteOrigin, getR2SiteFileKey } from "./sites";
import type { DbSite, Env } from "./types";

export class CampaignInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
    readonly code = "campaign_invalid",
  ) {
    super(message);
    this.name = "CampaignInputError";
  }
}

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed";

export type CampaignRevisionRow = {
  id: string;
  campaign_id: string;
  revision_number: number;
  subject: string;
  preview_text: string;
  reply_to_address: string | null;
  document_version: string;
  document_json: string;
  renderer_version: string | null;
  rendered_html: string | null;
  rendered_text: string | null;
  created_at: string;
};

export type OwnedCampaign = {
  id: string;
  site_id: string;
  site_username: string;
  site_custom_domain: string | null;
  name: string;
  status: CampaignStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  current_revision_id: string | null;
  audience_snapshot_id: string | null;
  sender_ref: string | null;
  from_address: string | null;
  failure_reason: string | null;
  audience_filter_json: string;
  created_at: string;
  updated_at: string;
  revision: CampaignRevisionRow;
};

type SiteRow = Pick<
  DbSite,
  "id" | "username" | "custom_domain" | "custom_domain_status"
>;

export type CampaignAudienceFilter =
  | { kind: "all" }
  | { kind: "customers"; itemRef: string | null };

export async function listCampaigns(env: Env, ownerId: string) {
  const rows = await env.DB.prepare(
    `SELECT campaign.id, campaign.site_id, campaign.name, campaign.status,
            campaign.scheduled_for, campaign.sent_at, campaign.cancelled_at,
            campaign.failure_reason, campaign.created_at, campaign.updated_at,
            site.username AS site_username,
            revision.subject, revision.preview_text,
            COUNT(job.id) AS recipient_count,
            SUM(CASE WHEN job.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
            SUM(CASE WHEN job.status IN ('bounced', 'complained', 'suppressed', 'rejected', 'failed') THEN 1 ELSE 0 END) AS failed_count
     FROM email_campaigns campaign
     INNER JOIN sites site ON site.id = campaign.site_id
     LEFT JOIN email_campaign_revisions revision
       ON revision.id = COALESCE(
         campaign.current_revision_id,
         (SELECT latest.id FROM email_campaign_revisions latest
          WHERE latest.campaign_id = campaign.id
          ORDER BY latest.revision_number DESC LIMIT 1)
       )
     LEFT JOIN email_campaign_recipient_jobs job
       ON job.campaign_id = campaign.id AND job.kind = 'campaign'
     WHERE site.user_id = ?
     GROUP BY campaign.id, revision.id
     ORDER BY campaign.updated_at DESC`,
  )
    .bind(ownerId)
    .all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({
    id: String(row.id),
    siteId: String(row.site_id),
    siteUsername: String(row.site_username),
    name: String(row.name),
    status: String(row.status),
    scheduledFor: nullableString(row.scheduled_for),
    sentAt: nullableString(row.sent_at),
    cancelledAt: nullableString(row.cancelled_at),
    failureReason: nullableString(row.failure_reason),
    subject: String(row.subject || ""),
    previewText: String(row.preview_text || ""),
    recipientCount: Number(row.recipient_count || 0),
    deliveredCount: Number(row.delivered_count || 0),
    failedCount: Number(row.failed_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export async function getCampaign(env: Env, ownerId: string, campaignId: string) {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) return null;
  const progress = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count
     FROM email_campaign_recipient_jobs
     WHERE campaign_id = ?
     GROUP BY status`,
  )
    .bind(campaignId)
    .all<{ status: string; count: number }>();
  return serializeCampaign(campaign, progress.results || []);
}

export async function createCampaign(
  env: Env,
  ownerId: string,
  input: { siteId?: unknown; name?: unknown; audienceFilter?: unknown },
) {
  const siteId = normalizeReference(input.siteId);
  if (!siteId) throw new CampaignInputError("Choose a Site for this campaign");
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) throw new CampaignInputError("Site not found", 404, "site_not_found");

  const branding = await getSiteBranding(env, site, true);
  const campaignId = newId("campaign");
  const revisionId = newId("campaign-revision");
  const name = normalizeText(input.name, 160) || "Untitled campaign";
  const audienceFilter = normalizeCampaignAudienceFilter(input.audienceFilter);
  const document = createEmptyCampaignDocument({
    name: defaultCampaignSenderName(site.username),
    homeUrl: getPublicSiteOrigin(env, {
      custom_domain:
        site.custom_domain_status === "active" ? site.custom_domain : null,
    }) || "https://me3.app/",
    logoUrl: null,
    accentColor: branding.accentColor,
    backgroundColor: branding.backgroundColor,
    surfaceColor: branding.surfaceColor,
    textColor: branding.textColor,
  });
  document.blocks.push({
    id: "intro",
    type: "text",
    paragraphs: [
      { style: "heading1", spans: [{ text: "Your update" }] },
      { style: "body", spans: [{ text: "Start writing here." }] },
    ],
  });
  const rendered = renderCampaign({
    document,
    unsubscribeUrl: MANAGED_CAMPAIGN_UNSUBSCRIBE_PLACEHOLDER,
  });
  const now = new Date().toISOString();
  await runStatements(env.DB, [
    env.DB.prepare(
      `INSERT INTO email_campaigns
       (id, site_id, name, status, current_revision_id, audience_filter_json, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
    ).bind(campaignId, site.id, name, revisionId, JSON.stringify(audienceFilter), now, now),
    env.DB.prepare(
      `INSERT INTO email_campaign_revisions
       (id, campaign_id, revision_number, subject, preview_text,
        reply_to_address, document_version, document_json, renderer_version,
        rendered_html, rendered_text, created_at)
       VALUES (?, ?, 1, '', '', NULL, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      revisionId,
      campaignId,
      document.version,
      JSON.stringify(document),
      rendered.rendererVersion,
      rendered.html,
      rendered.text,
      now,
    ),
  ]);
  return getCampaign(env, ownerId, campaignId);
}

export async function saveCampaignDraft(
  env: Env,
  ownerId: string,
  campaignId: string,
  input: {
    siteId?: unknown;
    name?: unknown;
    subject?: unknown;
    previewText?: unknown;
    replyToAddress?: unknown;
    document?: unknown;
    audienceFilter?: unknown;
  },
) {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  if (campaign.status !== "draft") {
    throw new CampaignInputError(
      "Only draft campaigns can be edited",
      409,
      "campaign_not_editable",
    );
  }

  const siteId = input.siteId === undefined
    ? campaign.site_id
    : normalizeReference(input.siteId);
  if (!siteId) throw new CampaignInputError("Choose a Site for this campaign");
  if (siteId !== campaign.site_id && !(await getOwnedSite(env, ownerId, siteId))) {
    throw new CampaignInputError("Site not found", 404, "site_not_found");
  }

  const name = normalizeText(input.name, 160) || campaign.name;
  const subject = normalizeText(input.subject, 200);
  const previewText = normalizeText(input.previewText, 240);
  const replyToAddress = await verifiedReplyTo(env, ownerId, input.replyToAddress);
  const document = parseCampaignDocument(input.document);
  const audienceFilter = input.audienceFilter === undefined
    ? parseCampaignAudienceFilter(campaign.audience_filter_json)
    : normalizeCampaignAudienceFilter(input.audienceFilter);
  await assertCampaignAssets(env, campaignId, document);
  const rendered = renderCampaign({
    document,
    previewText,
    unsubscribeUrl: MANAGED_CAMPAIGN_UNSUBSCRIBE_PLACEHOLDER,
  });
  const latest = await env.DB.prepare(
    "SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM email_campaign_revisions WHERE campaign_id = ?",
  )
    .bind(campaignId)
    .first<{ revision_number: number }>();
  const revisionId = newId("campaign-revision");
  const revisionNumber = Number(latest?.revision_number || 0) + 1;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO email_campaign_revisions
       (id, campaign_id, revision_number, subject, preview_text,
        reply_to_address, document_version, document_json, renderer_version,
        rendered_html, rendered_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      revisionId,
      campaignId,
      revisionNumber,
      subject,
      previewText,
      replyToAddress,
      document.version,
      JSON.stringify(document),
      rendered.rendererVersion,
      rendered.html,
      rendered.text,
      now,
    ),
    env.DB.prepare(
      `UPDATE email_campaigns
       SET site_id = ?, name = ?, current_revision_id = ?, audience_filter_json = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(siteId, name, revisionId, JSON.stringify(audienceFilter), now, campaignId),
  ];
  for (const assetId of campaignAssetIds(document)) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO email_campaign_revision_assets
         (revision_id, asset_id, created_at) VALUES (?, ?, ?)`,
      ).bind(revisionId, assetId, now),
    );
  }
  await runStatements(env.DB, statements);
  return getCampaign(env, ownerId, campaignId);
}

export async function deleteCampaign(
  env: Env,
  ownerId: string,
  campaignId: string,
) {
  const campaign = await env.DB.prepare(
    `SELECT campaign.id, campaign.status, site.username AS site_username
     FROM email_campaigns campaign
     INNER JOIN sites site ON site.id = campaign.site_id
     WHERE campaign.id = ? AND site.user_id = ?`,
  )
    .bind(campaignId, ownerId)
    .first<{ id: string; status: CampaignStatus; site_username: string }>();
  if (!campaign) {
    throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  }
  if (!["draft", "failed", "cancelled"].includes(campaign.status)) {
    throw new CampaignInputError(
      "Only drafts, failed campaigns, and cancelled campaigns can be deleted",
      409,
      "campaign_not_deletable",
    );
  }

  const inProgress = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM email_campaign_recipient_jobs
     WHERE campaign_id = ? AND status IN (
       'queued', 'submitting', 'accepted', 'delayed', 'retry_wait',
       'delivery_unknown', 'unresolved', 'paused'
     )`,
  )
    .bind(campaignId)
    .first<{ count: number }>();
  if (Number(inProgress?.count || 0) > 0) {
    throw new CampaignInputError(
      "This campaign still has delivery activity and cannot be deleted yet",
      409,
      "campaign_delivery_active",
    );
  }

  const assets = await env.DB.prepare(
    "SELECT storage_path FROM email_campaign_assets WHERE campaign_id = ?",
  )
    .bind(campaignId)
    .all<{ storage_path: string }>();
  const deleted = await env.DB.prepare(
    "DELETE FROM email_campaigns WHERE id = ?",
  )
    .bind(campaignId)
    .run();
  if (Number(deleted.meta.changes || 0) === 0) {
    throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  }

  if (env.SITE_ASSETS && assets.results?.length) {
    await Promise.allSettled(
      assets.results.map((asset) =>
        env.SITE_ASSETS!.delete(
          getR2SiteFileKey(
            { username: campaign.site_username } as DbSite,
            asset.storage_path,
          ),
        ),
      ),
    );
  }
  return { campaignId };
}

export async function previewCampaignAudience(
  env: Env,
  ownerId: string,
  campaignId: string,
): Promise<CampaignAudienceEvaluation> {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  return evaluateCampaignAudience(await listSiteAudience(
    env,
    campaign.site_id,
    parseCampaignAudienceFilter(campaign.audience_filter_json),
  ));
}

export async function getOwnedCampaign(
  env: Env,
  ownerId: string,
  campaignId: string,
): Promise<OwnedCampaign | null> {
  const row = await env.DB.prepare(
    `SELECT campaign.*, site.username AS site_username,
            site.custom_domain AS site_custom_domain,
            revision.id AS revision_id,
            revision.campaign_id AS revision_campaign_id,
            revision.revision_number, revision.subject, revision.preview_text,
            revision.reply_to_address, revision.document_version,
            revision.document_json, revision.renderer_version,
            revision.rendered_html, revision.rendered_text,
            revision.created_at AS revision_created_at
     FROM email_campaigns campaign
     INNER JOIN sites site ON site.id = campaign.site_id
     INNER JOIN email_campaign_revisions revision
       ON revision.id = COALESCE(
         campaign.current_revision_id,
         (SELECT latest.id FROM email_campaign_revisions latest
          WHERE latest.campaign_id = campaign.id
          ORDER BY latest.revision_number DESC LIMIT 1)
       )
     WHERE campaign.id = ? AND site.user_id = ?`,
  )
    .bind(campaignId, ownerId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    site_id: String(row.site_id),
    site_username: String(row.site_username),
    site_custom_domain: nullableString(row.site_custom_domain),
    name: String(row.name),
    status: row.status as CampaignStatus,
    scheduled_for: nullableString(row.scheduled_for),
    sent_at: nullableString(row.sent_at),
    cancelled_at: nullableString(row.cancelled_at),
    current_revision_id: nullableString(row.current_revision_id),
    audience_snapshot_id: nullableString(row.audience_snapshot_id),
    sender_ref: nullableString(row.sender_ref),
    from_address: nullableString(row.from_address),
    failure_reason: nullableString(row.failure_reason),
    audience_filter_json: typeof row.audience_filter_json === "string"
      ? row.audience_filter_json
      : '{"kind":"all"}',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    revision: {
      id: String(row.revision_id),
      campaign_id: String(row.revision_campaign_id),
      revision_number: Number(row.revision_number),
      subject: String(row.subject),
      preview_text: String(row.preview_text),
      reply_to_address: nullableString(row.reply_to_address),
      document_version: String(row.document_version),
      document_json: String(row.document_json),
      renderer_version: nullableString(row.renderer_version),
      rendered_html: nullableString(row.rendered_html),
      rendered_text: nullableString(row.rendered_text),
      created_at: String(row.revision_created_at),
    },
  };
}

export async function listSiteAudience(
  env: Env,
  siteId: string,
  filter: CampaignAudienceFilter = { kind: "all" },
): Promise<CampaignAudienceSubscriber[]> {
  const customerFilter = filter.kind === "customers"
    ? `AND (
        EXISTS (
          SELECT 1 FROM commerce_orders o
          WHERE o.site_id = subscribers.site_id
            AND LOWER(TRIM(o.buyer_email)) = LOWER(TRIM(subscribers.email))
            AND (o.status IN ('paid', 'refunded') OR (o.payment_method = 'manual' AND o.status = 'pending'))
            ${filter.itemRef?.startsWith("booking:") ? "AND 0" : filter.itemRef?.startsWith("product:") ? "AND ('product:' || o.product_slug) = ?" : ""}
        )
        OR EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.site_id = subscribers.site_id
            AND LOWER(TRIM(b.guest_email)) = LOWER(TRIM(subscribers.email))
            AND b.status = 'confirmed'
            ${filter.itemRef?.startsWith("product:") ? "AND 0" : filter.itemRef?.startsWith("booking:") ? "AND ('booking:' || COALESCE(b.offer_id, b.booking_type, 'booking')) = ?" : ""}
        )
      )`
    : "";
  const params: string[] = [siteId];
  if (filter.kind === "customers" && filter.itemRef) params.push(filter.itemRef);
  const result = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, subscribed_at, unsubscribed_at,
            marketing_status, marketing_permission_method,
            marketing_permission_granted_at,
            marketing_permission_evidence_json, delivery_status
     FROM subscribers WHERE site_id = ? ${customerFilter} ORDER BY id`,
  )
    .bind(...params)
    .all<CampaignAudienceSubscriber>();
  return result.results || [];
}

export function serializeCampaign(
  campaign: OwnedCampaign,
  progress: Array<{ status: string; count: number }> = [],
) {
  const progressByStatus = Object.fromEntries(
    progress.map((item) => [item.status, Number(item.count)]),
  );
  return {
    id: campaign.id,
    siteId: campaign.site_id,
    siteUsername: campaign.site_username,
    name: campaign.name,
    status: campaign.status,
    scheduledFor: campaign.scheduled_for,
    sentAt: campaign.sent_at,
    cancelledAt: campaign.cancelled_at,
    failureReason: campaign.failure_reason,
    audienceFilter: parseCampaignAudienceFilter(campaign.audience_filter_json),
    sender: campaign.sender_ref
      ? { ref: campaign.sender_ref, fromAddress: campaign.from_address }
      : null,
    createdAt: campaign.created_at,
    updatedAt: campaign.updated_at,
    revision: {
      id: campaign.revision.id,
      number: campaign.revision.revision_number,
      subject: campaign.revision.subject,
      previewText: campaign.revision.preview_text,
      replyToAddress: campaign.revision.reply_to_address,
      document: JSON.parse(campaign.revision.document_json),
      rendererVersion: campaign.revision.renderer_version,
      renderedHtml: campaign.revision.rendered_html,
      renderedText: campaign.revision.rendered_text,
      createdAt: campaign.revision.created_at,
    },
    progress: progressByStatus,
  };
}

export async function listCampaignCustomerItems(env: Env, ownerId: string, siteId: string) {
  const site = await getOwnedSite(env, ownerId, siteId);
  if (!site) throw new CampaignInputError("Site not found", 404, "site_not_found");
  const result = await env.DB.prepare(
    `SELECT item_ref AS value, item_label AS label FROM (
       SELECT 'product:' || product_slug AS item_ref, product_title AS item_label
       FROM commerce_orders WHERE site_id = ?
       UNION
       SELECT 'booking:' || COALESCE(offer_id, booking_type, 'booking') AS item_ref,
              CASE booking_type WHEN 'one_to_one' THEN 'One-to-one booking'
                WHEN 'class' THEN 'Class booking' WHEN 'retreat' THEN 'Retreat booking'
                ELSE 'Booking' END AS item_label
       FROM bookings WHERE site_id = ?
     ) ORDER BY label COLLATE NOCASE`,
  ).bind(siteId, siteId).all<{ value: string; label: string }>();
  return result.results || [];
}

export function normalizeCampaignAudienceFilter(value: unknown): CampaignAudienceFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "all" };
  const input = value as Record<string, unknown>;
  if (input.kind !== "customers") return { kind: "all" };
  const itemRef = normalizeReference(input.itemRef);
  if (itemRef && !itemRef.startsWith("product:") && !itemRef.startsWith("booking:")) {
    throw new CampaignInputError("Choose a valid product or service");
  }
  return { kind: "customers", itemRef: itemRef || null };
}

export function parseCampaignAudienceFilter(value: string): CampaignAudienceFilter {
  try {
    return normalizeCampaignAudienceFilter(JSON.parse(value));
  } catch {
    return { kind: "all" };
  }
}

async function getOwnedSite(env: Env, ownerId: string, siteId: string) {
  return env.DB.prepare(
    `SELECT id, username, custom_domain, custom_domain_status
     FROM sites WHERE id = ? AND user_id = ?`,
  )
    .bind(siteId, ownerId)
    .first<SiteRow>();
}

async function verifiedReplyTo(
  env: Env,
  ownerId: string,
  value: unknown,
): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const requested = normalizeEmail(value);
  const owner = await getOwnerProfile(env, ownerId);
  if (!requested || requested !== normalizeEmail(owner?.email)) {
    throw new CampaignInputError(
      "Reply-to must use the verified owner account email",
      400,
      "reply_to_unverified",
    );
  }
  return requested;
}

async function assertCampaignAssets(
  env: Env,
  campaignId: string,
  document: CampaignDocumentV1,
) {
  const assetIds = campaignAssetIds(document);
  for (const assetId of assetIds) {
    const asset = await env.DB.prepare(
      "SELECT id FROM email_campaign_assets WHERE id = ? AND campaign_id = ?",
    )
      .bind(assetId, campaignId)
      .first<{ id: string }>();
    if (!asset) {
      throw new CampaignInputError(
        "Campaign content references an unavailable image",
        400,
        "campaign_asset_invalid",
      );
    }
  }
}

function campaignAssetIds(document: CampaignDocumentV1): string[] {
  return [
    ...new Set(
      document.blocks.flatMap((block) =>
        block.type === "image" ? [block.assetId] : [],
      ),
    ),
  ];
}

async function runStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(/[\r\n]+/g, " ").trim().slice(0, limit)
    : "";
}

function normalizeReference(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function defaultCampaignSenderName(username: string): string {
  const listName = username
    .trim()
    .replace(/^@/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!listName) return "ME3";
  return listName.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).slice(0, 120);
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
