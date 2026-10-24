import { describe, expect, it } from "vitest";
import { getCampaignResults, recentCampaignBriefingLines } from "./campaign-results";
import { listSiteAudience } from "./campaigns";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import type { Env } from "./types";

const SENT_AT = "2026-10-20T09:00:00.000Z";

function sentCampaignFixture() {
  const fixture = mailboxFixture();
  const env = fixture.env as unknown as Env;
  fixture.raw.exec(`
    INSERT INTO sites(id, user_id, username, site_role) VALUES ('site-1', 'alice', 'willowyoga', 'profile');
    INSERT INTO subscribers(id, site_id, email, unsubscribed_at, marketing_status, marketing_permission_method)
      VALUES (1, 'site-1', 'ann@example.test', NULL, 'marketable', 'double_opt_in'),
             (2, 'site-1', 'ben@example.test', '2026-10-21 08:00:00', 'marketable', 'double_opt_in'),
             (3, 'site-1', 'cat@example.test', NULL, 'marketable', 'double_opt_in'),
             (4, 'site-1', 'dan@example.test', NULL, 'marketable', 'double_opt_in'),
             (5, 'site-1', 'eve@example.test', NULL, 'marketable', 'double_opt_in'),
             (6, 'site-1', 'new@example.test', NULL, 'marketable', 'double_opt_in');
    INSERT INTO email_campaigns(id, site_id, name, status, sent_at, current_revision_id)
      VALUES ('campaign-1', 'site-1', 'September', 'sent', '${SENT_AT}', 'revision-1');
    INSERT INTO email_campaign_revisions(id, campaign_id, revision_number, subject, document_version, document_json)
      VALUES ('revision-1', 'campaign-1', 1, 'September newsletter', 'me3.campaign-document.v1', '{}');
    INSERT INTO email_campaign_audience_snapshots(id, campaign_id, revision_id, site_id)
      VALUES ('snapshot-1', 'campaign-1', 'revision-1', 'site-1');
  `);
  const people: Array<[number, string, string]> = [
    [1, "ann@example.test", "delivered"],
    [2, "ben@example.test", "suppressed"],
    [3, "cat@example.test", "bounced"],
    [4, "dan@example.test", "complained"],
    [5, "eve@example.test", "rejected"],
  ];
  for (const [id, email, status] of people) {
    fixture.raw.exec(`
      INSERT INTO email_campaign_audience_members(id, snapshot_id, subscriber_id, normalized_email, permission_method, permission_granted_at, permission_evidence_json)
        VALUES ('member-${id}', 'snapshot-1', ${id}, '${email}', 'double_opt_in', '2026-01-01', '{}');
      INSERT INTO email_campaign_recipient_jobs(id, campaign_id, revision_id, audience_member_id, kind, recipient_ref, recipient_email, status, next_attempt_at)
        VALUES ('job-${id}', 'campaign-1', 'revision-1', 'member-${id}', 'campaign', 'ref-${id}', '${email}', '${status}', '${SENT_AT}');
    `);
  }
  return { ...fixture, env };
}

function addInbound(raw: { exec(sql: string): void }, id: string, from: string, subject: string, receivedAt: string) {
  raw.exec(`INSERT INTO mailbox_messages(id, mailbox_id, direction, message_kind, status, from_address, subject, folder, created_by, received_at)
    VALUES ('${id}', 'alice-mailbox', 'inbound', 'email', 'received', '${from}', '${subject}', 'inbox', 'provider', '${receivedAt}')`);
}

describe("campaign results", () => {
  it("counts delivered, unsubscribed, spam and didn't arrive with plain reasons", async () => {
    const { env } = sentCampaignFixture();

    const results = await getCampaignResults(env, "campaign-1");

    expect(results).toMatchObject({
      sentTo: 5,
      // Ann delivered, Ben unsubscribed after it arrived, Dan marked it as spam after it arrived.
      delivered: 3,
      unsubscribed: 1,
      markedSpam: 1,
      didntArrive: 2,
      didntArriveReasons: { bounced: 1, blocked: 0, refused: 1, failed: 0 },
    });
  });

  it("counts replies from recipients about this campaign, newest first", async () => {
    const { env, raw } = sentCampaignFixture();
    addInbound(raw, "reply-1", "Ann <ann@example.test>", "Re: September newsletter", "2026-10-20 10:00:00");
    addInbound(raw, "reply-2", "dan@example.test", "RE: september newsletter", "2026-10-21 10:00:00");
    addInbound(raw, "other-sender", "stranger@example.test", "Re: September newsletter", "2026-10-20 11:00:00");
    addInbound(raw, "other-subject", "ann@example.test", "Booking question", "2026-10-20 12:00:00");
    addInbound(raw, "before-send", "ann@example.test", "Re: September newsletter", "2026-10-19 12:00:00");

    const results = await getCampaignResults(env, "campaign-1");

    expect(results.replies).toBe(2);
    expect(results.replyMessages.map((reply) => reply.messageId)).toEqual(["reply-2", "reply-1"]);
  });

  it("sends again only to subscribers the campaign didn't reach", async () => {
    const { env } = sentCampaignFixture();

    const audience = await listSiteAudience(env, "site-1", { kind: "all", notSentBy: "campaign-1" });

    expect(audience.map((subscriber) => subscriber.email)).toEqual(["new@example.test"]);
  });

  it("gives the morning briefing one line per recent campaign", async () => {
    const { env, raw } = sentCampaignFixture();
    addInbound(raw, "reply-1", "ann@example.test", "Re: September newsletter", "2026-10-20 10:00:00");

    expect(await recentCampaignBriefingLines(env, "2026-10-19T09:00:00.000Z")).toEqual([
      "Your email “September newsletter” reached 3 people. 1 reply so far.",
    ]);
    expect(await recentCampaignBriefingLines(env, "2026-10-21T09:00:00.000Z")).toEqual([]);
  });
});
