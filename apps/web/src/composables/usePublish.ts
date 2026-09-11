import { productDeliveryError } from "../../../../shared/product-delivery";
import { computed, ref } from "vue";
import { useWizardStore } from "../stores/wizard";
import { productSendsPurchaseConfirmation } from "../../../../shared/product-purchase-confirmation";
import { useSitesStore, type PublishManifest } from "../stores/sites";
import { useAuthStore } from "../stores/auth";
import { api } from "../api";
import { resolvePublicSiteUrl } from "../utils/publicSiteUrl";
import {
  exportSiteContentToMarkdown,
  type ExportedSiteContentAsset,
} from "../utils/siteContentAssets";

function createEmptyPublishManifest(): PublishManifest {
  return {
    version: 1,
    sourceFiles: {},
    assetFiles: {},
    updatedAt: "",
  };
}

async function sha256Blob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getImageExt(blob: Blob): string {
  return blob.type === "image/png"
    ? "png"
    : blob.type === "image/webp"
      ? "webp"
      : blob.type === "image/gif"
        ? "gif"
        : "jpg";
}

function validateShopConfirmationEmails(
  wizard: ReturnType<typeof useWizardStore>,
): string | null {
  if (!wizard.shopEnabled) return null;
  for (const p of wizard.products) {
    const deliveryError = productDeliveryError(p.delivery);
    if (p.available && deliveryError) return `Offerings — "${p.title}": ${deliveryError}`;
    const ce = p.confirmationEmail;
    if (ce?.enabled === true && !productSendsPurchaseConfirmation(ce)) {
      return `Offerings — "${p.title}": add both a subject and message for the purchase confirmation email, or turn the option off.`;
    }
  }
  return null;
}

function validateManualPaymentInstructions(
  wizard: ReturnType<typeof useWizardStore>,
): string | null {
  const product = wizard.shopEnabled
    ? wizard.products.find(
        (candidate) =>
          candidate.available &&
          candidate.price > 0 &&
          candidate.paymentMethod === "manual" &&
          !candidate.paymentInstructions.trim(),
      )
    : undefined;
  if (product) {
    return `Offerings — "${product.title}": add payment instructions for pay separately.`;
  }

  const bookingOffers = wizard.bookingsEnabled
    ? [
        ...wizard.profile.booking.offers,
        ...wizard.profile.booking.classOffers,
        ...wizard.profile.booking.retreatOffers,
      ]
    : [];
  const booking = bookingOffers.find(
    (candidate) =>
      candidate.pricing?.enabled &&
      candidate.pricing.paymentMethod === "manual" &&
      !candidate.pricing.paymentInstructions.trim(),
  );
  if (booking) {
    return `Bookings — "${booking.title}": add payment instructions for pay separately.`;
  }
  return null;
}

