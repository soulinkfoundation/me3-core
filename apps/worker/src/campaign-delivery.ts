import {
  MANAGED_CAMPAIGN_PROTOCOL_VERSION,
  MANAGED_CAMPAIGN_UNSUBSCRIBE_PLACEHOLDER,
  parseManagedCampaignEvent,
  parseManagedCampaignSubmissionResponse,
  type ManagedCampaignDeliveryRequest,
  type ManagedCampaignEvent,
  type ManagedCampaignEventBatch,
  type ManagedCampaignSenderStatus,
  type ManagedCampaignSubmissionResponse,
} from "../../../shared/managed-campaign-contract";
import { parseCampaignDocument } from "../../../shared/campaign-document";
import {
  CAMPAIGN_ADD_ON_PLANS,
  campaignAddOnPlan,
  type CampaignAddOnPlanKey,
  type CampaignAddOnStatus,
} from "@me3-core/plugin-email-campaigns";
import { evaluateCampaignAudience, type CampaignAudienceSubscriber } from "./campaign-audience";
import {
  CampaignInputError,
  getOwnedCampaign,
  listSiteAudience,
  parseCampaignAudienceFilter,
  type OwnedCampaign,
} from "./campaigns";
import { isManagedRuntime } from "./managed-runtime-lifecycle";
import { getMe3CloudApiOrigin, getOwnerProfile } from "./sites";
import type { Env } from "./types";

const CORE_INSTALL_ID_SECRET = "ME3_CORE_INSTALL_ID";
const CORE_UPDATE_TOKEN_SECRET = "ME3_CLOUD_CORE_TOKEN";
const CALLBACK_SECRET = "ME3_MANAGED_CAMPAIGN_CALLBACK_SECRET";
const MAX_DISPATCH_BATCH = 20;
export const CAMPAIGN_DISPATCH_CRON = "* * * * *";
const CALLBACK_MAX_CLOCK_SKEW_SECONDS = 300;

export type CampaignTransportStatus = {
  available: boolean;
  managed: boolean;
  ready: boolean;
  reason: string | null;
  sender: null | {
    ref: string;
    domain: string;
    fromAddress: string;
    status: string;
  };
  addOn: CampaignAddOnStatus | null;
  instructions: string[];
};

type ManagedCampaignConfig = {
  origin: string;
  coreInstallId: string;
  coreUpdateToken: string;
};

type RecipientJobRow = {
  id: string;
  campaign_id: string;
  revision_id: string;
  audience_snapshot_id: string | null;
  audience_member_id: string | null;
  kind: "campaign" | "test";
  recipient_ref: string;
  recipient_email: string;
  status: string;
  request_json: string | null;
  attempt_count: number;
  next_attempt_at: string;
  provider_reason: string | null;
  subject: string;
  reply_to_address: string | null;
  document_json: string;
  rendered_html: string;
  rendered_text: string;
  sender_ref: string | null;
  permission_method: "single_opt_in" | "double_opt_in" | "import_attested" | null;
  permission_granted_at: string | null;
};

