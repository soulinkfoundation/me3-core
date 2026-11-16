<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useSocialStore, type SocialMediaAsset, type TikTokCreatorInfo } from "../../stores/social";
import {
  TIKTOK_BRANDED_POLICY_URL,
  TIKTOK_MUSIC_TERMS_URL,
  fitTikTokChoices,
  tiktokChoicesProblem,
  tiktokDeclaration,
  tiktokDisclosureLabel,
  tiktokPrivacyDisabled,
  tiktokPrivacyLabel,
  type TikTokPostChoices,
} from "../../utils/tiktok-post";
import { TIKTOK_OPEN_TO_ALL } from "../../utils/social-posts";

/**
 * TikTok's required post settings (Content Sharing Guidelines): the account it goes to, who can see it
 * with nothing preselected, interactions off until ticked, commercial disclosure and the consent line.
 * Loaded fresh each time the screen opens; nothing is remembered between posts.
 */
const props = defineProps<{
  accountId: string | null;
  video: SocialMediaAsset | null;
  choices: TikTokPostChoices;
  locked?: boolean;
}>();
const emit = defineEmits<{
  "update:choices": [TikTokPostChoices];
  /** The creator settings and video length, or a reason TikTok can't post yet. */
  state: [{ creator: TikTokCreatorInfo | null; durationSeconds: number | null; problem: string | null }];
}>();

const social = useSocialStore();
const id = useId();
const creator = ref<TikTokCreatorInfo | null>(null);
const loading = ref(false);
const loadError = ref("");
const durationSeconds = ref<number | null>(null);
let sequence = 0;

const problem = computed(() => loadError.value || tiktokChoicesProblem(props.choices, creator.value, durationSeconds.value));
const disclosureLabel = computed(() => tiktokDisclosureLabel(props.choices));
const declaration = computed(() => tiktokDeclaration(props.choices));
const needsKind = computed(() => props.choices.disclose && !props.choices.yourBrand && !props.choices.brandedContent);

function set(patch: Partial<TikTokPostChoices>) {
  emit("update:choices", fitTikTokChoices({ ...props.choices, ...patch }, creator.value));
}

async function loadCreator() {
  const accountId = props.accountId;
  const current = ++sequence;
  creator.value = null;
  loadError.value = "";
  if (!accountId) return;
  loading.value = true;
  try {
    const info = await social.getTikTokCreatorInfo(accountId);
    if (current !== sequence) return;
    creator.value = info;
    emit("update:choices", fitTikTokChoices(props.choices, info));
  } catch (caught) {
    if (current !== sequence) return;
    // TikTok says no when the creator can't post right now (say too many posts today); stop here.
    loadError.value = caught instanceof Error && caught.message
      ? `TikTok can't take a post from this account right now: ${caught.message.replace(/\.$/, "")}. Try again later.`
      : "TikTok can't take a post from this account right now. Try again later.";
  } finally {
    if (current === sequence) loading.value = false;
  }
}

let probe: HTMLVideoElement | null = null;
function readDuration() {
  durationSeconds.value = null;
  probe?.removeAttribute("src");
  const url = props.video?.url;
  if (!url || typeof document === "undefined") return;
  const video = document.createElement("video");
  probe = video;
  video.preload = "metadata";
  video.onloadedmetadata = () => {
    const duration = Number(video.duration);
    if (probe === video) durationSeconds.value = Number.isFinite(duration) && duration > 0 ? duration : null;
  };
  video.src = url;
}

watch(() => props.accountId, () => void loadCreator(), { immediate: true });
watch(() => props.video?.url, readDuration, { immediate: true });
watch([creator, durationSeconds, problem], () =>
  emit("state", { creator: creator.value, durationSeconds: durationSeconds.value, problem: problem.value }),
{ immediate: true });
onBeforeUnmount(() => probe?.removeAttribute("src"));
</script>

