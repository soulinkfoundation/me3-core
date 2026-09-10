import { getSiteImageMetadata, saveUploadedImageMetadata } from "../site-images";
import {
  LANDING_PAGES_PLUGIN_ID,
  buildLandingPageDocument,
  normalizeLandingPageDocument,
  normalizeLandingPageDesignPackId,
  normalizeLandingTemplate,
  renderLandingPageHtml,
} from "@me3-core/plugin-landing-pages";
import { isCorePluginEnabled } from "../plugins";
import { generateSiteHtml, markdownToHtml, type Me3SiteProfile } from "@me3-core/site-renderer";
import { buildPublicMe3Profile } from "../public-me-profile";
import {
  removePublishedProfileFromSoulinkDirectory,
  syncPublishedProfileToSoulinkDirectory,
} from "../network-directory";
import {
  bookingDetailsFromBooking,
  getOwnerContact,
  sendGuestBookingConfirmationEmail,
  sendProductPurchaseConfirmationEmail,
} from "../transactional-emails";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import type { DbBooking, DbSite, DbSubscriber, Env } from "../types";
import {
  SitePageInputError,
  createSitePage,
  deleteSitePage,
  getSitePage,
  listSitePageRevisions,
  listSitePages,
  migrateLegacyLandingPages,
  parsePageDocument,
  publishSitePage,
  restoreSitePageRevision,
  saveSitePageDraft,
  serializeSitePage,
  unpublishSitePage,
} from "../site-pages";
import {
  applyPurchaseEmailTokens,
  productSendsPurchaseConfirmation,
} from "../../../../shared/product-purchase-confirmation";
import { getProfileCommercePublishBlockReason } from "../commerce-readiness";
import {
  ManagedSiteDomainError,
  connectManagedSiteDomain,
  disconnectManagedSiteDomain,
  getManagedSiteDomainStatus,
  isManagedSiteDomainDeployment,
  type ManagedSiteDomainStatus,
} from "../managed-site-domains";
import {
  EMAIL_REGEX,
  MAX_SITE_AUDIO_BYTES,
  USERNAME_REGEX,
  arrayBufferToText,
  buildContentMetaMap,
  buildCoreDomainStatus,
  createEmptyPublishManifest,
  deleteSiteFile,
  escapeCsv,
  escapeHtml,
  findHeaderIndex,
  getContentType,
  getSiteContentAssetUploadMetadata,
  getCoreDomainInstructions,
  getCoreDomainState,
  getCoreWebOrigin,
  getPublicSiteOrigin,
  getPublishedSiteBaseUrl,
  getGeneratedSiteContentType,
  getMe3CloudUsernamePublishBlockReason,
  getSiteByUsername,
  getSiteFile,
  getSiteFileText,
  getSiteForOwner,
  getSiteStorageStatus,
  getOwnerProfile,
  hashSubscriberIdentifier,
  imageExtension,
  injectBaseHref,
  isMissingSiteFilesTableError,
  isMissingSubscribersTableError,
  isSiteMediaFile,
  isValidPublicSiteDomain,
  listSiteProfileMetadata,
  listSiteFiles,
  loadLandingPage,
  loadPublishManifest,
  loadSiteSourceFiles,
  normalizeDomain,
  normalizeImportedTimestamp,
  normalizeNullableText,
  normalizeProductCurrency,
  normalizeProductPriceCents,
  normalizeSiteFileName,
  normalizeSiteMediaPath,
  normalizeUsername,
  parseCsvLine,
  parseSiteProfile,
  parseSubscriberBody,
  pruneGeneratedPublicFiles,
  pruneUnreferencedContentAssets,
  pruneUnreferencedSiteSourceFiles,
  putR2SiteFile,
  putSiteFile,
  putSiteMediaFile,
  renderNotFoundPage,
  saveLandingPage,
  savePublishManifest,
  serveDefaultPublicSitePath,
  serveMeJsonResponse,
  servePublicSiteByUsername,
  serveSiteFileResponse,
  sha256Buffer,
  sha256Text,
  shouldIgnoreSiteSourceFile,
  siteFileContentToBytes,
  siteStorageSetupRequired,
  splitImportedName,
  subscribersSetupRequired,
  titleFromSlug,
  unsubscribeHtml,
  verifyUnsubscribeToken,
} from "../sites";
import {
  SiteLifecycleError,
  createPersistentSite,
  deleteAdditionalSite,
  getSiteQuota,
  parseSiteRole,
  renamePersistentSite,
  renameProfileSite,
  assignBusinessSiteProfile,
} from "../site-lifecycle";
import {
  SiteBrandingInputError,
  getSiteBranding,
  updateSiteBranding,
} from "../site-branding";
import {
  MARKETING_PERMISSION_ATTESTATION_VERSION,
  createImportAttestationEvidence,
  createSiteFormPermissionEvidence,
} from "../campaign-audience";
import { listLatestSiteBuilderThreads } from "../site-builder-threads";
import {
  confirmDoubleOptInSubscriber,
  getDoubleOptInConfirmationStatus,
  requestDoubleOptInSubscription,
} from "../subscriber-confirmations";

type LandingPageGenerateBody = {
  username?: string;
  brief?: string;
  templateId?: string;
  heroImage?: string | null;
  sectionImage?: string | null;
  feedback?: string | null;
};