export async function getCampaignTransportStatus(
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<CampaignTransportStatus> {
  if (!isManagedRuntime(env)) {
    return {
      available: false,
      managed: false,
      ready: false,
      reason: "managed_installation_required",
      sender: null,
      addOn: null,
      instructions: [
        "Activate the plugin to create campaign drafts. Configure an owner-supplied campaign provider before sending from a self-hosted installation.",
      ],
    };
  }
  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (!config) {
    await storeTransportStatus(env, null, false, "managed_transport_not_configured");
    return unavailableTransport(true, "managed_transport_not_configured", null, [
      "Managed campaign delivery is not configured for this installation yet.",
    ]);
  }

  let knownAddOn: CampaignAddOnStatus | null = null;
  try {
    const addOnResponse = await managedFetch(
      config,
      "/v1/managed-campaign/billing/status",
      { method: "GET" },
      fetcher,
    );
    const addOnBody = await addOnResponse.json().catch(() => null) as
      | { addOn?: unknown }
      | null;
    const addOn = normalizeCampaignAddOnStatus(addOnBody?.addOn);
    if (!addOnResponse.ok || isRedirect(addOnResponse.status) || !addOn) {
      return unavailableTransport(
        true,
        `campaign_billing_status_${addOnResponse.status}`,
        null,
        ["Campaign Sending billing is temporarily unavailable. Drafts remain available."],
      );
    }
    knownAddOn = addOn;
    if (!addOn.entitled) {
      await storeTransportStatus(env, null, false, "campaign_add_on_required");
      return unavailableTransport(true, "campaign_add_on_required", addOn, [
        "Choose a monthly email capacity to activate ME3-managed campaign delivery.",
      ]);
    }

    const response = await managedFetch(
      config,
      `/v1/installs/${encodeURIComponent(config.coreInstallId)}/campaign-sender`,
      { method: "GET" },
      fetcher,
    );
    if (!response.ok || isRedirect(response.status)) {
      await storeTransportStatus(env, null, false, `sender_status_${response.status}`);
      return unavailableTransport(true, `sender_status_${response.status}`, addOn, [
        "Campaign sender status could not be confirmed. Try again shortly.",
      ]);
    }
    const body = (await response.json().catch(() => null)) as ManagedCampaignSenderStatus | null;
    const sender = body?.sender;
    if (
      !body ||
      (body.provider !== "aws_ses" && body.provider !== "postmark") ||
      typeof body.ready !== "boolean" ||
      (sender && (!sender.ref || !sender.fromAddress || !sender.domain))
    ) {
      await storeTransportStatus(env, null, false, "sender_status_invalid");
      return unavailableTransport(true, "sender_status_invalid", addOn);
    }
    const status: CampaignTransportStatus = {
      available: Boolean(body.connected),
      managed: true,
      ready: Boolean(body.ready && sender),
      reason: body.ready && sender ? null : "sender_not_ready",
      sender: sender
        ? {
            ref: sender.ref,
            domain: sender.domain,
            fromAddress: sender.fromAddress,
            status: sender.status,
          }
        : null,
      addOn,
      instructions: Array.isArray(body.instructions) ? body.instructions : [],
    };
    await storeTransportStatus(env, status.sender, status.ready, status.reason);
    if (status.ready) await ensureCallbackSecret(env, config, fetcher).catch(() => undefined);
    return status;
  } catch {
    await storeTransportStatus(env, null, false, "managed_transport_unreachable");
    return unavailableTransport(true, "managed_transport_unreachable", knownAddOn, [
      "Campaign Sending is temporarily unavailable. Drafts remain available.",
    ]);
  }
}

export async function startCampaignAddOnCheckout(
  env: Env,
  planKey: CampaignAddOnPlanKey,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string }> {
  if (!campaignAddOnPlan(planKey)) {
    throw new CampaignInputError("Choose a supported email capacity", 400, "campaign_plan_invalid");
  }
  return managedCampaignBillingAction(env, "/v1/managed-campaign/billing/checkout", {
    plan: planKey,
  }, fetcher);
}

export async function openCampaignAddOnPortal(
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<{ url: string }> {
  return managedCampaignBillingAction(
    env,
    "/v1/managed-campaign/billing/portal",
    {},
    fetcher,
  );
}

export async function setupManagedCampaignSender(
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<CampaignTransportStatus> {
  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (!config) {
    throw new CampaignInputError(
      "Managed campaign delivery is not configured",
      409,
      "managed_transport_not_configured",
    );
  }
  const response = await managedFetch(
    config,
    `/v1/installs/${encodeURIComponent(config.coreInstallId)}/campaign-sender`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    fetcher,
  );
  if (!response.ok || isRedirect(response.status)) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new CampaignInputError(
      typeof body?.error === "string" ? body.error : "Campaign sender setup failed",
      409,
      "campaign_sender_setup_failed",
    );
  }
  return getCampaignTransportStatus(env, fetcher);
}

export async function startCampaignDelivery(
  env: Env,
  ownerId: string,
  campaignId: string,
  input: { scheduledFor?: unknown },
  fetcher: typeof fetch = fetch,
) {
  const campaign = await requireDraftCampaign(env, ownerId, campaignId);
  if (!campaign.revision.subject.trim()) {
    throw new CampaignInputError("Add a subject before sending", 400, "subject_required");
  }
  if (!campaign.revision.rendered_html || !campaign.revision.rendered_text) {
    throw new CampaignInputError("Save the campaign before sending", 409, "render_required");
  }
  const transport = await requireReadyTransport(env, fetcher);
  const scheduledFor = normalizeSchedule(input.scheduledFor);
  const audience = evaluateCampaignAudience(await listSiteAudience(
    env,
    campaign.site_id,
    parseCampaignAudienceFilter(campaign.audience_filter_json),
  ));
  if (audience.eligible.length === 0) {
    throw new CampaignInputError(
      "This Site has no eligible campaign subscribers",
      409,
      "audience_empty",
    );
  }
  if (transport.addOn && audience.eligible.length > transport.addOn.remaining) {
    throw new CampaignInputError(
      `This campaign needs ${audience.eligible.length.toLocaleString()} deliveries, but ${transport.addOn.remaining.toLocaleString()} remain this month`,
      409,
      "campaign_allowance_insufficient",
    );
  }

  const snapshotId = newId("campaign-audience");
  const now = new Date().toISOString();
  const initialStatus = Date.parse(scheduledFor) > Date.now() ? "scheduled" : "sending";
  const claimed = await env.DB.prepare(
    `UPDATE email_campaigns
     SET status = ?, scheduled_for = ?, sender_ref = ?, from_address = ?,
         failure_reason = NULL, updated_at = ?
     WHERE id = ? AND status = 'draft'`,
  )
    .bind(
      initialStatus,
      scheduledFor,
      transport.sender!.ref,
      transport.sender!.fromAddress,
      now,
      campaign.id,
    )
    .run();
  if (changeCount(claimed) === 0) {
    throw new CampaignInputError(
      "This campaign has already been queued",
      409,
      "campaign_already_queued",
    );
  }

  try {
    await env.DB.prepare(
      `INSERT INTO email_campaign_audience_snapshots
       (id, campaign_id, revision_id, site_id, eligible_count, excluded_count,
        exclusion_counts_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        snapshotId,
        campaign.id,
        campaign.revision.id,
        campaign.site_id,
        audience.eligible.length,
        audience.excluded.length,
        JSON.stringify(audience.exclusionCounts),
        now,
      )
      .run();

    const statements: D1PreparedStatement[] = [];
    for (const subscriber of audience.eligible) {
      const memberId = newId("campaign-recipient");
      const jobId = newId("campaign-operation");
      statements.push(
        env.DB.prepare(
          `INSERT INTO email_campaign_audience_members
           (id, snapshot_id, subscriber_id, normalized_email, first_name,
            last_name, permission_method, permission_granted_at,
            permission_evidence_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          memberId,
          snapshotId,
          subscriber.id,
          subscriber.normalizedEmail,
          subscriber.first_name,
          subscriber.last_name,
          subscriber.marketing_permission_method,
          subscriber.marketing_permission_granted_at,
          subscriber.marketing_permission_evidence_json,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO email_campaign_recipient_jobs
           (id, campaign_id, revision_id, audience_snapshot_id,
            audience_member_id, kind, recipient_ref, recipient_email, status,
            next_attempt_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'campaign', ?, ?, 'queued', ?, ?, ?)`,
        ).bind(
          jobId,
          campaign.id,
          campaign.revision.id,
          snapshotId,
          memberId,
          memberId,
          subscriber.normalizedEmail,
          scheduledFor,
          now,
          now,
        ),
      );
    }
    await runStatementChunks(env.DB, statements);
    await env.DB.prepare(
      `UPDATE email_campaigns
       SET audience_snapshot_id = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(snapshotId, now, campaign.id)
      .run();
  } catch (error) {
    await env.DB.prepare(
      `UPDATE email_campaigns
       SET status = 'failed', failure_reason = 'Failed to create the audience snapshot',
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(campaign.id)
      .run();
    throw error;
  }
  return {
    campaignId: campaign.id,
    snapshotId,
    scheduledFor,
    eligibleCount: audience.eligible.length,
    excludedCount: audience.excluded.length,
    exclusionCounts: audience.exclusionCounts,
  };
}

export async function sendCampaignTest(
  env: Env,
  ownerId: string,
  campaignId: string,
  fetcher: typeof fetch = fetch,
) {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  if (!campaign.revision.subject.trim()) {
    throw new CampaignInputError("Add a subject before sending a test", 400, "subject_required");
  }
  const owner = await getOwnerProfile(env, ownerId);
  const recipient = normalizeEmail(owner?.email);
  if (!recipient) {
    throw new CampaignInputError(
      "A verified account email is required for test sends",
      409,
      "test_recipient_unavailable",
    );
  }
  const transport = await requireReadyTransport(env, fetcher);
  const now = new Date().toISOString();
  const jobId = newId("campaign-test-operation");
  await env.DB.prepare(
    `INSERT INTO email_campaign_recipient_jobs
     (id, campaign_id, revision_id, kind, recipient_ref, recipient_email,
      status, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'test', ?, ?, 'queued', ?, ?, ?)`,
  )
    .bind(jobId, campaign.id, campaign.revision.id, jobId, recipient, now, now, now)
    .run();
  await dispatchCampaignJob(env, jobId, transport, fetcher);
  return getCampaignJob(env, jobId);
}

export async function dispatchDueCampaignJobs(
  env: Env,
  fetcher: typeof fetch = fetch,
  limit = MAX_DISPATCH_BATCH,
) {
  if (!isManagedRuntime(env)) return { processed: 0, paused: 0 };
  const pending = await env.DB.prepare(
    `SELECT 1 AS pending FROM email_campaign_recipient_jobs
     WHERE status IN ('queued', 'retry_wait', 'paused', 'submitting',
                      'delivery_unknown', 'unresolved') LIMIT 1`,
  ).first<{ pending: number }>();
  if (!pending) return { processed: 0, paused: 0 };
  const transport = await getCampaignTransportStatus(env, fetcher);
  const dueAt = new Date().toISOString();
  if (!transport.ready || !transport.sender) {
    const result = await env.DB.prepare(
      `UPDATE email_campaign_recipient_jobs
       SET status = 'paused', provider_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('queued', 'retry_wait') AND next_attempt_at <= ?`,
    )
      .bind(transport.reason || "managed_transport_unavailable", dueAt)
      .run();
    return { processed: 0, paused: changeCount(result) };
  }
  await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'queued', provider_reason = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'paused' AND provider_reason IN (
       'managed_transport_unavailable', 'managed_transport_unreachable',
       'managed_transport_not_configured', 'sender_not_ready',
       'campaign_add_on_required'
     ) OR (status = 'paused' AND provider_reason LIKE 'sender_status_%')
        OR (status = 'paused' AND provider_reason LIKE 'campaign_billing_status_%')`,
  ).run();
  await recoverStaleSubmittingJobs(env);

  const due = await env.DB.prepare(
    `SELECT id FROM email_campaign_recipient_jobs
     WHERE status IN ('queued', 'retry_wait') AND next_attempt_at <= ?
       AND (kind = 'test' OR EXISTS (
         SELECT 1 FROM email_campaigns campaign
         WHERE campaign.id = email_campaign_recipient_jobs.campaign_id
           AND campaign.status IN ('scheduled', 'sending')
           AND campaign.audience_snapshot_id = email_campaign_recipient_jobs.audience_snapshot_id
       ))
     ORDER BY next_attempt_at, created_at LIMIT ?`,
  )
    .bind(dueAt, Math.max(1, Math.min(MAX_DISPATCH_BATCH, Math.floor(limit))))
    .all<{ id: string }>();
  let processed = 0;
  for (const row of due.results || []) {
    if (await dispatchCampaignJob(env, row.id, transport, fetcher)) processed += 1;
  }
  await reconcileUnknownCampaignJobs(env, fetcher);
  return { processed, paused: 0 };
}

export async function cancelCampaignDelivery(
  env: Env,
  ownerId: string,
  campaignId: string,
  fetcher: typeof fetch = fetch,
) {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  if (campaign.status !== "scheduled" && campaign.status !== "sending") {
    throw new CampaignInputError(
      "This campaign can no longer be cancelled",
      409,
      "campaign_not_cancellable",
    );
  }
  const now = new Date().toISOString();
  const canceled = await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'cancelled', provider_reason = 'canceled_before_acceptance',
         terminal_at = ?, updated_at = ?
     WHERE campaign_id = ? AND status IN ('queued', 'retry_wait', 'paused')`,
  )
    .bind(now, now, campaignId)
    .run();
  const uncertain = await env.DB.prepare(
    `SELECT id FROM email_campaign_recipient_jobs
     WHERE campaign_id = ? AND status = 'submitting'`,
  )
    .bind(campaignId)
    .all<{ id: string }>();
  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (config) {
    for (const job of uncertain.results || []) {
      await managedFetch(
        config,
        `/v1/managed-campaign/deliveries/${encodeURIComponent(job.id)}/cancel`,
        { method: "POST" },
        fetcher,
      ).catch(() => undefined);
    }
  }
  await env.DB.prepare(
    `UPDATE email_campaigns
     SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(now, now, campaignId)
    .run();
  return { cancelled: changeCount(canceled), tooLate: (uncertain.results || []).length };
}

export async function receiveManagedCampaignEvent(
  env: Env,
  request: Request,
): Promise<Response> {
  if (!isManagedRuntime(env)) return new Response("Not found", { status: 404 });
  const raw = await request.text();
  const eventId = request.headers.get("X-ME3-Event-ID")?.trim() || "";
  const timestamp = request.headers.get("X-ME3-Event-Timestamp")?.trim() || "";
  const signature = request.headers.get("X-ME3-Event-Signature")?.trim() || "";
  const secret = await getInstallSecret(env, CALLBACK_SECRET);
  if (
    !secret ||
    !validCallbackTimestamp(timestamp) ||
    !(await verifyCallbackSignature(secret, timestamp, raw, signature))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const event = parseManagedCampaignEvent(safeJson(raw));
  if (!event || event.eventId !== eventId) {
    return new Response("Invalid event", { status: 400 });
  }
  const applied = await applyManagedCampaignEvent(env, event);
  return new Response(null, { status: applied ? 204 : 404 });
}

export async function recoverManagedCampaignEvents(
  env: Env,
  fetcher: typeof fetch = fetch,
) {
  if (!isManagedRuntime(env)) return { recovered: 0 };
  const config = await getManagedCampaignConfig(env);
  const state = await env.DB.prepare(
    "SELECT event_cursor FROM email_campaign_transport_state WHERE id = 'managed'",
  ).first<{ event_cursor: string | null }>();
  const after = state?.event_cursor || "0";
  const response = await managedFetch(
    config,
    `/v1/managed-campaign/events?after=${encodeURIComponent(after)}&limit=100`,
    { method: "GET" },
    fetcher,
  );
  if (!response.ok || isRedirect(response.status)) return { recovered: 0 };
  const body = (await response.json().catch(() => null)) as ManagedCampaignEventBatch | null;
  if (
    !body ||
    body.version !== MANAGED_CAMPAIGN_PROTOCOL_VERSION ||
    !Array.isArray(body.events) ||
    typeof body.nextCursor !== "string"
  ) {
    return { recovered: 0 };
  }
  const eventIds: string[] = [];
  for (const rawEvent of body.events) {
    const event = parseManagedCampaignEvent(rawEvent);
    if (!event) continue;
    if (await applyManagedCampaignEvent(env, event)) eventIds.push(event.eventId);
  }
  if (eventIds.length > 0) {
    const acknowledgement = await managedFetch(
      config,
      "/v1/managed-campaign/events/acknowledgements",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: MANAGED_CAMPAIGN_PROTOCOL_VERSION,
          acknowledgementId: newId("campaign-event-ack"),
          eventIds,
          committedAt: new Date().toISOString(),
        }),
      },
      fetcher,
    );
    if (!acknowledgement.ok) return { recovered: eventIds.length };
  }
  await env.DB.prepare(
    `INSERT INTO email_campaign_transport_state
     (id, event_cursor, updated_at) VALUES ('managed', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET event_cursor = excluded.event_cursor,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(body.nextCursor)
    .run();
  return { recovered: eventIds.length };
}

export async function applyManagedCampaignEvent(
  env: Env,
  event: ManagedCampaignEvent,
): Promise<boolean> {
  const job = await env.DB.prepare(
    `SELECT id, campaign_id, audience_member_id, status
     FROM email_campaign_recipient_jobs
     WHERE id = ? AND campaign_id = ? AND recipient_ref = ?`,
  )
    .bind(event.operationId, event.campaignRef, event.recipientRef)
    .first<{
      id: string;
      campaign_id: string;
      audience_member_id: string | null;
      status: string;
    }>();
  if (!job) return false;
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO email_campaign_events
     (event_id, operation_id, campaign_id, recipient_ref, sequence,
      event_type, reason, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.eventId,
      event.operationId,
      event.campaignRef,
      event.recipientRef,
      event.sequence,
      event.type,
      event.reason,
      event.occurredAt,
    )
    .run();
  if (changeCount(inserted) === 0) return true;
  const newer = await env.DB.prepare(
    `SELECT 1 AS newer FROM email_campaign_events
     WHERE operation_id = ? AND sequence > ? LIMIT 1`,
  )
    .bind(event.operationId, event.sequence)
    .first<{ newer: number }>();
  if (!newer) {
    const nextStatus = eventJobStatus(event.type);
    if (nextStatus && canApplyJobStatus(job.status, nextStatus)) {
      const terminalAt = isTerminalJobStatus(nextStatus) ? event.occurredAt : null;
      await env.DB.prepare(
        `UPDATE email_campaign_recipient_jobs
         SET status = ?, provider_reason = ?, terminal_at = COALESCE(?, terminal_at),
             accepted_at = CASE WHEN ? = 'accepted'
               THEN COALESCE(accepted_at, ?) ELSE accepted_at END,
             updated_at = ? WHERE id = ?`,
      )
        .bind(
          nextStatus,
          event.reason,
          terminalAt,
          nextStatus,
          event.occurredAt,
          event.occurredAt,
          event.operationId,
        )
        .run();
    }
    await applySubscriberOutcome(env, job.audience_member_id, event);
    await refreshCampaignStatus(env, job.campaign_id);
  }
  return true;
}

async function dispatchCampaignJob(
  env: Env,
  jobId: string,
  transport: CampaignTransportStatus,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!transport.ready || !transport.sender) return false;
  const claimed = await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'submitting', attempt_count = attempt_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'retry_wait')
       AND (kind = 'test' OR EXISTS (
         SELECT 1 FROM email_campaigns campaign
         WHERE campaign.id = email_campaign_recipient_jobs.campaign_id
           AND campaign.status IN ('scheduled', 'sending')
           AND campaign.audience_snapshot_id = email_campaign_recipient_jobs.audience_snapshot_id
       ))`,
  )
    .bind(jobId)
    .run();
  if (changeCount(claimed) === 0) return false;
  const job = await loadCampaignJobForDispatch(env, jobId);
  if (!job) return false;
  if (job.kind === "campaign") {
    // A scheduled snapshot is immutable, but permission can be revoked before delivery.
    const subscriber = await env.DB.prepare(
      `SELECT subscriber.* FROM subscribers subscriber
       JOIN email_campaign_audience_members member ON member.subscriber_id = subscriber.id
       JOIN email_campaigns campaign ON campaign.id = ? AND campaign.site_id = subscriber.site_id
       WHERE member.id = ?`,
    ).bind(job.campaign_id, job.audience_member_id).first<CampaignAudienceSubscriber>();
    const eligible = subscriber ? evaluateCampaignAudience([subscriber]).eligible[0] : null;
    if (!eligible || eligible.normalizedEmail !== job.recipient_email) {
      const now = new Date().toISOString();
      await updateJob(env, job.id, "cancelled", "recipient_no_longer_eligible", now, now);
      await refreshCampaignStatus(env, job.campaign_id);
      return true;
    }
    await env.DB.prepare(
      `UPDATE email_campaigns SET status = 'sending', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'scheduled'`,
    )
      .bind(job.campaign_id)
      .run();
  }

  let requestJson = job.request_json;
  if (!requestJson) {
    const senderRef = job.kind === "campaign" ? job.sender_ref : transport.sender.ref;
    if (!senderRef) {
      await pauseJob(env, job.id, "sender_snapshot_unavailable");
      await refreshCampaignStatus(env, job.campaign_id);
      return true;
    }
    const now = new Date();
    const document = parseCampaignDocument(JSON.parse(job.document_json));
    const request: ManagedCampaignDeliveryRequest = {
      version: MANAGED_CAMPAIGN_PROTOCOL_VERSION,
      operationId: job.id,
      kind: job.kind,
      campaignRef: job.campaign_id,
      senderRef,
      recipient: {
        ref: job.recipient_ref,
        address: job.recipient_email,
        permission:
          job.kind === "campaign" &&
          job.permission_method &&
          job.permission_granted_at &&
          job.audience_member_id
            ? {
                status: "marketable",
                method: job.permission_method,
                grantedAt: job.permission_granted_at,
                evidenceRef: job.audience_member_id,
              }
            : null,
      },
      content: {
        fromName: document.brand.name || null,
        replyToAddress: job.reply_to_address,
        subject: job.subject,
        text: job.rendered_text,
        html: job.rendered_html,
        unsubscribePlaceholder: MANAGED_CAMPAIGN_UNSUBSCRIBE_PLACEHOLDER,
      },
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 14 * 60 * 1000).toISOString(),
    };
    requestJson = JSON.stringify(request);
    await env.DB.prepare(
      "UPDATE email_campaign_recipient_jobs SET request_json = ? WHERE id = ?",
    )
      .bind(requestJson, job.id)
      .run();
  }

  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (!config) {
    await pauseJob(env, job.id, "managed_transport_not_configured");
    return true;
  }
  let response: Response;
  try {
    response = await managedFetch(
      config,
      "/v1/managed-campaign/deliveries",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ME3-Campaign-Protocol": MANAGED_CAMPAIGN_PROTOCOL_VERSION,
          "Idempotency-Key": job.id,
        },
        body: requestJson,
      },
      fetcher,
    );
  } catch {
    await markJobUnknown(env, job.id, "managed_transport_unreachable");
    await refreshCampaignStatus(env, job.campaign_id);
    return true;
  }
  const result = parseManagedCampaignSubmissionResponse(
    await response.json().catch(() => null),
  );
  if (!result) {
    await markJobUnknown(env, job.id, `managed_transport_${response.status}`);
    await refreshCampaignStatus(env, job.campaign_id);
    return true;
  }
  await applySubmissionResult(env, job, result);
  await refreshCampaignStatus(env, job.campaign_id);
  return true;
}