<template>
  <section class="tiktok" :aria-labelledby="`${id}-title`">
    <h3 :id="`${id}-title`" class="tiktok__title">Posting on TikTok</h3>

    <p v-if="loading" class="tiktok__note">Checking your TikTok account…</p>
    <p v-else-if="loadError" class="tiktok__problem" role="alert">{{ loadError }}</p>

    <template v-else-if="creator">
      <div class="tiktok__creator">
        <img v-if="creator.avatarUrl" :src="creator.avatarUrl" alt="">
        <span v-else class="tiktok__avatar" aria-hidden="true">{{ creator.nickname.slice(0, 1).toUpperCase() }}</span>
        <span>Posts to <b>{{ creator.nickname }}</b> <small>@{{ creator.username }}</small></span>
      </div>

      <label class="tiktok__field">
        <span>Who can see this</span>
        <select
          class="post-field"
          :value="choices.privacyLevel"
          :disabled="locked"
          @change="set({ privacyLevel: ($event.target as HTMLSelectElement).value as TikTokPostChoices['privacyLevel'] })"
        >
          <option value="" disabled>Choose who can see it</option>
          <option
            v-for="level in creator.privacyLevelOptions"
            :key="level"
            :value="level"
            :disabled="Boolean(tiktokPrivacyDisabled(level, choices))"
            :title="tiktokPrivacyDisabled(level, choices) || undefined"
          >{{ tiktokPrivacyLabel(level) }}</option>
        </select>
        <small v-if="!TIKTOK_OPEN_TO_ALL" class="tiktok__hint">Until TikTok approves ME3, TikTok only takes posts set to Only me, from a private account.</small>
      </label>

      <fieldset class="tiktok__group" :disabled="locked">
        <legend>Let viewers</legend>
        <label :title="creator.commentDisabled ? 'Comments are off in your TikTok settings.' : undefined">
          <input type="checkbox" :checked="choices.allowComment" :disabled="creator.commentDisabled" @change="set({ allowComment: ($event.target as HTMLInputElement).checked })">
          Comment
        </label>
        <label :title="creator.duetDisabled ? 'Duets are off in your TikTok settings.' : undefined">
          <input type="checkbox" :checked="choices.allowDuet" :disabled="creator.duetDisabled" @change="set({ allowDuet: ($event.target as HTMLInputElement).checked })">
          Duet
        </label>
        <label :title="creator.stitchDisabled ? 'Stitch is off in your TikTok settings.' : undefined">
          <input type="checkbox" :checked="choices.allowStitch" :disabled="creator.stitchDisabled" @change="set({ allowStitch: ($event.target as HTMLInputElement).checked })">
          Stitch
        </label>
      </fieldset>

      <fieldset class="tiktok__group tiktok__group--stack" :disabled="locked">
        <legend class="visually-hidden">Commercial content</legend>
        <label class="tiktok__switch">
          <input type="checkbox" role="switch" :checked="choices.disclose" @change="set({ disclose: ($event.target as HTMLInputElement).checked })">
          <span>
            Disclose commercial content
            <small>Turn on if this promotes you, a brand, product or service.</small>
          </span>
        </label>
        <template v-if="choices.disclose">
          <label>
            <input type="checkbox" :checked="choices.yourBrand" @change="set({ yourBrand: ($event.target as HTMLInputElement).checked })">
            <span>Your brand <small>You're promoting yourself or your own business.</small></span>
          </label>
          <label :title="choices.privacyLevel === 'SELF_ONLY' ? 'Branded content visibility cannot be set to private.' : undefined">
            <input
              type="checkbox"
              :checked="choices.brandedContent"
              :disabled="choices.privacyLevel === 'SELF_ONLY'"
              @change="set({ brandedContent: ($event.target as HTMLInputElement).checked })"
            >
            <span>Branded content <small>You're promoting another brand or a third party.</small></span>
          </label>
          <p v-if="disclosureLabel" class="tiktok__note">{{ disclosureLabel }}</p>
          <p v-if="needsKind" class="tiktok__problem">You need to indicate if your content promotes yourself, a third party, or both.</p>
        </template>
      </fieldset>

      <p v-if="problem && !needsKind" class="tiktok__problem">{{ problem }}</p>
      <p class="tiktok__declaration">
        <template v-if="declaration.brandedPolicy">
          By posting, you agree to TikTok's
          <a :href="TIKTOK_BRANDED_POLICY_URL" target="_blank" rel="noopener">Branded Content Policy</a>
          and
          <a :href="TIKTOK_MUSIC_TERMS_URL" target="_blank" rel="noopener">Music Usage Confirmation</a>.
        </template>
        <template v-else>
          By posting, you agree to TikTok's
          <a :href="TIKTOK_MUSIC_TERMS_URL" target="_blank" rel="noopener">Music Usage Confirmation</a>.
        </template>
      </p>
      <p class="tiktok__note">Nothing goes to TikTok until you press Post. After that, TikTok can take a few minutes to process the video before it shows on your profile.</p>
    </template>
  </section>
</template>

<style scoped>
.tiktok { display: grid; gap: 10px; margin-top: 4px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); }
.tiktok__title { margin: 0; font-size: 14px; font-weight: 650; }
.tiktok__creator { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.tiktok__creator img, .tiktok__avatar { flex: none; width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.tiktok__avatar { display: grid; place-items: center; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-weight: 650; }
.tiktok__creator small, .tiktok small { color: var(--ui-text-muted); font-size: 12px; }
.tiktok__field { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
.tiktok__hint { font-weight: 400; }
.tiktok__field select { max-width: 280px; font-weight: 400; }
.tiktok__group { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 0; border: 0; font-size: 13.5px; }
.tiktok__group legend { margin-bottom: 4px; padding: 0; font-size: 13px; font-weight: 600; }
.tiktok__group--stack { display: grid; gap: 8px; }
.tiktok__group label { display: inline-flex; align-items: flex-start; gap: 7px; cursor: pointer; }
.tiktok__group label span { display: grid; gap: 1px; }
.tiktok__group input { margin-top: 3px; accent-color: var(--ui-primary); }
.tiktok__group input:disabled + span, .tiktok__group label:has(input:disabled) { color: var(--ui-text-muted); cursor: not-allowed; }
.tiktok__switch span { font-weight: 600; }
.tiktok__note { margin: 0; color: var(--ui-text-muted); font-size: 12.5px; }
.tiktok__problem { margin: 0; color: var(--ui-danger, #c62828); font-size: 12.5px; }
.tiktok__declaration { margin: 0; font-size: 12.5px; }
.tiktok__declaration a { color: inherit; text-decoration: underline; }
</style>
