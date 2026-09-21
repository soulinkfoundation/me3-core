<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useWizardStore } from "../../stores/wizard";
import { getUsernameAvailability, searchLocations, type LocationSearchResult } from "../../api";
import InlineRichTextEditor from "./BookingOfferDescriptionEditor.vue";

const wizard = useWizardStore();
const isOrganization = computed(() => wizard.siteRole === "organization");

const name = ref(wizard.profile.name);
const handle = ref(wizard.profile.handle || wizard.username);
const location = ref(wizard.profile.location);
const bio = ref(wizard.profile.bio);
const locationResults = ref<LocationSearchResult[]>([]);
const isSearchingLocations = ref(false);
const locationSearchError = ref("");
const showLocationResults = ref(false);
const activeLocationIndex = ref(-1);

// Debounced username check
let checkTimeout: ReturnType<typeof setTimeout> | null = null;
let locationSearchTimeout: ReturnType<typeof setTimeout> | null = null;
let locationSearchController: AbortController | null = null;

watch(name, (val) => {
  wizard.updateProfile({ name: val });
});

watch(bio, (val) => {
  wizard.updateProfile({ bio: val });
});

function clearLocationSearch() {
  if (locationSearchTimeout) {
    clearTimeout(locationSearchTimeout);
    locationSearchTimeout = null;
  }
  if (locationSearchController) {
    locationSearchController.abort();
    locationSearchController = null;
  }
}

function scheduleLocationSearch(query: string) {
  clearLocationSearch();
  const trimmed = query.trim();
  locationSearchError.value = "";
  activeLocationIndex.value = -1;

  if (trimmed.length < 2) {
    locationResults.value = [];
    isSearchingLocations.value = false;
    showLocationResults.value = false;
    return;
  }

  isSearchingLocations.value = true;
  showLocationResults.value = true;
  locationSearchTimeout = setTimeout(async () => {
    locationSearchController = new AbortController();
    try {
      locationResults.value = await searchLocations(trimmed, {
        signal: locationSearchController.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      locationResults.value = [];
      locationSearchError.value = "Location lookup is temporarily unavailable.";
    } finally {
      isSearchingLocations.value = false;
      locationSearchController = null;
    }
  }, 350);
}

function selectLocation(result: LocationSearchResult) {
  location.value = result.label;
  locationResults.value = [];
  showLocationResults.value = false;
  activeLocationIndex.value = -1;
  wizard.updateProfile({
    location: result.label,
    locationData: {
      label: result.label,
      latitude: result.latitude,
      longitude: result.longitude,
      precision: result.precision,
      locality: result.locality,
      region: result.region,
      country: result.country,
      countryCode: result.countryCode,
      source: result.source,
    },
  });
}

function handleLocationKeydown(event: KeyboardEvent) {
  if (!showLocationResults.value || locationResults.value.length === 0) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeLocationIndex.value =
      (activeLocationIndex.value + 1) % locationResults.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeLocationIndex.value =
      activeLocationIndex.value <= 0
        ? locationResults.value.length - 1
        : activeLocationIndex.value - 1;
  } else if (event.key === "Enter" && activeLocationIndex.value >= 0) {
    event.preventDefault();
    selectLocation(locationResults.value[activeLocationIndex.value]);
  } else if (event.key === "Escape") {
    showLocationResults.value = false;
    activeLocationIndex.value = -1;
  }
}

function handleLocationFocus() {
  if (wizard.profile.locationData?.label.trim() === location.value.trim()) {
    return;
  }
  scheduleLocationSearch(location.value);
}

function handleLocationBlur() {
  window.setTimeout(() => {
    showLocationResults.value = false;
    activeLocationIndex.value = -1;
  }, 120);
}

function updateProfileVisibility(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  wizard.updateProfile({ visibility: checked ? "public" : "private" });
}

watch(location, (val) => {
  const matchingLocation =
    wizard.profile.locationData?.label.trim() === val.trim()
      ? wizard.profile.locationData
      : null;
  wizard.updateProfile({ location: val, locationData: matchingLocation });
  if (matchingLocation) {
    clearLocationSearch();
    locationResults.value = [];
    showLocationResults.value = false;
  } else {
    scheduleLocationSearch(val);
  }
});

onBeforeUnmount(() => {
  clearLocationSearch();
});

watch(handle, async (val) => {
  const cleanHandle = val.toLowerCase().replace(/[^a-z0-9_-]/g, "");

  if (cleanHandle !== val) {
    handle.value = cleanHandle;
    return;
  }

  wizard.username = cleanHandle;
  wizard.updateProfile({ handle: cleanHandle });

  // Clear previous timeout
  if (checkTimeout) {
    clearTimeout(checkTimeout);
  }

  if (cleanHandle.length < 3) {
    wizard.isUsernameAvailable = null;
    return;
  }

  if (
    wizard.selectedSiteId &&
    cleanHandle === wizard.selectedSiteUsername.trim().toLowerCase()
  ) {
    wizard.isUsernameAvailable = true;
    wizard.isCheckingUsername = false;
    return;
  }

  // Debounce the check
  wizard.isCheckingUsername = true;
  checkTimeout = setTimeout(async () => {
    try {
      wizard.isUsernameAvailable = await getUsernameAvailability(cleanHandle);
    } catch {
      // If endpoint doesn't exist yet, assume available
      wizard.isUsernameAvailable = true;
    } finally {
      wizard.isCheckingUsername = false;
    }
  }, 500);
});

const bioLength = 320;
const bioTextLength = computed(() =>
  bio.value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, "\n")
    .replace(/<\/?(?:p|div)(?:\s[^>]*)?>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    ).length,
);
</script>