async function applySubmissionResult(
  env: Env,
  job: RecipientJobRow,
  result: ManagedCampaignSubmissionResponse,
) {
  const now = new Date().toISOString();
  if (result.disposition === "accepted") {
    await updateJob(env, job.id, "accepted", null, now, null, result.acceptedAt);
    return;
  }
  if (result.disposition === "retry_later") {
    const nextAttempt = new Date(
      Date.now() + Math.max(1, result.retryAfterSeconds) * 1000,
    ).toISOString();
    await env.DB.prepare(
      `UPDATE email_campaign_recipient_jobs
       SET status = 'retry_wait', provider_reason = ?, next_attempt_at = ?,
           updated_at = ? WHERE id = ? AND status = 'submitting'`,
    )
      .bind(result.reason, nextAttempt, now, job.id)
      .run();
    return;
  }
  if (result.disposition === "delivery_unknown") {
    await markJobUnknown(env, job.id, "unknown_acceptance");
    return;
  }
  if (result.disposition === "in_progress") {
    await env.DB.prepare(
      `UPDATE email_campaign_recipient_jobs
       SET status = 'retry_wait', provider_reason = 'in_progress',
           next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'submitting'`,
    )
      .bind(new Date(Date.now() + 30_000).toISOString(), now, job.id)
      .run();
    return;
  }
  const status = result.disposition === "canceled" ? "cancelled" : "rejected";
  await updateJob(
    env,
    job.id,
    status,
    "reason" in result ? result.reason : null,
    now,
    now,
  );
}

