<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  resolveWizardSiteAssetUrl,
  useWizardStore,
  type WizardNewsletterWelcomeEmail,
} from "../../stores/wizard";
import { useSitesStore } from "../../stores/sites";
import { useAuthStore } from "../../stores/auth";
import { useAppToast } from "../../composables/useAppToast";
import { compressImage, resizeImage } from "../../utils/imageCompression";
import NewsletterSubscribers from "../NewsletterSubscribers.vue";
import UiIcon from "../UiIcon.vue";

const wizard = useWizardStore();
const sites = useSitesStore();
const auth = useAuthStore();
const { toastError, toastSuccess, toastFromUnknown } = useAppToast();

// Newsletter Config
const newsletterTitle = computed({
  get: () => wizard.profile.newsletter.title,
  set: (val: string) => wizard.setNewsletter({ title: val }),
});

const newsletterDescription = computed({
  get: () => wizard.profile.newsletter.description,
  set: (val: string) => wizard.setNewsletter({ description: val }),
});

const newsletterDoubleOptIn = computed({
  get: () => wizard.profile.newsletter.doubleOptIn,
  set: (val: boolean) => wizard.setNewsletter({ doubleOptIn: val }),
});

const newsletterButtonLabel = computed({
  get: () => wizard.profile.newsletter.buttonLabel,
  set: (val: string) => wizard.setNewsletter({ buttonLabel: val }),
});

const newsletterPlaceholder = computed({
  get: () => wizard.profile.newsletter.placeholder,
  set: (val: string) => wizard.setNewsletter({ placeholder: val }),
});

const username = computed(() => wizard.username.trim());

// Signup box image
const imageInput = ref<HTMLInputElement | null>(null);
const localImageUrl = ref("");
const isUploadingImage = ref(false);
const imagePreviewUrl = computed(
  () =>
    localImageUrl.value ||
    resolveWizardSiteAssetUrl(wizard.profile.newsletter.image, username.value) ||
    "",
);

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!username.value) {
    toastError("Claim your username before adding an image.");
    return;
  }
  isUploadingImage.value = true;
  try {
    const resized = await resizeImage(file, 800);
    const compressed = await compressImage(resized.blob, 1024 * 1024);
    const result = await sites.uploadImage(username.value, compressed.blob, "newsletter");
    if (!result?.ok) throw new Error(sites.error || "Failed to upload image");
    if (localImageUrl.value) URL.revokeObjectURL(localImageUrl.value);
    localImageUrl.value = URL.createObjectURL(compressed.blob);
    wizard.setNewsletter({ image: `./${result.path}` });
  } catch (error) {
    toastFromUnknown(error, "Failed to upload image");
  } finally {
    isUploadingImage.value = false;
  }
}

function removeImage() {
  if (localImageUrl.value) URL.revokeObjectURL(localImageUrl.value);
  localImageUrl.value = "";
  wizard.setNewsletter({ image: "" });
}

// Welcome email
const welcomeEmail = computed(() => wizard.profile.newsletter.welcomeEmail);

function setWelcomeEmail(updates: Partial<WizardNewsletterWelcomeEmail>) {
  wizard.setNewsletter({
    welcomeEmail: { ...welcomeEmail.value, ...updates },
  });
}

const welcomeEnabled = computed({
  get: () => welcomeEmail.value.enabled,
  set: (enabled: boolean) => setWelcomeEmail({ enabled }),
});
const welcomeSubject = computed({
  get: () => welcomeEmail.value.subject,
  set: (subject: string) => setWelcomeEmail({ subject }),
});
const welcomeMessage = computed({
  get: () => welcomeEmail.value.message,
  set: (message: string) => setWelcomeEmail({ message }),
});
const downloadName = computed({
  get: () => welcomeEmail.value.downloadName,
  set: (downloadName: string) => setWelcomeEmail({ downloadName }),
});
const welcomeIncomplete = computed(
  () =>
    welcomeEnabled.value &&
    (!welcomeSubject.value.trim() || !welcomeMessage.value.trim()),
);
const downloadFilename = computed(
  () => welcomeEmail.value.downloadPath.split("/").pop() || "",
);

const downloadInput = ref<HTMLInputElement | null>(null);
const isUploadingDownload = ref(false);

async function onDownloadSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!username.value) {
    toastError("Claim your username before adding a download.");
    return;
  }
  isUploadingDownload.value = true;
  try {
    const result = await sites.uploadNewsletterDownload(username.value, file);
    setWelcomeEmail({
      downloadPath: `./${result.path}`,
      downloadName:
        welcomeEmail.value.downloadName ||
        file.name.replace(/\.pdf$/i, "").trim(),
    });
  } catch (error) {
    toastFromUnknown(error, "Failed to upload PDF");
  } finally {
    isUploadingDownload.value = false;
  }
}

