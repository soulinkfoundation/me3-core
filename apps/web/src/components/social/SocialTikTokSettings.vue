<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useSocialStore, type SocialMediaAsset, type TikTokCreatorInfo } from "../../stores/social";
import { formatVideoDuration } from "@me3-core/plugin-social-publishing/composer";
import {
  fitTikTokChoices,
  tiktokChoicesProblem,
  tiktokDisclosureLabel,
  tiktokPrivacyDisabled,
  tiktokPrivacyLabel,
  tiktokToChoose,
  type TikTokPostChoices,
} from "../../utils/tiktok-post";
import { TIKTOK_OPEN_TO_ALL } from "../../utils/social-posts";

/**
 * TikTok's required post settings (Content Sharing Guidelines): the account it goes to, who can see it
 * with nothing preselected, interactions off until ticked, and commercial disclosure. One compact block,
 * never collapsed, loaded fresh each time the screen opens; nothing is remembered or prefilled (me3-vque).
 * The consent line sits beside the Post button on the post screen.
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
const toChoose = computed(() => tiktokToChoose(props.choices));
const INTERACTIONS = [
  { key: "allowComment", label: "Comment", off: "commentDisabled", why: "Comments are off in your TikTok settings" },
  { key: "allowDuet", label: "Duet", off: "duetDisabled", why: "Duets are off in your TikTok settings" },
  { key: "allowStitch", label: "Stitch", off: "stitchDisabled", why: "Stitch is off in your TikTok settings" },
] as const;
const privacyHint = TIKTOK_OPEN_TO_ALL
  ? "Options come from your TikTok account."
  : "Options come from your TikTok account. Until TikTok approves ME3, only \"Only me\" works, from a private account.";
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
  <section class="tiktok" :aria-label="toChoose && creator ? `TikTok settings, ${toChoose} to choose` : 'TikTok settings'">

    <p v-if="loading" class="tiktok__note">Checking your TikTok account…</p>
    <p v-else-if="loadError" class="tiktok__problem" role="alert">{{ loadError }}</p>

    <template v-else-if="creator">
      <div class="tiktok__creator" :title="creator.maxVideoPostDurationSeconds ? `Videos up to ${formatVideoDuration(creator.maxVideoPostDurationSeconds)} on this account` : undefined">
        <img v-if="creator.avatarUrl" :src="creator.avatarUrl" alt="">
        <span v-else class="tiktok__avatar" aria-hidden="true">{{ creator.nickname.slice(0, 1).toUpperCase() }}</span>
        <span>
          Posts to <b>{{ creator.nickname }}</b> <small>@{{ creator.username }}</small>
        </span>
      </div>

      <label class="tiktok__field" :title="privacyHint">
        <span>Who can see it <span class="tiktok__required" aria-hidden="true">*</span><span class="visually-hidden">(required)</span></span>
        <select
          class="post-field"
          :class="{ 'is-required': !choices.privacyLevel }"
          :value="choices.privacyLevel"
          :disabled="locked"
          required
          aria-required="true"
          :aria-invalid="!choices.privacyLevel || undefined"
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
        <span class="visually-hidden">{{ privacyHint }}</span>
      </label>

      <fieldset class="tiktok__group" :disabled="locked">
        <legend>Let viewers</legend>
        <label v-for="item in INTERACTIONS" :key="item.key" :class="{ 'is-off': creator[item.off] }" :title="creator[item.off] ? `${item.why}.` : undefined">
          <input
            type="checkbox"
            :checked="choices[item.key]"
            :disabled="creator[item.off]"
            :aria-describedby="creator[item.off] ? `${id}-${item.key}-why` : undefined"
            @change="set({ [item.key]: ($event.target as HTMLInputElement).checked })"
          >
          <span>{{ item.label }}</span>
        </label>
        <template v-for="item in INTERACTIONS" :key="`${item.key}-why`">
          <span v-if="creator[item.off]" :id="`${id}-${item.key}-why`" class="visually-hidden">{{ item.why }}.</span>
        </template>
      </fieldset>

      <fieldset class="tiktok__group tiktok__group--stack" :disabled="locked">
        <legend class="visually-hidden">Commercial content</legend>
        <label class="tiktok__switch" title="Turn on if this promotes you, a brand, product or service.">
          <input type="checkbox" role="switch" :checked="choices.disclose" :aria-describedby="`${id}-disclose-why`" @change="set({ disclose: ($event.target as HTMLInputElement).checked })">
          <span>Disclose commercial content</span>
          <span :id="`${id}-disclose-why`" class="visually-hidden">Turn on if this promotes you, a brand, product or service.</span>
        </label>
        <template v-if="choices.disclose">
          <label title="You're promoting yourself or your own business.">
            <input type="checkbox" :checked="choices.yourBrand" @change="set({ yourBrand: ($event.target as HTMLInputElement).checked })">
            <span>Your brand</span>
          </label>
          <label :title="choices.privacyLevel === 'SELF_ONLY' ? 'Branded content visibility cannot be set to private.' : 'You\'re promoting another brand or a third party.'">
            <input
              type="checkbox"
              :checked="choices.brandedContent"
              :disabled="choices.privacyLevel === 'SELF_ONLY'"
              @change="set({ brandedContent: ($event.target as HTMLInputElement).checked })"
            >
            <span>Branded content</span>
          </label>
          <p v-if="disclosureLabel" class="tiktok__note">{{ disclosureLabel }}</p>
          <p v-if="needsKind" class="tiktok__problem">You need to indicate if your content promotes yourself, a third party, or both.</p>
        </template>
      </fieldset>

      <!-- Choosing who can see it is shown by the highlighted field, not repeated here. -->
      <p v-if="problem && !needsKind && choices.privacyLevel" class="tiktok__problem">{{ problem }}</p>
    </template>
  </section>
</template>

<style scoped>
.tiktok { display: grid; gap: 10px; margin-top: 4px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-surface); }
.tiktok__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.tiktok__title { margin: 0; font-size: 14px; font-weight: 650; }
.tiktok__why { flex-basis: 100%; }
.tiktok__count { color: var(--ui-text-muted); font-size: 12.5px; }
.tiktok__required { color: var(--ui-danger, #c62828); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tiktok__creator { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.tiktok__creator img, .tiktok__avatar { flex: none; width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.tiktok__avatar { display: grid; place-items: center; background: var(--ui-surface-muted); color: var(--ui-text-muted); font-weight: 650; }
.tiktok__creator small, .tiktok small { color: var(--ui-text-muted); font-size: 12px; }
.tiktok__field { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
.tiktok__hint { font-weight: 400; }
.tiktok__field select { max-width: 280px; font-weight: 400; }
.tiktok__field select.is-required { border-color: var(--ui-danger, #c62828); box-shadow: 0 0 0 1px var(--ui-danger, #c62828); }
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
</style>