async function reconcileUnknownCampaignJobs(env: Env, fetcher: typeof fetch) {
  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (!config) return;
  const unknown = await env.DB.prepare(
    `SELECT id, campaign_id FROM email_campaign_recipient_jobs
     WHERE status IN ('delivery_unknown', 'unresolved')
     ORDER BY updated_at LIMIT 20`,
  ).all<{ id: string; campaign_id: string }>();
  for (const job of unknown.results || []) {
    const response = await managedFetch(
      config,
      `/v1/managed-campaign/deliveries/${encodeURIComponent(job.id)}`,
      { method: "GET" },
      fetcher,
    ).catch(() => null);
    if (!response?.ok) continue;
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const state = typeof body?.state === "string" ? body.state : "";
    if (!state) continue;
    const mapped = cloudOperationJobStatus(state);
    if (!mapped) continue;
    await updateJob(
      env,
      job.id,
      mapped,
      typeof body?.reason === "string" ? body.reason : null,
      new Date().toISOString(),
      isTerminalJobStatus(mapped) ? new Date().toISOString() : null,
    );
    await refreshCampaignStatus(env, job.campaign_id);
  }
}

async function recoverStaleSubmittingJobs(env: Env) {
  await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'delivery_unknown', provider_reason = 'unknown_acceptance',
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'submitting' AND updated_at < datetime('now', '-5 minutes')`,
  ).run();
}

async function applySubscriberOutcome(
  env: Env,
  audienceMemberId: string | null,
  event: ManagedCampaignEvent,
) {
  if (!audienceMemberId) return;
  const member = await env.DB.prepare(
    "SELECT subscriber_id FROM email_campaign_audience_members WHERE id = ?",
  )
    .bind(audienceMemberId)
    .first<{ subscriber_id: number | null }>();
  if (!member?.subscriber_id) return;
  if (event.type === "recipient.unsubscribed") {
    await env.DB.prepare(
      `UPDATE subscribers
       SET unsubscribed_at = COALESCE(unsubscribed_at, ?),
           delivery_status = 'suppressed', delivery_status_changed_at = ?
       WHERE id = ?`,
    )
      .bind(event.occurredAt, event.occurredAt, member.subscriber_id)
      .run();
  } else if (event.type === "delivery.bounced") {
    await updateSubscriberDeliveryStatus(env, member.subscriber_id, "bounced", event.occurredAt);
  } else if (event.type === "delivery.complained") {
    await updateSubscriberDeliveryStatus(env, member.subscriber_id, "complained", event.occurredAt);
  } else if (event.type === "recipient.suppressed") {
    await updateSubscriberDeliveryStatus(env, member.subscriber_id, "suppressed", event.occurredAt);
  } else if (event.type === "recipient.unsuppressed") {
    await updateSubscriberDeliveryStatus(env, member.subscriber_id, "deliverable", event.occurredAt);
  }
}

async function updateSubscriberDeliveryStatus(
  env: Env,
  subscriberId: number,
  status: "deliverable" | "bounced" | "complained" | "suppressed",
  changedAt: string,
) {
  await env.DB.prepare(
    `UPDATE subscribers SET delivery_status = ?, delivery_status_changed_at = ?
     WHERE id = ?`,
  )
    .bind(status, changedAt, subscriberId)
    .run();
}

async function refreshCampaignStatus(env: Env, campaignId: string) {
  const campaign = await env.DB.prepare(
    "SELECT status, scheduled_for FROM email_campaigns WHERE id = ?",
  )
    .bind(campaignId)
    .first<{ status: string; scheduled_for: string | null }>();
  if (!campaign || campaign.status === "cancelled" || campaign.status === "draft") return;
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM email_campaign_recipient_jobs
     WHERE campaign_id = ? AND kind = 'campaign' GROUP BY status`,
  )
    .bind(campaignId)
    .all<{ status: string; count: number }>();
  const values = Object.fromEntries(
    (counts.results || []).map((row) => [row.status, Number(row.count)]),
  );
  const active = [
    "queued",
    "submitting",
    "accepted",
    "delayed",
    "retry_wait",
    "delivery_unknown",
    "unresolved",
    "paused",
  ].reduce((total, key) => total + (values[key] || 0), 0);
  let status = campaign.status;
  let sentAt: string | null = null;
  let failureReason: string | null = null;
  if (active > 0) {
    status =
      campaign.scheduled_for && Date.parse(campaign.scheduled_for) > Date.now()
        ? "scheduled"
        : "sending";
  } else {
    const delivered =
      (values.delivered || 0) +
      (values.bounced || 0) +
      (values.complained || 0) +
      (values.suppressed || 0);
    status = delivered > 0 ? "sent" : "failed";
    sentAt = delivered > 0 ? new Date().toISOString() : null;
    failureReason = delivered > 0 ? null : "No recipients were accepted";
  }
  await env.DB.prepare(
    `UPDATE email_campaigns
     SET status = ?, sent_at = COALESCE(?, sent_at), failure_reason = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  )
    .bind(status, sentAt, failureReason, campaignId)
    .run();
}

async function loadCampaignJobForDispatch(
  env: Env,
  jobId: string,
): Promise<RecipientJobRow | null> {
  return env.DB.prepare(
    `SELECT job.*, revision.subject, revision.reply_to_address,
            revision.document_json, revision.rendered_html,
            revision.rendered_text, campaign.sender_ref,
            member.permission_method, member.permission_granted_at
     FROM email_campaign_recipient_jobs job
     INNER JOIN email_campaign_revisions revision ON revision.id = job.revision_id
     INNER JOIN email_campaigns campaign ON campaign.id = job.campaign_id
     LEFT JOIN email_campaign_audience_members member
       ON member.id = job.audience_member_id
     WHERE job.id = ?`,
  )
    .bind(jobId)
    .first<RecipientJobRow>();
}

async function getCampaignJob(env: Env, jobId: string) {
  return env.DB.prepare(
    `SELECT id, kind, recipient_email AS recipient, status, provider_reason AS reason,
            attempt_count AS attemptCount, accepted_at AS acceptedAt,
            terminal_at AS terminalAt, created_at AS createdAt, updated_at AS updatedAt
     FROM email_campaign_recipient_jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first<Record<string, unknown>>();
}