export function registerSiteRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/sites", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const [result, profileMetadata] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, user_id, username, site_type, site_role, template_id, profile_site_id, custom_domain,
                custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
         FROM sites
         WHERE user_id = ?
         ORDER BY created_at DESC`,
      )
        .bind(ownerId)
        .all<DbSite>(),
      listSiteProfileMetadata(c.env, ownerId),
    ]);

    const sites = result.results || [];
    const builderThreads = await listLatestSiteBuilderThreads(
      c.env.DB,
      ownerId,
      sites.map((site) => site.username),
    );

    return c.json({
      sites: sites.map((site) => ({
        ...site,
        bookings_enabled: profileMetadata.bookingEnabledSiteIds.has(site.id),
        avatar: profileMetadata.avatarBySiteId.get(site.id) || null,
        builder_thread_id: builderThreads.get(site.username) || null,
      })),
    });
  });

  app.get("/api/sites/quota", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    return c.json(await getSiteQuota(c.env, ownerId));
  });

  app.get("/api/sites/:username/branding", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    return c.json({ branding: await getSiteBranding(c.env, site) });
  });

  app.put("/api/sites/:username/branding", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      return c.json({
        branding: await updateSiteBranding(
          c.env,
          site,
          await c.req.json<Record<string, unknown>>().catch(() => ({})),
        ),
      });
    } catch (error) {
      if (error instanceof SiteBrandingInputError) {
        return c.json({ error: error.message }, error.status);
      }
      console.error("Site branding update error:", error);
      return c.json({ error: "Could not update Site branding" }, 500);
    }
  });

  app.post("/api/sites/:username/products/confirmation-email/test", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const body = await c.req
      .json<{
        operationId?: unknown;
        productSlug?: unknown;
        productTitle?: unknown;
        siteName?: unknown;
        subject?: unknown;
        message?: unknown;
      }>()
      .catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const productSlug = normalizeShortEmailText(body.productSlug, 120) || null;
    const productTitle = normalizeShortEmailText(body.productTitle, 120);
    const siteName = normalizeShortEmailText(body.siteName, 120) || site.username;
    const subject = normalizeShortEmailText(body.subject, 200);
    const message = normalizeLongEmailText(body.message, 8000);
    if (!productTitle) return c.json({ error: "Product title is required" }, 400);
    if (!productSendsPurchaseConfirmation({ enabled: true, subject, message })) {
      return c.json({ error: "Add both a subject and message before sending a test email" }, 400);
    }

    const owner = await getOwnerContact(c.env, ownerId);
    if (!owner.email) return c.json({ error: "Owner email is required for test sends" }, 400);

    const tokenCtx = {
      buyerName: "Test Buyer",
      buyerNote: "Looking forward to this.",
      productTitle,
      siteName,
      supportEmail: owner.email,
    };
    const result = await sendProductPurchaseConfirmationEmail(c.env, {
      ownerId,
      hostName: siteName,
      hostEmail: owner.email,
      buyerName: tokenCtx.buyerName,
      buyerEmail: owner.email,
      productTitle,
      subject: applyPurchaseEmailTokens(subject, tokenCtx),
      messageText: applyPurchaseEmailTokens(message, tokenCtx),
      operationId: typeof body.operationId === "string" ? body.operationId : undefined,
      test: true,
    });
    if (result.status !== "sent") {
      return c.json({ error: result.error || "Failed to send test email" }, 502);
    }

    return c.json({
      ok: true,
      sentTo: owner.email,
      providerMessageId: result.providerMessageId,
      subject: `[Test] ${applyPurchaseEmailTokens(subject, tokenCtx)}`,
      productSlug,
      preview: tokenCtx,
    });
  });

  app.post("/api/sites/:username/bookings/confirmation-email/test", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const body = await c.req
      .json<{
        operationId?: unknown;
        startedAt?: unknown;
        to?: unknown;
        bookingTitle?: unknown;
        siteName?: unknown;
        message?: unknown;
        durationMinutes?: unknown;
        timezone?: unknown;
        paymentMethod?: unknown;
        amountDue?: unknown;
        currency?: unknown;
        paymentInstructions?: unknown;
      }>()
      .catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);

    const owner = await getOwnerContact(c.env, ownerId);
    if (!owner.email) return c.json({ error: "Owner email is required for test sends" }, 400);
    const requestedRecipient =
      typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
    const recipient = requestedRecipient || owner.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(recipient)) {
      return c.json({ error: "Enter a valid test recipient email address" }, 400);
    }

    const testStartedAt = typeof body.startedAt === "string" ? Date.parse(body.startedAt) : Date.now();
    if (!Number.isFinite(testStartedAt)) return c.json({ error: "Invalid test start time" }, 400);
    const startsAt = new Date(testStartedAt + 24 * 60 * 60_000).toISOString();
    const manualPayment = body.paymentMethod === "manual";
    const amountDue = Number(body.amountDue);
    const currency = normalizeShortEmailText(body.currency, 3).toLowerCase();
    const paymentInstructions = manualPayment
      ? normalizeLongEmailText(body.paymentInstructions, 8000)
      : "";
    const booking: DbBooking = {
      id: "test-booking",
      site_id: site.id,
      offer_id: "test-offer",
      booking_type: "one_to_one",
      guest_name: "Test Guest",
      guest_email: recipient,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString(),
      duration_minutes: normalizePositiveInteger(body.durationMinutes, 60),
      calendar_event_id: null,
      status: "confirmed",
      notes: "Looking forward to this.",
      created_at: startsAt,
      cancelled_at: null,
      payment_intent_id: null,
      amount_paid: null,
      suggested_amount:
        manualPayment && Number.isFinite(amountDue) && amountDue > 0
          ? Math.round(amountDue * 100)
          : null,
      currency:
        manualPayment && /^[a-z]{3}$/.test(currency)
          ? (currency as DbBooking["currency"])
          : null,
      payment_status: "not_required",
      is_free_booking: manualPayment ? 0 : 1,
      paid_at: null,
    };
    const result = await sendGuestBookingConfirmationEmail(
      c.env,
      bookingDetailsFromBooking({
        booking,
        ownerId,
        hostName:
          normalizeShortEmailText(body.siteName, 120) ||
          owner.name ||
          site.username,
        hostEmail: owner.email,
        bookingTitle:
          normalizeShortEmailText(body.bookingTitle, 120) ||
          "Book a session",
        timezone: normalizeShortEmailText(body.timezone, 80) || "UTC",
        guestMessageText: normalizeLongEmailText(body.message, 8000),
        paymentInstructions,
        operationId: typeof body.operationId === "string" ? body.operationId : undefined,
        test: true,
      }),
    );
    if (result.status !== "sent") {
      return c.json({ error: result.error || "Failed to send test email" }, 502);
    }

    return c.json({ ok: true, sentTo: recipient, providerMessageId: result.providerMessageId });
  });

  app.post("/api/sites/:username/subscribe", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    try {
      const { email, firstName, lastName, honeypot, pageId, actionId, campaign } =
        await parseSubscriberBody(c);
      if (honeypot) return c.json({ ok: true, message: "Subscribed successfully" });
      if (!email) return c.json({ error: "Email is required" }, 400);

      const normalizedEmail = email.toLowerCase().trim();
      if (!EMAIL_REGEX.test(normalizedEmail)) return c.json({ error: "Invalid email address" }, 400);

      const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for");
      const ipHash = clientIp ? await hashSubscriberIdentifier(clientIp) : null;
      const profileJson =
        (await getSiteFileText(c.env, site.id, "src/me.json")) ||
        (await getSiteFileText(c.env, site.id, "public/me.json"));
      const profile = profileJson ? parseSiteProfile(profileJson, site.username) : null;
      const subscribe = profile?.intents?.subscribe;

      if (subscribe?.doubleOptIn === true) {
        const origin =
          getPublicSiteOrigin(c.env, {
            custom_domain:
              site.custom_domain_status === "active" ? site.custom_domain : null,
          }) || new URL(c.req.url).origin;
        const result = await requestDoubleOptInSubscription(c.env, {
          site,
          email: normalizedEmail,
          firstName: normalizeNullableText(firstName),
          lastName: normalizeNullableText(lastName),
          ipHash,
          pageId: normalizeNullableText(pageId),
          actionId: normalizeNullableText(actionId),
          campaign: normalizeNullableText(campaign),
          confirmationOrigin: origin,
          siteName: profile?.name?.trim() || site.username,
          newsletterName:
            subscribe.title?.trim() || profile?.name?.trim() || site.username,
        });
        if (result === "unavailable") {
          return c.json(
            { error: "Email confirmation is unavailable right now. Please try again later." },
            503,
          );
        }
        return c.json({
          ok: true,
          message: "Thanks. If confirmation is needed, check your inbox.",
        });
      }

      const permissionEvidence = createSiteFormPermissionEvidence({
        pageId: normalizeNullableText(pageId),
        actionId: normalizeNullableText(actionId),
        campaign: normalizeNullableText(campaign),
      });

      const existing = await c.env.DB.prepare(
        `SELECT id, unsubscribed_at, marketing_status
         FROM subscribers WHERE site_id = ? AND email = ?`,
      )
        .bind(site.id, normalizedEmail)
        .first<{
          id: number;
          unsubscribed_at: string | null;
          marketing_status: "pending" | "marketable";
        }>();

      if (existing) {
        if (existing.unsubscribed_at || existing.marketing_status === "pending") {
          await c.env.DB.prepare(
            `UPDATE subscribers
             SET unsubscribed_at = NULL, subscribed_at = CURRENT_TIMESTAMP,
                 page_id = ?, action_id = ?, campaign = ?,
                 marketing_status = 'marketable',
                 marketing_permission_method = 'single_opt_in',
                 marketing_permission_granted_at = CURRENT_TIMESTAMP,
                 marketing_permission_evidence_json = ?
             WHERE id = ?`,
          )
            .bind(
              normalizeNullableText(pageId),
              normalizeNullableText(actionId),
              normalizeNullableText(campaign),
              permissionEvidence,
              existing.id,
            )
            .run();
          return c.json({
            ok: true,
            message: existing.unsubscribed_at
              ? "Welcome back! You've been re-subscribed."
              : "Subscribed successfully!",
          });
        }
        return c.json({ ok: true, message: "You're already subscribed!" });
      }

      await c.env.DB.prepare(
        `INSERT INTO subscribers
         (site_id, email, first_name, last_name, source, ip_hash, page_id, action_id, campaign,
          marketing_status, marketing_permission_method, marketing_permission_granted_at,
          marketing_permission_evidence_json)
         VALUES (?, ?, ?, ?, 'me3', ?, ?, ?, ?, 'marketable', 'single_opt_in',
                 CURRENT_TIMESTAMP, ?)`,
      )
        .bind(
          site.id,
          normalizedEmail,
          normalizeNullableText(firstName),
          normalizeNullableText(lastName),
          ipHash,
          normalizeNullableText(pageId),
          normalizeNullableText(actionId),
          normalizeNullableText(campaign),
          permissionEvidence,
        )
        .run();

      return c.json({ ok: true, message: "Subscribed successfully!" });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Subscribe error:", error);
      return c.json({ error: "Failed to subscribe" }, 500);
    }
  });

  app.on(["GET", "POST"], "/api/sites/:username/subscribe/confirm", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return confirmationHtml("Site not found", "This confirmation link is invalid.", 404);

    const isPost = c.req.method === "POST";
    const form = isPost ? await c.req.formData().catch(() => null) : null;
    const email = (isPost ? form?.get("email")?.toString() : c.req.query("email"))?.toLowerCase().trim() || "";
    const token = (isPost ? form?.get("token")?.toString() : c.req.query("token")) || "";
    if (!EMAIL_REGEX.test(email) || !token) {
      return confirmationHtml("Invalid confirmation link", "This link is invalid or expired.", 400);
    }

    try {
      const input = { siteId: site.id, email, token };
      // Link previews may GET this page; only the reader's form submission grants permission.
      const status = isPost
        ? await confirmDoubleOptInSubscriber(c.env, input)
        : await getDoubleOptInConfirmationStatus(c.env, input);
      if (status === "confirmed") {
        return confirmationHtml("Subscription confirmed", "You're subscribed and can close this page.");
      }
      if (status !== "ready") {
        return confirmationHtml("Invalid confirmation link", "This link is invalid or expired.", 400);
      }
      return confirmationHtml(
        "Confirm your subscription",
        `Confirm that ${email} should receive this newsletter.`,
        200,
        { username: site.username, email, token },
      );
    } catch (error) {
      if (isMissingSubscribersTableError(error)) {
        return confirmationHtml("Setup required", "Subscriber storage is not ready yet.", 503);
      }
      console.error("Subscription confirmation error:", error);
      return confirmationHtml("Something went wrong", "Please try again later.", 500);
    }
  });

  app.get("/api/sites/:username/unsubscribe", async (c) => {
    const email = c.req.query("email");
    const token = c.req.query("token");
    const username = normalizeUsername(c.req.param("username"));
    if (!email || !token || !username) return unsubscribeHtml("Invalid unsubscribe link", "This link appears to be invalid or expired.");

    const normalizedEmail = email.toLowerCase().trim();
    if (!(await verifyUnsubscribeToken(c.env, normalizedEmail, username, token))) {
      return unsubscribeHtml("Invalid unsubscribe link", "This link appears to be invalid or expired.");
    }

    const site = await getSiteByUsername(c.env, username);
    if (!site) return unsubscribeHtml("Site not found");

    try {
      await c.env.DB.prepare(
        "UPDATE subscribers SET unsubscribed_at = CURRENT_TIMESTAMP WHERE site_id = ? AND email = ?",
      )
        .bind(site.id, normalizedEmail)
        .run();

      return unsubscribeHtml(
        "You've been unsubscribed",
        "You will no longer receive emails from this newsletter.",
        "Changed your mind? Visit the site to subscribe again.",
      );
    } catch (error) {
      console.error("Unsubscribe error:", error);
      return unsubscribeHtml("Something went wrong", "Please try again later.");
    }
  });

  app.get("/api/sites/:username/subscribers/count", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const result = await c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM subscribers WHERE site_id = ? AND unsubscribed_at IS NULL",
      )
        .bind(site.id)
        .first<{ count: number | string | null }>();
      return c.json({ count: Number(result?.count || 0) });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Get subscriber count error:", error);
      return c.json({ error: "Failed to get subscriber count" }, 500);
    }
  });

  app.post("/api/sites/:username/subscribers/marketing-permission/attest", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    const body = await c.req
      .json<{ confirmed?: unknown; statementVersion?: unknown }>()
      .catch((): { confirmed?: unknown; statementVersion?: unknown } => ({}));
    if (
      body.confirmed !== true ||
      body.statementVersion !== MARKETING_PERMISSION_ATTESTATION_VERSION
    ) {
      return c.json(
        {
          error: "Marketing permission confirmation is required",
          statementVersion: MARKETING_PERMISSION_ATTESTATION_VERSION,
        },
        400,
      );
    }

    try {
      const attestedAt = new Date().toISOString();
      const evidence = createImportAttestationEvidence({
        attestedAt,
        source: "owner_list",
      });
      const result = await c.env.DB.prepare(
        `UPDATE subscribers
         SET marketing_status = 'marketable',
             marketing_permission_method = 'import_attested',
             marketing_permission_granted_at = ?,
             marketing_permission_evidence_json = ?
         WHERE site_id = ?
           AND unsubscribed_at IS NULL
           AND marketing_status = 'pending'
           AND marketing_permission_method IS NULL
           AND delivery_status = 'deliverable'`,
      )
        .bind(attestedAt, evidence, site.id)
        .run();

      return c.json({
        ok: true,
        attested: Number(result.meta.changes || 0),
        statementVersion: MARKETING_PERMISSION_ATTESTATION_VERSION,
      });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Attest subscriber marketing permission error:", error);
      return c.json({ error: "Failed to record marketing permission" }, 500);
    }
  });

  app.get("/api/sites/:username/subscribers/export", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const result = await c.env.DB.prepare(
        `SELECT email, first_name, last_name, source, page_id, action_id, campaign, subscribed_at,
                marketing_status, marketing_permission_method, delivery_status
         FROM subscribers
         WHERE site_id = ? AND unsubscribed_at IS NULL
         ORDER BY subscribed_at DESC`,
      )
        .bind(site.id)
        .all<DbSubscriber>();
      const rows = [[
        "email",
        "first_name",
        "last_name",
        "source",
        "page_id",
        "action_id",
        "campaign",
        "subscribed_at",
        "marketing_status",
        "marketing_permission_method",
        "delivery_status",
      ].join(",")];
      for (const subscriber of result.results || []) {
        rows.push(
          [
            escapeCsv(subscriber.email),
            escapeCsv(subscriber.first_name || ""),
            escapeCsv(subscriber.last_name || ""),
            escapeCsv(subscriber.source),
            escapeCsv(subscriber.page_id || ""),
            escapeCsv(subscriber.action_id || ""),
            escapeCsv(subscriber.campaign || ""),
            escapeCsv(subscriber.subscribed_at),
            escapeCsv(subscriber.marketing_status),
            escapeCsv(subscriber.marketing_permission_method || ""),
            escapeCsv(subscriber.delivery_status),
          ].join(","),
        );
      }

      const filename = `${site.username}-audience-${new Date().toISOString().split("T")[0]}.csv`;
      return new Response(rows.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Export subscribers error:", error);
      return c.json({ error: "Failed to export subscribers" }, 500);
    }
  });

  app.get("/api/sites/:username/subscribers", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const page = Math.max(1, Number.parseInt(c.req.query("page") || "1", 10));
      const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") || "50", 10)));
      const offset = (page - 1) * limit;
      const countResult = await c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM subscribers WHERE site_id = ? AND unsubscribed_at IS NULL",
      )
        .bind(site.id)
        .first<{ count: number | string | null }>();
      const total = Number(countResult?.count || 0);
      const result = await c.env.DB.prepare(
        `SELECT id, email, first_name, last_name, source, page_id, action_id, campaign, subscribed_at,
                marketing_status, marketing_permission_method, marketing_permission_granted_at,
                delivery_status
         FROM subscribers
         WHERE site_id = ? AND unsubscribed_at IS NULL
         ORDER BY subscribed_at DESC
         LIMIT ? OFFSET ?`,
      )
        .bind(site.id, limit, offset)
        .all<DbSubscriber>();

      return c.json({
        subscribers: result.results || [],
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("List subscribers error:", error);
      return c.json({ error: "Failed to list subscribers" }, 500);
    }
  });

  app.post("/api/sites/:username/subscribers", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const body = await c.req
        .json<{ email?: unknown; firstName?: unknown; lastName?: unknown }>()
        .catch((): { email?: unknown; firstName?: unknown; lastName?: unknown } => ({}));
      if (typeof body.email !== "string") return c.json({ error: "Email is required" }, 400);
      const email = body.email.toLowerCase().trim();
      if (!EMAIL_REGEX.test(email)) return c.json({ error: "Invalid email address" }, 400);

      const existing = await c.env.DB.prepare(
        "SELECT id, unsubscribed_at FROM subscribers WHERE site_id = ? AND email = ?",
      )
        .bind(site.id, email)
        .first<{ id: number; unsubscribed_at: string | null }>();

      if (existing) {
        if (existing.unsubscribed_at) {
          await c.env.DB.prepare(
            `UPDATE subscribers
             SET unsubscribed_at = NULL,
                 subscribed_at = CURRENT_TIMESTAMP,
                 source = 'manual',
                 marketing_status = 'pending',
                 marketing_permission_method = NULL,
                 marketing_permission_granted_at = NULL,
                 marketing_permission_evidence_json = NULL
             WHERE id = ?`,
          )
            .bind(existing.id)
            .run();
          return c.json({ ok: true, resubscribed: true });
        }
        return c.json({ error: "Email is already subscribed" }, 409);
      }

      await c.env.DB.prepare(
        `INSERT INTO subscribers (site_id, email, first_name, last_name, source)
         VALUES (?, ?, ?, ?, 'manual')`,
      )
        .bind(site.id, email, normalizeNullableText(body.firstName), normalizeNullableText(body.lastName))
        .run();

      return c.json({ ok: true, resubscribed: false });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Add subscriber error:", error);
      return c.json({ error: "Failed to add subscriber" }, 500);
    }
  });

  app.delete("/api/sites/:username/subscribers/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const result = await c.env.DB.prepare("DELETE FROM subscribers WHERE id = ? AND site_id = ?")
        .bind(c.req.param("id"), site.id)
        .run();
      const changes = Number(result.meta.changes || 0);
      if (changes === 0) return c.json({ error: "Subscriber not found" }, 404);
      return c.json({ ok: true });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Delete subscriber error:", error);
      return c.json({ error: "Failed to delete subscriber" }, 500);
    }
  });

  app.post("/api/sites/:username/subscribers/import", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found or unauthorized" }, 404);

    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) return c.json({ error: "CSV file is required" }, 400);

      const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
      }

      const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase().trim());
      const emailIndex = findHeaderIndex(header, ["email", "email address", "email_address", "emailaddress"]);
      if (emailIndex === -1) return c.json({ error: "CSV must have an 'email' column" }, 400);

      const firstNameIndex = findHeaderIndex(header, ["first_name", "firstname", "first name", "fname"]);
      const lastNameIndex = findHeaderIndex(header, ["last_name", "lastname", "last name", "lname"]);
      const fullNameIndex = findHeaderIndex(header, ["name", "full_name", "full name"]);
      const subscribedAtIndex = findHeaderIndex(header, [
        "subscribed_at",
        "subscribed at",
        "start date",
        "start_date",
        "created_at",
        "created at",
      ]);
      const source = header.includes("start date") && header.includes("revenue") ? "substack_import" : "import";
      const seen = new Set<string>();
      let imported = 0;
      let skipped = 0;

      for (const line of lines.slice(1)) {
        const values = parseCsvLine(line);
        const email = values[emailIndex]?.toLowerCase().trim();
        if (!email || !EMAIL_REGEX.test(email) || seen.has(email)) {
          skipped++;
          continue;
        }
        seen.add(email);

        const name = fullNameIndex >= 0 ? splitImportedName(values[fullNameIndex]) : { firstName: null, lastName: null };
        const subscribedAt = subscribedAtIndex >= 0 ? normalizeImportedTimestamp(values[subscribedAtIndex]) : null;
        const result = await c.env.DB.prepare(
          `INSERT OR IGNORE INTO subscribers (site_id, email, first_name, last_name, source, subscribed_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        )
          .bind(
            site.id,
            email,
            firstNameIndex >= 0 ? normalizeNullableText(values[firstNameIndex]) : name.firstName,
            lastNameIndex >= 0 ? normalizeNullableText(values[lastNameIndex]) : name.lastName,
            source,
            subscribedAt,
          )
          .run();
        if (Number(result.meta.changes || 0) > 0) imported++;
        else skipped++;
      }

      return c.json({ ok: true, imported, skipped, total: lines.length - 1 });
    } catch (error) {
      if (isMissingSubscribersTableError(error)) return subscribersSetupRequired(c);
      console.error("Import subscribers error:", error);
      return c.json({ error: "Failed to import subscribers" }, 500);
    }
  });

  app.post("/api/sites", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req
      .json<{
        username?: unknown;
        siteType?: unknown;
        siteRole?: unknown;
        templateId?: unknown;
        profileSiteId?: unknown;
        renameFromSiteId?: unknown;
        renameFromUsername?: unknown;
      }>()
      .catch(
        (): {
          username?: unknown;
          siteType?: unknown;
          siteRole?: unknown;
          templateId?: unknown;
          profileSiteId?: unknown;
          renameFromSiteId?: unknown;
          renameFromUsername?: unknown;
        } => ({}),
      );
    const username = normalizeUsername(body.username);
    if (!username || !USERNAME_REGEX.test(username)) {
      return c.json({ error: "Username must be 3-30 characters and use letters, numbers, underscores, or hyphens" }, 400);
    }

    const siteType = body.siteType === "landing_page" ? "landing_page" : "profile";
    if (siteType === "landing_page") {
      return c.json(
        {
          error: "Create landing pages inside an existing site.",
          action: "createSitePage",
        },
        409,
      );
    }

    const requestedRole = parseSiteRole(body.siteRole);
    if (body.siteRole !== undefined && !requestedRole) {
      return c.json({ error: "Site role must be profile or organization" }, 400);
    }
    const siteRole = requestedRole || "profile";
    const renameFromSiteId =
      typeof body.renameFromSiteId === "string"
        ? body.renameFromSiteId.trim()
        : "";
    if (body.renameFromSiteId !== undefined && !renameFromSiteId) {
      return c.json({ error: "The site being renamed is invalid" }, 400);
    }
    const renameFromUsername = normalizeUsername(body.renameFromUsername);
    if (body.renameFromUsername !== undefined && !renameFromUsername) {
      return c.json({ error: "The profile being renamed is invalid" }, 400);
    }
    if (renameFromUsername && siteRole !== "profile") {
      return c.json({ error: "Only the ME3 Profile can be renamed" }, 400);
    }
    if (renameFromSiteId && renameFromUsername) {
      return c.json({ error: "Choose one site rename target" }, 400);
    }
    const profileSiteId =
      typeof body.profileSiteId === "string" && body.profileSiteId.trim()
        ? body.profileSiteId.trim()
        : null;
    if (body.profileSiteId !== undefined && !profileSiteId) {
      return c.json({ error: "The selected ME3 Profile is invalid" }, 400);
    }

    const cloudUsernameError = await getMe3CloudUsernamePublishBlockReason(c.env, username);
    if (cloudUsernameError) return c.json({ error: cloudUsernameError }, 409);

    try {
      if (renameFromSiteId) {
        const site = await renamePersistentSite(c.env, {
          ownerId,
          siteId: renameFromSiteId,
          expectedRole: siteRole,
          toUsername: username,
        });
        return c.json({ site, renamed: true });
      }
      if (renameFromUsername) {
        const site = await renameProfileSite(c.env, {
          ownerId,
          fromUsername: renameFromUsername,
          toUsername: username,
        });
        return c.json({ site, renamed: true });
      }

      const site = await createPersistentSite(c.env, {
        id: crypto.randomUUID(),
        ownerId,
        username,
        role: siteRole,
        templateId:
          typeof body.templateId === "string" && body.templateId.trim()
            ? body.templateId.trim()
            : null,
        profileSiteId,
      });
      return c.json({ site }, 201);
    } catch (error) {
      if (error instanceof SiteLifecycleError) {
        return siteLifecycleErrorResponse(c, error);
      }
      console.error("Create site error:", error);
      return c.json({ error: "Failed to create site" }, 500);
    }
  });

  app.put("/api/sites/:username/profile-owner", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req
      .json<{ profileSiteId?: unknown }>()
      .catch((): { profileSiteId?: unknown } => ({}));
    const profileSiteId =
      typeof body.profileSiteId === "string" ? body.profileSiteId.trim() : "";
    if (!profileSiteId) {
      return c.json({ error: "Choose a ME3 Profile" }, 400);
    }
    try {
      return c.json({
        site: await assignBusinessSiteProfile(c.env, {
          ownerId,
          username: c.req.param("username"),
          profileSiteId,
        }),
      });
    } catch (error) {
      if (error instanceof SiteLifecycleError) {
        return siteLifecycleErrorResponse(c, error);
      }
      console.error("Business Site profile assignment error:", error);
      return c.json({ error: "Could not assign the ME3 Profile" }, 500);
    }
  });

  app.get("/api/sites/:username/publish-manifest", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    try {
      return c.json({
        manifest: (await loadPublishManifest(c.env, site.id)) || createEmptyPublishManifest(),
      });
    } catch (error) {
      if (isMissingSiteFilesTableError(error)) return siteStorageSetupRequired(c);
      throw error;
    }
  });

  app.get("/api/sites/:username/storage", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    return c.json(await getSiteStorageStatus(c.env, site));
  });

  app.post("/api/sites/:username/storage/migrate-media", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    if (!c.env.SITE_ASSETS) {
      return c.json({ error: "SITE_ASSETS R2 binding is not configured" }, 400);
    }

    const mediaFiles = await listSiteFiles(c.env, site.id, "public/files/");
    const favicon = await getSiteFile(c.env, site.id, "public/favicon.png");
    const files = favicon ? [favicon, ...mediaFiles] : mediaFiles;
    let migrated = 0;

    for (const file of files) {
      await putR2SiteFile(c.env, site, file.path, siteFileContentToBytes(file.content), file.content_type);
      await deleteSiteFile(c.env, site.id, file.path);
      migrated += 1;
    }

    return c.json({
      ok: true,
      migrated,
      storage: await getSiteStorageStatus(c.env, site),
    });
  });

  app.get("/api/domains/:username", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    if (isManagedSiteDomainDeployment(c.env)) {
      try {
        const status = await getManagedSiteDomainStatus(c.env, site);
        await syncManagedDomainSite(c.env, site, status);
        return c.json(status);
      } catch (error) {
        if (error instanceof ManagedSiteDomainError) {
          return c.json(
            { error: error.message },
            managedSiteDomainHttpStatus(error.status),
          );
        }
        throw error;
      }
    }

    return c.json(buildCoreDomainStatus(c.env, site));
  });

  app.post("/api/domains/:username", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    if (!site.published_at) {
      return c.json(
        {
          error:
            "Publish this site before connecting a custom domain. This prevents an empty domain from going live.",
        },
        409,
      );
    }

    const body = await c.req.json<{ domain?: unknown }>().catch((): { domain?: unknown } => ({}));
    const domain = normalizeDomain(body.domain);
    if (!isValidPublicSiteDomain(domain)) {
      return c.json({ error: "Use a domain you control, for example kieranbutler.com." }, 400);
    }

    const domainOwner = await c.env.DB.prepare(
      `SELECT id FROM sites
       WHERE lower(custom_domain) = ? AND id <> ?
       LIMIT 1`,
    )
      .bind(domain, site.id)
      .first<{ id: string }>();
    if (domainOwner) {
      return c.json({ error: "This domain is already connected to another site." }, 409);
    }

    if (isManagedSiteDomainDeployment(c.env)) {
      try {
        const status = await connectManagedSiteDomain(c.env, site, domain);
        await syncManagedDomainSite(c.env, site, status);
        return c.json(status);
      } catch (error) {
        if (error instanceof ManagedSiteDomainError) {
          return c.json(
            { error: error.message },
            managedSiteDomainHttpStatus(error.status),
          );
        }
        throw error;
      }
    }

    const status = getCoreDomainState(c.env, site, domain);
    await c.env.DB.prepare(
      `UPDATE sites
       SET custom_domain = ?,
           custom_domain_status = ?,
           custom_domain_cf_id = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(domain, status, site.id)
      .run();

    return c.json({
      ok: true,
      domain,
      status,
      instructions: getCoreDomainInstructions(c.env, domain, site.username),
    });
  });

  app.post("/api/domains/:username/refresh", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    if (isManagedSiteDomainDeployment(c.env)) {
      try {
        const status = await getManagedSiteDomainStatus(c.env, site);
        await syncManagedDomainSite(c.env, site, status);
        return c.json(status);
      } catch (error) {
        if (error instanceof ManagedSiteDomainError) {
          return c.json(
            { error: error.message },
            managedSiteDomainHttpStatus(error.status),
          );
        }
        throw error;
      }
    }

    if (!site.custom_domain) return c.json(buildCoreDomainStatus(c.env, site));

    const status = getCoreDomainState(c.env, site, site.custom_domain);
    await c.env.DB.prepare(
      "UPDATE sites SET custom_domain_status = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(status, site.id)
      .run();

    return c.json(buildCoreDomainStatus(c.env, { ...site, custom_domain_status: status }));
  });

  app.delete("/api/domains/:username", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    if (isManagedSiteDomainDeployment(c.env)) {
      try {
        await disconnectManagedSiteDomain(c.env, site);
      } catch (error) {
        if (error instanceof ManagedSiteDomainError) {
          return c.json(
            { error: error.message },
            managedSiteDomainHttpStatus(error.status),
          );
        }
        throw error;
      }
    }

    await c.env.DB.prepare(
      `UPDATE sites
       SET custom_domain = NULL,
           custom_domain_status = NULL,
           custom_domain_cf_id = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(site.id)
      .run();

    return c.json({ ok: true });
  });

  app.post("/api/sites/:username/upload", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const cloudUsernameError = await getMe3CloudUsernamePublishBlockReason(c.env, site.username);
    if (cloudUsernameError) return c.json({ error: cloudUsernameError }, 409);

    try {
      const form = await c.req.formData();
      const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
      if (files.length === 0) return c.json({ error: "No files uploaded" }, 400);

      const uploadedProfileFile = files.find(
        (file) => normalizeSiteFileName(file.name) === "me.json",
      );
      const nextProfileJson = uploadedProfileFile
        ? await uploadedProfileFile.text()
        : (await getSiteFileText(c.env, site.id, "src/me.json")) ||
          (await getSiteFileText(c.env, site.id, "public/me.json"));
      if (nextProfileJson) {
        const nextProfile = parseSiteProfile(nextProfileJson, site.username);
        const commerceError = await getProfileCommercePublishBlockReason(
          c.env,
          ownerId,
          nextProfile,
        );
        if (commerceError) return c.json({ error: commerceError }, 409);
      }

      const manifest = (await loadPublishManifest(c.env, site.id)) || createEmptyPublishManifest();
      let networkProfile: unknown = null;

      for (const file of files) {
        if (isSiteMediaFile(file.name, file.type)) {
          const buffer = await file.arrayBuffer();
          const relativePath = normalizeSiteMediaPath(file.name);
          await putSiteMediaFile(c.env, site, `public/${relativePath}`, buffer, file.type || getContentType(file.name));
          if (file.type.startsWith("image/")) await saveUploadedImageMetadata(c.env, site, relativePath, buffer);
          manifest.assetFiles[relativePath] = await sha256Buffer(buffer);
          continue;
        }

        const sourceName = normalizeSiteFileName(file.name);
        if (shouldIgnoreSiteSourceFile(sourceName)) continue;
        const content = await file.text();
        const contentType = file.type || getContentType(file.name);
        const sourcePath = `src/${sourceName}`;
        await putSiteFile(c.env, site.id, sourcePath, content, contentType);
        manifest.sourceFiles[sourceName] = await sha256Text(content);
      }

      let sourceFiles = await loadSiteSourceFiles(c.env, site.id);
      const meJson = sourceFiles.get("me.json");
      let isPrivateProfile = false;
      if (meJson) {
        const profile = parseSiteProfile(meJson, site.username);
        isPrivateProfile =
          site.site_role === "profile" && profile.visibility === "private";
        await pruneUnreferencedSiteSourceFiles(c.env, site.id, profile, manifest);
        sourceFiles = await loadSiteSourceFiles(c.env, site.id);
        await pruneUnreferencedContentAssets(c.env, site, sourceFiles, manifest);
        const generatedFiles = isPrivateProfile
          ? {}
          : await generateSiteHtml(
              profile,
              Array.from(sourceFiles.entries()).map(([name, content]) => ({ name, content })),
              undefined, { baseUrl: await getPublishedSiteBaseUrl(c.env, site), images: await getSiteImageMetadata(c.env, site, [...sourceFiles.values()]) },
            );
        networkProfile = buildPublicMe3Profile(profile, await getPublishedSiteBaseUrl(c.env, site));
        generatedFiles["me.json"] = JSON.stringify(networkProfile, null, 2);
        for (const [name, content] of Object.entries(generatedFiles)) {
          await putSiteFile(
            c.env,
            site.id,
            `public/${normalizeSiteFileName(name)}`,
            content,
            getGeneratedSiteContentType(name),
          );
        }
        await pruneGeneratedPublicFiles(c.env, site.id, generatedFiles);
      }

      manifest.updatedAt = new Date().toISOString();
      await savePublishManifest(c.env, site.id, manifest);
      await c.env.DB.prepare(
        isPrivateProfile
          ? "UPDATE sites SET published_at = NULL, updated_at = datetime('now') WHERE id = ?"
          : "UPDATE sites SET published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      )
        .bind(site.id)
        .run();

      if (networkProfile) {
        queueNetworkDirectoryProfileSync(c, site, networkProfile);
      }

      return c.json({
        ok: true,
        publishedAt: isPrivateProfile ? null : new Date().toISOString(),
      });
    } catch (error) {
      if (isMissingSiteFilesTableError(error)) return siteStorageSetupRequired(c);
      if (isD1SiteFileLimitError(error)) return siteStorageActivationRequired(c);
      throw error;
    }
  });

  app.post("/api/sites/:username/upload-image", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    try {
      const form = await c.req.formData();
      const file = form.get("file");
      const type = String(form.get("type") || "image").replace(/[^a-z0-9_-]/gi, "");
      if (!(file instanceof File)) return c.json({ error: "Image file is required" }, 400);
      if (!file.type.startsWith("image/")) return c.json({ error: "Only image uploads are supported" }, 400);

      const ext = imageExtension(file);
      const testimonialIndex = String(form.get("index") || "").replace(/[^0-9]/g, "");
      const baseName = type === "testimonial" && testimonialIndex ? `testimonial-${testimonialIndex}` : type;
      const filename = `${baseName}.${ext}`;
      const relativePath = type === "favicon" ? "favicon.png" : `files/${filename}`;
      const path = `public/${relativePath}`;
      const buffer = await file.arrayBuffer();
      const storage = await putSiteMediaFile(c.env, site, path, buffer, file.type);
      await saveUploadedImageMetadata(c.env, site, relativePath, buffer, form);

      const manifest = (await loadPublishManifest(c.env, site.id)) || createEmptyPublishManifest();
      manifest.assetFiles[relativePath] = await sha256Buffer(buffer);
      manifest.updatedAt = new Date().toISOString();
      await savePublishManifest(c.env, site.id, manifest);

      return c.json({
        ok: true,
        path: relativePath,
        url: relativePath,
        type,
        storage,
      });
    } catch (error) {
      if (isMissingSiteFilesTableError(error)) return siteStorageSetupRequired(c);
      if (isD1SiteFileLimitError(error)) return siteStorageActivationRequired(c);
      throw error;
    }
  });

  app.post("/api/sites/:username/upload-page-image", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "Image file is required" }, 400);
      if (!file.type.startsWith("image/")) return c.json({ error: "Only image uploads are supported" }, 400);

      const pageSlug = String(form.get("pageSlug") || "page").replace(/[^a-z0-9_-]/gi, "");
      const imageIndex = String(form.get("imageIndex") || "1").replace(/[^0-9]/g, "") || "1";
      const ext = imageExtension(file);
      const filename = `${pageSlug}-${imageIndex}.${ext}`;
      const buffer = await file.arrayBuffer();
      const storage = await putSiteMediaFile(c.env, site, `public/files/${filename}`, buffer, file.type);
      await saveUploadedImageMetadata(c.env, site, `files/${filename}`, buffer, form);

      const manifest = (await loadPublishManifest(c.env, site.id)) || createEmptyPublishManifest();
      manifest.assetFiles[`files/${filename}`] = await sha256Buffer(buffer);
      manifest.updatedAt = new Date().toISOString();
      await savePublishManifest(c.env, site.id, manifest);

      return c.json({
        ok: true,
        path: `files/${filename}`,
        url: `files/${filename}`,
        storage,
      });
    } catch (error) {
      if (isMissingSiteFilesTableError(error)) return siteStorageSetupRequired(c);
      if (isD1SiteFileLimitError(error)) return siteStorageActivationRequired(c);
      throw error;
    }
  });

  app.post("/api/sites/:username/upload-content-asset", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "Content asset file is required" }, 400);
      }

      const kindValue = String(form.get("kind") || "").trim().toLowerCase();
      if (kindValue !== "image" && kindValue !== "audio") {
        return c.json({ error: "Content asset kind must be image or audio" }, 400);
      }
      const kind: "image" | "audio" = kindValue;
      const assetId = String(form.get("assetId") || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(assetId)) {
        return c.json({ error: "Content asset ID is invalid" }, 400);
      }

      const metadata = getSiteContentAssetUploadMetadata(file, kind);
      if (!metadata) {
        return c.json(
          {
            error:
              kind === "audio"
                ? "Choose an MP3, M4A, or WAV audio file"
                : "Choose a JPEG, PNG, WebP, or GIF image",
          },
          400,
        );
      }
      if (kind === "audio" && file.size > MAX_SITE_AUDIO_BYTES) {
        return c.json({ error: "Audio files must be 40 MB or smaller" }, 413);
      }

      const relativePath = `files/content/${assetId}.${metadata.ext}`;
      const buffer = await file.arrayBuffer();
      const storage = await putSiteMediaFile(
        c.env,
        site,
        `public/${relativePath}`,
        buffer,
        metadata.mimeType,
      );
      if (kind === "image") await saveUploadedImageMetadata(c.env, site, relativePath, buffer, form);

      const manifest =
        (await loadPublishManifest(c.env, site.id)) || createEmptyPublishManifest();
      manifest.assetFiles[relativePath] = await sha256Buffer(buffer);
      manifest.updatedAt = new Date().toISOString();
      await savePublishManifest(c.env, site.id, manifest);

      return c.json({
        ok: true,
        path: relativePath,
        url: relativePath,
        storage,
        assetId,
        kind,
        mimeType: metadata.mimeType,
      });
    } catch (error) {
      if (isMissingSiteFilesTableError(error)) return siteStorageSetupRequired(c);
      if (isD1SiteFileLimitError(error)) return siteStorageActivationRequired(c);
      throw error;
    }
  });

  app.get("/api/sites/:username/content", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const meJson =
      (await getSiteFileText(c.env, site.id, "src/me.json")) ||
      (await getSiteFileText(c.env, site.id, "public/me.json")) ||
      (await getSiteFileText(c.env, site.id, "me.json"));
    if (!meJson) {
      return c.json({
        ok: true,
        profile: null,
        pages: [],
        posts: [],
        products: [],
      });
    }

    const sourceFiles = await listSiteFiles(c.env, site.id, "src/");
    const profile = JSON.parse(meJson) as Me3SiteProfile;
    const pageMetaBySource = buildContentMetaMap(profile.pages || [], "");
    const postMetaBySource = buildContentMetaMap(profile.posts || [], "blog");
    const productMetaBySource = buildContentMetaMap(profile.products || [], "shop");
    const pages: Array<{ slug: string; title: string; content: string }> = [];
    const posts: Array<Record<string, unknown>> = [];
    const products: Array<Record<string, unknown>> = [];

    for (const file of sourceFiles) {
      if (!file.path.endsWith(".md")) continue;
      const sourceName = file.path.slice("src/".length);
      if (shouldIgnoreSiteSourceFile(sourceName)) continue;
      const slug = sourceName.slice(0, -".md".length);
      const leafSlug = slug.split("/").pop() || slug;
      const meta = slug.startsWith("blog/")
        ? postMetaBySource.get(sourceName)
        : slug.startsWith("shop/")
          ? productMetaBySource.get(sourceName)
          : pageMetaBySource.get(sourceName);
      if (!meta) continue;
      const item = {
        slug: leafSlug,
        title: typeof meta?.title === "string" && meta.title.trim()
          ? meta.title
          : titleFromSlug(slug),
        content: markdownToHtml(await arrayBufferToText(file.content)),
      };
      if (slug.startsWith("blog/")) {
        posts.push({
          ...item,
          type: meta?.type,
          media: meta?.media,
          publishedAt: meta?.publishedAt,
          excerpt: meta?.excerpt,
          draft: meta?.draft,
        });
      } else if (slug.startsWith("shop/")) {
        products.push({
          ...item,
          price: normalizeProductPriceCents(meta?.price),
          currency: normalizeProductCurrency(meta?.currency),
          available: typeof meta?.available === "boolean" ? meta.available : true,
          publishedAt: meta?.publishedAt,
          excerpt: meta?.excerpt,
          confirmationEmail: meta?.confirmationEmail,
        });
      }
      else pages.push(item);
    }

    return c.json({
      ok: true,
      profile,
      pages,
      posts,
      products,
    });
  });

  app.get("/api/sites/:username/preview-html", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const html =
      (await getSiteFileText(c.env, site.id, "landing/index.html")) ||
      (await getSiteFileText(c.env, site.id, "public/index.html"));
    if (!html) return c.body(null, 204);

    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(injectBaseHref(html, `/preview/${site.username}/`));
  });

  app.get("/api/sites/:username/pages", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, LANDING_PAGES_PLUGIN_ID))) {
      return c.json({ error: "Activate ME3 Landing Pages first" }, 403);
    }
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    return c.json({ pages: (await listSitePages(c.env, site.id)).map(serializeSitePage) });
  });

  app.post("/api/sites/:username/pages", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, LANDING_PAGES_PLUGIN_ID))) {
      return c.json({ error: "Activate ME3 Landing Pages first" }, 403);
    }
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req
      .json<{
        slug?: unknown;
        brief?: unknown;
        templateId?: unknown;
        designPackId?: unknown;
      }>()
      .catch(() => null);
    if (!body || typeof body.brief !== "string" || !body.brief.trim()) {
      return c.json({ error: "Brief is required" }, 400);
    }
    const template = normalizeLandingTemplate(body.templateId) || "service";
    const owner = await getOwnerProfile(c.env, ownerId);
    try {
      const page = await createSitePage(c.env, site, {
        username: site.username,
        slug: typeof body.slug === "string" ? body.slug : template,
        brief: body.brief,
        template,
        designPackId:
          normalizeLandingPageDesignPackId(body.designPackId) || undefined,
        profile: {
          name: owner?.name || site.username,
          bio: owner?.bio || null,
          avatar: owner?.avatar_url || null,
          profileUrl: `${getCoreWebOrigin(c.env, c.req.url)}/sites/${site.username}`,
        },
      });
      return c.json({ page: serializeSitePage(page) }, 201);
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.post("/api/sites/:username/pages/migrate-legacy", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const pages = await migrateLegacyLandingPages(c.env, ownerId, site);
    return c.json({ migrated: pages.length, pages: pages.map(serializeSitePage) });
  });

  app.get("/api/sites/:username/pages/:pageId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const page = await getSitePage(c.env, site.id, c.req.param("pageId"));
    if (!page) return c.json({ error: "Page not found" }, 404);
    return c.json({ page: serializeSitePage(page) });
  });

  app.put("/api/sites/:username/pages/:pageId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req.json<{ document?: unknown }>().catch(() => null);
    try {
      const page = await saveSitePageDraft(
        c.env,
        site,
        c.req.param("pageId"),
        body?.document,
      );
      return c.json({ page: serializeSitePage(page) });
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.get("/api/sites/:username/pages/:pageId/preview-html", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const page = await getSitePage(c.env, site.id, c.req.param("pageId"));
    const document = page ? parsePageDocument(page.draft_json) : null;
    if (!page || !document) return c.json({ error: "Page not found" }, 404);
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Content-Security-Policy", "frame-ancestors 'self'");
    return c.html(
      injectBaseHref(
        renderLandingPageHtml(document, site.username, {
          pageId: page.id,
          slug: page.slug,
          campaign: page.slug,
          images: await getSiteImageMetadata(c.env, site, [JSON.stringify(document)]),
        }),
        `/preview/${site.username}/`,
      ),
    );
  });

  app.post("/api/sites/:username/pages/:pageId/publish", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      const result = await publishSitePage(c.env, site, c.req.param("pageId"));
      return c.json({
        page: serializeSitePage(result.page),
        revisionId: result.revision.id,
      });
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.post("/api/sites/:username/pages/:pageId/unpublish", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      return c.json({
        page: serializeSitePage(
          await unpublishSitePage(c.env, site, c.req.param("pageId")),
        ),
      });
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.get("/api/sites/:username/pages/:pageId/revisions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const page = await getSitePage(c.env, site.id, c.req.param("pageId"));
    if (!page) return c.json({ error: "Page not found" }, 404);
    const revisions = await listSitePageRevisions(c.env, page.id);
    return c.json({
      revisions: revisions.map((revision) => ({
        id: revision.id,
        createdAt: revision.created_at,
        document: parsePageDocument(revision.document_json),
      })),
    });
  });

  app.post("/api/sites/:username/pages/:pageId/revisions/:revisionId/restore", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      const page = await restoreSitePageRevision(
        c.env,
        site,
        c.req.param("pageId"),
        c.req.param("revisionId"),
      );
      return c.json({ page: serializeSitePage(page) });
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.delete("/api/sites/:username/pages/:pageId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      await deleteSitePage(c.env, site, c.req.param("pageId"));
      return c.json({ ok: true });
    } catch (error) {
      return sitePageErrorResponse(c, error);
    }
  });

  app.get("/api/sites/:username/landing-page", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, LANDING_PAGES_PLUGIN_ID))) {
      return c.json({ error: "ME3 Landing Pages is coming soon" }, 403);
    }

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const page = await loadLandingPage(c.env, site.id);
    const owner = await getOwnerProfile(c.env, ownerId);
    return c.json({
      site: {
        id: site.id,
        username: site.username,
        templateId: normalizeLandingTemplate(site.template_id),
        publishedAt: site.published_at,
      },
      profile: {
        name: owner?.name || site.username,
        bio: owner?.bio || null,
        avatar: owner?.avatar_url || null,
      },
      page,
    });
  });

  app.put("/api/sites/:username/landing-page", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, LANDING_PAGES_PLUGIN_ID))) {
      return c.json({ error: "ME3 Landing Pages is coming soon" }, 403);
    }

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);

    const body = await c.req.json<{ page?: unknown }>().catch((): { page?: unknown } => ({}));
    const page = normalizeLandingPageDocument(body.page);
    if (!page) return c.json({ error: "Valid landing page is required" }, 400);

    await saveLandingPage(c.env, site, page);
    return c.json({ ok: true, page });
  });

  app.post("/api/agent/landing-pages/generate", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, LANDING_PAGES_PLUGIN_ID))) {
      return c.json({ error: "ME3 Landing Pages is coming soon" }, 403);
    }

    const body: LandingPageGenerateBody = await c.req
      .json<LandingPageGenerateBody>()
      .catch((): LandingPageGenerateBody => ({}));
    const username = normalizeUsername(body.username);
    const site = await getSiteForOwner(c.env, ownerId, username);
    if (!site) return c.json({ error: "Site not found" }, 404);

    const brief = body.brief?.trim();
    if (!brief) return c.json({ error: "Brief is required" }, 400);

    const owner = await getOwnerProfile(c.env, ownerId);
    const page = buildLandingPageDocument({
      username: site.username,
      brief,
      template: normalizeLandingTemplate(body.templateId) || "service",
      heroImage: body.heroImage || null,
      sectionImage: body.sectionImage || null,
      feedback: body.feedback || null,
      profile: {
        name: owner?.name || site.username,
        bio: owner?.bio || null,
        avatar: owner?.avatar_url || null,
        profileUrl: `${getCoreWebOrigin(c.env, c.req.url)}/sites/${site.username}`,
      },
    });

    await saveLandingPage(c.env, site, page);
    return c.json({
      ok: true,
      jobId: crypto.randomUUID(),
      jobType: "landing_page_builder",
      page,
    });
  });

  app.post("/api/sites/:username/publish", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const cloudUsernameError = await getMe3CloudUsernamePublishBlockReason(c.env, site.username);
    if (cloudUsernameError) return c.json({ error: cloudUsernameError }, 409);
    const profileJson =
      (await getSiteFileText(c.env, site.id, "src/me.json")) ||
      (await getSiteFileText(c.env, site.id, "public/me.json"));
    let isPrivateProfile = false;
    if (profileJson) {
      const profile = parseSiteProfile(profileJson, site.username);
      isPrivateProfile =
        site.site_role === "profile" && profile.visibility === "private";
      const commerceError = await getProfileCommercePublishBlockReason(
        c.env,
        ownerId,
        profile,
      );
      if (commerceError) return c.json({ error: commerceError }, 409);
    }
    if (isPrivateProfile) {
      await c.env.DB.prepare(
        "UPDATE sites SET published_at = NULL, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(site.id)
        .run();
      if (profileJson) {
        queueNetworkDirectoryProfileSync(
          c,
          site,
          buildPublicMe3Profile(
            parseSiteProfile(profileJson, site.username),
            getPublicSiteOrigin(c.env, site),
          ),
        );
      }
      return c.json({ ok: true, publishedAt: null });
    }
    const html =
      (await getSiteFileText(c.env, site.id, "landing/index.html")) ||
      (await getSiteFileText(c.env, site.id, "public/index.html"));
    if (!html) return c.json({ error: "Generate or upload the site before publishing." }, 400);

    await c.env.DB.prepare(
      "UPDATE sites SET published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(site.id)
      .run();
    const publicProfileJson = await getSiteFileText(c.env, site.id, "public/me.json");
    if (publicProfileJson) {
      try {
        queueNetworkDirectoryProfileSync(c, site, JSON.parse(publicProfileJson));
      } catch {
        // The already-published site remains authoritative if its public file
        // is unexpectedly invalid. A later valid publish can retry the index.
      }
    }
    return c.json({ ok: true, publishedAt: new Date().toISOString() });
  });

  app.post("/api/sites/:username/unpublish", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    await c.env.DB.prepare(
      "UPDATE sites SET published_at = NULL, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(site.id)
      .run();
    if (site.site_role === "profile") queueNetworkDirectoryProfileRemoval(c);
    return c.json({ ok: true });
  });

  app.delete("/api/sites/:username", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      const site = await deleteAdditionalSite(
        c.env,
        ownerId,
        normalizeUsername(c.req.param("username")),
      );
      if (site.site_role === "profile") queueNetworkDirectoryProfileRemoval(c);
      return c.json({
        ok: true,
        deletedSiteId: site.id,
        releasedAdditionalSiteSlot: site.site_role === "organization",
      });
    } catch (error) {
      if (error instanceof SiteLifecycleError) {
        return siteLifecycleErrorResponse(c, error);
      }
      console.error("Delete site error:", error);
      return c.json({ error: "Failed to delete site" }, 500);
    }
  });
}

