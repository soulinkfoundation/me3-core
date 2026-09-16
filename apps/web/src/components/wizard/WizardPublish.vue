<script setup lang="ts">
import { ref, computed } from "vue";
import { useWizardStore } from "../../stores/wizard";
import { useAuthStore } from "../../stores/auth";
import { usePublish } from "../../composables/usePublish";
import { useRouter } from "vue-router";
import GeneratedSitePreview from "../GeneratedSitePreview.vue";
import UiIcon from "../UiIcon.vue";
import {
  vibes,
  selectableVibeIds,
  type VibeId,
} from "../../styles/vibes";

const wizard = useWizardStore();
const isOrganization = computed(() => wizard.siteRole === "organization");
const auth = useAuthStore();
const router = useRouter();
const {
  isPublishing,
  publishProgress,
  publishError,
  publishNeedsStorage,
  publish,
} = usePublish();

const isLoggedIn = computed(() => auth.isAuthenticated);
const canCustomizeFooter = computed(() => true);

// Footer customization modal
const showFooterModal = ref(false);

// Get preview colors for a vibe
function getVibePreviewColors(vibeId: VibeId) {
  const vibe = vibes[vibeId];
  return {
    bg: vibe.colors.bg,
    text: vibe.colors.text,
    accent: vibe.colors.accent,
    fontFamily: vibe.fontFamily,
  };
}

// Handle accent color change
function setAccentOverride(color: string) {
  wizard.setAccentOverride(color);
}

function resetAccentOverride() {
  wizard.setAccentOverride(null);
}

async function publishToMe3() {
  if (!isLoggedIn.value) {
    // Save state and redirect to login
    wizard.saveToStorage();
    router.push("/login?redirect=/create");
    return;
  }

  // Use the composable's publish function with celebration and site opening
  const success = await publish({ openSite: true });
  if (success) {
    const siteName =
      wizard.username?.trim() || wizard.profile.handle?.trim() || "";
    if (siteName) {
      router.push(`/sites/${encodeURIComponent(siteName)}`);
    } else {
      router.push("/calendar");
    }
  }
}

function openFooterModal() {
  showFooterModal.value = true;
}

function closeFooterModal() {
  showFooterModal.value = false;
}
</script>