<template>
  <div class="step-basics">
    <h2>
      {{ isOrganization ? "Tell us about this site" : "Let's start with the basics" }}
    </h2>

    <div class="form-group">
      <label for="name">Name *</label>
      <input
        id="name"
        v-model="name"
        type="text"
        :placeholder="isOrganization ? 'e.g. North Star Studio' : 'e.g. Alex Smith'"
        maxlength="100"
        autofocus
      />
    </div>

    <div class="form-group">
      <label for="handle">
        {{ isOrganization ? "Site address" : "Username (@handle)" }} *
      </label>
      <div class="handle-input" :class="{ 'without-prefix': isOrganization }">
        <span v-if="!isOrganization" class="handle-prefix">@</span>
        <input
          id="handle"
          v-model="handle"
          type="text"
          :placeholder="isOrganization ? 'e.g. north-star-studio' : 'e.g. alex'"
          maxlength="30"
        />
      </div>
      <p v-if="isOrganization" class="handle-help">
        Used in this site's web address. You can connect a custom domain later.
      </p>
      <div class="handle-status">
        <span v-if="wizard.isCheckingUsername" class="checking">
          Checking availability...
        </span>
        <span
          v-else-if="handle.length >= 3 && wizard.isUsernameAvailable === true"
          class="available"
        >
          {{ isOrganization ? "This site address" : handle }} is available.
        </span>
        <span
          v-else-if="handle.length >= 3 && wizard.isUsernameAvailable === false"
          class="taken"
        >
          ✗ This {{ isOrganization ? "site address" : "username" }} is taken
        </span>
        <span v-else-if="handle.length > 0 && handle.length < 3" class="hint">
          {{ isOrganization ? "Site address" : "Username" }} must be at least 3
          characters
        </span>
      </div>
    </div>

    <div class="form-group">
      <label for="bio">
        {{ isOrganization ? "Short description" : "Short bio" }}
        <span class="optional">(optional)</span>
      </label>
      <InlineRichTextEditor
        v-model="bio"
        input-id="bio"
        :max-characters="bioLength"
        :placeholder="
          isOrganization
            ? 'A brief description of this business, project, or community...'
            : 'A brief description of who you are...'
        "
      />
      <div class="char-count">{{ bioTextLength }}/{{ bioLength }}</div>
    </div>

    <fieldset v-if="wizard.siteRole === 'profile'" class="form-group visibility-group">
      <legend>Profile visibility</legend>
      <label class="visibility-checkbox">
        <input
          type="checkbox"
          :checked="wizard.profile.visibility === 'public'"
          @change="updateProfileVisibility"
        />
        <span>Make my profile public</span>
      </label>
    </fieldset>

    <div class="form-group">
      <label for="location">
        Location
        <span class="optional">(optional)</span>
      </label>
      <div class="location-combobox" @focusout="handleLocationBlur">
        <input
          id="location"
          v-model="location"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="location-results"
          :aria-expanded="showLocationResults"
          :aria-activedescendant="
            activeLocationIndex >= 0
              ? `location-option-${activeLocationIndex}`
              : undefined
          "
          placeholder="Search town or city"
          maxlength="100"
          autocomplete="off"
          @focus="handleLocationFocus"
          @keydown="handleLocationKeydown"
        />
        <div
          v-if="showLocationResults"
          id="location-results"
          class="location-results"
          role="listbox"
        >
          <div v-if="isSearchingLocations" class="location-state">
            Searching...
          </div>
          <div v-else-if="locationSearchError" class="location-state">
            {{ locationSearchError }}
          </div>
          <template v-else-if="locationResults.length > 0">
            <button
              v-for="(result, index) in locationResults"
              :id="`location-option-${index}`"
              :key="result.id"
              type="button"
              class="location-option"
              :class="{ 'is-active': activeLocationIndex === index }"
              role="option"
              :aria-selected="activeLocationIndex === index"
              @mousedown.prevent
              @mouseenter="activeLocationIndex = index"
              @click="selectLocation(result)"
            >
              <span>{{ result.label }}</span>
              <small v-if="result.precision !== 'unknown'">
                {{ result.precision }}
              </small>
            </button>
          </template>
          <div v-else-if="location.trim().length >= 2" class="location-state">
            No matching towns or cities found.
          </div>
        </div>
      </div>
      <p v-if="wizard.profile.locationData" class="location-confirmed">
        Saved as {{ wizard.profile.locationData.label }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.step-basics h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.form-group {
  margin-bottom: 24px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.visibility-group {
  min-width: 0;
  padding: 0;
  border: 0;
}

.visibility-group legend {
  margin-bottom: 8px;
  padding: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  font-weight: 600;
}

.visibility-group .visibility-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 0;
  color: var(--ui-text, var(--color-text));
  cursor: pointer;
}

.visibility-group .visibility-checkbox input {
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  accent-color: var(--ui-text, var(--color-text));
}

.optional {
  font-weight: 400;
  color: var(--color-text-muted);
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 14px 16px;
  font-size: 16px;
  border: 2px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-text);
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

.handle-input {
  display: flex;
  align-items: center;
  border: 2px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.handle-input:focus-within {
  border-color: var(--color-text);
}

.handle-prefix {
  padding: 14px 0 14px 16px;
  color: var(--color-text-muted);
  font-size: 16px;
  background: var(--color-bg);
}

.handle-input input {
  border: none;
  padding-left: 4px;
}

.handle-input input:focus {
  border: none;
}

.handle-input.without-prefix input {
  padding-left: 16px;
}

.handle-help {
  margin: 8px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.4;
}

.handle-status {
  margin-top: 8px;
  font-size: 13px;
  min-height: 20px;
}

.location-combobox {
  position: relative;
}

.location-results {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, var(--shadow-soft));
}

.location-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
  background: transparent;
  color: var(--ui-text, var(--color-text));
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.location-option:last-child {
  border-bottom: 0;
}

.location-option:hover,
.location-option.is-active {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.location-option small {
  flex: 0 0 auto;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  text-transform: capitalize;
}

.location-state {
  padding: 12px 14px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 14px;
}

.location-confirmed {
  margin-top: 8px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
}

.checking {
  color: var(--color-text-muted);
}

.available {
  color: #4caf50;
}

.taken {
  color: #e53935;
}

.hint {
  color: var(--color-text-muted);
}

.char-count {
  text-align: right;
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
}
</style>