function removeDownload() {
  setWelcomeEmail({ downloadPath: "", downloadName: "" });
}

const testRecipient = ref(auth.user?.email?.trim() || "");
const isSendingTest = ref(false);
const testRecipientIsValid = computed(() =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient.value.trim()),
);
const canSendTest = computed(
  () =>
    Boolean(username.value) &&
    testRecipientIsValid.value &&
    Boolean(welcomeSubject.value.trim()) &&
    Boolean(welcomeMessage.value.trim()),
);

async function sendWelcomeTest() {
  if (isSendingTest.value || !canSendTest.value) return;
  isSendingTest.value = true;
  try {
    const response = await sites.sendNewsletterWelcomeTest(username.value, {
      to: testRecipient.value.trim().toLowerCase(),
      siteName: wizard.profile.name || username.value,
      newsletterTitle: newsletterTitle.value,
      subject: welcomeSubject.value,
      message: welcomeMessage.value,
      downloadPath: welcomeEmail.value.downloadPath,
      downloadName: welcomeEmail.value.downloadName,
    });
    toastSuccess(`Test email sent to ${response.sentTo}.`);
  } catch (error) {
    toastFromUnknown(error, "Failed to send test email");
  } finally {
    isSendingTest.value = false;
  }
}

onMounted(() => {
  wizard.setNewsletter({ enabled: true });
});
</script>

<template>
  <div class="step-newsletter">
    <h2>Newsletter</h2>
    <p class="section-desc">
      Allow visitors to subscribe to your newsletter. Send emails from your blog
      posts.
    </p>

    <div class="config-fields">
      <div class="form-group">
        <label>
          Newsletter title
          <span class="optional">(optional)</span>
        </label>
        <input
          v-model="newsletterTitle"
          type="text"
          placeholder="e.g., Weekly Insights"
          maxlength="100"
        />
        <p class="field-hint">
          Helps visitors know what they're signing up for
        </p>
      </div>

      <div class="form-group">
        <label>
          Description
          <span class="optional">(optional)</span>
        </label>
        <textarea
          v-model="newsletterDescription"
          placeholder="e.g., Curated thoughts on design and tech, delivered every Sunday"
          maxlength="300"
          rows="2"
        ></textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="newsletter-button-label">
            Button text
            <span class="optional">(optional)</span>
          </label>
          <input
            id="newsletter-button-label"
            v-model="newsletterButtonLabel"
            type="text"
            placeholder="Subscribe"
            maxlength="40"
          />
        </div>
        <div class="form-group">
          <label for="newsletter-placeholder">
            Email field hint
            <span class="optional">(optional)</span>
          </label>
          <input
            id="newsletter-placeholder"
            v-model="newsletterPlaceholder"
            type="text"
            placeholder="Enter your email"
            maxlength="60"
          />
        </div>
      </div>

      <div class="form-group">
        <label>
          Image
          <span class="optional">(optional)</span>
        </label>
        <div class="image-field">
          <img
            v-if="imagePreviewUrl"
            :src="imagePreviewUrl"
            alt=""
            class="image-thumb"
          />
          <button
            type="button"
            class="secondary-button"
            :disabled="isUploadingImage"
            @click="imageInput?.click()"
          >
            <UiIcon name="Image" :size="16" aria-hidden="true" />
            {{ isUploadingImage ? "Uploading..." : imagePreviewUrl ? "Replace" : "Add image" }}
          </button>
          <button
            v-if="imagePreviewUrl"
            type="button"
            class="text-action"
            @click="removeImage"
          >
            Remove
          </button>
          <input
            ref="imageInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            @change="onImageSelected"
          />
        </div>
        <p class="field-hint">
          Shown beside the form, such as the cover of a free guide.
        </p>
      </div>

      <label class="confirmation-option">
        <input v-model="newsletterDoubleOptIn" type="checkbox" />
        <span>
          <span class="confirmation-label">
            Require email confirmation
            <span class="recommended">(recommended)</span>
          </span>
          <span class="field-hint">
            Subscribers join your list after confirming through an email from
            your configured sender.
          </span>
        </span>
      </label>
    </div>

    <details class="config-fields welcome-email" :open="welcomeEnabled">
      <summary>
        <UiIcon name="Mail" :size="18" aria-hidden="true" />
        Welcome email
      </summary>

      <label class="confirmation-option">
        <input v-model="welcomeEnabled" type="checkbox" />
        <span>
          <span class="confirmation-label">Email new subscribers</span>
          <span class="field-hint">
            Sent once each person joins{{
              newsletterDoubleOptIn ? ", after they confirm" : ""
            }}. Replies come to you.
          </span>
        </span>
      </label>

      <template v-if="welcomeEnabled">
        <div class="form-group">
          <label for="welcome-subject">Subject</label>
          <input
            id="welcome-subject"
            v-model="welcomeSubject"
            type="text"
            maxlength="200"
            placeholder="e.g., Here's your free guide"
          />
        </div>

        <div class="form-group">
          <label for="welcome-message">Message</label>
          <textarea
            id="welcome-message"
            v-model="welcomeMessage"
            rows="6"
            maxlength="8000"
            placeholder="Say hello, tell them what to expect, and point them to the download."
          ></textarea>
          <p class="field-hint" v-pre>
            Placeholders: <code>{{ newsletterName }}</code>,
            <code>{{ siteName }}</code>, <code>{{ email }}</code>
          </p>
        </div>

        <div class="form-group">
          <label>
            Free download
            <span class="optional">(optional PDF)</span>
          </label>
          <div class="image-field">
            <span v-if="downloadFilename" class="download-file">
              <UiIcon name="FileText" :size="16" aria-hidden="true" />
              {{ downloadFilename }}
            </span>
            <button
              type="button"
              class="secondary-button"
              :disabled="isUploadingDownload"
              @click="downloadInput?.click()"
            >
              <UiIcon name="Upload" :size="16" aria-hidden="true" />
              {{ isUploadingDownload ? "Uploading..." : downloadFilename ? "Replace" : "Upload PDF" }}
            </button>
            <button
              v-if="downloadFilename"
              type="button"
              class="text-action"
              @click="removeDownload"
            >
              Remove
            </button>
            <input
              ref="downloadInput"
              type="file"
              accept="application/pdf,.pdf"
              hidden
              @change="onDownloadSelected"
            />
          </div>
          <p class="field-hint">
            Linked from the email and the confirmation page. Anyone with the
            link can open it.
          </p>
        </div>

        <div v-if="downloadFilename" class="form-group">
          <label for="welcome-download-name">Download name</label>
          <input
            id="welcome-download-name"
            v-model="downloadName"
            type="text"
            maxlength="120"
            placeholder="e.g., A Guide to Reclaiming Sovereignty"
          />
        </div>

        <p v-if="welcomeIncomplete" class="field-warning" role="status">
          Add a subject and message, or nothing is sent.
        </p>

        <div class="test-row">
          <div class="form-group">
            <label for="welcome-test-recipient">Send a test to</label>
            <input
              id="welcome-test-recipient"
              v-model="testRecipient"
              type="email"
              inputmode="email"
              autocomplete="email"
              maxlength="254"
              placeholder="name@example.com"
              @keyup.enter="sendWelcomeTest"
            />
          </div>
          <button
            type="button"
            class="secondary-button"
            :disabled="isSendingTest || !canSendTest"
            @click="sendWelcomeTest"
          >
            <UiIcon name="Mail" :size="16" aria-hidden="true" />
            {{ isSendingTest ? "Sending..." : "Send test" }}
          </button>
        </div>
        <p v-if="!username" class="field-hint">
          Claim your username to upload files and send a test.
        </p>
      </template>
    </details>

    <div class="config-fields" v-if="wizard.username">
      <div class="form-group">
        <NewsletterSubscribers :username="wizard.username" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-newsletter h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.section-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 24px;
}