<template>
  <div class="step-publish">
    <h2>{{ isOrganization ? "This site is ready!" : "Your site is ready!" }}</h2>
    <p class="step-desc">Choose a layout and vibe, then publish.</p>

    <fieldset class="layout-section">
      <legend>Layout</legend>
      <div class="layout-options">
        <label class="layout-option" :class="{ selected: wizard.profile.layout === 'classic' }">
          <input type="radio" name="site-layout" value="classic" :checked="wizard.profile.layout === 'classic'" @change="wizard.updateProfile({ layout: 'classic' })" />
          <span><strong>Classic</strong><small>Round photo and a compact introduction.</small></span>
        </label>
        <label class="layout-option" :class="{ selected: wizard.profile.layout === 'portrait' }">
          <input type="radio" name="site-layout" value="portrait" :checked="wizard.profile.layout === 'portrait'" @change="wizard.updateProfile({ layout: 'portrait' })" />
          <span><strong>Portrait</strong><small>A larger photo with soft corners. Uses your existing crop.</small></span>
        </label>
      </div>
    </fieldset>

    <!-- Vibe Selector -->
    <div class="vibe-section">
      <div class="vibe-grid">
        <div
          v-for="vibeId in selectableVibeIds"
          :key="vibeId"
          class="vibe-card"
          :class="{ selected: wizard.vibe === vibeId }"
        >
          <button class="vibe-card-btn" @click="wizard.setVibe(vibeId)">
            <div
              class="vibe-preview"
              :style="{
                background: getVibePreviewColors(vibeId).bg,
                color: getVibePreviewColors(vibeId).text,
                fontFamily: getVibePreviewColors(vibeId).fontFamily,
              }"
            >
              <div class="vibe-preview-name">Aa</div>
            </div>
            <div class="vibe-info">
              <span class="vibe-name">{{ vibes[vibeId].name }}</span>
              <span class="vibe-check" v-if="wizard.vibe === vibeId">
                <UiIcon name="Check" :size="16" />
              </span>
            </div>
          </button>
          <!-- Clickable accent dot with color picker -->
          <label
            class="vibe-preview-accent"
            :class="{ 'is-selected': wizard.vibe === vibeId }"
            :style="{
              background:
                wizard.accentOverride && wizard.vibe === vibeId
                  ? wizard.accentOverride
                  : getVibePreviewColors(vibeId).accent,
            }"
            :title="
              wizard.vibe === vibeId
                ? 'Click to customize accent color'
                : 'Select this vibe first'
            "
            @click.stop="wizard.vibe !== vibeId && wizard.setVibe(vibeId)"
          >
            <input
              v-if="wizard.vibe === vibeId"
              type="color"
              :value="
                wizard.accentOverride || getVibePreviewColors(vibeId).accent
              "
              @input="
                setAccentOverride(($event.target as HTMLInputElement).value)
              "
              @click.stop
              class="accent-color-input"
            />
          </label>
        </div>
      </div>

      <!-- Accent reset button (shown when overridden) -->
      <div v-if="wizard.accentOverride" class="accent-reset-row">
        <button class="reset-btn" @click="resetAccentOverride">
          Reset accent color
        </button>
      </div>
    </div>

    <!-- Preview -->
    <div class="publish-preview">
      <GeneratedSitePreview
        :editable-footer="canCustomizeFooter"
        @edit-footer="openFooterModal"
      />
    </div>

    <div class="publish-actions">
      <div class="publish-action">
        <button
          class="btn primary"
          :disabled="isPublishing"
          @click="publishToMe3"
        >
          {{
            isPublishing
              ? "Publishing..."
              : isLoggedIn
                ? "Publish now"
                : "Sign in to publish"
          }}
        </button>
        <p v-if="publishProgress" class="progress">
          {{ publishProgress }}
        </p>
        <p v-if="publishError" class="error">
          {{ publishError }}
          <router-link
            v-if="publishNeedsStorage"
            to="/account?section=storage"
          >
            Activate storage
          </router-link>
        </p>
      </div>

    </div>

    <!-- Footer Customization Modal -->
    <div
      v-if="showFooterModal"
      class="modal-overlay"
      @click.self="closeFooterModal"
    >
      <div class="modal">
        <div class="modal-header">
          <h3>Footer Settings</h3>
          <button class="modal-close" type="button" @click="closeFooterModal">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-content">
          <p class="modal-desc">
            Customize or remove the footer for this Core-published site.
          </p>

          <div class="footer-controls" :class="{ disabled: !canCustomizeFooter }">
            <label class="footer-option">
              <input
                type="radio"
                name="footerMode"
                value="default"
                :checked="wizard.profile.footer.mode === 'default'"
                :disabled="!canCustomizeFooter"
                @change="wizard.setFooter({ mode: 'default' })"
              />
              Keep "Powered by me3"
            </label>

            <label class="footer-option">
              <input
                type="radio"
                name="footerMode"
                value="custom"
                :checked="wizard.profile.footer.mode === 'custom'"
                :disabled="!canCustomizeFooter"
                @change="wizard.setFooter({ mode: 'custom' })"
              />
              Custom text / link
            </label>

            <div
              v-if="wizard.profile.footer.mode === 'custom'"
              class="footer-custom"
            >
              <label class="footer-field">
                <span>Text</span>
                <input
                  type="text"
                  :disabled="!canCustomizeFooter"
                  :value="wizard.profile.footer.text"
                  placeholder="e.g. Built by Jane"
                  @input="
                    wizard.setFooter({
                      text: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
              </label>

              <div class="footer-field-row">
                <label class="footer-field">
                  <span>Link text</span>
                  <input
                    type="text"
                    :disabled="!canCustomizeFooter"
                    :value="wizard.profile.footer.linkText"
                    placeholder="e.g. janedoe.com"
                    @input="
                      wizard.setFooter({
                        linkText: ($event.target as HTMLInputElement).value,
                      })
                    "
                  />
                </label>

                <label class="footer-field">
                  <span>Link URL</span>
                  <input
                    type="url"
                    :disabled="!canCustomizeFooter"
                    :value="wizard.profile.footer.linkUrl"
                    placeholder="https://janedoe.com"
                    @input="
                      wizard.setFooter({
                        linkUrl: ($event.target as HTMLInputElement).value,
                      })
                    "
                  />
                </label>
              </div>
            </div>

            <label class="footer-option">
              <input
                type="radio"
                name="footerMode"
                value="none"
                :checked="wizard.profile.footer.mode === 'none'"
                :disabled="!canCustomizeFooter"
                @change="wizard.setFooter({ mode: 'none' })"
              />
              No footer
            </label>
          </div>

        </div>

        <div class="modal-footer">
          <button class="btn secondary" type="button" @click="closeFooterModal">
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout-section { margin: 24px 0; padding: 0; border: 0; min-width: 0; }
.layout-section legend { font-weight: 600; margin-bottom: 12px; }
.layout-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.layout-option { display: flex; align-items: flex-start; gap: 10px; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); cursor: pointer; }
.layout-option.selected { border-color: var(--ui-accent); background: var(--ui-accent-soft); }
.layout-option:focus-within { outline: 2px solid var(--ui-focus, var(--ui-accent)); outline-offset: 3px; }
.layout-option input { flex: 0 0 auto; margin-top: 4px; accent-color: var(--ui-accent); }
.layout-option strong, .layout-option small { display: block; }
.layout-option small { margin-top: 4px; color: var(--ui-text-muted); line-height: 1.5; }
@media (max-width: 540px) { .layout-options { grid-template-columns: 1fr; } }

.step-publish {
  margin: 0 auto;
  max-width: 600px;
  width: 100%;
}

.step-publish h2 {
  font-size: 28px;
  margin-bottom: 8px;
  text-align: center;
}

/* Vibe Selector */
.vibe-section {
  margin-bottom: 32px;
}

.vibe-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 12px;
  text-align: center;
}

