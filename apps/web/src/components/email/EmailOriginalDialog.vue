<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";

/**
 * "Show original": a received message's headers as they arrived, with the SPF, DKIM
 * and DMARC results the receiving servers recorded. The first result comes from the
 * server that handed the mail to ME3; ARC results show what an earlier hop saw before
 * a forward changed the route.
 */
type AuthResult = { result: string; detail: string };
type AuthSummary = {
  header: "Authentication-Results" | "ARC-Authentication-Results";
  instance: number | null;
  server: string;
  spf: AuthResult[];
  dkim: AuthResult[];
  dmarc: AuthResult[];
};
type Original = { headers: string; source: "raw" | "parsed"; authentication: AuthSummary[] };

const props = defineProps<{ open: boolean; messageId: string | null; subject?: string }>();
const emit = defineEmits<{ close: [] }>();
const { toastSuccess, toastFromUnknown } = useAppToast();
const original = ref<Original | null>(null);
const loading = ref(false);
const METHODS = ["spf", "dkim", "dmarc"] as const;

const summaries = computed(() => original.value?.authentication || []);

watch(
  () => [props.open, props.messageId] as const,
  async ([open, messageId]) => {
    if (!open || !messageId) return;
    original.value = null;
    loading.value = true;
    try {
      original.value = (await api.get<{ original: Original }>(`/mailbox/messages/${encodeURIComponent(messageId)}/original`)).original;
    } catch (error) {
      toastFromUnknown(error, "The original message could not be loaded.");
      emit("close");
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function summaryLabel(summary: AuthSummary): string {
  return summary.header === "Authentication-Results"
    ? `Checked by ${summary.server}`
    : `Earlier hop${summary.instance ? ` ${summary.instance}` : ""} · ${summary.server}`;
}

function resultTone(result: string): string {
  if (result === "pass") return "pass";
  if (result === "fail" || result === "permerror" || result === "softfail") return "fail";
  return "neutral";
}

async function copyHeaders() {
  if (!original.value) return;
  try {
    await navigator.clipboard.writeText(original.value.headers);
    toastSuccess("Headers copied.");
  } catch (error) {
    toastFromUnknown(error, "The headers could not be copied.");
  }
}
</script>

<template>
  <AppDialog :open="open" class="original-modal" labelled-by="mail-original-title" @close="emit('close')">
    <section class="original-modal__card">
      <header class="original-modal__head">
        <h2 id="mail-original-title">Original message</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only type="button" aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="16" aria-hidden="true" />
        </Button>
      </header>
      <p v-if="subject" class="original-modal__subject">{{ subject }}</p>

      <p v-if="loading" class="original-modal__muted">Loading…</p>
      <template v-else-if="original">
        <h3>Authentication</h3>
        <p v-if="summaries.length === 0" class="original-modal__muted">
          This message has no SPF, DKIM or DMARC results in its headers.
        </p>
        <ul v-else class="original-modal__auth">
          <li v-for="(summary, index) in summaries" :key="index">
            <span class="original-modal__auth-source">{{ summaryLabel(summary) }}</span>
            <dl>
              <template v-for="method in METHODS" :key="method">
                <div v-for="(item, itemIndex) in summary[method]" :key="`${method}-${itemIndex}`" class="original-modal__auth-row">
                  <dt>{{ method.toUpperCase() }}</dt>
                  <dd>
                    <span class="original-modal__result" :class="`original-modal__result--${resultTone(item.result)}`">{{ item.result }}</span>
                    <span v-if="item.detail" class="original-modal__detail">{{ item.detail }}</span>
                  </dd>
                </div>
              </template>
            </dl>
          </li>
        </ul>

        <div class="original-modal__headers-head">
          <h3>Headers</h3>
          <Button color="ghost" shape="soft" size="compact" type="button" @click="copyHeaders">
            <UiIcon name="Copy" :size="14" aria-hidden="true" />
            Copy
          </Button>
        </div>
        <p v-if="original.source === 'parsed'" class="original-modal__muted original-modal__muted--tight">
          The raw message was not kept, so these are the headers ME3 parsed, without their original order.
        </p>
        <pre class="original-modal__headers" tabindex="0" aria-label="Message headers">{{ original.headers }}</pre>
      </template>
    </section>
  </AppDialog>
</template>

<style scoped>
.original-modal__card {
  display: flex;
  flex-direction: column;
  width: min(100%, 720px);
  max-height: min(86vh, 900px);
  padding: 20px;
  border-radius: var(--ui-radius-lg, 16px);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  overflow: auto;
  box-sizing: border-box;
}
.original-modal__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.original-modal__head h2 { margin: 0; font-size: 18px; font-weight: 650; }
.original-modal__subject { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 14px; overflow-wrap: anywhere; }
.original-modal__card h3 { margin: 18px 0 8px; font-size: 14px; font-weight: 650; }
.original-modal__muted { margin: 8px 0 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.45; }
.original-modal__muted--tight { margin: 0 0 8px; font-size: 13px; }
.original-modal__auth { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.original-modal__auth li { padding: 10px 12px; border-radius: 12px; background: var(--ui-surface-muted); }
.original-modal__auth-source { display: block; margin-bottom: 6px; color: var(--ui-text-muted); font-size: 12px; overflow-wrap: anywhere; }
.original-modal__auth dl { display: grid; gap: 4px; margin: 0; }
.original-modal__auth-row { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: 13px; }
.original-modal__auth-row dt { font-weight: 650; }
.original-modal__auth-row dd { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 0; min-width: 0; }
.original-modal__result { font-weight: 650; text-transform: uppercase; font-size: 12px; letter-spacing: 0.03em; }
.original-modal__result--pass { color: var(--ui-success, color-mix(in oklab, #2e7d32 80%, var(--ui-text))); }
.original-modal__result--fail { color: var(--ui-danger, color-mix(in oklab, #c62828 80%, var(--ui-text))); }
.original-modal__result--neutral { color: var(--ui-text-muted); }
.original-modal__detail { color: var(--ui-text-muted); overflow-wrap: anywhere; }
.original-modal__headers-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; }
.original-modal__headers-head h3 { margin: 0; }
.original-modal__headers {
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--ui-surface-muted);
  color: var(--ui-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  max-height: 50vh;
}
</style>