async function requireDraftCampaign(env: Env, ownerId: string, campaignId: string) {
  const campaign = await getOwnedCampaign(env, ownerId, campaignId);
  if (!campaign) throw new CampaignInputError("Campaign not found", 404, "campaign_not_found");
  if (campaign.status !== "draft") {
    throw new CampaignInputError(
      "This campaign has already been queued",
      409,
      "campaign_already_queued",
    );
  }
  return campaign;
}

async function requireReadyTransport(env: Env, fetcher: typeof fetch) {
  const status = await getCampaignTransportStatus(env, fetcher);
  if (!status.managed) {
    throw new CampaignInputError(
      "Campaign sending requires a managed ME3 installation",
      409,
      "managed_installation_required",
    );
  }
  if (!status.ready || !status.sender) {
    throw new CampaignInputError(
      "The campaign sender is not ready",
      409,
      status.reason || "sender_not_ready",
    );
  }
  return status;
}

async function getManagedCampaignConfig(env: Env): Promise<ManagedCampaignConfig> {
  if (!isManagedRuntime(env)) throw new Error("managed_installation_required");
  const [coreInstallId, coreUpdateToken] = await Promise.all([
    getInstallSecret(env, CORE_INSTALL_ID_SECRET),
    getInstallSecret(env, CORE_UPDATE_TOKEN_SECRET),
  ]);
  if (!coreInstallId || !coreUpdateToken) throw new Error("managed_transport_not_configured");
  return {
    origin: getMe3CloudApiOrigin(env),
    coreInstallId,
    coreUpdateToken,
  };
}

