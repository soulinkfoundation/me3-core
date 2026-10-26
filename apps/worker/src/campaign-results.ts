import { isOwnerSenderRef } from "./campaign-owner-sender";
import type { Env } from "./types";

export type CampaignReply = {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
};

export type CampaignResults = {
  sentTo: number;
  delivered: number;
  replies: number;
  replyMessages: CampaignReply[];
  unsubscribed: number;
  markedSpam: number;
  didntArrive: number;
  didntArriveReasons: Record<"bounced" | "blocked" | "refused" | "failed", number>;
};

const MAX_REPLY_MESSAGES = 20;

/**
 * How a sent campaign went, from the recipient jobs and the owner's inbox. No open or click
 * tracking: replies are inbound mail from a recipient whose subject contains the campaign's.
 * A job only keeps its latest status, so someone who unsubscribed or marked it as spam still
 * counts as delivered (it had to arrive for them to do that). Dates are compared through
 * datetime() because rows mix ISO and SQLite timestamp formats. A self-hosted owner's own provider
 * may never report delivery, so there its acceptance counts as delivered.
 */
export async function getCampaignResults(
  env: Env,
  campaignId: string,
): Promise<CampaignResults> {
  const campaign = await env.DB.prepare(
    `SELECT campaign.sent_at, campaign.updated_at, campaign.sender_ref, revision.subject
     FROM email_campaigns campaign
     LEFT JOIN email_campaign_revisions revision ON revision.id = campaign.current_revision_id
     WHERE campaign.id = ?`,
  )
    .bind(campaignId)
    .first<{ sent_at: string | null; updated_at: string; sender_ref: string | null; subject: string | null }>();
  const acceptedIsDelivered = isOwnerSenderRef(campaign?.sender_ref);
  const since = campaign?.sent_at || campaign?.updated_at || "1970-01-01";

  const jobs = await env.DB.prepare(
    `SELECT job.status,
            CASE WHEN subscriber.unsubscribed_at IS NOT NULL AND datetime(subscriber.unsubscribed_at) >= datetime(?)
              THEN 1 ELSE 0 END AS unsubscribed_after,
            COUNT(*) AS count
     FROM email_campaign_recipient_jobs job
     LEFT JOIN email_campaign_audience_members member ON member.id = job.audience_member_id
     LEFT JOIN subscribers subscriber ON subscriber.id = member.subscriber_id
     WHERE job.campaign_id = ? AND job.kind = 'campaign'
     GROUP BY job.status, unsubscribed_after`,
  )
    .bind(since, campaignId)
    .all<{ status: string; unsubscribed_after: number; count: number }>();

  const results: CampaignResults = {
    sentTo: 0,
    delivered: 0,
    replies: 0,
    replyMessages: [],
    unsubscribed: 0,
    markedSpam: 0,
    didntArrive: 0,
    didntArriveReasons: { bounced: 0, blocked: 0, refused: 0, failed: 0 },
  };
  for (const row of jobs.results || []) {
    const count = Number(row.count) || 0;
    const unsubscribedAfter = Number(row.unsubscribed_after) === 1;
    results.sentTo += count;
    if (unsubscribedAfter) results.unsubscribed += count;
    if (row.status === "delivered" || (acceptedIsDelivered && row.status === "accepted")) results.delivered += count;
    else if (row.status === "complained") {
      results.delivered += count;
      results.markedSpam += count;
    } else if (row.status === "suppressed" && unsubscribedAfter) results.delivered += count;
    else if (row.status === "bounced") results.didntArriveReasons.bounced += count;
    else if (row.status === "suppressed") results.didntArriveReasons.blocked += count;
    else if (row.status === "rejected") results.didntArriveReasons.refused += count;
    else if (row.status === "failed" || row.status === "cancelled") results.didntArriveReasons.failed += count;
  }
  results.didntArrive = Object.values(results.didntArriveReasons).reduce((sum, count) => sum + count, 0);

  const subject = campaign?.subject?.trim();
  if (subject && results.sentTo) {
    const replies = await env.DB.prepare(
      `SELECT message.id, message.from_address, message.subject,
              COALESCE(message.received_at, message.created_at) AS received_at
       FROM mailbox_messages message
       WHERE message.direction = 'inbound'
         AND message.folder != 'trash'
         AND datetime(COALESCE(message.received_at, message.created_at)) >= datetime(?)
         AND instr(LOWER(COALESCE(message.subject, '')), LOWER(?)) > 0
         AND EXISTS (
           SELECT 1 FROM email_campaign_recipient_jobs job
           WHERE job.campaign_id = ? AND job.kind = 'campaign'
             AND instr(LOWER(COALESCE(message.from_address, '')), LOWER(job.recipient_email)) > 0
         )
       ORDER BY received_at DESC`,
    )
      .bind(since, subject, campaignId)
      .all<{ id: string; from_address: string | null; subject: string | null; received_at: string }>()
      .catch(() => ({ results: [] as Array<{ id: string; from_address: string | null; subject: string | null; received_at: string }> }));
    const rows = replies.results || [];
    results.replies = rows.length;
    results.replyMessages = rows.slice(0, MAX_REPLY_MESSAGES).map((row) => ({
      messageId: row.id,
      from: row.from_address || "",
      subject: row.subject || "",
      receivedAt: row.received_at,
    }));
  }
  return results;
}

/** One line per campaign sent since `since`, for the morning briefing. */
export async function recentCampaignBriefingLines(env: Env, since: string): Promise<string[]> {
  const sent = await env.DB.prepare(
    `SELECT campaign.id, revision.subject
     FROM email_campaigns campaign
     LEFT JOIN email_campaign_revisions revision ON revision.id = campaign.current_revision_id
     WHERE campaign.status = 'sent' AND datetime(campaign.sent_at) >= datetime(?)
     ORDER BY campaign.sent_at DESC LIMIT 3`,
  )
    .bind(since)
    .all<{ id: string; subject: string | null }>()
    .catch(() => ({ results: [] as Array<{ id: string; subject: string | null }> }));
  const lines: string[] = [];
  for (const campaign of sent.results || []) {
    const results = await getCampaignResults(env, campaign.id).catch(() => null);
    if (!results) continue;
    const people = `${results.delivered} ${results.delivered === 1 ? "person" : "people"}`;
    const replies = results.replies
      ? ` ${results.replies} ${results.replies === 1 ? "reply" : "replies"} so far.`
      : "";
    lines.push(`Your email “${campaign.subject?.trim() || "No subject"}” reached ${people}.${replies}`);
  }
  return lines;
}