export function usePublish() {
  const wizard = useWizardStore();
  const sites = useSitesStore();
  const auth = useAuthStore();

  const isPublishing = ref(false);
  const publishProgress = ref<string | null>(null);
  const publishError = ref<string | null>(null);
  const publishNeedsStorage = computed(() =>
    /activate storage/i.test(publishError.value || ""),
  );

  function triggerCelebration() {
    const emojis = ["🎉", "🎊", "✨", "🌟", "💫", "🎈"];
    const container = document.createElement("div");
    container.className = "celebration-container";
    document.body.appendChild(container);

    // Create 50 emoji elements
    for (let i = 0; i < 50; i++) {
      const emoji = document.createElement("div");
      emoji.className = "celebration-emoji";
      emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];

      // Random starting position near center
      const startX = window.innerWidth / 2 + (Math.random() - 0.5) * 100;
      const startY = window.innerHeight / 2;

      // Random end position
      const endX = Math.random() * window.innerWidth;
      const endY = Math.random() * window.innerHeight;

      // Random animation duration and delay
      const duration = 1.5 + Math.random() * 1;
      const delay = Math.random() * 0.3;

      emoji.style.left = `${startX}px`;
      emoji.style.top = `${startY}px`;
      emoji.style.setProperty("--end-x", `${endX - startX}px`);
      emoji.style.setProperty("--end-y", `${endY - startY}px`);
      emoji.style.animationDuration = `${duration}s`;
      emoji.style.animationDelay = `${delay}s`;

      container.appendChild(emoji);
    }

    // Remove container after animation completes
    setTimeout(() => {
      container.remove();
    }, 3000);
  }

  async function publish(
    options: { celebrate?: boolean; openSite?: boolean } = {},
  ): Promise<boolean> {
    const { celebrate = true, openSite = false } = options;

    isPublishing.value = true;
    publishError.value = null;
    publishProgress.value = null;

    try {
      const username = wizard.username;

      const shopConfirmationError = validateShopConfirmationEmails(wizard);
      if (shopConfirmationError) {
        throw new Error(shopConfirmationError);
      }
      const manualPaymentError = validateManualPaymentInstructions(wizard);
      if (manualPaymentError) {
        throw new Error(manualPaymentError);
      }

      // First, check if site exists or needs to be claimed
      await sites.fetchSites();
      const selectedSite = wizard.selectedSiteId
        ? sites.sites.find((site) => site.id === wizard.selectedSiteId)
        : undefined;
      const existingSite = sites.sites.find((site) => site.username === username);

      if (wizard.selectedSiteId && !selectedSite) {
        throw new Error("The selected site is no longer available. Reopen it and try again.");
      }
      if (selectedSite?.site_role && selectedSite.site_role !== wizard.siteRole) {
        throw new Error("The selected site's role changed. Reopen the site and try again.");
      }

      if (selectedSite && selectedSite.username !== username) {
        publishProgress.value = "Renaming site...";
        const renamed = await sites.claimUsername(username, {
          siteType: "profile",
          siteRole: wizard.siteRole,
          renameFromSiteId: selectedSite.id,
        });
        if (!renamed) {
          throw new Error(sites.error || "Failed to rename site");
        }
        wizard.bindDraftToSite(renamed.id);
      } else if (!existingSite) {
        publishProgress.value = "Claiming username...";
        const existingProfileSite = sites.sites.find(
          (site) => site.site_role === "profile",
        );
        const claimed = await sites.claimUsername(username, {
          siteType: "profile",
          siteRole: wizard.siteRole,
          ...(wizard.siteRole === "profile" &&
          existingProfileSite &&
          existingProfileSite.username !== username
            ? { renameFromUsername: existingProfileSite.username }
            : {}),
        });
        if (!claimed) {
          throw new Error(sites.error || "Failed to claim username");
        }
        wizard.bindDraftToSite(claimed.id);
      }

      const publishManifest =
        (await sites.fetchPublishManifest(username)) || createEmptyPublishManifest();

      if (wizard.profile.logoBlob) {
        const logoFilename = `logo.${getImageExt(wizard.profile.logoBlob)}`;
        const logoHash = await sha256Blob(wizard.profile.logoBlob);
        if (publishManifest.assetFiles[`files/${logoFilename}`] !== logoHash) {
          publishProgress.value = "Uploading site logo...";
          const result = await sites.uploadImage(
            username,
            wizard.profile.logoBlob,
            "logo",
          );
          if (!result?.ok) {
            throw new Error(sites.error || "Failed to upload site logo");
          }
        }
      }

      if (wizard.profile.avatarBlob) {
        const avatarFilename = `avatar.${getImageExt(wizard.profile.avatarBlob)}`;
        const avatarHash = await sha256Blob(wizard.profile.avatarBlob);
        if (publishManifest.assetFiles[avatarFilename] !== avatarHash) {
          publishProgress.value = "Uploading avatar...";
          await sites.uploadImage(username, wizard.profile.avatarBlob, "avatar");
        }
      }

      // Upload banner if exists
      if (wizard.profile.bannerBlob) {
        const bannerFilename = `banner.${getImageExt(wizard.profile.bannerBlob)}`;
        const bannerHash = await sha256Blob(wizard.profile.bannerBlob);
        if (publishManifest.assetFiles[bannerFilename] !== bannerHash) {
          publishProgress.value = "Uploading banner...";
          await sites.uploadImage(username, wizard.profile.bannerBlob, "banner");
        }
      }

      const publishableT = wizard.testimonialsEnabled
        ? wizard.publishableTestimonials()
        : [];
      for (let i = 0; i < publishableT.length; i++) {
        const t = publishableT[i];
        if (!t.avatarBlob) continue;
        const slot = i + 1;
        const ext = getImageExt(t.avatarBlob);
        const filename = `testimonial-${slot}.${ext}`;
        const hash = await sha256Blob(t.avatarBlob);
        if (publishManifest.assetFiles[filename] !== hash) {
          publishProgress.value = `Uploading testimonial photo ${slot}/${publishableT.length}…`;
          const result = await sites.uploadImage(
            username,
            t.avatarBlob,
            "testimonial",
            { testimonialIndex: slot },
          );
          if (!result?.ok) {
            throw new Error(sites.error || "Failed to upload testimonial image");
          }
        }
      }

      // Convert pages/posts/products to markdown and gather referenced images
      const exportedPages = wizard.pagesEnabled
        ? wizard.pages.map((p) => ({
            page: p,
            exported: exportSiteContentToMarkdown(
              p.content,
              p.images || [],
              "./",
            ),
          }))
        : [];

      const exportedPosts = wizard.blogEnabled
        ? wizard.posts
            .map((p) => ({
            post: p,
            exported: exportSiteContentToMarkdown(
              p.content,
              p.images || [],
              "../",
            ),
            }))
        : [];

      const exportedProducts = wizard.shopEnabled
        ? wizard.products.map((p) => ({
            product: p,
            exported: exportSiteContentToMarkdown(
              p.content,
              p.images || [],
              "../",
            ),
          }))
        : [];

      const localContentAssets = new Map(
        [
          ...exportedPages.flatMap((entry) => entry.exported.assets),
          ...exportedPosts.flatMap((entry) => entry.exported.assets),
          ...exportedProducts.flatMap((entry) => entry.exported.assets),
        ]
          .filter(
            (asset): asset is typeof asset & { blob: Blob } =>
              asset.blob instanceof Blob,
          )
          .map((asset) => [asset.relativePath, asset]),
      );

      const changedContentAssets: Array<
        ExportedSiteContentAsset & { blob: Blob }
      > = [];
      for (const asset of localContentAssets.values()) {
        const hash = await sha256Blob(asset.blob);
        if (publishManifest.assetFiles[asset.relativePath] !== hash) {
          changedContentAssets.push(asset);
        }
      }

      if (changedContentAssets.length > 0) {
        let done = 0;
        for (const asset of changedContentAssets) {
          done += 1;
          publishProgress.value = `Uploading content: ${done}/${changedContentAssets.length}`;

          const result = await sites.uploadContentAsset(
            username,
            asset.blob,
            {
              assetId: asset.id,
              kind: asset.kind,
              filename: asset.relativePath.split("/").pop() || asset.id,
            },
          );

          if (!result?.ok) {
            throw new Error(sites.error || "Failed to upload content asset");
          }
        }
      }

      // Upload video posts to Cloudflare Stream (if any)
      const videoPosts = wizard.blogEnabled
        ? wizard.posts
            .map((post, index) => ({ post, index }))
            .filter(({ post }) => post.type === "video" && post.mediaFile)
        : [];

      if (videoPosts.length > 0) {
        let done = 0;
        for (const { post, index } of videoPosts) {
          done += 1;
          publishProgress.value = `Uploading videos: ${done}/${videoPosts.length}`;

          const upload = await sites.createStreamUpload(username, 3600);
          if (!upload?.uploadURL || !upload.uid) {
            throw new Error("Failed to create Stream upload");
          }

          const formData = new FormData();
          const fileName = post.mediaFile?.name || `${post.slug}.mp4`;
          formData.append("file", post.mediaFile as File, fileName);

          const uploadResponse = await fetch(upload.uploadURL, {
            method: "POST",
            body: formData,
          });

          if (!uploadResponse.ok) {
            throw new Error("Failed to upload video to Stream");
          }

          const details = await sites.finalizeStreamUpload(username, upload.uid);

          wizard.updatePost(index, {
            media: {
              url: details?.playerUrl ?? undefined,
              thumbnail: details?.thumbnail ?? undefined,
              duration: details?.duration ?? undefined,
              provider: "stream",
              id: upload.uid,
            },
            mediaFile: null,
          });
        }
      }

      // Generate me.json and create File objects for upload
      publishProgress.value = "Uploading files...";
      const me3Json = wizard.generateMe3Json();
      if (me3Json.links && "_avatar_variants" in me3Json.links) {
        me3Json.links = {
          ...(me3Json.links || {}),
          _avatar_variants: undefined,
        };
        delete me3Json.links._avatar_variants;
        if (Object.keys(me3Json.links).length === 0) delete me3Json.links;
      }
      const me3File = new File([JSON.stringify(me3Json, null, 2)], "me.json", {
        type: "application/json",
      });

      const files: File[] = [me3File];

      // Add pages (convert HTML to Markdown)
      for (const { page, exported } of exportedPages) {
        const markdown = exported.markdown;
        files.push(
          new File([markdown], `${page.slug}.md`, { type: "text/markdown" }),
        );
      }

      // Add blog posts (convert HTML to Markdown)
      for (const { post, exported } of exportedPosts) {
        const markdown = exported.markdown;
        files.push(
          new File([markdown], `blog/${post.slug}.md`, {
            type: "text/markdown",
          }),
        );
      }

      // Add products (convert HTML to Markdown)
      for (const { product, exported } of exportedProducts) {
        const markdown = exported.markdown;
        files.push(
          new File([markdown], `shop/${product.slug}.md`, {
            type: "text/markdown",
          }),
        );
      }

      const changedFiles: File[] = [];
      for (const file of files) {
        const content = await file.text();
        const hash = await sha256Text(content);
        if (publishManifest.sourceFiles[file.name] !== hash) {
          changedFiles.push(
            new File([content], file.name, {
              type: file.type || "text/plain",
            }),
          );
        }
      }

      if (changedFiles.length > 0) {
        const success = await sites.uploadSite(username, changedFiles);

        if (!success) {
          throw new Error(sites.error || "Failed to upload site");
        }
      }

      // Mark as published in wizard store
      wizard.markAsPublished();

      if (auth.sessionOnboardingStartStep) {
        try {
          await api.post<{ ok: boolean }>("/onboarding/complete", {});
          auth.setSessionOnboardingStartStep(null);
        } catch (error) {
          console.warn("Profile published, but onboarding completion did not sync", error);
        }
      }

      const isPublicProfile =
        wizard.siteRole !== "profile" || wizard.profile.visibility === "public";

      // Trigger celebration animation if enabled
      if (celebrate) {
        triggerCelebration();
      }

      // Open the published site in a new tab if enabled
      if (openSite && isPublicProfile) {
        const siteUrl = await resolvePublicSiteUrl(username, {
          site_role: wizard.siteRole,
        });
        setTimeout(() => {
          window.open(siteUrl, "_blank");
        }, 900);
      }

      return true;
    } catch (error: any) {
      publishError.value = error.message || "Failed to publish";
      return false;
    } finally {
      isPublishing.value = false;
      publishProgress.value = null;
    }
  }

  return {
    isPublishing,
    publishProgress,
    publishError,
    publishNeedsStorage,
    publish,
    triggerCelebration,
  };
}