function siteLifecycleErrorResponse(c: AppContext, error: SiteLifecycleError) {
  const status = error.code === "site_not_found" ? 404 : 409;
  return c.json({ error: error.message, code: error.code }, status);
}

function queueNetworkDirectoryProfileSync(c: AppContext, site: DbSite, profile: unknown): void {
  // Only the personal site owns the installation's directory identity.
  if (site.site_role !== "profile") return;
  let executionCtx: { waitUntil(promise: Promise<unknown>): void };
  try {
    executionCtx = c.executionCtx;
  } catch {
    // Local/unit Hono invocations do not always provide an ExecutionContext.
    return;
  }
  executionCtx.waitUntil(
    syncPublishedProfileToSoulinkDirectory(c.env, profile).catch((error) => {
      console.error("Failed to sync the published profile to Soulink:", error);
    }),
  );
}

function queueNetworkDirectoryProfileRemoval(c: AppContext): void {
  let executionCtx: { waitUntil(promise: Promise<unknown>): void };
  try {
    executionCtx = c.executionCtx;
  } catch {
    return;
  }
  executionCtx.waitUntil(
    removePublishedProfileFromSoulinkDirectory(c.env).catch((error) => {
      console.error("Failed to remove the public profile directory entry:", error);
    }),
  );
}