async function managedFetch(
  config: ManagedCampaignConfig,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  const headers = new Headers(init.headers);
  headers.set("X-ME3-Core-Install-ID", config.coreInstallId);
  headers.set("X-ME3-Core-Update-Token", config.coreUpdateToken);
  return fetcher(new URL(path, config.origin), {
    ...init,
    redirect: "manual",
    headers,
  });
}

async function ensureCallbackSecret(
  env: Env,
  config: ManagedCampaignConfig,
  fetcher: typeof fetch,
) {
  if (await getInstallSecret(env, CALLBACK_SECRET)) return;
  const response = await managedFetch(
    config,
    "/v1/managed-campaign/callback-credentials",
    { method: "GET" },
    fetcher,
  );
  if (!response.ok || isRedirect(response.status)) return;
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const secret = typeof body?.callbackSecret === "string" ? body.callbackSecret : "";
  if (!/^[a-f0-9]{64}$/.test(secret)) return;
  await env.DB.prepare(
    `INSERT INTO install_secrets (name, value, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(CALLBACK_SECRET, secret)
    .run();
}

async function storeTransportStatus(
  env: Env,
  sender: CampaignTransportStatus["sender"],
  ready: boolean,
  reason: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO email_campaign_transport_state
     (id, sender_ref, from_address, sender_domain, ready, unavailable_reason,
      last_checked_at, updated_at)
     VALUES ('managed', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET sender_ref = excluded.sender_ref,
       from_address = excluded.from_address, sender_domain = excluded.sender_domain,
       ready = excluded.ready, unavailable_reason = excluded.unavailable_reason,
       last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      sender?.ref || null,
      sender?.fromAddress || null,
      sender?.domain || null,
      ready ? 1 : 0,
      reason,
    )
    .run();
}

async function getInstallSecret(env: Env, name: string): Promise<string> {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM install_secrets WHERE name = ?",
    )
      .bind(name)
      .first<{ value: string }>();
    return row?.value?.trim() || "";
  } catch {
    return "";
  }
}

async function verifyCallbackSignature(
  secret: string,
  timestamp: string,
  raw: string,
  signature: string,
) {
  const expected = await hmacHex(secret, `${timestamp}.${raw}`);
  const supplied = signature.startsWith("sha256=") ? signature.slice(7) : "";
  return constantTimeEqual(expected, supplied);
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function validCallbackTimestamp(value: string) {
  if (!/^\d{10}$/.test(value)) return false;
  const seconds = Number(value);
  return Math.abs(Date.now() / 1000 - seconds) <= CALLBACK_MAX_CLOCK_SKEW_SECONDS;
}

function eventJobStatus(type: ManagedCampaignEvent["type"]): string | null {
  return {
    "delivery.accepted": "accepted",
    "delivery.delivered": "delivered",
    "delivery.delayed": "delayed",
    "delivery.bounced": "bounced",
    "delivery.complained": "complained",
    "delivery.rejected": "rejected",
    "delivery.failed": "failed",
    "delivery.unknown": "delivery_unknown",
    "recipient.unsubscribed": "suppressed",
    "recipient.suppressed": "suppressed",
    "recipient.unsuppressed": null,
  }[type];
}

function cloudOperationJobStatus(state: string): string | null {
  return {
    processing: "delivery_unknown",
    accepted: "accepted",
    delivered: "delivered",
    delayed: "delayed",
    bounced: "bounced",
    complained: "complained",
    suppressed: "suppressed",
    rejected: "rejected",
    failed: "failed",
    delivery_unknown: "delivery_unknown",
    unresolved: "unresolved",
    canceled: "cancelled",
  }[state] || null;
}

function canApplyJobStatus(current: string, next: string) {
  if (["complained", "suppressed"].includes(current)) return false;
  if (current === "delivered") return ["complained", "suppressed"].includes(next);
  if (isTerminalJobStatus(current)) return false;
  return true;
}

function isTerminalJobStatus(status: string) {
  return [
    "delivered",
    "bounced",
    "complained",
    "suppressed",
    "rejected",
    "failed",
    "cancelled",
  ].includes(status);
}

async function updateJob(
  env: Env,
  jobId: string,
  status: string,
  reason: string | null,
  updatedAt: string,
  terminalAt: string | null,
  acceptedAt: string | null = null,
) {
  await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = ?, provider_reason = ?, accepted_at = COALESCE(?, accepted_at),
         terminal_at = COALESCE(?, terminal_at), updated_at = ? WHERE id = ?
       AND status NOT IN ('delivered', 'bounced', 'complained', 'suppressed',
                          'rejected', 'failed', 'cancelled')`,
  )
    .bind(status, reason, acceptedAt, terminalAt, updatedAt, jobId)
    .run();
}