/* Config Fields */
.config-fields {
  padding: 20px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.form-group input[type="text"],
.form-group textarea {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-text);
}

.field-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.optional {
  font-weight: 400;
  color: var(--color-text-muted);
}

.confirmation-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.confirmation-option input {
  margin-top: 3px;
  accent-color: var(--ui-accent, var(--color-text));
}

.confirmation-option input:focus-visible {
  outline: 2px solid var(--ui-focus, var(--color-text));
  outline-offset: 2px;
}

.confirmation-label {
  display: block;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 500;
}

.recommended {
  color: var(--color-text-muted);
  font-weight: 400;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.image-field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.image-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--ui-radius-sm, 8px);
  border: 1px solid var(--color-border);
}

.download-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--color-text);
  word-break: break-all;
}

.secondary-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--ui-border-strong, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button:focus-visible,
.text-action:focus-visible {
  outline: 2px solid var(--ui-focus, var(--color-text));
  outline-offset: 2px;
}

.text-action {
  border: 0;
  background: none;
  padding: 4px;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}

.welcome-email .confirmation-option {
  margin-bottom: 16px;
}

.welcome-email summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.welcome-email[open] summary {
  margin-bottom: 16px;
}

.welcome-email code {
  font-size: 12px;
}

.field-warning {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--ui-danger, #b42318);
}

.test-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.test-row .form-group {
  margin-bottom: 0;
}

.form-group input[type="email"] {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

@media (max-width: 520px) {
  .form-row,
  .test-row {
    grid-template-columns: 1fr;
  }
}
</style>