function isD1SiteFileLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("File is too large for Core D1 storage")
  );
}

function siteStorageActivationRequired(c: AppContext) {
  return c.json(
    {
      error:
        "File is too large for Core D1 storage. Activate storage in Account settings to upload larger media.",
      activateStorageUrl: "/account?section=storage",
    },
    413,
  );
}

export function registerPublicSiteRoutes(app: AppHono) {
  app.get("/preview/:username/*", async (c) => {
    const username = normalizeUsername(c.req.param("username"));
    const site = await getSiteByUsername(c.env, username);
    if (!site) return c.html(renderNotFoundPage("Site not found"), 404);

    const requestedPath = c.req.path.replace(`/preview/${username}/`, "") || "index.html";
    return serveSiteFileResponse(c.env, site, requestedPath, false, "", c.req.raw);
  });

  app.get("/me", async (c) => {
    const canonicalUrl = new URL(c.req.url);
    canonicalUrl.pathname = `${canonicalUrl.pathname}/`;
    return c.redirect(canonicalUrl.toString(), 308);
  });

  app.get("/me/*", async (c) => {
    const requestedPath = c.req.path.replace(/^\/me\/?/, "") || "index.html";
    return serveDefaultPublicSitePath(c.env, c.req.raw, requestedPath);
  });

  app.get("/site/:username", async (c) => {
    const canonicalUrl = new URL(c.req.url);
    canonicalUrl.pathname = `${canonicalUrl.pathname}/`;
    return c.redirect(canonicalUrl.toString(), 308);
  });

  app.get("/site/:username/*", async (c) => {
    const username = normalizeUsername(c.req.param("username"));
    const prefix = `/site/${username}/`;
    const requestedPath = c.req.path.replace(prefix, "") || "index.html";
    return servePublicSiteByUsername(
      c.env,
      new URL(c.req.url).hostname,
      username,
      requestedPath,
      c.req.raw,
    );
  });

  app.get("/me.json", async (c) => {
    return serveMeJsonResponse(c.env, c.req.raw);
  });

  app.get("/.well-known/me.json", async (c) => {
    return serveMeJsonResponse(c.env, c.req.raw);
  });

  app.get("/.well-known/security.txt", (c) => {
    return c.text(buildSecurityTxt(c.req.url), 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  app.get("/security.txt", (c) => {
    const canonicalUrl = new URL("/.well-known/security.txt", c.req.url);
    return c.redirect(canonicalUrl.toString(), 301);
  });
}

async function syncManagedDomainSite(
  env: Env,
  site: DbSite,
  domainStatus: ManagedSiteDomainStatus,
): Promise<void> {
  if (
    domainStatus.connected &&
    domainStatus.domain &&
    domainStatus.status
  ) {
    await env.DB.prepare(
      `UPDATE sites
       SET custom_domain = ?,
           custom_domain_status = ?,
           custom_domain_cf_id = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(domainStatus.domain, domainStatus.status, site.id)
      .run();
    return;
  }

  if (!site.custom_domain) return;
  await env.DB.prepare(
    `UPDATE sites
     SET custom_domain = NULL,
         custom_domain_status = NULL,
         custom_domain_cf_id = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(site.id)
    .run();
}

function managedSiteDomainHttpStatus(
  status: number,
): 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503 {
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
    case 422:
    case 502:
    case 503:
      return status;
    default:
      return 502;
  }
}

function normalizeShortEmailText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeLongEmailText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.round(numberValue);
}

function confirmationHtml(
  title: string,
  body: string,
  status = 200,
  form?: { username: string; email: string; token: string },
): Response {
  const confirmationForm = form
    ? `<form method="post" action="/api/sites/${encodeURIComponent(form.username)}/subscribe/confirm"><input type="hidden" name="email" value="${escapeHtml(form.email)}"><input type="hidden" name="token" value="${escapeHtml(form.token)}"><button type="submit" style="font:inherit;padding:12px 18px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer;">Confirm subscription</button></form>`
    : "";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;padding:40px;text-align:center;"><main style="max-width:520px;margin:0 auto;"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${confirmationForm}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function sitePageErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof SitePageInputError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  throw error;
}

function buildSecurityTxt(requestUrl: string): string {
  const url = new URL(requestUrl);
  const canonical = new URL("/.well-known/security.txt", url);
  canonical.protocol = "https:";
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const contact = new URL("/account", canonical).toString();

  return [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${canonical.toString()}`,
    "",
  ].join("\n");
}