async function pauseJob(env: Env, jobId: string, reason: string) {
  await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'paused', provider_reason = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'submitting'`,
  )
    .bind(reason, jobId)
    .run();
}

async function markJobUnknown(env: Env, jobId: string, reason: string) {
  await env.DB.prepare(
    `UPDATE email_campaign_recipient_jobs
     SET status = 'delivery_unknown', provider_reason = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'submitting'`,
  )
    .bind(reason, jobId)
    .run();
}

async function runStatementChunks(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) {
    const chunk = statements.slice(index, index + 80);
    if (typeof db.batch === "function") await db.batch(chunk);
    else for (const statement of chunk) await statement.run();
  }
}

function normalizeSchedule(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return new Date().toISOString();
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new CampaignInputError("Choose a valid send time", 400, "schedule_invalid");
  }
  const scheduled = new Date(value);
  if (scheduled.getTime() < Date.now() - 60_000) {
    throw new CampaignInputError("The send time is in the past", 400, "schedule_in_past");
  }
  return scheduled.toISOString();
}

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function unavailableTransport(
  managed: boolean,
  reason: string,
  addOn: CampaignAddOnStatus | null = null,
  instructions: string[] = [],
): CampaignTransportStatus {
  return {
    available: false,
    managed,
    ready: false,
    reason,
    sender: null,
    addOn,
    instructions,
  };
}

async function managedCampaignBillingAction(
  env: Env,
  path: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<{ url: string }> {
  const config = await getManagedCampaignConfig(env).catch(() => null);
  if (!config) {
    throw new CampaignInputError(
      "Managed campaign billing is available only on Hosted by ME3",
      409,
      "managed_installation_required",
    );
  }
  const response = await managedFetch(
    config,
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    fetcher,
  );
  const result = await response.json().catch(() => null) as
    | { url?: unknown; error?: unknown; code?: unknown }
    | null;
  if (!response.ok || isRedirect(response.status) || typeof result?.url !== "string") {
    throw new CampaignInputError(
      typeof result?.error === "string" ? result.error : "Campaign billing is unavailable",
      response.status === 400 ? 400 : response.status === 503 ? 503 : 409,
      typeof result?.code === "string" ? result.code : "campaign_billing_unavailable",
    );
  }
  return { url: result.url };
}

function normalizeCampaignAddOnStatus(value: unknown): CampaignAddOnStatus | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CampaignAddOnStatus>;
  if (
    typeof candidate.available !== "boolean" ||
    typeof candidate.entitled !== "boolean" ||
    typeof candidate.allowance !== "number" ||
    typeof candidate.used !== "number" ||
    typeof candidate.remaining !== "number" ||
    typeof candidate.resetAt !== "string" ||
    !Array.isArray(candidate.plans)
  ) {
    return null;
  }
  const plans = candidate.plans.filter((plan) =>
    Boolean(
      plan &&
        CAMPAIGN_ADD_ON_PLANS.some((known) => known.key === plan.key) &&
        typeof plan.allowance === "number" &&
        typeof plan.monthlyPriceUsd === "number" &&
        typeof plan.checkoutAvailable === "boolean",
    ),
  );
  if (plans.length !== CAMPAIGN_ADD_ON_PLANS.length) return null;
  return { ...candidate, plans } as CampaignAddOnStatus;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

function changeCount(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes || 0);
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