.vibe-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 600px) {
  .vibe-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* Footer */
.footer-section {
  margin: 28px 0 32px;
}

.footer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 6px;
  text-align: center;
}

.footer-desc {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
  margin-bottom: 12px;
}

.footer-controls {
  background: var(--color-border);
  border-radius: 12px;
  padding: 14px;
  display: grid;
  gap: 10px;
}

.footer-controls.disabled {
  opacity: 0.6;
}

.footer-option {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 14px;
}

.footer-custom {
  padding-left: 26px;
  display: grid;
  gap: 10px;
}

.footer-field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.footer-field input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 14px;
}

.footer-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.footer-upgrade {
  margin-top: 10px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.footer-upgrade .btn {
  margin-top: 10px;
}

@media (max-width: 500px) {
  .footer-field-row {
    grid-template-columns: 1fr;
  }
}

.vibe-card {
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  transition:
    border-color 0.2s,
    transform 0.2s;
  background: var(--color-bg);
  position: relative;
}

.vibe-card:hover {
  border-color: var(--color-text-muted);
}

.vibe-card.selected {
  border-color: var(--color-text);
}

.vibe-card-btn {
  display: flex;
  flex-direction: column;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.vibe-preview {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.vibe-preview-name {
  font-size: 24px;
  font-weight: 600;
}

.vibe-preview-accent {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  cursor: pointer;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.vibe-preview-accent:hover {
  transform: scale(1.2);
}

.vibe-preview-accent.is-selected {
  cursor: pointer;
  box-shadow:
    0 0 0 2px var(--color-bg),
    0 0 0 3px currentColor;
}

.vibe-preview-accent.is-selected:hover {
  transform: scale(1.3);
}

.accent-color-input {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.vibe-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.vibe-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.vibe-check {
  font-size: 14px;
  color: var(--color-text);
}

.accent-reset-row {
  margin-top: 12px;
  text-align: center;
}

/* Theme Mode Selector */
.theme-mode-section {
  margin-top: 20px;
  text-align: center;
}

.customize-subtitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 10px;
}

.theme-mode-buttons {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-border);
  border-radius: 10px;
}

.theme-mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.theme-mode-btn:hover {
  color: var(--color-text);
}

.theme-mode-btn.active {
  background: var(--color-bg);
  color: var(--color-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.reset-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-text-muted);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  border-color: var(--color-text);
  color: var(--color-text);
}

.step-desc {
  color: var(--color-text-muted);
  margin-bottom: 24px;
  text-align: center;
}

.publish-preview {
  max-width: 400px;
  margin: 0 auto 32px;
}

.publish-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
  margin: 0 auto;
}

.publish-action {
  width: 100%;
}

.btn {
  width: 100%;
  padding: 14px 20px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.btn.secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.progress {
  margin-top: 10px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.error {
  margin-top: 12px;
  color: #e53935;
  font-size: 13px;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal {
  background: var(--color-bg);
  border-radius: 16px;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h3 {
  font-size: 18px;
  font-weight: 600;
}

.modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-text-muted);
  transition:
    background 0.2s,
    color 0.2s;
}

.modal-close:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.modal-content {
  padding: 24px;
  overflow-y: auto;
}

.modal-desc {
  color: var(--color-text-muted);
  font-size: 14px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.modal-footer .btn {
  width: auto;
  padding: 10px 20px;
  font-size: 14px;
}
</style>
