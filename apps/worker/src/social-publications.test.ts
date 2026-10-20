import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SOCIAL_PUBLISH_DLQ_NAME,
  SOCIAL_PUBLISH_QUEUE_NAME,
  SocialPublishingInputError,
  cancelPublication,
  createPostVersionPublication,
  disconnectSocialPublishingAccount,
  dispatchDueSocialPublications,
  listApprovedPostVersionsForScheduling,
  listPostVersionPublications,
  processSocialPublishBatch,
  publishQueuedPublication,
  recoverStrandedQueuedSocialPublications,
  reschedulePublication,
  resolvePublicationOutcome,
  updateSocialPublishingAccountDefaults,
  updatePostVersion,
  type Publication,
} from "@me3-core/plugin-social-publishing";

describe("reusable social Publications", () => {
  let fixture: ReturnType<typeof createFixture>;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fixture.close();
    vi.unstubAllGlobals();
  });

  it("creates multiple schedules for one approved Version and rejects an exact duplicate", async () => {
    const firstTime = "2099-08-01T09:00:00.000Z";
    const secondTime = "2099-08-02T09:00:00.000Z";

    const first = await createPublication(fixture, "version-1", {
      scheduledFor: firstTime,
      timezone: "Europe/Dublin",
      requestContext: { plan: "launch" },
    });
    const second = await createPublication(fixture, "version-1", {
      scheduledFor: secondTime,
      timezone: "Europe/Dublin",
      requestContext: { plan: "follow-up" },
    });

    expect(first).toMatchObject({
      versionId: "version-1",
      status: "scheduled",
      scheduledFor: firstTime,
      timezone: "Europe/Dublin",
      requestedByType: "owner",
      requestedByUserId: "owner",
      requestContext: { plan: "launch" },
    });
    expect(second.id).not.toBe(first.id);
    expect(fixture.queueMessages).toEqual([]);

    const duplicateError = await createPostVersionPublication(
      fixture.env as never,
      "owner",
      "version-1",
      { scheduledFor: firstTime, timezone: "Europe/Dublin" },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(duplicateError).toBeInstanceOf(SocialPublishingInputError);
    expect(duplicateError).toMatchObject({
      status: 409,
      message: "This Version already has a Publication at that time",
    });

    const listed = await listPostVersionPublications(
      fixture.env as never,
      "owner",
      "version-1",
    );
    expect(listed).toHaveLength(2);
    expect(listed.map((publication) => publication.id)).toEqual([second.id, first.id]);

    await expect(
      cancelPublication(fixture.env as never, "owner", first.id),
    ).resolves.toMatchObject({ id: first.id, status: "cancelled" });
    expect(
      JSON.parse(
        fixture.db.first<{ payload_json: string }>(
          `SELECT payload_json FROM social_publication_events
           WHERE publication_id = ? AND event_type = 'cancelled'
           ORDER BY rowid DESC LIMIT 1`,
          first.id,
        )?.payload_json || "{}",
      ),
    ).toMatchObject({ action: "cancelled", reason: "owner_request" });
  });

  it("lets an interleaved Version edit win before guarded schedule creation", async () => {
    fixture.db.beforeNextBatch = async () => {
      await updatePostVersion(
        fixture.env as never,
        "owner",
        "version-1",
        { bodyText: "Edited while Calendar was scheduling" },
      );
    };

    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
        {
          scheduledFor: "2099-08-01T09:00:00.000Z",
          timezone: "Europe/Dublin",
        },
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "Approve this exact LinkedIn Version before scheduling",
    });

    expect(
      fixture.db.first<{ body_text: string; approval_status: string }>(
        `SELECT body_text, approval_status FROM social_variants
         WHERE id = 'version-1'`,
      ),
    ).toEqual({
      body_text: "Edited while Calendar was scheduling",
      approval_status: "draft",
    });
    expect(
      fixture.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM social_publications",
      ),
    ).toEqual({ count: 0 });
    expect(
      fixture.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM social_publication_events",
      ),
    ).toEqual({ count: 0 });
  });

  it("rejects private Files media before creating a Publication when delivery is not configured", async () => {
    fixture.db.run(
      `UPDATE social_variants
       SET asset_manifest_json = ?
       WHERE id = 'version-1'`,
      JSON.stringify([{
        url: "/api/files/file-private-1/content",
        fileId: "file-private-1",
        filename: "private.png",
        mimeType: "image/png",
        kind: "image",
        byteLength: 4,
      }]),
    );

    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
      ),
    ).rejects.toMatchObject({
      status: 424,
      message: "ME3 needs an exact public API origin before private Files media can be delivered.",
    });

    fixture.env.CORE_API_ORIGIN = "https://core.example";
    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
      ),
    ).rejects.toMatchObject({
      status: 424,
      message: "ME3 needs Files storage before private media can be delivered.",
    });

    expect(
      fixture.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM social_publications",
      ),
    ).toEqual({ count: 0 });
    expect(
      fixture.db.first<{ approval_status: string }>(
        "SELECT approval_status FROM social_variants WHERE id = 'version-1'",
      ),
    ).toEqual({ approval_status: "approved" });
  });

  it("rolls back and safely retries scheduled Publication creation with its audit", async () => {
    const scheduledFor = "2099-08-01T09:00:00.000Z";
    fixture.db.failNextBatchAfterFirst = true;

    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
        { scheduledFor, timezone: "Europe/Dublin" },
      ),
    ).rejects.toThrow();

    expect(
      fixture.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM social_publications",
      ),
    ).toEqual({ count: 0 });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE event_type = 'scheduled'`,
      ),
    ).toEqual({ count: 0 });

    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
        { scheduledFor, timezone: "Europe/Dublin" },
      ),
    ).resolves.toMatchObject({ status: "scheduled", scheduledFor });
    expect(
      fixture.db.first<{ count: number }>(
        "SELECT COUNT(*) AS count FROM social_publications",
      ),
    ).toEqual({ count: 1 });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE event_type = 'scheduled'`,
      ),
    ).toEqual({ count: 1 });
  });

  it("describes the blocked action as scheduling for imported read-only Posts", async () => {
    fixture.db.run(
      "UPDATE social_packages SET source_type = 'legacy_content_bank_read_only' WHERE id = 'post-1'",
    );

    await expect(
      createPostVersionPublication(
        fixture.env as never,
        "owner",
        "version-1",
        {
          scheduledFor: "2099-08-01T09:00:00.000Z",
          timezone: "Europe/Dublin",
        },
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: "This imported Post is read-only. Create a source-backed Post before scheduling.",
    });
  });

  it("rolls back both owner cancellation and its audit event when the batch fails", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-08-01T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    fixture.db.failNextBatchAfterFirst = true;

    await expect(
      cancelPublication(fixture.env as never, "owner", publication.id),
    ).rejects.toThrow();

    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({ status: "scheduled", error_code: null });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'cancelled'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("reschedules only time and timezone while preserving exact-Version approval", async () => {
    const originalTime = "2099-08-01T09:00:00.000Z";
    const nextTime = "2099-08-03T14:15:00.000Z";
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: originalTime,
      timezone: "Europe/Dublin",
    });
    const approvalBefore = fixture.db.first<{
      approval_status: string;
      approved_at: string;
      approved_by_user_id: string;
    }>(
      `SELECT approval_status, approved_at, approved_by_user_id
       FROM social_variants WHERE id = 'version-1'`,
    );

    const change = await reschedulePublication(
      fixture.env as never,
      "owner",
      publication.id,
      {
        scheduledFor: nextTime,
        timezone: "America/New_York",
        expectedUpdatedAt: publication.updatedAt,
        requestContext: { source: "calendar", view: "week" },
      },
    );

    expect(change).toMatchObject({
      action: "rescheduled",
      previousScheduledFor: originalTime,
      previousTimezone: "Europe/Dublin",
      approvalPreserved: true,
      auditEvent: "scheduled",
      publication: {
        id: publication.id,
        versionId: "version-1",
        status: "scheduled",
        scheduledFor: nextTime,
        timezone: "America/New_York",
      },
    });
    expect(
      fixture.db.first(
        `SELECT approval_status, approved_at, approved_by_user_id
         FROM social_variants WHERE id = 'version-1'`,
      ),
    ).toEqual(approvalBefore);
    const audit = fixture.db.first<{ event_type: string; payload_json: string }>(
      `SELECT event_type, payload_json FROM social_publication_events
       WHERE publication_id = ? ORDER BY rowid DESC LIMIT 1`,
      publication.id,
    );
    expect(audit?.event_type).toBe("scheduled");
    expect(JSON.parse(audit?.payload_json || "{}")).toMatchObject({
      action: "rescheduled",
      surface: "calendar",
      previous: { scheduledFor: originalTime, timezone: "Europe/Dublin" },
      next: { scheduledFor: nextTime, timezone: "America/New_York" },
      approvalPreserved: true,
      requestContext: { source: "calendar", view: "week" },
    });
  });

  it("rejects stale, unauthorized, invalid-timezone, unapproved, and unsafe reschedules", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-08-01T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });

    await expect(
      reschedulePublication(
        fixture.env as never,
        "another-owner",
        publication.id,
        {
          scheduledFor: "2099-08-02T09:00:00.000Z",
          timezone: "Europe/Dublin",
          expectedUpdatedAt: publication.updatedAt,
        },
      ),
    ).resolves.toBeNull();
    await expect(
      reschedulePublication(fixture.env as never, "owner", publication.id, {
        scheduledFor: "2099-08-02T09:00:00.000Z",
        timezone: "Not/A_Timezone",
        expectedUpdatedAt: publication.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 400, message: "Choose a valid timezone" });

    const changed = await reschedulePublication(
      fixture.env as never,
      "owner",
      publication.id,
      {
        scheduledFor: "2099-08-02T09:00:00.000Z",
        timezone: "Europe/Dublin",
        expectedUpdatedAt: publication.updatedAt,
      },
    );
    await expect(
      reschedulePublication(fixture.env as never, "owner", publication.id, {
        scheduledFor: "2099-08-03T09:00:00.000Z",
        timezone: "Europe/Dublin",
        expectedUpdatedAt: publication.updatedAt,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "This Publication changed after Calendar loaded it. Refresh and try again.",
    });

    fixture.db.run(
      "UPDATE social_variants SET approval_status = 'draft' WHERE id = 'version-1'",
    );
    await expect(
      reschedulePublication(fixture.env as never, "owner", publication.id, {
        scheduledFor: "2099-08-03T09:00:00.000Z",
        timezone: "Europe/Dublin",
        expectedUpdatedAt: changed!.publication.updatedAt,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Approve this exact Version before changing its schedule",
    });

    fixture.db.run(
      `UPDATE social_variants SET approval_status = 'approved' WHERE id = 'version-1'`,
    );
    fixture.db.run(
      `UPDATE social_variants SET platform = 'youtube' WHERE id = 'version-1'`,
    );
    fixture.db.run(
      `UPDATE social_publications SET platform = 'youtube' WHERE id = ?`,
      publication.id,
    );
    await expect(
      reschedulePublication(fixture.env as never, "owner", publication.id, {
        scheduledFor: "2099-08-03T09:00:00.000Z",
        timezone: "Europe/Dublin",
        expectedUpdatedAt: changed!.publication.updatedAt,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "YouTube Versions cannot be scheduled yet",
    });
    fixture.db.run(
      `UPDATE social_variants SET platform = 'linkedin' WHERE id = 'version-1'`,
    );
    fixture.db.run(
      `UPDATE social_publications SET platform = 'linkedin' WHERE id = ?`,
      publication.id,
    );
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           updated_at = '2099-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );
    await expect(
      reschedulePublication(fixture.env as never, "owner", publication.id, {
        scheduledFor: "2099-08-03T09:00:00.000Z",
        timezone: "Europe/Dublin",
        expectedUpdatedAt: "2099-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Only a planned Publication can be rescheduled",
    });
  });

  it("offers Calendar only owner-owned approved Versions on schedule-capable platforms", async () => {
    seedApprovedVersion(fixture.db, {
      postId: "post-x",
      versionId: "version-x",
      bodyText: "Approved but unsupported",
      platform: "x",
      accountId: "account-x",
    });
    seedApprovedVersion(fixture.db, {
      postId: "post-draft",
      versionId: "version-draft",
      bodyText: "Not approved",
      approvalStatus: "draft",
    });
    fixture.db.run(
      `INSERT INTO sites (id, user_id) VALUES ('site-other', 'another-owner')`,
    );
    fixture.db.run(
      `INSERT INTO social_accounts (
         id, user_id, site_id, platform, platform_account_id, display_name,
         status, scopes_json, metadata_json, created_at, updated_at
       ) VALUES (
         'account-other', 'another-owner', 'site-other', 'linkedin',
         'linkedin-account-other', 'Another owner', 'active', '[]', '{}',
         datetime('now'), datetime('now')
       )`,
    );
    seedApprovedVersion(fixture.db, {
      postId: "post-other",
      versionId: "version-other",
      bodyText: "Someone else's approved Post",
      siteId: "site-other",
      accountId: "account-other",
    });

    const versions = await listApprovedPostVersionsForScheduling(
      fixture.env as never,
      "owner",
      "site-1",
    );

    expect(versions).toEqual([
      expect.objectContaining({
        versionId: "version-x",
        postId: "post-x",
        siteId: "site-1",
        platform: "x",
        accountId: "account-x",
        accountLabel: "X account",
        sourceLabel: "Journal",
      }),
      expect.objectContaining({
        versionId: "version-1",
        postId: "post-1",
        siteId: "site-1",
        platform: "linkedin",
        accountId: "account-1",
        accountLabel: "LinkedIn account",
        sourceLabel: "Journal",
      }),
    ]);
    expect(JSON.stringify(versions).toLowerCase()).not.toContain("variant");
    expect(JSON.stringify(versions).toLowerCase()).not.toContain("package");
    expect(JSON.stringify(versions).toLowerCase()).not.toContain("occurrence");
  });

  it("allows another immediate Publication after a completed Publication", async () => {
    const first = await createPublication(fixture, "version-1");
    expect(first.status).toBe("queued");

    fixture.db.run(
      `UPDATE social_publications
       SET status = 'published', platform_post_id = 'linkedin-first',
           platform_post_url = 'https://linkedin.example/posts/first',
           published_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      first.id,
    );

    const second = await createPublication(fixture, "version-1");
    expect(second).toMatchObject({ versionId: "version-1", status: "queued" });
    expect(second.id).not.toBe(first.id);
    expect(fixture.queueMessages).toEqual([
      { publicationId: first.id },
      { publicationId: second.id },
    ]);

    const history = await listPostVersionPublications(
      fixture.env as never,
      "owner",
      "version-1",
    );
    expect(history.map(({ id, status }) => ({ id, status }))).toEqual(
      expect.arrayContaining([
        { id: first.id, status: "published" },
        { id: second.id, status: "queued" },
      ]),
    );
  });

  it("retries the queue handoff for an existing queued Publication", async () => {
    fixture.send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(createPublication(fixture, "version-1")).rejects.toThrow(
      "queue unavailable",
    );
    const stranded = fixture.db.first<{ id: string; status: string }>(
      "SELECT id, status FROM social_publications WHERE variant_id = 'version-1'",
    );
    expect(stranded?.status).toBe("queued");
    expect(fixture.queueMessages).toEqual([]);

    const resumed = await createPublication(fixture, "version-1");
    expect(resumed).toMatchObject({ id: stranded?.id, status: "queued" });
    expect(fixture.queueMessages).toEqual([{ publicationId: stranded?.id }]);
  });

  it("delays two retryable provider attempts before terminal exhaustion", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(503);
    vi.stubGlobal("fetch", fetcher);

    const firstAttempt = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [firstAttempt] },
      fixture.env as never,
    );
    expect(firstAttempt.ack).not.toHaveBeenCalled();
    expect(firstAttempt.retry).toHaveBeenCalledOnce();
    expect(firstAttempt.retry).toHaveBeenCalledWith({ delaySeconds: 60 });

    const secondAttempt = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [secondAttempt] },
      fixture.env as never,
    );
    expect(secondAttempt.ack).not.toHaveBeenCalled();
    expect(secondAttempt.retry).toHaveBeenCalledOnce();
    expect(secondAttempt.retry).toHaveBeenCalledWith({ delaySeconds: 300 });

    const finalAttempt = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [finalAttempt] },
      fixture.env as never,
    );
    expect(finalAttempt.ack).toHaveBeenCalledOnce();
    expect(finalAttempt.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(6);

    expect(fixture.db.first<{ status: string; error_code: string; error_message: string }>(
      `SELECT status, error_code, error_message
       FROM social_publications WHERE id = ?`,
      publication.id,
    )).toEqual({
      status: "failed",
      error_code: "retryable:linkedin_post_error",
      error_message: "Provider temporarily unavailable",
    });
    const retriedEvents = await fixture.db.prepare(
      `SELECT payload_json FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'retried'
       ORDER BY rowid ASC`,
    ).bind(publication.id).all<{ payload_json: string }>();
    expect(retriedEvents.results.map((event) => JSON.parse(event.payload_json))).toEqual([
      { attempt: 1, nextAttempt: 2, delaySeconds: 60 },
      { attempt: 2, nextAttempt: 3, delaySeconds: 300 },
    ]);
    expect(fixture.db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'publishing'`,
      publication.id,
    )).toEqual({ count: 3 });
  });

  it("rechecks a stored TikTok publish id without uploading the video twice", async () => {
    fixture.db.run(
      `INSERT INTO social_accounts (
         id, user_id, site_id, platform, platform_account_id, display_name, status,
         scopes_json, metadata_json, access_token_ciphertext, created_at, updated_at
       ) VALUES (?, 'owner', 'site-1', 'tiktok', 'tiktok-owner', 'TikTok account', 'active',
                 '["video.upload"]', '{}', ?, datetime('now'), datetime('now'))`,
      "account-tiktok",
      await encryptTestSecret("tiktok-access-token", TEST_TOKEN_ENCRYPTION_KEY),
    );
    seedApprovedVersion(fixture.db, {
      postId: "post-tiktok",
      versionId: "version-tiktok",
      bodyText: "Editable in TikTok.",
      platform: "tiktok",
      accountId: "account-tiktok",
    });
    fixture.db.run(
      `UPDATE social_variants
       SET format = 'short_video',
           asset_manifest_json = ?
       WHERE id = 'version-tiktok'`,
      JSON.stringify([{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }]),
    );
    fixture.env.SITE_ASSETS = {};

    const publication = await createPublication(fixture, "version-tiktok", {
      requestContext: {
        tiktok: { deliveryMode: "provider_draft" },
      },
    });
    fixture.db.run(
      `UPDATE social_publications
       SET error_code = 'retryable:tiktok_processing_pending',
           error_message = 'TikTok is still processing the video.',
           provider_response_json = ?
       WHERE id = ?`,
      JSON.stringify({
        publishId: "pending-tiktok-draft",
        status: { data: { status: "PROCESSING_UPLOAD" } },
      }),
      publication.id,
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://open.tiktokapis.com/v2/post/publish/status/fetch/");
      expect(JSON.parse(String(init?.body))).toEqual({
        publish_id: "pending-tiktok-draft",
      });
      return Response.json({
        data: { status: "SEND_TO_USER_INBOX", uploaded_bytes: 4 },
        error: { code: "ok" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const resumedAttempt = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [resumedAttempt] },
      fixture.env as never,
    );

    expect(resumedAttempt.ack).toHaveBeenCalledOnce();
    expect(resumedAttempt.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fixture.db.first<{
      status: string;
      platform_post_id: string;
    }>(
      `SELECT status, platform_post_id
       FROM social_publications WHERE id = ?`,
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "pending-tiktok-draft",
    });
  });

  it("uses account-wide YouTube defaults when the queued upload runs", async () => {
    fixture.db.run(
      `INSERT INTO social_accounts (
         id, user_id, site_id, platform, platform_account_id, display_name, status,
         scopes_json, metadata_json, access_token_ciphertext, created_at, updated_at
       ) VALUES (?, 'owner', 'site-1', 'youtube', 'channel-1', 'YouTube channel', 'active',
                 '["youtube.upload"]', '{}', ?, datetime('now'), datetime('now'))`,
      "account-youtube",
      await encryptTestSecret("youtube-access-token", TEST_TOKEN_ENCRYPTION_KEY),
    );
    seedApprovedVersion(fixture.db, {
      postId: "post-youtube",
      versionId: "version-youtube",
      bodyText: "A concise YouTube description.",
      platform: "youtube",
      accountId: "account-youtube",
    });
    const youtubeSettings = {
      privacyStatus: "unlisted",
      madeForKids: false,
      containsSyntheticMedia: true,
    };
    await updateSocialPublishingAccountDefaults(
      fixture.env as never,
      "owner",
      "account-youtube",
      { youtube: youtubeSettings },
    );
    fixture.db.run(
      `UPDATE social_variants
       SET format = 'short_video',
           title = 'Saved YouTube title',
           asset_manifest_json = ?
       WHERE id = 'version-youtube'`,
      JSON.stringify([{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }]),
    );

    const publication = await createPublication(fixture, "version-youtube");
    expect(JSON.parse(fixture.db.first<{ request_context_json: string }>(
      "SELECT request_context_json FROM social_publications WHERE id = ?",
      publication.id,
    )!.request_context_json)).toMatchObject({ youtube: youtubeSettings });
    expect(JSON.parse(fixture.db.first<{ metadata_json: string }>(
      "SELECT metadata_json FROM social_accounts WHERE id = ?",
      "account-youtube",
    )!.metadata_json)).toMatchObject({
      publishingDefaults: { youtube: youtubeSettings },
    });
    expect(fixture.db.first<{ publishing_settings_json: string }>(
      "SELECT publishing_settings_json FROM social_variants WHERE id = ?",
      "version-youtube",
    )).toEqual({ publishing_settings_json: "{}" });

    const uploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=title";
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          snippet: {
            title: "Saved YouTube title",
            description: "A concise YouTube description.",
          },
          status: {
            privacyStatus: "unlisted",
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia: true,
          },
        });
        return new Response(null, {
          status: 200,
          headers: { Location: uploadUrl },
        });
      }
      if (url === "https://media.example/short.mp4") {
        expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
        return new Response(videoBytes, { status: 206 });
      }
      if (url === uploadUrl) {
        return Response.json({ id: "youtube-video-title" }, { status: 201 });
      }
      if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?part=status")) {
        return Response.json({
          items: [{
            id: "youtube-video-title",
            status: { uploadStatus: "uploaded", privacyStatus: "unlisted" },
          }],
        });
      }
      throw new Error(`Unexpected YouTube request: ${url}`);
    });

    await publishQueuedPublication(
      fixture.env as never,
      publication.id,
      fetcher as unknown as typeof fetch,
    );

    expect(fixture.db.first<{ status: string; platform_post_id: string }>(
      "SELECT status, platform_post_id FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "youtube-video-title",
    });
  });

  it("queues TikTok with its saved Version review and consumes that review", async () => {
    fixture.db.run(
      `INSERT INTO social_accounts (
         id, user_id, site_id, platform, platform_account_id, display_name, status,
         scopes_json, metadata_json, access_token_ciphertext, created_at, updated_at
       ) VALUES (?, 'owner', 'site-1', 'tiktok', 'tiktok-owner', 'TikTok account', 'active',
                 '["video.publish"]', '{}', ?, datetime('now'), datetime('now'))`,
      "account-tiktok-reviewed",
      await encryptTestSecret("tiktok-access-token", TEST_TOKEN_ENCRYPTION_KEY),
    );
    seedApprovedVersion(fixture.db, {
      postId: "post-tiktok-reviewed",
      versionId: "version-tiktok-reviewed",
      bodyText: "The reviewed caption #ME3",
      platform: "tiktok",
      accountId: "account-tiktok-reviewed",
    });
    const settings = {
      deliveryMode: "direct_publish",
      privacyLevel: "SELF_ONLY",
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      brandContent: false,
      brandOrganic: false,
      isAiGenerated: false,
      consent: true,
      videoDurationSeconds: 12,
    };
    fixture.db.run(
      `UPDATE social_variants
       SET format = 'short_video',
           asset_manifest_json = ?,
           publishing_settings_json = ?
       WHERE id = 'version-tiktok-reviewed'`,
      JSON.stringify([{
        url: "https://media.example/short.mp4",
        kind: "video",
        mimeType: "video/mp4",
        byteLength: 4,
      }]),
      JSON.stringify({ tiktok: settings }),
    );
    fixture.env.SITE_ASSETS = {};

    const publication = await createPublication(
      fixture,
      "version-tiktok-reviewed",
    );

    expect(JSON.parse(fixture.db.first<{ request_context_json: string }>(
      "SELECT request_context_json FROM social_publications WHERE id = ?",
      publication.id,
    )!.request_context_json)).toMatchObject({ tiktok: settings });
    expect(fixture.db.first<{ publishing_settings_json: string }>(
      "SELECT publishing_settings_json FROM social_variants WHERE id = ?",
      "version-tiktok-reviewed",
    )).toEqual({ publishing_settings_json: "{}" });
  });

  it("tells the host once when a post goes live, and a failing host hook never retries the publish", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    fixture.db.run("UPDATE social_variants SET title = 'Launch week recap' WHERE id = 'version-1'");
    vi.stubGlobal("fetch", linkedInFetcher(201));
    const onPublished = vi.fn(async () => { throw new Error("Host activity store unavailable"); });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const message = socialQueueMessage(publication.id);
    await processSocialPublishBatch({ queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [message] }, fixture.env as never, { onPublished });
    const redelivered = socialQueueMessage(publication.id);
    await processSocialPublishBatch({ queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [redelivered] }, fixture.env as never, { onPublished });

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(redelivered.ack).toHaveBeenCalledOnce();
    expect(onPublished).toHaveBeenCalledOnce();
    expect(onPublished).toHaveBeenCalledWith({
      userId: "owner",
      publicationId: publication.id,
      variantId: "version-1",
      platform: "linkedin",
      platformLabel: "LinkedIn",
      title: "Launch week recap",
      platformPostUrl: expect.any(String),
    });
  });

  it("preserves the Worker global fetch context for provider requests", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const providerFetcher = linkedInFetcher(201);
    const contextSensitiveFetch = vi.fn(function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: incorrect this reference");
      }
      return providerFetcher(input);
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", contextSensitiveFetch);

    const message = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [message] },
      fixture.env as never,
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(contextSensitiveFetch).toHaveBeenCalledTimes(2);
    expect(fixture.db.first<{ status: string; platform_post_id: string }>(
      "SELECT status, platform_post_id FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "urn:li:share:stale-provider-result",
    });
  });

  it("authenticates a hosted LinkedIn refresh as the linked installation", async () => {
    fixture.env.ME3_DEPLOYMENT_MODE = "managed";
    const publication = await createPublication(fixture, "version-1");
    fixture.db.exec(
      `CREATE TABLE install_secrets (
         name TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );
       INSERT INTO install_secrets (name, value) VALUES
         ('ME3_CLOUD_OWNER_ID', 'cloud-owner'),
         ('ME3_CORE_INSTALL_ID', 'core-install'),
         ('ME3_CLOUD_CORE_TOKEN', 'core-update-token');`,
    );
    fixture.db.run(
      `UPDATE social_accounts
       SET status = 'active', access_token_ciphertext = ?, refresh_token_ciphertext = ?,
           token_expires_at = '2000-01-01T00:00:00.000Z',
           metadata_json = '{"credentialSource":"hosted_oauth"}'
       WHERE id = 'account-1'`,
      await encryptTestSecret("expired-access-token", TEST_TOKEN_ENCRYPTION_KEY),
      await encryptTestSecret("current-refresh-token", TEST_TOKEN_ENCRYPTION_KEY),
    );
    fixture.db.run(
      `UPDATE social_publications
       SET asset_manifest_json_snapshot = '[]'
       WHERE id = ?`,
      publication.id,
    );

    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.me3.app/api/social/oauth/refresh") {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-ME3-Core-Owner-ID")).toBe("cloud-owner");
        expect(headers.get("X-ME3-Core-Install-ID")).toBe("core-install");
        expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token");
        expect(JSON.parse(String(init?.body))).toEqual({
          platform: "linkedin",
          refreshToken: "current-refresh-token",
        });
        return Response.json({
          accessToken: "refreshed-access-token",
          refreshToken: "next-refresh-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      }
      if (url.endsWith("/userinfo")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer refreshed-access-token",
        );
        return Response.json({ sub: "urn:li:person:owner" });
      }
      if (url.endsWith("/rest/posts")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer refreshed-access-token",
        );
        return Response.json(
          { id: "urn:li:share:refreshed-provider-result" },
          { status: 201 },
        );
      }
      throw new Error(`Unexpected LinkedIn request: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);

    const message = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [message] },
      fixture.env as never,
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fixture.db.first<{
      status: string;
      platform_post_id: string;
      token_expires_at: string;
    }>(
      `SELECT publication.status, publication.platform_post_id, account.token_expires_at
       FROM social_publications publication
       JOIN social_accounts account ON account.id = publication.target_account_id_snapshot
       WHERE publication.id = ?`,
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "urn:li:share:refreshed-provider-result",
      token_expires_at: "2099-01-01T00:00:00.000Z",
    });
  });

  it("reserves and consumes managed X cost without exposing the dollar allowance", async () => {
    seedApprovedVersion(fixture.db, {
      postId: "post-managed-x",
      versionId: "version-managed-x",
      bodyText: "Managed X update https://example.com",
      platform: "x",
      accountId: "account-x",
    });
    fixture.db.exec(
      `CREATE TABLE install_secrets (
         name TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );
       INSERT INTO install_secrets (name, value) VALUES
         ('ME3_CLOUD_OWNER_ID', 'cloud-owner'),
         ('ME3_CORE_INSTALL_ID', 'core-install'),
         ('ME3_CLOUD_CORE_TOKEN', 'core-update-token');`,
    );
    fixture.db.run(
      `UPDATE social_accounts
       SET access_token_ciphertext = ?,
           metadata_json = '{"credentialSource":"hosted_oauth"}'
       WHERE id = 'account-x'`,
      await encryptTestSecret("managed-x-access-token", TEST_TOKEN_ENCRYPTION_KEY),
    );
    fixture.db.run(
      `UPDATE social_variants SET asset_manifest_json = '[]'
       WHERE id = 'version-managed-x'`,
    );
    fixture.env.ME3_DEPLOYMENT_MODE = "managed";
    fixture.env.ME3_SOCIAL_OAUTH_ORIGIN = "https://cloud.example";

    const cloudRequests: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://cloud.example/api/social/x/usage/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-ME3-Core-Owner-ID")).toBe("cloud-owner");
        expect(headers.get("X-ME3-Core-Install-ID")).toBe("core-install");
        expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token");
        cloudRequests.push({
          url,
          body: JSON.parse(String(init?.body || "{}")),
        });
        return Response.json(
          url.endsWith("/consume")
            ? { ok: true }
            : { allowed: true, warning: null },
        );
      }
      if (url === "https://api.x.com/2/tweets") {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer managed-x-access-token",
        );
        return Response.json({ data: { id: "managed-x-post" } }, { status: 201 });
      }
      throw new Error(`Unexpected managed X request: ${url}`);
    });

    const publication = await createPostVersionPublication(
      fixture.env as never,
      "owner",
      "version-managed-x",
      {},
      fetcher as unknown as typeof fetch,
    );
    expect(publication).toMatchObject({ platform: "x", status: "queued" });
    await publishQueuedPublication(
      fixture.env as never,
      publication?.id,
      fetcher as unknown as typeof fetch,
    );

    expect(cloudRequests).toHaveLength(3);
    expect(cloudRequests[0]).toMatchObject({
      url: "https://cloud.example/api/social/x/usage/reservations",
      body: {
        publicationId: publication?.id,
        scheduledFor: null,
        hasUrl: true,
        mediaCount: 0,
        altTextCount: 0,
        videoCount: 0,
      },
    });
    expect(cloudRequests[1]).toMatchObject({
      url: "https://cloud.example/api/social/x/usage/reservations",
      body: { publicationId: publication?.id },
    });
    expect(cloudRequests[2]?.url).toBe(
      `https://cloud.example/api/social/x/usage/reservations/${publication?.id}/consume`,
    );
    expect(JSON.stringify(cloudRequests)).not.toContain("$");
    expect(
      fixture.db.first<{ status: string; platform_post_id: string }>(
        "SELECT status, platform_post_id FROM social_publications WHERE id = ?",
        publication?.id,
      ),
    ).toEqual({ status: "published", platform_post_id: "managed-x-post" });
  });

  it("requeues a post-claim exception before the provider write and publishes once on redelivery", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(201);
    vi.stubGlobal("fetch", fetcher);
    fixture.db.beforeNextFirstMatching = {
      pattern: /INSERT INTO social_publication_events[\s\S]*'publishing'/,
      run: async () => {
        throw new Error("unexpected post-claim preflight failure");
      },
    };

    const interrupted = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [interrupted] },
      fixture.env as never,
    );

    expect(interrupted.ack).not.toHaveBeenCalled();
    expect(interrupted.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(fixture.db.first<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "queued",
      error_code: "retryable:unexpected_pre_provider_failure",
    });
    expect(JSON.parse(fixture.db.first<{ payload_json: string }>(
      `SELECT payload_json FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'retried'
       ORDER BY rowid DESC LIMIT 1`,
      publication.id,
    )?.payload_json || "{}")).toMatchObject({
      attempt: 1,
      nextAttempt: 2,
      delaySeconds: 60,
      phase: "before_provider_write",
    });

    const redelivery = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [redelivery] },
      fixture.env as never,
    );

    expect(redelivery.ack).toHaveBeenCalledOnce();
    expect(redelivery.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fixture.db.first<{ status: string; platform_post_id: string }>(
      "SELECT status, platform_post_id FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "urn:li:share:stale-provider-result",
    });
  });

  it("publishes a private Files image through an opaque grant and revokes it after success", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    fixture.env.CORE_API_ORIGIN = "https://core.example";
    fixture.db.run(
      `INSERT INTO drive_files
         (id, owner_id, filename, mime_type, size, storage_key, status)
       VALUES ('file-private-1', 'owner', 'private.png', 'image/png', 4,
               'drive/owner/file-private-1.png', 'ready')`,
    );
    fixture.db.run(
      `UPDATE social_publications
       SET asset_manifest_json_snapshot = ?
       WHERE id = ?`,
      JSON.stringify([{
        url: "/api/files/file-private-1/content",
        fileId: "file-private-1",
        filename: "private.png",
        mimeType: "image/png",
        kind: "image",
        byteLength: 4,
      }]),
      publication.id,
    );

    let providerMediaUrl = "";
    const fetcher = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/userinfo")) {
        return Response.json({ sub: "urn:li:person:owner" });
      }
      if (url.startsWith("https://core.example/api/social/media/socmedia_")) {
        providerMediaUrl = url;
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (url.includes("/rest/images?action=initializeUpload")) {
        return Response.json({
          value: {
            uploadUrl: "https://linkedin-upload.example/image-1",
            image: "urn:li:image:image-1",
          },
        });
      }
      if (url === "https://linkedin-upload.example/image-1") {
        return new Response(null, { status: 201 });
      }
      if (url.endsWith("/rest/posts")) {
        return Response.json({ id: "urn:li:share:private-media" }, { status: 201 });
      }
      throw new Error(`Unexpected LinkedIn request: ${url}`);
    });

    await publishQueuedPublication(
      fixture.env as never,
      publication.id,
      fetcher as unknown as typeof fetch,
    );

    expect(providerMediaUrl).toMatch(
      /^https:\/\/core\.example\/api\/social\/media\/socmedia_[A-Za-z0-9_-]+$/,
    );
    expect(providerMediaUrl).not.toContain("file-private-1");
    expect(fixture.db.first<{
      provider: string;
      token_hash: string;
      revoked_at: string | null;
    }>(
      `SELECT provider, token_hash, revoked_at
       FROM social_media_delivery_grants
       WHERE publication_id = ?`,
      publication.id,
    )).toEqual({
      provider: "linkedin",
      token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      revoked_at: expect.any(String),
    });
    expect(fixture.db.first<{ status: string; platform_post_id: string }>(
      "SELECT status, platform_post_id FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "published",
      platform_post_id: "urn:li:share:private-media",
    });
  });

  it("preserves approval when queued private media loses its delivery configuration", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    fixture.db.run(
      `UPDATE social_publications
       SET asset_manifest_json_snapshot = ?
       WHERE id = ?`,
      JSON.stringify([{
        url: "/api/files/file-private-1/content",
        fileId: "file-private-1",
        filename: "private.png",
        mimeType: "image/png",
        kind: "image",
        byteLength: 4,
      }]),
      publication.id,
    );

    const fetcher = vi.fn();
    await expect(
      publishQueuedPublication(
        fixture.env as never,
        publication.id,
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();

    expect(fetcher).not.toHaveBeenCalled();
    expect(
      fixture.db.first<{ status: string; error_code: string }>(
        "SELECT status, error_code FROM social_publications WHERE id = ?",
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "retryable:media_delivery_setup",
    });
    expect(
      fixture.db.first<{ approval_status: string }>(
        "SELECT approval_status FROM social_variants WHERE id = 'version-1'",
      ),
    ).toEqual({ approval_status: "approved" });
  });

  it("keeps an unmarked publishing claim leased when exception recovery fails, then safely reclaims it", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(201);
    vi.stubGlobal("fetch", fetcher);
    fixture.db.beforeNextFirstMatching = {
      pattern: /INSERT INTO social_publication_events[\s\S]*'publishing'/,
      run: async () => {
        throw new Error("unexpected post-claim preflight failure");
      },
    };
    fixture.db.failNextBatchAfterFirst = true;

    const interrupted = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [interrupted] },
      fixture.env as never,
    );

    expect(interrupted.ack).not.toHaveBeenCalled();
    expect(interrupted.retry).toHaveBeenCalledWith({ delaySeconds: 660 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(fixture.db.first<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({ status: "publishing", error_code: null });

    const concurrentRedelivery = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [concurrentRedelivery] },
      fixture.env as never,
    );
    expect(concurrentRedelivery.ack).not.toHaveBeenCalled();
    expect(concurrentRedelivery.retry).toHaveBeenCalledWith({ delaySeconds: 660 });
    expect(fetcher).not.toHaveBeenCalled();

    fixture.db.run(
      "UPDATE social_publications SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      publication.id,
    );
    const leaseExpired = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [leaseExpired] },
      fixture.env as never,
    );
    expect(leaseExpired.ack).not.toHaveBeenCalled();
    expect(leaseExpired.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(fixture.db.first<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "queued",
      error_code: "retryable:unexpected_pre_provider_failure",
    });

    const finalDelivery = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [finalDelivery] },
      fixture.env as never,
    );
    expect(finalDelivery.ack).toHaveBeenCalledOnce();
    expect(finalDelivery.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fixture.db.first<{ status: string }>(
      "SELECT status FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({ status: "published" });
  });

  it("freezes an exception after the provider write and never blind-retries on redelivery", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(201);
    vi.stubGlobal("fetch", fetcher);
    fixture.db.failNextBatchAfterFirst = true;

    const interrupted = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [interrupted] },
      fixture.env as never,
    );

    expect(interrupted.ack).toHaveBeenCalledOnce();
    expect(interrupted.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fixture.db.first<{
      status: string;
      error_code: string;
      platform_post_id: string | null;
    }>(
      "SELECT status, error_code, platform_post_id FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "publishing",
      error_code: "outcome_unknown:provider_write_started",
      platform_post_id: null,
    });
    expect(fixture.db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'published'`,
      publication.id,
    )).toEqual({ count: 0 });

    const redelivery = socialQueueMessage(publication.id);
    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_QUEUE_NAME, messages: [redelivery] },
      fixture.env as never,
    );

    expect(redelivery.ack).toHaveBeenCalledOnce();
    expect(redelivery.retry).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fixture.db.first<{ status: string; error_code: string }>(
      "SELECT status, error_code FROM social_publications WHERE id = ?",
      publication.id,
    )).toEqual({
      status: "publishing",
      error_code: "outcome_unknown:provider_write_started",
    });
  });

  it("terminally records a queued Publication delivered through the social DLQ", async () => {
    const publication = await createPublication(fixture, "version-1");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const message = socialQueueMessage(publication.id);

    await processSocialPublishBatch(
      { queue: SOCIAL_PUBLISH_DLQ_NAME, messages: [message] },
      fixture.env as never,
    );

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(fixture.db.first<{ status: string; error_code: string; error_message: string }>(
      `SELECT status, error_code, error_message
       FROM social_publications WHERE id = ?`,
      publication.id,
    )).toEqual({
      status: "failed",
      error_code: "retryable:queue_dead_lettered",
      error_message: "Social publishing stopped after the queue exhausted its delivery attempts.",
    });
    const event = fixture.db.first<{ payload_json: string }>(
      `SELECT payload_json FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'failed'
       ORDER BY rowid DESC LIMIT 1`,
      publication.id,
    );
    expect(JSON.parse(event?.payload_json || "{}")).toEqual({
      code: "retryable:queue_dead_lettered",
      message: "Social publishing stopped after the queue exhausted its delivery attempts.",
    });
  });

  it.each(["queued", "publishing"] as const)(
    "cancels scheduled work after a Version edit without mutating a %s snapshot",
    async (inFlightStatus) => {
      const scheduled = await createPublication(fixture, "version-1", {
        scheduledFor: "2099-09-01T10:30:00.000Z",
        timezone: "Europe/Dublin",
      });
      const inFlight = await createPublication(fixture, "version-1");
      if (inFlightStatus === "publishing") {
        fixture.db.run(
          `UPDATE social_publications
           SET status = 'publishing', updated_at = datetime('now')
           WHERE id = ?`,
          inFlight.id,
        );
      }

      const snapshotBefore = fixture.db.first<PublicationSnapshot>(
        `${publicationSnapshotSql()} WHERE id = ?`,
        inFlight.id,
      );
      expect(snapshotBefore).toMatchObject({
        target_account_id_snapshot: "account-1",
        format_snapshot: "post",
        body_text_snapshot: "Original approved copy",
        asset_manifest_json_snapshot: '[{"url":"/original.png"}]',
        approval_status_snapshot: "approved",
      });

      const updated = await updatePostVersion(
        fixture.env as never,
        "owner",
        "version-1",
        {
          targetAccountId: "account-2",
          bodyText: "Edited copy that requires fresh approval",
          assetManifest: [{ url: "/edited.png" }],
        },
      );
      expect(updated).toMatchObject({
        approvalStatus: "draft",
        targetAccountId: "account-2",
        bodyText: "Edited copy that requires fresh approval",
      });

      expect(
        fixture.db.first<{ status: string; error_code: string | null }>(
          "SELECT status, error_code FROM social_publications WHERE id = ?",
          scheduled.id,
        ),
      ).toEqual({ status: "cancelled", error_code: "cancelled:version_changed" });
      expect(
        fixture.db.first<PublicationSnapshot>(
          `${publicationSnapshotSql()} WHERE id = ?`,
          inFlight.id,
        ),
      ).toEqual(snapshotBefore);
      expect(
        fixture.db.first<{ status: string }>(
          "SELECT status FROM social_publications WHERE id = ?",
          inFlight.id,
        ),
      ).toEqual({ status: inFlightStatus });
    },
  );

  it("resolves only the Publication named by Publication id", async () => {
    seedApprovedVersion(fixture.db, {
      postId: "post-2",
      versionId: "version-2",
      bodyText: "A second approved Version",
    });
    const chosen = await createPublication(fixture, "version-1");
    const untouched = await createPublication(fixture, "version-2");
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           error_message = 'Provider outcome is unknown.', updated_at = datetime('now')
       WHERE id IN (?, ?)`,
      chosen.id,
      untouched.id,
    );

    const resolved = await resolvePublicationOutcome(
      fixture.env as never,
      "owner",
      chosen.id,
      {
        outcome: "published",
        platformPostUrl: "https://linkedin.example/posts/recovered",
      },
    );

    expect(resolved).toMatchObject({
      id: chosen.id,
      status: "published",
      platformPostUrl: "https://linkedin.example/posts/recovered",
      errorCode: null,
    });
    expect(
      fixture.db.first<{
        status: string;
        error_code: string | null;
        platform_post_url: string | null;
      }>(
        `SELECT status, error_code, platform_post_url
         FROM social_publications WHERE id = ?`,
        untouched.id,
      ),
    ).toEqual({
      status: "publishing",
      error_code: "outcome_unknown:delivery_interrupted",
      platform_post_url: null,
    });

    await expect(
      resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        chosen.id,
        { outcome: "not_published" },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This Publication does not need outcome resolution",
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type IN ('published', 'failed')`,
        chosen.id,
      ),
    ).toEqual({ count: 1 });
  });

  it("allows only one owner outcome to win concurrent recovery", async () => {
    const publication = await createPublication(fixture, "version-1");
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           error_message = 'Provider outcome is unknown.', updated_at = datetime('now')
       WHERE id = ?`,
      publication.id,
    );

    const results = await Promise.allSettled([
      resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        {
          outcome: "published",
          platformPostUrl: "https://linkedin.example/posts/concurrent-recovery",
        },
      ),
      resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        { outcome: "not_published" },
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toMatchObject({
      status: 409,
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type IN ('published', 'failed')`,
        publication.id,
      ),
    ).toEqual({ count: 1 });
  });

  it.each([
    {
      outcome: "published" as const,
      input: {
        outcome: "published" as const,
        platformPostUrl: "https://linkedin.example/posts/atomic-recovery",
      },
      expectedStatus: "published",
      expectedErrorCode: null,
      eventType: "published",
    },
    {
      outcome: "not_published" as const,
      input: { outcome: "not_published" as const },
      expectedStatus: "failed",
      expectedErrorCode: "retryable:owner_confirmed_not_published",
      eventType: "failed",
    },
  ])("rolls back and safely retries an atomic owner $outcome recovery", async ({
    input,
    expectedStatus,
    expectedErrorCode,
    eventType,
  }) => {
    const publication = await createPublication(fixture, "version-1");
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           error_message = 'Provider outcome is unknown.', updated_at = datetime('now')
       WHERE id = ?`,
      publication.id,
    );
    fixture.db.failNextBatchAfterFirst = true;

    await expect(
      resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        input,
      ),
    ).rejects.toThrow();

    expect(
      fixture.db.first<{
        status: string;
        error_code: string | null;
        platform_post_url: string | null;
      }>(
        `SELECT status, error_code, platform_post_url
         FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "publishing",
      error_code: "outcome_unknown:delivery_interrupted",
      platform_post_url: null,
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = ?`,
        publication.id,
        eventType,
      ),
    ).toEqual({ count: 0 });

    await expect(
      resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        input,
      ),
    ).resolves.toMatchObject({
      status: expectedStatus,
      errorCode: expectedErrorCode,
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = ?`,
        publication.id,
        eventType,
      ),
    ).toEqual({ count: 1 });
  });

  it("rolls back and safely retries an atomic worker failure", async () => {
    const publication = await createPublication(fixture, "version-1");
    fixture.db.failNextBatchAfterFirst = true;

    await expect(
      publishQueuedPublication(fixture.env as never, publication.id),
    ).rejects.toThrow();

    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({ status: "queued", error_code: null });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'failed'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });

    await expect(
      publishQueuedPublication(fixture.env as never, publication.id),
    ).resolves.toBeUndefined();
    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "reconnect_required:no_account",
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'failed'`,
        publication.id,
      ),
    ).toEqual({ count: 1 });
  });

  it("does not let a stale publishing watchdog overwrite owner recovery", async () => {
    const publication = await createPublication(fixture, "version-1");
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           error_message = 'Provider outcome is unknown.', updated_at = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );
    fixture.db.beforeNextBatch = async () => {
      await resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        {
          outcome: "published",
          platformPostUrl: "https://linkedin.example/posts/watchdog-recovery",
        },
      );
    };

    await expect(
      publishQueuedPublication(fixture.env as never, publication.id),
    ).resolves.toBeUndefined();

    expect(
      fixture.db.first<{
        status: string;
        error_code: string | null;
        platform_post_url: string | null;
      }>(
        `SELECT status, error_code, platform_post_url
         FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "published",
      error_code: null,
      platform_post_url: "https://linkedin.example/posts/watchdog-recovery",
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'failed'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'published'`,
        publication.id,
      ),
    ).toEqual({ count: 1 });
  });

  it("does not let a stale disconnect overwrite owner recovery", async () => {
    const publication = await createPublication(fixture, "version-1");
    fixture.db.run(
      `UPDATE social_publications
       SET status = 'publishing', error_code = 'outcome_unknown:delivery_interrupted',
           error_message = 'Provider outcome is unknown.', updated_at = datetime('now')
       WHERE id = ?`,
      publication.id,
    );
    fixture.db.beforeNextBatch = async () => {
      await resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        { outcome: "not_published" },
      );
    };

    await expect(
      disconnectSocialPublishingAccount(fixture.env as never, "owner", "account-1"),
    ).resolves.toBe(true);

    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "retryable:owner_confirmed_not_published",
    });
    const failedEvents = fixture.db.first<{ count: number; owner_resolutions: number }>(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN payload_json LIKE '%owner_confirmed%' THEN 1 ELSE 0 END)
                AS owner_resolutions
       FROM social_publication_events
       WHERE publication_id = ? AND event_type = 'failed'`,
      publication.id,
    );
    expect(failedEvents).toEqual({ count: 1, owner_resolutions: 1 });
  });

  it("aborts before the provider when disconnect and owner recovery win the publishing preflight", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(201);
    fixture.db.beforeNextFirstMatching = {
      pattern: /INSERT INTO social_publication_events[\s\S]*'publishing'/,
      run: async () => {
        await disconnectSocialPublishingAccount(
          fixture.env as never,
          "owner",
          "account-1",
        );
        await resolvePublicationOutcome(
          fixture.env as never,
          "owner",
          publication.id,
          { outcome: "not_published" },
        );
      },
    };

    await expect(
      publishQueuedPublication(
        fixture.env as never,
        publication.id,
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();

    expect(fetcher).not.toHaveBeenCalled();
    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        `SELECT status, error_code FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "retryable:owner_confirmed_not_published",
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'publishing'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("does not let stale provider success overwrite disconnect and owner recovery", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(201);
    fixture.db.beforeNextBatch = async () => {
      await disconnectSocialPublishingAccount(
        fixture.env as never,
        "owner",
        "account-1",
      );
      await resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        { outcome: "not_published" },
      );
    };

    await expect(
      publishQueuedPublication(
        fixture.env as never,
        publication.id,
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalled();
    expect(
      fixture.db.first<{
        status: string;
        error_code: string | null;
        platform_post_id: string | null;
        platform_post_url: string | null;
      }>(
        `SELECT status, error_code, platform_post_id, platform_post_url
         FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "retryable:owner_confirmed_not_published",
      platform_post_id: null,
      platform_post_url: null,
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'published'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("does not let a stale provider retry overwrite disconnect and owner recovery", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(503);
    fixture.db.beforeNextBatch = async () => {
      await disconnectSocialPublishingAccount(
        fixture.env as never,
        "owner",
        "account-1",
      );
      await resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        {
          outcome: "published",
          platformPostUrl: "https://linkedin.example/posts/retry-recovery",
        },
      );
    };

    await expect(
      publishQueuedPublication(
        fixture.env as never,
        publication.id,
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalled();
    expect(
      fixture.db.first<{
        status: string;
        error_code: string | null;
        platform_post_url: string | null;
      }>(
        `SELECT status, error_code, platform_post_url
         FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({
      status: "published",
      error_code: null,
      platform_post_url: "https://linkedin.example/posts/retry-recovery",
    });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'retried'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("does not let a stale rejected provider result revoke the recovered Version", async () => {
    const publication = await createPublication(fixture, "version-1");
    await enableProviderDelivery(fixture, publication.id);
    const fetcher = linkedInFetcher(400);
    fixture.db.beforeNextBatch = async () => {
      await disconnectSocialPublishingAccount(
        fixture.env as never,
        "owner",
        "account-1",
      );
      await resolvePublicationOutcome(
        fixture.env as never,
        "owner",
        publication.id,
        { outcome: "not_published" },
      );
    };

    await expect(
      publishQueuedPublication(
        fixture.env as never,
        publication.id,
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalled();
    expect(
      fixture.db.first<{ status: string; error_code: string | null }>(
        "SELECT status, error_code FROM social_publications WHERE id = ?",
        publication.id,
      ),
    ).toEqual({
      status: "failed",
      error_code: "retryable:owner_confirmed_not_published",
    });
    expect(
      fixture.db.first<{ approval_status: string }>(
        "SELECT approval_status FROM social_variants WHERE id = 'version-1'",
      ),
    ).toEqual({ approval_status: "approved" });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'failed'
           AND payload_json LIKE '%linkedin_post_error%'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("does not record owner cancellation when due dispatch wins the state race", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-09-15T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    fixture.db.run(
      `UPDATE social_publications
       SET scheduled_for = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );
    fixture.db.beforeNextBatch = async () => {
      await dispatchDueSocialPublications(fixture.env as never);
    };

    await expect(
      cancelPublication(fixture.env as never, "owner", publication.id),
    ).rejects.toMatchObject({
      status: 409,
      message: "This Publication is already being dispatched and can no longer be cancelled",
    });

    expect(
      fixture.db.first<{ status: string }>(
        `SELECT status FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({ status: "queued" });
    expect(fixture.queueMessages).toEqual([{ publicationId: publication.id }]);
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'cancelled'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("does not record cancellation when due dispatch wins before the edit batch", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-09-15T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    fixture.db.run(
      `UPDATE social_publications
       SET scheduled_for = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );
    fixture.db.beforeNextBatch = async () => {
      await dispatchDueSocialPublications(fixture.env as never);
    };

    await updatePostVersion(
      fixture.env as never,
      "owner",
      "version-1",
      { bodyText: "The edit loses the race to dispatch" },
    );

    expect(
      fixture.db.first<{ status: string; body_text_snapshot: string }>(
        `SELECT status, body_text_snapshot FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({ status: "queued", body_text_snapshot: "Original approved copy" });
    expect(fixture.queueMessages).toEqual([{ publicationId: publication.id }]);
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'cancelled'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("claims one due Publication atomically across concurrent dispatchers", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-10-01T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    fixture.db.run(
      `UPDATE social_publications
       SET scheduled_for = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );

    const results = await Promise.all([
      dispatchDueSocialPublications(fixture.env as never),
      dispatchDueSocialPublications(fixture.env as never),
    ]);

    expect(results.reduce((total, result) => total + result.queued, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.skipped, 0)).toBe(1);
    expect(fixture.queueMessages).toEqual([{ publicationId: publication.id }]);
    expect(
      fixture.db.first<{ status: string }>(
        "SELECT status FROM social_publications WHERE id = ?",
        publication.id,
      ),
    ).toEqual({ status: "queued" });
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'queued'`,
        publication.id,
      ),
    ).toEqual({ count: 1 });
  });

  it("does not dispatch a stale due-time selection after Calendar reschedules it", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-10-02T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    const oldDueTime = "2000-01-01T00:00:00.000Z";
    const rescheduledTime = "2099-10-03T09:00:00.000Z";
    fixture.db.run(
      `UPDATE social_publications SET scheduled_for = ? WHERE id = ?`,
      oldDueTime,
      publication.id,
    );
    fixture.db.afterNextAll = async () => {
      fixture.db.run(
        `UPDATE social_publications SET scheduled_for = ?, updated_at = ? WHERE id = ?`,
        rescheduledTime,
        "2099-01-01T00:00:00.000Z",
        publication.id,
      );
    };

    await expect(
      dispatchDueSocialPublications(fixture.env as never),
    ).resolves.toEqual({ queued: 0, skipped: 1 });
    expect(
      fixture.db.first<{ status: string; scheduled_for: string }>(
        `SELECT status, scheduled_for FROM social_publications WHERE id = ?`,
        publication.id,
      ),
    ).toEqual({ status: "scheduled", scheduled_for: rescheduledTime });
    expect(fixture.queueMessages).toEqual([]);
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'queued'`,
        publication.id,
      ),
    ).toEqual({ count: 0 });
  });

  it("records a scheduled rollback when a due queue handoff fails", async () => {
    const publication = await createPublication(fixture, "version-1", {
      scheduledFor: "2099-10-02T09:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    fixture.db.run(
      `UPDATE social_publications
       SET scheduled_for = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );
    fixture.send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(dispatchDueSocialPublications(fixture.env as never)).resolves.toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(
      fixture.db.first<{ status: string }>(
        "SELECT status FROM social_publications WHERE id = ?",
        publication.id,
      ),
    ).toEqual({ status: "scheduled" });
    expect(
      fixture.db.first<{ event_type: string; payload_json: string }>(
        `SELECT event_type, payload_json FROM social_publication_events
         WHERE publication_id = ? ORDER BY rowid DESC LIMIT 1`,
        publication.id,
      ),
    ).toEqual({
      event_type: "scheduled",
      payload_json: JSON.stringify({
        dispatch: "rollback",
        reason: "queue_handoff_failed",
      }),
    });
  });

  it("re-enqueues a stranded queued Publication exactly once", async () => {
    const publication = await createPublication(fixture, "version-1");
    fixture.queueMessages.length = 0;
    fixture.send.mockClear();
    fixture.db.run(
      `UPDATE social_publications
       SET queued_at = '2000-01-01T00:00:00.000Z',
           updated_at = '2000-01-01T00:00:00.000Z'
       WHERE id = ?`,
      publication.id,
    );

    await expect(
      recoverStrandedQueuedSocialPublications(fixture.env as never),
    ).resolves.toEqual({ requeued: 1, skipped: 0 });
    await expect(
      recoverStrandedQueuedSocialPublications(fixture.env as never),
    ).resolves.toEqual({ requeued: 0, skipped: 0 });

    expect(fixture.queueMessages).toEqual([{ publicationId: publication.id }]);
    expect(
      fixture.db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM social_publication_events
         WHERE publication_id = ? AND event_type = 'queued'
           AND payload_json LIKE '%stranded_queue_recovery%'`,
        publication.id,
      ),
    ).toEqual({ count: 1 });
  });
});

async function createPublication(
  fixture: ReturnType<typeof createFixture>,
  versionId: string,
  input: {
    scheduledFor?: string;
    timezone?: string;
    requestContext?: Record<string, unknown>;
  } = {},
): Promise<Publication> {
  const publication = await createPostVersionPublication(
    fixture.env as never,
    "owner",
    versionId,
    { ...input, requestedByType: "owner" },
  );
  if (!publication) throw new Error(`Missing fixture Version ${versionId}`);
  return publication;
}

const TEST_TOKEN_ENCRYPTION_KEY = "social-publications-test-token-key";

async function enableProviderDelivery(
  fixture: ReturnType<typeof createFixture>,
  publicationId: string,
): Promise<void> {
  fixture.env.SITE_ASSETS = {};
  fixture.db.run(
    `UPDATE social_accounts
     SET status = 'active', access_token_ciphertext = ?
     WHERE id = 'account-1'`,
    await encryptTestSecret("linkedin-access-token", TEST_TOKEN_ENCRYPTION_KEY),
  );
  fixture.db.run(
    `UPDATE social_publications
     SET asset_manifest_json_snapshot = '[]'
     WHERE id = ?`,
    publicationId,
  );
}

function linkedInFetcher(postStatus: 201 | 400 | 503) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/userinfo")) {
      return new Response(JSON.stringify({ sub: "urn:li:person:owner" }), { status: 200 });
    }
    if (url.endsWith("/rest/posts")) {
      return new Response(
        JSON.stringify(
          postStatus === 201
            ? { id: "urn:li:share:stale-provider-result" }
            : { message: "Provider temporarily unavailable" },
        ),
        { status: postStatus },
      );
    }
    throw new Error(`Unexpected LinkedIn request: ${url}`);
  });
}

function socialQueueMessage(publicationId: string) {
  return {
    body: { publicationId },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

async function encryptTestSecret(secret: string, installKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createFixture() {
  const db = new TestD1Database();
  db.exec(schemaSql);
  db.run(
    `INSERT INTO plugin_installations (plugin_id, enabled, status)
     VALUES ('me3.social-publishing', 1, 'installed')`,
  );
  db.run("INSERT INTO sites (id, user_id) VALUES ('site-1', 'owner')");
  db.run(
    `INSERT INTO social_accounts (
       id, user_id, site_id, platform, platform_account_id, display_name, status,
       scopes_json, metadata_json, created_at, updated_at
     ) VALUES
       ('account-1', 'owner', 'site-1', 'linkedin', 'linkedin-account-1', 'LinkedIn account', 'active',
        '[]', '{}', datetime('now'), datetime('now')),
       ('account-2', 'owner', 'site-1', 'linkedin', 'linkedin-account-2', 'Backup account', 'active',
        '[]', '{}', datetime('now'), datetime('now')),
       ('account-x', 'owner', 'site-1', 'x', 'x-account-1', 'X account', 'active',
        '[]', '{}', datetime('now'), datetime('now'))`,
  );
  seedApprovedVersion(db, {
    postId: "post-1",
    versionId: "version-1",
    bodyText: "Original approved copy",
  });

  const queueMessages: Array<{ publicationId: string }> = [];
  const send = vi.fn(async (message: { publicationId: string }) => {
    queueMessages.push(message);
  });
  return {
    db,
    env: {
      DB: db,
      SOCIAL_PUBLISH_QUEUE: { send },
      TOKEN_ENCRYPTION_KEY: TEST_TOKEN_ENCRYPTION_KEY,
      ME3_DEPLOYMENT_MODE: undefined as string | undefined,
      ME3_SOCIAL_OAUTH_ORIGIN: undefined as string | undefined,
      CORE_API_ORIGIN: undefined as string | undefined,
      SITE_ASSETS: undefined as unknown,
    },
    send,
    queueMessages,
    close: () => db.close(),
  };
}

function seedApprovedVersion(
  db: TestD1Database,
  input: {
    postId: string;
    versionId: string;
    bodyText: string;
    platform?: "linkedin" | "x" | "tiktok" | "youtube";
    approvalStatus?: "approved" | "draft";
    siteId?: string;
    accountId?: string;
  },
) {
  const siteId = input.siteId || "site-1";
  const platform = input.platform || "linkedin";
  const approvalStatus = input.approvalStatus || "approved";
  const accountId = input.accountId || "account-1";
  db.run(
    `INSERT INTO social_packages (
       id, site_id, source_type, status, idea_text, created_at, updated_at
     ) VALUES (?, ?, 'journal', 'ready', ?, datetime('now'), datetime('now'))`,
    input.postId,
    siteId,
    input.bodyText,
  );
  db.run(
    `INSERT INTO social_variants (
       id, package_id, platform, target_account_id, format, body_text,
       asset_manifest_json, source_excerpt, approval_status, approved_at,
       approved_by_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'post', ?,
               '[{"url":"/original.png"}]', 'Original source', ?,
               ?, ?, datetime('now'), datetime('now'))`,
    input.versionId,
    input.postId,
    platform,
    accountId,
    input.bodyText,
    approvalStatus,
    approvalStatus === "approved" ? "2026-07-18T09:00:00.000Z" : null,
    approvalStatus === "approved" ? "owner" : null,
  );
}

type PublicationSnapshot = {
  target_account_id_snapshot: string | null;
  format_snapshot: string | null;
  body_text_snapshot: string | null;
  asset_manifest_json_snapshot: string | null;
  approval_status_snapshot: string | null;
  approved_at_snapshot: string | null;
  approved_by_user_id_snapshot: string | null;
};

function publicationSnapshotSql() {
  return `SELECT target_account_id_snapshot, format_snapshot, body_text_snapshot,
                 asset_manifest_json_snapshot, approval_status_snapshot,
                 approved_at_snapshot, approved_by_user_id_snapshot
          FROM social_publications`;
}

class TestD1Database {
  private readonly directory = mkdtempSync(join(tmpdir(), "me3-social-publications-"));
  private readonly database = join(this.directory, "fixture.sqlite");
  beforeNextBatch: (() => Promise<void>) | undefined;
  afterNextAll: (() => Promise<void>) | undefined;
  beforeNextFirstMatching: {
    pattern: RegExp;
    run: () => Promise<void>;
  } | undefined;
  failNextBatchAfterFirst = false;

  exec(sql: string) {
    sqliteExec(this.database, sql);
  }

  prepare(sql: string) {
    return new TestD1Statement(this.database, sql, this);
  }

  async batch(statements: TestD1Statement[]) {
    const beforeBatch = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    if (beforeBatch) await beforeBatch();
    const failAfterFirst = this.failNextBatchAfterFirst;
    this.failNextBatchAfterFirst = false;
    if (failAfterFirst) {
      sqliteExec(
        this.database,
        `BEGIN IMMEDIATE;\n${statements[0]?.boundSql()};\n` +
          "INSERT INTO __missing_atomicity_probe__ DEFAULT VALUES;\nROLLBACK;",
      );
      return [];
    }
    sqliteExec(
      this.database,
      `BEGIN IMMEDIATE;\n${statements.map((statement) => `${statement.boundSql()};`).join("\n")}\nCOMMIT;`,
    );
    return [];
  }

  run(sql: string, ...values: unknown[]) {
    return this.prepare(sql).bind(...values).runSync();
  }

  first<T>(sql: string, ...values: unknown[]): T | null {
    return this.prepare(sql).bind(...values).firstSync<T>();
  }

  close() {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

class TestD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly database: string,
    private readonly sql: string,
    private readonly owner: TestD1Database,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const hook = this.owner.beforeNextFirstMatching;
    if (hook && hook.pattern.test(this.sql)) {
      this.owner.beforeNextFirstMatching = undefined;
      await hook.run();
    }
    return this.firstSync<T>();
  }

  firstSync<T = unknown>(): T | null {
    return sqliteRows<T>(this.database, this.boundSql())[0] || null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const results = sqliteRows<T>(this.database, this.boundSql());
    const afterAll = this.owner.afterNextAll;
    this.owner.afterNextAll = undefined;
    if (afterAll) await afterAll();
    return { results };
  }

  async run(): Promise<unknown> {
    return this.runSync();
  }

  runSync() {
    sqliteExec(this.database, this.boundSql());
    return { success: true };
  }

  boundSql() {
    return bindSql(this.sql, this.values);
  }
}

function sqliteExec(database: string, sql: string): void {
  execFileSync("sqlite3", [database], { input: sql, encoding: "utf8" });
}

function sqliteRows<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], {
    input: sql,
    encoding: "utf8",
  }).trim();
  return output ? JSON.parse(output) as T[] : [];
}

function bindSql(sql: string, values: unknown[]): string {
  let index = 0;
  let quote = "";
  let output = "";
  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position] || "";
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[position + 1] === quote) {
          output += quote;
          position += 1;
        } else {
          quote = "";
        }
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      output += sqliteLiteral(values[index]);
      index += 1;
    } else {
      output += character;
    }
  }
  if (index !== values.length) throw new Error("SQLite test binding count mismatch");
  return output;
}

function sqliteLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

const schemaSql = `
  CREATE TABLE plugin_installations (
    plugin_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL
  );

  CREATE TABLE social_packages (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    status TEXT NOT NULL,
    idea_text TEXT NOT NULL DEFAULT '',
    post_title_snapshot TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE social_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_account_id TEXT NOT NULL,
    platform_handle TEXT,
    display_name TEXT,
    status TEXT NOT NULL,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    access_token_ciphertext TEXT,
    refresh_token_ciphertext TEXT,
    token_expires_at TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE social_variants (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    target_account_id TEXT,
    format TEXT NOT NULL,
    title TEXT,
    body_text TEXT NOT NULL,
    asset_manifest_json TEXT NOT NULL DEFAULT '[]',
    publishing_settings_json TEXT NOT NULL DEFAULT '{}',
    carousel_render_set_id TEXT,
    source_excerpt TEXT,
    approval_status TEXT NOT NULL,
    approved_at TEXT,
    approved_by_user_id TEXT,
    scheduled_for TEXT,
    timezone TEXT,
    published_variant_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(package_id, platform)
  );

  CREATE TABLE social_publications (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled')
    ),
    scheduled_for TEXT,
    timezone TEXT,
    target_account_id_snapshot TEXT,
    format_snapshot TEXT,
    body_text_snapshot TEXT,
    asset_manifest_json_snapshot TEXT,
    approval_status_snapshot TEXT,
    approved_at_snapshot TEXT,
    approved_by_user_id_snapshot TEXT,
    requested_by_type TEXT,
    requested_by_user_id TEXT,
    request_context_json TEXT NOT NULL DEFAULT '{}',
    platform_post_id TEXT,
    platform_post_url TEXT,
    error_code TEXT,
    error_message TEXT,
    provider_response_json TEXT,
    queued_at TEXT,
    published_at TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE social_publication_events (
    id TEXT PRIMARY KEY,
    publication_id TEXT,
    variant_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE drive_files (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    sha256 TEXT,
    status TEXT NOT NULL
  );

  CREATE TABLE social_media_delivery_grants (
    id TEXT PRIMARY KEY,
    publication_id TEXT,
    file_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE social_posting_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL
  );

  CREATE TABLE social_posting_plan_items (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    variant_id TEXT NOT NULL
  );

  CREATE TABLE social_posting_reservations (
    id TEXT PRIMARY KEY,
    plan_item_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    range_start TEXT NOT NULL,
    range_end TEXT NOT NULL,
    status TEXT NOT NULL
  );

  CREATE UNIQUE INDEX idx_social_publications_same_time_scheduled
    ON social_publications(variant_id, scheduled_for)
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;

  CREATE UNIQUE INDEX idx_social_publications_one_in_flight_variant
    ON social_publications(variant_id)
    WHERE status IN ('queued', 'publishing');
`;
